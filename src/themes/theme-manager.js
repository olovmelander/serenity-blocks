/**
 * @fileoverview Theme Manager - Orchestrates theme switching, lazy loading, and transitions
 */

import { THEMES } from '../core/constants.js';
import {
    THEME_REGISTRY, getThemeMeta, resolveThemeId, ensureThemeContainer,
} from './theme-registry.js';
import { eventBus, EVENTS } from '../events/event-bus.js';
import { assetManager } from '../utils/asset-manager.js';
import { performanceMonitor } from '../utils/performance-monitor.js';
import { readFlag } from '../core/flags.js';
import { ThemePlaybackAccess } from './theme-playback-access.js';
import { LevelThemeJourney, dealOnTop, shuffleInPlace } from './level-theme-journey.js';
import {
    beginAsyncRenderPipelines,
    getAsyncRenderPipelineDiagnostics,
    isAsyncPipelineBackend,
    isAsyncRenderPipelinesReady,
    preloadAsyncRenderPipelines,
} from '../rendering/async-render-pipelines.js';

/** The .theme-container opacity transition (main.css): an outgoing theme draws on under it. */
const THEME_CROSSFADE_MS = 2500;
/** Longest an in-play switch waits for the incoming theme to build before swapping anyway. */
const SWITCH_BEHIND_MAX_MS = 12000;
/**
 * Main-thread budget per frame for the hidden incoming theme's first-time node builds (TSL → WGSL):
 * without it the forest family built every material in one frame, a 0.3-2.4 s freeze of the board.
 */
const SWITCH_BUILD_BUDGET_MS = 8;
/** Extra wait while pipelines are still compiling at that cap. */
const SWITCH_BEHIND_TAIL_MS = 3000;

/** Timeout in ms for theme init() and start() — prevents game freeze from hanging themes */
const THEME_LIFECYCLE_TIMEOUT = 10000;
const HEAVY_THEME_LIFECYCLE_TIMEOUT = 20000;

/**
 * Race a promise against a timeout. Rejects if the promise doesn't resolve in time.
 * @param {Promise} promise - The promise to race
 * @param {number} ms - Timeout in milliseconds
 * @param {string} label - Description for the error message
 * @returns {Promise}
 */
function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

export function resolveThemeStartupPolicy(runtimeConfig = null, {
    startupComplete = false,
} = {}) {
    const isPackagedWindows = runtimeConfig?.platform === 'win32' && runtimeConfig?.isPackaged;
    const isSafeMode = isPackagedWindows && runtimeConfig?.safeMode === true;

    if (isSafeMode) {
        return {
            maxCachedThemes: 1,
            deferAdjacentThemePreload: true,
            preserveSuspendedRuntime: false,
        };
    }

    if (isPackagedWindows && !startupComplete) {
        return {
            maxCachedThemes: 1,
            deferAdjacentThemePreload: true,
            preserveSuspendedRuntime: false,
        };
    }

    return {
        maxCachedThemes: 2,
        deferAdjacentThemePreload: !startupComplete,
        preserveSuspendedRuntime: true,
    };
}

/**
 * ThemeManager handles theme loading, switching, and lifecycle
 */
export class ThemeManager {
    constructor(webglRenderer, {
        assetManager: assetMgr = null,
        audioManager: audioMgr = null,
        runtimeConfig = null,
        themeCollection = null,
    } = {}) {
        this.webglRenderer = webglRenderer;
        this.activeTheme = null;
        this.activeThemeName = 'forest';
        this.themeInstances = new Map(); // Cache loaded theme instances
        this.inFlightThemeLoads = new Map();
        this.disposedThemeInstances = new WeakSet();
        this.themeRegistry = new Map(); // Map theme names to lazy importers
        // Static/shared GPU resources outlive individual cached theme instances.
        // Keep their terminal disposers after normal eviction so switch-time reuse
        // remains possible, then invoke them exactly once from full manager cleanup.
        this.terminalThemeResourceDisposers = new Map();
        this.randomThemeInterval = null;
        this.isTransitioning = false;
        // Coalesced switch queue: a switch requested mid-transition is remembered
        // (latest request wins) and runs when the in-flight switch settles, instead
        // of being silently dropped. Waiters are the callers' promises.
        this.queuedSwitchRequest = null;
        this.queuedSwitchWaiters = [];
        this.switchDrainPromise = null;
        this.themesSuspended = true;
        this.pendingThemeName = null;
        this.pendingThemeInstance = null;
        this.startupPhaseComplete = false;
        this.deferAdjacentThemePreload = true;
        this.pendingAdjacentThemePreload = false;
        this.adjacentThemePreloadTimer = null;
        this.adjacentThemePreloadIdleId = null;
        this.runtimeConfig = runtimeConfig;
        this.allowSuspendedRuntimeReuse = true;
        /** An in-play switch's incoming theme while it builds hidden: { theme, themeName } | null. */
        this._behindBuild = null;
        /** Outgoing themes drawing on under the crossfade until they are disposed. */
        this._fadingThemes = new Set();
        this.lifecycleGeneration = 0;
        this.suspensionGeneration = 0;
        this.themeIntentGeneration = 0;
        this.activationAttempts = new WeakMap();
        this.cancelledActivationAttempt = Object.freeze({ cancelled: true });
        /** @type {WeakMap<object, number>} activateThemeInstance() calls still running, per instance */
        this.activationsInFlight = new WeakMap();
        /** activateThemeInstance() calls still running, all instances. */
        this.activationsInFlightTotal = 0;
        /** Bumped by every activation: a background pre-warm that sees it change stands down. */
        this.prewarmCancelGeneration = 0;
        /** The instance a background pre-warm is building or running; an entry adopts it. */
        this.prewarmingInstance = null;
        this.isDisposed = false;
        this.themeAccess = new ThemePlaybackAccess(themeCollection);
        this.themeRuntimeContext = null;
        this.knownOwnedThemes = new Set(this.getAvailableThemes());
        this.unsubscribeThemeCollection = themeCollection?.subscribe(() => this._dealNewThemesOnTop());
        /** Background mode "As you level up" (level-theme-journey.js). */
        this.levelJourney = new LevelThemeJourney({
            onScreen: () => (this.activeThemeName && this.isThemeUnlocked(this.activeThemeName)
                ? this.activeThemeName : this.themeAccess.getRestoreTheme()),
            drawNext: (current) => this.getRandomTheme(current),
            isOwned: (id) => this.isThemeUnlocked(id),
        });

        // LRU cache management
        const startupPolicy = resolveThemeStartupPolicy(this.runtimeConfig, {
            startupComplete: false,
        });
        this.maxCachedThemes = startupPolicy.maxCachedThemes;
        this.deferAdjacentThemePreload = startupPolicy.deferAdjacentThemePreload;
        this.allowSuspendedRuntimeReuse = startupPolicy.preserveSuspendedRuntime;
        this.themeLRU = []; // Track theme access order (oldest to newest)

        // Theme shuffle deck for better random distribution
        this.themeShuffleDeck = []; // Shuffled deck of themes

        // Asset and Audio managers (shared across all themes for efficient caching)
        this.assetManager = assetMgr || assetManager;
        this.audioManager = audioMgr;

        // Initialize theme registry
        this.initializeRegistry();

        console.log('[ThemeManager] Initialized with asset and audio managers');
    }

    isPackagedWindowsBaselineProfile() {
        return this.runtimeConfig?.platform === 'win32'
            && this.runtimeConfig?.isPackaged
            && this.runtimeConfig?.windowsProfile === 'baseline';
    }

    isPackagedWindowsSafeMode() {
        return this.runtimeConfig?.platform === 'win32'
            && this.runtimeConfig?.isPackaged
            && this.runtimeConfig?.safeMode === true;
    }

    /**
     * Initialize the registry of theme names to module paths
     * This enables lazy loading of themes
     */
    initializeRegistry() {
        const moduleImports = import.meta.glob('./**/*-theme.js');

        THEME_REGISTRY.forEach(({ id, module }) => {
            const importer = moduleImports[module];
            if (!importer) {
                console.warn(`[ThemeManager] Module not found for theme "${id}": ${module}`);
                return;
            }
            this.themeRegistry.set(id, importer);
        });
    }

    async resolveThemeImporter(
        themeName,
        importer,
        generation = this.lifecycleGeneration,
    ) {
        try {
            return await importer();
        } catch (error) {
            const message = error?.message || String(error);
            const looksLikeChunkFailure = (
                /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|preload/i
            ).test(message);

            if (!looksLikeChunkFailure) {
                throw error;
            }
            if (this.isDisposed || generation !== this.lifecycleGeneration) {
                throw new Error(`Theme "${themeName}" module import was cancelled`);
            }

            console.warn(`[ThemeManager] Dynamic import failed for "${themeName}", retrying once`, error);
            await new Promise((resolve) => {
                setTimeout(resolve, 100);
            });
            if (this.isDisposed || generation !== this.lifecycleGeneration) {
                throw new Error(`Theme "${themeName}" module import retry was cancelled`);
            }
            return importer();
        }
    }

    /**
     * Update LRU order - mark theme as most recently used
     * @param {string} themeName - Theme to mark as accessed
     */
    updateLRU(themeName) {
        // Remove from current position if exists
        const index = this.themeLRU.indexOf(themeName);
        if (index > -1) {
            this.themeLRU.splice(index, 1);
        }
        // Add to end (most recent)
        this.themeLRU.push(themeName);
    }

    isHeavyGpuTheme(themeName) {
        return getThemeMeta(themeName)?.performanceClass === 'heavy';
    }

    getThemeLifecycleTimeout(themeName) {
        return this.isHeavyGpuTheme(themeName)
            ? HEAVY_THEME_LIFECYCLE_TIMEOUT
            : THEME_LIFECYCLE_TIMEOUT;
    }

    isStartupEligibleTheme(themeName) {
        return getThemeMeta(themeName)?.startupEligible !== false;
    }

    registerTerminalThemeResourceDisposer(themeName, ThemeClass) {
        if (typeof ThemeClass?.disposeSharedResources !== 'function') {
            return;
        }
        this.terminalThemeResourceDisposers.set(
            themeName,
            () => ThemeClass.disposeSharedResources(),
        );
    }

    disposeTerminalThemeResources() {
        for (const [themeName, disposeResources] of this.terminalThemeResourceDisposers) {
            try {
                disposeResources();
            } catch (error) {
                console.warn(
                    `[ThemeManager] Shared theme resource cleanup failed: ${themeName}`,
                    error,
                );
            }
        }
        this.terminalThemeResourceDisposers.clear();
    }

    deactivateThemeRuntime(themeInstance, themeName) {
        if (!themeInstance) {
            return;
        }

        if (this.isHeavyGpuTheme(themeName) && typeof themeInstance.releaseInactiveResources === 'function') {
            themeInstance.releaseInactiveResources();
        } else {
            themeInstance.stop();
        }

        this.clearRendererThemeResources();
    }

    clearRendererThemeResources() {
        if (this.webglRenderer && typeof this.webglRenderer.clearThemeResources === 'function') {
            console.log('[ThemeManager] Clearing renderer theme resources');
            try {
                this.webglRenderer.clearThemeResources();
                return true;
            } catch (error) {
                // Renderer cleanup is a best-effort boundary. A defective renderer
                // must not prevent theme ownership pointers/cache entries from being
                // retired, otherwise the next switch can revive a half-disposed theme.
                console.warn('[ThemeManager] Failed to clear renderer theme resources:', error);
            }
        }
        return false;
    }

    isHealthyActiveTheme(themeName) {
        const theme = this.activeTheme;
        return Boolean(
            theme
            && this.activeThemeName === themeName
            && theme.cleanupComplete !== true
            && theme.isActive === true
            && theme.lifecycleState === 'running',
        );
    }

    isReusablePendingTheme(themeInstance) {
        return Boolean(
            themeInstance
            && themeInstance.cleanupComplete !== true
            && themeInstance.lifecycleState !== 'failed',
        );
    }

    removeThemeFromCache(themeName, themeInstance = null) {
        if (!themeName) {
            return;
        }

        const cachedTheme = this.themeInstances.get(themeName);
        if (cachedTheme && (!themeInstance || cachedTheme === themeInstance)) {
            this.themeInstances.delete(themeName);
        }

        this.themeLRU = this.themeLRU.filter((entry) => entry !== themeName);
    }

    /**
     * Last-resort terminal sweep for a theme whose bespoke cleanup threw or
     * whose asynchronous init settled after it had already been cancelled.
     * Every phase is isolated so one defective subsystem cannot keep RAFs,
     * listeners, a renderer, or a scene alive.
     */
    forceRetireThemeInstance(themeInstance, themeName, reason = 'cleanup failure') {
        if (!themeInstance) {
            return;
        }

        const resolvedThemeName = themeName || themeInstance.name || 'unknown';
        const attempt = (label, action) => {
            try {
                action();
            } catch (error) {
                console.warn(
                    `[ThemeManager] Forced ${label} failed for ${resolvedThemeName} (${reason})`,
                    error,
                );
            }
        };

        attempt('stop', () => themeInstance.stop?.());
        attempt('animation cleanup', () => themeInstance.cancelAnimationFrames?.());
        attempt('tracked resource cleanup', () => themeInstance.clearTrackedResources?.());
        attempt('event cleanup', () => themeInstance.clearEventUnsubscribers?.());
        attempt('resize cleanup', () => themeInstance.removeCommonResizeHandlers?.());
        attempt('resilience cleanup', () => themeInstance.removeRendererResilience?.());

        if (themeInstance._contextRestoreUnsub) {
            attempt('context listener cleanup', () => themeInstance._contextRestoreUnsub());
            themeInstance._contextRestoreUnsub = null;
        }

        attempt('managed GPU cleanup', () => themeInstance.releaseManagedGpuResources?.());

        // releaseManagedGpuResources() is deliberately best-effort and a custom
        // implementation can throw before reaching the common scene/renderer.
        if (themeInstance.scene) {
            attempt('scene cleanup', () => {
                themeInstance.disposeThreeJSGroup?.(themeInstance.scene);
                themeInstance.scene?.clear?.();
            });
            themeInstance.scene = null;
        }
        if (themeInstance.renderer
            && themeInstance.renderer !== themeInstance.webglRenderer) {
            attempt('renderer cleanup', () => {
                if (typeof themeInstance.disposeRenderer === 'function') {
                    themeInstance.disposeRenderer(themeInstance.renderer);
                } else {
                    const canvas = themeInstance.renderer?.domElement;
                    themeInstance.renderer?.setAnimationLoop?.(null);
                    Promise.resolve(themeInstance.renderer?.dispose?.()).catch((error) => {
                        console.warn('[ThemeManager] Renderer disposal failed:', error);
                    });
                    if (canvas?.parentNode) {
                        canvas.parentNode.removeChild(canvas);
                    }
                    themeInstance.renderer = null;
                }
            });
        }

        if (Array.isArray(themeInstance.containers)) {
            themeInstance.containers.forEach((container) => {
                attempt('container cleanup', () => {
                    const registryOwned = container?.dataset?.themeRegistryOwned === 'true'
                        || container?.getAttribute?.('data-theme-registry-owned') === 'true'
                        || container?.__themeRegistryOwned === true;
                    if (registryOwned) {
                        container.classList?.remove?.('active');
                    } else if (container?.parentNode) {
                        container.parentNode.removeChild(container);
                    }
                });
            });
            themeInstance.containers = [];
        }

        themeInstance.isActive = false;
        themeInstance.isPaused = false;
        themeInstance.cleanupComplete = true;
        themeInstance.lifecycleState = 'stopped';
    }

    invalidateThemeInstanceLifecycle(themeInstance, themeName) {
        const resolvedThemeName = themeName || themeInstance?.name || 'unknown';
        const invalidate = (property, value) => {
            try {
                themeInstance[property] = value;
            } catch (error) {
                console.warn(
                    `[ThemeManager] Failed to invalidate ${property} for ${resolvedThemeName}`,
                    error,
                );
            }
        };
        const generation = Number.isFinite(themeInstance.lifecycleGeneration)
            ? themeInstance.lifecycleGeneration + 1
            : 1;

        // This happens before any bespoke stop()/cleanup() call. Incrementing the
        // generation synchronously prevents async start continuations from
        // publishing a retired runtime. Keep the active flags intact for the
        // cleanup call itself: several legacy stop() overrides use isActive as the
        // guard that decides whether their bespoke GPU/listener disposal must run.
        // The override (or the forced BaseTheme sweep) clears those flags before
        // this synchronous call stack can yield to stale async work.
        invalidate('lifecycleGeneration', generation);
        invalidate('lifecycleState', 'stopping');
    }

    disposeThemeInstance(themeInstance, themeName, { removeFromCache = false } = {}) {
        if (!themeInstance) {
            return;
        }

        const resolvedThemeName = themeName || themeInstance.name || 'unknown';
        const canTrackIdentity = (typeof themeInstance === 'object' && themeInstance !== null)
            || typeof themeInstance === 'function';
        const alreadyDisposed = canTrackIdentity
            && this.disposedThemeInstances.has(themeInstance);
        const managerOwnedRuntime = this.activeTheme === themeInstance
            || this.pendingThemeInstance === themeInstance;
        const orphanRuntimeWithoutReplacement = !this.activeTheme
            && (
                themeInstance.isActive === true
                || themeInstance.isPaused === true
                || themeInstance.lifecycleState === 'starting'
                || themeInstance.lifecycleState === 'running'
            );
        const ownedRuntime = managerOwnedRuntime || orphanRuntimeWithoutReplacement;
        let forcedSweepCompleted = false;

        try {
            if (!alreadyDisposed) {
                if (canTrackIdentity) {
                    // Mark first so re-entrant cleanup paths still tear down once.
                    this.disposedThemeInstances.add(themeInstance);
                }
                this.activationAttempts.delete(themeInstance);
                this.invalidateThemeInstanceLifecycle(themeInstance, resolvedThemeName);
                if (typeof themeInstance.cleanup === 'function') {
                    themeInstance.cleanup();
                } else if (
                    this.isHeavyGpuTheme(resolvedThemeName)
                    && typeof themeInstance.releaseInactiveResources === 'function'
                ) {
                    themeInstance.releaseInactiveResources();
                } else if (typeof themeInstance.stop === 'function') {
                    themeInstance.stop();
                }
            }
        } catch (error) {
            console.warn(`[ThemeManager] Theme cleanup failed: ${resolvedThemeName}`, error);
            this.forceRetireThemeInstance(
                themeInstance,
                resolvedThemeName,
                'theme cleanup threw',
            );
            forcedSweepCompleted = true;
        } finally {
            // A legacy override can return before super.cleanup() without
            // throwing (often because it observed the synchronously-invalidated
            // isActive flag). If it did not publish terminal completion, run the
            // same isolated common sweep used for an exception.
            if (!alreadyDisposed
                && !forcedSweepCompleted
                && themeInstance.cleanupComplete !== true) {
                this.forceRetireThemeInstance(
                    themeInstance,
                    resolvedThemeName,
                    'theme cleanup did not complete',
                );
            }

            // Evicting an init-only cache entry must not clear the renderer
            // resources owned by a different active theme.
            if (ownedRuntime) {
                this.clearRendererThemeResources();
            }

            if (this.activeTheme === themeInstance) {
                this.activeTheme = null;
            }

            if (this.pendingThemeInstance === themeInstance) {
                this.pendingThemeInstance = null;
                this.pendingThemeName = null;
            }

            if (removeFromCache) {
                this.removeThemeFromCache(resolvedThemeName, themeInstance);
            }
        }
    }

    handleThemeRuntimeFailure(themeInstance, themeName, error) {
        if (!themeInstance || this.isDisposed) {
            return;
        }

        const managerOwnsInstance = this.activeTheme === themeInstance
            || this.pendingThemeInstance === themeInstance
            || this.themeInstances.get(themeName) === themeInstance;
        if (!managerOwnsInstance || this.disposedThemeInstances.has(themeInstance)) {
            return;
        }

        console.error(`[ThemeManager] Theme runtime failed; replacing "${themeName}":`, error);
        const context = this.themeRuntimeContext?.themeId === themeName ? this.themeRuntimeContext : null;
        const remainSuspended = this.themesSuspended;
        this.disposeThemeInstance(themeInstance, themeName, {
            removeFromCache: true,
        });

        if (remainSuspended) {
            // Preserve the user's selection, but never revive the failed object.
            // resumeThemes() will construct a fresh identity on the next entry.
            this.activeThemeName = themeName;
            this.pendingThemeName = themeName;
            this.pendingThemeInstance = null;
            return;
        }

        // Route recovery through the normal latest-wins switch queue. It creates
        // a fresh identity, retains fallback policy, and cannot overlap another
        // user selection already in flight.
        this.switchTheme(themeName, true, context).then((appliedTheme) => {
            if (context && (appliedTheme !== themeName || !this.isHealthyActiveTheme(themeName))) {
                return this.themeAccess.reportRuntimeFailure(context, error);
            }
            return undefined;
        }).catch((recoveryError) => {
            console.error(
                `[ThemeManager] Failed to replace runtime for "${themeName}":`,
                recoveryError,
            );
        });
    }

    /**
     * Evict oldest theme from cache if over limit
     * Protects active, pending, and newly-loaded themes from eviction.
     */
    evictOldThemeIfNeeded(protectedThemeInstance = null) {
        while (this.themeInstances.size > this.maxCachedThemes) {
            let evicted = false;

            for (const themeName of this.themeLRU) {
                const themeInstance = this.themeInstances.get(themeName);
                const isProtected = themeInstance
                    && (
                        themeInstance === protectedThemeInstance
                        || themeInstance === this.activeTheme
                        || themeInstance === this.pendingThemeInstance
                    );
                if (!themeInstance || isProtected) {
                    continue;
                }

                console.log(`[ThemeManager] Evicting old theme from cache: ${themeName}`);
                this.disposeThemeInstance(themeInstance, themeName, {
                    removeFromCache: true,
                });
                console.log(
                    `[ThemeManager] Cache size after eviction: ${this.themeInstances.size}/${this.maxCachedThemes}`,
                );
                evicted = true;
                break;
            }

            if (!evicted) {
                return false;
            }
        }
        return true;
    }

    ensureThemeCacheCapacity(themeName) {
        if (this.themeInstances.has(themeName)) {
            return true;
        }
        if (!Number.isFinite(this.maxCachedThemes) || this.maxCachedThemes < 1) {
            return false;
        }

        // Make room before importing/constructing. In particular, a cap=1
        // manager with one active theme must not construct a candidate, evict
        // that same candidate, then hand its disposed identity to activation.
        while (this.themeInstances.size >= this.maxCachedThemes) {
            let evicted = false;
            for (const cachedThemeName of this.themeLRU) {
                const cachedTheme = this.themeInstances.get(cachedThemeName);
                if (!cachedTheme
                    || cachedTheme === this.activeTheme
                    || cachedTheme === this.pendingThemeInstance) {
                    continue;
                }

                this.disposeThemeInstance(cachedTheme, cachedThemeName, {
                    removeFromCache: true,
                });
                evicted = true;
                break;
            }

            if (!evicted) {
                return false;
            }
        }
        return true;
    }

    assertThemeCacheCapacity(themeName) {
        if (!this.ensureThemeCacheCapacity(themeName)) {
            throw new Error(
                `Theme cache has no safe capacity for "${themeName}" while the current runtime is protected`,
            );
        }
    }

    /**
     * Evict an inactive instance before a new candidate is constructed.
     * Kept separate from the post-insert limit check so the candidate can
     * never evict itself and be returned after cleanup.
     */
    prepareThemeCacheSlot(themeName) {
        this.assertThemeCacheCapacity(themeName);
    }

    /**
     * Load a theme module dynamically
     * @param {string} themeName - Name of theme to load
     * @param {boolean} silent - Don't log verbose messages (for background preloading)
     * @returns {Promise<BaseTheme>} Theme instance
     */
    async loadTheme(themeName, silent = false) {
        if (this.themeInstances.has(themeName)) {
            if (!silent) {
                console.log(`[ThemeManager] Theme "${themeName}" found in cache`);
            }
            this.updateLRU(themeName);
            return this.themeInstances.get(themeName);
        }

        if (this.inFlightThemeLoads.has(themeName)) {
            return this.inFlightThemeLoads.get(themeName);
        }

        if (this.isDisposed) {
            throw new Error(`ThemeManager is disposed; cannot load "${themeName}"`);
        }

        const generation = this.lifecycleGeneration;
        const loadPromise = this.loadThemeCandidate(themeName, silent, generation);
        this.inFlightThemeLoads.set(themeName, loadPromise);
        try {
            return await loadPromise;
        } finally {
            if (this.inFlightThemeLoads.get(themeName) === loadPromise) {
                this.inFlightThemeLoads.delete(themeName);
            }
        }
    }

    async loadThemeCandidate(themeName, silent = false, generation = this.lifecycleGeneration) {
        // Check if already loaded
        if (this.themeInstances.has(themeName)) {
            if (!silent) {
                console.log(`[ThemeManager] Theme "${themeName}" found in cache`);
            }
            this.updateLRU(themeName); // Mark as recently used
            return this.themeInstances.get(themeName);
        }

        // Get module path
        const importer = this.themeRegistry.get(themeName);
        if (!importer) {
            throw new Error(`Theme "${themeName}" not found in registry`);
        }
        this.prepareThemeCacheSlot(themeName);

        let themeInstance = null;
        try {
            if (!silent) {
                console.log(`[ThemeManager] Loading theme "${themeName}" from disk`);
            }

            // Dynamically import the theme module. The timeout matters: init() and
            // start() are already timeout-guarded, but a stalled module fetch here
            // used to hang this await forever with isTransitioning stuck true —
            // silently killing every future theme switch for the session.
            const module = await withTimeout(
                Promise.resolve(this.resolveThemeImporter(themeName, importer, generation)),
                this.getThemeLifecycleTimeout(themeName),
                `Theme "${themeName}" module import`,
            );
            if (this.isDisposed || generation !== this.lifecycleGeneration) {
                throw new Error(`Theme "${themeName}" module import was cancelled`);
            }
            // Cache occupancy can change while the module import is in flight.
            // Re-check before construction so a protected cap=1 runtime still
            // cannot cause a construct-then-self-evict outcome.
            this.prepareThemeCacheSlot(themeName);
            const ThemeClass = module.default;
            if (typeof ThemeClass !== 'function') {
                throw new Error(`Theme "${themeName}" module has no default theme class`);
            }

            // Instantiate the theme
            themeInstance = new ThemeClass();
            themeInstance.resourceProfile = getThemeMeta(themeName)?.resourceProfile || 'light';
            if (typeof themeInstance.init !== 'function') {
                throw new Error(`Theme "${themeName}" does not implement init()`);
            }

            // Initialize the theme (with timeout to prevent game freeze). Keep
            // the original promise so a timed-out init can be swept again when
            // it eventually settles; otherwise resources allocated after the
            // first candidate cleanup could escape terminal ownership.
            let initSettled = false;
            const initPromise = Promise.resolve()
                .then(() => themeInstance.init())
                .then(
                    (value) => {
                        initSettled = true;
                        return value;
                    },
                    (error) => {
                        initSettled = true;
                        throw error;
                    },
                );
            try {
                await withTimeout(
                    initPromise,
                    this.getThemeLifecycleTimeout(themeName),
                    `Theme "${themeName}" init`,
                );
            } catch (error) {
                if (!initSettled) {
                    const retireLateCandidate = () => {
                        this.forceRetireThemeInstance(
                            themeInstance,
                            themeName,
                            'late init settlement',
                        );
                    };
                    initPromise.then(retireLateCandidate, retireLateCandidate);
                }
                throw error;
            }
            if (this.isDisposed || generation !== this.lifecycleGeneration) {
                throw new Error(`Theme "${themeName}" load was cancelled`);
            }
            if (themeInstance.name && themeInstance.name !== themeName) {
                throw new Error(
                    `Theme identity mismatch: requested "${themeName}", loaded "${themeInstance.name}"`,
                );
            }
            this.registerTerminalThemeResourceDisposer(themeName, ThemeClass);

            // Cache the instance
            this.themeInstances.set(themeName, themeInstance);
            this.updateLRU(themeName);

            // Evict old themes if cache is full
            const cacheWithinLimit = this.evictOldThemeIfNeeded(themeInstance);
            if (!cacheWithinLimit || this.themeInstances.size > this.maxCachedThemes) {
                throw new Error(
                    `Theme cache could not safely retain "${themeName}" within its capacity`,
                );
            }
            if (this.themeInstances.get(themeName) !== themeInstance
                || this.disposedThemeInstances.has(themeInstance)) {
                throw new Error(`Theme "${themeName}" was retired while entering the cache`);
            }

            if (!silent) {
                console.log(
                    `[ThemeManager] Theme "${themeName}" loaded.`,
                    `Cache: ${this.themeInstances.size}/${this.maxCachedThemes}`,
                );
            }
            return themeInstance;
        } catch (error) {
            console.error(`Failed to load theme "${themeName}":`, error);
            if (themeInstance) {
                this.disposeThemeInstance(themeInstance, themeName, {
                    removeFromCache: this.themeInstances.get(themeName) === themeInstance,
                });
            }
            throw error;
        }
    }

    /**
     * Preload themes in the background (non-blocking)
     * @param {string[]} themeNames - Array of theme names to preload
     * @param {number} delayMs - Delay between preloads (to avoid blocking)
     * @returns {Promise<void>}
     */
    async preloadThemes(themeNames, delayMs = 500) {
        console.log(`[ThemeManager] Starting background preload of ${themeNames.length} themes`);

        for (const themeName of themeNames) {
            // Skip if already loaded
            if (this.themeInstances.has(themeName)) {
                continue;
            }

            // Use requestIdleCallback if available, otherwise setTimeout
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
                const loadTask = async () => {
                    try {
                        await this.loadTheme(themeName, true); // Silent load
                        console.log(`[ThemeManager] Preloaded: ${themeName}`);
                    } catch (error) {
                        console.warn(`[ThemeManager] Failed to preload ${themeName}:`, error);
                    }
                    resolve();
                };

                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(() => loadTask());
                } else {
                    setTimeout(() => loadTask(), delayMs);
                }
            });
        }

        console.log(`[ThemeManager] Preload complete. Cache: ${this.themeInstances.size}/${this.maxCachedThemes}`);
    }

    /**
     * Preload the next theme in rotation (useful for seamless transitions)
     * @returns {Promise<void>}
     */
    async preloadNextTheme() {
        const currentIndex = THEMES.indexOf(this.activeThemeName);
        const nextIndex = (currentIndex + 1) % THEMES.length;
        const nextTheme = THEMES[nextIndex];

        if (this.isHeavyGpuTheme(nextTheme)) {
            console.log(`[ThemeManager] Skipping adjacent preload for heavy theme: ${nextTheme}`);
            return;
        }

        if (!this.themeInstances.has(nextTheme)) {
            console.log(`[ThemeManager] Preloading next theme: ${nextTheme}`);
            await this.loadTheme(nextTheme, true);
        }
    }

    queueAdjacentThemePreload(delayMs = 350) {
        this.clearAdjacentThemePreloadQueue();
        if (this.isPackagedWindowsSafeMode()) {
            return;
        }
        if (this.deferAdjacentThemePreload) {
            this.pendingAdjacentThemePreload = true;
            return;
        }

        const runPreload = () => {
            this.adjacentThemePreloadTimer = null;
            this.adjacentThemePreloadIdleId = null;
            this.pendingAdjacentThemePreload = false;
            this.preloadNextTheme().catch((error) => {
                console.warn('[ThemeManager] Failed to preload next theme:', error);
            });
        };

        if (typeof requestIdleCallback === 'function') {
            this.adjacentThemePreloadIdleId = requestIdleCallback(runPreload, { timeout: 1500 });
            return;
        }

        this.adjacentThemePreloadTimer = setTimeout(runPreload, delayMs);
    }

    clearAdjacentThemePreloadQueue() {
        if (this.adjacentThemePreloadTimer) {
            clearTimeout(this.adjacentThemePreloadTimer);
            this.adjacentThemePreloadTimer = null;
        }
        if (typeof cancelIdleCallback === 'function' && this.adjacentThemePreloadIdleId !== null) {
            cancelIdleCallback(this.adjacentThemePreloadIdleId);
            this.adjacentThemePreloadIdleId = null;
        }
    }

    releaseStartupPreload(delayMs = 650) {
        if (this.isPackagedWindowsSafeMode()) {
            return;
        }

        this.startupPhaseComplete = true;
        const nextPolicy = resolveThemeStartupPolicy(this.runtimeConfig, {
            startupComplete: true,
        });
        this.maxCachedThemes = nextPolicy.maxCachedThemes;
        this.deferAdjacentThemePreload = nextPolicy.deferAdjacentThemePreload;
        this.allowSuspendedRuntimeReuse = nextPolicy.preserveSuspendedRuntime;
        const effectiveDelayMs = this.isPackagedWindowsBaselineProfile()
            ? Math.max(delayMs, 2200)
            : delayMs;

        if (this.pendingAdjacentThemePreload) {
            this.queueAdjacentThemePreload(effectiveDelayMs);
        }
    }

    /**
     * Switch to a new theme
     * @param {string} themeName - Name of theme to switch to
     * @param {boolean} immediate - Skip transition if true
     * @param {object|null} context - Opaque permission for the current Odyssey orb only
     * @returns {Promise<string|null>} finally-active theme name
     */
    async switchTheme(requestedTheme, immediate = false, context = null) {
        // Retired ids still arrive from persisted settings and saved runs;
        // resolve before anything keys instances, containers or LRU off the name.
        const themeName = resolveThemeId(requestedTheme);
        console.log('[ThemeManager] switchTheme called:', themeName);

        if (this.isDisposed) {
            console.warn('[ThemeManager] Ignoring theme switch after terminal cleanup:', themeName);
            return this.activeThemeName;
        }

        if (!getThemeMeta(themeName)) {
            console.error('[ThemeManager] Invalid theme name:', themeName);
            return this.activeThemeName;
        }
        if (!this.themeAccess.canUse(themeName, context)) {
            return this.activeThemeName;
        }

        // Every accepted public selection is a new latest-wins intent, even a
        // same-name click. resumeThemes() uses this token to avoid publishing a
        // stale theme after an awaited fresh load.
        this.themeIntentGeneration += 1;

        if (!this.isTransitioning
            && !this.switchDrainPromise
            && this.isHealthyActiveTheme(themeName)) {
            this.themeRuntimeContext = context;
            if (!context) this.themeAccess.rememberSelection(themeName);
            console.log('[ThemeManager] Already on theme:', themeName);
            return this.activeThemeName;
        }

        this.queuedSwitchRequest = { themeName, immediate, context };
        const outcome = new Promise((resolve) => {
            this.queuedSwitchWaiters.push(resolve);
        });
        this.drainQueuedThemeSwitch();
        return outcome;
    }

    async performThemeSwitch(themeName, context = null) {
        if (!this.themeAccess.canUse(themeName, context)) return this.activeThemeName;
        console.log('[ThemeManager] switchTheme called:', themeName);
        const switchStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const previousTheme = this.activeThemeName;
        const transactionGeneration = this.lifecycleGeneration;

        if (this.isHealthyActiveTheme(themeName)) {
            this.themeRuntimeContext = context;
            if (!context) this.themeAccess.rememberSelection(themeName);
            console.log('[ThemeManager] Already on theme:', themeName);
            return this.activeThemeName; // Already on this theme
        }

        try {
            this.clearAdjacentThemePreloadQueue();
            this.pendingAdjacentThemePreload = false;

            const outgoingTheme = this.activeTheme || this.pendingThemeInstance;
            const outgoingThemeName = this.activeTheme ? this.activeThemeName : this.pendingThemeName;
            const samePendingThemeCanBeReused = outgoingTheme === this.pendingThemeInstance
                && outgoingThemeName === themeName
                && this.isReusablePendingTheme(outgoingTheme);
            // In play, the incoming theme is built behind the outgoing one, which keeps playing
            // until the swap (_canSwitchBehindActive).
            const behind = this._canSwitchBehindActive(outgoingTheme, outgoingThemeName, themeName)
                ? { theme: outgoingTheme, themeName: outgoingThemeName }
                : null;
            if (outgoingTheme && !behind
                && (outgoingThemeName !== themeName || !samePendingThemeCanBeReused)) {
                console.log('[ThemeManager] Disposing current theme before switch:', outgoingThemeName);
                this.disposeThemeInstance(outgoingTheme, outgoingThemeName, {
                    removeFromCache: true,
                });
            }

            console.log('[ThemeManager] Loading theme:', themeName);
            // Load the new theme
            const newTheme = await this.loadTheme(themeName);
            if (this.isDisposed || transactionGeneration !== this.lifecycleGeneration
                || !this.themeAccess.canUse(themeName, context)) {
                throw new Error(`Theme switch to "${themeName}" was cancelled`);
            }
            if (this.disposedThemeInstances.has(newTheme)) {
                throw new Error(`Theme switch loaded a disposed "${themeName}" instance`);
            }
            // Log the name only — logging the instance itself pins the whole theme
            // (scene graph included) in Chromium's console message store until the
            // message rotates out, even with DevTools closed. Measured at multiple
            // MB of GC-immune heap per theme switch (SB-15 remediation log).
            console.log('[ThemeManager] Theme loaded:', newTheme?.name || themeName);

            this.pendingThemeInstance = newTheme;
            this.pendingThemeName = themeName;
            this.themeRuntimeContext = context;

            if (this.themesSuspended) {
                console.log('[ThemeManager] Theme activation deferred (themes are suspended)');
                this.activeThemeName = themeName;
            } else {
                await this.activateThemeInstance(newTheme, themeName, context, behind);
            }
            if (!context && this.activeThemeName === themeName) this.themeAccess.rememberSelection(themeName);
        } catch (error) {
            console.error('[ThemeManager] Failed to switch theme:', error);
            this.pendingThemeInstance = null;
            this.pendingThemeName = null;

            if (context && !this.activeTheme && this.themeAccess.canUse(themeName, context)) {
                this.activeThemeName = null;
            }
            if (!this.isDisposed && !this.activeTheme && themeName !== 'forest'
                && !this.isOdysseyThemeScopeActive()) {
                console.warn('[ThemeManager] Falling back to forest theme after switch failure');
                try {
                    const forestTheme = await this.loadTheme('forest');
                    if (this.isDisposed || transactionGeneration !== this.lifecycleGeneration) {
                        throw new Error('Forest fallback was cancelled');
                    }
                    if (this.disposedThemeInstances.has(forestTheme)) {
                        throw new Error('Forest fallback loaded a disposed instance');
                    }
                    this.pendingThemeInstance = forestTheme;
                    this.pendingThemeName = 'forest';

                    if (this.themesSuspended) {
                        this.activeThemeName = 'forest';
                        this.themeRuntimeContext = null;
                    } else {
                        await this.activateThemeInstance(forestTheme, 'forest');
                    }
                } catch (fallbackError) {
                    console.error(
                        '[ThemeManager] Failed to activate fallback theme after switch failure:',
                        fallbackError,
                    );
                    this.activeThemeName = null;
                }
            }
        } finally {
            const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            performanceMonitor.recordThemeSwitch({
                fromTheme: previousTheme,
                toTheme: themeName,
                durationMs: endedAt - switchStartedAt,
            });
        }
        return this.activeThemeName;
    }

    /**
     * Drain the coalesced latest-wins queue under one lifecycle owner.
     * Public switch promises settle only after no newer request remains.
     */
    drainQueuedThemeSwitch() {
        if (this.isTransitioning || this.switchDrainPromise) {
            return this.switchDrainPromise;
        }

        if (!this.queuedSwitchRequest) {
            this.settleQueuedThemeSwitches();
            return Promise.resolve(this.activeThemeName);
        }

        this.isTransitioning = true;
        this.switchDrainPromise = (async () => {
            try {
                while (this.queuedSwitchRequest) {
                    const queued = this.queuedSwitchRequest;
                    this.queuedSwitchRequest = null;
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        await this.performThemeSwitch(queued.themeName, queued.context);
                    } catch (error) {
                        console.error('[ThemeManager] Queued theme switch failed:', error);
                    }
                }
            } finally {
                this.isTransitioning = false;
                this.switchDrainPromise = null;
                this.settleQueuedThemeSwitches();
            }
            return this.activeThemeName;
        })();

        return this.switchDrainPromise;
    }

    settleQueuedThemeSwitches() {
        if (this.isTransitioning || this.switchDrainPromise || this.queuedSwitchRequest) {
            return;
        }

        const name = this.activeThemeName;
        const waiters = this.queuedSwitchWaiters;
        this.queuedSwitchWaiters = [];
        waiters.forEach((resolve) => {
            try {
                resolve(name);
            } catch (error) {
                console.error('[ThemeManager] Queued switch waiter failed:', error);
            }
        });
    }

    /**
     * Make a running theme's container the visible one. A theme that was built by a hidden
     * pre-warm and then became the active theme has nobody else to reveal it.
     */
    revealThemeContainer(themeInstance, themeName) {
        if (typeof document === 'undefined' || !themeInstance
            || themeInstance.isActive !== true || themeInstance.isPaused === true) return false;
        const container = document.getElementById?.(`${themeName}-theme`);
        if (!container?.classList || container.classList.contains('active')) return false;
        document.querySelectorAll?.('.theme-container').forEach((other) => {
            other.classList.remove('active');
        });
        container.style?.removeProperty?.('opacity');
        container.style?.removeProperty?.('visibility');
        container.classList.add('active');
        console.log('[ThemeManager] Revealed theme container after pre-warm:', themeName);
        return true;
    }

    /**
     * @param {any} themeInstance
     * @param {string} themeName
     * @param {any} [context]
     * @param {{ theme: any, themeName: string } | null} [behind] an in-play switch: build the
     *   theme hidden while this outgoing theme plays on, then crossfade (_canSwitchBehindActive)
     */
    async activateThemeInstance(themeInstance, themeName, context = null, behind = null) {
        // Counted rather than flagged: a recovery rebuild can overlap another activation of
        // the same instance. suspendThemes() reads this to tell a parked theme from one that
        // is paused only until its queued start() runs.
        const inFlight = this.activationsInFlight;
        const tracked = themeInstance !== null && typeof themeInstance === 'object';
        if (tracked) inFlight.set(themeInstance, (inFlight.get(themeInstance) || 0) + 1);
        // A mode entry (or a recovery rebuild) outranks a background pre-warm: cancel any warm
        // in progress, so it can neither park nor tear down the runtime being started here.
        this.activationsInFlightTotal += 1;
        this.prewarmCancelGeneration += 1;
        try {
            return await this.runThemeActivation(themeInstance, themeName, context, behind);
        } finally {
            this.activationsInFlightTotal -= 1;
            if (tracked) {
                const remaining = (inFlight.get(themeInstance) || 1) - 1;
                if (remaining > 0) inFlight.set(themeInstance, remaining);
                else inFlight.delete(themeInstance);
            }
        }
    }

    /**
     * A parked theme is already suspended: paused with its GPU resources kept and no
     * activation running. BaseTheme.pause() leaves isActive true, so without this check a
     * second suspendThemes() (the menu appearing after a boot prewarm, or after an exit that
     * already suspended) read the parked theme as an in-flight activation and disposed it.
     * @param {any} themeInstance
     * @returns {boolean}
     */
    isParkedThemeInstance(themeInstance) {
        return themeInstance?.isPaused === true
            && themeInstance.lifecycleState === 'paused'
            && !this.activationsInFlight.has(themeInstance);
    }

    async runThemeActivation(themeInstance, themeName, context = null, behind = null) {
        if (!this.themeAccess.canUse(themeName, context)) {
            throw new Error(`Theme playback permission expired: ${themeName}`);
        }
        if (!themeInstance) {
            throw new Error(`Cannot activate null theme instance for "${themeName}"`);
        }
        if (this.isDisposed) {
            throw new Error(`ThemeManager is disposed; cannot activate "${themeName}"`);
        }
        if (themeInstance.name && themeInstance.name !== themeName) {
            throw new Error(
                `Theme identity mismatch: activating "${themeName}" with "${themeInstance.name}"`,
            );
        }
        if (this.disposedThemeInstances.has(themeInstance)) {
            throw new Error(`Theme "${themeName}" was already disposed`);
        }

        const activationGeneration = this.lifecycleGeneration;
        const activationSuspensionGeneration = this.suspensionGeneration;
        // Read before any await: the warm clears it when it stands down.
        const adoptWarm = this.prewarmingInstance === themeInstance;
        const activationAttempt = Symbol(`activate:${themeName}`);
        this.activationAttempts.set(themeInstance, activationAttempt);
        const ownsActivation = () => (
            this.activationAttempts.get(themeInstance) === activationAttempt
        );
        const retireCancelledActivation = () => {
            const currentAttempt = this.activationAttempts.get(themeInstance);
            const newerActivationOwnsInstance = currentAttempt
                && currentAttempt !== activationAttempt
                && currentAttempt !== this.cancelledActivationAttempt;
            if (newerActivationOwnsInstance) {
                return;
            }

            // A terminally-disposed start can still run legacy code after its
            // await. Sweep again after that completion, even if the identity is
            // already in disposedThemeInstances. No newer activation may ever
            // share this object; resume constructs a fresh identity instead.
            this.forceRetireThemeInstance(
                themeInstance,
                themeName,
                'cancelled activation settled late',
            );
        };
        console.log('[ThemeManager] Activating theme:', themeName, 'isActive:', themeInstance.isActive);

        // Stop current active theme if different from the one we're activating (an in-play switch
        // keeps it playing until the incoming theme is ready)
        if (this.activeTheme && this.activeTheme !== themeInstance && !behind) {
            console.log('[ThemeManager] Disposing current theme before activation:', this.activeThemeName);
            this.disposeThemeInstance(this.activeTheme, this.activeThemeName, {
                removeFromCache: true,
            });
        }

        // Registry-owned container guarantee (plan §2.7): static index.html divs
        // win; a missing one (the chiral-gold class of bug) is lazily created.
        ensureThemeContainer(themeName);

        // A visible activation ends any boot pre-warm of this instance. The warm that hid it
        // may still be in flight (the player entered a mode mid-warm); a start() that read the
        // flag then would take BaseTheme's hidden branch and leave the container hidden for
        // good, behind a theme that reports itself running.
        themeInstance._prewarmHidden = false;

        // An in-play switch builds this theme hidden, with its render pipelines created async, while
        // the outgoing theme plays on; it is revealed when quiet (_settleBehindActive).
        let behindSession = null;
        if (behind) {
            themeInstance._prewarmHidden = true;
            behindSession = beginAsyncRenderPipelines(themeInstance, {
                label: `switch:${themeName}`,
                buildBudgetMs: SWITCH_BUILD_BUDGET_MS,
            });
            this._behindBuild = { theme: themeInstance, themeName };
        }

        // The player entered while a boot pre-warm was building or running this very instance
        // (PIPE-05): adopt the warm runtime, with its compiled pipelines, instead of tearing it
        // down to build it again. Anything less than a clean running result takes the start below.
        if (adoptWarm) {
            this._armLoadingSurfaceSession(themeInstance, themeName);
            const adopted = await this.adoptPrewarmedRuntime(themeInstance, themeName, () => (
                ownsActivation()
                && !this.isDisposed
                && activationGeneration === this.lifecycleGeneration
                && activationSuspensionGeneration === this.suspensionGeneration
            ));
            if (adopted) {
                this._publishActivatedTheme(themeInstance, themeName, context);
                // Same safety net as a quick resume: a runtime that draws nothing is rebuilt.
                this._ensureThemeRendering(themeInstance, themeName).catch((error) => {
                    console.warn('[ThemeManager] render-verify failed:', error?.message || error);
                });
                return themeName;
            }
        }

        // Start the theme (this calls createScene and initializes everything)
        console.log('[ThemeManager] Starting theme:', themeName);
        try {
            this._armLoadingSurfaceSession(themeInstance, themeName);
            const started = await withTimeout(
                themeInstance.start(this.webglRenderer, {
                    assetManager: this.assetManager,
                    audioManager: this.audioManager,
                    onRuntimeFailure: (error) => {
                        this.handleThemeRuntimeFailure(themeInstance, themeName, error);
                    },
                }),
                this.getThemeLifecycleTimeout(themeName),
                `Theme "${themeName}" start`,
            );
            if (behind && started !== false && ownsActivation()) {
                await this._settleBehindActive(themeInstance, themeName, behindSession, () => (
                    ownsActivation()
                    && !this.isDisposed
                    && activationGeneration === this.lifecycleGeneration
                    && activationSuspensionGeneration === this.suspensionGeneration
                    && !this.queuedSwitchRequest
                ));
            }
            if (!ownsActivation()) {
                console.warn(
                    `[ThemeManager] Ignoring superseded activation completion: ${themeName}`,
                );
                retireCancelledActivation();
                return themeName;
            }
            if (!this.themeAccess.canUse(themeName, context)) {
                throw new Error(`Theme playback permission expired: ${themeName}`);
            }
            const suspendedDuringStart = activationSuspensionGeneration
                !== this.suspensionGeneration
                && this.pendingThemeInstance === themeInstance;
            if (suspendedDuringStart) {
                // Mode suspension won the race. Keep this restartable (not
                // terminally disposed) as the pending target; resumeThemes()
                // will perform a fresh full activation.
                try {
                    themeInstance.stop?.();
                } catch (error) {
                    console.warn(`[ThemeManager] Failed to retire suspended start for "${themeName}":`, error);
                }
                try {
                    themeInstance.releaseManagedGpuResources?.();
                } catch (error) {
                    console.warn(`[ThemeManager] Failed to release suspended start for "${themeName}":`, error);
                }
                themeInstance.isActive = false;
                themeInstance.isPaused = false;
                themeInstance.lifecycleState = 'stopped';
                this.activeTheme = null;
                this.activeThemeName = themeName;
                this.themeRuntimeContext = context;
                return themeName;
            }
            if (started === false
                || this.isDisposed
                || activationGeneration !== this.lifecycleGeneration) {
                throw new Error(`Theme "${themeName}" start was cancelled`);
            }
        } catch (error) {
            if (!ownsActivation()) {
                console.warn(
                    `[ThemeManager] Ignoring superseded activation failure: ${themeName}`,
                    error,
                );
                retireCancelledActivation();
                return themeName;
            }
            console.error(`[ThemeManager] Theme "${themeName}" failed to start:`, error);
            // An in-play switch keeps the outgoing theme playing: only the incoming build is lost.
            if (behind) this._behindBuild = null;
            this.disposeThemeInstance(themeInstance, themeName, {
                removeFromCache: true,
            });
            throw error;
        }

        if (behind) this._completeBehindSwitch(themeInstance, themeName, behind, behindSession);
        this._publishActivatedTheme(themeInstance, themeName, context);
        return themeName;
    }

    /**
     * Whether a switch can build its incoming theme behind the outgoing one. A level-up in Level
     * mode, the Random timer or a pick during play used to dispose the playing theme first and then
     * build the new one, whose first frame compiled every render pipeline synchronously: the GPU
     * process, and with it the board, froze for the whole compile (2-6 s for a theme the player had
     * not seen yet). Behind the playing theme, the pipelines are created async and the swap is a
     * crossfade. Only for a theme that is visibly playing and an async-capable backend; anything else
     * (the menu, a loading surface, a parked or starting theme) takes the classic path.
     * Rollback: ?themeSwitchBehind=0 (or localStorage serenity.themeSwitchBehind=0).
     * @param {any} outgoing
     * @param {string | null} outgoingName
     * @param {string} incomingName
     * @returns {boolean}
     */
    _canSwitchBehindActive(outgoing, outgoingName, incomingName) {
        return Boolean(outgoing)
            && outgoing === this.activeTheme
            && outgoingName !== incomingName
            && outgoing.isActive === true
            && outgoing.isPaused !== true
            && outgoing.lifecycleState === 'running'
            && !this.themesSuspended
            && !(this._loadingSurfaceCovering > 0)
            && !(typeof document !== 'undefined' && document.hidden)
            && !this.isPackagedWindowsSafeMode()
            && this.isAsyncWarmEnabled()
            && isAsyncRenderPipelinesReady()
            && readFlag('themeSwitchBehind', true);
    }

    /**
     * Let the hidden incoming theme's own loop request its pipelines (async) until the scene stops
     * growing and no pipeline has been requested for a few frames. Bounded; returns early when the
     * switch is superseded (a newer switch, a suspension, disposal) or frames stop (a hidden tab).
     * A classic or WebGL2 renderer compiles synchronously anyway, so there is nothing to wait for.
     */
    async _settleBehindActive(theme, themeName, session, stillOwned) {
        const backend = theme.renderer?.backend;
        const asyncActive = session !== null
            && backend?.isWebGPUBackend === true
            && isAsyncPipelineBackend(backend);
        if (session && !asyncActive) session.end();
        if (!asyncActive) return 'sync-renderer';
        const nextFrame = () => new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
            else setTimeout(resolve, 16);
        });
        const startedAt = performance.now();
        let stableFrames = 0;
        let lastCount = -1;
        for (;;) {
            if (!stillOwned()) return 'superseded';
            const elapsed = performance.now() - startedAt;
            if (elapsed >= SWITCH_BEHIND_MAX_MS
                && !(session.inFlight > 0 && elapsed < SWITCH_BEHIND_MAX_MS + SWITCH_BEHIND_TAIL_MS)) {
                console.warn(`[ThemeManager] Swapping to "${themeName}" with ${session.inFlight} pipeline(s) in flight `
                    + `and builds still deferred: ${session.lastDeferFrame >= session.frame - 1}`);
                return 'cap';
            }
            try {
                // eslint-disable-next-line no-await-in-loop
                await withTimeout(nextFrame(), 3000, `Theme "${themeName}" switch frame`);
            } catch (frameError) {
                return 'frame-timeout';
            }
            session.noteFrame();
            const count = theme.scene?.children?.length ?? 0;
            if (count === lastCount) {
                stableFrames += 1;
            } else {
                stableFrames = 0;
                lastCount = count;
            }
            if (stableFrames >= 20 && session.isQuiet(10)) return 'quiet';
        }
    }

    /**
     * Reveal the incoming theme and let the outgoing one fade out under it, still drawing, before it
     * is disposed. The outgoing theme leaves the cache at once, so a quick switch back builds afresh
     * instead of picking up an instance that is about to be disposed.
     */
    _completeBehindSwitch(incoming, incomingName, behind, session) {
        this._behindBuild = null;
        incoming._prewarmHidden = false;
        // A shadow map drawn while builds were deferred can lack late casters: draw each once more.
        incoming.scene?.traverse?.((object) => {
            if (object.isLight && object.castShadow && object.shadow) object.shadow.needsUpdate = true;
        });
        this.revealThemeContainer(incoming, incomingName);
        const outgoing = behind.theme;
        if (outgoing && outgoing !== incoming && !this.disposedThemeInstances.has(outgoing)) {
            if (this.activeTheme === outgoing) this.activeTheme = null;
            this.removeThemeFromCache(behind.themeName, outgoing);
            const fade = { theme: outgoing, themeName: behind.themeName, timer: null };
            fade.timer = setTimeout(() => {
                this._fadingThemes.delete(fade);
                this.disposeThemeInstance(outgoing, behind.themeName);
            }, THEME_CROSSFADE_MS);
            this._fadingThemes.add(fade);
        }
        if (!session?.active) return;
        // Content the theme still streams in compiles async (and builds within the budget) too; end
        // the session once nothing is in flight or deferred.
        const startedAt = performance.now();
        let idleSince = null;
        let deferredSeen = session.deferredBuilds;
        const tick = () => {
            const now = performance.now();
            const gone = this.isDisposed || this.activeTheme !== incoming
                || this.disposedThemeInstances.has(incoming);
            const deferring = session.deferredBuilds !== deferredSeen;
            deferredSeen = session.deferredBuilds;
            if (session.inFlight > 0 || deferring) idleSince = null;
            else if (idleSince === null) idleSince = now;
            if (gone || (idleSince !== null && now - idleSince >= 1000) || now - startedAt >= 20000) {
                session.end();
                return;
            }
            setTimeout(tick, 250);
        };
        setTimeout(tick, 250);
    }

    /**
     * Stand down an in-play switch's hidden build (a suspension or disposal arrived during it): the
     * build is cancelled and disposed, and the outgoing theme stays the active one. Fading outgoing
     * themes are disposed at once, so nothing keeps drawing behind the menu.
     */
    _standDownSwitchBehind() {
        for (const fade of this._fadingThemes) {
            clearTimeout(fade.timer);
            this.disposeThemeInstance(fade.theme, fade.themeName);
        }
        this._fadingThemes.clear();
        const build = this._behindBuild;
        this._behindBuild = null;
        if (!build || this.disposedThemeInstances.has(build.theme)) return;
        console.log('[ThemeManager] Cancelling the in-play switch built behind the active theme:', build.themeName);
        this.activationAttempts.set(build.theme, this.cancelledActivationAttempt);
        if (this.pendingThemeInstance === build.theme) {
            this.pendingThemeInstance = null;
            this.pendingThemeName = null;
        }
        this.disposeThemeInstance(build.theme, build.themeName, { removeFromCache: true });
    }

    /** Publish an activated theme as the active one. */
    _publishActivatedTheme(themeInstance, themeName, context) {
        this.activeTheme = themeInstance;
        this.activeThemeName = themeName;
        this.themeRuntimeContext = context;
        this.pendingThemeInstance = null;
        this.pendingThemeName = null;
        this.updateLRU(themeName);
        this.themesSuspended = false;

        eventBus.emit(EVENTS.THEME_CHANGED, { themeName });
        console.log('[ThemeManager] Theme activation complete:', themeName);

        this.queueAdjacentThemePreload();
    }

    /**
     * Adopt the runtime a boot pre-warm built for this instance (PIPE-05): wait for the warm's
     * start to settle, then reveal the theme if it is running cleanly. BaseTheme's hidden prewarm
     * start differs from a visible one only in leaving the container hidden.
     * @param {any} themeInstance
     * @param {string} themeName
     * @param {() => boolean} stillOwned
     * @returns {Promise<boolean>} true when adopted; false to start the theme as usual
     */
    async adoptPrewarmedRuntime(themeInstance, themeName, stillOwned) {
        const pendingStart = themeInstance._startInFlight;
        if (pendingStart) {
            try {
                await pendingStart;
            } catch {
                return false;
            }
        }
        const running = stillOwned()
            && !this.disposedThemeInstances.has(themeInstance)
            && themeInstance.cleanupComplete !== true
            && themeInstance.isActive === true
            && themeInstance.isPaused !== true
            && themeInstance.lifecycleState === 'running'
            && Boolean(themeInstance.renderer || themeInstance.scene);
        if (!running) return false;
        themeInstance._prewarmHidden = false;
        this.revealThemeContainer(themeInstance, themeName);
        console.log('[ThemeManager] Adopted the running pre-warm on entry:', themeName);
        return true;
    }

    /**
     * Keep a parked theme's warm session until its deferred loading is done: no busy flags, no
     * pipelines in flight, stable for a second. Bounded, and ended early when the theme is
     * entered (the loading-surface session takes over), replaced or disposed.
     */
    _retainPrewarmSession(theme, themeName, retained, { isBusy = () => false, maxMs = 20000, stableMs = 1000 } = {}) {
        const startedAt = performance.now();
        let idleSince = null;
        const tick = () => {
            const now = performance.now();
            const cached = this.themeInstances.get(themeName) === theme;
            if (this.isDisposed || !cached || theme.isDisposed === true || theme.cleanupComplete === true) {
                retained.finish('dropped');
                return;
            }
            if (this.activeTheme === theme) {
                retained.finish('entered');
                return;
            }
            let busy = retained.session.inFlight > 0;
            try { busy = busy || isBusy(theme) === true; } catch (e) { /* treat as idle */ }
            if (busy) {
                idleSince = null;
            } else if (idleSince === null) {
                idleSince = now;
            }
            if (idleSince !== null && now - idleSince >= stableMs) {
                retained.finish('idle');
                return;
            }
            if (now - startedAt >= maxMs) {
                retained.finish('retain-timeout');
                return;
            }
            setTimeout(tick, 250);
        };
        setTimeout(tick, 250);
    }

    /** Loading-surface warms create render pipelines async (rollback: ?themeWarmAsync=0). */
    isAsyncWarmEnabled() {
        return readFlag('themeWarmAsync', true);
    }

    /**
     * Resolve the WebGPU backend prototype the async sessions wrap. Sessions can only start
     * synchronously once this has resolved (the app loads 'three/webgpu' early anyway).
     * @returns {Promise<object|null>}
     */
    preloadAsyncRenderPipelines() {
        return this.isAsyncWarmEnabled() ? preloadAsyncRenderPipelines() : Promise.resolve(null);
    }

    /**
     * Whether a loading surface begun now can arm async sessions at all (flag on AND the
     * backend prototype resolved). A WebGL / shared-renderer theme still builds synchronously.
     * @returns {boolean}
     */
    canUseAsyncLoadingSurface() {
        return this.isAsyncWarmEnabled() && isAsyncRenderPipelinesReady();
    }

    /**
     * True once `themeName` has created a pipeline async in this session (its renderer is on the
     * wrapped WebGPU backend), or declared `buildsPipelinesAsync` (a raw-WebGPU theme that creates
     * its own pipelines async), so a cold build of it will not freeze a loading surface beyond its
     * start(). Forgotten again when a surface releases it on a non-async backend (device loss).
     * @param {string|null|undefined} themeName
     * @returns {boolean}
     */
    isThemeKnownAsync(themeName) {
        return Boolean(themeName) && this._asyncEngagedThemes?.has(themeName) === true;
    }

    _rememberAsyncTheme(themeName) {
        if (!themeName) return;
        this._asyncEngagedThemes ??= new Set();
        this._asyncEngagedThemes.add(themeName);
    }

    /**
     * Resolves true when a theme armed under the current loading surface creates its first
     * pipeline async, or right after arming for a `buildsPipelinesAsync` theme (its build is
     * proven not to freeze the surface), false once the surface is
     * released without that. Lets a cold entry into a theme of unknown renderer kind keep the
     * calm-hold only until the build proves async. Pass the target theme's name: a session still
     * held open for another theme (a previous entry's retained surface) must not answer for it.
     * @param {string} [themeName]
     * @returns {Promise<boolean>}
     */
    whenLoadingSurfaceEngaged(themeName) {
        if (!(this._loadingSurfaceDepth > 0)) return Promise.resolve(false);
        for (const session of this._loadingSessions?.values() ?? []) {
            const engaged = session.engaged || session.surfaceEngaged === true;
            if (engaged && (!themeName || session.themeName === themeName)) return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            this._loadingEngagedWaiters ??= [];
            this._loadingEngagedWaiters.push({ themeName, resolve });
        });
    }

    _settleLoadingEngagedWaiters(engaged, themeName) {
        const waiters = this._loadingEngagedWaiters ?? [];
        this._loadingEngagedWaiters = waiters.filter((waiter) => {
            if (engaged && waiter.themeName && waiter.themeName !== themeName) return true;
            waiter.resolve(engaged);
            return false;
        });
    }

    /**
     * Declare that a loading surface (overlay, splash) covers the screen. Until the returned
     * release runs, themes started or resumed here create their render pipelines async, so the
     * surface keeps animating instead of freezing on a synchronous compile. Refcounted.
     * The release also carries `uncover()`: once the surface is off screen its sessions keep
     * running (late pipelines stay async), but themes started after that are no longer armed —
     * a later mode that owns its own reveal must not inherit a surface that no longer covers it.
     * `buildBudgetMs` (opt-in) also spreads the covered theme's first-time node builds over
     * frames, as the in-play switch does (SWITCH_BUILD_BUDGET_MS): a surface that animates while
     * the theme builds behind it (Odyssey's entry tunnel) otherwise stops for the theme's whole
     * first frame — 95 ms for Cinder Drift, 0.3-2.4 s for the heavy forest family. Only a surface
     * that waits for the session to settle before it lifts may ask (deferred builds draw later).
     * @param {string} [reason]
     * @param {{ buildBudgetMs?: number }} [options]
     * @returns {(() => void) & { uncover: () => void }} idempotent release
     */
    beginLoadingSurface(reason = 'loading', { buildBudgetMs = 0 } = {}) {
        if (!this.isAsyncWarmEnabled()) return Object.assign(() => {}, { uncover: () => {} });
        // Boots that skipped the intro may not have resolved the prototype yet; the surface
        // usually covers the screen for a while before the theme starts.
        this.preloadAsyncRenderPipelines().catch(() => {});
        this._loadingSurfaceDepth = (this._loadingSurfaceDepth ?? 0) + 1;
        this._loadingSurfaceCovering = (this._loadingSurfaceCovering ?? 0) + 1;
        this._loadingSessions ??= new Map();
        this._loadingSurfaceBudgets ??= new Set();
        const lease = { buildBudgetMs: Number.isFinite(buildBudgetMs) && buildBudgetMs > 0 ? buildBudgetMs : 0 };
        if (lease.buildBudgetMs > 0) this._loadingSurfaceBudgets.add(lease);
        let released = false;
        let covering = true;
        const uncover = () => {
            if (!covering) return;
            covering = false;
            this._loadingSurfaceCovering -= 1;
            // Themes started after the surface lifts are on screen: they build unbudgeted.
            this._loadingSurfaceBudgets.delete(lease);
        };
        const release = () => {
            if (released) return;
            released = true;
            uncover();
            this._loadingSurfaceDepth -= 1;
            if (this._loadingSurfaceDepth > 0) return;
            this._settleLoadingEngagedWaiters(false);
            for (const [theme, session] of this._loadingSessions) {
                // After a device loss WebGPU themes rebuild on the WebGL2 backend: forget them.
                if (!isAsyncPipelineBackend(theme?.renderer?.backend) && theme?.buildsPipelinesAsync !== true) {
                    this._asyncEngagedThemes?.delete(session.themeName);
                }
                performanceMonitor.recordEvent('theme_loading_surface_async_pipelines', {
                    reason,
                    theme: theme?.name,
                    ...session.end(),
                });
            }
            this._loadingSessions.clear();
        };
        return Object.assign(release, { uncover });
    }

    /** The tightest node-build budget a covering surface asked for (0 = build everything as met). */
    _loadingSurfaceBuildBudgetMs() {
        let buildBudgetMs = 0;
        for (const lease of this._loadingSurfaceBudgets ?? []) {
            buildBudgetMs = buildBudgetMs > 0 ? Math.min(buildBudgetMs, lease.buildBudgetMs) : lease.buildBudgetMs;
        }
        return buildBudgetMs;
    }

    _armLoadingSurfaceSession(theme, themeName) {
        if (!(this._loadingSurfaceCovering > 0) || !theme || this._loadingSessions?.has(theme)) return null;
        const session = beginAsyncRenderPipelines(theme, {
            label: `loading:${themeName}`,
            buildBudgetMs: this._loadingSurfaceBuildBudgetMs(),
        }); // sync; null if not preloaded
        if (session) {
            session.themeName = themeName;
            this._loadingSessions.set(theme, session);
            const engage = () => {
                session.surfaceEngaged = true; // also for a theme whose pipelines bypass three
                this._rememberAsyncTheme(themeName);
                if (session.active) this._settleLoadingEngagedWaiters(true, themeName);
            };
            // A raw-WebGPU theme (it declares buildsPipelinesAsync) creates its own pipelines async, off three.
            if (theme.buildsPipelinesAsync === true) queueMicrotask(engage);
            else session.onEngaged(engage);
        }
        return session;
    }

    /**
     * Wait (bounded) until the themes armed under the current loading surface have no async
     * pipeline in flight and requested none for a few frames — so the surface lifts onto a
     * complete frame rather than objects popping in.
     * @param {number} [maxMs]
     * @returns {Promise<boolean>}
     */
    async whenLoadingSurfacePipelinesSettled(maxMs = 5000) {
        const list = [...(this._loadingSessions?.values() ?? [])];
        if (list.length === 0) return true;
        const settled = await Promise.all(list.map((s) => s.settle({ maxMs, quietFrames: 6 })));
        return settled.every(Boolean);
    }

    /**
     * Boot-time pre-warm (AAA "compile shaders during the loading screen" pattern):
     * build a theme's scene + compile its WebGPU pipelines during the idle menu window
     * so the first mode entry resolves via the proven-smooth ~15ms quick-resume path
     * instead of paying a ~1s cold createScene under the loading overlay.
     *
     * Builds the theme HIDDEN (occluded, never flashed on the menu), lets its render
     * loop run until the scene graph stabilizes (deferred subsystems done) plus a buffer
     * of frames so the post-processing pipeline compiles through the real render path,
     * then parks it paused-as-pending. Never emits THEME_CHANGED (menu music/UI stay put);
     * the real entry's resume emits it. Best-effort: on failure the cold build + the
     * loading-overlay calm-hold still cover entry.
     *
     * Async path (default, rollback ?themeWarmAsync=0): the theme's own live renders create
     * their render pipelines with createRenderPipelineAsync (src/rendering/async-render-pipelines.js),
     * so the warm does not freeze the loading surface in front of it beyond the exempt
     * synchronous creates (PMREM bakes, the final composite). It exits once the scene is stable,
     * the theme is not busy AND no pipeline has been requested for a few frames, instead of 30
     * extra frames plus a bare whole-scene compileAsync sweep (an MRT-poison vector on MRT
     * themes). A theme still loading content keeps its session after parking until it is idle
     * (_retainPrewarmSession), so that content does not compile synchronously either.
     *
     * `standDown` is asked at every checkpoint: true abandons the warm. A mode that keeps themes
     * suspended while it renders its own scene (Odyssey's map) never makes a theme active, so the
     * activeTheme check alone let a menu-theme warm build and compile behind the live map
     * (a 1.9 s freeze 4 s after the reveal, measured 2026-10-19).
     *
     * @param {string} themeName
     * @param {{ maxWarmMs?: number, postWarmFrames?: number, asyncTailMs?: number,
     *   isThemeBusy?: ((theme: object) => boolean)|null,
     *   standDown?: (() => boolean)|null,
     *   onPhase?: ((phase: string, payload: object) => void)|null }} [options]
     * @returns {Promise<boolean>} true if the theme ended up warm + parked
     */
    async prewarmTheme(requestedTheme, {
        maxWarmMs = 7000,
        postWarmFrames = 30,
        asyncTailMs = 3000,
        isThemeBusy = null,
        standDown = null,
        onPhase = null,
    } = {}) {
        const themeName = resolveThemeId(requestedTheme);
        if (!themeName || this.isTransitioning) return false;
        if (this.isPackagedWindowsSafeMode()) return false;
        // Only pre-warm from the idle/suspended menu state — never over a live theme, and never
        // while a mode entry is building one (it is not published as active until it is built).
        if (this.activeTheme || !this.themesSuspended || this.activationsInFlightTotal > 0) return false;
        if (!getThemeMeta(themeName)) return false;

        // Already built + parked as the pending resume target? Nothing to do.
        const cached = this.themeInstances.get(themeName);
        if (cached?.hasStarted && this.pendingThemeInstance === cached && !this.activeTheme) {
            return true;
        }

        const nextFrame = () => new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve());
            } else {
                setTimeout(resolve, 16);
            }
        });

        const emitPhase = (name, payload = {}) => {
            try { onPhase?.(name, { theme: themeName, ...payload }); } catch (e) { /* diagnostics only */ }
        };
        const isBusy = (t) => {
            try { return isThemeBusy?.(t) === true; } catch (e) { return false; }
        };

        const prewarmGeneration = this.lifecycleGeneration;
        const { prewarmCancelGeneration } = this;
        const assertPrewarmOwner = (phase) => {
            if (this.isDisposed || prewarmGeneration !== this.lifecycleGeneration) {
                throw new Error(`Theme "${themeName}" prewarm was cancelled during ${phase}`);
            }
            if (prewarmCancelGeneration !== this.prewarmCancelGeneration) {
                const error = new Error(`Theme "${themeName}" prewarm stood down for an activation during ${phase}`);
                error.byActivation = true;
                throw error;
            }
            if (this.queuedSwitchRequest
                && this.queuedSwitchRequest.themeName !== themeName) {
                throw new Error(`Theme "${themeName}" prewarm was superseded during ${phase}`);
            }
            let stand = false;
            try { stand = standDown?.() === true; } catch (e) { stand = false; }
            if (stand) {
                const error = new Error(`Theme "${themeName}" prewarm stood down during ${phase}`);
                error.standDown = true;
                throw error;
            }
        };
        // Nothing loaded yet: a warm that would stand down at its first checkpoint never starts.
        try { if (standDown?.() === true) return false; } catch (e) { /* treat as not standing down */ }
        let theme = null;
        // A warm session the parked theme may keep while its deferred loading finishes.
        let retainedWarm = null;
        this.isTransitioning = true;
        try {
            theme = await this.loadTheme(themeName);
            assertPrewarmOwner('load');
            if (!theme) return false;
            if (this.activeTheme) {
                if (this.activeTheme === theme) return false;
                throw new Error(`Theme "${themeName}" prewarm was superseded by an active theme`);
            }
            this.prewarmingInstance = theme;

            if (!theme.hasStarted) {
                console.log(`[ThemeManager] Pre-warming theme (hidden): ${themeName}`);
                theme._prewarmHidden = true;
                // Synchronous: null unless the backend prototype was preloaded, so the await
                // structure (and the race-safety semantics) before theme.start are unchanged.
                const session = this.isAsyncWarmEnabled()
                    ? beginAsyncRenderPipelines(theme, { label: `prewarm:${themeName}` })
                    : null;
                if (theme.buildsPipelinesAsync === true) this._rememberAsyncTheme(themeName);
                else session?.onEngaged(() => this._rememberAsyncTheme(themeName));
                let asyncActive = false;
                let exitReason = 'max-warm';
                let warmWindowCompleted = false;
                const warmT0 = performance.now();
                emitPhase('start', { session: session !== null });
                try {
                    ensureThemeContainer(themeName);
                    const started = await withTimeout(
                        theme.start(this.webglRenderer, {
                            assetManager: this.assetManager,
                            audioManager: this.audioManager,
                            onRuntimeFailure: (error) => {
                                this.handleThemeRuntimeFailure(theme, themeName, error);
                            },
                        }),
                        this.getThemeLifecycleTimeout(themeName),
                        `Theme "${themeName}" prewarm`,
                    );
                    assertPrewarmOwner('start');
                    if (started === false) {
                        throw new Error(`Theme "${themeName}" prewarm was cancelled`);
                    }

                    const backend = theme.renderer?.backend;
                    asyncActive = session !== null
                        && backend?.isWebGPUBackend === true
                        && isAsyncPipelineBackend(backend);
                    // Classic / WebGL2 backend / shared renderer → the legacy warm below.
                    if (session && !asyncActive) session.end();
                    emitPhase('started', {
                        asyncActive,
                        // A dedicated classic/WebGL2 renderer compiles its programs synchronously
                        // in the frames ahead (the shared renderer's are few and warm).
                        syncRenderer: !asyncActive && theme.buildsPipelinesAsync !== true
                            && Boolean(theme.renderer) && theme.renderer !== this.webglRenderer,
                        startMs: Math.round(performance.now() - warmT0),
                        async: session?.stats.async ?? 0,
                    });

                    // Let the theme's own render loop compile scene pipelines: wait for
                    // the scene graph to stop growing (deferred rIC subsystems finished).
                    const startedAt = performance.now();
                    let stableFrames = 0;
                    let lastCount = -1;
                    for (;;) {
                        const elapsed = performance.now() - startedAt;
                        if (elapsed >= maxWarmMs) {
                            // Async: allow a bounded tail while pipelines are still in flight.
                            const tail = asyncActive && session.inFlight > 0 && elapsed < maxWarmMs + asyncTailMs;
                            if (!tail) {
                                exitReason = asyncActive && session.inFlight > 0 ? 'tail-cap' : 'max-warm';
                                break;
                            }
                        }
                        try {
                            // eslint-disable-next-line no-await-in-loop
                            await withTimeout(
                                nextFrame(),
                                asyncActive ? 3000 : 1000,
                                `Theme "${themeName}" prewarm frame`,
                            );
                        } catch (frameError) {
                            if (!asyncActive) throw frameError; // legacy semantics unchanged
                            // A multi-second main-thread TSL build is not a broken theme: park
                            // the warm instead of throwing it away.
                            exitReason = 'frame-timeout';
                            break;
                        }
                        if (asyncActive) session.noteFrame();
                        assertPrewarmOwner('scene stabilization');
                        if (this.activeTheme) { // user entered — abandon warm
                            exitReason = 'entered';
                            break;
                        }
                        const count = theme.scene?.children?.length ?? 0;
                        if (count === lastCount) {
                            stableFrames += 1;
                        } else {
                            stableFrames = 0;
                            lastCount = count;
                        }
                        if (asyncActive) {
                            if (stableFrames >= 30 && session.isQuiet(12) && !isBusy(theme)) {
                                exitReason = 'quiet';
                                break;
                            }
                        } else if (stableFrames >= 45) {
                            exitReason = 'stable';
                            break;
                        }
                    }

                    // Legacy path only: extra frames so post-processing + any late materials
                    // compile through the real render path (post pipelines are NOT covered by
                    // compileAsync(scene) — they compile on the first post.render()). The async
                    // path already requested them from the live loop above.
                    for (let i = 0; !asyncActive && i < postWarmFrames && !this.activeTheme; i += 1) {
                        // eslint-disable-next-line no-await-in-loop
                        await withTimeout(
                            nextFrame(),
                            1000,
                            `Theme "${themeName}" post-warm frame`,
                        );
                        assertPrewarmOwner('post-warm frames');
                    }

                    // Final compile sweep for stragglers (legacy path only).
                    if (!asyncActive
                        && typeof theme.renderer?.compileAsync === 'function'
                        && theme.scene
                        && theme.camera) {
                        try {
                            await withTimeout(
                                Promise.resolve(theme.renderer.compileAsync(theme.scene, theme.camera)),
                                3000,
                                `Theme "${themeName}" final prewarm compile`,
                            );
                        } catch (compileErr) {
                            console.warn(
                                `[ThemeManager] Final prewarm compile skipped for "${themeName}":`,
                                compileErr,
                            );
                        }
                        assertPrewarmOwner('final compile');
                    }
                    emitPhase('settled', { asyncActive, exitReason, inFlight: session?.inFlight ?? 0 });
                    warmWindowCompleted = true;
                } finally {
                    theme._prewarmHidden = false;
                    const finish = (endReason) => {
                        const stats = session ? session.end() : null;
                        if (stats && asyncActive) {
                            const report = {
                                theme: themeName,
                                exitReason,
                                endReason,
                                warmMs: Math.round(performance.now() - warmT0),
                                ...stats,
                                ...getAsyncRenderPipelineDiagnostics(),
                            };
                            performanceMonitor.recordEvent('theme_prewarm_async_pipelines', report);
                            if (typeof window !== 'undefined') window.__THEME_WARM_ASYNC__ = report;
                        }
                        emitPhase('end', { asyncActive, exitReason, endReason });
                    };
                    // A theme that is still loading content (building chunks, deferred materials,
                    // its own compileAsync) keeps the async session after parking, so that
                    // content never compiles synchronously in front of the boot screen.
                    if (warmWindowCompleted && asyncActive && session?.active
                        && (isBusy(theme) || session.inFlight > 0)) {
                        retainedWarm = { session, finish };
                    } else {
                        finish(warmWindowCompleted ? 'settled' : 'failed');
                    }
                }
            }

            // If the user entered a mode mid-warm, activateThemeInstance already took
            // over — don't clobber it.
            if (this.activeTheme) {
                retainedWarm?.finish('entered');
                retainedWarm = null;
                if (this.activeTheme !== theme) {
                    this.disposeThemeInstance(theme, themeName, {
                        removeFromCache: true,
                    });
                } else {
                    // The warm's own hidden start may have been the one that built it.
                    this.revealThemeContainer(theme, themeName);
                }
                return false;
            }
            assertPrewarmOwner('parking');

            // Park it: pause the loop, keep GPU resources warm, expose as the pending
            // resume target. Mirrors the state suspendThemes() leaves for an active
            // theme, which resumeThemes() quick-resumes smoothly.
            const paused = typeof theme.pause === 'function'
                ? theme.pause()
                : false;
            if (!paused
                || theme.isPaused !== true
                || theme.lifecycleState !== 'paused') {
                throw new Error(`Theme "${themeName}" could not be paused after prewarm`);
            }
            assertPrewarmOwner('state publication');
            this.pendingThemeInstance = theme;
            this.pendingThemeName = themeName;
            this.activeThemeName = themeName;
            this.activeTheme = null;
            this.themesSuspended = true;
            console.log(`[ThemeManager] Theme pre-warmed + parked for instant first entry: ${themeName}`);
            if (retainedWarm) {
                this._retainPrewarmSession(theme, themeName, retainedWarm, { isBusy });
                retainedWarm = null;
            }
            return true;
        } catch (error) {
            retainedWarm?.finish('failed');
            retainedWarm = null;
            if (error?.byActivation) {
                // A mode entry took over. It owns the instance it is starting: neither park it nor
                // dispose it. Only a warm of a theme nobody is starting is thrown away.
                console.log(`[ThemeManager] Pre-warm of "${themeName}" stood down for an activation`);
                if (theme && this.activeTheme !== theme && !this.activationsInFlight.has(theme)) {
                    this.disposeThemeInstance(theme, themeName, { removeFromCache: true });
                }
                return false;
            }
            if (error?.standDown) console.log(`[ThemeManager] ${error.message}`);
            else console.warn(`[ThemeManager] prewarmTheme failed for "${themeName}":`, error);
            if (theme && this.activeTheme !== theme) {
                this.disposeThemeInstance(theme, themeName, {
                    removeFromCache: true,
                });
            }
            return false;
        } finally {
            if (this.prewarmingInstance === theme) this.prewarmingInstance = null;
            this.isTransitioning = false;
            // A user switch requested during the prewarm window was queued —
            // honor it now (same contract as switchTheme's finally).
            if (!this.isDisposed) {
                this.drainQueuedThemeSwitch();
            }
        }
    }

    suspendThemes() {
        // This token makes a suspension request observable even when activation
        // began while themesSuspended was already true (for example resume from
        // the menu). A boolean alone cannot distinguish that race.
        this.suspensionGeneration += 1;
        this._standDownSwitchBehind();
        if (this.activeTheme) {
            console.log('[ThemeManager] Suspending active theme:', this.activeThemeName);
            const paused = this.allowSuspendedRuntimeReuse
                && typeof this.activeTheme.pause === 'function'
                ? this.activeTheme.pause()
                : false;

            if (!paused) {
                this.activeTheme.stop();
            }

            this.pendingThemeInstance = this.activeTheme;
            this.pendingThemeName = this.activeThemeName;
            this.activeTheme = null;
        } else if (
            this.pendingThemeInstance
            // A parked theme is already suspended; keep it when the policy keeps suspended
            // runtimes (packaged Windows before startup completes does not).
            && !(this.allowSuspendedRuntimeReuse && this.isParkedThemeInstance(this.pendingThemeInstance))
            && (
                this.pendingThemeInstance.isActive === true
                || this.pendingThemeInstance.lifecycleState === 'starting'
            )
        ) {
            // A mode can suspend while activateThemeInstance() is awaiting a
            // heavy scene start. Invalidate that start synchronously so its
            // later completion cannot publish an active theme behind the menu.
            // The object itself is terminally retired: restarting the same
            // mutable instance before its old createScene() settles lets the old
            // continuation overwrite the new renderer/scene.
            console.log('[ThemeManager] Cancelling in-flight activation for suspension:', this.pendingThemeName);
            const pendingTheme = this.pendingThemeInstance;
            const pendingThemeName = this.pendingThemeName || this.activeThemeName;
            this.activationAttempts.set(
                pendingTheme,
                this.cancelledActivationAttempt,
            );
            this.disposeThemeInstance(pendingTheme, pendingThemeName, {
                removeFromCache: true,
            });
            this.pendingThemeInstance = null;
            this.pendingThemeName = pendingThemeName;
            this.activeThemeName = pendingThemeName;
        }

        if (!this.allowSuspendedRuntimeReuse) {
            this.clearRendererThemeResources();
            console.log('[ThemeManager] Theme suspended, renderer resources released');
        } else {
            console.log('[ThemeManager] Theme suspended, renderer preserved for quick resume');
        }

        this.themesSuspended = true;
    }

    async resumeLatestThemeIntent(staleThemeInstance, staleThemeName) {
        // Let the newer switch finish publishing its pending/active ownership
        // before deciding whether the stale load is still cache-only.
        const activeSwitch = this.switchDrainPromise;
        if (activeSwitch) {
            await activeSwitch;
        }

        const latestOwnsStaleInstance = this.activeTheme === staleThemeInstance
            || this.pendingThemeInstance === staleThemeInstance;
        if (staleThemeInstance
            && !latestOwnsStaleInstance
            && this.themeInstances.get(staleThemeName) === staleThemeInstance) {
            this.disposeThemeInstance(staleThemeInstance, staleThemeName, {
                removeFromCache: true,
            });
        }

        if (!this.isDisposed && this.themesSuspended) {
            return this.resumeThemes();
        }
        return undefined;
    }

    /**
     * The tab is visible again: resume the active theme, which main.js paused directly when the
     * tab was hidden. A theme that refuses because a rebuild is pending (a quality change made
     * while hidden) is restarted once instead; BaseTheme.resume() will not resume a runtime that
     * is about to be rebuilt.
     */
    resumeActiveThemeAfterHiddenTab() {
        const theme = this.activeTheme;
        if (!theme) return;
        const resumed = typeof theme.resume === 'function' ? theme.resume() : true;
        if (resumed === false && theme.rebuildPending === true) {
            this.activateThemeInstance(theme, this.activeThemeName, this.themeRuntimeContext)
                .catch((error) => {
                    console.warn('[ThemeManager] Theme restart after a hidden quality change failed:', error);
                });
            return;
        }
        // Always force-restart the animation loop on resume to ensure the RAF chain is running,
        // regardless of _wasPaused state. restartRenderLoop() covers themes such as Ocean that
        // expose startAnimation() rather than animate().
        theme._wasPaused = false;
        if (typeof theme.restartRenderLoop === 'function') {
            requestAnimationFrame(() => theme.restartRenderLoop());
        } else if (typeof theme.animate === 'function') {
            requestAnimationFrame(() => theme.animate());
        }
    }

    async resumeThemes() {
        // A switch requested while themes are suspended can still be loading its
        // target. Wait for that transaction to publish the latest pending owner
        // before deciding what to resume; otherwise the outgoing name can be
        // resurrected for a single frame and immediately torn down again.
        const activeSwitch = this.switchDrainPromise;
        if (activeSwitch) {
            await activeSwitch;
            if (this.isDisposed) {
                return undefined;
            }
            return this.resumeThemes();
        }

        if (!this.themesSuspended) {
            console.log('[ThemeManager] Themes not suspended, nothing to resume');
            return undefined;
        }

        const themeName = this.pendingThemeName || this.activeThemeName;
        const context = this.themeRuntimeContext;
        if (themeName && !this.themeAccess.canUse(themeName, context)) {
            if (this.isOdysseyThemeScopeActive()) return undefined;
            await this.switchTheme(this.themeAccess.getRestoreTheme(), true);
            return this.resumeThemes();
        }
        const resumeSuspensionGeneration = this.suspensionGeneration;
        const resumeIntentGeneration = this.themeIntentGeneration;
        let themeInstance = this.pendingThemeInstance
            || (themeName ? this.themeInstances.get(themeName) : null);

        if (!themeName) {
            console.warn('[ThemeManager] No theme queued to resume');
            this.themesSuspended = false;
            return undefined;
        }

        if (!themeInstance) {
            console.log('[ThemeManager] Loading a fresh theme identity for resume:', themeName);
            themeInstance = await this.loadTheme(themeName);
            if (this.isDisposed) {
                this.disposeThemeInstance(themeInstance, themeName, {
                    removeFromCache: true,
                });
                return undefined;
            }
            if (resumeIntentGeneration !== this.themeIntentGeneration) {
                return this.resumeLatestThemeIntent(themeInstance, themeName);
            }
            if (!this.themeAccess.canUse(themeName, context)) {
                if (this.isOdysseyThemeScopeActive()) return undefined;
                await this.switchTheme(this.themeAccess.getRestoreTheme(), true);
                return this.resumeThemes();
            }
            if (resumeSuspensionGeneration !== this.suspensionGeneration) {
                this.disposeThemeInstance(themeInstance, themeName, {
                    removeFromCache: true,
                });
                return undefined;
            }
            this.pendingThemeInstance = themeInstance;
            this.pendingThemeName = themeName;
        }

        console.log(
            '[ThemeManager] Resuming themes - themeName:',
            themeName,
            'isActive:',
            themeInstance.isActive,
            'pendingTheme:',
            !!this.pendingThemeInstance,
        );

        // Check if theme was ever started (has isActive been true before)
        // If the theme was loaded but never started, we need to do full activation
        const wasNeverStarted = !themeInstance.hasStarted && this.pendingThemeInstance === themeInstance;

        if (wasNeverStarted) {
            console.log('[ThemeManager] Theme was never started, performing full activation');
            await this.activateThemeInstance(themeInstance, themeName, context);
            if (resumeIntentGeneration !== this.themeIntentGeneration) {
                return this.resumeLatestThemeIntent(themeInstance, themeName);
            }
            return undefined;
        }

        // Only an actually-paused runtime is safe to resume in place. A stopped
        // instance must take the full activation path so its scene and loops rebuild.
        const canQuickResume = this.allowSuspendedRuntimeReuse
            && themeInstance === this.pendingThemeInstance
            && !this.activeTheme
            && themeInstance.isPaused === true
            && themeInstance.lifecycleState === 'paused';
        if (canQuickResume) {
            console.log('[ThemeManager] Attempting quick resume for theme:', themeName);

            this.activeTheme = themeInstance;
            this.activeThemeName = themeName;
            this.themesSuspended = false;

            // Try to resume the theme (restores contexts without recreating scene)
            this._armLoadingSurfaceSession(themeInstance, themeName);
            const resumed = typeof themeInstance.resume === 'function'
                ? themeInstance.resume()
                : false;

            if (!resumed) {
                // Resume failed or not supported, do full restart
                console.log('[ThemeManager] Quick resume failed, performing full restart');
                await this.activateThemeInstance(themeInstance, themeName, context);
                if (resumeIntentGeneration !== this.themeIntentGeneration) {
                    return this.resumeLatestThemeIntent(themeInstance, themeName);
                }
            } else {
                // Successfully resumed
                this.pendingThemeInstance = null;
                this.pendingThemeName = null;

                // Restart the render loop. Most themes only start their loop in
                // createScene(), so resume() alone leaves them frozen — restart it
                // generically (base.restartRenderLoop tries animate/startAnimationLoop/
                // startAnimation; guards prevent a double-start).
                if (typeof themeInstance.restartRenderLoop === 'function') {
                    themeInstance.restartRenderLoop();
                } else if (typeof themeInstance.animate === 'function') {
                    themeInstance.animate();
                }

                eventBus.emit(EVENTS.THEME_CHANGED, { themeName });
                console.log('[ThemeManager] Theme resumed successfully (quick resume):', themeName);

                // BULLETPROOF SAFETY NET: guarantee the theme is actually producing
                // frames. Themes start their loop with varied method names/guards, so
                // restartRenderLoop() can still miss one and leave the theme frozen.
                // Verify by watching the renderer; if no frames, rebuild it cleanly so a
                // theme can NEVER stay frozen after a pre-warmed resume. Fire-and-forget
                // so the common (working) case doesn't wait.
                this._ensureThemeRendering(themeInstance, themeName).catch((error) => {
                    console.warn('[ThemeManager] render-verify failed:', error?.message || error);
                });
            }
        } else {
            // Different theme or no pending instance, do full activation
            console.log('[ThemeManager] Performing full theme activation');
            await this.activateThemeInstance(themeInstance, themeName, context);
            if (resumeIntentGeneration !== this.themeIntentGeneration) {
                return this.resumeLatestThemeIntent(themeInstance, themeName);
            }
        }
        return undefined;
    }

    /**
     * Verify a just-resumed theme is actually rendering; if it produced no frames within
     * a short window (its loop failed to restart), rebuild it cleanly via a fresh
     * createScene — which ALWAYS starts the loop. Guarantees a resumed (e.g. pre-warmed)
     * theme is never left frozen, regardless of its loop-start method name. Worst case is
     * the cold build the pre-warm meant to avoid (covered by the loading overlay), not a
     * dead theme.
     * @param {BaseTheme} themeInstance
     * @param {string} themeName
     * @returns {Promise<void>}
     */
    async _ensureThemeRendering(themeInstance, themeName) {
        const renderer = themeInstance?.renderer;
        if (!renderer || typeof renderer.render !== 'function') {
            return; // can't verify (e.g. shared-renderer themes) — assume ok
        }

        const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
        const nextFrame = () => new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
            else setTimeout(resolve, 16);
        });

        let rendered = false;
        const origRender = renderer.render.bind(renderer);
        const origRenderAsync = typeof renderer.renderAsync === 'function' ? renderer.renderAsync.bind(renderer) : null;
        renderer.render = (...args) => { rendered = true; return origRender(...args); };
        if (origRenderAsync) {
            renderer.renderAsync = (...args) => { rendered = true; return origRenderAsync(...args); };
        }

        try {
            const startedAt = now();
            // Give the loop up to ~700ms to fire a frame (generous for slow GPUs).
            while (!rendered && now() - startedAt < 700) {
                // eslint-disable-next-line no-await-in-loop
                await nextFrame();
            }
        } finally {
            renderer.render = origRender;
            if (origRenderAsync) renderer.renderAsync = origRenderAsync;
        }

        if (!rendered && this.activeTheme === themeInstance && !this.isTransitioning) {
            console.warn(`[ThemeManager] Resumed theme "${themeName}" produced no frames — rebuilding to recover.`);
            try {
                await this.activateThemeInstance(themeInstance, themeName, this.themeRuntimeContext);
            } catch (error) {
                console.error(`[ThemeManager] Recovery rebuild failed for "${themeName}":`, error);
            }
        }
    }

    async waitForThemeReady(timeoutMs = 3000) {
        if (this.activeTheme?.isActive) {
            return true;
        }

        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    // Defined immediately below before this timer can run.
                    // eslint-disable-next-line no-use-before-define
                    unsubscribe();
                    console.warn('[ThemeManager] Theme readiness timed out after', timeoutMs, 'ms');
                    resolve(false);
                }
            }, timeoutMs);

            const unsubscribe = eventBus.on(EVENTS.THEME_CHANGED, () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    unsubscribe();
                    requestAnimationFrame(() => resolve(true));
                }
            });
        });
    }

    /**
     * Background mode "As you level up": the theme for `level`'s stretch of levels.
     * @param {number} level - Current game level
     * @returns {string} Theme name
     */
    getThemeForLevel(level) {
        return this.levelJourney.themeFor(level);
    }

    /** Start the journey over (a new game, or the mode just chosen); returns its first theme. */
    restartLevelJourney(level = 1, startTheme = null) {
        return this.levelJourney.restart(level, startTheme && resolveThemeId(startTheme));
    }

    /** Called as a game runs in that mode: switches once when a new stretch of levels begins. */
    followLevelJourney(level) {
        const theme = this.levelJourney.nextSwitch(level, this.activeThemeName);
        return theme ? this.switchTheme(theme) : null;
    }

    getAvailableThemes() {
        return this.themeAccess.getOwnedThemes();
    }

    isThemeUnlocked(themeId) {
        return this.themeAccess.isUnlocked(themeId);
    }

    canSelectTheme(themeId) {
        return this.themeAccess.canUse(themeId);
    }

    isOdysseyThemeScopeActive() {
        return this.themeAccess.isScopeActive();
    }

    beginOdysseyThemeScope(themeId, options) {
        return this.themeAccess.begin(themeId, options);
    }

    /** Revoke before awaiting restoration so delayed orb starts cannot escape the mode. */
    async endOdysseyThemeScope(scope) {
        const restoreTheme = this.themeAccess.end(scope);
        if (!restoreTheme || this.isDisposed) return this.activeThemeName;
        return this.switchTheme(restoreTheme, true);
    }

    /**
     * Shuffle the theme deck to ensure all themes are visited before repeating
     * @param {string|null} exclude - the theme showing now, left out of the new deck
     * @private
     */
    _shuffleThemeDeck(exclude = this.activeThemeName) {
        this.themeShuffleDeck = shuffleInPlace(this.getAvailableThemes().filter((name) => name !== exclude));
        console.log(`[ThemeManager] Shuffled theme deck with ${this.themeShuffleDeck.length} themes`);
    }

    /**
     * A theme the collection just granted goes on top of the deck, so the next random or
     * level change shows it. Other collection updates (a theme marked seen) keep the deck.
     * @private
     */
    _dealNewThemesOnTop() {
        const owned = this.getAvailableThemes();
        const fresh = owned.filter((id) => !this.knownOwnedThemes.has(id));
        this.knownOwnedThemes = new Set(owned);
        if (fresh.length > 0) this.themeShuffleDeck = dealOnTop(this.themeShuffleDeck || [], fresh);
    }

    /**
     * Get a random theme (excluding current) using shuffle deck system
     * Ensures all themes are visited before any theme repeats
     * @param {string|null} exclude - the theme not to draw (defaults to the active one)
     * @returns {string} Theme name
     */
    getRandomTheme(exclude = this.activeThemeName) {
        this.themeShuffleDeck = (this.themeShuffleDeck || []).filter(
            (id) => id !== exclude && this.isThemeUnlocked(id),
        );
        // If deck is empty or doesn't exist, reshuffle
        if (!this.themeShuffleDeck || this.themeShuffleDeck.length === 0) {
            this._shuffleThemeDeck(exclude);
        }

        // Draw from the top of the deck
        const nextTheme = this.themeShuffleDeck.pop() || this.themeAccess.getRestoreTheme();
        console.log(`[ThemeManager] Drew theme from deck: ${nextTheme} (${this.themeShuffleDeck.length} remaining)`);

        return nextTheme;
    }

    /**
     * Switch to a random theme immediately
     */
    switchToRandomTheme() {
        const randomTheme = this.getRandomTheme();
        this.switchTheme(randomTheme);
    }

    /**
     * Start random theme switching at interval
     * @param {number} intervalMinutes - Minutes between theme changes
     */
    startRandomThemeInterval(intervalMinutes) {
        this.stopRandomThemeInterval();

        const intervalMs = intervalMinutes * 60 * 1000;
        this.randomThemeInterval = setInterval(() => {
            const randomTheme = this.getRandomTheme();
            this.switchTheme(randomTheme);
        }, intervalMs);
    }

    /**
     * Stop random theme switching
     */
    stopRandomThemeInterval() {
        if (this.randomThemeInterval) {
            clearInterval(this.randomThemeInterval);
            this.randomThemeInterval = null;
        }
    }

    /**
     * Clean up specific theme instance
     * @param {string} themeName - Theme to clean up
     */
    cleanupTheme(themeName) {
        const theme = this.themeInstances.get(themeName);
        if (theme) {
            this.disposeThemeInstance(theme, themeName, {
                removeFromCache: true,
            });
        }
    }

    /**
     * Clean up all theme resources
     */
    cleanup() {
        if (this.isDisposed) {
            return;
        }
        console.log('[ThemeManager] Starting full cleanup...');

        this.isDisposed = true;
        this.themeAccess.cleanup();
        this.unsubscribeThemeCollection?.();
        this.unsubscribeThemeCollection = null;
        this.lifecycleGeneration += 1;
        this.themeIntentGeneration += 1;
        this.stopRandomThemeInterval();
        this.clearAdjacentThemePreloadQueue();
        this.deferAdjacentThemePreload = false;
        this.pendingAdjacentThemePreload = false;
        this.queuedSwitchRequest = null;
        this.inFlightThemeLoads.clear();

        const switchWaiters = this.queuedSwitchWaiters;
        this.queuedSwitchWaiters = [];
        switchWaiters.forEach((resolve) => {
            try {
                resolve(null);
            } catch (error) {
                console.warn('[ThemeManager] Failed to settle switch during cleanup:', error);
            }
        });

        // Stop all audio before cleaning up
        const stopAudio = this.audioManager?.stopBackgroundMusic || this.audioManager?.stopAll;
        if (stopAudio) {
            console.log('[ThemeManager] Stopping all audio');
            try {
                stopAudio.call(this.audioManager);
            } catch (error) {
                console.warn('[ThemeManager] Audio cleanup failed:', error);
            }
        }

        this._standDownSwitchBehind();

        // active/pending instances are not guaranteed to remain cached while an
        // asynchronous transition is in flight. Dispose every known identity once.
        const themeNamesByInstance = new Map();
        for (const [themeName, theme] of this.themeInstances) {
            themeNamesByInstance.set(theme, themeName);
        }
        if (this.activeTheme) {
            themeNamesByInstance.set(
                this.activeTheme,
                this.activeThemeName || this.activeTheme.name,
            );
        }
        if (this.pendingThemeInstance) {
            themeNamesByInstance.set(
                this.pendingThemeInstance,
                this.pendingThemeName || this.pendingThemeInstance.name,
            );
        }

        console.log(`[ThemeManager] Cleaning up ${themeNamesByInstance.size} theme instances`);
        for (const [theme, themeName] of themeNamesByInstance) {
            console.log(`[ThemeManager] Cleaning up theme: ${themeName}`);
            try {
                this.disposeThemeInstance(theme, themeName);
            } catch (error) {
                // disposeThemeInstance already isolates ordinary subclass failures,
                // but keep terminal cleanup progressing even for pathological
                // accessors/proxies that throw during the manager's final sweep.
                console.warn(`[ThemeManager] Terminal theme cleanup failed: ${themeName}`, error);
            }
        }
        this.themeInstances.clear();
        this.pendingThemeInstance = null;
        this.pendingThemeName = null;
        this.disposeTerminalThemeResources();

        // Clean up renderer resources after themes release their references
        if (this.webglRenderer && typeof this.webglRenderer.cleanup === 'function') {
            console.log('[ThemeManager] Cleaning up renderer');
            try {
                this.webglRenderer.cleanup();
            } catch (error) {
                console.warn('[ThemeManager] Renderer cleanup failed:', error);
            }
        }

        // Clear LRU tracking
        this.themeLRU = [];

        this.activeTheme = null;
        this.activeThemeName = null;
        this.themesSuspended = true;
        this.webglRenderer = null;

        console.log('✅ [ThemeManager] Cleanup complete');
    }

    /**
     * Update active theme (called each frame if needed)
     * @param {number} deltaTime - Time since last update
     */
    update(deltaTime) {
        if (this.activeTheme && typeof this.activeTheme.update === 'function') {
            this.activeTheme.update(deltaTime);
        }
    }

    /**
     * Handle window resize
     * @param {number} width - New window width
     * @param {number} height - New window height
     */
    resize(width, height) {
        if (this.activeTheme && typeof this.activeTheme.resize === 'function') {
            this.activeTheme.resize(width, height);
        }
    }
}
