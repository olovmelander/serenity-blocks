import { ThemeManager } from '../../themes/theme-manager.js';

let cachedBackgroundScene = null;
let cachedPhaserRef = null;

/**
 * Create the background scene once Phaser is available.
 * @param {typeof Phaser} phaserLib
 */
export function createBackgroundScene(
    phaserLib = typeof window !== 'undefined' ? window.Phaser : null
) {
    const PhaserRef = phaserLib;

    if (!PhaserRef?.Scene) {
        throw new Error(
            '[BackgroundScene] Phaser is not available. Load Phaser before creating scenes.'
        );
    }

    if (cachedBackgroundScene && cachedPhaserRef === PhaserRef) {
        return cachedBackgroundScene;
    }

    class BackgroundScene extends PhaserRef.Scene {
        constructor() {
            super({ key: 'BackgroundScene' });

            this.webglRenderer = null;
            this.themeManager = null;
        }

        init(data) {
            this.webglRenderer = data.webglRenderer;
            this.themeManager = data.themeManager;
            this.effectQuality = data.effectQuality || 'High';
        }

        create() {
            if (!this.webglRenderer) {
                console.warn(
                    '[BackgroundScene] No WebGL renderer provided. Scene will remain idle.'
                );
                return;
            }

            this.webglRenderer.enableExternalRenderLoop(true);
            if (this.webglRenderer.setEffectQuality) {
                this.webglRenderer.setEffectQuality(this.effectQuality);
            }
            this.webglRenderer.start();

            if (this.themeManager instanceof ThemeManager) {
                this.themeManager.webglRenderer = this.webglRenderer;
            }

            this.events.on('destroy', () => {
                this.webglRenderer.enableExternalRenderLoop(false);
                this.webglRenderer.stop();
            });
        }

        update() {
            if (!this.webglRenderer) return;
            this.webglRenderer.renderFrame();
        }
    }

    cachedBackgroundScene = BackgroundScene;
    cachedPhaserRef = PhaserRef;
    return BackgroundScene;
}
