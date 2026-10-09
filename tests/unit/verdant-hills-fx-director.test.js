import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    verdantHillsEye, verdantHillsTarget, verdantHillsViewFor,
} from '../../src/themes/verdant-hills/verdant-hills-composition.js';
import { VerdantHillsFxDirector } from '../../src/themes/verdant-hills/verdant-hills-fx-director.js';
import { VERDANT_HILLS_WIND_DIRECTION, VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    VERDANT_HILLS_MIXED, VerdantHillsReactions,
} from '../../src/themes/verdant-hills/verdant-hills-reactions.js';
import { VerdantHillsRibbons } from '../../src/themes/verdant-hills/verdant-hills-ribbons.js';
import { VerdantHillsRings } from '../../src/themes/verdant-hills/verdant-hills-rings.js';
import {
    VERDANT_HILLS_PARTICLES, VERDANT_HILLS_TINTS, VerdantHillsSeedSim,
} from '../../src/themes/verdant-hills/verdant-hills-seed-sim.js';
import { VERDANT_HILLS_CHAFF } from '../../src/themes/verdant-hills/verdant-hills-seeds.js';
import {
    VERDANT_HILLS_STAGE_DEPTH, VerdantHillsStage,
} from '../../src/themes/verdant-hills/verdant-hills-stage.js';
import {
    VERDANT_HILLS_MAP_BOUNDS, VERDANT_HILLS_PLACES, verdantHillsGroundHeight,
} from '../../src/themes/verdant-hills/verdant-hills-terrain.js';
import {
    VERDANT_HILLS_KITE_COLOURS, VERDANT_HILLS_PIECE_KITES,
} from '../../src/themes/verdant-hills/verdant-hills-tetrominos.js';

// Seed is flown on the real hills, frame by frame: seconds of it, and many times that on a busy machine.
vi.setConfig({ testTimeout: 120000 });

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;
const TIERS = Object.keys(VERDANT_HILLS_TIERS);
const LETTERS = Object.keys(VERDANT_HILLS_PIECE_KITES);
const { chaff: CHAFF, seed: SEED, pollen: POLLEN } = VERDANT_HILLS_PARTICLES;
const KITE_TONES = VERDANT_HILLS_KITE_COLOURS.map((hex) => new THREE.Color(hex));
const ground = verdantHillsGroundHeight;
/** The wind as the light rig hands it to the director. */
const WIND = Object.freeze({
    x: VERDANT_HILLS_WIND_DIRECTION.x, z: VERDANT_HILLS_WIND_DIRECTION.z, strength: 0.34,
});
const WINDWARD = new THREE.Vector3(WIND.x, 0, WIND.z).normalize();
/** The oak's crown, as VerdantHillsWorld describes it to the director. */
const OAK_CROWN = Object.freeze({
    x: VERDANT_HILLS_PLACES.oak.x + 1.5,
    y: ground(VERDANT_HILLS_PLACES.oak.x, VERDANT_HILLS_PLACES.oak.z) + 9.5,
    z: VERDANT_HILLS_PLACES.oak.z,
    radius: 8,
});
function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** The camera exactly as VerdantHillsWorld.prepareCamera() frames it for an aspect ratio. */
function frameCamera(aspect = LANDSCAPE) {
    const view = verdantHillsViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.25, 30000);
    camera.position.set(...verdantHillsEye(view));
    camera.lookAt(...verdantHillsTarget(view));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

/** One filled cell of a piece at board column `x`, row `y` (rows 4..23 are visible, 23 the floor). */
function piece(letter, x = 4, y = 20) {
    return {
        x, y, shape: [[1]], shapeKey: letter,
    };
}

/**
 * The director with everything it drives: a real stage on the framed camera, the real seed
 * simulation on the real hills, a real pool of ribbons and of gusts, and the reactions that feed it.
 */
function rig({
    quality = 'High', aspect = LANDSCAPE, seed = 271, oak = OAK_CROWN, groundHeight = ground, idle = false,
    rng = seededRandom(seed),
} = {}) {
    const tier = VERDANT_HILLS_TIERS[quality];
    const camera = frameCamera(aspect);
    const stage = new VerdantHillsStage(camera);
    const sim = new VerdantHillsSeedSim({
        count: tier.seeds, reserve: Math.round(tier.seeds * 0.86), rng: seededRandom(seed + 1), groundHeight,
    });
    const ribbons = new VerdantHillsRibbons({ light: null, tier });
    const waves = new VerdantHillsRings(tier.waves, 4.4);
    const director = new VerdantHillsFxDirector({
        stage, sim, ribbons, waves, tier, rng, groundHeight, oak,
    });
    // The breeze's own ribbons come when they please: off, unless a test is about them.
    if (!idle) director.idleClock = Infinity;
    const reactions = new VerdantHillsReactions({ quality, rng: seededRandom(seed + 2) });
    const launched = [];
    const launch = ribbons.launch.bind(ribbons);
    vi.spyOn(ribbons, 'launch').mockImplementation((options) => {
        const slot = launch(options);
        launched.push({
            ...options,
            slot,
            origin: options.origin.clone(),
            heading: options.heading.clone().normalize(),
            axis: options.axis ? options.axis.clone() : null,
            colour: options.colour ? options.colour.clone() : null,
        });
        return slot;
    });
    const spawn = vi.spyOn(sim, 'spawn');
    const blown = vi.spyOn(waves, 'add');
    const built = {
        tier, camera, stage, sim, ribbons, waves, director, reactions, launched, spawn, blown,
    };
    /** Everything thrown into the air so far, as { x, y, z, vx, vy, vz, kind, tint, ... }. */
    built.thrown = (from = 0) => spawn.mock.calls.slice(from).map(([x, y, z, vx, vy, vz, options = {}]) => ({
        x, y, z, vx, vy, vz, ...options,
    }));
    /** One frame of the world: reactions, director, ribbons, gusts, seed. Returns the environment. */
    built.frame = (dt = STEP) => {
        const state = reactions.update(dt);
        const env = director.apply(state, dt, WIND);
        ribbons.update(dt);
        waves.update(dt);
        sim.step(dt, env);
        return env;
    };
    built.run = (seconds, each) => {
        const frames = Math.max(1, Math.round(seconds / STEP));
        for (let frame = 0; frame < frames; frame++) {
            const env = built.frame();
            each?.(env, frame);
        }
    };
    return built;
}

/** Where a world point falls on the screen: fractions, y down, as the board card is measured. */
function onScreen(camera, point) {
    const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
    return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2, ahead: projected.z < 1 };
}

/** How far in front of the lens a point is, along its line of sight. */
const depthOf = (stage, point) => new THREE.Vector3(point.x, point.y, point.z).sub(stage.origin).dot(stage.forward);
const clearanceOf = (point) => point.y - ground(point.x, point.z);
const sameColour = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) < 1e-9;
const isKiteColour = (colour) => KITE_TONES.some((tone) => sameColour(tone, colour));
const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => sum(values) / values.length;
/** The seed and chaff in the air, by index. */
function aloft(sim) {
    const result = [];
    for (let index = sim.ambient; index < sim.count; index++) if (sim.life[index] > 0) result.push(index);
    return result;
}

/** A frame as the reactions would give it, with nothing happening in it. */
function quiet(rest = {}) {
    return {
        epoch: 1,
        gust: 0,
        glow: 0,
        heat: 0,
        whirl: 0,
        streamers: 0,
        settled: false,
        front: null,
        sunbreak: null,
        waves: [],
        streaks: [],
        emitters: [],
        ...rest,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Verdant Hills effects director', () => {
    describe('gusts through the grass', () => {
        it('starts each gust the reactions ask for exactly once, in the grass at the foot of the board', () => {
            const {
                director, reactions, stage, camera, blown, waves, frame,
            } = rig();
            reactions.onPieceLock({ piece: piece('I', 2, 22) });
            const state = reactions.update(STEP);
            const [asked] = state.waves.filter((wave) => wave.serial >= 0);
            director.apply(state, STEP, WIND);
            expect(blown).toHaveBeenCalledOnce();
            const [x, z, strength] = blown.mock.calls[0];
            expect(strength).toBe(asked.strength);
            expect(waves.active()).toBe(1);
            // On the ground just under the card's foot, below the column the piece came down in.
            const at = onScreen(camera, { x, y: ground(x, z), z });
            expect(at.ahead).toBe(true);
            expect(at.x).toBeCloseTo(stage.screen(asked.column, 0).x, 2);
            expect(at.y).toBeGreaterThan(stage.board.y1);
            expect(at.y).toBeLessThan(1);
            // Close enough for the ring to be seen spreading through the grass in front of the lens.
            expect(Math.hypot(x - stage.origin.x, z - stage.origin.z)).toBeLessThan(12);
            // The gust stays in the queue for as long as nothing replaces it: never started again.
            for (let count = 0; count < 120; count++) frame();
            expect(blown).toHaveBeenCalledOnce();
            // A second lock adds exactly one more, further right for a piece further right.
            reactions.onPieceLock({ piece: piece('O', 8, 22) });
            frame();
            frame();
            expect(blown).toHaveBeenCalledTimes(2);
            expect(blown.mock.calls[1][0]).toBeGreaterThan(x);
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('finds grass for a gust under every column of the board in %s', (_label, aspect) => {
            const {
                director, reactions, stage, blown,
            } = rig({ aspect });
            for (let column = 0; column < 10; column++) {
                reactions.onPieceLock({ piece: piece('T', column, 23 - (column % 5) * 4) });
                director.apply(reactions.update(STEP), STEP, WIND);
                const [x, z] = blown.mock.calls.at(-1);
                expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
                // In front of the lens, on the hill it stands on: never out over the valley.
                expect(new THREE.Vector3(x, ground(x, z), z).sub(stage.origin).dot(stage.forward)).toBeGreaterThan(0.5);
                expect(Math.hypot(x - stage.origin.x, z - stage.origin.z)).toBeLessThan(15);
            }
            const xs = blown.mock.calls.map(([x]) => x);
            for (let column = 1; column < 10; column++) expect(xs[column]).toBeGreaterThan(xs[column - 1]);
        });

        it('plays a full queue of gusts asked for in one frame, each once and oldest first', () => {
            const { director, reactions, blown } = rig();
            const asked = Array.from({ length: 8 }, (_, index) => ({
                column: index / 7, strength: 0.5 + index * 0.25,
            }));
            asked.forEach(({ column, strength }) => reactions.gust(column, strength));
            director.apply(reactions.update(STEP), STEP, WIND);
            expect(blown.mock.calls.map(([, , strength]) => strength)).toEqual(asked.map(({ strength }) => strength));
            // Left to right, as they were asked for.
            const xs = blown.mock.calls.map(([x]) => x);
            for (let index = 1; index < xs.length; index++) expect(xs[index]).toBeGreaterThan(xs[index - 1]);
            director.apply(reactions.update(STEP), STEP, WIND);
            expect(blown).toHaveBeenCalledTimes(8);
            // The queue is a ring: three more reuse the three oldest slots, and only those three play.
            [1.1, 1.2, 1.3].forEach((strength) => reactions.gust(0.5, strength));
            director.apply(reactions.update(STEP), STEP, WIND);
            expect(blown.mock.calls.slice(8).map(([, , strength]) => strength)).toEqual([1.1, 1.2, 1.3]);
        });

        it('starts the gust of every kind of event that lands in one frame', () => {
            const { director, reactions, blown } = rig();
            // A lock that sets off the festival, a t-spin, a clear, a combo, a perfect clear and a level-up.
            LETTERS.slice(0, 6).forEach((letter) => reactions.launch(VERDANT_HILLS_PIECE_KITES[letter]));
            reactions.onPieceLock({ piece: piece(LETTERS[6], 3, 22) });
            reactions.onTSpin({ piece: piece('T', 3, 22) });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(3);
            reactions.onPerfectClear();
            reactions.onLevelUp();
            const state = reactions.update(STEP);
            const asked = state.waves.filter((wave) => wave.serial >= 0).sort((a, b) => a.serial - b.serial);
            expect(asked.length).toBeGreaterThanOrEqual(6);
            director.apply(state, STEP, WIND);
            expect(blown.mock.calls.map(([, , strength]) => strength)).toEqual(asked.map((wave) => wave.strength));
            for (let count = 0; count < 30; count++) director.apply(reactions.update(STEP), STEP, WIND);
            expect(blown).toHaveBeenCalledTimes(asked.length);
        });

        it('starts no gust of no strength, and none when the world has no grass to carry one', () => {
            const built = rig();
            built.director.apply(quiet({
                waves: [{ serial: 0, column: 0.5, strength: 0 }, { serial: 1, column: 0.5, strength: -1 },
                    { serial: 2, column: 0.5, strength: NaN }],
            }), STEP, WIND);
            expect(built.blown).not.toHaveBeenCalled();
            // They count as played all the same.
            built.director.apply(quiet({ waves: [{ serial: 2, column: 0.5, strength: 1 }] }), STEP, WIND);
            expect(built.blown).not.toHaveBeenCalled();
            built.director.apply(quiet({ waves: [{ serial: 3, column: 0.5, strength: 1 }] }), STEP, WIND);
            expect(built.blown).toHaveBeenCalledOnce();
            const bare = rig();
            bare.director.waves = null;
            bare.reactions.onPieceLock({ piece: piece('L') });
            expect(() => bare.director.apply(bare.reactions.update(STEP), STEP, WIND)).not.toThrow();
        });
    });

    describe('a lock', () => {
        it.each(LETTERS.flatMap((letter) => [[letter, 'left', 1], [letter, 'right', 8]]))(
            'draws one ribbon in the colour of the %s kite away from the %s edge of the board',
            (letter, _side, column) => {
                const {
                    director, reactions, stage, camera, launched, ribbons,
                } = rig();
                const side = column < 5 ? -1 : 1;
                reactions.onPieceLock({ piece: piece(letter, column, 10) });
                director.apply(reactions.update(STEP), STEP, WIND);
                expect(launched).toHaveLength(1);
                expect(ribbons.active()).toBe(1);
                const [ribbon] = launched;
                expect(sameColour(ribbon.colour, KITE_TONES[VERDANT_HILLS_PIECE_KITES[letter]])).toBe(true);
                // It starts just behind the card's edge on the piece's own side ...
                const at = onScreen(camera, ribbon.origin);
                const edge = side < 0 ? stage.board.x0 : stage.board.x1;
                expect(at.ahead).toBe(true);
                expect(Math.abs(at.x - edge)).toBeLessThan(0.03);
                expect(at.x).toBeGreaterThan(stage.board.x0);
                expect(at.x).toBeLessThan(stage.board.x1);
                // ... at the depth the stage stands at, clear of the grass ...
                expect(depthOf(stage, ribbon.origin)).toBeCloseTo(VERDANT_HILLS_STAGE_DEPTH, 0);
                expect(clearanceOf(ribbon.origin)).toBeGreaterThan(0.4);
                // ... and runs out from the board, a little up and off down the wind.
                expect(ribbon.heading.dot(stage.right) * side).toBeGreaterThan(0.5);
                expect(ribbon.heading.y).toBeGreaterThan(0);
                expect(ribbon.heading.dot(WINDWARD) * 1).toBeGreaterThan(side > 0 ? 0.3 : -0.9);
                for (const name of ['length', 'speed', 'life', 'width', 'strength']) {
                    expect(ribbon[name], name).toBeGreaterThan(0);
                }
                expect(ribbon.strength).toBeLessThanOrEqual(1);
            },
        );

        it('starts the ribbon beside the piece wherever the hill leaves room for it', () => {
            const rows = [];
            for (const y of [23, 21, 19, 17, 15, 12, 9, 6, 4]) {
                const {
                    director, reactions, stage, camera, launched,
                } = rig();
                reactions.onPieceLock({ piece: piece('S', 1, y) });
                const state = reactions.update(STEP);
                const asked = state.streaks.find((streak) => streak.serial === 0);
                director.apply(state, STEP, WIND);
                const at = onScreen(camera, launched[0].origin);
                const wanted = stage.screen(asked.column, asked.row).y;
                rows.push({ wanted, drawn: at.y, clearance: clearanceOf(launched[0].origin) });
                // Never under the grass, never lower on the screen than the piece.
                expect(clearanceOf(launched[0].origin)).toBeGreaterThan(0.4);
                expect(at.y).toBeLessThanOrEqual(wanted + 1e-6);
                // Where that height is in the open air it is the height of the piece exactly.
                if (clearanceOf(launched[0].origin) > 0.6) expect(at.y).toBeCloseTo(wanted, 6);
            }
            // The upper half of the board is all open air.
            expect(rows.filter((row) => Math.abs(row.drawn - row.wanted) < 1e-6).length).toBeGreaterThanOrEqual(5);
            // Higher pieces, higher ribbons; none above the top of the card.
            for (let index = 1; index < rows.length; index++) {
                expect(rows[index].drawn).toBeLessThanOrEqual(rows[index - 1].drawn);
            }
        });

        it('makes a harder drop a longer, faster, stronger ribbon', () => {
            const drawn = (distance) => {
                const { director, reactions, launched } = rig();
                if (distance) reactions.onHardDrop({ distance });
                reactions.onPieceLock({ piece: piece('J', 2, 12) });
                director.apply(reactions.update(STEP), STEP, WIND);
                return launched[0];
            };
            const [soft, hard] = [drawn(0), drawn(18)];
            for (const name of ['length', 'speed', 'strength']) expect(hard[name], name).toBeGreaterThan(soft[name]);
            expect(hard.width).toBeGreaterThanOrEqual(soft.width);
        });

        it('plays a lock once: no ribbon, gust or burst is repeated on the frames that follow', () => {
            const {
                reactions, launched, blown, spawn, frame, run,
            } = rig();
            reactions.onPieceLock({ piece: piece('Z', 7, 20) });
            frame();
            const after = { ribbons: launched.length, gusts: blown.mock.calls.length, seed: spawn.mock.calls.length };
            expect(after).toMatchObject({ ribbons: 1, gusts: 1 });
            expect(after.seed).toBeGreaterThan(5);
            run(3);
            expect(launched).toHaveLength(after.ribbons);
            expect(blown).toHaveBeenCalledTimes(after.gusts);
            expect(spawn).toHaveBeenCalledTimes(after.seed);
        });

        it('throws a handful of seed and chaff out from the same edge, clear of the grass', () => {
            for (const [column, side] of [[1, -1], [8, 1]]) {
                const {
                    director, reactions, stage, thrown,
                } = rig();
                reactions.onPieceLock({ piece: piece('L', column, 12) });
                const env = director.apply(reactions.update(STEP), STEP, WIND);
                const seed = thrown();
                expect(seed.length).toBeGreaterThan(8);
                const edge = stage.edge(side, 0.5);
                for (const particle of seed) {
                    expect(particle.vx * side).toBeGreaterThan(0);
                    expect(particle.vy).toBeGreaterThan(0);
                    expect(Math.hypot(particle.x - edge.x, particle.z - edge.z)).toBeLessThan(2);
                    expect(clearanceOf(particle)).toBeGreaterThan(0.5);
                    // Bits of grass and its seed, not petals.
                    expect([CHAFF, SEED]).toContain(particle.kind);
                    expect([VERDANT_HILLS_CHAFF.straw, VERDANT_HILLS_CHAFF.blade]).toContain(particle.tint);
                    expect(particle.life).toBeGreaterThan(1);
                    expect(particle.size).toBeGreaterThan(0.01);
                }
                expect(new Set(seed.map((particle) => particle.kind)).size).toBe(2);
                // A burst of air at the edge carries them off for the first moments, and then lets go.
                const bursts = env.fields.filter((field) => field.kind === 'burst');
                expect(bursts).toHaveLength(1);
                expect(Math.hypot(bursts[0].x - edge.x, bursts[0].z - edge.z)).toBeLessThan(1);
                expect(bursts[0].radius).toBeGreaterThan(1);
                expect(bursts[0].power).toBeGreaterThan(0);
            }
            const { reactions, frame } = rig();
            reactions.onPieceLock({ piece: piece('L', 1, 12) });
            const young = [];
            for (let count = 0; count < 60; count++) {
                young.push(frame().fields.filter((field) => field.kind === 'burst').length);
            }
            expect(young[0]).toBe(1);
            expect(young.at(-1)).toBe(0);
            expect(sum(young)).toBeLessThan(30);
        });

        it('shakes dandelion seed out of the grass at the foot of the board after a long hard drop', () => {
            const {
                reactions, stage, camera, thrown, frame, spawn, run,
            } = rig();
            reactions.onHardDrop({ distance: 16 });
            reactions.onPieceLock({ piece: piece('I', 6, 22) });
            frame();
            const burst = spawn.mock.calls.length;
            // It lifts over a moment, not in one frame.
            const perFrame = [];
            for (let count = 0; count < 60; count++) {
                const before = spawn.mock.calls.length;
                frame();
                perFrame.push(spawn.mock.calls.length - before);
            }
            const seed = thrown(burst);
            expect(seed.length).toBeGreaterThan(30);
            expect(perFrame.filter((count) => count > 0).length).toBeGreaterThan(5);
            expect(Math.max(...perFrame)).toBeLessThan(seed.length / 2);
            const foot = stage.ground(stage.screen(0.65, 0).x, stage.board.y1 + 0.03, ground);
            for (const particle of seed) {
                expect(particle.kind).toBe(SEED);
                expect(particle.vy).toBeGreaterThan(0);
                // Off the grass itself, around where the piece came down.
                expect(clearanceOf(particle)).toBeGreaterThan(0.3);
                expect(clearanceOf(particle)).toBeLessThan(1.2);
                expect(Math.hypot(particle.x - foot.x, particle.z - foot.z)).toBeLessThan(4.5);
                expect(onScreen(camera, particle).ahead).toBe(true);
            }
            run(2);
            expect(spawn).toHaveBeenCalledTimes(burst + seed.length);
            // A piece set down gently shakes nothing loose.
            const gentle = rig();
            gentle.reactions.onHardDrop({ distance: 2 });
            gentle.reactions.onPieceLock({ piece: piece('I', 6, 22) });
            gentle.run(1);
            expect(gentle.thrown().every((particle) => particle.tint !== undefined)).toBe(true);
        });

        it('sends the ribbon and the seed of a lock it cannot place out of the same side', () => {
            const {
                director, reactions, stage, launched, thrown, spawn,
            } = rig();
            for (let count = 0; count < 4; count++) {
                const before = spawn.mock.calls.length;
                reactions.onPieceLock({});
                director.apply(reactions.update(STEP), STEP, WIND);
                const seed = Math.sign(mean(thrown(before).map((particle) => particle.vx)));
                const ribbon = Math.sign(launched.at(-1).heading.dot(stage.right));
                expect(ribbon, `lock ${count}`).toBe(seed);
            }
        });

        it('draws a lock it cannot place in white, from one edge or the other', () => {
            const {
                director, reactions, stage, launched, thrown,
            } = rig();
            reactions.onPieceLock({});
            director.apply(reactions.update(STEP), STEP, WIND);
            expect(launched).toHaveLength(1);
            expect(isKiteColour(launched[0].colour)).toBe(false);
            expect(Math.min(launched[0].colour.r, launched[0].colour.g, launched[0].colour.b)).toBeGreaterThan(0.8);
            expect(Math.abs(launched[0].heading.dot(stage.right))).toBeGreaterThan(0.5);
            expect(thrown().length).toBeGreaterThan(8);
            expect(VERDANT_HILLS_MIXED).toBeLessThan(0);
        });
    });

    describe('a line clear', () => {
        /** One clear of `lines` rows, played for a frame. */
        function clear(lines, options = {}) {
            const built = rig(options);
            const clearedRows = Array.from({ length: lines }, (_, index) => 14 - index);
            built.reactions.onLineClear(lines, { clearedRows });
            built.env = built.director.apply(built.reactions.update(STEP), STEP, WIND);
            const centre = built.stage.centre();
            built.sideOf = (point) => Math.sign(
                new THREE.Vector3(point.x, point.y, point.z).sub(centre).dot(built.stage.right),
            );
            /** The ribbons that stream from the card's edges, as against the great gust behind it. */
            built.streams = () => built.launched
                .filter((ribbon) => depthOf(built.stage, ribbon.origin) < VERDANT_HILLS_STAGE_DEPTH + 2.5);
            return built;
        }

        it.each([1, 2, 3, 4])('streams white ribbons out of both sides of the board for %i lines', (lines) => {
            const {
                stage, camera, sideOf, streams: streaming,
            } = clear(lines);
            const streams = streaming();
            const left = streams.filter((ribbon) => sideOf(ribbon.origin) < 0);
            const right = streams.filter((ribbon) => sideOf(ribbon.origin) > 0);
            expect(left.length).toBeGreaterThan(0);
            expect(right).toHaveLength(left.length);
            // More rows, no fewer ribbons; never more than one to a row.
            expect(left.length).toBeLessThanOrEqual(lines);
            expect(left.length).toBeGreaterThanOrEqual(Math.min(lines, 2));
            for (const ribbon of streams) {
                const side = sideOf(ribbon.origin);
                const at = onScreen(camera, ribbon.origin);
                const edge = side < 0 ? stage.board.x0 : stage.board.x1;
                // From behind the card's edge, at the height of the cleared rows, outward.
                expect(Math.abs(at.x - edge)).toBeLessThan(0.04);
                expect(at.x).toBeGreaterThan(stage.board.x0);
                expect(at.x).toBeLessThan(stage.board.x1);
                expect(at.y).toBeGreaterThan(stage.board.y0);
                expect(at.y).toBeLessThan(stage.board.y1);
                expect(depthOf(stage, ribbon.origin)).toBeGreaterThan(VERDANT_HILLS_STAGE_DEPTH - 0.5);
                expect(clearanceOf(ribbon.origin)).toBeGreaterThan(0.4);
                expect(ribbon.heading.dot(stage.right) * side).toBeGreaterThan(0.5);
                expect(isKiteColour(ribbon.colour)).toBe(false);
                expect(Math.min(ribbon.colour.r, ribbon.colour.g, ribbon.colour.b)).toBeGreaterThan(0.8);
            }
            // One ribbon to a cleared row: stacked, not laid on top of each other.
            const heights = left.map((ribbon) => onScreen(camera, ribbon.origin).y);
            expect(new Set(heights.map((value) => value.toFixed(4))).size).toBe(left.length);
        });

        it('streams longer and faster the more rows went', () => {
            const reach = (lines) => {
                const streams = clear(lines).streams();
                return { count: streams.length, speed: mean(streams.map((ribbon) => ribbon.speed)) };
            };
            const reaches = [1, 2, 3, 4].map(reach);
            for (let index = 1; index < reaches.length; index++) {
                expect(reaches[index].count).toBeGreaterThanOrEqual(reaches[index - 1].count);
                expect(reaches[index].speed).toBeGreaterThan(reaches[index - 1].speed - 1.5);
            }
            expect(reaches[3].speed).toBeGreaterThan(reaches[0].speed);
            expect(reaches[2].count).toBeGreaterThan(reaches[0].count);
        });

        it('blows seed, pollen and petals out of both sides over an opening window', () => {
            const built = rig();
            built.reactions.onLineClear(2, { clearedRows: [13, 14] });
            const perFrame = [];
            const jets = [];
            for (let count = 0; count < 120; count++) {
                const before = built.spawn.mock.calls.length;
                const env = built.frame();
                perFrame.push(built.spawn.mock.calls.length - before);
                jets.push(env.fields.filter((field) => field.kind === 'jet').map((field) => ({ ...field })));
            }
            const seed = built.thrown();
            expect(seed.length).toBeGreaterThan(40);
            // Spread over the first half second or so, then nothing more.
            expect(perFrame.filter((count) => count > 0).length).toBeGreaterThan(10);
            expect(sum(perFrame.slice(60))).toBe(0);
            const left = seed.filter((particle) => particle.vx < 0);
            const right = seed.filter((particle) => particle.vx > 0);
            expect(Math.abs(left.length - right.length)).toBeLessThanOrEqual(2);
            for (const [side, group] of [[-1, left], [1, right]]) {
                const edge = built.stage.edge(side, 0.5);
                for (const particle of group) {
                    expect(Math.abs(particle.x - edge.x)).toBeLessThan(0.5);
                    expect(clearanceOf(particle)).toBeGreaterThan(0.5);
                    expect(particle.vy).toBeGreaterThan(0);
                }
            }
            expect(new Set(seed.map((particle) => particle.kind))).toEqual(new Set([CHAFF, SEED, POLLEN]));
            for (const particle of seed) expect(particle.tint).toBeLessThan(VERDANT_HILLS_TINTS);
            // A jet of air on either side, pointing away from the board, for the first moments.
            expect(jets[0]).toHaveLength(2);
            expect(jets[0].map((jet) => jet.dx).sort()).toEqual([-1, 1]);
            for (const jet of jets[0]) {
                expect((jet.x - built.stage.centre().x) * jet.dx).toBeGreaterThan(0);
                expect(jet.power).toBeGreaterThan(0);
            }
            expect(jets.at(-1)).toHaveLength(0);
        });

        it('throws more for more lines, and catches up when it first sees a clear late', () => {
            const total = (lines) => {
                const built = rig();
                built.reactions.onLineClear(lines, { clearedRows: [14] });
                built.run(1.5);
                return built.thrown().length;
            };
            const totals = [1, 2, 3, 4].map(total);
            // The four-line clear also lifts the hillside: it is far more than the others.
            for (let index = 1; index < 3; index++) expect(totals[index]).toBeGreaterThan(totals[index - 1]);
            expect(totals[3]).toBeGreaterThan(totals[2] * 2);
            // A director that was not looking for the first half second throws the same amount in the end.
            const late = rig();
            late.reactions.onLineClear(2, { clearedRows: [14] });
            for (let count = 0; count < 30; count++) late.reactions.update(STEP);
            late.run(1);
            expect(Math.abs(late.thrown().length - totals[1])).toBeLessThanOrEqual(2);
        });

        it('sends a front of wind down the valley from two lines up', () => {
            const one = rig();
            one.reactions.onLineClear(1, { clearedRows: [20] });
            expect(one.frame().front).toBeNull();
            const two = rig();
            two.reactions.onLineClear(2, { clearedRows: [20, 21] });
            const fronts = [];
            two.run(4, (env) => fronts.push(env.front ? { ...env.front } : null));
            const seen = fronts.filter(Boolean);
            expect(seen.length).toBeGreaterThan(60);
            // It ends, and when it has ended it is gone.
            expect(fronts.at(-1)).toBeNull();
            for (let index = 1; index < seen.length; index++) {
                expect(seen[index].along).toBeGreaterThan(seen[index - 1].along);
                expect(seen[index].width).toBeGreaterThanOrEqual(seen[index - 1].width);
            }
            expect(seen[0].along).toBeLessThan(0);
            expect(seen.at(-1).along).toBeGreaterThan(500);
        });

        it('lays the great gust across the whole view behind the board for four lines', () => {
            const {
                stage, camera, launched, env,
            } = clear(4);
            const great = launched.filter((ribbon) => depthOf(stage, ribbon.origin) >= VERDANT_HILLS_STAGE_DEPTH + 2.5);
            expect(great.length).toBeGreaterThanOrEqual(2);
            for (const ribbon of great) {
                const depth = depthOf(stage, ribbon.origin);
                // It comes in from beyond the left edge of the frame, behind the board ...
                expect(onScreen(camera, ribbon.origin).x).toBeLessThan(0.02);
                expect(depth).toBeGreaterThan(VERDANT_HILLS_STAGE_DEPTH);
                expect(clearanceOf(ribbon.origin)).toBeGreaterThan(1);
                // ... heads to the right, nearly level ...
                expect(ribbon.heading.dot(stage.right)).toBeGreaterThan(0.8);
                expect(Math.abs(ribbon.heading.y)).toBeLessThan(0.2);
                // ... and its head runs clean across the picture at its depth before it is spent.
                const run = ribbon.speed * ribbon.life * 0.7;
                expect(run).toBeGreaterThan(stage.halfWidth(depth) * 2.2);
                expect(ribbon.length).toBeGreaterThan(8);
                expect(isKiteColour(ribbon.colour)).toBe(false);
            }
            // The clouds open with it.
            expect(env.pool).not.toBeNull();
            expect(env.pool.strength).toBeGreaterThanOrEqual(0);
        });

        it('lifts seed and petals off the grass all round the board, and tears leaves off the oak', () => {
            const built = rig({ quality: 'Medium' });
            built.reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            built.run(2.2);
            const all = built.thrown();
            const leaves = all.filter((particle) => [VERDANT_HILLS_CHAFF.oakLeaf, VERDANT_HILLS_CHAFF.oakLeafPale]
                .includes(particle.tint) && particle.size > 0.1);
            // From the crown of the oak, torn off down the wind.
            expect(leaves.length).toBeGreaterThan(30);
            for (const leaf of leaves) {
                expect(leaf.kind).toBe(CHAFF);
                const out = Math.hypot(leaf.x - OAK_CROWN.x, leaf.z - OAK_CROWN.z);
                expect(out).toBeLessThanOrEqual(OAK_CROWN.radius + 1e-6);
                expect(Math.abs(leaf.y - OAK_CROWN.y)).toBeLessThan(OAK_CROWN.radius);
                expect(clearanceOf(leaf)).toBeGreaterThan(2);
                expect(leaf.vx * WINDWARD.x + leaf.vz * WINDWARD.z).toBeGreaterThan(0);
            }
            // The hillside: off the grass in front of the lens, from one side of the screen to the other.
            const edgeX = [built.stage.edge(-1, 0.5).x, built.stage.edge(1, 0.5).x];
            const risen = all.filter((particle) => !leaves.includes(particle) && Math.abs(particle.vx) < 0.7
                && particle.x !== edgeX[0] && particle.x !== edgeX[1]);
            expect(risen.length).toBeGreaterThan(100);
            const screens = risen.map((particle) => onScreen(built.camera, particle));
            for (let index = 0; index < risen.length; index++) {
                expect(clearanceOf(risen[index])).toBeGreaterThan(0.25);
                expect(clearanceOf(risen[index])).toBeLessThan(1);
                expect(risen[index].vy).toBeGreaterThan(0);
                expect(screens[index].ahead).toBe(true);
                const [dx, dz] = [risen[index].x - built.stage.origin.x, risen[index].z - built.stage.origin.z];
                expect(Math.hypot(dx, dz)).toBeLessThan(45);
            }
            expect(Math.min(...screens.map((at) => at.x))).toBeLessThan(0.2);
            expect(Math.max(...screens.map((at) => at.x))).toBeGreaterThan(0.8);
            // No oak, no leaves; the hill breathes out all the same.
            const bare = rig({ oak: null, quality: 'Medium' });
            bare.reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            bare.run(2.2);
            expect(bare.thrown().filter((particle) => particle.size > 0.1).length).toBe(0);
            expect(bare.thrown().length).toBeGreaterThan(100);
        });

        it.each(TIERS.filter((quality) => quality !== 'Minimal'))(
            'still shows ribbons on both sides after a four-line clear on the %s tier',
            (quality) => {
                const {
                    stage, ribbons, sideOf, reactions,
                } = clear(4, { quality });
                expect(reactions.maxEmitters).toBeGreaterThan(0);
                const sides = { left: 0, right: 0 };
                for (let index = 0; index < ribbons.count; index++) {
                    const [start, , tone] = ribbons.rows.slice(index * 6, index * 6 + 3);
                    if (tone.w > 0 && depthOf(stage, start) < VERDANT_HILLS_STAGE_DEPTH + 2.5) {
                        sides[sideOf(start) < 0 ? 'left' : 'right'] += 1;
                    }
                }
                expect(sides.left).toBeGreaterThan(0);
                expect(sides.right).toBeGreaterThan(0);
            },
        );

        it('still shows ribbons on both sides after a four-line clear on the Minimal tier', () => {
            const built = rig({ quality: 'Minimal' });
            built.reactions.onPieceLock({ piece: piece('I', 4, 20) });
            built.reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            built.director.apply(built.reactions.update(STEP), STEP, WIND);
            const centre = built.stage.centre();
            const sides = { left: 0, right: 0 };
            for (let index = 0; index < built.ribbons.count; index++) {
                const [start, , tone] = built.ribbons.rows.slice(index * 6, index * 6 + 3);
                const origin = new THREE.Vector3(start.x, start.y, start.z);
                if (tone.w > 0 && depthOf(built.stage, origin) < VERDANT_HILLS_STAGE_DEPTH + 2.5) {
                    sides[origin.sub(centre).dot(built.stage.right) < 0 ? 'left' : 'right'] += 1;
                }
            }
            expect(sides.left, JSON.stringify(sides)).toBeGreaterThan(0);
            expect(sides.right, JSON.stringify(sides)).toBeGreaterThan(0);
        });
    });

    describe('a t-spin', () => {
        it.each([[-1, 1], [1, 8]])('winds a spiral of wind beside the board on side %i', (side, column) => {
            const {
                director, reactions, stage, camera, launched,
            } = rig();
            reactions.onTSpin({ piece: piece('T', column, 10) });
            const env = director.apply(reactions.update(STEP), STEP, WIND);
            // Two strands from one place, wound against each other.
            expect(launched).toHaveLength(2);
            expect(launched[0].origin.distanceTo(launched[1].origin)).toBeLessThan(1e-9);
            expect(launched[0].heading.dot(launched[1].heading)).toBeCloseTo(-1, 6);
            // One of them in the colour of the T's own kite.
            const kite = KITE_TONES[VERDANT_HILLS_PIECE_KITES.T];
            expect(launched.filter((ribbon) => sameColour(ribbon.colour, kite))).toHaveLength(1);
            const at = onScreen(camera, launched[0].origin);
            // Beside the card, in the open, not behind it.
            if (side < 0) expect(at.x).toBeLessThan(stage.board.x0);
            else expect(at.x).toBeGreaterThan(stage.board.x1);
            expect(at.x).toBeGreaterThan(0.1);
            expect(at.x).toBeLessThan(0.9);
            expect(at.y).toBeGreaterThan(0);
            expect(at.y).toBeLessThan(1);
            for (const ribbon of launched) {
                expect(clearanceOf(ribbon.origin)).toBeGreaterThan(0.4);
                // A tight spiral that climbs: several turns about an axis square to the way it sets out.
                expect(ribbon.loops).toBeGreaterThanOrEqual(2);
                expect(ribbon.loopRadius).toBeLessThan(1.5);
                expect(ribbon.lift).toBeGreaterThan(0.1);
                expect(Math.abs(ribbon.axis.clone().normalize().dot(ribbon.heading))).toBeLessThan(1e-6);
            }
            // Seed is thrown into it, and a whirl of air holds it there for a second or so.
            const whirls = env.fields.filter((field) => field.kind === 'vortex');
            expect(whirls).toHaveLength(1);
            expect(whirls[0].turn).toBe(side);
            expect((whirls[0].x - stage.centre().x) * side).toBeGreaterThan(0);
            expect(whirls[0].reach).toBeGreaterThan(whirls[0].radius);
        });

        it('throws its seed once and lets the whirl go after a moment', () => {
            const {
                reactions, frame, thrown, spawn, launched,
            } = rig();
            reactions.onTSpin({ piece: piece('T', 7, 10) });
            const whirls = [];
            for (let count = 0; count < 120; count++) {
                whirls.push(frame().fields.filter((field) => field.kind === 'vortex').length);
            }
            expect(whirls[0]).toBe(1);
            expect(whirls.at(-1)).toBe(0);
            expect(sum(whirls)).toBeGreaterThan(30);
            const seed = thrown();
            expect(seed.length).toBeGreaterThan(15);
            expect(spawn).toHaveBeenCalledTimes(seed.length);
            expect(launched).toHaveLength(2);
            for (const particle of seed) {
                expect(clearanceOf(particle)).toBeGreaterThan(0.5);
                expect([CHAFF, SEED]).toContain(particle.kind);
            }
            expect(new Set(seed.map((particle) => particle.kind)).size).toBe(2);
        });
    });

    describe('the ground under the effects', () => {
        it('puts the air that carries the seed where the seed is, not under the hill', () => {
            const buried = [];
            for (const y of [23, 21, 19]) {
                const built = rig();
                built.reactions.onPieceLock({ piece: piece('L', 1, y) });
                built.reactions.onLineClear(1, { clearedRows: [y] });
                built.reactions.onTSpin({ piece: piece('T', 8, y) });
                const env = built.director.apply(built.reactions.update(STEP), STEP, WIND);
                for (const field of env.fields) {
                    const height = field.kind === 'vortex' ? field.top : field.y;
                    const under = ground(field.x, field.z) - height;
                    if (under > 0) buried.push(`${field.kind} for row ${y}: ${under.toFixed(2)} m under`);
                }
            }
            expect(buried).toEqual([]);
        });

        it('keeps the seed of a t-spin low on the board in the air', () => {
            const built = rig();
            built.reactions.onTSpin({ piece: piece('T', 7, 22) });
            built.frame();
            const seed = aloft(built.sim);
            expect(seed.length).toBeGreaterThan(15);
            built.run(1);
            // A second later all of it should still be turning beside the board.
            const down = seed.filter((index) => built.sim.life[index] <= 0
                || built.sim.y[index] - ground(built.sim.x[index], built.sim.z[index]) < 0.1);
            expect(down.length, `${down.length} of ${seed.length} are in the grass`).toBe(0);
        });

        it('keeps the seed of a t-spin higher on the board in the air', () => {
            const built = rig();
            built.reactions.onTSpin({ piece: piece('T', 7, 12) });
            built.frame();
            const seed = aloft(built.sim);
            built.run(1);
            for (const index of seed) {
                expect(built.sim.life[index]).toBeGreaterThan(0);
                expect(built.sim.y[index] - ground(built.sim.x[index], built.sim.z[index])).toBeGreaterThan(0.3);
            }
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('never throws seed or starts a ribbon under the ground, whatever happens (%s)', (_label, aspect) => {
            const built = rig({ aspect, quality: 'Low' });
            const random = seededRandom(31);
            for (let event = 0; event < 28; event++) {
                const column = Math.floor(random() * 10);
                const y = 4 + Math.floor(random() * 20);
                const roll = Math.floor(random() * 7);
                if (roll === 0) built.reactions.onHardDrop({ distance: 4 + random() * 16 });
                if (roll <= 2) built.reactions.onPieceLock({ piece: piece(LETTERS[event % 7], column, y) });
                else if (roll === 3) built.reactions.onLineClear(1 + (event % 4), { clearedRows: [y] });
                else if (roll === 4) built.reactions.onTSpin({ piece: piece('T', column, y) });
                else if (roll === 5) built.reactions.onCombo(2 + (event % 6));
                else built.reactions.onPerfectClear();
                built.run(0.25);
            }
            const seed = built.thrown();
            expect(seed.length).toBeGreaterThan(150);
            for (const particle of seed) {
                if (!(clearanceOf(particle) > 0.25)) throw new Error(`seed ${clearanceOf(particle)} m off the ground`);
                const numbers = [particle.x, particle.y, particle.z, particle.vx, particle.vy, particle.vz];
                if (!numbers.every(Number.isFinite)) throw new Error('seed thrown from nowhere');
            }
            expect(built.launched.length).toBeGreaterThan(25);
            for (const ribbon of built.launched) {
                if (!(clearanceOf(ribbon.origin) > 0.4)) throw new Error(`ribbon ${clearanceOf(ribbon.origin)} m up`);
                expect(ribbon.heading.length()).toBeCloseTo(1, 9);
                // In front of the lens.
                expect(depthOf(built.stage, ribbon.origin)).toBeGreaterThan(2);
            }
            // And what the simulation flew never went through the hill.
            for (const index of aloft(built.sim)) {
                expect(built.sim.y[index]).toBeGreaterThanOrEqual(ground(built.sim.x[index], built.sim.z[index]));
            }
        });
    });

    describe('a combo', () => {
        it('throws one ring of seed and petals around the board for a fresh combo', () => {
            const {
                reactions, stage, thrown, frame, spawn,
            } = rig();
            reactions.onCombo(3);
            // The frame the combo lands in: the whirl has not begun to turn yet.
            frame();
            const ring = thrown();
            expect(ring.length).toBeGreaterThan(15);
            const centre = stage.centre();
            for (const particle of ring) {
                const [dx, dz] = [particle.x - centre.x, particle.z - centre.z];
                const radius = Math.hypot(dx, dz);
                expect(radius).toBeGreaterThan(2);
                expect(radius).toBeLessThan(5);
                expect(clearanceOf(particle)).toBeGreaterThan(0.5);
                // Thrown round the circle, not out of it.
                const outward = (particle.vx * dx + particle.vz * dz) / radius;
                const around = (dx * particle.vz - dz * particle.vx) / radius;
                expect(Math.abs(outward)).toBeLessThan(1e-6);
                expect(around).toBeGreaterThan(1);
                expect([CHAFF, SEED]).toContain(particle.kind);
            }
            // All the way round.
            const angles = ring.map((particle) => Math.atan2(particle.z - centre.z, particle.x - centre.x));
            expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI);
            expect(spawn).toHaveBeenCalledTimes(ring.length);
            // A bigger combo, a bigger ring.
            const big = rig();
            big.reactions.onCombo(12);
            big.frame();
            expect(big.thrown().length).toBeGreaterThan(ring.length);
        });

        it('winds one whirl of air around the board that climbs and quickens as the combo builds', () => {
            const { director, stage } = rig();
            const at = (whirl) => {
                const env = director.apply(quiet({ whirl }), 0, WIND);
                return env.fields.filter((field) => field.kind === 'vortex').map((field) => ({ ...field }));
            };
            // Too slight to see is no whirl at all.
            expect(at(0)).toHaveLength(0);
            expect(at(0.01)).toHaveLength(0);
            const centre = stage.centre();
            let previous = null;
            for (const whirl of [0.1, 0.3, 0.5, 0.75, 1]) {
                const fields = at(whirl);
                expect(fields).toHaveLength(1);
                const [field] = fields;
                expect(field.x).toBeCloseTo(centre.x, 9);
                expect(field.z).toBeCloseTo(centre.z, 9);
                // Wide enough to go round the card, reaching further than it holds.
                expect(field.radius).toBeGreaterThan(stage.halfWidth() * (stage.board.x1 - stage.board.x0));
                expect(field.reach).toBeGreaterThan(field.radius);
                expect(Math.abs(field.turn)).toBe(1);
                if (previous) {
                    expect(field.top).toBeGreaterThan(previous.top);
                    expect(field.spin).toBeGreaterThan(previous.spin);
                    expect(field.radius).toBeGreaterThanOrEqual(previous.radius);
                }
                previous = field;
            }
            // Beyond its range is a full whirl, and nonsense is none.
            expect(at(7)).toEqual(at(1));
            for (const junk of [NaN, Infinity, -1, undefined, null, 'fast']) expect(at(junk)).toHaveLength(0);
        });

        it('keeps the whirl fed and drawn while it turns, by the clock and not by the frame', () => {
            const feed = (whirl, fps, seconds = 2) => {
                const built = rig();
                for (let count = 0; count < fps * seconds; count++) {
                    built.director.apply(quiet({ whirl }), 1 / fps, WIND);
                }
                return { seed: built.thrown().length, ribbons: built.launched.length };
            };
            const [slow, steady, fast] = [feed(0.6, 30), feed(0.6, 60), feed(0.6, 120)];
            expect(steady.seed).toBeGreaterThan(40);
            expect(Math.abs(slow.seed - steady.seed)).toBeLessThanOrEqual(2);
            expect(Math.abs(fast.seed - steady.seed)).toBeLessThanOrEqual(2);
            expect(steady.ribbons).toBeGreaterThanOrEqual(3);
            expect(Math.abs(slow.ribbons - steady.ribbons)).toBeLessThanOrEqual(1);
            expect(Math.abs(fast.ribbons - steady.ribbons)).toBeLessThanOrEqual(1);
            // A stronger whirl takes more of both; a frozen frame takes no seed.
            const strong = feed(1, 60);
            expect(strong.seed).toBeGreaterThan(steady.seed);
            expect(strong.ribbons).toBeGreaterThan(steady.ribbons);
            const frozen = rig();
            for (let count = 0; count < 100; count++) frozen.director.apply(quiet({ whirl: 0.6 }), 0, WIND);
            expect(frozen.thrown()).toHaveLength(0);
            expect(frozen.launched.length).toBeLessThanOrEqual(1);
        });

        it('draws the whirl as ribbons that circle the board and climb', () => {
            const built = rig();
            const turn = (target, streamers) => {
                const state = quiet({ whirl: 0.7, streamers });
                for (let count = 0; count < 180; count++) target.director.apply(state, STEP, WIND);
            };
            turn(built, 0.6);
            const around = built.stage.halfWidth() * (built.stage.board.x1 - built.stage.board.x0);
            expect(built.launched.length).toBeGreaterThanOrEqual(4);
            const centre = built.stage.centre();
            const angles = [];
            for (const ribbon of built.launched) {
                const out = ribbon.origin.clone().sub(centre);
                const level = Math.hypot(out.dot(built.stage.right), out.dot(built.stage.forward));
                // It starts on a circle about the board as wide as its own loop, setting out along it,
                // and its loop bends inward: about the board, not away from it.
                // (Lifting it clear of the grass moves it a hand's breadth off the tilted circle.)
                expect(Math.abs(level - ribbon.loopRadius)).toBeLessThan(0.3);
                expect(Math.abs(ribbon.heading.dot(out.clone().setY(0).normalize()))).toBeLessThan(0.15);
                expect(ribbon.axis.dot(out)).toBeLessThan(0);
                expect(ribbon.loops).toBeGreaterThanOrEqual(1);
                expect(ribbon.loopAt).toBe(0);
                expect(ribbon.lift).toBeGreaterThan(0);
                expect(clearanceOf(ribbon.origin)).toBeGreaterThan(0.5);
                expect(ribbon.loopRadius).toBeGreaterThan(around);
                angles.push(Math.atan2(out.dot(built.stage.forward), out.dot(built.stage.right)));
            }
            // Each from a different place on the circle, and in the kites' colours once the streamers unfurl.
            expect(new Set(angles.map((angle) => angle.toFixed(2))).size).toBe(built.launched.length);
            expect(built.launched.every((ribbon) => isKiteColour(ribbon.colour))).toBe(true);
            expect(new Set(built.launched.map((ribbon) => ribbon.colour.getHexString())).size).toBeGreaterThan(2);
            // Before they unfurl some are still plain wind.
            const plain = rig();
            turn(plain, 0);
            expect(plain.launched.some((ribbon) => !isKiteColour(ribbon.colour))).toBe(true);
            // When the combo ends, so do the ribbons.
            const drawn = built.launched.length;
            for (let count = 0; count < 120; count++) built.director.apply(quiet({ whirl: 0 }), STEP, WIND);
            expect(built.launched).toHaveLength(drawn);
        });

        it('turns the whirl\'s ribbons the way the whirl turns its seed', () => {
            const built = rig({ quality: 'Medium' });
            built.reactions.onCombo(6);
            const seen = { field: null };
            built.run(3, (env) => { seen.field = env.fields.find((entry) => entry.kind === 'vortex') ?? seen.field; });
            const { field } = seen;
            // The seed has taken the whirl's turn.
            const turning = aloft(built.sim).map((index) => {
                const [dx, dz] = [built.sim.x[index] - field.x, built.sim.z[index] - field.z];
                return (dx * built.sim.vz[index] - dz * built.sim.vx[index]) / (dx * dx + dz * dz);
            });
            expect(turning.length).toBeGreaterThan(30);
            expect(Math.sign(mean(turning))).toBe(field.turn);
            // So should every ribbon launched round it.
            const senses = built.launched.map((ribbon) => {
                const [dx, dz] = [ribbon.origin.x - field.x, ribbon.origin.z - field.z];
                return Math.sign(dx * ribbon.heading.z - dz * ribbon.heading.x);
            });
            expect(senses.length).toBeGreaterThan(3);
            expect(senses.filter((sense) => sense !== field.turn)).toEqual([]);
        });

        it('winds a real combo into a whirl of seed around the board and holds it there', () => {
            const built = rig({ quality: 'Medium' });
            const seen = { field: null };
            const watch = (env) => { seen.field = env.fields.find((entry) => entry.kind === 'vortex') ?? seen.field; };
            for (let combo = 2; combo <= 7; combo++) {
                built.reactions.onLineClear(1, { clearedRows: [20] });
                built.reactions.onCombo(combo);
                built.run(0.7, watch);
            }
            const { field } = seen;
            expect(field).not.toBeNull();
            const orbit = aloft(built.sim).map((index) => ({
                radius: Math.hypot(built.sim.x[index] - field.x, built.sim.z[index] - field.z),
                clearance: built.sim.y[index] - ground(built.sim.x[index], built.sim.z[index]),
            })).filter((particle) => particle.radius < field.reach);
            expect(orbit.length).toBeGreaterThan(40);
            // Gathered about the whirl's radius, in the air.
            const near = orbit.filter((particle) => Math.abs(particle.radius - field.radius) < 1.5).length;
            expect(near / orbit.length).toBeGreaterThan(0.5);
            expect(mean(orbit.map((particle) => particle.clearance))).toBeGreaterThan(0.5);
        });
    });

    describe('the great occasions', () => {
        it('fans a ribbon in each kite\'s colour up from behind the board for the festival', () => {
            const {
                director, reactions, stage, camera, launched,
            } = rig();
            LETTERS.slice(0, 6).forEach((letter) => reactions.launch(VERDANT_HILLS_PIECE_KITES[letter]));
            reactions.onPieceLock({ piece: piece(LETTERS[6], 4, 12) });
            const state = reactions.update(STEP);
            expect(state.festivals).toBe(1);
            director.apply(state, STEP, WIND);
            // The lock's own ribbon, then the seven.
            const fan = launched.slice(1);
            expect(fan).toHaveLength(KITE_TONES.length);
            fan.forEach((ribbon, slot) => expect(sameColour(ribbon.colour, KITE_TONES[slot])).toBe(true));
            const sideways = fan.map((ribbon) => ribbon.heading.dot(stage.right));
            // Spread like a hand: the first leans furthest left, the last furthest right, all of them up.
            for (let slot = 1; slot < fan.length; slot++) expect(sideways[slot]).toBeGreaterThan(sideways[slot - 1]);
            expect(sideways[0]).toBeLessThan(-0.3);
            expect(sideways.at(-1)).toBeGreaterThan(0.3);
            for (const ribbon of fan) {
                expect(ribbon.heading.y).toBeGreaterThan(0.2);
                const at = onScreen(camera, ribbon.origin);
                // From behind the card.
                expect(at.x).toBeGreaterThan(stage.board.x0);
                expect(at.x).toBeLessThan(stage.board.x1);
                expect(at.y).toBeGreaterThan(stage.board.y0);
                expect(at.y).toBeLessThan(stage.board.y1);
                expect(clearanceOf(ribbon.origin)).toBeGreaterThan(0.6);
                expect(depthOf(stage, ribbon.origin)).toBeGreaterThan(VERDANT_HILLS_STAGE_DEPTH);
                // Each loop leans out to its own side.
                expect(Math.abs(ribbon.axis.clone().normalize().dot(stage.right))).toBeGreaterThan(0.99);
            }
            for (let count = 0; count < 60; count++) director.apply(reactions.update(STEP), STEP, WIND);
            expect(launched).toHaveLength(1 + KITE_TONES.length);
        });

        it('fans all seven colours for the festival on the Minimal tier', () => {
            const built = rig({ quality: 'Minimal' });
            LETTERS.slice(0, 6).forEach((letter) => built.reactions.launch(VERDANT_HILLS_PIECE_KITES[letter]));
            built.reactions.onPieceLock({ piece: piece(LETTERS[6], 4, 12) });
            built.director.apply(built.reactions.update(STEP), STEP, WIND);
            const colours = new Set();
            for (let index = 0; index < built.ribbons.count; index++) {
                const tone = built.ribbons.rows[index * 6 + 2];
                const kite = KITE_TONES.findIndex((entry) => sameColour(entry, { r: tone.x, g: tone.y, b: tone.z }));
                if (tone.w > 0 && kite >= 0) colours.add(kite);
            }
            expect(colours.size).toBe(KITE_TONES.length);
        });

        it('lifts the hillside for the festival as for a great clear', () => {
            const built = rig({ quality: 'Medium' });
            LETTERS.slice(0, 6).forEach((letter) => built.reactions.launch(VERDANT_HILLS_PIECE_KITES[letter]));
            built.reactions.onPieceLock({ piece: piece(LETTERS[6], 4, 12) });
            built.run(2.2);
            const risen = built.thrown().filter((particle) => Math.abs(particle.vx) < 0.7 && particle.size < 0.1);
            expect(risen.length).toBeGreaterThan(100);
            expect(built.thrown().some((particle) => particle.size > 0.1)).toBe(true);
        });

        it('answers a perfect clear with the great gust, the front, the open clouds and the festival\'s fan', () => {
            const {
                director, reactions, stage, launched, blown, run,
            } = rig();
            reactions.onPerfectClear();
            const env = director.apply(reactions.update(STEP), STEP, WIND);
            // (The whirl it raises starts to draw itself at once: those ribbons loop from the very start.)
            const great = launched.filter((ribbon) => !isKiteColour(ribbon.colour) && ribbon.loopAt > 0);
            const fan = launched.filter((ribbon) => isKiteColour(ribbon.colour) && ribbon.loopAt > 0);
            expect(great.length).toBeGreaterThanOrEqual(2);
            for (const ribbon of great) expect(ribbon.heading.dot(stage.right)).toBeGreaterThan(0.8);
            expect(fan).toHaveLength(KITE_TONES.length);
            expect(blown.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(env.front).not.toBeNull();
            expect(env.pool).not.toBeNull();
            const drawn = launched.length;
            // The whirl it raises goes on drawing itself; nothing of the first frame is drawn twice.
            run(0.2);
            const again = launched.slice(drawn);
            expect(again.every((ribbon) => ribbon.loopAt === 0)).toBe(true);
        });

        it('answers a level-up with a lighter great gust and a front, and no seed', () => {
            const up = rig();
            up.reactions.onLevelUp();
            const env = up.director.apply(up.reactions.update(STEP), STEP, WIND);
            const clear = rig();
            clear.reactions.onPerfectClear();
            clear.director.apply(clear.reactions.update(STEP), STEP, WIND);
            const greatOf = (built) => built.launched
                .filter((ribbon) => !isKiteColour(ribbon.colour) && ribbon.loopAt > 0);
            expect(up.launched.length).toBeGreaterThanOrEqual(2);
            expect(up.launched.length).toBe(greatOf(up).length);
            expect(greatOf(up).length).toBeLessThanOrEqual(greatOf(clear).length);
            expect(mean(greatOf(up).map((ribbon) => ribbon.strength)))
                .toBeLessThan(mean(greatOf(clear).map((ribbon) => ribbon.strength)));
            expect(up.blown).toHaveBeenCalledOnce();
            expect(env.front).not.toBeNull();
            expect(up.thrown()).toHaveLength(0);
            up.run(3);
            expect(up.launched.length).toBe(greatOf(up).length);
        });

        it('lets the wind drop when the game is over: the air clears and the breeze stops showing itself', () => {
            const built = rig({ idle: true, quality: 'Medium' });
            built.reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            built.reactions.onCombo(6);
            built.run(1.5);
            expect(built.sim.counts().live).toBeGreaterThan(100);
            const inAir = built.sim.counts().live;
            built.reactions.onGameOver();
            const env = built.frame();
            expect(env.settled).toBe(true);
            expect(env.front).toBeNull();
            expect(env.pool).toBeNull();
            // The whirl unwinds over a few seconds, still drawing itself as it goes.
            built.run(6);
            const drawn = built.launched.length;
            const fed = built.spawn.mock.calls.length;
            built.run(4);
            expect(built.spawn).toHaveBeenCalledTimes(fed);
            // Nothing new is thrown or drawn, and what was in the air has come down.
            expect(built.sim.counts().live).toBeLessThan(inAir * 0.05);
            expect(built.launched).toHaveLength(drawn);
            expect(built.ribbons.active()).toBe(0);
            for (const index of aloft(built.sim)) {
                expect(built.sim.y[index]).toBeGreaterThanOrEqual(ground(built.sim.x[index], built.sim.z[index]));
            }
        });
    });

    describe('queued ribbons', () => {
        it('plays a full queue of ribbons asked for in one frame, each once and oldest first', () => {
            const { director, reactions, launched } = rig({ quality: 'Extreme' });
            // Sixteen locks' worth in a single frame, each its own kite and its own row.
            const asked = Array.from({ length: 16 }, (_, index) => ({
                side: index % 2 ? 1 : -1, row: 0.5 + index * 0.03, strength: 0.5, kite: index % 7,
            }));
            asked.forEach((cue) => reactions.streak('lock', cue));
            director.apply(reactions.update(STEP), STEP, WIND);
            expect(launched).toHaveLength(16);
            launched.forEach((ribbon, index) => {
                expect(sameColour(ribbon.colour, KITE_TONES[asked[index].kite]), `ribbon ${index}`).toBe(true);
                expect(Math.sign(ribbon.heading.x)).toBe(asked[index].side);
            });
            // Lower rows first: in the order they were asked for.
            for (let index = 1; index < 16; index++) {
                expect(launched[index].origin.y).toBeGreaterThan(launched[index - 1].origin.y);
            }
            director.apply(reactions.update(STEP), STEP, WIND);
            expect(launched).toHaveLength(16);
            // The queue is a ring: two more reuse its two oldest slots, and only those two play.
            reactions.streak('lock', { side: -1, row: 0.9, kite: 5 });
            reactions.streak('lock', { side: 1, row: 0.95, kite: 6 });
            director.apply(reactions.update(STEP), STEP, WIND);
            expect(launched).toHaveLength(18);
            expect(sameColour(launched[16].colour, KITE_TONES[5])).toBe(true);
            expect(sameColour(launched[17].colour, KITE_TONES[6])).toBe(true);
        });

        it('draws the ribbons of every kind of event that lands in one frame', () => {
            const { director, reactions, launched } = rig({ quality: 'Extreme' });
            LETTERS.slice(0, 6).forEach((letter) => reactions.launch(VERDANT_HILLS_PIECE_KITES[letter]));
            reactions.onPieceLock({ piece: piece(LETTERS[6], 3, 12) });
            reactions.onTSpin({ piece: piece('T', 3, 12) });
            reactions.onLineClear(4, { clearedRows: [10, 11, 12, 13] });
            reactions.onPerfectClear();
            reactions.onLevelUp();
            const state = reactions.update(STEP);
            const cues = state.streaks.filter((streak) => streak.serial >= 0).sort((a, b) => a.serial - b.serial);
            expect(cues.map((cue) => cue.kind))
                .toEqual(['lock', 'festival', 'spin', 'clear', 'clear', 'great', 'great', 'great']);
            director.apply(state, STEP, WIND);
            // In the order they were asked for: the lock's own colour first, the festival's seven next.
            expect(sameColour(launched[0].colour, KITE_TONES[VERDANT_HILLS_PIECE_KITES[LETTERS[6]]])).toBe(true);
            launched.slice(1, 8).forEach((ribbon, slot) => {
                expect(sameColour(ribbon.colour, KITE_TONES[slot])).toBe(true);
            });
            expect(launched.length).toBeGreaterThan(8 + 2 + 2 + 2 + 2);
            const drawn = launched.length;
            director.apply(reactions.update(0), 0, WIND);
            expect(launched).toHaveLength(drawn);
        });

        it('ignores a cue of no strength or of a kind it does not know, and draws nothing with no ribbons', () => {
            const built = rig();
            built.director.apply(quiet({
                streaks: [{
                    serial: 0, kind: 'lock', side: 1, column: 0.9, row: 0.5, strength: 0, kite: 1,
                }, {
                    serial: 1, kind: 'earthquake', side: 1, column: 0.9, row: 0.5, strength: 1, kite: 1,
                }],
            }), STEP, WIND);
            expect(built.launched).toHaveLength(0);
            const bare = rig();
            bare.director.ribbons = null;
            bare.reactions.onPieceLock({ piece: piece('L') });
            bare.reactions.onLineClear(4, { clearedRows: [20] });
            bare.reactions.onCombo(5);
            expect(() => {
                for (let count = 0; count < 120; count++) bare.director.apply(bare.reactions.update(STEP), STEP, WIND);
            }).not.toThrow();
            expect(bare.launched).toHaveLength(0);
            expect(bare.thrown().length).toBeGreaterThan(50);
        });
    });

    describe('the breeze by itself', () => {
        it('shows itself now and then as one faint ribbon drifting down the wind', () => {
            const built = rig({ idle: true });
            for (let count = 0; count < 60 * 60; count++) {
                built.director.apply(quiet(), STEP, WIND);
                built.ribbons.update(STEP);
            }
            // A handful in a minute: a presence, not a show.
            expect(built.launched.length).toBeGreaterThanOrEqual(4);
            expect(built.launched.length).toBeLessThanOrEqual(24);
            for (const ribbon of built.launched) {
                expect(ribbon.heading.dot(WINDWARD)).toBeGreaterThan(0.7);
                expect(ribbon.strength).toBeLessThan(0.75);
                expect(isKiteColour(ribbon.colour)).toBe(false);
                const at = onScreen(built.camera, ribbon.origin);
                // Out over the hill on one side of the board or the other, in the open.
                expect(at.x).toBeGreaterThan(0);
                expect(at.x).toBeLessThan(1);
                expect(at.x < built.stage.board.x0 || at.x > built.stage.board.x1).toBe(true);
                expect(at.y).toBeGreaterThan(0);
                expect(at.y).toBeLessThan(1);
                expect(depthOf(built.stage, ribbon.origin)).toBeGreaterThan(VERDANT_HILLS_STAGE_DEPTH);
                expect(clearanceOf(ribbon.origin)).toBeGreaterThan(1);
            }
            // On both sides over time.
            const sides = new Set(built.launched
                .map((ribbon) => (onScreen(built.camera, ribbon.origin).x < 0.5 ? 'left' : 'right')));
            expect(sides.size).toBe(2);
        });

        it('keeps out of the way while the game has ribbons in the air, and stops when it is over', () => {
            const busy = rig({ idle: true });
            for (let count = 0; count < 60 * 30; count++) {
                // A clear's worth of ribbons kept flying.
                if (count % 60 === 0) {
                    for (let extra = 0; extra < 4; extra++) {
                        busy.ribbons.launch({
                            origin: new THREE.Vector3(0, 70, -10), heading: new THREE.Vector3(1, 0, 0), life: 2,
                        });
                    }
                }
                busy.director.apply(quiet(), STEP, WIND);
                busy.ribbons.update(STEP);
            }
            expect(busy.launched.filter((ribbon) => ribbon.life !== 2)).toHaveLength(0);
            const over = rig({ idle: true });
            for (let count = 0; count < 60 * 30; count++) {
                over.director.apply(quiet({ settled: true }), STEP, WIND);
                over.ribbons.update(STEP);
            }
            expect(over.launched).toHaveLength(0);
        });
    });

    describe('environment', () => {
        it('reports the wind it is given and the envelopes of the frame', () => {
            const { director } = rig();
            const blowing = { x: 3, z: -4, strength: 0.6 };
            const env = director.apply(quiet({ gust: 0.4, glow: 0.7, heat: 0.2 }), STEP, blowing);
            // A unit bearing, whatever length it came in.
            expect(env.windX).toBeCloseTo(0.6, 12);
            expect(env.windZ).toBeCloseTo(-0.8, 12);
            expect(env).toMatchObject({
                wind: 0.6, gust: 0.4, glow: 0.7, heat: 0.2, settled: false, front: null, pool: null,
            });
            expect(env.fields).toEqual([]);
            // A gust is a share; what is not a number is none.
            expect(director.apply(quiet({ gust: 9 }), STEP, WIND).gust).toBe(1);
            expect(director.apply(quiet({ gust: -9 }), STEP, WIND).gust).toBe(0);
            for (const junk of [NaN, Infinity, undefined, null, 'windy']) {
                const blank = director.apply(quiet({ gust: junk, glow: junk, heat: junk }), STEP, WIND);
                expect(blank).toMatchObject({ gust: 0, glow: 0, heat: 0 });
            }
            expect(director.apply(quiet(), STEP, { x: 1, z: 0, strength: NaN }).wind).toBeGreaterThan(0);
            // Only `true` is settled.
            expect(director.apply(quiet({ settled: true }), STEP, WIND).settled).toBe(true);
            for (const settled of ['true', 1, {}, null]) {
                expect(director.apply(quiet({ settled }), STEP, WIND).settled).toBe(false);
            }
            // With no wind told it takes the hills' own.
            const plain = director.apply(quiet(), STEP);
            expect(plain.windX).toBeCloseTo(WINDWARD.x, 3);
            expect(plain.windZ).toBeCloseTo(WINDWARD.z, 3);
        });

        it('reuses one environment object and one field list between frames', () => {
            const { director, reactions } = rig();
            const first = director.apply(quiet({ whirl: 0.5 }), STEP, WIND);
            const { fields } = first;
            expect(fields).toHaveLength(1);
            reactions.onLineClear(2, { clearedRows: [10, 11] });
            const second = director.apply(reactions.update(STEP), STEP, WIND);
            expect(second).toBe(first);
            expect(second.fields).toBe(fields);
            // The list is this frame's fields only.
            expect(fields.map((field) => field.kind).sort()).toEqual(['jet', 'jet']);
            expect(director.apply(quiet(), STEP, WIND).fields).toHaveLength(0);
            expect(director.fields).toBe(fields);
        });

        it('carries the valley\'s front from behind the lens far down the wind, widening as it goes', () => {
            const { director } = rig();
            const at = (position, strength = 0.8) => {
                const env = director.apply(quiet({ front: { position, direction: 1, strength } }), STEP, WIND);
                return env.front ? { ...env.front } : null;
            };
            let previous = null;
            for (let position = -1.4; position <= 1.4001; position += 0.05) {
                const front = at(position);
                expect(front.strength).toBe(0.8);
                if (previous) {
                    expect(front.along).toBeGreaterThan(previous.along);
                    expect(front.width).toBeGreaterThanOrEqual(previous.width);
                }
                previous = front;
            }
            const [start, middle, end] = [at(-1.4), at(0), at(1.4)];
            // It sets out upwind of the lens, so it arrives rather than appears ...
            expect(start.along).toBeLessThan(0);
            expect(start.width).toBeGreaterThan(0);
            // ... crosses the home hill slowly, and is away over the far side of the valley at the end.
            expect(middle.along - start.along).toBeLessThan((end.along - start.along) * 0.4);
            expect(end.along).toBeGreaterThan(800);
            expect(end.width).toBeGreaterThan(start.width * 3);
            // Beyond its range it stays at its ends.
            expect(at(-9)).toEqual(start);
            expect(at(9)).toEqual(end);
            // Too faint to see is no front.
            for (const strength of [0, 0.001, -1, NaN]) expect(at(0, strength)).toBeNull();
            expect(director.apply(quiet({ front: null }), STEP, WIND).front).toBeNull();
            expect(director.apply(quiet({ front: undefined }), STEP, WIND).front).toBeNull();
        });

        it('steers the pool of sunlight across the valley with the wind, and lets it widen', () => {
            const { director } = rig();
            const at = (progress, strength = 0.9) => {
                const env = director.apply(quiet({ sunbreak: { progress, strength } }), STEP, WIND);
                return env.pool ? { ...env.pool } : null;
            };
            let previous = null;
            for (let progress = 0; progress <= 1.0001; progress += 0.05) {
                const pool = at(progress);
                expect(pool.strength).toBe(0.9);
                expect(pool.radius).toBeGreaterThan(50);
                // Over the valley the lens looks into.
                expect(pool.x).toBeGreaterThan(VERDANT_HILLS_MAP_BOUNDS.minX);
                expect(pool.x).toBeLessThan(VERDANT_HILLS_MAP_BOUNDS.maxX);
                expect(pool.z).toBeGreaterThan(VERDANT_HILLS_MAP_BOUNDS.minZ);
                expect(pool.z).toBeLessThan(-100);
                if (previous) {
                    // Always further down the wind, never back.
                    const moved = (pool.x - previous.x) * WINDWARD.x + (pool.z - previous.z) * WINDWARD.z;
                    expect(moved).toBeGreaterThanOrEqual(0);
                    expect(pool.radius).toBeGreaterThanOrEqual(previous.radius);
                }
                previous = pool;
            }
            const [start, end] = [at(0), at(1)];
            const travelled = (end.x - start.x) * WINDWARD.x + (end.z - start.z) * WINDWARD.z;
            // Hundreds of metres: from one side of the picture to the other.
            expect(travelled).toBeGreaterThan(500);
            expect(end.x).toBeGreaterThan(start.x);
            expect(at(-3)).toEqual(start);
            expect(at(3)).toEqual(end);
            for (const strength of [0, 0.001, -1, NaN]) expect(at(0.5, strength)).toBeNull();
            expect(director.apply(quiet({ sunbreak: null }), STEP, WIND).pool).toBeNull();
        });

        it('gives the light rig a front and a pool it can take as they are', () => {
            const built = rig({ quality: 'Low' });
            const light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: seededRandom(5) });
            built.reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            let seen = 0;
            built.run(1.5, (env) => {
                light.update(1, { front: env.front, pool: env.pool });
                if (env.front) {
                    expect(light.uFront.value.x).toBe(env.front.along);
                    expect(light.uFront.value.z).toBe(env.front.width);
                    seen += 1;
                }
                if (env.pool) {
                    expect(light.uSunPool.value.x).toBe(env.pool.x);
                    expect(light.uSunPool.value.y).toBe(env.pool.z);
                    expect(light.uSunPool.value.z).toBe(env.pool.radius);
                }
                expect(light.uFront.value.toArray().every(Number.isFinite)).toBe(true);
                expect(light.uSunPool.value.toArray().every(Number.isFinite)).toBe(true);
            });
            expect(seen).toBeGreaterThan(30);
            light.dispose();
        });
    });

    describe('lifecycle and scale', () => {
        it('drops what is in flight on reset, and replays nothing the reactions still hold', () => {
            const built = rig();
            built.reactions.onHardDrop({ distance: 12 });
            built.reactions.onPieceLock({ piece: piece('I', 2, 20) });
            built.reactions.onLineClear(2, { clearedRows: [20, 21] });
            built.reactions.onCombo(4);
            const env = built.frame();
            expect(env.fields.length).toBeGreaterThan(0);
            const played = {
                ribbons: built.launched.filter((ribbon) => ribbon.loopAt !== 0).length,
                gusts: built.blown.mock.calls.length,
            };
            expect(played.ribbons).toBeGreaterThan(2);
            expect(played.gusts).toBeGreaterThan(1);
            built.director.reset();
            built.director.idleClock = Infinity;
            expect(built.director.fields).toHaveLength(0);
            // The cues are all still in the reactions' queues; the director knows it has played them.
            built.run(1);
            expect(built.launched.filter((ribbon) => ribbon.loopAt !== 0)).toHaveLength(played.ribbons);
            expect(built.blown).toHaveBeenCalledTimes(played.gusts);
            // What comes next plays as usual.
            built.reactions.onPieceLock({ piece: piece('O', 8, 20) });
            built.frame();
            expect(built.launched.filter((ribbon) => ribbon.loopAt !== 0)).toHaveLength(played.ribbons + 1);
            expect(built.blown).toHaveBeenCalledTimes(played.gusts + 1);
        });

        it('starts afresh when the reactions start over, and only then', () => {
            const built = rig();
            built.reactions.onPieceLock({ piece: piece('I', 2, 12) });
            built.reactions.onPieceLock({ piece: piece('J', 3, 12) });
            built.frame();
            expect(built.launched).toHaveLength(2);
            expect(built.blown).toHaveBeenCalledTimes(2);
            const seed = built.spawn.mock.calls.length;
            // A new session: serials begin again from nought, under a new epoch.
            built.reactions.reset();
            built.reactions.onPieceLock({ piece: piece('L', 7, 12) });
            const state = built.reactions.update(STEP);
            expect(state.streaks.find((streak) => streak.serial === 0)).toBeDefined();
            built.director.apply(state, STEP, WIND);
            expect(built.launched).toHaveLength(3);
            expect(sameColour(built.launched[2].colour, KITE_TONES[VERDANT_HILLS_PIECE_KITES.L])).toBe(true);
            expect(built.blown).toHaveBeenCalledTimes(3);
            expect(built.spawn.mock.calls.length).toBeGreaterThan(seed);
            // follow() with the epoch it already follows forgets nothing.
            built.director.follow(state.epoch);
            built.director.apply(built.reactions.update(STEP), STEP, WIND);
            expect(built.launched).toHaveLength(3);
            // Without a new epoch an old serial is an old cue, whatever it says.
            const stale = rig();
            const cue = (serial, kite) => quiet({
                streaks: [{
                    serial, kind: 'lock', side: 1, column: 0.9, row: 0.6, strength: 0.5, kite,
                }],
            });
            stale.director.apply(cue(5, 1), STEP, WIND);
            stale.director.apply(cue(2, 2), STEP, WIND);
            expect(stale.launched).toHaveLength(1);
            stale.director.apply({ ...cue(2, 2), epoch: 2 }, STEP, WIND);
            expect(stale.launched).toHaveLength(2);
        });

        it('treats a reused emitter slot with a new serial as a new event', () => {
            const { director, thrown } = rig();
            const emitter = (serial, age) => ({
                id: 3,
                serial,
                kind: 'lock',
                side: -1,
                column: 0.1,
                row: 0.6,
                strength: 0.5,
                lines: 0,
                kite: 0,
                age,
                duration: 1,
            });
            director.apply(quiet({ emitters: [emitter(7, 0)] }), STEP, WIND);
            const first = thrown().length;
            expect(first).toBeGreaterThan(5);
            director.apply(quiet({ emitters: [emitter(7, STEP)] }), STEP, WIND);
            expect(thrown()).toHaveLength(first);
            director.apply(quiet({ emitters: [emitter(8, 0)] }), STEP, WIND);
            expect(thrown()).toHaveLength(first * 2);
        });

        it('treats a timestep that is not a number as no time at all', () => {
            const built = rig({ idle: true });
            for (const dt of [NaN, undefined, null, 'x', -1, -Infinity]) {
                for (let count = 0; count < 400; count++) built.director.apply(quiet({ whirl: 0.8 }), dt, WIND);
            }
            // No seed is fed and no clock runs down: at most the first turn of the whirl is drawn.
            expect(built.thrown()).toHaveLength(0);
            expect(built.launched.length).toBeLessThanOrEqual(1);
            expect(() => built.director.apply(undefined, STEP, WIND)).not.toThrow();
            expect(() => built.director.apply({}, STEP)).not.toThrow();
        });

        it('scales every throw with the seed budget of the tier, down to a floor', () => {
            const counts = Object.fromEntries(TIERS.map((quality) => {
                const built = rig({ quality });
                built.reactions.onHardDrop({ distance: 14 });
                built.reactions.onPieceLock({ piece: piece('I', 2, 12) });
                built.reactions.onLineClear(4, { clearedRows: [10, 11, 12, 13] });
                built.reactions.onCombo(5);
                built.run(1.6);
                return [quality, built.thrown().length];
            }));
            // Dearer tiers throw more, in proportion to the pool they have.
            for (let index = 1; index < TIERS.length; index++) {
                const [dearer, cheaper] = [TIERS[index - 1], TIERS[index]];
                if (VERDANT_HILLS_TIERS[dearer].seeds > VERDANT_HILLS_TIERS[cheaper].seeds) {
                    expect(counts[dearer], `${dearer} against ${cheaper}`).toBeGreaterThan(counts[cheaper]);
                }
            }
            const ratio = counts.Extreme / counts.Medium;
            const pools = VERDANT_HILLS_TIERS.Extreme.seeds / VERDANT_HILLS_TIERS.Medium.seeds;
            expect(ratio).toBeGreaterThan(pools * 0.85);
            expect(ratio).toBeLessThan(pools * 1.15);
            // Even the cheapest tier answers every event with something to see.
            expect(counts.Minimal).toBeGreaterThan(60);
            // And no tier asks its pool for more than it holds in the air at once.
            for (const quality of TIERS) {
                expect(counts[quality]).toBeLessThan(VERDANT_HILLS_TIERS[quality].seeds * 0.86);
            }
            const tiny = new VerdantHillsFxDirector({
                stage: rig().stage, sim: null, ribbons: null, waves: null, tier: { seeds: 1 },
            });
            expect(tiny.scale).toBeGreaterThan(0.05);
            expect(tiny.scale).toBe(rig({ quality: 'Minimal' }).director.scale);
        });

        it('ignores frames and emitters it does not understand', () => {
            const { director, thrown, launched } = rig();
            const event = {
                column: 0.5, row: 0.5, strength: 1, lines: 2, age: 0, duration: 1,
            };
            const strange = [{
                ...event, id: 0, serial: 0, kind: 'earthquake', side: 1,
            }, {
                ...event, id: 1, serial: 1, kind: undefined, side: -1,
            }];
            expect(() => director.apply(quiet({ emitters: strange }), STEP, WIND)).not.toThrow();
            expect(thrown()).toHaveLength(0);
            expect(launched).toHaveLength(0);
            for (const frame of [{}, { emitters: null }, { waves: null, streaks: null }, { epoch: 4 }]) {
                expect(() => director.apply(frame, STEP, WIND), JSON.stringify(frame)).not.toThrow();
            }
            expect(director.apply({}, STEP, WIND).fields).toEqual([]);
        });

        it.each([
            ['NaN', () => NaN], ['nought', () => 0], ['one', () => 1], ['a negative', () => -4],
            ['infinity', () => Infinity], ['seven', () => 7],
        ])('keeps a random source that returns %s inside its range', (_label, rng) => {
            const built = rig({ rng, idle: true, quality: 'Low' });
            for (let count = 0; count < 50; count++) {
                const value = built.director.random();
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThan(1);
            }
            expect(['a', 'b', 'c']).toContain(built.director.pick(['a', 'b', 'c']));
            built.reactions.onHardDrop({ distance: 15 });
            built.reactions.onPieceLock({ piece: piece('S', 3, 20) });
            built.reactions.onTSpin({ piece: piece('T', 3, 12) });
            built.reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            built.reactions.onCombo(6);
            built.reactions.onPerfectClear();
            expect(() => built.run(2)).not.toThrow();
            expect(built.thrown().length).toBeGreaterThan(60);
            for (const particle of built.thrown()) {
                const numbers = [particle.x, particle.y, particle.z, particle.vx, particle.vy, particle.vz];
                if (![...numbers, particle.life, particle.size].every(Number.isFinite)) {
                    throw new Error(`seed ${JSON.stringify(particle)}`);
                }
                expect(clearanceOf(particle)).toBeGreaterThan(0.25);
            }
            expect(built.launched.length).toBeGreaterThan(10);
            for (const row of built.ribbons.rows) expect(row.toArray().every(Number.isFinite)).toBe(true);
            for (const ring of built.waves.rings) expect(ring.toArray().every(Number.isFinite)).toBe(true);
            for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz']) {
                for (const index of aloft(built.sim)) expect(Number.isFinite(built.sim[name][index])).toBe(true);
            }
        });

        it('works in the vectors it was built with', () => {
            const built = rig({ idle: true, quality: 'Low' });
            const {
                point, foot, heading, axis, windward, env, fields, front, pool,
            } = built.director;
            built.reactions.onPieceLock({ piece: piece('S', 3, 20) });
            built.reactions.onTSpin({ piece: piece('T', 3, 12) });
            built.reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            built.reactions.onCombo(6);
            built.reactions.onPerfectClear();
            built.run(2);
            expect(built.director).toMatchObject({
                point, foot, heading, axis, windward, env, fields, front, pool,
            });
            for (const [name, value] of Object.entries({
                point, foot, heading, axis, windward, env, fields, front, pool,
            })) expect(built.director[name], name).toBe(value);
        });
    });

    describe('a session on the real hills', () => {
        it.each([
            ['Low', LANDSCAPE], ['Minimal', LANDSCAPE], ['Low', PORTRAIT],
        ])('plays a busy stretch at %s (aspect %f) inside its pools, in the air and on screen', (quality, aspect) => {
            const built = rig({ quality, aspect, idle: true });
            const random = seededRandom(17);
            const peak = { seed: 0, ribbons: 0, gusts: 0 };
            const measure = () => {
                peak.seed = Math.max(peak.seed, built.sim.counts().live);
                peak.ribbons = Math.max(peak.ribbons, built.ribbons.active());
                peak.gusts = Math.max(peak.gusts, built.waves.active());
            };
            for (let event = 0; event < 20; event++) {
                const roll = random();
                const column = Math.floor(random() * 10);
                if (roll < 0.5) {
                    if (random() < 0.4) built.reactions.onHardDrop({ distance: 3 + random() * 17 });
                    const y = 12 + Math.floor(random() * 12);
                    built.reactions.onPieceLock({ piece: piece(LETTERS[event % 7], column, y) });
                    if (random() < 0.5) built.reactions.onLineClear(1 + (event % 4), { clearedRows: [22] });
                } else if (roll < 0.7) built.reactions.onCombo(2 + Math.floor(random() * 6));
                else if (roll < 0.8) built.reactions.onTSpin({ piece: piece('T', column, 14) });
                else if (roll < 0.9) built.reactions.onLevelUp();
                else built.reactions.onPerfectClear();
                built.run(0.5, measure);
            }
            expect(peak.seed).toBeGreaterThan(50);
            expect(peak.seed).toBeLessThanOrEqual(built.sim.reserve);
            expect(peak.ribbons).toBeGreaterThan(2);
            expect(peak.ribbons).toBeLessThanOrEqual(built.ribbons.count);
            expect(peak.gusts).toBeGreaterThan(0);
            expect(peak.gusts).toBeLessThanOrEqual(built.waves.count);
            for (const index of aloft(built.sim)) {
                for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz']) {
                    expect(Number.isFinite(built.sim[name][index])).toBe(true);
                }
                expect(built.sim.y[index]).toBeGreaterThanOrEqual(ground(built.sim.x[index], built.sim.z[index]));
            }
            for (const ring of built.waves.rings) {
                if (ring.w > 0) {
                    // Every gust is in the grass in front of the lens.
                    expect(new THREE.Vector3(ring.x, ground(ring.x, ring.y), ring.y).sub(built.stage.origin)
                        .dot(built.stage.forward)).toBeGreaterThan(0);
                }
            }
            // Most of what was drawn started where the screen could show it.
            const shown = built.launched.map((ribbon) => onScreen(built.camera, ribbon.origin))
                .filter((at) => at.ahead && at.x > -0.2 && at.x < 1.2 && at.y > -0.1 && at.y < 1.1);
            expect(shown.length / built.launched.length).toBeGreaterThan(0.95);
        });
    });
});
