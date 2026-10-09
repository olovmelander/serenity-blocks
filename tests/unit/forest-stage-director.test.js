import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { FOREST_FIGURES, forestFigure } from '../../src/themes/forest/forest-figures.js';
import { FOREST_WAVES, ForestFireflyDirector } from '../../src/themes/forest/forest-firefly-director.js';
import {
    FOREST_FIREFLY_DEW, FOREST_FIREFLY_SPARK, ForestFireflySim,
} from '../../src/themes/forest/forest-firefly-sim.js';
import { ForestPulses } from '../../src/themes/forest/forest-pulses.js';
import { FOREST_FIGURE_TIMING, ForestReactions } from '../../src/themes/forest/forest-reactions.js';
import {
    FOREST_DEFAULT_BOARD, FOREST_STAGE_DEPTH, ForestStage, readForestBoardRect,
} from '../../src/themes/forest/forest-stage.js';

// ForestStage is where the board stands in the wood; ForestFireflyDirector turns the reactions'
// board-space cues into sparks, force fields and waves there. Both are tested against what they
// promise each other and the simulation, not against today's counts and speeds.
const STEP = 1 / 60;
const EYE = Object.freeze({ x: 0, z: 13 });
const STAG = forestFigure('stag');
const BOARD = FOREST_DEFAULT_BOARD;

function seededRandom(seed = 419) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createCamera({ aspect = 16 / 9, fov = 50, level = false } = {}) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.3, 3400);
    camera.position.set(EYE.x, 2, EYE.z);
    camera.lookAt(level ? 0 : -2.2, level ? 2 : 5.4, -40);
    camera.updateProjectionMatrix();
    return camera;
}

/** Screen fractions (y down) a world point is drawn at. */
function onScreen(point, camera) {
    const ndc = point.clone().project(camera);
    return { x: ndc.x * 0.5 + 0.5, y: 0.5 - ndc.y * 0.5 };
}

const gentleGround = (x, z) => 0.3 * Math.sin(x * 0.2) + 0.02 * z;
// Old trunks either side of the ride, and some that are not worth a garland.
const TRUNKS = [
    {
        asset: 'spruce-elder', x: -5.6, y: 0, z: 5.4, radius: 0.6, height: 36, crownBase: 8,
    },
    {
        asset: 'pine-elder', x: 9.6, y: 0, z: -2.2, radius: 0.5, height: 27, crownBase: 16,
    },
    {
        asset: 'spruce-old-a', x: -12, y: 0, z: -14, radius: 0.4, height: 30, crownBase: 9,
    },
    {
        asset: 'sapling', x: 2, y: 0, z: 4, radius: 0.08, height: 5, crownBase: 0.2,
    },
    {
        asset: 'behind', x: 3, y: 0, z: 20, radius: 0.7, height: 30, crownBase: 9,
    },
    {
        asset: 'far', x: 30, y: 0, z: -70, radius: 0.7, height: 30, crownBase: 9,
    },
];
const BOUGHS = new Float32Array([-6, 9, 3, 8, 7, -4, -11, 11, -12]);
const FIGURE_ANCHOR = Object.freeze({
    x: 10, y: 0.4, z: -5, facing: { x: -0.87, z: -0.49 }, depth: { x: 0.49, z: -0.87 },
});

function setup({
    fireflies = 1200, pulses = 6, groundHeight = () => 0, trunks = TRUNKS, boughs = BOUGHS, figureAnchor = FIGURE_ANCHOR,
    seed = 3, aspect = 16 / 9, stage = null,
} = {}) {
    const camera = createCamera({ aspect });
    const sim = new ForestFireflySim({
        count: fireflies, reserve: Math.round(fireflies * 0.56), rng: seededRandom(seed), groundHeight,
    });
    const pool = new ForestPulses(pulses);
    const realStage = stage ?? new ForestStage(camera, groundHeight);
    const director = new ForestFireflyDirector({
        stage: realStage,
        sim,
        pulses: pool,
        tier: { fireflies },
        rng: seededRandom(seed + 1),
        groundHeight,
        trunks,
        boughs,
        figureAnchor,
        eye: EYE,
    });
    const spawn = vi.spyOn(sim, 'spawn');
    const add = vi.spyOn(pool, 'add');
    return {
        camera, sim, pulses: pool, stage: realStage, director, spawn, add, groundHeight,
    };
}

/** One emitter as ForestReactions describes it. */
function emitter(kind, overrides = {}) {
    return {
        id: 0,
        active: true,
        serial: 0,
        kind,
        side: -1,
        column: 0.3,
        row: 0.4,
        strength: 0.6,
        lines: 2,
        age: 0,
        duration: 1.5,
        seed: 0.5,
        progress: 0,
        ...overrides,
    };
}

function wave(serial, overrides = {}) {
    return {
        serial, kind: 'lock', column: 0.5, row: 0.2, strength: 1, heat: 0, ...overrides,
    };
}

/** Play one emitter through its whole life; returns how many sparks it had released after each frame. */
function playEmitter(rig, description, seconds = description.duration) {
    const released = [];
    const frames = Math.round(seconds / STEP);
    for (let frame = 0; frame <= frames; frame++) {
        const age = Math.min(description.duration, frame * STEP);
        const playing = { ...description, age, progress: age / description.duration };
        const env = rig.director.apply({ epoch: 1, emitters: [playing] }, STEP);
        rig.sim.step(STEP, env);
        released.push(rig.spawn.mock.calls.length);
    }
    return released;
}

function spawnArgs(rig, from = 0) {
    return rig.spawn.mock.calls.slice(from).map(([x, y, z, vx, vy, vz, options]) => ({
        x, y, z, vx, vy, vz, ...options,
    }));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Forest stage: reading the board card from the page', () => {
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

    function page(cards, { width = 1600, height = 900, computed = (element) => element.style } = {}) {
        const queries = [];
        const doc = {
            querySelectorAll: (selector) => {
                queries.push(selector);
                return cards;
            },
        };
        const win = { innerWidth: width, innerHeight: height, getComputedStyle: computed };
        return { doc, win, queries };
    }

    it('describes a default card in the middle of the screen', () => {
        expect(Object.isFrozen(BOARD)).toBe(true);
        for (const value of Object.values(BOARD)) {
            expect(value).toBeGreaterThan(0);
            expect(value).toBeLessThan(1);
        }
        expect(BOARD.x1).toBeGreaterThan(BOARD.x0);
        expect(BOARD.y1).toBeGreaterThan(BOARD.y0);
        expect((BOARD.x0 + BOARD.x1) / 2).toBeCloseTo(0.5, 6);
        // Taller than it is wide on a wide screen: it is a falling-block board.
        expect((BOARD.y1 - BOARD.y0) * 9).toBeGreaterThan((BOARD.x1 - BOARD.x0) * 16);
        expect(FOREST_STAGE_DEPTH).toBeGreaterThan(1);
    });

    it('measures the one card on the page in fractions of the window', () => {
        const { doc, win, queries } = page([card({
            left: 600, top: 90, width: 400, height: 720,
        })]);
        expect(readForestBoardRect(doc, win)).toEqual({
            x0: 600 / 1600, x1: 1000 / 1600, y0: 0.1, y1: 0.9,
        });
        // It looks for player cards, the element every mode's board lives in.
        expect(queries).toEqual(['.player-card[data-player]']);
    });

    it('spans every card that is on screen, for local multiplayer', () => {
        const { doc, win } = page([
            card({
                left: 100, top: 200, width: 300, height: 500,
            }),
            card({
                left: 1200, top: 100, width: 300, height: 700,
            }),
            card({
                left: 700, top: 300, width: 200, height: 300,
            }),
        ]);
        expect(readForestBoardRect(doc, win)).toEqual({
            x0: 100 / 1600, x1: 1500 / 1600, y0: 100 / 900, y1: 800 / 900,
        });
    });

    it('ignores cards that are not really there', () => {
        const visible = card({
            left: 600, top: 90, width: 400, height: 720,
        });
        const ghosts = [
            card({
                left: 0, top: 0, width: 8, height: 400,
            }),
            card({
                left: 0, top: 0, width: 400, height: 0,
            }),
            card({
                left: -900, top: 100, width: 400, height: 400,
            }),
            card({
                left: 1600, top: 100, width: 400, height: 400,
            }),
            card({
                left: 100, top: -500, width: 400, height: 400,
            }),
            card({
                left: 100, top: 900, width: 400, height: 400,
            }),
            card({
                left: 0, top: 0, width: 1600, height: 900, style: { display: 'none' },
            }),
            card({
                left: 0, top: 0, width: 1600, height: 900, style: { visibility: 'hidden' },
            }),
            card({
                left: 0, top: 0, width: 1600, height: 900, style: { opacity: '0.01' },
            }),
            { style: {} },
            null,
        ];
        expect(readForestBoardRect(...Object.values(page(ghosts)).slice(0, 2))).toBeNull();
        const mixed = page([...ghosts, visible]);
        expect(readForestBoardRect(mixed.doc, mixed.win)).toEqual({
            x0: 0.375, x1: 0.625, y0: 0.1, y1: 0.9,
        });
        // A card fading in counts once it can be seen at all.
        const fading = page([card({
            left: 600, top: 90, width: 400, height: 720, style: { opacity: '0.4' },
        })]);
        expect(readForestBoardRect(fading.doc, fading.win)).not.toBeNull();
    });

    it('answers null when there is no board, no page or no window', () => {
        expect(readForestBoardRect(...Object.values(page([])).slice(0, 2))).toBeNull();
        expect(readForestBoardRect(null, { innerWidth: 100, innerHeight: 100 })).toBeNull();
        expect(readForestBoardRect({ querySelectorAll: () => [] }, null)).toBeNull();
        expect(readForestBoardRect({}, { innerWidth: 100, innerHeight: 100 })).toBeNull();
        // No computed styles (an old webview): the rectangle alone decides.
        const bare = page([card({
            left: 10, top: 10, width: 50, height: 50,
        })], { width: 100, height: 100 });
        delete bare.win.getComputedStyle;
        expect(readForestBoardRect(bare.doc, bare.win)).toEqual({
            x0: 0.1, x1: 0.6, y0: 0.1, y1: 0.6,
        });
        // A window that reports no size never divides by zero.
        const collapsed = page([card({
            left: 0, top: 0, width: 50, height: 50,
        })], { width: 0, height: 0 });
        const rect = readForestBoardRect(collapsed.doc, collapsed.win);
        if (rect) expect(Object.values(rect).every(Number.isFinite)).toBe(true);
    });
});

describe('Forest stage: the card in the world', () => {
    it.each([
        ['landscape', 16 / 9, 50], ['ultrawide', 21 / 9, 50], ['square', 1, 50], ['portrait', 9 / 19.5, 66],
    ])('puts points of the %s screen back where they came from', (_label, aspect, fov) => {
        const camera = createCamera({ aspect, fov });
        const stage = new ForestStage(camera, gentleGround);
        expect(stage.board).toEqual(BOARD);
        for (const [sx, sy] of [[0.5, 0.5], [0, 0], [1, 1], [0.2, 0.9], [0.83, 0.07]]) {
            for (const depth of [2, FOREST_STAGE_DEPTH, 40]) {
                const point = stage.point(sx, sy, depth);
                const screen = onScreen(point, camera);
                expect(screen.x).toBeCloseTo(sx, 6);
                expect(screen.y).toBeCloseTo(sy, 6);
                // `depth` is distance along the line of sight, not along the ray.
                const forward = camera.getWorldDirection(new THREE.Vector3());
                expect(point.clone().sub(camera.position).dot(forward)).toBeCloseTo(depth, 6);
            }
        }
        expect(onScreen(stage.point(0.3, 0.6), camera).x).toBeCloseTo(0.3, 6);
        // The middle of the card is the middle of the card.
        const centre = onScreen(stage.centre(), camera);
        expect(centre.x).toBeCloseTo((BOARD.x0 + BOARD.x1) / 2, 6);
        expect(centre.y).toBeCloseTo((BOARD.y0 + BOARD.y1) / 2, 6);
        // Half the view's width at a depth is where the edge of the screen is.
        for (const depth of [FOREST_STAGE_DEPTH, 46]) {
            const middle = stage.point(0.5, 0.5, depth);
            expect(stage.point(1, 0.5, depth).distanceTo(middle)).toBeCloseTo(stage.halfWidth(depth), 6);
        }
        expect(stage.halfWidth()).toBe(stage.halfWidth(FOREST_STAGE_DEPTH));
    });

    it('addresses the card by column and row, the foot of the board being row 0', () => {
        const camera = createCamera();
        const stage = new ForestStage(camera);
        expect(stage.screen(0, 0)).toEqual({ x: BOARD.x0, y: BOARD.y1 });
        expect(stage.screen(1, 1).x).toBeCloseTo(BOARD.x1, 12);
        expect(stage.screen(1, 1).y).toBeCloseTo(BOARD.y0, 12);
        const middle = stage.screen(0.5, 0.5);
        expect(middle.x).toBeCloseTo((BOARD.x0 + BOARD.x1) / 2, 12);
        expect(middle.y).toBeCloseTo((BOARD.y0 + BOARD.y1) / 2, 12);
        // Beyond the card is the card's edge.
        expect(stage.screen(-3, 7)).toEqual(stage.screen(0, 1));
        expect(stage.screen(9, -2)).toEqual(stage.screen(1, 0));
        // Its edges, at any height, with an inset that always points inward.
        for (const row of [0, 0.35, 1]) {
            const left = onScreen(stage.edge(-1, row), camera);
            const right = onScreen(stage.edge(1, row), camera);
            expect(left.x).toBeCloseTo(BOARD.x0, 6);
            expect(right.x).toBeCloseTo(BOARD.x1, 6);
            expect(left.y).toBeCloseTo(stage.screen(0, row).y, 6);
            expect(right.y).toBeCloseTo(left.y, 9);
            const inset = 0.02;
            expect(onScreen(stage.edge(-1, row, FOREST_STAGE_DEPTH, new THREE.Vector3(), inset), camera).x)
                .toBeCloseTo(BOARD.x0 + inset, 6);
            expect(onScreen(stage.edge(1, row, FOREST_STAGE_DEPTH, new THREE.Vector3(), inset), camera).x)
                .toBeCloseTo(BOARD.x1 - inset, 6);
        }
        expect(stage.edge(1, 4).equals(stage.edge(1, 1))).toBe(true);
        // Every helper writes into the vector it is given, so a caller can avoid allocating.
        const target = new THREE.Vector3();
        expect(stage.point(0.5, 0.5, 3, target)).toBe(target);
        expect(stage.edge(-1, 0.5, 3, target)).toBe(target);
        expect(stage.centre(3, target)).toBe(target);
        expect(stage.floor(0.5, 0.5, target)).toBe(target);
    });

    it('follows the card when it is measured, and falls back to the default for nonsense', () => {
        const camera = createCamera();
        const stage = new ForestStage(camera);
        const measured = {
            x0: 0.1, x1: 0.4, y0: 0.2, y1: 0.8,
        };
        stage.setBoard(measured);
        expect(stage.board).toEqual(measured);
        expect(onScreen(stage.centre(), camera).x).toBeCloseTo(0.25, 6);
        expect(onScreen(stage.edge(1, 0), camera).y).toBeCloseTo(0.8, 6);
        // It keeps its own copy.
        measured.x0 = 0.9;
        expect(stage.board.x0).toBe(0.1);
        // A card partly off screen is the part that is on it.
        stage.setBoard({
            x0: -0.3, x1: 0.5, y0: -1, y1: 1.4,
        });
        expect(stage.board).toEqual({
            x0: 0, x1: 0.5, y0: 0, y1: 1,
        });
        for (const junk of [null, undefined, {}, 'card', 7, {
            x0: NaN, x1: 0.5, y0: 0.1, y1: 0.9,
        }, {
            x0: 0.5, x1: 0.51, y0: 0.1, y1: 0.9,
        }, {
            x0: 0.2, x1: 0.8, y0: 0.5, y1: 0.55,
        }, {
            x0: 0.8, x1: 0.2, y0: 0.9, y1: 0.1,
        }, {
            x0: 0.2, x1: Infinity, y0: 0.1, y1: 0.9,
        }]) {
            stage.setBoard({
                x0: 0.1, x1: 0.4, y0: 0.2, y1: 0.8,
            });
            stage.setBoard(junk);
            expect(stage.board).toEqual(BOARD);
        }
        expect(stage.board).not.toBe(BOARD);
    });

    it('re-reads the camera only when told to', () => {
        const camera = createCamera();
        const stage = new ForestStage(camera);
        const before = stage.centre().clone();
        camera.position.set(4, 3, 16);
        camera.lookAt(-14.5, 11.5, -36);
        camera.fov = 66;
        camera.aspect = 0.46;
        camera.updateProjectionMatrix();
        // A camera leaning with the pointer does not drag the stage about ...
        expect(stage.centre().equals(before)).toBe(true);
        stage.refresh();
        // ... until the theme has re-framed it and says so.
        expect(stage.centre().equals(before)).toBe(false);
        const centre = onScreen(stage.centre(), camera);
        expect(centre.x).toBeCloseTo(0.5, 6);
        expect(stage.origin.equals(camera.position)).toBe(true);
    });

    it('finds the forest floor behind a place on the card: a column is a bearing, a row is how far out', () => {
        const camera = createCamera({ level: true });
        const stage = new ForestStage(camera, gentleGround);
        const range = (point) => Math.hypot(point.x - camera.position.x, point.z - camera.position.z);
        for (const column of [0, 0.25, 0.5, 1]) {
            let previous = 0;
            for (const row of [0, 0.1, 0.3, 0.6, 1]) {
                const spot = stage.floor(column, row).clone();
                // On the ground, exactly.
                expect(spot.y).toBe(gentleGround(spot.x, spot.z));
                // In front of the eye, further out for a higher row.
                expect(spot.z).toBeLessThan(camera.position.z);
                expect(range(spot)).toBeGreaterThan(previous);
                previous = range(spot);
                // Straight behind that column of the card, as the (level) eye sees it.
                expect(onScreen(spot, camera).x).toBeCloseTo(stage.screen(column, 0).x, 6);
            }
        }
        // The foot of the board is a few paces off, its top tens of metres away: the whole glade.
        const near = range(stage.floor(0.5, 0));
        const far = range(stage.floor(0.5, 1));
        expect(near).toBeGreaterThan(1);
        expect(near).toBeLessThan(10);
        expect(far).toBeGreaterThan(near * 4);
        expect(far).toBeLessThan(120);
        // Rows beyond the card are its foot and its top.
        expect(stage.floor(0.5, -2).equals(stage.floor(0.5, 0))).toBe(true);
        expect(stage.floor(0.5, 9).equals(stage.floor(0.5, 1))).toBe(true);
        // Every column at a row is the same distance out: rows are arcs round the eye.
        expect(range(stage.floor(0, 0.5))).toBeCloseTo(range(stage.floor(1, 0.5)), 9);
    });

    it('takes a column outside the card as a bearing beside it, out to the edge of the view', () => {
        const camera = createCamera({ level: true });
        const stage = new ForestStage(camera, gentleGround);
        const bearing = (column) => {
            const spot = stage.floor(column, 0.5);
            return Math.atan2(spot.x - camera.position.x, camera.position.z - spot.z);
        };
        const columns = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.6];
        const bearings = columns.map(bearing);
        for (let index = 1; index < bearings.length; index++) {
            expect(bearings[index]).toBeGreaterThanOrEqual(bearings[index - 1]);
        }
        // Strictly beside the card on both sides ...
        expect(bearing(-0.5)).toBeLessThan(bearing(0) - 0.01);
        expect(bearing(1.5)).toBeGreaterThan(bearing(1) + 0.01);
        // ... but never far outside what the camera can see.
        const halfView = Math.atan(stage.tanH);
        expect(bearing(-50)).toBe(bearing(-500));
        expect(bearing(50)).toBe(bearing(500));
        expect(bearing(-50)).toBeGreaterThan(-halfView * 1.35);
        expect(bearing(-50)).toBeLessThan(-halfView * 0.9);
        expect(bearing(50)).toBeLessThan(halfView * 1.35);
        expect(bearing(50)).toBeGreaterThan(halfView * 0.9);
        // A narrower card makes every column a narrower bearing.
        const wide = bearing(1) - bearing(0);
        stage.setBoard({
            x0: 0.45, x1: 0.55, y0: 0.1, y1: 0.9,
        });
        expect(bearing(1) - bearing(0)).toBeLessThan(wide);
        // With the game's own framing (the eye looks a little up and to the left) columns still run left to right.
        const tilted = new ForestStage(createCamera(), gentleGround);
        const across = [0, 0.5, 1].map((column) => onScreen(tilted.floor(column, 0.4), tilted.camera).x);
        expect(across[0]).toBeLessThan(across[1]);
        expect(across[1]).toBeLessThan(across[2]);
    });
});

describe('Forest firefly director: waves of light', () => {
    it('knows the shape of every wave the reactions can ask for', () => {
        expect(Object.isFrozen(FOREST_WAVES)).toBe(true);
        const reactions = new ForestReactions({ quality: 'Extreme', rng: seededRandom(2) });
        const asked = new Set();
        const note = () => reactions.getFrame().waves.forEach((entry) => {
            if (entry.serial >= 0) asked.add(entry.kind);
        });
        const piece = { x: 4, y: 20, shape: [[1]] };
        for (const act of [
            () => reactions.onPieceLock({ piece }),
            () => { reactions.onHardDrop({ distance: 19 }); reactions.onPieceLock({ piece }); },
            () => reactions.onLineClear(1, {}), () => reactions.onLineClear(2, {}), () => reactions.onLineClear(4, {}),
            () => reactions.onCombo(7), () => reactions.onTSpin({ piece }), () => reactions.onPerfectClear(),
            () => reactions.onLevelUp(), () => reactions.onBackToBack(),
        ]) {
            act();
            note();
        }
        expect(asked.size).toBeGreaterThanOrEqual(5);
        for (const kind of [...asked, 'figure']) {
            const shape = FOREST_WAVES[kind];
            expect(shape, kind).toBeDefined();
            for (const key of ['speed', 'width', 'reach', 'life', 'gain']) {
                expect(Number.isFinite(shape[key]) && shape[key] > 0, `${kind}.${key}`).toBe(true);
            }
        }
        // The biggest event sends the tallest, fastest wave.
        for (const kind of asked) {
            expect(FOREST_WAVES.quad.reach).toBeGreaterThanOrEqual(FOREST_WAVES[kind].reach);
            expect(FOREST_WAVES.quad.speed).toBeGreaterThanOrEqual(FOREST_WAVES[kind].speed);
        }
    });

    function stubStage() {
        // Column and row straight to x and z, so a wave's origin says which wave it was.
        return {
            floor: (column, row, target) => target.set(column * 100, 1, -row * 100),
            edge: (side, row, depth, target) => target.set(side * 3, 2 + row * 6, 5),
            centre: (depth, target) => target.set(0, 5, 5),
            halfWidth: (depth) => depth * 0.8,
        };
    }

    it('sends the queued waves out oldest first, each exactly once', () => {
        const rig = setup({ stage: stubStage(), pulses: 12 });
        // The queue is a ring: its slots are not in order.
        const serials = [8, 9, 2, 3, 4, 5, 6, 7];
        const waves = serials.map((serial) => wave(serial, { column: serial / 100, row: 0.3 }));
        rig.director.apply({ epoch: 1, waves }, STEP);
        expect(rig.add).toHaveBeenCalledTimes(8);
        expect(rig.add.mock.calls.map(([x]) => Math.round(x))).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
        for (const [x, y, z, shape] of rig.add.mock.calls) {
            expect([x, y, z].every(Number.isFinite)).toBe(true);
            expect(y).toBe(1);
            expect(z).toBeCloseTo(-30, 9);
            expect(shape.strength).toBeGreaterThan(0);
        }
        expect(rig.pulses.active()).toBe(8);
        // The same frame again, and again: nothing is sent twice.
        rig.director.apply({ epoch: 1, waves }, STEP);
        rig.director.apply({ epoch: 1, waves }, STEP);
        expect(rig.add).toHaveBeenCalledTimes(8);
        // Two more arrive in the oldest slots: only they go out, in order.
        waves[2] = wave(10, { column: 0.1 });
        waves[3] = wave(11, { column: 0.11 });
        rig.director.apply({ epoch: 1, waves }, STEP);
        expect(rig.add.mock.calls.slice(8).map(([x]) => Math.round(x))).toEqual([10, 11]);
        // Anything older than what has been played is history, wherever it sits in the queue.
        waves[4] = wave(1, { column: 0.99 });
        rig.director.apply({ epoch: 1, waves }, STEP);
        expect(rig.add).toHaveBeenCalledTimes(10);
    });

    it('keeps the newest waves when more are queued than the tier can carry', () => {
        const rig = setup({ stage: stubStage(), pulses: 3 });
        const waves = [5, 6, 7, 0, 1, 2, 3, 4].map((serial) => wave(serial, { column: serial / 100 }));
        rig.director.apply({ epoch: 1, waves }, STEP);
        expect(rig.add).toHaveBeenCalledTimes(8);
        expect(rig.pulses.active()).toBe(3);
        expect(rig.pulses.place.map((place) => Math.round(place.x)).sort()).toEqual([5, 6, 7]);
    });

    it('skips the empty slots of the queue and waves of no strength', () => {
        const rig = setup({ stage: stubStage() });
        const waves = [wave(-1, { strength: 0 }), wave(0), wave(1, { strength: 0 }), wave(-1), wave(2)];
        rig.director.apply({ epoch: 1, waves }, STEP);
        expect(rig.add.mock.calls.map(([x]) => x)).toEqual([50, 50]);
        expect(rig.pulses.active()).toBe(2);
        // The strengthless one was still taken off the queue: it is not sent later either.
        waves[2].strength = 1;
        rig.director.apply({ epoch: 1, waves }, STEP);
        expect(rig.add).toHaveBeenCalledTimes(2);
        // No queue at all is as welcome.
        expect(() => rig.director.apply({ epoch: 1 }, STEP)).not.toThrow();
        expect(() => rig.director.apply({ epoch: 1, waves: null }, STEP)).not.toThrow();
        expect(() => rig.director.apply({ epoch: 1, waves: [] }, STEP)).not.toThrow();
    });

    it('gives each wave the shape of its kind, scaled by how strong and hot the event was', () => {
        const rig = setup({ stage: stubStage(), pulses: 12 });
        const kinds = Object.keys(FOREST_WAVES);
        rig.director.apply({
            epoch: 1,
            waves: kinds.map((kind, serial) => wave(serial, {
                kind, column: serial / 100, strength: 1.5, heat: 0.4,
            })),
        }, STEP);
        rig.add.mock.calls.forEach(([, , , shape], index) => {
            const expected = FOREST_WAVES[kinds[index]];
            expect(shape).toEqual({
                strength: 1.5 * expected.gain,
                speed: expected.speed,
                width: expected.width,
                reach: expected.reach,
                heat: 0.4,
                life: expected.life,
            });
        });
        // A kind nobody has described is played as an ordinary lock rather than dropped.
        const odd = setup({ stage: stubStage() });
        odd.director.apply({ epoch: 1, waves: [wave(0, { kind: 'earthquake' }), wave(1, { kind: 'lock' })] }, STEP);
        expect(odd.add.mock.calls[0][3]).toEqual(odd.add.mock.calls[1][3]);
    });

    it('starts each wave on the forest floor behind the place on the card it came from', () => {
        const rig = setup({ groundHeight: gentleGround });
        rig.director.apply({
            epoch: 1,
            waves: [
                wave(0, { column: 0, row: 0.1 }), wave(1, { column: 1, row: 0.1 }), wave(2, { column: 0.5, row: 0.9 }),
            ],
        }, STEP);
        const origins = rig.add.mock.calls.map(([x, y, z]) => new THREE.Vector3(x, y, z));
        for (const origin of origins) expect(origin.y).toBeCloseTo(gentleGround(origin.x, origin.z), 9);
        // Left column to the left of the right column, and a high row far out beyond a low one.
        expect(onScreen(origins[0], rig.camera).x).toBeLessThan(onScreen(origins[1], rig.camera).x);
        const range = (point) => Math.hypot(point.x - EYE.x, point.z - EYE.z);
        expect(range(origins[2])).toBeGreaterThan(range(origins[0]) * 2);
        expect(origins[2].equals(rig.stage.floor(0.5, 0.9))).toBe(true);
    });

    it('runs without a pool of pulses at all', () => {
        const rig = setup();
        rig.director.pulses = null;
        expect(() => rig.director.apply({
            epoch: 1, waves: [wave(0)], figure: { serial: 1, held: true, presence: 1 },
        }, STEP)).not.toThrow();
        expect(rig.add).not.toHaveBeenCalled();
    });
});

describe('Forest firefly director: emitters', () => {
    it('throws a puff from the card’s edge beside a lock, once', () => {
        for (const side of [-1, 1]) {
            const rig = setup({ groundHeight: gentleGround });
            const lock = emitter('lock', { side, row: 0.5, duration: 1.1 });
            const released = playEmitter(rig, lock);
            // All at once, on the frame it is first seen; never again while that event plays.
            expect(released[0]).toBeGreaterThan(0);
            expect(released.at(-1)).toBe(released[0]);
            const edge = rig.stage.edge(side, 0.5).clone();
            for (const spark of spawnArgs(rig)) {
                expect(Object.values(spark).every(Number.isFinite)).toBe(true);
                // Away from the card on its own side, from right beside its edge.
                expect(Math.sign(spark.vx)).toBe(side);
                expect(Math.hypot(spark.x - edge.x, spark.z - edge.z)).toBeLessThan(1.5);
                expect(Math.abs(spark.y - edge.y)).toBeLessThan(1.5);
                expect(spark.y).toBeGreaterThan(gentleGround(spark.x, spark.z));
                expect(spark.kind ?? FOREST_FIREFLY_SPARK).toBe(FOREST_FIREFLY_SPARK);
                expect(spark.life).toBeGreaterThan(0.3);
                expect(spark.life).toBeLessThan(15);
            }
            expect(rig.sim.outPlace.every(Number.isFinite)).toBe(true);
        }
    });

    it('throws more for a stronger lock and for a richer tier, and always something', () => {
        const count = (options, strength) => {
            const rig = setup(options);
            return playEmitter(rig, emitter('lock', { strength, duration: 1.1 })).at(-1);
        };
        expect(count({}, 1)).toBeGreaterThan(count({}, 0.1));
        expect(count({ fireflies: 3600 }, 0.6)).toBeGreaterThan(count({ fireflies: 900 }, 0.6));
        // The poorest tier still answers a lock.
        expect(count({ fireflies: 60 }, 0.1)).toBeGreaterThan(0);
        // And no tier can be made to throw more than its reserve holds in one go.
        for (const fireflies of [60, 480, 2400, 3600]) {
            const rig = setup({ fireflies });
            const thrown = playEmitter(rig, emitter('lock', { strength: 1, duration: 1.1 })).at(-1);
            expect(thrown).toBeLessThan(rig.sim.reserve);
        }
    });

    it('lays down a short burst beside a lock while it is young, and nothing afterwards', () => {
        const rig = setup();
        const lock = emitter('lock', { side: 1, duration: 1.1 });
        rig.director.apply({ epoch: 1, emitters: [lock] }, STEP);
        expect(rig.director.fields.map((field) => field.kind)).toEqual(['burst']);
        const [burst] = rig.director.fields;
        for (const key of ['x', 'y', 'z', 'radius', 'power', 'up']) expect(Number.isFinite(burst[key]), key).toBe(true);
        expect(burst.radius).toBeGreaterThan(0);
        expect(burst.power).toBeGreaterThan(0);
        // The list is rebuilt every frame, in place.
        const { fields } = rig.director;
        rig.director.apply({ epoch: 1, emitters: [{ ...lock, age: 1 }] }, STEP);
        expect(rig.director.fields).toBe(fields);
        expect(fields).toEqual([]);
        rig.director.apply({ epoch: 1, emitters: [] }, STEP);
        expect(fields).toEqual([]);
    });

    it('blows a jet of fireflies out of each side for a clear, spread over its first moments', () => {
        for (const side of [-1, 1]) {
            const rig = setup();
            const released = playEmitter(rig, emitter('clear', { side, lines: 2, duration: 1.7 }));
            const total = released.at(-1);
            expect(total).toBeGreaterThan(5);
            // Not one frame's burst: it builds up over many frames, then stops.
            for (let frame = 1; frame < released.length; frame++) {
                expect(released[frame]).toBeGreaterThanOrEqual(released[frame - 1]);
            }
            expect(released[2]).toBeLessThan(total * 0.5);
            const done = released.indexOf(total);
            expect(done * STEP).toBeGreaterThan(0.2);
            expect(done * STEP).toBeLessThan(1.5);
            for (const spark of spawnArgs(rig)) {
                expect(Object.values(spark).every(Number.isFinite)).toBe(true);
                expect(Math.sign(spark.vx)).toBe(side);
            }
            // A jet field carries them outward while the emitter is young.
            rig.director.apply({ epoch: 1, emitters: [emitter('clear', { side, serial: 5, age: 0.1 })] }, STEP);
            const [jet] = rig.director.fields;
            expect(jet.kind).toBe('jet');
            expect(Math.sign(jet.dx)).toBe(side);
            rig.director.apply({ epoch: 1, emitters: [emitter('clear', { side, serial: 5, age: 1.6 })] }, STEP);
            expect(rig.director.fields).toEqual([]);
        }
    });

    it('releases more for more lines, on the same schedule whatever the frame rate', () => {
        const total = (lines, step = STEP) => {
            const rig = setup();
            const clear = emitter('clear', { lines, duration: 1.7 });
            for (let age = 0; age <= 1.7; age += step) {
                rig.director.apply({ epoch: 1, emitters: [{ ...clear, age }] }, step);
            }
            return rig.spawn.mock.calls.length;
        };
        const counts = [1, 2, 3, 4].map((lines) => total(lines));
        for (let index = 1; index < counts.length; index++) expect(counts[index]).toBeGreaterThan(counts[index - 1]);
        // A slow machine releases the same jet in fewer, bigger helpings.
        expect(Math.abs(total(2, 1 / 15) - counts[1])).toBeLessThanOrEqual(1);
        expect(Math.abs(total(2, 1 / 240) - counts[1])).toBeLessThanOrEqual(1);
        // A clear that says nothing of its lines is one line.
        const rig = setup();
        expect(playEmitter(rig, emitter('clear', { lines: 0, duration: 1.7 })).at(-1)).toBe(counts[0]);
    });

    it('lifts fireflies off the whole floor for a rise, upward and from the ground', () => {
        const rig = setup({ groundHeight: gentleGround });
        const released = playEmitter(rig, emitter('rise', { row: 0, strength: 1, duration: 2.8 }));
        const total = released.at(-1);
        expect(total).toBeGreaterThan(20);
        expect(released[5]).toBeLessThan(total * 0.3);
        const sparks = spawnArgs(rig);
        for (const spark of sparks) {
            expect(Object.values(spark).every(Number.isFinite)).toBe(true);
            expect(spark.vy).toBeGreaterThan(0.5);
            expect(spark.y - gentleGround(spark.x, spark.z)).toBeGreaterThan(0);
            expect(spark.y - gentleGround(spark.x, spark.z)).toBeLessThan(0.5);
            expect(spark.z).toBeLessThan(EYE.z);
        }
        // All around the board, not from one spot: left of it, right of it, near and far.
        const xs = sparks.map((spark) => spark.x);
        const zs = sparks.map((spark) => spark.z);
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(10);
        expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(10);
        // A weaker rise is a thinner one.
        const weak = setup({ groundHeight: gentleGround });
        expect(playEmitter(weak, emitter('rise', { row: 0, strength: 0.3, duration: 2.8 })).at(-1)).toBeLessThan(total);
    });

    it('shakes dew from the boughs for a hard drop, and only where there are boughs', () => {
        const rig = setup();
        const released = playEmitter(rig, emitter('dew', { strength: 0.9, duration: 0.7 }));
        expect(released.at(-1)).toBeGreaterThan(5);
        for (const drop of spawnArgs(rig)) {
            expect(drop.kind).toBe(FOREST_FIREFLY_DEW);
            // It starts falling from just under one of the boughs.
            expect(drop.vy).toBeLessThan(0);
            let nearest = Infinity;
            for (let index = 0; index < BOUGHS.length; index += 3) {
                if (Math.hypot(drop.x - BOUGHS[index], drop.z - BOUGHS[index + 2]) < 1.2
                    && drop.y <= BOUGHS[index + 1] && drop.y > BOUGHS[index + 1] - 1) nearest = 0;
            }
            expect(nearest).toBe(0);
        }
        expect(rig.director.fields).toEqual([]);
        for (const boughs of [null, new Float32Array(0), new Float32Array(2)]) {
            const bare = setup({ boughs });
            expect(playEmitter(bare, emitter('dew', { strength: 0.9, duration: 0.7 })).at(-1)).toBe(0);
        }
    });

    it('winds a spiral beside the board for a spin, turning the way its side says', () => {
        for (const side of [-1, 1]) {
            const rig = setup();
            const released = playEmitter(rig, emitter('spin', { side, duration: 1.7 }));
            expect(released[0]).toBeGreaterThan(0);
            expect(released.at(-1)).toBe(released[0]);
            rig.director.apply({ epoch: 1, emitters: [emitter('spin', { side, serial: 3, age: 0.2 })] }, STEP);
            const vortex = rig.director.fields.find((field) => field.kind === 'vortex');
            expect(vortex.turn).toBe(side);
            expect(Math.sign(vortex.x - rig.stage.centre().x)).toBe(side);
            for (const key of ['x', 'z', 'radius', 'reach', 'floor', 'top', 'spin', 'grip', 'pull', 'lift']) {
                expect(Number.isFinite(vortex[key]), key).toBe(true);
            }
            expect(vortex.reach).toBeGreaterThan(vortex.radius);
            expect(vortex.top).toBeGreaterThan(vortex.floor);
            rig.director.apply({ epoch: 1, emitters: [emitter('spin', { side, serial: 3, age: 1.6 })] }, STEP);
            expect(rig.director.fields).toEqual([]);
        }
    });

    it('throws a ring round the board for a combo, once, bigger for a longer one', () => {
        const ring = (strength) => {
            const rig = setup({ groundHeight: gentleGround });
            const released = playEmitter(rig, emitter('combo', { strength, duration: 1.4 }));
            expect(released.at(-1)).toBe(released[0]);
            return rig;
        };
        const small = ring(0.4);
        const large = ring(1);
        expect(large.spawn.mock.calls.length).toBeGreaterThan(small.spawn.mock.calls.length);
        const centre = large.stage.centre();
        for (const spark of spawnArgs(large)) {
            const radius = Math.hypot(spark.x - centre.x, spark.z - centre.z);
            expect(radius).toBeGreaterThan(1);
            expect(radius).toBeLessThan(6);
            // Set going round the board, not out from it.
            const outward = ((spark.x - centre.x) * spark.vx + (spark.z - centre.z) * spark.vz) / radius;
            expect(Math.abs(outward)).toBeLessThan(Math.hypot(spark.vx, spark.vz) * 0.05);
            expect(spark.y).toBeGreaterThan(gentleGround(spark.x, spark.z));
        }
    });

    it('treats a slot that comes back with a new serial as a new event', () => {
        const rig = setup();
        const first = playEmitter(rig, emitter('lock', { id: 2, serial: 4, duration: 1.1 })).at(-1);
        const second = playEmitter(rig, emitter('lock', { id: 2, serial: 9, duration: 1.1 })).at(-1);
        expect(second).toBe(first * 2);
        // Another slot with the same serial is another event as well.
        const third = playEmitter(rig, emitter('lock', { id: 3, serial: 9, duration: 1.1 })).at(-1);
        expect(third).toBe(first * 3);
        // A jet that is replaced mid-flight starts its own schedule from nothing.
        const jets = setup();
        const whole = playEmitter(jets, emitter('clear', { id: 1, serial: 1, duration: 1.7 })).at(-1);
        playEmitter(jets, emitter('clear', { id: 1, serial: 1, duration: 1.7 }), 0.2);
        expect(jets.spawn.mock.calls.length).toBe(whole);
        playEmitter(jets, emitter('clear', { id: 1, serial: 2, duration: 1.7 }));
        expect(jets.spawn.mock.calls.length).toBe(whole * 2);
    });

    it('ignores kinds it does not know and cues that are not numbers', () => {
        const rig = setup();
        expect(() => rig.director.apply({
            epoch: 1,
            emitters: [
                emitter('confetti'), emitter(undefined, { id: 1 }),
                emitter('lock', {
                    id: 2, row: NaN, side: NaN, strength: NaN,
                }),
                emitter('clear', { id: 3, row: Infinity, lines: NaN }),
                emitter('rise', { id: 4, strength: NaN }),
                emitter('spin', { id: 5, row: NaN }),
                emitter('combo', { id: 6, strength: NaN }),
            ],
            waves: [wave(0, { column: NaN, row: NaN }), wave(1, { strength: NaN }), wave(2, { kind: null })],
            wake: NaN,
            heat: Infinity,
            gust: 'strong',
            figure: { serial: NaN, held: 'yes' },
            front: { position: NaN, strength: NaN, direction: NaN },
        }, NaN, { x: 1, z: 0 })).not.toThrow();
        // Whatever got through, nothing in the simulation is not a number.
        for (let frame = 0; frame < 30; frame++) rig.sim.step(STEP, rig.director.env);
        expect(rig.sim.outPlace.every(Number.isFinite)).toBe(true);
        expect(rig.sim.outGlow.every(Number.isFinite)).toBe(true);
        for (const vector of [...rig.pulses.place, ...rig.pulses.shape]) {
            expect(vector.toArray().every(Number.isFinite)).toBe(true);
        }
        expect(() => rig.director.apply(undefined, STEP)).not.toThrow();
        expect(() => rig.director.apply({}, STEP, undefined)).not.toThrow();
    });
});

describe('Forest firefly director: the waking forest', () => {
    it('chooses the old trunks near the eye and in front of it to wind garlands round', () => {
        const rig = setup();
        const { posts } = rig.director;
        expect(posts.map((post) => post.asset)).toEqual(['spruce-elder', 'pine-elder', 'spruce-old-a']);
        const ranges = posts.map((post) => post.range);
        expect(ranges).toEqual([...ranges].sort((a, b) => a - b));
        // Neighbours wind opposite ways.
        expect(posts.map((post) => post.turn)).toEqual([1, -1, 1]);
        // A poor tier keeps fewer of them, the nearest; a rich one never more than a handful.
        const many = Array.from({ length: 30 }, (_, index) => ({
            asset: `spruce-${index}`, x: -20 + index * 1.4, y: 0, z: -2 - index, radius: 0.5, height: 30, crownBase: 9,
        }));
        const poor = setup({ fireflies: 120, trunks: many }).director.posts;
        const rich = setup({ fireflies: 3600, trunks: many }).director.posts;
        expect(poor.length).toBeGreaterThanOrEqual(2);
        expect(rich.length).toBeGreaterThan(poor.length);
        expect(rich.length).toBeLessThanOrEqual(8);
        expect(rich.slice(0, poor.length).map((post) => post.asset)).toEqual(poor.map((post) => post.asset));
        // No trunks at all: no garlands, and nothing else minds.
        const bare = setup({ trunks: [] });
        expect(bare.director.posts).toEqual([]);
        expect(() => bare.director.apply({ epoch: 1, wake: 1, heat: 1 }, STEP)).not.toThrow();
        // Told nothing about the wood at all, the director still plays: no posts, no boughs, no figure.
        const plain = new ForestFireflyDirector({
            stage: bare.stage, sim: bare.sim, pulses: bare.pulses, tier: { fireflies: 600 },
        });
        expect(plain.posts).toEqual([]);
        expect(plain.figurePoints.size).toBe(0);
        expect(() => plain.apply({
            epoch: 1,
            wake: 1,
            emitters: [emitter('dew'), emitter('lock', { id: 1 })],
            figure: { serial: 1, held: true, presence: 1 },
        }, STEP)).not.toThrow();
    });

    it('winds garlands and turns the wheel behind the board only while the forest is awake', () => {
        const rig = setup({ groundHeight: gentleGround });
        // Asleep: no fields, no sparks, however long it lasts.
        for (let frame = 0; frame < 120; frame++) rig.director.apply({ epoch: 1, wake: 0 }, STEP);
        expect(rig.director.fields).toEqual([]);
        expect(rig.spawn).not.toHaveBeenCalled();
        // Awake: a vortex round every chosen trunk and one behind the card, fed with sparks over time.
        const fed = [];
        for (let frame = 0; frame < 120; frame++) {
            rig.director.apply({ epoch: 1, wake: 0.8, heat: 0.4 }, STEP);
            fed.push(rig.spawn.mock.calls.length);
            const { fields } = rig.director;
            expect(fields).toHaveLength(rig.director.posts.length + 1);
            expect(fields.every((field) => field.kind === 'vortex')).toBe(true);
        }
        expect(fed.at(-1)).toBeGreaterThan(20);
        // A steady trickle, not a burst: no frame feeds more than a few.
        for (let frame = 1; frame < fed.length; frame++) {
            expect(fed[frame] - fed[frame - 1]).toBeLessThan(fed.at(-1) * 0.2);
        }
        const centre = rig.stage.centre();
        const posts = rig.director.fields.slice(0, -1);
        posts.forEach((field, index) => {
            const post = rig.director.posts[index];
            expect([field.x, field.z]).toEqual([post.x, post.z]);
            expect(field.turn).toBe(post.turn);
            // It hugs the trunk and climbs it from its foot.
            expect(field.radius).toBeGreaterThan(post.radius);
            expect(field.radius).toBeLessThan(post.radius + 2);
            expect(field.floor).toBe(post.y);
            expect(field.top).toBeGreaterThan(post.y + 1);
            expect(field.lift).toBeGreaterThan(0);
        });
        const wheel = rig.director.fields.at(-1);
        expect([wheel.x, wheel.z]).toEqual([centre.x, centre.z]);
        expect(wheel.floor).toBeCloseTo(gentleGround(centre.x, centre.z), 9);
        // Every spark starts beside a trunk or in the ring round the board, clear of the moss.
        for (const spark of spawnArgs(rig)) {
            expect(Object.values(spark).every(Number.isFinite)).toBe(true);
            const nearPost = rig.director.posts.some((post) => (
                Math.abs(Math.hypot(spark.x - post.x, spark.z - post.z) - (post.radius + 0.5)) < 1e-6));
            const inRing = Math.abs(Math.hypot(spark.x - centre.x, spark.z - centre.z) - 3.2) < 0.6;
            expect(nearPost || inRing).toBe(true);
        }
        // Back to sleep: the fields are gone the same frame and the feeding stops.
        const before = rig.spawn.mock.calls.length;
        for (let frame = 0; frame < 120; frame++) rig.director.apply({ epoch: 1, wake: 0 }, STEP);
        expect(rig.director.fields).toEqual([]);
        expect(rig.spawn.mock.calls.length).toBe(before);
    });

    it('feeds the garlands faster and winds them higher the wider awake the forest is', () => {
        const awake = (wake, seconds = 2) => {
            const rig = setup();
            for (let frame = 0; frame < seconds * 60; frame++) rig.director.apply({ epoch: 1, wake, heat: wake }, STEP);
            return { fed: rig.spawn.mock.calls.length, field: rig.director.fields[0], rig };
        };
        const drowsy = awake(0.2);
        const wide = awake(1);
        expect(wide.fed).toBeGreaterThan(drowsy.fed);
        expect(wide.field.top).toBeGreaterThan(drowsy.field.top);
        expect(wide.field.spin).toBeGreaterThan(drowsy.field.spin);
        expect(wide.field.lift).toBeGreaterThan(drowsy.field.lift);
        // Out-of-range wakefulness is the nearest end of the range; nonsense is asleep.
        expect(awake(40).fed).toBe(wide.fed);
        for (const wake of [-1, NaN, undefined, 'awake', 0.01]) {
            const still = awake(wake, 1);
            expect(still.fed).toBe(0);
            expect(still.rig.director.fields).toEqual([]);
        }
        // The clock feeds them, not the frame rate.
        const slow = setup();
        for (let frame = 0; frame < 30; frame++) slow.director.apply({ epoch: 1, wake: 1, heat: 1 }, 1 / 15);
        expect(Math.abs(slow.spawn.mock.calls.length - wide.fed)).toBeLessThanOrEqual(slow.director.posts.length + 1);
    });
});

describe('Forest firefly director: the figure', () => {
    const held = (serial, presence = 0.2) => ({
        serial, age: presence, held: true, presence,
    });

    it('calls the fireflies together on a new summons and gives each a place in the figure', () => {
        const rig = setup({ groundHeight: gentleGround });
        const anchor = { ...FIGURE_ANCHOR, y: gentleGround(FIGURE_ANCHOR.x, FIGURE_ANCHOR.z) };
        rig.director.figureAnchor = anchor;
        rig.director.apply({ epoch: 1, figure: held(1) }, STEP);
        const lights = rig.director.figureLights;
        expect(rig.director.pointsFor(STAG)).toHaveLength(lights * 4);
        expect(lights).toBeGreaterThanOrEqual(60);
        expect(lights).toBeLessThan(rig.sim.reserve);
        expect(rig.spawn).toHaveBeenCalledTimes(lights);
        expect(rig.sim.counts()).toMatchObject({ live: lights, bound: lights });
        expect(rig.director.figureSparks).toHaveLength(lights);
        expect(new Set(rig.director.figureSparks).size).toBe(lights);
        const span = Math.max(STAG.bounds.maxX, -STAG.bounds.minX, STAG.bounds.maxY) * 2;
        for (const index of rig.director.figureSparks) {
            const target = new THREE.Vector3(rig.sim.tx[index], rig.sim.ty[index], rig.sim.tz[index]);
            // Its place is in the figure standing on the anchor: above the ground there, within the animal's size.
            expect(target.y).toBeGreaterThanOrEqual(anchor.y - 1e-4);
            expect(Math.hypot(target.x - anchor.x, target.z - anchor.z)).toBeLessThan(span);
            expect(target.y - anchor.y).toBeLessThan(span * 1.5);
            // It starts out in the ferns near by, low down, and has to fly there.
            const start = new THREE.Vector3(rig.sim.x[index], rig.sim.y[index], rig.sim.z[index]);
            expect(start.y - gentleGround(start.x, start.z)).toBeGreaterThan(0);
            expect(start.y - gentleGround(start.x, start.z)).toBeLessThan(1);
            expect(Math.hypot(start.x - target.x, start.z - target.z)).toBeGreaterThan(1);
            expect(Math.hypot(start.x - target.x, start.z - target.z)).toBeLessThan(12);
        }
        // The figure is drawn side on to the eye: wide along `facing`, thin along `depth`.
        const along = rig.director.figureSparks.map((index) => (
            (rig.sim.tx[index] - anchor.x) * anchor.facing.x + (rig.sim.tz[index] - anchor.z) * anchor.facing.z));
        const across = rig.director.figureSparks.map((index) => (
            (rig.sim.tx[index] - anchor.x) * anchor.depth.x + (rig.sim.tz[index] - anchor.z) * anchor.depth.z));
        expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(2);
        expect(Math.max(...across) - Math.min(...across)).toBeLessThan(1.2);
        // Held, frame after frame: nobody is called twice.
        for (let frame = 0; frame < 90; frame++) {
            rig.sim.step(STEP, rig.director.apply({ epoch: 1, figure: held(1, Math.min(1, frame / 60)) }, STEP));
        }
        expect(rig.spawn).toHaveBeenCalledTimes(lights);
        expect(rig.sim.counts()).toMatchObject({ live: lights, bound: lights });
        // They are arriving: after a second and a half most stand close to their places.
        const arrived = rig.director.figureSparks.filter((index) => Math.hypot(
            rig.sim.x[index] - rig.sim.tx[index],
            rig.sim.y[index] - rig.sim.ty[index],
            rig.sim.z[index] - rig.sim.tz[index],
        ) < 0.5).length;
        expect(arrived).toBeGreaterThan(lights * 0.5);
    });

    it('is the same animal every time it comes, whatever else has used the random source', () => {
        const first = setup({ seed: 3 });
        const second = setup({ seed: 77 });
        // Every animal is laid out when the director is built: a summons builds nothing.
        expect([...first.director.figurePoints.keys()]).toEqual(FOREST_FIGURES.map((figure) => figure.id));
        for (const figure of FOREST_FIGURES) {
            expect(second.director.pointsFor(figure), figure.id).toEqual(first.director.pointsFor(figure));
            // And it is laid out once: the second call hands back the same lights.
            expect(first.director.pointsFor(figure)).toBe(first.director.pointsFor(figure));
        }
        expect(first.director.pointsFor(FOREST_FIGURES[1])).not.toEqual(first.director.pointsFor(STAG));
        // A richer tier draws it with more lights, a poor one with a bounded few.
        const rich = setup({ fireflies: 3600 }).director.figureLights;
        const poor = setup({ fireflies: 200 });
        expect(rich).toBeGreaterThan(first.director.figureLights);
        expect(poor.director.figureLights).toBeLessThanOrEqual(Math.max(60, poor.sim.reserve));
        expect(poor.director.figureLights).toBeGreaterThanOrEqual(60);
    });

    it('lets go when the summons stops holding, and the lights drift apart and go out', () => {
        const rig = setup();
        for (let frame = 0; frame < 60; frame++) {
            rig.sim.step(STEP, rig.director.apply({ epoch: 1, figure: held(1, 1) }, STEP));
        }
        const lights = rig.sim.counts().bound;
        expect(lights).toBeGreaterThan(0);
        // The release: still a cue, no longer held.
        rig.sim.step(STEP, rig.director.apply({
            epoch: 1,
            figure: {
                serial: 1, age: 5, held: false, presence: 0.9,
            },
        }, STEP));
        expect(rig.sim.counts().bound).toBe(0);
        expect(rig.director.figureHeld).toBe(false);
        expect(rig.director.figureSparks).toEqual([]);
        expect(rig.sim.counts().live).toBeGreaterThan(lights * 0.9);
        // The same serial, still letting go, does not gather them again.
        for (let frame = 0; frame < 300; frame++) {
            rig.sim.step(STEP, rig.director.apply({
                epoch: 1,
                figure: {
                    serial: 1, age: 6, held: false, presence: 0.2,
                },
            }, STEP));
        }
        expect(rig.spawn).toHaveBeenCalledTimes(lights);
        expect(rig.sim.counts()).toMatchObject({ live: 0, bound: 0 });
        // A cue that simply disappears (game over, reset upstream) releases as well.
        const gone = setup();
        gone.director.apply({ epoch: 1, figure: held(1) }, STEP);
        expect(gone.sim.counts().bound).toBeGreaterThan(0);
        gone.director.apply({ epoch: 1, figure: null }, STEP);
        expect(gone.sim.counts().bound).toBe(0);
        expect(gone.director.figureHeld).toBe(false);
    });

    it('gives way to a new summons: the old lights are let go and new ones are called', () => {
        const rig = setup();
        rig.director.apply({ epoch: 1, figure: held(1) }, STEP);
        const first = [...rig.director.figureSparks];
        const lights = first.length;
        for (let frame = 0; frame < 30; frame++) {
            rig.sim.step(STEP, rig.director.apply({ epoch: 1, figure: held(1, 1) }, STEP));
        }
        rig.director.apply({ epoch: 1, figure: held(2) }, STEP);
        expect(rig.spawn).toHaveBeenCalledTimes(lights * 2);
        expect(rig.sim.counts().bound).toBe(lights);
        expect(rig.director.figureSparks).toHaveLength(lights);
        // The old ones are no longer bound; none of them was simply re-used while it still stood.
        for (const index of first) {
            if (!rig.director.figureSparks.includes(index)) expect(rig.sim.bound[index]).toBe(0);
        }
        // A summons first seen when it is already letting go is not gathered at all.
        const late = setup();
        late.director.apply({
            epoch: 1,
            figure: {
                serial: 4, age: 9, held: false, presence: 0.5,
            },
        }, STEP);
        expect(late.spawn).not.toHaveBeenCalled();
        expect(late.sim.counts().bound).toBe(0);
        late.director.apply({ epoch: 1, figure: held(4) }, STEP);
        expect(late.spawn).not.toHaveBeenCalled();
    });

    it('breathes a slow light out over the moss from under its hooves while it stands', () => {
        const rig = setup();
        rig.director.apply({ epoch: 1, figure: held(1, 0.1) }, STEP);
        // Still gathering: not yet.
        for (let frame = 0; frame < 60; frame++) rig.director.apply({ epoch: 1, figure: held(1, 0.3) }, STEP);
        expect(rig.add).not.toHaveBeenCalled();
        const seconds = 6;
        for (let frame = 0; frame < seconds * 60; frame++) rig.director.apply({ epoch: 1, figure: held(1, 1) }, STEP);
        // Now and then, not every frame.
        expect(rig.add.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(rig.add.mock.calls.length).toBeLessThanOrEqual(seconds * 2);
        for (const [x, y, z, shape] of rig.add.mock.calls) {
            expect([x, y, z]).toEqual([FIGURE_ANCHOR.x, FIGURE_ANCHOR.y, FIGURE_ANCHOR.z]);
            expect(shape.strength).toBeGreaterThan(0);
            expect(shape.strength).toBeLessThanOrEqual(1);
        }
        // Let go, it breathes no more.
        const before = rig.add.mock.calls.length;
        for (let frame = 0; frame < 240; frame++) rig.director.apply({ epoch: 1, figure: null }, STEP);
        expect(rig.add.mock.calls.length).toBe(before);
    });

    it('does nothing about a summons where there is nowhere for a figure to stand', () => {
        const rig = setup({ figureAnchor: null });
        expect(() => {
            for (let frame = 0; frame < 30; frame++) rig.director.apply({ epoch: 1, figure: held(1, 1) }, STEP);
            rig.director.apply({ epoch: 1, figure: null }, STEP);
        }).not.toThrow();
        expect(rig.spawn).not.toHaveBeenCalled();
        expect(rig.add).not.toHaveBeenCalled();
        expect(rig.director.figureHeld).toBe(false);
    });

    it('plays the reactions’ own summons from gathering to letting go', () => {
        const rig = setup();
        const reactions = new ForestReactions({ quality: 'High', rng: seededRandom(8) });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        const total = FOREST_FIGURE_TIMING.gather + FOREST_FIGURE_TIMING.hold + FOREST_FIGURE_TIMING.release;
        let boundFor = 0;
        let peak = 0;
        for (let frame = 0; frame < (total + 4) * 60; frame++) {
            const frameState = reactions.update(STEP);
            rig.sim.step(STEP, rig.director.apply(frameState, STEP));
            const { bound } = rig.sim.counts();
            if (bound > 0) boundFor += STEP;
            peak = Math.max(peak, bound);
            // Bound exactly while the cue holds.
            expect(bound > 0).toBe(frameState.figure?.held === true);
        }
        expect(peak).toBe(rig.director.figureLights);
        expect(boundFor).toBeCloseTo(FOREST_FIGURE_TIMING.gather + FOREST_FIGURE_TIMING.hold, 1);
        expect(rig.sim.counts().bound).toBe(0);
    });
});

describe('Forest firefly director: resets and epochs', () => {
    function eventful() {
        const reactions = new ForestReactions({ quality: 'High', rng: seededRandom(8) });
        const piece = { x: 1, y: 20, shape: [[1]] };
        reactions.onHardDrop({ distance: 18 });
        reactions.onPieceLock({ piece });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        reactions.onCombo(8);
        reactions.onTSpin({ piece });
        return reactions;
    }

    it('drops what is in flight on reset without replaying what the reactions still hold', () => {
        const rig = setup();
        const reactions = eventful();
        for (let frame = 0; frame < 20; frame++) rig.sim.step(STEP, rig.director.apply(reactions.update(STEP), STEP));
        const sent = rig.add.mock.calls.length;
        expect(sent).toBeGreaterThanOrEqual(4);
        expect(rig.director.fields.length).toBeGreaterThan(0);
        expect(rig.sim.counts().bound).toBeGreaterThan(0);
        expect(rig.director.figureHeld).toBe(true);
        const thrown = rig.spawn.mock.calls.length;

        // The world's "forget every effect in flight": director, fireflies and waves together.
        rig.director.reset();
        rig.sim.reset();
        rig.pulses.reset();
        expect(rig.director.fields).toEqual([]);
        expect(rig.director.figureHeld).toBe(false);
        expect(rig.director.figureSparks).toEqual([]);
        expect(rig.director.posts.every((post) => post.feed === 0)).toBe(true);

        // The reactions were not reset: their queue and their emitters are still there, same epoch.
        const frame = reactions.update(STEP);
        expect(frame.waves.filter((entry) => entry.serial >= 0).length).toBe(sent);
        expect(frame.figure).toMatchObject({ held: true });
        rig.sim.step(STEP, rig.director.apply(frame, STEP));
        // No wave is sent a second time, the lock's puff and the spiral are not thrown again,
        // and the figure that was standing is not called back.
        expect(rig.add).toHaveBeenCalledTimes(sent);
        expect(rig.pulses.active()).toBe(0);
        expect(rig.sim.counts().bound).toBe(0);
        const again = spawnArgs(rig, thrown);
        expect(again.length).toBeLessThan(thrown * 0.5);
        expect(rig.director.epoch).toBe(frame.epoch);
    });

    it('starts counting afresh when the reactions start a new epoch', () => {
        const rig = setup();
        const reactions = eventful();
        rig.director.apply(reactions.update(STEP), STEP);
        expect(rig.director.epoch).toBe(1);
        const sent = rig.add.mock.calls.length;
        const thrown = rig.spawn.mock.calls.length;
        expect(sent).toBeGreaterThan(0);

        // Effects switched off and on again: the reactions reset, so serial 0 means a new event.
        reactions.reset();
        rig.director.reset();
        rig.sim.reset();
        rig.pulses.reset();
        reactions.onPieceLock({ piece: { x: 8, y: 20, shape: [[1]] } });
        const frame = reactions.update(STEP);
        expect(frame.epoch).toBe(2);
        expect(frame.emitters.map((entry) => entry.serial)).toEqual([0]);
        expect(frame.waves.filter((entry) => entry.serial >= 0).map((entry) => entry.serial)).toEqual([0]);
        rig.director.apply(frame, STEP);
        expect(rig.director.epoch).toBe(2);
        // That lock is answered, though its numbers were all used before.
        expect(rig.add).toHaveBeenCalledTimes(sent + 1);
        expect(rig.spawn.mock.calls.length).toBeGreaterThan(thrown);
        expect(rig.pulses.active()).toBe(1);
        // And the next four lines summon figure number one of this epoch.
        reactions.onLineClear(4, {});
        rig.director.apply(reactions.update(STEP), STEP);
        expect(rig.sim.counts().bound).toBeGreaterThan(0);

        // Without an epoch the director cannot know, and plays safe: the same numbers are the same events.
        const blind = setup();
        blind.director.apply({ waves: [wave(0)], emitters: [emitter('lock', { duration: 1.1 })] }, STEP);
        const once = [blind.add.mock.calls.length, blind.spawn.mock.calls.length];
        blind.director.apply({ waves: [wave(0)], emitters: [emitter('lock', { duration: 1.1 })] }, STEP);
        expect([blind.add.mock.calls.length, blind.spawn.mock.calls.length]).toEqual(once);
    });
});

describe('Forest firefly director: the environment it hands the simulation', () => {
    it('returns one environment, rewritten every frame from the frame and the wind', () => {
        const rig = setup();
        const env = rig.director.apply({
            epoch: 1, gust: 0.4, glow: 0.3, heat: 0.2, sync: 0.6, beatRate: 0.5, settled: true,
        }, STEP, { x: 0.6, z: -0.8 });
        expect(env).toBe(rig.director.env);
        expect(env).toMatchObject({
            windX: 0.6,
            windZ: -0.8,
            gust: 0.4,
            glow: 0.3,
            heat: 0.2,
            sync: 0.6,
            beatRate: 0.5,
            settled: true,
            front: null,
        });
        expect(env.fields).toBe(rig.director.fields);
        // The same object next frame, with that frame's values.
        const next = rig.director.apply({ epoch: 1, gust: 9, heat: -3 }, STEP);
        expect(next).toBe(env);
        expect(next.gust).toBe(1);
        expect(next.heat).toBe(0);
        expect(next.settled).toBe(false);
        // Nonsense is calm, and only `true` settles the forest.
        const calm = rig.director.apply({
            epoch: 1, gust: NaN, glow: 'x', heat: null, sync: undefined, beatRate: Infinity, settled: 'yes',
        }, STEP);
        expect(calm).toMatchObject({
            gust: 0, glow: 0, heat: 0, sync: 0, settled: false,
        });
        expect(Number.isFinite(calm.beatRate) && calm.beatRate > 0).toBe(true);
        expect(rig.director.apply({}, STEP)).toMatchObject({ windX: 1, windZ: 0 });
    });

    it('places the wind front across the view, and drops it when it has no strength', () => {
        const rig = setup();
        const span = rig.stage.halfWidth(46);
        const env = rig.director.apply({
            epoch: 1, front: { position: -1, direction: 1, strength: 0.7 },
        }, STEP);
        expect(env.front).toBe(rig.director.front);
        expect(env.front).toMatchObject({ strength: 0.7, direction: 1 });
        // A position of ±1 is the edge of what the eye sees deep in the glade.
        expect(env.front.x).toBeCloseTo(-span, 9);
        expect(rig.director.apply({ epoch: 1, front: { position: 0.5, direction: -1, strength: 0.2 } }, STEP).front.x)
            .toBeCloseTo(span * 0.5, 9);
        for (const front of [null, undefined, { position: 0, direction: 1, strength: 0 },
            { position: 0, direction: 1, strength: 0.0005 }, { position: 0, direction: 1, strength: NaN }]) {
            expect(rig.director.apply({ epoch: 1, front }, STEP).front).toBeNull();
        }
    });

    it('scales what it throws by the tier, with a floor so the poorest still plays', () => {
        const scales = [60, 480, 1200, 2400, 3600].map((fireflies) => setup({ fireflies }).director.scale);
        for (let index = 1; index < scales.length; index++) {
            expect(scales[index]).toBeGreaterThanOrEqual(scales[index - 1]);
        }
        expect(scales[0]).toBeGreaterThan(0.05);
        expect(scales.at(-1)).toBeGreaterThan(scales[0] * 3);
    });

    it('runs a whole eventful session against the real simulation without running out of room or numbers', () => {
        const rig = setup({ fireflies: 480, pulses: 3, groundHeight: gentleGround });
        const reactions = new ForestReactions({ quality: 'Low', rng: seededRandom(21) });
        const piece = (x) => ({ x, y: 20, shape: [[1, 1], [1, 1]] });
        let peak = 0;
        for (let frame = 0; frame < 900; frame++) {
            if (frame % 30 === 0) {
                reactions.onHardDrop({ distance: 4 + (frame % 17) });
                reactions.onPieceLock({ piece: piece((frame / 30) % 9) });
                reactions.onLineClear(1 + ((frame / 30) % 4), { clearedRows: [23] });
                reactions.onCombo(2 + frame / 60);
            }
            if (frame === 400) reactions.onPerfectClear();
            if (frame === 700) reactions.onGameOver();
            rig.sim.step(STEP, rig.director.apply(reactions.update(STEP), STEP, { x: 0.88, z: 0.47 }));
            rig.pulses.update(STEP);
            const { live, bound } = rig.sim.counts();
            expect(live).toBeLessThanOrEqual(rig.sim.reserve);
            expect(bound).toBeLessThanOrEqual(live);
            expect(rig.pulses.active()).toBeLessThanOrEqual(3);
            expect(rig.director.fields.length)
                .toBeLessThanOrEqual(reactions.maxEmitters + rig.director.posts.length + 1);
            peak = Math.max(peak, live);
        }
        expect(peak).toBeGreaterThan(rig.sim.reserve * 0.5);
        expect(rig.sim.outPlace.every(Number.isFinite)).toBe(true);
        expect(rig.sim.outGlow.every(Number.isFinite)).toBe(true);
        expect(rig.sim.outVelocity.every(Number.isFinite)).toBe(true);
        for (const call of rig.spawn.mock.calls) expect(call.slice(0, 6).every(Number.isFinite)).toBe(true);
    });
});
