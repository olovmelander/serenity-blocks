import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GameModeManager } from '../../src/core/game-modes/GameModeManager.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function createMode(id) {
    const mode = {
        getModeId: () => id,
        getDisplayName: () => id,
        isActive: false,
        isRunning: false,
        onActivate: vi.fn(async () => { mode.isActive = true; }),
        onStart: vi.fn(async () => { mode.isRunning = true; }),
        onStop: vi.fn(async () => { mode.isRunning = false; }),
        onDeactivate: vi.fn(async () => {
            mode.isActive = false;
            mode.isRunning = false;
        }),
    };
    return mode;
}

async function createRunningFixture(stage) {
    const pending = deferred();
    const deps = {
        themeManager: { resumeThemes: vi.fn(), suspendThemes: vi.fn() },
        soundManager: { resumeThemeLinkedMusic: vi.fn(), ensureTrackPlaybackSynced: vi.fn() },
    };
    const manager = new GameModeManager(deps);
    const mode = createMode('cached');
    manager.registerMode(mode);
    await manager.activateMode('cached');
    const started = vi.fn();
    manager.on('modeStarted', started);
    const operation = stage === 'theme'
        ? deps.themeManager.resumeThemes
        : deps.soundManager.ensureTrackPlaybackSynced;
    operation.mockReturnValueOnce(pending.promise);
    const oldStart = manager.startCurrentMode();
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    return {
        manager, mode, deps, pending, oldStart, started,
    };
}

describe('GameModeManager start operation ownership for cached modes', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it.each(['theme', 'audio'])('does not complete an old %s wait into a new run', async (stage) => {
        const {
            manager, mode, deps, pending, oldStart, started,
        } = await createRunningFixture(stage);
        await manager.stopCurrentMode();
        await manager.startCurrentMode();
        expect(started).toHaveBeenCalledOnce();
        const audioCalls = deps.soundManager.ensureTrackPlaybackSynced.mock.calls.length;

        pending.resolve();
        await oldStart;

        expect(mode.isRunning).toBe(true);
        expect(started).toHaveBeenCalledExactlyOnceWith({ modeId: 'cached', mode });
        expect(deps.soundManager.ensureTrackPlaybackSynced).toHaveBeenCalledTimes(audioCalls);
    });

    it.each(['theme', 'audio'])('preserves the restarted run when the old %s wait rejects', async (stage) => {
        const {
            manager, mode, pending, oldStart, started,
        } = await createRunningFixture(stage);
        const oldFailure = new Error(`old ${stage} failed`);
        const rejected = expect(oldStart).rejects.toBe(oldFailure);
        await manager.stopCurrentMode();
        await manager.startCurrentMode();

        pending.reject(oldFailure);
        await rejected;

        expect(mode.isRunning).toBe(true);
        expect(mode.onStop).toHaveBeenCalledOnce();
        expect(started).toHaveBeenCalledOnce();
        expect(manager.getCurrentMode()).toBe(mode);
    });

    it('does not apply shared runtime work after an old mode hook finishes', async () => {
        const pending = deferred();
        const deps = {
            themeManager: { resumeThemes: vi.fn() },
            soundManager: { resumeThemeLinkedMusic: vi.fn(), ensureTrackPlaybackSynced: vi.fn() },
        };
        const manager = new GameModeManager(deps);
        const mode = createMode('cached');
        mode.onStart.mockImplementationOnce(async () => {
            mode.isRunning = true;
            await pending.promise;
        });
        manager.registerMode(mode);
        await manager.activateMode('cached');
        const started = vi.fn();
        manager.on('modeStarted', started);
        const oldStart = manager.startCurrentMode();
        await manager.stopCurrentMode();
        await manager.startCurrentMode();
        pending.resolve();
        await oldStart;

        expect(deps.themeManager.resumeThemes).toHaveBeenCalledOnce();
        expect(deps.soundManager.resumeThemeLinkedMusic).toHaveBeenCalledOnce();
        expect(deps.soundManager.ensureTrackPlaybackSynced).toHaveBeenCalledOnce();
        expect(started).toHaveBeenCalledOnce();
    });

    it('does not retire the accepted start when an already-running call returns early', async () => {
        const {
            manager, mode, pending, oldStart, started,
        } = await createRunningFixture('theme');
        await manager.startCurrentMode();
        pending.resolve();
        await oldStart;

        expect(mode.onStart).toHaveBeenCalledOnce();
        expect(started).toHaveBeenCalledExactlyOnceWith({ modeId: 'cached', mode });
    });

    it('still rolls back a currently owned runtime failure', async () => {
        const {
            mode, pending, oldStart, started,
        } = await createRunningFixture('theme');
        const failure = new Error('owned theme failed');
        const rejected = expect(oldStart).rejects.toBe(failure);
        pending.reject(failure);
        await rejected;

        expect(mode.onStop).toHaveBeenCalledOnce();
        expect(mode.isRunning).toBe(false);
        expect(started).not.toHaveBeenCalled();
    });

    it('keeps failed-start cleanup specific to the old instance after another starts', async () => {
        const {
            manager, mode, pending, oldStart,
        } = await createRunningFixture('theme');
        const failure = new Error('old instance failed');
        const rejected = expect(oldStart).rejects.toBe(failure);
        // A failed partial teardown may leave the previous instance running.
        mode.onDeactivate.mockImplementation(async () => { mode.isActive = false; });
        const replacement = createMode('replacement');
        manager.registerMode(replacement);
        await manager.activateMode('replacement');
        await manager.startCurrentMode();
        pending.reject(failure);
        await rejected;

        expect(mode.onStop).toHaveBeenCalledOnce();
        expect(mode.isRunning).toBe(false);
        expect(replacement.onStop).not.toHaveBeenCalled();
        expect(replacement.isRunning).toBe(true);
        expect(manager.getCurrentMode()).toBe(replacement);
    });
});
