/**
 * Chromadelic Highway — the spectrum: the colour and form of every ring, and the tint of the air.
 *
 * Rings take ANY colour. The highway runs through six movements, each a colour scheme over
 * consecutive rings (a rainbow run, a warm run, complementary pairs, a triad ...) with its own
 * ring forms (neon tube, double line, dashed segments, beads, hexagon and octagon gates, prism
 * arcs). A ring takes its colour and form just before it comes out from behind the board and
 * keeps them for its whole flight, so a new scheme arrives ring by ring down the highway and
 * never blends two palettes through grey.
 *
 * Place on the cycle = levelPlace + distance / STEP_TRAVEL:
 *   - the distance term drifts everything with the road, one movement about every 90 s at
 *     cruise (faster when the play pace rises), at ANY level,
 *   - every level-up adds one whole step on top, so a level-up turns to the next movement.
 * The sky (nebula hue, distant haze) follows the same place, eased across each boundary
 * (resting SKY_REST at each end, moving for the rest of the step).
 *
 * CPU only (no three.js): the ring styles are written into uniform arrays by the world, and the
 * prism colours the ring shader computes per fragment use the same law (chdNeonColor in
 * chromadelic-highway-tsl.js is the GPU twin of neonColor below).
 */

/** World units of road per movement: 90 s at the cruise speed of 180 u/s. */
export const STEP_TRAVEL = 16_200;
/**
 * Where a session starts: 35 % into the first movement, where the sky has come to rest on its
 * tint (it turns across each boundary), so level 1 opens on the prism run under the home sky.
 */
export const SPECTRUM_HOME = 0.35;
/** The sky rests on each movement's tint for this share at each end of its step. */
export const SKY_REST = 0.15;
/** The packet/spin phase wraps at 40π: every spin rate is a multiple of 1/20, so it is seamless. */
export const RING_PHASE_WRAP = Math.PI * 40;

const fract = (x) => x - Math.floor(x);
const mod = (a, n) => ((a % n) + n) % n;
const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

/** Deterministic per-ring hash in [0, 1) (a double-precision sine hash; serials stay < 1e6). */
export function ringHash(serial, salt = 0) {
    const s = Math.sin(serial * 12.9898 + salt * 78.233) * 43758.5453;
    return s - Math.floor(s);
}

// ── Neon colour law (CPU twin of chdNeonHue / chdNeonColor) ─────────────────────

const LUMA = [0.2126, 0.7152, 0.0722];
export const NEON_WHITE_FLOOR = 0.1;
export const NEON_LUMA_EXP = 0.6;

/** Smooth fully saturated hue (Quilez's smooth HSV, s = v = 1). Hue in turns: 0 red, 1/6 yellow,
 * 1/3 green, 1/2 cyan, 2/3 blue, 5/6 magenta. */
export function neonHue(h, out = { r: 0, g: 0, b: 0 }) {
    const ch = (o) => {
        const x = Math.min(1, Math.max(0, Math.abs(fract(h + o) * 6 - 3) - 1));
        return x * x * (3 - 2 * x);
    };
    out.r = ch(0);
    out.g = ch(2 / 3);
    out.b = ch(1 / 3);
    return out;
}

/**
 * A neon emitter colour: the saturated hue with a 10 % white floor (a neon core is never a pure
 * primary), luminance-normalised toward `target` with exponent 0.6 so blue/violet keep their
 * presence beside yellow/green without blowing out.
 */
export function neonColor(h, target = 0.5, out = { r: 0, g: 0, b: 0 }) {
    neonHue(h, out);
    const w = NEON_WHITE_FLOOR;
    out.r = out.r * (1 - w) + w;
    out.g = out.g * (1 - w) + w;
    out.b = out.b * (1 - w) + w;
    const l = out.r * LUMA[0] + out.g * LUMA[1] + out.b * LUMA[2];
    const k = (target / Math.max(l, 0.1)) ** NEON_LUMA_EXP;
    out.r *= k;
    out.g *= k;
    out.b *= k;
    return out;
}

/** Hue (turns) of an rgb triple; NaN-free for greys (returns 0). */
export function hueOf(c) {
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    const d = max - min;
    if (d < 1e-6) return 0;
    let h;
    if (max === c.r) h = ((c.g - c.b) / d) % 6;
    else if (max === c.g) h = (c.b - c.r) / d + 2;
    else h = (c.r - c.g) / d + 4;
    return fract(h / 6);
}

// ── Ring forms ──────────────────────────────────────────────────────────────────

/** Shading patterns along the strip. */
export const RING_PATTERN = Object.freeze({
    tube: 0, double: 1, dashes: 2, beads: 3,
});

/**
 * A form = shape (0 round, else the polygon's side count; flat top, feet on the road line) +
 * pattern + count (dashes/beads around a full turn) + spin (a multiple of 1/20 of the packet
 * phase, signed) + prism (the arc carries the whole spectrum, foot to foot).
 */
export const RING_FORMS = Object.freeze({
    tube: {
        shape: 0, pattern: RING_PATTERN.tube, count: 0, spin: 0, prism: 0,
    },
    double: {
        shape: 0, pattern: RING_PATTERN.double, count: 0, spin: 0, prism: 0,
    },
    dashes: {
        shape: 0, pattern: RING_PATTERN.dashes, count: 22, spin: 0.15, prism: 0,
    },
    beads: {
        shape: 0, pattern: RING_PATTERN.beads, count: 72, spin: -0.1, prism: 0,
    },
    hex: {
        shape: 6, pattern: RING_PATTERN.tube, count: 0, spin: 0, prism: 0,
    },
    hexDouble: {
        shape: 6, pattern: RING_PATTERN.double, count: 0, spin: 0, prism: 0,
    },
    oct: {
        shape: 8, pattern: RING_PATTERN.tube, count: 0, spin: 0, prism: 0,
    },
    octDashes: {
        shape: 8, pattern: RING_PATTERN.dashes, count: 32, spin: -0.1, prism: 0,
    },
    octBeads: {
        shape: 8, pattern: RING_PATTERN.beads, count: 80, spin: 0.05, prism: 0,
    },
    prism: {
        shape: 0, pattern: RING_PATTERN.tube, count: 0, spin: 0, prism: 1,
    },
    hexPrism: {
        shape: 6, pattern: RING_PATTERN.tube, count: 0, spin: 0, prism: 1,
    },
});

// ── Movements ───────────────────────────────────────────────────────────────────

/**
 * Hue offsets (turns) of consecutive rings, by scheme. `serial` is the ring's lattice id
 * (an integer that counts the rings since the session's start).
 */
const SCHEMES = {
    /** The whole rainbow every seven rings. */
    prism: (s) => s / 7,
    /** One colour family: a slow two-sine walk within ±0.09 of the base. */
    run: (s) => 0.06 * Math.sin(s * 2.1) + 0.03 * Math.sin(s * 0.7),
    /** Three hues a third apart, slightly walked. */
    triad: (s) => mod(s, 3) / 3 + 0.02 * Math.sin(s * 1.3),
    /** Complementary pairs. */
    chord: (s) => mod(s, 2) * 0.5 + 0.03 * Math.sin(s * 1.7),
};

/**
 * The cycle. Ordered so the sky's turn walks in small steps (≤ 0.14 turns) round the cycle.
 *   hue/walk   base hue (turns) and its drift over the movement
 *   glowShift  the halo's hue offset from the core (two-tone neon)
 *   beat       forms of ordinary rings (picked by hash); downbeat: every 4th ring (the accent)
 *   sky        the nebula's hue turn while this movement plays
 */
export const MOVEMENTS = Object.freeze([
    {
        name: 'prism',
        scheme: 'prism',
        hue: 0.0,
        walk: 0.14,
        glowShift: 0.0,
        beat: ['tube', 'tube', 'double'],
        downbeat: ['prism'],
        sky: 0.0,
    },
    {
        name: 'orchid',
        scheme: 'run',
        hue: 0.8,
        walk: 0.08,
        glowShift: 0.05,
        beat: ['double', 'tube', 'dashes'],
        downbeat: ['oct'],
        sky: 0.03,
    },
    {
        name: 'ember',
        scheme: 'run',
        hue: 0.035,
        walk: 0.07,
        glowShift: -0.03,
        beat: ['beads', 'tube', 'tube'],
        downbeat: ['hexDouble'],
        sky: 0.1,
    },
    {
        name: 'triad',
        scheme: 'triad',
        hue: 0.92,
        walk: 0.06,
        glowShift: 0.0,
        beat: ['tube', 'dashes', 'tube'],
        downbeat: ['hex'],
        sky: 0.04,
    },
    {
        name: 'chord',
        scheme: 'chord',
        hue: 0.58,
        walk: 0.08,
        glowShift: 0.0,
        beat: ['double', 'tube', 'tube'],
        downbeat: ['octBeads'],
        sky: -0.06,
    },
    {
        name: 'tide',
        scheme: 'run',
        hue: 0.5,
        walk: 0.1,
        glowShift: 0.06,
        beat: ['dashes', 'tube', 'beads'],
        downbeat: ['octDashes'],
        sky: -0.14,
    },
]);

/** The movement a place stands in and how far through it (x in [0, 1)). */
export function movementAt(place) {
    const m = Math.floor(place);
    const index = mod(m, MOVEMENTS.length);
    return { index, movement: MOVEMENTS[index], x: place - m };
}

/** The ring core hue (turns) of ring `serial` locked at `place`. */
export function ringHue(serial, place) {
    const { movement: mov, x } = movementAt(place);
    return fract(mov.hue + mov.walk * x + SCHEMES[mov.scheme](serial));
}

/**
 * The style ring `serial` takes when it locks at `place`.
 * @param {number} serial   integer ring id (lattice J, unwrapped)
 * @param {number} place    spectrum place at lock time
 * @param {object} [out]
 * @param {{form?: string, prism?: boolean}} [override]  debug/event overrides
 */
export function ringStyle(serial, place, out = {}, override = null) {
    const { movement: mov, x, index } = movementAt(place);
    const downbeat = mod(serial, 4) === 3;
    const list = downbeat ? mov.downbeat : mov.beat;
    const formName = override?.form && RING_FORMS[override.form]
        ? override.form
        : list[Math.floor(ringHash(serial, 1) * list.length) % list.length];
    const form = RING_FORMS[formName];
    const hue = fract(mov.hue + mov.walk * x + SCHEMES[mov.scheme](serial));
    out.serial = serial;
    out.movement = index;
    out.form = formName;
    out.hue = hue;
    out.core = neonColor(hue, downbeat ? 0.58 : 0.5, out.core || {});
    out.glow = neonColor(hue + mov.glowShift, 0.42, out.glow || {});
    out.shape = form.shape;
    out.pattern = form.pattern;
    out.count = form.count;
    out.spin = form.spin;
    out.prism = override?.prism ? 1 : form.prism;
    // The prism arc starts at a hue that walks with the serial (no two prism rings alike).
    out.prismHue = fract(hue + ringHash(serial, 2) * 0.5);
    return out;
}

/** The nebula's hue turn at a place: centred on each boundary, resting SKY_REST at each end. */
export function skyTurnAt(place) {
    const p = place - 0.5;
    const m = Math.floor(p);
    const a = MOVEMENTS[mod(m, MOVEMENTS.length)].sky;
    const b = MOVEMENTS[mod(m + 1, MOVEMENTS.length)].sky;
    return lerp(a, b, smooth(SKY_REST, 1 - SKY_REST, p - m));
}

/** Diagnostics: the movement a place stands in, the next one and the sky's progress. */
export function spectrumSummary(place) {
    const { index, x } = movementAt(place);
    return {
        place: Math.round(place * 1000) / 1000,
        movement: MOVEMENTS[index].name,
        next: MOVEMENTS[mod(index + 1, MOVEMENTS.length)].name,
        through: Math.round(x * 100) / 100,
        skyTurn: Math.round(skyTurnAt(place) * 1000) / 1000,
    };
}
