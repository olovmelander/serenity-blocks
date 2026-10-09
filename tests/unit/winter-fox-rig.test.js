/**
 * Winter — the arctic fox's body (winter-fox-rig.js): its skeleton, the asset skinned to it, and
 * the rig the themes share (../shared/fox-rig.js) as it carries this animal: the poses it is
 * given and the solver that carries them out. No three, no GPU.
 *
 * What is pinned is what holds by construction or is the point of the design — a planted paw is
 * on the snow where the pose has it, a paw in stance does not slide, what is drawn is what was
 * solved, a pose cross-fades and mirrors, nothing snaps — not the tuning: every length, angle and
 * timing is read from the module, and where the test needs a number of its own it is a generous
 * one. (The same engine on a skeleton of other proportions is shared-fox-rig.test.js.)
 */

import { spawnSync } from 'node:child_process';
import {
    mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import {
    FOOT as FEET, FOX_ACTS, FOX_BONES, FOX_BONE_INDEX, FOX_LEGS, FOX_MARKS, FOX_RIG, POUNCE_AIR, SLEEP_HOLD, SPEC,
    SPEC_SIZE, createFoxPosture, createFoxSpec, foxAct, foxDuty, foxFootfalls, foxGait, foxGallop, foxPoint, foxSpec,
    foxStride, qBetween, qMul, qRotate, qSlerp, qTurn, solveFox,
} from '../../src/themes/winter/winter-fox-rig.js';
import * as shared from '../../src/themes/shared/fox-rig.js';
import { FOX_SCALE, mulberry32 } from '../../src/themes/winter/winter-core.js';
import { readGlb } from '../../scripts/fox/glb-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSET = path.join(ROOT, 'src', 'themes', 'winter', 'assets', 'arctic-fox.glb');
const RIG_SCRIPT = path.join(ROOT, 'scripts', 'winter', 'rig-fox.mjs');
const source = readFileSync(path.join(ROOT, 'src', 'themes', 'winter', 'winter-fox-rig.js'), 'utf8');
/** The engine's own source: what turns a mind's pose into a spec is written there. */
const engine = readFileSync(path.join(ROOT, 'src', 'themes', 'shared', 'fox-rig.js'), 'utf8');

const FRAME = 1 / 60;
const DEG = Math.PI / 180;
/** What it does at a stop: every act but its gait. */
const POSES = Object.keys(FOX_ACTS).filter((name) => name !== 'Run');
/** Paces (m/s, world): a walk, its trot, a run, the trot opening into a gallop, flat out. */
const TROT = 1.5;
const FLAT_OUT = 6.8;
const PACES = [0.6, TROT, 3, 4.5, FLAT_OUT];
/** Samples to a cycle of the gait. */
const CYCLE = 240;
/** A foot's five numbers, in the order the rig lists them. */
const FOOT = 5;
const DX = 0;
const DY = 1;
const DZ = 2;
const AIR = 4;
const FOOT_NUMBERS = ['dx', 'dy', 'dz', 'toe', 'air'];
/** The numbers of a spec that move its trunk. */
const TRUNK = ['rear', 'fore', 'shift', 'sway', 'pitch', 'roll', 'yaw', 'arch', 'bend', 'twist'];
/** What the name of each number of a spec is, for a failing test to say. */
const FIELDS = [];
Object.entries(SPEC).forEach(([name, index]) => {
    if (name !== 'feet') FIELDS[index] = name;
});
FOX_LEGS.forEach(([leg], i) => FOOT_NUMBERS.forEach((name, k) => {
    FIELDS[SPEC.feet + i * FOOT + k] = `${leg}.${name}`;
}));
/** The bones of its legs, and the rest of it. */
const LEG_BONES = new Set(FOX_LEGS.flatMap((leg) => [leg[1], leg[2], leg[3]]));
const BODY = FOX_BONES.map((bone, i) => i).filter((i) => !LEG_BONES.has(FOX_BONES[i][0]));
/** Nose to the tip of its tail at rest (model metres). */
const LENGTH = FOX_MARKS.nose[2] - FOX_MARKS.tailTip[2];

const restOf = (bone) => FOX_BONES[FOX_BONE_INDEX[bone]].slice(2);
const parentOf = (bone) => FOX_BONES[FOX_BONE_INDEX[bone]][1];
const foot = (leg) => SPEC.feet + leg * FOOT;
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
/** The angle between two rotations (radians). */
const turnBetween = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dot4(a, b))));
/** Whether two rotations are one and the same turn, to rounding (an angle is too blunt a rule that near none). */
const sameTurn = (a, b) => 1 - Math.abs(dot4(a, b)) < 1e-12;
/** Where a paw meets the snow in a posture. */
const pawAt = (posture, leg, out = [0, 0, 0]) => foxPoint(posture, FOX_LEGS[leg][3], FOX_MARKS[FOX_LEGS[leg][4]], out);
const noseAt = (posture) => foxPoint(posture, 'head', FOX_MARKS.nose);
const tailTipAt = (posture) => foxPoint(posture, 'tail4', FOX_MARKS.tailTip);
const jointAt = (posture, bone) => posture.at[FOX_BONE_INDEX[bone]];
const act = (name, t) => foxAct(createFoxSpec(), name, t);
const gait = (phase, speed, amount = 1, step = 0) => foxGait(createFoxSpec(), phase, speed, amount, step);
/** A pose of the mind's with nothing laid over it: one act, held, at a stand. */
const still = (clip, clipTime, over = {}) => ({
    clip, clipTime, from: clip, fromTime: clipTime, blend: 1, phase: 0, speed: 0, amp: 0, step: 0, side: 1, ...over,
});

/** Every pose worth asking about: each act through its length, each pace through a cycle. */
function eachMoment(visit) {
    const spec = createFoxSpec();
    POSES.forEach((name) => {
        const frames = Math.ceil(FOX_ACTS[name] / FRAME);
        for (let i = 0; i <= frames; i++) {
            visit(foxAct(spec, name, i * FRAME), () => `${name} at ${(i * FRAME).toFixed(3)} s`);
        }
    });
    PACES.forEach((speed) => {
        for (let i = 0; i < CYCLE; i++) {
            spec.fill(0);
            foxGait(spec, i / CYCLE, speed, 1);
            visit(spec, () => `its gait at ${speed} m/s, phase ${(i / CYCLE).toFixed(3)}`);
        }
    });
}

/** The largest change of each number of a spec between samples `step` apart, over `span`. */
function largestSteps(fill, span, step) {
    const a = createFoxSpec();
    const b = createFoxSpec();
    const most = new Float64Array(SPEC_SIZE);
    const samples = Math.ceil(span / step);
    for (let i = 0; i < samples; i++) {
        fill(a, i * step);
        fill(b, (i + 1) * step);
        for (let k = 0; k < SPEC_SIZE; k++) most[k] = Math.max(most[k], Math.abs(b[k] - a[k]));
    }
    return most;
}

/** The largest turn of any of `bones` between postures `step` apart, over `span` (radians). */
function largestTurn(fill, span, step, bones = FOX_BONES.map((bone, i) => i)) {
    const spec = createFoxSpec();
    let before = createFoxPosture();
    let after = createFoxPosture();
    let most = 0;
    const samples = Math.ceil(span / step);
    solveFox(fill(spec, 0), before);
    for (let i = 1; i <= samples; i++) {
        solveFox(fill(spec, i * step), after);
        for (let k = 0; k < bones.length; k++) {
            most = Math.max(most, turnBetween(before.world[bones[k]], after.world[bones[k]]));
        }
        [before, after] = [after, before];
    }
    return most;
}

const actFill = (name) => (spec, t) => foxAct(spec, name, t);
/** Its gait at a steady pace, as time goes by. */
const gaitFill = (speed) => (spec, t) => foxGait(spec.fill(0), (t * speed) / foxStride(speed), speed, 1);

/** The same pose seen in a mirror: left for right. */
function mirrored(spec) {
    const out = Float64Array.from(spec);
    ['sway', 'roll', 'yaw', 'bend', 'twist', 'headYaw', 'headRoll', 'tailYaw', 'tailCurl'].forEach((name) => {
        out[SPEC[name]] = -spec[SPEC[name]];
    });
    [[0, 1], [2, 3]].forEach(([left, right]) => {
        for (let k = 0; k < FOOT; k++) {
            const sign = k === DX ? -1 : 1;
            out[foot(left) + k] = sign * spec[foot(right) + k];
            out[foot(right) + k] = sign * spec[foot(left) + k];
        }
    });
    return out;
}
/** A bone's twin on the other side (itself, on the midline). */
const twinOf = (name) => name.replace(/[LR]$/, (side) => (side === 'L' ? 'R' : 'L'));

describe('winter fox rig: the module', () => {
    it('is three-free and clock-free: plain numbers in, plain numbers out', () => {
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
        expect(imports).toEqual(['./winter-core.js', '../shared/fox-rig.js']);
        expect(source).not.toMatch(/\bTHREE\b|\bdocument\b|\bwindow\b|performance\.now|Date\.now|Math\.random/);
        // (The rig it shares is as free of them, and imports nothing: shared-fox-rig.test.js.)
    });

    it('is the shared rig made for this skeleton, drawn larger than life, under the names the theme uses', () => {
        expect(FOX_RIG.bones).toBe(FOX_BONES);
        expect(FOX_RIG.marks).toBe(FOX_MARKS);
        expect(FOX_RIG.scale).toBe(FOX_SCALE);
        // (The rig's lengths are written for this very animal: every other fox is a size against it.)
        expect(FOX_RIG.size).toBe(1);
        expect(FOX_BONE_INDEX).toBe(FOX_RIG.index);
        expect(FOX_ACTS).toBe(FOX_RIG.lengths);
        expect(FOX_ACTS).toEqual(shared.FOX_ACTS);
        const bound = {
            act: foxAct,
            stride: foxStride,
            gallop: foxGallop,
            duty: foxDuty,
            footfalls: foxFootfalls,
            gait: foxGait,
            spec: foxSpec,
            solve: solveFox,
            point: foxPoint,
            createPosture: createFoxPosture,
        };
        Object.entries(bound).forEach(([name, fn]) => expect(fn, name).toBe(FOX_RIG[name]));
        // What is every fox's is passed on as it is, not copied.
        expect([FOX_LEGS, FEET, POUNCE_AIR, SLEEP_HOLD, SPEC, SPEC_SIZE, createFoxSpec])
            .toEqual([
                shared.FOX_LEGS, shared.FOOT, shared.POUNCE_AIR, shared.SLEEP_HOLD, shared.SPEC, shared.SPEC_SIZE,
                shared.createFoxSpec,
            ]);
        expect([qBetween, qMul, qRotate, qSlerp, qTurn])
            .toEqual([shared.qBetween, shared.qMul, shared.qRotate, shared.qSlerp, shared.qTurn]);
        // A fox with a four-bone tail, and the feet where this file's tests look for them.
        expect(FOX_BONES.filter((bone) => /^tail\d+$/.test(bone[0]))).toHaveLength(4);
        expect(FEET.size).toBe(FOOT);
        expect([FEET.dx, FEET.dy, FEET.dz, FEET.air]).toEqual([DX, DY, DZ, AIR]);
    });

    it('lays the skeleton out as one tree of named bones, parents first, every joint above the snow', () => {
        const names = FOX_BONES.map((bone) => bone[0]);
        expect(new Set(names).size).toBe(names.length);
        expect(Object.keys(FOX_BONE_INDEX)).toHaveLength(names.length);
        expect(FOX_BONES.filter((bone) => bone[1] === null)).toHaveLength(1);
        expect(FOX_BONES[0][1]).toBeNull();
        FOX_BONES.forEach(([name, parent, x, y, z], i) => {
            expect(FOX_BONE_INDEX[name], name).toBe(i);
            expect([x, y, z].every(Number.isFinite), name).toBe(true);
            expect(y, name).toBeGreaterThan(0);
            if (parent === null) return;
            expect(names.indexOf(parent), name).toBeGreaterThanOrEqual(0);
            expect(names.indexOf(parent), name).toBeLessThan(i);
        });
    });

    it('gives it a back of three bones, a neck and a head on its midline, and a tail of four behind', () => {
        const back = ['hips', 'spine', 'chest', 'neck', 'head'];
        back.forEach((name, i) => {
            expect(restOf(name)[0], name).toBe(0);
            if (i === 0) return;
            expect(parentOf(name), name).toBe(back[i - 1]);
            expect(restOf(name)[2], name).toBeGreaterThan(restOf(back[i - 1])[2]); // each ahead of the last
        });
        const tail = ['hips', 'tail1', 'tail2', 'tail3', 'tail4'];
        tail.forEach((name, i) => {
            if (i === 0) return;
            expect(parentOf(name), name).toBe(tail[i - 1]);
            expect(restOf(name)[2], name).toBeLessThan(restOf(tail[i - 1])[2]); // each behind the last
        });
        // The points that are not joints are where they say: nose ahead of the head, the tip of
        // the tail behind its last bone, an eye in the head off the midline.
        expect(FOX_MARKS.nose[0]).toBe(0);
        expect(FOX_MARKS.nose[2]).toBeGreaterThan(restOf('head')[2]);
        expect(FOX_MARKS.tailTip[2]).toBeLessThan(restOf('tail4')[2]);
        expect(FOX_MARKS.eye[0]).toBeGreaterThan(0);
        expect(FOX_MARKS.eye[2]).toBeGreaterThan(restOf('head')[2]);
        expect(FOX_MARKS.eye[2]).toBeLessThan(FOX_MARKS.nose[2]);
    });

    it('mirrors left and right: every bone of one side has its twin on the other', () => {
        const sided = FOX_BONES.filter((bone) => /[LR]$/.test(bone[0]));
        expect(sided.length).toBe(LEG_BONES.size);
        sided.forEach(([name, parent, x, y, z]) => {
            const twin = FOX_BONES[FOX_BONE_INDEX[twinOf(name)]];
            expect(twin, name).toBeDefined();
            expect(twin.slice(1), name).toEqual([twinOf(parent), -x, y, z]);
            expect(Math.sign(x), name).toBe(name.endsWith('L') ? 1 : -1); // its left is +x
        });
    });

    it('has four legs of three bones, each standing over the paw it puts on the snow', () => {
        expect(FOX_LEGS.map((leg) => leg[0])).toEqual(['FL', 'FR', 'BL', 'BR']);
        FOX_LEGS.forEach(([name, upper, lower, last, paw, carrier]) => {
            expect(parentOf(upper), name).toBe(carrier);
            expect(parentOf(lower), name).toBe(upper);
            expect(parentOf(last), name).toBe(lower);
            // The fore legs hang from its chest, the hind legs from its hips.
            expect(carrier, name).toBe(name[0] === 'F' ? 'chest' : 'hips');
            const mark = FOX_MARKS[paw];
            expect(mark[1], name).toBe(0); // where it meets the snow
            // Shoulder over elbow over wrist over paw, on its own side.
            expect(restOf(upper)[1], name).toBeGreaterThan(restOf(lower)[1]);
            expect(restOf(lower)[1], name).toBeGreaterThan(restOf(last)[1]);
            expect(restOf(last)[1], name).toBeGreaterThan(0);
            expect(Math.sign(mark[0]), name).toBe(name[1] === 'L' ? 1 : -1);
            expect(mark[0], name).toBe(restOf(last)[0]);
        });
        expect(FOX_MARKS.pawFR).toEqual([-FOX_MARKS.pawFL[0], 0, FOX_MARKS.pawFL[2]]);
        expect(FOX_MARKS.pawBR).toEqual([-FOX_MARKS.pawBL[0], 0, FOX_MARKS.pawBL[2]]);
        expect(FOX_MARKS.pawFL[2]).toBeGreaterThan(FOX_MARKS.pawBL[2]);
    });

    it('writes a pose as plain numbers: the body\'s, then five for each foot', () => {
        const body = Object.entries(SPEC).filter(([name]) => name !== 'feet').map(([, index]) => index);
        expect([...body].sort((a, b) => a - b)).toEqual(body.map((_, i) => i)); // no gaps, none twice
        expect(SPEC.feet).toBe(body.length);
        expect(SPEC_SIZE).toBe(SPEC.feet + FOX_LEGS.length * FOOT);
        TRUNK.forEach((name) => expect(SPEC[name], name).toBeLessThan(SPEC.feet));
        const spec = createFoxSpec();
        expect(spec).toBeInstanceOf(Float64Array);
        expect(spec).toHaveLength(SPEC_SIZE);
        expect(spec.every((v) => v === 0)).toBe(true);
        expect(createFoxSpec()).not.toBe(spec);
    });
});

describe('winter fox rig: the asset', () => {
    const UBYTE = 5121;
    const USHORT = 5123;
    let json;
    let read;
    let skin;
    let primitive;
    let count;
    const accessor = (name) => json.accessors[primitive.attributes[name]];

    beforeAll(() => {
        ({ json, read } = readGlb(ASSET));
        skin = json.skins[0];
        primitive = json.meshes[0].primitives[0];
        ({ count } = accessor('POSITION'));
    });

    it('is one skinned mesh on the rig\'s own skeleton: its bones, in its order, where the table has them', () => {
        expect(json.skins).toHaveLength(1);
        expect(json.meshes).toHaveLength(1);
        expect(json.meshes[0].primitives).toHaveLength(1);
        const drawn = json.nodes.filter((node) => node.mesh !== undefined);
        expect(drawn).toHaveLength(1);
        expect(drawn[0].skin).toBe(0);
        expect(skin.joints.map((node) => json.nodes[node].name)).toEqual(FOX_BONES.map((bone) => bone[0]));
        const above = new Map();
        json.nodes.forEach((node, i) => (node.children ?? []).forEach((child) => above.set(child, i)));
        skin.joints.forEach((node, i) => {
            const [name, parent, ...at] = FOX_BONES[i];
            expect(above.has(node) ? json.nodes[above.get(node)].name : null, name).toBe(parent);
            // At rest a joint is where its ancestors' moves add up to: none of them turns or scales.
            const place = [0, 0, 0];
            for (let n = node; n !== undefined; n = above.get(n)) {
                const joint = json.nodes[n];
                expect(joint.rotation ?? joint.scale ?? joint.matrix, joint.name).toBeUndefined();
                (joint.translation ?? [0, 0, 0]).forEach((v, k) => {
                    place[k] += v;
                });
            }
            at.forEach((v, k) => expect(Math.abs(place[k] - v), `${name} ${'xyz'[k]}`).toBeLessThan(1e-5));
        });
    });

    it('carries no clips, and is stamped by the script that rigged it', () => {
        expect(json.animations ?? []).toEqual([]);
        expect(json.asset.generator).toMatch(/rig-fox\.mjs/);
        // (The stamp is how the script knows the mesh is already straightened: without it a
        // re-rig would turn the head a second time.)
        const version = Number(readFileSync(RIG_SCRIPT, 'utf8').match(/const RIG_VERSION = (\d+);/)?.[1]);
        expect(version).toBeGreaterThan(0);
        expect(json.asset.extras?.winterFoxRig).toBe(version);
    });

    it('binds every bone by a move alone: all of them are axis-aligned at rest', () => {
        expect(json.accessors[skin.inverseBindMatrices]).toMatchObject({ type: 'MAT4', count: FOX_BONES.length });
        const binds = read(skin.inverseBindMatrices);
        FOX_BONES.forEach(([name, , x, y, z], i) => {
            const want = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1];
            want.forEach((v, k) => expect(Math.abs(binds[i * 16 + k] - v), `${name} [${k}]`).toBeLessThan(1e-6));
        });
    });

    it('weighs every vertex to bones of the skeleton, in four weights that make a whole byte', () => {
        expect(accessor('JOINTS_0')).toMatchObject({ componentType: UBYTE, type: 'VEC4', count });
        expect(accessor('WEIGHTS_0')).toMatchObject({
            componentType: UBYTE, normalized: true, type: 'VEC4', count,
        });
        const joints = read(primitive.attributes.JOINTS_0);
        const weights = read(primitive.attributes.WEIGHTS_0);
        const moved = new Set();
        let strays = 0;
        let unwhole = 0;
        for (let v = 0; v < count; v++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                const joint = joints[v * 4 + k];
                const weight = Math.round(weights[v * 4 + k] * 255);
                if (!(Number.isInteger(joint) && joint >= 0 && joint < FOX_BONES.length)) strays += 1;
                if (weight > 0) moved.add(joint);
                sum += weight;
            }
            if (sum !== 255) unwhole += 1;
        }
        expect(strays).toBe(0);
        expect(unwhole).toBe(0);
        // And no bone is idle: each carries some of the mesh.
        expect(moved.size).toBe(FOX_BONES.length);
    });

    it('keeps a leg to its own side', () => {
        const positions = read(primitive.attributes.POSITION);
        const joints = read(primitive.attributes.JOINTS_0);
        const weights = read(primitive.attributes.WEIGHTS_0);
        let across = 0;
        for (let v = 0; v < count; v++) {
            for (let k = 0; k < 4; k++) {
                const name = FOX_BONES[joints[v * 4 + k]][0];
                if (weights[v * 4 + k] > 0 && LEG_BONES.has(name)) {
                    // A left leg's bones move nothing on its right, nor a right leg's on its left.
                    if (Math.sign(positions[v * 3]) === (name.endsWith('L') ? -1 : 1)) across += 1;
                }
            }
        }
        expect(across).toBe(0);
    });

    it('is drawn in triangles with sixteen-bit indices, each a vertex it has, and stands on the snow', () => {
        const indexed = json.accessors[primitive.indices];
        expect(indexed.componentType).toBe(USHORT);
        expect(primitive.mode ?? 4).toBe(4);
        expect(indexed.count % 3).toBe(0);
        expect(count).toBeLessThanOrEqual(65535);
        const indices = read(primitive.indices);
        let beyond = 0;
        for (let i = 0; i < indices.length; i++) {
            if (!(indices[i] < count)) beyond += 1;
        }
        expect(beyond).toBe(0);
        // Its lowest vertex is on the snow its paws are marked on, and it is the size the table is.
        const { min, max } = accessor('POSITION');
        expect(Math.abs(min[1])).toBeLessThan(1e-6);
        expect(max[1]).toBeGreaterThan(restOf('head')[1]);
        expect(max[2]).toBeGreaterThan(restOf('head')[2]);
        expect(min[2]).toBeLessThan(restOf('tail4')[2]);
    });

    it('paints the coat\'s four numbers into each vertex\'s colour, the first of them along the tail', () => {
        expect(accessor('COLOR_0')).toMatchObject({
            componentType: UBYTE, normalized: true, type: 'VEC4', count,
        });
        const positions = read(primitive.attributes.POSITION);
        const colours = read(primitive.attributes.COLOR_0);
        let lit = 0;
        let ahead = 0;
        for (let v = 0; v < count; v++) {
            if (colours[v * 4] > 0.5) {
                lit += 1;
                // The fires' torch is its tail: nothing ahead of its hips is lit as tail.
                if (positions[v * 3 + 2] > restOf('hips')[2]) ahead += 1;
            }
        }
        expect(lit).toBeGreaterThan(10);
        expect(lit).toBeLessThan(count * 0.5);
        expect(ahead).toBe(0);
    });

    it('is what the rigging script makes of it: a fresh rig in memory is the asset, byte for byte', () => {
        const run = spawnSync(process.execPath, [RIG_SCRIPT, '--check'], {
            cwd: ROOT, encoding: 'utf8', timeout: 100_000,
        });
        expect(run.error).toBeUndefined();
        expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
        expect(run.stdout).toMatch(/the asset matches/);
    }, 120_000);

    // (The script straightens a mesh it has not rigged before, and knows one it has by its
    // stamp. A file another version of it rigged is neither: its head would be turned a second
    // time. It is refused.)
    it('is not rigged over by another version of the script: a stamp that is not its own is refused', () => {
        const asset = readFileSync(ASSET);
        // The asset as it is, but for its stamp: one version on. (A binary glTF is a header,
        // the JSON's length and kind, the JSON padded to four bytes, and the rest.)
        const length = asset.readUInt32LE(12);
        const stamped = JSON.parse(asset.subarray(20, 20 + length).toString('utf8'));
        stamped.asset.extras.winterFoxRig += 1;
        let text = JSON.stringify(stamped);
        while (Buffer.byteLength(text) % 4) text += ' ';
        const described = Buffer.from(text, 'utf8');
        const rest = asset.subarray(20 + length);
        const head = Buffer.from(asset.subarray(0, 20));
        head.writeUInt32LE(20 + described.length + rest.length, 8);
        head.writeUInt32LE(described.length, 12);
        const folder = mkdtempSync(path.join(tmpdir(), 'winter-fox-rig-'));
        const other = path.join(folder, 'another-version.glb');
        try {
            writeFileSync(other, Buffer.concat([head, described, rest]));
            expect(readGlb(other).json.asset.extras.winterFoxRig).toBe(stamped.asset.extras.winterFoxRig);
            // (--check: whatever it makes of the file, it writes nothing.)
            const run = spawnSync(process.execPath, [RIG_SCRIPT, `--from=${other}`, '--check'], {
                cwd: ROOT, encoding: 'utf8', timeout: 100_000,
            });
            expect(run.error).toBeUndefined();
            expect(run.status).not.toBe(0);
            expect(run.stderr).toMatch(/rigged by version \d+ of this script/);
            expect(run.stdout).not.toMatch(/wrote|the asset matches/);
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
        // And the asset is as it was.
        expect(readFileSync(ASSET).equals(asset)).toBe(true);
    }, 120_000);
});

describe('winter fox rig: its rotations', () => {
    const NOSE = [0, 0, 1];
    const LEFT = [1, 0, 0];
    const rand = mulberry32(0xf0c5);
    const anyTurn = () => qTurn((rand() - 0.5) * 6, (rand() - 0.5) * 3, (rand() - 0.5) * 6);
    const anyDirection = () => {
        const v = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
        const l = Math.hypot(...v);
        return v.map((c) => c / l);
    };
    const expectSame = (a, b, label = '') => a.forEach((v, k) => expect(v, `${label} [${k}]`).toBeCloseTo(b[k], 12));

    it('turns as the model reads it: + yaw is nose to its left, + pitch nose down, + roll right side down', () => {
        expect(qTurn(0, 0, 0)).toEqual([0, 0, 0, 1]);
        // (Its left is +x, up is +y, ahead is +z.)
        const yawed = qRotate(qTurn(0.4, 0, 0), NOSE);
        expect(yawed[0]).toBeGreaterThan(0);
        expect(yawed[1]).toBeCloseTo(0, 12);
        const pitched = qRotate(qTurn(0, 0.4, 0), NOSE);
        expect(pitched[1]).toBeLessThan(0);
        expect(pitched[0]).toBeCloseTo(0, 12);
        const rolled = qTurn(0, 0, 0.4);
        expect(qRotate(rolled, LEFT)[1]).toBeGreaterThan(0); // its left comes up
        expect(qRotate(rolled, [-1, 0, 0])[1]).toBeLessThan(0);
        expectSame(qRotate(rolled, NOSE), NOSE);
        // A quarter turn each: the nose to its left, the nose straight down.
        expectSame(qRotate(qTurn(Math.PI / 2, 0, 0), NOSE), LEFT);
        expectSame(qRotate(qTurn(0, Math.PI / 2, 0), NOSE), [0, -1, 0]);
    });

    it('applies yaw, then pitch, then roll, each about the turned animal\'s own axis', () => {
        for (let i = 0; i < 24; i++) {
            const [yaw, pitch, roll] = [(rand() - 0.5) * 6, (rand() - 0.5) * 3, (rand() - 0.5) * 6];
            const whole = qTurn(yaw, pitch, roll);
            expect(Math.hypot(...whole)).toBeCloseTo(1, 12);
            expectSame(whole, qMul(qMul(qTurn(yaw, 0, 0), qTurn(0, pitch, 0)), qTurn(0, 0, roll)));
        }
    });

    it('multiplies and rotates as rotations do, also into one of its own operands', () => {
        for (let i = 0; i < 24; i++) {
            const a = anyTurn();
            const b = anyTurn();
            const v = anyDirection().map((c) => c * 3);
            expect(Math.hypot(...qMul(a, b))).toBeCloseTo(1, 12);
            expectSame(qRotate(qMul(a, b), v), qRotate(a, qRotate(b, v)));
            expect(Math.hypot(...qRotate(a, v))).toBeCloseTo(3, 12);
            expectSame(qMul(a, [0, 0, 0, 1]), a);
            expectSame(qMul(a, [-a[0], -a[1], -a[2], a[3]]), [0, 0, 0, 1]);
            // (The solver multiplies and rotates in place.)
            const product = qMul(a, b);
            const left = [...a];
            expect(qMul(left, b, left)).toBe(left);
            expectSame(left, product);
            const right = [...b];
            qMul(a, right, right);
            expectSame(right, product);
            const turned = qRotate(a, v);
            const inPlace = [...v];
            expect(qRotate(a, inPlace, inPlace)).toBe(inPlace);
            expectSame(inPlace, turned);
        }
    });

    it('finds the least turn that takes one direction onto another', () => {
        for (let i = 0; i < 24; i++) {
            const a = anyDirection();
            const b = anyDirection();
            const q = qBetween(a, b);
            expect(Math.hypot(...q)).toBeCloseTo(1, 12);
            expectSame(qRotate(q, a), b);
            // The least turn: about an axis square to both.
            expect(q[0] * a[0] + q[1] * a[1] + q[2] * a[2]).toBeCloseTo(0, 12);
            expect(q[0] * b[0] + q[1] * b[1] + q[2] * b[2]).toBeCloseTo(0, 12);
            expectSame(qBetween(a, a), [0, 0, 0, 1]);
        }
        // A leg turned right over — straight down to straight up — folds about the animal's own
        // side-to-side axis.
        const over = qBetween([0, -1, 0], [0, 1, 0]);
        expectSame(qRotate(over, [0, -1, 0]), [0, 1, 0]);
        expect(Math.abs(over[0])).toBeCloseTo(1, 12);
        // And whatever the direction, its opposite is half a turn away, about an axis square to
        // it: also for one that lies along that side-to-side axis itself.
        const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0.6, 0.8, 0], [0.6, 0, 0.8]];
        for (let i = 0; i < 24; i++) directions.push(anyDirection());
        directions.forEach((a) => {
            const q = qBetween(a, a.map((c) => -c));
            const label = `from ${a.map((c) => c.toFixed(2))}`;
            expect(Math.hypot(...q), label).toBeCloseTo(1, 12);
            expect(q[3], label).toBeCloseTo(0, 12);
            expect(q[0] * a[0] + q[1] * a[1] + q[2] * a[2], label).toBeCloseTo(0, 12);
            expectSame(qRotate(q, a), a.map((c) => -c), label);
        });
        // Just short of opposite it still arrives: exactly, until so little is missing that the
        // half turn itself is as near as makes no difference (a milliradian or so).
        for (const short of [1e-5, 1e-3, 2e-3, 1e-2]) {
            const nearly = [Math.sin(short), -Math.cos(short), 0];
            const arrived = qRotate(qBetween([0, 1, 0], nearly), [0, 1, 0]);
            expect(Math.hypot(...arrived.map((c, k) => c - nearly[k])), `${short} rad short`)
                .toBeLessThan(short < 2e-3 ? 2e-3 : 1e-9);
        }
    });

    it('slerps from one rotation to another the short way round', () => {
        for (let i = 0; i < 24; i++) {
            const a = anyTurn();
            const b = anyTurn();
            expect(sameTurn(qSlerp(a, b, 0), a)).toBe(true);
            expect(sameTurn(qSlerp(a, b, 1), b)).toBe(true);
            const whole = turnBetween(a, b);
            for (const t of [0.25, 0.5, 0.8]) {
                const q = qSlerp(a, b, t);
                expect(Math.hypot(...q)).toBeCloseTo(1, 12);
                // On the way, and as far along it as asked.
                expect(turnBetween(a, q)).toBeCloseTo(whole * t, 6);
                expect(turnBetween(q, b)).toBeCloseTo(whole * (1 - t), 6);
                // (A rotation and its negative are the same turn: either gives the same way there.)
                expect(sameTurn(qSlerp(a, b.map((c) => -c), t), q)).toBe(true);
            }
        }
    });
});

describe('winter fox rig: the solver', () => {
    it('stands at rest on a spec of zeros: every paw on its mark, every leg reaching', () => {
        const posture = solveFox(createFoxSpec());
        expect(posture.short).toEqual([0, 0, 0, 0]);
        // Its trunk, its head, its tail and the last bone of each leg are as the table has them,
        // exactly.
        const solved = new Set(FOX_LEGS.flatMap((leg) => [leg[1], leg[2]]));
        FOX_BONES.forEach(([name], i) => {
            if (solved.has(name)) return;
            expect(sameTurn(posture.world[i], [0, 0, 0, 1]), name).toBe(true);
            expect(apart(posture.at[i], restOf(name)), name).toBeLessThan(1e-12);
        });
        FOX_LEGS.forEach(([name, upper, lower, , paw], leg) => {
            expect(apart(pawAt(posture, leg), FOX_MARKS[paw]), name).toBeLessThan(1e-12);
            // (Its legs are solved even standing, and the joint between is put in the plane the leg
            // folds in: fore-and-aft through shoulder and wrist. This fox's elbow is drawn a few
            // millimetres out of that plane — its shoulder stands wider than its wrist — so the
            // two bones above a paw are turned by a degree or two at rest: near, not exact. A
            // skeleton whose legs are drawn in that plane stands exactly: shared-fox-rig.test.js.)
            expect(apart(jointAt(posture, upper), restOf(upper)), upper).toBeLessThan(1e-12);
            expect(apart(jointAt(posture, lower), restOf(lower)), lower).toBeLessThan(0.01);
            [upper, lower].forEach((bone) => {
                expect(turnBetween(posture.world[FOX_BONE_INDEX[bone]], [0, 0, 0, 1]), bone).toBeLessThan(5 * DEG);
            });
        });
        expect(apart(noseAt(posture), FOX_MARKS.nose)).toBeLessThan(1e-12);
        expect(apart(tailTipAt(posture), FOX_MARKS.tailTip)).toBeLessThan(1e-12);
    });

    it('fills in the posture it is handed, and keeps nothing from one pose to the next', () => {
        const posture = createFoxPosture();
        expect(posture.world).toHaveLength(FOX_BONES.length);
        expect(posture.local).toHaveLength(FOX_BONES.length);
        expect(posture.at).toHaveLength(FOX_BONES.length);
        expect(posture.short).toHaveLength(FOX_LEGS.length);
        const sitting = act('Sit', FOX_ACTS.Sit / 2);
        expect(solveFox(sitting, posture)).toBe(posture);
        const first = JSON.parse(JSON.stringify(posture));
        // Another pose in between leaves no trace in the next.
        solveFox(gait(0.3, FLAT_OUT), posture);
        expect(JSON.parse(JSON.stringify(posture))).not.toEqual(first);
        solveFox(sitting, posture);
        expect(JSON.parse(JSON.stringify(posture))).toEqual(first);
        expect(JSON.parse(JSON.stringify(solveFox(sitting)))).toEqual(first);
        // Reading a point off a posture does not disturb it, and writes where it is told.
        const out = [0, 0, 0];
        expect(foxPoint(posture, 'head', FOX_MARKS.nose, out)).toBe(out);
        expect(foxPoint(posture, FOX_BONE_INDEX.head, FOX_MARKS.nose)).toEqual(out);
        expect(JSON.parse(JSON.stringify(posture))).toEqual(first);
    });

    it('keeps every bone a rotation and every number finite, whatever the pose', () => {
        const posture = createFoxPosture();
        const wrong = [];
        let moments = 0;
        eachMoment((spec, label) => {
            moments += 1;
            solveFox(spec, posture);
            const sound = [...posture.world, ...posture.local]
                .every((q) => q.every(Number.isFinite) && Math.abs(Math.hypot(...q) - 1) < 1e-9)
                && posture.at.every((p) => p.every(Number.isFinite))
                && posture.short.every((v) => Number.isFinite(v) && v >= 0);
            if (!sound) wrong.push(label());
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(moments).toBeGreaterThan(1000);
    });

    // (The model takes only each bone's rotation in its parent's frame, and the root's place:
    // where the solver says a joint is has to be where those rotations carry it, or the fox that
    // is drawn is not the fox these tests look at.)
    it('places every joint where its bones\' rotations carry it: what is drawn is what was solved', () => {
        const posture = createFoxPosture();
        const carried = [0, 0, 0];
        const q = [0, 0, 0, 1];
        const wrong = [];
        eachMoment((spec, label) => {
            solveFox(spec, posture);
            FOX_BONES.forEach(([name, parent, x, y, z], i) => {
                if (parent === null) {
                    if (!sameTurn(posture.local[i], posture.world[i])) wrong.push(`${label()}: ${name}'s turn`);
                    return;
                }
                const p = FOX_BONE_INDEX[parent];
                const from = restOf(parent);
                qRotate(posture.world[p], [x - from[0], y - from[1], z - from[2]], carried);
                const where = posture.at[p].map((v, k) => v + carried[k]);
                if (apart(where, posture.at[i]) > 1e-9) wrong.push(`${label()}: ${name}'s place`);
                if (!sameTurn(qMul(posture.world[p], posture.local[i], q), posture.world[i])) {
                    wrong.push(`${label()}: ${name}'s turn`);
                }
            });
        });
        expect(wrong.slice(0, 5)).toEqual([]);
    });

    it('puts a planted paw on the snow exactly where the pose has it, and never under it', () => {
        const posture = createFoxPosture();
        const at = [0, 0, 0];
        const wrong = [];
        let planted = 0;
        eachMoment((spec, label) => {
            solveFox(spec, posture);
            FOX_LEGS.forEach(([name, , , , paw], leg) => {
                if (spec[foot(leg) + AIR] !== 0) return;
                planted += 1;
                const mark = FOX_MARKS[paw];
                const want = [mark[0] + spec[foot(leg) + DX], spec[foot(leg) + DY], mark[2] + spec[foot(leg) + DZ]];
                pawAt(posture, leg, at);
                // A leg that cannot reach leaves its paw hanging short of the place, never past it.
                if (at[1] < want[1] - 1e-9) wrong.push(`${label()}: ${name} is under where it should be`);
                const reached = posture.short[leg] < 1e-9;
                if (reached && apart(at, want) > 1e-9) wrong.push(`${label()}: ${name} is off its place`);
            });
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(planted).toBeGreaterThan(1000);
    });

    it('reaches every paw it plants: no leg is left more than a centimetre short', () => {
        const posture = createFoxPosture();
        const worst = {};
        eachMoment((spec, label) => {
            solveFox(spec, posture);
            FOX_LEGS.forEach(([name], leg) => {
                const short = posture.short[leg];
                if (spec[foot(leg) + AIR] !== 0 || short <= 0.01) return;
                // (The worst moment of each act or pace, so a failure says where to look.)
                const key = label().split(' at ')[0];
                if (!(worst[key]?.short >= short)) worst[key] = { short, leg: name, when: label() };
            });
        });
        expect(Object.values(worst)).toEqual([]);
    });

    it('solves a pose and its mirror image alike', () => {
        const one = createFoxPosture();
        const other = createFoxPosture();
        const wrong = [];
        eachMoment((spec, label) => {
            solveFox(spec, one);
            solveFox(mirrored(spec), other);
            FOX_BONES.forEach(([name], i) => {
                // (All but its tail, which the mesh carries a little to one side of its midline.)
                if (name.startsWith('tail')) return;
                const twin = other.at[FOX_BONE_INDEX[twinOf(name)]];
                if (apart([-twin[0], twin[1], twin[2]], one.at[i]) > 1e-9) wrong.push(`${label()}: ${name}`);
            });
            // (A left leg's reach is its right twin's: the legs are listed in pairs.)
            const reach = Math.max(...one.short.map((v, leg) => Math.abs(v - other.short[leg ^ 1])));
            if (reach > 1e-9) wrong.push(`${label()}: reach`);
        });
        expect(wrong.slice(0, 5)).toEqual([]);
    });

    it('moves the body the way each number of a pose says', () => {
        const stand = solveFox(createFoxSpec());
        const posed = (numbers) => {
            const spec = createFoxSpec();
            Object.entries(numbers).forEach(([name, v]) => {
                spec[SPEC[name]] = v;
            });
            return solveFox(spec);
        };
        const height = (posture, bone) => jointAt(posture, bone)[1];
        // rear and fore lower its hips and its chest, and the back pitches to suit.
        const sunk = posed({ rear: 0.06 });
        expect(height(stand, 'hips') - height(sunk, 'hips')).toBeGreaterThan(0.04);
        expect(Math.abs(height(stand, 'chest') - height(sunk, 'chest'))).toBeLessThan(0.01);
        const bowed = posed({ fore: 0.06 });
        expect(height(stand, 'chest') - height(bowed, 'chest')).toBeGreaterThan(0.04);
        expect(Math.abs(height(stand, 'hips') - height(bowed, 'hips'))).toBeLessThan(0.01);
        // shift and sway carry it ahead and to its left over its feet, which stay where they are.
        const ahead = posed({ shift: 0.02, sway: 0.01 });
        expect(jointAt(ahead, 'spine')[2] - jointAt(stand, 'spine')[2]).toBeCloseTo(0.02, 9);
        expect(jointAt(ahead, 'spine')[0] - jointAt(stand, 'spine')[0]).toBeCloseTo(0.01, 9);
        expect(pawAt(ahead, 2)).toEqual(pawAt(stand, 2));
        // + pitch the nose down, + yaw the nose to its left, + roll its right side down.
        expect(noseAt(posed({ pitch: 0.2 }))[1]).toBeLessThan(noseAt(stand)[1]);
        expect(noseAt(posed({ yaw: 0.2 }))[0]).toBeGreaterThan(0);
        const rolled = posed({ roll: 0.2 });
        expect(height(rolled, 'armR')).toBeLessThan(height(rolled, 'armL'));
        // arch rounds the back about its middle: its hips sink and its shoulders tip down.
        const arched = posed({ arch: 0.4 });
        expect(height(arched, 'hips')).toBeLessThan(height(stand, 'hips'));
        expect(height(arched, 'neck')).toBeLessThan(height(stand, 'neck'));
        expect(height(arched, 'spine')).toBeCloseTo(height(stand, 'spine'), 12);
        const hollowed = posed({ arch: -0.4 });
        expect(height(hollowed, 'hips')).toBeGreaterThan(height(stand, 'hips'));
        expect(height(hollowed, 'neck')).toBeGreaterThan(height(stand, 'neck'));
        // bend curls it to its left: head and tail both come round that side.
        const bent = posed({ bend: 0.6 });
        expect(noseAt(bent)[0]).toBeGreaterThan(0.05);
        expect(tailTipAt(bent)[0]).toBeGreaterThan(tailTipAt(stand)[0] + 0.05);
        // Its head: + yaw left, + pitch up; reach lowers the neck and stretches it out.
        expect(noseAt(posed({ headYaw: 0.4 }))[0]).toBeGreaterThan(0.05);
        expect(noseAt(posed({ headPitch: 0.4 }))[1]).toBeGreaterThan(noseAt(stand)[1] + 0.05);
        const reaching = noseAt(posed({ reach: 0.4 }));
        expect(reaching[1]).toBeLessThan(noseAt(stand)[1]);
        expect(reaching[2]).toBeGreaterThan(noseAt(stand)[2]);
        // Its tail: swung to its left, raised, curled round to its left.
        expect(tailTipAt(posed({ tailYaw: 0.4 }))[0]).toBeGreaterThan(tailTipAt(stand)[0] + 0.05);
        expect(tailTipAt(posed({ tailYaw: -0.4 }))[0]).toBeLessThan(tailTipAt(stand)[0] - 0.05);
        expect(tailTipAt(posed({ tailLift: 0.4 }))[1]).toBeGreaterThan(tailTipAt(stand)[1] + 0.05);
        expect(tailTipAt(posed({ tailCurl: 1 }))[0]).toBeGreaterThan(tailTipAt(stand)[0] + 0.05);
        // Its head and its tail are its own: neither moves a paw.
        const busy = posed({
            headYaw: 0.5, headPitch: -0.3, reach: 0.3, tailYaw: 0.5, tailLift: 0.6, tailCurl: 1,
        });
        FOX_LEGS.forEach((leg, n) => expect(pawAt(busy, n), leg[0]).toEqual(pawAt(stand, n)));
    });

    it('carries a paw with the body by as much as it is in the air', () => {
        // The body lowered and tipped: a planted paw stays on its mark, a carried one goes with it.
        const spec = createFoxSpec();
        spec[SPEC.rear] = 0.05;
        spec[SPEC.fore] = 0.05;
        const planted = pawAt(solveFox(spec), 0);
        expect(apart(planted, FOX_MARKS.pawFL)).toBeLessThan(1e-9);
        spec[foot(0) + AIR] = 1;
        const carried = pawAt(solveFox(spec), 0);
        expect(carried[1]).toBeCloseTo(-0.05, 9);
        spec[foot(0) + AIR] = 0.5;
        const between = pawAt(solveFox(spec), 0);
        expect(between[1]).toBeCloseTo(-0.025, 9);
        // And only that paw: the others are where they were.
        expect(apart(pawAt(solveFox(spec), 1), FOX_MARKS.pawFR)).toBeLessThan(1e-9);
    });
});

describe('winter fox rig: what it does at a stop', () => {
    it('has a pose for every act but its gait, and stands for a name it does not know', () => {
        Object.entries(FOX_ACTS).forEach(([name, seconds]) => {
            expect(seconds, name).toBeGreaterThan(0);
        });
        expect(Object.keys(FOX_ACTS)).toEqual(expect.arrayContaining(['Run', 'Pounce', 'CurlSleep', 'Stretch', 'Sit']));
        POSES.forEach((name) => {
            let moved = 0;
            for (let t = 0; t <= FOX_ACTS[name]; t += FRAME) {
                moved = Math.max(moved, ...Array.from(act(name, t), Math.abs));
            }
            expect(moved, name).toBeGreaterThan(0.05);
        });
        // Its gait is not an act, and an act it has never heard of is no pose at all.
        const dirty = createFoxSpec().fill(7);
        expect(foxAct(dirty, 'Run', 0.3)).toBe(dirty);
        expect(dirty.every((v) => v === 0)).toBe(true);
        expect(foxAct(dirty.fill(7), 'NoSuchAct', 1).every((v) => v === 0)).toBe(true);
        // What a spec held before is gone, and a time before the act begins is its beginning.
        expect(Array.from(foxAct(dirty.fill(7), 'Sit', 3))).toEqual(Array.from(act('Sit', 3)));
        POSES.forEach((name) => expect(Array.from(act(name, -2)), name).toEqual(Array.from(act(name, 0))));
        // The leap is inside its act, and the sleeper is down before its act is over.
        expect(POUNCE_AIR[0]).toBeGreaterThan(0);
        expect(POUNCE_AIR[1]).toBeGreaterThan(POUNCE_AIR[0]);
        expect(POUNCE_AIR[1]).toBeLessThan(FOX_ACTS.Pounce);
        expect(SLEEP_HOLD).toBeGreaterThan(0);
        expect(SLEEP_HOLD).toBeLessThan(FOX_ACTS.CurlSleep);
    });

    it('begins on its feet and is back on them when its time is up, but where it hands a pose on', () => {
        // (Its trunk and its paws, that is: where its head and tail are is taken up by the
        // cross-fade into whatever comes next.)
        const offItsFeet = (spec) => Math.max(
            ...TRUNK.map((name) => Math.abs(spec[SPEC[name]])),
            ...Array.from(spec.subarray(SPEC.feet), Math.abs),
        );
        POSES.forEach((name) => {
            // Digging begins with its nose already in the snow: the cross-fade brings it down.
            if (name !== 'Dig') expect(offItsFeet(act(name, 0)), `${name} begins`).toBeLessThan(1e-9);
            // The leap ends where it landed and the sleeper stays down: what follows takes them up.
            if (name !== 'Pounce' && name !== 'CurlSleep') {
                expect(offItsFeet(act(name, FOX_ACTS[name])), `${name} ends`).toBeLessThan(1e-9);
            }
        });
        // The hunt hands its pose on: it lands as it will dig, nose down at the snow and rump up.
        [solveFox(act('Pounce', FOX_ACTS.Pounce)), solveFox(act('Dig', 0))].forEach((posture) => {
            expect(noseAt(posture)[1]).toBeLessThan(restOf('handL')[1]);
            expect(jointAt(posture, 'chest')[1]).toBeLessThan(jointAt(posture, 'hips')[1]);
            expect(posture.short).toEqual([0, 0, 0, 0]);
        });
        // And asleep it holds: from SLEEP_HOLD on, the act is one pose.
        const held = Array.from(act('CurlSleep', SLEEP_HOLD));
        expect(Array.from(act('CurlSleep', FOX_ACTS.CurlSleep))).toEqual(held);
        expect(Array.from(act('CurlSleep', SLEEP_HOLD + 600))).toEqual(held);
    });

    it('is smooth in time: halve the step and the largest change of every number shrinks with it', () => {
        POSES.forEach((name) => {
            const coarse = largestSteps(actFill(name), FOX_ACTS[name], FRAME);
            const fine = largestSteps(actFill(name), FOX_ACTS[name], FRAME / 4);
            // A number that eases changes a quarter as much in a quarter of the time; one that
            // snaps changes as much however short the step. (Half is the line between the two.)
            FIELDS.forEach((field, k) => {
                expect(fine[k], `${name}: ${field}`).toBeLessThanOrEqual(coarse[k] * 0.5 + 1e-12);
            });
        });
    });

    it('turns no bone far in a frame: nothing flips, nothing snaps', () => {
        POSES.forEach((name) => {
            // (Before its legs folded across its own side-to-side axis, the bow of its stretch
            // flipped an elbow by 44° in one frame. The quickest thing it does — digging — turns
            // a foreleg well under 30°.)
            expect(largestTurn(actFill(name), FOX_ACTS[name], FRAME) / DEG, name).toBeLessThan(35);
            // Its trunk, head and tail are not solved for: they ease exactly as their numbers do.
            const coarse = largestTurn(actFill(name), FOX_ACTS[name], FRAME, BODY);
            const fine = largestTurn(actFill(name), FOX_ACTS[name], FRAME / 4, BODY);
            expect(fine, name).toBeLessThanOrEqual(coarse * 0.5 + 1e-9);
        });
        // No joint leaves where it was either: a small part of its own length in a frame.
        const before = createFoxPosture();
        const after = createFoxPosture();
        POSES.forEach((name) => {
            let most = 0;
            const frames = Math.ceil(FOX_ACTS[name] / FRAME);
            for (let i = 0; i < frames; i++) {
                solveFox(act(name, i * FRAME), before);
                solveFox(act(name, (i + 1) * FRAME), after);
                most = Math.max(most, ...FOX_BONES.map((bone, k) => apart(before.at[k], after.at[k])));
            }
            expect(most, name).toBeLessThan(LENGTH * 0.15);
        });
    });

    it('listens with one forepaw raised, and only that one', () => {
        const raised = [0, 0, 0, 0];
        const posture = createFoxPosture();
        for (let t = 0; t <= FOX_ACTS.Listen; t += FRAME) {
            solveFox(act('Listen', t), posture);
            FOX_LEGS.forEach((leg, n) => {
                raised[n] = Math.max(raised[n], pawAt(posture, n)[1]);
            });
            expect(posture.short, `at ${t.toFixed(2)} s`).toEqual([0, 0, 0, 0]);
        }
        const up = raised.filter((y) => y > 0.02);
        expect(up).toHaveLength(1);
        expect(raised.indexOf(up[0])).toBeLessThan(2); // a forepaw
        raised.filter((y) => y <= 0.02).forEach((y) => expect(y).toBeLessThan(1e-9));
        // Its head is down to the sound, and cocked one way and then the other.
        const mid = act('Listen', FOX_ACTS.Listen / 2);
        expect(noseAt(solveFox(mid))[1]).toBeLessThan(FOX_MARKS.nose[1] - 0.05);
        const cocked = [];
        for (let t = 0; t <= FOX_ACTS.Listen; t += FRAME) cocked.push(act('Listen', t)[SPEC.headRoll]);
        expect(Math.max(...cocked)).toBeGreaterThan(0.1);
        expect(Math.min(...cocked)).toBeLessThan(-0.1);
    });

    it('leaps with its paws carried only while it is in the air, and comes down nose and forepaws first', () => {
        const [off, down] = POUNCE_AIR;
        const posture = createFoxPosture();
        const air = (t) => FOX_LEGS.map((leg, n) => act('Pounce', t)[foot(n) + AIR]);
        // On the snow until it leaves and from when it lands (to within a couple of frames: the
        // paws let go and take hold over a moment), carried whole in between.
        for (let t = 0; t <= FOX_ACTS.Pounce; t += FRAME / 2) {
            const carried = air(t);
            expect(new Set(carried).size, `at ${t.toFixed(3)} s`).toBe(1); // all four together
            expect(carried[0]).toBeGreaterThanOrEqual(0);
            expect(carried[0]).toBeLessThanOrEqual(1);
            if (t < off - 3 * FRAME || t > down + 3 * FRAME) expect(carried[0], `at ${t.toFixed(3)} s`).toBe(0);
            if (t > off + 0.25 * (down - off) && t < down - 0.25 * (down - off)) {
                expect(carried[0], `at ${t.toFixed(3)} s`).toBe(1);
            }
        }
        expect(air((off + down) / 2)[0]).toBe(1);
        // Before the leap it gathers: lower than it stands, every paw planted.
        const coiled = solveFox(act('Pounce', off * 0.75), posture);
        expect(jointAt(coiled, 'hips')[1]).toBeLessThan(restOf('hips')[1] - 0.02);
        expect(coiled.short).toEqual([0, 0, 0, 0]);
        // Late in the leap it dives: nose below its hips, forepaws below its hind paws.
        const diving = solveFox(act('Pounce', off + 0.85 * (down - off)), posture);
        expect(noseAt(diving)[1]).toBeLessThan(jointAt(diving, 'hips')[1]);
        expect(pawAt(diving, 0)[1]).toBeLessThan(pawAt(diving, 2)[1]);
        expect(pawAt(diving, 1)[1]).toBeLessThan(pawAt(diving, 3)[1]);
        // Early in it, it is nose up and stretched out.
        const rising = solveFox(act('Pounce', off + 0.2 * (down - off)), posture);
        expect(noseAt(rising)[1]).toBeGreaterThan(FOX_MARKS.nose[1]);
        // And it stays down where it landed: nose at the snow, paws planted.
        const landed = solveFox(act('Pounce', FOX_ACTS.Pounce), posture);
        expect(noseAt(landed)[1]).toBeLessThan(restOf('handL')[1]);
        FOX_LEGS.forEach((leg, n) => expect(Math.abs(pawAt(landed, n)[1]), leg[0]).toBeLessThan(1e-9));
    });

    it('digs with its forepaws turn about, nose in the snow and rump up', () => {
        const posture = createFoxPosture();
        const lifted = [0, 0];
        let both = 0;
        const span = FOX_ACTS.Dig / 2; // (while it is at it: the end of the act lets it up)
        for (let t = 0; t <= span; t += FRAME / 2) {
            const spec = act('Dig', t);
            solveFox(spec, posture);
            const up = [0, 1].map((n) => pawAt(posture, n)[1] > 1e-6);
            if (up[0]) lifted[0] += 1;
            if (up[1]) lifted[1] += 1;
            if (up[0] && up[1]) both += 1;
            // One paw goes forward as the other comes back.
            expect(spec[foot(0) + DZ], `at ${t.toFixed(3)} s`).toBeCloseTo(-spec[foot(1) + DZ], 12);
            // Its hind paws do not stir, and every leg reaches.
            [2, 3].forEach((n) => expect(apart(pawAt(posture, n), FOX_MARKS[FOX_LEGS[n][4]])).toBeLessThan(1e-9));
            expect(posture.short).toEqual([0, 0, 0, 0]);
            expect(noseAt(posture)[1]).toBeLessThan(restOf('handL')[1]);
            expect(jointAt(posture, 'hips')[1]).toBeGreaterThan(jointAt(posture, 'chest')[1]);
        }
        expect(both).toBe(0);
        expect(lifted[0]).toBeGreaterThan(5);
        expect(lifted[1]).toBeGreaterThan(5);
        // Several scrapes of each paw.
        const strokes = [];
        for (let t = 0; t <= span; t += FRAME / 2) strokes.push(Math.sign(act('Dig', t)[foot(0) + DZ]));
        expect(strokes.filter((s, i) => i > 0 && s !== 0 && s === -strokes[i - 1]).length).toBeGreaterThan(3);
    });

    it('sits: its hips go down far more than its chest, and its forepaws stay planted', () => {
        const spec = act('Sit', FOX_ACTS.Sit / 2);
        const sitting = solveFox(spec);
        const hips = restOf('hips')[1] - jointAt(sitting, 'hips')[1];
        const chest = restOf('chest')[1] - jointAt(sitting, 'chest')[1];
        expect(hips).toBeGreaterThan(restOf('hips')[1] * 0.3);
        expect(hips).toBeGreaterThan(chest * 2);
        expect(chest).toBeGreaterThanOrEqual(0);
        // Every paw is on the snow and every leg reaches it.
        FOX_LEGS.forEach((leg, n) => {
            expect(spec[foot(n) + AIR], leg[0]).toBe(0);
            expect(Math.abs(pawAt(sitting, n)[1]), leg[0]).toBeLessThan(1e-9);
        });
        expect(sitting.short).toEqual([0, 0, 0, 0]);
        // It sits on its haunches: heels laid down, hind paws drawn up under it toward the fore.
        expect(jointAt(sitting, 'hockL')[1]).toBeLessThan(restOf('hockL')[1] * 0.5);
        expect(jointAt(sitting, 'hockR')[1]).toBeLessThan(restOf('hockR')[1] * 0.5);
        expect(pawAt(sitting, 0)[2] - pawAt(sitting, 2)[2]).toBeLessThan(FOX_MARKS.pawFL[2] - FOX_MARKS.pawBL[2]);
        // Head up, looking at the sky; nothing of it under the snow.
        expect(noseAt(sitting)[1]).toBeGreaterThan(FOX_MARKS.nose[1]);
        expect(noseAt(sitting)[1]).toBeGreaterThan(jointAt(sitting, 'head')[1]);
        sitting.at.forEach((joint, i) => expect(joint[1], FOX_BONES[i][0]).toBeGreaterThan(0));
        expect(tailTipAt(sitting)[1]).toBeGreaterThan(0);
        // Its tail lies round it to the side the mind chose, not out behind.
        const left = solveFox(foxSpec(still('Sit', FOX_ACTS.Sit / 2, { side: 1 })));
        const right = solveFox(foxSpec(still('Sit', FOX_ACTS.Sit / 2, { side: -1 })));
        expect(tailTipAt(left)[0]).toBeGreaterThan(0.1);
        expect(tailTipAt(right)[0]).toBeLessThan(-0.1);
        expect(tailTipAt(left)[2]).toBeGreaterThan(FOX_MARKS.tailTip[2] + 0.1);
        expect(noseAt(right)).toEqual(noseAt(left)); // only its tail takes a side
    });

    it('curls up to sleep: down on the snow, its nose brought round low to the side it curls to', () => {
        const spec = act('CurlSleep', SLEEP_HOLD);
        const curled = solveFox(spec);
        // Its whole body is down, not only one end of it.
        expect(restOf('hips')[1] - jointAt(curled, 'hips')[1]).toBeGreaterThan(restOf('hips')[1] * 0.4);
        expect(restOf('chest')[1] - jointAt(curled, 'chest')[1]).toBeGreaterThan(restOf('chest')[1] * 0.4);
        // Its paws are tucked up, not planted — drawn up under it, that is, not left down in the
        // snow it lies on (a regression: they once hung 5 to 8 cm under it): on either side no
        // paw is deeper than a paw is thick.
        FOX_LEGS.forEach((leg, n) => expect(spec[foot(n) + AIR], leg[0]).toBe(1));
        for (const side of [1, -1]) {
            const lying = solveFox(foxSpec(still('CurlSleep', SLEEP_HOLD, { side })));
            FOX_LEGS.forEach((leg, n) => {
                expect(pawAt(lying, n)[1], `${leg[0]}, side ${side}`).toBeGreaterThan(-0.03);
                expect(pawAt(lying, n)[1], `${leg[0]}, side ${side}`).toBeLessThan(restOf('hips')[1] * 0.5);
            });
        }
        // Its nose is round to its left, out beyond its own shoulder, back toward its tail, and
        // lower than its back.
        const nose = noseAt(curled);
        expect(nose[0]).toBeGreaterThan(restOf('armL')[0]);
        expect(nose[2]).toBeLessThan(restOf('head')[2]);
        expect(nose[1]).toBeLessThan(jointAt(curled, 'chest')[1]);
        expect(nose[1]).toBeLessThan(FOX_MARKS.nose[1] * 0.5);
        expect(nose[1]).toBeGreaterThan(0);
        // Its tail comes round the same side to meet it.
        const tip = tailTipAt(curled);
        expect(tip[0]).toBeGreaterThan(restOf('armL')[0]);
        expect(tip[2]).toBeGreaterThan(restOf('tail1')[2]);
        expect(tip[1]).toBeGreaterThan(0);
        // On its way down it is neither standing nor yet curled.
        const half = solveFox(act('CurlSleep', SLEEP_HOLD / 2));
        expect(jointAt(half, 'hips')[1]).toBeLessThan(restOf('hips')[1]);
        expect(jointAt(half, 'hips')[1]).toBeGreaterThan(jointAt(curled, 'hips')[1]);
    });
});

describe('winter fox rig: its gait', () => {
    it('takes a longer stride the faster it goes, each paw on the snow for less of it', () => {
        expect(foxStride(0)).toBeGreaterThan(0);
        expect(foxStride(-3)).toBe(foxStride(0));
        let stride = foxStride(0);
        let duty = foxDuty(0);
        let gallop = foxGallop(0);
        for (let speed = 0.25; speed <= 10; speed += 0.25) {
            expect(foxStride(speed), `${speed} m/s`).toBeGreaterThan(stride);
            expect(foxDuty(speed), `${speed} m/s`).toBeLessThanOrEqual(duty);
            expect(foxGallop(speed), `${speed} m/s`).toBeGreaterThanOrEqual(gallop);
            stride = foxStride(speed);
            duty = foxDuty(speed);
            gallop = foxGallop(speed);
            expect(duty).toBeGreaterThan(0);
            expect(duty).toBeLessThan(1);
        }
        // A trot at its trot, a gallop flat out, and the one opens into the other between.
        expect(foxGallop(TROT)).toBe(0);
        expect(foxGallop(FLAT_OUT)).toBe(1);
        expect(foxGallop(4.5)).toBeGreaterThan(0);
        expect(foxGallop(4.5)).toBeLessThan(1);
        expect(foxDuty(FLAT_OUT)).toBeLessThan(foxDuty(TROT));
    });

    it('lands diagonal pairs together at a trot, and the hind pair then the fore pair in the gallop', () => {
        const [FL, FR, BL, BR] = [0, 1, 2, 3];
        const beat = (v) => ((v % 1) + 1) % 1;
        const trot = foxFootfalls(TROT).map(beat);
        expect(trot[FL]).toBeCloseTo(trot[BR], 12);
        expect(trot[FR]).toBeCloseTo(trot[BL], 12);
        expect(beat(trot[FR] - trot[FL])).toBeCloseTo(0.5, 12);
        // The gallop, counted from the first hind paw down: the other hind paw, a pause, the two
        // fore paws a beat apart, and a longer pause in the air.
        const falls = foxFootfalls(FLAT_OUT);
        const gallop = falls.map((v) => beat(v - falls[BL]));
        expect(gallop[BL]).toBe(0);
        expect(gallop[BR]).toBeGreaterThan(0);
        expect(gallop[FL]).toBeGreaterThan(gallop[BR]);
        expect(gallop[FR]).toBeGreaterThan(gallop[FL]);
        expect(gallop[FL] - gallop[BR]).toBeGreaterThan(gallop[BR]);
        expect(gallop[FL] - gallop[BR]).toBeGreaterThan(gallop[FR] - gallop[FL]);
        // It fills the array it is given; how much of a gallop the gait is can be said outright
        // (the mind eases it), and is read from the speed when it is not.
        const out = [9, 9, 9, 9];
        expect(foxFootfalls(TROT, out)).toBe(out);
        expect(out.map(beat)).toEqual(trot);
        expect(foxFootfalls(FLAT_OUT, [], 0)).toEqual(foxFootfalls(TROT));
        expect(foxFootfalls(TROT, [], 1)).toEqual(falls);
        expect(foxFootfalls(3, [], foxGallop(3))).toEqual(foxFootfalls(3));
    });

    it('puts each paw down at its footfall and keeps it on the snow for its share of the cycle', () => {
        const posture = createFoxPosture();
        PACES.forEach((speed) => {
            const falls = foxFootfalls(speed);
            const down = [0, 0, 0, 0];
            const landed = [null, null, null, null];
            const was = FOX_LEGS.map((leg, n) => pawAt(solveFox(gait(-1 / CYCLE, speed), posture), n)[1] < 1e-9);
            for (let i = 0; i < CYCLE; i++) {
                solveFox(gait(i / CYCLE, speed), posture);
                FOX_LEGS.forEach((leg, n) => {
                    const y = pawAt(posture, n)[1];
                    expect(y, `${leg[0]} at ${speed} m/s`).toBeGreaterThan(-1e-9);
                    const on = y < 1e-9;
                    if (on) down[n] += 1;
                    if (on && !was[n]) landed[n] = i / CYCLE;
                    was[n] = on;
                });
            }
            FOX_LEGS.forEach((leg, n) => {
                const label = `${leg[0]} at ${speed} m/s`;
                expect(Math.abs(down[n] / CYCLE - foxDuty(speed)), label).toBeLessThan(2 / CYCLE);
                // (Once a cycle, and where the footfalls say: to within a sample, round the cycle.)
                expect(landed[n], label).not.toBeNull();
                const late = (((landed[n] - falls[n]) % 1) + 1) % 1;
                expect(Math.min(late, 1 - late), label).toBeLessThan(1.5 / CYCLE);
            });
        });
    });

    it('does not slide a planted paw at a steady pace', () => {
        const before = createFoxPosture();
        const after = createFoxPosture();
        const a = [0, 0, 0];
        const b = [0, 0, 0];
        const wrong = [];
        let stances = 0;
        // (A gait that is half a trot and half a gallop holds its paws as well as either.)
        const gaits = [...PACES.map((speed) => [speed, undefined]), [3, 0.5], [FLAT_OUT, 0.3]];
        gaits.forEach(([speed, gallop]) => {
            // The body goes forward a stride a cycle (model metres: the fox is drawn larger than life).
            const stride = foxStride(speed) / FOX_SCALE;
            const step = 0.37 / CYCLE;
            for (let i = 0; i < CYCLE; i++) {
                const phase = i / CYCLE;
                const from = foxGait(createFoxSpec(), phase, speed, 1, 0, gallop);
                const to = foxGait(createFoxSpec(), phase + step, speed, 1, 0, gallop);
                solveFox(from, before);
                solveFox(to, after);
                for (let n = 0; n < FOX_LEGS.length; n++) {
                    // On the snow at both moments...
                    if (from[foot(n) + DY] !== 0 || to[foot(n) + DY] !== 0) continue;
                    stances += 1;
                    pawAt(before, n, a);
                    pawAt(after, n, b);
                    // ...it has gone back under the body by exactly as far as the body went on.
                    const slid = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2] + step * stride);
                    const where = `${FOX_LEGS[n][0]} at ${speed} m/s, phase ${phase.toFixed(3)}`;
                    if (slid > 1e-9 || Math.abs(b[1]) > 1e-9) wrong.push(`${where}: ${slid.toExponential(1)} m`);
                    if (before.short[n] > 1e-9) wrong.push(`${where}: short of its paw`);
                }
            }
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(stances).toBeGreaterThan(CYCLE);
    });

    it('carries a lifted paw forward to where it will land, off the snow all the way', () => {
        PACES.forEach((speed) => {
            const duty = foxDuty(speed);
            const stride = foxStride(speed) / FOX_SCALE;
            const falls = foxFootfalls(speed);
            FOX_LEGS.forEach((leg, n) => {
                const label = `${leg[0]} at ${speed} m/s`;
                // From where it lifts (its stance behind it) to where it lands (its stance ahead).
                const lifts = gait(falls[n] + duty, speed)[foot(n) + DZ];
                const lands = gait(falls[n] + 1 - 1e-9, speed)[foot(n) + DZ];
                expect(lands - lifts, label).toBeCloseTo(duty * stride, 6);
                let last = lifts;
                for (let k = 0.05; k < 1; k += 0.05) {
                    const spec = gait(falls[n] + duty + k * (1 - duty), speed);
                    expect(spec[foot(n) + DY], label).toBeGreaterThan(0);
                    expect(spec[foot(n) + DZ], label).toBeGreaterThan(last);
                    last = spec[foot(n) + DZ];
                }
            });
        });
    });

    it('is never off the snow altogether at a walk, and flies between its bounds at a gallop', () => {
        const fewestDown = (speed) => {
            let fewest = 4;
            for (let i = 0; i < CYCLE; i++) {
                const spec = gait(i / CYCLE, speed);
                fewest = Math.min(fewest, FOX_LEGS.filter((leg, n) => spec[foot(n) + DY] === 0).length);
            }
            return fewest;
        };
        expect(fewestDown(0.3)).toBeGreaterThan(0);
        expect(fewestDown(0.6)).toBeGreaterThan(0);
        expect(fewestDown(FLAT_OUT)).toBe(0);
    });

    it('rides lower the longer its steps, and arches its back only in the gallop', () => {
        const ride = (speed) => {
            let height = 0;
            let rounded = -Infinity;
            let hollowed = Infinity;
            for (let i = 0; i < CYCLE; i++) {
                const spec = gait(i / CYCLE, speed);
                height += jointAt(solveFox(spec), 'spine')[1] / CYCLE;
                rounded = Math.max(rounded, spec[SPEC.arch]);
                hollowed = Math.min(hollowed, spec[SPEC.arch]);
            }
            return { height, rounded, hollowed };
        };
        const walk = ride(0.6);
        const trot = ride(TROT);
        const flat = ride(FLAT_OUT);
        expect(walk.height).toBeLessThan(restOf('spine')[1]);
        expect(trot.height).toBeLessThan(walk.height);
        expect(flat.height).toBeLessThan(trot.height);
        // (Short legs reach by crouching — but it does not drag its belly: most of its height is left.)
        expect(flat.height).toBeGreaterThan(restOf('spine')[1] * 0.7);
        expect([trot.rounded, trot.hollowed]).toEqual([0, 0]);
        expect(flat.rounded).toBeGreaterThan(0.1);
        expect(flat.hollowed).toBeLessThan(-0.1);
    });

    it('goes round: a cycle on it is where it was, and it eases all the way round', () => {
        PACES.forEach((speed) => {
            for (const phase of [0, 0.13, 0.5, 0.77, 0.999]) {
                const here = gait(phase, speed);
                [gait(phase + 1, speed), gait(phase + 5, speed), gait(phase - 3, speed)].forEach((there) => {
                    there.forEach((v, k) => expect(v, `${FIELDS[k]} at ${speed} m/s`).toBeCloseTo(here[k], 9));
                });
            }
            // No number of it jumps anywhere in the cycle — where a paw lands and lifts included.
            const span = (2 * foxStride(speed)) / speed;
            const coarse = largestSteps(gaitFill(speed), span, span / (2 * CYCLE));
            const fine = largestSteps(gaitFill(speed), span, span / (8 * CYCLE));
            FIELDS.forEach((field, k) => {
                expect(fine[k], `${field} at ${speed} m/s`).toBeLessThanOrEqual(coarse[k] * 0.5 + 1e-12);
            });
        });
    });

    it('turns no bone far in a frame at a trot, nor right over at a gallop', () => {
        const frameTurn = (speed) => largestTurn(gaitFill(speed), (2 * foxStride(speed)) / speed, FRAME) / DEG;
        expect(frameTurn(0.6)).toBeLessThan(35);
        expect(frameTurn(TROT)).toBeLessThan(35);
        // (Flat out its legs do whip round — some 40° a frame — and that is the gait, not a flip.)
        expect(frameTurn(FLAT_OUT)).toBeLessThan(75);
    });

    it('stands still when it takes none of its stride, and only lifts its feet when it steps on the spot', () => {
        const touched = createFoxSpec().fill(0.25);
        expect(foxGait(touched, 0.3, TROT, 0, 0)).toBe(touched);
        expect(touched.every((v) => v === 0.25)).toBe(true);
        // It is laid over what the spec already holds, not written in its place.
        const sitting = act('Sit', FOX_ACTS.Sit / 2);
        const over = foxGait(Float64Array.from(sitting), 0.3, TROT, 1);
        const alone = gait(0.3, TROT);
        over.forEach((v, k) => expect(v, FIELDS[k]).toBeCloseTo(sitting[k] + alone[k], 12));
        // Stepping on the spot: each paw is lifted in its turn and none goes anywhere, nor does
        // its body.
        const lifted = [0, 0, 0, 0];
        for (let i = 0; i < CYCLE; i++) {
            const spec = gait(i / CYCLE, 0, 0, 1);
            TRUNK.forEach((name) => expect(spec[SPEC[name]], name).toBe(0));
            FOX_LEGS.forEach((leg, n) => {
                expect(spec[foot(n) + DX], leg[0]).toBe(0);
                expect(spec[foot(n) + DZ], leg[0]).toBe(0);
                expect(spec[foot(n) + AIR], leg[0]).toBe(0);
                lifted[n] = Math.max(lifted[n], spec[foot(n) + DY]);
            });
        }
        lifted.forEach((y, n) => expect(y, FOX_LEGS[n][0]).toBeGreaterThan(0.005));
        // (A regression: stepping on the spot, a heel stayed flat through its stance and the toe
        // snapped half a radian at lift-off. The heel now comes up by as much as the paw will be
        // lifted, whether or not it is going anywhere.) Just before a paw lifts and just after,
        // its toe is where it was; and round the whole cycle no number of the pose jumps.
        const TOE = FEET.toe;
        const stepping = [[0, 1], [0, 0.4], [0.3, 0.8], [1, 0]];
        stepping.forEach(([amount, step]) => {
            const label = `stride ${amount}, step ${step}`;
            const falls = foxFootfalls(TROT);
            const lifts = falls.map((fall) => fall + foxDuty(TROT));
            FOX_LEGS.forEach((leg, n) => {
                const before = gait(lifts[n] - 1e-6, TROT, amount, step)[foot(n) + TOE];
                const after = gait(lifts[n] + 1e-6, TROT, amount, step)[foot(n) + TOE];
                expect(Math.abs(after - before), `${label}: ${leg[0]} lifting`).toBeLessThan(1e-3);
                expect(before, `${label}: ${leg[0]} lifting`).toBeGreaterThan(0.1 * Math.max(amount, step));
                // ...and the same where it comes down.
                const landing = gait(falls[n] - 1e-6, TROT, amount, step)[foot(n) + TOE];
                const landed = gait(falls[n] + 1e-6, TROT, amount, step)[foot(n) + TOE];
                expect(Math.abs(landed - landing), `${label}: ${leg[0]} landing`).toBeLessThan(1e-3);
            });
            const fill = (spec, t) => foxGait(spec.fill(0), t, TROT, amount, step);
            const coarse = largestSteps(fill, 1, 1 / (CYCLE / 2));
            const fine = largestSteps(fill, 1, 1 / (CYCLE * 2));
            FIELDS.forEach((field, k) => {
                expect(fine[k], `${label}: ${field}`).toBeLessThanOrEqual(coarse[k] * 0.5 + 1e-12);
            });
            expect(coarse[foot(0) + TOE], label).toBeGreaterThan(0);
        });
        // The less of its stride it takes, the less ground a paw covers: none at a halt.
        const reach = (amount) => {
            let most = 0;
            for (let i = 0; i < CYCLE; i++) {
                most = Math.max(most, Math.abs(gait(i / CYCLE, TROT, amount)[foot(0) + DZ]));
            }
            return most;
        };
        expect(reach(0.5)).toBeCloseTo(reach(1) * 0.5, 9);
        expect(reach(0.001)).toBeLessThan(reach(1) * 0.01);
    });
});

describe('winter fox rig: from the mind\'s pose to a spec', () => {
    const same = (a, b, label = '') => a.forEach((v, k) => expect(v, `${label} ${FIELDS[k]}`).toBeCloseTo(b[k], 12));

    /** An act as one side has it: what curls to a side curls to that one, and the sleeper's head with it. */
    const sided = (name, t, side) => {
        const spec = act(name, t);
        if (side < 0) {
            const turned = ['bend', 'tailCurl', ...(name === 'CurlSleep' ? ['headYaw', 'headRoll', 'roll'] : [])];
            turned.forEach((number) => {
                spec[SPEC[number]] = -spec[SPEC[number]];
            });
        }
        return spec;
    };
    const mixed = (a, b, share) => a.map((v, k) => v + (b[k] - v) * share);
    /** How far through a cross-fade the pose is at a blend: it eases in and out. */
    const eased = (blend) => blend * blend * (3 - 2 * blend);

    // (A regression: curled to its right, the whole blend's head was mirrored — the other act's
    // with the sleeper's — so a fox that lay down out of a look about had its head thrown the
    // other way for the length of the fade. Each act now takes its side on its own.)
    it('cross-fades from what it was doing to what it does: all of the one, then all of the other', () => {
        const into = 0.7;
        const outOf = 0.9;
        for (const side of [1, -1]) {
            POSES.forEach((from) => {
                POSES.forEach((clip) => {
                    const p = still(clip, into, { from, fromTime: outOf, side });
                    const label = `${from} to ${clip}, side ${side}`;
                    const a = sided(from, outOf, side);
                    const b = sided(clip, into, side);
                    same(foxSpec({ ...p, blend: 0 }), a, `${label}, blend 0:`);
                    same(foxSpec({ ...p, blend: 1 }), b, `${label}, blend 1:`);
                    // Half way it is half of each, and on the way every number lies between the two.
                    same(foxSpec({ ...p, blend: 0.5 }), mixed(a, b, 0.5), `${label}, half way:`);
                    const early = foxSpec({ ...p, blend: 0.2 });
                    const late = foxSpec({ ...p, blend: 0.8 });
                    a.forEach((v, k) => {
                        const span = b[k] - v;
                        const gone = [Math.abs(early[k] - v), Math.abs(late[k] - v)];
                        expect((early[k] - v) * span, `${label} ${FIELDS[k]}`).toBeGreaterThanOrEqual(0);
                        expect(gone[0], `${label} ${FIELDS[k]}`).toBeLessThanOrEqual(gone[1] + 1e-12);
                        expect(gone[1], `${label} ${FIELDS[k]}`).toBeLessThanOrEqual(Math.abs(span) + 1e-12);
                    });
                });
            });
        }
        // The very case: lying down to its right out of a look about, its head is where the look
        // had it when the fade begins — not flung over to the other side.
        const lyingDown = still('CurlSleep', 0, { from: 'LookAround', fromTime: 1, side: -1 });
        const looking = act('LookAround', 1)[SPEC.headYaw];
        expect(Math.abs(looking)).toBeGreaterThan(0.5);
        expect(foxSpec({ ...lyingDown, blend: 0 })[SPEC.headYaw]).toBe(looking);
    });

    // (A mind that changes what it does half-way through a change is, for a moment, three acts
    // at once: the one it had been leaving, the one it had been beginning and the new one. A
    // pose of two slots dropped the first, and the fox snapped — a sleeper woken and startled
    // was on its feet in a frame.)
    it('holds a third act when a change comes half-way through a change: the pose goes on from where it was', () => {
        const rand = mulberry32(0xf0c5);
        const pick = () => POSES[Math.floor(rand() * POSES.length)];
        for (let i = 0; i < 60; i++) {
            const [was, from, clip] = [pick(), pick(), pick()];
            const side = rand() < 0.5 ? 1 : -1;
            const [wasTime, fromTime, clipTime] = [rand() * FOX_ACTS[was], rand() * FOX_ACTS[from], rand() * 0.5];
            const [hold, blend] = [rand(), rand()];
            const label = `${was}, ${from}, ${clip}, side ${side}`;
            const p = still(clip, clipTime, {
                from, fromTime, was, wasTime, hold, blend, side,
            });
            // What it had been leaving, held at the share of the way from it that it had reached...
            const leaving = mixed(sided(was, wasTime, side), sided(from, fromTime, side), hold);
            // ...and from there to what it does now.
            same(foxSpec(p), mixed(leaving, sided(clip, clipTime, side), eased(blend)), label);
            same(foxSpec({ ...p, blend: 0 }), leaving, `${label}, blend 0:`);
            same(foxSpec({ ...p, blend: 1 }), sided(clip, clipTime, side), `${label}, blend 1:`);
            // A hold of nothing is the first act alone, a whole one the second; no third act is two.
            same(foxSpec({ ...p, blend: 0, hold: 0 }), sided(was, wasTime, side), `${label}, hold 0:`);
            same(foxSpec({ ...p, blend: 0, hold: 1 }), sided(from, fromTime, side), `${label}, hold 1:`);
            same(foxSpec({ ...p, was: null }), foxSpec({ ...p, hold: 1 }), `${label}, no third:`);
            same(foxSpec({ ...p, was: undefined, hold: 0.3 }), foxSpec({ ...p, hold: 1 }), `${label}, no third:`);
            // The point of it: the instant a mind changes its mind, nothing moves. Half-way from
            // `was` to `from` (as far as `hold` says), it begins `clip`: the pose it shows at the
            // start of the new fade is the pose it showed at that moment of the old one.
            const before = foxSpec(still(from, fromTime, {
                from: was, fromTime: wasTime, blend, side,
            }));
            const after = foxSpec(still(clip, 0, {
                from, fromTime, was, wasTime, hold: eased(blend), blend: 0, side,
            }));
            same(after, before, `${label}, the change:`);
        }
    });

    it('lays its gait under three acts by as much of each as is its gait', () => {
        const moving = { phase: 0.3, speed: TROT, amp: 1 };
        const cases = [
            // [was, from, clip]: what it shows of its gait at a hold and a blend
            [['Run', 'Sit', 'Dig'], (hold, mix) => (1 - mix) * (1 - hold)],
            [['Sit', 'Run', 'Dig'], (hold, mix) => (1 - mix) * hold],
            [['Sit', 'Dig', 'Run'], (hold, mix) => mix],
            [['Run', 'Sit', 'Run'], (hold, mix) => mix + (1 - mix) * (1 - hold)],
            [['Run', 'Run', 'Sit'], (hold, mix) => 1 - mix],
            [['Sit', 'Dig', 'Greet'], () => 0],
        ];
        cases.forEach(([[was, from, clip], share]) => {
            for (const [hold, blend] of [[0.3, 0.4], [0.8, 0.1], [0, 0], [1, 0.6], [0.5, 1]]) {
                const p = still(clip, 0.2, {
                    from, fromTime: 1.1, was, wasTime: 2, hold, blend, ...moving,
                });
                // Its acts alone (a stride of nothing), with the gait laid over by hand.
                const acts = foxSpec({ ...p, amp: 0 });
                const want = foxGait(acts, moving.phase, moving.speed, share(hold, eased(blend)));
                same(foxSpec(p), want, `${was}, ${from}, ${clip} at hold ${hold}, blend ${blend}:`);
            }
        });
    });

    it('cross-fades one act with itself at another time, and holds the ends of a blend past them', () => {
        // (An act begun over again fades from where it had got to.)
        const p = still('LookAround', 0.4, { from: 'LookAround', fromTime: 1.9 });
        same(foxSpec({ ...p, blend: 0 }), act('LookAround', 1.9));
        same(foxSpec({ ...p, blend: 1 }), act('LookAround', 0.4));
        expect(foxSpec({ ...p, blend: 0.5 })[SPEC.headYaw])
            .toBeCloseTo((act('LookAround', 1.9)[SPEC.headYaw] + act('LookAround', 0.4)[SPEC.headYaw]) / 2, 12);
        same(foxSpec({ ...p, blend: -3 }), act('LookAround', 1.9));
        same(foxSpec({ ...p, blend: 7 }), act('LookAround', 0.4));
        // A pose that says nothing of a blend is all of its act.
        same(foxSpec({ clip: 'Sit', clipTime: 3, amp: 0 }), act('Sit', 3));
    });

    it('lays its gait under an act by as much of the blend as is its gait', () => {
        const running = still('Run', 0, { phase: 0.3, speed: TROT, amp: 1 });
        same(foxSpec(running), gait(0.3, TROT));
        // Leaving its gait for an act: all gait at the start of the blend, none at its end.
        const stopping = { ...running, clip: 'Sit', clipTime: 0.2 };
        same(foxSpec({ ...stopping, blend: 0 }), gait(0.3, TROT));
        same(foxSpec({ ...stopping, blend: 1 }), act('Sit', 0.2));
        // And setting off out of one: the other way about.
        const leaving = { ...running, from: 'Sit', fromTime: 3 };
        same(foxSpec({ ...leaving, blend: 0 }), act('Sit', 3));
        same(foxSpec({ ...leaving, blend: 1 }), gait(0.3, TROT));
        // Its stride is as long as the mind says (it shortens its steps to a halt)...
        same(foxSpec({ ...running, amp: 0.4 }), gait(0.3, TROT, 0.4));
        same(foxSpec({ ...running, amp: 0 }), createFoxSpec());
        // ...it steps on the spot when told to, whatever else it does...
        same(foxSpec({ ...running, amp: 0, step: 0.8 }), gait(0.3, TROT, 0, 0.8));
        // ...and its gait is as much of a gallop as the mind has eased it to.
        const opening = foxGait(createFoxSpec(), 0.3, FLAT_OUT, 1, 0, 0.25);
        same(foxSpec({ ...running, speed: FLAT_OUT, gallop: 0.25 }), opening);
        same(foxSpec({ ...running, speed: FLAT_OUT }), gait(0.3, FLAT_OUT));
    });

    it('adds what the mind lays over every act, the same whatever the act', () => {
        const over = {
            lean: 0.2, nod: 0.1, lookYaw: 0.4, lookPitch: 0.2, tailYaw: 0.3, tailLift: 0.25, breath: 0.7,
        };
        const added = (clip, t) => {
            const bare = foxSpec(still(clip, t));
            return foxSpec(still(clip, t, over)).map((v, k) => v - bare[k]);
        };
        const standing = added('Run', 0);
        POSES.forEach((clip) => same(added(clip, FOX_ACTS[clip] / 2), standing, clip));
        // Each goes where it says, by as much as it says.
        expect(standing[SPEC.headYaw]).toBeCloseTo(over.lookYaw, 12);
        expect(standing[SPEC.headPitch]).toBeCloseTo(over.lookPitch, 12);
        expect(standing[SPEC.tailYaw]).toBeCloseTo(over.tailYaw, 12);
        expect(standing[SPEC.tailLift]).toBeCloseTo(over.tailLift, 12);
        expect(standing[SPEC.pitch]).toBeCloseTo(over.nod, 12);
        expect(standing[SPEC.roll]).toBeCloseTo(-over.lean, 12);
        // And none of it moves a paw.
        expect(Array.from(standing.subarray(SPEC.feet)).every((v) => v === 0)).toBe(true);
        // A nod sinks it a little too, whichever way it pitches and both ends alike — so that
        // the end a nod lifts does not take its paws off the snow.
        const nodding = (nod) => {
            const bare = foxSpec(still('Run', 0));
            return foxSpec(still('Run', 0, { nod })).map((v, k) => v - bare[k]);
        };
        const dipped = nodding(0.1);
        const lifted = nodding(-0.1);
        expect(dipped[SPEC.rear]).toBeGreaterThan(0);
        expect(dipped[SPEC.fore]).toBeCloseTo(dipped[SPEC.rear], 12);
        expect(lifted[SPEC.rear]).toBeCloseTo(dipped[SPEC.rear], 12);
        expect(lifted[SPEC.fore]).toBeCloseTo(dipped[SPEC.rear], 12);
        expect(nodding(0.05)[SPEC.rear]).toBeCloseTo(dipped[SPEC.rear] / 2, 12);
        expect(lifted[SPEC.pitch]).toBeCloseTo(-0.1, 12);
        // (By less than it lifts that end, or it would only crouch: its nose still goes down.)
        expect(dipped[SPEC.rear]).toBeLessThan(0.1 * (FOX_MARKS.nose[2] - restOf('spine')[2]));
    });

    it('carries those in the body the way the mind means them', () => {
        const stand = solveFox(foxSpec(still('Run', 0)));
        const posedWith = (over) => solveFox(foxSpec(still('Run', 0, over)));
        // It leans into a turn to its left: its left shoulder drops, its right comes up.
        const leaning = posedWith({ lean: 0.2 });
        expect(jointAt(leaning, 'armL')[1]).toBeLessThan(jointAt(stand, 'armL')[1]);
        expect(jointAt(leaning, 'armR')[1]).toBeGreaterThan(jointAt(stand, 'armR')[1]);
        // It dips its nose as it brakes.
        expect(noseAt(posedWith({ nod: 0.1 }))[1]).toBeLessThan(noseAt(stand)[1]);
        // Its head turns to its left and up; its tail swings to its left and is carried higher.
        expect(noseAt(posedWith({ lookYaw: 0.4 }))[0]).toBeGreaterThan(0.05);
        expect(noseAt(posedWith({ lookPitch: 0.4 }))[1]).toBeGreaterThan(noseAt(stand)[1] + 0.05);
        expect(tailTipAt(posedWith({ tailYaw: 0.4 }))[0]).toBeGreaterThan(tailTipAt(stand)[0] + 0.05);
        expect(tailTipAt(posedWith({ tailLift: 0.4 }))[1]).toBeGreaterThan(tailTipAt(stand)[1] + 0.05);
        // A breath in lifts its chest a little, a breath out lets it down: millimetres.
        const breathIn = jointAt(posedWith({ breath: 1 }), 'chest')[1];
        const breathOut = jointAt(posedWith({ breath: -1 }), 'chest')[1];
        expect(breathIn).toBeGreaterThan(breathOut);
        expect(breathIn - breathOut).toBeLessThan(0.02);
    });

    it('curls to the side the mind chose: side −1 is the mirror image', () => {
        // What bends it and curls its tail goes the other way...
        for (const [clip, t] of [['Sit', FOX_ACTS.Sit / 2], ['CurlSleep', SLEEP_HOLD]]) {
            const left = foxSpec(still(clip, t, { side: 1 }));
            const right = foxSpec(still(clip, t, { side: -1 }));
            expect(right[SPEC.bend], clip).toBeCloseTo(-left[SPEC.bend], 12);
            expect(right[SPEC.tailCurl], clip).toBeCloseTo(-left[SPEC.tailCurl], 12);
            expect(Math.abs(left[SPEC.tailCurl]), clip).toBeGreaterThan(0.5);
            // (To its left when the mind does not say.)
            same(foxSpec(still(clip, t, { side: undefined })), left, clip);
        }
        // ...and asleep the whole animal is its mirror image: nose and every joint, left for right.
        const left = solveFox(foxSpec(still('CurlSleep', SLEEP_HOLD, { side: 1 })));
        const right = solveFox(foxSpec(still('CurlSleep', SLEEP_HOLD, { side: -1 })));
        expect(noseAt(left)[0]).toBeGreaterThan(0.1);
        const nose = noseAt(right);
        expect(apart([-nose[0], nose[1], nose[2]], noseAt(left))).toBeLessThan(1e-9);
        FOX_BONES.forEach(([name], i) => {
            // (Its tail comes round the other side too, though not to the millimetre: the mesh
            // carries it a little off its midline.)
            if (name.startsWith('tail')) return;
            const twin = right.at[FOX_BONE_INDEX[twinOf(name)]];
            expect(apart([-twin[0], twin[1], twin[2]], left.at[i]), name).toBeLessThan(1e-9);
        });
        expect(tailTipAt(left)[0]).toBeGreaterThan(0.1);
        expect(tailTipAt(right)[0]).toBeLessThan(-0.1);
    });

    it('writes into the spec it is given, and keeps nothing from one pose to the next', () => {
        const spec = createFoxSpec().fill(3);
        const sitting = still('Sit', 3, { lookYaw: 0.2 });
        expect(foxSpec(sitting, spec)).toBe(spec);
        const first = Array.from(spec);
        expect(first.every(Number.isFinite)).toBe(true);
        const lyingDown = still('CurlSleep', 1, {
            side: -1, from: 'Dig', fromTime: 0.3, blend: 0.4,
        });
        foxSpec(lyingDown, spec);
        expect(Array.from(spec)).not.toEqual(first);
        expect(Array.from(foxSpec(sitting, spec))).toEqual(first);
        expect(Array.from(foxSpec(sitting))).toEqual(first);
    });

    it('has a default for everything it reads off a pose but its act', () => {
        // (The fox of light is posed with a handful of these and no more: what is missing must
        // have a default, and a pose with only an act in it must still solve.)
        const bare = solveFox(foxSpec({ clip: 'Run', from: 'Run' }));
        expect([...bare.world, ...bare.at].every((v) => v.every(Number.isFinite))).toBe(true);
        // What it reads, from its own source — so that a number added there is asked about here.
        const body = engine.slice(engine.indexOf('const specOf = '), engine.indexOf('// ── Solving a spec'));
        const read = [...new Set([...body.matchAll(/\bp\.(\w+)/g)].map((m) => m[1]))].sort();
        expect(read.length).toBeGreaterThan(12);
        /** What a pose that does not say is taken to say. */
        const unsaid = {
            clipTime: 0,
            fromTime: 0,
            blend: 1,
            was: null,
            wasTime: 0,
            hold: 1,
            side: 1,
            phase: 0,
            speed: 0,
            amp: 1,
            step: 0,
            lean: 0,
            nod: 0,
            lookYaw: 0,
            lookPitch: 0,
            tailYaw: 0,
            tailLift: 0,
            breath: 0,
        };
        // A pose that says everything, none of it the default.
        const full = {
            clip: 'Run',
            clipTime: 0.3,
            from: 'Sit',
            fromTime: 2.5,
            blend: 0.4,
            was: 'Dig',
            wasTime: 0.4,
            hold: 0.6,
            side: -1,
            phase: 0.37,
            speed: 3,
            amp: 0.7,
            gallop: 0.2,
            step: 0.3,
            lean: 0.1,
            nod: 0.05,
            lookYaw: 0.3,
            lookPitch: 0.2,
            tailYaw: 0.2,
            tailLift: 0.4,
            breath: 0.5,
        };
        expect(Object.keys(full).sort()).toEqual(read);
        read.filter((name) => name !== 'clip' && name !== 'from').forEach((name) => {
            const { [name]: left, ...without } = full;
            // (How much of a gallop its gait is, unsaid, is read from its speed.)
            const fallback = name === 'gallop' ? foxGallop(full.speed) : unsaid[name];
            expect(fallback, `no default known for p.${name}`).not.toBeUndefined();
            expect(left).not.toBe(fallback);
            same(foxSpec(without), foxSpec({ ...full, [name]: fallback }), `without ${name}:`);
        });
    });
});
