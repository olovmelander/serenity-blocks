#!/usr/bin/env node
/**
 * Winter — model and rig the polar bear.
 *
 * The bear is the project's own: no scan, no download, no clip. Two steps make it:
 *
 *   model   headless Blender (scripts/blender/winter_polar_bear.py) builds the animal as a
 *           signed distance field round the joints of the theme's rig — this script hands it the
 *           skeleton as JSON — meshes it, decimates it, mirrors it and bakes per vertex the part
 *           of the body it belongs to and its paint: (pad, fur length, dark, sky seen)
 *   rig     this script skins that mesh to the skeleton in src/themes/winter/winter-bear-rig.js:
 *           every bone axis-aligned at rest, so the theme poses it with rotations in the model's
 *           own frame. A leg follows its three bones with soft joints and fades into the chest or
 *           the hips over its shoulder or haunch; the skin over the shoulder blade and the thigh
 *           partly follows the leg; the trunk bends along hips, spine and chest; the neck hands
 *           over to the head at the skull; the tail follows its chain. Then the weights are
 *           relaxed over the surface, so no seam is left where two parts meet.
 *
 * No clips are written: the theme animates the skeleton itself (winter-bear-rig.js).
 *
 *   node scripts/winter/model-bear.mjs                     model with Blender, rig, write the asset
 *   node scripts/winter/model-bear.mjs --preview=<dir>     ... and Blender's stills of the mesh
 *   node scripts/winter/model-bear.mjs --from=<mesh.glb>   rig a mesh Blender already wrote
 *   node scripts/winter/model-bear.mjs --mesh=<file>       keep Blender's mesh there
 *   node scripts/winter/model-bear.mjs --blender=<exe>     (default: Blender 5.2 where it installs)
 *   node scripts/winter/model-bear.mjs --dry               do everything but write the asset
 *
 * Deterministic: the same Blender and the same scripts give the same bytes.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BEAR_BONES, BEAR_BONE_INDEX, BEAR_MARKS,
} from '../../src/themes/winter/winter-bear-rig.js';
import { readGlb } from '../fox/glb-read.mjs';
import { adjacency, relax, writeGlb } from '../fox/mesh-tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ASSET = join(ROOT, 'src', 'themes', 'winter', 'assets', 'polar-bear.glb');
const MODEL_SCRIPT = join(ROOT, 'scripts', 'blender', 'winter_polar_bear.py');
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
/** Stamped into the asset. */
const RIG_VERSION = 1;

/** The parts Blender sorts the mesh into (winter_polar_bear.py PARTS). */
const PART = Object.freeze({
    body: 0, head: 1, frontLeft: 2, frontRight: 3, hindLeft: 4, hindRight: 5, tail: 6,
});

const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── The skin ────────────────────────────────────────────────────────────────────

const JOINT = Object.fromEntries(BEAR_BONES.map((bone) => [bone[0], [bone[2], bone[3], bone[4]]]));

/**
 * Where a point is along a chain of joints: 0 at the first joint, 1 at the second…, running on
 * before the start and past the tip; and how far from the chain it is.
 */
function along(chain, p) {
    let best = { u: 0, far: Infinity };
    for (let k = 0; k < chain.length - 1; k++) {
        const a = chain[k];
        const b = chain[k + 1];
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2;
        if (k > 0) t = Math.max(0, t);
        if (k < chain.length - 2) t = Math.min(1, t);
        const far = Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t);
        if (far < best.far) best = { u: k + t, far };
    }
    return best;
}

const NECK_CHAIN = [JOINT.neck, JOINT.head, BEAR_MARKS.nose];
const TAIL_CHAIN = [JOINT.tail1, JOINT.tail2, JOINT.tail3, BEAR_MARKS.tailTip];
const legChain = (front, side) => (front
    ? [JOINT[`arm${side}`], JOINT[`fore${side}`], JOINT[`hand${side}`], BEAR_MARKS[`pawF${side}`]]
    : [JOINT[`thigh${side}`], JOINT[`shin${side}`], JOINT[`hock${side}`], BEAR_MARKS[`pawB${side}`]]);
const LEGS = {
    FL: legChain(true, 'L'), FR: legChain(true, 'R'), BL: legChain(false, 'L'), BR: legChain(false, 'R'),
};

/** The back's three bones by how far along the body a point is. */
function back(z, give, share) {
    const chest = smooth(0.02, 0.3, z);
    const hips = 1 - smooth(-0.52, -0.2, z);
    give('chest', share * chest);
    give('hips', share * hips * (1 - chest));
    give('spine', share * Math.max(0, 1 - chest - hips));
}

/**
 * A vertex's bones, by its part and where it is.
 * @returns {Map<string, number>} bone name → weight
 */
function weigh(p, part) {
    const [x, y, z] = p;
    const side = x >= 0 ? 'L' : 'R';
    const w = new Map();
    const give = (bone, amount) => {
        if (amount > 1e-5) w.set(bone, (w.get(bone) || 0) + amount);
    };
    const front = part === PART.frontLeft || part === PART.frontRight;
    const hind = part === PART.hindLeft || part === PART.hindRight;
    if (front || hind) {
        // A leg: its own three bones with soft joints; over its shoulder or haunch it hands over
        // to what carries it.
        const chain = LEGS[`${front ? 'F' : 'B'}${side}`];
        const { u } = along(chain, p);
        const [upper, lower, last, carrier] = front
            ? [`arm${side}`, `fore${side}`, `hand${side}`, 'chest']
            : [`thigh${side}`, `shin${side}`, `hock${side}`, 'hips'];
        const top = 1 - smooth(-0.05, 0.32, u);
        const lastShare = smooth(1.8, 2.04, u) * (1 - top);
        const lowerShare = smooth(0.82, 1.12, u) * (1 - top) - lastShare;
        give(last, lastShare);
        give(lower, Math.max(0, lowerShare));
        give(upper, Math.max(0, 1 - top - lastShare - Math.max(0, lowerShare)));
        give(carrier, top);
        return w;
    }
    if (part === PART.tail) {
        const tail = along(TAIL_CHAIN, p);
        const u = Math.max(0, Math.min(2.999, tail.u));
        const k = Math.floor(u);
        const f = u - k;
        const names = ['tail1', 'tail2', 'tail3'];
        const on = k < 2 ? smooth(0.5, 1, f) * 0.5 : 0;
        const root = 1 - smooth(-0.3, 0.3, tail.u);
        give(names[k], (1 - on) * (1 - root));
        if (on > 0) give(names[k + 1], on * (1 - root));
        give('hips', root);
        return w;
    }
    if (part === PART.head) {
        // The skull is the head's alone; the neck hands over to the chest at its base.
        const neck = along(NECK_CHAIN, p);
        const head = smooth(0.78, 1.06, neck.u);
        const base = 1 - smooth(-0.2, 0.35, neck.u);
        give('head', head);
        give('neck', Math.max(0, 1 - head - base));
        back(z, give, base);
        return w;
    }
    // The trunk: the back's bones, the neck over the front of the chest, and over the shoulder
    // blade and the thigh a share of the leg below.
    let rest = 1;
    const neck = along(NECK_CHAIN, p);
    const toNeck = 0.6 * smooth(-0.35, 0.05, neck.u) * smooth(0.45, 0.62, z);
    give('neck', toNeck);
    rest -= toNeck;
    const ax = Math.abs(x);
    const fore = along(LEGS[`F${side}`].slice(0, 2), p);
    const arm = 0.5 * (1 - smooth(0.1, 0.3, fore.far)) * smooth(0.1, 0.2, ax) * (1 - smooth(1.05, 1.22, y));
    give(`arm${side}`, rest * arm);
    const hindLeg = along(LEGS[`B${side}`].slice(0, 2), p);
    const thigh = 0.5 * (1 - smooth(0.12, 0.34, hindLeg.far)) * smooth(0.1, 0.2, ax) * (1 - smooth(1.08, 1.25, y));
    give(`thigh${side}`, rest * (1 - arm) * thigh);
    rest *= (1 - arm) * (1 - thigh);
    back(z, give, rest);
    return w;
}

function skin(positions, parts, indices) {
    const count = positions.length / 3;
    const bones = BEAR_BONES.length;
    const raw = new Float64Array(count * bones);
    for (let i = 0; i < count; i++) {
        const w = weigh([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]], parts[i]);
        w.forEach((value, name) => {
            raw[i * bones + BEAR_BONE_INDEX[name]] = value;
        });
    }
    // Relax the weights over the surface: where two parts meet, the skin blends over a band of
    // vertices instead of tearing along an edge. (The soles are left alone: a paw is one bone.)
    const adj = adjacency(indices, count);
    const hold = new Float64Array(count);
    for (let i = 0; i < count; i++) hold[i] = smooth(0.03, 0.12, positions[i * 3 + 1]);
    for (let pass = 0; pass < 5; pass++) relax(raw, bones, adj, 0.5, hold);
    const joints = new Uint8Array(count * 4);
    const weights = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
        const entries = [];
        for (let b = 0; b < bones; b++) if (raw[i * bones + b] > 1e-4) entries.push([b, raw[i * bones + b]]);
        const top = entries.sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
        const sum = top.reduce((s, e) => s + e[1], 0) || 1;
        // Bytes that sum to exactly 255: the largest takes the rounding.
        const bytes = top.map((e) => Math.round((e[1] / sum) * 255));
        bytes[0] += 255 - bytes.reduce((s, v) => s + v, 0);
        for (let k = 0; k < 4; k++) {
            joints[i * 4 + k] = k < top.length && bytes[k] > 0 ? top[k][0] : 0;
            weights[i * 4 + k] = k < top.length ? bytes[k] : 0;
        }
    }
    return { joints, weights };
}

// ── Main ────────────────────────────────────────────────────────────────────────

function model({ blender, preview, keep }) {
    const work = mkdtempSync(join(tmpdir(), 'winter-bear-'));
    try {
        const skeleton = join(work, 'skeleton.json');
        writeFileSync(skeleton, JSON.stringify({ bones: BEAR_BONES, marks: BEAR_MARKS }));
        const mesh = keep || join(work, 'polar-bear-mesh.glb');
        const args = ['--background', '--factory-startup', '--python', MODEL_SCRIPT, '--',
            '--skeleton', skeleton, '--out', mesh];
        if (preview) args.push('--preview', preview);
        const run = spawnSync(blender, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const said = `${run.stdout || ''}${run.stderr || ''}`.split(/\r?\n/);
        const worth = said.filter((l) => /\[winter-bear\]|Error|Traceback/.test(l));
        worth.forEach((line) => console.log(`  ${line.trim()}`));
        if (run.status !== 0 || !existsSync(mesh)) {
            const why = `${run.error?.message || ''}\n${run.stderr || ''}`;
            throw new Error(`Blender did not model the bear (status ${run.status}): ${why}`);
        }
        return rig(mesh);
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

function rig(meshFile) {
    const { json, read } = readGlb(meshFile);
    const prim = json.meshes[0].primitives[0];
    const node = json.nodes.find((n) => n.mesh === 0);
    const positions = Float32Array.from(read(prim.attributes.POSITION));
    if (node?.translation || node?.scale) throw new Error('the mesh must carry metres (position_bits=32)');
    const normals = Float32Array.from(read(prim.attributes.NORMAL));
    const colours = Uint8Array.from(read(prim.attributes.COLOR_0), (v) => Math.round(clamp01(v) * 255));
    const parts = Uint8Array.from(read(prim.attributes._PART));
    const indices = Uint16Array.from(read(prim.indices));
    const count = positions.length / 3;
    const { joints, weights } = skin(positions, parts, indices);
    const extras = json.scenes[0].extras || {};
    const bytes = writeGlb({
        name: 'PolarBear',
        bones: BEAR_BONES,
        extras: {
            winterBear: RIG_VERSION,
            shoulderHeight: extras.shoulderHeight,
            rumpHeight: extras.rumpHeight,
            length: extras.length,
        },
        generator: 'serenity-blocks scripts/winter/model-bear.mjs (Blender: scripts/blender/winter_polar_bear.py)',
        positions,
        normals,
        colours,
        joints,
        weights,
        indices,
    });
    return {
        bytes, count, triangles: indices.length / 3, extras,
    };
}

function main() {
    const args = Object.fromEntries(process.argv.slice(2).map((a) => {
        const [k, ...v] = a.replace(/^--/, '').split('=');
        return [k, v.length ? v.join('=') : true];
    }));
    const started = Date.now();
    const result = typeof args.from === 'string'
        ? rig(resolve(args.from))
        : model({
            blender: typeof args.blender === 'string' ? args.blender : BLENDER,
            preview: typeof args.preview === 'string' ? resolve(args.preview) : null,
            keep: typeof args.mesh === 'string' ? resolve(args.mesh) : null,
        });
    const hash = createHash('sha256').update(result.bytes).digest('hex');
    console.log(`bear: ${result.count} vertices, ${result.triangles} triangles, ${BEAR_BONES.length} bones, `
        + `${(result.bytes.length / 1024).toFixed(0)} KiB, ${Date.now() - started} ms`);
    const { shoulderHeight, rumpHeight, length } = result.extras;
    console.log(`  shoulder ${shoulderHeight} m, rump ${rumpHeight} m, length ${length} m`);
    console.log(`  sha256 ${hash}`);
    if (!args.dry) {
        const out = typeof args.out === 'string' ? resolve(args.out) : ASSET;
        writeFileSync(out, result.bytes);
        console.log(`  wrote ${out}`);
    }
}

main();
