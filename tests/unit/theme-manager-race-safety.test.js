import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { ThemeManager } from '../../src/themes/theme-manager.js';

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function makeRenderer(overrides = {}) {
    return {
        cleanup: vi.fn(),
        clearThemeResources: vi.fn(),
        loadTheme: vi.fn(),
        ...overrides,
    };
}

function makeManager(renderer = makeRenderer(), options = {}) {
    return new TestThemeManager(renderer, {
        assetManager: {},
        audioManager: null,
        ...options,
    });
}

function makeRuntimeTheme(name = 'forest') {
    return {
        name,
        hasStarted: false,
        isActive: false,
        isPaused: false,
        lifecycleGeneration: 0,
        lifecycleState: 'initialized',
        scene: { children: [] },
        camera: {},
        cleanup: vi.fn(function cleanup() {
            this.isActive = false;
            this.isPaused = false;
            this.lifecycleState = 'stopped';
            this.cleanupComplete = true;
        }),
        pause: vi.fn(function pause() {
            this.isActive = false;
            this.isPaused = true;
            this.lifecycleState = 'paused';
            return true;
        }),
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('ThemeManager lifecycle race safety', () => {
    it('invalidates async lifecycle ownership before a throwing theme cleanup override', () => {
        const clearThemeResources = vi.fn(() => {
            throw new Error('renderer clear failed');
        });
        const manager = makeManager(makeRenderer({ clearThemeResources }));
        const observedDuringCleanup = [];
        const theme = {
            name: 'forest',
            lifecycleGeneration: 7,
            lifecycleState: 'starting',
            isActive: true,
            isPaused: false,
            cleanup: vi.fn(function cleanup() {
                observedDuringCleanup.push({
                    generation: this.lifecycleGeneration,
                    isActive: this.isActive,
                    lifecycleState: this.lifecycleState,
                });
                throw new Error('bespoke cleanup failed');
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
        manager.themeInstances.set('forest', theme);
        manager.themeLRU = ['forest'];

        expect(() => manager.disposeThemeInstance(theme, 'forest', {
            removeFromCache: true,
        })).not.toThrow();

        expect(observedDuringCleanup).toEqual([{
            generation: 8,
            isActive: true,
            lifecycleState: 'stopping',
        }]);
        expect(theme.stop).toHaveBeenCalledTimes(1);
        expect(theme.cleanupComplete).toBe(true);
        expect(theme.lifecycleState).toBe('stopped');
        expect(manager.activeTheme).toBeNull();
        expect(manager.themeInstances.has('forest')).toBe(false);
        expect(clearThemeResources).toHaveBeenCalledTimes(1);
    });

    it('finishes terminal cleanup when audio, renderer clearing, and renderer cleanup throw', () => {
        const renderer = makeRenderer({
            clearThemeResources: vi.fn(() => {
                throw new Error('clear failed');
            }),
            cleanup: vi.fn(() => {
                throw new Error('renderer cleanup failed');
            }),
        });
        const audioManager = {
            stopBackgroundMusic: vi.fn(() => {
                throw new Error('audio cleanup failed');
            }),
        };
        const manager = makeManager(renderer, { audioManager });
        const theme = makeRuntimeTheme();
        theme.isActive = true;
        theme.lifecycleState = 'running';
        manager.activeTheme = theme;
        manager.activeThemeName = 'forest';
        manager.pendingThemeInstance = theme;
        manager.pendingThemeName = 'forest';
        manager.themeInstances.set('forest', theme);

        expect(() => manager.cleanup()).not.toThrow();

        expect(audioManager.stopBackgroundMusic).toHaveBeenCalledTimes(1);
        expect(theme.cleanup).toHaveBeenCalledTimes(1);
        expect(renderer.clearThemeResources).toHaveBeenCalledTimes(1);
        expect(renderer.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.themeInstances.size).toBe(0);
        expect(manager.activeTheme).toBeNull();
        expect(manager.activeThemeName).toBeNull();
        expect(manager.pendingThemeInstance).toBeNull();
        expect(manager.webglRenderer).toBeNull();
        expect(manager.isDisposed).toBe(true);
    });

    it('does not construct a theme when cleanup cancels its in-flight module import', async () => {
        const importGate = deferred();
        const construct = vi.fn();
        function ImportedAfterCleanupTheme() {
            construct();
        }
        ImportedAfterCleanupTheme.prototype.init = async () => true;
        const manager = makeManager();
        const importer = vi.fn(() => importGate.promise);
        manager.themeRegistry.set('forest', importer);

        const load = manager.loadTheme('forest', true);
        await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(1));

        manager.cleanup();
        importGate.resolve({ default: ImportedAfterCleanupTheme });

        await expect(load).rejects.toThrow('module import was cancelled');
        expect(construct).not.toHaveBeenCalled();
        expect(manager.themeInstances.size).toBe(0);
    });

    it('never constructs and self-evicts a candidate when a cap=1 cache protects the active theme', async () => {
        const construct = vi.fn();
        function OceanTheme() {
            construct();
            this.name = 'ocean';
        }
        OceanTheme.prototype.init = async () => true;
        const manager = makeManager();
        const forest = makeRuntimeTheme('forest');
        forest.isActive = true;
        forest.lifecycleState = 'running';
        manager.maxCachedThemes = 1;
        manager.activeTheme = forest;
        manager.activeThemeName = 'forest';
        manager.themeInstances.set('forest', forest);
        manager.themeLRU = ['forest'];
        const importer = vi.fn(async () => ({ default: OceanTheme }));
        manager.themeRegistry.set('ocean', importer);

        await expect(manager.loadTheme('ocean', true)).rejects.toThrow(
            'Theme cache has no safe capacity',
        );

        expect(importer).not.toHaveBeenCalled();
        expect(construct).not.toHaveBeenCalled();
        expect(manager.activeTheme).toBe(forest);
        expect(manager.themeInstances.get('forest')).toBe(forest);
        expect(manager.themeInstances.has('ocean')).toBe(false);
    });

    it('cancels and reaps a prewarm whose asynchronous start times out', async () => {
        vi.useFakeTimers();
        const startGate = deferred();
        const theme = makeRuntimeTheme();
        theme.start = vi.fn(function start() {
            const startGeneration = ++this.lifecycleGeneration;
            this.isActive = true;
            this.lifecycleState = 'starting';
            return startGate.promise.then(() => {
                if (startGeneration !== this.lifecycleGeneration || !this.isActive) {
                    this.lifecycleState = 'stopped';
                    return false;
                }
                this.hasStarted = true;
                this.lifecycleState = 'running';
                return true;
            });
        });
        const manager = makeManager();
        manager.themesSuspended = true;
        manager.themeInstances.set('forest', theme);
        manager.themeLRU = ['forest'];
        manager.loadTheme = vi.fn(async () => theme);

        const prewarm = manager.prewarmTheme('forest', {
            maxWarmMs: 0,
            postWarmFrames: 0,
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(theme.lifecycleState).toBe('starting');

        await vi.advanceTimersByTimeAsync(10_001);
        await expect(prewarm).resolves.toBe(false);

        expect(theme.cleanup).toHaveBeenCalledTimes(1);
        expect(theme.isActive).toBe(false);
        expect(theme.lifecycleState).toBe('stopped');
        expect(manager.themeInstances.has('forest')).toBe(false);
        expect(manager.pendingThemeInstance).toBeNull();
        expect(manager.isTransitioning).toBe(false);

        startGate.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(theme.isActive).toBe(false);
        expect(theme.lifecycleState).toBe('stopped');
    });

    it('bounds a missing animation frame and disposes the abandoned prewarm', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        const theme = makeRuntimeTheme();
        theme.start = vi.fn(async function start() {
            this.hasStarted = true;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        const manager = makeManager();
        manager.themesSuspended = true;
        manager.themeInstances.set('forest', theme);
        manager.themeLRU = ['forest'];
        manager.loadTheme = vi.fn(async () => theme);

        const prewarm = manager.prewarmTheme('forest', {
            maxWarmMs: 5_000,
            postWarmFrames: 0,
        });
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1_001);

        await expect(prewarm).resolves.toBe(false);
        expect(theme.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.themeInstances.has('forest')).toBe(false);
        expect(manager.isTransitioning).toBe(false);
    });

    it('bounds final shader compilation and then drains a queued user switch', async () => {
        vi.useFakeTimers();
        const compileAsync = vi.fn(() => new Promise(() => {}));
        const theme = makeRuntimeTheme();
        theme.renderer = { compileAsync };
        theme.start = vi.fn(async function start() {
            this.hasStarted = true;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        const manager = makeManager();
        manager.themesSuspended = true;
        manager.themeInstances.set('forest', theme);
        manager.themeLRU = ['forest'];
        manager.loadTheme = vi.fn(async () => theme);
        manager.performThemeSwitch = vi.fn(async (themeName) => {
            manager.activeThemeName = themeName;
            manager.activeTheme = { name: themeName };
            return themeName;
        });

        const prewarm = manager.prewarmTheme('forest', {
            maxWarmMs: 0,
            postWarmFrames: 0,
        });
        await vi.waitFor(() => expect(compileAsync).toHaveBeenCalledTimes(1));
        const switchOutcome = manager.switchTheme('ocean');

        await vi.advanceTimersByTimeAsync(3_001);

        await expect(prewarm).resolves.toBe(false);
        await expect(switchOutcome).resolves.toBe('ocean');
        expect(manager.performThemeSwitch).toHaveBeenCalledWith('ocean');
        expect(theme.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.activeThemeName).toBe('ocean');
        expect(manager.isTransitioning).toBe(false);
    });

    it('cleanup during prewarm stabilization prevents late state publication', async () => {
        let frameCallback;
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            frameCallback = callback;
            return 1;
        }));
        const theme = makeRuntimeTheme();
        theme.start = vi.fn(async function start() {
            this.hasStarted = true;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        const manager = makeManager();
        manager.themesSuspended = true;
        manager.themeInstances.set('forest', theme);
        manager.themeLRU = ['forest'];
        manager.loadTheme = vi.fn(async () => theme);

        const prewarm = manager.prewarmTheme('forest', {
            maxWarmMs: 5_000,
            postWarmFrames: 0,
        });
        await vi.waitFor(() => expect(frameCallback).toBeTypeOf('function'));

        manager.cleanup();
        frameCallback();

        await expect(prewarm).resolves.toBe(false);
        expect(theme.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.pendingThemeInstance).toBeNull();
        expect(manager.activeThemeName).toBeNull();
        expect(manager.isDisposed).toBe(true);
        expect(manager.isTransitioning).toBe(false);
    });

    it('suspension wins even when activation began while already marked suspended', async () => {
        const startGate = deferred();
        const theme = makeRuntimeTheme('ocean');
        theme.start = vi.fn(async function start() {
            this.isActive = true;
            this.lifecycleState = 'starting';
            await startGate.promise;
            // Model a legacy override that completes successfully after stop().
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        theme.stop = vi.fn(function stop() {
            this.isActive = false;
            this.isPaused = false;
            this.lifecycleState = 'stopped';
        });
        theme.releaseManagedGpuResources = vi.fn();
        const manager = makeManager();
        manager.themesSuspended = true;
        manager.pendingThemeInstance = theme;
        manager.pendingThemeName = 'ocean';
        manager.themeInstances.set('ocean', theme);
        manager.themeLRU = ['ocean'];

        const activation = manager.activateThemeInstance(theme, 'ocean');
        await vi.waitFor(() => expect(theme.lifecycleState).toBe('starting'));

        manager.suspendThemes();
        startGate.resolve();

        await expect(activation).resolves.toBe('ocean');
        expect(theme.cleanup).toHaveBeenCalledTimes(1);
        expect(theme.stop).toHaveBeenCalledTimes(1);
        expect(theme.releaseManagedGpuResources).toHaveBeenCalledTimes(1);
        expect(theme.isActive).toBe(false);
        expect(theme.lifecycleState).toBe('stopped');
        expect(manager.activeTheme).toBeNull();
        expect(manager.pendingThemeInstance).toBeNull();
        expect(manager.pendingThemeName).toBe('ocean');
        expect(manager.themeInstances.has('ocean')).toBe(false);
        expect(manager.themesSuspended).toBe(true);
    });

    it('resumes with a fresh identity so an older suspended start cannot overwrite it', async () => {
        const firstStart = deferred();
        const oldTheme = makeRuntimeTheme('ocean');
        const staleRenderer = {
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(),
            domElement: null,
        };
        oldTheme.start = vi.fn(async function start() {
            this.isActive = true;
            this.lifecycleState = 'starting';
            await firstStart.promise;
            this.renderer = staleRenderer;
            this.hasStarted = true;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        oldTheme.stop = vi.fn(function stop() {
            this.isActive = false;
            this.isPaused = false;
            this.lifecycleState = 'stopped';
        });
        oldTheme.releaseManagedGpuResources = vi.fn();
        const freshRenderer = {
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(),
            domElement: null,
        };
        const freshTheme = makeRuntimeTheme('ocean');
        freshTheme.start = vi.fn(async function start() {
            this.renderer = freshRenderer;
            this.hasStarted = true;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        const manager = makeManager();
        manager.themesSuspended = true;
        manager.pendingThemeInstance = oldTheme;
        manager.pendingThemeName = 'ocean';
        manager.themeInstances.set('ocean', oldTheme);
        manager.themeLRU = ['ocean'];
        manager.loadTheme = vi.fn(async () => {
            manager.themeInstances.set('ocean', freshTheme);
            manager.themeLRU = ['ocean'];
            return freshTheme;
        });

        const oldActivation = manager.activateThemeInstance(oldTheme, 'ocean');
        await vi.waitFor(() => expect(oldTheme.start).toHaveBeenCalledTimes(1));
        manager.suspendThemes();

        const resumedActivation = manager.resumeThemes();
        await resumedActivation;

        expect(manager.loadTheme).toHaveBeenCalledWith('ocean');
        expect(manager.activeTheme).toBe(freshTheme);
        expect(freshTheme.lifecycleState).toBe('running');
        expect(freshTheme.renderer).toBe(freshRenderer);
        expect(oldTheme.cleanup).toHaveBeenCalledTimes(1);

        firstStart.resolve();
        await oldActivation;

        expect(manager.activeTheme).toBe(freshTheme);
        expect(manager.activeThemeName).toBe('ocean');
        expect(freshTheme.isActive).toBe(true);
        expect(freshTheme.lifecycleState).toBe('running');
        expect(freshTheme.renderer).toBe(freshRenderer);
        expect(freshRenderer.dispose).not.toHaveBeenCalled();
        expect(staleRenderer.dispose).toHaveBeenCalledTimes(1);
        expect(oldTheme.renderer).toBeNull();
        expect(oldTheme.isActive).toBe(false);
    });

    it('replaces a failed active runtime with a fresh identity instead of same-name short-circuiting', async () => {
        const failedTheme = makeRuntimeTheme('forest');
        failedTheme.isActive = false;
        failedTheme.lifecycleState = 'failed';
        const freshTheme = makeRuntimeTheme('forest');
        freshTheme.start = vi.fn(async function start() {
            this.hasStarted = true;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        const manager = makeManager();
        manager.themesSuspended = false;
        manager.activeTheme = failedTheme;
        manager.activeThemeName = 'forest';
        manager.themeInstances.set('forest', failedTheme);
        manager.themeLRU = ['forest'];
        manager.loadTheme = vi.fn(async () => {
            manager.themeInstances.set('forest', freshTheme);
            manager.themeLRU = ['forest'];
            return freshTheme;
        });

        manager.handleThemeRuntimeFailure(
            failedTheme,
            'forest',
            new Error('context recovery failed'),
        );

        await vi.waitFor(() => expect(manager.activeTheme).toBe(freshTheme));
        expect(failedTheme.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.loadTheme).toHaveBeenCalledWith('forest');
        expect(freshTheme.start).toHaveBeenCalledTimes(1);
        expect(manager.activeThemeName).toBe('forest');
        expect(manager.themeInstances.get('forest')).toBe(freshTheme);
    });

    it('does not let a late resume load overwrite a newer user theme selection', async () => {
        const oceanLoad = deferred();
        const oceanTheme = makeRuntimeTheme('ocean');
        const forestTheme = makeRuntimeTheme('forest');
        forestTheme.start = vi.fn(async function start() {
            this.hasStarted = true;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        const manager = makeManager();
        manager.themesSuspended = true;
        manager.activeThemeName = 'ocean';
        manager.pendingThemeName = 'ocean';
        manager.pendingThemeInstance = null;
        manager.loadTheme = vi.fn(async (themeName) => {
            const theme = themeName === 'ocean'
                ? await oceanLoad.promise
                : forestTheme;
            manager.themeInstances.set(themeName, theme);
            if (!manager.themeLRU.includes(themeName)) {
                manager.themeLRU.push(themeName);
            }
            return theme;
        });

        const staleResume = manager.resumeThemes();
        await vi.waitFor(() => expect(manager.loadTheme).toHaveBeenCalledWith('ocean'));

        await expect(manager.switchTheme('forest')).resolves.toBe('forest');
        expect(manager.pendingThemeInstance).toBe(forestTheme);
        expect(manager.pendingThemeName).toBe('forest');
        expect(manager.themesSuspended).toBe(true);

        oceanLoad.resolve(oceanTheme);
        await staleResume;

        expect(oceanTheme.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.themeInstances.has('ocean')).toBe(false);
        expect(manager.activeTheme).toBe(forestTheme);
        expect(manager.activeThemeName).toBe('forest');
        expect(forestTheme.start).toHaveBeenCalledTimes(1);
        expect(forestTheme.lifecycleState).toBe('running');
        expect(manager.themesSuspended).toBe(false);
    });

    it('does not dispose a shared resume load owned by a newer same-name selection', async () => {
        const oceanLoad = deferred();
        const oceanTheme = makeRuntimeTheme('ocean');
        oceanTheme.start = vi.fn(async function start() {
            this.hasStarted = true;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        const manager = makeManager();
        manager.themesSuspended = true;
        manager.activeThemeName = 'ocean';
        manager.pendingThemeName = 'ocean';
        manager.pendingThemeInstance = null;
        manager.loadTheme = vi.fn(async (themeName) => {
            const theme = await oceanLoad.promise;
            manager.themeInstances.set(themeName, theme);
            manager.themeLRU = [themeName];
            return theme;
        });

        const staleResume = manager.resumeThemes();
        await vi.waitFor(() => expect(manager.loadTheme).toHaveBeenCalledTimes(1));
        manager.suspendThemes();
        const newerSelection = manager.switchTheme('ocean');
        await vi.waitFor(() => expect(manager.loadTheme).toHaveBeenCalledTimes(2));

        oceanLoad.resolve(oceanTheme);
        await Promise.all([staleResume, newerSelection]);

        expect(oceanTheme.cleanup).not.toHaveBeenCalled();
        expect(manager.disposedThemeInstances.has(oceanTheme)).toBe(false);
        expect(manager.themeInstances.get('ocean')).toBe(oceanTheme);
        expect(manager.activeTheme).toBe(oceanTheme);
        expect(manager.activeThemeName).toBe('ocean');
        expect(oceanTheme.start).toHaveBeenCalledTimes(1);
        expect(manager.themesSuspended).toBe(false);
    });

    it('waits for a suspended user switch before choosing which theme to resume', async () => {
        const oceanLoad = deferred();
        const forestTheme = makeRuntimeTheme('forest');
        forestTheme.start = vi.fn();
        const oceanTheme = makeRuntimeTheme('ocean');
        oceanTheme.start = vi.fn(async function start() {
            this.hasStarted = true;
            this.isActive = true;
            this.lifecycleState = 'running';
            return true;
        });
        const manager = makeManager();
        manager.themesSuspended = true;
        manager.activeThemeName = 'forest';
        manager.pendingThemeName = 'forest';
        manager.pendingThemeInstance = forestTheme;
        manager.themeInstances.set('forest', forestTheme);
        manager.themeLRU = ['forest'];
        manager.loadTheme = vi.fn(async (themeName) => {
            expect(themeName).toBe('ocean');
            const theme = await oceanLoad.promise;
            manager.themeInstances.set(themeName, theme);
            manager.themeLRU = [themeName];
            return theme;
        });

        const newerSelection = manager.switchTheme('ocean');
        await vi.waitFor(() => expect(manager.loadTheme).toHaveBeenCalledWith('ocean'));
        const resumedActivation = manager.resumeThemes();

        expect(forestTheme.start).not.toHaveBeenCalled();
        expect(manager.loadTheme).toHaveBeenCalledTimes(1);

        oceanLoad.resolve(oceanTheme);
        await Promise.all([newerSelection, resumedActivation]);

        expect(forestTheme.start).not.toHaveBeenCalled();
        expect(forestTheme.cleanup).toHaveBeenCalledTimes(1);
        expect(manager.loadTheme).toHaveBeenCalledTimes(1);
        expect(manager.activeTheme).toBe(oceanTheme);
        expect(manager.activeThemeName).toBe('ocean');
        expect(oceanTheme.start).toHaveBeenCalledTimes(1);
        expect(oceanTheme.lifecycleState).toBe('running');
        expect(manager.themesSuspended).toBe(false);
    });
});
