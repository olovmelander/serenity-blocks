import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GameModeManager } from '../../src/core/game-modes/GameModeManager.js';

function createMode(id, onStart, onStop = async (mode) => {
    mode.isRunning = false;
}) {
    const mode = {
        getDisplayName: () => id,
        getModeId: () => id,
        getStartRuntimePolicy: () => ({
            resumeThemeLinkedMusic: false,
            resumeThemes: false,
            syncMusicPlayback: false,
        }),
        isActive: false,
        isRunning: false,
        onActivate: vi.fn(),
        onStart: vi.fn(),
        onStop: vi.fn(),
    };
    mode.onActivate.mockImplementation(async () => {
        mode.isActive = true;
    });
    mode.onStart.mockImplementation((...args) => onStart(mode, ...args));
    mode.onStop.mockImplementation((...args) => onStop(mode, ...args));
    return mode;
}

async function activateMode(manager, mode) {
    manager.registerMode(mode);
    await manager.activateMode(mode.getModeId());
}

describe('GameModeManager failed-start rollback', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('stops the exact mode when startup fails after it claims running ownership', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const startError = new Error('runtime install failed');
        const manager = new GameModeManager({ themeManager: { suspendThemes: vi.fn() } });
        const mode = createMode('failing-owned', async (failedMode) => {
            failedMode.isRunning = true;
            throw startError;
        });
        await activateMode(manager, mode);

        await expect(manager.startCurrentMode()).rejects.toBe(startError);

        expect(mode.onStop).toHaveBeenCalledOnce();
        expect(mode.isRunning).toBe(false);
        expect(manager.getCurrentMode()).toBe(mode);
    });

    it('does not stop a mode that failed before claiming running ownership', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const manager = new GameModeManager({ themeManager: { suspendThemes: vi.fn() } });
        const mode = createMode('failing-unowned', async () => {
            throw new Error('preflight failed');
        });
        await activateMode(manager, mode);

        await expect(manager.startCurrentMode()).rejects.toThrow('preflight failed');
        expect(mode.onStop).not.toHaveBeenCalled();
    });

    it('preserves the startup error when best-effort rollback also fails', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        const startError = new Error('start failed');
        const cleanupError = new Error('cleanup failed');
        const manager = new GameModeManager({ themeManager: { suspendThemes: vi.fn() } });
        const mode = createMode(
            'failing-cleanup',
            async (failedMode) => {
                failedMode.isRunning = true;
                throw startError;
            },
            async () => {
                throw cleanupError;
            },
        );
        await activateMode(manager, mode);

        await expect(manager.startCurrentMode()).rejects.toBe(startError);
        expect(errorLog).toHaveBeenCalledWith(
            '[GameModeManager] Failed to roll back mode failing-cleanup:',
            cleanupError,
        );
    });
});
