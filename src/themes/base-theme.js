/**
 * @fileoverview Base Theme Class - Abstract class for all Serenity Blocks themes
 * Provides common interface and lifecycle methods for theme implementations
 */

import { gpuResilience } from '../utils/gpu-context-resilience.js';
import { initGpuLossCoordinator } from '../utils/gpu-loss-coordinator.js';
import { eventBus, EVENTS } from '../events/event-bus.js';
import { computeScenePixelRatio } from '../utils/desktop-performance-policy.js';
import {
    createFramePacer, resetFramePacer, shouldRenderAtTargetFps, resolveTargetFps,
} from './theme-frame-pacer.js';
import { readFlag } from '../core/flags.js';

// Global render scale (set by settings system)
let globalRenderScale = 1.0;

// Global antialiasing setting (set by settings system)
let globalAntialiasEnabled = true;

/**
 * Set the global render scale for all themes
 * @param {number} scale - Render scale (0.25 to 2.0, where > 1.0 is supersampling)
 */
export function setGlobalRenderScale(scale) {
    globalRenderScale = Math.max(0.25, Math.min(2.0, scale));
    console.log(`[BaseTheme] Global render scale set to: ${globalRenderScale}`);
}

/**
 * Get the current global render scale
 * @returns {number}
 */
export function getGlobalRenderScale() {
    return globalRenderScale;
}

/**
 * Set the global antialiasing setting for all themes
 * @param {boolean} enabled - Whether antialiasing is enabled
 */
export function setGlobalAntialias(enabled) {
    globalAntialiasEnabled = !!enabled;
    console.log(`[BaseTheme] Global antialiasing set to: ${globalAntialiasEnabled}`);
}

/**
 * Get the current global antialiasing setting
 * @returns {boolean}
 */
export function getGlobalAntialias() {
    return globalAntialiasEnabled;
}

// Automatically squash the render scale globally if performance drops
eventBus.on(EVENTS.PERFORMANCE_DOWNSCALE, () => {
    const currentScale = getGlobalRenderScale();
    if (currentScale > 0.5) {
        const newScale = Math.max(0.5, currentScale - 0.25);
        console.warn(`[BaseTheme] Adaptive Downscaling: ${currentScale} -> ${newScale}`);
        setGlobalRenderScale(newScale);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'renderScale', value: newScale });
    }
});

/**
 * Stop a WebGPU renderer issuing new timestamp queries and collect the resolves
 * still in flight on its query pools (three r185 `WebGPUTimestampQueryPool#pendingResolve`).
 * Returns [] for WebGL renderers, mocks, or an idle backend — callers treat that
 * as "safe to release synchronously".
 * @param {any} renderer
 * @returns {Promise<any>[]}
 */
function collectPendingTimestampResolves(renderer) {
    const backend = renderer?.backend;
    if (!backend || backend.isWebGPUBackend !== true) return [];
    try {
        backend.trackTimestamp = false;
    } catch (error) {
        /* read-only mock — nothing to quiesce */
    }
    const pools = backend.timestampQueryPool;
    if (!pools || typeof pools !== 'object') return [];
    return Object.values(pools)
        .map((pool) => pool?.pendingResolve)
        .filter((pending) => pending && typeof pending.then === 'function');
}

/**
 * Abstract base class for all themes
 * Each theme should extend this class and implement its methods
 */
export class BaseTheme {
    /**
     * @param {string} name - Unique theme identifier
     * @param {Object} options - Theme-specific configuration
     */
    constructor(name, options = {}) {
        if (new.target === BaseTheme) {
            throw new Error('BaseTheme is abstract and cannot be instantiated directly');
        }

        this.name = name;
        this.options = options;
        this.isActive = false;
        this.isPaused = false;
        this.hasStarted = false;
        this.lifecycleState = 'initialized';
        this.lifecycleGeneration = 0;
        this.cleanupComplete = false;
        this._startRequestGeneration = 0;
        this._startInFlight = null;
        this.onRuntimeFailure = null;
        this.resourceProfile = 'light';
        this.animationIds = [];
        this.containers = [];
        this.webglLayers = [];
        // Caps the theme's render loop to the player's Target Frame Rate.
        // `?noThemeFpsCap=1` (or localStorage serenity.noThemeFpsCap=1) disables it.
        this._framePacer = createFramePacer();
    }

    /**
     * Initialize theme resources (called once on first use)
     * Override this to set up theme-specific resources
     * @returns {Promise<void>}
     */
    async init() {
        // Override in subclass
    }

    /**
     * Start theme animations and effects
     * Called when theme becomes active
     * @param {WebGLRenderer} webglRenderer - WebGL renderer instance
     * @param {Object} managers - Optional resource managers { assetManager, audioManager }
     * @returns {Promise<void>}
     */
    async start(webglRenderer, managers = {}) {
        const requestGeneration = ++this._startRequestGeneration;
        const requestLifecycleGeneration = this.lifecycleGeneration;
        const previousStart = this._startInFlight;

        // A theme instance exposes mutable scene/renderer fields, so two
        // createScene() calls on that identity can never safely overlap: an
        // older continuation could otherwise publish into the newer runtime.
        // Queue starts per instance and keep only the latest waiting request.
        if (previousStart) {
            try {
                await previousStart;
            } catch {
                // The previous caller receives its own failure. This request
                // independently decides below whether it still owns a retry.
            }
        }

        if (requestGeneration !== this._startRequestGeneration) {
            console.warn('[BaseTheme] Dropping superseded queued start:', this.name);
            return false;
        }
        if (previousStart && requestLifecycleGeneration !== this.lifecycleGeneration) {
            console.warn('[BaseTheme] Dropping queued start invalidated by stop/cleanup:', this.name);
            return false;
        }
        if (this.cleanupComplete) {
            throw new Error(`Theme "${this.name}" cannot restart after terminal cleanup`);
        }

        const startAttempt = this.runStartAttempt(webglRenderer, managers);
        this._startInFlight = startAttempt;
        try {
            return await startAttempt;
        } finally {
            if (this._startInFlight === startAttempt) {
                this._startInFlight = null;
            }
        }
    }

    /**
     * Execute one serialized start attempt.
     * @param {WebGLRenderer} webglRenderer
     * @param {Object} managers
     * @returns {Promise<void|boolean>}
     */
    async runStartAttempt(webglRenderer, managers = {}) {
        console.log('[BaseTheme] start() called, state:', this.lifecycleState, 'theme:', this.name);

        if (this.cleanupComplete) {
            throw new Error(`Theme "${this.name}" cannot restart after terminal cleanup`);
        }

        if (this.isActive || this.isPaused) {
            console.warn('[BaseTheme] Theme already active or paused, stopping before restart:', this.name);
            this.stop();
            // start() means a full scene rebuild, not a pause/resume. Release
            // the previous standard runtime before a new createScene() can
            // replace its fields and orphan the old renderer/post chain.
            this.releaseManagedGpuResources();
        }

        const startGeneration = ++this.lifecycleGeneration;
        this.lifecycleState = 'starting';
        this.isActive = true;
        this.isPaused = false;
        this.webglRenderer = webglRenderer;

        // Store resource managers for efficient asset loading
        this.assetManager = managers.assetManager;
        this.audioManager = managers.audioManager;
        this.onRuntimeFailure = typeof managers.onRuntimeFailure === 'function'
            ? managers.onRuntimeFailure
            : this.onRuntimeFailure;

        console.log('[BaseTheme] Starting theme:', this.name);
        console.log(
            '[BaseTheme] Shared renderer:',
            this.webglRenderer?.constructor?.name || 'unavailable',
        );
        console.log(
            '[BaseTheme] Has loadTheme?',
            this.webglRenderer && typeof this.webglRenderer.loadTheme,
        );

        // Activate the DOM theme container
        const themeContainer = document.getElementById(`${this.name}-theme`);
        if (themeContainer) {
            if (this._prewarmHidden) {
                // Boot-time pre-warm: build + compile the theme's WebGPU pipelines
                // while the container stays HIDDEN (default .theme-container CSS is
                // opacity:0/visibility:hidden but keeps full size, so the render loop
                // still warms). Do NOT add 'active' — the reveal happens on the real
                // first mode entry via resume(). Keeps the cold ~1s build off both the
                // menu and the loading overlay.
                console.log('[BaseTheme] Pre-warming theme container (hidden):', this.name);
                themeContainer.classList.remove('active');
            } else {
                console.log('[BaseTheme] Activating theme container:', this.name);
                // Remove active class from all theme containers
                document.querySelectorAll('.theme-container').forEach((container) => {
                    container.classList.remove('active');
                });
                themeContainer.style.removeProperty('opacity');
                themeContainer.style.removeProperty('visibility');
                // Add active class to this theme's container
                themeContainer.classList.add('active');
            }
        } else {
            console.warn('[BaseTheme] Theme container not found:', `${this.name}-theme`);
        }

        // Load the theme into the WebGL renderer
        if (this.webglRenderer && this.webglRenderer.loadTheme) {
            console.log('[BaseTheme] Calling loadTheme for:', this.name);
            this.webglRenderer.loadTheme(this.name);
        } else {
            console.error('[BaseTheme] ERROR: No webglRenderer or loadTheme method!');
        }

        // Setup global context recovery listener
        if (!this._contextRestoreUnsub) {
            this._contextRestoreUnsub = eventBus.on(EVENTS.CONTEXT_RESTORED, (payload) => {
                const payloadMatchesSharedRenderer = payload?.type === 'webgl'
                    && payload?.canvas
                    && this.webglRenderer
                    && payload.canvas === this.webglRenderer.canvas;
                const payloadMatchesThemeRuntime = payload?.label === this.name;

                if ((payloadMatchesSharedRenderer || payloadMatchesThemeRuntime)
                    && this.isActive
                    && typeof this.createScene === 'function') {
                    console.warn(`[BaseTheme] Global Context Restore detected. Rebuilding: ${this.name}`, payload);
                    const sharedRenderer = this.webglRenderer;
                    const recoveryManagers = {
                        assetManager: this.assetManager,
                        audioManager: this.audioManager,
                        onRuntimeFailure: this.onRuntimeFailure,
                    };
                    this.start(sharedRenderer, recoveryManagers).catch((err) => {
                        console.error('[BaseTheme] Context recovery failed:', err);
                        try {
                            this.onRuntimeFailure?.(err);
                        } catch (notificationError) {
                            console.error(
                                '[BaseTheme] Context recovery failure notification failed:',
                                notificationError,
                            );
                        }
                    });
                }
            });
        }

        // Override in subclass to implement theme-specific logic
        try {
            // Theme perf lane seam (scripts/lib/theme-perf-instrument.mjs). `__THEME_PERF__` is
            // defined only by the lane's document-start bootstrap, so with the lane absent this is
            // one undefined property read per theme start. It has to sit HERE, before createScene:
            // the renderer and the first pipelines are created inside that await, and the manager
            // offers no earlier handle — `theme.renderer` is assigned in ~50 different files.
            if (typeof window !== 'undefined' && window.__THEME_PERF__) {
                window.__THEME_PERF__.noteThemeStart(this);
            }
            // The generation is an explicit attempt token. Async theme code must
            // thread it through renderer initialization/fallback paths so an old
            // start cannot adopt a newer start's lifecycle after an await.
            await this.createScene(startGeneration);
        } catch (error) {
            const startWasCancelled = startGeneration !== this.lifecycleGeneration
                || this.cleanupComplete
                || !this.isActive;
            if (startWasCancelled) {
                this.retireStaleStartResources(startGeneration);
                return false;
            }

            // A current-attempt failure can leave a scene, post chain, renderer,
            // listeners, or RAFs allocated before the rejection. Retire them
            // immediately while keeping the object eligible for a clean retry.
            this.retireStaleStartResources(startGeneration);
            this.isActive = false;
            this.isPaused = false;
            this.lifecycleState = 'failed';
            throw error;
        }

        // stop()/cleanup() invalidates the generation synchronously. A timed-out
        // or superseded createScene must never publish "running" afterwards.
        if (startGeneration !== this.lifecycleGeneration || !this.isActive) {
            console.warn('[BaseTheme] Ignoring stale theme start completion:', this.name);
            this.retireStaleStartResources(startGeneration);
            return false;
        }

        this.hasStarted = true;
        this.lifecycleState = 'running';

        console.log('[BaseTheme] Theme start complete:', this.name);
        return undefined;
    }

    /**
     * Create the theme's visual scene
     * Override this to implement theme-specific scene creation
     * @param {number} _ownerGeneration lifecycle attempt owner
     * @returns {Promise<void>}
     */
    async createScene(ownerGeneration = this.lifecycleGeneration) {
        if (!Number.isFinite(ownerGeneration)) {
            throw new TypeError('createScene() requires a finite lifecycle generation');
        }
        // Override in subclass
        throw new Error('createScene() must be implemented by theme subclass');
    }

    /**
     * Resolve when the theme is safe for the first visible gameplay frame.
     * Themes with staged startup can override this to block until critical visuals are ready.
     * @returns {Promise<boolean>}
     */
    async whenCriticalReady() {
        return true;
    }

    /**
     * Resolve when non-critical startup polish has fully settled.
     * Odyssey does not block reveal on this hook.
     * @returns {Promise<boolean>}
     */
    async whenFullReady() {
        return true;
    }

    /**
     * Object3D roots containing gameplay-FX drawables that are parked at
     * `visible = false` until an event reveals them.
     *
     * Such objects are skipped by `compileAsync` and by every warm render
     * (three `Renderer._projectObject` returns early on `visible === false` —
     * r185 Renderer.js:3082 — and `compileAsync` uses that same traversal), so
     * their pipelines compile on the first gameplay frame that reveals them — a
     * 70-190ms GPU stall with no JS longtask. A theme that declares its FX root
     * gets those pipelines compiled during its masked warm window instead.
     *
     * See src/themes/shared/warm-hidden-drawables.js.
     * @returns {Array<any>}
     */
    getWarmupRoots() {
        return [];
    }

    /**
     * True when this theme's scene pass renders into a multi-target (MRT)
     * framebuffer. A bare `compileAsync(scene, camera)` is unsafe on such
     * themes — it compiles with no MRT bound (r181 bound no target at all;
     * r185 falls back to the internal single-output framebuffer, Renderer.js:
     * 909-911, and its deferred builds read live `getMRT()` = null), so it
     * caches a one-output shader that is then reused for the multi-attachment
     * pass, which poisons the pipeline cache and blanks the affected objects.
     * Consumers must skip bare sweeps when this is true.
     * @returns {boolean}
     */
    usesMrtScenePass() {
        return false;
    }

    /**
     * Stop theme animations and effects
     * Called when switching away from this theme
     */
    stop() {
        console.log('[BaseTheme] stop() called for theme:', this.name, 'state:', this.lifecycleState);
        this.lifecycleGeneration += 1;
        const wasRunning = this.isActive || this.isPaused;
        if (!wasRunning) {
            console.log('[BaseTheme] Theme already inactive; running idempotent stop sweep');
        }

        this.isActive = false;
        this.isPaused = false;
        this.lifecycleState = 'stopped';
        if (wasRunning) {
            console.log('[BaseTheme] Stopping theme:', this.name);
        }

        const themeContainer = document.getElementById(`${this.name}-theme`);
        if (themeContainer) {
            themeContainer.classList.remove('active');
            themeContainer.style.removeProperty('opacity');
            themeContainer.style.removeProperty('visibility');
        }

        // Theme perf lane seam: disarm timestamp tracking BEFORE this theme's dispose path runs
        // `collectPendingTimestampResolves`, and never re-arm on a stopped theme.
        if (typeof window !== 'undefined' && window.__THEME_PERF__) {
            window.__THEME_PERF__.noteThemeStop(this);
        }

        // Cancel all animation frames
        this.cancelAnimationFrames();

        // Clear tracked intervals, timeouts, and event listeners
        this.clearTrackedResources();

        // Clear WebGL layers
        // Note: WebGL renderer clears layers when loadTheme() is called,
        // so we just reset our local tracking
        this.webglLayers = [];
    }

    /**
     * A manager timeout or terminal cleanup can invalidate start() while an
     * awaited createScene() is still running. Once that stale work settles,
     * sweep again: resources created after the first cleanup must not survive
     * merely because cleanupComplete already made cleanup() idempotent.
     */
    retireStaleStartResources(staleGeneration = null) {
        const newerOwnerIsRunning = Number.isFinite(staleGeneration)
            && staleGeneration !== this.lifecycleGeneration
            && !this.cleanupComplete
            && (this.isActive || this.isPaused)
            && (
                this.lifecycleState === 'starting'
                || this.lifecycleState === 'running'
                || this.lifecycleState === 'paused'
            );
        if (newerOwnerIsRunning) {
            // A newer start owns the shared instance fields now. Sweeping them
            // from the stale continuation would stop and dispose the new runtime.
            console.warn(
                `[BaseTheme] Stale start retired without sweeping newer runtime: ${this.name}`,
            );
            return false;
        }

        if (this.isActive || this.isPaused || this.lifecycleState !== 'stopped') {
            try {
                this.stop();
            } catch (error) {
                console.warn(`[BaseTheme] Failed to stop stale start for ${this.name}:`, error);
            }
        }

        try {
            // This terminal sweep is intentionally independent of resourceProfile.
            // Even a nominally light theme may have allocated a renderer or scene
            // immediately before its cancelled createScene() settled.
            this.releaseManagedGpuResources();
        } catch (error) {
            console.warn(`[BaseTheme] Failed to release stale start for ${this.name}:`, error);
        }
        return true;
    }

    /**
     * Cancel animation loops registered through BaseTheme plus common legacy RAF fields.
     * Several older themes predate registerAnimation(), so the base teardown also clears
     * those well-known handles to keep inactive themes from retaining a live frame.
     */
    cancelAnimationFrames() {
        const cancelFrame = typeof cancelAnimationFrame === 'function'
            ? cancelAnimationFrame
            : null;

        if (cancelFrame) {
            this.animationIds.forEach((id) => cancelFrame(id));
        }
        this.animationIds = [];

        [
            'animationFrameId',
            'animationFrame',
            'rafId',
            'animationId',
            '_shapeFadeRaf',
        ].forEach((propName) => {
            const id = this[propName];
            if (typeof id === 'number' && cancelFrame) {
                cancelFrame(id);
            }
            if (typeof id === 'number') {
                this[propName] = null;
            }
        });

        if (this.renderer
            && this.renderer !== this.webglRenderer
            && typeof this.renderer.setAnimationLoop === 'function') {
            this.renderer.setAnimationLoop(null);
        }
    }

    /**
     * Release restartable runtime resources when a theme becomes inactive.
     * Heavy GPU themes opt into deeper disposal via resourceProfile metadata.
     */
    releaseInactiveResources() {
        this.stop();

        if (this.resourceProfile === 'heavy-gpu') {
            this.releaseManagedGpuResources();
        }
    }

    clearEventUnsubscribers() {
        if (!Array.isArray(this.eventUnsubscribers) || this.eventUnsubscribers.length === 0) {
            return;
        }

        this.eventUnsubscribers.forEach((unsubscribe) => {
            if (typeof unsubscribe === 'function') {
                try {
                    unsubscribe();
                } catch (error) {
                    console.warn(`[BaseTheme] Failed to unsubscribe runtime event for ${this.name}:`, error);
                }
            }
        });
        this.eventUnsubscribers = [];
    }

    removeCommonResizeHandlers() {
        if (typeof window === 'undefined') {
            return;
        }

        const handlers = [
            this.boundResizeHandler,
            this.resizeHandler,
            this._boundResizeHandler,
        ].filter((handler, index, array) => typeof handler === 'function' && array.indexOf(handler) === index);

        handlers.forEach((handler) => {
            window.removeEventListener('resize', handler);
        });
    }

    disposeRuntimeProperty(propName) {
        const value = this[propName];
        if (!value || value === this.webglRenderer) {
            return;
        }

        if (propName.toLowerCase().includes('composer')) {
            this.disposeComposer(value);
        } else if (typeof value.dispose === 'function') {
            value.dispose();
        }

        this[propName] = null;
    }

    disposeComposer(composer) {
        if (!composer) return;

        if (Array.isArray(composer.passes)) {
            composer.passes.forEach((pass) => {
                if (pass && typeof pass.dispose === 'function') {
                    try {
                        pass.dispose();
                    } catch (error) {
                        console.warn(`[BaseTheme] Failed to dispose composer pass for ${this.name}:`, error);
                    }
                }
            });
        }

        if (typeof composer.dispose === 'function') {
            try {
                composer.dispose();
            } catch (error) {
                console.warn(`[BaseTheme] Failed to dispose composer for ${this.name}:`, error);
            }
        }
    }

    disposeRenderer(renderer = this.renderer, { nullInstance = true } = {}) {
        if (!renderer || renderer === this.webglRenderer) return;

        let domElement = null;
        try {
            ({ domElement } = renderer);
        } catch (error) {
            console.warn(`[BaseTheme] Failed to read renderer canvas for ${this.name}:`, error);
        }
        if (typeof renderer.setAnimationLoop === 'function') {
            try {
                renderer.setAnimationLoop(null);
            } catch (error) {
                console.warn(`[BaseTheme] Failed to stop renderer loop for ${this.name}:`, error);
            }
        }
        const releaseGpu = () => {
            if (typeof renderer.dispose === 'function') {
                try {
                    renderer.dispose();
                } catch (error) {
                    console.warn(`[BaseTheme] Failed to dispose renderer for ${this.name}:`, error);
                }
            }
            if (typeof renderer.forceContextLoss === 'function') {
                try {
                    renderer.forceContextLoss();
                } catch (error) {
                    console.warn(`[BaseTheme] Failed to force WebGL context loss for ${this.name}:`, error);
                }
            }
        };
        // three r185: WebGPUBackend.dispose() fires the timestamp pools' ASYNC
        // dispose() without awaiting it and then destroys the owned device, so
        // an in-flight resolveTimestampsAsync() (black-hole samples its GPU-timed
        // DRS at 15 Hz, compute at 2 Hz) rejects against a dead device and three
        // logs "Error resolving queries" — once per pool. r181 never destroyed
        // the device here, which is why this never surfaced. Quiesce first and
        // defer ONLY the GPU release until pending resolves settle (bounded so a
        // stuck query can never wedge teardown); loop stop, canvas detach and
        // the reference clear below stay synchronous.
        const pendingResolves = collectPendingTimestampResolves(renderer);
        if (pendingResolves.length > 0) {
            Promise.race([
                Promise.allSettled(pendingResolves),
                new Promise((resolve) => { setTimeout(resolve, 300); }),
            ]).then(releaseGpu, releaseGpu);
        } else {
            releaseGpu();
        }
        try {
            if (domElement?.parentNode) {
                domElement.parentNode.removeChild(domElement);
            }
        } catch (error) {
            console.warn(`[BaseTheme] Failed to detach renderer canvas for ${this.name}:`, error);
        }
        try {
            if (nullInstance && renderer === this.renderer) {
                this.renderer = null;
            }
        } catch (error) {
            console.warn(`[BaseTheme] Failed to clear renderer reference for ${this.name}:`, error);
        }
    }

    /**
     * Initialize a renderer under this lifecycle's ownership.
     *
     * WebGPURenderer.init() cannot currently be aborted. A plain `await init()`
     * lets a renderer finish after stop()/cleanup(), append its canvas, and keep
     * GPU managers alive. This helper bounds the wait, rejects stale ownership,
     * and performs a second disposal when a timed-out initialization eventually
     * settles (Three r181 may make dispose() a no-op before init completes).
     *
     * @param {Object} renderer candidate renderer
     * @param {{ timeoutMs?: number, label?: string, ownerGeneration?: number }} options
     * @returns {Promise<Object>} the initialized, still-owned renderer
     */
    async initializeRendererCandidate(renderer, {
        timeoutMs = 10000,
        label = `${this.name} renderer init`,
        ownerGeneration = this.lifecycleGeneration,
    } = {}) {
        if (!renderer || typeof renderer.init !== 'function') {
            throw new Error(`[BaseTheme] ${label} requires a renderer with init()`);
        }

        const generation = ownerGeneration;
        const requiresActiveOwner = this.isActive || this.lifecycleState === 'starting';
        let timeoutId = null;
        let initSettled = false;
        const disposeCandidate = () => {
            try {
                this.disposeRenderer(renderer, { nullInstance: false });
            } catch (error) {
                // Candidate retirement is a failure boundary. A hostile legacy
                // canvas parent/getter must not replace the renderer init error
                // or turn the late-settlement continuation into an unhandled rejection.
                console.warn(`[BaseTheme] Failed to retire renderer candidate for ${this.name}:`, error);
            }
        };
        if (this.cleanupComplete
            || generation !== this.lifecycleGeneration
            || (!this.isActive && this.lifecycleState !== 'initialized')) {
            disposeCandidate();
            throw new Error(`${label} was cancelled before initialization`);
        }
        const initPromise = Promise.resolve()
            .then(() => renderer.init())
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
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(
                    () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
                    timeoutMs,
                );
            });
            await Promise.race([initPromise, timeoutPromise]);

            if (this.cleanupComplete
                || generation !== this.lifecycleGeneration
                || (requiresActiveOwner && !this.isActive)) {
                throw new Error(`${label} was cancelled`);
            }
            return renderer;
        } catch (error) {
            if (!initSettled) {
                // A pre-init dispose is not sufficient in Three r181. Retire the
                // candidate again after its non-abortable backend init settles.
                initPromise
                    .then(disposeCandidate, disposeCandidate)
                    .catch((lateDisposalError) => {
                        console.warn(
                            `[BaseTheme] Late renderer retirement failed for ${this.name}:`,
                            lateDisposalError,
                        );
                    });
            }
            disposeCandidate();
            throw error;
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        }
    }

    releaseManagedGpuResources() {
        const attempt = (label, action) => {
            try {
                action();
            } catch (error) {
                console.warn(`[BaseTheme] ${label} cleanup failed for ${this.name}:`, error);
            }
        };

        attempt('Animation', () => this.cancelAnimationFrames());
        attempt('Tracked resource', () => this.clearTrackedResources());
        attempt('Event subscription', () => this.clearEventUnsubscribers());
        attempt('Resize listener', () => this.removeCommonResizeHandlers());
        attempt('Renderer resilience', () => this.removeRendererResilience());

        if (this.particleSystem) {
            attempt('Particle system', () => this.particleSystem.dispose?.());
            this.particleSystem = null;
        }

        [
            'simulator',
            'snowCompute',
            'post',
            'postProcessing',
            'postComposer',
            'composer',
        ].forEach((propName) => {
            attempt(propName, () => this.disposeRuntimeProperty(propName));
        });

        if (this.scene) {
            const { scene } = this;
            attempt('Scene graph', () => this.disposeThreeJSGroup(scene));
            attempt('Scene clear', () => scene.clear?.());
            this.scene = null;
        }

        if (this.renderer && this.renderer !== this.webglRenderer) {
            const { renderer } = this;
            attempt('Renderer', () => this.disposeRenderer(renderer));
            if (this.renderer === renderer) {
                this.renderer = null;
            }
        }

        if (this.camera) {
            this.camera = null;
        }
    }

    /**
     * Resume theme after suspension
     * Restores canvas contexts and restarts animations without recreating the scene
     * Override this in subclasses that use canvas contexts
     * @returns {boolean} True if resumed successfully, false if full restart needed
     */
    resume() {
        console.log('[BaseTheme] resume() called for theme:', this.name);

        if (!this.hasStarted
            || !this.isPaused
            || this.lifecycleState !== 'paused') {
            return false;
        }

        if (!this.isPaused && this.isActive) {
            return true;
        }

        this.isActive = true;
        this.isPaused = false;
        this._wasPaused = false;
        this.lifecycleState = 'running';

        // Reactivate the DOM container
        const themeContainer = document.getElementById(`${this.name}-theme`);
        if (themeContainer) {
            document.querySelectorAll('.theme-container').forEach((container) => {
                container.classList.remove('active');
            });
            themeContainer.classList.add('active');
        }

        // Override in subclass to restore canvas contexts
        // Return false if contexts can't be restored and full restart is needed
        return true;
    }

    /**
     * Clean up all theme resources
     * Called when theme is being destroyed or evicted from cache
     *
     * IMPORTANT: Theme implementations should:
     * 1. Cancel all animation frames (use registerAnimation())
     * 2. Clear all intervals/timeouts
     * 3. Remove all event listeners
     * 4. Remove all DOM elements (use registerContainer())
     * 5. Null out large object references
     */
    cleanup() {
        if (this.cleanupComplete) {
            return;
        }
        this.cleanupComplete = true;
        this._startRequestGeneration += 1;
        console.log(`[BaseTheme] Cleaning up theme: ${this.name}`);

        // Release restartable runtime resources first, then continue terminal teardown
        try {
            this.releaseInactiveResources();
        } catch (error) {
            // Cleanup is terminal. Continue through the base safety nets even if
            // bespoke theme teardown failed part-way through.
            console.warn(`[BaseTheme] Inactive resource cleanup failed for ${this.name}:`, error);
            try {
                this.cancelAnimationFrames();
                this.clearTrackedResources();
                this.clearEventUnsubscribers();
                this.removeCommonResizeHandlers();
                this.removeRendererResilience();
                this.releaseManagedGpuResources();
            } catch (fallbackError) {
                console.warn(`[BaseTheme] Fallback runtime cleanup failed for ${this.name}:`, fallbackError);
            }
        }

        // Remove GPU resilience listeners
        try {
            this.removeRendererResilience();
        } catch (error) {
            console.warn(`[BaseTheme] Renderer resilience cleanup failed for ${this.name}:`, error);
        }

        if (this._contextRestoreUnsub) {
            try {
                this._contextRestoreUnsub();
            } catch (error) {
                console.warn(`[BaseTheme] Context listener cleanup failed for ${this.name}:`, error);
            }
            this._contextRestoreUnsub = null;
        }

        // Verify animation frames were cleaned up
        if (this.animationIds.length > 0) {
            console.warn(`[BaseTheme] ${this.animationIds.length} animation frames were not cleaned up in stop()!`);
            // Clean them up now
            this.animationIds.forEach((id) => cancelAnimationFrame(id));
            this.animationIds = [];
        }

        // Remove containers from DOM
        console.log(`[BaseTheme] Removing ${this.containers.length} DOM containers`);
        this.containers.forEach((container) => {
            try {
                const registryOwned = container?.dataset?.themeRegistryOwned === 'true'
                    || container?.getAttribute?.('data-theme-registry-owned') === 'true'
                    || container?.__themeRegistryOwned === true;
                if (registryOwned) {
                    container.classList?.remove?.('active');
                    container.style?.removeProperty?.('opacity');
                    container.style?.removeProperty?.('visibility');
                } else if (container && container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            } catch (error) {
                console.warn(`[BaseTheme] DOM container cleanup failed for ${this.name}:`, error);
            }
        });
        this.containers = [];

        // Clear WebGL layer tracking
        this.webglLayers = [];

        // Null out renderer reference
        this.webglRenderer = null;

        // Null out managers (they're shared, so we just clear references)
        this.assetManager = null;
        this.audioManager = null;
        this.onRuntimeFailure = null;

        // Auto-dispose standard Three.js structures if standard properties were used
        if (this.scene) {
            console.log('[BaseTheme] deeply disposing Three.js scene');
            try {
                this.disposeThreeJSGroup(this.scene);
            } catch (error) {
                console.warn(`[BaseTheme] Scene cleanup failed for ${this.name}:`, error);
            }
            this.scene = null;
        }

        if (this.postComposer && typeof this.postComposer.dispose === 'function') {
            console.log('[BaseTheme] deeply disposing post-composer');
            this.disposeComposer(this.postComposer);
            this.postComposer = null;
        }

        // Null out options to release any closures
        this.options = null;
        this.isActive = false;
        this.isPaused = false;
        this.lifecycleState = 'stopped';

        console.log(`✅ [BaseTheme] Cleanup complete for theme: ${this.name}`);
    }

    /**
     * Register a setInterval for automatic cleanup on stop/cleanup.
     * @param {Function} fn - Interval callback
     * @param {number} ms - Interval in milliseconds
     * @returns {number} The interval ID
     */
    registerInterval(fn, ms) {
        if (!this._intervals) this._intervals = [];
        const id = setInterval(fn, ms);
        this._intervals.push(id);
        return id;
    }

    /**
     * Register a setTimeout for automatic cleanup on stop/cleanup.
     * @param {Function} fn - Timeout callback
     * @param {number} ms - Delay in milliseconds
     * @returns {number} The timeout ID
     */
    registerTimeout(fn, ms) {
        if (!this._timeouts) this._timeouts = [];
        const id = setTimeout(fn, ms);
        this._timeouts.push(id);
        return id;
    }

    /**
     * Register an event listener for automatic cleanup on stop/cleanup.
     * @param {EventTarget} target - DOM element or other EventTarget
     * @param {string} event - Event name
     * @param {Function} handler - Event handler
     * @param {Object} [options] - addEventListener options
     */
    registerEventListener(target, event, handler, options) {
        if (!this._eventListeners) this._eventListeners = [];
        target.addEventListener(event, handler, options);
        this._eventListeners.push({
            target, event, handler, options,
        });
    }

    /**
     * Clear all registered intervals, timeouts, and event listeners.
     * Called automatically in stop() and cleanup().
     */
    clearTrackedResources() {
        if (this._intervals) {
            this._intervals.forEach((id) => clearInterval(id));
            this._intervals = [];
        }

        if (this._timeouts) {
            this._timeouts.forEach((id) => clearTimeout(id));
            this._timeouts = [];
        }

        if (this._eventListeners) {
            this._eventListeners.forEach(({
                target, event, handler, options,
            }) => {
                target.removeEventListener(event, handler, options);
            });
            this._eventListeners = [];
        }
    }

    /**
     * Deeply disposes a Three.js Object3D/Scene protecting WebGL contexts from memory leaks.
     * @param {Object} node - THREE.Object3D instance
     */
    disposeThreeJSGroup(node) {
        if (!node || typeof node.traverse !== 'function') return;

        node.traverse((child) => {
            if (child.geometry && typeof child.geometry.dispose === 'function') {
                child.geometry.dispose();
            }
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((material) => {
                    if (!material) return;
                    // Dispose standard textures
                    for (const key in material) {
                        if (material[key] && material[key].isTexture && typeof material[key].dispose === 'function') {
                            material[key].dispose();
                        }
                    }
                    // Dispose uniform textures
                    if (material.uniforms) {
                        for (const key in material.uniforms) {
                            const uni = material.uniforms[key];
                            if (uni && uni.value && uni.value.isTexture && typeof uni.value.dispose === 'function') {
                                uni.value.dispose();
                            }
                        }
                    }
                    if (typeof material.dispose === 'function') material.dispose();
                });
            }
        });

        if (node.parent && typeof node.parent.remove === 'function') {
            node.parent.remove(node);
        }
    }

    /**
     * Helper: Register an animation frame ID for automatic cleanup
     * @param {number} id - RequestAnimationFrame ID
     */
    registerAnimation(id) {
        if (this.animationIds.length === 0) {
            this.animationIds.push(id);
        } else {
            this.animationIds[this.animationIds.length - 1] = id;
        }
    }

    /**
     * Helper: Register a DOM container for automatic cleanup
     * @param {HTMLElement} container - DOM element to register
     */
    registerContainer(container) {
        const registryOwned = container?.dataset?.themeRegistryOwned === 'true'
            || container?.getAttribute?.('data-theme-registry-owned') === 'true'
            || container?.__themeRegistryOwned === true;
        if (container && !registryOwned && !this.containers.includes(container)) {
            this.containers.push(container);
        }
    }

    /**
     * Helper: Add a WebGL layer and register it for cleanup
     * @param {HTMLCanvasElement} canvas - Canvas to add as layer
     * @param {number} zIndex - Z-index for layer ordering
     */
    addWebGLLayer(canvas, zIndex) {
        if (this.webglRenderer) {
            this.webglRenderer.addLayer(canvas, zIndex);
            this.webglLayers.push({ canvas, zIndex });
        }
    }

    /**
     * Helper: Get a DOM container by ID and register it
     * @param {string} id - Container element ID
     * @returns {HTMLElement|null}
     */
    getContainer(id) {
        const container = document.getElementById(id);
        if (container) {
            this.registerContainer(container);
        }
        return container;
    }

    /**
     * Helper: Create a seeded random number generator
     * @param {number} seed - Random seed
     * @returns {Function} Random number generator function
     */
    seededRandom(seed) {
        return () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    /**
     * Helper: Generate random number in range
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {number} Random number between min and max
     */
    random(min, max) {
        return Math.random() * (max - min) + min;
    }

    /**
     * Update theme (called each frame if needed)
     * @param {number} deltaTime - Time since last update in milliseconds
     */
    update(deltaTime) {
        // Override in subclass if per-frame updates are needed
    }

    /**
     * Handle window resize
     * @param {number} width - New window width
     * @param {number} height - New window height
     */
    resize(width, height) {
        // Override in subclass if resize handling is needed
    }

    /**
     * Get the effective pixel ratio for Three.js rendering
     * Applies the global render scale to reduce GPU load on high-DPI displays
     * @param {number} maxRatio - Maximum pixel ratio cap (default 2)
     * @returns {number} Effective pixel ratio for setPixelRatio()
     */
    static getEffectivePixelRatio(maxRatio = 2, sceneType = 'theme') {
        const baseRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        return computeScenePixelRatio({
            renderScale: globalRenderScale,
            devicePixelRatio: baseRatio,
            maxPixelRatio: maxRatio,
            sceneType,
        });
    }

    /**
     * Instance method to get effective pixel ratio
     * @param {number} maxRatio - Maximum pixel ratio cap (default 2)
     * @returns {number} Effective pixel ratio
     */
    getEffectivePixelRatio(maxRatio = 2, sceneType = 'theme') {
        return BaseTheme.getEffectivePixelRatio(maxRatio, sceneType);
    }

    /**
     * Get the global antialiasing setting
     * @returns {boolean} Whether antialiasing is enabled
     */
    static getAntialiasEnabled() {
        return globalAntialiasEnabled;
    }

    /**
     * Instance method to get antialiasing setting
     * @returns {boolean} Whether antialiasing is enabled
     */
    getAntialiasEnabled() {
        return BaseTheme.getAntialiasEnabled();
    }

    /**
     * Get custom tetromino visual configuration for this theme
     * Themes can override this to provide theme-specific tetromino styles
     *
     * @returns {Object|null} Tetromino configuration object or null for default styling
     *
     * Configuration Schema:
     * {
     *   version: 1,
     *   colors: { I, O, T, S, Z, J, L, GARBAGE },
     *   renderMode: 'solid' | 'glow' | 'gradient',
     *   effects: { glowRadius, glowIntensity, outline, outlineWidth, ... },
     *   rendererOverrides: { canvas: {...}, phaser: {...} }
     * }
     */
    getTetrominoConfig() {
        return null; // Default: no custom styling
    }

    /**
     * Check if the theme should render the current frame
     * Used for background tab throttling
     * @returns {boolean} True if frame should be rendered
     */
    shouldRenderFrame() {
        // Check global pause flag
        if (window.isRenderingPaused) {
            return false;
        }

        // Check global reduced flag
        if (window.isRenderingReduced) {
            const now = performance.now();
            const interval = window.reducedFrameInterval || 100; // 10 FPS default

            // Initialize last frame time if not set
            if (!this._lastReducedFrameTime) {
                this._lastReducedFrameTime = 0;
            }

            if (now - this._lastReducedFrameTime >= interval) {
                this._lastReducedFrameTime = now;
                return true;
            }
            return false;
        }

        // Cap the theme's render rate to the player's Target Frame Rate.
        // Without this the theme renders once per vsync — 240 full scene draws
        // per second on a 240Hz panel for a 60Hz simulation — leaving no GPU
        // headroom to absorb a stall. See theme-frame-pacer.js.
        if (this._themeFpsCapEnabled === undefined) {
            this._themeFpsCapEnabled = !readFlag('noThemeFpsCap', false);
        }
        if (this._themeFpsCapEnabled) {
            if (!this._framePacer) this._framePacer = createFramePacer();
            return shouldRenderAtTargetFps(
                this._framePacer,
                performance.now(),
                resolveTargetFps(),
            );
        }

        // Normal rendering
        return true;
    }

    /**
     * Create a safe animation loop wrapper.
     * Catches errors per frame (so one bad frame doesn't kill the theme),
     * respects shouldRenderFrame() for throttling, and auto-registers the
     * animation frame ID for cleanup.
     *
     * Usage in theme subclass:
     *   this.animate = this.safeAnimate((time) => {
     *       // render logic here
     *   });
     *   this.animate(); // start the loop
     *
     * @param {Function} renderFn - Per-frame render function, receives timestamp
     * @param {Object} [options]
     * @param {number} [options.maxConsecutiveErrors=5] - Stop loop after this many consecutive errors
     * @returns {Function} The wrapped animate function (call it to start/continue the loop)
     */
    safeAnimate(renderFn, options = {}) {
        const maxErrors = options.maxConsecutiveErrors ?? 5;
        let consecutiveErrors = 0;

        const loop = (time) => {
            if (!this.isActive) return;

            const id = requestAnimationFrame(loop);
            this.registerAnimation(id);

            if (!this.shouldRenderFrame()) return;

            try {
                renderFn(time);
                consecutiveErrors = 0;
            } catch (err) {
                consecutiveErrors++;
                console.error(`[${this.name}] Animation error (${consecutiveErrors}/${maxErrors}):`, err);
                if (consecutiveErrors >= maxErrors) {
                    console.error(`[${this.name}] Too many consecutive animation errors, stopping loop`);
                    cancelAnimationFrame(id);
                }
            }
        };

        return loop;
    }

    /**
     * Set up GPU context resilience for a Three.js renderer.
     * Monitors the renderer's canvas for WebGL context loss/restore and optionally
     * a WebGPU device for device loss. Call removeRendererResilience() to clean up.
     *
     * @param {Object} renderer - Three.js WebGLRenderer or WebGPURenderer instance
     * @param {Object} [options]
     * @param {Function} [options.onContextLost] - Called on WebGL context loss
     * @param {Function} [options.onContextRestored] - Called on WebGL context restore
     * @param {GPUDevice} [options.webgpuDevice] - WebGPU device to monitor
     * @param {Function} [options.onDeviceLost] - Called on WebGPU device loss
     */
    setupRendererResilience(renderer, options = {}) {
        this._resilienceUnsubs = this._resilienceUnsubs || [];
        // Ensure the ONE CONTEXT_LOST consumer is live (plan §4.2): otherwise a
        // loss this theme emits onto the bus is observed by nobody. Idempotent.
        initGpuLossCoordinator();

        if (renderer?.domElement) {
            const unsub = gpuResilience.monitorWebGL(renderer.domElement, {
                label: this.name,
                onLost: options.onContextLost,
                onRestored: options.onContextRestored,
            });
            this._resilienceUnsubs.push(unsub);
        }

        if (options.webgpuDevice) {
            const unsub = gpuResilience.monitorWebGPU(options.webgpuDevice, {
                label: this.name,
                onDeviceLost: options.onDeviceLost,
            });
            this._resilienceUnsubs.push(unsub);
        }
    }

    /**
     * Remove all GPU context resilience listeners set up by setupRendererResilience().
     */
    removeRendererResilience() {
        if (this._resilienceUnsubs) {
            for (let i = 0; i < this._resilienceUnsubs.length; i++) {
                this._resilienceUnsubs[i]();
            }
            this._resilienceUnsubs = null;
        }
    }

    /**
     * Pause theme animations (called when tab is hidden with 'pause' mode)
     */
    pause() {
        console.log(`[BaseTheme] Pausing theme: ${this.name}`);
        if (!this.isActive || this.isPaused) {
            return false;
        }

        // Cancel BaseTheme-managed RAFs, legacy RAF handles, and Three's
        // setAnimationLoop scheduler. Suspended themes must own zero live loops.
        this.cancelAnimationFrames();
        // Reset the common render-loop re-entry guards so the loop can actually RESTART
        // on resume(). Themes typically start their loop only in createScene() and guard
        // re-entry (e.g. `if (this.isAnimating) return` / `if (this.animationLoopStarted)
        // return`); pausing cancelled the RAF but left those flags set, which froze a
        // resumed (e.g. pre-warmed) theme. Harmless no-op on themes that don't use them.
        this.isAnimating = false;
        this.animationLoopStarted = false;
        // Keep the IDs so we know we need to restart when resume is called
        this._wasPaused = true;
        this.isPaused = true;
        this.lifecycleState = 'paused';
        return true;
    }

    /**
     * Restart the render loop after a resume. Most themes start their loop only in
     * createScene()/start() (not in resume()), so a resumed — e.g. pre-warmed — theme
     * would otherwise never render again. Tries the common loop-start methods; pause()
     * cleared the re-entry guards so these actually restart. Themes with a bespoke loop
     * (or that already restart it inside resume()) are safe: the guard makes the extra
     * call a no-op. Override for custom loop management.
     */
    restartRenderLoop() {
        // A restart follows a pause, a GPU loss, or a resize — the cadence
        // estimate from before the gap says nothing about the cadence after it.
        resetFramePacer(this._framePacer);
        const starters = [
            'animate',
            'startAnimationLoop',
            'startAnimation',
            '_startAnimation',
            '_startAnimationLoop',
            'startRenderLoop',
            '_animate',
        ];
        for (const name of starters) {
            if (typeof this[name] === 'function') {
                this[name]();
                return;
            }
        }
    }
}
