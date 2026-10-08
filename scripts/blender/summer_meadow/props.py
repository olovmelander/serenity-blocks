"""The props of the Summer meadow, by name.

Each builder returns a `Prop`: arrays (positions, normals, uvs, colours, indices) in glTF
space (metres, +Y up, base at y = 0, +Z the front) and a dictionary of anchor points in the
prop's own metres. Vertex colour and UV conventions are the kit's (see kit.py).

The cottage, the boathouse and the maypole are modelled in their own modules. The rowboat
is the Golden Forest's builder, repainted in the kit's material codes; the boulders follow
its recipe on a lighter sphere; the jetty and the roundpole fence are built plank by plank
and pole by pole.
"""

import math

import numpy as np

from fall_grove.wood import fbm
from golden_forest import props as lake_props

from . import cottage, maypole
from .kit import CODES, RED, STONE, TIMBER, UV_SPAN, X, Y, Kit, smooth_normals, unit, weld

JETTY_LENGTH = 8.5
JETTY_DECK = 0.45
FENCE_SECTION = 3.0


class Prop:
    def __init__(self, arrays, anchors=None, grounded=True, structure=None):
        self.arrays = arrays
        self.anchors = anchors or {}
        self.grounded = grounded          # stands on the ground: bake its contact shade
        self.structure = structure        # per vertex: False on trim (see Kit.joinery)


def _kit_prop(kit, grounded=True):
    return Prop(kit.arrays(), kit.anchors, grounded, kit.structure())


def jetty():
    """A weathered plank jetty on round posts, running out along -Z from the bank at the origin."""
    kit = Kit(7405)
    rng = kit.rng
    planks = []
    z = -0.08
    while z > -JETTY_LENGTH:
        width = 0.13 + float(rng.uniform(0.0, 0.035))
        half = (1.5 + float(rng.uniform(-0.06, 0.1))) * 0.5
        planks.append((z, width, half, float(rng.uniform(-0.03, 0.03)),
                       JETTY_DECK - 0.0175 + float(rng.uniform(-0.006, 0.006)), float(rng.uniform(-0.02, 0.02)) * half,
                       float(rng.uniform(0.0, 0.6))))
        z -= width + 0.014
    for index, (z, width, half, x, y, skew, wear) in enumerate(planks):
        # Only the first and last plank show their long edges; the rest hide them in the gaps.
        hidden = ("bottom",) if index in (0, len(planks) - 1) else ("bottom", "left", "right")
        kit.bar([x - half, y, z - width * 0.5 - skew], [x + half, y, z - width * 0.5 + skew], width, 0.035, TIMBER,
                skip=hidden, wear=wear)
    for x in (-0.55, 0.55):
        kit.box([x - 0.045, JETTY_DECK - 0.175, -JETTY_LENGTH], [x + 0.045, JETTY_DECK - 0.035, 0.0], TIMBER,
                skip=("+y", "+z"), tone=0.3, wear=0.4)
    mooring = None
    for index in range(5):
        along = -0.5 - index * (JETTY_LENGTH - 0.9) / 4
        for x in (-0.7, 0.7):
            tall = index == 4 and x > 0
            top = JETTY_DECK + (0.62 if tall else 0.1) + float(rng.uniform(0.0, 0.08))
            radius = 0.075 + float(rng.uniform(0.0, 0.012))
            kit.tube([(x, -1.6, along), (x, -0.2, along), (x, top, along)], [radius, radius * 0.97, radius * 0.9], 7,
                     TIMBER, tone=0.34, wear=0.7, cap_end=True)
            if tall:
                mooring = [x, round(top, 4), round(along, 4)]
        kit.box([-0.75, JETTY_DECK - 0.275, along - 0.035], [0.75, JETTY_DECK - 0.175, along + 0.035], TIMBER,
                skip=("+y",), tone=0.28, wear=0.5)
    kit.anchors = dict(end=[0.0, JETTY_DECK, -JETTY_LENGTH], shore=[0.0, JETTY_DECK, 0.0], mooring=mooring,
                       deckWidth=1.5)
    return _kit_prop(kit, grounded=False)


def rowboat():
    """The Golden Forest's clinker rowboat, its outside strakes painted Falu red.

    It floats with its waterline at y = 0. It is double-ended; the oars are shipped with
    their blades toward -Z.
    """
    positions, normals, _uvs, colors, indices = lake_props.rowboat()
    # The lake builder lays down, for each side: five strakes of 63 vertices, the inner
    # skin (147), the rail (42); then the thwarts and oars.
    side = 5 * 63 + 147 + 42
    if len(positions) != 2 * side + 7 * 36:
        raise RuntimeError("golden_forest.props.rowboat changed its layout; repaint the strakes by hand")
    code = np.full(len(positions), float(TIMBER))
    for start in (0, side):
        code[start:start + 5 * 63] = RED
    painted = colors.copy()
    painted[:, 1] = code / CODES
    uvs = np.stack([0.5 + positions[:, 1] / UV_SPAN, 0.5 + positions[:, 2] / UV_SPAN], axis=1)
    anchors = dict(bow=[0.0, 0.6, -2.2], stern=[0.0, 0.6, 2.2], thwart=[0.0, 0.215, -0.044])
    return Prop(weld(positions, normals, uvs, painted, indices), anchors, grounded=False)


def _geodesic(frequency):
    """A unit sphere: every face of an icosahedron cut into `frequency` squared triangles."""
    corners, faces = lake_props._icosphere(0)
    index = {}
    vertices = []
    triangles = []

    def vertex(point):
        point = point / np.linalg.norm(point)
        key = tuple(np.round(point, 6))
        if key not in index:
            index[key] = len(vertices)
            vertices.append(point)
        return index[key]

    for a, b, c in faces:
        pa, pb, pc = corners[a], corners[b], corners[c]
        grid = {}
        for i in range(frequency + 1):
            for j in range(frequency + 1 - i):
                grid[(i, j)] = vertex(pa + (pb - pa) * (i / frequency) + (pc - pa) * (j / frequency))
        for i in range(frequency):
            for j in range(frequency - i):
                triangles.append((grid[(i, j)], grid[(i + 1, j)], grid[(i, j + 1)]))
                if j < frequency - i - 1:
                    triangles.append((grid[(i + 1, j)], grid[(i + 1, j + 1)], grid[(i, j + 1)]))
    return np.array(vertices), np.array(triangles)


def boulder(seed, size):
    """An ice-rounded granite boulder, bedded in the ground (wear = lichen).

    The Golden Forest's recipe (a sphere pushed about by noise) on a 720-triangle sphere:
    in a meadow the stones stand half in the grass.
    """
    directions, faces = _geodesic(6)
    lumps = fbm(directions * 1.3 + seed, 1.0, 3, seed)
    facets = fbm(directions * 3.4 + seed, 1.0, 2, seed + 9)
    radius = 0.72 + 0.42 * lumps + 0.12 * facets
    positions = directions * radius[:, None] * np.asarray(size)
    positions[:, 1] = np.where(positions[:, 1] < 0, positions[:, 1] * 0.45, positions[:, 1])
    outward = np.cross(positions[faces[:, 1]] - positions[faces[:, 0]], positions[faces[:, 2]] - positions[faces[:, 0]])
    inside = np.einsum("ij,ij->i", outward, positions[faces].mean(axis=1)) < 0
    faces[inside] = faces[inside][:, [0, 2, 1]]
    normals = smooth_normals(positions, faces)
    colors = np.zeros((len(positions), 4))
    colors[:, 0] = np.clip(0.35 + 0.65 * fbm(positions, 0.8, 3, seed + 3), 0.0, 1.0)
    colors[:, 1] = STONE / CODES
    colors[:, 2] = 1.0
    lichen = fbm(positions, 1.6, 3, seed + 5)
    colors[:, 3] = np.clip((lichen - 0.42) * 3.2, 0.0, 1.0) * np.clip(normals[:, 1] * 1.4 + 0.25, 0.0, 1.0)
    uvs = np.stack([0.5 + positions[:, 0] / UV_SPAN, 0.5 + positions[:, 2] / UV_SPAN], axis=1)
    return Prop((positions, normals, uvs, colors, faces.reshape(-1)), {})


def fence():
    """One section of a roundpole fence (gardsgard): slanting split rails between pairs of stakes.

    The section is exactly three metres along X and tiles: stake pairs stand a metre apart,
    and a rail that climbs out through one end of the section comes back in at the other,
    so every stake carries a full stack and sections laid end to end read as one fence.
    """
    kit = Kit(7509)
    rng = kit.rng
    half = FENCE_SECTION * 0.5
    slant = math.radians(25.0)
    rails = 9
    height = 1.2
    run = height / math.tan(slant)
    for index in range(rails):
        foot = -half + FENCE_SECTION * (index + 0.5) / rails + float(rng.uniform(-0.03, 0.03))
        lean = slant + float(rng.uniform(-0.02, 0.02))
        direction = X * math.cos(lean) + Y * math.sin(lean)
        length = (run + float(rng.uniform(0.2, 0.45))) / math.cos(slant)
        start = np.array([foot, -0.05, float(rng.uniform(-0.012, 0.012))]) - direction * 0.1
        end = start + direction * length
        thick = 0.035 + float(rng.uniform(0.0, 0.01))       # a split rail: four faces, corner to corner
        tone = kit.part_tone()
        wear = float(rng.uniform(0.35, 0.9))
        # Cut the rail where it leaves the section and bring the rest back in at the other end.
        cuts = [0.0, 1.0]
        for wrap in range(-1, 3):
            share = (half + wrap * FENCE_SECTION - start[0]) / (end[0] - start[0])
            if 0.0 < share < 1.0:
                cuts.append(share)
        cuts.sort()
        for low, high in zip(cuts, cuts[1:]):
            near, far = start + (end - start) * low, start + (end - start) * high
            shift = X * FENCE_SECTION * math.floor(((near[0] + far[0]) * 0.5 + half) / FENCE_SECTION)
            kit.tube([near - shift, far - shift], [thick * (1.0 - 0.38 * low), thick * (1.0 - 0.38 * high)], 4, TIMBER,
                     tone=tone, wear=wear, cap_start=low > 0.0, cap_end=True)
    for index in range(3):
        x = -1.0 + index * 1.0 + float(rng.uniform(-0.03, 0.03))
        stakes = []
        for side in (-1.0, 1.0):
            foot = np.array([x + float(rng.uniform(-0.03, 0.03)), -0.25, side * 0.075])
            top = np.array([foot[0] + float(rng.uniform(-0.04, 0.04)), height + float(rng.uniform(0.1, 0.32)),
                            side * (0.075 + float(rng.uniform(-0.01, 0.02)))])
            thick = 0.03 + float(rng.uniform(0.0, 0.008))
            kit.tube([foot, (foot + top) * 0.5, top], [thick, thick * 0.92, thick * 0.62], 5, TIMBER,
                     wear=float(rng.uniform(0.4, 0.95)), cap_end=True)
            stakes.append((foot, top))
        # Withy bindings hold each pair of stakes together under the rails they carry.
        for level in (0.32, 0.72, 1.1):
            ends = [foot + (top - foot) * (level - foot[1]) / (top[1] - foot[1]) for foot, top in stakes]
            across = unit(ends[1] - ends[0])
            sag = float(rng.uniform(0.01, 0.03))
            kit.tube([ends[0] - across * 0.02, (ends[0] + ends[1]) * 0.5 - Y * sag, ends[1] + across * 0.02], 0.011, 4,
                     TIMBER, tone=0.25, wear=0.8)
    kit.anchors = dict(section=FENCE_SECTION, start=[-half, 0.0, 0.0], end=[half, 0.0, 0.0], height=height,
                       stakes=[-1.0, 0.0, 1.0])
    return _kit_prop(kit)


PROP_BUILDERS = {
    "cottage": lambda: _kit_prop(cottage.cottage()),
    "shed": lambda: _kit_prop(cottage.shed()),
    "maypole": lambda: _kit_prop(maypole.maypole()),
    "jetty": jetty,
    "rowboat": rowboat,
    "boulder_a": lambda: boulder(11, (1.7, 1.0, 1.3)),
    "boulder_b": lambda: boulder(23, (1.2, 1.15, 1.0)),
    "boulder_c": lambda: boulder(37, (2.3, 0.8, 1.5)),
    "fence": fence,
}
