import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GameModeManager } from '../../src/core/game-modes/GameModeManager.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
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

function createManager() {
    const deps = {
        themeManager: { resumeThemes: vi.fn(), suspendThemes: vi.fn() },
        soundManager: { resumeThemeLinkedMusic: vi.fn(), ensureTrackPlaybackSynced: vi.fn() },
    };
    const manager = new GameModeManager(deps);
    const old = createMode('old');
    const replacement = createMode('replacement');
    manager.registerMode(old);
    manager.registerMode(replacement);
    deps.themeManager.suspendThemes.mockClear();
    return { deps, manager, old, replacement };
}

describe('GameModeManager async continuation ownership', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it('does not announce an old activation after another mode has taken ownership', async () => {
        const { manager, old, replacement } = createManager();
        const pending = deferred();
        old.onActivate.mockImplementation(async () => {
            old.isActive = true;
            await pending.promise;
        });
        const activated = vi.fn();
        manager.on('modeActivated', activated);
        const activating = manager.activateMode('old');
        await vi.waitFor(() => expect(old.onActivate).toHaveBeenCalledOnce());
        await manager.activateMode('replacement');
        pending.resolve();
        await activating;

        expect(manager.getCurrentMode()).toBe(replacement);
        expect(old.onDeactivate).toHaveBeenCalledOnce();
        expect(activated).toHaveBeenCalledExactlyOnceWith({ modeId: 'replacement', mode: replacement });
    });

    it('does not clear or announce a replacement while the old mode deactivates', async () => {
        const { manager, old, replacement } = createManager();
        const draining = deferred();
        old.onDeactivate.mockImplementation(async () => {
            old.isActive = false;
            await draining.promise;
        });
        await manager.activateMode('old');
        const deactivated = vi.fn();
        manager.on('modeDeactivated', deactivated);

        const stopping = manager.deactivateCurrentMode();
        await manager.activateMode('replacement');
        draining.resolve();
        await stopping;

        expect(old.onDeactivate).toHaveBeenCalledOnce();
        expect(manager.getCurrentMode()).toBe(replacement);
        expect(manager.getCurrentModeId()).toBe('replacement');
        expect(deactivated).not.toHaveBeenCalled();
    });

    it('does not suspend a replacement theme when an old stop finishes', async () => {
        const { deps, manager, old, replacement } = createManager();
        const draining = deferred();
        old.onStop.mockImplementation(async () => {
            old.isRunning = false;
            await draining.promise;
        });
        await manager.activateMode('old');
        await manager.startCurrentMode();
        const stopped = vi.fn();
        manager.on('modeStopped', stopped);

        const stopping = manager.stopCurrentMode();
        await manager.activateMode('replacement');
        await manager.startCurrentMode();
        draining.resolve();
        await stopping;

        expect(old.onStop).toHaveBeenCalledOnce();
        expect(manager.getCurrentMode()).toBe(replacement);
        expect(replacement.isRunning).toBe(true);
        expect(deps.themeManager.suspendThemes).not.toHaveBeenCalled();
        expect(stopped).not.toHaveBeenCalled();
    });

    it('does not suspend a cached mode instance restarted while its old stop drains', async () => {
        const { deps, manager, old } = createManager();
        const draining = deferred();
        old.onStop.mockImplementation(async () => {
            old.isRunning = false;
            await draining.promise;
        });
        await manager.activateMode('old');
        await manager.startCurrentMode();
        const stopped = vi.fn();
        manager.on('modeStopped', stopped);

        const stopping = manager.stopCurrentMode();
        await manager.startCurrentMode();
        draining.resolve();
        await stopping;

        expect(old.isRunning).toBe(true);
        expect(deps.themeManager.suspendThemes).not.toHaveBeenCalled();
        expect(stopped).not.toHaveBeenCalled();
    });

    it('retains a cached mode instance reactivated while its old deactivation drains', async () => {
        const { manager, old } = createManager();
        const draining = deferred();
        old.onDeactivate.mockImplementation(async () => {
            old.isActive = false;
            await draining.promise;
        });
        await manager.activateMode('old');
        const deactivated = vi.fn();
        manager.on('modeDeactivated', deactivated);

        const stopping = manager.deactivateCurrentMode();
        await manager.activateMode('old');
        draining.resolve();
        await stopping;

        expect(old.isActive).toBe(true);
        expect(manager.getCurrentMode()).toBe(old);
        expect(deactivated).not.toHaveBeenCalled();
    });

    it.each(['theme', 'audio'])('does not announce a stale start after awaiting %s', async (stage) => {
        const { deps, manager, replacement } = createManager();
        const pending = deferred();
        if (stage === 'theme') deps.themeManager.resumeThemes.mockReturnValueOnce(pending.promise);
        else deps.soundManager.ensureTrackPlaybackSynced.mockReturnValueOnce(pending.promise);
        await manager.activateMode('old');
        const started = vi.fn();
        manager.on('modeStarted', started);

        const starting = manager.startCurrentMode();
        await vi.waitFor(() => {
            const operation = stage === 'theme'
                ? deps.themeManager.resumeThemes
                : deps.soundManager.ensureTrackPlaybackSynced;
            expect(operation).toHaveBeenCalledOnce();
        });
        await manager.activateMode('replacement');
        pending.resolve();
        await starting;

        expect(manager.getCurrentMode()).toBe(replacement);
        expect(started).not.toHaveBeenCalled();
        expect(deps.soundManager.ensureTrackPlaybackSynced)
            .toHaveBeenCalledTimes(stage === 'theme' ? 0 : 1);
    });

    it('continues to publish owned start, stop, and deactivate completions', async () => {
        const { manager, old, deps } = createManager();
        const events = [];
        ['modeStarted', 'modeStopped', 'modeDeactivated'].forEach((name) => {
            manager.on(name, (data) => events.push([name, data]));
        });
        await manager.activateMode('old');
        await manager.startCurrentMode();
        await manager.stopCurrentMode();
        await manager.deactivateCurrentMode();

        expect(events).toEqual([
            ['modeStarted', { modeId: 'old', mode: old }],
            ['modeStopped', { modeId: 'old', mode: old }],
            ['modeDeactivated', { modeId: 'old', mode: old }],
        ]);
        expect(deps.themeManager.suspendThemes).toHaveBeenCalledOnce();
        expect(manager.getCurrentMode()).toBeNull();
    });

    it('delivers the event to later listeners when an earlier one unsubscribes itself', () => {
        const { manager } = createManager();
        const seen = [];
        const off = manager.on('modeStarted', () => {
            seen.push('first');
            off();
        });
        manager.on('modeStarted', () => seen.push('second'));
        manager._emitEvent('modeStarted', {});
        manager._emitEvent('modeStarted', {});
        expect(seen).toEqual(['first', 'second', 'second']);
    });
});
