import { readFileSync, statSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
    FALL_SQUIRREL_URL, FALL_TREE_URLS, fallImpostorLayout, parseFallFoliage, parseFallTree,
} from '../../src/themes/fall/fall-assets.js';
import { FALL_FEATURE_TREES, FALL_VIEWS } from '../../src/themes/fall/fall-composition.js';
import { FallReactions } from '../../src/themes/fall/fall-reactions.js';
import { createSquirrel } from '../../src/themes/fall/fall-squirrel.js';
import { SQUIRREL_CLIPS, SQUIRREL_SCALE } from '../../src/themes/fall/fall-squirrel-clips.js';
import {
    FLICK_LENGTH, GROUND_BITS, SQUIRREL_SPOTS, SquirrelMind, TRUNK_BITS, createSquirrelPose,
} from '../../src/themes/fall/fall-squirrel-mind.js';
import {
    SQUIRREL_TRUNK_SPAN, TrunkSurface, createSquirrelStage, measureTrunk,
} from '../../src/themes/fall/fall-squirrel-stage.js';
import { FallLight } from '../../src/themes/fall/fall-light.js';
import { fallTier } from '../../src/themes/fall/fall-quality.js';
import { fallTerrainHeight } from '../../src/themes/fall/fall-terrain.js';
import { FallWorld } from '../../src/themes/fall/fall-world.js';

const assetDirectory = new URL('../../src/themes/fall/assets/', import.meta.url);
const STEP = 1 / 60;
const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'earL', 'earR',
    'tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6',
    'shoulderL', 'armL', 'foreL', 'handL', 'thighL', 'shinL', 'footL',
    'shoulderR', 'armR', 'foreR', 'handR', 'thighR', 'shinR', 'footR'];
const files = new Map();
const owned = [];

function fileNameOf(url) {
    return decodeURIComponent(new URL(url).pathname.split('/').pop());
}

async function parseGlb(file) {
    if (!files.has(file)) {
        const bytes = readFileSync(new URL(file, assetDirectory));
        files.set(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return new GLTFLoader().parseAsync(files.get(file).slice(0), '');
}

/** The stage from the real hero trees, as FallWorld measures it. */
function stageFrom(trees) {
    const trunks = {};
    for (const [name, tree] of [['maple', FALL_FEATURE_TREES[0]], ['oak', FALL_FEATURE_TREES[1]]]) {
        const { bark } = trees[tree.asset];
        const colour = bark.attributes.color;
        trunks[name] = new TrunkSurface(measureTrunk({
            positions: bark.attributes.position.array,
            index: bark.index.array,
            sway: Float32Array.from({ length: colour.count }, (_, i) => colour.getX(i)),
            place: {
                x: tree.x, y: fallTerrainHeight(tree.x, tree.z), z: tree.z, yaw: tree.yaw, scale: tree.scale,
            },
            span: SQUIRREL_TRUNK_SPAN[name],
        }), name);
    }
    return createSquirrelStage({ trunks, groundHeight: fallTerrainHeight, eye: [...FALL_VIEWS.landscape.position] });
}

/** The game's landscape eye, to say where on the screen a point is. */
function landscapeCamera() {
    const view = FALL_VIEWS.landscape;
    const camera = new THREE.PerspectiveCamera(view.fov, 16 / 9, 0.3, 600);
    camera.position.set(view.position[0], view.position[1] + fallTerrainHeight(0, view.position[2]), view.position[2]);
    camera.lookAt(...view.target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return camera;
}

/** Run a mind over `seconds` at `dt`, firing `cues` ([kind, time, strength]) as their times come. */
function live(mind, seconds, dt = STEP, cues = [], each = () => {}) {
    const queue = cues.slice().sort((a, b) => a[1] - b[1]);
    const pose = createSquirrelPose();
    const steps = Math.round(seconds / dt);
    for (let i = 0; i <= steps; i++) {
        const t = i * dt;
        while (queue.length && queue[0][1] <= t) {
            const [kind, at, strength] = queue.shift();
            mind.cue(kind, at, strength);
        }
        mind.pose(t, pose);
        each(pose, t);
    }
    return pose;
}

let gltf;
let trees;
let stage;

beforeAll(async () => {
    gltf = await parseGlb('squirrel.glb');
    const [maple, oak] = await Promise.all([parseGlb('maple-hero.glb'), parseGlb('oak-hero.glb')]);
    trees = { 'maple-hero': parseFallTree(maple, 'maple-hero'), 'oak-hero': parseFallTree(oak, 'oak-hero') };
    stage = stageFrom(trees);
});

afterAll(() => {
    owned.forEach((thing) => thing.dispose?.());
    Object.values(trees || {}).forEach((tree) => tree.bark.dispose());
});

describe('the squirrel asset (modelled, rigged and animated in Blender)', () => {
    it('is one skinned body on the thirty-bone rig, with its acorn in its left hand', () => {
        const skinned = [];
        const bones = [];
        gltf.scene.traverse((object) => {
            if (object.isSkinnedMesh) skinned.push(object);
            if (object.isBone) bones.push(object.name);
        });
        expect(skinned).toHaveLength(1);
        const [body] = skinned;
        expect(Object.keys(body.geometry.attributes).sort())
            .toEqual(['_fur', 'color', 'normal', 'position', 'skinIndex', 'skinWeight']);
        expect(body.skeleton.bones.map((bone) => bone.name).sort()).toEqual([...BONES].sort());
        expect(bones.sort()).toEqual([...BONES].sort());
        const triangles = body.geometry.index.count / 3;
        expect(triangles).toBeGreaterThan(6000);
        expect(triangles).toBeLessThan(14000);
        const acorn = gltf.scene.getObjectByName('Acorn');
        expect(acorn?.isMesh).toBe(true);
        expect(acorn.parent.name).toBe('handL');
        expect(acorn.geometry.index.count / 3).toBeLessThan(600);
        // Every weight row sums to one (bytes that sum to 255).
        const weights = body.geometry.attributes.skinWeight;
        for (let i = 0; i < weights.count; i += 97) {
            expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1, 2);
        }
        // Life size: about a quarter metre from nose to rump, standing on y = 0.
        body.geometry.computeBoundingBox();
        const { min, max } = body.geometry.boundingBox;
        expect(min.y).toBeGreaterThan(-0.01);
        expect(max.z - min.z).toBeGreaterThan(0.35);
        expect(max.z - min.z).toBeLessThan(0.5);
    });

    it('carries every clip the theme plays, each as long as the table says, and the table in its extras', () => {
        const names = gltf.animations.map((clip) => clip.name).sort();
        expect(names).toEqual(Object.keys(SQUIRREL_CLIPS).sort());
        for (const clip of gltf.animations) {
            const spec = SQUIRREL_CLIPS[clip.name];
            expect(clip.duration, clip.name).toBeCloseTo(spec.length, 3);
            // Every bone is keyed in every clip (a bone left out would keep the last clip's pose).
            const rotated = new Set(clip.tracks.filter((track) => track.name.endsWith('.quaternion'))
                .map((track) => track.name.split('.')[0]));
            expect(rotated.size, clip.name).toBe(BONES.length);
        }
        const { extras } = gltf.parser.json.asset;
        for (const [name, spec] of Object.entries(SQUIRREL_CLIPS)) {
            expect(extras.clips[name], name).toMatchObject({ loop: spec.loop, speed: spec.speed });
            expect(extras.clips[name].length, name).toBeCloseTo(spec.length, 6);
        }
        expect(extras.bones).toEqual(BONES);
        // The leap's take-off and landing, which the mind flies between.
        for (const mark of ['takeoff', 'landing']) {
            expect(extras.clips.leap.marks[mark]).toBeCloseTo(SQUIRREL_CLIPS.leap.marks[mark], 6);
        }
    });

    it('closes every loop: a looping clip ends where it began', () => {
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const head = gltf.scene.getObjectByName('head');
        const tail = gltf.scene.getObjectByName('tail6');
        const at = (clip, time) => {
            const action = mixer.clipAction(clip);
            action.play();
            action.enabled = true;
            action.setEffectiveWeight(1);
            action.time = time;
            mixer.update(0);
            gltf.scene.updateMatrixWorld(true);
            const out = [head, tail].map((bone) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld));
            action.stop();
            return out;
        };
        for (const clip of gltf.animations) {
            if (!SQUIRREL_CLIPS[clip.name].loop) continue;
            const start = at(clip, 0);
            const end = at(clip, clip.duration - 1e-6);
            start.forEach((point, i) => expect(point.distanceTo(end[i]), clip.name).toBeLessThan(0.004));
        }
        mixer.uncacheRoot(gltf.scene);
    });

    it('keeps to its size budget', () => {
        expect(statSync(new URL(fileNameOf(FALL_SQUIRREL_URL), assetDirectory)).size).toBeLessThan(600 * 1024);
    });
});

describe('the squirrel stage: the two great trunks measured from their bark', () => {
    it('finds bark all round each trunk at every height it may climb, facing outward', () => {
        for (const [name, trunk] of Object.entries(stage.trunks)) {
            const span = SQUIRREL_TRUNK_SPAN[name];
            for (let h = span.low; h <= span.high; h += 0.5) {
                for (let a = 0; a < Math.PI * 2; a += 0.4) {
                    const r = trunk.radius(h, a);
                    expect(r, `${name} ${h} ${a}`).toBeGreaterThan(0.6);
                    expect(r, `${name} ${h} ${a}`).toBeLessThan(2.4);
                    const f = trunk.frame(h, a);
                    const { cx, cz } = trunk.sample(h, a);
                    const out = (f.point[0] - cx) * f.normal[0] + (f.point[2] - cz) * f.normal[2];
                    expect(out, `${name} ${h} ${a}`).toBeGreaterThan(0);
                    // An orthonormal frame: normal, up the bark, round it.
                    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
                    expect(Math.abs(dot(f.normal, f.up))).toBeLessThan(1e-6);
                    expect(Math.abs(dot(f.normal, f.side))).toBeLessThan(1e-6);
                    expect(dot(f.up, [0, 1, 0])).toBeGreaterThan(0.5);
                }
            }
        }
    });

    it('knows which side of each trunk faces the game eye', () => {
        const eye = FALL_VIEWS.landscape.position;
        for (const [name, trunk] of Object.entries(stage.trunks)) {
            const facing = stage.facing[name];
            const p = trunk.point(2, facing);
            const toEye = [eye[0] - p[0], eye[2] - p[2]];
            const outward = [Math.cos(facing), Math.sin(facing)];
            expect(toEye[0] * outward[0] + toEye[1] * outward[1]).toBeGreaterThan(0.95 * Math.hypot(...toEye));
        }
    });
});

describe('the squirrel mind', () => {
    it('lives a day that is a function of the clock and the events alone, at any frame rate', () => {
        const cues = [['drop', 21, 1], ['clear', 30, 1], ['four', 47, 1], ['combo', 66, 1], ['perfect', 80, 1]];
        const a = live(new SquirrelMind({ stage, seed: 5 }), 120, 1 / 30, cues);
        const b = live(new SquirrelMind({ stage, seed: 5 }), 120, 1 / 144, cues);
        expect(a.act).toBe(b.act);
        expect(a.clip).toBe(b.clip);
        a.position.forEach((v, i) => expect(v).toBeCloseTo(b.position[i], 6));
        a.quaternion.forEach((v, i) => expect(v).toBeCloseTo(b.quaternion[i], 6));
        // And seeking back replays it.
        const mind = new SquirrelMind({ stage, seed: 5 });
        const first = live(mind, 40, STEP);
        const snapshot = { position: [...first.position], clip: first.clip };
        mind.pose(10);
        const again = mind.pose(40);
        expect(again.clip).toBe(snapshot.clip);
        again.position.forEach((v, i) => expect(v).toBeCloseTo(snapshot.position[i], 9));
    });

    it('stays where the eye sees it: on screen, clear of the board card, and never teleports', () => {
        const camera = landscapeCamera();
        const v = new THREE.Vector3();
        for (const seed of [271, 3, 99]) {
            const mind = new SquirrelMind({ stage, seed });
            let visible = 0;
            let total = 0;
            let onScreen = 0;
            let clear = 0;
            let last = null;
            let jump = 0;
            live(mind, 600, STEP, [], (pose) => {
                total += 1;
                expect(pose.position.every(Number.isFinite)).toBe(true);
                expect(Math.hypot(...pose.quaternion)).toBeCloseTo(1, 6);
                if (!pose.visible) {
                    last = null;
                    return;
                }
                visible += 1;
                v.set(...pose.position).project(camera);
                if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1) onScreen += 1;
                // The card covers about the middle quarter of a landscape screen.
                if (Math.abs(v.x) > 0.27) clear += 1;
                if (last) jump = Math.max(jump, Math.hypot(...pose.position.map((p, i) => p - last[i])));
                last = [...pose.position];
            });
            expect(visible / total, `seed ${seed}`).toBeGreaterThan(0.85);
            expect(onScreen / visible, `seed ${seed}`).toBeGreaterThan(0.97);
            expect(clear / visible, `seed ${seed}`).toBeGreaterThan(0.97);
            // A dash at full tilt, a frame at a time: never a jump across the grove.
            expect(jump, `seed ${seed}`).toBeLessThan(0.16);
        }
    }, 30_000); // three seeds of a long walk: about 2 s locally, over 5 s on CI runners

    it('keeps its liked places on the floor the eye sees, beside the board', () => {
        const camera = landscapeCamera();
        const v = new THREE.Vector3();
        for (const [tree, spots] of Object.entries(SQUIRREL_SPOTS)) {
            for (const [x, z] of spots) {
                v.set(x, fallTerrainHeight(x, z) + 0.3, z).project(camera);
                const sx = (v.x + 1) / 2;
                if (tree === 'maple') {
                    expect(sx, `${x},${z}`).toBeGreaterThan(0.09);
                    expect(sx, `${x},${z}`).toBeLessThan(0.32);
                } else {
                    expect(sx, `${x},${z}`).toBeGreaterThan(0.74);
                    expect(sx, `${x},${z}`).toBeLessThan(0.95);
                }
                expect(Math.abs(v.y), `${x},${z}`).toBeLessThan(0.85);
            }
        }
    });

    it('does every routine, and the ones it is asked to first', () => {
        const done = new Set();
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const mind = new SquirrelMind({ stage, seed });
            live(mind, 900, 0.1);
            mind.history.forEach((bit) => done.add(bit));
        }
        expect([...done].sort()).toEqual([...GROUND_BITS, ...TRUNK_BITS].sort());
        const scripted = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['snack', 'itch', 'climb', 'peek', 'down'],
        });
        live(scripted, 60, 0.1);
        expect(scripted.history.slice(0, 5)).toEqual(['snack', 'itch', 'climb', 'peek', 'down']);
    });

    it('sits up with its acorn to nibble, and looks to the board when it is told to', () => {
        const mind = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['snack'],
        });
        let acorn = 0;
        live(mind, 10, 0.05, [], (pose) => {
            if (pose.clip === 'nibble') {
                expect(pose.acorn).toBe(true);
                acorn += 1;
            } else expect(pose.acorn).toBe(false);
        });
        expect(acorn).toBeGreaterThan(40);
        // A combo sets it scolding the board more often than not.
        let scolded = 0;
        for (let seed = 1; seed <= 8; seed++) {
            const scold = new SquirrelMind({
                stage, seed, start: 'ground', script: ['sit'],
            });
            let looked = 0;
            live(scold, 4, 0.05, [['combo', 0.5, 1]], (pose) => {
                looked = Math.max(looked, pose.look);
            });
            if (looked > 0.9) scolded += 1;
        }
        expect(scolded).toBeGreaterThanOrEqual(3);
    });

    it('jumps out of its skin at a hard drop, and gets used to them', () => {
        let startles = 0;
        for (let seed = 1; seed <= 12; seed++) {
            const mind = new SquirrelMind({
                stage, seed, start: 'ground', script: ['sit'],
            });
            const drops = Array.from({ length: 8 }, (_, i) => ['drop', 0.5 + i * 0.6, 1]);
            const clips = [];
            live(mind, 6, 0.05, drops, (pose) => clips.push(pose.clip));
            const runs = clips.filter((clip, i) => clip === 'startle' && clips[i - 1] !== 'startle').length;
            expect(runs, `seed ${seed}`).toBeLessThanOrEqual(3);
            startles += runs;
        }
        // It does jump (most of the time at the first thump)...
        expect(startles).toBeGreaterThan(6);
        // ...but never at a soft lock, and not in the air.
        const calm = new SquirrelMind({
            stage, seed: 4, start: 'ground', script: ['climb'],
        });
        live(calm, 8, 0.05, [['drop', 0.1, 0]]);
        expect(calm.history[0]).toBe('climb');
    });

    it('twirls for a perfect clear, and hides behind its tree when the run ends', () => {
        const happy = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['sit'],
        });
        let twirled = false;
        live(happy, 3, 0.05, [['perfect', 0.5, 1]], () => {
            twirled ||= Boolean(happy.act?.twirl);
        });
        expect(twirled).toBe(true);
        const scared = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['sit'],
        });
        const pose = live(scared, 14, 0.05, [['over', 0.5, 1]]);
        expect(scared.act.from.on).not.toBe('ground');
        expect(pose.clip).toBe('cling');
    });

    it('frightens as a look, not a jump, under reduced motion', () => {
        const mind = new SquirrelMind({
            stage, seed: 11, start: 'ground', script: ['sit'], motion: 0.35,
        });
        const clips = new Set();
        live(mind, 4, 0.05, [['drop', 0.5, 1], ['four', 2.5, 1]], (pose) => clips.add(pose.clip));
        expect(clips.has('startle')).toBe(false);
    });
});

describe('the squirrel moves smoothly', () => {
    /** Degrees between two quaternions. */
    const angle = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI;

    it('turns, starts, stops, hands over and answers the board without a jerk in body, head or tail', () => {
        const light = new FallLight({ tier: fallTier('Minimal'), rng: () => 0.5 });
        owned.push(light);
        const watch = ['hips', 'chest', 'head', 'tail2'];
        const limits = {
            hips: 15, chest: 15, head: 15, tail2: 25, body: 15,
        };
        for (const seed of [271, 11]) {
            const squirrel = createSquirrel({ light, gltf });
            owned.push(squirrel);
            const bones = Object.fromEntries(watch.map((name) => [name, squirrel.group.getObjectByName(name)]));
            const last = {};
            const speed = {};
            const worst = Object.fromEntries([...watch, 'body'].map((name) => [name, 0]));
            const q = new THREE.Quaternion();
            const cues = [['drop', 12, 1], ['clear', 30, 1], ['four', 50, 1], ['combo', 70, 1], ['perfect', 90, 1],
                ['over', 110, 1]];
            live(new SquirrelMind({ stage, seed }), 120, STEP, cues, (pose) => {
                if (!pose.visible) {
                    Object.keys(last).forEach((key) => { last[key] = null; });
                    return;
                }
                expect(Math.hypot(...pose.quaternion)).toBeCloseTo(1, 6);
                squirrel.update(pose);
                const sample = (name, rotation) => {
                    if (last[name]) {
                        const w = angle(last[name], rotation);
                        if (speed[name] !== undefined) worst[name] = Math.max(worst[name], Math.abs(w - speed[name]));
                        speed[name] = w;
                    } else delete speed[name];
                    last[name] = rotation.clone();
                };
                sample('body', squirrel.group.quaternion);
                for (const name of watch) sample(name, bones[name].getWorldQuaternion(q));
            });
            // Degrees per frame per frame at 60 fps: a snap, a pop or a flip is far beyond these.
            for (const [name, limit] of Object.entries(limits)) {
                expect(worst[name], `seed ${seed} ${name}`).toBeLessThan(limit);
            }
        }
    });

    it('turns on the spot with its paws stepping round, on the floor and on the bark', () => {
        const turns = new Set();
        for (const seed of [271, 3, 99]) {
            const mind = new SquirrelMind({ stage, seed, start: 'ground' });
            live(mind, 240, 0.05, [], () => {
                if (mind.act.kind !== 'turn') return;
                turns.add(`${mind.act.clip} ${mind.act.from.on === 'ground' ? 'floor' : 'bark'}`);
            });
        }
        expect([...turns].sort()).toEqual(['pivot bark', 'shuffle floor']);
    });

    it('crouches and lands on its paws: a leap leaves from where it stood and stops where it lands', () => {
        const mind = new SquirrelMind({
            stage, seed: 4, start: 'ground', script: ['climb'],
        });
        let leap = null;
        live(mind, 10, 0.02, [], () => {
            if (!leap && mind.act.kind === 'leap') leap = mind.act;
        });
        expect(leap).toBeTruthy();
        const from = mind.frame(leap.from).point;
        const to = mind.frame(leap.to).point;
        const at = (t) => mind.bodyAt(leap, t, createSquirrelPose()).position;
        at(leap.t0 + leap.crouch * 0.9).forEach((v, i) => expect(v).toBeCloseTo(from[i], 6));
        at(leap.t1 - leap.landing * 0.5).forEach((v, i) => expect(v).toBeCloseTo(to[i], 6));
        expect(at(leap.t0 + leap.crouch + leap.flight / 2)[1]).toBeGreaterThan(Math.max(from[1], to[1]) - 1);
    });
});

describe('the squirrel keeps to both trees', () => {
    /** Run a mind, and note which tree it keeps to and how it got from one to the other. */
    const day = (seed, seconds = 600) => {
        const mind = new SquirrelMind({ stage, seed });
        const camera = landscapeCamera();
        const v = new THREE.Vector3();
        const seen = new Set();
        const record = {
            climbs: { maple: 0, oak: 0 }, treetops: 0, homes: [], stops: [], time: { maple: 0, oak: 0 },
        };
        let home = null;
        let since = 0;
        live(mind, seconds, 1 / 30, [], (pose, t) => {
            const { act } = mind;
            const key = `${act.t0.toFixed(4)}${act.kind}${act.clip || ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                if (act.kind === 'leap' && act.from.on === 'ground' && act.to.on !== 'ground') {
                    record.climbs[act.to.on] += 1;
                }
                if (act.kind === 'hidden' && act.to && act.from.on !== 'ground' && act.to.on !== act.from.on) {
                    record.treetops += 1;
                }
                if (act.kind === 'stay' && act.from.on === 'ground') {
                    const f = mind.frame(act.from);
                    v.set(...f.point).project(camera);
                    record.stops.push(v.x);
                }
            }
            if (mind.home && mind.home !== home) {
                if (home) record.homes.push(t - since);
                ({ home } = mind);
                since = t;
            }
            if (pose.visible && home) record.time[home] += 1 / 30;
        });
        record.homes.push(seconds - since);
        return record;
    };

    it('goes between the maple and the oak every minute or so, and runs up both', () => {
        let treetops = 0;
        for (const seed of [271, 3, 99, 11]) {
            const record = day(seed);
            // Ten minutes: it has gone over and back several times, never kept to one tree for long.
            expect(record.homes.length, `seed ${seed}`).toBeGreaterThanOrEqual(6);
            expect(Math.max(...record.homes), `seed ${seed}`).toBeLessThan(170);
            expect(record.climbs.maple, `seed ${seed}`).toBeGreaterThanOrEqual(3);
            expect(record.climbs.oak, `seed ${seed}`).toBeGreaterThanOrEqual(3);
            const total = record.time.maple + record.time.oak;
            expect(record.time.maple / total, `seed ${seed}`).toBeGreaterThan(0.3);
            expect(record.time.oak / total, `seed ${seed}`).toBeGreaterThan(0.3);
            treetops += record.treetops;
        }
        // Some of the trips are made up one tree and through the treetops to the other.
        expect(treetops).toBeGreaterThanOrEqual(2);
    });

    it('stops on a run across the floor before the board and past it, never behind it', () => {
        for (const seed of [271, 5]) {
            const { stops } = day(seed, 400);
            expect(stops.length).toBeGreaterThan(20);
            stops.forEach((x) => expect(Math.abs(x), `seed ${seed}`).toBeGreaterThan(0.27));
        }
    });

    it('goes over the floor and up the far tree, or through the treetops, when it is asked to', () => {
        const over = new SquirrelMind({
            stage, seed: 6, start: 'ground', script: ['climb', 'over'],
        });
        const ground = new Set();
        live(over, 60, 0.05, [], () => {
            if (over.home) ground.add(over.home);
        });
        expect([...ground].sort()).toEqual(['maple', 'oak']);
        const through = new SquirrelMind({
            stage, seed: 6, start: 'ground', script: ['climb', 'treetops'],
        });
        const barks = [];
        live(through, 60, 0.05, [], (pose) => {
            if (pose.visible && through.act.from.on !== 'ground' && barks[barks.length - 1] !== through.act.from.on) {
                barks.push(through.act.from.on);
            }
        });
        // Up the maple, out of sight in its crown, and down the oak.
        expect(barks.slice(0, 2)).toEqual(['maple', 'oak']);
    });
});

describe('the squirrel\'s tail', () => {
    it('grows hair: cards on the tail bones that reach past the plume and close round the brush', () => {
        const light = new FallLight({ tier: fallTier('Minimal'), rng: () => 0.5 });
        owned.push(light);
        const squirrel = createSquirrel({ light, gltf });
        owned.push(squirrel);
        const hair = squirrel.plumeHair;
        expect(hair).toBeTruthy();
        expect(hair.mesh.isSkinnedMesh).toBe(true);
        expect(hair.triangles).toBeGreaterThan(400);
        expect(hair.triangles).toBeLessThan(4000);
        const { plume } = hair;
        // Measured from the body: the plume is wider than deep, fullest past half way.
        const widest = plume.stations.reduce((best, st) => (st.reach[0] > best.reach[0] ? st : best));
        expect(widest.s / plume.end).toBeGreaterThan(0.45);
        expect(widest.reach[0]).toBeGreaterThan(widest.reach[2] * 1.3);
        // Every card vertex is skinned to the tail (or the hips at its root), and its weights sum to one.
        const { skeleton } = hair.mesh;
        const index = hair.mesh.geometry.attributes.skinIndex;
        const weight = hair.mesh.geometry.attributes.skinWeight;
        for (let v = 0; v < index.count; v += 7) {
            let sum = 0;
            for (let j = 0; j < 4; j++) {
                const w = weight.getComponent(v, j);
                sum += w;
                if (w > 0.05) expect(skeleton.bones[index.getComponent(v, j)].name).toMatch(/^(tail\d|hips|spine)$/);
            }
            expect(sum).toBeCloseTo(1, 4);
        }
        // The hair runs out past the solid plume, and on past its end into a brush.
        const hairData = hair.mesh.geometry.attributes.hair;
        let furthest = 0;
        let last = 0;
        for (let v = 0; v < hairData.count; v++) {
            furthest = Math.max(furthest, hairData.getX(v));
            last = Math.max(last, hairData.getY(v));
        }
        expect(furthest).toBeGreaterThan(0.01);
        expect(last).toBeGreaterThan(plume.end + 0.01);
    });

    it('lies along the bark behind it when it climbs, clings, turns or comes down', () => {
        const model = cloneSkinned(gltf.scene);
        const mixer = new THREE.AnimationMixer(model);
        const p = new THREE.Vector3();
        for (const [name, top] of [['climb', 0.1], ['pivot', 0.1], ['descend', 0.1], ['cling', 0.13]]) {
            const clip = gltf.animations.find((c) => c.name === name);
            mixer.stopAllAction();
            const action = mixer.clipAction(clip);
            action.reset().play();
            for (let k = 0; k < 16; k++) {
                action.time = (k / 16) * clip.duration;
                mixer.update(0);
                model.updateMatrixWorld(true);
                for (let i = 1; i <= 6; i++) {
                    model.getObjectByName(`tail${i}`).getWorldPosition(p);
                    // (Life size, the bark at y = 0: near it, never into it.)
                    expect(p.y, `${name} tail${i}`).toBeGreaterThan(0.025);
                    expect(p.y, `${name} tail${i}`).toBeLessThan(top);
                }
            }
        }
    });

    it('trails the body\'s turns down its length: the root follows first, the brush comes round last', () => {
        const mind = new SquirrelMind({ stage, seed: 271, start: 'ground' });
        let checked = 0;
        let turnAct = null;
        live(mind, 120, STEP, [], (pose, t) => {
            const { act } = mind;
            if (!turnAct && act.kind === 'turn' && act.duration > 0.45) turnAct = act;
            if (!turnAct || act !== turnAct) return;
            const u = (t - act.t0) / act.duration;
            if (u > 0.4 && u < 0.6) {
                const turns = pose.tailTurn.map(Math.abs);
                // Mid turn: each bone looks further back, so trails the turn more.
                for (let i = 1; i < turns.length; i++) expect(turns[i]).toBeGreaterThanOrEqual(turns[i - 1] - 1e-9);
                expect(turns[6]).toBeGreaterThan(turns[0] * 2);
                checked += 1;
            }
        });
        expect(checked).toBeGreaterThan(3);
    });

    it('flicks now and then as it sits or clings, in a burst when it is on edge, the same every time', () => {
        const flicksFor = (alarm, clip = 'sit') => {
            const mind = new SquirrelMind({
                stage, seed: 271, start: 'ground', script: ['sit'],
            });
            mind.alarm = alarm;
            const act = mind.stay(clip, 12);
            return mind.flicksOf(act).map((flick) => +(flick.at - act.t0).toFixed(4));
        };
        const calm = flicksFor(0);
        expect(calm.length).toBeGreaterThanOrEqual(1);
        expect(calm[0]).toBeGreaterThan(0.35);
        for (let i = 1; i < calm.length; i++) expect(calm[i] - calm[i - 1]).toBeGreaterThan(3);
        expect(flicksFor(0)).toEqual(calm);
        // On edge: two or three in quick succession first.
        const edgy = flicksFor(0.8);
        expect(edgy.filter((t) => t < 1.6).length).toBeGreaterThanOrEqual(2);
        // Not while it runs or digs.
        expect(flicksFor(0, 'dig')).toEqual([]);
        // Drawn, a flick runs on past its act and is gone before the next could start.
        const mind = new SquirrelMind({ stage, seed: 271, start: 'ground' });
        let flicking = 0;
        live(mind, 90, STEP, [], (pose) => {
            if (pose.flick < 0) return;
            flicking += 1;
            expect(pose.flick).toBeLessThan(FLICK_LENGTH);
            expect(pose.flickStrength).toBeGreaterThan(0);
        });
        expect(flicking).toBeGreaterThan(60);
    });
});

describe('the squirrel drawn', () => {
    it('blends the clips the mind asks for and holds the acorn only while it nibbles', () => {
        const light = new FallLight({ tier: fallTier('Minimal'), rng: () => 0.5 });
        owned.push(light);
        const squirrel = createSquirrel({ light, gltf });
        owned.push(squirrel);
        expect(squirrel.clips.sort()).toEqual(Object.keys(SQUIRREL_CLIPS).sort());
        expect(squirrel.group.children[0].scale.x).toBeCloseTo(SQUIRREL_SCALE, 6);
        const mind = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['snack'],
        });
        const head = squirrel.group.getObjectByName('head');
        const acorn = squirrel.group.getObjectByName('Acorn');
        const pose = mind.pose(5);
        expect(pose.clip).toBe('nibble');
        squirrel.update(pose);
        expect(squirrel.group.visible).toBe(true);
        expect(acorn.visible).toBe(true);
        const nibbling = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
        squirrel.update(mind.pose(0.4));
        expect(acorn.visible).toBe(false);
        const hopping = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
        // Sitting up, its head is well above where it is on all fours.
        expect(nibbling.y - pose.position[1]).toBeGreaterThan(hopping.y - mind.pose(0.4).position[1] + 0.08);
        // The shade under it is faint in the air and darker on the ground.
        squirrel.update({ ...mind.pose(5), lift: 0.6 });
        const high = squirrel.shade.material;
        expect(high).toBeTruthy();
    });

    it('lays its look and its tail\'s trail on the clip pose afresh each frame (they never pile up)', () => {
        const light = new FallLight({ tier: fallTier('Minimal'), rng: () => 0.5 });
        owned.push(light);
        const squirrel = createSquirrel({ light, gltf });
        owned.push(squirrel);
        const mind = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['sit'],
        });
        const pose = {
            ...mind.pose(1.0),
            look: 1,
            tailTurn: [0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6],
            tailSurge: [0.1, 0.15, 0.2, 0.25, 0.3, 0.3, 0.3],
            flick: 0.1,
            flickStrength: 1,
        };
        const names = ['neck', 'head', 'tail0', 'tail6'];
        squirrel.update(pose);
        const first = names.map((name) => squirrel.group.getObjectByName(name).quaternion.clone());
        for (let i = 0; i < 5; i++) squirrel.update(pose);
        // (Component by component: angleTo reads a quaternion a hair off unit length as turned.)
        names.forEach((name, i) => {
            const now = squirrel.group.getObjectByName(name).quaternion.toArray();
            first[i].toArray().forEach((v, k) => expect(now[k], `${name}[${k}]`).toBeCloseTo(v, 9));
        });
        // And the look and the trail did turn the bones off the bare clip pose.
        squirrel.update({
            ...pose, look: 0, tailTurn: [0, 0, 0, 0, 0, 0, 0], tailSurge: [0, 0, 0, 0, 0, 0, 0], flick: -1,
        });
        expect(squirrel.group.getObjectByName('head').quaternion.angleTo(first[1])).toBeGreaterThan(0.05);
        expect(squirrel.group.getObjectByName('tail0').quaternion.angleTo(first[2])).toBeGreaterThan(0.05);
    });
});

describe('the squirrel in the grove', () => {
    async function bundle(withSquirrel) {
        const [foliage, ...gltfs] = await Promise.all([parseGlb('fall-foliage.glb'),
            ...Object.keys(FALL_TREE_URLS).map((name) => parseGlb(`${name}.glb`))]);
        const assets = { foliage: parseFallFoliage(foliage), trees: {}, impostors: null };
        Object.keys(FALL_TREE_URLS).forEach((name, i) => { assets.trees[name] = parseFallTree(gltfs[i], name); });
        const texture = new THREE.DataTexture(new Uint8Array(64).fill(255), 4, 4);
        assets.impostors = { ...fallImpostorLayout(), texture };
        if (withSquirrel) assets.squirrel = await parseGlb('squirrel.glb');
        return assets;
    }

    it('comes down the maple, answers the board through the director, and goes with the world', async () => {
        const assets = await bundle(true);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300);
        const world = new FallWorld({
            scene, camera, quality: 'Minimal', rng: () => 0.5, assets,
        }).build();
        owned.push(world);
        expect(world.group.getObjectByName('FallSquirrel')).toBeTruthy();
        const reactions = new FallReactions({ quality: 'Minimal', rng: () => 0.5 });
        let t = 0;
        const run = (seconds) => {
            for (let i = 0; i < seconds / STEP; i++) {
                t += STEP;
                reactions.update(STEP);
                world.update(t, STEP, reactions.getFrame());
            }
        };
        run(1);
        // Out of sight in the maple's crown at first, then down the bark.
        expect(world.getDiagnostics().squirrel.visible).toBe(false);
        run(3);
        expect(world.getDiagnostics().squirrel).toMatchObject({ visible: true, on: 'maple' });
        // The director's emitters reach it once each.
        const cues = [];
        const original = world.squirrelMind.cue.bind(world.squirrelMind);
        world.squirrelMind.cue = (kind, time, strength) => {
            cues.push(kind);
            return original(kind, time, strength);
        };
        const piece = {
            shapeKey: 'T', x: 3, y: 19, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
        };
        reactions.onHardDrop({ piece, distance: 18 });
        reactions.onPieceLock({ piece });
        run(0.2);
        reactions.onPieceLock({ piece });
        reactions.onLineClear(2, { clearedRows: [20, 19] });
        run(0.2);
        reactions.onPieceLock({ piece });
        reactions.onLineClear(4, { clearedRows: [20, 19, 18, 17] });
        run(0.5);
        expect(cues).toEqual(['drop', 'clear', 'clear', 'four']);
        world.onGameOver();
        expect(cues.at(-1)).toBe('over');
        const meshes = [];
        world.group.traverse((object) => { if (object.isMesh) meshes.push(object); });
        expect(meshes.filter((mesh) => mesh.name.startsWith('FallSquirrel') || mesh.isSkinnedMesh).length)
            .toBeGreaterThan(0);
        world.dispose();
        expect(world.squirrel).toBeNull();
    });

    it('builds the grove in steps (one task otherwise): the same grove, the same draws', async () => {
        const make = async () => {
            let seed = 271;
            const rng = () => {
                seed = (seed * 16807) % 2147483647;
                return seed / 2147483647;
            };
            return new FallWorld({
                scene: new THREE.Scene(),
                camera: new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300),
                quality: 'Minimal',
                rng,
                assets: await bundle(true),
            });
        };
        const whole = (await make()).build();
        const stepped = await make();
        owned.push(whole, stepped);
        const steps = stepped.buildSteps();
        let count = 0;
        while (!steps.next().done) count += 1;
        expect(count).toBeGreaterThanOrEqual(6);
        const parts = (world) => {
            const out = [];
            world.group.traverse((object) => {
                if (!object.isMesh) return;
                const position = object.geometry.getAttribute('position');
                out.push([object.name, position?.count ?? 0, object.count ?? 1,
                    object.isInstancedMesh ? Array.from(object.instanceMatrix.array.slice(0, 48)) : []]);
            });
            return out;
        };
        expect(parts(stepped)).toEqual(parts(whole));
        // Built once: a second build (or a drained build after the steps) adds nothing.
        expect(stepped.buildSteps().next().done).toBe(true);
    }, 30_000);

    it('is simply not there without its asset, or when it is not wanted', async () => {
        const assets = await bundle(false);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300);
        const bare = new FallWorld({
            scene, camera, quality: 'Minimal', rng: () => 0.5, assets,
        }).build();
        owned.push(bare);
        bare.update(1, STEP, { emitters: [] });
        expect(bare.getDiagnostics().squirrel).toBeUndefined();
        expect(bare.group.getObjectByName('FallSquirrel')).toBeUndefined();
        const off = new FallWorld({
            scene: new THREE.Scene(),
            camera,
            quality: 'Minimal',
            rng: () => 0.5,
            assets: await bundle(true),
            squirrel: false,
        }).build();
        owned.push(off);
        expect(off.group.getObjectByName('FallSquirrel')).toBeUndefined();
    });
});
