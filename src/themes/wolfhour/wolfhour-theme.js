/**
 * @fileoverview Wolfhour Theme - Mystical nighttime scene with stars, nebula, and cosmic elements
 */

import { BaseTheme } from '../base-theme.js';
import { wolfhourBackgroundCache } from '../../utils/cache.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

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

        // Gameplay effect state
        this.comboMultiplier = 1.0;
        this.cosmicEnergy = 0;
        this.wolfhourPower = 0;

        // Effect containers
        this.starBursts = [];
        this.cosmicWaves = [];
        this.celestialBeams = [];
        this.moonGlowPulses = [];
        this.constellationLines = [];

        // Canvas for effects
        this.effectCanvas = null;
        this.effectCtx = null;

        // Animation
        this.animationTime = 0;
        this.animationFrameId = null;
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

        // 7. Setup gameplay effects canvas
        this.setupEffectsCanvas();

        // 8. Setup event listeners for gameplay
        this.setupGameplayEvents();

        // 9. Start animation loop
        this.startAnimation();
    }

    setupEffectsCanvas() {
        const themeContainer = document.getElementById('wolfhour-theme');
        if (!themeContainer) {
            console.warn('[Wolfhour] Theme container not found');
            return;
        }

        // Create or get canvas for effects
        this.effectCanvas = document.getElementById('wolfhour-effects-canvas');
        if (!this.effectCanvas) {
            this.effectCanvas = document.createElement('canvas');
            this.effectCanvas.id = 'wolfhour-effects-canvas';
            this.effectCanvas.style.position = 'absolute';
            this.effectCanvas.style.top = '0';
            this.effectCanvas.style.left = '0';
            this.effectCanvas.style.width = '100%';
            this.effectCanvas.style.height = '100%';
            this.effectCanvas.style.pointerEvents = 'none';
            this.effectCanvas.style.zIndex = '10';
            themeContainer.appendChild(this.effectCanvas);
            console.log('[Wolfhour] Effects canvas created');
        }

        this.effectCanvas.width = window.innerWidth;
        this.effectCanvas.height = window.innerHeight;
        this.effectCtx = this.effectCanvas.getContext('2d', {
            alpha: true,
            desynchronized: true,
        });

        console.log('[Wolfhour] Canvas size:', this.effectCanvas.width, 'x', this.effectCanvas.height);

        // Handle resize
        const resizeHandler = () => {
            if (this.effectCanvas) {
                this.effectCanvas.width = window.innerWidth;
                this.effectCanvas.height = window.innerHeight;
            }
        };
        window.addEventListener('resize', resizeHandler);
    }

    setupGameplayEvents() {
        eventBus.on(EVENTS.LINE_CLEAR, this.onLineClear.bind(this));
        eventBus.on(EVENTS.COMBO, this.onCombo.bind(this));
        console.log('[Wolfhour] Gameplay events registered');
    }

    onLineClear(lineCount) {
        console.log('[Wolfhour] Line clear:', lineCount);

        if (!this.effectCanvas || !this.effectCtx) {
            console.warn('[Wolfhour] Effect canvas not ready');
            return;
        }

        // Increase cosmic energy
        this.cosmicEnergy = Math.min(this.cosmicEnergy + lineCount * 0.2, 1.5);

        // Create star bursts from cleared lines
        for (let i = 0; i < lineCount * 3; i++) {
            this.createStarBurst();
        }

        // Trigger shooting stars
        for (let i = 0; i < lineCount; i++) {
            this.triggerShootingStar();
        }

        // Intensify nebula glow
        this.intensifyNebula(lineCount);

        console.log('[Wolfhour] Star bursts:', this.starBursts.length);
    }

    onCombo(comboCount) {
        console.log('[Wolfhour] Combo:', comboCount);

        if (!this.effectCanvas || !this.effectCtx) {
            console.warn('[Wolfhour] Effect canvas not ready');
            return;
        }

        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.wolfhourPower = Math.min(this.wolfhourPower + comboCount * 0.15, 2.0);

        // Create cosmic waves that ripple across sky
        if (comboCount >= 2) {
            for (let i = 0; i < Math.min(comboCount, 4); i++) {
                this.createCosmicWave();
            }
        }

        // Create celestial beams from the heavens
        if (comboCount >= 3) {
            for (let i = 0; i < Math.min(comboCount - 2, 3); i++) {
                this.createCelestialBeam();
            }
        }

        // Pulse the moon
        if (comboCount >= 4) {
            this.createMoonPulse(comboCount);
        }

        // Draw constellation lines between stars
        if (comboCount >= 5) {
            this.createConstellationLines(comboCount);
        }

        // Make all stars twinkle more intensely
        this.intensifyStars(comboCount);

        console.log('[Wolfhour] Effects created - Waves:', this.cosmicWaves.length, 'Beams:', this.celestialBeams.length);
    }

    createStarBurst() {
        const x = Math.random() * this.effectCanvas.width;
        const y = Math.random() * this.effectCanvas.height * 0.7; // Upper 70% of screen

        this.starBursts.push({
            x,
            y,
            particles: this.createBurstParticles(x, y, 12),
            life: 1.0,
            decay: 0.015,
        });
    }

    createBurstParticles(cx, cy, count) {
        const particles = [];
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
            const speed = Math.random() * 3 + 2;

            particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 3 + 1,
                hue: Math.random() * 60 + 180, // Cyan to blue
                brightness: Math.random() * 30 + 70,
            });
        }
        return particles;
    }

    createCosmicWave() {
        const startX = Math.random() * this.effectCanvas.width;
        const startY = Math.random() * this.effectCanvas.height * 0.5;

        this.cosmicWaves.push({
            x: startX,
            y: startY,
            radius: 0,
            maxRadius: 300 + Math.random() * 200,
            thickness: 3,
            opacity: 0.8,
            hue: Math.random() * 40 + 200, // Blue-cyan range
            growthRate: 4,
        });
    }

    createCelestialBeam() {
        const x = Math.random() * this.effectCanvas.width;
        const width = Math.random() * 40 + 30;

        this.celestialBeams.push({
            x,
            y: -50,
            width,
            length: 0,
            maxLength: this.effectCanvas.height + 100,
            opacity: 0.7,
            hue: Math.random() * 30 + 190,
            growthRate: 15,
            life: 1.0,
            decay: 0.008,
        });
    }

    createMoonPulse(intensity) {
        // Create expanding ring from moon position (top center)
        this.moonGlowPulses.push({
            x: this.effectCanvas.width / 2,
            y: this.effectCanvas.height * 0.15,
            radius: 50,
            maxRadius: 300 + intensity * 50,
            opacity: 0.6,
            growthRate: 3,
            hue: 200,
        });
    }

    createConstellationLines(comboCount) {
        // Connect random stars with mystical lines
        const stars = document.querySelectorAll('.wolfhour-star');
        if (stars.length < 2) return;

        const lineCount = Math.min(comboCount * 2, 15);
        const starArray = Array.from(stars);

        for (let i = 0; i < lineCount; i++) {
            const star1 = starArray[Math.floor(Math.random() * starArray.length)];
            const star2 = starArray[Math.floor(Math.random() * starArray.length)];

            if (star1 === star2) continue;

            const rect1 = star1.getBoundingClientRect();
            const rect2 = star2.getBoundingClientRect();

            this.constellationLines.push({
                x1: rect1.left + rect1.width / 2,
                y1: rect1.top + rect1.height / 2,
                x2: rect2.left + rect2.width / 2,
                y2: rect2.top + rect2.height / 2,
                opacity: 0.6,
                life: 1.0,
                decay: 0.01,
                hue: Math.random() * 40 + 180,
            });
        }
    }

    triggerShootingStar() {
        const starsContainer = document.getElementById('wolfhour-stars');
        if (!starsContainer) return;

        const shootingStar = document.createElement('div');
        shootingStar.className = 'wolfhour-shooting-star';
        shootingStar.style.left = `${Math.random() * 100}%`;
        shootingStar.style.top = `${Math.random() * 40}%`;
        const distance = Math.random() * 300 + 200;
        shootingStar.style.setProperty('--shoot-x', `${-distance}px`);
        shootingStar.style.setProperty('--shoot-y', `${distance}px`);
        shootingStar.style.setProperty('--shoot-duration', `${Math.random() * 0.8 + 1}s`);

        // Enhanced brightness for gameplay triggered stars
        shootingStar.style.opacity = '1';
        shootingStar.style.filter = `brightness(${1.5 + this.comboMultiplier * 0.5})`;

        starsContainer.appendChild(shootingStar);
        setTimeout(() => shootingStar.remove(), 2000);
    }

    intensifyNebula(lineCount) {
        const nebulaBack = document.getElementById('wolfhour-nebula-back');
        const nebulaMid = document.getElementById('wolfhour-nebula-mid');

        const intensity = 1 + lineCount * 0.15 * this.comboMultiplier;

        if (nebulaBack) {
            nebulaBack.style.filter = `brightness(${intensity}) saturate(${1 + lineCount * 0.1})`;
            setTimeout(() => {
                nebulaBack.style.filter = '';
            }, 800);
        }

        if (nebulaMid) {
            nebulaMid.style.filter = `brightness(${intensity}) saturate(${1 + lineCount * 0.1})`;
            setTimeout(() => {
                nebulaMid.style.filter = '';
            }, 800);
        }
    }

    intensifyStars(comboCount) {
        const stars = document.querySelectorAll('.wolfhour-star');
        const intensity = Math.min(comboCount * 0.2, 1.5);

        stars.forEach((star) => {
            star.style.filter = `brightness(${1 + intensity})`;
            setTimeout(() => {
                star.style.filter = '';
            }, 600);
        });
    }

    startAnimation() {
        const animate = () => {
            // Don't stop animation, just don't process if not active
            if (!this.effectCtx || !this.effectCanvas) {
                this.animationFrameId = requestAnimationFrame(animate);
                return;
            }

            this.animationTime += 0.016;

            // Decay energy over time
            if (this.cosmicEnergy > 0) {
                this.cosmicEnergy *= 0.99;
            }
            if (this.wolfhourPower > 0) {
                this.wolfhourPower *= 0.985;
            }
            if (this.comboMultiplier > 1) {
                this.comboMultiplier = Math.max(1, this.comboMultiplier - 0.008);
            }

            // Clear canvas with transparent fill
            this.effectCtx.clearRect(0, 0, this.effectCanvas.width, this.effectCanvas.height);

            // Draw all effects
            this.drawStarBursts();
            this.drawCosmicWaves();
            this.drawCelestialBeams();
            this.drawMoonPulses();
            this.drawConstellationLines();

            this.animationFrameId = requestAnimationFrame(animate);
        };

        console.log('[Wolfhour] Starting animation loop');
        animate();
    }

    drawStarBursts() {
        for (let i = this.starBursts.length - 1; i >= 0; i--) {
            const burst = this.starBursts[i];

            burst.life -= burst.decay;

            if (burst.life <= 0) {
                this.starBursts.splice(i, 1);
                continue;
            }

            // Update and draw particles
            burst.particles.forEach((p) => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.1; // Gravity

                const opacity = burst.life * 0.8;

                this.effectCtx.beginPath();
                this.effectCtx.arc(p.x, p.y, p.size * burst.life, 0, Math.PI * 2);
                this.effectCtx.fillStyle = `hsla(${p.hue}, 80%, ${p.brightness}%, ${opacity})`;
                this.effectCtx.fill();

                // Add glow
                this.effectCtx.shadowBlur = 15 * burst.life;
                this.effectCtx.shadowColor = `hsla(${p.hue}, 80%, ${p.brightness}%, ${opacity * 0.8})`;
            });

            this.effectCtx.shadowBlur = 0;
        }
    }

    drawCosmicWaves() {
        for (let i = this.cosmicWaves.length - 1; i >= 0; i--) {
            const wave = this.cosmicWaves[i];

            wave.radius += wave.growthRate;
            wave.opacity *= 0.97;

            if (wave.radius >= wave.maxRadius || wave.opacity < 0.05) {
                this.cosmicWaves.splice(i, 1);
                continue;
            }

            // Draw expanding ring with gradient
            const gradient = this.effectCtx.createRadialGradient(wave.x, wave.y, wave.radius - 5, wave.x, wave.y, wave.radius + 5);
            gradient.addColorStop(0, `hsla(${wave.hue}, 70%, 60%, 0)`);
            gradient.addColorStop(0.5, `hsla(${wave.hue}, 80%, 70%, ${wave.opacity})`);
            gradient.addColorStop(1, `hsla(${wave.hue}, 70%, 60%, 0)`);

            this.effectCtx.strokeStyle = gradient;
            this.effectCtx.lineWidth = wave.thickness;
            this.effectCtx.beginPath();
            this.effectCtx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
            this.effectCtx.stroke();
        }
    }

    drawCelestialBeams() {
        for (let i = this.celestialBeams.length - 1; i >= 0; i--) {
            const beam = this.celestialBeams[i];

            if (beam.length < beam.maxLength) {
                beam.length += beam.growthRate;
            } else {
                beam.life -= beam.decay;
            }

            if (beam.life <= 0) {
                this.celestialBeams.splice(i, 1);
                continue;
            }

            const opacity = beam.opacity * beam.life;

            // Draw beam with gradient
            const gradient = this.effectCtx.createLinearGradient(beam.x, beam.y, beam.x, beam.y + beam.length);
            gradient.addColorStop(0, `hsla(${beam.hue}, 80%, 80%, ${opacity})`);
            gradient.addColorStop(0.3, `hsla(${beam.hue}, 70%, 70%, ${opacity * 0.8})`);
            gradient.addColorStop(1, `hsla(${beam.hue}, 60%, 50%, 0)`);

            this.effectCtx.fillStyle = gradient;
            this.effectCtx.fillRect(beam.x - beam.width / 2, beam.y, beam.width, beam.length);

            // Add glow
            this.effectCtx.shadowBlur = 30;
            this.effectCtx.shadowColor = `hsla(${beam.hue}, 80%, 70%, ${opacity * 0.6})`;
        }

        this.effectCtx.shadowBlur = 0;
    }

    drawMoonPulses() {
        for (let i = this.moonGlowPulses.length - 1; i >= 0; i--) {
            const pulse = this.moonGlowPulses[i];

            pulse.radius += pulse.growthRate;
            pulse.opacity *= 0.96;

            if (pulse.radius >= pulse.maxRadius || pulse.opacity < 0.05) {
                this.moonGlowPulses.splice(i, 1);
                continue;
            }

            // Draw soft expanding glow
            const gradient = this.effectCtx.createRadialGradient(
                pulse.x,
                pulse.y,
                pulse.radius - 20,
                pulse.x,
                pulse.y,
                pulse.radius + 20,
            );
            gradient.addColorStop(0, `hsla(${pulse.hue}, 60%, 80%, 0)`);
            gradient.addColorStop(0.5, `hsla(${pulse.hue}, 70%, 85%, ${pulse.opacity})`);
            gradient.addColorStop(1, `hsla(${pulse.hue}, 60%, 80%, 0)`);

            this.effectCtx.fillStyle = gradient;
            this.effectCtx.beginPath();
            this.effectCtx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
            this.effectCtx.fill();
        }
    }

    drawConstellationLines() {
        for (let i = this.constellationLines.length - 1; i >= 0; i--) {
            const line = this.constellationLines[i];

            line.life -= line.decay;

            if (line.life <= 0) {
                this.constellationLines.splice(i, 1);
                continue;
            }

            const opacity = line.opacity * line.life;

            // Draw mystical connecting line
            this.effectCtx.strokeStyle = `hsla(${line.hue}, 70%, 70%, ${opacity})`;
            this.effectCtx.lineWidth = 2;
            this.effectCtx.beginPath();
            this.effectCtx.moveTo(line.x1, line.y1);
            this.effectCtx.lineTo(line.x2, line.y2);
            this.effectCtx.stroke();

            // Add glow to line
            this.effectCtx.shadowBlur = 8;
            this.effectCtx.shadowColor = `hsla(${line.hue}, 80%, 80%, ${opacity * 0.6})`;
            this.effectCtx.stroke();
        }

        this.effectCtx.shadowBlur = 0;
    }

    stop() {
        // Clear shooting star interval
        if (this.shootingStarInterval) {
            clearInterval(this.shootingStarInterval);
            this.shootingStarInterval = null;
        }

        // Stop animation
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Clear all effect arrays
        this.starBursts = [];
        this.cosmicWaves = [];
        this.celestialBeams = [];
        this.moonGlowPulses = [];
        this.constellationLines = [];

        // Reset state
        this.comboMultiplier = 1.0;
        this.cosmicEnergy = 0;
        this.wolfhourPower = 0;
        this.animationTime = 0;

        super.stop();
    }
}
