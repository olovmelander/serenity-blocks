/**
 * A cascade's move as Quadra frames it (docs/MENU_UI_OVERHAUL_2026-10.md §5.8): what a
 * wave drops lands where it lands, the move is summed up once it settles ("Combo ×3 /
 * 7 lines"), and a move that empties the well says "Clean canvas" instead, named by
 * the move that made it.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';
import { FX } from '../../src/rendering/phaser/fx/fx-kit.js';

globalThis.window = globalThis.window || {};
globalThis.window.Phaser = {
    Geom: { Rectangle: class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } } },
    BlendModes: { ADD: 1, NORMAL: 0 },
};

const BS = 40;
const ROWS = 24;
const COLS = 10;

function makeScene(gameState) {
    const images = [];
    const texts = [];
    const emitters = [];
    const chain = (obj, names) => {
        names.forEach((name) => { obj[name] = vi.fn(() => obj); });
        return obj;
    };
    return {
        images,
        texts,
        emitters,
        cols: COLS,
        rows: 20,
        blockSize: BS,
        hiddenRows: 4,
        gameState,
        cameras: { main: { zoom: 1, scrollY: 0 } },
        textures: { exists: () => true },
        getQualityConfig: () => ({ particles: true }),
        shakeCamera: vi.fn(),
        time: { delayedCall: vi.fn(() => ({ hasDispatched: false, remove() {} })) },
        tweens: { add: vi.fn((cfg) => cfg), killTweensOf: vi.fn() },
        add: {
            image: vi.fn((x, y, key) => {
                const img = chain({
                    x, y, key, width: 64, height: 64, scale: 1, scaleX: 1, scaleY: 1, scene: {},
                }, ['setOrigin', 'setDisplaySize', 'setAlpha', 'setDepth', 'setScrollFactor', 'setBlendMode', 'destroy']);
                img.setTint = vi.fn((tint) => { img.tint = tint; return img; });
                images.push(img);
                return img;
            }),
            container: vi.fn((x, y) => chain({
                x,
                y,
                list: [],
                scene: {},
                add(o) { this.list.push(o); return this; },
                addAt(o, i) { this.list.splice(i, 0, o); return this; },
            }, ['setDepth', 'setScrollFactor', 'setScale', 'setAlpha', 'destroy'])),
            text: vi.fn((x, y, str) => {
                const t = chain({
                    x, y, text: str, width: String(str).length * 12, height: 24,
                }, ['setOrigin', 'setAlpha', 'setDepth', 'setScrollFactor', 'setBlendMode', 'setShadow', 'setLetterSpacing', 'destroy']);
                texts.push(t);
                return t;
            }),
            particles: vi.fn((x, y, key, config) => {
                const e = chain({
                    x, y, key, config, emitted: [],
                }, ['setDepth', 'setScrollFactor', 'destroy']);
                e.emitParticleAt = vi.fn((px, py, n) => e.emitted.push([px, py, n]));
                e.explode = vi.fn(() => true);
                emitters.push(e);
                return e;
            }),
            graphics: vi.fn(() => chain({}, ['setScrollFactor', 'setDepth', 'setBlendMode', 'clear', 'destroy', 'fillStyle', 'fillRect'])),
        },
    };
}

const O = [[1, 1], [1, 1]];
const piece = (pieceId, x, y, shape = O) => ({
    pieceId, x, y, shape, color: '#9ee8ed', type: 'O',
});

function rebuild(gs) {
    gs.boardGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    gs.lockedPieces.forEach((p) => p.shape.forEach((row, ry) => row.forEach((v, rx) => {
        if (v) gs.boardGrid[p.y + ry][p.x + rx] = { id: p.pieceId, color: p.color };
    })));
}

/** A full garbage row at the floor, the row the wave clears. */
const floorRow = () => piece(999, 0, 23, [Array(COLS).fill(1)]);

let clock = 0;
const words = (scene) => scene.texts.map((t) => t.text);
const landingPools = (scene) => scene.images.filter((img) => img.key === FX.GLOW && img.y === 800);

/** One wave as physics drives it: the impact, then the flash. */
function wave(fx, rows, depth) {
    fx.playLineClearImpact(rows.length, depth);
    fx.triggerLineClearFlash(rows);
}

let gs;
let scene;
let fx;
beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    gs = { lockedPieces: [], isProcessingPhysics: true };
    scene = makeScene(gs);
    fx = new SharedEffects(scene);
    fx._reducedMotion = () => false;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('landing glow', () => {
    it('a piece the cascade dropped lights where it lands, once it comes to rest', () => {
        gs.lockedPieces = [piece(1, 0, 18), floorRow()];
        rebuild(gs);
        wave(fx, [23], 1);

        // The row goes and the piece falls four rows onto the floor.
        gs.lockedPieces = [piece(1, 0, 22)];
        rebuild(gs);
        fx.observeSettling(gs);
        expect(landingPools(scene)).toHaveLength(0); // still moving, as far as anyone knows

        clock += 60;
        fx.observeSettling(gs);
        const [pool] = landingPools(scene);
        expect(pool).toBeDefined();
        expect(pool.x).toBe(BS); // centred under the O's two columns
        expect(scene.images.some((img) => img.key === FX.FLARE && img.y === 800)).toBe(true);
        // From three rows it kicks up a little dust.
        expect(scene.emitters.some((e) => e.emitted.length > 0)).toBe(true);
    });

    it('a one-row shift is not a landing', () => {
        gs.lockedPieces = [piece(1, 0, 21), floorRow()];
        rebuild(gs);
        wave(fx, [23], 1);
        gs.lockedPieces = [piece(1, 0, 22)];
        rebuild(gs);
        fx.observeSettling(gs);
        clock += 60;
        fx.observeSettling(gs);
        expect(landingPools(scene)).toHaveLength(0);
    });

    it('lights at most six landings a settle, the longest falls first', () => {
        // Five O pieces side by side and three I pieces lying flat, each falling a
        // different distance onto the floor.
        const pieces = [0, 2, 4, 6, 8].map((x, i) => piece(10 + i, x, 22 - (2 + i)));
        gs.lockedPieces = [...pieces, floorRow()];
        rebuild(gs);
        wave(fx, [23], 1);
        gs.lockedPieces = pieces.map((p) => ({ ...p, y: 22 }));
        rebuild(gs);
        fx.observeSettling(gs);
        clock += 60;
        fx.observeSettling(gs);
        expect(landingPools(scene)).toHaveLength(5);

        // Eight single blocks in eight columns, falling 2..9 rows to the floor.
        const many = makeScene(gs);
        const manyFx = new SharedEffects(many);
        const land = vi.spyOn(manyFx, '_land');
        const blocks = Array.from({ length: 8 }, (_, i) => piece(40 + i, i, 23 - (2 + i), [[1]]));
        gs.lockedPieces = [...blocks, piece(999, 0, 23, [Array(COLS).fill(1)])];
        rebuild(gs);
        manyFx.playLineClearImpact(1, 1);
        manyFx.triggerLineClearFlash([23]);
        gs.lockedPieces = blocks.map((p) => ({ ...p, y: 23 }));
        rebuild(gs);
        manyFx.observeSettling(gs);
        clock += 60;
        manyFx.observeSettling(gs);
        expect(land.mock.calls.map(([, rows]) => rows)).toEqual([9, 8, 7, 6, 5, 4]);
    });
});

describe('the move\'s finale', () => {
    function settle() {
        gs.isProcessingPhysics = true;
        fx.observeSettling(gs);
        gs.isProcessingPhysics = false;
        clock += 16;
        fx.observeSettling(gs);
    }

    it('a lock\'s own clear says nothing more once it settles', () => {
        gs.lockedPieces = [floorRow()];
        rebuild(gs);
        wave(fx, [23], 1);
        const before = words(scene).length;
        settle();
        expect(words(scene).length).toBe(before);
        expect(fx._settle).toBeNull();
    });

    it('a cascade is summed up when it settles: its waves, then its lines', () => {
        gs.lockedPieces = [floorRow()];
        rebuild(gs);
        wave(fx, [22, 23], 1);
        wave(fx, [23], 2);
        wave(fx, [21, 22, 23], 3);
        expect(fx._move).toMatchObject({ waves: 3, lines: 6 });

        scene.texts.length = 0;
        settle();
        expect(words(scene)).toEqual(expect.arrayContaining(['COMBO ×3', '6 lines']));
    });

    it('a deep cascade\'s finale is the big one', () => {
        gs.lockedPieces = [floorRow()];
        rebuild(gs);
        for (let depth = 1; depth <= 11; depth++) wave(fx, [23], depth);
        scene.texts.length = 0;
        settle();
        expect(words(scene)).toEqual(expect.arrayContaining(['11 LINES', '×11', 'Cascade']));
    });

    it('a clean canvas names the move that made it, and replaces the summary', () => {
        gs.lockedPieces = [floorRow()];
        rebuild(gs);
        wave(fx, [22, 23], 1);
        wave(fx, [23], 2);
        wave(fx, [23], 3);
        wave(fx, [23], 4);
        fx.playPerfectClear(5);
        expect(words(scene)).toEqual(expect.arrayContaining(['COMBO ×4 · 5 LINES', 'Clean canvas']));

        scene.texts.length = 0;
        settle();
        expect(words(scene)).toEqual([]);
    });

    it('a single clear\'s clean canvas is a perfect clear', () => {
        gs.lockedPieces = [floorRow()];
        rebuild(gs);
        wave(fx, [20, 21, 22, 23], 1);
        scene.texts.length = 0;
        fx.playPerfectClear(4);
        expect(words(scene)).toEqual(expect.arrayContaining(['PERFECT CLEAR', 'Clean canvas']));
    });

    it('each wave\'s count replaces the last one\'s', () => {
        fx.showComboPopup(2);
        fx.showComboPopup(3);
        fx.showComboPopup(4);
        expect(fx._popups.size).toBe(1);
    });

    it('a reset forgets the move and the watch', () => {
        gs.lockedPieces = [floorRow()];
        rebuild(gs);
        wave(fx, [23], 1);
        wave(fx, [23], 2);
        fx.cleanup();
        expect(fx._settle).toBeNull();
        expect(fx._move).toEqual({ waves: 0, lines: 0, clean: false });
        expect(fx._popups.size).toBe(0);
    });
});
