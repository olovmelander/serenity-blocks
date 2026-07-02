import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

class TestTheme extends BaseTheme {
    constructor() {
        super('test-theme');
    }

    async createScene() {}
}

describe('theme clean switch lifecycle', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('fully disposes the outgoing active theme before loading the next theme', async () => {
        const events = [];
        const renderer = {
            clearThemeResources: vi.fn(() => events.push('clear-renderer')),
        };
        const manager = new TestThemeManager(renderer, {
            assetManager: {},
            audioManager: null,
        });
        const oldTheme = {
            name: 'wolfhour',
            cleanup: vi.fn(() => events.push('cleanup-old')),
        };
        const newTheme = {
            name: 'verdant-hills',
        };

        manager.activeTheme = oldTheme;
        manager.activeThemeName = 'wolfhour';
        manager.themesSuspended = false;
        manager.themeInstances.set('wolfhour', oldTheme);
        manager.themeLRU = ['wolfhour'];
        manager.loadTheme = vi.fn(async (themeName) => {
            events.push(`load-${themeName}`);
            return newTheme;
        });
        manager.activateThemeInstance = vi.fn(async (theme, themeName) => {
            events.push(`activate-${themeName}`);
            manager.activeTheme = theme;
            manager.activeThemeName = themeName;
            manager.pendingThemeInstance = null;
            manager.pendingThemeName = null;
        });

        await manager.switchTheme('verdant-hills');

        expect(events).toEqual([
            'cleanup-old',
            'clear-renderer',
            'load-verdant-hills',
            'activate-verdant-hills',
        ]);
        expect(oldTheme.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.themeInstances.has('wolfhour')).toBe(false);
        expect(manager.themeLRU).not.toContain('wolfhour');
    });

    it('falls back if the incoming theme fails after the outgoing theme is disposed', async () => {
        const events = [];
        const renderer = {
            clearThemeResources: vi.fn(() => events.push('clear-renderer')),
        };
        const manager = new TestThemeManager(renderer, {
            assetManager: {},
            audioManager: null,
        });
        const oldTheme = {
            name: 'wolfhour',
            cleanup: vi.fn(() => events.push('cleanup-old')),
        };
        const fallbackTheme = {
            name: 'forest',
        };

        manager.activeTheme = oldTheme;
        manager.activeThemeName = 'wolfhour';
        manager.themesSuspended = false;
        manager.themeInstances.set('wolfhour', oldTheme);
        manager.themeLRU = ['wolfhour'];
        manager.loadTheme = vi.fn(async (themeName) => {
            events.push(`load-${themeName}`);
            if (themeName === 'verdant-hills') {
                throw new Error('load failed');
            }
            return fallbackTheme;
        });
        manager.activateThemeInstance = vi.fn(async (theme, themeName) => {
            events.push(`activate-${themeName}`);
            manager.activeTheme = theme;
            manager.activeThemeName = themeName;
            manager.pendingThemeInstance = null;
            manager.pendingThemeName = null;
        });

        await manager.switchTheme('verdant-hills');

        expect(events).toEqual([
            'cleanup-old',
            'clear-renderer',
            'load-verdant-hills',
            'load-forest',
            'activate-forest',
        ]);
        expect(manager.activeTheme).toBe(fallbackTheme);
        expect(manager.activeThemeName).toBe('forest');
        expect(manager.pendingThemeInstance).toBeNull();
        expect(manager.pendingThemeName).toBeNull();
    });

    it('base stop cancels common legacy animation frame handles', () => {
        const cancelAnimationFrame = vi.fn();
        const setAnimationLoop = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });

        const theme = new TestTheme();
        theme.isActive = true;
        theme.lifecycleState = 'running';
        theme.animationIds = [1, 2];
        theme.animationFrameId = 3;
        theme.animationFrame = 4;
        theme.rafId = 5;
        theme.animationId = 6;
        theme._shapeFadeRaf = 7;
        theme.renderer = { setAnimationLoop };

        theme.stop();

        expect(cancelAnimationFrame.mock.calls.map(([id]) => id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(theme.animationIds).toEqual([]);
        expect(theme.animationFrameId).toBeNull();
        expect(theme.animationFrame).toBeNull();
        expect(theme.rafId).toBeNull();
        expect(theme.animationId).toBeNull();
        expect(theme._shapeFadeRaf).toBeNull();
        expect(setAnimationLoop).toHaveBeenCalledWith(null);
    });
});
