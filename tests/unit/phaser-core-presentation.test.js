import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import EventEmitter from 'eventemitter3';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createBoardScene } from '../../src/rendering/phaser/board-scene.js';
import { createBoardGrid } from '../../src/core/board.js';
import { GameState } from '../../src/core/game.js';
import { expandGridIfNeeded } from '../../src/core/infinity-grid.js';
import { INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1 } from '../../src/core/infinity-spawn-policy.js';
import { BaseGameMode } from '../../src/core/game-modes/BaseGameMode.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import {
    applyPhaserFrameRate, phaserFrameRateConfig, phaserBoardRuntimeConfig,
} from '../../src/rendering/phaser/frame-rate-policy.js';

const require = createRequire(import.meta.url);
const TimeStep = require('../../node_modules/phaser/src/core/TimeStep.js');
const Clock = require('../../node_modules/phaser/src/time/Clock.js');
const TweenBuilder = require('../../node_modules/phaser/src/tweens/builders/TweenBuilder.js');
class FakeScene {
    constructor() { this.events = new EventEmitter(); }
}
const PHASER = {
    Scene: FakeScene,
    Utils: { String: { UUID: () => 'presentation' } },
    BlendModes: { ADD: 1, NORMAL: 0 },
};
const BoardScene = createBoardScene(PHASER);
// Captured from commit 6080857's actual fused draw path, including fractional rounding;
// the gloss since drawn as one exact rect per run of cells (ADD seams fixed).
const fillBaseline = JSON.parse(
    readFileSync(new URL('../fixtures/phaser-piece-fill-baseline.json', import.meta.url), 'utf8'),
);
const commandDigest = (draw) => createHash('sha256').update(JSON.stringify(draw.commands)).digest('hex');

function graphics() {
    const result = { commands: [], clearCount: 0 };
    for (const method of ['fillStyle', 'fillGradientStyle', 'lineStyle', 'beginPath', 'moveTo', 'lineTo',
        'closePath', 'strokePath', 'fillPath', 'setBlendMode', 'setDepth', 'setScrollFactor',
        'setAlpha', 'setVisible', 'setPosition', 'strokeRect', 'fillRect', 'destroy']) {
        result[method] = (...args) => { result.commands.push([method, ...args]); return result; };
    }
    result.clear = () => { result.clearCount++; result.commands = []; return result; };
    return result;
}

function boot() {
    const scene = new BoardScene();
    scene.add = { graphics };
    const camera = {};
    for (const method of ['setRoundPixels', 'setBounds', 'centerOn', 'setLerp', 'shake',
        'setZoom', 'setViewport', 'setScroll']) camera[method] = () => camera;
    scene.cameras = { main: camera };
    scene.scale = new EventEmitter();
    scene.tweens = { killAll: vi.fn() };
    scene.create();
    return scene;
}

function state() {
    return {
        boardGrid: createBoardGrid(), lockedPieces: [], boardVersion: 0,
        currentPiece: { type: 'O', color: '#ff9900', x: 4, y: 4, shape: [[1, 1], [1, 1]] },
    };
}

describe('Phaser board presentation ownership', () => {
    let browserEvents;
    let media;
    const scenes = [];
    beforeEach(() => {
        browserEvents = new EventEmitter();
        media = new EventEmitter();
        media.matches = true;
        media.addEventListener = media.on.bind(media);
        media.removeEventListener = media.off.bind(media);
        vi.stubGlobal('window', {
            Phaser: PHASER,
            addEventListener: browserEvents.on.bind(browserEvents),
            removeEventListener: browserEvents.off.bind(browserEvents),
            dispatchEvent: (event) => browserEvents.emit(event.type, event),
            settingsManager: { get: () => ({ reducedMotion: true, themeBasedTetrominos: false }) },
            matchMedia: () => media,
        });
        vi.stubGlobal('CustomEvent', class {
            constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const scene of scenes.splice(0)) scene.events.emit('destroy');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    function board() {
        const scene = boot();
        scenes.push(scene);
        scene.syncFromGameState(state());
        scene.update(0, 16);
        return scene;
    }

    it('retains paused commands and redraws once for state, camera, resize, and style invalidation', () => {
        const scene = board();
        scene.setPresentationPaused(true);
        const previous = scene.pieceGraphics.clearCount;
        for (let i = 1; i <= 120; i++) scene.update(i * 8, 8);
        expect(scene.pieceGraphics.clearCount).toBe(previous);

        const invalidateOnce = (invalidate) => {
            invalidate();
            scene.update(1000, 16);
            const count = scene.pieceGraphics.clearCount;
            scene.update(1016, 16);
            expect(scene.pieceGraphics.clearCount).toBe(count);
            return count;
        };
        expect(invalidateOnce(() => { scene.gameState.boardVersion++; })).toBe(previous + 1);
        expect(invalidateOnce(() => scene.scale.emit('resize'))).toBe(previous + 2);
        expect(invalidateOnce(() => media.emit('change'))).toBe(previous + 3);
        expect(invalidateOnce(() => browserEvents.emit('settingsChanged', {
            detail: { reducedMotion: false },
        }))).toBe(previous + 4);
        expect(invalidateOnce(() => {
            scene.cameraSettings = { activeTopRow: 7, visibleRows: 15, renderPadding: 0 };
        })).toBe(previous + 5);

        scene.setPresentationPaused(false);
        scene.update(1032, 16);
        expect(scene.pieceGraphics.clearCount).toBe(previous + 6);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('cleans global listeners on stop, recreates them once on restart, and cleans direct destroy', () => {
        const before = eventBus.listenerCount(EVENTS.THEME_CHANGED);
        const scene = board();
        expect(eventBus.listenerCount(EVENTS.THEME_CHANGED)).toBe(before + 1);
        scene.events.emit('shutdown');
        expect(eventBus.listenerCount(EVENTS.THEME_CHANGED)).toBe(before);
        expect(browserEvents.listenerCount('settingsChanged')).toBe(0);
        expect(media.listenerCount('change')).toBe(0);
        expect(scene.styleManager).toBeNull();
        scene.create();
        scene.syncFromGameState(state());
        scene.update(16, 16);
        expect(eventBus.listenerCount(EVENTS.THEME_CHANGED)).toBe(before + 1);
        expect(browserEvents.listenerCount('settingsChanged')).toBe(1);
        expect(scene.events.listenerCount('destroy')).toBe(1);
        scene.events.emit('destroy');
        expect(eventBus.listenerCount(EVENTS.THEME_CHANGED)).toBe(before);
        expect(browserEvents.listenerCount('settingsChanged')).toBe(0);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('reuses piece topology while preserving translated/clipped commands and in-place shape edits', () => {
        const scene = board();
        const shape = [[0, 1, 0], [1, 1, 1]];
        const first = scene._getPieceGeometry(shape, 8, true);
        const snapshot = scene._pieceGeometryCache.get(shape).rows;
        expect(scene._getPieceGeometry(shape, 9, true)).toBe(first);
        expect(scene._pieceGeometryCache.get(shape).rows).toBe(snapshot);
        const draw = graphics();
        scene.strokeLoops(draw, first.loops, 0xffffff, 1, 1, 3 * scene.blockSize, 8.5 * scene.blockSize);
        const reference = graphics();
        scene.strokeLoops(reference, scene.traceLoops(scene._presentCells(shape, 8.5, true), 3, 8.5), 0xffffff, 1, 1);
        expect(draw.commands).toEqual(reference.commands);
        const clipped = scene._getPieceGeometry(shape, scene.hiddenRows - 1, true);
        expect(clipped.present.size).toBe(3);
        shape[1][0] = 0;
        const edited = scene._getPieceGeometry(shape, 8, true);
        expect(edited).not.toBe(first);
        expect(edited.present.size).toBe(3);
    });

    it.each(fillBaseline)('matches original fused Graphics commands for $name', (sample) => {
        const scene = board();
        const draw = graphics();
        scene.blockSize = sample.bs;
        scene.drawFusedPiece(draw, sample.shape, sample.x, sample.y, sample.color, {
            alpha: 0.83, fx: sample.fx, gloss: true, skipHiddenRows: true,
        });
        expect(draw.commands).toHaveLength(sample.commandCount);
        expect(commandDigest(draw)).toBe(sample.digest);
    });

    it('compiles one gradient and reuses rectangle storage across120 moving-piece frames', () => {
        const scene = board();
        const sample = fillBaseline[0];
        const bilerp = vi.spyOn(scene, '_bilerpColor');
        const bounds = vi.spyOn(scene, '_cellBounds');
        const rect = vi.spyOn(scene, '_cellRect');
        const draw = graphics();
        for (let frame = 0; frame < 120; frame++) {
            scene.drawFusedPiece(draw, sample.shape, 3 + (frame % 3) * 0.5, 8 + frame * 0.025, sample.color, {
                alpha: 1, fx: sample.fx, gloss: true, skipHiddenRows: true,
            });
        }
        expect(bilerp).toHaveBeenCalledTimes(16);
        expect(bounds).toHaveBeenCalledOnce();
        // Per frame: four body cells and the gloss's two runs (its top row, its base).
        expect(rect).toHaveBeenCalledTimes(720);
        expect(new Set(rect.mock.results.map(({ value }) => value)).size).toBe(1);
    });

    it('invalidates style/bounds for color, mutable effect values, clipping, resize and in-place shapes', () => {
        const scene = board();
        const drawSample = (sample, shape = sample.shape, fx = sample.fx) => {
            const draw = graphics();
            scene.blockSize = sample.bs;
            scene.drawFusedPiece(draw, shape, sample.x, sample.y, sample.color, {
                alpha: 0.83, fx, gloss: true, skipHiddenRows: true,
            });
            expect(commandDigest(draw)).toBe(sample.digest);
        };
        const shape = fillBaseline[0].shape.map((row) => [...row]);
        drawSample(fillBaseline[0], shape);
        drawSample(fillBaseline[3], shape); // Same shape, different color.
        drawSample(fillBaseline[2], shape); // Hidden-row clipping.
        drawSample(fillBaseline[1], shape); // Fractional block-size/position change.
        for (let y = 0; y < shape.length; y++) {
            for (let x = 0; x < shape[y].length; x++) shape[y][x] = fillBaseline[6].shape[y][x];
        }
        drawSample(fillBaseline[6], shape); // Cascade-style in-place shape edit.

        const changedEffects = { ...fillBaseline[0].fx };
        const sample = fillBaseline[4];
        scene.blockSize = sample.bs;
        scene.drawFusedPiece(graphics(), sample.shape, sample.x, sample.y, sample.color, { fx: changedEffects });
        Object.assign(changedEffects, sample.fx);
        drawSample(sample, sample.shape, changedEffects);
    });

    it('reuses unchanged view bands and updates camera bounds once per position update', () => {
        const scene = board();
        const first = scene.getVisibleRowRange();
        expect(scene.getVisibleRowRange()).toBe(first);
        scene.cameraSettings = {
            activeTopRow: 4, currentTopRow: 4, visibleRows: 15, manualControl: true,
        };
        const next = scene.getVisibleRowRange();
        expect(next).not.toBe(first);
        expect(scene.getVisibleRowRange()).toBe(next);
        const camera = scene.cameras.main;
        camera.setBounds = vi.fn();
        scene.updateCameraPosition(6, true);
        expect(camera.setBounds).toHaveBeenCalledOnce();
        expect(scene.getVisibleRowRange().startRow).toBe(6);
        scene.events.emit('shutdown');
        expect(scene._visibleRowRangeCache).toBeNull();
    });

    it('returns an expanded Infinity round to its starting view after an in-place reset', () => {
        const scene = board();
        const gameState = new GameState({
            isInfinityMode: true,
            initialInfinityRows: 44,
            maxRows: 100,
            infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
        });
        while (gameState.boardGrid.length < 100) expandGridIfNeeded(gameState, 100);
        gameState.piecesPlaced = 12;
        scene.syncFromGameState(gameState);
        scene.updateCameraPosition(50, true);
        scene.enableManualCameraControl();
        const camera = scene.cameras.main;
        camera.setBounds = vi.fn();
        camera.centerOn = vi.fn();

        gameState.reset();
        scene.syncFromGameState(gameState);

        expect(scene.gameState).toBe(gameState);
        expect(gameState.boardGrid).toHaveLength(44);
        expect(scene.cameraSettings).toMatchObject({
            currentTopRow: 24, targetTopRow: 24, activeTopRow: 24, manualControl: false,
        });
        expect(camera.setBounds).toHaveBeenLastCalledWith(0, 0, 400, 1760);
        expect(camera.centerOn).toHaveBeenLastCalledWith(200, 1360);
        expect(gameState.cameraRow).toBe(24);
    });

    it.each([1, 9])('resets a same-size Infinity round after its first spawn (previous count %i)', (previousCount) => {
        const scene = board();
        const gameState = new GameState({ isInfinityMode: true, initialInfinityRows: 44 });
        gameState.piecesPlaced = previousCount;
        scene.syncFromGameState(gameState);
        scene.updateCameraPosition(3, true);
        scene.enableManualCameraControl();

        gameState.reset();
        gameState.piecesPlaced = 1;
        scene.syncFromGameState(gameState);

        expect(scene.cameraSettings).toMatchObject({
            currentTopRow: 24, targetTopRow: 24, activeTopRow: 24, manualControl: false,
        });
    });

    it('preserves Infinity camera interpolation across expansion and same-size board replacement', () => {
        const scene = board();
        const gameState = new GameState({ isInfinityMode: true, initialInfinityRows: 44 });
        gameState.piecesPlaced = 9;
        scene.syncFromGameState(gameState);
        scene.updateCameraPosition(7, true);
        scene.updateCameraPosition(20);
        const settings = scene.cameraSettings;
        const scrollPosition = settings.currentTopRow;
        const configure = vi.spyOn(scene, 'configureCamera');

        expandGridIfNeeded(gameState, 54);
        scene.syncFromGameState(gameState);
        gameState.boardGrid = gameState.boardGrid.map((row) => row.slice());
        gameState.board = gameState.boardGrid;
        scene.syncFromGameState(gameState);

        expect(configure).not.toHaveBeenCalled();
        expect(scene.cameraSettings).toBe(settings);
        expect(settings.currentTopRow).toBe(scrollPosition);
        expect(settings.targetTopRow).toBe(20);
    });

    it('preserves live online and manual Infinity exploration while freezing owned pausable boards', () => {
        const scene = { setPresentationPaused: vi.fn() };
        class Mode extends BaseGameMode { getModeId() { return 'test'; } }
        const mode = new Mode({});
        mode.isRunning = true;
        mode.boardScenes = [scene];
        mode.onPause(); // Online/Serenity do not expose a pausable simulation.
        expect(scene.setPresentationPaused).not.toHaveBeenCalled();
        mode._getPausableGameState = () => ({});
        mode.isInExplorationMode = true;
        mode.onPause();
        expect(scene.setPresentationPaused).not.toHaveBeenCalled();
        mode.isInExplorationMode = false;
        mode.onPause();
        expect(scene.setPresentationPaused).toHaveBeenLastCalledWith(true);
        mode.onResume();
        expect(scene.setPresentationPaused).toHaveBeenLastCalledWith(false);
    });
});

describe('Phaser frame-rate policy', () => {
    let now;
    beforeEach(() => {
        now = 0;
        vi.stubGlobal('window', {
            performance: { now: () => now },
            requestAnimationFrame: vi.fn(() => 1),
            cancelAnimationFrame: vi.fn(),
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('uses the actual limiter for cap changes and returns to uncapped rendering', () => {
        const callback = vi.fn();
        const game = { config: { fps: phaserFrameRateConfig(60) } };
        game.loop = new TimeStep(game, game.config.fps);
        game.loop.start(callback);
        game.loop.time = 125;
        game.loop.frame = 8;
        const old = game.loop;
        expect(applyPhaserFrameRate(game, 30)).toBe(true);
        expect(old.running).toBe(false);
        expect(old.raf).toBeNull();
        expect(game.loop.callback).not.toBe(callback);
        expect(game.loop.time).toBe(125);
        expect(game.loop.frame).toBe(8);
        game.loop.smoothStep = false;
        for (let i = 1; i <= 120; i++) game.loop.stepLimitFPS(i * (1000 / 120));
        expect(callback).toHaveBeenCalledTimes(30);
        expect(applyPhaserFrameRate(game, 30)).toBe(false);
        callback.mockClear();
        applyPhaserFrameRate(game, 0);
        expect(game.config.fps.limit).toBe(0);
        expect(game.loop.hasFpsLimit).toBe(false);
        game.loop.smoothStep = false;
        for (let i = 1; i <= 120; i++) game.loop.step(i * 1000 / 120);
        expect(callback).toHaveBeenCalledTimes(120);
        game.loop.destroy();
    });

    function initialGame(limit, preBootLimit = null) {
        const config = phaserBoardRuntimeConfig({ settingsManager: { get: () => ({ targetFrameRate: limit }) } }, 0);
        const clock = new Clock({ sys: { events: new EventEmitter() } });
        const timer = clock.addEvent({ delay: 20000, callback: vi.fn() });
        const target = { value: 0 };
        const tween = TweenBuilder({ timeScale: 1 }, { targets: target, value: 1, duration: 20000 });
        tween.reset().play();
        const callback = vi.fn((time, delta) => {
            clock.preUpdate();
            clock.update(time, delta);
            tween.update(delta);
        });
        const game = { config, step: callback, headlessStep: callback, events: new EventEmitter() };
        game.loop = new TimeStep(game, config.fps);
        if (preBootLimit !== null) applyPhaserFrameRate(game, preBootLimit);
        config.callbacks.postBoot(game); // The installed Game calls this before binding its step.
        game.loop.start(game.step.bind(game));
        return { game, callback, timer, target };
    }

    function tick(game, timestamp) {
        now = timestamp;
        if (game.loop.hasFpsLimit) game.loop.stepLimitFPS(timestamp);
        else game.loop.step(timestamp);
    }

    it.each([60, 120, 144].flatMap((hz) => [30, 60, 144, 0].map((limit) => [hz, limit])))(
        'keeps initial cap %i Hz host/%i limit scene timers and tween progress on elapsed time', (hz, limit) => {
            const { game, callback, timer, target } = initialGame(limit);
            for (let i = 1; i <= hz * 10; i++) tick(game, i * 1000 / hz + (i % 5) * 0.01);
            const cadence = 1000 / Math.min(hz, limit || hz);
            const elapsed = callback.mock.calls.reduce((sum, [, delta]) => sum + delta, 0);
            const lastTime = callback.mock.calls.at(-1)[0];
            expect(elapsed).toBeCloseTo(lastTime, 6);
            expect(Math.abs(elapsed - 10000)).toBeLessThan(cadence + 0.1);
            expect(Math.abs(callback.mock.calls.length - Math.min(hz, limit || hz) * 10)).toBeLessThanOrEqual(1);
            expect(timer.elapsed).toBeCloseTo(elapsed, 6);
            // Phaser starts a tween at zero progress on its first update.
            expect(Math.abs(target.value * 20000 - elapsed)).toBeLessThan(cadence * 2 + 0.1);
            game.loop.destroy();
        },
    );

    it('installs the initial clock after a pre-boot cap change and preserves it across live transitions', () => {
        const { game, callback, timer } = initialGame(60, 30);
        const installedStep = game.step;
        game.config.callbacks.postBoot(game);
        expect(game.step).toBe(installedStep);
        for (let i = 1; i <= 1200; i++) {
            tick(game, i * 1000 / 120 + (i % 5) * 0.01);
            if (i === 300) applyPhaserFrameRate(game, 60);
            if (i === 600) applyPhaserFrameRate(game, 144);
            if (i === 900) applyPhaserFrameRate(game, 0);
        }
        const elapsed = callback.mock.calls.reduce((sum, [, delta]) => sum + delta, 0);
        expect(elapsed).toBeCloseTo(10000, 6);
        expect(timer.elapsed).toBeCloseTo(10000, 6);
        game.loop.destroy();
    });

    it('avoids fast-forwarding presentation after sleep, visibility reset, and a sleeping cap change', () => {
        const { game, callback } = initialGame(60);
        tick(game, 1000 / 60);
        game.loop.sleep();
        now = 10000;
        applyPhaserFrameRate(game, 30);
        expect(game.loop.running).toBe(false);
        game.loop.wake();
        expect(callback.mock.calls.at(-1)[1]).toBeLessThanOrEqual(1000 / 30);
        now = 20000;
        game.loop.resume();
        game.events.emit('resume');
        tick(game, 20000 + 1000 / 30 + 0.01);
        expect(callback.mock.calls.at(-1)[1]).toBeCloseTo(1000 / 30 + 0.01, 6);
        game.loop.destroy();
    });

    it('keeps a sleeping game asleep and an unstarted game unstarted across cap changes', () => {
        const game = { config: { fps: phaserFrameRateConfig(60) } };
        game.loop = new TimeStep(game, game.config.fps);
        applyPhaserFrameRate(game, 120);
        expect(game.loop.started).toBe(false);
        game.loop.start(vi.fn());
        game.loop.sleep();
        applyPhaserFrameRate(game, 0);
        expect(game.loop.started).toBe(true);
        expect(game.loop.running).toBe(false);
        expect(game.loop.fpsLimit).toBe(0);
        game.loop.destroy();
    });
});
