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
import perchData from '../../src/themes/fall/assets/squirrel-perches.json';
import { createSquirrel, createSquirrelSteps } from '../../src/themes/fall/fall-squirrel.js';
import { FUR_SHELLS, createFurShells } from '../../src/themes/fall/fall-squirrel-fur.js';
import { SQUIRREL_CLIPS, SQUIRREL_SCALE } from '../../src/themes/fall/fall-squirrel-clips.js';
import { createPerches } from '../../src/themes/fall/fall-squirrel-limbs.js';
import {
    FLICK_LENGTH, GROUND_BITS, LIMB_BITS, PAD_BITS, POST_BITS, SQUIRREL_NEAR_SPOTS, SQUIRREL_SPOTS, SquirrelMind,
    TRUNK_BITS, createSquirrelPose,
} from '../../src/themes/fall/fall-squirrel-mind.js';
import {
    SQUIRREL_TRUNK_SPAN, TrunkSurface, createSquirrelStage, measureTrunk,
} from '../../src/themes/fall/fall-squirrel-stage.js';
import { FallLight } from '../../src/themes/fall/fall-light.js';
import { fallTier } from '../../src/themes/fall/fall-quality.js';
import { fallTerrainHeight } from '../../src/themes/fall/fall-terrain.js';
import { FallWorld } from '../../src/themes/fall/fall-world.js';
import { drainSteps } from '../../src/themes/shared/build-steps.js';

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

/** The stage from the real hero trees and the perches, as FallWorld measures and places them. */
function stageFrom(trees, { perches = true } = {}) {
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
    const eye = [...FALL_VIEWS.landscape.position];
    const { limbs, pads } = perches
        ? createPerches({ placements: FALL_FEATURE_TREES, groundHeight: fallTerrainHeight, eye })
        : { limbs: {}, pads: [] };
    return createSquirrelStage({
        trunks, groundHeight: fallTerrainHeight, eye, limbs, pads,
    });
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

const clamp01 = (value) => Math.max(0, Math.min(1, value));

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

/**
 * A mind standing at `place` (on the floor, a trunk, a limb or a flat perch), its next routine planned
 * there with `script` first: how a test puts it where no opening of the day does.
 */
function mindAt(place, { seed = 8, script = [] } = {}) {
    const mind = new SquirrelMind({ stage, seed, start: 'ground' });
    Object.assign(mind, {
        act: null, prev: null, recent: [], queue: [], history: [], time: 0, scripted: script.slice(),
    });
    mind.tail = { time: 0, place };
    mind.plan();
    mind.act = mind.queue.shift();
    return mind;
}

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
            let stride = 0;
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
                if (last) {
                    const step = Math.hypot(...pose.position.map((p, i) => p - last[i]));
                    if (mind.act.kind === 'leap') jump = Math.max(jump, step);
                    else stride = Math.max(stride, step);
                }
                last = [...pose.position];
            });
            expect(visible / total, `seed ${seed}`).toBeGreaterThan(0.85);
            expect(onScreen / visible, `seed ${seed}`).toBeGreaterThan(0.97);
            expect(clear / visible, `seed ${seed}`).toBeGreaterThan(0.97);
            // A dash at full tilt, a frame at a time (a bound at 1.1 m/s life size, drawn 4x, hurried by a
            // quarter: 0.09 m), and a leap's flight (down two metres from the windfall's dead limb it lands
            // at about 12 m/s: 0.2 m): never a jump across the grove.
            expect(stride, `seed ${seed}`).toBeLessThan(0.12);
            expect(jump, `seed ${seed}`).toBeLessThan(0.25);
        }
    }, 30_000); // three seeds of a long walk: about 2 s locally, over 5 s on CI runners

    it('walks only the part of a limb the frame holds, and lands on a limb only there', () => {
        const camera = landscapeCamera();
        const v = new THREE.Vector3();
        // Every place it may stand on a limb is on the screen (its middle, a little off the bark).
        for (const limb of Object.values(stage.limbs)) {
            for (let a = limb.low; a <= limb.high + 1e-9; a += 0.1) {
                const f = limb.frame(a, 0);
                v.set(...f.point.map((p, i) => p + f.normal[i] * 0.3)).project(camera);
                expect(Math.abs(v.x), `${limb.name} ${a.toFixed(1)}`).toBeLessThan(0.93);
                expect(Math.abs(v.y), `${limb.name} ${a.toFixed(1)}`).toBeLessThan(0.93);
            }
        }
        // And every act it does on one starts and ends there (a leap down a dead limb onto the log it
        // grows from lands on the log's walked part, not past its end).
        const placesOnLimbs = (seed) => {
            const { limbs } = stage;
            const mind = new SquirrelMind({ stage, seed });
            const seen = new Set();
            let count = 0;
            live(mind, 600, 0.05, [], () => {
                const { act } = mind;
                if (seen.has(act)) return;
                seen.add(act);
                for (const place of [act.from, act.to]) {
                    const limb = place && limbs[place.on];
                    if (!limb) continue;
                    count += 1;
                    expect(place.a, `seed ${seed} ${act.kind} on ${limb.name}`).toBeGreaterThanOrEqual(limb.low - 1e-9);
                    expect(place.a, `seed ${seed} ${act.kind} on ${limb.name}`).toBeLessThanOrEqual(limb.high + 1e-9);
                }
            });
            return count;
        };
        const onLimbs = [3, 271, 99, 11].reduce((sum, seed) => sum + placesOnLimbs(seed), 0);
        expect(onLimbs).toBeGreaterThan(200);
    }, 30_000);

    it('opens its day where the seed says (a crown, the floor, a perch, a bough), never where there is none', () => {
        /** Where a mind's day opens, by name. */
        const opening = (mind) => {
            const { act } = mind;
            const { from } = act;
            if (act.kind === 'hidden') return `crown ${from.on}`;
            if (from.on === 'ground') return from.pad ? `pad ${from.pad}` : `floor ${mind.nearestTree(from)}`;
            return `${stage.limbs[from.on] ? 'limb' : 'bark'} ${from.on}`;
        };
        // Drawn from the seed: many openings over the seeds, the same one for the same seed.
        const drawn = new Set();
        for (let seed = 1; seed <= 40; seed++) {
            const name = opening(new SquirrelMind({ stage, seed, start: 'any' }));
            expect(opening(new SquirrelMind({ stage, seed, start: 'any' }))).toBe(name);
            drawn.add(name);
        }
        expect(drawn.size).toBeGreaterThanOrEqual(6);
        expect([...drawn].some((name) => name.startsWith('pad'))).toBe(true);
        expect([...drawn].some((name) => name.startsWith('limb'))).toBe(true);
        // Each asked for by name.
        const bough = Object.values(stage.limbs).find((limb) => !limb.dead && !limb.standing);
        expect(bough).toBeTruthy();
        const asked = (start, on = stage) => opening(new SquirrelMind({ stage: on, seed: 9, start }));
        expect(asked('crown')).toBe('crown maple');
        expect(asked('crown-oak')).toBe('crown oak');
        expect(asked('ground')).toBe('floor maple');
        expect(asked('ground-oak')).toBe('floor oak');
        expect(asked('stump')).toBe('pad stump.top');
        expect(asked('windfall')).toBe('limb windfall.trunk');
        expect(asked('bough')).toBe(`limb ${bough.name}`);
        // A grove whose perches did not arrive: a perch asked for opens on the floor, and none is drawn.
        const bare = stageFrom(trees, { perches: false });
        for (const start of ['stump', 'windfall', 'bough']) expect(asked(start, bare)).toMatch(/^floor /);
        for (let seed = 1; seed <= 30; seed++) {
            expect(opening(new SquirrelMind({ stage: bare, seed, start: 'any' }))).toMatch(/^(crown|floor) /);
        }
    });

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
        // Every routine of the floor, the great trunks, a limb and a flat perch, and nothing but routines
        // (a dead limb standing up is only planned from when an answer to the board stops a climb up it).
        for (const bit of new Set([...GROUND_BITS, ...TRUNK_BITS, ...LIMB_BITS, ...PAD_BITS])) {
            expect(done.has(bit), bit).toBe(true);
        }
        const routines = new Set([...GROUND_BITS, ...TRUNK_BITS, ...LIMB_BITS, ...PAD_BITS, ...POST_BITS]);
        done.forEach((bit) => expect(routines.has(bit), bit).toBe(true));
        const scripted = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['snack', 'itch', 'climb', 'peek', 'down'],
        });
        live(scripted, 60, 0.1);
        expect(scripted.history.slice(0, 5)).toEqual(['snack', 'itch', 'climb', 'peek', 'down']);
    });

    it('does a routine it is asked to wherever it can be done there, and passes over one that cannot', () => {
        /** A mind standing at `place`, planning its next routine with `script` first. */
        const planned = (place, script) => {
            const mind = new SquirrelMind({ stage, seed: 8, start: 'ground' });
            Object.assign(mind, {
                act: null, prev: null, recent: [], queue: [], history: [], time: 0, scripted: script.slice(),
            });
            mind.tail = { time: 0, place };
            mind.plan();
            mind.act = mind.queue.shift();
            return mind;
        };
        const places = [];
        for (const [x, z] of [...SQUIRREL_SPOTS.maple.slice(0, 2), ...SQUIRREL_NEAR_SPOTS.oak.slice(0, 1)]) {
            places.push([{
                on: 'ground', a: x, b: z, heading: 0,
            }, GROUND_BITS, 'sit']);
        }
        for (const tree of Object.keys(stage.trunks)) {
            places.push([{
                on: tree, a: 2, b: stage.facing[tree], heading: 0,
            }, TRUNK_BITS, 'look']);
        }
        for (const limb of Object.values(stage.limbs)) {
            const place = {
                on: limb.name, a: (limb.low + limb.high) / 2, b: 0, heading: 0,
            };
            places.push(limb.standing ? [place, POST_BITS, 'cling'] : [place, LIMB_BITS, 'rest']);
        }
        for (const pad of stage.pads) {
            places.push([{
                on: 'ground', a: pad.centre[0], b: pad.centre[2], heading: 0, pad: pad.name,
            }, PAD_BITS, 'watch']);
        }
        const honoured = new Set();
        for (const [place, bits, fallback] of places) {
            for (const bit of bits) {
                const mind = planned(place, [bit, fallback]);
                const where = `${bit} at ${place.pad || place.on}`;
                expect([bit, fallback], where).toContain(mind.history[0]);
                if (mind.history[0] === bit) honoured.add(bit);
                // And what it planned plays: a few seconds of it, every pose real.
                live(mind, 8, 0.05, [], (pose) => {
                    expect(pose.position.every(Number.isFinite), where).toBe(true);
                });
            }
        }
        // Each routine could be asked for somewhere (a limb's leap to another limb is the pads' leap here).
        expect([...honoured].sort()).toEqual([...new Set([...GROUND_BITS, ...TRUNK_BITS, ...LIMB_BITS, ...PAD_BITS,
            ...POST_BITS])].sort());
    }, 30_000);

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
        // Two days as they come, and three on its perches: up the windfall's dead limb and from seat to
        // seat, the stump and its leaning bough, stretched out along the oak's bough.
        const days = [
            { seed: 271 }, { seed: 11 },
            { seed: 5, start: 'windfall', script: ['lookout', 'top', 'watch', 'across', 'meal', 'off'] },
            { seed: 6, start: 'stump', script: ['watch', 'across', 'wash', 'off', 'perch', 'tip'] },
            { seed: 7, start: 'bough', script: ['loaf', 'run', 'meal', 'back'] },
        ];
        for (const { seed, start, script } of days) {
            const squirrel = createSquirrel({ light, gltf });
            owned.push(squirrel);
            const bones = Object.fromEntries(watch.map((name) => [name, squirrel.group.getObjectByName(name)]));
            const last = {};
            const speed = {};
            const worst = Object.fromEntries([...watch, 'body'].map((name) => [name, 0]));
            const q = new THREE.Quaternion();
            const cues = [['drop', 12, 1], ['clear', 30, 1], ['four', 50, 1], ['combo', 70, 1], ['perfect', 90, 1],
                ['over', 110, 1]];
            const played = new Set();
            live(new SquirrelMind({
                stage, seed, start, script,
            }), 120, STEP, cues, (pose) => {
                played.add(pose.clip);
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
                expect(worst[name], `seed ${seed} ${start || ''} ${name}`).toBeLessThan(limit);
            }
            // (The days on its perches play what they were asked: stretched out, up a dead limb.)
            if (script?.includes('loaf')) expect(played.has('loaf'), `seed ${seed}`).toBe(true);
            if (script?.includes('lookout')) expect(played.has('climb'), `seed ${seed}`).toBe(true);
        }
    }, 30_000); // five two-minute days, every bone each frame: about a second locally

    it('lets go of a look to the board over a moment when an answer to the board cuts it', () => {
        // Cues come thick and fast (a clear and four lines in one frame among them): whatever act a cue
        // cuts, the head's turn to the board never comes or goes in a frame.
        const cues = [];
        for (let t = 2; t < 118; t += 1.7) {
            cues.push(['clear', t, 1]);
            if (Math.round(t * 10) % 3 === 0) cues.push(['four', t, 1]);
            if (Math.round(t * 10) % 4 === 0) cues.push(['combo', t + 0.4, 1]);
        }
        let cut = 0;
        for (const seed of [271, 3, 8]) {
            const mind = new SquirrelMind({ stage, seed });
            let last = null;
            let worst = 0;
            let looked = 0;
            let cuts = 0;
            live(mind, 120, STEP, cues, (pose) => {
                if (!pose.visible) {
                    last = null;
                    return;
                }
                if (last !== null) worst = Math.max(worst, Math.abs(pose.look - last));
                if (pose.look > 0.9) looked += 1;
                last = pose.look;
                const before = mind.recent[0];
                if (before?.look && before.t1 < before.t0 + before.run - 1e-6 && mind.act.t0 === before.t1) cuts += 1;
            });
            cut += cuts;
            // (Eased over 0.3 s at most 0.083 a frame each way.)
            expect(worst, `seed ${seed}`).toBeLessThan(0.12);
            expect(looked, `seed ${seed}`).toBeGreaterThan(30);
        }
        // Looks were cut short (the case this holds).
        expect(cut).toBeGreaterThan(0);
    }, 30_000);

    it('turns on the spot: on its feet on the floor and along a limb, its paws gripping on bark', () => {
        const turns = new Set();
        for (const seed of [271, 3, 99]) {
            const mind = new SquirrelMind({ stage, seed, start: 'ground' });
            live(mind, 240, 0.05, [], () => {
                if (mind.act.kind !== 'turn') return;
                const { from } = mind.act;
                const where = mind.upright(from) ? 'upright' : mind.kindOf(from);
                turns.add(`${mind.act.clip} ${where}`);
            });
        }
        // Shuffling round on its feet on the floor (a flat perch is floor) and on top of a lying limb;
        // pivoting with its paws gripping on a trunk or a standing limb; never the other way round.
        expect([...turns].sort()).toEqual(['pivot upright', 'shuffle ground', 'shuffle limb']);
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
            climbs: { maple: 0, oak: 0 },
            bark: { maple: 0, oak: 0 },
            treetops: 0,
            homes: [],
            stops: [],
            time: { maple: 0, oak: 0 },
        };
        let home = null;
        let since = 0;
        live(mind, seconds, 1 / 30, [], (pose, t) => {
            const { act } = mind;
            const key = `${act.t0.toFixed(4)}${act.kind}${act.clip || ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                if (act.kind === 'leap' && act.from.on === 'ground' && stage.trunks[act.to.on]) {
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
            if (pose.visible && stage.trunks[act.from.on]) record.bark[act.from.on] += 1 / 30;
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
            // Up each from the floor at least once, and half a minute or more on each one's bark (it also
            // comes onto a trunk through the treetops, back along a bough, or from its perches).
            for (const tree of ['maple', 'oak']) {
                expect(record.climbs[tree], `seed ${seed} ${tree}`).toBeGreaterThanOrEqual(1);
                expect(record.bark[tree], `seed ${seed} ${tree}`).toBeGreaterThan(30);
            }
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

describe('the squirrel on its perches: the windfall, the stump, the oak\'s bough', () => {
    it('stands on its own bark wherever it walks a limb, out in the open, and sits on wood', async () => {
        // The perches' bark as the forest places it (fall-composition.js), in the world.
        const bark = [];
        const placed = FALL_FEATURE_TREES.filter((tree) => perchData.assets[tree.asset]);
        const glbs = await Promise.all(placed.map((tree) => parseGlb(`${tree.asset}.glb`)));
        for (const [k, tree] of placed.entries()) {
            const parsed = parseFallTree(glbs[k], tree.asset);
            const source = parsed.bark.attributes.position.array;
            const c = Math.cos(tree.yaw);
            const sn = Math.sin(tree.yaw);
            const y0 = fallTerrainHeight(tree.x, tree.z);
            const world = new Float64Array(source.length);
            for (let v = 0; v < source.length; v += 3) {
                const [x, y, z] = [source[v] * tree.scale, source[v + 1] * tree.scale, source[v + 2] * tree.scale];
                world[v] = tree.x + x * c + z * sn;
                world[v + 1] = y0 + y;
                world[v + 2] = tree.z - x * sn + z * c;
            }
            bark.push(world);
            parsed.bark.dispose();
        }
        const each = (visit) => bark.forEach((world) => {
            for (let v = 0; v < world.length; v += 3) visit(world[v], world[v + 1], world[v + 2]);
        });
        const walker = new SquirrelMind({ stage, seed: 1 });
        let stations = 0;
        for (const limb of Object.values(stage.limbs)) {
            for (let a = limb.low; a <= limb.high + 1e-9; a += 0.2) {
                // (Only where it may stand: not in the foot of a dead limb standing on this one.)
                if (!limb.standing && Math.abs(walker.walkable(limb.name, a) - a) > 1e-9) continue;
                stations += 1;
                const where = `${limb.name} ${a.toFixed(1)}`;
                const { p, r } = limb.sample(a);
                const t = limb.tangent(a);
                // Its own bark: the bark in a slab across the limb stands its radius out from the line.
                const outs = [];
                each((x, y, z) => {
                    const d = [x - p[0], y - p[1], z - p[2]];
                    const along = d[0] * t[0] + d[1] * t[1] + d[2] * t[2];
                    if (Math.abs(along) > 0.3) return;
                    const out = Math.sqrt(Math.max(0, d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - along * along));
                    if (out < r * 1.8 + 0.08) outs.push(out);
                });
                outs.sort((x, y) => x - y);
                expect(outs.length, where).toBeGreaterThanOrEqual(6);
                expect(Math.abs(outs[Math.floor(outs.length / 2)] - r), where).toBeLessThan(0.02 + 0.15 * r);
                // Out in the open: no wood over its back where it stands on a lying limb (not inside a
                // trunk the limb leaves, not in the foot of a dead limb standing on it).
                if (!limb.standing) {
                    const f = limb.frame(a, 0);
                    let over = 0;
                    // (Not the limb's own bark: a steep limb rises ahead of the squirrel within the window.)
                    const own = (x, y, z) => {
                        for (let s = Math.max(0, a - 0.5); s <= Math.min(limb.length, a + 0.5); s += 0.05) {
                            const q = limb.sample(s);
                            if (Math.hypot(x - q.p[0], y - q.p[1], z - q.p[2]) < q.r + 0.03) return true;
                        }
                        return false;
                    };
                    each((x, y, z) => {
                        const rise = y - f.point[1];
                        if (rise > 0.05 && rise < 0.6 && Math.hypot(x - f.point[0], z - f.point[2]) < 0.12
                            && !own(x, y, z)) over += 1;
                    });
                    expect(over, where).toBe(0);
                }
            }
        }
        expect(stations).toBeGreaterThan(20);
        // A flat place sits on wood: the highest bark under its middle, near its height, is its height.
        for (const pad of stage.pads) {
            let top = -Infinity;
            each((x, y, z) => {
                if (Math.hypot(x - pad.centre[0], z - pad.centre[2]) < pad.radius * 0.6
                    && Math.abs(y - pad.centre[1]) < 0.2) top = Math.max(top, y);
            });
            expect(Math.abs(top - pad.centre[1]), pad.name).toBeLessThan(0.05);
        }
        // And a dead limb's snapped end is a flat place, where it stands clear of the floor.
        const tips = stage.pads.filter((pad) => pad.limb);
        expect(tips.length).toBeGreaterThanOrEqual(2);
        for (const tip of tips) {
            const limb = stage.limbs[tip.limb];
            const end = limb.rows[limb.rows.length - 1];
            // At the end of it (on top, where it leans).
            expect(Math.hypot(...tip.centre.map((v, i) => v - end[i])), tip.name).toBeLessThan(0.3);
            expect(tip.centre[1] - fallTerrainHeight(tip.centre[0], tip.centre[2])).toBeGreaterThan(0.9);
        }
    }, 60_000);

    it('has room to sit up on every flat place: no limb passes through the space above a seat', () => {
        // A squirrel sitting up is about half a metre tall, drawn: the space over a seat, that high and a
        // quarter metre round its middle, holds no limb (its own, a snapped end's, is below it).
        for (const pad of stage.pads) {
            for (const limb of Object.values(stage.limbs)) {
                for (let a = 0; a <= limb.length; a += 0.05) {
                    if (pad.limb === limb.name && a > limb.length - 0.5) continue;
                    const { p, r } = limb.sample(a);
                    const rise = p[1] - pad.centre[1];
                    const aside = Math.hypot(p[0] - pad.centre[0], p[2] - pad.centre[2]);
                    const where = `${limb.name} ${a.toFixed(2)} over ${pad.name}`;
                    // (The limb's surface, not its line: its radius counts.)
                    if (rise + r > 0 && rise - r < 0.5) expect(aside, where).toBeGreaterThan(r + 0.25);
                }
            }
        }
    });

    it('gives every limb a smooth, right-handed frame: out from the bark, along it, round it', () => {
        const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        for (const limb of Object.values(stage.limbs)) {
            let last = null;
            for (let a = limb.low; a <= limb.high + 1e-9; a += 0.05) {
                for (const angle of [-1.2, -0.4, 0, 0.4, 1.2]) {
                    const f = limb.frame(a, angle);
                    const where = `${limb.name} ${a.toFixed(2)} ${angle}`;
                    for (const axis of [f.normal, f.up, f.side]) expect(Math.hypot(...axis), where).toBeCloseTo(1, 6);
                    expect(Math.abs(dot(f.normal, f.up)), where).toBeLessThan(1e-6);
                    expect(Math.abs(dot(f.normal, f.side)), where).toBeLessThan(1e-6);
                    // As a trunk's: the way along it crossed with the way round it is out of the bark.
                    cross(f.up, f.side).forEach((v, i) => expect(v, where).toBeCloseTo(f.normal[i], 6));
                    // The point is its radius out from the line.
                    const { p, r } = limb.sample(a);
                    expect(Math.hypot(...f.point.map((v, i) => v - p[i])), where).toBeCloseTo(r, 6);
                }
                // Step by step along the top, the bark under its paws turns only a little.
                const top = limb.frame(a, 0);
                if (last) {
                    expect(Math.acos(Math.min(1, dot(top.normal, last.normal))), `${limb.name} ${a.toFixed(2)}`)
                        .toBeLessThan(0.12);
                    const before = last.point;
                    expect(Math.hypot(...top.point.map((v, i) => v - before[i]))).toBeLessThan(0.12);
                }
                last = { normal: [...top.normal], point: [...top.point] };
            }
            // A lying limb's 0 is its top, a standing one's the side toward the eye.
            const mid = limb.frame((limb.low + limb.high) / 2, 0);
            if (limb.standing) {
                const eye = FALL_VIEWS.landscape.position;
                const toEye = mid.normal[0] * (eye[0] - mid.point[0]) + mid.normal[2] * (eye[2] - mid.point[2]);
                expect(toEye).toBeGreaterThan(0);
            } else expect(mid.normal[1]).toBeGreaterThan(0.6);
        }
    });

    it('stands on a flat perch only where a place names it: a run under a snapped end stays on the floor', () => {
        for (const pad of stage.pads) {
            const [x, y, z] = pad.centre;
            const floor = stage.ground.frame(x, z);
            expect(floor.point[1]).toBeCloseTo(fallTerrainHeight(x, z), 9);
            expect(stage.ground.frame(x, z, undefined, pad.name).point[1]).toBeCloseTo(y, 9);
        }
        // Over a day, whatever it does on the floor (not in the air), it is on the floor or on the perch
        // its place names.
        const { pads } = stage;
        for (const seed of [271, 3, 99]) {
            const mind = new SquirrelMind({ stage, seed });
            const seen = new Set();
            let perched = 0;
            live(mind, 600, 0.05, [], () => {
                const { act } = mind;
                if (seen.has(act) || act.kind === 'leap' || act.from.on !== 'ground') return;
                seen.add(act);
                const f = mind.frame(act.from);
                const pad = act.from.pad ? pads.find((entry) => entry.name === act.from.pad) : null;
                if (pad) perched += 1;
                const under = pad ? pad.centre[1] : fallTerrainHeight(act.from.a, act.from.b);
                expect(Math.abs(f.point[1] - under), `seed ${seed} ${act.kind} ${act.clip}`).toBeLessThan(0.02);
            });
            expect(perched, `seed ${seed}`).toBeGreaterThan(5);
        }
    }, 30_000);

    it('runs over the windfall and round the stump, never through them', () => {
        const lying = Object.values(stage.limbs).filter((limb) => limb.dead && !limb.standing);
        const stump = stage.pads.find((pad) => !pad.limb);
        expect(lying.length).toBeGreaterThanOrEqual(2);
        const crosses = (a, b, c, d) => {
            const rx = b[0] - a[0];
            const rz = b[1] - a[1];
            const sx = d[0] - c[0];
            const sz = d[1] - c[1];
            const det = rx * sz - rz * sx;
            if (Math.abs(det) < 1e-9) return null;
            const u = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / det;
            const w = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / det;
            return u > 0 && u < 1 && w > 0 && w < 1 ? w : null;
        };
        // (A limb is in the way where its underside is lower than a running squirrel, drawn: high up, a
        // leaning bough is run under.)
        const LOW = 0.6;
        const day = (seed) => {
            const mind = new SquirrelMind({ stage, seed });
            const seen = new Set();
            let runs = 0;
            let over = 0;
            live(mind, 600, 0.05, [], () => {
                const { act } = mind;
                if (seen.has(act)) return;
                seen.add(act);
                const ontoLog = lying.some((limb) => limb.name === act.to.on);
                if (act.kind === 'leap' && act.from.on === 'ground' && ontoLog) over += 1;
                if (act.kind !== 'move' || act.from.on !== 'ground') return;
                runs += 1;
                const a = [act.from.a, act.from.b];
                const b = [act.to.a, act.to.b];
                for (const limb of lying) {
                    for (let k = 0; k + 1 < limb.rows.length; k++) {
                        const [p0, p1] = [limb.rows[k], limb.rows[k + 1]];
                        const w = crosses(a, b, [p0[0], p0[2]], [p1[0], p1[2]]);
                        if (w === null) continue;
                        const at = p0.map((value, i) => value + (p1[i] - value) * w);
                        const under = at[1] - at[3] - fallTerrainHeight(at[0], at[2]);
                        expect(under, `seed ${seed}: a run through ${limb.name}`).toBeGreaterThan(LOW);
                    }
                }
                // Clear of the stump's flared foot all the way.
                const dx = b[0] - a[0];
                const dz = b[1] - a[1];
                const toward = (stump.centre[0] - a[0]) * dx + (stump.centre[2] - a[1]) * dz;
                const u = clamp01(toward / (dx * dx + dz * dz || 1));
                expect(Math.hypot(a[0] + dx * u - stump.centre[0], a[1] + dz * u - stump.centre[2]), `seed ${seed}`)
                    .toBeGreaterThan(0.7);
            });
            return { runs, over };
        };
        const days = [271, 3, 99, 11].map(day);
        const runs = days.reduce((sum, entry) => sum + entry.runs, 0);
        const over = days.reduce((sum, entry) => sum + entry.over, 0);
        expect(runs).toBeGreaterThan(100);
        // (And it does get up onto them.)
        expect(over).toBeGreaterThan(5);
    }, 30_000);

    it('keeps to the frame when it stops: never off its edges, behind the board card or behind the HUD', () => {
        const camera = landscapeCamera();
        const v = new THREE.Vector3();
        // The card's default and the score panel right of it, in screen fractions (y down).
        const inside = (sx, sy, box) => sx > box[0] && sx < box[1] && sy > box[2] && sy < box[3];
        const card = [0.385, 0.615, 0.09, 0.93];
        const hud = [0.622, 0.747, 0.174, 0.428];
        const stopsOf = (seed) => {
            const mind = new SquirrelMind({ stage, seed });
            const seen = new Set();
            let stays = 0;
            live(mind, 600, 0.05, [], () => {
                const { act } = mind;
                if (seen.has(act) || act.kind !== 'stay' || act.duration < 0.3) return;
                seen.add(act);
                stays += 1;
                const f = mind.frame(act.from);
                v.set(...f.point.map((p, i) => p + f.normal[i] * 0.3)).project(camera);
                const where = `seed ${seed} ${act.clip} on ${act.from.pad || act.from.on}`;
                // (The maple's trunk stands at the left edge: its middle at 3 % from it at most.)
                expect(Math.abs(v.x), where).toBeLessThan(0.95);
                expect(Math.abs(v.y), where).toBeLessThan(0.93);
                const sx = v.x * 0.5 + 0.5;
                const sy = 0.5 - v.y * 0.5;
                expect(inside(sx, sy, card), where).toBe(false);
                expect(inside(sx, sy, hud), where).toBe(false);
            });
            return stays;
        };
        expect([271, 3, 99, 11, 7].reduce((sum, seed) => sum + stopsOf(seed), 0)).toBeGreaterThan(800);
    }, 30_000);

    it('does something else next: a routine just done is seldom chosen again at once', () => {
        for (const seed of [271, 3, 99, 11]) {
            const mind = new SquirrelMind({ stage, seed });
            live(mind, 600, 0.1);
            const { history } = mind;
            const repeats = history.filter((bit, i) => i > 0 && bit === history[i - 1]).length;
            expect(history.length, `seed ${seed}`).toBeGreaterThan(60);
            expect(repeats, `seed ${seed}`).toBeLessThanOrEqual(4);
            // And no routine is most of its day.
            const counts = {};
            history.forEach((bit) => { counts[bit] = (counts[bit] || 0) + 1; });
            expect(Math.max(...Object.values(counts)) / history.length, `seed ${seed}`).toBeLessThan(0.15);
        }
    }, 30_000);

    it('leaps from where it stood to where it then stands, onto and off limbs and flat perches', () => {
        let checked = 0;
        const { limbs } = stage;
        for (const seed of [271, 3, 99]) {
            const mind = new SquirrelMind({ stage, seed });
            const seen = new Set();
            const leaps = [];
            live(mind, 600, 0.05, [], () => {
                const { act } = mind;
                if (seen.has(act)) return;
                seen.add(act);
                if (act.kind === 'leap') leaps.push(act);
            });
            for (const leap of leaps) {
                const touches = [leap.from, leap.to].some((place) => place.pad || limbs[place.on]);
                if (!touches) continue;
                checked += 1;
                const where = `seed ${seed} ${leap.from.pad || leap.from.on} -> ${leap.to.pad || leap.to.on}`;
                const from = mind.frame(leap.from).point;
                const to = mind.frame(leap.to).point;
                const at = (t) => mind.bodyAt(leap, t, createSquirrelPose()).position;
                at(leap.t0 + leap.crouch * 0.5).forEach((v, i) => expect(v, where).toBeCloseTo(from[i], 6));
                at(leap.t1).forEach((v, i) => expect(v, where).toBeCloseTo(to[i], 6));
                // Over the arc, never down through the floor.
                for (let k = 1; k < 10; k++) {
                    const point = at(leap.t0 + leap.crouch + (leap.flight * k) / 10);
                    expect(point[1] - fallTerrainHeight(point[0], point[2]), where).toBeGreaterThan(-0.02);
                }
            }
        }
        expect(checked).toBeGreaterThan(30);
    }, 30_000);

    it('answers the board wherever it is; on a perch or along a limb it answers where it stands', () => {
        const stumpTop = stage.pads.find((pad) => !pad.limb);
        const tip = stage.pads.find((pad) => pad.limb);
        const windfall = stage.limbs['windfall.trunk'];
        const post = Object.values(stage.limbs).find((limb) => limb.standing);
        const places = {
            floor: {
                on: 'ground', a: SQUIRREL_SPOTS.maple[0][0], b: SQUIRREL_SPOTS.maple[0][1], heading: 0,
            },
            trunk: {
                on: 'oak', a: 1.8, b: stage.facing.oak, heading: 0,
            },
            stump: {
                on: 'ground', a: stumpTop.centre[0], b: stumpTop.centre[2], heading: 1, pad: stumpTop.name,
            },
            tip: {
                on: 'ground', a: tip.centre[0], b: tip.centre[2], heading: 1, pad: tip.name,
            },
            windfall: {
                on: windfall.name, a: (windfall.low + windfall.high) / 2, b: 0, heading: 0,
            },
            post: {
                on: post.name, a: (post.low + post.high) / 2, b: 0, heading: 0,
            },
        };
        const camera = landscapeCamera();
        const v = new THREE.Vector3();
        for (const [name, place] of Object.entries(places)) {
            for (const kind of ['drop', 'clear', 'four', 'combo', 'spin', 'perfect', 'over']) {
                const where = `${kind} on the ${name}`;
                const script = { floor: ['sit'], trunk: ['look'], post: ['cling'] }[name] || ['watch', 'rest'];
                const mind = mindAt(place, { seed: 11, script });
                let leapt = false;
                live(mind, 7, 0.05, [[kind, 1, 1]], (pose, t) => {
                    expect(pose.position.every(Number.isFinite), where).toBe(true);
                    if (!pose.visible) return;
                    v.set(...pose.position).project(camera);
                    expect(Math.abs(v.x) < 1 && Math.abs(v.y) < 1, where).toBe(true);
                    // On a flat perch or along a lying limb it has nowhere to run to: it answers there.
                    if ((name === 'stump' || name === 'tip' || name === 'windfall') && t > 1 && t < 2.5) {
                        leapt ||= mind.act.kind === 'leap';
                        expect(mind.act.from.on, where).toBe(place.on);
                        expect(mind.act.from.pad, where).toBe(place.pad);
                    }
                });
                expect(leapt, where).toBe(false);
            }
        }
    }, 30_000);

    it('lives a day with its perches that is a function of the clock and the events alone', () => {
        const cues = [['drop', 3, 1], ['clear', 9, 1], ['four', 17, 1], ['combo', 26, 1], ['perfect', 40, 1],
            ['over', 55, 1]];
        for (const start of ['windfall', 'stump', 'bough']) {
            const a = live(new SquirrelMind({ stage, seed: 12, start }), 70, 1 / 30, cues);
            const b = live(new SquirrelMind({ stage, seed: 12, start }), 70, 1 / 144, cues);
            expect(a.act, start).toBe(b.act);
            expect(a.clip, start).toBe(b.clip);
            a.position.forEach((value, i) => expect(value, start).toBeCloseTo(b.position[i], 6));
            a.quaternion.forEach((value, i) => expect(value, start).toBeCloseTo(b.quaternion[i], 6));
        }
    });

    it('carries a nut it found in its mouth to where it buries it, and drops it when it takes fright', () => {
        const mind = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['bury'],
        });
        const acts = [];
        live(mind, 16, 0.05, [], (pose) => {
            if (acts[acts.length - 1]?.act !== mind.act) acts.push({ act: mind.act, carry: pose.carry });
            expect(pose.carry && pose.acorn).toBe(false);
        });
        const digs = acts.filter(({ act }) => act.clip === 'dig');
        expect(digs.length).toBeGreaterThanOrEqual(2);
        // Found at the first dig (not carried there yet), carried from it to the second, then buried.
        expect(digs[0].carry).toBe(false);
        expect(digs[1].carry).toBe(true);
        const first = acts.indexOf(digs[0]);
        const second = acts.indexOf(digs[1]);
        acts.slice(first + 1, second + 1).forEach(({ act, carry }) => expect(carry, act.clip).toBe(true));
        acts.slice(second + 1).forEach(({ act, carry }) => expect(carry, act.clip).toBe(false));
        expect(acts.slice(second + 1).some(({ act }) => act.clip === 'pat')).toBe(true);
        // It is buried somewhere else than where it was found.
        const found = digs[0].act.from;
        const buried = digs[1].act.from;
        expect(Math.hypot(found.a - buried.a, found.b - buried.b)).toBeGreaterThan(0.5);
        // A fright on the way drops it.
        const carrying = acts.find(({ carry }) => carry).act;
        const startled = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['bury'],
        });
        let after = null;
        const cut = carrying.t0 + 0.1;
        live(startled, cut + 4, 0.05, [['four', cut, 1]], (pose, t) => {
            if (t > cut + 0.05) after = after === null ? pose.carry : after || pose.carry;
        });
        expect(after).toBe(false);
    });
});

describe('the squirrel\'s coat', () => {
    it('wears hair over its body: the body once more for every layer, in one draw, as many as the tier asks', () => {
        const light = new FallLight({ tier: fallTier('Minimal'), rng: () => 0.5 });
        owned.push(light);
        for (const quality of ['High', 'Minimal']) {
            const squirrel = drainSteps(createSquirrelSteps({ light, gltf, quality }));
            owned.push(squirrel);
            const coat = squirrel.coatHair;
            expect(coat, quality).toBeTruthy();
            let body = null;
            squirrel.group.traverse((object) => {
                if (object.isSkinnedMesh && object.material?.name === 'FallSquirrelFur') body = object;
            });
            expect(coat.mesh.isSkinnedMesh).toBe(true);
            expect(coat.shells).toBe(FUR_SHELLS[quality]);
            expect(coat.mesh.count).toBe(FUR_SHELLS[quality]);
            expect(coat.mesh.geometry).toBe(body.geometry);
            expect(coat.mesh.skeleton).toBe(body.skeleton);
            expect(coat.mesh.parent).toBe(body.parent);
            expect(coat.mesh.material.transparent).toBe(true);
            expect(coat.mesh.material.depthWrite).toBe(false);
            expect(coat.triangles).toBe((body.geometry.index.count / 3) * FUR_SHELLS[quality]);
        }
        expect(FUR_SHELLS.High).toBeGreaterThan(FUR_SHELLS.Minimal);
        // Gone with the squirrel.
        const squirrel = createSquirrel({ light, gltf });
        const { mesh } = squirrel.coatHair;
        let released = false;
        const dispose = mesh.material.dispose.bind(mesh.material);
        mesh.material.dispose = () => {
            released = true;
            dispose();
        };
        squirrel.dispose();
        expect(released).toBe(true);
        expect(mesh.parent).toBeNull();
        // No coat for a body that carries no hair lengths.
        let body = null;
        gltf.scene.traverse((object) => { if (object.isSkinnedMesh) body = object; });
        const bare = body.geometry.clone();
        bare.deleteAttribute('_fur');
        expect(createFurShells({ body: { geometry: bare }, light })).toBeNull();
        bare.dispose();
    });

    it('shows the nut in its mouth only while it carries one, and not with the acorn in its paws', () => {
        const light = new FallLight({ tier: fallTier('Minimal'), rng: () => 0.5 });
        owned.push(light);
        const squirrel = createSquirrel({ light, gltf });
        owned.push(squirrel);
        const carried = squirrel.group.getObjectByName('FallSquirrelAcornCarried');
        expect(carried?.isMesh).toBe(true);
        expect(carried.parent.name).toBe('head');
        const mind = new SquirrelMind({
            stage, seed: 8, start: 'ground', script: ['sit'],
        });
        const pose = mind.pose(1);
        squirrel.update({ ...pose, carry: true, acorn: false });
        expect(carried.visible).toBe(true);
        squirrel.update({ ...pose, carry: true, acorn: true });
        expect(carried.visible).toBe(false);
        squirrel.update({ ...pose, carry: false, acorn: false });
        expect(carried.visible).toBe(false);
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
    it('stirs the litter only on the floor: a dig throws leaves out behind it, a landing puffs a few up', async () => {
        const make = async () => new FallWorld({
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300),
            quality: 'Minimal',
            rng: () => 0.5,
            assets: await bundle(true),
            squirrelSeed: 8,
            squirrelStart: 'ground',
            squirrelScript: ['bury', 'climb', 'down', 'perch'],
        }).build();
        const record = (world) => {
            const { sim } = world.leaves;
            const calls = [];
            const spawn = sim.spawn.bind(sim);
            sim.spawn = (...args) => {
                const index = spawn(...args);
                const { act } = world.squirrelMind;
                calls.push({
                    index, args: args.map((v) => Math.round(v * 1e6) / 1e6), act, clip: world.squirrelPose.clip,
                });
                return index;
            };
            const reactions = new FallReactions({ quality: 'Minimal', rng: () => 0.5 });
            for (let i = 1; i <= 40 / STEP; i++) {
                reactions.update(STEP);
                world.update(i * STEP, STEP, reactions.getFrame());
            }
            return calls;
        };
        const a = await make();
        const b = await make();
        owned.push(a, b);
        const calls = record(a);
        expect(calls.length).toBeGreaterThan(8);
        const { sim } = a.leaves;
        let digs = 0;
        let landings = 0;
        for (const call of calls) {
            // Leaves of the air's own reserve, never one in flight taken (no steal).
            expect(call.args.length).toBe(6);
            expect(call.index === -1 || call.index >= sim.ambient).toBe(true);
            if (call.act.kind === 'leap') {
                landings += 1;
                expect(call.act.to.on).toBe('ground');
                expect(call.act.to.pad).toBeUndefined();
            } else {
                digs += 1;
                expect(call.clip).toBe('dig');
                expect(call.act.from.on).toBe('ground');
                expect(call.act.from.pad).toBeUndefined();
            }
        }
        expect(digs).toBeGreaterThan(3);
        expect(landings).toBeGreaterThan(0);
        // The same grove and the same day throw the same leaves.
        const throws = (list) => list.map((call) => [call.index, ...call.args]);
        expect(throws(record(b))).toEqual(throws(calls));
        // A new session starts its throws afresh.
        a.resetEffects();
        expect(a.squirrelDig).toBe(0);
        expect(a.squirrelLanded).toBeNull();
    }, 60_000);

    it('lives on the trunks and the floor in a grove whose perches did not arrive', async () => {
        const assets = await bundle(true);
        for (const name of ['old-windfall', 'old-stump']) {
            assets.trees[name].bark.dispose();
            delete assets.trees[name];
        }
        const world = new FallWorld({
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300),
            quality: 'Minimal',
            rng: () => 0.5,
            assets,
            squirrelStart: 'any',
            squirrelSeed: 3,
        }).build();
        owned.push(world);
        expect(Object.keys(world.squirrelStage.limbs)).toEqual(['oak.riser']);
        expect(world.squirrelStage.pads).toEqual([]);
        const reactions = new FallReactions({ quality: 'Minimal', rng: () => 0.5 });
        const places = new Set();
        for (let i = 1; i <= 120 / (STEP * 4); i++) {
            reactions.update(STEP * 4);
            world.update(i * STEP * 4, STEP * 4, reactions.getFrame());
            const { from } = world.squirrelMind.act;
            places.add(from.on);
            expect(from.pad).toBeUndefined();
            expect(world.squirrelPose.position.every(Number.isFinite)).toBe(true);
        }
        [...places].forEach((on) => expect(['ground', 'maple', 'oak', 'oak.riser']).toContain(on));
        expect(places.has('ground')).toBe(true);
    }, 60_000);
});
