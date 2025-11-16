/**
 * @fileoverview Himalayan Peak Theme - Majestic mountain peaks with prayer flags and clouds
 */

import { BaseTheme } from '../base-theme.js';
import { himalayanPeakCache } from '../../utils/cache.js';
import { HIMALAYAN_PEAK_TETROMINOS } from './himalayan-peak-tetrominos.js';

/**
 * Himalayan Peak Theme
 * Features:
 * - Procedurally generated mountain peaks with snow caps (WebGL layers)
 * - High-altitude clouds
 * - Traditional prayer flags
 * - Sun rays
 * - Thin air particles (WebGL)
 */
export default class HimalayanPeakTheme extends BaseTheme {
    constructor() {
        super('himalayan-peak');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // 1. Procedural Peaks for WebGL - with canvas caching optimization
        if (this.webglRenderer) {
            const peakLayers = [
                // z-index values are for WebGL depth, not CSS z-index. Closer to -1 is further away.
                {
                    zIndex: -0.9,
                    color: 'rgba(60, 70, 90, 0.7)',
                    jaggedness: 0.3,
                    snowLine: 0.4,
                    seed: 12345,
                },
                {
                    zIndex: -0.8,
                    color: 'rgba(80, 90, 110, 0.8)',
                    jaggedness: 0.5,
                    snowLine: 0.3,
                    seed: 23456,
                },
                {
                    zIndex: -0.7,
                    color: 'rgba(100, 110, 130, 0.9)',
                    jaggedness: 0.7,
                    snowLine: 0.2,
                    seed: 34567,
                },
            ];

            peakLayers.forEach((layer) => {
                const C_WIDTH = 2048;
                const C_HEIGHT = window.innerHeight > 1080 ? 1080 : window.innerHeight; // Cap height for performance

                // Create cache key based on layer properties and dimensions
                const cacheKey = `peak-${layer.zIndex}-${layer.color}-${layer.jaggedness}-${layer.snowLine}-${C_WIDTH}x${C_HEIGHT}`;

                // Check if we have this peak cached
                if (himalayanPeakCache.has(cacheKey)) {
                    const cachedCanvas = himalayanPeakCache.get(cacheKey);
                    this.addWebGLLayer(cachedCanvas, layer.zIndex);
                    return;
                }

                // Generate new peak with seeded random for deterministic output
                const rng = this.seededRandom(layer.seed);
                const canvas = document.createElement('canvas');
                canvas.width = C_WIDTH;
                canvas.height = C_HEIGHT;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = layer.color;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);
                let y = canvas.height * 0.8;
                for (let x = 0; x < C_WIDTH; x++) {
                    const angle = (x / C_WIDTH) * Math.PI * 4;
                    y = canvas.height * 0.7 - Math.sin(angle) * 100 - Math.cos(angle * 0.5) * 50;
                    y += (rng() - 0.5) * layer.jaggedness * 20;
                    ctx.lineTo(x, y);

                    // Draw snow caps
                    if (y < canvas.height * layer.snowLine) {
                        ctx.fillStyle = 'rgba(240, 245, 255, 0.9)';
                        ctx.fillRect(x, y - 5, 1, 10);
                        ctx.fillStyle = layer.color;
                    }
                }
                ctx.lineTo(C_WIDTH, canvas.height);
                ctx.closePath();
                ctx.fill();

                // Cache the generated canvas
                himalayanPeakCache.set(cacheKey, canvas);

                // Add the generated canvas as a layer to the WebGL renderer
                this.addWebGLLayer(canvas, layer.zIndex);
            });
        }

        // 2. High-altitude clouds
        const cloudContainer = this.getContainer('himalayan-clouds');
        if (cloudContainer && cloudContainer.children.length === 0) {
            for (let i = 0; i < 10; i++) {
                const cloud = document.createElement('div');
                cloud.className = 'himalayan-cloud';
                cloud.style.top = `${60 + Math.random() * 30}%`;
                const duration = Math.random() * 100 + 120;
                cloud.style.animationDuration = `${duration}s`;
                cloud.style.animationDelay = `-${Math.random() * duration}s`;
                cloudContainer.appendChild(cloud);
            }
        }

        // 3. Prayer Flags
        const flagContainer = this.getContainer('himalayan-flags');
        if (flagContainer && flagContainer.children.length === 0) {
            const strand = document.createElement('div');
            strand.className = 'himalayan-prayer-strand';
            const flagColors = ['#00a8ff', '#9c88ff', '#fbc531', '#4cd137', '#e84118'];
            for (let i = 0; i < 15; i++) {
                const flag = document.createElement('div');
                flag.className = 'himalayan-prayer-flag';
                flag.style.backgroundColor = flagColors[i % flagColors.length];
                flag.style.left = `${5 + i * 6}%`;
                flag.style.animationDelay = `-${i * 0.1}s`;
                strand.appendChild(flag);
            }
            flagContainer.appendChild(strand);
        }

        // 4. Thin Air Particles are now handled by WebGLRenderer

        // 5. Sun Rays
        const sunRayContainer = this.getContainer('himalayan-sun-rays');
        if (sunRayContainer && sunRayContainer.children.length === 0) {
            for (let i = 0; i < 25; i++) {
                const ray = document.createElement('div');
                ray.className = 'himalayan-sun-ray';
                ray.style.transform = `rotate(${Math.random() * 360}deg)`;
                ray.style.animationDelay = `-${Math.random() * 12}s`;
                sunRayContainer.appendChild(ray);
            }
        }
    }

    /**
     * Provide Himalayan Peak themed tetromino styling (prayer flag colors & high-altitude atmosphere)
     * @returns {Object} Himalayan Peak tetromino configuration
     */
    getTetrominoConfig() {
        return HIMALAYAN_PEAK_TETROMINOS;
    }
}
