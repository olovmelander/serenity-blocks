/**
 * @fileoverview Wolfhour Theme - Mystical nighttime scene with stars, nebula, and cosmic elements
 */

import { BaseTheme } from '../base-theme.js';
import { wolfhourBackgroundCache } from '../../utils/cache.js';

/**
 * Wolfhour Theme
 * Features:
 * - Dense star field with shooting stars
 * - Procedural nebula clouds
 * - Mystical light rays
 * - Cosmic rifts
 * - Ethereal spirits
 * - Jagged mountain silhouettes
 */
export default class WolfhourTheme extends BaseTheme {
    constructor() {
        super('wolfhour');
        this.shootingStarInterval = null;
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // 1. Create dense star field (optimized count for performance)
        const starsContainer = this.getContainer('wolfhour-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            const starCount = 150; // Reduced from 300 for better performance
            for (let i = 0; i < starCount; i++) {
                const star = document.createElement('div');
                star.className = 'wolfhour-star';
                const size = Math.random() * 2 + 0.5;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 100}%`;
                star.style.setProperty('--min-opacity', `${Math.random() * 0.3 + 0.2}`);
                star.style.setProperty('--max-opacity', `${Math.random() * 0.3 + 0.7}`);
                star.style.setProperty('--twinkle-duration', `${Math.random() * 3 + 2}s`);
                star.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);
                starsContainer.appendChild(star);
            }

            // Create shooting stars periodically
            this.shootingStarInterval = setInterval(() => {
                if (!this.isActive) return;
                const shootingStar = document.createElement('div');
                shootingStar.className = 'wolfhour-shooting-star';
                shootingStar.style.left = `${Math.random() * 100}%`;
                shootingStar.style.top = `${Math.random() * 40}%`;
                const distance = Math.random() * 300 + 200;
                shootingStar.style.setProperty('--shoot-x', `${-distance}px`);
                shootingStar.style.setProperty('--shoot-y', `${distance}px`);
                shootingStar.style.setProperty('--shoot-duration', `${Math.random() * 1 + 1.5}s`);
                starsContainer.appendChild(shootingStar);
                setTimeout(() => shootingStar.remove(), 3000);
            }, 8000);
        }

        // 2. Create nebula clouds using canvas (with caching)
        const nebulaBack = this.getContainer('wolfhour-nebula-back');
        if (nebulaBack) {
            const cacheKey = 'wolfhour-nebula-back-2000x800';

            if (wolfhourBackgroundCache.has(cacheKey)) {
                // Use cached version
                nebulaBack.style.backgroundImage = wolfhourBackgroundCache.get(cacheKey);
            } else {
                // Generate with seeded random for deterministic output
                const rng = this.seededRandom(12345);
                const canvas = document.createElement('canvas');
                canvas.width = 2000;
                canvas.height = 800;
                const ctx = canvas.getContext('2d');

                // Create wispy nebula texture
                for (let i = 0; i < 50; i++) {
                    const x = rng() * canvas.width;
                    const y = rng() * canvas.height;
                    const radius = rng() * 200 + 100;
                    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                    const opacity = rng() * 0.15 + 0.05;
                    gradient.addColorStop(0, `rgba(200, 200, 200, ${opacity})`);
                    gradient.addColorStop(0.5, `rgba(150, 150, 150, ${opacity * 0.5})`);
                    gradient.addColorStop(1, 'rgba(100, 100, 100, 0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }

                const dataURL = `url(${canvas.toDataURL()})`;
                wolfhourBackgroundCache.set(cacheKey, dataURL);
                nebulaBack.style.backgroundImage = dataURL;
            }
        }

        const nebulaMid = this.getContainer('wolfhour-nebula-mid');
        if (nebulaMid) {
            const cacheKey = 'wolfhour-nebula-mid-2000x800';

            if (wolfhourBackgroundCache.has(cacheKey)) {
                // Use cached version
                nebulaMid.style.backgroundImage = wolfhourBackgroundCache.get(cacheKey);
            } else {
                // Generate with seeded random for deterministic output
                const rng = this.seededRandom(54321);
                const canvas = document.createElement('canvas');
                canvas.width = 2000;
                canvas.height = 800;
                const ctx = canvas.getContext('2d');

                // Create denser nebula for mid layer
                for (let i = 0; i < 40; i++) {
                    const x = rng() * canvas.width;
                    const y = rng() * canvas.height;
                    const radius = rng() * 250 + 150;
                    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                    const opacity = rng() * 0.2 + 0.1;
                    gradient.addColorStop(0, `rgba(220, 220, 220, ${opacity})`);
                    gradient.addColorStop(0.5, `rgba(180, 180, 180, ${opacity * 0.6})`);
                    gradient.addColorStop(1, 'rgba(120, 120, 120, 0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }

                const dataURL = `url(${canvas.toDataURL()})`;
                wolfhourBackgroundCache.set(cacheKey, dataURL);
                nebulaMid.style.backgroundImage = dataURL;
            }
        }

        // 3. Create mystical light rays
        const lightRaysContainer = this.getContainer('wolfhour-light-rays');
        if (lightRaysContainer && lightRaysContainer.children.length === 0) {
            const rayCount = 12;
            for (let i = 0; i < rayCount; i++) {
                const ray = document.createElement('div');
                ray.className = 'wolfhour-light-ray';
                ray.style.left = `${Math.random() * 100}%`;
                const angleStart = Math.random() * 6 - 3;
                const angleEnd = angleStart + (Math.random() * 4 - 2);
                ray.style.setProperty('--ray-angle-start', `${angleStart}deg`);
                ray.style.setProperty('--ray-angle-end', `${angleEnd}deg`);
                ray.style.setProperty('--ray-duration', `${Math.random() * 6 + 8}s`);
                ray.style.setProperty('--ray-delay', `${Math.random() * 10}s`);
                lightRaysContainer.appendChild(ray);
            }
        }

        // 4. Create cosmic rifts (glowing cracks in space)
        const cosmicRiftsContainer = this.getContainer('wolfhour-cosmic-rifts');
        if (cosmicRiftsContainer && cosmicRiftsContainer.children.length === 0) {
            const riftCount = 8;
            for (let i = 0; i < riftCount; i++) {
                const rift = document.createElement('div');
                rift.className = 'wolfhour-cosmic-rift';
                rift.style.left = `${Math.random() * 100}%`;
                rift.style.top = `${Math.random() * 60}%`;
                rift.style.setProperty('--rift-length', `${Math.random() * 100 + 100}px`);
                rift.style.setProperty('--rift-duration', `${Math.random() * 3 + 3}s`);
                rift.style.setProperty('--rift-delay', `${Math.random() * 5}s`);
                rift.style.transform = `rotate(${Math.random() * 30 - 15}deg)`;
                cosmicRiftsContainer.appendChild(rift);
            }
        }

        // 5. Create ethereal spirits
        const spiritsContainer = this.getContainer('wolfhour-spirits');
        if (spiritsContainer && spiritsContainer.children.length === 0) {
            const spiritCount = 6;
            for (let i = 0; i < spiritCount; i++) {
                const spirit = document.createElement('div');
                spirit.className = 'wolfhour-spirit';
                spirit.style.left = `${Math.random() * 100}%`;
                spirit.style.top = `${Math.random() * 80 + 10}%`;

                const xStart = Math.random() * 40 - 20;
                const xMid = Math.random() * 80 - 40;
                const xEnd = Math.random() * 120 - 60;
                const yStart = Math.random() * 20;
                const yMid = -(Math.random() * 100 + 50);
                const yEnd = -(Math.random() * 200 + 100);

                spirit.style.setProperty('--spirit-x-start', `${xStart}px`);
                spirit.style.setProperty('--spirit-x-mid', `${xMid}px`);
                spirit.style.setProperty('--spirit-x-end', `${xEnd}px`);
                spirit.style.setProperty('--spirit-y-start', `${yStart}px`);
                spirit.style.setProperty('--spirit-y-mid', `${yMid}px`);
                spirit.style.setProperty('--spirit-y-end', `${yEnd}px`);
                spirit.style.setProperty('--spirit-duration', `${Math.random() * 15 + 20}s`);
                spirit.style.setProperty('--spirit-delay', `${Math.random() * 20}s`);
                spiritsContainer.appendChild(spirit);
            }
        }

        // 6. Create jagged mountain silhouettes (with caching)
        const mountainsDistant = this.getContainer('wolfhour-mountains-distant');
        if (mountainsDistant) {
            const cacheKey = 'wolfhour-mountains-distant-4000x800';

            if (wolfhourBackgroundCache.has(cacheKey)) {
                // Use cached version
                const cachedData = wolfhourBackgroundCache.get(cacheKey);
                mountainsDistant.style.backgroundImage = cachedData.backgroundImage;
                mountainsDistant.style.backgroundSize = cachedData.backgroundSize;
            } else {
                // Generate with seeded random for deterministic output
                const rng = this.seededRandom(11111);
                const canvas = document.createElement('canvas');
                canvas.width = 4000;
                canvas.height = 800;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#404040';
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);

                // Create jagged peaks
                for (let x = 0; x < canvas.width; x += 20) {
                    const y = canvas.height - (rng() * 300 + 200) - Math.sin(x * 0.01) * 100;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();

                const backgroundImage = `url(${canvas.toDataURL()})`;
                const backgroundSize = '2000px 100%';
                wolfhourBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
                mountainsDistant.style.backgroundImage = backgroundImage;
                mountainsDistant.style.backgroundSize = backgroundSize;
            }
        }

        const mountainsFore = this.getContainer('wolfhour-mountains-fore');
        if (mountainsFore) {
            const cacheKey = 'wolfhour-mountains-fore-4000x600';

            if (wolfhourBackgroundCache.has(cacheKey)) {
                // Use cached version
                const cachedData = wolfhourBackgroundCache.get(cacheKey);
                mountainsFore.style.backgroundImage = cachedData.backgroundImage;
                mountainsFore.style.backgroundSize = cachedData.backgroundSize;
            } else {
                // Generate with seeded random for deterministic output
                const rng = this.seededRandom(22222);
                const canvas = document.createElement('canvas');
                canvas.width = 4000;
                canvas.height = 600;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#1a1a1a';
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);

                // Create sharper, darker peaks
                for (let x = 0; x < canvas.width; x += 15) {
                    const y = canvas.height - (rng() * 400 + 150) - Math.cos(x * 0.015) * 80;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();

                const backgroundImage = `url(${canvas.toDataURL()})`;
                const backgroundSize = '2000px 100%';
                wolfhourBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
                mountainsFore.style.backgroundImage = backgroundImage;
                mountainsFore.style.backgroundSize = backgroundSize;
            }
        }
    }

    stop() {
        // Clear shooting star interval
        if (this.shootingStarInterval) {
            clearInterval(this.shootingStarInterval);
            this.shootingStarInterval = null;
        }

        super.stop();
    }
}
