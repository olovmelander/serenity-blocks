import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupApplication } from '../../src/utils/application-cleanup.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function fixture() {
    const calls = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('cancelAnimationFrame', (id) => calls.push(`raf:${id}`));
    const app = {
        isInitialized: true,
        animationFrameId: 0,
        settingsManager: { dispose: () => calls.push('settings') },
        modalManager: { destroy: () => calls.push('modal') },
        serenityHub: { destroy: () => calls.push('hub') },
        cleanupHandlers: [() => calls.push('handlers')],
        stopFPSMonitor: () => calls.push('fps'),
        frameRateController: { stopHybridLoop: () => calls.push('simulation') },
        phaserGame: { destroy: () => calls.push('phaser') },
        boardScene: {},
        themeManager: { cleanup: () => calls.push('theme') },
        inputController: { cleanup: () => calls.push('input') },
        soundManager: { cleanup: () => calls.push('audio') },
    };
    return { app, calls };
}

describe('application cleanup ownership', () => {
    it('stops controller input and queued invites before asynchronous mode retirement', async () => {
        const { app } = fixture();
        const receiveInput = vi.fn();
        const joinInvite = vi.fn();
        const listeners = new Set([receiveInput, joinInvite]);
        app.gamepadController = { destroy: vi.fn(() => listeners.delete(receiveInput)) };
        app.steamInviteManager = { destroy: vi.fn(() => listeners.delete(joinInvite)) };
        let retire;
        app.gameModeManager = {
            cleanup: async () => {
                // Mode teardown may dispatch menu events before its work drains.
                for (const listener of listeners) listener();
                await new Promise((resolve) => { retire = resolve; });
            },
        };

        const completion = cleanupApplication(app);
        expect(listeners.size).toBe(0);
        await Promise.resolve();
        expect(receiveInput).not.toHaveBeenCalled();
        expect(joinInvite).not.toHaveBeenCalled();
        expect(app.isInitialized).toBe(true);
        retire();
        await completion;
        await cleanupApplication(app);
        expect(app.gamepadController.destroy).toHaveBeenCalledTimes(1);
        expect(app.steamInviteManager.destroy).toHaveBeenCalledTimes(1);
    });

    it('returns the same completion Promise and retires modes before destroying shared dependencies', async () => {
        const { app, calls } = fixture();
        let retire;
        const hub = app.serenityHub;
        hub.hide = () => calls.push('hub-hide');
        app.gameModeManager = {
            cleanup: async () => {
                calls.push('mode-start');
                await new Promise((resolve) => { retire = resolve; });
                expect(app.serenityHub).toBe(hub);
                expect(calls).not.toContain('hub');
                hub.hide();
                calls.push('mode-end');
            },
        };
        const completion = cleanupApplication(app);
        expect(cleanupApplication(app)).toBe(completion);
        expect(app.isCleaningUp).toBe(true);
        expect(calls).toEqual(['settings', 'handlers', 'fps', 'simulation', 'raf:0']);
        await Promise.resolve();
        expect(calls.at(-1)).toBe('mode-start');
        expect(app.phaserGame).not.toBeNull();
        retire();
        await completion;
        expect(calls.slice(5)).toEqual([
            'mode-start', 'hub-hide', 'mode-end', 'modal', 'hub', 'phaser', 'theme', 'input', 'audio',
        ]);
        expect(app.phaserGame).toBeNull();
        expect(app.boardScene).toBeNull();
        expect(app.serenityHub).toBeNull();
        expect(app.isInitialized).toBe(false);
        expect(cleanupApplication(app)).toBe(completion);
    });

    it('publishes cleanup ownership before reentrant disposers and finalizes after retirement errors', async () => {
        const { app, calls } = fixture();
        let nested;
        app.settingsManager.dispose = () => {
            calls.push('settings');
            nested = cleanupApplication(app);
        };
        app.gameModeManager = { cleanup: async () => { throw new Error('mode failed'); } };
        app.themeManager.cleanup = () => { throw new Error('theme failed'); };
        const completion = cleanupApplication(app);
        expect(nested).toBe(completion);
        await expect(completion).resolves.toBeUndefined();
        expect(calls).toContain('audio');
        expect(calls).toContain('input');
        expect(console.warn).toHaveBeenCalledTimes(2);
        expect(app.isInitialized).toBe(false);
    });
});
