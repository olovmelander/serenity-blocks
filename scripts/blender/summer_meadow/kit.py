"""A small modelling kit for the Summer props.

Props are built as arrays, part by part (boards, posts, sheets, leaves); Blender only
bakes their ambient occlusion. Coordinates are glTF space: metres, +Y up, +Z the front.

One runtime material shades every prop, so each vertex says what it is made of:

    COLOR_0.r  tone: a per-part (or per-vertex) brightness variation 0..1; on a flower,
               the flower's hue seed
    COLOR_0.g  material code / 8 (see the constants below)
    COLOR_0.b  ambient occlusion (baked afterwards)
    COLOR_0.a  wear: 0 fresh, 1 weathered (lichen on stone, moss on tiles, soot on the
               chimney); on leaves and petals, 0 at the stalk to 1 at the tip

TEXCOORD_0 lays a surface out flat in metres, v along the grain of a board (up a wall,
along a rail, up a roof slope from the eave) and u across it, stored as
0.5 + metres / UV_SPAN. Glass panes, leaves and flowers are mapped 0..1 across themselves.
"""

import math

import numpy as np

from fall_grove.wood import fbm, transport_frames

TIMBER, RED, WHITE, TILE, STONE, GLASS, ACCENT, LEAF, FLOWER = range(9)
CODE_NAMES = ("timber", "red", "white", "tile", "stone", "glass", "accent", "leaf", "flower")
CODES = 8.0
UV_SPAN = 32.0

X = np.array([1.0, 0.0, 0.0])
Y = np.array([0.0, 1.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])


def unit(vector):
    vector = np.asarray(vector, dtype=float)
    length = float(np.linalg.norm(vector))
    return vector / length if length > 1e-12 else vector


def planar_uv(positions, normal, grain=None):
    """Lay points on a plane out in metres: v runs along `grain`, u across it."""
    normal = unit(normal)
    if grain is None:
        grain = Y if abs(normal[1]) < 0.9 else X
    grain = np.asarray(grain, dtype=float)
    v_axis = grain - normal * float(np.dot(grain, normal))
    if np.linalg.norm(v_axis) < 1e-6:
        v_axis = np.cross(normal, X if abs(normal[0]) < 0.9 else Y)
    v_axis = unit(v_axis)
    u_axis = np.cross(v_axis, normal)
    positions = np.asarray(positions, dtype=float)
    return np.stack([positions @ u_axis, positions @ v_axis], axis=1) / UV_SPAN + 0.5


def smooth_normals(positions, triangles):
    triangles = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
    a, b, c = positions[triangles[:, 0]], positions[triangles[:, 1]], positions[triangles[:, 2]]
    face = np.cross(b - a, c - a)
    normals = np.zeros_like(positions)
    for corner in range(3):
        np.add.at(normals, triangles[:, corner], face)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)


class Kit:
    """Accumulates the parts of one prop."""

    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        self.positions = []
        self.normals = []
        self.uvs = []
        self.colors = []
        self.indices = []
        self.trim = []
        self.count = 0
        self.anchors = {}
        self._trim = False

    # -- the one way in -----------------------------------------------------------------
    def part_tone(self, low=0.3, high=1.0):
        return float(self.rng.uniform(low, high))

    def joinery(self):
        """Mark what is built inside `with kit.joinery():` as trim.

        Trim (battens, casings, flower boxes) takes the full occlusion bake. The broad
        surfaces behind it are baked without it, so a wall's few vertices are not darkened
        by the casing that happens to stand on them.
        """
        kit = self

        class Scope:
            def __enter__(self):
                self.before = kit._trim
                kit._trim = True

            def __exit__(self, *_exception):
                kit._trim = self.before

        return Scope()

    def mesh(self, positions, triangles, normals, uvs, code, tone=None, wear=0.0):
        """Add vertices as given. `tone` and `wear` may be numbers, arrays or f(positions)."""
        positions = np.asarray(positions, dtype=float)
        triangles = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
        colors = np.zeros((len(positions), 4))
        if tone is None:
            tone = self.part_tone()
        colors[:, 0] = tone(positions) if callable(tone) else tone
        colors[:, 1] = code / CODES
        colors[:, 2] = 1.0
        colors[:, 3] = wear(positions) if callable(wear) else wear
        self.positions.append(positions)
        self.normals.append(np.asarray(normals, dtype=float))
        self.uvs.append(np.clip(np.asarray(uvs, dtype=float), 0.0, 1.0))
        self.colors.append(np.clip(colors, 0.0, 1.0))
        self.trim.append(np.full(len(positions), self._trim))
        self.indices.append(triangles.reshape(-1) + self.count)
        self.count += len(positions)

    # -- flat faces ---------------------------------------------------------------------
    def poly(self, points, outward, code, tone=None, wear=0.0, grain=None, uvs=None):
        """A flat convex polygon, given by its corners in order; it faces `outward`."""
        points = np.asarray(points, dtype=float)
        normal = np.zeros(3)
        for index in range(len(points)):
            current, following = points[index], points[(index + 1) % len(points)]
            normal += np.cross(current, following)
        if np.linalg.norm(normal) < 1e-12:
            return
        normal = unit(normal)
        if float(np.dot(normal, outward)) < 0:
            points = points[::-1]
            normal = -normal
            if uvs is not None:
                uvs = np.asarray(uvs)[::-1]
        if uvs is None:
            uvs = planar_uv(points, normal, grain)
        triangles = [(0, index, index + 1) for index in range(1, len(points) - 1)]
        self.mesh(points, triangles, np.tile(normal, (len(points), 1)), uvs, code, tone=tone, wear=wear)

    def box(self, low, high, code, skip=(), tone=None, wear=0.0, grain=None):
        """An axis-aligned box; `skip` names the faces to leave out ("-y", "+z", ...)."""
        low, high = np.minimum(low, high), np.maximum(low, high)
        if tone is None:
            tone = self.part_tone()
        if grain is None:
            grain = (X, Y, Z)[int(np.argmax(high - low))]
        x0, y0, z0 = low
        x1, y1, z1 = high
        faces = {
            "-x": ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], -X),
            "+x": ([(x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0)], X),
            "-y": ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], -Y),
            "+y": ([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], Y),
            "-z": ([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], -Z),
            "+z": ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], Z),
        }
        for key, (points, normal) in faces.items():
            if key not in skip:
                self.poly(points, normal, code, tone=tone, wear=wear, grain=grain)

    def bar(self, start, end, width, height, code, up=Y, skip=(), tone=None, wear=0.0):
        """A rectangular bar between two points; `height` is measured toward `up`.

        Faces are "top", "bottom", "left", "right" (looking from start to end with `up`
        overhead), "start" and "end". The grain runs along the bar.
        """
        start = np.asarray(start, dtype=float)
        end = np.asarray(end, dtype=float)
        axis = unit(end - start)
        side = np.cross(axis, np.asarray(up, dtype=float))
        if np.linalg.norm(side) < 1e-6:
            side = np.cross(axis, X)
        side = unit(side)
        rise = np.cross(side, axis)
        if tone is None:
            tone = self.part_tone()

        def corner(point, a, b):
            return point + side * a * width * 0.5 + rise * b * height * 0.5

        faces = {
            "top": ([corner(start, -1, 1), corner(start, 1, 1), corner(end, 1, 1), corner(end, -1, 1)], rise),
            "bottom": ([corner(start, -1, -1), corner(start, 1, -1), corner(end, 1, -1), corner(end, -1, -1)], -rise),
            "left": ([corner(start, -1, -1), corner(start, -1, 1), corner(end, -1, 1), corner(end, -1, -1)], -side),
            "right": ([corner(start, 1, -1), corner(start, 1, 1), corner(end, 1, 1), corner(end, 1, -1)], side),
            "start": ([corner(start, -1, -1), corner(start, 1, -1), corner(start, 1, 1), corner(start, -1, 1)], -axis),
            "end": ([corner(end, -1, -1), corner(end, 1, -1), corner(end, 1, 1), corner(end, -1, 1)], axis),
        }
        for key, (points, normal) in faces.items():
            if key not in skip:
                self.poly(points, normal, code, tone=tone, wear=wear, grain=axis)

    # -- smooth surfaces ----------------------------------------------------------------
    def sheet(self, grid, outward, code, uvs, tone=None, wear=0.0):
        """A smooth-shaded grid of points (rows x columns x 3) facing `outward`."""
        grid = np.asarray(grid, dtype=float)
        rows, columns, _ = grid.shape
        positions = grid.reshape(-1, 3)
        triangles = []
        for row in range(rows - 1):
            for column in range(columns - 1):
                a = row * columns + column
                triangles.extend(((a, a + 1, a + columns), (a + 1, a + columns + 1, a + columns)))
        triangles = np.array(triangles)
        normals = smooth_normals(positions, triangles)
        if float(np.dot(normals.sum(axis=0), outward)) < 0:
            triangles = triangles[:, [0, 2, 1]]
            normals = -normals
        self.mesh(positions, triangles, normals, np.asarray(uvs, dtype=float).reshape(-1, 2), code, tone=tone,
                  wear=wear)

    def tube(self, path, radii, sides, code, tone=None, wear=0.0, cap_start=False, cap_end=False, closed=False,
             lumpy=0.0):
        """A round bar along a path. `closed` joins the last ring to the first (a hoop).

        `lumpy` pushes every vertex in or out by up to that share of the radius, which turns
        a pipe into something grown.
        """
        path = np.asarray(path, dtype=float)
        radii = np.broadcast_to(np.asarray(radii, dtype=float), (len(path),))
        if closed:
            path = np.concatenate([path, path[:1]])
            radii = np.concatenate([radii, radii[:1]])
        _tangents, normals, binormals = transport_frames(path)
        if closed:
            # Carry the frame round without a twist where the hoop closes.
            twist = math.atan2(float(np.dot(normals[0], binormals[-1])), float(np.dot(normals[0], normals[-1])))
            for index in range(len(path)):
                angle = twist * index / (len(path) - 1)
                cosine, sine = math.cos(angle), math.sin(angle)
                normals[index], binormals[index] = (normals[index] * cosine + binormals[index] * sine,
                                                    binormals[index] * cosine - normals[index] * sine)
        rings = len(path)
        columns = sides + 1
        arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
        positions = np.zeros((rings, columns, 3))
        radial = np.zeros((rings, columns, 3))
        uvs = np.zeros((rings, columns, 2))
        for ring in range(rings):
            for column in range(columns):
                theta = math.tau * (column % sides) / sides
                radial[ring, column] = normals[ring] * math.cos(theta) + binormals[ring] * math.sin(theta)
                positions[ring, column] = path[ring] + radial[ring, column] * radii[ring]
                uvs[ring, column] = (0.5 + (column / sides - 0.5) * math.tau * radii[ring] / UV_SPAN,
                                     0.5 + (arc[ring] - arc[-1] * 0.5) / UV_SPAN)
        if lumpy:
            swell = 1.0 + lumpy * self.rng.uniform(-1.0, 1.0, size=(rings, sides))
            if closed:
                swell[-1] = swell[0]
            swell = np.concatenate([swell, swell[:, :1]], axis=1)[:, :, None]
            positions = path[:, None, :] + (positions - path[:, None, :]) * swell
        triangles = []
        for ring in range(rings - 1):
            for column in range(sides):
                a = ring * columns + column
                triangles.extend(((a, a + 1, a + columns), (a + 1, a + columns + 1, a + columns)))
        triangles = np.array(triangles)
        flat = positions.reshape(-1, 3)
        first = triangles[0]
        facing = np.cross(flat[first[1]] - flat[first[0]], flat[first[2]] - flat[first[0]])
        if float(np.dot(facing, radial.reshape(-1, 3)[first[0]])) < 0:
            triangles = triangles[:, [0, 2, 1]]
        if tone is None:
            tone = self.part_tone()
        self.mesh(flat, triangles, radial.reshape(-1, 3), uvs.reshape(-1, 2), code, tone=tone, wear=wear)
        for wanted, ring, direction in ((cap_start, 0, path[0] - path[1]), (cap_end, rings - 1, path[-1] - path[-2])):
            if wanted:
                self.poly(positions[ring, :sides], direction, code, tone=tone, wear=wear)

    # -- finishing ----------------------------------------------------------------------
    def weather(self, rule):
        """Rewrite wear from `rule(positions, normals, codes, wear)` over the whole prop."""
        offset = 0
        positions = np.concatenate(self.positions)
        normals = np.concatenate(self.normals)
        colors = np.concatenate(self.colors)
        codes = np.round(colors[:, 1] * CODES).astype(int)
        wear = np.clip(rule(positions, normals, codes, colors[:, 3]), 0.0, 1.0)
        for chunk in self.colors:
            chunk[:, 3] = wear[offset:offset + len(chunk)]
            offset += len(chunk)

    def arrays(self):
        return (np.concatenate(self.positions), np.concatenate(self.normals), np.concatenate(self.uvs),
                np.concatenate(self.colors), np.concatenate(self.indices))

    def structure(self):
        """True for every vertex that is not trim (see `joinery`)."""
        return ~np.concatenate(self.trim)

    @property
    def triangles(self):
        return int(sum(len(chunk) for chunk in self.indices) // 3)


def patchy(seed, scale=0.8, low=0.35, high=1.0, octaves=3):
    """A tone that drifts across a surface (paint that has weathered unevenly)."""
    def tone(positions):
        return low + (high - low) * fbm(positions, scale, octaves, seed)
    return tone


def weld(positions, normals, uvs, colors, indices, decimals=5):
    """Merge vertices that agree in every attribute (flat faces built a triangle at a time)."""
    rows = np.concatenate([np.round(positions, decimals), np.round(normals, 4), np.round(uvs, 6),
                           np.round(colors, 5)], axis=1)
    _unique, first, inverse = np.unique(rows, axis=0, return_index=True, return_inverse=True)
    order = np.argsort(first)                      # keep vertices in the order they were built
    rank = np.empty(len(order), dtype=np.int64)
    rank[order] = np.arange(len(order))
    keep = first[order]
    return (positions[keep], normals[keep], uvs[keep], colors[keep],
            rank[np.asarray(inverse).reshape(-1)][np.asarray(indices).reshape(-1)])
