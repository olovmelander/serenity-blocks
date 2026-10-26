"""Fall's red squirrel: its clips, authored as functions of time and keyed into Blender actions.

Each clip is a function from seconds to a spec (solver.py): where the body is and how it bends, where
each paw is put, how the head, ears, jaw and tail turn. The runtime plays the clips in place and moves
the squirrel itself (fall-squirrel-mind.js), so a gait's planted paws slide back under the body at the
clip's own speed (`speed`, metres a second at life size): played at that speed over the ground (times
the drawn scale) they stand still on it.

Squirrel motion is quick and jerky: dashes, dead stops, the tail flicking in waves. The clips keep
that: snappy eases in and out of holds, the tail always a beat behind the body.
"""

import math

import numpy as np

from .solver import rest_feet

TAU = 2.0 * math.pi
REST = rest_feet()


def P(x, y, z):
    return np.array([x, y, z], dtype=np.float64)


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3.0 - 2.0 * x)


def wrap(p):
    return p - math.floor(p)


def window(p, start, end):
    """0..1 progress of cyclic phase `p` through [start, end) (wrapping), or None outside it."""
    span = wrap(end - start)
    u = wrap(p - start)
    return u / span if u < span else None


def bump(p, centre, width):
    """A smooth cyclic bump of 1 at `centre`, 0 beyond `width` either side."""
    d = abs(wrap(p - centre + 0.5) - 0.5)
    return 0.5 * (1.0 + math.cos(math.pi * min(1.0, d / width)))


def noise(t, seed):
    """A smooth wander about -1..1 (a sum of incommensurate sines)."""
    return (0.5 * math.sin(t * 1.3 + seed * 1.7) + 0.3 * math.sin(t * 2.9 + seed * 4.1)
            + 0.2 * math.sin(t * 5.3 + seed * 2.3))


# -- the tail ------------------------------------------------------------------------------
# Held up behind the back in an S: rising from the rump, curling over, the brush turned back.
TAIL_S = [(38, 0, 0), (26, 0, 0), (16, 0, 0), (6, 0, 0), (-12, 0, 0), (-24, 0, 0), (-28, 0, 0)]
# Streamed out behind and a little up, as when it runs.
TAIL_STREAM = [(-18, 0, 0), (-4, 0, 0), (2, 0, 0), (4, 0, 0), (4, 0, 0), (2, 0, 0), (0, 0, 0)]


def tail_pose(base, wave=0.0, sway=0.0, t=0.0, speed=1.0, lag=0.5, flick=0.0):
    """`base` angles plus a travelling wave (up and down, `wave` degrees), a side sway (`sway`) and a
    flick: a quick crack that runs from the root to the brush (`flick` 0..1 at its height)."""
    out = []
    for i, (x, y, z) in enumerate(base):
        k = (i + 1) / len(base)
        phase = t * speed * TAU - i * lag
        wx = wave * math.sin(phase) * (0.4 + 0.6 * k)
        wy = sway * math.sin(phase * 0.5 + 0.8) * (0.3 + 0.7 * k)
        # A flick snaps the root first; the brush follows a beat later and further.
        fx = flick * (14.0 if i < 3 else -10.0) * (0.6 + 0.4 * k)
        out.append((x + wx + fx, y + wy, z))
    return out


def blend_tail(a, b, w):
    return [tuple(pa * (1.0 - w) + pb * w for pa, pb in zip(ta, tb)) for ta, tb in zip(a, b)]


# -- feet ------------------------------------------------------------------------------------
def stance_swing(p, touch, lift, start, end, height, tuck=0.0):
    """A foot's (z, y) through a cycle: planted from `touch` to `lift` (phase), sliding back from `start`
    to `end` (z); in the air the rest of the time, arcing `height` up and drawn in by `tuck`."""
    stance = window(p, touch, lift)
    if stance is not None:
        return start + (end - start) * stance, 0.0
    swing = window(p, lift, touch)
    z = end + (start - end) * ease(swing)
    lift_y = height * math.sin(math.pi * swing) ** 0.8
    z -= tuck * math.sin(math.pi * swing)
    return z, lift_y


def hind(sfx, z, y=0.0, x=0.0, roll=0.0, toe_down=0.0):
    """A hind foot with its heel at depth `z` (clip frame), raised `y`; `roll` lifts the heel about the
    toes (push-off), `toe_down` points the toes down (in the air)."""
    rest = REST["hind" + sfx]
    sign = 1.0 if sfx == "L" else -1.0
    heel = rest["heel"].copy()
    toe = rest["toe"].copy()
    length = toe[2] - heel[2]
    heel[2] = z
    toe[2] = z + length * math.cos(math.radians(roll + toe_down))
    heel[0] += sign * x
    toe[0] += sign * x
    heel[1] += y + length * math.sin(math.radians(roll)) * 0.8
    toe[1] += y - length * math.sin(math.radians(toe_down)) * 0.9
    # Never through the ground.
    heel[1] = max(heel[1], 0.008)
    toe[1] = max(toe[1], 0.003)
    return dict(heel=heel, toe=toe)


def front(sfx, z, y=0.0, x=0.0, curl=0.0):
    """A forepaw with its wrist at depth `z`, raised `y`; `curl` bends the paw down (in the air)."""
    rest = REST["front" + sfx]
    sign = 1.0 if sfx == "L" else -1.0
    wrist = rest["wrist"].copy()
    toe = rest["toe"].copy()
    length = toe[2] - wrist[2]
    wrist[2] = z
    wrist[1] += y
    wrist[0] += sign * x
    toe[0] += sign * x
    toe[2] = z + length * math.cos(math.radians(curl))
    toe[1] = max(0.003, wrist[1] - 0.008 - length * math.sin(math.radians(curl)) * 0.8)
    return dict(wrist=wrist, toe=toe)


# -- clips ---------------------------------------------------------------------------------
CLIPS = {}


def clip(name, length, loop=True, speed=0.0):
    def register(fn):
        CLIPS[name] = dict(fn=fn, length=length, loop=loop, speed=speed)
        return fn
    return register


@clip("idle", 4.0)
def idle(t):
    """Standing on all fours: breathing, a look about, an ear turned, the tail swaying over the back."""
    look = noise(t * 1.2, 1.0)
    breathe = math.sin(t * TAU * 1.5)
    tail = tail_pose(TAIL_S, wave=4.0, sway=6.0, t=t, speed=0.5)
    return dict(
        root=(0.0, 0.001 * breathe, 0.0),
        chest=(-2.0 + breathe * 0.8, 0.0, 0.0),
        neck=(-8.0, look * 10.0, 0.0),
        head=(4.0 + 6.0 * noise(t, 3.0), look * 18.0, look * 6.0),
        earL=(0.0, 0.0, -8.0 * bump(wrap(t / 4.0), 0.3, 0.04)),
        earR=(0.0, 0.0, 8.0 * bump(wrap(t / 4.0), 0.72, 0.04)),
        tail=tail,
        hindL=hind("L", REST["hindL"]["heel"][2]), hindR=hind("R", REST["hindR"]["heel"][2]),
        frontL=front("L", REST["frontL"]["wrist"][2]), frontR=front("R", REST["frontR"]["wrist"][2]),
    )


# Sitting up, the tail runs back along the ground from the rump and curls up the back.
TAIL_SIT = [(30, 0, 0), (38, 0, 0), (34, 0, 0), (22, 0, 0), (2, 0, 0), (-20, 0, 0), (-30, 0, 0)]
# Forepaws held to the chest: (wrist, toe) as rest-space points carried by the chest.
PAWS_CHEST = (P(0.011, 0.060, 0.062), P(0.009, 0.070, 0.070))


def paws(sfx, wrist, toe, attach="chest", pole=(0.2, -1.0, -0.2)):
    sign = 1.0 if sfx == "L" else -1.0
    flip = np.array([sign, 1.0, 1.0])
    return dict(wrist=np.asarray(wrist) * flip, toe=np.asarray(toe) * flip, attach=attach,
                pole=np.asarray(pole) * flip, side=(1.0, 0.0, 0.0))


def sitting(t, head=(0.0, 0.0, 0.0), tail=None, lean=0.0, held=PAWS_CHEST):
    """Sitting up on its haunches: the body raised (nose up), the hind feet flat beside the rump, the
    forepaws held to the chest."""
    breathe = math.sin(t * TAU * 1.4)
    body_pitch = -60.0 - lean
    spec = dict(
        root=(0.0, 0.044 + 0.0008 * breathe, 0.024),
        body=(body_pitch, 0.0, 0.0),
        hips=(6.0, 0.0, 0.0),
        spine=(-2.0, 0.0, 0.0),
        chest=(-4.0 + breathe * 0.8, 0.0, 0.0),
        neck=(24.0 + head[0] * 0.4, head[1] * 0.45, head[2] * 0.3),
        head=(30.0 + head[0] * 0.6, head[1] * 0.55, head[2] * 0.7),
        tail=tail if tail is not None else tail_pose(TAIL_SIT, wave=2.5, sway=5.0, t=t, speed=0.45),
        hindL=hind("L", -0.040, x=0.008), hindR=hind("R", -0.040, x=0.008),
    )
    if held is not None:
        spec["frontL"] = paws("L", *held)
        spec["frontR"] = paws("R", *held)
    return spec


@clip("sit", 4.0)
def sit(t):
    look = noise(t * 1.1, 2.0)
    spec = sitting(t, head=(6.0 * noise(t * 0.9, 5.0), look * 40.0, look * 8.0))
    spec["earL"] = (0.0, 0.0, -8.0 * bump(wrap(t / 4.0), 0.4, 0.04))
    return spec


def gallop(t, T, V, splay=0.0, low=0.0, flight_lift=0.016, reach=0.078, hind_land=-0.006, flex_amp=16.0,
           stretch=10.0, fore_gap=0.04, head_up=0.0, tail=TAIL_STREAM, tail_wave=10.0, step_height=0.03,
           reverse_hind=False):
    """A bounding gait in place (planted paws slide back at V metres a second): the hind feet push off
    together, a stretched flight, the forepaws land one after the other, the back rounds as the hind
    feet swing up past them and land in front, push. Climbing is the same gait with the limbs splayed
    round the trunk (`splay`) and the body pressed to the bark (`low`)."""
    p = wrap(t / T)
    travel = V * T
    spec = {}
    for sfx, offset in (("L", 0.0), ("R", fore_gap)):
        touch, lift = 0.40 + offset, 0.58 + offset
        start = reach
        end = start - travel * (lift - touch)
        z, y = stance_swing(p, touch, lift, start, end, step_height)
        swing = window(p, lift, touch)
        curl = 0.0 if swing is None else 70.0 * math.sin(math.pi * swing)
        spec["front" + sfx] = front(sfx, z, y=y + 0.004 - low * 0.3, x=0.002 + splay, curl=curl)
    for sfx, offset in (("L", 0.0), ("R", fore_gap * 0.5)):
        touch, lift = 0.70 + offset, 0.90 + offset
        start = hind_land
        end = start - travel * (lift - touch)
        z, y = stance_swing(p, touch, lift, start, end, step_height * 0.75)
        stance = window(p, touch, lift)
        roll = 0.0 if stance is None else 55.0 * smooth(0.45, 1.0, stance)
        swing = window(p, lift, touch)
        toe_down = 0.0 if swing is None else 50.0 * math.sin(math.pi * min(1.0, swing * 1.6))
        foot = hind(sfx, z, y=y, x=0.006 + splay * 1.3, roll=roll, toe_down=toe_down)
        if reverse_hind:
            # Head first down a trunk the hind feet turn round and hook the bark behind.
            length = foot["toe"][2] - foot["heel"][2]
            foot["toe"][2] = foot["heel"][2] - length * 0.9
            foot["heel"][2] += length * 0.45
            foot["toe"][2] += length * 0.45
        spec["hind" + sfx] = foot
    flight = bump(p, 0.15, 0.25)
    gather = bump(p, 0.66, 0.16)
    spec["root"] = (0.0, 0.004 - low + flight_lift * flight - 0.006 * bump(p, 0.5, 0.1) - 0.004 * bump(p, 0.8, 0.1),
                    0.0)
    pitch = -8.0 * bump(p, 0.08, 0.2) + 10.0 * bump(p, 0.5, 0.16) - 4.0 * bump(p, 0.82, 0.12)
    spec["body"] = (pitch, 0.0, 0.0)
    flex = flex_amp * gather - stretch * flight
    spec["hips"] = (flex * 0.5, 0.0, 0.0)
    spec["spine"] = (flex * 0.6, 0.0, 0.0)
    spec["chest"] = (flex * 0.4, 0.0, 0.0)
    spec["neck"] = (-pitch * 0.5 - flex * 0.5 - 6.0 - head_up * 0.5, 0.0, 0.0)
    spec["head"] = (-pitch * 0.4 - flex * 0.4 + 2.0 - head_up * 0.5, 0.0, 0.0)
    spec["earL"] = (-10.0, 0.0, 0.0)
    spec["earR"] = (-10.0, 0.0, 0.0)
    spec["tail"] = tail_pose(tail, wave=tail_wave, t=t, speed=1.0 / T, lag=0.7)
    return spec


BOUND_T, BOUND_V = 0.3, 1.6
HOP_T, HOP_V = 14 / 30, 0.32
CLIMB_T, CLIMB_V = 10 / 30, 0.7
DESCEND_T, DESCEND_V = 0.5, 0.32


@clip("bound", BOUND_T, speed=BOUND_V)
def bound(t):
    return gallop(t, BOUND_T, BOUND_V)


@clip("hop", HOP_T, speed=HOP_V)
def hop(t):
    """Foraging hops: short, the nose low over the litter, the tail held up."""
    spec = gallop(t, HOP_T, HOP_V, flight_lift=0.012, reach=0.062, hind_land=-0.022, flex_amp=12.0, stretch=4.0,
                  fore_gap=0.02, head_up=-14.0, tail=TAIL_S, tail_wave=6.0, step_height=0.022)
    return spec


# Up a trunk the tail hangs down the bark behind and a little off it.
TAIL_CLIMB = [(-6, 0, 0), (-8, 0, 0), (-4, 0, 0), (0, 0, 0), (4, 0, 0), (6, 0, 0), (6, 0, 0)]


@clip("climb", CLIMB_T, speed=CLIMB_V)
def climb(t):
    """Up the bark in bounds, the limbs splayed round the trunk, the body pressed close."""
    return gallop(t, CLIMB_T, CLIMB_V, splay=0.02, low=0.012, flight_lift=0.006, reach=0.07, hind_land=-0.012,
                  flex_amp=14.0, stretch=6.0, fore_gap=0.03, head_up=10.0, tail=TAIL_CLIMB, tail_wave=7.0,
                  step_height=0.012)


@clip("descend", DESCEND_T, speed=DESCEND_V)
def descend(t):
    """Head first down the bark, carefully: the hind feet turned round, hooked in behind."""
    spec = gallop(t, DESCEND_T, DESCEND_V, splay=0.022, low=0.012, flight_lift=0.0, reach=0.06, hind_land=-0.03,
                  flex_amp=6.0, stretch=2.0, fore_gap=0.25, head_up=18.0, tail=TAIL_CLIMB, tail_wave=4.0,
                  step_height=0.01, reverse_hind=True)
    return spec


def clinging(t, look=(0.0, 0.0), splay=0.02, low=0.012):
    """Pressed to the bark, every paw hooked in: the clip frame's ground is the trunk."""
    spec = dict(root=(0.0, 0.004 - low, 0.0), hips=(2.0, 0.0, 0.0), chest=(-2.0, 0.0, 0.0))
    for sfx in ("L", "R"):
        spec["front" + sfx] = front(sfx, 0.052, x=0.002 + splay, y=0.004 - low * 0.3)
        spec["hind" + sfx] = hind(sfx, -0.05, x=0.006 + splay * 1.3)
    spec["neck"] = (-14.0 + look[0] * 0.4, look[1] * 0.45, look[1] * 0.1)
    spec["head"] = (-6.0 + look[0] * 0.6, look[1] * 0.55, look[1] * 0.25)
    return spec


@clip("cling", 3.6)
def cling(t):
    """Still on the trunk, looking about; the tail gives a flick now and then."""
    turn = noise(t * 1.4, 7.0)
    # Two sharp looks per loop: squirrels move their heads in quick snaps, then hold.
    snap = (smooth(0.1, 0.16, wrap(t / 3.6)) - smooth(0.55, 0.61, wrap(t / 3.6)))
    spec = clinging(t, look=(8.0 * noise(t, 2.0) - 10.0 * snap, 35.0 * snap + 8.0 * turn))
    flick = bump(wrap(t / 3.6), 0.78, 0.05)
    spec["tail"] = tail_pose(TAIL_CLIMB, wave=4.0, t=t, speed=0.6, flick=flick)
    spec["earL"] = (0.0, 0.0, -10.0 * bump(wrap(t / 3.6), 0.3, 0.04))
    spec["earR"] = (0.0, 0.0, 10.0 * bump(wrap(t / 3.6), 0.33, 0.04))
    return spec


# Paws at the mouth, the acorn between them: (wrist, toe) carried by the head.
PAWS_MOUTH = (P(0.0095, 0.066, 0.113), P(0.0065, 0.077, 0.123))


@clip("nibble", 1.2)
def nibble(t):
    """Sitting, an acorn turned in the paws at the mouth, the jaw going like a sewing machine."""
    p = wrap(t / 1.2)
    chew = math.sin(t * TAU * 7.5)
    spec = sitting(t, head=(10.0 + 2.0 * chew, 3.0 * math.sin(t * TAU / 1.2), 0.0), lean=-6.0, held=None)
    spec["jaw"] = (4.0 + 5.0 * chew, 0.0, 0.0)
    turn = 18.0 * math.sin(p * TAU)
    for sfx in ("L", "R"):
        held = paws(sfx, *PAWS_MOUTH, attach="head", pole=(0.3, -1.0, -0.3))
        held["side"] = (1.0, 0.25 * math.sin(p * TAU), 0.0)
        spec["front" + sfx] = held
    spec["earL"] = (0.0, 0.0, -5.0 * chew * 0.2)
    spec["earR"] = (0.0, 0.0, 5.0 * chew * 0.2)
    spec["tail"] = tail_pose(TAIL_SIT, wave=2.0, sway=3.0, t=t, speed=0.8)
    spec["head"] = (spec["head"][0], spec["head"][1] + turn * 0.15, spec["head"][2])
    return spec


def tail_whip(base, whip, t=0.0, wave=0.0, speed=1.0):
    """The scolding flick: the root snaps the plume up straight, then the crack runs out to the brush,
    which flips back (`whip` 0..1, its own timing per bone so the crack travels)."""
    out = tail_pose(base, wave=wave, t=t, speed=speed)
    amounts = [22.0, 14.0, 8.0, 2.0, -16.0, -26.0, -32.0]
    return [(x + amounts[i] * whip[i], y, z) for i, (x, y, z) in enumerate(out)]


@clip("chatter", 0.9)
def chatter(t):
    """The scold: on all fours, every call a jerk of the body, a stamp of a forepaw and a whip of the
    whole tail that cracks out to its brush."""
    p = wrap(t / 0.9)
    calls = [0.05, 0.38, 0.62]
    jerk = max(bump(p, c, 0.06) for c in calls)
    whip = [max(bump(p, c + 0.02 + 0.018 * i, 0.09) for c in calls) for i in range(7)]
    spec = dict(
        root=(0.0, -0.006 * jerk, 0.0),
        body=(-6.0 * jerk, 0.0, 0.0),
        hips=(6.0 * jerk, 0.0, 0.0),
        chest=(-8.0 * jerk, 0.0, 0.0),
        neck=(-14.0 - 8.0 * jerk, 0.0, 0.0),
        head=(-6.0 - 10.0 * jerk, 4.0 * math.sin(t * 3.0), 0.0),
        jaw=(12.0 * jerk, 0.0, 0.0),
        earL=(-14.0, 0.0, -8.0), earR=(-14.0, 0.0, 8.0),
        tail=tail_whip(TAIL_S, whip, t=t, wave=3.0, speed=1.0 / 0.9),
        hindL=hind("L", REST["hindL"]["heel"][2]), hindR=hind("R", REST["hindR"]["heel"][2]),
    )
    stamp = max(bump(p, c, 0.05) for c in calls)
    spec["frontL"] = front("L", REST["frontL"]["wrist"][2] + 0.004, y=0.012 * stamp)
    spec["frontR"] = front("R", REST["frontR"]["wrist"][2])
    return spec


@clip("startle", 1.2, loop=False)
def startle(t):
    """A fright, cartoon-sharp: a flinch down, then straight up into the air level as a plank with every
    leg flung out sideways, the ears back and the tail bristling straight up; down on all fours with a
    bump, then frozen, wide-eyed, the tail twitching."""
    crouch = smooth(0.0, 0.07, t) * (1.0 - smooth(0.07, 0.12, t))
    air = smooth(0.09, 0.17, t) * (1.0 - smooth(0.42, 0.52, t))
    # The jump's height: up fast, a hang at the top, down (a parabola over 0.1..0.54 s).
    u = min(1.0, max(0.0, (t - 0.1) / 0.44))
    height = 0.13 * 4.0 * u * (1.0 - u)
    land = bump(t, 0.57, 0.06) if t < 0.7 else 0.0
    frozen = smooth(0.6, 0.72, t)
    spec = dict(
        root=(0.0, height - 0.012 * crouch - 0.012 * land, 0.0),
        body=(2.0 * air, 0.0, 0.0),
        hips=(6.0 * crouch - 4.0 * air, 0.0, 0.0),
        spine=(4.0 * crouch - 6.0 * air, 0.0, 0.0),
        chest=(-4.0 * air - 4.0 * frozen, 0.0, 0.0),
        neck=(-10.0 - 12.0 * air - 14.0 * frozen, 0.0, 0.0),
        head=(-4.0 + 10.0 * crouch - 8.0 * air - 6.0 * frozen, 0.0, 0.0),
        jaw=(10.0 * air, 0.0, 0.0),
        earL=(-35.0 * air, 0.0, -10.0 * air), earR=(-35.0 * air, 0.0, 10.0 * air),
    )
    # The legs go up with the body and fling out sideways, then reach down for the ground.
    for sfx in ("L", "R"):
        spec["front" + sfx] = front(sfx, REST["front" + sfx]["wrist"][2] + 0.012 * air,
                                    y=height + 0.022 * air, x=0.034 * air, curl=-25.0 * air)
        spec["hind" + sfx] = hind(sfx, REST["hind" + sfx]["heel"][2] - 0.01 * air,
                                  y=height + 0.012 * air, x=0.04 * air, toe_down=-20.0 * air)
    # Bristling straight up, then twitching.
    bristle = [(46.0, 0, 0), (24, 0, 0), (2, 0, 0), (-10, 0, 0), (-14, 0, 0), (-10, 0, 0), (-4, 0, 0)]
    tail = [(b[0] + br[0] * air, b[1], b[2]) for b, br in zip(TAIL_S, bristle)]
    twitch = frozen * bump(wrap(t * 2.2), 0.5, 0.12)
    spec["tail"] = tail_pose(tail, wave=3.0, t=t, speed=2.0, flick=twitch)
    return spec


@clip("look", 3.0)
def look(t):
    """Up on its hind legs to see over the litter (the periscope): paws tucked, the head snapping round."""
    p = wrap(t / 3.0)
    snap = smooth(0.08, 0.13, p) - smooth(0.45, 0.5, p) - smooth(0.62, 0.67, p) + smooth(0.88, 0.93, p)
    spec = sitting(t, head=(4.0, 45.0 * snap, 6.0 * snap), lean=22.0,
                   held=(P(0.010, 0.054, 0.060), P(0.008, 0.050, 0.070)))
    spec["root"] = (0.0, 0.07, 0.026)
    spec["hips"] = (-4.0, 0.0, 0.0)
    for sfx in ("L", "R"):
        spec["hind" + sfx] = hind(sfx, -0.052, x=0.006, roll=10.0)
    spec["earL"] = (-6.0, 0.0, 0.0)
    spec["earR"] = (-6.0, 0.0, 0.0)
    spec["tail"] = tail_pose([(x + (34 if i == 0 else 0), y, z) for i, (x, y, z) in enumerate(TAIL_SIT)],
                             wave=2.5, sway=5.0, t=t, speed=0.45)
    return spec


@clip("dig", 11 / 30)
def dig(t):
    """Digging: nose down, the forepaws scrabbling in turn, the tail up and flicking with the effort."""
    p = wrap(t / (11 / 30))
    spec = dict(root=(0.0, -0.004, 0.0), body=(10.0, 0.0, 0.0), hips=(-6.0, 0.0, 0.0), chest=(6.0, 0.0, 0.0),
                neck=(10.0, 0.0, 0.0), head=(16.0, 0.0, 0.0),
                tail=tail_pose(TAIL_S, wave=6.0, t=t, speed=30 / 11),
                hindL=hind("L", REST["hindL"]["heel"][2] + 0.004), hindR=hind("R", REST["hindR"]["heel"][2] + 0.004))
    for sfx, off in (("L", 0.0), ("R", 0.5)):
        q = wrap(p + off)
        # Reach forward and up, then claw down and back through the litter.
        z = 0.062 - 0.03 * q if q < 0.55 else 0.032 + 0.03 * ease((q - 0.55) / 0.45)
        y = 0.0 if q < 0.55 else 0.018 * math.sin(math.pi * (q - 0.55) / 0.45)
        spec["front" + sfx] = front(sfx, z, y=y + 0.002, curl=30.0 * (1.0 if q < 0.55 else 0.0))
    return spec


@clip("pat", 0.7)
def pat(t):
    """Burying: both paws patting the earth down over the nut, quick and fussy."""
    p = wrap(t / 0.7)
    tap = max(bump(p, 0.15, 0.1), bump(p, 0.45, 0.1))
    spec = dict(root=(0.0, -0.002, 0.0), body=(8.0, 0.0, 0.0), neck=(6.0, 0.0, 0.0), head=(14.0, 0.0, 0.0),
                tail=tail_pose(TAIL_S, wave=4.0, t=t, speed=1.0 / 0.7),
                hindL=hind("L", REST["hindL"]["heel"][2]), hindR=hind("R", REST["hindR"]["heel"][2]))
    for sfx in ("L", "R"):
        spec["front" + sfx] = front(sfx, 0.052, y=0.014 * (1.0 - tap), x=-0.004)
    return spec


@clip("scratch", 0.6)
def scratch(t):
    """Sitting, a hind foot going like the clappers behind its right ear, the head leaned into it."""
    rub = math.sin(t * TAU * 9.0)
    spec = sitting(t, head=(6.0, -16.0, 24.0), lean=-2.0)
    spec["body"] = (spec["body"][0], 0.0, 8.0)
    # The scratching foot: its heel up beside the ear (a point carried by the head), the knee out.
    ear = P(-0.040, 0.098, 0.060) + P(0.0, 0.010 * rub, -0.008 * rub)
    toe = ear + P(-0.004, 0.016, 0.010)
    spec["hindR"] = dict(heel=ear, toe=toe, attach="head", pole=(-1.0, 0.1, 0.7), side=(0.0, 0.0, 1.0))
    spec["earR"] = (-24.0, 0.0, 12.0 * rub)
    spec["tail"] = tail_pose(TAIL_SIT, wave=3.0, t=t, speed=1.0 / 0.6)
    return spec


@clip("groom", 0.8)
def groom(t):
    """Washing its face: both paws rubbing down over the eyes and muzzle in quick circles."""
    p = wrap(t / 0.8)
    a = p * TAU
    spec = sitting(t, head=(14.0 + 6.0 * math.sin(a), 0.0, 0.0), lean=-4.0, held=None)
    for sfx, off in (("L", 0.0), ("R", math.pi)):
        wrist = P(0.012, 0.096 + 0.008 * math.sin(a + off), 0.098 + 0.008 * math.cos(a + off))
        toe = wrist + P(-0.004, 0.009, 0.006)
        spec["front" + sfx] = paws(sfx, wrist, toe, attach="head", pole=(0.4, -1.0, -0.4))
    spec["tail"] = tail_pose(TAIL_SIT, wave=2.0, t=t, speed=1.0 / 0.8)
    return spec


@clip("leap", 16 / 30, loop=False)
def leap(t):
    """A jump's shape (the runtime flies it): crouch, push, stretched out in the air, reach to land."""
    crouch = smooth(0.0, 0.12, t) * (1.0 - smooth(0.12, 0.2, t))
    stretch = smooth(0.14, 0.24, t) * (1.0 - smooth(0.36, 0.48, t))
    landing = smooth(0.36, 0.48, t)
    spec = dict(
        root=(0.0, -0.012 * crouch + 0.01 * stretch, 0.0),
        body=(-10.0 * stretch + 8.0 * landing, 0.0, 0.0),
        hips=(-8.0 * stretch + 8.0 * crouch, 0.0, 0.0),
        spine=(-10.0 * stretch + 8.0 * crouch, 0.0, 0.0),
        chest=(-6.0 * stretch, 0.0, 0.0),
        neck=(-6.0 + 4.0 * stretch - 6.0 * landing, 0.0, 0.0),
        head=(2.0 + 6.0 * stretch, 0.0, 0.0),
        earL=(-20.0 * stretch, 0.0, 0.0), earR=(-20.0 * stretch, 0.0, 0.0),
        tail=blend_tail(TAIL_S, TAIL_STREAM, smooth(0.1, 0.3, t)),
    )
    for sfx in ("L", "R"):
        spec["front" + sfx] = front(sfx, REST["front" + sfx]["wrist"][2] + 0.05 * stretch + 0.03 * landing,
                                    y=0.01 * stretch + 0.004 * landing, curl=-20.0 * stretch)
        spec["hind" + sfx] = hind(sfx, REST["hind" + sfx]["heel"][2] - 0.06 * stretch + 0.01 * crouch,
                                  y=0.008 * stretch, roll=60.0 * stretch, toe_down=30.0 * stretch)
    return spec
