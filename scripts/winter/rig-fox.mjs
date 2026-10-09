#!/usr/bin/env node
/**
 * Winter — rig the fox.
 *
 * The fox's mesh is the project's own (see src/themes/winter/assets/ATTRIBUTION.md): a
 * reconstruction of a stylized arctic fox, 25 000 vertices. It arrived with its head turned to
 * one side, a skeleton of rigid blocks (one bone for the whole back, legs weighted by distance
 * alone) and baked clips that could not be trusted. This script makes the animal the theme
 * animates instead:
 *
 *   mesh      centred on its own middle, its head turned to look straight ahead, its facets
 *             rounded a little (a coat of fur goes over it), its normals smoothed
 *   skeleton  the table in src/themes/winter/winter-fox-rig.js: a back of three bones, neck,
 *             head, a tail of four, legs of three — every bone axis-aligned at rest, so the
 *             theme poses it with rotations in the model's own frame
 *   skin      weights laid by region, with soft seams: a leg belongs to its own side, a haunch
 *             partly to its thigh, the ruff partly to the head
 *   coat      four numbers a vertex, stored as its colour: how far along the tail it is, how
 *             long its fur is there, how dark it is painted (nose, eyes, the hollows of the
 *             ears — the reconstruction had two dots), and how much of the sky it sees (an
 *             occlusion bake: the belly, the insides of the legs, the throat)
 *
 * No clips are written: the theme animates the skeleton itself (winter-fox-rig.js).
 *
 *   node scripts/winter/rig-fox.mjs --from=<source.glb>   rig a source mesh and write the asset
 *   node scripts/winter/rig-fox.mjs                       re-skin and re-paint the asset in place
 *   node scripts/winter/rig-fox.mjs --preview=<dir>       also draw the mesh, skin and coat (CPU)
 *   node scripts/winter/rig-fox.mjs --check               rig in memory and compare with the asset
 *
 * Deterministic: the same script and source give the same bytes. The asset records that its
 * mesh has been straightened, so running the script on its own output only redoes skin and coat.
 */

import { createHash } from 'node:crypto';
import {
    existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOX_BONES, FOX_BONE_INDEX, FOX_MARKS } from '../../src/themes/winter/winter-fox-rig.js';
import { SIDES, picture, tile } from '../fox/cpu-picture.mjs';
import { readGlb } from '../fox/glb-read.mjs';
import {
    adjacency, normalsOf, occlusion, relax, writeGlb,
} from '../fox/mesh-tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ASSET = join(ROOT, 'src', 'themes', 'winter', 'assets', 'arctic-fox.glb');
/** Stamped into the asset: the mesh is already centred, straightened and smoothed. */
const RIG_VERSION = 2;

const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── The mesh ────────────────────────────────────────────────────────────────────

/** The source stands a little to one side of its own middle (metres). */
const MIDDLE_X = -0.04;
/** Its head is turned this far to its left, about a vertical through this point of its neck. */
const HEAD_TURN = 0.56;
const HEAD_PIVOT_Z = 0.27;

/** Centre the animal and turn its head to look straight ahead. */
function straighten(pos) {
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
        const x = pos[i * 3] - MIDDLE_X;
        const y = pos[i * 3 + 1];
        const z = pos[i * 3 + 2];
        // What turns: everything above the back, and the ruff and throat in front of the
        // shoulders — all of it less the nearer it is to the axis it turns about.
        const high = smooth(0.42, 0.47, y);
        const fore = smooth(0.14, 0.2, z) * smooth(0.33, 0.42, y);
        const r = Math.hypot(x, z - HEAD_PIVOT_Z);
        const w = Math.max(high, fore) * smooth(0.02, 0.08, r);
        const angle = -HEAD_TURN * w;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        // (+ about y turns +z toward +x.)
        const dz = z - HEAD_PIVOT_Z;
        pos[i * 3] = x * c + dz * s;
        pos[i * 3 + 2] = HEAD_PIVOT_Z - x * s + dz * c;
    }
}

/** Round the facets without shrinking the animal (Taubin: a step in, a step out). */
function round(pos, adj, passes) {
    const count = pos.length / 3;
    // The paws stay as they are: they stand on the snow.
    const hold = new Float64Array(count);
    for (let i = 0; i < count; i++) hold[i] = smooth(0.01, 0.06, pos[i * 3 + 1]);
    for (let p = 0; p < passes; p++) {
        relax(pos, 3, adj, 0.5, hold);
        relax(pos, 3, adj, -0.53, hold);
    }
}

// ── The skin ────────────────────────────────────────────────────────────────────

const JOINT = Object.fromEntries(FOX_BONES.map((bone) => [bone[0], [bone[2], bone[3], bone[4]]]));

/**
 * Where a point is along a chain of joints: 0 at the first joint, 1 at the second…, and below 0
 * before the chain starts. Also how far from the chain it is.
 */
function along(chain, p) {
    let best = { u: 0, far: Infinity };
    for (let k = 0; k < chain.length - 1; k++) {
        const a = chain[k];
        const b = chain[k + 1];
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2;
        // The ends of the chain run on: before its start, past its tip.
        if (k > 0) t = Math.max(0, t);
        if (k < chain.length - 2) t = Math.min(1, t);
        const far = Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t);
        if (far < best.far) best = { u: k + t, far };
    }
    return best;
}

const TAIL_CHAIN = [JOINT.tail1, JOINT.tail2, JOINT.tail3, JOINT.tail4, FOX_MARKS.tailTip];
const NECK_CHAIN = [JOINT.neck, JOINT.head, FOX_MARKS.nose];

/**
 * A vertex's bones: up to four, by where on the animal it is.
 * @returns {Map<string, number>} bone name → weight (sums to 1)
 */
function weigh(p) {
    const [x, y, z] = p;
    const ax = Math.abs(x);
    const side = x >= 0 ? 'L' : 'R';
    const w = new Map();
    let rest = 1;
    const give = (bone, amount) => {
        if (amount > 1e-5) w.set(bone, (w.get(bone) || 0) + amount);
    };

    // The tail: a chain, each bone handing over to the next half way along it.
    const tail = along(TAIL_CHAIN, p);
    const tailShare = rest * smooth(-0.55, 0.35, tail.u) * (1 - smooth(0.1, 0.16, tail.far)) * smooth(-0.13, -0.2, z);
    if (tailShare > 0) {
        const names = ['tail1', 'tail2', 'tail3', 'tail4'];
        const u = Math.min(tail.u, 3.999);
        // Bone k holds from its joint to the next; round joint k it shares with bone k−1.
        const k = Math.max(0, Math.min(3, Math.floor(u)));
        const f = u - k;
        const back = k > 0 ? (1 - smooth(0, 0.5, f)) * 0.5 : 0;
        const on = k < 3 ? smooth(0.5, 1, f) * 0.5 : 0;
        give(names[k], tailShare * (1 - back - on));
        if (back > 0) give(names[k - 1], tailShare * back);
        if (on > 0) give(names[k + 1], tailShare * on);
        rest -= tailShare;
    }

    // The legs: each its own side's, a paw wholly its last bone's, a shoulder or haunch only
    // partly its first.
    const off = smooth(0.012, 0.04, ax);
    const front = (1 - smooth(0.16, 0.3, y)) * off * smooth(0.07, 0.12, z) * (1 - smooth(0.3, 0.35, z));
    if (front > 0) {
        const share = rest * front;
        const hand = 1 - smooth(0.04, 0.085, y);
        const arm = smooth(0.115, 0.185, y);
        give(`hand${side}`, share * hand);
        give(`arm${side}`, share * arm);
        give(`fore${side}`, share * (1 - hand - arm));
        rest -= share;
    }
    const hind = (1 - smooth(0.15, 0.33, y)) * off * (1 - smooth(0.02, 0.07, z)) * smooth(-0.21, -0.15, z);
    if (hind > 0) {
        const share = rest * hind;
        const hock = 1 - smooth(0.07, 0.115, y);
        const thigh = smooth(0.125, 0.19, y);
        give(`hock${side}`, share * hock);
        give(`thigh${side}`, share * thigh);
        give(`shin${side}`, share * (1 - hock - thigh));
        rest -= share;
    }

    // The neck and head: the skull is the head's alone; the neck hands over to the chest.
    const neck = along(NECK_CHAIN, p);
    const neckShare = rest * smooth(-0.45, 0.4, neck.u) * smooth(0.24, 0.34, y + (z - 0.2) * 0.4);
    if (neckShare > 0) {
        const head = smooth(0.55, 1.05, neck.u);
        give('head', neckShare * head);
        give('neck', neckShare * (1 - head));
        rest -= neckShare;
    }

    // The back: three bones along it.
    if (rest > 0) {
        const fore = smooth(0.05, 0.19, z);
        const mid = smooth(-0.07, 0.07, z);
        give('chest', rest * fore);
        give('spine', rest * mid * (1 - fore));
        give('hips', rest * (1 - mid) * (1 - fore));
    }
    return w;
}

function skin(pos) {
    const count = pos.length / 3;
    const joints = new Uint8Array(count * 4);
    const weights = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
        const w = weigh([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
        const top = [...w.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 4);
        const sum = top.reduce((s, e) => s + e[1], 0) || 1;
        // Bytes that sum to exactly 255: the largest takes the rounding.
        const bytes = top.map((e) => Math.round((e[1] / sum) * 255));
        bytes[0] += 255 - bytes.reduce((s, v) => s + v, 0);
        for (let k = 0; k < 4; k++) {
            joints[i * 4 + k] = k < top.length && bytes[k] > 0 ? FOX_BONE_INDEX[top[k][0]] : 0;
            weights[i * 4 + k] = k < top.length ? bytes[k] : 0;
        }
    }
    return { joints, weights };
}

// ── The coat ────────────────────────────────────────────────────────────────────

/** A cheap lumpy noise over the body: the coat grows in tufts. */
function tuft(x, y, z) {
    const lattice = (ix, iy, iz) => {
        let h = (ix * 374761393 + iy * 668265263 + iz * 1274126177) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const value = (px, py, pz) => {
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        const iz = Math.floor(pz);
        const fx = px - ix;
        const fy = py - iy;
        const fz = pz - iz;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const sz = fz * fz * (3 - 2 * fz);
        let v = 0;
        for (let c = 0; c < 8; c++) {
            const ox = c & 1;
            const oy = (c >> 1) & 1;
            const oz = (c >> 2) & 1;
            v += lattice(ix + ox, iy + oy, iz + oz) * (ox ? sx : 1 - sx) * (oy ? sy : 1 - sy) * (oz ? sz : 1 - sz);
        }
        return v;
    };
    return value(x * 26, y * 26, z * 17) * 0.65 + value(x * 61 + 3.1, y * 61 + 1.7, z * 43 + 5.3) * 0.35;
}

/** Where the eyes are painted (the source's two dots sat a centimetre apart from symmetric). */
const EYE = FOX_MARKS.eye;
const EYE_SIZE = 0.017;
const NOSE_SIZE = 0.021;

/**
 * The coat's four numbers a vertex, as bytes: tail, fur length (0..2 as 0..255), dark paint,
 * sky seen.
 */
function coat(pos, nor, sees) {
    const count = pos.length / 3;
    const out = new Uint8Array(count * 4);
    // The tip of its muzzle is where the nose goes: the furthest point ahead on the head.
    let tip = [0, 0, -Infinity];
    for (let i = 0; i < count; i++) {
        if (pos[i * 3 + 1] > 0.38 && pos[i * 3 + 2] > tip[2]) tip = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    }
    const nose = [0, tip[1] + 0.008, tip[2] - 0.004];
    for (let i = 0; i < count; i++) {
        const x = pos[i * 3];
        const y = pos[i * 3 + 1];
        const z = pos[i * 3 + 2];
        const ax = Math.abs(x);
        const tail = along(TAIL_CHAIN, [x, y, z]);
        const onTail = smooth(-0.3, 0.3, tail.u) * (1 - smooth(0.1, 0.16, tail.far)) * smooth(-0.13, -0.2, z);
        const neck = along(NECK_CHAIN, [x, y, z]);
        const onHead = smooth(0.6, 1.05, neck.u) * smooth(0.36, 0.42, y);

        // Paint: the nose, the eyes with a soft rim, a shade in the hollows of the ears.
        const toNose = Math.hypot(x - nose[0], (y - nose[1]) * 1.25, z - nose[2]);
        const toEye = Math.hypot(ax - EYE[0], y - EYE[1], (z - EYE[2]) * 0.6);
        const forward = nor[i * 3 + 2];
        const hollow = smooth(0.565, 0.6, y) * smooth(0.25, 0.7, forward) * 0.45;
        const dark = Math.max(
            1 - smooth(NOSE_SIZE * 0.55, NOSE_SIZE, toNose),
            1 - smooth(EYE_SIZE * 0.5, EYE_SIZE, toEye),
            hollow * onHead,
        );

        // Fur: short on the paws and up the legs, shorter still on the muzzle and the ears, a
        // ruff on the neck and chest, long under the belly and longest on the tail.
        const leg = smooth(0.03, 0.2, y);
        const muzzle = smooth(1.25, 1.6, neck.u) * onHead;
        const face = smooth(0.95, 1.3, neck.u) * onHead;
        const ear = smooth(0.57, 0.61, y) * onHead;
        const ruff = smooth(-0.35, 0.3, neck.u) * (1 - smooth(0.8, 1.15, neck.u)) * smooth(0.24, 0.34, y);
        let length = 0.3 + 0.7 * leg;
        length *= 1 + 0.4 * ruff;
        length *= 1 - 0.45 * face;
        length *= 1 - 0.6 * muzzle;
        length *= 1 - 0.55 * ear;
        length += (1.75 - length) * onTail * smooth(0.0, 0.8, tail.u);
        length *= 0.72 + 0.56 * tuft(x, y, z);
        length *= 1 - smooth(0.25, 0.7, dark);

        out[i * 4] = Math.round(clamp01(onTail * (0.3 + 0.7 * clamp01(tail.u / 4))) * 255);
        out[i * 4 + 1] = Math.round(clamp01(length / 2) * 255);
        out[i * 4 + 2] = Math.round(clamp01(dark) * 255);
        out[i * 4 + 3] = Math.round(clamp01((sees[i] - 0.12) / 0.8) * 255);
    }
    return { colours: out, nose: tip };
}

// ── Pictures ────────────────────────────────────────────────────────────────────

const HUES = FOX_BONES.map((_, i) => {
    const h = (i * 0.381966) % 1;
    const f = (n) => {
        const k = (n + h * 6) % 6;
        return 0.95 - 0.7 * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)];
});

function pictures(dir, mesh) {
    mkdirSync(dir, { recursive: true });
    const {
        positions, indices, colours, joints, weights,
    } = mesh;
    const W = 560;
    const H = 400;
    const views = [
        ['left', [0, 0.32, 0.02], 1.2], ['front', [0, 0.32, 0], 0.8], ['top', [0, 0.3, 0.02], 1.2],
        ['right', [0, 0.32, 0.02], 1.2], ['behind', [0, 0.32, 0], 0.8], ['under', [0, 0.3, 0.02], 1.2],
    ];
    const sheet = (name, colour, marks) => {
        const tiles = views.map(([side, centre, span]) => {
            const [right, up] = SIDES[side];
            const p = picture({
                positions, indices, colour, right, up, centre, span, width: W, height: H, floor: up[1] === 1 ? 0 : undefined,
            });
            if (marks) marks(p);
            return p;
        });
        console.log(`  ${tile(tiles, 3, join(dir, `${name}.png`))}`);
    };
    const bones = (p) => {
        FOX_BONES.forEach((bone) => {
            if (bone[1]) p.line(JOINT[bone[1]], JOINT[bone[0]], [255, 210, 60]);
        });
        FOX_BONES.forEach((bone) => p.dot(JOINT[bone[0]], [255, 70, 70], 2));
        Object.values(FOX_MARKS).forEach((mark) => p.dot(mark, [80, 255, 140], 2));
        p.dot([-FOX_MARKS.eye[0], FOX_MARKS.eye[1], FOX_MARKS.eye[2]], [80, 255, 140], 2);
    };
    sheet('fox-mesh', undefined, bones);
    sheet('fox-skin', (v) => {
        const c = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
            const w = weights[v * 4 + k] / 255;
            const hue = HUES[joints[v * 4 + k]];
            c[0] += hue[0] * w;
            c[1] += hue[1] * w;
            c[2] += hue[2] * w;
        }
        return c;
    });
    sheet('fox-paint', (v) => {
        const dark = colours[v * 4 + 2] / 255;
        const sees = colours[v * 4 + 3] / 255;
        const shade = (0.25 + 0.75 * sees) * (1 - dark * 0.95);
        return [shade, shade, shade];
    });
    sheet('fox-fur', (v) => {
        const length = colours[v * 4 + 1] / 255;
        const tail = colours[v * 4] / 255;
        return [0.15 + 0.85 * length, 0.2 + 0.6 * length * (1 - tail), 0.9 - 0.7 * length];
    });
}

// ── Main ────────────────────────────────────────────────────────────────────────

function rig({ from = ASSET } = {}) {
    const { json, read } = readGlb(from);
    const prim = json.meshes[0].primitives[0];
    const positions = read(prim.attributes.POSITION);
    const indexData = read(prim.indices);
    const count = positions.length / 3;
    if (count > 65535) throw new Error(`the fox has ${count} vertices: more than 16-bit indices hold`);
    const indices = Uint16Array.from(indexData);
    const adj = adjacency(indices, count);
    const stamp = json.asset?.extras?.winterFoxRig;
    if (stamp !== undefined && stamp !== RIG_VERSION) {
        throw new Error(`this file was rigged by version ${stamp} of this script and its mesh already changed: `
            + 'rig the source mesh instead (--from, see assets/ATTRIBUTION.md)');
    }
    const done = stamp === RIG_VERSION;
    if (!done) {
        straighten(positions);
        round(positions, adj, 3);
        // Stand it on the snow.
        let foot = Infinity;
        for (let i = 0; i < count; i++) foot = Math.min(foot, positions[i * 3 + 1]);
        for (let i = 0; i < count; i++) positions[i * 3 + 1] -= foot;
    }
    // (Single precision is what the file holds: everything after is computed from that.)
    const stored = Float32Array.from(positions);
    const normals = normalsOf(stored, indices, adj, 4);
    const { joints, weights } = skin(stored);
    const sees = occlusion(stored, normals, indices, adj);
    const { colours, nose } = coat(stored, normals, sees);
    const mesh = {
        positions: stored, normals: Float32Array.from(normals), colours, joints, weights, indices,
    };
    return {
        mesh,
        bytes: writeGlb({
            name: 'ArcticFox',
            bones: FOX_BONES,
            extras: { winterFoxRig: RIG_VERSION },
            generator: 'serenity-blocks scripts/winter/rig-fox.mjs',
            ...mesh,
        }),
        nose,
        straightened: !done,
    };
}

function main() {
    const args = Object.fromEntries(process.argv.slice(2).map((a) => {
        const [k, v] = a.replace(/^--/, '').split('=');
        return [k, v ?? true];
    }));
    const from = typeof args.from === 'string' ? resolve(args.from) : ASSET;
    if (!existsSync(from)) throw new Error(`no such file: ${from}`);
    const started = Date.now();
    const {
        mesh, bytes, nose, straightened,
    } = rig({ from });
    const hash = createHash('sha256').update(bytes).digest('hex');
    console.log(`fox: ${mesh.positions.length / 3} vertices, ${mesh.indices.length / 3} triangles, `
        + `${FOX_BONES.length} bones, ${(bytes.length / 1024).toFixed(0)} KiB, ${Date.now() - started} ms`);
    console.log(`  mesh ${straightened ? 'centred, straightened and rounded' : 'kept as it is (already straightened)'}`);
    console.log(`  tip of the muzzle at ${nose.map((v) => v.toFixed(3)).join(', ')}`);
    console.log(`  sha256 ${hash}`);
    if (typeof args.preview === 'string') pictures(resolve(args.preview), mesh);
    if (args.check) {
        const have = createHash('sha256').update(readFileSync(ASSET)).digest('hex');
        if (have !== hash) {
            console.error(`FAIL: the asset is ${have}, a fresh rig is ${hash}`);
            process.exit(1);
        }
        console.log('  the asset matches');
        return;
    }
    if (!args.dry) {
        writeFileSync(typeof args.out === 'string' ? resolve(args.out) : ASSET, bytes);
        console.log(`  wrote ${typeof args.out === 'string' ? resolve(args.out) : ASSET}`);
    }
}

main();
