/**
 * Winter — the ground as numbers. Three-free.
 *
 *  - The fan: the eye barely moves, so the ground is one fan of quads opened from under it —
 *    rings a hand apart at the viewer's feet, a hundred metres apart on the fells — over the
 *    plan in winter-core.js (snowfield, lake, spits, far shore, fells).
 *  - The moon shadows: the moon does not move either, so what the trees throw on the snow is
 *    drawn once, on the CPU: every tree's mesh is laid flat along the moon's rays into one mask
 *    and softened.
 */

import {
    DEG, EYE, groundSample, smooth,
} from './winter-core.js';
import { ghostMesh } from './winter-ghosts.js';

/** The fan opens this far to each side of the view axis, from `near` to `far` metres. */
export const FAN = Object.freeze({ half: 52 * DEG, near: 2.2, far: 11000 });

/**
 * @param {[number, number]} size  [rings, columns]
 * @returns {{ positions: Float32Array, normals: Float32Array, ground: Float32Array,
 *             indices: Uint32Array, rings: number, columns: number }}
 *   ground = per vertex (lake 0..1, wood 0..1, metres inland (clamped), distance from the eye)
 */
export function buildGroundFan([rings, columns]) {
    const count = (rings + 1) * (columns + 1);
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const ground = new Float32Array(count * 4);
    const sample = [0, 0];
    const growth = Math.log(FAN.far / FAN.near);
    const row = columns + 1;
    // One evaluation of the plan for each vertex...
    for (let j = 0; j <= rings; j++) {
        const r = FAN.near * Math.exp((j / rings) * growth);
        for (let i = 0; i <= columns; i++) {
            const az = ((i / columns) * 2 - 1) * FAN.half;
            const x = EYE.x + Math.sin(az) * r;
            const z = EYE.z - Math.cos(az) * r;
            groundSample(x, z, sample);
            const y = sample[0];
            const land = sample[1];
            const v = j * row + i;
            positions.set([x, y, z], v * 3);
            // Where the wood stands: inland, below the tree line, beyond the lake.
            const wood = r > 190 ? smooth(2, 40, land) * (1 - smooth(22, 80, y)) : 0;
            ground.set([smooth(0.6, -1.4, land), wood, Math.max(-20, Math.min(60, land)), r], v * 4);
        }
    }
    // ... and its normal from its neighbours in the fan (outward × along the ring).
    for (let j = 0; j <= rings; j++) {
        const ja = Math.max(0, j - 1) * row;
        const jb = Math.min(rings, j + 1) * row;
        for (let i = 0; i <= columns; i++) {
            const ia = Math.max(0, i - 1);
            const ib = Math.min(columns, i + 1);
            const o = (ja + i) * 3;
            const p = (jb + i) * 3;
            const l = (j * row + ia) * 3;
            const q = (j * row + ib) * 3;
            const ox = positions[p] - positions[o];
            const oy = positions[p + 1] - positions[o + 1];
            const oz = positions[p + 2] - positions[o + 2];
            const ax = positions[q] - positions[l];
            const ay = positions[q + 1] - positions[l + 1];
            const az = positions[q + 2] - positions[l + 2];
            const nx = ay * oz - az * oy;
            const ny = az * ox - ax * oz;
            const nz = ax * oy - ay * ox;
            const len = Math.hypot(nx, ny, nz) || 1;
            const up = ny < 0 ? -1 / len : 1 / len;
            normals.set([nx * up, ny * up, nz * up], (j * row + i) * 3);
        }
    }
    const indices = new Uint32Array(rings * columns * 6);
    let o = 0;
    for (let j = 0; j < rings; j++) {
        for (let i = 0; i < columns; i++) {
            const a = j * (columns + 1) + i;
            const b = a + columns + 1;
            // (Counter-clockwise seen from above.)
            indices.set([a, a + 1, b, a + 1, b + 1, b], o);
            o += 6;
        }
    }
    return {
        positions, normals, ground, indices, rings, columns,
    };
}

/** The patch of snow the moon shadows are drawn for (metres). */
export const SHADOW_RECT = Object.freeze({
    x0: -72, z0: -120, width: 144, depth: 144,
});

function boxBlur(src, size, radius) {
    const tmp = new Float32Array(size * size);
    const out = new Float32Array(size * size);
    const span = radius * 2 + 1;
    for (let y = 0; y < size; y++) {
        let sum = 0;
        const row = y * size;
        for (let x = -radius; x <= radius; x++) sum += src[row + Math.max(0, Math.min(size - 1, x))];
        for (let x = 0; x < size; x++) {
            tmp[row + x] = sum / span;
            sum += src[row + Math.min(size - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
        }
    }
    for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let y = -radius; y <= radius; y++) sum += tmp[Math.max(0, Math.min(size - 1, y)) * size + x];
        for (let y = 0; y < size; y++) {
            out[y * size + x] = sum / span;
            sum += tmp[Math.min(size - 1, y + radius + 1) * size + x] - tmp[Math.max(0, y - radius) * size + x];
        }
    }
    return out;
}

/**
 * Draw what the trees throw on the snow.
 * @param {object[]} trees   plantTrees()
 * @param {object} ghosts    loadGhosts() / planGhosts()
 * @param {number[]} moon    unit vector toward the moon
 * @param {number} size      side of the mask (texels)
 * @returns {Uint8Array} size² : 255 = in the moon's light, 0 = in shadow; row 0 is z0
 */
export function bakeMoonShadows(trees, ghosts, moon, size, rect = SHADOW_RECT) {
    const light = new Float32Array(size * size).fill(1);
    const sx = size / rect.width;
    const sz = size / rect.depth;
    const fall = 1 / Math.max(0.12, moon[1]);
    let px = new Float32Array(0);
    let pz = new Float32Array(0);
    trees.forEach((tree) => {
        if (tree.lod > 2) return;
        // (A shadow is at most height / tan(elevation) long.)
        const reach = tree.height * fall + 6;
        if (tree.x < rect.x0 - reach || tree.x > rect.x0 + rect.width + reach) return;
        if (tree.z < rect.z0 - reach || tree.z > rect.z0 + rect.depth + reach) return;
        const mesh = ghostMesh(ghosts, tree.kind, 2);
        if (!mesh) return;
        const s = tree.height / mesh.height;
        const c = Math.cos(tree.turn) * s;
        const n = Math.sin(tree.turn) * s;
        const count = mesh.positions.length / 3;
        if (px.length < count) {
            px = new Float32Array(count);
            pz = new Float32Array(count);
        }
        for (let v = 0; v < count; v++) {
            const lx = mesh.positions[v * 3];
            const ly = Math.max(0, mesh.positions[v * 3 + 1]) * s;
            const lz = mesh.positions[v * 3 + 2];
            // Turned as the instance is turned (about y), then slid down the moon's ray.
            const wx = tree.x + lx * c + lz * n;
            const wz = tree.z - lx * n + lz * c;
            const k = ly * fall;
            px[v] = (wx - moon[0] * k - rect.x0) * sx;
            pz[v] = (wz - moon[2] * k - rect.z0) * sz;
        }
        const idx = mesh.indices;
        for (let t = 0; t < idx.length; t += 3) {
            const ax = px[idx[t]];
            const az = pz[idx[t]];
            const bx = px[idx[t + 1]];
            const bz = pz[idx[t + 1]];
            const cx = px[idx[t + 2]];
            const cz = pz[idx[t + 2]];
            const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
            if (Math.abs(area) < 1e-5) continue;
            const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
            const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
            const z0 = Math.max(0, Math.floor(Math.min(az, bz, cz)));
            const z1 = Math.min(size - 1, Math.ceil(Math.max(az, bz, cz)));
            const sign = area > 0 ? 1 : -1;
            for (let j = z0; j <= z1; j++) {
                const qz = j + 0.5;
                for (let i = x0; i <= x1; i++) {
                    const qx = i + 0.5;
                    const w0 = ((bx - ax) * (qz - az) - (bz - az) * (qx - ax)) * sign;
                    const w1 = ((cx - bx) * (qz - bz) - (cz - bz) * (qx - bx)) * sign;
                    const w2 = ((ax - cx) * (qz - cz) - (az - cz) * (qx - cx)) * sign;
                    if (w0 >= 0 && w1 >= 0 && w2 >= 0) light[j * size + i] = 0;
                }
            }
        }
    });
    // A penumbra about a third of a metre wide.
    const radius = Math.max(1, Math.round((0.16 * size) / rect.width));
    const soft = boxBlur(boxBlur(light, size, radius), size, radius);
    const out = new Uint8Array(size * size);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, soft[i])) * 255);
    // The mask's rim is always lit: outside it nothing is shadowed.
    for (let i = 0; i < size; i++) {
        out[i] = 255;
        out[(size - 1) * size + i] = 255;
        out[i * size] = 255;
        out[i * size + size - 1] = 255;
    }
    return out;
}
