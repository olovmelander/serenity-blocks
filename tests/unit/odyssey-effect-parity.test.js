import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { spawnPiece } from '../../src/core/game.js';
import { markBoardDirty, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { OdysseyBotMatch } from '../../src/core/odyssey/OdysseyBotMatch.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { createOdysseyPhysicsCallbacks } from '../../src/core/game-modes/odyssey-physics-callbacks.js';
import { applyOdysseyFixedCommand } from '../../src/core/game-modes/odyssey-fixed-tick.js';
import { installOdysseyLegacyInputWrapper } from '../../src/ui/odyssey/legacy-input-wrapper.js';
import { DEMO_FIXED_SIMULATION_CLOCK, DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { FIXED_HARD_DROP_HIT_STOP_MS } from '../../src/core/fixed-hit-stop-policy.js';

const unsubscribe = [];

function observe(event) {
    const calls = vi.fn();
    unsubscribe.push(eventBus.on(event, calls));
    return calls;
}

function createHarness(id = 1, fixed = false) {
    const engine = new GameplayHybridEngine();
    engine.configure(getLevelById(id));
    const state = engine.createGameState();
    state.nextPieces = ['T', 'O'];
    state.isSeeking = true;
    spawnPiece(state);
    const juice = {
        bounce: vi.fn(), dip: vi.fn(), nudge: vi.fn(), pulse: vi.fn(), tilt: vi.fn(),
    };
    const sound = {
        playB2B: vi.fn(),
        playDrop: vi.fn(),
        playLevelUp: vi.fn(),
        playLineClear: vi.fn(),
        playMove: vi.fn(),
        playPerfectClear: vi.fn(),
        playRotate: vi.fn(),
        playTSpin: vi.fn(),
    };
    const scene = {
        cameraSettings: { visibleRows: 20, currentTopRow: 66, activeTopRow: 70.25 },
        createPieceLockRipple: vi.fn(),
        playHardDropEffect: vi.fn(),
        playLineClearImpact: vi.fn(),
        showComboPopup: vi.fn(),
        triggerLineClearFlash: vi.fn(),
        sharedEffects: {
            getClearTier: vi.fn(() => ({ hitStop: 70 })),
            playB2BChange: vi.fn(),
            playGameOver: vi.fn(() => 760),
            playGarbageArrival: vi.fn(),
            playLevelUp: vi.fn(),
            playKnockout: vi.fn(),
            playPerfectClear: vi.fn(),
            playRoundWin: vi.fn(),
            playTSpinEffect: vi.fn(),
            playVictory: vi.fn(),
            showCascadeWave: vi.fn(),
        },
    };
    const session = {
        gameState: state,
        hybridEngine: engine,
        levelId: id,
        levelConfig: engine.levelConfig,
        simulationClock: fixed ? DEMO_FIXED_SIMULATION_CLOCK : DEMO_LEGACY_SIMULATION_CLOCK,
    };
    const mode = {
        boardJuice: juice,
        deps: { settingsManager: { get: vi.fn(() => ({})) }, soundManager: { sfxPlayer: sound } },
        _getBoardScene: () => scene,
        _handleGameOver: vi.fn(),
        _isLevelSessionActive: (candidate) => candidate === session && !session.retired,
        _refreshNextQueue: vi.fn(),
    };
    const callbacks = createOdysseyPhysicsCallbacks(mode, session);
    const context = {
        gameState: state,
        isEnabled: () => !session.retired,
        juice,
        physicsCallbacks: callbacks,
        playDropCallback: sound.playDrop,
        soundPlayer: sound,
    };
    const owner = fixed ? null : installOdysseyLegacyInputWrapper({
        ...context, isActive: context.isEnabled,
    });

    const dispatch = (action, value) => (fixed
        ? applyOdysseyFixedCommand({ action, value }, context)
        : window[action](value));
    return {
        callbacks, dispatch, engine, juice, mode, owner, scene, session, sound, state,
    };
}

describe('Odyssey Phaser effect parity', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            matchMedia: vi.fn(() => ({ matches: false })),
            hardDrop() {},
            move() {},
            rotate() {},
            softDrop() {},
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        unsubscribe.splice(0).forEach((dispose) => dispose());
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('uses local-versus knockout, round-win and victory beats for duel transitions', () => {
        const { callbacks, scene, session } = createHarness();
        session.duel = {};
        callbacks.onTopOut();
        callbacks.onRoundWin({ color: '#abcdef' });
        callbacks.onVictory({ color: '#abcdef' });
        expect(scene.sharedEffects.playKnockout).toHaveBeenCalledOnce();
        expect(scene.sharedEffects.playGameOver).not.toHaveBeenCalled();
        expect(scene.sharedEffects.playRoundWin).toHaveBeenCalledWith({ color: '#abcdef' });
        expect(scene.sharedEffects.playVictory).toHaveBeenCalledWith({ color: '#abcdef' });
        session.retired = true;
        callbacks.onTopOut();
        callbacks.onRoundWin();
        callbacks.onVictory();
        expect(scene.sharedEffects.playKnockout).toHaveBeenCalledOnce();
        expect(scene.sharedEffects.playRoundWin).toHaveBeenCalledOnce();
        expect(scene.sharedEffects.playVictory).toHaveBeenCalledOnce();
    });

    it('rejects old round effects and theme events after the real duel death barrier', async () => {
        const {
            engine, mode, scene, session,
        } = createHarness(4);
        session.duel = new OdysseyBotMatch(session, { seed: 1234, isActive: () => !session.retired });
        const callbacks = createOdysseyPhysicsCallbacks(mode, session);
        const lock = observe(EVENTS.PIECE_LOCK);
        session.duel.markTopOut(1);
        session.duel.update(100, 16, callbacks);
        await session.duel.transition;
        const metrics = { ...engine.getMetrics() };
        callbacks.onPieceLock({});
        callbacks.onGarbageApplied(6);
        callbacks.onTopOut();
        callbacks.onRoundWin();
        callbacks.onVictory();
        expect(lock).not.toHaveBeenCalled();
        expect(scene.sharedEffects.playGarbageArrival).not.toHaveBeenCalled();
        expect(scene.sharedEffects.playKnockout).not.toHaveBeenCalled();
        expect(scene.sharedEffects.playRoundWin).not.toHaveBeenCalled();
        expect(scene.sharedEffects.playVictory).not.toHaveBeenCalled();
        expect(engine.getMetrics()).toEqual(metrics);
        session.duel.stop();
    });

    it('places tall lock, clear and hard-drop theme events in the actual lerped viewport', () => {
        const { callbacks, state } = createHarness(55);
        const lock = observe(EVENTS.PIECE_LOCK);
        const clear = observe(EVENTS.LINE_CLEAR);
        const drop = observe(EVENTS.HARD_DROP);
        state.cameraRow = 54; // Simulation anchor differs from the displayed camera.
        const piece = { x: 4, y: 75, shape: [[1, 1], [1, 1]] };
        callbacks.onPieceLock(piece);
        callbacks.onLineClear(2, [], 2, [75, 77], 3);
        callbacks.onHardDrop({ piece, startY: 52, endY: 75 });
        const expected = { x: 0.5, y: (76 - 70.25) / 20 };
        expect(lock).toHaveBeenCalledWith(expect.objectContaining({
            source: 'odyssey', levelId: 55, viewportOrigin: expected,
        }));
        expect(clear).toHaveBeenCalledWith(expect.objectContaining({
            source: 'odyssey',
            levelId: 55,
            cascadeCount: 3,
            viewportOrigin: { x: 0.5, y: (76.5 - 70.25) / 20 },
        }));
        expect(drop).toHaveBeenCalledWith(expect.objectContaining({
            source: 'odyssey', levelId: 55, distance: 23, viewportOrigin: expected,
        }));
    });

    it('keeps contextual events, incoming garbage and death presentation owned by the exact attempt', () => {
        const {
            callbacks, engine, scene, session,
        } = createHarness();
        const lock = observe(EVENTS.PIECE_LOCK);
        const tSpin = observe(EVENTS.TSPIN);
        const b2b = observe(EVENTS.B2B);
        const perfect = observe(EVENTS.PERFECT_CLEAR);
        callbacks.onTSpin(2);
        callbacks.onB2B();
        callbacks.onPerfectClear(3, 4000);
        expect(tSpin).toHaveBeenCalledWith({ lineCount: 2, source: 'odyssey', levelId: 1 });
        expect(b2b).toHaveBeenCalledWith({ active: true, source: 'odyssey', levelId: 1 });
        expect(perfect).toHaveBeenCalledWith({
            depth: 3, perfectClearBonus: 4000, source: 'odyssey', levelId: 1,
        });
        callbacks.onGarbageApplied(4);
        expect(scene.sharedEffects.playGarbageArrival).toHaveBeenCalledWith(4);
        expect(callbacks.onTopOut()).toBe(760);
        const metrics = { ...engine.getMetrics() };
        session.retired = true;
        callbacks.onPieceLock({});
        callbacks.onLineClear(4);
        callbacks.onTSpin(4);
        callbacks.onB2B();
        callbacks.onPerfectClear(10, 20000);
        callbacks.onGarbageApplied(8);
        expect(callbacks.onTopOut()).toBeUndefined();
        expect(lock).not.toHaveBeenCalled();
        expect(tSpin).toHaveBeenCalledOnce();
        expect(b2b).toHaveBeenCalledOnce();
        expect(perfect).toHaveBeenCalledOnce();
        expect(scene.sharedEffects.playGarbageArrival).toHaveBeenCalledOnce();
        expect(scene.sharedEffects.playGameOver).toHaveBeenCalledOnce();
        expect(engine.getMetrics()).toEqual(metrics);
    });

    it.each([false, true])('applies one hard-drop motion through actual core physics with fixed=%s', async (fixed) => {
        const {
            dispatch, juice, mode, state,
        } = createHarness(1, fixed);
        const drop = observe(EVENTS.HARD_DROP);
        if (fixed) {
            mode.deps.settingsManager.get.mockImplementation(() => { throw new Error('live timing settings read'); });
        }
        dispatch('hardDrop');
        await state.latestPhysicsPromise;
        expect(drop).toHaveBeenCalledOnce();
        expect(juice.dip.mock.calls.filter(([amount]) => amount === 4)).toHaveLength(1);
        expect(juice.bounce).toHaveBeenCalledOnce();
        expect(state.piecesPlaced).toBe(2);
        if (fixed) {
            expect(state.hitStopRemaining).toBe(FIXED_HARD_DROP_HIT_STOP_MS);
            expect(window.matchMedia).not.toHaveBeenCalled();
        }
    });

    it.each([false, true])('moves the board only for accepted core movement/rotation with fixed=%s', (fixed) => {
        const { dispatch, juice, state } = createHarness(1, fixed);
        dispatch('move', 1);
        dispatch('rotate', 'left');
        expect(juice.nudge.mock.calls).toEqual([[0.5, 0], [0, -0.5]]);
        expect(juice.tilt).toHaveBeenCalledWith(-1.5);
        const firstFilledColumn = Math.min(...state.currentPiece.shape.flatMap((row) => (
            row.flatMap((cell, column) => (cell ? [column] : []))
        )));
        state.currentPiece.x = -firstFilledColumn;
        dispatch('move', -1);
        expect(juice.nudge).toHaveBeenCalledTimes(2);

        // Fill every nearby cell except the current footprint: all rotations,
        // including the wall kicks, are physically blocked.
        const { currentPiece } = state;
        const obstruction = Array.from({ length: 10 }, (_row, row) => Array.from({ length: 10 }, (_cell, col) => (
            currentPiece.shape[row - currentPiece.y]?.[col - currentPiece.x] ? 0 : 1
        )));
        state.lockedPieces = [{
            x: 0, y: 0, shape: obstruction, pieceId: 999,
        }];
        rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
        markBoardDirty(state);
        dispatch('rotate', 'right');
        expect(juice.tilt).toHaveBeenCalledOnce();
        expect(juice.nudge).toHaveBeenCalledTimes(2);
    });
});
