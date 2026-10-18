/* eslint-disable import/first */
/**
 * Odyssey's tall wells look around the tower as Infinity does (ui/odyssey/odyssey-tower-look.js
 * driving the ascent director): which wells get it, the pause the look asks of the orb (the clock
 * stops, the HUD does not say "Paused"), the way home after a game key, a menu or an outside
 * resume over a look, the tower map, and a retired attempt.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { looseNode, looseWindow } from './helpers/loose-dom.js';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: vi.fn(() => ({ destroy() {} })),
}));

vi.mock('../../src/ui/infinity/InfinityMinimap.js', () => ({
    InfinityMinimap: class InfinityMinimap {
        constructor() {
            this.container = new EventTarget();
            this.container.style = {};
        }

        show() {}

        hide() {}

        destroy() {}

        onPause() {}

        onUnpause() {}

        update() {}

        setMarks() {}
    },
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { readExplorationSignal, setExplorationSignal } from '../../src/core/exploration-signal.js';
import {
    endOdysseyLook, startOdysseyTowerLook, usesOdysseyTowerLook,
} from '../../src/ui/odyssey/odyssey-tower-look.js';

const wheel = (deltaY) => ({
    deltaY, deltaX: 0, deltaMode: 0, preventDefault: vi.fn(),
});

/** A running orb on a 24-row Infinity well (28 rows with the hidden four, twenty on screen). */
function prepare({ rows = 24, duel = null, isInfinityMode = true } = {}) {
    const frameRateController = {
        pauseHybridLoop: vi.fn(), resumeHybridLoop: vi.fn(), stopHybridLoop: vi.fn(),
    };
    const mode = new OdysseyMode({ frameRateController });
    const length = rows + 4;
    const board = Array.from({ length }, (_, row) => Array.from({ length: 10 }, () => (row >= length - 3 ? 1 : null)));
    mode.isRunning = true;
    mode.isInBoardView = false;
    mode.usingHybridLoop = true;
    mode.entryPhase = 'running';
    mode.currentLevelConfig = { mechanics: { baseMode: 'infinity', board: { rows, columns: 10 } } };
    mode.gameState = {
        board, isInfinityMode, isPaused: false, isGameOver: false, maxRows: rows,
    };
    mode._activeLevelSession = {
        gameState: mode.gameState, hybridEngine: mode.hybridEngine, retired: false, duel,
    };
    mode.odysseyHUD = { setPaused: vi.fn() };
    const settings = {
        currentTopRow: length - 20, visibleRows: 20, viewOffsetRows: 0, manualControl: false,
    };
    mode.boardScene = {
        cameraSettings: settings,
        enableManualCameraControl: vi.fn(() => { settings.manualControl = true; }),
        disableManualCameraControl: vi.fn(() => { settings.manualControl = false; }),
        setPresentationPaused: vi.fn(),
        setViewOffsetRows: vi.fn((offset) => { settings.viewOffsetRows = offset; }),
        updateCameraPosition: vi.fn((topRow) => {
            settings.currentTopRow = Math.max(0, Math.min(length - 20, topRow));
        }),
    };
    mode._getBoardScene = () => mode.boardScene;
    mode._initializeMinimap();
    return { mode, frameRateController, settings };
}

/** Drive the director's frames by hand. */
function frames(director, seconds, start) {
    let now = start;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
        now += 1000 / 60;
        director.step(1 / 60, now);
    }
    return now;
}

/** Wheel up twice (the second gives way) and let the mode's pause settle. */
async function lookUp(mode, clock) {
    const director = mode._towerLook;
    director.handleWheel(wheel(-100));
    let now = frames(director, 0.1, clock);
    director.handleWheel(wheel(-100));
    now = frames(director, 0.05, now);
    await Promise.resolve();
    await Promise.resolve();
    return now;
}

describe('Odyssey tall wells: looking around the tower', () => {
    let documentNode;
    let themeLayer;
    let clock;
    let rafQueue;

    beforeEach(() => {
        clock = 0;
        rafQueue = [];
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
        documentNode = looseNode('document');
        themeLayer = looseNode('div');
        documentNode.querySelector = (selector) => (selector === '.background-container' ? themeLayer : null);
        documentNode.createElement = (tag) => looseNode(tag);
        vi.stubGlobal('document', documentNode);
        const keyBindings = { moveLeft: 'ArrowLeft', hardDrop: 'Space' };
        vi.stubGlobal('window', looseWindow({ settings: { keyBindings } }));
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            rafQueue.push(callback);
            return rafQueue.length;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        // The frames are driven by hand (rafQueue), so the fake clock leaves rAF alone.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        setExplorationSignal(null);
    });

    it('gives the ascent to every tall Infinity well, never to a duel or a well that fits', () => {
        const tall = prepare();
        expect(usesOdysseyTowerLook(tall.mode)).toBe(true);
        expect(startOdysseyTowerLook(tall.mode, tall.mode._activeLevelSession)).toBe(true);
        expect(documentNode.listenerCount('wheel')).toBe(1);
        tall.mode._retireLevelSession();
        expect(documentNode.listenerCount('wheel')).toBe(0);

        expect(usesOdysseyTowerLook(prepare({ duel: {} }).mode)).toBe(false);
        expect(usesOdysseyTowerLook(prepare({ isInfinityMode: false }).mode)).toBe(false);
        expect(usesOdysseyTowerLook(prepare({ rows: 16 }).mode)).toBe(false);
    });

    it('holds the orb for a look (the clock stops, the HUD says nothing) and plays on at home', async () => {
        const { mode, frameRateController, settings } = prepare();
        startOdysseyTowerLook(mode, mode._activeLevelSession);
        const home = settings.currentTopRow;
        clock = await lookUp(mode, clock);

        expect(mode.isInExplorationMode).toBe(true);
        expect(mode.isPaused).toBe(true);
        expect(mode.gameState.isPaused).toBe(true);
        expect(frameRateController.pauseHybridLoop).toHaveBeenCalledOnce();
        expect(mode.boardScene.enableManualCameraControl).toHaveBeenCalledOnce();
        expect(mode.odysseyHUD.setPaused).not.toHaveBeenCalledWith(true);
        expect(mode._towerLook.flight.phase).toBe('free');

        // To the top of the well: a short well holds the whole journey (8 rows here, 24 in
        // Infinity), so the themes hear a full rise.
        mode._towerLook.handleWheel(wheel(-600));
        clock = frames(mode._towerLook, 1, clock);
        expect(settings.currentTopRow).toBeLessThan(1);
        const signal = readExplorationSignal();
        expect(signal.rise).toBeGreaterThan(0.7);
        expect(signal.timeScale).toBeLessThan(0.7);
        expect(mode._towerLook.getDiagnostics().themeShiftPx).toBeGreaterThan(0);

        // A game key: home at once, and play.
        mode._towerLook.handleGameInput();
        expect(mode.isInExplorationMode).toBe(false);
        expect(mode.isPaused).toBe(false);
        expect(mode.gameState.isPaused).toBe(false);
        expect(frameRateController.resumeHybridLoop).toHaveBeenCalledOnce();
        expect(mode.boardScene.disableManualCameraControl).toHaveBeenCalledOnce();
        // The camera settles home over a few frames (Odyssey's follow moves only on thresholds).
        for (let i = 1; i <= 60 && rafQueue.length; i++) {
            const at = clock + (i * 1000) / 60;
            rafQueue.splice(0).forEach((callback) => callback(at));
        }
        expect(settings.currentTopRow).toBeCloseTo(home, 2);
    });

    it('keeps the orb paused under a menu opened over a look (Escape)', async () => {
        const { mode, frameRateController } = prepare();
        startOdysseyTowerLook(mode, mode._activeLevelSession);
        clock = await lookUp(mode, clock);
        expect(mode.isInExplorationMode).toBe(true);

        expect(mode.endExplorationForMenu()).toBe(true);
        expect(mode.isInExplorationMode).toBe(false);
        expect(mode.isPaused).toBe(true);
        expect(mode.odysseyHUD.setPaused).toHaveBeenLastCalledWith(true);
        expect(frameRateController.resumeHybridLoop).not.toHaveBeenCalled();
        // ...and the board holds still under the menu (audit 2026-10-18: it kept animating).
        expect(mode.boardScene.setPresentationPaused).toHaveBeenLastCalledWith(true);

        // The menu's own resume ends the pause.
        mode.onResume();
        expect(mode.isPaused).toBe(false);
        expect(frameRateController.resumeHybridLoop).toHaveBeenCalledOnce();
    });

    it('lets a resume from elsewhere end the look without resuming twice', async () => {
        const { mode, frameRateController } = prepare();
        startOdysseyTowerLook(mode, mode._activeLevelSession);
        clock = await lookUp(mode, clock);

        mode.onResume();
        expect(mode.isInExplorationMode).toBe(false);
        expect(mode.isPaused).toBe(false);
        expect(frameRateController.resumeHybridLoop).toHaveBeenCalledOnce();
    });

    it('keeps a pause from elsewhere when the look over it ends', async () => {
        const { mode, frameRateController } = prepare();
        startOdysseyTowerLook(mode, mode._activeLevelSession);
        clock = await lookUp(mode, clock);

        mode.onPause();
        expect(mode.odysseyHUD.setPaused).toHaveBeenLastCalledWith(true);
        expect(endOdysseyLook(mode)).toBe(true);
        expect(mode.isPaused).toBe(true);
        expect(mode.gameState.isPaused).toBe(true);
        expect(frameRateController.resumeHybridLoop).not.toHaveBeenCalled();
    });

    it('looks from the tower map and lets nothing outlive a retired attempt', async () => {
        const { mode } = prepare();
        startOdysseyTowerLook(mode, mode._activeLevelSession);
        mode.minimap.container.dispatchEvent(new Event('minimap-exploration-start'));
        clock = frames(mode._towerLook, 0.05, clock);
        await Promise.resolve();
        await Promise.resolve();
        expect(mode.isInExplorationMode).toBe(true);
        expect(mode.isPaused).toBe(true);

        mode._retireLevelSession();
        expect(mode.isInExplorationMode).toBe(false);
        expect(documentNode.listenerCount('wheel')).toBe(0);
        expect(readExplorationSignal()).toBeNull();

        // A wheel after the attempt is gone pulls nothing.
        const late = wheel(-100);
        mode._towerLook.handleWheel(late);
        expect(late.preventDefault).not.toHaveBeenCalled();
    });

    it('does not look before the orb plays (the start cue) or after its goal', () => {
        const { mode } = prepare();
        startOdysseyTowerLook(mode, mode._activeLevelSession);
        mode.entryPhase = 'countdown';
        const early = wheel(-100);
        mode._towerLook.handleWheel(early);
        expect(early.preventDefault).not.toHaveBeenCalled();
        mode.entryPhase = 'running';
        mode.levelCompleting = true;
        const late = wheel(-100);
        mode._towerLook.handleWheel(late);
        expect(late.preventDefault).not.toHaveBeenCalled();
    });
});
