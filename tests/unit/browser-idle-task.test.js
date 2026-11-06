import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { scheduleBrowserIdleTask } from '../../src/utils/browser-idle-task.js';

describe('browser idle task lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestIdleCallback', undefined);
        vi.stubGlobal('cancelIdleCallback', undefined);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(['synchronous', 'asynchronous'])('logs a %s failure without escaping the scheduler', async (kind) => {
        const error = new Error('startup service failed');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        scheduleBrowserIdleTask(() => {
            if (kind === 'synchronous') throw error;
            return Promise.reject(error);
        });
        await vi.runAllTimersAsync();
        expect(warn).toHaveBeenCalledWith('[Startup] Deferred task failed:', error);
    });

    it('cancels a pending fallback task', async () => {
        const task = vi.fn();
        const cancel = scheduleBrowserIdleTask(task, { delayMs: 25 });
        cancel();
        await vi.runAllTimersAsync();
        expect(task).not.toHaveBeenCalled();
    });

    it('cancels pending idle work even when the browser assigned handle zero', () => {
        const task = vi.fn();
        const cancelIdle = vi.fn();
        let runIdle;
        vi.stubGlobal('requestIdleCallback', vi.fn((callback) => { runIdle = callback; return 0; }));
        vi.stubGlobal('cancelIdleCallback', cancelIdle);
        const cancel = scheduleBrowserIdleTask(task);
        vi.runAllTimers();
        cancel();
        runIdle();
        expect(cancelIdle).toHaveBeenCalledWith(0);
        expect(task).not.toHaveBeenCalled();
    });
});
