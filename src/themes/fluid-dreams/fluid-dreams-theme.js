/**
 * @fileoverview Fluid Dreams Theme - Dreamy flowing scene with morphing blobs, iridescent bubbles, and flowing ribbons
 */

import { BaseTheme } from '../base-theme.js';

/**
 * Fluid Dreams Theme
 * Features:
 * - Morphing blobs with gooey effects
 * - Iridescent bubbles floating upward
 * - Flowing ribbon streams
 */
export default class FluidDreamsTheme extends BaseTheme {
    constructor() {
        super('fluid-dreams');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // 1. Morphing Blobs for Gooey Effect
        const blobContainer = this.getContainer('morphing-blobs');
        if (blobContainer && blobContainer.children.length === 0) {
            const numBlobs = 8;
            for (let i = 0; i < numBlobs; i++) {
                let blob = document.createElement('div');
                blob.className = 'morph-blob';
                const size = Math.random() * 150 + 100; // 100px to 250px
                blob.style.width = `${size}px`;
                blob.style.height = `${size}px`;

                // Set random animation properties using CSS variables
                blob.style.setProperty('--x-start', `${Math.random() * 80 + 10}vw`);
                blob.style.setProperty('--y-start', `${Math.random() * 80 + 10}vh`);
                blob.style.setProperty('--x-end', `${Math.random() * 80 + 10}vw`);
                blob.style.setProperty('--y-end', `${Math.random() * 80 + 10}vh`);
                blob.style.setProperty('--scale-start', `${Math.random() * 0.5 + 0.8}`);
                blob.style.setProperty('--scale-end', `${Math.random() * 0.5 + 0.8}`);

                blob.style.animationDelay = `-${Math.random() * 10}s, -${Math.random() * 15}s, -${Math.random() * 20}s`;
                blobContainer.appendChild(blob);
            }
        }

        // 2. Iridescent Bubbles
        const bubbleContainer = this.getContainer('iridescent-bubbles');
        if (bubbleContainer && bubbleContainer.children.length === 0) {
            const numBubbles = 20;
            for (let i = 0; i < numBubbles; i++) {
                let bubble = document.createElement('div');
                bubble.className = 'iridescent-bubble';
                const size = Math.random() * 80 + 20; // 20px to 100px
                bubble.style.width = `${size}px`;
                bubble.style.height = `${size}px`;

                bubble.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                bubble.style.setProperty('--y-start', `${110}vh`); // Start from bottom
                bubble.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                bubble.style.setProperty('--y-end', `${-10}vh`); // Float to top
                bubble.style.setProperty('--scale', `${Math.random() * 0.4 + 0.8}`);

                const duration = Math.random() * 15 + 20; // 20s to 35s
                bubble.style.animationDuration = `${duration}s`;
                bubble.style.animationDelay = `-${Math.random() * duration}s`;
                bubbleContainer.appendChild(bubble);
            }
        }

        // 3. Flowing Ribbons
        const ribbonContainer = this.getContainer('ribbon-streams');
        if (ribbonContainer && ribbonContainer.children.length === 0) {
            const numRibbons = 5;
            for (let i = 0; i < numRibbons; i++) {
                let ribbon = document.createElement('div');
                ribbon.className = 'ribbon-stream';

                ribbon.style.setProperty('--x-start', `${Math.random() * 120 - 10}vw`);
                ribbon.style.setProperty('--y-start', `${Math.random() * 120 - 10}vh`);
                ribbon.style.setProperty('--x-end', `${Math.random() * 120 - 10}vw`);
                ribbon.style.setProperty('--y-end', `${Math.random() * 120 - 10}vh`);
                ribbon.style.setProperty('--r-start', `${Math.random() * 720 - 360}deg`);
                ribbon.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);

                const duration = Math.random() * 20 + 30; // 30s to 50s
                ribbon.style.animationDelay = `-${Math.random() * duration}s, -${Math.random() * 10}s`;
                ribbonContainer.appendChild(ribbon);
            }
        }
    }
}
