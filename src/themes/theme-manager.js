/**
 * @fileoverview Theme Manager - Orchestrates theme switching, lazy loading, and transitions
 */

import { THEMES } from '../core/constants.js';
import { THEME_REGISTRY, getThemeMeta } from './theme-registry.js';
import { eventBus, EVENTS } from '../events/event-bus.js';
import { assetManager } from '../utils/asset-manager.js';
import { audioManager } from '../utils/audio-manager.js';
import { performanceMonitor } from '../utils/performance-monitor.js';

/** Timeout in ms for theme init() and start() — prevents game freeze from hanging themes */
const THEME_LIFECYCLE_TIMEOUT = 10000;

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

/**
 * ThemeManager handles theme loading, switching, and lifecycle
 */
export class ThemeManager {
    constructor(webglRenderer, { assetManager: assetMgr = null, audioManager: audioMgr = null } = {}) {
        this.webglRenderer = webglRenderer;
        this.activeTheme = null;
        this.activeThemeName = 'forest';
        this.themeInstances = new Map(); // Cache loaded theme instances
        this.themeRegistry = new Map(); // Map theme names to lazy importers
        this.randomThemeInterval = null;
        this.isTransitioning = false;
        this.themesSuspended = true;
        this.pendingThemeName = null;
        this.pendingThemeInstance = null;

        // LRU cache management
        this.maxCachedThemes = 5; // Limit cache size to prevent memory growth
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

    async resolveThemeImporter(themeName, importer) {
        try {
            return await importer();
        } catch (error) {
            const message = error?.message || String(error);
            const looksLikeChunkFailure = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|preload/i.test(message);

            if (!looksLikeChunkFailure) {
                throw error;
            }

            console.warn(`[ThemeManager] Dynamic import failed for "${themeName}", retrying once`, error);
            await new Promise((resolve) => setTimeout(resolve, 100));
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
            if (themeName === 'forest') {
                throw new Error('Forest theme not found in registry — cannot fallback');
            }
            console.error(`Theme "${themeName}" not found in registry, falling back to forest`);
            return this.loadTheme('forest', silent);
        }

        try {
            if (!silent) {
                console.log(`[ThemeManager] Loading theme "${themeName}" from disk`);
            }

            // Dynamically import the theme module
            const module = await this.resolveThemeImporter(themeName, importer);
            const ThemeClass = module.default;

            // Instantiate the theme
            const themeInstance = new ThemeClass();

            // Initialize the theme (with timeout to prevent game freeze)
            await withTimeout(themeInstance.init(), THEME_LIFECYCLE_TIMEOUT, `Theme "${themeName}" init`);

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
        const switchStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const previousTheme = this.activeThemeName;

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
                if (this.webglRenderer && typeof this.webglRenderer.clearThemeResources === 'function') {
                    console.log('[ThemeManager] Clearing renderer theme resources');
                    this.webglRenderer.clearThemeResources();
                }
            }

            this.pendingThemeInstance = newTheme;
            this.pendingThemeName = themeName;
            this.activeThemeName = themeName;

            if (this.themesSuspended) {
                console.log('[ThemeManager] Theme activation deferred (themes are suspended)');
                this.activeThemeName = themeName;
            } else {
                await this.activateThemeInstance(newTheme, themeName);
            }
        } catch (error) {
            console.error('[ThemeManager] Failed to switch theme:', error);
        } finally {
            const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            performanceMonitor.recordThemeSwitch({
                fromTheme: previousTheme,
                toTheme: themeName,
                durationMs: endedAt - switchStartedAt,
            });
            this.isTransitioning = false;
        }
    }

    async activateThemeInstance(themeInstance, themeName) {
        if (!themeInstance) {
            console.error('[ThemeManager] Cannot activate null theme instance');
            return;
        }

        console.log('[ThemeManager] Activating theme:', themeName, 'isActive:', themeInstance.isActive);

        // Stop current active theme if different from the one we're activating
        if (this.activeTheme && this.activeTheme !== themeInstance) {
            console.log('[ThemeManager] Stopping current theme:', this.activeThemeName);
            this.activeTheme.stop();

            // Clean up renderer resources when switching between different themes
            if (this.webglRenderer && typeof this.webglRenderer.clearThemeResources === 'function') {
                console.log('[ThemeManager] Clearing renderer theme resources for theme switch');
                this.webglRenderer.clearThemeResources();
            }
        }

        // Start the theme (this calls createScene and initializes everything)
        console.log('[ThemeManager] Starting theme:', themeName);
        try {
            await withTimeout(
                themeInstance.start(this.webglRenderer, {
                    assetManager: this.assetManager,
                    audioManager: this.audioManager,
                }),
                THEME_LIFECYCLE_TIMEOUT,
                `Theme "${themeName}" start`,
            );
        } catch (error) {
            console.error(`[ThemeManager] Theme "${themeName}" failed to start:`, error);
            // Attempt fallback to forest if this wasn't already forest
            if (themeName !== 'forest') {
                console.warn('[ThemeManager] Falling back to forest theme');
                const forestTheme = await this.loadTheme('forest');
                await this.activateThemeInstance(forestTheme, 'forest');
                return;
            }
            // Forest itself failed — no further fallback possible
            throw error;
        }

        this.activeTheme = themeInstance;
        this.activeThemeName = themeName;
        this.pendingThemeInstance = null;
        this.pendingThemeName = null;
        this.updateLRU(themeName);
        this.themesSuspended = false;

        eventBus.emit(EVENTS.THEME_CHANGED, { themeName });
        console.log('[ThemeManager] Theme activation complete:', themeName);

        this.preloadNextTheme().catch((error) => {
            console.warn('[ThemeManager] Failed to preload next theme:', error);
        });
    }

    suspendThemes() {
        if (this.activeTheme) {
            console.log('[ThemeManager] Suspending active theme:', this.activeThemeName);
            const paused = typeof this.activeTheme.pause === 'function'
                ? this.activeTheme.pause()
                : false;

            if (!paused) {
                this.activeTheme.stop();
            }

            this.pendingThemeInstance = this.activeTheme;
            this.pendingThemeName = this.activeThemeName;
            this.activeTheme = null;
        }

        // Don't cleanup the renderer when suspending - we'll likely resume with the same theme
        // Only cleanup when actually switching themes or shutting down
        // This preserves canvas contexts and GPU resources for quick resume
        console.log('[ThemeManager] Theme suspended, renderer preserved for quick resume');

        this.themesSuspended = true;
    }

    async resumeThemes() {
        if (!this.themesSuspended) {
            console.log('[ThemeManager] Themes not suspended, nothing to resume');
            return;
        }

        const themeName = this.pendingThemeName || this.activeThemeName;
        const themeInstance = this.pendingThemeInstance || (themeName ? this.themeInstances.get(themeName) : null);

        if (!themeName || !themeInstance) {
            console.warn('[ThemeManager] No theme queued to resume');
            this.themesSuspended = false;
            return;
        }

        console.log('[ThemeManager] Resuming themes - themeName:', themeName, 'isActive:', themeInstance.isActive, 'pendingTheme:', !!this.pendingThemeInstance);

        // Check if theme was ever started (has isActive been true before)
        // If the theme was loaded but never started, we need to do full activation
        const wasNeverStarted = !themeInstance.hasStarted && this.pendingThemeInstance === themeInstance;

        if (wasNeverStarted) {
            console.log('[ThemeManager] Theme was never started, performing full activation');
            await this.activateThemeInstance(themeInstance, themeName);
            return;
        }

        // If resuming the exact same theme instance that was suspended, try quick resume
        if (themeInstance === this.pendingThemeInstance && !this.activeTheme) {
            console.log('[ThemeManager] Attempting quick resume for theme:', themeName);

            this.activeTheme = themeInstance;
            this.activeThemeName = themeName;
            this.themesSuspended = false;

            // Try to resume the theme (restores contexts without recreating scene)
            const resumed = typeof themeInstance.resume === 'function'
                ? themeInstance.resume()
                : false;

            if (!resumed) {
                // Resume failed or not supported, do full restart
                console.log('[ThemeManager] Quick resume failed, performing full restart');
                await this.activateThemeInstance(themeInstance, themeName);
            } else {
                // Successfully resumed
                this.pendingThemeInstance = null;
                this.pendingThemeName = null;

                // Restart animation loop if the theme has an animate method
                if (typeof themeInstance.animate === 'function') {
                    themeInstance.animate();
                }

                eventBus.emit(EVENTS.THEME_CHANGED, { themeName });
                console.log('[ThemeManager] Theme resumed successfully (quick resume):', themeName);
            }
        } else {
            // Different theme or no pending instance, do full activation
            console.log('[ThemeManager] Performing full theme activation');
            await this.activateThemeInstance(themeInstance, themeName);
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
     * Get theme for a specific level (for level-based theme progression)
     * @param {number} level - Current game level
     * @returns {string} Theme name
     */
    getThemeForLevel(level) {
        // Map levels to themes with a progression
        const themeIndex = Math.floor((level - 1) / 3) % THEMES.length;
        return THEMES[themeIndex];
    }

    getAvailableThemes() {
        return [...THEMES];
    }

    /**
     * Shuffle the theme deck to ensure all themes are visited before repeating
     * Uses Fisher-Yates shuffle algorithm
     * @private
     */
    _shuffleThemeDeck() {
        // Get all themes except the current one
        const availableThemes = THEMES.filter((name) => name !== this.activeThemeName);

        // Fisher-Yates shuffle
        for (let i = availableThemes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [availableThemes[i], availableThemes[j]] = [availableThemes[j], availableThemes[i]];
        }

        this.themeShuffleDeck = availableThemes;
        console.log(`[ThemeManager] Shuffled theme deck with ${this.themeShuffleDeck.length} themes`);
    }

    /**
     * Get a random theme (excluding current) using shuffle deck system
     * Ensures all themes are visited before any theme repeats
     * @returns {string} Theme name
     */
    getRandomTheme() {
        // If deck is empty or doesn't exist, reshuffle
        if (!this.themeShuffleDeck || this.themeShuffleDeck.length === 0) {
            this._shuffleThemeDeck();
        }

        // Draw from the top of the deck
        const nextTheme = this.themeShuffleDeck.pop();
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
        if (this.audioManager?.stopAll) {
            console.log('[ThemeManager] Stopping all audio');
            this.audioManager.stopAll();
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

        // Clean up renderer resources after themes release their references
        if (this.webglRenderer && typeof this.webglRenderer.cleanup === 'function') {
            console.log('[ThemeManager] Cleaning up renderer');
            this.webglRenderer.cleanup();
        }

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
