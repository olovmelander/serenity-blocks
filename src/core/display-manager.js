/**
 * @fileoverview DisplayManager - Handles resolution, display modes, and window management
 * Works with Electron's screen and BrowserWindow APIs for desktop,
 * falls back to browser Fullscreen API for web
 */

export class DisplayManager {
    constructor() {
        this.currentDisplay = null;
        this.availableResolutions = [];
        this.isElectron = this.detectElectron();
        this.fullscreenChangeCallbacks = [];
    }

    /**
     * Detect if running in Electron environment
     * @returns {boolean}
     */
    detectElectron() {
        return typeof window !== 'undefined'
            && !!window.electronDisplay;
    }

    /**
     * Get available displays and their properties
     * Uses Electron's screen API if available, otherwise web screen API
     * @returns {Promise<Array>}
     */
    async getAvailableDisplays() {
        if (!this.isElectron) {
            // Web fallback - use standard screen API
            return [{
                id: 'primary',
                bounds: {
                    x: 0,
                    y: 0,
                    width: window.screen.width,
                    height: window.screen.height,
                },
                workArea: {
                    x: 0,
                    y: 0,
                    width: window.screen.availWidth,
                    height: window.screen.availHeight,
                },
                scaleFactor: window.devicePixelRatio || 1,
                internal: true,
            }];
        }

        try {
            const displays = await window.electronDisplay?.getDisplays?.();
            return displays;
        } catch (error) {
            console.error('[DisplayManager] Failed to get displays:', error);
            return [];
        }
    }

    /**
     * Get common resolutions that fit within the current display
     * @param {number} maxWidth - Maximum width
     * @param {number} maxHeight - Maximum height
     * @returns {Array}
     */
    getCommonResolutions(maxWidth, maxHeight) {
        const commonResolutions = [
            { width: 1024, height: 768, label: '1024×768 (XGA)' },
            { width: 1280, height: 720, label: '1280×720 (HD)' },
            { width: 1280, height: 800, label: '1280×800 (WXGA)' },
            { width: 1366, height: 768, label: '1366×768 (HD)' },
            { width: 1440, height: 900, label: '1440×900 (WXGA+)' },
            { width: 1600, height: 900, label: '1600×900 (HD+)' },
            { width: 1680, height: 1050, label: '1680×1050 (WSXGA+)' },
            { width: 1920, height: 1080, label: '1920×1080 (FHD)' },
            { width: 1920, height: 1200, label: '1920×1200 (WUXGA)' },
            { width: 2560, height: 1080, label: '2560×1080 (UW-FHD)' },
            { width: 2560, height: 1440, label: '2560×1440 (QHD)' },
            { width: 3440, height: 1440, label: '3440×1440 (UW-QHD)' },
            { width: 3840, height: 2160, label: '3840×2160 (4K UHD)' },
        ];

        return commonResolutions.filter(
            (res) => res.width <= maxWidth && res.height <= maxHeight,
        );
    }

    /**
     * Set display mode (windowed, fullscreen, borderless)
     * @param {string} mode - 'windowed' | 'fullscreen' | 'borderless'
     * @param {Object} resolution - { width: number, height: number }
     * @returns {Promise<boolean>}
     */
    async setDisplayMode(mode, resolution = null) {
        console.log(`[DisplayManager] Setting display mode: ${mode}`, resolution);

        if (!this.isElectron) {
            // Web fallback - only fullscreen API available
            if (mode === 'fullscreen') {
                return this.requestFullscreen();
            }
            return this.exitFullscreen();
        }

        try {
            switch (mode) {
            case 'fullscreen':
                await window.electronDisplay?.setFullscreen?.(true);
                break;

            case 'borderless':
                await window.electronDisplay?.setBorderless?.(resolution);
                break;

            case 'windowed':
            default:
                await window.electronDisplay?.setWindowed?.(resolution);
                break;
            }

            console.log(`[DisplayManager] Display mode set to: ${mode}`);
            return true;
        } catch (error) {
            console.error('[DisplayManager] Failed to set display mode:', error);
            return false;
        }
    }

    /**
     * Change window resolution (windowed mode only)
     * @param {number} width
     * @param {number} height
     * @returns {Promise<boolean>}
     */
    async setResolution(width, height) {
        if (!this.isElectron) {
            console.warn('[DisplayManager] Resolution change only available in Electron');
            return false;
        }

        try {
            await window.electronDisplay?.setResolution?.(width, height);
            console.log(`[DisplayManager] Resolution set to: ${width}×${height}`);
            return true;
        } catch (error) {
            console.error('[DisplayManager] Failed to set resolution:', error);
            return false;
        }
    }

    /**
     * Request fullscreen using browser Fullscreen API
     * @returns {Promise<boolean>}
     */
    async requestFullscreen() {
        try {
            const elem = document.documentElement;

            if (elem.requestFullscreen) {
                await elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                await elem.webkitRequestFullscreen();
            } else if (elem.msRequestFullscreen) {
                await elem.msRequestFullscreen();
            } else {
                console.warn('[DisplayManager] Fullscreen API not supported');
                return false;
            }

            console.log('[DisplayManager] Entered fullscreen mode');
            return true;
        } catch (error) {
            console.error('[DisplayManager] Failed to enter fullscreen:', error);
            return false;
        }
    }

    /**
     * Exit fullscreen using browser Fullscreen API
     * @returns {Promise<boolean>}
     */
    async exitFullscreen() {
        try {
            if (!this.isFullscreen()) {
                return true;
            }

            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                await document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                await document.msExitFullscreen();
            } else {
                console.warn('[DisplayManager] Exit fullscreen not supported');
                return false;
            }

            console.log('[DisplayManager] Exited fullscreen mode');
            return true;
        } catch (error) {
            console.error('[DisplayManager] Failed to exit fullscreen:', error);
            return false;
        }
    }

    /**
     * Check if currently in fullscreen
     * @returns {boolean}
     */
    isFullscreen() {
        return !!(
            document.fullscreenElement
            || document.webkitFullscreenElement
            || document.msFullscreenElement
        );
    }

    /**
     * Listen for fullscreen changes
     * @param {Function} callback - Called when fullscreen state changes
     */
    onFullscreenChange(callback) {
        if (typeof callback !== 'function') {
            console.warn('[DisplayManager] onFullscreenChange requires a callback function');
            return;
        }

        this.fullscreenChangeCallbacks.push(callback);

        // Only set up event listeners once
        if (this.fullscreenChangeCallbacks.length === 1) {
            const events = [
                'fullscreenchange',
                'webkitfullscreenchange',
                'msfullscreenchange',
            ];

            const handler = () => {
                const isFs = this.isFullscreen();
                this.fullscreenChangeCallbacks.forEach((cb) => {
                    try {
                        cb(isFs);
                    } catch (error) {
                        console.error('[DisplayManager] Fullscreen callback error:', error);
                    }
                });
            };

            events.forEach((event) => {
                document.addEventListener(event, handler);
            });
        }
    }

    /**
     * Get current window bounds (Electron only)
     * @returns {Promise<Object|null>}
     */
    async getWindowBounds() {
        if (!this.isElectron) {
            return {
                x: 0,
                y: 0,
                width: window.innerWidth,
                height: window.innerHeight,
            };
        }

        try {
            return await window.electronDisplay?.getWindowBounds?.();
        } catch (error) {
            console.error('[DisplayManager] Failed to get window bounds:', error);
            return null;
        }
    }

    /**
     * Check if window is fullscreen (Electron only)
     * @returns {Promise<boolean>}
     */
    async isWindowFullscreen() {
        if (!this.isElectron) {
            return this.isFullscreen();
        }

        try {
            return await window.electronDisplay?.isFullscreen?.();
        } catch (error) {
            console.error('[DisplayManager] Failed to check fullscreen state:', error);
            return false;
        }
    }

    /**
     * Parse resolution string to width/height object
     * @param {string} resolutionString - e.g., "1920x1080"
     * @returns {Object|null} - { width: number, height: number }
     */
    parseResolution(resolutionString) {
        if (!resolutionString || resolutionString === 'auto') {
            return null;
        }

        const match = resolutionString.match(/^(\d+)x(\d+)$/i);
        if (!match) {
            console.warn('[DisplayManager] Invalid resolution string:', resolutionString);
            return null;
        }

        return {
            width: parseInt(match[1], 10),
            height: parseInt(match[2], 10),
        };
    }

    /**
     * Get the primary display
     * @returns {Promise<Object|null>}
     */
    async getPrimaryDisplay() {
        const displays = await this.getAvailableDisplays();
        return displays.length > 0 ? displays[0] : null;
    }

    /**
     * Validate if a resolution fits within the display
     * @param {number} width
     * @param {number} height
     * @param {Object} display - Optional, uses primary if not provided
     * @returns {Promise<boolean>}
     */
    async validateResolution(width, height, display = null) {
        if (!display) {
            display = await this.getPrimaryDisplay();
        }

        if (!display) {
            console.warn('[DisplayManager] No display available for validation');
            return false;
        }

        const maxWidth = display.workArea.width;
        const maxHeight = display.workArea.height;

        const isValid = width <= maxWidth && height <= maxHeight && width > 0 && height > 0;

        if (!isValid) {
            console.warn(
                `[DisplayManager] Resolution ${width}×${height} exceeds display bounds ${maxWidth}×${maxHeight}`,
            );
        }

        return isValid;
    }

    /**
     * Get the effective pixel ratio for rendering, applying render scale
     * @param {number} renderScale - Scale factor (0.25 to 2.0, where > 1.0 is supersampling)
     * @returns {number} Effective pixel ratio
     */
    getEffectivePixelRatio(renderScale = 1.0) {
        const baseRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const clampedScale = Math.max(0.25, Math.min(2.0, renderScale));
        const effectiveRatio = baseRatio * clampedScale;
        return Math.round(effectiveRatio * 100) / 100; // Round to 2 decimal places
    }

    /**
     * Get recommended render scale based on screen resolution
     * @returns {number} Recommended render scale (0.5, 0.75, or 1.0)
     */
    getRecommendedRenderScale() {
        if (typeof window === 'undefined') return 1.0;

        const width = window.screen.width * (window.devicePixelRatio || 1);
        const height = window.screen.height * (window.devicePixelRatio || 1);
        const totalPixels = width * height;

        // Thresholds for different render scales
        // > 8M pixels (4K+): recommend 0.5
        // > 4M pixels (2K+): recommend 0.75
        // Otherwise: recommend 1.0
        if (totalPixels > 8_000_000) {
            return 0.5;
        } if (totalPixels > 4_000_000) {
            return 0.75;
        }
        return 1.0;
    }
}
