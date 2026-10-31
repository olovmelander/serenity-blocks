// @ts-check
/**
 * @fileoverview THE GAS OF ODYSSEY'S BLACK HOLE (2026-10-31, the space masterpiece pass): the
 * accretion texture the lens (odyssey-gargantua-lens.tsl.js) shears round the hole.
 *
 * Re-derived from the Black Hole theme's bake (`src/themes/black-hole/black-hole-noise.js`
 * `bakeDiskTextureSteps`; theme code is never imported into Odyssey): the same seeded value noise
 * and the same four channels, so the gas reads the way the theme's Gargantua does. Three-free and
 * deterministic, so a test can read it in Node.
 *   R  broad lanes       G  fine streaks
 *   B  hot clumps        A  gaps between lanes (ridged)
 * `u` runs once round the disk (tileable), `v` from the inner edge to the outer (tileable too: the
 * lens reads a finer octave by repeating the tile).
 */

export const GARGANTUA_GAS = Object.freeze({
    width: 512,
    height: 128,
    seed: 7919,
    /** Rows baked before the build yields to the frame. */
    rowsPerStep: 16,
});

/** Integer lattice hash -> [0, 1). */
function hash3(ix, iy, iz, seed) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263)
        ^ Math.imul(iz | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (value, period) => (period > 0 ? ((value % period) + period) % period : value);

/** Smooth value noise in [0, 1]; a positive period wraps the lattice along that axis. */
function valueNoise2(x, y, seed, periodX, periodY) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const ux = fade(x - ix);
    const uy = fade(y - iy);
    const x0 = wrap(ix, periodX);
    const x1 = wrap(ix + 1, periodX);
    const y0 = wrap(iy, periodY);
    const y1 = wrap(iy + 1, periodY);
    const a = hash3(x0, y0, 0, seed);
    const b = hash3(x1, y0, 0, seed);
    const c = hash3(x0, y1, 0, seed);
    const d = hash3(x1, y1, 0, seed);
    return a + ((b - a) * ux) + ((c - a) * uy) + ((a - b - c + d) * ux * uy);
}

function fbm2(x, y, seed, octaves, periodX, periodY) {
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let weight = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
        total += amplitude * valueNoise2(
            x * frequency,
            y * frequency,
            seed + (octave * 131),
            periodX * frequency,
            periodY * frequency,
        );
        weight += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return total / weight;
}

/** @type {ReadonlyArray<{ seed: number, periodX: number, periodY: number, octaves: number, ridged: boolean }>} */
const CHANNELS = Object.freeze([
    Object.freeze({
        seed: 11, periodX: 3, periodY: 9, octaves: 4, ridged: false,
    }),
    Object.freeze({
        seed: 523, periodX: 12, periodY: 44, octaves: 3, ridged: false,
    }),
    Object.freeze({
        seed: 1009, periodX: 14, periodY: 9, octaves: 2, ridged: false,
    }),
    Object.freeze({
        seed: 2203, periodX: 4, periodY: 13, octaves: 3, ridged: true,
    }),
]);

/**
 * The gas, RGBA8, in steps (yields every `rowsPerStep` rows of a channel). Each channel is
 * stretched to the full byte range so the lens's thresholds stay predictable.
 * @returns {Generator<string, Uint8Array>}
 */
export function* bakeGargantuaGasSteps(spec = GARGANTUA_GAS) {
    const { width, height, seed } = spec;
    const data = new Uint8Array(width * height * 4);
    const plane = new Float32Array(width * height);
    for (let index = 0; index < CHANNELS.length; index += 1) {
        const channel = CHANNELS[index];
        let low = Infinity;
        let high = -Infinity;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                let value = fbm2(
                    (x / width) * channel.periodX,
                    (y / height) * channel.periodY,
                    seed + channel.seed,
                    channel.octaves,
                    channel.periodX,
                    channel.periodY,
                );
                if (channel.ridged) value = 1 - Math.abs((value * 2) - 1);
                plane[(y * width) + x] = value;
                if (value < low) low = value;
                if (value > high) high = value;
            }
            if ((y + 1) % spec.rowsPerStep === 0) yield 'gas';
        }
        const scale = 255 / Math.max(1e-6, high - low);
        for (let i = 0; i < plane.length; i += 1) {
            data[(i * 4) + index] = Math.round((plane[i] - low) * scale);
        }
    }
    return data;
}

/** The whole bake at once (tests, headless). */
export function bakeGargantuaGas(spec = GARGANTUA_GAS) {
    const steps = bakeGargantuaGasSteps(spec);
    let next = steps.next();
    while (!next.done) next = steps.next();
    return next.value;
}
