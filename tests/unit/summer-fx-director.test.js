import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { summerEye, summerViewFor } from '../../src/themes/summer/summer-composition.js';
import { SummerFxDirector } from '../../src/themes/summer/summer-fx-director.js';
import { SUMMER_PARTICLES, SummerPetalSim } from '../../src/themes/summer/summer-petal-sim.js';
import { SUMMER_TIERS } from '../../src/themes/summer/summer-quality.js';
import {
    SUMMER_HOURS, summerHourAt, summerSunDirection,
} from '../../src/themes/summer/summer-hours.js';
import {
    SUMMER_BLOSSOM_MAYPOLE, SUMMER_BOUQUET_KINDS, SUMMER_MIXED, SUMMER_PIECE_FLOWERS, SUMMER_REACTION_LIMITS,
    SummerReactions,
} from '../../src/themes/summer/summer-reactions.js';
import { SummerRings } from '../../src/themes/summer/summer-rings.js';
import {
    SUMMER_DEFAULT_BOARD, SUMMER_STAGE_DEPTH, SummerStage, readSummerBoardRect, readSummerHudRect,
} from '../../src/themes/summer/summer-stage.js';
import {
    SUMMER_PLACES, summerGroundHeight, summerShoreDistance,
} from '../../src/themes/summer/summer-terrain.js';

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;
const TIERS = Object.keys(SUMMER_TIERS);
const LETTERS = Object.keys(SUMMER_PIECE_FLOWERS);
const {
    petal: PETAL, seed: SEED, pollen: POLLEN, glow: GLOW,
} = SUMMER_PARTICLES;
/** The pool the director's throws are written for; other tiers scale from it. */
const REFERENCE = SUMMER_TIERS.High;
/** Land everywhere, a metre up: for tests that must not depend on where the shore runs. */
const PLAIN = () => 1;
/** Open water everywhere, two metres deep. */
const OPEN_WATER = () => -2;
/** The single-player score panel as it stands right of the board on a 16:9 screen. */
const SCORE_PANEL = Object.freeze({
    x0: 0.624, x1: 0.772, y0: 0.19, y1: 0.49,
});
/** The glint where a skipping stone touches the lake: the only light the director lays on the water. */
const isGlint = (particle) => particle.kind === GLOW && particle.y < 1;

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
/** Where a world point is seen, in screen fractions (y down), as DOM rectangles are measured. */
const onScreen = (point, camera) => {
    const seen = ndc(point, camera);
    return { x: (seen.x + 1) / 2, y: (1 - seen.y) / 2 };
};
/** Inside a rectangle of screen fractions. */
const within = (seen, rect) => seen.x > rect.x0 && seen.x < rect.x1 && seen.y > rect.y0 && seen.y < rect.y1;
/** A sky flower as the reactions describe one. */
const flowerOf = (overrides = {}) => ({
    kind: 'blossom', lines: 0, flower: 2, strength: 1, duration: 1.4, ...overrides,
});

/**
 * Open one sky flower into a real petal simulation and let the air carry it for `seconds`: where
 * its heart is, what was thrown, and where every petal of it has got to.
 */
function bloom({
    aspect = LANDSCAPE, board = null, hud = null, tier = 'High', seconds = 1.5, groundHeight = summerGroundHeight,
    maypole = maypoleAnchors(), ...flower
} = {}) {
    const budget = SUMMER_TIERS[tier];
    const sim = new SummerPetalSim({
        count: budget.petals, reserve: Math.round(budget.petals * 0.86), rng: seededRandom(4), groundHeight,
    });
    const spawned = vi.spyOn(sim, 'spawn');
    const made = createDirector({
        aspect, sim, petals: budget.petals, groundHeight, maypole,
    });
    if (board) made.stage.setBoard(board);
    if (hud) made.stage.setHud(hud);
    const spec = flowerOf(flower);
    let fit = null;
    const steps = Math.round(seconds / STEP);
    for (let step = 0; step <= steps; step++) {
        const age = step * STEP;
        const before = spawned.mock.calls.length;
        const env = made.director.apply(frameWith(age < spec.duration ? [emitter({ ...spec, age })] : []), STEP);
        // The share of its full size the flower was given, read in the frame it opened.
        if (fit === null && spawned.mock.calls.slice(before).some(([, , , , , , options]) => options?.kind === PETAL)) {
            fit = made.director.blossomFit;
        }
        sim.step(STEP, env);
    }
    const particles = spawned.mock.calls.map(([x, y, z, vx, vy, vz, options = {}], call) => ({
        index: spawned.mock.results[call].value, x, y, z, vx, vy, vz, ...options,
    }));
    const place = (particle) => new THREE.Vector3(sim.x[particle.index], sim.y[particle.index], sim.z[particle.index]);
    const heart = made.director.heart.clone();
    const petals = particles.filter((particle) => particle.kind === PETAL)
        .map((particle) => ({ ...particle, at: place(particle) }));
    const reach = Math.max(...petals.map((petal) => petal.at.distanceTo(heart)));
    return {
        ...made, sim, heart, particles, petals, fit, reach,
    };
}

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

    describe('what covers the middle of the screen', () => {
        it('is the board card alone until a score panel is measured beside it', () => {
            const stage = new SummerStage(frameCamera());
            expect(stage.hud).toBeNull();
            expect(stage.covered()).toEqual({ x0: SUMMER_DEFAULT_BOARD.x0, x1: SUMMER_DEFAULT_BOARD.x1 });
            // A reading of its own each time: changing one does not move the board.
            const first = stage.covered();
            first.x0 = 0;
            first.x1 = 1;
            expect(stage.covered()).toEqual({ x0: SUMMER_DEFAULT_BOARD.x0, x1: SUMMER_DEFAULT_BOARD.x1 });
            expect(stage.board).toEqual(SUMMER_DEFAULT_BOARD);
            // It follows the card wherever that is measured to be.
            stage.setBoard({
                x0: 0.1, x1: 0.4, y0: 0.2, y1: 0.8,
            });
            expect(stage.covered()).toEqual({ x0: 0.1, x1: 0.4 });
        });

        it('is widened by the score panel on whichever side it stands, and by no more than that', () => {
            const stage = new SummerStage(frameCamera());
            const { x0, x1 } = SUMMER_DEFAULT_BOARD;
            // Right of the board, as in single player: the right edge moves out, the left stays.
            stage.setHud(SCORE_PANEL);
            expect(stage.covered()).toEqual({ x0, x1: SCORE_PANEL.x1 });
            expect(stage.hud).toEqual(SCORE_PANEL);
            // The stage keeps its own copy of the panel.
            expect(stage.hud).not.toBe(SCORE_PANEL);
            const measured = { ...SCORE_PANEL };
            stage.setHud(measured);
            measured.x1 = 0.99;
            expect(stage.covered().x1).toBe(SCORE_PANEL.x1);
            // Left of it: the left edge moves out instead.
            stage.setHud({
                x0: 0.2, x1: 0.36, y0: 0.3, y1: 0.6,
            });
            expect(stage.covered()).toEqual({ x0: 0.2, x1 });
            // Straddling the card on both sides: both edges.
            stage.setHud({
                x0: 0.3, x1: 0.7, y0: 0.05, y1: 0.08,
            });
            expect(stage.covered()).toEqual({ x0: 0.3, x1: 0.7 });
            // Inside the card's own width (above or below it): nothing is added.
            stage.setHud({
                x0: 0.42, x1: 0.58, y0: 0.01, y1: 0.07,
            });
            expect(stage.covered()).toEqual({ x0, x1 });
            // A panel hanging off the screen is clamped onto it.
            stage.setHud({
                x0: 0.7, x1: 1.4, y0: -0.2, y1: 0.5,
            });
            expect(stage.hud).toEqual({
                x0: 0.7, x1: 1, y0: 0, y1: 0.5,
            });
            expect(stage.covered()).toEqual({ x0, x1: 1 });
            // The card itself is untouched by all of it: its edges, rows and centre are the board's.
            const camera = frameCamera();
            const plain = new SummerStage(camera);
            const panelled = new SummerStage(camera);
            panelled.setHud(SCORE_PANEL);
            expect(panelled.board).toEqual(plain.board);
            for (const row of [0, 0.5, 1]) {
                expectVector(panelled.edge(1, row), plain.edge(1, row), 12);
                expectVector(panelled.edge(-1, row), plain.edge(-1, row), 12);
            }
            expectVector(panelled.centre(), plain.centre(), 12);
            expect(panelled.screen(1, 0)).toEqual(plain.screen(1, 0));
        });

        it('forgets the panel when it is gone or when what is measured is no panel', () => {
            const stage = new SummerStage(frameCamera());
            const board = { x0: SUMMER_DEFAULT_BOARD.x0, x1: SUMMER_DEFAULT_BOARD.x1 };
            const junk = [null, undefined, {}, 'panel', 42, [], true, {
                x0: NaN, x1: 0.8, y0: 0.2, y1: 0.5,
            }, { x0: 0.6, x1: 0.8, y0: 0.2 }, {
                x0: '0.6', x1: 0.8, y0: 0.2, y1: 0.5,
            }, {
                x0: 0.8, x1: 0.6, y0: 0.2, y1: 0.5,
            }, {
                x0: 0.6, x1: 0.8, y0: 0.5, y1: 0.2,
            },
            // A hairline is not a panel.
            {
                x0: 0.7, x1: 0.705, y0: 0.2, y1: 0.5,
            }, {
                x0: 0.6, x1: 0.8, y0: 0.2, y1: 0.205,
            }, {
                x0: 0.6, x1: Infinity, y0: 0.2, y1: 0.5,
            }];
            for (const rect of junk) {
                stage.setHud(SCORE_PANEL);
                expect(stage.covered().x1).toBe(SCORE_PANEL.x1);
                expect(() => stage.setHud(rect)).not.toThrow();
                expect(stage.hud, JSON.stringify(rect)).toBeNull();
                expect(stage.covered(), JSON.stringify(rect)).toEqual(board);
            }
            // The panel is the page's, not the camera's: it outlasts a refresh and a new board.
            stage.setHud(SCORE_PANEL);
            stage.refresh();
            stage.setBoard({
                x0: 0.3, x1: 0.5, y0: 0.1, y1: 0.9,
            });
            expect(stage.covered()).toEqual({ x0: 0.3, x1: SCORE_PANEL.x1 });
            // Nonsense for a board falls back to the default card, still widened by the panel.
            stage.setBoard(null);
            expect(stage.covered()).toEqual({ x0: SUMMER_DEFAULT_BOARD.x0, x1: SCORE_PANEL.x1 });
        });
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

describe('reading the Summer score panel from the page', () => {
    const SELECTOR = '.single-player-stats-bar';
    const win = (overrides = {}) => ({
        innerWidth: 1000, innerHeight: 500, getComputedStyle: (element) => element.style ?? {}, ...overrides,
    });
    const panel = ({
        left = 624, top = 95, width = 148, height = 150, style = {},
    } = {}) => ({
        style,
        getBoundingClientRect: () => ({
            left, top, right: left + width, bottom: top + height, width, height,
        }),
    });
    const page = (element) => ({ querySelector: vi.fn((selector) => (selector === SELECTOR ? element : null)) });

    it('measures the panel beside the board in screen fractions', () => {
        const doc = page(panel());
        const rect = readSummerHudRect(doc, win());
        expect(doc.querySelector).toHaveBeenCalledExactlyOnceWith(SELECTOR);
        expect(Object.keys(rect).sort()).toEqual(['x0', 'x1', 'y0', 'y1']);
        expect(rect.x0).toBeCloseTo(SCORE_PANEL.x0, 12);
        expect(rect.x1).toBeCloseTo(SCORE_PANEL.x1, 12);
        expect(rect.y0).toBeCloseTo(SCORE_PANEL.y0, 12);
        expect(rect.y1).toBeCloseTo(SCORE_PANEL.y1, 12);
        // What it reads is what the stage takes: the board's cover reaches the panel's far edge.
        const stage = new SummerStage(frameCamera());
        stage.setHud(rect);
        expect(stage.covered().x1).toBeCloseTo(SCORE_PANEL.x1, 12);
        // A faint panel is still a panel.
        expect(readSummerHudRect(page(panel({ style: { opacity: '0.3' } })), win())).not.toBeNull();
    });

    it('reads no panel where none shows: hidden, collapsed, off the screen or not there at all', () => {
        const ghosts = [
            panel({ style: { display: 'none' } }),
            panel({ style: { visibility: 'hidden' } }),
            panel({ style: { opacity: '0.01' } }),
            panel({ width: 4 }),
            panel({ height: 0 }),
            panel({ left: -500 }),
            panel({ left: 1000 }),
            panel({ top: -400 }),
            panel({ top: 500 }),
            {},
            null,
            undefined,
        ];
        for (const ghost of ghosts) expect(readSummerHudRect(page(ghost), win())).toBeNull();
        // No page, no window, or a page that cannot be asked.
        expect(readSummerHudRect(null, win())).toBeNull();
        expect(readSummerHudRect(page(panel()), null)).toBeNull();
        expect(readSummerHudRect({}, win())).toBeNull();
        expect(readSummerHudRect({ querySelectorAll: () => [panel()] }, win())).toBeNull();
        // The stage forgets its panel when it is handed that answer.
        const stage = new SummerStage(frameCamera());
        stage.setHud(SCORE_PANEL);
        stage.setHud(readSummerHudRect(page(null), win()));
        expect(stage.hud).toBeNull();
        expect(stage.covered()).toEqual({ x0: SUMMER_DEFAULT_BOARD.x0, x1: SUMMER_DEFAULT_BOARD.x1 });
    });

    it('never divides by an unknown window size, and reports a panel hanging off the screen as it is', () => {
        const rect = readSummerHudRect(page(panel({
            left: 0, top: 0, width: 20, height: 40,
        })), { innerWidth: 0, innerHeight: undefined });
        expect(Object.values(rect).every(Number.isFinite)).toBe(true);
        const hanging = readSummerHudRect(page(panel({ left: 900, width: 300 })), win());
        expect(hanging.x1).toBeCloseTo(1.2, 12);
        // The stage clamps it.
        const stage = new SummerStage(frameCamera());
        stage.setHud(hanging);
        expect(stage.hud.x1).toBe(1);
        expect(stage.covered().x1).toBe(1);
        // A window that cannot say how an element is styled: the panel is taken as showing.
        expect(readSummerHudRect(page(panel({ style: { display: 'none' } })), { innerWidth: 1000, innerHeight: 500 }))
            .not.toBeNull();
    });

    it('reads the live document and window by default', () => {
        vi.stubGlobal('window', win());
        vi.stubGlobal('document', page(panel({
            left: 700, top: 100, width: 200, height: 300,
        })));
        expect(readSummerHudRect()).toEqual({
            x0: 0.7, x1: 0.9, y0: 0.2, y1: 0.8,
        });
        vi.unstubAllGlobals();
        vi.stubGlobal('document', undefined);
        vi.stubGlobal('window', undefined);
        expect(readSummerHudRect()).toBeNull();
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

    it('gives up the ring with the least left in it when full, and lets go one weaker than all', () => {
        const pool = new SummerRings(3, 9, 0.42);
        // A broad clear ring, then two lock rings a moment later.
        pool.add(0, 0, 2.4);
        pool.update(1.5);
        pool.add(5, 0, 0.6);
        pool.add(9, 0, 0.7);
        // The pool is full. A petal's touch weaker than every ring still spreading is let go ...
        const before = pool.rings.map((ring) => ring.toArray());
        expect(pool.add(20, 20, 0.2)).toBeNull();
        expect(pool.rings.map((ring) => ring.toArray())).toEqual(before);
        // ... and a stronger ring takes the place of the one with the least left (the weaker lock
        // ring), not the oldest: the clear ring is still the strongest on the water.
        expect(pool.energy(pool.rings[0])).toBeGreaterThan(pool.energy(pool.rings[1]));
        const taken = pool.add(30, 0, 1.1);
        expect(taken).toBe(pool.rings[1]);
        expect(pool.rings[0].toArray()).toEqual([0, 0, 1.5, 2.4]);
        expect(pool.rings.map((ring) => ring.x).sort((a, b) => a - b)).toEqual([0, 9, 30]);
        // The energy is what the shader draws: strength fading with age, thinning as it spreads.
        const spread = new SummerRings(1, 9, 0.5, 0.25);
        spread.add(0, 0, 2);
        spread.update(2);
        expect(spread.energy(spread.rings[0])).toBeCloseTo((2 * Math.exp(-1)) / 1.5, 12);
        expect(spread.energy(new THREE.Vector4(0, 0, 0, 0))).toBe(0);
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
            reactions.onTwist({ piece: pieceOf('T', 8, 22) });
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
            const {
                director, rung, blown, sim,
            } = createDirector();
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            // Besides the rings the reactions queue, a back-to-back's stone leaves one where it
            // touches the lake, with a glint: those are the director's own and are counted apart.
            const touches = () => sim.thrown().filter(isGlint).length;
            const events = [
                () => reactions.onPieceLock({ piece: pieceOf('I') }),
                () => { reactions.onPieceLock({ piece: pieceOf('O') }); reactions.onLineClear(4); },
                () => reactions.onCombo(5),
                () => { reactions.onPerfectClear(); reactions.onLevelUp(); reactions.onTwist(); },
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
                    expect(rung).toHaveBeenCalledTimes(reactions.ringSerial + touches());
                    expect(blown).toHaveBeenCalledTimes(reactions.waveSerial);
                    for (let step = 0; step < 5; step++) director.apply(reactions.update(STEP), STEP);
                    expect(rung).toHaveBeenCalledTimes(reactions.ringSerial + touches());
                    expect(blown).toHaveBeenCalledTimes(reactions.waveSerial);
                }
            }
            // The stones did skip (four back-to-backs), and each touch was one ring, no more.
            expect(touches()).toBeGreaterThan(3);
            expect(touches()).toBeLessThanOrEqual(4 * 8);
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
            'keeps the strongest rings of a perfect clear on a pool of four after %i earlier locks',
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
                // The four strongest asked are the four on the water: a full pool gives up the ring
                // with the least left in it, and a ring weaker than all of them is the one let go.
                const onTheWater = ripples.rings.filter((entry) => entry.z === 0).map((entry) => entry.w)
                    .sort((a, b) => a - b);
                const strongest = asked.map((entry) => entry.strength).sort((a, b) => b - a).slice(0, 4);
                expect(onTheWater).toEqual(strongest.sort((a, b) => a - b));
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
            // (The ring of petals the drop knocks out of the meadow in its first frame is the next test's.)
            const ring = log[0].spawned - sim.thrown().slice(0, log[0].spawned)
                .filter((particle) => particle.kind === SEED).length;
            const thrown = sim.thrown().filter((particle) => particle.kind === SEED);
            expect(thrown.length).toBeGreaterThan(20);
            expect(sim.thrown().length).toBe(thrown.length + ring);
            // Shaken loose over a moment, not in one frame, and all of it early in the emitter's life.
            expect(log[0].spawned - ring).toBeLessThan(thrown.length / 2);
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
            const fewer = other.sim.thrown().filter((particle) => particle.kind === SEED);
            expect(fewer.length).toBeGreaterThan(0);
            expect(fewer.length).toBeLessThan(thrown.length);
            if (aspect === LANDSCAPE) {
                expect(mean(fewer.map((seed) => seed.x))).toBeLessThan(mean(thrown.map((seed) => seed.x)));
            }
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('knocks a ring of the piece\'s own petals out of the meadow where it came down, once (%s)', (_l, aspect) => {
            const flower = SUMMER_PIECE_FLOWERS.J;
            const drop = {
                kind: 'seeds', side: 1, column: 0.7, row: 0, strength: 0.8, duration: 0.9, flower,
            };
            const { director, sim, stage } = createDirector({ aspect });
            const log = play(director, sim, [drop], { seconds: 1.2 });
            const ring = sim.thrown().filter((particle) => particle.kind !== SEED);
            expect(ring.length).toBeGreaterThan(20);
            // All of it in the frame the piece lands: the ring is thrown once and never again.
            expect(sim.thrown().slice(0, log[0].spawned).filter((particle) => particle.kind !== SEED))
                .toHaveLength(ring.length);
            // Three in four are petals of the piece's flower, every fourth a mote of pollen among them.
            const petals = ring.filter((particle) => particle.kind === PETAL);
            const pollen = ring.filter((particle) => particle.kind === POLLEN);
            expect(petals.length + pollen.length).toBe(ring.length);
            expect(pollen.length).toBe(Math.floor(ring.length / 4));
            ring.forEach((particle, index) => {
                expect(particle.kind, `ring ${index}`).toBe(index % 4 === 3 ? POLLEN : PETAL);
            });
            const foot = stage.screen(0.7, 0);
            const under = stage.ground(foot.x, Math.min(1, foot.y + 0.03), summerGroundHeight);
            for (const particle of ring) {
                // From the spot the piece came down on, in the meadow ...
                expect(flatDistance(particle, under)).toBeLessThan(1);
                expect(summerGroundHeight(particle.x, particle.z)).toBeGreaterThan(0);
                // ... over the heads of the flowers (among them it would never be seen), and leaping up.
                expect(particle.y).toBeGreaterThanOrEqual(groundUnder(particle) + 1.3 - 1e-9);
                expect(particle.y).toBeLessThan(groundUnder(particle) + 2);
                expect(particle.vy).toBeGreaterThan(1.5);
                expect(particle.life).toBeGreaterThan(1);
                expect([particle.x, particle.y, particle.z, particle.vx, particle.vy, particle.vz]
                    .every(Number.isFinite)).toBe(true);
            }
            for (const petal of petals) {
                expect(petal.flower).toBe(flower);
                // Large enough to read as petals, and carried out a moment before they start to fall.
                expect(petal.size).toBeGreaterThanOrEqual(0.09);
                expect(petal.size).toBeLessThanOrEqual(0.15);
                expect(petal.hang).toBeGreaterThan(0.1);
                expect(petal.hang).toBeLessThan(1);
            }
            for (const mote of pollen) expect(mote.hang || 0).toBe(0);
            // A ring: out all round the spot, fastest across the view, each a step further round than the last.
            const bearings = ring.map((particle) => Math.atan2(particle.vz / 0.6, particle.vx));
            for (const quadrant of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                expect(ring.filter((particle) => particle.vx * quadrant[0] > 0 && particle.vz * quadrant[1] > 0).length)
                    .toBeGreaterThan(ring.length / 8);
            }
            expect(new Set(bearings.map((bearing) => bearing.toFixed(2))).size).toBeGreaterThan(ring.length * 0.9);
            expect(Math.max(...ring.map((particle) => Math.abs(particle.vx))))
                .toBeGreaterThan(Math.max(...ring.map((particle) => Math.abs(particle.vz))));
            for (const particle of ring) expect(Math.hypot(particle.vx, particle.vz)).toBeGreaterThan(2);
            // The same frame again, and every later frame of the same drop, throws no second ring;
            // the next hard drop in the same slot throws its own.
            const again = createDirector({ aspect });
            const count = () => again.sim.thrown().filter((particle) => particle.kind !== SEED).length;
            const landed = (serial, age = 0) => frameWith([emitter({
                ...drop, id: 2, serial, age,
            })]);
            again.director.apply(landed(5), STEP);
            expect(count()).toBe(ring.length);
            again.director.apply(landed(5), STEP);
            again.director.apply(landed(5, 0.2), STEP);
            expect(count()).toBe(ring.length);
            again.director.apply(landed(6), STEP);
            expect(count()).toBe(ring.length * 2);
            // A longer fall knocks out more, faster; a smaller pool fewer; a piece nobody named, petals of every kind.
            const ringOf = (overrides, options) => {
                const made = createDirector({ aspect, ...options });
                made.director.apply(frameWith([emitter({ ...drop, ...overrides })]), STEP);
                return made.sim.thrown().filter((particle) => particle.kind !== SEED);
            };
            const gentle = ringOf({ strength: 0.35 });
            expect(gentle.length).toBeGreaterThan(5);
            expect(gentle.length).toBeLessThan(ring.length);
            const speed = (particles) => mean(particles.map((particle) => Math.hypot(particle.vx, particle.vz)));
            expect(speed(gentle)).toBeLessThan(speed(ring));
            expect(ringOf({}, { petals: SUMMER_TIERS.Minimal.petals }).length).toBeLessThan(ring.length / 2);
            expect(ringOf({ flower: SUMMER_MIXED }).filter((particle) => particle.kind === PETAL)
                .every((petal) => petal.flower === SUMMER_MIXED)).toBe(true);
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

    describe('flowers in the sky', () => {
        /** The frames of a played log with what each one threw. */
        const byFrame = (log, thrown) => {
            let from = 0;
            return log.map((entry) => {
                const frame = { ...entry, thrown: thrown.slice(from, from + entry.spawned) };
                from += entry.spawned;
                return frame;
            });
        };
        const spotOf = (director, lines) => director.blossomSpot(emitter(flowerOf({ lines })), new THREE.Vector3());
        const SKY = [0, 1, 2, 3, 4, 5];

        it('waits its turn, climbs as a thread of pollen, and opens exactly once', () => {
            const { director, sim } = createDirector();
            const flower = flowerOf({ lines: 1, flower: 3 });
            // Held back for its turn (its age runs up from below zero): nothing at all.
            for (const age of [-1.2, -0.5, -STEP]) {
                const env = director.apply(frameWith([emitter({ ...flower, age })]), STEP);
                expect(env.fields).toEqual([]);
            }
            expect(sim.spawn).not.toHaveBeenCalled();
            const frames = byFrame(play(director, sim, [flower], { seconds: 1.38 }), sim.thrown());
            const heart = director.heart.clone();
            const opening = frames.findIndex((frame) => frame.thrown.some((particle) => particle.kind === PETAL));
            // A moment's climb, and then it opens: well inside its emitter's life.
            expect(frames[opening].age).toBeGreaterThan(0.25);
            expect(frames[opening].age).toBeLessThan(0.7);
            // The climb: pollen only, a couple of dozen motes over many frames, under the heart
            // and on their way up to it, the later ones higher.
            const thread = frames.slice(0, opening).flatMap((frame) => frame.thrown);
            expect(thread.length).toBeGreaterThan(10);
            expect(thread.length).toBeLessThan(40);
            expect(frames.slice(0, opening).filter((frame) => frame.spawned > 0).length).toBeGreaterThan(8);
            for (const mote of thread) {
                expect(mote.kind).toBe(POLLEN);
                expect(Math.hypot(mote.x - heart.x, mote.z - heart.z)).toBeLessThan(0.3);
                expect(mote.y).toBeLessThanOrEqual(heart.y + 1e-9);
                expect(mote.y).toBeGreaterThan(heart.y - 4.5);
                expect(mote.vy).toBeGreaterThan(1);
                expect(mote.life).toBeLessThan(1.5);
            }
            expect(thread.at(-1).y).toBeGreaterThan(thread[0].y + 1.5);
            expect(thread.at(-1).y).toBeGreaterThan(heart.y - 0.5);
            // The opening: every petal from the one heart, one light in it, and a ring of pollen off it.
            const burst = frames[opening].thrown;
            expect(burst.filter((particle) => particle.kind === PETAL).length).toBeGreaterThan(150);
            expect(burst.filter((particle) => particle.kind === GLOW)).toHaveLength(1);
            expect(burst.filter((particle) => particle.kind === POLLEN).length).toBeGreaterThan(8);
            expect(burst.filter((particle) => particle.kind === SEED)).toEqual([]);
            for (const particle of burst) expect([particle.x, particle.y, particle.z]).toEqual(heart.toArray());
            const [light] = burst.filter((particle) => particle.kind === GLOW);
            expect([light.vx, light.vy, light.vz]).toEqual([0, 0, 0]);
            // The light is about the size of the flower, and gone while the petals still hang.
            expect(light.size).toBeGreaterThan(0.8);
            expect(light.size).toBeLessThan(2.5);
            expect(light.life).toBeGreaterThan(0.5);
            expect(light.life).toBeLessThan(3);
            // Nothing more for the rest of its life, nor when the same frame is applied again.
            expect(sum(frames.slice(opening + 1).map((frame) => frame.spawned))).toBe(0);
            const thrown = sim.spawn.mock.calls.length;
            director.apply(frameWith([emitter({ ...flower, age: 1.2 })]), STEP);
            director.apply(frameWith([emitter({ ...flower, age: 1.2 })]), 0);
            expect(sim.spawn.mock.calls.length).toBe(thrown);
            // A flower needs no field: the air alone stops its petals where they belong.
            expect(frames.every((frame) => frame.fields.length === 0)).toBe(true);
            // One first seen when its climb is already over opens all the same, once.
            const late = createDirector();
            late.director.apply(frameWith([emitter({ ...flower, age: 1 })]), STEP);
            late.director.apply(frameWith([emitter({ ...flower, age: 1 + STEP })]), STEP);
            expect(late.sim.thrown().filter((particle) => particle.kind === GLOW)).toHaveLength(1);
            expect(late.sim.thrown().filter((particle) => particle.kind === PETAL).length)
                .toBe(burst.filter((particle) => particle.kind === PETAL).length);
        });

        // Every throw the director makes is a real place in the air, where it can be seen (the
        // storm over the real meadow further down holds all of them to that): so is the thread.
        it.each([
            ['the board', null], ['the board and its score panel', SCORE_PANEL],
        ])('starts the thread of every flower in the air over the meadow, beside %s', (_label, hud) => {
            const under = {};
            for (const lines of [...SKY, SUMMER_BLOSSOM_MAYPOLE]) {
                const { director, sim, stage } = createDirector();
                if (hud) stage.setHud(hud);
                play(director, sim, [flowerOf({ lines })], { seconds: 0.4 });
                const thread = sim.thrown();
                expect(thread.length).toBeGreaterThan(10);
                expect(thread.every((mote) => mote.kind === POLLEN)).toBe(true);
                const clear = thread.map((mote) => mote.y - groundUnder(mote));
                const buried = clear.filter((height) => !(height > 0.1));
                if (buried.length) {
                    under[`flower ${lines}`] = `${buried.length} of ${thread.length} motes thrown at or under the `
                        + `ground, the lowest ${(-Math.min(...clear)).toFixed(2)} m below it`;
                }
            }
            expect(under).toEqual({});
        });

        it.each([0, 1, 2, 3, 4, 5, 6, SUMMER_MIXED])(
            'draws a flower of kind %i in the air facing the camera: five to eight great petals of small ones',
            (kind) => {
                const { director, sim, stage } = createDirector();
                const seed = 0.37;
                play(director, sim, [flowerOf({ flower: kind, seed })], { seconds: 1 });
                const petals = sim.thrown().filter((particle) => particle.kind === PETAL);
                expect(petals.length).toBeGreaterThan(150);
                const turned = petals.map((petal) => {
                    const velocity = new THREE.Vector3(petal.vx, petal.vy, petal.vz);
                    return {
                        ...petal,
                        speed: velocity.length(),
                        // Round the heart in the plane the camera looks at, and out of that plane.
                        angle: Math.atan2(velocity.dot(stage.up), velocity.dot(stage.right)),
                        depth: velocity.dot(stage.forward),
                    };
                });
                for (const petal of turned) {
                    // Flung outward in the picture's own plane, hardly toward the eye or away.
                    expect(petal.speed).toBeGreaterThan(0.3);
                    expect(petal.speed).toBeLessThan(4);
                    expect(Math.abs(petal.depth)).toBeLessThan(0.3);
                    // Held where the air stops it, long enough to be seen as the flower it is, and
                    // lit a little while it is; then it has seconds left to fall.
                    expect(petal.hang).toBeGreaterThan(1);
                    expect(petal.hang).toBeLessThan(3);
                    expect(petal.life).toBeGreaterThan(petal.hang + 1);
                    expect(petal.shine).toBeGreaterThan(0);
                    expect(petal.shine).toBeLessThanOrEqual(1);
                    expect(petal.size).toBeGreaterThan(0.05);
                    expect(petal.size).toBeLessThan(0.4);
                }
                // Great petals stand evenly round the heart, with open air between them: exactly
                // one count from five to eight fits where the small petals were thrown.
                const offAxis = (angle, lobes) => {
                    const spacing = (Math.PI * 2) / lobes;
                    const turn = (((angle - seed * Math.PI * 2) % spacing) + spacing) % spacing;
                    return Math.min(turn, spacing - turn);
                };
                const fitting = [5, 6, 7, 8].filter((lobes) => turned
                    .every((petal) => offAxis(petal.angle, lobes) < (0.82 * Math.PI) / lobes));
                expect(fitting).toHaveLength(1);
                const [lobes] = fitting;
                // Thin at the heart and at the tip, widest between: the slow petals near the heart
                // and the fastest at the tips keep closer to their great petal's axis than those between.
                const spread = (from, to) => Math.max(...turned
                    .filter((petal) => petal.speed >= from && petal.speed < to)
                    .map((petal) => offAxis(petal.angle, lobes)));
                const fastest = Math.max(...turned.map((petal) => petal.speed));
                expect(spread(fastest * 0.4, fastest * 0.7)).toBeGreaterThan(spread(fastest * 0.93, Infinity));
                if (kind === SUMMER_MIXED) {
                    // Every colour at once, a colour to each great petal.
                    expect(new Set(petals.map((petal) => petal.flower)).size).toBe(SUMMER_BOUQUET_KINDS);
                    const colours = new Map();
                    for (const petal of turned) {
                        const lobe = Math.round((((petal.angle - seed * Math.PI * 2) / (Math.PI * 2)) * lobes)) % lobes;
                        const key = (lobe + lobes) % lobes;
                        if (!colours.has(key)) colours.set(key, new Set());
                        colours.get(key).add(petal.flower);
                    }
                    expect(colours.size).toBe(lobes);
                    for (const kinds of colours.values()) expect(kinds.size).toBe(1);
                } else for (const petal of petals) expect(petal.flower).toBe(kind);
            },
        );

        it('gives the seven kinds flowers of different make, and a weaker flower fewer and shorter petals', () => {
            const fastestOf = (petals) => Math.max(...petals.map((petal) => Math.hypot(petal.vx, petal.vy, petal.vz)));
            const made = (overrides) => {
                const { director, sim } = createDirector();
                play(director, sim, [flowerOf(overrides)], { seconds: 0.8 });
                const petals = sim.thrown().filter((particle) => particle.kind === PETAL);
                return { count: petals.length, fastest: fastestOf(petals) };
            };
            const full = made({ strength: 1 });
            const weak = made({ strength: 0.5 });
            expect(weak.count).toBeLessThan(full.count * 0.7);
            expect(weak.count).toBeGreaterThan(full.count * 0.3);
            expect(weak.fastest).toBeLessThan(full.fastest);
            // No strength at all is still a flower: the director never opens nothing.
            expect(made({ strength: 0 }).count).toBeGreaterThan(10);
            // The pool scales the petals, not the flower.
            const { director, sim } = createDirector({ petals: SUMMER_TIERS.Minimal.petals });
            play(director, sim, [flowerOf()], { seconds: 0.8 });
            const few = sim.thrown().filter((particle) => particle.kind === PETAL);
            expect(few.length).toBeGreaterThan(20);
            expect(few.length).toBeLessThan(full.count / 2);
            expect(fastestOf(few)).toBeCloseTo(full.fastest, 0);
        });

        it('lets the air stop the petals where the flower is drawn, holds it there, and then lets it fall', () => {
            const flower = bloom({ lines: 1, seconds: 1.5 });
            const { sim, heart, petals } = flower;
            expect(flower.fit).toBe(1);
            expect(petals.length).toBeGreaterThan(150);
            // A flower a couple of metres across, round its heart, in the plane facing the camera.
            expect(flower.reach).toBeGreaterThan(0.9);
            expect(flower.reach).toBeLessThan(1.7);
            const depth = petals.map((petal) => Math.abs(petal.at.clone().sub(heart).dot(flower.stage.forward)));
            expect(Math.max(...depth)).toBeLessThan(0.4);
            const centre = petals.reduce((total, petal) => total.add(petal.at), new THREE.Vector3())
                .divideScalar(petals.length);
            expect(centre.distanceTo(heart)).toBeLessThan(0.25);
            // It hangs: a fifth of a second on, no petal has moved more than a hand's breadth.
            const where = (petal) => new THREE.Vector3(sim.x[petal.index], sim.y[petal.index], sim.z[petal.index]);
            const env = { ...flower.director.env, fields: [] };
            for (let step = 0; step < 12; step++) sim.step(STEP, env);
            for (const petal of petals) expect(where(petal).distanceTo(petal.at)).toBeLessThan(0.12);
            // Then the petals let go and come down, and in the end the air is clear again.
            const height = () => mean(petals.filter((petal) => sim.life[petal.index] > 0)
                .map((petal) => where(petal).y));
            const held = height();
            for (let step = 0; step < 60 * 2; step++) sim.step(STEP, env);
            expect(height()).toBeLessThan(held - 0.4);
            for (let step = 0; step < 60 * 5; step++) sim.step(STEP, env);
            expect(sim.counts().live).toBe(0);
            // A weaker flower is a smaller one.
            expect(bloom({ lines: 1, strength: 0.4 }).reach).toBeLessThan(flower.reach * 0.92);
        });

        it('opens the six flowers of a perfect clear in the open air beside the board, left and right in turn', () => {
            const { director, stage, camera } = createDirector();
            const { board } = stage;
            const hearts = SKY.map((lines) => spotOf(director, lines));
            hearts.forEach((heart, index) => {
                const seen = onScreen(heart, camera);
                // Never behind the card: in the strip left of it, then the strip right of it, in turn.
                if (index % 2 === 0) expect(seen.x, `flower ${index}`).toBeLessThan(board.x0);
                else expect(seen.x, `flower ${index}`).toBeGreaterThan(board.x1);
                // On the screen, in the sky and the air over the lake, not down in the meadow.
                expect(seen.x).toBeGreaterThan(0.02);
                expect(seen.x).toBeLessThan(0.98);
                expect(seen.y).toBeGreaterThan(0.1);
                expect(seen.y).toBeLessThan(0.6);
                // Nearer than the trees that frame the picture, about as far as the board's own plane.
                const depth = heart.clone().sub(stage.origin).dot(stage.forward);
                expect(depth).toBeGreaterThanOrEqual(7);
                expect(depth).toBeLessThanOrEqual(8.5);
                expect(heart.y).toBeGreaterThan(groundUnder(heart) + 2.5);
                expect(director.blossomFit, `flower ${index}`).toBe(1);
            });
            // Six places, no two of them the same patch of sky.
            hearts.forEach((heart, index) => hearts.slice(index + 1).forEach((other) => {
                expect(heart.distanceTo(other)).toBeGreaterThan(1.2);
            }));
            // A place past the sixth comes round to the first; one that is no place is the first.
            expectVector(spotOf(director, 6), hearts[0], 12);
            expectVector(spotOf(director, 9), hearts[3], 12);
            expectVector(spotOf(director, -3), hearts[0], 12);
            expectVector(spotOf(director, 2.2), hearts[2], 12);
            // It writes into the vector it is given.
            const target = new THREE.Vector3(9, 9, 9);
            expect(director.blossomSpot(emitter(flowerOf({ lines: 4 })), target)).toBe(target);
            expectVector(target, hearts[4], 12);
            // The card moves: the flowers move with it and stay clear of it.
            stage.setBoard({
                x0: 0.52, x1: 0.74, y0: 0.1, y1: 0.9,
            });
            SKY.forEach((lines) => {
                const seen = onScreen(spotOf(director, lines), camera);
                expect(seen.x < 0.52 || seen.x > 0.74, `flower ${lines}`).toBe(true);
                expect(seen.x > 0.52).toBe(lines % 2 === 1);
            });
        });

        // The flower as it hangs fully opened, a good second after it burst (its petals are thrown
        // so that the air stops them at their places, and are all still held there).
        it.each(SKY)('keeps the petals of sky flower %i out from behind the board card', (lines) => {
            const flower = bloom({ lines, seconds: 1.6 });
            const seen = flower.petals.map((petal) => onScreen(petal.at, flower.camera));
            const hidden = seen.filter((place) => within(place, flower.stage.board));
            // The whole flower is drawn beside the card, not only its heart: all but a stray petal.
            expect(hidden.length, `${hidden.length} of ${seen.length} petals behind the card`)
                .toBeLessThanOrEqual(seen.length * 0.01);
            // And most of it is on the screen.
            const off = seen.filter((place) => place.x < 0 || place.x > 1 || place.y < 0 || place.y > 1);
            expect(off.length).toBeLessThan(flower.petals.length * 0.1);
        });

        it('keeps every flower clear of the score panel when one stands beside the board', () => {
            const { director, stage, camera } = createDirector();
            const plain = SKY.map((lines) => onScreen(spotOf(director, lines), camera));
            stage.setHud(SCORE_PANEL);
            const covered = stage.covered();
            expect(covered).toEqual({ x0: stage.board.x0, x1: SCORE_PANEL.x1 });
            const room = 1 - covered.x1;
            const seen = SKY.map((lines) => onScreen(spotOf(director, lines), camera));
            seen.forEach((place, index) => {
                // Outside everything that covers the middle, the panel included, on its own side.
                if (index % 2 === 0) expect(place.x, `flower ${index}`).toBeLessThan(covered.x0);
                else expect(place.x, `flower ${index}`).toBeGreaterThan(covered.x1);
                expect(place.x).toBeGreaterThan(0);
                expect(place.x).toBeLessThan(1);
                expect(within(place, SCORE_PANEL), `flower ${index}`).toBe(false);
                expect(within(place, stage.board), `flower ${index}`).toBe(false);
            });
            // The open side keeps its two columns exactly as without the panel.
            for (const index of [0, 2, 4]) {
                expect(seen[index].x).toBeCloseTo(plain[index].x, 9);
                expect(seen[index].y).toBeCloseTo(plain[index].y, 9);
            }
            // The panel's side is a narrow strip: its three stand one above another down the
            // middle of it, at the heights the director keeps for a stack.
            const STACK = [0.2, 0.46, 0.7];
            [1, 3, 5].forEach((index, level) => {
                expect(seen[index].x, `flower ${index}`).toBeCloseTo(covered.x1 + room / 2, 9);
                expect(seen[index].y, `flower ${index}`).toBeCloseTo(STACK[level], 9);
            });
            // The panel on the other side of the board: the stack is on that side instead.
            stage.setHud({
                x0: 1 - SCORE_PANEL.x1, x1: 1 - SCORE_PANEL.x0, y0: SCORE_PANEL.y0, y1: SCORE_PANEL.y1,
            });
            const mirrored = SKY.map((lines) => onScreen(spotOf(director, lines), camera));
            [0, 2, 4].forEach((index, level) => {
                expect(mirrored[index].x).toBeCloseTo(stage.covered().x0 / 2, 9);
                expect(mirrored[index].y).toBeCloseTo(STACK[level], 9);
            });
            for (const index of [1, 3, 5]) expect(mirrored[index].x).toBeGreaterThan(stage.board.x1);
            // The panel gone: the flowers are back where they were.
            stage.setHud(null);
            SKY.forEach((lines) => {
                const place = onScreen(spotOf(director, lines), camera);
                expect(place.x).toBeCloseTo(plain[lines].x, 9);
                expect(place.y).toBeCloseTo(plain[lines].y, 9);
            });
        });

        it.each([1, 3, 5])('draws stacked flower %i to fit the strip beside the score panel, petals and all', (
            lines,
        ) => {
            const flower = bloom({ lines, hud: SCORE_PANEL, seconds: 1.6 });
            const covered = flower.stage.covered();
            const seen = flower.petals.map((petal) => onScreen(petal.at, flower.camera));
            // Not a petal behind the panel or the card, and all but the rim inside the strip.
            expect(seen.filter((place) => within(place, SCORE_PANEL))).toEqual([]);
            expect(seen.filter((place) => within(place, flower.stage.board))).toEqual([]);
            const outside = seen.filter((place) => place.x < covered.x1 || place.x > 1);
            expect(outside.length).toBeLessThanOrEqual(flower.petals.length * 0.03);
            expect(flower.fit).toBeLessThanOrEqual(1);
            expect(flower.fit).toBeGreaterThan(0.8);
        });

        it('scales a flower down to fit a narrow strip, never up, and never to nothing', () => {
            const { director, stage } = createDirector();
            const fitOf = (lines) => {
                spotOf(director, lines);
                return director.blossomFit;
            };
            // Wide strips on both sides: every flower at its full size.
            expect(director.blossomFit).toBe(1);
            for (const lines of SKY) expect(fitOf(lines)).toBe(1);
            // The narrower the strip on a flower's side, the smaller it is drawn; the other side keeps its size.
            const fits = [0.29, 0.25, 0.2, 0.16, 0.141].map((room) => {
                stage.setHud({
                    x0: 0.62, x1: 1 - room, y0: 0.2, y1: 0.5,
                });
                expect(1 - stage.covered().x1).toBeCloseTo(room, 12);
                for (const lines of [0, 2, 4]) expect(fitOf(lines), `left, room ${room}`).toBe(1);
                const side = [1, 3, 5].map(fitOf);
                for (const fit of side) {
                    expect(fit, `room ${room}`).toBeGreaterThan(0);
                    expect(fit, `room ${room}`).toBeLessThanOrEqual(1);
                }
                return side;
            });
            for (let index = 1; index < fits.length; index++) {
                fits[index].forEach((fit, flower) => {
                    const wider = fits[index - 1][flower];
                    // Whole while it fits; smaller with every bit of room it loses after that.
                    if (wider < 1) expect(fit).toBeLessThan(wider);
                    else expect(fit).toBeLessThanOrEqual(1);
                });
            }
            expect(Math.max(...fits[0])).toBe(1);
            expect(Math.max(...fits.at(-1))).toBeLessThan(0.75);
            // In proportion: half the room, half the flower (once it no longer fits whole).
            stage.setHud({
                x0: 0.62, x1: 0.8, y0: 0.2, y1: 0.5,
            });
            const wide = fitOf(1);
            stage.setHud({
                x0: 0.62, x1: 0.85, y0: 0.2, y1: 0.5,
            });
            expect(fitOf(1) / wide).toBeCloseTo(0.75, 9);
            // The next flower on the open side is whole again: the fit is each flower's own.
            expect(fitOf(0)).toBe(1);
            // It is the flower that shrinks, not the count of its petals.
            const whole = bloom({ lines: 1 });
            const fitted = bloom({
                lines: 1,
                hud: {
                    x0: 0.62, x1: 0.84, y0: 0.2, y1: 0.5,
                },
            });
            expect(fitted.fit).toBeLessThan(0.75);
            expect(fitted.petals.length).toBe(whole.petals.length);
            expect(fitted.reach / whole.reach).toBeGreaterThan(fitted.fit * 0.85);
            expect(fitted.reach / whole.reach).toBeLessThan(fitted.fit * 1.15);
        });

        it('stands the flowers in two columns, in a stack or in a row above the board by the room beside it', () => {
            const { director, stage, camera } = createDirector();
            const layout = (room) => {
                stage.setBoard({
                    x0: room, x1: 1 - room, y0: 0.16, y1: 0.9,
                });
                return SKY.map((lines) => {
                    const place = onScreen(spotOf(director, lines), camera);
                    return { ...place, fit: director.blossomFit };
                });
            };
            // Room enough: two columns a side, each flower at its own height.
            for (const room of [0.301, 0.36, 0.45]) {
                const seen = layout(room);
                expect(new Set(seen.map((place) => place.x.toFixed(4))).size, `room ${room}`).toBe(6);
                seen.forEach((place, index) => {
                    const beside = index % 2 === 0 ? place.x < room : place.x > 1 - room;
                    expect(beside, `room ${room}, flower ${index}`).toBe(true);
                });
            }
            // A narrow strip: one column a side, down its middle, three heights.
            for (const room of [0.141, 0.2, 0.299]) {
                const seen = layout(room);
                for (const index of [0, 2, 4]) expect(seen[index].x, `room ${room}`).toBeCloseTo(room / 2, 9);
                for (const index of [1, 3, 5]) expect(seen[index].x, `room ${room}`).toBeCloseTo(1 - room / 2, 9);
                expect(seen[0].y).toBeLessThan(seen[2].y - 0.15);
                expect(seen[2].y).toBeLessThan(seen[4].y - 0.15);
                [0, 2, 4].forEach((index) => expect(seen[index + 1].y).toBeCloseTo(seen[index].y, 9));
                for (const place of seen) {
                    expect(place.y).toBeGreaterThan(0.1);
                    expect(place.y).toBeLessThan(0.8);
                }
            }
            // No room at all: a row above the board, left to right, small enough to stand side by side.
            for (const room of [0, 0.05, 0.139]) {
                const seen = layout(room);
                seen.forEach((place, index) => {
                    expect(place.x, `room ${room}`).toBeCloseTo((index + 0.5) / 6, 9);
                    expect(place.y, `room ${room}`).toBeLessThan(0.16);
                    expect(place.y).toBeGreaterThan(0.03);
                    expect(place.y).toBeCloseTo(seen[0].y, 9);
                    expect(place.fit).toBeLessThanOrEqual(1);
                });
            }
            // A board hard against the top of the screen still leaves the row on the screen.
            stage.setBoard({
                x0: 0.02, x1: 0.98, y0: 0, y1: 0.9,
            });
            for (const lines of SKY) expect(onScreen(spotOf(director, lines), camera).y).toBeGreaterThan(0.03);
        });

        it('opens them in a row above the board on an upright screen, each fitted to its sixth of the width', () => {
            const phone = {
                x0: 0.05, x1: 0.95, y0: 0.16, y1: 0.9,
            };
            const seen = [];
            for (const lines of SKY) {
                const flower = bloom({
                    aspect: PORTRAIT, board: phone, lines, seconds: 1.6,
                });
                const heart = onScreen(flower.heart, flower.camera);
                expect(heart.y).toBeLessThan(phone.y0);
                expect(heart.x).toBeCloseTo((lines + 0.5) / 6, 6);
                expect(flower.fit).toBeLessThan(0.6);
                expect(flower.fit).toBeGreaterThan(0.05);
                const places = flower.petals.map((petal) => onScreen(petal.at, flower.camera));
                // Above the card, on the screen, and inside its own sixth of the width but for the rim.
                expect(places.filter((place) => within(place, phone))).toEqual([]);
                expect(places.filter((place) => place.y < 0 || place.x < 0 || place.x > 1).length)
                    .toBeLessThanOrEqual(flower.petals.length * 0.03);
                const strayed = places.filter((place) => Math.abs(place.x - heart.x) > 1 / 12 + 0.01);
                expect(strayed.length).toBeLessThanOrEqual(flower.petals.length * 0.03);
                seen.push(heart.x);
            }
            expect(seen).toEqual([...seen].sort((a, b) => a - b));
        });

        it('opens the bouquet\'s own flower on the line of sight to the maypole\'s head, nearer than the pole', () => {
            const CROWN_DEPTH = 8.2;
            const maypole = maypoleAnchors();
            const phone = {
                x0: 0.05, x1: 0.95, y0: 0.16, y1: 0.9,
            };
            for (const [aspect, hud, board] of [[LANDSCAPE, null, null], [LANDSCAPE, SCORE_PANEL, null],
                [21 / 9, null, null], [PORTRAIT, null, phone]]) {
                const { director, stage, camera } = createDirector({ aspect, maypole });
                if (hud) stage.setHud(hud);
                if (board) stage.setBoard(board);
                // A narrow strip's flower first, so a fit is left over to be cleared.
                spotOf(director, 1);
                const heart = spotOf(director, SUMMER_BLOSSOM_MAYPOLE);
                const toTop = maypole.top.clone().sub(stage.origin);
                const toHeart = heart.clone().sub(stage.origin);
                // As near as the flowers beside the board ...
                expect(toHeart.length()).toBeCloseTo(CROWN_DEPTH, 9);
                expect(toHeart.length()).toBeLessThan(toTop.length());
                // ... and straight between the eye and the pole's head: seen crowning the pole.
                expect(toHeart.clone().normalize().dot(toTop.clone().normalize())).toBeCloseTo(1, 12);
                const [crown, head] = [onScreen(heart, camera), onScreen(maypole.top, camera)];
                expect(crown.x).toBeCloseTo(head.x, 9);
                expect(crown.y).toBeCloseTo(head.y, 9);
                // Always at its full size, whatever stands beside the board.
                expect(director.blossomFit).toBe(1);
            }
            // The crowning flower is the largest and fullest of them, at the same strength.
            const count = (overrides, options) => {
                const { director, sim } = createDirector({ maypole, ...options });
                play(director, sim, [flowerOf(overrides)], { seconds: 0.8 });
                const petals = sim.thrown().filter((particle) => particle.kind === PETAL);
                return {
                    petals,
                    fastest: Math.max(...petals.map((petal) => Math.hypot(petal.vx, petal.vy, petal.vz))),
                    light: sim.thrown().find((particle) => particle.kind === GLOW),
                };
            };
            const sky = count({ lines: 0, flower: SUMMER_MIXED });
            const crowning = count({ lines: SUMMER_BLOSSOM_MAYPOLE, flower: SUMMER_MIXED });
            expect(crowning.petals.length / sky.petals.length).toBeGreaterThan(1.15);
            expect(crowning.petals.length / sky.petals.length).toBeLessThan(1.4);
            expect(crowning.fastest / sky.fastest).toBeGreaterThan(1.05);
            expect(crowning.fastest / sky.fastest).toBeLessThan(1.3);
            expect(crowning.light.size).toBeGreaterThan(sky.light.size);
            expect(new Set(crowning.petals.map((petal) => petal.flower)).size).toBe(SUMMER_BOUQUET_KINDS);
            // The bouquet's (a little under full strength) is a little less than a perfect clear's.
            const bouquet = count({ lines: SUMMER_BLOSSOM_MAYPOLE, flower: SUMMER_MIXED, strength: 0.8 });
            expect(bouquet.petals.length).toBeLessThan(crowning.petals.length);
            expect(bouquet.petals.length).toBeGreaterThan(sky.petals.length * 0.8);
            // A world without a maypole opens it beside the board instead, and does not fail.
            const bare = createDirector({ maypole: null });
            expectVector(spotOf(bare.director, SUMMER_BLOSSOM_MAYPOLE), spotOf(bare.director, 0), 12);
            expect(() => play(bare.director, bare.sim, [flowerOf({ lines: SUMMER_BLOSSOM_MAYPOLE })], { seconds: 1 }))
                .not.toThrow();
            expect(bare.sim.thrown().filter((particle) => particle.kind === GLOW)).toHaveLength(1);
        });

        it.each([
            ['High', LANDSCAPE], ['Medium', LANDSCAPE], ['Minimal', LANDSCAPE], ['High', PORTRAIT],
        ])('plays the flowers of a perfect clear at %s one after another, each once (aspect %f)', (tier, aspect) => {
            const maypole = maypoleAnchors();
            const {
                director, sim, stage, camera,
            } = createDirector({
                aspect, maypole, petals: SUMMER_TIERS[tier].petals, groundHeight: PLAIN,
            });
            const reactions = new SummerReactions({ quality: tier, rng: seededRandom(1) });
            reactions.onPerfectClear();
            const asked = reactions.frame.emitters.filter((entry) => entry.kind === 'blossom')
                .sort((a, b) => a.serial - b.serial);
            const beat = asked.length > 1 ? -asked[1].age : 0;
            const opened = [];
            for (let step = 0; step < 60 * 4; step++) {
                const before = sim.spawn.mock.calls.length;
                director.apply(reactions.update(STEP), STEP);
                const fresh = sim.thrown().slice(before);
                const hearts = fresh.filter((particle) => particle.kind === GLOW);
                // Never two flowers in one frame: they open in turn.
                expect(hearts.length).toBeLessThanOrEqual(1);
                if (hearts.length) {
                    opened.push({
                        at: reactions.time,
                        heart: hearts[0],
                        // (The rising meadow and the bouquet throw petals too: a flower's are the ones that hang.)
                        petals: fresh.filter((particle) => particle.kind === PETAL && particle.hang > 1),
                    });
                }
            }
            // As many as the tier's pool carries, every one of them, once.
            expect(opened).toHaveLength(Math.max(1, Math.min(6, SUMMER_REACTION_LIMITS[tier] - 4)) + 1);
            expect(opened).toHaveLength(asked.length);
            opened.forEach((flower, index) => {
                expect(flower.petals.length).toBeGreaterThan(20);
                // A beat apart, in the order they were asked for.
                if (index > 0) expect(flower.at - opened[index - 1].at).toBeCloseTo(beat, 1);
                const seen = onScreen(flower.heart, camera);
                const kinds = new Set(flower.petals.map((petal) => petal.flower));
                if (index === opened.length - 1) {
                    // The last crowns the maypole, in every colour.
                    const head = onScreen(maypole.top, camera);
                    expect(seen.x).toBeCloseTo(head.x, 6);
                    expect(seen.y).toBeCloseTo(head.y, 6);
                    expect(kinds.size).toBe(SUMMER_BOUQUET_KINDS);
                } else {
                    // The others stand clear of the card, each of a kind of its own.
                    expect(within(seen, stage.board), `flower ${index}`).toBe(false);
                    expect(kinds.size).toBe(1);
                    expect([...kinds][0]).toBe(asked[index].flower);
                }
            });
            const sky = opened.slice(0, -1).map((flower) => flower.petals[0].flower);
            expect(new Set(sky).size).toBe(sky.length);
            // The hearts are lights, lit where the flowers are, one each.
            expect(sim.thrown().filter((particle) => particle.kind === GLOW)).toHaveLength(opened.length);
        });
    });

    describe('a stone down the sun\'s road', () => {
        const stone = (overrides = {}) => ({
            kind: 'skip', lines: 4, strength: 0.55, duration: 1.3, ...overrides,
        });
        /** Throw one stone over a lake and report every touch. */
        const skip = (overrides = {}, {
            groundHeight = OPEN_WATER, dt = STEP, sun, ...options
        } = {}) => {
            const made = createDirector({ groundHeight, ...options });
            const spec = stone(overrides);
            const touches = [];
            const steps = Math.round((spec.duration + 0.1) / dt);
            for (let step = 0; step <= steps; step++) {
                const age = step * dt;
                const before = made.rung.mock.calls.length;
                const live = age < spec.duration ? [emitter({ ...spec, age })] : [];
                made.director.apply(frameWith(live), dt, undefined, null, sun);
                for (const [x, z, strength] of made.rung.mock.calls.slice(before)) {
                    touches.push({
                        x, z, strength, age, out: flatDistance({ x, z }, made.stage.origin),
                    });
                }
            }
            return { ...made, touches, thrown: made.sim.thrown() };
        };

        it.each([4, 5, 6, 7, 8])('skips %i times on open water, each touch further out, fainter and sooner', (hops) => {
            const {
                touches, thrown, director, stage,
            } = skip({ lines: hops, strength: 0.7 });
            expect(touches).toHaveLength(hops);
            const flat = Math.hypot(director.sun.x, director.sun.z);
            touches.forEach((touch, index) => {
                // Down one road from the eye: the sun's bearing.
                expect((touch.x - stage.origin.x) / touch.out).toBeCloseTo(director.sun.x / flat, 9);
                expect((touch.z - stage.origin.z) / touch.out).toBeCloseTo(director.sun.z / flat, 9);
                expect(touch.strength).toBeGreaterThan(0.3);
                if (index === 0) return;
                const previous = touches[index - 1];
                expect(touch.out).toBeGreaterThan(previous.out + 0.5);
                expect(touch.strength).toBeLessThan(previous.strength);
                expect(touch.age).toBeGreaterThan(previous.age);
                if (index > 1) {
                    // The stone loses way: shorter hops, and (to the frame) quicker ones.
                    const before = touches[index - 2];
                    expect(touch.out - previous.out).toBeLessThan(previous.out - before.out);
                    expect(touch.age - previous.age).toBeLessThanOrEqual(previous.age - before.age + STEP + 1e-9);
                }
            });
            // The first touch is at once, out on the water past the meadow; the last before the stone is spent.
            expect(touches[0].age).toBe(0);
            expect(touches[0].out).toBeGreaterThan(30);
            expect(touches.at(-1).age).toBeLessThan(1.3);
            expect(touches.at(-1).age).toBeGreaterThan(0.8);
            expect(touches.at(-1).out).toBeLessThan(120);
            // Every touch is lit by one glint on the water where it rang, smaller each time, soon gone.
            const glints = thrown.filter(isGlint);
            expect(glints).toHaveLength(hops);
            glints.forEach((glint, index) => {
                expect([glint.x, glint.z]).toEqual([touches[index].x, touches[index].z]);
                expect(glint.y).toBeGreaterThan(0);
                expect([glint.vx, glint.vy, glint.vz]).toEqual([0, 0, 0]);
                expect(glint.life).toBeGreaterThan(0.3);
                expect(glint.life).toBeLessThan(2);
                expect(glint.size).toBeGreaterThan(1);
                if (index > 0) expect(glint.size).toBeLessThan(glints[index - 1].size);
            });
            // And a few drops jump from it, on down the road.
            const drops = thrown.filter((particle) => particle.kind === POLLEN);
            expect(thrown).toHaveLength(glints.length + drops.length);
            const at = (touch) => drops.filter((drop) => drop.x === touch.x && drop.z === touch.z);
            expect(sum(touches.map((touch) => at(touch).length))).toBe(drops.length);
            for (const touch of touches) {
                expect(at(touch).length).toBeGreaterThan(3);
                expect(at(touch).length).toBeLessThan(20);
            }
            expect(at(touches[0]).length).toBeGreaterThanOrEqual(at(touches.at(-1)).length);
            for (const drop of drops) {
                expect(drop.y).toBeGreaterThan(0.02);
                expect(drop.y).toBeLessThan(0.5);
                expect(drop.vy).toBeGreaterThan(1);
                expect(drop.life).toBeLessThan(1.5);
            }
            expect(mean(drops.map((drop) => drop.vx * director.sun.x + drop.vz * director.sun.z))).toBeGreaterThan(0);
        });

        it('rings the water once for each touch, however often a frame is applied, and again for a new stone', () => {
            const { director, rung, sim } = createDirector({ groundHeight: OPEN_WATER });
            const frame = (age, serial = 3) => frameWith([emitter(stone({
                id: 2, serial, age, lines: 5,
            }))]);
            // Held back: nothing yet.
            director.apply(frame(-0.3), STEP);
            expect(rung).not.toHaveBeenCalled();
            expect(sim.spawn).not.toHaveBeenCalled();
            director.apply(frame(0), STEP);
            expect(rung).toHaveBeenCalledOnce();
            for (let again = 0; again < 5; again++) director.apply(frame(0), STEP);
            director.apply(frame(0), 0);
            expect(rung).toHaveBeenCalledOnce();
            // Seen late, it catches up with every touch it owes, in order, and no more after.
            director.apply(frame(1.29), STEP);
            expect(rung).toHaveBeenCalledTimes(5);
            const outs = rung.mock.calls.map(([x, z]) => flatDistance({ x, z }, director.stage.origin));
            expect(outs).toEqual([...outs].sort((a, b) => a - b));
            director.apply(frame(1.29), STEP);
            director.apply(frame(0.5), STEP);
            expect(rung).toHaveBeenCalledTimes(5);
            // The next stone in the same slot skips from the first touch again.
            director.apply(frame(0, 4), STEP);
            expect(rung).toHaveBeenCalledTimes(6);
            expect(rung.mock.calls[5].slice(0, 2)).toEqual(rung.mock.calls[0].slice(0, 2));
            // A session reset forgets what was played, as for every other emitter.
            director.apply({ ...frame(0, 4), epoch: 2 }, STEP);
            expect(rung).toHaveBeenCalledTimes(7);
        });

        it('never touches land: a hop that would come down on a shore leaves nothing', () => {
            const camera = frameCamera();
            const eye = camera.position;
            // An island across the road, 50 to 64 m out, and shallows too thin to be the lake beyond 75.
            const island = (x, z) => {
                const out = Math.hypot(x - eye.x, z - eye.z);
                if (out > 50 && out < 64) return 1.2;
                return out > 75 ? -0.02 : -2;
            };
            const open = skip({ lines: 8 });
            const blocked = skip({ lines: 8 }, { groundHeight: island });
            expect(open.touches).toHaveLength(8);
            const wet = open.touches.filter((touch) => island(touch.x, touch.z) < -0.05);
            expect(wet.length).toBeGreaterThan(2);
            expect(wet.length).toBeLessThan(8);
            // Exactly the touches that find water, where and as strong as they would have been.
            expect(blocked.touches.map(({ x, z, strength }) => [x, z, strength]))
                .toEqual(wet.map(({ x, z, strength }) => [x, z, strength]));
            expect(blocked.thrown.filter(isGlint)).toHaveLength(wet.length);
            for (const particle of blocked.thrown) expect(island(particle.x, particle.z)).toBeLessThan(-0.05);
            // The stone carries on past the island: a touch beyond it is among them.
            expect(Math.max(...blocked.touches.map((touch) => touch.out))).toBeGreaterThan(64);
            // No lake at all: no ring, no glint, no drop, and no failure.
            const dry = skip({ lines: 8 }, { groundHeight: PLAIN });
            expect(dry.touches).toEqual([]);
            expect(dry.sim.spawn).not.toHaveBeenCalled();
            // No lake to ring: the glints and the drops are still thrown.
            const silent = skip({ lines: 4 }, { ripples: null });
            expect(silent.thrown.filter(isGlint)).toHaveLength(4);
        });

        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
        ])('finds water down the sun\'s road on the real lake at every hour of the night (%s)', (_label, aspect) => {
            for (let phase = 0; phase < SUMMER_HOURS.length; phase += 0.25) {
                const hour = summerHourAt(phase);
                const sun = new THREE.Vector3(...summerSunDirection(hour.sunAzimuth, hour.sunElevation));
                for (const hops of [4, 8]) {
                    const { touches, stage, camera } = skip({ lines: hops }, {
                        groundHeight: summerGroundHeight, aspect, sun,
                    });
                    // A first back-to-back's stone touches every time; the longest run may meet the skerry.
                    if (hops === 4) expect(touches, `phase ${phase}`).toHaveLength(4);
                    expect(touches.length, `phase ${phase}`).toBeGreaterThanOrEqual(4);
                    expect(touches.length).toBeLessThanOrEqual(hops);
                    for (const touch of touches) {
                        expect(summerGroundHeight(touch.x, touch.z), `phase ${phase}`).toBeLessThan(-0.05);
                        // Toward the sun: ahead of the camera and to its left, where the sun always stands.
                        expect(touch.z).toBeLessThan(stage.origin.z);
                        expect(ndc({ x: touch.x, y: 0, z: touch.z }, camera).z).toBeLessThan(1);
                    }
                    if (aspect === LANDSCAPE) for (const touch of touches) expect(touch.x).toBeLessThan(stage.origin.x);
                }
            }
        });

        it('follows the sun the world hands it, and keeps the last one for nonsense', () => {
            const east = skip({}, { sun: new THREE.Vector3(1, 0.2, 0) });
            for (const touch of east.touches) {
                expect(touch.x).toBeGreaterThan(east.stage.origin.x + 30);
                expect(touch.z).toBeCloseTo(east.stage.origin.z, 9);
            }
            // The height of the sun does not shorten the throw: only its bearing counts.
            const low = skip({}, { sun: new THREE.Vector3(0.6, 0.05, -0.8).normalize() });
            const high = skip({}, { sun: new THREE.Vector3(0.6, 0.9, -0.8).normalize() });
            expect(high.touches.map((touch) => touch.out)).toEqual(low.touches.map((touch) => touch.out)
                .map((out) => expect.closeTo(out, 9)));
            // Before any sun is given it is the evening's: ahead and to the left.
            const first = skip();
            for (const touch of first.touches) {
                expect(touch.z).toBeLessThan(first.stage.origin.z - 30);
                expect(touch.x).toBeLessThan(first.stage.origin.x);
            }
            // A sun that is no direction leaves the road where it was.
            const { director, rung } = createDirector({ groundHeight: OPEN_WATER });
            const thrown = (serial, sun) => director
                .apply(frameWith([emitter(stone({ serial }))]), STEP, undefined, null, sun);
            thrown(1, new THREE.Vector3(1, 0.2, 0));
            const [x, z] = rung.mock.calls[0];
            [null, undefined, {}, 'sun', { x: NaN, y: 0, z: 1 }, { x: 1, y: 0, z: Infinity }].forEach((junk, index) => {
                thrown(2 + index, junk);
                expect(rung.mock.calls.at(-1).slice(0, 2)).toEqual([x, z]);
            });
            expect(director.sun.toArray().every(Number.isFinite)).toBe(true);
        });

        it('gives a stone between three and eight hops whatever it is asked for, at any frame rate', () => {
            const hopsFor = (lines, options) => skip({ lines }, options).touches.length;
            expect(hopsFor(3)).toBe(3);
            expect(hopsFor(1)).toBe(3);
            expect(hopsFor(-4)).toBe(3);
            expect(hopsFor(99)).toBe(8);
            expect(hopsFor(6.4)).toBe(6);
            // No count at all is a middling throw.
            const middling = hopsFor(0);
            expect(middling).toBeGreaterThanOrEqual(3);
            expect(middling).toBeLessThanOrEqual(8);
            for (const lines of [NaN, undefined, null, 'far']) expect(hopsFor(lines), String(lines)).toBe(middling);
            // The touches are the stone's age, not the frames that happened to be drawn.
            const reference = skip({ lines: 7 }).touches;
            for (const fps of [30, 144]) {
                const other = skip({ lines: 7 }, { dt: 1 / fps }).touches;
                expect(other.map(({ x, z, strength }) => [x, z, strength]))
                    .toEqual(reference.map(({ x, z, strength }) => [x, z, strength]));
            }
            // The pool scales the drops, never the touches or their glints.
            const small = skip({ lines: 7 }, { petals: SUMMER_TIERS.Minimal.petals });
            expect(small.touches).toHaveLength(7);
            expect(small.thrown.filter(isGlint)).toHaveLength(7);
            const drops = (made) => made.thrown.filter((particle) => particle.kind === POLLEN).length;
            expect(drops(small)).toBeLessThan(drops(skip({ lines: 7 })));
            expect(drops(small)).toBeGreaterThan(0);
            // A harder throw rings harder.
            const hard = skip({ lines: 5, strength: 1 }).touches;
            const soft = skip({ lines: 5, strength: 0.3 }).touches;
            hard.forEach((touch, index) => expect(touch.strength).toBeGreaterThan(soft[index].strength));
        });

        it('skips the back-to-back\'s own stone on the real lake: four touches, then five for the next', () => {
            const {
                director, rung, sim, stage,
            } = createDirector();
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            const [evening] = SUMMER_HOURS;
            const sun = new THREE.Vector3(...summerSunDirection(evening.sunAzimuth, evening.sunElevation));
            const run = () => {
                for (let step = 0; step < 100; step++) {
                    director.apply(reactions.update(STEP), STEP, undefined, null, sun);
                }
            };
            reactions.onBackToBack();
            run();
            expect(rung).toHaveBeenCalledTimes(4);
            const glints = () => sim.thrown().filter(isGlint);
            expect(glints()).toHaveLength(4);
            rung.mock.calls.forEach(([x, z], index) => {
                expect(summerGroundHeight(x, z)).toBeLessThan(-0.05);
                // Out past the crest of the meadow, where the camera can see the water.
                expect(flatDistance({ x, z }, stage.origin)).toBeGreaterThan(35);
                expect([x, z]).toEqual([glints()[index].x, glints()[index].z]);
            });
            // (From here on a fish may rise as well: the stone's touches are the ones with a glint.)
            reactions.onBackToBack();
            run();
            expect(glints()).toHaveLength(4 + 5);
            for (const glint of glints()) {
                expect(rung.mock.calls.some(([x, z]) => x === glint.x && z === glint.z)).toBe(true);
            }
            // The reactions' own ring queue was never asked: these are the stone's alone.
            expect(reactions.ringSerial).toBe(0);
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

        it.each([[-1], [1]])('winds a garland beside the card for a twist on side %i', (side) => {
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
            reactions.onTwist({ piece: pieceOf('T') });
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
                // (The crown is fed in fractions of a petal, and a reset drops the fraction it was owed
                // with everything else in flight: one petal fewer at most, and never one more.)
                const petals = interrupted.sim.spawn.mock.calls.length;
                expect(petals, `petals, reset at ${resetAt}`).toBeLessThanOrEqual(asked[2]);
                expect(petals, `petals, reset at ${resetAt}`).toBeGreaterThanOrEqual(asked[2] - 1);
                // What the events themselves throw is thrown once each, to the petal: every flower
                // of the perfect clear opened once, with one heart of light.
                const hearts = (made) => made.sim.thrown().filter((particle) => particle.kind === GLOW).length;
                expect(hearts(interrupted), `hearts, reset at ${resetAt}`).toBe(hearts(whole));
            }
            expect(whole.sim.thrown().filter((particle) => particle.kind === GLOW)).toHaveLength(7);
        });

        it('starts afresh when the reactions start over, and only then', () => {
            const {
                director, sim, rung, blown, ripples, waves,
            } = createDirector({ groundHeight: PLAIN });
            const reactions = new SummerReactions({ rng: seededRandom(1) });
            // A lock and a twist: each throws once, rings once and stirs the meadow once.
            const events = () => {
                reactions.onPieceLock({ piece: pieceOf('I') });
                reactions.onTwist({ piece: pieceOf('T') });
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
                for (const kind of ['lock', 'seeds', 'clear', 'rise', 'bouquet', 'spin', 'combo', 'blossom']) {
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
            // The throws are written for High's pool: there each is exactly its written size, and
            // no tier's pool scales them by more than a little either way of that.
            expect(createDirector({ petals: REFERENCE.petals }).director.scale).toBe(1);
            let larger = Infinity;
            for (const tier of TIERS) {
                const { scale } = createDirector({ petals: SUMMER_TIERS[tier].petals }).director;
                expect(scale, tier).toBeGreaterThanOrEqual(0.2);
                expect(scale, tier).toBeLessThanOrEqual(Math.min(2, larger));
                larger = scale;
            }
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
            for (const kind of ['lock', 'seeds', 'clear', 'rise', 'bouquet', 'spin', 'combo', 'blossom', 'skip']) {
                for (const junk of [{ row: NaN }, { strength: NaN }, { column: NaN }, { side: NaN }, { age: NaN },
                    { flower: NaN }, { seed: NaN }, { duration: NaN }, { duration: 0 }]) {
                    serial += 1;
                    const broken = emitter({ kind, ...junk, serial });
                    expect(() => live.director.apply(frameWith([broken]), STEP), `${kind} ${JSON.stringify(junk)}`)
                        .not.toThrow();
                }
            }
            for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'size', 'hang', 'shine']) {
                expect(real[name].every(Number.isFinite), name).toBe(true);
            }
            // Nor does a stone with nonsense in it ring the lake with anything but a ring.
            const wet = createDirector({ groundHeight: OPEN_WATER });
            const stones = [{ strength: NaN }, { age: NaN }, { duration: NaN }, { duration: 0 }, { lines: NaN }]
                .map((junk, index) => emitter({ kind: 'skip', ...junk, serial: serial + 1 + index }));
            for (const stone of stones) {
                expect(() => wet.director.apply(frameWith([stone]), STEP)).not.toThrow();
            }
            for (const ring of wet.ripples.rings) expect(ring.toArray().every(Number.isFinite)).toBe(true);
        });

        it('keeps a broken random source inside its range', () => {
            for (const rng of [() => NaN, () => Infinity, () => -3, () => 7, () => undefined, () => '0.5', () => 1]) {
                const { director, sim } = createDirector({ rng, groundHeight: PLAIN });
                const kinds = ['lock', 'seeds', 'clear', 'rise', 'bouquet', 'spin', 'combo', 'blossom'];
                expect(() => play(director, sim, kinds.map((kind) => ({ kind, strength: 1, lines: 2 })), {
                    seconds: 0.5, frame: { crown: 0.9 },
                })).not.toThrow();
                const thrown = sim.thrown();
                expect(thrown.length).toBeGreaterThan(50);
                // (A flower's heart is a light, metres across; everything else is a petal's size.)
                const sane = (petal) => [petal.x, petal.y, petal.z, petal.vx, petal.vy, petal.vz].every(Number.isFinite)
                    && Math.hypot(petal.vx, petal.vy, petal.vz) < 40
                    && petal.life > 0 && petal.life < 12
                    && petal.size > 0 && petal.size < (petal.kind === GLOW ? 16 : 0.4);
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
                    () => reactions.onTwist({ piece: pieceOf('T', column()) }),
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
                expect([...kinds].sort())
                    .toEqual(['blossom', 'bouquet', 'clear', 'combo', 'lock', 'rise', 'seeds', 'skip', 'spin']);
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

        // The reference pool is sized for the greatest thing the evening does (summer-fx-director.js:
        // "so the flowers of a perfect clear find petals free"). A petal thrown into a full pool
        // takes the place of one still in the air: here, of a flower the air has not let go of yet.
        it('finds a free place in the pool for every petal of a perfect clear\'s flowers, in calm play', () => {
            const cut = {};
            for (const tier of TIERS) {
                const budget = SUMMER_TIERS[tier];
                // The pool as SummerPetals builds it for the tier, over the real meadow and lake.
                const sim = new SummerPetalSim({
                    count: budget.petals,
                    reserve: Math.round(budget.petals * 0.86),
                    rng: seededRandom(9),
                    groundHeight: summerGroundHeight,
                });
                const { director } = createDirector({
                    petals: budget.petals, sim, rings: budget.ripples, gusts: budget.waves, seed: 9,
                });
                const reactions = new SummerReactions({ quality: tier, rng: seededRandom(9) });
                const tick = () => sim.step(STEP, director.apply(reactions.update(STEP), STEP));
                // One hard-dropped piece clears four lines and empties the board; nothing else is
                // going on: no combo's crown is turning and play is not running hot.
                reactions.onHardDrop({ distance: 14 });
                reactions.onPieceLock({ piece: pieceOf('I') });
                reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
                for (let step = 0; step < 12; step++) tick();
                reactions.onPerfectClear();
                const spawn = sim.spawn.bind(sim);
                const hanging = new Set();
                const count = { flowers: 0, lost: 0, peak: 0 };
                sim.spawn = (x, y, z, vx, vy, vz, options = {}) => {
                    const [life, hang] = [sim.life.slice(), sim.hang.slice()];
                    const index = spawn(x, y, z, vx, vy, vz, options);
                    if (index < 0) return index;
                    // The place it was given still held a petal of a flower that was hanging in the air.
                    if (hanging.has(index) && life[index] > 0 && hang[index] > 0) count.lost += 1;
                    if (options.kind === PETAL && options.hang > 1) {
                        hanging.add(index);
                        count.flowers += 1;
                    } else hanging.delete(index);
                    return index;
                };
                for (let step = 0; step < 60 * 4; step++) {
                    tick();
                    count.peak = Math.max(count.peak, sim.counts().live);
                }
                expect(count.flowers, tier).toBeGreaterThan(50);
                expect(count.peak, tier).toBeLessThanOrEqual(sim.reserve);
                if (count.lost > 0) {
                    cut[tier] = `${count.lost} of ${count.flowers} flower petals lost their place while they hung `
                        + `(${count.peak} of ${sim.reserve} in the air at the peak)`;
                }
            }
            expect(cut).toEqual({});
        });

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
                reactions.onTwist(payload);
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
            ['a twist', (r) => r.onTwist({ piece: pieceOf('T', 7) }),
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
