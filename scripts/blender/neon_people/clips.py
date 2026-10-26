"""The people's clips: what each one does, frame by frame, as a pose spec for neon_people.rig.

A clip is a loop over phase 0..1. Walking is in place, as on a treadmill: a planted foot slides
back at exactly the clip's speed, so a shader that carries the sprite forward by `metres` per loop
plants it on the floor. Everything else stands where it works. The registry at the bottom says
which body and clothes each clip is drawn in, how many frames it has, which views it is rendered
from and how the shader times it.

Directions: x is the person's left, -y forward, z up (rig.py). Angles in degrees.
"""

import math

import numpy as np

from neon_people.rig import FWD, REST, foot_ankle, pose


# -- timing helpers ---------------------------------------------------------------------------
def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)


def smoother(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def lerp(a, b, t):
    return a + (b - a) * t


def cyc(phase, keys):
    """Periodic Catmull-Rom through (t, value) keys on 0..1; values may be tuples."""
    keys = sorted(keys, key=lambda k: k[0])
    ts = [k[0] for k in keys]
    vs = [np.asarray(k[1], dtype=np.float64) for k in keys]
    n = len(keys)
    p = phase % 1.0
    i = 0
    while i < n - 1 and ts[i + 1] <= p:
        i += 1
    if p < ts[0]:
        i = n - 1
    j = (i + 1) % n
    t0 = ts[i]
    t1 = ts[j] + (1.0 if j <= i else 0.0)
    pp = p + (1.0 if p < t0 else 0.0)
    u = (pp - t0) / max(t1 - t0, 1e-9)
    v0, v1, v2, v3 = vs[(i - 1) % n], vs[i], vs[j], vs[(j + 1) % n]
    u2, u3 = u * u, u * u * u
    out = 0.5 * ((2.0 * v1) + (-v0 + v2) * u + (2.0 * v0 - 5.0 * v1 + 4.0 * v2 - v3) * u2
                 + (-v0 + 3.0 * v1 - 3.0 * v2 + v3) * u3)
    return tuple(out) if out.ndim else float(out)


def wave(phase, period=1.0, offset=0.0):
    return math.sin(math.tau * (phase / period + offset))


def posed_head(build, spec, offset):
    """A point fixed to the head (offset from its rest joint) once the body without its arms is
    posed: where a hand must go to reach the mouth."""
    posed = pose(build, {k: v for k, v in spec.items() if not k.startswith("arm_")})
    return posed.point("head", REST[build]["head"] + np.asarray(offset, dtype=np.float64))


# -- gait ---------------------------------------------------------------------------------------
def _foot_stance(build, side, s, cycle, stance, strike_pitch, push_pitch, flat_from, flat_to):
    """Ankle and pitch of a planted foot at stance fraction s (0 = heel strike)."""
    rest = REST[build]
    f_contact = cycle * stance * 0.5
    f = f_contact - cycle * s
    ankle = rest["ankle_" + side]
    ball = rest["ball_" + side]
    heel = np.array([ankle[0], ankle[1] + 0.045, 0.012])
    if s < flat_from:
        pitch = lerp(strike_pitch, 0.0, smooth(s / flat_from))
        return foot_ankle(build, side, heel + np.array([0.0, -f, 0.0]), pitch, "heel"), pitch
    if s < flat_to:
        return foot_ankle(build, side, heel + np.array([0.0, -f, 0.0]), 0.0, "heel"), 0.0
    t = (s - flat_to) / (stance - flat_to)
    pitch = lerp(0.0, push_pitch, t * t * (2.0 - t))
    return foot_ankle(build, side, np.array([ball[0], ball[1] - f, ball[2]]), pitch, "ball"), pitch


def gait_foot(build, side, phase, offset, cycle, stance, strike_pitch=-16.0, push_pitch=42.0, lift=0.075,
              flat=(0.1, 0.42), swing_keys=None):
    """A foot through one gait cycle: planted (sliding back at the gait's speed), then swung."""
    s = (phase - offset) % 1.0
    if s < stance:
        return _foot_stance(build, side, s, cycle, stance, strike_pitch, push_pitch, flat[0], flat[1])
    u = (s - stance) / (1.0 - stance)
    start, p0 = _foot_stance(build, side, stance - 1e-6, cycle, stance, strike_pitch, push_pitch, flat[0], flat[1])
    end, p1 = _foot_stance(build, side, 0.0, cycle, stance, strike_pitch, push_pitch, flat[0], flat[1])
    if swing_keys is not None:
        # (u, forward share 0..1 from toe-off to strike, height above the straight line, pitch)
        keys = [(0.0, 0.0, 0.0, p0)] + list(swing_keys) + [(1.0, 1.0, 0.0, p1)]
        for (ua, fa, ha, pa), (ub, fb, hb, pb) in zip(keys, keys[1:]):
            if ua <= u <= ub:
                t = smooth((u - ua) / max(ub - ua, 1e-9))
                share, height, pitch = lerp(fa, fb, t), lerp(ha, hb, t), lerp(pa, pb, t)
                break
    else:
        share = smoother(u)
        height = lift * math.sin(math.pi * min(1.0, u * 1.08)) ** 1.3 * (1.0 - 0.25 * u)
        pitch = lerp(p0, 4.0, smooth(u / 0.5)) if u < 0.5 else lerp(4.0, p1, smooth((u - 0.5) / 0.5))
    point = start + (end - start) * share
    point = point + np.array([0.0, 0.0, height])
    return point, pitch


def relaxed_arm(sign, swing=0.0, elbow=12.0, abduct=7.0, drop=6.0):
    """An arm hanging loose: a little out from the body, turned so the palm faces the thigh, the
    elbow soft and the hand trailing (`drop` flexes the wrist back)."""
    return dict(shoulder=(swing, abduct, -10.0), elbow=elbow, wrist=(-drop, 4.0 * sign))


def walk(phase, build, step=0.52, stance=0.62, bob=0.016, sway=0.022, drop=4.0, twist=6.0, arm=17.0,
         lean=4.0):
    """A calm walk across a shop: right heel strikes at phase 0, left at 0.5. The arms hang and
    swing from the shoulder with the opposite leg, a little behind it, the forearm and hand trailing
    the upper arm; the shoulders turn against the hips; the head stays level and forward."""
    cycle = 2.0 * step
    spec = {}
    yaw = twist * math.cos(math.tau * phase)
    roll = drop * math.sin(math.tau * (phase - 0.06))
    spec["root"] = (-sway * math.sin(math.tau * (phase - 0.06)), 0.0,
                    -0.03 + bob * math.cos(2.0 * math.tau * (phase - 0.31)))
    spec["pelvis"] = (yaw, lean + 1.2 * math.cos(2.0 * math.tau * (phase - 0.1)), roll)
    spec["spine"] = (-0.9 * yaw, 1.5, -0.65 * roll)
    spec["chest"] = (-0.8 * yaw, 2.0 + 0.8 * math.cos(2.0 * math.tau * (phase - 0.22)), -0.35 * roll)
    net = yaw * (1.0 - 0.9 - 0.8)
    spec["neck"] = (-0.5 * net, 3.0, 0.2 * roll)
    spec["head"] = (-0.5 * net, -lean - 1.5 - 0.8 * math.cos(2.0 * math.tau * (phase - 0.31)), 0.25 * roll)
    for side, sign, offset in (("R", -1.0, 0.0), ("L", 1.0, 0.5)):
        ankle, pitch = gait_foot(build, side, phase, offset, cycle, stance)
        spec["leg_" + side] = dict(ankle=ankle, pole=FWD + np.array([0.12 * sign, 0.0, 0.0]),
                                   foot=(pitch, 5.0 * sign))
        # The arm swings with the opposite leg; the elbow folds a moment after the shoulder.
        c = math.cos(math.tau * (phase - 0.06 - offset - 0.5))
        c_late = math.cos(math.tau * (phase - 0.13 - offset - 0.5))
        spec["arm_" + side] = relaxed_arm(sign, swing=1.0 + arm * c, elbow=8.0 + 11.0 * max(0.0, c_late) ** 1.4,
                                          abduct=7.0 + 2.0 * (1.0 - c) * 0.5, drop=3.0 + 10.0 * max(0.0, c))
        spec["clav_" + side] = (-sign * (2.0 + 3.0 * c), 0.0, -sign * 1.2 * math.sin(math.tau * (phase - offset)))
    spec["hair_swing"] = (5.0 * math.sin(2.0 * math.tau * (phase - 0.15)), 0.0, 4.0 * math.sin(math.tau * phase))
    spec["coat_swing"] = (0.025 * math.sin(math.tau * (phase - 0.18)), 0.05 + 0.015 * math.cos(2.0 * math.tau * phase))
    return spec


def run(phase, build, step=0.85, stance=0.38, bob=0.032, lean=8.0, arm=26.0):
    """A steady jog on a treadmill: a flight phase, the heel kicked up behind, arms pumping bent."""
    cycle = 2.0 * step
    spec = {}
    yaw = 7.0 * math.cos(math.tau * phase)
    spec["root"] = (-0.012 * math.sin(math.tau * (phase - 0.08)), 0.0,
                    -0.075 - bob * math.cos(2.0 * math.tau * (phase - 0.19)))
    spec["pelvis"] = (yaw, lean, 3.0 * math.sin(math.tau * (phase - 0.08)))
    spec["spine"] = (-1.0 * yaw, 2.0, 0.0)
    spec["chest"] = (-0.9 * yaw, 2.0, 0.0)
    spec["neck"] = (0.45 * yaw, -lean * 0.5, 0.0)
    spec["head"] = (0.45 * yaw, -lean * 0.4 + 3.0, 0.0)
    swing_keys = [(0.32, 0.12, 0.2, 60.0), (0.62, 0.62, 0.17, 10.0), (0.85, 0.94, 0.05, -8.0)]
    for side, sign, offset in (("R", -1.0, 0.0), ("L", 1.0, 0.5)):
        ankle, pitch = gait_foot(build, side, phase, offset, cycle, stance, strike_pitch=-6.0, push_pitch=38.0,
                                 flat=(0.06, 0.2), swing_keys=swing_keys)
        spec["leg_" + side] = dict(ankle=ankle, pole=FWD + np.array([0.08 * sign, 0.0, 0.0]), foot=(pitch, 3.0 * sign))
        c = math.cos(math.tau * (phase - 0.03 - offset - 0.5))
        spec["arm_" + side] = dict(shoulder=(8.0 + arm * c, 8.0, -6.0), elbow=88.0 - 12.0 * c, wrist=(8.0, 10.0))
        spec["clav_" + side] = (-sign * 5.0 * c, 0.0, 0.0)
    spec["hair_swing"] = (10.0 * math.sin(2.0 * math.tau * (phase - 0.25)), 0.0, 0.0)
    return spec


def _stand(build, spec, weight, sway, left_foot=(0.12, -0.05, 6.0), right_foot=(-0.1, 0.0, -6.0)):
    """Standing with the feet planted at (x, forward, toe-out yaw), the pelvis over the weighted
    leg (weight +1: the right, -1: the left)."""
    rest = REST[build]
    spec["root"] = (-weight * 0.03 + sway[0], sway[1], -0.012 + sway[2])
    spec["pelvis"] = spec.get("pelvis", (0.0, 2.0, 4.0 * weight))
    for side, sign, (x, fwd, yaw) in (("L", 1.0, left_foot), ("R", -1.0, right_foot)):
        ankle = np.array([x, rest["ankle_" + side][1] - fwd, rest["ankle_" + side][2]])
        spec["leg_" + side] = dict(ankle=ankle, pole=FWD + np.array([0.15 * sign, 0.0, 0.0]), foot=(0.0, yaw))
    return spec


def stand_rest(phase, build, hands="coat"):
    """A walker stopped at the end of the room: the weight settles on one leg, the hands in the
    pockets, a slow look round, breathing."""
    rest = REST[build]
    breath = math.sin(math.tau * phase * 2.0)
    spec = {}
    weight = 0.7 + 0.25 * wave(phase, 1.0, 0.15)
    _stand(build, spec, weight, (0.004 * wave(phase, 1.0, 0.3), 0.0, 0.002 * breath),
           left_foot=(0.13, -0.04, 10.0), right_foot=(-0.11, 0.02, -8.0))
    spec["pelvis"] = (3.0 * wave(phase, 1.0, 0.15), 2.5, 4.0 * weight)
    spec["spine"] = (-2.0 * wave(phase, 1.0, 0.15), 1.5, -2.6 * weight)
    spec["chest"] = (0.0, 2.5 - 0.7 * breath, -1.2 * weight)
    look = cyc(phase, [(0.0, (-6.0, 4.0)), (0.25, (-30.0, 2.0)), (0.45, (-26.0, 6.0)), (0.62, (12.0, 3.0)),
                       (0.82, (26.0, 0.0))])
    spec["neck"] = (look[0] * 0.35, 3.0 + look[1] * 0.3, 2.0 * weight)
    spec["head"] = (look[0] * 0.65, look[1] * 0.7, 0.0)
    pelvis = rest["pelvis"]
    for side, sign in (("L", 1.0), ("R", -1.0)):
        if hands == "coat":
            pocket = pelvis + np.array([0.19 * sign, -0.07, -0.1])
            pole = (sign * 1.0, 0.6, -0.2)
        else:  # both hands in a hoodie's front pocket
            pocket = pelvis + np.array([0.06 * sign, -0.14, 0.02])
            pole = (sign * 0.8, 0.8, -0.4)
        spec["arm_" + side] = dict(hand=pocket, pole=pole, wrist=(-15.0, sign * 10.0))
        spec["clav_" + side] = (-sign * 2.0, 0.0, -sign * 1.0 * breath)
    spec["coat_swing"] = (0.0, 0.0)
    return spec


def idle_look(phase, build):
    """Waiting about: hands in the jeans' front pockets, the weight on one leg and the hip out,
    breathing, looking slowly round the shop."""
    rest = REST[build]
    breath = math.sin(math.tau * phase * 2.0)
    spec = {}
    weight = 0.75 + 0.25 * wave(phase)
    _stand(build, spec, weight, (0.005 * wave(phase, 1.0, 0.2), 0.0, 0.002 * breath),
           left_foot=(0.14, -0.06, 12.0), right_foot=(-0.1, 0.0, -6.0))
    spec["pelvis"] = (3.0 * wave(phase, 1.0, 0.1), 1.5, 5.0 * weight)
    spec["spine"] = (-2.0 * wave(phase, 1.0, 0.1), 0.5, -3.0 * weight)
    spec["chest"] = (0.0, 1.0 - 0.7 * breath, -1.5 * weight)
    look = cyc(phase, [(0.0, (0.0, 3.0)), (0.2, (-24.0, 1.0)), (0.38, (-26.0, 5.0)), (0.55, (4.0, 2.0)),
                       (0.72, (28.0, -2.0)), (0.86, (22.0, 4.0))])
    spec["neck"] = (look[0] * 0.35, look[1] * 0.4, 2.0 * weight)
    spec["head"] = (look[0] * 0.65, look[1] * 0.6, 0.0)
    pelvis = rest["pelvis"]
    for side, sign in (("L", 1.0), ("R", -1.0)):
        pocket = pelvis + np.array([0.13 * sign, -0.09, -0.07])
        spec["arm_" + side] = dict(hand=pocket, pole=(sign * 1.0, 0.7, -0.1), wrist=(-25.0, sign * 15.0))
        spec["clav_" + side] = (-sign * 1.0, 0.0, -sign * 1.0 * breath)
    return spec


def work_counter(phase, build):
    """A cook at the stove, bent over it: stirs a pot, tosses the pan in the other hand, turns to the
    shelf behind for a pinch of something and sprinkles it in."""
    rest = REST[build]
    breath = math.sin(math.tau * phase * 3.0)
    spec = {}
    stirring = cyc(phase, [(0.0, 1.0), (0.36, 1.0), (0.42, 0.0), (0.92, 0.0)])
    toss = cyc(phase, [(0.0, 0.0), (0.4, 0.0), (0.45, 1.0), (0.49, -0.5), (0.53, 0.25), (0.57, 0.0)])
    reach = cyc(phase, [(0.0, 0.0), (0.56, 0.0), (0.66, 1.0), (0.72, 1.0), (0.81, 0.0)])
    sprinkle = cyc(phase, [(0.0, 0.0), (0.78, 0.0), (0.83, 1.0), (0.94, 1.0), (0.99, 0.0)])
    _stand(build, spec, 0.35 * wave(phase, 1.0, 0.1), (0.008 * wave(phase, 1.0, 0.1), 0.04, -0.02),
           left_foot=(0.15, -0.02, 10.0), right_foot=(-0.13, 0.02, -10.0))
    spec["pelvis"] = (-16.0 * reach, 9.0 - 4.0 * reach, 1.5 * wave(phase, 1.0, 0.1))
    spec["spine"] = (-11.0 * reach, 7.0 - 5.0 * reach, 0.0)
    spec["chest"] = (-9.0 * reach + 2.0 * wave(phase, 0.25), 8.0 - 6.0 * reach - 0.6 * breath, 0.0)
    look_yaw = -48.0 * reach + 6.0 * toss
    look_pitch = 18.0 - 22.0 * reach + 4.0 * toss - 2.0 * sprinkle
    spec["neck"] = (look_yaw * 0.4, look_pitch * 0.45, 0.0)
    spec["head"] = (look_yaw * 0.6, look_pitch * 0.55, 0.0)
    hz = rest["pelvis"][2] + 0.07
    angle = math.tau * phase * 2.4 / 0.4
    pot = np.array([-0.11, -0.31, hz])
    stir = pot + np.array([0.05 * math.cos(angle), 0.035 * math.sin(angle), 0.012 + 0.01 * math.sin(angle)])
    rim = pot + np.array([0.02, 0.03, 0.03])
    # The shelf is behind them, to their right: they turn away from the street to reach it.
    shelf = np.array([-0.3, 0.3, 1.18])
    shake = 0.012 * math.sin(math.tau * phase * 24.0) * sprinkle
    over = pot + np.array([0.0, 0.02, 0.17 + shake])
    hand_r = stir * stirring + rim * (1.0 - stirring)
    hand_r = hand_r + (shelf - hand_r) * reach
    hand_r = hand_r + (over - hand_r) * sprinkle
    pan = np.array([0.17, -0.27 - 0.05 * toss, hz + 0.065 * toss])
    spec["arm_R"] = dict(hand=hand_r, pole=(-0.9, 0.5 - 0.6 * reach, -0.5 - 0.4 * reach),
                         wrist=(10.0 - 25.0 * sprinkle, -20.0))
    spec["arm_L"] = dict(hand=pan, pole=(0.9, 0.5, -0.5), wrist=(-10.0, 30.0 + 20.0 * toss))
    for side, sign in (("L", 1.0), ("R", -1.0)):
        spec["clav_" + side] = (-sign * 3.0, 0.0, -sign * 0.8 * breath)
    return spec


def work_step(phase, build, stride=0.31):
    """The cook moving along the counter: sidesteps toward their left (the shader mirrors it for
    the other way), a bowl carried in both hands, the body bobbing with each step."""
    rest = REST[build]
    spec = {}
    bob = math.cos(2.0 * math.tau * phase)
    spec["root"] = (0.012 * math.sin(math.tau * phase), 0.03, -0.035 + 0.012 * bob)
    spec["pelvis"] = (-6.0, 5.0, 3.0 * math.sin(math.tau * phase))
    spec["spine"] = (3.0, 3.0, -2.0 * math.sin(math.tau * phase))
    spec["chest"] = (2.0, 4.0, 0.0)
    spec["neck"] = (8.0, 4.0, 0.0)
    spec["head"] = (12.0, 6.0, 0.0)
    for side, sign, offset in (("L", 1.0, 0.0), ("R", -1.0, 0.5)):
        u = (phase - offset) % 1.0
        # The leading (left) foot steps out, the other closes in; each lifts as it moves.
        lift = 0.05 * max(0.0, math.sin(math.tau * u)) ** 1.5
        shift = stride * 0.5 * math.cos(math.tau * u)
        ankle = rest["ankle_" + side] + np.array([shift, 0.0, lift])
        spec["leg_" + side] = dict(ankle=ankle, pole=FWD + np.array([0.2 * sign, 0.0, 0.0]), foot=(0.0, 8.0 * sign))
    bowl = rest["chest"] + np.array([0.0, -0.28, -0.13 + 0.006 * bob])
    spec["arm_L"] = dict(hand=bowl + np.array([0.08, 0.0, 0.0]), pole=(0.9, 0.6, -0.5), wrist=(-15.0, 50.0))
    spec["arm_R"] = dict(hand=bowl + np.array([-0.08, 0.0, 0.0]), pole=(-0.9, 0.6, -0.5), wrist=(-15.0, -50.0))
    return spec


def idle_phone(phase, build):
    """Waiting with a phone: head bowed over it, thumb scrolling, a glance up and back down."""
    breath = math.sin(math.tau * phase * 2.0)
    rest = REST[build]
    spec = {}
    weight = -0.85
    _stand(build, spec, weight, (0.003 * wave(phase, 1.0, 0.4), 0.0, 0.002 * breath),
           left_foot=(0.1, 0.0, 8.0), right_foot=(-0.13, -0.06, -14.0))
    spec["pelvis"] = (-4.0, 2.0, 4.0 * weight)
    spec["spine"] = (2.0, 2.0, -2.6 * weight)
    spec["chest"] = (2.0, 3.0 - 0.6 * breath, -1.0 * weight)
    glance = cyc(phase, [(0.0, 0.0), (0.5, 0.0), (0.58, 1.0), (0.7, 1.0), (0.8, 0.0)])
    spec["neck"] = (0.0, 14.0 - 10.0 * glance, 0.0)
    spec["head"] = (6.0 * glance, 16.0 - 14.0 * glance, 0.0)
    chest = rest["chest"]
    scroll = 0.006 * math.sin(math.tau * phase * 4.0)
    spec["arm_R"] = dict(hand=chest + np.array([-0.06, -0.23, -0.115 + scroll]), pole=(-0.6, 1.0, -0.4),
                         wrist=(-30.0, -60.0))
    spec["arm_L"] = dict(hand=chest + np.array([0.0, -0.22, -0.135]), pole=(0.7, 1.0, -0.3), wrist=(-20.0, 40.0))
    spec["clav_L"] = (0.0, 0.0, -0.8 * breath)
    spec["clav_R"] = (0.0, 0.0, 0.8 * breath)
    return spec


def arcade(phase, build):
    """At a cabinet: a hand on the stick, a hand on the buttons, leaning in, bouncing a little."""
    rest = REST[build]
    spec = {}
    bounce = abs(math.sin(math.tau * phase * 2.0))
    _stand(build, spec, 0.4, (0.006 * wave(phase), 0.0, -0.008 * bounce), left_foot=(0.14, -0.04, 10.0),
           right_foot=(-0.13, 0.02, -10.0))
    spec["pelvis"] = (2.0 * wave(phase), 5.0, 1.0)
    spec["spine"] = (0.0, 4.0, 0.0)
    spec["chest"] = (-3.0 * wave(phase, 1.0, 0.25), 4.0, 0.0)
    spec["neck"] = (0.0, -2.0, 0.0)
    spec["head"] = (2.0 * wave(phase, 0.5), -4.0 + 2.0 * bounce, 0.0)
    hz = rest["pelvis"][2] + 0.06
    stick = cyc(phase, [(0.0, (0.0, 0.0)), (0.2, (0.03, -0.01)), (0.35, (-0.02, 0.01)), (0.55, (0.025, 0.02)),
                        (0.7, (-0.03, -0.01)), (0.85, (0.01, 0.0))])
    tap = 0.015 * max(0.0, math.sin(math.tau * phase * 4.0))
    spec["arm_L"] = dict(hand=np.array([0.11 + stick[0], -0.37 + stick[1], hz]), pole=(0.8, 1.0, -0.2),
                         wrist=(-20.0, 0.0))
    spec["arm_R"] = dict(hand=np.array([-0.13, -0.38, hz - tap]), pole=(-0.8, 1.0, -0.2), wrist=(25.0, 0.0))
    return spec


def lotus(level, build):
    """Seated cross-legged on a mat, hands on the knees; `level` is the breath (0 out, 1 in)."""
    rest = REST[build]
    b = smooth(level)
    spec = {}
    seat = rest["hip_L"][2] - 0.13
    spec["root"] = (0.0, 0.02, -seat + 0.004 * b)
    spec["pelvis"] = (0.0, 6.0, 0.0)
    spec["spine"] = (0.0, -2.0, 0.0)
    spec["chest"] = (0.0, -3.0 - 3.0 * b, 0.0)
    spec["neck"] = (0.0, 3.0 + 1.0 * b, 0.0)
    spec["head"] = (0.0, 4.0 - 1.0 * b, 0.0)
    for side, sign in (("L", 1.0), ("R", -1.0)):
        ankle = np.array([-sign * 0.13, rest["ankle_" + side][1] - 0.2 - (0.04 if sign > 0 else 0.0),
                          0.05 + (0.035 if sign > 0 else 0.0)])
        spec["leg_" + side] = dict(ankle=ankle, pole=(sign * 1.0, -0.6, 0.35), foot=(30.0, -sign * 70.0))
        knee = np.array([sign * 0.27, rest["knee_" + side][1] - 0.24, 0.2])
        spec["arm_" + side] = dict(hand=knee, pole=(sign * 0.9, 0.6, -0.6), wrist=(-25.0, sign * 15.0))
        spec["clav_" + side] = (0.0, 0.0, -sign * 2.5 * b)
    return spec


STOOL = (0.0, 0.03, 0.71)


def sit_eat(phase, build):
    """On a stool at the counter, back to the street, hunched over the bowl: the bowl held close in
    one hand, chopsticks in the other; a mouthful lifted, chewed with a little nod, and a glance up
    at the television."""
    rest = REST[build]
    spec = {}
    spec["root"] = (0.0, 0.03, STOOL[2] + 0.125 - rest["pelvis"][2])
    lean = cyc(phase, [(0.0, 0.0), (0.3, 0.2), (0.45, 1.0), (0.58, 1.0), (0.72, 0.1), (0.9, 0.0)])
    chew = cyc(phase, [(0.0, 0.0), (0.55, 0.0), (0.6, 1.0), (0.76, 1.0), (0.8, 0.0)])
    glance = cyc(phase, [(0.0, 0.0), (0.8, 0.0), (0.85, 1.0), (0.95, 1.0), (0.99, 0.0)])
    nod = 2.5 * math.sin(math.tau * phase * 18.0) * chew
    spec["pelvis"] = (0.0, 9.0 + 4.0 * lean, 0.0)
    spec["spine"] = (0.0, 8.0 + 3.0 * lean, 0.0)
    spec["chest"] = (0.0, 9.0 + 4.0 * lean - 3.0 * glance, 0.0)
    spec["neck"] = (6.0 * glance, 7.0 + 5.0 * lean - 8.0 * glance, 0.0)
    spec["head"] = (3.0 * wave(phase, 1.0, 0.7) + 12.0 * glance, 12.0 + 6.0 * lean + nod - 16.0 * glance, 0.0)
    counter_z = 1.06
    for side, sign in (("L", 1.0), ("R", -1.0)):
        ankle = np.array([sign * 0.11, rest["ankle_" + side][1] - 0.3, 0.3 + (0.02 if sign > 0 else 0.0)])
        spec["leg_" + side] = dict(ankle=ankle, pole=FWD + np.array([0.25 * sign, 0.0, 0.3]),
                                   foot=(15.0, sign * 8.0))
        spec["clav_" + side] = (-sign * 4.0, 0.0, 0.0)
    bowl = np.array([0.07, -0.3, counter_z + 0.07])
    spec["arm_L"] = dict(hand=bowl + np.array([0.0, 0.0, 0.03 * lean]), pole=(0.9, 0.8, -0.6), wrist=(-30.0, 30.0))
    mouth = posed_head(build, spec, (-0.03, -0.17, -0.05))
    lift = cyc(phase, [(0.0, 0.0), (0.22, 0.0), (0.42, 1.0), (0.55, 1.0), (0.7, 0.1), (0.85, 0.0)])
    stir = 0.02 * math.sin(math.tau * phase * 3.0) * (1.0 - lift)
    at_bowl = np.array([-0.04 + stir, -0.31, counter_z + 0.11])
    spec["arm_R"] = dict(hand=at_bowl + (mouth - at_bowl) * lift,
                         pole=(-0.8, 1.0, -0.5), wrist=(-40.0 * lift, -10.0))
    return spec


def lean_bar(phase, build):
    """Leaning on the bar on the forearms, a glass lifted now and then, a weight shift."""
    rest = REST[build]
    spec = {}
    sip = cyc(phase, [(0.0, 0.0), (0.4, 0.0), (0.52, 1.0), (0.62, 1.0), (0.75, 0.0)])
    _stand(build, spec, 0.6 * wave(phase, 1.0, 0.1), (0.0, 0.03, 0.0), left_foot=(0.12, -0.02, 10.0),
           right_foot=(-0.14, -0.06, -14.0))
    spec["pelvis"] = (2.0, 16.0, 2.0 * wave(phase, 1.0, 0.1))
    spec["spine"] = (0.0, 9.0 - 4.0 * sip, 0.0)
    spec["chest"] = (-4.0 * sip, 5.0 - 5.0 * sip, 0.0)
    spec["neck"] = (0.0, -8.0 - 4.0 * sip, 0.0)
    spec["head"] = (5.0 * wave(phase, 1.0, 0.3), -6.0 - 10.0 * sip, 0.0)
    counter_z = 1.1
    spec["arm_L"] = dict(hand=np.array([0.07, -0.47, counter_z + 0.03]), pole=(0.7, 0.4, -1.0), wrist=(-10.0, 50.0))
    glass = np.array([-0.06, -0.46, counter_z + 0.05])
    mouth = posed_head(build, spec, (-0.03, -0.16, -0.06))
    spec["arm_R"] = dict(hand=glass + (mouth - glass) * sip, pole=(-0.7, 0.4 + 0.6 * sip, -1.0),
                         wrist=(-30.0 * sip, -50.0 + 30.0 * sip))
    return spec


def curls(phase, build):
    """Alternating dumbbell curls in front of the mirror."""
    breath = math.sin(math.tau * phase * 2.0)
    spec = {}
    _stand(build, spec, 0.15 * wave(phase), (0.0, 0.0, -0.01), left_foot=(0.15, 0.0, 10.0),
           right_foot=(-0.15, 0.0, -10.0))
    spec["pelvis"] = (0.0, 2.0, 0.6 * wave(phase))
    spec["spine"] = (0.0, -1.0, 0.0)
    spec["chest"] = (3.0 * wave(phase), -1.0 - 0.8 * breath, -1.2 * wave(phase))
    spec["neck"] = (0.0, 4.0, 0.0)
    spec["head"] = (0.0, 2.0, 0.0)
    for side, sign, offset in (("R", -1.0, 0.0), ("L", 1.0, 0.5)):
        up = cyc(phase - offset, [(0.0, 0.0), (0.12, 0.05), (0.32, 1.0), (0.4, 1.0), (0.62, 0.0)])
        spec["arm_" + side] = dict(shoulder=(4.0 + 10.0 * up, 6.0, 0.0), elbow=12.0 + 120.0 * up,
                                   wrist=(-10.0 * up, 0.0))
        spec["clav_" + side] = (0.0, 0.0, -sign * 2.0 * up)
    return spec


def browse(phase, build):
    """At the shelves, back to the street: looks up, reaches for something, brings it down to read
    the label, and puts it back."""
    rest = REST[build]
    spec = {}
    reach = cyc(phase, [(0.0, 0.0), (0.12, 0.0), (0.3, 1.0), (0.4, 1.0), (0.55, 0.45), (0.72, 0.45),
                        (0.84, 0.0)])
    hold = cyc(phase, [(0.0, 0.0), (0.4, 0.0), (0.55, 1.0), (0.72, 1.0), (0.84, 0.0)])
    _stand(build, spec, 0.5 - 0.6 * reach, (0.0, -0.01 * reach, 0.0), left_foot=(0.12, -0.03, 8.0),
           right_foot=(-0.12, 0.02, -8.0))
    spec["pelvis"] = (-5.0 * reach, 2.0, 2.0)
    spec["spine"] = (-3.0 * reach, -2.0 * reach + 3.0 * hold, 0.0)
    spec["chest"] = (-3.0 * reach, -3.0 * reach + 3.0 * hold, 3.0 * reach)
    tilt = -18.0 * (reach - 0.45 * hold) + 22.0 * hold
    spec["neck"] = (-6.0 * reach, tilt * 0.4, 0.0)
    spec["head"] = (-8.0 * reach + 4.0 * wave(phase, 1.0, 0.1), tilt * 0.6, 0.0)
    shelf = np.array([-0.15, -0.34, rest["head"][2] + 0.12])
    chest = rest["chest"] + np.array([-0.04, -0.24, -0.04])
    side_hand = rest["wrist_R"] + np.array([0.0, -0.04, 0.02])
    target = side_hand + (shelf - side_hand) * reach * (1.0 - hold) + (chest - side_hand) * hold
    spec["arm_R"] = dict(hand=target, pole=(-1.0, 0.6, -0.6), wrist=(-20.0 * reach - 30.0 * hold, -20.0 * hold))
    spec["arm_L"] = dict(shoulder=(4.0 + 30.0 * hold, 6.0, 0.0), elbow=12.0 + 70.0 * hold, wrist=(10.0, 20.0 * hold))
    return spec


# -- the registry ---------------------------------------------------------------------------------
# views: "side" (20, 55, 90, 125, 160 degrees from the face), "front" (0, 35, 70), "back" (110, 145, 180)
VIEW_SETS = {"front": (0.0, 35.0, 70.0), "back": (110.0, 145.0, 180.0), "side": (20.0, 55.0, 90.0, 125.0, 160.0)}

# timing: "distance" (frames by metres walked, `metres` a loop), "loop" (`seconds` a loop) or
# "level" (frames along a 0..1 value the shader reads: the breath).
CLIPS = {
    # A fixer: a calf-length coat with the collar up, a lit visor, a pauldron, a belt of pouches.
    "walkA": dict(build="A", outfit=dict(top="longcoat", bottom="trousers", hair="undercut", shoes="boots", gear=["collar", "visor", "pauldron_L", "belt", "pouches"], trims=["cuffs"]),
                  frames=24, views="side", pose=lambda ph: walk(ph, "A"), timing="distance", metres=1.04,
                  seconds=1.05),
    # A netrunner: hood up, goggles and a respirator, a strap across the chest, bracers, lit soles.
    "walkB": dict(build="B", outfit=dict(top="hoodie", bottom="cargo", hair=None, shoes="boots", gear=["hood", "mask", "goggles_eyes", "strap_L", "belt", "bracers"], trims=["zip", "soles"]),
                  frames=24, views="side", pose=lambda ph: walk(ph, "B", step=0.48, sway=0.026, drop=5.0, arm=14.0),
                  timing="distance", metres=0.96, seconds=1.0),
    # The two of them at rest at the end of a walk.
    "standA": dict(build="A", outfit=dict(top="longcoat", bottom="trousers", hair="undercut", shoes="boots", gear=["collar", "visor", "pauldron_L", "belt", "pouches"], trims=["cuffs"]),
                   frames=12, views="front", pose=lambda ph: stand_rest(ph, "A", "coat"), timing="loop", seconds=7.0),
    "standB": dict(build="B", outfit=dict(top="hoodie", bottom="cargo", hair=None, shoes="boots", gear=["hood", "mask", "goggles_eyes", "strap_L", "belt", "bracers"], trims=["zip", "soles"]),
                   frames=12, views="front", pose=lambda ph: stand_rest(ph, "B", "hoodie"), timing="loop",
                   seconds=6.5),
    # A punk: mohawk, goggles on the brow, a bomber with a lit zip, a chrome arm under a pauldron.
    "idleA": dict(build="A", outfit=dict(top="bomber", bottom="cargo", hair="mohawk", shoes="boots",
                                         gear=["earpiece", "goggles", "pauldron_R", "belt", "pouches"], trims=["zip"],
                                         cyber=["R"]),
                  frames=16, views="front", pose=lambda ph: idle_look(ph, "A"), timing="loop", seconds=7.0),
    # A corp fixer on her phone: a long coat with a high collar, a sharp bob, a cyber eye.
    "idleB": dict(build="B", outfit=dict(top="longcoat", bottom="trousers", hair="bob", shoes="boots",
                                         gear=["collar", "eye", "belt"], trims=["cuffs"], props=[dict(kind="phone")]),
                  frames=16, views="front", pose=lambda ph: idle_phone(ph, "B"), timing="loop", seconds=6.0),
    # A big street cook: headband, a cyber eye, a mechanical fist on the pan.
    "work": dict(build="C", outfit=dict(top="chef", bottom="trousers", hair="buzz", shoes="boots", gear=["headband", "eye", "gauntlet_L", "belt"]),
                 frames=24, views="front", pose=lambda ph: work_counter(ph, "C"), timing="loop", seconds=5.2),
    # The cook stepping along the counter (toward their left; mirrored for the other way).
    "workStep": dict(build="C", outfit=dict(top="chef", bottom="trousers", hair="buzz", shoes="boots", gear=["headband", "eye", "gauntlet_L", "belt"]),
                     frames=12, views="front", pose=lambda ph: work_step(ph, "C"), timing="distance", metres=0.62,
                     seconds=0.9),
    # A runner: lit stripes down the leggings, lit soles, bracers and knee pads.
    "run": dict(build="B", outfit=dict(top="tank", bottom="leggings", hair="ponytail",
                                       gear=["earpiece", "bracers", "kneepads"], trims=["legs", "soles"]),
                frames=16, views="front", pose=lambda ph: run(ph, "B"), timing="loop", seconds=0.7),
    # A gamer: spiky hair, headphones, lit stripes down the back of the hoodie.
    "arcade": dict(build="A", outfit=dict(top="hoodie", bottom="cargo", hair="spiky", shoes="boots",
                                          gear=["headphones", "belt", "pouches"], trims=["back"]),
                   frames=16, views="back", pose=lambda ph: arcade(ph, "A"), timing="loop", seconds=1.6),
    # A shaven monk with glowing implants, breathing.
    "lotus": dict(build="B", outfit=dict(top="tee", bottom="leggings", hair="buzz", gear=["implants", "bracers"]),
                  frames=12, views="front", pose=lambda lv: lotus(lv, "B"), timing="level"),
    # A courier on a stool: goggles on the brow, crossed straps over a bomber with lit back stripes.
    "sitEat": dict(build="A", outfit=dict(top="bomber", bottom="cargo", hair="undercut", shoes="boots",
                                          gear=["earpiece", "goggles", "strap_L", "strap_R"], trims=["back"],
                                          props=[dict(kind="stool", seat=STOOL)]),
                   frames=24, views="back", pose=lambda ph: sit_eat(ph, "A"), timing="loop", seconds=5.0),
    # At the bar: a long coat, collar up, a pauldron, a dyed bob.
    "lean": dict(build="B", outfit=dict(top="longcoat", bottom="trousers", hair="bob", shoes="boots",
                                        gear=["collar", "pauldron_L", "belt"], trims=["cuffs"]),
                 frames=16, views="back", pose=lambda ph: lean_bar(ph, "B"), timing="loop", seconds=6.0),
    # A heavy cyborg lifting: a mechanical fist under a pauldron, a strap, a cyber eye.
    "lift": dict(build="C", outfit=dict(top="tank", bottom="cargo", hair="buzz", shoes="boots",
                                        gear=["eye", "gauntlet_R", "pauldron_R", "strap_L", "belt"],
                                        props=[dict(kind="dumbbell")]),
                 frames=16, views="front", pose=lambda ph: curls(ph, "C"), timing="loop", seconds=3.2),
    # A scavenger at the shelves: a pack of glowing canisters, goggles, bracers, a ponytail.
    "browse": dict(build="B", outfit=dict(top="hoodie", bottom="cargo", hair="ponytail", shoes="boots",
                                          gear=["backpack", "canisters", "goggles", "bracers", "belt"]),
                   frames=16, views="back", pose=lambda ph: browse(ph, "B"), timing="loop", seconds=7.0),
}


def phases(clip):
    """The phase (or level) each frame of a clip is posed at."""
    n = clip["frames"]
    if clip["timing"] == "level":
        return [k / (n - 1) for k in range(n)]
    return [k / n for k in range(n)]
