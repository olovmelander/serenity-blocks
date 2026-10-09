#!/usr/bin/env node
/**
 * Winter — bake the snow ghosts.
 *
 * (Four meshes a kind: the full ghost, one for the framing trees that stand further off, one
 * for the stands on the spits, one for the wood on the far shore.)
 *
 * In Lapland's midwinter the spruces carry so much rime and snow ("tykky") that each becomes a
 * lumpy white figure with only its undersides dark. That shape is not a cone with a texture: it
 * is a pile of pillows, so it is modelled as one. Every ghost is a smooth union of ellipsoids
 * (a snow-buried stem, whorls of drooping boughs each under its pillow, a top bowed over by the
 * load), meshed with naive surface nets, and each vertex keeps what the shader needs:
 *
 *   normal       the field's gradient
 *   occlusion    how open the snow is to the sky (cavities between pillows are dark)
 *   needles      1 where the surface is a bough's dark underside, 0 where it is snow
 *   thinness     1 where the snow is thin enough for light to come through from behind
 *   height       0 at the foot, 1 at the top
 *
 * Output: src/themes/winter/assets/snow-ghosts.bin (+ snow-ghosts-manifest.json).
 *
 *   node scripts/winter/bake-ghosts.mjs               write the asset
 *   node scripts/winter/bake-ghosts.mjs --preview=dir also ray-cast each ghost to a PNG (CPU)
 *   node scripts/winter/bake-ghosts.mjs --check       bake in memory and compare with the manifest
 *
 * Deterministic: the same script gives the same bytes.
 */

import { createHash } from 'node:crypto';
import {
    existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(ROOT, 'src', 'themes', 'winter', 'assets');
const OUT_BIN = join(OUT_DIR, 'snow-ghosts.bin');
const OUT_MANIFEST = join(OUT_DIR, 'snow-ghosts-manifest.json');

const TAU = Math.PI * 2;

function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Noise ───────────────────────────────────────────────────────────────────────

function lattice3(ix, iy, iz) {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(iz | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function noise3(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const sz = fz * fz * (3 - 2 * fz);
    const c = (dx, dy, dz) => lattice3(ix + dx, iy + dy, iz + dz);
    const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * sx;
    const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * sx;
    const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * sx;
    const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * sx;
    const y0 = x00 + (x10 - x00) * sy;
    const y1 = x01 + (x11 - x01) * sy;
    return y0 + (y1 - y0) * sz;
}

// ── The ghosts ──────────────────────────────────────────────────────────────────

/**
 * What a ghost is made of: ellipsoids. `c` centre, `r` radii along the frame's axes, `m` the
 * frame (three unit vectors, rows), `needle` 1 for a bough's dark underside, `k` how softly it
 * melts into what is already there.
 */
function ball(list, c, radius, k = 0.2, needle = 0) {
    list.push({
        c, r: [radius, radius, radius], m: null, needle, k,
    });
}

function pillow(list, c, r, along, k = 0.2, needle = 0) {
    // A frame whose first axis runs along the bough.
    const ax = along;
    const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const x = [ax[0] / al, ax[1] / al, ax[2] / al];
    // Second axis: as near "up" as it can be while square to the first.
    let y = [-x[0] * x[1], 1 - x[1] * x[1], -x[2] * x[1]];
    const yl = Math.hypot(y[0], y[1], y[2]) || 1;
    y = [y[0] / yl, y[1] / yl, y[2] / yl];
    const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    list.push({
        c, r, m: [x, y, z], needle, k,
    });
}

/**
 * A snow-loaded spruce.
 * @param {object} s
 * @param {number} s.height   metres
 * @param {number} s.girth    radius of the lowest whorl (m)
 * @param {number} s.taper    how the whorls narrow (1 = a cone, <1 = fuller above)
 * @param {number} s.bow      how far the top is bent over by its load (m)
 * @param {number} s.lean     radians the whole tree leans
 * @param {number} s.load     0.6..1.4: how heavy the pillows are
 * @param {number} s.bare     0..1: how much dark bough shows under them
 * @param {number} s.flag     0..1: how much the windward side has lost its boughs
 */
function growSpruce(s, seed) {
    const rand = mulberry32(seed);
    const list = [];
    const H = s.height;
    const bowAz = rand() * TAU;
    const leanAz = bowAz + 0.8;
    const axis = (h) => {
        const t = h / H;
        const b = Math.max(0, (t - 0.68) / 0.32);
        const bend = b * b * s.bow;
        // The last of it hangs: the top is bent over and down.
        const sag = b * b * b * s.bow * 0.55;
        return [
            Math.cos(bowAz) * bend + Math.cos(leanAz) * Math.sin(s.lean) * h,
            h - sag,
            Math.sin(bowAz) * bend + Math.sin(leanAz) * Math.sin(s.lean) * h,
        ];
    };
    const girthAt = (h) => {
        const t = Math.min(1, h / H);
        return s.girth * (1 - t) ** s.taper * (1 + 0.1 * Math.sin(h * 2.3 + seed)) + 0.1;
    };
    // The mound the drift makes round the foot.
    pillow(list, [0, -0.24, 0], [s.girth * 1.0, 0.4, s.girth * 1.0], [1, 0, 0], 0.3);
    // The stem under its sleeve of rime.
    for (let h = 0.1; h < H * 0.985;) {
        const g = girthAt(h);
        const r = Math.max(0.1, g * 0.36 + 0.1);
        ball(list, axis(h), r, 0.16);
        h += r * 0.7;
    }
    // The whorls.
    let h = H * 0.07 + 0.25;
    let turn = rand() * TAU;
    while (h < H * 0.93) {
        const g = girthAt(h);
        const boughs = Math.max(3, Math.round(3.4 + 3.6 * (g / s.girth)));
        const base = axis(h);
        turn += 0.9 + rand() * 0.8;
        for (let j = 0; j < boughs; j++) {
            const a = turn + (j / boughs) * TAU + (rand() - 0.5) * 0.5;
            // The windward side of a flagged tree carries less.
            const facing = Math.cos(a - bowAz);
            if (s.flag > 0 && facing < -0.2 && rand() < s.flag * 0.75) continue;
            const reach = g * (0.72 + rand() * 0.5) * (1 - Math.max(0, -facing) * s.flag * 0.4);
            // Loaded boughs hang: lower ones more, and the tip most of all.
            const droop = (0.32 + 0.5 * rand()) * (0.8 + 0.4 * (1 - h / H)) * s.load;
            const dir = [Math.cos(a) * Math.cos(droop), -Math.sin(droop), Math.sin(a) * Math.cos(droop)];
            const mid = [base[0] + dir[0] * reach * 0.5, base[1] + dir[1] * reach * 0.5, base[2] + dir[2] * reach * 0.5];
            const thick = (0.2 * reach + 0.08) * s.load;
            pillow(list, mid, [reach * 0.56, thick, reach * 0.34 + 0.05], dir, 0.17);
            // The clump on the end, where the snow has slid and frozen.
            const tip = [base[0] + dir[0] * reach * 0.96, base[1] + dir[1] * reach * 0.96 - thick * 0.25, base[2] + dir[2] * reach * 0.96];
            ball(list, tip, (0.15 * reach + 0.07) * (0.8 + rand() * 0.5) * s.load, 0.13);
            // The bough itself, dark, showing under the pillow and a little beyond it.
            if (rand() < s.bare + 0.25) {
                const under = thick * 0.7 + 0.05;
                const out = 0.5 + s.bare * 0.16;
                pillow(
                    list,
                    [base[0] + dir[0] * reach * out, base[1] + dir[1] * reach * out - under, base[2] + dir[2] * reach * out],
                    [reach * (0.52 + s.bare * 0.12), 0.05 + reach * 0.05, reach * 0.3 + 0.04],
                    dir,
                    0.07,
                    1,
                );
            }
        }
        h += g * 0.36 + 0.3;
    }
    // The top: a chain bowed over, ending in a heavy head.
    for (let k = 0; k < 4; k++) {
        const t = 0.94 + k * 0.02;
        ball(list, axis(H * t), 0.2 - k * 0.022, 0.12);
    }
    const head = axis(H);
    ball(list, [head[0], head[1] - 0.04, head[2]], 0.2 + s.bow * 0.06, 0.12);
    return list;
}

/** A sapling the snow has buried whole: a round figure with a nodding head. */
function growGnome(s, seed, at = [0, 0, 0], list = []) {
    const rand = mulberry32(seed);
    const H = s.height;
    const nod = rand() * TAU;
    pillow(list, [at[0], -0.2, at[2]], [H * 0.38, 0.3, H * 0.38], [1, 0, 0], 0.26);
    pillow(list, [at[0], H * 0.36, at[2]], [H * 0.3, H * 0.38, H * 0.3], [1, 0, 0], 0.2);
    // Shoulders: the boughs under it, each a lobe.
    const lobes = 5 + Math.floor(rand() * 3);
    for (let j = 0; j < lobes; j++) {
        const a = (j / lobes) * TAU + rand() * 0.6;
        const up = H * (0.2 + rand() * 0.34);
        const out = H * (0.24 + rand() * 0.1);
        const dir = [Math.cos(a) * 0.86, -0.5, Math.sin(a) * 0.86];
        pillow(list, [at[0] + Math.cos(a) * out, up, at[2] + Math.sin(a) * out], [H * 0.2, H * 0.13, H * 0.15], dir, 0.16);
        if (rand() < s.bare) {
            pillow(
                list,
                [at[0] + Math.cos(a) * out * 1.25, up - H * 0.13, at[2] + Math.sin(a) * out * 1.25],
                [H * 0.15, H * 0.035, H * 0.1],
                dir,
                0.05,
                1,
            );
        }
    }
    // The head, pulled over by its own cap.
    const neck = [at[0] + Math.cos(nod) * H * 0.08, H * 0.74, at[2] + Math.sin(nod) * H * 0.08];
    ball(list, neck, H * 0.2, 0.17);
    const head = [at[0] + Math.cos(nod) * H * 0.2, H * 0.88, at[2] + Math.sin(nod) * H * 0.2];
    ball(list, head, H * 0.15, 0.13);
    ball(list, [head[0] + Math.cos(nod) * H * 0.13, head[1] - H * 0.07, head[2] + Math.sin(nod) * H * 0.13], H * 0.1, 0.1);
    return list;
}

/** The kinds, each at the height it is modelled at (instances scale it). */
const KINDS = [
    {
        name: 'sentinel',
        height: 10,
        grow: () => growSpruce({
            height: 10, girth: 1.75, taper: 0.8, bow: 0.95, lean: 0.02, load: 1.0, bare: 0.55, flag: 0,
        }, 0x5e71),
        lods: [128, 56, 26, 11],
    },
    {
        name: 'matron',
        height: 9,
        grow: () => growSpruce({
            height: 9, girth: 2.3, taper: 0.92, bow: 0.5, lean: 0.03, load: 1.22, bare: 0.4, flag: 0,
        }, 0x3a70),
        lods: [104, 52, 25, 11],
    },
    {
        name: 'leaner',
        height: 8.5,
        grow: () => growSpruce({
            height: 8.5, girth: 1.6, taper: 0.7, bow: 1.25, lean: 0.11, load: 0.95, bare: 0.75, flag: 0.8,
        }, 0x1ea9),
        lods: [104, 52, 25, 11],
    },
    {
        name: 'gnome',
        height: 2.4,
        grow: () => growGnome({ height: 2.4, bare: 0.5 }, 0x6e03),
        lods: [40, 26, 14, 8],
    },
    {
        name: 'twins',
        height: 2.2,
        grow: () => {
            const list = growGnome({ height: 2.2, bare: 0.4 }, 0x7715, [-0.42, 0, 0.05]);
            return growGnome({ height: 1.45, bare: 0.3 }, 0x7716, [0.72, 0, -0.1], list);
        },
        lods: [40, 26, 14, 8],
    },
];

// ── The field ───────────────────────────────────────────────────────────────────

/** Sample the union of `list` onto a grid of `cell` metres. */
function sampleField(list, cell, lumps) {
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    list.forEach((p) => {
        const reach = Math.max(p.r[0], p.r[1], p.r[2]);
        for (let c = 0; c < 3; c++) {
            lo[c] = Math.min(lo[c], p.c[c] - reach);
            hi[c] = Math.max(hi[c], p.c[c] + reach);
        }
    });
    const pad = cell * 3 + 0.14;
    lo = [lo[0] - pad, -0.34, lo[2] - pad];
    hi = [hi[0] + pad, hi[1] + pad, hi[2] + pad];
    const n = [0, 1, 2].map((c) => Math.ceil((hi[c] - lo[c]) / cell));
    const sx = n[0] + 1;
    const sy = n[1] + 1;
    const sz = n[2] + 1;
    const F = new Float32Array(sx * sy * sz).fill(1e3);
    const W = new Float32Array(sx * sy * sz);
    list.forEach((p) => {
        const reach = Math.max(p.r[0], p.r[1], p.r[2]) + p.k + cell * 2;
        const i0 = Math.max(0, Math.floor((p.c[0] - reach - lo[0]) / cell));
        const i1 = Math.min(n[0], Math.ceil((p.c[0] + reach - lo[0]) / cell));
        const j0 = Math.max(0, Math.floor((p.c[1] - reach - lo[1]) / cell));
        const j1 = Math.min(n[1], Math.ceil((p.c[1] + reach - lo[1]) / cell));
        const k0 = Math.max(0, Math.floor((p.c[2] - reach - lo[2]) / cell));
        const k1 = Math.min(n[2], Math.ceil((p.c[2] + reach - lo[2]) / cell));
        const small = Math.min(p.r[0], p.r[1], p.r[2]);
        for (let k = k0; k <= k1; k++) {
            const dz = lo[2] + k * cell - p.c[2];
            for (let j = j0; j <= j1; j++) {
                const dy = lo[1] + j * cell - p.c[1];
                for (let i = i0; i <= i1; i++) {
                    const dx = lo[0] + i * cell - p.c[0];
                    let qx = dx;
                    let qy = dy;
                    let qz = dz;
                    if (p.m) {
                        qx = dx * p.m[0][0] + dy * p.m[0][1] + dz * p.m[0][2];
                        qy = dx * p.m[1][0] + dy * p.m[1][1] + dz * p.m[1][2];
                        qz = dx * p.m[2][0] + dy * p.m[2][1] + dz * p.m[2][2];
                    }
                    // The ellipsoid's distance to first order (exact on its surface, and close
                    // enough away from it that the box above really bounds its reach).
                    const e = Math.hypot(qx / p.r[0], qy / p.r[1], qz / p.r[2]);
                    const slope = Math.hypot(qx / (p.r[0] * p.r[0]), qy / (p.r[1] * p.r[1]), qz / (p.r[2] * p.r[2]));
                    const d = slope > 1e-6 ? (e * (e - 1)) / slope : -small;
                    const at = i + sx * (j + sy * k);
                    const f = F[at];
                    const t = Math.max(0, Math.min(1, 0.5 + (0.5 * (f - d)) / p.k));
                    F[at] = f + (d - f) * t - p.k * t * (1 - t);
                    W[at] += (p.needle - W[at]) * t;
                }
            }
        }
    });
    // Rime is never smooth: lumps the size of a fist and of a head. Needles stay crisp.
    for (let k = 0; k <= n[2]; k++) {
        for (let j = 0; j <= n[1]; j++) {
            for (let i = 0; i <= n[0]; i++) {
                const at = i + sx * (j + sy * k);
                if (Math.abs(F[at]) > 0.7) continue;
                const x = lo[0] + i * cell;
                const y = lo[1] + j * cell;
                const z = lo[2] + k * cell;
                const snow = 1 - W[at];
                let bump = (noise3(x * 1.9, y * 1.9, z * 1.9) - 0.5) * 0.11 * lumps;
                if (cell < 0.14) bump += (noise3(x * 5.3 + 9, y * 5.3, z * 5.3 - 4) - 0.5) * 0.045 * lumps;
                F[at] -= bump * snow;
                // The drift closes it underneath.
                F[at] = Math.max(F[at], -0.2 - y);
            }
        }
    }
    return {
        F, W, lo, n, cell, sx, sy, sz,
    };
}

/** Trilinear read of a grid at a point. */
function readGrid(g, data, x, y, z) {
    const fx = Math.max(0, Math.min(g.n[0] - 1e-4, (x - g.lo[0]) / g.cell));
    const fy = Math.max(0, Math.min(g.n[1] - 1e-4, (y - g.lo[1]) / g.cell));
    const fz = Math.max(0, Math.min(g.n[2] - 1e-4, (z - g.lo[2]) / g.cell));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const k = Math.floor(fz);
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const at = i + g.sx * (j + g.sy * k);
    const a = data[at] + (data[at + 1] - data[at]) * tx;
    const b = data[at + g.sx] + (data[at + g.sx + 1] - data[at + g.sx]) * tx;
    const c = data[at + g.sx * g.sy] + (data[at + g.sx * g.sy + 1] - data[at + g.sx * g.sy]) * tx;
    const d = data[at + g.sx * g.sy + g.sx] + (data[at + g.sx * g.sy + g.sx + 1] - data[at + g.sx * g.sy + g.sx]) * tx;
    const ab = a + (b - a) * ty;
    const cd = c + (d - c) * ty;
    return ab + (cd - ab) * tz;
}

function gradient(g, x, y, z, out, e = g.cell * 0.8) {
    const nx = readGrid(g, g.F, x + e, y, z) - readGrid(g, g.F, x - e, y, z);
    const ny = readGrid(g, g.F, x, y + e, z) - readGrid(g, g.F, x, y - e, z);
    const nz = readGrid(g, g.F, x, y, z + e) - readGrid(g, g.F, x, y, z - e);
    const len = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
    return out;
}

// ── Surface nets ────────────────────────────────────────────────────────────────

const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Mesh a sampled field. `fine` is the same ghost's full-resolution field: a coarse mesh takes
 * its shading from it, so a tree of two hundred triangles is still lit as the ghost it stands
 * for. `faceted` meshes take their normals from their own faces instead of from the field: a
 * mesh that coarse bridges the hollows between pillows, and the field's slope there can point
 * against the face that spans them.
 */
function mesh(g, height, fine = g, faceted = false) {
    const {
        F, n, lo, cell, sx, sy,
    } = g;
    const cells = new Int32Array(n[0] * n[1] * n[2]).fill(-1);
    const positions = [];
    const corner = new Float32Array(8);
    for (let k = 0; k < n[2]; k++) {
        for (let j = 0; j < n[1]; j++) {
            for (let i = 0; i < n[0]; i++) {
                let mask = 0;
                for (let c = 0; c < 8; c++) {
                    const v = F[(i + (c & 1)) + sx * ((j + ((c >> 1) & 1)) + sy * (k + ((c >> 2) & 1)))];
                    corner[c] = v;
                    if (v < 0) mask |= 1 << c;
                }
                if (mask === 0 || mask === 255) continue;
                let px = 0;
                let py = 0;
                let pz = 0;
                let count = 0;
                for (let e = 0; e < 12; e++) {
                    const a = EDGES[e][0];
                    const b = EDGES[e][1];
                    if ((corner[a] < 0) === (corner[b] < 0)) continue;
                    const t = corner[a] / (corner[a] - corner[b]);
                    px += (a & 1) + ((b & 1) - (a & 1)) * t;
                    py += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
                    pz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
                    count += 1;
                }
                cells[i + n[0] * (j + n[1] * k)] = positions.length / 3;
                positions.push(lo[0] + (i + px / count) * cell, lo[1] + (j + py / count) * cell, lo[2] + (k + pz / count) * cell);
            }
        }
    }
    const indices = [];
    const cellAt = (i, j, k) => cells[i + n[0] * (j + n[1] * k)];
    const quad = (a, b, c, d, flip) => {
        if (a < 0 || b < 0 || c < 0 || d < 0) return;
        if (flip) indices.push(a, c, b, a, d, c);
        else indices.push(a, b, c, a, c, d);
    };
    for (let k = 1; k < n[2]; k++) {
        for (let j = 1; j < n[1]; j++) {
            for (let i = 1; i < n[0]; i++) {
                const here = F[i + sx * (j + sy * k)] < 0;
                if (here !== (F[i + 1 + sx * (j + sy * k)] < 0)) {
                    quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k), !here);
                }
                if (here !== (F[i + sx * (j + 1 + sy * k)] < 0)) {
                    quad(cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1), !here);
                }
                if (here !== (F[i + sx * (j + sy * (k + 1))] < 0)) {
                    quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k), !here);
                }
            }
        }
    }
    // What is under the drift is never seen: drop it, and what it alone used.
    const keep = new Int32Array(positions.length / 3).fill(-1);
    const outIndex = [];
    const outPos = [];
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t];
        const b = indices[t + 1];
        const c = indices[t + 2];
        if (positions[a * 3 + 1] < -0.12 && positions[b * 3 + 1] < -0.12 && positions[c * 3 + 1] < -0.12) continue;
        [a, b, c].forEach((v) => {
            if (keep[v] < 0) {
                keep[v] = outPos.length / 3;
                outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
            }
            outIndex.push(keep[v]);
        });
    }
    const count = outPos.length / 3;
    const normals = new Float32Array(count * 3);
    const shade = new Uint8Array(count * 4);
    const nrm = [0, 0, 0];
    const step = Math.max(cell * 0.75, fine.cell * 1.5, 0.1);
    const reach = Math.max(fine.cell * 0.8, cell * 0.33);
    if (faceted) {
        // Each vertex's normal is the area-weighted mean of the faces that meet at it.
        for (let t = 0; t < outIndex.length; t += 3) {
            const a = outIndex[t] * 3;
            const b = outIndex[t + 1] * 3;
            const c = outIndex[t + 2] * 3;
            const ux = outPos[b] - outPos[a];
            const uy = outPos[b + 1] - outPos[a + 1];
            const uz = outPos[b + 2] - outPos[a + 2];
            const vx = outPos[c] - outPos[a];
            const vy = outPos[c + 1] - outPos[a + 1];
            const vz = outPos[c + 2] - outPos[a + 2];
            const fx = uy * vz - uz * vy;
            const fy = uz * vx - ux * vz;
            const fz = ux * vy - uy * vx;
            [a, b, c].forEach((o) => {
                normals[o] += fx;
                normals[o + 1] += fy;
                normals[o + 2] += fz;
            });
        }
    }
    for (let v = 0; v < count; v++) {
        const x = outPos[v * 3];
        const y = outPos[v * 3 + 1];
        const z = outPos[v * 3 + 2];
        if (faceted) {
            const len = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
            nrm[0] = normals[v * 3] / len;
            nrm[1] = normals[v * 3 + 1] / len;
            nrm[2] = normals[v * 3 + 2] / len;
        } else gradient(fine, x, y, z, nrm, reach);
        normals.set(nrm, v * 3);
        // Occlusion: how much nearer than "open air" the field is along the normal.
        let occluded = 0;
        let weight = 0.5;
        for (let s = 1; s <= 5; s++) {
            const d = s * step;
            occluded += weight * Math.max(0, d - readGrid(fine, fine.F, x + nrm[0] * d, y + nrm[1] * d, z + nrm[2] * d)) / d;
            weight *= 0.62;
        }
        const open = Math.max(0, Math.min(1, 1 - occluded * 1.25));
        // Thinness: does the light that enters here come out on the other side soon?
        const through = 0.42;
        const inner = readGrid(fine, fine.F, x - nrm[0] * through, y - nrm[1] * through, z - nrm[2] * through);
        const thin = Math.max(0, Math.min(1, 1 + inner / through));
        const needle = Math.max(0, Math.min(1, readGrid(fine, fine.W, x, y, z) * 1.5 - 0.2));
        shade[v * 4] = Math.round(open * 255);
        shade[v * 4 + 1] = Math.round(needle * 255);
        shade[v * 4 + 2] = Math.round(thin * 255);
        shade[v * 4 + 3] = Math.round(Math.max(0, Math.min(1, y / height)) * 255);
    }
    return {
        positions: Float32Array.from(outPos), normals, shade, indices: Uint32Array.from(outIndex),
    };
}

// ── Preview (CPU ray cast of the field itself) ──────────────────────────────────

function crc32(buf) {
    let c;
    let crc = -1;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ -1) >>> 0;
}

function png(width, height, rgb) {
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 3 + 1)] = 0;
        rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([len, body, crc]);
    };
    const head = Buffer.alloc(13);
    head.writeUInt32BE(width, 0);
    head.writeUInt32BE(height, 4);
    head[8] = 8;
    head[9] = 2;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', head),
        chunk('IDAT', deflateSync(raw, { level: 6 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** Look at a ghost from the viewer's side, lit as the theme lights it: { W, H, out }. */
function preview(g, height) {
    const pxPerM = 46;
    const half = Math.max(-g.lo[0], g.lo[0] + g.n[0] * g.cell) + 0.3;
    const W = Math.ceil(half * 2 * pxPerM);
    const H = Math.ceil((height + 1.2) * pxPerM);
    const out = Buffer.alloc(W * H * 3);
    // The moon is behind and to the right; the twilight's rose comes low from the left.
    const moon = [0.5, 0.39, -0.77];
    const rose = [-0.8, 0.12, -0.3];
    const nrm = [0, 0, 0];
    const far = g.lo[2] + g.n[2] * g.cell;
    for (let py = 0; py < H; py++) {
        const y = height + 0.8 - py / pxPerM;
        for (let px = 0; px < W; px++) {
            const x = -half + px / pxPerM;
            // The eye looks down −Z: march from the near side.
            let z = far;
            let hit = false;
            for (let s = 0; s < 400 && z > g.lo[2]; s++) {
                const inside = x > g.lo[0] && x < g.lo[0] + g.n[0] * g.cell && y > g.lo[1] && y < g.lo[1] + g.n[1] * g.cell;
                const d = inside ? Math.min(0.25, readGrid(g, g.F, x, y, z)) : 0.25;
                if (d < 0.004) {
                    hit = true;
                    break;
                }
                z -= Math.max(d * 0.8, 0.01);
            }
            const o = (py * W + px) * 3;
            let col = [0.2, 0.34, 0.5];
            const sky = 1 - py / H;
            col = [0.5 - sky * 0.4, 0.42 - sky * 0.22, 0.52 - sky * 0.1];
            if (hit && y > 0) {
                gradient(g, x, y, z, nrm);
                const step = Math.max(g.cell * 1.5, 0.1);
                let occluded = 0;
                let weight = 0.5;
                for (let s = 1; s <= 5; s++) {
                    const d = s * step;
                    occluded += weight * Math.max(0, d - readGrid(g, g.F, x + nrm[0] * d, y + nrm[1] * d, z + nrm[2] * d)) / d;
                    weight *= 0.62;
                }
                const open = Math.max(0, 1 - occluded * 1.25);
                const needle = Math.max(0, Math.min(1, readGrid(g, g.W, x, y, z) * 1.5 - 0.2));
                const inner = readGrid(g, g.F, x - nrm[0] * 0.42, y - nrm[1] * 0.42, z - nrm[2] * 0.42);
                const thin = Math.max(0, Math.min(1, 1 + inner / 0.42));
                const nl = Math.max(0, nrm[0] * moon[0] + nrm[1] * moon[1] + nrm[2] * moon[2]);
                const nr = Math.max(0, nrm[0] * rose[0] + nrm[1] * rose[1] + nrm[2] * rose[2]);
                const up = nrm[1] * 0.5 + 0.5;
                const snow = [
                    0.16 + up * 0.14 + nl * 0.75 + nr * 0.55 + thin * 0.25,
                    0.22 + up * 0.2 + nl * 0.8 + nr * 0.24 + thin * 0.3,
                    0.42 + up * 0.3 + nl * 0.95 + nr * 0.22 + thin * 0.42,
                ];
                const bough = [0.02 + nl * 0.05, 0.06 + nl * 0.07, 0.07 + nl * 0.06];
                col = [0, 1, 2].map((c) => (snow[c] + (bough[c] - snow[c]) * needle) * (0.3 + 0.7 * open));
            }
            for (let c = 0; c < 3; c++) out[o + c] = Math.round(255 * Math.max(0, Math.min(1, col[c])) ** (1 / 2.2));
        }
    }
    return { W, H, out };
}

/** Every kind side by side, feet on one line. */
function sheet(tiles, file) {
    const W = tiles.reduce((sum, t) => sum + t.W, 0);
    const H = Math.max(...tiles.map((t) => t.H));
    const out = Buffer.alloc(W * H * 3, 40);
    let x0 = 0;
    tiles.forEach((t) => {
        for (let y = 0; y < t.H; y++) {
            t.out.copy(out, ((H - t.H + y) * W + x0) * 3, y * t.W * 3, (y + 1) * t.W * 3);
        }
        x0 += t.W;
    });
    writeFileSync(file, png(W, H, out));
}

// ── Pack ────────────────────────────────────────────────────────────────────────

function bake({ previewDir = null } = {}) {
    const meshes = [];
    const tiles = [];
    const blobs = [];
    let offset = 0;
    const push = (bytes) => {
        const at = offset;
        blobs.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        offset += bytes.byteLength;
        // Every block starts on a four-byte boundary.
        const pad = (4 - (offset % 4)) % 4;
        if (pad) {
            blobs.push(Buffer.alloc(pad));
            offset += pad;
        }
        return at;
    };
    KINDS.forEach((kind) => {
        const list = kind.grow();
        let fine = null;
        kind.lods.forEach((divisions, lod) => {
            const cell = kind.height / divisions;
            const g = sampleField(list, cell, lod >= 2 ? 0.6 : 1);
            if (lod === 0) fine = g;
            const m = mesh(g, kind.height, fine, lod >= 2);
            if (previewDir && lod === 0) tiles.push(preview(g, kind.height));
            const count = m.positions.length / 3;
            const lo = [Infinity, Infinity, Infinity];
            const hi = [-Infinity, -Infinity, -Infinity];
            for (let v = 0; v < count; v++) {
                for (let c = 0; c < 3; c++) {
                    lo[c] = Math.min(lo[c], m.positions[v * 3 + c]);
                    hi[c] = Math.max(hi[c], m.positions[v * 3 + c]);
                }
            }
            const q = new Uint16Array(count * 3);
            const nq = new Int8Array(count * 4);
            for (let v = 0; v < count; v++) {
                for (let c = 0; c < 3; c++) {
                    q[v * 3 + c] = Math.round(((m.positions[v * 3 + c] - lo[c]) / (hi[c] - lo[c])) * 65535);
                    nq[v * 4 + c] = Math.round(m.normals[v * 3 + c] * 127);
                }
            }
            const wide = count > 65535;
            const index = wide ? m.indices : Uint16Array.from(m.indices);
            meshes.push({
                kind: kind.name,
                lod,
                height: kind.height,
                vertices: count,
                triangles: m.indices.length / 3,
                min: lo.map((v) => Math.round(v * 1e4) / 1e4),
                max: hi.map((v) => Math.round(v * 1e4) / 1e4),
                position: push(q),
                normal: push(nq),
                shade: push(m.shade),
                index: push(index),
                indexBytes: wide ? 4 : 2,
            });
        });
    });
    if (previewDir) sheet(tiles, join(previewDir, 'ghosts.png'));
    const body = Buffer.concat(blobs);
    const header = Buffer.from(JSON.stringify({ version: 1, meshes }));
    const pad = (4 - ((12 + header.length) % 4)) % 4;
    const head = Buffer.alloc(12);
    head.write('WSG1', 0, 'latin1');
    head.writeUInt32LE(header.length + pad, 4);
    head.writeUInt32LE(body.length, 8);
    const file = Buffer.concat([head, header, Buffer.alloc(pad, 0x20), body]);
    const manifest = {
        asset: 'snow-ghosts.bin',
        generator: 'scripts/winter/bake-ghosts.mjs',
        bytes: file.length,
        sha256: createHash('sha256').update(file).digest('hex'),
        meshes: meshes.map(({
            kind, lod, vertices, triangles, height,
        }) => ({
            kind, lod, height, vertices, triangles,
        })),
    };
    return { file, manifest };
}

const args = process.argv.slice(2);
const previewArg = args.find((a) => a.startsWith('--preview='));
const previewDir = previewArg ? resolve(previewArg.slice('--preview='.length)) : null;
if (previewDir) mkdirSync(previewDir, { recursive: true });
const started = Date.now();
const { file, manifest } = bake({ previewDir });
if (args.includes('--check')) {
    const known = existsSync(OUT_MANIFEST) ? JSON.parse(readFileSync(OUT_MANIFEST, 'utf8')) : null;
    const same = known && known.sha256 === manifest.sha256;
    console.log(same ? 'snow ghosts: the bake matches the manifest' : 'snow ghosts: the bake DIFFERS from the manifest');
    process.exit(same ? 0 : 1);
}
if (!args.includes('--dry')) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_BIN, file);
    writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`snow ghosts: ${(file.length / 1024).toFixed(0)} KB in ${((Date.now() - started) / 1000).toFixed(1)} s`);
manifest.meshes.forEach((m) => {
    console.log(`  ${m.kind.padEnd(9)} lod ${m.lod}: ${String(m.vertices).padStart(6)} vertices, ${String(m.triangles).padStart(6)} triangles`);
});
