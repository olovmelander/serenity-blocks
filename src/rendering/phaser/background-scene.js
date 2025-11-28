import { ThemeManager } from '../../themes/theme-manager.js';

let cachedBackgroundScene = null;
let cachedPhaserRef = null;

/**
 * Create the background scene for Phaser 4.
 * Coordinates WebGL theme renderer with Phaser update loop.
 *
 * @param {typeof Phaser} phaserLib - Phaser 4 library reference
 * @returns {typeof Phaser.Scene} - BackgroundScene class
 */
export function createBackgroundScene(
    phaserLib = typeof window !== 'undefined' ? window.Phaser : null,
) {
    const PhaserRef = phaserLib;

    // Validate Phaser 4 availability
    if (!PhaserRef?.Scene) {
        throw new Error(
            '[BackgroundScene] Phaser 4 is not available. Ensure Phaser is imported before creating scenes.',
        );
    }

    // Return cached class if already created (performance optimization)
    if (cachedBackgroundScene && cachedPhaserRef === PhaserRef) {
        console.log('[BackgroundScene] Returning cached class');
        return cachedBackgroundScene;
    }

    console.log('[BackgroundScene] Creating new Phaser 4 scene class');

    class BackgroundScene extends PhaserRef.Scene {
        constructor() {
            super({ key: 'BackgroundScene' });

            this.webglRenderer = null;
            this.themeManager = null;
            this.effectQuality = 'High';

            // Frame rate throttling for performance (30fps instead of 60fps)
            this.targetFrameTime = 1000 / 30; // 33.33ms per frame
            this.lastUpdateTime = 0;
            this.accumulatedTime = 0;
        }

        /**
         * Phaser 4 lifecycle: initialize scene data
         * Called when scene starts, receives data from scene.start()
         * @param {Object} data - Initialization data
         */
        init(data) {
            this.webglRenderer = data?.webglRenderer || null;
            this.themeManager = data?.themeManager || null;
            this.effectQuality = data?.effectQuality || 'High';

            console.log('[BackgroundScene] Initialized', {
                hasRenderer: !!this.webglRenderer,
                hasThemeManager: !!this.themeManager,
                quality: this.effectQuality,
            });
        }

        /**
         * Phaser 4 lifecycle: create scene objects
         * Sets up WebGL renderer integration with Phaser update loop
         */
        create() {
            if (!this.webglRenderer) {
                console.warn(
                    '[BackgroundScene] No WebGL renderer provided. Scene will remain idle.',
                );
                return;
            }

            try {
                // Enable external render loop (Phaser drives the WebGL renderer)
                this.webglRenderer.enableExternalRenderLoop(true);

                // Apply quality settings to renderer
                if (typeof this.webglRenderer.setEffectQuality === 'function') {
                    this.webglRenderer.setEffectQuality(this.effectQuality);
                }

                // Start WebGL renderer
                this.webglRenderer.start();

                // Connect theme manager to renderer
                if (this.themeManager instanceof ThemeManager) {
                    this.themeManager.webglRenderer = this.webglRenderer;
                }

                // Register cleanup on scene destruction
                this.events.on('destroy', () => {
                    console.log('[BackgroundScene] Cleaning up WebGL renderer');
                    if (this.webglRenderer) {
                        this.webglRenderer.enableExternalRenderLoop(false);
                        this.webglRenderer.stop();
                    }
                });

                console.log('[BackgroundScene] Created successfully, WebGL renderer active');
            } catch (error) {
                console.error('[BackgroundScene] Failed to create scene:', error);
            }
        }

        /**
         * Phaser 4 lifecycle: update loop
         * Called every frame, drives WebGL renderer
         * Throttled to 30fps for performance (backgrounds don't need 60fps)
         */
        update(time, delta) {
            if (!this.webglRenderer) return;

            // Throttle to 30fps - users won't notice background at half rate
            const currentTime = performance.now();
            this.accumulatedTime += delta;

            // Only update if enough time has passed (33.33ms for 30fps)
            if (this.accumulatedTime >= this.targetFrameTime) {
                try {
                    this.webglRenderer.renderFrame();
                    this.lastUpdateTime = currentTime;
                    this.accumulatedTime %= this.targetFrameTime; // Keep remainder
                } catch (error) {
                    console.error('[BackgroundScene] Error in update loop:', error);
                }
            }
        }
    }

    cachedBackgroundScene = BackgroundScene;
    cachedPhaserRef = PhaserRef;
    return BackgroundScene;
}
