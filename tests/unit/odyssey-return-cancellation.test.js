/* eslint-disable import/first */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// BoardJuice's renderer alias is outside the Vitest resolver; this path never constructs it.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';

function deferred() {
    let resolve;
    const promise = new Promise((settle) => { resolve = settle; });
    return { promise, resolve };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function createMode() {
    const mode = Object.create(OdysseyMode.prototype);
    Object.assign(mode, {
        deps: {},
        isActive: true,
        isRunning: false,
        currentLevelId: 5,
        currentLevelConfig: { id: 5, chapter: 1 },
        selectedLevelId: null,
        _levelSessionGeneration: 0,
        themeRevealToken: 0,
        _activationSimulationClock: 'fixed60-v1',
        _activeLevelSession: null,
        onStop: vi.fn().mockResolvedValue(),
        _applyBoardAudioPolicy: vi.fn().mockResolvedValue(),
        _showBoardView: vi.fn().mockResolvedValue(true),
        _buildJourneyEntryPalette: vi.fn(() => ({})),
        _buildJourneyReturnTimings: vi.fn(() => ({})),
        _resolveJourneyReturnDepartureAnchor: vi.fn(() => ({})),
        _resolveJourneyReturnArrivalAnchor: vi.fn(() => ({})),
    });
    [
        '_perfMark', '_perfMeasure', '_stopFixedTickSession', '_restoreInputs',
        '_cancelBoardParkTimer', '_hideOdysseyUI', '_disposeOdysseyBoard',
        '_clearDeferredWarpPreinit', '_restoreTransitionMusicDuck',
        '_clearLevelThemePrefetchTimer', '_clearNeutralThemeFallbackBackdrop',
        '_clearGameplayRevealState', '_clearLevelStartCue', '_clearBoardReturnFallbackVeil',
        '_cleanupEventListeners', '_stopPhaserBoardScene', '_hideGameplaySurfaceForBoardReturn',
        '_unlockOdysseyBoardAfterLaunchAttempt', 'setOdysseyNavigatorButtonVisible',
        '_mountBoardReturnFallbackVeil', '_lockOdysseyBoardForLaunch', '_setBoardOverlaySuppressed',
    ].forEach((method) => { mode[method] = vi.fn(); });
    const returned = deferred();
    const transition = {
        callbacks: null,
        play: vi.fn(({ callbacks }) => {
            transition.callbacks = callbacks;
            return returned.promise;
        }),
        abort: vi.fn((reason) => {
            Promise.resolve(transition.callbacks?.onAbort({ reason }))
                .then(() => returned.resolve({ success: false, aborted: true, reason }));
        }),
        dispose: vi.fn(),
    };
    mode.journeyReturnTransition = transition;
    return { mode, transition, returned };
}

describe('Odyssey board return cancellation', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { settings: {} });
        vi.stubGlobal('document', { getElementById: () => null });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('invalidates the return before deactivation aborts its portal', async () => {
        const { mode, transition } = createMode();
        const fallback = vi.spyOn(mode, '_fallbackToBoardAfterReturnAbort');
        const returning = mode.returnToBoard();
        await mode.onDeactivate();
        await expect(returning).resolves.toBe(false);
        expect(transition.abort).toHaveBeenCalledWith('mode-deactivate');
        expect(fallback).not.toHaveBeenCalled();
        expect(mode._showBoardView).not.toHaveBeenCalled();
        // Even a queued reveal/complete callback cannot restore the old UI or inputs.
        mode._restoreInputs.mockClear();
        await expect(transition.callbacks.onRevealStart()).resolves.toBe(false);
        await transition.callbacks.onComplete();
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).not.toHaveBeenCalled();
        expect(mode.setOdysseyNavigatorButtonVisible).not.toHaveBeenCalled();
        expect(mode._restoreInputs).not.toHaveBeenCalled();
    });

    it('does not resume blackout preparation after deactivation during its stop', async () => {
        const { mode, transition } = createMode();
        const stop = deferred();
        mode.onStop.mockReturnValueOnce(stop.promise);
        const returning = mode.returnToBoard();
        const preparing = transition.callbacks.onBlackoutReached();
        await mode.onDeactivate();
        const replacementConfig = { id: 12 };
        mode.currentLevelConfig = replacementConfig;
        stop.resolve();
        await expect(preparing).resolves.toBe(false);
        await expect(returning).resolves.toBe(false);
        expect(mode.currentLevelConfig).toBe(replacementConfig);
        expect(mode._showBoardView).not.toHaveBeenCalled();
    });

    it('does not rebuild the map when an old audio restore finishes after deactivation', async () => {
        const { mode, transition } = createMode();
        const audio = deferred();
        mode._applyBoardAudioPolicy.mockReturnValueOnce(audio.promise);
        const returning = mode.returnToBoard();
        const preparing = transition.callbacks.onBlackoutReached();
        await flushMicrotasks();
        expect(mode._applyBoardAudioPolicy).toHaveBeenCalledTimes(1);
        await mode.onDeactivate();
        audio.resolve();
        await expect(preparing).resolves.toBe(false);
        await expect(returning).resolves.toBe(false);
        expect(mode._showBoardView).not.toHaveBeenCalled();
    });

    it('does not resurrect a fallback that was already waiting on stop when deactivated', async () => {
        const { mode, transition } = createMode();
        const stop = deferred();
        mode.onStop.mockReturnValueOnce(stop.promise);
        const returning = mode.returnToBoard();
        const fallback = transition.callbacks.onAbort({ reason: 'blackout-timeout' });
        expect(mode._mountBoardReturnFallbackVeil).toHaveBeenCalledTimes(1);
        await mode.onDeactivate();
        mode._clearBoardReturnFallbackVeil.mockClear();
        stop.resolve();
        await fallback;
        await expect(returning).resolves.toBe(false);
        expect(mode._showBoardView).not.toHaveBeenCalled();
        expect(mode._clearBoardReturnFallbackVeil).not.toHaveBeenCalled();
    });

    it('does not reveal a controller whose cold build finishes after mode exit', async () => {
        const { mode } = createMode();
        const build = deferred();
        delete mode._showBoardView;
        mode._buildOdysseyBoard = vi.fn(() => build.promise);
        mode._revealOdysseyBoard = vi.fn();
        mode._restoreBoardOverlayAfterLaunchAttempt = vi.fn();
        mode._scheduleDeferredWarpPreinit = vi.fn();
        const showing = mode._showBoardView({ showLoadingOverlay: false });
        await mode.onDeactivate();
        build.resolve();
        await expect(showing).resolves.toBe(false);
        expect(mode._revealOdysseyBoard).not.toHaveBeenCalled();
        expect(mode._restoreBoardOverlayAfterLaunchAttempt).not.toHaveBeenCalled();
        expect(mode.setOdysseyNavigatorButtonVisible).not.toHaveBeenCalled();
        expect(mode._scheduleDeferredWarpPreinit).not.toHaveBeenCalled();
    });

    it('does not unlock or start deferred map work when focus settles after deactivation', async () => {
        const { mode } = createMode();
        const focus = deferred();
        delete mode._showBoardView;
        mode._initializeOdysseyBoard = vi.fn().mockResolvedValue(true);
        mode._buildOdysseyProgressData = vi.fn(() => ({}));
        mode.closeOdysseyNavigator = vi.fn();
        mode._restoreBoardOverlayAfterLaunchAttempt = vi.fn();
        mode._focusBoardLevelForLaunch = vi.fn(() => focus.promise);
        mode._scheduleDeferredWarpPreinit = vi.fn();
        const showing = mode._showBoardView({ focusLevelId: 6, showLoadingOverlay: false });
        await flushMicrotasks();
        expect(mode._focusBoardLevelForLaunch).toHaveBeenCalledTimes(1);
        await mode.onDeactivate();
        focus.resolve();
        await expect(showing).resolves.toBe(false);
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).not.toHaveBeenCalled();
        expect(mode._scheduleDeferredWarpPreinit).not.toHaveBeenCalled();
    });

    it('keeps a scenic return locked and preserves the playing track through its reveal', async () => {
        const { mode, transition, returned } = createMode();
        const journey = {};
        mode._journeyFlowOperation = journey;
        const onWorldReady = vi.fn();
        const options = { preserveJourneyFlow: journey, scenicJourney: true, focusLevelId: 4, onWorldReady };
        const returning = mode.returnToBoard(options);
        expect(mode._lockOdysseyBoardForLaunch).toHaveBeenCalledOnce();
        expect(mode._setBoardOverlaySuppressed).toHaveBeenCalledWith(true);
        await transition.callbacks.onBlackoutReached();
        expect(mode.onStop).toHaveBeenCalledWith(options);
        expect(mode._applyBoardAudioPolicy).not.toHaveBeenCalled();
        expect(mode._showBoardView).toHaveBeenCalledWith(expect.objectContaining({ focusLevelId: 4, keepBoardLocked: true }));
        expect(onWorldReady).toHaveBeenCalledOnce();
        await transition.callbacks.onRevealStart();
        await transition.callbacks.onComplete();
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).not.toHaveBeenCalled();
        expect(mode._restoreInputs).not.toHaveBeenCalled();
        returned.resolve({ success: true });
        await expect(returning).resolves.toBe(true);
    });

    it('awaits the scenic source rail seek and never starts the ordinary orb focus', async () => {
        const { mode } = createMode();
        const seek = deferred();
        const journey = {};
        mode._journeyFlowOperation = journey;
        mode._scenicJourneyOperation = journey;
        delete mode._showBoardView;
        mode._initializeOdysseyBoard = vi.fn().mockResolvedValue(true);
        mode._buildOdysseyProgressData = vi.fn(() => ({}));
        mode.closeOdysseyNavigator = vi.fn();
        mode._restoreBoardOverlayAfterLaunchAttempt = vi.fn();
        mode._focusBoardLevelForLaunch = vi.fn();
        mode._scheduleDeferredWarpPreinit = vi.fn();
        mode.boardController = { travelToLevel: vi.fn(() => seek.promise) };
        const showing = mode._showBoardView({ focusLevelId: 4, showLoadingOverlay: false });
        await flushMicrotasks();
        expect(mode.boardController.travelToLevel).toHaveBeenCalledExactlyOnceWith(4, {
            pathTravel: true, focus: false, travelDuration: 0,
        });
        expect(mode._focusBoardLevelForLaunch).not.toHaveBeenCalled();
        expect(mode._scheduleDeferredWarpPreinit).not.toHaveBeenCalled();
        seek.resolve(true);
        await expect(showing).resolves.toBe(true);
        expect(mode.selectedLevelId).toBe(4);
        expect(mode.closeOdysseyNavigator).toHaveBeenCalledWith({ restoreBoardPreview: false });
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).not.toHaveBeenCalled();
    });

    it('does not reveal a scenic return after its world-ready callback cancels ownership', async () => {
        const { mode, transition, returned } = createMode();
        const journey = {};
        mode._journeyFlowOperation = journey;
        const returning = mode.returnToBoard({
            preserveJourneyFlow: journey,
            scenicJourney: true,
            onWorldReady: () => { journey.cancelled = true; },
        });
        await expect(transition.callbacks.onBlackoutReached()).resolves.toBe(false);
        await expect(transition.callbacks.onRevealStart()).resolves.toBe(false);
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).not.toHaveBeenCalled();
        returned.resolve({ success: false });
        await expect(returning).resolves.toBe(false);
    });

    it('requires exact scenic ownership before skipping ordinary map audio restoration', async () => {
        const { mode, transition, returned } = createMode();
        mode._journeyFlowOperation = {};
        const returning = mode.returnToBoard({ preserveJourneyFlow: {}, scenicJourney: true });
        await transition.callbacks.onBlackoutReached();
        expect(mode._applyBoardAudioPolicy).toHaveBeenCalledWith({ restoreTrack: true });
        await transition.callbacks.onRevealStart();
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).toHaveBeenCalledOnce();
        returned.resolve({ success: true });
        await returning;
    });

    it('preserves chapter return audio policy while retaining the chapter interlude owner', async () => {
        const { mode, transition, returned } = createMode();
        const journey = {};
        mode._journeyFlowOperation = journey;
        mode._chapterFlowActive = true;
        const returning = mode.returnToBoard({ preserveJourneyFlow: journey });
        await transition.callbacks.onBlackoutReached();
        expect(mode._applyBoardAudioPolicy).toHaveBeenCalledWith({ restoreTrack: true });
        expect(mode._scenicJourneyOperation).toBeNull();
        expect(mode._chapterFlowActive).toBe(true);
        await transition.callbacks.onRevealStart();
        expect(mode._unlockOdysseyBoardAfterLaunchAttempt).not.toHaveBeenCalled();
        returned.resolve({ success: true });
        await expect(returning).resolves.toBe(true);
    });

    it('settles the chapter source on its rail under cover before world-ready callbacks', async () => {
        const { mode, transition, returned } = createMode();
        const source = deferred();
        const onWorldReady = vi.fn();
        mode.boardController = { travelToLevel: vi.fn(() => source.promise) };
        const journey = {};
        mode._chapterFlowActive = true;
        mode._journeyFlowOperation = journey;
        const returning = mode.returnToBoard({ preserveJourneyFlow: journey, settlePath: true, onWorldReady });
        const preparing = transition.callbacks.onBlackoutReached();
        await flushMicrotasks();
        expect(mode._showBoardView).toHaveBeenCalledWith(expect.objectContaining({ focusLevelId: null }));
        expect(mode.boardController.travelToLevel).toHaveBeenCalledWith(5, {
            pathTravel: true, focus: false, travelDuration: 0, isCurrent: expect.any(Function),
        });
        expect(onWorldReady).not.toHaveBeenCalled();
        source.resolve(true);
        await preparing;
        expect(onWorldReady).toHaveBeenCalledOnce();
        expect(mode.selectedLevelId).toBe(5);
        expect(mode._applyBoardAudioPolicy).toHaveBeenCalledWith({ restoreTrack: true });
        returned.resolve({ success: true });
        await expect(returning).resolves.toBe(true);
    });

    it('does not seek or reveal an old chapter return after its journey owner is replaced', async () => {
        const { mode, transition, returned } = createMode();
        const board = deferred();
        mode._showBoardView.mockReturnValueOnce(board.promise);
        mode.boardController = { travelToLevel: vi.fn() };
        const journey = {};
        mode._journeyFlowOperation = journey;
        const onWorldReady = vi.fn();
        const returning = mode.returnToBoard({ preserveJourneyFlow: journey, settlePath: true, onWorldReady });
        const preparing = transition.callbacks.onBlackoutReached();
        await flushMicrotasks();
        mode._journeyFlowOperation = {};
        board.resolve(true);
        await expect(preparing).resolves.toBe(false);
        await expect(transition.callbacks.onRevealStart()).resolves.toBe(false);
        expect(mode.boardController.travelToLevel).not.toHaveBeenCalled();
        expect(onWorldReady).not.toHaveBeenCalled();
        returned.resolve({ success: false });
        await expect(returning).resolves.toBe(false);
    });

    it('finishes scenic abort recovery after real onStop cancels the journey owner', async () => {
        const { mode, transition } = createMode();
        delete mode.onStop;
        ['_hideGoalCompleteOverlay', '_removeVictoryLapInputs', '_cleanupOdysseyHUD',
            '_cleanupMinimap', '_applyInfinityLayout'].forEach((method) => { mode[method] = vi.fn(); });
        const journey = { modal: { dispose: vi.fn() } };
        mode._journeyFlowOperation = journey;
        const returning = mode.returnToBoard({ preserveJourneyFlow: journey, scenicJourney: true, focusLevelId: 4 });

        transition.abort('blackout-timeout');
        await expect(returning).resolves.toBe(false);

        expect(journey.cancelled).toBe(true);
        expect(journey.modal.dispose).toHaveBeenCalledOnce();
        expect(mode._journeyFlowOperation).toBeNull();
        expect(mode.currentLevelId).toBeNull();
        expect(mode.currentLevelConfig).toBeNull();
        expect(mode.isInBoardView).toBe(true);
        expect(mode._applyBoardAudioPolicy).toHaveBeenCalledWith({ restoreTrack: true });
        expect(mode._showBoardView).toHaveBeenCalledWith({
            showLoadingOverlay: false, minOverlayDisplayMs: 0, focusLevelId: 4, keepBoardLocked: false,
        });
        expect(mode._clearBoardReturnFallbackVeil).toHaveBeenLastCalledWith();
        expect(mode._restoreInputs).toHaveBeenCalledOnce();
        expect(mode._boardReturnOperation).toBeNull();
    });
});
