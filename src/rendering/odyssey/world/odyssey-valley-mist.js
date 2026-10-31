/**
 * MIST IN THE HOLLOWS (round three, 2026-10-31) — the air's depth, lying where air pools.
 *
 * Olov: "Mist and depth in the air: soft haze lying in the valleys and hollows, so the forest and
 * hills stack in layers instead of reading flat." Aerial perspective here is a function of range
 * and height above the sea, so at the hundreds of units the chapter 3-4 eye sees, the forest in
 * the basin, the slopes behind it and the ridge beyond all hazed alike and stacked flat. The old
 * valley mist (a height veil) only woke once the eye climbed past ~350-470 u.
 *
 * Mist pools in HOLLOWS: ground lower than the land round it. So the island's height is sampled on
 * a grid and blurred wide (the land round each point); where the ground lies under that, the
 * difference is how deep a pool of mist it holds. The plate stores, per texel, the top of the mist
 * (the ground plus its pool) and the pool's depth. A fragment under the mist top is veiled by the
 * mist above it, on the slant the eye looks down through it: a valley floor goes soft, the crowns
 * of the trees in it and the ridges round it stand clear, and the hills separate into layers.
 *
 * Three-free: the bake runs on the CPU height mirror in Node for its test.
 */

export const ODYSSEY_VALLEY_MIST = Object.freeze({
    /** The plate: texels a side, over the relief plate's square (u). */
    res: 256,
    extent: 9000,
    /** The land round a point: a box blur this wide (u), repeated (three passes ~ a Gaussian). */
    blur: 260,
    passes: 3,
    /** A hollow must lie this far under the land round it before it holds mist (u). */
    margin: 5,
    /** The deepest pool (u). */
    maxDepth: 70,
    /**
     * Mist settles on floors, not on slopes: the pool thins out where the land round it (the
     * blurred surface) climbs between these grades (rise per u), so the foot of a long slope is
     * not draped in a sheet that follows it up. And one last soft blur of the depth (passes), so
     * every pool's edge feathers out over a hundred units or so.
     */
    slope: Object.freeze([0.30, 0.65]),
    feather: 1,
});

/**
 * Bake the mist plate: RGBA per texel, R = the mist's top (y), G = the pool's depth (u), B = 0,
 * A = 1, row-major from (-extent/2, -extent/2).
 * @param {(x:number, z:number) => number} heightAt the island's height
 * @param {number} seaLevel
 * @returns {{data: Float32Array, res: number, extent: number}}
 */
export function bakeValleyMist(heightAt, seaLevel, spec = ODYSSEY_VALLEY_MIST) {
    const n = spec.res;
    const texel = spec.extent / n;
    const ground = new Float32Array(n * n);
    for (let j = 0; j < n; j += 1) {
        const z = ((j + 0.5) * texel) - (spec.extent / 2);
        for (let i = 0; i < n; i += 1) {
            const x = ((i + 0.5) * texel) - (spec.extent / 2);
            // Over the sea the water is the floor the air lies on.
            ground[(j * n) + i] = Math.max(heightAt(x, z), seaLevel);
        }
    }
    // The land round each point: separable box blurs, clamped at the edges.
    const r = Math.max(1, Math.round(spec.blur / (2 * texel)));
    const a = Float32Array.from(ground);
    const b = new Float32Array(n * n);
    const boxRows = (src, dst) => {
        for (let j = 0; j < n; j += 1) {
            for (let i = 0; i < n; i += 1) {
                let sum = 0;
                for (let k = -r; k <= r; k += 1) sum += src[(j * n) + Math.min(n - 1, Math.max(0, i + k))];
                dst[(j * n) + i] = sum / ((2 * r) + 1);
            }
        }
    };
    const boxCols = (src, dst) => {
        for (let j = 0; j < n; j += 1) {
            for (let i = 0; i < n; i += 1) {
                let sum = 0;
                for (let k = -r; k <= r; k += 1) sum += src[(Math.min(n - 1, Math.max(0, j + k)) * n) + i];
                dst[(j * n) + i] = sum / ((2 * r) + 1);
            }
        }
    };
    for (let p = 0; p < spec.passes; p += 1) {
        boxRows(a, b);
        boxCols(b, a);
    }
    // The pools: how far the ground lies under the land round it, thinned on slopes.
    const smooth = (e0, e1, x) => {
        const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
        return k * k * (3 - (2 * k));
    };
    const pool = new Float32Array(n * n);
    for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
            const t = (j * n) + i;
            const gx = (a[(j * n) + Math.min(n - 1, i + 1)] - a[(j * n) + Math.max(0, i - 1)]) / (2 * texel);
            const gz = (a[(Math.min(n - 1, j + 1) * n) + i] - a[(Math.max(0, j - 1) * n) + i]) / (2 * texel);
            const flat = 1 - smooth(spec.slope[0], spec.slope[1], Math.hypot(gx, gz));
            pool[t] = Math.min(spec.maxDepth, Math.max(0, a[t] - ground[t] - spec.margin)) * flat;
        }
    }
    const feathered = new Float32Array(n * n);
    for (let p = 0; p < spec.feather; p += 1) {
        boxRows(pool, feathered);
        boxCols(feathered, pool);
    }
    const data = new Float32Array(n * n * 4);
    for (let t = 0; t < n * n; t += 1) {
        const g = ground[t];
        // (The low shore's mist is the renderer's layer, which thins with height over the sea.)
        const depth = pool[t];
        data[t * 4] = g + depth;
        data[(t * 4) + 1] = depth;
        data[(t * 4) + 2] = 0;
        data[(t * 4) + 3] = 1;
    }
    return { data, res: n, extent: spec.extent };
}

/** The plate's value at world (x, z), bilinear. For the bake's own test. */
export function sampleValleyMist(plate, x, z) {
    const n = plate.res;
    const fx = (((x / plate.extent) + 0.5) * n) - 0.5;
    const fz = (((z / plate.extent) + 0.5) * n) - 0.5;
    const i = Math.min(n - 2, Math.max(0, Math.floor(fx)));
    const j = Math.min(n - 2, Math.max(0, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - j));
    const at = (ii, jj, c) => plate.data[(((jj * n) + ii) * 4) + c];
    const lerp = (p, q, s) => p + ((q - p) * s);
    const read = (c) => lerp(lerp(at(i, j, c), at(i + 1, j, c), u), lerp(at(i, j + 1, c), at(i + 1, j + 1, c), u), v);
    return { top: read(0), depth: read(1) };
}
