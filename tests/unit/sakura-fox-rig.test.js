/**
 * Sakura Twilight — the red foxes' body (sakura-fox-rig.js): their skeleton, the asset skinned
 * to it (assets/sakura-fox.glb, made of the glTF sample fox by scripts/sakura/rig-fox.mjs), and
 * the rig the themes share as it carries this long-legged animal. No three, no GPU.
 *
 * What is pinned is what has to hold whatever the poses are tuned to: the asset is the table's
 * skeleton and the script's own output, the source model is untouched, the fox stands on its
 * four paws, sits and curls up without a leg left hanging or driven into the ground, and a paw
 * in stance does not slide. Lengths and angles are read from the module; the bounds are
 * generous. (The engine itself: shared-fox-rig.test.js and winter-fox-rig.test.js.)
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import { SAKURA_FOX_PAIR } from '../../src/themes/sakura-twilight/sakura-fox-mind.js';
import {
    SAKURA_FOX_BONES, SAKURA_FOX_MARKS, SAKURA_FOX_RIG, SAKURA_FOX_SIZE, createSakuraFoxRig,
} from '../../src/themes/sakura-twilight/sakura-fox-rig.js';
import {
    FOOT, FOX_ACTS, FOX_LEGS, SLEEP_HOLD, SPEC,
} from '../../src/themes/shared/fox-rig.js';
import { readGlb } from '../../scripts/fox/glb-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = path.join(ROOT, 'src', 'themes', 'sakura-twilight', 'assets');
const ASSET = path.join(ASSETS, 'sakura-fox.glb');
/** The glTF sample fox as it came: the script's source, kept beside what it makes. */
const SOURCE = 'src/themes/sakura-twilight/assets/Fox.glb';
const RIG_SCRIPT = path.join(ROOT, 'scripts', 'sakura', 'rig-fox.mjs');
const source = readFileSync(path.join(ROOT, 'src', 'themes', 'sakura-twilight', 'sakura-fox-rig.js'), 'utf8');

const FRAME = 1 / 60;
const DEG = Math.PI / 180;
const RIG = SAKURA_FOX_RIG;
const CM = 0.01;
/** What it does at a stop: every act but its gait. */
const POSES = Object.keys(RIG.lengths).filter((name) => name !== 'Run');
/** The bones of its legs. */
const LEG_BONES = new Set(FOX_LEGS.flatMap((leg) => [leg[1], leg[2], leg[3]]));
const FORE = [0, 1];
const HIND = [2, 3];

const restOf = (bone) => SAKURA_FOX_BONES[RIG.index[bone]].slice(2);
const jointAt = (posture, bone) => posture.at[RIG.index[bone]];
const pawAt = (rig, posture, leg) => rig.point(posture, FOX_LEGS[leg][3], SAKURA_FOX_MARKS[FOX_LEGS[leg][4]]);
const noseAt = (posture) => RIG.point(posture, 'head', SAKURA_FOX_MARKS.nose);
const tailTipAt = (posture) => RIG.point(posture, 'tail3', SAKURA_FOX_MARKS.tailTip);
const planted = (spec, leg) => spec[SPEC.feet + leg * FOOT.size + FOOT.air] === 0;
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const turnBetween = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dot4(a, b))));
/** A pose of the mind's with nothing laid over it: one act, held, at a stand. */
const still = (clip, clipTime, side = 1) => ({
    clip, clipTime, from: clip, fromTime: clipTime, blend: 1, phase: 0, speed: 0, amp: 0, step: 0, side,
});
/** An act at `t`, solved. */
const posed = (name, t) => {
    const spec = RIG.act(RIG.createSpec(), name, t);
    return { spec, posture: RIG.solve(spec) };
};
/** The moment of an act at which its hips are lowest. */
function lowest(name) {
    let best = { y: Infinity, t: 0 };
    for (let t = 0; t <= RIG.lengths[name]; t += FRAME) {
        const y = jointAt(posed(name, t).posture, 'hips')[1];
        if (y < best.y) best = { y, t };
    }
    return best.t;
}

describe('sakura fox rig: the module', () => {
    it('is three-free: the engine the themes share is all it imports', () => {
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
        expect(imports).toEqual(['../shared/fox-rig.js']);
        expect(source).not.toMatch(/\bTHREE\b|\bdocument\b|\bwindow\b|Math\.random|Date\.now/);
    });

    it('lists a whole fox: twenty bones, each after its parent, its left the mirror of its right', () => {
        expect(Object.isFrozen(SAKURA_FOX_BONES)).toBe(true);
        expect(SAKURA_FOX_BONES).toHaveLength(20);
        const names = SAKURA_FOX_BONES.map((bone) => bone[0]);
        expect(new Set(names).size).toBe(names.length);
        SAKURA_FOX_BONES.forEach(([name, parent, x, y, z], i) => {
            if (parent === null) expect(i).toBe(0);
            else expect(names.indexOf(parent), name).toBeLessThan(i);
            expect([x, y, z].every(Number.isFinite)).toBe(true);
            expect(y, name).toBeGreaterThan(0);
            if (name.endsWith('L')) {
                expect(x).toBeGreaterThan(0);
                expect(restOf(`${name.slice(0, -1)}R`)).toEqual([-x, y, z]);
            } else if (!name.endsWith('R')) expect(x).toBe(0);
        });
        // A tail of three bones (the arctic fox's is four), and the four legs the engine walks.
        expect(names.filter((name) => /^tail\d$/.test(name))).toEqual(['tail1', 'tail2', 'tail3']);
        FOX_LEGS.forEach(([, upper, lower, end, paw]) => {
            [upper, lower, end].forEach((bone) => expect(names).toContain(bone));
            // Its paw is on the ground, under its last joint or a little ahead of it.
            expect(SAKURA_FOX_MARKS[paw][1]).toBe(0);
            expect(SAKURA_FOX_MARKS[paw][0]).toBe(restOf(end)[0]);
        });
        // Its nose is ahead of its head and the tip of its tail behind its last bone.
        expect(SAKURA_FOX_MARKS.nose[2]).toBeGreaterThan(restOf('head')[2]);
        expect(SAKURA_FOX_MARKS.tailTip[2]).toBeLessThan(restOf('tail3')[2]);
        expect(SAKURA_FOX_MARKS.eye[2]).toBeLessThan(SAKURA_FOX_MARKS.nose[2]);
    });

    it('makes a rig for a fox of any size: the model\'s own, and each of the pair\'s', () => {
        expect(SAKURA_FOX_SIZE).toBeGreaterThan(1);
        expect(RIG.scale).toBe(1);
        expect(RIG.size).toBe(SAKURA_FOX_SIZE);
        expect(RIG.bones).toBe(SAKURA_FOX_BONES);
        expect(RIG.marks).toBe(SAKURA_FOX_MARKS);
        // Every act the mind may ask of it has a length, its own way of sitting and sleeping included.
        Object.keys(FOX_ACTS).forEach((name) => expect(RIG.lengths[name], name).toBe(FOX_ACTS[name]));
        SAKURA_FOX_PAIR.forEach((plan) => {
            const rig = createSakuraFoxRig(plan.scale);
            expect(rig.scale).toBe(plan.scale);
            expect(rig.size).toBe(SAKURA_FOX_SIZE);
            // The larger the fox is drawn, the longer its stride over the ground.
            expect(rig.stride(2) / RIG.stride(2 / plan.scale)).toBeCloseTo(plan.scale, 9);
        });
    });
});

describe('sakura fox rig: the asset', () => {
    const UBYTE = 5121;
    /** Across the middle of its body, where the other side's leg begins (m): most of the way to its joints. */
    const OTHER_LEG = 0.7 * SAKURA_FOX_BONES.find((bone) => bone[0] === 'armL')[2];
    let json;
    let read;
    let skin;
    let primitive;
    let count;
    const accessor = (name) => json.accessors[primitive.attributes[name]];

    beforeAll(() => {
        ({ json, read } = readGlb(ASSET));
        [skin] = json.skins;
        [primitive] = json.meshes[0].primitives;
        ({ count } = accessor('POSITION'));
    });

    it('is one skinned mesh on the table\'s skeleton: its bones, in its order, where the table has them', () => {
        expect(json.skins).toHaveLength(1);
        expect(json.meshes).toHaveLength(1);
        expect(json.meshes[0].primitives).toHaveLength(1);
        const drawn = json.nodes.filter((node) => node.mesh !== undefined);
        expect(drawn).toHaveLength(1);
        expect(drawn[0].skin).toBe(0);
        expect(skin.joints.map((node) => json.nodes[node].name)).toEqual(SAKURA_FOX_BONES.map((bone) => bone[0]));
        const above = new Map();
        json.nodes.forEach((node, i) => (node.children ?? []).forEach((child) => above.set(child, i)));
        skin.joints.forEach((node, i) => {
            const [name, parent, ...at] = SAKURA_FOX_BONES[i];
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
        // Every bone is bound by a move alone: all of them are axis-aligned at rest.
        const bound = json.accessors[skin.inverseBindMatrices];
        expect(bound).toMatchObject({ type: 'MAT4', count: SAKURA_FOX_BONES.length });
        const binds = read(skin.inverseBindMatrices);
        SAKURA_FOX_BONES.forEach(([name, , x, y, z], i) => {
            const want = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1];
            want.forEach((v, k) => expect(Math.abs(binds[i * 16 + k] - v), `${name} [${k}]`).toBeLessThan(1e-6));
        });
    });

    it('carries no clips, is stamped by the script that rigged it, and says whose model it was', () => {
        expect(json.animations ?? []).toEqual([]);
        expect(json.asset.generator).toMatch(/scripts\/sakura\/rig-fox\.mjs/);
        const version = Number(readFileSync(RIG_SCRIPT, 'utf8').match(/const RIG_VERSION = (\d+);/)?.[1]);
        expect(version).toBeGreaterThan(0);
        expect(json.asset.extras?.sakuraFoxRig).toBe(version);
        // (The sample fox is CC-BY: the file names its source.)
        expect(json.asset.extras?.source).toMatch(/Fox\.glb/);
        expect(json.asset.extras?.source).toMatch(/CC-BY/);
    });

    it('weighs every vertex to bones of the skeleton, in four weights that make a whole byte', () => {
        expect(accessor('JOINTS_0')).toMatchObject({ componentType: UBYTE, type: 'VEC4', count });
        expect(accessor('WEIGHTS_0')).toMatchObject({
            componentType: UBYTE, normalized: true, type: 'VEC4', count,
        });
        const positions = read(primitive.attributes.POSITION);
        const joints = read(primitive.attributes.JOINTS_0);
        const weights = read(primitive.attributes.WEIGHTS_0);
        const moved = new Set();
        let strays = 0;
        let unwhole = 0;
        let across = 0;
        let pulled = 0;
        for (let v = 0; v < count; v++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                const joint = joints[v * 4 + k];
                const weight = Math.round(weights[v * 4 + k] * 255);
                if (!(Number.isInteger(joint) && joint >= 0 && joint < SAKURA_FOX_BONES.length)) strays += 1;
                else if (weight > 0) {
                    moved.add(joint);
                    const [name] = SAKURA_FOX_BONES[joint];
                    // How far over on the other side of its body a leg's bone moves this vertex (m).
                    const over = LEG_BONES.has(name) ? -positions[v * 3] * (name.endsWith('L') ? 1 : -1) : 0;
                    if (over > OTHER_LEG) across += 1;
                    if (over > 0.005 && weight > 0.1 * 255) pulled += 1;
                }
                sum += weight;
            }
            if (sum !== 255) unwhole += 1;
        }
        expect(strays).toBe(0);
        expect(unwhole).toBe(0);
        // A leg keeps to its own side: it moves nothing of the other leg, and of the chest and
        // belly between them it takes no more than a small part across the middle.
        expect(across).toBe(0);
        expect(pulled).toBe(0);
        // And no bone is idle: each carries some of the mesh.
        expect(moved.size).toBe(SAKURA_FOX_BONES.length);
    });

    it('is a rounded mesh the size the table is, standing on the ground, with its coat and its colours', () => {
        const indexed = json.accessors[primitive.indices];
        expect(primitive.mode ?? 4).toBe(4);
        expect(indexed.count % 3).toBe(0);
        // (The sample fox is 576 flat triangles: this is that, split in four twice.)
        expect(indexed.count / 3).toBeGreaterThan(576 * 4);
        const indices = read(primitive.indices);
        let beyond = 0;
        for (let i = 0; i < indices.length; i++) {
            if (!(indices[i] < count)) beyond += 1;
        }
        expect(beyond).toBe(0);
        const { min, max } = accessor('POSITION');
        // Metres, not the sample's centimetres; its lowest vertex is where its paws are marked.
        expect(Math.abs(min[1])).toBeLessThan(0.01);
        expect(max[1]).toBeGreaterThan(restOf('head')[1]);
        expect(max[1]).toBeLessThan(1.2);
        expect(max[2]).toBeGreaterThan(restOf('head')[2]);
        expect(min[2]).toBeLessThan(restOf('tail3')[2]);
        expect(Math.abs(max[2] - SAKURA_FOX_MARKS.nose[2])).toBeLessThan(0.05);
        expect(Math.abs(min[2] - SAKURA_FOX_MARKS.tailTip[2])).toBeLessThan(0.05);
        // Smooth normals for the fur to stand on, and the coat's four numbers in each vertex's colour.
        expect(accessor('NORMAL')).toMatchObject({ type: 'VEC3', count });
        const normals = read(primitive.attributes.NORMAL);
        let unlit = 0;
        for (let v = 0; v < count; v++) {
            const size = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
            if (!(Math.abs(size - 1) < 1e-3)) unlit += 1;
        }
        expect(unlit).toBe(0);
        expect(accessor('COLOR_0')).toMatchObject({
            componentType: UBYTE, normalized: true, type: 'VEC4', count,
        });
        const positions = read(primitive.attributes.POSITION);
        const colours = read(primitive.attributes.COLOR_0);
        let brush = 0;
        let ahead = 0;
        let furred = 0;
        for (let v = 0; v < count; v++) {
            if (colours[v * 4 + 1] > 0) furred += 1;
            if (colours[v * 4] > 0.5) {
                brush += 1;
                // The first number is how far along its brush a vertex is: none of that ahead of its hips.
                if (positions[v * 3 + 2] > restOf('hips')[2]) ahead += 1;
            }
        }
        expect(brush).toBeGreaterThan(10);
        expect(brush).toBeLessThan(count * 0.5);
        expect(ahead).toBe(0);
        expect(furred).toBeGreaterThan(count * 0.5);
        // Its own colours: the sample fox's texture, carried in the file.
        expect(accessor('TEXCOORD_0')).toMatchObject({ type: 'VEC2', count });
        const material = json.materials[primitive.material];
        const image = json.images[json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source];
        expect(image.mimeType).toBe('image/png');
        expect(image.bufferView).toBeGreaterThanOrEqual(0);
    });

    it('is what the rigging script makes of the sample fox: a fresh rig in memory is the asset, byte for byte', () => {
        const run = spawnSync(process.execPath, [RIG_SCRIPT, '--check'], {
            cwd: ROOT, encoding: 'utf8', timeout: 100_000,
        });
        expect(`${run.stdout}${run.stderr}`).not.toMatch(/differ|mismatch|stale/i);
        expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    }, 120_000);

    it('leaves the sample fox it was made from untouched: the file on disk is the one committed', () => {
        // (assets/ATTRIBUTION.md promises it: Fox.glb is kept as it came, the script only reads it.)
        const committed = spawnSync('git', ['show', `HEAD:${SOURCE}`], {
            cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
        });
        expect(committed.error, 'git has to be on the PATH for this check').toBeUndefined();
        expect(committed.status, committed.stderr?.toString()).toBe(0);
        const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
        const onDisk = readFileSync(path.join(ROOT, SOURCE));
        expect(onDisk.length).toBeGreaterThan(100_000);
        expect(onDisk.subarray(0, 4).toString('latin1')).toBe('glTF');
        expect(sha(onDisk)).toBe(sha(committed.stdout));
        // And it is still the sample as it came: its three baked clips, its joints by their old names.
        const sample = readGlb(path.join(ROOT, SOURCE)).json;
        expect(sample.animations.map((clip) => clip.name).sort()).toEqual(['Run', 'Survey', 'Walk']);
        expect(sample.nodes.some((node) => node.name === 'b_Tail03_014')).toBe(true);
    });
});

describe('sakura fox rig: the animal', () => {
    it('stands on its four paws when nothing is asked of it: the zero pose is the model at rest', () => {
        const posture = RIG.solve(RIG.createSpec());
        SAKURA_FOX_BONES.forEach(([name, , ...at], i) => {
            expect(apart(posture.at[i], at), name).toBeLessThan(1e-9);
            expect(turnBetween(posture.world[i], [0, 0, 0, 1]), name).toBeLessThan(1e-6);
        });
        FOX_LEGS.forEach(([name, , , , paw], leg) => {
            expect(apart(pawAt(RIG, posture, leg), SAKURA_FOX_MARKS[paw]), name).toBeLessThan(1e-9);
            expect(posture.short[leg], name).toBe(0);
        });
        // Long in the leg: its hips are further off the ground than its body is deep.
        expect(restOf('hips')[1]).toBeGreaterThan(0.3);
        // And it is up on its legs where each thing it does at a stop begins and ends.
        POSES.filter((name) => name !== 'CurlSleep').forEach((name) => {
            [0, RIG.lengths[name]].forEach((t) => {
                const { posture: at } = posed(name, t);
                expect(jointAt(at, 'hips')[1], `${name} at ${t}`).toBeGreaterThan(restOf('hips')[1] * 0.8);
            });
        });
    });

    it('sits right down on its haunches, its forelegs planted and reaching the ground', () => {
        const t = lowest('Sit');
        const { spec, posture } = posed('Sit', t);
        expect(t).toBeGreaterThan(0.3);
        expect(t).toBeLessThan(RIG.lengths.Sit);
        // Its hips go a long way down — more than half their height — and its shoulders stay up.
        expect(jointAt(posture, 'hips')[1]).toBeLessThan(restOf('hips')[1] * 0.5);
        expect(jointAt(posture, 'chest')[1]).toBeGreaterThan(jointAt(posture, 'hips')[1] + 0.15);
        expect(jointAt(posture, 'chest')[1]).toBeGreaterThan(restOf('chest')[1] * 0.6);
        expect(noseAt(posture)[1]).toBeGreaterThan(restOf('head')[1]);
        // All four paws are on the ground, and its forelegs reach it: neither is left hanging.
        FOX_LEGS.forEach(([name], leg) => {
            expect(planted(spec, leg), name).toBe(true);
            expect(Math.abs(pawAt(RIG, posture, leg)[1]), name).toBeLessThan(0.5 * CM);
        });
        FORE.forEach((leg) => expect(posture.short[leg]).toBeLessThan(0.1 * CM));
        HIND.forEach((leg) => expect(posture.short[leg]).toBeLessThan(1 * CM));
        // Its forepaws stay ahead of its shoulders' fall line no further than a step, under its chest.
        FORE.forEach((leg) => {
            const paw = pawAt(RIG, posture, leg);
            expect(paw[2]).toBeGreaterThan(jointAt(posture, 'hips')[2]);
            expect(Math.abs(paw[2] - jointAt(posture, 'armL')[2])).toBeLessThan(0.25);
        });
        // Nothing of it is in the ground: no joint, not the tip of its tail (which lies round to one side).
        posture.at.forEach((at, i) => expect(at[1], SAKURA_FOX_BONES[i][0]).toBeGreaterThan(-0.5 * CM));
        expect(tailTipAt(posture)[1]).toBeGreaterThan(0);
        expect(Math.abs(tailTipAt(posture)[0])).toBeGreaterThan(0.1);
        // Told the other side, its tail lies round the other way and the rest of it is the same.
        const left = RIG.solve(RIG.spec(still('Sit', t, 1)));
        const right = RIG.solve(RIG.spec(still('Sit', t, -1)));
        expect(tailTipAt(right)[0]).toBeCloseTo(-tailTipAt(left)[0], 9);
        expect(jointAt(right, 'hips')[1]).toBeCloseTo(jointAt(left, 'hips')[1], 9);
    });

    it('curls up to sleep low on the ground, nose to tail, without its paws going far under it', () => {
        const { posture } = posed('CurlSleep', SLEEP_HOLD);
        // Down: its back is lower than its knees were, its nose near the ground and round by its tail.
        expect(jointAt(posture, 'hips')[1]).toBeLessThan(restOf('hips')[1] * 0.5);
        expect(jointAt(posture, 'chest')[1]).toBeLessThan(restOf('chest')[1] * 0.5);
        expect(noseAt(posture)[1]).toBeLessThan(restOf('hips')[1] * 0.5);
        const length = SAKURA_FOX_MARKS.nose[2] - SAKURA_FOX_MARKS.tailTip[2];
        expect(apart(noseAt(posture), tailTipAt(posture))).toBeLessThan(length * 0.6);
        // Its legs fold under it. The ground does not give: a folded paw or elbow may sink into
        // the grass its body hides, not deeper than its own thickness.
        const UNDER = 0.04 * SAKURA_FOX_SIZE;
        FOX_LEGS.forEach(([name], leg) => expect(pawAt(RIG, posture, leg)[1], name).toBeGreaterThan(-UNDER));
        posture.at.forEach((at, i) => expect(at[1], SAKURA_FOX_BONES[i][0]).toBeGreaterThan(-UNDER));
        expect(noseAt(posture)[1]).toBeGreaterThan(-2 * CM);
        expect(tailTipAt(posture)[1]).toBeGreaterThan(-1 * CM);
        // It stays as it lies for as long as it sleeps, and curls the other way on its other side.
        const later = posed('CurlSleep', SLEEP_HOLD + 30).posture;
        posture.at.forEach((at, i) => expect(apart(at, later.at[i])).toBeLessThan(1e-9));
        const left = RIG.solve(RIG.spec(still('CurlSleep', SLEEP_HOLD, 1)));
        const right = RIG.solve(RIG.spec(still('CurlSleep', SLEEP_HOLD, -1)));
        expect(noseAt(right)[0]).toBeCloseTo(-noseAt(left)[0], 9);
        expect(Math.abs(noseAt(left)[0])).toBeGreaterThan(0.05);
    });

    it('reaches the ground with every planted paw through all it does at a stop', () => {
        // A centimetre at the arctic fox's size is 1.6 cm of this one's. Two acts are let off
        // with more, for now: bowing in its stretch and digging, its hind legs are at full
        // reach and their paws ride a couple of centimetres above their marks.
        const REACH = 1 * CM * SAKURA_FOX_SIZE;
        const AT_FULL_REACH = { Stretch: 2.5 * CM, Dig: 2.5 * CM };
        const wrong = [];
        const worst = {};
        POSES.forEach((name) => {
            const most = AT_FULL_REACH[name] ?? REACH;
            let before = null;
            for (let t = 0; t <= RIG.lengths[name]; t += FRAME) {
                const { spec, posture } = posed(name, t);
                for (let leg = 0; leg < 4; leg++) {
                    if (!Number.isFinite(posture.short[leg])) wrong.push(`${name} at ${t.toFixed(2)}: no leg`);
                    if (planted(spec, leg)) {
                        worst[name] = Math.max(worst[name] ?? 0, posture.short[leg]);
                        if (posture.short[leg] > most) {
                            wrong.push(`${name} at ${t.toFixed(2)}: ${FOX_LEGS[leg][0]} ${posture.short[leg]} short`);
                        }
                    }
                }
                // And it moves through it: no bone snaps from one frame to the next.
                if (before) {
                    for (let i = 0; i < SAKURA_FOX_BONES.length; i++) {
                        const turned = turnBetween(before.world[i], posture.world[i]) / DEG;
                        const [bone] = SAKURA_FOX_BONES[i];
                        if (!(turned < 35)) wrong.push(`${name} at ${t.toFixed(2)}: ${bone} turns ${turned}°`);
                    }
                }
                before = posture;
            }
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        // Where it only stands, sits or lies, its legs reach with nothing to spare asked of them.
        ['Sit', 'Listen', 'Shake'].forEach((name) => expect(worst[name], name).toBeLessThan(0.5 * CM));
    });

    it('does not slide a paw in stance at any pace, at either fox\'s size', () => {
        const CYCLE = 240;
        const step = 0.37 / CYCLE;
        const wrong = [];
        [1, ...SAKURA_FOX_PAIR.map((plan) => plan.scale)].forEach((scale) => {
            const rig = createSakuraFoxRig(scale);
            const a = rig.createPosture();
            const b = rig.createPosture();
            // Paces of the world's (m/s): an amble, its trot, the run a chain sets it at, flat out.
            [0.4, 1, 2.2, 3.4, 4.6].forEach((speed) => {
                // (A stride of the drawn animal's, in the model's own metres.)
                const stride = rig.stride(speed) / rig.scale;
                const where = `scale ${scale}, ${speed} m/s`;
                let stance = 0;
                for (let i = 0; i < CYCLE; i++) {
                    const from = rig.gait(rig.createSpec(), i / CYCLE, speed, 1);
                    const to = rig.gait(rig.createSpec(), i / CYCLE + step, speed, 1);
                    rig.solve(from, a);
                    rig.solve(to, b);
                    for (let leg = 0; leg < 4; leg++) {
                        const dy = SPEC.feet + leg * FOOT.size + FOOT.dy;
                        // In stance at both moments, and reaching: the ground carries it back, exactly.
                        if (from[dy] === 0 && to[dy] === 0 && a.short[leg] < 1e-9 && b.short[leg] < 1e-9) {
                            stance += 1;
                            const pa = pawAt(rig, a, leg);
                            const pb = pawAt(rig, b, leg);
                            const slid = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2] + step * stride);
                            if (!(slid < 1e-9)) wrong.push(`${where}, ${FOX_LEGS[leg][0]}: slid ${slid}`);
                            if (!(Math.abs(pa[1]) < 1e-9)) wrong.push(`${where}: a paw off the ground`);
                        }
                        // A paw in stance is never left hanging by more than a hair.
                        if (from[dy] === 0 && a.short[leg] > 1 * CM) {
                            wrong.push(`${where}, ${FOX_LEGS[leg][0]}: ${a.short[leg]} short`);
                        }
                    }
                }
                // (Even flat out each paw is on the ground for a part of the cycle.)
                if (!(stance > CYCLE * 0.5)) wrong.push(`${where}: hardly a paw in stance (${stance})`);
            });
        });
        expect(wrong.slice(0, 5)).toEqual([]);
    });
});
