/**
 * Luminous Tides — the glowing shore: numbers, the shore's shape, the surf, the swash, the six
 * nights and the noise everything is drawn with (CPU only, three-free).
 *
 * Everything that has to agree between the renderer, the event aiming and the tests lives here.
 *
 * World: metres, y up, the mean sea level at y = 0. The eye stands on wet sand at the edge of
 * the swash and looks toward −z, out over the sea; +x is to its right. The shore runs past its
 * left foot out toward the right of the picture: the open sea and its lines of surf fill the left
 * and the middle, the beach curves away on the right to a dark headland of palms.
 *
 * Two coordinates describe a place on the shore:
 *   a   along the shore, metres, growing toward the right of the picture (0 abreast of the eye)
 *   s   across it, metres, growing out to sea (0 on the mean waterline, the eye at SHORE.eyeS)
 *
 * What glows: the sea is full of dinoflagellates that flash blue when the water is shaken. So the
 * light lives where the water is torn: the lip of a wave as it breaks, the foaming bore it turns
 * into, the leading edge of the swash running up the sand, the lace the backwash leaves, and every
 * drop that falls into it. Calm water is dark and mirrors the sky.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const fract = (v) => v - Math.floor(v);

/** Hermite step between two DISTINCT edges (either order). */
export function smooth(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
}

/** Frame-rate independent easing factor: `value += (target - value) * approach(rate, dt)`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt));

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The same cheap hash the shaders use for a crest's number (0..1). */
export function hash1(n) {
    return fract(Math.sin(n * 12.9898 + 4.1414) * 43758.5453);
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A piece's colour (a CSS hex string) as scene-linear light, its brightest channel at 1. Anything
 * else (and a colour with no light in it) gives the sea's own blue.
 */
export function pieceLight(color, out = [0.2, 0.62, 1]) {
    const hex = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
    const r = hex ? srgbToLinear(Number.parseInt(hex.slice(1, 3), 16) / 255) : 0;
    const g = hex ? srgbToLinear(Number.parseInt(hex.slice(3, 5), 16) / 255) : 0;
    const b = hex ? srgbToLinear(Number.parseInt(hex.slice(5, 7), 16) / 255) : 0;
    const peak = Math.max(r, g, b);
    if (peak < 0.01) {
        out[0] = 0.2;
        out[1] = 0.62;
        out[2] = 1;
        return out;
    }
    out[0] = r / peak;
    out[1] = g / peak;
    out[2] = b / peak;
    return out;
}

// ── The shore ───────────────────────────────────────────────────────────────────────────────

/**
 * The shore's plan.
 *   bearing      degrees right of the view line the shore runs toward (it leaves the picture's
 *                right edge, out past the beach)
 *   eyeS         where the eye stands across the shore (metres; negative: up the beach)
 *   bendFrom     beyond this far along the shore it starts to curve out to sea…
 *   bendRadius   …on a circle this large: the bay's far arm, the headland of palms
 *   foreshore    the beach's slope where the swash runs (rise per metre)
 *   berm         where the foreshore ends and the flat back-beach begins (s, metres)
 *   backshore    the back-beach's slope
 *   dunes        where the ground starts to climb to the trees (s)
 *   bed          the seabed's slope through the surf zone (fall per metre seaward)
 *   bedDeep      …and beyond OUTER
 *   outer        where the surf zone's bed gives way to the deeper slope (s)
 */
export const SHORE = Object.freeze({
    bearing: 22,
    eyeS: -1.2,
    bendFrom: 140,
    bendRadius: 1400,
    foreshore: 0.08,
    berm: -11,
    backshore: 0.03,
    dunes: -18,
    bed: 0.07,
    bedDeep: 0.02,
    outer: 30,
});

/** How high the eye stands over the sand under it (metres). */
export const EYE_OVER_SAND = 1.55;

/**
 * The shore's frame: the unit vector along it (toward the right of the picture), the unit vector
 * out to sea, and the point on the mean waterline abreast of the eye. World xz.
 */
export const SHORE_FRAME = (() => {
    const b = SHORE.bearing * DEG;
    const along = { x: Math.sin(b), z: -Math.cos(b) };
    // Out to sea: the left hand of a walker heading along the shore.
    const out = { x: -Math.cos(b), z: -Math.sin(b) };
    const origin = { x: -out.x * SHORE.eyeS, z: -out.z * SHORE.eyeS };
    return Object.freeze({ along: Object.freeze(along), out: Object.freeze(out), origin: Object.freeze(origin) });
})();

/** How far the bay's far arm has curved out to sea at `a` along the shore (metres). */
export function bendAt(a) {
    const past = Math.max(0, a - SHORE.bendFrom);
    return (past * past) / (2 * SHORE.bendRadius);
}

/** World (x, z) → shore (a, s). */
export function toShore(x, z, out = { a: 0, s: 0 }) {
    const { along, out: seaward, origin } = SHORE_FRAME;
    const dx = x - origin.x;
    const dz = z - origin.z;
    const a = dx * along.x + dz * along.z;
    out.a = a;
    out.s = dx * seaward.x + dz * seaward.z - bendAt(a);
    return out;
}

/** Shore (a, s) → world (x, z). */
export function fromShore(a, s, out = { x: 0, z: 0 }) {
    const { along, out: seaward, origin } = SHORE_FRAME;
    const across = s + bendAt(a);
    out.x = origin.x + along.x * a + seaward.x * across;
    out.z = origin.z + along.z * a + seaward.z * across;
    return out;
}

/**
 * The ground's height across the shore (metres over the mean sea): the seabed out to sea, the
 * steep wet foreshore the swash runs up, the flat back-beach, the climb to the dunes.
 */
export function sandHeight(s) {
    if (s >= 0) {
        if (s <= SHORE.outer) return -SHORE.bed * s;
        return -SHORE.bed * SHORE.outer - SHORE.bedDeep * (s - SHORE.outer);
    }
    const up = -s;
    const bermUp = -SHORE.berm;
    if (up <= bermUp) return SHORE.foreshore * up;
    const atBerm = SHORE.foreshore * bermUp;
    const duneUp = -SHORE.dunes;
    if (up <= duneUp) return atBerm + SHORE.backshore * (up - bermUp);
    const atDune = atBerm + SHORE.backshore * (duneUp - bermUp);
    return Math.min(atDune + 0.09 * (up - duneUp), 6);
}

/** Where the eye is (world). */
export const EYE = Object.freeze({ x: 0, y: sandHeight(SHORE.eyeS) + EYE_OVER_SAND, z: 0 });

// ── The surf ────────────────────────────────────────────────────────────────────────────────

/**
 * The surf: one train of waves coming in at an angle to the shore.
 *   period       mean seconds between crests
 *   wobble       how much the gaps between crests vary (a share of the period; the phase warp)
 *   speed        how fast a crest comes in across the surf zone (metres a second)
 *   oblique      degrees the crests lean to the shore: a crest breaks first at its left end and
 *                the break runs along it toward the right of the picture (the peel)
 *   reference    s at which a crest's number is counted (out beyond the surf)
 *   height       the mean wave's height (metres, crest to trough)…
 *   spread       …how much one wave differs from the next (a share of it)…
 *   setPeriod    …and the slow rhythm of sets: every so often a few bigger ones come in
 *   setDepth     how much bigger a set's waves are (a share)
 *   breakRatio   a wave breaks where the water is this share of its height deep (H / h)
 *   sandbar      how much the break line wanders along the shore (metres)
 */
export const SURF = Object.freeze({
    period: 6.0,
    wobble: 0.13,
    speed: 3.2,
    oblique: 9,
    reference: 70,
    height: 0.62,
    spread: 0.42,
    setPeriod: 71,
    setDepth: 0.38,
    breakRatio: 0.78,
    sandbar: 3.2,
});

/** The surf's warped phase at time `t` (crests are where it is a whole number). */
export function surfPhase(t) {
    const w = SURF.wobble * SURF.period;
    return (t + w * 0.55 * Math.sin((t * TAU) / 23.3) + w * 0.35 * Math.sin((t * TAU) / 41.9 + 1.7)) / SURF.period;
}

/** How much later a crest arrives at `a` along the shore (seconds): crests bend along their length. */
export function crestBend(a) {
    return 0.7 * Math.sin(a * 0.083 + 1.1) + 0.25 * Math.sin(a * 0.21 + 2.3);
}

/**
 * The time a place at (a, s) "sees" the surf: the world's time less how long a crest takes to come
 * in from the reference line to it (its lean to the shore and its bend included).
 */
export function surfTime(a, s, t) {
    const lean = Math.sin(SURF.oblique * DEG);
    return t - (SURF.reference - s) / SURF.speed - (a * lean) / SURF.speed - crestBend(a);
}

/** The height of crest number `k` (metres): a hash of its number, swelled by the set it is in. */
export function crestHeight(k) {
    const born = k * SURF.period;
    const set = 0.5 + 0.5 * Math.sin((born * TAU) / SURF.setPeriod);
    const one = 1 - SURF.spread + SURF.spread * 2 * hash1(k);
    return SURF.height * one * (1 - SURF.setDepth * 0.5 + SURF.setDepth * set * set);
}

/** Where a wave of height `H` breaks (s, metres out): where the water is H / breakRatio deep. */
export function breakLine(H, a = 0) {
    const depth = H / SURF.breakRatio;
    const bar = SURF.sandbar * Math.sin(a * 0.071 + 0.6) * 0.6 + SURF.sandbar * Math.sin(a * 0.023 + 2.1) * 0.4;
    return Math.max(4, depth / SHORE.bed + bar);
}

/**
 * The surf at a place and a time, for aiming and tests:
 *   k      the number of the last crest to pass
 *   f      how far the place is through the gap to the next one (0 just passed, 1 arriving)
 *   H      the last crest's height, Hn the next one's
 *   since  seconds since the last crest passed
 *   broken whether the last crest had broken by the time it got here
 */
export function surfAt(a, s, t, out = {}) {
    const p = surfPhase(surfTime(a, s, t));
    const k = Math.floor(p);
    out.k = k;
    out.f = p - k;
    out.H = crestHeight(k);
    out.Hn = crestHeight(k + 1);
    out.since = out.f * SURF.period;
    out.broken = s < breakLine(out.H, a);
    return out;
}

/** A crest's length on the water, from one to the next (metres). */
export const WAVE_LENGTH = SURF.period * SURF.speed;

/**
 * The water's height over the mean sea at (a, s) and time t (metres): the two crests either side
 * of the place, each a wave steepening toward its break line or, past it, a foaming bore. The same
 * sum the shore's vertex stage draws (luminous-tides-shore.js, surfAt), less the board's waves.
 */
export function surfHeight(a, s, t) {
    const p = surfPhase(surfTime(a, s, t));
    const k = Math.floor(p);
    const f = p - k;
    const H = crestHeight(k);
    const Hn = crestHeight(k + 1);
    const sb = breakLine(H, a);
    const sbN = breakLine(Hn, a);
    const dB = f * WAVE_LENGTH;
    const dA = (1 - f) * WAVE_LENGTH;
    const brk = smooth(sb, sb - 4, s);
    const brkN = smooth(sbN, sbN - 4, s);
    const steep = smooth(sb + 16, sb, s);
    const steepN = smooth(sbN + 16, sbN, s);
    const wF = lerp(4.2, 0.9, steepN);
    const wB = lerp(5.5, 3.2, steep);
    const ampN = Hn * lerp(0.45, 1, steepN);
    const amp = H * lerp(0.45, 0.8, steep);
    const frontU = Math.exp(-((dA / wF) ** 2));
    const backU = Math.exp(-((dB / wB) ** 2));
    const hbN = Hn * 0.48 * clamp01(s / sbN) ** 0.7 + 0.035;
    const hb = H * 0.48 * clamp01(s / sb) ** 0.7 + 0.035;
    const frontB = Math.exp(-((dA / 0.5) ** 2));
    const backB = Math.exp(-dB / (WAVE_LENGTH * 0.32));
    const wet = smooth(-0.4, 1.4, s);
    const trough = (H + Hn) * 0.06 * (1 - brk);
    return (lerp(ampN * frontU, hbN * frontB, brkN) + lerp(amp * backU, hb * backB, brk) - trough) * wet;
}

// ── The swash ───────────────────────────────────────────────────────────────────────────────

/**
 * The swash: when a bore reaches the waterline it runs on up the sand as a thin sheet, slowing as
 * the slope takes it, stops, and drains back down. Ballistic: up = U·τ − ½·g′·τ², where g′ is
 * gravity along the foreshore. How far a wave runs up grows with its height.
 *   reach0, reachPerH   metres up the sand: reach = reach0 + reachPerH · H
 *   lobes               how much the leading edge scallops along the shore (metres): beach cusps
 */
export const SWASH = Object.freeze({
    reach0: 1.6,
    reachPerH: 5.2,
    lobes: 0.75,
    gravity: 9.81 * Math.sin(Math.atan(SHORE.foreshore)),
});

/** How far up the sand a wave of height H runs (metres, measured from the waterline). */
export function runup(H) {
    return SWASH.reach0 + SWASH.reachPerH * H;
}

/** Seconds the swash of a wave of height H takes to reach the top of its run. */
export function runupSeconds(H) {
    return Math.sqrt((2 * runup(H)) / SWASH.gravity);
}

/** How far up the sand the swash's edge is `tau` seconds after its bore reached the waterline. */
export function swashFront(H, tau) {
    const R = runup(H);
    const top = runupSeconds(H);
    const U = SWASH.gravity * top;
    const t = clamp(tau, 0, 2 * top);
    return Math.max(0, U * t - 0.5 * SWASH.gravity * t * t) * (R > 0 ? 1 : 0);
}

// ── The six nights ──────────────────────────────────────────────────────────────────────────

/**
 * The names of the colour rows the shaders read (one vec4 each; see NIGHTS).
 *   zenith, mid, horizon     the night air from overhead down to the sea's edge
 *   warm                     the glow low over the far coast on the left (a town, an afterglow)
 *   cloudLit, cloudShade     the cloud's underside where the warm glow reaches it, and away
 *   glow, glowHot            the sea's light (its hue), and its hottest sparks
 *   sand, wetSand            the beach in the night's light, dry and wet
 *   sea                      the colour of the water looked down into
 *   mist                     the air over the sea
 *   town                     the far coast's lamps
 */
export const NIGHT_COLOURS = Object.freeze([
    'zenith', 'mid', 'horizon', 'warm', 'cloudLit', 'cloudShade', 'glow', 'glowHot', 'sand', 'wetSand', 'sea',
    'mist', 'town',
]);

/**
 * Six nights on a wheel, in the order it turns. Scene-linear colours; the glow's hue goes round in
 * order (sea-green, cyan, azure, blue, cobalt, teal) so two neighbours never mix through grey.
 *   stars     how many stars show (0..1)       milky   the Milky Way
 *   cover     how much cloud (0..1)            haze    how thick the air over the sea is
 *   warmth    how much the far coast glows     glowPower  how bright the sea's light burns
 *   exposure  the lens for that night
 */
const night = (values) => Object.freeze(values);
export const NIGHTS = Object.freeze([
    night({
        name: 'afterglow',
        zenith: [0.010, 0.018, 0.060],
        mid: [0.040, 0.050, 0.120],
        horizon: [0.090, 0.090, 0.150],
        warm: [0.50, 0.18, 0.055],
        cloudLit: [0.30, 0.13, 0.06],
        cloudShade: [0.040, 0.034, 0.060],
        glow: [0.10, 0.80, 1.00],
        glowHot: [0.80, 1.00, 1.00],
        sand: [0.060, 0.050, 0.060],
        wetSand: [0.030, 0.034, 0.050],
        sea: [0.006, 0.012, 0.022],
        mist: [0.060, 0.060, 0.100],
        town: [1.00, 0.62, 0.28],
        stars: 0.35,
        milky: 0,
        cover: 0.55,
        haze: 0.18,
        warmth: 1.0,
        glowPower: 1.0,
        exposure: 1.05,
    }),
    night({
        name: 'harbour',
        zenith: [0.004, 0.006, 0.020],
        mid: [0.016, 0.016, 0.034],
        horizon: [0.036, 0.028, 0.030],
        warm: [0.30, 0.11, 0.032],
        cloudLit: [0.20, 0.08, 0.028],
        cloudShade: [0.022, 0.016, 0.022],
        glow: [0.08, 0.58, 1.00],
        glowHot: [0.70, 0.95, 1.00],
        sand: [0.040, 0.032, 0.034],
        wetSand: [0.020, 0.020, 0.030],
        sea: [0.004, 0.008, 0.016],
        mist: [0.050, 0.036, 0.040],
        town: [1.00, 0.55, 0.20],
        stars: 0.25,
        milky: 0,
        cover: 0.82,
        haze: 0.2,
        warmth: 1.0,
        glowPower: 1.1,
        exposure: 1.1,
    }),
    night({
        name: 'starfield',
        zenith: [0.002, 0.004, 0.014],
        mid: [0.006, 0.010, 0.026],
        horizon: [0.022, 0.026, 0.050],
        warm: [0.11, 0.055, 0.028],
        cloudLit: [0.07, 0.04, 0.026],
        cloudShade: [0.010, 0.010, 0.018],
        glow: [0.06, 0.40, 1.00],
        glowHot: [0.62, 0.86, 1.00],
        sand: [0.026, 0.026, 0.034],
        wetSand: [0.012, 0.016, 0.028],
        sea: [0.003, 0.006, 0.014],
        mist: [0.020, 0.024, 0.044],
        town: [1.00, 0.66, 0.34],
        stars: 1,
        milky: 1,
        cover: 0.16,
        haze: 0.1,
        warmth: 0.45,
        glowPower: 1.2,
        exposure: 1.15,
    }),
    night({
        name: 'deep',
        zenith: [0.002, 0.003, 0.010],
        mid: [0.005, 0.006, 0.016],
        horizon: [0.018, 0.016, 0.030],
        warm: [0.16, 0.065, 0.028],
        cloudLit: [0.10, 0.046, 0.022],
        cloudShade: [0.012, 0.010, 0.016],
        glow: [0.10, 0.30, 1.00],
        glowHot: [0.66, 0.78, 1.00],
        sand: [0.022, 0.020, 0.028],
        wetSand: [0.010, 0.012, 0.024],
        sea: [0.002, 0.004, 0.012],
        mist: [0.018, 0.016, 0.030],
        town: [1.00, 0.58, 0.26],
        stars: 0.45,
        milky: 0.4,
        cover: 0.62,
        haze: 0.14,
        warmth: 0.7,
        glowPower: 1.3,
        exposure: 1.2,
    }),
    night({
        name: 'bluehour',
        zenith: [0.010, 0.020, 0.075],
        mid: [0.030, 0.050, 0.140],
        horizon: [0.090, 0.110, 0.220],
        warm: [0.15, 0.09, 0.15],
        cloudLit: [0.13, 0.09, 0.16],
        cloudShade: [0.030, 0.034, 0.080],
        glow: [0.06, 0.92, 0.96],
        glowHot: [0.70, 1.00, 1.00],
        sand: [0.070, 0.070, 0.095],
        wetSand: [0.034, 0.044, 0.080],
        sea: [0.008, 0.016, 0.034],
        mist: [0.080, 0.096, 0.170],
        town: [1.00, 0.70, 0.40],
        stars: 0.2,
        milky: 0,
        cover: 0.4,
        haze: 0.16,
        warmth: 0.5,
        glowPower: 0.95,
        exposure: 1.0,
    }),
    night({
        name: 'seamist',
        zenith: [0.008, 0.012, 0.030],
        mid: [0.024, 0.032, 0.052],
        horizon: [0.060, 0.070, 0.090],
        warm: [0.20, 0.12, 0.05],
        cloudLit: [0.14, 0.10, 0.06],
        cloudShade: [0.026, 0.030, 0.040],
        glow: [0.08, 1.00, 0.72],
        glowHot: [0.70, 1.00, 0.92],
        sand: [0.050, 0.050, 0.056],
        wetSand: [0.024, 0.032, 0.040],
        sea: [0.005, 0.012, 0.016],
        mist: [0.090, 0.100, 0.120],
        town: [1.00, 0.68, 0.36],
        stars: 0.1,
        milky: 0,
        cover: 0.5,
        haze: 0.55,
        warmth: 0.65,
        glowPower: 1.05,
        exposure: 1.05,
    }),
]);

/** The wheel's pace: seconds of the clock from one night to the next, when no level turns it. */
export const NIGHT_SECONDS = 100;
/** The share of a step the light rests on a night at each end (it is on its way the rest). */
export const NIGHT_REST = 0.15;
/** A level's turn of the wheel is eased over this long. */
export const TURN_SECONDS = 4.5;

/**
 * Where on the wheel the light stands: the clock's own turn plus what the levels added.
 * Returns { i, j, mix }: the night it is leaving, the one it is on its way to, and how far (eased,
 * with a rest at each end).
 */
export function nightAt(wheel, out = { i: 0, j: 1, mix: 0 }) {
    const n = NIGHTS.length;
    const w = ((wheel % n) + n) % n;
    const i = Math.floor(w);
    const f = w - i;
    out.i = i;
    out.j = (i + 1) % n;
    out.mix = smooth(NIGHT_REST, 1 - NIGHT_REST, f);
    return out;
}

/** Ease a level's turn of the wheel: from `from` to `to` over `seconds`, `age` seconds in. */
export function turnOffset(from, to, age, seconds = TURN_SECONDS) {
    if (!(age >= 0)) return from;
    return lerp(from, to, smooth(0, Math.max(0.1, seconds), age));
}

const mixRow = (a, b, t, out) => {
    out[0] = lerp(a[0], b[0], t);
    out[1] = lerp(a[1], b[1], t);
    out[2] = lerp(a[2], b[2], t);
    return out;
};

/** The night's light at a place on the wheel: every NIGHT_COLOURS row plus the scalars. */
export function lightAt(wheel, out = null) {
    const o = out || Object.fromEntries(NIGHT_COLOURS.map((name) => [name, [0, 0, 0]]));
    const at = nightAt(wheel, o.at || { i: 0, j: 1, mix: 0 });
    o.at = at;
    const A = NIGHTS[at.i];
    const B = NIGHTS[at.j];
    // The sea's light leads the turn a little and the sky trails it, so the two are never both
    // half-way at once (a whole picture of one in-between hue).
    const lead = smooth(0, 0.8, at.mix);
    const trail = smooth(0.2, 1, at.mix);
    for (let r = 0; r < NIGHT_COLOURS.length; r += 1) {
        const name = NIGHT_COLOURS[r];
        const t = name === 'glow' || name === 'glowHot' ? lead : trail;
        mixRow(A[name], B[name], t, o[name]);
    }
    o.stars = lerp(A.stars, B.stars, trail);
    o.milky = lerp(A.milky, B.milky, trail);
    o.cover = lerp(A.cover, B.cover, trail);
    o.haze = lerp(A.haze, B.haze, trail);
    o.warmth = lerp(A.warmth, B.warmth, trail);
    o.glowPower = lerp(A.glowPower, B.glowPower, lead);
    o.exposure = lerp(A.exposure, B.exposure, trail);
    o.name = at.mix < 0.5 ? A.name : B.name;
    o.from = A.name;
    o.to = B.name;
    o.mix = at.mix;
    return o;
}

// ── Noise ───────────────────────────────────────────────────────────────────────────────────

/** A tileable value-noise fBm field, 0..1 (mean 0.5). */
function fbmField(size, rand, baseCells, octaves, gain = 0.55) {
    const out = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o += 1) {
        const cells = baseCells * 2 ** o;
        if (cells > size / 2) break;
        const lattice = new Float32Array(cells * cells);
        for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
        const step = cells / size;
        for (let j = 0; j < size; j += 1) {
            const y = j * step;
            const y0 = Math.floor(y);
            const fy = y - y0;
            const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
            const j0 = (y0 % cells) * cells;
            const j1 = ((y0 + 1) % cells) * cells;
            const rowAt = j * size;
            for (let i = 0; i < size; i += 1) {
                const x = i * step;
                const x0 = Math.floor(x);
                const fx = x - x0;
                const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
                const i0 = x0 % cells;
                const i1 = (i0 + 1) % cells;
                const p = lattice[j0 + i0];
                const q = lattice[j0 + i1];
                const s = lattice[j1 + i0];
                const w = lattice[j1 + i1];
                out[rowAt + i] += (p + (q - p) * sx + (s - p) * sy + (p - q - s + w) * sx * sy) * amp;
            }
        }
        total += amp;
        amp *= gain;
    }
    for (let i = 0; i < out.length; i += 1) out[i] /= total;
    return out;
}

/**
 * A tileable field of cell walls, 0..1: 1 on the seams between cells, 0 at their hearts (the gap
 * between the nearest and the second-nearest seed). Foam lace is a net of these walls.
 */
function wallField(size, rand, cells) {
    const px = new Float32Array(cells * cells);
    const py = new Float32Array(cells * cells);
    for (let i = 0; i < px.length; i += 1) {
        px[i] = 0.1 + rand() * 0.8;
        py[i] = 0.1 + rand() * 0.8;
    }
    const out = new Float32Array(size * size);
    const step = cells / size;
    for (let j = 0; j < size; j += 1) {
        const y = j * step;
        const cy = Math.floor(y);
        for (let i = 0; i < size; i += 1) {
            const x = i * step;
            const cx = Math.floor(x);
            let d1 = 9;
            let d2 = 9;
            for (let oy = -1; oy <= 1; oy += 1) {
                const gy = cy + oy;
                const wy = ((gy % cells) + cells) % cells;
                for (let ox = -1; ox <= 1; ox += 1) {
                    const gx = cx + ox;
                    const at = wy * cells + (((gx % cells) + cells) % cells);
                    const dx = gx + px[at] - x;
                    const dy = gy + py[at] - y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < d1) {
                        d2 = d1;
                        d1 = d;
                    } else if (d < d2) {
                        d2 = d;
                    }
                }
            }
            out[j * size + i] = 1 - clamp01((d2 - d1) * 3.2);
        }
    }
    return out;
}

/** A tileable field of rounded cells, 0..1: 1 at a cell's heart (cloud billows). */
function cellField(size, rand, cells) {
    const px = new Float32Array(cells * cells);
    const py = new Float32Array(cells * cells);
    for (let i = 0; i < px.length; i += 1) {
        px[i] = rand();
        py[i] = rand();
    }
    const out = new Float32Array(size * size);
    const step = cells / size;
    for (let j = 0; j < size; j += 1) {
        const y = j * step;
        const cy = Math.floor(y);
        for (let i = 0; i < size; i += 1) {
            const x = i * step;
            const cx = Math.floor(x);
            let best = 9;
            for (let oy = -1; oy <= 1; oy += 1) {
                const gy = cy + oy;
                const wy = ((gy % cells) + cells) % cells;
                for (let ox = -1; ox <= 1; ox += 1) {
                    const gx = cx + ox;
                    const at = wy * cells + (((gx % cells) + cells) % cells);
                    const dx = gx + px[at] - x;
                    const dy = gy + py[at] - y;
                    const d = dx * dx + dy * dy;
                    if (d < best) best = d;
                }
            }
            out[j * size + i] = 1 - Math.min(1, Math.sqrt(best));
        }
    }
    return out;
}

const toByte = (v) => Math.round(clamp01(v) * 255);

/**
 * The sky's noise, as bytes (RGBA8), tileable:
 *   R  broad fBm (the shape of a cloud field)
 *   G  billows: rounded cells at three sizes
 *   B  a second, independent fBm (where there is cloud at all; the Milky Way's dust)
 *   A  fine fBm (the torn edge of everything)
 */
export function bakeSkyNoise(size = 256, seed = 20261013) {
    const rand = mulberry32(seed);
    const broad = fbmField(size, rand, 4, 6);
    const second = fbmField(size, rand, 3, 6);
    const fine = fbmField(size, rand, 16, 4, 0.6);
    const c1 = cellField(size, rand, 6);
    const c2 = cellField(size, rand, 13);
    const c3 = cellField(size, rand, 29);
    const data = new Uint8Array(size * size * 4);
    for (let at = 0; at < size * size; at += 1) {
        const billow = c1[at] * 0.56 + c2[at] * 0.29 + c3[at] * 0.15;
        data[at * 4] = toByte((broad[at] - 0.5) * 2.0 + 0.5);
        data[at * 4 + 1] = toByte(billow * 1.25);
        data[at * 4 + 2] = toByte((second[at] - 0.5) * 2.0 + 0.5);
        data[at * 4 + 3] = toByte((fine[at] - 0.5) * 2.2 + 0.5);
    }
    return data;
}

/**
 * The water's noise, as bytes (RGBA8), tileable:
 *   R, G  the slope of a five-octave height field (around 0.5): ripples
 *   B     foam lace: a net of cell walls at two sizes, torn by fBm (bright on the threads)
 *   A     a fine fBm (the foam's grain, the sand's)
 * `variance` is returned beside the bytes: the slope variance a byte pair carries.
 */
export function bakeSeaNoise(size = 256, seed = 20261014) {
    const rand = mulberry32(seed);
    const h = fbmField(size, rand, 4, 5);
    const grain = fbmField(size, rand, 16, 3, 0.6);
    const tear = fbmField(size, rand, 6, 4);
    const w1 = wallField(size, rand, 9);
    const w2 = wallField(size, rand, 21);
    const data = new Uint8Array(size * size * 4);
    const wrap = (n) => (n + size) % size;
    let peak = 1e-6;
    const gx = new Float32Array(size * size);
    const gy = new Float32Array(size * size);
    for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
            const at = j * size + i;
            gx[at] = (h[j * size + wrap(i + 1)] - h[j * size + wrap(i - 1)]) * 0.5;
            gy[at] = (h[wrap(j + 1) * size + i] - h[wrap(j - 1) * size + i]) * 0.5;
            peak = Math.max(peak, Math.abs(gx[at]), Math.abs(gy[at]));
        }
    }
    let sum = 0;
    for (let at = 0; at < size * size; at += 1) {
        const sx = gx[at] / peak;
        const sy = gy[at] / peak;
        sum += sx * sx + sy * sy;
        // Lace: the big net's threads, the small net's finer ones between, both torn open where
        // the tearing field runs low (foam never makes a closed honeycomb).
        const torn = smooth(0.3, 0.62, tear[at]);
        const lace = Math.max(w1[at] ** 3.2, w2[at] ** 4 * 0.75) * (0.35 + 0.65 * torn);
        data[at * 4] = toByte(sx * 0.5 + 0.5);
        data[at * 4 + 1] = toByte(sy * 0.5 + 0.5);
        data[at * 4 + 2] = toByte(lace);
        data[at * 4 + 3] = toByte((grain[at] - 0.5) * 2.3 + 0.5);
    }
    return { data, variance: sum / (size * size) };
}
