/**
 * @fileoverview Base Theme Class - Abstract class for all Serenity Blocks themes
 * Provides common interface and lifecycle methods for theme implementations
 */

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
        console.warn('[BaseTheme] >>>>>> START METHOD CALLED <<<<<<', this.name);
        console.log('[BaseTheme] start() called, isActive:', this.isActive, 'theme:', this.name);

        // If already active and running, stop first to ensure clean restart
        if (this.isActive) {
            console.warn('[BaseTheme] Theme already active, stopping before restart:', this.name);
            this.stop();
        }

        // Set active state
        this.isActive = true;
        this.webglRenderer = webglRenderer;

        // Store resource managers for efficient asset loading
        this.assetManager = managers.assetManager;
        this.audioManager = managers.audioManager;

        console.warn('[BaseTheme] About to call loadTheme...');
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

        // Override in subclass to implement theme-specific logic
        await this.createScene();

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
        console.log('[BaseTheme] stop() called for theme:', this.name, 'isActive:', this.isActive);
        if (!this.isActive) {
            console.log('[BaseTheme] Theme already inactive, skipping stop');
            return;
        }

        this.isActive = false;
        console.log('[BaseTheme] Stopping theme:', this.name);

        const themeContainer = document.getElementById(`${this.name}-theme`);
        if (themeContainer) {
            themeContainer.classList.remove('active');
        }

        // Cancel all animation frames
        this.animationIds.forEach((id) => cancelAnimationFrame(id));
        this.animationIds = [];

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

        this.isActive = true;

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

        // Null out options to release any closures
        this.options = null;

        console.log(`✅ [BaseTheme] Cleanup complete for theme: ${this.name}`);
    }

    /**
     * Helper: Register an animation frame ID for automatic cleanup
     * @param {number} id - RequestAnimationFrame ID
     */
    registerAnimation(id) {
        this.animationIds.push(id);
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
     * Pause theme animations (called when tab is hidden with 'pause' mode)
     */
    pause() {
        console.log(`[BaseTheme] Pausing theme: ${this.name}`);
        // Cancel all animation frames to stop GPU work
        this.animationIds.forEach((id) => cancelAnimationFrame(id));
        // Keep the IDs so we know we need to restart when resume is called
        this._wasPaused = true;
    }
}
