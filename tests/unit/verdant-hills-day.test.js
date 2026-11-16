/**
 * Verdant Hills — what the living day adds: the rainbow and its colours, the sun's shafts, the
 * balloons, the fireflies and the stars of the afterglow, the mist of the morning, the meadow's
 * bloom, and how the game asks for each (docs/VERDANT_HILLS_KITE_DAY_OVERHAUL_2026-10.md, "The
 * living day").
 *
 * Relations, not tuning numbers: what must stay true while the look is free to change.
 */
import {
    afterEach, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    VERDANT_HILLS_BALLOONS, VERDANT_HILLS_BALLOON_EVERY, VERDANT_HILLS_BALLOON_LANES, VERDANT_HILLS_BALLOON_LIFE,
    VerdantHillsBalloons, verdantHillsBalloonPlace,
} from '../../src/themes/verdant-hills/verdant-hills-balloons.js';
import {
    VERDANT_HILLS_BOW_RANGE, VERDANT_HILLS_BOW_WIDTH, bakeVerdantHillsBow, verdantHillsBowAngle,
} from '../../src/themes/verdant-hills/verdant-hills-bow.js';
import { VERDANT_HILLS_VIEWS, verdantHillsEye } from '../../src/themes/verdant-hills/verdant-hills-composition.js';
import { VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_MOODS } from '../../src/themes/verdant-hills/verdant-hills-moods.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    VERDANT_HILLS_BOW_GREAT, VERDANT_HILLS_BOW_STANDING, VerdantHillsRainbow, verdantHillsBowAxis,
    verdantHillsBowDirection,
} from '../../src/themes/verdant-hills/verdant-hills-rainbow.js';
import {
    VERDANT_HILLS_BOW_SECONDS, VERDANT_HILLS_MIXED, VerdantHillsReactions,
} from '../../src/themes/verdant-hills/verdant-hills-reactions.js';
import { VERDANT_HILLS_SUNBEAMS, VerdantHillsSunbeams } from '../../src/themes/verdant-hills/verdant-hills-sunbeams.js';
import { wearVerdantHillsFrame } from '../../src/themes/verdant-hills/verdant-hills-surge.js';
import { verdantHillsGroundHeight } from '../../src/themes/verdant-hills/verdant-hills-terrain.js';
import { VERDANT_HILLS_PIECE_KITES } from '../../src/themes/verdant-hills/verdant-hills-tetrominos.js';
import { VerdantHillsWorld } from '../../src/themes/verdant-hills/verdant-hills-world.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { hasMaterialXNoise } from './helpers/materialx-noise.js';

const STEP = 1 / 60;
const DEG = Math.PI / 180;
const MOOD = Object.fromEntries(VERDANT_HILLS_MOODS.map((mood, index) => [mood.name, index]));
const owned = [];
afterEach(() => {
    while (owned.length) owned.pop().dispose();
});

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createLight(tier = 'Minimal') {
    const light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS[tier], rng: seededRandom(5) });
    owned.push(light);
    return light;
}

/** The hills without their asset pack, with a director of their own to play events on. */
function createWorld(quality = 'Minimal') {
    const world = new VerdantHillsWorld({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(46, 16 / 9, 0.3, 30000),
        quality,
        rng: seededRandom(1107),
        assets: null,
    }).build();
    owned.push(world);
    const reactions = new VerdantHillsReactions({ quality, rng: seededRandom(9) });
    let time = 0;
    /** Live the day on for `seconds`, the game's frames worn by the world. */
    const run = (seconds, each = null) => {
        const frames = Math.round(seconds / STEP);
        for (let i = 0; i < frames; i += 1) {
            time += STEP;
            reactions.update(STEP);
            world.update(time, STEP, reactions.getFrame());
            each?.(time);
        }
    };
    return {
        world, reactions, run, now: () => time,
    };
}

const piece = (letter, x = 4) => ({
    x, y: 20, shape: [[1]], shapeKey: letter,
});

/** The table's colour at an angle (degrees from the point opposite the sun). */
function bowAt(table, angle) {
    const [from, to] = VERDANT_HILLS_BOW_RANGE;
    const i = Math.max(0, Math.min(
        VERDANT_HILLS_BOW_WIDTH - 1,
        Math.round(((angle - from) / (to - from)) * VERDANT_HILLS_BOW_WIDTH - 0.5),
    ));
    return [table[i * 4], table[i * 4 + 1], table[i * 4 + 2], table[i * 4 + 3]];
}

describe('Verdant Hills rainbow: its colours', () => {
    const table = bakeVerdantHillsBow();

    it('puts the primary at 42 degrees and the secondary outside it, red toward each other', () => {
        const red = 1.331;
        const violet = 1.3445;
        // Water bends violet more: the primary's red is outermost, the secondary's innermost.
        expect(verdantHillsBowAngle(red, 1)).toBeGreaterThan(42);
        expect(verdantHillsBowAngle(red, 1)).toBeLessThan(42.8);
        expect(verdantHillsBowAngle(violet, 1)).toBeLessThan(verdantHillsBowAngle(red, 1));
        expect(verdantHillsBowAngle(red, 2)).toBeGreaterThan(50);
        expect(verdantHillsBowAngle(red, 2)).toBeLessThan(51);
        expect(verdantHillsBowAngle(violet, 2)).toBeGreaterThan(verdantHillsBowAngle(red, 2));
    });

    it('is finite, in range and no brighter than one anywhere', () => {
        expect(table).toHaveLength(VERDANT_HILLS_BOW_WIDTH * 4);
        let peak = 0;
        for (let i = 0; i < table.length; i += 1) {
            expect(Number.isFinite(table[i])).toBe(true);
            expect(table[i]).toBeGreaterThanOrEqual(0);
            expect(table[i]).toBeLessThanOrEqual(1.0001);
            if (i % 4 !== 3) peak = Math.max(peak, table[i]);
        }
        expect(peak).toBeGreaterThan(0.9);
    });

    it('runs red, yellow, green, blue from the outside of the primary inward', () => {
        const [r, g, b] = bowAt(table, 42.1);
        expect(r).toBeGreaterThan(0.7);
        expect(r).toBeGreaterThan(g * 1.4);
        expect(b).toBeLessThan(0.05);
        // Where red and green overlap the bow has its yellow: a three-wavelength bow has none.
        const yellow = bowAt(table, 41.6);
        expect(yellow[0]).toBeGreaterThan(0.45);
        expect(yellow[1]).toBeGreaterThan(0.6);
        expect(yellow[2]).toBeLessThan(0.3);
        const green = bowAt(table, 41.2);
        expect(green[1]).toBeGreaterThan(green[0]);
        const blue = bowAt(table, 40.6);
        expect(blue[2]).toBeGreaterThan(blue[0] * 2);
        expect(blue[2]).toBeGreaterThan(blue[1]);
    });

    it('draws the secondary the other way round, fainter, with a darker sky between the two', () => {
        const inner = bowAt(table, 50.8);
        const outer = bowAt(table, 53.2);
        expect(inner[0]).toBeGreaterThan(inner[2] * 3);
        expect(outer[2]).toBeGreaterThan(outer[0] * 3);
        expect(Math.max(...inner.slice(0, 3))).toBeLessThan(0.6);
        expect(Math.max(...inner.slice(0, 3))).toBeGreaterThan(0.2);
        // Between the bows: no light, and a little of the sky taken away.
        const between = bowAt(table, 46.5);
        expect(Math.max(...between.slice(0, 3))).toBeLessThan(0.01);
        expect(between[3]).toBeGreaterThan(0.08);
        expect(between[3]).toBeLessThan(0.3);
        // Nothing is taken away where the bows themselves are.
        expect(bowAt(table, 41.6)[3]).toBe(0);
        expect(bowAt(table, 51.5)[3]).toBe(0);
        // Inside the primary the sky is a little brighter, and less so further in.
        const just = bowAt(table, 39.4);
        const deep = bowAt(table, 36);
        expect(just[0]).toBeGreaterThan(deep[0]);
        expect(deep[0]).toBeLessThan(0.08);
    });
});

describe('Verdant Hills rainbow: where it stands', () => {
    it('is centred ahead of the lens and under the horizon, a low wide bow either side of the board', () => {
        const axis = verdantHillsBowAxis();
        expect(axis.length()).toBeCloseTo(1, 9);
        expect(axis.x).toBe(0);
        expect(axis.y).toBeLessThan(-0.4);
        expect(axis.z).toBeLessThan(0);
        // Its crown stands a few degrees over the far ridge, inside a 46-degree frame tipped 5 down.
        const crown = verdantHillsBowDirection(42, 0);
        const lift = Math.asin(crown.y) / DEG;
        expect(lift).toBeGreaterThan(3);
        expect(lift).toBeLessThan(12);
        // Each foot meets the horizon inside the side thirds of a 16:9 frame: wider than the
        // board card (about ten degrees either side), narrower than the frame (thirty-seven).
        for (const side of [-1, 1]) {
            let foot = null;
            for (let around = 0; around <= 110 && !foot; around += 0.25) {
                const d = verdantHillsBowDirection(42, side * around);
                if (d.y <= 0) foot = d;
            }
            const bearing = Math.atan2(foot.x, -foot.z) / DEG;
            expect(Math.sign(bearing)).toBe(side);
            expect(Math.abs(bearing)).toBeGreaterThan(14);
            expect(Math.abs(bearing)).toBeLessThan(34);
        }
    });

    it('stands faint for the weather, draws a great one for a perfect clear, and folds away for neither', () => {
        const eye = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);
        const bow = new VerdantHillsRainbow({ light: createLight(), eye }).build();
        owned.push(bow);
        bow.update(0, null);
        expect(bow.strength).toBe(0);
        expect(bow.uBow.value.x + bow.uBow.value.y).toBe(0);
        bow.update(1, null);
        expect(bow.strength).toBe(VERDANT_HILLS_BOW_STANDING);
        expect(bow.uBow.value.y).toBe(0);
        // A great bow is the brighter, and over a standing one it adds only what is missing.
        bow.update(0, { strength: 1, drawn: 0.5 });
        expect(bow.strength).toBe(VERDANT_HILLS_BOW_GREAT);
        expect(bow.uBow.value.toArray()).toEqual([0, VERDANT_HILLS_BOW_GREAT, 0.5]);
        bow.update(1, { strength: 1, drawn: 1 });
        expect(bow.strength).toBeCloseTo(VERDANT_HILLS_BOW_GREAT, 9);
        expect(bow.uBow.value.x).toBe(VERDANT_HILLS_BOW_STANDING);
        expect(VERDANT_HILLS_BOW_GREAT).toBeGreaterThan(VERDANT_HILLS_BOW_STANDING * 2);
        for (const nonsense of [NaN, -3, Infinity, 'x']) {
            bow.update(nonsense, { strength: nonsense, drawn: nonsense });
            expect(Number.isFinite(bow.strength)).toBe(true);
            expect(bow.uBow.value.toArray().every(Number.isFinite)).toBe(true);
        }
        // Its band reaches the eye's whole frame: every vertex stands at the rain's distance.
        const position = bow.geometry.getAttribute('position');
        const lens = new THREE.Vector3(...eye);
        const at = new THREE.Vector3();
        for (let i = 0; i < position.count; i += 7) {
            at.fromBufferAttribute(position, i);
            expect(at.distanceTo(lens)).toBeGreaterThan(1500);
        }
    });
});

describe('Verdant Hills balloons', () => {
    const ground = verdantHillsGroundHeight;
    const eye = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);

    it('fills on its field, lifts, drifts away and is gone at the end of its life', () => {
        const at = new THREE.Vector3();
        for (let flight = 0; flight < 12; flight += 1) {
            const [fx, fz] = VERDANT_HILLS_BALLOON_LANES[flight % 2].field;
            expect(verdantHillsBalloonPlace(flight, -1, ground, at)).toBe(0);
            expect(verdantHillsBalloonPlace(flight, 0, ground, at)).toBe(0);
            // Still on the grass of its field while it fills.
            const small = verdantHillsBalloonPlace(flight, 2, ground, at);
            expect(small).toBeGreaterThan(0);
            expect(small).toBeLessThan(0.5);
            expect(Math.hypot(at.x - fx, at.z - fz)).toBeLessThan(60);
            expect(at.y - ground(at.x, at.z)).toBeLessThan(8);
            // A minute on it is whole, high over the valley and on its way.
            expect(verdantHillsBalloonPlace(flight, 60, ground, at)).toBe(1);
            const early = at.clone();
            expect(early.y - ground(early.x, early.z)).toBeGreaterThan(60);
            verdantHillsBalloonPlace(flight, 300, ground, at);
            expect(Math.hypot(at.x - fx, at.z - fz)).toBeGreaterThan(Math.hypot(early.x - fx, early.z - fz) + 150);
            // Never down among the hills.
            for (let age = 30; age < VERDANT_HILLS_BALLOON_LIFE; age += 10) {
                verdantHillsBalloonPlace(flight, age, ground, at);
                expect(at.y - ground(at.x, at.z), `flight ${flight} age ${age}`).toBeGreaterThan(40);
            }
            expect(verdantHillsBalloonPlace(flight, VERDANT_HILLS_BALLOON_LIFE, ground, at)).toBe(0);
            expect(verdantHillsBalloonPlace(flight, VERDANT_HILLS_BALLOON_LIFE - 3, ground, at)).toBeLessThan(0.1);
        }
    });

    it('never drifts behind the board: each lane keeps to its own side of the frame', () => {
        const at = new THREE.Vector3();
        for (let flight = 0; flight < 14; flight += 1) {
            const side = flight % 2 === 0 ? -1 : 1;
            for (let age = 0; age < VERDANT_HILLS_BALLOON_LIFE; age += 5) {
                verdantHillsBalloonPlace(flight, age, ground, at);
                const bearing = Math.atan2(at.x - eye[0], -(at.z - eye[2])) / DEG;
                // Clear of the card's edge (about ten degrees) and inside a 16:9 frame (thirty-seven).
                expect(bearing * side, `flight ${flight} age ${age}`).toBeGreaterThan(11);
                expect(bearing * side, `flight ${flight} age ${age}`).toBeLessThan(36);
            }
        }
    });

    it('keeps the sky supplied by the clock, and lets every new level add one of its own', () => {
        const balloons = new VerdantHillsBalloons({ light: createLight(), groundHeight: ground }).build();
        owned.push(balloons);
        // With no game at all there is always a balloon or two in the air.
        for (let time = 0; time < 1500; time += 37) {
            balloons.update(time);
            expect(balloons.aloft, `at ${time}`).toBeGreaterThanOrEqual(2);
            expect(balloons.aloft).toBeLessThanOrEqual(3);
        }
        expect(VERDANT_HILLS_BALLOON_LIFE).toBeGreaterThan(VERDANT_HILLS_BALLOON_EVERY * 2);
        balloons.update(100);
        const before = balloons.aloft;
        balloons.launch(100);
        balloons.launch(101);
        balloons.update(110);
        expect(balloons.aloft).toBe(before + 2);
        // More levels than there are slots: the oldest of them makes room.
        for (let n = 0; n < 9; n += 1) balloons.launch(112 + n);
        balloons.update(140);
        expect(balloons.aloft).toBeLessThanOrEqual(VERDANT_HILLS_BALLOONS);
        expect(balloons.launches.length).toBeLessThanOrEqual(VERDANT_HILLS_BALLOONS);
        // A level's balloons take both lanes in turn.
        const lanes = new Set(balloons.launches.map((launch) => launch.flight % 2));
        expect(lanes.size).toBe(2);
        balloons.reset();
        balloons.update(140);
        expect(balloons.launches).toHaveLength(0);
        expect(balloons.aloft).toBeLessThanOrEqual(3);
    });

    it('fires the burners with play, and by itself only as dusk comes', () => {
        const balloons = new VerdantHillsBalloons({ light: createLight(), groundHeight: ground }).build();
        owned.push(balloons);
        const burners = () => [0, 1, 2, 3, 4, 5, 6].map((slot) => balloons.rows[slot * 3 + 1].w)
            .filter((_, slot) => balloons.rows[slot * 3].w > 0);
        // By day, long after lift-off, the flame is small; play fires every burner at once.
        let day = 0;
        let dusk = 0;
        for (let time = 200; time < 260; time += 0.5) {
            balloons.update(time, { burn: 0, night: 0 });
            day = Math.max(day, ...burners());
            balloons.update(time, { burn: 0, night: 1 });
            dusk = Math.max(dusk, ...burners());
        }
        expect(day).toBeLessThan(0.3);
        expect(dusk).toBeGreaterThan(0.8);
        balloons.update(230, { burn: 1, night: 0 });
        expect(burners().length).toBeGreaterThan(0);
        expect(burners().every((level) => level === 1)).toBe(true);
        balloons.update(230, { burn: NaN, night: NaN });
        expect(burners().every(Number.isFinite)).toBe(true);
    });
});

describe('Verdant Hills sunbeams', () => {
    const stage = { right: new THREE.Vector3(1, 0, 0), forward: new THREE.Vector3(0, 0, -1) };

    it('stands the great shaft and its fingers on the pool of light, and none without one', () => {
        const beams = new VerdantHillsSunbeams({ light: createLight(), groundHeight: verdantHillsGroundHeight });
        beams.build();
        owned.push(beams);
        beams.update(null, stage, 0, null);
        expect(beams.live).toBe(0);
        expect(beams.rows.filter((_, i) => i % 2 === 0).every((row) => row.w === 0)).toBe(true);
        const pool = {
            x: -260, z: -430, radius: 130, strength: 0.8,
        };
        beams.update(pool, stage, 0, null);
        expect(beams.live).toBe(5);
        const feet = [0, 1, 2, 3, 4].map((i) => beams.rows[i * 2]);
        // The middle one stands on the pool and is the brightest and the widest.
        expect(feet[0].x).toBeCloseTo(pool.x, 6);
        expect(feet[0].z).toBeCloseTo(pool.z, 6);
        expect(feet[0].w).toBeCloseTo(0.8, 6);
        for (const [i, foot] of feet.entries()) {
            expect(foot.y).toBeCloseTo(verdantHillsGroundHeight(foot.x, foot.z), 6);
            expect(Math.hypot(foot.x - pool.x, foot.z - pool.z)).toBeLessThan(pool.radius * 1.3);
            if (i > 0) {
                expect(foot.w).toBeLessThan(feet[0].w);
                expect(beams.rows[i * 2 + 1].x).toBeLessThan(beams.rows[1].x);
            }
        }
        // A pool with no light in it, or no stage to stand on, stands nothing.
        beams.update({ ...pool, strength: 0 }, stage, 0, null);
        expect(beams.live).toBe(0);
        beams.update(pool, null, 0, null);
        expect(beams.live).toBe(0);
    });

    it('stands the weather\'s shafts in the valley and lets them ride down the wind with the clouds', () => {
        const light = createLight();
        const beams = new VerdantHillsSunbeams({ light, groundHeight: verdantHillsGroundHeight }).build();
        owned.push(beams);
        beams.update(null, stage, 1, { x: 0, z: 0 });
        expect(beams.live).toBe(VERDANT_HILLS_SUNBEAMS - 5);
        const first = beams.rows.slice(10).filter((_, i) => i % 2 === 0).map((row) => row.clone());
        const wind = light.uWindDir.value;
        beams.update(null, stage, 1, { x: wind.x * 40, z: wind.z * 40 });
        const later = beams.rows.slice(10).filter((_, i) => i % 2 === 0).map((row) => row.clone());
        let rode = 0;
        later.forEach((row, i) => {
            const moved = (row.x - first[i].x) * wind.x + (row.z - first[i].z) * wind.z;
            // Forty metres down the wind, or round again from the far end of its ride.
            if (Math.abs(moved - 40) < 0.01) rode += 1;
            // Out over the valley, never on the home hill.
            expect(Math.hypot(row.x, row.z)).toBeGreaterThan(250);
            expect(row.w).toBeGreaterThanOrEqual(0);
            expect(row.w).toBeLessThan(0.6);
        });
        expect(rode).toBeGreaterThanOrEqual(later.length - 1);
        // Half as much weather, half as much light.
        beams.update(null, stage, 0.5, { x: wind.x * 40, z: wind.z * 40 });
        beams.rows.slice(10).filter((_, i) => i % 2 === 0).forEach((row, i) => {
            expect(row.w).toBeCloseTo(later[i].w * 0.5 || 0, 9);
        });
        beams.reset();
        expect(beams.live).toBe(0);
    });
});

describe('Verdant Hills reactions: what the living day hears', () => {
    const create = () => new VerdantHillsReactions({ quality: 'High', rng: seededRandom(3) });
    const advance = (reactions, seconds) => {
        for (let i = 0; i < Math.round(seconds / STEP); i += 1) reactions.update(STEP);
        return reactions.getFrame();
    };

    it('draws a rainbow across the sky for a perfect clear, stands it and lets it fade', () => {
        const reactions = create();
        expect(reactions.getFrame().bow).toBeNull();
        reactions.onPerfectClear();
        const { draw, stand, fade } = VERDANT_HILLS_BOW_SECONDS;
        let last = 0;
        // Drawn from one foot to the other, never back.
        for (let i = 0; i < Math.round(draw / STEP); i += 1) {
            reactions.update(STEP);
            const { bow } = reactions.getFrame();
            expect(bow.drawn).toBeGreaterThanOrEqual(last);
            last = bow.drawn;
        }
        expect(last).toBeGreaterThan(0.99);
        const standing = advance(reactions, stand * 0.5).bow;
        expect(standing).toEqual({ strength: 1, drawn: 1 });
        // A second perfect clear keeps the bow that stands: it is not drawn again.
        reactions.onPerfectClear();
        expect(reactions.getFrame().bow.drawn).toBe(1);
        const kept = advance(reactions, stand * 0.9).bow;
        expect(kept.strength).toBe(1);
        const fading = advance(reactions, stand * 0.1 + fade * 0.5).bow;
        expect(fading.strength).toBeGreaterThan(0);
        expect(fading.strength).toBeLessThan(1);
        expect(advance(reactions, fade).bow).toBeNull();
    });

    it('lets go of the bow when the game ends, and forgets it on reset', () => {
        const reactions = create();
        reactions.onPerfectClear();
        advance(reactions, 3);
        reactions.onGameOver();
        const { bow } = advance(reactions, 1);
        expect(bow.strength).toBeLessThan(1);
        expect(advance(reactions, VERDANT_HILLS_BOW_SECONDS.fade).bow).toBeNull();
        reactions.onPerfectClear();
        reactions.reset();
        expect(reactions.getFrame().bow).toBeNull();
    });

    it('asks the meadow to bloom in the kite colour of the piece that cleared three lines or four', () => {
        const live = (frame) => frame.blooms.filter((bloom) => bloom.serial >= 0);
        for (const lines of [1, 2]) {
            const reactions = create();
            reactions.onPieceLock({ piece: piece('S', 2) });
            reactions.onLineClear(lines, { clearedRows: [22] });
            expect(live(reactions.getFrame())).toEqual([]);
        }
        for (const [letter, column] of [['I', 1], ['S', 7], ['L', 4]]) {
            const reactions = create();
            reactions.onPieceLock({ piece: piece(letter, column) });
            reactions.onLineClear(3, { clearedRows: [21, 22, 23] });
            const [bloom] = live(reactions.getFrame());
            expect(bloom.kite).toBe(VERDANT_HILLS_PIECE_KITES[letter]);
            expect(bloom.column).toBeCloseTo((column + 0.5) / 10, 6);
            expect(bloom.strength).toBeGreaterThan(0.5);
            reactions.onPieceLock({ piece: piece('O', 5) });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            const blooms = live(reactions.getFrame());
            expect(blooms).toHaveLength(2);
            expect(blooms[1].serial).toBe(blooms[0].serial + 1);
            expect(blooms[1].kite).toBe(VERDANT_HILLS_PIECE_KITES.O);
            expect(blooms[1].strength).toBeGreaterThanOrEqual(blooms[0].strength);
        }
        // A perfect clear blooms the whole meadow in the flowers' own gold.
        const reactions = create();
        reactions.onPerfectClear();
        expect(live(reactions.getFrame())[0].kite).toBe(VERDANT_HILLS_MIXED);
    });

    it('lets a balloon go for every new level and fires the burners with every clear', () => {
        const reactions = create();
        expect(reactions.getFrame().balloons).toBe(0);
        reactions.onLevelUp();
        reactions.onLevelUp();
        expect(reactions.getFrame().balloons).toBe(2);
        expect(reactions.getFrame().burn).toBeGreaterThan(0.8);
        expect(advance(reactions, 6).burn).toBeLessThan(0.01);
        let last = 0;
        for (const lines of [1, 2, 3, 4]) {
            const fresh = create();
            fresh.onLineClear(lines, { clearedRows: [22] });
            const { burn } = fresh.getFrame();
            expect(burn).toBeGreaterThan(last);
            last = burn;
        }
        // The count starts over with the session.
        reactions.reset();
        expect(reactions.getFrame().balloons).toBe(0);
        // And the world wears all of it: a fever keeps the burners going.
        const worn = wearVerdantHillsFrame({
            surge: {
                level: 1, fever: 1, stage: 3, punch: 0,
            },
            balloons: 3,
        });
        expect(worn.burn).toBeGreaterThan(0.2);
        expect(worn.balloons).toBe(3);
        expect(worn.bow).toBeNull();
        expect(wearVerdantHillsFrame({}).balloons).toBe(0);
    });
});

describe('Verdant Hills: the living day in the world', () => {
    it('stands a rainbow after the rain and nowhere else, and draws a greater one for a perfect clear', () => {
        const { world, reactions, run } = createWorld();
        run(0.1);
        expect(world.rainbow.strength).toBe(0);
        VERDANT_HILLS_MOODS.forEach((mood, index) => {
            world.setLevel(index + 1, { silent: true });
            run(0.05);
            if (mood.name === 'after the rain') expect(world.rainbow.strength).toBeGreaterThan(0.2);
            else expect(world.rainbow.strength, mood.name).toBe(0);
        });
        world.setLevel(1, { silent: true });
        reactions.onPerfectClear();
        run(VERDANT_HILLS_BOW_SECONDS.draw + 1);
        expect(world.rainbow.strength).toBe(VERDANT_HILLS_BOW_GREAT);
        expect(world.rainbow.uBow.value.z).toBe(1);
        expect(world.getDiagnostics().bow).toBe(VERDANT_HILLS_BOW_GREAT);
        const { stand, fade } = VERDANT_HILLS_BOW_SECONDS;
        run(stand + fade + 1);
        expect(world.rainbow.strength).toBe(0);
    });

    it('brings on the night only in the afterglow, the mist only in the morning, the shafts with the storm', () => {
        const { world, run } = createWorld();
        const { light } = world;
        const at = (name) => {
            world.setLevel(MOOD[name] + 1, { silent: true });
            run(0.05);
            return {
                night: light.uNight.value,
                mist: light.uMist.value,
                beams: light.uBeams.value,
                shafts: world.sunbeams.live,
            };
        };
        for (const mood of VERDANT_HILLS_MOODS) {
            const seen = at(mood.name);
            expect(seen.night, mood.name).toBe(mood.name === 'afterglow' ? 1 : 0);
            expect(seen.mist, mood.name).toBe(mood.name === 'morning mist' ? 1 : 0);
            if (mood.beams > 0) expect(seen.shafts, mood.name).toBeGreaterThan(0);
            else expect(seen.shafts, mood.name).toBe(0);
        }
        expect(at('storm light').beams).toBe(1);
        // The day opens bright: none of the three.
        expect(at('kite day')).toEqual({
            night: 0, mist: 0, beams: 0, shafts: 0,
        });
    });

    it('opens the clouds over the near valley on four lines and stands the sun\'s shaft in the gap', () => {
        const { world, reactions, run } = createWorld();
        run(0.1);
        expect(world.sunbeams.live).toBe(0);
        reactions.onPieceLock({ piece: piece('T') });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        let lit = 0;
        const eye = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);
        const xs = [];
        run(5.5, () => {
            const pool = world.light.uSunPool.value;
            if (pool.w > 0.2) {
                lit += 1;
                expect(world.sunbeams.live).toBe(5);
                // Near enough to read as a pool of light: this side of the far ridges.
                expect(Math.hypot(pool.x - eye[0], pool.y - eye[2])).toBeLessThan(700);
                expect(world.sunbeams.rows[0].x).toBeCloseTo(pool.x, 4);
                xs.push(pool.x);
            }
        });
        expect(lit).toBeGreaterThan(120);
        // From left of the board to right of it.
        expect(xs[0]).toBeLessThan(-100);
        expect(xs.at(-1)).toBeGreaterThan(100);
        run(4);
        expect(world.sunbeams.live).toBe(0);
    });

    it('sends the bloom out through the meadow from the foot of the board, in the piece\'s colour', () => {
        const { world, reactions, run } = createWorld();
        run(0.1);
        const wave = world.light.uBloomWave.value;
        expect(wave.w).toBe(0);
        reactions.onPieceLock({ piece: piece('I', 7) });
        reactions.onLineClear(3, { clearedRows: [21, 22, 23] });
        run(0.5);
        expect(wave.w).toBeGreaterThan(0.5);
        expect(wave.z).toBeCloseTo(0.5, 1);
        // On the home hill, in front of the lens.
        expect(Math.hypot(wave.x, wave.y)).toBeLessThan(30);
        expect(wave.y).toBeLessThan(0);
        // Poppy red: the I's kite.
        const tone = world.light.uBloomTone.value;
        expect(tone.r).toBeGreaterThan(tone.g * 3);
        expect(tone.r).toBeGreaterThan(tone.b * 3);
        run(14);
        expect(wave.w).toBe(0);
        // A reset takes it back at once.
        reactions.onPieceLock({ piece: piece('I', 7) });
        reactions.onLineClear(3, { clearedRows: [21, 22, 23] });
        run(0.2);
        expect(wave.w).toBeGreaterThan(0);
        world.resetEffects();
        expect(wave.w).toBe(0);
    });

    it('launches a balloon for each new level, once, and starts again with a new run of the reactions', () => {
        const { world, reactions, run } = createWorld();
        run(0.1);
        const clock = world.balloons.aloft;
        expect(clock).toBeGreaterThanOrEqual(2);
        reactions.onLevelUp();
        run(10);
        expect(world.balloons.launches).toHaveLength(1);
        expect(world.balloons.aloft).toBe(clock + 1);
        expect(world.getDiagnostics().balloons).toBe(clock + 1);
        run(5);
        expect(world.balloons.launches).toHaveLength(1);
        reactions.onLevelUp();
        reactions.onLevelUp();
        run(1);
        expect(world.balloons.launches).toHaveLength(3);
        // The reactions start over (a new session): the balloons already up stay up, and the next
        // level still launches exactly one.
        reactions.reset();
        run(1);
        expect(world.balloons.launches).toHaveLength(3);
        reactions.onLevelUp();
        run(1);
        expect(world.balloons.launches).toHaveLength(4);
        // A replay begins from an empty sky of its own.
        world.rewind();
        expect(world.balloons.launches).toHaveLength(0);
    });

    it('lights the fireflies on every tier and releases every part it made', () => {
        for (const quality of ['Minimal', 'High']) {
            const { world, run } = createWorld(quality);
            run(0.05);
            const diagnostics = world.getDiagnostics();
            expect(diagnostics.fireflies).toBeGreaterThan(40);
            expect(world.group.getObjectByName('VerdantHillsRainbow')).toBeTruthy();
            expect(world.group.getObjectByName('VerdantHillsSunbeams')).toBeTruthy();
            expect(world.group.getObjectByName('VerdantHillsBalloons')).toBeTruthy();
            expect(world.group.getObjectByName('VerdantHillsFireflies')).toBeTruthy();
            world.dispose();
            expect(world.rainbow).toBeNull();
            expect(world.sunbeams).toBeNull();
            expect(world.balloons).toBeNull();
            expect(world.fireflies).toBeNull();
            expect(world.group.children).toHaveLength(0);
        }
    }, 30000);
});

describe('Verdant Hills: the living day\'s shaders', () => {
    const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
    // The flowers and the ground read the oak's static shadow map, and the stub renderer has
    // none: its node writes nothing there and the builder says so, once (it does on the day
    // before this pass too). Everything else must build without a word.
    const SHADOWED = ['flowers', 'ground'];
    const NO_SHADOW_MAP = /Invalid generated code, expected a "float"/;

    it.each(['Minimal', 'High'])('builds every new part for both backends without a word (%s)', (quality) => {
        const { world, run } = createWorld(quality);
        run(0.05);
        const flower = world.meadow.group.children.find((child) => child.name.startsWith('VerdantHillsFlower'));
        const parts = {
            rainbow: world.rainbow.mesh,
            sunbeams: world.sunbeams.mesh,
            balloons: world.balloons.mesh,
            fireflies: world.fireflies.mesh,
            sky: world.sky.dome,
            flowers: flower,
            ground: world.terrain.mesh,
        };
        for (const [name, mesh] of Object.entries(parts)) {
            expect(mesh, name).toBeTruthy();
            for (const [backend, Builder] of BACKENDS) {
                const built = build(Builder, mesh);
                const label = `${name} ${backend}`;
                expect(built.thrown, label).toBeUndefined();
                const heard = SHADOWED.includes(name)
                    ? built.heard.filter((line) => !NO_SHADOW_MAP.test(line)) : built.heard;
                expect(heard, label).toEqual([]);
                for (const stage of [built.vertex, built.fragment]) {
                    expect(stage.length, label).toBeGreaterThan(200);
                    expect(stage, label).not.toMatch(/\bNaN\b|object Object|undefined/);
                    expect(hasMaterialXNoise(stage), label).toBe(false);
                }
                // The stars sit behind a branch on the night: nothing they make is read outside it.
                if (backend === 'WGSL') expect(unassignedReads(built.fragment), label).toEqual([]);
            }
        }
    }, 60000);
});
