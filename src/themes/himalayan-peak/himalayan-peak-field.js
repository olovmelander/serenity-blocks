/**
 * Himalayan Peak — heightfield maths (CPU only, three-free).
 *
 * Everything the theme derives from the baked heights when it starts:
 *
 *  - the shading map (surface normal, sky visibility, how hollow the ground is);
 *  - the amphitheatre's own shadow for EVERY elevation of the sun at once. The sun only ever
 *    moves up and down one azimuth, so on the ground one number per point says it all (the
 *    lowest elevation that clears the horizon toward the sun), and in the air the height the
 *    shadow stands at is kept for four elevations and blended;
 *  - the mesh, cut for the one eye that looks at it: back faces, ground under the cloud and
 *    slopes hidden behind nearer ridges are never built, and what is left is ordered front to
 *    back.
 */

import {
    EYE, GRID, HEIGHT_RANGE, SHADOW_TAN, SUN_AZIMUTH,
} from './himalayan-peak-core.js';

/** Bilinear height at a world point; far below the cloud outside the grid. */
export function sampleField(heights, size, x, z) {
    const fx = ((x - GRID.x0) / GRID.span) * (size - 1);
    const fz = ((z - GRID.z0) / GRID.span) * (size - 1);
    if (fx < 0 || fz < 0 || fx > size - 1 || fz > size - 1) return HEIGHT_RANGE.min;
    const i = Math.min(size - 2, Math.floor(fx));
    const j = Math.min(size - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const o = j * size + i;
    const a = heights[o];
    const b = heights[o + 1];
    const c = heights[o + size];
    const d = heights[o + size + 1];
    return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz;
}

/** Heights and sky visibility → the RGBA bytes of `massif.png` (R·256 + G = height, B = sky). */
export function encodeMassif(heights, sky, size) {
    const out = new Uint8Array(size * size * 4);
    const scale = 65535 / (HEIGHT_RANGE.max - HEIGHT_RANGE.min);
    for (let i = 0; i < size * size; i++) {
        const q = Math.max(0, Math.min(65535, Math.round((heights[i] - HEIGHT_RANGE.min) * scale)));
        out[i * 4] = q >> 8;
        out[i * 4 + 1] = q & 255;
        out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(sky[i] * 255)));
        out[i * 4 + 3] = 255;
    }
    return out;
}

/** The RGBA bytes of `massif.png` → heights (metres) and sky visibility (0..1 as bytes). */
export function decodeMassif(rgba, size) {
    const heights = new Float32Array(size * size);
    const sky = new Uint8Array(size * size);
    const scale = (HEIGHT_RANGE.max - HEIGHT_RANGE.min) / 65535;
    for (let i = 0; i < size * size; i++) {
        heights[i] = HEIGHT_RANGE.min + (rgba[i * 4] * 256 + rgba[i * 4 + 1]) * scale;
        sky[i] = rgba[i * 4 + 2];
    }
    return { heights, sky };
}

/**
 * The shading map: (normal.x, normal.z, sky visibility, hollowness) as bytes. Hollowness is 0.5
 * on a plane, above it in a gully (where snow lies) and below it on a rib (where rock shows).
 */
export function shadeMap(heights, sky, size) {
    const out = new Uint8Array(size * size * 4);
    const cell = GRID.span / (size - 1);
    const at = (i, j) => heights[Math.max(0, Math.min(size - 1, j)) * size + Math.max(0, Math.min(size - 1, i))];
    // The slope is read off the ground a little smoothed (a Sobel pair): the rain leaves it rough
    // at the scale of one cell, and a normal per cell reads as a grid of dots on a lit face.
    const across = (i, j) => at(i, j - 1) + 2 * at(i, j) + at(i, j + 1);
    const along = (i, j) => at(i - 1, j) + 2 * at(i, j) + at(i + 1, j);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const gx = (across(i + 1, j) - across(i - 1, j)) / (8 * cell);
            const gz = (along(i, j + 1) - along(i, j - 1)) / (8 * cell);
            const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1);
            const h = at(i, j);
            const ring = (at(i + 3, j) + at(i - 3, j) + at(i, j + 3) + at(i, j - 3)
                + at(i + 2, j + 2) + at(i - 2, j + 2) + at(i + 2, j - 2) + at(i - 2, j - 2)) / 8;
            const hollow = (ring - h) / (cell * 3);
            const o = (j * size + i) * 4;
            out[o] = Math.round((-gx * inv * 0.5 + 0.5) * 255);
            out[o + 1] = Math.round((-gz * inv * 0.5 + 0.5) * 255);
            out[o + 2] = sky[j * size + i];
            out[o + 3] = Math.max(0, Math.min(255, Math.round((0.5 + hollow * 1.6) * 255)));
        }
    }
    return out;
}

/** tan(elevation) the horizon map is clamped to. */
export const HORIZON_RANGE = Object.freeze([-0.4, 1.0]);

/**
 * The horizon toward the sun.
 *
 * The sun only ever moves up and down one azimuth, so whether a point is lit is one number: the
 * tangent of the lowest elevation at which the sun clears everything between it and the point.
 * It is found exactly, along every line that runs toward the sun, by walking the line away from
 * the sun and keeping the upper hull of the ground already passed: the horizon of the next point
 * is the hull's last corner.
 *
 * @returns {Float32Array} size² × 2: (the ground's horizon, the horizon of the cloud sea's top
 *   at y = 0 over the same spot), both as tan(elevation), clamped to HORIZON_RANGE.
 */
export function horizonMap(heights, size) {
    const cell = GRID.span / (size - 1);
    const sz = Math.cos(SUN_AZIMUTH);
    // One row farther from the sun (+z) is this many columns west, and this far along the ground.
    const shift = Math.sin(SUN_AZIMUTH) / sz;
    const run = cell / sz;
    const lineCount = size + Math.ceil(shift * (size - 1)) + 1;
    const ground = new Float32Array(lineCount * size);
    const cloud = new Float32Array(lineCount * size);
    const profile = new Float32Array(size);
    const stack = new Int32Array(size);
    const [lo, hi] = HORIZON_RANGE;
    for (let line = 0; line < lineCount; line++) {
        let depth = 0;
        for (let j = 0; j < size; j++) {
            const c = line - shift * j;
            const i = Math.floor(c);
            let g = lo;
            let k = lo;
            if (i >= 0 && i < size) {
                const h = i + 1 < size ? heights[j * size + i] + (heights[j * size + i + 1] - heights[j * size + i]) * (c - i) : heights[j * size + i];
                profile[j] = h;
                // The cloud top over this spot sees the hull of everything already passed. Walking
                // back along the hull the tangent rises to the corner that is the horizon, then
                // falls: stop at the first fall (not at the clamp floor, which a corner under the
                // cloud can sit below).
                let last = -Infinity;
                for (let s = depth - 1; s >= 0; s--) {
                    const t = profile[stack[s]] / ((j - stack[s]) * run);
                    if (t < last) break;
                    last = t;
                }
                if (last > k) k = last;
                while (depth >= 2) {
                    const a = stack[depth - 2];
                    const b = stack[depth - 1];
                    // Drop the last corner while it lies under the line from the one before it.
                    if ((profile[b] - profile[a]) * (j - a) <= (h - profile[a]) * (b - a)) depth -= 1;
                    else break;
                }
                if (depth >= 1) g = (profile[stack[depth - 1]] - h) / ((j - stack[depth - 1]) * run);
                stack[depth] = j;
                depth += 1;
            } else {
                depth = 0;
            }
            ground[line * size + j] = g < lo ? lo : Math.min(hi, g);
            cloud[line * size + j] = k < lo ? lo : Math.min(hi, k);
        }
    }
    // Every grid point lies between two lines.
    const out = new Float32Array(size * size * 2);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const c = i + shift * j;
            const a = Math.floor(c);
            const f = c - a;
            const o = (j * size + i) * 2;
            const p0 = a * size + j;
            const p1 = Math.min(lineCount - 1, a + 1) * size + j;
            // At the grid's west and east edges one of the two lines is off the grid at this
            // row and has no history: the other speaks alone.
            let w = f;
            if (i - f < 0) w = 1;
            else if (i + 1 - f > size - 1) w = 0;
            out[o] = ground[p0] + (ground[p1] - ground[p0]) * w;
            out[o + 1] = cloud[p0] + (cloud[p1] - cloud[p0]) * w;
        }
    }
    return out;
}

/**
 * The height the amphitheatre's shadow stands at in the AIR, for the four baked elevations (the
 * haze, the blown snow and the paper horses are lit above it). It is a maximum of terms linear
 * in tan(elevation), so a blend of two slices is close; it is kept small and soft.
 * @returns {{ volume: Float32Array, low: Float32Array, lowSize: number }}
 *   `volume`: lowSize² × 4 heights (metres), one per slice; `low`: lowSize², the ground itself.
 */
export function shadowSlices(heights, size, lowSize = 256) {
    const cell = GRID.span / (size - 1);
    const sz = Math.cos(SUN_AZIMUTH);
    const shift = Math.sin(SUN_AZIMUTH) / sz;
    const run = cell / sz;
    const block = size / lowSize;
    const volume = new Float32Array(lowSize * lowSize * 4);
    const low = new Float32Array(lowSize * lowSize);
    const prev = new Float32Array(size);
    const row = new Float32Array(size);
    const i0 = Math.floor(shift);
    const frac = shift - i0;
    const clear = HEIGHT_RANGE.min - 200;
    for (let s = 0; s < 4; s++) {
        const drop = run * SHADOW_TAN[s];
        for (let j = 0; j < size; j++) {
            for (let i = 0; i < size; i++) {
                const h = heights[j * size + i];
                let cast = clear;
                if (j > 0) {
                    const a = i + i0;
                    if (a + 1 < size) cast = prev[a] + (prev[a + 1] - prev[a]) * frac - drop;
                    else if (a < size) cast = prev[a] - drop;
                    if (cast < clear) cast = clear;
                }
                row[i] = cast > h ? cast : h;
                volume[(Math.floor(j / block) * lowSize + Math.floor(i / block)) * 4 + s] += cast;
            }
            prev.set(row);
        }
    }
    const inv = 1 / (block * block);
    for (let i = 0; i < volume.length; i++) volume[i] *= inv;
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            low[Math.floor(j / block) * lowSize + Math.floor(i / block)] += heights[j * size + i] * inv;
        }
    }
    return { volume, low, lowSize };
}

/** Height (metres) the shadow stands at over a world point for slice weights `w`. CPU twin. */
export function shadowHeight(volume, lowSize, x, z, w) {
    const fx = ((x - GRID.x0) / GRID.span) * lowSize - 0.5;
    const fz = ((z - GRID.z0) / GRID.span) * lowSize - 0.5;
    const i = Math.max(0, Math.min(lowSize - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(lowSize - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i));
    const tz = Math.max(0, Math.min(1, fz - j));
    let sum = 0;
    for (let s = 0; s < 4; s++) {
        if (w[s] === 0) continue;
        const o = (j * lowSize + i) * 4 + s;
        const a = volume[o];
        const b = volume[o + 4];
        const c = volume[o + lowSize * 4];
        const d = volume[o + lowSize * 4 + 4];
        sum += (a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz) * w[s];
    }
    return sum;
}

/** Ground lower than this is under the cloud sea for good and is never drawn. */
export const CLOUD_CUT = -300;
/** Half the wedge of ground the eye can ever see (the widest screens), radians. */
export const WEDGE = 64 * (Math.PI / 180);

/**
 * Build the mesh of what the eye can see.
 * @param {Float32Array} heights
 * @param {number} size
 * @param {object} [options]
 * @param {number} [options.stride=1]  grid cells per mesh cell
 * @returns {{ positions: Float32Array, indices: Uint32Array, cells: number, kept: number }}
 */
export function buildMassifMesh(heights, size, { stride = 1 } = {}) {
    const cell = GRID.span / (size - 1);
    const n = Math.floor((size - 1) / stride) + 1;
    const step = cell * stride;
    const at = (i, j) => heights[Math.min(size - 1, j * stride) * size + Math.min(size - 1, i * stride)];

    // ── The horizon the eye sees along each azimuth, as a running maximum outward ──
    const bins = 1536;
    const rings = Math.ceil((GRID.span * 1.3) / cell);
    const horizon = new Float32Array(bins * rings);
    for (let b = 0; b < bins; b++) {
        const a = -WEDGE + ((b + 0.5) / bins) * 2 * WEDGE;
        const dx = Math.sin(a);
        const dz = -Math.cos(a);
        let top = -1e3;
        for (let k = 0; k < rings; k++) {
            const r = (k + 1) * cell;
            const h = sampleField(heights, size, EYE.x + dx * r, EYE.z + dz * r);
            const t = (h - EYE.y) / r;
            if (t > top) top = t;
            horizon[b * rings + k] = top;
        }
    }
    const seen = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const x = GRID.x0 + i * step - EYE.x;
            const z = GRID.z0 + j * step - EYE.z;
            const r = Math.hypot(x, z);
            if (r < 450) {
                seen[j * n + i] = 1;
                continue;
            }
            const a = Math.atan2(x, -z);
            if (Math.abs(a) >= WEDGE) continue;
            const b = Math.min(bins - 1, Math.floor(((a + WEDGE) / (2 * WEDGE)) * bins));
            // Compare with the horizon a little nearer than the point itself.
            const k = Math.floor(r / cell) - 3 - stride;
            if (k < 0) {
                seen[j * n + i] = 1;
                continue;
            }
            const t = (at(i, j) - EYE.y) / r;
            if (t >= horizon[b * rings + k] - 0.006) seen[j * n + i] = 1;
        }
    }

    // ── Keep the cells that face the eye, rise out of the cloud and are seen ──
    const cellSeen = (i, j) => {
        for (let dj = -1; dj <= 2; dj++) {
            for (let di = -1; di <= 2; di++) {
                const a = i + di;
                const b = j + dj;
                if (a >= 0 && b >= 0 && a < n && b < n && seen[b * n + a]) return true;
            }
        }
        return false;
    };
    const BUCKETS = 512;
    const counts = new Uint32Array(BUCKETS + 1);
    const cellsKept = [];
    const cellBucket = [];
    for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
            const h00 = at(i, j);
            const h10 = at(i + 1, j);
            const h01 = at(i, j + 1);
            const h11 = at(i + 1, j + 1);
            if (Math.max(h00, h10, h01, h11) < CLOUD_CUT) continue;
            if (!cellSeen(i, j)) continue;
            const cx = GRID.x0 + (i + 0.5) * step - EYE.x;
            const cz = GRID.z0 + (j + 0.5) * step - EYE.z;
            const cy = (h00 + h10 + h01 + h11) * 0.25 - EYE.y;
            const r = Math.hypot(cx, cz);
            // Its two triangles against the line to the eye (far cells only: near ones may
            // turn). A cell folded along a gully can face both ways: it goes only if both do.
            if (r > 900) {
                const away = (nx, nz) => -(nx * cx + step * cy + nz * cz)
                    < -0.05 * Math.hypot(nx, step, nz) * Math.hypot(cx, cy, cz);
                if (away(h00 - h10, h00 - h01) && away(h01 - h11, h10 - h11)
                    && away(h00 - h10, h10 - h11) && away(h01 - h11, h00 - h01)) continue;
            }
            const bucket = Math.min(BUCKETS - 1, Math.floor((Math.log(Math.max(40, r) / 40) / Math.log(600)) * BUCKETS));
            cellsKept.push(j * n + i);
            cellBucket.push(bucket);
            counts[bucket + 1] += 1;
        }
    }
    for (let b = 0; b < BUCKETS; b++) counts[b + 1] += counts[b];
    const order = new Uint32Array(cellsKept.length);
    const cursor = counts.slice(0, BUCKETS);
    for (let c = 0; c < cellsKept.length; c++) {
        order[cursor[cellBucket[c]]] = cellsKept[c];
        cursor[cellBucket[c]] += 1;
    }

    // ── Vertices in the order they are first used; indices front to back ──
    const remap = new Int32Array(n * n).fill(-1);
    const positions = [];
    const indices = new Uint32Array(order.length * 6);
    const vertex = (i, j) => {
        const id = j * n + i;
        if (remap[id] < 0) {
            remap[id] = positions.length / 3;
            positions.push(GRID.x0 + i * step, at(i, j), GRID.z0 + j * step);
        }
        return remap[id];
    };
    for (let c = 0; c < order.length; c++) {
        const i = order[c] % n;
        const j = Math.floor(order[c] / n);
        const a = vertex(i, j);
        const b = vertex(i + 1, j);
        const d = vertex(i, j + 1);
        const e = vertex(i + 1, j + 1);
        // Split along the diagonal that bends less.
        const flat = Math.abs(at(i, j) - at(i + 1, j + 1)) < Math.abs(at(i + 1, j) - at(i, j + 1));
        if (flat) indices.set([a, d, e, a, e, b], c * 6);
        else indices.set([a, d, b, b, d, e], c * 6);
    }
    return {
        positions: new Float32Array(positions), indices, cells: (n - 1) * (n - 1), kept: order.length,
    };
}
