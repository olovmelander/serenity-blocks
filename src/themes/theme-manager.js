/**
 * @fileoverview Theme Manager - Orchestrates theme switching, lazy loading, and transitions
 */

import { THEMES } from '../core/constants.js';

/**
 * ThemeManager handles theme loading, switching, and lifecycle
 */
export class ThemeManager {
    constructor(webglRenderer) {
        this.webglRenderer = webglRenderer;
        this.activeTheme = null;
        this.activeThemeName = 'forest';
        this.themeInstances = new Map(); // Cache loaded theme instances
        this.themeRegistry = new Map(); // Map theme names to import paths
        this.randomThemeInterval = null;
        this.isTransitioning = false;

        // Initialize theme registry
        this.initializeRegistry();
    }

    /**
     * Initialize the registry of theme names to module paths
     * This enables lazy loading of themes
     */
    initializeRegistry() {
        // Map theme names to their module paths
        const themeMap = {
            'forest': './forest/forest-theme.js',
            'himalayan-peak': './himalayan-peak/himalayan-peak-theme.js',
            'ice-temple': './ice-temple/ice-temple-theme.js',
            'moonlit-forest': './moonlit-forest/moonlit-forest-theme.js',
            'wolfhour': './wolfhour/wolfhour-theme.js',
            'ocean': './ocean/ocean-theme.js',
            'sunset': './sunset/sunset-theme.js',
            'mountain': './mountain/mountain-theme.js',
            'zen': './zen/zen-theme.js',
            'winter': './winter/winter-theme.js',
            'fall': './fall/fall-theme.js',
            'summer': './summer/summer-theme.js',
            'spring': './spring/spring-theme.js',
            'aurora': './aurora/aurora-theme.js',
            'galaxy': './galaxy/galaxy-theme.js',
            'rainy-window': './rainy-window/rainy-window-theme.js',
            'koi-pond': './koi-pond/koi-pond-theme.js',
            'meadow': './meadow/meadow-theme.js',
            'cosmic-chimes': './cosmic-chimes/cosmic-chimes-theme.js',
            'singing-bowl': './singing-bowl/singing-bowl-theme.js',
            'starlight': './starlight/starlight-theme.js',
            'swedish-forest': './swedish-forest/swedish-forest-theme.js',
            'geode': './geode/geode-theme.js',
            'bioluminescence': './bioluminescence/bioluminescence-theme.js',
            'desert-oasis': './desert-oasis/desert-oasis-theme.js',
            'bamboo-grove': './bamboo-grove/bamboo-grove-theme.js',
            'misty-lake': './misty-lake/misty-lake-theme.js',
            'waves': './waves/waves-theme.js',
            'fluid-dreams': './fluid-dreams/fluid-dreams-theme.js',
            'lantern-festival': './lantern-festival/lantern-festival-theme.js',
            'crystal-cave': './crystal-cave/crystal-cave-theme.js',
            'candlelit-monastery': './candlelit-monastery/candlelit-monastery-theme.js',
            'cherry-blossom-garden': './cherry-blossom-garden/cherry-blossom-garden-theme.js',
            'floating-islands': './floating-islands/floating-islands-theme.js',
            'meditation-temple': './meditation-temple/meditation-temple-theme.js',
            'moonlit-greenhouse': './moonlit-greenhouse/moonlit-greenhouse-theme.js',
            'electric-dreams': './electric-dreams/electric-dreams-theme.js',
            'lunara': './lunara/lunara-theme.js',
            'pyrestorm': './pyrestorm/pyrestorm-theme.js',
            'neon-dusk': './neon-dusk/neon-dusk-theme.js',
            'stillwater': './stillwater/stillwater-theme.js'
        };

        for (const [name, path] of Object.entries(themeMap)) {
            this.themeRegistry.set(name, path);
        }
    }

    /**
     * Load a theme module dynamically
     * @param {string} themeName - Name of theme to load
     * @returns {Promise<BaseTheme>} Theme instance
     */
    async loadTheme(themeName) {
        // Check if already loaded
        if (this.themeInstances.has(themeName)) {
            return this.themeInstances.get(themeName);
        }

        // Get module path
        const modulePath = this.themeRegistry.get(themeName);
        if (!modulePath) {
            console.error(`Theme "${themeName}" not found in registry`);
            // Fallback to forest theme
            return this.loadTheme('forest');
        }

        try {
            // Dynamically import the theme module
            const module = await import(modulePath);
            const ThemeClass = module.default;

            // Instantiate the theme
            const themeInstance = new ThemeClass();

            // Initialize the theme
            await themeInstance.init();

            // Cache the instance
            this.themeInstances.set(themeName, themeInstance);

            return themeInstance;
        } catch (error) {
            console.error(`Failed to load theme "${themeName}":`, error);
            // Fallback to forest if not already trying to load it
            if (themeName !== 'forest') {
                return this.loadTheme('forest');
            }
            throw error;
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
        if (!THEMES.includes(themeName)) {
            console.error('[ThemeManager] Invalid theme name:', themeName);
            return;
        }

        this.isTransitioning = true;

        try {
            console.log('[ThemeManager] Loading theme:', themeName);
            // Load the new theme
            const newTheme = await this.loadTheme(themeName);
            console.log('[ThemeManager] Theme loaded:', newTheme);

            // Stop current theme if any
            if (this.activeTheme) {
                console.log('[ThemeManager] Stopping current theme:', this.activeThemeName);
                this.activeTheme.stop();
            }

            // Start new theme
            console.log('[ThemeManager] Starting new theme with renderer:', this.webglRenderer);
            await newTheme.start(this.webglRenderer);

            // Update active theme
            this.activeTheme = newTheme;
            this.activeThemeName = themeName;

            // Dispatch theme change event
            window.dispatchEvent(new CustomEvent('themeChanged', {
                detail: { themeName }
            }));

            console.log('[ThemeManager] Theme switch complete:', themeName);

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
        const availableThemes = THEMES.filter(name => name !== this.activeThemeName);
        const randomIndex = Math.floor(Math.random() * availableThemes.length);
        return availableThemes[randomIndex];
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
        this.stopRandomThemeInterval();

        if (this.activeTheme) {
            this.activeTheme.stop();
        }

        // Cleanup all cached theme instances
        for (const theme of this.themeInstances.values()) {
            theme.cleanup();
        }
        this.themeInstances.clear();

        this.activeTheme = null;
        this.webglRenderer = null;
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
