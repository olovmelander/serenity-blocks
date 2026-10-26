"""Fall's red squirrel: its clips, authored as functions of time and keyed into Blender actions.

Each clip is a function from seconds to a spec (solver.py): where the body is and how it bends, where
each paw is put, how the head, ears, jaw and tail turn. The runtime plays the clips in place and moves
the squirrel itself (fall-squirrel-mind.js), so a gait's planted paws slide back under the body at the
clip's own speed (`speed`, metres a second at life size): played at that speed over the ground (times
the drawn scale) they stand still on it.

What keeps the motion natural and smooth (audit.py measures each):

- Every planted paw is one the leg can reach. A foreleg is nearly straight just standing, so a
  forepaw only travels a few centimetres under the shoulder; the chest drops and pitches nose-down
  while the forepaws are down, which gives them room. A hind foot plants its toes and rolls its heel
  up as it pushes off, so the leg has the foot's length to spend.
- A paw leaves the ground and comes down at the ground's own speed: its path through the air is a
  Hermite curve whose ends move as the planted paw did, and it lifts as sin² (no corner at take-off
  or touch-down).
- The body's bob, pitch and the bend of its back run through smooth periodic curves (cyclic()) keyed
  to the paws' contacts, the head is held level against them, and the tail's wave is locked to the
  stride, a beat behind.
- Every loop closes: each wander, breath and wave repeats a whole number of times in its loop.
"""

import math

import numpy as np

from .solver import rest_feet

TAU = 2.0 * math.pi
REST = rest_feet()
# The hind foot's sole at rest: from the heel joint down to the toes (the heel sits above the sole).
FOOT = REST["hindL"]["toe"] - REST["hindL"]["heel"]
FOOT_LEN = float(np.linalg.norm(FOOT))
FOOT_PITCH = math.degrees(math.atan2(-FOOT[1], FOOT[2]))
PAW = REST["frontL"]["toe"] - REST["frontL"]["wrist"]


def P(x, y, z):
    return np.array([x, y, z], dtype=np.float64)


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def smoother(e0, e1, x):
    """Quintic smoothstep: no jump in speed or in acceleration at either end."""
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def ease(x):
    return smooth(0.0, 1.0, x)


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


def hermite(p0, p1, m0, m1, u):
    u2 = u * u
    u3 = u2 * u
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1


def cyclic(keys, p):
    """A smooth periodic curve through (phase, value) keys: a Hermite spline whose tangents come
    from each key's neighbours, round the cycle."""
    keys = sorted(keys)
    ext = [(keys[-2][0] - 1.0, keys[-2][1]), (keys[-1][0] - 1.0, keys[-1][1])] + list(keys) \
        + [(keys[0][0] + 1.0, keys[0][1]), (keys[1][0] + 1.0, keys[1][1])]
    p = wrap(p)
    for i in range(1, len(ext) - 2):
        if ext[i][0] <= p < ext[i + 1][0]:
            break
    (pa, va), (p0, v0), (p1, v1), (pb, vb) = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
    h = p1 - p0
    m0 = (v1 - va) / (p1 - pa)
    m1 = (vb - v0) / (pb - p0)
    return hermite(v0, v1, m0 * h, m1 * h, (p - p0) / h)


def hz(length, rate):
    """The rate nearest `rate` that runs a whole number of times in a loop `length` seconds long."""
    return max(1, round(rate * length)) / length


def wander(t, length, seed, rate=0.5):
    """A smooth wander about -1..1 that repeats every `length` seconds (so a loop closes)."""
    b = TAU * hz(length, rate)
    return (0.5 * math.sin(b * t + seed * 1.7) + 0.3 * math.sin(2.0 * b * t + seed * 4.1)
            + 0.2 * math.sin(3.0 * b * t + seed * 2.3))


def hold(p, turns):
    """Quick turns that hold: `turns` = [(phase, value)], each eased in over a short while, the value
    held until the next (cyclic). Squirrels look about in snaps, then keep still."""
    turns = sorted(turns)
    value = turns[-1][1]
    for i, (at, target) in enumerate(turns):
        before = turns[i - 1][1]
        u = window(p, at, at + 0.06)
        if u is not None:
            return before + (target - before) * smoother(0.0, 1.0, u)
        if wrap(p - at) < wrap(turns[(i + 1) % len(turns)][0] - at):
            value = target
    return value


# -- the tail ------------------------------------------------------------------------------
# Held up behind the back in an S: rising from the rump, curling over, the brush turned back.
TAIL_S = [(38, 0, 0), (26, 0, 0), (16, 0, 0), (6, 0, 0), (-12, 0, 0), (-24, 0, 0), (-28, 0, 0)]
# Streamed out behind and a little up, as when it runs.
TAIL_STREAM = [(-18, 0, 0), (-4, 0, 0), (2, 0, 0), (4, 0, 0), (4, 0, 0), (2, 0, 0), (0, 0, 0)]
# Sitting up, the tail runs back along the ground from the rump and curls up the back.
TAIL_SIT = [(30, 0, 0), (38, 0, 0), (34, 0, 0), (22, 0, 0), (2, 0, 0), (-20, 0, 0), (-30, 0, 0)]
# On the bark the tail is laid along it behind (solver.lay_tail): the height off the bark of the end of
# each tail bone (metres, life size), close enough that it trails down the trunk rather than standing
# off it, far enough that the plume and its hair clear it, the brush lifting a little.
TAIL_BARK = [0.054, 0.044, 0.039, 0.038, 0.040, 0.044, 0.050]
# Head first down the trunk the tail is held up the bark behind, a little further off it, rising.
TAIL_BARK_DOWN = [0.058, 0.054, 0.054, 0.057, 0.063, 0.071, 0.080]
# No angles of its own: a wave or a sway rides on the laid tail.
TAIL_FLAT = [(0, 0, 0)] * 7


def tail_pose(base, wave=0.0, sway=0.0, t=0.0, rate=1.0, lag=0.5, flick=0.0, length=None):
    """`base` angles plus a travelling wave (up and down, `wave` degrees, `rate` a second, each bone
    `lag` radians behind the one before), a slower side sway, and a flick that snaps the root first
    and the brush a beat later. With `length` the rates are kept whole in the loop."""
    if length:
        rate = hz(length, rate)
        sway_rate = hz(length, rate * 0.5)
    else:
        sway_rate = rate * 0.5
    out = []
    for i, (x, y, z) in enumerate(base):
        k = (i + 1) / len(base)
        wx = wave * math.sin(t * rate * TAU - i * lag) * (0.4 + 0.6 * k)
        wy = sway * math.sin(t * sway_rate * TAU - i * lag * 0.6 + 0.8) * (0.3 + 0.7 * k)
        fx = flick * (14.0 if i < 3 else -10.0) * (0.6 + 0.4 * k)
        out.append((x + wx + fx, y + wy, z))
    return out


def blend_tail(a, b, w):
    return [tuple(pa * (1.0 - w) + pb * w for pa, pb in zip(ta, tb)) for ta, tb in zip(a, b)]


def tail_whip(base, whip, t=0.0, wave=0.0, rate=1.0, length=None):
    """The scolding flick: the root snaps the plume up straight, then the crack runs out to the brush,
    which flips back (`whip` 0..1, its own timing per bone so the crack travels)."""
    out = tail_pose(base, wave=wave, t=t, rate=rate, length=length)
    amounts = [22.0, 14.0, 8.0, 2.0, -16.0, -26.0, -32.0]
    return [(x + amounts[i] * whip[i], y, z) for i, (x, y, z) in enumerate(out)]


# -- feet ------------------------------------------------------------------------------------
def hind(sfx, z, y=0.0, x=0.0, roll=0.0, toe_down=0.0):
    """A standing hind foot with its heel at depth `z` (clip frame), raised `y`; `roll` lifts the heel
    about the toes, `toe_down` points the toes down."""
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
    heel[1] = max(heel[1], 0.008)
    toe[1] = max(toe[1], 0.003)
    return dict(heel=heel, toe=toe)


def front(sfx, z, y=0.0, x=0.0, curl=0.0):
    """A standing forepaw with its wrist at depth `z`, raised `y`; `curl` bends the paw down."""
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


def toes_down(sfx, toe_z, lift=0.0, pitch=0.0, x=0.0, reverse=False):
    """A hind foot placed by its toes: at depth `toe_z`, `lift` off the ground, the sole pitched `pitch`
    degrees heel-up from flat. `reverse` turns the foot round (head first down a trunk: the toes hook
    the bark behind)."""
    rest = REST["hind" + sfx]
    sign = 1.0 if sfx == "L" else -1.0
    toe = rest["toe"].copy()
    toe[0] += sign * x
    toe[1] += lift
    toe[2] = toe_z
    a = math.radians(FOOT_PITCH + pitch)
    back = -1.0 if not reverse else 1.0
    heel = toe + np.array([0.0, FOOT_LEN * math.sin(a), back * FOOT_LEN * math.cos(a)])
    return dict(heel=heel, toe=toe)


def palm_down(sfx, wrist_z, lift=0.0, curl=0.0, x=0.0):
    """A forepaw placed by its wrist: at depth `wrist_z`, `lift` off the ground, the paw curled `curl`
    degrees under (in the air) or flat."""
    rest = REST["front" + sfx]
    sign = 1.0 if sfx == "L" else -1.0
    wrist = rest["wrist"].copy()
    wrist[0] += sign * x
    wrist[1] += lift
    wrist[2] = wrist_z
    a = math.radians(curl)
    length = float(np.linalg.norm(PAW[[1, 2]]))
    base = math.atan2(-PAW[1], PAW[2])
    toe = wrist + np.array([0.0, -length * math.sin(base + a), length * math.cos(base + a)])
    toe[1] = max(toe[1], 0.002)
    return dict(wrist=wrist, toe=toe)


def track(p, touch, lift, T, V, z_touch, height, match=0.75, rise=0.5, fall=0.5):
    """A paw through one cycle: planted from `touch` to `lift` (phase), sliding back at the ground's
    speed V; in the air the rest of the time on a Hermite path that leaves and meets the ground moving
    as the planted paw did (`match` of it), lifted height x sin². Returns (z, lift, stance u, swing u)."""
    duty = wrap(lift - touch)
    travel = V * T * duty
    st = window(p, touch, lift)
    if st is not None:
        return z_touch - travel * st, 0.0, st, None
    sw = window(p, lift, touch)
    m = -V * T * (1.0 - duty) * match
    z = hermite(z_touch - travel, z_touch, m, m, sw)
    # Up over the first `rise` of the swing, down over the last `fall` (smootherstep both ways): a
    # forepaw held up through the body's flight comes down only as the chest does.
    up = smoother(0.0, rise, sw) * (1.0 - smoother(1.0 - fall, 1.0, sw))
    return z, height * up, None, sw


def gait(t, g):
    """A gait in place, from its table `g` (see GAITS): each paw on its track, the body's bob, pitch
    and back on smooth curves keyed to the contacts, the head held level, the tail's wave locked to
    the stride."""
    T, V = g["T"], g["V"]
    p = wrap(t / T)
    spec = {}
    for sfx, (touch, lift) in zip(("L", "R"), g["fore"]):
        z, y, st, sw = track(p, touch, lift, T, V, g["fore_touch"], g["fore_lift"], match=g.get("match", 0.9),
                             rise=g.get("fore_rise", 0.4), fall=g.get("fore_fall", 0.45))
        curl = 0.0 if sw is None else g.get("curl", 60.0) * math.sin(math.pi * sw) ** 2
        spec["front" + sfx] = palm_down(sfx, z, lift=y, curl=curl, x=g.get("fore_x", 0.002))
    for sfx, (touch, lift) in zip(("L", "R"), g["hind"]):
        z, y, st, sw = track(p, touch, lift, T, V, g["hind_touch"], g["hind_lift"], match=g.get("match", 0.9),
                             rise=g.get("hind_rise", 0.4), fall=g.get("hind_fall", 0.45))
        roll = g.get("roll", 30.0)
        if st is not None:
            pitch = roll * smoother(0.35, 1.0, st)
        else:
            # Off the ground: the heel still up, the toes trailing a moment, the sole flat to land.
            pitch = roll * (1.0 - smoother(0.15, 0.8, sw)) + g.get("trail", 18.0) * math.sin(math.pi * min(1.0, sw / 0.7)) ** 2
        spec["hind" + sfx] = toes_down(sfx, z, lift=y, pitch=pitch, x=g.get("hind_x", 0.006),
                                       reverse=g.get("reverse", False))
    y = cyclic(g["bob"], p)
    pitch = cyclic(g["pitch"], p)
    flex = cyclic(g["flex"], p)
    roll = g.get("sway", 0.0) * math.sin(TAU * p + g.get("sway_phase", 0.0))
    spec["root"] = (0.0, g.get("low", 0.0) + y, 0.0)
    spec["body"] = (pitch, 0.0, roll)
    spec["hips"] = (flex * 0.45, 0.0, -roll * 0.5)
    spec["spine"] = (flex * 0.6, 0.0, 0.0)
    spec["chest"] = (flex * 0.45, 0.0, roll * 0.3)
    # The head rides level against the body's pitch and the bend of its back.
    gaze = g.get("gaze", 0.0)
    spec["neck"] = (-(pitch + flex * 0.75) * 0.55 - 6.0 + gaze * 0.5, 0.0, -roll * 0.5)
    spec["head"] = (-(pitch + flex * 0.75) * 0.4 + 2.0 + gaze * 0.5, 0.0, -roll * 0.3)
    ears = g.get("ears", -10.0)
    spec["earL"] = (ears, 0.0, 0.0)
    spec["earR"] = (ears, 0.0, 0.0)
    spec["tail"] = tail_pose(g["tail"], wave=g.get("tail_wave", 8.0), sway=g.get("tail_sway", 0.0), t=t,
                             rate=1.0 / T, lag=0.75, length=T)
    if g.get("tail_lie"):
        spec["tail_lie"] = g["tail_lie"]
    return spec


# -- the gaits -------------------------------------------------------------------------------
# Phases are fractions of the stride; z in metres along the clip's forward at life size. Each table
# was checked with audit.py: no paw out of reach, none slipping.
GAITS = {
    # The half-bound: the forepaws land one after the other, the back rounds as the hind feet swing
    # up and land, the body stretches out in the air after their push.
    "bound": dict(
        T=17 / 60, V=1.1,
        fore=[(0.36, 0.50), (0.40, 0.54)], fore_touch=0.056, fore_lift=0.030, curl=65.0, fore_rise=0.22, fore_fall=0.3,
        hind=[(0.62, 0.84), (0.64, 0.86)], hind_touch=-0.020, hind_lift=0.022, roll=30.0, trail=20.0,
        bob=[(0.04, 0.007), (0.14, 0.009), (0.26, 0.002), (0.36, -0.004), (0.46, -0.009), (0.56, -0.003),
             (0.63, -0.001), (0.72, -0.005), (0.86, 0.002)],
        pitch=[(0.04, -5.0), (0.20, 0.0), (0.34, 8.0), (0.46, 12.0), (0.58, 5.0), (0.70, -3.0), (0.84, -8.0)],
        flex=[(0.12, -10.0), (0.30, -4.0), (0.45, 2.0), (0.60, 15.0), (0.72, 9.0), (0.86, -7.0)],
        tail=TAIL_STREAM, tail_wave=9.0,
    ),
    # Foraging hops: short, nose low over the litter, the tail up.
    "hop": dict(
        T=14 / 30, V=0.32,
        fore=[(0.38, 0.62), (0.41, 0.65)], fore_touch=0.052, fore_lift=0.018, curl=50.0,
        hind=[(0.66, 0.96), (0.68, 0.98)], hind_touch=-0.004, hind_lift=0.018, roll=24.0, trail=14.0,
        bob=[(0.10, 0.008), (0.28, 0.004), (0.45, -0.005), (0.58, -0.001), (0.75, -0.003), (0.95, 0.003)],
        pitch=[(0.10, -2.0), (0.45, 9.0), (0.60, 5.0), (0.80, 0.0), (0.95, -4.0)],
        flex=[(0.10, -4.0), (0.45, 2.0), (0.62, 10.0), (0.80, 6.0), (0.96, -2.0)],
        gaze=-16.0, tail=TAIL_S, tail_wave=5.0,
    ),
    # Up the bark in bounds, splayed round the trunk, pressed close to it.
    "climb": dict(
        T=10 / 30, V=0.5,
        fore=[(0.34, 0.52), (0.38, 0.56)], fore_touch=0.050, fore_lift=0.012, curl=40.0, fore_x=0.016,
        hind=[(0.62, 0.88), (0.64, 0.90)], hind_touch=-0.012, hind_lift=0.012, roll=20.0, trail=10.0,
        hind_x=0.032, low=-0.014,
        bob=[(0.08, 0.005), (0.30, 0.002), (0.45, -0.004), (0.60, 0.0), (0.75, -0.002), (0.92, 0.002)],
        pitch=[(0.10, -3.0), (0.45, 7.0), (0.60, 3.0), (0.80, -2.0), (0.92, -4.0)],
        flex=[(0.12, -7.0), (0.45, 1.0), (0.62, 12.0), (0.78, 7.0), (0.92, -4.0)],
        gaze=-12.0, ears=-6.0, tail=TAIL_FLAT, tail_lie=TAIL_BARK, tail_wave=2.5, tail_sway=7.0,
    ),
}


# -- clips ---------------------------------------------------------------------------------
CLIPS = {}


def clip(name, length, loop=True, speed=0.0, marks=None):
    def register(fn):
        CLIPS[name] = dict(fn=fn, length=length, loop=loop, speed=speed, marks=marks or {})
        return fn
    return register


def standing(t, length, look=(0.0, 0.0), breathe_rate=1.5):
    """On all fours, every paw planted where it stands at rest."""
    breathe = math.sin(t * TAU * hz(length, breathe_rate))
    return dict(
        root=(0.0, 0.001 * breathe, 0.0),
        chest=(-2.0 + breathe * 0.8, 0.0, 0.0),
        neck=(-8.0 + look[0] * 0.4, look[1] * 0.45, 0.0),
        head=(4.0 + look[0] * 0.6, look[1] * 0.55, look[1] * 0.2),
        hindL=hind("L", REST["hindL"]["heel"][2]), hindR=hind("R", REST["hindR"]["heel"][2]),
        frontL=front("L", REST["frontL"]["wrist"][2]), frontR=front("R", REST["frontR"]["wrist"][2]),
    )


@clip("idle", 4.0)
def idle(t):
    """Standing on all fours: breathing, a look about in snaps, an ear turned, the tail swaying."""
    p = wrap(t / 4.0)
    turn = hold(p, [(0.08, 18.0), (0.38, -6.0), (0.62, -24.0), (0.86, 4.0)])
    spec = standing(t, 4.0, look=(6.0 * wander(t, 4.0, 3.0), turn + 4.0 * wander(t, 4.0, 1.0)))
    spec["earL"] = (0.0, 0.0, -8.0 * bump(p, 0.3, 0.04))
    spec["earR"] = (0.0, 0.0, 8.0 * bump(p, 0.72, 0.04))
    spec["tail"] = tail_pose(TAIL_S, wave=4.0, sway=6.0, t=t, rate=0.5, length=4.0)
    return spec


# Forepaws held to the chest: (wrist, toe) as rest-space points carried by the chest.
PAWS_CHEST = (P(0.011, 0.060, 0.062), P(0.009, 0.070, 0.070))


def paws(sfx, wrist, toe, attach="chest", pole=(0.2, -1.0, -0.2)):
    sign = 1.0 if sfx == "L" else -1.0
    flip = np.array([sign, 1.0, 1.0])
    return dict(wrist=np.asarray(wrist) * flip, toe=np.asarray(toe) * flip, attach=attach,
                pole=np.asarray(pole) * flip, side=(1.0, 0.0, 0.0))


def sitting(t, length, head=(0.0, 0.0, 0.0), tail=None, lean=0.0, held=PAWS_CHEST):
    """Sitting up on its haunches: the body raised (nose up), the hind feet flat beside the rump, the
    forepaws held to the chest."""
    breathe = math.sin(t * TAU * hz(length, 1.4))
    spec = dict(
        root=(0.0, 0.044 + 0.0008 * breathe, 0.024),
        body=(-60.0 - lean, 0.0, 0.0),
        hips=(6.0, 0.0, 0.0),
        spine=(-2.0, 0.0, 0.0),
        chest=(-4.0 + breathe * 0.8, 0.0, 0.0),
        neck=(24.0 + head[0] * 0.4, head[1] * 0.45, head[2] * 0.3),
        head=(30.0 + head[0] * 0.6, head[1] * 0.55, head[2] * 0.7),
        tail=tail if tail is not None else tail_pose(TAIL_SIT, wave=2.5, sway=5.0, t=t, rate=0.45, length=length),
        hindL=hind("L", -0.040, x=0.008), hindR=hind("R", -0.040, x=0.008),
    )
    if held is not None:
        spec["frontL"] = paws("L", *held)
        spec["frontR"] = paws("R", *held)
    return spec


@clip("sit", 4.0)
def sit(t):
    p = wrap(t / 4.0)
    turn = hold(p, [(0.1, 32.0), (0.42, -10.0), (0.66, -36.0), (0.9, 6.0)])
    spec = sitting(t, 4.0, head=(6.0 * wander(t, 4.0, 5.0), turn, turn * 0.2))
    spec["earL"] = (0.0, 0.0, -8.0 * bump(p, 0.4, 0.04))
    return spec


@clip("bound", GAITS["bound"]["T"], speed=GAITS["bound"]["V"])
def bound(t):
    return gait(t, GAITS["bound"])


@clip("hop", GAITS["hop"]["T"], speed=GAITS["hop"]["V"])
def hop(t):
    """Foraging hops: short, the nose low over the litter, the tail held up."""
    return gait(t, GAITS["hop"])


@clip("climb", GAITS["climb"]["T"], speed=GAITS["climb"]["V"])
def climb(t):
    """Up the bark in bounds, the limbs splayed round the trunk, the body pressed close."""
    return gait(t, GAITS["climb"])


DESCEND_T, DESCEND_V = 0.5, 0.2


@clip("descend", DESCEND_T, speed=DESCEND_V)
def descend(t):
    """Head first down the bark, carefully, one paw at a time (a walk, not a bound), the body rocking a
    little from side to side. (A real squirrel turns its hind feet round to hook the bark behind; at the
    size the game shows it the turn is not seen, while the foot spinning round in every blend into and
    out of the walk was: so the feet stay forward.)"""
    T, V = DESCEND_T, DESCEND_V
    p = wrap(t / T)
    spec = {}
    # A walk's sequence: left hind, left fore, right hind, right fore; each paw down 60 % of the time.
    for sfx, touch in (("L", 0.25), ("R", 0.75)):
        z, y, _st, sw = track(p, touch, touch + 0.5, T, V, 0.060, 0.010)
        spec["front" + sfx] = palm_down(sfx, z, lift=y, curl=0.0 if sw is None else 30.0 * math.sin(math.pi * sw) ** 2,
                                        x=0.022)
    for sfx, touch in (("L", 0.0), ("R", 0.5)):
        z, y, st, sw = track(p, touch, touch + 0.58, T, V, 0.004, 0.010)
        spec["hind" + sfx] = toes_down(sfx, z, lift=y, pitch=10.0, x=0.032)
    sway = math.sin(TAU * p)
    spec["root"] = (0.0, -0.010 + 0.0015 * math.sin(2 * TAU * p), 0.0)
    spec["body"] = (0.0, 0.0, 3.0 * sway)
    spec["hips"] = (2.0, 4.0 * sway, -1.5 * sway)
    spec["chest"] = (-2.0, -4.0 * sway, 1.0 * sway)
    spec["neck"] = (-14.0, 3.0 * sway, 0.0)
    spec["head"] = (-8.0, 2.0 * sway, 0.0)
    spec["earL"] = (-6.0, 0.0, 0.0)
    spec["earR"] = (-6.0, 0.0, 0.0)
    spec["tail"] = tail_pose(TAIL_FLAT, wave=2.0, sway=6.0, t=t, rate=1.0 / T, length=T)
    spec["tail_lie"] = TAIL_BARK_DOWN
    return spec


@clip("shuffle", 0.5)
def shuffle(t):
    """Turning on the spot: the paws step in diagonal pairs and come down where they lifted (the runtime
    turns the body as they go, so each pair steps round)."""
    p = wrap(t / 0.5)
    spec = standing(t, 0.5, look=(0.0, 0.0), breathe_rate=2.0)
    for (fore, hind_sfx), (lo, hi) in ((("L", "R"), (0.0, 0.4)), (("R", "L"), (0.5, 0.9))):
        u = window(p, lo, hi)
        lift = 0.0 if u is None else 0.012 * math.sin(math.pi * u) ** 2
        spec["front" + fore] = front(fore, REST["front" + fore]["wrist"][2], y=lift)
        spec["hind" + hind_sfx] = hind(hind_sfx, REST["hind" + hind_sfx]["heel"][2], y=lift)
    spec["root"] = (0.0, 0.0015 * math.sin(2 * TAU * p), 0.0)
    spec["tail"] = tail_pose(TAIL_S, wave=4.0, t=t, rate=2.0, length=0.5)
    return spec


CLING_FRONT_Z, CLING_HIND_Z = 0.052, -0.05


def clinging(t, length, look=(0.0, 0.0), splay=0.02, low=0.012):
    """Pressed to the bark, every paw hooked in: the clip frame's ground is the trunk."""
    breathe = math.sin(t * TAU * hz(length, 1.4))
    spec = dict(root=(0.0, 0.004 - low + 0.0008 * breathe, 0.0), hips=(2.0, 0.0, 0.0),
                chest=(-2.0 + 0.8 * breathe, 0.0, 0.0))
    for sfx in ("L", "R"):
        spec["front" + sfx] = front(sfx, CLING_FRONT_Z, x=0.002 + splay, y=0.004 - low * 0.3)
        spec["hind" + sfx] = hind(sfx, CLING_HIND_Z, x=0.006 + splay * 1.3)
    spec["neck"] = (-14.0 + look[0] * 0.4, look[1] * 0.45, look[1] * 0.1)
    spec["head"] = (-6.0 + look[0] * 0.6, look[1] * 0.55, look[1] * 0.25)
    return spec


@clip("cling", 3.6)
def cling(t):
    """Still on the trunk, looking about in snaps; the tail gives a flick now and then."""
    p = wrap(t / 3.6)
    turn = hold(p, [(0.1, 34.0), (0.36, 10.0), (0.58, -22.0), (0.84, 0.0)])
    nod = hold(p, [(0.1, -10.0), (0.58, 4.0), (0.84, -2.0)])
    spec = clinging(t, 3.6, look=(nod + 4.0 * wander(t, 3.6, 2.0), turn + 5.0 * wander(t, 3.6, 7.0)))
    flick = bump(p, 0.74, 0.07)
    spec["tail"] = tail_pose(TAIL_FLAT, wave=2.5, sway=3.0, t=t, rate=0.6, flick=flick, length=3.6)
    spec["tail_lie"] = TAIL_BARK
    spec["earL"] = (0.0, 0.0, -10.0 * bump(p, 0.3, 0.05))
    spec["earR"] = (0.0, 0.0, 10.0 * bump(p, 0.33, 0.05))
    return spec


@clip("pivot", 0.6)
def pivot(t):
    """Turning round on the bark: pressed to it, the paws let go and grip again in diagonal pairs (the
    runtime turns the body as they go, so each pair steps round the turn)."""
    p = wrap(t / 0.6)
    spec = clinging(t, 0.6, look=(-6.0, 0.0))
    for (fore, hind_sfx), (lo, hi) in ((("L", "R"), (0.0, 0.42)), (("R", "L"), (0.5, 0.92))):
        u = window(p, lo, hi)
        lift = 0.0 if u is None else 0.010 * math.sin(math.pi * u) ** 2
        spec["front" + fore] = front(fore, CLING_FRONT_Z, x=0.022, y=0.0004 + lift)
        spec["hind" + hind_sfx] = hind(hind_sfx, CLING_HIND_Z, x=0.032, y=lift)
    spec["tail"] = tail_pose(TAIL_FLAT, wave=2.5, sway=4.0, t=t, rate=1.0 / 0.6, length=0.6)
    spec["tail_lie"] = TAIL_BARK
    return spec


# Paws at the mouth, the acorn between them: (wrist, toe) carried by the head.
PAWS_MOUTH = (P(0.0095, 0.066, 0.113), P(0.0065, 0.077, 0.123))


@clip("nibble", 1.2)
def nibble(t):
    """Sitting, an acorn turned in the paws at the mouth, the jaw going like a sewing machine."""
    p = wrap(t / 1.2)
    chew = math.sin(t * TAU * hz(1.2, 7.5))
    spec = sitting(t, 1.2, head=(10.0 + 2.0 * chew, 3.0 * math.sin(TAU * p), 0.0), lean=-6.0, held=None)
    spec["jaw"] = (4.0 + 5.0 * chew, 0.0, 0.0)
    turn = 18.0 * math.sin(p * TAU)
    for sfx in ("L", "R"):
        held = paws(sfx, *PAWS_MOUTH, attach="head", pole=(0.3, -1.0, -0.3))
        held["side"] = (1.0, 0.25 * math.sin(p * TAU), 0.0)
        spec["front" + sfx] = held
    spec["earL"] = (0.0, 0.0, -1.0 * chew)
    spec["earR"] = (0.0, 0.0, 1.0 * chew)
    spec["tail"] = tail_pose(TAIL_SIT, wave=2.0, sway=3.0, t=t, rate=0.8, length=1.2)
    spec["head"] = (spec["head"][0], spec["head"][1] + turn * 0.15, spec["head"][2])
    return spec


@clip("chatter", 0.9)
def chatter(t):
    """The scold: on all fours, every call a jerk of the body, a stamp of a forepaw and a whip of the
    whole tail that cracks out to its brush."""
    p = wrap(t / 0.9)
    calls = [0.05, 0.38, 0.62]
    jerk = max(bump(p, c, 0.085) for c in calls)
    whip = [max(bump(p, c + 0.025 + 0.02 * i, 0.11) for c in calls) for i in range(7)]
    spec = dict(
        root=(0.0, -0.005 * jerk, 0.0),
        body=(-5.0 * jerk, 0.0, 0.0),
        hips=(5.0 * jerk, 0.0, 0.0),
        chest=(-7.0 * jerk, 0.0, 0.0),
        neck=(-14.0 - 7.0 * jerk, 0.0, 0.0),
        head=(-6.0 - 8.0 * jerk, 4.0 * math.sin(TAU * p), 0.0),
        jaw=(12.0 * jerk, 0.0, 0.0),
        earL=(-14.0, 0.0, -8.0), earR=(-14.0, 0.0, 8.0),
        tail=tail_whip(TAIL_S, whip, t=t, wave=3.0, rate=1.0 / 0.9, length=0.9),
        hindL=hind("L", REST["hindL"]["heel"][2]), hindR=hind("R", REST["hindR"]["heel"][2]),
    )
    stamp = max(bump(p, c, 0.08) for c in calls)
    spec["frontL"] = front("L", REST["frontL"]["wrist"][2] + 0.004, y=0.010 * stamp)
    spec["frontR"] = front("R", REST["frontR"]["wrist"][2])
    return spec


@clip("startle", 1.2, loop=False)
def startle(t):
    """A fright, cartoon-sharp: a flinch down, then straight up into the air level as a plank with every
    leg flung out sideways, the ears back and the tail bristling straight up; down on all fours with a
    give in the legs, then frozen, wide-eyed, the tail twitching."""
    crouch = smoother(0.0, 0.07, t) * (1.0 - smoother(0.07, 0.13, t))
    air = smoother(0.09, 0.19, t) * (1.0 - smoother(0.40, 0.52, t))
    u = min(1.0, max(0.0, (t - 0.1) / 0.44))
    height = 0.13 * 4.0 * u * (1.0 - u)
    land = bump(t / 1.2, 0.575 / 1.2, 0.09 / 1.2) if t < 0.75 else 0.0
    frozen = smoother(0.58, 0.75, t)
    spec = dict(
        root=(0.0, height - 0.012 * crouch - 0.010 * land, 0.0),
        body=(2.0 * air, 0.0, 0.0),
        hips=(6.0 * crouch - 4.0 * air + 4.0 * land, 0.0, 0.0),
        spine=(4.0 * crouch - 6.0 * air + 3.0 * land, 0.0, 0.0),
        chest=(-4.0 * air - 4.0 * frozen, 0.0, 0.0),
        neck=(-10.0 - 12.0 * air - 14.0 * frozen, 0.0, 0.0),
        head=(-4.0 + 10.0 * crouch - 8.0 * air - 6.0 * frozen, 0.0, 0.0),
        jaw=(10.0 * air, 0.0, 0.0),
        earL=(-35.0 * air, 0.0, -10.0 * air), earR=(-35.0 * air, 0.0, 10.0 * air),
    )
    for sfx in ("L", "R"):
        spec["front" + sfx] = front(sfx, REST["front" + sfx]["wrist"][2] + 0.012 * air,
                                    y=height + 0.022 * air, x=0.034 * air, curl=-25.0 * air)
        spec["hind" + sfx] = hind(sfx, REST["hind" + sfx]["heel"][2] - 0.01 * air,
                                  y=height + 0.012 * air, x=0.04 * air, toe_down=-20.0 * air)
    bristle = [(46.0, 0, 0), (24, 0, 0), (2, 0, 0), (-10, 0, 0), (-14, 0, 0), (-10, 0, 0), (-4, 0, 0)]
    tail = [(b[0] + br[0] * air, b[1], b[2]) for b, br in zip(TAIL_S, bristle)]
    twitch = frozen * bump(wrap(t * 2.2), 0.5, 0.15)
    spec["tail"] = tail_pose(tail, wave=3.0, t=t, rate=2.0, flick=twitch)
    return spec


@clip("look", 3.0)
def look(t):
    """Up on its hind legs to see over the litter (the periscope): paws tucked, the head snapping round."""
    p = wrap(t / 3.0)
    turn = hold(p, [(0.08, 42.0), (0.45, 0.0), (0.62, -42.0), (0.88, 0.0)])
    spec = sitting(t, 3.0, head=(4.0, turn, turn * 0.14), lean=22.0,
                   held=(P(0.010, 0.054, 0.060), P(0.008, 0.050, 0.070)))
    spec["root"] = (0.0, 0.07, 0.026)
    spec["hips"] = (-4.0, 0.0, 0.0)
    for sfx in ("L", "R"):
        spec["hind" + sfx] = hind(sfx, -0.052, x=0.006, roll=10.0)
    spec["earL"] = (-6.0, 0.0, 0.0)
    spec["earR"] = (-6.0, 0.0, 0.0)
    spec["tail"] = tail_pose([(x + (34 if i == 0 else 0), y, z) for i, (x, y, z) in enumerate(TAIL_SIT)],
                             wave=2.5, sway=5.0, t=t, rate=0.45, length=3.0)
    return spec


DIG_T = 11 / 30


@clip("dig", DIG_T)
def dig(t):
    """Digging: nose down, the forepaws scrabbling in turn round little ovals, the tail up and flicking."""
    p = wrap(t / DIG_T)
    spec = dict(root=(0.0, -0.004, 0.0), body=(10.0, 0.0, 0.0), hips=(-6.0, 0.0, 0.0),
                chest=(6.0 + 1.5 * math.sin(2 * TAU * p), 0.0, 0.0),
                neck=(10.0, 0.0, 0.0), head=(16.0 + 2.0 * math.sin(2 * TAU * p + 1.0), 0.0, 0.0),
                tail=tail_pose(TAIL_S, wave=6.0, t=t, rate=1.0 / DIG_T, length=DIG_T),
                hindL=hind("L", REST["hindL"]["heel"][2] + 0.004), hindR=hind("R", REST["hindR"]["heel"][2] + 0.004))
    for sfx, off in (("L", 0.0), ("R", 0.5)):
        a = TAU * (p + off)
        # Round an oval: forward and up, then down and back through the litter.
        z = 0.047 + 0.015 * math.cos(a)
        y = 0.002 + 0.016 * ((1.0 + math.sin(a)) * 0.5) ** 2
        spec["front" + sfx] = front(sfx, z, y=y, curl=25.0 * ((1.0 + math.sin(a)) * 0.5))
    return spec


@clip("pat", 0.7)
def pat(t):
    """Burying: both paws patting the earth down over the nut, quick and fussy."""
    p = wrap(t / 0.7)
    tap = max(bump(p, 0.15, 0.12), bump(p, 0.45, 0.12))
    spec = dict(root=(0.0, -0.002, 0.0), body=(8.0 - 2.0 * tap, 0.0, 0.0), neck=(6.0, 0.0, 0.0),
                head=(14.0 + 3.0 * tap, 0.0, 0.0),
                tail=tail_pose(TAIL_S, wave=4.0, t=t, rate=1.0 / 0.7, length=0.7),
                hindL=hind("L", REST["hindL"]["heel"][2]), hindR=hind("R", REST["hindR"]["heel"][2]))
    for sfx in ("L", "R"):
        spec["front" + sfx] = front(sfx, 0.052, y=0.014 * (1.0 - tap), x=-0.004)
    return spec


@clip("scratch", 0.6)
def scratch(t):
    """Sitting, a hind foot going like the clappers behind its right ear, the head leaned into it."""
    rub = math.sin(t * TAU * hz(0.6, 9.0))
    spec = sitting(t, 0.6, head=(6.0, -16.0, 24.0), lean=-2.0)
    spec["body"] = (spec["body"][0], 0.0, 8.0)
    ear = P(-0.040, 0.098, 0.060) + P(0.0, 0.010 * rub, -0.008 * rub)
    toe = ear + P(-0.004, 0.016, 0.010)
    spec["hindR"] = dict(heel=ear, toe=toe, attach="head", pole=(-1.0, 0.1, 0.7), side=(0.0, 0.0, 1.0))
    spec["earR"] = (-24.0, 0.0, 12.0 * rub)
    spec["tail"] = tail_pose(TAIL_SIT, wave=3.0, t=t, rate=1.0 / 0.6, length=0.6)
    return spec


@clip("groom", 0.8)
def groom(t):
    """Washing its face: both paws rubbing down over the eyes and muzzle in quick circles."""
    p = wrap(t / 0.8)
    a = p * TAU
    spec = sitting(t, 0.8, head=(14.0 + 6.0 * math.sin(a), 0.0, 0.0), lean=-4.0, held=None)
    for sfx, off in (("L", 0.0), ("R", math.pi)):
        wrist = P(0.012, 0.094 + 0.007 * math.sin(a + off), 0.094 + 0.007 * math.cos(a + off))
        toe = wrist + P(-0.004, 0.009, 0.006)
        spec["front" + sfx] = paws(sfx, wrist, toe, attach="head", pole=(0.4, -1.0, -0.4))
    spec["tail"] = tail_pose(TAIL_SIT, wave=2.0, t=t, rate=1.0 / 0.8, length=0.8)
    return spec


LEAP_T = 16 / 30
# The leap's shape in three: the crouch on the ground, the flight (the runtime flies it between these
# fractions of the clip), the landing taken in the legs.
LEAP_TAKEOFF = 0.14 / LEAP_T
LEAP_LANDING = 0.40 / LEAP_T


@clip("leap", LEAP_T, loop=False, marks=dict(takeoff=LEAP_TAKEOFF, landing=LEAP_LANDING))
def leap(t):
    """A jump's shape: crouch and push, stretched out in the air, forepaws reaching, then the landing
    taken in the legs (the runtime flies it from LEAP_TAKEOFF to LEAP_LANDING of the clip)."""
    t0, t1 = LEAP_TAKEOFF * LEAP_T, LEAP_LANDING * LEAP_T
    crouch = smoother(0.0, t0 * 0.7, t) * (1.0 - smoother(t0 * 0.7, t0 + 0.03, t))
    stretch = smoother(t0, t0 + 0.09, t) * (1.0 - smoother(t1 - 0.12, t1 - 0.02, t))
    # The forepaws reach out in the air and are back under the shoulders as they touch down.
    reach = smoother(t1 - 0.16, t1 - 0.08, t) * (1.0 - smoother(t1 - 0.06, t1, t))
    give = bump(t / LEAP_T, (t1 + 0.04) / LEAP_T, 0.07 / LEAP_T) if t > t1 - 0.03 else 0.0
    spec = dict(
        root=(0.0, -0.012 * crouch + 0.008 * stretch - 0.009 * give, 0.0),
        body=(-10.0 * stretch + 6.0 * reach + 3.0 * give, 0.0, 0.0),
        hips=(-8.0 * stretch + 8.0 * crouch + 4.0 * give, 0.0, 0.0),
        spine=(-10.0 * stretch + 8.0 * crouch + 3.0 * give, 0.0, 0.0),
        chest=(-6.0 * stretch, 0.0, 0.0),
        neck=(-6.0 + 4.0 * stretch - 5.0 * reach, 0.0, 0.0),
        head=(2.0 + 6.0 * stretch - 2.0 * reach, 0.0, 0.0),
        earL=(-20.0 * stretch, 0.0, 0.0), earR=(-20.0 * stretch, 0.0, 0.0),
        tail=blend_tail(TAIL_S, TAIL_STREAM, smoother(t0 - 0.04, t0 + 0.12, t) * (1.0 - smoother(t1, LEAP_T, t))),
    )
    air = max(stretch, reach)
    for sfx in ("L", "R"):
        spec["front" + sfx] = front(sfx, REST["front" + sfx]["wrist"][2] + 0.035 * stretch + 0.025 * reach,
                                    y=0.010 * air, curl=-20.0 * stretch)
        if t < t0:
            # Crouched on the ground: the toes stay where they stand while the heels come up.
            spec["hind" + sfx] = toes_down(sfx, REST["hind" + sfx]["toe"][2], pitch=14.0 * crouch, x=0.0)
        else:
            spec["hind" + sfx] = hind(sfx, REST["hind" + sfx]["heel"][2] - 0.045 * stretch,
                                      y=0.008 * stretch, roll=55.0 * stretch + 10.0 * crouch, toe_down=25.0 * stretch)
    return spec
