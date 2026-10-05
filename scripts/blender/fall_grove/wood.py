"""Bark geometry for the Fall grove: tapered tubes with flared, buttressed bases.

Vertex colour carries what the wind and the painter need at runtime:
R = how far the wind may carry the vertex, G = the limb's phase, B = ambient occlusion,
A = moss cover. UVs tile a bark sheet whose texels stay square as the limb thins.
"""

import math

import numpy as np

from .skeleton import UP, normalize, perpendicular

BARK_TILE_METRES = 1.15
BARK_SHEET_ASPECT = 2.0   # the bark sheet is twice as tall as it is wide


def catmull_refine(points, radii, factor):
    """Insert `factor - 1` Catmull-Rom points per segment so limbs curve instead of kinking."""
    if factor <= 1 or len(points) < 3:
        return np.asarray(points, dtype=float), np.asarray(radii, dtype=float)
    points = np.asarray(points, dtype=float)
    radii = np.asarray(radii, dtype=float)
    padded = np.vstack([points[0] * 2 - points[1], points, points[-1] * 2 - points[-2]])
    out_points = []
    out_radii = []
    for index in range(len(points) - 1):
        p0, p1, p2, p3 = padded[index], padded[index + 1], padded[index + 2], padded[index + 3]
        for step in range(factor):
            t = step / factor
            out_points.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                                     + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
            out_radii.append(radii[index] * (1 - t) + radii[index + 1] * t)
    out_points.append(points[-1])
    out_radii.append(radii[-1])
    return np.array(out_points), np.array(out_radii)


def transport_frames(points):
    """Rotation-minimising frames along a polyline (no twisting at vertical runs)."""
    count = len(points)
    tangents = np.zeros((count, 3))
    for index in range(count):
        tangents[index] = normalize(points[min(index + 1, count - 1)] - points[max(index - 1, 0)])
    normals = np.zeros((count, 3))
    normals[0] = perpendicular(tangents[0])
    for index in range(1, count):
        candidate = normals[index - 1] - tangents[index] * float(np.dot(normals[index - 1], tangents[index]))
        normals[index] = normalize(candidate) if np.linalg.norm(candidate) > 1e-6 else perpendicular(tangents[index])
    binormals = np.cross(tangents, normals)
    return tangents, normals, binormals


class MeshData:
    """Growable indexed triangle mesh with the grove's standard attributes."""

    def __init__(self):
        self.positions = []
        self.normals = []
        self.uvs = []
        self.colors = []
        self.indices = []
        self.count = 0

    def append(self, positions, normals, uvs, colors, indices):
        self.positions.append(np.asarray(positions, dtype=np.float64))
        self.normals.append(np.asarray(normals, dtype=np.float64))
        self.uvs.append(np.asarray(uvs, dtype=np.float64))
        self.colors.append(np.asarray(colors, dtype=np.float64))
        self.indices.append(np.asarray(indices, dtype=np.int64) + self.count)
        self.count += len(positions)

    def arrays(self):
        return (np.concatenate(self.positions), np.concatenate(self.normals), np.concatenate(self.uvs),
                np.concatenate(self.colors), np.concatenate(self.indices))

    @property
    def triangles(self):
        return int(sum(len(chunk) for chunk in self.indices) // 3)


def grid_normals(positions, rings, columns, closed=True):
    """Smooth normals for a (rings x columns) grid whose last column repeats the first."""
    grid = positions.reshape(rings, columns, 3)
    normals = np.zeros_like(grid)
    a = grid[:-1, :-1]
    b = grid[:-1, 1:]
    c = grid[1:, :-1]
    d = grid[1:, 1:]
    first = np.cross(b - a, c - a)
    second = np.cross(d - b, c - b)
    normals[:-1, :-1] += first
    normals[:-1, 1:] += first + second
    normals[1:, :-1] += first + second
    normals[1:, 1:] += second
    if closed:
        seam = normals[:, 0] + normals[:, -1]
        normals[:, 0] = seam
        normals[:, -1] = seam
    lengths = np.linalg.norm(normals, axis=2, keepdims=True)
    return (normals / np.maximum(lengths, 1e-9)).reshape(-1, 3)


def tube(branch, sides=None, refine=1, profile=None, moss=None, ao=None):
    """Mesh one branch. `profile(azimuth, point, t)` scales the radius per ring vertex."""
    sides = sides or branch.sides
    points, radii = catmull_refine(branch.points, branch.radii, refine)
    rings = len(points)
    tangents, normals, binormals = transport_frames(points)
    segments = np.linalg.norm(np.diff(points, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(segments)])
    total = max(arc[-1], 1e-6)
    repeats = max(1, int(round(math.tau * radii[0] / BARK_TILE_METRES)))
    v = np.zeros(rings)
    for index in range(1, rings):
        mean_radius = max(0.5 * (radii[index] + radii[index - 1]), 0.02)
        v[index] = v[index - 1] + segments[index - 1] / (BARK_SHEET_ASPECT * math.tau * mean_radius / repeats)
    columns = sides + 1
    positions = np.zeros((rings, columns, 3))
    uvs = np.zeros((rings, columns, 2))
    colors = np.zeros((rings, columns, 4))
    for ring in range(rings):
        t = arc[ring] / total
        for column in range(columns):
            theta = math.tau * (column % sides) / sides
            radial = normals[ring] * math.cos(theta) + binormals[ring] * math.sin(theta)
            scale = 1.0
            if profile is not None:
                scale = profile(math.atan2(radial[2], radial[0]), points[ring], t)
            positions[ring, column] = points[ring] + radial * radii[ring] * scale
            uvs[ring, column] = (column / sides * repeats, v[ring])
            colors[ring, column, 0] = min(1.0, branch.sway_at(t))
            colors[ring, column, 1] = branch.phase
            colors[ring, column, 2] = 1.0
            colors[ring, column, 3] = 0.0
    flat = positions.reshape(-1, 3)
    vertex_normals = grid_normals(flat, rings, columns)
    flat_colors = colors.reshape(-1, 4)
    if ao is not None:
        flat_colors[:, 2] = ao(flat, vertex_normals)
    if moss is not None:
        flat_colors[:, 3] = moss(flat, vertex_normals)
    index = []
    for ring in range(rings - 1):
        for column in range(sides):
            a = ring * columns + column
            b = a + 1
            c = a + columns
            d = c + 1
            index.extend((a, b, c, b, d, c))
    return flat, vertex_normals, uvs.reshape(-1, 2), flat_colors, np.array(index)


def value_noise(points, frequency, seed=0):
    """Cheap trilinear value noise in [0, 1] (vectorised) for moss and bark breakup."""
    points = np.asarray(points, dtype=np.float64) * frequency
    base = np.floor(points).astype(np.int64)
    local = points - base
    smooth = local * local * (3 - 2 * local)

    def corner(dx, dy, dz):
        x = base[:, 0] + dx
        y = base[:, 1] + dy
        z = base[:, 2] + dz
        hashed = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1442695041) & 0xFFFFFFFF
        hashed = (hashed ^ (hashed >> 13)) * 1274126177 & 0xFFFFFFFF
        return ((hashed ^ (hashed >> 16)) & 0xFFFF) / 65535.0

    result = np.zeros(len(points))
    for dx in (0, 1):
        wx = smooth[:, 0] if dx else 1 - smooth[:, 0]
        for dy in (0, 1):
            wy = smooth[:, 1] if dy else 1 - smooth[:, 1]
            for dz in (0, 1):
                wz = smooth[:, 2] if dz else 1 - smooth[:, 2]
                result += corner(dx, dy, dz) * wx * wy * wz
    return result


def fbm(points, frequency, octaves=3, seed=0):
    total = np.zeros(len(points))
    amplitude = 0.5
    norm = 0.0
    for octave in range(octaves):
        total += value_noise(points, frequency * (2 ** octave), seed + octave * 17) * amplitude
        norm += amplitude
        amplitude *= 0.5
    return total / norm


def buttress_profile(trunk_radius, lobes, flare=0.5, flare_height=1.2, lobe_gain=0.55, lobe_height=1.0,
                     flute=0.035, seed=0):
    """Radius multiplier giving an old trunk its flared, fluted, root-gripping base."""
    def profile(azimuth, point, _t):
        height = max(0.0, point[1])
        scale = 1.0 + flare * math.exp(-height / flare_height)
        buttress = 0.0
        for lobe_azimuth, lobe_width, lobe_strength in lobes:
            delta = math.atan2(math.sin(azimuth - lobe_azimuth), math.cos(azimuth - lobe_azimuth))
            buttress += lobe_strength * math.exp(-(delta / lobe_width) ** 2)
        scale *= 1.0 + lobe_gain * buttress * math.exp(-height / lobe_height)
        scale *= 1.0 + flute * math.sin(5.0 * azimuth + height * 0.55 + seed) * min(1.0, height / 2.0)
        scale *= 1.0 + 0.05 * math.sin(height * 1.7 + azimuth * 2.0 + seed * 1.3)
        return scale
    return profile


def moss_mask(seed, height=2.6, limb_tops=0.5):
    """Moss gathers on the damp north-facing base and along the tops of old limbs."""
    def mask(positions, normals):
        noise = fbm(positions, 0.9, 3, seed)
        fine = fbm(positions, 4.5, 2, seed + 7)
        low = np.clip(1.0 - positions[:, 1] / height, 0.0, 1.0) ** 1.2
        upward = np.clip((normals[:, 1] - 0.15) / 0.75, 0.0, 1.0)
        north = np.clip(0.55 + 0.45 * normals[:, 2], 0.0, 1.0)      # +Z faces the camera/shade
        base = low * (0.35 + 0.65 * north) * np.clip((noise - 0.3) * 3.0, 0.0, 1.0)
        tops = upward * limb_tops * np.clip((noise - 0.42) * 3.2, 0.0, 1.0)
        return np.clip((base + tops) * (0.7 + 0.6 * fine), 0.0, 1.0)
    return mask


def build_wood(tree, hero=False, trunk_profile=None, moss_seed=3, twig_level=3, include_twigs=True):
    """Mesh every branch of `tree` into one bark mesh."""
    mesh = MeshData()
    mesh.core_indices = 0
    moss = moss_mask(moss_seed, height=3.0 if hero else 1.8, limb_tops=0.55 if hero else 0.25)
    # Twigs go last in the index buffer so a low quality tier can draw the tree without them.
    ordered = sorted(tree.branches, key=lambda branch: branch.level >= twig_level)
    for branch in ordered:
        if branch.level >= twig_level and not include_twigs:
            continue
        if branch.level < twig_level:
            mesh.core_indices = None
        refine = 1
        if branch.level == 0:
            refine = 3 if hero else 2
        elif branch.level == 1:
            refine = 2
        profile = trunk_profile if (branch.level == 0 and trunk_profile is not None) else None
        use_moss = moss if branch.level <= 1 else None
        mesh.append(*tube(branch, refine=refine, profile=profile, moss=use_moss))
        if branch.level < twig_level:
            mesh.core_indices = mesh.triangles * 3
    return mesh
