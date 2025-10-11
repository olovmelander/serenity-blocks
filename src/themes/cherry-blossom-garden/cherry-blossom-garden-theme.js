/**
 * @fileoverview Cherry Blossom Garden Theme - Beautiful cherry blossom trees with falling petals
 */

import { BaseTheme } from '../base-theme.js';

/**
 * Cherry Blossom Garden Theme
 * Features:
 * - Dreamy sky with clouds
 * - Falling petals (WebGL)
 * - Procedural cherry blossom tree branches with blooms
 * - Floating cherry leaves
 */
export default class CherryBlossomGardenTheme extends BaseTheme {
    constructor() {
        super('cherry-blossom-garden');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    /**
     * Recursively draw cherry blossom branches
     * @private
     */
    drawBranch(ctx, x1, y1, len, angle, width, colors, depth = 0) {
        if (width < 2 || depth > 10) return; // Add depth limit to prevent stack overflow

        ctx.beginPath();
        ctx.lineWidth = width;
        ctx.strokeStyle = colors.color;
        ctx.moveTo(x1, y1);
        const x2 = x1 + len * Math.cos((angle * Math.PI) / 180);
        const y2 = y1 + len * Math.sin((angle * Math.PI) / 180);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Create dense flower clusters on smaller branches
        if (width < 15) {
            const clusterSize = 40 + (15 - width) * 5;
            const numBlooms = 30 + (15 - width) * 3;
            for (let i = 0; i < numBlooms; i++) {
                const angleOffset = (Math.random() * 2 - 1) * Math.PI;
                const radiusOffset = Math.random() * clusterSize;
                const bloomX = x2 + Math.cos(angleOffset) * radiusOffset;
                const bloomY = y2 + Math.sin(angleOffset) * radiusOffset;
                const bloomRadius = Math.random() * 10 + 5;

                ctx.beginPath();
                ctx.arc(bloomX, bloomY, bloomRadius, 0, Math.PI * 2);
                ctx.fillStyle = colors.bloomColors[Math.floor(Math.random() * colors.bloomColors.length)];
                ctx.globalAlpha = Math.random() * 0.4 + 0.6;
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
        }

        const newLen = len * (0.75 + Math.random() * 0.1);
        this.drawBranch(
            ctx,
            x2,
            y2,
            newLen,
            angle + (Math.random() * 20 + 10),
            width * 0.75,
            colors,
            depth + 1,
        );
        this.drawBranch(
            ctx,
            x2,
            y2,
            newLen,
            angle - (Math.random() * 20 + 10),
            width * 0.75,
            colors,
            depth + 1,
        );
    }

    async createScene() {
        // 1. Dreamy sky details
        const cloudContainer = this.getContainer('cherry-blossom-clouds');
        if (cloudContainer && cloudContainer.children.length === 0) {
            const cloudCount = window.innerWidth > 1100 ? 7 : 5;
            for (let i = 0; i < cloudCount; i++) {
                const cloud = document.createElement('div');
                cloud.className = 'cherry-blossom-cloud';
                cloud.style.top = `${5 + Math.random() * 25}%`;
                cloud.style.setProperty('--cloud-scale', `${0.6 + Math.random() * 0.7}`);
                const duration = 60 + Math.random() * 40;
                cloud.style.setProperty('--cloud-duration', `${duration}s`);
                cloud.style.animationDelay = `-${Math.random() * duration}s`;
                cloudContainer.appendChild(cloud);
            }
        }

        // 2. Falling Petals are now handled by WebGLRenderer.

        // 3. Procedural, swaying trees
        const branchContainer = this.getContainer('cherry-blossom-branches');
        if (branchContainer && branchContainer.children.length === 0) {
            const canvas = document.createElement('canvas');
            const C_WIDTH = 2048;
            const C_HEIGHT = 1080;
            canvas.width = C_WIDTH;
            canvas.height = C_HEIGHT;
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const treeLayers = [
                {
                    count: 3,
                    color: '#2c1e1e',
                    bloomColors: ['#ff8fab', '#ff7f9e', '#e7738c'],
                    baseWidth: 28,
                },
                {
                    count: 5,
                    color: '#3b2a2a',
                    bloomColors: ['#ff8fab', '#ff7f9e', '#e7738c'],
                    baseWidth: 22,
                },
            ];

            treeLayers.forEach((layer) => {
                for (let i = 0; i < layer.count; i++) {
                    const x = Math.random() * C_WIDTH;
                    const y = C_HEIGHT;
                    const length = Math.random() * 50 + 100;
                    this.drawBranch(ctx, x, y, length, -90, layer.baseWidth, {
                        color: layer.color,
                        bloomColors: layer.bloomColors,
                    });
                }
            });

            canvas.style.position = 'absolute';
            canvas.style.bottom = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            branchContainer.appendChild(canvas);
        }

        // 4. Floating Cherry Leaves
        const leafContainer = this.getContainer('cherry-blossom-leaves');
        if (leafContainer && leafContainer.children.length === 0) {
            const leafCount = 50; // Increased count
            for (let i = 0; i < leafCount; i++) {
                const leaf = document.createElement('div');
                leaf.className = 'cherry-leaf';

                const yStart = -10 - Math.random() * 20;
                leaf.style.setProperty('--y-start', `${yStart}vh`);
                leaf.style.setProperty('--y-end', `${110 + Math.random() * 10}vh`);

                const xStart = Math.random() * 100;
                leaf.style.setProperty('--x-start', `${xStart}vw`);
                leaf.style.setProperty('--x-end', `${xStart + (Math.random() - 0.5) * 60}vw`);

                leaf.style.setProperty('--r-start', `${Math.random() * 360}deg`);
                leaf.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);

                leaf.style.setProperty('--leaf-size', `${Math.random() * 5 + 8}px`); // Smaller, more numerous petals

                const duration = 12 + Math.random() * 8;
                leaf.style.animationDuration = `${duration}s`;
                leaf.style.animationDelay = `-${Math.random() * duration}s`;

                leafContainer.appendChild(leaf);
            }
        }
    }
}
