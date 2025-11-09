/**
 * @fileoverview Theme Manager - Orchestrates theme switching, lazy loading, and transitions
 */

import { THEMES } from '../core/constants.js';
import { THEME_REGISTRY, getThemeMeta } from './theme-registry.js';
import { eventBus, EVENTS } from '../events/event-bus.js';
import { assetManager } from '../utils/asset-manager.js';
import { audioManager } from '../utils/audio-manager.js';

/**
 * ThemeManager handles theme loading, switching, and lifecycle
 */
export class ThemeManager {
    constructor(webglRenderer) {
        this.webglRenderer = webglRenderer;
        this.activeTheme = null;
        this.activeThemeName = 'forest';
        this.themeInstances = new Map(); // Cache loaded theme instances
        this.themeRegistry = new Map(); // Map theme names to lazy importers
        this.randomThemeInterval = null;
        this.isTransitioning = false;

        // LRU cache management
        this.maxCachedThemes = 5; // Limit cache size to prevent memory growth
        this.themeLRU = []; // Track theme access order (oldest to newest)
        
        // Asset and Audio managers (shared across all themes for efficient caching)
        this.assetManager = assetManager;
        this.audioManager = audioManager;

        // Initialize theme registry
        this.initializeRegistry();
        
        console.log('[ThemeManager] Initialized with asset and audio managers');
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

    /**
     * Evict oldest theme from cache if over limit
     * Protects active theme from eviction
     */
    evictOldThemeIfNeeded() {
        if (this.themeInstances.size <= this.maxCachedThemes) {
            return; // Under limit, no eviction needed
        }

        // Find oldest theme that's not currently active
        for (const themeName of this.themeLRU) {
            if (themeName !== this.activeThemeName) {
                console.log(`[ThemeManager] Evicting old theme from cache: ${themeName}`);
                const themeInstance = this.themeInstances.get(themeName);
                
                if (themeInstance) {
                    // Call cleanup to free resources
                    if (typeof themeInstance.cleanup === 'function') {
                        themeInstance.cleanup();
                    }
                    this.themeInstances.delete(themeName);
                }
                
                // Remove from LRU tracking
                const index = this.themeLRU.indexOf(themeName);
                if (index > -1) {
                    this.themeLRU.splice(index, 1);
                }
                
                console.log(`[ThemeManager] Cache size after eviction: ${this.themeInstances.size}/${this.maxCachedThemes}`);
                break; // Only evict one at a time
            }
        }
    }

    /**
     * Load a theme module dynamically
     * @param {string} themeName - Name of theme to load
     * @param {boolean} silent - Don't log verbose messages (for background preloading)
     * @returns {Promise<BaseTheme>} Theme instance
     */
    async loadTheme(themeName, silent = false) {
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
            console.error(`Theme "${themeName}" not found in registry`);
            // Fallback to forest theme
            return this.loadTheme('forest', silent);
        }

        try {
            if (!silent) {
                console.log(`[ThemeManager] Loading theme "${themeName}" from disk`);
            }

            // Dynamically import the theme module
            const module = await importer();
            const ThemeClass = module.default;

            // Instantiate the theme
            const themeInstance = new ThemeClass();

            // Initialize the theme
            await themeInstance.init();

            // Cache the instance
            this.themeInstances.set(themeName, themeInstance);
            this.updateLRU(themeName);

            // Evict old themes if cache is full
            this.evictOldThemeIfNeeded();

            if (!silent) {
                console.log(`[ThemeManager] Theme "${themeName}" loaded. Cache: ${this.themeInstances.size}/${this.maxCachedThemes}`);
            }
            return themeInstance;
        } catch (error) {
            console.error(`Failed to load theme "${themeName}":`, error);
            // Fallback to forest if not already trying to load it
            if (themeName !== 'forest') {
                return this.loadTheme('forest', silent);
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

        if (!this.themeInstances.has(nextTheme)) {
            console.log(`[ThemeManager] Preloading next theme: ${nextTheme}`);
            await this.loadTheme(nextTheme, true);
        }
    }

    /**
     * Switch to a new theme
     * @param {string} themeName - Name of theme to switch to
     * @param {boolean} immediate - Skip transition if true
     * @returns {Promise<void>}
     */
    async switchTheme(themeName, immediate = false) {
        console.log('[ThemeManager] switchTheme called:', themeName);

        if (this.isTransitioning) {
            console.log('[ThemeManager] Theme transition already in progress');
            return;
        }

        if (this.activeThemeName === themeName && this.activeTheme) {
            console.log('[ThemeManager] Already on theme:', themeName);
            return; // Already on this theme
        }

        // Validate theme name
        if (!getThemeMeta(themeName)) {
            console.error('[ThemeManager] Invalid theme name:', themeName);
            return;
        }

        this.isTransitioning = true;

        try {
            console.log('[ThemeManager] Loading theme:', themeName);
            // Load the new theme
            const newTheme = await this.loadTheme(themeName);
            console.log('[ThemeManager] Theme loaded:', newTheme);

            // Stop and cleanup current theme if any
            if (this.activeTheme) {
                console.log('[ThemeManager] Stopping current theme:', this.activeThemeName);
                this.activeTheme.stop();
                
                // IMPORTANT: Clean up renderer resources before loading new theme
                if (this.webglRenderer && typeof this.webglRenderer.cleanup === 'function') {
                    console.log('[ThemeManager] Cleaning up renderer resources');
                    this.webglRenderer.cleanup();
                }
            }

            // Start new theme (pass resource managers for efficient asset loading)
            console.log('[ThemeManager] Starting new theme with renderer:', this.webglRenderer);
            await newTheme.start(this.webglRenderer, {
                assetManager: this.assetManager,
                audioManager: this.audioManager
            });

            // Update active theme
            this.activeTheme = newTheme;
            this.activeThemeName = themeName;
            
            // Update LRU to mark this theme as active/recent
            this.updateLRU(themeName);

            // Dispatch theme change event
            eventBus.emit(EVENTS.THEME_CHANGED, { themeName });

            console.log('[ThemeManager] Theme switch complete:', themeName);

            // Preload next theme in background for seamless transitions
            this.preloadNextTheme().catch((error) => {
                console.warn('[ThemeManager] Failed to preload next theme:', error);
            });
        } catch (error) {
            console.error('[ThemeManager] Failed to switch theme:', error);
        } finally {
            this.isTransitioning = false;
        }
    }

    /**
     * Get theme for a specific level (for level-based theme progression)
     * @param {number} level - Current game level
     * @returns {string} Theme name
     */
    getThemeForLevel(level) {
        // Map levels to themes with a progression
        const themeIndex = Math.floor((level - 1) / 3) % THEMES.length;
        return THEMES[themeIndex];
    }

    /**
     * Get a random theme (excluding current)
     * @returns {string} Theme name
     */
    getRandomTheme() {
        const availableThemes = THEMES.filter((name) => name !== this.activeThemeName);
        const randomIndex = Math.floor(Math.random() * availableThemes.length);
        return availableThemes[randomIndex];
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
            theme.cleanup();
            this.themeInstances.delete(themeName);
        }
    }

    /**
     * Clean up all theme resources
     */
    cleanup() {
        console.log('[ThemeManager] Starting full cleanup...');
        
        this.stopRandomThemeInterval();

        if (this.activeTheme) {
            this.activeTheme.stop();
        }
        
        // Stop all audio before cleaning up
        if (this.audioManager) {
            console.log('[ThemeManager] Stopping all audio');
            this.audioManager.stopAll();
        }
        
        // Clean up renderer resources
        if (this.webglRenderer && typeof this.webglRenderer.cleanup === 'function') {
            console.log('[ThemeManager] Cleaning up renderer');
            this.webglRenderer.cleanup();
        }

        // Cleanup all cached theme instances
        console.log(`[ThemeManager] Cleaning up ${this.themeInstances.size} cached themes`);
        for (const [themeName, theme] of this.themeInstances.entries()) {
            console.log(`[ThemeManager] Cleaning up theme: ${themeName}`);
            if (typeof theme.cleanup === 'function') {
                theme.cleanup();
            }
        }
        this.themeInstances.clear();
        
        // Clear LRU tracking
        this.themeLRU = [];

        this.activeTheme = null;
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
