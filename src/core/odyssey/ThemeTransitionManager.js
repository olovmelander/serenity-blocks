/**
 * @fileoverview ThemeTransitionManager - Smooth theme transitions for Odyssey Mode
 *
 * Provides fade, crossfade, and warp transitions between themes.
 * Wraps the existing ThemeManager for odyssey-specific transitions.
 *
 * Phase 4 - Odyssey Mode Theme Transitions
 */

import { WarpTransitionRenderer } from '../../rendering/transitions/WarpTransitionRenderer.js';

/**
 * ThemeTransitionManager - Handles smooth visual transitions between themes
 */
export class ThemeTransitionManager {
    /**
     * @param {Object} themeManager - The existing ThemeManager instance
     */
    constructor(themeManager) {
        this.themeManager = themeManager;
        this.activeTheme = null;
        this.overlays = [];
        this.transitionQueue = [];
        this.isTransitioning = false;

        // DOM element
        this.overlay = document.getElementById('theme-transition-overlay');

        // Three.js warp transition renderer (lazy initialized)
        this.warpRenderer = null;

        console.log('[ThemeTransition] Manager initialized');
    }

    // ========================================
    // Public API
    // ========================================

    /**
     * Set up theme for a level with configured transition
     * @param {Object} themeConfig - Level theme configuration
     * @returns {Promise<void>}
     */
    async setupLevel(themeConfig) {
        const {
            primary,
            overlays = [],
            transitionIn = 'warp', // Default to warp for mesmerizing effect
            transitionDuration = 2000,
        } = themeConfig;

        console.log(`[ThemeTransition] Setting up level theme: ${primary} (${transitionIn})`);

        // Execute transition to new theme
        await this.transition(primary, transitionIn, transitionDuration);

        // Apply overlays after primary theme is loaded
        if (overlays.length > 0) {
            await this.applyOverlays(overlays);
        }

        this.activeTheme = primary;
    }

    /**
     * Transition from gameplay back to Odyssey Board (no theme needed)
     * @param {number} duration - Transition duration in ms
     * @returns {Promise<void>}
     */
    async transitionToBoard(duration = 500) {
        console.log('[ThemeTransition] Transitioning to board view');

        // Fade to black
        await this.fadeIn(duration / 2);

        // Suspend themes while on board
        this.themeManager?.suspendThemes?.();

        // Fade from black
        await this.fadeOut(duration / 2);
    }

    /**
     * Execute a theme transition
     * @param {string} themeName - Target theme name
     * @param {string} transitionType - 'fade', 'crossfade', or 'warp'
     * @param {number} duration - Duration in ms
     * @returns {Promise<void>}
     */
    async transition(themeName, transitionType, duration) {
        if (this.isTransitioning) {
            // Queue this transition
            return new Promise((resolve) => {
                this.transitionQueue.push({ themeName, transitionType, duration, resolve });
            });
        }

        this.isTransitioning = true;

        try {
            switch (transitionType) {
                case 'fade':
                    await this.fadeTransition(themeName, duration);
                    break;

                case 'crossfade':
                    await this.crossfadeTransition(themeName, duration);
                    break;

                case 'warp':
                    await this.warpTransition(themeName, duration);
                    break;

                case 'none':
                case 'instant':
                    await this.themeManager?.switchTheme?.(themeName, true);
                    break;

                default:
                    // Default to warp for the best experience
                    await this.warpTransition(themeName, duration);
            }
        } catch (error) {
            console.error('[ThemeTransition] Error during transition:', error);
            // Fallback to instant switch on error
            await this.themeManager?.switchTheme?.(themeName, true);
        }

        this.isTransitioning = false;

        // Process queue
        if (this.transitionQueue.length > 0) {
            const next = this.transitionQueue.shift();
            await this.transition(next.themeName, next.transitionType, next.duration);
            next.resolve?.();
        }
    }

    // ========================================
    // Transition Implementations
    // ========================================

    /**
     * Fade transition: fade to black, switch theme, fade from black
     * @param {string} themeName - Target theme
     * @param {number} duration - Total duration in ms
     */
    async fadeTransition(themeName, duration) {
        const halfDuration = duration / 2;

        // Fade to black
        await this.fadeIn(halfDuration);

        // Switch theme while blacked out
        await this.themeManager?.switchTheme?.(themeName, true);

        // Small delay to ensure theme is ready
        await this.wait(50);

        // Fade from black
        await this.fadeOut(halfDuration);
    }

    /**
     * Crossfade transition: capture current, switch, blend old over new
     * @param {string} themeName - Target theme
     * @param {number} duration - Crossfade duration in ms
     */
    async crossfadeTransition(themeName, duration) {
        // Capture current theme as screenshot
        const screenshot = await this.captureCurrentTheme();

        if (!screenshot) {
            // Fallback to fade if capture fails
            return this.fadeTransition(themeName, duration);
        }

        // Switch theme immediately (will be hidden by screenshot)
        await this.themeManager?.switchTheme?.(themeName, true);

        // Crossfade the screenshot away
        screenshot.classList.add('fading');
        screenshot.style.setProperty('--crossfade-duration', `${duration}ms`);

        // Wait for crossfade to complete
        await this.wait(duration);

        // Remove screenshot
        screenshot.remove();
    }

    /**
     * Warp transition: Mesmerizing Three.js particle warp effect
     * @param {string} themeName - Target theme
     * @param {number} duration - Duration in ms
     */
    async warpTransition(themeName, duration) {
        // Lazy initialize the warp renderer
        if (!this.warpRenderer) {
            this.warpRenderer = new WarpTransitionRenderer();
        }

        // Start the warp animation
        const warpPromise = this.warpRenderer.play(duration);

        // At 55% of the animation, switch the theme (when central glow is brightest)
        // This creates a seamless visual where the bright white obscures the switch
        await this.wait(duration * 0.55);

        // Switch theme during the peak intensity
        await this.themeManager?.switchTheme?.(themeName, true);

        // Wait for warp animation to complete
        await warpPromise;
    }

    /**
     * Play just the warp animation (for use when loading happens separately)
     * @param {number} duration - Duration in ms
     * @returns {Promise} Resolves when warp completes
     */
    async playWarp(duration) {
        // Lazy initialize the warp renderer
        if (!this.warpRenderer) {
            this.warpRenderer = new WarpTransitionRenderer();
        }

        return this.warpRenderer.play(duration);
    }

    /**
     * Pre-initialize the warp renderer to avoid GPU init freeze when starting
     * Call this early (e.g., when board loads) so shaders are compiled in advance
     */
    preInitWarp() {
        if (!this.warpRenderer) {
            this.warpRenderer = new WarpTransitionRenderer();
            this.warpRenderer.init();
            console.log('[ThemeTransition] Warp renderer pre-initialized');
        }
    }

    // ========================================
    // Helper Methods
    // ========================================

    /**
     * Fade the overlay to black
     * @param {number} duration - Duration in ms
     */
    async fadeIn(duration) {
        if (!this.overlay) return;

        this.overlay.style.setProperty('--transition-duration', `${duration}ms`);
        this.overlay.classList.add('active', 'fade-in');
        this.overlay.classList.remove('fade-out');

        await this.wait(duration);
    }

    /**
     * Fade the overlay from black to transparent
     * @param {number} duration - Duration in ms
     */
    async fadeOut(duration) {
        if (!this.overlay) return;

        this.overlay.style.setProperty('--transition-duration', `${duration}ms`);
        this.overlay.classList.add('fade-out');
        this.overlay.classList.remove('fade-in');

        await this.wait(duration);

        this.overlay.classList.remove('active', 'fade-out');
    }

    /**
     * Capture the current theme as a canvas screenshot
     * @returns {HTMLCanvasElement|null}
     */
    async captureCurrentTheme() {
        try {
            // Try to get the theme container or background
            const bgContainer = document.querySelector('.background-container');
            if (!bgContainer) return null;

            // Use html2canvas if available, otherwise create a simple overlay
            // For now, create a canvas with the current background color
            const canvas = document.createElement('canvas');
            canvas.className = 'theme-crossfade-canvas';
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            const ctx = canvas.getContext('2d');

            // Get computed background color as fallback
            const bgColor = getComputedStyle(bgContainer).backgroundColor || '#000';
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Append to body
            document.body.appendChild(canvas);

            return canvas;
        } catch (error) {
            console.warn('[ThemeTransition] Failed to capture theme:', error);
            return null;
        }
    }

    /**
     * Apply overlay themes on top of primary
     * @param {string[]} overlayNames - Overlay theme names
     */
    async applyOverlays(overlayNames) {
        // Clear existing overlays
        this.overlays.forEach((o) => o.dispose?.());
        this.overlays = [];

        // Note: Overlay blending requires shader-based approach
        // For now, just log that overlays were requested
        console.log(`[ThemeTransition] Overlays requested: ${overlayNames.join(', ')}`);
        // Future: Load overlay themes and blend them using shaders
    }

    /**
     * Wait helper
     * @param {number} ms - Milliseconds to wait
     */
    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Dispose and cleanup
     */
    dispose() {
        this.transitionQueue = [];
        this.overlays.forEach((o) => o.dispose?.());
        this.overlays = [];

        if (this.warpRenderer) {
            this.warpRenderer.dispose();
            this.warpRenderer = null;
        }

        console.log('[ThemeTransition] Disposed');
    }
}

export default ThemeTransitionManager;

