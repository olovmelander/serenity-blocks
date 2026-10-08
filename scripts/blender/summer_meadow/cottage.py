"""The red cottage and its boathouse.

A Swedish summer cottage is a short list of things done the same way for two hundred
years: board-and-batten walls in Falu red, white corner boards, bargeboards and window
casings, a stone plinth, a pantiled roof, a brick chimney on the ridge and a little porch
over the door. Every one of them is modelled here as real relief, so a low sun has battens,
casings and tile rolls to rake across.

Walls are described from outside (see `Wall`): u runs to the right, y up and d out of the
wall, which keeps every window and door a few lines of joinery.
"""

import math

import numpy as np

from fall_grove.wood import fbm

from . import greenery
from .kit import (ACCENT, GLASS, RED, STONE, TILE, TIMBER, UV_SPAN, WHITE, X, Y, Z, Kit, patchy, planar_uv, unit)

PANE_UVS = np.array([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])


def _smoothstep(low, high, value):
    t = np.clip((np.asarray(value, dtype=float) - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


class Opening:
    """A hole in a wall, and how far around it the battens stop for its casing."""

    def __init__(self, u0, u1, y0, y1, beside=0.15, below=0.14, above=0.15):
        self.u0, self.u1, self.y0, self.y1 = u0, u1, y0, y1
        self.beside, self.below, self.above = beside, below, above


class Wall:
    """A wall seen from outside: u runs to the right, y up, d out of the wall."""

    def __init__(self, origin, normal, half, top, gable):
        self.origin = np.asarray(origin, dtype=float)
        self.normal = unit(normal)
        self.right = np.cross(Y, self.normal)
        self.half = half
        self.top = top
        self.gable = gable

    def point(self, u, y, d=0.0):
        return self.origin + self.right * u + Y * y + self.normal * d

    def face(self, kit, u0, u1, y0, y1, d, code, **options):
        """A rectangle parallel to the wall, `d` out of it."""
        kit.poly([self.point(u0, y0, d), self.point(u1, y0, d), self.point(u1, y1, d), self.point(u0, y1, d)],
                 self.normal, code, **options)

    def slab(self, kit, u0, u1, y0, y1, d0, d1, code, faces="front", tone=None, wear=0.0, grain=None):
        """A board in wall space; `faces` lists which of its sides are seen."""
        if tone is None:
            tone = kit.part_tone(0.55, 1.0)
        if grain is None:
            grain = Y if (y1 - y0) >= (u1 - u0) else self.right
        point = self.point
        sides = {
            "front": ([point(u0, y0, d1), point(u1, y0, d1), point(u1, y1, d1), point(u0, y1, d1)], self.normal),
            "back": ([point(u0, y0, d0), point(u1, y0, d0), point(u1, y1, d0), point(u0, y1, d0)], -self.normal),
            "left": ([point(u0, y0, d0), point(u0, y0, d1), point(u0, y1, d1), point(u0, y1, d0)], -self.right),
            "right": ([point(u1, y0, d0), point(u1, y0, d1), point(u1, y1, d1), point(u1, y1, d0)], self.right),
            "bottom": ([point(u0, y0, d0), point(u1, y0, d0), point(u1, y0, d1), point(u0, y0, d1)], -Y),
            "top": ([point(u0, y1, d0), point(u1, y1, d0), point(u1, y1, d1), point(u0, y1, d1)], Y),
        }
        for key in faces.split():
            points, outward = sides[key]
            kit.poly(points, outward, code, tone=tone, wear=wear, grain=grain)


def _clip_below(polygon, a, b):
    """The part of a 2D polygon on or below the line through `a` and `b`."""
    (ua, ya), (ub, yb) = a, b

    def over(point):
        return point[1] - (ya + (yb - ya) * (point[0] - ua) / (ub - ua))

    kept = []
    for index, current in enumerate(polygon):
        following = polygon[(index + 1) % len(polygon)]
        here, there = over(current), over(following)
        if here <= 1e-9:
            kept.append(current)
        if (here < -1e-9 and there > 1e-9) or (here > 1e-9 and there < -1e-9):
            share = here / (here - there)
            kept.append((current[0] + (following[0] - current[0]) * share,
                         current[1] + (following[1] - current[1]) * share))
    tidy = []
    for point in kept:
        if not tidy or abs(point[0] - tidy[-1][0]) + abs(point[1] - tidy[-1][1]) > 1e-7:
            tidy.append(point)
    if len(tidy) > 1 and abs(tidy[0][0] - tidy[-1][0]) + abs(tidy[0][1] - tidy[-1][1]) < 1e-7:
        tidy.pop()
    return tidy


# -- roofing ------------------------------------------------------------------------------
def tile_slope(kit, start, end, outward, pitch, run, seed, period=0.255, amplitude=0.028, moss=0.5):
    """One slope of clay pantiles from the ridge line `start`..`end`, `run` metres out (level).

    The rolls and pans are modelled; the courses are not (v counts metres up the slope from
    the eave for a shader that wants them). The last row turns down over the eave so the
    scalloped tile ends have a thickness.
    """
    start = np.asarray(start, dtype=float)
    end = np.asarray(end, dtype=float)
    length = float(np.linalg.norm(end - start))
    along = (end - start) / length
    outward = unit(outward)
    cosine, sine = math.cos(pitch), math.sin(pitch)
    slope = outward * cosine - Y * sine
    normal = outward * sine + Y * cosine
    reach = run / cosine
    waves = max(1, int(round(length / period)))
    step = length / waves
    profile = []
    for wave in range(waves):
        profile.extend(((wave * step, 1.0), ((wave + 0.28) * step, -0.6), ((wave + 0.72) * step, -0.6)))
    profile.append((length, 1.0))
    lift = amplitude * 0.6 + 0.012
    stations = [(0.0, 0.0), (reach, 0.0), (reach, 0.06)]
    grid = np.zeros((len(stations), len(profile), 3))
    uvs = np.zeros((len(stations), len(profile), 2))
    for row, (distance, drop) in enumerate(stations):
        for column, (offset, height) in enumerate(profile):
            grid[row, column] = (start + along * offset + slope * distance + normal * (lift + amplitude * height)
                                 - Y * drop - outward * drop * 0.2)
            uvs[row, column] = (0.5 + (offset - length * 0.5) / UV_SPAN, 0.5 + (reach - distance - drop) / UV_SPAN)

    def tone(positions):
        return np.clip(0.2 + 0.8 * fbm(positions, 0.6, 3, seed) + 0.25 * (fbm(positions, 3.1, 2, seed + 3) - 0.5),
                       0.0, 1.0)

    def wear(positions):
        down = np.clip(((positions - start) @ slope) / reach, 0.0, 1.0)
        return np.clip((fbm(positions, 0.9, 3, seed + 5) - 0.4) * 2.6, 0.0, 1.0) * moss * (0.35 + 0.65 * down)

    kit.sheet(grid, normal, TILE, uvs, tone=tone, wear=wear)
    return slope, normal, reach


def ridge_tiles(kit, start, end, radius=0.115, module=0.4, moss=0.3):
    """A row of half-round ridge tiles, each lapping the next."""
    start = np.asarray(start, dtype=float)
    end = np.asarray(end, dtype=float)
    length = float(np.linalg.norm(end - start))
    along = (end - start) / length
    side = unit(np.cross(along, Y))
    count = max(1, int(round(length / module)))
    step = length / count
    angles = [math.radians(value) for value in (-100.0, -36.0, 36.0, 100.0)]

    def arc(distance, size):
        return [start + along * distance + (Y * math.cos(angle) + side * math.sin(angle)) * size for angle in angles]

    for index in range(count):
        near = index * step
        far = near + step + (0.035 if index < count - 1 else 0.0)
        grid = np.array([arc(near, radius * 1.07), arc(far, radius * 0.93)])
        uvs = np.array([[(0.5 + angle * radius / UV_SPAN, 0.5 + (distance - length * 0.5) / UV_SPAN)
                         for angle in angles] for distance in (near, far)])
        kit.sheet(grid, Y, TILE, uvs, tone=kit.part_tone(0.25, 1.0), wear=moss * float(kit.rng.random()))
    kit.poly(arc(0.0, radius * 1.07), -along, TILE, tone=0.4)
    kit.poly(arc(length, radius * 0.93), along, TILE, tone=0.4)


def bargeboard(kit, top, slope, length, normal, gable, height, thickness=0.032, cap=0.095):
    """A white board along the edge of a roof, from `top` at the ridge down the slope.

    Its ends are cut plumb, so two of them meet in a mitre at the ridge. A cap board lies on
    top of it over the edge of the tiles.
    """
    top = np.asarray(top, dtype=float)
    outer0 = top + gable * thickness
    outer1 = outer0 + slope * length
    inner0, inner1 = top, top + slope * length
    drop = Y * height
    tone = kit.part_tone(0.7, 1.0)
    kit.poly([outer0, outer1, outer1 - drop, outer0 - drop], gable, WHITE, tone=tone, grain=slope)
    kit.poly([inner0, inner1, inner1 - drop, inner0 - drop], -gable, WHITE, tone=tone, grain=slope)
    kit.poly([outer0 - drop, outer1 - drop, inner1 - drop, inner0 - drop], -normal, WHITE, tone=tone, grain=slope)
    kit.poly([outer1, outer1 - drop, inner1 - drop, inner1], slope, WHITE, tone=tone, grain=Y)
    if cap:
        lid0 = outer0 + gable * 0.012 + normal * 0.022
        lid1 = lid0 + slope * (length + 0.01)
        kit.poly([lid0, lid1, lid1 - gable * cap, lid0 - gable * cap], normal, WHITE, tone=tone, grain=slope)
        kit.poly([lid0, lid1, lid1 - normal * 0.03, lid0 - normal * 0.03], gable, WHITE, tone=tone, grain=slope)
        kit.poly([lid1, lid1 - gable * cap, lid1 - gable * cap - normal * 0.03, lid1 - normal * 0.03], slope, WHITE,
                 tone=tone, grain=gable)


def chimney(kit, centre, base, top, size=(0.7, 0.56), seed=5):
    """A brick stack with a corbelled band under its cap and a sooty flue."""
    cx, cz = centre
    hx, hz = size[0] * 0.5, size[1] * 0.5
    brick = patchy(seed, 2.4, 0.3, 1.0)

    def soot(positions):
        return np.clip((positions[:, 1] - (top - 1.0)) / 1.0, 0.0, 1.0) ** 1.6 * 0.85

    kit.box([cx - hx, base, cz - hz], [cx + hx, top - 0.2, cz + hz], STONE, skip=("-y", "+y"), tone=brick, wear=soot,
            grain=Y)
    kit.box([cx - hx - 0.045, top - 0.2, cz - hz - 0.045], [cx + hx + 0.045, top - 0.08, cz + hz + 0.045], STONE,
            tone=brick, wear=soot, grain=Y)
    kit.box([cx - hx - 0.01, top - 0.08, cz - hz - 0.01], [cx + hx + 0.01, top, cz + hz + 0.01], STONE,
            skip=("-y", "+y"), tone=brick, wear=soot, grain=Y)
    fx, fz = hx * 0.55, hz * 0.5
    outer = [(cx - hx - 0.01, cz - hz - 0.01), (cx + hx + 0.01, cz - hz - 0.01), (cx + hx + 0.01, cz + hz + 0.01),
             (cx - hx - 0.01, cz + hz + 0.01)]
    inner = [(cx - fx, cz - fz), (cx + fx, cz - fz), (cx + fx, cz + fz), (cx - fx, cz + fz)]
    for index in range(4):
        following = (index + 1) % 4
        (ox0, oz0), (ox1, oz1) = outer[index], outer[following]
        (ix0, iz0), (ix1, iz1) = inner[index], inner[following]
        kit.poly([(ox0, top, oz0), (ox1, top, oz1), (ix1, top, iz1), (ix0, top, iz0)], Y, STONE, tone=0.3, wear=0.9)
        middle = np.array([(ix0 + ix1) * 0.5, 0.0, (iz0 + iz1) * 0.5])
        kit.poly([(ix0, top, iz0), (ix1, top, iz1), (ix1, top - 0.16, iz1), (ix0, top - 0.16, iz0)],
                 np.array([cx, 0.0, cz]) - middle, STONE, tone=0.05, wear=1.0)
    kit.poly([(x, top - 0.16, z) for x, z in inner], Y, STONE, tone=0.0, wear=1.0)
    return [cx, top, cz]


# -- the shell of a house -----------------------------------------------------------------
class House:
    """Walls, corner boards, plinth and roof of a gabled timber building."""

    def __init__(self, kit, ridge, half_length, half_span, wall_height, pitch, base=0.34, eave=0.5, verge=0.4,
                 thickness=0.16, seed=1):
        self.kit = kit
        self.ridge = unit(ridge)
        self.across = np.cross(self.ridge, Y)
        self.half_length = half_length
        self.half_span = half_span
        self.wall_height = wall_height
        self.pitch = math.radians(pitch)
        self.base = base
        self.eave = eave
        self.verge = verge
        self.thickness = thickness
        self.seed = seed
        self.walls = {}

    def under(self, distance):
        """Height of the underside of the roof, `distance` metres (level) from the ridge."""
        return self.wall_height + (self.half_span - abs(distance)) * math.tan(self.pitch)

    @property
    def ridge_height(self):
        """Height of the plane the tiles lie on, at the ridge."""
        return self.under(0.0) + self.thickness / math.cos(self.pitch)

    def wall(self, normal):
        normal = unit(normal)
        key = tuple(int(round(value)) for value in normal)
        if key not in self.walls:
            gable = abs(float(np.dot(normal, self.ridge))) > 0.5
            if gable:
                self.walls[key] = Wall(normal * self.half_length, normal, self.half_span, self.under, True)
            else:
                self.walls[key] = Wall(normal * self.half_span, normal, self.half_length,
                                       lambda _u: self.wall_height, False)
        return self.walls[key]

    def clad(self, wall, openings=(), pitch=0.235, corner=0.14, batten=0.05, proud=0.022):
        """Board-and-batten cladding on one wall: the boards as a surface, the battens as relief."""
        kit = self.kit
        half = wall.half
        us = {-half, half}
        ys = {self.base, self.wall_height}
        if wall.gable:
            us.add(0.0)
            ys.add(wall.top(0.0))
        for opening in openings:
            us.update((opening.u0, opening.u1))
            ys.update((opening.y0, opening.y1))
        us = sorted(us)
        ys = sorted(ys)
        tone = patchy(self.seed + 11, 0.7, 0.4, 0.95)
        for u0, u1 in zip(us, us[1:]):
            for y0, y1 in zip(ys, ys[1:]):
                middle_u, middle_y = (u0 + u1) * 0.5, (y0 + y1) * 0.5
                if any(o.u0 < middle_u < o.u1 and o.y0 < middle_y < o.y1 for o in openings):
                    continue
                cell = _clip_below([(u0, y0), (u1, y0), (u1, y1), (u0, y1)], (u0, wall.top(u0)), (u1, wall.top(u1)))
                if len(cell) >= 3:
                    kit.poly([wall.point(u, y) for u, y in cell], wall.normal, RED, tone=tone, grain=Y)
        span = 2.0 * (half - corner)
        count = max(1, int(round(span / pitch)))
        step = span / count
        for index in range(count):
            u = -half + corner + (index + 0.5) * step
            blocks = sorted((o.y0 - o.below, o.y1 + o.above) for o in openings
                            if o.u0 - o.beside - batten * 0.5 < u < o.u1 + o.beside + batten * 0.5)
            low = self.base
            for block_low, block_high in blocks:
                if block_low > low + 0.05:
                    self._batten(wall, u, low, block_low, batten, proud)
                low = max(low, block_high)
            if low < wall.top(u) - 0.05:
                self._batten(wall, u, low, None, batten, proud)
        # White corner boards: one on each wall, lapping at the corner.
        for end in (-1.0, 1.0):
            inner, outer = end * (half - corner), end * (half + 0.03)
            tone_board = kit.part_tone(0.7, 1.0)
            with kit.joinery():
                kit.poly([wall.point(inner, self.base, 0.03), wall.point(outer, self.base, 0.03),
                          wall.point(outer, wall.top(outer), 0.03), wall.point(inner, wall.top(inner), 0.03)],
                         wall.normal, WHITE, tone=tone_board, grain=Y)
                kit.poly([wall.point(inner, self.base, 0.0), wall.point(inner, self.base, 0.03),
                          wall.point(inner, wall.top(inner), 0.03), wall.point(inner, wall.top(inner), 0.0)],
                         -wall.right * end, WHITE, tone=tone_board, grain=Y)

    def _batten(self, wall, u, low, high, width, proud, chamfer=0.008):
        """One cover strip: a slightly rounded ridge standing proud of the boards."""
        kit = self.kit
        section = ((u - width * 0.5, 0.0), (u - width * 0.5 + chamfer, proud), (u + width * 0.5 - chamfer, proud),
                   (u + width * 0.5, 0.0))
        tops = [wall.top(su) if high is None else high for su, _sd in section]
        levels = [[low] * 4, tops]
        if high is None and min(tops) - low > 2.0:
            # A strip that runs up under the roof gets a ring just below it, so the shade of
            # the eaves stays under the eaves instead of fading down the whole wall.
            levels.insert(1, [top - 0.6 for top in tops])
        positions = [wall.point(su, y, sd) for level in levels for (su, sd), y in zip(section, level)]
        left = unit(-wall.right * proud + wall.normal * chamfer)
        right = unit(wall.right * proud + wall.normal * chamfer)
        normals = [left, unit(left + wall.normal), unit(right + wall.normal), right] * len(levels)
        triangles = []
        for ring in range(len(levels) - 1):
            for index in range(ring * 4, ring * 4 + 3):
                triangles.extend(((index, index + 1, index + 5), (index, index + 5, index + 4)))
        positions = np.array(positions)
        triangles = np.array(triangles)
        first = np.cross(positions[2] - positions[1], positions[6] - positions[1])
        if float(np.dot(first, wall.normal)) < 0:
            triangles = triangles[:, [0, 2, 1]]
        with kit.joinery():
            kit.mesh(positions, triangles, np.array(normals), planar_uv(positions, wall.normal, Y), RED,
                     tone=kit.part_tone(0.35, 1.0))

    def plinth(self, height, inset=0.04, block=(0.55, 1.1), seed=3):
        """A course of dressed stone under the walls, set back a little from the boards."""
        kit = self.kit
        rng = kit.rng

        def lichen(positions):
            return np.clip((fbm(positions, 1.7, 3, seed) - 0.45) * 3.0, 0.0, 1.0) * 0.8

        for normal in (self.across, -self.across, self.ridge, -self.ridge):
            wall = self.wall(normal)
            reach = wall.half - inset
            u = -reach
            while u < reach - 1e-6:
                following = min(reach, u + float(rng.uniform(*block)))
                if reach - following < block[0] * 0.5:
                    following = reach
                wall.face(kit, u, following, 0.0, height, -inset, STONE, tone=kit.part_tone(0.3, 1.0), wear=lichen,
                          grain=Y)
                u = following

    def roof(self, moss=(0.3, 0.7), period=0.255, bargeboards=True):
        """Pantiles on both slopes, soffits, eave fascias, bargeboards and ridge tiles."""
        kit = self.kit
        ridge, pitch = self.ridge, self.pitch
        long = self.half_length + self.verge
        rise = self.thickness / math.cos(pitch)
        height = self.ridge_height
        for sign, weight in ((1.0, moss[0]), (-1.0, moss[1])):
            outward = self.across * sign
            slope, normal, _reach = tile_slope(kit, -ridge * long + Y * height, ridge * long + Y * height, outward,
                                               pitch, self.half_span + self.eave + 0.05,
                                               self.seed + (21 if sign > 0 else 22), period=period, moss=weight)

            def under(along, distance, outward=outward):
                return ridge * along + outward * distance + Y * self.under(distance)

            edge = self.half_span + self.eave
            kit.poly([under(-long, self.half_span), under(long, self.half_span), under(long, edge), under(-long, edge)],
                     -normal, RED, tone=0.3, grain=ridge)
            for end in (-1.0, 1.0):
                kit.poly([under(end * self.half_length, 0.0), under(end * long, 0.0), under(end * long, self.half_span),
                          under(end * self.half_length, self.half_span)], -normal, RED, tone=0.3, grain=slope)
            kit.poly([under(-long, edge) - Y * 0.012, under(long, edge) - Y * 0.012, under(long, edge) + Y * rise,
                      under(-long, edge) + Y * rise], outward, WHITE, tone=kit.part_tone(0.7, 1.0), grain=ridge)
            if bargeboards:
                for end in (-1.0, 1.0):
                    bargeboard(kit, ridge * end * long + Y * (height + 0.06), slope,
                               (edge + 0.055) / math.cos(pitch), normal, ridge * end, rise + 0.095)
        ridge_tiles(kit, -ridge * (long - 0.02) + Y * (height + 0.03), ridge * (long - 0.02) + Y * (height + 0.03),
                    moss=moss[1] * 0.5)


# -- joinery ------------------------------------------------------------------------------
def window(kit, wall, u, y0, width, height, panes=(2, 3), casing=0.095, proud=0.04):
    """A white casement window: casing, sill, sash and glazing bars in front of recessed glass.

    Returns the hole it needs in the wall and a record of its glass for the manifest.
    """
    u0, u1, y1 = u - width * 0.5, u + width * 0.5, y0 + height
    frame = 0.05
    glass, sash = -0.055, -0.02
    g0, g1, h0, h1 = u0 + frame, u1 - frame, y0 + frame, y1 - frame
    wall.face(kit, g0, g1, h0, h1, glass, GLASS, tone=float(kit.rng.random()), uvs=PANE_UVS)
    tone = kit.part_tone(0.7, 1.0)
    wall.slab(kit, u0, g0, y0, y1, glass, sash, WHITE, "front right", tone=tone)
    wall.slab(kit, g1, u1, y0, y1, glass, sash, WHITE, "front left", tone=tone)
    wall.slab(kit, g0, g1, h1, y1, glass, sash, WHITE, "front bottom", tone=tone)
    wall.slab(kit, g0, g1, y0, h0, glass, sash, WHITE, "front top", tone=tone)
    columns, rows = panes
    for column in range(1, columns):
        middle = g0 + (g1 - g0) * column / columns
        wall.slab(kit, middle - 0.025, middle + 0.025, h0, h1, glass, sash, WHITE, "front left right", tone=tone)
    for row in range(1, rows):
        middle = h0 + (h1 - h0) * row / rows
        wall.slab(kit, g0, g1, middle - 0.015, middle + 0.015, glass, sash - 0.01, WHITE, "front", tone=tone)
    # Casing boards, a head with a drip cap, a sill that throws the rain clear, an apron.
    tone = kit.part_tone(0.7, 1.0)
    wall.slab(kit, u0 - casing, u0, y0, y1, sash, proud, WHITE, "front left right", tone=tone)
    wall.slab(kit, u1, u1 + casing, y0, y1, sash, proud, WHITE, "front left right", tone=tone)
    head = y1 + casing + 0.01
    wall.slab(kit, u0 - casing - 0.03, u1 + casing + 0.03, y1, head, sash, proud, WHITE, "front bottom left right",
              tone=tone)
    wall.slab(kit, u0 - casing - 0.055, u1 + casing + 0.055, head, head + 0.028, 0.0, proud + 0.035, WHITE,
              "front top bottom", tone=tone)
    wall.slab(kit, u0 - casing - 0.025, u1 + casing + 0.025, y0 - 0.045, y0, sash, proud + 0.05, WHITE,
              "front top left right", tone=tone, wear=0.3)
    wall.slab(kit, u0 - casing, u1 + casing, y0 - 0.13, y0 - 0.045, 0.0, proud - 0.008, WHITE, "front bottom",
              tone=tone)
    record = dict(centre=[round(float(value), 4) for value in wall.point(u, (h0 + h1) * 0.5, glass)],
                  width=round(g1 - g0, 4), height=round(h1 - h0, 4),
                  normal=[round(float(value), 4) for value in wall.normal])
    return Opening(u0, u1, y0, y1, beside=casing + 0.06, below=0.14, above=casing + 0.045), record


def panel_door(kit, wall, u, y0, width=0.95, height=2.0, casing=0.11, proud=0.04):
    """A framed door with two pairs of panels under a small glazed light, in a white casing."""
    u0, u1, y1 = u - width * 0.5, u + width * 0.5, y0 + height
    leaf, front = -0.045, -0.027
    stile = 0.12
    wall.face(kit, u0, u1, y0, y1, leaf, ACCENT, tone=0.45, grain=Y)
    rails = ((y0, y0 + 0.2), (y0 + 0.86, y0 + 1.0), (y0 + 1.46, y0 + 1.57), (y1 - 0.13, y1))
    for left, right in ((u0, u0 + stile), (u1 - stile, u1)):
        wall.face(kit, left, right, y0, y1, front, ACCENT, tone=0.8, grain=Y)
    for low, high in rails:
        wall.face(kit, u0 + stile, u1 - stile, low, high, front, ACCENT, tone=0.75, grain=wall.right)
    wall.face(kit, u - 0.05, u + 0.05, y0 + 0.2, y0 + 1.46, front, ACCENT, tone=0.8, grain=Y)
    light = (u0 + stile, u1 - stile, y0 + 1.57, y1 - 0.13)
    wall.face(kit, light[0], light[1], light[2], light[3], leaf + 0.004, GLASS, tone=float(kit.rng.random()),
              uvs=PANE_UVS)
    wall.face(kit, u - 0.014, u + 0.014, light[2], light[3], front, ACCENT, tone=0.8, grain=Y)
    wall.slab(kit, u1 - 0.1, u1 - 0.07, y0 + 0.96, y0 + 1.1, front, front + 0.045, TIMBER,
              "front left right top bottom", tone=0.08)
    tone = kit.part_tone(0.7, 1.0)
    wall.slab(kit, u0 - casing, u0, y0, y1, leaf, proud, WHITE, "front left right", tone=tone)
    wall.slab(kit, u1, u1 + casing, y0, y1, leaf, proud, WHITE, "front left right", tone=tone)
    head = y1 + casing + 0.01
    wall.slab(kit, u0 - casing - 0.03, u1 + casing + 0.03, y1, head, leaf, proud, WHITE, "front bottom left right",
              tone=tone)
    wall.slab(kit, u0 - casing - 0.055, u1 + casing + 0.055, head, head + 0.03, 0.0, proud + 0.035, WHITE,
              "front top bottom", tone=tone)
    wall.slab(kit, u0 - casing, u1 + casing, y0 - 0.05, y0, leaf, proud + 0.03, TIMBER, "front top left right",
              wear=0.6)
    record = dict(centre=[round(float(value), 4) for value in wall.point(u, y0 + height * 0.5, leaf)],
                  width=width, height=height, normal=[round(float(value), 4) for value in wall.normal],
                  threshold=[round(float(value), 4) for value in wall.point(u, y0, 0.0)])
    return Opening(u0, u1, y0, y1, beside=casing + 0.06, below=5.0, above=casing + 0.05), record


def plank_door(kit, wall, u, y0, width=0.85, height=1.8, casing=0.08, proud=0.035, planks=5):
    """A ledged and braced plank door, as on any shed."""
    rng = kit.rng
    u0, u1, y1 = u - width * 0.5, u + width * 0.5, y0 + height
    leaf = -0.03
    for index in range(planks):
        left = u0 + width * index / planks
        wall.face(kit, left + 0.004, left + width / planks - 0.004, y0, y1, leaf + float(rng.uniform(-0.004, 0.004)),
                  ACCENT, tone=kit.part_tone(0.3, 0.9), grain=Y)
    wall.face(kit, u0, u1, y0, y1, leaf - 0.012, ACCENT, tone=0.1, grain=Y)
    ledges = (y0 + 0.2, y1 - 0.32)
    for low in ledges:
        wall.slab(kit, u0 + 0.03, u1 - 0.03, low, low + 0.11, leaf, leaf + 0.026, ACCENT, "front top bottom", tone=0.85)
    brace_low = wall.point(u0 + 0.08, ledges[0] + 0.11, leaf + 0.013)
    brace_high = wall.point(u1 - 0.08, ledges[1], leaf + 0.013)
    kit.bar(brace_low, brace_high, 0.1, 0.026, ACCENT, up=wall.normal, skip=("bottom", "start", "end"), tone=0.85)
    wall.slab(kit, u1 - 0.09, u1 - 0.06, y0 + 0.9, y0 + 1.04, leaf, leaf + 0.05, TIMBER, "front left right top bottom",
              tone=0.08)
    tone = kit.part_tone(0.7, 1.0)
    wall.slab(kit, u0 - casing, u0, y0, y1, leaf, proud, WHITE, "front left right", tone=tone)
    wall.slab(kit, u1, u1 + casing, y0, y1, leaf, proud, WHITE, "front left right", tone=tone)
    wall.slab(kit, u0 - casing - 0.025, u1 + casing + 0.025, y1, y1 + casing, leaf, proud, WHITE,
              "front top bottom left right", tone=tone)
    record = dict(centre=[round(float(value), 4) for value in wall.point(u, y0 + height * 0.5, leaf)],
                  width=width, height=height, normal=[round(float(value), 4) for value in wall.normal],
                  threshold=[round(float(value), 4) for value in wall.point(u, y0, 0.0)])
    return Opening(u0, u1, y0, y1, beside=casing + 0.05, below=5.0, above=casing + 0.03), record


def flower_box(kit, wall, u0, u1, top, flowers=5, sprigs=2):
    """A white box of summer flowers on brackets under a window."""
    rng = kit.rng
    near, far = 0.05, 0.24
    wall.slab(kit, u0, u1, top - 0.16, top, near, far, WHITE, "front left right bottom", tone=kit.part_tone(0.7, 1.0))
    kit.poly([wall.point(u0, top - 0.025, near), wall.point(u1, top - 0.025, near), wall.point(u1, top - 0.025, far),
              wall.point(u0, top - 0.025, far)], Y, TIMBER, tone=0.03, wear=1.0)
    for index in range(flowers):
        u = u0 + (u1 - u0) * (index + float(rng.uniform(0.2, 0.8))) / flowers
        position = wall.point(u, top + float(rng.uniform(0.04, 0.2)), float(rng.uniform(near + 0.03, far + 0.03)))
        greenery.flower(kit, position, unit(wall.normal * 0.8 + Y * 0.6 + rng.normal(size=3) * 0.3),
                        float(rng.uniform(0.05, 0.07)))
    for index in range(sprigs):
        u = u0 + (u1 - u0) * (index + float(rng.uniform(0.25, 0.75))) / sprigs
        greenery.sprig(kit, wall.point(u, top - 0.01, far + 0.004), wall.normal,
                       wall.right * float(rng.uniform(-0.5, 0.5)) - Y, 0.14, lift=(0.25, 0.9))


def _weather(seed):
    """Timber greys and flakes near the ground, on ledges and in streaks down the boards."""
    def rule(positions, normals, codes, wear):
        noise = fbm(positions, 1.3, 3, seed)
        fine = fbm(positions, 5.0, 2, seed + 4)
        timber = np.isin(codes, (TIMBER, RED, WHITE, ACCENT))
        splash = (1.0 - _smoothstep(0.3, 1.2, positions[:, 1])) * 0.55
        ledge = np.clip(normals[:, 1], 0.0, 1.0) * 0.3
        streak = np.clip((noise - 0.48) * 2.0, 0.0, 1.0) * (0.25 + 0.3 * fine)
        return np.where(timber, np.maximum(wear, splash + ledge + streak), wear)
    return rule


# -- the cottage --------------------------------------------------------------------------
def _porch(kit, front, deck=0.42, post_x=0.9, depth=1.4):
    """A gabled porch on white posts: deck, steps, cross-braced railings and a tiled roof."""
    rng = kit.rng
    wall_z = float(front.origin[2])
    post_z = wall_z + depth
    edge_z = wall_z + depth + 0.1
    # Deck boards on a skirt, the front corners on stones.
    boards = 10
    for index in range(boards):
        near = wall_z + 0.02 + (edge_z - wall_z - 0.02) * index / boards
        far = wall_z + 0.02 + (edge_z - wall_z - 0.02) * (index + 1) / boards - 0.006
        kit.box([-post_x - 0.1, deck - 0.035, near], [post_x + 0.1, deck, far], TIMBER,
                skip=("-y", "-z") if index == boards - 1 else ("-y", "-z", "+z"), wear=float(rng.uniform(0.3, 0.8)),
                grain=X)
    kit.box([-post_x - 0.07, 0.18, wall_z], [post_x + 0.07, deck - 0.035, edge_z - 0.03], TIMBER,
            skip=("-y", "+y", "-z"), tone=0.3, wear=0.6, grain=X)
    for side in (-1.0, 1.0):
        kit.box([side * (post_x + 0.1), 0.0, edge_z - 0.36], [side * (post_x - 0.22), 0.18, edge_z - 0.02], STONE,
                skip=("-y",), tone=kit.part_tone(0.4, 0.9), wear=0.3)
    # Two steps down to a stone slab in the grass.
    riser = deck / 3.0
    for index, height in enumerate((riser * 2.0, riser)):
        near = edge_z + 0.28 * index
        kit.box([-0.65, 0.0, near], [0.65, height - 0.035, near + 0.26], TIMBER, skip=("-y", "+y", "-z"), tone=0.3,
                wear=0.7, grain=X)
        kit.box([-0.68, height - 0.035, near - 0.01], [0.68, height, near + 0.3], TIMBER, skip=("-y", "-z"),
                wear=float(rng.uniform(0.5, 0.9)), grain=X)
    kit.box([-0.85, 0.0, edge_z + 0.56], [0.85, 0.06, edge_z + 1.08], STONE, skip=("-y",), tone=0.7, wear=0.25)
    # Posts with a plain base and cap, pilasters against the wall.
    beam_low, beam_high = 2.32, 2.44
    for side in (-1.0, 1.0):
        x = side * post_x
        tone = kit.part_tone(0.75, 1.0)
        kit.box([x - 0.05, deck, post_z - 0.05], [x + 0.05, beam_low, post_z + 0.05], WHITE, skip=("-y", "+y"),
                tone=tone, grain=Y)
        kit.box([x - 0.068, deck, post_z - 0.068], [x + 0.068, deck + 0.2, post_z + 0.068], WHITE, skip=("-y",),
                tone=tone, grain=Y)
        kit.box([x - 0.068, beam_low - 0.12, post_z - 0.068], [x + 0.068, beam_low, post_z + 0.068], WHITE,
                skip=("+y",), tone=tone, grain=Y)
        kit.box([x - 0.05, deck, wall_z], [x + 0.05, beam_low, wall_z + 0.07], WHITE, skip=("-y", "+y", "-z"),
                tone=tone, grain=Y)
        kit.box([x - 0.05, beam_low, wall_z], [x + 0.05, beam_high, post_z + 0.05], WHITE, skip=("+y", "-z"),
                tone=tone, grain=Z)
        # Railing: a handrail, a bottom rail and a St Andrew's cross between them.
        near, far = wall_z + 0.07, post_z - 0.05
        kit.box([x - 0.035, deck + 0.86, near], [x + 0.035, deck + 0.91, far], WHITE, skip=("-z", "+z"), tone=tone,
                grain=Z)
        kit.box([x - 0.025, deck + 0.14, near], [x + 0.025, deck + 0.19, far], WHITE, skip=("-z", "+z"), tone=tone,
                grain=Z)
        for low, high in ((near, far), (far, near)):
            kit.bar([x, deck + 0.19, low], [x, deck + 0.86, high], 0.05, 0.026, WHITE, up=X, skip=("start", "end"),
                    tone=tone)
    kit.box([-post_x + 0.05, beam_low, post_z - 0.05], [post_x - 0.05, beam_high, post_z + 0.05], WHITE,
            skip=("+y", "-x", "+x"), tone=kit.part_tone(0.75, 1.0), grain=X)
    # The roof: tiles on two slopes, a boarded ceiling, a boarded gable under white bargeboards.
    pitch = math.radians(26.0)
    tangent = math.tan(pitch)
    rise = 0.08
    reach = post_x + 0.3
    front_z = wall_z + depth + 0.32

    def under(x):
        return beam_high + (post_x + 0.05 - abs(x)) * tangent

    ridge = under(0.0) + rise
    for side in (-1.0, 1.0):
        outward = X * side
        slope, normal, _ = tile_slope(kit, [0.0, ridge, wall_z], [0.0, ridge, front_z], outward, pitch, reach + 0.04,
                                      31 + int(side), period=0.245, amplitude=0.024, moss=0.25)
        kit.poly([(0.0, under(0.0), wall_z), (0.0, under(0.0), front_z), (side * reach, under(reach), front_z),
                  (side * reach, under(reach), wall_z)], -normal, WHITE, tone=0.8, grain=Z)
        kit.poly([(side * reach, under(reach) - 0.01, wall_z), (side * reach, under(reach) - 0.01, front_z),
                  (side * reach, under(reach) + rise, front_z), (side * reach, under(reach) + rise, wall_z)], outward,
                 WHITE, tone=kit.part_tone(0.75, 1.0), grain=Z)
        bargeboard(kit, np.array([0.0, ridge + 0.045, front_z]), slope, (reach + 0.05) / math.cos(pitch), normal, Z,
                   rise + 0.075, thickness=0.028, cap=0.075)
    ridge_tiles(kit, [0.0, ridge + 0.025, wall_z + 0.02], [0.0, ridge + 0.025, front_z - 0.01], radius=0.085,
                module=0.36, moss=0.2)
    gable_z = post_z + 0.03
    apex = under(0.0)
    half = post_x + 0.05
    kit.poly([(-half, beam_high, gable_z), (half, beam_high, gable_z), (0.0, apex, gable_z)], Z, RED,
             tone=patchy(41, 0.9, 0.45, 0.95), grain=Y)
    kit.poly([(-half, beam_high, gable_z - 0.02), (half, beam_high, gable_z - 0.02), (0.0, apex, gable_z - 0.02)], -Z,
             WHITE, tone=0.7, grain=Y)
    for index in range(-3, 4):
        left, right = index * 0.24 - 0.022, index * 0.24 + 0.022
        proud = gable_z + 0.02
        kit.poly([(left, beam_high, proud), (right, beam_high, proud), (right, under(right) - 0.01, proud),
                  (left, under(left) - 0.01, proud)], Z, RED, tone=kit.part_tone(0.4, 1.0), grain=Y)
    return [0.0, deck, edge_z]


def cottage():
    """The red cottage: a storey and a half under a pantiled roof, its porch facing +Z."""
    kit = Kit(7101)
    house = House(kit, X, half_length=4.7, half_span=2.9, wall_height=3.55, pitch=40.0, seed=7101)
    front, back = house.wall(Z), house.wall(-Z)
    right, left = house.wall(X), house.wall(-X)
    deck = 0.42
    sill = 1.22
    windows = []

    def glazed(wall, name, storey, u, y0, width, height, panes=(2, 3)):
        opening, record = window(kit, wall, u, y0, width, height, panes)
        windows.append(dict(record, wall=name, storey=storey))
        return opening

    with kit.joinery():
        door_opening, door = panel_door(kit, front, 0.0, deck)
        front_openings = [door_opening] + [glazed(front, "front", 0, u, sill, 1.0, 1.3)
                                           for u in (-3.55, -2.05, 2.05, 3.55)]
        back_openings = [glazed(back, "back", 0, u, sill, 1.0, 1.3) for u in (-2.5, 2.5)]
        gable_openings = {}
        for wall, name in ((right, "right"), (left, "left")):
            gable_openings[name] = [glazed(wall, name, 0, 0.0, sill, 1.0, 1.3),
                                    glazed(wall, name, 1, 0.0, 3.82, 0.9, 1.15)]
    house.clad(front, front_openings)
    house.clad(back, back_openings)
    house.clad(right, gable_openings["right"])
    house.clad(left, gable_openings["left"])
    house.plinth(0.38)
    house.roof(moss=(0.25, 0.7))
    chimney_top = chimney(kit, (-1.35, 0.0), house.ridge_height - 0.35, house.ridge_height + 0.82, seed=17)
    porch = _porch(kit, front, deck=deck)
    with kit.joinery():
        for opening in front_openings[1:]:
            flower_box(kit, front, opening.u0 - 0.04, opening.u1 + 0.04, opening.y0 - 0.16)
        # A midsummer wreath on the door.
        greenery.wreath(kit, front.point(0.0, deck + 1.22, 0.0), Z, 0.17, core=0.028, spacing=0.085,
                        leaf_size=0.085, flowers=6, back_flowers=0, flower_size=0.036, leaves=2)
    kit.weather(_weather(7101))
    kit.anchors = dict(chimneyTop=[round(float(value), 4) for value in chimney_top], door=door["centre"],
                       doorSize=[door["width"], door["height"]], doorThreshold=door["threshold"],
                       porchStep=[round(float(value), 4) for value in porch], windows=windows,
                       ridge=[[-5.1, round(house.ridge_height, 4), 0.0], [5.1, round(house.ridge_height, 4), 0.0]])
    return kit


def shed():
    """A small red boathouse: its gable and plank door face +Z, toward the water."""
    kit = Kit(7203)
    house = House(kit, Z, half_length=1.7, half_span=1.3, wall_height=1.72, pitch=38.0, base=0.1, eave=0.3,
                  verge=0.28, thickness=0.11, seed=7203)
    front = house.wall(Z)
    with kit.joinery():
        door_opening, door = plank_door(kit, front, -0.3, 0.14)
        window_opening, record = window(kit, front, 0.72, 0.98, 0.5, 0.56, panes=(2, 2), casing=0.07, proud=0.035)
    house.clad(front, [door_opening, window_opening], pitch=0.2, corner=0.11)
    for normal in (-Z, X, -X):
        house.clad(house.wall(normal), pitch=0.2, corner=0.11)
    house.plinth(0.14, inset=0.03, block=(0.4, 0.8), seed=9)
    house.roof(moss=(0.45, 0.6), period=0.25)
    kit.box([-0.85, 0.0, 1.7], [0.25, 0.09, 2.2], STONE, skip=("-y",), tone=0.7, wear=0.3)
    kit.weather(_weather(7203))
    kit.anchors = dict(door=door["centre"], doorSize=[door["width"], door["height"]], doorThreshold=door["threshold"],
                       windows=[dict(record, wall="front", storey=0)],
                       ridge=[[0.0, round(house.ridge_height, 4), -1.98], [0.0, round(house.ridge_height, 4), 1.98]])
    return kit
