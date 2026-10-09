import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    verdantHillsEye, verdantHillsInSight, verdantHillsTarget, verdantHillsViewFor,
} from '../../src/themes/verdant-hills/verdant-hills-composition.js';
import {
    VERDANT_HILLS_KITE_STATIONS, VERDANT_HILLS_POST_HEIGHT, VerdantHillsKites, verdantHillsKitePlace,
} from '../../src/themes/verdant-hills/verdant-hills-kites.js';
import { VERDANT_HILLS_WIND_DIRECTION, VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import { VERDANT_HILLS_KITES } from '../../src/themes/verdant-hills/verdant-hills-reactions.js';
import { VERDANT_HILLS_DEFAULT_BOARD } from '../../src/themes/verdant-hills/verdant-hills-stage.js';
import {
    VERDANT_HILLS_CROWN, VERDANT_HILLS_WATER_LEVEL, verdantHillsGroundHeight, verdantHillsWaterDistance,
} from '../../src/themes/verdant-hills/verdant-hills-terrain.js';
import {
    VERDANT_HILLS_KITE_COLOURS, VERDANT_HILLS_PIECE_KITES,
} from '../../src/themes/verdant-hills/verdant-hills-tetrominos.js';

vi.setConfig({ testTimeout: 30000 });

const LANDSCAPE = 16 / 9;
const STEP = 1 / 60;
/** Rows of the uniform array that describe one kite. */
const ROWS = 6;
const SLOTS = VERDANT_HILLS_KITE_STATIONS.map((_, slot) => slot);
const HEIGHTS = [0, 0.5, 1];
const WINDS = [0, 1];
const ALL_UP = SLOTS.map(() => 1);
const ground = verdantHillsGroundHeight;
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

/** Where a world point falls on the screen: fractions, y down, as the board card is measured. */
function onScreen(camera, point, scratch = new THREE.Vector3()) {
    scratch.copy(point).project(camera);
    return { x: (scratch.x + 1) / 2, y: (1 - scratch.y) / 2, ahead: scratch.z < 1 };
}

/** Top of the post a kite is tied to. */
function postOf(slot) {
    const [x, z] = VERDANT_HILLS_KITE_STATIONS[slot].post;
    return new THREE.Vector3(x, ground(x, z) + VERDANT_HILLS_POST_HEIGHT, z);
}

/** Every place a kite stands in over a minute, for a height and a wind. */
function flight(slot, options, each, seconds = 60, stride = 0.05) {
    const place = new THREE.Vector3();
    for (let time = 0; time <= seconds; time += stride) each(verdantHillsKitePlace(slot, time, options, place), time);
}

/** Where a kite's sail centre goes on a 16:9 screen with all its line out, by height and wind. */
function screenRange(camera, slot) {
    const range = {
        minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, samples: 0, behindBoard: 0, lowest: {},
    };
    const board = VERDANT_HILLS_DEFAULT_BOARD;
    const scratch = new THREE.Vector3();
    for (const height of HEIGHTS) {
        range.lowest[height] = -Infinity;
        for (const wind of WINDS) {
            flight(slot, { fly: 1, height, wind }, (place) => {
                const at = onScreen(camera, place, scratch);
                if (!at.ahead) throw new Error(`kite ${slot} is behind the lens`);
                range.minX = Math.min(range.minX, at.x);
                range.maxX = Math.max(range.maxX, at.x);
                range.minY = Math.min(range.minY, at.y);
                range.maxY = Math.max(range.maxY, at.y);
                range.lowest[height] = Math.max(range.lowest[height], at.y);
                range.samples += 1;
                if (at.x > board.x0 && at.x < board.x1 && at.y > board.y0 && at.y < board.y1) range.behindBoard += 1;
            });
        }
    }
    return range;
}

describe('Verdant Hills kite stations', () => {
    it('ties one kite to a post for each of the seven pieces', () => {
        expect(Object.isFrozen(VERDANT_HILLS_KITE_STATIONS)).toBe(true);
        expect(VERDANT_HILLS_KITE_STATIONS).toHaveLength(VERDANT_HILLS_KITES);
        expect(VERDANT_HILLS_KITE_STATIONS).toHaveLength(VERDANT_HILLS_KITE_COLOURS.length);
        expect(Object.values(VERDANT_HILLS_PIECE_KITES).sort()).toEqual(SLOTS);
        expect(VERDANT_HILLS_POST_HEIGHT).toBeGreaterThan(0.5);
        expect(VERDANT_HILLS_POST_HEIGHT).toBeLessThan(3);
        for (const station of VERDANT_HILLS_KITE_STATIONS) {
            expect(station.post).toHaveLength(2);
            expect(station.line).toBeGreaterThan(10);
            expect(station.size).toBeGreaterThan(1);
            // A kite, not a zeppelin: its sail is a small part of its line.
            expect(station.size).toBeLessThan(station.line / 4);
            expect(Math.abs(station.off)).toBeLessThan(45);
        }
        // No two share a post.
        expect(new Set(VERDANT_HILLS_KITE_STATIONS.map(({ post }) => post.join())).size).toBe(VERDANT_HILLS_KITES);
    });

    it('stands every post on the home hill in front of the lens, dry and in its sight', () => {
        let left = 0;
        let right = 0;
        for (const { post: [x, z] } of VERDANT_HILLS_KITE_STATIONS) {
            const foot = ground(x, z);
            expect(z).toBeLessThan(-10);
            expect(Math.hypot(x, z)).toBeLessThan(110);
            // On a spur of the hill, well above the valley.
            expect(foot).toBeLessThan(VERDANT_HILLS_CROWN);
            expect(foot).toBeGreaterThan(VERDANT_HILLS_WATER_LEVEL + 30);
            expect(verdantHillsWaterDistance(x, z)).toBeGreaterThan(100);
            // Its top, where the line is made fast, shows over the brow.
            expect(verdantHillsInSight(x, foot + VERDANT_HILLS_POST_HEIGHT, z)).toBe(true);
            if (x < 0) left += 1;
            else right += 1;
        }
        // Kites on both sides of the board.
        expect(left).toBeGreaterThan(0);
        expect(right).toBeGreaterThan(0);
    });
});

describe('where a Verdant Hills kite stands', () => {
    it('is a closed form of time: finite, the same every time, written where it is told', () => {
        const random = seededRandom(3);
        const target = new THREE.Vector3();
        for (let count = 0; count < 3000; count++) {
            const slot = Math.floor(random() * VERDANT_HILLS_KITES);
            const time = random() * 4000;
            const options = {
                fly: random(), height: random(), wind: random(), flutter: random(),
            };
            const place = verdantHillsKitePlace(slot, time, options, target);
            expect(place).toBe(target);
            if (!place.toArray().every(Number.isFinite)) throw new Error(`kite ${slot} at ${time} s`);
            const again = verdantHillsKitePlace(slot, time, options);
            expect(again).not.toBe(target);
            expect(again.toArray()).toEqual(place.toArray());
        }
        // Flying, on a short line, in a calm, is what it does when it is told nothing.
        expect(verdantHillsKitePlace(2, 7).toArray())
            .toEqual(verdantHillsKitePlace(2, 7, { fly: 1, height: 0, wind: 0 }).toArray());
    });

    it.each(SLOTS)('keeps kite %i at its post while it is down', (slot) => {
        const post = postOf(slot);
        const { line } = VERDANT_HILLS_KITE_STATIONS[slot];
        for (const height of HEIGHTS) {
            for (const wind of WINDS) {
                flight(slot, { fly: 0, height, wind }, (place) => {
                    // A few metres of slack line, no more, and not dug into the hill.
                    expect(place.distanceTo(post)).toBeLessThan(line * 0.15);
                    expect(place.y - ground(place.x, place.z)).toBeGreaterThan(0);
                }, 60, 0.5);
            }
        }
    });

    it.each(SLOTS)('flies kite %i downwind of its post, high above the hill, on no more line than it has', (slot) => {
        const post = postOf(slot);
        const station = VERDANT_HILLS_KITE_STATIONS[slot];
        const wind = new THREE.Vector3(VERDANT_HILLS_WIND_DIRECTION.x, 0, VERDANT_HILLS_WIND_DIRECTION.z).normalize();
        const reach = new THREE.Vector3();
        for (const height of HEIGHTS) {
            for (const blow of WINDS) {
                flight(slot, { fly: 1, height, wind: blow }, (place) => {
                    reach.copy(place).sub(post);
                    expect(reach.dot(wind)).toBeGreaterThan(station.line * 0.3);
                    expect(reach.y).toBeGreaterThan(station.line * 0.15);
                    expect(reach.length()).toBeLessThan(station.line * 1.3);
                    // The whole sail and its tail are clear of the grass.
                    expect(place.y - ground(place.x, place.z)).toBeGreaterThan(station.size * 1.5);
                }, 60, 0.25);
            }
        }
    });

    it('climbs and stands further off as line is paid out', () => {
        for (const slot of SLOTS) {
            const post = postOf(slot);
            const mean = (height) => {
                let [rise, reach, count] = [0, 0, 0];
                flight(slot, { fly: 1, height, wind: 0.5 }, (place) => {
                    rise += place.y - post.y;
                    reach += place.distanceTo(post);
                    count += 1;
                }, 60, 0.25);
                return { rise: rise / count, reach: reach / count };
            };
            const [low, middle, high] = HEIGHTS.map(mean);
            expect(middle.rise).toBeGreaterThan(low.rise + 1);
            expect(high.rise).toBeGreaterThan(middle.rise + 1);
            expect(high.reach).toBeGreaterThan(low.reach * 1.2);
        }
    });

    it('goes up from its post as it is let out, never by a jump', () => {
        for (const slot of SLOTS) {
            const post = postOf(slot);
            const place = new THREE.Vector3();
            const previous = verdantHillsKitePlace(slot, 5, { fly: 0, height: 0.4, wind: 0.3 }).clone();
            let last = previous.distanceTo(post);
            const { line } = VERDANT_HILLS_KITE_STATIONS[slot];
            for (let fly = 0.01; fly <= 1.0001; fly += 0.01) {
                verdantHillsKitePlace(slot, 5, { fly, height: 0.4, wind: 0.3 }, place);
                // Further from the post with every hand of line, a little at a time.
                expect(place.distanceTo(post)).toBeGreaterThan(last);
                expect(place.distanceTo(previous)).toBeLessThan(line * 0.04);
                last = place.distanceTo(post);
                previous.copy(place);
            }
        }
    });

    it('clamps what it is told to the range a kite can be in', () => {
        for (const slot of SLOTS) {
            const at = (options) => verdantHillsKitePlace(slot, 12.5, options).toArray();
            expect(at({ fly: 7 })).toEqual(at({ fly: 1 }));
            expect(at({ fly: -7 })).toEqual(at({ fly: 0 }));
            expect(at({ height: 7 })).toEqual(at({ height: 1 }));
            expect(at({ height: -7 })).toEqual(at({ height: 0 }));
            expect(at({ wind: 7 })).toEqual(at({ wind: 1 }));
            expect(at({ wind: -7 })).toEqual(at({ wind: 0 }));
            expect(at({ wind: 1, flutter: 9 })).toEqual(at({ wind: 1 }));
        }
    });

    it('swings wider in a stronger wind, and follows the wind wherever it blows from', () => {
        for (const slot of SLOTS) {
            const sway = (wind) => {
                let [least, most] = [Infinity, -Infinity];
                const post = postOf(slot);
                flight(slot, { fly: 1, height: 0.5, wind }, (place) => {
                    const bearing = Math.atan2(place.x - post.x, -(place.z - post.z));
                    least = Math.min(least, bearing);
                    most = Math.max(most, bearing);
                }, 60, 0.1);
                return most - least;
            };
            expect(sway(0)).toBeGreaterThan(THREE.MathUtils.degToRad(4));
            expect(sway(1)).toBeGreaterThan(sway(0) * 1.5);
            // A lazy figure of eight, not a windmill.
            expect(sway(1)).toBeLessThan(THREE.MathUtils.degToRad(60));
            const post = postOf(slot);
            for (const [windX, windZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                let along = 0;
                flight(slot, {
                    fly: 1, height: 0.5, wind: 0.5, windX, windZ,
                }, (place) => { along += (place.x - post.x) * windX + (place.z - post.z) * windZ; }, 30, 0.5);
                expect(along / 61).toBeGreaterThan(VERDANT_HILLS_KITE_STATIONS[slot].line * 0.4);
            }
        }
    });

    it('never puts a kite under the ground, however far it has been let out', () => {
        const place = new THREE.Vector3();
        let worst = { clearance: Infinity };
        for (const slot of SLOTS) {
            for (let fly = 0; fly <= 1.0001; fly += 0.025) {
                for (const height of HEIGHTS) {
                    for (const wind of WINDS) {
                        for (let time = 0; time < 60; time += 0.5) {
                            verdantHillsKitePlace(slot, time, { fly, height, wind }, place);
                            const clearance = place.y - ground(place.x, place.z);
                            if (clearance < worst.clearance) {
                                worst = {
                                    clearance, slot, fly, height, wind, time,
                                };
                            }
                        }
                    }
                }
            }
        }
        expect(worst.clearance, JSON.stringify(worst)).toBeGreaterThan(0.3);
    });
});

describe('Verdant Hills kites in the picture', () => {
    const camera = frameCamera(LANDSCAPE);
    const ranges = SLOTS.map((slot) => screenRange(camera, slot));
    /** Where a level line of sight meets the screen: the sky is above it. */
    const horizon = onScreen(camera, new THREE.Vector3(0, camera.position.y, -1e7)).y;

    it('frames a horizon across the upper half of a 16:9 screen', () => {
        expect(horizon).toBeGreaterThan(0.2);
        expect(horizon).toBeLessThan(0.5);
        expect(VERDANT_HILLS_DEFAULT_BOARD.x0).toBeLessThan(0.5);
        expect(VERDANT_HILLS_DEFAULT_BOARD.x1).toBeGreaterThan(0.5);
    });

    it.each(SLOTS)('keeps kite %i inside the frame from side to side, with room to spare', (slot) => {
        const range = ranges[slot];
        // The sail's centre never comes nearer an edge than a fiftieth of the screen ...
        expect(range.minX).toBeGreaterThan(0.02);
        expect(range.maxX).toBeLessThan(0.98);
        // ... and never leaves by the top.
        expect(range.minY).toBeGreaterThan(0);
        // It keeps to its own side of the board.
        const [x] = VERDANT_HILLS_KITE_STATIONS[slot].post;
        if (x < 0) expect(range.maxX).toBeLessThan(0.5);
        else expect(range.minX).toBeGreaterThan(0.5);
    });

    it.each(SLOTS)('flies kite %i against the sky once the game has paid out line', (slot) => {
        const range = ranges[slot];
        for (const height of HEIGHTS.filter((value) => value >= 0.5)) {
            expect(range.lowest[height], `height ${height}`).toBeLessThan(horizon - 0.03);
        }
        // Higher on the screen the more line it has.
        expect(range.lowest[1]).toBeLessThan(range.lowest[0.5]);
        expect(range.lowest[0.5]).toBeLessThan(range.lowest[0]);
    });

    it('flies every kite above the horizon line even before any line is paid out', () => {
        const low = SLOTS.map((slot) => [slot, ranges[slot].lowest[0]]).filter(([, y]) => !(y < horizon));
        expect(low, `horizon at ${horizon}`).toEqual([]);
    });

    it.each(SLOTS)('does not hide kite %i behind the board', (slot) => {
        const range = ranges[slot];
        // Now and then one swings in over the card's top corner; never for long.
        expect(range.behindBoard / range.samples).toBeLessThan(0.05);
    });

    it('keeps the kites at a kite\'s distance from the lens', () => {
        const eye = camera.position;
        for (const slot of SLOTS) {
            const { size } = VERDANT_HILLS_KITE_STATIONS[slot];
            for (const height of HEIGHTS) {
                flight(slot, { fly: 1, height, wind: 1 }, (place) => {
                    // A sail a few metres across is a small bright shape in the sky, not a wall.
                    expect(place.distanceTo(eye)).toBeGreaterThan(size * 6);
                    expect(place.distanceTo(eye)).toBeLessThan(250);
                }, 60, 0.5);
            }
        }
    });
});

describe('Verdant Hills kites', () => {
    let light;
    const frame = (overrides = {}) => ({
        kites: ALL_UP, height: 0.5, wind: 0.4, flutter: 0, ...overrides,
    });
    const row = (kites, slot, which) => kites.rows[slot * ROWS + which];
    const vector = (entry) => new THREE.Vector3(entry.x, entry.y, entry.z);

    beforeAll(() => {
        light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: seededRandom(5) });
    });

    afterAll(() => {
        light.dispose();
    });

    describe('before the first frame', () => {
        it('has six rows for each kite, with its colour and its post and nothing showing', () => {
            const kites = new VerdantHillsKites({ light });
            expect(kites.count).toBe(VERDANT_HILLS_KITES);
            expect(kites.rows).toHaveLength(VERDANT_HILLS_KITES * ROWS);
            expect(kites.aloft).toBe(0);
            for (const slot of SLOTS) {
                // Place and shown, right and tug, nose and size, velocity and wind: all at rest.
                for (const which of [0, 1, 2, 3]) expect(row(kites, slot, which).toArray()).toEqual([0, 0, 0, 0]);
                const colour = new THREE.Color(VERDANT_HILLS_KITE_COLOURS[slot]);
                const tone = row(kites, slot, 4);
                expect([tone.x, tone.y, tone.z]).toEqual([colour.r, colour.g, colour.b]);
                expect(Number.isFinite(tone.w)).toBe(true);
                const post = postOf(slot);
                const tied = row(kites, slot, 5);
                expect([tied.x, tied.y, tied.z]).toEqual(post.toArray());
                expect(tied.w).toBe(0);
                expect(kites.posts[slot].toArray()).toEqual(post.toArray());
            }
            // No two kites flutter in step.
            expect(new Set(SLOTS.map((slot) => row(kites, slot, 4).w)).size).toBe(VERDANT_HILLS_KITES);
        });
    });

    describe('a frame', () => {
        it('stands each kite where the closed form says, in the light rig\'s own wind', () => {
            const kites = new VerdantHillsKites({ light });
            const { x: windX, z: windZ } = light.uWindDir.value;
            for (const time of [0, 3.7, 41.25]) {
                const levels = SLOTS.map((slot) => slot / (VERDANT_HILLS_KITES - 1));
                kites.update(time, STEP, frame({
                    kites: levels, height: 0.7, wind: 0.6, flutter: 0.3,
                }));
                for (const slot of SLOTS) {
                    const expected = verdantHillsKitePlace(slot, time, {
                        fly: levels[slot], height: 0.7, wind: 0.6, flutter: 0.3, windX, windZ,
                    });
                    expect(vector(row(kites, slot, 0)).toArray()).toEqual(expected.toArray());
                    expect(kites.position(slot).toArray()).toEqual(expected.toArray());
                }
            }
            // position() writes where it is told and keeps to the kites there are.
            const target = new THREE.Vector3();
            expect(kites.position(3, target)).toBe(target);
            expect(kites.position(-5).toArray()).toEqual(kites.position(0).toArray());
            expect(kites.position(99).toArray()).toEqual(kites.position(VERDANT_HILLS_KITES - 1).toArray());
            expect(kites.position(2.9).toArray()).toEqual(kites.position(2).toArray());
        });

        it('writes finite rows and a sail square to its line, nose to the sky', () => {
            const kites = new VerdantHillsKites({ light });
            const random = seededRandom(19);
            for (let count = 0; count < 300; count++) {
                kites.update(random() * 600, STEP, frame({
                    kites: SLOTS.map(() => random()), height: random(), wind: random(), flutter: random(),
                }));
                for (const slot of SLOTS) {
                    for (let which = 0; which < ROWS; which++) {
                        if (!row(kites, slot, which).toArray().every(Number.isFinite)) throw new Error(`row ${which}`);
                    }
                    const right = vector(row(kites, slot, 1));
                    const nose = vector(row(kites, slot, 2));
                    const line = vector(row(kites, slot, 0)).sub(kites.posts[slot]).normalize();
                    expect(right.length()).toBeCloseTo(1, 9);
                    expect(nose.length()).toBeCloseTo(1, 9);
                    expect(Math.abs(right.dot(nose))).toBeLessThan(1e-9);
                    // The sail faces down its own line.
                    expect(Math.abs(right.dot(line))).toBeLessThan(1e-9);
                    expect(Math.abs(nose.dot(line))).toBeLessThan(1e-9);
                    expect(nose.y).toBeGreaterThan(0);
                }
            }
        });

        it('shows a kite that is flying and hides one that is down', () => {
            const kites = new VerdantHillsKites({ light });
            const levels = [0, 0.01, 0.1, 0.2, 0.5, 1, 1];
            kites.update(2, STEP, frame({ kites: levels }));
            const shown = SLOTS.map((slot) => row(kites, slot, 0).w);
            expect(shown[0]).toBe(0);
            expect(shown[5]).toBe(1);
            expect(shown[4]).toBe(1);
            // It fades in as it leaves the grass: more line, no less of it.
            for (const slot of SLOTS.slice(1)) {
                expect(shown[slot]).toBeGreaterThanOrEqual(shown[slot - 1]);
                expect(shown[slot]).toBeLessThanOrEqual(1);
            }
            expect(shown[2]).toBeGreaterThan(0);
            expect(shown[2]).toBeLessThan(1);
            // The line hangs slack in proportion to how little of it is out.
            SLOTS.forEach((slot) => expect(row(kites, slot, 5).w).toBeCloseTo(1 - levels[slot], 12));
            kites.update(3, STEP, frame({ kites: SLOTS.map(() => 0) }));
            for (const slot of SLOTS) expect(row(kites, slot, 0).w).toBe(0);
        });

        it('counts the kites in the air', () => {
            const kites = new VerdantHillsKites({ light });
            for (const [levels, aloft] of [
                [[0, 0, 0, 0, 0, 0, 0], 0], [[1, 0, 0, 0, 0, 0, 0], 1], [[1, 1, 0.5, 0, 0.3, 0, 0], 4],
                [ALL_UP, VERDANT_HILLS_KITES], [[0.001, 0.001, 0, 0, 0, 0, 0], 0],
            ]) {
                kites.update(1, STEP, frame({ kites: levels }));
                expect(kites.aloft, levels.join()).toBe(aloft);
            }
            // The reactions hand over a typed array.
            kites.update(1, STEP, frame({ kites: new Float32Array([1, 0, 1, 0, 1, 0, 1]) }));
            expect(kites.aloft).toBe(4);
        });

        it('carries the tug, the size, the speed and the wind the shader draws with', () => {
            const kites = new VerdantHillsKites({ light });
            const { x: windX, z: windZ } = light.uWindDir.value;
            const tugs = [0, 0.25, 0.5, 1, 3, -2, NaN];
            const state = {
                height: 0.3, wind: 0.5, flutter: 0.4,
            };
            kites.update(9, STEP, frame({ ...state, kiteTug: tugs }));
            expect(SLOTS.map((slot) => row(kites, slot, 1).w)).toEqual([0, 0.25, 0.5, 1, 1, 0, 0]);
            for (const slot of SLOTS) {
                const { size } = VERDANT_HILLS_KITE_STATIONS[slot];
                // A sail about the size its station gives it.
                expect(row(kites, slot, 2).w).toBeGreaterThan(size * 0.7);
                expect(row(kites, slot, 2).w).toBeLessThan(size * 1.6);
                // Velocity is where it will be a moment from now, in metres a second.
                const now = verdantHillsKitePlace(slot, 9, {
                    fly: 1, ...state, windX, windZ,
                });
                const soon = verdantHillsKitePlace(slot, 9.01, {
                    fly: 1, ...state, windX, windZ,
                });
                const speed = vector(row(kites, slot, 3));
                expect(speed.distanceTo(soon.sub(now).multiplyScalar(100))).toBeLessThan(0.5 + speed.length() * 0.1);
                expect(speed.length()).toBeLessThan(40);
                expect(row(kites, slot, 3).w).toBeGreaterThan(0);
                expect(row(kites, slot, 3).w).toBeLessThanOrEqual(1);
            }
            // The colour and the post are not the frame's to change.
            const fresh = new VerdantHillsKites({ light });
            for (const slot of SLOTS) {
                expect(row(kites, slot, 4).toArray()).toEqual(row(fresh, slot, 4).toArray());
                expect(vector(row(kites, slot, 5)).toArray()).toEqual(vector(row(fresh, slot, 5)).toArray());
            }
            // More wind is more wind in the tail, up to all there is.
            kites.update(9, STEP, frame({ wind: 0.1, flutter: 0 }));
            const light1 = row(kites, 0, 3).w;
            kites.update(9, STEP, frame({ wind: 0.9, flutter: 0 }));
            expect(row(kites, 0, 3).w).toBeGreaterThan(light1);
            kites.update(9, STEP, frame({ wind: 40, flutter: 40 }));
            expect(row(kites, 0, 3).w).toBe(1);
        });

        it('leans a swinging kite\'s nose the way it is going', () => {
            const kites = new VerdantHillsKites({ light });
            let [into, away] = [0, 0];
            const level = new THREE.Vector3();
            for (let time = 0; time < 60; time += 0.13) {
                kites.update(time, STEP, frame({ height: 0.5, wind: 0.6 }));
                for (const slot of SLOTS) {
                    const line = vector(row(kites, slot, 0)).sub(kites.posts[slot]).normalize();
                    // Sideways as the flier sees it: across the line, level with the ground.
                    level.crossVectors(line, new THREE.Vector3(0, 1, 0)).normalize();
                    const sideways = vector(row(kites, slot, 3)).dot(level);
                    const lean = vector(row(kites, slot, 2)).dot(level);
                    if (Math.abs(sideways) > 1) {
                        if (lean * sideways > 0) into += 1;
                        else away += 1;
                    }
                }
            }
            expect(into + away).toBeGreaterThan(500);
            expect(away, `${into} lean into the swing`).toBe(0);
        });

        it('banks more the faster a kite swings, and stands square when it does not', () => {
            const kites = new VerdantHillsKites({ light });
            const level = new THREE.Vector3();
            const samples = [];
            for (let time = 0; time < 60; time += 0.13) {
                kites.update(time, STEP, frame({ height: 0.5, wind: 0.6 }));
                for (const slot of SLOTS) {
                    const line = vector(row(kites, slot, 0)).sub(kites.posts[slot]).normalize();
                    level.crossVectors(line, new THREE.Vector3(0, 1, 0)).normalize();
                    samples.push({
                        sideways: Math.abs(vector(row(kites, slot, 3)).dot(level)),
                        lean: Math.abs(vector(row(kites, slot, 2)).dot(level)),
                    });
                }
            }
            const mean = (list) => list.reduce((sum, sample) => sum + sample.lean, 0) / list.length;
            const still = samples.filter((sample) => sample.sideways < 0.3);
            const swinging = samples.filter((sample) => sample.sideways > 2);
            expect(still.length).toBeGreaterThan(20);
            expect(swinging.length).toBeGreaterThan(20);
            expect(mean(swinging)).toBeGreaterThan(mean(still) * 2);
            // At the turn of a swing the nose points straight up the sky.
            expect(mean(still)).toBeLessThan(0.2);
            // Never rolled onto its back.
            for (const sample of samples) expect(sample.lean).toBeLessThan(0.95);
        });

        it('flies down whatever wind the light rig has', () => {
            const other = { uWindDir: { value: new THREE.Vector3(-1, 0, 0) } };
            const kites = new VerdantHillsKites({ light: other });
            kites.update(4, STEP, frame());
            for (const slot of SLOTS) expect(row(kites, slot, 0).x).toBeLessThan(kites.posts[slot].x - 5);
            other.uWindDir.value.set(0, 0, 1);
            kites.update(4, STEP, frame());
            for (const slot of SLOTS) expect(row(kites, slot, 0).z).toBeGreaterThan(kites.posts[slot].z + 5);
        });

        it('takes a frame with nothing in it, or nonsense in it, as a calm one with every kite down', () => {
            const kites = new VerdantHillsKites({ light });
            const calm = new VerdantHillsKites({ light });
            calm.update(5, STEP, {
                kites: SLOTS.map(() => 0), height: 0, wind: 0, flutter: 0,
            });
            const expected = calm.rows.map((entry) => entry.toArray());
            const nonsense = [NaN, undefined, null, 'x', {}, [], -3];
            for (const junk of [undefined, {}, { kites: null }, { kites: 'up' }, { kites: nonsense },
                {
                    kites: [], height: NaN, wind: Infinity, flutter: 'gusty', kiteTug: null,
                }]) {
                kites.update(5, STEP, junk);
                expect(kites.rows.map((entry) => entry.toArray()), JSON.stringify(junk)).toEqual(expected);
                expect(kites.aloft).toBe(0);
            }
            // Out of range is the nearest a kite can be.
            kites.update(5, STEP, { kites: SLOTS.map(() => 9), height: 9, wind: 9 });
            calm.update(5, STEP, { kites: ALL_UP, height: 1, wind: 1 });
            for (const slot of SLOTS) {
                expect(row(kites, slot, 0).toArray()).toEqual(row(calm, slot, 0).toArray());
                expect(row(kites, slot, 3).w).toBe(1);
            }
        });

        it('flies in the rows and vectors it was built with', () => {
            const kites = new VerdantHillsKites({ light });
            const { rows, place, ahead } = kites;
            const kept = [...rows];
            const { posts } = kites;
            const tied = posts.map((post) => post.toArray());
            for (let count = 0; count < 200; count++) {
                kites.update(count * STEP, STEP, frame({ wind: (count % 10) / 10 }));
            }
            expect(kites.rows).toBe(rows);
            kites.rows.forEach((entry, index) => expect(entry).toBe(kept[index]));
            expect(kites.place).toBe(place);
            expect(kites.ahead).toBe(ahead);
            // The posts do not walk.
            expect(kites.posts.map((post) => post.toArray())).toEqual(tied);
        });
    });

    describe('the mesh', () => {
        it('builds one mesh: a sail, a tail and a line for each kite, each told which kite it is', () => {
            const kites = new VerdantHillsKites({ light });
            expect(kites.build()).toBe(kites);
            const { mesh } = kites;
            expect(kites.group.children).toEqual([mesh]);
            expect(mesh.geometry).toBe(kites.geometry);
            expect(mesh.material).toBe(kites.material);
            expect(mesh.frustumCulled).toBe(false);
            expect(mesh.castShadow).toBe(false);
            expect(mesh.material.isNodeMaterial).toBe(true);
            expect(mesh.material.transparent).toBe(true);
            // In the depth buffer, so the post chain's air light stops at the cloth; a hidden kite is discarded.
            expect(mesh.material.depthWrite).toBe(true);
            expect(mesh.material.alphaTest).toBeGreaterThan(0);
            expect(mesh.material.alphaTest).toBeLessThan(0.1);
            expect(mesh.material.side).toBe(THREE.DoubleSide);
            expect(mesh.material.positionNode).toBeTruthy();
            const position = mesh.geometry.getAttribute('position');
            const part = mesh.geometry.getAttribute('aPart');
            const index = mesh.geometry.getIndex();
            expect(part.itemSize).toBe(4);
            expect(part.count).toBe(position.count);
            const each = position.count / VERDANT_HILLS_KITES;
            expect(Number.isInteger(each)).toBe(true);
            expect(index.count % (3 * VERDANT_HILLS_KITES)).toBe(0);
            const kinds = SLOTS.map(() => [0, 0, 0]);
            for (let vertex = 0; vertex < part.count; vertex++) {
                const [kind, along] = [part.getX(vertex), part.getY(vertex)];
                const [across, kite] = [part.getZ(vertex), part.getW(vertex)];
                // Sail 0, tail 1, line 2; and the rows of the kite it reads.
                expect([0, 1, 2]).toContain(kind);
                expect(kite).toBe(Math.floor(vertex / each));
                kinds[kite][kind] += 1;
                expect(along).toBeGreaterThanOrEqual(0);
                expect(along).toBeLessThanOrEqual(1);
                if (kind > 0) {
                    // Strips: one vertex on either edge, placed wholly by the shader.
                    expect(Math.abs(across)).toBe(1);
                    expect([position.getX(vertex), position.getY(vertex), position.getZ(vertex)]).toEqual([0, 0, 0]);
                }
            }
            for (const [sail, tail, line] of kinds) {
                expect(sail).toBeGreaterThanOrEqual(4);
                expect(tail).toBeGreaterThanOrEqual(8);
                expect(line).toBeGreaterThanOrEqual(4);
                expect([sail, tail, line]).toEqual(kinds[0]);
            }
            // No triangle joins one kite to another, or a sail to its tail or its line.
            for (let corner = 0; corner < index.count; corner += 3) {
                const corners = [index.getX(corner), index.getX(corner + 1), index.getX(corner + 2)];
                expect(new Set(corners).size).toBe(3);
                expect(new Set(corners.map((vertex) => part.getW(vertex))).size).toBe(1);
                expect(new Set(corners.map((vertex) => part.getX(vertex))).size).toBe(1);
            }
            kites.dispose();
        });

        it('cuts each sail as a diamond with its nose up, bellied away from the flier', () => {
            const kites = new VerdantHillsKites({ light }).build();
            const position = kites.geometry.getAttribute('position');
            const part = kites.geometry.getAttribute('aPart');
            const index = kites.geometry.getIndex();
            for (const slot of SLOTS) {
                const sail = [];
                for (let vertex = 0; vertex < part.count; vertex++) {
                    if (part.getW(vertex) === slot && part.getX(vertex) === 0) {
                        sail.push(new THREE.Vector3().fromBufferAttribute(position, vertex));
                    }
                }
                const xs = sail.map((point) => point.x);
                const ys = sail.map((point) => point.y);
                // In units of its own size: about as wide as it is tall, taller below the spar than above.
                expect(Math.max(...xs)).toBeCloseTo(-Math.min(...xs), 9);
                expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.4);
                expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 1);
                expect(Math.max(...ys)).toBeGreaterThan(0);
                expect(-Math.min(...ys)).toBeGreaterThan(Math.max(...ys));
                // The belly is all on one side of the frame.
                expect(Math.max(...sail.map((point) => point.z))).toBeLessThanOrEqual(0);
                expect(Math.min(...sail.map((point) => point.z))).toBeLessThan(0);
            }
            // The cloth has area: no sail triangle is a sliver.
            const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
            let area = 0;
            for (let corner = 0; corner < index.count; corner += 3) {
                if (part.getX(index.getX(corner)) === 0 && part.getW(index.getX(corner)) === 0) {
                    a.fromBufferAttribute(position, index.getX(corner));
                    b.fromBufferAttribute(position, index.getX(corner + 1));
                    c.fromBufferAttribute(position, index.getX(corner + 2));
                    const piece = b.sub(a).cross(c.sub(a)).length() / 2;
                    expect(piece).toBeGreaterThan(1e-4);
                    area += piece;
                }
            }
            // Its panels cover the diamond once: about half the box it fits in.
            expect(area).toBeGreaterThan(0.25);
            expect(area).toBeLessThan(0.5);
            kites.dispose();
        });

        it('releases its geometry and material and leaves the scene', () => {
            const kites = new VerdantHillsKites({ light }).build();
            const parent = new THREE.Group();
            parent.add(kites.group);
            const released = [];
            kites.geometry.addEventListener('dispose', () => released.push('geometry'));
            kites.material.addEventListener('dispose', () => released.push('material'));
            kites.dispose();
            expect(released.sort()).toEqual(['geometry', 'material']);
            expect(parent.children).toHaveLength(0);
            expect(kites.group.children).toHaveLength(0);
            expect(kites.mesh).toBeNull();
            expect(() => new VerdantHillsKites({ light }).dispose()).not.toThrow();
        });
    });
});
