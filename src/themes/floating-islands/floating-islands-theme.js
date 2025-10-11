/**
 * @fileoverview Floating Islands Theme - Fantasy floating islands with waterfalls and trees
 */

import { BaseTheme } from '../base-theme.js';

/**
 * Floating Islands Theme
 * Features:
 * - Procedurally drawn islands with trees and bushes
 * - Waterfalls flowing from islands
 * - Background mountains
 * - Parallax layers
 */
export default class FloatingIslandsTheme extends BaseTheme {
    constructor() {
        super('floating-islands');
        this.waterfallIntervals = [];
        this.palette = {
            grass: { bright: '#7CB342', deep: '#558B2F', highlight: '#AED581' },
            soil: { base: '#8B7355', dark: '#654321' },
            rock: { face: '#7A6A5D', moss: '#4A7C59' },
            tree: {
                trunk: '#5D4E37',
                foliageBright: '#9ACD32',
                foliageMid: '#6B8E23',
                foliageShadow: '#4A6A2E',
            },
        };
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    /**
     * Create waterfall particle effect
     * @private
     */
    createWaterfallEffect(container, startX, startY, fallHeight) {
        const fallRate = 30; // particles per second
        const intervalId = setInterval(() => {
            if (!this.isActive) return;

            const particle = document.createElement('div');
            particle.className = 'waterfall-particle';

            const x = startX + this.random(-8, 8);
            const duration = fallHeight / this.random(250, 400); // Adjust speed

            particle.style.left = `${x}px`;
            particle.style.top = `${startY}px`;
            particle.style.height = `${this.random(40, 80)}px`;
            particle.style.animationDuration = `${duration}s`;

            container.appendChild(particle);

            // Create mist puff when particle "lands"
            const mistPuff = document.createElement('div');
            mistPuff.className = 'waterfall-mist-puff';
            mistPuff.style.left = `${x}px`;
            mistPuff.style.bottom = `${this.random(-20, 30)}px`;
            // Delay the mist puff animation to match the particle's fall time
            mistPuff.style.animationDelay = `${duration - 0.2}s`;
            container.appendChild(mistPuff);

            // Remove particles and mist after animations
            const totalLifetime = (duration + 2) * 1000; // fall duration + mist duration
            setTimeout(() => {
                particle.remove();
                mistPuff.remove();
            }, totalLifetime);
        }, 1000 / fallRate);

        this.waterfallIntervals.push(intervalId);
    }

    /**
     * Draw a majestic tree
     * @private
     */
    drawMajesticTree(ctx, x, y, height) {
        const trunkWidth = height / 7;
        const canopyRadius = height / 1.8;
        const trunkGradient = ctx.createLinearGradient(
            x - trunkWidth / 2,
            y,
            x + trunkWidth / 2,
            y
        );
        trunkGradient.addColorStop(0, '#3E2F1F');
        trunkGradient.addColorStop(0.5, this.palette.tree.trunk);
        trunkGradient.addColorStop(1, '#6F5C42');
        ctx.fillStyle = trunkGradient;
        ctx.beginPath();
        ctx.moveTo(x - trunkWidth / 2, y);
        ctx.lineTo(x + trunkWidth / 2, y);
        ctx.lineTo(x + trunkWidth * 0.7, y - height);
        ctx.lineTo(x - trunkWidth * 0.7, y - height);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = this.palette.tree.foliageShadow;
        ctx.beginPath();
        ctx.arc(x, y - height, canopyRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.palette.tree.foliageMid;
        ctx.beginPath();
        ctx.arc(
            x - canopyRadius / 5,
            y - height - canopyRadius / 5,
            canopyRadius * 0.9,
            0,
            Math.PI * 2
        );
        ctx.fill();
        ctx.fillStyle = this.palette.tree.foliageBright;
        ctx.beginPath();
        ctx.arc(
            x + canopyRadius / 6,
            y - height - canopyRadius / 4,
            canopyRadius * 0.75,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    /**
     * Draw a floating island
     * @private
     */
    drawIsland(ctx, island) {
        const { x, y, width, height } = island;
        const topSurface = [];
        for (let i = 0; i <= width; i++) {
            const angle = (i / width) * Math.PI;
            const bump = Math.sin(angle) * 20 + Math.sin(angle * 3) * 5;
            topSurface.push({ x: x + i, y: y - bump });
        }
        island.topSurface = topSurface; // Store for waterfalls

        const bottomSurface = [];
        for (let i = width; i >= 0; i--) {
            const angle = (i / width) * Math.PI;
            const bump =
                Math.sin(angle) * (height * 0.8) + Math.sin(angle * 2) * 20 + Math.random() * 15;
            bottomSurface.push({ x: x + i, y: y + bump });
        }
        const rockGradient = ctx.createLinearGradient(x, y, x, y + height);
        rockGradient.addColorStop(0, this.palette.soil.base);
        rockGradient.addColorStop(0.5, this.palette.rock.face);
        rockGradient.addColorStop(1, this.palette.soil.dark);
        ctx.fillStyle = rockGradient;
        ctx.beginPath();
        ctx.moveTo(topSurface[0].x, topSurface[0].y);
        topSurface.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(bottomSurface[0].x, bottomSurface[0].y);
        bottomSurface.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
        for (let i = 0; i < width / 8; i++) {
            const rootStartX = x + this.random(width * 0.1, width * 0.9);
            const rootStartY = y + height * this.random(0.5, 1);
            ctx.strokeStyle = this.palette.soil.dark;
            ctx.lineWidth = this.random(2, 6);
            ctx.beginPath();
            ctx.moveTo(rootStartX, rootStartY);
            ctx.bezierCurveTo(
                rootStartX + this.random(-20, 20),
                rootStartY + 30,
                rootStartX + this.random(-10, 10),
                rootStartY + 60,
                rootStartX + this.random(-5, 5),
                rootStartY + 90
            );
            ctx.stroke();
        }
        ctx.fillStyle = this.palette.grass.deep;
        ctx.beginPath();
        ctx.moveTo(topSurface[0].x, topSurface[0].y);
        topSurface.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(topSurface[topSurface.length - 1].x, topSurface[topSurface.length - 1].y + 20);
        ctx.lineTo(topSurface[0].x, topSurface[0].y + 20);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = this.palette.grass.bright;
        ctx.beginPath();
        ctx.moveTo(topSurface[0].x, topSurface[0].y);
        topSurface.forEach(p => ctx.lineTo(p.x, p.y + 5));
        ctx.closePath();
        ctx.fill();
        if (island.tree) {
            this.drawMajesticTree(
                ctx,
                x + width / 2,
                topSurface[Math.floor(width / 2)].y,
                island.tree.height
            );
        }
        for (let i = 0; i < island.bushes; i++) {
            const bushX = x + this.random(0, width);
            const bushY = topSurface[Math.floor(bushX - x)].y;
            ctx.fillStyle = this.palette.tree.foliageMid;
            ctx.beginPath();
            ctx.arc(bushX, bushY, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = this.palette.tree.foliageBright;
            ctx.beginPath();
            ctx.arc(bushX - 5, bushY - 5, 12, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    async createScene() {
        const C_WIDTH = 4096;
        const C_HEIGHT = window.innerHeight;

        // Set the width of the containers to match the parallax canvas
        document.querySelectorAll('.fi-waterfall-container').forEach(wc => {
            wc.style.width = `${C_WIDTH}px`;
        });

        const layers = [
            {
                el: document.getElementById('fi-layer-front'),
                wc: document.getElementById('fi-waterfall-front'),
                islands: [
                    {
                        x: C_WIDTH * 0.1,
                        y: C_HEIGHT * 0.5,
                        width: 600,
                        height: 250,
                        tree: { height: 200 },
                        bushes: 5,
                        waterfall: { edge: 0.9, width: 25 },
                    },
                ],
            },
            {
                el: document.getElementById('fi-layer-mid'),
                wc: document.getElementById('fi-waterfall-mid'),
                islands: [
                    {
                        x: C_WIDTH * 0.6,
                        y: C_HEIGHT * 0.3,
                        width: 450,
                        height: 180,
                        tree: { height: 120 },
                        bushes: 3,
                        waterfall: { edge: 0.85, width: 20 },
                    },
                    {
                        x: C_WIDTH * 0.8,
                        y: C_HEIGHT * 0.6,
                        width: 300,
                        height: 120,
                        tree: { height: 80 },
                        bushes: 2,
                        waterfall: false,
                    },
                ],
            },
            {
                el: document.getElementById('fi-layer-back'),
                wc: document.getElementById('fi-waterfall-back'),
                islands: [
                    {
                        x: C_WIDTH * 0.3,
                        y: C_HEIGHT * 0.4,
                        width: 250,
                        height: 100,
                        tree: { height: 60 },
                        bushes: 1,
                        waterfall: { edge: 0.9, width: 15 },
                    },
                    {
                        x: C_WIDTH * 0.05,
                        y: C_HEIGHT * 0.7,
                        width: 200,
                        height: 80,
                        tree: { height: 50 },
                        bushes: 0,
                        waterfall: false,
                    },
                ],
            },
        ];

        layers.forEach(layer => {
            if (layer.el) {
                this.registerContainer(layer.el);
                if (layer.el.querySelector('canvas') === null) {
                    const canvas = document.createElement('canvas');
                    canvas.width = C_WIDTH;
                    canvas.height = C_HEIGHT;
                    const ctx = canvas.getContext('2d');
                    layer.islands.forEach(island => this.drawIsland(ctx, island));
                    canvas.style.position = 'absolute';
                    canvas.style.left = '0';
                    canvas.style.bottom = '0';
                    canvas.style.width = `${C_WIDTH}px`;
                    canvas.style.height = '100%';
                    layer.el.insertBefore(canvas, layer.el.firstChild);
                }
            }

            if (layer.wc) {
                this.registerContainer(layer.wc);
                layer.islands.forEach(island => {
                    if (island.waterfall && island.topSurface) {
                        const edgeIndex = Math.floor(
                            island.topSurface.length * island.waterfall.edge
                        );
                        const edgePoint = island.topSurface[edgeIndex];
                        const fallHeight = C_HEIGHT - edgePoint.y;
                        this.createWaterfallEffect(layer.wc, edgePoint.x, edgePoint.y, fallHeight);
                    }
                });
            }
        });

        const mountainContainer = this.getContainer('fi-mountains-back');
        if (mountainContainer && mountainContainer.children.length === 0) {
            const canvas = document.createElement('canvas');
            canvas.width = C_WIDTH;
            canvas.height = C_HEIGHT;
            const ctx = canvas.getContext('2d');
            const mountainColors = ['#8FA5B8', '#7A8FA0'];
            for (let i = 0; i < mountainColors.length; i++) {
                ctx.fillStyle = mountainColors[i];
                ctx.beginPath();
                ctx.moveTo(0, C_HEIGHT);
                const y = C_HEIGHT * (0.5 + i * 0.1);
                for (let x = 0; x < C_WIDTH; x += 20) {
                    ctx.lineTo(x, y - Math.sin(x * 0.001 + i) * 100 + Math.random() * 20);
                }
                ctx.lineTo(C_WIDTH, C_HEIGHT);
                ctx.closePath();
                ctx.fill();
            }
            canvas.style.position = 'absolute';
            canvas.style.left = '0';
            canvas.style.bottom = '0';
            canvas.style.width = `${C_WIDTH}px`;
            canvas.style.height = '100%';
            mountainContainer.appendChild(canvas);
        }
    }

    stop() {
        // Clear waterfall intervals
        this.waterfallIntervals.forEach(clearInterval);
        this.waterfallIntervals = [];

        // Remove waterfall particles
        document
            .querySelectorAll('.waterfall-particle, .waterfall-mist-puff')
            .forEach(el => el.remove());

        super.stop();
    }
}
