/**
 * Golden Forest — the living lake, part three: the whole world on the real asset pack (no GPU).
 *
 * The air the world keeps beside its hour, the envelopes it wears for the light, the events' marks
 * placed on the water, the crowns the spruces breathe pollen from, the skeins it calls, what it
 * throws into the air, a minute of mixed play with every uniform and buffer watched, and the new
 * shaders built to WGSL and GLSL against a stub renderer.
 */
import {
    afterAll, afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GOLDEN_FOREST_AIRS, GOLDEN_FOREST_AIR_HOLD, GOLDEN_FOREST_AIR_SECONDS, goldenForestAirDrift,
} from '../../src/themes/golden-forest/golden-forest-airs.js';
import { disposeGoldenForestAssets } from '../../src/themes/golden-forest/golden-forest-assets.js';
import { GoldenForestBirds } from '../../src/themes/golden-forest/golden-forest-birds.js';
import { CALLED_SKEIN, CRANE_STRIDE, SKEIN } from '../../src/themes/golden-forest/golden-forest-crane-flight.js';
import {
    GOLDEN_FOREST_MIRROR_LAYER, GOLDEN_FOREST_WAVE,
} from '../../src/themes/golden-forest/golden-forest-lake.js';
import { GOLDEN_FOREST_SUN_DIRECTION, GoldenForestLight } from '../../src/themes/golden-forest/golden-forest-light.js';
import { GoldenForestPost } from '../../src/themes/golden-forest/golden-forest-post.js';
import { GOLDEN_FOREST_TIERS } from '../../src/themes/golden-forest/golden-forest-quality.js';
import { GOLDEN_FOREST_RANGES, createGoldenForestRanges } from '../../src/themes/golden-forest/golden-forest-ranges.js';
import {
    GOLDEN_FOREST_BEAM_SLOTS, GOLDEN_FOREST_DUSK, GOLDEN_FOREST_TRACK_SLOTS, GoldenForestReactions,
} from '../../src/themes/golden-forest/golden-forest-reactions.js';
import { GoldenForestStage } from '../../src/themes/golden-forest/golden-forest-stage.js';
import { goldenForestGroundHeight } from '../../src/themes/golden-forest/golden-forest-terrain.js';
import { build, stubRenderer, unassignedReads } from './helpers/tsl-node-build.js';
import {
    STEP, allFinite, buildGoldenForestWorld, goldenForestCamera, loadGoldenForestBundle, nonFiniteUniforms,
    seededRandom,
} from './helpers/golden-forest-lake.js';

// Building a lake from the real asset pack takes seconds on a busy machine.
const SLOW = 120000;
const DEG = Math.PI / 180;
const TRACK_KINDS = ['waves', 'swirls', 'roads'];
// The tiers the world-level contracts are held to: the dearest built in tests, and the two without the post chain.
const BUILT = ['High', 'Low', 'Minimal'];
const cell = (x, y) => ({ x, y, shape: [[1]] });

let assets;
const worlds = [];

beforeAll(async () => {
    assets = await loadGoldenForestBundle();
}, SLOW);

afterAll(() => {
    disposeGoldenForestAssets(assets);
});

afterEach(() => {
    worlds.splice(0).forEach((resource) => resource.dispose());
    vi.restoreAllMocks();
});

/** A world of its own on the shared bundle (the bundle outlives it). */
function lakeAt(quality = 'Minimal', options = {}) {
    const built = buildGoldenForestWorld(quality, assets, options);
    worlds.push(built.world);
    return built;
}

function director(quality = 'High', seed = 5) {
    return new GoldenForestReactions({ quality, rng: seededRandom(seed) });
}

function lensFor({ world, scene, camera }, quality) {
    const renderer = { toneMapping: THREE.NoToneMapping, toneMappingExposure: 1, render: vi.fn() };
    const post = new GoldenForestPost({
        renderer, scene, camera, quality, light: world.light,
    });
    worlds.push(post);
    return post;
}

describe('the lake\'s air in the world', () => {
    it('starts in the still air and turns the airs by the clock alone, at their own pace', () => {
        const { world } = lakeAt('Minimal');
        const { light } = world;
        expect(world.airHold).toBeNull();
        expect(world.airPhase(0)).toBe(0);
        expect(world.getDiagnostics()).toMatchObject({ air: 'still', airPhase: 0 });
        const N = GOLDEN_FOREST_AIRS.length;
        for (let k = 0; k <= N; k += 1) {
            const air = GOLDEN_FOREST_AIRS[k % N];
            world.update(k * GOLDEN_FOREST_AIR_SECONDS, STEP, {});
            expect(light.airPhase).toBe(k);
            expect(light.uDeck.value, air.name).toBe(air.deck);
            expect(light.uMist.value, air.name).toBe(air.mist);
            expect(light.uRuffle.value, air.name).toBe(air.ruffle);
            expect(world.getDiagnostics()).toMatchObject({ air: air.name, airPhase: k });
            // Still that air at the end of its rest; then it melts toward the next.
            world.update((k + GOLDEN_FOREST_AIR_HOLD * 0.99) * GOLDEN_FOREST_AIR_SECONDS, STEP, {});
            expect(light.airPhase).toBe(k);
            const halfMelted = k + GOLDEN_FOREST_AIR_HOLD + (1 - GOLDEN_FOREST_AIR_HOLD) * 0.5;
            world.update(halfMelted * GOLDEN_FOREST_AIR_SECONDS, STEP, {});
            expect(light.airPhase).toBeGreaterThan(k);
            expect(light.airPhase).toBeLessThan(k + 1);
        }
        // A function of the time alone: sought back, it is the still air again.
        world.update(1, STEP, {});
        expect(light.airPhase).toBe(0);
        expect(world.airPhase(321)).toBe(goldenForestAirDrift(321));
        // A level turns the hour on, not the weather.
        world.setLevel(3, { silent: true });
        expect(world.airPhase(321)).toBe(goldenForestAirDrift(321));
        expect(nonFiniteUniforms(light)).toEqual([]);
    }, SLOW);

    it('holds one air still for a capture, by name or by number, and lets the clock have them again', () => {
        const { world } = lakeAt('Minimal');
        const mist = GOLDEN_FOREST_AIRS.findIndex((air) => air.name === 'mist');
        expect(world.setAirHold('mist')).toBe(mist);
        expect(world.airHold).toBe(mist);
        for (const time of [0, 50, 1000, 12345.6]) {
            expect(world.airPhase(time)).toBe(mist);
            world.update(time, STEP, {});
            expect(world.light.airPhase).toBe(mist);
            expect(world.light.uMist.value).toBe(GOLDEN_FOREST_AIRS[mist].mist);
            expect(world.getDiagnostics()).toMatchObject({ air: 'mist', airPhase: mist });
        }
        expect(world.setAirHold('Burning-Sky')).toBe(1);
        expect(world.setAirHold(2)).toBe(2);
        expect(world.setAirHold('3')).toBe(3);
        world.update(7, STEP, {});
        expect(world.getDiagnostics().air).toBe(GOLDEN_FOREST_AIRS[3].name);
        // No such air, or none asked for: the clock turns them again.
        for (const none of [null, undefined, '', 'fog']) {
            world.setAirHold(2);
            expect(world.setAirHold(none), String(none)).toBeNull();
            expect(world.airHold).toBeNull();
            expect(world.airPhase(GOLDEN_FOREST_AIR_SECONDS)).toBe(1);
        }
        world.update(GOLDEN_FOREST_AIR_SECONDS, STEP, {});
        expect(world.getDiagnostics()).toMatchObject({ air: GOLDEN_FOREST_AIRS[1].name, airPhase: 1 });
        // A held air is the hour's business no more than the clock's air was.
        const sun = world.light.uSunColor.value.toArray();
        world.setAirHold('clear');
        world.update(GOLDEN_FOREST_AIR_SECONDS, STEP, {});
        expect(world.light.uSunColor.value.toArray()).toEqual(sun);
    }, SLOW);

    it('takes the evening up where the last world left it: the air with the hour', () => {
        const { world } = lakeAt('Minimal');
        world.moodStart = GOLDEN_FOREST_AIR_SECONDS * 2;
        expect(world.airPhase(0)).toBe(2);
        world.update(0, STEP, {});
        expect(world.getDiagnostics()).toMatchObject({ air: GOLDEN_FOREST_AIRS[2].name, airPhase: 2 });
        expect(world.light.uDeck.value).toBe(GOLDEN_FOREST_AIRS[2].deck);
        // Nonsense for what came before is nothing before.
        for (const before of [NaN, -40, Infinity, undefined, null]) {
            world.moodStart = before;
            expect(world.airPhase(0), String(before)).toBe(0);
        }
        // A disposed world still says which air it would stand in.
        world.dispose();
        expect(world.getDiagnostics()).toMatchObject({ air: 'still', airPhase: 0 });
        expect(() => world.setAirHold('mist')).not.toThrow();
    }, SLOW);
});

describe('what the world wears for the light', () => {
    it('hands the rush, the gilding and the dusk to the light rig, bounded', () => {
        const { world } = lakeAt('Minimal');
        const { light } = world;
        world.update(1, STEP, {
            rush: 0.5, gild: 0.4, gildReach: 0.7, dusk: 0.25,
        });
        expect(world.worn).toMatchObject({
            rush: 0.5, gild: 0.4, gildReach: 0.7, dusk: 0.25,
        });
        expect(light.uGild.value.toArray()).toEqual([0.7, 0.4]);
        expect(light.uDusk.value).toBe(0.25);
        // The rush is on the cloud's clock this very frame.
        const before = light.uCloudClock.value;
        world.update(1 + STEP, STEP, { rush: 1 });
        const raced = light.uCloudClock.value - before;
        world.update(1 + 2 * STEP, STEP, {});
        expect(raced).toBeGreaterThan(light.uCloudClock.value - before - raced);
        // Reduce motion calms the race.
        world.setMotion(0);
        const still = light.uCloudClock.value;
        world.update(1 + 3 * STEP, STEP, { rush: 1 });
        expect(light.uCloudClock.value - still).toBeCloseTo(light.air.drift * STEP, 9);
        world.setMotion(1);
        // Out of range, or no numbers at all: bounded, never NaN.
        for (const frame of [{
            rush: 9, gild: 9, gildReach: 9, dusk: 9,
        }, {
            rush: -1, gild: -1, gildReach: -1, dusk: -1,
        }, {
            rush: NaN, gild: 'bright', gildReach: Infinity, dusk: null,
        }, {}]) {
            world.update(2, STEP, frame);
            for (const key of ['rush', 'gild', 'gildReach', 'dusk']) {
                expect(world.worn[key] >= 0 && world.worn[key] <= 1, `${key} = ${world.worn[key]}`).toBe(true);
            }
            expect(nonFiniteUniforms(light)).toEqual([]);
        }
        expect(world.worn).toMatchObject({
            rush: 0, gild: 0, gildReach: 0, dusk: 0,
        });
    }, SLOW);

    it('gilds every shore at once for a perfect clear\'s crown, whatever the combo has done', () => {
        const { world } = lakeAt('Minimal');
        world.update(1, STEP, { crown: 1, gild: 0, gildReach: 0 });
        expect(world.worn.gild).toBe(1);
        expect(world.worn.gildReach).toBe(1);
        // A crown fading: the gilding fades with it, and never under what the combo's river has gilded.
        world.update(1, STEP, { crown: 0.2, gild: 0.5, gildReach: 0.1 });
        expect(world.worn.gild).toBe(0.5);
        expect(world.worn.gildReach).toBeGreaterThanOrEqual(0.2);
        expect(world.worn.gildReach).toBeLessThanOrEqual(1);
        world.update(1, STEP, { crown: 0, gild: 0.3, gildReach: 0.6 });
        expect(world.worn).toMatchObject({ gild: 0.3, gildReach: 0.6 });
        // A new session wears none of it.
        world.update(1, STEP, {
            crown: 1, rush: 1, dusk: 1, gild: 1, gildReach: 1,
        });
        world.resetEffects();
        expect(world.worn).toMatchObject({
            rush: 0, gild: 0, gildReach: 0, dusk: 0,
        });
    }, SLOW);
});

describe('the events\' marks placed on the water', () => {
    it('has a place in its pool for every track the director can run at once', () => {
        const { world } = lakeAt('Minimal');
        const slots = TRACK_KINDS.reduce((sum, kind) => sum + GOLDEN_FOREST_TRACK_SLOTS[kind], 0);
        expect(world.trackPool.length).toBeGreaterThanOrEqual(slots);
        expect(world.lake.waveRows).toHaveLength(GOLDEN_FOREST_TRACK_SLOTS.waves);
        expect(world.lake.swirlRows).toHaveLength(GOLDEN_FOREST_TRACK_SLOTS.swirls);
        // The fullest frame the director can make: every slot of every kind running.
        const reactions = director('Minimal');
        for (let n = 0; n < 4; n += 1) {
            reactions.onLineClear(4);
            reactions.onTwist({ piece: cell(n % 2 ? 1 : 8, 12) });
            reactions.onBackToBack();
            reactions.update(0.4);
        }
        const frame = reactions.update(STEP);
        for (const kind of TRACK_KINDS) expect(frame[kind], kind).toHaveLength(GOLDEN_FOREST_TRACK_SLOTS[kind]);
        const placed = world.placeTracks(frame);
        for (const kind of TRACK_KINDS) expect(placed[kind], kind).toHaveLength(GOLDEN_FOREST_TRACK_SLOTS[kind]);
        // Every one of them reaches the lake.
        world.update(reactions.time, STEP, frame);
        expect(world.lake.uWaveCount.value).toBe(GOLDEN_FOREST_TRACK_SLOTS.waves);
        expect(world.lake.uSwirlCount.value).toBe(GOLDEN_FOREST_TRACK_SLOTS.swirls);
        expect(world.lake.uRoad.value.toArray().every((value) => value > 0)).toBe(true);
        expect(nonFiniteUniforms(world.lake)).toEqual([]);
    }, SLOW);

    it('starts a great wave under the board\'s foot, winds a spiral beside the card on the piece\'s side', () => {
        const { world } = lakeAt('Minimal');
        const reactions = director('Minimal');
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        reactions.onTwist({ piece: cell(1, 20) });
        reactions.onBackToBack();
        reactions.update(0.5);
        reactions.onTwist({ piece: cell(8, 20) });
        const frame = reactions.update(STEP);
        const placed = world.placeTracks(frame);
        expect(placed).toBe(world.tracks);
        const left = world.stage.edge(-1, 0);
        const right = world.stage.edge(1, 0);
        const [wave] = placed.waves;
        const waveX = wave.x;
        // On the water in front of the eye, behind the card's foot, between its two edges.
        expect(goldenForestGroundHeight(wave.x, wave.z)).toBeLessThan(0);
        expect(wave.z).toBeLessThan(world.camera.position.z);
        expect(wave.x).toBeGreaterThan(left.x - 1);
        expect(wave.x).toBeLessThan(right.x + 1);
        expect(wave.age).toBe(frame.waves[0].age);
        expect(wave.strength).toBe(frame.waves[0].strength);
        // The spirals: one left of the card, one right of it, each turning its own way.
        expect(placed.swirls).toHaveLength(2);
        const [first, second] = placed.swirls;
        expect(first.turn).toBe(-1);
        expect(first.x).toBeLessThan(left.x);
        expect(second.turn).toBe(1);
        expect(second.x).toBeGreaterThan(right.x);
        for (const swirl of placed.swirls) {
            expect(goldenForestGroundHeight(swirl.x, swirl.z)).toBeLessThan(0);
            expect(Math.abs(swirl.x)).toBeLessThan(12);
        }
        // The road needs no place: only how old its pulse is and how strong.
        expect(placed.roads).toHaveLength(1);
        expect(placed.roads[0].age).toBe(frame.roads[0].age);
        expect(placed.roads[0].strength).toBe(frame.roads[0].strength);
        // Nothing is made anew for the next frame: the same lists and the same places, filled again.
        const lists = [placed.waves, placed.swirls, placed.roads];
        const places = [...placed.waves, ...placed.swirls, ...placed.roads];
        const again = world.placeTracks(reactions.update(STEP));
        expect([again.waves, again.swirls, again.roads]).toEqual(lists);
        [again.waves, again.swirls, again.roads].forEach((list, index) => expect(list).toBe(lists[index]));
        for (const place of [...again.waves, ...again.swirls, ...again.roads]) expect(world.trackPool).toContain(place);
        expect(places.every((place) => world.trackPool.includes(place))).toBe(true);
        // The marks move with the measured card.
        world.setBoard({
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        });
        const moved = world.placeTracks(frame);
        expect(moved.waves[0].x).toBeLessThan(waveX - 1);
        expect(moved.swirls[1].x).toBeLessThan(0);
        // A frame without tracks leaves none on the water.
        const none = world.placeTracks({});
        expect([none.waves, none.swirls, none.roads]).toEqual([[], [], []]);
    }, SLOW);

    it('never runs out of places with a throw or a hole, however many tracks a frame claims to hold', () => {
        const { world } = lakeAt('Minimal');
        const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));
        const frames = [
            {
                waves: many(40, (index) => ({ strength: 1, age: index * 0.1, column: index / 40 })),
                swirls: many(40, (index) => ({ strength: 1, age: index * 0.05, turn: index % 2 ? 1 : -1 })),
                roads: many(40, (index) => ({ strength: 1, age: index * 0.05 })),
            },
            { waves: 'x', swirls: 7, roads: {} },
            { waves: [null, undefined, 3, 'wave', {}, []], swirls: [null, {}], roads: [undefined, { strength: 0 }] },
            {
                waves: [{ strength: 1, age: NaN, column: NaN }, { strength: NaN, age: 1 },
                    { strength: 1, age: 1, column: 'left' }],
                swirls: [{ strength: 1, age: NaN, turn: NaN }, { strength: Infinity, age: 1, turn: 'round' }],
                roads: [{ strength: 1, age: NaN }, { strength: -1, age: 1 }],
            },
        ];
        for (const frame of frames) {
            expect(() => world.update(1, STEP, frame)).not.toThrow();
            const { tracks } = world;
            const total = tracks.waves.length + tracks.swirls.length + tracks.roads.length;
            expect(total).toBeLessThanOrEqual(world.trackPool.length);
            // What was placed is a place of the pool, each used once.
            const used = [...tracks.waves, ...tracks.swirls, ...tracks.roads];
            expect(used.every((place) => world.trackPool.includes(place))).toBe(true);
            expect(new Set(used).size).toBe(used.length);
            // The lake draws no more than it has rows for, and nothing that is not a number.
            expect(world.lake.uWaveCount.value).toBeLessThanOrEqual(world.lake.waveRows.length);
            expect(world.lake.uSwirlCount.value).toBeLessThanOrEqual(world.lake.swirlRows.length);
            expect(nonFiniteUniforms(world.lake)).toEqual([]);
            for (let index = 0; index < world.lake.uWaveCount.value; index += 1) {
                expect(world.lake.waveRows[index].toArray().every(Number.isFinite)).toBe(true);
            }
            for (let index = 0; index < world.lake.uSwirlCount.value; index += 1) {
                expect(world.lake.swirlRows[index].toArray().every(Number.isFinite)).toBe(true);
            }
            expect(world.shore.boat.matrix.elements.every(Number.isFinite)).toBe(true);
        }
        // After the junk, a real frame is drawn as ever.
        const reactions = director('Minimal');
        reactions.onLineClear(4);
        world.update(2, STEP, reactions.update(0.5));
        expect(world.lake.uWaveCount.value).toBe(1);
        // And a new session clears the water of every mark.
        world.resetEffects();
        expect([world.lake.uWaveCount.value, world.lake.uSwirlCount.value]).toEqual([0, 0]);
        expect(world.lake.uRoad.value.toArray()).toEqual([0, 0, 0, 0]);
    }, SLOW);

    it('rocks the rowboat at its mooring when a great wave\'s crest reaches it, less under Reduce motion', () => {
        const rockedBy = (motion) => {
            const { world } = lakeAt('Minimal');
            world.setMotion(motion);
            const reactions = director('Minimal');
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            let peak = 0;
            let reachedAt = null;
            let time = 0;
            for (let frame = 0; frame < GOLDEN_FOREST_WAVE.life / STEP; frame += 1) {
                time += STEP;
                world.update(time, STEP, reactions.update(STEP));
                if (world.shore.rocked > 0 && reachedAt === null) reachedAt = time;
                peak = Math.max(peak, world.shore.rocked);
                expect(world.shore.boat.matrix.elements.every(Number.isFinite)).toBe(true);
            }
            const boat = world.shore.boatPlace;
            const from = world.tracks.waves[0] ?? { x: 0, z: 0 };
            return {
                peak, reachedAt, away: Math.hypot(boat.x - from.x, boat.z - from.z), settled: world.shore.rocked,
            };
        };
        const full = rockedBy(1);
        expect(full.peak).toBeGreaterThan(0.5);
        expect(full.peak).toBeLessThanOrEqual(1);
        // When the crest gets there, not when the wave begins: the boat is a few metres off.
        expect(full.reachedAt).toBeGreaterThan(0);
        expect(full.reachedAt).toBeLessThan(GOLDEN_FOREST_WAVE.life / 2);
        // It has all but settled by the time the wave has crossed the lake.
        expect(full.settled).toBeLessThan(full.peak * 0.2);
        const calm = rockedBy(0.35);
        expect(calm.peak).toBeGreaterThan(0);
        expect(calm.peak).toBeLessThan(full.peak);
        expect(rockedBy(0).peak).toBe(0);
    }, SLOW);
});

describe('the crowns the spruces breathe their pollen from', () => {
    it.each(BUILT)('are high in the near conifers of the %s lake, from a stream of their own', (quality) => {
        let draws = 0;
        const { world } = lakeAt(quality);
        const { rng } = world;
        world.rng = () => {
            draws += 1;
            return rng();
        };
        const crowns = world.pollenCrowns();
        expect(crowns).toBeInstanceOf(Float32Array);
        expect(crowns.length % 3).toBe(0);
        expect(crowns.length).toBeGreaterThan(3 * 8);
        expect(allFinite(crowns)).toBe(true);
        // The same crowns whenever they are asked for, and not one draw from the world's own stream.
        expect(Array.from(world.pollenCrowns())).toEqual(Array.from(crowns));
        expect(draws).toBe(0);
        // The flurry was given them when the world was built.
        expect(Array.from(world.flurry.crowns)).toEqual(Array.from(crowns));
        const trees = world.forest.placements.filter((tree) => !tree.far);
        let seenByTheEye = 0;
        const point = new THREE.Vector3();
        for (let index = 0; index < crowns.length; index += 3) {
            const [x, y, z] = crowns.subarray(index, index + 3);
            // Up in a crown, over land, within a tree's reach of a near conifer's foot.
            expect(y).toBeGreaterThan(goldenForestGroundHeight(x, z) + 3);
            expect(y).toBeLessThan(80);
            const nearest = Math.min(...trees.map((tree) => Math.hypot(tree.x - x, tree.z - z)));
            expect(nearest).toBeLessThan(8);
            const seen = world.stage.project(x, y, z, point);
            const inFrame = seen.z > 0 && seen.x > 0 && seen.x < 1 && seen.y > 0 && seen.y < 1;
            if (inFrame && !world.stage.covered(seen.x, seen.y)) {
                seenByTheEye += 1;
            }
        }
        // Enough of them stand in the frame beside the card for a great clear to be answered there.
        expect(seenByTheEye).toBeGreaterThan(4);
    }, SLOW);
});

describe('the skeins the world calls', () => {
    it('calls one skein each time the director\'s count of flights rises, and none otherwise', () => {
        const { world } = lakeAt('High');
        const call = vi.spyOn(world.birds, 'callSkein');
        const frame = (flights, epoch = 1) => ({ epoch, flights });
        let time = 10;
        const play = (state) => {
            time += STEP;
            world.update(time, STEP, state);
        };
        for (let n = 0; n < 5; n += 1) play(frame(0));
        expect(call).not.toHaveBeenCalled();
        play(frame(1));
        expect(call).toHaveBeenCalledExactlyOnceWith(time);
        const first = world.birds.sky.calling;
        expect(first).not.toBeNull();
        expect(first.start).toBe(time);
        // The count stands: the same skein flies on, nothing is called again.
        for (let n = 0; n < 30; n += 1) play(frame(1));
        expect(call).toHaveBeenCalledOnce();
        // Two at once (a perfect clear on a level-up) are one rise: one call, and the skein crossing is theirs.
        play(frame(3));
        expect(call).toHaveBeenCalledTimes(2);
        expect(world.birds.sky.calling).toBe(first);
        // A count that falls, or is no number, calls nothing; it must rise past the highest seen.
        for (const flights of [2, 0, NaN, undefined, 'three', -4, 3]) play(frame(flights));
        expect(call).toHaveBeenCalledTimes(2);
        play(frame(4));
        expect(call).toHaveBeenCalledTimes(3);
        // The director started over: its count starts over, and its first flight is called.
        play(frame(0, 2));
        expect(call).toHaveBeenCalledTimes(3);
        play(frame(1, 2));
        expect(call).toHaveBeenCalledTimes(4);
        // Forgetting the effects in flight neither replays a call nor loses the count.
        world.resetEffects();
        expect(world.birds.sky.calling).toBeNull();
        play(frame(1, 2));
        expect(call).toHaveBeenCalledTimes(4);
        play(frame(2, 2));
        expect(call).toHaveBeenCalledTimes(5);
        expect(world.birds.sky.calling).not.toBeNull();
    }, SLOW);

    it('draws the called skein beside the clock\'s cranes, with room for every bird', () => {
        for (const quality of ['High', 'Low']) {
            const { world, tier } = lakeAt(quality);
            const { birds } = world;
            const { sky } = birds;
            const room = (tier.birds + sky.sizes.skein) * CRANE_STRIDE;
            for (const draw of birds.draws) expect(draw.data.length).toBe(room);
            // A moment when the clock's own skein is in the sky too.
            const time = SKEIN.period + 12;
            world.update(time - 6, STEP, { epoch: 1, flights: 0 });
            const before = birds.drawnCounts();
            world.update(time - 6 + STEP, STEP, { epoch: 1, flights: 1 });
            world.update(time, STEP, { epoch: 1, flights: 1 });
            const during = birds.drawnCounts();
            expect(during.near + during.far, quality).toBe(sky.kettle.length + sky.skein.length + sky.called.length);
            expect(during.near + during.far).toBeGreaterThan(before.near + before.far);
            for (const draw of birds.draws) {
                expect(draw.geometry.instanceCount).toBeLessThanOrEqual(room / CRANE_STRIDE);
                expect(allFinite(draw.data)).toBe(true);
            }
            // Called by hand, with no time given, it flies from the lake's own clock.
            birds.reset();
            const called = birds.callSkein();
            expect(called.start).toBe(world.light.uTime.value);
            expect(birds.callSkein(NaN)).toBe(sky.calling);
        }
    }, SLOW);

    it('answers a call with nothing where the sky has no birds', () => {
        const { world } = lakeAt('Minimal');
        expect(world.birds.count).toBe(0);
        expect(world.birds.callSkein(5)).toBeNull();
        expect(() => {
            world.update(1, STEP, { epoch: 1, flights: 1 });
            world.update(2, STEP, { epoch: 1, flights: 2 });
        }).not.toThrow();
    }, SLOW);
});

describe('a skein called for the frame it is seen in', () => {
    const FRAMES = [['a tall phone', 9 / 19.5], ['a tablet held upright', 3 / 4], ['4:3', 4 / 3], ['16:10', 16 / 10],
        ['16:9', 16 / 9], ['a phone held sideways', 19.5 / 9], ['21:9', 21 / 9], ['3440 x 1440', 3440 / 1440],
        ['the widest frame composed for', 2.45]];
    const inFrame = (seen) => seen.z > 0 && seen.x >= 0 && seen.x <= 1 && seen.y >= 0 && seen.y <= 1;

    /** Metres a place lies outside the frame's left edge at its own depth (the camera's own edge ray). */
    function outsideLeft(camera, place) {
        const e = camera.matrixWorld.elements;
        const half = Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
        const dx = -e[8] - half * e[0];
        const dz = -e[10] - half * e[2];
        return e[12] + dx * ((place[2] - e[14]) / dz) - place[0];
    }

    /** The lake's cranes behind the camera the world frames for an aspect ratio (no world needed). */
    function birdsFor(aspect) {
        const tier = GOLDEN_FOREST_TIERS.High;
        const light = new GoldenForestLight({ tier, rng: seededRandom(3) });
        const camera = goldenForestCamera(aspect);
        const birds = new GoldenForestBirds({
            light, tier, rng: seededRandom(9), crane: assets.crane, camera,
        }).build();
        worlds.push(birds, light);
        return { birds, camera, stage: new GoldenForestStage(camera) };
    }

    /** Skein after skein called through the birds on a frame: the birds in sight at `when(call)`, as messages. */
    function inSightAt(aspect, name, when, calls = 40) {
        const { birds, stage } = birdsFor(aspect);
        const { sky } = birds;
        const point = new THREE.Vector3();
        const found = [];
        for (let n = 0; n < calls; n += 1) {
            birds.reset();
            const call = birds.callSkein(30 + n * 100);
            const time = when(call);
            const xs = [];
            for (let i = 0; i < sky.called.length; i += 1) {
                const at = sky.calledAt(i, time, [0, 0, 0]);
                const seen = stage.project(at[0], at[1], at[2], point);
                if (inFrame(seen)) xs.push(seen.x);
            }
            if (xs.length) {
                const inside = Math.max(...xs.map((x) => Math.min(x, 1 - x)));
                const share = (inside * 100).toFixed(1);
                found.push(`${name}, call ${n}: ${xs.length} birds, up to ${share} % of the frame in`);
            }
        }
        return found;
    }

    it.each(FRAMES)('knows where the frame\'s edges lie where its lane begins and ends (%s)', (_, aspect) => {
        const { birds, camera, stage } = birdsFor(aspect);
        const edges = birds.frameEdges();
        expect(Object.keys(edges).sort()).toEqual(['left', 'right']);
        expect(edges.left).toBeLessThan(edges.right);
        // Each is where the ray along the frame's edge reaches that depth: a point of it stands on the edge.
        const e = camera.matrixWorld.elements;
        const half = Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
        const onEdge = (side, x, z) => {
            const dz = -e[10] + side * half * e[2];
            const along = (z - e[14]) / dz;
            return stage.project(x, e[13] + (-e[9] + side * half * e[1]) * along, z);
        };
        expect(onEdge(-1, edges.left, CALLED_SKEIN.from[1]).x).toBeCloseTo(0, 6);
        expect(onEdge(1, edges.right, CALLED_SKEIN.to[1]).x).toBeCloseTo(1, 6);
        // No camera to ask: no edges, and the lane for the widest frame is flown.
        birds.camera = null;
        expect(birds.frameEdges()).toBeNull();
        // (That lane begins where CALLED_SKEIN.from says, give or take the few metres each call's
        // own depth moves the widest frame's edge.)
        expect(Math.abs(birds.callSkein(5).lane.fx - CALLED_SKEIN.from[0])).toBeLessThan(14);
    });

    it.each(FRAMES)('starts its leader a pad outside the left edge and is in sight soon after (%s)', (_, aspect) => {
        const { birds, camera, stage } = birdsFor(aspect);
        const { sky } = birds;
        const point = new THREE.Vector3();
        for (let n = 0; n < 8; n += 1) {
            birds.reset();
            const start = 30 + n * 100;
            const call = birds.callSkein(start);
            expect(call.start).toBe(start);
            // The leader a few metres outside the frame's left edge as it lies at the leader's own
            // depth (each call's lane lies a little nearer or further): the pad, give or take its
            // sway. Never much further out than the lane for the widest frame.
            const leader = sky.calledAt(0, start, [0, 0, 0]);
            const outside = outsideLeft(camera, leader);
            expect(outside, `call ${n}`).toBeGreaterThan(0);
            expect(outside, `call ${n}`).toBeLessThan(CALLED_SKEIN.pad + 4);
            expect(call.lane.fx).toBeGreaterThanOrEqual(CALLED_SKEIN.from[0] - 14);
            // Every other bird of the V is further out still.
            for (let i = 1; i < sky.called.length; i += 1) {
                expect(sky.calledAt(i, start, [0, 0, 0])[0], `call ${n} bird ${i}`).toBeLessThan(leader[0]);
            }
            // It comes into the frame within a couple of seconds, not after the widest frame's wait.
            let firstSeen = null;
            for (let time = start + STEP; time < start + 6 && firstSeen === null; time += STEP) {
                for (let i = 0; i < sky.called.length && firstSeen === null; i += 1) {
                    const at = sky.calledAt(i, time, [0, 0, 0]);
                    if (inFrame(stage.project(at[0], at[1], at[2], point))) firstSeen = time - start;
                }
            }
            expect(firstSeen, `call ${n}`).not.toBeNull();
            expect(firstSeen).toBeLessThan(3);
        }
    });

    // Each call's lane lies up to 9 m nearer or further and tilts, and where the frame is wide
    // it widens by more than the pad over those metres; and an echelon's one arm is 48 m long.
    // So the edges are taken at the lane's own depths and the skein stays until its longest arm
    // has left (both were faults of the first version: about one skein in ten was born a little
    // inside a wide frame, and the last birds were taken out of the sky in sight).
    it('is out of sight when it is called, whatever the frame', () => {
        const born = FRAMES.flatMap(([name, aspect]) => inSightAt(aspect, name, (call) => call.start));
        expect(born).toEqual([]);
    });

    it('has flown every bird out by the right edge before it is taken from the sky, whatever the frame', () => {
        const last = (call) => call.start + (call.lane.length + call.trail) / CALLED_SKEIN.speed - STEP;
        const taken = FRAMES.flatMap(([name, aspect]) => inSightAt(aspect, name, last));
        expect(taken).toEqual([]);
    });

    it('arrives sooner in a narrow frame than the lane for the widest frame would bring it', () => {
        const arrival = (aspect, framed) => {
            const { birds, stage } = birdsFor(aspect);
            const { sky } = birds;
            const call = framed ? birds.callSkein(40) : sky.call(40);
            const point = new THREE.Vector3();
            for (let time = 40; time < 60; time += STEP) {
                const at = sky.calledAt(0, time, [0, 0, 0]);
                if (inFrame(stage.project(at[0], at[1], at[2], point))) return { seconds: time - 40, call };
            }
            throw new Error('the leader never came into the frame');
        };
        for (const aspect of [16 / 9, 4 / 3, 9 / 19.5]) {
            const framed = arrival(aspect, true);
            const widest = arrival(aspect, false);
            expect(framed.seconds).toBeLessThan(widest.seconds - 1);
            // A shorter lane, flown at the same pace.
            expect(framed.call.lane.length).toBeLessThan(widest.call.lane.length);
        }
    });

    it('flies the lane of the world\'s own frame, landscape or portrait, and of a frame turned round', () => {
        for (const aspect of [16 / 9, 9 / 19.5]) {
            const { world, camera } = lakeAt('High', { aspect });
            expect(world.birds.camera).toBe(camera);
            const edges = world.birds.frameEdges();
            world.update(10, STEP, { epoch: 1, flights: 0 });
            world.update(10 + STEP, STEP, { epoch: 1, flights: 1 });
            const call = world.birds.sky.calling;
            expect(call).not.toBeNull();
            const leader = world.birds.sky.calledAt(0, call.start, [0, 0, 0]);
            expect(outsideLeft(camera, leader)).toBeGreaterThan(0);
            expect(outsideLeft(camera, leader)).toBeLessThan(CALLED_SKEIN.pad + 4);
            // Drawn within a couple of seconds: the draws hold more birds than the clock's own.
            const before = world.birds.drawnCounts();
            let drawnAt = null;
            for (let frame = 2; frame < 4 / STEP && drawnAt === null; frame += 1) {
                world.update(10 + frame * STEP, STEP, { epoch: 1, flights: 1 });
                const now = world.birds.drawnCounts();
                if (now.near + now.far > before.near + before.far) drawnAt = frame * STEP;
            }
            expect(drawnAt).not.toBeNull();
            // The frame is turned (a phone turned round): the next skein flies the new frame's lane.
            const turned = 1 / aspect;
            camera.aspect = turned;
            camera.updateProjectionMatrix();
            world.prepareCamera(turned);
            world.birds.reset();
            const again = world.birds.callSkein(500);
            const now = world.birds.frameEdges();
            expect(Math.abs(now.left - edges.left)).toBeGreaterThan(5);
            const first = world.birds.sky.calledAt(0, again.start, [0, 0, 0]);
            expect(outsideLeft(camera, first)).toBeGreaterThan(0);
            expect(outsideLeft(camera, first)).toBeLessThan(CALLED_SKEIN.pad + 4);
        }
    }, SLOW);
});

describe('what the world throws into the air', () => {
    it('throws the director\'s bursts where the board stands, once each, and tells of them', () => {
        const { world } = lakeAt('High');
        const reactions = director('High');
        const rings = vi.spyOn(world.lake.ripples, 'add');
        expect(world.flurry.group.parent).toBe(world.group);
        expect(world.flurry.light).toBe(world.light);
        world.flurry.group.traverse((object) => expect(object.layers.isEnabled(GOLDEN_FOREST_MIRROR_LAYER)).toBe(true));
        let time = 3;
        const play = () => {
            time += STEP;
            world.update(time, STEP, reactions.update(STEP));
        };
        play();
        expect(world.getDiagnostics().flurry).toEqual({
            particles: 0, clouds: 0, thrown: 0, refused: 0, breathed: 0,
        });
        // A hard drop strikes the lake: drops, and a ring where it was struck (beside the lock's own).
        reactions.onHardDrop({ distance: 18 });
        reactions.onPieceLock({ piece: cell(8, 20) });
        play();
        const drops = world.flurry.counts();
        expect(drops.thrown).toBeGreaterThan(8);
        expect(drops.particles).toBe(drops.thrown);
        expect(rings.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(world.flurry.time).toBe(time);
        // Frame after frame of the same queue: thrown once.
        for (let n = 0; n < 10; n += 1) play();
        expect(world.flurry.counts().thrown).toBe(drops.thrown);
        // Four lines and a perfect clear: pollen off the crowns in sight, gold through the air.
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        reactions.onPerfectClear();
        reactions.onTwist({ piece: cell(1, 20) });
        play();
        const crowned = world.flurry.counts();
        expect(crowned.thrown).toBeGreaterThan(drops.thrown + 100);
        expect(crowned.clouds).toBeGreaterThan(0);
        expect(crowned.clouds).toBeLessThanOrEqual(world.tier.puffs);
        expect(crowned.breathed).toBe(crowned.clouds);
        expect(world.getDiagnostics().flurry).toEqual(crowned);
        expect(allFinite(world.flurry.ring.data) && allFinite(world.flurry.puffs.data)).toBe(true);
        // In flight for a few seconds, then spent: nothing is left in the air a quarter of a minute on.
        for (let n = 0; n < 15 / STEP; n += 1) play();
        expect(world.flurry.counts()).toMatchObject({ particles: 0, clouds: 0, thrown: crowned.thrown });
        // A new session forgets what is in flight and starts its serials over.
        reactions.onTwist({ piece: cell(8, 20) });
        play();
        expect(world.flurry.counts().particles).toBeGreaterThan(0);
        reactions.reset();
        world.resetEffects();
        expect(world.flurry.counts()).toMatchObject({ particles: 0, clouds: 0 });
        const before = world.flurry.counts().thrown;
        reactions.onTwist({ piece: cell(8, 20) });
        play();
        expect(world.flurry.counts().thrown).toBeGreaterThan(before);
    }, SLOW);

    it('answers on the tiers without the clouds too, and is released with the world', () => {
        const { world } = lakeAt('Minimal');
        const reactions = director('Minimal');
        reactions.onHardDrop({ distance: 18 });
        reactions.onPieceLock({ piece: cell(1, 20) });
        reactions.onLineClear(4);
        reactions.onPerfectClear();
        reactions.onTwist({ piece: cell(8, 20) });
        world.update(1, STEP, reactions.update(STEP));
        const counts = world.flurry.counts();
        expect(counts.thrown).toBeGreaterThan(20);
        expect(counts.refused).toBe(0);
        expect(counts.clouds).toBe(0);
        expect(counts.particles).toBeLessThanOrEqual(world.tier.flurry);
        const { flurry } = world;
        const released = [flurry.mesh.geometry, flurry.mesh.material].map((resource) => vi.spyOn(resource, 'dispose'));
        world.dispose();
        released.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(world.flurry).toBeNull();
        expect(world.getDiagnostics().flurry).toBeNull();
    }, SLOW);
});

describe('a minute of mixed play', () => {
    /** Sixty seconds of a session at 60 fps: every event, a game over, and playing again. */
    function session(quality) {
        const built = lakeAt(quality);
        const { world } = built;
        const post = lensFor(built, quality);
        const reactions = director(quality, 17);
        const called = vi.spyOn(world.birds, 'callSkein');
        const meshes = [];
        world.group.traverse((object) => { if (object.isMesh) meshes.push(object); });
        const bad = new Set();
        const seen = {
            beams: 0,
            waves: 0,
            swirls: 0,
            roads: 0,
            particles: 0,
            clouds: 0,
            dusk: 0,
            gild: 0,
            rush: 0,
            burst: 0,
            rocked: 0,
            kinds: new Set(),
        };
        const GAME_OVER = 44;
        const AGAIN = 50;
        const playing = (second) => second < GAME_OVER || second >= AGAIN;
        let time = 0;
        let duskAtRestart = 0;
        for (let frame = 0; frame < 60 * 60; frame += 1) {
            const second = frame / 60;
            if (playing(second)) {
                // A piece every half second: now set down, now dropped hard from high or low.
                if (frame % 30 === 0) {
                    if (frame % 60 === 0) reactions.onHardDrop({ distance: 4 + (frame % 17) });
                    reactions.onPieceLock({ piece: cell((frame / 30) % 10, 12 + ((frame / 30) % 10)) });
                }
                // Clears of one to four lines; every so often a cascade climbing to a combo of twelve.
                if (frame % 90 === 45) {
                    reactions.onLineClear(1 + (Math.floor(frame / 90) % 4), { clearedRows: [22, 23] });
                }
                if (frame >= 600 && frame < 600 + 12 * 22 && (frame - 600) % 22 === 0) {
                    const wave = (frame - 600) / 22 + 1;
                    if (wave > 1) reactions.onCombo(wave);
                    reactions.onLineClear({ lineCount: 1 + (wave % 3), clearedRows: [23], cascadeCount: wave });
                }
                if (frame % 240 === 100) {
                    const withLines = frame % 480 === 100;
                    reactions.onTwist({ piece: cell(withLines ? 1 : 8, 14), lineCount: withLines ? 2 : 0 });
                }
                if (frame % 200 === 150) reactions.onBackToBack();
                if (frame === 900 || frame === 2400) reactions.onPerfectClear();
                if (frame === 1500 || frame === 2000 || frame === 3300) reactions.onLevelUp();
            }
            if (frame === GAME_OVER * 60) reactions.onGameOver();
            if (frame === AGAIN * 60) duskAtRestart = reactions.dusk;
            time += STEP;
            const state = reactions.update(STEP);
            world.update(time, STEP, state);
            post.update({ ...state, time });
            for (const [label, owner] of [['light.', world.light], ['lake.', world.lake], ['lens.', post],
                ['birds.', world.birds], ['ribbons.', world.ribbons]]) {
                nonFiniteUniforms(owner, label).forEach((entry) => bad.add(entry));
            }
            const { lake, flurry } = world;
            const rows = [...lake.waveRows, ...lake.swirlRows, ...post.beamRows, ...lake.ripples.rings];
            if (!rows.every((row) => row.toArray().every(Number.isFinite))) bad.add('a row of the lake or the lens');
            if (!world.shore.boat.matrix.elements.every(Number.isFinite)) bad.add('the boat');
            if (frame % 20 === 0) {
                if (!allFinite(flurry.ring.data) || (flurry.puffs && !allFinite(flurry.puffs.data))) {
                    bad.add('a flurry buffer');
                }
                if (!world.birds.draws.every((draw) => allFinite(draw.data))) bad.add('a crane');
                const { sim } = world.sparks;
                if (!allFinite(sim.outPlace) || !allFinite(sim.outGlow) || !allFinite(sim.outVelocity)) {
                    bad.add('a firefly');
                }
            }
            const counts = flurry.counts();
            seen.beams = Math.max(seen.beams, post.uBeamCount.value);
            seen.waves = Math.max(seen.waves, lake.uWaveCount.value);
            seen.swirls = Math.max(seen.swirls, lake.uSwirlCount.value);
            seen.roads = Math.max(seen.roads, lake.uRoad.value.y > 0 ? 1 : 0);
            seen.particles = Math.max(seen.particles, counts.particles);
            seen.clouds = Math.max(seen.clouds, counts.clouds);
            seen.dusk = Math.max(seen.dusk, world.light.uDusk.value);
            seen.gild = Math.max(seen.gild, world.light.uGild.value.y);
            seen.rush = Math.max(seen.rush, world.worn.rush);
            seen.burst = Math.max(seen.burst, post.uBurst.value);
            seen.rocked = Math.max(seen.rocked, world.shore.rocked);
            state.flurries.forEach((flurry2) => { if (flurry2.serial >= 0) seen.kinds.add(flurry2.kind); });
            if (post.uBeamCount.value > GOLDEN_FOREST_BEAM_SLOTS) bad.add('more shafts than slots');
            if (counts.particles > world.tier.flurry || counts.clouds > world.tier.puffs) {
                bad.add('more in flight than the rings hold');
            }
        }
        return {
            ...built, post, reactions, called, meshes, bad, seen, time, duskAtRestart,
        };
    }

    it.each(['High', 'Minimal'])('keeps every uniform and buffer of the %s lake finite, makes nothing', (quality) => {
        const {
            world, post, reactions, called, meshes, bad, seen, time, duskAtRestart, tier,
        } = session(quality);
        expect([...bad]).toEqual([]);
        // The session really happened: every one of the events' own shapes was seen.
        expect(seen.beams).toBeGreaterThanOrEqual(3);
        expect(seen.waves).toBeGreaterThanOrEqual(1);
        expect(seen.swirls).toBeGreaterThanOrEqual(1);
        expect(seen.roads).toBe(1);
        expect(seen.burst).toBeGreaterThan(0.5);
        expect(seen.gild).toBeGreaterThan(0.5);
        expect(seen.rush).toBeGreaterThan(0.5);
        expect(seen.rocked).toBeGreaterThan(0);
        expect([...seen.kinds].sort()).toEqual(['droplets', 'goldfall', 'helix', 'pollen']);
        expect(seen.particles).toBeGreaterThan(50);
        if (tier.puffs > 0) expect(seen.clouds).toBeGreaterThan(0);
        // Hardly anything had to be let go, and what was thrown was thrown into a ring with room.
        const flurry = world.flurry.counts();
        expect(flurry.thrown).toBeGreaterThan(500);
        expect(flurry.refused).toBeLessThan(flurry.thrown * 0.02);
        // The skeins were called (five flights), by the clock the world keeps.
        expect(reactions.flights).toBe(5);
        expect(called).toHaveBeenCalledTimes(5);
        for (const [when] of called.mock.calls) expect(when).toBeLessThanOrEqual(time);
        // The evening came after the game, and went when play began again.
        expect(seen.dusk).toBeGreaterThan(0.5);
        expect(duskAtRestart).toBeGreaterThan(0.5);
        expect(reactions.dusk).toBe(0);
        expect(world.light.uDusk.value).toBe(0);
        // The cloud's clock ran on all the while, never backward.
        const slowest = Math.min(...GOLDEN_FOREST_AIRS.map((air) => air.drift));
        expect(world.light.uCloudClock.value).toBeGreaterThanOrEqual(time * slowest - 1e-6);
        // Not a mesh, a geometry or a material was made for any of it.
        const now = [];
        world.group.traverse((object) => { if (object.isMesh) now.push(object); });
        expect(now).toHaveLength(meshes.length);
        now.forEach((mesh, index) => expect(mesh).toBe(meshes[index]));
        expect(post.getDiagnostics().beams).toBe(post.uBeamCount.value);
        // And the lake at rest afterwards is the lake at rest: the marks run out, the air clears.
        for (let frame = 0; frame < 30 * 60; frame += 1) {
            world.update(time + frame * STEP, STEP, reactions.update(STEP));
        }
        expect(world.lake.uWaveCount.value).toBe(0);
        expect(world.lake.uSwirlCount.value).toBe(0);
        expect(world.lake.uRoad.value.toArray()).toEqual([0, 0, 0, 0]);
        expect(world.flurry.counts()).toMatchObject({ particles: 0, clouds: 0 });
        expect(reactions.getFrame().beams).toEqual([]);
        for (const key of ['rush', 'gild', 'dusk']) expect(world.worn[key], key).toBeLessThan(0.01);
    }, SLOW);

    it('lets the dusk come and go with no play at all, as it does behind the menus', () => {
        const { world } = lakeAt('Minimal');
        const reactions = director('Minimal');
        reactions.onGameOver();
        let time = 0;
        let deepest = 0;
        let last = 0;
        for (let frame = 0; frame < (GOLDEN_FOREST_DUSK.hold + 15 / GOLDEN_FOREST_DUSK.dawn) / STEP; frame += 1) {
            time += STEP;
            world.update(time, STEP, reactions.update(STEP));
            const dusk = world.light.uDusk.value;
            expect(Math.abs(dusk - last)).toBeLessThan(0.05);
            deepest = Math.max(deepest, dusk);
            last = dusk;
        }
        expect(deepest).toBeGreaterThan(0.5);
        expect(last).toBe(0);
        expect(nonFiniteUniforms(world.light)).toEqual([]);
    }, SLOW);
});

describe('the lake\'s own far ranges', () => {
    it('stand with a col where the sun rests and its disc clear of the rock, in the lake the theme builds', () => {
        const { world } = lakeAt('Minimal');
        const R = GOLDEN_FOREST_RANGES;
        const seed = world.backdrop.rangeSeed;
        expect(Number.isInteger(seed) && seed > 0).toBe(true);
        const { height } = createGoldenForestRanges(seed);
        const eye = world.camera.position;
        const skyline = (bearing) => {
            let best = -Infinity;
            for (let z = R.maxZ; z >= R.minZ; z -= 4) {
                const x = Math.tan(bearing * DEG) * (R.eyeZ - z);
                best = Math.max(best, Math.atan2(height(x, z) - eye.y, Math.hypot(x - eye.x, z - eye.z)) / DEG);
            }
            return best;
        };
        const col = skyline(R.sunAzimuth);
        const left = Math.max(skyline(R.sunAzimuth - 9), skyline(R.sunAzimuth - 13));
        const right = Math.max(skyline(R.sunAzimuth + 9), skyline(R.sunAzimuth + 13));
        expect(col).toBeLessThan(left);
        expect(col).toBeLessThan(right);
        expect(col).toBeLessThan(Math.asin(GOLDEN_FOREST_SUN_DIRECTION.y) / DEG);
        // The mesh is that ground: every post stands at the function's height (a little under the lake).
        const position = world.backdrop.ranges.geometry.getAttribute('position');
        let worst = 0;
        for (let index = 0; index < position.count; index += 97) {
            const wanted = height(position.getX(index), position.getZ(index));
            worst = Math.max(worst, Math.abs(position.getY(index) - wanted + 6));
        }
        expect(worst).toBeLessThan(1e-3);
        // Mountains stand in the frame on both sides of the board, and the right shore has the summit.
        const bearing = Math.atan2(R.summit.x, R.eyeZ - R.summit.z) / DEG;
        const over = Math.max(skyline(bearing - 8), skyline(bearing - 4), skyline(bearing), skyline(bearing + 4));
        expect(over).toBeGreaterThan(left);
        expect(over).toBeGreaterThan(right);
    }, SLOW);
});

describe('the living lake\'s shaders', () => {
    // No device, no shadow map drawn: the builders only have to turn each graph into a program.
    function deviceless() {
        const renderer = stubRenderer();
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.hasCompatibility = () => true;
        renderer.getCanvasTarget = () => null;
        // (The lake's mirror asks how large the drawing buffer is.)
        renderer.getDrawingBufferSize = (target) => target.set(1280, 720);
        return renderer;
    }
    const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
    // What the visual pass made or changed: the flurry and its clouds, the sky, the ranges and the two
    // ridges, the smoke and the mist, the water with its tracks, and what a combo gilds or an air moves.
    const PARTS = ['Flurry', 'PollenClouds', 'Sky', 'Ranges', 'Ridges', 'WaterSmoke \\d', 'MistBank \\d', 'Water',
        'Fireflies', 'SunMotes', 'ReedsAndGrass', 'FarShore', 'Birds', 'BirdsFar'];
    const TOUCHED = new RegExp(`^GoldenForest(${PARTS.join('|')})$`);

    function problems(mesh, renderer) {
        const found = [];
        for (const [name, Builder] of BACKENDS) {
            const out = build(Builder, mesh, renderer);
            const label = `${mesh.name} ${name}`;
            if (out.thrown) {
                found.push(`${label}: ${String(out.thrown.message).slice(0, 160)}`);
                continue;
            }
            out.heard.forEach((line) => found.push(`${label} said: ${line}`));
            for (const stage of ['vertex', 'fragment']) {
                const text = out[stage];
                if (!(text.length > 200)) found.push(`${label} ${stage}: no program`);
                if (/\bNaN\b|\bInfinity\b|\binf\b|\[object |undefined/.test(text)) {
                    found.push(`${label} ${stage}: a bad literal`);
                }
                if (name === 'WGSL') {
                    unassignedReads(text).forEach((read) => found.push(`${label} ${stage}: unassigned ${read}`));
                }
            }
        }
        return found;
    }

    it.each(BUILT)('build to WGSL and GLSL at %s, quietly, with no NaN and no unset variable', (quality) => {
        const { world } = lakeAt(quality);
        const renderer = deviceless();
        const meshes = [];
        world.group.traverse((object) => { if (object.isMesh && TOUCHED.test(object.name)) meshes.push(object); });
        const names = new Set(meshes.map((mesh) => mesh.name.replace(/ \d$/, '')));
        // Everything the pass touched is there to be built.
        for (const wanted of ['GoldenForestFlurry', 'GoldenForestSky', 'GoldenForestRanges', 'GoldenForestRidges',
            'GoldenForestMistBank', 'GoldenForestWater', 'GoldenForestFireflies', 'GoldenForestReedsAndGrass',
            'GoldenForestFarShore']) {
            expect(names.has(wanted), wanted).toBe(true);
        }
        expect(names.has('GoldenForestPollenClouds')).toBe(world.tier.puffs > 0);
        expect(names.has('GoldenForestWaterSmoke')).toBe(world.tier.smoke > 0);
        const built = new Set();
        const found = [];
        for (const mesh of meshes) {
            if (built.has(mesh.material)) continue;
            built.add(mesh.material);
            found.push(...problems(mesh, renderer));
        }
        expect(found).toEqual([]);
        expect(built.size).toBeGreaterThanOrEqual(9);
    }, SLOW);

    it('build the sky dome with and without its ceiling of cloud drawn finely, the same on both backends', () => {
        // (The ceiling is read inside a branch the air's uniform opens: the trap for a variable first
        // set in one arm of an If.)
        for (const quality of ['High', 'Minimal']) {
            const { world } = lakeAt(quality);
            for (const deck of [0, 0.9]) {
                world.light.uDeck.value = deck;
                expect(problems(world.atmosphere.sky, deviceless()), `${quality} deck ${deck}`).toEqual([]);
            }
        }
    }, SLOW);

    it('build the fan of the lens: the rays at rest, the shafts read to their count, the sunburst', () => {
        const built = lakeAt('High');
        const post = lensFor(built, 'High');
        expect(post.getDiagnostics()).toMatchObject({ godrays: true, rays: true });
        const fan = post.fan(built.world.light);
        expect(fan.isNode).toBe(true);
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'GoldenForestFan';
        material.colorNode = fan;
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        quad.name = 'GoldenForestFan';
        expect(problems(quad, deviceless())).toEqual([]);
        // With every slot of the fan open, and with none.
        for (const count of [0, GOLDEN_FOREST_BEAM_SLOTS]) {
            post.update({
                beams: Array.from({ length: count }, (_, index) => ({
                    serial: index, angle: index, sharp: 250, strength: 0.8,
                })),
                burst: count ? 1 : 0,
            });
            expect(post.uBeamCount.value).toBe(count);
            expect(problems(quad, deviceless())).toEqual([]);
        }
        quad.geometry.dispose();
        material.dispose();
    }, SLOW);
});
