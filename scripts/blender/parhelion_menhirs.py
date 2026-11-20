"""Parhelion's standing stones: three menhirs, built by script in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --python scripts/blender/parhelion_menhirs.py
    blender --background --factory-startup --python scripts/blender/parhelion_menhirs.py -- \
        [--out src/themes/parhelion] [--preview <dir>] [--only tall,broad] [--blend <file.blend>]

Without arguments the module is written where the theme imports it from (`--out` names another
folder; `--only` builds previews of some of the stones and writes no module).

Two rows of standing stones lead across the frozen plain toward the great stone that hides the
sun. They are seen against the light: dark shapes with a thin gold rim, snow on their tops and
ledges, ten to twenty-two metres tall and a few hundred to a few thousand metres off, so sixty to
ninety pixels tall at the nearest and a dozen at the farthest. The SILHOUETTE is what matters,
then the big faces (each catches the sky's light on its own); anything finer is never seen. The
rock is hard and cleaved (a gneiss): irregular flat faces, worn arrises, a few big chips, tops
flat enough to hold snow. Three stones, which read apart at thirty pixels from the front and
turned:

    tall    a tall thin slab that trends to one side as it rises (its shape, not a rotation): a
            lower bed with a ledge where the upper slab is set back, a top that slants steeply
            from a low shoulder up to a short high one
    tooth   a pointed, tapering stone on a wider foot: the point is off its middle, one flank is
            a large spall (a cleaved-off face) that starts at a shoulder, a low block at its foot
    broad   a broad, squat slab: a bed that stands proud of the slab above it (a ledge along the
            front and round one end), a notched top with one broad high horn and one low one

How a stone is made. Its body is a few convex blocks: each the outline the eye sees (a convex
polygon) carried through the stone's thickness between a front and a back face, every side face
skewed its own way and every plane set a seeded hair off where it was drawn, so no two arrises
are parallel. Blocks are fused (a bed under a slab: a ledge), bites cut out (a spall and the
ledge it left, a step chipped out of a top), a flake or two cleaved off between a face and a
flank, and corners knocked off at seeded places (a flat cut across the stone's farthest point
along a seeded direction, kept only where it takes off a corner and nothing else). All of it is
one signed distance field evaluated with numpy: the planes meet in worn arrises (a smooth
maximum), the whole is bent by a slow noise (no face is a machined plane) and given a low relief.
The field is polygonised with surface nets (scripts/blender/grainfields/horse_sdf.py); Blender
makes it one closed skin (a voxel remesh), cuts it off below the ground and collapses it to the
stone's triangle budget (a decimate modifier). The result is scaled so that its highest vertex is
at one, and centred on its foot. Every seed is fixed: the same script and Blender write the same
bytes.

Space: the game's own. x to the frame's right (the stone's BROAD axis), y up, z toward the eye
(its THIN axis); the ground line is y = 0, the highest vertex y = 1, and the stone goes on down
to y = -BURY (open underneath: no floor), so that an instance can be sunk into the snow. Blender
is z-up: `to_blender` and `to_game` are the only places the two meet.

Every vertex carries what the theme shades it by:

    normal   vertices are split along every arris sharper than CREASE degrees and smooth within
             a face, then leaned a little toward the stone's smooth normal (a worn arris, in the
             shading: the triangles are too few to round it)
    ao       ambient occlusion: cosine-weighted rays against the stone itself (255 in the open,
             darker in a crack, under a ledge, in the notch)

The export is one module, src/themes/parhelion/parhelion-menhir-models.js: plain arrays of
integers, no loader and no asset file.

Previews (`--preview`), all through the eye's own view (from the front, the snow drawn over what
is under the ground line):

    menhirs-large.png      each stone five hundred pixels tall, from the front and turned seventy
                           degrees, lit from behind and one side with the shipped normals and
                           occlusion
    menhirs-game-size.png  near-black on pale blue at seventy, thirty and fourteen pixels (from
                           the front, turned seventy and ninety degrees), enlarged five times;
                           menhirs-game-size-1x.png is the same at its true size
    menhirs-snow.png       the same light with snow on every face level enough to hold it, and a
                           third view from the lit side
    menhirs-faces.png      each face in the colour of its normal (where the vertices are split),
                           and the occlusion alone
"""

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from grainfields.horse_sdf import surface_nets  # noqa: E402

TAG = "[parhelion-menhirs]"
SCENE = "ParhelionMenhirs"
MODULE = "parhelion-menhir-models.js"
OUT = HERE.parent.parent / "src" / "themes" / "parhelion"

NAMES = ("tall", "tooth", "broad")
#: Positions are whole numbers of this (a five-millimetre step on a twenty-metre stone).
QUANT = 1.0 / 4096.0
#: The stone goes this far below the ground line (unit heights), open underneath.
BURY = 0.08
#: The field is sampled this far apart, inside this box (game space).
VOXEL = 0.004
BOX = ((-0.38, 0.38), (-0.36, 1.1), (-0.24, 0.24))
#: Triangles a stone is decimated to (the module's size is the sum of them).
TRIANGLES = {"tall": 390, "tooth": 410, "broad": 460}
#: An arris sharper than this (degrees) splits its vertices; a face's own vertices stay smooth.
CREASE = 35.0
#: Corners of one vertex whose normals agree to one part in this share a vertex (a few degrees).
SAME = 16.0
#: How far a split normal leans toward the stone's smooth one.
SOFTEN = 0.12
#: The arrises' wear: the width over which two faces of a block run into one another.
WEAR = 0.003
#: The fillet where two blocks are fused, and where a bite or a chip is cut.
JOIN = 0.002
#: A flake scar's cut is this far outside the stone at its rim (the stone is only known to a
#: coarse lattice there).
CHIP_RIM = 0.008
#: ... and flat (at its full depth) over this much of the way in from the rim.
CHIP_FLOOR = 0.45
#: The slow bend of the whole stone (how far, and how many waves per unit height) and its relief.
BEND = (0.011, 1.5)
RELIEF = (0.004, 3.1)
#: A triangle lower than this over its longest edge is a sliver (three corners along one arris).
SLIVER = 0.002
AO_RAYS = 96
AO_REACH = 0.42
AO_GAIN = 1.35
AO_FLOOR = 0.12


def log(*a):
    print(TAG, *a)
    sys.stdout.flush()


# ── Space ─────────────────────────────────────────────────────────────────────

def to_blender(p):
    """Game space (x right, y up, z toward the eye) as Blender's (x right, y away from the eye, z up)."""
    p = np.asarray(p, dtype=np.float64)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


def to_game(p):
    """Blender's space as the game's: the inverse of `to_blender` (both are turns, so a triangle
    keeps its winding)."""
    p = np.asarray(p, dtype=np.float64)
    return np.stack([p[..., 0], p[..., 2], -p[..., 1]], axis=-1)


# ── Noise (numpy) ─────────────────────────────────────────────────────────────

def _hash(ix, iy, iz, seed):
    mask = np.uint64(0xFFFFFFFF)
    h = ((ix & 0xFFFFFFFF).astype(np.uint64) * np.uint64(2654435761)
         + (iy & 0xFFFFFFFF).astype(np.uint64) * np.uint64(2246822519)
         + (iz & 0xFFFFFFFF).astype(np.uint64) * np.uint64(3266489917)
         + np.uint64((seed * 668265263 + 374761393) & 0xFFFFFFFF)) & mask
    h = ((h ^ (h >> np.uint64(15))) * np.uint64(2246822519)) & mask
    h = ((h ^ (h >> np.uint64(13))) * np.uint64(3266489917)) & mask
    h = h ^ (h >> np.uint64(16))
    return h.astype(np.float64) / 4294967295.0


def vnoise(p, seed):
    """Value noise in [-1, 1], one lattice cell per unit."""
    cell = np.floor(p).astype(np.int64)
    f = p - cell
    u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0)
    out = np.zeros(len(p))
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1.0 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1.0 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1.0 - u[:, 2]
                out += wx * wy * wz * _hash(cell[:, 0] + dx, cell[:, 1] + dy, cell[:, 2] + dz, seed)
    return out * 2.0 - 1.0


def fbm(p, seed, octaves=2, gain=0.5, lacunarity=2.07):
    total = np.zeros(len(p))
    amp = 1.0
    norm = 0.0
    q = p.copy()
    for o in range(octaves):
        total += amp * vnoise(q + 11.7 * o, seed + o * 97)
        norm += amp
        amp *= gain
        q = q * lacunarity
    return total / norm


# ── Distance fields ───────────────────────────────────────────────────────────

def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def smin(a, b, k):
    if k <= 0.0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def inside_of(normal, point):
    """A half-space as (unit normal, offset): everything behind the plane through `point`."""
    n = unit(normal)
    return n, float(n @ np.asarray(point, dtype=np.float64))


def beyond(normal, point):
    """The other half: everything on the normal's side of the plane through `point`."""
    n = unit(normal)
    return -n, float(-n @ np.asarray(point, dtype=np.float64))


def slab_planes(outline, front, back, skews=None):
    """A cleaved block as half-spaces.

    outline  the face the eye sees: a convex polygon of (x, y), counter-clockwise
    front    (z at the origin, dz/dx, dz/dy): the face toward the eye
    back     the same for the far face (its z is the negative of what they give)
    skews    degrees per edge: its side face turned toward the eye (+) or away from it
    """
    count = len(outline)
    twice = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1]))
    assert twice > 0, "an outline runs counter-clockwise"
    planes = []
    assert skews is None or len(skews) == count, "a skew per edge"
    for i in range(count):
        a, b, c = outline[i], outline[(i + 1) % count], outline[(i + 2) % count]
        turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        assert turn > -1e-9, f"an outline is convex (corner {(i + 1) % count})"
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        skew = math.radians(skews[i] if skews else 0.0)
        normal = (dy / length * math.cos(skew), -dx / length * math.cos(skew), math.sin(skew))
        planes.append(inside_of(normal, (a[0], a[1], 0.0)))
    planes.append(inside_of((-front[1], -front[2], 1.0), (0.0, 0.0, front[0])))
    planes.append(inside_of((-back[1], -back[2], -1.0), (0.0, 0.0, -back[0])))
    return planes


class Stone:
    """A stone as a distance field: convex blocks fused, bites cut out, corners knocked off."""

    def __init__(self, name, seed):
        self.name = name
        self.seed = seed
        self.rng = np.random.default_rng(seed)
        self.blocks = []
        self.faces = {}
        self.bites = []
        self.cleaves = []
        self.chips = []

    def _jitter(self, planes, turn=0.012, shift=0.002):
        """No plane is quite where it was drawn: each a degree off, a hair in or out."""
        out = []
        for normal, offset in planes:
            n = unit(normal + self.rng.normal(0.0, turn, 3))
            out.append((n, offset + float(self.rng.uniform(-shift, shift))))
        return out

    def block(self, outline, front, back, skews=None, wear=WEAR, more=()):
        """A convex block (slab_planes), and `more` half-spaces it also lies within."""
        planes = slab_planes(outline, front, back, skews)
        # (Two blocks given one front and back share them exactly: together they are one slab.)
        key = (tuple(front), tuple(back))
        if key not in self.faces:
            self.faces[key] = self._jitter(planes[-2:])
        self.blocks.append((self._jitter(planes[:-2] + list(more)) + self.faces[key], wear))

    def bite(self, planes):
        """A convex piece gone from the stone: what lies inside every one of `planes`."""
        self.bites.append(self._jitter(planes, 0.006, 0.001))

    def solid(self, p):
        """The stone's distance at points `p`, before it is bent: negative inside."""
        d = None
        for planes, wear in self.blocks:
            b = np.full(len(p), -10.0)
            for normal, offset in planes:
                b = smax(b, p @ normal - offset, wear)
            d = b if d is None else smin(d, b, JOIN)
        for planes in self.bites:
            c = np.full(len(p), -10.0)
            for normal, offset in planes:
                c = np.maximum(c, p @ normal - offset)
            d = smax(d, -c, JOIN)
        for normal, offset in self.cleaves:
            d = smax(d, p @ normal - offset, JOIN)
        for way, top, deep, centre, radius in self.chips:
            fall = 1.0 - ((p - centre) ** 2).sum(axis=1) / (radius * radius)
            near = fall > 0.0
            if near.any():
                # A flake scar: a flat cut across `way`, `deep` over its middle, running out to
                # nothing at its rim.
                floor = np.minimum(fall[near] / CHIP_FLOOR, 1.0)
                cut = p[near] @ way - (top + CHIP_RIM - (deep + CHIP_RIM) * floor)
                d[near] = smax(d[near], cut, JOIN)
        return d

    def cleave(self, normal, point):
        """One more face across the whole stone: everything beyond the plane through `point` is gone."""
        self.cleaves.append(self._jitter([inside_of(normal, point)], 0.006, 0.001)[0])

    def chip(self, count, depth=(0.012, 0.036), radius=(0.11, 0.2), band=(0.15, 0.85), lift=(-0.2, 0.8)):
        """Knock up to `count` corners off at seeded places (fewer, if the stone has fewer to
        knock): each where the stone reaches farthest along a seeded direction near a seeded height
        (within `band`: the top stays as it was drawn), a flat cut `depth` in from there. Only a
        cut that leaves the stone again well inside `radius` is kept (a corner, the end of an
        arris: one clean face), so nothing is ever taken off a whole face or along a whole edge."""
        cell = 0.008
        axes = [np.arange(lo, hi, cell) for lo, hi in BOX]
        grid = np.stack(np.meshgrid(*axes, indexing="ij"), axis=-1).reshape(-1, 3)
        body = grid[self.solid(grid) < 0.0]
        made = 0
        for _ in range(4000):
            if made == count:
                break
            way = unit((self.rng.uniform(-1.0, 1.0), self.rng.uniform(*lift), self.rng.uniform(-1.0, 1.0)))
            height = float(self.rng.uniform(*band))
            reach = float(self.rng.uniform(*radius))
            deep = float(self.rng.uniform(*depth))
            level = body[np.abs(body[:, 1] - height) < 0.05]
            centre = level[int(np.argmax(level @ way))]
            # Climb to the farthest point of its own neighbourhood: the cut is deepest there.
            for _ in range(8):
                ball = body[((body - centre) ** 2).sum(axis=1) < reach * reach]
                farthest = ball[int(np.argmax(ball @ way))]
                if (farthest == centre).all():
                    break
                centre = farthest
            ball = body[((body - centre) ** 2).sum(axis=1) < reach * reach]
            gone = ball[ball @ way > centre @ way - deep]
            spread = np.sqrt(((gone - centre) ** 2).sum(axis=1).max())
            if not band[0] < centre[1] < band[1] or len(gone) < 24 or spread > reach * math.sqrt(1.0 - CHIP_FLOOR) * 0.9:
                continue
            if any(np.linalg.norm(centre - other[3]) < 0.08 for other in self.chips):
                continue
            self.chips.append((way, float(centre @ way), deep, centre, reach))
            made += 1

    def field(self, p):
        """The stone's distance at points `p` (game space): bent by a slow noise, with a low relief."""
        reach, waves = BEND
        q = p * waves
        bent = p + reach * np.stack([vnoise(q + 3.1, self.seed + 1), 0.5 * vnoise(q + 7.9, self.seed + 2),
                                     0.7 * vnoise(q + 5.3, self.seed + 3)], axis=1)
        d = self.solid(bent)
        near = np.abs(d) < 0.06
        d[near] += RELIEF[0] * fbm(p[near] * RELIEF[1], self.seed + 5)
        return d


# ── The three designs ─────────────────────────────────────────────────────────

def design_tall():
    """A tall thin slab that trends to its right as it rises; a top that slants up to one shoulder."""
    s = Stone("tall", 7411)
    # The lower bed: its top (a ledge, dipping to the left) shows on the left flank and across the
    # front; its right flank stands a little proud of the slab's and runs back into it.
    s.block([(-0.135, -0.3), (0.125, -0.3), (0.158, 0.44), (0.136, 0.66), (-0.108, 0.555)],
            front=(0.064, 0.03, -0.012), back=(0.06, -0.02, -0.014), skews=[0, -6, -4, 15, 7])
    # The slab above it, set back: its top slants steeply from the low left shoulder to a short level one.
    s.block([(-0.088, 0.3), (0.13, 0.3), (0.158, 0.82), (0.15, 0.985), (0.062, 1.0), (-0.062, 0.82)],
            front=(0.06, 0.02, -0.03), back=(0.056, -0.015, -0.012), skews=[0, -5, -9, 12, 16, 8])
    # A long flake gone from the upper right of the front: a face of its own between front and flank.
    s.cleave((0.66, 0.1, 0.74), (0.118, 0.8, 0.032))
    # The top is chipped: a step broken out of the slant, half-way up it.
    s.bite([beyond((0.12, 1.0, 0.15), (0.0, 0.878, 0.0)), beyond((-1.0, 0.25, 0.1), (0.022, 0.9, 0.0))])
    s.chip(4)
    return s


def design_tooth():
    """A pointed stone on a wider foot, its point off the middle; one flank a spall from a shoulder up."""
    s = Stone("tooth", 7523)
    # (The front face leans back in two stages: a second front plane takes over above the knee.)
    knee = inside_of((0.0, 0.115, 1.0), (0.0, 0.0, 0.137))
    s.block([(-0.165, -0.3), (0.162, -0.3), (0.166, 0.2), (0.158, 0.5), (0.105, 0.86), (0.03, 0.972), (-0.04, 1.0),
             (-0.136, 0.68), (-0.16, 0.3)],
            front=(0.105, 0.0, -0.03), back=(0.095, 0.0, -0.045), skews=[0, -4, -6, -8, -8, 14, 8, 5, 4],
            more=[knee])
    # The spall: a flake gone from the right flank, from a shoulder (its foot, a ledge) up to the point.
    s.bite([beyond((0.9, 0.15, 0.41), (0.125, 0.42, -0.08)), beyond((-0.2, 1.0, 0.1), (0.15, 0.4, 0.0))])
    # A smaller one from the back of the left flank, from a nick two thirds of the way up.
    s.bite([beyond((-0.95, 0.2, -0.25), (-0.118, 0.69, 0.0)), beyond((0.15, 1.0, 0.0), (-0.12, 0.665, 0.0))])
    # A low block against the left of the foot.
    s.block([(-0.186, -0.3), (-0.04, -0.3), (-0.06, 0.16), (-0.16, 0.225), (-0.184, 0.1)],
            front=(0.088, 0.05, -0.05), back=(0.07, 0.0, -0.03), skews=[0, 0, 14, 8, 5])
    s.chip(4)
    return s


def design_broad():
    """A broad squat slab on a bed that stands proud of it; a notched top, one horn high, one low."""
    s = Stone("broad", 7639)
    # The bed: its top (dipping a little to the left) is a ledge along the front and round the right end.
    s.block([(-0.258, -0.3), (0.252, -0.3), (0.26, 0.2), (0.246, 0.43), (-0.238, 0.4), (-0.262, 0.2)],
            front=(0.08, 0.01, -0.012), back=(0.076, 0.0, -0.01), skews=[0, -5, -7, 16, 6, 4])
    # The slab above it, set back from the bed's front and its right end: two blocks with one
    # front and one back, the left one the high horn (its top dipping gently away from a sharp
    # corner over the cleft), the right one up to the cleft's floor (which dips toward the horn's wall).
    front, back = (0.058, 0.012, -0.024), (0.07, -0.01, -0.014)
    s.block([(-0.243, 0.3), (-0.012, 0.3), (-0.04, 1.0), (-0.2, 0.958), (-0.224, 0.915)],
            front=front, back=back, skews=[0, -8, 12, 9, 5])
    s.block([(-0.06, 0.3), (0.196, 0.3), (0.204, 0.62), (0.196, 0.8), (-0.06, 0.755)],
            front=front, back=back, skews=[0, -6, -8, 10, 0])
    # The low horn stands on it, set back a little (a second, short ledge): a ramp up out of the
    # cleft to a short top.
    s.block([(-0.01, 0.6), (0.205, 0.6), (0.2, 0.845), (0.185, 0.872), (0.095, 0.9), (-0.01, 0.74)],
            front=(0.03, 0.0, -0.028), back=(0.066, 0.0, -0.02), skews=[0, -6, -9, 8, 12, 0])
    # A flake gone from the high horn's front, toward its far corner.
    s.cleave((-0.5, 0.3, 0.81), (-0.19, 0.9, 0.024))
    # ... and a broad one from the bed's left front corner, widening toward the ground.
    s.cleave((-0.6, -0.06, 0.8), (-0.225, 0.3, 0.064))
    s.chip(5)
    return s


DESIGNS = {"tall": design_tall, "tooth": design_tooth, "broad": design_broad}


# ── Meshing ───────────────────────────────────────────────────────────────────

def polygonise(stone):
    """The field's zero surface as triangles (game space), wound counter-clockwise seen from outside."""
    xs, ys, zs = (np.arange(lo, hi + VOXEL * 0.5, VOXEL) for lo, hi in BOX)
    grid = np.empty((len(xs), len(ys), len(zs)))
    yy, zz = np.meshgrid(ys, zs, indexing="ij")
    flat_y, flat_z = yy.ravel(), zz.ravel()
    for start in range(0, len(xs), 16):
        part = xs[start:start + 16]
        p = np.empty((len(part) * len(flat_y), 3))
        p[:, 0] = np.repeat(part, len(flat_y))
        p[:, 1] = np.tile(flat_y, len(part))
        p[:, 2] = np.tile(flat_z, len(part))
        grid[start:start + len(part)] = stone.field(p).reshape(len(part), len(ys), len(zs))
    for axis in range(3):
        ends = np.take(grid, [0, -1], axis=axis)
        assert (ends > 0).all(), f"{stone.name} reaches out of its box"
    return surface_nets(grid, xs, ys, zs)


def largest_piece(vertices, triangles):
    """Drop any crumb the relief left beside the body."""
    parent = np.arange(len(vertices))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in triangles:
        ra = find(a)
        parent[find(b)] = ra
        parent[find(c)] = ra
    roots = np.array([find(i) for i in range(len(vertices))])
    keep = roots == np.bincount(roots).argmax()
    if keep.all():
        return vertices, triangles
    lookup = np.full(len(vertices), -1)
    lookup[keep] = np.arange(int(keep.sum()))
    tris = lookup[triangles]
    return vertices[keep], tris[(tris >= 0).all(axis=1)]


def signed_volume(vertices, triangles, about=(0.0, 0.4, 0.0)):
    """Positive when the triangles look outward (the open foot is a small part of the skin)."""
    a, b, c = (vertices[triangles[:, i]] - np.asarray(about) for i in range(3))
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def mesh_object(scene, name, vertices, triangles):
    """Game-space triangles as a Blender object (standing upright in Blender's space)."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(to_blender(vertices).tolist(), [], np.asarray(triangles).tolist())
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def discard(obj):
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh.users == 0:
        bpy.data.meshes.remove(mesh)


def evaluated(scene, obj):
    """An object with its modifiers applied, as (vertices, triangles) in game space."""
    layer = scene.view_layers[0]
    layer.update()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(layer.depsgraph))
    mesh.calc_loop_triangles()
    vertices = to_game(np.array([v.co[:] for v in mesh.vertices], dtype=np.float64))
    triangles = np.array([t.vertices[:] for t in mesh.loop_triangles], dtype=np.int64)
    bpy.data.meshes.remove(mesh)
    return vertices, triangles


def cut_and_decimate(scene, name, vertices, triangles, target):
    """The fine skin cut off BURY below the ground (left open there) and collapsed to `target`
    triangles: (vertices, triangles) in game space."""
    # Surface nets pinch the skin where two sheets of it pass through one cell (the tip of a
    # ledge): a voxel remesh makes it one closed skin again, which the collapse needs.
    raw = mesh_object(scene, f"{name}.nets", vertices, triangles)
    mod = raw.modifiers.new("skin", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = VOXEL
    mod.adaptivity = 0.0
    mod.use_smooth_shade = False
    skin_v, skin_t = largest_piece(*evaluated(scene, raw))
    discard(raw)
    obj = mesh_object(scene, f"{name}.fine", skin_v, skin_t)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # (The stone grows a hair when its top is set to one: the rim is put at -BURY exactly afterwards.)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-7,
                           plane_co=(0.0, 0.0, -BURY), plane_no=(0.0, 0.0, -1.0), clear_outer=True)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    obj.data.calc_loop_triangles()
    count = len(obj.data.loop_triangles)
    mod = obj.modifiers.new("budget", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, target / count)
    mod.use_collapse_triangulate = True
    out_v, out_t = evaluated(scene, obj)
    discard(obj)
    return out_v, out_t


def rim_of(triangles):
    """The vertices of the open edges (the foot's rim), and how many open edges there are."""
    seen = {}
    for a, b, c in triangles:
        for e in ((a, b), (b, c), (c, a)):
            key = (min(e), max(e))
            seen[key] = seen.get(key, 0) + 1
    lone = [key for key, n in seen.items() if n == 1]
    crowded = sum(1 for n in seen.values() if n > 2)
    return np.array(sorted({i for key in lone for i in key}), dtype=np.int64), len(lone), crowded


def foot_centre(vertices, triangles):
    """The centroid (x, z) of the stone's section at the ground line."""
    up = np.array([0.0, 1.0, 0.0])
    area = 0.0
    cx = 0.0
    cz = 0.0
    for tri in triangles:
        p = vertices[tri]
        cut = []
        for i in range(3):
            u, v = p[i], p[(i + 1) % 3]
            if (u[1] > 0.0) != (v[1] > 0.0):
                cut.append(u + (v - u) * (u[1] / (u[1] - v[1])))
        if len(cut) != 2:
            continue
        # Every piece of the section runs the same way round: across its triangle's normal.
        along = np.cross(np.cross(p[1] - p[0], p[2] - p[0]), up)
        a, b = (cut[0], cut[1]) if (cut[1] - cut[0]) @ along > 0 else (cut[1], cut[0])
        w = a[0] * b[2] - b[0] * a[2]
        area += w
        cx += (a[0] + b[0]) * w
        cz += (a[2] + b[2]) * w
    return np.array([cx / (3.0 * area), 0.0, cz / (3.0 * area)])


def compact(vertices, triangles):
    """What rounding to the lattice left of the skin: an edge rounded to nothing is closed (its
    two ends made one vertex: two that merely lie at one place, on two sheets of the skin, stay
    two), the triangles that lost their area with it go, and so does any vertex nothing uses."""
    parent = np.arange(len(vertices))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for tri in triangles:
        for k in range(3):
            i, j = int(tri[k]), int(tri[(k + 1) % 3])
            if (vertices[i] == vertices[j]).all():
                parent[find(j)] = find(i)
    tris = np.array([[find(int(i)) for i in tri] for tri in triangles], dtype=np.int64)
    tris = tris[(tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 2] != tris[:, 0])]
    a, b, c = (vertices[tris[:, i]] for i in range(3))
    flat = int((np.linalg.norm(np.cross(b - a, c - a), axis=1) < 1e-12).sum())
    assert flat == 0, "a triangle was rounded to a line"
    used = np.zeros(len(vertices), dtype=bool)
    used[tris.ravel()] = True
    renumber = np.cumsum(used) - 1
    return vertices[used], renumber[tris]


def altitudes(vertices, triangles):
    """Every triangle's height over its longest edge, and which corner (0..2) that edge starts at."""
    p = vertices[triangles]
    edges = np.linalg.norm(np.roll(p, -1, axis=1) - p, axis=2)
    twice = np.linalg.norm(np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1)
    return twice / np.maximum(edges.max(axis=1), 1e-20), edges.argmax(axis=1)


def mend_slivers(vertices, triangles, limit=SLIVER):
    """Take out every sliver: the collapse leaves triangles whose three corners lie along one
    arris (no area, and a normal that means nothing: it would pull at the shading of the faces
    beside it). A sliver is paired with the triangle across its long edge and the pair cut the
    other way, which moves no vertex; where that would only make another, its middle corner is
    slid along the arris into one of its ends (the vertex goes: it lay on the line between them).
    Returns the vertices still in use, the triangles, and how many slivers went."""
    triangles = triangles.copy()
    mended = 0

    def normal(tri):
        a, b, c = (vertices[int(i)] for i in tri)
        n = np.cross(b - a, c - a)
        return n / max(np.linalg.norm(n), 1e-20)

    def turned(t, k, owner):
        """The sliver `t` and its neighbour across the long edge (which starts at corner k), re-cut."""
        u, v, w = (int(triangles[t, (k + i) % 3]) for i in range(3))
        other = owner.get((v, u))
        if other is None:
            return None
        d = int(next(i for i in triangles[other] if i not in (u, v)))
        if (w, d) in owner or (d, w) in owner:
            return None
        made = np.array([(u, d, w), (d, v, w)], dtype=np.int64)
        lie = normal(triangles[other])
        if any(normal(tri) @ lie < 0.5 for tri in made) or altitudes(vertices, made)[0].min() < limit:
            return None
        out = triangles.copy()
        out[t], out[other] = made
        return out

    def slid(t, k, into):
        """The sliver's middle corner made one with the end `into` (0: where the long edge starts)."""
        u, v, w = (int(triangles[t, (k + i) % 3]) for i in range(3))
        touched = (triangles == w).any(axis=1)
        out = np.where(triangles == w, u if into == 0 else v, triangles)
        whole = (out[:, 0] != out[:, 1]) & (out[:, 1] != out[:, 2]) & (out[:, 2] != out[:, 0])
        changed = np.nonzero(touched & whole)[0]
        if not len(changed) or altitudes(vertices, out[changed])[0].min() < limit:
            return None
        # No face may turn over or tip, and the skin must stay one sheet with one rim.
        if any(normal(out[i]) @ normal(triangles[i]) < 0.985 for i in changed):
            return None
        out = out[whole]
        edges = [(int(tri[i]), int(tri[(i + 1) % 3])) for tri in out for i in range(3)]
        rim, open_edges, crowded = rim_of(out)
        if len(set(edges)) != len(edges) or crowded or open_edges != len(rim):
            return None
        return out

    while True:
        height, start = altitudes(vertices, triangles)
        owner = {(int(tri[k]), int(tri[(k + 1) % 3])): t for t, tri in enumerate(triangles) for k in range(3)}
        made = None
        for t in np.argsort(height):
            if height[t] >= limit:
                break
            k = int(start[t])
            made = turned(t, k, owner)
            if made is None:
                made = slid(t, k, 0)
            if made is None:
                made = slid(t, k, 1)
            if made is not None:
                break
        if made is None:
            break
        triangles = made
        mended += 1
    used = np.zeros(len(vertices), dtype=bool)
    used[triangles.ravel()] = True
    renumber = np.cumsum(used) - 1
    return vertices[used], renumber[triangles], mended


# ── What every vertex is shaded by ────────────────────────────────────────────

def facet_normals(vertices, triangles, crease, soften):
    """Split every vertex along the arrises sharper than `crease` degrees.

    Returns (vertices, shading normals, the faces' own normals there, triangles). A corner's own
    normal is the mean of the faces round its vertex that lie within `crease` of the corner's own
    face (weighted by the angle each has there): a flat face stays flat, a rounded arris shades
    round, and a face never takes the light of one two bends away. Corners of a vertex whose
    normals come out within a few degrees of one another (the same to 1/SAME) share it, with
    their mean. The shading normal leans `soften` of the way toward the mean of every face round
    the vertex.
    """
    a, b, c = (vertices[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    face /= np.maximum(np.linalg.norm(face, axis=1, keepdims=True), 1e-20)
    weight = np.zeros((len(triangles), 3))
    for k in range(3):
        u = vertices[triangles[:, (k + 1) % 3]] - vertices[triangles[:, k]]
        v = vertices[triangles[:, (k + 2) % 3]] - vertices[triangles[:, k]]
        cosine = np.einsum("ij,ij->i", u, v) / np.maximum(np.linalg.norm(u, axis=1) * np.linalg.norm(v, axis=1), 1e-20)
        weight[:, k] = np.arccos(np.clip(cosine, -1.0, 1.0))
    limit = math.cos(math.radians(crease)) - 1e-9
    corners = [[] for _ in vertices]
    for t, tri in enumerate(triangles):
        for k in range(3):
            corners[int(tri[k])].append((t, k))
    out_v, out_n, out_cast = [], [], []
    out_t = triangles.copy()
    for v, uses in enumerate(corners):
        if not uses:
            continue
        faces = np.array([face[t] for t, _ in uses])
        weights = np.array([weight[t, k] for t, k in uses])
        whole = (faces * weights[:, None]).sum(axis=0)
        whole = whole / max(np.linalg.norm(whole), 1e-20)
        own = ((faces @ faces.T >= limit) * weights[None, :]) @ faces
        own /= np.maximum(np.linalg.norm(own, axis=1, keepdims=True), 1e-20)
        lean = own * (1.0 - soften) + whole[None, :] * soften
        lean /= np.maximum(np.linalg.norm(lean, axis=1, keepdims=True), 1e-20)
        made = {}
        for j, (t, k) in enumerate(uses):
            key = tuple(int(x) for x in np.round(own[j] * SAME))
            index = made.get(key)
            if index is None:
                index = made[key] = len(out_v)
                out_v.append(vertices[v])
                out_n.append(np.zeros(3))
                out_cast.append(np.zeros(3))
            out_n[index] = out_n[index] + lean[j] * weights[j]
            out_cast[index] = out_cast[index] + own[j] * weights[j]
            out_t[t, k] = index
    out_n, out_cast = np.array(out_n), np.array(out_cast)
    out_n /= np.maximum(np.linalg.norm(out_n, axis=1, keepdims=True), 1e-20)
    out_cast /= np.maximum(np.linalg.norm(out_cast, axis=1, keepdims=True), 1e-20)
    return np.array(out_v), out_n, out_cast, out_t


def hemisphere(count):
    """Cosine-weighted directions about +z (a spiral: the same set every run)."""
    out = []
    for i in range(count):
        u = (i + 0.5) / count
        phi = i * 2.399963229728653
        r = math.sqrt(u)
        out.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(1.0 - u)))
    return np.array(out)


def bake_ao(vertices, normals, triangles):
    """Ambient occlusion per vertex: cosine-weighted rays about its facet's normal against the
    stone itself, a hit counting less the farther off it is."""
    bvh = BVHTree.FromPolygons(vertices.tolist(), triangles.tolist(), all_triangles=True, epsilon=0.0)
    dirs = hemisphere(AO_RAYS)
    ao = np.ones(len(vertices))
    for i, (p, n) in enumerate(zip(vertices, normals)):
        helper = np.array([0.0, 1.0, 0.0]) if abs(n[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
        t = unit(np.cross(helper, n))
        b = np.cross(n, t)
        # Each vertex turns the spiral by its own angle: no pattern is shared between them.
        turn = (i * 0.61803398875) % 1.0 * math.tau
        ct, st = math.cos(turn), math.sin(turn)
        start = Vector(p + n * 0.004)
        dark = 0.0
        for dx, dy, dz in dirs:
            x = dx * ct - dy * st
            y = dx * st + dy * ct
            hit = bvh.ray_cast(start, Vector(t * x + b * y + n * dz), AO_REACH)
            if hit[0] is not None:
                dark += 1.0 - (hit[3] / AO_REACH) ** 2
        ao[i] = 1.0 - dark / AO_RAYS
    return np.clip(1.0 - (1.0 - ao) * AO_GAIN, AO_FLOOR, 1.0)


# ── Build ─────────────────────────────────────────────────────────────────────

def build_stone(scene, name):
    stone = DESIGNS[name]()
    for way, _, deep, centre, reach in stone.chips:
        log(name, "corner off at", [round(float(v), 3) for v in centre], "toward", [round(float(v), 2) for v in way],
            f"depth {deep:.3f} within {reach:.3f}")
    fine_v, fine_t = largest_piece(*polygonise(stone))
    if signed_volume(fine_v, fine_t) < 0:
        fine_t = fine_t[:, ::-1].copy()
    vertices, triangles = cut_and_decimate(scene, name, fine_v, fine_t, TRIANGLES[name])
    if signed_volume(vertices, triangles) < 0:
        triangles = triangles[:, ::-1].copy()
    # Its highest vertex at one, its foot's middle on the axis, its rim at -BURY.
    vertices = vertices / vertices[:, 1].max()
    vertices = vertices - foot_centre(vertices, triangles)
    rim, _, _ = rim_of(triangles)
    vertices[rim, 1] = -BURY
    vertices = np.round(vertices / QUANT)
    assert np.abs(vertices).max() < 32767, "a stone reaches past its quantisation"
    vertices, triangles = compact(vertices * QUANT, triangles)
    vertices, triangles, mended = mend_slivers(vertices, triangles)
    rim, open_edges, crowded = rim_of(triangles)
    split_v, normals, cast, split_t = facet_normals(vertices, triangles, CREASE, SOFTEN)
    ao = bake_ao(split_v, cast, split_t)
    lo, hi = split_v.min(axis=0), split_v.max(axis=0)
    model = {
        "name": name,
        "vertices": split_v,
        "normals": normals,
        "ao": ao,
        "triangles": split_t,
        "min": lo,
        "max": hi,
    }
    report = {
        "fine": [len(fine_v), len(fine_t)],
        "welded": len(vertices),
        "vertices": len(split_v),
        "triangles": len(split_t),
        "rim": len(rim),
        "open_edges": open_edges,
        "crowded_edges": crowded,
        "slivers_mended": mended,
        "slimmest": round(float(altitudes(split_v, split_t)[0].min()), 5),
        "extent": [round(float(v), 4) for v in hi - lo],
        "min": [round(float(v), 4) for v in lo],
        "max": [round(float(v), 4) for v in hi],
        "ao": [round(float(ao.min()), 3), round(float(ao.mean()), 3)],
    }
    assert crowded == 0 and open_edges == len(rim), f"{name}: the skin is not one sheet with one rim {json.dumps(report)}"
    assert len(split_v) <= 900 and 350 <= len(split_t) <= 700, f"{name}: out of its budget"
    return model, report


# ── The module the theme imports ──────────────────────────────────────────────

HEADER = """/* eslint-disable */
/**
 * Parhelion's standing stones: GENERATED by scripts/blender/parhelion_menhirs.py (do not edit by
 * hand; re-bake with Blender: blender --background --python scripts/blender/parhelion_menhirs.py).
 *
 * Three menhirs built by script in Blender and written out as numbers (the theme loads nothing
 * from disk): `tall` (a thin slab with a slanting top), `tooth` (a pointed stone with a spalled
 * flank), `broad` (a squat slab with a notched top on a bed that stands proud of it).
 * Space: x to the frame's right (the stone's broad axis), y up, z toward the eye (its thin axis).
 * A stone is one unit tall: its highest vertex is at y = 1, the ground line is y = 0 and the mesh
 * goes on down to y = -`bury` (open underneath), its foot's middle on x = 0, z = 0.
 * `positions` are whole numbers of `quant` (Int16 range, xyz per vertex); `normals` whole numbers
 * of 1/127 (Int8 range, xyz; vertices are split along every sharp arris, smooth within a face);
 * `ao` 0..255 per vertex (ambient occlusion, 255 in the open); `index` triangles (Uint16 range),
 * wound counter-clockwise seen from outside. `min` and `max` are the vertices' extents.
 */
"""


def integers(values):
    return "[" + ",".join(str(int(v)) for v in values) + "]"


def write_module(path, models):
    names = ", ".join(f"'{model['name']}'" for model in models)
    lines = [HEADER + f"export const PARHELION_MENHIR_NAMES = Object.freeze([{names}]);",
             "",
             "export const PARHELION_MENHIRS = Object.freeze({"]
    for model in models:
        positions = np.round(model["vertices"] / QUANT).astype(np.int64).ravel()
        normals = np.clip(np.round(model["normals"] * 127.0), -127, 127).astype(np.int64).ravel()
        ao = np.clip(np.round(model["ao"] * 255.0), 0, 255).astype(np.int64)
        index = model["triangles"].astype(np.int64).ravel()
        assert np.abs(positions).max() < 32768 and index.max() < 65536
        lines += [
            f"    {model['name']}: {{",
            f"        quant: {QUANT!r},",
            f"        bury: {BURY!r},",
            f"        vertexCount: {len(model['vertices'])},",
            f"        triangleCount: {len(model['triangles'])},",
            f"        min: [{', '.join(repr(round(float(v), 4)) for v in model['min'])}],",
            f"        max: [{', '.join(repr(round(float(v), 4)) for v in model['max'])}],",
            f"        positions: {integers(positions)},",
            f"        normals: {integers(normals)},",
            f"        ao: {integers(ao)},",
            f"        index: {integers(index)},",
            "    },",
        ]
    lines += ["});", ""]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return Path(path).stat().st_size


# ── Previews ──────────────────────────────────────────────────────────────────

SKY = (0.62, 0.72, 0.8)
SNOW = (0.83, 0.87, 0.92)
#: Where the low sun stands in the previews (game space): behind the stones and to their left.
SUN = unit((-0.72, 0.2, -0.66))


def turned(v, degrees):
    """Game-space vectors turned about y as a placed stone is."""
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    v = np.asarray(v, dtype=np.float64)
    return np.stack([v[:, 0] * c + v[:, 2] * s, v[:, 1], -v[:, 0] * s + v[:, 2] * c], axis=1)


def lit(model, turn, snow=False):
    """Near enough to the theme's light to judge the faces by: a dark stone against the sun, the
    sky's light on what looks up or toward the eye, a warm rim where a flank catches the sun."""
    n = turned(model["normals"], turn)
    ao = model["ao"][:, None]
    up = np.clip(n[:, 1] * 0.5 + 0.5, 0.0, 1.0)[:, None]
    eye = np.clip(n[:, 2], 0.0, 1.0)[:, None]
    side = np.clip(n[:, 0] * 0.5 + 0.5, 0.0, 1.0)[:, None]
    sun = np.clip(n @ SUN, 0.0, 1.0)[:, None]
    rock = np.array([0.36, 0.37, 0.4])
    sky = np.array([0.5, 0.62, 0.8]) * (0.1 + 0.62 * up ** 1.5 + 0.2 * eye + 0.16 * side)
    colour = rock * (sky * ao + np.array([1.9, 1.35, 0.7]) * sun * (0.4 + 0.6 * ao))
    if snow:
        lie = np.clip((n[:, 1] - 0.62) / 0.16, 0.0, 1.0)[:, None]
        white = np.array([0.8, 0.86, 0.95]) * (0.45 + 0.4 * up) * (0.5 + 0.5 * ao)
        colour = colour * (1.0 - lie) + white * lie
    return np.clip(colour, 0.0, 1.0)


def previews(scene, models, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    col = bpy.data.collections.new("ParhelionMenhirsPreview")
    scene.collection.children.link(col)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.show_object_outline = False
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = False
    scene.display.render_aa = "16"
    world = bpy.data.worlds.new("ParhelionMenhirsWorld")
    scene.world = world
    scene.view_settings.view_transform = "Standard"
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    cam_data = bpy.data.cameras.new("ParhelionMenhirsCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("ParhelionMenhirsCam", cam_data)
    col.objects.link(cam)
    scene.camera = cam
    # The eye's own view: from the front (Blender's -Y), looking along +Y, z up.
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    cam.location = (0.0, -30.0, 0.0)
    cam_data.clip_end = 100.0
    files = []

    def coloured(name, vertices, triangles, colour, flat):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(to_blender(vertices).tolist(), [], np.asarray(triangles).tolist())
        mesh.update()
        attr = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
        rgba = np.ones((len(vertices), 4))
        rgba[:, :3] = colour
        attr.data.foreach_set("color", rgba.ravel())
        mesh.color_attributes.active_color = attr
        obj = bpy.data.objects.new(name, mesh)
        obj.color = (*flat, 1.0)
        col.objects.link(obj)
        return obj

    def shoot(name, rows, pixels, cell, colour_type, upscale=1, keep=None):
        """`rows` of (model, colour per vertex, turn in degrees, size) on a grid of `cell` (units),
        a unit `pixels` tall; the snow covers what is under each row's ground line."""
        made = []
        width = max(len(r) for r in rows)
        for j, row in enumerate(rows):
            z0 = ((len(rows) - 1) / 2 - j) * cell[1] - 0.46 * cell[1] / 1.24
            for i, (model, colour, turn, size) in enumerate(row):
                obj = coloured(f"pv.{name}.{j}.{i}", model["vertices"], model["triangles"], colour, (0.012, 0.014, 0.02))
                obj.rotation_euler = (0.0, 0.0, math.radians(turn))
                obj.scale = (size, size, size)
                obj.location = ((i - (width - 1) / 2) * cell[0], 0.0, z0)
                made.append(obj)
            half = width * cell[0] * 0.5
            under = z0 - 0.16 * cell[1] / 1.24
            ground = np.array([[-half, z0, 5.0], [half, z0, 5.0], [half, under, 5.0], [-half, under, 5.0]])
            made.append(coloured(f"pv.{name}.{j}.snow", ground, [[0, 1, 2], [0, 2, 3]], np.array(SNOW), SNOW))
        cam_data.ortho_scale = max(width * cell[0], len(rows) * cell[1])
        scene.render.resolution_x = int(round(width * cell[0] * pixels))
        scene.render.resolution_y = int(round(len(rows) * cell[1] * pixels))
        scene.render.resolution_percentage = 100
        world.color = SKY
        scene.display.shading.color_type = colour_type
        path = out / f"{name}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        for obj in made:
            discard(obj)
        files.append(str(path))
        if upscale > 1:
            big = out / f"{keep}.png"
            enlarge(path, big, upscale)
            files.append(str(big))

    views = (0.0, 70.0)
    shoot("menhirs-large", [[(m, lit(m, turn), turn, 1.0) for m in models] for turn in views], 500, (0.84, 1.24), "VERTEX")
    shoot("menhirs-snow", [[(m, lit(m, turn, snow=True), turn, 1.0) for m in models] for turn in (0.0, 70.0, -55.0)],
          400, (0.84, 1.24), "VERTEX")
    # Each face in the colour of its normal (where the vertices are split, and where they are
    # not), and the occlusion alone.
    shoot("menhirs-faces", [[(m, turned(m["normals"], turn) * 0.5 + 0.5, turn, 1.0) for m in models] for turn in views]
          + [[(m, np.repeat(m["ao"][:, None] ** 2.2, 3, axis=1), turn, 1.0) for m in models] for turn in views],
          300, (0.84, 1.24), "VERTEX")
    black = np.zeros(3)
    rows = [[(m, black, turn, px / 70.0) for turn in (0.0, 70.0, 90.0) for m in models] for px in (70, 30, 14)]
    shoot("menhirs-game-size-1x", rows, 70, (0.74, 1.24), "OBJECT", upscale=5, keep="menhirs-game-size")
    return files


def enlarge(path, to, factor):
    image = bpy.data.images.load(str(path))
    w, h = image.size
    px = np.array(image.pixels[:]).reshape(h, w, 4)
    big = np.repeat(np.repeat(px, factor, axis=0), factor, axis=1)
    made = bpy.data.images.new("enlarged", w * factor, h * factor, alpha=True)
    made.pixels = big.ravel().tolist()
    made.filepath_raw = str(to)
    made.file_format = "PNG"
    made.save()
    bpy.data.images.remove(image)
    bpy.data.images.remove(made)


# ── Entry ─────────────────────────────────────────────────────────────────────

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

    def arg(flag, default=None):
        return argv[argv.index(flag) + 1] if flag in argv else default

    names = [n for n in (arg("--only") or ",".join(NAMES)).split(",") if n in DESIGNS]
    out_dir = Path(arg("--out", str(OUT)))
    scene = bpy.data.scenes.new(SCENE)
    models = []
    report = {}
    for name in names:
        model, report[name] = build_stone(scene, name)
        models.append(model)
        log(name, json.dumps(report[name]))
    if len(names) == len(NAMES):
        size = write_module(out_dir / MODULE, models)
        log("wrote", out_dir / MODULE, f"{size / 1024:.1f} KiB")
    else:
        log("--only builds previews; the module needs every stone")
    preview_dir = arg("--preview")
    if preview_dir:
        for f in previews(scene, models, preview_dir):
            log("preview", f)
    # The stones stay in the scene, side by side and upright, for whoever opens it.
    for i, model in enumerate(models):
        obj = mesh_object(scene, f"menhir.{model['name']}", model["vertices"], model["triangles"])
        obj.location = ((i - (len(models) - 1) / 2) * 0.8, 0.0, 0.0)
    blend = arg("--blend")
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
        log("saved", blend)


if __name__ == "__main__":
    main()
