/**
 * Forest — what the wood throws into the air besides fireflies (src/themes/forest/forest-flurry.js).
 *
 * A particle is a record written once and placed by the clock in the vertex stage, so what can be
 * tested without a GPU is everything that matters to a player: which records an event writes, that
 * a full ring lets the NEW particle go and never cuts one in flight, that a request is played once,
 * and that nothing that is not a number reaches the buffer. The counts, colours, sizes and lives a
 * burst is tuned to are not pinned here: only how they relate (a stronger call throws no less, a
 * drop from higher falls longer, every instrument has a colour of its own).
 *
 * The material is built through three's own node builders against a stub renderer (the WGSL of the
 * WebGPU backend and the GLSL of the WebGL2 fallback). No GPU.
 */
import {
    afterAll, afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { forestEye, forestViewFor } from '../../src/themes/forest/forest-composition.js';
import { FOREST_FLURRY_MOTION, FOREST_FLURRY_STRIDE, ForestFlurry } from '../../src/themes/forest/forest-flurry.js';
import { ForestLight } from '../../src/themes/forest/forest-light.js';
import { FOREST_TIERS, forestTier } from '../../src/themes/forest/forest-quality.js';
import { ForestReactions } from '../../src/themes/forest/forest-reactions.js';
import { FOREST_STAGE_DEPTH, ForestStage } from '../../src/themes/forest/forest-stage.js';
import { forestGroundHeight } from '../../src/themes/forest/forest-terrain.js';
import { build, stubRenderer, unassignedReads } from './helpers/tsl-node-build.js';

const STEP = 1 / 60;
const STRIDE = FOREST_FLURRY_STRIDE;
const KINDS = ['dew', 'bloom', 'spores', 'wisps', 'leaves', 'goldfall'];
const METHODS = {
    dew: 'dewfall', bloom: 'bloom', spores: 'spores', wisps: 'wisps', leaves: 'leaves', goldfall: 'goldfall',
};
const NOW = 10;

function seededRandom(seed = 419) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** A camera framed the way the world frames it for a wide screen, and the stage that reads it. */
function createStage(aspect = 16 / 9) {
    const view = forestViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 3400);
    camera.position.set(...forestEye(view));
    camera.lookAt(...view.target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return new ForestStage(camera, forestGroundHeight);
}

/** Places in the glade in front of the eye, as a flat xyz list: `lift(x, z, rng)` metres above the floor. */
function scatter(count, seed, lift) {
    const rng = seededRandom(seed);
    const spots = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
        const x = -24 + rng() * 48;
        const z = -44 + rng() * 48;
        spots.set([x, forestGroundHeight(x, z) + lift(rng), z], index * 3);
    }
    return spots;
}

const CAPS = scatter(60, 3, () => 0.05);
const FLOWERS = scatter(400, 4, () => 0.02);
const BOUGHS = scatter(80, 5, (rng) => 4 + rng() * 8);
const NONE = new Float32Array(0);
const stage = createStage();
// One light rig for the file: the flurry reads its clock, its wind and its moon, and starts its bloom.
const light = new ForestLight({ tier: forestTier('Minimal'), rng: seededRandom(1) });
const made = [];

function createFlurry({
    capacity = 2600, seed = 11, rng = seededRandom(seed), caps = CAPS, flowers = FLOWERS, boughs = BOUGHS,
    groundHeight = forestGroundHeight, rig = light, tier = { flurry: capacity },
} = {}) {
    const flurry = new ForestFlurry({
        light: rig, tier, rng, groundHeight, sources: { caps, flowers, boughs },
    }).build();
    made.push(flurry);
    return flurry;
}

/** One request as ForestReactions describes it. */
function cue(kind, overrides = {}) {
    return {
        serial: 0, kind, side: 1, column: 0.5, row: 0.1, strength: 1, ...overrides,
    };
}

function play(flurry, cues, {
    time = NOW, dt = STEP, epoch = 1, settled = false, air = null, wind = null, on = stage,
} = {}) {
    flurry.play({ epoch, settled, flurries: cues }, {
        time, dt, stage: on, wind, air,
    });
    return flurry.counts();
}

/** Every record in flight at the flurry's clock, as the vertex stage reads it (FOREST_FLURRY_STRIDE floats). */
function records(flurry) {
    const list = [];
    if (!flurry.data) return list;
    for (let slot = 0; slot < flurry.capacity; slot++) {
        if (!(flurry.ends[slot] > flurry.time)) continue;
        const [x, y, z, birth, vx, vy, vz, life, motion, size, seed, more, r, g, b, moonlit] = flurry.data
            .subarray(slot * STRIDE, slot * STRIDE + STRIDE);
        list.push({
            slot, x, y, z, birth, vx, vy, vz, life, motion, size, seed, more, colour: [r, g, b], moonlit,
        });
    }
    return list;
}

/** What one kind throws by itself on a fresh flurry. */
function thrownBy(kind, {
    strength = 1, options = {}, playing = {}, ...overrides
} = {}) {
    const flurry = createFlurry(options);
    play(flurry, [cue(kind, { strength, ...overrides })], playing);
    return { flurry, list: records(flurry) };
}

const allFinite = (array) => array.every(Number.isFinite);
const nearSite = (record, sites, reach) => {
    for (let index = 0; index < sites.length; index += 3) {
        if (Math.hypot(record.x - sites[index], record.z - sites[index + 2]) <= reach) return index / 3;
    }
    return -1;
};

afterEach(() => {
    made.splice(0).forEach((flurry) => flurry.dispose());
    vi.restoreAllMocks();
    light.reset();
});

afterAll(() => light.dispose());

describe('Forest flurry: the ring of records', () => {
    it('builds one hidden draw of the tier\'s capacity, four attributes over one buffer', () => {
        for (const quality of Object.keys(FOREST_TIERS)) {
            const tier = FOREST_TIERS[quality];
            const flurry = createFlurry({ tier });
            const meshes = [];
            flurry.group.traverse((object) => { if (object.isMesh) meshes.push(object); });
            expect(meshes).toEqual([flurry.mesh]);
            const { mesh } = flurry;
            expect(mesh.name).toBe('ForestFlurry');
            expect(flurry.capacity).toBe(tier.flurry);
            expect(mesh.geometry.instanceCount).toBe(tier.flurry);
            expect(flurry.data).toHaveLength(tier.flurry * STRIDE);
            // One interleaved instance buffer under four vec4 attributes: with the quad's own two
            // that is three vertex buffers, well under WebGPU's eight.
            const names = Object.keys(mesh.geometry.attributes).filter((name) => /^iFlurry/.test(name)).sort();
            expect(names).toHaveLength(STRIDE / 4);
            names.forEach((name, index) => {
                const attribute = mesh.geometry.attributes[name];
                expect(attribute.isInterleavedBufferAttribute).toBe(true);
                expect(attribute.data).toBe(flurry.buffer);
                expect(attribute.itemSize).toBe(4);
                expect(attribute.offset).toBe(index * 4);
            });
            expect(flurry.buffer.isInstancedInterleavedBuffer).toBe(true);
            expect(flurry.buffer.stride).toBe(STRIDE);
            expect(flurry.buffer.array).toBe(flurry.data);
            expect(new Set(Object.values(mesh.geometry.attributes).map((attribute) => attribute.data ?? attribute)).size)
                .toBeLessThanOrEqual(3);
            // Light in the air: blended over the scene, never writing depth, never fogged twice.
            expect(mesh.material.isNodeMaterial).toBe(true);
            expect(mesh.material).toMatchObject({
                name: 'ForestFlurry', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
            });
            expect(mesh.castShadow).toBe(false);
            expect(mesh.frustumCulled).toBe(false);
            // Nothing in flight, nothing drawn.
            expect(mesh.visible).toBe(false);
            expect(flurry.counts()).toEqual({ particles: 0, thrown: 0, refused: 0 });
            expect(allFinite(flurry.data)).toBe(true);
        }
    });

    it.each([
        ['none', 0], ['less than none', -5], ['no number', NaN], ['a word', 'many'], ['nothing said', undefined],
        ['a fraction of one', 0.9],
    ])('builds nothing for a capacity of %s, and plays as nothing', (_label, capacity) => {
        const flurry = createFlurry({ tier: { flurry: capacity } });
        expect(flurry.mesh).toBeUndefined();
        expect(flurry.group.children).toEqual([]);
        expect(() => {
            play(flurry, KINDS.map((kind, serial) => cue(kind, { serial })), { air: { spores: 5 } });
            flurry.trickle(1, 5);
            flurry.flush();
            flurry.reset();
        }).not.toThrow();
        expect(flurry.toss('mote', [1, 1, 1], 0, 1, 0, 0, 0, 0, 1, 0.1)).toBe(false);
        expect(flurry.counts()).toEqual({ particles: 0, thrown: 0, refused: 0 });
        expect(() => flurry.dispose()).not.toThrow();
    });

    it('takes whole particles only', () => {
        expect(createFlurry({ tier: { flurry: 6.9 } }).capacity).toBe(6);
    });

    it('writes a particle once, as it was thrown, into a slot of its own', () => {
        const flurry = createFlurry({ capacity: 8 });
        flurry.time = NOW;
        expect(flurry.toss('drop', [0.1, 0.2, 0.3], 1, 2, 3, 4, 5, 6, 2.5, 0.07, { more: -0.5, delay: 0.25, moonlit: 0.75 }))
            .toBe(true);
        expect(flurry.toss('glide', [0.4, 0.5, 0.6], -1, 9, -3, 0, -1, 0, 4, 0.02)).toBe(true);
        const [first, second] = records(flurry);
        expect(first).toMatchObject({
            slot: 0,
            x: 1,
            y: 2,
            z: 3,
            vx: 4,
            vy: 5,
            vz: 6,
            life: 2.5,
            motion: FOREST_FLURRY_MOTION.drop,
            more: -0.5,
            moonlit: 0.75,
        });
        // It is born `delay` seconds on from the flurry's clock, and lives its life from then.
        expect(first.birth).toBeCloseTo(NOW + 0.25, 6);
        expect(flurry.ends[0]).toBeCloseTo(NOW + 0.25 + 2.5, 9);
        expect(first.size).toBeCloseTo(0.07, 6);
        first.colour.forEach((channel, index) => expect(channel).toBeCloseTo([0.1, 0.2, 0.3][index], 6));
        expect(second).toMatchObject({
            slot: 1, motion: FOREST_FLURRY_MOTION.glide, more: 0, moonlit: 0,
        });
        expect(second.birth).toBeCloseTo(NOW, 6);
        // Each has a number of its own to keep it out of step with the rest.
        for (const record of [first, second]) {
            expect(record.seed).toBeGreaterThanOrEqual(0);
            expect(record.seed).toBeLessThan(1);
        }
        expect(first.seed).not.toBe(second.seed);
        expect(flurry.counts()).toEqual({ particles: 2, thrown: 2, refused: 0 });
        // A way of moving it does not know is a mote's; a delay that is none is now.
        flurry.toss('teleport', [1, 1, 1], 0, 1, 0, 0, 0, 0, 1, 0.1, { delay: -3 });
        flurry.toss('mote', [1, 1, 1], 0, 1, 0, 0, 0, 0, 1, 0.1, { delay: NaN });
        const later = records(flurry).slice(2);
        expect(later.map((record) => record.motion)).toEqual([FOREST_FLURRY_MOTION.mote, FOREST_FLURRY_MOTION.mote]);
        for (const record of later) expect(record.birth).toBeCloseTo(NOW, 6);
        expect(Object.values(FOREST_FLURRY_MOTION).sort()).toEqual([0, 1, 2, 3]);
        expect(Object.isFrozen(FOREST_FLURRY_MOTION)).toBe(true);
    });

    it.each([
        ['a place that is nowhere', [NaN, 1, 0, 0, 0, 0, 1, 0.1]],
        ['a height without end', [0, Infinity, 0, 0, 0, 0, 1, 0.1]],
        ['a flight that is no number', [0, 1, 0, 0, NaN, 0, 1, 0.1]],
        ['a flight without end', [0, 1, 0, 0, 0, -Infinity, 1, 0.1]],
        ['no life', [0, 1, 0, 0, 0, 0, 0, 0.1]],
        ['a life already over', [0, 1, 0, 0, 0, 0, -2, 0.1]],
        ['a life that is no number', [0, 1, 0, 0, 0, 0, NaN, 0.1]],
        ['a life without end', [0, 1, 0, 0, 0, 0, Infinity, 0.1]],
        ['a size that is no number', [0, 1, 0, 0, 0, 0, 1, NaN]],
        ['a word for a place', ['a', 1, 0, 0, 0, 0, 1, 0.1]],
        ['nothing for a place', [null, 1, 0, 0, 0, 0, 1, 0.1]],
    ])('lets go of a particle with %s: nothing is written', (_label, args) => {
        const flurry = createFlurry({ capacity: 8 });
        flurry.time = NOW;
        const before = Array.from(flurry.data);
        expect(flurry.toss('mote', [1, 1, 1], ...args)).toBe(false);
        expect(flurry.toss('mote', [1, 1, 1], 0, 1, 0, 0, 0, 0, 1, 0.1, { more: NaN })).toBe(false);
        expect(Array.from(flurry.data)).toEqual(before);
        // Not thrown, and not turned away by a full ring either: it never was a particle.
        expect(flurry.counts()).toEqual({ particles: 0, thrown: 0, refused: 0 });
        flurry.flush();
        expect(flurry.mesh.visible).toBe(false);
    });

    it('refuses a new particle when every slot is in flight, rather than cutting one short', () => {
        const flurry = createFlurry({ capacity: 8 });
        flurry.time = NOW;
        for (let index = 0; index < 8; index++) {
            // Every other one lives long.
            expect(flurry.toss('mote', [1, 1, 1], index, 1, 0, 0, 0, 0, index % 2 ? 9 : 1, 0.1)).toBe(true);
        }
        const full = Array.from(flurry.data);
        const ends = Array.from(flurry.ends);
        expect(flurry.counts()).toEqual({ particles: 8, thrown: 8, refused: 0 });
        for (let more = 1; more <= 5; more++) {
            expect(flurry.toss('mote', [9, 9, 9], 99, 99, 99, 0, 0, 0, 30, 0.5)).toBe(false);
            expect(flurry.counts()).toEqual({ particles: 8, thrown: 8, refused: more });
        }
        // Not a float of what was in flight has changed.
        expect(Array.from(flurry.data)).toEqual(full);
        expect(Array.from(flurry.ends)).toEqual(ends);
        // Two seconds on the short-lived four are spent: new particles take exactly their slots.
        flurry.time = NOW + 2;
        expect(flurry.counts().particles).toBe(4);
        const taken = [];
        for (let index = 0; index < 6; index++) {
            const before = records(flurry).map((record) => record.slot);
            const landed = flurry.toss('mote', [2, 2, 2], 50 + index, 1, 0, 0, 0, 0, 9, 0.1);
            const fresh = records(flurry).map((record) => record.slot).filter((slot) => !before.includes(slot));
            expect(landed).toBe(index < 4);
            expect(fresh).toHaveLength(index < 4 ? 1 : 0);
            taken.push(...fresh);
        }
        expect(taken.sort()).toEqual([0, 2, 4, 6]);
        // The long-lived four are as they were thrown.
        for (const slot of [1, 3, 5, 7]) {
            expect(Array.from(flurry.data.subarray(slot * STRIDE, (slot + 1) * STRIDE)))
                .toEqual(full.slice(slot * STRIDE, (slot + 1) * STRIDE));
            expect(flurry.ends[slot]).toBe(ends[slot]);
        }
        expect(flurry.counts()).toEqual({ particles: 8, thrown: 12, refused: 7 });
    });

    it('counts a particle that is still to be born as in flight, and one at its very end as spent', () => {
        const flurry = createFlurry({ capacity: 2 });
        flurry.time = NOW;
        // Thrown now, born three seconds on, alive for one.
        flurry.toss('mote', [1, 1, 1], 0, 1, 0, 0, 0, 0, 1, 0.1, { delay: 3 });
        flurry.toss('mote', [1, 1, 1], 1, 1, 0, 0, 0, 0, 1, 0.1);
        const waiting = Array.from(flurry.data.subarray(0, STRIDE));
        flurry.time = NOW + 2;
        expect(flurry.counts().particles).toBe(1);
        // The spent slot is taken; the one waiting to be born is not.
        expect(flurry.toss('mote', [2, 2, 2], 5, 1, 0, 0, 0, 0, 9, 0.1)).toBe(true);
        expect(flurry.toss('mote', [2, 2, 2], 6, 1, 0, 0, 0, 0, 9, 0.1)).toBe(false);
        expect(Array.from(flurry.data.subarray(0, STRIDE))).toEqual(waiting);
        // At the moment its life is out its slot is free.
        flurry.time = flurry.ends[0];
        expect(flurry.counts().particles).toBe(1);
        expect(flurry.toss('mote', [3, 3, 3], 7, 1, 0, 0, 0, 0, 9, 0.1)).toBe(true);
        expect(flurry.data[0]).toBe(7);
    });

    it('draws only while something is in flight, and uploads only what a frame wrote', () => {
        const flurry = createFlurry();
        const uploads = () => flurry.buffer.version;
        const idle = uploads();
        play(flurry, [], { time: 1 });
        play(flurry, [], { time: 2 });
        expect(uploads()).toBe(idle);
        expect(flurry.mesh.visible).toBe(false);
        // A burst: written once, uploaded once, drawn until its last particle has gone.
        play(flurry, [cue('goldfall')], { time: 3 });
        expect(uploads()).toBe(idle + 1);
        expect(flurry.mesh.visible).toBe(true);
        const last = Math.max(...flurry.ends);
        expect(last).toBeGreaterThan(3);
        let time = 3;
        let frames = 0;
        while (time + STEP < last) {
            time += STEP;
            play(flurry, [cue('goldfall')], { time });
            expect(flurry.mesh.visible).toBe(true);
            frames += 1;
        }
        // Nothing after the throw cost the CPU or the bus a thing: the vertex stage moved it all.
        expect(frames).toBeGreaterThan(60);
        expect(uploads()).toBe(idle + 1);
        play(flurry, [cue('goldfall')], { time: last + STEP });
        expect(flurry.mesh.visible).toBe(false);
        expect(flurry.counts().particles).toBe(0);
    });

    it('forgets everything in flight on reset, and does not throw again what it has already played', () => {
        const flurry = createFlurry();
        const asked = KINDS.map((kind, serial) => cue(kind, { serial }));
        play(flurry, asked);
        const thrown = flurry.counts();
        expect(thrown.particles).toBeGreaterThan(100);
        expect(flurry.mesh.visible).toBe(true);
        const uploads = flurry.buffer.version;
        flurry.reset();
        expect(flurry.counts().particles).toBe(0);
        expect(flurry.data.every((value) => value === 0)).toBe(true);
        expect(flurry.mesh.visible).toBe(false);
        // The cleared buffer goes to the GPU: no record of the last session is left to be drawn.
        expect(flurry.buffer.version).toBeGreaterThan(uploads);
        // The director was not reset: its queue still holds the same requests, and none is replayed.
        expect(play(flurry, asked, { time: NOW + STEP })).toEqual({ ...thrown, particles: 0 });
        expect(flurry.mesh.visible).toBe(false);
        // The next request is answered as usual, into a ring that is all free again.
        play(flurry, [...asked, cue('wisps', { serial: asked.length })], { time: NOW + 2 * STEP });
        expect(flurry.counts().particles).toBeGreaterThan(0);
        expect(flurry.counts().thrown).toBe(thrown.thrown + flurry.counts().particles);
        expect(records(flurry).map((record) => record.slot)[0]).toBe(0);
        // Resetting twice, or with nothing in flight, is as safe.
        flurry.reset();
        flurry.reset();
        expect(flurry.counts().particles).toBe(0);
    });

    it('releases what it made once, and is inert afterwards', () => {
        const flurry = createFlurry();
        const scene = new THREE.Scene();
        scene.add(flurry.group);
        play(flurry, [cue('leaves')]);
        const disposals = [flurry.mesh.geometry, flurry.mesh.material].map((resource) => vi.spyOn(resource, 'dispose'));
        flurry.dispose();
        flurry.dispose();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toEqual([]);
        expect(flurry.group.children).toEqual([]);
        expect(flurry.mesh).toBeNull();
        expect(() => {
            play(flurry, KINDS.map((kind, serial) => cue(kind, { serial: 10 + serial })), { time: NOW + 1 });
            flurry.trickle(1, 3);
            flurry.reset();
            flurry.flush();
            flurry.counts();
        }).not.toThrow();
    });
});

describe('Forest flurry: reading what the director asks', () => {
    it('plays each request once, oldest first by its serial, whatever order the queue holds them in', () => {
        const flurry = createFlurry();
        const order = [];
        for (const kind of KINDS) {
            vi.spyOn(flurry, METHODS[kind]).mockImplementation((asked) => order.push(`${asked.serial}:${asked.kind}`));
        }
        // A ring buffer: its slots are not in the order they were asked.
        const queue = [cue('leaves', { serial: 4 }), cue('dew', { serial: 0 }), cue('wisps', { serial: 3 }),
            cue('bloom', { serial: 1 }), cue('goldfall', { serial: 5 }), cue('spores', { serial: 2 })];
        play(flurry, queue);
        expect(order).toEqual(['0:dew', '1:bloom', '2:spores', '3:wisps', '4:leaves', '5:goldfall']);
        // The same queue, frame after frame: nothing is played twice.
        for (let frame = 1; frame <= 5; frame++) play(flurry, queue, { time: NOW + frame * STEP });
        expect(order).toHaveLength(6);
        // The ring comes round: the oldest slot is given to a new request, and only that one plays.
        queue[1] = cue('dew', { serial: 6 });
        play(flurry, queue, { time: NOW + 1 });
        expect(order.slice(6)).toEqual(['6:dew']);
        // Each is handed the stage it is to be thrown on; leaves are handed the wind.
        expect(flurry.leaves).toHaveBeenCalledWith(queue[0], stage, undefined);
        queue[0] = cue('leaves', { serial: 7 });
        const wind = { x: 0.6, z: 0.8 };
        play(flurry, queue, { time: NOW + 2, wind });
        expect(flurry.leaves).toHaveBeenLastCalledWith(queue[0], stage, wind);
    });

    it('really throws each kind once: the same request leaves the same particles in flight', () => {
        for (const kind of KINDS) {
            const flurry = createFlurry();
            const first = play(flurry, [cue(kind)]);
            expect(first.thrown, kind).toBeGreaterThan(0);
            const data = Array.from(flurry.data);
            for (let frame = 1; frame <= 3; frame++) {
                expect(play(flurry, [cue(kind)], { time: NOW + frame * STEP }).thrown, kind).toBe(first.thrown);
            }
            expect(Array.from(flurry.data)).toEqual(data);
        }
    });

    it('starts counting afresh when the director itself has started over', () => {
        const flurry = createFlurry();
        const spy = vi.spyOn(flurry, 'wisps');
        play(flurry, [cue('wisps', { serial: 0 }), cue('wisps', { serial: 1 })], { epoch: 1 });
        expect(spy).toHaveBeenCalledTimes(2);
        // A new session numbers its requests from zero again: they are new, not the old 0 and 1.
        play(flurry, [cue('wisps', { serial: 0 })], { epoch: 2, time: NOW + 1 });
        expect(spy).toHaveBeenCalledTimes(3);
        play(flurry, [cue('wisps', { serial: 0 })], { epoch: 2, time: NOW + 2 });
        expect(spy).toHaveBeenCalledTimes(3);
        // A frame that says nothing of an epoch is one too (a playground, a bare test).
        flurry.play({ flurries: [cue('wisps', { serial: 0 })] }, { time: NOW + 3, stage });
        expect(spy).toHaveBeenCalledTimes(4);
        flurry.play({ flurries: [cue('wisps', { serial: 0 })] }, { time: NOW + 4, stage });
        expect(spy).toHaveBeenCalledTimes(4);
    });

    it('lets go of what is not a request, without a word', () => {
        const flurry = createFlurry();
        const spies = KINDS.map((kind) => vi.spyOn(flurry, METHODS[kind]));
        const junk = [null, undefined, 7, 'dew', [], {}, { serial: -1, kind: 'dew', strength: 1 },
            { serial: NaN, kind: 'dew', strength: 1 }, { kind: 'dew', strength: 1 },
            cue('confetti', { serial: 0 }), cue('dew', { serial: 1, strength: 0 }),
            cue('bloom', { serial: 2, strength: -1 }), cue('spores', { serial: 3, strength: NaN }),
            cue('leaves', { serial: 4, strength: null }), cue(undefined, { serial: 5 }), cue('goldfall', { serial: 6, strength: '1' })];
        expect(() => play(flurry, junk)).not.toThrow();
        // ('1' is a strength a loose comparison takes for one: that request alone is played.)
        expect(spies.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 1]);
        expect(allFinite(flurry.data)).toBe(true);
        // A frame that is no frame, or whose queue is no queue, is an idle frame.
        for (const frame of [null, undefined, {}, { flurries: null }, { flurries: 'all' }, { flurries: 3 }, 7, 'x']) {
            expect(() => flurry.play(frame, { time: NOW + 1, dt: STEP, stage })).not.toThrow();
            expect(() => flurry.play(frame)).not.toThrow();
        }
        expect(allFinite(flurry.data)).toBe(true);
    });

    it('throws nothing without a stage to throw it on, and does not save the request for later', () => {
        const flurry = createFlurry();
        expect(() => flurry.play({ epoch: 1, flurries: [cue('goldfall')] }, { time: NOW, dt: STEP })).not.toThrow();
        expect(flurry.counts()).toEqual({ particles: 0, thrown: 0, refused: 0 });
        // The moment has passed: a stage a frame later does not bring the gold down late.
        expect(play(flurry, [cue('goldfall')], { time: NOW + STEP }).thrown).toBe(0);
    });

    it('keeps the last good time when it is handed none', () => {
        const flurry = createFlurry();
        play(flurry, [cue('goldfall')], { time: 5 });
        const flying = flurry.counts().particles;
        for (const time of [NaN, undefined, null, Infinity, -Infinity, '9', {}]) {
            flurry.play({ epoch: 1, flurries: [cue('goldfall')] }, { time, dt: STEP, stage });
            expect(flurry.time, String(time)).toBe(5);
            expect(flurry.counts().particles).toBe(flying);
            expect(flurry.mesh.visible).toBe(true);
        }
    });
});

describe('Forest flurry: an instrument for every event', () => {
    it('gives each kind a colour and a way of moving of its own, and only sound numbers', () => {
        const colours = new Map();
        const motions = {
            dew: 'drop', bloom: 'mote', spores: 'mote', wisps: 'helix', leaves: 'glide', goldfall: 'mote',
        };
        for (const kind of KINDS) {
            const { flurry, list } = thrownBy(kind);
            expect(list.length, kind).toBeGreaterThan(3);
            expect(list.length, kind).toBe(flurry.counts().thrown);
            expect(flurry.counts().refused, kind).toBe(0);
            expect(allFinite(flurry.data), kind).toBe(true);
            const seen = new Set(list.map((record) => record.colour.map((channel) => channel.toFixed(4)).join(',')));
            // One colour to an instrument.
            expect(seen.size, kind).toBe(1);
            colours.set(kind, [...seen][0]);
            for (const record of list) {
                expect(record.motion, kind).toBe(FOREST_FLURRY_MOTION[motions[kind]]);
                expect(record.life, kind).toBeGreaterThan(0);
                expect(record.life, kind).toBeLessThan(30);
                expect(record.size, kind).toBeGreaterThan(0);
                expect(record.size, kind).toBeLessThan(1);
                expect(record.seed, kind).toBeGreaterThanOrEqual(0);
                expect(record.seed, kind).toBeLessThan(1);
                // Born now or a little later, never in the past (it would be drawn part-way through its life).
                expect(record.birth, kind).toBeGreaterThanOrEqual(Math.fround(NOW));
                expect(record.birth, kind).toBeLessThan(NOW + 10);
                expect(record.moonlit, kind).toBeGreaterThanOrEqual(0);
                expect(record.moonlit, kind).toBeLessThanOrEqual(1);
                record.colour.forEach((channel) => expect(channel).toBeGreaterThanOrEqual(0));
                expect(Math.max(...record.colour), kind).toBeGreaterThan(0);
            }
        }
        // No two great moments look alike.
        expect(new Set(colours.values()).size).toBe(KINDS.length);
        // Dew and leaves have no light of their own: they shine where the moon finds them. The rest glow.
        const moonlit = (kind) => thrownBy(kind).list[0].moonlit;
        expect(moonlit('dew')).toBe(1);
        expect(moonlit('leaves')).toBeGreaterThan(0);
        for (const kind of ['bloom', 'spores', 'wisps', 'goldfall']) expect(moonlit(kind), kind).toBe(0);
    });

    it.each(['dew', 'bloom', 'spores', 'leaves', 'goldfall'])('throws no less %s for a stronger call, and bounds a wild one', (
        kind,
    ) => {
        const counts = [0.25, 0.5, 1].map((strength) => thrownBy(kind, { strength }).list.length);
        expect(counts[0]).toBeGreaterThan(0);
        for (let index = 1; index < counts.length; index++) expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]);
        expect(counts.at(-1)).toBeGreaterThan(counts[0]);
        // A strength far beyond anything the director sends is the strongest call there is, not more.
        const wild = thrownBy(kind, { strength: 1e9 });
        expect(wild.list.length).toBeLessThanOrEqual(thrownBy(kind, { strength: 1.5 }).list.length);
        expect(allFinite(wild.flurry.data)).toBe(true);
    });

    it.each(KINDS)('throws less %s on a leaner tier, never more', (kind) => {
        const capacities = Object.values(FOREST_TIERS).map((tier) => tier.flurry).sort((a, b) => a - b);
        const counts = capacities.map((capacity) => {
            const { flurry, list } = thrownBy(kind, { options: { capacity } });
            // A lone burst fits the tier's ring with room to spare for the next.
            expect(flurry.counts().refused, `${kind} at ${capacity}`).toBe(0);
            expect(list.length, `${kind} at ${capacity}`).toBeLessThan(capacity);
            return list.length;
        });
        for (let index = 1; index < counts.length; index++) expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]);
        expect(counts[0]).toBeGreaterThan(0);
    });

    it('lets dew fall from the boughs and from overhead, each drop for as long as its fall', () => {
        const { list } = thrownBy('dew');
        const falls = list.map((drop) => {
            const height = drop.y - forestGroundHeight(drop.x, drop.z);
            return { ...drop, height, pull: (2 * height) / (drop.life * drop.life) };
        });
        for (const drop of falls) {
            // Let go, not thrown: it starts well clear of the moss and is on its way down.
            expect(drop.height).toBeGreaterThan(0.5);
            expect(drop.vy).toBeLessThan(0);
            expect(Math.hypot(drop.vx, drop.vz)).toBeLessThan(1);
        }
        // One gravity for all of them: a drop from higher lives longer, by the law of a fall (the
        // highest of all are let go after a few seconds in the air).
        const longest = Math.max(...falls.map((drop) => drop.life));
        const falling = falls.filter((drop) => drop.life < longest * 0.999);
        expect(falling.length).toBeGreaterThan(falls.length * 0.5);
        const pulls = falling.map((drop) => drop.pull);
        expect(Math.min(...pulls)).toBeGreaterThan(0);
        expect(Math.max(...pulls) / Math.min(...pulls)).toBeLessThan(1.001);
        for (const drop of falls.filter((entry) => entry.life >= longest * 0.999)) {
            expect(drop.pull).toBeLessThanOrEqual(Math.max(...pulls) * 1.001);
        }
        // Some are shaken off the boughs themselves, the rest come into the frame from its top.
        const offBoughs = falls.filter((drop) => nearSite(drop, BOUGHS, 1.2) >= 0);
        expect(offBoughs.length).toBeGreaterThan(falls.length * 0.15);
        expect(offBoughs.length).toBeLessThan(falls.length * 0.85);
        // With no boughs to shake (an empty pack) it all comes from overhead, and still falls.
        const bare = thrownBy('dew', { options: { boughs: NONE } });
        expect(bare.list.length).toBeGreaterThan(10);
        for (const drop of bare.list) expect(drop.vy).toBeLessThan(0);
        for (const boughs of [new Float32Array(2), null, undefined]) {
            expect(thrownBy('dew', { options: { boughs } }).list.length).toBeGreaterThan(10);
        }
    });

    it('lifts the bloom off the wood stars in a ring that widens from behind the board', () => {
        const ring = vi.spyOn(light, 'bloom');
        const { list } = thrownBy('bloom', { column: 0.3, row: 0.2, strength: 0.8 });
        // The flowers themselves flare as the ring passes: one ring of the light rig's, started here,
        // from the floor behind the place on the board.
        expect(ring).toHaveBeenCalledOnce();
        const [x, z, strength, speed] = ring.mock.calls[0];
        const origin = stage.floor(0.3, 0.2);
        expect([x, z]).toEqual([origin.x, origin.z]);
        expect(strength).toBeCloseTo(0.8, 12);
        expect(speed).toBeGreaterThan(0);
        expect(list.length).toBeGreaterThan(20);
        expect(list.length).toBeLessThanOrEqual(FLOWERS.length / 3);
        const used = new Set();
        for (const mote of list) {
            // Each lifts off a flower of its own, and rises.
            const flower = nearSite(mote, FLOWERS, 1e-4);
            expect(flower).toBeGreaterThanOrEqual(0);
            expect(used.has(flower)).toBe(false);
            used.add(flower);
            expect(mote.y - FLOWERS[flower * 3 + 1]).toBeGreaterThanOrEqual(0);
            expect(mote.y - FLOWERS[flower * 3 + 1]).toBeLessThan(0.5);
            expect(mote.vy).toBeGreaterThan(0);
            expect(mote.more).toBeGreaterThan(0);
            // It lifts as the ring reaches it: no sooner than the ring can get there, and soon after.
            const away = Math.hypot(mote.x - origin.x, mote.z - origin.z);
            const waited = mote.birth - NOW;
            expect(waited).toBeGreaterThanOrEqual(away / speed - 1e-4);
            expect(waited).toBeLessThan(away / speed + 0.5);
        }
        // A weaker ring reaches less far.
        const reach = (motes) => Math.max(...motes.map((mote) => Math.hypot(mote.x - origin.x, mote.z - origin.z)));
        const weak = thrownBy('bloom', { column: 0.3, row: 0.2, strength: 0.25 });
        expect(reach(weak.list)).toBeLessThan(reach(list));
        // With no flowers (the leanest tier) the ring still runs over the floor; nothing lifts.
        ring.mockClear();
        const none = thrownBy('bloom', { options: { flowers: NONE } });
        expect(none.list).toEqual([]);
        expect(ring).toHaveBeenCalledOnce();
        // And a light rig without a ring to start is no reason to stumble.
        const plain = thrownBy('bloom', { options: { rig: { uTime: light.uTime } } });
        expect(plain.list.length).toBeGreaterThan(0);
    });

    it('breathes spores out of every fungus as the wave reaches it, and off the moss between them', () => {
        const { list } = thrownBy('spores', { column: 0.5, row: 0.1 });
        const origin = stage.floor(0.5, 0.1);
        const fromCaps = list.filter((spore) => nearSite(spore, CAPS, 0.1) >= 0);
        const fromMoss = list.filter((spore) => nearSite(spore, CAPS, 0.1) < 0);
        // Every cluster in the wood breathes.
        expect(new Set(fromCaps.map((spore) => nearSite(spore, CAPS, 0.1))).size).toBe(CAPS.length / 3);
        expect(fromMoss.length).toBeGreaterThan(20);
        for (const spore of list) {
            // Out and up, then drifting on up by itself.
            expect(spore.vy).toBeGreaterThan(0);
            expect(spore.more).toBeGreaterThan(0);
        }
        // Cluster after cluster: none before the wave from the board can have reached it.
        const pace = Math.max(...fromCaps.map((spore) => (
            Math.hypot(spore.x - origin.x, spore.z - origin.z) / Math.max(spore.birth - NOW, 1e-6))));
        expect(Number.isFinite(pace)).toBe(true);
        const far = fromCaps.filter((spore) => Math.hypot(spore.x - origin.x, spore.z - origin.z) > 30);
        const near = fromCaps.filter((spore) => Math.hypot(spore.x - origin.x, spore.z - origin.z) < 12);
        expect(far.length).toBeGreaterThan(0);
        expect(near.length).toBeGreaterThan(0);
        expect(Math.min(...far.map((spore) => spore.birth))).toBeGreaterThan(Math.max(...near.map((spore) => spore.birth)));
        // The moss lifts them from the floor itself, on both sides of the board.
        for (const spore of fromMoss) {
            const above = spore.y - forestGroundHeight(spore.x, spore.z);
            expect(above).toBeGreaterThan(0);
            expect(above).toBeLessThan(0.5);
        }
        const middle = stage.floor(0.5, 0.3).x;
        expect(fromMoss.some((spore) => spore.x < middle - 3)).toBe(true);
        expect(fromMoss.some((spore) => spore.x > middle + 3)).toBe(true);
    });

    it('winds wisps up out of the ferns beside the board, on the side the piece turned', () => {
        const edges = { '-1': stage.edge(-1, 0, FOREST_STAGE_DEPTH).clone(), 1: stage.edge(1, 0, FOREST_STAGE_DEPTH).clone() };
        for (const side of [-1, 1]) {
            const { list } = thrownBy('wisps', { side });
            expect(list.length).toBeGreaterThanOrEqual(6);
            // They wind round one axis, which stands on the floor beside the card's edge, outside it.
            const [first] = list;
            for (const wisp of list) expect([wisp.x, wisp.y, wisp.z]).toEqual([first.x, first.y, first.z]);
            expect(Math.sign(first.x - edges[side].x)).toBe(side);
            expect(Math.abs(first.x - edges[side].x)).toBeLessThan(4);
            const above = first.y - forestGroundHeight(first.x, first.z);
            expect(above).toBeGreaterThan(0);
            expect(above).toBeLessThan(1);
            for (const wisp of list) {
                // (For a helix the flight holds its turn rate, its climb and its first radius.)
                expect(Math.sign(wisp.vx)).toBe(side);
                expect(wisp.vy).toBeGreaterThan(0);
                expect(wisp.vz).toBeGreaterThan(0);
            }
            // More than one strand, each a string of lights let go one after another.
            const strands = new Set(list.map((wisp) => wisp.seed));
            expect(strands.size).toBeGreaterThanOrEqual(2);
            expect(list.length % strands.size).toBe(0);
            for (const strand of strands) {
                const births = list.filter((wisp) => wisp.seed === strand).map((wisp) => wisp.birth);
                expect(new Set(births).size).toBe(births.length);
                expect(Math.max(...births) - Math.min(...births)).toBeGreaterThan(0.3);
            }
        }
        // A side that is neither is the right; one that is no number does not break the wind-up.
        for (const side of [0, undefined, NaN, null, 'left']) {
            const { flurry, list } = thrownBy('wisps', { side });
            expect(list.length).toBeGreaterThan(0);
            expect(allFinite(flurry.data)).toBe(true);
        }
    });

    it('carries leaves across the glade on the wind it is handed', () => {
        for (const wind of [{ x: 1, z: 0 }, { x: 0.6, z: 0.8 }, { x: -3, z: 4 }, { x: 0, z: -0.01 }]) {
            const { list } = thrownBy('leaves', { playing: { wind } });
            expect(list.length).toBeGreaterThan(20);
            const span = Math.hypot(wind.x, wind.z);
            for (const leaf of list) {
                // Downwind, at a walking-to-running pace, whatever the wind's own length is.
                const along = (leaf.vx * wind.x + leaf.vz * wind.z) / span;
                const across = (leaf.vx * wind.z - leaf.vz * wind.x) / span;
                expect(along).toBeGreaterThan(1);
                expect(along).toBeLessThan(20);
                expect(Math.abs(across)).toBeLessThan(1e-4);
                // It sinks as it goes, and starts clear of the floor.
                expect(leaf.more).toBeLessThan(0);
                expect(leaf.y - forestGroundHeight(leaf.x, leaf.z)).toBeGreaterThan(0.3);
            }
            // They come across with the front of the wind, not all at once.
            const births = list.map((leaf) => leaf.birth);
            expect(Math.max(...births) - Math.min(...births)).toBeGreaterThan(0.5);
        }
        // Handed no wind it uses one of its own; handed one that is no wind it lets them go.
        expect(thrownBy('leaves').list.length).toBeGreaterThan(20);
        for (const wind of [{ x: NaN, z: 0 }, { x: Infinity, z: 1 }, { x: 'east', z: 0 }, {}]) {
            const { flurry } = thrownBy('leaves', { playing: { wind } });
            expect(allFinite(flurry.data), JSON.stringify(wind)).toBe(true);
        }
    });

    it('lets gold fall through the whole air: off the boughs and out of the dark above', () => {
        const { list } = thrownBy('goldfall');
        for (const mote of list) {
            // It sinks, slowly, from above the floor.
            expect(mote.vy).toBeLessThanOrEqual(0);
            expect(mote.more).toBeLessThan(0);
            expect(mote.y - forestGroundHeight(mote.x, mote.z)).toBeGreaterThan(0.6);
        }
        // The whole air, not one place: wide, deep, and from the ferns to the crowns.
        const spread = (key) => Math.max(...list.map((mote) => mote[key])) - Math.min(...list.map((mote) => mote[key]));
        expect(spread('x')).toBeGreaterThan(20);
        expect(spread('z')).toBeGreaterThan(20);
        expect(spread('y')).toBeGreaterThan(6);
        // Not all at once.
        expect(spread('birth')).toBeGreaterThan(0.5);
        // It outlasts everything else: the greatest of the instruments.
        const longest = (kind) => Math.max(...thrownBy(kind).list.map((record) => record.life));
        for (const kind of ['dew', 'bloom', 'wisps']) expect(longest('goldfall')).toBeGreaterThan(longest(kind));
        expect(thrownBy('goldfall', { options: { boughs: NONE } }).list.length).toBe(list.length);
    });

    it('throws them where the board is measured to be', () => {
        const moved = createStage();
        moved.setBoard({
            x0: 0.05, x1: 0.3, y0: 0.1, y1: 0.9,
        });
        const usual = thrownBy('wisps', { side: 1 }).list[0];
        const left = thrownBy('wisps', { side: 1, playing: { on: moved } }).list[0];
        expect(left.x).toBeLessThan(usual.x - 2);
        const ring = vi.spyOn(light, 'bloom');
        thrownBy('bloom', { playing: { on: moved } });
        thrownBy('bloom');
        expect(ring.mock.calls[0][0]).toBeLessThan(ring.mock.calls[1][0] - 1);
    });
});

describe('Forest flurry: the fungi breathing by themselves', () => {
    /** Live `seconds` of a night with the air letting `rate` bursts a second go; how many clusters breathed. */
    function breaths(rate, {
        seconds = 20, step = STEP, options = {}, settled = false,
    } = {}) {
        const flurry = createFlurry(options);
        const puff = vi.spyOn(flurry, 'puff');
        let time = 0;
        const most = { frame: 0 };
        for (let frame = 0; frame < Math.round(seconds / step); frame++) {
            time += step;
            const before = puff.mock.calls.length;
            play(flurry, [], {
                time, dt: step, air: { spores: rate }, settled,
            });
            most.frame = Math.max(most.frame, puff.mock.calls.length - before);
        }
        return {
            count: puff.mock.calls.length, most: most.frame, flurry, puff,
        };
    }

    it('lets a few spores go at the air\'s rate, one cluster at a time', () => {
        const slow = breaths(0.5);
        const quick = breaths(1.5);
        // About the rate, by the clock: a burst here, a burst there, never a wave.
        expect(slow.count).toBeGreaterThanOrEqual(8);
        expect(slow.count).toBeLessThanOrEqual(11);
        expect(quick.count).toBeGreaterThan(slow.count * 2.5);
        expect(quick.count).toBeLessThan(slow.count * 3.5);
        expect(quick.most).toBeLessThanOrEqual(2);
        for (const [x, y, z, count, delay] of quick.puff.mock.calls) {
            // Each is one cap's breath, now.
            let own = false;
            for (let index = 0; index < CAPS.length; index += 3) {
                own = own || (x === CAPS[index] && y === CAPS[index + 1] && z === CAPS[index + 2]);
            }
            expect(own).toBe(true);
            expect(count).toBeGreaterThanOrEqual(1);
            expect(count).toBeLessThan(20);
            expect(delay).toBe(0);
        }
        // The same by the clock at another frame rate.
        expect(Math.abs(breaths(1.5, { step: 1 / 20 }).count - quick.count)).toBeLessThanOrEqual(1);
        expect(allFinite(quick.flurry.data)).toBe(true);
        expect(quick.flurry.counts().refused).toBe(0);
    });

    it.each([
        ['an air that lets none go', { rate: 0 }], ['a rate below nothing', { rate: -4 }], ['a rate that is no number', { rate: NaN }],
        ['a rate without end', { rate: Infinity }], ['no word of a rate', { rate: undefined }],
        ['a wood without fungi', { rate: 2, options: { caps: NONE } }],
        ['a run that is over', { rate: 2, settled: true }],
    ])('lets nothing go by itself for %s', (_label, { rate, options, settled }) => {
        const { count, flurry } = breaths(rate, { seconds: 5, options, settled });
        expect(count).toBe(0);
        expect(flurry.counts()).toEqual({ particles: 0, thrown: 0, refused: 0 });
        expect(flurry.mesh.visible).toBe(false);
    });

    it('never lets more than a couple go in a frame, however long the frame, and saves no backlog', () => {
        const flurry = createFlurry();
        const puff = vi.spyOn(flurry, 'puff');
        // A hitch of a minute (a hidden tab coming back).
        play(flurry, [], { time: 60, dt: 60, air: { spores: 3 } });
        expect(puff.mock.calls.length).toBeLessThanOrEqual(2);
        const after = puff.mock.calls.length;
        // The frames after it are ordinary frames: no flood of what the minute would have let go.
        for (let frame = 1; frame <= 60; frame++) {
            play(flurry, [], { time: 60 + frame * STEP, dt: STEP, air: { spores: 3 } });
        }
        expect(puff.mock.calls.length - after).toBeLessThanOrEqual(3 + 2);
        // A step that is no time lets nothing go.
        const settledAt = puff.mock.calls.length;
        for (const dt of [0, -1, NaN, undefined, null, 'x']) {
            flurry.play({ epoch: 1, flurries: [] }, {
                time: 70, dt, stage, air: { spores: 3 },
            });
        }
        expect(puff.mock.calls.length).toBe(settledAt);
        // And a reset forgets the breath that was due.
        play(flurry, [], { time: 71, dt: 0.3, air: { spores: 3 } });
        flurry.reset();
        const beforeReset = puff.mock.calls.length;
        play(flurry, [], { time: 71 + STEP, dt: STEP, air: { spores: 3 } });
        expect(puff.mock.calls.length).toBe(beforeReset);
    });
});

describe('Forest flurry: a frenzy', () => {
    /** A minute of everything at once at 60 fps, through the real director. */
    function frenzy(capacity, { seconds = 60, air = { spores: 1.4 }, quality = 'High' } = {}) {
        const flurry = createFlurry({ capacity });
        const reactions = new ForestReactions({ quality, rng: seededRandom(5) });
        const ends = new Float64Array(flurry.capacity);
        const seen = {
            cut: 0, most: 0, refusedFrames: 0, kinds: new Set(), hidden: 0,
        };
        let snapshot = new Float32Array(flurry.data.length);
        for (let frame = 0; frame < seconds * 60; frame++) {
            reactions.onHardDrop({ distance: 18 });
            reactions.onPieceLock({ piece: { x: frame % 10, y: 22, shape: [[1]] } });
            if (frame % 3 === 0) reactions.onLineClear(1 + (frame % 4), { clearedRows: [23] });
            if (frame % 5 === 0) reactions.onTwist({ piece: { x: frame % 8, y: 18, shape: [[1]] } });
            if (frame % 7 === 0) reactions.onBackToBack();
            if (frame % 50 === 0) reactions.onPerfectClear();
            if (frame % 70 === 0) reactions.onLevelUp();
            const state = reactions.update(STEP);
            state.flurries.forEach((entry) => { if (entry.serial >= 0) seen.kinds.add(entry.kind); });
            ends.set(flurry.ends);
            snapshot.set(flurry.data);
            const before = flurry.counts();
            flurry.play(state, {
                time: reactions.time, dt: STEP, stage, wind: { x: 0.88, z: 0.47 }, air,
            });
            const after = flurry.counts();
            for (let slot = 0; slot < flurry.capacity; slot++) {
                // A particle that was still in flight at this frame's time must be exactly as it was thrown.
                if (!(ends[slot] > reactions.time)) continue;
                let same = flurry.ends[slot] === ends[slot];
                for (let k = 0; k < STRIDE && same; k++) same = flurry.data[slot * STRIDE + k] === snapshot[slot * STRIDE + k];
                if (!same) seen.cut += 1;
            }
            expect(after.particles).toBeLessThanOrEqual(flurry.capacity);
            expect(after.thrown).toBeGreaterThanOrEqual(before.thrown);
            expect(after.refused).toBeGreaterThanOrEqual(before.refused);
            if (after.refused > before.refused) seen.refusedFrames += 1;
            seen.most = Math.max(seen.most, after.particles);
            // (Hidden is right when nothing is in flight: a ring of one has such moments between requests.)
            if (!flurry.mesh.visible && after.particles > 0) seen.hidden += 1;
            if (!allFinite(flurry.data)) throw new Error(`the flurry's buffer went non-finite at frame ${frame}`);
        }
        snapshot = null;
        return { flurry, reactions, seen };
    }

    it.each([1, 7, 320, 2600])('never cuts a particle in flight in a ring of %i, however hard the game pushes', (capacity) => {
        const { flurry, reactions, seen } = frenzy(capacity, { seconds: capacity > 1000 ? 60 : 20 });
        // Every instrument was asked for, the ring filled, and it was always the new one that was let go.
        expect([...seen.kinds].sort()).toEqual([...KINDS].sort());
        expect(seen.most).toBe(capacity);
        expect(seen.refusedFrames).toBeGreaterThan(0);
        expect(seen.cut).toBe(0);
        expect(seen.hidden).toBe(0);
        const { thrown, refused } = flurry.counts();
        expect(thrown).toBeGreaterThan(capacity);
        expect(refused).toBeGreaterThan(0);
        // When the hands rest it all goes out by itself, and the draw is switched off.
        let { time } = reactions;
        for (let second = 0; second < 30; second++) {
            time += 1;
            flurry.play(reactions.update(1), { time, dt: 1, stage });
        }
        expect(flurry.counts()).toEqual({ particles: 0, thrown, refused });
        expect(flurry.mesh.visible).toBe(false);
    // (A minute of frenzy, every record compared every frame: about 3 s alone, past 30 s on a loaded machine.)
    }, 120000);

    it('stays sound when its random source, or the ground under it, misbehaves', () => {
        for (const rng of [() => NaN, () => Infinity, () => -5, () => 7, () => '0.5', () => undefined, () => 1]) {
            const flurry = createFlurry({ rng });
            expect(() => play(flurry, KINDS.map((kind, serial) => cue(kind, { serial })), { air: { spores: 3 } })).not.toThrow();
            expect(allFinite(flurry.data)).toBe(true);
            for (const record of records(flurry)) {
                expect(record.seed).toBeGreaterThanOrEqual(0);
                expect(record.seed).toBeLessThan(1);
                expect(record.life).toBeGreaterThan(0);
            }
            expect(flurry.counts().thrown).toBeGreaterThan(0);
        }
        // Ground that is no height anywhere: what must stand on it is let go, the rest still flies.
        for (const groundHeight of [() => NaN, () => Infinity, () => undefined]) {
            const flurry = createFlurry({ groundHeight });
            expect(() => play(flurry, KINDS.map((kind, serial) => cue(kind, { serial })))).not.toThrow();
            expect(allFinite(flurry.data), String(groundHeight())).toBe(true);
        }
    });

    it('throws the same particles for the same requests from the same seed', () => {
        const run = (seed) => {
            const flurry = createFlurry({ seed });
            const reactions = new ForestReactions({ rng: seededRandom(5) });
            for (let frame = 0; frame < 240; frame++) {
                if (frame % 40 === 0) {
                    reactions.onHardDrop({ distance: 18 });
                    reactions.onPieceLock({ piece: { x: frame % 10, y: 22, shape: [[1]] } });
                    reactions.onLineClear(1 + ((frame / 40) % 4), { clearedRows: [23] });
                }
                if (frame === 100) reactions.onTwist({ piece: { x: 7, y: 18, shape: [[1]] } });
                if (frame === 150) reactions.onPerfectClear();
                if (frame === 200) reactions.onLevelUp();
                flurry.play(reactions.update(STEP), {
                    time: reactions.time, dt: STEP, stage, air: { spores: 1 },
                });
            }
            return { data: Array.from(flurry.data), counts: flurry.counts() };
        };
        const first = run(11);
        expect(first.counts.thrown).toBeGreaterThan(500);
        expect(run(11)).toEqual(first);
        expect(run(12).data).not.toEqual(first.data);
        // What it throws never draws on the forest's own generator: it has its own.
        expect(run(11).counts).toEqual(first.counts);
    });
});

describe('Forest flurry: the shader', () => {
    const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

    it.each(BACKENDS)('builds for %s without a word, placing every record by the rig\'s own clock', (name, Builder) => {
        const flurry = createFlurry({ capacity: 64 });
        const out = build(Builder, flurry.mesh, stubRenderer());
        expect(out.thrown).toBeUndefined();
        expect(out.heard).toEqual([]);
        for (const source of [out.vertex, out.fragment]) {
            expect(source.length).toBeGreaterThan(200);
            expect(source.length).toBeLessThan(48 * 1024);
            expect(source).not.toMatch(/\bNaN\b|\bInfinity\b|\binf\b|\[object |undefined/);
        }
        // The four record attributes are read in the vertex stage, and nothing of them in the fragment's.
        for (const attribute of ['iFlurryA', 'iFlurryB', 'iFlurryC', 'iFlurryD']) {
            expect(out.vertex, attribute).toContain(attribute);
            expect(out.fragment, attribute).not.toContain(attribute);
        }
        // Closed form: no loop, and no texture read to place a particle.
        expect(out.vertex).not.toMatch(/\bfor\s*\(|\bloop\b|textureSample|texture\(/);
        if (name === 'WGSL') {
            expect(unassignedReads(out.vertex)).toEqual([]);
            expect(unassignedReads(out.fragment)).toEqual([]);
        }
    });
});
