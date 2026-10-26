"""The people's skeleton: rest joints for two builds, forward kinematics for the spine, head and
limbs, and two-bone IK for a limb that must reach a point (a planted foot, a hand on a counter).

Frame: Blender's, in metres. x is the person's left, y points backward (the person faces -y),
z is up, and the feet stand on z = 0.

A pose is a plain dict (see `pose`): the pelvis's offset and turn, Euler turns for the spine,
neck, head and collarbones, and per limb either joint angles (FK) or a target and a pole (IK).
Every bone's world rotation is kept, so a shape fixed to a bone at rest can be carried into the
pose (`Posed.point`, `Posed.frame`).
"""

import math

import numpy as np

FWD = np.array([0.0, -1.0, 0.0])
BACK = np.array([0.0, 1.0, 0.0])
UP = np.array([0.0, 0.0, 1.0])
DOWN = np.array([0.0, 0.0, -1.0])
LEFT = np.array([1.0, 0.0, 0.0])
SIDES = (("L", 1.0), ("R", -1.0))

# (bone, parent, head joint, tail joint)
BONES = (
    ("pelvis", None, "pelvis", "spine"),
    ("spine", "pelvis", "spine", "chest"),
    ("chest", "spine", "chest", "neck"),
    ("neck", "chest", "neck", "head"),
    ("head", "neck", "head", "crown"),
    ("clav_L", "chest", "clav_L", "shoulder_L"),
    ("uparm_L", "clav_L", "shoulder_L", "elbow_L"),
    ("forearm_L", "uparm_L", "elbow_L", "wrist_L"),
    ("hand_L", "forearm_L", "wrist_L", "fingers_L"),
    ("clav_R", "chest", "clav_R", "shoulder_R"),
    ("uparm_R", "clav_R", "shoulder_R", "elbow_R"),
    ("forearm_R", "uparm_R", "elbow_R", "wrist_R"),
    ("hand_R", "forearm_R", "wrist_R", "fingers_R"),
    ("thigh_L", "pelvis", "hip_L", "knee_L"),
    ("shin_L", "thigh_L", "knee_L", "ankle_L"),
    ("foot_L", "shin_L", "ankle_L", "ball_L"),
    ("thigh_R", "pelvis", "hip_R", "knee_R"),
    ("shin_R", "thigh_R", "knee_R", "ankle_R"),
    ("foot_R", "shin_R", "ankle_R", "ball_R"),
)
BONE = {name: (parent, head, tail) for name, parent, head, tail in BONES}


# -- rotations ------------------------------------------------------------------------------
def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


def turn(yaw=0.0, pitch=0.0, roll=0.0):
    """Degrees. yaw turns the front toward the person's left, pitch tips an upright axis forward,
    roll tips it toward the person's left. Yaw outermost, then pitch, then roll."""
    return rot_z(math.radians(yaw)) @ rot_x(math.radians(pitch)) @ rot_y(math.radians(roll))


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def basis(direction, reference):
    e1 = unit(direction)
    e2 = np.asarray(reference, dtype=np.float64) - e1 * float(np.dot(reference, e1))
    if np.linalg.norm(e2) < 1e-8:
        e2 = np.cross(e1, LEFT if abs(e1[0]) < 0.9 else BACK)
    e2 = unit(e2)
    return np.stack([e1, e2, np.cross(e1, e2)], axis=1)


def aim(rest_dir, rest_ref, new_dir, new_ref):
    """The rotation taking rest_dir onto new_dir with rest_ref turned as near new_ref as it goes."""
    return basis(new_dir, new_ref) @ basis(rest_dir, rest_ref).T


# -- builds ---------------------------------------------------------------------------------
def _sided(table):
    out = {}
    for key, value in table.items():
        if key.endswith("_"):
            for side, sign in SIDES:
                out[key + side] = np.array([value[0] * sign, value[1], value[2]], dtype=np.float64)
        else:
            out[key] = np.array(value, dtype=np.float64)
    return out


# Rest joints. A: a man of about 1.77 m. B: a woman of about 1.66 m, narrower at the shoulder,
# wider at the hip, her arms carried a little out from the elbow.
REST = {
    "A": _sided({
        "pelvis": (0.0, 0.0, 0.955),
        "spine": (0.0, 0.012, 1.065),
        "chest": (0.0, 0.012, 1.225),
        "neck": (0.0, 0.028, 1.455),
        "head": (0.0, 0.016, 1.565),
        "crown": (0.0, 0.004, 1.77),
        "clav_": (0.022, -0.008, 1.43),
        "shoulder_": (0.187, 0.016, 1.428),
        "elbow_": (0.205, 0.034, 1.13),
        "wrist_": (0.214, 0.006, 0.878),
        "fingers_": (0.218, -0.004, 0.695),
        "hip_": (0.09, 0.002, 0.915),
        "knee_": (0.096, -0.012, 0.5),
        "ankle_": (0.1, 0.026, 0.083),
        "ball_": (0.104, -0.118, 0.018),
    }),
    "B": _sided({
        "pelvis": (0.0, 0.004, 0.905),
        "spine": (0.0, 0.016, 1.005),
        "chest": (0.0, 0.014, 1.155),
        "neck": (0.0, 0.028, 1.375),
        "head": (0.0, 0.016, 1.478),
        "crown": (0.0, 0.004, 1.665),
        "clav_": (0.02, -0.006, 1.352),
        "shoulder_": (0.168, 0.016, 1.35),
        "elbow_": (0.186, 0.03, 1.07),
        "wrist_": (0.204, 0.0, 0.832),
        "fingers_": (0.208, -0.008, 0.66),
        "hip_": (0.088, 0.004, 0.87),
        "knee_": (0.088, -0.01, 0.475),
        "ankle_": (0.092, 0.024, 0.08),
        "ball_": (0.095, -0.108, 0.017),
    }),
}


def lengths(rest, side):
    return dict(
        thigh=float(np.linalg.norm(rest["knee_" + side] - rest["hip_" + side])),
        shin=float(np.linalg.norm(rest["ankle_" + side] - rest["knee_" + side])),
        uparm=float(np.linalg.norm(rest["elbow_" + side] - rest["shoulder_" + side])),
        forearm=float(np.linalg.norm(rest["wrist_" + side] - rest["elbow_" + side])),
    )


# -- the posed skeleton ------------------------------------------------------------------------
class Posed:
    """Joint positions and bone rotations (world from rest) for one pose of one build."""

    def __init__(self, build, rest):
        self.build = build
        self.rest = rest
        self.J = {}
        self.R = {}
        self.extras = {}

    def point(self, bone, rest_point):
        head = BONE[bone][1]
        return self.J[head] + self.R[bone] @ (np.asarray(rest_point, dtype=np.float64) - self.rest[head])

    def vector(self, bone, rest_vector):
        return self.R[bone] @ np.asarray(rest_vector, dtype=np.float64)

    def frame(self, bone, rest_frame=None):
        return self.R[bone] if rest_frame is None else self.R[bone] @ rest_frame

    def _child(self, bone, joint):
        """A joint carried by `bone` from its rest offset."""
        head = BONE[bone][1]
        self.J[joint] = self.J[head] + self.R[bone] @ (self.rest[joint] - self.rest[head])

    def lowest(self):
        return min(float(v[2]) for v in self.J.values())


def _limb_fk(sign, swing=0.0, abduct=0.0, twist=0.0):
    """A limb's turn in its parent's frame, from hanging straight down: swing forward, abduct
    away from the midline, twist about the limb (all degrees)."""
    return (rot_x(math.radians(-swing)) @ rot_y(math.radians(-sign * abduct))
            @ rot_z(math.radians(sign * twist)))


def _two_bone(root, target, l1, l2, pole):
    """Knee or elbow for a two-bone limb from `root` toward `target`, bending toward `pole`."""
    d = np.asarray(target, dtype=np.float64) - root
    distance = float(np.linalg.norm(d))
    reach = (l1 + l2) * 0.9995
    distance = min(max(distance, abs(l1 - l2) + 1e-4), reach)
    dn = unit(d)
    end = root + dn * distance
    cos_a = (l1 * l1 + distance * distance - l2 * l2) / (2.0 * l1 * distance)
    a = math.acos(max(-1.0, min(1.0, cos_a)))
    p = np.asarray(pole, dtype=np.float64)
    pp = p - dn * float(np.dot(p, dn))
    if np.linalg.norm(pp) < 1e-8:
        pp = np.cross(dn, LEFT)
    pp = unit(pp)
    mid = root + l1 * (math.cos(a) * dn + math.sin(a) * pp)
    return mid, end, pp


def pose(build, spec):
    """Pose `build` ("A" or "B") by `spec`:

    root     (dx, dy, dz) pelvis offset from rest (metres)
    pelvis   (yaw, pitch, roll) world turn of the pelvis (degrees)
    spine, chest, neck, head   (yaw, pitch, roll) local turns
    clav_L/R (yaw, pitch, roll) local turn of a collarbone (roll lifts the shoulder)
    arm_L/R  {"shoulder": (swing, abduct, twist), "elbow": flex, "wrist": (flex, roll)}  FK, or
             {"hand": world wrist point, "pole": world direction, "wrist": (flex, roll)}  IK
    leg_L/R  {"hip": (swing, abduct, twist), "knee": flex, "foot": (pitch, yaw)}  FK, or
             {"ankle": world point, "pole": world direction, "foot": (pitch, yaw)}  IK
    Foot pitch is toe-down positive; foot yaw turns the toe toward the person's left. In IK the
    foot's turn is in the world, in FK it is relative to the shin.
    """
    rest = REST[build]
    P = Posed(build, rest)
    P.extras = {key: spec[key] for key in ("hair_swing",) if key in spec}
    root = np.asarray(spec.get("root", (0.0, 0.0, 0.0)), dtype=np.float64)
    P.J["pelvis"] = rest["pelvis"] + root
    P.R["pelvis"] = turn(*spec.get("pelvis", (0.0, 0.0, 0.0)))
    for bone in ("spine", "chest", "neck", "head"):
        parent, head, _tail = BONE[bone]
        P._child(parent, head)
        P.R[bone] = P.R[parent] @ turn(*spec.get(bone, (0.0, 0.0, 0.0)))
    P._child("head", "crown")
    for side, sign in SIDES:
        clav = "clav_" + side
        P._child("chest", clav)
        P.R[clav] = P.R["chest"] @ turn(*spec.get(clav, (0.0, 0.0, 0.0)))
        P._child(clav, "shoulder_" + side)
        _arm(P, side, sign, spec.get("arm_" + side, {}))
        P._child("pelvis", "hip_" + side)
        _leg(P, side, sign, spec.get("leg_" + side, {}))
    return P


def _arm(P, side, sign, arm):
    rest = P.rest
    up, fore, hand = "uparm_" + side, "forearm_" + side, "hand_" + side
    shoulder, elbow, wrist = "shoulder_" + side, "elbow_" + side, "wrist_" + side
    if "hand" in arm:
        L = lengths(rest, side)
        pole = arm.get("pole", (0.35 * sign, 1.0, -0.2))
        mid, end, pp = _two_bone(P.J[shoulder], arm["hand"], L["uparm"], L["forearm"], pole)
        rest_up = rest[elbow] - rest[shoulder]
        rest_fore = rest[wrist] - rest[elbow]
        P.R[up] = aim(rest_up, BACK, mid - P.J[shoulder], pp)
        P.J[elbow] = mid
        P.R[fore] = aim(rest_fore, BACK, end - mid, pp)
        P.J[wrist] = end
    else:
        clav = "clav_" + side
        P.R[up] = P.R[clav] @ _limb_fk(sign, *arm.get("shoulder", (0.0, 0.0, 0.0)))
        P._child(up, elbow)
        P.R[fore] = P.R[up] @ rot_x(math.radians(-arm.get("elbow", 8.0)))
        P._child(fore, wrist)
    flex, roll = arm.get("wrist", (0.0, 0.0))
    P.R[hand] = P.R[fore] @ rot_x(math.radians(-flex)) @ rot_y(math.radians(-sign * roll))
    P._child(hand, "fingers_" + side)


def _leg(P, side, sign, leg):
    rest = P.rest
    th, sh, ft = "thigh_" + side, "shin_" + side, "foot_" + side
    hip, knee, ankle = "hip_" + side, "knee_" + side, "ankle_" + side
    pitch, yaw = leg.get("foot", (0.0, 0.0))
    if "ankle" in leg:
        L = lengths(rest, side)
        pole = leg.get("pole", FWD)
        mid, end, pp = _two_bone(P.J[hip], leg["ankle"], L["thigh"], L["shin"], pole)
        P.R[th] = aim(rest[knee] - rest[hip], FWD, mid - P.J[hip], pp)
        P.J[knee] = mid
        P.R[sh] = aim(rest[ankle] - rest[knee], FWD, end - mid, pp)
        P.J[ankle] = end
        P.R[ft] = turn(yaw=yaw, pitch=pitch)
    else:
        P.R[th] = P.R["pelvis"] @ _limb_fk(sign, *leg.get("hip", (0.0, 0.0, 0.0)))
        P._child(th, knee)
        P.R[sh] = P.R[th] @ rot_x(math.radians(leg.get("knee", 0.0)))
        P._child(sh, ankle)
        P.R[ft] = P.R[sh] @ turn(yaw=yaw, pitch=pitch)
    P._child(ft, "ball_" + side)


def foot_ankle(build, side, ground_point, pitch, pivot):
    """Where the ankle stands for a foot turned by `pitch` (toe down positive, degrees) about a
    point on the ground: its heel ("heel") or the ball of its foot ("ball"). `ground_point` is
    where that point touches."""
    rest = REST[build]
    ankle = rest["ankle_" + side]
    ball = rest["ball_" + side]
    heel = np.array([ankle[0], ankle[1] + 0.045, 0.012])
    point = ball if pivot == "ball" else heel
    offset = ankle - point
    return np.asarray(ground_point, dtype=np.float64) + rot_x(math.radians(pitch)) @ offset
