/**
 * @fileoverview ThemeTransitionManager - Smooth theme transitions for Odyssey Mode
 *
 * Provides fade, crossfade, and warp transitions between themes.
 * Wraps the existing ThemeManager for odyssey-specific transitions.
 *
 * Phase 4 - Odyssey Mode Theme Transitions
 */

import { WarpTransitionRenderer } from '../../rendering/transitions/WarpTransitionRenderer.js';
import { resolveWarpQualityProfile } from '../../rendering/transitions/warp-quality-profiles.js';
import { TRANSITION_LAYERS } from '../../rendering/transitions/transition-layer-constants.js';

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
        this.prefetchRecords = new Map();

        // DOM element
        this.overlay = document.getElementById('theme-transition-overlay');
        if (this.overlay) {
            this.overlay.style.zIndex = String(TRANSITION_LAYERS.THEME_OVERLAY);
            this.overlay.dataset.odysseyWheelLock = 'true';
        }

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
                this.transitionQueue.push({
                    themeName, transitionType, duration, resolve,
                });
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

        return undefined;
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
        return undefined;
    }

    /**
     * Warp transition: Mesmerizing Three.js particle warp effect
     * @param {string} themeName - Target theme
     * @param {number} duration - Duration in ms
     */
    async warpTransition(themeName, duration) {
        // Lazy initialize the warp renderer
        this.ensureWarpRenderer();

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
     * @param {Object} [themeConfig] - Theme colors for the warp
     * @param {THREE.Color|number} [themeConfig.chapterColor] - Primary chapter color
     * @param {THREE.Color|number} [themeConfig.accentColor] - Accent color
     * @returns {Promise} Resolves when warp completes
     */
    async playWarp(duration, themeConfig = null) {
        // Backward-compatible wrapper: keep legacy signature.
        return this.playOrbPortal({ duration, themeConfig });
    }

    /**
     * Play the Odyssey orb-portal transition with profile + anchor support.
     * @param {Object} config
     * @param {number} [config.duration=4000]
     * @param {string|Object} [config.profile='High']
     * @param {Object} [config.themeConfig]
     * @param {Object} [config.portalAnchor]
     * @param {Object} [config.compositor]
     * @returns {Promise<{success: boolean, degraded: boolean, error?: Error}>}
     */
    async playOrbPortal(config = {}) {
        const {
            duration = 4000,
            profile = 'High',
            themeConfig = null,
            portalAnchor = null,
            compositor = null,
        } = config;

        this.ensureWarpRenderer();

        const resolvedProfile = typeof profile === 'string'
            ? resolveWarpQualityProfile(profile)
            : profile;

        try {
            if (typeof this.warpRenderer.playProfile === 'function') {
                await this.warpRenderer.playProfile({
                    duration,
                    qualityProfile: resolvedProfile,
                    themeConfig,
                    portalAnchor,
                    compositor,
                });
                return { success: true, degraded: false };
            }

            // Legacy fallback path
            if (portalAnchor && typeof this.warpRenderer.setPortalAnchor === 'function') {
                this.warpRenderer.setPortalAnchor(portalAnchor);
            }
            await this.warpRenderer.play(duration, themeConfig);
            return { success: true, degraded: false };
        } catch (error) {
            console.error('[ThemeTransition] Orb portal transition failed:', error);
            return { success: false, degraded: true, error };
        }
    }

    /**
     * Pre-initialize the warp renderer to avoid GPU init freeze when starting
     * Call this early (e.g., when board loads) so shaders are compiled in advance
     */
    preInitWarp() {
        this.ensureWarpRenderer();
        this.warpRenderer.init();
        this.warpRenderer.prewarmFrame?.();
        console.log('[ThemeTransition] Warp renderer pre-initialized');
    }

    /**
     * Preload a level theme while still in board view.
     * This is intentionally best-effort and non-blocking for UX responsiveness.
     * @param {Object} levelConfig
     * @returns {Promise<boolean>}
     */
    async prefetchLevelTheme(levelConfig, options = {}) {
        const themeName = levelConfig?.theme?.primary;
        const priority = options.priority === 'high' ? 'high' : 'low';
        if (!themeName || !this.themeManager?.loadTheme) {
            return false;
        }

        if (this.themeManager?.themeInstances?.has?.(themeName)) {
            return true;
        }

        const existingRecord = this.prefetchRecords.get(themeName);
        if (existingRecord) {
            if (priority === 'high' && existingRecord.priority !== 'high') {
                existingRecord.priority = 'high';
                this.startPrefetchRecord(existingRecord);
            }
            return existingRecord.promise;
        }

        const record = this.createPrefetchRecord(themeName, priority);
        this.prefetchRecords.set(themeName, record);

        if (priority === 'high') {
            this.startPrefetchRecord(record);
        } else {
            this.schedulePrefetchRecord(record);
        }

        return record.promise;
    }

    /**
     * Activate a prefetched theme only when the transition is already covered.
     * This avoids visual contention during ORB_LOCK while still keeping assets hot.
     * @param {Object} levelConfig
     * @returns {Promise<boolean>}
     */
    async activatePrefetchedLevelTheme(levelConfig) {
        const themeName = levelConfig?.theme?.primary;
        if (!themeName || !this.themeManager?.switchTheme) {
            return false;
        }

        try {
            const record = this.prefetchRecords.get(themeName);

            if (record) {
                this.startPrefetchRecord(record);
                await record.promise;
            } else if (this.themeManager?.loadTheme) {
                await this.themeManager.loadTheme(themeName, true);
            }

            await this.themeManager.switchTheme(themeName, true);

            if (this.themeManager.themesSuspended) {
                await this.themeManager.resumeThemes();
            }

            return true;
        } catch (error) {
            console.warn('[ThemeTransition] Theme activation failed:', themeName, error);
            return false;
        }
    }

    /**
     * Wait until the active theme is safe to reveal for gameplay.
     * @param {Object} levelConfig
     * @param {number} timeoutMs
     * @returns {Promise<boolean>}
     */
    async waitForThemeCriticalReady(levelConfig, timeoutMs = 1800) {
        const themeName = levelConfig?.theme?.primary;
        if (!themeName || !this.themeManager) {
            return false;
        }

        const deadline = Date.now() + Math.max(0, timeoutMs);
        const activated = await this.ensureThemeActivated(themeName, this.getRemainingTime(deadline));
        if (!activated) {
            return false;
        }

        const containerReady = await this.waitForCondition(() => {
            const container = document.getElementById(`${themeName}-theme`);
            return !!container && container.classList?.contains('active');
        }, this.getRemainingTime(deadline));

        if (!containerReady) {
            return false;
        }

        const frameReady = await this.waitForAnimationFrames(2, this.getRemainingTime(deadline));
        if (!frameReady) {
            return false;
        }

        const { activeTheme } = this.themeManager;
        return this.invokeThemeHook(activeTheme, 'whenCriticalReady', this.getRemainingTime(deadline));
    }

    /**
     * Wait until optional non-critical theme polish is fully ready.
     * Odyssey reveal does not block on this path.
     * @param {Object} levelConfig
     * @param {number} timeoutMs
     * @returns {Promise<boolean>}
     */
    async waitForThemeFullReady(levelConfig, timeoutMs = 5000) {
        const themeName = levelConfig?.theme?.primary;
        if (!themeName || !this.themeManager) {
            return false;
        }

        const deadline = Date.now() + Math.max(0, timeoutMs);
        const criticalReady = await this.waitForThemeCriticalReady(levelConfig, this.getRemainingTime(deadline));
        if (!criticalReady) {
            return false;
        }

        const { activeTheme } = this.themeManager;
        if (!activeTheme || this.themeManager.activeThemeName !== themeName) {
            return false;
        }

        return this.invokeThemeHook(activeTheme, 'whenFullReady', this.getRemainingTime(deadline));
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
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    createPrefetchRecord(themeName, priority) {
        const record = {
            themeName,
            priority,
            started: false,
            idleId: null,
            timeoutId: null,
            promise: null,
        };

        record.promise = new Promise((resolve) => {
            record.resolve = resolve;
        });

        return record;
    }

    schedulePrefetchRecord(record) {
        if (!record || record.started) {
            return;
        }

        if (typeof globalThis.requestIdleCallback === 'function') {
            record.idleId = globalThis.requestIdleCallback(() => {
                record.idleId = null;
                this.startPrefetchRecord(record);
            }, { timeout: 450 });
            return;
        }

        record.timeoutId = setTimeout(() => {
            record.timeoutId = null;
            this.startPrefetchRecord(record);
        }, 180);
    }

    cancelPrefetchRecordScheduling(record) {
        if (!record) {
            return;
        }

        if (record.idleId !== null && typeof globalThis.cancelIdleCallback === 'function') {
            globalThis.cancelIdleCallback(record.idleId);
        }
        if (record.timeoutId !== null) {
            clearTimeout(record.timeoutId);
        }
        record.idleId = null;
        record.timeoutId = null;
    }

    startPrefetchRecord(record) {
        if (!record || record.started) {
            return;
        }

        record.started = true;
        this.cancelPrefetchRecordScheduling(record);

        this.themeManager.loadTheme(record.themeName, true)
            .then(() => true)
            .catch((error) => {
                console.warn('[ThemeTransition] Theme prefetch failed:', record.themeName, error);
                return false;
            })
            .finally(() => {
                this.prefetchRecords.delete(record.themeName);
            })
            .then((result) => {
                record.resolve?.(result);
            });
    }

    getRemainingTime(deadlineMs) {
        return Math.max(0, deadlineMs - Date.now());
    }

    async ensureThemeActivated(themeName, timeoutMs) {
        if (this.themeManager.activeThemeName === themeName && this.themeManager.activeTheme?.isActive) {
            return true;
        }

        const remainingMs = Math.max(0, timeoutMs);
        if (remainingMs <= 0) {
            return false;
        }

        const ready = await this.themeManager.waitForThemeReady?.(remainingMs);
        return !!ready
            && this.themeManager.activeThemeName === themeName
            && this.themeManager.activeTheme?.isActive === true;
    }

    async waitForCondition(check, timeoutMs) {
        if (typeof check !== 'function') {
            return false;
        }

        if (check()) {
            return true;
        }

        const deadline = Date.now() + Math.max(0, timeoutMs);
        const poll = async () => {
            if (check()) {
                return true;
            }

            if (Date.now() >= deadline) {
                return check();
            }

            const advanced = await this.waitForAnimationFrames(1, this.getRemainingTime(deadline));
            if (!advanced) {
                return false;
            }

            return poll();
        };

        return poll();
    }

    async waitForAnimationFrames(frameCount = 1, timeoutMs = 200) {
        if (frameCount <= 0) {
            return true;
        }

        const remainingMs = Math.max(0, timeoutMs);
        if (remainingMs <= 0) {
            return false;
        }

        const raf = globalThis.requestAnimationFrame?.bind(globalThis);
        if (typeof raf !== 'function') {
            await this.wait(Math.min(remainingMs, frameCount * 16));
            return true;
        }

        return new Promise((resolve) => {
            let framesLeft = frameCount;
            let settled = false;
            const timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(false);
            }, remainingMs);

            const step = () => {
                if (settled) return;
                framesLeft -= 1;
                if (framesLeft <= 0) {
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(true);
                    return;
                }
                raf(step);
            };

            raf(step);
        });
    }

    async invokeThemeHook(themeInstance, hookName, timeoutMs) {
        if (!themeInstance) {
            return false;
        }

        if (typeof themeInstance[hookName] !== 'function') {
            return true;
        }

        const remainingMs = Math.max(0, timeoutMs);
        if (remainingMs <= 0) {
            return false;
        }

        let timeoutId = null;
        try {
            const result = await Promise.race([
                Promise.resolve(themeInstance[hookName]()),
                new Promise((resolve) => {
                    timeoutId = setTimeout(() => resolve(false), remainingMs);
                }),
            ]);

            return result !== false;
        } catch (error) {
            console.warn(`[ThemeTransition] Theme readiness hook failed: ${hookName}`, error);
            return false;
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        }
    }

    ensureWarpRenderer() {
        if (!this.warpRenderer) {
            this.warpRenderer = new WarpTransitionRenderer();
        }
        return this.warpRenderer;
    }

    /**
     * Dispose and cleanup
     */
    dispose() {
        this.transitionQueue = [];
        this.overlays.forEach((o) => o.dispose?.());
        this.overlays = [];
        this.prefetchRecords.forEach((record) => this.cancelPrefetchRecordScheduling(record));
        this.prefetchRecords.clear();

        if (this.warpRenderer) {
            this.warpRenderer.dispose();
            this.warpRenderer = null;
        }

        console.log('[ThemeTransition] Disposed');
    }
}

export default ThemeTransitionManager;
