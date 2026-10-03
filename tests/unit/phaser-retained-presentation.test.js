import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import EventEmitter from 'eventemitter3';
import { createBaseBoardScene } from '../../src/rendering/phaser/base-board-scene.js';
import { createBoardGrid, markBoardDirty } from '../../src/core/board.js';
import { insertGarbageEntries } from '../../src/core/garbage.js';

// Execute the installed Phaser Graphics drawing methods, not a hand-written
// command encoder. Renderer-dependent mixins are empty because these tests
// exercise its numeric commands without booting a DOM/GPU renderer.
const graphicsPath = new URL('../../node_modules/phaser/src/gameobjects/graphics/Graphics.js', import.meta.url);
const graphicsRequire = createRequire(graphicsPath);
const graphicsModule = { exports: {} };
runInNewContext(readFileSync(graphicsPath, 'utf8'), {
    module: graphicsModule,
    require(path) {
        if (path === '../components') return new Proxy({}, { get: () => ({}) });
        if (path === '../GameObject') return function GameObject() {};
        if (path === '../../cameras/2d/BaseCamera') return function BaseCamera() {};
        if (path === './GraphicsRender'
            || path === '../../renderer/webgl/renderNodes/defaults/DefaultGraphicsNodes.js') return {};
        return graphicsRequire(path);
    },
});
const Graphics = graphicsModule.exports;
function graphics() {
    const result = Object.create(Graphics.prototype);
    Object.assign(result, {
        commandBuffer: [], defaultFillColor: -1, defaultStrokeColor: -1, _lineWidth: 1, clearCount: 0,
    });
    const clear = result.clear;
    result.clear = function clearCounted() { this.clearCount++; return clear.call(this); };
    return result;
}
const PHASER = { Scene: class {}, BlendModes: { ADD: 1, NORMAL: 0 } };
const Scene = createBaseBoardScene(PHASER);
function state() {
    return {
        boardGrid: createBoardGrid(), boardVersion: 0, lockedPieces: [],
        currentPiece: { type: 'O', color: '#ffaa00', x: 4, y: 4, shape: [[1, 1], [1, 1]] },
    };
}
function boot(gs = state()) {
    const scene = new Scene('retained');
    scene.add = { graphics: vi.fn(graphics) };
    const camera = {};
    for (const method of ['setRoundPixels', 'setBounds', 'centerOn', 'setLerp', 'shake',
        'setZoom', 'setViewport', 'setScroll']) camera[method] = () => camera;
    scene.cameras = { main: camera };
    scene.scale = new EventEmitter();
    scene.events = new EventEmitter();
    scene.scene = { systems: { time: { now: 0 } } };
    scene.create();
    scene.attachGraphicsLayerAliases();
    scene.syncFromGameState(gs);
    return scene;
}
function referenceCurrent(scene, draw) {
    const piece = scene.gameState.currentPiece;
    scene.drawFusedPiece(draw, piece.shape, piece.x, piece.y,
        scene.colorToInt(scene.getThemedColor(piece.type, piece.color)), {
            alpha: 1, fx: scene._pieceFx(piece.type), gloss: true,
            skipHiddenRows: !scene.gameState.isInfinityMode,
        });
}

describe('retained Phaser presentation preserves real command buffers', () => {
    const scenes = [];
    beforeEach(() => {
        vi.stubGlobal('window', {
            Phaser: PHASER, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
            settingsManager: { get: () => ({ reducedMotion: false, themeBasedTetrominos: false }) },
            matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        });
        vi.stubGlobal('CustomEvent', class { constructor(type) { this.type = type; } });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const scene of scenes.splice(0)) scene.shutdown();
        expect(console.error).not.toHaveBeenCalled();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    function board(gs) {
        const result = boot(gs);
        scenes.push(result);
        return result;
    }

    it('builds stationary body/gloss once while preserving every ghost pulse and complete draw order', () => {
        const scene = board();
        const body = vi.spyOn(scene, 'fillFusedBody');
        const gloss = vi.spyOn(scene, 'glossPass');
        const alphas = new Set();
        const realFill = scene.fillContour.bind(scene);
        vi.spyOn(scene, 'fillContour').mockImplementation((...args) => {
            alphas.add(args[3]); return realFill(...args);
        });
        const layer = scene.pieceGraphics;
        for (let frame = 0; frame < 120; frame++) {
            scene.scene.systems.time.now = frame * 1000 / 120;
            scene.update(frame * 1000 / 120, 1000 / 120);
            const actual = [...layer.commandBuffer];
            const actualLineWidth = layer._lineWidth;
            const reference = graphics();
            scene.pieceGraphics = reference;
            scene.drawGhostPiece();
            referenceCurrent(scene, reference);
            scene.pieceGraphics = layer;
            expect(actual).toEqual(reference.commandBuffer);
            expect(actualLineWidth).toBe(reference._lineWidth);
        }
        // The reference draws above add 120 calls; retained presentation adds 1.
        expect(body).toHaveBeenCalledTimes(121);
        expect(gloss).toHaveBeenCalledTimes(121);
        expect(alphas.size).toBe(120);
        expect(scene.add.graphics).toHaveBeenCalledTimes(4);
        layer.strokeRect(3, 5, 8, 11);
        const reference = graphics();
        referenceCurrent(scene, reference);
        reference.strokeRect(3, 5, 8, 11);
        expect(layer.commandBuffer.slice(-20)).toEqual(reference.commandBuffer.slice(-20));
    });

    it('invalidates body commands for fractional movement, shape edits, style values, color, clipping and resize', () => {
        const scene = board();
        const fx = { ...scene._pieceFx('O') };
        scene._pieceFx = () => fx;
        scene.getThemedColor = (type, color) => color;
        const piece = scene.gameState.currentPiece;
        const compare = () => {
            scene.pieceGraphics.clear();
            scene.drawCurrentPiece();
            const reference = graphics();
            referenceCurrent(scene, reference);
            expect(scene.pieceGraphics.commandBuffer).toEqual(reference.commandBuffer);
            // Also exercise reuse after each individual mutation.
            scene.pieceGraphics.clear();
            scene.drawCurrentPiece();
            expect(scene.pieceGraphics.commandBuffer).toEqual(reference.commandBuffer);
        };
        compare();
        for (const mutate of [
            () => { piece.x += 0.25; }, () => { piece.y += 0.125; },
            () => { piece.color = '#22aabb'; }, () => { fx.highlight = 0.38; },
            () => { fx.shadow = 0.07; }, () => { fx.glossAlpha = 0.55; },
            () => { fx.rimAlpha = 0.7; fx.rimWidthFactor = 0.1; },
            () => { piece.shape[0][0] = 0; }, () => { piece.y = scene.hiddenRows - 1.25; },
            () => { scene.gameState.isInfinityMode = true; }, () => { scene.blockSize = 23.375; },
            () => { fx.gloss = false; fx.gradient = false; fx.rim = false; },
            () => { piece.shape = [[0, 1, 0], [1, 1, 1]]; },
        ]) { mutate(); compare(); }
    });

    it('keeps animated pieces between the ghost and retained active body', () => {
        const gs = state();
        gs.lockedPieces.push({ type: 'GARBAGE', color: '#808080', x: 2, y: 18,
            shape: [[1, 1, 0, 1]], isAnimating: true, animationOffset: 1 });
        const scene = board(gs);
        const layer = scene.pieceGraphics;
        for (const offset of [1, 0.75, 0.1, 0]) {
            gs.lockedPieces[0].animationOffset = offset;
            scene.update(0, 16);
            const actual = [...layer.commandBuffer];
            const reference = graphics();
            scene.pieceGraphics = reference;
            scene.drawGhostPiece();
            scene.drawAnimatedPieces();
            referenceCurrent(scene, reference);
            scene.pieceGraphics = layer;
            expect(actual).toEqual(reference.commandBuffer);
        }
    });

    it('uses the generic draw path without numeric commandBuffer support', () => {
        const scene = board();
        scene.pieceGraphics = {};
        const draw = vi.spyOn(scene, 'drawFusedPiece').mockImplementation(() => {});
        scene.drawCurrentPiece();
        expect(draw).toHaveBeenCalledOnce();
    });

    it('bounds retained command data and retires it when the scene shuts down', () => {
        const scene = board();
        scene.gameState.currentPiece.shape = [Array(1000).fill(1)];
        scene.drawCurrentPiece();
        expect(scene._activePieceBodyCache).toBeNull();
        scene.gameState.currentPiece.shape = [[1]];
        scene.pieceGraphics.clear();
        scene.drawCurrentPiece();
        expect(scene._activePieceBodyCache.commands.length).toBeLessThan(4096);
        scene.shutdown();
        expect(scene._activePieceBodyCache).toBeNull();
        expect(scene._animatedPieces).toEqual([]);
        expect(scene._blindOverlayCache).toBeNull();
    });

    it('scans 1,000 settled pieces once across 120 unchanged frames', () => {
        let reads = 0;
        const gs = state();
        gs.lockedPieces = Array.from({ length: 1000 }, () => ({ get isAnimating() { reads++; return false; } }));
        const scene = board(gs);
        for (let frame = 0; frame < 120; frame++) scene.drawAnimatedPieces();
        expect(reads).toBe(1000);
        expect(scene._animatedPieces).toEqual([]);
    });

    it('tracks live offsets, zero-offset starts, completion and a marked in-place restart', () => {
        const gs = state();
        const piece = { type: 'T', color: '#aabbcc', x: 4, y: 14, shape: [[1]], isAnimating: true, animationOffset: 0 };
        gs.lockedPieces = [piece];
        const scene = board(gs);
        const draw = vi.spyOn(scene, 'drawFusedPiece');
        scene.drawAnimatedPieces();
        expect(draw).not.toHaveBeenCalled();
        piece.animationOffset = 0.75;
        scene.drawAnimatedPieces();
        expect(draw.mock.calls.at(-1)[3]).toBe(14.75);
        piece.isAnimating = false;
        scene.drawAnimatedPieces();
        expect(scene._animatedPieces).toEqual([]);
        piece.isAnimating = true;
        piece.animationOffset = 0.25;
        markBoardDirty(gs);
        scene.drawAnimatedPieces();
        expect(draw.mock.calls.at(-1)[3]).toBe(14.25);
        piece.isAnimating = false;
        scene.drawAnimatedPieces();
        piece.isAnimating = true;
        scene.markBoardDirty();
        scene.drawAnimatedPieces();
        expect(scene._animatedPieces).toEqual([piece]);
    });

    it('invalidates candidates for array/grid/owner replacement and appended real garbage', () => {
        const gs = state();
        gs.currentPiece = null;
        const scene = board(gs);
        scene.drawAnimatedPieces();
        const result = insertGarbageEntries(gs.lockedPieces, [{ type: 'line', holeMask: 1, attackId: 'retained' }], {
            animated: true, settleFloatingBlocks: false, boardGrid: gs.boardGrid,
        });
        markBoardDirty(gs);
        scene.drawAnimatedPieces();
        expect(result.garbagePieces).toHaveLength(1);
        expect(scene._animatedPieces).toEqual(result.garbagePieces);
        const replacement = { ...result.garbagePieces[0], animationOffset: 0.5 };
        gs.lockedPieces = [replacement];
        scene.drawAnimatedPieces();
        expect(scene._animatedPieces).toEqual([replacement]);
        gs.lockedPieces[0] = { ...replacement, animationOffset: 0.25 };
        gs.boardGrid = createBoardGrid();
        scene.drawAnimatedPieces();
        expect(scene._animatedPieces).toEqual(gs.lockedPieces);
        const nextOwner = { ...gs, lockedPieces: gs.lockedPieces };
        nextOwner.lockedPieces[0] = { ...replacement, animationOffset: 0.125 };
        scene.syncFromGameState(nextOwner);
        scene.drawAnimatedPieces();
        expect(scene._animatedPieces).toEqual(nextOwner.lockedPieces);
        nextOwner.lockedPieces.push({ ...replacement }); // Length fence without a version bump.
        scene.drawAnimatedPieces();
        expect(scene._animatedPieces).toHaveLength(2);
    });

    it('retires simultaneous completions without reordering the remaining animations', () => {
        const gs = state();
        gs.lockedPieces = Array.from({ length: 1000 }, (_, x) => ({
            type: 'GARBAGE', color: '#808080', shape: [[1]], x, y: 20,
            isAnimating: true, animationOffset: 0.5,
        }));
        const scene = board(gs);
        const draw = vi.spyOn(scene, 'drawFusedPiece').mockImplementation(() => {});
        scene.drawAnimatedPieces();
        for (const piece of gs.lockedPieces) piece.isAnimating = piece.x === 7 || piece.x === 981;
        draw.mockClear();
        scene.drawAnimatedPieces();
        expect(draw.mock.calls.map((call) => call[2])).toEqual([7, 981]);
        draw.mockClear();
        scene.drawAnimatedPieces();
        expect(draw.mock.calls.map((call) => call[2])).toEqual([7, 981]);
        for (const piece of gs.lockedPieces) piece.isAnimating = false;
        scene.drawAnimatedPieces();
        expect(scene._animatedPieces).toEqual([]);
    });

    it('retains partial-blind plateau, preserves the exact fade, and clears once on expiry/removal', () => {
        const gs = state();
        gs.currentPiece = null;
        for (let y = 19; y < 24; y++) {
            for (let x = 0; x < 10; x++) gs.boardGrid[y][x] = { type: 'GARBAGE', color: '#808080' };
        }
        gs.blindTimers = { field: 0, pending: 6000, pendingMax: 6000 };
        const scene = board(gs);
        const rect = vi.spyOn(scene.blindGraphics, 'fillRect');
        let original;
        for (let frame = 0; frame < 120; frame++) {
            gs.blindTimers.pending = 6000 - frame * 1000 / 120;
            scene.update(0, 16);
            original ??= [...scene.blindGraphics.commandBuffer];
            expect(scene.blindGraphics.commandBuffer).toEqual(original);
        }
        expect(scene.blindGraphics.clearCount).toBe(1);
        expect(rect).toHaveBeenCalledTimes(50);
        for (const remaining of [1500, 1000, 10]) {
            gs.blindTimers.pending = remaining;
            scene.update(0, 16);
            const reference = graphics();
            reference.fillStyle(0x05070d, 0.92 * Math.min(1, remaining / 1500));
            for (let y = 19; y < 24; y++) {
                for (let x = 0; x < 10; x++) reference.fillRect(x * scene.blockSize, y * scene.blockSize, scene.blockSize, scene.blockSize);
            }
            expect(scene.blindGraphics.commandBuffer).toEqual(reference.commandBuffer);
        }
        gs.blindTimers.pending = 0;
        scene.update(0, 16);
        expect(scene.blindGraphics.commandBuffer).toEqual([]);
        const clears = scene.blindGraphics.clearCount;
        scene.update(0, 16);
        expect(scene.blindGraphics.clearCount).toBe(clears);
        gs.blindTimers.pending = 3000;
        scene.update(0, 16);
        scene._invalidatePresentation();
        delete gs.blindTimers;
        scene.update(0, 16);
        expect(scene.blindGraphics.commandBuffer).toEqual([]);
    });

    it('invalidates blind geometry on mutations, full/partial changes, dimensions, camera band and snapshot replacement', () => {
        const gs = state();
        gs.currentPiece = null;
        gs.boardGrid[20][1] = { type: 'CLEAN_GARBAGE' };
        gs.blindTimers = { pending: 4000, pendingMax: 6000, field: 0, fieldMax: 6000 };
        const scene = board(gs);
        scene.update(0, 16);
        const initial = [...scene.blindGraphics.commandBuffer];
        gs.boardGrid[20][2] = { type: 'GARBAGE' };
        markBoardDirty(gs);
        scene.update(0, 16);
        expect(scene.blindGraphics.commandBuffer.length).toBe(initial.length + 5);
        gs.blindTimers.field = 4000;
        scene.update(0, 16);
        const reference = graphics();
        reference.fillStyle(0x05070d, 0.92);
        reference.fillRect(0, scene.hiddenRows * scene.blockSize, scene.cols * scene.blockSize, scene.rows * scene.blockSize);
        expect(scene.blindGraphics.commandBuffer).toEqual(reference.commandBuffer);
        scene.cameraSettings = { activeTopRow: 8, visibleRows: 12, renderPadding: 0 };
        scene.blockSize = 25.25;
        scene.cols = 8;
        scene.update(0, 16);
        reference.clear();
        reference.fillStyle(0x05070d, 0.92);
        reference.fillRect(0, 202, 202, 303);
        expect(scene.blindGraphics.commandBuffer).toEqual(reference.commandBuffer);
        gs.blindTimers.field = 0;
        gs.boardGrid = createBoardGrid();
        scene.update(0, 16);
        reference.clear(); reference.fillStyle(0x05070d, 0.92);
        expect(scene.blindGraphics.commandBuffer).toEqual(reference.commandBuffer);
    });

    it('samples a 200-cell stack shade once per color/row boundary with unchanged numeric commands', () => {
        const gs = state();
        gs.currentPiece = null;
        for (let y = 4; y < 24; y++) {
            for (let x = 0; x < 10; x++) gs.boardGrid[y][x] = { type: 'T', color: '#0000ff' };
        }
        const scene = board(gs);
        const shade = vi.spyOn(scene, '_shadeColor');
        scene.update(0, 16);
        expect(shade).toHaveBeenCalledTimes(21);
        // Restore the original per-cell shade workload for an independent
        // command comparison; only cached sampling changes, not geometry/rim.
        const reference = graphics();
        const actual = scene.boardGraphics;
        const originalShade = Scene.prototype._shadeColor;
        scene._poolShadeCache = {
            clear() {}, get: () => null, set() {},
        };
        scene._shadeColor = vi.fn((...args) => originalShade.apply(scene, args));
        scene.boardGraphics = reference;
        scene.drawBoardFromGrid();
        scene.boardGraphics = actual;
        expect(actual.commandBuffer).toEqual(reference.commandBuffer);
        expect(scene._shadeColor).toHaveBeenCalledTimes(400);
    });

    it('keeps stack-shade colors independent and refreshes samples for a different camera band', () => {
        const gs = state();
        gs.currentPiece = null;
        for (let y = 4; y < 24; y++) {
            gs.boardGrid[y][0] = { type: 'T', color: '#000000' };
            gs.boardGrid[y][1] = { type: 'T', color: '#ff6600' };
        }
        const scene = board(gs);
        scene.getThemedColor = (type, color) => color;
        for (const topRow of [4, 8, 12]) {
            scene.cameraSettings = { activeTopRow: topRow, visibleRows: 12, renderPadding: 0 };
            const actual = scene.boardGraphics;
            scene.update(0, 16);
            const cachedShade = scene._poolShadeCache;
            scene._poolShadeCache = { clear() {}, get: () => null, set() {} };
            const reference = graphics();
            scene.boardGraphics = reference;
            scene.drawBoardFromGrid();
            scene.boardGraphics = actual;
            scene._poolShadeCache = cachedShade;
            expect(actual.commandBuffer).toEqual(reference.commandBuffer);
        }
    });
});
