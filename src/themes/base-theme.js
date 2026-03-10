/**
 * @fileoverview Base Theme Class - Abstract class for all Serenity Blocks themes
 * Provides common interface and lifecycle methods for theme implementations
 */

import { gpuResilience } from '../utils/gpu-context-resilience.js';
import { eventBus, EVENTS } from '../events/event-bus.js';

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
        this.animationIds = [];
        this.containers = [];
        this.webglLayers = [];
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
        console.log('[BaseTheme] start() called, state:', this.lifecycleState, 'theme:', this.name);

        if (this.isActive || this.isPaused) {
            console.warn('[BaseTheme] Theme already active or paused, stopping before restart:', this.name);
            this.stop();
        }

        this.lifecycleState = 'starting';
        this.isActive = true;
        this.isPaused = false;
        this.webglRenderer = webglRenderer;

        // Store resource managers for efficient asset loading
        this.assetManager = managers.assetManager;
        this.audioManager = managers.audioManager;

        console.log('[BaseTheme] Starting theme:', this.name);
        console.log('[BaseTheme] WebGL Renderer:', this.webglRenderer);
        console.log(
            '[BaseTheme] Has loadTheme?',
            this.webglRenderer && typeof this.webglRenderer.loadTheme,
        );

        // Activate the DOM theme container
        const themeContainer = document.getElementById(`${this.name}-theme`);
        if (themeContainer) {
            console.log('[BaseTheme] Activating theme container:', this.name);
            // Remove active class from all theme containers
            document.querySelectorAll('.theme-container').forEach((container) => {
                container.classList.remove('active');
            });
            // Add active class to this theme's container
            themeContainer.classList.add('active');
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
                    this.stop();
                    this.isActive = true; // Keep active flag
                    this.createScene().catch((err) => {
                        console.error('[BaseTheme] Context recovery failed:', err);
                    });
                }
            });
        }

        // Override in subclass to implement theme-specific logic
        await this.createScene();

        this.hasStarted = true;
        this.lifecycleState = 'running';

        console.log('[BaseTheme] Theme start complete:', this.name);
    }

    /**
     * Create the theme's visual scene
     * Override this to implement theme-specific scene creation
     * @returns {Promise<void>}
     */
    async createScene() {
        // Override in subclass
        throw new Error('createScene() must be implemented by theme subclass');
    }

    /**
     * Stop theme animations and effects
     * Called when switching away from this theme
     */
    stop() {
        console.log('[BaseTheme] stop() called for theme:', this.name, 'state:', this.lifecycleState);
        if (!this.isActive && !this.isPaused) {
            console.log('[BaseTheme] Theme already inactive, skipping stop');
            return;
        }

        this.isActive = false;
        this.isPaused = false;
        this.lifecycleState = 'stopped';
        console.log('[BaseTheme] Stopping theme:', this.name);

        const themeContainer = document.getElementById(`${this.name}-theme`);
        if (themeContainer) {
            themeContainer.classList.remove('active');
        }

        // Cancel all animation frames
        this.animationIds.forEach((id) => cancelAnimationFrame(id));
        this.animationIds = [];

        // Clear tracked intervals, timeouts, and event listeners
        this.clearTrackedResources();

        // Clear WebGL layers
        // Note: WebGL renderer clears layers when loadTheme() is called,
        // so we just reset our local tracking
        this.webglLayers = [];
    }

    /**
     * Resume theme after suspension
     * Restores canvas contexts and restarts animations without recreating the scene
     * Override this in subclasses that use canvas contexts
     * @returns {boolean} True if resumed successfully, false if full restart needed
     */
    resume() {
        console.log('[BaseTheme] resume() called for theme:', this.name);

        if (!this.hasStarted) {
            return false;
        }

        if (!this.isPaused && this.isActive) {
            return true;
        }

        this.isActive = true;
        this.isPaused = false;
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
        console.log(`[BaseTheme] Cleaning up theme: ${this.name}`);

        // Stop animations and remove theme from active state
        this.stop();

        // Remove GPU resilience listeners
        this.removeRendererResilience();

        if (this._contextRestoreUnsub) {
            this._contextRestoreUnsub();
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
            if (container && container.parentNode) {
                container.parentNode.removeChild(container);
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

        // Auto-dispose standard Three.js structures if standard properties were used
        if (this.scene) {
            console.log(`[BaseTheme] deeply disposing Three.js scene`);
            this.disposeThreeJSGroup(this.scene);
            this.scene = null;
        }

        if (this.postComposer && typeof this.postComposer.dispose === 'function') {
            console.log(`[BaseTheme] deeply disposing post-composer`);
            this.postComposer.dispose();
            this.postComposer = null;
        }

        // Null out options to release any closures
        this.options = null;

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
        this._eventListeners.push({ target, event, handler, options });
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
            this._eventListeners.forEach(({ target, event, handler, options }) => {
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
        if (container && !this.containers.includes(container)) {
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
    static getEffectivePixelRatio(maxRatio = 2) {
        const baseRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const cappedRatio = Math.min(baseRatio, maxRatio);
        const effectiveRatio = cappedRatio * globalRenderScale;
        return Math.round(effectiveRatio * 100) / 100; // Round to 2 decimal places
    }

    /**
     * Instance method to get effective pixel ratio
     * @param {number} maxRatio - Maximum pixel ratio cap (default 2)
     * @returns {number} Effective pixel ratio
     */
    getEffectivePixelRatio(maxRatio = 2) {
        return BaseTheme.getEffectivePixelRatio(maxRatio);
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

        // Cancel all animation frames to stop GPU work
        this.animationIds.forEach((id) => cancelAnimationFrame(id));
        // Keep the IDs so we know we need to restart when resume is called
        this._wasPaused = true;
        this.isPaused = true;
        this.lifecycleState = 'paused';
        return true;
    }
}
