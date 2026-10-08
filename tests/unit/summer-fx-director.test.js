import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { summerEye, summerViewFor } from '../../src/themes/summer/summer-composition.js';
import { SummerFxDirector } from '../../src/themes/summer/summer-fx-director.js';
import { SUMMER_PARTICLES, SummerPetalSim } from '../../src/themes/summer/summer-petal-sim.js';
import { SUMMER_TIERS } from '../../src/themes/summer/summer-quality.js';
import {
    SUMMER_BOUQUET_KINDS, SUMMER_MIXED, SUMMER_PIECE_FLOWERS, SummerReactions,
} from '../../src/themes/summer/summer-reactions.js';
import { SummerRings } from '../../src/themes/summer/summer-rings.js';
import {
    SUMMER_DEFAULT_BOARD, SUMMER_STAGE_DEPTH, SummerStage, readSummerBoardRect,
} from '../../src/themes/summer/summer-stage.js';
import {
    SUMMER_PLACES, summerGroundHeight, summerShoreDistance,
} from '../../src/themes/summer/summer-terrain.js';

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;
const TIERS = Object.keys(SUMMER_TIERS);
const LETTERS = Object.keys(SUMMER_PIECE_FLOWERS);
const { petal: PETAL, seed: SEED, pollen: POLLEN } = SUMMER_PARTICLES;
/** The pool the director's throws are written for; other tiers scale from it. */
const REFERENCE = SUMMER_TIERS.High;
/** Land everywhere, a metre up: for tests that must not depend on where the shore runs. */
const PLAIN = () => 1;

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** The camera as SummerWorld.prepareCamera() frames it for an aspect ratio. */
function frameCamera(aspect = LANDSCAPE) {
    const view = summerViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.25, 3600);
    camera.position.set(...summerEye(view));
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateProjectionMatrix();
    return camera;
}

/** An arbitrary pose with yaw, pitch and roll, to prove the maths is not tied to the meadow's view. */
function tiltedCamera(pitch = 0.4) {
    const camera = new THREE.PerspectiveCamera(38, 1.3, 0.1, 500);
    camera.position.set(4, 7, -3);
    camera.rotation.set(pitch, -1.1, 0.25, 'YXZ');
    camera.updateProjectionMatrix();
    return camera;
}

/** Standing on a jetty looking steeply down at the water under it. */
function downwardCamera() {
    const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 500);
    camera.position.set(2, 5, 3);
    camera.lookAt(2, 0, 0.5);
    camera.updateProjectionMatrix();
    return camera;
}

function expectVector(actual, expected, digits = 9) {
    expect(actual.x).toBeCloseTo(expected.x, digits);
    expect(actual.y).toBeCloseTo(expected.y, digits);
    expect(actual.z).toBeCloseTo(expected.z, digits);
}

function ndc(point, camera) {
    return new THREE.Vector3(point.x, point.y, point.z).project(camera);
}

/** Where the bouquet is thrown from: the top of the maypole and a wreath on either arm. */
function maypoleAnchors() {
    const { x, z } = SUMMER_PLACES.maypole;
    const foot = summerGroundHeight(x, z);
    return {
        top: new THREE.Vector3(x, foot + 7, z),
        wreaths: [new THREE.Vector3(x - 1.6, foot + 5, z + 0.4), new THREE.Vector3(x + 1.6, foot + 5, z - 0.4)],
    };
}

function emitter(overrides = {}) {
    const result = {
        id: 0,
        serial: 0,
        kind: 'lock',
        side: -1,
        column: 0.1,
        row: 0.5,
        strength: 0.5,
        lines: 0,
        flower: SUMMER_MIXED,
        age: 0,
        duration: 2,
        seed: 0.3,
        active: true,
        ...overrides,
    };
    return { ...result, progress: result.age / result.duration };
}

function queued(serial, column = 0.5, row = 0.5, strength = 1) {
    return {
        serial, column, row, strength,
    };
}

function frameWith(emitters = [], rest = {}) {
    return {
        epoch: 1,
        gust: 0,
        warmth: 0,
        shafts: 0,
        glow: 0,
        shimmer: 0,
        flock: 0,
        flutter: 0,
        crown: 0,
        heat: 0,
        ribbons: 0,
        streak: 0,
        settled: false,
        front: null,
        rings: [],
        waves: [],
        emitters,
        ...rest,
    };
}

function spySim() {
    const sim = { spawn: vi.fn(() => 0), touchCount: 0, touches: [] };
    sim.thrown = () => sim.spawn.mock.calls.map(([x, y, z, vx, vy, vz, options = {}]) => ({
        x, y, z, vx, vy, vz, ...options,
    }));
    return sim;
}

function createDirector({
    aspect = LANDSCAPE, petals = REFERENCE.petals, seed = 271, sim = spySim(), rings = 8, gusts = 6,
    groundHeight = summerGroundHeight, maypole = maypoleAnchors(), ...options
} = {}) {
    const camera = frameCamera(aspect);
    const stage = new SummerStage(camera);
    const ripples = new SummerRings(rings);
    const waves = new SummerRings(gusts);
    const rung = vi.spyOn(ripples, 'add');
    const blown = vi.spyOn(waves, 'add');
    const director = new SummerFxDirector({
        stage, sim, ripples, waves, tier: { petals }, rng: seededRandom(seed), groundHeight, maypole, ...options,
    });
    return {
        camera, stage, sim, ripples, waves, rung, blown, director,
    };
}

/** Age a set of emitters through the director and report what each frame did. */
function play(director, sim, emitters, { seconds, dt = STEP, frame = {} }) {
    const specs = emitters.map((entry, index) => emitter({ id: index, serial: index, ...entry }));
    const log = [];
    const steps = Math.round(seconds / dt);
    for (let step = 0; step <= steps; step++) {
        const age = step * dt;
        const before = sim.spawn.mock.calls.length;
        const live = specs.filter((spec) => age < spec.duration).map((spec) => emitter({ ...spec, age }));
        const env = director.apply(frameWith(live, frame), dt);
        log.push({
            age,
            spawned: sim.spawn.mock.calls.length - before,
            fields: env.fields.map((field) => ({ ...field })),
        });
    }
    return log;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => sum(values) / values.length;
const flatDistance = (point, origin) => Math.hypot(point.x - origin.x, point.z - origin.z);
const groundUnder = (point) => Math.max(0, summerGroundHeight(point.x, point.z));
const pieceOf = (letter, x = 4, y = 20) => ({
    x, y, shape: [[1]], shapeKey: letter,
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Summer stage', () => {
    it.each([
        ['the landscape meadow view', () => frameCamera(LANDSCAPE)],
        ['the portrait meadow view', () => frameCamera(PORTRAIT)],
        ['an arbitrary tilted camera', tiltedCamera],
    ])('maps screen fractions onto a plane in front of %s', (_label, makeCamera) => {
        const camera = makeCamera();
        const stage = new SummerStage(camera);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        for (const depth of [1, SUMMER_STAGE_DEPTH, 40]) {
            // The middle of the screen lies on the camera's axis, `depth` metres out.
            expectVector(stage.point(0.5, 0.5, depth), camera.position.clone().addScaledVector(forward, depth));
            for (const [sx, sy] of [[0, 0], [1, 1], [0.2, 0.7], [0.9, 0.05], [-0.3, 1.4]]) {
                const point = stage.point(sx, sy, depth);
                // y runs down the screen, as DOM rectangles do.
                const projected = ndc(point, camera);
                expect(projected.x).toBeCloseTo(sx * 2 - 1, 9);
                expect(projected.y).toBeCloseTo(1 - sy * 2, 9);
                expect(point.clone().sub(camera.position).dot(forward)).toBeCloseTo(depth, 9);
            }
        }
        expectVector(stage.point(0.3, 0.6), stage.point(0.3, 0.6, SUMMER_STAGE_DEPTH));
        const target = new THREE.Vector3(9, 9, 9);
        expect(stage.point(0.3, 0.6, 5, target)).toBe(target);
        expectVector(target, stage.point(0.3, 0.6, 5));
        expect(stage.halfWidth(10)).toBeCloseTo(stage.point(1, 0.5, 10).distanceTo(stage.point(0.5, 0.5, 10)), 9);
        expect(stage.halfWidth()).toBeCloseTo(stage.halfWidth(SUMMER_STAGE_DEPTH), 12);
    });

    it.each([
        ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
    ])('finds the card edges, its centre and its rows in %s', (_label, aspect) => {
        const camera = frameCamera(aspect);
        const stage = new SummerStage(camera);
        expect(stage.board).toEqual(SUMMER_DEFAULT_BOARD);
        expect(stage.board).not.toBe(SUMMER_DEFAULT_BOARD);
        const {
            x0, x1, y0, y1,
        } = stage.board;
        for (const row of [0, 0.25, 0.5, 1]) {
            const left = stage.edge(-1, row);
            const right = stage.edge(1, row);
            expect(ndc(left, camera).x).toBeCloseTo(x0 * 2 - 1, 9);
            expect(ndc(right, camera).x).toBeCloseTo(x1 * 2 - 1, 9);
            // Row 0 is the foot of the card, row 1 its top.
            const screenY = y1 + (y0 - y1) * row;
            expect(ndc(left, camera).y).toBeCloseTo(1 - screenY * 2, 9);
            expect(ndc(right, camera).y).toBeCloseTo(1 - screenY * 2, 9);
            expect(stage.screen(0, row).x).toBeCloseTo(x0, 12);
            expect(stage.screen(0, row).y).toBeCloseTo(screenY, 12);
            expect(stage.screen(1, row).x).toBeCloseTo(x1, 12);
        }
        expect(stage.edge(-1, 1).y).toBeGreaterThan(stage.edge(-1, 0).y + 3);
        // Rows and columns outside the card are clamped onto it.
        expectVector(stage.edge(1, -4), stage.edge(1, 0));
        expectVector(stage.edge(1, 9), stage.edge(1, 1));
        expect(stage.screen(-3, 7).x).toBeCloseTo(x0, 12);
        expect(stage.screen(-3, 7).y).toBeCloseTo(y0, 12);
        expect(stage.screen(0.5, 0.5).x).toBeCloseTo((x0 + x1) / 2, 12);
        // An inset moves the point in from either edge, toward the middle of the card.
        expect(ndc(stage.edge(-1, 0.5, 6, undefined, 0.02), camera).x).toBeCloseTo((x0 + 0.02) * 2 - 1, 9);
        expect(ndc(stage.edge(1, 0.5, 6, undefined, 0.02), camera).x).toBeCloseTo((x1 - 0.02) * 2 - 1, 9);
        const centre = ndc(stage.centre(), camera);
        expect(centre.x).toBeCloseTo(x0 + x1 - 1, 9);
        expect(centre.y).toBeCloseTo(1 - (y0 + y1), 9);
        const target = new THREE.Vector3();
        expect(stage.edge(1, 0.5, 4, target)).toBe(target);
        expect(stage.centre(4, target)).toBe(target);
    });

    describe('the lake behind the card', () => {
        it.each([
            ['landscape', () => frameCamera(LANDSCAPE)],
            ['portrait', () => frameCamera(PORTRAIT)],
            ['a tilted camera looking down', () => tiltedCamera(-0.45)],
            ['a tilted camera looking up', () => tiltedCamera(0.4)],
        ])('finds the point at lake level seen through a screen position in %s', (_label, makeCamera) => {
            const camera = makeCamera();
            const stage = new SummerStage(camera);
            const reaches = [];
            let exact = 0;
            for (let sx = 0; sx <= 1.001; sx += 0.125) {
                for (let sy = 0; sy <= 1.001; sy += 0.05) {
                    const point = stage.water(sx, sy);
                    // Always at the level of the lake.
                    expect(point.y).toBe(0);
                    const distance = flatDistance(point, camera.position);
                    reaches.push(distance);
                    // It lies under the ray through that screen position: same compass bearing.
                    const ray = stage.point(sx, sy, 1).sub(camera.position);
                    const flat = Math.hypot(ray.x, ray.z);
                    expect((point.x - camera.position.x) / distance).toBeCloseTo(ray.x / flat, 9);
                    expect((point.z - camera.position.z) / distance).toBeCloseTo(ray.z / flat, 9);
                    const projected = ndc(point, camera);
                    if (Math.abs(projected.x - (sx * 2 - 1)) < 1e-6 && Math.abs(projected.y - (1 - sy * 2)) < 1e-6) {
                        exact += 1;
                    }
                }
            }
            // Never further or nearer than a reach that is the same for every position.
            const [nearest, furthest] = [Math.min(...reaches), Math.max(...reaches)];
            expect(nearest).toBeGreaterThan(1);
            expect(furthest).toBeLessThan(200);
            for (let sx = 0; sx <= 1.001; sx += 0.25) {
                const ray = stage.point(sx, 0.02, 1).sub(camera.position);
                // Looking at or above the horizon there is no such point: the far end stands in.
                if (ray.y >= 0) expect(flatDistance(stage.water(sx, 0.02), camera.position)).toBeCloseTo(furthest, 9);
            }
            // The camera that looks up sees no water at all; every other view sees plenty.
            if (camera.getWorldDirection(new THREE.Vector3()).y > 0.2) expect(exact).toBe(0);
            else expect(exact).toBeGreaterThan(20);
        });

        it('comes nearer as the position moves down the screen and follows it sideways', () => {
            const camera = frameCamera(LANDSCAPE);
            const stage = new SummerStage(camera);
            let previous = Infinity;
            for (let sy = 0.4; sy <= 1.001; sy += 0.05) {
                const distance = flatDistance(stage.water(0.5, sy), camera.position);
                expect(distance).toBeLessThanOrEqual(previous);
                previous = distance;
            }
            expect(previous).toBeLessThan(flatDistance(stage.water(0.5, 0.4), camera.position) / 2);
            // This view looks straight down the lake: left on screen is west on the water.
            expect(stage.water(0.2, 0.8).x).toBeLessThan(stage.water(0.5, 0.8).x);
            expect(stage.water(0.8, 0.8).x).toBeGreaterThan(stage.water(0.5, 0.8).x);
            expect(stage.water(0.5, 0.8).x).toBeCloseTo(0, 9);
            // The upper half of the default card looks out over open water.
            for (const row of [0.5, 0.75, 1]) {
                const through = stage.screen(0.5, row);
                const point = stage.water(through.x, through.y);
                expect(summerGroundHeight(point.x, point.z), `row ${row}`).toBeLessThan(0);
                expect(point.z).toBeLessThan(camera.position.z);
            }
        });

        it('never returns a point at the eye\'s feet, however steeply the camera looks down', () => {
            const camera = downwardCamera();
            const stage = new SummerStage(camera);
            // The true intersection under the middle of the screen is 2.5 m out.
            const point = stage.water(0.5, 0.5);
            expect(point.y).toBe(0);
            const nearest = flatDistance(point, camera.position);
            expect(nearest).toBeGreaterThan(2.5);
            expect(point.x).toBeCloseTo(2, 9);
            expect(point.z).toBeCloseTo(3 - nearest, 9);
            // Steeper still is the same nearest reach, not nearer.
            expect(flatDistance(stage.water(0.5, 0.9), camera.position)).toBeCloseTo(nearest, 9);
            // Higher on the screen the ray flattens and reaches further again, exactly.
            const further = stage.water(0.5, 0.05);
            expect(flatDistance(further, camera.position)).toBeGreaterThan(nearest + 0.5);
            expect(ndc(further, camera).y).toBeCloseTo(0.9, 6);
        });

        it('writes into the vector it is given and leaves its own state reusable', () => {
            const stage = new SummerStage(frameCamera());
            const target = new THREE.Vector3(7, 7, 7);
            expect(stage.water(0.3, 0.8, target)).toBe(target);
            const first = target.clone();
            const other = stage.water(0.9, 0.7);
            expect(other).not.toBe(target);
            // A look at the land in between does not disturb it.
            stage.ground(0.6, 0.9, summerGroundHeight);
            expectVector(stage.water(0.3, 0.8), first, 12);
            expect(other.x).not.toBeCloseTo(first.x, 3);
        });
    });

    describe('the land at its foot', () => {
        it.each([
            ['landscape', () => frameCamera(LANDSCAPE)],
            ['portrait', () => frameCamera(PORTRAIT)],
            ['a tilted camera looking down', () => tiltedCamera(-0.45)],
        ])('finds where a ray through the screen meets level ground in %s', (_label, makeCamera) => {
            const camera = makeCamera();
            const stage = new SummerStage(camera);
            for (const level of [0.5, 1.5]) {
                let met = 0;
                for (let sx = 0; sx <= 1.001; sx += 0.25) {
                    for (let sy = 0.5; sy <= 1.001; sy += 0.05) {
                        const point = stage.ground(sx, sy, () => level);
                        // Always on the ground it was asked about.
                        expect(point.y).toBe(level);
                        const ray = stage.point(sx, sy, 1).sub(camera.position);
                        const reach = (level - camera.position.y) / ray.y;
                        if (ray.y < 0 && reach * ray.length() > 2 && reach * ray.length() < 60) {
                            // Inside its reach it is what the eye sees there, to a few centimetres.
                            const exact = camera.position.clone().addScaledVector(ray, reach);
                            expect(point.distanceTo(exact)).toBeLessThan(0.08);
                            met += 1;
                        }
                    }
                }
                expect(met).toBeGreaterThan(10);
            }
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('returns a point on the land it is given, in %s', (_label, aspect) => {
            const camera = frameCamera(aspect);
            const stage = new SummerStage(camera);
            let onLand = 0;
            let onWater = 0;
            const met = [];
            const missed = [];
            for (let sx = 0; sx <= 1.001; sx += 0.1) {
                for (let sy = 0; sy <= 1.001; sy += 0.05) {
                    const point = stage.ground(sx, sy, summerGroundHeight);
                    const height = summerGroundHeight(point.x, point.z);
                    // On the meadow where there is meadow, on the surface of the lake where there is not.
                    expect(point.y).toBe(Math.max(0, height));
                    expect(Number.isFinite(point.x) && Number.isFinite(point.z)).toBe(true);
                    // Under the ray through that screen position: same compass bearing.
                    const ray = stage.point(sx, sy, 1).sub(camera.position);
                    const flat = Math.hypot(ray.x, ray.z);
                    const distance = flatDistance(point, camera.position);
                    expect((point.x - camera.position.x) / distance).toBeCloseTo(ray.x / flat, 6);
                    expect((point.z - camera.position.z) / distance).toBeCloseTo(ray.z / flat, 6);
                    // Where the ray has come down to the ground the point is on it; where it never
                    // does, the ray is still in the air above the point. It is never under the ground.
                    const clearance = camera.position.y + ray.y * (distance / flat) - point.y;
                    expect(clearance).toBeGreaterThan(-0.1);
                    const reach = (distance / flat) * ray.length();
                    if (clearance < 0.1) met.push(reach);
                    else missed.push(reach);
                    if (height > 0) onLand += 1;
                    else onWater += 1;
                }
            }
            // The view holds both: meadow at the foot of the screen, lake beyond it.
            expect(onLand).toBeGreaterThan(20);
            expect(onWater).toBeGreaterThan(20);
            // The lower half of the screen meets the ground; nothing that misses ends nearer than a hit.
            expect(met.length).toBeGreaterThan(60);
            expect(missed.length).toBeGreaterThan(20);
            expect(Math.min(...missed)).toBeGreaterThan(Math.max(...met) - 1);
            // The foot of the default card stands in the meadow, all the way across.
            for (const column of [0, 0.25, 0.5, 0.75, 1]) {
                const foot = stage.screen(column, 0);
                const point = stage.ground(foot.x, foot.y, summerGroundHeight);
                expect(summerShoreDistance(point.x, point.z), `column ${column}`).toBeGreaterThan(1);
                expect(point.y).toBeGreaterThan(0);
                expect(point.z).toBeLessThan(camera.position.z);
            }
        });

        it('stops at the first land in the way and comes nearer as the position moves down the screen', () => {
            const camera = frameCamera(LANDSCAPE);
            const stage = new SummerStage(camera);
            let previous = Infinity;
            for (let sy = 0.55; sy <= 1.001; sy += 0.05) {
                const distance = flatDistance(stage.ground(0.5, sy, () => 0.5), camera.position);
                expect(distance).toBeLessThan(previous);
                previous = distance;
            }
            // A bank across the view hides the ground behind it.
            const bank = (x, z) => (z < camera.position.z - 6 && z > camera.position.z - 8 ? 50 : 0.5);
            const open = stage.ground(0.5, 0.62, () => 0.5);
            const hidden = stage.ground(0.5, 0.62, bank);
            expect(flatDistance(open, camera.position)).toBeGreaterThan(12);
            expect(flatDistance(hidden, camera.position)).toBeGreaterThan(5.9);
            expect(flatDistance(hidden, camera.position)).toBeLessThan(6.2);
            expect(hidden.y).toBe(50);
            // Left on screen is left on the ground.
            expect(stage.ground(0.2, 0.9, () => 0.5).x).toBeLessThan(stage.ground(0.8, 0.9, () => 0.5).x);
        });

        it('ends a ray that meets nothing at its far reach, still on the land it was given', () => {
            const camera = frameCamera(LANDSCAPE);
            const stage = new SummerStage(camera);
            const reaches = [];
            for (const [sx, sy] of [[0.5, 0], [0.1, 0.1], [0.9, 0.3], [0.5, 0.45]]) {
                const point = stage.ground(sx, sy, () => -2);
                // Lake bed is not land: the point is on the water.
                expect(point.y).toBe(0);
                reaches.push(point.clone().setY(camera.position.y).distanceTo(camera.position));
                expect(stage.ground(sx, sy, () => 0.25).y).toBe(0.25);
            }
            // Each is as far as the ray is followed, which is further than any meadow in the view.
            const nearest = flatDistance(stage.ground(0.5, 0.6, summerGroundHeight), camera.position);
            for (const reach of reaches) {
                expect(reach).toBeGreaterThan(nearest);
                expect(reach).toBeLessThan(200);
            }
            const target = new THREE.Vector3(7, 7, 7);
            expect(stage.ground(0.5, 0.9, summerGroundHeight, target)).toBe(target);
            expectVector(target, stage.ground(0.5, 0.9, summerGroundHeight), 12);
        });
    });

    describe('open water along a bearing', () => {
        /** Metres from the eye, and the compass bearing as a unit vector. */
        const bearingOf = (point, stage) => {
            const distance = flatDistance(point, stage.origin);
            return { distance, x: (point.x - stage.origin.x) / distance, z: (point.z - stage.origin.z) / distance };
        };

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT], ['a wide screen', 21 / 9], ['a square screen', 1],
        ])('finds the lake in the direction of every column of the card in %s', (_label, aspect) => {
            const stage = new SummerStage(frameCamera(aspect));
            const { x0, x1 } = stage.board;
            for (let sx = x0 - 0.1; sx <= x1 + 0.1001; sx += 0.02) {
                const straight = stage.point(sx, 0.5, 1).sub(stage.origin);
                const flat = Math.hypot(straight.x, straight.z);
                let previous = 0;
                for (const out of [0, 0.5, 1.5, 4.2, 9.9, 17.3, 27.5]) {
                    const point = stage.lake(sx, out, summerGroundHeight);
                    // On the surface of the lake, with water under it.
                    expect(point.y).toBe(0);
                    expect(summerGroundHeight(point.x, point.z), `column ${sx}, ${out} m out`).toBeLessThan(0);
                    // On the compass bearing of that column, whatever height the card stands at.
                    const { distance, x, z } = bearingOf(point, stage);
                    expect(x).toBeCloseTo(straight.x / flat, 9);
                    expect(z).toBeCloseTo(straight.z / flat, 9);
                    // Further out for a larger reach, never by more than was asked. (Where a far
                    // shore cuts the reach short it is drawn back a stride at a time, so two reaches
                    // that both run aground may end within a stride of each other in either order.)
                    expect(distance).toBeGreaterThan(previous - 1);
                    if (out > 0) expect(distance - previous).toBeLessThanOrEqual(out + 1e-9);
                    previous = Math.max(previous, distance);
                }
                // There is room on every bearing for the far ring to open well beyond the near one.
                const near = bearingOf(stage.lake(sx, 0, summerGroundHeight), stage).distance;
                expect(previous).toBeGreaterThan(near + 5);
                // Past the meadow at the foot of the card, not in it.
                const foot = stage.ground(sx, stage.board.y1, summerGroundHeight);
                expect(near).toBeGreaterThan(flatDistance(foot, stage.origin));
            }
            // Straight behind the card the lake is wide: the whole reach asked for is open water.
            const span = (out) => bearingOf(stage.lake(0.5, out, summerGroundHeight), stage).distance;
            expect(span(27.5) - span(0)).toBeCloseTo(27.5, 9);
        });

        it('opens further out by exactly the reach asked for, and draws back from a far shore', () => {
            const camera = frameCamera(LANDSCAPE);
            const stage = new SummerStage(camera);
            // A channel across the view: bank, water from 10.5 m to 30 m ahead, then land again.
            const channel = (x, z) => (camera.position.z - z > 10.5 && camera.position.z - z < 30 ? -1 : 1);
            const ahead = (out) => camera.position.z - stage.lake(0.5, out, channel).z;
            const shore = ahead(0);
            // The first water past the near bank, to within a stride.
            expect(shore).toBeGreaterThan(10.5);
            expect(shore).toBeLessThan(11.6);
            expect(ahead(5)).toBeCloseTo(shore + 5, 9);
            expect(ahead(12.25)).toBeCloseTo(shore + 12.25, 9);
            // A reach that would land on the far bank stops on the last of the water instead.
            for (const out of [19.5, 25, 80, 1e6]) {
                const drawn = ahead(out);
                expect(drawn, `${out} m out`).toBeLessThan(30);
                expect(drawn, `${out} m out`).toBeGreaterThan(28);
                expect(channel(0, camera.position.z - drawn)).toBeLessThan(0);
            }
            // No reach, a negative one or one that is not a number opens at the shore.
            for (const out of [-5, NaN, undefined, null, 'far', Infinity]) expect(ahead(out), String(out)).toBe(shore);
            // To the side the same channel is further along the bearing, and still found.
            const aside = stage.lake(0.9, 3, channel);
            expect(channel(aside.x, aside.z)).toBeLessThan(0);
            expect(aside.x).toBeGreaterThan(3);
            expect(aside.y).toBe(0);
        });

        // Regression: the draw-back stepped a whole metre at a time from shore + out, so a reach with
        // a fraction could step to just short of the first water and return a point on the bank.
        it('never draws back past the first water onto the near bank', () => {
            const camera = frameCamera(LANDSCAPE);
            const stage = new SummerStage(camera);
            // A ditch less than half a metre wide, twenty metres ahead.
            const ditch = (x, z) => (Math.abs(camera.position.z - z - 20.1) < 0.2 ? -1 : 1);
            const shore = stage.lake(0.5, 0, ditch).clone();
            expect(ditch(shore.x, shore.z)).toBeLessThan(0);
            for (const out of [0.5, 0.7, 1.5, 2.7, 10.4, 25, 1e6]) {
                const point = stage.lake(0.5, out, ditch);
                expect(ditch(point.x, point.z), `${out} m out`).toBeLessThan(0);
                // Nowhere else to go: it is the first water itself.
                expectVector(point, shore, 9);
            }
            // The same on the real lake, for reaches of every fraction: never a point on land.
            for (const aspect of [LANDSCAPE, PORTRAIT]) {
                const real = new SummerStage(frameCamera(aspect));
                for (let sx = real.board.x0; sx <= real.board.x1; sx += 0.005) {
                    for (let out = 0; out <= 70; out += 0.73) {
                        const point = real.lake(sx, out, summerGroundHeight);
                        const bed = summerGroundHeight(point.x, point.z);
                        if (!(bed < 0)) throw new Error(`aground at column ${sx}, ${out} m out`);
                    }
                }
            }
        });

        it('falls back to lake level under the bearing when there is no water that way', () => {
            const camera = frameCamera(LANDSCAPE);
            const stage = new SummerStage(camera);
            for (const sx of [0.1, 0.5, 0.8]) {
                const dry = stage.lake(sx, 12, () => 1);
                // Still a point at lake level, ahead of the camera on the column's bearing ...
                expect(dry.y).toBe(0);
                expect(Number.isFinite(dry.x) && Number.isFinite(dry.z)).toBe(true);
                expect(dry.z).toBeLessThan(camera.position.z);
                const straight = stage.point(sx, 0.5, 1).sub(stage.origin);
                const flat = Math.hypot(straight.x, straight.z);
                const { x, z } = bearingOf(dry, stage);
                expect(x).toBeCloseTo(straight.x / flat, 1);
                expect(z).toBeCloseTo(straight.z / flat, 1);
                // ... and one that does not depend on a reach there is no shore to measure from.
                expectVector(stage.lake(sx, 0, () => 1), dry, 12);
                expectVector(stage.lake(sx, 99, () => 1), dry, 12);
                // It is one of the points water() gives for that column.
                const candidates = [];
                for (let sy = 0; sy <= 1.001; sy += 0.05) candidates.push(stage.water(sx, sy).distanceTo(dry));
                expect(Math.min(...candidates)).toBeLessThan(1e-9);
            }
            // Water too shallow to be the lake is not water either.
            const puddle = stage.lake(0.5, 5, () => -0.001);
            expectVector(puddle, stage.lake(0.5, 5, () => 1), 12);
        });

        it('writes into the vector it is given and leaves the other lookups undisturbed', () => {
            const stage = new SummerStage(frameCamera());
            const target = new THREE.Vector3(7, 7, 7);
            expect(stage.lake(0.3, 6, summerGroundHeight, target)).toBe(target);
            const first = target.clone();
            const water = stage.water(0.6, 0.7).clone();
            const ground = stage.ground(0.6, 0.9, summerGroundHeight).clone();
            expect(stage.lake(0.7, 2, summerGroundHeight)).not.toBe(target);
            expectVector(stage.water(0.6, 0.7), water, 12);
            expectVector(stage.ground(0.6, 0.9, summerGroundHeight), ground, 12);
            expectVector(stage.lake(0.3, 6, summerGroundHeight), first, 12);
            expectVector(target, first, 12);
        });
    });

    it('accepts a measured card, clamps it to the screen and falls back to the default for junk', () => {
        const stage = new SummerStage(frameCamera());
        const measured = {
            x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
        };
        stage.setBoard(measured);
        expect(stage.board).toEqual(measured);
        // The stage keeps its own copy.
        measured.x0 = 0.9;
        expect(stage.board.x0).toBe(0.05);
        stage.setBoard({
            x0: -0.2, x1: 0.4, y0: -1, y1: 2,
        });
        expect(stage.board).toEqual({
            x0: 0, x1: 0.4, y0: 0, y1: 1,
        });
        const junk = [null, undefined, {}, 'board', 42, [], {
            x0: NaN, x1: 0.5, y0: 0.1, y1: 0.9,
        },
        { x0: 0.1, x1: 0.5, y0: 0.1 }, {
            x0: '0.1', x1: 0.5, y0: 0.1, y1: 0.9,
        },
        {
            x0: 0.9, x1: 0.1, y0: 0, y1: 1,
        }, {
            x0: 0.1, x1: 0.9, y0: 0.8, y1: 0.2,
        },
        // A sliver is not a board.
        {
            x0: 0.5, x1: 0.501, y0: 0.1, y1: 0.9,
        }, {
            x0: 0.2, x1: 0.8, y0: 0.5, y1: 0.501,
        },
        {
            x0: 0.1, x1: Infinity, y0: 0.1, y1: 0.9,
        }];
        for (const rect of junk) {
            stage.setBoard({
                x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
            });
            expect(() => stage.setBoard(rect)).not.toThrow();
            expect(stage.board, JSON.stringify(rect)).toEqual(SUMMER_DEFAULT_BOARD);
        }
        expect(Object.isFrozen(SUMMER_DEFAULT_BOARD)).toBe(true);
        expect(SUMMER_DEFAULT_BOARD.x1).toBeGreaterThan(SUMMER_DEFAULT_BOARD.x0);
        expect(SUMMER_DEFAULT_BOARD.y1).toBeGreaterThan(SUMMER_DEFAULT_BOARD.y0);
        // The edges follow the card at once.
        const camera = frameCamera();
        const framed = new SummerStage(camera);
        framed.setBoard({
            x0: 0.6, x1: 0.9, y0: 0.2, y1: 0.8,
        });
        expect(ndc(framed.edge(-1, 0), camera).x).toBeCloseTo(0.2, 9);
        expect(ndc(framed.edge(1, 0), camera).x).toBeCloseTo(0.8, 9);
        expect(ndc(framed.centre(), camera).y).toBeCloseTo(0, 9);
    });

    it('keeps the rest pose it read until it is refreshed', () => {
        const camera = frameCamera();
        const stage = new SummerStage(camera);
        const origin = stage.origin.clone();
        const centre = stage.centre().clone();
        const water = stage.water(0.5, 0.8).clone();
        const ground = stage.ground(0.5, 0.9, summerGroundHeight).clone();
        // Pointer parallax moves the live camera every frame; the stage must not follow it.
        camera.position.x += 3;
        camera.rotation.y += 0.4;
        camera.fov = 80;
        camera.aspect = 0.5;
        camera.updateProjectionMatrix();
        expectVector(stage.origin, origin, 12);
        expectVector(stage.centre(), centre, 12);
        expectVector(stage.water(0.5, 0.8), water, 12);
        expectVector(stage.ground(0.5, 0.9, summerGroundHeight), ground, 12);
        stage.refresh();
        expect(stage.origin.x).toBeCloseTo(origin.x + 3, 9);
        expect(stage.tanV).toBeCloseTo(Math.tan(THREE.MathUtils.degToRad(40)), 12);
        expect(stage.tanH).toBeCloseTo(stage.tanV * 0.5, 12);
        expect(ndc(stage.centre(), camera).x).toBeCloseTo(0, 9);
        expect(stage.water(0.5, 0.8).distanceTo(water)).toBeGreaterThan(1);
        expect(stage.ground(0.5, 0.9, summerGroundHeight).distanceTo(ground)).toBeGreaterThan(1);
    });
});

describe('reading the Summer board card from the page', () => {
    const SELECTOR = '.player-card[data-player]';
    const win = (overrides = {}) => ({
        innerWidth: 1000, innerHeight: 500, getComputedStyle: (element) => element.style ?? {}, ...overrides,
    });
    const card = ({
        left, top, width, height, style = {},
    }) => ({
        style,
        getBoundingClientRect: () => ({
            left, top, right: left + width, bottom: top + height, width, height,
        }),
    });
    const page = (cards) => ({ querySelectorAll: vi.fn((selector) => (selector === SELECTOR ? cards : [])) });

    it('measures a visible board card in screen fractions and unites several', () => {
        const doc = page([card({
            left: 400, top: 50, width: 200, height: 400,
        })]);
        expect(readSummerBoardRect(doc, win())).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        expect(doc.querySelectorAll).toHaveBeenCalledExactlyOnceWith(SELECTOR);
        const both = page([
            card({
                left: 100, top: 100, width: 200, height: 300,
            }),
            card({
                left: 600, top: 50, width: 250, height: 400,
            }),
        ]);
        expect(readSummerBoardRect(both, win())).toEqual({
            x0: 0.1, x1: 0.85, y0: 0.1, y1: 0.9,
        });
    });

    it('ignores hidden, collapsed and off-screen cards', () => {
        const visible = card({
            left: 400, top: 50, width: 200, height: 400,
        });
        const ghosts = [
            card({
                left: 0, top: 0, width: 300, height: 300, style: { display: 'none' },
            }),
            card({
                left: 0, top: 0, width: 300, height: 300, style: { visibility: 'hidden' },
            }),
            card({
                left: 0, top: 0, width: 300, height: 300, style: { opacity: '0.01' },
            }),
            card({
                left: 0, top: 0, width: 4, height: 300,
            }),
            card({
                left: 0, top: 0, width: 300, height: 0,
            }),
            card({
                left: -500, top: 0, width: 300, height: 300,
            }),
            card({
                left: 1000, top: 0, width: 300, height: 300,
            }),
            card({
                left: 0, top: -400, width: 300, height: 300,
            }),
            card({
                left: 0, top: 500, width: 300, height: 300,
            }),
            {},
            null,
        ];
        expect(readSummerBoardRect(page([...ghosts, visible]), win())).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        expect(readSummerBoardRect(page(ghosts), win())).toBeNull();
        // A faint card is still a card.
        const faint = card({
            left: 400, top: 50, width: 200, height: 400, style: { opacity: '0.3' },
        });
        expect(readSummerBoardRect(page([faint]), win())).not.toBeNull();
    });

    it('returns null when there is no page, no window or no board, and never divides by an unknown size', () => {
        expect(readSummerBoardRect(null, win())).toBeNull();
        expect(readSummerBoardRect(page([]), null)).toBeNull();
        expect(readSummerBoardRect({}, win())).toBeNull();
        expect(readSummerBoardRect(page([]), win())).toBeNull();
        const rect = readSummerBoardRect(page([card({
            left: 0, top: 0, width: 20, height: 40,
        })]), { innerWidth: 0, innerHeight: undefined });
        expect(Object.values(rect).every(Number.isFinite)).toBe(true);
        // A card hanging off the screen is reported as it is; the stage clamps it.
        const hanging = readSummerBoardRect(page([card({
            left: -100, top: 50, width: 400, height: 400,
        })]), win());
        expect(hanging.x0).toBeCloseTo(-0.1, 12);
        const stage = new SummerStage(frameCamera());
        stage.setBoard(hanging);
        expect(stage.board.x0).toBe(0);
        expect(stage.board.x1).toBeCloseTo(0.3, 12);
    });

    it('reads the live document and window by default', () => {
        vi.stubGlobal('window', win());
        vi.stubGlobal('document', page([card({
            left: 250, top: 100, width: 500, height: 300,
        })]));
        expect(readSummerBoardRect()).toEqual({
            x0: 0.25, x1: 0.75, y0: 0.2, y1: 0.8,
        });
        vi.unstubAllGlobals();
        vi.stubGlobal('document', undefined);
        vi.stubGlobal('window', undefined);
        expect(readSummerBoardRect()).toBeNull();
    });
});

describe('Summer rings and gusts', () => {
    const snapshot = (pool) => pool.rings.map((entry) => entry.toArray());

    it('keeps a fixed pool, all at rest', () => {
        for (const [asked, count] of [[8, 8], [4, 4], [1, 1], [0, 1], [-3, 1], [5.9, 5]]) {
            const pool = new SummerRings(asked);
            expect(pool.count).toBe(count);
            expect(pool.rings).toHaveLength(count);
            expect(pool.active()).toBe(0);
            for (const ring of pool.rings) {
                expect(ring).toBeInstanceOf(THREE.Vector4);
                expect(ring.toArray()).toEqual([0, 0, 0, 0]);
            }
        }
        const plain = new SummerRings();
        expect(plain.count).toBeGreaterThan(0);
        expect(plain.life).toBeGreaterThan(0);
    });

    it('starts a ring at a point with its strength, capped, and refuses nonsense', () => {
        const pool = new SummerRings(4);
        const ring = pool.add(3, -7, 1.5);
        // One vec4 for the shader: where, how old, how strong.
        expect(ring).toBe(pool.rings[0]);
        expect(ring.toArray()).toEqual([3, -7, 0, 1.5]);
        expect(pool.active()).toBe(1);
        expect(pool.add(1, 1).w).toBe(1);
        // A ceiling, the same however much is asked.
        const ceiling = pool.add(0, 0, 1e9).w;
        expect(Number.isFinite(ceiling)).toBe(true);
        expect(ceiling).toBeGreaterThan(1.5);
        expect(pool.add(0, 0, Infinity).w).toBe(ceiling);
        const before = snapshot(pool);
        for (const [x, z, strength] of [[NaN, 0, 1], [0, Infinity, 1], [0, 0, 0], [0, 0, -1], [0, 0, NaN],
            [undefined, 0, 1], ['1', 0, 1], [0, 0, null]]) {
            expect(pool.add(x, z, strength), `${x}, ${z}, ${strength}`).toBeNull();
        }
        expect(snapshot(pool)).toEqual(before);
    });

    it('fills free slots in turn, then replaces the oldest ring', () => {
        const pool = new SummerRings(4, 100);
        for (let index = 0; index < 4; index++) {
            pool.add(index, 0, 1);
            pool.update(1);
        }
        expect(pool.rings.map((ring) => ring.x)).toEqual([0, 1, 2, 3]);
        expect(pool.rings.map((ring) => ring.z)).toEqual([4, 3, 2, 1]);
        // Full: the next ones take the oldest first.
        for (let index = 4; index < 7; index++) {
            const taken = pool.add(index, 0, 1);
            expect(taken).toBe(pool.rings[index - 4]);
            expect(taken.z).toBe(0);
            pool.update(1);
            expect(pool.active()).toBe(4);
        }
        expect(pool.rings.map((ring) => ring.x)).toEqual([4, 5, 6, 3]);
        // A ring that has ended frees its slot before anything is replaced.
        const short = new SummerRings(3, 5);
        short.add(0, 0, 1);
        short.update(3);
        short.add(1, 0, 1);
        short.add(2, 0, 1);
        short.update(3);
        expect(short.active()).toBe(2);
        short.add(9, 9, 1);
        expect(short.rings.map((ring) => ring.x).sort()).toEqual([1, 2, 9]);
    });

    it('ages the rings and clears each one at the end of its life', () => {
        const pool = new SummerRings(3, 6);
        pool.add(1, 2, 0.8);
        pool.update(2);
        pool.add(5, 6, 1.2);
        expect(snapshot(pool)).toEqual([[1, 2, 2, 0.8], [5, 6, 0, 1.2], [0, 0, 0, 0]]);
        // Nothing but time moves a ring: it keeps its place and its strength.
        pool.update(3.5);
        expect(snapshot(pool)).toEqual([[1, 2, 5.5, 0.8], [5, 6, 3.5, 1.2], [0, 0, 0, 0]]);
        pool.update(1);
        expect(snapshot(pool)).toEqual([[0, 0, 0, 0], [5, 6, 4.5, 1.2], [0, 0, 0, 0]]);
        expect(pool.active()).toBe(1);
        for (const dt of [0, -1, NaN, undefined, null, 'x', -Infinity]) pool.update(dt);
        expect(snapshot(pool)).toEqual([[0, 0, 0, 0], [5, 6, 4.5, 1.2], [0, 0, 0, 0]]);
        pool.update(60);
        expect(pool.active()).toBe(0);
    });

    it('forgets every ring on reset without replacing the vectors the shader was given', () => {
        const pool = new SummerRings(5);
        const { rings } = pool;
        const vectors = [...rings];
        for (let index = 0; index < 12; index++) {
            pool.add(index, -index, 1 + index / 10);
            pool.update(0.4);
        }
        expect(pool.active()).toBe(5);
        pool.reset();
        expect(pool.active()).toBe(0);
        expect(pool.rings).toBe(rings);
        pool.rings.forEach((ring, index) => {
            expect(ring).toBe(vectors[index]);
            expect(ring.toArray()).toEqual([0, 0, 0, 0]);
        });
        // The next ring goes into the first slot again.
        expect(pool.add(1, 1, 1)).toBe(vectors[0]);
    });
});

describe('Summer effects director', () => {
    describe('rings on the lake', () => {
        it('drops each ring the reactions ask for exactly once, behind its place on the board', () => {
            const {
                director, stage, ripples, rung,
            } = createDirector();
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            reactions.onPieceLock({ piece: pieceOf('I', 2, 8) });
            const frame = reactions.update(STEP);
            const [asked] = frame.rings.filter((entry) => entry.serial >= 0);
            director.apply(frame, STEP);
            expect(rung).toHaveBeenCalledOnce();
            const [x, z, strength] = rung.mock.calls[0];
            expect(strength).toBe(asked.strength);
            // On open water, on the compass bearing of the piece's column.
            expect(summerGroundHeight(x, z)).toBeLessThan(0);
            const bearing = stage.point(stage.screen(asked.column, asked.row).x, 0.5, 1).sub(stage.origin);
            const distance = flatDistance({ x, z }, stage.origin);
            expect((x - stage.origin.x) / distance).toBeCloseTo(bearing.x / Math.hypot(bearing.x, bearing.z), 2);
            expect((z - stage.origin.z) / distance).toBeCloseTo(bearing.z / Math.hypot(bearing.x, bearing.z), 2);
            expect(ripples.active()).toBe(1);
            // The ring stays in the queue for seconds: it must not be dropped again.
            for (let step = 0; step < 120; step++) director.apply(reactions.update(STEP), STEP);
            expect(rung).toHaveBeenCalledOnce();
            // A second lock adds exactly one more, further right for a piece further right.
            reactions.onPieceLock({ piece: pieceOf('O', 7, 8) });
            director.apply(reactions.update(STEP), STEP);
            director.apply(reactions.update(STEP), STEP);
            expect(rung).toHaveBeenCalledTimes(2);
            expect(rung.mock.calls[1][0]).toBeGreaterThan(x);
            expect(director.ringSerial).toBe(1);
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('opens the ring of a low piece near the shore and of a high one further out (%s)', (_label, aspect) => {
            const { director, stage, rung } = createDirector({ aspect });
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            const distances = [];
            for (const y of [23, 19, 14, 9, 4]) {
                reactions.onPieceLock({ piece: pieceOf('I', 4, y) });
                director.apply(reactions.update(STEP), STEP);
                const [x, z] = rung.mock.calls.at(-1);
                expect(summerGroundHeight(x, z), `row ${y}`).toBeLessThan(0);
                distances.push(flatDistance({ x, z }, stage.origin));
            }
            for (let index = 1; index < distances.length; index++) {
                expect(distances[index]).toBeGreaterThan(distances[index - 1] + 1);
            }
            // The lowest piece rings the water just off the near bank.
            const foot = stage.ground(0.5, stage.screen(0.5, 0).y, summerGroundHeight);
            expect(distances[0]).toBeGreaterThan(flatDistance(foot, stage.origin));
            expect(distances[0]).toBeLessThan(distances.at(-1) / 1.5);
        });

        // Regression: rings were placed at lake level under the ray through the card, and from this
        // camera the lower third of the board looks at meadow, so most of them opened metres inland.
        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('drops the ring of every lock, clear and flourish on open water in %s', (_label, aspect) => {
            const { director, rung, stage } = createDirector({ aspect });
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            // Where pieces mostly land and lines mostly clear: the lowest rows of the board, every column.
            for (let column = 0; column < 10; column++) {
                reactions.onPieceLock({ piece: pieceOf('I', column, 23 - (column % 4)) });
                director.apply(reactions.update(STEP), STEP);
            }
            reactions.onLineClear(1, { clearedRows: [23] });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            director.apply(reactions.update(STEP), STEP);
            reactions.onCombo(3);
            reactions.onTSpin({ piece: pieceOf('T', 8, 22) });
            reactions.onPerfectClear();
            reactions.onLevelUp();
            director.apply(reactions.update(STEP), STEP);
            expect(rung).toHaveBeenCalledTimes(reactions.ringSerial);
            expect(rung.mock.calls.length).toBeGreaterThanOrEqual(17);
            for (const [x, z] of rung.mock.calls) {
                expect(summerGroundHeight(x, z), `${x}, ${z}`).toBeLessThan(0);
                // In front of the camera, within sight.
                expect(z).toBeLessThan(stage.origin.z);
                expect(flatDistance({ x, z }, stage.origin)).toBeLessThan(120);
            }
        });

        it('takes every ring and gust of a busy frame and keeps count across the wrap of the queues', () => {
            const { director, rung, blown } = createDirector();
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            const events = [
                () => reactions.onPieceLock({ piece: pieceOf('I') }),
                () => { reactions.onPieceLock({ piece: pieceOf('O') }); reactions.onLineClear(4); },
                () => reactions.onCombo(5),
                () => { reactions.onPerfectClear(); reactions.onLevelUp(); reactions.onTSpin(); },
                () => { reactions.onLineClear(2); reactions.onCombo(7); },
                () => reactions.onBackToBack(),
                () => {
                    reactions.onPieceLock({ piece: pieceOf('T') });
                    reactions.onLineClear(1);
                    reactions.onCombo(2);
                    reactions.onLevelUp();
                },
            ];
            for (let round = 0; round < 4; round++) {
                for (const event of events) {
                    const [rings, gusts] = [reactions.ringSerial, reactions.waveSerial];
                    event();
                    // No more than the queues hold are asked for between two frames here.
                    expect(reactions.ringSerial - rings).toBeLessThanOrEqual(reactions.rings.length);
                    expect(reactions.waveSerial - gusts).toBeLessThanOrEqual(reactions.waves.length);
                    director.apply(reactions.update(STEP), STEP);
                    expect(rung).toHaveBeenCalledTimes(reactions.ringSerial);
                    expect(blown).toHaveBeenCalledTimes(reactions.waveSerial);
                    for (let step = 0; step < 5; step++) director.apply(reactions.update(STEP), STEP);
                    expect(rung).toHaveBeenCalledTimes(reactions.ringSerial);
                    expect(blown).toHaveBeenCalledTimes(reactions.waveSerial);
                }
            }
            expect(reactions.ringSerial).toBeGreaterThan(reactions.rings.length * 3);
            expect(reactions.waveSerial).toBeGreaterThan(reactions.waves.length * 3);
            expect(director.ringSerial).toBe(reactions.ringSerial - 1);
            expect(director.waveSerial).toBe(reactions.waveSerial - 1);
            // Nothing was invented: every strength is one the reactions could ask for.
            for (const [x, z, strength] of [...rung.mock.calls, ...blown.mock.calls]) {
                expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
                expect(strength).toBeGreaterThan(0);
            }
        });

        it('adds the rings and gusts of a frame oldest first, whatever slots the queue has wrapped them into', () => {
            const { director, rung, blown } = createDirector();
            const strengthOf = (serial) => 1 + serial / 100;
            const queue = (serials) => serials.map((serial) => queued(serial, 0.5, 0.5, strengthOf(serial)));
            const strengths = (spy) => spy.mock.calls.map(([, , strength]) => strength);
            // The writer has been round once: slots 0 and 1 hold the newest two.
            director.apply(frameWith([], {
                rings: queue([8, 9, 2, 3, 4, 5, 6, 7]), waves: queue([6, 7, 2, 3, 4, 5]),
            }), STEP);
            expect(strengths(rung)).toEqual([2, 3, 4, 5, 6, 7, 8, 9].map(strengthOf));
            expect(strengths(blown)).toEqual([2, 3, 4, 5, 6, 7].map(strengthOf));
            expect(director.ringSerial).toBe(9);
            expect(director.waveSerial).toBe(7);
            // More a frame later, wrapped again: only those, in the order they were asked.
            rung.mockClear();
            blown.mockClear();
            director.apply(frameWith([], {
                rings: queue([8, 9, 10, 11, 12, 5, 6, 7]), waves: queue([12, 7, 8, 9, 10, 11]),
            }), STEP);
            expect(strengths(rung)).toEqual([10, 11, 12].map(strengthOf));
            expect(strengths(blown)).toEqual([8, 9, 10, 11, 12].map(strengthOf));
            expect(director.ringSerial).toBe(12);
            expect(director.waveSerial).toBe(12);
        });

        it.each([0, 1, 3, 5, 8])(
            'keeps the newest rings of a perfect clear on a pool of four after %i earlier locks',
            (earlier) => {
                const { director, ripples } = createDirector({ rings: 4, petals: SUMMER_TIERS.Minimal.petals });
                const reactions = new SummerReactions({ quality: 'Minimal', rng: seededRandom(1) });
                const tick = () => {
                    director.apply(reactions.update(STEP), STEP);
                    ripples.update(STEP);
                };
                for (let lock = 0; lock < earlier; lock++) {
                    reactions.onPieceLock();
                    tick();
                }
                for (let step = 0; step < 60; step++) tick();
                // One frame: the lock that completes a four-line perfect clear on a combo.
                reactions.onPieceLock();
                reactions.onLineClear(4);
                reactions.onCombo(3);
                reactions.onPerfectClear();
                const frame = reactions.update(STEP);
                const asked = frame.rings.filter((entry) => entry.serial >= earlier)
                    .sort((a, b) => a.serial - b.serial);
                expect(asked.length).toBeGreaterThan(4);
                director.apply(frame, STEP);
                // The last four asked are the four on the water; the first ones gave way.
                const onTheWater = ripples.rings.filter((entry) => entry.z === 0).map((entry) => entry.w)
                    .sort((a, b) => a - b);
                expect(onTheWater).toEqual(asked.slice(-4).map((entry) => entry.strength).sort((a, b) => a - b));
            },
        );

        it('ignores rings and gusts at rest or without strength, and frames without a queue', () => {
            const {
                director, ripples, waves, rung, blown,
            } = createDirector();
            const rest = Array.from({ length: 8 }, () => queued(-1, 0.5, 0, 0));
            for (const queue of [rest, undefined, null, [], 'rings', [{}], [queued(NaN)], [queued(undefined)]]) {
                expect(() => director.apply(frameWith([], { rings: queue, waves: queue }), STEP)).not.toThrow();
            }
            expect(rung).not.toHaveBeenCalled();
            expect(blown).not.toHaveBeenCalled();
            expect([ripples.active(), waves.active()]).toEqual([0, 0]);
            // None of that was a ring: the first real one still arrives.
            expect([director.ringSerial, director.waveSerial]).toEqual([-1, -1]);
            const real = [...rest.slice(1), queued(0)];
            director.apply(frameWith([], { rings: real, waves: real }), STEP);
            expect(rung).toHaveBeenCalledOnce();
            expect(blown).toHaveBeenCalledOnce();
            // One asked for with no strength is passed over, never started.
            for (const [serial, strength] of [[1, 0], [2, -1], [3, NaN]]) {
                const weak = [queued(serial, 0.5, 0.5, strength)];
                director.apply(frameWith([], { rings: weak, waves: weak }), STEP);
            }
            expect(rung).toHaveBeenCalledOnce();
            expect(blown).toHaveBeenCalledOnce();
            director.apply(frameWith([], { rings: [queued(4)], waves: [queued(4)] }), STEP);
            expect(rung).toHaveBeenCalledTimes(2);
            expect(blown).toHaveBeenCalledTimes(2);
            // A director without a lake or a meadow still plays the rest of the frame and keeps count.
            const dry = createDirector({ ripples: null, waves: null });
            expect(dry.director.ripples).toBeNull();
            expect(() => dry.director.apply(frameWith([emitter()], { rings: [queued(0)], waves: [queued(0)] }), STEP))
                .not.toThrow();
            expect(dry.sim.spawn).toHaveBeenCalled();
            expect([dry.director.ringSerial, dry.director.waveSerial]).toEqual([0, 0]);
        });

        it('rings the water where a petal came down', () => {
            const sim = spySim();
            const { director, rung, blown } = createDirector({ sim });
            sim.touches = [{ x: 3.5, z: -18, strength: 0.21 }, { x: -6, z: -30, strength: 0.17 },
                { x: 99, z: 99, strength: 9 }];
            sim.touchCount = 2;
            director.apply(frameWith(), STEP);
            expect(rung.mock.calls).toEqual([[3.5, -18, 0.21], [-6, -30, 0.17]]);
            sim.touchCount = 0;
            director.apply(frameWith(), STEP);
            expect(rung).toHaveBeenCalledTimes(2);
            // The meadow hears nothing of it.
            expect(blown).not.toHaveBeenCalled();
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('lets a fish rise now and then on open water in %s, and never once the game is over', (_l, aspect) => {
            const { director, rung, stage } = createDirector({ seed: 5, aspect });
            const times = [];
            for (let step = 0; step < 60 * 90; step++) {
                const before = rung.mock.calls.length;
                director.apply(frameWith(), STEP);
                if (rung.mock.calls.length > before) times.push(step * STEP);
            }
            // Now and then: a few in a minute and a half, never at once and never in a flurry.
            expect(times.length).toBeGreaterThanOrEqual(3);
            expect(times.length).toBeLessThanOrEqual(40);
            expect(times[0]).toBeGreaterThan(1);
            for (let index = 1; index < times.length; index++) {
                expect(times[index] - times[index - 1]).toBeGreaterThan(2);
            }
            const strengths = rung.mock.calls.map(([, , strength]) => strength);
            for (const [x, z, strength] of rung.mock.calls) {
                expect(summerGroundHeight(x, z)).toBeLessThan(0);
                expect(strength).toBeGreaterThan(0);
                expect(strength).toBeLessThan(1);
                expect(flatDistance({ x, z }, stage.origin)).toBeLessThan(200);
            }
            expect(new Set(strengths).size).toBeGreaterThan(1);
            // Game over: the water is left alone.
            const quiet = createDirector({ seed: 5, aspect });
            for (let step = 0; step < 60 * 60; step++) quiet.director.apply(frameWith([], { settled: true }), STEP);
            expect(quiet.rung).not.toHaveBeenCalled();
            // No fish jumps on a frozen frame either.
            const frozen = createDirector({ seed: 5, aspect });
            for (let step = 0; step < 60 * 60; step++) frozen.director.apply(frameWith(), 0);
            expect(frozen.rung).not.toHaveBeenCalled();
        });
    });

    describe('gusts through the meadow', () => {
        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('starts each gust once, in the grass at the foot of the board under its column (%s)', (_label, aspect) => {
            const {
                director, stage, waves, blown, camera,
            } = createDirector({ aspect });
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            const spots = [];
            for (const x of [0, 4, 9]) {
                reactions.onPieceLock({ piece: pieceOf('S', x) });
                const frame = reactions.update(STEP);
                const asked = frame.waves.filter((entry) => entry.serial >= 0).sort((a, b) => b.serial - a.serial)[0];
                director.apply(frame, STEP);
                expect(blown).toHaveBeenCalledTimes(spots.length + 1);
                const [gx, gz, strength] = blown.mock.calls.at(-1);
                expect(strength).toBe(asked.strength);
                // On dry land, in front of the camera, on the ground under the foot of the card.
                expect(summerShoreDistance(gx, gz)).toBeGreaterThan(1);
                expect(summerGroundHeight(gx, gz)).toBeGreaterThan(0);
                const seen = ndc({ x: gx, y: summerGroundHeight(gx, gz), z: gz }, camera);
                expect(seen.z).toBeLessThan(1);
                expect(seen.x).toBeCloseTo(stage.screen(asked.column, 0).x * 2 - 1, 1);
                expect(seen.y).toBeLessThan(1 - stage.screen(0.5, 0.2).y * 2);
                spots.push(seen.x);
                for (let step = 0; step < 30; step++) director.apply(reactions.update(STEP), STEP);
                expect(blown).toHaveBeenCalledTimes(spots.length);
            }
            // Left to right on the board is left to right in the grass.
            expect(spots[0]).toBeLessThan(spots[1]);
            expect(spots[1]).toBeLessThan(spots[2]);
            expect(waves.active()).toBe(3);
        });

        it('sends a second gust from the maypole\'s side of the board when the bouquet is thrown', () => {
            const { director, blown } = createDirector();
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            for (const letter of LETTERS.slice(0, 6)) {
                reactions.onPieceLock({ piece: pieceOf(letter) });
                director.apply(reactions.update(STEP), STEP);
            }
            expect(blown).toHaveBeenCalledTimes(6);
            reactions.onPieceLock({ piece: pieceOf(LETTERS[6]) });
            director.apply(reactions.update(STEP), STEP);
            expect(blown).toHaveBeenCalledTimes(8);
            const [lock, bouquet] = blown.mock.calls.slice(-2).map(([, , strength]) => strength);
            expect(bouquet).toBeGreaterThan(lock);
        });
    });

    describe('locks', () => {
        it.each([
            ['lock', LANDSCAPE], ['clear', LANDSCAPE], ['spin', LANDSCAPE], ['combo', LANDSCAPE], ['seeds', LANDSCAPE],
            ['lock', PORTRAIT], ['clear', PORTRAIT], ['spin', PORTRAIT], ['combo', PORTRAIT], ['seeds', PORTRAIT],
        ])('starts %s petals for the bottom row clear of the grass and the lake (aspect %f)', (kind, aspect) => {
            const { director, sim } = createDirector({ aspect });
            play(director, sim, [{
                kind, side: -1, row: 0, lines: 4, strength: 1,
            }, {
                kind, side: 1, row: 0, lines: 4, strength: 1,
            }], { seconds: 1 });
            const thrown = sim.thrown();
            expect(thrown.length).toBeGreaterThan(10);
            for (const petal of thrown) {
                expect([petal.x, petal.y, petal.z, petal.vx, petal.vy, petal.vz].every(Number.isFinite)).toBe(true);
                expect(petal.y).toBeGreaterThan(groundUnder(petal) + 0.1);
                expect(petal.life).toBeGreaterThan(0);
                expect(petal.size).toBeGreaterThan(0);
            }
        });

        it.each([[-1], [1]])('throws a fresh puff once from the card edge on side %i, outward', (side) => {
            const {
                director, sim, stage, camera,
            } = createDirector();
            const flower = SUMMER_PIECE_FLOWERS.Z;
            const log = play(director, sim, [{
                kind: 'lock', side, row: 0.6, strength: 0.7, flower, duration: 1.1,
            }], { seconds: 1 });
            // Everything leaves in the first frame; the rest of the emitter's life throws nothing.
            expect(log[0].spawned).toBeGreaterThan(10);
            expect(sum(log.slice(1).map((entry) => entry.spawned))).toBe(0);
            const thrown = sim.thrown();
            const edge = ndc(stage.edge(side, 0.6), camera);
            for (const petal of thrown) {
                const seen = ndc(petal, camera);
                // From beside the piece: at the card's edge on that side, at its height, at its depth.
                expect(Math.abs(seen.x - edge.x)).toBeLessThan(0.12);
                expect(Math.abs(seen.y - edge.y)).toBeLessThan(0.25);
                expect(Math.abs(stage.point(0.5, 0.5, 0).distanceTo(new THREE.Vector3(petal.x, petal.y, petal.z))
                    - SUMMER_STAGE_DEPTH)).toBeLessThan(2);
                // Away from the board, and up.
                expect(petal.vx * side).toBeGreaterThan(0);
                expect(petal.vy).toBeGreaterThan(0);
            }
            // Mostly petals of the piece's own flower, with a little pollen among them.
            const petals = thrown.filter((petal) => petal.kind === PETAL);
            expect(petals.length).toBeGreaterThan(thrown.length / 2);
            for (const petal of petals) expect(petal.flower).toBe(flower);
            expect(thrown.filter((petal) => petal.kind === POLLEN).length).toBeGreaterThan(0);
            expect(thrown.filter((petal) => petal.kind === SEED)).toEqual([]);
            // A burst at the edge carries them off while the emitter is young, and is gone long before it ends.
            expect(log[0].fields).toHaveLength(1);
            expect(log[0].fields[0].kind).toBe('burst');
            const centre = ndc(log[0].fields[0], camera);
            expect(Math.abs(centre.x - edge.x)).toBeLessThan(0.1);
            // Behind the petals as they leave: the field sits on the board's side of the edge.
            expect((centre.x - edge.x) * side).toBeLessThan(0);
            expect(log.at(-5).fields).toEqual([]);
        });

        it('follows the height of the piece and throws more, harder, for a stronger lock', () => {
            const thrownFor = (overrides) => {
                const { director, sim } = createDirector();
                const [first] = play(director, sim, [{ kind: 'lock', side: 1, ...overrides }], { seconds: 0.1 });
                return { thrown: sim.thrown(), field: first.fields[0] };
            };
            const low = thrownFor({ row: 0.15 });
            const high = thrownFor({ row: 0.9 });
            const height = ({ thrown }) => mean(thrown.map((petal) => petal.y));
            expect(height(high)).toBeGreaterThan(height(low) + 2);
            expect(high.field.y).toBeGreaterThan(low.field.y + 2);
            const gentle = thrownFor({ strength: 0.2 });
            const hard = thrownFor({ strength: 1 });
            expect(hard.thrown.length).toBeGreaterThan(gentle.thrown.length);
            const speed = ({ thrown }) => mean(thrown.map((petal) => petal.vx));
            expect(speed(hard)).toBeGreaterThan(speed(gentle));
            expect(hard.field.power).toBeGreaterThan(gentle.field.power);
        });

        it('throws petals of every kind for a piece nobody named', () => {
            const { director, sim } = createDirector();
            play(director, sim, [{ kind: 'lock', flower: SUMMER_MIXED, strength: 1 }], { seconds: 0.1 });
            // Left for the simulation to pick: it is handed "mixed", not a kind.
            const petals = sim.thrown().filter((entry) => entry.kind === PETAL);
            expect(petals.length).toBeGreaterThan(10);
            expect(petals.every((petal) => petal.flower === SUMMER_MIXED)).toBe(true);
            const real = new SummerPetalSim({ count: 400, reserve: 300, rng: seededRandom(4) });
            const { director: live } = createDirector({ sim: real });
            live.apply(frameWith([emitter({ kind: 'lock', flower: SUMMER_MIXED, strength: 1 })]), STEP);
            const kinds = new Set();
            for (let index = real.ambient; index < real.count; index++) {
                if (real.life[index] > 0 && real.kind[index] === PETAL) kinds.add(real.flower[index]);
            }
            expect(kinds.size).toBeGreaterThan(4);
        });

        it('treats a reused slot with a new serial as a new event', () => {
            const { director, sim } = createDirector();
            director.apply(frameWith([emitter({ id: 3, serial: 10 })]), STEP);
            const first = sim.spawn.mock.calls.length;
            expect(first).toBeGreaterThan(0);
            director.apply(frameWith([emitter({ id: 3, serial: 10, age: STEP })]), STEP);
            expect(sim.spawn.mock.calls.length).toBe(first);
            director.apply(frameWith([emitter({ id: 3, serial: 11 })]), STEP);
            expect(sim.spawn.mock.calls.length).toBe(first * 2);
            // The same serial in another slot is another emitter.
            director.apply(frameWith([emitter({ id: 4, serial: 11 })]), STEP);
            expect(sim.spawn.mock.calls.length).toBe(first * 3);
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('shakes dandelion seed up off the meadow under a hard-dropped piece (%s)', (_label, aspect) => {
            const { director, sim, stage } = createDirector({ aspect });
            const log = play(director, sim, [{
                kind: 'seeds', side: 1, column: 0.8, row: 0, strength: 0.8, duration: 0.9,
            }], { seconds: 1.2 });
            const thrown = sim.thrown();
            expect(thrown.length).toBeGreaterThan(20);
            // Shaken loose over a moment, not in one frame, and all of it early in the emitter's life.
            expect(log[0].spawned).toBeLessThan(thrown.length / 2);
            const last = log.findLastIndex((entry) => entry.spawned > 0);
            expect(log[last].age).toBeGreaterThan(0.1);
            expect(log[last].age).toBeLessThan(0.7);
            const foot = stage.screen(0.8, 0);
            const under = stage.ground(foot.x, Math.min(1, foot.y + 0.03), summerGroundHeight);
            for (const seed of thrown) {
                expect(seed.kind).toBe(SEED);
                // Off the grass around the foot of the board, going up.
                expect(flatDistance(seed, under)).toBeLessThan(5);
                expect(summerGroundHeight(seed.x, seed.z)).toBeGreaterThan(0);
                expect(seed.y).toBeGreaterThan(groundUnder(seed) + 0.1);
                expect(seed.y).toBeLessThan(groundUnder(seed) + 2);
                expect(seed.vy).toBeGreaterThan(0);
            }
            // Spreading out all round, not blown one way.
            expect(Math.min(...thrown.map((seed) => seed.vx))).toBeLessThan(0);
            expect(Math.max(...thrown.map((seed) => seed.vx))).toBeGreaterThan(0);
            // Seed needs no field: it is lighter than air.
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            // More for a longer fall, and under the column the piece came down in.
            const other = createDirector({ aspect });
            play(other.director, other.sim, [{
                kind: 'seeds', side: -1, column: 0.2, row: 0, strength: 0.4, duration: 0.9,
            }], { seconds: 1.2 });
            expect(other.sim.thrown().length).toBeLessThan(thrown.length);
            if (aspect === LANDSCAPE) {
                expect(mean(other.sim.thrown().map((seed) => seed.x))).toBeLessThan(mean(thrown.map((seed) => seed.x)));
            }
        });
    });

    describe('line clears', () => {
        it('blows the jets out of both sides of the board over an opening window', () => {
            const {
                director, sim, stage, camera,
            } = createDirector();
            const log = play(director, sim, [
                {
                    kind: 'clear', side: -1, row: 0.4, lines: 2, strength: 0.7, duration: 1.7,
                },
                {
                    kind: 'clear', side: 1, row: 0.4, lines: 2, strength: 0.7, duration: 1.7,
                },
            ], { seconds: 1.6 });
            const thrown = sim.thrown();
            const [left, right] = [thrown.filter((petal) => petal.vx < 0), thrown.filter((petal) => petal.vx > 0)];
            // The same from either side.
            expect(left.length).toBeGreaterThan(20);
            expect(right.length).toBe(left.length);
            const [leftEdge, rightEdge] = [ndc(stage.edge(-1, 0.4), camera), ndc(stage.edge(1, 0.4), camera)];
            for (const petal of left) expect(Math.abs(ndc(petal, camera).x - leftEdge.x)).toBeLessThan(0.12);
            for (const petal of right) expect(Math.abs(ndc(petal, camera).x - rightEdge.x)).toBeLessThan(0.12);
            for (const petal of thrown) expect(Math.abs(ndc(petal, camera).y - leftEdge.y)).toBeLessThan(0.45);
            // It opens over a moment: the first frame is a trickle, and it is all out well before the end.
            expect(log[0].spawned).toBeLessThan(thrown.length / 4);
            const last = log.findLastIndex((entry) => entry.spawned > 0);
            expect(log[last].age).toBeGreaterThan(0.2);
            expect(log[last].age).toBeLessThan(1.2);
            // Faster than a lock's puff.
            const lock = createDirector();
            play(lock.director, lock.sim, [{ kind: 'lock', side: 1, strength: 0.7 }], { seconds: 0.1 });
            const puff = lock.sim.thrown().map((petal) => petal.vx);
            expect(mean(right.map((petal) => petal.vx))).toBeGreaterThan(mean(puff));
            // A jet on each side carries them outward while the clear is young.
            expect(log[0].fields.map((field) => field.kind)).toEqual(['jet', 'jet']);
            const [leftJet, rightJet] = log[0].fields;
            expect(leftJet.dx).toBeLessThan(0);
            expect(rightJet.dx).toBeGreaterThan(0);
            expect(ndc(leftJet, camera).x).toBeLessThan(leftEdge.x);
            expect(ndc(rightJet, camera).x).toBeGreaterThan(rightEdge.x);
            expect(log.at(-3).fields).toEqual([]);
            // Mostly petals of every colour, some pollen.
            expect(thrown.filter((petal) => petal.kind === PETAL).length).toBeGreaterThan(thrown.length / 2);
            expect(thrown.filter((petal) => petal.kind === SEED)).toEqual([]);
        });

        it.each([[0.15], [0.5], [0.9]])('leaves at the height of the cleared rows (row %f)', (row) => {
            const {
                director, sim, stage, camera,
            } = createDirector();
            const log = play(director, sim, [{
                kind: 'clear', side: 1, row, lines: 1, strength: 0.6,
            }], { seconds: 0.8 });
            const edge = ndc(stage.edge(1, row), camera);
            expect(mean(sim.thrown().map((petal) => ndc(petal, camera).y))).toBeCloseTo(edge.y, 0);
            expect(ndc(log[0].fields[0], camera).y).toBeCloseTo(edge.y, 1);
        });

        it('throws more for more lines and catches up when it first sees a clear late', () => {
            const total = (lines, strength = 0.7) => {
                const { director, sim } = createDirector();
                play(director, sim, [{
                    kind: 'clear', side: 1, lines, strength,
                }], { seconds: 1.5 });
                return sim.spawn.mock.calls.length;
            };
            const totals = [1, 2, 3, 4].map((lines) => total(lines));
            for (let index = 1; index < totals.length; index++) {
                expect(totals[index]).toBeGreaterThan(totals[index - 1]);
            }
            // Lines missing from a payload are one line, not none.
            expect(total(0)).toBe(totals[0]);
            // The schedule is the emitter's age, not the frames the director happened to see.
            const { director, sim } = createDirector();
            director.apply(frameWith([emitter({
                kind: 'clear', side: 1, lines: 2, strength: 0.7, age: 1,
            })]), STEP);
            expect(sim.spawn.mock.calls.length).toBe(totals[1]);
            const coarse = createDirector();
            play(coarse.director, coarse.sim, [{
                kind: 'clear', side: 1, lines: 2, strength: 0.7,
            }], { seconds: 1.5, dt: 1 / 20 });
            expect(coarse.sim.spawn.mock.calls.length).toBe(totals[1]);
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('lifts petals and seed off the whole meadow, and only the meadow, for four lines (%s)', (_label, aspect) => {
            const { director, sim } = createDirector({ aspect });
            const log = play(director, sim, [{
                kind: 'rise', row: 0, lines: 4, strength: 1, duration: 2.8,
            }], { seconds: 2.5 });
            const thrown = sim.thrown();
            expect(thrown.length).toBeGreaterThan(60);
            for (const petal of thrown) {
                // Off the grass, never off the lake, and up.
                expect(summerGroundHeight(petal.x, petal.z)).toBeGreaterThan(0);
                expect(petal.y).toBeGreaterThan(groundUnder(petal) + 0.1);
                expect(petal.y).toBeLessThan(groundUnder(petal) + 2);
                expect(petal.vy).toBeGreaterThan(0);
                expect(Math.abs(petal.vx)).toBeLessThan(petal.vy);
            }
            // All around the board, near and far.
            const xs = thrown.map((petal) => petal.x);
            const zs = thrown.map((petal) => petal.z);
            expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(8);
            expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(8);
            expect(thrown.filter((petal) => petal.kind === PETAL).length).toBeGreaterThan(0);
            expect(thrown.filter((petal) => petal.kind === SEED).length).toBeGreaterThan(0);
            // A long breath: it is still rising a second in.
            expect(log[0].spawned).toBeLessThan(thrown.length / 10);
            expect(sum(log.filter((entry) => entry.age > 1).map((entry) => entry.spawned))).toBeGreaterThan(0);
            // Less for a weaker breath.
            const weak = createDirector({ aspect });
            play(weak.director, weak.sim, [{ kind: 'rise', strength: 0.4, duration: 2.8 }], { seconds: 2.5 });
            expect(weak.sim.spawn.mock.calls.length).toBeLessThan(thrown.length);
            expect(weak.sim.spawn.mock.calls.length).toBeGreaterThan(0);
        });

        it('lets nothing rise where there is no meadow', () => {
            const { director, sim } = createDirector({ groundHeight: () => -1 });
            play(director, sim, [{ kind: 'rise', strength: 1, duration: 2.8 }], { seconds: 2.5 });
            expect(sim.spawn).not.toHaveBeenCalled();
        });
    });

    describe('the bouquet', () => {
        it('throws it from the top of the maypole and its wreaths, up and out all round', () => {
            const maypole = maypoleAnchors();
            const { director, sim } = createDirector({ maypole });
            const log = play(director, sim, [{ kind: 'bouquet', strength: 1, duration: 2.6 }], { seconds: 2 });
            const thrown = sim.thrown();
            expect(thrown.length).toBeGreaterThan(60);
            const anchors = [maypole.top, ...maypole.wreaths];
            const used = new Set();
            for (const petal of thrown) {
                const from = new THREE.Vector3(petal.x, petal.y, petal.z);
                const distances = anchors.map((anchor) => anchor.distanceTo(from));
                const nearest = Math.min(...distances);
                expect(nearest).toBeLessThan(1);
                used.add(distances.indexOf(nearest));
                expect(petal.y).toBeGreaterThan(groundUnder(petal) + 2);
                expect(petal.kind === PETAL || petal.kind === POLLEN).toBe(true);
                expect(petal.flower).toBeGreaterThanOrEqual(0);
                expect(petal.flower).toBeLessThan(SUMMER_BOUQUET_KINDS);
            }
            expect(used.size).toBe(3);
            // A fountain: every compass direction, and upward on the whole.
            for (const key of ['vx', 'vz']) {
                expect(Math.min(...thrown.map((petal) => petal[key]))).toBeLessThan(-2);
                expect(Math.max(...thrown.map((petal) => petal[key]))).toBeGreaterThan(2);
            }
            expect(mean(thrown.map((petal) => petal.vy))).toBeGreaterThan(1);
            // Thrown over a moment, with a burst at the top of the pole to open it out.
            expect(log[0].spawned).toBeLessThan(thrown.length / 4);
            expect(log.findLast((entry) => entry.spawned > 0).age).toBeLessThan(1.5);
            const [burst] = log[0].fields;
            expect(burst.kind).toBe('burst');
            expect(flatDistance(burst, maypole.top)).toBeLessThan(0.5);
            expect(Math.abs(burst.y - maypole.top.y)).toBeLessThan(3);
            expect(log.at(-3).fields).toEqual([]);
            // Less for a weaker throw.
            const weak = createDirector({ maypole });
            play(weak.director, weak.sim, [{ kind: 'bouquet', strength: 0.4, duration: 2.6 }], { seconds: 2 });
            expect(weak.sim.spawn.mock.calls.length).toBeLessThan(thrown.length);
        });

        // Regression: the flower, the kind and the anchor of each petal were taken from its index
        // within one frame's batch, so a frame that threw few petals only ever threw the first
        // kinds from the first anchors, and the seventh kind was always pollen, never a petal.
        it.each(TIERS.flatMap((tier) => [[tier, 60], [tier, 144]]))(
            'carries petals of all seven kinds from all three anchors at %s, %i frames a second',
            (tier, fps) => {
                const maypole = maypoleAnchors();
                const { director, sim } = createDirector({ maypole, petals: SUMMER_TIERS[tier].petals });
                play(director, sim, [{ kind: 'bouquet', strength: 1, duration: 2.6 }], { seconds: 2, dt: 1 / fps });
                const thrown = sim.thrown();
                const petals = new Set(thrown.filter((petal) => petal.kind === PETAL).map((petal) => petal.flower));
                expect([...petals].sort()).toEqual([...Array(SUMMER_BOUQUET_KINDS).keys()]);
                const anchors = [maypole.top, ...maypole.wreaths];
                const used = new Set(thrown.map((petal) => {
                    const from = new THREE.Vector3(petal.x, petal.y, petal.z);
                    const distances = anchors.map((anchor) => anchor.distanceTo(from));
                    return distances.indexOf(Math.min(...distances));
                }));
                expect(used.size).toBe(3);
            },
        );

        it('throws nothing, and does not fail, when the world has no maypole', () => {
            const { director, sim } = createDirector({ maypole: null });
            let log;
            expect(() => {
                log = play(director, sim, [{ kind: 'bouquet', strength: 1, duration: 2.6 }], { seconds: 1 });
            }).not.toThrow();
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
        });
    });

    describe('combos, spins and the crown', () => {
        it('throws one turn of petals around the board for a fresh combo, one of each kind after another', () => {
            const { director, sim, stage } = createDirector();
            const log = play(director, sim, [{ kind: 'combo', strength: 0.8, lines: 5 }], { seconds: 1 });
            expect(log[0].spawned).toBeGreaterThan(14);
            expect(sum(log.slice(1).map((entry) => entry.spawned))).toBe(0);
            // A combo needs no field of its own: the crown the frame carries is what turns them.
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            const centre = stage.centre();
            const thrown = sim.thrown();
            const turning = thrown.map((petal) => {
                const dx = petal.x - centre.x;
                const dz = petal.z - centre.z;
                const speed = Math.hypot(petal.vx, petal.vz);
                return { radius: Math.hypot(dx, dz), turn: dx * petal.vz - dz * petal.vx, speed };
            });
            // On a ring around the board's axis, already going round, all the same way.
            for (const entry of turning) {
                expect(entry.radius).toBeGreaterThan(1.5);
                expect(entry.radius).toBeLessThan(6);
                expect(entry.turn).toBeGreaterThan(0);
                expect(entry.turn).toBeCloseTo(entry.radius * entry.speed, 6);
            }
            // The crown is woven of all seven.
            const petals = thrown.filter((petal) => petal.kind === PETAL);
            expect(new Set(petals.map((petal) => petal.flower)).size).toBe(SUMMER_BOUQUET_KINDS);
            for (let index = 1; index < thrown.length; index++) {
                expect(thrown[index].flower).toBe((thrown[index - 1].flower + 1) % SUMMER_BOUQUET_KINDS);
            }
            // More, faster, for a bigger combo.
            const small = createDirector();
            play(small.director, small.sim, [{ kind: 'combo', strength: 0.3 }], { seconds: 0.1 });
            expect(small.sim.spawn.mock.calls.length).toBeLessThan(thrown.length);
            expect(mean(small.sim.thrown().map((petal) => Math.hypot(petal.vx, petal.vz))))
                .toBeLessThan(mean(turning.map((entry) => entry.speed)));
        });

        it.each([[-1], [1]])('winds a garland beside the card for a t-spin on side %i', (side) => {
            const {
                director, sim, stage, camera,
            } = createDirector();
            const flower = SUMMER_PIECE_FLOWERS.T;
            const log = play(director, sim, [{
                kind: 'spin', side, row: 0.5, strength: 0.8, flower, duration: 1.7,
            }], { seconds: 1.6 });
            expect(log[0].spawned).toBeGreaterThan(10);
            expect(sum(log.slice(1).map((entry) => entry.spawned))).toBe(0);
            const thrown = sim.thrown();
            const edge = ndc(stage.edge(side, 0.5), camera);
            for (const petal of thrown) {
                expect(petal).toMatchObject({ kind: PETAL, flower });
                // Clear of the card, on the piece's side.
                expect((ndc(petal, camera).x - edge.x) * side).toBeGreaterThan(0.05);
            }
            // Thrown out in a spiral: no two the same way.
            expect(new Set(thrown.map((petal) => Math.atan2(petal.vy, petal.vx).toFixed(2))).size)
                .toBeGreaterThan(thrown.length / 2);
            // A small vortex stands where they were thrown and turns the way of its side.
            const [vortex] = log[0].fields;
            expect(vortex).toMatchObject({ kind: 'vortex', turn: side });
            expect(vortex.x).toBeCloseTo(thrown[0].x, 9);
            expect(vortex.z).toBeCloseTo(thrown[0].z, 9);
            expect(vortex.reach).toBeGreaterThan(vortex.radius);
            expect(vortex.top).toBeGreaterThan(groundUnder(vortex));
            // It is tighter than the crown, and gone before the emitter ends.
            const crown = createDirector().director.apply(frameWith([], { crown: 0.8 }), STEP).fields[0];
            expect(vortex.radius).toBeLessThan(crown.radius);
            expect(vortex.reach).toBeLessThan(crown.reach);
            expect(log.at(-3).fields).toEqual([]);
        });

        it('turns the frame\'s crown into one wheel around the board that climbs and quickens as it builds', () => {
            const { director, stage } = createDirector();
            const fieldAt = (crown) => director.apply(frameWith([], { crown }), 0).fields;
            for (const crown of [0, -1, NaN, undefined, null, '0.9', Infinity]) {
                expect(fieldAt(crown), String(crown)).toEqual([]);
            }
            const centre = stage.centre();
            let previous = null;
            for (const crown of [0.1, 0.3, 0.6, 0.85, 1]) {
                const fields = fieldAt(crown);
                expect(fields).toHaveLength(1);
                const [wheel] = fields;
                expect(wheel).toMatchObject({ kind: 'vortex', turn: 1 });
                expect(wheel.x).toBeCloseTo(centre.x, 9);
                expect(wheel.z).toBeCloseTo(centre.z, 9);
                // Wide enough to go round the card, and within its own reach.
                expect(wheel.radius).toBeGreaterThan(stage.halfWidth() * (stage.board.x1 - stage.board.x0));
                expect(wheel.reach).toBeGreaterThan(wheel.radius);
                // Clear of the grass under it.
                expect(wheel.top).toBeGreaterThan(groundUnder(wheel) + 1);
                if (previous) {
                    expect(wheel.top).toBeGreaterThan(previous.top);
                    expect(wheel.spin).toBeGreaterThan(previous.spin);
                    expect(wheel.radius).toBeGreaterThanOrEqual(previous.radius);
                }
                previous = wheel;
            }
            // It stays within the height of the card, and a crown past full is a full crown.
            expect(previous.top).toBeLessThan(stage.edge(1, 1).y + 1);
            expect(fieldAt(7)).toEqual([previous]);
            // The petals a combo throws go round the way the wheel turns.
            const { director: other, sim } = createDirector();
            other.apply(frameWith([emitter({ kind: 'combo', strength: 1 })]), STEP);
            for (const petal of sim.thrown()) {
                const turning = (petal.x - centre.x) * petal.vz - (petal.z - centre.z) * petal.vx;
                expect(turning * previous.turn).toBeGreaterThan(0);
            }
        });

        it('keeps feeding the crown while it turns, at a rate that follows time and the crown', () => {
            const fed = (crown, { seconds = 3, dt = STEP, frames = Math.round(seconds / dt) } = {}) => {
                const { director, sim } = createDirector();
                for (let step = 0; step < frames; step++) director.apply(frameWith([], { crown }), dt);
                return sim.thrown();
            };
            expect(fed(0)).toEqual([]);
            const rates = [0.2, 0.5, 0.8, 1].map((crown) => fed(crown).length);
            expect(rates[0]).toBeGreaterThan(10);
            for (let index = 1; index < rates.length; index++) expect(rates[index]).toBeGreaterThan(rates[index - 1]);
            // Seconds, not frames.
            expect(Math.abs(fed(0.8, { dt: 1 / 30 }).length - rates[2])).toBeLessThanOrEqual(2);
            expect(Math.abs(fed(0.8, { dt: 1 / 144 }).length - rates[2])).toBeLessThanOrEqual(2);
            expect(Math.abs(fed(0.8, { seconds: 6 }).length - rates[2] * 2)).toBeLessThanOrEqual(2);
            // A frozen frame feeds nothing.
            expect(fed(0.8, { dt: 0, frames: 180 })).toEqual([]);
            // One kind after another, so the crown stays woven of all seven.
            const thrown = fed(0.8);
            expect(new Set(thrown.map((petal) => petal.flower)).size).toBe(SUMMER_BOUQUET_KINDS);
            for (let index = 1; index < thrown.length; index++) {
                expect(thrown[index].flower).toBe((thrown[index - 1].flower + 1) % SUMMER_BOUQUET_KINDS);
            }
            // A crown that drops and comes back does not pay out what it would have fed meanwhile.
            const { director, sim } = createDirector();
            for (let step = 0; step < 59; step++) director.apply(frameWith([], { crown: 0.8 }), STEP);
            const before = sim.spawn.mock.calls.length;
            for (let step = 0; step < 600; step++) director.apply(frameWith([], { crown: 0 }), STEP);
            director.apply(frameWith([], { crown: 0.8 }), STEP);
            expect(sim.spawn.mock.calls.length - before).toBeLessThanOrEqual(2);
        });
    });

    describe('environment', () => {
        it('reports the wind it is given and the envelopes of the frame', () => {
            const { director } = createDirector();
            const env = director.apply(frameWith([], {
                gust: 0.4, glow: 0.7, heat: 0.3, settled: true,
            }), STEP, { x: 0.6, z: -0.8, strength: 0.5 });
            expect(env).toMatchObject({
                windX: 0.6, windZ: -0.8, wind: 0.5, gust: 0.4, glow: 0.7, heat: 0.3, settled: true, front: null,
            });
            // A default breeze when none is given, and no gust beyond a full one.
            const calm = director.apply(frameWith([], { gust: 9 }), STEP);
            expect(calm.gust).toBe(1);
            expect(Math.hypot(calm.windX, calm.windZ)).toBeCloseTo(1, 9);
            expect(calm.wind).toBeGreaterThan(0);
            expect(director.apply(frameWith([], { gust: -3 }), STEP).gust).toBe(0);
            // Junk in the frame is no gust, no glow and still play.
            const junk = director.apply(frameWith([], {
                gust: NaN, glow: 'x', heat: undefined, settled: 'yes',
            }), STEP, { x: 1, z: 0, strength: NaN });
            expect(junk).toMatchObject({
                gust: 0, glow: 0, heat: 0, settled: false,
            });
            expect(Number.isFinite(junk.wind)).toBe(true);
        });

        it('maps the wind front to world x across the view, in the direction the frame gives it', () => {
            const { director } = createDirector();
            const at = (position, direction = 1, strength = 0.8) => director.apply(frameWith([], {
                front: { position, direction, strength },
            }), STEP).front;
            const middle = { ...at(0) };
            expect(middle).toMatchObject({ x: 0, strength: 0.8, direction: 1 });
            const [left, right] = [{ ...at(-1) }, { ...at(1) }];
            expect(left.x).toBeLessThan(-10);
            expect(right.x).toBeCloseTo(-left.x, 9);
            expect({ ...at(0.5) }.x).toBeCloseTo(right.x / 2, 9);
            expect({ ...at(1, -1) }).toMatchObject({ x: right.x, direction: -1 });
            // No front, or one with no force left, is no front.
            expect(director.apply(frameWith(), STEP).front).toBeNull();
            expect(at(0.3, 1, 0)).toBeNull();
            expect(at(0.3, 1, 1e-6)).toBeNull();
        });

        it('reuses one environment object and one field list between frames', () => {
            const { director } = createDirector();
            const first = director.apply(frameWith([emitter()], { crown: 0.8 }), STEP);
            const { fields } = first;
            expect(fields.length).toBe(2);
            const second = director.apply(frameWith(), STEP);
            expect(second).toBe(first);
            expect(second.fields).toBe(fields);
            // Fields last one frame: nothing lingers once the frame stops asking.
            expect(fields).toEqual([]);
            expect(director.fields).toBe(fields);
        });
    });

    describe('lifecycle and scale', () => {
        /** A frame of everything at once, with land everywhere so that no throw depends on the shore. */
        const busy = (reactions) => {
            reactions.onHardDrop({ distance: 18 });
            reactions.onPieceLock({ piece: pieceOf('T') });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(6);
            reactions.onTSpin({ piece: pieceOf('T') });
            reactions.onPerfectClear();
        };

        it('drops what is in flight on reset, and replays nothing the reactions still hold', () => {
            const session = (resetAt) => {
                const made = createDirector({ groundHeight: PLAIN });
                const reactions = new SummerReactions({ rng: seededRandom(1) });
                busy(reactions);
                for (let step = 0; step < 240; step++) {
                    made.director.apply(reactions.update(STEP), STEP);
                    if (step === resetAt) {
                        expect(made.director.fields.length).toBeGreaterThan(0);
                        made.director.reset();
                        made.ripples.reset();
                        made.waves.reset();
                        // What was in flight is gone at once.
                        expect(made.director.fields).toEqual([]);
                    }
                }
                return made;
            };
            const whole = session(-1);
            const played = (made) => [made.rung, made.blown, made.sim.spawn].map((spy) => spy.mock.calls.length);
            const asked = played(whole);
            expect(asked[0]).toBeGreaterThan(3);
            expect(asked[1]).toBeGreaterThan(3);
            expect(asked[2]).toBeGreaterThan(200);
            for (const resetAt of [0, 3, 20, 60]) {
                const interrupted = session(resetAt);
                // The reactions still hold every ring, gust and emitter: none of them is played twice.
                expect(interrupted.rung.mock.calls.length, `rings, reset at ${resetAt}`).toBe(asked[0]);
                expect(interrupted.blown.mock.calls.length, `gusts, reset at ${resetAt}`).toBe(asked[1]);
                expect(interrupted.sim.spawn.mock.calls.length, `petals, reset at ${resetAt}`).toBe(asked[2]);
            }
        });

        it('starts afresh when the reactions start over, and only then', () => {
            const {
                director, sim, rung, blown, ripples, waves,
            } = createDirector({ groundHeight: PLAIN });
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            // A lock and a t-spin: each throws once, rings once and stirs the meadow once.
            const events = () => {
                reactions.onPieceLock({ piece: pieceOf('I') });
                reactions.onTSpin({ piece: pieceOf('T') });
            };
            events();
            director.apply(reactions.update(STEP), STEP);
            const first = [rung.mock.calls.length, blown.mock.calls.length, sim.spawn.mock.calls.length];
            expect(first.every((count) => count > 0)).toBe(true);
            expect(director.epoch).toBe(1);
            // The same frame again, and again after the director's own reset: nothing new.
            director.apply(reactions.getFrame(), 0);
            director.reset();
            director.apply(reactions.getFrame(), 0);
            expect([rung.mock.calls.length, blown.mock.calls.length, sim.spawn.mock.calls.length]).toEqual(first);

            // A new session. The director is told nothing: it reads the epoch off the next frame.
            reactions.reset();
            ripples.reset();
            waves.reset();
            director.apply(reactions.update(STEP), STEP);
            expect(director.epoch).toBe(2);
            expect([director.ringSerial, director.waveSerial]).toEqual([-1, -1]);
            expect([rung.mock.calls.length, blown.mock.calls.length, sim.spawn.mock.calls.length]).toEqual(first);
            // The new session's first events carry serials and slots the old one already used.
            events();
            director.apply(reactions.update(STEP), STEP);
            expect([rung.mock.calls.length, blown.mock.calls.length, sim.spawn.mock.calls.length])
                .toEqual(first.map((count) => count * 2));
            for (let step = 0; step < 30; step++) director.apply(reactions.update(STEP), STEP);
            expect([rung.mock.calls.length, blown.mock.calls.length, sim.spawn.mock.calls.length])
                .toEqual(first.map((count) => count * 2));

            // An event in the very frame of the reset is not lost either: no rest frame is needed.
            reactions.reset();
            events();
            director.apply(reactions.update(STEP), STEP);
            expect(director.epoch).toBe(3);
            expect([rung.mock.calls.length, blown.mock.calls.length, sim.spawn.mock.calls.length])
                .toEqual(first.map((count) => count * 3));
        });

        it('treats a timestep that is not a number as no time at all', () => {
            const { director, sim, rung } = createDirector();
            for (const dt of [NaN, undefined, null, 'x', -1, -Infinity, Infinity]) {
                for (let step = 0; step < 50; step++) {
                    expect(() => director.apply(frameWith([], { crown: 0.9 }), dt)).not.toThrow();
                }
            }
            // No crown fed, no fish risen, and its clocks are still numbers.
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(rung).not.toHaveBeenCalled();
            expect(Number.isFinite(director.fishClock)).toBe(true);
            expect(Number.isFinite(director.crownFeed)).toBe(true);
            for (let step = 0; step < 120; step++) director.apply(frameWith([], { crown: 0.9 }), STEP);
            expect(sim.spawn).toHaveBeenCalled();
        });

        it('scales every throw with the petal budget of the tier, down to a floor', () => {
            const thrownAt = (petals) => {
                const counts = {};
                for (const kind of ['lock', 'seeds', 'clear', 'rise', 'bouquet', 'spin', 'combo']) {
                    const { director, sim } = createDirector({ petals, groundHeight: PLAIN });
                    play(director, sim, [{
                        kind, strength: 1, lines: 4, duration: 3,
                    }], { seconds: 2.5 });
                    counts[kind] = sim.spawn.mock.calls.length;
                }
                const { director, sim } = createDirector({ petals });
                for (let step = 0; step < 120; step++) director.apply(frameWith([], { crown: 1 }), STEP);
                counts.crown = sim.spawn.mock.calls.length;
                return counts;
            };
            const reference = thrownAt(REFERENCE.petals);
            const double = thrownAt(REFERENCE.petals * 2);
            const half = thrownAt(REFERENCE.petals / 2);
            for (const [kind, count] of Object.entries(reference)) {
                expect(count, kind).toBeGreaterThan(10);
                expect(double[kind] / count, kind).toBeCloseTo(2, 0);
                expect(half[kind] / count, kind).toBeCloseTo(0.5, 1);
            }
            // The smallest pools still answer: below a floor the throws stop shrinking.
            const tiny = thrownAt(1);
            expect(thrownAt(10)).toEqual(tiny);
            for (const [kind, count] of Object.entries(tiny)) {
                expect(count, kind).toBeGreaterThan(0);
                expect(count, kind).toBeLessThan(half[kind]);
            }
            // Every tier's own budget throws at least a handful and never more than the tier above.
            let above = null;
            for (const tier of TIERS) {
                const counts = thrownAt(SUMMER_TIERS[tier].petals);
                for (const [kind, count] of Object.entries(counts)) {
                    expect(count, `${tier} ${kind}`).toBeGreaterThan(2);
                    if (above) expect(count, `${tier} ${kind}`).toBeLessThanOrEqual(above[kind]);
                }
                above = counts;
            }
        });

        it('ignores frames and emitters it does not understand', () => {
            const { director, sim, rung } = createDirector();
            expect(() => director.apply()).not.toThrow();
            expect(() => director.apply({})).not.toThrow();
            expect(() => director.apply({ emitters: undefined, rings: undefined, waves: undefined })).not.toThrow();
            for (const kind of ['fireworks', '', undefined, null, 7, 'splash', 'LOCK']) {
                expect(() => director.apply(frameWith([emitter({ kind })]), STEP)).not.toThrow();
            }
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(rung).not.toHaveBeenCalled();
            expect(director.apply().fields).toEqual([]);
            // Emitters with nonsense in them throw nothing the simulation would take.
            const real = new SummerPetalSim({ count: 200, reserve: 150, rng: seededRandom(2) });
            const live = createDirector({ sim: real });
            let serial = 0;
            for (const kind of ['lock', 'seeds', 'clear', 'rise', 'bouquet', 'spin', 'combo']) {
                for (const junk of [{ row: NaN }, { strength: NaN }, { column: NaN }, { side: NaN }, { age: NaN }]) {
                    serial += 1;
                    const broken = emitter({ kind, ...junk, serial });
                    expect(() => live.director.apply(frameWith([broken]), STEP)).not.toThrow();
                }
            }
            for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'size']) {
                expect(real[name].every(Number.isFinite), name).toBe(true);
            }
        });

        it('keeps a broken random source inside its range', () => {
            for (const rng of [() => NaN, () => Infinity, () => -3, () => 7, () => undefined, () => '0.5', () => 1]) {
                const { director, sim } = createDirector({ rng, groundHeight: PLAIN });
                const kinds = ['lock', 'seeds', 'clear', 'rise', 'bouquet', 'spin', 'combo'];
                expect(() => play(director, sim, kinds.map((kind) => ({ kind, strength: 1, lines: 2 })), {
                    seconds: 0.5, frame: { crown: 0.9 },
                })).not.toThrow();
                const thrown = sim.thrown();
                expect(thrown.length).toBeGreaterThan(50);
                const sane = (petal) => [petal.x, petal.y, petal.z, petal.vx, petal.vy, petal.vz].every(Number.isFinite)
                    && Math.hypot(petal.vx, petal.vy, petal.vz) < 40
                    && petal.life > 0 && petal.life < 12 && petal.size > 0 && petal.size < 0.4;
                expect(thrown.filter((petal) => !sane(petal))).toEqual([]);
                expect(Number.isFinite(director.fishClock)).toBe(true);
            }
        });
    });

    describe('with the real simulation', () => {
        /** A straight shore across the view: meadow climbing gently behind it, lake in front. */
        const straightShore = (x, z) => (z < -9.5 ? -2 : 0.3 + (z + 9.5) * 0.07);

        function createWorld({
            tier = 'High', aspect = LANDSCAPE, seed = 271, groundHeight = summerGroundHeight,
        } = {}) {
            const budget = SUMMER_TIERS[tier];
            const rng = seededRandom(seed);
            const sim = new SummerPetalSim({
                count: budget.petals, reserve: Math.round(budget.petals * 0.85), rng, groundHeight,
            });
            const made = createDirector({
                aspect, petals: budget.petals, sim, rings: budget.ripples, gusts: budget.waves, seed, groundHeight,
            });
            const reactions = new SummerReactions({ quality: tier, rng });
            const thrown = vi.spyOn(sim, 'spawn');
            const tick = (dt = STEP) => {
                const frame = reactions.update(dt);
                const env = made.director.apply(frame, dt);
                sim.step(dt, env);
                // The pools are aged by the world, which only ever hands them a real step.
                const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
                made.ripples.update(step);
                made.waves.update(step);
                return frame;
            };
            return {
                ...made, sim, reactions, thrown, tick, budget,
            };
        }

        const finite = (array) => array.every(Number.isFinite);

        it.each([
            // Every tier over a plain shore, and the real land once in each framing.
            ...TIERS.map((tier, index) => [tier, 'a straight shore', index % 2 ? PORTRAIT : LANDSCAPE, straightShore]),
            ['Medium', 'the meadow in landscape', LANDSCAPE, summerGroundHeight],
            ['Minimal', 'the meadow in portrait', PORTRAIT, summerGroundHeight],
        ])(
            'plays a storm of events inside every pool of %s over %s, with every throw finite and in the air',
            (tier, _label, aspect, groundHeight) => {
                const world = createWorld({
                    tier, aspect, seed: 9, groundHeight,
                });
                const { reactions, sim, budget } = world;
                const random = seededRandom(31);
                const letter = () => LETTERS[Math.floor(random() * LETTERS.length)];
                const column = () => Math.floor(random() * 10);
                const events = [
                    () => reactions.onPieceLock({ piece: pieceOf(letter(), column(), 4 + Math.floor(random() * 20)) }),
                    () => {
                        reactions.onHardDrop({ distance: random() * 22 });
                        reactions.onPieceLock({ piece: pieceOf(letter(), column()) });
                    },
                    () => reactions.onPieceLock({ piece: pieceOf(letter(), column()) }),
                    () => reactions.onLineClear(1 + Math.floor(random() * 4), { clearedRows: [22, 23] }),
                    () => reactions.onCombo(2 + Math.floor(random() * 30)),
                    () => reactions.onTSpin({ piece: pieceOf('T', column()) }),
                    () => reactions.onPerfectClear(),
                    () => reactions.onLevelUp(),
                    () => reactions.onBackToBack(),
                ];
                let busiest = 0;
                const kinds = new Set();
                for (let frame = 0; frame < 80; frame++) {
                    // One of each flower to begin with, so the bouquet is thrown whatever the dice say.
                    if (frame < LETTERS.length) reactions.onPieceLock({ piece: pieceOf(LETTERS[frame], frame) });
                    if (random() < 0.7) events[Math.floor(random() * events.length)]();
                    if (frame === 70) reactions.onGameOver();
                    world.tick().emitters.forEach((playing) => kinds.add(playing.kind));
                    const { live, reserve, ambient } = sim.counts();
                    busiest = Math.max(busiest, live);
                    expect(live).toBeLessThanOrEqual(reserve);
                    expect(ambient + reserve).toBe(budget.petals);
                    expect(world.ripples.active()).toBeLessThanOrEqual(budget.ripples);
                    expect(world.waves.active()).toBeLessThanOrEqual(budget.waves);
                    expect(world.director.fields.length).toBeLessThanOrEqual(reactions.maxEmitters + 1);
                }
                // The storm reached every part of the language and filled the air.
                expect([...kinds].sort()).toEqual(['bouquet', 'clear', 'combo', 'lock', 'rise', 'seeds', 'spin']);
                expect(busiest).toBeGreaterThan(sim.reserve * 0.3);
                expect(world.ripples.rings).toHaveLength(budget.ripples);
                expect(world.waves.rings).toHaveLength(budget.waves);
                // Every throw the director made was a real place in the air above the meadow or the lake.
                expect(world.thrown.mock.calls.length).toBeGreaterThan(sim.reserve * 0.3);
                for (const [x, y, z, vx, vy, vz] of world.thrown.mock.calls) {
                    const from = [x, y, z, vx, vy, vz];
                    if (!from.every(Number.isFinite)) throw new Error(`thrown from ${from}`);
                    if (!(y > Math.max(0, groundHeight(x, z)) + 0.1)) throw new Error(`thrown on the ground: ${from}`);
                }
                expect(world.thrown.mock.results.every((result) => result.value >= sim.ambient)).toBe(true);
                // Nothing in the buffers the renderer reads ever left the numbers.
                for (const name of ['outPlace', 'outLook', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'life']) {
                    expect(finite(sim[name]), name).toBe(true);
                }
                for (const pool of [world.ripples, world.waves]) {
                    for (const ring of pool.rings) expect(finite(ring.toArray())).toBe(true);
                }
            },
        );

        it('keeps hostile payloads out of the air, the lake and the meadow', () => {
            const world = createWorld({ tier: 'Medium' });
            const { reactions, sim } = world;
            const hostile = [undefined, null, 0, NaN, 'piece', [], {}, { detail: null }, { piece: null },
                { piece: { x: NaN, y: NaN } }, { piece: { x: Infinity, y: 4, shape: [[1]] } },
                {
                    piece: {
                        x: 1e12, y: -1e12, shape: [[1]], shapeKey: 'T',
                    },
                }, { viewportOrigin: { x: Infinity, y: 0 } },
                { viewportOrigin: { x: -5, y: 9 } }, { distance: {} }, { distance: 1e9 },
                { clearedRows: [Infinity, NaN] }, { clearedRows: [1e9] }];
            for (const payload of hostile) {
                reactions.onHardDrop(payload);
                reactions.onPieceLock(payload);
                reactions.onTSpin(payload);
                reactions.onLineClear(2, payload);
                reactions.onCombo(3, payload);
                reactions.onPerfectClear(payload);
                reactions.onLevelUp(payload);
                for (let step = 0; step < 6; step++) world.tick();
            }
            for (const dt of [NaN, -1, Infinity, undefined, 0, 5]) world.tick(dt);
            expect(sim.counts().live).toBeGreaterThan(50);
            for (const name of ['outPlace', 'outLook', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'life']) {
                expect(finite(sim[name]), name).toBe(true);
            }
            for (const pool of [world.ripples, world.waves]) {
                expect(pool.active()).toBeGreaterThan(0);
                for (const ring of pool.rings) expect(finite(ring.toArray())).toBe(true);
            }
            for (const field of world.director.fields) {
                const numbers = Object.values(field).filter((value) => typeof value === 'number');
                expect(numbers.every(Number.isFinite)).toBe(true);
            }
        });

        it.each([
            ['a lock', (r) => r.onPieceLock({ piece: pieceOf('J', 2) }), (petal) => petal.kind === PETAL],
            ['a long hard drop', (r) => { r.onHardDrop({ distance: 19 }); r.onPieceLock({ piece: pieceOf('J', 2) }); },
                (petal) => petal.kind === SEED],
            ['a line clear', (r) => r.onLineClear(2, { clearedRows: [22, 23] }), (petal) => Math.abs(petal.vx) > 4],
            ['four lines', (r) => r.onLineClear(4, { clearedRows: [20, 21, 22, 23] }),
                (petal) => petal.kind === SEED && Math.abs(petal.vx) < 1],
            ['a combo', (r) => r.onCombo(5), () => true],
            ['a t-spin', (r) => r.onTSpin({ piece: pieceOf('T', 7) }),
                (petal) => petal.flower === SUMMER_PIECE_FLOWERS.T],
            ['a perfect clear', (r) => r.onPerfectClear(), (petal) => petal.y > 5.5],
        ])('puts petals in the air for %s', (_label, event, expected) => {
            const world = createWorld();
            event(world.reactions);
            for (let step = 0; step < 90; step++) world.tick();
            const thrown = world.thrown.mock.calls.map(([x, y, z, vx, vy, vz, options = {}]) => ({
                x, y, z, vx, vy, vz, ...options,
            }));
            expect(thrown.length).toBeGreaterThan(10);
            expect(thrown.filter(expected).length).toBeGreaterThan(5);
            expect(world.sim.counts().live).toBeGreaterThan(10);
        });

        it('throws the bouquet from the maypole when the seventh kind is locked, and only then', () => {
            const world = createWorld();
            const { top } = maypoleAnchors();
            const fromThePole = () => world.thrown.mock.calls.filter(([x, y, z]) => Math.hypot(x - top.x, z - top.z) < 3
                && y > groundUnder({ x, z }) + 3).length;
            for (const letter of LETTERS.slice(0, 6)) {
                world.reactions.onPieceLock({ piece: pieceOf(letter) });
                for (let step = 0; step < 30; step++) world.tick();
            }
            expect(fromThePole()).toBe(0);
            world.reactions.onPieceLock({ piece: pieceOf(LETTERS[6]) });
            for (let step = 0; step < 120; step++) world.tick();
            const thrown = fromThePole();
            expect(thrown).toBeGreaterThan(50);
            // One bouquet: the lanterns burning down throw nothing more.
            for (let step = 0; step < 300; step++) world.tick();
            expect(fromThePole()).toBe(thrown);
        });

        it('winds a combo into a crown around the board and holds it there', () => {
            const world = createWorld();
            const { sim, stage, reactions } = world;
            const centre = stage.centre();
            let wheel = null;
            for (let step = 0; step < 60 * 6; step++) {
                if (step % 45 === 0) reactions.onCombo(12);
                world.tick();
                wheel = world.director.fields.find((field) => field.kind === 'vortex') || wheel;
            }
            expect(reactions.frame.crown).toBeGreaterThan(0.8);
            const ring = [];
            for (let index = sim.ambient; index < sim.count; index++) {
                if (sim.life[index] > 0 && sim.kind[index] === PETAL) {
                    const dx = sim.x[index] - centre.x;
                    const dz = sim.z[index] - centre.z;
                    const radius = Math.hypot(dx, dz);
                    const turning = (dx * sim.vz[index] - dz * sim.vx[index]) / (radius * radius);
                    ring.push({ radius, y: sim.y[index], turning });
                }
            }
            expect(ring.length).toBeGreaterThan(100);
            const held = ring.filter((petal) => Math.abs(petal.radius - wheel.radius) < 1.5);
            // Most of what is in the air is on the wheel, going round with it, at its height.
            expect(held.length).toBeGreaterThan(ring.length * 0.6);
            expect(held.filter((petal) => petal.turning * wheel.turn > 0).length).toBeGreaterThan(held.length * 0.9);
            expect(Math.abs(mean(held.map((petal) => petal.y)) - wheel.top)).toBeLessThan(1.5);
            expect(mean(held.map((petal) => petal.turning)) * wheel.turn).toBeGreaterThan(wheel.spin * 0.4);
            // All seven kinds are in it.
            const kinds = new Set();
            for (let index = sim.ambient; index < sim.count; index++) {
                if (sim.life[index] > 0) kinds.add(sim.flower[index]);
            }
            expect(kinds.size).toBe(SUMMER_BOUQUET_KINDS);
        });

        it('lets the petals come down and the air clear once the game is over', () => {
            const evening = () => {
                const world = createWorld({ tier: 'Low' });
                for (let step = 0; step < 150; step++) {
                    if (step % 30 === 0) {
                        world.reactions.onPieceLock({ piece: pieceOf('Z') });
                        world.reactions.onLineClear(3, { clearedRows: [21, 22, 23] });
                        world.reactions.onCombo(8);
                    }
                    world.tick();
                }
                return world;
            };
            const [world, twin] = [evening(), evening()];
            const { sim, reactions } = world;
            expect(sim.counts().live).toBeGreaterThan(100);
            expect(twin.sim.counts().live).toBe(sim.counts().live);
            reactions.onGameOver();
            for (let step = 0; step < 150; step++) {
                world.tick();
                twin.tick();
            }
            // Settled petals wear out sooner than those of an evening still in play.
            expect(sim.counts().live).toBeLessThan(twin.sim.counts().live);
            for (let step = 0; step < 60 * 8; step++) world.tick();
            expect(sim.counts().live).toBe(0);
            // The down that was always adrift is still there.
            for (let index = 0; index < sim.ambient; index++) expect(sim.outPlace[index * 4 + 3]).toBeGreaterThan(0);
        });
    });
});
