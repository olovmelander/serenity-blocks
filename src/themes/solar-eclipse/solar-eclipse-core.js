/**
 * Solar Eclipse — the numbers of the scene (CPU only, three-free).
 *
 * The lens stands on a high ridge at the moment of totality and looks, through a long lens, over
 * range after range of mountains toward the eclipsed sun. Everything in the sky is a DIRECTION
 * (the dome is drawn round the lens), so the scene is a set of angles:
 *
 *   world      x east (right), y up, z south: the lens looks north (−Z) and a little upward.
 *   sun        the sun's own tangent plane: a point of the sky is (x, y) in SOLAR RADII from the
 *              sun's centre, x to the right and y up on the screen (gnomonic: tan of the angle
 *              off the sun's direction over tan of the sun's radius). The corona, the
 *              prominences, the moon and the beads are all drawn in it.
 *   solar      the same plane turned by the sun's axis (`axis`): y is solar north, so the
 *              streamer belt lies along x and the polar plumes stand on the y axis.
 *
 * The moon is a little larger than the sun (MOON.ratio) and wanders a little off its centre, so
 * a thin pink sliver of chromosphere creeps round the limb; when the board asks for the diamond
 * ring it slides off far enough for the photosphere to break through one lunar valley.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const WORLD = Object.freeze({
    /** The sun's angular radius as a share of the vertical field of view (a long lens). */
    sunShare: 0.088,
    /** Where the sun stands when the card leaves free space on its left (screen fractions). */
    sunScreenX: 0.2,
    sunScreenY: 0.36,
    /** Where the horizon sits on screen at rest (a fraction of the height from the top). */
    horizonY: 0.79,
    /** The radius everything in the sky is drawn at. */
    skyRadius: 4000,
});

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (t) => {
    const k = clamp01(t);
    return k * k * (3 - 2 * k);
};
/** Frame-rate independent ease factor: the share of the gap closed in `dt` at `rate` per second. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt));
/** An angle folded into (−π, π]. */
export const wrapAngle = (a) => a - TAU * Math.round(a / TAU);

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

/** A CSS hex colour → linear RGB in `out` (three numbers). Returns false if it is not a hex. */
export function hexToLinear(hex, out) {
    if (typeof hex !== 'string') return false;
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return false;
    const v = Number.parseInt(m[1], 16);
    for (let i = 0; i < 3; i += 1) {
        const c = ((v >> (16 - i * 8)) & 255) / 255;
        out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    return true;
}

/** A direction at world azimuth `az` (radians east of north) and altitude `alt`, into `out`. */
export function horizontal(az, alt, out = [0, 0, 0]) {
    const ca = Math.cos(alt);
    out[0] = Math.sin(az) * ca;
    out[1] = Math.sin(alt);
    out[2] = -Math.cos(az) * ca;
    return out;
}

/**
 * The sun's frame: its direction and the two unit vectors across it, `right` (level, to the
 * right on the screen) and `up` (toward the zenith).
 */
export function sunFrame(az, alt, out = {}) {
    const d = horizontal(az, alt, out.dir || (out.dir = [0, 0, 0]));
    const right = out.right || (out.right = [0, 0, 0]);
    const up = out.up || (out.up = [0, 0, 0]);
    // right = d × y, normalised; up = right × d.
    let rx = -d[2];
    let rz = d[0];
    const rn = Math.hypot(rx, rz) || 1;
    rx /= rn;
    rz /= rn;
    right[0] = rx;
    right[1] = 0;
    right[2] = rz;
    up[0] = -rz * d[1];
    up[1] = rz * d[0] - rx * d[2];
    up[2] = rx * d[1];
    return out;
}

/**
 * A point of the sun's plane (x, y in solar radii) → its world direction (unit), into `out`.
 * `tanR` is the tangent of the sun's angular radius.
 */
export function sunPlaneToWorld(frame, tanR, x, y, out = [0, 0, 0]) {
    let n = 0;
    for (let i = 0; i < 3; i += 1) {
        out[i] = frame.dir[i] + (frame.right[i] * x + frame.up[i] * y) * tanR;
        n += out[i] * out[i];
    }
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < 3; i += 1) out[i] /= n;
    return out;
}

/** A world direction → the sun's plane (solar radii), into `out` ([x, y, front]). */
export function worldToSunPlane(frame, tanR, d, out = [0, 0, 0]) {
    const f = d[0] * frame.dir[0] + d[1] * frame.dir[1] + d[2] * frame.dir[2];
    const safe = Math.max(f, 1e-4);
    out[0] = (d[0] * frame.right[0] + d[1] * frame.right[1] + d[2] * frame.right[2]) / safe / tanR;
    out[1] = (d[0] * frame.up[0] + d[1] * frame.up[1] + d[2] * frame.up[2]) / safe / tanR;
    out[2] = f > 0 ? 1 : 0;
    return out;
}

// ── The noise the corona, the ranges and the prominences are cut from ────────────

export const NOISE_SIZE = 256;

/**
 * Four periodic fBm gradient-noise fields, one per channel, each stretched to 0..1. R starts at
 * four cells a tile, G at eight, B at sixteen, A at thirty-two (the finest grain).
 * @returns {Uint8Array} size × size × 4
 */
export function bakeNoise(seed = 2017, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const data = new Uint8Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    const first = [4, 8, 16, 32];
    for (let c = 0; c < 4; c += 1) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o += 1) {
            const period = first[c] << o;
            if (period > n / 2) break;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i += 1) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y += 1) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x += 1) {
                    const fx = x * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const x1 = (x0 + 1) % period;
                    const sx = fade(tx);
                    const i00 = y0 * period + x0;
                    const i10 = y0 * period + x1;
                    const i01 = y1 * period + x0;
                    const i11 = y1 * period + x1;
                    const d00 = gx[i00] * tx + gy[i00] * ty;
                    const d10 = gx[i10] * (tx - 1) + gy[i10] * ty;
                    const d01 = gx[i01] * tx + gy[i01] * (ty - 1);
                    const d11 = gx[i11] * (tx - 1) + gy[i11] * (ty - 1);
                    const top = d00 + (d10 - d00) * sx;
                    const bottom = d01 + (d11 - d01) * sx;
                    field[y * n + x] += (top + (bottom - top) * sy) * amp;
                }
            }
            amp *= 0.5;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i += 1) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 255 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i += 1) data[i * 4 + c] = Math.round((field[i] - lo) * inv);
    }
    return data;
}

// ── The ranges ───────────────────────────────────────────────────────────────────

/**
 * The mountain ranges between the lens and the horizon, farthest first. Each is a crest line:
 * its altitude (radians, seen from the lens) as a function of azimuth.
 *
 *   distance  km, for the haze between it and the lens
 *   base      the crest's lowest altitude; `amp` how far its peaks rise above that
 *   cells     noise cells per radian of azimuth (larger = narrower peaks)
 *   sharp     how pointed the peaks are (the ridged noise's exponent)
 *
 * The farthest range stands outside the moon's shadow: it is still in sunlight, and glows.
 */
export const RANGES = Object.freeze([
    Object.freeze({
        name: 'sunlit', distance: 140, base: 0.0035, amp: 0.034, cells: 9, sharp: 2.2, seed: 11,
    }),
    Object.freeze({
        name: 'far', distance: 70, base: -0.0005, amp: 0.02, cells: 11, sharp: 1.8, seed: 23,
    }),
    Object.freeze({
        name: 'middle', distance: 32, base: -0.0075, amp: 0.019, cells: 8, sharp: 1.5, seed: 37,
    }),
    Object.freeze({
        name: 'valley', distance: 14, base: -0.017, amp: 0.018, cells: 6.5, sharp: 1.4, seed: 51,
    }),
    Object.freeze({
        name: 'spur', distance: 5, base: -0.034, amp: 0.024, cells: 5, sharp: 1.25, seed: 67,
    }),
    Object.freeze({
        name: 'near', distance: 1.1, base: -0.07, amp: 0.036, cells: 3.4, sharp: 1.1, seed: 83,
    }),
]);

/** The azimuths the crest table covers (radians either side of north) and its resolution. */
export const RIDGE_SPAN = 100 * DEG;
export const RIDGE_SAMPLES = 2048;

/** 1D gradient noise, periodic in `period` cells: −~0.5..~0.5. */
function gradient1D(grads, x) {
    const n = grads.length;
    const i0 = Math.floor(x);
    const t = x - i0;
    const a = grads[((i0 % n) + n) % n] * t;
    const b = grads[(((i0 + 1) % n) + n) % n] * (t - 1);
    const s = t * t * t * (t * (t * 6 - 15) + 10);
    return a + (b - a) * s;
}

/**
 * Every range's crest, sampled across RIDGE_SPAN either side of north: `crests[layer]` is a
 * Float32Array of RIDGE_SAMPLES altitudes (radians). `slopes[layer]` holds d(altitude)/d(azimuth)
 * per sample, which the shader reads to light the sunlit range's faces.
 */
export function bakeRanges(samples = RIDGE_SAMPLES) {
    const crests = [];
    const slopes = [];
    for (let layer = 0; layer < RANGES.length; layer += 1) {
        const range = RANGES[layer];
        const rand = mulberry32(9000 + range.seed * 131);
        // A slow envelope gathers the peaks into massifs and lets the crest sag between them.
        const envelope = new Float32Array(64);
        for (let i = 0; i < envelope.length; i += 1) envelope[i] = rand() * 2 - 1;
        const octaves = [];
        for (let o = 0; o < 5; o += 1) {
            const grads = new Float32Array(512);
            for (let i = 0; i < grads.length; i += 1) grads[i] = rand() * 2 - 1;
            octaves.push(grads);
        }
        const crest = new Float32Array(samples);
        for (let i = 0; i < samples; i += 1) {
            const az = ((i / (samples - 1)) * 2 - 1) * RIDGE_SPAN;
            let x = az * range.cells + range.seed * 3.7;
            let amp = 1;
            let sum = 0;
            let norm = 0;
            for (let o = 0; o < octaves.length; o += 1) {
                // Ridged: sharp crests where the noise crosses zero.
                const r = 1 - Math.abs(gradient1D(octaves[o], x) * 2.2);
                sum += Math.max(0, r) ** range.sharp * amp;
                norm += amp;
                amp *= o === 0 ? 0.5 : 0.42;
                x *= 2.13;
            }
            const h = sum / norm;
            const massif = clamp01(0.5 + gradient1D(envelope, az * 2.4 + range.seed) * 1.6);
            crest[i] = range.base + range.amp * h * h * 1.35 * (0.38 + 0.62 * massif);
        }
        const slope = new Float32Array(samples);
        const daz = (2 * RIDGE_SPAN) / (samples - 1);
        for (let i = 0; i < samples; i += 1) {
            const a = crest[Math.max(0, i - 1)];
            const b = crest[Math.min(samples - 1, i + 1)];
            slope[i] = (b - a) / (daz * (i > 0 && i < samples - 1 ? 2 : 1));
        }
        crests.push(crest);
        slopes.push(slope);
    }
    return { crests, slopes, samples };
}

/** A range's crest altitude at azimuth `az` (radians), read the way the shader reads it. */
export function crestAt(ranges, layer, az) {
    const table = ranges.crests[layer];
    const n = table.length;
    const f = clamp((az / RIDGE_SPAN + 1) * 0.5, 0, 1) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const t = f - i;
    return table[i] + (table[i + 1] - table[i]) * t;
}

/** The highest any crest reaches between two azimuths (radians). */
export function highestCrest(ranges, azFrom, azTo) {
    let best = -Infinity;
    const steps = 64;
    for (let layer = 0; layer < RANGES.length; layer += 1) {
        for (let s = 0; s <= steps; s += 1) {
            best = Math.max(best, crestAt(ranges, layer, lerp(azFrom, azTo, s / steps)));
        }
    }
    return best;
}

// ── The corona ───────────────────────────────────────────────────────────────────

/**
 * The corona's shape. Inside the source surface (`sourceSurface` solar radii) the field is a
 * dipole about the solar axis: a point at radius r and latitude λ lies on the field line whose
 * foot is at latitude acos(cos λ / √r). Lines whose feet lie below `cuspLatitude` close again
 * (the helmet arches of the streamer belt); the rest open, and above the source surface every
 * line runs straight out. The shader reads the same numbers.
 */
export const CORONA = Object.freeze({
    sourceSurface: 2.5,
    /** The last closed line's foot: acos(1/√2.5). */
    cuspLatitude: Math.acos(1 / Math.sqrt(2.5)),
    /** The K corona: bright inner term, slow outer term (relative brightness at the limb). */
    inner: 1.55,
    innerPower: 6.0,
    outer: 0.3,
    outerPower: 2.35,
    /** How much further a long exposure (a chain) carries the outer corona. */
    exposureGain: 2.4,
    /** The sun's axis on the sky: its resting tilt and how far it sways with the clock. */
    axis: 18 * DEG,
    axisSway: 9 * DEG,
    axisSeconds: 260,
});

/** Active-region streamers that rise one by one as the cycle climbs toward maximum. */
export const STREAMERS = 10;

/**
 * The extra streamers, seeded: (position angle off the solar equator, base half-width radians,
 * the cycle at which it appears, brightness).
 */
export const STREAMER_SET = Object.freeze((() => {
    const rand = mulberry32(1919);
    const set = [];
    for (let i = 0; i < STREAMERS; i += 1) {
        // Spread round the disc, with a lean toward the active latitudes.
        const side = i % 2 === 0 ? 1 : -1;
        const lat = side * (0.25 + rand() * 0.95);
        const east = rand() < 0.5 ? 0 : Math.PI;
        set.push(Object.freeze({
            angle: wrapAngle(east + (east === 0 ? lat : -lat)),
            width: 0.16 + rand() * 0.2,
            appears: 0.08 + (i / STREAMERS) * 0.82 + rand() * 0.06,
            power: 0.55 + rand() * 0.6,
        }));
    }
    return set;
})());

/**
 * How strongly each extra streamer stands at cycle `cycle` (0 = solar minimum, 1 = maximum),
 * written into `out` (STREAMERS numbers).
 */
export function streamersAt(cycle, out = new Float32Array(STREAMERS)) {
    for (let i = 0; i < STREAMERS; i += 1) {
        const s = STREAMER_SET[i];
        out[i] = smooth01((cycle - s.appears) / 0.18 + 0.5) * s.power;
    }
    return out;
}

/** The solar axis on the sky at time `t` (radians from the screen's vertical, + = leaning left). */
export function axisAt(t) {
    return CORONA.axis + CORONA.axisSway * Math.sin((t / CORONA.axisSeconds) * TAU);
}

// ── The moon ─────────────────────────────────────────────────────────────────────

export const MOON = Object.freeze({
    /** The moon's radius over the sun's: it covers the photosphere and most of the chromosphere. */
    ratio: 1.02,
    /** Its resting wander off the sun's centre (solar radii) and the wander's two periods. */
    wander: 0.0095,
    wanderA: 83,
    wanderB: 131,
    /** How far it slides off for the diamond ring (beyond 1 − ratio + the deepest valley). */
    diamond: 0.034,
    /** The deepest lunar valley along the limb (solar radii): where Baily's beads break through. */
    valley: 0.0045,
    /** The chromosphere's thickness above the photosphere, and how far a flash lifts it. */
    chromosphere: 0.022,
    flashLift: 0.03,
});

/** The moon's resting offset from the sun's centre at time `t`, into `out` (solar radii). */
export function moonWander(t, out = [0, 0]) {
    const a = (t / MOON.wanderA) * TAU;
    const b = (t / MOON.wanderB) * TAU + 1.3;
    out[0] = MOON.wander * (Math.cos(a) * 0.8 + Math.sin(b) * 0.2);
    out[1] = MOON.wander * (Math.sin(a) * 0.75 + Math.cos(b * 0.7) * 0.25);
    // Never farther than its bound: the photosphere stays covered at rest.
    const k = Math.min(1, MOON.wander / Math.max(1e-9, Math.hypot(out[0], out[1])));
    out[0] *= k;
    out[1] *= k;
    return out;
}

// ── The sky's bright points ──────────────────────────────────────────────────────

/**
 * The planets and bright stars that come out at totality, placed off the sun in degrees of the
 * sun's own frame (x right, y up): (x, y, brightness, colour temperature 0 warm … 1 blue).
 */
export const BRIGHT_POINTS = Object.freeze([
    Object.freeze([31, 9.5, 5.0, 0.62]), // Venus
    Object.freeze([-19, 15, 2.1, 0.5]), // Jupiter
    Object.freeze([7.4, -3.2, 0.9, 0.35]), // Mercury, in the outer corona
    Object.freeze([4.2, 5.8, 0.55, 0.85]), // Regulus
    Object.freeze([-33, -2.5, 0.7, 0.2]), // Mars
    Object.freeze([46, 21, 0.75, 0.9]),
    Object.freeze([-41, 24, 0.6, 0.7]),
    Object.freeze([20, 27, 0.5, 0.25]),
]);

// ── The light of the hour ────────────────────────────────────────────────────────

/**
 * The light at totality, one palette per step of the wheel. Scene-linear colours authored
 * through the post's tone map. They stand in hue order round the wheel (ember → gold → jade →
 * azure → violet → rose → ember), and their glow and band are staggered by a family, so two
 * neighbours never mix through grey.
 *
 * zenith, mid       the dark air overhead and a third of the way up
 * horizon           the band of light low in the sky, from beyond the moon's shadow
 * glow              the bright rim right at the horizon
 * haze              the mist in the valleys between the ranges
 * ridge             the near ranges, in the shadow
 * alpen             the farthest range, still in sunlight
 * coronaIn/Out      the corona's colour near the limb and far out
 * chromo            the chromosphere and the colourless prominences' pink
 * earth             earthshine on the moon's face
 * glowHeight        how high the horizon's glow reaches (radians of altitude)
 * starPower         how brightly the planets and stars show
 * cycle             where the solar cycle stands (0 minimum: long equatorial wings, polar plumes;
 *                   1 maximum: a round crown of streamers)
 * alpenPower        how strongly the sunlit range glows
 */
export const PALETTE_KEYS = Object.freeze([
    'zenith', 'mid', 'horizon', 'glow', 'haze', 'ridge', 'alpen', 'coronaIn', 'coronaOut', 'chromo', 'earth',
]);
export const PALETTE_SCALARS = Object.freeze(['glowHeight', 'starPower', 'cycle', 'alpenPower']);

export const PALETTES = Object.freeze([
    Object.freeze({
        name: 'ember',
        zenith: [0.0035, 0.006, 0.02],
        mid: [0.013, 0.014, 0.04],
        horizon: [0.075, 0.032, 0.052],
        glow: [0.5, 0.2, 0.055],
        haze: [0.13, 0.058, 0.048],
        ridge: [0.0045, 0.005, 0.011],
        alpen: [0.64, 0.28, 0.11],
        coronaIn: [1.0, 0.93, 0.82],
        coronaOut: [0.84, 0.88, 1.0],
        chromo: [1.0, 0.16, 0.3],
        earth: [0.45, 0.55, 0.8],
        glowHeight: 0.035,
        starPower: 1.0,
        cycle: 0.12,
        alpenPower: 1.0,
    }),
    Object.freeze({
        name: 'gold',
        zenith: [0.003, 0.008, 0.02],
        mid: [0.01, 0.02, 0.036],
        horizon: [0.08, 0.05, 0.03],
        glow: [0.52, 0.32, 0.07],
        haze: [0.13, 0.085, 0.04],
        ridge: [0.005, 0.0055, 0.01],
        alpen: [0.68, 0.42, 0.14],
        coronaIn: [1.0, 0.95, 0.8],
        coronaOut: [0.9, 0.92, 1.0],
        chromo: [1.0, 0.2, 0.26],
        earth: [0.5, 0.58, 0.75],
        glowHeight: 0.04,
        starPower: 0.9,
        cycle: 0.38,
        alpenPower: 1.05,
    }),
    Object.freeze({
        name: 'jade',
        zenith: [0.002, 0.008, 0.016],
        mid: [0.006, 0.02, 0.028],
        horizon: [0.04, 0.08, 0.032],
        glow: [0.36, 0.37, 0.13],
        haze: [0.06, 0.1, 0.075],
        ridge: [0.003, 0.006, 0.009],
        alpen: [0.52, 0.43, 0.24],
        coronaIn: [0.95, 1.0, 0.9],
        coronaOut: [0.78, 0.95, 1.0],
        chromo: [1.0, 0.22, 0.42],
        earth: [0.4, 0.6, 0.7],
        glowHeight: 0.045,
        starPower: 1.05,
        cycle: 0.72,
        alpenPower: 0.85,
    }),
    Object.freeze({
        name: 'azure',
        zenith: [0.002, 0.005, 0.024],
        mid: [0.006, 0.014, 0.05],
        horizon: [0.04, 0.07, 0.12],
        glow: [0.3, 0.36, 0.42],
        haze: [0.07, 0.09, 0.13],
        ridge: [0.003, 0.005, 0.013],
        alpen: [0.54, 0.41, 0.42],
        coronaIn: [0.94, 0.97, 1.0],
        coronaOut: [0.75, 0.86, 1.0],
        chromo: [1.0, 0.2, 0.4],
        earth: [0.4, 0.55, 0.9],
        glowHeight: 0.05,
        starPower: 1.15,
        cycle: 0.95,
        alpenPower: 0.8,
    }),
    Object.freeze({
        name: 'violet',
        zenith: [0.005, 0.003, 0.022],
        mid: [0.018, 0.01, 0.05],
        horizon: [0.09, 0.04, 0.12],
        glow: [0.45, 0.2, 0.34],
        haze: [0.1, 0.05, 0.11],
        ridge: [0.006, 0.004, 0.013],
        alpen: [0.62, 0.3, 0.42],
        coronaIn: [1.0, 0.93, 0.95],
        coronaOut: [0.88, 0.84, 1.0],
        chromo: [1.0, 0.16, 0.46],
        earth: [0.5, 0.5, 0.85],
        glowHeight: 0.04,
        starPower: 1.1,
        cycle: 0.6,
        alpenPower: 0.95,
    }),
    Object.freeze({
        name: 'rose',
        zenith: [0.005, 0.003, 0.014],
        mid: [0.022, 0.009, 0.034],
        horizon: [0.12, 0.04, 0.07],
        glow: [0.57, 0.2, 0.17],
        haze: [0.14, 0.05, 0.07],
        ridge: [0.006, 0.0035, 0.009],
        alpen: [0.72, 0.28, 0.26],
        coronaIn: [1.0, 0.92, 0.88],
        coronaOut: [0.92, 0.86, 1.0],
        chromo: [1.0, 0.14, 0.34],
        earth: [0.5, 0.5, 0.75],
        glowHeight: 0.035,
        starPower: 1.0,
        cycle: 0.3,
        alpenPower: 1.05,
    }),
]);

/**
 * The clock alone carries the light one palette on in this many seconds, whatever the level: a
 * level-up is a step added on top (solar-eclipse-world.js: wheel = clock / HOUR_SECONDS +
 * level − 1), never the only thing that moves it.
 */
export const HOUR_SECONDS = 100;
/**
 * The share of a step the light rests on a palette before it leaves, and again when it reaches
 * the next. Small on purpose: for the other 70 % of every step the light is visibly on its way.
 */
export const HOUR_REST = 0.15;

/**
 * The light at wheel position `wheel` (one unit per palette, wraps): a short rest, a long slow
 * turn into the next, a short rest there. Writes every colour (arrays of three) and scalar into
 * `out` and returns it.
 */
export function paletteAt(wheel, out = {}) {
    const n = PALETTES.length;
    const w = ((wheel % n) + n) % n;
    const i = Math.floor(w) % n;
    const f = w - Math.floor(w);
    const k = smooth01((f - HOUR_REST) / (1 - 2 * HOUR_REST));
    const a = PALETTES[i];
    const b = PALETTES[(i + 1) % n];
    for (let c = 0; c < PALETTE_KEYS.length; c += 1) {
        const key = PALETTE_KEYS[c];
        const dst = out[key] || (out[key] = [0, 0, 0]);
        for (let j = 0; j < 3; j += 1) dst[j] = lerp(a[key][j], b[key][j], k);
    }
    for (let c = 0; c < PALETTE_SCALARS.length; c += 1) {
        const key = PALETTE_SCALARS[c];
        out[key] = lerp(a[key], b[key], k);
    }
    out.index = i;
    out.turn = k;
    return out;
}

// ── The chain ────────────────────────────────────────────────────────────────────

/** How long the exposure is for a chain of `combo` clears: 0 at rest, toward 1. */
export function exposureFor(combo) {
    const n = Math.max(0, (combo || 0) - 1);
    // A slow start: two clears in a row reach a little further, eight reach the whole corona.
    return 1 - Math.exp(-((n / 4) ** 1.4));
}

// ── The board on the limb ────────────────────────────────────────────────────────

/**
 * Where on the limb a lock grows its prominence: the board laid over the top of the sun, left
 * column on the left limb, right column on the right (position angle, radians from the screen's
 * right, anticlockwise). A little beyond the horizontal at both ends, so ten columns spread over
 * 200°.
 */
export const LIMB_FROM = Math.PI + 10 * DEG;
export const LIMB_TO = -10 * DEG;

export function limbAngleFor(u) {
    return lerp(LIMB_FROM, LIMB_TO, clamp01(Number.isFinite(u) ? u : 0.5));
}

// ── The prominences ──────────────────────────────────────────────────────────────

/** Prominences the limb holds at once (a lock takes the oldest slot when all are held). */
export const PROMINENCES = 12;
/** Seconds a prominence stands before it fades by itself, and the fade. */
export const PROMINENCE_LIFE = 34;
export const PROMINENCE_FADE = 3;
/** Seconds a prominence takes to rise, and an eruption to clear the frame. */
export const PROMINENCE_RISE = 0.85;
export const ERUPTION_SECONDS = 3.6;
/** Prominence kinds: an arch of plasma, a ragged hedgerow, a jet (a clear with none held). */
export const KIND = Object.freeze({ arch: 0, hedge: 1, jet: 2 });

/**
 * A new prominence's shape from a seed in 0..1: half-width along the limb (radians), height
 * (solar radii) and kind. A hard drop raises a taller, wider arch.
 */
export function prominenceShape(seed, hard = false, out = {}) {
    const s = clamp01(seed);
    const arch = hard || s < 0.5;
    out.kind = arch ? KIND.arch : KIND.hedge;
    out.halfWidth = arch ? 0.12 + s * 0.3 : 0.16 + (s - 0.5) * 0.36;
    out.height = arch ? 0.3 + s * 0.6 : 0.2 + (s - 0.5) * 0.4;
    if (hard) {
        out.halfWidth *= 1.25;
        out.height *= 1.4;
    }
    return out;
}
