import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    VERDANT_HILLS_VIEWS, VerdantHillsSight, createVerdantHillsVisibilityTest, verdantHillsEye, verdantHillsGaze,
    verdantHillsInSight, verdantHillsTarget, verdantHillsViewFor,
} from '../../src/themes/verdant-hills/verdant-hills-composition.js';
import { VERDANT_HILLS_SUN_DIRECTION, VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    VERDANT_HILLS_CROWN, VERDANT_HILLS_MAP_BOUNDS, VERDANT_HILLS_PATH, VERDANT_HILLS_PLACES, VERDANT_HILLS_TERRACES,
    VERDANT_HILLS_WATER_LEVEL, VERDANT_HILLS_WEDGE_DEGREES, VerdantHillsTerrain, createVerdantHillsLandData,
    verdantHillsFieldAt, verdantHillsGroundHeight, verdantHillsGroundNormal, verdantHillsNoise,
    verdantHillsPathDistance, verdantHillsRiverZ, verdantHillsWaterDistance,
} from '../../src/themes/verdant-hills/verdant-hills-terrain.js';

// The land is sampled many thousands of times and its mesh built whole: slow on a busy machine.
vi.setConfig({ testTimeout: 30000 });

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const { degToRad, radToDeg } = THREE.MathUtils;
const height = verdantHillsGroundHeight;
/**
 * No hillside of the downs is as steep as this (rise over run): the flanks of the right-hand spur
 * come nearest, at a little over one in one. A change of height beyond it is a step in the land.
 */
const STEEPEST = 2;
/** Where the land's own banks end: beyond this far from the water the downs are as they were. */
const BANK_REACH = 40;
const {
    eye: EYE, oak: OAK, mill: MILL, gate: GATE, bench: BENCH, tarn: TARN,
} = VERDANT_HILLS_PLACES;
function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** Bearing of a place from the lens, in radians from -Z, positive to the right. */
const bearingOf = (x, z) => Math.atan2(x - EYE.x, -(z - EYE.z));
const rangeOf = (x, z) => Math.hypot(x - EYE.x, z - EYE.z);
/** The place `range` metres from the lens on a bearing. */
const along = (bearing, range) => [EYE.x + Math.sin(bearing) * range, EYE.z - Math.cos(bearing) * range];

/** A random place in the wedge the lens can see, spread evenly in the logarithm of its distance. */
function wedgePlace(random, farthest = 3000, nearest = 1.2) {
    const bearing = (random() * 2 - 1) * degToRad(VERDANT_HILLS_WEDGE_DEGREES);
    const range = nearest * Math.exp(random() * Math.log(farthest / nearest));
    return along(bearing, range);
}

/** The largest change of height over one small move in any direction, among `count` places. */
function steepestStep(places, move = 0.25, directions = 8) {
    let worst = { change: 0 };
    for (const [x, z] of places) {
        const here = height(x, z);
        for (let turn = 0; turn < directions; turn++) {
            const angle = (turn / directions) * Math.PI * 2;
            const change = Math.abs(height(x + Math.cos(angle) * move, z + Math.sin(angle) * move) - here);
            if (change > worst.change) worst = { change, x, z };
        }
    }
    return worst;
}

/** The camera as VerdantHillsWorld.prepareCamera() frames it for an aspect ratio. */
function frameCamera(aspect = LANDSCAPE) {
    const view = verdantHillsViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.25, 30000);
    camera.position.set(...verdantHillsEye(view));
    camera.lookAt(...verdantHillsTarget(view));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

function createLight() {
    return new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.Minimal, rng: seededRandom(5) });
}

describe('Verdant Hills land', () => {
    describe('the home hill', () => {
        it('stands the lens on the crown, the highest ground of the home hill', () => {
            expect(height(EYE.x, EYE.z)).toBe(VERDANT_HILLS_CROWN);
            for (let turn = 0; turn < 72; turn++) {
                for (const range of [1, 3, 8, 20, 50, 100]) {
                    const angle = degToRad(turn * 5);
                    const here = height(Math.cos(angle) * range, Math.sin(angle) * range);
                    expect(here, `${range} m out`).toBeLessThanOrEqual(VERDANT_HILLS_CROWN);
                }
            }
            // The valley is far below it.
            expect(VERDANT_HILLS_CROWN).toBeGreaterThan(VERDANT_HILLS_WATER_LEVEL + 30);
        });

        it('falls steeply straight ahead and gently down a spur on either hand', () => {
            const left = bearingOf(OAK.x, OAK.z);
            const right = bearingOf(GATE.x, GATE.z);
            // The oak's spur leaves to the left of the gaze, the gate's to the right.
            expect(left).toBeLessThan(degToRad(-10));
            expect(right).toBeGreaterThan(degToRad(10));
            for (const range of [30, 60, 90]) {
                const ahead = height(...along(0, range));
                const easier = ahead + range * 0.05;
                expect(height(...along(left, range)), `left spur at ${range} m`).toBeGreaterThan(easier);
                expect(height(...along(right, range)), `right spur at ${range} m`).toBeGreaterThan(easier);
                expect(ahead).toBeLessThan(VERDANT_HILLS_CROWN);
            }
            // Every way down is down: the hill has no second summit on the way out.
            for (const bearing of [left, 0, right]) {
                let previous = VERDANT_HILLS_CROWN;
                for (let range = 3; range <= 50; range += 1) {
                    const here = height(...along(bearing, range));
                    expect(here).toBeLessThan(previous + 0.05);
                    previous = here;
                }
            }
        });

        it('is one finite ground, from the lens to the far ridges and beyond anything it draws', () => {
            const random = seededRandom(3);
            for (let count = 0; count < 20000; count++) {
                const [x, z] = wedgePlace(random, 13000);
                const here = height(x, z);
                if (!Number.isFinite(here)) throw new Error(`no ground at ${x}, ${z}`);
                // Hills, not mountains and not a pit.
                expect(here).toBeGreaterThan(-60);
                expect(here).toBeLessThan(700);
            }
            for (const [x, z] of [[0, 0], [1e6, -1e6], [-1e7, 3e6], [0, 5e5], [-0, -0], [1e-9, -1e-9]]) {
                expect(Number.isFinite(height(x, z)), `${x}, ${z}`).toBe(true);
            }
            // The same place is the same height, whoever asks and however often.
            expect(height(123.4, -567.8)).toBe(height(123.4, -567.8));
        });

        it('stacks the far ridges higher the further away they stand', () => {
            const mean = (range) => {
                let sum = 0;
                for (let step = 0; step <= 40; step++) sum += height(...along(degToRad(-50 + step * 2.5), range));
                return sum / 41;
            };
            expect(mean(8000)).toBeGreaterThan(mean(3000) + 20);
            expect(mean(3000)).toBeGreaterThan(mean(1200));
        });
    });

    describe('continuity', () => {
        it('has no step anywhere the banks of the water do not reach', () => {
            const random = seededRandom(11);
            const places = [];
            while (places.length < 30000) {
                const place = wedgePlace(random);
                // The banks are measured by themselves below.
                if (verdantHillsWaterDistance(...place) > BANK_REACH + 5) places.push(place);
            }
            const worst = steepestStep(places);
            expect(worst.change, `at ${worst.x}, ${worst.z}`).toBeLessThan(0.25 * STEEPEST);
        });

        it('has no step all round the crown, behind the lens as well as before it', () => {
            const places = [];
            for (let turn = 0; turn < 360; turn += 2) {
                for (const range of [0.5, 2.4, 2.5, 2.6, 6, 15, 16, 40, 54, 55, 56, 95, 125, 180, 240, 330]) {
                    places.push([Math.sin(degToRad(turn)) * range, -Math.cos(degToRad(turn)) * range]);
                }
            }
            const worst = steepestStep(places, 0.1);
            expect(worst.change, `at ${worst.x}, ${worst.z}`).toBeLessThan(0.1 * STEEPEST);
        });

        it('blends the home hill into the downs without a seam', () => {
            // Walk out along many bearings in ten-centimetre strides, through the whole blend.
            let worst = 0;
            for (let degrees = -66; degrees <= 66; degrees += 1.5) {
                let previous = height(...along(degToRad(degrees), 40));
                for (let range = 40.1; range <= 360; range += 0.1) {
                    const here = height(...along(degToRad(degrees), range));
                    worst = Math.max(worst, Math.abs(here - previous));
                    previous = here;
                }
            }
            expect(worst).toBeLessThan(0.1 * STEEPEST);
        });

        it.each(VERDANT_HILLS_TERRACES.map((terrace) => [`${terrace.x}, ${terrace.z}`, terrace]))(
            'crosses the rim of the terrace at %s without a step',
            (_label, terrace) => {
                let worst = 0;
                for (let turn = 0; turn < 360; turn += 3) {
                    const [cos, sin] = [Math.cos(degToRad(turn)), Math.sin(degToRad(turn))];
                    let previous = height(terrace.x, terrace.z);
                    for (let away = 0.02; away <= terrace.radius + terrace.blend + 3; away += 0.02) {
                        const here = height(terrace.x + cos * away, terrace.z + sin * away);
                        worst = Math.max(worst, Math.abs(here - previous));
                        previous = here;
                    }
                }
                expect(worst).toBeLessThan(0.02 * STEEPEST);
            },
        );

        it('comes down to the water and climbs away from it without a step', () => {
            let worst = { change: 0 };
            const STRIDE = 0.1;
            const cross = (x, z, from, to, nx, nz) => {
                let previous = height(x + nx * from, z + nz * from);
                for (let off = from + STRIDE; off <= to; off += STRIDE) {
                    const here = height(x + nx * off, z + nz * off);
                    const change = Math.abs(here - previous);
                    if (change > worst.change) worst = { change, x: x + nx * off, z: z + nz * off };
                    previous = here;
                }
            };
            // Across the river, from mid-stream out over both banks ...
            for (let x = VERDANT_HILLS_MAP_BOUNDS.minX; x <= VERDANT_HILLS_MAP_BOUNDS.maxX; x += 15) {
                cross(x, verdantHillsRiverZ(x), 0, 90, 0, 1);
                cross(x, verdantHillsRiverZ(x), 0, 90, 0, -1);
            }
            // ... and out from the shore of the tarn, all the way round.
            const [near, far] = [Math.min(TARN.a, TARN.b) - 20, Math.max(TARN.a, TARN.b) + 90];
            for (let turn = 0; turn < 360; turn += 4) {
                cross(TARN.x, TARN.z, near, far, Math.cos(degToRad(turn)), Math.sin(degToRad(turn)));
            }
            expect(worst.change, `at ${worst.x}, ${worst.z}`).toBeLessThan(STRIDE * STEEPEST);
        }, 30000);
    });

    describe('terraces', () => {
        it('levels the ground under each thing that stands on the land', () => {
            expect(Object.isFrozen(VERDANT_HILLS_TERRACES)).toBe(true);
            expect(VERDANT_HILLS_TERRACES.length).toBeGreaterThanOrEqual(4);
            for (const place of [OAK, MILL, GATE, BENCH]) {
                const terrace = VERDANT_HILLS_TERRACES.find((entry) => entry.x === place.x && entry.z === place.z);
                expect(terrace, JSON.stringify(place)).toBeDefined();
                expect(terrace.radius).toBe(place.radius);
            }
            for (const terrace of VERDANT_HILLS_TERRACES) {
                expect(Object.isFrozen(terrace)).toBe(true);
                expect(terrace.radius).toBeGreaterThan(0);
                expect(terrace.blend).toBeGreaterThan(0);
                // Its level is the lie of the land at its centre: nothing is raised or sunk there.
                expect(height(terrace.x, terrace.z)).toBe(terrace.level);
            }
        });

        /** How far the ground inside a terrace's radius departs from its level, at worst. */
        const offLevel = (terrace) => {
            let worst = 0;
            for (let turn = 0; turn < 360; turn += 5) {
                for (const share of [0.25, 0.5, 0.75, 0.999]) {
                    const away = terrace.radius * share;
                    const here = height(
                        terrace.x + Math.cos(degToRad(turn)) * away,
                        terrace.z + Math.sin(degToRad(turn)) * away,
                    );
                    worst = Math.max(worst, Math.abs(here - terrace.level));
                }
            }
            return worst;
        };

        it.each(['mill', 'gate', 'bench'])('keeps the ground level all over the %s\'s terrace', (name) => {
            const place = VERDANT_HILLS_PLACES[name];
            const terrace = VERDANT_HILLS_TERRACES.find((entry) => entry.x === place.x && entry.z === place.z);
            expect(offLevel(terrace)).toBeLessThan(1e-9);
        });

        it('keeps the ground level all over the oak\'s terrace', () => {
            const terrace = VERDANT_HILLS_TERRACES.find((entry) => entry.x === OAK.x && entry.z === OAK.z);
            expect(offLevel(terrace)).toBeLessThan(1e-9);
        });

        it('cuts no terrace\'s slope into the level ground of one cut before it', () => {
            const cut = [];
            VERDANT_HILLS_TERRACES.forEach((later, index) => {
                for (const earlier of VERDANT_HILLS_TERRACES.slice(0, index)) {
                    const apart = Math.hypot(later.x - earlier.x, later.z - earlier.z);
                    const needed = earlier.radius + later.radius + later.blend;
                    if (apart < needed) cut.push(`${apart.toFixed(2)} m apart, ${needed.toFixed(2)} m needed`);
                }
            });
            expect(cut).toEqual([]);
        });

        it('cuts into the slope no deeper than a spade would', () => {
            for (const terrace of VERDANT_HILLS_TERRACES) {
                // Just beyond the blend the land is the hillside again, within what the slope allows.
                const reach = terrace.radius + terrace.blend;
                for (let turn = 0; turn < 360; turn += 15) {
                    const here = height(
                        terrace.x + Math.cos(degToRad(turn)) * (reach + 0.01),
                        terrace.z + Math.sin(degToRad(turn)) * (reach + 0.01),
                    );
                    expect(Math.abs(here - terrace.level)).toBeLessThan(reach * STEEPEST);
                }
            }
        });

        it('keeps the level ground of one terrace clear of the level ground of the next', () => {
            for (const terrace of VERDANT_HILLS_TERRACES) {
                for (const other of VERDANT_HILLS_TERRACES) {
                    if (other !== terrace) {
                        const apart = Math.hypot(terrace.x - other.x, terrace.z - other.z);
                        expect(apart).toBeGreaterThan(terrace.radius + other.radius);
                    }
                }
            }
        });
    });

    describe('the places', () => {
        it('names where things stand, frozen', () => {
            expect(Object.isFrozen(VERDANT_HILLS_PLACES)).toBe(true);
            for (const place of Object.values(VERDANT_HILLS_PLACES)) {
                expect(Object.isFrozen(place)).toBe(true);
                expect(Number.isFinite(place.x) && Number.isFinite(place.z)).toBe(true);
            }
        });

        it('stands the oak, the bench and the gate on the home hill, in front of the lens and in its sight', () => {
            for (const [name, place] of [['oak', OAK], ['bench', BENCH], ['gate', GATE]]) {
                const ground = height(place.x, place.z);
                // On the hill, not down in the valley: a few metres under the crown at most.
                expect(ground, name).toBeGreaterThan(VERDANT_HILLS_CROWN - 5);
                expect(ground, name).toBeLessThan(VERDANT_HILLS_CROWN);
                expect(rangeOf(place.x, place.z), name).toBeLessThan(60);
                expect(place.z, name).toBeLessThan(EYE.z);
                expect(verdantHillsInSight(place.x, ground + 0.5, place.z), name).toBe(true);
                expect(verdantHillsWaterDistance(place.x, place.z), name).toBeGreaterThan(100);
            }
            // The oak leans in from the left, the gate stands down the right-hand spur, and the
            // bench is at hand between the lens and the oak.
            expect(OAK.x).toBeLessThan(0);
            expect(GATE.x).toBeGreaterThan(0);
            expect(rangeOf(BENCH.x, BENCH.z)).toBeLessThan(rangeOf(OAK.x, OAK.z));
            expect(rangeOf(OAK.x, OAK.z)).toBeLessThan(rangeOf(GATE.x, GATE.z));
            // Nothing stands on the lens.
            for (const place of [OAK, BENCH, GATE]) expect(rangeOf(place.x, place.z)).toBeGreaterThan(place.radius + 2);
        });

        it('stands the windmill on a hill of its own, beyond the gate and in sight', () => {
            const ground = height(MILL.x, MILL.z);
            expect(MILL.x).toBeGreaterThan(GATE.x);
            expect(rangeOf(MILL.x, MILL.z)).toBeGreaterThan(rangeOf(GATE.x, GATE.z) + 100);
            // To the right of the gaze, inside what a 16:9 screen shows.
            expect(radToDeg(bearingOf(MILL.x, MILL.z))).toBeGreaterThan(10);
            expect(radToDeg(bearingOf(MILL.x, MILL.z))).toBeLessThan(36);
            expect(verdantHillsInSight(MILL.x, ground + 1, MILL.z)).toBe(true);
            // A hill: the ground falls away from it on every side.
            for (const away of [40, 50, 60]) {
                for (let turn = 0; turn < 360; turn += 10) {
                    const [dx, dz] = [Math.cos(degToRad(turn)) * away, Math.sin(degToRad(turn)) * away];
                    const around = height(MILL.x + dx, MILL.z + dz);
                    expect(around, `${away} m away, ${turn} degrees`).toBeLessThan(ground - 1);
                }
            }
            // Lower than the lens, so the eye looks across at it, and dry.
            expect(ground).toBeLessThan(VERDANT_HILLS_CROWN);
            expect(ground).toBeGreaterThan(VERDANT_HILLS_WATER_LEVEL + 20);
        });

        it('gives the windmill\'s hill the top its place names', () => {
            expect(height(MILL.x, MILL.z)).toBeCloseTo(MILL.top, 1);
        });

        it('lays the tarn in the valley, on the water, where the lens can see it', () => {
            expect(verdantHillsWaterDistance(TARN.x, TARN.z)).toBeLessThan(0);
            expect(height(TARN.x, TARN.z)).toBeLessThan(VERDANT_HILLS_WATER_LEVEL);
            expect(TARN.a).toBeGreaterThan(0);
            expect(TARN.b).toBeGreaterThan(0);
            // Its shore is where its half-axes say.
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const inside = verdantHillsWaterDistance(TARN.x + dx * TARN.a * 0.9, TARN.z + dz * TARN.b * 0.9);
                const outside = verdantHillsWaterDistance(TARN.x + dx * TARN.a * 1.1, TARN.z + dz * TARN.b * 1.1);
                expect(inside).toBeLessThan(0);
                expect(outside).toBeGreaterThan(0);
            }
            expect(verdantHillsInSight(TARN.x, VERDANT_HILLS_WATER_LEVEL, TARN.z)).toBe(true);
            expect(Math.abs(radToDeg(bearingOf(TARN.x, TARN.z)))).toBeLessThan(36);
        });
    });

    describe('water', () => {
        it('runs a river down the valley, far below the lens and across the whole view', () => {
            for (let x = -3000; x <= 3000; x += 25) {
                const z = verdantHillsRiverZ(x);
                expect(Number.isFinite(z)).toBe(true);
                // Out in front, beyond the home hill.
                expect(z).toBeLessThan(EYE.z - 300);
                expect(verdantHillsWaterDistance(x, z), `mid-stream at x ${x}`).toBeLessThan(0);
            }
            // It winds: it is not a ruled line.
            const course = Array.from({ length: 60 }, (_, step) => verdantHillsRiverZ(-1500 + step * 50));
            expect(Math.max(...course) - Math.min(...course)).toBeGreaterThan(50);
        });

        it('measures the way to the water in metres, negative on it', () => {
            // Dry at everything that stands on the hills.
            for (const place of [EYE, OAK, MILL, GATE, BENCH]) {
                expect(verdantHillsWaterDistance(place.x, place.z)).toBeGreaterThan(100);
            }
            for (let x = -1400; x <= 1400; x += 175) {
                const middle = verdantHillsRiverZ(x);
                // Walking away from mid-stream the distance only grows, a metre for about a metre.
                let previous = verdantHillsWaterDistance(x, middle);
                expect(previous).toBeLessThan(0);
                let shore = null;
                for (let off = 1; off <= 80; off += 1) {
                    const here = verdantHillsWaterDistance(x, middle + off);
                    if (!(here > previous && here - previous <= 1 + 1e-9)) throw new Error(`at x ${x}, ${off} m off`);
                    if (shore === null && here >= 0) shore = off;
                    previous = here;
                }
                // Clear of the tarn it is a river: not a brook and not a lake.
                if (Math.abs(x - TARN.x) > TARN.a + 60) {
                    expect(shore, `x ${x}`).toBeGreaterThan(4);
                    expect(shore, `x ${x}`).toBeLessThan(40);
                }
            }
            // The nearer of the river and the tarn counts.
            expect(verdantHillsWaterDistance(TARN.x, TARN.z)).toBeLessThanOrEqual(-Math.min(TARN.a, TARN.b) + 1e-9);
        });

        it('lies level: the bed under the water, the banks above it', () => {
            const random = seededRandom(23);
            let wet = 0;
            let banks = 0;
            const { minX, maxX } = VERDANT_HILLS_MAP_BOUNDS;
            for (let count = 0; count < 60000; count++) {
                const x = minX + random() * (maxX - minX);
                // Along the river and over the tarn.
                const z = (count % 2 === 0 ? verdantHillsRiverZ(x) : TARN.z) + (random() * 2 - 1) * 120;
                const shore = verdantHillsWaterDistance(x, z);
                const here = height(x, z);
                if (shore < -3) {
                    wet += 1;
                    // Under the surface, and no deeper than a wader could stand in.
                    if (!(here < VERDANT_HILLS_WATER_LEVEL)) throw new Error(`a bar ${here} m high at ${x}, ${z}`);
                    if (!(here > VERDANT_HILLS_WATER_LEVEL - 2)) throw new Error(`a hole ${here} m deep at ${x}, ${z}`);
                } else if (shore > 2.5 && shore < BANK_REACH) {
                    banks += 1;
                    if (!(here >= VERDANT_HILLS_WATER_LEVEL)) throw new Error(`drowned bank at ${x}, ${z}`);
                } else if (Math.abs(shore) < 0.25) {
                    // The waterline itself: the land meets the water close to its level, a little
                    // higher where a steep bank comes down to it.
                    if (!(Math.abs(here - VERDANT_HILLS_WATER_LEVEL) < 1.5)) throw new Error(`waterline at ${here} m`);
                }
            }
            expect(wet).toBeGreaterThan(2000);
            expect(banks).toBeGreaterThan(5000);
        });

        it('leaves no dry hollow lower than the water beside it', () => {
            let drowned = 0;
            let lowest = Infinity;
            for (let x = VERDANT_HILLS_MAP_BOUNDS.minX; x <= VERDANT_HILLS_MAP_BOUNDS.maxX; x += 20) {
                for (let z = -1200; z <= VERDANT_HILLS_MAP_BOUNDS.maxZ; z += 20) {
                    if (verdantHillsWaterDistance(x, z) > 2.5 && height(x, z) < VERDANT_HILLS_WATER_LEVEL) {
                        drowned += 1;
                        lowest = Math.min(lowest, height(x, z));
                    }
                }
            }
            expect(drowned, `lowest ${lowest}`).toBe(0);
        });
    });

    describe('the lie of the ground', () => {
        it('gives an upward unit normal that leans the way the land falls', () => {
            const random = seededRandom(31);
            const target = new THREE.Vector3();
            for (let count = 0; count < 4000; count++) {
                const [x, z] = wedgePlace(random, 6000);
                const normal = verdantHillsGroundNormal(x, z, target);
                expect(normal).toBe(target);
                expect(normal.length()).toBeCloseTo(1, 9);
                expect(normal.y).toBeGreaterThan(0);
                // A step the way the normal leans is a step downhill (or along a level).
                const lean = Math.hypot(normal.x, normal.z);
                if (lean > 0.05 && verdantHillsWaterDistance(x, z) > BANK_REACH + 5) {
                    const down = height(x + (normal.x / lean) * 0.5, z + (normal.z / lean) * 0.5);
                    expect(down).toBeLessThan(height(x, z));
                }
            }
            // Level on the crown and on a terrace, a fresh vector when none is given.
            const crown = verdantHillsGroundNormal(EYE.x, EYE.z);
            expect(crown).toBeInstanceOf(THREE.Vector3);
            expect(crown.y).toBeGreaterThan(0.999);
            const oak = verdantHillsGroundNormal(OAK.x, OAK.z, new THREE.Vector3(), OAK.radius * 0.5);
            expect(oak.y).toBe(1);
            expect(Math.hypot(oak.x, oak.z)).toBe(0);
            // Straight ahead the hill falls away from the lens: the normal leans out over the valley.
            const brow = verdantHillsGroundNormal(...along(0, 30));
            expect(brow.z).toBeLessThan(-0.1);
            expect(brow.y).toBeLessThan(0.99);
        });

        it('builds its hills from a smooth noise between nought and one', () => {
            const random = seededRandom(41);
            const values = [];
            for (let count = 0; count < 5000; count++) {
                const [x, z] = [(random() - 0.5) * 400, (random() - 0.5) * 400];
                const value = verdantHillsNoise(x, z, 11);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(1);
                expect(verdantHillsNoise(x, z, 11)).toBe(value);
                // No jump within a cell or across the seam between two.
                expect(Math.abs(verdantHillsNoise(x + 0.01, z - 0.01, 11) - value)).toBeLessThan(0.05);
                values.push(value);
            }
            expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.7);
            // Exactly on the lattice it is the lattice's own value, from either side.
            for (const [x, z] of [[3, -7], [0, 0], [-12, 5]]) {
                expect(verdantHillsNoise(x - 1e-9, z + 1e-9, 5)).toBeCloseTo(verdantHillsNoise(x, z, 5), 6);
            }
            // Another seed is another field.
            const differing = values.filter((_, index) => index < 200).filter((value, index) => {
                const again = seededRandom(41);
                for (let skip = 0; skip < index * 2; skip++) again();
                return verdantHillsNoise((again() - 0.5) * 400, (again() - 0.5) * 400, 12) !== value;
            });
            expect(differing.length).toBeGreaterThan(190);
        });
    });

    describe('the path', () => {
        it('is trodden from the crown down the right-hand spur, through the gate and on', () => {
            expect(Object.isFrozen(VERDANT_HILLS_PATH)).toBe(true);
            expect(VERDANT_HILLS_PATH.length).toBeGreaterThanOrEqual(3);
            const [first] = VERDANT_HILLS_PATH;
            // It begins on the crown, at the lens's elbow ...
            expect(rangeOf(first[0], first[1])).toBeLessThan(8);
            expect(height(first[0], first[1])).toBeGreaterThan(VERDANT_HILLS_CROWN - 0.5);
            expect(VERDANT_HILLS_PATH.some(([x, z]) => x === GATE.x && z === GATE.z)).toBe(true);
            let previous = { range: 0, ground: VERDANT_HILLS_CROWN + 1e-9 };
            VERDANT_HILLS_PATH.forEach(([x, z], index) => {
                // ... and is always further from the lens and lower down, on the right of the gaze.
                expect(rangeOf(x, z)).toBeGreaterThan(previous.range);
                expect(height(x, z)).toBeLessThan(previous.ground);
                expect(x).toBeGreaterThan(0);
                // From its second stride on it is out in front, where the lens looks.
                if (index > 0) expect(z).toBeLessThan(0);
                previous = { range: rangeOf(x, z), ground: height(x, z) };
            });
            // It keeps to the back of the spur: off the path to the left the hill falls away faster.
            const [x, z] = VERDANT_HILLS_PATH[VERDANT_HILLS_PATH.length - 2];
            expect(height(x, z)).toBeGreaterThan(height(...along(0, rangeOf(x, z))) + 3);
        });

        it('measures the distance to the path', () => {
            for (let index = 0; index < VERDANT_HILLS_PATH.length; index++) {
                const [x, z] = VERDANT_HILLS_PATH[index];
                expect(verdantHillsPathDistance(x, z)).toBeCloseTo(0, 9);
                if (index > 0) {
                    const [px, pz] = VERDANT_HILLS_PATH[index - 1];
                    const [mx, mz] = [(x + px) / 2, (z + pz) / 2];
                    expect(verdantHillsPathDistance(mx, mz)).toBeCloseTo(0, 9);
                    // Square off a stretch by a stride, the path is a stride away on either hand.
                    const length = Math.hypot(x - px, z - pz);
                    const [nx, nz] = [-(z - pz) / length, (x - px) / length];
                    for (const off of [0.4, -0.4, 1.5, -1.5]) {
                        expect(verdantHillsPathDistance(mx + nx * off, mz + nz * off)).toBeCloseTo(Math.abs(off), 6);
                    }
                }
            }
            // Past either end the nearest of it is the end itself.
            const [startX, startZ] = VERDANT_HILLS_PATH[0];
            const [nextX, nextZ] = VERDANT_HILLS_PATH[1];
            const back = Math.hypot(startX - nextX, startZ - nextZ);
            expect(verdantHillsPathDistance(
                startX + ((startX - nextX) / back) * 7,
                startZ + ((startZ - nextZ) / back) * 7,
            )).toBeCloseTo(7, 6);
            expect(verdantHillsPathDistance(-400, -400)).toBeGreaterThan(300);
            expect(verdantHillsPathDistance(OAK.x, OAK.z)).toBeGreaterThan(5);
        });
    });

    describe('the patchwork', () => {
        const samples = [];
        const random = seededRandom(57);
        const bounds = VERDANT_HILLS_MAP_BOUNDS;
        for (let count = 0; count < 30000; count++) {
            const x = bounds.minX + random() * (bounds.maxX - bounds.minX);
            const z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
            samples.push({ x, z, field: verdantHillsFieldAt(x, z) });
        }

        it('describes every spot of the valley in fractions: hedge, tone, water', () => {
            for (const { x, z, field } of samples) {
                for (const key of ['hedge', 'tone', 'water', 'open']) {
                    if (!(field[key] >= 0 && field[key] <= 1)) throw new Error(`${key} ${field[key]} at ${x}, ${z}`);
                }
                expect(field.edge).toBeGreaterThanOrEqual(0);
            }
            expect(verdantHillsFieldAt(250, -900)).toEqual(verdantHillsFieldAt(250, -900));
            // Pastures of many greens, parted by hedges, with the river through them.
            expect(new Set(samples.map(({ field }) => field.tone.toFixed(3))).size).toBeGreaterThan(40);
            const hedged = samples.filter(({ field }) => field.hedge > 0.5).length / samples.length;
            expect(hedged).toBeGreaterThan(0.005);
            expect(hedged).toBeLessThan(0.2);
            expect(samples.some(({ field }) => field.water === 1)).toBe(true);
            // A pasture is one tone from hedge to hedge.
            const inside = samples.find(({ field }) => field.edge > 30);
            expect(verdantHillsFieldAt(inside.x + 2, inside.z - 2).tone).toBe(inside.field.tone);
        });

        it('never stands a hedge in water, on the open home hill or under the windmill', () => {
            for (const { x, z, field } of samples) {
                if (field.hedge > 0) {
                    expect(field.water).toBe(0);
                    expect(verdantHillsWaterDistance(x, z)).toBeGreaterThan(2.5);
                    expect(rangeOf(x, z)).toBeGreaterThan(100);
                    expect(Math.hypot(x - MILL.x, z - MILL.z)).toBeGreaterThan(MILL.radius);
                }
                if (field.water > 0) expect(field.hedge).toBe(0);
            }
            for (let turn = 0; turn < 360; turn += 5) {
                for (const range of [0, 10, 40, 80, 120]) {
                    const spot = verdantHillsFieldAt(...along(degToRad(turn), range));
                    expect(spot.hedge).toBe(0);
                    expect(spot.water).toBe(0);
                }
            }
            for (const place of [OAK, MILL, GATE, BENCH]) expect(verdantHillsFieldAt(place.x, place.z).hedge).toBe(0);
        });

        it('marks the water where the water is', () => {
            for (const { x, z, field } of samples) {
                const shore = verdantHillsWaterDistance(x, z);
                if (shore < -3) expect(field.water).toBe(1);
                if (shore > 3) expect(field.water).toBe(0);
            }
            expect(verdantHillsFieldAt(TARN.x, TARN.z).water).toBe(1);
            expect(verdantHillsFieldAt(0, verdantHillsRiverZ(0)).water).toBe(1);
        });
    });

    describe('the baked map', () => {
        const SIZE = 160;
        const {
            minX, maxX, minZ, maxZ,
        } = VERDANT_HILLS_MAP_BOUNDS;
        const texel = (column, row) => [
            minX + (column * (maxX - minX)) / (SIZE - 1),
            minZ + (row * (maxZ - minZ)) / (SIZE - 1),
        ];
        const plain = createVerdantHillsLandData(SIZE);

        it('holds the valley the lens looks into, and more', () => {
            expect(Object.isFrozen(VERDANT_HILLS_MAP_BOUNDS)).toBe(true);
            expect(maxX - minX).toBeGreaterThan(1000);
            expect(maxZ - minZ).toBeGreaterThan(1000);
            for (const place of [EYE, OAK, MILL, GATE, BENCH, TARN]) {
                expect(place.x).toBeGreaterThan(minX);
                expect(place.x).toBeLessThan(maxX);
                expect(place.z).toBeGreaterThan(minZ);
                expect(place.z).toBeLessThan(maxZ);
            }
        });

        it('writes hedge above the middle of red and water below it, never both, on opaque texels', () => {
            expect(plain).toBeInstanceOf(Uint8Array);
            expect(plain).toHaveLength(SIZE * SIZE * 4);
            let hedges = 0;
            let waters = 0;
            const MIDDLE = Math.round(0.5 * 255);
            for (let row = 0; row < SIZE; row++) {
                for (let column = 0; column < SIZE; column++) {
                    const offset = (row * SIZE + column) * 4;
                    const [x, z] = texel(column, row);
                    const field = verdantHillsFieldAt(x, z);
                    const [red, green, blue, alpha] = plain.subarray(offset, offset + 4);
                    const where = `texel ${column}, ${row}`;
                    if (alpha !== 255) throw new Error(`${where} is not opaque`);
                    // Each texel says what stands at its own place on the land.
                    if (field.hedge > 0.02) {
                        if (!(red > MIDDLE)) throw new Error(`${where}: hedge written as ${red}`);
                        hedges += 1;
                    } else if (field.water > 0.02) {
                        if (!(red < MIDDLE)) throw new Error(`${where}: water written as ${red}`);
                        waters += 1;
                    } else if (Math.abs(red - MIDDLE) > 3) throw new Error(`${where}: open ground written as ${red}`);
                    if (field.hedge * field.water !== 0) throw new Error(`${where}: a hedge in the water`);
                    if (green !== Math.round(field.tone * 255)) throw new Error(`${where}: tone ${green}`);
                    // With no trees the only shade is a hedge's own.
                    if ((blue > 0) !== (field.hedge * 0.5 * 255 >= 0.5)) throw new Error(`${where}: shade ${blue}`);
                }
            }
            expect(hedges).toBeGreaterThan(50);
            expect(waters).toBeGreaterThan(50);
            // Full water and a full hedge are the two ends of the channel.
            expect(Math.min(...plain.filter((_, index) => index % 4 === 0))).toBe(0);
            expect(Math.max(...plain.filter((_, index) => index % 4 === 0))).toBeGreaterThan(250);
        });

        it('is the same map every time, at any size', () => {
            expect(Array.from(createVerdantHillsLandData(SIZE))).toEqual(Array.from(plain));
            const small = createVerdantHillsLandData(8);
            expect(small).toHaveLength(8 * 8 * 4);
            // Corners are corners at any size.
            expect(Array.from(small.subarray(0, 2))).toEqual(Array.from(plain.subarray(0, 2)));
            expect(Array.from(small.subarray(8 * 8 * 4 - 4, 8 * 8 * 4 - 2)))
                .toEqual(Array.from(plain.subarray(SIZE * SIZE * 4 - 4, SIZE * SIZE * 4 - 2)));
        });

        it('lays a tree\'s shade on the ground away from the sun, in blue alone', () => {
            // A giant, so its shadow covers many texels of this coarse map.
            const tree = {
                x: 150, z: -1400, height: 160, spread: 70,
            };
            const shaded = createVerdantHillsLandData(SIZE, [tree]);
            let weight = 0;
            let cx = 0;
            let cz = 0;
            for (let row = 0; row < SIZE; row++) {
                for (let column = 0; column < SIZE; column++) {
                    const offset = (row * SIZE + column) * 4;
                    const more = shaded[offset + 2] - plain[offset + 2];
                    // Nothing but blue changes, and shade only ever darkens.
                    if (shaded[offset] !== plain[offset] || shaded[offset + 1] !== plain[offset + 1]
                        || shaded[offset + 3] !== 255 || more < 0) throw new Error(`texel ${column}, ${row}`);
                    if (more > 0) {
                        const [x, z] = texel(column, row);
                        weight += more;
                        cx += x * more;
                        cz += z * more;
                    }
                }
            }
            expect(weight).toBeGreaterThan(255 * 4);
            const flat = Math.hypot(VERDANT_HILLS_SUN_DIRECTION.x, VERDANT_HILLS_SUN_DIRECTION.z);
            const [sunX, sunZ] = [VERDANT_HILLS_SUN_DIRECTION.x / flat, VERDANT_HILLS_SUN_DIRECTION.z / flat];
            const [dx, dz] = [cx / weight - tree.x, cz / weight - tree.z];
            // The shadow lies on the far side of the tree from the sun, about as long as the tree
            // is tall under this sun, and straight down the sun's bearing.
            const away = -(dx * sunX + dz * sunZ);
            const aside = Math.abs(dx * sunZ - dz * sunX);
            expect(away).toBeGreaterThan(tree.height * 0.3);
            expect(away).toBeLessThan((tree.height * flat) / VERDANT_HILLS_SUN_DIRECTION.y);
            expect(aside).toBeLessThan(away * 0.2);
            // A taller tree throws a longer shadow.
            const taller = createVerdantHillsLandData(SIZE, [{ ...tree, height: 260 }]);
            const sum = (data) => data.reduce((total, value, index) => (index % 4 === 2 ? total + value : total), 0);
            expect(sum(taller)).toBeGreaterThan(sum(shaded));
        });

        it('ignores trees beyond the map and takes any number of them', () => {
            const outside = [{
                x: maxX + 4000, z: -1000, height: 20, spread: 12,
            }, {
                x: 0, z: minZ - 9000, height: 20, spread: 12,
            }];
            expect(Array.from(createVerdantHillsLandData(SIZE, outside))).toEqual(Array.from(plain));
            expect(Array.from(createVerdantHillsLandData(SIZE, []))).toEqual(Array.from(plain));
            const grove = Array.from({ length: 40 }, (_, index) => ({
                x: -600 + index * 30, z: -900 - index * 7, height: 12 + (index % 5), spread: 9,
            }));
            const shaded = createVerdantHillsLandData(SIZE, grove);
            expect(shaded).toHaveLength(plain.length);
            expect(shaded.every((value) => value >= 0 && value <= 255)).toBe(true);
        });
    });

    describe('the ground mesh', () => {
        const light = createLight();
        const terrain = new VerdantHillsTerrain({ light }).build();
        const { geometry } = terrain.mesh;
        const position = geometry.getAttribute('position');
        const index = geometry.getIndex();

        it('builds one mesh of the land, drawn always and casting no shadow', () => {
            expect(terrain.group).toBeInstanceOf(THREE.Group);
            expect(terrain.group.children).toEqual([terrain.mesh]);
            expect(terrain.mesh.isMesh).toBe(true);
            expect(terrain.mesh.frustumCulled).toBe(false);
            expect(terrain.mesh.castShadow).toBe(false);
            expect(terrain.mesh.material.isNodeMaterial).toBe(true);
            expect(terrain.mesh.material.colorNode).toBeTruthy();
            expect(terrain.height(12, -34)).toBe(height(12, -34));
            expect(index.count % 3).toBe(0);
            expect(terrain.triangles).toBe(index.count / 3);
            expect(terrain.triangles).toBeGreaterThan(10000);
            for (let corner = 0; corner < index.count; corner++) {
                const vertex = index.getX(corner);
                if (!(vertex >= 0 && vertex < position.count)) throw new Error(`corner ${corner}: vertex ${vertex}`);
            }
            // Every vertex is used: no orphaned row or column.
            expect(new Set(index.array).size).toBe(position.count);
        });

        it('sets every vertex on the height function, inside the wedge the lens can see', () => {
            const wedge = degToRad(VERDANT_HILLS_WEDGE_DEGREES);
            let nearest = Infinity;
            let farthest = 0;
            let widest = 0;
            for (let vertex = 0; vertex < position.count; vertex++) {
                const [x, y, z] = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
                if (![x, y, z].every(Number.isFinite)) throw new Error(`vertex ${vertex} is not finite`);
                // Stored in single precision: the land is known to a centimetre or so far away.
                const off = Math.abs(y - height(x, z));
                if (off > 0.002 + rangeOf(x, z) * 2e-5) throw new Error(`vertex ${vertex} is ${off} m off the ground`);
                nearest = Math.min(nearest, rangeOf(x, z));
                farthest = Math.max(farthest, rangeOf(x, z));
                widest = Math.max(widest, Math.abs(bearingOf(x, z)));
            }
            expect(widest).toBeLessThanOrEqual(wedge + 1e-6);
            expect(widest).toBeGreaterThan(wedge - 1e-3);
            // From nearer than the foot of either frame to beyond the patchwork and the far ridges.
            for (const view of Object.values(VERDANT_HILLS_VIEWS)) {
                const down = degToRad(-view.pitch + view.fov / 2);
                expect(nearest).toBeLessThan((view.position[1] / Math.tan(down)) * 0.8);
            }
            const { maxX, minZ } = VERDANT_HILLS_MAP_BOUNDS;
            expect(farthest).toBeGreaterThan(Math.hypot(maxX, minZ) * 2);
            // The wedge holds everything a wide screen shows from either framing.
            for (const [view, aspect] of [[VERDANT_HILLS_VIEWS.landscape, 21 / 9], [VERDANT_HILLS_VIEWS.portrait, 1]]) {
                const half = Math.atan(Math.tan(degToRad(view.fov / 2)) * aspect) + Math.abs(degToRad(view.yaw));
                expect(wedge).toBeGreaterThan(half);
            }
        });

        it('turns every triangle to the sky', () => {
            const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
            const normal = new THREE.Vector3();
            for (let corner = 0; corner < index.count; corner += 3) {
                a.fromBufferAttribute(position, index.getX(corner));
                b.fromBufferAttribute(position, index.getX(corner + 1));
                c.fromBufferAttribute(position, index.getX(corner + 2));
                normal.crossVectors(b.sub(a), c.sub(a));
                // Counter-clockwise seen from above, and not a sliver.
                if (!(normal.y > 0)) throw new Error(`triangle ${corner / 3} faces down or has no area`);
            }
            const normals = geometry.getAttribute('normal');
            expect(normals.count).toBe(position.count);
            for (let vertex = 0; vertex < normals.count; vertex++) {
                normal.fromBufferAttribute(normals, vertex);
                if (!(normal.y > 0 && Math.abs(normal.length() - 1) < 1e-3)) throw new Error(`normal ${vertex}`);
            }
        });

        it('is finest at the lens and coarsens with distance', () => {
            // Along the middle column the rings step out by a steady share of their range.
            const ranges = new Set();
            for (let vertex = 0; vertex < position.count; vertex++) {
                ranges.add(Math.round(rangeOf(position.getX(vertex), position.getZ(vertex)) * 100) / 100);
            }
            const rings = [...ranges].sort((p, q) => p - q);
            expect(rings.length).toBeGreaterThan(50);
            for (let ring = 1; ring < rings.length - 1; ring++) {
                const growth = rings[ring] / rings[ring - 1];
                expect(growth).toBeGreaterThan(1);
                expect(growth).toBeLessThan(1.12);
            }
        });

        it('makes a coarse patchwork of its own when it is given none, and lets go of it', () => {
            const made = terrain.landMap;
            expect(made.isDataTexture).toBe(true);
            expect(made.image.data).toHaveLength(made.image.width * made.image.height * 4);
            expect(made.colorSpace).toBe(THREE.NoColorSpace);
            const disposed = [];
            const { material } = terrain.mesh;
            for (const [name, resource] of [['geometry', geometry], ['material', material], ['map', made]]) {
                resource.addEventListener('dispose', () => disposed.push(name));
            }
            const parent = new THREE.Group();
            parent.add(terrain.group);
            terrain.dispose();
            expect(disposed.sort()).toEqual(['geometry', 'map', 'material']);
            expect(terrain.group.parent).toBeNull();
            expect(terrain.group.children).toHaveLength(0);
            expect(parent.children).toHaveLength(0);
            // Once is enough.
            terrain.dispose();
            expect(disposed).toHaveLength(3);
            light.dispose();
        });

        it('draws from a baked patchwork it is handed and leaves that to its owner', () => {
            const own = createLight();
            const baked = new THREE.DataTexture(createVerdantHillsLandData(8), 8, 8, THREE.RGBAFormat);
            const kept = [];
            baked.addEventListener('dispose', () => kept.push('baked'));
            const second = new VerdantHillsTerrain({ light: own, landMap: baked }).build();
            expect(second.landMap).toBe(baked);
            const released = [];
            second.mesh.geometry.addEventListener('dispose', () => released.push('geometry'));
            second.mesh.material.addEventListener('dispose', () => released.push('material'));
            second.dispose();
            expect(released.sort()).toEqual(['geometry', 'material']);
            expect(kept).toEqual([]);
            baked.dispose();
            own.dispose();
        });

        it('shades its own patchwork with the trees it is told about', () => {
            const own = createLight();
            const trees = [{
                x: 200, z: -1400, height: 160, spread: 70,
            }];
            const bare = new VerdantHillsTerrain({ light: own }).build();
            const wooded = new VerdantHillsTerrain({ light: own, trees }).build();
            const blue = (map) => map.image.data
                .reduce((total, value, at) => (at % 4 === 2 ? total + value : total), 0);
            expect(blue(wooded.landMap)).toBeGreaterThan(blue(bare.landMap));
            bare.dispose();
            wooded.dispose();
            own.dispose();
        });
    });
});

describe('Verdant Hills composition', () => {
    describe('the framings', () => {
        it('frames wide screens in landscape and tall screens in portrait', () => {
            expect(Object.isFrozen(VERDANT_HILLS_VIEWS)).toBe(true);
            expect(Object.keys(VERDANT_HILLS_VIEWS).sort()).toEqual(['landscape', 'portrait']);
            for (const view of Object.values(VERDANT_HILLS_VIEWS)) expect(Object.isFrozen(view)).toBe(true);
            for (const aspect of [16 / 9, 16 / 10, 21 / 9, 32 / 9]) {
                expect(verdantHillsViewFor(aspect)).toBe(VERDANT_HILLS_VIEWS.landscape);
            }
            for (const aspect of [PORTRAIT, 9 / 16, 3 / 4]) {
                expect(verdantHillsViewFor(aspect)).toBe(VERDANT_HILLS_VIEWS.portrait);
            }
            // One change of mind as the window widens, and no other.
            let changes = 0;
            let previous = verdantHillsViewFor(0.3);
            for (let aspect = 0.3; aspect <= 4; aspect += 0.01) {
                const view = verdantHillsViewFor(aspect);
                if (view !== previous) changes += 1;
                previous = view;
            }
            expect(changes).toBe(1);
            // A tall screen needs a wider lens to hold the same valley.
            expect(VERDANT_HILLS_VIEWS.portrait.fov).toBeGreaterThan(VERDANT_HILLS_VIEWS.landscape.fov);
        });

        it.each(Object.keys(VERDANT_HILLS_VIEWS))('stands the %s lens on the crown at eye height', (name) => {
            const view = VERDANT_HILLS_VIEWS[name];
            const [x, y, z] = verdantHillsEye(view);
            expect([x, z]).toEqual([view.position[0], view.position[2]]);
            expect(y - height(x, z)).toBeCloseTo(view.position[1], 12);
            // Someone standing in the grass, not a drone and not a mole.
            expect(view.position[1]).toBeGreaterThan(1);
            expect(view.position[1]).toBeLessThan(2.5);
            expect(rangeOf(x, z)).toBeLessThan(2);
            expect(height(x, z)).toBeGreaterThan(VERDANT_HILLS_CROWN - 0.5);
            expect(view.fov).toBeGreaterThan(20);
            expect(view.fov).toBeLessThan(90);
        });

        it.each(Object.keys(VERDANT_HILLS_VIEWS))('looks out over the valley and a little down in %s', (name) => {
            const view = VERDANT_HILLS_VIEWS[name];
            const gaze = verdantHillsGaze(view);
            expect(Math.hypot(...gaze)).toBeCloseTo(1, 12);
            // Out along -Z, tipped down by the pitch and turned by the yaw: degrees, not radians.
            expect(gaze[2]).toBeLessThan(-0.9);
            expect(radToDeg(Math.asin(gaze[1]))).toBeCloseTo(view.pitch, 9);
            expect(radToDeg(Math.atan2(gaze[0], -gaze[2]))).toBeCloseTo(view.yaw, 9);
            expect(view.pitch).toBeLessThan(0);
            expect(view.pitch).toBeGreaterThan(-view.fov / 2);
            // The target is a point along that line, as far as asked.
            const eye = verdantHillsEye(view);
            for (const reach of [1, 200, 5000]) {
                const target = verdantHillsTarget(view, reach);
                target.forEach((value, axis) => expect(value).toBeCloseTo(eye[axis] + gaze[axis] * reach, 9));
            }
            expect(verdantHillsTarget(view)).toEqual(verdantHillsTarget(view, 200));
            // A camera aimed at it looks along the gaze.
            const camera = frameCamera(name === 'portrait' ? PORTRAIT : LANDSCAPE);
            const forward = camera.getWorldDirection(new THREE.Vector3());
            gaze.forEach((value, axis) => expect(forward.getComponent(axis)).toBeCloseTo(value, 9));
            // Sky over the top of the frame and the hill's own brow along the bottom.
            expect(view.pitch + view.fov / 2).toBeGreaterThan(10);
            expect(view.pitch - view.fov / 2).toBeLessThan(-15);
        });

        it('turns a positive yaw to the right', () => {
            const right = verdantHillsGaze({ ...VERDANT_HILLS_VIEWS.landscape, yaw: 30, pitch: 0 });
            expect(right[0]).toBeCloseTo(0.5, 9);
            expect(right[1]).toBeCloseTo(0, 12);
            expect(right[2]).toBeCloseTo(-Math.cos(degToRad(30)), 9);
            const up = verdantHillsGaze({ ...VERDANT_HILLS_VIEWS.landscape, yaw: 0, pitch: 90 });
            expect(up[1]).toBeCloseTo(1, 12);
        });
    });

    describe('what could ever be on screen', () => {
        const visible = createVerdantHillsVisibilityTest();

        it.each([
            ['16:9', LANDSCAPE], ['21:9', 21 / 9], ['4:3', 4 / 3], ['a phone held upright', PORTRAIT], ['a square', 1],
        ])('accepts everything inside the frame of %s', (_label, aspect) => {
            const camera = frameCamera(aspect);
            const random = seededRandom(71);
            const point = new THREE.Vector3();
            let inside = 0;
            for (let count = 0; count < 6000; count++) {
                // A point somewhere in the frustum: a screen position and a distance.
                point.set(random() * 2 - 1, random() * 2 - 1, 0.5).unproject(camera).sub(camera.position).normalize()
                    .multiplyScalar(0.5 * Math.exp(random() * Math.log(20000)))
                    .add(camera.position);
                if (!visible(point.x, point.y, point.z, 0)) throw new Error(`rejected ${point.toArray()} in the frame`);
                inside += 1;
            }
            expect(inside).toBe(6000);
        });

        it('rejects what is behind the lens or far outside the frame, and allows for size', () => {
            const [ex, ey, ez] = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);
            // Behind.
            expect(visible(ex, ey, ez + 10, 1)).toBe(false);
            expect(visible(ex + 3, ey - 1, ez + 200, 5)).toBe(false);
            // Square off to either side, straight up and straight down.
            expect(visible(ex + 500, ey, ez - 20, 2)).toBe(false);
            expect(visible(ex - 500, ey, ez - 20, 2)).toBe(false);
            expect(visible(ex, ey + 500, ez - 20, 2)).toBe(false);
            expect(visible(ex, ey - 500, ez - 20, 2)).toBe(false);
            // A thing as big as its distance from the frame reaches into it.
            expect(visible(ex, ey, ez + 10, 30)).toBe(true);
            expect(visible(ex + 500, ey, ez - 20, 600)).toBe(true);
            // Straight ahead is on screen at any distance and any size.
            for (const depth of [0.3, 5, 300, 12000]) expect(visible(ex, ey - depth * 0.05, ez - depth, 0)).toBe(true);
            // Where the oak, the gate, the mill and the tarn stand.
            for (const place of [OAK, GATE, MILL, TARN]) {
                expect(visible(place.x, height(place.x, place.z), place.z, 1)).toBe(true);
            }
        });

        it('is conservative: a little outside the frame still counts, for a lens that leans', () => {
            const camera = frameCamera(LANDSCAPE);
            const point = new THREE.Vector3();
            // Just beyond each edge of a 16:9 frame, a hundred metres out.
            for (const [sx, sy] of [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]]) {
                point.set(sx, sy, 0.5).unproject(camera).sub(camera.position).normalize();
                point.multiplyScalar(100).add(camera.position);
                expect(visible(point.x, point.y, point.z, 0)).toBe(true);
            }
        });
    });

    describe('what the land lets the lens see', () => {
        it('sees the ground at its feet and the far side of the valley, but not the slope under the brow', () => {
            const clear = (range) => {
                const [x, z] = along(0, range);
                return verdantHillsInSight(x, height(x, z) + 0.45, z);
            };
            for (const range of [2, 4, 8, 12]) expect(clear(range), `${range} m`).toBe(true);
            // Straight ahead the hill falls away faster than the eye can follow it down.
            const hidden = [];
            for (let range = 20; range <= 150; range += 2) if (!clear(range)) hidden.push(range);
            expect(hidden.length).toBeGreaterThan(30);
            // The valley floor and its far side come back into view.
            const far = [];
            for (let range = 250; range <= 900; range += 10) if (clear(range)) far.push(range);
            expect(far.length).toBeGreaterThan(20);
        });

        it('tells a point in the open from one under the ground or behind a hill', () => {
            const [ex, ey, ez] = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);
            // The sky is always in sight.
            expect(verdantHillsInSight(ex, ey + 100, ez - 400)).toBe(true);
            expect(verdantHillsInSight(ex - 300, ey + 40, ez - 300)).toBe(true);
            // Under the hill ahead, and deep under the valley, never.
            expect(verdantHillsInSight(...[0, height(0, -60) - 15, -60])).toBe(false);
            expect(verdantHillsInSight(0, -200, -500)).toBe(false);
            // The back of the windmill's hill is hidden by the hill.
            const [bx, bz] = along(bearingOf(MILL.x, MILL.z), rangeOf(MILL.x, MILL.z) + 70);
            expect(verdantHillsInSight(bx, height(bx, bz) + 0.3, bz)).toBe(false);
            // The other framing looks from the same hill.
            const { portrait } = VERDANT_HILLS_VIEWS;
            expect(verdantHillsInSight(OAK.x, height(OAK.x, OAK.z) + 1, OAK.z, portrait)).toBe(true);
        });

        describe('planting where it can be seen', () => {
            const CLEARANCE = 0.45;
            const sight = new VerdantHillsSight({ clearance: CLEARANCE });
            const eye = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);

            it('stands at the lens and looks over a fan of bearings', () => {
                expect([sight.eye.x, sight.eye.y, sight.eye.z]).toEqual(eye);
                expect(sight.halfAngle).toBeGreaterThan(degToRad(30));
                expect(sight.halfAngle).toBeLessThanOrEqual(degToRad(VERDANT_HILLS_WEDGE_DEGREES));
                expect(sight.columns.length).toBeGreaterThan(40);
                for (const column of sight.columns) {
                    expect(Math.hypot(column.sin, column.cos)).toBeCloseTo(1, 12);
                    // The ground at the lens's feet is in sight on every bearing.
                    expect(column.stretches.length).toBeGreaterThan(0);
                    let previous = 0;
                    for (const stretch of column.stretches) {
                        expect(stretch.from).toBeGreaterThan(previous);
                        expect(stretch.to).toBeGreaterThan(stretch.from);
                        previous = stretch.to;
                    }
                    expect(column.measure).toBeGreaterThan(0);
                }
                const narrow = new VerdantHillsSight({ halfAngle: 10, columns: 12, farthest: 40 });
                expect(narrow.columns).toHaveLength(12);
                expect(narrow.halfAngle).toBeCloseTo(degToRad(10), 12);
                for (const column of narrow.columns) {
                    for (const stretch of column.stretches) expect(stretch.to).toBeLessThanOrEqual(40);
                }
            });

            it.each([
                [1.3, 17, undefined], [12, 150, undefined], [1.5, 70, degToRad(41)], [3, 30, degToRad(12)],
                [40, 140, degToRad(54)],
            ])('returns only places between %f m and %f m, inside its spread', (nearest, farthest, spread) => {
                const random = seededRandom(83);
                let made = 0;
                let unseen = 0;
                const limit = Math.min(spread ?? sight.halfAngle, sight.halfAngle);
                for (let count = 0; count < 6000; count++) {
                    const spot = sight.spot(random(), random(), nearest, farthest, spread);
                    if (spot) {
                        made += 1;
                        const range = Math.hypot(spot.x - eye[0], spot.z - eye[2]);
                        expect(spot.depth).toBeCloseTo(range, 9);
                        if (!(range >= nearest - 1e-9 && range <= farthest + 1e-9)) throw new Error(`range ${range}`);
                        const bearing = Math.atan2(spot.x - eye[0], -(spot.z - eye[2]));
                        if (Math.abs(bearing) > limit + 1e-9) throw new Error(`bearing ${radToDeg(bearing)}`);
                        // On the ground ...
                        expect(spot.y).toBe(height(spot.x, spot.z));
                        // ... and what grows there can be seen from the lens.
                        if (!verdantHillsInSight(spot.x, spot.y + CLEARANCE, spot.z)) unseen += 1;
                    }
                }
                expect(made).toBeGreaterThan(300);
                // Bearings are walked in columns and distances in strides, so a spot at the very
                // edge of a hidden stretch may be a blade's width out of sight; no more than that.
                expect(unseen / made).toBeLessThan(0.02);
            });

            it('finds nothing on a bearing whose ground in the band is all behind the brow', () => {
                // Straight ahead, the band the brow hides.
                const hidden = [];
                for (let range = 30; range <= 150; range += 1) {
                    const [x, z] = along(0, range);
                    if (!verdantHillsInSight(x, height(x, z) + CLEARANCE, z)) hidden.push(range);
                }
                const [from, to] = [hidden[5], hidden[hidden.length - 5]];
                expect(to - from).toBeGreaterThan(40);
                for (let step = 0; step <= 100; step++) expect(sight.spot(0.5, step / 100, from, to)).toBeNull();
                // The same bearing has plenty in sight nearer the lens.
                expect(sight.spot(0.5, 0.1, 1.5, 15)).not.toBeNull();
                // And an empty or inside-out band has nothing anywhere.
                expect(sight.spot(0.3, 0.5, 50, 50)).toBeNull();
                expect(sight.spot(0.3, 0.5, 80, 20)).toBeNull();
            });

            it('plants a bearing in proportion to how much of its band is in sight', () => {
                // On the gate's spur the back of the hill stays in view; straight ahead it does not.
                const share = (u) => {
                    let found = 0;
                    for (let step = 0; step < 400; step++) if (sight.spot(u, (step + 0.5) / 400, 2, 140)) found += 1;
                    return found / 400;
                };
                const spur = share((bearingOf(GATE.x, GATE.z) / sight.halfAngle + 1) / 2);
                const ahead = share(0.5);
                expect(spur).toBeGreaterThan(0.9);
                expect(ahead).toBeLessThan(0.75);
                expect(ahead).toBeGreaterThan(0.3);
                // The draws that fail are the far ones: `v` is the distance.
                expect(sight.spot(0.5, 0.01, 2, 140)).not.toBeNull();
                expect(sight.spot(0.5, 0.99, 2, 140)).toBeNull();
            });

            it('spreads its places evenly in the logarithm of their distance', () => {
                const u = (bearingOf(GATE.x, GATE.z) / sight.halfAngle + 1) / 2;
                const random = seededRandom(97);
                const octaves = new Array(6).fill(0);
                let made = 0;
                for (let count = 0; count < 12000; count++) {
                    const spot = sight.spot(u, random(), 2, 128);
                    if (spot) {
                        octaves[Math.min(5, Math.floor(Math.log2(spot.depth / 2)))] += 1;
                        made += 1;
                    }
                }
                expect(made).toBeGreaterThan(10000);
                // As many between 2 m and 4 m as between 64 m and 128 m.
                for (const count of octaves) {
                    expect(count).toBeGreaterThan((made / 6) * 0.8);
                    expect(count).toBeLessThan((made / 6) * 1.2);
                }
                // `v` runs outward: a larger draw is a farther place on the same bearing.
                let previous = 0;
                for (let step = 0; step < 50; step++) {
                    const spot = sight.spot(u, (step + 0.5) / 50, 2, 128);
                    if (spot) {
                        expect(spot.depth).toBeGreaterThan(previous);
                        previous = spot.depth;
                    }
                }
            });

            it('gives the same place for the same draw, and follows `u` across the view', () => {
                expect(sight.spot(0.31, 0.2, 2, 100)).toEqual(sight.spot(0.31, 0.2, 2, 100));
                const left = sight.spot(0, 0.05, 2, 20);
                const middle = sight.spot(0.5, 0.05, 2, 20);
                const right = sight.spot(1, 0.05, 2, 20);
                expect(left.x).toBeLessThan(middle.x - 1);
                expect(right.x).toBeGreaterThan(middle.x + 1);
                expect(middle.x).toBeCloseTo(eye[0], 6);
                expect(radToDeg(bearingOf(left.x, left.z))).toBeCloseTo(-radToDeg(sight.halfAngle), 6);
                expect(radToDeg(bearingOf(right.x, right.z))).toBeCloseTo(radToDeg(sight.halfAngle), 6);
            });
        });
    });
});
