#!/usr/bin/env node
/**
 * Sakura Twilight — rig the red fox.
 *
 * The garden's foxes are the glTF sample fox (assets/Fox.glb: see assets/ATTRIBUTION.md, CC-BY
 * 4.0). As it comes it is 576 flat triangles with no normals, on bones that point every which
 * way, with three baked clips. This script makes of it the animal the theme animates and gives
 * a coat to (assets/sakura-fox.glb); Fox.glb itself is kept untouched as the source.
 *
 *   mesh      welded, then subdivided twice (Loop's rule, eased off at the ears, the paws, the
 *             muzzle and the tip of the tail, which should stay sharp) so that a coat of fur
 *             has a rounded body to stand on; metres instead of centimetres; smooth normals
 *   skeleton  the table in src/themes/sakura-twilight/sakura-fox-rig.js: the sample fox's own
 *             joints, kept where its rigger put them, but every bone axis-aligned at rest — so
 *             the theme poses it with rotations in the model's own frame (../shared/fox-rig.js)
 *   skin      the sample fox's own weights, carried through the subdivision and renamed
 *   coat      its texture (its colours) as it was, and four numbers a vertex stored as its
 *             colour: how far along the tail it is, how long its fur is there, nothing, and how
 *             much of the sky it sees (an occlusion bake)
 *
 * No clips are written: the theme animates the skeleton itself.
 *
 *   node scripts/sakura/rig-fox.mjs                   rig Fox.glb and write sakura-fox.glb
 *   node scripts/sakura/rig-fox.mjs --preview=<dir>   also draw the mesh, skin and coat (CPU)
 *   node scripts/sakura/rig-fox.mjs --check           rig in memory and compare with the asset
 *
 * Deterministic: the same script and source give the same bytes.
 */

import { createHash } from 'node:crypto';
import {
    existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAKURA_FOX_BONES, SAKURA_FOX_MARKS } from '../../src/themes/sakura-twilight/sakura-fox-rig.js';
import {
    adjacency, normalsOf, occlusion, writeGlb,
} from '../fox/mesh-tools.mjs';
import { SIDES, picture, tile } from '../fox/cpu-picture.mjs';
import { readGlb } from '../fox/glb-read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ASSETS = join(ROOT, 'src', 'themes', 'sakura-twilight', 'assets');
const SOURCE = join(ASSETS, 'Fox.glb');
const ASSET = join(ASSETS, 'sakura-fox.glb');
const RIG_VERSION = 1;
/** The sample fox is modelled in centimetres. */
const METRES = 0.01;
/** Times its triangles are split in four. */
const LEVELS = 2;

const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** The sample fox's joints, and the bone of ours each one's skin goes to. */
const JOINTS = Object.freeze({
    _rootJoint: 'hips',
    b_Root_00: 'hips',
    b_Hip_01: 'hips',
    b_Spine01_02: 'spine',
    b_Spine02_03: 'chest',
    b_Neck_04: 'neck',
    b_Head_05: 'head',
    b_RightUpperArm_06: 'armR',
    b_RightForeArm_07: 'foreR',
    b_RightHand_08: 'handR',
    b_LeftUpperArm_09: 'armL',
    b_LeftForeArm_010: 'foreL',
    b_LeftHand_011: 'handL',
    b_Tail01_012: 'tail1',
    b_Tail02_013: 'tail2',
    b_Tail03_014: 'tail3',
    b_LeftLeg01_015: 'thighL',
    b_LeftLeg02_016: 'shinL',
    b_LeftFoot01_017: 'hockL',
    b_LeftFoot02_018: 'hockL',
    b_RightLeg01_019: 'thighR',
    b_RightLeg02_020: 'shinR',
    b_RightFoot01_021: 'hockR',
    b_RightFoot02_022: 'hockR',
});
/** The joint each of our bones stands at (a foot's second joint is part of our hock). */
const STANDS_AT = Object.freeze({
    hips: 'b_Hip_01',
    spine: 'b_Spine01_02',
    chest: 'b_Spine02_03',
    neck: 'b_Neck_04',
    head: 'b_Head_05',
    tail1: 'b_Tail01_012',
    tail2: 'b_Tail02_013',
    tail3: 'b_Tail03_014',
    armL: 'b_LeftUpperArm_09',
    foreL: 'b_LeftForeArm_010',
    handL: 'b_LeftHand_011',
    armR: 'b_RightUpperArm_06',
    foreR: 'b_RightForeArm_07',
    handR: 'b_RightHand_08',
    thighL: 'b_LeftLeg01_015',
    shinL: 'b_LeftLeg02_016',
    hockL: 'b_LeftFoot01_017',
    thighR: 'b_RightLeg01_019',
    shinR: 'b_RightLeg02_020',
    hockR: 'b_RightFoot01_021',
});
const BONE_INDEX = Object.fromEntries(SAKURA_FOX_BONES.map((bone, i) => [bone[0], i]));
const JOINT = Object.fromEntries(SAKURA_FOX_BONES.map((bone) => [bone[0], [bone[2], bone[3], bone[4]]]));

// ── The source ──────────────────────────────────────────────────────────────────

/** Where every node of a glTF stands (translations and rotations down its tree). */
function nodePlaces(json) {
    const parent = {};
    json.nodes.forEach((node, i) => (node.children || []).forEach((child) => {
        parent[child] = i;
    }));
    const rotate = (q, v) => {
        const [x, y, z, w] = q;
        const tx = 2 * (y * v[2] - z * v[1]);
        const ty = 2 * (z * v[0] - x * v[2]);
        const tz = 2 * (x * v[1] - y * v[0]);
        return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
    };
    const mul = (a, b) => [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
    const world = {};
    const solve = (i) => {
        if (world[i]) return world[i];
        const node = json.nodes[i];
        const t = node.translation || [0, 0, 0];
        const r = node.rotation || [0, 0, 0, 1];
        if (parent[i] === undefined) world[i] = { p: t, q: r };
        else {
            const up = solve(parent[i]);
            const moved = rotate(up.q, t);
            world[i] = { p: [up.p[0] + moved[0], up.p[1] + moved[1], up.p[2] + moved[2]], q: mul(up.q, r) };
        }
        return world[i];
    };
    return Object.fromEntries(json.nodes.map((node, i) => [node.name, solve(i).p]));
}

/** The sample fox as a welded mesh: places, each one's skin, and triangles with their corners' UVs. */
function readSource() {
    const { json, read } = readGlb(SOURCE);
    const prim = json.meshes[0].primitives[0];
    if (prim.indices !== undefined) throw new Error('the sample fox is expected without indices');
    const pos = read(prim.attributes.POSITION);
    const uv = read(prim.attributes.TEXCOORD_0);
    const joints = read(prim.attributes.JOINTS_0);
    const weights = read(prim.attributes.WEIGHTS_0);
    const names = json.skins[0].joints.map((node) => json.nodes[node].name);
    // Our bones stand where its joints do: the table in the theme is checked against the file.
    const places = nodePlaces(json);
    Object.keys(STANDS_AT).forEach((bone) => {
        const at = places[STANDS_AT[bone]].map((v) => v * METRES);
        const ours = JOINT[bone];
        const off = Math.hypot(at[0] - ours[0], at[1] - ours[1], at[2] - ours[2]);
        if (off > 0.001) {
            throw new Error(`${bone} is ${(off * 1000).toFixed(1)} mm from ${STANDS_AT[bone]} `
                + `(${at.map((v) => v.toFixed(4)).join(', ')}): fix SAKURA_FOX_BONES`);
        }
    });
    const ids = new Map();
    const P = [];
    const skin = [];
    const corner = [];
    for (let i = 0; i < pos.length / 3; i++) {
        const p = [pos[i * 3] * METRES, pos[i * 3 + 1] * METRES, pos[i * 3 + 2] * METRES];
        const key = p.map((v) => v.toFixed(5)).join(',');
        if (!ids.has(key)) {
            ids.set(key, P.length);
            P.push(p);
            const own = new Map();
            for (let k = 0; k < 4; k++) {
                const w = weights[i * 4 + k];
                if (w <= 0) continue;
                const bone = JOINTS[names[joints[i * 4 + k]]];
                if (!bone) throw new Error(`no bone for joint ${names[joints[i * 4 + k]]}`);
                own.set(bone, (own.get(bone) || 0) + w);
            }
            skin.push(own);
        }
        corner.push(ids.get(key));
    }
    const faces = [];
    for (let i = 0; i < corner.length; i += 3) {
        faces.push({
            v: [corner[i], corner[i + 1], corner[i + 2]],
            uv: [0, 1, 2].map((k) => [uv[(i + k) * 2], uv[(i + k) * 2 + 1]]),
        });
    }
    // Its texture, as the file holds it.
    const image = json.images[json.textures[0].source];
    const view = json.bufferViews[image.bufferView];
    const file = readFileSync(SOURCE);
    const bin = file.subarray(20 + file.readUInt32LE(12) + 8);
    const bytes = Buffer.from(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
    return {
        P, skin, faces, image: { bytes, mimeType: image.mimeType, sampler: json.samplers[json.textures[0].sampler] },
    };
}

// ── Rounding it ─────────────────────────────────────────────────────────────────

/** How much of its modelled sharpness a place keeps (ear tips, toes, the muzzle, the tail's tip). */
function sharp(p) {
    const [, y, z] = p;
    const ears = smooth(0.7, 0.76, y);
    const toes = 1 - smooth(0.015, 0.06, y);
    const muzzle = smooth(0.58, 0.64, z);
    const tip = 1 - smooth(-0.86, -0.8, z);
    return clamp01(0.12 + 0.75 * Math.max(ears, toes, muzzle, tip));
}

const mixSkin = (a, b) => {
    const out = new Map();
    a.forEach((w, bone) => out.set(bone, w * 0.5));
    b.forEach((w, bone) => out.set(bone, (out.get(bone) || 0) + w * 0.5));
    return out;
};

/** Split every triangle in four by Loop's rule (corners keep their own UVs, so seams stay seams). */
function subdivide({ P, skin, faces }) {
    const edges = new Map();
    const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    faces.forEach((face) => {
        for (let i = 0; i < 3; i++) {
            const a = face.v[i];
            const b = face.v[(i + 1) % 3];
            const k = key(a, b);
            if (!edges.has(k)) edges.set(k, { a: Math.min(a, b), b: Math.max(a, b), across: [] });
            edges.get(k).across.push(face.v[(i + 2) % 3]);
        }
    });
    const near = P.map(() => []);
    const open = P.map(() => false);
    edges.forEach((edge) => {
        near[edge.a].push(edge.b);
        near[edge.b].push(edge.a);
        if (edge.across.length !== 2) {
            open[edge.a] = true;
            open[edge.b] = true;
        }
    });
    const Q = [];
    const S = [];
    P.forEach((p, i) => {
        const n = near[i].length;
        if (open[i] || n < 3) Q.push([...p]);
        else {
            const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
            const keep = sharp(p);
            const sum = [0, 0, 0];
            near[i].forEach((j) => {
                sum[0] += P[j][0];
                sum[1] += P[j][1];
                sum[2] += P[j][2];
            });
            Q.push([0, 1, 2].map((c) => {
                const loop = (1 - n * beta) * p[c] + beta * sum[c];
                return loop + (p[c] - loop) * keep;
            }));
        }
        S.push(skin[i]);
    });
    edges.forEach((edge) => {
        const a = P[edge.a];
        const b = P[edge.b];
        const mid = [0, 1, 2].map((c) => 0.5 * (a[c] + b[c]));
        let q = mid;
        if (edge.across.length === 2) {
            const c1 = P[edge.across[0]];
            const c2 = P[edge.across[1]];
            const keep = sharp(mid);
            q = [0, 1, 2].map((c) => {
                const loop = 0.375 * (a[c] + b[c]) + 0.125 * (c1[c] + c2[c]);
                return loop + (mid[c] - loop) * keep;
            });
        }
        edge.mid = Q.length;
        Q.push(q);
        S.push(mixSkin(skin[edge.a], skin[edge.b]));
    });
    const out = [];
    const half = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    faces.forEach((face) => {
        const m = [0, 1, 2].map((i) => edges.get(key(face.v[i], face.v[(i + 1) % 3])).mid);
        const um = [0, 1, 2].map((i) => half(face.uv[i], face.uv[(i + 1) % 3]));
        out.push(
            { v: [face.v[0], m[0], m[2]], uv: [face.uv[0], um[0], um[2]] },
            { v: [m[0], face.v[1], m[1]], uv: [um[0], face.uv[1], um[1]] },
            { v: [m[2], m[1], face.v[2]], uv: [um[2], um[1], face.uv[2]] },
            { v: [m[0], m[1], m[2]], uv: [um[0], um[1], um[2]] },
        );
    });
    return { P: Q, skin: S, faces: out };
}

// ── The coat ────────────────────────────────────────────────────────────────────

/** Where a point is along a chain of joints (0 at the first, 1 at the second…), and how far off it. */
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

const TAIL_CHAIN = [JOINT.tail1, JOINT.tail2, JOINT.tail3, SAKURA_FOX_MARKS.tailTip];
const NECK_CHAIN = [JOINT.neck, JOINT.head, SAKURA_FOX_MARKS.nose];

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
    return value(x * 17, y * 17, z * 11) * 0.65 + value(x * 39 + 3.1, y * 39 + 1.7, z * 27 + 5.3) * 0.35;
}

/** The coat's numbers a place, as bytes: tail, fur length (0..2 as 0..255), nothing, sky seen. */
function coat(P, sees) {
    const out = new Uint8Array(P.length * 4);
    P.forEach((p, i) => {
        const [x, y, z] = p;
        const tail = along(TAIL_CHAIN, p);
        const onTail = smooth(-0.25, 0.25, tail.u) * (1 - smooth(0.16, 0.24, tail.far)) * smooth(-0.34, -0.42, z);
        const neck = along(NECK_CHAIN, p);
        const onHead = smooth(0.6, 1.05, neck.u) * smooth(0.5, 0.58, y);
        // Fur: short on the paws and thin up the legs, short on the face and ears, a ruff at
        // the neck and chest, longest on the brush.
        const leg = smooth(0.04, 0.42, y);
        const muzzle = smooth(1.35, 1.75, neck.u) * onHead;
        const face = smooth(1.0, 1.35, neck.u) * onHead;
        const ear = smooth(0.7, 0.75, y);
        const ruff = smooth(-0.5, 0.2, neck.u) * (1 - smooth(0.7, 1.1, neck.u)) * smooth(0.36, 0.5, y);
        let length = 0.22 + 0.78 * leg;
        length *= 1 + 0.45 * ruff;
        length *= 1 - 0.5 * face;
        length *= 1 - 0.55 * muzzle;
        length *= 1 - 0.6 * ear;
        length += (1.9 - length) * onTail * (0.55 + 0.45 * smooth(0, 1.2, tail.u)) * (1 - smooth(2.6, 3, tail.u) * 0.5);
        length *= 0.75 + 0.5 * tuft(x, y, z);
        out[i * 4] = Math.round(clamp01(onTail * (0.3 + 0.7 * clamp01(tail.u / 3))) * 255);
        out[i * 4 + 1] = Math.round(clamp01(length / 2) * 255);
        out[i * 4 + 2] = 0;
        out[i * 4 + 3] = Math.round(clamp01((sees[i] - 0.12) / 0.8) * 255);
    });
    return out;
}

// ── Pictures ────────────────────────────────────────────────────────────────────

const HUES = SAKURA_FOX_BONES.map((_, i) => {
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
    const views = [
        ['left', [0, 0.42, -0.1], 1.75], ['front', [0, 0.45, 0], 1.05], ['top', [0, 0.4, -0.1], 1.75],
    ];
    const sheet = (name, colour, marks) => {
        const tiles = views.map(([side, centre, span]) => {
            const [right, up] = SIDES[side];
            const p = picture({
                positions, indices, colour, right, up, centre, span, width: 600, height: 420, floor: up[1] === 1 ? 0 : undefined,
            });
            if (marks) marks(p);
            return p;
        });
        console.log(`  ${tile(tiles, 3, join(dir, `${name}.png`))}`);
    };
    sheet('fox-mesh', undefined, (p) => {
        SAKURA_FOX_BONES.forEach((bone) => {
            if (bone[1]) p.line(JOINT[bone[1]], JOINT[bone[0]], [255, 210, 60]);
        });
        SAKURA_FOX_BONES.forEach((bone) => p.dot(JOINT[bone[0]], [255, 70, 70], 2));
        Object.values(SAKURA_FOX_MARKS).forEach((mark) => p.dot(mark, [80, 255, 140], 2));
        p.dot([-SAKURA_FOX_MARKS.eye[0], SAKURA_FOX_MARKS.eye[1], SAKURA_FOX_MARKS.eye[2]], [80, 255, 140], 2);
    });
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
    sheet('fox-coat', (v) => {
        const length = colours[v * 4 + 1] / 255;
        const sees = colours[v * 4 + 3] / 255;
        const shade = 0.3 + 0.7 * sees;
        return [(0.2 + 0.8 * length) * shade, (0.25 + 0.5 * length) * shade, (0.9 - 0.6 * length) * shade];
    });
}

// ── Main ────────────────────────────────────────────────────────────────────────

function rig() {
    const source = readSource();
    let mesh = { P: source.P, skin: source.skin, faces: source.faces };
    for (let level = 0; level < LEVELS; level++) mesh = subdivide(mesh);
    const { P, skin, faces } = mesh;
    // Stand it on the ground.
    const foot = Math.min(...P.map((p) => p[1]));
    P.forEach((p) => {
        p[1] -= foot;
    });
    // Normals and the sky it sees are the welded surface's, whatever its UV seams.
    const welded = Uint32Array.from(faces.flatMap((face) => face.v));
    const places = Float32Array.from(P.flat());
    const adj = adjacency(welded, P.length);
    const normals = normalsOf(places, welded, adj, 1);
    const sees = occlusion(places, normals, welded, adj, { cell: 0.05, reach: 0.45 });
    const paint = coat(P, sees);
    // A vertex for every place-and-UV there is: seams are places with two.
    const ids = new Map();
    const of = [];
    const uvs = [];
    const indexList = [];
    faces.forEach((face) => {
        for (let k = 0; k < 3; k++) {
            const key = `${face.v[k]}|${face.uv[k][0].toFixed(5)},${face.uv[k][1].toFixed(5)}`;
            if (!ids.has(key)) {
                ids.set(key, of.length);
                of.push(face.v[k]);
                uvs.push(face.uv[k][0], face.uv[k][1]);
            }
            indexList.push(ids.get(key));
        }
    });
    const count = of.length;
    if (count > 65535) throw new Error(`the fox has ${count} vertices: more than 16-bit indices hold`);
    const positions = new Float32Array(count * 3);
    const normalOut = new Float32Array(count * 3);
    const colours = new Uint8Array(count * 4);
    const joints = new Uint8Array(count * 4);
    const weights = new Uint8Array(count * 4);
    of.forEach((v, i) => {
        positions.set(P[v], i * 3);
        normalOut.set([normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]], i * 3);
        colours.set(paint.subarray(v * 4, v * 4 + 4), i * 4);
        const top = [...skin[v].entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 4);
        const sum = top.reduce((s, e) => s + e[1], 0) || 1;
        // Bytes that sum to exactly 255: the largest takes the rounding.
        const bytes = top.map((e) => Math.round((e[1] / sum) * 255));
        bytes[0] += 255 - bytes.reduce((s, b) => s + b, 0);
        for (let k = 0; k < 4; k++) {
            joints[i * 4 + k] = k < top.length && bytes[k] > 0 ? BONE_INDEX[top[k][0]] : 0;
            weights[i * 4 + k] = k < top.length ? bytes[k] : 0;
        }
    });
    const out = {
        positions, normals: normalOut, colours, uvs: Float32Array.from(uvs), joints, weights, indices: Uint16Array.from(indexList),
    };
    const bytes = writeGlb({
        name: 'SakuraFox',
        bones: SAKURA_FOX_BONES,
        extras: { sakuraFoxRig: RIG_VERSION, source: 'Fox.glb (glTF sample fox, CC-BY 4.0: see ATTRIBUTION.md)' },
        generator: 'serenity-blocks scripts/sakura/rig-fox.mjs',
        ...out,
        image: source.image,
    });
    // What the theme's table of marks should say (printed, to keep it honest).
    let nose = [0, 0, -Infinity];
    let tip = [0, 0, Infinity];
    P.forEach((p) => {
        if (p[2] > nose[2]) nose = p;
        if (p[2] < tip[2]) tip = p;
    });
    return {
        mesh: out, bytes, nose, tip, places: P.length,
    };
}

function main() {
    const args = Object.fromEntries(process.argv.slice(2).map((a) => {
        const [k, v] = a.replace(/^--/, '').split('=');
        return [k, v ?? true];
    }));
    if (!existsSync(SOURCE)) throw new Error(`no such file: ${SOURCE}`);
    const started = Date.now();
    const {
        mesh, bytes, nose, tip, places,
    } = rig();
    const hash = createHash('sha256').update(bytes).digest('hex');
    console.log(`fox: ${places} places, ${mesh.positions.length / 3} vertices, ${mesh.indices.length / 3} triangles, `
        + `${SAKURA_FOX_BONES.length} bones, ${(bytes.length / 1024).toFixed(0)} KiB, ${Date.now() - started} ms`);
    console.log(`  tip of the muzzle at ${nose.map((v) => v.toFixed(3)).join(', ')}; of the tail at ${tip.map((v) => v.toFixed(3)).join(', ')}`);
    console.log(`  sha256 ${hash}`);
    if (typeof args.preview === 'string') pictures(resolve(args.preview), mesh);
    if (args.check) {
        const have = existsSync(ASSET) ? createHash('sha256').update(readFileSync(ASSET)).digest('hex') : 'missing';
        if (have !== hash) {
            console.error(`FAIL: the asset is ${have}, a fresh rig is ${hash}`);
            process.exit(1);
        }
        console.log('  the asset matches');
        return;
    }
    if (!args.dry) {
        const target = typeof args.out === 'string' ? resolve(args.out) : ASSET;
        writeFileSync(target, bytes);
        console.log(`  wrote ${target}`);
    }
}

main();
