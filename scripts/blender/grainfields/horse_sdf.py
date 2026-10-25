"""Signed distance fields and the meshing the Grainfields horse is built with.

Shapes (ellipsoids, round cones, tubes, smooth unions, displacement, a half-space cut) are
evaluated in blocks with numpy; the field is polygonised with naive surface nets, projected
onto its zero set, decimated in Blender and cleaned of folds; a half is mirrored into a whole.
Moved out of horse.py unchanged so the horse module holds only the horse.
"""

import math

import numpy as np

VOXEL = 0.007
FAR = 10.0
MARGIN = 0.05
X_AXIS = (1.0, 0.0, 0.0)
Y_AXIS = (0.0, 1.0, 0.0)
Z_AXIS = (0.0, 0.0, 1.0)


# -- small helpers ------------------------------------------------------------------------
def _unit(vector):
    vector = np.asarray(vector, dtype=np.float64)
    return vector / np.linalg.norm(vector)


def _smoothstep(edge0, edge1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _smin(a, b, k):
    """Polynomial smooth minimum: a fillet of about k where two surfaces meet."""
    if k <= 0.0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def _point(y, z, x=0.0):
    return np.array([x, y, z], dtype=np.float64)


# -- the distance field -------------------------------------------------------------------
class Shape:
    part = 0
    hair = False
    ear = False

    def leaves(self):
        return [self]

    def tag(self, part, hair=False):
        for leaf in self.leaves():
            leaf.part = part
            leaf.hair = hair
        return self

    def eval_block(self, xs, ys, zs):
        grid = np.stack(np.meshgrid(xs, ys, zs, indexing="ij"), axis=-1).reshape(-1, 3)
        return self.eval(grid).reshape(len(xs), len(ys), len(zs))


class Ellipsoid(Shape):
    """An ellipsoid; `along` turns its local z axis (radii[2]) onto a direction."""

    def __init__(self, centre, radii, along=None):
        self.centre = np.asarray(centre, dtype=np.float64)
        self.radii = np.asarray(radii, dtype=np.float64)
        if along is None:
            self.frame = np.eye(3)
        else:
            z = _unit(along)
            x = np.array(X_AXIS) - z * z[0]
            if np.linalg.norm(x) < 1e-6:
                x = np.array([0.0, 1.0, 0.0]) - z * z[1]
            x = _unit(x)
            self.frame = np.stack([x, np.cross(z, x), z], axis=1)

    def bounds(self):
        reach = float(self.radii.max())
        return self.centre - reach, self.centre + reach

    def eval(self, p):
        q = (p - self.centre) @ self.frame
        k0 = np.linalg.norm(q / self.radii, axis=1)
        k1 = np.linalg.norm(q / (self.radii * self.radii), axis=1)
        return np.where(k1 > 1e-9, k0 * (k0 - 1.0) / np.maximum(k1, 1e-9), -float(self.radii.min()))


class RoundCone(Shape):
    """A tapered capsule from `a` (radius ra) to `b` (radius rb), optionally squashed.

    `squash` = (axis, factor) flattens the section along `axis` by `factor` (an elliptic
    section: the full radius across, radius x factor along the axis).
    """

    def __init__(self, a, b, ra, rb, squash=None):
        self.a = np.asarray(a, dtype=np.float64)
        self.b = np.asarray(b, dtype=np.float64)
        self.ra, self.rb = float(ra), float(rb)
        self.u, self.factor = (None, 1.0) if squash is None else (_unit(squash[0]), float(squash[1]))
        self.ba = self._stretch(self.b - self.a)
        self.l2 = float(self.ba @ self.ba)
        self.rr = self.ra - self.rb
        self.a2 = self.l2 - self.rr * self.rr
        if self.a2 <= 0.0:
            raise ValueError("round cone end spheres overlap: %s -> %s" % (self.a, self.b))
        self.il2 = 1.0 / self.l2

    def _stretch(self, v):
        if self.u is None:
            return v
        return v + (1.0 / self.factor - 1.0) * (v @ self.u)[..., None] * self.u

    def bounds(self):
        reach = max(self.ra, self.rb)
        return np.minimum(self.a, self.b) - reach, np.maximum(self.a, self.b) + reach

    def eval(self, p):
        # Inigo Quilez's exact round cone, evaluated in the stretched (canonical) space.
        pa = self._stretch(p - self.a)
        y = pa @ self.ba
        z = y - self.l2
        w = pa * self.l2 - y[:, None] * self.ba
        x2 = np.einsum("ij,ij->i", w, w)
        y2 = y * y * self.l2
        z2 = z * z * self.l2
        k = math.copysign(1.0, self.rr) * self.rr * self.rr * x2
        cap_b = np.sqrt(x2 + z2) * self.il2 - self.rb
        cap_a = np.sqrt(x2 + y2) * self.il2 - self.ra
        side = (np.sqrt(x2 * self.a2 * self.il2) + y * self.rr) * self.il2 - self.ra
        d = np.where(np.sign(z) * self.a2 * z2 > k, cap_b, np.where(np.sign(y) * self.a2 * y2 < k, cap_a, side))
        return d * self.factor


class Union(Shape):
    """Smooth union; each child is a shape or (shape, fillet)."""

    def __init__(self, children, k=0.0):
        self.children = [(child, k) if isinstance(child, Shape) else (child[0], float(child[1]))
                         for child in children]

    def leaves(self):
        return [leaf for child, _k in self.children for leaf in child.leaves()]

    def bounds(self):
        lows, highs = zip(*(child.bounds() for child, _k in self.children))
        pad = max(k for _child, k in self.children) * 0.25
        return np.min(lows, axis=0) - pad, np.max(highs, axis=0) + pad

    def eval(self, p):
        result = np.full(len(p), FAR)
        for child, k in self.children:
            low, high = child.bounds()
            inside = np.all((p >= low - k - MARGIN) & (p <= high + k + MARGIN), axis=1)
            if inside.any():
                result[inside] = _smin(result[inside], child.eval(p[inside]), k)
        return result

    def eval_block(self, xs, ys, zs):
        result = np.full((len(xs), len(ys), len(zs)), FAR)
        for child, k in self.children:
            low, high = child.bounds()
            ranges = []
            for axis, values in enumerate((xs, ys, zs)):
                start = int(np.searchsorted(values, low[axis] - k - MARGIN))
                stop = int(np.searchsorted(values, high[axis] + k + MARGIN, side="right"))
                ranges.append(slice(start, stop))
            if any(window.stop <= window.start for window in ranges):
                continue
            region = tuple(ranges)
            result[region] = _smin(result[region], child.eval_block(xs[ranges[0]], ys[ranges[1]], zs[ranges[2]]), k)
        return result


class Tube(Union):
    """Round cones through a polyline of stations: the neck, the legs, the hair."""

    def __init__(self, points, radii, squash_axis=None, squash=1.0, k=0.015):
        points = [np.asarray(point, dtype=np.float64) for point in points]
        factors = np.broadcast_to(np.asarray(squash, dtype=np.float64), (len(points),))
        cones = []
        for index in range(len(points) - 1):
            factor = 0.5 * (factors[index] + factors[index + 1])
            squash_spec = None if squash_axis is None or abs(factor - 1.0) < 1e-6 else (squash_axis, factor)
            cones.append(RoundCone(points[index], points[index + 1], radii[index], radii[index + 1], squash_spec))
        super().__init__(cones, k)


class Displace(Shape):
    """Lumps in the hair: the child's distance plus amplitude x fn(x, y, z)."""

    def __init__(self, child, amplitude, fn):
        self.child, self.amplitude, self.fn = child, float(amplitude), fn

    def leaves(self):
        return self.child.leaves()

    def bounds(self):
        low, high = self.child.bounds()
        return low - self.amplitude, high + self.amplitude

    def eval(self, p):
        return self.child.eval(p) + self.amplitude * self.fn(p[:, 0], p[:, 1], p[:, 2])

    def eval_block(self, xs, ys, zs):
        return self.child.eval_block(xs, ys, zs) + self.amplitude * self.fn(
            xs[:, None, None], ys[None, :, None], zs[None, None, :])


class HalfSpace(Shape):
    """The child cut flat by a coordinate plane, keeping the side where p[axis] >= 0.

    On y it stands the hooves on the ground; on x it keeps the left half of the horse,
    which is polygonised and decimated alone and then mirrored, so the mesh is exactly
    symmetric.
    """

    def __init__(self, child, axis):
        self.child, self.axis = child, int(axis)

    def leaves(self):
        return self.child.leaves()

    def bounds(self):
        low, high = self.child.bounds()
        low = low.copy()
        low[self.axis] = max(low[self.axis], 0.0)
        return low, high

    def eval(self, p):
        return np.maximum(self.child.eval(p), -p[:, self.axis])

    def eval_block(self, xs, ys, zs):
        plane = [xs[:, None, None], ys[None, :, None], zs[None, None, :]][self.axis]
        return np.maximum(self.child.eval_block(xs, ys, zs), -plane)



# -- polygonising -------------------------------------------------------------------------
def _grid(shape, voxel):
    """Samples at half-voxel offsets, so the cut planes x = 0 and y = 0 cross mid-cell."""
    low, high = shape.bounds()

    def samples(start, stop):
        return (np.arange(int(math.floor(start / voxel)) - 2, int(math.ceil(stop / voxel)) + 3) + 0.5) * voxel

    return samples(low[0], high[0]), samples(low[1], high[1]), samples(low[2], high[2])


def surface_nets(field, xs, ys, zs):
    """Naive surface nets: one vertex per surface cell, one quad per crossing edge."""
    nx, ny, nz = field.shape
    voxel = float(xs[1] - xs[0])
    origin = np.array([xs[0], ys[0], zs[0]])
    inside = field < 0.0
    dims = np.array([nx - 1, ny - 1, nz - 1])
    cells = int(np.prod(dims))
    sums = np.zeros((cells, 3))
    counts = np.zeros(cells)
    quads = []
    for axis in range(3):
        lower = [slice(None)] * 3
        upper = [slice(None)] * 3
        lower[axis] = slice(0, -1)
        upper[axis] = slice(1, None)
        crossing = inside[tuple(lower)] != inside[tuple(upper)]
        index = np.stack(np.nonzero(crossing), axis=1)
        if not len(index):
            continue
        ahead = index.copy()
        ahead[:, axis] += 1
        f0 = field[index[:, 0], index[:, 1], index[:, 2]]
        f1 = field[ahead[:, 0], ahead[:, 1], ahead[:, 2]]
        t = f0 / (f0 - f1)
        position = origin + index * voxel
        position[:, axis] += t * voxel
        b, c = (axis + 1) % 3, (axis + 2) % 3
        corners = []
        for db, dc in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            cell = index.copy()
            cell[:, b] += db
            cell[:, c] += dc
            valid = np.all((cell >= 0) & (cell < dims), axis=1)
            flat = (cell[:, 0] * dims[1] + cell[:, 1]) * dims[2] + cell[:, 2]
            for component in range(3):
                sums[:, component] += np.bincount(flat[valid], weights=position[valid, component], minlength=cells)
            counts += np.bincount(flat[valid], minlength=cells)
            corners.append(np.where(valid, flat, -1))
        corners = np.stack(corners, axis=1)
        whole = np.all(corners >= 0, axis=1)
        quad = corners[whole]
        # Wound so the normal points out: +axis when the lower end is inside.
        outward_negative = ~inside[index[whole, 0], index[whole, 1], index[whole, 2]]
        quad[outward_negative] = quad[outward_negative][:, ::-1]
        quads.append(quad)
    active = counts > 0
    lookup = np.full(cells, -1, dtype=np.int64)
    lookup[active] = np.arange(int(active.sum()))
    vertices = sums[active] / counts[active][:, None]
    quads = lookup[np.concatenate(quads)]
    a, b, c, d = (vertices[quads[:, i]] for i in range(4))
    short = np.linalg.norm(a - c, axis=1) <= np.linalg.norm(b - d, axis=1)
    triangles = np.concatenate([
        np.where(short[:, None], quads[:, [0, 1, 2]], quads[:, [0, 1, 3]]),
        np.where(short[:, None], quads[:, [0, 2, 3]], quads[:, [1, 2, 3]]),
    ])
    return vertices, triangles


def gradient(shape, p, eps=0.0015):
    out = np.zeros_like(p)
    for axis in range(3):
        step = np.zeros(3)
        step[axis] = eps
        out[:, axis] = (shape.eval(p + step) - shape.eval(p - step)) / (2.0 * eps)
    return out


def project(shape, p, iterations=3, limit=0.01):
    """Newton steps onto the zero set, each step at most `limit` metres."""
    p = p.copy()
    for _ in range(iterations):
        value = shape.eval(p)
        grad = gradient(shape, p)
        step = value[:, None] * grad / np.maximum((grad * grad).sum(axis=1), 1e-8)[:, None]
        length = np.linalg.norm(step, axis=1)
        step *= np.minimum(1.0, limit / np.maximum(length, 1e-12))[:, None]
        p -= step
    return p


def mesh_normals(positions, triangles):
    a, b, c = (positions[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    normals = np.zeros_like(positions)
    for i in range(3):
        np.add.at(normals, triangles[:, i], face)
    return normals / np.maximum(np.linalg.norm(normals, axis=1), 1e-12)[:, None]


def decimate(studio, positions, triangles, target):
    """Quadric edge collapse in Blender; returns glTF-frame arrays."""
    import bpy
    obj = studio.mesh_object("horse_dense", positions, triangles)
    modifier = obj.modifiers.new("decimate", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = min(1.0, target / float(len(triangles)))
    modifier.use_collapse_triangulate = True
    depsgraph = studio.layer.depsgraph
    depsgraph.update()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    mesh.calc_loop_triangles()
    count = len(mesh.vertices)
    co = np.zeros(count * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    loops = np.zeros(len(mesh.loop_triangles) * 3, dtype=np.int64)
    mesh.loop_triangles.foreach_get("vertices", loops)
    data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(data)
    bpy.data.meshes.remove(mesh)
    # Blender (x, y forward, z up) -> glTF (x, y up, z toward the viewer).
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1), loops.reshape(-1, 3)


def _compact(positions, triangles):
    used = np.unique(triangles)
    remap = np.full(len(positions), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return positions[used].copy(), remap[triangles]


def rim(count, triangles):
    """Vertices on the open boundary (edges used by one triangle)."""
    edges = np.sort(np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]]), axis=1)
    unique, uses = np.unique(edges, axis=0, return_counts=True)
    mask = np.zeros(count, dtype=bool)
    mask[unique[uses == 1].ravel()] = True
    return mask


def on_seam(shape, points):
    """Points moved onto x = 0 and, within that plane, onto the horse's surface."""
    points = points.copy()
    points[:, 0] = 0.0
    for _ in range(4):
        points = project(shape, points, iterations=1, limit=VOXEL)
        points[:, 0] = 0.0
    return points


def open_half(shape, positions, triangles):
    """Drop the flat face the half was cut by, leaving its rim on the seam at x = 0."""
    cut = np.all(np.abs(positions[triangles, 0]) < 1e-6, axis=1)
    positions, triangles = _compact(positions, triangles[~cut])
    seam = rim(len(positions), triangles)
    positions[seam] = on_seam(shape, positions[seam])
    return positions, triangles


def folded(shape, positions, triangles):
    """Triangles facing against the field's outward normal (a decimation fold)."""
    a, b, c = (positions[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    outward = gradient(shape, (a + b + c) / 3.0)

    def unit(vectors):
        return vectors / np.maximum(np.linalg.norm(vectors, axis=1), 1e-12)[:, None]

    # The corners' normals too: in a crease the field turns quickly under a triangle.
    corners = sum(unit(gradient(shape, corner)) for corner in (a, b, c))
    return ((face * outward).sum(axis=1) <= 0.0) | ((face * corners).sum(axis=1) <= 0.0)


def collapse_bad(shape, positions, triangles, seam, passes=4):
    """Collapse the shortest edge of every folded or degenerate triangle."""
    for _ in range(passes):
        a, b, c = (positions[triangles[:, i]] for i in range(3))
        area = np.linalg.norm(np.cross(b - a, c - a), axis=1)
        bad = np.nonzero(folded(shape, positions, triangles) | (area < 1e-8))[0]
        if not len(bad):
            break
        parent = np.arange(len(positions))

        def find(vertex):
            while parent[vertex] != vertex:
                parent[vertex] = parent[parent[vertex]]
                vertex = parent[vertex]
            return vertex

        for index in bad:
            corners = triangles[index]
            lengths = [np.linalg.norm(positions[corners[i]] - positions[corners[(i + 1) % 3]]) for i in range(3)]
            first = int(np.argmin(lengths))
            keep, gone = find(corners[first]), find(corners[(first + 1) % 3])
            if keep == gone:
                continue
            if seam[gone] and not seam[keep]:
                keep, gone = gone, keep
            if seam[keep] == seam[gone]:
                positions[keep] = 0.5 * (positions[keep] + positions[gone])
            parent[gone] = keep
        target = np.array([find(vertex) for vertex in range(len(positions))])
        triangles = target[triangles]
        triangles = triangles[(triangles[:, 0] != triangles[:, 1]) & (triangles[:, 1] != triangles[:, 2])
                              & (triangles[:, 2] != triangles[:, 0])]
        # Two triangles on the same three corners are a fin: drop both.
        keys, inverse, uses = np.unique(np.sort(triangles, axis=1), axis=0, return_inverse=True, return_counts=True)
        triangles = triangles[uses[inverse.ravel()] == 1]
        used = np.unique(triangles)
        remap = np.full(len(positions), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        positions, seam, triangles = positions[used].copy(), seam[used], remap[triangles]
        moved = ~seam
        positions[moved] = project(shape, positions[moved], iterations=2, limit=VOXEL)
        positions[seam] = on_seam(shape, positions[seam])
    return positions, triangles, seam


def untangle(shape, positions, triangles, seam, passes=8):
    """Relax the corners of folded triangles toward their neighbours and back onto the field."""
    neighbours = _neighbours(len(positions), triangles)
    for _ in range(passes):
        bad = folded(shape, positions, triangles)
        if not bad.any():
            break
        corners = np.unique(triangles[bad])
        relaxed = np.array([positions[neighbours[v]].mean(axis=0) for v in corners])
        relaxed = project(shape, relaxed, iterations=3, limit=VOXEL)
        on = seam[corners]
        relaxed[on] = on_seam(shape, relaxed[on])
        positions[corners] = relaxed
    return positions, int(folded(shape, positions, triangles).sum())


def split_seam_chords(shape, positions, triangles, seam, offset=0.002):
    """Split every inner edge that joins two seam vertices (where the half's rim nearly touches
    itself): mirrored, such an edge would be shared by four triangles. Its midpoint goes in, just off
    the seam and back on the surface."""
    edges = np.sort(np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]]), axis=1)
    unique, uses = np.unique(edges, axis=0, return_counts=True)
    chords = unique[(uses == 2) & seam[unique[:, 0]] & seam[unique[:, 1]]]
    if not len(chords):
        return positions, triangles, seam
    positions = list(positions)
    seam = list(seam)
    triangles = [list(t) for t in triangles]
    for a, b in chords:
        middle = 0.5 * (positions[a] + positions[b])
        middle[0] = max(middle[0], offset)
        middle = project(shape, middle[None, :], iterations=3, limit=VOXEL)[0]
        middle[0] = max(middle[0], offset)
        m = len(positions)
        positions.append(middle)
        seam.append(False)
        out = []
        for tri in triangles:
            for i in range(3):
                u, v, w = tri[i], tri[(i + 1) % 3], tri[(i + 2) % 3]
                if {u, v} == {a, b}:
                    out.extend([[u, m, w], [m, v, w]])
                    break
            else:
                out.append(tri)
        triangles = out
    return np.array(positions), np.array(triangles, dtype=np.int64), np.array(seam, dtype=bool)


def mirror(positions, triangles, seam):
    """The left half and its mirror image, welded on the seam at x = 0."""
    off = np.nonzero(~seam)[0]
    image = np.arange(len(positions))
    image[off] = len(positions) + np.arange(len(off))
    mirrored = positions[off] * np.array([-1.0, 1.0, 1.0])
    positions = np.concatenate([positions, mirrored])
    triangles = np.concatenate([triangles, image[triangles][:, ::-1]])
    return positions, triangles



def _neighbours(count, triangles):
    edges = np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    out = [[] for _ in range(count)]
    for a, b in edges:
        out[a].append(int(b))
        out[b].append(int(a))
    return [np.array(entry, dtype=np.int64) for entry in out]
