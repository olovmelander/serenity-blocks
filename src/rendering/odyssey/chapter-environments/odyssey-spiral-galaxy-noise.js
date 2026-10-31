// @ts-check
/**
 * @fileoverview THE GALAXY'S GRAIN (2026-10-31, the space masterpiece pass): the tileable noise
 * the spiral galaxy (odyssey-spiral-galaxy.tsl.js) reads its clouds, knots and dust from.
 *
 * Re-derived from the Galaxy theme's bake (`src/themes/galaxy/galaxy-bake-data.js` `bakeNoise`,
 * `noiseMips`; theme code is never imported into Odyssey): periodic fBm gradient noise, four
 * decorrelated channels stretched to [0, 1], and its 2 x 2 box mip chain. Three-free and seeded, in
 * steps so a chapter build can yield between octaves.
 */

export const SPIRAL_GALAXY_NOISE = Object.freeze({ size: 256, seed: 4242 });

const TAU = Math.PI * 2;

function mulberry32(seed) {
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
 * The field (size x size x 4, floats in [0, 1]) and its mip chain, in steps (one per octave of a
 * channel).
 * @returns {Generator<string, { field: Float32Array, mips: { data: Float32Array, width: number }[] }>}
 */
export function* bakeSpiralGalaxyNoiseSteps(spec = SPIRAL_GALAXY_NOISE) {
    /** @type {number} */
    const n = spec.size;
    const rand = mulberry32(spec.seed);
    const base = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * ((v * ((v * 6) - 15)) + 10);
    for (let c = 0; c < 4; c += 1) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o += 1) {
            const period = 4 << o;
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
                    const i00 = (y0 * period) + x0;
                    const i10 = (y0 * period) + x1;
                    const i01 = (y1 * period) + x0;
                    const i11 = (y1 * period) + x1;
                    const d00 = (gx[i00] * tx) + (gy[i00] * ty);
                    const d10 = (gx[i10] * (tx - 1)) + (gy[i10] * ty);
                    const d01 = (gx[i01] * tx) + (gy[i01] * (ty - 1));
                    const d11 = (gx[i11] * (tx - 1)) + (gy[i11] * (ty - 1));
                    const top = d00 + ((d10 - d00) * sx);
                    const bottom = d01 + ((d11 - d01) * sx);
                    field[(y * n) + x] += (top + ((bottom - top) * sy)) * amp;
                }
            }
            amp *= 0.5;
            yield 'galaxy-noise';
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i += 1) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i += 1) base[(i * 4) + c] = (field[i] - lo) * inv;
    }
    // The mip chain: 2 x 2 box filter down to 1 x 1.
    const mips = [];
    let level = base;
    let w = n;
    for (;;) {
        mips.push({ data: level, width: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y += 1) {
            for (let x = 0; x < nw; x += 1) {
                const a = ((y * 2 * w) + (x * 2)) * 4;
                const b = a + 4;
                const c = a + (w * 4);
                const d = c + 4;
                const o = ((y * nw) + x) * 4;
                for (let k = 0; k < 4; k += 1) {
                    next[o + k] = (level[a + k] + level[b + k] + level[c + k] + level[d + k]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    return { field: base, mips };
}

/** The whole bake at once (tests, headless). */
export function bakeSpiralGalaxyNoise(spec = SPIRAL_GALAXY_NOISE) {
    const steps = bakeSpiralGalaxyNoiseSteps(spec);
    let next = steps.next();
    while (!next.done) next = steps.next();
    return next.value;
}
