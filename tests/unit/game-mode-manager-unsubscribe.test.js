import {
    describe, expect, it, vi,
} from 'vitest';
import { GameModeManager } from '../../src/core/game-modes/GameModeManager.js';

/**
 * A theme keeps the unsubscribers `on()` hands it and runs them when it is torn down, which can be
 * after the manager has cleaned up (a page unload): the manager's handlers are gone by then. Found
 * 2026-10-20 as "[BaseTheme] Failed to unsubscribe runtime event … reading 'indexOf'" in the
 * Cosmic Noir in-game probe.
 */
describe('GameModeManager unsubscribe', () => {
    it('removes the handler, and is a no-op twice or after the manager has cleaned up', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const manager = new GameModeManager({ themeManager: { suspendThemes: vi.fn() } });
        const handler = vi.fn();
        const off = manager.on('modeStarted', handler);
        manager._emitEvent('modeStarted', {});
        expect(handler).toHaveBeenCalledTimes(1);
        off();
        off();
        manager._emitEvent('modeStarted', {});
        expect(handler).toHaveBeenCalledTimes(1);

        const late = manager.on('modeStopped', vi.fn());
        await manager.cleanup();
        expect(() => late()).not.toThrow();
        vi.restoreAllMocks();
    });
});
