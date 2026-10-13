/**
 * High Coast — the baked heightfields (CPU only, three-free).
 *
 * Three nested square fields (FIELDS in core): near, mid and far. Each is stored as an 8-bit
 * RGBA PNG written by scripts/high-coast/bake-coast.mjs:
 *
 *   R·256 + G   height, 16 bits over the field's [lo, hi]
 *   B           sky visibility (how much of the sky a point sees), 0..255
 *   A           cover: forest density, 0..255 (the shingle and heath masks are the plan's)
 *
 * A point is read from the finest field that holds it, blended into the next one out across
 * FIELD_BLEND metres at the edge, so the land is one surface.
 */
import {
    FIELDS, FIELD_BLEND, FIELD_ORDER, clamp,
} from './high-coast-core.js';

/** Heights (metres), sky and drainage → the PNG's RGBA bytes. */
export function encodeField(heights, sky, flow, field) {
    const n = field.size * field.size;
    const out = new Uint8Array(n * 4);
    const scale = 65535 / (field.hi - field.lo);
    for (let i = 0; i < n; i++) {
        const q = Math.max(0, Math.min(65535, Math.round((heights[i] - field.lo) * scale)));
        out[i * 4] = q >> 8;
        out[i * 4 + 1] = q & 255;
        out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(sky[i] * 255)));
        out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(flow[i] * 255)));
    }
    return out;
}

/** The PNG's RGBA bytes → heights (metres), sky and drainage (bytes). */
export function decodeField(rgba, field) {
    const n = field.size * field.size;
    const heights = new Float32Array(n);
    const sky = new Uint8Array(n);
    const flow = new Uint8Array(n);
    const scale = (field.hi - field.lo) / 65535;
    for (let i = 0; i < n; i++) {
        heights[i] = field.lo + (rgba[i * 4] * 256 + rgba[i * 4 + 1]) * scale;
        sky[i] = rgba[i * 4 + 2];
        flow[i] = rgba[i * 4 + 3];
    }
    return { heights, sky, flow };
}

/** Grid coordinates of a world point in a field (may lie outside 0..size − 1). */
export function fieldCoords(field, x, z, out = { fx: 0, fz: 0 }) {
    const k = (field.size - 1) / field.span;
    out.fx = (x - field.x0) * k;
    out.fz = (z - field.z0) * k;
    return out;
}

/** True when (x, z) lies inside a field's grid. */
export function inField(field, x, z) {
    return x >= field.x0 && z >= field.z0 && x <= field.x0 + field.span && z <= field.z0 + field.span;
}

/** How far inside a field (metres) a point lies: negative outside. */
export function fieldInset(field, x, z) {
    return Math.min(x - field.x0, field.x0 + field.span - x, z - field.z0, field.z0 + field.span - z);
}

const _c = { fx: 0, fz: 0 };

/** Bilinear read of a Float32 grid at grid coordinates (clamped to the grid). */
export function bilinear(grid, size, fx, fz) {
    const x = clamp(fx, 0, size - 1.0001);
    const z = clamp(fz, 0, size - 1.0001);
    const i = Math.floor(x);
    const j = Math.floor(z);
    const tx = x - i;
    const tz = z - j;
    const o = j * size + i;
    const a = grid[o];
    const b = grid[o + 1];
    const c = grid[o + size];
    const d = grid[o + size + 1];
    return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz;
}

const _wx = [0, 0, 0, 0];
const _wz = [0, 0, 0, 0];

/** Catmull-Rom (bicubic) read: smooth enough that a mesh finer than the grid shows no facets. */
export function bicubic(grid, size, fx, fz) {
    const x = clamp(fx, 1, size - 2.0001);
    const z = clamp(fz, 1, size - 2.0001);
    const i = Math.floor(x);
    const j = Math.floor(z);
    const tx = x - i;
    const tz = z - j;
    const wx = cubicWeights(tx, _wx);
    const wz = cubicWeights(tz, _wz);
    let sum = 0;
    for (let m = -1; m <= 2; m++) {
        const row = (j + m) * size;
        const w = wz[m + 1];
        sum += w * (grid[row + i - 1] * wx[0] + grid[row + i] * wx[1] + grid[row + i + 1] * wx[2] + grid[row + i + 2] * wx[3]);
    }
    return sum;
}
function cubicWeights(t, out) {
    const t2 = t * t;
    const t3 = t2 * t;
    out[0] = -0.5 * t3 + t2 - 0.5 * t;
    out[1] = 1.5 * t3 - 2.5 * t2 + 1;
    out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
    out[3] = 0.5 * t3 - 0.5 * t2;
    return out;
}

/**
 * The land's height at (x, z): the finest field that holds the point, blended into the next one
 * out near its edge. `fields` maps a field name to `{ heights }` (decoded or planned).
 */
export function groundHeight(fields, x, z, cubic = false) {
    let h = null;
    for (let k = FIELD_ORDER.length - 1; k >= 0; k--) {
        const name = FIELD_ORDER[k];
        const def = FIELDS[name];
        const data = fields[name];
        if (!data || !inField(def, x, z)) continue;
        fieldCoords(def, x, z, _c);
        const here = cubic ? bicubic(data.heights, def.size, _c.fx, _c.fz) : bilinear(data.heights, def.size, _c.fx, _c.fz);
        if (h === null || !FIELD_BLEND[name]) h = here;
        else {
            const w = clamp(fieldInset(def, x, z) / FIELD_BLEND[name], 0, 1);
            h += (here - h) * w * w * (3 - 2 * w);
        }
    }
    return h ?? FIELDS.far.lo;
}

/** A field's byte channel (sky or flow) at (x, z), 0..1, from the finest field holding it. */
export function groundByte(fields, channel, x, z) {
    for (let k = 0; k < FIELD_ORDER.length; k++) {
        const name = FIELD_ORDER[k];
        const def = FIELDS[name];
        const data = fields[name];
        if (!data?.[channel] || !inField(def, x, z)) continue;
        fieldCoords(def, x, z, _c);
        const i = clamp(Math.round(_c.fx), 0, def.size - 1);
        const j = clamp(Math.round(_c.fz), 0, def.size - 1);
        return data[channel][j * def.size + i] / 255;
    }
    return 0;
}

/** World position of grid post (i, j) of a field. */
export function postX(field, i) {
    return field.x0 + (i / (field.size - 1)) * field.span;
}
export function postZ(field, j) {
    return field.z0 + (j / (field.size - 1)) * field.span;
}
