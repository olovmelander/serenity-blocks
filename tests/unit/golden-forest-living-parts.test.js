/**
 * Golden Forest — the living lake, part two: the parts that draw the events, each on its own (a
 * light rig and no asset pack, no GPU).
 *
 * What the lake throws into the air (golden-forest-flurry.js: records in a ring that never cuts
 * one in flight), the marks the events leave on the water (GoldenForestLake.setTracks), the air
 * and the cloud's clock on the light rig, the fan's shafts in the lens, the skein of cranes an
 * event calls across the sun (golden-forest-crane-flight.js), the boat that rocks, the smoke on
 * the water and the far ranges' mesh.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GOLDEN_FOREST_AIRS, GOLDEN_FOREST_AIR_SCALARS,
} from '../../src/themes/golden-forest/golden-forest-airs.js';
import { GoldenForestAtmosphere } from '../../src/themes/golden-forest/golden-forest-atmosphere.js';
import { GoldenForestBackdrop, goldenForestRidgeCrest } from '../../src/themes/golden-forest/golden-forest-backdrop.js';
import {
    CALLED_SKEIN, CRANE_EYE, CRANE_STRIDE, CraneSky, SKEIN, craneFlockSizes,
} from '../../src/themes/golden-forest/golden-forest-crane-flight.js';
import { FLURRY_KIND, FLURRY_STRIDE, GoldenForestFlurry } from '../../src/themes/golden-forest/golden-forest-flurry.js';
import {
    GOLDEN_FOREST_MIRROR_LAYER, GOLDEN_FOREST_ROAD, GOLDEN_FOREST_SWIRL, GOLDEN_FOREST_WAVE, GoldenForestLake,
} from '../../src/themes/golden-forest/golden-forest-lake.js';
import {
    GOLDEN_FOREST_BREEZE, GOLDEN_FOREST_SUN_DIRECTION, GoldenForestLight,
} from '../../src/themes/golden-forest/golden-forest-light.js';
import { GoldenForestPost } from '../../src/themes/golden-forest/golden-forest-post.js';
import { GOLDEN_FOREST_TIERS } from '../../src/themes/golden-forest/golden-forest-quality.js';
import { GOLDEN_FOREST_RANGES } from '../../src/themes/golden-forest/golden-forest-ranges.js';
import {
    GOLDEN_FOREST_BEAM_SLOTS, GOLDEN_FOREST_FLURRIES, GOLDEN_FOREST_TRACK_SLOTS, GoldenForestReactions,
} from '../../src/themes/golden-forest/golden-forest-reactions.js';
import { GoldenForestShore } from '../../src/themes/golden-forest/golden-forest-shore.js';
import { GoldenForestStage } from '../../src/themes/golden-forest/golden-forest-stage.js';
import { goldenForestCamera, nonFiniteUniforms, seededRandom } from './helpers/golden-forest-lake.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const TIER_NAMES = Object.keys(GOLDEN_FOREST_TIERS);
const owned = [];

function own(resource) {
    owned.push(resource);
    return resource;
}

function makeLight(quality = 'Minimal') {
    return own(new GoldenForestLight({ tier: GOLDEN_FOREST_TIERS[quality], rng: seededRandom(3) }));
}

afterEach(() => {
    owned.splice(0).reverse().forEach((resource) => resource.dispose());
    vi.restoreAllMocks();
});

describe('what the lake throws into the air', () => {
    const KINDS = Object.keys(FLURRY_KIND);

    function makeFlurry({
        flurry = 48, puffs = 9, seed = 4, groundHeight = () => -1,
    } = {}) {
        const light = makeLight();
        const part = own(new GoldenForestFlurry({
            light, tier: { flurry, puffs }, rng: seededRandom(seed), groundHeight,
        })).build();
        return part;
    }

    const stage = () => new GoldenForestStage(goldenForestCamera());
    /** The records of a ring a particle has been written to (those with a life), as plain arrays. */
    const records = (ring) => {
        const found = [];
        for (let slot = 0; slot < ring.capacity; slot += 1) {
            const record = Array.from(ring.data.subarray(slot * FLURRY_STRIDE, (slot + 1) * FLURRY_STRIDE));
            if (record[7] > 0) found.push(record);
        }
        return found;
    };
    const ask = (kind, more = {}) => ({
        serial: 0, kind, column: 0.5, row: 0, side: 1, strength: 1, ...more,
    });
    const frameOf = (flurries, epoch = 1) => ({ epoch, flurries });

    it('knows the four bursts the director asks for, each by a number of its own', () => {
        expect(KINDS.sort()).toEqual([...GOLDEN_FOREST_FLURRIES].sort());
        expect(Object.isFrozen(FLURRY_KIND)).toBe(true);
        expect(new Set(Object.values(FLURRY_KIND)).size).toBe(KINDS.length);
        for (const value of Object.values(FLURRY_KIND)) expect(Number.isInteger(value) && value >= 0).toBe(true);
    });

    it('draws every particle from one record of three vec4s, and the clouds from another ring', () => {
        const flurry = makeFlurry({ flurry: 48, puffs: 9 });
        expect(FLURRY_STRIDE).toBe(12);
        expect(flurry.group.children).toEqual([flurry.mesh, flurry.puffMesh]);
        for (const [mesh, ring, names] of [[flurry.mesh, flurry.ring, ['iFlurryA', 'iFlurryB', 'iFlurryC']],
            [flurry.puffMesh, flurry.puffs, ['iPuffA', 'iPuffB', 'iPuffC']]]) {
            expect(mesh.geometry.instanceCount).toBe(ring.capacity);
            expect(ring.data).toHaveLength(ring.capacity * FLURRY_STRIDE);
            names.forEach((name, index) => {
                const attribute = mesh.geometry.getAttribute(name);
                expect(attribute.isInterleavedBufferAttribute, name).toBe(true);
                expect(attribute.itemSize).toBe(4);
                expect(attribute.offset).toBe(index * 4);
                expect(attribute.data).toBe(ring.buffer);
            });
            expect(ring.buffer.stride).toBe(FLURRY_STRIDE);
            expect(ring.buffer.array).toBe(ring.data);
            expect(ring.buffer.usage).toBe(THREE.DynamicDrawUsage);
            // Light in the air: blended over the scene, never written to depth, never culled away.
            expect(mesh.material.transparent).toBe(true);
            expect(mesh.material.depthWrite).toBe(false);
            expect(mesh.material.fog).toBe(false);
            expect(mesh.frustumCulled).toBe(false);
            expect(mesh.material.name).toMatch(/^GoldenForest/);
            const { positionNode, colorNode, opacityNode } = mesh.material;
            expect(positionNode.isNode && colorNode.isNode && opacityNode.isNode)
                .toBe(true);
        }
        expect(flurry.ring.capacity).toBe(48);
        expect(flurry.puffs.capacity).toBe(9);
        expect(flurry.mesh.material.blending).toBe(THREE.AdditiveBlending);
        expect(flurry.counts()).toEqual({
            particles: 0, clouds: 0, thrown: 0, refused: 0, breathed: 0,
        });
    });

    it('goes without a draw on a tier that has none, and without clouds where there are none', () => {
        const none = makeFlurry({ flurry: 0, puffs: 6 });
        expect(none.group.children).toEqual([]);
        expect(none.toss('droplets', 0, 1, 0, 0, 1, 0, 1, 0.1)).toBe(false);
        expect(none.cloud(0, 1, 0, 0, 0, 0, 1, 1, 1, 1)).toBe(false);
        expect(() => {
            none.play(frameOf(KINDS.map((kind, serial) => ask(kind, { serial }))), { time: 1, stage: stage() });
            none.reset();
        }).not.toThrow();
        expect(none.counts()).toEqual({
            particles: 0, clouds: 0, thrown: 0, refused: 0, breathed: 0,
        });
        const bare = makeFlurry({ flurry: 32, puffs: 0 });
        expect(bare.group.children).toEqual([bare.mesh]);
        expect(bare.cloud(0, 1, 0, 0, 0, 0, 1, 1, 1, 1)).toBe(false);
        expect(bare.toss('droplets', 0, 1, 0, 0, 1, 0, 1, 0.1)).toBe(true);
    });

    it('writes a particle once: where, which way, when, for how long, what it is', () => {
        const flurry = makeFlurry();
        flurry.time = 12;
        const { version } = flurry.ring.buffer;
        expect(flurry.toss('helix', 1, 2, 3, 4, 5, 6, 2.5, 0.25, -0.3, 0.5)).toBe(true);
        const [record] = records(flurry.ring);
        // start + birth, flight + life, kind + size + seed + one more.
        expect(record.slice(0, 8)).toEqual([1, 2, 3, 12.5, 4, 5, 6, 2.5]);
        expect(record[8]).toBe(FLURRY_KIND.helix);
        expect(record[9]).toBe(0.25);
        expect(record[10]).toBeGreaterThanOrEqual(0);
        expect(record[10]).toBeLessThan(1);
        expect(record[11]).toBeCloseTo(-0.3, 6);
        expect(flurry.counts()).toMatchObject({ particles: 1, thrown: 1, refused: 0 });
        // The GPU is handed what was written, once.
        flurry.flush();
        expect(flurry.ring.buffer.version).toBe(version + 1);
        flurry.flush();
        expect(flurry.ring.buffer.version).toBe(version + 1);
        // Nothing of it costs the CPU anything after: it is in flight until its life is over, then spent.
        flurry.time = 12.4;
        expect(flurry.counts().particles).toBe(1);
        flurry.time = 14.9;
        expect(flurry.counts().particles).toBe(1);
        flurry.time = 15.1;
        expect(flurry.counts()).toMatchObject({ particles: 0, thrown: 1 });
        expect(Array.from(flurry.ring.data.subarray(0, 8))).toEqual(record.slice(0, 8));
    });

    it('refuses a particle that is not numbers, and writes nothing of it', () => {
        const flurry = makeFlurry();
        const before = Array.from(flurry.ring.data);
        const good = [0, 1, 0, 0, 1, 0, 1, 0.1];
        for (let field = 0; field < good.length; field += 1) {
            for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'far', {}]) {
                const args = [...good];
                args[field] = junk;
                expect(flurry.toss('droplets', ...args), `field ${field} = ${String(junk)}`).toBe(false);
            }
        }
        expect(Array.from(flurry.ring.data)).toEqual(before);
        expect(flurry.counts()).toMatchObject({ particles: 0, thrown: 0 });
        // A kind it has never heard of is still a particle (the first kind's), not a hole in the buffer.
        expect(flurry.toss('confetti', ...good)).toBe(true);
        expect(records(flurry.ring)[0].every(Number.isFinite)).toBe(true);
    });

    it('never cuts a particle in flight: with the ring full it is the new one that is let go', () => {
        const flurry = makeFlurry({ flurry: 16, puffs: 3 });
        flurry.time = 5;
        for (let index = 0; index < 16; index += 1) {
            // Lives of 1 to 2.5 s, some thrown a moment late.
            const life = 1 + (index % 4) * 0.5;
            expect(flurry.toss('goldfall', index, 2, -index, 0, -1, 0, life, 0.1, 0, index % 2 ? 0.3 : 0))
                .toBe(true);
        }
        expect(flurry.counts()).toMatchObject({ particles: 16, thrown: 16, refused: 0 });
        const full = Array.from(flurry.ring.data);
        for (let extra = 0; extra < 40; extra += 1) {
            expect(flurry.toss('droplets', 99, 99, 99, 9, 9, 9, 9, 0.5)).toBe(false);
        }
        // Not one float of anything in flight was touched, and every refusal was counted.
        expect(Array.from(flurry.ring.data)).toEqual(full);
        expect(flurry.counts()).toMatchObject({ particles: 16, thrown: 16, refused: 40 });
        // The clouds' ring keeps the same rule.
        for (let index = 0; index < 3; index += 1) expect(flurry.cloud(index, 5, 0, 1, 0, 0, 4, 2, 1, 1)).toBe(true);
        const clouds = Array.from(flurry.puffs.data);
        expect(flurry.cloud(9, 9, 9, 9, 9, 9, 9, 9, 9, 9)).toBe(false);
        expect(Array.from(flurry.puffs.data)).toEqual(clouds);
        expect(flurry.counts()).toMatchObject({ clouds: 3, breathed: 3 });
        // As particles are spent their slots are taken again, and only theirs.
        flurry.time = 6.2;
        const spent = flurry.ring.capacity - flurry.counts().particles;
        expect(spent).toBeGreaterThan(0);
        expect(spent).toBeLessThan(16);
        let taken = 0;
        for (let extra = 0; extra < 16; extra += 1) taken += flurry.toss('helix', 50, 5, 5, 0, 1, 0, 3, 0.2) ? 1 : 0;
        expect(taken).toBe(spent);
        expect(flurry.counts().particles).toBe(16);
        const now = records(flurry.ring);
        expect(now.filter((record) => record[0] === 50)).toHaveLength(spent);
        // Those still in flight are exactly as they were written.
        for (const record of now.filter((entry) => entry[0] !== 50)) {
            const slot = record[0];
            expect(record).toEqual(full.slice(slot * FLURRY_STRIDE, (slot + 1) * FLURRY_STRIDE));
            expect(record[3] + record[7]).toBeGreaterThan(6.2);
        }
    });

    it('throws what the director asked for once each, in order, and starts over with a new session', () => {
        const flurry = makeFlurry({ flurry: 400, puffs: 9 });
        const thrown = [];
        for (const kind of ['droplets', 'helix', 'goldfall']) {
            vi.spyOn(flurry, kind).mockImplementation((asked) => thrown.push(`${kind} ${asked.serial}`));
        }
        const queue = [ask('helix', { serial: 2 }), ask('droplets', { serial: 0 }), ask('goldfall', { serial: 1 }),
            { serial: -1, kind: 'droplets', strength: 0 }];
        const at = { time: 3, stage: stage() };
        flurry.play(frameOf(queue), at);
        expect(thrown).toEqual(['droplets 0', 'goldfall 1', 'helix 2']);
        // The same queue again, frame after frame: nothing is thrown twice.
        for (let frame = 0; frame < 5; frame += 1) flurry.play(frameOf(queue), { ...at, time: 3 + frame * DT });
        expect(thrown).toHaveLength(3);
        // A slot of the queue written over with a newer serial is new; the others stay played.
        queue[1] = ask('droplets', { serial: 3 });
        flurry.play(frameOf(queue), at);
        expect(thrown).toEqual(['droplets 0', 'goldfall 1', 'helix 2', 'droplets 3']);
        // The director started over (a new epoch): its serials count from nothing again.
        const fresh = [ask('helix', { serial: 0 })];
        flurry.play(frameOf(fresh, 2), at);
        flurry.play(frameOf(fresh, 2), at);
        expect(thrown.slice(4)).toEqual(['helix 0']);
        // What cannot be thrown is spent all the same: no strength, no number, no such burst, no stage.
        const odd = [ask('helix', { serial: 1, strength: 0 }), ask('helix', { serial: 2, strength: NaN }),
            ask('confetti', { serial: 3 }), ask('droplets', { serial: 4, strength: -1 })];
        expect(() => flurry.play(frameOf(odd, 2), at)).not.toThrow();
        flurry.play(frameOf([...odd, ask('helix', { serial: 5 })], 2), { time: 4, stage: null });
        expect(thrown).toHaveLength(5);
        expect(flurry.serial).toBe(5);
        // A frame with no queue, or no frame at all, throws nothing and forgets nothing.
        const empty = [undefined, null, {}, { epoch: 2 }, { epoch: 2, flurries: 'none' }, { epoch: 2, flurries: [] }];
        for (const frame of empty) {
            expect(() => flurry.play(frame, at)).not.toThrow();
        }
        expect(thrown).toHaveLength(5);
        // The clock it throws by is the frame's, and a time that is no number leaves it where it was.
        flurry.play(frameOf([], 2), { time: 9, stage: null });
        flurry.play(frameOf([], 2), { time: NaN, stage: null });
        expect(flurry.time).toBe(9);
    });

    it('throws a crown of drops off the water beside the board, on the side it was struck', () => {
        const flurry = makeFlurry({ flurry: 600, puffs: 0 });
        const rest = stage();
        const ripples = { add: vi.fn() };
        const middle = (rest.edge(-1, 0).x + rest.edge(1, 0).x) / 2;
        flurry.play(frameOf([ask('droplets', { side: -1, strength: 0.35 })]), { time: 2, stage: rest, ripples });
        const gentle = records(flurry.ring);
        expect(gentle.length).toBeGreaterThan(4);
        for (const drop of gentle) {
            expect(drop[8]).toBe(FLURRY_KIND.droplets);
            // Off the water beside the card's left edge, upward, and back down within a few seconds.
            expect(drop[0]).toBeLessThan(middle);
            expect(Math.abs(drop[0] - rest.edge(-1, 0).x)).toBeLessThan(2.5);
            expect(drop[1]).toBeGreaterThanOrEqual(0);
            expect(drop[1]).toBeLessThan(0.5);
            expect(drop[5]).toBeGreaterThan(0);
            expect(drop[7]).toBeGreaterThan(0.2);
            expect(drop[7]).toBeLessThan(6);
            expect(drop[3]).toBeGreaterThanOrEqual(2);
            expect(drop.every(Number.isFinite)).toBe(true);
        }
        // The higher a drop is thrown, the longer it is in the air: each on its own arc.
        const byRise = [...gentle].sort((a, b) => a[5] - b[5]);
        for (let index = 1; index < byRise.length; index += 1) {
            expect(byRise[index][7]).toBeGreaterThanOrEqual(byRise[index - 1][7]);
        }
        expect(new Set(gentle.map((drop) => drop[5])).size).toBeGreaterThan(gentle.length / 2);
        // A ring goes out from where the lake was struck.
        expect(ripples.add).toHaveBeenCalledOnce();
        const [x, z, strength] = ripples.add.mock.calls[0];
        expect(x).toBeLessThan(middle);
        expect([x, z, strength].every(Number.isFinite)).toBe(true);
        expect(strength).toBeGreaterThan(0);
        // Struck harder, more drops leap, and most of them still on the side it was struck.
        flurry.reset();
        flurry.play(frameOf([ask('droplets', { serial: 1, side: 1, strength: 1 })]), { time: 9, stage: rest, ripples });
        const hard = records(flurry.ring);
        expect(hard.length).toBeGreaterThan(gentle.length);
        expect(hard.filter((drop) => drop[0] > middle).length).toBeGreaterThan(hard.length / 2);
        // A card that stands over dry land strikes no water: no drops, no ring.
        const dry = makeFlurry({ flurry: 600, puffs: 0, groundHeight: () => 0.4 });
        const none = { add: vi.fn() };
        dry.play(frameOf([ask('droplets')]), { time: 2, stage: rest, ripples: none });
        expect(dry.counts().thrown).toBe(0);
        expect(none.add).not.toHaveBeenCalled();
        // And it needs no rings to throw by.
        expect(() => flurry.play(frameOf([ask('droplets', { serial: 2 })]), { time: 12, stage: rest })).not.toThrow();
    });

    it('winds two strands of sparks up beside the board, one spark after another, the way the piece turned', () => {
        const flurry = makeFlurry({ flurry: 600, puffs: 0 });
        const rest = stage();
        const middle = (rest.edge(-1, 0).x + rest.edge(1, 0).x) / 2;
        const wind = (side, serial) => {
            flurry.reset();
            flurry.play(frameOf([ask('helix', { side, serial })]), { time: 4, stage: rest });
            return records(flurry.ring);
        };
        const right = wind(1, 0);
        const left = wind(-1, 1);
        expect(right.length).toBeGreaterThan(8);
        expect(left).toHaveLength(right.length);
        for (const [sparks, side] of [[right, 1], [left, -1]]) {
            // One axis in the water beside the card, on the piece's side.
            expect(new Set(sparks.map((spark) => `${spark[0]} ${spark[2]}`)).size).toBe(1);
            expect(Math.sign(sparks[0][0] - middle)).toBe(side);
            // Two strands, half of the sparks each, set opposite one another round the axis.
            const strands = new Map();
            sparks.forEach((spark) => strands.set(spark[10], (strands.get(spark[10]) || 0) + 1));
            expect(strands.size).toBe(2);
            expect([...strands.values()]).toEqual([sparks.length / 2, sparks.length / 2]);
            const [a, b] = [...strands.keys()];
            expect(Math.abs(a - b)).toBeCloseTo(0.5, 6);
            for (const spark of sparks) {
                expect(spark[8]).toBe(FLURRY_KIND.helix);
                // It turns the way the piece turned, climbs, and is gone in a few seconds.
                expect(Math.sign(spark[4])).toBe(side);
                expect(spark[5]).toBeGreaterThan(0);
                expect(spark[7]).toBeGreaterThan(0.3);
                expect(spark[7]).toBeLessThan(6);
                expect(spark.every(Number.isFinite)).toBe(true);
            }
            // Each strand is thrown one spark after another, so the helix draws itself upward.
            const births = sparks.filter((spark) => spark[10] === a).map((spark) => spark[3]).sort((x, y) => x - y);
            expect(births[0]).toBeGreaterThanOrEqual(4);
            for (let index = 1; index < births.length; index += 1) {
                expect(births[index]).toBeGreaterThan(births[index - 1]);
            }
            expect(births.at(-1) - births[0]).toBeLessThan(sparks[0][7]);
        }
    });

    it('lets gold fall through the whole air the eye can see, on both sides of the board', () => {
        const flurry = makeFlurry({ flurry: 1000, puffs: 0, groundHeight: (x) => (x > 20 ? 3 : -1) });
        const rest = stage();
        flurry.play(frameOf([ask('goldfall')]), { time: 7, stage: rest });
        const gold = records(flurry.ring);
        expect(gold.length).toBeGreaterThan(100);
        expect(flurry.counts()).toMatchObject({ particles: gold.length, thrown: gold.length, refused: 0 });
        let leftOf = 0;
        let inFrame = 0;
        const point = new THREE.Vector3();
        for (const mote of gold) {
            expect(mote[8]).toBe(FLURRY_KIND.goldfall);
            expect(mote.every(Number.isFinite)).toBe(true);
            // In the air over the water or the ground under it, never in it.
            expect(mote[1]).toBeGreaterThan(mote[0] > 20 ? 3 : 0);
            // It sinks: thrown gently downward, and falling on.
            expect(mote[5]).toBeLessThan(0);
            expect(mote[11]).toBeLessThan(0);
            expect(mote[7]).toBeGreaterThan(1);
            expect(mote[3]).toBeGreaterThanOrEqual(7);
            const seen = rest.project(mote[0], mote[1], mote[2], point);
            expect(seen.z).toBeGreaterThan(0);
            if (seen.x < 0.5) leftOf += 1;
            if (seen.x >= 0 && seen.x <= 1 && seen.y >= 0 && seen.y <= 1) inFrame += 1;
        }
        expect(leftOf / gold.length).toBeGreaterThan(0.3);
        expect(leftOf / gold.length).toBeLessThan(0.7);
        expect(inFrame / gold.length).toBeGreaterThan(0.8);
        // Not all at once: it goes on beginning for a moment.
        expect(new Set(gold.map((mote) => mote[3])).size).toBeGreaterThan(gold.length / 2);
    });

    it('breathes pollen from the crowns the eye can see beside the board, and from no other', () => {
        // (Room in the clouds' ring for every crown in sight, however many breaths a crown gives.)
        const flurry = makeFlurry({ flurry: 800, puffs: 48 });
        const rest = stage();
        const at = (sx, sy, depth) => rest.point(sx, sy, depth).toArray();
        const seen = [at(0.12, 0.3, 30), at(0.2, 0.42, 22), at(0.8, 0.3, 30), at(0.9, 0.35, 40)];
        const hidden = [
            at(0.5, 0.5, 30), // behind the card
            at(1.5, 0.3, 30), // out of the frame to the right
            at(-0.6, 0.3, 30), // and to the left
            at(0.2, 0.95, 30), // under the frame's foot
            at(0.3, 0.3, 2), // in the eye
            [0, 10, 300], // behind it
        ];
        flurry.crowns = Float32Array.from([...seen, ...hidden].flat());
        flurry.play(frameOf([ask('pollen')]), { time: 20, stage: rest });
        const motes = records(flurry.ring);
        const clouds = records(flurry.puffs);
        expect(motes.length).toBeGreaterThan(seen.length);
        expect(clouds.length).toBeGreaterThan(0);
        expect(clouds.length).toBeLessThanOrEqual(flurry.puffs.capacity);
        expect(flurry.counts())
            .toMatchObject({ particles: motes.length, clouds: clouds.length, breathed: clouds.length });
        const near = (record, crowns) => Math.min(...crowns.map((crown) => Math.hypot(
            record[0] - crown[0],
            record[1] - crown[1],
            record[2] - crown[2],
        )));
        const used = new Set();
        for (const record of [...motes, ...clouds]) {
            expect(record.every(Number.isFinite)).toBe(true);
            // Out of a crown in sight, and nowhere near one that is not.
            expect(near(record, seen)).toBeLessThan(2.5);
            expect(near(record, hidden)).toBeGreaterThan(2.5);
            expect(record[3]).toBeGreaterThanOrEqual(20);
            expect(record[7]).toBeGreaterThan(1);
            used.add(seen.findIndex((crown) => near(record, [crown]) < 2.5));
        }
        // Every crown in sight breathed (there is room in the clouds' ring for each).
        expect(used.size).toBe(seen.length);
        for (const mote of motes) expect(mote[8]).toBe(FLURRY_KIND.pollen);
        // A cloud drifts downwind as it swells; a crown gives a few breaths, one after another.
        const perCrown = clouds.length / seen.length;
        expect(Number.isInteger(perCrown) && perCrown >= 1).toBe(true);
        const births = clouds.filter((cloud) => near(cloud, [seen[0]]) < 2.5).map((cloud) => cloud[3]);
        expect(new Set(births).size).toBe(births.length);
        // The wind crosses the frame from the left: a crown on the left breathes before one on the right.
        const first = (crown) => Math.min(...clouds.filter((cloud) => near(cloud, [crown]) < 2.5)
            .map((cloud) => cloud[3]));
        expect(first(seen[0])).toBeLessThan(first(seen[3]));
        // With no crown in sight, or none at all, or no stage to see them through: nothing.
        for (const crowns of [new Float32Array(0), Float32Array.from(hidden.flat())]) {
            const quiet = makeFlurry({ flurry: 800, puffs: 12 });
            quiet.crowns = crowns;
            quiet.play(frameOf([ask('pollen')]), { time: 20, stage: rest });
            expect(quiet.counts()).toMatchObject({
                particles: 0, clouds: 0, thrown: 0, breathed: 0,
            });
        }
        expect(() => flurry.pollen(ask('pollen'), null)).not.toThrow();
        // A tier without the clouds still throws the motes.
        const bare = makeFlurry({ flurry: 800, puffs: 0 });
        bare.crowns = Float32Array.from(seen.flat());
        bare.play(frameOf([ask('pollen')]), { time: 20, stage: rest });
        expect(bare.counts().thrown).toBeGreaterThan(0);
        expect(bare.counts().breathed).toBe(0);
    });

    it('throws less on a tier with a smaller ring, and never more than the ring holds', () => {
        const thrownAt = (capacity) => {
            const flurry = makeFlurry({ flurry: capacity, puffs: 0 });
            flurry.play(frameOf([ask('goldfall'), ask('helix', { serial: 1 }), ask('droplets', { serial: 2 })]), {
                time: 1, stage: stage(),
            });
            const counts = flurry.counts();
            expect(counts.particles).toBeLessThanOrEqual(capacity);
            expect(counts.particles).toBe(counts.thrown);
            return counts.thrown;
        };
        const sizes = TIER_NAMES.map((name) => GOLDEN_FOREST_TIERS[name].flurry).sort((a, b) => a - b);
        const thrown = sizes.map(thrownAt);
        for (let index = 1; index < thrown.length; index += 1) {
            expect(thrown[index]).toBeGreaterThanOrEqual(thrown[index - 1]);
        }
        expect(thrown.at(-1)).toBeGreaterThan(thrown[0]);
        // Every tier's ring holds the busiest moment's three bursts at once with none let go.
        for (const capacity of sizes) {
            const flurry = makeFlurry({ flurry: capacity, puffs: 0 });
            flurry.play(frameOf([ask('goldfall'), ask('helix', { serial: 1 }), ask('droplets', { serial: 2 })]), {
                time: 1, stage: stage(),
            });
            expect(flurry.counts().refused, `ring of ${capacity}`).toBe(0);
        }
    });

    it('forgets everything in flight on reset, takes new particles at once, and keeps its tally', () => {
        const flurry = makeFlurry({ flurry: 24, puffs: 3 });
        flurry.time = 2;
        for (let index = 0; index < 30; index += 1) flurry.toss('goldfall', index, 2, 0, 0, -1, 0, 60, 0.1);
        for (let index = 0; index < 5; index += 1) flurry.cloud(index, 5, 0, 1, 0, 0, 60, 2, 1, 1);
        expect(flurry.counts()).toEqual({
            particles: 24, clouds: 3, thrown: 24, refused: 6, breathed: 3,
        });
        flurry.flush();
        const versions = [flurry.ring.buffer.version, flurry.puffs.buffer.version];
        flurry.reset();
        // Nothing in flight, nothing left in either buffer, and both flagged for the GPU.
        expect(flurry.counts()).toMatchObject({ particles: 0, clouds: 0 });
        expect(flurry.ring.data.every((value) => value === 0)).toBe(true);
        expect(flurry.puffs.data.every((value) => value === 0)).toBe(true);
        expect(flurry.ring.buffer.version).toBeGreaterThan(versions[0]);
        expect(flurry.puffs.buffer.version).toBeGreaterThan(versions[1]);
        // The ring is whole again at once: it neither refuses nor has a slot gone missing.
        for (let round = 0; round < 3; round += 1) {
            for (let index = 0; index < 24; index += 1) {
                expect(flurry.toss('helix', index, 2, 0, 0, 1, 0, 60, 0.1), `round ${round} particle ${index}`)
                    .toBe(true);
            }
            for (let index = 0; index < 3; index += 1) {
                expect(flurry.cloud(index, 5, 0, 1, 0, 0, 60, 2, 1, 1)).toBe(true);
            }
            expect(flurry.toss('helix', 0, 2, 0, 0, 1, 0, 60, 0.1)).toBe(false);
            expect(flurry.counts()).toMatchObject({ particles: 24, clouds: 3 });
            flurry.reset();
        }
        // What was thrown and let go since it was built is still told.
        expect(flurry.counts()).toEqual({
            particles: 0, clouds: 0, thrown: 24 * 4, refused: 6 + 3, breathed: 3 * 4,
        });
        // A reset alone does not replay what the director's queue still holds.
        const queue = [ask('helix', { serial: 0 })];
        flurry.play(frameOf(queue), { time: 3, stage: stage() });
        const played = flurry.counts().thrown;
        expect(played).toBeGreaterThan(24 * 4);
        flurry.reset();
        flurry.play(frameOf(queue), { time: 3.1, stage: stage() });
        expect(flurry.counts()).toMatchObject({ particles: 0, thrown: played });
    });

    it('releases what it owns once and is inert afterwards', () => {
        const light = makeLight();
        const flurry = new GoldenForestFlurry({ light, tier: { flurry: 32, puffs: 6 }, rng: seededRandom(1) }).build();
        const parent = new THREE.Group();
        parent.add(flurry.group);
        const { mesh, puffMesh } = flurry;
        const disposals = [mesh.geometry, mesh.material, puffMesh.geometry, puffMesh.material]
            .map((resource) => vi.spyOn(resource, 'dispose'));
        flurry.dispose();
        flurry.dispose();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(parent.children).toEqual([]);
        expect(flurry.group.children).toEqual([]);
        expect(flurry.ring).toBeNull();
        expect(() => {
            flurry.play(frameOf([ask('helix'), ask('goldfall', { serial: 1 })]), { time: 1, stage: stage() });
            flurry.reset();
        }).not.toThrow();
        expect(flurry.toss('droplets', 0, 1, 0, 0, 1, 0, 1, 0.1)).toBe(false);
        expect(flurry.counts()).toMatchObject({ particles: 0, clouds: 0 });
    });
});

describe('the marks the events leave on the water', () => {
    function makeLake() {
        const light = makeLight();
        const lakeMap = own(new THREE.DataTexture(new Uint8Array(4), 1, 1));
        return new GoldenForestLake({ light, tier: GOLDEN_FOREST_TIERS.Minimal, lakeMap });
    }
    const rows = (lake) => ({
        waves: lake.waveRows.slice(0, lake.uWaveCount.value).map((row) => row.toArray()),
        swirls: lake.swirlRows.slice(0, lake.uSwirlCount.value).map((row) => row.toArray()),
        road: lake.uRoad.value.toArray(),
    });
    const mark = (age, more = {}) => ({
        x: 3, z: -20, age, strength: 1, turn: 1, ...more,
    });

    it('has a row for every track the director can run', () => {
        const lake = makeLake();
        expect(lake.waveRows).toHaveLength(GOLDEN_FOREST_TRACK_SLOTS.waves);
        expect(lake.swirlRows).toHaveLength(GOLDEN_FOREST_TRACK_SLOTS.swirls);
        // The road's two pulses ride in one vec4: a distance from the eye and a strength, twice.
        expect(lake.uRoad.value.isVector4).toBe(true);
        expect(GOLDEN_FOREST_TRACK_SLOTS.roads).toBe(2);
        expect(rows(lake)).toEqual({ waves: [], swirls: [], road: [0, 0, 0, 0] });
        for (const table of [GOLDEN_FOREST_WAVE, GOLDEN_FOREST_SWIRL, GOLDEN_FOREST_ROAD]) {
            expect(Object.isFrozen(table)).toBe(true);
            expect(table.life).toBeGreaterThan(0);
        }
        // The pulse runs from the far shore to your feet.
        expect(GOLDEN_FOREST_ROAD.far).toBeGreaterThan(GOLDEN_FOREST_ROAD.near);
        expect(GOLDEN_FOREST_ROAD.near).toBeGreaterThan(0);
    });

    it('packs the live tracks at the front of each list and counts them', () => {
        const lake = makeLake();
        const spent = mark(GOLDEN_FOREST_WAVE.life + 1);
        lake.setTracks({
            waves: [spent, mark(1, { x: 5 }), null, mark(2, { x: 6, strength: 0 }), mark(3, { x: 7 })],
            swirls: [mark(GOLDEN_FOREST_SWIRL.life), mark(1, { x: 8, turn: -1 }), mark(2, { x: 9 })],
            roads: [{ age: GOLDEN_FOREST_ROAD.life, strength: 1 }, { age: 1, strength: 1 },
                { age: 0.5, strength: 0.8 }],
        });
        const packed = rows(lake);
        expect(packed.waves.map((row) => row[0])).toEqual([5, 7]);
        expect(packed.swirls.map((row) => row[0])).toEqual([8, 9]);
        // x, z where it started on the water; a wave's radius; a spiral's age and the way it turns.
        expect(packed.waves[0].slice(0, 2)).toEqual([5, -20]);
        expect(packed.swirls[0][2]).toBe(1);
        expect(packed.swirls[0][3]).toBeLessThan(0);
        expect(packed.swirls[1][3]).toBeGreaterThan(0);
        expect(packed.road.every((value) => value > 0)).toBe(true);
        // One fewer the next frame: the count follows, and what is past it is not read.
        lake.setTracks({ waves: [mark(1.1, { x: 5 })], swirls: [], roads: [{ age: 1.1, strength: 1 }] });
        expect(rows(lake).waves.map((row) => row[0])).toEqual([5]);
        expect(lake.uSwirlCount.value).toBe(0);
        expect(lake.uRoad.value.toArray().slice(2)).toEqual([0, 0]);
        // Nothing asked for, or reset: an untouched lake that pays for none of it.
        lake.setTracks({});
        expect(rows(lake)).toEqual({ waves: [], swirls: [], road: [0, 0, 0, 0] });
        lake.setTracks({ waves: [mark(1)], swirls: [mark(1)], roads: [{ age: 1, strength: 1 }] });
        lake.ripples.add(0, -10, 1);
        lake.reset();
        expect(rows(lake)).toEqual({ waves: [], swirls: [], road: [0, 0, 0, 0] });
        expect(lake.ripples.active()).toBe(0);
        lake.setTracks();
        expect(lake.uWaveCount.value).toBe(0);
    });

    it('takes no more tracks than it has rows, however many it is handed', () => {
        const lake = makeLake();
        const many = Array.from({ length: 40 }, (_, index) => mark(0.5 + index * 0.05, { x: index }));
        expect(() => lake.setTracks({
            waves: many, swirls: many, roads: many.map((track) => ({ age: track.age, strength: 1 })),
        })).not.toThrow();
        expect(lake.uWaveCount.value).toBe(lake.waveRows.length);
        expect(lake.uSwirlCount.value).toBe(lake.swirlRows.length);
        // The first ones handed over are the ones drawn.
        expect(rows(lake).waves.map((row) => row[0])).toEqual([...Array(lake.waveRows.length).keys()]);
        expect(rows(lake).swirls.map((row) => row[0])).toEqual([...Array(lake.swirlRows.length).keys()]);
        expect(nonFiniteUniforms(lake)).toEqual([]);
    });

    it('skips a track that is no track: no place, no age, no strength', () => {
        const lake = makeLake();
        const junk = [undefined, null, 7, 'wave', {}, [], mark(NaN), mark(Infinity), mark(1, { x: NaN }),
            mark(1, { z: Infinity }), mark(1, { strength: NaN }), mark(1, { strength: -2 }), mark(1, { strength: 0 }),
            mark(1, { strength: null }), mark(1, { x: undefined }), mark(1, { age: null })];
        // (A pulse on the sun's road needs no place: only its age and its strength make it one. An age
        // of null is held to in golden-forest-faults.test.js.)
        const noPulse = junk.filter((entry) => !(Number.isFinite(entry?.age) && entry.strength > 0)
            && entry?.age !== null);
        expect(noPulse.length).toBeGreaterThan(7);
        expect(() => lake.setTracks({ waves: junk, swirls: junk, roads: noPulse })).not.toThrow();
        expect(rows(lake)).toMatchObject({ waves: [], swirls: [] });
        // No light on the road from any of it.
        expect([lake.uRoad.value.y, lake.uRoad.value.w]).toEqual([0, 0]);
        // Junk beside a real track leaves the real one, and only it.
        lake.setTracks({
            waves: [...junk, mark(1, { x: 4 })], swirls: [...junk, mark(1, { x: 4 })], roads: [...noPulse, mark(1)],
        });
        expect(rows(lake).waves.map((row) => row[0])).toEqual([4]);
        expect(rows(lake).swirls.map((row) => row[0])).toEqual([4]);
        expect(lake.uRoad.value.y).toBeGreaterThan(0);
        expect(lake.uRoad.value.w).toBe(0);
        expect(nonFiniteUniforms(lake)).toEqual([]);
        expect([...lake.waveRows, ...lake.swirlRows].every((row) => row.toArray().every(Number.isFinite))).toBe(true);
        // A strength past the brim is drawn at the brim, whatever was asked.
        const drawn = (strength) => {
            lake.setTracks({
                waves: [mark(2, { strength })], swirls: [mark(1, { strength })], roads: [{ age: 1.5, strength }],
            });
            return [lake.waveRows[0].w, lake.swirlRows[0].w, lake.uRoad.value.y];
        };
        drawn(1e9).forEach((value, index) => expect(value).toBeGreaterThanOrEqual(drawn(1)[index]));
        drawn(1e9).forEach((value) => expect(value).toBeLessThanOrEqual(1.5));
    });

    it('runs a great wave out from where it began, rising out of the water and thinning as it spreads', () => {
        const lake = makeLake();
        const { life } = GOLDEN_FOREST_WAVE;
        const at = (age) => {
            lake.setTracks({ waves: [mark(age)] });
            return lake.uWaveCount.value ? lake.waveRows[0].clone() : null;
        };
        expect(at(0).z).toBe(GOLDEN_FOREST_WAVE.start);
        expect(at(0).w).toBe(0);
        let last = at(0);
        let peak = 0;
        for (let age = DT; age < life; age += DT) {
            const now = at(age);
            // Its crest runs outward at its own steady pace; it never stands or turns back.
            expect(now.z - last.z).toBeCloseTo(GOLDEN_FOREST_WAVE.speed * DT, 6);
            expect(now.w).toBeGreaterThan(0);
            expect(now.w).toBeLessThanOrEqual(1);
            // No pop: it comes and goes by degrees.
            expect(Math.abs(now.w - last.w)).toBeLessThan(0.2);
            peak = Math.max(peak, now.w);
            last = now;
        }
        expect(peak).toBeGreaterThan(0.8);
        // At the end of its life there is all but nothing left to take away.
        expect(last.w).toBeLessThan(0.01);
        expect(at(life)).toBeNull();
        expect(at(life + 5)).toBeNull();
        // By then it has crossed the lake toward the far shore.
        expect(last.z).toBeGreaterThan(60);
    });

    it('winds a spiral in and lets it go, and runs a pulse down the road from the far shore to the eye', () => {
        const lake = makeLake();
        const swirl = (age, turn = 1) => {
            lake.setTracks({ swirls: [mark(age, { turn })] });
            return lake.uSwirlCount.value ? lake.swirlRows[0].clone() : null;
        };
        let last = swirl(0);
        let peak = 0;
        for (let age = DT; age < GOLDEN_FOREST_SWIRL.life; age += DT) {
            const now = swirl(age);
            // Its age is what the water turns by; its strength never changes sign with it.
            expect(now.z).toBeCloseTo(age, 9);
            expect(now.w).toBeGreaterThan(0);
            expect(swirl(age, -1).w).toBe(-now.w);
            expect(Math.abs(now.w - last.w)).toBeLessThan(0.2);
            peak = Math.max(peak, now.w);
            last = now;
        }
        expect(peak).toBeGreaterThan(0.6);
        expect(last.w).toBeLessThan(0.01);
        expect(swirl(GOLDEN_FOREST_SWIRL.life)).toBeNull();
        // (A turn that is no number winds one way, not neither.)
        expect(swirl(1, NaN).w).toBeGreaterThan(0);

        const pulse = (age) => {
            lake.setTracks({ roads: [{ age, strength: 1 }] });
            return lake.uRoad.value.clone();
        };
        let before = pulse(0);
        expect(before.x).toBe(GOLDEN_FOREST_ROAD.far);
        expect(before.y).toBe(0);
        let brightest = 0;
        for (let age = DT; age < GOLDEN_FOREST_ROAD.life; age += DT) {
            const now = pulse(age);
            // Toward the eye all the way, never past it.
            expect(now.x).toBeLessThanOrEqual(before.x);
            expect(now.x).toBeGreaterThanOrEqual(GOLDEN_FOREST_ROAD.near - 1e-9);
            expect(now.y).toBeGreaterThan(0);
            expect(now.y).toBeLessThanOrEqual(1);
            brightest = Math.max(brightest, now.y);
            before = now;
        }
        expect(before.x).toBeCloseTo(GOLDEN_FOREST_ROAD.near, 6);
        expect(brightest).toBeGreaterThan(0.9);
        expect(pulse(GOLDEN_FOREST_ROAD.life).toArray()).toEqual([0, 0, 0, 0]);
        // Two pulses ride the road at once, the first handed over first.
        lake.setTracks({ roads: [{ age: 0.5, strength: 1 }, { age: 2, strength: 0.5 }, { age: 1, strength: 1 }] });
        const [far, bright, near, dim] = lake.uRoad.value.toArray();
        expect(far).toBeGreaterThan(near);
        expect(bright).toBeGreaterThan(0);
        expect(dim).toBeGreaterThan(0);
    });
});

describe('the air on the light rig', () => {
    const AIR_UNIFORMS = {
        uDeck: 'deck',
        uBars: 'bars',
        uMist: 'mist',
        uSmoke: 'smoke',
        uClarity: 'clarity',
        uRuffle: 'ruffle',
        uGlitter: 'glitter',
    };
    const reading = (light) => Object.fromEntries(Object.keys(AIR_UNIFORMS).map((key) => [key, light[key].value]));

    it('is built in the still air, and laying the still air on it changes nothing', () => {
        const light = makeLight();
        const built = { ...reading(light), wind: light.uWind.value, haze: light.uHaze.value };
        expect(light.airPhase).toBe(0);
        for (const [uniform, key] of Object.entries(AIR_UNIFORMS)) {
            expect(built[uniform], uniform).toBe(GOLDEN_FOREST_AIRS[0][key]);
        }
        expect(built.wind).toBe(GOLDEN_FOREST_BREEZE);
        light.setMood(0);
        light.setAir(0);
        light.update(0, {}, null);
        expect({ ...reading(light), wind: light.uWind.value, haze: light.uHaze.value }).toEqual(built);
        expect(light.uCloudClock.value).toBe(0);
        expect(light.uGild.value.toArray()).toEqual([0, 0]);
        expect(light.uDusk.value).toBe(0);
    });

    it('takes every number of an air: cloud and mist at once, the wind and the haze with the next frame', () => {
        const light = makeLight();
        light.setMood(0);
        light.update(0, {}, null);
        const rest = { haze: light.uHaze.value, wind: light.uWind.value };
        GOLDEN_FOREST_AIRS.forEach((air, index) => {
            light.setAir(index);
            expect(light.airPhase).toBe(index);
            for (const [uniform, key] of Object.entries(AIR_UNIFORMS)) {
                expect(light[uniform].value, `${air.name} ${key}`).toBe(air[key]);
            }
            for (const key of GOLDEN_FOREST_AIR_SCALARS) expect(light.air[key]).toBe(air[key]);
            light.update(1, {}, null);
            expect(light.uWind.value).toBeCloseTo(rest.wind + air.wind, 12);
            expect(light.uHaze.value).toBeCloseTo(rest.haze * air.haze, 12);
        });
        // Half-way between two airs it is neither, and every uniform lies between theirs.
        light.setAir(1.5);
        for (const [uniform, key] of Object.entries(AIR_UNIFORMS)) {
            const [a, b] = [GOLDEN_FOREST_AIRS[1][key], GOLDEN_FOREST_AIRS[2][key]];
            expect(light[uniform].value).toBeGreaterThanOrEqual(Math.min(a, b));
            expect(light[uniform].value).toBeLessThanOrEqual(Math.max(a, b));
        }
        // Round and round, and a phase that is no number is the still air.
        light.setAir(GOLDEN_FOREST_AIRS.length * 3 + 2);
        expect(reading(light).uDeck).toBe(GOLDEN_FOREST_AIRS[2].deck);
        for (const phase of [NaN, Infinity, undefined, null, 'mist']) {
            light.setAir(3);
            light.setAir(phase);
            expect(light.airPhase).toBe(0);
            expect(reading(light).uBars).toBe(GOLDEN_FOREST_AIRS[0].bars);
        }
        expect(nonFiniteUniforms(light)).toEqual([]);
    });

    it('lays the air\'s wind under Reduce motion\'s share, and leaves a pinned haze pinned', () => {
        const light = makeLight();
        const most = (key) => Math.max(...GOLDEN_FOREST_AIRS.map((entry) => entry[key]));
        const breezy = GOLDEN_FOREST_AIRS.findIndex((air) => air.wind === most('wind'));
        const thick = GOLDEN_FOREST_AIRS.findIndex((air) => air.haze === most('haze'));
        expect(GOLDEN_FOREST_AIRS[breezy].wind).toBeGreaterThan(0);
        light.setMood(0);
        light.setAir(breezy);
        light.update(1, {}, { motion: 1 });
        const full = light.uWind.value - GOLDEN_FOREST_BREEZE;
        light.update(2, {}, { motion: 0.35 });
        expect(light.uWind.value - GOLDEN_FOREST_BREEZE).toBeCloseTo(full * 0.35, 12);
        // A lens that pins the haze (the icon's) pins it whole, whatever the air.
        light.hazePin = 0.004;
        light.setMood(0);
        light.setAir(thick);
        light.update(3, {}, null);
        expect(light.uHaze.value).toBeCloseTo(0.004, 12);
    });

    it('runs the cloud on a clock of its own that never jumps when the air or the rush changes its pace', () => {
        const light = makeLight();
        const drifts = GOLDEN_FOREST_AIRS.map((air) => air.drift);
        const [slowest, fastest] = [Math.min(...drifts), Math.max(...drifts)];
        light.setMood(0);
        let time = 0;
        let last = 0;
        // At rest the cloud keeps the clock's own time.
        for (let frame = 0; frame < 120; frame += 1) {
            time += DT;
            light.setAir(0);
            light.update(time, {}, null);
        }
        expect(light.uCloudClock.value).toBeCloseTo(time * GOLDEN_FOREST_AIRS[0].drift, 9);
        last = light.uCloudClock.value;
        // Through every air and every melt between them: each frame it moves on by that frame's own pace.
        for (let frame = 0; frame < 60 * 60; frame += 1) {
            time += DT;
            light.setAir((frame / (60 * 60)) * GOLDEN_FOREST_AIRS.length * 2);
            light.update(time, {}, { rush: 0 });
            const moved = light.uCloudClock.value - last;
            expect(moved).toBeGreaterThanOrEqual(slowest * DT - 1e-9);
            expect(moved).toBeLessThanOrEqual(fastest * DT + 1e-9);
            expect(moved).toBeCloseTo(light.air.drift * DT, 9);
            last = light.uCloudClock.value;
        }
        // A level turns the hour on: the cloud races for a moment, by degrees with the rush, and settles
        // back to the air's pace; it never runs backward.
        light.setAir(0);
        const paces = [];
        for (const rush of [0, 0.25, 0.5, 1, 0.5, 0]) {
            time += DT;
            light.update(time, {}, { rush });
            paces.push((light.uCloudClock.value - last) / DT);
            last = light.uCloudClock.value;
        }
        expect(paces[0]).toBeCloseTo(GOLDEN_FOREST_AIRS[0].drift, 6);
        expect(paces[1]).toBeGreaterThan(paces[0]);
        expect(paces[2]).toBeGreaterThan(paces[1]);
        expect(paces[3]).toBeGreaterThan(paces[2]);
        expect(paces[4]).toBeCloseTo(paces[2], 6);
        expect(paces[5]).toBeCloseTo(paces[0], 6);
        // Reduce motion calms the race, not the weather.
        time += DT;
        light.update(time, {}, { rush: 1, motion: 0 });
        expect((light.uCloudClock.value - last) / DT).toBeCloseTo(GOLDEN_FOREST_AIRS[0].drift, 6);
        // A rush that is no number is no rush.
        for (const rush of [NaN, -3, 'fast', null]) {
            last = light.uCloudClock.value;
            time += DT;
            light.update(time, {}, { rush });
            expect((light.uCloudClock.value - last) / DT).toBeCloseTo(GOLDEN_FOREST_AIRS[0].drift, 6);
        }
        expect(Number.isFinite(light.uCloudClock.value)).toBe(true);
    });

    it('starts the cloud again from the time when the clock is sought backward, as a rig sought there would', () => {
        for (const air of [0, 2, 4]) {
            const light = makeLight();
            light.setMood(0);
            light.setAir(air);
            let time = 0;
            for (let frame = 0; frame < 600; frame += 1) {
                time += DT;
                light.update(time, {}, { rush: frame < 200 ? 1 : 0 });
            }
            const lived = light.uCloudClock.value;
            expect(lived).toBeGreaterThan(0);
            for (const back of [4.5, 0.4, 0]) {
                light.update(back, {}, null);
                const fresh = makeLight();
                fresh.setMood(0);
                fresh.setAir(air);
                fresh.update(back, {}, null);
                expect(light.uCloudClock.value, `air ${air} sought to ${back}`).toBeCloseTo(fresh.uCloudClock.value, 9);
                expect(light.uCloudClock.value).toBeGreaterThanOrEqual(0);
                expect(light.uCloudClock.value).toBeLessThan(lived);
                // And from there it goes on by the frame again.
                const from = light.uCloudClock.value;
                light.update(back + DT, {}, null);
                expect(light.uCloudClock.value - from).toBeCloseTo(light.air.drift * DT, 9);
                light.update(back, {}, null);
            }
            // A time that is no number moves nothing.
            const held = light.uCloudClock.value;
            for (const junk of [NaN, Infinity, undefined, null, 'later']) {
                light.update(junk, {}, null);
                expect(light.uCloudClock.value).toBe(held);
            }
        }
    });

    it('wears the gilding and the dusk the world hands it, bounded, and comes back from the dusk exactly', () => {
        const light = makeLight();
        light.setMood(0);
        light.setAir(0);
        light.update(1, {}, null);
        const colours = () => [light.uSunColor, light.uSkyToward, light.uSkyMid, light.uZenith, light.uHazeWarm]
            .map((uniform) => uniform.value.toArray());
        const rest = colours();
        const luma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        light.update(1, {}, { gild: 0.6, gildReach: 0.3, dusk: 0.5 });
        // x: how far round the lake it has come; y: how bright.
        expect(light.uGild.value.toArray()).toEqual([0.3, 0.6]);
        expect(light.uDusk.value).toBe(0.5);
        const half = luma(colours()[0]);
        light.update(1, {}, { dusk: 1 });
        const deep = colours();
        // The evening after a game: the sun dims, more the deeper the dusk, and the sky cools.
        expect(half).toBeLessThan(luma(rest[0]));
        expect(luma(deep[0])).toBeLessThan(half);
        expect(deep[3][0]).toBeLessThanOrEqual(rest[3][0]);
        expect(deep.flat().every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
        // Play again: the light is the hour's own again, to the last digit.
        light.update(1, {}, { dusk: 0 });
        expect(colours()).toEqual(rest);
        // Out of range or no number at all: bounded, and never NaN in a uniform.
        for (const worn of [{ gild: 9, gildReach: 9, dusk: 9 }, { gild: -1, gildReach: -1, dusk: -1 },
            { gild: NaN, gildReach: 'far', dusk: Infinity }, { gild: null, gildReach: undefined, dusk: {} }, {},
            null]) {
            light.update(1, {}, worn);
            expect(nonFiniteUniforms(light)).toEqual([]);
            for (const value of [...light.uGild.value.toArray(), light.uDusk.value]) {
                expect(value >= 0 && value <= 1).toBe(true);
            }
        }
        light.update(1, {}, { gild: 9, gildReach: 9, dusk: 9 });
        expect([...light.uGild.value.toArray(), light.uDusk.value]).toEqual([1, 1, 1]);
        // What a material reads the gilding with is a node of the rig's.
        expect(light.gild().isNode).toBe(true);
    });
});

describe('the fan in the lens', () => {
    function makePost(quality = 'Low', options = {}) {
        const renderer = { toneMapping: THREE.NoToneMapping, toneMappingExposure: 1, render: vi.fn() };
        return own(new GoldenForestPost({
            renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), quality, ...options,
        }));
    }
    const rowsOf = (post) => post.beamRows.slice(0, post.uBeamCount.value).map((row) => row.toArray());
    const beam = (angle, more = {}) => ({
        serial: 0, angle, sharp: 200, strength: 0.5, ...more,
    });

    it('draws as many shafts as the director can hold open', () => {
        const post = makePost();
        expect(post.beamRows).toHaveLength(GOLDEN_FOREST_BEAM_SLOTS);
        expect(post.uBeamCount.value).toBe(0);
        expect(post.uBurst.value).toBe(0);
        expect(post.getDiagnostics()).toMatchObject({ rays: false, beams: 0 });
    });

    it('fills a row for every shaft the frame holds: its direction on screen, its sharpness, its light', () => {
        const post = makePost();
        post.update({
            beams: [beam(0), beam(60 * DEG, { sharp: 300, strength: 1 }), beam(-90 * DEG, { strength: 0.25 })],
        });
        const rows = rowsOf(post);
        expect(rows).toHaveLength(3);
        expect(post.getDiagnostics().beams).toBe(3);
        // A direction is an angle clockwise from the right, y down the screen: a unit vector.
        expect(rows[0][0]).toBeCloseTo(1, 12);
        expect(rows[0][1]).toBeCloseTo(0, 12);
        expect(rows[1][0]).toBeCloseTo(0.5, 12);
        expect(rows[1][1]).toBeCloseTo(Math.sin(60 * DEG), 12);
        expect(rows[2][0]).toBeCloseTo(0, 12);
        expect(rows[2][1]).toBeCloseTo(-1, 12);
        expect(rows.map((row) => row[2])).toEqual([200, 300, 200]);
        // Brighter in the frame, brighter in the lens, in the frame's own order.
        expect(rows[1][3]).toBeGreaterThan(rows[0][3]);
        expect(rows[0][3]).toBeGreaterThan(rows[2][3]);
        for (const row of rows) expect(Math.hypot(row[0], row[1])).toBeCloseTo(1, 12);
        // The shafts gone from the frame are gone from the count the same frame.
        post.update({ beams: [beam(1)] });
        expect(post.uBeamCount.value).toBe(1);
        post.update({});
        expect(post.uBeamCount.value).toBe(0);
        post.update();
        expect(post.uBeamCount.value).toBe(0);
    });

    it('mirrors the fan when the sun stands right of the middle, so its long shafts still cross the frame', () => {
        const post = makePost();
        const beams = GoldenForestReactions.prototype.constructor === GoldenForestReactions
            ? [beam(62 * DEG), beam(-14 * DEG), beam(150 * DEG)] : [];
        post.uSunScreen.value.set(0.26, 0.37);
        post.update({ beams });
        const left = rowsOf(post);
        post.uSunScreen.value.set(0.74, 0.37);
        post.update({ beams });
        const right = rowsOf(post);
        expect(right).toHaveLength(left.length);
        right.forEach((row, index) => {
            // Across is turned about, down is as it was.
            expect(row[0]).toBeCloseTo(-left[index][0], 12);
            expect(row[1]).toBeCloseTo(left[index][1], 12);
            expect(row.slice(2)).toEqual(left[index].slice(2));
        });
        // Dead centre is not mirrored.
        post.uSunScreen.value.set(0.5, 0.37);
        post.update({ beams });
        expect(rowsOf(post)[0][0]).toBeCloseTo(left[0][0], 12);
    });

    it('takes no more shafts than it has rows, and none that is no shaft', () => {
        const post = makePost();
        const many = Array.from({ length: 40 }, (_, index) => beam(index * 0.1, { serial: index }));
        post.update({ beams: many });
        expect(post.uBeamCount.value).toBe(GOLDEN_FOREST_BEAM_SLOTS);
        expect(rowsOf(post)[0][0]).toBeCloseTo(1, 12);
        const junk = [undefined, null, 7, 'beam', {}, [], beam(NaN), beam(Infinity), beam(1, { strength: NaN }),
            beam(1, { strength: 0 }), beam(1, { strength: -4 }), beam(1, { strength: null }), { strength: 1 }];
        expect(() => post.update({ beams: junk })).not.toThrow();
        expect(post.uBeamCount.value).toBe(0);
        post.update({ beams: [...junk, beam(1, { strength: 40, sharp: NaN })] });
        expect(rowsOf(post)).toHaveLength(1);
        // Its light is capped at full, and a sharpness that is no number is a middling one.
        expect(rowsOf(post)[0][3]).toBeLessThanOrEqual(1);
        expect(rowsOf(post)[0][2]).toBeGreaterThan(0);
        for (const beams of ['none', 3, {}, null]) {
            expect(() => post.update({ beams })).not.toThrow();
            expect(post.uBeamCount.value).toBe(0);
        }
        expect(post.beamRows.every((row) => row.toArray().every(Number.isFinite))).toBe(true);
        expect(nonFiniteUniforms(post)).toEqual([]);
    });

    it('lights the whole sunburst with the frame\'s burst, and stands the rays at rest as the air has them', () => {
        const light = makeLight('Low');
        const post = makePost('Low', { light, camera: goldenForestCamera() });
        light.setMood(0);
        const raysIn = (air, frame = {}) => {
            light.setAir(air);
            post.update(frame);
            return post.uRays.value;
        };
        // The mist stands the rays up, a clear evening thins them: the lens follows the air's own number.
        const order = GOLDEN_FOREST_AIRS.map((air, index) => [air.rays, raysIn(index)]).sort((a, b) => a[0] - b[0]);
        for (let index = 1; index < order.length; index += 1) {
            expect(order[index][1]).toBeGreaterThanOrEqual(order[index - 1][1]);
        }
        expect(order.at(-1)[1]).toBeGreaterThan(order[0][1]);
        expect(raysIn(0)).toBeCloseTo(GOLDEN_FOREST_AIRS[0].rays, 12);
        // Hot play combs them harder; the evening after a game lets them sink.
        expect(raysIn(0, { shafts: 1 })).toBeGreaterThan(raysIn(0));
        expect(raysIn(0, { fever: 1 })).toBeGreaterThan(raysIn(0));
        expect(raysIn(0, { dusk: 1 })).toBeLessThan(raysIn(0));
        expect(raysIn(0, { dusk: 1 })).toBeGreaterThan(0);
        // The burst is the frame's, bounded.
        const burst = (value) => {
            post.update({ burst: value });
            return post.uBurst.value;
        };
        expect(burst(0.5)).toBeGreaterThan(0);
        expect(burst(1)).toBeGreaterThan(burst(0.5));
        expect(burst(40)).toBe(burst(1));
        for (const junk of [NaN, -1, 'burst', null, undefined]) expect(burst(junk)).toBe(0);
        // The evening after a game closes the iris a little and takes some colour out.
        post.update({});
        const rest = [post.uExposure.value, post.uSaturation.value];
        post.update({ dusk: 1 });
        expect(post.uExposure.value).toBeLessThan(rest[0]);
        expect(post.uExposure.value).toBeGreaterThan(rest[0] * 0.5);
        expect(post.uSaturation.value).toBeLessThan(rest[1]);
        expect(nonFiniteUniforms(post)).toEqual([]);
    });
});

describe('a skein called across the sun', () => {
    const BIRDS = GOLDEN_FOREST_TIERS.High.birds;
    const inFrame = (seen) => seen.z > 0 && seen.x >= 0 && seen.x <= 1 && seen.y >= 0 && seen.y <= 1;
    // (How far past its lane's end a skein flies is its own: its longest arm must leave the frame.)
    const crossing = (call) => (call.lane.length + call.trail) / CALLED_SKEIN.speed;

    it('is a V of its own birds, one for each of the clock\'s skein', () => {
        for (const tier of Object.values(GOLDEN_FOREST_TIERS)) {
            const sky = new CraneSky(tier.birds, 7);
            expect(sky.called).toHaveLength(craneFlockSizes(tier.birds).skein);
            expect(sky.calling).toBeNull();
            expect(sky.calledAt(0, 5)).toBeNull();
            const call = sky.call(5);
            if (!sky.called.length) {
                // No birds for one: no skein, and nothing to draw.
                expect(call).toBeNull();
                continue;
            }
            expect(call.slots).toHaveLength(sky.called.length);
            // The leader at the point, the others behind it, none in another's place.
            expect(call.slots[0]).toEqual([0, 0, 0]);
            expect(new Set(call.slots.map((slot) => slot.join())).size).toBe(call.slots.length);
            for (const slot of call.slots.slice(1)) expect(slot[2]).toBeLessThan(0);
            expect(Object.isFrozen(CALLED_SKEIN)).toBe(true);
            expect(CALLED_SKEIN.speed).toBeGreaterThan(0);
        }
        const sky = new CraneSky(BIRDS, 7);
        for (const when of [NaN, Infinity, undefined, null, 'now']) expect(sky.call(when)).toBeNull();
        expect(sky.calling).toBeNull();
        expect(sky.calls).toBe(0);
    });

    it('leaves the clock\'s cranes exactly as they were: the same kettle and skein with or without a call', () => {
        const plain = new CraneSky(BIRDS, 0x6372);
        const called = new CraneSky(BIRDS, 0x6372);
        called.call(40);
        const room = (BIRDS + plain.sizes.skein) * CRANE_STRIDE;
        const [nearA, farA, nearB, farB] = [0, 0, 0, 0].map(() => new Float32Array(room));
        let extra = 0;
        for (let time = 40; time < 70; time += 0.37) {
            for (let i = 0; i < plain.kettle.length; i += 1) {
                expect(called.kettleAt(i, time, 0.3, [0, 0, 0])).toEqual(plain.kettleAt(i, time, 0.3, [0, 0, 0]));
            }
            for (let i = 0; i < plain.skein.length; i += 1) {
                expect(called.skeinAt(i, time, [0, 0, 0])).toEqual(plain.skeinAt(i, time, [0, 0, 0]));
            }
            const a = plain.write(time, 0.3, CRANE_EYE, nearA, farA);
            const b = called.write(time, 0.3, CRANE_EYE, nearB, farB);
            // The clock's birds first in each draw, float for float; the called ones after them.
            const head = (array, count) => Array.from(array.subarray(0, count * CRANE_STRIDE));
            expect(head(farB, a.far)).toEqual(head(farA, a.far));
            expect(head(nearB, a.near)).toEqual(head(nearA, a.near));
            expect(b.near + b.far).toBeGreaterThanOrEqual(a.near + a.far);
            extra = Math.max(extra, b.near + b.far - a.near - a.far);
        }
        expect(extra).toBe(called.called.length);
        // Other birds than the clock's skein: their own rhythm and looseness.
        expect(called.called.map((bird) => bird.rate)).not.toEqual(called.skein.map((bird) => bird.rate));
        expect(new CraneSky(BIRDS, 0x6372).called).toEqual(plain.called);
    });

    it.each([
        ['16:9', 16 / 9], ['16:10', 16 / 10], ['4:3', 4 / 3], ['a tall phone', 9 / 19.5],
    ])('comes in whole from out of sight on the left and leaves by the right edge (%s)', (_, aspect) => {
        const stage = new GoldenForestStage(goldenForestCamera(aspect));
        const point = new THREE.Vector3();
        for (const seed of [1, 2, 3, 0x6372]) {
            const sky = new CraneSky(BIRDS, seed);
            for (const start of [12.5, 300]) {
                const call = sky.call(start);
                const count = sky.called.length;
                const first = Array(count).fill(null);
                const last = Array(count).fill(null);
                let firstSeen = null;
                const end = start + crossing(call);
                for (let time = start; time < end + 2; time += DT) {
                    for (let i = 0; i < count; i += 1) {
                        const at = sky.calledAt(i, time, [0, 0, 0]);
                        if (!at) continue;
                        const seen = stage.project(at[0], at[1], at[2], point);
                        if (time === start) {
                            // Called: every bird of it is out of sight, left of the frame.
                            expect(seen.x, `seed ${seed} bird ${i} at its call`).toBeLessThan(-0.01);
                        }
                        if (!inFrame(seen)) continue;
                        if (first[i] === null) first[i] = seen.x;
                        last[i] = seen.x;
                        if (firstSeen === null) firstSeen = time - start;
                        // In the sky, above the far treetops.
                        expect(seen.y).toBeGreaterThan(0.02);
                        expect(seen.y).toBeLessThan(0.5);
                    }
                }
                for (let i = 0; i < count; i += 1) {
                    // Each bird was seen, came in through the left edge and went out through the right.
                    expect(first[i], `seed ${seed} bird ${i}`).not.toBeNull();
                    expect(first[i], `seed ${seed} bird ${i} first seen`).toBeLessThan(0.02);
                    expect(last[i], `seed ${seed} bird ${i} last seen`).toBeGreaterThan(0.98);
                }
                // A few seconds after it is called, not at once and not a minute on.
                expect(firstSeen).toBeGreaterThan(0.2);
                expect(firstSeen).toBeLessThan(20);
                // Then the sky is free of it.
                expect(sky.calledAt(0, end + 0.1)).toBeNull();
            }
        }
    });

    it('flies every bird at the one pace from its call to the far edge: no bird is born late or catches up', () => {
        for (const seed of [5, 0x6372]) {
            const sky = new CraneSky(BIRDS, seed);
            const start = 77;
            const call = sky.call(start);
            const count = sky.called.length;
            const {
                ux, uz, fx, fz,
            } = call.lane;
            const before = Array.from({ length: count }, () => null);
            let frames = 0;
            let slowest = Infinity;
            let fastest = 0;
            const lag = Array.from({ length: count }, () => [Infinity, -Infinity]);
            for (let time = start; ; time += DT) {
                const leader = sky.calledAt(0, time, [0, 0, 0]);
                if (!leader) {
                    // It leaves all at once, and only when its whole lane and more is flown.
                    for (let i = 0; i < count; i += 1) expect(sky.calledAt(i, time, [0, 0, 0])).toBeNull();
                    expect(time - start).toBeGreaterThanOrEqual(crossing(call) - DT);
                    break;
                }
                frames += 1;
                const along = (at) => (at[0] - fx) * ux + (at[2] - fz) * uz;
                for (let i = 0; i < count; i += 1) {
                    // From the very frame of its call to the frame it leaves, every bird is in the sky.
                    const at = sky.calledAt(i, time, [0, 0, 0]);
                    expect(at, `bird ${i} at ${(time - start).toFixed(2)} s`).not.toBeNull();
                    expect(at.every(Number.isFinite)).toBe(true);
                    if (before[i]) {
                        const speed = Math.hypot(at[0] - before[i][0], at[1] - before[i][1], at[2] - before[i][2]) / DT;
                        slowest = Math.min(slowest, speed);
                        fastest = Math.max(fastest, speed);
                    }
                    before[i] = [...at];
                    const behind = along(leader) - along(at);
                    lag[i][0] = Math.min(lag[i][0], behind);
                    lag[i][1] = Math.max(lag[i][1], behind);
                }
            }
            expect(frames * DT).toBeCloseTo(crossing(call), 1);
            // One pace, the skein's own, bird for bird and frame for frame.
            expect(slowest).toBeGreaterThan(CALLED_SKEIN.speed * 0.96);
            expect(fastest).toBeLessThan(CALLED_SKEIN.speed * 1.04);
            // Each keeps its place behind the leader, a little loose in its slot.
            for (let i = 1; i < count; i += 1) {
                expect(lag[i][0], `bird ${i}`).toBeGreaterThan(0);
                expect(lag[i][1] - lag[i][0], `bird ${i}`).toBeLessThan(3);
            }
            // The leader starts where the lane begins.
            const origin = sky.calledAt(0, start, [0, 0, 0]);
            expect(Math.hypot(origin[0] - fx, origin[2] - fz)).toBeLessThan(6);
        }
    });

    it('crosses the low sun, as every skein of the lake does', () => {
        const sun = GOLDEN_FOREST_SUN_DIRECTION;
        for (const seed of [1, 2, 3, 0x6372]) {
            const sky = new CraneSky(BIRDS, seed);
            for (let n = 0; n < 4; n += 1) {
                const start = 20 + n * 90;
                const call = sky.call(start);
                let nearest = Infinity;
                for (let time = start; time < start + crossing(call); time += 0.1) {
                    for (let i = 0; i < sky.called.length; i += 1) {
                        const at = sky.calledAt(i, time, [0, 0, 0]);
                        const d = at.map((value, axis) => value - CRANE_EYE[axis]);
                        const cos = (d[0] * sun.x + d[1] * sun.y + d[2] * sun.z) / Math.hypot(...d);
                        nearest = Math.min(nearest, Math.acos(Math.min(1, cos)));
                    }
                }
                expect(nearest / DEG, `seed ${seed} call ${n}`).toBeLessThan(3);
            }
        }
    });

    it('is one at a time: a call while one is crossing is that skein\'s, and after it has left a new one comes', () => {
        const sky = new CraneSky(BIRDS, 0x6372);
        const first = sky.call(50);
        expect(sky.calling).toBe(first);
        expect(first.start).toBe(50);
        expect(sky.calls).toBe(1);
        const whole = crossing(first);
        const somewhere = sky.calledAt(3, 50 + whole * 0.5, [0, 0, 0]);
        // Called again and again while it crosses: the same skein, not set back, not hurried.
        for (const share of [0, 0.01, 0.3, 0.5, 0.95, 0.999]) {
            expect(sky.call(50 + whole * share)).toBe(first);
        }
        expect(first.start).toBe(50);
        expect(sky.calls).toBe(1);
        expect(sky.calledAt(3, 50 + whole * 0.5, [0, 0, 0])).toEqual(somewhere);
        // Once its last bird has left by the far edge the sky is free: the draw lets it go ...
        const room = (BIRDS + sky.sizes.skein) * CRANE_STRIDE;
        const near = new Float32Array(room);
        const far = new Float32Array(room);
        const during = sky.write(50 + whole * 0.5, 0, CRANE_EYE, near, far);
        const after = sky.write(50 + whole + 2, 0, CRANE_EYE, near, far);
        expect(sky.calling).toBeNull();
        expect(during.near + during.far).toBeGreaterThan(after.near + after.far - sky.skein.length);
        expect(sky.calledAt(0, 50 + whole + 2)).toBeNull();
        // ... and the next call is a new skein, starting from its own call.
        const second = sky.call(50 + whole + 3);
        expect(second).not.toBe(first);
        expect(second.start).toBe(50 + whole + 3);
        expect(sky.calls).toBe(2);
        expect(sky.calledAt(0, second.start, [0, 0, 0])).not.toBeNull();
        // Even with no frame drawn between, a call after the old one has left is a new one.
        const third = sky.call(second.start + crossing(second) + 0.5);
        expect(third).not.toBe(second);
        // A new session clears the sky of it.
        sky.reset();
        expect(sky.calling).toBeNull();
        expect(sky.calledAt(0, third.start + 1)).toBeNull();
        expect(sky.call(third.start + 2)).not.toBe(third);
    });

    it('has room in both draws for the clock\'s cranes and a called skein together, at every tier', () => {
        for (const [name, tier] of Object.entries(GOLDEN_FOREST_TIERS)) {
            if (!tier.birds) continue;
            const sky = new CraneSky(tier.birds, 11);
            const room = (tier.birds + sky.sizes.skein) * CRANE_STRIDE;
            const near = new Float32Array(room);
            const far = new Float32Array(room);
            // A moment when the clock's own skein is in the sky as well.
            const time = SKEIN.period + 12;
            expect(sky.skeinAt(0, time, [0, 0, 0]), name).not.toBeNull();
            sky.call(time - 6);
            const drawn = sky.write(time, 0, CRANE_EYE, near, far);
            expect(drawn.near + drawn.far, name).toBe(sky.kettle.length + sky.skein.length + sky.called.length);
            // From inside the flock every bird is a near one: the near draw alone holds them all.
            const inside = sky.kettleAt(0, time, 0, [0, 0, 0]);
            const close = sky.write(time, 0, inside, near, far);
            expect(close.near + close.far, name).toBe(sky.kettle.length + sky.skein.length + sky.called.length);
            expect(near.every(Number.isFinite) && far.every(Number.isFinite)).toBe(true);
        }
    });
});

describe('the boat that rocks', () => {
    function makeShore() {
        const light = makeLight();
        const rowboat = own(new THREE.BoxGeometry(1, 1, 1));
        const shore = own(new GoldenForestShore({
            light, props: { meshes: { rowboat } }, tier: GOLDEN_FOREST_TIERS.Minimal, rng: seededRandom(8),
        }));
        shore.build();
        return shore;
    }

    it('lies where the shore says, for whatever crosses the water to find it', () => {
        const shore = makeShore();
        expect(shore.boat.name).toBe('GoldenForest rowboat');
        expect(shore.boatPlace.x).toBe(shore.boat.position.x);
        expect(shore.boatPlace.z).toBe(shore.boat.position.z);
        expect(shore.rocked).toBe(0);
    });

    it('takes a harder rocking over a gentler one, restarts none, and ignores what is no strength', () => {
        const shore = makeShore();
        shore.rock(0.4);
        expect(shore.rocked).toBe(0.4);
        shore.rock(0.2);
        expect(shore.rocked).toBe(0.4);
        shore.rock(0.7);
        expect(shore.rocked).toBe(0.7);
        for (const junk of [NaN, Infinity, undefined, null, 'hard', -3]) {
            shore.rock(junk);
            expect(shore.rocked).toBe(0.7);
        }
        shore.rock(40);
        expect(shore.rocked).toBe(1);
    });

    it('rolls wider when rocked, settles over a few seconds, and rings the water more often meanwhile', () => {
        const run = (rock) => {
            const shore = makeShore();
            let time = 0;
            let rings = 0;
            let roll = 0;
            let heave = 0;
            const rocked = [];
            for (let frame = 0; frame < 30 / DT; frame += 1) {
                if (frame === 60 && rock) shore.rock(1);
                time += DT;
                const ring = shore.update(time, DT);
                if (ring) {
                    rings += 1;
                    expect(ring).toBe(shore.boat.position);
                }
                if (frame >= 60 && frame < 60 + 4 / DT) {
                    roll = Math.max(roll, Math.abs(shore.boat.rotation.z));
                    heave = Math.max(heave, Math.abs(shore.boat.position.y));
                }
                rocked.push(shore.rocked);
                expect(shore.boat.matrix.elements.every(Number.isFinite)).toBe(true);
            }
            return {
                shore, rings, roll, heave, rocked,
            };
        };
        const calm = run(false);
        const struck = run(true);
        expect(struck.roll).toBeGreaterThan(calm.roll * 1.5);
        expect(struck.heave).toBeGreaterThan(calm.heave);
        expect(struck.rings).toBeGreaterThan(calm.rings);
        // It dies away steadily and is quite gone within half a minute; it never rocks itself harder.
        const after = struck.rocked.slice(60);
        for (let index = 1; index < after.length; index += 1) {
            expect(after[index]).toBeLessThanOrEqual(after[index - 1]);
        }
        expect(after[0]).toBeGreaterThan(0.9);
        expect(after[Math.round(2 / DT)]).toBeGreaterThan(0.05);
        expect(after.at(-1)).toBe(0);
        // Even rocked full, it rolls by degrees and rides millimetres, never out of the water.
        expect(struck.roll).toBeLessThan(0.3);
        expect(struck.heave).toBeLessThan(0.2);
        // A frozen or nonsensical timestep neither settles it nor rocks it on.
        const { shore } = run(false);
        shore.rock(0.5);
        for (const dt of [0, -1, NaN, Infinity, undefined, 'soon']) {
            const phase = shore.rockPhase;
            shore.update(31, dt);
            if (dt !== Infinity) {
                expect(shore.rocked).toBe(0.5);
                expect(shore.rockPhase).toBe(phase);
            }
            expect(shore.boat.matrix.elements.every(Number.isFinite)).toBe(true);
        }
    });
});

describe('the smoke on the water and the far ranges\' ground', () => {
    it.each(TIER_NAMES)('lays as many sheets of smoke as %s asks, and keeps them out of the mirror', (name) => {
        const tier = GOLDEN_FOREST_TIERS[name];
        const light = makeLight(name);
        const atmosphere = own(new GoldenForestAtmosphere({ light, tier, rng: seededRandom(5) }));
        atmosphere.buildSky();
        atmosphere.buildSmoke();
        expect(atmosphere.smoke).toHaveLength(tier.smoke);
        expect(atmosphere.group.children).toEqual([atmosphere.sky, ...atmosphere.smoke]);
        atmosphere.smoke.forEach((sheet, index) => {
            expect(sheet.name).toBe(`GoldenForestWaterSmoke ${index}`);
            expect(sheet.material.name).toBe(sheet.name);
            // Level, just over the lake, over the open water in front of the eye.
            expect(sheet.position.y).toBeGreaterThan(0);
            expect(sheet.position.y).toBeLessThan(3);
            expect(sheet.position.z).toBeLessThan(0);
            expect(sheet.material.transparent).toBe(true);
            expect(sheet.material.depthWrite).toBe(false);
            expect(sheet.material.opacityNode.isNode).toBe(true);
            expect(sheet.castShadow).toBe(false);
            if (index > 0) {
                expect(sheet.position.y).toBeGreaterThan(atmosphere.smoke[index - 1].position.y);
                expect(sheet.material).not.toBe(atmosphere.smoke[index - 1].material);
            }
        });
        // The world puts the air in the lake's mirror; the sheets lying on the water alone are taken out.
        atmosphere.group.traverse((object) => object.layers.enable(GOLDEN_FOREST_MIRROR_LAYER));
        atmosphere.keepOutOfMirror(GOLDEN_FOREST_MIRROR_LAYER);
        for (const sheet of atmosphere.smoke) {
            expect(sheet.layers.isEnabled(GOLDEN_FOREST_MIRROR_LAYER)).toBe(false);
            expect(sheet.layers.isEnabled(0)).toBe(true);
        }
        expect(atmosphere.sky.layers.isEnabled(GOLDEN_FOREST_MIRROR_LAYER)).toBe(true);
        expect(atmosphere.group.layers.isEnabled(GOLDEN_FOREST_MIRROR_LAYER)).toBe(true);
        atmosphere.dispose();
        expect(atmosphere.smoke).toEqual([]);
        expect(() => atmosphere.keepOutOfMirror(GOLDEN_FOREST_MIRROR_LAYER)).not.toThrow();
    });

    function makeBackdrop(quality, seed = 6) {
        const light = makeLight(quality);
        let draws = 0;
        const stream = seededRandom(seed);
        const rng = () => {
            draws += 1;
            return stream();
        };
        const backdrop = own(new GoldenForestBackdrop({
            light, impostors: null, tier: GOLDEN_FOREST_TIERS[quality], rng,
        }));
        backdrop.build();
        return { backdrop, draws: () => draws };
    }

    it('builds the ranges as real ground on every tier, from the draws the ridges always took', () => {
        const R = GOLDEN_FOREST_RANGES;
        const counts = {};
        for (const quality of ['High', 'Low', 'Minimal']) {
            const { backdrop, draws } = makeBackdrop(quality);
            // Six draws a ridge from the theme's stream, four ridges, as before the ranges were ground.
            expect(draws(), quality).toBe(24);
            expect(backdrop.count).toBe(0);
            const names = backdrop.group.children.map((child) => child.name);
            expect(names).toEqual(['GoldenForestRidges', 'GoldenForestRanges']);
            const { ranges } = backdrop;
            expect(ranges.material.name).toBe('GoldenForestRanges');
            expect(ranges.material.colorNode.isNode).toBe(true);
            expect(ranges.castShadow).toBe(false);
            const position = ranges.geometry.getAttribute('position');
            const normal = ranges.geometry.getAttribute('normal');
            expect(normal.count).toBe(position.count);
            const box = new THREE.Box3().setFromBufferAttribute(position);
            // The whole grid, edge to edge; a little under the lake where there is no mountain.
            expect([box.min.x, box.max.x, box.min.z, box.max.z]).toEqual([R.minX, R.maxX, R.minZ, R.maxZ]);
            expect(box.min.y).toBeLessThan(0);
            expect(box.min.y).toBeGreaterThan(-20);
            expect(box.max.y).toBeGreaterThan(R.front.crest * 0.5);
            expect(position.array.every(Number.isFinite)).toBe(true);
            expect(normal.array.every(Number.isFinite)).toBe(true);
            // Its faces look up: lit from the sky, seen from the lake.
            let up = 0;
            for (let index = 0; index < normal.count; index += 1) if (normal.getY(index) > 0) up += 1;
            expect(up).toBe(normal.count);
            expect(ranges.geometry.index.count % 3).toBe(0);
            let highest = 0;
            for (let index = 0; index < ranges.geometry.index.count; index += 1) {
                highest = Math.max(highest, ranges.geometry.index.getX(index));
            }
            expect(highest).toBe(position.count - 1);
            counts[quality] = position.count;
            // The two silhouettes in front of them: a strip each, with its crest and slope at every post.
            const ridges = backdrop.group.children[0];
            const shape = ridges.geometry.getAttribute('_ridge');
            expect(shape.itemSize).toBe(3);
            expect(shape.count).toBe(ridges.geometry.getAttribute('position').count);
            expect(shape.array.every(Number.isFinite)).toBe(true);
            const posts = ridges.geometry.getAttribute('position');
            expect(new Set(Array.from({ length: shape.count }, (_, index) => posts.getZ(index))).size)
                .toBe(2);
        }
        // A finer grid where the post chain is, a coarser one where it is not; the same mountains.
        expect(counts.High).toBeGreaterThan(counts.Low);
        expect(counts.Low).toBe(counts.Minimal);
    });

    it('grows the same ranges from the same stream, and other ranges from another', () => {
        const heights = (seed) => {
            const { backdrop } = makeBackdrop('Low', seed);
            expect(Number.isInteger(backdrop.rangeSeed) && backdrop.rangeSeed > 0).toBe(true);
            return { seed: backdrop.rangeSeed, y: Array.from(backdrop.ranges.geometry.getAttribute('position').array) };
        };
        const a = heights(6);
        expect(heights(6)).toEqual(a);
        const b = heights(7);
        expect(b.seed).not.toBe(a.seed);
        expect(b.y).not.toEqual(a.y);
    });

    it('draws a ridge\'s crest the same for the same offsets, always standing, with a saddle where the sun is', () => {
        const offsets = [0.4, 1.9, 3.3, 5.1, 2.2, 4.7];
        const crest = goldenForestRidgeCrest({
            offsets, jagged: 0.8, seed: 11, sunU: -0.1,
        });
        const again = goldenForestRidgeCrest({
            offsets, jagged: 0.8, seed: 11, sunU: -0.1,
        });
        const other = goldenForestRidgeCrest({
            offsets: offsets.map((value) => value + 1), jagged: 0.8, seed: 11, sunU: -0.1,
        });
        let differs = false;
        for (let u = -0.5; u <= 0.5; u += 0.004) {
            expect(crest(u)).toBe(again(u));
            expect(Number.isFinite(crest(u)) && crest(u) > 0).toBe(true);
            if (crest(u) !== other(u)) differs = true;
        }
        expect(differs).toBe(true);
        // Ridge after ridge, the crest is lower where the sun stands than it would be without the saddle
        // there (never higher; equal only where the ridge is already at its least).
        let lower = 0;
        const trials = 60;
        for (let trial = 0; trial < trials; trial += 1) {
            const draw = seededRandom(100 + trial);
            const own6 = Array.from({ length: 6 }, () => draw() * 6.283);
            const withSaddle = goldenForestRidgeCrest({
                offsets: own6, jagged: 0.8, seed: 11, sunU: -0.1,
            });
            const elsewhere = goldenForestRidgeCrest({
                offsets: own6, jagged: 0.8, seed: 11, sunU: 0.4,
            });
            expect(withSaddle(-0.1)).toBeLessThanOrEqual(elsewhere(-0.1));
            if (withSaddle(-0.1) < elsewhere(-0.1)) lower += 1;
        }
        expect(lower / trials).toBeGreaterThan(0.8);
    });
});
