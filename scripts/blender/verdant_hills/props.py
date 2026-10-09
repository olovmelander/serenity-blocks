"""The props of Verdant Hills, by name.

Each builder returns a `Prop`: arrays (positions, normals, uvs, colours, indices) in glTF
space (metres, +Y up, base at y = 0, +Z the front) and a dictionary of anchor points in the
prop's own metres. Vertex colour and UV conventions are the kit's (see kit.py).

The mill and its sails are modelled in mill.py. Here: the drystone wall (one section that
tiles, and the head that ends a run), the field gate between its stone posts, the bench,
the limestone outcrops, the sheep and the fence post.
"""

import math

import numpy as np

from fall_grove.wood import fbm
from summer_meadow.props import _geodesic

from . import mill
from .kit import IRON, SKIN, STONE, TIMBER, UV_SPAN, WOOL, X, Y, Z, Kit, smooth_normals, unit

WALL_SECTION = 4.0
WALL_BODY = 0.92              # the coursed wall; the cope stones stand on it
WALL_HEIGHT = 1.15
WALL_FOOT = -0.25             # the footing goes this far into the ground
WALL_HALF = (0.3, 0.19)       # half the thickness at the ground and at the top of the body
WALL_COURSES = (WALL_FOOT, 0.18, 0.34, 0.48, 0.61, 0.72, 0.82, WALL_BODY)
HEAD_LENGTH = 0.7
HEAD_OVERLAP = 0.12           # a head is set this far over the end of the run it finishes
GATE_WIDTH = 3.3
GATE_HEIGHT = 1.25
POST_SIZE = 0.45
POST_HEIGHT = 1.5


class Prop:
    def __init__(self, arrays, anchors=None, grounded=True, structure=None, period=None):
        self.arrays = arrays
        self.anchors = anchors or {}
        self.grounded = grounded          # stands on the ground: bake its contact shade
        self.structure = structure        # per vertex: False on trim (see Kit.joinery)
        self.period = period              # tiles along X every `period` metres: bake it between neighbours


def _kit_prop(kit, grounded=True, period=None):
    return Prop(kit.arrays(), kit.anchors, grounded, kit.structure(), period)


def shifted(arrays, offset):
    """A prop's arrays moved by `offset` (for stills of a run of wall)."""
    positions, normals, uvs, colors, indices = arrays
    return positions + np.asarray(offset, dtype=float), normals, uvs, colors, indices


place_sails = mill.place_sails


# -- drystone ------------------------------------------------------------------------------
def _wall_half(height, extra=0.0):
    """Half the wall's thickness at a height: battered from the foot to the top of the body."""
    share = min(max(height / WALL_BODY, WALL_FOOT / WALL_BODY), 1.0)
    return WALL_HALF[0] + (WALL_HALF[1] - WALL_HALF[0]) * share + extra


def _stone(kit, place, outward, cell, shape, clip=None, shift=None):
    """One face stone as real relief: a slightly irregular block standing out of its joints.

    `place(u, y, d)` maps along-the-face, height and depth out of the face to a point.
    `cell` is the stone's bed (u0, u1, y0, y1, and optionally how far its left and right
    joints lean); `shape` holds its four outer corners (u, y, d) from the bottom left round
    to the top left, the depth of the joints and its tone.
    `clip` keeps only the part between two values of u, cut square: the two halves of a
    stone that straddles the end of a section meet exactly when sections stand end to end.
    """
    u0, u1, y0, y1 = cell[:4]
    lean0, lean1 = cell[4:] if len(cell) > 4 else (0.0, 0.0)
    (bl, br, tr, tl), joint, tone = shape
    low, high = clip or (u0, u1)
    shift = np.zeros(3) if shift is None else np.asarray(shift, dtype=float)

    def lerp(a, b, u):
        share = (u - a[0]) / (b[0] - a[0])
        return (u, a[1] + (b[1] - a[1]) * share, a[2] + (b[2] - a[2]) * share)

    cut_left = low > u0 + 1e-9
    cut_right = high < u1 - 1e-9
    face = [lerp(bl, br, low) if cut_left else bl, lerp(bl, br, high) if cut_right else br,
            lerp(tl, tr, high) if cut_right else tr, lerp(tl, tr, low) if cut_left else tl]
    bed = [(low if cut_left else u0 + lean0, y0, -joint), (high if cut_right else u1 + lean1, y0, -joint),
           (high if cut_right else u1 - lean1, y1, -joint), (low if cut_left else u0 - lean0, y1, -joint)]

    def points(corners):
        return [place(*corner) + shift for corner in corners]

    kit.poly(points(face), outward, STONE, tone=tone, grain=Y)
    kit.poly(points([bed[0], bed[1], face[1], face[0]]), outward - Y * 2.0, STONE, tone=tone * 0.8, grain=Y)
    kit.poly(points([face[3], face[2], bed[2], bed[3]]), outward + Y * 2.0, STONE, tone=tone, grain=Y)
    along = place(1.0, 0.0, 0.0) - place(0.0, 0.0, 0.0)
    if not cut_left:
        kit.poly(points([bed[0], face[0], face[3], bed[3]]), outward - along * 2.0, STONE, tone=tone * 0.85, grain=Y)
    if not cut_right:
        kit.poly(points([face[1], bed[1], bed[2], face[2]]), outward + along * 2.0, STONE, tone=tone * 0.85, grain=Y)


def _shape(rng, cell, relief=(0.0, 0.05), joint=0.03, rough=1.0):
    """A stone's outer face inside its bed: inset by half a joint, its corners out of true.

    A corner strays by less than the inset, so the face stays inside its bed and no bevel
    between the two is folded inside out.
    """
    u0, u1, y0, y1 = cell[:4]
    lean0, lean1 = cell[4:] if len(cell) > 4 else (0.0, 0.0)
    gap = float(rng.uniform(0.01, 0.024))
    proud = float(rng.uniform(*relief))
    corners = []
    for u, y in ((u0 + lean0 + gap, y0 + gap), (u1 + lean1 - gap, y0 + gap), (u1 - lean1 - gap, y1 - gap),
                 (u0 - lean0 + gap, y1 - gap)):
        stray = gap * rough
        corners.append((u + float(rng.uniform(-0.6, 0.6)) * stray, y + float(rng.uniform(-0.45, 0.45)) * stray,
                        proud + float(rng.uniform(-0.02, 0.02)) * rough))
    return corners, joint, float(rng.uniform(0.25, 1.0))


def _course_joints(rng, low, high, lengths, below=(), margin=0.08, crossing=0.05):
    """Where the upright joints of one course fall along a section that tiles from `low` to `high`.

    They are laid in order from the low end. Exactly one stone crosses the end of the
    section, the one from the last joint to the first joint of the next section, with at
    least `margin` of it on either side: it is cut there, and the cut must pass through the
    flat of its face. Where it can, a joint is kept `crossing` off the joints of the course
    below (a waller crosses every joint).
    """
    shortest, longest = lengths
    period = high - low

    def clearance(value):
        return min([abs((value - other + period * 0.5) % period - period * 0.5) for other in below] + [1.0])

    def choose(candidates):
        best, found = candidates[0], -1.0
        for value in candidates:
            distance = clearance(value)
            if distance > found:
                best, found = value, distance
            if distance > crossing:
                break
        return best

    joints = [choose([low + margin + float(rng.uniform(0.0, 1.0)) * (longest - 2.0 * margin) for _ in range(24)])]
    end = joints[0] + period
    limit = high - margin
    while end - joints[-1] > longest:
        last = joints[-1]
        top = min(last + longest, end - shortest, limit)
        drawn = [last + float(rng.uniform(shortest, max(shortest, top - last))) for _ in range(48)]
        # Leave room for the stone that crosses the end: it starts before `limit`, and it is no
        # longer than any other.
        fitting = [value for value in drawn if value <= limit - shortest or end - value <= longest]
        joints.append(choose(fitting) if fitting else min(top, last + shortest))
    return joints


def _copes(kit, rng, start, end, base, half, heights=(0.2, 0.27), shoulders=(0.1, 0.17), thickness=(0.075, 0.125)):
    """A row of cope stones set on edge across the top of a wall, from `start` to `end` along X."""
    edges = [start]
    while edges[-1] < end - thickness[0]:
        edges.append(edges[-1] + float(rng.uniform(*thickness)))
    edges = np.array(edges)
    edges = start + (edges - start) * (end - start) / (edges[-1] - start)
    for first, second in zip(edges, edges[1:]):
        tone = float(rng.uniform(0.25, 1.0))
        lean = float(rng.uniform(-0.1, 0.1))
        peak = float(rng.uniform(*heights))
        offset = float(rng.uniform(-0.05, 0.05))
        reach = half + float(rng.uniform(0.0, 0.03))
        outline = [(-reach, 0.0), (reach, 0.0), (reach + 0.008, float(rng.uniform(*shoulders))), (offset, peak),
                   (-reach - 0.008, float(rng.uniform(*shoulders)))]

        def corner(x, point):
            return np.array([x + lean * point[1], base + point[1], point[0]])

        near = [corner(first + 0.005, point) for point in outline]
        far = [corner(second - 0.005, point) for point in outline]
        kit.poly(near, -X, STONE, tone=tone * 0.85, grain=Y)
        kit.poly(far, X, STONE, tone=tone * 0.85, grain=Y)
        for index in (1, 2, 3, 4):
            following = (index + 1) % 5
            middle = (np.array(outline[index]) + np.array(outline[following])) * 0.5
            kit.poly([near[index], far[index], far[following], near[following]],
                     np.array([0.0, middle[1] - 0.05, middle[0]]), STONE, tone=tone, grain=X)


def _lichen(seed, foot=0.4):
    """Wear on stone: lichen in patches, most on the tops of stones, and moss at the foot."""
    def rule(positions, normals, codes, wear):
        patches = np.clip((fbm(positions, 1.5, 3, seed) - 0.4) * 3.0, 0.0, 1.0)
        fine = fbm(positions, 5.0, 2, seed + 3)
        upward = np.clip(normals[:, 1], 0.0, 1.0)
        moss = np.clip(1.0 - positions[:, 1] / foot, 0.0, 1.0) * 0.8
        grown = np.clip(patches * (0.35 + 0.65 * upward) * (0.6 + 0.8 * fine) + moss * (0.5 + 0.5 * fine), 0.0, 1.0)
        return np.where(codes == STONE, np.maximum(wear, grown), wear)
    return rule


def wall():
    """Four metres of drystone wall along X that tile end to end.

    Double-faced and battered: seven courses a side, the stones thinner toward the top and
    every one its own block; a stone that crosses the end of the section is cut there and
    its other half comes back in at the far end. A row of cope stones stands on edge on top.
    """
    kit = Kit(8307)
    rng = kit.rng
    half = WALL_SECTION * 0.5
    for side in (1.0, -1.0):
        outward = Z * side
        below = ()
        for index, (y0, y1) in enumerate(zip(WALL_COURSES, WALL_COURSES[1:])):
            size = 1.2 - 0.07 * index

            def place(u, y, d, side=side):
                return np.array([u, y, side * (_wall_half(y) + d)])

            joints = _course_joints(rng, -half, half, (0.17 * size, 0.42 * size), below)
            leans = [float(rng.uniform(-0.03, 0.03)) for _ in joints]
            below = joints
            for stone, (u0, u1) in enumerate(zip(joints, joints[1:] + [joints[0] + WALL_SECTION])):
                cell = (u0, u1, y0, y1, leans[stone], leans[(stone + 1) % len(joints)])
                shape = _shape(rng, cell)
                if u1 <= half:
                    _stone(kit, place, outward, cell, shape)
                else:
                    # The stone that straddles the end: cut it, and bring the rest in at the other end.
                    _stone(kit, place, outward, cell, shape, clip=(u0, half))
                    _stone(kit, place, outward, cell, shape, clip=(half, u1), shift=(-WALL_SECTION, 0.0, 0.0))
    _copes(kit, rng, -half, half, WALL_BODY, WALL_HALF[1] + 0.012)
    kit.weather(_lichen(53))
    kit.anchors = dict(section=WALL_SECTION, start=[-half, 0.0, 0.0], end=[half, 0.0, 0.0], height=WALL_HEIGHT,
                       bodyHeight=WALL_BODY, footThickness=WALL_HALF[0] * 2.0, topThickness=WALL_HALF[1] * 2.0,
                       footing=WALL_FOOT)
    return _kit_prop(kit, period=WALL_SECTION)


def wall_head():
    """The stopped end of a wall: a stout pier of big stones, 0.7 m long.

    It is a hand thicker than the wall and a little taller, and is set `overlap` metres over the end
    of a run (its origin on the run's last plane, +X pointing away from the run), so the cut
    stones of the last section end inside it. Turn it half round for the other end.
    """
    kit = Kit(8401)
    rng = kit.rng
    extra = 0.075
    start, end = -HEAD_OVERLAP, HEAD_LENGTH - HEAD_OVERLAP
    courses = (WALL_FOOT, 0.24, 0.47, 0.66, 0.82, WALL_BODY + 0.04)
    for index, (y0, y1) in enumerate(zip(courses, courses[1:])):
        # Long and short alternate up the corner, as quoins do.
        turn = start + (0.42 if index % 2 else 0.24)
        for side in (1.0, -1.0):
            def place(u, y, d, side=side):
                return np.array([u, y, side * (_wall_half(y, extra) + d)])

            for u0, u1 in ((start, turn), (turn, end)):
                cell = (u0, u1, y0, y1)
                _stone(kit, place, Z * side, cell, _shape(rng, cell, relief=(0.01, 0.04), rough=0.5))

        def cheek(u, y, d):
            return np.array([end + d, y, u * _wall_half(y, extra)])

        splits = (-1.0, 1.0) if index % 2 else (-1.0, float(rng.uniform(-0.25, 0.25)), 1.0)
        for u0, u1 in zip(splits, splits[1:]):
            # The cheek's stones are laid out in shares of the wall's thickness; their joints are in metres.
            cell = (u0, u1, y0, y1)
            corners, joint, tone = _shape(rng, cell, relief=(0.01, 0.04), rough=0.5)
            gap = 0.05
            corners = [(max(min(u, u1 - gap), u0 + gap), y, d) for u, y, d in corners]
            _stone(kit, cheek, X, cell, (corners, joint, tone))
    top = courses[-1]
    half = _wall_half(top, extra) + 0.015
    _copes(kit, rng, start, end - 0.2, top, half, heights=(0.2, 0.26))
    # The end cope: one big flat stone lying across the head.
    slab = [np.array([end - 0.2, top, -half - 0.02]), np.array([end + 0.04, top, -half - 0.02]),
            np.array([end + 0.04, top, half + 0.02]), np.array([end - 0.2, top, half + 0.02])]
    rise = np.array([-0.01, 0.2, 0.0])
    lid = [corner + rise + np.array([0.0, float(rng.uniform(-0.02, 0.02)), 0.0]) * 1.0 for corner in slab]
    tone = float(rng.uniform(0.5, 0.9))
    kit.poly(lid, Y, STONE, tone=tone, grain=Z)
    for index, facing in enumerate((-Z, X, Z, -X)):
        following = (index + 1) % 4
        kit.poly([slab[index], slab[following], lid[following], lid[index]], facing, STONE, tone=tone * 0.85, grain=Y)
    kit.weather(_lichen(59))
    kit.anchors = dict(join=[0.0, 0.0, 0.0], end=[end, 0.0, 0.0], overlap=HEAD_OVERLAP, length=HEAD_LENGTH,
                       height=top + 0.2)
    return _kit_prop(kit)


# -- the field gate ------------------------------------------------------------------------
def _gatepost(kit, x):
    """A dressed stone gatepost: square, a little tapered, with a low pyramid cap."""
    rng = kit.rng
    half = POST_SIZE * 0.5
    top = half - 0.012
    shoulder = POST_HEIGHT - 0.09
    tone = kit.part_tone(0.5, 0.9)
    low = [np.array([x + sx * half, -0.3, sz * half]) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    high = [np.array([x + sx * top, shoulder, sz * top]) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    crown = [np.array([x + sx * top * 0.42, POST_HEIGHT, sz * top * 0.42])
             for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for index, facing in enumerate((-Z, X, Z, -X)):
        following = (index + 1) % 4
        shade = tone * float(rng.uniform(0.85, 1.0))
        # Two lifts of stone to a post: a bed joint shows as a change of tone half way up.
        middle = [low[index] + (high[index] - low[index]) * 0.52,
                  low[following] + (high[following] - low[following]) * 0.52]
        kit.poly([low[index], low[following], middle[1], middle[0]], facing, STONE, tone=shade, grain=Y)
        kit.poly([middle[0], middle[1], high[following], high[index]], facing, STONE,
                 tone=shade * float(rng.uniform(0.8, 0.95)), grain=Y)
        kit.poly([high[index], high[following], crown[following], crown[index]], facing + Y * 1.5, STONE, tone=shade,
                 grain=Y)
    kit.poly(crown, Y, STONE, tone=tone, grain=X)
    return [x, POST_HEIGHT, 0.0]


def gate():
    """A five-bar field gate hung between two dressed stone posts.

    The gate lies along X, 3.3 m wide and 1.25 m to its top bar, closed, hinged on the
    left post (-X) and latched on the right. Its bars are closer together low down, a
    brace runs from the foot of the hanging stile to the top of the shutting stile, and
    two uprights tie the bars.
    """
    kit = Kit(8503)
    rng = kit.rng
    half = GATE_WIDTH * 0.5
    clear = 0.05
    centre = half + clear + POST_SIZE * 0.5
    left = _gatepost(kit, -centre)
    right = _gatepost(kit, centre)
    foot = 0.16
    # The hanging stile is the heavy one and stands above the top bar; the shutting stile is lighter.
    kit.box([-half, foot - 0.04, -0.04], [-half + 0.1, GATE_HEIGHT + 0.12, 0.04], TIMBER, tone=kit.part_tone(0.4, 0.8),
            wear=0.7, grain=Y)
    kit.box([half - 0.075, foot - 0.02, -0.035], [half, GATE_HEIGHT + 0.03, 0.035], TIMBER,
            tone=kit.part_tone(0.4, 0.8), wear=0.7, grain=Y)
    levels = (foot + 0.05, 0.4, 0.62, 0.89, GATE_HEIGHT - 0.055)
    for index, level in enumerate(levels):
        top = index == len(levels) - 1
        depth = 0.11 if top else 0.085
        thick = 0.06 if top else 0.028
        kit.bar([-half + 0.1, level, 0.0], [half - 0.075, level + float(rng.uniform(-0.006, 0.006)), 0.0], thick, depth,
                TIMBER, skip=("start", "end"), tone=kit.part_tone(0.35, 0.9), wear=float(rng.uniform(0.55, 0.95)))
    with kit.joinery():
        # The brace and the uprights lie on the front of the bars.
        kit.bar([-half + 0.07, foot + 0.03, 0.03], [half - 0.1, GATE_HEIGHT - 0.06, 0.03], 0.022, 0.08, TIMBER,
                up=Z, skip=("start", "end", "bottom"), tone=kit.part_tone(0.35, 0.8), wear=0.8)
        for x in (-half + GATE_WIDTH * 0.36, -half + GATE_WIDTH * 0.68):
            kit.bar([x, foot + 0.01, 0.03], [x, GATE_HEIGHT - 0.01, 0.03], 0.07, 0.022, TIMBER, up=Z,
                    skip=("bottom",), tone=kit.part_tone(0.35, 0.8), wear=0.8)
        # Iron: two strap hinges on hooks let into the post, and a spring latch with its catch.
        for level in (levels[0] + 0.02, levels[-1]):
            kit.box([-half - clear - 0.01, level - 0.022, 0.04], [-half + 0.42, level + 0.022, 0.048], IRON, tone=0.4,
                    wear=0.6, grain=X)
            kit.tube([(-half - clear * 0.5, level - 0.06, 0.03), (-half - clear * 0.5, level + 0.06, 0.03)], 0.014, 5,
                     IRON, tone=0.3, wear=0.7, cap_start=True, cap_end=True)
        kit.box([half - 0.3, 0.95, 0.035], [half + clear + 0.02, 0.98, 0.047], IRON, tone=0.4, wear=0.5, grain=X)
        kit.box([half + clear - 0.004, 0.9, 0.0], [half + clear + 0.03, 1.03, 0.06], IRON, tone=0.3, wear=0.7, grain=Y)
    kit.weather(_lichen(61, foot=0.3))
    kit.anchors = dict(hinge=[-half - clear * 0.5, GATE_HEIGHT * 0.5 + foot * 0.5, 0.03], hingeAxis=[0.0, 1.0, 0.0],
                       latch=[half + clear * 0.5, 0.965, 0.04], postLeft=left, postRight=right,
                       width=GATE_WIDTH, height=GATE_HEIGHT, opening=2.0 * (half + clear), postSize=POST_SIZE,
                       bars=list(levels))
    return _kit_prop(kit)


# -- bench and post ------------------------------------------------------------------------
def bench():
    """A weathered oak bench, 1.8 m long: a plank seat and a plank back on two end frames.

    You sit facing +Z; the back leans away toward -Z.
    """
    kit = Kit(8601)
    rng = kit.rng
    half = 0.9
    seat = 0.45
    lean = math.radians(12.0)
    back = np.array([0.0, math.cos(lean), -math.sin(lean)])
    for x in (-0.74, 0.74):
        tone = kit.part_tone(0.35, 0.8)
        # Front leg, and the back leg that carries on up as the post of the back.
        kit.box([x - 0.035, -0.08, 0.14], [x + 0.035, seat - 0.035, 0.21], TIMBER, skip=("-y",), tone=tone, wear=0.75,
                grain=Y)
        foot = np.array([x, -0.08, -0.2])
        kit.bar(foot, np.array([x, seat - 0.035, -0.2]), 0.07, 0.07, TIMBER, up=Z, skip=("start", "end"), tone=tone,
                wear=0.75)
        kit.bar(np.array([x, seat - 0.035, -0.2]), np.array([x, seat - 0.035, -0.2]) + back * 0.5, 0.07, 0.06, TIMBER,
                up=Z, skip=("start",), tone=tone, wear=0.75)
        # The rail under the seat that ties the two legs.
        kit.box([x - 0.03, seat - 0.115, -0.2], [x + 0.03, seat - 0.035, 0.21], TIMBER, skip=("+y",), tone=tone * 0.9,
                wear=0.7, grain=Z)
    kit.box([-0.74, 0.16, -0.03], [0.74, 0.22, 0.02], TIMBER, tone=kit.part_tone(0.35, 0.8), wear=0.7, grain=X)
    # Three planks to sit on, with the gaps that let the rain through.
    for index in range(3):
        z0 = -0.215 + index * 0.148
        kit.box([-half + float(rng.uniform(-0.01, 0.01)), seat - 0.035, z0],
                [half + float(rng.uniform(-0.01, 0.01)), seat + float(rng.uniform(-0.003, 0.003)), z0 + 0.138], TIMBER,
                tone=kit.part_tone(0.4, 1.0), wear=float(rng.uniform(0.6, 0.95)), grain=X)
    # Two planks to lean on, on the front of the posts.
    hinge = np.array([0.0, seat - 0.035, -0.2])
    out = np.array([0.0, math.sin(lean), math.cos(lean)])
    for low, high in ((0.2, 0.32), (0.36, 0.5)):
        corners = [np.array([-half, 0.0, 0.0]) + hinge + back * low + out * 0.058,
                   np.array([half, 0.0, 0.0]) + hinge + back * low + out * 0.058,
                   np.array([half, 0.0, 0.0]) + hinge + back * high + out * 0.058,
                   np.array([-half, 0.0, 0.0]) + hinge + back * high + out * 0.058]
        kit.slab(corners, 0.028, TIMBER, tone=kit.part_tone(0.4, 1.0), wear=float(rng.uniform(0.6, 0.95)))
    kit.anchors = dict(seat=[0.0, seat, 0.0], length=2.0 * half, seatHeight=seat, backTop=[0.0, 0.905, -0.3])
    return _kit_prop(kit)


def post():
    """One weathered fence post, 1.3 m out of the ground and 12 cm thick: riven oak, its head worn round."""
    kit = Kit(8701)
    path = [(0.0, -0.4, 0.0), (0.004, 0.2, -0.003), (-0.004, 0.75, 0.004), (0.003, 1.22, 0.0), (0.0, 1.3, 0.0)]
    kit.tube(path, [0.064, 0.062, 0.06, 0.056, 0.03], 6, TIMBER, tone=0.55, wear=0.8, cap_end=True, lumpy=0.09)

    def weather(positions, normals, codes, wear):
        return np.clip(0.55 + 0.4 * fbm(positions, 3.0, 2, 71) + 0.25 * (positions[:, 1] > 1.1), 0.0, 1.0)

    kit.weather(weather)
    kit.anchors = dict(top=[0.0, 1.3, 0.0], tie=[0.0, 1.16, 0.0], thickness=0.12, height=1.3)
    return _kit_prop(kit)


# -- limestone -----------------------------------------------------------------------------
def outcrop(seed, size, frequency=6, bed=0.24):
    """A limestone outcrop bedded in the turf: a sphere pushed about by noise (the Golden
    Forest's boulder), then gathered onto level beds and planed off on top, as limestone
    weathers along its bedding into ledges and a flat pavement. Wear is lichen and moss.
    """
    directions, faces = _geodesic(frequency)
    lumps = fbm(directions * 1.3 + seed, 1.0, 3, seed)
    facets = fbm(directions * 3.4 + seed, 1.0, 2, seed + 9)
    radius = 0.72 + 0.42 * lumps + 0.14 * facets
    positions = directions * radius[:, None] * np.asarray(size, dtype=float) * 0.5
    height = positions[:, 1]
    step = bed * float(size[1])
    ledge = np.round(height / step) * step
    positions[:, 1] = np.where(height > 0, height + (ledge - height) * 0.7, height * 0.45)
    crest = float(positions[:, 1].max())
    plane = crest * (0.8 + 0.12 * fbm(positions, 1.1, 2, seed + 13))
    positions[:, 1] = np.minimum(positions[:, 1], plane)
    faces = faces.copy()
    outward = np.cross(positions[faces[:, 1]] - positions[faces[:, 0]], positions[faces[:, 2]] - positions[faces[:, 0]])
    inside = np.einsum("ij,ij->i", outward, positions[faces].mean(axis=1)) < 0
    faces[inside] = faces[inside][:, [0, 2, 1]]
    normals = smooth_normals(positions, faces)
    colors = np.zeros((len(positions), 4))
    colors[:, 0] = np.clip(0.35 + 0.65 * fbm(positions, 0.9, 3, seed + 3), 0.0, 1.0)
    colors[:, 1] = STONE / 16.0
    colors[:, 2] = 1.0
    lichen = fbm(positions, 1.7, 3, seed + 5)
    moss = np.clip(1.0 - positions[:, 1] / (0.3 * float(size[1])), 0.0, 1.0) * 0.6
    colors[:, 3] = np.clip(np.clip((lichen - 0.4) * 3.2, 0.0, 1.0) * np.clip(normals[:, 1] * 1.4 + 0.25, 0.0, 1.0)
                           + moss * (0.4 + 0.6 * lichen), 0.0, 1.0)
    uvs = np.stack([0.5 + positions[:, 0] / UV_SPAN, 0.5 + positions[:, 2] / UV_SPAN], axis=1)
    return Prop((positions, normals, uvs, colors, faces.reshape(-1)), dict(top=[0.0, crest * 0.8, 0.0]))


# -- sheep ---------------------------------------------------------------------------------
def sheep(seed, grazing=False):
    """A stylised downland sheep about a metre long, facing +Z.

    A lumpy fleece (never a smooth ellipsoid: it is seen in silhouette from a hundred
    metres), a dark face, ears and legs. Standing with its head up, or grazing with its
    muzzle in the grass.
    """
    kit = Kit(seed)
    rng = kit.rng
    body, body_faces = _geodesic(4)
    small, small_faces = _geodesic(2)

    def fleece(directions, scale, grain, offset):
        lumps = fbm(directions * grain + offset, 1.0, 2, seed + int(offset))
        return 1.0 + scale * (2.0 * lumps - 1.0), lumps

    centre = np.array([0.0, 0.57, -0.03])
    swell, lumps = fleece(body, 0.17, 2.3, 3.0)
    swell = swell * np.where(body[:, 1] < -0.55, 0.9, 1.0) * (1.0 + 0.08 * np.clip(body[:, 2], 0.0, 1.0))

    def wool_tone(amount):
        return np.clip(0.35 + 0.65 * amount, 0.0, 1.0)

    def soil(positions):
        """Soiled fleece: under the belly and round the breech."""
        under = np.clip((0.6 - positions[:, 1]) / 0.26, 0.0, 1.0)
        breech = np.clip((-positions[:, 2] - 0.28) / 0.2, 0.0, 1.0) * np.clip((0.75 - positions[:, 1]) / 0.3, 0.0, 1.0)
        return np.clip(under * 0.8 + breech * 0.7, 0.0, 1.0)

    kit.lump(body, body_faces, centre, (0.27, 0.28, 0.45), WOOL, tone=wool_tone(lumps), wear=0.0, swell=swell)
    # Legs: dark and thin under all that wool.
    for x, z in ((-0.13, 0.26), (0.13, 0.26), (-0.13, -0.3), (0.13, -0.3)):
        knee = float(rng.uniform(-0.015, 0.015))
        kit.tube([(x * 0.9, 0.46, z), (x, 0.2, z + knee), (x, 0.0, z + knee * 0.5)], [0.052, 0.032, 0.036], 5, SKIN,
                 tone=kit.part_tone(0.2, 0.7), cap_end=True)
    # The woolly neck, then the bare dark head.
    if grazing:
        neck_centre, neck_radii, neck_lean = (0.0, 0.42, 0.43), (0.125, 0.2, 0.15), -0.35
        head_centre, head_radii, nose = np.array([0.0, 0.19, 0.57]), (0.08, 0.15, 0.095), np.array([0.0, -1.0, 0.3])
        droop = 0.0
    else:
        neck_centre, neck_radii, neck_lean = (0.0, 0.8, 0.36), (0.135, 0.19, 0.15), 0.45
        head_centre, head_radii, nose = np.array([0.0, 0.92, 0.52]), (0.08, 0.092, 0.165), np.array([0.0, -0.4, 1.0])
        droop = 0.4
    swell, lumps = fleece(small, 0.14, 2.0, 7.0)
    # The neck leans from the shoulders toward the head; the muzzle hangs below the line of the skull.
    kit.lump(small, small_faces, neck_centre, neck_radii, WOOL, tone=wool_tone(lumps), wear=0.0, swell=swell,
             shear=(2, 1, neck_lean))
    nose = unit(nose)
    taper = 1.0 - 0.3 * np.clip(small @ nose, 0.0, 1.0)      # the muzzle narrows
    kit.lump(small, small_faces, head_centre, head_radii, SKIN, tone=kit.part_tone(0.3, 0.6), swell=taper,
             shear=(1, 2, -droop))
    side_axis = X
    up_axis = unit(np.cross(nose, side_axis))
    if up_axis[1] < 0 and not grazing:
        up_axis = -up_axis
    crown = head_centre - nose * (0.08 if not grazing else 0.09)
    for side in (-1.0, 1.0):
        root = crown + side_axis * side * 0.07 + up_axis * (0.04 if not grazing else -0.02)
        tip = root + side_axis * side * 0.11 - Y * 0.035
        blade = [root - nose * 0.03, tip, root + nose * 0.03]
        kit.poly(blade, Y, SKIN, tone=0.5)
        kit.poly(blade, -Y, SKIN, tone=0.35)
    kit.weather(lambda positions, normals, codes, wear: np.where(codes == WOOL, soil(positions), 0.0))
    muzzle = head_centre + nose * (head_radii[2] if not grazing else head_radii[1])
    kit.anchors = dict(head=[float(value) for value in head_centre], muzzle=[float(value) for value in muzzle],
                       back=[0.0, float(centre[1] + 0.28), 0.0], grazing=bool(grazing))
    return _kit_prop(kit)


PROP_BUILDERS = {
    "windmill": lambda: _kit_prop(mill.windmill()),
    "windmill_sails": lambda: _kit_prop(mill.windmill_sails(), grounded=False),
    "wall": wall,
    "wall_head": wall_head,
    "gate": gate,
    "bench": bench,
    "boulder_a": lambda: outcrop(11, (2.3, 1.1, 1.6), frequency=6),
    "boulder_b": lambda: outcrop(23, (1.45, 0.95, 1.15), frequency=5),
    "boulder_c": lambda: outcrop(37, (0.95, 0.6, 0.8), frequency=4),
    "sheep_a": lambda: sheep(8801, grazing=False),
    "sheep_b": lambda: sheep(8803, grazing=True),
    "post": post,
}
