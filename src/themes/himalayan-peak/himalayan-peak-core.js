/**
 * Himalayan Peak — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the massif generator, the layout, the director and their tests import only this.
 *
 * The amphitheatre (metres, y up, y = 0 is the top of the cloud sea): the viewer stands on a high
 * pass at the origin and looks down −Z. The hero peak stands far left with its east face turned to
 * the light; the sun climbs behind the headwall on the right; a sea of cloud fills the basin
 * between. The wind blows from the left (+X is downwind).
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The baked heightfield: a square grid over [x0, x0 + span] × [z0, z0 + span]. */
export const GRID = Object.freeze({
    size: 1024,
    x0: -7500,
    z0: -14000,
    span: 15000,
});
export const GRID_CELL = GRID.span / (GRID.size - 1);

/** Heights are stored as 16 bits over this range (metres). */
export const HEIGHT_RANGE = Object.freeze({ min: -700, max: 3700 });

/** Where the viewer stands (the snow under their boots is EYE_HEIGHT lower). */
export const EYE = Object.freeze({ x: 0, y: 342, z: 0 });
export const EYE_HEIGHT = 1.7;

/** The rest camera: a slight upward tilt, a held horizontal field of view. */
export const REST_RIG = Object.freeze({
    pitch: 6.2 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 76,
    minFov: 40,
    maxFov: 72,
    near: 1.0,
    far: 60000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/**
 * Upright screens are too narrow to hold the hero peak and the sun together: the whole world is
 * drawn this much narrower about the view axis there (1 in landscape). Rays through the eye stay
 * rays, so nothing that was hidden comes into view and the light keeps its geometry.
 */
export function squeezeForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const half = Math.atan(Math.tan((fovForAspect(a) * DEG) / 2) * a);
    const wanted = Math.tan(33 * DEG);
    return Math.max(0.42, Math.min(1, Math.tan(half) / wanted));
}

// ── The sun ─────────────────────────────────────────────────────────────────────

/** The sun stands this far right of the view axis, behind the headwall. */
export const SUN_AZIMUTH = 30 * DEG;
/**
 * Its elevation is the theme's one dial: at rest it is below the headwall and only the hero's
 * summit is lit; a chain of clears raises it until it stands clear of the col and the light has
 * come down the whole face; four lines throw it higher still for a moment.
 */
export const SUN_ELEVATION = Object.freeze({
    rest: -7 * DEG,
    full: 15 * DEG,
    /** What four lines throw it up by: enough to clear the col from rest. */
    surge: 15 * DEG,
    /** It never climbs out of the frame. */
    max: 22.5 * DEG,
    /** What one clear of n lines lifts it by (it settles back). */
    clear: [0, 2.6 * DEG, 4.2 * DEG, 6.2 * DEG, 9 * DEG],
});

/** tan(elevation) of the four baked slices of the shadow in the air. */
export const SHADOW_TAN = Object.freeze([-0.14, 0.06, 0.26, 0.46]);

/** Unit vector toward the sun for an elevation (radians). */
export function sunDirection(elevation, out = [0, 0, 0]) {
    const c = Math.cos(elevation);
    out[0] = Math.sin(SUN_AZIMUTH) * c;
    out[1] = Math.sin(elevation);
    out[2] = -Math.cos(SUN_AZIMUTH) * c;
    return out;
}

/** Weights of the four shadow slices for tan(elevation): two neighbours, summing to one. */
export function shadowWeights(tanElevation, out = [0, 0, 0, 0]) {
    const t = Math.max(SHADOW_TAN[0], Math.min(SHADOW_TAN[3], tanElevation));
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
    for (let i = 0; i < 3; i++) {
        if (t <= SHADOW_TAN[i + 1] || i === 2) {
            const k = (t - SHADOW_TAN[i]) / (SHADOW_TAN[i + 1] - SHADOW_TAN[i]);
            out[i] = 1 - k;
            out[i + 1] = k;
            break;
        }
    }
    return out;
}

// ── Gameplay slots and timings ──────────────────────────────────────────────────

/** Powder rings on the pass's snow evaluated by its material. */
export const RING_SLOTS = 4;
export const RING_REACH = 11;
export const RING_TAU = 0.5;
export const RING_FADE = 1.25;

/** Gusts running along the flag lines at once. */
export const GUST_SLOTS = 6;
/** Metres per second a gust front runs along a line, and how long its flutter lasts. */
export const GUST_SPEED = 26;
export const GUST_FADE = 0.9;
/** Seconds a gust takes to fill a flag once its front is there: cloth has weight. */
export const GUST_RISE = 0.14;

/** How hard a gust pulls a flag `since` seconds after its front reached it (per unit of strength). */
export function gustPull(since) {
    if (!(since > 0)) return 0;
    return (1 - Math.exp(-since / GUST_RISE)) * Math.exp(-since / GUST_FADE);
}

/** The wind's strength (`gale`) at rest; the chain, a storm and a surge add to it. */
export const GALE_REST = 0.25;
/** Per second: how fast the air closes on the wind the game asks for. Nothing in it jumps. */
export const GALE_EASE = 5;

/**
 * The pace of the flags' ripple (radians per second): in the resting wind, what each unit of
 * gale adds, and the most it ever runs at. A gust or a chain lifts the cloth and widens its
 * folds; it must not beat faster, or a run of clears turns the lines into a blur.
 */
export const FLAG_PACE = Object.freeze({ rest: 7.25, gale: 1.6, most: 9.4 });
/** The ripple's second wave runs this many times faster than the first. */
export const FLAG_SECOND = 1.7;
/** The ripple's phase is kept under this: both waves come round whole in it (10 and 17 turns). */
export const FLAG_TURN = Math.PI * 20;
/** The most wind (gale plus gusts) that still widens the folds. */
export const FLAG_SPREAD = 2.4;

/** The ripple's pace in a wind of `gale`. */
export function flagPace(gale) {
    return Math.min(FLAG_PACE.most, FLAG_PACE.rest + FLAG_PACE.gale * Math.max(0, gale - GALE_REST));
}

/** Seconds the light a lock leaves in a flag takes to fall to 1/e, and the most one holds. */
export const BLESS_HOLD = 24;
export const BLESS_MAX = 2.2;

/** Seconds a four-line clear holds the mountain's breath before the sun breaks over the wall. */
export const HUSH_HOLD = 0.22;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const SURGE_COOL = 3.4;
/** Seconds an avalanche takes to run its track. */
export const AVALANCHE_RUN = 9;

/** The wind (m/s, +X is downwind) at rest; gusts and the chain raise it. */
export const WIND = Object.freeze({ x: 9, y: 0.6, z: -3.2 });

/** mulberry32: a tiny seeded [0, 1) generator. */
export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Radius of a powder ring `age` seconds after the lock. */
export function ringRadius(age) {
    return age <= 0 ? 0 : RING_REACH * (1 - Math.exp(-age / RING_TAU));
}

/** The mountain's charge for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.0) : 0;
}

/**
 * The sun's elevation (radians) for a charge (0..1), a surge (0..1.4) and a clear's swell (the
 * radians it is still lifted by).
 */
export function sunElevationFor(power, surge = 0, swell = 0) {
    return Math.min(SUN_ELEVATION.max, SUN_ELEVATION.rest
        + (SUN_ELEVATION.full - SUN_ELEVATION.rest) * clamp01(power)
        + SUN_ELEVATION.surge * Math.min(1.4, Math.max(0, surge))
        + Math.max(0, swell));
}

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** An sRGB hex as scene-linear [r, g, b]. */
export function linRGB(hex) {
    return [
        srgbToLinear(((hex >> 16) & 255) / 255),
        srgbToLinear(((hex >> 8) & 255) / 255),
        srgbToLinear((hex & 255) / 255),
    ];
}

/** A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b]. */
export function pieceColor(value, fallback = 0xfbc531) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Pale piece colours wash out as light: push them toward their own hue, and keep a floor in
    // every channel so a pure primary still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.6) / (1 - lo * 0.6);
        return pushed * 0.94 + 0.06;
    });
}

/** The five colours of a line of lung ta, in their order: sky, air, fire, water, earth. */
export const LUNG_TA = Object.freeze([
    linRGB(0x1f6fd8), linRGB(0xf2f0e6), linRGB(0xd8321e), linRGB(0x1f9a48), linRGB(0xf2b81c),
]);

/**
 * The hours of the mountain, one per level (cycled), all scene-linear. Each hour has two ends:
 * `cold` is the mountain waiting (the sun under the wall) and `warm` is the mountain lit (the
 * chain at full charge); the world mixes them by the charge.
 *
 *   sun        the direct light           glow     the sky round the sun
 *   zenith     the top of the sky         horizon  its foot
 *   shade      the light in the shadows   cloud    the cloud sea's own tint
 *   stars      how many stars show (0..1)
 */
/** One end of an hour, in the order of the table above. */
const light = (sun, glow, zenith, horizon, shade, cloud, stars) => ({
    sun, glow, zenith, horizon, shade, cloud, stars,
});

export const HOURS = Object.freeze([
    {
        name: 'first-light',
        cold: light(
            [3.4, 1.05, 0.62],
            [1.0, 0.36, 0.3],
            [0.012, 0.03, 0.115],
            [0.22, 0.16, 0.3],
            [0.11, 0.17, 0.4],
            [0.4, 0.42, 0.62],
            0.55,
        ),
        warm: light(
            [4.4, 2.6, 1.3],
            [1.25, 0.62, 0.26],
            [0.05, 0.16, 0.5],
            [0.74, 0.5, 0.4],
            [0.17, 0.27, 0.56],
            [0.95, 0.76, 0.64],
            0,
        ),
    },
    {
        name: 'gold',
        cold: light(
            [3.6, 1.7, 0.6],
            [1.1, 0.55, 0.2],
            [0.016, 0.06, 0.2],
            [0.36, 0.3, 0.3],
            [0.12, 0.22, 0.46],
            [0.5, 0.54, 0.66],
            0.15,
        ),
        warm: light(
            [4.8, 3.5, 1.9],
            [1.3, 0.85, 0.36],
            [0.03, 0.12, 0.42],
            [0.7, 0.6, 0.46],
            [0.17, 0.3, 0.58],
            [1.0, 0.88, 0.7],
            0,
        ),
    },
    {
        name: 'cobalt',
        cold: light(
            [3.2, 2.6, 2.0],
            [0.7, 0.72, 0.8],
            [0.01, 0.045, 0.24],
            [0.26, 0.38, 0.56],
            [0.1, 0.2, 0.5],
            [0.5, 0.6, 0.78],
            0.1,
        ),
        warm: light(
            [4.6, 4.2, 3.6],
            [0.95, 0.95, 0.95],
            [0.012, 0.075, 0.42],
            [0.42, 0.6, 0.86],
            [0.14, 0.27, 0.62],
            [0.95, 0.97, 1.0],
            0,
        ),
    },
    {
        name: 'ember',
        cold: light(
            [3.6, 0.78, 0.5],
            [1.1, 0.24, 0.28],
            [0.02, 0.018, 0.1],
            [0.3, 0.12, 0.26],
            [0.16, 0.13, 0.4],
            [0.46, 0.34, 0.6],
            0.7,
        ),
        warm: light(
            [4.8, 1.75, 0.7],
            [1.4, 0.42, 0.22],
            [0.05, 0.04, 0.22],
            [0.8, 0.3, 0.3],
            [0.22, 0.17, 0.5],
            [1.0, 0.56, 0.52],
            0.12,
        ),
    },
    {
        name: 'moonrise',
        cold: light(
            [0.5, 0.66, 1.05],
            [0.2, 0.3, 0.6],
            [0.002, 0.004, 0.02],
            [0.02, 0.04, 0.1],
            [0.03, 0.05, 0.14],
            [0.16, 0.22, 0.42],
            1,
        ),
        warm: light(
            [1.5, 1.8, 2.5],
            [0.4, 0.55, 0.95],
            [0.004, 0.009, 0.04],
            [0.05, 0.09, 0.2],
            [0.05, 0.08, 0.22],
            [0.36, 0.46, 0.74],
            0.85,
        ),
    },
]);

export const HOUR_KEYS = Object.freeze(['sun', 'glow', 'zenith', 'horizon', 'shade', 'cloud']);

/** The colour a four-line clear fires in. */
export const SUNFIRE = Object.freeze([1.0, 0.8, 0.46]);
