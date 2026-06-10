/**
 * @fileoverview Tetromino Style Manager
 * Manages theme-specific tetromino visual styles with caching for performance
 *
 * This manager resolves which visual style to use for tetrominos based on:
 * - Active theme configuration
 * - User settings (themeBasedTetrominos toggle)
 * - Default fallback colors
 *
 * Performance: Caches resolved configurations to avoid per-frame lookups
 */

import { eventBus, EVENTS } from '../events/event-bus.js';
import { COLORS } from '../core/constants.js';

/**
 * Default tetromino style configuration
 * Used when no theme-specific style is available or when theme-based tetrominos are disabled
 */
const DEFAULT_CONFIG = {
    version: 1,
    colors: COLORS,
    renderMode: 'solid',
    effects: {
        glowRadius: 0,
        glowIntensity: 0,
        outline: true,
        outlineWidth: 0.5,
        outlineColor: 'rgba(255, 255, 255, 0.08)',
        pulse: false,
        pulseSpeed: 0,
        pulseAmplitude: 0,
    },
    rendererOverrides: {},
};

/**
 * Tetromino Style Manager
 * Centralized manager for resolving and caching tetromino visual styles
 */
export class TetrominoStyleManager {
    /**
     * Create a new TetrominoStyleManager
     * @param {Object} themeManager - Theme manager instance
     * @param {Object} settingsManager - Settings manager instance
     */
    constructor(themeManager, settingsManager) {
        this.themeManager = themeManager;
        this.settingsManager = settingsManager;

        this.cachedConfig = null;
        this.eventUnsubscribers = [];
    }

    /**
     * Initialize the style manager
     * Sets up event listeners for theme and settings changes
     */
    init() {
        this._cacheCurrentStyle();

        // Listen for theme changes (from eventBus)
        const themeUnsub = eventBus.on(EVENTS.THEME_CHANGED, () => {
            this._onThemeChanged();
        });

        // Listen for settings changes (from window CustomEvent)
        const settingsHandler = (event) => {
            if (event.detail && event.detail.themeBasedTetrominos !== undefined) {
                this._onSettingsChanged();
            }
        };
        window.addEventListener('settingsChanged', settingsHandler);

        const settingsUnsub = () => window.removeEventListener('settingsChanged', settingsHandler);

        this.eventUnsubscribers.push(themeUnsub, settingsUnsub);
    }

    /**
     * Get style configuration for a specific piece type
     * Uses cached configuration for performance
     *
     * @param {string} pieceType - Piece type ('I', 'O', 'T', 'S', 'Z', 'J', 'L', 'GARBAGE')
     * @returns {Object} Style configuration with { color, renderMode, effects, rendererOverrides }
     */
    getStyleForPiece(pieceType) {
        if (!this.cachedConfig) {
            this._cacheCurrentStyle();
        }

        return {
            color: this.cachedConfig.colors[pieceType] || COLORS[pieceType] || '#808080',
            renderMode: this.cachedConfig.renderMode,
            effects: this.cachedConfig.effects,
            rendererOverrides: this.cachedConfig.rendererOverrides,
        };
    }

    /**
     * Resolve premium depth-effect parameters for the Phaser (main-canvas) renderer.
     * Returns continuous, fused-shape-only effects (gradient + outer rim + gloss);
     * never per-cell. A theme opts out by setting renderMode 'flat' or
     * effects.premium === false, or tunes via effects.phaser / rendererOverrides.phaser.
     *
     * @param {string} pieceType
     * @returns {{gradient:boolean, highlight:number, shadow:number, rim:boolean,
     *   rimAlpha:number, rimWidthFactor:number, gloss:boolean, glossAlpha:number}}
     */
    getPhaserEffects(pieceType) {
        if (!this.cachedConfig) this._cacheCurrentStyle();
        const cfg = this.cachedConfig || DEFAULT_CONFIG;
        const eff = cfg.effects || {};

        const base = {
            gradient: true,
            highlight: 0.18,
            shadow: 0.18,
            rim: true,
            rimAlpha: 0.42,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.22,
        };

        // Explicit opt-out for flat/accessibility themes.
        if (cfg.renderMode === 'flat' || eff.premium === false) {
            base.gradient = false;
            base.rim = false;
            base.gloss = false;
        }

        return {
            ...base,
            ...(eff.phaser || {}),
            ...((cfg.rendererOverrides && cfg.rendererOverrides.phaser) || {}),
        };
    }

    /**
     * Get all piece colors at once (for efficiency when rendering multiple pieces)
     * @returns {Object} Object mapping piece types to colors
     */
    getAllColors() {
        if (!this.cachedConfig) {
            this._cacheCurrentStyle();
        }
        return this.cachedConfig.colors;
    }

    /**
     * Force refresh of cached style
     * Call this manually if needed, but typically automatic via events
     */
    refresh() {
        this._cacheCurrentStyle();
    }

    /**
     * Cleanup event listeners
     * Call when disposing of the manager
     */
    destroy() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.cachedConfig = null;
    }

    // ============================================================================
    // Internal Methods
    // ============================================================================

    /**
     * Resolve settings manager dependency, falling back to global reference
     * @private
     * @returns {Object|null}
     */
    _resolveSettingsManager() {
        if (this.settingsManager) {
            return this.settingsManager;
        }

        if (typeof window !== 'undefined' && window.settingsManager) {
            this.settingsManager = window.settingsManager;
            return this.settingsManager;
        }

        return null;
    }

    /**
     * Resolve theme manager dependency, falling back to global reference
     * @private
     * @returns {Object|null}
     */
    _resolveThemeManager() {
        if (this.themeManager) {
            return this.themeManager;
        }

        if (typeof window !== 'undefined' && window.themeManager) {
            this.themeManager = window.themeManager;
            return this.themeManager;
        }

        return null;
    }

    /**
     * Cache the current style configuration based on active theme and settings
     * @private
     */
    _cacheCurrentStyle() {
        const settingsManager = this._resolveSettingsManager();
        const themeManager = this._resolveThemeManager();

        const settings = settingsManager?.get();
        const themeBasedEnabled = settings?.themeBasedTetrominos ?? true;

        if (themeBasedEnabled && themeManager?.activeTheme) {
            const themeConfig = themeManager.activeTheme.getTetrominoConfig?.();

            if (themeConfig) {
                this.cachedConfig = this._validateConfig(themeConfig);
                console.log('🎨 Tetromino style: Theme-based', themeManager.activeTheme.name);
                return;
            }
        }

        // Fallback to default
        this.cachedConfig = DEFAULT_CONFIG;
        console.log('🎨 Tetromino style: Default colors');
    }

    /**
     * Validate and normalize a theme config
     * Ensures all required fields exist and merges with defaults
     * @private
     * @param {Object} config - Theme tetromino configuration
     * @returns {Object} Validated configuration
     */
    _validateConfig(config) {
        // Ensure config has all required fields with proper defaults
        return {
            version: config.version || 1,
            colors: { ...COLORS, ...config.colors },
            renderMode: config.renderMode || 'solid',
            effects: { ...DEFAULT_CONFIG.effects, ...config.effects },
            rendererOverrides: config.rendererOverrides || {},
        };
    }

    /**
     * Handle theme change event
     * @private
     */
    _onThemeChanged() {
        console.log('🎨 Theme changed, refreshing tetromino style');
        this._cacheCurrentStyle();
    }

    /**
     * Handle settings change event
     * @private
     */
    _onSettingsChanged() {
        console.log('🎨 Settings changed, refreshing tetromino style');
        this._cacheCurrentStyle();
    }
}
