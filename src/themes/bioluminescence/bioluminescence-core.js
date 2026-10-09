/**
 * Bioluminescence — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the layout, the director and their tests import only this.
 *
 * The grotto (metres): the camera stands in the shallows of a still pool at the origin, a little
 * above the water (y = 0), looking down −Z into a cavern. Glowing mushrooms stand round the pool
 * and in it, crystals rise from the water, the elder mushroom holds the far island, glow-worms
 * pick out the vault.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Gameplay pulse slots evaluated by the materials. */
export const LOCK_SLOTS = 8;
export const CLEAR_SLOTS = 2;
/** Light-swimmers in the water at once (a lock sends one, a hard drop three). */
export const RUNNER_SLOTS = 12;
/** Motes in one swimmer's wake. */
export const RUNNER_TAIL = 26;
/** Point lights the mist and the rock evaluate (the big mushrooms, the elder, the crystals). */
export const EMITTER_MAX = 12;
/** Air-jellies in the pool (a few drift at rest; a chain raises the rest). */
export const JELLY_MAX = 14;

/** Lock ring on the water: radius R·(1 − e^(−age/τ)), fading at RING_FADE /s. */
export const RING_REACH = 30;
export const RING_TAU = 0.75;
export const RING_FADE = 1.05;

/** Seconds a swimmer takes from the board to its mushroom (scaled by distance). */
export const RUNNER_FLIGHT = 0.5;
/** Seconds the light takes to climb a stem once the swimmer reaches its foot. */
export const STEM_CLIMB = 0.22;

/**
 * Clear wave: leaves the foot of the board and rolls out through the grotto, accelerating:
 * radius = CLEAR_REACH · (age / CLEAR_TRAVEL)^CLEAR_SHAPE. One front per cleared line.
 */
export const CLEAR_REACH = 150;
export const CLEAR_TRAVEL = 1.7;
export const CLEAR_SHAPE = 1.6;
export const CLEAR_FRONT_GAP = 0.13;
export const CLEAR_FRONT_WIDTH = 0.085;
export const CLEAR_AFTERGLOW = 1.3;

/** Seconds the colour a lock leaves in a cap takes to fall to 1/e. */
export const STORE_HOLD = 28;
/** The most light one cap holds (in lock units). */
export const STORE_MAX = 2.4;
/** A cap's bloom / release flash falls to 1/e in this many seconds. */
export const PULSE_FADE = 0.6;

/** Seconds a four-line clear holds the grotto's breath before the elder blooms. */
export const HUSH_HOLD = 0.24;
/** Seconds the Great Bloom's fountain plays. */
export const BLOOM_LIFE = 4.2;

/** The water plane. */
export const WATER_Y = 0;

/** The floor's heightmap: a grid over [x0, x1] × [z0, z1] (metres). */
export const TERRAIN = Object.freeze({
    nx: 161,
    nz: 221,
    x0: -64,
    x1: 64,
    z0: -150,
    z1: 26,
});

/** Where the elder mushroom stands (its island), and how tall it is. */
export const ELDER = Object.freeze({
    x: 1.5, z: -64, height: 27, radius: 21,
});

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

/** Hermite step between two edges (either order). */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Radius of a lock ring `age` seconds after the lock (`reach` = a fraction of RING_REACH). */
export function ringRadius(age, reach = 1) {
    return age <= 0 ? 0 : RING_REACH * reach * (1 - Math.exp(-age / RING_TAU));
}

/** How far a clear wave's first front has run `age` seconds after the clear. */
export function clearRadius(age) {
    return age <= 0 ? 0 : CLEAR_REACH * Math.min(1, age / CLEAR_TRAVEL) ** CLEAR_SHAPE;
}

/** Seconds after the clear at which its first front passes a point `dist` metres from the heart. */
export function clearPassTime(dist) {
    return CLEAR_TRAVEL * clamp01(dist / CLEAR_REACH) ** (1 / CLEAR_SHAPE);
}

/** The grotto's wakefulness for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.4) : 0;
}

/** How many jellies are up for a combo of n: three drift at rest, a chain raises the rest. */
export function jelliesForCombo(combo, max = JELLY_MAX) {
    const n = Math.max(0, Math.round(Number(combo) || 0));
    return Math.min(max, 3 + (n > 1 ? (n - 1) * 2 : 0));
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
export function pieceColor(value, fallback = 0x3dffd0) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Pastel piece colours wash out as light: push them toward their own hue, and keep a floor
    // in every channel so a pure primary still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.72) / (1 - lo * 0.72);
        return pushed * 0.95 + 0.05;
    });
}

/**
 * Grotto palettes, all scene-linear. They stand in HUE order (teal, blue, violet, amber, green,
 * and round to teal again), because the grotto does not jump between them: it turns through
 * them like a wheel, one step for every level and slowly by itself with the clock (see
 * `paletteAt` and `paletteDrift`). Neighbours on the wheel melt into each other.
 *
 *   primary / secondary / accent  the three families of living light (a mushroom, a pod or a
 *                                 jelly belongs to one)
 *   plankton   the sea-sparkle in the pool
 *   worm       the glow-worms in the vault
 *   crystal    the hue the crystals lean to
 *   vein       the mycelium's light in the rock and the pool's bed
 *   fogFar / fogLow  the colour of distance, and of the mist that lies on the water
 *   ambient    what little light the rock has of its own
 */
export const BIOLUM_PALETTES = Object.freeze([
    {
        name: 'lagoon',
        primary: [0.06, 0.95, 0.78],
        secondary: [0.3, 1.0, 0.42],
        accent: [0.62, 0.3, 1.0],
        plankton: [0.1, 0.55, 1.0],
        worm: [0.4, 0.95, 1.0],
        crystal: [0.5, 0.95, 1.0],
        vein: [0.05, 0.9, 0.62],
        fogFar: [0.002, 0.017, 0.0211],
        fogLow: [0.0032, 0.024, 0.0256],
        ambient: [0.0033, 0.0121, 0.0165],
    },
    {
        name: 'abyss',
        primary: [0.12, 0.42, 1.0],
        secondary: [0.08, 0.92, 0.95],
        accent: [1.0, 0.26, 0.66],
        plankton: [0.15, 0.95, 0.85],
        worm: [0.55, 0.75, 1.0],
        crystal: [0.45, 0.65, 1.0],
        vein: [0.1, 0.5, 1.0],
        fogFar: [0.002, 0.0088, 0.0289],
        fogLow: [0.0032, 0.0128, 0.032],
        ambient: [0.0028, 0.0077, 0.022],
    },
    {
        name: 'orchid',
        primary: [0.72, 0.26, 1.0],
        secondary: [1.0, 0.3, 0.72],
        accent: [0.15, 1.0, 0.8],
        plankton: [0.45, 0.4, 1.0],
        worm: [0.85, 0.65, 1.0],
        crystal: [0.8, 0.55, 1.0],
        vein: [0.7, 0.25, 1.0],
        fogFar: [0.0102, 0.0048, 0.0255],
        fogLow: [0.0144, 0.0064, 0.0304],
        ambient: [0.0077, 0.0044, 0.0187],
    },
    {
        name: 'ember',
        primary: [1.0, 0.56, 0.14],
        secondary: [1.0, 0.3, 0.26],
        accent: [0.14, 0.9, 1.0],
        plankton: [1.0, 0.72, 0.3],
        worm: [1.0, 0.85, 0.55],
        crystal: [1.0, 0.7, 0.45],
        vein: [1.0, 0.45, 0.12],
        fogFar: [0.0204, 0.0082, 0.0041],
        fogLow: [0.0272, 0.0112, 0.0051],
        ambient: [0.0154, 0.0066, 0.0044],
    },
    {
        name: 'foxfire',
        primary: [0.36, 1.0, 0.2],
        secondary: [0.85, 1.0, 0.24],
        accent: [0.1, 0.78, 1.0],
        plankton: [0.2, 1.0, 0.55],
        worm: [0.7, 1.0, 0.6],
        crystal: [0.6, 1.0, 0.7],
        vein: [0.3, 1.0, 0.2],
        fogFar: [0.0041, 0.0187, 0.0102],
        fogLow: [0.0064, 0.0256, 0.0128],
        ambient: [0.0044, 0.0143, 0.0088],
    },
]);

export const PALETTE_KEYS = Object.freeze([
    'primary', 'secondary', 'accent', 'plankton', 'worm', 'crystal', 'vein', 'fogFar', 'fogLow', 'ambient',
]);

/** A scene-linear colour as (hue 0..1, saturation, value); a grey has no hue (NaN). */
const toHsv = ([r, g, b]) => {
    const max = Math.max(r, g, b);
    const spread = max - Math.min(r, g, b);
    if (spread < 1e-9) return [NaN, 0, max];
    let hue;
    if (max === r) hue = ((g - b) / spread + 6) % 6;
    else if (max === g) hue = (b - r) / spread + 2;
    else hue = (r - g) / spread + 4;
    return [hue / 6, spread / max, max];
};
const hsvChannel = (hue, sat, val, n) => {
    const x = (n + hue * 6) % 6;
    return val - val * sat * Math.max(0, Math.min(x, 4 - x, 1));
};
const PALETTE_HSV = BIOLUM_PALETTES.map((palette) => {
    const out = {};
    PALETTE_KEYS.forEach((key) => {
        out[key] = toHsv(palette[key]);
    });
    return out;
});

/** The share of a turn the accent takes to change (from its start), and the secondary (to its end). */
export const PALETTE_LEAD = 0.6;

/**
 * The palette at `phase` of the wheel, written into `out`: the whole part names a palette, the
 * fraction is how far it has melted into the next. A melting colour turns the short way round the
 * colour wheel while its saturation and brightness cross over, so what lies between two palettes
 * is as vivid as they are (a straight mix of orchid's violet and ember's amber is a grey mauve).
 * The three families do not turn together: the accent goes first and the secondary last, or
 * half-way between two palettes all three would stand on one hue and the grotto would be a
 * single colour. On a whole phase it is that palette, exactly.
 */
export function paletteAt(phase, out = {}) {
    const o = out;
    const count = BIOLUM_PALETTES.length;
    const p = Number.isFinite(phase) ? phase : 0;
    const whole = Math.floor(p);
    const melt = p - whole;
    const a = ((whole % count) + count) % count;
    const b = (a + 1) % count;
    for (let i = 0; i < PALETTE_KEYS.length; i++) {
        const key = PALETTE_KEYS[i];
        const rgb = o[key] || (o[key] = [0, 0, 0]);
        // How far THIS colour has turned (see above): the accent leads, the secondary trails.
        let part = melt;
        if (key === 'accent') part = smooth(0, PALETTE_LEAD, melt);
        else if (key === 'secondary') part = smooth(1 - PALETTE_LEAD, 1, melt);
        if (melt === 0) {
            const pure = BIOLUM_PALETTES[a][key];
            rgb[0] = pure[0];
            rgb[1] = pure[1];
            rgb[2] = pure[2];
        } else {
            const from = PALETTE_HSV[a][key];
            const to = PALETTE_HSV[b][key];
            // (A grey takes the hue of the colour it is melting into, or out of.)
            let h0 = from[0];
            let h1 = to[0];
            if (Number.isNaN(h0)) h0 = Number.isNaN(h1) ? 0 : h1;
            if (Number.isNaN(h1)) h1 = h0;
            let turn = h1 - h0;
            if (turn > 0.5) turn -= 1;
            else if (turn < -0.5) turn += 1;
            const hue = (h0 + turn * part + 1) % 1;
            const sat = from[1] + (to[1] - from[1]) * part;
            const val = from[2] + (to[2] - from[2]) * part;
            rgb[0] = hsvChannel(hue, sat, val, 5);
            rgb[1] = hsvChannel(hue, sat, val, 3);
            rgb[2] = hsvChannel(hue, sat, val, 1);
        }
    }
    return o;
}

/** Seconds the grotto spends on each palette when only the clock is turning it. */
export const PALETTE_PERIOD = 100;
/** The share of that time it rests on the palette itself before it starts to melt into the next. */
export const PALETTE_HOLD = 0.35;

/**
 * How far the clock alone has turned the grotto round its palettes by `time`: the whole part
 * counts the palettes passed, the fraction is the melt into the next one (0 through the hold,
 * then eased). A level adds whole steps on top of this. A constant rate on the world clock, so
 * the palette at rest is a function of the time alone and a seek lands on it exactly.
 */
export function paletteDrift(time) {
    const turns = Math.max(0, Number(time) || 0) / PALETTE_PERIOD;
    const whole = Math.floor(turns);
    const melt = clamp01((turns - whole - PALETTE_HOLD) / (1 - PALETTE_HOLD));
    return whole + melt * melt * (3 - 2 * melt);
}

/** The palette a phase of the wheel stands nearest to, the one it is turning toward, and how far. */
export function paletteNames(phase) {
    const count = BIOLUM_PALETTES.length;
    const p = Number.isFinite(phase) ? phase : 0;
    const whole = Math.floor(p);
    const a = ((whole % count) + count) % count;
    const b = (a + 1) % count;
    const mix = p - whole;
    return {
        name: BIOLUM_PALETTES[mix < 0.5 ? a : b].name,
        from: BIOLUM_PALETTES[a].name,
        to: BIOLUM_PALETTES[b].name,
        mix,
    };
}

/**
 * The colour the Great Bloom fires in: the elder's own light, a white with the pool's cast. (Not
 * gold: a warm light over teal mixes to grey.)
 */
export const STARSPORE = Object.freeze([0.74, 1.0, 0.93]);

/** The family (0 primary, 1 secondary, 2 accent) colour of a palette. */
export function familyColor(palette, family) {
    if (family >= 1.5) return palette.accent;
    return family >= 0.5 ? palette.secondary : palette.primary;
}

// ── The noise field (CPU): the plan reads it for the lie of the land, the shaders as a texture ──

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 4421, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const base = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o++) {
            const period = 4 << o;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i++) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y++) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
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
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) base[i * 4 + c] = (field[i] - lo) * inv;
    }
    return base;
}

/** Bilinear, wrapping read of one channel of a baked noise field (the CPU twin of a fetch). */
export function sampleNoise(field, size, x, y, channel = 0) {
    const fx = (((x % 1) + 1) % 1) * size - 0.5;
    const fy = (((y % 1) + 1) % 1) * size - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (ix, iy) => field[((((iy % size) + size) % size) * size + (((ix % size) + size) % size)) * 4 + channel];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
}
