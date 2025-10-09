/**
 * @fileoverview Lunara Theme - Mystical winter scene with twin planets, aurora, and snowy forests
 */

import { BaseTheme } from '../base-theme.js';
import { lunaraBackgroundCache } from '../../utils/cache.js';

/**
 * Lunara Theme
 * Features:
 * - Twinkling starfield
 * - Aurora-like streaks
 * - Twin planets (purple and pink) with glow effects
 * - Distant and mid-ground purple mountains
 * - Snow-covered pine trees on both sides
 */
export default class LunaraTheme extends BaseTheme {
    constructor() {
        super('lunara');
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // 1. Create twinkling stars
        const starsContainer = this.getContainer('lunara-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            const starCount = 200;
            for (let i = 0; i < starCount; i++) {
                const star = document.createElement('div');
                star.className = 'lunara-star';
                const size = Math.random() * 2 + 0.5;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 100}%`;
                star.style.setProperty('--twinkle-duration', `${Math.random() * 3 + 2}s`);
                star.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);
                starsContainer.appendChild(star);
            }
        }

        // 2. Create aurora-like streaks
        const auroraContainer = this.getContainer('lunara-aurora');
        if (auroraContainer && auroraContainer.children.length === 0) {
            const auroraCount = 5;
            for (let i = 0; i < auroraCount; i++) {
                const aurora = document.createElement('div');
                aurora.className = 'lunara-aurora';
                aurora.style.left = `${Math.random() * 100}%`;
                aurora.style.top = `${Math.random() * 40}%`;
                aurora.style.setProperty('--aurora-duration', `${Math.random() * 10 + 15}s`);
                aurora.style.setProperty('--aurora-delay', `${Math.random() * 5}s`);
                auroraContainer.appendChild(aurora);
            }
        }

        // 3. Create twin planets with glow
        const planetsContainer = this.getContainer('lunara-planets');
        if (planetsContainer && planetsContainer.children.length === 0) {
            const cacheKey = 'lunara-planets-canvas';

            if (lunaraBackgroundCache.has(cacheKey)) {
                planetsContainer.style.backgroundImage = lunaraBackgroundCache.get(cacheKey);
            } else {
                const canvas = document.createElement('canvas');
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                const ctx = canvas.getContext('2d');

                // Large purple planet
                const planet1X = canvas.width * 0.35;
                const planet1Y = canvas.height * 0.25;
                const planet1Radius = Math.min(canvas.width, canvas.height) * 0.2;

                // Draw glow
                const glow1 = ctx.createRadialGradient(planet1X, planet1Y, planet1Radius * 0.8, planet1X, planet1Y, planet1Radius * 1.5);
                glow1.addColorStop(0, 'rgba(200, 150, 255, 0.3)');
                glow1.addColorStop(1, 'rgba(200, 150, 255, 0)');
                ctx.fillStyle = glow1;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw planet
                const planet1Grad = ctx.createRadialGradient(planet1X - planet1Radius * 0.3, planet1Y - planet1Radius * 0.3, planet1Radius * 0.2, planet1X, planet1Y, planet1Radius);
                planet1Grad.addColorStop(0, '#d8b5ff');
                planet1Grad.addColorStop(0.5, '#a855f7');
                planet1Grad.addColorStop(1, '#6b21a8');
                ctx.fillStyle = planet1Grad;
                ctx.beginPath();
                ctx.arc(planet1X, planet1Y, planet1Radius, 0, Math.PI * 2);
                ctx.fill();

                // Smaller pink planet
                const planet2X = canvas.width * 0.5;
                const planet2Y = canvas.height * 0.2;
                const planet2Radius = Math.min(canvas.width, canvas.height) * 0.12;

                // Draw glow
                const glow2 = ctx.createRadialGradient(planet2X, planet2Y, planet2Radius * 0.8, planet2X, planet2Y, planet2Radius * 1.5);
                glow2.addColorStop(0, 'rgba(255, 200, 240, 0.3)');
                glow2.addColorStop(1, 'rgba(255, 200, 240, 0)');
                ctx.fillStyle = glow2;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw planet
                const planet2Grad = ctx.createRadialGradient(planet2X - planet2Radius * 0.3, planet2Y - planet2Radius * 0.3, planet2Radius * 0.2, planet2X, planet2Y, planet2Radius);
                planet2Grad.addColorStop(0, '#ffd4f0');
                planet2Grad.addColorStop(0.5, '#f472b6');
                planet2Grad.addColorStop(1, '#be185d');
                ctx.fillStyle = planet2Grad;
                ctx.beginPath();
                ctx.arc(planet2X, planet2Y, planet2Radius, 0, Math.PI * 2);
                ctx.fill();

                const dataURL = `url(${canvas.toDataURL()})`;
                lunaraBackgroundCache.set(cacheKey, dataURL);
                planetsContainer.style.backgroundImage = dataURL;
            }
        }

        // 4. Create distant mountains with caching
        const mountainsDistant = this.getContainer('lunara-mountains-distant');
        if (mountainsDistant) {
            const cacheKey = 'lunara-mountains-distant-3000x600';

            if (lunaraBackgroundCache.has(cacheKey)) {
                const cachedData = lunaraBackgroundCache.get(cacheKey);
                mountainsDistant.style.backgroundImage = cachedData.backgroundImage;
                mountainsDistant.style.backgroundSize = cachedData.backgroundSize;
            } else {
                const rng = this.seededRandom(33333);
                const canvas = document.createElement('canvas');
                canvas.width = 3000;
                canvas.height = 600;
                const ctx = canvas.getContext('2d');

                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#b794f6');
                gradient.addColorStop(1, '#9f7aea');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);

                for (let x = 0; x < canvas.width; x += 30) {
                    const y = canvas.height - (rng() * 200 + 150) - Math.sin(x * 0.008) * 80;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();

                const backgroundImage = `url(${canvas.toDataURL()})`;
                const backgroundSize = '150% 100%';
                lunaraBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
                mountainsDistant.style.backgroundImage = backgroundImage;
                mountainsDistant.style.backgroundSize = backgroundSize;
            }
        }

        // 5. Create mid-ground mountains
        const mountainsMid = this.getContainer('lunara-mountains-mid');
        if (mountainsMid) {
            const cacheKey = 'lunara-mountains-mid-3000x700';

            if (lunaraBackgroundCache.has(cacheKey)) {
                const cachedData = lunaraBackgroundCache.get(cacheKey);
                mountainsMid.style.backgroundImage = cachedData.backgroundImage;
                mountainsMid.style.backgroundSize = cachedData.backgroundSize;
            } else {
                const rng = this.seededRandom(44444);
                const canvas = document.createElement('canvas');
                canvas.width = 3000;
                canvas.height = 700;
                const ctx = canvas.getContext('2d');

                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#9f7aea');
                gradient.addColorStop(1, '#7c3aed');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);

                for (let x = 0; x < canvas.width; x += 25) {
                    const y = canvas.height - (rng() * 300 + 200) - Math.cos(x * 0.01) * 100;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();

                const backgroundImage = `url(${canvas.toDataURL()})`;
                const backgroundSize = '150% 100%';
                lunaraBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
                mountainsMid.style.backgroundImage = backgroundImage;
                mountainsMid.style.backgroundSize = backgroundSize;
            }
        }

        // 6. Create snow-covered pine trees (left side)
        const forestLeft = this.getContainer('lunara-forest-left');
        if (forestLeft && forestLeft.children.length === 0) {
            const treeCount = 8;
            for (let i = 0; i < treeCount; i++) {
                const tree = document.createElement('div');
                tree.className = 'lunara-tree';
                const height = Math.random() * 200 + 250;
                tree.style.height = `${height}px`;
                tree.style.left = `${i * 12}%`;
                tree.style.bottom = '0';
                tree.style.setProperty('--sway-duration', `${Math.random() * 3 + 4}s`);
                tree.style.setProperty('--sway-delay', `${Math.random() * 2}s`);
                forestLeft.appendChild(tree);
            }
        }

        // 7. Create snow-covered pine trees (right side)
        const forestRight = this.getContainer('lunara-forest-right');
        if (forestRight && forestRight.children.length === 0) {
            const treeCount = 8;
            for (let i = 0; i < treeCount; i++) {
                const tree = document.createElement('div');
                tree.className = 'lunara-tree';
                const height = Math.random() * 200 + 250;
                tree.style.height = `${height}px`;
                tree.style.right = `${i * 12}%`;
                tree.style.bottom = '0';
                tree.style.setProperty('--sway-duration', `${Math.random() * 3 + 4}s`);
                tree.style.setProperty('--sway-delay', `${Math.random() * 2}s`);
                forestRight.appendChild(tree);
            }
        }
    }
}
