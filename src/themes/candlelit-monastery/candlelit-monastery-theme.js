/**
 * @fileoverview Candlelit Monastery Theme - Sacred monastery with candles, incense, and artifacts
 */

import { BaseTheme } from '../base-theme.js';

/**
 * Candlelit Monastery Theme
 * Features:
 * - Stone archways and columns (WebGL)
 * - Pillar candles with flickering flames
 * - Incense smoke (WebGL)
 * - Stained glass light beams
 * - Dancing shadows from candlelight
 * - Prayer beads
 * - Religious artifacts
 */
export default class CandlelitMonasteryTheme extends BaseTheme {
    constructor() {
        super('candlelit-monastery');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // 1. Stone Archways and Columns (WebGL) - Ancient weathered textures
        if (this.webglRenderer) {
            const archwayLayers = [
                { zIndex: -0.9, brightness: 0.4, detail: 'low' },
                { zIndex: -0.8, brightness: 0.6, detail: 'mid' },
                { zIndex: -0.7, brightness: 0.8, detail: 'high' }
            ];

            archwayLayers.forEach(layer => {
                const canvas = document.createElement('canvas');
                const C_WIDTH = window.innerWidth * 2;
                const C_HEIGHT = window.innerHeight;
                canvas.width = C_WIDTH;
                canvas.height = C_HEIGHT;
                const ctx = canvas.getContext('2d');

                // Stone texture with age marks
                const baseColor = `rgba(${45 + layer.brightness * 30}, ${35 + layer.brightness * 25}, ${25 + layer.brightness * 20}, 0.9)`;
                ctx.fillStyle = baseColor;

                const singleArchSVGWidth = 800;
                const scaledArchWidth = 400;
                const numRepeats = Math.ceil(C_WIDTH / scaledArchWidth);

                for (let i = 0; i < numRepeats; i++) {
                    ctx.save();
                    ctx.translate(i * scaledArchWidth, 0);

                    const scaleX = scaledArchWidth / singleArchSVGWidth;
                    const scaleY = C_HEIGHT / 600;
                    ctx.scale(scaleX, scaleY);

                    // Draw archways
                    const path = new Path2D("M 100 600 C 100 300, 300 300, 300 600 Z M 500 600 C 500 300, 700 300, 700 600 Z");
                    ctx.fill(path);

                    // Add weathered texture and cracks
                    if (layer.detail !== 'low') {
                        ctx.strokeStyle = `rgba(30, 20, 15, ${0.3 * layer.brightness})`;
                        ctx.lineWidth = 2;
                        // Vertical weathering
                        for (let j = 0; j < 3; j++) {
                            const x = 150 + Math.random() * 100;
                            ctx.beginPath();
                            ctx.moveTo(x, 300);
                            ctx.lineTo(x + (Math.random() - 0.5) * 20, 600);
                            ctx.stroke();
                        }
                    }

                    ctx.restore();
                }

                this.addWebGLLayer(canvas, layer.zIndex);
            });
        }

        // 2. Pillar Candles - Varying heights with realistic flickering
        const candleContainer = this.getContainer('monastery-candles');
        if (candleContainer && candleContainer.children.length === 0) {
            // Create rows of candles
            const candleRows = [
                { count: 8, bottom: 5, heightRange: [120, 180] },  // Front row - tallest
                { count: 10, bottom: 15, heightRange: [90, 150] }, // Mid row
                { count: 12, bottom: 25, heightRange: [60, 120] }  // Back row - shortest
            ];

            candleRows.forEach(row => {
                for (let i = 0; i < row.count; i++) {
                    let candle = document.createElement('div');
                    candle.className = 'monastery-candle';

                    const height = Math.random() * (row.heightRange[1] - row.heightRange[0]) + row.heightRange[0];
                    candle.style.height = `${height}px`;
                    candle.style.left = `${(i / row.count) * 95 + Math.random() * 5}%`;
                    candle.style.bottom = `${row.bottom + Math.random() * 5}%`;
                    candle.style.animationDelay = `-${Math.random() * 5}s`;

                    // Realistic flame with glow
                    let flame = document.createElement('div');
                    flame.className = 'candle-flame';
                    flame.style.animationDuration = `${0.8 + Math.random() * 0.4}s`;
                    candle.appendChild(flame);

                    candleContainer.appendChild(candle);
                }
            });
        }

        // 3. Incense Smoke is now handled by WebGLRenderer

        // 4. Stained Glass Windows - Colored light patterns
        const lightContainer = this.getContainer('monastery-stained-glass-light');
        if (lightContainer && lightContainer.children.length === 0) {
            const stainedGlassColors = [
                'rgba(180, 50, 50, 0.4)',   // Ruby red
                'rgba(50, 100, 180, 0.4)',  // Sapphire blue
                'rgba(180, 120, 50, 0.4)',  // Amber gold
                'rgba(120, 50, 150, 0.4)',  // Purple
                'rgba(50, 150, 100, 0.4)'   // Emerald green
            ];

            // Create multiple colored light beams
            for (let i = 0; i < 3; i++) {
                let lightBeam = document.createElement('div');
                lightBeam.className = 'stained-glass-beam';
                const color = stainedGlassColors[Math.floor(Math.random() * stainedGlassColors.length)];
                lightBeam.style.background = `linear-gradient(180deg, ${color} 0%, transparent 100%)`;
                lightBeam.style.left = `${15 + i * 35}%`;
                lightBeam.style.width = `${150 + Math.random() * 100}px`;
                lightBeam.style.animationDelay = `-${Math.random() * 8}s`;
                lightContainer.appendChild(lightBeam);
            }
        }

        // 5. Dancing Shadows from Candlelight
        const shadowContainer = this.getContainer('monastery-shadows');
        if (shadowContainer && shadowContainer.children.length === 0) {
            for (let i = 0; i < 8; i++) {
                let shadow = document.createElement('div');
                shadow.className = 'dancing-shadow';
                shadow.style.left = `${Math.random() * 100}%`;
                shadow.style.animationDelay = `-${Math.random() * 6}s`;
                shadow.style.animationDuration = `${4 + Math.random() * 3}s`;
                shadowContainer.appendChild(shadow);
            }
        }

        // 6. Prayer Beads - Swaying gently
        const beadsContainer = this.getContainer('monastery-prayer-beads');
        if (beadsContainer && beadsContainer.children.length === 0) {
            for (let i = 0; i < 4; i++) {
                let beads = document.createElement('div');
                beads.className = 'prayer-beads';
                beads.style.left = `${20 + i * 20}%`;
                beads.style.top = `${Math.random() * 10}%`;
                beads.style.animationDelay = `-${Math.random() * 4}s`;
                beadsContainer.appendChild(beads);
            }
        }

        // 7. Religious Artifacts - Silhouettes
        const artifactContainer = this.getContainer('monastery-artifacts');
        if (artifactContainer && artifactContainer.children.length === 0) {
            const artifacts = [
                { type: 'cross', left: 10, bottom: 15, size: 80 },
                { type: 'bowl', left: 85, bottom: 20, size: 60 },
                { type: 'bell', left: 50, bottom: 10, size: 70 }
            ];

            artifacts.forEach(artifact => {
                let elem = document.createElement('div');
                elem.className = `artifact artifact-${artifact.type}`;
                elem.style.left = `${artifact.left}%`;
                elem.style.bottom = `${artifact.bottom}%`;
                elem.style.width = `${artifact.size}px`;
                elem.style.height = `${artifact.size}px`;
                artifactContainer.appendChild(elem);
            });
        }
    }
}
