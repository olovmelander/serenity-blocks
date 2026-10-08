"""Ground props for the firefly-night glade: a fallen spruce, its stump, boulders and a snag.

Each builder returns (positions, normals, uvs, colours, indices) in glTF space: metres,
+Y up, y = 0 the ground the prop is set on.

Vertex colour, the same four jobs as the Golden Forest props:
R = tone. Wood: dark bark is low (0.28..0.5), weathered grey wood is in the middle
    (0.5..0.7) and torn heartwood is high (0.78..0.9). Stone: a broad light/dark mottle.
G = a per-part id (the trunk, each stub, each root, each torn end); on stone a fine grain
    noise; on the snag the limb's id.
B = ambient occlusion, baked afterwards with the prop standing on a ground plane.
A = moss cover: strong in patches on whatever faces the sky, absent underneath, next to
    nothing on torn wood. On the snag it is the Golden Forest's lichen mask instead.

UVs tile a bark sheet on the tubes (the Fall grove's bark mapping) and are a flat
projection in bark-sheet units on torn wood; the boulders carry none (all zero).

The log lies along X with its torn butt at -X and its middle on the origin, bedded about a
third of its radius into the ground. The stump, the boulders and the snag stand on the origin.
"""

import math

import numpy as np

from fall_grove.skeleton import UP, Branch, Tree, normalize
from fall_grove.wood import BARK_TILE_METRES, buttress_profile, fbm, grid_normals, tube
from golden_forest import conifers
from golden_forest import props as lake_props

from .bark import ridge
from .trees import surface_roots


class Pieces:
    """Accumulates finished parts; torn wood is added flat-shaded so its edges stay sharp."""

    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)
        self.positions = []
        self.normals = []
        self.uvs = []
        self.colors = []
        self.indices = []
        self.count = 0

    def add(self, positions, normals, uvs, colors, indices):
        self.positions.append(np.asarray(positions, dtype=float))
        self.normals.append(np.asarray(normals, dtype=float))
        self.uvs.append(np.asarray(uvs, dtype=float))
        self.colors.append(np.asarray(colors, dtype=float))
        self.indices.append(np.asarray(indices, dtype=np.int64).reshape(-1) + self.count)
        self.count += len(positions)

    def add_flat(self, positions, triangles, tone, part, moss=0.0):
        positions = np.asarray(positions, dtype=float)[np.asarray(triangles, dtype=np.int64).reshape(-1)]
        corners = positions.reshape(-1, 3, 3)
        face = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
        face = face / np.maximum(np.linalg.norm(face, axis=1, keepdims=True), 1e-12)
        normals = np.repeat(face, 3, axis=0)
        # A flat projection along the face's dominant axis, in bark-sheet units.
        dominant = np.argmax(np.abs(normals), axis=1)
        first = np.where(dominant == 0, 2, 0)
        second = np.where(dominant == 1, 2, 1)
        rows = np.arange(len(positions))
        uvs = np.stack([positions[rows, first], positions[rows, second]], axis=1) / BARK_TILE_METRES
        colors = np.zeros((len(positions), 4))
        colors[:, 0] = tone
        colors[:, 1] = part
        colors[:, 2] = 1.0
        # What little moss torn wood carries sits on the faces that look at the sky.
        colors[:, 3] = moss * np.clip((normals[:, 1] + 0.12) / 0.75, 0.0, 1.0)
        self.add(positions, normals, uvs, colors, np.arange(len(positions)))

    def arrays(self):
        return (np.concatenate(self.positions), np.concatenate(self.normals), np.concatenate(self.uvs),
                np.concatenate(self.colors), np.concatenate(self.indices))


def _facing(positions, triangle, direction):
    """`triangle` wound so that its normal has a positive component along `direction`."""
    a, b, c = (positions[index] for index in triangle)
    if float(np.dot(np.cross(b - a, c - a), direction)) < 0:
        return (triangle[0], triangle[2], triangle[1])
    return triangle


def torn_end(pieces, ring, centre, axis, lengths, pit, tone=(0.5, 0.92), moss=0.0):
    """Close the open end of a tube with torn wood: a crown of splinters around a ragged pit.

    `ring` is the tube's last ring (without its seam duplicate), `centre` the point of the
    axis inside it and `axis` the unit vector pointing out of the end. `lengths` is how far
    each splinter stands beyond its ring vertex. `tone` is (outside, heartwood).
    """
    rng = pieces.rng
    ring = np.asarray(ring, dtype=float)
    count = len(ring)
    lengths = np.asarray(lengths, dtype=float)
    radial = ring - centre
    radial = radial - np.outer(radial @ axis, axis)
    tips = ring + np.outer(lengths, axis) - radial * rng.uniform(0.04, 0.26, size=(count, 1))
    following = np.roll(np.arange(count), -1)
    notch_depth = np.minimum(lengths, lengths[following]) * rng.uniform(0.0, 0.5, size=count)
    notches = ((ring + ring[following]) * 0.5 + np.outer(notch_depth, axis)
               - (radial + radial[following]) * 0.5 * rng.uniform(0.02, 0.1, size=(count, 1)))
    inner = (centre + radial * rng.uniform(0.34, 0.6, size=(count, 1))
             + np.outer(lengths * rng.uniform(-0.1, 0.45, size=count) - pit * rng.uniform(0.3, 1.0, size=count), axis))
    core = centre - axis * pit
    positions = np.concatenate([ring, tips, notches, inner, [core]])
    tip0, notch0, inner0, core_index = count, count * 2, count * 3, count * 4
    beyond = centre + axis * (float(lengths.max()) + 2.0)
    outside = []
    heartwood = []
    for c in range(count):
        n = int(following[c])
        outward = normalize(radial[c] + radial[n])
        for triangle in ((c, n, notch0 + c), (c, notch0 + c, tip0 + c), (n, tip0 + n, notch0 + c)):
            outside.append(_facing(positions, triangle, outward))
        for triangle in ((tip0 + c, notch0 + c, inner0 + c), (notch0 + c, tip0 + n, inner0 + n),
                         (notch0 + c, inner0 + n, inner0 + c), (inner0 + c, inner0 + n, core_index)):
            middle = (positions[triangle[0]] + positions[triangle[1]] + positions[triangle[2]]) / 3.0
            heartwood.append(_facing(positions, triangle, beyond - middle))
    pieces.add_flat(positions, outside, tone[0], float(rng.random()), moss=moss)
    pieces.add_flat(positions, heartwood, tone[1], float(rng.random()), moss=moss * 0.3)


def _roughen(positions, normals, rings, columns, seed, coarse=0.06, fine=0.02):
    """Push a tube's surface about so a log is not a lathe-turned cylinder; the seam stays closed."""
    bump = (fbm(positions, 1.5, 3, seed) - 0.5) * coarse + (fbm(positions, 5.5, 2, seed + 3) - 0.5) * fine
    grid = (positions + normals * bump[:, None]).reshape(rings, columns, 3)
    grid[:, -1] = grid[:, 0]
    moved = grid.reshape(-1, 3)
    return moved, grid_normals(moved, rings, columns)


def _moss(positions, normals, seed, frequency=1.1, cover=1.0, bare=0.4):
    """Moss on what faces the sky, in patches, thinning to nothing on the underside.

    `bare` is where the patch noise starts to grow moss: lower leaves fewer bald patches.
    """
    upward = np.clip((normals[:, 1] + 0.12) / 0.75, 0.0, 1.0) ** 0.8
    patch = np.clip((fbm(positions, frequency, 3, seed) - bare) * 4.5, 0.0, 1.0)
    fine = fbm(positions, frequency * 5.0, 2, seed + 7)
    return np.clip(upward * (0.12 + 0.95 * patch) * (0.75 + 0.5 * fine) * cover, 0.0, 1.0)


def _bark(positions, normals, colors, seed, part, tone=(0.28, 0.5), moss=1.0, frequency=1.1, bare=0.4):
    """Repaint a tube's vertex colour for a prop: tone, part id, (AO later), moss."""
    colors = colors.copy()
    colors[:, 0] = tone[0] + (tone[1] - tone[0]) * fbm(positions, 2.4, 3, seed + 11)
    colors[:, 1] = part
    colors[:, 2] = 1.0
    colors[:, 3] = _moss(positions, normals, seed, frequency=frequency, cover=moss, bare=bare)
    return colors


def log():
    """A fallen old spruce: 7.5 m of trunk snapped from its stump, with the stubs of its limbs."""
    pieces = Pieces(5303)
    rng = pieces.rng
    length, butt, top = 7.5, 0.42, 0.27
    start, end = -length * 0.5 + 0.5, length * 0.5 - 0.13
    x = np.linspace(start, end, 14)
    t = (x - start) / (end - start)
    radii = (butt + (top - butt) * t ** 0.9) * (1.0 + 0.1 * np.exp(-t / 0.07))
    # Bedded in the ground along its whole length, with the mild bow of a trunk that fell across a hollow.
    points = np.stack([x, radii * 0.68 + 0.025 * np.sin(t * 5.0 + 1.0), 0.11 * np.sin(t * 2.3 + 0.6) - 0.05], axis=1)
    body = Branch(points, radii, 0, sides=16)
    positions, normals, uvs, colors, indices = tube(body, refine=2)
    columns = body.sides + 1
    rings = len(positions) // columns
    positions, normals = _roughen(positions, normals, rings, columns, 71, coarse=0.22, fine=0.05)
    # An old log is a moss bed: its upper side is covered but for a few bald patches.
    pieces.add(positions, normals, uvs, _bark(positions, normals, colors, 73, 0.12, bare=0.28), indices)
    # The butt tore off its stump: a long sliver on the side that held last, ragged everywhere else.
    turn = np.arange(body.sides) / body.sides * math.tau
    hinge = np.clip(np.cos(turn - 4.2), 0.0, 1.0) ** 1.5
    first = positions[:body.sides]
    torn_end(pieces, first, first.mean(axis=0), normalize(points[0] - points[1]),
             0.02 + 0.4 * hinge + 0.2 * rng.random(body.sides) ** 2.5, pit=0.24, tone=(0.46, 0.9), moss=0.25)
    last = positions[(rings - 1) * columns:(rings - 1) * columns + body.sides]
    torn_end(pieces, last, last.mean(axis=0), normalize(points[-1] - points[-2]),
             0.02 + rng.uniform(0.0, 0.1, size=body.sides), pit=0.07, tone=(0.44, 0.78), moss=0.3)
    # Limb stubs, on the upper two thirds of the trunk: the ones underneath broke when it fell.
    stubs = 6
    for index in range(stubs):
        along = 0.12 + 0.74 * (index + float(rng.uniform(0.2, 0.8))) / stubs
        origin, tangent, radius = body.sample(along)
        swing = float(rng.uniform(-1.75, 1.75))
        radial = normalize(UP * math.cos(swing) + np.array([0.0, 0.0, 1.0]) * math.sin(swing))
        lean = float(rng.uniform(-0.15, 0.5))
        direction = normalize(radial * math.cos(lean) + tangent * math.sin(lean))
        reach = float(rng.uniform(0.3, 0.85))
        thick = float(rng.uniform(0.06, 0.1)) * (1.0 - 0.3 * along)
        bend = normalize(np.cross(direction, tangent)) * float(rng.uniform(-0.08, 0.08))
        stub_points = np.array([origin + radial * radius * 0.5 + direction * reach * k + bend * reach * k * k
                                for k in (0.0, 0.42, 0.76, 1.0)]) + radial * radius * 0.4
        stub = Branch(stub_points, np.array([1.3, 1.0, 0.86, 0.72]) * thick, 1, sides=6)
        s_positions, s_normals, s_uvs, s_colors, s_indices = tube(stub, refine=1)
        part = float(rng.random())
        pieces.add(s_positions, s_normals, s_uvs,
                   _bark(s_positions, s_normals, s_colors, 80 + index, part, tone=(0.5, 0.7), moss=0.55), s_indices)
        ring = s_positions[-(stub.sides + 1):-1]
        torn_end(pieces, ring, ring.mean(axis=0), normalize(stub_points[-1] - stub_points[-2]),
                 rng.uniform(0.01, 0.1, size=stub.sides), pit=0.02, tone=(0.6, 0.86), moss=0.1)
    return pieces.arrays()


def stump():
    """What the fallen spruce left standing: a root-flared stump with a splintered top."""
    tree = Tree("stump", 5407)
    rng = tree.rng
    pieces = Pieces(5409)
    radius = 0.44
    points = np.array([[0.0, -0.4, 0.0], [0.004, -0.1, 0.0], [0.01, 0.18, -0.004], [0.018, 0.38, -0.008],
                       [0.024, 0.52, -0.01]])
    trunk = tree.add_branch(points, radius, radius * 0.95, 0, phase=0.0, flex=0.0, sides=18, power=1.0)
    lobes = surface_roots(tree, trunk, radius, 5, reach=(1.2, 2.2), seed_azimuth=float(rng.uniform(0, math.tau)),
                          fork=0.4, ride=0.16, inset=0.9, tall=1.35)
    profile = buttress_profile(radius, lobes, flare=0.45, flare_height=0.5, lobe_gain=0.5, lobe_height=0.4,
                               flute=0.03, seed=2)
    for index, branch in enumerate(tree.branches):
        refine = 3 if branch.level == 0 else 1
        positions, normals, uvs, colors, indices = tube(branch, refine=refine,
                                                        profile=profile if branch.level == 0 else None)
        columns = branch.sides + 1
        rings = len(positions) // columns
        if branch.level == 0:
            positions, normals = _roughen(positions, normals, rings, columns, 91, coarse=0.04, fine=0.015)
            top = positions[(rings - 1) * columns:(rings - 1) * columns + branch.sides]
        elif getattr(branch, "tall", 1.0) != 1.0:
            positions, normals = ridge(positions, branch, refine, columns)
        pieces.add(positions, normals, uvs,
                   _bark(positions, normals, colors, 93 + index, 0.1 if branch.level == 0 else float(rng.random()),
                         frequency=1.6, bare=0.34), indices)
    # The top tore as the tree went over: a tall hinge of splinters on one side.
    turn = np.arange(trunk.sides) / trunk.sides * math.tau
    hinge = np.clip(np.cos(turn - 1.1), 0.0, 1.0) ** 2
    torn_end(pieces, top, top.mean(axis=0), UP, 0.03 + 0.3 * hinge + rng.uniform(0.0, 0.1, size=trunk.sides),
             pit=0.14, tone=(0.46, 0.9), moss=0.25)
    return pieces.arrays()


def boulder(seed, size, detail=3):
    """A glacial erratic under a cap of moss.

    The Golden Forest boulder's recipe - a sphere pushed about by noise, broad and bedded -
    copied here so a small stone can be meshed more coarsely than a big one (`detail` is
    the icosphere's subdivision), and capped with moss instead of flecked with lichen.
    """
    directions, faces = lake_props._icosphere(detail)
    lumps = fbm(directions * 1.3 + seed, 1.0, 3, seed)
    facets = fbm(directions * 3.4 + seed, 1.0, 2, seed + 9)
    radius = 0.72 + 0.42 * lumps + 0.12 * facets
    positions = directions * radius[:, None] * np.asarray(size)
    positions[:, 1] = np.where(positions[:, 1] < 0, positions[:, 1] * 0.45, positions[:, 1])
    normals = np.zeros_like(positions)
    for a, b, c in faces:
        normals[[a, b, c]] += np.cross(positions[b] - positions[a], positions[c] - positions[a])
    normals = normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)
    colors = np.zeros((len(positions), 4))
    colors[:, 0] = np.clip(0.35 + 0.65 * fbm(positions, 0.8 / max(size[0], 0.5), 3, seed + 3), 0.0, 1.0)
    colors[:, 1] = fbm(positions, 5.0, 2, seed + 4)
    colors[:, 2] = 1.0
    # A stone holds more moss than a log does: it has had longer, and nothing sheds from it.
    colors[:, 3] = _moss(positions, normals, seed + 5, frequency=1.5 / max(size[0], 0.5), bare=0.33)
    return positions, normals, np.zeros((len(positions), 2)), colors, faces.reshape(-1)


def snag():
    """A long-dead spruce standing among the living ones: silver wood, a snapped top, bare limbs."""
    tree = conifers.snag(5501, height=11.0)
    pieces = Pieces(5503)
    rng = pieces.rng
    mask = conifers.bark_mask("snag", tree.meta["height"], 17)
    trunk = tree.branches[0]
    for branch in tree.branches:
        positions, normals, uvs, colors, indices = tube(branch, refine=3 if branch.level == 0 else 2,
                                                        profile=tree.trunk_profile if branch.level == 0 else None,
                                                        moss=mask)
        colors = colors.copy()
        colors[:, 0] = np.clip(0.42 + 0.5 * fbm(positions, 0.9, 3, 19), 0.0, 1.0)
        colors[:, 1] = branch.phase
        pieces.add(positions, normals, uvs, colors, indices)
        if branch is trunk:
            top = positions[-(branch.sides + 1):-1]
            tip_axis = normalize(branch.points[-1] - branch.points[-2])
    torn_end(pieces, top, top.mean(axis=0), tip_axis, 0.05 + rng.uniform(0.0, 0.45, size=trunk.sides), pit=0.1,
             tone=(0.6, 0.84), moss=0.0)
    return pieces.arrays()


PROP_BUILDERS = {
    "log": log,
    "stump": stump,
    "boulder_a": lambda: boulder(53, (1.22, 0.98, 1.05)),
    "boulder_b": lambda: boulder(67, (0.82, 0.6, 0.7)),
    "boulder_c": lambda: boulder(79, (0.5, 0.34, 0.43), detail=2),
    "snag": snag,
}
# Every prop stands or lies on the ground: each gets a floor under it for the occlusion bake.
GROUNDED = set(PROP_BUILDERS)
