"""The people's bodies as signed distances: a body of ellipsoids and round cones fixed to the
rig's bones, garments made from the body regions they cover (inflated and cut at hems and
cuffs), hair styles, and the few props a clip needs (a phone, a dumbbell, a stool).

Everything is described at rest (rig.REST) and carried into a pose shape by shape, so a body is
rebuilt for every frame from the posed skeleton: joints stay whole however far they bend, and a
sleeve follows its arm. Shapes come from the Grainfields horse's distance-field kit
(grainfields/horse_sdf.py): the exact round cone, the smooth union with box culling.

Each surface belongs to one of seven classes, the channels the sprite sheet stores: skin, hair,
top (the upper garment), bottom (the lower garment), gear (shoes, masks, bags: dark and matte),
chrome (cyber limbs, metal) and glow (LED trims, visors, implants: lit from within).
"""

import math

import numpy as np

from grainfields.horse_sdf import FAR, MARGIN, RoundCone, Shape, Union
from neon_people.rig import BONE, DOWN, REST, SIDES, UP, rot_x, turn, unit

CLASSES = ("skin", "hair", "top", "bottom", "gear", "chrome", "glow")


class Ellipsoid(Shape):
    """An ellipsoid with a full frame (columns: its local x, y, z axes in the world)."""

    def __init__(self, centre, radii, frame=None):
        self.centre = np.asarray(centre, dtype=np.float64)
        self.radii = np.asarray(radii, dtype=np.float64)
        self.frame = np.eye(3) if frame is None else np.asarray(frame, dtype=np.float64)

    def bounds(self):
        reach = float(self.radii.max())
        return self.centre - reach, self.centre + reach

    def eval(self, p):
        q = (p - self.centre) @ self.frame
        k0 = np.linalg.norm(q / self.radii, axis=1)
        k1 = np.linalg.norm(q / (self.radii * self.radii), axis=1)
        return np.where(k1 > 1e-9, k0 * (k0 - 1.0) / np.maximum(k1, 1e-9), -float(self.radii.min()))

    def eval_block(self, xs, ys, zs):
        grid = np.stack(np.meshgrid(xs, ys, zs, indexing="ij"), axis=-1).reshape(-1, 3)
        return self.eval(grid).reshape(len(xs), len(ys), len(zs))


class Cut(Shape):
    """A shape cut by planes: each (point, normal) removes the side the normal points to."""

    def __init__(self, child, planes):
        self.child = child
        self.planes = [(np.asarray(p, dtype=np.float64), unit(n)) for p, n in planes]

    def leaves(self):
        return self.child.leaves()

    def bounds(self):
        return self.child.bounds()

    def eval(self, p):
        d = self.child.eval(p)
        for point, normal in self.planes:
            d = np.maximum(d, (p - point) @ normal)
        return d

    def eval_block(self, xs, ys, zs):
        d = self.child.eval_block(xs, ys, zs)
        for point, normal in self.planes:
            d = np.maximum(d, (xs[:, None, None] - point[0]) * normal[0] + (ys[None, :, None] - point[1]) * normal[1]
                           + (zs[None, None, :] - point[2]) * normal[2])
        return d


class Inflate(Shape):
    def __init__(self, child, amount):
        self.child, self.amount = child, float(amount)

    def leaves(self):
        return self.child.leaves()

    def bounds(self):
        low, high = self.child.bounds()
        return low - self.amount, high + self.amount

    def eval(self, p):
        return self.child.eval(p) - self.amount

    def eval_block(self, xs, ys, zs):
        return self.child.eval_block(xs, ys, zs) - self.amount


class Field(Shape):
    """The person: a hard union of the class fields. `classes(p)` gives each class's distance."""

    def __init__(self, fields):
        self.fields = fields  # {class: Shape or None}

    def bounds(self):
        lows, highs = zip(*(f.bounds() for f in self.fields.values() if f is not None))
        return np.min(lows, axis=0), np.max(highs, axis=0)

    def eval(self, p):
        out = np.full(len(p), FAR)
        for f in self.fields.values():
            if f is not None:
                out = np.minimum(out, _culled(f, p))
        return out

    def eval_block(self, xs, ys, zs):
        out = np.full((len(xs), len(ys), len(zs)), FAR)
        for f in self.fields.values():
            if f is not None:
                out = np.minimum(out, f.eval_block(xs, ys, zs))
        return out

    def classes(self, p):
        return np.stack([_culled(self.fields[c], p) if self.fields.get(c) is not None else np.full(len(p), FAR)
                         for c in CLASSES], axis=1)


def _culled(shape, p):
    low, high = shape.bounds()
    inside = np.all((p >= low - MARGIN) & (p <= high + MARGIN), axis=1)
    out = np.full(len(p), FAR)
    if inside.any():
        out[inside] = shape.eval(p[inside])
    return out


# -- the body at rest -----------------------------------------------------------------------
class Part:
    """One shape of the body at rest, fixed to `bone`, in a `region` garments can cover."""

    def __init__(self, region, bone, kind, k, **params):
        self.region, self.bone, self.kind, self.k, self.params = region, bone, kind, k, params

    def posed(self, P, grow=0.0):
        p = self.params
        if self.kind == "ell":
            frame = P.frame(self.bone, p.get("frame"))
            return Ellipsoid(P.point(self.bone, p["c"]), np.asarray(p["r"]) + grow, frame)
        squash = p.get("squash")
        if squash is not None:
            squash = (P.vector(self.bone, squash[0]), squash[1])
        return RoundCone(P.point(self.bone, p["a"]), P.point(self.bone, p["b"]), p["ra"] + grow, p["rb"] + grow, squash)


def _ell(region, bone, c, r, k=0.02, frame=None):
    return Part(region, bone, "ell", k, c=np.asarray(c, dtype=np.float64), r=np.asarray(r, dtype=np.float64),
                frame=frame)


def _cone(region, bone, a, b, ra, rb, k=0.02, squash=None):
    return Part(region, bone, "cone", k, a=np.asarray(a, dtype=np.float64), b=np.asarray(b, dtype=np.float64),
                ra=float(ra), rb=float(rb), squash=squash)


def _mirror(x, sign):
    return (x[0] * sign, x[1], x[2])


def _parts_a():
    """Build A at rest, by hand from its joints (rig.REST["A"])."""
    J = REST["A"]
    parts = [
        _ell("pelvis", "pelvis", (0.0, 0.008, 0.95), (0.152, 0.1, 0.104), 0.03),
        _ell("pelvis", "pelvis", (0.0, -0.04, 0.985), (0.12, 0.058, 0.08), 0.03),
        _ell("waist", "spine", (0.0, 0.0, 1.09), (0.128, 0.092, 0.12), 0.035),
        _ell("chest", "chest", (0.0, 0.008, 1.29), (0.148, 0.1, 0.172), 0.035),
        _ell("chest", "chest", (0.0, -0.038, 1.335), (0.132, 0.058, 0.082), 0.03),
        _ell("chest", "chest", (0.0, 0.043, 1.33), (0.138, 0.058, 0.118), 0.03),
        _ell("chest", "chest", (0.0, 0.032, 1.418), (0.12, 0.05, 0.045), 0.04),
        _cone("neck", "neck", (0.0, 0.024, 1.43), (0.0, 0.012, 1.58), 0.056, 0.05, 0.03),
        _ell("head", "head", (0.0, 0.014, 1.672), (0.074, 0.093, 0.09), 0.02),
        _ell("head", "head", (0.0, -0.03, 1.622), (0.063, 0.068, 0.078), 0.02),
        _ell("head", "head", (0.0, -0.035, 1.585), (0.056, 0.058, 0.04), 0.02),
        _ell("head", "head", (0.0, -0.071, 1.566), (0.026, 0.022, 0.022), 0.015),
        _cone("head", "head", (0.0, -0.086, 1.649), (0.0, -0.101, 1.625), 0.009, 0.011, 0.01),
        _ell("head", "head", (0.0, -0.071, 1.676), (0.058, 0.02, 0.016), 0.012),
    ]
    for side, sign in SIDES:
        s = sign
        parts += [
            _ell("head", "head", _mirror((0.074, 0.008, 1.64), s), (0.012, 0.024, 0.03), 0.008),
            _ell("pelvis", "pelvis", _mirror((0.072, 0.052, 0.895), s), (0.08, 0.068, 0.088), 0.03),
            _ell("uparm", "uparm_" + side, _mirror((0.182, 0.014, 1.384), s), (0.047, 0.052, 0.058), 0.03),
            _cone("uparm", "uparm_" + side, _mirror((0.188, 0.016, 1.39), s), J["elbow_" + side], 0.043, 0.035, 0.02),
            _ell("uparm", "uparm_" + side, _mirror((0.198, 0.01, 1.27), s), (0.038, 0.037, 0.08), 0.02),
            _cone("chest", "chest", _mirror((0.035, 0.026, 1.468), s), _mirror((0.165, 0.018, 1.42), s), 0.042, 0.034,
                  0.04),
            _cone("forearm", "forearm_" + side, J["elbow_" + side], J["wrist_" + side], 0.038, 0.026, 0.02,
                  squash=((1.0, 0.0, 0.0), 0.8)),
            _ell("forearm", "forearm_" + side, _mirror((0.209, 0.03, 1.05), s), (0.04, 0.042, 0.09), 0.02),
            _ell("hand", "hand_" + side, _mirror((0.215, 0.0, 0.81), s), (0.018, 0.045, 0.056), 0.012),
            _cone("hand", "hand_" + side, _mirror((0.216, -0.002, 0.77), s), _mirror((0.218, -0.008, 0.705), s),
                  0.02, 0.013, 0.012, squash=((1.0, 0.0, 0.0), 0.65)),
            _cone("hand", "hand_" + side, _mirror((0.208, -0.03, 0.835), s), _mirror((0.204, -0.056, 0.778), s),
                  0.012, 0.009, 0.008),
            _cone("thigh", "thigh_" + side, _mirror((0.09, 0.002, 0.93), s), J["knee_" + side], 0.085, 0.05, 0.035),
            _ell("thigh", "thigh_" + side, _mirror((0.096, -0.025, 0.74), s), (0.07, 0.07, 0.17), 0.03),
            _ell("thigh", "thigh_" + side, _mirror((0.086, 0.022, 0.76), s), (0.064, 0.064, 0.15), 0.03),
            _cone("shin", "shin_" + side, J["knee_" + side], J["ankle_" + side], 0.05, 0.033, 0.03),
            _ell("shin", "shin_" + side, _mirror((0.1, 0.03, 0.37), s), (0.048, 0.05, 0.11), 0.025),
            _ell("shin", "shin_" + side, _mirror((0.096, -0.03, 0.5), s), (0.032, 0.022, 0.032), 0.012),
            _ell("foot", "foot_" + side, _mirror((0.1, 0.042, 0.042), s), (0.03, 0.038, 0.042), 0.02),
            _ell("foot", "foot_" + side, _mirror((0.102, -0.035, 0.045), s), (0.036, 0.1, 0.038), 0.025),
            _ell("foot", "foot_" + side, _mirror((0.105, -0.122, 0.03), s), (0.036, 0.05, 0.026), 0.02),
        ]
    return parts


# Build B from A: each part moved with its bone (offsets scaled to B's bone) and its girth set
# per region; the bust and a fuller hip are her own.
GIRTH_B = dict(pelvis=1.03, waist=0.86, chest=0.88, neck=0.84, head=0.95, uparm=0.8, forearm=0.8, hand=0.86,
               thigh=0.98, shin=0.9, foot=0.86)
TORSO_SCALE_B = dict(pelvis=(1.04, 0.95), spine=(0.88, 0.92), chest=(0.88, 0.92))


def _parts_b():
    A, B = REST["A"], REST["B"]
    out = []
    for part in _parts_a():
        bone = part.bone
        head = BONE[bone][1]
        tail = BONE[bone][2]
        la = np.linalg.norm(A[tail] - A[head])
        lb = np.linalg.norm(B[tail] - B[head])
        if bone in TORSO_SCALE_B:
            sx, sy = TORSO_SCALE_B[bone]
            scale = np.array([sx, sy, lb / la])
        elif bone == "head":
            scale = np.full(3, 0.95)
        else:
            scale = np.full(3, lb / la)

        def move(p):
            return B[head] + (np.asarray(p, dtype=np.float64) - A[head]) * scale

        g = GIRTH_B[part.region]
        params = dict(part.params)
        if part.kind == "ell":
            params["c"] = move(params["c"])
            params["r"] = params["r"] * g
            if part.region == "pelvis" and abs(params["c"][0]) > 0.01:  # glutes
                params["r"] = params["r"] * np.array([1.0, 1.08, 1.04])
        else:
            params["a"], params["b"] = move(params["a"]), move(params["b"])
            params["ra"], params["rb"] = params["ra"] * g, params["rb"] * g
            if part.region == "thigh":
                params["ra"] *= 1.02
        out.append(Part(part.region, bone, part.kind, part.k, **params))
    chest = B["chest"]
    for side, sign in SIDES:
        out.append(_ell("chest", "chest", (0.052 * sign, chest[1] - 0.088, chest[2] + 0.07), (0.056, 0.048, 0.052), 0.035))
    return out


BODIES = {"A": _parts_a, "B": _parts_b}


# -- outfits --------------------------------------------------------------------------------
# A garment covers body regions, inflated by `fit` (metres) and cut where it ends; cuts are made
# per region, on that region's own side. A garment is built of pieces that can be rebuilt a few
# millimetres proud, so a glowing trim (a zip, a hem, stripes down the back) can be cut out of
# the garment's own surface and drawn over it.
TOPS = {
    "jacket": dict(fit=0.02, chest=0.006, hem=-0.12, sleeve="long"),
    "coat": dict(fit=0.022, chest=0.006, hem=-0.12, sleeve="long", coat=True),
    "bomber": dict(fit=0.027, chest=0.008, hem=-0.03, sleeve="long"),
    "hoodie": dict(fit=0.022, chest=0.008, hem=-0.1, sleeve="long", hood=True),
    "longsleeve": dict(fit=0.009, chest=0.0, hem=-0.06, sleeve="long"),
    "tee": dict(fit=0.01, chest=0.002, hem=-0.07, sleeve="short"),
    "tank": dict(fit=0.006, chest=0.0, hem=-0.05, sleeve="none"),
    "chef": dict(fit=0.016, chest=0.004, hem=-0.17, sleeve="threequarter"),
}
BOTTOMS = {
    "trousers": dict(fit=0.013, cuff=0.03),
    "jeans": dict(fit=0.011, cuff=0.035),
    "cargo": dict(fit=0.022, cuff=0.025, pockets=True),
    "leggings": dict(fit=0.004, cuff=0.07),
    "shorts": dict(fit=0.014, cuff=None, knee=0.06),
}
TRIM = 0.004


def _side_of(bone):
    return bone[-1] if bone[-2:] in ("_L", "_R") else None


def _piece(make, bone, region, k):
    """A garment piece: `make(extra)` builds it `extra` metres proud."""
    return dict(make=make, bone=bone, region=region, k=k)


def _part_pieces(P, parts, regions, fit, cuts, chest_extra=0.0, skip_sides=()):
    pieces = []
    for part in parts:
        if part.region not in regions:
            continue
        side = _side_of(part.bone)
        if side in skip_sides and part.region in ("uparm", "forearm", "hand"):
            continue
        grow = fit + (chest_extra if part.region == "chest" else 0.0)
        planes = cuts.get((part.region, side), []) + cuts.get((part.region, None), [])

        def make(extra, part=part, grow=grow, planes=planes):
            shape = part.posed(P, grow + extra)
            return Cut(shape, planes) if planes else shape

        k = 0.035 if part.region in ("pelvis", "waist", "chest") else 0.02
        pieces.append(_piece(make, part.bone, part.region, k))
    return pieces


def _plane(P, bone, rest_point, rest_normal):
    return (P.point(bone, rest_point), P.vector(bone, unit(rest_normal)))


def _top(P, parts, name, cyber=(), hood_up=False):
    """The upper garment's pieces and the planes it ends at (for trims)."""
    spec = TOPS[name]
    rest = P.rest
    cuts = {}
    hem = rest["pelvis"] + np.array([0.0, 0.0, spec["hem"]])
    hem_plane = (P.point("pelvis", hem), P.vector("pelvis", DOWN))
    for region in ("pelvis", "waist"):
        cuts[(region, None)] = [hem_plane]
    cuffs = {}
    regions = ["pelvis", "waist", "chest"]
    sleeve = spec["sleeve"]
    if sleeve != "none":
        regions.append("uparm")
        if sleeve != "short":
            regions.append("forearm")
    for side, _sign in SIDES:
        if sleeve == "none":
            continue
        if sleeve == "short":
            elbow, shoulder = rest["elbow_" + side], rest["shoulder_" + side]
            point = shoulder + (elbow - shoulder) * 0.45
            cuts[("uparm", side)] = [_plane(P, "uparm_" + side, point, elbow - shoulder)]
            cuffs[side] = ("uparm_" + side, point, elbow - shoulder, "uparm")
        else:
            share = 0.86 if sleeve == "long" else 0.55
            elbow, wrist = rest["elbow_" + side], rest["wrist_" + side]
            point = elbow + (wrist - elbow) * share
            cuts[("forearm", side)] = [_plane(P, "forearm_" + side, point, wrist - elbow)]
            cuffs[side] = ("forearm_" + side, point, wrist - elbow, "forearm")
    pieces = _part_pieces(P, parts, tuple(regions), spec["fit"], cuts, spec["chest"], skip_sides=cyber)
    # The garment hangs straight from the hips to its hem instead of following into the crotch.
    pelvis = rest["pelvis"]
    girth = (0.168 if P.build == "A" else 0.166) + spec["fit"]
    top_c = pelvis + np.array([0.0, 0.004, 0.09])
    hem_c = pelvis + np.array([0.0, 0.01, spec["hem"] + 0.012])

    def hang(extra):
        return Cut(RoundCone(P.point("pelvis", top_c), P.point("pelvis", hem_c), girth * 0.94 + extra, girth + extra,
                             squash=(P.vector("pelvis", (0.0, 1.0, 0.0)), 0.72)), [hem_plane])

    pieces.append(_piece(hang, "pelvis", "pelvis", 0.05))
    if spec.get("coat"):
        # The skirt of a long coat hangs from the hips (it does not tip with the pelvis) and flares
        # to a flat hem just below the knee; a panel down each thigh lets the leading knee push
        # the coat forward.
        knee_z = 0.5 * (rest["knee_L"][2] + rest["knee_R"][2])
        hem_z = P.J["pelvis"][2] - (pelvis[2] - knee_z) - 0.08
        waist = P.point("pelvis", top_c)
        foot = np.array([waist[0], waist[1] + 0.02, hem_z - 0.02])
        coat_hem = (np.array([0.0, 0.0, hem_z]), np.array([0.0, 0.0, -1.0]))

        def skirt(extra):
            return Cut(RoundCone(waist, foot, girth * 0.96 + extra, girth + 0.08 + extra,
                                 squash=(np.array([0.0, 1.0, 0.0]), 0.68)), [coat_hem])

        pieces.append(_piece(skirt, "pelvis", "skirt", 0.05))
        for side, sign in SIDES:
            hip, knee = rest["hip_" + side], rest["knee_" + side]

            def panel(extra, side=side, hip=hip, knee=knee, sign=sign):
                a = P.point("thigh_" + side, hip + np.array([0.03 * sign, 0.0, -0.08]))
                b = P.point("thigh_" + side, knee + np.array([0.02 * sign, 0.0, 0.0]))
                b = np.array([b[0], b[1] + 0.02, max(b[2] - 0.06, hem_z)])
                return Cut(RoundCone(a, b, 0.1 + extra, 0.085 + extra, squash=(np.array([0.0, 1.0, 0.0]), 0.75)),
                           [coat_hem])

            pieces.append(_piece(panel, "thigh_" + side, "skirt", 0.06))
    if sleeve == "none":
        for side, sign in SIDES:
            a = rest["chest"] + np.array([0.085 * sign, -0.07, 0.17])
            b = rest["chest"] + np.array([0.09 * sign, 0.06, 0.19])
            pieces.append(_piece(lambda extra, a=a, b=b: RoundCone(P.point("chest", a), P.point("chest", b),
                                                                   0.03 + extra, 0.03 + extra), "chest", "chest", 0.02))
    if spec.get("hood") and not hood_up:
        neck = rest["neck"]

        def hood_down(extra):
            return Ellipsoid(P.point("chest", neck + np.array([0.0, 0.07, 0.035])),
                             np.array([0.115, 0.055, 0.06]) + extra, P.frame("chest", rot_x(math.radians(-25.0))))

        pieces.append(_piece(hood_down, "chest", "chest", 0.03))
    return pieces, dict(hem=hem, cuffs=cuffs)


def _bottom(P, parts, name):
    spec = BOTTOMS[name]
    rest = P.rest
    waist = rest["pelvis"] + np.array([0.0, 0.0, 0.045])
    cuts = {("pelvis", None): [(P.point("pelvis", waist), P.vector("pelvis", UP))]}
    regions = ["pelvis", "thigh"]
    for side, _sign in SIDES:
        if spec.get("cuff") is not None:
            regions.append("shin")
            ankle, knee = rest["ankle_" + side], rest["knee_" + side]
            point = ankle + unit(knee - ankle) * spec["cuff"]
            cuts[("shin", side)] = [_plane(P, "shin_" + side, point, ankle - knee)]
        else:
            knee, hip = rest["knee_" + side], rest["hip_" + side]
            point = knee + unit(hip - knee) * spec["knee"]
            cuts[("thigh", side)] = [_plane(P, "thigh_" + side, point, knee - hip)]
    pieces = _part_pieces(P, parts, tuple(set(regions)), spec["fit"], cuts)
    if spec.get("pockets"):
        for side, sign in SIDES:
            c = rest["hip_" + side] + np.array([0.105 * sign, 0.005, -0.2])

            def pocket(extra, side=side, c=c):
                return Ellipsoid(P.point("thigh_" + side, c), np.array([0.03, 0.062, 0.075]) + extra,
                                 P.frame("thigh_" + side))

            pieces.append(_piece(pocket, "thigh_" + side, "thigh", 0.025))
    return pieces


def _trims(P, pieces, kinds, info=None):
    """Glowing trims cut from a garment's own pieces, a few millimetres proud of it."""
    rest = P.rest
    out = []
    for kind in kinds:
        for piece in pieces:
            bone, region = piece["bone"], piece["region"]
            head = rest[BONE[bone][1]]
            planes = None
            if kind == "zip" and region in ("pelvis", "waist", "chest"):
                planes = [_plane(P, bone, head + np.array([0.013, 0.0, 0.0]), (1.0, 0.0, 0.0)),
                          _plane(P, bone, head + np.array([-0.013, 0.0, 0.0]), (-1.0, 0.0, 0.0)),
                          _plane(P, bone, head + np.array([0.0, -0.03, 0.0]), (0.0, 1.0, 0.0)),
                          _plane(P, "chest", rest["neck"] + np.array([0.0, 0.0, -0.03]), (0.0, 0.0, 1.0))]
            elif kind in ("back_L", "back_R") and region in ("pelvis", "waist", "chest"):
                x = 0.072 if kind == "back_L" else -0.072
                planes = [_plane(P, bone, head + np.array([x + 0.016, 0.0, 0.0]), (1.0, 0.0, 0.0)),
                          _plane(P, bone, head + np.array([x - 0.016, 0.0, 0.0]), (-1.0, 0.0, 0.0)),
                          _plane(P, bone, head + np.array([0.0, 0.03, 0.0]), (0.0, -1.0, 0.0)),
                          _plane(P, "chest", rest["neck"] + np.array([0.0, 0.0, -0.05]), (0.0, 0.0, 1.0))]
            elif kind == "hem" and info is not None and region in ("pelvis", "waist"):
                hem = info["hem"]
                planes = [_plane(P, "pelvis", hem + np.array([0.0, 0.0, 0.022]), (0.0, 0.0, 1.0))]
            elif kind == "cuffs" and info is not None and region in ("uparm", "forearm"):
                side = _side_of(bone)
                cuff = info["cuffs"].get(side)
                if cuff is not None and cuff[3] == region:
                    cbone, point, direction, _region = cuff
                    planes = [_plane(P, cbone, point - unit(direction) * 0.022, -np.asarray(direction))]
            elif kind == "legs" and region in ("thigh", "shin"):
                side = _side_of(bone)
                sign = 1.0 if side == "L" else -1.0
                if region == "thigh":
                    a = rest["hip_" + side] + np.array([sign * 0.085 * 0.86, 0.0, 0.0])
                    b = rest["knee_" + side] + np.array([sign * 0.05 * 0.86, 0.0, 0.0])
                else:
                    a = rest["knee_" + side] + np.array([sign * 0.05 * 0.86, 0.0, 0.0])
                    b = rest["ankle_" + side] + np.array([sign * 0.033 * 0.86, 0.0, 0.0])
                n = unit(np.cross(b - a, np.array([0.0, 1.0, 0.0]))) * sign
                if n[0] * sign < 0:
                    n = -n
                planes = [_plane(P, bone, a, -n)]
            if planes is None:
                continue

            def stripe(piece=piece, planes=planes):
                return Cut(piece["make"](TRIM), planes)

            out.append((stripe(), 0.0))
    return out


def _shoes(P, parts, glow_soles=False):
    rest = P.rest
    gear, glow = [], []
    for side, sign in SIDES:
        ankle = rest["ankle_" + side]
        cut = [(P.point("foot_" + side, ankle + np.array([0.0, 0.0, 0.025])), P.vector("foot_" + side, UP))]
        for part in parts:
            if part.region == "foot" and part.bone.endswith(side):
                gear.append((Cut(part.posed(P, 0.013), cut), 0.02))
        sole = Ellipsoid(P.point("foot_" + side, np.array([ankle[0], ankle[1] - 0.06, 0.014])), (0.05, 0.145, 0.016),
                         P.frame("foot_" + side))
        (glow if glow_soles else gear).append((sole, 0.012))
    return gear, glow


def _hair(P, style):
    if style is None:
        return []
    rest = P.rest
    h = rest["head"]
    s = 1.0 if P.build == "A" else 0.95

    def at(x, y, z):
        return P.point("head", h + np.array([x, y, z]) * s)

    cranium_c = np.array([0.0, -0.002, 0.107])
    cranium_r = np.array([0.074, 0.093, 0.09]) * s
    frame = P.frame("head")
    face = [(at(0.0, -0.064, 0.13), P.vector("head", unit((0.0, -0.78, -0.62)))),
            (at(0.0, 0.0, 0.06), P.vector("head", unit((0.0, -0.42, -1.0))))]
    shapes = []
    if style in ("buzz", "mohawk", "undercut"):
        shapes.append((Cut(Ellipsoid(at(*cranium_c), cranium_r + 0.004, frame), face), 0.0))
        if style == "mohawk":
            crest = Ellipsoid(at(0.0, 0.004, 0.2), np.array([0.017, 0.1, 0.06]) * s, frame)
            shapes.append((Cut(crest, [(at(0.0, 0.0, 0.15), P.vector("head", DOWN))]), 0.02))
        if style == "undercut":
            top = Ellipsoid(at(0.012, -0.012, 0.178), np.array([0.07, 0.096, 0.05]) * s,
                            P.frame("head", turn(roll=-8.0)))
            shapes.append((Cut(top, [(at(0.0, 0.0, 0.142), P.vector("head", DOWN))]), 0.03))
    elif style in ("short", "ponytail", "bun"):
        cap = Ellipsoid(at(0.0, 0.0, 0.112), cranium_r + np.array([0.012, 0.014, 0.016]), frame)
        shapes.append((Cut(cap, face), 0.0))
    elif style == "bob":
        cap = Union([
            (Ellipsoid(at(0.0, 0.004, 0.1), cranium_r + np.array([0.024, 0.022, 0.02]), frame), 0.03),
            (Ellipsoid(at(0.0, 0.02, 0.03), np.array([0.092, 0.09, 0.075]) * s, frame), 0.04),
        ])
        planes = [(at(0.0, -0.062, 0.05), P.vector("head", unit((0.0, -1.0, 0.12)))),
                  (at(0.0, 0.0, -0.025), P.vector("head", unit((0.0, -0.25, -1.0))))]
        shapes.append((Cut(cap, planes), 0.0))
        # A blunt fringe across the brow.
        fringe = Ellipsoid(at(0.0, -0.06, 0.14), np.array([0.075, 0.03, 0.035]) * s, frame)
        shapes.append((Cut(fringe, [(at(0.0, 0.0, 0.115), P.vector("head", DOWN))]), 0.02))
    else:
        raise ValueError(style)
    if style == "ponytail":
        swing = turn(*P.extras.get("hair_swing", (0.0, 0.0, 0.0)))
        root = at(0.0, 0.088, 0.085)
        tail = [np.array(v) * s for v in ((0.0, 0.035, -0.03), (0.0, 0.03, -0.12), (0.0, 0.012, -0.2))]
        points = [root] + [root + P.R["head"] @ swing @ v for v in tail]
        radii = (0.03, 0.032, 0.024, 0.012)
        for a, b, ra, rb in zip(points, points[1:], radii, radii[1:]):
            shapes.append((RoundCone(a, b, ra, rb), 0.02))
    if style == "bun":
        shapes.append((Ellipsoid(at(0.0, 0.07, 0.17), (0.045, 0.042, 0.04), frame), 0.02))
    return shapes


def _head_gear(P, kinds):
    """Things worn on the head: returns {class: [(shape, k)]}."""
    rest = P.rest
    h = rest["head"]
    s = 1.0 if P.build == "A" else 0.95
    out = {"top": [], "gear": [], "glow": []}

    def at(x, y, z):
        return P.point("head", h + np.array([x, y, z]) * s)

    def vec(x, y, z):
        return P.vector("head", unit((x, y, z)))

    frame = P.frame("head")
    cranium_r = np.array([0.074, 0.093, 0.09]) * s
    for kind in kinds:
        if kind == "visor":
            band = Ellipsoid(at(0.0, -0.026, 0.082), np.array([0.085, 0.095, 0.019]) * s, frame)
            out["glow"].append((Cut(band, [(at(0.0, -0.035, 0.0), vec(0.0, 1.0, 0.0))]), 0.0))
        elif kind == "mask":
            out["gear"].append((Ellipsoid(at(0.0, -0.078, 0.016), np.array([0.05, 0.045, 0.04]) * s, frame), 0.015))
            for sign in (1.0, -1.0):
                out["gear"].append((RoundCone(at(0.032 * sign, -0.1, 0.004), at(0.05 * sign, -0.108, -0.012),
                                              0.016 * s, 0.017 * s), 0.01))
        elif kind == "eye":
            out["glow"].append((Ellipsoid(at(-0.03, -0.083, 0.083), np.array([0.013, 0.008, 0.009]) * s, frame), 0.0))
        elif kind == "implants":
            for sign in (1.0, -1.0):
                out["glow"].append((Ellipsoid(at(0.074 * sign, -0.03, 0.105), np.array([0.006, 0.012, 0.006]) * s,
                                              frame), 0.0))
            out["glow"].append((RoundCone(at(0.0, 0.07, 0.0), at(0.0, 0.06, -0.07), 0.006, 0.006), 0.0))
        elif kind == "earpiece":
            out["glow"].append((Ellipsoid(at(-0.082, 0.0, 0.08), np.array([0.008, 0.014, 0.016]) * s, frame), 0.0))
        elif kind == "headband":
            band = Ellipsoid(at(0.0, -0.002, 0.107), cranium_r + 0.008, frame)
            out["gear"].append((Cut(band, [(at(0.0, 0.0, 0.15), vec(0.0, 0.0, 1.0)),
                                           (at(0.0, 0.0, 0.122), vec(0.0, 0.0, -1.0))]), 0.0))
        elif kind == "headphones":
            for sign in (1.0, -1.0):
                out["gear"].append((Ellipsoid(at(0.083 * sign, 0.006, 0.075), np.array([0.022, 0.038, 0.043]) * s,
                                              frame), 0.01))
                out["glow"].append((Ellipsoid(at(0.104 * sign, 0.006, 0.075), np.array([0.005, 0.025, 0.028]) * s,
                                              frame), 0.0))
                arc = [at(0.083 * sign, 0.006, 0.1), at(0.074 * sign, 0.004, 0.17), at(0.04 * sign, 0.0, 0.205),
                       at(0.0, 0.0, 0.213)]
                for a, b in zip(arc, arc[1:]):
                    out["gear"].append((RoundCone(a, b, 0.011, 0.011), 0.008))
        elif kind == "hood":
            def hood(extra):
                return Union([
                    (Ellipsoid(at(0.0, 0.012, 0.108), cranium_r + np.array([0.03, 0.036, 0.032]) + extra, frame), 0.04),
                    (Ellipsoid(at(0.0, 0.05, 0.0), np.array([0.095, 0.085, 0.1]) * s + extra, frame), 0.05),
                ])

            face_point = at(0.0, -0.068, 0.06)
            face_n = vec(0.0, -1.0, 0.1)
            out["top"].append((Cut(hood(0.0), [(face_point, face_n)]), 0.03))
            out["glow"].append((Cut(hood(TRIM), [(face_point, face_n), (face_point - face_n * 0.02, -face_n)]), 0.0))
        elif kind == "collar":
            def collar(extra):
                return RoundCone(P.point("neck", rest["neck"] + np.array([0.0, 0.0, -0.02])),
                                 P.point("neck", rest["neck"] + np.array([0.0, -0.005, 0.1])), 0.093 + extra,
                                 0.082 + extra, squash=(P.vector("neck", (0.0, 1.0, 0.0)), 0.85))

            out["top"].append((Cut(collar(0.0), [(P.point("neck", rest["neck"] + np.array([0.0, 0.0, 0.1])),
                                                  P.vector("neck", unit((0.0, 0.25, 1.0))))]), 0.03))
    return out


def _cyber_arm(P, parts, side):
    """A chrome arm on `side`, with glowing rings at the shoulder, elbow and wrist."""
    rest = P.rest
    chrome, glow = [], []
    for part in parts:
        if part.region in ("uparm", "forearm", "hand") and part.bone.endswith(side):
            chrome.append((part.posed(P, 0.003), 0.015))
    shoulder, elbow, wrist = rest["shoulder_" + side], rest["elbow_" + side], rest["wrist_" + side]
    for bone, centre, direction, radius in (
            ("uparm_" + side, shoulder + (elbow - shoulder) * 0.32, elbow - shoulder, 0.047),
            ("forearm_" + side, elbow + (wrist - elbow) * 0.12, wrist - elbow, 0.043),
            ("forearm_" + side, elbow + (wrist - elbow) * 0.9, wrist - elbow, 0.033)):
        d = unit(direction)
        ring = Cut(RoundCone(P.point(bone, centre - d * 0.03), P.point(bone, centre + d * 0.03), radius, radius),
                   [_plane(P, bone, centre + d * 0.008, d), _plane(P, bone, centre - d * 0.008, -d)])
        glow.append((ring, 0.0))
    return chrome, glow


def _back_gear(P, kinds):
    rest = P.rest
    out = {"gear": [], "glow": []}
    for kind in kinds:
        if kind == "backpack":
            c = rest["chest"] + np.array([0.0, 0.17, 0.0])
            out["gear"].append((Ellipsoid(P.point("chest", c), (0.14, 0.075, 0.19)), 0.02))
            out["glow"].append((RoundCone(P.point("chest", c + np.array([0.0, 0.072, -0.12])),
                                          P.point("chest", c + np.array([0.0, 0.072, 0.12])), 0.012, 0.012), 0.0))
            for sign in (1.0, -1.0):
                a = rest["chest"] + np.array([0.085 * sign, -0.09, 0.15])
                b = rest["chest"] + np.array([0.09 * sign, 0.1, 0.19])
                c2 = rest["chest"] + np.array([0.11 * sign, -0.1, -0.12])
                out["gear"].append((RoundCone(P.point("chest", a), P.point("chest", b), 0.014, 0.014), 0.01))
                out["gear"].append((RoundCone(P.point("chest", a), P.point("chest", c2), 0.013, 0.013), 0.01))
    return out


def _props(P, props):
    out = {"gear": [], "chrome": [], "glow": []}
    rest = P.rest
    for prop in props:
        kind = prop["kind"]
        if kind == "phone":
            side = prop.get("side", "R")
            sign = 1.0 if side == "L" else -1.0
            c = rest["wrist_" + side] + np.array([-0.015 * sign, -0.03, -0.065])
            frame = P.frame("hand_" + side)
            centre = P.point("hand_" + side, c)
            out["gear"].append((Ellipsoid(centre, (0.036, 0.007, 0.07), frame), 0.0))
            # The screen lights the face that looks up at the person's own face.
            normal = frame[:, 1]
            if np.dot(normal, P.J["head"] - centre) < 0.0:
                normal = -normal
            out["glow"].append((Ellipsoid(centre + normal * 0.004, (0.03, 0.004, 0.062), frame), 0.0))
        elif kind == "dumbbell":
            for side, _sign in SIDES:
                grip = rest["wrist_" + side] + np.array([0.0, -0.01, -0.075])
                a = grip + np.array([-0.075, 0.0, 0.0])
                b = grip + np.array([0.075, 0.0, 0.0])
                out["chrome"].append((RoundCone(P.point("hand_" + side, a), P.point("hand_" + side, b), 0.014, 0.014), 0.0))
                for end in (a, b):
                    out["chrome"].append((Ellipsoid(P.point("hand_" + side, end), (0.025, 0.045, 0.045),
                                                    P.frame("hand_" + side)), 0.004))
        elif kind == "stool":
            seat = np.asarray(prop["seat"], dtype=np.float64)
            out["gear"].append((Ellipsoid(seat - np.array([0.0, 0.0, 0.025]), (0.17, 0.17, 0.03)), 0.0))
            out["chrome"].append((RoundCone(seat - np.array([0.0, 0.0, 0.05]), np.array([seat[0], seat[1], 0.06]),
                                            0.028, 0.024), 0.01))
            out["chrome"].append((Ellipsoid(np.array([seat[0], seat[1], 0.015]), (0.17, 0.17, 0.016)), 0.02))
            ring_z = seat[2] * 0.42
            for k in range(6):
                a = math.tau * k / 6.0
                b = math.tau * (k + 1) / 6.0
                p0 = seat + np.array([0.13 * math.cos(a), 0.13 * math.sin(a), ring_z - seat[2]])
                p1 = seat + np.array([0.13 * math.cos(b), 0.13 * math.sin(b), ring_z - seat[2]])
                out["chrome"].append((RoundCone(p0, p1, 0.009, 0.009), 0.005))
        else:
            raise ValueError(kind)
    return out


def field(P, outfit):
    """The posed person's field. `outfit`: top, bottom, hair, gear (head and back things),
    trims (glowing: zip, back, hem, cuffs, legs, soles), cyber (chrome arm sides), props."""
    parts = BODIES[P.build]()
    cyber = tuple(outfit.get("cyber", ()))
    trims = tuple(outfit.get("trims", ()))
    lists = {c: [] for c in CLASSES}
    lists["skin"] = [(part.posed(P), part.k) for part in parts]
    lists["hair"] = _hair(P, outfit.get("hair"))
    if outfit.get("top"):
        pieces, info = _top(P, parts, outfit["top"], cyber, "hood" in outfit.get("gear", ()))
        lists["top"] += [(p["make"](0.0), p["k"]) for p in pieces]
        top_trims = [t for t in trims if t in ("zip", "back", "hem", "cuffs")]
        kinds = [k for t in top_trims for k in (("back_L", "back_R") if t == "back" else (t,))]
        lists["glow"] += _trims(P, pieces, kinds, info)
    if outfit.get("bottom"):
        pieces = _bottom(P, parts, outfit["bottom"])
        lists["bottom"] += [(p["make"](0.0), p["k"]) for p in pieces]
        if "legs" in trims:
            lists["glow"] += _trims(P, pieces, ("legs",))
    gear, glow = _shoes(P, parts, "soles" in trims)
    lists["gear"] += gear
    lists["glow"] += glow
    for side in cyber:
        chrome, glow = _cyber_arm(P, parts, side)
        lists["chrome"] += chrome
        lists["glow"] += glow
    for source in (_head_gear(P, outfit.get("gear", ())), _back_gear(P, outfit.get("gear", ())),
                   _props(P, outfit.get("props", ()))):
        for cls, shapes in source.items():
            lists[cls] += shapes
    return Field({c: (Union(shapes) if shapes else None) for c, shapes in lists.items()})
