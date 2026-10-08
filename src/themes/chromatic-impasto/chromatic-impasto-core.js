/**
 * Chromatic Impasto — constants and CPU maths shared by the painter, the choreography and the
 * shaders. Three-free: the gestures, the director and their tests import only this.
 *
 * The picture is one canvas, seen square on. CANVAS UNITS: the frame at rest spans y in [−1, 1]
 * (y up) and x in [−aspect, aspect]; the painted cloth runs a little past the frame on every side
 * (VIEW.overscan) so the camera can drift without showing its edge. Paint thickness is a height
 * in [0, ~1.5], where 1 is RELIEF.thickness canvas units of oil standing off the cloth.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The rest camera: square on to the canvas, far enough back that the frame is 2 units tall. */
export const VIEW = Object.freeze({
    fov: 36,
    /** Canvas half-extent past the frame, as a factor of the frame. */
    overscan: 1.07,
    near: 0.05,
    far: 20,
});
/** Distance from the camera to the canvas at rest. */
export const VIEW_DISTANCE = 1 / Math.tan((VIEW.fov * DEG) / 2);

export const RELIEF = Object.freeze({
    /** Canvas units of paint a height of 1 stands off the cloth. */
    thickness: 0.036,
    /** Width of one bristle track (canvas units). */
    bristle: 0.0105,
    /** How much of the relief underneath a new stroke keeps (the paint piles up). */
    keep: 0.34,
});

/** Stroke kinds (the stamp shader branches on these). */
export const KIND = Object.freeze({ BRUSH: 0, KNIFE: 1, BLOB: 2 });

/** Seconds the canvas takes to be blocked in when the theme starts. */
export const INTRO_SPAN = 3.4;
/** Seconds a four-line clear holds the studio's breath before the paint flies. */
export const HUSH_HOLD = 0.2;
/** The chain length at which the canvas starts to turn. */
export const SWIRL_FROM = 2;
/** Radians of twist the display carries before it is baked into the paint. */
export const TWIST_BAKE_AT = 1.15;
/** Seconds a clear's sheen takes to cross the canvas. */
export const SHEEN_TRAVEL = 1.25;
export const SHEEN_SLOTS = 3;
/** Drops of thrown paint in the air at once (the pool's upper bound; tiers take fewer). */
export const DROPLET_MAX = 640;
/** Gravity on thrown paint (canvas units / s², toward the cloth is −z). */
export const DROPLET_GRAVITY = 5.2;

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

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

// ── Colour ──────────────────────────────────────────────────────────────────────

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** '#rrggbb' → scene-linear [r, g, b]. */
export function hexToLinear(hex) {
    const h = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(h)) return [0.5, 0.5, 0.5];
    const n = Number.parseInt(h, 16);
    return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

export const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export const scaleRgb = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

export const luma = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

/**
 * A piece's colour as oil paint: pigments are never emissive, so the brightest channel is held
 * under 0.92 and a pure black is lifted to a paintable dark.
 */
export function pigmentFromHex(hex) {
    const c = hexToLinear(hex);
    const peak = Math.max(c[0], c[1], c[2]);
    if (peak < 0.02) return [0.012, 0.012, 0.016];
    const k = Math.min(1, 0.92 / peak);
    return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * The periods. Each is a set of tube colours (scene-linear pigments):
 *   ground   the toned cloth
 *   darks    the first lay-in: wide thin passes that cover the ground
 *   masses   the big colour areas, by region of the picture
 *   accents  small bright passes over the masses
 *   contour  the black line Lindström draws round every form
 *   light    highlights laid last
 *   key      the studio lamp's colour (a multiplier)
 */
const period = (name, spec) => Object.freeze({
    name,
    ground: hexToLinear(spec.ground),
    darks: spec.darks.map(hexToLinear),
    masses: spec.masses.map(hexToLinear),
    accents: spec.accents.map(hexToLinear),
    contour: hexToLinear(spec.contour),
    light: hexToLinear(spec.light),
    key: spec.key,
});

export const IMPASTO_PERIODS = Object.freeze([
    // Bengt Lindström: blood red, cadmium yellow, turquoise and ultramarine straight from the tube.
    period('lindstrom', {
        ground: '#100d0b',
        darks: ['#06301c', '#07183c', '#2a0a10', '#1c120c'],
        masses: ['#b80f14', '#0a2fc8', '#00b8ae', '#ffbe00', '#ff7300', '#1a7f4d'],
        accents: ['#f4e61c', '#e8281e', '#2f66ff', '#00d9cc'],
        contour: '#08080a',
        light: '#fff4d2',
        key: [1.0, 0.95, 0.86],
    }),
    // The Fauves: rose madder against emerald, cobalt violet against orange.
    period('fauve', {
        ground: '#120b12',
        darks: ['#2b0a33', '#07302c', '#3a0a1e', '#101a3e'],
        masses: ['#e0146e', '#ff6a14', '#0f9e62', '#6a2bd0', '#ffcf1e', '#0e7fd0'],
        accents: ['#ff9ac2', '#c8f03c', '#ffe45e', '#3fe0c0'],
        contour: '#0a0610',
        light: '#fff0e4',
        key: [1.0, 0.93, 0.9],
    }),
    // A night sky: ultramarine and Prussian blue turned with chrome yellow and white.
    period('nocturne', {
        ground: '#070a14',
        darks: ['#06123a', '#0a0a26', '#0a2630', '#101010'],
        masses: ['#1238c8', '#0a66c2', '#1a8fb8', '#f2c21a', '#3a2a9a', '#0f4a8a'],
        accents: ['#ffe873', '#bfe6ff', '#ff9a2a', '#6fd8e8'],
        contour: '#05060c',
        light: '#f6f6ee',
        key: [0.92, 0.95, 1.0],
    }),
    // Earth and fire: vermilion, cadmium, burnt sienna, viridian.
    period('ember', {
        ground: '#140c08',
        darks: ['#3a1206', '#1a2a12', '#2a0808', '#22160c'],
        masses: ['#e23a12', '#f29a0a', '#a8320e', '#0f7a52', '#ffd23a', '#7a1010'],
        accents: ['#fff0a0', '#ff5a2a', '#3fd0a0', '#ffb86a'],
        contour: '#0c0705',
        light: '#fff3d6',
        key: [1.0, 0.92, 0.8],
    }),
    // Spring: turquoise, rose, lilac and leaf green under a cool lamp.
    period('spring', {
        ground: '#0b1010',
        darks: ['#0a2a2a', '#1c1238', '#0c2c16', '#2a1024'],
        masses: ['#12c0b0', '#f0508c', '#8a5ae0', '#58c038', '#ffd84a', '#2a8ae0'],
        accents: ['#ffe0f0', '#d8ff7a', '#8ff0e8', '#ffb0d0'],
        contour: '#070a0a',
        light: '#fbfff4',
        key: [0.95, 1.0, 0.97],
    }),
]);

/** Gold leaf: a four-line clear is answered in it. (Scene-linear reflectance.) */
export const GOLD = Object.freeze([1.0, 0.71, 0.29]);

// ── Value noise (CPU) ───────────────────────────────────────────────────────────

function lattice(ix, iy, seed) {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function valueNoise(x, y, seed = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = lattice(ix, iy, seed);
    const b = lattice(ix + 1, iy, seed);
    const c = lattice(ix, iy + 1, seed);
    const d = lattice(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

// ── The flow field ──────────────────────────────────────────────────────────────

/**
 * The directions the brush follows. One great whorl turns round the board; smaller ones turn in
 * the open cloth to either side, each against its neighbour like meshed gears, so a stroke laid
 * anywhere joins a current that runs through the whole picture.
 *
 * @param {object} params
 * @param {number} params.aspect       frame aspect (width / height)
 * @param {number} [params.seed]
 * @param {{x:number,y:number}} [params.heart]  the board's centre (canvas units)
 * @returns {{ whorls: object[], seed: number, heart: {x:number,y:number} }}
 */
export function createField({ aspect = 16 / 9, seed = 1, heart = { x: 0, y: 0 } } = {}) {
    const rand = mulberry32(0x51ed + seed * 7919);
    const a = Math.max(0.3, aspect);
    const whorls = [{
        x: heart.x, y: heart.y, spin: 1, reach: 0.95, weight: 1.25, pitch: 0.2,
    }];
    if (a >= 1) {
        // Landscape: whorls in the open cloth left and right of the board.
        const side = (a + 0.3) * 0.5;
        const pairs = a > 1.5 ? 2 : 1;
        for (let k = 0; k < pairs; k++) {
            const lift = [0, 0.48, -0.5][pairs === 1 ? 0 : k + 1];
            for (let s = -1; s <= 1; s += 2) {
                whorls.push({
                    x: heart.x + s * side * (0.92 + rand() * 0.2) * (k === 0 ? 1 : 1.08),
                    y: lift + (rand() - 0.5) * 0.3,
                    spin: (k === 0 ? -1 : 1) * 1,
                    reach: 0.42 + rand() * 0.16,
                    weight: 0.9,
                    pitch: (rand() - 0.5) * 0.5,
                });
            }
        }
    } else {
        // Portrait: the open cloth is above and below.
        for (let s = -1; s <= 1; s += 2) {
            whorls.push({
                x: (rand() - 0.5) * a * 0.8,
                y: heart.y + s * (0.78 + rand() * 0.1),
                spin: -1,
                reach: 0.3 + rand() * 0.1,
                weight: 0.9,
                pitch: (rand() - 0.5) * 0.5,
            });
        }
    }
    return { whorls, seed, heart: { x: heart.x, y: heart.y } };
}

/**
 * The field's unit direction at a point. `out` = [dx, dy].
 */
export function fieldDirection(field, x, y, out = [1, 0]) {
    let sx = 0;
    let sy = 0;
    const { whorls } = field;
    for (let i = 0; i < whorls.length; i++) {
        const w = whorls[i];
        const rx = x - w.x;
        const ry = y - w.y;
        const d = Math.hypot(rx, ry) + 1e-4;
        const fall = w.weight / (1 + (d / w.reach) ** 2);
        // Tangent (turned by the whorl's pitch, so the current winds in or out a little).
        const tx = -ry / d;
        const ty = rx / d;
        const c = Math.cos(w.pitch);
        const s = Math.sin(w.pitch);
        sx += w.spin * (tx * c - (rx / d) * s) * fall;
        sy += w.spin * (ty * c - (ry / d) * s) * fall;
    }
    // The hand is never a compass: a slow wander on top.
    const wander = (valueNoise(x * 1.7 + 11.3, y * 1.7 - 4.1, field.seed) - 0.5) * 1.3;
    const c = Math.cos(wander);
    const s = Math.sin(wander);
    const dx = sx * c - sy * s;
    const dy = sx * s + sy * c;
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) {
        out[0] = 1;
        out[1] = 0;
    } else {
        out[0] = dx / len;
        out[1] = dy / len;
    }
    return out;
}

/**
 * The twist the stirring gives the paint at a distance `r` from the board's centre, for a twist
 * of `angle` radians at its strongest ring. Zero under the board and beyond the reach, so the
 * turning cloth never shows its edge. Mirrored in the shaders (ciTwistProfile).
 */
export function twistProfile(r, reach) {
    const k = clamp01(r / Math.max(1e-4, reach));
    // Rises quickly from the centre, falls away smoothly to the rim.
    const rise = smooth(0.0, 0.22, k);
    const fall = 1 - smooth(0.3, 1.0, k);
    return rise * fall * fall;
}

/** Rotate (x, y) about (cx, cy) by the twist at its radius. `out` = [x, y]. */
export function twistPoint(x, y, cx, cy, angle, reach, out = [0, 0]) {
    const rx = x - cx;
    const ry = y - cy;
    const a = angle * twistProfile(Math.hypot(rx, ry), reach);
    const c = Math.cos(a);
    const s = Math.sin(a);
    out[0] = cx + rx * c - ry * s;
    out[1] = cy + rx * s + ry * c;
    return out;
}

/**
 * The notch (radians, at the fastest ring) the link that makes a chain `combo` long turns the
 * canvas. A notch a link, not a rate: the stirring is bounded by the length of the chain, so the
 * paint is wound into arms, never into thread.
 */
export function notchForCombo(combo) {
    if (combo < SWIRL_FROM) return 0;
    return Math.min(0.52, 0.26 + 0.035 * (combo - SWIRL_FROM));
}

/** Radians per second the canvas creeps on while a chain is held. */
export const TWIST_CREEP = 0.04;

/** The charge a chain of `combo` clears puts into the studio (0..1). */
export function powerForCombo(combo) {
    if (combo <= 1) return 0;
    return clamp01(1 - Math.exp(-(combo - 1) / 3.2));
}

/** The van der Corput radical inverse (base 2): a well-spread 0..1 sequence. */
export function radicalInverse(index) {
    let i = index >>> 0;
    let f = 0.5;
    let v = 0;
    while (i > 0) {
        if (i & 1) v += f;
        i >>>= 1;
        f *= 0.5;
    }
    return v;
}
