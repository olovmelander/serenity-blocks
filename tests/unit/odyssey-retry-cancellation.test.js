/* eslint-disable import/first */

import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// The renderer's @utils alias is not configured in the unit-test runtime.
// Retry never creates BoardJuice; match the other Odyssey mode test imports.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

vi.mock('../../src/ui/odyssey/retry-veil.js', () => ({
    showRetryVeil: vi.fn(),
    hideRetryVeil: vi.fn(),
    clearRetryVeil: vi.fn(),
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import {
    showRetryVeil, hideRetryVeil, clearRetryVeil,
} from '../../src/ui/odyssey/retry-veil.js';
import { createOdysseyFlowDom } from '../helpers/odyssey-flow-dom.js';

function deferred() {
    let resolve;
    const promise = new Promise((settle) => { resolve = settle; });
    return { promise, resolve };
}

function bindAttempt(mode, { retired = false } = {}) {
    const session = {
        generation: ++mode._levelSessionGeneration,
        gameState: {},
        hybridEngine: {},
        retired,
    };
    mode._activeLevelSession = session;
    mode.gameState = session.gameState;
    mode.hybridEngine = session.hybridEngine;
    return session;
}

function createMode() {
    const mode = Object.create(OdysseyMode.prototype);
    Object.assign(mode, {
        deps: {},
        isActive: true,
        isRunning: false,
        currentLevelId: 3,
        currentLevelConfig: { id: 3, name: 'Retry test' },
        _levelSessionGeneration: 0,
        themeRevealToken: 0,
        _levelAttemptNumber: 1,
        showLevelStartCue: vi.fn(async () => true),
        beginLevelRun: vi.fn(),
        returnToBoard: vi.fn(),
    });
    bindAttempt(mode, { retired: true });
    mode.prepareLevelStart = vi.fn(async () => {
        bindAttempt(mode);
        return true;
    });
    // Exercise real onStop and session retirement, without unrelated renderer/UI work.
    [
        '_stopFixedTickSession', '_restoreInputs', '_restoreTransitionMusicDuck',
        '_clearLevelThemePrefetchTimer', '_clearNeutralThemeFallbackBackdrop',
        '_clearGameplayRevealState', '_clearLevelStartCue', '_hideGoalCompleteOverlay',
        '_removeVictoryLapInputs', '_cleanupOdysseyHUD', '_cleanupMinimap',
        '_applyInfinityLayout', '_stopPhaserBoardScene',
    ].forEach((method) => { mode[method] = vi.fn(); });
    return mode;
}

async function flushMicrotasks() {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe('Odyssey in-place retry cancellation', () => {
    beforeEach(() => {
        const dom = createOdysseyFlowDom();
        vi.stubGlobal('document', dom.document);
        vi.stubGlobal('window', dom.window);
        vi.clearAllMocks();
        showRetryVeil.mockResolvedValue(undefined);
        hideRetryVeil.mockResolvedValue(undefined);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('starts the prepared replacement only after its cover, reveal and ready cue finish', async () => {
        const mode = createMode();
        const cover = deferred();
        showRetryVeil.mockReturnValueOnce(cover.promise);
        const modal = { remove: vi.fn() };
        const retry = mode._restartLevelInPlace(modal);
        expect(modal.remove).not.toHaveBeenCalled();
        expect(mode.prepareLevelStart).not.toHaveBeenCalled();
        cover.resolve();
        await retry;
        expect(modal.remove).toHaveBeenCalledTimes(1);
        expect(mode.prepareLevelStart).toHaveBeenCalledTimes(1);
        expect(hideRetryVeil).toHaveBeenCalledTimes(1);
        expect(mode.showLevelStartCue).toHaveBeenCalledWith(mode.currentLevelConfig, mode.gameState);
        expect(mode.beginLevelRun).toHaveBeenCalledTimes(1);
        expect(mode._levelAttemptNumber).toBe(2);
        expect(mode.returnToBoard).not.toHaveBeenCalled();
    });

    it('stops during the cover without preparing or restarting gameplay afterwards', async () => {
        const mode = createMode();
        const cover = deferred();
        showRetryVeil.mockReturnValueOnce(cover.promise);
        const retry = mode._restartLevelInPlace();
        await mode.onStop();
        expect(clearRetryVeil).toHaveBeenCalled();
        cover.resolve();
        await retry;
        expect(mode.prepareLevelStart).not.toHaveBeenCalled();
        expect(hideRetryVeil).not.toHaveBeenCalled();
        expect(mode.showLevelStartCue).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(mode.returnToBoard).not.toHaveBeenCalled();
    });

    it('leaves a newer attempt untouched when the old retry cover settles', async () => {
        const mode = createMode();
        const cover = deferred();
        showRetryVeil.mockReturnValueOnce(cover.promise);
        const retry = mode._restartLevelInPlace();
        mode._retireLevelSession();
        const replacement = bindAttempt(mode);
        cover.resolve();
        await retry;
        expect(mode._activeLevelSession).toBe(replacement);
        expect(mode.prepareLevelStart).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('does not return to the map when preparation fails because the mode stopped', async () => {
        const mode = createMode();
        const preparation = deferred();
        mode.prepareLevelStart.mockImplementationOnce(() => {
            mode._retireLevelSession();
            return preparation.promise;
        });
        const retry = mode._restartLevelInPlace();
        await flushMicrotasks();
        expect(mode.prepareLevelStart).toHaveBeenCalledTimes(1);
        await mode.onStop();
        preparation.resolve(false);
        await retry;
        expect(mode.returnToBoard).not.toHaveBeenCalled();
        expect(hideRetryVeil).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('keeps the replacement covered when its preparation settles after retirement', async () => {
        const mode = createMode();
        const preparation = deferred();
        mode.prepareLevelStart.mockImplementationOnce(() => {
            bindAttempt(mode);
            return preparation.promise;
        });
        const retry = mode._restartLevelInPlace();
        await flushMicrotasks();
        await mode.onStop();
        preparation.resolve(true);
        await retry;
        expect(hideRetryVeil).not.toHaveBeenCalled();
        expect(mode.showLevelStartCue).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('does not run the ready cue after stopping during the reveal', async () => {
        const mode = createMode();
        const reveal = deferred();
        hideRetryVeil.mockReturnValueOnce(reveal.promise);
        const retry = mode._restartLevelInPlace();
        await flushMicrotasks();
        expect(hideRetryVeil).toHaveBeenCalledTimes(1);
        await mode.onStop();
        reveal.resolve();
        await retry;
        expect(mode.showLevelStartCue).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('does not begin gameplay when the ready cue reports cancellation', async () => {
        const mode = createMode();
        mode.showLevelStartCue.mockResolvedValueOnce(false);
        await mode._restartLevelInPlace();
        expect(mode.showLevelStartCue).toHaveBeenCalledTimes(1);
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('does not begin gameplay if the prepared session retires during its ready cue', async () => {
        const mode = createMode();
        const cue = deferred();
        mode.showLevelStartCue.mockReturnValueOnce(cue.promise);
        const retry = mode._restartLevelInPlace();
        await flushMicrotasks();
        expect(mode.showLevelStartCue).toHaveBeenCalledTimes(1);
        await mode.onStop();
        cue.resolve(true);
        await retry;
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(mode.returnToBoard).not.toHaveBeenCalled();
    });

    it('holds a hidden retry until deliberate Resume, even after focus returns', async () => {
        const mode = createMode();
        document.hidden = true;
        const retry = mode._restartLevelInPlace();
        await flushMicrotasks();
        expect(mode.prepareLevelStart).toHaveBeenCalledOnce();
        expect(mode.showLevelStartCue).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        document.hidden = false;
        document.dispatch('visibilitychange');
        await flushMicrotasks();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        const modal = document.getElementById('odyssey-flow-overlay');
        modal.querySelector('[data-flow-action="resume"]').dispatch('click');
        await retry;
        expect(mode.showLevelStartCue).toHaveBeenCalledOnce();
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
        expect(document.getElementById('odyssey-flow-overlay')).toBeNull();
        expect(document.listenerCount()).toBe(0);
        expect(window.listenerCount()).toBe(0);
    });

    it('restarts the complete ready cue after a brief blur during retry', async () => {
        const mode = createMode();
        const cue = deferred();
        mode.showLevelStartCue.mockReturnValueOnce(cue.promise);
        const retry = mode._restartLevelInPlace();
        await flushMicrotasks();
        window.dispatch('blur');
        window.dispatch('focus');
        cue.resolve(true);
        await flushMicrotasks();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(mode.showLevelStartCue).toHaveBeenCalledOnce();
        const modal = document.getElementById('odyssey-flow-overlay');
        modal.querySelector('[data-flow-action="resume"]').dispatch('click');
        await retry;
        expect(mode.showLevelStartCue).toHaveBeenCalledTimes(2);
        expect(mode.beginLevelRun).toHaveBeenCalledOnce();
    });

    it('settles a suspended retry synchronously when the mode stops', async () => {
        const mode = createMode();
        document.hidden = true;
        const retry = mode._restartLevelInPlace();
        await flushMicrotasks();
        const stopping = mode.onStop();
        expect(document.getElementById('odyssey-flow-overlay')).toBeNull();
        await stopping;
        await retry;
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
    });

    it('keeps Map cancellation covered until retry preparation settles', async () => {
        const mode = createMode();
        const preparation = deferred();
        mode.prepareLevelStart.mockImplementationOnce(() => {
            bindAttempt(mode);
            return preparation.promise;
        });
        const retry = mode._restartLevelInPlace();
        await flushMicrotasks();
        const modal = document.getElementById('odyssey-flow-overlay');
        document.dispatch('keydown', { key: 'Escape' });
        expect(modal.dataset.retained).toBe('true');
        expect(mode.returnToBoard).not.toHaveBeenCalled();
        preparation.resolve(true);
        await retry;
        expect(mode.returnToBoard).toHaveBeenCalledOnce();
        expect(mode.showLevelStartCue).not.toHaveBeenCalled();
        expect(mode.beginLevelRun).not.toHaveBeenCalled();
        expect(document.getElementById('odyssey-flow-overlay')).toBeNull();
    });
});
