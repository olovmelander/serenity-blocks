"""The tower mill of Verdant Hills and its sails.

An English tower mill: a tapering round tower of limewashed masonry on a low stone plinth,
a timber stage (the reefing gallery) round it at first-floor height, small windows deep in
the thick wall, and a tarred, boat-shaped ogee cap that turns to face the wind. The sails
are a separate prop: four common sails, each a whip carrying a lattice of sail bars and
laths with canvas spread over its outer two thirds.

The tower stands on the origin with its door toward +Z. Angles round it are measured from
+Z toward +X. The sails are built flat in the XY plane about the origin and turn about +Z;
the runtime sets them on the mill's `hub` anchor facing along its `axis`.
"""

import math

import numpy as np

from fall_grove.wood import fbm
from summer_meadow.props import _geodesic

from .kit import CANVAS, DOOR, GLASS, IRON, LIMEWASH, STONE, TAR, TIMBER, UV_SPAN, WHITE, X, Y, Z, Kit, patchy, unit

CURB = 11.5                    # where the tower ends and the cap begins
BASE_RADIUS = 3.1              # 6.2 m across at the ground
TOP_RADIUS = 1.95              # 3.9 m across at the curb
FOOT = -0.3                    # the plinth goes this far into the ground
PLINTH = 0.38
STAGE = 3.6                    # deck of the reefing gallery
STAGE_WIDTH = 1.15
CAP_BASE = CURB + 0.08
CAP_RISE = 2.55                # the boarded cap; the finial stands on it
CAP_HALF = (2.22, 2.72)        # half the cap across (X) and along the windshaft (Z): a boat, not a dome
SHAFT_TILT = math.radians(8.0)
HUB = np.array([0.0, CURB + 1.25, 3.05])
SAIL_RADIUS = 9.2
SAIL_WIDTH = 1.9
SAIL_LEAD = 0.36               # how much of that width is the leading board, ahead of the whip
BATTER = math.atan2(BASE_RADIUS - TOP_RADIUS, CURB)
SEAM = math.radians(-135.0)    # where the wash's texture seam runs up the tower: clear of every opening
PANE_UVS = np.array([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
# (angle in degrees, sill height, width, height) of the windows that climb the tower.
WINDOWS = ((0.0, 5.05, 0.56, 0.82), (0.0, 9.1, 0.5, 0.72), (90.0, 1.6, 0.56, 0.82), (90.0, 7.05, 0.52, 0.76),
           (-90.0, 7.05, 0.52, 0.76), (180.0, 4.7, 0.56, 0.82))
DOOR_SIZE = (1.15, 2.2)
WALL = 0.3                     # how deep the openings are set into the masonry


def radius_at(height):
    return BASE_RADIUS + (TOP_RADIUS - BASE_RADIUS) * height / CURB


def radial(theta):
    return np.array([math.sin(theta), 0.0, math.cos(theta)])


def ring(theta, height, out=0.0):
    """A point on the tower's face (or `out` metres off it) at an angle and a height."""
    return radial(theta) * (radius_at(height) + out) + Y * height


def cyl(theta, reach, height):
    return radial(theta) * reach + Y * height


def wall_normal(theta):
    return radial(theta) * math.cos(BATTER) + Y * math.sin(BATTER)


class Opening:
    """A hole through the tower's face: a window or the door."""

    def __init__(self, degrees, sill, width, height):
        self.theta = math.radians(degrees)
        self.low, self.high = sill, sill + height
        self.width, self.height = width, height
        self.half = width * 0.5 / radius_at(sill + height * 0.5)
        self.right = np.array([math.cos(self.theta), 0.0, -math.sin(self.theta)])
        self.normal = wall_normal(self.theta)
        # The four corners on the face and the four at the back of the reveal (left to right, low to high).
        self.face = [ring(self.theta + side * self.half, level) for level in (self.low, self.high) for side in (-1, 1)]
        self.deep = [ring(self.theta + side * self.half, level, -WALL) for level in (self.low, self.high)
                     for side in (-1, 1)]

    def holds(self, theta, height):
        turn = math.atan2(math.sin(theta - self.theta), math.cos(theta - self.theta))
        return abs(turn) < self.half - 1e-6 and self.low + 1e-6 < height < self.high - 1e-6

    def at(self, across, up, lift=0.0):
        """A point of the back of the reveal: `across` and `up` run 0..1, `lift` comes out of it."""
        a, b, c, d = self.deep
        low = a + (b - a) * across
        high = c + (d - c) * across
        return low + (high - low) * up + self.normal * lift

    def centre(self, lift=0.0):
        return self.at(0.5, 0.5, lift)


def _lines(base, wanted, gap):
    """Grid lines: every `wanted` one, and those of `base` that stand clear of them."""
    lines = sorted(set(round(float(value), 6) for value in wanted))
    for value in base:
        if all(abs(value - kept) > gap for kept in lines):
            lines.append(float(value))
    return sorted(lines)


def _compact(positions, normals, uvs, triangles):
    """Drop the vertices no triangle uses (the grid points inside an opening)."""
    used = np.zeros(len(positions), dtype=bool)
    used[triangles.reshape(-1)] = True
    remap = np.cumsum(used) - 1
    return positions[used], normals[used], uvs[used], remap[triangles]


def _tower(kit, openings):
    """The limewashed face of the tower as one smooth sheet with the openings cut out of it."""
    edges = []
    for opening in openings:
        for side in (-1, 1):
            theta = opening.theta + side * opening.half
            edges.append(SEAM + (theta - SEAM) % math.tau)
    thetas = _lines(np.linspace(SEAM, SEAM + math.tau, 33), [SEAM, SEAM + math.tau] + edges, 0.045)
    levels = [PLINTH, CURB, STAGE - 0.5, STAGE - 0.08, STAGE + 0.12, CURB - 0.5, 0.95]
    for opening in openings:
        levels.extend((max(opening.low, PLINTH), opening.high))
    heights = _lines(np.linspace(PLINTH, CURB, 12), levels, 0.11)
    positions = np.array([ring(theta, height) for height in heights for theta in thetas])
    normals = np.array([wall_normal(theta) for _height in heights for theta in thetas])
    # Laid out flat in metres: u round the tower at its own radius, v up it.
    uvs = np.array([(0.5 + (theta - SEAM - math.pi) * radius_at(height) / UV_SPAN,
                     0.5 + (height - CURB * 0.5) / UV_SPAN) for height in heights for theta in thetas])
    columns = len(thetas)
    triangles = []
    for row in range(len(heights) - 1):
        for column in range(columns - 1):
            theta = (thetas[column] + thetas[column + 1]) * 0.5
            height = (heights[row] + heights[row + 1]) * 0.5
            if any(opening.holds(theta, height) for opening in openings):
                continue
            a = row * columns + column
            triangles.extend(((a, a + 1, a + columns), (a + 1, a + columns + 1, a + columns)))
    positions, normals, uvs, triangles = _compact(positions, normals, uvs, np.array(triangles))
    kit.mesh(positions, triangles, normals, uvs, LIMEWASH, tone=patchy(kit.seed + 3, 0.45, 0.45, 1.0))


def _reveal(kit, opening, tone=0.62):
    """The four sides of an opening, back through the thickness of the wall."""
    a, b, c, d = opening.face
    e, f, g, h = opening.deep
    kit.poly([a, e, g, c], opening.right, LIMEWASH, tone=tone, grain=Y)
    kit.poly([b, f, h, d], -opening.right, LIMEWASH, tone=tone, grain=Y)
    kit.poly([c, d, h, g], -Y, LIMEWASH, tone=tone, grain=opening.right)
    return a, b, e, f


def _window(kit, opening):
    a, b, e, f = _reveal(kit, opening)
    # A sloping stone sill, standing a little proud of the wash.
    lip = opening.normal * 0.05 - Y * 0.05
    kit.poly([e + Y * 0.035, f + Y * 0.035, b + lip, a + lip], Y, STONE, tone=kit.part_tone(0.5, 0.9), wear=0.3)
    kit.poly([a + lip, b + lip, b - Y * 0.11, a - Y * 0.11], opening.normal, STONE, tone=kit.part_tone(0.5, 0.9),
             wear=0.4)
    kit.poly(opening.deep[:2] + opening.deep[:1:-1], opening.normal, GLASS, tone=kit.part_tone(0.2, 1.0),
             uvs=PANE_UVS)
    # A white frame with one mullion and one transom: four panes.
    stile = 0.055 / opening.width
    rail = 0.055 / opening.height
    with kit.joinery():
        tone = kit.part_tone(0.75, 1.0)
        wear = float(kit.rng.uniform(0.1, 0.5))
        for (u0, u1, v0, v1), lift in (((0.0, stile, 0.0, 1.0), 0.04), ((1.0 - stile, 1.0, 0.0, 1.0), 0.04),
                                       ((stile, 1.0 - stile, 0.0, rail), 0.04),
                                       ((stile, 1.0 - stile, 1.0 - rail, 1.0), 0.04),
                                       ((0.5 - stile * 0.3, 0.5 + stile * 0.3, rail, 1.0 - rail), 0.03),
                                       ((stile, 1.0 - stile, 0.5 - rail * 0.3, 0.5 + rail * 0.3), 0.024)):
            kit.slab([opening.at(u0, v0, lift), opening.at(u1, v0, lift), opening.at(u1, v1, lift),
                      opening.at(u0, v1, lift)], lift - 0.002, WHITE, tone=tone, wear=wear, skip=("back",))


def _door(kit, opening):
    """A ledged plank door deep in the wall, on iron strap hinges, over a stone step."""
    _reveal(kit, opening)
    step = 0.14
    share = step / opening.height

    def foot_wear(positions):
        return np.clip(0.75 - (positions[:, 1] - step) / 1.1, 0.05, 0.75)

    planks = 5
    for index in range(planks):
        u0, u1 = index / planks + 0.004, (index + 1) / planks - 0.004
        kit.poly([opening.at(u0, share), opening.at(u1, share), opening.at(u1, 1.0), opening.at(u0, 1.0)],
                 opening.normal, DOOR, tone=kit.part_tone(0.35, 1.0), wear=foot_wear, grain=Y)
    with kit.joinery():
        for level in (0.16, 0.5, 0.86):
            kit.slab([opening.at(0.03, level - 0.035, 0.022), opening.at(0.97, level - 0.035, 0.022),
                      opening.at(0.97, level + 0.035, 0.022), opening.at(0.03, level + 0.035, 0.022)], 0.022, DOOR,
                     tone=kit.part_tone(0.4, 0.9), wear=0.3, skip=("back",))
        for level in (0.2, 0.82):
            kit.slab([opening.at(0.0, level - 0.018, 0.034), opening.at(0.72, level - 0.012, 0.034),
                      opening.at(0.72, level + 0.012, 0.034), opening.at(0.0, level + 0.018, 0.034)], 0.012, IRON,
                     tone=0.4, wear=0.55, skip=("back",))
        kit.slab([opening.at(0.84, 0.47, 0.03), opening.at(0.9, 0.47, 0.03), opening.at(0.9, 0.53, 0.03),
                  opening.at(0.84, 0.53, 0.03)], 0.03, IRON, tone=0.3, wear=0.4, skip=("back",))
    # The threshold: one worn slab right through the wall, standing out as a step.
    half = opening.width * 0.5 + 0.16
    front = radius_at(0.0) + 0.5
    kit.box([-half, FOOT, radius_at(0.0) - WALL - 0.02], [half, step, front], STONE, skip=("-y", "-z"),
            tone=kit.part_tone(0.5, 0.85), wear=0.35, grain=X)
    # A stone lintel over the door, a finger proud of the wash and following the tower round.
    span = opening.half + 0.2 / radius_at(opening.high)
    low, high = opening.high, opening.high + 0.24
    tone = kit.part_tone(0.55, 0.9)
    for first, second in ((-span, 0.0), (0.0, span)):
        corners = [ring(opening.theta + first, low, 0.035), ring(opening.theta + second, low, 0.035),
                   ring(opening.theta + second, high, 0.035), ring(opening.theta + first, high, 0.035)]
        kit.slab(corners, 0.07, STONE, tone=tone, wear=0.3, skip=("back", "1") if second == 0.0 else ("back", "3"),
                 grain=opening.right)
    return opening.centre()


def _plinth(kit, door):
    """A low ring of dressed stone the tower stands on, broken only by the doorway."""
    proud = 0.09
    edges = [door.theta - door.half, door.theta + door.half]
    thetas = _lines(np.linspace(SEAM, SEAM + math.tau, 33), [SEAM, SEAM + math.tau] + edges, 0.045)
    rows = ((FOOT, proud, radial), (PLINTH - 0.08, proud, radial))
    cap = ((PLINTH - 0.08, proud), (PLINTH, 0.0))
    for index in range(len(thetas) - 1):
        first, second = thetas[index], thetas[index + 1]
        if door.holds((first + second) * 0.5, (door.low + door.high) * 0.5):
            continue
        tone = kit.part_tone(0.4, 0.95)
        positions = [ring(theta, level, out) for level, out, _facing in rows for theta in (first, second)]
        normals = [facing(theta) for _level, _out, facing in rows for theta in (first, second)]
        uvs = [(0.5 + (theta - SEAM - math.pi) * BASE_RADIUS / UV_SPAN, 0.5 + level / UV_SPAN)
               for level, _out, _facing in rows for theta in (first, second)]
        kit.mesh(positions, [(0, 1, 2), (1, 3, 2)], normals, uvs, STONE, tone=tone)
        kit.poly([ring(first, cap[0][0], cap[0][1]), ring(second, cap[0][0], cap[0][1]),
                  ring(second, cap[1][0], cap[1][1]), ring(first, cap[1][0], cap[1][1])],
                 Y + radial((first + second) * 0.5), STONE, tone=tone, grain=Y)
    for side in (-1, 1):
        theta = door.theta + side * door.half
        kit.poly([ring(theta, FOOT, proud), ring(theta, PLINTH - 0.08, proud), ring(theta, PLINTH, 0.0),
                  ring(theta, FOOT, 0.0)], -door.right * side, STONE, tone=0.6, grain=Y)


def _stage(kit):
    """The reefing gallery: a boarded deck on bearers and raking braces, with a post-and-rail fence."""
    inner = radius_at(STAGE) - 0.03
    outer = radius_at(STAGE) + STAGE_WIDTH
    boards = 32
    for index in range(boards):
        first = math.tau * index / boards
        second = math.tau * (index + 1) / boards
        kit.slab([cyl(first, inner, STAGE), cyl(first, outer, STAGE), cyl(second, outer, STAGE),
                  cyl(second, inner, STAGE)], 0.07, TIMBER, tone=kit.part_tone(0.3, 1.0),
                 wear=float(kit.rng.uniform(0.4, 0.95)), skip=("0", "2", "3"))
    posts = 12
    with kit.joinery():
        for index in range(posts):
            theta = math.tau * (index + 0.5) / posts
            tone = kit.part_tone(0.3, 0.8)
            # A bearer under the deck, and the brace that carries its outer end down to the wall.
            kit.bar(cyl(theta, inner - 0.05, STAGE - 0.14), cyl(theta, outer - 0.04, STAGE - 0.14), 0.11, 0.14, TIMBER,
                    skip=("start",), tone=tone, wear=0.6)
            kit.bar(ring(theta, STAGE - 1.55, -0.04), cyl(theta, outer - 0.32, STAGE - 0.2), 0.1, 0.1, TIMBER,
                    skip=("start", "end"), tone=tone, wear=0.6)
            kit.bar(cyl(theta, outer - 0.06, STAGE), cyl(theta, outer - 0.06, STAGE + 1.1), 0.085, 0.085, TIMBER,
                    up=radial(theta), skip=("start",), tone=kit.part_tone(0.35, 0.9), wear=0.7)
            following = math.tau * (index + 1.5) / posts
            for level, width, height in ((1.06, 0.1, 0.06), (0.56, 0.07, 0.045)):
                kit.bar(cyl(theta, outer - 0.06, STAGE + level), cyl(following, outer - 0.06, STAGE + level), width,
                        height, TIMBER, skip=("start", "end"), tone=kit.part_tone(0.35, 0.9), wear=0.75)
    return inner, outer


def _cap(kit):
    """The boat-shaped ogee cap in tarred boards, its petticoat, the windshaft's nose and the finial."""
    # (share of the plan, height): full and round at the eaves, hollowing as it climbs to the finial.
    profile = ((1.0, 0.0), (1.025, 0.14), (0.99, 0.48), (0.91, 0.86), (0.78, 1.22), (0.6, 1.56), (0.42, 1.84),
               (0.27, 2.08), (0.15, 2.3), (0.07, 2.47), (0.035, CAP_RISE))
    columns = 30
    angles = np.linspace(-math.pi, math.pi, columns + 1)
    run = np.concatenate([[0.0], np.cumsum([math.hypot((b[0] - a[0]) * CAP_HALF[0], b[1] - a[1])
                                            for a, b in zip(profile, profile[1:])])])
    grid = np.zeros((len(profile), columns + 1, 3))
    uvs = np.zeros((len(profile), columns + 1, 2))
    board = kit.rng.uniform(0.25, 1.0, size=columns + 1)
    board[-1] = board[0]
    tone = np.zeros((len(profile), columns + 1))
    for row, (share, rise) in enumerate(profile):
        for column, angle in enumerate(angles):
            grid[row, column] = (CAP_HALF[0] * share * math.sin(angle), CAP_BASE + rise,
                                 CAP_HALF[1] * share * math.cos(angle))
            uvs[row, column] = (0.5 + angle * CAP_HALF[0] * max(share, 0.3) / UV_SPAN, 0.5 + run[row] / UV_SPAN)
            tone[row, column] = board[column]
    flat = grid.reshape(-1, 3)
    weathered = np.clip(0.25 + 0.6 * fbm(flat, 0.7, 3, kit.seed + 5) + 0.25 * (flat[:, 1] - CAP_BASE) / CAP_RISE,
                        0.0, 1.0)
    kit.sheet(grid, Y, TAR, uvs, tone=tone.reshape(-1), wear=weathered)
    # The petticoat: boards hanging from the eaves over the curb, to throw the rain clear of it.
    hem = CURB - 0.42
    skirt = np.array([[(CAP_HALF[0] * math.sin(angle), level, CAP_HALF[1] * math.cos(angle)) for angle in angles]
                      for level in (hem, CAP_BASE)])
    skirt_uvs = np.array([[(0.5 + angle * CAP_HALF[0] / UV_SPAN, 0.5 + (level - CAP_BASE) / UV_SPAN)
                           for angle in angles] for level in (hem, CAP_BASE)])
    outward = np.array([[(math.sin(angle), 0.0, math.cos(angle)) for angle in angles] for _ in range(2)])
    positions = skirt.reshape(-1, 3)
    triangles = []
    for column in range(columns):
        triangles.extend(((column, column + 1, column + columns + 1), (column + 1, column + columns + 2,
                                                                       column + columns + 1)))
    kit.mesh(positions, triangles, outward.reshape(-1, 3), skirt_uvs.reshape(-1, 2), TAR,
             tone=np.tile(board, 2), wear=0.45)
    # Its soffit: the dark underside between the hem and the tower.
    for column in range(columns):
        first, second = angles[column], angles[column + 1]
        kit.poly([skirt[0, column], skirt[0, column + 1], cyl(second, radius_at(hem), hem),
                  cyl(first, radius_at(hem), hem)], -Y, TAR, tone=0.15, wear=0.2)
    # The windshaft leaves the cap through a boarded breast and ends at the hub.
    axis = np.array([0.0, math.sin(SHAFT_TILT), math.cos(SHAFT_TILT)])
    kit.tube([HUB - axis * 1.5, HUB - axis * 0.55], 0.4, 10, TAR, tone=0.5, wear=0.5, cap_end=True)
    kit.tube([HUB - axis * 0.6, HUB + axis * 0.02], 0.2, 10, IRON, tone=0.45, wear=0.5, cap_end=True)
    # The finial: a turned post and a white ball.
    top = CAP_BASE + CAP_RISE
    kit.tube([(0.0, top - 0.2, 0.0), (0.0, top + 0.16, 0.0), (0.0, top + 0.36, 0.0)], [0.075, 0.05, 0.035], 6, WHITE,
             tone=0.8, wear=0.4)
    directions, faces = _geodesic(2)
    kit.lump(directions, faces, (0.0, top + 0.44, 0.0), (0.12, 0.12, 0.12), WHITE, tone=0.95, wear=0.3)
    return axis, [0.0, top + 0.56, 0.0]


def windmill():
    """The body of the mill: tower, plinth, door, windows, stage and cap (no sails)."""
    kit = Kit(8101)
    door = Opening(0.0, 0.0, *DOOR_SIZE)
    windows = [Opening(*window) for window in WINDOWS]
    _tower(kit, [door] + windows)
    _plinth(kit, door)
    door_centre = _door(kit, door)
    for window in windows:
        _window(kit, window)
    inner, outer = _stage(kit)
    axis, cap_top = _cap(kit)

    def weather(positions, normals, codes, wear):
        """Limewash: moss at the foot, grime where the water runs off the curb, the stage and the sills."""
        level = positions[:, 1]
        turn = np.arctan2(positions[:, 0], positions[:, 2])
        noise = fbm(positions, 0.6, 3, 31)
        streaks = np.clip((fbm(positions * np.array([2.2, 0.2, 2.2]), 1.0, 3, 37) - 0.4) * 3.6, 0.0, 1.0)
        foot = np.clip(1.0 - (level - PLINTH) / 1.5, 0.0, 1.0) ** 1.6 * (0.45 + 0.55 * noise)
        source = 0.1 + 0.55 * np.clip(1.0 - (CURB - level) / 2.6, 0.0, 1.0)
        source += 0.5 * np.clip(1.0 - (STAGE - level) / 1.3, 0.0, 1.0) * (level < STAGE)
        for window in windows:
            away = np.abs(np.arctan2(np.sin(turn - window.theta), np.cos(turn - window.theta)))
            under = (level <= window.low + 1e-3) & (away < window.half * 1.6)
            source += 0.75 * np.clip(1.0 - (window.low - level) / 1.5, 0.0, 1.0) * under
        washed = np.clip(np.maximum(foot, streaks * np.clip(source, 0.0, 1.0)), 0.0, 1.0)
        stone = np.clip((fbm(positions, 1.5, 3, 41) - 0.38) * 2.6, 0.0, 1.0) * np.clip(1.2 - level / 1.2, 0.3, 1.0)
        return np.where(codes == LIMEWASH, washed, np.where(codes == STONE, np.maximum(wear, stone), wear))

    kit.weather(weather)
    kit.anchors = dict(
        hub=[float(value) for value in HUB], axis=[float(value) for value in axis],
        door=[float(value) for value in door_centre], doorSize=list(DOOR_SIZE), capTop=cap_top, curb=CURB,
        stage=dict(height=STAGE, innerRadius=inner, outerRadius=outer, railHeight=1.06),
        baseRadius=BASE_RADIUS, topRadius=TOP_RADIUS, sailRadius=SAIL_RADIUS,
        windows=[dict(centre=[float(value) for value in window.centre()], width=window.width, height=window.height,
                      normal=[float(value) for value in radial(window.theta)]) for window in windows])
    return kit


def windmill_sails():
    """Four common sails about the origin, in the XY plane, facing +Z.

    Each is a tapering whip with a lattice 1.9 m wide: a leading board ahead of it, and
    behind it sail bars every 43 cm tied by two laths. The bars are set to the weather:
    steep near the hub, nearly flat at the tip, which gives a sail its twist. Canvas is
    spread over the outer two thirds, on the windward (+Z) face of the bars.
    """
    kit = Kit(8203)
    rng = kit.rng
    trailing = SAIL_WIDTH - SAIL_LEAD
    heel = 1.9
    bars = 18
    for sail in range(4):
        angle = math.pi * 0.5 * sail
        along = np.array([math.cos(angle), math.sin(angle), 0.0])
        across = np.array([-math.sin(angle), math.cos(angle), 0.0])

        def weather(reach):
            return math.radians(18.0 - 13.0 * (reach - heel) / (SAIL_RADIUS - heel))

        def place(reach, offset, lift=0.0):
            return along * reach + across * offset + Z * (lift - offset * math.tan(weather(max(reach, heel))))

        tone = kit.part_tone(0.45, 0.85)
        kit.slab([along * 0.0 - across * 0.1 + Z * 0.09, along * SAIL_RADIUS - across * 0.055 + Z * 0.07,
                  along * SAIL_RADIUS + across * 0.055 + Z * 0.07, along * 0.0 + across * 0.1 + Z * 0.09], 0.16, TIMBER,
                 tone=tone, wear=0.55, skip=("3",))
        stations = [heel + (SAIL_RADIUS - 0.05 - heel) * index / (bars - 1) for index in range(bars)]
        for reach in stations:
            kit.bar(place(reach, -SAIL_LEAD), place(reach, trailing), 0.05, 0.035, TIMBER, up=Z,
                    skip=("start", "end"), tone=kit.part_tone(0.35, 0.9), wear=float(rng.uniform(0.4, 0.9)))
        for offset, width in ((-SAIL_LEAD, 0.07), (trailing * 0.5, 0.045), (trailing, 0.05)):
            for first, second in ((0, 6), (6, 12), (12, bars - 1)):
                kit.bar(place(stations[first], offset, 0.012), place(stations[second], offset, 0.012), width, 0.03,
                        TIMBER, up=Z, skip=("start", "end"), tone=kit.part_tone(0.35, 0.9), wear=0.6)
        # The cloth, from the bar nearest a third of the way out to the tip.
        first = min(range(bars), key=lambda index: abs(stations[index] - SAIL_RADIUS / 3.0))
        rows = stations[first:]
        offsets = (0.07, trailing * 0.5, trailing - 0.03)
        grid = np.array([[place(reach, offset, 0.03 + float(rng.uniform(-0.006, 0.006))) for offset in offsets]
                         for reach in rows])
        uvs = np.array([[(0.5 + offset / UV_SPAN, 0.5 + (reach - 6.0) / UV_SPAN) for offset in offsets]
                        for reach in rows])
        flat = grid.reshape(-1, 3)
        edge = np.array([[abs(column - 1) * 0.5 + (0.5 if row in (0, len(rows) - 1) else 0.0) for column in range(3)]
                         for row in range(len(rows))]).reshape(-1)
        stain = np.clip(0.12 + 0.3 * fbm(flat, 0.5, 3, 51 + sail) * (0.6 + edge), 0.0, 1.0)
        cloth = kit.part_tone(0.6, 1.0)
        kit.sheet(grid, Z, CANVAS, uvs, tone=cloth, wear=stain)
        kit.sheet(grid - Z * 0.012, -Z, CANVAS, uvs, tone=cloth * 0.85, wear=stain)
    # The poll end: the iron canister the stocks pass through, on the nose of the windshaft.
    kit.tube([(0.0, 0.0, -0.42), (0.0, 0.0, 0.3)], 0.3, 10, IRON, tone=0.5, wear=0.5, cap_start=True, cap_end=True)
    kit.tube([(0.0, 0.0, 0.3), (0.0, 0.0, 0.4)], [0.13, 0.09], 8, IRON, tone=0.4, wear=0.6, cap_end=True)
    kit.anchors = dict(radius=SAIL_RADIUS, axis=[0.0, 0.0, 1.0], sails=4, width=SAIL_WIDTH,
                       clothFrom=float(rows[0]), centre=[0.0, 0.0, 0.0])
    return kit


def place_sails(arrays, anchors, turn=0.35):
    """The sails set on a mill's hub and turned to its axis (for stills; the runtime does this itself)."""
    positions, normals, uvs, colors, indices = arrays
    hub = np.asarray(anchors["hub"], dtype=float)
    axis = unit(anchors["axis"])
    side = unit(np.cross(Y, axis))
    rise = np.cross(axis, side)
    cosine, sine = math.cos(turn), math.sin(turn)
    spin = np.array([[cosine, -sine, 0.0], [sine, cosine, 0.0], [0.0, 0.0, 1.0]])
    frame = np.stack([side, rise, axis], axis=1) @ spin
    return positions @ frame.T + hub, normals @ frame.T, uvs, colors, indices

