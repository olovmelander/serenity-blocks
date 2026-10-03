import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import { ChapterEnvironmentManager } from '../../src/rendering/odyssey/ChapterEnvironmentManager.js';
import { GameModeManager } from '../../src/core/game-modes/GameModeManager.js';

function createCanvas() {
    return {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({
            left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720,
        })),
        style: {},
        parentNode: { removeChild: vi.fn() },
    };
}

/** A controller with just enough attached for dispose() to run its full teardown. */
function createBoard() {
    const controller = new OdysseyBoardController({
        clientWidth: 1280,
        clientHeight: 720,
        getBoundingClientRect: () => ({
            left: 0, top: 0, right: 1280, bottom: 720,
        }),
    });
    controller.renderer = { domElement: createCanvas(), dispose: vi.fn() };
    controller.scene = { traverse: vi.fn() };
    controller.composer = { dispose: vi.fn() };
    controller.postProcessingStack = { dispose: vi.fn() };
    controller.environmentManager = { dispose: vi.fn(), suppressedChapters: new Set() };
    controller.pathRenderer = { dispose: vi.fn() };
    controller.nodeManager = { dispose: vi.fn() };
    return controller;
}

describe('Odyssey board dispose lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('window', {
            innerHeight: 720,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal('document', {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            body: {},
            documentElement: {},
            elementFromPoint: vi.fn(() => null),
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('ends the background render-warm sweep instead of polling forever', () => {
        const controller = createBoard();
        controller.chapterEvictionEnabled = false;

        // The sweep starts, then the board is parked for a level (not active).
        controller._startBackgroundRenderWarm();
        controller.isActive = false;
        vi.advanceTimersByTime(5000);
        // Parked: the sweep keeps one poll alive, waiting for the board to come back.
        expect(vi.getTimerCount()).toBe(1);
        expect(controller._bgRenderWarmComplete).toBe(false);

        controller.dispose();
        vi.advanceTimersByTime(60_000);

        // Disposed: the pending poll fires once, sees the flag, and nothing reschedules.
        expect(vi.getTimerCount()).toBe(0);
    });

    it('refuses every background path once disposed', () => {
        const controller = createBoard();
        controller.backgroundChapterLoadingEnabled = true;
        controller.environmentManager.loadChaptersInBackground = vi.fn();
        const { environmentManager } = controller;

        controller.dispose();

        expect(controller._canRunBackgroundTask()).toBe(false);

        controller.prewarmQueue.push(3);
        controller._schedulePrewarmDrain(10);
        expect(controller.prewarmDrainTimer).toBeFalsy();

        controller.environmentManager = environmentManager;
        controller.startDeferredBackgroundLoading();
        controller.startDeferredBackgroundLoading({ delayMs: 100 });
        expect(environmentManager.loadChaptersInBackground).not.toHaveBeenCalled();

        expect(vi.getTimerCount()).toBe(0);
    });

    it('cannot be reactivated after dispose', () => {
        const controller = createBoard();
        controller.camera = {};
        controller.clock = { getDelta: vi.fn() };
        controller.animate = vi.fn();

        controller.dispose();
        // A late caller pausing then resuming must not restart the render loop.
        controller.isRenderingPaused = true;
        controller.resumeRendering();

        expect(controller.isActive).toBe(false);
        expect(controller.animate).not.toHaveBeenCalled();
    });

    it('drops a pending resize and ignores resize events after dispose', () => {
        const controller = createBoard();
        controller.onResize = vi.fn();

        controller.boundHandlers.resize();
        controller.dispose();
        vi.advanceTimersByTime(1000);
        expect(controller.onResize).not.toHaveBeenCalled();

        controller.boundHandlers.resize(); // a stray event after teardown
        vi.advanceTimersByTime(1000);
        expect(controller.onResize).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('still debounces resize on a live board', () => {
        const controller = createBoard();
        controller.onResize = vi.fn();

        controller.boundHandlers.resize();
        controller.boundHandlers.resize();
        vi.advanceTimersByTime(150);

        expect(controller.onResize).toHaveBeenCalledTimes(1);
    });
});

describe('ChapterEnvironmentManager dispose lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function makeManager() {
        const manager = Object.create(ChapterEnvironmentManager.prototype);
        manager.environments = new Map();
        manager.suppressedChapters = new Set();
        manager.cameraProgress = 0;
        manager.updateVisibility = vi.fn();
        return manager;
    }

    it('stops the background chapter loader when disposed mid-chain', async () => {
        const manager = makeManager();
        manager.createChapterEnvironment = vi.fn(async () => null);
        const onEnvironmentCreated = vi.fn();

        manager.loadChaptersInBackground([], { canRunTask: () => true, onEnvironmentCreated });
        await vi.advanceTimersByTimeAsync(560 + 1); // initial delay + first slot
        expect(manager.createChapterEnvironment).toHaveBeenCalledTimes(1);

        manager._disposed = true; // what dispose() sets
        await vi.advanceTimersByTimeAsync(60_000);

        expect(manager.createChapterEnvironment).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops a loader that is waiting on a gate that will never open again', async () => {
        const manager = makeManager();
        manager.createChapterEnvironment = vi.fn(async () => null);

        // A disposed board's gate returns false forever; the loader used to retry every 60 ms.
        manager.loadChaptersInBackground([], { canRunTask: () => false });
        await vi.advanceTimersByTimeAsync(2000);
        expect(vi.getTimerCount()).toBe(1);

        manager._disposed = true;
        await vi.advanceTimersByTimeAsync(60_000);

        expect(manager.createChapterEnvironment).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('builds nothing into a disposed manager', async () => {
        const manager = makeManager();
        manager._disposed = true;

        await expect(manager.createChapterEnvironment(6)).resolves.toBeNull();

        expect(manager.environments.size).toBe(0);
    });
});

describe('GameModeManager failed activation', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function createMode(id, onActivate) {
        const mode = {
            getDisplayName: () => id,
            getModeId: () => id,
            isActive: false,
            isRunning: false,
            onActivate: vi.fn(),
            onDeactivate: vi.fn(async () => { mode.isActive = false; }),
        };
        mode.onActivate.mockImplementation(() => onActivate(mode));
        return mode;
    }

    it('does not clear the mode the player switched to when a slower activation fails', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const manager = new GameModeManager({});
        let failSlowActivation;
        const slow = createMode('odyssey', () => new Promise((_resolve, reject) => {
            failSlowActivation = reject;
        }));
        const next = createMode('online', async (mode) => { mode.isActive = true; });
        manager.registerMode(slow);
        manager.registerMode(next);

        // Odyssey is still building its board when the player accepts an invite.
        const slowActivation = manager.activateMode('odyssey');
        await manager.activateMode('online');
        expect(manager.currentMode).toBe(next);

        // The abandoned Odyssey build then fails.
        failSlowActivation(new Error('board build abandoned'));
        await expect(slowActivation).rejects.toThrow('board build abandoned');

        expect(manager.currentMode).toBe(next);
        expect(manager.currentModeId).toBe('online');
    });

    it('still clears a mode whose own activation fails', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const manager = new GameModeManager({});
        manager.registerMode(createMode('broken', async () => { throw new Error('nope'); }));

        await expect(manager.activateMode('broken')).rejects.toThrow('nope');

        expect(manager.currentMode).toBeNull();
        expect(manager.currentModeId).toBeNull();
    });
});
