"""Posing the squirrel: forward kinematics on its skeleton, and leg IK, in plain numpy.

A clip (motion.py) describes a moment as a *spec*: where the body is and how it bends, where each foot
or paw is put, how the head, ears, jaw and tail turn. `solve(spec)` answers with each bone's local
rotation (a quaternion in the bone's rest frame, which is the squirrel's own: x its left, y up, z
forward) and the root's offset; rig.py keys those into Blender actions.

Legs are two-bone IK chains with the hand or foot aimed after: the foreleg arm -> fore -> hand, the
hind leg thigh -> shin -> foot. The knee and elbow bend in the plane the pole hint gives, and each
bone keeps the twist that plane implies, so a paw's sole stays where the clip wants it.
"""

import math

import numpy as np

from .model import TAIL_BONES, skeleton

DEG = math.pi / 180.0


def _unit(v):
    v = np.asarray(v, dtype=np.float64)
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-12 else v


def euler(x=0.0, y=0.0, z=0.0):
    """Rotation matrix for (x, y, z) degrees about the squirrel's axes, applied x, then y, then z
    (Blender's 'XYZ' order)."""
    cx, sx = math.cos(x * DEG), math.sin(x * DEG)
    cy, sy = math.cos(y * DEG), math.sin(y * DEG)
    cz, sz = math.cos(z * DEG), math.sin(z * DEG)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rz @ ry @ rx


def axis_angle(axis, degrees):
    a = _unit(axis)
    t = degrees * DEG
    k = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(t) * k + (1.0 - math.cos(t)) * (k @ k)


def frame(forward, side):
    """An orthonormal frame [forward, side', forward x side'] (columns), side made square to forward."""
    f = _unit(forward)
    s = np.asarray(side, dtype=np.float64) - f * float(np.dot(side, f))
    if np.linalg.norm(s) < 1e-9:
        s = np.cross(f, [0.0, 1.0, 0.0])
        if np.linalg.norm(s) < 1e-9:
            s = np.cross(f, [1.0, 0.0, 0.0])
    s = _unit(s)
    return np.stack([f, s, np.cross(f, s)], axis=1)


def look(rest_forward, rest_side, forward, side):
    """The rotation taking the rest pair (forward, side) onto the wanted pair."""
    return frame(forward, side) @ frame(rest_forward, rest_side).T


def quaternion(m):
    """(w, x, y, z) of a rotation matrix."""
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0.0:
        s = math.sqrt(t + 1.0) * 2.0
        q = (0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s)
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2.0
        q = ((m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s)
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2.0
        q = ((m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s)
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2.0
        q = ((m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s)
    q = np.array(q)
    return q / np.linalg.norm(q)


class Rig:
    """The skeleton at rest, and a pose being built on it."""

    def __init__(self):
        bones = skeleton()
        self.names = [b[0] for b in bones]
        self.parent = {b[0]: b[1] for b in bones}
        self.head = {b[0]: np.asarray(b[2], dtype=np.float64) for b in bones}
        self.tip = {b[0]: np.asarray(b[3], dtype=np.float64) for b in bones}
        self.children = {name: [] for name in self.names}
        for name, parent in self.parent.items():
            if parent:
                self.children[parent].append(name)
        self.reset()

    def reset(self):
        self.local = {name: np.eye(3) for name in self.names}
        self.offset = np.zeros(3)
        self._world = None

    # -- forward kinematics ------------------------------------------------------------
    def world(self):
        """{bone: (rotation, joint position)} in the clip frame."""
        if self._world is None:
            out = {}
            for name in self.names:  # parents come before children in skeleton()
                parent = self.parent[name]
                if parent is None:
                    out[name] = (self.local[name], self.head[name] + self.offset)
                else:
                    rot, pos = out[parent]
                    out[name] = (rot @ self.local[name], pos + rot @ (self.head[name] - self.head[parent]))
            self._world = out
        return self._world

    def set(self, name, rotation):
        self.local[name] = rotation
        self._world = None

    def joint(self, name):
        return self.world()[name][1]

    def rotation(self, name):
        return self.world()[name][0]

    def point(self, name, rest_point):
        """Where a point fixed to `name` at rest is now."""
        rot, pos = self.world()[name]
        return pos + rot @ (np.asarray(rest_point) - self.head[name])

    # -- aiming ------------------------------------------------------------------------
    def aim(self, name, forward, side, rest_forward=None, rest_side=(1.0, 0.0, 0.0)):
        """Turn `name` so its segment (head -> tip, or `rest_forward`) points along `forward` with its
        rest `side` axis turned toward `side` (all in the clip frame)."""
        rest_forward = self.tip[name] - self.head[name] if rest_forward is None else np.asarray(rest_forward)
        wanted = look(rest_forward, rest_side, forward, side)
        parent = self.parent[name]
        parent_rot = self.rotation(parent) if parent else np.eye(3)
        self.set(name, parent_rot.T @ wanted)

    def two_bone(self, upper, lower, target, pole, end=None):
        """IK: `upper` and `lower` bend so the joint after `lower` (its tip, or `end`'s head) reaches
        `target`, the middle joint toward `pole` (a direction)."""
        end_rest = self.head[end] if end else self.tip[lower]
        a_rest, b_rest = self.head[upper], self.head[lower]
        l1 = float(np.linalg.norm(b_rest - a_rest))
        l2 = float(np.linalg.norm(end_rest - b_rest))
        a = self.joint(upper)
        to = np.asarray(target, dtype=np.float64) - a
        d = float(np.linalg.norm(to))
        d = min(max(d, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-5)
        f = _unit(to)
        bend = np.asarray(pole, dtype=np.float64) - f * float(np.dot(pole, f))
        bend = _unit(bend) if np.linalg.norm(bend) > 1e-9 else _unit(np.cross(f, [1.0, 0.0, 0.0]))
        cos_a = (l1 * l1 + d * d - l2 * l2) / (2.0 * l1 * d)
        sin_a = math.sqrt(max(0.0, 1.0 - cos_a * cos_a))
        middle = a + l1 * (cos_a * f + sin_a * bend)
        reach = a + f * d
        # The limb's plane at rest and now: its normal is the twist each bone keeps.
        rest_normal = np.cross(b_rest - a_rest, end_rest - b_rest)
        if np.linalg.norm(rest_normal) < 1e-9:
            rest_normal = np.array([1.0, 0.0, 0.0])
        normal = np.cross(middle - a, reach - middle)
        if np.linalg.norm(normal) < 1e-9:
            normal = np.cross(f, bend)
        self.aim(upper, middle - a, normal, rest_forward=b_rest - a_rest, rest_side=rest_normal)
        self.aim(lower, reach - middle, normal, rest_forward=end_rest - b_rest, rest_side=rest_normal)
        return middle, reach


# -- a spec, solved ---------------------------------------------------------------------
SPINE = ("hips", "spine", "chest", "neck", "head", "jaw")


def solve(spec, rig=None):
    """`spec` -> {bone: (w, x, y, z)}, root offset. Keys (all optional):

    root (x, y, z) metres; body (x, y, z) degrees: the whole squirrel's turn about the root joint;
    hips, spine, chest, neck, head, jaw, earL, earR, shoulderL/R: (x, y, z) degrees, local;
    tail: list of (x, y, z) degrees, one per tail bone;
    hindL/hindR: dict(heel=, toe=, pole=, side=) in the clip frame (IK), or dict(fk={bone: angles});
    frontL/frontR: dict(wrist=, toe=, pole=, side=) likewise.
    """
    rig = rig or Rig()
    rig.reset()
    rig.offset = np.asarray(spec.get("root", (0.0, 0.0, 0.0)), dtype=np.float64)
    rig.set("root", euler(*spec.get("body", (0.0, 0.0, 0.0))))
    for name in SPINE + ("earL", "earR", "shoulderL", "shoulderR"):
        if name in spec:
            rig.set(name, euler(*spec[name]))
    tail = spec.get("tail") or []
    for i in range(min(TAIL_BONES, len(tail))):
        rig.set("tail%d" % i, euler(*tail[i]))
    lateral = rig.rotation("hips") @ np.array([1.0, 0.0, 0.0])
    for sfx, sign in (("L", 1.0), ("R", -1.0)):
        hind = spec.get("hind" + sfx)
        if hind:
            if "fk" in hind:
                for bone, angles in hind["fk"].items():
                    rig.set(bone + sfx, euler(*angles))
            else:
                heel, toe = np.asarray(hind["heel"]), np.asarray(hind["toe"])
                pole = hind.get("pole", rig.rotation("hips") @ np.array([0.15 * sign, 0.2, 1.0]))
                side = hind.get("side", lateral)
                if hind.get("attach"):
                    heel, toe = rig.point(hind["attach"], heel), rig.point(hind["attach"], toe)
                rig.two_bone("thigh" + sfx, "shin" + sfx, heel, pole, end="foot" + sfx)
                rig.aim("foot" + sfx, toe - rig.joint("foot" + sfx), side)
        front = spec.get("front" + sfx)
        if front:
            if "fk" in front:
                for bone, angles in front["fk"].items():
                    rig.set(bone + sfx, euler(*angles))
            else:
                chest_rot = rig.rotation("chest")
                wrist, toe = np.asarray(front["wrist"]), np.asarray(front["toe"])
                pole = front.get("pole", (0.1 * sign, 0.1, -1.0))
                side = front.get("side", (1.0, 0.0, 0.0))
                attach = front.get("attach")
                if attach:
                    # Targets given as rest-space points carried by a bone (paws held to the chest,
                    # to the mouth): wherever that bone is now.
                    wrist, toe = rig.point(attach, wrist), rig.point(attach, toe)
                    pole = rig.rotation(attach) @ np.asarray(pole)
                    side = rig.rotation(attach) @ np.asarray(side)
                elif "pole" not in front:
                    pole = chest_rot @ np.asarray(pole)
                    side = chest_rot @ np.asarray(side)
                rig.two_bone("arm" + sfx, "fore" + sfx, wrist, pole, end="hand" + sfx)
                rig.aim("hand" + sfx, toe - rig.joint("hand" + sfx), side)
    out = {name: quaternion(rig.local[name]) for name in rig.names}
    return out, rig.offset.copy(), rig


def rest_feet():
    """Where the feet and paws stand at rest, as the clips' reference."""
    rig = Rig()
    feet = {}
    for sfx in ("L", "R"):
        feet["hind" + sfx] = dict(heel=rig.head["foot" + sfx].copy(), toe=rig.tip["foot" + sfx].copy())
        feet["front" + sfx] = dict(wrist=rig.head["hand" + sfx].copy(), toe=rig.tip["hand" + sfx].copy())
    return feet
