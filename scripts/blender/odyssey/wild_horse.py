"""Odyssey's island horses: a wild horse and her foal, modelled and rigged procedurally in headless Blender.

    blender -b --factory-startup --python scripts/blender/odyssey/wild_horse.py -- \
        --out src/rendering/odyssey/assets/chapter-03/horses/wild-horses.glb [--preview <dir>]

A small band of wild horses grazes the island's open meadows in chapters 3-4, seen from the rail
well over a hundred metres off and drawn at three times life (like the rest of the act's life). What
has to read at forty to eighty pixels is a HORSE, not a deer: a heavy, straight-profiled head on a
short, thick neck carried low, an upright dark mane along its crest, a deep barrel, a round rump and
a full tail falling to the hocks, sturdy legs on round hooves. The type is the steppe's wild horse
(Przewalski's horse, the Konik, the Exmoor pony): stocky, about 1.36 m at the withers. The foal is a
two- or three-month foal: about 1.0 m at the withers, most of it legs, a short body and neck, a big
short head, a short fuzzy tail and a brush of a mane.

How it is made (the deer's pipeline, scripts/blender/odyssey/red_deer.py, with the Grainfields
horse's proportions, scripts/blender/grainfields/horse.py, simplified to the deer's detail):

- **Shape.** A signed distance field of ellipsoids and round cones joined by smooth unions: the
  barrel, chest, shoulders, withers, back, quarters and thighs; the neck's core under its crest, the
  mane a narrow ridge standing on the crest; the head as cranium, forehead, jowls, face, muzzle,
  lips and chin, the eyes; small cupped ears; each leg a tube through its joints (forearm or gaskin,
  knee or hock, cannon, fetlock, pastern) to a round hoof; the tail a dock and a thick fall. The legs
  are a little thicker than life (`thick`) so that, drawn small, they stay solid lines. The foal is
  the same design through a few numbers (`FOAL`): its body and neck scaled down and lifted onto
  longer legs, its head shorter in the face.
- **Mesh.** The field's left half is sampled on a grid, polygonised with surface nets, projected
  onto the zero set, decimated in Blender with a quadric edge collapse, cleaned of folds and
  mirrored, so each animal is exactly symmetric.
- **Skeleton.** Twenty-nine bones (BONES): the root, the pelvis and the chest; three neck bones, the
  head (at the poll), the jaw, the ears; three down the tail; each fore leg's humerus, forearm,
  cannon and hoof; each hind leg's femur, tibia, cannon and hoof (the deer's leg chains: the hoof
  bone's head is the fetlock). Every bone rests aligned with the animal's own axes (x left, y up,
  z forward), so a pose is a rotation of each bone about its head in its parent's frame
  (R = Ry Rz Rx).
- **Skin.** Up to four bones a vertex (`_BONES`, `_WEIGHTS`), as the deer's.
- **Paint.** COLOR_0 = (pale, points, black, sky seen), masks the game tints by coat (bay, dun,
  grey): the mealy muzzle, the pale belly and the insides of the legs, round the eyes; the mane,
  the tail, the lower legs, a thin dorsal stripe and the ear rims; the hooves, eyes and nostrils;
  ambient occlusion traced through the field.
- **Previews** (never shipped): `--preview <dir>` renders both animals, their poses and a game-size
  view in three coats.

Frame: metres at real size, +z forward (toward the head), +y up, the hooves on y = 0, the body
centred on x = 0; the animal faces +z, so its left side is +x. No external asset is used.
"""

import json
import math
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from grainfields.horse_sdf import (  # noqa: E402
    X_AXIS, Z_AXIS, Ellipsoid, HalfSpace, RoundCone, Tube, Union,
    _grid, _neighbours, _point, _smoothstep, _unit, collapse_bad, decimate, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)
from grainfields.horse import occlusion  # noqa: E402

TAG = "[odyssey-horses]"
SPECIES = "Wild horse (Equus ferus, the Przewalski / Konik / Exmoor type): a mare and a foal"
GENERATOR = "Serenity Blocks - Odyssey wild horses (scripts/blender/odyssey/wild_horse.py)"
SCHEMA_VERSION = 1

PARTS = {"body": 0, "neck": 1, "head": 2, "frontLeft": 3, "frontRight": 4, "hindLeft": 5, "hindRight": 6,
         "tail": 7, "earLeft": 8, "earRight": 9, "mane": 10}

# The adult's neck rises from here (y, z) on the chest; it is turned down from the Grainfields
# horse's raised carriage by `drop` (a wild horse at rest carries its head low).
NECK_BASE = (1.10, 0.54)


def _rot_x(dy, dz, angle):
    """Turn (dy, dz) down and forward by `angle` (radians) about the x axis."""
    c, s = math.cos(angle), math.sin(angle)
    return dy * c - dz * s, dz * c + dy * s


ADULT = dict(
    name="horse",
    voxel=0.0105,
    target=2400,
    # The body: (x, y, z) scale and a lift, applied to the adult's design.
    body=(1.0, 1.0, 1.0, 0.0),
    # The neck: turned down by `drop` degrees about its base, then (y, z) scaled about the mapped base,
    # its radii scaled.
    neck=dict(drop=12.0, scale=0.93, radius=1.1),
    # The head: size, how much the face is shortened beyond the eye, its pitch below the horizontal.
    head=dict(scale=1.04, face=0.97, pitch=50.0, ears=0.95),
    mane=dict(offset=0.022, radius=0.056, squash=0.5),
    # Legs: x apart, z of the cannon line, heights of the joints, thickness (tubes and joints).
    fore=dict(x=0.14, z=0.445, top=0.90, elbow=0.82, knee=0.415, fetlock=0.118, thick=1.18, joints=1.1,
              shoulder=(1.00, 0.50)),
    hind=dict(x=0.15, z=-0.698, top=0.82, stifle=0.75, hock=0.49, fetlock=0.118, thick=1.18, joints=1.1,
              hip=(0.99, -0.58)),
    # The tail: the dock and the fall (y, z), their radii; its three bones' heads.
    tail=dict(
        dock=[(1.24, -0.72), (1.17, -0.83), (1.07, -0.875)], dockR=[0.066, 0.06, 0.054],
        fall=[(1.15, -0.865), (1.06, -0.95), (0.92, -1.012), (0.74, -1.035), (0.58, -1.042), (0.47, -1.045)],
        fallR=[0.062, 0.092, 0.112, 0.108, 0.092, 0.064], squash=0.62,
        bones=[(1.22, -0.76), (0.92, -1.01), (0.70, -1.035)],
    ),
)

FOAL = dict(
    name="foal",
    voxel=0.0085,
    target=1800,
    body=(0.56, 0.6, 0.6, 0.21),
    neck=dict(drop=0.0, scale=0.62, radius=0.58),
    head=dict(scale=0.8, face=0.8, pitch=46.0, ears=1.15),
    mane=dict(offset=0.012, radius=0.034, squash=0.55),
    fore=dict(x=0.092, z=0.267, top=0.70, elbow=0.64, knee=0.36, fetlock=0.10, thick=0.7, joints=0.8,
              shoulder=(0.81, 0.30)),
    hind=dict(x=0.097, z=-0.42, top=0.68, stifle=0.62, hock=0.42, fetlock=0.10, thick=0.7, joints=0.8,
              hip=(0.80, -0.35)),
    tail=dict(
        dock=[(0.954, -0.432), (0.912, -0.498), (0.86, -0.525)], dockR=[0.04, 0.038, 0.036],
        fall=[(0.90, -0.52), (0.82, -0.565), (0.71, -0.585), (0.60, -0.59), (0.53, -0.59)],
        fallR=[0.04, 0.056, 0.062, 0.056, 0.04], squash=0.7,
        bones=[(0.94, -0.45), (0.78, -0.57), (0.65, -0.588)],
    ),
)


class Build:
    """One animal's design numbers and the maps from the adult's frame into its own."""

    def __init__(self, spec):
        self.spec = spec
        bx, by, bz, lift = spec["body"]
        self.bx, self.by, self.bz, self.lift = bx, by, bz, lift
        neck = spec["neck"]
        self.drop = math.radians(neck["drop"])
        self.ns = neck["scale"]
        self.nr = neck["radius"]
        self.base = self.bp(*NECK_BASE)
        head = spec["head"]
        self.hs = head["scale"]
        self.face = head["face"]
        pitch = math.radians(head["pitch"])
        self.HF = np.array([0.0, -math.sin(pitch), math.cos(pitch)])
        self.HU = np.array([0.0, math.cos(pitch), math.sin(pitch)])
        # The poll: the Grainfields horse's (1.80, 1.04) through the neck map.
        self.POLL = self.np_(1.80, 1.04)
        self.ATLAS = self.np_(1.745, 0.97)

    # The body map: the adult's (y, z, x) to this animal's point, and radii.
    def bp(self, y, z, x=0.0):
        return _point(self.by * y + self.lift, self.bz * z, self.bx * x)

    def br(self, radii):
        rx, ry, rz = radii
        return (rx * self.bx, ry * self.by, rz * self.bz)

    def bra(self, radii):
        """Radii of an ellipsoid turned onto a direction (its y and z mix the body's axes)."""
        rx, ry, rz = radii
        m = 0.5 * (self.by + self.bz)
        return (rx * self.bx, ry * m, rz * m)

    # The neck map: turned down about the adult's base, then scaled about this animal's base.
    def np_(self, y, z, x=0.0):
        dy, dz = _rot_x(y - NECK_BASE[0], z - NECK_BASE[1], self.drop)
        return self.base + np.array([x * self.nr, dy * self.ns, dz * self.ns])

    def head_point(self, s, t, x=0.0):
        s_eff = s if s < 0.12 else 0.12 + (s - 0.12) * self.face
        return self.POLL + self.hs * (s_eff * self.HF + t * self.HU + np.array([x, 0.0, 0.0]))

    def head_radii(self, *values):
        return tuple(self.hs * v for v in values)

    def ear_base(self, side):
        return self.head_point(0.0, 0.035, 0.06 * side)

    @staticmethod
    def ear_direction(side):
        return _unit((0.22 * side, 0.95, 0.2))

    # -- the skeleton ----------------------------------------------------------------------
    def bones(self):
        s = self.spec
        fore, hind, tail = s["fore"], s["hind"], s["tail"]
        bones = [
            ("root", None, tuple(self.bp(1.00, -0.05))),
            ("pelvis", "root", tuple(self.bp(1.12, -0.30))),
            ("chest", "root", tuple(self.bp(1.12, 0.18))),
            ("neck0", "chest", tuple(self.np_(1.10, 0.48))),
            ("neck1", "neck0", tuple(self.np_(1.33, 0.68))),
            ("neck2", "neck1", tuple(self.np_(1.55, 0.84))),
            ("head", "neck2", tuple(self.ATLAS)),
            ("jaw", "head", tuple(self.head_point(0.10, -0.095))),
            ("earL", "head", tuple(self.ear_base(1.0))),
            ("earR", "head", tuple(self.ear_base(-1.0))),
            ("tail0", "pelvis", (0.0, *tail["bones"][0])),
            ("tail1", "tail0", (0.0, *tail["bones"][1])),
            ("tail2", "tail1", (0.0, *tail["bones"][2])),
        ]
        for side, tag in ((1.0, "L"), (-1.0, "R")):
            x = fore["x"] * side
            z = fore["z"]
            bones += [
                ("humerus" + tag, "chest", (x, *fore["shoulder"])),
                ("forearm" + tag, "humerus" + tag, (x, fore["elbow"], z + 0.005 * self.bz)),
                ("foreCannon" + tag, "forearm" + tag, (x, fore["knee"], z)),
                ("foreHoof" + tag, "foreCannon" + tag, (x, fore["fetlock"], z)),
            ]
        for side, tag in ((1.0, "L"), (-1.0, "R")):
            x = hind["x"] * side
            z = hind["z"]
            bones += [
                ("femur" + tag, "pelvis", (x, *hind["hip"])),
                ("tibia" + tag, "femur" + tag, (x * 1.13, hind["stifle"], z + 0.238 * self.bz)),
                ("hindCannon" + tag, "tibia" + tag, (x, hind["hock"], z)),
                ("hindHoof" + tag, "hindCannon" + tag, (x, hind["fetlock"], z)),
            ]
        return [(name, parent, tuple(float(v) for v in head)) for name, parent, head in bones]

    # -- the legs ---------------------------------------------------------------------------
    def _leg_y(self, leg, front):
        """The adult's leg heights onto this animal's (piecewise linear through the joints)."""
        if front:
            src = [0.0, 0.118, 0.415, 0.82, 0.90]
            dst = [0.0, leg["fetlock"], leg["knee"], leg["elbow"], leg["top"]]
        else:
            src = [0.0, 0.118, 0.49, 0.75, 0.82]
            dst = [0.0, leg["fetlock"], leg["hock"], leg["stifle"], leg["top"]]
        return lambda y: float(np.interp(y, src, dst, right=dst[-1] + (y - src[-1])))

    def front_leg(self, side):
        leg = self.spec["fore"]
        x = leg["x"] * side
        z = leg["z"]
        Y = self._leg_y(leg, True)
        k = leg["thick"]
        j = leg["joints"]
        dz = self.bz if self.bz < 1 else 1.0
        P = lambda y, oz=0.0, xs=1.0: _point(Y(y), z + oz * dz, x * xs)  # noqa: E731
        return Union([
            # The forearm, muscled under the elbow and lean above the knee; the point of the elbow.
            Ellipsoid(P(0.76, 0.015), (0.08 * k, 0.088 * k, 0.14 * k), along=(0.0, 1.0, 0.04)),
            Tube([P(0.88, 0.01), P(0.62, 0.005), P(0.45)], [0.085 * k, 0.068 * k, 0.048 * k],
                 squash_axis=X_AXIS, squash=0.86),
            Ellipsoid(P(0.835, -0.065, 1.02), (0.05 * k, 0.06 * k, 0.06 * k)),
            # The knee, the cannon, the fetlock, the pastern and the round hoof.
            Ellipsoid(P(0.415), (0.05 * j, 0.056 * j, 0.054 * j)),
            Tube([P(0.40, -0.002), P(0.15, -0.003)], [0.042 * k, 0.04 * k], squash_axis=X_AXIS, squash=0.82),
            Ellipsoid(P(0.118, -0.003), (0.047 * j, 0.05 * j, 0.056 * j)),
            Tube([P(0.115), P(0.06, 0.022)], [0.038 * k, 0.042 * k]),
            RoundCone(P(0.075, 0.026), P(0.012, 0.04), 0.046 * j, 0.062 * j),
        ], k=0.03 * min(1.0, k))

    def hind_leg(self, side):
        leg = self.spec["hind"]
        x = leg["x"] * side
        z = leg["z"]
        Y = self._leg_y(leg, False)
        k = leg["thick"]
        j = leg["joints"]
        dz = self.bz if self.bz < 1 else 1.0
        P = lambda y, oz=0.0, xs=1.0: _point(Y(y), z + oz * dz, x * xs)  # noqa: E731
        return Union([
            # The gaskin from the stifle down and back to the hock, with its muscle behind.
            Tube([P(0.80, 0.25, 1.12), P(0.66, 0.13), P(0.50, 0.005)], [0.105 * k, 0.082 * k, 0.055 * k],
                 squash_axis=X_AXIS, squash=0.78),
            Ellipsoid(P(0.72, 0.12), (0.06 * k, 0.078 * k, 0.115 * k), along=(0.0, 0.66, 0.75)),
            # The hock and its point.
            Ellipsoid(P(0.49, 0.002), (0.048 * j, 0.064 * j, 0.066 * j)),
            Ellipsoid(P(0.53, -0.058), (0.03 * j, 0.043 * j, 0.032 * j)),
            # The cannon, the fetlock, the pastern and the hoof.
            Tube([P(0.47, -0.002), P(0.15, 0.002)], [0.044 * k, 0.041 * k], squash_axis=X_AXIS, squash=0.82),
            Ellipsoid(P(0.118, 0.002), (0.047 * j, 0.05 * j, 0.055 * j)),
            Tube([P(0.115, -0.002), P(0.06, 0.02)], [0.037 * k, 0.041 * k]),
            RoundCone(P(0.075, 0.022), P(0.012, 0.036), 0.045 * j, 0.06 * j),
        ], k=0.03 * min(1.0, k))

    # -- the animal -----------------------------------------------------------------------
    def design(self):
        """The animal as a distance field, and the landmarks the paint and the skin use."""
        E = lambda y, z, radii, x=0.0, along=None: Ellipsoid(  # noqa: E731
            self.bp(y, z, x), self.br(radii) if along is None else self.bra(radii), along=along)
        body = Union([
            # The deep barrel and the round belly under it.
            E(0.97, -0.03, (0.29, 0.31, 0.50)),
            E(0.86, -0.06, (0.28, 0.2, 0.38)),
            # The girth and the chest, the shoulders sloping up to the withers, and their points.
            E(0.99, 0.26, (0.26, 0.30, 0.28)),
            E(0.99, 0.52, (0.20, 0.24, 0.22)),
            *[(E(1.12, 0.48, (0.15, 0.12, 0.29), 0.10 * s, along=(0.0, 0.60, -0.80)), 0.1) for s in (1.0, -1.0)],
            *[(E(1.0, 0.655, (0.07, 0.085, 0.075), 0.125 * s), 0.07) for s in (1.0, -1.0)],
            (E(1.225, 0.30, (0.10, 0.12, 0.22), along=(0.0, 0.25, 0.97)), 0.1),
            # A broad back and loins, a little below the withers and the croup.
            E(1.165, -0.08, (0.22, 0.11, 0.33)),
            # The round quarters, the croup falling to the tail, the points of the hip and the buttock,
            # the stifles and the thighs down to the gaskins.
            E(1.04, -0.49, (0.285, 0.275, 0.31)),
            (E(1.195, -0.42, (0.19, 0.115, 0.27), along=(0.0, 0.30, 0.95)), 0.1),
            *[(E(1.11, -0.30, (0.055, 0.06, 0.07), 0.2 * s), 0.08) for s in (1.0, -1.0)],
            *[(E(0.80, -0.42, (0.085, 0.115, 0.10), 0.17 * s), 0.08) for s in (1.0, -1.0)],
            *[(E(0.88, -0.63, (0.14, 0.14, 0.21), 0.14 * s, along=(0.0, -0.848, 0.53)), 0.08) for s in (1.0, -1.0)],
        ], k=0.12 * min(1.0, 0.5 * (self.by + self.bz) + 0.2)).tag(PARTS["body"])

        # The neck: a deep, tapering core under an arched crest (the Grainfields horse's), turned down.
        N = self.np_
        nr = self.nr
        core_line = [(1.10, 0.54), (1.25, 0.70), (1.40, 0.84), (1.53, 0.95), (1.64, 1.04)]
        core = Tube([N(y, z) for y, z in core_line], [r * nr for r in (0.25, 0.215, 0.178, 0.152, 0.132)],
                    squash_axis=X_AXIS, squash=[0.76, 0.76, 0.78, 0.8, 0.84], k=0.03)
        crest_line = [(1.33, 0.28), (1.485, 0.46), (1.62, 0.66), (1.72, 0.86), (1.79, 1.01)]
        crest_radii = [0.10, 0.10, 0.09, 0.08, 0.07]
        crest_centres = _offset_line(crest_line, [-r for r in crest_radii])
        crest = Tube([N(y, z) for y, z in crest_centres], [r * nr for r in crest_radii],
                     squash_axis=X_AXIS, squash=0.9, k=0.03)

        # The mane: an upright brush standing on the crest, from the withers to the poll.
        mane_spec = self.spec["mane"]
        mane_line = [(1.36, 0.33)] + crest_line[1:4] + [(1.78, 0.97)]
        mane_centres = _offset_line(mane_line, [mane_spec["offset"] / max(nr, 1e-6)] * len(mane_line))
        mane_r = mane_spec["radius"]
        mane = Tube([N(y, z) for y, z in mane_centres], [mane_r * 0.8, mane_r, mane_r * 1.05, mane_r, mane_r * 0.8],
                    squash_axis=X_AXIS, squash=mane_spec["squash"], k=0.02).tag(PARTS["mane"])

        # A big, straight-profiled head: a broad forehead, a heavy round jowl, a straight face that
        # keeps its width to a square, soft muzzle.
        H = self.head_point
        R = self.head_radii
        HF = self.HF
        head = Union([
            Ellipsoid(H(0.11, -0.05), R(0.122, 0.12, 0.15), along=HF),                    # cranium
            Ellipsoid(H(0.15, 0.0), R(0.118, 0.045, 0.13), along=HF),                     # forehead
            Ellipsoid(H(0.12, -0.18), R(0.12, 0.155, 0.15), along=HF),                    # jowls
            RoundCone(H(0.20, -0.045), H(0.44, -0.058), *R(0.102, 0.084), (X_AXIS, 0.82)),  # face
            Ellipsoid(H(0.47, -0.08), R(0.074, 0.08, 0.075), along=HF),                    # muzzle
            Ellipsoid(H(0.515, -0.104), R(0.06, 0.038, 0.045), along=HF),                  # upper lip
            Ellipsoid(H(0.465, -0.14), R(0.045, 0.032, 0.048), along=HF),                  # chin
            RoundCone(H(0.20, -0.225, 0.045), H(0.43, -0.13, 0.035), *R(0.05, 0.034)),
            RoundCone(H(0.20, -0.225, -0.045), H(0.43, -0.13, -0.035), *R(0.05, 0.034)),
            *[Ellipsoid(H(0.13, -0.005, 0.104 * s), R(0.024, 0.028, 0.032), along=HF)
              for s in (1.0, -1.0)],                                                       # eyes
            *[Ellipsoid(H(0.11, 0.026, 0.095 * s), R(0.022, 0.013, 0.04), along=HF)
              for s in (1.0, -1.0)],                                                       # brows
        ], k=0.045 * self.hs).tag(PARTS["head"])

        # Small ears, cupped: up, a little forward and out.
        ears = []
        el = self.spec["head"]["ears"] * self.hs
        for side, part in ((1.0, PARTS["earLeft"]), (-1.0, PARTS["earRight"])):
            base = self.ear_base(side)
            direction = self.ear_direction(side)
            across = _unit(np.array(Z_AXIS) - direction * direction[2])
            ear = Tube([base, base + 0.075 * el * direction, base + 0.155 * el * direction],
                       [0.046 * el, 0.042 * el, 0.012 * el], squash_axis=across, squash=0.55, k=0.01).tag(part)
            for leaf in ear.leaves():
                leaf.ear = True
            ears.append(ear)

        # The tail: the dock arches off the croup; the hair falls full from it, clear of the buttocks
        # and the hocks, so it lifts and swishes on its own.
        t = self.spec["tail"]
        dock = Tube([_point(y, z) for y, z in t["dock"]], t["dockR"])
        fall = Tube([_point(y, z) for y, z in t["fall"]], t["fallR"], squash_axis=Z_AXIS, squash=t["squash"], k=0.02)
        tail = Union([dock, (fall, 0.04)]).tag(PARTS["tail"])

        legs = []
        for leg, name in zip([self.front_leg(1.0), self.front_leg(-1.0), self.hind_leg(1.0), self.hind_leg(-1.0)],
                             ("frontLeft", "frontRight", "hindLeft", "hindRight")):
            leg.tag(PARTS[name])
            legs.append(leg)
        neck = Union([(core, 0.0), (crest, 0.08)]).tag(PARTS["neck"])
        k = min(1.0, self.ns + 0.15)
        root = HalfSpace(Union([
            (body, 0.0), (neck, 0.1 * k), (mane, 0.03 * k), (head, 0.07 * k), *[(ear, 0.025) for ear in ears],
            *[(leg, 0.07 * min(1.0, self.bz + 0.2)) for leg in legs], (tail, 0.025),
        ]), axis=1)
        landmarks = dict(
            muzzle=H(0.545, -0.08),
            nostrils=[H(0.50, -0.045, 0.058 * s) for s in (1.0, -1.0)],
            mouth=H(0.53, -0.125),
            chin=H(0.465, -0.15),
            eyes=[H(0.13, -0.005, 0.124 * s) for s in (1.0, -1.0)],
            # The neck's axis (y, z) from its base to the atlas.
            neckAxis=(N(1.195, 0.545)[1:], self.ATLAS[1:]),
        )
        return root, landmarks


def _offset_line(line, offsets):
    """Stations moved off a (y, z) polyline along its upper-back normal by `offsets`."""
    line = np.asarray(line, dtype=np.float64)
    out = []
    for index, (y, z) in enumerate(line):
        before = line[max(0, index - 1)]
        after = line[min(len(line) - 1, index + 1)]
        tangent = _unit(after - before)
        normal = np.array([tangent[1], -tangent[0]])  # (dy, dz) -> up and back
        out.append((y + normal[0] * offsets[index], z + normal[1] * offsets[index]))
    return out


# -- regions, weights, paint ----------------------------------------------------------------
def regions(shape, positions, triangles):
    """Each vertex's part: the part of the nearest primitive, cleaned by its neighbours' votes."""
    leaves = shape.leaves()
    distances = np.stack([leaf.eval(positions) for leaf in leaves], axis=1)
    parts = np.array([leaves[i].part for i in np.argmin(distances, axis=1)])
    neighbours = _neighbours(len(positions), triangles)
    for _ in range(3):
        votes = parts.copy()
        for v, around in enumerate(neighbours):
            if len(around) < 3:
                continue
            values, counts = np.unique(parts[around], return_counts=True)
            best = values[np.argmax(counts)]
            if best != parts[v] and counts.max() >= 0.6 * len(around):
                votes[v] = best
        parts = votes
    return parts


def _segment_t(points, a, b):
    ab = np.asarray(b) - np.asarray(a)
    return np.clip(((points - a) @ ab) / max(ab @ ab, 1e-12), 0.0, 1.0)


def _chain(y, joints, names, band):
    """Weights down a chain by height: each joint blends its two bones over +-band."""
    out = {}
    count = len(names)
    upper = np.ones_like(y)
    for j, height in enumerate(joints):
        below = _smoothstep(height + band, height - band, y)
        out[names[j]] = upper * (1.0 - below)
        upper = upper * below
    out[names[count - 1]] = upper
    return out


def skin(build, bone_list, positions, parts, triangles, landmarks, smoothing=4):
    index = {name: i for i, (name, _p, _h) in enumerate(bone_list)}
    heads = {name: np.asarray(h) for name, _p, h in bone_list}
    count = len(positions)
    weights = np.zeros((count, len(bone_list)))
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    spec = build.spec
    bz = build.bz

    def put(mask, name, value):
        weights[mask, index[name]] += value[mask] if np.ndim(value) else value

    trunk = parts == PARTS["body"]
    w_chest = _smoothstep(-0.05 * bz, 0.30 * bz, z)
    w_pelvis = _smoothstep(-0.12 * bz, -0.45 * bz, z)
    w_root = np.clip(1.0 - w_chest - w_pelvis, 0.0, 1.0)
    put(trunk, "chest", w_chest)
    put(trunk, "pelvis", w_pelvis)
    put(trunk, "root", w_root)

    # The neck (and the mane on it) down three bones to the head; the head whole but for its jaw.
    neckish = np.isin(parts, [PARTS["neck"], PARTS["mane"]])
    a, b = (np.asarray(p) for p in landmarks["neckAxis"])
    t = _segment_t(positions[:, 1:], a, b)
    knots = [float(_segment_t(np.array([heads[n][1:]]), a, b)[0]) for n in ("neck1", "neck2", "head")]
    chain = _chain(-t, [-knots[0], -knots[1], -knots[2]], ["neck0", "neck1", "neck2", "head"], 0.07)
    w_base = _smoothstep(0.24, 0.0, t)
    for name, value in chain.items():
        put(neckish, name, value * (1.0 - 0.6 * w_base))
    put(neckish, "chest", w_base * 0.6)
    head_part = parts == PARTS["head"]
    rel = positions - build.POLL
    s_h = (rel @ build.HF) / build.hs
    t_h = (rel @ build.HU) / build.hs
    w_jaw = _smoothstep(-0.12, -0.15, t_h) * _smoothstep(0.24, 0.32, s_h)
    put(head_part, "head", 1.0 - w_jaw)
    put(head_part, "jaw", w_jaw)
    put(parts == PARTS["earLeft"], "earL", 1.0)
    put(parts == PARTS["earRight"], "earR", 1.0)

    # The tail down its three bones by height, its root into the pelvis.
    tail = parts == PARTS["tail"]
    tb = spec["tail"]["bones"]
    band = 0.06 * build.by
    tchain = _chain(y, [tb[1][0], tb[2][0]], ["tail0", "tail1", "tail2"], band)
    dock_z = spec["tail"]["dock"][0][1]
    w_root_tail = _smoothstep(dock_z - 0.03 * bz, dock_z + 0.05 * bz, z)
    for name, value in tchain.items():
        put(tail, name, value * (1.0 - w_root_tail))
    put(tail, "pelvis", w_root_tail)

    # The legs down their chains, the top faded into the trunk across a band.
    fore, hind = spec["fore"], spec["hind"]
    for tag in ("L", "R"):
        leg = parts == PARTS["frontLeft" if tag == "L" else "frontRight"]
        chain = _chain(y, [fore["elbow"], fore["knee"], fore["fetlock"]],
                       ["humerus" + tag, "forearm" + tag, "foreCannon" + tag, "foreHoof" + tag], 0.035)
        into = _smoothstep(fore["elbow"] - 0.02, fore["elbow"] + 0.16 * build.by, y)
        for name, value in chain.items():
            put(leg, name, value * (1.0 - into))
        put(leg, "chest", into)
        leg = parts == PARTS["hindLeft" if tag == "L" else "hindRight"]
        chain = _chain(y, [hind["stifle"], hind["hock"], hind["fetlock"]],
                       ["femur" + tag, "tibia" + tag, "hindCannon" + tag, "hindHoof" + tag], 0.035)
        into = _smoothstep(hind["stifle"] + 0.11 * build.by, hind["stifle"] + 0.29 * build.by, y)
        for name, value in chain.items():
            put(leg, name, value * (1.0 - into))
        put(leg, "pelvis", into)

    # The trunk over the tops of the legs follows them a little (the shoulder and the thigh).
    fz, hz = fore["z"], hind["z"]
    for tag, side in (("L", 1.0), ("R", -1.0)):
        near = trunk & (x * side > 0.05 * build.bx) & (y < fore["elbow"] + 0.18 * build.by)
        reach = (_smoothstep(fore["elbow"] + 0.18 * build.by, fore["elbow"] - 0.02, y)
                 * _smoothstep(fz - 0.25 * bz, fz - 0.1 * bz, z) * _smoothstep(fz + 0.22 * bz, fz + 0.08 * bz, z))
        weights[near, index["humerus" + tag]] += 0.6 * reach[near]
        near = trunk & (x * side > 0.05 * build.bx) & (y < hind["stifle"] + 0.26 * build.by)
        reach = (_smoothstep(hind["stifle"] + 0.26 * build.by, hind["stifle"] - 0.02, y)
                 * _smoothstep(hz + 0.42 * bz, hz + 0.28 * bz, z) * _smoothstep(hz - 0.12 * bz, hz + 0.02 * bz, z))
        weights[near, index["femur" + tag]] += 0.6 * reach[near]

    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-9)
    neighbours = _neighbours(count, triangles)
    for _ in range(smoothing):
        mean = np.stack([weights[around].mean(axis=0) if len(around) else weights[v]
                         for v, around in enumerate(neighbours)])
        weights = 0.5 * weights + 0.5 * mean
    order = np.argsort(-weights, axis=1)[:, :4]
    top = np.take_along_axis(weights, order, axis=1)
    top /= np.maximum(top.sum(axis=1, keepdims=True), 1e-9)
    quant = np.floor(top * 255.0).astype(np.int64)
    quant[:, 0] += 255 - quant.sum(axis=1)
    return order.astype(np.uint8), quant.astype(np.uint8)


def paint(build, shape, landmarks, positions, normals, parts):
    """COLOR_0 = (pale, points, black, sky seen): masks the game tints by coat."""
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    spec = build.spec
    fore, hind = spec["fore"], spec["hind"]
    hs = build.hs
    front = np.isin(parts, [PARTS["frontLeft"], PARTS["frontRight"]])
    back = np.isin(parts, [PARTS["hindLeft"], PARTS["hindRight"]])
    legs = front | back
    ears = np.isin(parts, [PARTS["earLeft"], PARTS["earRight"]])
    body = parts == PARTS["body"]
    head = parts == PARTS["head"]
    dist = lambda p: np.linalg.norm(positions - np.asarray(p), axis=1)  # noqa: E731
    # PALE: the mealy muzzle, round the eyes, the belly and the flanks' underside, the insides of the
    # upper legs.
    muzzle = head * _smoothstep(0.15 * hs, 0.07 * hs, dist(landmarks["muzzle"]))
    eye_ring = np.maximum.reduce([_smoothstep(0.075 * hs, 0.045 * hs, dist(e)) for e in landmarks["eyes"]]) * 0.75
    low = build.lift + build.by * 0.80
    belly = body * _smoothstep(low + 0.06 * build.by, low - 0.08 * build.by, y) * _smoothstep(0.1, -0.5, normals[:, 1])
    inside = legs * _smoothstep(0.0, -0.8, normals[:, 0] * np.sign(x + 1e-9)) * _smoothstep(
        fore["knee"] + 0.05, fore["knee"] + 0.2, y) * 0.55
    pale = np.clip(np.maximum.reduce([muzzle, eye_ring * head, belly * 0.85, inside]), 0.0, 1.0)
    # POINTS: the mane, the tail, the lower legs (dark from below the knee and hock, fading up), a thin
    # dorsal stripe along the spine and the ear rims.
    mane = (parts == PARTS["mane"]) * 1.0
    tail = (parts == PARTS["tail"]) * 1.0
    fore_pts = front * _smoothstep(fore["knee"] + 0.09 * build.by, fore["knee"] - 0.02, y)
    hind_pts = back * _smoothstep(hind["hock"] + 0.08 * build.by, hind["hock"] - 0.02, y)
    dorsal = (body * _smoothstep(0.55, 0.85, normals[:, 1]) * _smoothstep(0.07 * build.bx, 0.0, np.abs(x))
              * _smoothstep(-0.6 * build.bz, -0.45 * build.bz, z) * 0.7)
    ear_rim = ears * _smoothstep(0.09, 0.15, dist(build.ear_base(1.0) * np.array([0, 1, 1]))
                                 / max(build.spec["head"]["ears"] * hs, 1e-6)) * 0.8
    points = np.clip(np.maximum.reduce([mane, tail, fore_pts, hind_pts, dorsal, ear_rim]), 0.0, 1.0)
    # BLACK: the hooves, the eyes, the nostrils.
    hooves = legs * _smoothstep(0.072, 0.052, y)
    eyes = np.maximum.reduce([_smoothstep(0.05 * hs, 0.026 * hs, dist(e)) for e in landmarks["eyes"]])
    nostrils = np.maximum.reduce([_smoothstep(0.042 * hs, 0.02 * hs, dist(n)) for n in landmarks["nostrils"]])
    black = np.clip(np.maximum.reduce([hooves, eyes * head, nostrils * head * 0.85]), 0.0, 1.0)
    seen = occlusion(shape, positions, normals, rays=20, reach=0.8, ground=0.7)
    return np.stack([pale, points, black, seen], axis=1)


# -- the build ----------------------------------------------------------------------------
class Animal:
    def __init__(self, build, positions, normals, colors, triangles, parts, bones, weights, bone_list, stats,
                 landmarks):
        self.build = build
        self.positions, self.normals, self.colors, self.triangles = positions, normals, colors, triangles
        self.parts, self.bones, self.weights = parts, bones, weights
        self.bone_list, self.stats, self.landmarks = bone_list, stats, landmarks
        self.index = {name: i for i, (name, _p, _h) in enumerate(bone_list)}
        self.heads = np.array([h for _n, _p, h in bone_list], dtype=np.float64)
        self.parents = np.array([-1 if p is None else self.index[p] for _n, p, _h in bone_list])

    def measures(self):
        body = self.positions[self.parts == PARTS["body"]]
        bz = self.build.bz
        withers = body[(body[:, 2] > 0.1 * bz) & (body[:, 2] < 0.55 * bz)]
        return dict(withersHeight=float(withers[:, 1].max()), length=float(np.ptp(self.positions[:, 2])),
                    height=float(self.positions[:, 1].max()))

    def skeleton(self):
        return [dict(name=name, parent=int(self.parents[i]), head=[round(float(v), 4) for v in head])
                for i, (name, _parent, head) in enumerate(self.bone_list)]

    def record(self):
        return dict(name=self.build.spec["name"], triangles=int(len(self.triangles)),
                    vertices=int(len(self.positions)), bones=len(self.bone_list),
                    **{key: round(value, 4) for key, value in self.measures().items()})


def build(studio, spec):
    """Polygonise and decimate the left half, mirror it, then paint and skin the whole animal."""
    started = time.time()
    b = Build(spec)
    voxel = spec["voxel"]
    shape, landmarks = b.design()
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    dense = project(half, dense, iterations=2, limit=voxel)
    dense, dense_triangles = open_half(shape, dense, dense_triangles)
    positions, triangles = decimate(studio, dense, dense_triangles, spec["target"] // 2)
    seam = rim(len(positions), triangles)
    positions[~seam] = project(shape, positions[~seam], iterations=3, limit=voxel)
    positions[seam] = on_seam(shape, positions[seam])
    positions[:, 1] = np.maximum(positions[:, 1], 0.0)
    positions, triangles, seam = collapse_bad(shape, positions, triangles, seam)
    positions, folds = untangle(shape, positions, triangles, seam)
    positions[positions[:, 1] < 5e-4, 1] = 0.0
    positions, triangles, seam = split_seam_chords(shape, positions, triangles, seam)
    positions, triangles = mirror(positions, triangles, seam)
    grad = gradient(shape, positions)
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    parts = regions(shape, positions, triangles)
    colors = paint(b, shape, landmarks, positions, normals, parts)
    bone_list = b.bones()
    bones, weights = skin(b, bone_list, positions, parts, triangles, landmarks)
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense_triangles=len(dense_triangles), vertices=len(positions),
                 triangles=len(triangles), folds=folds, total_s=round(time.time() - started, 1))
    point = lambda value: [round(float(v), 4) for v in value]  # noqa: E731
    marks = dict(muzzle=point(landmarks["muzzle"]), eyes=[point(p) for p in landmarks["eyes"]],
                 nostrils=[point(p) for p in landmarks["nostrils"]], poll=point(b.POLL),
                 headForward=point(b.HF), headUp=point(b.HU))
    animal = Animal(b, positions, normals, colors, triangles, parts, bones, weights, bone_list, stats, marks)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s %s %s -> %d tris %d verts (%d folds); x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f; %s %.1fs" % (
        TAG, spec["name"], "x".join(str(n) for n in stats["grid"]), stats["triangles"], stats["vertices"], folds,
        low[0], high[0], low[1], high[1], low[2], high[2],
        {key: round(value, 3) for key, value in animal.measures().items()}, stats["total_s"]), flush=True)
    return animal


def write(path, animals):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=GENERATOR)
    for animal in animals:
        writer.add_mesh(animal.build.spec["name"], {
            "POSITION": (animal.positions, False),
            "NORMAL": (glb.quantize_unit(animal.normals, np.int8), True),
            "COLOR_0": (glb.quantize_unit(animal.colors, np.uint8), True),
            "_BONES": (animal.bones, True),
            "_WEIGHTS": (animal.weights, True),
        }, indices=animal.triangles)
    names = [a.build.spec["name"] for a in animals]
    writer.set_extras(dict(
        schemaVersion=SCHEMA_VERSION,
        species=SPECIES,
        skeletons={n: a.skeleton() for n, a in zip(names, animals)},
        records={n: a.record() for n, a in zip(names, animals)},
        color={"r": "pale (mealy muzzle, round the eyes, belly, inner legs)",
               "g": "points (mane, tail, lower legs, dorsal stripe, ear rims)",
               "b": "black (hooves, eyes, nostrils)", "a": "sky seen (ambient occlusion)"},
        skin={"_BONES": "four bone indices / 255", "_WEIGHTS": "their weights (sum 1)",
              "pose": "each bone rests aligned with the animal's axes; a pose turns it about its head (R = Ry Rz Rx)"},
        landmarks={n: a.landmarks for n, a in zip(names, animals)},
        bounds={n: dict(min=[float(v) for v in a.positions.min(axis=0)], max=[float(v) for v in a.positions.max(axis=0)])
                for n, a in zip(names, animals)},
    ))
    return writer.write(path)


# -- poses and previews (never shipped) ----------------------------------------------------
def rotation(rx=0.0, ry=0.0, rz=0.0):
    """Ry . Rz . Rx: pitch about the bone's x first, then roll, then yaw (the runtime's order)."""
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, sz, 0], [-sz, cz, 0], [0, 0, 1]])
    return Ry @ Rz @ Rx


def pose_frames(animal, local):
    count = len(animal.bone_list)
    world_r = np.zeros((count, 3, 3))
    world_t = np.zeros((count, 3))
    for i, (name, _parent, _head) in enumerate(animal.bone_list):
        L = rotation(*local.get(name, (0.0, 0.0, 0.0)))
        parent = animal.parents[i]
        if parent < 0:
            world_r[i] = L
            world_t[i] = animal.heads[i]
        else:
            world_r[i] = world_r[parent] @ L
            world_t[i] = world_t[parent] + world_r[parent] @ (animal.heads[i] - animal.heads[parent])
    return world_r, world_t


def pose_matrices(animal, local):
    world_r, world_t = pose_frames(animal, local)
    matrices = np.zeros((len(world_r), 3, 4))
    matrices[:, :, :3] = world_r
    matrices[:, :, 3] = world_t - np.einsum("bij,bj->bi", world_r, animal.heads)
    return matrices


def skin_vertices(animal, matrices):
    w = animal.weights.astype(np.float64) / 255.0
    out_p = np.zeros_like(animal.positions)
    out_n = np.zeros_like(animal.normals)
    for k in range(4):
        M = matrices[animal.bones[:, k].astype(np.int64)]
        out_p += w[:, k:k + 1] * (np.einsum("nij,nj->ni", M[:, :, :3], animal.positions) + M[:, :, 3])
        out_n += w[:, k:k + 1] * np.einsum("nij,nj->ni", M[:, :, :3], animal.normals)
    return out_p, out_n / np.maximum(np.linalg.norm(out_n, axis=1), 1e-9)[:, None]


def graze_angles(animal, dip=0.06):
    """The neck's three bones and the head's local x angles that bring the muzzle to the grass, the
    face near vertical (a grid search on the rest skeleton): the bend spread down the neck."""
    muzzle_rest = np.asarray(animal.landmarks["muzzle"])
    head_i = animal.index["head"]
    best = None
    for a in np.linspace(0.2, 2.2, 101):
        for h in np.linspace(-2.6, 0.6, 81):
            local = dict(root=(dip, 0, 0), neck0=(a, 0, 0), neck1=(0.3 * a, 0, 0), neck2=(0.22 * a, 0, 0),
                         head=(h, 0, 0))
            R, T = pose_frames(animal, local)
            m = T[head_i] + R[head_i] @ (muzzle_rest - animal.heads[head_i])
            face = R[head_i] @ np.asarray(animal.landmarks["headForward"])
            angle = math.degrees(math.atan2(face[1], face[2]))  # below the horizontal is negative
            # The ground under the dipped body: the root's pitch lowers the front a little.
            cost = (m[1] - 0.03) ** 2 * 100 + ((angle + 72.0) / 30.0) ** 2 + 0.05 * a * a
            if best is None or cost < best[0]:
                best = (cost, a, h, m, angle)
    _cost, a, h, m, angle = best
    return dict(root=round(dip, 3), neck0=round(float(a), 3), neck1=round(float(0.3 * a), 3),
                neck2=round(float(0.22 * a), 3), head=round(float(h), 3), muzzle=[round(float(v), 3) for v in m],
                faceDegrees=round(angle, 1))


COATS = {
    "bay": (np.array([0.20, 0.085, 0.035]), np.array([0.02, 0.016, 0.014]), np.array([0.42, 0.30, 0.18])),
    "dun": (np.array([0.42, 0.32, 0.18]), np.array([0.05, 0.035, 0.025]), np.array([0.70, 0.62, 0.48])),
    "grey": (np.array([0.50, 0.50, 0.49]), np.array([0.16, 0.16, 0.17]), np.array([0.68, 0.68, 0.66])),
}
BLACK = np.array([0.02, 0.018, 0.016])


def _albedo(colors, coat):
    body, points, pale_c = COATS[coat]
    pale, pts, black, seen = (colors[:, i:i + 1] for i in range(4))
    base = body * (1 - pale) + pale_c * pale
    base = base * (1 - pts) + points * pts
    base = base * (1 - black) + BLACK * black
    return np.clip(base * (0.45 + 0.55 * seen), 0.0, 1.0)


def walk_pose():
    return dict(neck0=(0.12, 0, 0), humerusL=(-0.32, 0, 0), foreCannonL=(0.9, 0, 0), foreHoofL=(0.4, 0, 0),
                humerusR=(0.22, 0, 0), femurL=(0.25, 0, 0), femurR=(-0.3, 0, 0), hindCannonR=(-0.6, 0, 0),
                hindHoofR=(0.45, 0, 0), tail0=(-0.15, 0, 0), tail1=(0.1, 0.15, 0), tail2=(0.1, 0.2, 0))


def gallop_pose():
    return dict(root=(-0.08, 0, 0), neck0=(0.35, 0, 0), head=(-0.2, 0, 0),
                humerusL=(-0.75, 0, 0), foreCannonL=(1.6, 0, 0), foreHoofL=(0.8, 0, 0),
                humerusR=(-0.35, 0, 0), foreCannonR=(0.4, 0, 0),
                femurL=(0.55, 0, 0), hindCannonL=(-0.3, 0, 0), femurR=(0.85, 0, 0), hindCannonR=(-0.8, 0, 0),
                tail0=(-0.7, 0, 0), tail1=(-0.25, 0, 0), tail2=(-0.15, 0, 0), earL=(-0.4, 0, 0), earR=(-0.4, 0, 0))


def previews(animals, directory):
    import bpy
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    studio.setup_preview(sun_direction=(-0.46, 0.36, 0.61), sun_strength=4.0, sky=(0.5, 0.62, 0.8), sky_strength=0.8)
    ground = studio.mesh_object("ground", np.array([[-60, 0, -60], [60, 0, -60], [60, 0, 60], [-60, 0, 60]],
                                                   dtype=float), np.array([[0, 2, 1], [0, 3, 2]]))
    ground.data.materials.append(studio.material("grass", vertex_color=False, base=(0.09, 0.2, 0.05)))
    material = studio.material("horse", roughness=0.85)
    horse, foal = animals
    graze = {a.build.spec["name"]: graze_angles(a) for a in animals}

    def place(animal, local, offset, coat, name, heading=0.0):
        p, n = skin_vertices(animal, pose_matrices(animal, local))
        R = rotation(0, heading, 0)
        p = p @ R.T + np.asarray(offset)
        n = n @ R.T
        obj = studio.mesh_object(name, p, animal.triangles, colors=_albedo(animal.colors, coat))
        obj.data.normals_split_custom_set_from_vertices([tuple(v) for v in to_blender(n)])
        obj.data.materials.append(material)
        return obj

    def graze_local(animal):
        g = graze[animal.build.spec["name"]]
        return dict(root=(g["root"], 0, 0), neck0=(g["neck0"], 0, 0), neck1=(g["neck1"], 0, 0),
                    neck2=(g["neck2"], 0, 0), head=(g["head"], 0, 0), earL=(0.2, 0.3, -0.2), earR=(0.2, -0.3, 0.2),
                    tail1=(0.0, 0.25, 0))

    objects = []
    # The lineup: the mare at rest, grazing, walking, galloping; the foal at rest and grazing.
    lineup = [(horse, {}, "dun"), (horse, graze_local(horse), "bay"), (horse, walk_pose(), "grey"),
              (horse, gallop_pose(), "dun"), (foal, {}, "dun"), (foal, graze_local(foal), "bay")]
    for i, (animal, local, coat) in enumerate(lineup):
        objects.append(place(animal, local, (0.0, 0.0, (2.5 - i) * 2.9), coat, "pose%d" % i))
    studio.render(directory / "horse-poses.png", eye=(16.0, 2.2, 0.0), target=(0.0, 0.8, 0.0), lens=34,
                  size=(1400, 520), samples=16)
    for obj in objects:
        obj.hide_render = True
    # Close-ups: the dun mare with her foal, side, three-quarter front, behind, the head.
    singles = [place(horse, {}, (0.0, 0.0, 0.0), "dun", "mare"),
               place(foal, {}, (-1.3, 0.0, -0.4), "dun", "foal")]
    views = {
        "close-side": ((5.2, 1.2, 0.0), (0.0, 0.95, 0.0), 45),
        "close-front34": ((2.8, 1.9, 4.2), (-0.4, 0.95, 0.2), 45),
        "close-behind": ((-1.6, 1.8, -5.0), (-0.4, 0.95, -0.4), 45),
        "close-head": ((1.6, 1.7, 2.2), (0.0, 1.4, 1.1), 45),
    }
    for name, (eye, target, lens) in views.items():
        studio.render(directory / ("horse-%s.png" % name), eye=eye, target=target, lens=lens, size=(720, 480),
                      samples=16)
    for obj in singles:
        obj.hide_render = True
    # At game size: a 3x horse from ~150 m is a life-size horse from ~50 m; the frame is a 640x180 crop
    # of a 2560x1440 view whose vertical field is 7.1 degrees here (lens 81.5 on a 640-wide frame).
    row = [(horse, {}, "bay", 0.0), (foal, {}, "bay", 0.4), (horse, graze_local(horse), "dun", 0.3),
           (foal, graze_local(foal), "dun", -0.2), (horse, walk_pose(), "grey", 0.0), (horse, gallop_pose(), "dun", 0.0)]
    for i, (animal, local, coat, heading) in enumerate(row):
        place(animal, local, (0.0, 0.0, (2.5 - i) * 3.3), coat, "game%d" % i, heading)
    studio.render(directory / "horse-game.png", eye=(43.0, 26.0, 6.0), target=(0.0, 0.7, 0.0), lens=81.5,
                  size=(640, 180), samples=16)
    small = bpy.data.images.load(str(directory / "horse-game.png"))
    w, h = small.size
    pixels = np.array(small.pixels[:], dtype=np.float32).reshape(h, w, 4)
    up = np.repeat(np.repeat(pixels, 3, axis=0), 3, axis=1)
    out = bpy.data.images.new("horse-game-x3", w * 3, h * 3, alpha=True)
    out.pixels.foreach_set(up.reshape(-1))
    out.filepath_raw = str(directory / "horse-game-x3.png")
    out.file_format = "PNG"
    out.save()
    studio.dispose()
    (directory / "graze.json").write_text(json.dumps(graze, indent=1))
    return graze


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {}
    for key, value in zip(arguments[::2], arguments[1::2]):
        options[key.lstrip("-")] = value
    out = Path(options.get("out", "wild-horses.glb"))
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Odyssey - Horse Atelier"
    studio_module.PREFIX = "SODY_"
    studio = studio_module.Studio()
    try:
        animals = [build(studio, ADULT), build(studio, FOAL)]
        out.parent.mkdir(parents=True, exist_ok=True)
        size = write(out, animals)
        print("%s wrote %s (%d bytes) %s" % (TAG, out, size, json.dumps([a.record() for a in animals])), flush=True)
    finally:
        studio.dispose()
    if options.get("preview"):
        graze = previews(animals, Path(options["preview"]))
        print("%s graze %s" % (TAG, json.dumps(graze)), flush=True)
        print("%s previews in %s" % (TAG, options["preview"]), flush=True)


if __name__ == "__main__":
    main()
