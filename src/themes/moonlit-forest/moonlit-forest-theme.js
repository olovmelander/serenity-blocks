/**
 * @fileoverview Moonlit Forest Theme - Mystical forest with procedural trees, glowing mushrooms, and moonbeams
 */

import { BaseTheme } from '../base-theme.js';
import { moonlitForestTreeCache } from '../../utils/cache.js';

/**
 * Moonlit Forest Theme
 * Features:
 * - Procedurally generated trees with parallax layers
 * - Glowing mushrooms
 * - Moonbeams
 * - Wildlife (glowing eyes, flying owl)
 * - Falling leaves
 */
export default class MoonlitForestTheme extends BaseTheme {
    constructor() {
        super('moonlit-forest');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // Define tree colors for different layers
        const treeLayers = [
            { el: document.getElementById('moonlit-forest-back'),  color: '#7A9B7E', foliageColor: '#5A8067', count: 40, height: window.innerHeight * 0.7 },
            { el: document.getElementById('moonlit-forest-mid'),   color: '#3D5F4A', foliageColor: '#4A6B56', count: 30, height: window.innerHeight * 0.85 },
            { el: document.getElementById('moonlit-forest-front'), color: '#1A2820', foliageColor: '#2F4A3A', count: 20, height: window.innerHeight }
        ];

        // Helper function to draw a more realistic tree
        const drawTree = (ctx, x, y, len, angle, width, foliageColor) => {
            if (width < 1 && len < 20) { // Stop recursion for tiny branches
                // Draw a leaf cluster at the end of small branches
                ctx.beginPath();
                ctx.arc(x, y, this.random(5, 15), 0, Math.PI * 2);
                ctx.fillStyle = foliageColor;
                ctx.globalAlpha = this.random(0.3, 0.6);
                ctx.fill();
                ctx.globalAlpha = 1;
                return;
            }
            if (len < 10) return;

            ctx.beginPath();
            ctx.lineWidth = width;
            ctx.moveTo(x, y);
            const x2 = x + len * Math.cos(angle * Math.PI / 180);
            const y2 = y + len * Math.sin(angle * Math.PI / 180);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            const newLen = len * (0.7 + Math.random() * 0.15);
            const newWidth = width * 0.75;
            // Main branch continues somewhat straight
            drawTree(ctx, x2, y2, newLen, angle + this.random(-15, 15), newWidth, foliageColor);
            // Side branch forks off
            if (width > 1) {
                drawTree(ctx, x2, y2, newLen * 0.8, angle + this.random(20, 50), newWidth * 0.8, foliageColor);
                drawTree(ctx, x2, y2, newLen * 0.8, angle - this.random(20, 50), newWidth * 0.8, foliageColor);
            }
        };

        // 1. Procedurally generate trees for parallax layers (with caching)
        treeLayers.forEach((layer, layerIndex) => {
            if(layer.el) {
                this.registerContainer(layer.el);
                // Create a cache key based on layer properties and window dimensions
                // v2: Added gradient fade at top for smooth sky blending
                const cacheKey = `v2-${layerIndex}-${layer.color}-${layer.foliageColor}-${layer.count}-${layer.height}`;

                // Check if we have a cached version
                if (moonlitForestTreeCache.has(cacheKey)) {
                    const cachedData = moonlitForestTreeCache.get(cacheKey);
                    layer.el.style.backgroundImage = cachedData.backgroundImage;
                    layer.el.style.backgroundSize = cachedData.backgroundSize;
                } else {
                    // Generate the tree background
                    const C_WIDTH = 4096; // Wider canvas for more variety in parallax
                    const C_HEIGHT = layer.height;
                    let canvas = document.createElement('canvas');
                    canvas.width = C_WIDTH;
                    canvas.height = C_HEIGHT;
                    let ctx = canvas.getContext('2d');
                    ctx.strokeStyle = layer.color;

                    // Draw ground/undergrowth silhouette
                    ctx.fillStyle = layer.foliageColor;
                    ctx.beginPath();
                    ctx.moveTo(0, C_HEIGHT);
                    let groundY = C_HEIGHT * 0.95;
                    for (let x = 0; x < C_WIDTH; x++) {
                        groundY += (Math.random() - 0.5) * 2;
                        ctx.lineTo(x, groundY);
                    }
                    ctx.lineTo(C_WIDTH, C_HEIGHT);
                    ctx.closePath();
                    ctx.fill();

                    // Draw trees
                    for(let i = 0; i < layer.count; i++) {
                        const x = Math.random() * C_WIDTH;
                        const y = C_HEIGHT * (0.95 + Math.random() * 0.05);
                        const len = C_HEIGHT * (0.2 + Math.random() * 0.3);
                        const angle = -90 + this.random(-10, 10);
                        const width = 10 + Math.random() * (layer.height / 30);
                        drawTree(ctx, x, y, len, angle, width, layer.foliageColor);
                    }

                    // Add gradient fade at the top to blend smoothly with sky
                    const fadeHeight = C_HEIGHT * 0.35; // Fade the top 35% of the canvas
                    const gradient = ctx.createLinearGradient(0, 0, 0, fadeHeight);
                    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)'); // Fully transparent at top
                    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)'); // Gradual fade
                    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Fully visible at bottom

                    ctx.globalCompositeOperation = 'destination-out'; // Use gradient as alpha mask
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, C_WIDTH, fadeHeight);
                    ctx.globalCompositeOperation = 'source-over'; // Reset to normal

                    const backgroundImage = `url(${canvas.toDataURL()})`;
                    const backgroundSize = `${C_WIDTH}px ${C_HEIGHT}px`;

                    // Cache the generated background
                    moonlitForestTreeCache.set(cacheKey, { backgroundImage, backgroundSize });

                    // Apply to the layer
                    layer.el.style.backgroundImage = backgroundImage;
                    layer.el.style.backgroundSize = backgroundSize;
                }
            }
        });

        // 2. Glowing Mushrooms
        const mushroomContainer = this.getContainer('glowing-mushrooms');
        if (mushroomContainer && mushroomContainer.children.length === 0) {
            for (let i = 0; i < 30; i++) {
                let mushroom = document.createElement('div');
                mushroom.className = 'glowing-mushroom';
                mushroom.style.left = `${Math.random() * 98}%`;
                mushroom.style.bottom = `${Math.random() * 90}%`; // Spread them out more vertically
                mushroom.style.transform = `scale(${Math.random() * 0.4 + 0.6})`;
                mushroom.style.setProperty('--delay', `-${Math.random() * 12}s`);
                mushroomContainer.appendChild(mushroom);
            }
        }

        // 3. Moonbeams
        const moonbeamContainer = document.querySelector('.moonbeam-container');
        if (moonbeamContainer) {
            this.registerContainer(moonbeamContainer);
            if (moonbeamContainer.children.length === 0) {
                for (let i = 0; i < 10; i++) {
                    let beam = document.createElement('div');
                    beam.className = 'moonbeam';
                    const angle = Math.random() * 20 - 10;
                    beam.style.left = `${Math.random() * 100}%`;
                    beam.style.setProperty('--r-start', `${angle - 8}deg`);
                    beam.style.setProperty('--r-end', `${angle + 8}deg`);
                    beam.style.setProperty('--opacity', `${Math.random() * 0.3 + 0.1}`);
                    beam.style.animationDelay = `-${Math.random() * 45}s`;
                    moonbeamContainer.appendChild(beam);
                }
            }
        }

        // 4. Wildlife and Leaves
        const wildlifeContainer = this.getContainer('moonlit-wildlife');
        if (wildlifeContainer && wildlifeContainer.children.length === 0) {
            // Glowing Eyes
            for (let i = 0; i < 7; i++) {
                let eyes = document.createElement('div');
                eyes.className = 'glowing-eyes';
                eyes.style.left = `${Math.random() * 95}%`;
                eyes.style.bottom = `${Math.random() * 40}%`; // Keep them in the undergrowth
                eyes.style.animationDelay = `-${Math.random() * 12}s`;
                wildlifeContainer.appendChild(eyes);
            }
            // Flying Owl
            let owl = document.createElement('div');
            owl.className = 'flying-owl';
            owl.style.animationDelay = `-${Math.random() * 45}s`;
            wildlifeContainer.appendChild(owl);
        }

        const themeContainer = this.getContainer('moonlit-forest-theme');
        if (themeContainer) {
            // Clear old leaves before adding new ones
            themeContainer.querySelectorAll('.moonlit-leaf').forEach(e => e.remove());
            // Falling Leaves
            for (let i = 0; i < 10; i++) { // Fewer, more subtle leaves
                let leaf = document.createElement('div');
                leaf.className = 'moonlit-leaf';
                const xStart = Math.random() * 100;
                leaf.style.setProperty('--x-start', `${xStart}vw`);
                leaf.style.setProperty('--x-end', `${xStart + (Math.random() * 15 - 7.5)}vw`);
                leaf.style.setProperty('--r-start', `${Math.random() * 360}deg`);
                leaf.style.setProperty('--r-end', `${Math.random() * 540 - 270}deg`);
                const duration = Math.random() * 12 + 12;
                leaf.style.animationDuration = `${duration}s`;
                leaf.style.animationDelay = `-${Math.random() * duration}s`;
                themeContainer.appendChild(leaf);
            }
        }
    }
}
