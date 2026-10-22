/**
 * Nebula Flow — constants and CPU maths shared by the world, the director and the shaders.
 * Three-free: the composition, the director and their tests import only this.
 *
 * The picture is a stellar nursery seen face on: pillars of dust stand in a glowing cavity, their
 * heads set alight by a cluster of young stars just above the frame, and the gas the light boils
 * off them flows away through the cavity. Everything is laid out in NURSERY SPACE: the screen
 * with its centre at the origin, x to the right and y UP, one unit = half the screen's height (so
 * the screen spans [−aspect, aspect] × [−1, 1]). Pillars, the cluster, protostars, jets and fronts
 * are all nursery-space points.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// ── Small maths ──────────────────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** The share of the way a value eased at `rate` per second covers in `dt` seconds. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

export function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linRGB(hex) {
    return [
        srgbToLinear(((hex >> 16) & 255) / 255),
        srgbToLinear(((hex >> 8) & 255) / 255),
        srgbToLinear((hex & 255) / 255),
    ];
}

/**
 * A piece's colour as light: linear, its peak channel at 1 and its weakest pushed down a little
 * (a pale piece still reads as its hue against the gas), never black.
 */
export function pieceColor(value, fallback = 0x9b7bff) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.55) / (1 - lo * 0.55);
        return pushed * 0.94 + 0.06;
    });
}

/** Screen fractions (y down) → nursery space for an aspect. */
export function screenToNursery(sx, sy, aspect, out = [0, 0]) {
    out[0] = (sx * 2 - 1) * aspect;
    out[1] = 1 - sy * 2;
    return out;
}

/** Nursery space → screen fractions (y down). */
export function nurseryToScreen(x, y, aspect, out = { x: 0.5, y: 0.5 }) {
    out.x = (x / aspect + 1) * 0.5;
    out.y = (1 - y) * 0.5;
    return out;
}

// ── The baked noise ──────────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/** Periodic gradient noise: one octave, value and exact gradient (lattice units). */
function gradientOctave(rand, period, n, visit) {
    const gx = new Float32Array(period * period);
    const gy = new Float32Array(period * period);
    for (let i = 0; i < gx.length; i += 1) {
        const a = rand() * TAU;
        gx[i] = Math.cos(a);
        gy[i] = Math.sin(a);
    }
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    const dfade = (v) => 30 * v * v * (v * (v - 2) + 1);
    const scale = period / n;
    for (let y = 0; y < n; y += 1) {
        const fy = y * scale;
        const y0 = Math.floor(fy);
        const ty = fy - y0;
        const y1 = (y0 + 1) % period;
        const sy = fade(ty);
        const dsy = dfade(ty);
        for (let x = 0; x < n; x += 1) {
            const fx = x * scale;
            const x0 = Math.floor(fx);
            const tx = fx - x0;
            const x1 = (x0 + 1) % period;
            const sx = fade(tx);
            const dsx = dfade(tx);
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
            const v = top + (bottom - top) * sy;
            const dTopX = gx[i00] + (gx[i10] - gx[i00]) * sx + (d10 - d00) * dsx;
            const dBotX = gx[i01] + (gx[i11] - gx[i01]) * sx + (d11 - d01) * dsx;
            const dTopY = gy[i00] + (gy[i10] - gy[i00]) * sx;
            const dBotY = gy[i01] + (gy[i11] - gy[i01]) * sx;
            const dvx = dTopX + (dBotX - dTopX) * sy;
            const dvy = dTopY + (dBotY - dTopY) * sy + (bottom - top) * dsy;
            visit(y * n + x, v, dvx, dvy);
        }
    }
}

function normalise(field) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < field.length; i += 1) {
        if (field[i] < lo) lo = field[i];
        if (field[i] > hi) hi = field[i];
    }
    return { lo, range: Math.max(1e-6, hi - lo) };
}

/**
 * Four kinds of periodic noise, one per channel, each stretched to [0, 1]:
 *   R  fBm (5 octaves)                     smooth cloud: the cavity's gas, the dust's lanes
 *   G  billow fBm (|n| per octave)         lumps
 *   B  fBm with another seed               warps and the far haze
 *   A  ridged fBm ((1 − |n|)² per octave)  filaments: the flowing veils, the boiling gas
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 7331, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const out = new Float32Array(n * n * 4);
    const kinds = ['fbm', 'billow', 'fbm', 'ridge'];
    for (let c = 0; c < 4; c += 1) {
        const field = new Float32Array(n * n);
        const kind = kinds[c];
        let amp = 1;
        for (let o = 0; o < 5; o += 1) {
            const a = amp;
            gradientOctave(rand, 4 << o, n, (k, v) => {
                let w = v * 1.41;
                if (kind === 'billow') w = Math.abs(w);
                else if (kind === 'ridge') w = (1 - Math.abs(w)) ** 2;
                field[k] += w * a;
            });
            amp *= kind === 'ridge' ? 0.55 : 0.5;
        }
        const { lo, range } = normalise(field);
        for (let i = 0; i < field.length; i += 1) out[i * 4 + c] = (field[i] - lo) / range;
    }
    return out;
}

/**
 * The relief: a smooth periodic fBm and its exact gradient, so a surface built from it has
 * continuous normals under bilinear filtering (a finite difference of a bilinearly filtered
 * height steps at every texel edge).
 *   R  height in [0, 1]
 *   G  ∂height/∂u   per unit of texture coordinate (one tile = 1)
 *   B  ∂height/∂v
 *   A  a second, decorrelated smooth fBm in [0, 1] (no gradient)
 * @returns {Float32Array} size × size × 4
 */
export function bakeRelief(seed = 9127, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const out = new Float32Array(n * n * 4);
    const h = new Float32Array(n * n);
    const hx = new Float32Array(n * n);
    const hy = new Float32Array(n * n);
    const h2 = new Float32Array(n * n);
    let amp = 1;
    for (let o = 0; o < 5; o += 1) {
        const a = amp;
        const period = 4 << o;
        gradientOctave(rand, period, n, (k, v, dvx, dvy) => {
            h[k] += v * a;
            hx[k] += dvx * a * period;
            hy[k] += dvy * a * period;
        });
        amp *= 0.5;
    }
    amp = 1;
    for (let o = 0; o < 5; o += 1) {
        const a = amp;
        gradientOctave(rand, 4 << o, n, (k, v) => {
            h2[k] += v * a;
        });
        amp *= 0.5;
    }
    const one = normalise(h);
    const two = normalise(h2);
    for (let i = 0; i < n * n; i += 1) {
        out[i * 4] = (h[i] - one.lo) / one.range;
        out[i * 4 + 1] = hx[i] / one.range;
        out[i * 4 + 2] = hy[i] / one.range;
        out[i * 4 + 3] = (h2[i] - two.lo) / two.range;
    }
    return out;
}

/** Box-filtered mip chain of an RGBA float field (level 0 first). */
export function buildMips(field, size) {
    const levels = [{ data: field, width: size, height: size }];
    let level = field;
    let w = size;
    while (w > 1) {
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y += 1) {
            for (let x = 0; x < nw; x += 1) {
                const a = (y * 2 * w + x * 2) * 4;
                const b = a + 4;
                const c = a + w * 4;
                const d = c + 4;
                const o = (y * nw + x) * 4;
                for (let k = 0; k < 4; k += 1) next[o + k] = (level[a + k] + level[b + k] + level[c + k] + level[d + k]) * 0.25;
            }
        }
        levels.push({ data: next, width: nw, height: nw });
        level = next;
        w = nw;
    }
    return levels;
}

// ── The stage: pillars and the cluster ───────────────────────────────────────────

/**
 * The pillars as they stand beside a card on a wide screen. `s` is where the foot stands across
 * the free side (0 = the card's edge, 1 = the screen's edge), `side` −1 left / +1 right.
 *   top       the height of its head (nursery units)
 *   lean      how far the head leans toward the card (units of the foot's half-width)
 *   w0, w1    half-widths at the foot and at the head (on a 16:9 screen)
 *   depth     0 = the nearest … 1 = the farthest (veiled by more gas)
 *   seed      its own noise offset
 */
export const PILLAR_PLAN = Object.freeze([
    Object.freeze({
        name: 'great', side: -1, s: 0.565, top: 0.52, topTall: 0.92, lean: 0.95, w0: 0.36, w1: 0.13, depth: 0.15, seed: 0.13,
    }),
    Object.freeze({
        name: 'sentinel', side: -1, s: 0.97, top: -0.06, topTall: 0.3, lean: 0.45, w0: 0.26, w1: 0.1, depth: 0.0, seed: 0.57,
    }),
    Object.freeze({
        name: 'twin', side: 1, s: 0.52, top: 0.36, topTall: 0.84, lean: 0.8, w0: 0.27, w1: 0.11, depth: 0.35, seed: 0.81,
    }),
    Object.freeze({
        name: 'spire', side: 1, s: 0.9, top: -0.22, topTall: 0.18, lean: 0.4, w0: 0.2, w1: 0.08, depth: 0.55, seed: 0.29,
    }),
]);

export const PILLAR_SLOTS = PILLAR_PLAN.length;
/**
 * vec4 rows per pillar: (foot x, foot y, head y, lean in x) + (w0, w1, depth, seed), then its two
 * tapered capsules (foot → knee, knee → head) worked out once per stage rather than per pixel:
 * (from x, from y, up x, up y) + (r1, length, b, a) each, b = (r1 − r2) / length and
 * a = √(1 − b²) as nfTaper takes them.
 */
export const PILLAR_ROWS = 6;
/** Where every foot stands (below the frame, inside the ridge). */
export const PILLAR_FOOT = -1.25;
/** Free side width (nursery units) the 16:9 plan was drawn for. */
const PLAN_ROOM = 1.38;

/**
 * Lay the pillars out for an aspect, the card's half-width and top (nursery units) and, on the
 * right, the stats bar's outer edge (nursery units; the twin stands clear of it when there is
 * room): each foot stands at its share of its free side, the pillars thin when the side is narrow
 * (a phone), and their heads rise above the card's top when the card fills the frame's width.
 * @returns {Array<{x0:number, y0:number, top:number, lean:number, w0:number, w1:number, depth:number, seed:number, name:string, side:number}>}
 */
export function pillarLayout(aspect, cardHalf, cardTopIn = 0.87, hudRight = null) {
    const a = Math.max(0.3, Number.isFinite(aspect) ? aspect : 16 / 9);
    const cardTop = Number.isFinite(cardTopIn) ? cardTopIn : 0.87;
    const edge = Math.min(a * 0.92, Math.max(0, Number.isFinite(cardHalf) ? cardHalf : 0.39));
    let edgeRight = edge;
    if (Number.isFinite(hudRight) && hudRight > edge && a - hudRight > 0.3) edgeRight = hudRight;
    // On a tall screen the free side is a sliver: the heads must clear the card's top to be seen.
    const tall = smooth(0.62, 0.45, (a - edge) / a);
    return PILLAR_PLAN.map((p) => {
        const from = p.side < 0 ? edge : edgeRight;
        const room = Math.max(0.08, a - from);
        const width = Math.max(0.34, Math.min(1.15, clamp01(room / PLAN_ROOM) ** 0.6));
        const x0 = p.side * (from + p.s * room);
        const w0 = p.w0 * width;
        return {
            name: p.name,
            side: p.side,
            x0,
            y0: PILLAR_FOOT,
            // a taller card asks the heads to rise further (topTall is drawn for a phone's card)
            top: lerp(p.top, Math.min(0.96, p.topTall + (cardTop - 0.71) * 0.5), tall),
            // a head leans toward the card only where the side has room for it
            lean: -p.side * p.lean * w0 * smooth(0.12, 0.7, room),
            w0,
            w1: p.w1 * Math.max(0.55, width),
            depth: p.depth,
            seed: p.seed,
        };
    });
}

/** Pack the pillars into vec4 rows: (x0, y0, top, lean) + (w0, w1, depth, seed). */
export function packPillars(pillars, rows) {
    const set = (row, x, y, z, w) => {
        row.x = x; row.y = y; row.z = z; row.w = w;
    };
    for (let i = 0; i < PILLAR_SLOTS; i += 1) {
        const p = pillars[i];
        const o = i * PILLAR_ROWS;
        if (!p) {
            set(rows[o], 0, -10, -10, 0);
            set(rows[o + 1], 0, 0, 1, 0);
            // two points far below the frame
            for (let s = 0; s < 2; s += 1) {
                set(rows[o + 2 + s * 2], 0, -10, 0, 1);
                set(rows[o + 3 + s * 2], 0, 1e-3, 0, 1);
            }
        } else {
            set(rows[o], p.x0, p.y0, p.top, p.lean);
            set(rows[o + 1], p.w0, p.w1, p.depth, p.seed);
            pillarCapsules(p).forEach((c, s) => {
                set(rows[o + 2 + s * 2], c.from[0], c.from[1], c.up[0], c.up[1]);
                set(rows[o + 3 + s * 2], c.r1, c.h, c.b, c.a);
            });
        }
    }
    return rows;
}

/**
 * A pillar's two tapered capsules, foot → knee → head (the lean grows toward the head), as the
 * nursery's shader and pillarDistance() both draw them.
 */
export function pillarCapsules(p) {
    const head = [p.x0 + p.lean, p.top - p.w1];
    const knee = [lerp(p.x0, head[0], 0.55) - p.lean * 0.18, lerp(p.y0, head[1], 0.55)];
    const wk = (p.w0 + p.w1) / 2;
    const capsule = (from, to, r1, r2) => {
        const h = Math.max(Math.hypot(to[0] - from[0], to[1] - from[1]), 1e-6);
        const b = (r1 - r2) / h;
        return {
            from, up: [(to[0] - from[0]) / h, (to[1] - from[1]) / h], r1, r2, h, b, a: Math.sqrt(Math.max(1 - b * b, 1e-4)),
        };
    };
    return [capsule([p.x0, p.y0], knee, p.w0, wk), capsule(knee, head, wk, p.w1)];
}

/** A point on a pillar's axis at a share `h` (0 foot … 1 head centre) of its height. */
export function pillarAxisAt(p, h, out = [0, 0]) {
    const headY = p.top - p.w1;
    const t = clamp01(h);
    out[0] = p.x0 + p.lean * t * t;
    out[1] = lerp(p.y0, headY, t);
    return out;
}

/** The pillar's half-width at a share `h` of its height. */
export const pillarWidthAt = (p, h) => lerp(p.w0, p.w1, clamp01(h) ** 0.7);

/** Where the cluster that lights the nursery stands (above the frame). */
export function clusterFor(aspect) {
    const a = Math.max(0.3, Number.isFinite(aspect) ? aspect : 16 / 9);
    const wide = smooth(0.7, 1.6, a);
    return { x: lerp(0.0, 0.12, wide), y: lerp(1.42, 1.75, wide) };
}

// ── Palettes ─────────────────────────────────────────────────────────────────────

/** Every colour a palette sets (linear RGB). `prism` (0..1) spreads the gas round the hue wheel. */
export const PALETTE_KEYS = Object.freeze([
    'deepLow', 'deepHigh', 'cavityNear', 'cavityFar', 'clusterGlow', 'veil',
    'dustLit', 'dustDark', 'dustGlow', 'front', 'evap', 'starTint',
]);

const palette = (name, colours, prism = 0) => Object.freeze({ name, prism, ...colours });

/**
 * Six filter sets on one line, neighbours by hue, walked there and back (so a change is always
 * between neighbours and never through grey): prismatic, aurora, webb, cosmic, rosette, ember.
 * Level 1 opens on the Webb palette, in the middle of the line.
 */
export const NEBULA_PALETTES = Object.freeze([
    palette('prismatic', {
        deepLow: [0.003, 0.002, 0.008],
        deepHigh: [0.01, 0.008, 0.028],
        cavityNear: [0.5, 0.55, 1.0],
        cavityFar: [0.1, 0.05, 0.22],
        clusterGlow: [0.96, 0.96, 1.0],
        veil: [1.0, 0.5, 0.8],
        dustLit: [1.0, 0.66, 0.5],
        dustDark: [0.03, 0.018, 0.03],
        dustGlow: [0.22, 0.05, 0.28],
        front: [1.0, 0.96, 1.0],
        evap: [0.7, 0.8, 1.0],
        starTint: [0.96, 0.96, 1.0],
    }, 1),

    palette('aurora', {
        deepLow: [0.001, 0.004, 0.006],
        deepHigh: [0.004, 0.016, 0.024],
        cavityNear: [0.12, 0.95, 0.62],
        cavityFar: [0.02, 0.11, 0.17],
        clusterGlow: [0.78, 1.0, 0.9],
        veil: [0.55, 0.42, 1.0],
        dustLit: [0.72, 0.95, 0.36],
        dustDark: [0.016, 0.03, 0.024],
        dustGlow: [0.08, 0.28, 0.12],
        front: [0.86, 1.0, 0.72],
        evap: [0.45, 1.0, 0.82],
        starTint: [0.82, 1.0, 0.92],
    }),

    palette('webb', {
        deepLow: [0.002, 0.002, 0.007],
        deepHigh: [0.006, 0.01, 0.028],
        cavityNear: [0.1, 0.6, 1.0],
        cavityFar: [0.06, 0.035, 0.22],
        clusterGlow: [0.75, 0.88, 1.0],
        veil: [0.5, 0.66, 0.95],
        dustLit: [1.0, 0.45, 0.12],
        dustDark: [0.045, 0.02, 0.016],
        dustGlow: [0.35, 0.05, 0.03],
        front: [1.0, 0.78, 0.48],
        evap: [1.0, 0.5, 0.42],
        starTint: [0.85, 0.92, 1.0],
    }),

    palette('cosmic', {
        deepLow: [0.003, 0.001, 0.008],
        deepHigh: [0.012, 0.005, 0.032],
        cavityNear: [0.5, 0.28, 1.0],
        cavityFar: [0.12, 0.025, 0.24],
        clusterGlow: [0.88, 0.8, 1.0],
        veil: [1.0, 0.36, 0.78],
        dustLit: [0.98, 0.4, 0.6],
        dustDark: [0.03, 0.012, 0.03],
        dustGlow: [0.3, 0.02, 0.18],
        front: [1.0, 0.78, 0.95],
        evap: [0.72, 0.52, 1.0],
        starTint: [0.92, 0.86, 1.0],
    }),

    palette('rosette', {
        deepLow: [0.005, 0.001, 0.004],
        deepHigh: [0.022, 0.003, 0.016],
        cavityNear: [1.0, 0.16, 0.45],
        cavityFar: [0.24, 0.015, 0.14],
        clusterGlow: [1.0, 0.82, 0.9],
        veil: [1.0, 0.45, 0.62],
        dustLit: [1.0, 0.42, 0.3],
        dustDark: [0.04, 0.008, 0.016],
        dustGlow: [0.4, 0.02, 0.1],
        front: [1.0, 0.82, 0.78],
        evap: [1.0, 0.36, 0.6],
        starTint: [1.0, 0.88, 0.92],
    }),

    palette('ember', {
        deepLow: [0.005, 0.002, 0.001],
        deepHigh: [0.022, 0.008, 0.003],
        cavityNear: [1.0, 0.44, 0.08],
        cavityFar: [0.22, 0.04, 0.02],
        clusterGlow: [1.0, 0.9, 0.7],
        veil: [1.0, 0.76, 0.22],
        dustLit: [1.0, 0.62, 0.2],
        dustDark: [0.035, 0.012, 0.006],
        dustGlow: [0.4, 0.08, 0.01],
        front: [1.0, 0.95, 0.62],
        evap: [1.0, 0.6, 0.26],
        starTint: [1.0, 0.94, 0.82],
    }),
]);

/** Level 1's palette (webb). */
export const PALETTE_HOME = 2;
/** Seconds the clock alone takes to move the sky one palette along its line. */
export const PALETTE_STEP = 95;
/** The share of a step, at each end, that the sky rests on a palette before moving on. */
export const PALETTE_REST = 0.15;

/** Where the sky stands for a level's place and the clock: the two simply add. */
export const palettePlace = (levelPlace, time) => levelPlace + Math.max(0, time) / PALETTE_STEP;

/** A place on the palettes' line as (index, next, mix): walked there and back, no wrap. */
export function palettePhase(place) {
    const last = NEBULA_PALETTES.length - 1;
    const period = last * 2;
    let x = (((place + PALETTE_HOME) % period) + period) % period;
    if (x > last) x = period - x;
    const index = Math.min(last - 1, Math.floor(x));
    return { index, next: index + 1, mix: smooth(PALETTE_REST, 1 - PALETTE_REST, x - index) };
}

/** The palette at a place: every key mixed between the two neighbours, plus `prism`. */
export function paletteAt(place, out = {}) {
    const { index, next, mix } = palettePhase(place);
    const from = NEBULA_PALETTES[index];
    const to = NEBULA_PALETTES[next];
    for (let i = 0; i < PALETTE_KEYS.length; i += 1) {
        const key = PALETTE_KEYS[i];
        const target = out[key] || (out[key] = [0, 0, 0]);
        for (let c = 0; c < 3; c += 1) target[c] = lerp(from[key][c], to[key][c], mix);
    }
    out.prism = lerp(from.prism, to.prism, mix);
    return out;
}

/** The nearer palette's name at a place (diagnostics). */
export function paletteName(place) {
    const { index, next, mix } = palettePhase(place);
    return NEBULA_PALETTES[mix < 0.5 ? index : next].name;
}

// ── Pieces ───────────────────────────────────────────────────────────────────────

/** The seven shapes as matrices (rows down), for the ambient stars and the playground. */
export const SHAPES = Object.freeze({
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]],
});
export const SHAPE_KEYS = Object.freeze(Object.keys(SHAPES));

/**
 * A piece's occupied cells (up to four) as eight numbers: (x, y) offsets in cells, centred on
 * the bounding box, y UP. Null when the matrix is not one.
 */
export function cellsFromMatrix(matrix) {
    if (!Array.isArray(matrix)) return null;
    const cells = [];
    for (let r = 0; r < matrix.length && r < 8; r += 1) {
        const row = matrix[r];
        if (Array.isArray(row)) {
            for (let c = 0; c < row.length && c < 8; c += 1) {
                if (Number(row[c]) > 0 && cells.length < 8) cells.push(c, -r);
            }
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

// ── Births: a lock kindles a star in a pillar ────────────────────────────────────

/**
 * Births held at once: a ring that holds a steady game of about a piece a second (or two versus
 * players) with every freed star fading out before its slot is needed; past that a new one takes
 * the dimmest place. The nursery pays only for the lit ones (LANTERN_ROWS).
 */
export const BIRTH_SLOTS = 32;
/**
 * vec4 rows per birth:
 *   0  (site x, site y, ignition time, power)          power 0 = an empty slot
 *   1  (r, g, b, kind)                                 kind 0 lock, 1 hard drop, 2 great star, 3 ambient
 *   2  (jet angle, release time or −1, cell size, seed)
 *   3  (cell 0 x, y, cell 1 x, y)                      in cells, y up
 *   4  (cell 2 x, y, cell 3 x, y)
 *   5  (from x, from y, flight seconds, bow)           the spark's flight from the card
 */
export const BIRTH_ROWS = 6;

/**
 * The nursery's view of the births, worked out on the CPU each frame and packed lit-first with a
 * count (as the fronts are): vec4 rows per lit star,
 *   0  (x, y, light × power, hole radius)
 *   1  (r, g, b, the lantern's reach)
 */
export const LANTERN_ROWS = 2;

export const KIND_LOCK = 0;
export const KIND_DROP = 1;
export const KIND_GREAT = 2;
export const KIND_AMBIENT = 3;

/** Seconds a lock's spark takes from the card's edge to its site. */
export const FLIGHT = 0.62;
/** A hard drop's spark is quicker. */
export const FLIGHT_DROP = 0.42;
/** The ignition flash fades with this time constant. */
export const IGNITE_FLASH = 0.35;
/** A held star burns this long if no clear releases it (then fades over BIRTH_FADE). */
export const BIRTH_LIFE = 150;
export const BIRTH_FADE = 12;
/** A released star: its dust boils away over HOLE_OPEN, and it fades over RELEASE_FADE. */
export const HOLE_OPEN = 2.4;
export const RELEASE_FADE = 18;
/** The jets: how long they take to run out, and how long they burn. */
export const JET_RUN = 0.9;
export const JET_LIFE = 5;
/**
 * Cell spacing of a birth's constellation at ignition (nursery units): the piece's own shape in
 * four stars, joined by lines of light, which then draws together into one star.
 */
export const BIRTH_CELL = 0.058;
/** Seconds the constellation holds its shape, and by when it has drawn into one star. */
export const CONSTELLATION_HOLD = 0.55;
export const CONSTELLATION_MERGE = 1.9;
/** How far apart the cells end (a share of BIRTH_CELL): close enough to read as one star. */
export const CONSTELLATION_TIGHT = 0.1;

/** How far the spark has come (0..1) `age` seconds before ignition is −age… eased in. */
export function flightAt(sinceLaunch, flight = FLIGHT) {
    const t = clamp01(sinceLaunch / Math.max(1e-3, flight));
    return t * t * (3 - 2 * t) * 0.35 + t * 0.65;
}

/** A jet's length as a share of its reach, `age` seconds after it was fired. */
export function jetReach(age) {
    if (age <= 0) return 0;
    return 1 - Math.exp(-age / (JET_RUN * 0.45));
}

/** A jet's light, `age` seconds after it was fired. */
export function jetLight(age) {
    if (age <= 0 || age > JET_LIFE) return 0;
    const rise = smooth(0, 0.08, age);
    const fall = 1 - smooth(JET_LIFE * 0.35, JET_LIFE, age);
    return rise * fall;
}

/**
 * How brightly a birth burns at `age` seconds after ignition (1 = held), with its flash on top.
 * `released` is the age at which a clear set it free (or a negative number while it is held).
 */
export function birthLight(age, released = -1, kind = KIND_LOCK) {
    if (age < 0) return 0;
    const flash = Math.exp(-age / IGNITE_FLASH) * 3.5;
    let held = smooth(0, 0.25, age);
    if (released >= 0 && age >= released) {
        const since = age - released;
        // free, it flares, burns as a star for a while, then fades out before its slot is reused
        held *= (1 + 2.2 * Math.exp(-since / 0.8)) * (1 - smooth(RELEASE_FADE * 0.3, RELEASE_FADE, since));
    } else if (kind !== KIND_AMBIENT) {
        // an ambient star never burns out (twin of nfBirthLight's kind test)
        held *= 1 - smooth(BIRTH_LIFE, BIRTH_LIFE + BIRTH_FADE, age);
    }
    return held + flash;
}

/**
 * The radius (nursery units) the dust has boiled back round a released star; the dust closes
 * over the place again as the star fades.
 */
export function holeRadius(sinceRelease, size = 1) {
    if (sinceRelease <= 0) return 0;
    const heal = 1 - smooth(RELEASE_FADE * 0.5, RELEASE_FADE, sinceRelease);
    return 0.075 * size * smooth(0, HOLE_OPEN, sinceRelease) ** 0.7 * heal;
}

/** Whether a slot is free for a new birth at time `t`. */
export function birthDone(slot, t) {
    if (!(slot.power > 0)) return true;
    if (slot.kind === KIND_AMBIENT) return false;
    const age = t - slot.born;
    if (slot.released >= 0) return age - slot.released > RELEASE_FADE;
    return age > BIRTH_LIFE + BIRTH_FADE;
}

// ── Fronts: a clear sends the cluster's light down through the nursery ───────────

export const FRONT_SLOTS = 16;
/** vec4 rows per live front: (centre x, centre y, radius, width) + (r, g, b, light). */
export const FRONT_ROWS = 2;
/** Nursery units a second (a front from the cluster crosses a 16:9 frame in about 2.4 s). */
export const FRONT_SPEED = 1.25;
export const FRONT_LIFE = 3.4;
/** The great star's front is quicker and wider. */
export const GREAT_FRONT_SPEED = 1.8;

/** A front's radius at `age`. */
export const frontRadius = (age, speed = FRONT_SPEED) => Math.max(0, age) * speed;

/** A front's light at `age` (rises at once, fades as it spreads). */
export function frontLight(age, life = FRONT_LIFE) {
    if (age < 0 || age > life) return 0;
    return smooth(0, 0.12, age) * (1 - smooth(life * 0.45, life, age));
}

// ── The chain: the flow winds into a vortex round the board ──────────────────────

/** The vortex's strength (radians of turn at its heart) for a chain. 0 below two. */
export function vortexForCombo(combo) {
    const c = Math.max(0, Math.floor(combo) || 0);
    if (c < 2) return 0;
    return Math.min(6.5, 1.25 + (c - 2) * 0.85);
}

/** The vortex wears the colours of the chain's last steps, one arm per quarter turn. */
export const VORTEX_ARMS = 4;

/** How much faster the gas flows for a chain (1 = rest). */
export const flowForCombo = (combo) => 1 + Math.min(3, vortexForCombo(combo) * 0.42);

/** Seconds a four-line clear holds the nursery's breath before the great star is born. */
export const HUSH_HOLD = 0.26;
/** The great star's dust hole heals over this long. */
export const GREAT_HEAL = 24;

/** Rest rate of the gas's flow (nursery units a second, along the cluster's light). */
export const FLOW_REST = 0.035;

// ── CPU twins of the dust's shape (sites, star cover) ────────────────────────────

function taper(px, py, r1, r2, h) {
    const x = Math.abs(px);
    const b = (r1 - r2) / h;
    const a = Math.sqrt(Math.max(1 - b * b, 1e-4));
    const k = -b * x + a * py;
    if (k < 0) return Math.hypot(x, py) - r1;
    if (k > a * h) return Math.hypot(x, py - h) - r2;
    return x * a + py * b - r1;
}

function smin(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}

function segmentTaper(px, py, fx, fy, tx, ty, r1, r2) {
    const ax = tx - fx;
    const ay = ty - fy;
    const h = Math.hypot(ax, ay);
    const ux = ax / h;
    const uy = ay / h;
    const rx = px - fx;
    const ry = py - fy;
    return taper(rx * uy - ry * ux, rx * ux + ry * uy, r1, r2, h);
}

/** The ridge's crest at x (twin of the shader's). */
export const crestAt = (x) => -0.86 + Math.sin(x * 1.3 + 0.6) * 0.06 + Math.sin(x * 2.9 + 1.7) * 0.035
    + Math.sin(x * 6.1 + 0.2) * 0.015;

/** One pillar's signed distance (no relief): twin of the shader's two tapered capsules. */
export function pillarDistance(p, x, y) {
    const hx = p.x0 + p.lean;
    const hy = p.top - p.w1;
    const kx = p.x0 + (hx - p.x0) * 0.55 - p.lean * 0.18;
    const ky = p.y0 + (hy - p.y0) * 0.55;
    const wk = (p.w0 + p.w1) * 0.5;
    return smin(
        segmentTaper(x, y, p.x0, p.y0, kx, ky, p.w0, wk),
        segmentTaper(x, y, kx, ky, hx, hy, wk, p.w1),
        0.05,
    );
}

/** The dust's signed distance at (x, y), no relief (twin of the shader's shape). */
export function dustDistance(pillars, x, y) {
    let d = y - crestAt(x);
    for (let i = 0; i < pillars.length; i += 1) d = smin(d, pillarDistance(pillars[i], x, y), 0.16);
    return d;
}
