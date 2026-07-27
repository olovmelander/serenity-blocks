/**
 * @fileoverview Phaser board smoke test (plan Phase 3b).
 *
 * The remediation plan calls this "the only test that would catch a Phaser-
 * integration break": boot a board scene, drop a piece, clear a line, assert
 * score. It drives the REAL shared board renderer (`createBaseBoardScene` — the
 * base class every mode's board extends) end to end against the REAL core
 * physics/scoring path.
 *
 * Why a Phaser test double instead of a real `Phaser.Game`:
 * this repo runs vitest in the default node environment with no jsdom/canvas,
 * and Phaser 4 cannot even be imported without `window`. The scene factory is
 * injectable by design (`createBaseBoardScene(phaserLib)`), so we inject a
 * faithful double that supplies the small plugin surface the render path uses
 * (`add.graphics`, `cameras.main`, `scale`, `events`) and records draw calls.
 * That exercises the scene's real lifecycle + render pipeline
 * (createGraphicsLayers -> configureCamera -> renderGameState ->
 * drawBoardFromGrid -> fillRect) against real game state. A break in that
 * pipeline — including one the scene would otherwise swallow via its
 * try/catch — fails this test (we assert `console.error` was never called).
 * Booting real Phaser would require adding a DOM/canvas stack: a separate infra
 * decision, out of scope here.
 *
 * Note: `TetrominoStyleManager.init()` touches `window.addEventListener`
 * unguarded, so the scene needs a minimal `window` shim to construct in node.
 */
import {
    describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createBaseBoardScene } from '../../src/rendering/phaser/base-board-scene.js';
import { processPhysics } from '../../src/core/physics.js';
import { createBoardGrid, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

// ── Faithful minimal Phaser test double (node env: no DOM/WebGL) ─────────────

/** A Graphics layer double that records fillRect calls and resets on clear(). */
function makeGraphics() {
    const g = { drawnRects: [], clearCount: 0 };
    const chain = () => g;
    const noopMethods = [
        'fillStyle', 'fillGradientStyle', 'lineStyle', 'beginPath', 'moveTo',
        'lineTo', 'closePath', 'strokePath', 'fillPath', 'setBlendMode',
        'setDepth', 'setScrollFactor', 'setAlpha', 'setVisible', 'setPosition',
        'strokeRect', 'strokeRoundedRect', 'fillRoundedRect', 'fillCircle',
        'fillTriangle', 'save', 'restore', 'destroy',
    ];
    for (const m of noopMethods) g[m] = chain;
    g.clear = () => { g.drawnRects = []; g.clearCount += 1; return g; };
    g.fillRect = (x, y, w, h) => {
        g.drawnRects.push({
            x, y, w, h,
        }); return g;
    };
    return g;
}

function makeCamera() {
    const cam = {};
    const methods = [
        'setRoundPixels', 'setBounds', 'centerOn', 'setLerp', 'shake',
        'setZoom', 'setViewport', 'setScroll', 'setBackgroundColor', 'setName',
    ];
    for (const m of methods) cam[m] = () => cam;
    return cam;
}

class FakeScene {
    constructor(key) { this.sceneKey = key; }
}

const FAKE_PHASER = {
    Scene: FakeScene,
    Utils: { String: { UUID: () => 'smoke-uuid' } },
};

/** Construct a BaseBoardScene and inject the plugin systems a Game would. */
function bootScene() {
    const BaseBoardScene = createBaseBoardScene(FAKE_PHASER);
    const scene = new BaseBoardScene('SmokeBoard');
    scene.add = { graphics: () => makeGraphics() };
    scene.cameras = { main: makeCamera() };
    scene.scale = { on: () => {}, off: () => {} };
    scene.events = { emit: vi.fn(), on: () => {}, off: () => {} };
    scene.time = { delayedCall: () => ({}) };
    scene.create();
    scene.attachGraphicsLayerAliases();
    return scene;
}

// Fixture pieces mirror tests/unit/golden-rule-fixtures.test.js.
function fullRowPiece() {
    return {
        pieceId: 'smoke-row',
        color: '#4488cc',
        type: 'row',
        x: 0,
        y: BOTTOM,
        shape: [Array(COLS).fill(1)],
    };
}
function loneBlockPiece() {
    return {
        pieceId: 'smoke-block',
        color: '#cc8844',
        type: 'block',
        x: 0,
        y: BOTTOM - 6,
        shape: [[1]],
    };
}

describe('Phaser board smoke (Phase 3b)', () => {
    let errorSpy;
    let hadWindow;

    beforeEach(() => {
        // Minimal browser shim: the render stack legitimately expects window
        // (TetrominoStyleManager.init + first-render dispatch). Kept local and
        // torn down after each test so it cannot leak into other suites.
        hadWindow = 'window' in globalThis;
        if (!hadWindow) {
            globalThis.window = {
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => true,
            };
        }
        if (typeof globalThis.CustomEvent === 'undefined') {
            // Function constructor (not a class) so the file keeps a single class.
            globalThis.CustomEvent = function CustomEvent(type, opts = {}) {
                this.type = type;
                this.detail = opts.detail;
            };
        }
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (!hadWindow) delete globalThis.window;
    });

    it('boots, renders a populated board, then clears a line and re-renders with a higher score', async () => {
        const scene = bootScene();

        // ── Phase A: render a populated board (full bottom row + a lone block) ──
        const gs = {
            boardGrid: createBoardGrid(),
            lockedPieces: [fullRowPiece(), loneBlockPiece()],
            score: 0,
            level: 1,
            lines: 0,
            linesUntilNextLevel: 15,
            isSeeking: true,
            comboState: { lockFootprint: [], manualColumns: [] },
            boardVersion: 0,
            currentPiece: null,
        };
        rebuildBoardGridFromPieces(gs.lockedPieces, gs.boardGrid);

        scene.syncFromGameState(gs);
        scene.update(0, 16);

        // The scene must render the board without a swallowed error, emit its
        // first-render signal, and draw at least the full bottom row of cells.
        expect(errorSpy).not.toHaveBeenCalled();
        expect(scene.events.emit).toHaveBeenCalledWith(
            'first-render',
            expect.objectContaining({ sceneKey: 'SmokeBoard' }),
        );
        const drawnBefore = scene.boardGraphics.drawnRects.length;
        expect(drawnBefore).toBeGreaterThanOrEqual(COLS);

        // ── Phase B: the drop clears the line via REAL physics; score rises ──
        const scoreBefore = gs.score;
        await processPhysics(gs, {});

        expect(gs.lines).toBeGreaterThanOrEqual(1);
        expect(gs.score).toBeGreaterThan(scoreBefore);

        // Signal the board changed so the static layer redraws, then re-render.
        gs.boardVersion += 1;
        scene.update(16, 16);

        expect(errorSpy).not.toHaveBeenCalled();
        expect(scene.boardGraphics.clearCount).toBeGreaterThan(0);
        // The cleared row is gone, so the redrawn board has fewer cells.
        expect(scene.boardGraphics.drawnRects.length).toBeLessThan(drawnBefore);
    });

    it('renders an empty board without erroring or drawing cells', () => {
        const scene = bootScene();

        scene.syncFromGameState({
            boardGrid: createBoardGrid(),
            lockedPieces: [],
            boardVersion: 0,
            currentPiece: null,
        });

        expect(() => scene.update(0, 16)).not.toThrow();
        expect(errorSpy).not.toHaveBeenCalled();
        expect(scene.boardGraphics.drawnRects.length).toBe(0);
    });
});
