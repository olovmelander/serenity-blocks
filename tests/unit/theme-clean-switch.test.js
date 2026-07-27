import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

class TestTheme extends BaseTheme {
    constructor() {
        super('test-theme');
    }

    async createScene() {
        return undefined;
    }
}

describe('theme clean switch lifecycle', () => {
    afterEach(() => {
        vi.useRealTimers();
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

    it('base stop still sweeps tracked work when the theme is already inactive', () => {
        const cancelAnimationFrame = vi.fn();
        const clearInterval = vi.fn();
        const clearTimeout = vi.fn();
        const removeEventListener = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
        vi.stubGlobal('clearInterval', clearInterval);
        vi.stubGlobal('clearTimeout', clearTimeout);
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });

        const target = { removeEventListener };
        const handler = vi.fn();
        const theme = new TestTheme();
        theme.isActive = false;
        theme.isPaused = false;
        theme.lifecycleState = 'failed';
        theme.animationFrameId = 11;
        theme._intervals = [12];
        theme._timeouts = [13];
        theme._eventListeners = [{
            target,
            event: 'pointermove',
            handler,
            options: { passive: true },
        }];

        theme.stop();

        expect(cancelAnimationFrame).toHaveBeenCalledWith(11);
        expect(clearInterval).toHaveBeenCalledWith(12);
        expect(clearTimeout).toHaveBeenCalledWith(13);
        expect(removeEventListener).toHaveBeenCalledWith(
            'pointermove',
            handler,
            { passive: true },
        );
        expect(theme.lifecycleState).toBe('stopped');
    });

    it('does not let a stale async start publish a running theme after stop', async () => {
        let finishScene;
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });

        const theme = new TestTheme();
        theme.createScene = () => new Promise((resolve) => {
            finishScene = resolve;
        });
        const start = theme.start({ loadTheme: vi.fn() }, {});
        theme.stop();
        finishScene();

        await expect(start).resolves.toBe(false);
        expect(theme.isActive).toBe(false);
        expect(theme.lifecycleState).toBe('stopped');
        expect(theme.hasStarted).toBe(false);
    });

    it('serializes overlapping starts so an older continuation cannot overwrite the newer runtime', async () => {
        let finishFirstScene;
        let sceneAttempt = 0;
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });

        const theme = new TestTheme();
        const staleRenderer = {
            dispose: vi.fn(),
            domElement: null,
        };
        const newerRenderer = {
            dispose: vi.fn(),
            domElement: null,
        };
        theme.createScene = () => {
            sceneAttempt += 1;
            if (sceneAttempt === 1) {
                return new Promise((resolve) => {
                    finishFirstScene = () => {
                        theme.renderer = staleRenderer;
                        resolve();
                    };
                });
            }
            theme.renderer = newerRenderer;
            return Promise.resolve();
        };

        const firstStart = theme.start({ loadTheme: vi.fn() }, {});
        const secondStart = theme.start({ loadTheme: vi.fn() }, {});
        await Promise.resolve();

        expect(sceneAttempt).toBe(1);
        finishFirstScene();
        await expect(firstStart).resolves.toBeUndefined();
        await expect(secondStart).resolves.toBeUndefined();

        expect(sceneAttempt).toBe(2);
        expect(theme.lifecycleState).toBe('running');
        expect(theme.isActive).toBe(true);
        expect(theme.renderer).toBe(newerRenderer);
        expect(staleRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(newerRenderer.dispose).not.toHaveBeenCalled();
    });

    it('queues context recovery behind an in-flight start and publishes only the recovery runtime', async () => {
        let finishInitialScene;
        let sceneAttempt = 0;
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });
        const sharedRenderer = {
            canvas: {},
            loadTheme: vi.fn(),
        };
        const staleRenderer = {
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(),
            domElement: null,
        };
        const recoveredRenderer = {
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(),
            domElement: null,
        };
        const theme = new TestTheme();
        theme.createScene = vi.fn(async () => {
            sceneAttempt += 1;
            if (sceneAttempt === 1) {
                await new Promise((resolve) => {
                    finishInitialScene = () => {
                        theme.renderer = staleRenderer;
                        resolve();
                    };
                });
                return;
            }
            theme.renderer = recoveredRenderer;
        });

        const initialStart = theme.start(sharedRenderer, {});
        await vi.waitFor(() => expect(finishInitialScene).toBeTypeOf('function'));
        eventBus.emit(EVENTS.CONTEXT_RESTORED, {
            type: 'webgl',
            canvas: sharedRenderer.canvas,
        });

        finishInitialScene();
        await initialStart;
        await vi.waitFor(() => {
            expect(sceneAttempt).toBe(2);
            expect(theme.lifecycleState).toBe('running');
        });

        expect(theme.renderer).toBe(recoveredRenderer);
        expect(theme.lifecycleState).toBe('running');
        expect(staleRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(recoveredRenderer.dispose).not.toHaveBeenCalled();

        theme.cleanup();
    });

    it('keeps a stale renderer fallback bound to its original start generation', async () => {
        let finishFirstInit;
        let sceneAttempt = 0;
        let staleFallback = null;
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });
        const makeRenderer = (init) => ({
            init: vi.fn(init),
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(),
            forceContextLoss: vi.fn(),
            domElement: null,
        });
        const firstCandidate = makeRenderer(() => new Promise((resolve) => {
            finishFirstInit = resolve;
        }));
        const secondCandidate = makeRenderer(async () => {});
        const theme = new TestTheme();
        theme.createScene = async (ownerGeneration) => {
            sceneAttempt += 1;
            const attempt = sceneAttempt;
            const candidate = attempt === 1 ? firstCandidate : secondCandidate;
            try {
                await theme.initializeRendererCandidate(candidate, {
                    label: `candidate ${attempt}`,
                    ownerGeneration,
                });
                if (ownerGeneration === theme.lifecycleGeneration && theme.isActive) {
                    theme.renderer = candidate;
                }
            } catch (error) {
                const fallback = makeRenderer(async () => {});
                if (attempt === 1) staleFallback = fallback;
                await theme.initializeRendererCandidate(fallback, {
                    label: `fallback ${attempt}`,
                    ownerGeneration,
                });
                if (ownerGeneration === theme.lifecycleGeneration && theme.isActive) {
                    theme.renderer = fallback;
                }
            }
        };

        const firstStart = theme.start({ loadTheme: vi.fn() }, {});
        await vi.waitFor(() => expect(firstCandidate.init).toHaveBeenCalledTimes(1));
        theme.stop();
        const secondStart = theme.start({ loadTheme: vi.fn() }, {});

        finishFirstInit();
        await expect(firstStart).resolves.toBe(false);
        await expect(secondStart).resolves.toBeUndefined();

        expect(staleFallback).not.toBeNull();
        expect(staleFallback.dispose).toHaveBeenCalled();
        expect(theme.renderer).toBe(secondCandidate);
        expect(secondCandidate.dispose).not.toHaveBeenCalled();
        expect(theme.lifecycleState).toBe('running');
    });

    it('sweeps resources created after terminal cleanup by a late async start', async () => {
        let finishScene;
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });

        const theme = new TestTheme();
        const lateRenderer = { dispose: vi.fn(), domElement: null };
        theme.createScene = () => new Promise((resolve) => {
            finishScene = () => {
                theme.renderer = lateRenderer;
                resolve();
            };
        });
        const releaseManagedGpuResources = vi.spyOn(
            theme,
            'releaseManagedGpuResources',
        );

        const start = theme.start({ loadTheme: vi.fn() }, {});
        theme.cleanup();
        finishScene();

        await expect(start).resolves.toBe(false);
        expect(releaseManagedGpuResources).toHaveBeenCalledTimes(1);
        expect(lateRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(theme.renderer).toBeNull();
        expect(theme.cleanupComplete).toBe(true);
        expect(theme.isActive).toBe(false);
    });

    it('retires partial GPU resources after a current start failure and allows a clean retry', async () => {
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });
        const partialRenderer = {
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(),
            forceContextLoss: vi.fn(),
            domElement: null,
        };
        const theme = new TestTheme();
        theme.createScene = vi.fn(async () => {
            theme.renderer = partialRenderer;
            throw new Error('scene build failed');
        });

        await expect(theme.start({ loadTheme: vi.fn() }, {})).rejects.toThrow(
            'scene build failed',
        );

        expect(partialRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(theme.renderer).toBeNull();
        expect(theme.isActive).toBe(false);
        expect(theme.lifecycleState).toBe('failed');
        expect(theme.cleanupComplete).toBe(false);

        theme.createScene = vi.fn(async () => {});
        await expect(theme.start({ loadTheme: vi.fn() }, {})).resolves.toBeUndefined();
        expect(theme.lifecycleState).toBe('running');
        expect(theme.isActive).toBe(true);
    });

    it('reports a failed context rebuild after retiring its partial runtime', async () => {
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });
        const sharedRenderer = {
            canvas: {},
            loadTheme: vi.fn(),
        };
        const onRuntimeFailure = vi.fn();
        const partialRenderer = {
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(),
            forceContextLoss: vi.fn(),
            domElement: null,
        };
        const theme = new TestTheme();
        await theme.start(sharedRenderer, { onRuntimeFailure });
        theme.createScene = vi.fn(async () => {
            theme.renderer = partialRenderer;
            throw new Error('restore failed');
        });

        eventBus.emit(EVENTS.CONTEXT_RESTORED, {
            type: 'webgl',
            canvas: sharedRenderer.canvas,
        });

        await vi.waitFor(() => expect(onRuntimeFailure).toHaveBeenCalledTimes(1));
        expect(onRuntimeFailure.mock.calls[0][0].message).toBe('restore failed');
        expect(partialRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(theme.renderer).toBeNull();
        expect(theme.lifecycleState).toBe('failed');

        theme.cleanup();
    });

    it('re-disposes a renderer whose non-abortable init settles after timeout', async () => {
        vi.useFakeTimers();
        let finishInit;
        const renderer = {
            init: vi.fn(() => new Promise((resolve) => {
                finishInit = resolve;
            })),
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(),
            forceContextLoss: vi.fn(),
            domElement: null,
        };
        const theme = new TestTheme();

        const initOutcome = theme.initializeRendererCandidate(renderer, {
            timeoutMs: 25,
            label: 'test renderer init',
        }).catch((error) => error);
        await vi.advanceTimersByTimeAsync(25);

        const timeoutError = await initOutcome;
        expect(timeoutError.message).toContain('timed out');
        expect(renderer.dispose).toHaveBeenCalledTimes(1);

        finishInit();
        await vi.advanceTimersByTimeAsync(0);

        expect(renderer.dispose).toHaveBeenCalledTimes(2);
        expect(renderer.setAnimationLoop).toHaveBeenCalledWith(null);
    });

    it('preserves the renderer init error when canvas detachment throws', async () => {
        const renderer = {
            init: vi.fn(async () => {
                throw new Error('backend init failed');
            }),
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(),
            forceContextLoss: vi.fn(),
            domElement: {
                parentNode: {
                    removeChild: vi.fn(() => {
                        throw new Error('detachment failed');
                    }),
                },
            },
        };
        const theme = new TestTheme();

        await expect(theme.initializeRendererCandidate(renderer, {
            label: 'hostile renderer',
        })).rejects.toThrow('backend init failed');
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it('routes context restoration through the fenced start lifecycle', async () => {
        let finishRestore;
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });
        const sharedRenderer = {
            canvas: {},
            loadTheme: vi.fn(),
        };
        const lateRenderer = {
            dispose: vi.fn(),
            domElement: null,
        };
        const theme = new TestTheme();
        await theme.start(sharedRenderer, {});
        theme.createScene = () => new Promise((resolve) => {
            finishRestore = () => {
                theme.renderer = lateRenderer;
                resolve();
            };
        });

        eventBus.emit(EVENTS.CONTEXT_RESTORED, {
            type: 'webgl',
            canvas: sharedRenderer.canvas,
        });
        await vi.waitFor(() => expect(finishRestore).toBeTypeOf('function'));
        theme.cleanup();
        finishRestore();
        await vi.waitFor(() => expect(lateRenderer.dispose).toHaveBeenCalled());

        expect(theme.cleanupComplete).toBe(true);
        expect(theme.lifecycleState).toBe('stopped');
        expect(theme.isActive).toBe(false);
        expect(theme.renderer).toBeNull();
    });

    it('retains registry-owned shell containers during terminal cleanup', () => {
        const removeChild = vi.fn();
        const removeClass = vi.fn();
        const removeProperty = vi.fn();
        vi.stubGlobal('document', {
            getElementById: vi.fn(() => null),
            querySelectorAll: vi.fn(() => []),
        });

        const container = {
            dataset: { themeRegistryOwned: 'true' },
            parentNode: { removeChild },
            classList: { remove: removeClass },
            style: { removeProperty },
        };
        const theme = new TestTheme();
        theme.containers = [container];
        theme.isActive = true;
        theme.lifecycleState = 'running';

        theme.cleanup();

        expect(removeChild).not.toHaveBeenCalled();
        expect(removeClass).toHaveBeenCalledWith('active');
        expect(theme.containers).toEqual([]);
    });

    it('fully activates a stopped pending theme instead of falsely quick-resuming it', async () => {
        const manager = new TestThemeManager(
            { clearThemeResources: vi.fn() },
            { assetManager: {}, audioManager: null },
        );
        const stoppedTheme = {
            name: 'forest',
            hasStarted: true,
            isActive: false,
            isPaused: false,
            lifecycleState: 'stopped',
            resume: vi.fn(() => true),
        };
        manager.themesSuspended = true;
        manager.activeTheme = null;
        manager.activeThemeName = 'forest';
        manager.pendingThemeInstance = stoppedTheme;
        manager.pendingThemeName = 'forest';
        manager.themeInstances.set('forest', stoppedTheme);
        manager.activateThemeInstance = vi.fn(async () => {});

        await manager.resumeThemes();

        expect(stoppedTheme.resume).not.toHaveBeenCalled();
        expect(manager.activateThemeInstance).toHaveBeenCalledWith(
            stoppedTheme,
            'forest',
        );
    });
});
