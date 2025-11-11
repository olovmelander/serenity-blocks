/**
 * @fileoverview Ice Temple Theme - Immersive frozen vistas with auroras, ice cracks, and drifting shards.
 */

import { BaseTheme } from '../base-theme.js';
import { iceTempleCache } from '../../utils/cache.js';

export default class IceTempleTheme extends BaseTheme {
    constructor() {
        super('ice-temple');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        this.createStars();
        this.createAurora();
        this.createIceField();
        this.createCrackNetwork();
        this.createFrostHaze();
        this.createMistLayers();
        this.createSnowfall();
        this.createRefractions();
    }

    createStars() {
        const container = this.getContainer('ice-temple-stars');
        if (!container || container.children.length) return;

        const starCount = 240;
        const rng = this.seededRandom(11111);
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'ice-temple-star';
            const size = rng() * 1.4 + 0.4;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${rng() * 100}%`;
            star.style.top = `${rng() * 100}%`;
            star.style.setProperty('--min-opacity', `${0.25 + rng() * 0.25}`);
            star.style.setProperty('--max-opacity', `${0.55 + rng() * 0.35}`);
            star.style.setProperty('--twinkle-duration', `${3 + rng() * 2.5}s`);
            star.style.setProperty('--twinkle-delay', `${rng() * 4}s`);
            container.appendChild(star);
        }
    }

    createAurora() {
        const container = this.getContainer('ice-temple-aurora');
        if (!container || container.children.length) return;

        const colors = ['#74b9ff', '#55efc4', '#a29bfe', '#89d9ff'];
        const rng = this.seededRandom(12222);
        for (let i = 0; i < 4; i++) {
            const curtain = document.createElement('div');
            curtain.className = 'ice-aurora-curtain';
            curtain.style.setProperty('--aurora-color', colors[i]);
            curtain.style.setProperty('--aurora-duration', `${22 + i * 4 + rng() * 4}s`);
            curtain.style.setProperty('--aurora-delay', `${i * 3}s`);
            curtain.style.left = `${i * 25}%`;
            if (i % 2 === 1) {
                curtain.style.animationDirection = 'alternate-reverse';
            }
            container.appendChild(curtain);
        }
    }

    createIceField() {
        const container = this.getContainer('ice-temple-icefield');
        if (!container) return;

        const width = 2200;
        const height = 900;
        const cacheKey = `ice-temple-icefield-${width}x${height}`;

        if (!iceTempleCache.has(cacheKey)) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            const baseGradient = ctx.createLinearGradient(0, 0, 0, height);
            baseGradient.addColorStop(0, '#0a1f35');
            baseGradient.addColorStop(0.4, '#0e3352');
            baseGradient.addColorStop(1, '#15526c');
            ctx.fillStyle = baseGradient;
            ctx.fillRect(0, 0, width, height);

            // Etch subtle ice ridges
            for (let i = 0; i < 140; i++) {
                const startX = Math.random() * width;
                const startY = height * (0.35 + Math.random() * 0.6);
                const length = 120 + Math.random() * 280;
                const slope = (Math.random() * 0.7) - 0.35;
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(startX + length, startY - length * slope);
                ctx.lineWidth = Math.random() * 1.4 + 0.2;
                ctx.strokeStyle = `rgba(220, 245, 255, ${0.015 + Math.random() * 0.05})`;
                ctx.stroke();
            }

            // Scatter crystalline facets
            for (let i = 0; i < 1100; i++) {
                const radius = Math.random() * 1.6 + 0.2;
                const alpha = 0.015 + Math.random() * 0.03;
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.beginPath();
                ctx.arc(Math.random() * width, height * (0.25 + Math.random() * 0.75), radius, 0, Math.PI * 2);
                ctx.fill();
            }

            const dataURL = `url(${canvas.toDataURL('image/png')})`;
            iceTempleCache.set(cacheKey, {
                backgroundImage: dataURL,
                backgroundSize: `${width}px ${height}px`,
            });
        }

        const cached = iceTempleCache.get(cacheKey);
        container.style.backgroundImage = cached.backgroundImage;
        container.style.backgroundSize = cached.backgroundSize;
    }

    createCrackNetwork() {
        const container = this.getContainer('ice-temple-cracks');
        if (!container || container.children.length) return;

        const rng = this.seededRandom(13337);
        const crackCount = 20;
        for (let i = 0; i < crackCount; i++) {
            const crack = document.createElement('div');
            crack.className = 'ice-temple-crack';
            crack.style.left = `${rng() * 100}%`;
            crack.style.top = `${55 + rng() * 40}%`;
            crack.style.setProperty('--crack-length', `${22 + rng() * 45}vh`);
            crack.style.setProperty('--crack-thickness', `${0.7 + rng() * 1.8}px`);
            crack.style.setProperty('--crack-rotate', `${-40 + rng() * 80}deg`);
            crack.style.setProperty('--crack-delay', `${rng() * 6}s`);
            crack.style.setProperty('--crack-glow', `${0.3 + rng() * 0.4}`);
            const glintDuration = 4.5 + rng() * 3.5;
            crack.style.setProperty('--crack-glint-duration', `${glintDuration}s`);
            crack.style.setProperty('--crack-phase', `-${rng() * glintDuration}s`);
            if (rng() > 0.6) {
                crack.classList.add('branching');
                crack.style.setProperty('--branch-rotate', `${-35 + rng() * 70}deg`);
                crack.style.setProperty('--branch-length', `${12 + rng() * 20}vh`);
            }
            container.appendChild(crack);
        }
    }

    createFrostHaze() {
        const container = this.getContainer('ice-temple-ice-shards');
        if (!container || container.children.length) return;

        const rng = this.seededRandom(17777);
        const spriteCount = 24;
        for (let i = 0; i < spriteCount; i++) {
            const haze = document.createElement('div');
            haze.className = 'ice-temple-frost-haze';
            const size = 60 + rng() * 120;
            haze.style.width = `${size}px`;
            haze.style.height = `${size}px`;
            haze.style.left = `${rng() * 100}%`;
            haze.style.top = `${rng() * 100}%`;
            const duration = 18 + rng() * 14;
            haze.style.setProperty('--haze-duration', `${duration}s`);
            haze.style.setProperty('--haze-delay', `-${rng() * duration}s`);
            haze.style.setProperty('--haze-drift-x', `${rng() * 20 - 10}vw`);
            haze.style.setProperty('--haze-drift-y', `${rng() * 12 - 6}vh`);
            haze.style.setProperty('--haze-scale', `${0.6 + rng() * 0.6}`);
            haze.style.setProperty('--haze-opacity', `${0.12 + rng() * 0.25}`);
            container.appendChild(haze);
        }
    }

    createMistLayers() {
        const container = this.getContainer('ice-temple-mist');
        if (!container || container.children.length) return;

        for (let i = 0; i < 3; i++) {
            const mist = document.createElement('div');
            mist.className = 'ice-temple-mist-layer';
            mist.style.setProperty('--mist-duration', `${24 + i * 8}s`);
            mist.style.setProperty('--mist-delay', `${i * -4}s`);
            mist.style.opacity = `${0.12 + i * 0.07}`;
            mist.dataset.layer = i === 0 ? 'back' : i === 1 ? 'mid' : 'front';
            container.appendChild(mist);
        }
    }

    createSnowfall() {
        const container = this.getContainer('ice-temple-snow');
        if (!container || container.children.length) return;

        const rng = this.seededRandom(15555);
        const flakeCount = 90;
        for (let i = 0; i < flakeCount; i++) {
            const snowflake = document.createElement('div');
            snowflake.className = 'ice-temple-snowflake';
            const size = rng() * 2 + 1;
            snowflake.style.width = `${size}px`;
            snowflake.style.height = `${size}px`;
            snowflake.style.left = `${rng() * 100}%`;

            const depthFactor = rng();
            const duration = 12 + depthFactor * 10;
            snowflake.style.setProperty('--fall-duration', `${duration}s`);
            snowflake.style.setProperty('--fall-delay', `-${rng() * duration}s`);
            snowflake.style.setProperty('--sway-amount', `${rng() * 60 - 30}px`);
            snowflake.style.setProperty('--snow-scale', `${0.6 + depthFactor * 0.8}`);
            snowflake.style.setProperty('--snow-opacity', `${0.35 + (1 - depthFactor) * 0.45}`);
            container.appendChild(snowflake);
        }
    }

    createRefractions() {
        const container = this.getContainer('ice-temple-refractions');
        if (!container || container.children.length) return;

        const colors = [
            'rgba(116, 185, 255, 0.5)',
            'rgba(255, 255, 255, 0.45)',
            'rgba(162, 155, 254, 0.4)',
            'rgba(137, 217, 255, 0.5)',
        ];
        const rng = this.seededRandom(16666);
        for (let i = 0; i < 14; i++) {
            const ray = document.createElement('div');
            ray.className = 'ice-refraction-ray';
            ray.style.left = `${rng() * 100}%`;
            ray.style.top = `${rng() * 100}%`;
            ray.style.setProperty('--ray-color', colors[i % colors.length]);
            ray.style.setProperty('--ray-angle', `${rng() * 360}deg`);
            ray.style.setProperty('--ray-rotation-duration', `${28 + rng() * 18}s`);
            ray.style.setProperty('--ray-pulse-duration', `${2 + rng() * 2.5}s`);
            ray.style.setProperty('--ray-delay', `${rng() * 8}s`);
            container.appendChild(ray);
        }
    }
}
