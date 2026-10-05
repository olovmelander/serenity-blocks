import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { goldenForestEye, goldenForestViewFor } from '../../src/themes/golden-forest/golden-forest-composition.js';
import { GOLDEN_FOREST_TIERS } from '../../src/themes/golden-forest/golden-forest-quality.js';
import { GoldenForestReactions } from '../../src/themes/golden-forest/golden-forest-reactions.js';
import { GoldenForestRipples } from '../../src/themes/golden-forest/golden-forest-ripples.js';
import { GoldenForestSparkDirector } from '../../src/themes/golden-forest/golden-forest-spark-director.js';
import { GoldenForestSparkSim } from '../../src/themes/golden-forest/golden-forest-spark-sim.js';
import {
    GOLDEN_FOREST_DEFAULT_BOARD, GOLDEN_FOREST_STAGE_DEPTH, GoldenForestStage, readGoldenForestBoardRect,
} from '../../src/themes/golden-forest/golden-forest-stage.js';
import { goldenForestGroundHeight } from '../../src/themes/golden-forest/golden-forest-terrain.js';

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;
const WATER_NEAR = 4;
const WATER_FAR = 64;
const RING_LIFE = 9;
const RING_QUEUE = 8;
const REFERENCE_SPARKS = 2200;

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** The camera as GoldenForestWorld.prepareCamera() frames it for an aspect ratio. */
function frameCamera(aspect = LANDSCAPE) {
    const view = goldenForestViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 3400);
    camera.position.set(...goldenForestEye(view));
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateProjectionMatrix();
    return camera;
}

/** An arbitrary pose with yaw, pitch and roll, to prove the maths is not tied to the lake's view. */
function tiltedCamera() {
    const camera = new THREE.PerspectiveCamera(38, 1.3, 0.1, 500);
    camera.position.set(4, 7, -3);
    camera.rotation.set(0.4, -1.1, 0.25, 'YXZ');
    camera.updateProjectionMatrix();
    return camera;
}

/** The same kind of pose, but looking down at the water from a height. */
function tiltedDownCamera() {
    const camera = new THREE.PerspectiveCamera(38, 1.3, 0.1, 500);
    camera.position.set(4, 7, -3);
    camera.rotation.set(-0.45, -1.1, 0.25, 'YXZ');
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
    return point.clone().project(camera);
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
        age: 0,
        duration: 2,
        seed: 0.3,
        active: true,
        ...overrides,
    };
    return { ...result, progress: result.age / result.duration };
}

function ring(serial, column = 0.5, row = 0.1, strength = 1) {
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
        vortex: 0,
        heat: 0,
        ribbons: 0,
        streak: 0,
        settled: false,
        front: null,
        rings: [],
        emitters,
        ...rest,
    };
}

function spySim() {
    const sim = { spawn: vi.fn(() => 0), touchCount: 0, touches: [] };
    sim.thrown = () => sim.spawn.mock.calls.map(([x, y, z, vx, vy, vz, life, heat, size]) => ({
        x, y, z, vx, vy, vz, life, heat, size,
    }));
    return sim;
}

function createDirector({
    aspect = LANDSCAPE, sparks = REFERENCE_SPARKS, seed = 271, sim = spySim(), rings = 8,
    groundHeight = goldenForestGroundHeight, ...options
} = {}) {
    const camera = frameCamera(aspect);
    const stage = new GoldenForestStage(camera);
    const ripples = new GoldenForestRipples(rings);
    const added = vi.spyOn(ripples, 'add');
    const director = new GoldenForestSparkDirector({
        stage, sim, ripples, tier: { sparks }, rng: seededRandom(seed), groundHeight, ...options,
    });
    return {
        camera, stage, sim, ripples, added, director,
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

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Golden Forest stage', () => {
    it.each([
        ['the landscape lake view', () => frameCamera(LANDSCAPE)],
        ['the portrait lake view', () => frameCamera(PORTRAIT)],
        ['an arbitrary tilted camera', tiltedCamera],
    ])('maps screen fractions onto a plane in front of %s', (_label, makeCamera) => {
        const camera = makeCamera();
        const stage = new GoldenForestStage(camera);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        for (const depth of [1, GOLDEN_FOREST_STAGE_DEPTH, 40]) {
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
        expectVector(stage.point(0.3, 0.6), stage.point(0.3, 0.6, GOLDEN_FOREST_STAGE_DEPTH));
        const target = new THREE.Vector3(9, 9, 9);
        expect(stage.point(0.3, 0.6, 5, target)).toBe(target);
        expectVector(target, stage.point(0.3, 0.6, 5));
    });

    it.each([
        ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
    ])('finds the card edges, its centre and its rows in %s', (_label, aspect) => {
        const camera = frameCamera(aspect);
        const stage = new GoldenForestStage(camera);
        expect(stage.board).toEqual(GOLDEN_FOREST_DEFAULT_BOARD);
        expect(stage.board).not.toBe(GOLDEN_FOREST_DEFAULT_BOARD);
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
        }
        expect(stage.edge(-1, 1).y).toBeGreaterThan(stage.edge(-1, 0).y + 5);
        // Rows outside the card are clamped onto it.
        expectVector(stage.edge(1, -4), stage.edge(1, 0));
        expectVector(stage.edge(1, 9), stage.edge(1, 1));
        // An inset moves the point in from either edge, toward the middle of the card.
        expect(ndc(stage.edge(-1, 0.5, 6, undefined, 0.02), camera).x).toBeCloseTo((x0 + 0.02) * 2 - 1, 9);
        expect(ndc(stage.edge(1, 0.5, 6, undefined, 0.02), camera).x).toBeCloseTo((x1 - 0.02) * 2 - 1, 9);
        const centre = ndc(stage.centre(), camera);
        expect(centre.x).toBeCloseTo((x0 + x1) - 1, 9);
        expect(centre.y).toBeCloseTo(1 - (y0 + y1), 9);
        const target = new THREE.Vector3();
        expect(stage.edge(-1, 0.5, 4, target)).toBe(target);
        expect(stage.centre(4, target)).toBe(target);
        // Everything lies on the plane at the requested depth.
        const forward = camera.getWorldDirection(new THREE.Vector3());
        for (const point of [stage.edge(-1, 0.2), stage.edge(1, 0.9), stage.centre()]) {
            expect(point.clone().sub(camera.position).dot(forward)).toBeCloseTo(GOLDEN_FOREST_STAGE_DEPTH, 9);
        }
    });

    it('turns a place on the card into a screen position, column left to right and row foot to top', () => {
        const stage = new GoldenForestStage(frameCamera());
        const {
            x0, x1, y0, y1,
        } = GOLDEN_FOREST_DEFAULT_BOARD;
        expect(stage.screen(0, 0)).toEqual({ x: x0, y: y1 });
        expect(stage.screen(1, 1).x).toBe(x1);
        expect(stage.screen(1, 1).y).toBeCloseTo(y0, 12);
        const middle = stage.screen(0.5, 0.5);
        expect(middle.x).toBeCloseTo((x0 + x1) / 2, 12);
        expect(middle.y).toBeCloseTo((y0 + y1) / 2, 12);
        expect(stage.screen(0.25, 0.75).x).toBeCloseTo(x0 + (x1 - x0) * 0.25, 12);
        expect(stage.screen(0.25, 0.75).y).toBeCloseTo(y1 + (y0 - y1) * 0.75, 12);
        // Off the card is clamped onto it.
        expect(stage.screen(-3, -3)).toEqual(stage.screen(0, 0));
        expect(stage.screen(7, 7)).toEqual(stage.screen(1, 1));
        // It follows the measured card.
        stage.setBoard({
            x0: 0.1, x1: 0.3, y0: 0.2, y1: 0.8,
        });
        expect(stage.screen(1, 0)).toEqual({ x: 0.3, y: 0.8 });
        // The screen position agrees with the edge of the card in the world.
        const camera = frameCamera();
        const framed = new GoldenForestStage(camera);
        const spot = framed.screen(0, 0.4);
        expectVector(framed.point(spot.x, spot.y), framed.edge(-1, 0.4));
    });

    it('measures half the width of the view at a depth', () => {
        for (const aspect of [LANDSCAPE, PORTRAIT, 1]) {
            const camera = frameCamera(aspect);
            const stage = new GoldenForestStage(camera);
            const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
            expect(stage.halfWidth()).toBeCloseTo(GOLDEN_FOREST_STAGE_DEPTH * tan * aspect, 9);
            expect(stage.halfWidth(60)).toBeCloseTo(60 * tan * aspect, 9);
            // The screen's own edges are that far from its axis.
            const left = stage.point(0, 0.5, 20);
            const right = stage.point(1, 0.5, 20);
            expect(left.distanceTo(right)).toBeCloseTo(stage.halfWidth(20) * 2, 9);
        }
    });

    describe('water behind the card', () => {
        it.each([
            ['landscape', () => frameCamera(LANDSCAPE)],
            ['portrait', () => frameCamera(PORTRAIT)],
            ['a tilted camera looking down', tiltedDownCamera],
            ['a tilted camera looking up', tiltedCamera],
        ])('finds the point on the lake seen through a screen position in %s', (_label, makeCamera) => {
            const camera = makeCamera();
            const stage = new GoldenForestStage(camera);
            let exact = 0;
            for (let sx = 0; sx <= 1.001; sx += 0.125) {
                for (let sy = 0; sy <= 1.001; sy += 0.05) {
                    const point = stage.water(sx, sy);
                    // Always a point on the lake, never further or nearer than its reach.
                    expect(point.y).toBe(0);
                    const distance = flatDistance(point, camera.position);
                    expect(distance).toBeGreaterThanOrEqual(WATER_NEAR - 1e-9);
                    expect(distance).toBeLessThanOrEqual(WATER_FAR + 1e-9);
                    // It lies under the ray through that screen position: same compass bearing.
                    const ray = stage.point(sx, sy, 1).sub(camera.position);
                    const flat = Math.hypot(ray.x, ray.z);
                    expect((point.x - camera.position.x) / distance).toBeCloseTo(ray.x / flat, 9);
                    expect((point.z - camera.position.z) / distance).toBeCloseTo(ray.z / flat, 9);
                    if (distance > WATER_NEAR + 1e-6 && distance < WATER_FAR - 1e-6) {
                        // Inside the reach it is exactly what the eye sees there.
                        const projected = ndc(point, camera);
                        expect(projected.x).toBeCloseTo(sx * 2 - 1, 6);
                        expect(projected.y).toBeCloseTo(1 - sy * 2, 6);
                        exact += 1;
                    } else if (ray.y >= 0) {
                        // Looking at or above the horizon there is no such point: the far end stands in.
                        expect(distance).toBeCloseTo(WATER_FAR, 9);
                    }
                }
            }
            // The camera that looks up sees no water at all; every other view sees plenty.
            if (camera.getWorldDirection(new THREE.Vector3()).y > 0.2) expect(exact).toBe(0);
            else expect(exact).toBeGreaterThan(20);
        });

        it('comes nearer as the position moves down the screen and follows it sideways', () => {
            const camera = frameCamera(LANDSCAPE);
            const stage = new GoldenForestStage(camera);
            let previous = Infinity;
            for (let sy = 0.4; sy <= 1.001; sy += 0.05) {
                const distance = flatDistance(stage.water(0.5, sy), camera.position);
                expect(distance).toBeLessThanOrEqual(previous);
                previous = distance;
            }
            expect(previous).toBeLessThan(10);
            expect(flatDistance(stage.water(0.5, 0.4), camera.position)).toBe(WATER_FAR);
            // This view looks straight down the lake: left on screen is west on the water.
            expect(stage.water(0.2, 0.8).x).toBeLessThan(stage.water(0.5, 0.8).x);
            expect(stage.water(0.8, 0.8).x).toBeGreaterThan(stage.water(0.5, 0.8).x);
            expect(stage.water(0.5, 0.8).x).toBeCloseTo(0, 9);
            // The foot of the default card looks at open water in front of the bank.
            const foot = stage.screen(0.5, 0);
            const under = stage.water(foot.x, foot.y);
            expect(goldenForestGroundHeight(under.x, under.z)).toBeLessThan(-1);
            expect(under.z).toBeLessThan(camera.position.z);
        });

        it('never returns water closer than its near reach, however steeply the camera looks down', () => {
            const camera = downwardCamera();
            const stage = new GoldenForestStage(camera);
            // The true intersection under the middle of the screen is 2.5 m out.
            const point = stage.water(0.5, 0.5);
            expect(point.y).toBe(0);
            expect(flatDistance(point, camera.position)).toBeCloseTo(WATER_NEAR, 9);
            expect(point.x).toBeCloseTo(2, 9);
            expect(point.z).toBeCloseTo(3 - WATER_NEAR, 9);
            // Higher on the screen the ray flattens and reaches further again, exactly.
            const further = stage.water(0.5, 0.05);
            expect(flatDistance(further, camera.position)).toBeGreaterThan(WATER_NEAR + 0.5);
            expect(ndc(further, camera).y).toBeCloseTo(0.9, 6);
        });

        it('writes into the vector it is given and leaves its own state reusable', () => {
            const stage = new GoldenForestStage(frameCamera());
            const target = new THREE.Vector3(7, 7, 7);
            expect(stage.water(0.3, 0.8, target)).toBe(target);
            const first = target.clone();
            const other = stage.water(0.9, 0.7);
            expect(other).not.toBe(target);
            expectVector(stage.water(0.3, 0.8), first, 12);
            expect(other.x).not.toBeCloseTo(first.x, 3);
        });
    });

    it('accepts a measured card, clamps it to the screen and falls back to the default for junk', () => {
        const stage = new GoldenForestStage(frameCamera());
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
        // A sliver is not a board: at least 4% of the width and 10% of the height.
        {
            x0: 0.5, x1: 0.53, y0: 0.1, y1: 0.9,
        }, {
            x0: 0.2, x1: 0.8, y0: 0.5, y1: 0.55,
        },
        {
            x0: 0.1, x1: Infinity, y0: 0.1, y1: 0.9,
        }];
        for (const rect of junk) {
            stage.setBoard({
                x0: 0.05, x1: 0.25, y0: 0.1, y1: 0.9,
            });
            expect(() => stage.setBoard(rect)).not.toThrow();
            expect(stage.board, JSON.stringify(rect)).toEqual(GOLDEN_FOREST_DEFAULT_BOARD);
        }
        expect(Object.isFrozen(GOLDEN_FOREST_DEFAULT_BOARD)).toBe(true);
        // The edges follow the card at once.
        const camera = frameCamera();
        const framed = new GoldenForestStage(camera);
        framed.setBoard({
            x0: 0.6, x1: 0.9, y0: 0.2, y1: 0.8,
        });
        expect(ndc(framed.edge(-1, 0), camera).x).toBeCloseTo(0.2, 9);
        expect(ndc(framed.edge(1, 0), camera).x).toBeCloseTo(0.8, 9);
        expect(ndc(framed.centre(), camera).y).toBeCloseTo(0, 9);
    });

    it('keeps the rest pose it read until it is refreshed', () => {
        const camera = frameCamera();
        const stage = new GoldenForestStage(camera);
        const origin = stage.origin.clone();
        const centre = stage.centre().clone();
        const water = stage.water(0.5, 0.8).clone();
        // Pointer parallax moves the live camera every frame; the stage must not follow it.
        camera.position.x += 3;
        camera.rotation.y += 0.4;
        camera.fov = 80;
        camera.aspect = 0.5;
        camera.updateProjectionMatrix();
        expectVector(stage.origin, origin, 12);
        expectVector(stage.centre(), centre, 12);
        expectVector(stage.water(0.5, 0.8), water, 12);
        stage.refresh();
        expect(stage.origin.x).toBeCloseTo(origin.x + 3, 9);
        expect(stage.tanV).toBeCloseTo(Math.tan(THREE.MathUtils.degToRad(40)), 12);
        expect(stage.tanH).toBeCloseTo(stage.tanV * 0.5, 12);
        expect(ndc(stage.centre(), camera).x).toBeCloseTo(0, 9);
        expect(stage.water(0.5, 0.8).distanceTo(water)).toBeGreaterThan(1);
    });
});

describe('reading the Golden Forest board card from the page', () => {
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

    it('measures a visible board card in screen fractions', () => {
        const doc = page([card({
            left: 400, top: 50, width: 200, height: 400,
        })]);
        expect(readGoldenForestBoardRect(doc, win())).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        expect(doc.querySelectorAll).toHaveBeenCalledExactlyOnceWith(SELECTOR);
    });

    it('unites every visible card so several boards share one stage', () => {
        const doc = page([
            card({
                left: 100, top: 100, width: 200, height: 300,
            }),
            card({
                left: 600, top: 50, width: 250, height: 400,
            }),
        ]);
        expect(readGoldenForestBoardRect(doc, win())).toEqual({
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
        expect(readGoldenForestBoardRect(page([...ghosts, visible]), win())).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        expect(readGoldenForestBoardRect(page(ghosts), win())).toBeNull();
        // A faint card is still a card.
        const faint = card({
            left: 400, top: 50, width: 200, height: 400, style: { opacity: '0.3' },
        });
        expect(readGoldenForestBoardRect(page([faint]), win())).not.toBeNull();
    });

    it('returns null when there is no page, no window or no board, and never divides by an unknown size', () => {
        expect(readGoldenForestBoardRect(null, win())).toBeNull();
        expect(readGoldenForestBoardRect(page([]), null)).toBeNull();
        expect(readGoldenForestBoardRect({}, win())).toBeNull();
        expect(readGoldenForestBoardRect(page([]), win())).toBeNull();
        const rect = readGoldenForestBoardRect(page([card({
            left: 0, top: 0, width: 20, height: 40,
        })]), { innerWidth: 0, innerHeight: undefined });
        expect(Object.values(rect).every(Number.isFinite)).toBe(true);
        // A card hanging off the screen is reported as it is; the stage clamps it.
        const hanging = readGoldenForestBoardRect(page([card({
            left: -100, top: 50, width: 400, height: 400,
        })]), win());
        expect(hanging.x0).toBeCloseTo(-0.1, 12);
        const stage = new GoldenForestStage(frameCamera());
        stage.setBoard(hanging);
        expect(stage.board.x0).toBe(0);
        expect(stage.board.x1).toBeCloseTo(0.3, 12);
    });

    it('reads the live document and window by default', () => {
        vi.stubGlobal('window', win());
        vi.stubGlobal('document', page([card({
            left: 250, top: 100, width: 500, height: 300,
        })]));
        expect(readGoldenForestBoardRect()).toEqual({
            x0: 0.25, x1: 0.75, y0: 0.2, y1: 0.8,
        });
        vi.unstubAllGlobals();
        vi.stubGlobal('document', undefined);
        vi.stubGlobal('window', undefined);
        expect(readGoldenForestBoardRect()).toBeNull();
    });
});

describe('Golden Forest lake rings', () => {
    const snapshot = (ripples) => ripples.rings.map((entry) => entry.toArray());

    it('keeps a fixed pool of rings, all at rest', () => {
        const ripples = new GoldenForestRipples(5);
        expect(ripples.count).toBe(5);
        expect(ripples.rings).toHaveLength(5);
        expect(ripples.rings.every((entry) => entry.isVector4)).toBe(true);
        expect(snapshot(ripples)).toEqual(Array(5).fill([0, 0, 0, 0]));
        expect(ripples.active()).toBe(0);
        expect(new GoldenForestRipples().count).toBe(8);
        expect(new GoldenForestRipples(3.9).count).toBe(3);
        expect(new GoldenForestRipples(0).count).toBe(1);
        expect(new GoldenForestRipples(-4).rings).toHaveLength(1);
        for (const tier of Object.values(GOLDEN_FOREST_TIERS)) {
            expect(new GoldenForestRipples(tier.ripples).rings).toHaveLength(tier.ripples);
        }
    });

    it('starts a ring at a point with its strength, capped, and refuses nonsense', () => {
        const ripples = new GoldenForestRipples(4);
        const first = ripples.add(3, -7, 1.5);
        expect(first).toBe(ripples.rings[0]);
        expect(first.toArray()).toEqual([3, -7, 0, 1.5]);
        // Strength defaults to one and never exceeds three.
        expect(ripples.add(1, 1).toArray()).toEqual([1, 1, 0, 1]);
        expect(ripples.add(2, 2, 80).toArray()).toEqual([2, 2, 0, 3]);
        expect(ripples.add(2, 2, Infinity).w).toBe(3);
        expect(ripples.active()).toBe(4);
        const before = snapshot(ripples);
        for (const [x, z, strength] of [[NaN, 0, 1], [0, NaN, 1], [Infinity, 0, 1], [0, -Infinity, 1], [0, 0, 0],
            [0, 0, -2], [0, 0, NaN], [undefined, 0, 1], ['3', 0, 1], [0, 0, null]]) {
            expect(ripples.add(x, z, strength)).toBeNull();
        }
        expect(snapshot(ripples)).toEqual(before);
    });

    it('fills free slots in turn, then replaces the oldest ring on the water', () => {
        const ripples = new GoldenForestRipples(3);
        ripples.add(10, 0, 1);
        ripples.update(2);
        ripples.add(20, 0, 1);
        ripples.update(1);
        ripples.add(30, 0, 1);
        ripples.update(1);
        expect(snapshot(ripples).map(([x, , age]) => [x, age])).toEqual([[10, 4], [20, 2], [30, 1]]);
        // Full: the next ring takes the place of the oldest, not of the next slot along.
        ripples.add(40, 0, 2);
        expect(snapshot(ripples).map(([x, , age]) => [x, age])).toEqual([[40, 0], [20, 2], [30, 1]]);
        ripples.update(0.5);
        ripples.add(50, 0, 2);
        expect(snapshot(ripples).map(([x, , age]) => [x, age])).toEqual([[40, 0.5], [50, 0], [30, 1.5]]);
        ripples.add(60, 0, 2);
        expect(snapshot(ripples).map(([x]) => x)).toEqual([40, 50, 60]);
        expect(ripples.active()).toBe(3);
        // A pool of one is simply overwritten.
        const single = new GoldenForestRipples(1);
        single.add(1, 1, 1);
        single.add(2, 2, 1);
        expect(snapshot(single)).toEqual([[2, 2, 0, 1]]);
    });

    it('ages the rings on the water and clears each one at the end of its life', () => {
        const ripples = new GoldenForestRipples(3);
        ripples.add(1, 1, 1);
        ripples.update(4);
        ripples.add(2, 2, 2);
        expect(snapshot(ripples)).toEqual([[1, 1, 4, 1], [2, 2, 0, 2], [0, 0, 0, 0]]);
        // Only time ages them; a ring at rest stays at rest.
        for (const dt of [0, -1, NaN, undefined, null, -Infinity]) ripples.update(dt);
        expect(snapshot(ripples)).toEqual([[1, 1, 4, 1], [2, 2, 0, 2], [0, 0, 0, 0]]);
        ripples.update(RING_LIFE - 4);
        expect(ripples.rings[0].z).toBeCloseTo(RING_LIFE, 9);
        expect(ripples.active()).toBe(2);
        ripples.update(0.01);
        expect(snapshot(ripples)[0]).toEqual([0, 0, 0, 0]);
        expect(ripples.active()).toBe(1);
        expect(ripples.rings[1].z).toBeCloseTo(RING_LIFE - 4 + 0.01, 9);
        // The freed slot is found before the live ring is disturbed.
        ripples.add(3, 3, 1);
        ripples.add(4, 4, 1);
        expect(snapshot(ripples).map(([x]) => x).sort()).toEqual([2, 3, 4]);
        // A whole session later the water is still.
        for (let frame = 0; frame < 60 * (RING_LIFE + 1); frame++) ripples.update(STEP);
        expect(ripples.active()).toBe(0);
        expect(snapshot(ripples)).toEqual(Array(3).fill([0, 0, 0, 0]));
    });

    it('forgets every ring on reset without replacing the pool', () => {
        const ripples = new GoldenForestRipples(4);
        const { rings } = ripples;
        for (let index = 0; index < 6; index++) ripples.add(index, index, 1);
        ripples.update(1);
        ripples.reset();
        expect(ripples.rings).toBe(rings);
        expect(snapshot(ripples)).toEqual(Array(4).fill([0, 0, 0, 0]));
        expect(ripples.active()).toBe(0);
        expect(ripples.add(5, 5, 1)).toBe(rings[0]);
    });
});

describe('Golden Forest spark director', () => {
    describe('rings on the lake', () => {
        it('drops each ring the reactions ask for exactly once, on the water behind its place', () => {
            const {
                director, stage, ripples, added,
            } = createDirector();
            const reactions = new GoldenForestReactions({ rng: seededRandom(1) });
            reactions.onPieceLock({ piece: { x: 2, y: 20, shape: [[1]] } });
            const frame = reactions.update(STEP);
            const [asked] = frame.rings.filter((entry) => entry.serial >= 0);
            director.apply(frame, STEP);
            expect(added).toHaveBeenCalledOnce();
            const screen = stage.screen(asked.column, asked.row);
            const spot = stage.water(screen.x, screen.y);
            expect(added.mock.calls[0][0]).toBeCloseTo(spot.x, 9);
            expect(added.mock.calls[0][1]).toBeCloseTo(spot.z, 9);
            expect(added.mock.calls[0][2]).toBe(asked.strength);
            expect(goldenForestGroundHeight(spot.x, spot.z)).toBeLessThan(0);
            expect(ripples.active()).toBe(1);
            // The ring stays in the queue for seconds: it must not be dropped again.
            for (let step = 0; step < 120; step++) director.apply(reactions.update(STEP), STEP);
            expect(added).toHaveBeenCalledOnce();
            // A second lock adds exactly one more.
            reactions.onPieceLock({ piece: { x: 7, y: 12, shape: [[1]] } });
            director.apply(reactions.update(STEP), STEP);
            director.apply(reactions.update(STEP), STEP);
            expect(added).toHaveBeenCalledTimes(2);
            expect(added.mock.calls[1][0]).toBeGreaterThan(added.mock.calls[0][0]);
            expect(director.ringSerial).toBe(1);
        });

        it('takes every ring of a busy frame and keeps count across the wrap of the queue', () => {
            const { director, added } = createDirector();
            const reactions = new GoldenForestReactions({ rng: seededRandom(1) });
            let asked = 0;
            const events = [
                () => reactions.onPieceLock(),
                () => { reactions.onPieceLock(); reactions.onLineClear(4); },
                () => reactions.onCombo(5),
                () => { reactions.onPerfectClear(); reactions.onLevelUp(); reactions.onTSpin(); },
                () => { reactions.onLineClear(2); reactions.onLineClear(3); reactions.onCombo(7); },
                () => reactions.onBackToBack(),
                () => {
                    reactions.onPieceLock();
                    reactions.onLineClear(1);
                    reactions.onCombo(2);
                    reactions.onLevelUp();
                },
            ];
            for (let round = 0; round < 4; round++) {
                for (const event of events) {
                    const before = reactions.ringSerial;
                    event();
                    // No more than the queue holds are asked for between two frames here.
                    expect(reactions.ringSerial - before).toBeLessThanOrEqual(RING_QUEUE);
                    asked = reactions.ringSerial;
                    director.apply(reactions.update(STEP), STEP);
                    expect(added).toHaveBeenCalledTimes(asked);
                    for (let step = 0; step < 5; step++) director.apply(reactions.update(STEP), STEP);
                    expect(added).toHaveBeenCalledTimes(asked);
                }
            }
            expect(asked).toBe(4 * 18);
            expect(director.ringSerial).toBe(asked - 1);
            // Every strength that was asked for arrived: nothing was dropped twice or invented.
            const strengths = added.mock.calls.map(([, , strength]) => strength);
            expect(strengths.filter((strength) => strength === 2.6)).toHaveLength(4);
            expect(strengths.filter((strength) => strength === 1.8)).toHaveLength(8);
            expect(strengths.every((strength) => strength > 0 && strength <= 3)).toBe(true);
        });

        it('plays a new session from serial zero once the reactions have started over', () => {
            const { director, ripples, added } = createDirector();
            const reactions = new GoldenForestReactions({ rng: seededRandom(1) });
            for (let lock = 0; lock < 9; lock++) {
                reactions.onPieceLock();
                director.apply(reactions.update(STEP), STEP);
            }
            expect(added).toHaveBeenCalledTimes(9);
            expect(director.ringSerial).toBe(8);
            expect(director.epoch).toBe(1);

            // A new session. The director is told nothing: it reads the epoch off the next frame.
            reactions.reset();
            ripples.reset();
            expect(director.ringSerial).toBe(8);
            // The emptied queue asks for nothing ...
            director.apply(reactions.update(STEP), STEP);
            director.apply(reactions.getFrame(), STEP);
            expect(added).toHaveBeenCalledTimes(9);
            // ... and the count starts over.
            expect(director.epoch).toBe(2);
            expect(director.ringSerial).toBe(-1);
            // The new session's first rings carry serials the old one already used.
            reactions.onPieceLock({ piece: { x: 1, y: 20, shape: [[1]] } });
            reactions.onLineClear(2, { clearedRows: [22, 23] });
            director.apply(reactions.update(STEP), STEP);
            expect(added).toHaveBeenCalledTimes(12);
            expect(ripples.active()).toBe(3);
            for (let step = 0; step < 30; step++) director.apply(reactions.update(STEP), STEP);
            expect(added).toHaveBeenCalledTimes(12);
            expect(director.ringSerial).toBe(2);

            // An event in the very frame of the reset is not lost either: no rest frame is needed.
            reactions.reset();
            reactions.onPerfectClear();
            director.apply(reactions.update(STEP), STEP);
            expect(director.epoch).toBe(3);
            expect(added).toHaveBeenCalledTimes(14);
            expect(added.mock.calls.slice(-2).map(([, , strength]) => strength)).toEqual([2.6, 1.6]);
        });

        it('adds the rings of a frame oldest first, whatever slots the queue has wrapped them into', () => {
            const { director, added } = createDirector();
            const strengthOf = (serial) => 1 + serial / 10;
            const queue = (serials) => serials.map((serial) => ring(serial, 0.5, 0.1, strengthOf(serial)));
            const strengths = () => added.mock.calls.map(([, , strength]) => strength);
            // The writer has been round once: slots 0 and 1 hold the newest two.
            director.apply(frameWith([], { rings: queue([8, 9, 2, 3, 4, 5, 6, 7]) }), STEP);
            expect(strengths()).toEqual([2, 3, 4, 5, 6, 7, 8, 9].map(strengthOf));
            expect(director.ringSerial).toBe(9);
            // Two more a frame later, wrapped again: only those, in the order they were asked.
            added.mockClear();
            director.apply(frameWith([], { rings: queue([8, 9, 10, 11, 12, 5, 6, 7]) }), STEP);
            expect(strengths()).toEqual([10, 11, 12].map(strengthOf));
            added.mockClear();
            director.apply(frameWith([], { rings: queue([16, 9, 10, 11, 12, 13, 14, 15]) }), STEP);
            expect(strengths()).toEqual([13, 14, 15, 16].map(strengthOf));
            expect(director.ringSerial).toBe(16);
        });

        // Regression: rings used to be added in slot order. On the tiers whose lake carries four
        // rings, a perfect clear on a combo asks for six in one frame; depending on where the
        // queue had wrapped, the perfect clear's own two were the ones overwritten.
        it.each([
            [0], [1], [2], [3], [4], [5], [6], [7], [8],
        ])('keeps both rings of a perfect clear on a pool of four after %i earlier locks', (earlier) => {
            const { director, ripples } = createDirector({ rings: 4, sparks: 420 });
            const reactions = new GoldenForestReactions({ quality: 'Minimal', rng: seededRandom(1) });
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
            expect(frame.rings.filter((entry) => entry.serial >= earlier)).toHaveLength(6);
            director.apply(frame, STEP);
            const onTheWater = ripples.rings.filter((entry) => entry.z === 0).map((entry) => entry.w)
                .sort((a, b) => b - a);
            // The last four asked are the four on the water: the perfect clear's 2.6 and 1.6,
            // the clear's second ring and the combo's. The lock's and the clear's first gave way.
            expect(onTheWater).toHaveLength(4);
            expect(onTheWater[0]).toBe(2.6);
            expect(onTheWater[1]).toBe(1.6);
            expect(onTheWater[2]).toBeCloseTo(0.7 + 4 * 0.2, 12);
            expect(onTheWater[3]).toBeCloseTo(0.7 + 0.9 * (1 - Math.exp(-2 * 0.22)), 12);
        });

        it('ignores rings at rest, rings without strength and frames without a queue', () => {
            const { director, ripples, added } = createDirector();
            const rest = Array.from({ length: RING_QUEUE }, () => ring(-1, 0.5, 0, 0));
            for (const rings of [rest, undefined, null, [], 'rings', [{}], [ring(NaN, 0.5, 0.1, 1)],
                [ring(undefined, 0.5, 0.1, 1)]]) {
                expect(() => director.apply(frameWith([], { rings }), STEP)).not.toThrow();
            }
            expect(added).not.toHaveBeenCalled();
            expect(ripples.active()).toBe(0);
            // None of that was a ring: the first real one still reaches the water.
            expect(director.ringSerial).toBe(-1);
            director.apply(frameWith([], { rings: [...rest.slice(1), ring(0, 0.5, 0.1, 1)] }), STEP);
            expect(added).toHaveBeenCalledOnce();
            expect(ripples.active()).toBe(1);
            // A ring asked for with no strength is passed over, never dropped on the water.
            for (const [serial, strength] of [[1, 0], [2, -1], [3, NaN]]) {
                director.apply(frameWith([], { rings: [ring(serial, 0.5, 0.1, strength)] }), STEP);
            }
            expect(added).toHaveBeenCalledOnce();
            director.apply(frameWith([], { rings: [ring(4, 0.5, 0.1, 0.5)] }), STEP);
            expect(added).toHaveBeenCalledTimes(2);
            // A director without a lake still plays the rest of the frame and keeps count.
            const dry = createDirector({ ripples: null });
            expect(dry.director.ripples).toBeNull();
            expect(() => dry.director.apply(frameWith([emitter()], { rings: [ring(0)] }), STEP)).not.toThrow();
            expect(dry.sim.spawn).toHaveBeenCalled();
            expect(dry.director.ringSerial).toBe(0);
        });

        it('rings the water where a spark went out', () => {
            const sim = spySim();
            const { director, added } = createDirector({ sim });
            sim.touches = [{ x: 3.5, z: -8, strength: 0.21 }, { x: -6, z: -20, strength: 0.17 },
                { x: 99, z: 99, strength: 9 }];
            sim.touchCount = 2;
            director.apply(frameWith(), STEP);
            expect(added.mock.calls).toEqual([[3.5, -8, 0.21], [-6, -20, 0.17]]);
            sim.touchCount = 0;
            director.apply(frameWith(), STEP);
            expect(added).toHaveBeenCalledTimes(2);
        });

        it('lets a fish rise now and then on open water, and never while the lake is settled', () => {
            const { director, added, stage } = createDirector({ seed: 5 });
            const times = [];
            for (let step = 0; step < 60 * 60; step++) {
                const before = added.mock.calls.length;
                director.apply(frameWith(), STEP);
                if (added.mock.calls.length > before) times.push(step * STEP);
            }
            expect(times.length).toBeGreaterThanOrEqual(4);
            expect(times.length).toBeLessThanOrEqual(13);
            // The first after three seconds, then between 4.5 and 10.5 seconds apart, or a
            // multiple of that when a fish tried to rise under the bank.
            expect(times[0]).toBeGreaterThan(2.9);
            for (let index = 1; index < times.length; index++) {
                expect(times[index] - times[index - 1]).toBeGreaterThan(4.4);
            }
            for (const [x, z, strength] of added.mock.calls) {
                expect(goldenForestGroundHeight(x, z)).toBeLessThan(-0.4);
                expect(strength).toBeGreaterThanOrEqual(0.3);
                expect(strength).toBeLessThanOrEqual(0.5);
                expect(flatDistance({ x, z }, stage.origin)).toBeLessThanOrEqual(WATER_FAR);
            }
            // Game over: the water is left alone.
            const quiet = createDirector({ seed: 5 });
            for (let step = 0; step < 60 * 60; step++) quiet.director.apply(frameWith([], { settled: true }), STEP);
            expect(quiet.added).not.toHaveBeenCalled();
            // No fish jumps on a frozen frame either.
            const frozen = createDirector({ seed: 5 });
            for (let step = 0; step < 60 * 60; step++) frozen.director.apply(frameWith(), 0);
            expect(frozen.added).not.toHaveBeenCalled();
        });
    });

    describe('locks', () => {
        it.each([
            ['lock', LANDSCAPE], ['clear', LANDSCAPE], ['spin', LANDSCAPE], ['lock', PORTRAIT], ['clear', PORTRAIT],
            ['spin', PORTRAIT],
        ])('starts %s sparks for the bottom row clear of the water and the bank (aspect %f)', (kind, aspect) => {
            const { director, sim } = createDirector({ aspect });
            play(director, sim, [{
                kind, side: -1, row: 0, lines: 4, strength: 1,
            }, {
                kind, side: 1, row: 0, lines: 4, strength: 1,
            }], { seconds: 0.6 });
            const thrown = sim.thrown();
            expect(thrown.length).toBeGreaterThan(40);
            for (const spark of thrown) {
                const floor = Math.max(0, goldenForestGroundHeight(spark.x, spark.z));
                expect(spark.y).toBeGreaterThanOrEqual(floor + 0.15 - 1e-9);
                expect(spark.y).toBeLessThan(floor + 2.5);
            }
        });

        it.each([[-1], [1]])('throws a fresh puff once from the card edge on side %i, outward', (side) => {
            const { director, sim, stage } = createDirector();
            const edge = stage.edge(side, 0.6, GOLDEN_FOREST_STAGE_DEPTH, new THREE.Vector3(), 0.012);
            const spec = { side, row: 0.6, strength: 0.5 };
            const first = director.apply(frameWith([emitter(spec)]), STEP);
            const thrown = sim.thrown();
            expect(thrown).toHaveLength(Math.round(10 + 26 * 0.5));
            for (const spark of thrown) {
                // From just outside the edge of the card, away from the board.
                expect((spark.x - edge.x) * side).toBeGreaterThanOrEqual(0);
                expect((spark.x - edge.x) * side).toBeLessThan(0.3);
                expect(Math.abs(spark.z - edge.z)).toBeLessThanOrEqual(0.6);
                expect(Math.abs(spark.y - edge.y)).toBeLessThanOrEqual(0.45);
                expect(spark.vx * side).toBeGreaterThan(1.9);
                expect(spark.vx * side).toBeLessThan(6.7);
                expect(spark.vy).toBeGreaterThan(0);
                expect(spark.life).toBeGreaterThanOrEqual(1.5);
                expect(spark.life).toBeLessThan(3);
                expect(spark.heat).toBeCloseTo(0.075, 12);
            }
            // Its burst sits just inside the edge, so it pushes the puff outward and up.
            expect(first.fields).toEqual([{
                kind: 'burst', x: edge.x - side * 0.4, y: edge.y - 0.3, z: edge.z, radius: 4, power: 15, up: 5,
            }]);
            // The same emitter a frame later is not a new event.
            const second = director.apply(frameWith([emitter({ ...spec, age: 0.1 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(thrown.length);
            expect(second.fields).toHaveLength(1);
            expect(director.apply(frameWith([emitter({ ...spec, age: 0.25 })]), STEP).fields).toEqual([]);
            expect(sim.spawn).toHaveBeenCalledTimes(thrown.length);
        });

        it('follows the height of the piece and throws harder for a stronger lock', () => {
            const puff = (overrides) => {
                const { director, sim, stage } = createDirector();
                director.apply(frameWith([emitter(overrides)]), STEP);
                return { thrown: sim.thrown(), stage };
            };
            const low = puff({ row: 0.3, strength: 0.5 });
            const high = puff({ row: 0.9, strength: 0.5 });
            const rise = high.stage.edge(-1, 0.9).y - low.stage.edge(-1, 0.3).y;
            expect(rise).toBeGreaterThan(3);
            expect(mean(high.thrown.map((spark) => spark.y)) - mean(low.thrown.map((spark) => spark.y)))
                .toBeCloseTo(rise, 0);
            const gentle = puff({ strength: 0.26 });
            const hard = puff({ strength: 1 });
            expect(gentle.thrown).toHaveLength(Math.round(10 + 26 * 0.26));
            expect(hard.thrown).toHaveLength(36);
            expect(mean(hard.thrown.map((spark) => Math.abs(spark.vx))))
                .toBeGreaterThan(mean(gentle.thrown.map((spark) => Math.abs(spark.vx))) * 1.5);
        });

        it('treats a reused slot with a new serial as a new event', () => {
            const { director, sim } = createDirector();
            director.apply(frameWith([emitter({ id: 3, serial: 10 })]), STEP);
            const once = sim.spawn.mock.calls.length;
            director.apply(frameWith([emitter({ id: 3, serial: 10, age: 0.5 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(once);
            director.apply(frameWith([emitter({ id: 3, serial: 11, side: 1 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 2);
            expect(sim.thrown().slice(once).every((spark) => spark.vx > 0)).toBe(true);
            // Two slots never confuse one another.
            director.apply(frameWith([emitter({ id: 3, serial: 11 }), emitter({ id: 4, serial: 12 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 3);
        });

        it('throws up a splash from the water behind a hard-dropped piece', () => {
            const { director, sim, stage } = createDirector();
            const spec = {
                kind: 'splash', column: 0.8, row: 0.1, strength: 0.7, duration: 0.9,
            };
            const log = play(director, sim, [spec], { seconds: 0.8 });
            const screen = stage.screen(0.8, 0.1);
            const spot = stage.water(screen.x, screen.y);
            const thrown = sim.thrown();
            expect(thrown).toHaveLength(40 + 60 * 0.7);
            // Nothing on the frame it appears; all of it within about a fifth of a second.
            expect(log[0].spawned).toBe(0);
            expect(sum(log.filter((entry) => entry.age <= 0.24).map((entry) => entry.spawned))).toBe(thrown.length);
            for (const spark of thrown) {
                expect(Math.hypot(spark.x - spot.x, spark.z - spot.z)).toBeCloseTo(0.3, 9);
                expect(spark.y).toBe(0.08);
                expect(spark.vy).toBeGreaterThan(4);
                expect(spark.heat).toBe(0.5);
            }
            // It is on the lake in front of the bank, right of the board's axis like the piece.
            expect(goldenForestGroundHeight(spot.x, spot.z)).toBeLessThan(0);
            expect(spot.x).toBeGreaterThan(0);
            // A splash lays no force field of its own.
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            // A harder drop throws more light, higher.
            const soft = createDirector();
            play(soft.director, soft.sim, [{ ...spec, strength: 0.35 }], { seconds: 0.8 });
            expect(soft.sim.thrown()).toHaveLength(61);
            expect(mean(thrown.map((spark) => spark.vy)))
                .toBeGreaterThan(mean(soft.sim.thrown().map((spark) => spark.vy)));
        });
    });

    describe('line clears', () => {
        it('blows the jets out of both sides of the board over an opening window', () => {
            const { director, sim, stage } = createDirector();
            const log = play(director, sim, [{
                kind: 'clear', side: -1, row: 0.6, lines: 2, strength: 0.68, duration: 1.74,
            }, {
                kind: 'clear', side: 1, row: 0.6, lines: 2, strength: 0.68, duration: 1.74,
            }], { seconds: 1.2 });
            const thrown = sim.thrown();
            const left = thrown.filter((spark) => spark.vx < 0);
            const right = thrown.filter((spark) => spark.vx > 0);
            // 30 + 34 a line on each side, spread over half a second rather than thrown at once.
            expect(left).toHaveLength(98);
            expect(right).toHaveLength(98);
            expect(log[0].spawned).toBe(0);
            expect(Math.max(...log.map((entry) => entry.spawned))).toBeLessThanOrEqual(10);
            expect(sum(log.filter((entry) => entry.age <= 0.26).map((entry) => entry.spawned))).toBeGreaterThan(90);
            expect(sum(log.filter((entry) => entry.age <= 0.26).map((entry) => entry.spawned))).toBeLessThan(110);
            expect(sum(log.filter((entry) => entry.age > 0.51).map((entry) => entry.spawned))).toBe(0);

            const leftEdge = stage.edge(-1, 0.6, GOLDEN_FOREST_STAGE_DEPTH, new THREE.Vector3(), 0.02);
            const rightEdge = stage.edge(1, 0.6, GOLDEN_FOREST_STAGE_DEPTH, new THREE.Vector3(), 0.02);
            expect(leftEdge.x).toBeLessThan(0);
            expect(rightEdge.x).toBeGreaterThan(0);
            for (const [sparks, edge, side] of [[left, leftEdge, -1], [right, rightEdge, 1]]) {
                for (const spark of sparks) {
                    // Each side leaves from its own edge of the card, at the height of the rows.
                    expect(spark.x).toBeCloseTo(edge.x, 9);
                    expect(Math.abs(spark.z - edge.z)).toBeLessThanOrEqual(0.8);
                    expect(Math.abs(spark.y - edge.y)).toBeLessThanOrEqual(0.85 + 1e-9);
                    expect(spark.vx * side).toBeGreaterThan(5);
                }
                expect(mean(sparks.map((spark) => spark.y))).toBeCloseTo(edge.y, 0);
            }
            // A jet field on each side carries them on, pointing away from the board.
            const fields = log[10].fields.sort((a, b) => a.x - b.x);
            expect(fields).toEqual([
                {
                    kind: 'jet',
                    x: leftEdge.x - 1.5,
                    y: leftEdge.y,
                    z: leftEdge.z,
                    dx: -1,
                    dy: 0.12,
                    dz: 0,
                    radius: 5.4,
                    power: 18 * 0.68,
                },
                {
                    kind: 'jet',
                    x: rightEdge.x + 1.5,
                    y: rightEdge.y,
                    z: rightEdge.z,
                    dx: 1,
                    dy: 0.12,
                    dz: 0,
                    radius: 5.4,
                    power: 18 * 0.68,
                },
            ]);
            expect(log.filter((entry) => entry.age < 0.74).every((entry) => entry.fields.length === 2)).toBe(true);
            expect(log.filter((entry) => entry.age > 0.76).every((entry) => entry.fields.length === 0)).toBe(true);
        });

        it.each([[0.15], [0.5], [0.9]])('leaves at the height of the cleared rows (row %f)', (row) => {
            const { director, sim, stage } = createDirector();
            play(director, sim, [{
                kind: 'clear', side: 1, row, lines: 1, strength: 0.52, duration: 1.62,
            }], { seconds: 0.6 });
            const edge = stage.edge(1, row);
            const thrown = sim.thrown();
            expect(thrown).toHaveLength(64);
            expect(Math.abs(mean(thrown.map((spark) => spark.y)) - edge.y)).toBeLessThan(0.25);
            // And the stage's rows really are different heights.
            expect(stage.edge(1, 0.9).y - stage.edge(1, 0.15).y).toBeGreaterThan(4);
        });

        it('throws more for more lines and catches up when it first sees a clear late', () => {
            const total = (lines, firstAge = 0) => {
                const { director, sim } = createDirector();
                const spec = {
                    kind: 'clear', side: 1, lines, strength: 0.5, duration: 2,
                };
                const counts = [];
                for (let age = firstAge; age < 1; age += STEP) {
                    const before = sim.spawn.mock.calls.length;
                    director.apply(frameWith([emitter({ ...spec, age })]), STEP);
                    counts.push(sim.spawn.mock.calls.length - before);
                }
                return counts;
            };
            expect([1, 2, 3, 4].map((lines) => sum(total(lines)))).toEqual([64, 98, 132, 166]);
            // Lines of zero or nonsense count as one.
            expect(sum(total(0))).toBe(64);
            // First seen 0.3 s in (a slot recycled under load): the missed share comes at once.
            const late = total(2, 0.3);
            expect(late[0]).toBe(Math.floor(98 * 0.6));
            expect(sum(late)).toBe(98);
        });

        it('breathes sparks up off open water only for a rising lake', () => {
            for (const aspect of [LANDSCAPE, PORTRAIT]) {
                const { director, sim, stage } = createDirector({ aspect });
                const log = play(director, sim, [{
                    kind: 'rise', row: 0, strength: 1, lines: 4, duration: 2.8,
                }], { seconds: 2 });
                const thrown = sim.thrown();
                // 520 tries over a second and a half; the ones that fell on a bank were let go.
                expect(director.emitted.get(0)).toBe(520);
                expect(thrown.length).toBeGreaterThan(300);
                expect(thrown.length).toBeLessThan(520);
                expect(sum(log.filter((entry) => entry.age > 1.52).map((entry) => entry.spawned))).toBe(0);
                const reach = stage.halfWidth(GOLDEN_FOREST_STAGE_DEPTH + 6);
                for (const spark of thrown) {
                    expect(goldenForestGroundHeight(spark.x, spark.z)).toBeLessThan(0);
                    expect(spark.y).toBe(0.08);
                    expect(spark.vy).toBeGreaterThan(1.3);
                    // Within sight of the board and out in front of the camera's bank.
                    expect(Math.abs(spark.x)).toBeLessThanOrEqual(reach + 1e-9);
                    expect(spark.z).toBeLessThanOrEqual(stage.origin.z - 3);
                    expect(spark.life).toBeGreaterThanOrEqual(2.6);
                }
                expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            }
        });

        it('lets nothing rise where there is no water, and less for a weaker breath', () => {
            const land = createDirector({ groundHeight: () => 0.8 });
            play(land.director, land.sim, [{
                kind: 'rise', row: 0, strength: 1, duration: 2.8,
            }], { seconds: 2 });
            expect(land.sim.spawn).not.toHaveBeenCalled();
            // The schedule still ran: it was the ground that refused them.
            expect(land.director.emitted.get(0)).toBe(520);
            const shoreline = createDirector({ groundHeight: () => 0 });
            play(shoreline.director, shoreline.sim, [{
                kind: 'rise', row: 0, strength: 1, duration: 2.8,
            }], { seconds: 2 });
            expect(shoreline.sim.spawn).not.toHaveBeenCalled();

            const lake = () => -2;
            const full = createDirector({ groundHeight: lake });
            const half = createDirector({ groundHeight: lake });
            play(full.director, full.sim, [{
                kind: 'rise', row: 0, strength: 1, duration: 2.8,
            }], { seconds: 2 });
            play(half.director, half.sim, [{
                kind: 'rise', row: 0, strength: 0.5, duration: 2.8,
            }], { seconds: 2 });
            expect(full.sim.spawn).toHaveBeenCalledTimes(520);
            expect(half.sim.spawn).toHaveBeenCalledTimes(260);
        });
    });

    describe('combos, spins and the river', () => {
        it('throws one ring of sparks around the board for a fresh combo, already turning', () => {
            const { director, sim, stage } = createDirector();
            const spec = {
                kind: 'combo', strength: 0.6, lines: 5, duration: 1.4,
            };
            const env = director.apply(frameWith([emitter(spec)]), STEP);
            const centre = stage.centre();
            const thrown = sim.thrown();
            expect(thrown).toHaveLength(Math.round(20 + 60 * 0.6));
            const angles = new Set();
            for (const spark of thrown) {
                const dx = spark.x - centre.x;
                const dz = spark.z - centre.z;
                const radius = Math.hypot(dx, dz);
                expect(radius).toBeGreaterThanOrEqual(2.7 - 1e-9);
                expect(radius).toBeLessThan(3.7);
                // Tangential, counter-clockwise seen from above, at about the river's own rate.
                expect(dx * spark.vx + dz * spark.vz).toBeCloseTo(0, 9);
                const turning = (dx * spark.vz - dz * spark.vx) / (radius * radius);
                expect(turning).toBeGreaterThan((1.2 + 1.8 * 0.6) * 0.85 - 1e-9);
                expect(turning).toBeLessThan((1.2 + 1.8 * 0.6) * 1.15);
                expect(spark.vy).toBeGreaterThan(0);
                const floor = Math.max(0, goldenForestGroundHeight(spark.x, spark.z));
                expect(spark.y).toBeGreaterThanOrEqual(floor + 0.15 - 1e-9);
                angles.add(Math.round((Math.atan2(dz, dx) / Math.PI) * 4));
            }
            // All the way round, not a clump.
            expect(angles.size).toBeGreaterThanOrEqual(8);
            // The combo emitter itself lays no field: the river is the frame's vortex.
            expect(env.fields).toEqual([]);
            director.apply(frameWith([emitter({ ...spec, age: 0.2 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(thrown.length);
        });

        it.each([[-1], [1]])('spins a small vortex beside the card for a t-spin on side %i', (side) => {
            const { director, sim, stage } = createDirector();
            const spec = {
                kind: 'spin', side, row: 0.5, strength: 0.8, duration: 1.7,
            };
            const log = play(director, sim, [spec], { seconds: 1.5 });
            const edge = stage.edge(side, 0.5, GOLDEN_FOREST_STAGE_DEPTH, new THREE.Vector3(), 0.01);
            const thrown = sim.thrown();
            expect(thrown).toHaveLength(44);
            expect(log[0].spawned).toBe(44);
            for (const spark of thrown) {
                // Two metres out from the edge, on the piece's side of the board.
                expect(spark.x).toBeCloseTo(edge.x + side * 2, 9);
                expect(spark.z).toBeCloseTo(edge.z, 9);
                expect(Math.abs(spark.y - edge.y)).toBeLessThanOrEqual(0.3);
                expect(spark.heat).toBe(0.6);
            }
            expect(mean(thrown.map((spark) => spark.vx)) * side).toBeGreaterThan(1.5);
            expect(log[5].fields).toEqual([{
                kind: 'vortex',
                x: edge.x + side * 2,
                z: edge.z,
                radius: 1.2,
                reach: 3.4,
                top: edge.y + 2.5,
                spin: 4.4,
                turn: side,
                grip: 3,
                pull: 12,
                lift: 2,
            }]);
            expect(log.filter((entry) => entry.age < 1.09).every((entry) => entry.fields.length === 1)).toBe(true);
            expect(log.filter((entry) => entry.age > 1.11).every((entry) => entry.fields.length === 0)).toBe(true);
        });

        it('turns the frame vortex into one column around the board only above its threshold', () => {
            const { director, sim, stage } = createDirector();
            const centre = stage.centre();
            for (const vortex of [0, 0.01, 0.03, -1, NaN, Infinity, undefined, null, 'high']) {
                const env = director.apply(frameWith([], { vortex }), STEP);
                expect(env.fields, String(vortex)).toEqual([]);
                expect(director.vortexFeed).toBe(0);
            }
            expect(sim.spawn).not.toHaveBeenCalled();
            for (const vortex of [0.031, 0.25, 0.6, 1]) {
                const env = director.apply(frameWith([], { vortex }), 0);
                expect(env.fields).toHaveLength(1);
                const [field] = env.fields;
                expect(field).toMatchObject({
                    kind: 'vortex', x: centre.x, z: centre.z, reach: 8, turn: 1, grip: 3, pull: 9,
                });
                expect(field.radius).toBeCloseTo(2.8 + 0.8 * vortex, 12);
                expect(field.top).toBeCloseTo(2.2 + 6.5 * vortex, 12);
                expect(field.spin).toBeCloseTo(1.2 + 1.8 * vortex, 12);
                expect(field.lift).toBeCloseTo(1 + 2 * vortex, 12);
                // The orbit clears the card: wider than the board is at that depth.
                expect(field.radius).toBeGreaterThan(stage.edge(1, 0.5).x - centre.x);
            }
            // Past full strength it is simply full strength.
            expect(director.apply(frameWith([], { vortex: 7 }), 0).fields[0].radius).toBeCloseTo(3.6, 12);
            // It comes on top of whatever the emitters laid down.
            const env = director.apply(frameWith([emitter({ kind: 'clear', age: 0.1 })], { vortex: 0.5 }), 0);
            expect(env.fields.map((field) => field.kind)).toEqual(['jet', 'vortex']);
        });

        it('keeps feeding the river while it turns, at a rate that follows time and strength', () => {
            const fed = (vortex, seconds, dt = STEP) => {
                const { director, sim, stage } = createDirector();
                // A frozen clock still gets its frames: two seconds' worth at 60 Hz.
                const frames = dt > 0 ? Math.round(seconds / dt) : Math.round(seconds * 60);
                for (let step = 0; step < frames; step++) director.apply(frameWith([], { vortex }), dt);
                return {
                    count: sim.spawn.mock.calls.length, thrown: sim.thrown(), centre: stage.centre(), director,
                };
            };
            // 30 a second when it has barely begun, 120 a second in full spate.
            expect(fed(1, 2).count).toBeGreaterThanOrEqual(239);
            expect(fed(1, 2).count).toBeLessThanOrEqual(240);
            expect(fed(0.5, 2).count).toBeGreaterThanOrEqual(149);
            expect(fed(0.5, 2).count).toBeLessThanOrEqual(150);
            expect(fed(0.04, 2).count).toBeGreaterThanOrEqual(66);
            expect(fed(0.04, 2).count).toBeLessThanOrEqual(67);
            // Frame rate does not change how many are fed.
            expect(Math.abs(fed(1, 2, 1 / 30).count - fed(1, 2, 1 / 144).count)).toBeLessThanOrEqual(1);
            // Nothing is fed on a frozen frame or below the threshold.
            expect(fed(1, 2, 0).count).toBe(0);
            expect(fed(0.03, 2).count).toBe(0);
            const river = fed(1, 1);
            for (const spark of river.thrown) {
                const radius = Math.hypot(spark.x - river.centre.x, spark.z - river.centre.z);
                expect(radius).toBeGreaterThanOrEqual(2.7 - 1e-9);
                expect(radius).toBeLessThan(3.7);
            }
            // When the river drops away, the fraction of a spark it owed is forgotten.
            river.director.apply(frameWith([], { vortex: 1 }), 0.004);
            expect(river.director.vortexFeed).toBeGreaterThan(0);
            river.director.apply(frameWith([], { vortex: 0 }), STEP);
            expect(river.director.vortexFeed).toBe(0);
        });
    });

    describe('environment', () => {
        it('reports the wind it is given and the envelopes of the frame', () => {
            const { director } = createDirector();
            const env = director.apply(frameWith([], { gust: 0.4, glow: 0.7, heat: 0.3 }), STEP, { x: 0.6, z: -0.8 });
            expect(env).toMatchObject({
                windX: 0.6, windZ: -0.8, gust: 0.4, glow: 0.7, heat: 0.3, settled: false, front: null,
            });
            // No wind given: a breeze from the west.
            expect(director.apply(frameWith(), STEP)).toMatchObject({ windX: 1, windZ: 0 });
            // The gust is bounded; nonsense reads as calm.
            expect(director.apply(frameWith([], { gust: 9 }), STEP).gust).toBe(1);
            expect(director.apply(frameWith([], { gust: -3 }), STEP).gust).toBe(0);
            for (const junk of [NaN, Infinity, undefined, null, 'windy']) {
                const calm = director.apply(frameWith([], { gust: junk, glow: junk, heat: junk }), STEP);
                expect(calm).toMatchObject({ gust: 0, glow: 0, heat: 0 });
            }
            // Only a strict `true` settles the lake.
            expect(director.apply(frameWith([], { settled: true }), STEP).settled).toBe(true);
            for (const junk of [1, 'true', {}, null, undefined]) {
                expect(director.apply(frameWith([], { settled: junk }), STEP).settled).toBe(false);
            }
        });

        it('maps the wind front to world x across the far shore, in the direction the frame gives it', () => {
            const { director, stage } = createDirector();
            const span = stage.halfWidth(60);
            const at = (front) => director.apply(frameWith([], { front }), STEP).front;
            expect(at({ position: -1.4, direction: 1, strength: 0.5 })).toMatchObject({
                x: -1.4 * span, direction: 1, strength: 0.5,
            });
            expect(at({ position: 0.7, direction: -1, strength: 0.9 })).toMatchObject({
                x: 0.7 * span, direction: -1, strength: 0.9,
            });
            expect(at({ position: 0, direction: 1, strength: 1 }).x).toBe(0);
            // A front that has not swelled yet, or has gone, is no front.
            expect(at({ position: -1.4, direction: 1, strength: 0 })).toBeNull();
            expect(at({ position: 0.2, direction: 1, strength: 0.001 })).toBeNull();
            expect(at(null)).toBeNull();
            expect(at(undefined)).toBeNull();
            // With real reactions: it crosses from one side of the view to the other.
            const reactions = new GoldenForestReactions({ rng: seededRandom(1) });
            reactions.onLineClear(3);
            const xs = [];
            for (let step = 0; step < 140; step++) {
                const front = at(reactions.update(STEP).front);
                if (front) xs.push(front.x);
            }
            expect(xs.length).toBeGreaterThan(100);
            expect(xs[0]).toBeLessThan(-span);
            expect(xs.at(-1)).toBeGreaterThan(span);
            for (let index = 1; index < xs.length; index++) expect(xs[index]).toBeGreaterThan(xs[index - 1]);
        });

        it('reuses one environment object and one field list between frames', () => {
            const { director } = createDirector();
            const first = director.apply(frameWith([emitter()], {
                vortex: 0.5, front: { position: 0, direction: 1, strength: 0.5 },
            }), 0);
            const { fields, front } = first;
            expect(fields.map((field) => field.kind)).toEqual(['burst', 'vortex']);
            const second = director.apply(frameWith([], {
                front: { position: 0.5, direction: 1, strength: 0.5 },
            }), STEP);
            expect(second).toBe(first);
            expect(second.fields).toBe(fields);
            expect(second.front).toBe(front);
            // Last frame's fields are gone, not accumulated.
            expect(second.fields).toEqual([]);
        });
    });

    describe('lifecycle and scale', () => {
        it('drops what is in flight on reset, and replays nothing the reactions still hold', () => {
            const { director, sim, added } = createDirector();
            const twin = createDirector();
            const session = (seed) => {
                const reactions = new GoldenForestReactions({ rng: seededRandom(seed) });
                reactions.onPieceLock({ piece: { x: 1, y: 20, shape: [[1]] } });
                reactions.onLineClear(2, { clearedRows: [22, 23] });
                reactions.onCombo(8);
                reactions.onTSpin();
                return reactions;
            };
            const reactions = session(1);
            const shadow = session(1);
            for (let step = 0; step < 6; step++) {
                director.apply(reactions.update(STEP), STEP);
                twin.director.apply(shadow.update(STEP), STEP);
            }
            const thrown = sim.spawn.mock.calls.length;
            expect(thrown).toBeGreaterThan(40);
            expect(added).toHaveBeenCalledTimes(5);
            expect(director.fields.map((field) => field.kind).sort())
                .toEqual(['burst', 'jet', 'jet', 'vortex', 'vortex']);
            expect(director.vortexFeed).toBeGreaterThan(0);
            expect(director.fishClock).toBeLessThan(3);

            director.reset();
            expect(director.fields).toEqual([]);
            expect(director.vortexFeed).toBe(0);
            // The next fish is three seconds off again.
            expect(director.fishClock).toBe(3);
            // What has been played is not forgotten: the reactions were not reset, so their
            // five rings are still queued and their five emitters are still in mid-flight.
            expect(director.epoch).toBe(1);
            expect(director.ringSerial).toBe(4);
            expect(director.serials.size).toBe(5);
            const held = reactions.getFrame();
            expect(held.rings.filter((entry) => entry.serial >= 0)).toHaveLength(5);
            expect(held.emitters.map((entry) => entry.kind)).toEqual(['lock', 'clear', 'clear', 'combo', 'spin']);
            director.apply(held, 0);
            director.apply(held, 0);
            // No ring is dropped a second time, no puff, ring of sparks or spiral is thrown again.
            expect(added).toHaveBeenCalledTimes(5);
            expect(sim.spawn).toHaveBeenCalledTimes(thrown);
            // And the jets go on from where they were, not from the start of their window:
            // a second on, it has thrown what a director that was never reset has thrown,
            // give or take the fraction of a spark the reset let go of.
            for (let step = 0; step < 60; step++) {
                director.apply(reactions.update(STEP), STEP);
                twin.director.apply(shadow.update(STEP), STEP);
            }
            expect(sim.spawn.mock.calls.length).toBeGreaterThan(thrown + 50);
            expect(Math.abs(sim.spawn.mock.calls.length - twin.sim.spawn.mock.calls.length)).toBeLessThanOrEqual(1);
            expect(added).toHaveBeenCalledTimes(5);
        });

        it('forgets what it has played only when the frames come from a new epoch', () => {
            const { director, sim, added } = createDirector();
            const frame = (epoch) => frameWith([emitter({ id: 0, serial: 0 }),
                emitter({ id: 1, serial: 1, kind: 'combo' }),
                emitter({
                    id: 2, serial: 2, kind: 'clear', age: 0.2,
                })], { epoch, rings: [ring(0), ring(1, 0.2, 0.5, 2)] });
            director.apply(frame(1), 0);
            const once = sim.spawn.mock.calls.length;
            expect(once).toBeGreaterThan(0);
            expect(added).toHaveBeenCalledTimes(2);
            director.apply(frame(1), 0);
            director.reset();
            director.apply(frame(1), 0);
            expect(sim.spawn).toHaveBeenCalledTimes(once);
            expect(added).toHaveBeenCalledTimes(2);
            expect(director.epoch).toBe(1);
            // A new session starts its serials at zero again: the same numbers must play again.
            director.apply(frame(2), 0);
            expect(director.epoch).toBe(2);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 2);
            expect(added).toHaveBeenCalledTimes(4);
            director.apply(frame(2), 0);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 2);
            expect(added).toHaveBeenCalledTimes(4);
            // follow() is the whole of it: the same epoch changes nothing, another clears the count.
            director.follow(2);
            expect(director.ringSerial).toBe(1);
            expect(director.serials.size).toBe(3);
            director.follow(3);
            expect(director.epoch).toBe(3);
            expect(director.ringSerial).toBe(-1);
            expect(director.serials.size).toBe(0);
            expect(director.emitted.size).toBe(0);
        });

        it('treats a timestep that is not a number as no time at all', () => {
            const odd = createDirector({ seed: 5 });
            const sound = createDirector({ seed: 5 });
            // Regression: one NaN used to stop the fish for the rest of the session and
            // starve the river for as long as it stayed up.
            for (const dt of [NaN, Infinity, -Infinity, undefined, null, 'soon', -5]) {
                const env = odd.director.apply(frameWith([], { vortex: 1 }), dt);
                expect(odd.director.fishClock).toBe(3);
                expect(odd.director.vortexFeed).toBe(0);
                expect(env.fields.map((field) => field.kind)).toEqual(['vortex']);
            }
            expect(odd.sim.spawn).not.toHaveBeenCalled();
            expect(odd.added).not.toHaveBeenCalled();
            // From there it runs exactly like a director that never saw one: the river is fed
            // at the same rate, and the fish rise at the same moments in the same places.
            for (const { director } of [odd, sound]) {
                for (let step = 0; step < 120; step++) director.apply(frameWith([], { vortex: 1 }), STEP);
                for (let step = 0; step < 30 * 60; step++) director.apply(frameWith(), STEP);
            }
            expect(odd.sim.spawn.mock.calls.length).toBeGreaterThanOrEqual(239);
            expect(odd.sim.spawn.mock.calls).toEqual(sound.sim.spawn.mock.calls);
            expect(odd.added.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(odd.added.mock.calls).toEqual(sound.added.mock.calls);
            expect(Number.isFinite(odd.director.fishClock)).toBe(true);
            // A NaN in the middle of a turning river costs it nothing either.
            odd.director.apply(frameWith([], { vortex: 1 }), 0.004);
            const owed = odd.director.vortexFeed;
            expect(owed).toBeGreaterThan(0);
            odd.director.apply(frameWith([], { vortex: 1 }), NaN);
            expect(odd.director.vortexFeed).toBe(owed);
        });

        it('scales every throw with the firefly budget of the tier, down to a floor', () => {
            const thrown = (sparks, kind) => {
                const { director, sim } = createDirector({ sparks, groundHeight: () => -2 });
                play(director, sim, [{
                    kind, strength: 0.8, lines: 4, duration: 3,
                }], { seconds: 2 });
                return sim.spawn.mock.calls.length;
            };
            for (const kind of ['lock', 'splash', 'clear', 'rise', 'spin', 'combo']) {
                const counts = ['Minimal', 'Medium', 'High', 'Extreme']
                    .map((tier) => thrown(GOLDEN_FOREST_TIERS[tier].sparks, kind));
                expect(counts[0], kind).toBeGreaterThan(0);
                for (let index = 1; index < counts.length; index++) {
                    expect(counts[index], kind).toBeGreaterThan(counts[index - 1]);
                }
            }
            // High is the reference; a tier is never scaled below a fifth of it.
            expect(createDirector({ sparks: REFERENCE_SPARKS }).director.scale).toBe(1);
            expect(createDirector({ sparks: GOLDEN_FOREST_TIERS.Extreme.sparks }).director.scale)
                .toBeCloseTo(3400 / 2200, 12);
            expect(createDirector({ sparks: 420 }).director.scale).toBe(0.2);
            expect(createDirector({ sparks: 1 }).director.scale).toBe(0.2);
            expect(thrown(1, 'clear')).toBe(thrown(440, 'clear'));
            const feed = (sparks) => {
                const { director, sim } = createDirector({ sparks });
                for (let step = 0; step < 120; step++) director.apply(frameWith([], { vortex: 0.8 }), STEP);
                return sim.spawn.mock.calls.length;
            };
            expect(feed(GOLDEN_FOREST_TIERS.Extreme.sparks)).toBeGreaterThan(feed(GOLDEN_FOREST_TIERS.High.sparks));
            expect(feed(GOLDEN_FOREST_TIERS.High.sparks)).toBeGreaterThan(feed(GOLDEN_FOREST_TIERS.Minimal.sparks));
            expect(feed(GOLDEN_FOREST_TIERS.Minimal.sparks)).toBeGreaterThan(0);
        });

        it('ignores frames and emitters it does not understand', () => {
            const { director, sim, added } = createDirector();
            for (const frame of [undefined, {}, { emitters: null }, { emitters: [] }, { emitters: 'lock' },
                frameWith([emitter({ kind: 'confetti' }), emitter({ id: 1, serial: 1, kind: undefined })]),
                frameWith([emitter({ kind: 'shower' })])]) {
                expect(() => director.apply(frame, STEP)).not.toThrow();
            }
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(added).not.toHaveBeenCalled();
            expect(director.fields).toEqual([]);
        });

        it('keeps a broken random source inside its range', () => {
            for (const rng of [() => NaN, () => Infinity, () => -5, () => 7, () => undefined]) {
                const { director, sim } = createDirector({ rng, groundHeight: () => -2 });
                play(director, sim, [{ kind: 'lock' }, { kind: 'clear', lines: 2 }, { kind: 'rise', strength: 1 },
                    { kind: 'spin' }, { kind: 'combo' }, { kind: 'splash' }], { seconds: 1, frame: { vortex: 1 } });
                expect(sim.spawn.mock.calls.length).toBeGreaterThan(100);
                for (const args of sim.spawn.mock.calls) expect(args.every(Number.isFinite)).toBe(true);
            }
        });
    });

    describe('with the real simulation', () => {
        function session({ sparks = GOLDEN_FOREST_TIERS.Medium.sparks, quality = 'Medium' } = {}) {
            const camera = frameCamera();
            const stage = new GoldenForestStage(camera);
            const sim = new GoldenForestSparkSim({
                count: sparks,
                reserve: Math.round(sparks * 0.62),
                rng: seededRandom(2),
                groundHeight: goldenForestGroundHeight,
            });
            const ripples = new GoldenForestRipples(8);
            const added = vi.spyOn(ripples, 'add');
            const director = new GoldenForestSparkDirector({
                stage, sim, ripples, tier: { sparks }, rng: seededRandom(5), groundHeight: goldenForestGroundHeight,
            });
            const reactions = new GoldenForestReactions({ quality, rng: seededRandom(6) });
            const step = () => {
                const frame = reactions.update(STEP);
                const env = director.apply(frame, STEP, { x: 0.92, z: 0.39 });
                sim.step(STEP, env);
                ripples.update(STEP);
                return { frame, env };
            };
            const lit = () => {
                const result = [];
                for (let index = sim.ambient; index < sim.count; index++) {
                    if (sim.life[index] > 0) result.push({ x: sim.x[index], y: sim.y[index], z: sim.z[index] });
                }
                return result;
            };
            return {
                stage, sim, ripples, added, director, reactions, step, lit,
            };
        }

        it.each([
            [1, -1], [8, 1],
        ])('puts the sparks of a lock in column %i in the air on side %i of the board', (column, side) => {
            const {
                reactions, step, lit, stage, ripples, sim,
            } = session();
            reactions.onPieceLock({ piece: { x: column, y: 14, shape: [[1]] } });
            for (let frame = 0; frame < 12; frame++) step();
            const sparks = lit();
            expect(sparks.length).toBeGreaterThan(5);
            const centre = stage.centre();
            for (const spark of sparks) expect((spark.x - centre.x) * side).toBeGreaterThan(1);
            expect(ripples.active()).toBe(1);
            expect(sim.counts().live).toBe(sparks.length);
        });

        it('winds a combo into a river around the board and holds it there', () => {
            const {
                reactions, step, lit, stage, sim,
            } = session();
            reactions.onCombo(12);
            const centre = stage.centre();
            const radii = [];
            let furthest = 0;
            let fieldRadius = 0;
            for (let frame = 0; frame < 150; frame++) {
                const { env } = step();
                if (frame % 30 === 29) reactions.onCombo(12);
                const river = env.fields.find((field) => field.kind === 'vortex');
                fieldRadius = river.radius;
                const distances = lit().map((spark) => Math.hypot(spark.x - centre.x, spark.z - centre.z));
                furthest = Math.max(furthest, ...distances);
                if (frame >= 60) radii.push(mean(distances));
            }
            expect(sim.counts().live).toBeGreaterThan(100);
            // The river runs on the field's radius, a little outside the card ...
            expect(fieldRadius).toBeGreaterThan(3.4);
            for (const radius of radii) expect(Math.abs(radius - fieldRadius)).toBeLessThan(1);
            // ... and no spark was flung clear of it.
            expect(furthest).toBeLessThan(fieldRadius + 2.5);
        });

        it('settles the fireflies onto the lake at game over, each leaving its ring', () => {
            const {
                reactions, step, lit, sim, added,
            } = session({ sparks: GOLDEN_FOREST_TIERS.Minimal.sparks, quality: 'Minimal' });
            reactions.onPieceLock({ piece: { x: 1, y: 20, shape: [[1]] } });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(9);
            for (let frame = 0; frame < 120; frame++) step();
            const playing = lit();
            expect(playing.length).toBeGreaterThan(80);
            const height = mean(playing.map((spark) => spark.y));
            const ringsBefore = added.mock.calls.length;

            reactions.onGameOver();
            const { env } = step();
            expect(env.settled).toBe(true);
            for (let frame = 0; frame < 90; frame++) step();
            // A second and a half on they are sinking, and fewer.
            const sinking = lit();
            expect(sinking.length).toBeLessThan(playing.length);
            expect(mean(sinking.map((spark) => spark.y))).toBeLessThan(height);
            for (let frame = 0; frame < 400; frame++) step();
            expect(sim.counts().live).toBe(0);
            // The ones that reached the water rang it, a few at a time: small rings, on the lake.
            const settled = added.mock.calls.slice(ringsBefore);
            expect(settled.length).toBeGreaterThan(3);
            for (const [x, z, strength] of settled) {
                expect(strength).toBeGreaterThanOrEqual(0.16);
                expect(strength).toBeLessThanOrEqual(0.26);
                expect(goldenForestGroundHeight(x, z)).toBeLessThan(0);
            }
            // The ambient fireflies are untouched by any of it.
            expect(sim.counts()).toEqual({
                ambient: sim.ambient, reserve: sim.reserve, live: 0,
            });
            // A new game wakes the lake: the next lock flies again.
            reactions.onPieceLock({ piece: { x: 1, y: 20, shape: [[1]] } });
            expect(step().env.settled).toBe(false);
            expect(sim.counts().live).toBeGreaterThan(0);
        });
    });
});
