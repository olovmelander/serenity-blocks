/**
 * Sky Children — Irisfall: three-free maths.
 *
 * Nothing here imports three: the world's tests, the director and the composition solver run in
 * Node on these alone. The droplet-optics LUT, the noise bakes, colour and the falls' ballistics
 * live here too, so the CPU twins the tests check are the numbers the shaders read.
 */

export const DEG = Math.PI / 180;

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two DISTINCT edges (either order). */
export function smooth(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
}

/** Frame-rate independent easing factor: `value += (target - value) * approach(rate, dt)`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt));

/** A small seeded generator (deterministic layouts: never Math.random in the world). */
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

/**
 * The occupied cells of a piece's shape matrix (in the orientation it locked in) as eight
 * numbers: four (x, y) offsets from the centre of their bounding box, y UP. null without a matrix.
 */
export function cellsFromMatrix(matrix) {
    if (!Array.isArray(matrix)) return null;
    const cells = [];
    for (let r = 0; r < matrix.length && r < 8; r++) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length && c < 8; c++) {
            if (Number(row[c]) > 0 && cells.length < 8) cells.push(c, -r);
        }
    }
    if (!cells.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < cells.length; i += 2) {
        minX = Math.min(minX, cells[i]);
        maxX = Math.max(maxX, cells[i]);
        minY = Math.min(minY, cells[i + 1]);
        maxY = Math.max(maxY, cells[i + 1]);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const out = new Array(8);
    for (let i = 0; i < 8; i += 2) {
        const j = i < cells.length ? i : 0;
        out[i] = cells[j] - cx;
        out[i + 1] = cells[j + 1] - cy;
    }
    return out;
}

// ── Colour ──────────────────────────────────────────────────────────────────────────────────

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * Reads a colour into three sRGB bytes' worth of 0..1 numbers. Takes '#rrggbb', 'rrggbb',
 * '#rgb' or a number (0xrrggbb). Returns false (and leaves `out` alone) for anything else.
 */
function readHex(hex, out) {
    let value = -1;
    if (typeof hex === 'number' && Number.isInteger(hex) && hex >= 0 && hex <= 0xffffff) {
        value = hex;
    } else if (typeof hex === 'string') {
        const text = hex.startsWith('#') ? hex.slice(1) : hex;
        if (/^[0-9a-f]{6}$/i.test(text)) value = Number.parseInt(text, 16);
        else if (/^[0-9a-f]{3}$/i.test(text)) {
            value = Number.parseInt(text[0] + text[0] + text[1] + text[1] + text[2] + text[2], 16);
        }
    }
    if (value < 0) return false;
    out[0] = ((value >> 16) & 255) / 255;
    out[1] = ((value >> 8) & 255) / 255;
    out[2] = (value & 255) / 255;
    return true;
}

/**
 * A colour as scene-linear light ('#rrggbb', '#rgb' or 0xrrggbb). Anything that is not a colour
 * reads as black.
 * @param {string|number} hex
 * @param {number[]} [out]
 * @returns {number[]} [r, g, b] linear
 */
export function hexToLinear(hex, out = [0, 0, 0]) {
    if (!readHex(hex, out)) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return out;
    }
    out[0] = srgbToLinear(out[0]);
    out[1] = srgbToLinear(out[1]);
    out[2] = srgbToLinear(out[2]);
    return out;
}

/**
 * Linear sRGB → OKLab (Björn Ottosson's matrices): [L, a, b], L 0..1.
 * @param {number[]} rgb linear
 * @param {number[]} [out]
 */
export function linearToOklab(rgb, out = [0, 0, 0]) {
    const [r, g, b] = rgb;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return out;
}

/**
 * OKLab → linear sRGB (may leave the gamut: a channel can fall below 0).
 * @param {number[]} lab
 * @param {number[]} [out]
 */
export function oklabToLinear(lab, out = [0, 0, 0]) {
    const [L, a, b] = lab;
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return out;
}

const labScratch = [0, 0, 0];

/**
 * Linear sRGB → OKLCh: [L, C, h], the hue in DEGREES (0..360). A colour with no chroma keeps h 0.
 * @param {number[]} rgb linear
 * @param {number[]} [out]
 */
export function toOklch(rgb, out = [0, 0, 0]) {
    const lab = linearToOklab(rgb, labScratch);
    const C = Math.hypot(lab[1], lab[2]);
    out[0] = lab[0];
    out[1] = C;
    out[2] = C < 1e-9 ? 0 : (((Math.atan2(lab[2], lab[1]) / DEG) % 360) + 360) % 360;
    return out;
}

/**
 * OKLCh (hue in degrees) → linear sRGB, exact (it may leave the gamut; see lerpOklch).
 * @param {number[]} lch
 * @param {number[]} [out]
 */
export function fromOklch(lch, out = [0, 0, 0]) {
    const h = lch[2] * DEG;
    labScratch[0] = lch[0];
    labScratch[1] = lch[1] * Math.cos(h);
    labScratch[2] = lch[1] * Math.sin(h);
    return oklabToLinear(labScratch, out);
}

const lchScratch = [0, 0, 0];

/**
 * OKLCh → linear sRGB, brought into the gamut by giving up chroma (never hue or lightness)
 * until no channel is negative. Light is never negative.
 * @param {number[]} lch
 * @param {number[]} [out]
 */
export function fromOklchInGamut(lch, out = [0, 0, 0]) {
    fromOklch(lch, out);
    if (Math.min(out[0], out[1], out[2]) >= 0) return out;
    lchScratch[0] = lch[0];
    lchScratch[2] = lch[2];
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        lchScratch[1] = lch[1] * mid;
        fromOklch(lchScratch, out);
        if (Math.min(out[0], out[1], out[2]) >= 0) lo = mid;
        else hi = mid;
    }
    lchScratch[1] = lch[1] * lo;
    fromOklch(lchScratch, out);
    out[0] = Math.max(0, out[0]);
    out[1] = Math.max(0, out[1]);
    out[2] = Math.max(0, out[2]);
    return out;
}

/**
 * The OKLCh mix of two LCh colours, the hue along the SHORT arc. A colour with (almost) no
 * chroma takes the other's hue, so a mix toward grey fades without turning.
 * @param {number[]} a lch
 * @param {number[]} b lch
 * @param {number} t 0..1
 * @param {number[]} [out] lch
 */
export function mixLch(a, b, t, out = [0, 0, 0]) {
    let ha = a[2];
    let hb = b[2];
    if (a[1] < 1e-4) ha = hb;
    if (b[1] < 1e-4) hb = ha;
    let dh = (hb - ha) % 360;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    out[0] = lerp(a[0], b[0], t);
    out[1] = lerp(a[1], b[1], t);
    out[2] = (((ha + dh * t) % 360) + 360) % 360;
    return out;
}

const lerpA = [0, 0, 0];
const lerpB = [0, 0, 0];
const lerpM = [0, 0, 0];

/**
 * Two linear colours mixed in OKLCh along the short hue arc, back in linear sRGB (in gamut).
 * Chroma moves straight from one end's to the other's, so no mix passes through grey.
 * @param {number[]} a linear rgb
 * @param {number[]} b linear rgb
 * @param {number} t 0..1
 * @param {number[]} [out] linear rgb
 */
export function lerpOklch(a, b, t, out = [0, 0, 0]) {
    toOklch(a, lerpA);
    toOklch(b, lerpB);
    return fromOklchInGamut(mixLch(lerpA, lerpB, t, lerpM), out);
}

/**
 * A piece's colour as light: scene-linear, its brightest channel lifted to at least `floor` (the
 * hue and its chroma kept) so even the darkest piece colour still shines. Anything that is not a
 * colour is white light-water.
 * @param {string|number} hex
 * @param {number} [floor]
 * @param {number[]} [out]
 */
export function pieceLight(hex, floor = 0.35, out = [0, 0, 0]) {
    if (!readHex(hex, out)) {
        out[0] = 1;
        out[1] = 1;
        out[2] = 1;
        return out;
    }
    out[0] = srgbToLinear(out[0]);
    out[1] = srgbToLinear(out[1]);
    out[2] = srgbToLinear(out[2]);
    const peak = Math.max(out[0], out[1], out[2]);
    if (peak < 1e-6) {
        out[0] = floor;
        out[1] = floor;
        out[2] = floor;
    } else if (peak < floor) {
        const k = floor / peak;
        out[0] *= k;
        out[1] *= k;
        out[2] *= k;
    }
    return out;
}

// ── The falls ───────────────────────────────────────────────────────────────────────────────

/** Gravity (m/s²). The falls are ballistic: water leaves a lip and simply falls. */
export const G = 9.81;

/**
 * How far along its own curve water has run `t` seconds after leaving a lip at `v0` m/s
 * (horizontal): the arc length of x = v0·t, y = −½·G·t².
 * @param {number} t seconds
 * @param {number} v0 m/s
 */
export function fallLength(t, v0) {
    const tt = Math.max(0, t);
    const v = Math.abs(v0);
    if (v < 1e-9) return 0.5 * G * tt * tt;
    const gt = G * tt;
    return (gt * Math.hypot(v, gt) + v * v * Math.asinh(gt / v)) / (2 * G);
}

/**
 * The time water takes to run a path length `s` (metres) down its curve from a lip it left at
 * `v0` m/s: the inverse of fallLength, monotonic in s. Newton from above the root (the arc is
 * convex in t, so it never overshoots).
 * @param {number} s metres along the curve
 * @param {number} v0 m/s
 */
export function travelTime(s, v0) {
    const ss = Math.max(0, s);
    const v = Math.abs(v0);
    const free = Math.sqrt((2 * ss) / G);
    if (ss === 0) return 0;
    if (v < 1e-9) return free;
    let t = Math.min(ss / v, free);
    for (let i = 0; i < 8; i++) {
        const f = fallLength(t, v) - ss;
        const df = Math.hypot(v, G * t);
        const step = f / df;
        t -= step;
        if (Math.abs(step) < 1e-12 * (1 + t)) break;
    }
    return Math.max(0, t);
}

/**
 * The shaders wrap the water clock at this many seconds (no precision lost over a long sitting),
 * so every rate the falls move at is a whole number of turns in it: nothing jumps at the wrap.
 */
export const WATER_WRAP = 50;

/**
 * How the falls stray sideways, the same on the CPU and in the falls' vertex stage:
 *   rate, thread   a horsetail sways in the wind (3 turns a wrap), by `thread`·t² metres
 *   gust, ripple   and gusts ride down it at water speed (three waves written in travel time, 23,
 *                  41 and 11 turns a wrap, the slow one stronger on some threads than others), by
 *                  `ripple`·t² metres: a thread wavers, never a ruled line, and no two alike
 *   lobes, sheet   a curtain meanders: two waves (17 and 29 turns a wrap) written in travel time,
 *                  so they ride down at water speed, `sheet` of its width at most
 *   swell          and its width swells and narrows on a third (23 turns a wrap; GPU only)
 */
export const FALL_SWAY = Object.freeze({
    rate: (2 * Math.PI * 3) / WATER_WRAP,
    thread: 0.1,
    gust: Object.freeze([(2 * Math.PI * 23) / WATER_WRAP, (2 * Math.PI * 41) / WATER_WRAP, (2 * Math.PI * 11) / WATER_WRAP]),
    ripple: 0.15,
    lobes: Object.freeze([(2 * Math.PI * 17) / WATER_WRAP, (2 * Math.PI * 29) / WATER_WRAP]),
    sheet: 0.08,
    swell: (2 * Math.PI * 23) / WATER_WRAP,
});

/**
 * How far a fall's centre line has strayed along its lip's tangent (metres, + to the left of its
 * heading) `t` seconds down it, at a water clock: a horsetail (kind 1) sways, a curtain (kind 0)
 * meanders, anything else falls true.
 * @param {{ kind?: number, width?: number, spread?: number, phase?: number }} fall
 * @param {number} t seconds of fall
 * @param {number} [clock] the water clock (s)
 */
export function fallSway(fall, t, clock = 0) {
    const wc = clock - Math.floor(clock / WATER_WRAP) * WATER_WRAP;
    const ph = fall.phase ?? 0;
    if (fall.kind === 1) {
        const x = t - wc;
        const gusts = 0.7 * Math.sin(FALL_SWAY.gust[0] * x + 1.3 * ph) + 0.3 * Math.sin(FALL_SWAY.gust[1] * x + 2.3 * ph)
            + (0.45 + 0.25 * Math.sin(2.9 * ph)) * Math.sin(FALL_SWAY.gust[2] * x + 0.7 * ph);
        return t * t * (FALL_SWAY.thread * Math.sin(FALL_SWAY.rate * wc + ph) + FALL_SWAY.ripple * gusts);
    }
    if (fall.kind === 0) {
        const x = t - wc;
        const wave = 0.6 * Math.sin(FALL_SWAY.lobes[0] * x + ph) + 0.4 * Math.sin(FALL_SWAY.lobes[1] * x + 2.1 * ph);
        return FALL_SWAY.sheet * ((fall.width ?? 0) + (fall.spread ?? 0) * t) * smooth(0, 1.5, t) * wave;
    }
    return 0;
}

/**
 * Where water is `t` seconds after it left a lip (on its centre line, as the falls draw it).
 * @param {{ lip: number[], dir: number[], v0: number, spread?: number, kind?: number }} fall
 *   lip [x, y, z]; dir [dx, dz] the unit heading on the ground; v0 the speed it leaves at (m/s);
 *   a fall that names its `kind` strays as fallSway() says
 * @param {number} t seconds
 * @param {number[]} [out]
 * @param {number} [clock] the water clock (the sway and the meander ride on it)
 */
export function fallPoint(fall, t, out = [0, 0, 0], clock = 0) {
    const tt = Math.max(0, t);
    const run = fall.v0 * tt;
    const side = fall.kind === undefined ? 0 : fallSway(fall, tt, clock);
    // Along the lip's tangent, to the left of the heading: (dz, 0, −dx).
    out[0] = fall.lip[0] + fall.dir[0] * run + fall.dir[1] * side;
    out[1] = fall.lip[1] - 0.5 * G * tt * tt;
    out[2] = fall.lip[2] + fall.dir[1] * run - fall.dir[0] * side;
    return out;
}

// ── Droplet optics: the one table every optic reads ─────────────────────────────────────────
//
// The light is behind us, so everything droplets do is seen round the antisolar point A, at an
// angle θ from it. The table has six rows, each RGB per texel (A = 1):
//   0  the primary bow (one internal reflection), θ 0..60°
//   1  the secondary bow (two), θ 0..60°
//   2  the fogbow (the primary of tiny fog drops), θ 0..60°
//   3  the glory and the opposition glow, θ 0..25°
//   4  the primary in the low sun's reddened light (the sunset bow), θ 0..60°
//   5  the primary of smaller, matched drops (its supernumeraries), θ 0..60°
// Row 5 is the last, so with the table repeating vertically it lies next to row 0 across the
// wrap: one fetch between their centres reads the primary already mixed toward its fringes.
// Each colour channel is drawn at one wavelength with water's index there (R 650 nm n 1.331,
// G 550 nm n 1.335, B 450 nm n 1.340). The bows are Airy's theory: near the geometric bow angle
// the outgoing wavefront is cubic, so the intensity is Ai²(z) with z ∝ (a/λ)^(2/3)·(θ − θ_bow):
// the bright fringe sits just inside the geometric angle (outside it for the secondary), the
// supernumeraries ring on the bright side, the dark side dies away exponentially (Alexander's
// band), and far into the bright side the fringes average to the geometric 1/√Δθ glow that is
// the bow's inner (outer, for the secondary) brightening. Every row is summed over a spread of
// drop sizes and smeared by the sun's disc (as nature smears it: that is what keeps only the
// first few supernumeraries), worked on a 0.02° grid, and each texel is the AVERAGE of that
// curve over its own width, so a table of any width is anti-aliased and two neighbouring texels
// of a wide table average to one texel of a table half as wide.

/**
 * Degrees from A each row covers: primary, secondary, fogbow (0..60°), glory (0..25°), the sunset
 * primary and the matched-drop primary (0..60°).
 */
export const OPTICS_RANGE = Object.freeze([60, 60, 60, 25, 60, 60]);

/** Rows in the table (its height in texels). */
export const OPTICS_ROWS = OPTICS_RANGE.length;

/** The width opticsAt reads at, and the table's width when nobody asks for another. */
export const OPTICS_WIDTH = 512;

/** Three wavelengths (m) and water's index there: the glory's colours are drawn in these. */
export const OPTICS_BANDS = Object.freeze([
    Object.freeze({ lambda: 650e-9, n: 1.331 }),
    Object.freeze({ lambda: 550e-9, n: 1.335 }),
    Object.freeze({ lambda: 450e-9, n: 1.34 }),
]);

/** Water's index at a wavelength (nm): Cauchy, through the bands above (1.3335 at 550 nm). */
export const waterIndex = (nm) => 1.3227 + 3501 / (nm * nm);

/** One lobe of Wyman, Sloan & Shirley's fit to the CIE 1931 observer. */
const lobe = (nm, mu, s1, s2) => {
    const t = (nm - mu) / (nm < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
};

/**
 * The bows are drawn across the spectrum: 16 wavelengths, 400–700 nm, each weighted by the CIE
 * observer turned into linear sRGB, every channel's weights summing to one (a white sun stays
 * white). Where the colours overlap the bow has its yellow and its orange; a three-wavelength
 * bow is three stripes.
 */
export const OPTICS_SPECTRUM = Object.freeze((() => {
    const N = 16;
    const rows = [];
    for (let i = 0; i < N; i++) {
        const nm = 400 + (300 * (i + 0.5)) / N;
        const x = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
        const y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
        const z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
        rows.push({
            lambda: nm * 1e-9,
            n: waterIndex(nm),
            w: [
                3.2406 * x - 1.5372 * y - 0.4986 * z,
                -0.9689 * x + 1.8758 * y + 0.0415 * z,
                0.0557 * x - 0.204 * y + 1.057 * z,
            ],
        });
    }
    for (let c = 0; c < 3; c++) {
        const sum = rows.reduce((acc, r) => acc + r.w[c], 0);
        rows.forEach((r) => { r.w[c] /= sum; });
    }
    return rows.map((r) => Object.freeze({ lambda: r.lambda, n: r.n, w: Object.freeze(r.w) }));
})());

/** The drops, the light and the rows' peak heights (relative scene-linear radiance). */
export const OPTICS = Object.freeze({
    /** Spray and rain: the median drop radius (m) and the spread of ln(radius). */
    sprayRadius: 0.5e-3,
    spraySpread: 0.06,
    /** Fog over the Deep: tiny drops, a broad white bow. */
    fogRadius: 15e-6,
    fogSpread: 0.25,
    /** Cloud droplets on the mist (the glory). Clouds' drops are nearly all one size. */
    cloudRadius: 15e-6,
    cloudSpread: 0.1,
    /** The supernumeraries' drops: smaller and nearly all one size (row 5). */
    superRadius: 0.25e-3,
    superSpread: 0.025,
    /** The air the low sun's light crosses at the sunset bow (row 4), in air masses. */
    sunsetAirMass: 16,
    /** The sun's (and the full moon's) angular radius, degrees: every optic is smeared by it. */
    sunRadius: 0.2665,
    /** The primary's red peak is 1; the others relative to it. */
    secondary: 0.43,
    fogbow: 0.35,
    glory: 1,
    /** The opposition glow under the glory: peak · exp(−θ / width°). */
    opposition: 0.6,
    oppositionWidth: 2.5,
});

/**
 * The share of the sun's light at a wavelength (m) left after `airMass` air masses: Rayleigh's
 * λ⁻⁴ (an optical depth of 0.097 at 550 nm) and a little haze (0.1 at 550 nm, λ⁻¹·³). A low sun
 * loses its blue first, then its green: the light of the sunset bow.
 * @param {number} lambda
 * @param {number} airMass
 */
export function sunTransmission(lambda, airMass) {
    const x = lambda / 550e-9;
    return Math.exp(-airMass * (0.097 * x ** -4.05 + 0.1 * x ** -1.3));
}

/**
 * The low sun's light through the spectrum as linear RGB, red 1 (what a white surface turns in
 * it): the colour the secondary bow is lit by when the primary reads the sunset row.
 * @param {number} [airMass]
 * @param {number[]} [out]
 */
export function sunsetLight(airMass = OPTICS.sunsetAirMass, out = [0, 0, 0]) {
    for (let c = 0; c < 3; c++) {
        out[c] = OPTICS_SPECTRUM.reduce((sum, b) => sum + b.w[c] * sunTransmission(b.lambda, airMass), 0);
    }
    const red = out[0] > 0 ? out[0] : 1;
    for (let c = 0; c < 3; c++) out[c] = Math.max(0, out[c] / red);
    return out;
}

/** The Fresnel-ish fall of a bow's bright side away from the bow: share kept at θ = 0 (A). */
const BOW_FLOOR = 0.45;
/** How the glory's rings are lifted against Bessel's 1/u decay (the rings carry the glory). */
const GLORY_LIFT = 0.45;

/**
 * Airy's function Ai(x): the power series near the origin, the asymptotic expansions beyond
 * (A&S 10.4.59/60). Good to ~1e-7 everywhere it is used.
 * @param {number} x
 */
export function airyAi(x) {
    if (x > 5) {
        const zeta = (2 / 3) * x ** 1.5;
        const s = 1 - 0.0694444 / zeta + 0.0371335 / zeta ** 2 - 0.037993 / zeta ** 3 + 0.057649 / zeta ** 4;
        return (Math.exp(-zeta) * s) / (2 * Math.sqrt(Math.PI) * x ** 0.25);
    }
    if (x < -7) {
        const y = -x;
        const zeta = (2 / 3) * y ** 1.5;
        const z2 = zeta * zeta;
        const p = 1 - 0.0371335 / z2 + 0.057649 / (z2 * z2);
        const q = 0.0694444 / zeta - 0.037993 / (z2 * zeta);
        const phase = zeta + Math.PI / 4;
        return (Math.sin(phase) * p - Math.cos(phase) * q) / (Math.sqrt(Math.PI) * y ** 0.25);
    }
    // Ai(x) = c1·f(x) − c2·g(x), f = Σ 3^k (1/3)_k x^3k / (3k)!, g = Σ 3^k (2/3)_k x^(3k+1) / (3k+1)!
    const x3 = x * x * x;
    let f = 1;
    let g = x;
    let tf = 1;
    let tg = x;
    for (let k = 0; k < 60; k++) {
        tf *= x3 / ((3 * k + 2) * (3 * k + 3));
        tg *= x3 / ((3 * k + 3) * (3 * k + 4));
        f += tf;
        g += tg;
        if (Math.abs(tf) + Math.abs(tg) < 1e-17 * (Math.abs(f) + Math.abs(g))) break;
    }
    return 0.355028053887817 * f - 0.258819403792807 * g;
}

/** Bessel J0 (rational and modulus-phase forms, ~1e-8). */
export function besselJ0(x) {
    const ax = Math.abs(x);
    if (ax < 8) {
        const y = x * x;
        const p = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7
            + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))));
        const q = 57568490411.0 + y * (1029532985.0 + y * (9494680.718
            + y * (59272.64853 + y * (267.8532712 + y))));
        return p / q;
    }
    const z = 8 / ax;
    const y = z * z;
    const xx = ax - 0.785398164;
    const p = 1 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
    const q = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5
        + y * (0.7621095161e-6 - y * 0.934935152e-7)));
    return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p - z * Math.sin(xx) * q);
}

/** Bessel J1 (rational and modulus-phase forms, ~1e-8). */
export function besselJ1(x) {
    const ax = Math.abs(x);
    if (ax < 8) {
        const y = x * x;
        const p = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1
            + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
        const q = 144725228442.0 + y * (2300535178.0 + y * (18583304.74
            + y * (99447.43394 + y * (376.9991397 + y))));
        return p / q;
    }
    const z = 8 / ax;
    const y = z * z;
    const xx = ax - 2.356194491;
    const p = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
    const q = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5
        + y * (-0.88228987e-6 + y * 0.105787412e-6)));
    const ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p - z * Math.sin(xx) * q);
    return x < 0 ? -ans : ans;
}

/**
 * The geometric bow of the rays that leave a drop after `k` internal reflections, for water of
 * index `n`: its angle from A (degrees: the primary's ~42°, the secondary's ~51°), and the
 * curvature of the deviation at the bow ray, which sets how fast the Airy pattern runs.
 * @param {number} n
 * @param {number} k 1 primary, 2 secondary
 */
export function bowRay(n, k) {
    const cos2 = (n * n - 1) / (k * (k + 2));
    const i = Math.acos(Math.sqrt(cos2));
    const sinI = Math.sin(i);
    const r = Math.asin(sinI / n);
    const cosR = Math.cos(r);
    // D(i) = 2(i − r) + k(π − 2r); at the bow D′ = 0 and D″ = −2(k + 1)·r″.
    const deviation = 2 * (i - r) + k * (Math.PI - 2 * r);
    const dr = Math.cos(i) / (n * cosR);
    const ddr = (-sinI * cosR + Math.cos(i) * Math.sin(r) * dr) / (n * cosR * cosR);
    return {
        theta: Math.abs(deviation - Math.PI) / DEG,
        curvature: -2 * (k + 1) * ddr,
        cos2,
    };
}

/** Airy's z per RADIAN away from the bow, for drops of radius `a` (m) in light of `lambda` (m). */
export function airyScale(n, k, a, lambda) {
    const { curvature, cos2 } = bowRay(n, k);
    return ((2 * Math.PI * a) / lambda) ** (2 / 3) * Math.cbrt((2 * cos2) / curvature);
}

// Ai² on a fine grid (lazily, once): the bows read it millions of times per bake. Far onto the
// bright side the fringes run faster than any spread of drop sizes, any band of colour or the
// sun's disc lets them survive, so there Ai² relaxes onto its own running mean 1/(2π√|z|): the
// first few fringes (the supernumeraries) are kept, the rest is the smooth geometric glow.
const AIRY_LO = -40; // beyond, the fringes have long since relaxed onto the mean
const AIRY_HI = 10;
const AIRY_STEP = 1 / 128;
/** How far onto the bright side (in z) the fringes keep their contrast. */
const AIRY_COHERENCE = 8;
let airyGrid = null;

/** The running mean of Ai²(z) on the bright side (z < 0). */
const airyMean = (z) => 1 / (2 * Math.PI * Math.sqrt(-z));

function airySquared(z) {
    const ai = airyAi(z);
    if (z >= 0) return ai * ai;
    const keep = Math.exp(-((z / AIRY_COHERENCE) ** 2));
    return airyMean(z) + (ai * ai - airyMean(z)) * keep;
}

function airyFast(z) {
    if (z >= AIRY_HI) return 0;
    if (z <= AIRY_LO) return airyMean(z);
    if (!airyGrid) {
        const n = Math.round((AIRY_HI - AIRY_LO) / AIRY_STEP) + 2;
        airyGrid = new Float64Array(n);
        for (let i = 0; i < n; i++) airyGrid[i] = airySquared(AIRY_LO + i * AIRY_STEP);
    }
    const x = (z - AIRY_LO) / AIRY_STEP;
    const i = Math.floor(x);
    const f = x - i;
    return airyGrid[i] + (airyGrid[i + 1] - airyGrid[i]) * f;
}

/**
 * Drop sizes over ±2.5σ of ln(radius) and their (Gaussian) weights: a wide spread gets more of
 * them, so neighbouring sizes never differ by more than a fraction of a fringe.
 */
function dropSizes(radius, spread) {
    const sizes = [];
    const half = spread > 0.15 ? 12 : 6;
    for (let j = -half; j <= half; j++) {
        const x = (j / half) * 2.5;
        sizes.push({ a: radius * Math.exp(spread * x), w: Math.exp(-0.5 * x * x) });
    }
    return sizes;
}

/** The sun's disc seen edge-on: a semicircle of weights over the fine grid, summing to 1. */
function sunKernel(step) {
    const half = Math.floor(OPTICS.sunRadius / step);
    const kernel = new Float64Array(2 * half + 1);
    let sum = 0;
    for (let j = -half; j <= half; j++) {
        const x = (j * step) / OPTICS.sunRadius;
        const w = Math.sqrt(Math.max(0, 1 - x * x));
        kernel[j + half] = w;
        sum += w;
    }
    for (let j = 0; j < kernel.length; j++) kernel[j] /= sum;
    return kernel;
}

/**
 * One row's light on a fine grid θ = 0..range (step degrees), RGB interleaved, smeared by the
 * sun. `fill(c, raw, half, step)` writes channel c's light into `raw`, where raw[j] is the angle
 * |j − half|·step (the pattern is round about A, so −θ ≡ θ).
 */
function fineRow(range, step, fill) {
    const kernel = sunKernel(step);
    const taps = kernel.length;
    const half = (taps - 1) / 2;
    const count = Math.round(range / step) + 1;
    const raw = new Float64Array(count + 2 * half);
    const out = new Float64Array(count * 3);
    for (let c = 0; c < 3; c++) {
        fill(c, raw, half, step);
        for (let j = 0; j < count; j++) {
            let sum = 0;
            for (let k = 0; k < taps; k++) sum += raw[j + k] * kernel[k];
            out[j * 3 + c] = sum;
        }
    }
    return out;
}

/**
 * A bow (k internal reflections) of drops `radius` ± `spread`: Ai² summed over the sizes, each
 * weighted a²·√K (cross-section, and Airy's peak growing as (a/λ)^(1/3)), so that far onto the
 * bright side every channel settles to the same geometric glow: a white sun gives a white
 * interior. `fall` dims the bright side toward A (θ = 0) for the primary-like rows. `light(λ)`
 * is the sun's light at each wavelength (1 everywhere unless given): a reddened sun is applied
 * wavelength by wavelength, so the bands where red and green overlap stay yellow while green and
 * blue die, which no tint of the finished colours can do.
 */
function bowFill(k, radius, spread, fall, light = null) {
    const sizes = dropSizes(radius, spread);
    const norm = sizes.reduce((sum, d) => sum + d.w * d.a * d.a, 0);
    const sign = k === 1 ? 1 : -1;
    const bands = OPTICS_SPECTRUM.map(({ lambda, n, w }) => {
        const scale = new Float64Array(sizes.length);
        const weight = new Float64Array(sizes.length);
        sizes.forEach((d, s) => {
            const K = airyScale(n, k, d.a, lambda);
            scale[s] = K * DEG * sign; // z per degree, the bright side negative
            weight[s] = (d.w * d.a * d.a * Math.sqrt(K)) / norm;
        });
        const sun = light ? light(lambda) : 1;
        return {
            theta: bowRay(n, k).theta, scale, weight, w: w.map((v) => v * sun),
        };
    });
    // Each wavelength's bow once (the three channels are weighted sums of the same curves).
    let curves = null;
    const build = (length, half, step) => {
        curves = bands.map(({ theta, scale, weight }) => {
            const out = new Float64Array(length);
            for (let j = 0; j < length; j++) {
                const t = Math.abs(j - half) * step;
                const d = t - theta;
                let sum = 0;
                for (let s = 0; s < scale.length; s++) sum += weight[s] * airyFast(scale[s] * d);
                if (fall && d < 0) sum *= BOW_FLOOR + (1 - BOW_FLOOR) * (t / theta) ** 1.5;
                out[j] = sum;
            }
            return out;
        });
    };
    return (c, raw, half, step) => {
        if (!curves || curves[0].length !== raw.length) build(raw.length, half, step);
        raw.fill(0);
        bands.forEach((band, b) => {
            const wc = band.w[c];
            const curve = curves[b];
            for (let j = 0; j < raw.length; j++) raw[j] += wc * curve[j];
        });
    };
}

/**
 * The glory: light coming straight back off cloud droplets from a ring round their rim, as
 * van de Hulst's |J0(u) ∓ J2(u)|² for the two polarisations (u = 2πa/λ · sin θ): a white
 * heart and rings spaced ∝ λ/a, blue inside red, washing out where the sizes disagree.
 */
function gloryFill() {
    const sizes = dropSizes(OPTICS.cloudRadius, OPTICS.cloudSpread);
    const wsum = sizes.reduce((sum, d) => sum + d.w, 0);
    const bands = OPTICS_BANDS.map(({ lambda }) => ({
        x: Float64Array.from(sizes, (d) => (2 * Math.PI * d.a) / lambda),
        w: Float64Array.from(sizes, (d) => d.w / wsum),
    }));
    return (c, raw, half, step) => {
        const { x, w } = bands[c];
        for (let j = 0; j < raw.length; j++) {
            const sinT = Math.sin(Math.abs(j - half) * step * DEG);
            let sum = 0;
            for (let s = 0; s < x.length; s++) {
                const u = x[s] * sinT;
                const j0 = besselJ0(u);
                const j2 = u < 1e-6 ? 0 : (2 * besselJ1(u)) / u - j0;
                sum += w[s] * (j0 * j0 + j2 * j2) * (1 + u / 2) ** GLORY_LIFT;
            }
            raw[j] = sum;
        }
    };
}

/** Scales a fine row so that `pick` (its peak, read over the row) becomes `peak`. */
function normalise(row, peak, pick) {
    let top = 0;
    for (let j = 0; j < row.length; j += 3) top = Math.max(top, pick(row, j));
    const k = top > 0 ? peak / top : 0;
    for (let j = 0; j < row.length; j++) row[j] *= k;
}

/** Multiplies a fine row by a function of θ (tapers that make the dark bands truly dark). */
function shape(row, step, fn) {
    for (let j = 0; j < row.length; j += 3) {
        const v = fn((j / 3) * step);
        row[j] *= v;
        row[j + 1] *= v;
        row[j + 2] *= v;
    }
}

const BOW_STEP = 0.02;
const GLORY_STEP = 0.02;
let fineOptics = null;

/** The rows on their fine grids (built once; every bake and opticsAt shares them). */
function opticsRows() {
    if (fineOptics) return fineOptics;
    const red = (row, j) => row[j];
    const peak = (row, j) => Math.max(row[j], row[j + 1], row[j + 2]);
    // Beyond the red edge only Alexander's dark band: nothing of the primary's light.
    const primaryEdge = (t) => 1 - smooth(43, 44.6, t);

    const primary = fineRow(60, BOW_STEP, bowFill(1, OPTICS.sprayRadius, OPTICS.spraySpread, true));
    shape(primary, BOW_STEP, primaryEdge);
    // The primary's unit (its red peak 1) is also the matched drops': the geometric glow far
    // inside a bow does not depend on the drops' size, so the two rows agree away from the bow.
    let top = 0;
    for (let j = 0; j < primary.length; j += 3) top = Math.max(top, primary[j]);
    const unit = top > 0 ? 1 / top : 0;
    for (let j = 0; j < primary.length; j++) primary[j] *= unit;

    // The supernumeraries: smaller, matched drops (a held chain's fine spray) ring pink and green
    // fringes just inside the primary's violet. Their own Airy colours, kept inside the bow only:
    // on the bow itself the row is the primary, so mixing toward it never doubles the band.
    const fine = fineRow(60, BOW_STEP, bowFill(1, OPTICS.superRadius, OPTICS.superSpread, true));
    shape(fine, BOW_STEP, primaryEdge);
    for (let j = 0; j < fine.length; j += 3) {
        const keep = smooth(40.3, 41.0, (j / 3) * BOW_STEP);
        for (let c = 0; c < 3; c++) fine[j + c] = fine[j + c] * unit * (1 - keep) + primary[j + c] * keep;
    }

    // The sunset bow: the same drops in the low sun's light, wavelength by wavelength.
    const lowSun = (lambda) => sunTransmission(lambda, OPTICS.sunsetAirMass);
    const sunset = fineRow(60, BOW_STEP, bowFill(1, OPTICS.sprayRadius, OPTICS.spraySpread, true, lowSun));
    shape(sunset, BOW_STEP, primaryEdge);
    normalise(sunset, 1, red);

    const secondary = fineRow(60, BOW_STEP, bowFill(2, OPTICS.sprayRadius, OPTICS.spraySpread, false));
    // Nothing inside its red edge; its outer brightening fades off before the table ends.
    shape(secondary, BOW_STEP, (t) => smooth(48.2, 49.8, t) * (1 - smooth(54, 59.5, t)));
    normalise(secondary, OPTICS.secondary, red);

    const fog = fineRow(60, BOW_STEP, bowFill(1, OPTICS.fogRadius, OPTICS.fogSpread, true));
    shape(fog, BOW_STEP, (t) => 1 - smooth(46, 55, t));
    normalise(fog, OPTICS.fogbow, peak);

    const glory = fineRow(25, GLORY_STEP, gloryFill());
    shape(glory, GLORY_STEP, (t) => 1 - smooth(7, 17, t));
    normalise(glory, OPTICS.glory, peak);
    for (let j = 0; j < glory.length; j += 3) {
        const opp = OPTICS.opposition * Math.exp(-((j / 3) * GLORY_STEP) / OPTICS.oppositionWidth);
        glory[j] += opp;
        glory[j + 1] += opp;
        glory[j + 2] += opp;
    }

    // Spectral colours outside sRGB come out a little negative in one channel: no negative light.
    [primary, secondary, fog, sunset, fine].forEach((row) => {
        for (let j = 0; j < row.length; j++) row[j] = Math.max(0, row[j]);
    });

    fineOptics = [
        { data: primary, step: BOW_STEP },
        { data: secondary, step: BOW_STEP },
        { data: fog, step: BOW_STEP },
        { data: glory, step: GLORY_STEP },
        { data: sunset, step: BOW_STEP },
        { data: fine, step: BOW_STEP },
    ];
    return fineOptics;
}

/** A fine row at an angle (linear between its samples), channel c. */
function fineAt(fine, c, thetaDeg) {
    const n = fine.data.length / 3;
    const x = clamp(thetaDeg / fine.step, 0, n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    const a = fine.data[i * 3 + c];
    return a + (fine.data[(i + 1) * 3 + c] - a) * f;
}

/**
 * The droplet-optics table: OPTICS_ROWS rows × `width` texels × RGBA, row-major (row r, texel i
 * at (r·width + i)·4). Texel i's centre is θ = range·(i + 0.5)/width, and it holds the mean of
 * the row's light over the texel's own span of θ. A = 1.
 * @param {number} [width]
 * @returns {Float32Array}
 */
export function bakeOpticsLut(width = OPTICS_WIDTH) {
    const w = Math.max(2, Math.floor(width));
    const rows = opticsRows();
    const out = new Float32Array(w * OPTICS_ROWS * 4);
    const SUB = 16;
    for (let r = 0; r < OPTICS_ROWS; r++) {
        const range = OPTICS_RANGE[r];
        const fine = rows[r];
        for (let i = 0; i < w; i++) {
            const at = (r * w + i) * 4;
            for (let c = 0; c < 3; c++) {
                let sum = 0;
                for (let s = 0; s < SUB; s++) sum += fineAt(fine, c, (range * (i + (s + 0.5) / SUB)) / w);
                out[at + c] = sum / SUB;
            }
            out[at + 3] = 1;
        }
    }
    return out;
}

let twinTable = null;

/**
 * The CPU twin of a texture sample: row `row` at θ degrees from A, linearly interpolated
 * between texel centres and clamped at the ends, exactly as the GPU's linear filter reads the
 * table. Reads the OPTICS_WIDTH table unless one is given.
 * @param {number} row 0..OPTICS_ROWS − 1
 * @param {number} thetaDeg
 * @param {number[]} [out]
 * @param {Float32Array} [table] a bakeOpticsLut result
 */
export function opticsAt(row, thetaDeg, out = [0, 0, 0], table = null) {
    let lut = table;
    if (!lut) {
        if (!twinTable) twinTable = bakeOpticsLut(OPTICS_WIDTH);
        lut = twinTable;
    }
    const w = lut.length / (4 * OPTICS_ROWS);
    const r = clamp(Math.floor(row), 0, OPTICS_ROWS - 1);
    const x = clamp((thetaDeg / OPTICS_RANGE[r]) * w - 0.5, 0, w - 1);
    const i = Math.min(w - 2, Math.floor(x));
    const f = x - i;
    const a = (r * w + i) * 4;
    const b = a + 4;
    out[0] = lut[a] + (lut[b] - lut[a]) * f;
    out[1] = lut[a + 1] + (lut[b + 1] - lut[a + 1]) * f;
    out[2] = lut[a + 2] + (lut[b + 2] - lut[a + 2]) * f;
    return out;
}

// ── Noise (baked once on the CPU; the shaders only ever sample it) ──────────────────────────

/**
 * A tileable value-noise fBm field, 0..1 (mean 0.5), `cellsX` × `cellsY` lattice cells at the
 * first octave (unequal counts stretch it: many rows and few columns lay strata, the other way
 * round hangs streaks), doubling per octave. Quintic fade, so its slope is continuous.
 */
function fbmField(size, rand, cellsX, cellsY, octaves, gain = 0.55) {
    const out = new Float32Array(size * size);
    const fx = new Float32Array(size);
    const x0s = new Int32Array(size);
    const x1s = new Int32Array(size);
    const blend = new Float32Array(size);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
        const cx = cellsX * 2 ** o;
        const cy = cellsY * 2 ** o;
        if (cx > size / 2 || cy > size / 2) break;
        const lattice = new Float32Array(cx * cy);
        for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
        for (let i = 0; i < size; i++) {
            const x = (i * cx) / size;
            const x0 = Math.floor(x);
            const f = x - x0;
            x0s[i] = x0;
            x1s[i] = (x0 + 1) % cx;
            fx[i] = f * f * f * (f * (f * 6 - 15) + 10);
        }
        for (let j = 0; j < size; j++) {
            const y = (j * cy) / size;
            const y0 = Math.floor(y);
            const fy = y - y0;
            const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
            const r0 = (y0 % cy) * cx;
            const r1 = ((y0 + 1) % cy) * cx;
            // This image row's cut through the lattice, blended down once per lattice column.
            for (let c = 0; c < cx; c++) blend[c] = lattice[r0 + c] + (lattice[r1 + c] - lattice[r0 + c]) * sy;
            const at = j * size;
            for (let i = 0; i < size; i++) {
                const a = blend[x0s[i]];
                out[at + i] += (a + (blend[x1s[i]] - a) * fx[i]) * amp;
            }
        }
        total += amp;
        amp *= gain;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
}

/**
 * Tileable Worley distances over `cells` × `cells` jittered points: F1 (to the nearest point)
 * and F2 (to the second nearest), in cell units. F2 − F1 is 0 on the walls between cells.
 * Walked cell by cell, so each cell's nine neighbours are gathered (and wrapped) once.
 */
function worleyField(size, rand, cells) {
    const px = new Float32Array(cells * cells);
    const py = new Float32Array(cells * cells);
    for (let i = 0; i < px.length; i++) {
        px[i] = 0.15 + 0.7 * rand();
        py[i] = 0.15 + 0.7 * rand();
    }
    const f1 = new Float32Array(size * size);
    const f2 = new Float32Array(size * size);
    const step = cells / size;
    const nx = new Float64Array(9);
    const ny = new Float64Array(9);
    for (let cy = 0; cy < cells; cy++) {
        const j0 = Math.ceil((cy * size) / cells - 1e-9);
        const j1 = Math.min(size, Math.ceil(((cy + 1) * size) / cells - 1e-9));
        for (let cx = 0; cx < cells; cx++) {
            const i0 = Math.ceil((cx * size) / cells - 1e-9);
            const i1 = Math.min(size, Math.ceil(((cx + 1) * size) / cells - 1e-9));
            let k = 0;
            for (let oy = -1; oy <= 1; oy++) {
                const row = ((cy + oy + cells) % cells) * cells;
                for (let ox = -1; ox <= 1; ox++) {
                    const at = row + ((cx + ox + cells) % cells);
                    nx[k] = cx + ox + px[at];
                    ny[k] = cy + oy + py[at];
                    k++;
                }
            }
            for (let j = j0; j < j1; j++) {
                const y = j * step;
                for (let i = i0; i < i1; i++) {
                    const x = i * step;
                    let d1 = 9;
                    let d2 = 9;
                    for (let q = 0; q < 9; q++) {
                        const dx = nx[q] - x;
                        const dy = ny[q] - y;
                        const d = dx * dx + dy * dy;
                        if (d < d1) {
                            d2 = d1;
                            d1 = d;
                        } else if (d < d2) d2 = d;
                    }
                    f1[j * size + i] = Math.sqrt(d1);
                    f2[j * size + i] = Math.sqrt(d2);
                }
            }
        }
    }
    return { f1, f2 };
}

/**
 * Brings a field to mean 0.5 and a fixed contrast (`spread` per standard deviation), so a
 * threshold in a shader means the same cover whatever the seed.
 */
function level(field, spread = 0.17) {
    let mean = 0;
    for (let i = 0; i < field.length; i++) mean += field[i];
    mean /= field.length;
    let variance = 0;
    for (let i = 0; i < field.length; i++) variance += (field[i] - mean) ** 2;
    const k = spread / Math.max(1e-6, Math.sqrt(variance / field.length));
    for (let i = 0; i < field.length; i++) field[i] = 0.5 + (field[i] - mean) * k;
    return field;
}

const toByte = (v) => Math.round(clamp01(v) * 255);

/** How soft the union of two cloud heads is (a polynomial smooth maximum, in a cap's heights). */
const SEA_SADDLE = 0.15;

/** A polynomial smooth maximum of a and b over a blend of width k. */
function smoothMax(a, b, k) {
    const h = clamp01(0.5 + (0.5 * (b - a)) / k);
    return a + (b - a) * h + k * h * (1 - h);
}

/**
 * The cloud sea's relief, as floats (RGBA, tileable), for a half-float texture:
 *   R  height 0..1: rounded cumulus heads, a union of spherical caps at three sizes (each head
 *      carries smaller heads on its shoulders, the cauliflower of real cloud tops), roughened
 *   G  dR/du, B  dR/dv: the slope, in height per tile (the normal without an 8-bit staircase)
 *   A  crease 0..1: how far a point lies below its neighbourhood (the shaded seams between heads)
 * @param {number} size
 * @param {number} [seed]
 */
export function bakeSeaField(size, seed = 51) {
    const n = Math.max(8, Math.floor(size));
    const rand = mulberry32(seed);
    // The coordinates are warped by two fBm fields first, so no head is a clean circle and the
    // heads gather into banks along the warp's currents.
    const warpX = fbmField(n, rand, 4, 4, 4, 0.5);
    const warpY = fbmField(n, rand, 4, 4, 4, 0.5);
    const rough = fbmField(n, rand, 16, 16, 4, 0.55);
    const octave = (cells, radius, warp) => {
        const px = new Float32Array(cells * cells);
        const py = new Float32Array(cells * cells);
        const pr = new Float32Array(cells * cells);
        for (let i = 0; i < px.length; i++) {
            px[i] = 0.1 + 0.8 * rand();
            py[i] = 0.1 + 0.8 * rand();
            // Each head its own size: some swell, some are small.
            pr[i] = radius * (0.65 + 0.6 * rand());
        }
        const out = new Float32Array(n * n);
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const at = j * n + i;
                const x = ((i + (warpX[at] - 0.5) * warp * n) / n) * cells;
                const y = ((j + (warpY[at] - 0.5) * warp * n) / n) * cells;
                const cx = Math.floor(x);
                const cy = Math.floor(y);
                let best = 0;
                for (let oy = -1; oy <= 1; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        const gx = cx + ox;
                        const gy = cy + oy;
                        const k = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
                        const dx = gx + px[k] - x;
                        const dy = gy + py[k] - y;
                        const q = (dx * dx + dy * dy) / (pr[k] * pr[k]);
                        // A spherical cap: the union of the heads, smoothed where two meet (vapour
                        // fills the saddle between two heads: never a V crease, which would alias
                        // into hatching across the middle distance).
                        // (The blend narrows to nothing at a cap's rim, so no rim ever steps.)
                        if (q < 1) {
                            const cap = Math.sqrt(1 - q) * (pr[k] / radius);
                            const soft = SEA_SADDLE * Math.min(1, cap / SEA_SADDLE, best / SEA_SADDLE);
                            best = soft > 1e-6 ? smoothMax(best, cap, soft) : Math.max(best, cap);
                        }
                    }
                }
                out[at] = best;
            }
        }
        return out;
    };
    const banks = octave(3, 0.95, 0.35);
    const big = octave(6, 0.8, 0.22);
    const mid = octave(13, 0.75, 0.12);
    const small = octave(27, 0.72, 0.06);
    const h = new Float32Array(n * n);
    for (let at = 0; at < n * n; at++) {
        // Heads summed on heads: rounded lumps on lumps, the billow of real cloud tops.
        const d = banks[at] * 0.46 + big[at] * 0.32 + mid[at] * 0.15 + small[at] * 0.07;
        h[at] = d + (rough[at] - 0.5) * 0.04;
    }
    level(h, 0.2);
    // The gaps between heads are seams, not pits.
    for (let at = 0; at < n * n; at++) h[at] = Math.max(h[at], 0.02 + h[at] * 0.15);
    // The crease: the height a little blurred, less the height (a separable box blur, wrapped).
    const R = Math.max(2, Math.round(n / 64));
    const across = new Float32Array(n * n);
    const blur = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            let sum = 0;
            for (let d = -R; d <= R; d += 1) sum += h[j * n + ((i + d + n) % n)];
            across[j * n + i] = sum / (2 * R + 1);
        }
    }
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            let sum = 0;
            for (let d = -R; d <= R; d += 1) sum += across[((j + d + n) % n) * n + i];
            blur[j * n + i] = sum / (2 * R + 1);
        }
    }
    const out = new Float32Array(n * n * 4);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const at = j * n + i;
            const east = h[j * n + ((i + 1) % n)];
            const west = h[j * n + ((i - 1 + n) % n)];
            const north = h[((j + 1) % n) * n + i];
            const south = h[((j - 1 + n) % n) * n + i];
            out[at * 4] = h[at];
            out[at * 4 + 1] = ((east - west) * n) / 2;
            out[at * 4 + 2] = ((north - south) * n) / 2;
            out[at * 4 + 3] = clamp01((blur[at] - h[at]) * 9 + 0.5);
        }
    }
    return out;
}

/**
 * The sky's noise, as bytes (RGBA8), tileable:
 *   R  broad fBm (where a cloud field is)
 *   G  billows: rounded cells at three sizes, roughened (the heads of altocumulus)
 *   B  a second, independent fBm (the shower's body, the Deep's shelves, the Milky Way's dust)
 *   A  fine fBm (the torn edge of everything)
 * @param {number} size
 * @param {number} [seed]
 */
export function bakeSkyNoise(size, seed = 33) {
    const n = Math.max(8, Math.floor(size));
    const rand = mulberry32(seed);
    const broad = level(fbmField(n, rand, 4, 4, 6));
    const second = level(fbmField(n, rand, 3, 3, 6));
    const fine = level(fbmField(n, rand, 16, 16, 4, 0.6));
    const c1 = worleyField(n, rand, 5).f1;
    const c2 = worleyField(n, rand, 11).f1;
    const c3 = worleyField(n, rand, 23).f1;
    // A rounded head per cell (1 at its heart, 0 at the seams), three sizes on each other.
    const heads = new Float32Array(n * n);
    for (let at = 0; at < n * n; at++) {
        heads[at] = (1 - c1[at]) * 0.56 + (1 - c2[at]) * 0.29 + (1 - c3[at]) * 0.15 + (fine[at] - 0.5) * 0.12;
    }
    level(heads, 0.2);
    const data = new Uint8Array(n * n * 4);
    for (let at = 0; at < n * n; at++) {
        data[at * 4] = toByte(broad[at]);
        data[at * 4 + 1] = toByte(heads[at]);
        data[at * 4 + 2] = toByte(second[at]);
        data[at * 4 + 3] = toByte(fine[at]);
    }
    return data;
}

/**
 * The stone's noise, as bytes (RGBA8), tileable:
 *   R  strata: fBm laid in horizontal beds, a little wavy (travertine and iron-stone alike)
 *   G  tafoni: the depth of honeycomb cups (Voronoi cells, deepest at a cell's heart, 0 on the
 *      thin walls between), two sizes
 *   B  the cups' rims: bright on the thin walls, where the wind leaves the stone hard
 *   A  drips: thin vertical streaks of white mineral that start and stop
 * @param {number} size
 * @param {number} [seed]
 */
export function bakeStoneNoise(size, seed = 7) {
    const n = Math.max(8, Math.floor(size));
    const rand = mulberry32(seed);
    const beds = level(fbmField(n, rand, 1, 12, 5, 0.5), 0.2);
    const wave = level(fbmField(n, rand, 4, 4, 4, 0.5), 0.17);
    const big = worleyField(n, rand, 7);
    const small = worleyField(n, rand, 17);
    const columns = fbmField(n, rand, 48, 2, 2, 0.45);
    const runs = fbmField(n, rand, 6, 3, 3, 0.5);
    const data = new Uint8Array(n * n * 4);
    for (let at = 0; at < n * n; at++) {
        const strata = beds[at] + (wave[at] - 0.5) * 0.35;
        const wallBig = big.f2[at] - big.f1[at];
        const wallSmall = small.f2[at] - small.f1[at];
        const cups = smooth(0.02, 0.42, wallBig) * 0.7 + smooth(0.02, 0.36, wallSmall) * 0.3;
        const rim = 1 - smooth(0.0, 0.09, wallBig);
        const streak = smooth(0.58, 0.8, columns[at]) * smooth(0.35, 0.65, runs[at]);
        data[at * 4] = toByte(strata);
        data[at * 4 + 1] = toByte(cups);
        data[at * 4 + 2] = toByte(rim);
        data[at * 4 + 3] = toByte(streak);
    }
    return data;
}

/**
 * One soft billowy puff of spray (RGBA8, `size`²): white, its alpha a round body eroded into
 * rounded lobes by billows and torn at the edge by fine noise; 0 on and beyond the inscribed
 * circle, so a billboard never shows its square.
 * @param {number} [size]
 */
export function bakePuff(size = 128) {
    const n = Math.max(8, Math.floor(size));
    const rand = mulberry32(4242);
    const lobes = worleyField(n, rand, 4).f1;
    const fine = fbmField(n, rand, 8, 8, 4, 0.55);
    const data = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const at = j * n + i;
            const x = ((i + 0.5) / n) * 2 - 1;
            const y = ((j + 0.5) / n) * 2 - 1;
            const r = Math.hypot(x, y);
            const body = 1 - smooth(0.25, 0.95, r + (0.5 - fine[at]) * 0.35);
            const billow = 0.6 + 0.4 * (1 - Math.min(1, lobes[at]));
            const alpha = body * billow * (1 - smooth(0.9, 1, r));
            data[at * 4] = 255;
            data[at * 4 + 1] = 255;
            data[at * 4 + 2] = 255;
            data[at * 4 + 3] = toByte(alpha);
        }
    }
    return data;
}
