/**
 * @fileoverview Crystal Cave Theme - Mystical cave with massive crystals, glowing clusters, and refractions
 */

import { BaseTheme } from '../base-theme.js';
import { crystalCaveCache } from '../../utils/cache.js';

/**
 * Crystal Cave Theme
 * Features:
 * - Massive crystal formations (WebGL) - Various sizes from ceiling and floor
 * - Glowing crystal clusters - Amethyst, Emerald, Sapphire
 * - Floating crystal shards (handled by WebGLRenderer)
 * - Bioluminescent moss - Soft breathing glow
 * - Sparkling mineral dust (handled by WebGLRenderer)
 * - Light refractions - Rainbow patterns through crystals
 */
export default class CrystalCaveTheme extends BaseTheme {
    constructor() {
        super('crystal-cave');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // 1. Massive Crystal Formations (WebGL) - Various sizes from ceiling and floor
        if (this.webglRenderer) {
            const crystalLayers = [
                // Background layer - deep cave colors
                {
                    zIndex: -0.9,
                    count: 12,
                    colors: [
                        'rgba(30, 20, 60, 0.6)',
                        'rgba(20, 30, 70, 0.6)',
                        'rgba(40, 20, 80, 0.6)',
                    ],
                    height: 0.6,
                    seed: 78901,
                },
                // Mid layer - richer colors
                {
                    zIndex: -0.8,
                    count: 10,
                    colors: [
                        'rgba(60, 40, 100, 0.7)',
                        'rgba(30, 60, 90, 0.7)',
                        'rgba(50, 80, 100, 0.7)',
                    ],
                    height: 0.75,
                    seed: 89012,
                },
                // Front layer - prominent crystals
                {
                    zIndex: -0.7,
                    count: 8,
                    colors: [
                        'rgba(80, 60, 130, 0.8)',
                        'rgba(50, 90, 130, 0.8)',
                        'rgba(70, 100, 150, 0.8)',
                    ],
                    height: 0.85,
                    seed: 90123,
                },
            ];

            crystalLayers.forEach((layer) => {
                const C_WIDTH = 2048;
                const C_HEIGHT = window.innerHeight;

                // Create cache key based on layer properties and dimensions
                const cacheKey = `crystal-${layer.zIndex}-${layer.count}-${layer.height}-${layer.colors.join(',')}-${C_WIDTH}x${C_HEIGHT}`;

                // Check if we have this crystal layer cached
                if (crystalCaveCache.has(cacheKey)) {
                    const cachedCanvas = crystalCaveCache.get(cacheKey);
                    this.addWebGLLayer(cachedCanvas, layer.zIndex);
                    return;
                }

                // Generate new crystal layer with seeded random for deterministic output
                const rng = this.seededRandom(layer.seed);
                const canvas = document.createElement('canvas');
                canvas.width = C_WIDTH;
                canvas.height = C_HEIGHT;
                const ctx = canvas.getContext('2d');

                // Draw massive crystals with varied sizes
                for (let i = 0; i < layer.count; i++) {
                    const x = rng() * C_WIDTH;
                    const color = layer.colors[Math.floor(rng() * layer.colors.length)];

                    // Vary crystal sizes dramatically
                    const isMassive = rng() > 0.6;
                    const baseWidth = isMassive ? rng() * 150 + 100 : rng() * 80 + 40;
                    const baseHeight = (rng() * 0.4 + 0.4) * canvas.height * layer.height;

                    ctx.fillStyle = color;
                    ctx.strokeStyle = 'rgba(180, 200, 255, 0.15)';
                    ctx.lineWidth = 2;

                    // Draw from ceiling
                    if (rng() > 0.3) {
                        ctx.beginPath();
                        ctx.moveTo(x - baseWidth / 2, 0);
                        // Add jagged facets
                        ctx.lineTo(x - baseWidth / 4, baseHeight * 0.3);
                        ctx.lineTo(x, baseHeight);
                        ctx.lineTo(x + baseWidth / 4, baseHeight * 0.4);
                        ctx.lineTo(x + baseWidth / 2, 0);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();

                        // Add inner glow highlight
                        const gradient = ctx.createLinearGradient(x, 0, x, baseHeight);
                        gradient.addColorStop(0, 'rgba(200, 220, 255, 0.05)');
                        gradient.addColorStop(0.5, 'rgba(180, 200, 255, 0.1)');
                        gradient.addColorStop(1, 'rgba(150, 180, 255, 0.02)');
                        ctx.fillStyle = gradient;
                        ctx.fill();
                    }

                    // Draw from floor
                    if (rng() > 0.3) {
                        const floorX = rng() * C_WIDTH;
                        const floorWidth = isMassive ? rng() * 140 + 90 : rng() * 70 + 35;
                        const floorHeight = (rng() * 0.4 + 0.35) * canvas.height * layer.height;

                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.moveTo(floorX - floorWidth / 2, canvas.height);
                        ctx.lineTo(floorX - floorWidth / 4, canvas.height - floorHeight * 0.4);
                        ctx.lineTo(floorX, canvas.height - floorHeight);
                        ctx.lineTo(floorX + floorWidth / 4, canvas.height - floorHeight * 0.35);
                        ctx.lineTo(floorX + floorWidth / 2, canvas.height);
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();

                        // Add inner glow
                        const floorGradient = ctx.createLinearGradient(
                            floorX,
                            canvas.height,
                            floorX,
                            canvas.height - floorHeight,
                        );
                        floorGradient.addColorStop(0, 'rgba(200, 220, 255, 0.05)');
                        floorGradient.addColorStop(0.5, 'rgba(180, 200, 255, 0.1)');
                        floorGradient.addColorStop(1, 'rgba(150, 180, 255, 0.02)');
                        ctx.fillStyle = floorGradient;
                        ctx.fill();
                    }
                }

                // Cache the generated canvas
                crystalCaveCache.set(cacheKey, canvas);
                this.addWebGLLayer(canvas, layer.zIndex);
            });
        }

        // 2. Glowing Crystal Clusters - Amethyst, Emerald, Sapphire
        const clusterContainer = this.getContainer('crystal-cave-glow-clusters');
        if (clusterContainer && clusterContainer.children.length === 0) {
            const clusterColors = [
                '#9b59b6', // Amethyst
                '#d896ff', // Light Amethyst
                '#10ac84', // Emerald
                '#1dd1a1', // Light Emerald
                '#3742fa', // Sapphire
                '#5f27cd', // Deep Sapphire
            ];

            for (let i = 0; i < 20; i++) {
                const cluster = document.createElement('div');
                cluster.className = 'crystal-cluster';
                const color = clusterColors[Math.floor(Math.random() * clusterColors.length)];
                cluster.style.setProperty('--glow-color', color);
                cluster.style.left = `${Math.random() * 95 + 2.5}%`;
                cluster.style.top = `${Math.random() * 90 + 5}%`;
                const size = Math.random() * 60 + 35;
                cluster.style.width = `${size}px`;
                cluster.style.height = `${size}px`;
                cluster.style.animationDelay = `-${Math.random() * 8}s`;
                clusterContainer.appendChild(cluster);
            }
        }

        // 3. Floating Crystal Shards are now handled by WebGLRenderer
        // 5. Sparkling Mineral Dust is now handled by WebGLRenderer

        // 4. Bioluminescent Moss - Soft breathing glow
        const mossContainer = this.getContainer('crystal-cave-moss');
        if (mossContainer && mossContainer.children.length === 0) {
            for (let i = 0; i < 15; i++) {
                const patch = document.createElement('div');
                patch.className = 'moss-patch';

                // Position on cave walls (edges and corners)
                const position = Math.random();
                if (position < 0.4) {
                    // Left or right walls
                    patch.style.left = Math.random() > 0.5
                        ? `${Math.random() * 15}%`
                        : `${85 + Math.random() * 15}%`;
                    patch.style.top = `${Math.random() * 100}%`;
                } else {
                    // Top or bottom
                    patch.style.top = Math.random() > 0.5
                        ? `${Math.random() * 20}%`
                        : `${80 + Math.random() * 20}%`;
                    patch.style.left = `${Math.random() * 100}%`;
                }

                const size = Math.random() * 150 + 100;
                patch.style.width = `${size}px`;
                patch.style.height = `${size}px`;
                patch.style.animationDelay = `-${Math.random() * 6}s`;
                mossContainer.appendChild(patch);
            }
        }

        // 6. Light Refractions - Rainbow patterns through crystals
        const refractionContainer = this.getContainer('crystal-cave-refractions');
        if (refractionContainer && refractionContainer.children.length === 0) {
            for (let i = 0; i < 8; i++) {
                const ray = document.createElement('div');
                ray.className = 'refraction-ray';
                ray.style.left = `${Math.random() * 100}%`;
                ray.style.top = `${Math.random() * 100}%`;
                ray.style.transform = `rotate(${Math.random() * 360}deg)`;
                ray.style.animationDelay = `-${Math.random() * 15}s`;

                // Vary the refraction intensity
                const intensity = Math.random() * 0.4 + 0.6;
                ray.style.opacity = intensity;

                refractionContainer.appendChild(ray);
            }
        }
    }
}
