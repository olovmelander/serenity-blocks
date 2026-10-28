import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ThemeManager } from '../../src/themes/theme-manager.js';

// The theme manager loads the next theme in its rotation after each activation. An Odyssey orb
// plays its own theme and has no use for the rotation, so nothing is loaded while an orb holds
// the theme (Odyssey perf audit 2026-10-28: it was loaded about a second into every orb).

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

function makeManager() {
    const collection = { isUnlocked: () => true, subscribe: () => () => {} };
    const manager = new TestThemeManager(null, { themeCollection: collection, assetManager: {} });
    manager.deferAdjacentThemePreload = false;
    manager.preloadNextTheme = vi.fn(async () => {});
    return manager;
}

beforeEach(() => {
    vi.useFakeTimers();
    // Drive the timer path: fake timers do not run idle callbacks.
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.stubGlobal('cancelIdleCallback', undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the rotation preload while an Odyssey orb holds the theme', () => {
    it('loads the next rotation theme outside an orb', async () => {
        const manager = makeManager();
        manager.queueAdjacentThemePreload(10);
        await vi.advanceTimersByTimeAsync(50);
        expect(manager.preloadNextTheme).toHaveBeenCalledTimes(1);
    });

    it('loads nothing while an orb holds the theme', async () => {
        const manager = makeManager();
        manager.beginOdysseyThemeScope('ocean');
        manager.queueAdjacentThemePreload(10);
        await vi.advanceTimersByTimeAsync(5000);
        expect(manager.preloadNextTheme).not.toHaveBeenCalled();
        expect(manager.pendingAdjacentThemePreload).toBe(false);
    });

    it('drops a preload queued before the orb began', async () => {
        const manager = makeManager();
        manager.queueAdjacentThemePreload(100);
        manager.beginOdysseyThemeScope('ocean');
        await vi.advanceTimersByTimeAsync(5000);
        expect(manager.preloadNextTheme).not.toHaveBeenCalled();
    });

    it('loads again once the orb has given the theme back', async () => {
        const manager = makeManager();
        const scope = manager.beginOdysseyThemeScope('ocean');
        manager.queueAdjacentThemePreload(10);
        await manager.endOdysseyThemeScope(scope);
        manager.queueAdjacentThemePreload(10);
        await vi.advanceTimersByTimeAsync(50);
        expect(manager.preloadNextTheme).toHaveBeenCalledTimes(1);
    });

    it('a startup-deferred preload released during an orb stays unloaded', async () => {
        const manager = makeManager();
        manager.deferAdjacentThemePreload = true;
        manager.queueAdjacentThemePreload(10);
        expect(manager.pendingAdjacentThemePreload).toBe(true);
        manager.beginOdysseyThemeScope('ocean');
        manager.releaseStartupPreload(10);
        await vi.advanceTimersByTimeAsync(5000);
        expect(manager.preloadNextTheme).not.toHaveBeenCalled();
    });
});
