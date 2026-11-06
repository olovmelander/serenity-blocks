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
        onDeactivate: vi.fn(async () => { mode.isActive = false; mode.isRunning = false; }),
    };
    return mode;
}

async function pendingActivation() {
    const manager = new GameModeManager({});
    const mode = createMode('cached');
    const pending = deferred();
    mode.onActivate.mockImplementationOnce(async () => {
        mode.isActive = true;
        await pending.promise;
    });
    manager.registerMode(mode);
    const activated = vi.fn();
    manager.on('modeActivated', activated);
    const oldActivation = manager.activateMode('cached');
    await vi.waitFor(() => expect(mode.onActivate).toHaveBeenCalledOnce());
    return { manager, mode, pending, oldActivation, activated };
}

describe('GameModeManager activation operation ownership for cached modes', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it('does not announce an old activation again after the same instance is reactivated', async () => {
        const { manager, mode, pending, oldActivation, activated } = await pendingActivation();
        await manager.deactivateCurrentMode();
        await manager.activateMode('cached');
        expect(activated).toHaveBeenCalledOnce();

        pending.resolve();
        await oldActivation;

        expect(manager.getCurrentMode()).toBe(mode);
        expect(mode.isActive).toBe(true);
        expect(activated).toHaveBeenCalledExactlyOnceWith({ modeId: 'cached', mode });
    });

    it('does not clear a reactivated cached instance when its old activation rejects', async () => {
        const { manager, mode, pending, oldActivation, activated } = await pendingActivation();
        const failure = new Error('old activation failed');
        const rejected = expect(oldActivation).rejects.toBe(failure);
        await manager.deactivateCurrentMode();
        await manager.activateMode('cached');

        pending.reject(failure);
        await rejected;

        expect(manager.getCurrentMode()).toBe(mode);
        expect(manager.getCurrentModeId()).toBe('cached');
        expect(mode.isActive).toBe(true);
        expect(activated).toHaveBeenCalledOnce();
    });

    it('keeps the accepted activation owned when an already-active call returns early', async () => {
        const { manager, mode, pending, oldActivation, activated } = await pendingActivation();
        await manager.activateMode('cached');
        pending.resolve();
        await oldActivation;

        expect(mode.onActivate).toHaveBeenCalledOnce();
        expect(activated).toHaveBeenCalledExactlyOnceWith({ modeId: 'cached', mode });
    });

    it('still clears the current mode and rejects its owned activation failure', async () => {
        const { manager, pending, oldActivation, activated } = await pendingActivation();
        const failure = new Error('owned activation failed');
        const rejected = expect(oldActivation).rejects.toBe(failure);
        pending.reject(failure);
        await rejected;

        expect(manager.getCurrentMode()).toBeNull();
        expect(manager.getCurrentModeId()).toBeNull();
        expect(activated).not.toHaveBeenCalled();
    });

    it.each(['resolve', 'reject'])('keeps a different replacement when an old activation %ss', async (outcome) => {
        const { manager, pending, oldActivation, activated } = await pendingActivation();
        const result = oldActivation.catch((error) => error);
        const replacement = createMode('replacement');
        manager.registerMode(replacement);
        await manager.activateMode('replacement');

        const failure = new Error('retired activation failed');
        if (outcome === 'reject') pending.reject(failure);
        else pending.resolve();
        expect(await result).toBe(outcome === 'reject' ? failure : undefined);

        expect(manager.getCurrentMode()).toBe(replacement);
        expect(replacement.isActive).toBe(true);
        expect(activated).toHaveBeenCalledExactlyOnceWith({ modeId: 'replacement', mode: replacement });
    });
});
