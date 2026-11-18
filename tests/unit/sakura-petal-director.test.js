import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { sakuraViewFor } from '../../src/themes/sakura-twilight/sakura-composition.js';
import { SakuraPetalDirector } from '../../src/themes/sakura-twilight/sakura-petal-director.js';
import {
    PETAL_AIR, PETAL_FLOAT, PETAL_REST, SakuraPetalSim,
} from '../../src/themes/sakura-twilight/sakura-petal-sim.js';
import { SAKURA_TIERS } from '../../src/themes/sakura-twilight/sakura-quality.js';
import { SakuraReactions } from '../../src/themes/sakura-twilight/sakura-reactions.js';
import {
    SAKURA_DEFAULT_BOARD, SAKURA_STAGE_DEPTH, SakuraStage, readSakuraBoardRect,
} from '../../src/themes/sakura-twilight/sakura-stage.js';
import {
    SAKURA_WATER_LEVEL, sakuraLand, sakuraSurfaceHeight,
} from '../../src/themes/sakura-twilight/sakura-terrain.js';

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

/** The camera as SakuraWorld.prepareCamera() frames it for an aspect ratio. */
function frameCamera(aspect = LANDSCAPE) {
    const view = sakuraViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 4000);
    camera.position.set(view.position[0], view.position[1], view.position[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateProjectionMatrix();
    return camera;
}

/** An arbitrary pose with yaw, pitch and roll, to prove the maths is not tied to the garden's view. */
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
        gust: 0,
        glow: 0,
        lanterns: 0,
        moon: 0,
        vortex: 0,
        heat: 0,
        spirit: 0,
        constellation: 0,
        figures: 0,
        foxfire: 0,
        hush: 0,
        streak: 0,
        front: null,
        emitters,
        ...rest,
    };
}

function spySim() {
    const sim = { spawn: vi.fn(() => 0) };
    sim.thrown = () => sim.spawn.mock.calls.map(([x, y, z, vx, vy, vz, glow]) => ({
        x, y, z, vx, vy, vz, glow,
    }));
    return sim;
}

/** The garden's one-shot hooks, recording what the director asks of them. */
function spyEffects() {
    const effects = {
        ring: vi.fn(), flash: vi.fn(), star: vi.fn(), floatLantern: vi.fn(), skyLantern: vi.fn(),
    };
    effects.rings = () => effects.ring.mock.calls.map(([x, z, strength]) => ({ x, z, strength }));
    effects.flashes = () => effects.flash.mock.calls.map(([x, y, z, strength]) => ({
        x, y, z, strength,
    }));
    effects.floats = () => effects.floatLantern.mock.calls.map(([x, z, vx, vz, power]) => ({
        x, z, vx, vz, power,
    }));
    effects.skies = () => effects.skyLantern.mock.calls.map(([x, y, z, delay]) => ({
        x, y, z, delay,
    }));
    return effects;
}

function createDirector({
    aspect = LANDSCAPE, petals = 6000, skyLanterns = 40, seed = 187, sim = spySim(), effects = spyEffects(), ...options
} = {}) {
    const camera = frameCamera(aspect);
    const stage = new SakuraStage(camera);
    const director = new SakuraPetalDirector({
        stage,
        sim,
        tier: { petals, skyLanterns },
        rng: seededRandom(seed),
        surface: sakuraSurfaceHeight,
        effects,
        ...options,
    });
    return {
        camera, stage, sim, effects, director,
    };
}

/** Age a set of emitters through the director and report what each frame did. */
function play(director, sim, emitters, { seconds, dt = STEP, frame = {} }) {
    const specs = emitters.map((entry, index) => emitter({ id: index, serial: index, ...entry }));
    const log = [];
    const steps = Math.round(seconds / dt);
    for (let step = 0; step <= steps; step += 1) {
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

describe('Sakura stage', () => {
    it.each([
        ['the landscape garden view', () => frameCamera(LANDSCAPE)],
        ['the portrait garden view', () => frameCamera(PORTRAIT)],
        ['an arbitrary tilted camera', tiltedCamera],
    ])('maps screen fractions onto a plane in front of %s', (_label, makeCamera) => {
        const camera = makeCamera();
        const stage = new SakuraStage(camera);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        for (const depth of [1, SAKURA_STAGE_DEPTH, 40]) {
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
        expectVector(stage.point(0.3, 0.6), stage.point(0.3, 0.6, SAKURA_STAGE_DEPTH));
        const target = new THREE.Vector3(9, 9, 9);
        expect(stage.point(0.3, 0.6, 5, target)).toBe(target);
        expectVector(target, stage.point(0.3, 0.6, 5));
    });

    it.each([
        ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
    ])('finds the card edges, its centre and its rows in %s', (_label, aspect) => {
        const camera = frameCamera(aspect);
        const stage = new SakuraStage(camera);
        expect(stage.board).toEqual(SAKURA_DEFAULT_BOARD);
        const {
            x0, x1, y0, y1,
        } = stage.board;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        for (const row of [0, 0.25, 0.5, 1]) {
            const left = stage.edge(-1, row);
            const rightEdge = stage.edge(1, row);
            expect(rightEdge.clone().sub(left).dot(right)).toBeGreaterThan(0);
            expect(ndc(left, camera).x).toBeCloseTo(x0 * 2 - 1, 9);
            expect(ndc(rightEdge, camera).x).toBeCloseTo(x1 * 2 - 1, 9);
            // Row 0 is the foot of the card, row 1 its top.
            expect(ndc(left, camera).y).toBeCloseTo(1 - (y1 + (y0 - y1) * row) * 2, 9);
            expect(ndc(rightEdge, camera).y).toBeCloseTo(ndc(left, camera).y, 9);
        }
        for (const side of [-1, 1]) {
            const heights = [0, 0.3, 0.6, 1].map((row) => stage.edge(side, row).y);
            expect([...heights].sort((a, b) => a - b)).toEqual(heights);
            expect(new Set(heights).size).toBe(heights.length);
            // Rows outside the card clamp onto it.
            expectVector(stage.edge(side, 7), stage.edge(side, 1));
            expectVector(stage.edge(side, -7), stage.edge(side, 0));
            expectVector(stage.edge(side, 0.5), stage.edge(side, 0.5, SAKURA_STAGE_DEPTH));
        }
        // An inset moves the point onto the card from either edge.
        expect(ndc(stage.edge(-1, 0.5, 6, undefined, 0.02), camera).x).toBeCloseTo((x0 + 0.02) * 2 - 1, 9);
        expect(ndc(stage.edge(1, 0.5, 6, undefined, 0.02), camera).x).toBeCloseTo((x1 - 0.02) * 2 - 1, 9);
        const centre = stage.centre();
        expectVector(centre, stage.edge(-1, 0.5).add(stage.edge(1, 0.5)).multiplyScalar(0.5));
        expectVector(stage.centre(12), stage.point((x0 + x1) / 2, (y0 + y1) / 2, 12));
        const target = new THREE.Vector3();
        expect(stage.edge(1, 0.2, 4, target)).toBe(target);
        expect(stage.centre(4, target)).toBe(target);
    });

    it('measures half the width of the view at a depth', () => {
        for (const camera of [frameCamera(LANDSCAPE), frameCamera(PORTRAIT), tiltedCamera()]) {
            const stage = new SakuraStage(camera);
            for (const depth of [2, SAKURA_STAGE_DEPTH, 26]) {
                const width = stage.point(0, 0.5, depth).distanceTo(stage.point(1, 0.5, depth));
                expect(stage.halfWidth(depth)).toBeCloseTo(width / 2, 9);
            }
            expect(stage.halfWidth()).toBe(stage.halfWidth(SAKURA_STAGE_DEPTH));
            expect(stage.halfWidth(20)).toBeCloseTo(stage.halfWidth(10) * 2, 9);
        }
        expect(new SakuraStage(frameCamera(LANDSCAPE)).halfWidth(10))
            .toBeGreaterThan(new SakuraStage(frameCamera(PORTRAIT)).halfWidth(10));
    });

    it.each([
        ['landscape', LANDSCAPE], ['portrait', PORTRAIT],
    ])('finds the spot on the lake under a board column in %s', (_label, aspect) => {
        const camera = frameCamera(aspect);
        const stage = new SakuraStage(camera);
        const { x0, x1 } = stage.board;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        for (const reach of [12, 26, 40]) {
            const across = [];
            for (const column of [-0.9, 0, 0.25, 0.5, 1, 1.9]) {
                const spot = stage.lake(column, reach);
                // On the water, straight below the sight line through that column.
                expect(spot.y).toBe(SAKURA_WATER_LEVEL);
                const sight = stage.point(x0 + (x1 - x0) * column, 0.5, reach);
                expect(spot.x).toBeCloseTo(sight.x, 9);
                expect(spot.z).toBeCloseTo(sight.z, 9);
                across.push(spot.clone().sub(camera.position).dot(right));
            }
            // Columns run left to right, and may reach past the card's edges.
            expect([...across].sort((a, b) => a - b)).toEqual(across);
            expect(new Set(across).size).toBe(across.length);
            expect(stage.lake(0.5, reach).sub(camera.position).dot(forward)).toBeGreaterThan(reach * 0.9);
        }
        // Further out is further out, along the same sight line.
        const near = stage.lake(0.2, 10).sub(camera.position).setY(0);
        const far = stage.lake(0.2, 30).sub(camera.position).setY(0);
        expect(far.length()).toBeCloseTo(near.length() * 3, 6);
        expect(far.clone().normalize().dot(near.clone().normalize())).toBeCloseTo(1, 9);
        // A column that is not a number means the middle of the board.
        for (const column of [NaN, undefined, null, 'left', Infinity]) {
            expectVector(stage.lake(column, 20), stage.lake(0.5, 20));
        }
        const target = new THREE.Vector3(9, 9, 9);
        expect(stage.lake(0.5, 20, target)).toBe(target);
        expect(stage.lake(0.5).y).toBe(SAKURA_WATER_LEVEL);
    });

    it('accepts a measured card, clamps it to the screen and falls back to the default for junk', () => {
        const camera = frameCamera();
        const stage = new SakuraStage(camera);
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
        // The lake spot follows the measured card too.
        expect(ndc(stage.lake(1, 20).setY(stage.point(0.45, 0.5, 20).y), camera).x).toBeCloseTo(0.45 * 2 - 1, 9);
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
            expect(stage.board).toEqual(SAKURA_DEFAULT_BOARD);
            expect(stage.board).not.toBe(SAKURA_DEFAULT_BOARD);
        }
        expect(Object.isFrozen(SAKURA_DEFAULT_BOARD)).toBe(true);
        expect(SAKURA_DEFAULT_BOARD.x1).toBeGreaterThan(SAKURA_DEFAULT_BOARD.x0);
        expect(SAKURA_DEFAULT_BOARD.y1).toBeGreaterThan(SAKURA_DEFAULT_BOARD.y0);
        // The default card is centred: the garden is composed for the thirds either side of it.
        expect(SAKURA_DEFAULT_BOARD.x0 + SAKURA_DEFAULT_BOARD.x1).toBeCloseTo(1, 9);
    });

    it('keeps the rest pose it read until it is refreshed', () => {
        const camera = frameCamera(LANDSCAPE);
        const stage = new SakuraStage(camera);
        const before = stage.centre();
        const lake = stage.lake(0.5, 20);
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
        expectVector(stage.lake(0.5, 20), lake);
        expect(stage.halfWidth()).toBe(width);
        stage.refresh();
        expect(stage.centre().distanceTo(before)).toBeGreaterThan(1);
        expect(stage.lake(0.5, 20).distanceTo(lake)).toBeGreaterThan(1);
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
        expect(readSakuraBoardRect(doc, win)).toEqual({
            x0: 0.4, x1: 0.6, y0: 0.1, y1: 0.9,
        });
        // Gameplay boards carry data-player; the lobby's avatar cards reuse .player-card without it.
        expect(selectors).toEqual(['.player-card[data-player]']);
        // Without computed styles the rectangle alone decides.
        const plain = page([solo()], { computed: false });
        expect(readSakuraBoardRect(plain.doc, plain.win)).toEqual({
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
        expect(readSakuraBoardRect(doc, win)).toEqual({
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
        expect(readSakuraBoardRect(empty.doc, empty.win)).toBeNull();
        const mixed = page([...ghosts, solo(), ...ghosts]);
        expect(readSakuraBoardRect(mixed.doc, mixed.win)).toEqual({
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
        expect(readSakuraBoardRect(fading.doc, fading.win)).not.toBeNull();
    });

    it('reports a card that hangs off the screen as it is and lets the stage clamp it', () => {
        const { doc, win } = page([card({
            left: -100, top: 50, width: 400, height: 600,
        })]);
        const rect = readSakuraBoardRect(doc, win);
        expect(rect).toEqual({
            x0: -0.1, x1: 0.3, y0: 0.1, y1: 1.3,
        });
        const stage = new SakuraStage(frameCamera());
        stage.setBoard(rect);
        expect(stage.board).toEqual({
            x0: 0, x1: 0.3, y0: 0.1, y1: 1,
        });
    });

    it('returns null when there is no page, no window or no board', () => {
        const { doc, win } = page([]);
        expect(readSakuraBoardRect(doc, win)).toBeNull();
        expect(readSakuraBoardRect(null, win)).toBeNull();
        expect(readSakuraBoardRect(doc, null)).toBeNull();
        expect(readSakuraBoardRect({}, win)).toBeNull();
        expect(readSakuraBoardRect({ querySelectorAll: 'nope' }, win)).toBeNull();
        // Vitest's node environment has neither global.
        expect(readSakuraBoardRect()).toBeNull();
        // And null is what tells the stage to keep its default card.
        const stage = new SakuraStage(frameCamera());
        stage.setBoard(readSakuraBoardRect(doc, win));
        expect(stage.board).toEqual(SAKURA_DEFAULT_BOARD);
    });

    it('never divides by an unknown window size', () => {
        for (const size of [0, undefined, NaN]) {
            const { doc, win } = page([solo()], { width: size, height: size });
            const rect = readSakuraBoardRect(doc, win);
            if (rect !== null) expect(Object.values(rect).every(Number.isFinite)).toBe(true);
        }
    });

    it('reads the live document and window by default', () => {
        const { doc, win } = page([solo()], { width: 2000, height: 1000 });
        vi.stubGlobal('document', doc);
        vi.stubGlobal('window', win);
        expect(readSakuraBoardRect()).toEqual({
            x0: 0.2, x1: 0.3, y0: 0.05, y1: 0.45,
        });
    });
});

describe('Sakura petal director', () => {
    describe('locks', () => {
        // The lowest board rows map to the foot of the card, which sits below the knoll on the
        // stage plane: petals thrown there must still start above the ground.
        it.each([
            ['lock'], ['clear'], ['spin'],
        ])('starts %s petals above the ground however low the card reaches', (kind) => {
            const ground = (x, z) => 40 + 0.1 * x + 0.05 * z;
            const { stage, sim, director } = createDirector({ surface: ground });
            expect(stage.edge(-1, 0).y).toBeLessThan(30);
            play(director, sim, [{
                kind, side: -1, row: 0, strength: 0.8, lines: 2,
            }], { seconds: 0.6 });
            const thrown = sim.thrown();
            expect(thrown.length).toBeGreaterThan(3);
            for (const entry of thrown) {
                expect(entry.y).toBeGreaterThanOrEqual(ground(entry.x, entry.z) + 0.2 - 1e-9);
                expect(entry.y).toBeLessThan(ground(entry.x, entry.z) + 0.5);
            }
            // In the garden itself nothing is thrown from under the grass or the lake either.
            const garden = createDirector();
            play(garden.director, garden.sim, [{
                kind, side: -1, row: 0, strength: 0.8, lines: 2,
            }], { seconds: 0.6 });
            expect(garden.sim.thrown().length).toBe(thrown.length);
            for (const entry of garden.sim.thrown()) {
                expect(entry.y).toBeGreaterThanOrEqual(sakuraSurfaceHeight(entry.x, entry.z) + 0.2 - 1e-9);
            }
        });

        it.each([[-1], [1]])('throws a fresh puff once from the card edge on side %i, outward', (side) => {
            const {
                stage, sim, director, effects,
            } = createDirector();
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
                // Petals the game throws are lit.
                expect(thrown.glow).toBeGreaterThan(0.5);
                expect(thrown.glow).toBeLessThanOrEqual(1);
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
            // One burst is at the piece; another stirs the grass at the foot of the card.
            const heights = log[0].fields.map((field) => field.y).sort((a, b) => a - b);
            expect(heights).toHaveLength(2);
            expect(Math.abs(heights[1] - edge.y)).toBeLessThan(1);
            const low = log[0].fields.find((field) => field.y === heights[0]);
            expect(Math.abs(low.y - sakuraSurfaceHeight(low.x, low.z))).toBeLessThan(0.6);
            // And exactly one ring goes out across the lake, under one burst of light at the edge.
            expect(effects.ring).toHaveBeenCalledOnce();
            expect(effects.flash).toHaveBeenCalledOnce();
            expect(effects.star).not.toHaveBeenCalled();
            expect(effects.floatLantern).not.toHaveBeenCalled();
            expect(effects.skyLantern).not.toHaveBeenCalled();
        });

        it('follows the height of the piece and throws harder for a stronger lock', () => {
            const thrownAt = (row, strength) => {
                const {
                    sim, director, stage, effects,
                } = createDirector();
                const env = director.apply(frameWith([emitter({ row, strength })]), STEP);
                return {
                    petals: sim.thrown(),
                    power: Math.max(...env.fields.map((field) => field.power)),
                    edge: stage.edge(-1, row),
                    ring: effects.rings()[0],
                };
            };
            const low = thrownAt(0.4, 0.3);
            const high = thrownAt(0.9, 0.3);
            const hard = thrownAt(0.4, 0.9);
            const height = (puff) => mean(puff.petals.map((thrown) => thrown.y));
            expect(height(high)).toBeGreaterThan(height(low) + 2);
            expect(Math.abs(height(high) - high.edge.y)).toBeLessThan(0.5);
            expect(hard.petals.length).toBeGreaterThan(low.petals.length);
            expect(hard.power).toBeGreaterThan(low.power);
            expect(mean(hard.petals.map((thrown) => Math.abs(thrown.vx))))
                .toBeGreaterThan(mean(low.petals.map((thrown) => Math.abs(thrown.vx))));
            expect(mean(hard.petals.map((thrown) => thrown.glow)))
                .toBeGreaterThan(mean(low.petals.map((thrown) => thrown.glow)));
            // The harder the piece lands, the stronger its ring.
            expect(low.ring.strength).toBeGreaterThan(0);
            expect(hard.ring.strength).toBeGreaterThan(low.ring.strength);
            expect(high.ring.strength).toBe(low.ring.strength);
        });

        it('drops the ring on the lake under the column the piece locked in', () => {
            const ringFor = (column, seed) => {
                const { director, effects, camera } = createDirector({ seed });
                director.apply(frameWith([emitter({ column, side: column < 0.5 ? -1 : 1 })]), STEP);
                expect(effects.ring).toHaveBeenCalledOnce();
                const [ring] = effects.rings();
                return { ...ring, screen: ndc(new THREE.Vector3(ring.x, SAKURA_WATER_LEVEL, ring.z), camera) };
            };
            const { x0, x1 } = SAKURA_DEFAULT_BOARD;
            for (const seed of [1, 2, 3, 4, 5]) {
                const rings = [0, 0.25, 0.5, 0.75, 1].map((column) => ({ column, ...ringFor(column, seed) }));
                for (const ring of rings) {
                    // Open water, beyond the near bank, in front of the camera.
                    expect(sakuraLand(ring.x, ring.z)).toBeLessThan(0);
                    expect(ring.screen.z).toBeLessThan(1);
                    // Seen from the camera it lies on the line down from that column of the card.
                    expect(ring.screen.x).toBeCloseTo((x0 + (x1 - x0) * ring.column) * 2 - 1, 2);
                    // Below the horizon line of the card's middle: on the water, not in the sky.
                    expect(ring.screen.y).toBeLessThan(0);
                }
            }
        });

        it('lights a burst where the petals leave the card: one for a lock, one on each side for a clear', () => {
            const lockFlash = (side, row, strength) => {
                const { stage, director, effects } = createDirector();
                const lock = { side, row, strength };
                director.apply(frameWith([emitter(lock)]), STEP);
                // Once, when the piece lands: not on every frame the emitter lives.
                director.apply(frameWith([emitter({ ...lock, age: 0.1 })]), STEP);
                director.apply(frameWith([emitter({ ...lock, age: 0.5 })]), STEP);
                expect(effects.flash).toHaveBeenCalledOnce();
                return { flash: effects.flashes()[0], edge: stage.edge(side, row), centre: stage.centre() };
            };
            for (const side of [-1, 1]) {
                const { flash, edge, centre } = lockFlash(side, 0.6, 0.4);
                expect([flash.x, flash.y, flash.z, flash.strength].every(Number.isFinite)).toBe(true);
                // At the card's edge on the side of the piece, at its height.
                expect(Math.abs(flash.x - edge.x)).toBeLessThan(1);
                expect((flash.x - centre.x) * side).toBeGreaterThan(0);
                expect(flash.y).toBeCloseTo(edge.y, 9);
                expect(flash.z).toBeCloseTo(edge.z, 9);
                expect(flash.strength).toBeGreaterThan(0);
            }
            expect(lockFlash(1, 0.6, 0.9).flash.strength).toBeGreaterThan(lockFlash(1, 0.6, 0.3).flash.strength);
            expect(lockFlash(1, 0.9, 0.4).flash.y).toBeGreaterThan(lockFlash(1, 0.5, 0.4).flash.y);

            const clearFlashes = (lines) => {
                const { stage, director, effects } = createDirector();
                const jets = [-1, 1].map((side, index) => emitter({
                    id: index, serial: index, kind: 'clear', side, row: 0.5, strength: 0.7, lines,
                }));
                director.apply(frameWith(jets), STEP);
                director.apply(frameWith(jets.map((jet) => ({ ...jet, age: 0.2 }))), STEP);
                expect(effects.flash).toHaveBeenCalledTimes(2);
                return { flashes: effects.flashes(), stage };
            };
            const { flashes, stage } = clearFlashes(2);
            const centre = stage.centre();
            const sides = flashes.map((flash) => Math.sign(flash.x - centre.x));
            expect(sides.sort()).toEqual([-1, 1]);
            for (const flash of flashes) {
                const edge = stage.edge(Math.sign(flash.x - centre.x), 0.5);
                expect(Math.abs(flash.x - edge.x)).toBeLessThan(1);
                expect(flash.y).toBeCloseTo(edge.y, 9);
                expect(flash.z).toBeCloseTo(edge.z, 9);
            }
            expect(flashes[0].strength).toBe(flashes[1].strength);
            // A bigger clear bursts brighter, and a four-line clear outshines the hardest lock.
            expect(clearFlashes(4).flashes[0].strength).toBeGreaterThan(flashes[0].strength);
            expect(flashes[0].strength).toBeGreaterThan(clearFlashes(1).flashes[0].strength);
            expect(clearFlashes(4).flashes[0].strength).toBeGreaterThan(lockFlash(1, 0.6, 1).flash.strength);
            // A piece at the very foot of the card still bursts above the grass.
            const low = lockFlash(-1, 0, 0.4).flash;
            expect(low.y).toBeGreaterThan(sakuraSurfaceHeight(low.x, low.z));
        });

        it('treats a reused slot with a new serial as a new event', () => {
            const { sim, director, effects } = createDirector();
            director.apply(frameWith([emitter({ id: 3, serial: 7 })]), STEP);
            const once = sim.spawn.mock.calls.length;
            director.apply(frameWith([emitter({ id: 3, serial: 7, age: 0.02 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(once);
            expect(effects.ring).toHaveBeenCalledTimes(1);
            director.apply(frameWith([emitter({ id: 3, serial: 8 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 2);
            expect(effects.ring).toHaveBeenCalledTimes(2);
            // Two slots playing the same kind at once are tracked separately.
            director.apply(frameWith([emitter({ id: 3, serial: 8, age: 0.02 }), emitter({ id: 4, serial: 9 })]), STEP);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 3);
            expect(effects.ring).toHaveBeenCalledTimes(3);
        });
    });

    describe('line clears', () => {
        it('spreads the jets over an opening window, toward each side, with a jet field pointing outward', () => {
            const {
                stage, sim, director, effects,
            } = createDirector();
            const jets = [
                {
                    id: 0, serial: 0, kind: 'clear', side: -1, row: 0.5, strength: 0.7, lines: 2,
                },
                {
                    id: 1, serial: 1, kind: 'clear', side: 1, row: 0.5, strength: 0.7, lines: 2,
                },
            ];
            const log = play(director, sim, jets, { seconds: 1.9 });
            // Nothing is due at age zero; the petals follow over the next frames and then stop.
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
                const edge = stage.edge(side, 0.5);
                for (const entry of side < 0 ? left : right) {
                    expect((entry.x - centre.x) * side).toBeGreaterThan(0);
                    expect(Math.abs(entry.x - edge.x)).toBeLessThan(0.5);
                    expect(Math.abs(entry.y - edge.y)).toBeLessThan(1.5);
                    expect(Math.abs(entry.z - edge.z)).toBeLessThan(1.5);
                    expect(entry.glow).toBeGreaterThan(0.5);
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
                    expect(Math.abs(field.x - centre.x)).toBeGreaterThan(Math.abs(stage.edge(side, 0.5).x - centre.x));
                    expect(field.power).toBeGreaterThan(0);
                }
            }
            expect(log.at(-1).fields).toEqual([]);
            // One ring for the whole clear, not one per jet.
            expect(effects.ring).toHaveBeenCalledOnce();
        });

        it('sends one wide ring from the middle of the lake, brighter for more lines', () => {
            const ringFor = (lines) => {
                const { director, effects, camera } = createDirector();
                director.apply(frameWith([
                    emitter({
                        id: 0, serial: 0, kind: 'clear', side: -1, lines,
                    }),
                    emitter({
                        id: 1, serial: 1, kind: 'clear', side: 1, lines,
                    }),
                ]), STEP);
                expect(effects.ring).toHaveBeenCalledOnce();
                const [ring] = effects.rings();
                return { ...ring, screen: ndc(new THREE.Vector3(ring.x, SAKURA_WATER_LEVEL, ring.z), camera) };
            };
            const rings = [1, 2, 3, 4].map(ringFor);
            for (const ring of rings) {
                expect(sakuraLand(ring.x, ring.z)).toBeLessThan(0);
                // Straight out from the middle of the card.
                expect(ring.screen.x).toBeCloseTo(SAKURA_DEFAULT_BOARD.x0 + SAKURA_DEFAULT_BOARD.x1 - 1, 2);
            }
            for (let index = 1; index < rings.length; index += 1) {
                expect(rings[index].strength).toBeGreaterThan(rings[index - 1].strength);
            }
            // A clear's ring outshines the ring of even the hardest lock.
            const lock = createDirector();
            lock.director.apply(frameWith([emitter({ strength: 1 })]), STEP);
            expect(rings[3].strength).toBeGreaterThan(lock.effects.rings()[0].strength);
        });

        it('throws more petals for more lines and catches up when it first sees a clear late', () => {
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
            const far = [[45, 15, -10], [-38, 13, -4], [3, 12, -70]];
            const crownPoints = new Float32Array([...near, ...far]
                .flatMap(([x, y, z], index) => [x, y, z, (index % 3) / 2]));
            const { sim, director, effects } = createDirector({ crownPoints });
            const shower = {
                kind: 'shower', side: 1, row: 1, strength: 1, lines: 4, duration: 2.8,
            };
            const log = play(director, sim, [shower], { seconds: 2.7 });
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
                // Blossom letting go is softly lit, dimmer than what the board throws.
                expect(entry.glow).toBeGreaterThan(0);
                expect(entry.glow).toBeLessThan(1);
                used.add(crown);
            }
            expect(used.size).toBe(near.length);
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            for (const hook of [effects.ring, effects.flash, effects.star, effects.floatLantern, effects.skyLantern]) {
                expect(hook).not.toHaveBeenCalled();
            }
        });

        it('showers from above the board when it has no crowns, in proportion to its strength', () => {
            const shower = (strength) => {
                const { sim, director, stage } = createDirector();
                play(director, sim, [{ kind: 'shower', strength, duration: 3 }], { seconds: 2.9 });
                return { thrown: sim.thrown(), middle: stage.centre().y };
            };
            const full = shower(1);
            const half = shower(0.5);
            expect(full.thrown.length).toBeGreaterThan(100);
            expect(half.thrown.length).toBeGreaterThan(full.thrown.length * 0.4);
            expect(half.thrown.length).toBeLessThan(full.thrown.length * 0.6);
            for (const entry of full.thrown) {
                expect(entry.y).toBeGreaterThan(full.middle);
                expect(entry.vy).toBeLessThan(0);
            }
        });
    });

    describe('combos, spins, the stream and the lift', () => {
        it('throws one ring of petals around the board for a fresh combo, already turning', () => {
            const { stage, sim, director } = createDirector();
            const log = play(director, sim, [{ kind: 'combo', strength: 0.8, lines: 6 }], { seconds: 0.5 });
            expect(log[0].spawned).toBeGreaterThan(10);
            expect(log.slice(1).every((entry) => entry.spawned === 0)).toBe(true);
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            const centre = stage.centre();
            const floor = sakuraSurfaceHeight(centre.x, centre.z);
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
            // A bigger combo throws a bigger, brighter, faster ring.
            const small = createDirector();
            small.director.apply(frameWith([emitter({ kind: 'combo', strength: 0.3 })]), STEP);
            expect(small.sim.spawn.mock.calls.length).toBeLessThan(log[0].spawned);
            expect(mean(small.sim.thrown().map((entry) => entry.glow)))
                .toBeLessThan(mean(sim.thrown().map((entry) => entry.glow)));
            expect(mean(small.sim.thrown().map((entry) => Math.hypot(entry.vx, entry.vz))))
                .toBeLessThan(mean(sim.thrown().map((entry) => Math.hypot(entry.vx, entry.vz))));
        });

        it.each([[-1], [1]])('spins a small vortex beside the card for a twist on side %i', (side) => {
            const { stage, sim, director } = createDirector();
            const log = play(director, sim, [{
                kind: 'spin', side, row: 0.6, strength: 0.8, duration: 1.7,
            }], {
                seconds: 1.6,
            });
            expect(log[0].spawned).toBeGreaterThan(10);
            expect(log.slice(1).every((entry) => entry.spawned === 0)).toBe(true);
            const centre = stage.centre();
            const edge = stage.edge(side, 0.6);
            for (const entry of sim.thrown()) {
                expect((entry.x - edge.x) * side).toBeGreaterThan(0);
                expect(Math.abs(entry.y - edge.y)).toBeLessThan(1);
            }
            // A spiral: the petals leave in every direction about the spot.
            const headings = new Set(sim.thrown().map((entry) => Math.sign(entry.vy - 1.5)));
            expect(headings.has(1) && headings.has(-1)).toBe(true);
            expect(log[0].fields).toHaveLength(1);
            for (const entry of log) {
                for (const field of entry.fields) {
                    expect(field.kind).toBe('vortex');
                    expect(field.turn).toBe(side);
                    expect((field.x - centre.x) * side).toBeGreaterThan(Math.abs(edge.x - centre.x));
                    expect(field.radius).toBeLessThan(field.reach);
                    expect(field.top).toBeGreaterThan(edge.y);
                }
            }
            expect(log.at(-1).fields).toEqual([]);
        });

        it('turns the frame vortex into exactly one column centred on the board', () => {
            const { stage, sim, director } = createDirector();
            const centre = stage.centre();
            const floor = sakuraSurfaceHeight(centre.x, centre.z);
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
            // The stream winds around the card, not through it.
            const halfCard = Math.abs(stage.edge(1, 0.5).x - centre.x);
            expect(faint.radius).toBeGreaterThan(halfCard);
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

        it('keeps feeding the stream while it turns, at a rate that follows time and strength', () => {
            const fed = (vortex, seconds, fps) => {
                const { sim, director } = createDirector();
                for (let frame = 0; frame < seconds * fps; frame += 1) {
                    director.apply(frameWith([], { vortex }), 1 / fps);
                }
                return sim.spawn.mock.calls.length;
            };
            const oneSecond = fed(0.5, 1, 60);
            const twoSeconds = fed(0.5, 2, 60);
            expect(oneSecond).toBeGreaterThan(5);
            // Whole petals only: the fraction left over is carried to the next frame.
            expect(Math.abs(twoSeconds - oneSecond * 2)).toBeLessThanOrEqual(2);
            expect(fed(1, 1, 60)).toBeGreaterThan(oneSecond);
            expect(fed(0.1, 1, 60)).toBeLessThan(oneSecond);
            expect(fed(0.1, 1, 60)).toBeGreaterThan(0);
            for (const fps of [30, 144]) expect(Math.abs(fed(0.5, 2, fps) - twoSeconds)).toBeLessThanOrEqual(1);
            expect(fed(0, 5, 60)).toBe(0);

            // Paused frames feed nothing, and a stopped stream forgets its fraction of a petal.
            const { sim, director, stage } = createDirector();
            for (let frame = 0; frame < 30; frame += 1) director.apply(frameWith([], { vortex: 1 }), 0);
            for (const dt of [-1, -0.016]) director.apply(frameWith([], { vortex: 1 }), dt);
            expect(sim.spawn).not.toHaveBeenCalled();
            director.apply(frameWith([], { vortex: 1 }), 0.016);
            director.apply(frameWith([], { vortex: 0 }), 0.016);
            expect(director.vortexFeed).toBe(0);
            // The feed lands in the orbit around the board, turning with it.
            for (let frame = 0; frame < 30; frame += 1) director.apply(frameWith([], { vortex: 1 }), STEP);
            const centre = stage.centre();
            expect(sim.thrown().length).toBeGreaterThan(5);
            for (const entry of sim.thrown()) {
                const dx = entry.x - centre.x;
                const dz = entry.z - centre.z;
                expect(Math.hypot(dx, dz)).toBeLessThan(6);
                expect(dx * entry.vz - dz * entry.vx).toBeGreaterThan(0);
            }
        });

        it('breathes the fallen petals up around the board on a rise, without throwing new ones', () => {
            const { stage, sim, director } = createDirector();
            const log = play(director, sim, [{ kind: 'rise', strength: 1, duration: 2.6 }], { seconds: 2.5 });
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(log[0].fields).toHaveLength(1);
            const centre = stage.centre();
            for (const entry of log) {
                expect(entry.fields.length).toBeLessThanOrEqual(1);
                for (const field of entry.fields) {
                    expect(field.kind).toBe('lift');
                    expect(field.x).toBeCloseTo(centre.x, 9);
                    // Wide enough to reach the bank either side of the card and the water behind it.
                    expect(field.radius).toBeGreaterThan(stage.halfWidth() * 1.5);
                    expect(Math.abs(field.z - centre.z)).toBeLessThan(field.radius);
                    expect(field.top).toBeGreaterThan(sakuraSurfaceHeight(field.x, field.z));
                    expect(field.power).toBeGreaterThan(0);
                }
            }
            // A breath, not a wind: it has passed before the emitter ends.
            const last = log.findLastIndex((entry) => entry.fields.length > 0);
            expect(log[last].age).toBeGreaterThan(0.3);
            expect(log[last].age).toBeLessThan(2.4);
            const gentle = createDirector();
            const [weak] = gentle.director.apply(frameWith([emitter({ kind: 'rise', strength: 0.4 })]), STEP).fields;
            expect(weak.power).toBeLessThan(log[0].fields[0].power);
        });
    });

    describe('lanterns and stars', () => {
        it('sends one shooting star for a fresh star emitter, with its strength', () => {
            const { sim, director, effects } = createDirector();
            const log = play(director, sim, [{ kind: 'star', strength: 0.7, duration: 1.4 }], { seconds: 1.3 });
            expect(effects.star).toHaveBeenCalledExactlyOnceWith(0.7);
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            // The same slot under a new serial is another star; two slots are two stars.
            director.apply(frameWith([emitter({
                id: 0, serial: 9, kind: 'star', strength: 1,
            }), emitter({
                id: 1, serial: 10, kind: 'star', strength: 0.5,
            })]), STEP);
            expect(effects.star.mock.calls).toEqual([[0.7], [1], [0.5]]);
        });

        it('sets one lantern afloat for every cleared line, from the banks either side of the board', () => {
            const launch = (lines, strength = lines / 4, serial = 0) => {
                const {
                    director, effects, stage, sim,
                } = createDirector();
                const log = play(director, sim, [{
                    kind: 'floats', lines, strength, serial, duration: 0.6,
                }], { seconds: 0.5 });
                expect(sim.spawn).not.toHaveBeenCalled();
                expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
                return { floats: effects.floats(), stage };
            };
            for (const lines of [1, 2, 3, 4]) expect(launch(lines).floats).toHaveLength(lines);
            // Never none, whatever the payload says.
            for (const lines of [0, -2, 0.2]) expect(launch(lines, 0.25).floats).toHaveLength(1);

            const { floats, stage } = launch(4);
            const centre = stage.centre();
            const { right } = stage;
            const halfCard = stage.edge(1, 0.5).sub(centre).dot(right);
            const across = (lantern) => (lantern.x - centre.x) * right.x + (lantern.z - centre.z) * right.z;
            const sides = floats.map((lantern) => Math.sign(across(lantern)));
            expect(sides.filter((side) => side < 0)).toHaveLength(2);
            expect(sides.filter((side) => side > 0)).toHaveLength(2);
            floats.forEach((lantern, index) => {
                expect([lantern.x, lantern.z, lantern.vx, lantern.vz, lantern.power].every(Number.isFinite)).toBe(true);
                // Launched out past the card's edges, so the card never hides one being set down.
                expect(Math.abs(across(lantern))).toBeGreaterThan(halfCard);
                // Each drifts in toward the middle of the lake and away from the garden.
                expect(lantern.vx * sides[index]).toBeLessThan(0);
                expect(lantern.vz).toBeLessThan(0);
                expect(Math.hypot(lantern.vx, lantern.vz)).toBeLessThan(1);
                expect(lantern.power).toBeGreaterThanOrEqual(1);
            });
            // Successive clears start from opposite banks.
            expect(Math.sign(launch(1, 0.25, 0).floats[0].vx)).toBe(-Math.sign(launch(1, 0.25, 1).floats[0].vx));
            // A bigger clear lights its lanterns brighter.
            expect(launch(4, 1).floats[0].power).toBeGreaterThan(launch(4, 0.25).floats[0].power);
        });

        it('releases a staggered flight of sky lanterns, bigger for a stronger event and a richer tier', () => {
            let eyeZ = 0;
            const flight = (strength, skyLanterns = 40) => {
                const {
                    director, effects, sim, camera,
                } = createDirector({ skyLanterns });
                eyeZ = camera.position.z;
                const log = play(director, sim, [{ kind: 'lanterns', strength, duration: 2.6 }], { seconds: 2.5 });
                expect(sim.spawn).not.toHaveBeenCalled();
                expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
                return effects.skies();
            };
            const full = flight(1);
            const part = flight(0.5);
            expect(full.length).toBeGreaterThan(part.length);
            expect(part.length).toBeGreaterThan(0);
            // Never more than the tier has lanterns for, never fewer than a handful.
            expect(full.length).toBeLessThanOrEqual(40);
            expect(flight(1, 12).length).toBeLessThan(full.length);
            expect(flight(1, 12).length).toBeLessThanOrEqual(12);
            expect(flight(0.1, 4).length).toBeGreaterThanOrEqual(2);
            for (const lantern of full) {
                expect([lantern.x, lantern.y, lantern.z, lantern.delay].every(Number.isFinite)).toBe(true);
                // Released from just above the ground or the water, beyond the camera.
                const ground = sakuraSurfaceHeight(lantern.x, lantern.z);
                expect(lantern.y).toBeGreaterThan(ground);
                expect(lantern.y).toBeLessThan(ground + 3);
                expect(lantern.z).toBeLessThan(eyeZ);
                expect(lantern.delay).toBeGreaterThanOrEqual(0);
                expect(lantern.delay).toBeLessThan(10);
            }
            // Staggered in time and spread over both banks and the far shore.
            const delays = full.map((lantern) => lantern.delay);
            expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(1);
            expect(full.some((lantern) => lantern.x < 0) && full.some((lantern) => lantern.x > 0)).toBe(true);
            const depths = full.map((lantern) => lantern.z);
            expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(30);
        });

        it('works without any of the garden hooks', () => {
            const every = ['lock', 'clear', 'shower', 'combo', 'spin', 'rise', 'star', 'floats', 'lanterns']
                .map((kind, index) => emitter({
                    id: index, serial: index, kind, lines: 2, age: 0.1,
                }));
            for (const effects of [{}, { ring: null, star: undefined }]) {
                const { sim, director } = createDirector({ effects });
                expect(() => director.apply(frameWith(every, { vortex: 0.6 }), STEP)).not.toThrow();
                expect(sim.spawn).toHaveBeenCalled();
            }
            const bare = new SakuraPetalDirector({
                stage: new SakuraStage(frameCamera()), sim: spySim(), tier: { petals: 2000, skyLanterns: 18 },
            });
            expect(() => bare.apply(frameWith(every, { vortex: 0.6 }), STEP)).not.toThrow();
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
            // A front at +/-1 stands at the edge of the view somewhere out over the lake.
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

        it('stills the air as the game ends, without ever reversing it', () => {
            const { director } = createDirector();
            const wind = { x: 1, z: 0, strength: 0.4 };
            const breeze = (hush) => director.apply(frameWith([], { hush }), STEP, wind).breeze;
            const open = breeze(0);
            expect(breeze(0.5)).toBeLessThan(open);
            expect(breeze(1)).toBeLessThan(breeze(0.5));
            expect(breeze(1)).toBeLessThan(open / 2);
            expect(breeze(1)).toBeGreaterThanOrEqual(0);
            expect(breeze(9)).toBe(breeze(1));
            for (const hush of [-2, NaN, Infinity, undefined, null, '1']) expect(breeze(hush)).toBe(open);
            // The hush is about the breeze; a gust already rolling keeps its strength.
            expect(director.apply(frameWith([], { hush: 1, gust: 0.5 }), STEP, wind).gust)
                .toBe(director.apply(frameWith([], { hush: 0, gust: 0.5 }), STEP, wind).gust);
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
            const { sim, director, effects } = createDirector();
            const frame = frameWith([emitter({ id: 0, serial: 0 }), emitter({ id: 1, serial: 1, kind: 'combo' }),
                emitter({
                    id: 2, serial: 2, kind: 'clear', age: 0.2,
                }),
                emitter({ id: 3, serial: 3, kind: 'star' })], { vortex: 1 });
            director.apply(frame, 0);
            const once = sim.spawn.mock.calls.length;
            expect(once).toBeGreaterThan(0);
            director.apply(frame, 0);
            expect(sim.spawn).toHaveBeenCalledTimes(once);
            expect(effects.star).toHaveBeenCalledOnce();
            expect(director.fields.length).toBeGreaterThan(0);
            director.reset();
            expect(director.fields).toEqual([]);
            expect(director.vortexFeed).toBe(0);
            // A new session starts its serials at zero again: the same numbers must play again.
            director.apply(frame, 0);
            expect(sim.spawn).toHaveBeenCalledTimes(once * 2);
            expect(effects.star).toHaveBeenCalledTimes(2);
        });

        it('scales every throw with the petal budget of the tier', () => {
            const thrown = (petals, kind) => {
                const { sim, director } = createDirector({ petals });
                play(director, sim, [{
                    kind, strength: 0.8, lines: 4, duration: 3,
                }], { seconds: 2 });
                return sim.spawn.mock.calls.length;
            };
            const budgets = [SAKURA_TIERS.Minimal, SAKURA_TIERS.Medium, SAKURA_TIERS.High, SAKURA_TIERS.Extreme]
                .map((tier) => tier.petals);
            for (const kind of ['lock', 'clear', 'shower', 'combo', 'spin']) {
                const counts = budgets.map((petals) => thrown(petals, kind));
                expect(counts[0]).toBeGreaterThan(0);
                for (let index = 1; index < counts.length; index += 1) {
                    expect(counts[index], kind).toBeGreaterThan(counts[index - 1]);
                }
                // However small the budget, an event is never silent.
                expect(thrown(1, kind), kind).toBeGreaterThan(0);
            }
            const feed = (petals) => {
                const { sim, director } = createDirector({ petals });
                for (let frame = 0; frame < 120; frame += 1) director.apply(frameWith([], { vortex: 0.8 }), STEP);
                return sim.spawn.mock.calls.length;
            };
            expect(feed(SAKURA_TIERS.Extreme.petals)).toBeGreaterThan(feed(SAKURA_TIERS.High.petals));
            expect(feed(SAKURA_TIERS.High.petals)).toBeGreaterThan(feed(SAKURA_TIERS.Minimal.petals));
            expect(feed(SAKURA_TIERS.Minimal.petals)).toBeGreaterThan(0);
        }, 30000);

        // An event must never ask for more petals than the tier keeps hidden for it, or the
        // simulation would have to steal petals that are still lying in view from the last one.
        it.each(Object.keys(SAKURA_TIERS))('keeps a four-line clear inside the %s tier\'s petal budget', (quality) => {
            const tier = SAKURA_TIERS[quality];
            const { sim, director } = createDirector({ petals: tier.petals, skyLanterns: tier.skyLanterns });
            const reactions = new SakuraReactions({ quality, rng: seededRandom(3) });
            reactions.onPieceLock({ piece: { x: 1, y: 20, shape: [[1]] } });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            for (let frame = 0; frame < 240; frame += 1) director.apply(reactions.update(STEP), STEP);
            expect(sim.spawn.mock.calls.length).toBeGreaterThan(20);
            expect(sim.spawn.mock.calls.length).toBeLessThan(tier.petals);
        });

        it('keeps crowns near the board as shed points and drops the rest', () => {
            const crownPoints = new Float32Array([
                -12, 14, -6, 0,
                45, 15, -10, 1,
                3, 12, -70, 0.5,
                9, 11, 2, 1,
            ]);
            const { director } = createDirector({ crownPoints });
            expect(director.shedPoints).toEqual([-12, 14, -6, 9, 11, 2]);
            expect(createDirector().director.shedPoints).toEqual([]);
        });

        it('ignores frames and emitters it does not understand', () => {
            const { sim, director, effects } = createDirector();
            for (const frame of [undefined, {}, { emitters: null }, { emitters: [] }, { emitters: 'lock' },
                frameWith([emitter({ kind: 'confetti' }), emitter({ id: 1, serial: 1, kind: undefined })])]) {
                expect(() => director.apply(frame, STEP)).not.toThrow();
            }
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(director.fields).toEqual([]);
            for (const hook of [effects.ring, effects.flash, effects.star, effects.floatLantern, effects.skyLantern]) {
                expect(hook).not.toHaveBeenCalled();
            }
        });

        it('throws nothing and never fails when the simulation has no reserve', () => {
            const sim = new SakuraPetalSim({
                count: 80,
                reserve: 0,
                rng: seededRandom(5),
                surface: sakuraSurfaceHeight,
                waterLevel: SAKURA_WATER_LEVEL,
            });
            const { director, effects } = createDirector({ sim });
            const reactions = new SakuraReactions({ quality: 'Minimal', rng: seededRandom(6) });
            const before = { state: Array.from(sim.state), position: Array.from(sim.position) };
            reactions.onHardDrop({ distance: 15 });
            reactions.onPieceLock({ piece: { x: 1, y: 20, shape: [[1]] } });
            reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
            reactions.onCombo(12);
            reactions.onTwist();
            reactions.onPerfectClear();
            for (let frame = 0; frame < 90; frame += 1) {
                const env = director.apply(reactions.update(STEP), STEP, { x: 1, z: 0, strength: 0.3 });
                expect(Array.isArray(env.fields)).toBe(true);
            }
            expect(Array.from(sim.state)).toEqual(before.state);
            expect(Array.from(sim.position)).toEqual(before.position);
            expect(sim.counts().idle).toBe(0);
            // The lights do not depend on the petals.
            expect(effects.ring).toHaveBeenCalled();
            expect(effects.flash).toHaveBeenCalled();
            expect(effects.star).toHaveBeenCalled();
            expect(effects.floatLantern).toHaveBeenCalled();
            expect(effects.skyLantern).toHaveBeenCalled();
        });
    });

    describe('with the real director and simulation', () => {
        function garden(quality = 'High', { ambient = 300, reserve = 500 } = {}) {
            const tier = SAKURA_TIERS[quality];
            const sim = new SakuraPetalSim({
                count: ambient + reserve,
                reserve,
                rng: seededRandom(9),
                surface: sakuraSurfaceHeight,
                waterLevel: SAKURA_WATER_LEVEL,
            });
            const built = createDirector({ sim, petals: tier.petals, skyLanterns: tier.skyLanterns });
            const reactions = new SakuraReactions({ quality, rng: seededRandom(3) });
            const wind = { x: 0.96, z: 0.28, strength: 0.24 };
            const advance = (seconds) => {
                for (let frame = 0; frame < seconds * 60; frame += 1) {
                    sim.step(STEP, built.director.apply(reactions.update(STEP), STEP, wind));
                }
            };
            const eventPetals = () => {
                const result = [];
                for (let index = sim.ambient; index < sim.count; index += 1) {
                    if (sim.state[index] === PETAL_AIR) {
                        const o = index * 3;
                        result.push({
                            x: sim.position[o],
                            y: sim.position[o + 1],
                            z: sim.position[o + 2],
                            vx: sim.velocity[o],
                            vz: sim.velocity[o + 2],
                        });
                    }
                }
                return result;
            };
            return {
                ...built, sim, reactions, advance, eventPetals,
            };
        }

        it('puts the petals of a lock in the air on the side of the piece, out of the reserve', () => {
            const left = garden();
            const right = garden();
            left.reactions.onHardDrop({ distance: 16 });
            left.reactions.onPieceLock({ piece: { x: 0, y: 10, shape: [[1]] } });
            right.reactions.onHardDrop({ distance: 16 });
            right.reactions.onPieceLock({ piece: { x: 9, y: 10, shape: [[1]] } });
            expect(left.sim.counts().idle).toBe(500);
            left.advance(0.2);
            right.advance(0.2);
            const centre = left.stage.centre();
            const leftPetals = left.eventPetals();
            const rightPetals = right.eventPetals();
            expect(leftPetals.length).toBeGreaterThan(10);
            expect(rightPetals.length).toBe(leftPetals.length);
            for (const entry of leftPetals) expect(entry.x).toBeLessThan(centre.x);
            for (const entry of rightPetals) expect(entry.x).toBeGreaterThan(centre.x);
            expect(left.sim.counts().idle).toBe(500 - leftPetals.length);
            // The ring went out on the same side of the lake.
            expect(left.effects.rings()[0].x).toBeLessThan(right.effects.rings()[0].x);
        });

        it('plays a line clear as jets, a ring and lanterns, and four lines as a blizzard under shooting stars', () => {
            const two = garden();
            two.reactions.onLineClear(2, { clearedRows: [14, 15] });
            two.advance(1);
            expect(two.effects.ring).toHaveBeenCalledOnce();
            expect(two.effects.floatLantern).toHaveBeenCalledTimes(2);
            expect(two.effects.star).not.toHaveBeenCalled();
            const jets = two.sim.reserve - two.sim.counts().idle;
            expect(jets).toBeGreaterThan(20);

            const four = garden();
            four.reactions.onLineClear(4, { clearedRows: [12, 13, 14, 15] });
            four.advance(1);
            expect(four.effects.ring).toHaveBeenCalledOnce();
            expect(four.effects.floatLantern).toHaveBeenCalledTimes(4);
            expect(four.effects.star).toHaveBeenCalled();
            expect(four.sim.reserve - four.sim.counts().idle).toBeGreaterThan(jets);
            expect(four.effects.rings()[0].strength).toBeGreaterThan(two.effects.rings()[0].strength);
            expect(four.effects.skyLantern).not.toHaveBeenCalled();
        });

        it('releases sky lanterns for a level up and a shooting star for a twist', () => {
            const {
                reactions, effects, advance, sim,
            } = garden('Medium');
            reactions.onLevelUp();
            advance(0.5);
            const released = effects.skyLantern.mock.calls.length;
            expect(released).toBeGreaterThanOrEqual(3);
            expect(released).toBeLessThanOrEqual(SAKURA_TIERS.Medium.skyLanterns);
            expect(sim.counts().idle).toBe(sim.reserve);
            reactions.onTwist({ piece: { x: 8, y: 14, shape: [[1]] } });
            advance(0.5);
            expect(effects.star).toHaveBeenCalledOnce();
            expect(effects.skyLantern).toHaveBeenCalledTimes(released);
            expect(sim.counts().idle).toBeLessThan(sim.reserve);
        });

        it('lifts the fallen petals around the board on a perfect clear', () => {
            const down = (sim) => {
                let count = 0;
                for (let index = 0; index < sim.ambient; index += 1) {
                    if (sim.state[index] === PETAL_REST || sim.state[index] === PETAL_FLOAT) count += 1;
                }
                return count;
            };
            const quiet = garden('High', { ambient: 600, reserve: 0 });
            const perfect = garden('High', { ambient: 600, reserve: 0 });
            const lying = down(perfect.sim);
            expect(lying).toBeGreaterThan(100);
            expect(down(quiet.sim)).toBe(lying);
            perfect.reactions.onPerfectClear();
            quiet.advance(1);
            perfect.advance(1);
            // With no reserve nothing new is thrown: these are the garden's own fallen petals.
            expect(down(perfect.sim)).toBeLessThan(down(quiet.sim) - 20);
            expect(perfect.sim.counts().air).toBeGreaterThan(quiet.sim.counts().air + 20);
        }, 30000);

        it('winds event petals around the board when a combo builds, and lets them settle afterwards', () => {
            const {
                reactions, sim, stage, advance, eventPetals,
            } = garden();
            for (let cascade = 2; cascade <= 9; cascade += 1) {
                reactions.onCombo(cascade);
                advance(0.4);
            }
            expect(reactions.getFrame().vortex).toBeGreaterThan(0.3);
            const centre = stage.centre();
            const turning = eventPetals().filter((entry) => Math.hypot(entry.x - centre.x, entry.z - centre.z) < 6);
            expect(turning.length).toBeGreaterThan(40);
            const circulation = turning.map((entry) => (
                (entry.x - centre.x) * entry.vz - (entry.z - centre.z) * entry.vx));
            expect(mean(circulation)).toBeGreaterThan(0);
            expect(circulation.filter((value) => value > 0).length).toBeGreaterThan(turning.length * 0.8);
            expect(mean(turning.map((entry) => entry.y)))
                .toBeGreaterThan(sakuraSurfaceHeight(centre.x, centre.z) + 0.5);
            // The combo ends: the stream unwinds, the petals land and return to the reserve.
            advance(45);
            expect(reactions.getFrame().vortex).toBe(0);
            expect(eventPetals()).toEqual([]);
            expect(sim.counts().idle).toBe(500);
            for (const key of ['position', 'velocity', 'outPosition', 'outRotation', 'outLook']) {
                expect(sim[key].every(Number.isFinite)).toBe(true);
            }
        }, 30000);
    });
});

/**
 * The second pass over the garden's answers (2026-11): each event has an instrument of its own
 * (sakura-showpieces.js), so the director has four more hooks (`splash`, `helix`, `gate`,
 * `spirit`), reads the fireflies' swarm out of the frame, and makes the lake's rings give way to
 * one another (`ripple`).
 */
describe('Sakura petal director: each event\'s own instrument', () => {
    /** Every hook the garden offers, recording what is asked of it. */
    function showEffects() {
        const effects = spyEffects();
        Object.assign(effects, {
            splash: vi.fn(), helix: vi.fn(), gate: vi.fn(), spirit: vi.fn(),
        });
        effects.splashes = () => effects.splash.mock.calls.map(([x, z, strength]) => ({ x, z, strength }));
        effects.helices = () => effects.helix.mock.calls.map(([x, y, z, side, strength, height]) => ({
            x, y, z, side, strength, height,
        }));
        return effects;
    }

    const screenOf = (camera, x, y, z) => {
        const point = ndc(new THREE.Vector3(x, y, z), camera);
        return { x: point.x * 0.5 + 0.5, y: 0.5 - point.y * 0.5, ahead: point.z < 1 };
    };

    describe('the crown of spray', () => {
        it.each([
            ['landscape', LANDSCAPE], ['portrait', PORTRAIT], ['a square window', 1], ['an ultrawide one', 21 / 9],
        ])('stands on open water beside the card on the piece\'s side, in view, in %s', (_label, aspect) => {
            for (const seed of [1, 2, 3, 4, 5, 6]) {
                const effects = showEffects();
                const {
                    director, sim, stage, camera,
                } = createDirector({ aspect, seed, effects });
                for (let event = 0; event < 60; event += 1) {
                    const side = event % 2 ? 1 : -1;
                    const strength = 0.12 + (event % 9) * 0.1;
                    director.apply(frameWith([emitter({
                        id: event % 7, serial: event, kind: 'splash', side, strength, age: STEP, duration: 0.5,
                    })]), STEP);
                    expect(effects.splash, `event ${event}`).toHaveBeenCalledTimes(event + 1);
                    const crown = effects.splashes().at(-1);
                    expect([crown.x, crown.z].every(Number.isFinite)).toBe(true);
                    // How far the piece fell, as the frame gave it.
                    expect(crown.strength).toBe(strength);
                    // On the lake, never on a bank: the banks reach in under the card's corners.
                    expect(sakuraSurfaceHeight(crown.x, crown.z)).toBeLessThanOrEqual(SAKURA_WATER_LEVEL + 0.001);
                    expect(sakuraLand(crown.x, crown.z)).toBeLessThan(0.01);
                    // Out past the card's edge on the piece's side, where it can be seen.
                    const seen = screenOf(camera, crown.x, SAKURA_WATER_LEVEL, crown.z);
                    expect(seen.ahead).toBe(true);
                    if (side < 0) expect(seen.x).toBeLessThan(stage.board.x0);
                    else expect(seen.x).toBeGreaterThan(stage.board.x1);
                    expect(seen.x).toBeGreaterThan(0);
                    expect(seen.x).toBeLessThan(1);
                    expect(seen.y).toBeGreaterThan(0.5);
                    expect(seen.y).toBeLessThan(1);
                }
                // Spray is light: no petals, no force on the petals, and no ring of its own (the
                // lock's ring is already crossing the lake).
                expect(sim.spawn).not.toHaveBeenCalled();
                expect(director.fields).toEqual([]);
                expect(effects.ring).not.toHaveBeenCalled();
                expect(effects.flash).not.toHaveBeenCalled();
            }
        });

        it('rises once for a hard drop: later frames of the same emitter add nothing', () => {
            const effects = showEffects();
            const { director, sim } = createDirector({ effects });
            play(director, sim, [{
                kind: 'splash', side: -1, strength: 0.7, duration: 0.5,
            }], { seconds: 0.45 });
            expect(effects.splash).toHaveBeenCalledOnce();
            expect(effects.splash.mock.calls[0][2]).toBe(0.7);
            // The same slot under a new serial is another hard drop.
            director.apply(frameWith([emitter({
                id: 0, serial: 5, kind: 'splash', side: 1, strength: 0.3,
            })]), STEP);
            expect(effects.splash).toHaveBeenCalledTimes(2);
        });

        it('is not raised at all where there is no open water to raise it on', () => {
            const dry = showEffects();
            const land = createDirector({ effects: dry, surface: () => 1.5 });
            for (let event = 0; event < 40; event += 1) {
                expect(land.director.splash(emitter({ kind: 'splash', side: event % 2 ? 1 : -1 }))).toBe(false);
            }
            expect(dry.splash).not.toHaveBeenCalled();
            expect(dry.ring).not.toHaveBeenCalled();
            // A lake that only begins further out is found by reaching further, never by settling
            // for the bank.
            const far = showEffects();
            const shore = (x, z) => (z > -18 ? 0.8 : 0);
            const reaching = createDirector({ effects: far, surface: shore });
            let raised = 0;
            for (let event = 0; event < 200; event += 1) {
                if (reaching.director.splash(emitter({ kind: 'splash', side: event % 2 ? 1 : -1 }))) raised += 1;
            }
            expect(raised).toBeGreaterThan(100);
            expect(far.splash).toHaveBeenCalledTimes(raised);
            for (const crown of far.splashes()) expect(shore(crown.x, crown.z)).toBe(0);
            // Without the hook it still looks, and says whether it found water.
            const bare = createDirector({ effects: {} });
            expect(bare.director.splash(emitter({ kind: 'splash', side: -1 }))).toBe(true);
        });
    });

    describe('the double helix', () => {
        it.each([[-1], [1]])('winds up beside the card where the piece turned, once, on side %i', (side) => {
            const effects = showEffects();
            const { director, sim, stage } = createDirector({ effects });
            const log = play(director, sim, [{
                kind: 'spin', side, row: 0.6, strength: 0.8, duration: 1.7,
            }], { seconds: 1.6 });
            expect(effects.helix).toHaveBeenCalledOnce();
            const [helix] = effects.helices();
            const edge = stage.edge(side, 0.6, SAKURA_STAGE_DEPTH, undefined, 0.01);
            const centre = stage.centre();
            // Its foot is on the ground two metres out from the card's edge, on the twist's side.
            expect(helix.x).toBeCloseTo(edge.x + side * 2, 9);
            expect(helix.z).toBeCloseTo(edge.z, 9);
            expect((helix.x - centre.x) * side).toBeGreaterThan(Math.abs(edge.x - centre.x));
            expect(helix.y).toBeCloseTo(sakuraSurfaceHeight(helix.x, helix.z) + 0.15, 9);
            expect(helix.side).toBe(side);
            // A twist that cleared lines is a whole helix; it stands to above where the piece turned.
            expect(helix.strength).toBeCloseTo(1, 9);
            expect(helix.height).toBeCloseTo(Math.max(3.2, edge.y + 2.4 - helix.y), 9);
            expect(helix.y + helix.height).toBeGreaterThan(edge.y + 2);
            // A few real petals are caught up in it (fewer than the spiral once threw): 34 at the
            // reference budget, and the small vortex that carries them.
            expect(log[0].spawned).toBe(34);
            expect(log.slice(1).every((entry) => entry.spawned === 0)).toBe(true);
            expect(log[0].fields.map((field) => field.kind)).toEqual(['vortex']);
        });

        it('is smaller for a twist that cleared nothing, never shorter than a person, and scales its petals', () => {
            const helixFor = (overrides, options = {}) => {
                const effects = showEffects();
                const built = createDirector({ effects, ...options });
                built.director.apply(frameWith([emitter({ kind: 'spin', ...overrides })]), STEP);
                expect(effects.helix).toHaveBeenCalledOnce();
                return { ...effects.helices()[0], thrown: built.sim.spawn.mock.calls.length };
            };
            // (SakuraReactions sends 0.8 for a twist that cleared lines and 0.48 for one that did not.)
            expect(helixFor({ strength: 0.8 }).strength).toBeCloseTo(1, 9);
            expect(helixFor({ strength: 0.48 }).strength).toBeCloseTo(0.6, 9);
            // At the foot of the card the piece is below the eye: the helix still stands 3.2 m.
            const low = helixFor({ row: 0, side: -1 });
            const high = helixFor({ row: 1, side: -1 });
            expect(low.height).toBeGreaterThanOrEqual(3.2);
            expect(high.height).toBeGreaterThan(low.height);
            for (const helix of [low, high]) {
                expect([helix.x, helix.y, helix.z, helix.strength, helix.height].every(Number.isFinite)).toBe(true);
            }
            // The real petals follow the tier's budget; the helix itself is the showpieces'.
            expect(helixFor({}, { petals: 6000 }).thrown).toBe(34);
            expect(helixFor({}, { petals: 12000 }).thrown).toBe(68);
            expect(helixFor({}, { petals: 1100 }).thrown).toBe(Math.round(34 * 0.2));
            // A slot reused under a new serial is another twist.
            const effects = showEffects();
            const { director } = createDirector({ effects });
            director.apply(frameWith([emitter({ kind: 'spin', id: 2, serial: 1 })]), STEP);
            director.apply(frameWith([emitter({
                kind: 'spin', id: 2, serial: 1, age: 0.3,
            })]), STEP);
            director.apply(frameWith([emitter({ kind: 'spin', id: 2, serial: 2 })]), STEP);
            expect(effects.helix).toHaveBeenCalledTimes(2);
        });
    });

    describe('the gate and the star fox', () => {
        it('wakes the gate once for a back-to-back and sends the star fox once for a perfect clear', () => {
            const effects = showEffects();
            const { director, sim } = createDirector({ effects });
            const log = play(director, sim, [
                { kind: 'gate', strength: 0.55, duration: 1.2 },
                { kind: 'spirit', strength: 1, duration: 2.6 },
            ], { seconds: 2.5 });
            expect(effects.gate).toHaveBeenCalledExactlyOnceWith(0.55);
            expect(effects.spirit).toHaveBeenCalledExactlyOnceWith(1);
            // Both are light: nothing is thrown, nothing pushes the petals, and the director itself
            // sends no ring (the gate's ring is the garden's to place).
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            for (const hook of [effects.ring, effects.flash, effects.star, effects.splash, effects.helix]) {
                expect(hook).not.toHaveBeenCalled();
            }
            // New serials are new events.
            director.apply(frameWith([
                emitter({
                    id: 0, serial: 7, kind: 'gate', strength: 1,
                }),
                emitter({
                    id: 1, serial: 8, kind: 'spirit', strength: 0.7,
                }),
            ]), STEP);
            expect(effects.gate.mock.calls).toEqual([[0.55], [1]]);
            expect(effects.spirit.mock.calls).toEqual([[1], [0.7]]);
        });

        it('plays every new kind without any of the garden\'s hooks', () => {
            const every = ['splash', 'gate', 'spirit', 'swarm', 'spin'].map((kind, index) => emitter({
                id: index, serial: index, kind, age: 0.1,
            }));
            for (const effects of [{}, {
                splash: null, helix: undefined, gate: null, spirit: undefined,
            }]) {
                const { director } = createDirector({ effects });
                expect(() => director.apply(frameWith(every), STEP)).not.toThrow();
                expect(director.swarm).toBeGreaterThan(0);
            }
        });
    });

    describe('the fireflies\' swarm', () => {
        const swarm = (overrides) => emitter({
            kind: 'swarm', strength: 0.8, duration: 3.4, ...overrides,
        });

        it('rests at nothing, and offers the simulation a place for the air\'s share of falling petals', () => {
            const { director } = createDirector();
            expect(director.swarm).toBe(0);
            const env = director.apply(frameWith(), STEP);
            expect(env.swarm).toBe(0);
            // (`fall` is the weather's: the director only keeps its place, at all of them.)
            expect(env.fall).toBe(1);
            expect(Object.keys(env).sort())
                .toEqual(['breeze', 'fall', 'fields', 'front', 'fronts', 'gust', 'swarm', 'windX', 'windZ']);
            expect(env.shore).toBeUndefined();
        });

        it('rises from nothing, is whole at the middle of its life and sinks back to nothing', () => {
            const { director } = createDirector();
            const at = (age) => director.apply(frameWith([swarm({ age })]), STEP).swarm;
            expect(at(0)).toBe(0);
            expect(at(1.7)).toBeCloseTo(0.8, 9);
            expect(at(3.4)).toBeLessThan(1e-9);
            expect(at(3.4)).toBeGreaterThanOrEqual(0);
            // Exactly its strength times the sine of its life, softened.
            for (const age of [0.1, 0.5, 1, 2.4, 3.3]) {
                expect(at(age), `age ${age}`).toBeCloseTo(0.8 * Math.sin(Math.PI * (age / 3.4)) ** 0.7, 12);
            }
            expect(director.swarm).toBe(director.env.swarm);
            // An age past its life (a long frame) is its end, not a negative rise.
            for (const age of [3.5, 10, 1e9]) {
                const value = at(age);
                expect(value >= 0 && value < 1e-9, `age ${age}: ${value}`).toBe(true);
            }
            // Gone from the frame, gone from the garden.
            expect(director.apply(frameWith(), STEP).swarm).toBe(0);
            expect(director.swarm).toBe(0);
        });

        it('never steps: a frame moves it a little, at the start, at the height and at the end', () => {
            const { director } = createDirector();
            let last = 0;
            let steepest = 0;
            for (let frame = 0; frame <= Math.ceil(3.4 * 60); frame += 1) {
                const live = [swarm({ strength: 1, age: Math.min(3.4, frame * STEP) })];
                const value = director.apply(frameWith(live), STEP).swarm;
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(1);
                steepest = Math.max(steepest, Math.abs(value - last));
                last = value;
            }
            // (Its first and last frames are the steepest: a twentieth of the way.)
            expect(steepest).toBeLessThan(0.06);
            expect(last).toBeLessThan(1e-9);
        });

        it('is the highest of the swarms still playing, so a second one never drops it', () => {
            const { director } = createDirector();
            const rise = (strength, age) => (
                age < 0 || age > 3.4 ? 0 : strength * Math.sin(Math.PI * (age / 3.4)) ** 0.7);
            let last = 0;
            const trace = [];
            // Three lines, and four lines 1.2 s later.
            for (let frame = 0; frame <= 60 * 5; frame += 1) {
                const t = frame * STEP;
                const live = [];
                if (t < 3.4) live.push(swarm({ id: 0, serial: 0, age: t }));
                if (t >= 1.2 && t < 4.6) {
                    live.push(swarm({
                        id: 1, serial: 1, strength: 1, age: t - 1.2,
                    }));
                }
                const value = director.apply(frameWith(live), STEP).swarm;
                // No step when the second starts (it starts at nothing, under the first), when it
                // overtakes, or when the first ends (it ends at nothing, under the second).
                expect(Math.abs(value - last), `t ${t.toFixed(3)}`).toBeLessThan(0.06);
                // Never under either of them: the second cannot pull the first one's cloud down.
                expect(value).toBeGreaterThanOrEqual(Math.max(rise(0.8, t), rise(1, t - 1.2)) - 1e-9);
                expect(value).toBeLessThanOrEqual(1);
                trace.push(value);
                last = value;
            }
            // It reaches the first one's height, goes on to the second one's and ends at nothing.
            expect(trace[Math.round(1.7 * 60)]).toBeCloseTo(0.8, 3);
            expect(Math.max(...trace)).toBeCloseTo(1, 3);
            expect(trace.indexOf(Math.max(...trace)) * STEP).toBeCloseTo(1.2 + 1.7, 1);
            expect(trace.at(-1)).toBe(0);
        });

        it('throws nothing and pushes nothing: the fireflies are the garden\'s, not the simulation\'s', () => {
            const effects = showEffects();
            const { director, sim } = createDirector({ effects });
            const log = play(director, sim, [{ kind: 'swarm', strength: 1, duration: 3.4 }], { seconds: 3.3 });
            expect(sim.spawn).not.toHaveBeenCalled();
            expect(log.every((entry) => entry.fields.length === 0)).toBe(true);
            for (const hook of Object.values(effects).filter((value) => value?.mock)) {
                expect(hook).not.toHaveBeenCalled();
            }
        });
    });

    describe('rings that make room for one another', () => {
        const lock = (serial, strength = 0.66) => emitter({
            id: serial % 6, serial, kind: 'lock', strength, age: STEP, duration: 1.2,
        });

        it('sends the first ring of a run whole and each that follows hard on it fainter', () => {
            const { director, effects } = createDirector();
            expect(director.ringLoad).toBe(0);
            director.apply(frameWith([lock(0)]), STEP);
            const [first] = effects.rings();
            // Whole: what a lock of that strength always sent.
            expect(first.strength).toBeCloseTo(0.45 + 0.66 * 0.9, 12);
            expect(director.ringLoad).toBeCloseTo(first.strength, 12);
            director.apply(frameWith([lock(1)]), STEP);
            const second = effects.rings()[1];
            const load = first.strength * Math.exp(-STEP / 1.2);
            expect(second.strength).toBeCloseTo(first.strength / (1 + 1.3 * load), 12);
            expect(second.strength).toBeLessThan(first.strength * 0.5);
            expect(director.ringLoad).toBeCloseTo(load + second.strength, 12);
            // Where a ring lands is not changed by how strong it is let be.
            const alone = createDirector();
            alone.director.apply(frameWith([lock(0)]), STEP);
            expect(alone.effects.rings()[0]).toEqual(first);
        });

        it('forgets the light the last rings left over a second or so, whatever the frame rate', () => {
            for (const fps of [30, 60, 144]) {
                const { director, effects } = createDirector();
                director.apply(frameWith([lock(0)]), 1 / fps);
                const sent = effects.rings()[0].strength;
                const frames = Math.round(fps * 1.2);
                for (let frame = 0; frame < frames; frame += 1) director.apply(frameWith(), 1 / fps);
                // (To 1/e in 1.2 s: the same fall at any frame rate.)
                expect(director.ringLoad, `${fps} fps`).toBeCloseTo(sent * Math.exp(-(frames / fps) / 1.2), 9);
                expect(director.ringLoad / sent).toBeCloseTo(1 / Math.E, 2);
                for (let frame = 0; frame < fps * 12; frame += 1) director.apply(frameWith(), 1 / fps);
                expect(director.ringLoad).toBeLessThan(1e-3);
                // After a rest the next ring is whole again (to a part in a thousand).
                director.apply(frameWith([lock(1)]), 1 / fps);
                expect(effects.rings()[1].strength).toBeGreaterThan(sent * 0.998);
            }
            // A paused frame, a frame of nonsense: nothing is forgotten, nothing goes wrong.
            const { director } = createDirector();
            director.apply(frameWith([lock(0)]), STEP);
            const held = director.ringLoad;
            for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, null, '0.5']) {
                director.apply(frameWith(), dt);
                expect(director.ringLoad, String(dt)).toBe(held);
            }
        });

        it('settles near two fifths of a ring for a hard-dropped lock every 0.42 s', () => {
            const settled = (strength) => {
                const { director, effects } = createDirector();
                let serial = 0;
                for (let frame = 0; frame < 60 * 30; frame += 1) {
                    const live = frame % 25 === 0 ? [lock(serial)] : [];
                    if (frame % 25 === 0) serial += 1;
                    director.apply(frameWith(live.map((entry) => ({ ...entry, strength }))), STEP);
                }
                const strengths = effects.rings().map((ring) => ring.strength);
                // The run only ever thins toward its level: no ring is stronger than the one before.
                for (let index = 1; index < strengths.length; index += 1) {
                    expect(strengths[index]).toBeLessThanOrEqual(strengths[index - 1] + 1e-9);
                }
                expect(strengths.every((value) => value > 0)).toBe(true);
                return strengths.at(-1) / strengths[0];
            };
            // (A hard drop from most of the way up locks at about 0.66; a piece set down, at 0.26.)
            expect(settled(0.66)).toBeGreaterThan(0.36);
            expect(settled(0.66)).toBeLessThan(0.46);
            expect(settled(0.26)).toBeGreaterThan(0.4);
            expect(settled(0.26)).toBeLessThan(0.55);
        });

        it('weighs a clear\'s ring with the lock\'s: together on the lake they are less than their sum', () => {
            const frame = (emitters) => frameWith(emitters);
            const jets = [-1, 1].map((side, index) => emitter({
                id: 3 + index,
                serial: 10 + index,
                kind: 'clear',
                side,
                lines: 2,
                strength: 0.7,
                age: STEP,
                duration: 1.74,
            }));
            const clearOnly = createDirector();
            clearOnly.director.apply(frame(jets), STEP);
            const [whole] = clearOnly.effects.rings();
            const both = createDirector();
            both.director.apply(frame([lock(0), ...jets]), STEP);
            const rings = both.effects.rings();
            expect(rings).toHaveLength(2);
            expect(rings[0].strength).toBeCloseTo(0.45 + 0.66 * 0.9, 12);
            expect(rings[1].strength).toBeCloseTo(whole.strength / (1 + 1.3 * rings[0].strength), 12);
            expect([rings[1].x, rings[1].z]).toEqual([whole.x, whole.z]);
        });

        it('sends no ring for no strength, and counts none', () => {
            const { director, effects } = createDirector();
            for (const strength of [0, -1, NaN, undefined, null, 'strong', -Infinity]) {
                director.ripple(1, -20, strength);
                expect(effects.ring, String(strength)).not.toHaveBeenCalled();
                expect(director.ringLoad).toBe(0);
            }
            director.ripple(1, -20, 0.5);
            expect(effects.ring).toHaveBeenCalledExactlyOnceWith(1, -20, 0.5);
            expect(director.ringLoad).toBe(0.5);
            // Without the hook the load is still kept (the ring would have been there).
            const bare = createDirector({ effects: {} });
            expect(() => bare.director.ripple(1, -20, 0.5)).not.toThrow();
            expect(bare.director.ringLoad).toBe(0.5);
        });

        it('starts a new session with a whole ring', () => {
            const { director, effects } = createDirector();
            for (let serial = 0; serial < 8; serial += 1) director.apply(frameWith([lock(serial)]), STEP);
            expect(director.ringLoad).toBeGreaterThan(1);
            director.reset();
            expect(director.ringLoad).toBe(0);
            director.apply(frameWith([lock(0)]), STEP);
            expect(effects.rings().at(-1).strength).toBeCloseTo(effects.rings()[0].strength, 12);
        });

        it('is gentler still as play runs hot, the two together', () => {
            const ringAt = (level) => {
                const { director, effects } = createDirector();
                director.apply(frameWith([lock(0)], { level }), STEP);
                return effects.rings()[0].strength;
            };
            expect(ringAt(1)).toBeCloseTo(ringAt(0) * 0.55, 12);
            expect(ringAt(0.5)).toBeLessThan(ringAt(0));
            expect(ringAt(0.5)).toBeGreaterThan(ringAt(1));
        });
    });

    describe('a flight of sky lanterns', () => {
        it('lifts most of a flight off the lake either side of the card, near to far, the rest from the banks', () => {
            const camera = frameCamera(LANDSCAPE);
            const effects = spyEffects();
            const { director, stage } = createDirector({ effects, skyLanterns: 44, seed: 11 });
            for (let flight = 0; flight < 200; flight += 1) {
                director.lanterns(emitter({ kind: 'lanterns', strength: 1, serial: flight }));
            }
            const lanterns = effects.skies();
            expect(lanterns).toHaveLength(200 * 44);
            const beside = lanterns.filter((lantern) => {
                const seen = screenOf(camera, lantern.x, lantern.y, lantern.z);
                const offCard = seen.x < stage.board.x0 || seen.x > stage.board.x1;
                return sakuraLand(lantern.x, lantern.z) <= 0 && offCard && seen.x > 0 && seen.x < 1 && seen.ahead;
            });
            // About two thirds of them stand in the water where it shows either side of the board.
            expect(beside.length / lanterns.length).toBeGreaterThan(0.5);
            expect(beside.length / lanterns.length).toBeLessThan(0.8);
            const left = beside.filter((lantern) => screenOf(camera, lantern.x, lantern.y, lantern.z).x < 0.5).length;
            expect(left / beside.length).toBeGreaterThan(0.35);
            expect(left / beside.length).toBeLessThan(0.65);
            // Near to far: from just past the knoll's bank to deep in the lake.
            const depths = beside.map((lantern) => camera.position.z - lantern.z);
            expect(Math.min(...depths)).toBeLessThan(30);
            expect(Math.max(...depths)).toBeGreaterThan(70);
            // Every one is released just above whatever it stands on, never under it, and in front.
            for (const lantern of lanterns) {
                expect([lantern.x, lantern.y, lantern.z, lantern.delay].every(Number.isFinite)).toBe(true);
                const ground = sakuraSurfaceHeight(lantern.x, lantern.z);
                expect(lantern.y).toBeGreaterThanOrEqual(ground + 0.6 - 1e-9);
                expect(lantern.y).toBeLessThan(ground + 1.5);
                expect(lantern.z).toBeLessThan(camera.position.z);
                expect(lantern.delay).toBeGreaterThanOrEqual(0);
                expect(lantern.delay).toBeLessThan(4.5);
            }
        });
    });

    describe('what it is handed', () => {
        // FAULT: sakura-petal-director.js apply() (the swarm loop, `Math.max(swarm, strength *
        // Math.sin(Math.PI * run) ** 0.7)`) lets a swarm emitter with a strength or a duration that
        // is not a number make `director.swarm` and `env.swarm` NaN (Math.max of NaN is NaN), and
        // one stronger than 1 take it past 1. SakuraReactions never emits either, and SakuraSpirits
        // clamps the swarm it is given, so play does not reach it; the director's own contract
        // (env.swarm in 0..1) does not hold for such a frame. Reproduce: director.apply({ emitters:
        // [{ id: 0, serial: 0, kind: 'swarm', strength: NaN, age: 1, duration: 3.4 }] }, 1 / 60).swarm
        // is NaN.
        it.fails('keeps the swarm a share whatever an emitter carries', () => {
            const { director } = createDirector();
            const junk = [NaN, Infinity, -Infinity, undefined, null, 'x', -1, 0, 7];
            for (const strength of junk) {
                for (const duration of junk) {
                    const env = director.apply(frameWith([{
                        id: 0, serial: 0, kind: 'swarm', strength, age: 1, duration,
                    }]), STEP);
                    const label = `swarm ${String(strength)} / ${String(duration)}: ${env.swarm}`;
                    expect(env.swarm >= 0 && env.swarm <= 1, label).toBe(true);
                }
            }
        });

        it('takes frames of nonsense without throwing, and leaves the garden as it was', () => {
            const effects = showEffects();
            const { director, sim } = createDirector({ effects });
            const junk = [undefined, null, NaN, Infinity, 'x', [], {}, -1, 1e308];
            for (const value of junk) {
                const frame = frameWith([
                    emitter({
                        id: 0, serial: 0, kind: 'gate', strength: value,
                    }),
                    emitter({
                        id: 1, serial: 1, kind: 'spirit', strength: value,
                    }),
                    emitter({
                        id: 2, serial: 2, kind: 'splash', strength: value, side: value,
                    }),
                ], {
                    level: value,
                    gust: value,
                    hush: value,
                    motion: value,
                    blizzard: value,
                    fronts: value,
                });
                expect(() => director.apply(frame, STEP), String(value)).not.toThrow();
                director.reset();
            }
            expect(sim.spawn).not.toHaveBeenCalled();
            // What the hooks were handed is what the frame carried: the garden's parts each guard
            // their own (SakuraShowpieces refuses a crown or a star fox that is not a number).
            expect(effects.gate).toHaveBeenCalledTimes(junk.length);
            expect(effects.spirit).toHaveBeenCalledTimes(junk.length);
            for (const crown of effects.splashes()) {
                expect([crown.x, crown.z].every(Number.isFinite)).toBe(true);
                expect(sakuraSurfaceHeight(crown.x, crown.z)).toBeLessThanOrEqual(SAKURA_WATER_LEVEL + 0.001);
            }
        });
    });
});
