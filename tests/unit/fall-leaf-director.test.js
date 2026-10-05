import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { fallViewFor } from '../../src/themes/fall/fall-composition.js';
import { FallLeafDirector } from '../../src/themes/fall/fall-leaf-director.js';
import { FallLeafSim, LEAF_AIR } from '../../src/themes/fall/fall-leaf-sim.js';
import { FALL_TIERS } from '../../src/themes/fall/fall-quality.js';
import { FallReactions } from '../../src/themes/fall/fall-reactions.js';
import {
    FALL_DEFAULT_BOARD, FALL_STAGE_DEPTH, FallStage, readFallBoardRect,
} from '../../src/themes/fall/fall-stage.js';
import { fallTerrainHeight } from '../../src/themes/fall/fall-terrain.js';

const LANDSCAPE = 16 / 9;
const PORTRAIT = 9 / 19.5;
const STEP = 1 / 60;

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** The camera as FallWorld.prepareCamera() frames it for an aspect ratio. */
function frameCamera(aspect = LANDSCAPE) {
    const view = fallViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 600);
    camera.position.set(view.position[0], view.position[1] + fallTerrainHeight(0, view.position[2]), view.position[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateProjectionMatrix();
    return camera;
}

/** An arbitrary pose with yaw, pitch and roll, to prove the maths is not tied to the grove's view. */
function tiltedCamera() {
    const camera = new THREE.PerspectiveCamera(38, 1.3, 0.1, 500);
    camera.position.set(4, 7, -3);
    camera.rotation.set(0.4, -1.1, 0.25, 'YXZ');
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

function frameWith(emitters = [], rest = {}) {
    return {
        gust: 0, warmth: 0, shafts: 0, glow: 0, vortex: 0, heat: 0, streak: 0, front: null, emitters, ...rest,
    };
}

function spySim() {
    const sim = { spawn: vi.fn(() => 0) };
    sim.thrown = () => sim.spawn.mock.calls.map(([x, y, z, vx, vy, vz]) => ({
        x, y, z, vx, vy, vz,
    }));
    return sim;
}

function createDirector({
    aspect = LANDSCAPE, leaves = 2600, seed = 187, sim = spySim(), ...options
} = {}) {
    const camera = frameCamera(aspect);
    const stage = new FallStage(camera);
    const director = new FallLeafDirector({
        stage, sim, tier: { leaves }, rng: seededRandom(seed), groundHeight: fallTerrainHeight, ...options,
    });
    return {
        camera, stage, sim, director,
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

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Fall stage', () => {
    it.each([
        ['the landscape grove view', () => frameCamera(LANDSCAPE)],
        ['the portrait grove view', () => frameCamera(PORTRAIT)],
        ['an arbitrary tilted camera', tiltedCamera],
    ])('maps screen fractions onto a plane in front of %s', (_label, makeCamera) => {
        const camera = makeCamera();
        const stage = new FallStage(camera);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        for (const depth of [1, FALL_STAGE_DEPTH, 40]) {
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
        expectVector(stage.point(0.3, 0.6), stage.point(0.3, 0.6, FALL_STAGE_DEPTH));
        const target = new THREE.Vector3(9, 9, 9);
        expect(stage.point(0.3, 0.6, 5, target)).toBe(target);
        expectVector(target, stage.point(0.3, 0.6, 5));
    });

    it.each([
        ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
    ])('finds the card edges, its centre and its rows in %s', (_label, aspect) => {
        const camera = frameCamera(aspect);
        const stage = new FallStage(camera);
        expect(stage.board).toEqual(FALL_DEFAULT_BOARD);
        const {
            x0, x1, y0, y1,
        } = stage.board;
        for (const row of [0, 0.25, 0.5, 1]) {
            const left = stage.edge(-1, row);
            const right = stage.edge(1, row);
            expect(left.x).toBeLessThan(right.x);
            expect(left.y).toBeCloseTo(right.y, 9);
            expect(ndc(left, camera).x).toBeCloseTo(x0 * 2 - 1, 9);
            expect(ndc(right, camera).x).toBeCloseTo(x1 * 2 - 1, 9);
            // Row 0 is the foot of the card, row 1 its top.
            expect(ndc(left, camera).y).toBeCloseTo(1 - (y1 + (y0 - y1) * row) * 2, 9);
        }
        for (const side of [-1, 1]) {
            const heights = [0, 0.3, 0.6, 1].map((row) => stage.edge(side, row).y);
            expect([...heights].sort((a, b) => a - b)).toEqual(heights);
            expect(new Set(heights).size).toBe(heights.length);
            // Rows outside the card clamp onto it.
            expectVector(stage.edge(side, 7), stage.edge(side, 1));
            expectVector(stage.edge(side, -7), stage.edge(side, 0));
            expectVector(stage.edge(side, 0.5), stage.edge(side, 0.5, FALL_STAGE_DEPTH));
        }
        // An inset moves the point onto the card from either edge.
        expect(stage.edge(-1, 0.5, 6, undefined, 0.02).x).toBeGreaterThan(stage.edge(-1, 0.5, 6).x);
        expect(stage.edge(1, 0.5, 6, undefined, 0.02).x).toBeLessThan(stage.edge(1, 0.5, 6).x);
        const centre = stage.centre();
        expectVector(centre, stage.edge(-1, 0.5).add(stage.edge(1, 0.5)).multiplyScalar(0.5));
        expectVector(stage.centre(12), stage.point((x0 + x1) / 2, (y0 + y1) / 2, 12));
        const target = new THREE.Vector3();
        expect(stage.edge(1, 0.2, 4, target)).toBe(target);
        expect(stage.centre(4, target)).toBe(target);
    });

    it('measures half the width of the view at a depth', () => {
        for (const camera of [frameCamera(LANDSCAPE), frameCamera(PORTRAIT), tiltedCamera()]) {
            const stage = new FallStage(camera);
            for (const depth of [2, FALL_STAGE_DEPTH, 26]) {
                const width = stage.point(0, 0.5, depth).distanceTo(stage.point(1, 0.5, depth));
                expect(stage.halfWidth(depth)).toBeCloseTo(width / 2, 9);
            }
            expect(stage.halfWidth()).toBe(stage.halfWidth(FALL_STAGE_DEPTH));
            expect(stage.halfWidth(20)).toBeCloseTo(stage.halfWidth(10) * 2, 9);
        }
        expect(new FallStage(frameCamera(LANDSCAPE)).halfWidth(10))
            .toBeGreaterThan(new FallStage(frameCamera(PORTRAIT)).halfWidth(10));
    });

    it('accepts a measured card, clamps it to the screen and falls back to the default for junk', () => {
        const camera = frameCamera();
        const stage = new FallStage(camera);
        const measured = {
            x0: 0.1, x1: 0.45, y0: 0.2, y1: 0.8,
        };
        stage.setBoard(measured);
        expect(stage.board).toEqual(measured);
        expect(stage.board).not.toBe(measured);
        measured.x0 = 0.9;
        expect(stage.board.x0).toBe(0.1);
        expect(ndc(stage.edge(-1, 0), camera).x).toBeCloseTo(0.1 * 2 - 1, 9);
        expect(ndc(stage.edge(1, 1), camera).y).toBeCloseTo(1 - 0.2 * 2, 9);
        // A card hanging off the screen is cut at the screen edge.
        stage.setBoard({
            x0: -0.2, x1: 0.5, y0: 0.1, y1: 1.3,
        });
        expect(stage.board).toEqual({
            x0: 0, x1: 0.5, y0: 0.1, y1: 1,
        });
        const junk = [null, undefined, 0, 'board', [], {}, { x0: 0.1, x1: 0.5, y0: 0.1 },
            {
                x0: NaN, x1: 0.5, y0: 0.1, y1: 0.9,
            },
            {
                x0: 0.1, x1: Infinity, y0: 0.1, y1: 0.9,
            },
            {
                x0: '0.1', x1: '0.5', y0: '0.1', y1: '0.9',
            },
            // Inside out, or too small to be a board.
            {
                x0: 0.6, x1: 0.4, y0: 0.1, y1: 0.9,
            },
            {
                x0: 0.4, x1: 0.6, y0: 0.9, y1: 0.1,
            },
            {
                x0: 0.5, x1: 0.52, y0: 0.1, y1: 0.9,
            },
            {
                x0: 0.4, x1: 0.6, y0: 0.5, y1: 0.55,
            }];
        for (const rect of junk) {
            stage.setBoard({
                x0: 0.1, x1: 0.45, y0: 0.2, y1: 0.8,
            });
            expect(() => stage.setBoard(rect)).not.toThrow();
            expect(stage.board).toEqual(FALL_DEFAULT_BOARD);
            expect(stage.board).not.toBe(FALL_DEFAULT_BOARD);
        }
        expect(Object.isFrozen(FALL_DEFAULT_BOARD)).toBe(true);
        expect(FALL_DEFAULT_BOARD.x1).toBeGreaterThan(FALL_DEFAULT_BOARD.x0);
        expect(FALL_DEFAULT_BOARD.y1).toBeGreaterThan(FALL_DEFAULT_BOARD.y0);
    });

    it('keeps the rest pose it read until it is refreshed', () => {
        const camera = frameCamera(LANDSCAPE);
        const stage = new FallStage(camera);
        const before = stage.centre();
        const width = stage.halfWidth();
        // Pointer parallax moves the camera every frame; the stage must not follow that.
        camera.position.x += 3;
        camera.position.y += 1;
        camera.rotation.y += 0.3;
        camera.fov = 70;
        camera.aspect = 1;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        expectVector(stage.centre(), before);
        expect(stage.halfWidth()).toBe(width);
        stage.refresh();
        expect(stage.centre().distanceTo(before)).toBeGreaterThan(1);
        expect(stage.halfWidth()).not.toBe(width);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        expectVector(stage.point(0.5, 0.5, 5), camera.position.clone().addScaledVector(forward, 5));
        expect(ndc(stage.point(0.25, 0.75, 5), camera).x).toBeCloseTo(-0.5, 9);
        expect(ndc(stage.point(0.25, 0.75, 5), camera).y).toBeCloseTo(-0.5, 9);
    });
});

describe('reading the board card from the page', () => {
    function card({
        left, top, width, height, style = {},
    }) {
        return {
            style,
            getBoundingClientRect: () => ({
                left, top, right: left + width, bottom: top + height, width, height,
            }),
        };
    }

    function page(cards, { width = 1000, height = 500, computed = true } = {}) {
        const selectors = [];
        return {
            selectors,
            doc: { querySelectorAll: (selector) => { selectors.push(selector); return cards; } },
            win: {
                innerWidth: width,
                innerHeight: height,
                ...(computed ? { getComputedStyle: (element) => element.style } : {}),
            },
        };
    }

    const solo = () => card({
        left: 400, top: 50, width: 200, height: 400,
    });

    it('measures a visible board card in screen fractions', () => {
        const { doc, win, selectors } = page([solo()]);
        expect(readFallBoardRect(doc, win)).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        // Gameplay boards carry data-player; the lobby's avatar cards reuse .player-card without it.
        expect(selectors).toEqual(['.player-card[data-player]']);
        // Without computed styles the rectangle alone decides.
        const plain = page([solo()], { computed: false });
        expect(readFallBoardRect(plain.doc, plain.win)).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
    });

    it('unites every visible card so several boards share one stage', () => {
        const { doc, win } = page([
            card({
                left: 100, top: 100, width: 200, height: 300,
            }),
            card({
                left: 650, top: 60, width: 250, height: 400,
            }),
            card({
                left: 380, top: 120, width: 180, height: 250,
            }),
        ]);
        expect(readFallBoardRect(doc, win)).toEqual({
            x0: 0.1, x1: 0.9, y0: 0.12, y1: 0.92,
        });
    });

    it('ignores hidden, collapsed and off-screen cards', () => {
        const ghosts = [
            card({
                left: 0, top: 0, width: 300, height: 300, style: { display: 'none' },
            }),
            card({
                left: 0, top: 0, width: 300, height: 300, style: { visibility: 'hidden' },
            }),
            card({
                left: 0, top: 0, width: 300, height: 300, style: { opacity: '0' },
            }),
            card({
                left: 0, top: 0, width: 300, height: 300, style: { opacity: '0.04' },
            }),
            // A card in a hidden mode container measures as an empty rectangle.
            card({
                left: 0, top: 0, width: 0, height: 0,
            }),
            card({
                left: 10, top: 10, width: 8, height: 400,
            }),
            card({
                left: 10, top: 10, width: 400, height: 8,
            }),
            card({
                left: -300, top: 50, width: 300, height: 300,
            }),
            card({
                left: 1000, top: 50, width: 300, height: 300,
            }),
            card({
                left: 100, top: -300, width: 300, height: 300,
            }),
            card({
                left: 100, top: 500, width: 300, height: 300,
            }),
            {},
            null,
            undefined,
        ];
        const empty = page(ghosts);
        expect(readFallBoardRect(empty.doc, empty.win)).toBeNull();
        const mixed = page([...ghosts, solo(), ...ghosts]);
        expect(readFallBoardRect(mixed.doc, mixed.win)).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        // A nearly opaque card that is still fading in counts.
        const fading = page([card({
            left: 400,
            top: 50,
            width: 200,
            height: 400,
            style: { opacity: '0.4', display: 'block', visibility: 'visible' },
        })]);
        expect(readFallBoardRect(fading.doc, fading.win)).not.toBeNull();
    });

    it('reports a card that hangs off the screen as it is and lets the stage clamp it', () => {
        const { doc, win } = page([card({
            left: -100, top: 50, width: 400, height: 600,
        })]);
        const rect = readFallBoardRect(doc, win);
        expect(rect).toEqual({
            x0: -0.1, x1: 0.3, y0: 0.1, y1: 1.3,
        });
        const stage = new FallStage(frameCamera());
        stage.setBoard(rect);
        expect(stage.board).toEqual({
            x0: 0, x1: 0.3, y0: 0.1, y1: 1,
        });
    });

    it('returns null when there is no page, no window or no board', () => {
        const { doc, win } = page([]);
        expect(readFallBoardRect(doc, win)).toBeNull();
        expect(readFallBoardRect(null, win)).toBeNull();
        expect(readFallBoardRect(doc, null)).toBeNull();
        expect(readFallBoardRect({}, win)).toBeNull();
        expect(readFallBoardRect({ querySelectorAll: 'nope' }, win)).toBeNull();
        // Vitest's node environment has neither global.
        expect(readFallBoardRect()).toBeNull();
    });

    it('never divides by an unknown window size', () => {
        for (const size of [0, undefined, NaN]) {
            const { doc, win } = page([solo()], { width: size, height: size });
            const rect = readFallBoardRect(doc, win);
            if (rect !== null) expect(Object.values(rect).every(Number.isFinite)).toBe(true);
        }
    });

    it('reads the live document and window by default', () => {
        const { doc, win } = page([solo()], { width: 2000, height: 1000 });
        vi.stubGlobal('document', doc);
        vi.stubGlobal('window', win);
        expect(readFallBoardRect()).toEqual({
            x0: 0.2, x1: 0.3, y0: 0.05, y1: 0.45,
        });
    });
});

describe('Fall leaf director', () => {
    describe('locks', () => {
        it.each([[-1], [1]])('throws a fresh puff once from the card edge on side %i, outward', (side) => {
            const { stage, sim, director } = createDirector();
            const lock = {
                kind: 'lock', side, row: 0.6, strength: 0.4,
            };
            const log = play(director, sim, [lock], { seconds: 1 });
            expect(log[0].spawned).toBeGreaterThan(3);
            // The serial has been played: later frames of the same emitter add nothing.
            expect(log.slice(1).every((entry) => entry.spawned === 0)).toBe(true);
            const edge = stage.edge(side, lock.row);
            const centre = stage.centre();
            for (const thrown of sim.thrown()) {
                expect(thrown.vx * side).toBeGreaterThan(0);
                expect((thrown.x - centre.x) * side).toBeGreaterThan(0);
                expect(Math.abs(thrown.x - edge.x)).toBeLessThan(1);
                expect(Math.abs(thrown.y - edge.y)).toBeLessThan(1);
                expect(Math.abs(thrown.z - edge.z)).toBeLessThan(1);
                expect(thrown.vy).toBeGreaterThan(0);
            }
            // A short thump: there at the lock, gone well before the emitter ends.
            expect(log[0].fields.length).toBeGreaterThan(0);
            for (const entry of log) {
                for (const field of entry.fields) {
                    expect(field.kind).toBe('burst');
                    expect((field.x - centre.x) * side).toBeGreaterThan(0);
                    expect(field.radius).toBeGreaterThan(0);
                    expect(field.power).toBeGreaterThan(0);
                    expect(field.up).toBeGreaterThan(0);
                }
            }
            const lastBurst = log.findLastIndex((entry) => entry.fields.length > 0);
            expect(log[lastBurst].age).toBeLessThan(0.75);
            expect(log.at(-1).fields).toEqual([]);
            // One of the bursts stirs the floor at the foot of the card.
            const lowest = Math.min(...log[0].fields.map((field) => field.y));
            expect(lowest).toBeLessThan(stage.edge(side, 0.25).y);
        });

        it('follows the height of the piece and throws harder for a stronger lock', () => {
            const thrownAt = (row, strength) => {
                const { sim, director, stage } = createDirector();
                const env = director.apply(frameWith([emitter({ row, strength })]), STEP);
                return {
                    leaves: sim.thrown(),
                    power: Math.max(...env.fields.map((field) => field.power)),
                    edge: stage.edge(-1, row),
                };
            };
            const low = thrownAt(0.1, 0.3);
            const high = thrownAt(0.9, 0.3);
            const hard = thrownAt(0.1, 0.9);
            const height = (puff) => mean(puff.leaves.map((thrown) => thrown.y));
            expect(height(high)).toBeGreaterThan(height(low) + 2);
            expect(Math.abs(height(high) - high.edge.y)).toBeLessThan(0.5);
            expect(hard.leaves.length).toBeGreaterThan(low.leaves.length);
            expect(hard.power).toBeGreaterThan(low.power);
            expect(mean(hard.leaves.map((thrown) => Math.abs(thrown.vx))))
                .toBeGreaterThan(mean(low.leaves.map((thrown) => Math.abs(thrown.vx))));
        });

        it('treats a reused slot with a new serial as a new event', () => {
            const { sim, director } = createDirector();
            director.apply(frameWith([emitter({ id: 3, serial: 7 })]), STEP);
            const once = sim.spawn.mock.calls.length;
            director.apply(frameWith([emitter({ id: 3, serial: 7, age: 0.02 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(once);
            director.apply(frameWith([emitter({ id: 3, serial: 8 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 2);
            // Two slots playing the same kind at once are tracked separately.
            director.apply(frameWith([emitter({ id: 3, serial: 8, age: 0.02 }), emitter({ id: 4, serial: 9 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 3);
        });
    });

    describe('line clears', () => {
        it('spreads the jets over an opening window, toward each side, with a jet field pointing outward', () => {
            const { stage, sim, director } = createDirector();
            const jets = [
                {
                    id: 0, serial: 0, kind: 'clear', side: -1, row: 0.3, strength: 0.7, lines: 2,
                },
                {
                    id: 1, serial: 1, kind: 'clear', side: 1, row: 0.3, strength: 0.7, lines: 2,
                },
            ];
            const log = play(director, sim, jets, { seconds: 1.9 });
            // Nothing is due at age zero; the leaves follow over the next frames and then stop.
            expect(log[0].spawned).toBe(0);
            const active = log.filter((entry) => entry.spawned > 0);
            expect(active.length).toBeGreaterThan(8);
            expect(active.at(-1).age).toBeLessThan(1);
            expect(Math.max(...active.map((entry) => entry.spawned))).toBeLessThan(sim.spawn.mock.calls.length / 4);
            const centre = stage.centre();
            const thrown = sim.thrown();
            const left = thrown.filter((entry) => entry.vx < 0);
            const right = thrown.filter((entry) => entry.vx > 0);
            expect(left.length).toBeGreaterThan(20);
            expect(left.length).toBe(right.length);
            for (const side of [-1, 1]) {
                const edge = stage.edge(side, 0.3);
                for (const entry of side < 0 ? left : right) {
                    expect((entry.x - centre.x) * side).toBeGreaterThan(0);
                    expect(Math.abs(entry.x - edge.x)).toBeLessThan(0.5);
                    expect(Math.abs(entry.y - edge.y)).toBeLessThan(1.5);
                    expect(Math.abs(entry.z - edge.z)).toBeLessThan(1.5);
                }
            }
            expect(log[0].fields).toHaveLength(2);
            for (const entry of log) {
                for (const field of entry.fields) {
                    expect(field.kind).toBe('jet');
                    const side = Math.sign(field.x - centre.x);
                    expect(field.dx).toBe(side);
                    expect(field.dz).toBe(0);
                    expect(field.dy).toBeGreaterThanOrEqual(0);
                    // The jet sits outside the card, pushing away from it.
                    expect(Math.abs(field.x - centre.x)).toBeGreaterThan(Math.abs(stage.edge(side, 0.3).x - centre.x));
                    expect(field.power).toBeGreaterThan(0);
                }
            }
            expect(log.at(-1).fields).toEqual([]);
        });

        it('throws more leaves for more lines and catches up when it first sees a clear late', () => {
            const total = (lines, firstAge = 0) => {
                const { sim, director } = createDirector();
                const jet = {
                    kind: 'clear', side: 1, row: 0.5, strength: 0.6, lines,
                };
                for (let age = firstAge; age < 1.5; age += STEP) {
                    director.apply(frameWith([emitter({ ...jet, age })]), STEP);
                }
                return sim.spawn.mock.calls.length;
            };
            expect(total(4)).toBeGreaterThan(total(2));
            expect(total(2)).toBeGreaterThan(total(1));
            expect(total(1)).toBeGreaterThan(0);
            expect(total(0)).toBe(total(1));
            // A hitch must not swallow the jet: the whole quota is still thrown.
            expect(total(2, 0.3)).toBe(total(2));
        });

        it('releases a shower from the crowns near the board and nowhere else', () => {
            const near = [[-12, 14, -6], [9, 11, 2], [0, 16, -20]];
            const far = [[40, 15, -10], [-30, 13, -4], [3, 12, -60]];
            const crownPoints = new Float32Array([...near, ...far].flatMap(([x, y, z], index) => [x, y, z, index % 3]));
            const { sim, director } = createDirector({ crownPoints });
            const shower = {
                kind: 'shower', side: 1, row: 1, strength: 1, lines: 4, duration: 2.6,
            };
            const log = play(director, sim, [shower], { seconds: 2.5 });
            expect(log[0].spawned).toBe(0);
            expect(log.filter((entry) => entry.spawned > 0).length).toBeGreaterThan(20);
            const thrown = sim.thrown();
            expect(thrown.length).toBeGreaterThan(100);
            const used = new Set();
            for (const entry of thrown) {
                const crown = near.findIndex(([x, , z]) => (
                    Math.abs(entry.x - x) <= 1.01 && Math.abs(entry.z - z) <= 1.01));
                expect(crown).toBeGreaterThanOrEqual(0);
                expect(entry.y).toBeLessThanOrEqual(near[crown][1]);
                expect(entry.vy).toBeLessThan(0);
                used.add(crown);
            }
            expect(used.size).toBe(near.length);
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
        });

        it('showers from above the board when it has no crowns, in proportion to its strength', () => {
            const shower = (strength) => {
                const { sim, director, stage } = createDirector();
                play(director, sim, [{ kind: 'shower', strength, duration: 3 }], { seconds: 2.9 });
                return { thrown: sim.thrown(), top: stage.edge(1, 1).y };
            };
            const full = shower(1);
            const half = shower(0.5);
            expect(full.thrown.length).toBeGreaterThan(100);
            expect(half.thrown.length).toBeGreaterThan(full.thrown.length * 0.4);
            expect(half.thrown.length).toBeLessThan(full.thrown.length * 0.6);
            for (const entry of full.thrown) {
                expect(entry.y).toBeGreaterThan(full.top);
                expect(entry.vy).toBeLessThan(0);
            }
        });
    });

    describe('combos, spins and the vortex', () => {
        it('throws one ring around the board for a fresh combo, already turning', () => {
            const { stage, sim, director } = createDirector();
            const log = play(director, sim, [{ kind: 'combo', strength: 0.8, lines: 6 }], { seconds: 0.5 });
            expect(log[0].spawned).toBeGreaterThan(10);
            expect(log.slice(1).every((entry) => entry.spawned === 0)).toBe(true);
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            const centre = stage.centre();
            const floor = fallTerrainHeight(centre.x, centre.z);
            const angles = new Set();
            for (const entry of sim.thrown()) {
                const dx = entry.x - centre.x;
                const dz = entry.z - centre.z;
                const radius = Math.hypot(dx, dz);
                expect(radius).toBeGreaterThan(1);
                expect(radius).toBeLessThan(6);
                // Tangential, the way the frame vortex turns.
                expect(dx * entry.vz - dz * entry.vx).toBeGreaterThan(0);
                expect(Math.abs(dx * entry.vx + dz * entry.vz) / radius).toBeLessThan(1e-9);
                expect(entry.y).toBeGreaterThan(floor);
                expect(entry.y).toBeLessThan(floor + 4);
                angles.add(Math.floor((Math.atan2(dz, dx) + Math.PI) / (Math.PI / 2)));
            }
            // All the way round, not a clump.
            expect(angles.size).toBeGreaterThanOrEqual(4);
            // A bigger combo throws a bigger ring.
            const small = createDirector();
            small.director.apply(frameWith([emitter({ kind: 'combo', strength: 0.3 })]), STEP);
            expect(small.sim.spawn.mock.calls.length).toBeLessThan(log[0].spawned);
        });

        it.each([[-1], [1]])('spins a small vortex beside the card for a t-spin on side %i', (side) => {
            const { stage, sim, director } = createDirector();
            const log = play(director, sim, [{
                kind: 'spin', side, row: 0.4, strength: 0.8, duration: 1.7,
            }], {
                seconds: 1.6,
            });
            expect(log[0].spawned).toBeGreaterThan(10);
            expect(log.slice(1).every((entry) => entry.spawned === 0)).toBe(true);
            const centre = stage.centre();
            const edge = stage.edge(side, 0.4);
            for (const entry of sim.thrown()) {
                expect((entry.x - edge.x) * side).toBeGreaterThan(0);
                expect(Math.abs(entry.y - edge.y)).toBeLessThan(1);
            }
            expect(log[0].fields).toHaveLength(1);
            for (const entry of log) {
                for (const field of entry.fields) {
                    expect(field.kind).toBe('vortex');
                    expect(field.turn).toBe(side);
                    expect((field.x - centre.x) * side).toBeGreaterThan(Math.abs(edge.x - centre.x));
                    expect(field.radius).toBeLessThan(field.reach);
                }
            }
            expect(log.at(-1).fields).toEqual([]);
        });

        it('turns the frame vortex into exactly one column centred on the board', () => {
            const { stage, sim, director } = createDirector();
            const centre = stage.centre();
            const floor = fallTerrainHeight(centre.x, centre.z);
            const columnAt = (vortex) => {
                const { fields } = director.apply(frameWith([], { vortex }), 0);
                expect(fields).toHaveLength(1);
                const [column] = fields;
                expect(column.kind).toBe('vortex');
                expect(column.x).toBeCloseTo(centre.x, 9);
                expect(column.z).toBeCloseTo(centre.z, 9);
                expect(column.turn).toBe(1);
                expect(column.radius).toBeGreaterThan(0);
                expect(column.reach).toBeGreaterThan(column.radius);
                expect(column.top).toBeGreaterThan(floor);
                for (const key of ['spin', 'grip', 'pull', 'lift']) expect(column[key]).toBeGreaterThan(0);
                return { ...column };
            };
            const faint = columnAt(0.2);
            const strong = columnAt(0.9);
            for (const key of ['radius', 'reach', 'top', 'spin', 'lift']) {
                expect(strong[key], key).toBeGreaterThan(faint[key]);
            }
            // Out-of-range strengths are clamped, and nonsense is no vortex at all.
            expect(columnAt(7)).toEqual(columnAt(1));
            for (const vortex of [0, -1, NaN, Infinity, undefined, null, '0.5']) {
                expect(director.apply(frameWith([], { vortex }), STEP).fields).toEqual([]);
            }
            expect(sim.spawn).not.toHaveBeenCalled();
            // It rides on top of whatever the emitters laid down.
            const mixed = director.apply(frameWith([emitter({ kind: 'spin', side: 1 })], { vortex: 0.5 }), 0);
            expect(mixed.fields.filter((field) => field.kind === 'vortex')).toHaveLength(2);
            expect(mixed.fields.filter((field) => field.x === centre.x && field.z === centre.z)).toHaveLength(1);
        });

        it('keeps feeding the column while it turns, at a rate that follows time and strength', () => {
            const fed = (vortex, seconds, fps) => {
                const { sim, director } = createDirector();
                for (let frame = 0; frame < seconds * fps; frame++) director.apply(frameWith([], { vortex }), 1 / fps);
                return sim.spawn.mock.calls.length;
            };
            const oneSecond = fed(0.5, 1, 60);
            expect(oneSecond).toBeGreaterThan(5);
            expect(Math.abs(fed(0.5, 2, 60) - oneSecond * 2)).toBeLessThanOrEqual(1);
            expect(fed(1, 1, 60)).toBeGreaterThan(oneSecond);
            expect(fed(0.1, 1, 60)).toBeLessThan(oneSecond);
            expect(fed(0.1, 1, 60)).toBeGreaterThan(0);
            for (const fps of [30, 144]) expect(Math.abs(fed(0.5, 2, fps) - oneSecond * 2)).toBeLessThanOrEqual(1);
            expect(fed(0, 5, 60)).toBe(0);

            // Paused frames feed nothing, and a stopped column forgets its fraction of a leaf.
            const { sim, director, stage } = createDirector();
            for (let frame = 0; frame < 30; frame++) director.apply(frameWith([], { vortex: 1 }), 0);
            for (const dt of [-1, -0.016]) director.apply(frameWith([], { vortex: 1 }), dt);
            expect(sim.spawn).not.toHaveBeenCalled();
            director.apply(frameWith([], { vortex: 1 }), 0.016);
            director.apply(frameWith([], { vortex: 0 }), 0.016);
            expect(director.vortexFeed).toBe(0);
            // The feed lands in the orbit around the board.
            for (let frame = 0; frame < 30; frame++) director.apply(frameWith([], { vortex: 1 }), STEP);
            const centre = stage.centre();
            for (const entry of sim.thrown()) {
                expect(Math.hypot(entry.x - centre.x, entry.z - centre.z)).toBeLessThan(6);
            }
        });
    });

    describe('wind', () => {
        it('maps the gust front to world x in the direction the frame gives it', () => {
            const { stage, director } = createDirector();
            const frontAt = (front) => {
                const env = director.apply(frameWith([], { front }), STEP);
                return env.front && { ...env.front };
            };
            expect(frontAt(null)).toBeNull();
            expect(director.apply(frameWith()).front).toBeNull();
            const upwind = frontAt({ position: -1.4, direction: 1, strength: 0.5 });
            const middle = frontAt({ position: 0, direction: 1, strength: 0.5 });
            const downwind = frontAt({ position: 0.7, direction: 1, strength: 0.25 });
            const mirrored = frontAt({ position: 0.7, direction: -1, strength: 0.25 });
            expect(upwind.x).toBeLessThan(0);
            expect(middle.x).toBeCloseTo(0, 9);
            expect(downwind.x).toBeGreaterThan(0);
            expect(upwind.x).toBeCloseTo(downwind.x * -2, 9);
            // A front at +/-1 stands at the edge of the view somewhere out among the trees.
            expect(downwind.x / 0.7).toBeGreaterThan(stage.halfWidth());
            expect(downwind.x / 0.7).toBeLessThan(stage.halfWidth(80));
            expect(upwind).toMatchObject({ direction: 1, strength: 0.5 });
            expect(downwind).toMatchObject({ direction: 1, strength: 0.25 });
            expect(mirrored).toMatchObject({ direction: -1, strength: 0.25, x: downwind.x });
            expect(upwind.width).toBeGreaterThan(0);
            // A front that has faded out is no front.
            expect(frontAt({ position: 0.2, direction: 1, strength: 0 })).toBeNull();
            expect(frontAt({ position: 0.2, direction: 1, strength: 0.0005 })).toBeNull();
            expect(frontAt({ position: 0.2, direction: 1, strength: NaN })).toBeNull();
        });

        it('reports the wind it is given and the gust of the frame', () => {
            const { director } = createDirector();
            const calm = { ...director.apply(frameWith(), STEP, { x: 0.6, z: 0.8, strength: 0 }) };
            const windy = { ...director.apply(frameWith(), STEP, { x: -0.8, z: 0.6, strength: 1 }) };
            expect(calm).toMatchObject({ windX: 0.6, windZ: 0.8, gust: 0 });
            expect(windy).toMatchObject({ windX: -0.8, windZ: 0.6, gust: 0 });
            // Even still air stirs a little.
            expect(calm.breeze).toBeGreaterThan(0);
            expect(windy.breeze).toBeGreaterThan(calm.breeze);
            const gust = (value) => director.apply(frameWith([], { gust: value }), STEP).gust;
            expect(gust(0.25)).toBeGreaterThan(0);
            expect(gust(0.5)).toBeCloseTo(gust(0.25) * 2, 9);
            expect(gust(1)).toBeGreaterThan(gust(0.5));
            expect(gust(40)).toBe(gust(1));
            for (const value of [0, -3, NaN, Infinity, undefined, null, '0.5']) expect(gust(value)).toBe(0);
            // No wind argument: a light breeze along +x.
            const still = director.apply(frameWith(), STEP);
            expect(still).toMatchObject({ windX: 1, windZ: 0 });
            expect(still.breeze).toBeGreaterThan(0);
        });

        it('reuses one environment object and one field list between frames', () => {
            const { director } = createDirector();
            const busy = frameWith([emitter()], { vortex: 0.5, front: { position: 0, direction: 1, strength: 1 } });
            const first = director.apply(busy, STEP);
            const { fields, front } = first;
            expect(fields.length).toBeGreaterThan(0);
            const quiet = frameWith([], { front: { position: 0.5, direction: -1, strength: 1 } });
            const second = director.apply(quiet, STEP);
            expect(second).toBe(first);
            expect(second.fields).toBe(fields);
            expect(second.fields).toBe(director.fields);
            expect(second.front).toBe(front);
            // Last frame's fields are gone, not accumulated.
            expect(second.fields).toEqual([]);
        });
    });

    describe('lifecycle and scale', () => {
        it('forgets what it has played on reset', () => {
            const { sim, director } = createDirector();
            const frame = frameWith([emitter({ id: 0, serial: 0 }), emitter({ id: 1, serial: 1, kind: 'combo' }),
                emitter({
                    id: 2, serial: 2, kind: 'clear', age: 0.2,
                })], { vortex: 1 });
            director.apply(frame, 0.01);
            const once = sim.spawn.mock.calls.length;
            expect(once).toBeGreaterThan(0);
            director.apply(frame, 0);
            expect(sim.spawn).toHaveBeenCalledTimes(once);
            expect(director.fields.length).toBeGreaterThan(0);
            director.reset();
            expect(director.fields).toEqual([]);
            expect(director.vortexFeed).toBe(0);
            // A new session starts its serials at zero again: the same numbers must play again.
            director.apply(frame, 0);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 2);
        });

        it('scales every throw with the leaf budget of the tier', () => {
            const thrown = (leaves, kind) => {
                const { sim, director } = createDirector({ leaves });
                play(director, sim, [{
                    kind, strength: 0.8, lines: 4, duration: 3,
                }], { seconds: 2 });
                return sim.spawn.mock.calls.length;
            };
            for (const kind of ['lock', 'clear', 'shower', 'combo', 'spin']) {
                const counts = [FALL_TIERS.Minimal, FALL_TIERS.Medium, FALL_TIERS.High, FALL_TIERS.Extreme]
                    .map((tier) => thrown(tier.leaves, kind));
                expect(counts[0]).toBeGreaterThan(0);
                for (let index = 1; index < counts.length; index++) {
                    expect(counts[index], kind).toBeGreaterThan(counts[index - 1]);
                }
            }
            const feed = (leaves) => {
                const { sim, director } = createDirector({ leaves });
                for (let frame = 0; frame < 120; frame++) director.apply(frameWith([], { vortex: 0.8 }), STEP);
                return sim.spawn.mock.calls.length;
            };
            expect(feed(FALL_TIERS.Extreme.leaves)).toBeGreaterThan(feed(FALL_TIERS.High.leaves));
            expect(feed(FALL_TIERS.High.leaves)).toBeGreaterThan(feed(FALL_TIERS.Minimal.leaves));
            expect(feed(FALL_TIERS.Minimal.leaves)).toBeGreaterThan(0);
        });

        it('keeps crowns near the board as shed points and drops the rest', () => {
            const crownPoints = new Float32Array([
                -12, 14, -6, 0,
                40, 15, -10, 1,
                3, 12, -60, 2,
                9, 11, 2, 1,
            ]);
            const { director } = createDirector({ crownPoints });
            expect(director.shedPoints).toEqual([-12, 14, -6, 9, 11, 2]);
            expect(createDirector().director.shedPoints).toEqual([]);
        });

        it('ignores frames and emitters it does not understand', () => {
            const { sim, director } = createDirector();
            for (const frame of [undefined, {}, { emitters: null }, { emitters: [] }, { emitters: 'lock' },
                frameWith([emitter({ kind: 'confetti' }), emitter({ id: 1, serial: 1, kind: undefined })])]) {
                expect(() => director.apply(frame, STEP)).not.toThrow();
            }
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(director.fields).toEqual([]);
        });

        it('throws nothing and never fails when the simulation has no reserve', () => {
            const sim = new FallLeafSim({
                count: 80, reserve: 0, rng: seededRandom(5), groundHeight: fallTerrainHeight,
            });
            const { director } = createDirector({ sim });
            const reactions = new FallReactions({ quality: 'Minimal', rng: seededRandom(6) });
            const before = { state: Array.from(sim.state), position: Array.from(sim.position) };
            reactions.onHardDrop({ distance: 15 });
            reactions.onPieceLock({ piece: { x: 1, y: 20, shape: [[1]] } });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(12);
            reactions.onTSpin();
            reactions.onPerfectClear();
            for (let frame = 0; frame < 90; frame++) {
                const env = director.apply(reactions.update(STEP), STEP, { x: 1, z: 0, strength: 0.3 });
                expect(Array.isArray(env.fields)).toBe(true);
            }
            expect(Array.from(sim.state)).toEqual(before.state);
            expect(Array.from(sim.position)).toEqual(before.position);
            expect(sim.counts().idle).toBe(0);
        });
    });

    describe('with the real director and simulation', () => {
        function grove(quality = 'High') {
            const tier = FALL_TIERS[quality];
            const sim = new FallLeafSim({
                count: 800, reserve: 500, rng: seededRandom(9), groundHeight: fallTerrainHeight,
            });
            const built = createDirector({ sim, leaves: tier.leaves });
            const reactions = new FallReactions({ quality, rng: seededRandom(3) });
            const wind = { x: 0.94, z: 0.34, strength: 0.3 };
            const advance = (seconds) => {
                for (let frame = 0; frame < seconds * 60; frame++) {
                    sim.step(STEP, built.director.apply(reactions.update(STEP), STEP, wind));
                }
            };
            const eventLeaves = () => {
                const result = [];
                for (let index = sim.ambient; index < sim.count; index++) {
                    if (sim.state[index] !== LEAF_AIR) continue;
                    const o = index * 3;
                    result.push({
                        x: sim.position[o],
                        y: sim.position[o + 1],
                        z: sim.position[o + 2],
                        vx: sim.velocity[o],
                        vz: sim.velocity[o + 2],
                    });
                }
                return result;
            };
            return {
                ...built, sim, reactions, advance, eventLeaves,
            };
        }

        it('puts the leaves of a lock in the air on the side of the piece', () => {
            const left = grove();
            const right = grove();
            left.reactions.onHardDrop({ distance: 16 });
            left.reactions.onPieceLock({ piece: { x: 0, y: 14, shape: [[1]] } });
            right.reactions.onHardDrop({ distance: 16 });
            right.reactions.onPieceLock({ piece: { x: 9, y: 14, shape: [[1]] } });
            expect(left.sim.counts().idle).toBe(500);
            left.advance(0.2);
            right.advance(0.2);
            const centre = left.stage.centre();
            const leftLeaves = left.eventLeaves();
            const rightLeaves = right.eventLeaves();
            expect(leftLeaves.length).toBeGreaterThan(10);
            expect(rightLeaves.length).toBe(leftLeaves.length);
            for (const entry of leftLeaves) expect(entry.x).toBeLessThan(centre.x);
            for (const entry of rightLeaves) expect(entry.x).toBeGreaterThan(centre.x);
            expect(left.sim.counts().idle).toBe(500 - leftLeaves.length);
        });

        it('winds event leaves around the board when a combo builds, and lets them settle afterwards', () => {
            const {
                reactions, sim, stage, advance, eventLeaves,
            } = grove();
            for (let cascade = 2; cascade <= 9; cascade++) {
                reactions.onCombo(cascade);
                advance(0.4);
            }
            expect(reactions.getFrame().vortex).toBeGreaterThan(0.3);
            const centre = stage.centre();
            const turning = eventLeaves().filter((entry) => Math.hypot(entry.x - centre.x, entry.z - centre.z) < 6);
            expect(turning.length).toBeGreaterThan(40);
            const circulation = turning.map((entry) => (
                (entry.x - centre.x) * entry.vz - (entry.z - centre.z) * entry.vx));
            expect(mean(circulation)).toBeGreaterThan(0);
            expect(circulation.filter((value) => value > 0).length).toBeGreaterThan(turning.length * 0.8);
            expect(mean(turning.map((entry) => entry.y))).toBeGreaterThan(fallTerrainHeight(centre.x, centre.z) + 0.5);
            // The combo ends: the column unwinds, the leaves land and return to the reserve.
            advance(40);
            expect(reactions.getFrame().vortex).toBe(0);
            expect(eventLeaves()).toEqual([]);
            expect(sim.counts().idle).toBe(500);
            for (const key of ['position', 'velocity', 'outPosition', 'outRotation']) {
                expect(sim[key].every(Number.isFinite)).toBe(true);
            }
        });
    });
});
