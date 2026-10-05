/**
 * Deterministic CPU noise for the Aurora artwork bakes: the shared GPU noise tile, the
 * mountain heightfield and the star catalogue. Nothing here touches three or the DOM,
 * so every bake is reproducible from its seed and testable in plain node.
 */

/** Integer lattice hash → [0, 1). */
export function hash2(ix, iy, seed = 0) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** Small seeded generator (mulberry32) for placement and catalogues. */
export function createRandom(seed = 1) {
    let state = seed >>> 0;
    return function random() {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const wrap = (value, period) => (period > 0 ? ((value % period) + period) % period : value);

/**
 * Smooth value noise in [0, 1]. A positive `period` wraps the lattice so the result
 * tiles every `period` units on both axes.
 */
export function valueNoise2(x, y, seed = 0, period = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const x0 = wrap(ix, period);
    const x1 = wrap(ix + 1, period);
    const y0 = wrap(iy, period);
    const y1 = wrap(iy + 1, period);
    const a = hash2(x0, y0, seed);
    const b = hash2(x1, y0, seed);
    const c = hash2(x0, y1, seed);
    const d = hash2(x1, y1, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise in [0, 1]; `period` (in base-octave cells) keeps it tileable. */
export function fbm2(x, y, {
    seed = 0, octaves = 4, lacunarity = 2, gain = 0.5, period = 0,
} = {}) {
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let weight = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
        total += amplitude * valueNoise2(x * frequency, y * frequency, seed + octave * 131, period * frequency);
        weight += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return total / weight;
}

/** Ridged multifractal in [0, 1]: sharp crests, broad valleys. */
export function ridged2(x, y, {
    seed = 0, octaves = 5, lacunarity = 2.07, gain = 0.5, sharpness = 2,
} = {}) {
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let weight = 0;
    let previous = 1;
    for (let octave = 0; octave < octaves; octave += 1) {
        const sample = valueNoise2(x * frequency, y * frequency, seed + octave * 197);
        const ridge = (1 - Math.abs(sample * 2 - 1)) ** sharpness;
        // Detail gathers on existing crests, which is what makes a range read as eroded.
        total += amplitude * ridge * previous;
        weight += amplitude;
        previous = Math.min(1, ridge * 1.6 + 0.2);
        amplitude *= gain;
        frequency *= lacunarity;
    }
    return total / weight;
}

/**
 * The one noise tile every Aurora shader samples. RGBA8, tileable on both axes:
 *   R  fine structure (auroral ray striations, water glitter)
 *   G  fine structure, decorrelated from R
 *   B  broad structure (ray height, brightness patches)
 *   A  broad structure, decorrelated from B
 * Each channel is stretched to the full byte range so thresholds stay predictable.
 */
export function bakeAuroraNoise(size = 256, seed = 4177) {
    const channels = [
        { seed: seed + 11, period: 32, octaves: 4 },
        { seed: seed + 523, period: 32, octaves: 4 },
        { seed: seed + 1009, period: 8, octaves: 3 },
        { seed: seed + 2203, period: 8, octaves: 3 },
    ];
    const data = new Uint8Array(size * size * 4);
    const plane = new Float32Array(size * size);
    channels.forEach((channel, index) => {
        let low = Infinity;
        let high = -Infinity;
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const value = fbm2((x / size) * channel.period, (y / size) * channel.period, channel);
                plane[y * size + x] = value;
                if (value < low) low = value;
                if (value > high) high = value;
            }
        }
        const scale = 255 / Math.max(1e-6, high - low);
        for (let i = 0; i < plane.length; i += 1) {
            data[i * 4 + index] = Math.round((plane[i] - low) * scale);
        }
    });
    return data;
}
