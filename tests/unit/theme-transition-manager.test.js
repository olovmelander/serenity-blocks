import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { ThemeTransitionManager } from '../../src/core/odyssey/ThemeTransitionManager.js';

function createThemeManagerStub(overrides = {}) {
    return {
        loadTheme: vi.fn().mockResolvedValue({}),
        switchTheme: vi.fn().mockResolvedValue(),
        resumeThemes: vi.fn().mockResolvedValue(),
        waitForThemeReady: vi.fn().mockResolvedValue(true),
        themeInstances: new Map(),
        themesSuspended: false,
        activeThemeName: null,
        activeTheme: null,
        ...overrides,
    };
}

function createRafHarness() {
    const queue = [];

    return {
        requestAnimationFrame: vi.fn((callback) => {
            queue.push(callback);
            return queue.length;
        }),
        flushAll() {
            while (queue.length > 0) {
                const callbacks = queue.splice(0, queue.length);
                callbacks.forEach((callback) => callback());
            }
        },
    };
}

async function flushRafHarness(harness, cycles = 3) {
    for (let index = 0; index < cycles; index += 1) {
        harness.flushAll();
        // Allow async readiness code to queue the next RAF stage.
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

describe('ThemeTransitionManager', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('defers low-priority prefetch until idle time', async () => {
        let idleCallback = null;
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelector: vi.fn(() => null),
        });
        vi.stubGlobal('requestIdleCallback', vi.fn((callback) => {
            idleCallback = callback;
            return 9;
        }));
        vi.stubGlobal('cancelIdleCallback', vi.fn());

        const themeManager = createThemeManagerStub();
        const manager = new ThemeTransitionManager(themeManager);

        const prefetchPromise = manager.prefetchLevelTheme({
            theme: { primary: 'forest' },
        }, { priority: 'low' });

        expect(themeManager.loadTheme).not.toHaveBeenCalled();

        idleCallback?.();
        await expect(prefetchPromise).resolves.toBe(true);
        expect(themeManager.loadTheme).toHaveBeenCalledWith('forest', true);
    });

    it('upgrades an existing low-priority prefetch to high priority immediately', async () => {
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelector: vi.fn(() => null),
        });
        vi.stubGlobal('requestIdleCallback', vi.fn(() => 17));
        vi.stubGlobal('cancelIdleCallback', vi.fn());

        const themeManager = createThemeManagerStub();
        const manager = new ThemeTransitionManager(themeManager);

        const lowPriority = manager.prefetchLevelTheme({
            theme: { primary: 'forest' },
        }, { priority: 'low' });
        const highPriority = manager.prefetchLevelTheme({
            theme: { primary: 'forest' },
        }, { priority: 'high' });

        expect(globalThis.cancelIdleCallback).toHaveBeenCalledWith(17);
        expect(themeManager.loadTheme).toHaveBeenCalledTimes(1);
        await expect(lowPriority).resolves.toBe(true);
        await expect(highPriority).resolves.toBe(true);
    });

    it('waits for the active theme container and critical-ready hook before resolving', async () => {
        const rafHarness = createRafHarness();
        const themeContainer = {
            classList: {
                contains: vi.fn((className) => className === 'active'),
            },
        };
        vi.stubGlobal('document', {
            getElementById: vi.fn((id) => {
                if (id === 'theme-transition-overlay') {
                    return null;
                }
                if (id === 'forest-theme') {
                    return themeContainer;
                }
                return null;
            }),
            querySelector: vi.fn(() => null),
        });
        vi.stubGlobal('requestAnimationFrame', rafHarness.requestAnimationFrame);

        const whenCriticalReady = vi.fn().mockResolvedValue(true);
        const themeManager = createThemeManagerStub({
            activeThemeName: 'forest',
            activeTheme: {
                isActive: true,
                whenCriticalReady,
            },
        });
        const manager = new ThemeTransitionManager(themeManager);

        const readinessPromise = manager.waitForThemeCriticalReady({
            theme: { primary: 'forest' },
        }, 500);

        await flushRafHarness(rafHarness, 4);

        await expect(readinessPromise).resolves.toBe(true);
        expect(whenCriticalReady).toHaveBeenCalledTimes(1);
    });

    it('treats full readiness as satisfied when no explicit full-ready hook exists', async () => {
        const rafHarness = createRafHarness();
        const themeContainer = {
            classList: {
                contains: vi.fn((className) => className === 'active'),
            },
        };
        vi.stubGlobal('document', {
            getElementById: vi.fn((id) => {
                if (id === 'theme-transition-overlay') {
                    return null;
                }
                if (id === 'forest-theme') {
                    return themeContainer;
                }
                return null;
            }),
            querySelector: vi.fn(() => null),
        });
        vi.stubGlobal('requestAnimationFrame', rafHarness.requestAnimationFrame);

        const whenCriticalReady = vi.fn().mockResolvedValue(true);
        const themeManager = createThemeManagerStub({
            activeThemeName: 'forest',
            activeTheme: {
                isActive: true,
                whenCriticalReady,
            },
        });
        const manager = new ThemeTransitionManager(themeManager);

        const readinessPromise = manager.waitForThemeFullReady({
            theme: { primary: 'forest' },
        }, 500);

        await flushRafHarness(rafHarness, 4);

        await expect(readinessPromise).resolves.toBe(true);
        expect(whenCriticalReady).toHaveBeenCalledTimes(1);
    });
});
