/**
 * @fileoverview Forest Theme - Serene forest with firefly particles (WebGL)
 */

import { BaseTheme } from '../base-theme.js';

/**
 * Forest Theme
 * Features:
 * - Firefly particles animated by WebGL renderer
 * - Green forest ambiance
 */
export default class ForestTheme extends BaseTheme {
    constructor() {
        super('forest', {
            particleConfig: {
                type: 'fireflies',
                count: 80,
                color: [1.0, 1.0, 0.6],
                speed: 0.3
            }
        });
    }

    async init() {
        // No additional initialization needed
        // Theme is simple and uses WebGL particles only
    }

    async createScene() {
        // Forest theme particle animations are handled entirely by WebGLRenderer
        // The renderer automatically creates firefly particles based on the theme

        // The old startForestAnimations, stopForestAnimations, and Firefly class
        // have been removed in favor of the WebGL particle system

        // No additional scene elements needed for this theme
        // Body class 'theme-forest' will apply CSS styling
    }

    stop() {
        super.stop();
        // WebGL particles are automatically cleaned up by base class
    }
}
