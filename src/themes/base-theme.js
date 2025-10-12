/**
 * @fileoverview Base Theme Class - Abstract class for all Serenity Blocks themes
 * Provides common interface and lifecycle methods for theme implementations
 */

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
     * @returns {Promise<void>}
     */
    async start(webglRenderer) {
        console.warn('[BaseTheme] >>>>>> START METHOD CALLED <<<<<<', this.name);
        console.log('[BaseTheme] start() called, isActive:', this.isActive, 'theme:', this.name);

        // Don't early return - allow restart
        // Set active state
        this.isActive = true;
        this.webglRenderer = webglRenderer;

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
     * Clean up all theme resources
     * Called when theme is being destroyed
     */
    cleanup() {
        this.stop();

        // Remove containers from DOM
        this.containers.forEach((container) => {
            if (container && container.parentNode) {
                container.parentNode.removeChild(container);
            }
        });
        this.containers = [];

        this.webglRenderer = null;
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
}
