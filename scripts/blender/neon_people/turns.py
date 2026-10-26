"""A walker's turn at the end of a room, as one clip: the last step of the walk braking to a stop,
a quarter turn to face the street, a hold (one slow look round, stretched over the pause), a
quarter turn on round and the first step of the walk back.

The clip is drawn in the frame of the person facing the street (-y), at the room's right end: they
arrive walking toward their left (+x) and leave toward their right (-x). The shader mirrors it at
the other end. Its first frame is the walk's frame at phase 0 turned to +x, its last the walk's
frame at phase 0 turned to -x, so the walk runs straight into it and out of it. The body travels
while it brakes and while it sets off (a constant deceleration over the stopping step, a constant
acceleration over the starting one, half a step each); the frames are drawn relative to that
travelling point, as the walk is drawn on a treadmill, so the shader moves the sprite by the same
law and the planted feet stay put.

Frames: `n_in` over the stop and the first quarter turn (time 0..t_in), `n_hold` over the hold
(one cycle, starting and ending on the stand), `n_out` over the second quarter turn and the start
(time 0..t_out, the last frame at t_out).
"""

import math

import numpy as np

from neon_people.rig import FWD, REST, pose, rot_z, unit

# The in-place quarter turn takes this long; the stopping and starting steps take a step's time.
TURN_SECONDS = 0.8
# How far ahead of the pelvis the chest and the head turn (share of the turn's time).
LEAD = {"pelvis": 0.0, "chest": 0.14, "head": 0.3}


def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)


def window(t, a, b):
    return ease((t - a) / max(b - a, 1e-9))


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_tuple(a, b, t):
    return tuple(float(x) + (float(y) - float(x)) * t for x, y in zip(a, b))


def relaxed(sign):
    """An arm hanging loose (the walk's arm with no swing)."""
    return dict(shoulder=(1.0, 7.0, -10.0), elbow=12.0, wrist=(-6.0, 4.0 * sign))


def rotate_spec(build, spec, yaw, shift=(0.0, 0.0)):
    """The whole pose turned `yaw` degrees about the vertical through the origin, then moved by
    `shift` (x, y). FK limbs ride with the body; IK targets, poles and foot turns are turned."""
    R = rot_z(math.radians(yaw))
    t = np.array([shift[0], shift[1], 0.0])
    rest = REST[build]
    out = dict(spec)
    pelvis = rest["pelvis"] + np.asarray(spec.get("root", (0.0, 0.0, 0.0)), dtype=np.float64)
    out["root"] = tuple(R @ pelvis + t - rest["pelvis"])
    p = spec.get("pelvis", (0.0, 0.0, 0.0))
    out["pelvis"] = (p[0] + yaw, p[1], p[2])
    for key in ("leg_L", "leg_R", "arm_L", "arm_R"):
        limb = spec.get(key)
        if limb is None:
            continue
        limb = dict(limb)
        sign = 1.0 if key.endswith("L") else -1.0
        if "ankle" in limb:
            limb["ankle"] = R @ np.asarray(limb["ankle"], dtype=np.float64) + t
            limb["pole"] = R @ np.asarray(limb.get("pole", FWD), dtype=np.float64)
            f = limb.get("foot", (0.0, 0.0))
            limb["foot"] = (f[0], f[1] + yaw)
        if "hand" in limb:
            limb["hand"] = R @ np.asarray(limb["hand"], dtype=np.float64) + t
            limb["pole"] = R @ np.asarray(limb.get("pole", (0.35 * sign, 1.0, -0.2)), dtype=np.float64)
        out[key] = limb
    return out


def arm_ik(build, spec, side):
    """An FK arm of a pose as an IK target: the wrist where it is, the elbow's side as the pole."""
    P = pose(build, spec)
    shoulder, elbow, wrist = P.J["shoulder_" + side], P.J["elbow_" + side], P.J["wrist_" + side]
    pole = elbow - (shoulder + wrist) * 0.5
    return dict(hand=wrist, pole=unit(pole), wrist=tuple(spec["arm_" + side].get("wrist", (0.0, 0.0))))


def blend_arm(build, body, fk, ik, w, side):
    """An arm part way (w) from an FK arm (`fk`, under the `body` pose) to an IK one."""
    if w <= 0.0:
        return fk
    if w >= 1.0:
        return ik
    spec = dict(body)
    spec["arm_" + side] = fk
    start = arm_ik(build, spec, side)
    return dict(hand=lerp(start["hand"], np.asarray(ik["hand"], dtype=np.float64), w),
                pole=unit(lerp(start["pole"], np.asarray(ik.get("pole", start["pole"]), dtype=np.float64), w)),
                wrist=lerp_tuple(start["wrist"], ik.get("wrist", (0.0, 0.0)), w))


def blend_fk(a, b, w):
    return dict(shoulder=lerp_tuple(a.get("shoulder", (0.0, 0.0, 0.0)), b.get("shoulder", (0.0, 0.0, 0.0)), w),
                elbow=lerp(a.get("elbow", 8.0), b.get("elbow", 8.0), w),
                wrist=lerp_tuple(a.get("wrist", (0.0, 0.0)), b.get("wrist", (0.0, 0.0)), w))


BODY = ("pelvis", "spine", "chest", "neck", "head", "clav_L", "clav_R")


def body_channels(a, b, w):
    out = {key: lerp_tuple(a.get(key, (0.0, 0.0, 0.0)), b.get(key, (0.0, 0.0, 0.0)), w) for key in BODY}
    out["root"] = lerp_tuple(a.get("root", (0.0, 0.0, 0.0)), b.get("root", (0.0, 0.0, 0.0)), w)
    return out


def twist(spec, total, progress):
    """Turn the body `total` degrees, shared out so the head leads, the chest follows and the
    pelvis comes last: `progress(joint)` says how far each has got (0..1)."""
    pel = total * progress("pelvis")
    chest = total * progress("chest")
    head = total * progress("head")
    p, s, c, n, h = spec["pelvis"], spec["spine"], spec["chest"], spec["neck"], spec["head"]
    spec["pelvis"] = (p[0] + pel, p[1], p[2])
    spec["spine"] = (s[0] + (chest - pel) * 0.5, s[1], s[2])
    spec["chest"] = (c[0] + (chest - pel) * 0.5, c[1], c[2])
    spec["neck"] = (n[0] + (head - chest) * 0.4, n[1], n[2])
    spec["head"] = (h[0] + (head - chest) * 0.6, h[1], h[2])


def foot_key(spec, side, shift=None):
    """A foot of a pose as a key: ankle point (moved by `shift`), yaw, pitch and knee pole."""
    leg = spec["leg_" + side]
    pitch, yaw = leg.get("foot", (0.0, 0.0))
    point = np.asarray(leg["ankle"], dtype=np.float64)
    return dict(p=point + (shift if shift is not None else 0.0), yaw=float(yaw), pitch=float(pitch),
                pole=unit(np.asarray(leg.get("pole", FWD), dtype=np.float64)))


def moved(key, **changes):
    out = dict(key)
    out.update(changes)
    return out


def between(k0, k1, u, lift=0.0):
    """A foot part way from one key to another; with `lift`, a small step: up, over, down."""
    s = ease(u)
    arc = math.sin(math.pi * min(max(u, 0.0), 1.0)) if lift > 0.0 else 0.0
    return dict(p=lerp(k0["p"], k1["p"], s) + np.array([0.0, 0.0, lift * arc]), yaw=lerp(k0["yaw"], k1["yaw"], s),
                pitch=lerp(k0["pitch"], k1["pitch"], s) + 6.0 * arc, pole=unit(lerp(k0["pole"], k1["pole"], s)))


def leg_spec(key, ref):
    return dict(ankle=key["p"] - ref, pole=key["pole"], foot=(key["pitch"], key["yaw"]))


def carry_swings(spec, a, b, w):
    for key in ("hair_swing", "coat_swing"):
        if key in a or key in b:
            first = a.get(key, b.get(key))
            spec[key] = lerp_tuple(first, b.get(key, first), w)


def turn_in(t, build, walk_pose, hold_pose, v, step):
    """Time t from the walk's phase-0 frame (heading +x, its right heel striking): the stopping
    step and the quarter turn to face the street, relative to the travelling point."""
    T = step / v
    D = step * 0.5
    end = T + TURN_SECONDS
    w0 = rotate_spec(build, walk_pose(0.0), 90.0)
    hold = hold_pose(0.0)
    if t <= 0.0:
        return w0
    if t >= end:
        return hold
    rest = REST[build]
    s = v * t - v * t * t / (2.0 * T) if t < T else D
    ref = np.array([s, 0.0, 0.0])
    world = np.array([D, 0.0, 0.0])  # where the hold's frame sits in the clip's world
    stand90 = rotate_spec(build, hold, 90.0)
    brake = ease(t / T)
    u = (t - T) / TURN_SECONDS
    # Body: the walk's swing settles into the stand while braking (leaning back a little as the
    # weight comes onto the front foot), then the body turns to the street, the head leading.
    if u <= 0.0:
        spec = body_channels(w0, stand90, brake)
    else:
        spec = body_channels(stand90, hold, ease(u))
        spec["pelvis"] = (stand90["pelvis"][0],) + spec["pelvis"][1:]
        for key in ("spine", "chest", "neck", "head"):
            spec[key] = hold[key]
    twist(spec, -90.0, lambda joint: ease((t - T + LEAD[joint] * TURN_SECONDS) / TURN_SECONDS))
    p = spec["pelvis"]
    spec["pelvis"] = (p[0], p[1] - 3.0 * math.sin(math.pi * min(t / T, 1.0)), p[2])
    # Feet (in the clip's world, then relative to the travelling point). The right was planted at
    # the heel strike and rolls flat; the left pushes off and swings up beside it (a short closing
    # step). In the turn the right foot opens toward the street and the left follows round.
    r0, l0 = foot_key(w0, "R"), foot_key(w0, "L")
    r_flat = moved(r0, p=np.array([r0["p"][0], r0["p"][1], rest["ankle_R"][2]]), pitch=0.0)
    l_land = moved(l0, p=np.array([D, rest["ankle_L"][0], rest["ankle_L"][2]]), pitch=0.0)
    r_hold, l_hold = foot_key(hold, "R", world), foot_key(hold, "L", world)
    right = between(r0, r_flat, t / (0.45 * T))
    t_off = 0.12 * T
    left = l0 if t < t_off else between(l0, l_land, (t - t_off) / (T - t_off), 0.07)
    if u > 0.0:
        right = between(r_flat, r_hold, window(u, 0.0, 0.55), 0.05)
        left = between(l_land, l_hold, window(u, 0.38, 0.95), 0.05)
    spec["leg_R"] = leg_spec(right, ref)
    spec["leg_L"] = leg_spec(left, ref)
    # The pelvis rides with the travelling point (its offset blends between the two poses).
    # Arms: the swing dies into a hang while braking, then the hands go to the hold's.
    for side, sign in (("L", 1.0), ("R", -1.0)):
        fk = blend_fk(w0["arm_" + side], relaxed(sign), brake)
        spec["arm_" + side] = blend_arm(build, spec, fk, hold["arm_" + side], window(u, 0.15, 1.0), side) \
            if u > 0.0 else fk
    carry_swings(spec, w0, hold, ease(t / end))
    return spec


def turn_out(t, build, walk_pose, hold_pose, v, step):
    """Time t from the stand facing the street: the quarter turn to face -x and the first step of
    the walk, ending on the walk's phase-0 frame (heading -x) at t_out."""
    T = step / v
    D = step * 0.5
    end = TURN_SECONDS + T
    hold = hold_pose(0.0)
    if t <= 0.0:
        return hold
    w_end = rotate_spec(build, walk_pose(0.0), -90.0)
    if t >= end:
        return w_end
    rest = REST[build]
    tau = t - TURN_SECONDS
    s = v * tau * tau / (2.0 * T) if tau > 0.0 else 0.0
    ref = np.array([-s, 0.0, 0.0])
    goal = np.array([-D, 0.0, 0.0])  # where the walk's frame sits in the clip's world at the end
    stand_m90 = rotate_spec(build, hold, -90.0)
    u = t / TURN_SECONDS
    go = ease(tau / T) if tau > 0.0 else 0.0
    if tau <= 0.0:
        spec = body_channels(hold, stand_m90, ease(u))
        spec["pelvis"] = (hold["pelvis"][0],) + spec["pelvis"][1:]
        for key in ("spine", "chest", "neck", "head"):
            spec[key] = hold[key]
        twist(spec, -90.0, lambda joint: ease(t / ((1.0 - LEAD[joint]) * TURN_SECONDS)))
    else:
        spec = body_channels(stand_m90, w_end, go)
        p = spec["pelvis"]
        spec["pelvis"] = (p[0], p[1] + 3.0 * math.sin(math.pi * tau / T), p[2])
    # Feet: the right foot drops back and turns (opening the hips), the left steps round in front
    # to where it will push off from; then the right swings through into the first heel strike.
    r_hold, l_hold = foot_key(hold, "R"), foot_key(hold, "L")
    r_end, l_end = foot_key(w_end, "R", goal), foot_key(w_end, "L", goal)
    r_ready = moved(r_end, p=np.array([rest["ankle_R"][1], -rest["ankle_R"][0], rest["ankle_R"][2]]), pitch=0.0)
    l_ready = moved(l_end, p=np.array([l_end["p"][0], l_end["p"][1], rest["ankle_L"][2]]), pitch=0.0)
    right = between(r_hold, r_ready, window(u, 0.04, 0.5), 0.05)
    left = between(l_hold, l_ready, window(u, 0.36, 0.88), 0.05)
    if tau > 0.0:
        uu = tau / T
        right = between(r_ready, r_end, uu)
        right["p"] = right["p"] + np.array(
            [0.0, 0.0, 0.075 * math.sin(math.pi * min(uu * 1.08, 1.0)) ** 1.3 * (1.0 - 0.25 * uu)])
        right["pitch"] = lerp(lerp(0.0, 26.0, ease(uu / 0.3)), r_end["pitch"], ease((uu - 0.3) / 0.7))
        left = between(l_ready, l_end, (uu - 0.55) / 0.45)
    spec["leg_R"] = leg_spec(right, ref)
    spec["leg_L"] = leg_spec(left, ref)
    # Arms: the hands leave the hold as the body turns and hang; then they find the walk's swing.
    for side, sign in (("L", 1.0), ("R", -1.0)):
        if tau <= 0.0:
            spec["arm_" + side] = blend_arm(build, spec, relaxed(sign), hold["arm_" + side],
                                            1.0 - window(u, 0.0, 0.75), side)
        else:
            spec["arm_" + side] = blend_fk(relaxed(sign), w_end["arm_" + side], go)
    carry_swings(spec, hold, w_end, ease(t / end))
    return spec


def turn_frames(n_in, n_hold, n_out, t_in, t_out):
    """(segment, value) per frame: ("in", seconds), ("hold", phase), ("out", seconds)."""
    frames = [("in", t_in * k / n_in) for k in range(n_in)]
    frames += [("hold", k / n_hold) for k in range(n_hold)]
    frames += [("out", t_out * k / (n_out - 1)) for k in range(n_out)]
    return frames


def turn_pose(frame, build, walk_pose, hold_pose, v, step):
    segment, value = frame
    if segment == "in":
        return turn_in(value, build, walk_pose, hold_pose, v, step)
    if segment == "hold":
        return hold_pose(value)
    return turn_out(value, build, walk_pose, hold_pose, v, step)


def timing(v, step):
    """(t_in, t_out, t_brake): the clip's two timed parts, and the stopping (and starting) step."""
    T = step / v
    return T + TURN_SECONDS, TURN_SECONDS + T, T
