#!/usr/bin/env node
/**
 * Verdant Hills — model and rig the sheep: a ewe and her lamb.
 *
 * The flock is the project's own: no scan, no download, no clip. Two steps make each animal:
 *
 *   model   headless Blender (scripts/blender/verdant_hills_sheep.py) builds it as a signed
 *           distance field round the joints of the theme's rig — this script hands it the skeleton
 *           as JSON — meshes it, decimates it, mirrors it and bakes per vertex the part of the body
 *           it belongs to and its paint: (fleece, soil, dark, sky seen)
 *   rig     this script skins that mesh to the skeleton in
 *           src/themes/verdant-hills/verdant-hills-sheep-rig.js: every bone axis-aligned at rest, so
 *           the theme poses it with rotations in the model's own frame. A leg follows its three
 *           bones with soft joints and fades into the chest or the hips over its elbow or stifle; the
 *           wool over the shoulder and the thigh partly follows the leg; the trunk bends along hips,
 *           spine and chest; the woolly neck hands over to the skull behind the poll; the tail
 *           follows its chain. Every band is measured from the skeleton's own joints, so the lamb's
 *           skin bends where the lamb's joints are. Then the weights are relaxed over the surface,
 *           so no seam is left where two parts meet.
 *
 * No clips are written: the theme animates the skeleton itself (verdant-hills-sheep-rig.js).
 *
 *   node scripts/verdant-hills/model-sheep.mjs                       both, with Blender, writing the assets
 *   node scripts/verdant-hills/model-sheep.mjs --animal=lamb         only the lamb
 *   node scripts/verdant-hills/model-sheep.mjs --preview=<dir>       ... and Blender's stills of the meshes
 *   node scripts/verdant-hills/model-sheep.mjs --animal=ewe --from=<mesh.glb>   rig a mesh Blender wrote
 *   node scripts/verdant-hills/model-sheep.mjs --mesh=<dir>          keep Blender's meshes there
 *   node scripts/verdant-hills/model-sheep.mjs --blender=<exe>       (default: Blender 5.2 where it installs)
 *   node scripts/verdant-hills/model-sheep.mjs --dry                 do everything but write the assets
 *
 * Deterministic: the same Blender and the same scripts give the same bytes.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EWE_BONES, EWE_MARKS, LAMB_BONES, LAMB_MARKS,
} from '../../src/themes/verdant-hills/verdant-hills-sheep-rig.js';
import { readGlb } from '../fox/glb-read.mjs';
import { adjacency, relax, writeGlb } from '../fox/mesh-tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ASSETS = join(ROOT, 'src', 'themes', 'verdant-hills', 'assets');
const MODEL_SCRIPT = join(ROOT, 'scripts', 'blender', 'verdant_hills_sheep.py');
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
/** Stamped into each asset. */
const RIG_VERSION = 1;

/** Each animal: its skeleton and where its asset goes. */
export const SHEEP_ANIMALS = Object.freeze({
    ewe: Object.freeze({
        bones: EWE_BONES, marks: EWE_MARKS, file: 'verdant-ewe.glb', name: 'VerdantEwe',
    }),
    lamb: Object.freeze({
        bones: LAMB_BONES, marks: LAMB_MARKS, file: 'verdant-lamb.glb', name: 'VerdantLamb',
    }),
});

/** The parts Blender sorts the mesh into (verdant_hills_sheep.py PARTS). */
const PART = Object.freeze({
    body: 0, head: 1, frontLeft: 2, frontRight: 3, hindLeft: 4, hindRight: 5, tail: 6,
});

const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ── The skin ────────────────────────────────────────────────────────────────────

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

/**
 * The weigher for one skeleton: every band it uses is measured from that skeleton's joints.
 * @returns {(p: number[], part: number) => Map<string, number>}  bone name → weight
 */
function weigherFor(bones, marks) {
    const J = Object.fromEntries(bones.map((bone) => [bone[0], [bone[2], bone[3], bone[4]]]));
    const NECK_CHAIN = [J.neck, J.head, marks.nose];
    const TAIL_CHAIN = [J.tail1, J.tail2, J.tail3, marks.tailTip];
    const legChain = (front, side) => (front
        ? [J[`arm${side}`], J[`fore${side}`], J[`hand${side}`], marks[`pawF${side}`]]
        : [J[`thigh${side}`], J[`shin${side}`], J[`hock${side}`], marks[`pawB${side}`]]);
    const LEGS = {
        FL: legChain(true, 'L'), FR: legChain(true, 'R'), BL: legChain(false, 'L'), BR: legChain(false, 'R'),
    };
    // The back's bands: where the chest takes over from the spine and the spine from the hips.
    const spineZ = J.spine[2];
    const chestZ = J.chest[2];
    const hipsZ = J.hips[2];
    const chestBand = [lerp(spineZ, chestZ, 0.15), lerp(spineZ, chestZ, 0.8)];
    const hipsBand = [lerp(hipsZ, spineZ, 0.06), lerp(hipsZ, spineZ, 0.7)];
    // The neck's root reaches back over the front of the chest, between the chest joint and the neck's.
    const neckZ = J.neck[2];
    const neckBand = [lerp(chestZ, neckZ, -0.4), lerp(chestZ, neckZ, 0.6)];
    // The legs' sizes: how far out each leg's top stands, and how high.
    const foreSide = Math.abs(J.armL[0]);
    const hindSide = Math.abs(J.thighL[0]);

    function back(z, give, share) {
        const chest = smooth(chestBand[0], chestBand[1], z);
        const hips = 1 - smooth(hipsBand[0], hipsBand[1], z);
        give('chest', share * chest);
        give('hips', share * hips * (1 - chest));
        give('spine', share * Math.max(0, 1 - chest - hips));
    }

    return function weigh(p, part) {
        const [x, , z] = p;
        const side = x >= 0 ? 'L' : 'R';
        const w = new Map();
        const give = (bone, amount) => {
            if (amount > 1e-5) w.set(bone, (w.get(bone) || 0) + amount);
        };
        const front = part === PART.frontLeft || part === PART.frontRight;
        const hind = part === PART.hindLeft || part === PART.hindRight;
        if (front || hind) {
            // A leg: its own three bones with soft joints; over its elbow or stifle it hands over
            // to what carries it.
            const chain = LEGS[`${front ? 'F' : 'B'}${side}`];
            const { u } = along(chain, p);
            const [upper, lower, last, carrier] = front
                ? [`arm${side}`, `fore${side}`, `hand${side}`, 'chest']
                : [`thigh${side}`, `shin${side}`, `hock${side}`, 'hips'];
            const top = 1 - smooth(-0.05, 0.4, u);
            const lastShare = smooth(1.82, 2.04, u) * (1 - top);
            const lowerShare = smooth(0.84, 1.1, u) * (1 - top) - lastShare;
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
            const root = 1 - smooth(-0.35, 0.3, tail.u);
            give(names[k], (1 - on) * (1 - root));
            if (on > 0) give(names[k + 1], on * (1 - root));
            give('hips', root);
            return w;
        }
        if (part === PART.head) {
            // The bare skull is the head's alone; the woolly neck hands over to it behind the poll
            // and to the chest at its root.
            const neck = along(NECK_CHAIN, p);
            const head = smooth(0.8, 1.08, neck.u);
            const base = 1 - smooth(-0.25, 0.3, neck.u);
            give('head', head);
            give('neck', Math.max(0, 1 - head - base));
            back(z, give, base);
            return w;
        }
        // The trunk: the back's bones, the neck over the front of the chest, and over the shoulder
        // and the thigh a share of the leg below.
        let rest = 1;
        const neck = along(NECK_CHAIN, p);
        const toNeck = 0.6 * smooth(-0.4, 0.05, neck.u) * smooth(neckBand[0], neckBand[1], z);
        give('neck', toNeck);
        rest -= toNeck;
        // The upper leg bone pivots inside the fleece (the foreleg's at the shoulder blade up by the
        // withers, the hind leg's at the hip): the wool over it follows it only softly, not at all at
        // its pivot and most toward the elbow or the stifle, so the flank never swings with a stride.
        const ax = Math.abs(x);
        const fore = along(LEGS[`F${side}`].slice(0, 2), p);
        const arm = 0.42 * (1 - smooth(0.6 * foreSide, 1.7 * foreSide, fore.far))
            * smooth(0.45 * foreSide, 1.0 * foreSide, ax)
            * smooth(0.25, 0.85, fore.u) * (1 - smooth(1.15, 1.4, fore.u));
        give(`arm${side}`, rest * arm);
        const hindLeg = along(LEGS[`B${side}`].slice(0, 2), p);
        const thigh = 0.45 * (1 - smooth(0.6 * hindSide, 1.8 * hindSide, hindLeg.far))
            * smooth(0.45 * hindSide, 1.0 * hindSide, ax)
            * smooth(0.15, 0.8, hindLeg.u) * (1 - smooth(1.15, 1.4, hindLeg.u));
        give(`thigh${side}`, rest * (1 - arm) * thigh);
        rest *= (1 - arm) * (1 - thigh);
        back(z, give, rest);
        return w;
    };
}

function skin(bones, marks, positions, parts, indices) {
    const count = positions.length / 3;
    const n = bones.length;
    const index = Object.fromEntries(bones.map((bone, i) => [bone[0], i]));
    const weigh = weigherFor(bones, marks);
    const raw = new Float64Array(count * n);
    for (let i = 0; i < count; i++) {
        const w = weigh([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]], parts[i]);
        w.forEach((value, name) => {
            raw[i * n + index[name]] = value;
        });
    }
    // Relax the weights over the surface: where two parts meet, the skin blends over a band of
    // vertices instead of tearing along an edge. (The hooves are left alone: a hoof is one bone.)
    const adj = adjacency(indices, count);
    const hoofTop = Math.max(...['pawFL', 'pawBL'].map((m) => marks[m][1])) + 0.06 * (Math.abs(marks.pawFL[0]) / 0.105);
    const hold = new Float64Array(count);
    for (let i = 0; i < count; i++) hold[i] = smooth(0.4 * hoofTop, hoofTop, positions[i * 3 + 1]);
    for (let pass = 0; pass < 5; pass++) relax(raw, n, adj, 0.5, hold);
    const joints = new Uint8Array(count * 4);
    const weights = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
        const entries = [];
        for (let b = 0; b < n; b++) if (raw[i * n + b] > 1e-4) entries.push([b, raw[i * n + b]]);
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

function model(animal, { blender, preview, keep }) {
    const { bones, marks } = SHEEP_ANIMALS[animal];
    const work = mkdtempSync(join(tmpdir(), `verdant-${animal}-`));
    try {
        const skeleton = join(work, 'skeleton.json');
        writeFileSync(skeleton, JSON.stringify({ bones, marks }));
        let mesh = join(work, `${animal}-mesh.glb`);
        if (keep) {
            mkdirSync(keep, { recursive: true });
            mesh = join(keep, `${animal}-mesh.glb`);
        }
        const args = ['--background', '--factory-startup', '--python', MODEL_SCRIPT, '--',
            '--animal', animal, '--skeleton', skeleton, '--out', mesh];
        if (preview) args.push('--preview', preview);
        const run = spawnSync(blender, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const said = `${run.stdout || ''}${run.stderr || ''}`.split(/\r?\n/);
        const worth = said.filter((l) => /\[verdant-sheep\]|Error|Traceback/.test(l));
        worth.forEach((line) => console.log(`  ${line.trim()}`));
        if (run.status !== 0 || !existsSync(mesh)) {
            const why = `${run.error?.message || ''}\n${run.stderr || ''}`;
            throw new Error(`Blender did not model the ${animal} (status ${run.status}): ${why}`);
        }
        return rig(animal, mesh);
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

function rig(animal, meshFile) {
    const { bones, marks, name } = SHEEP_ANIMALS[animal];
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
    const { joints, weights } = skin(bones, marks, positions, parts, indices);
    const extras = json.scenes[0].extras || {};
    const bytes = writeGlb({
        name,
        bones,
        extras: {
            verdantSheep: RIG_VERSION,
            animal,
            withersHeight: extras.withersHeight,
            rumpHeight: extras.rumpHeight,
            bellyHeight: extras.bellyHeight,
            length: extras.length,
            colour: 'r fleece (1 wool, 0 bare skin), g soil, b dark (eyes, nostrils, hooves, inside the ears), '
                + 'a sky seen',
        },
        generator: 'serenity-blocks scripts/verdant-hills/model-sheep.mjs '
            + '(Blender: scripts/blender/verdant_hills_sheep.py)',
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
    const which = typeof args.animal === 'string' && args.animal !== 'both' ? [args.animal] : ['ewe', 'lamb'];
    which.forEach((animal) => {
        if (!SHEEP_ANIMALS[animal]) throw new Error(`no such animal: ${animal} (ewe, lamb, both)`);
    });
    if (typeof args.from === 'string' && which.length !== 1) throw new Error('--from rigs one animal: give --animal');
    for (const animal of which) {
        const started = Date.now();
        const result = typeof args.from === 'string'
            ? rig(animal, resolve(args.from))
            : model(animal, {
                blender: typeof args.blender === 'string' ? args.blender : BLENDER,
                preview: typeof args.preview === 'string' ? resolve(args.preview) : null,
                keep: typeof args.mesh === 'string' ? resolve(args.mesh) : null,
            });
        const hash = createHash('sha256').update(result.bytes).digest('hex');
        const { bones, file } = SHEEP_ANIMALS[animal];
        console.log(`${animal}: ${result.count} vertices, ${result.triangles} triangles, ${bones.length} bones, `
            + `${(result.bytes.length / 1024).toFixed(0)} KiB, ${Date.now() - started} ms`);
        const {
            withersHeight, rumpHeight, bellyHeight, length,
        } = result.extras;
        console.log(`  withers ${withersHeight} m, rump ${rumpHeight} m, belly ${bellyHeight} m, length ${length} m`);
        console.log(`  sha256 ${hash}`);
        if (!args.dry) {
            const out = join(ASSETS, file);
            writeFileSync(out, result.bytes);
            console.log(`  wrote ${out}`);
        }
    }
}

main();
