/**
 * @fileoverview Ice Temple Theme - Frozen ice temple with aurora, crystals, and snowfall
 */

import { BaseTheme } from '../base-theme.js';
import { iceTempleCache } from '../../utils/cache.js';

/**
 * Ice Temple Theme
 * Features:
 * - Starfield with twinkling
 * - Aurora borealis curtains
 * - Procedural ice mountains
 * - Crystal formations (WebGL)
 * - Ice stalactites and stalagmites (WebGL)
 * - Frozen mist layers
 * - Snowfall particles
 * - Prismatic light refractions
 */
export default class IceTempleTheme extends BaseTheme {
    constructor() {
        super('ice-temple');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // LAYER 1: Starfield Background with Twinkling
        const starsContainer = this.getContainer('ice-temple-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            const starCount = 250;
            const rng = this.seededRandom(11111);
            for (let i = 0; i < starCount; i++) {
                const star = document.createElement('div');
                star.className = 'ice-temple-star';
                const size = rng() * 1.5 + 0.5;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.left = `${rng() * 100}%`;
                star.style.top = `${rng() * 100}%`;
                star.style.setProperty('--min-opacity', `${rng() * 0.2 + 0.3}`);
                star.style.setProperty('--max-opacity', `${rng() * 0.2 + 0.6}`);
                star.style.setProperty('--twinkle-duration', `${rng() * 2 + 3}s`);
                star.style.setProperty('--twinkle-delay', `${rng() * 5}s`);
                starsContainer.appendChild(star);
            }
        }

        // LAYER 2: Aurora Borealis
        const auroraContainer = this.getContainer('ice-temple-aurora');
        if (auroraContainer && auroraContainer.children.length === 0) {
            const colors = ['#74b9ff', '#55efc4', '#a29bfe', '#8b7bd8'];
            for (let i = 0; i < 4; i++) {
                let curtain = document.createElement('div');
                curtain.className = 'ice-aurora-curtain';
                curtain.style.setProperty('--aurora-color', colors[i]);
                curtain.style.setProperty('--aurora-duration', `${20 + i * 5}s`);
                curtain.style.setProperty('--aurora-delay', `${i * 5}s`);
                curtain.style.left = `${i * 25}%`;
                if (i % 2 === 1) {
                    curtain.style.animationDirection = 'alternate-reverse';
                }
                auroraContainer.appendChild(curtain);
            }
        }

        // LAYER 3: Distant Ice Mountains with Canvas
        const mountainsDistant = this.getContainer('ice-temple-mountains-distant');
        if (mountainsDistant) {
            const cacheKey = 'ice-temple-mountains-distant-3000x800';

            if (iceTempleCache.has(cacheKey)) {
                const cachedData = iceTempleCache.get(cacheKey);
                mountainsDistant.style.backgroundImage = cachedData.backgroundImage;
                mountainsDistant.style.backgroundSize = cachedData.backgroundSize;
            } else {
                const rng = this.seededRandom(22222);
                const canvas = document.createElement('canvas');
                canvas.width = 3000;
                canvas.height = 800;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = 'rgba(26, 58, 90, 0.6)';
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);

                // Create jagged mountain silhouette
                for (let x = 0; x <= canvas.width; x += 80 + rng() * 40) {
                    const peakHeight = rng() * 300 + 200;
                    ctx.lineTo(x, canvas.height - peakHeight);
                    ctx.lineTo(x + 40 + rng() * 30, canvas.height - peakHeight + rng() * 100);
                }

                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();

                const dataURL = `url(${canvas.toDataURL()})`;
                iceTempleCache.set(cacheKey, {
                    backgroundImage: dataURL,
                    backgroundSize: '3000px 800px'
                });
                mountainsDistant.style.backgroundImage = dataURL;
                mountainsDistant.style.backgroundSize = '3000px 800px';
            }
        }

        // LAYER 4: Midground Crystal Formations (WebGL)
        if (this.webglRenderer) {
            const cacheKey = `ice-temple-mid-crystals-${window.innerWidth}x${window.innerHeight}`;

            if (iceTempleCache.has(cacheKey)) {
                const cachedCanvas = iceTempleCache.get(cacheKey);
                this.addWebGLLayer(cachedCanvas, -0.6);
            } else {
                const rng = this.seededRandom(33333);
                const canvas = document.createElement('canvas');
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                const ctx = canvas.getContext('2d');

                // Draw translucent geometric crystal towers
                for (let i = 0; i < 12; i++) {
                    const x = rng() * canvas.width;
                    const baseY = canvas.height * (0.5 + rng() * 0.3);
                    const height = rng() * 250 + 150;
                    const width = rng() * 50 + 30;

                    // Add glow effect
                    ctx.shadowColor = 'rgba(116, 185, 255, 0.8)';
                    ctx.shadowBlur = 20;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;

                    ctx.fillStyle = 'rgba(116, 185, 255, 0.4)';
                    ctx.strokeStyle = 'rgba(227, 242, 255, 0.6)';
                    ctx.lineWidth = 1;

                    // Hexagonal crystal
                    ctx.beginPath();
                    for (let j = 0; j < 6; j++) {
                        const angle = (Math.PI / 3) * j;
                        const px = x + Math.cos(angle) * width;
                        const py = baseY - height + Math.sin(angle) * width * 0.3;
                        if (j === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();

                    // Crystal shaft
                    ctx.fillStyle = 'rgba(116, 185, 255, 0.3)';
                    ctx.fillRect(x - width * 0.4, baseY - height, width * 0.8, height);

                    // Reset shadow for next iteration
                    ctx.shadowBlur = 0;
                }

                iceTempleCache.set(cacheKey, canvas);
                this.addWebGLLayer(canvas, -0.6);
            }
        }

        // LAYER 5: Foreground Ice Architecture (Stalactites & Stalagmites)
        if (this.webglRenderer) {
            const cacheKey = `ice-temple-foreground-${window.innerWidth}x${window.innerHeight}`;

            if (iceTempleCache.has(cacheKey)) {
                const cachedCanvas = iceTempleCache.get(cacheKey);
                this.addWebGLLayer(cachedCanvas, -0.3);
            } else {
                const rng = this.seededRandom(44444);
                const canvas = document.createElement('canvas');
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                const ctx = canvas.getContext('2d');

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 1.5;

                // Add glow effect for ice architecture
                ctx.shadowColor = 'rgba(200, 230, 255, 0.9)';
                ctx.shadowBlur = 25;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;

                // Stalactites from ceiling
                for (let i = 0; i < 8; i++) {
                    const x = rng() * canvas.width;
                    const h = rng() * canvas.height * 0.4 + canvas.height * 0.15;
                    const w = rng() * 60 + 40;

                    ctx.fillStyle = 'rgba(227, 242, 255, 0.7)';
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x - w, h * 0.3);
                    ctx.lineTo(x, h);
                    ctx.lineTo(x + w, h * 0.3);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }

                // Stalagmites from floor
                for (let i = 0; i < 8; i++) {
                    const x = rng() * canvas.width;
                    const h = rng() * canvas.height * 0.4 + canvas.height * 0.15;
                    const w = rng() * 60 + 40;

                    ctx.fillStyle = 'rgba(227, 242, 255, 0.7)';
                    ctx.beginPath();
                    ctx.moveTo(x, canvas.height);
                    ctx.lineTo(x - w, canvas.height - h * 0.3);
                    ctx.lineTo(x, canvas.height - h);
                    ctx.lineTo(x + w, canvas.height - h * 0.3);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }

                // Reset shadow
                ctx.shadowBlur = 0;

                iceTempleCache.set(cacheKey, canvas);
                this.addWebGLLayer(canvas, -0.3);
            }
        }

        // LAYER 6: Frozen Mist Overlay
        const mistContainer = this.getContainer('ice-temple-mist');
        if (mistContainer && mistContainer.children.length === 0) {
            for (let i = 0; i < 3; i++) {
                const mist = document.createElement('div');
                mist.className = 'ice-temple-mist-layer';
                mist.style.setProperty('--mist-duration', `${15 + i * 5}s`);
                mist.style.setProperty('--mist-delay', `${i * 5}s`);
                mist.style.opacity = `${0.1 + i * 0.05}`;
                if (i % 2 === 0) {
                    mist.style.animationDirection = 'reverse';
                }
                mistContainer.appendChild(mist);
            }
        }

        // LAYER 7: Snowfall Particles
        const snowContainer = this.getContainer('ice-temple-snow');
        if (snowContainer && snowContainer.children.length === 0) {
            const rng = this.seededRandom(55555);
            for (let i = 0; i < 40; i++) {
                const snowflake = document.createElement('div');
                snowflake.className = 'ice-temple-snowflake';
                const size = rng() * 2 + 1;
                snowflake.style.width = `${size}px`;
                snowflake.style.height = `${size}px`;
                snowflake.style.left = `${rng() * 100}%`;
                snowflake.style.setProperty('--fall-duration', `${rng() * 10 + 10}s`);
                snowflake.style.setProperty('--fall-delay', `${rng() * 10}s`);
                snowflake.style.setProperty('--sway-amount', `${rng() * 40 - 20}px`);
                snowContainer.appendChild(snowflake);
            }
        }

        // LAYER 8: Prismatic Light Refractions
        const refractionContainer = this.getContainer('ice-temple-refractions');
        if (refractionContainer && refractionContainer.children.length === 0) {
            const colors = ['rgba(116, 185, 255, 0.4)', 'rgba(255, 255, 255, 0.5)', 'rgba(162, 155, 254, 0.4)'];
            const rng = this.seededRandom(66666);
            for (let i = 0; i < 12; i++) {
                let ray = document.createElement('div');
                ray.className = 'ice-refraction-ray';
                ray.style.left = `${rng() * 100}%`;
                ray.style.top = `${rng() * 100}%`;
                ray.style.setProperty('--ray-color', colors[i % colors.length]);
                ray.style.setProperty('--ray-angle', `${rng() * 360}deg`);
                ray.style.setProperty('--ray-rotation-duration', `${rng() * 30 + 30}s`);
                ray.style.setProperty('--ray-pulse-duration', `${rng() * 3 + 2}s`);
                ray.style.setProperty('--ray-delay', `${rng() * 10}s`);
                refractionContainer.appendChild(ray);
            }
        }
    }
}
