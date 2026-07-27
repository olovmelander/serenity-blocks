import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';
import {
    resolveThemeStartupPolicy,
    ThemeManager,
} from '../../src/themes/theme-manager.js';
import { getThemeMeta } from '../../src/themes/theme-registry.js';

describe('theme startup policy', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('keeps packaged Windows startup on a single cached theme until startup is complete', () => {
        const runtimeConfig = {
            platform: 'win32',
            isPackaged: true,
            windowsProfile: 'webParity',
            safeMode: false,
        };

        expect(resolveThemeStartupPolicy(runtimeConfig, {
            startupComplete: false,
        })).toEqual({
            maxCachedThemes: 1,
            deferAdjacentThemePreload: true,
            preserveSuspendedRuntime: false,
        });

        expect(resolveThemeStartupPolicy(runtimeConfig, {
            startupComplete: true,
        })).toEqual({
            maxCachedThemes: 2,
            deferAdjacentThemePreload: false,
            preserveSuspendedRuntime: true,
        });
    });

    it('keeps safe mode in the strict startup policy even after startup completes', () => {
        const runtimeConfig = {
            platform: 'win32',
            isPackaged: true,
            windowsProfile: 'baseline',
            safeMode: true,
        };

        expect(resolveThemeStartupPolicy(runtimeConfig, {
            startupComplete: true,
        })).toEqual({
            maxCachedThemes: 1,
            deferAdjacentThemePreload: true,
            preserveSuspendedRuntime: false,
        });
    });

    it('exposes declarative startup metadata for theme registry entries', () => {
        expect(getThemeMeta('forest')).toMatchObject({
            performanceClass: 'light',
            startupEligible: true,
        });
        expect(getThemeMeta('black-hole')).toMatchObject({
            performanceClass: 'heavy',
            startupEligible: false,
        });
    });

    it('keeps shared resources through eviction and releases them on terminal cleanup', async () => {
        const disposeSharedResources = vi.fn();
        class SharedResourceTheme {
            static disposeSharedResources() {
                disposeSharedResources();
            }

            constructor() {
                this.init = vi.fn(async () => {});
                this.cleanup = vi.fn();
            }
        }
        const renderer = {
            cleanup: vi.fn(),
            clearThemeResources: vi.fn(),
        };
        const manager = new ThemeManager(renderer, {
            assetManager: {},
        });
        manager.themeRegistry = new Map([
            ['stillwater', async () => ({ default: SharedResourceTheme })],
        ]);

        const theme = await manager.loadTheme('stillwater', true);
        manager.disposeThemeInstance(theme, 'stillwater', {
            removeFromCache: true,
        });

        expect(theme.cleanup).toHaveBeenCalledTimes(1);
        expect(disposeSharedResources).not.toHaveBeenCalled();

        manager.cleanup();
        expect(disposeSharedResources).toHaveBeenCalledTimes(1);
        expect(renderer.cleanup).toHaveBeenCalledTimes(1);

        manager.cleanup();
        expect(disposeSharedResources).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent loads of the same theme instance', async () => {
        let resolveInit;
        let constructionCount = 0;
        function DeferredTheme() {
            constructionCount += 1;
            this.name = 'forest';
            this.cleanup = vi.fn();
        }
        DeferredTheme.prototype.init = () => new Promise((resolve) => {
            resolveInit = resolve;
        });
        const importer = vi.fn(async () => ({ default: DeferredTheme }));
        const manager = new ThemeManager(
            { clearThemeResources: vi.fn(), cleanup: vi.fn() },
            { assetManager: {} },
        );
        manager.themeRegistry = new Map([['forest', importer]]);

        const first = manager.loadTheme('forest', true);
        const second = manager.loadTheme('forest', true);
        await vi.waitFor(() => expect(resolveInit).toBeTypeOf('function'));
        resolveInit();

        const [firstTheme, secondTheme] = await Promise.all([first, second]);
        expect(firstTheme).toBe(secondTheme);
        expect(importer).toHaveBeenCalledTimes(1);
        expect(constructionCount).toBe(1);
        manager.cleanup();
    });

    it('does not disguise a missing requested theme as a forest instance', async () => {
        const forestImporter = vi.fn();
        const manager = new ThemeManager(
            { clearThemeResources: vi.fn() },
            { assetManager: {} },
        );
        manager.themeRegistry = new Map([['forest', forestImporter]]);

        await expect(manager.loadTheme('ocean', true)).rejects.toThrow(
            'Theme "ocean" not found in registry',
        );
        expect(forestImporter).not.toHaveBeenCalled();
    });

    it('terminal cleanup disposes a shared active/pending/cache identity once', () => {
        const theme = {
            name: 'forest',
            cleanup: vi.fn(),
        };
        const renderer = {
            clearThemeResources: vi.fn(),
            cleanup: vi.fn(),
        };
        const manager = new ThemeManager(renderer, { assetManager: {} });
        manager.activeTheme = theme;
        manager.activeThemeName = 'forest';
        manager.pendingThemeInstance = theme;
        manager.pendingThemeName = 'forest';
        manager.themeInstances.set('forest', theme);

        manager.cleanup();
        manager.cleanup();

        expect(theme.cleanup).toHaveBeenCalledTimes(1);
        expect(renderer.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.activeTheme).toBeNull();
        expect(manager.pendingThemeInstance).toBeNull();
    });

    it('runs the forced safety sweep when bespoke cleanup throws', () => {
        const renderer = {
            clearThemeResources: vi.fn(),
        };
        const manager = new ThemeManager(renderer, { assetManager: {} });
        const theme = {
            name: 'forest',
            cleanup: vi.fn(() => {
                throw new Error('custom cleanup failed');
            }),
            stop: vi.fn(),
            cancelAnimationFrames: vi.fn(),
            clearTrackedResources: vi.fn(),
            clearEventUnsubscribers: vi.fn(),
            removeCommonResizeHandlers: vi.fn(),
            removeRendererResilience: vi.fn(),
            releaseManagedGpuResources: vi.fn(),
        };
        manager.activeTheme = theme;
        manager.activeThemeName = 'forest';

        manager.disposeThemeInstance(theme, 'forest');

        expect(theme.stop).toHaveBeenCalledTimes(1);
        expect(theme.cancelAnimationFrames).toHaveBeenCalledTimes(1);
        expect(theme.clearTrackedResources).toHaveBeenCalledTimes(1);
        expect(theme.clearEventUnsubscribers).toHaveBeenCalledTimes(1);
        expect(theme.removeCommonResizeHandlers).toHaveBeenCalledTimes(1);
        expect(theme.removeRendererResilience).toHaveBeenCalledTimes(1);
        expect(theme.releaseManagedGpuResources).toHaveBeenCalledTimes(1);
        expect(theme.cleanupComplete).toBe(true);
        expect(theme.lifecycleState).toBe('stopped');
        expect(renderer.clearThemeResources).toHaveBeenCalledTimes(1);
    });

    it('does not clear the active renderer when evicting an init-only cached theme', () => {
        const renderer = {
            clearThemeResources: vi.fn(),
        };
        const manager = new ThemeManager(renderer, { assetManager: {} });
        const activeTheme = { name: 'forest' };
        const cachedTheme = {
            name: 'ocean',
            cleanup: vi.fn(),
        };
        manager.activeTheme = activeTheme;
        manager.activeThemeName = 'forest';
        manager.themeInstances.set('forest', activeTheme);
        manager.themeInstances.set('ocean', cachedTheme);

        manager.disposeThemeInstance(cachedTheme, 'ocean', {
            removeFromCache: true,
        });

        expect(cachedTheme.cleanup).toHaveBeenCalledTimes(1);
        expect(renderer.clearThemeResources).not.toHaveBeenCalled();
        expect(manager.activeTheme).toBe(activeTheme);
    });

    it('reaps resources allocated when a timed-out init settles late', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });

        let finishInit;
        let candidate;
        const lateRenderer = {
            dispose: vi.fn(),
            domElement: null,
            setAnimationLoop: vi.fn(),
        };
        class LateInitTheme extends BaseTheme {
            constructor() {
                super('forest');
                candidate = this;
            }

            async init() {
                await new Promise((resolve) => {
                    finishInit = resolve;
                });
                this.renderer = lateRenderer;
            }

            async createScene() {}
        }

        const manager = new ThemeManager(
            { clearThemeResources: vi.fn() },
            { assetManager: {} },
        );
        manager.themeRegistry = new Map([
            ['forest', async () => ({ default: LateInitTheme })],
        ]);

        const load = manager.loadTheme('forest', true);
        const loadOutcome = load.then(
            () => null,
            (error) => error,
        );
        await vi.waitFor(() => expect(finishInit).toBeTypeOf('function'));
        await vi.advanceTimersByTimeAsync(10_001);
        await expect(loadOutcome).resolves.toMatchObject({
            message: expect.stringContaining('Theme "forest" init timed out'),
        });

        finishInit();
        await vi.waitFor(() => expect(lateRenderer.dispose).toHaveBeenCalledTimes(1));

        expect(candidate.cleanupComplete).toBe(true);
        expect(candidate.renderer).toBeNull();
        expect(candidate.isActive).toBe(false);
        expect(manager.themeInstances.has('forest')).toBe(false);
    });
});
