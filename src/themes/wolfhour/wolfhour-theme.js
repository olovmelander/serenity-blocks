/**
 * @fileoverview Wolfhour Theme - Mystical nighttime scene with stars, nebula, and cosmic elements
 */

import { BaseTheme } from '../base-theme.js';
import { wolfhourBackgroundCache } from '../../utils/cache.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { WOLFHOUR_TETROMINOS } from './wolfhour-tetrominos.js';
import WebGLWolfRenderer from './webgl-wolf-renderer.js';

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
        this.starRipples = [];
        this.novaFlashes = [];
        this.sparkles = [];
        this.cachedStarElements = [];

        // Canvas for effects
        this.effectCanvas = null;
        this.effectCtx = null;

        // Separate canvas for celestial beams (between mountain layers)
        this.beamsCanvas = null;
        this.beamsCtx = null;

        // WebGL Renderer
        this.webglCanvas = null;
        this.webglRenderer = null;
        this.useWebGL = true;
        this.stars = []; // Data model for WebGL stars

        // Animation
        this.animationTime = 0;
        this.animationFrameId = null;
        this.frameCount = 0;

        // Event tracking
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        // Performance optimizations
        this.cachedStarPositions = [];
        this.starPositionsCacheTime = 0;
        this.lastEffectCleanup = 0;

        // Cached DOM references for performance
        this.cachedDOMElements = {
            mountainsDistant: null,
            mountainsFore: null,
            nebulaBack: null,
            nebulaMid: null,
            starsContainer: null,
        };

        // Frame rate tracking for adaptive performance
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.averageFrameTime = 16.67; // Target 60 FPS

        // Quality presets - current settings are considered Ultra
        this.qualityPresets = {
            Minimal: {
                starCount: 25,
                webglStarCount: 2000,
                shootingStarInterval: 20000,
                lightRayCount: 3,
                cosmicRiftCount: 1,
                spiritCount: 1,
                nebulaBackBlobs: 10,
                nebulaMidBlobs: 8,
                maxStarBursts: 4,
                maxCosmicWaves: 2,
                maxCelestialBeams: 0,
                maxMoonPulses: 0,
                maxConstellationLines: 0,
                enableConstellationLines: false,
                enableMoonPulses: false,
                enableCelestialBeams: false,
                starBurstParticles: 4,
                burstCountMultiplier: 0.5, // lineCount * 0.5
                shootingStarMultiplier: 0.25, // lineCount * 0.25
                useShadows: false,
                useComplexGradients: false,
                waveRingCount: 1,
                effectUpdateInterval: 3, // Update effects every 3 frames
            },
            Low: {
                starCount: 50,
                webglStarCount: 5000,
                shootingStarInterval: 15000,
                lightRayCount: 6,
                cosmicRiftCount: 3,
                spiritCount: 3,
                nebulaBackBlobs: 20,
                nebulaMidBlobs: 15,
                maxStarBursts: 6,
                maxCosmicWaves: 4,
                maxCelestialBeams: 0,
                maxMoonPulses: 0,
                maxConstellationLines: 0,
                enableConstellationLines: false,
                enableMoonPulses: false,
                enableCelestialBeams: false,
                starBurstParticles: 6,
                burstCountMultiplier: 1, // lineCount * 1
                shootingStarMultiplier: 0.5, // lineCount * 0.5
                useShadows: false,
                useComplexGradients: false,
                waveRingCount: 1,
                effectUpdateInterval: 2, // Update effects every 2 frames
            },
            Medium: {
                starCount: 80,
                webglStarCount: 10000,
                shootingStarInterval: 12000,
                lightRayCount: 8,
                cosmicRiftCount: 5,
                spiritCount: 4,
                nebulaBackBlobs: 30,
                nebulaMidBlobs: 20,
                maxStarBursts: 10,
                maxCosmicWaves: 6,
                maxCelestialBeams: 3,
                maxMoonPulses: 4,
                maxConstellationLines: 4,
                enableConstellationLines: true,
                enableMoonPulses: true,
                enableCelestialBeams: false,
                starBurstParticles: 8,
                burstCountMultiplier: 1.5, // lineCount * 1.5
                shootingStarMultiplier: 0.75, // lineCount * 0.75
                useShadows: false,
                useComplexGradients: false,
                waveRingCount: 2,
                effectUpdateInterval: 1, // Update every frame
            },
            High: {
                starCount: 120,
                webglStarCount: 20000,
                shootingStarInterval: 10000,
                lightRayCount: 10,
                cosmicRiftCount: 6,
                spiritCount: 5,
                nebulaBackBlobs: 40,
                nebulaMidBlobs: 30,
                maxStarBursts: 15,
                maxCosmicWaves: 10,
                maxCelestialBeams: 5,
                maxMoonPulses: 6,
                maxConstellationLines: 6,
                enableConstellationLines: true,
                enableMoonPulses: true,
                enableCelestialBeams: true,
                starBurstParticles: 10,
                burstCountMultiplier: 2, // lineCount * 2
                shootingStarMultiplier: 1, // lineCount * 1
                useShadows: true,
                useComplexGradients: true,
                waveRingCount: 2,
                effectUpdateInterval: 1, // Update every frame
            },
            Ultra: {
                starCount: 150,
                webglStarCount: 40000,
                shootingStarInterval: 8000,
                lightRayCount: 12,
                cosmicRiftCount: 8,
                spiritCount: 6,
                nebulaBackBlobs: 50,
                nebulaMidBlobs: 40,
                maxStarBursts: 20,
                maxCosmicWaves: 12,
                maxCelestialBeams: 8,
                maxMoonPulses: 8,
                maxConstellationLines: 8,
                enableConstellationLines: true,
                enableMoonPulses: true,
                enableCelestialBeams: true,
                starBurstParticles: 12,
                burstCountMultiplier: 2, // lineCount * 2 (current)
                shootingStarMultiplier: 1, // lineCount * 1 (current)
                useShadows: true,
                useComplexGradients: true,
                waveRingCount: 3,
                effectUpdateInterval: 1, // Update every frame
            },
            Extreme: {
                starCount: 200,
                webglStarCount: 80000,
                shootingStarInterval: 5000,
                lightRayCount: 15,
                cosmicRiftCount: 10,
                spiritCount: 8,
                nebulaBackBlobs: 60,
                nebulaMidBlobs: 50,
                maxStarBursts: 25,
                maxCosmicWaves: 15,
                maxCelestialBeams: 10,
                maxMoonPulses: 10,
                maxConstellationLines: 10,
                enableConstellationLines: true,
                enableMoonPulses: true,
                enableCelestialBeams: true,
                starBurstParticles: 15,
                burstCountMultiplier: 2.5, // lineCount * 2.5
                shootingStarMultiplier: 1.5, // lineCount * 1.5
                useShadows: true,
                useComplexGradients: true,
                waveRingCount: 4,
                effectUpdateInterval: 1, // Update every frame
            },
        };

        // Active quality preset
        this.activeQuality = this.qualityPresets.Ultra;
        this.qualityListener = null;

        // Performance throttling helpers
        this.comboEffectCooldownMs = 320;
        this.lastComboEffectTime = 0;
        this.constellationCooldownMs = 700;
        this.lastConstellationTime = 0;
        this.starPositionsCacheDuration = 1000;
        this.starBoostTimeout = null;
        this.lastStarBoostTime = 0;
        this.mountainGlowCooldownMs = 350;
        this.lastMountainGlowTime = 0;
        this.mountainGlowTimeoutDistant = null;
        this.mountainGlowTimeoutFore = null;
    }

    getTetrominoConfig() {
        return WOLFHOUR_TETROMINOS;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'Ultra';
    }

    applyQualityPreset() {
        const quality = this.getGraphicsQuality();
        this.activeQuality = this.qualityPresets[quality] || this.qualityPresets.Ultra;

        // Trim effect collections to match new limits
        this.trimEffectCollections();

        // Restart shooting star interval with new timing
        this.restartShootingStarInterval();
    }

    setupQualityListener() {
        this.qualityListener = (event) => {
            if (event.detail?.effectQuality !== undefined) {
                this.applyQualityPreset();
            }
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('settingsChanged', this.qualityListener);
        }
    }

    teardownQualityListener() {
        if (this.qualityListener && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityListener);
            this.qualityListener = null;
        }
    }

    trimEffectCollections() {
        // Trim effect arrays to match quality limits
        if (this.starBursts.length > this.activeQuality.maxStarBursts) {
            this.starBursts = this.starBursts.slice(0, this.activeQuality.maxStarBursts);
        }
        if (this.cosmicWaves.length > this.activeQuality.maxCosmicWaves) {
            this.cosmicWaves = this.cosmicWaves.slice(0, this.activeQuality.maxCosmicWaves);
        }
        if (this.celestialBeams.length > this.activeQuality.maxCelestialBeams) {
            this.celestialBeams = this.celestialBeams.slice(0, this.activeQuality.maxCelestialBeams);
        }
        if (this.moonGlowPulses.length > this.activeQuality.maxMoonPulses) {
            this.moonGlowPulses = this.moonGlowPulses.slice(0, this.activeQuality.maxMoonPulses);
        }
        if (this.constellationLines.length > this.activeQuality.maxConstellationLines) {
            this.constellationLines = this.constellationLines.slice(0, this.activeQuality.maxConstellationLines);
        }
        // New effects
        if (this.starRipples.length > 5) this.starRipples = this.starRipples.slice(0, 5);
        if (this.novaFlashes.length > 3) this.novaFlashes = this.novaFlashes.slice(0, 3);
        if (this.sparkles.length > 100) this.sparkles = this.sparkles.slice(0, 100);
    }

    restartShootingStarInterval() {
        // Clear existing interval
        if (this.shootingStarInterval) {
            clearInterval(this.shootingStarInterval);
            this.shootingStarInterval = null;
        }

        // Only restart if theme is active
        if (!this.isActive) return;

        const starsContainer = document.getElementById('wolfhour-stars');
        if (!starsContainer) return;

        // Create new interval with quality-based timing
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
        }, this.activeQuality.shootingStarInterval);
    }

    initWebGLRenderer() {
        const themeContainer = document.getElementById('wolfhour-theme');
        if (!themeContainer) return;

        try {
            // Remove existing canvas if any
            const existingCanvas = document.getElementById('wolfhour-webgl-canvas');
            if (existingCanvas) existingCanvas.remove();

            this.webglCanvas = document.createElement('canvas');
            this.webglCanvas.id = 'wolfhour-webgl-canvas';
            Object.assign(this.webglCanvas.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: '2', // Above sky (1), below nebula/mountains
            });

            themeContainer.insertBefore(this.webglCanvas, themeContainer.firstChild);

            this.webglRenderer = new WebGLWolfRenderer(this.webglCanvas);

            if (this.webglRenderer.init()) {
                // Silver/Cool White Palette
                const starColors = [
                    '#ffffff', // Pure white
                    '#e0e0ff', // Blueish white
                    '#d0d0e0', // Silver
                    '#c0c0d0', // Dim silver
                    '#a0a0b0', // Grey
                ];
                this.webglRenderer.setColorPalette(starColors);
                this.webglRenderer.allocateStars(this.activeQuality.webglStarCount);
                this.useWebGL = true;
                console.log(`🐺 Wolfhour: WebGL renderer active (${this.activeQuality.webglStarCount} stars)`);
            } else {
                this.useWebGL = false;
                if (this.webglCanvas) {
                    this.webglCanvas.remove();
                    this.webglCanvas = null;
                }
            }
        } catch (e) {
            console.warn('🐺 Wolfhour: WebGL init failed:', e);
            this.useWebGL = false;
        }
    }

    createWebGLStars() {
        if (!this.useWebGL) return;

        const count = this.activeQuality.webglStarCount;
        const w = window.innerWidth;
        const h = window.innerHeight;

        this.stars = [];
        const starColors = ['#ffffff', '#e0e0ff', '#d0d0e0', '#c0c0d0', '#a0a0b0'];

        for (let i = 0; i < count; i++) {
            this.stars.push({
                x: Math.random() * w,
                y: Math.random() * h,
                size: 0.5 + Math.random() * 2.5,
                color: starColors[Math.floor(Math.random() * starColors.length)],
                brightness: 0.2 + Math.random() * 0.8,
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: 0.02 + Math.random() * 0.05,
                rippleBoost: 0,
            });
        }

        this.webglRenderer.uploadStars(this.stars);
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // Apply quality preset
        this.applyQualityPreset();

        // Initialize WebGL
        this.initWebGLRenderer();
        if (this.useWebGL) {
            this.webglRenderer.resize(window.innerWidth, window.innerHeight);
            this.createWebGLStars();
        }

        // 1. Create dense star field (quality-based count)
        const starsContainer = this.getContainer('wolfhour-stars');
        if (starsContainer) {
            // Only create DOM stars if WebGL is disabled
            if (!this.useWebGL && starsContainer.children.length === 0) {
                const { starCount } = this.activeQuality;
                this.cachedStarElements = [];
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
                    this.cachedStarElements.push(star);
                }
            }

            // Create shooting stars periodically (quality-based interval)
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
            }, this.activeQuality.shootingStarInterval);
        }

        // 2. Create nebula clouds using canvas (with caching, quality-based)
        const nebulaBack = this.getContainer('wolfhour-nebula-back');
        if (nebulaBack) {
            const quality = this.getGraphicsQuality();
            const cacheKey = `wolfhour-nebula-back-2000x800-${quality}-v3`;

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

                // Create wispy nebula texture (quality-based blob count)
                for (let i = 0; i < this.activeQuality.nebulaBackBlobs; i++) {
                    const x = rng() * canvas.width;
                    const y = rng() * canvas.height;
                    const radius = rng() * 200 + 100;
                    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                    const opacity = rng() * 0.15 + 0.05;
                    gradient.addColorStop(0, `rgba(180, 185, 190, ${opacity})`);
                    gradient.addColorStop(0.5, `rgba(140, 145, 150, ${opacity * 0.5})`);
                    gradient.addColorStop(1, 'rgba(50, 50, 55, 0)');
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
            const quality = this.getGraphicsQuality();
            const cacheKey = `wolfhour-nebula-mid-2000x800-${quality}-v3`;

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

                // Create denser nebula for mid layer (quality-based blob count)
                for (let i = 0; i < this.activeQuality.nebulaMidBlobs; i++) {
                    const x = rng() * canvas.width;
                    const y = rng() * canvas.height;
                    const radius = rng() * 250 + 150;
                    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                    const opacity = rng() * 0.2 + 0.1;
                    gradient.addColorStop(0, `rgba(210, 215, 220, ${opacity})`);
                    gradient.addColorStop(0.5, `rgba(170, 175, 180, ${opacity * 0.6})`);
                    gradient.addColorStop(1, 'rgba(80, 80, 85, 0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }

                const dataURL = `url(${canvas.toDataURL()})`;
                wolfhourBackgroundCache.set(cacheKey, dataURL);
                nebulaMid.style.backgroundImage = dataURL;
            }
        }

        // 3. Create mystical light rays (quality-based count)
        const lightRaysContainer = this.getContainer('wolfhour-light-rays');
        if (lightRaysContainer && lightRaysContainer.children.length === 0) {
            const rayCount = this.activeQuality.lightRayCount;
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

        // 4. Create cosmic rifts (glowing cracks in space, quality-based count)
        const cosmicRiftsContainer = this.getContainer('wolfhour-cosmic-rifts');
        if (cosmicRiftsContainer && cosmicRiftsContainer.children.length === 0) {
            const riftCount = this.activeQuality.cosmicRiftCount;
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

        // 5. Create ethereal spirits (quality-based count)
        const spiritsContainer = this.getContainer('wolfhour-spirits');
        if (spiritsContainer && spiritsContainer.children.length === 0) {
            const { spiritCount } = this.activeQuality;
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
            const cacheKey = 'wolfhour-mountains-distant-4000x800-v3';

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

                ctx.fillStyle = '#303030';
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
            const cacheKey = 'wolfhour-mountains-fore-4000x600-v3';

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

                ctx.fillStyle = '#151515';
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

        // 10. Setup quality change listener
        this.setupQualityListener();
    }

    cacheDOMReferences() {
        // Cache frequently accessed DOM elements to avoid repeated queries
        this.cachedDOMElements.mountainsDistant = document.getElementById('wolfhour-mountains-distant');
        this.cachedDOMElements.mountainsFore = document.getElementById('wolfhour-mountains-fore');
        this.cachedDOMElements.nebulaBack = document.getElementById('wolfhour-nebula-back');
        this.cachedDOMElements.nebulaMid = document.getElementById('wolfhour-nebula-mid');
        this.cachedDOMElements.starsContainer = document.getElementById('wolfhour-stars');
    }

    setupEffectsCanvas() {
        const themeContainer = document.getElementById('wolfhour-theme');
        if (!themeContainer) return;

        // Cache DOM references after scene is created
        this.cacheDOMReferences();

        // Create canvas for celestial beams (between mountain layers)
        this.beamsCanvas = document.getElementById('wolfhour-beams-canvas');
        if (!this.beamsCanvas) {
            this.beamsCanvas = document.createElement('canvas');
            this.beamsCanvas.id = 'wolfhour-beams-canvas';
            this.beamsCanvas.style.position = 'absolute';
            this.beamsCanvas.style.top = '0';
            this.beamsCanvas.style.left = '0';
            this.beamsCanvas.style.width = '100%';
            this.beamsCanvas.style.height = '100%';
            this.beamsCanvas.style.pointerEvents = 'none';
            this.beamsCanvas.style.zIndex = '5'; // Between distant (4) and foreground (6) mountains
            themeContainer.appendChild(this.beamsCanvas);
        }

        this.beamsCanvas.width = window.innerWidth;
        this.beamsCanvas.height = window.innerHeight;
        this.beamsCtx = this.beamsCanvas.getContext('2d', {
            alpha: true,
            desynchronized: true,
        });

        // Create or get canvas for other effects
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
        }

        this.effectCanvas.width = window.innerWidth;
        this.effectCanvas.height = window.innerHeight;
        this.effectCtx = this.effectCanvas.getContext('2d', {
            alpha: true,
            desynchronized: true,
        });

        // Handle resize
        const resizeHandler = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            if (this.effectCanvas) {
                this.effectCanvas.width = w;
                this.effectCanvas.height = h;
            }
            if (this.beamsCanvas) {
                this.beamsCanvas.width = w;
                this.beamsCanvas.height = h;
            }
            if (this.useWebGL && this.webglRenderer) {
                this.webglRenderer.resize(w, h);
            }
        };
        window.addEventListener('resize', resizeHandler);
    }

    setupGameplayEvents() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handlePieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    handleLineClear(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        this.onLineClear(lineCount, comboCount);
    }

    handleCombo(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }

        this.onCombo(comboCount);
    }

    handlePieceLock() {
        // Silver Nova & Ripple Effect
        const w = this.effectCanvas ? this.effectCanvas.width : window.innerWidth;
        const h = this.effectCanvas ? this.effectCanvas.height : window.innerHeight;

        // 1. Nova Flash (Silver) - More subtle
        if (this.novaFlashes.length < 3) {
            this.novaFlashes.push({
                x: w * 0.2 + Math.random() * w * 0.6,
                y: h * 0.2 + Math.random() * h * 0.5,
                radius: 0,
                maxRadius: 60 + Math.random() * 60, // Reduced from 100+100
                opacity: 0.5, // Reduced from 1.0
                decay: 0.04, // Faster fade (was 0.03)
                hue: 210, // Silver/Blue
            });
        }

        // 2. Star Ripple (WebGL) - More subtle wave
        // Creates a wave that boosts star brightness
        if (this.starRipples.length < 5) {
            this.starRipples.push({
                x: w * 0.2 + Math.random() * w * 0.6,
                y: h * 0.2 + Math.random() * h * 0.5,
                radius: 0,
                speed: 12 + Math.random() * 8, // Slightly slower
                width: 60 + Math.random() * 40, // Reduced width
                life: 0.7, // Reduced initial intensity
                decay: 0.015, // Faster decay
            });
        }

        // 3. Silver Sparkles - Fewer and smaller
        const sparkleCount = 5 + Math.floor(Math.random() * 8); // Reduced count
        for (let i = 0; i < sparkleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * 4;
            this.sparkles.push({
                x: w * 0.2 + Math.random() * w * 0.6,
                y: h * 0.2 + Math.random() * h * 0.5,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 0.5 + Math.random() * 2, // Reduced size
                opacity: 0.7, // Reduced opacity
                decay: 0.03 + Math.random() * 0.03, // Faster decay
                hue: 200 + Math.random() * 30, // Silver range
            });
        }
    }

    onLineClear(lineCount) {
        if (!this.effectCanvas || !this.effectCtx) return;

        // Increase cosmic energy
        this.cosmicEnergy = Math.min(this.cosmicEnergy + lineCount * 0.2, 1.5);

        // Quality-based burst count
        const burstCount = Math.min(
            Math.floor(lineCount * this.activeQuality.burstCountMultiplier),
            this.activeQuality.maxStarBursts - this.starBursts.length,
        );

        // Create star bursts from cleared lines
        for (let i = 0; i < burstCount; i++) {
            this.createStarBurst(this.comboMultiplier);
        }

        // Trigger shooting stars (quality-based)
        const shootingStarCount = Math.floor(lineCount * this.activeQuality.shootingStarMultiplier);
        for (let i = 0; i < shootingStarCount; i++) {
            this.triggerShootingStar();
        }

        // Intensify nebula glow
        this.intensifyNebula(lineCount);
    }

    onCombo(comboCount) {
        if (!this.effectCanvas || !this.effectCtx) return;

        const throttleEffects = this.shouldThrottleComboEffects();
        const allowHeavyEffects = !throttleEffects;

        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.wolfhourPower = Math.min(this.wolfhourPower + comboCount * 0.15, 2.0);

        // Quality-based wave count (only trigger at combo 2+)
        if (comboCount >= 2) {
            const maxWaves = this.activeQuality.maxCosmicWaves - this.cosmicWaves.length;
            const baseWaveCount = Math.min(Math.floor(comboCount / 2), 3, maxWaves);
            const waveCount = throttleEffects ? Math.min(1, baseWaveCount) : baseWaveCount;
            for (let i = 0; i < waveCount; i++) {
                this.createCosmicWave();
            }
        }

        // Create celestial beams from the heavens (quality-based)
        if (allowHeavyEffects && this.activeQuality.enableCelestialBeams && comboCount >= 4) {
            const maxBeams = this.activeQuality.maxCelestialBeams - this.celestialBeams.length;
            const beamCount = Math.min(Math.floor(comboCount / 2) - 1, 2, maxBeams);
            for (let i = 0; i < beamCount; i++) {
                this.createCelestialBeam();
            }
        }

        // Pulse the moon (quality-based)
        if (allowHeavyEffects && this.activeQuality.enableMoonPulses && comboCount >= 5) {
            if (this.moonGlowPulses.length < this.activeQuality.maxMoonPulses) {
                this.createMoonPulse(comboCount);
            }
        }

        // Draw constellation lines between stars (quality-based)
        if (this.activeQuality.enableConstellationLines && comboCount >= 6) {
            const now = Date.now();
            if (allowHeavyEffects && now - this.lastConstellationTime > this.constellationCooldownMs) {
                this.lastConstellationTime = now;
                this.createConstellationLines(comboCount, throttleEffects);
            }
        }

        // Make all stars twinkle more intensely
        this.intensifyStars(comboCount);

        // Glow mountain tops with silver light
        this.glowMountainTops(comboCount);
    }

    createStarBurst(intensity = 1.0) {
        const x = Math.random() * this.effectCanvas.width;
        const y = Math.random() * this.effectCanvas.height * 0.7; // Upper 70% of screen

        this.starBursts.push({
            x,
            y,
            particles: this.createBurstParticles(x, y, this.activeQuality.starBurstParticles, intensity),
            life: 1.0,
            decay: 0.015,
        });
    }

    createBurstParticles(cx, cy, count, intensity = 1.0) {
        const particles = [];
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
            const speed = Math.random() * 4 + 3;

            particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 4 + 2,
                hue: 210 + Math.random() * 20, // Silver/Cool White
                brightness: Math.random() * 20 + 80,
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
            hue: Math.random() * 30 + 220, // Purple/Blue
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
            hue: Math.random() * 20 + 200, // Cool silver hue (200-220)
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
            hue: 210 + intensity * 10,
        });
    }

    createConstellationLines(comboCount, throttled = false) {
        // Connect random stars with mystical lines (quality-based)

        // Quality-based line count
        const maxLines = this.activeQuality.maxConstellationLines - this.constellationLines.length;
        let lineCount = Math.min(comboCount, this.activeQuality.maxConstellationLines, maxLines);
        if (throttled) {
            lineCount = Math.min(lineCount, 2);
        }
        if (lineCount <= 0) return;

        let getStarPos;
        let starCount;

        if (this.useWebGL && this.stars.length > 0) {
            starCount = this.stars.length;
            getStarPos = (index) => this.stars[index];
        } else {
            // Cache star positions to avoid expensive getBoundingClientRect calls
            const now = Date.now();
            const cacheDuration = throttled ? this.starPositionsCacheDuration * 2 : this.starPositionsCacheDuration;
            const needRefresh = now - this.starPositionsCacheTime > cacheDuration || this.cachedStarPositions.length === 0;

            if (needRefresh) {
                if (throttled && this.cachedStarPositions.length > 0 && now - this.starPositionsCacheTime <= cacheDuration * 1.5) {
                    // Use stale cache to avoid heavy DOM queries during throttling
                } else {
                    const stars = this.cachedStarElements.length > 0
                        ? this.cachedStarElements
                        : Array.from(document.querySelectorAll('.wolfhour-star'));
                    if (stars.length === 0) return;

                    this.cachedStarElements = stars;
                    this.cachedStarPositions = stars.map((star) => {
                        const rect = star.getBoundingClientRect();
                        return {
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2,
                        };
                    });
                    this.starPositionsCacheTime = now;
                }
            }

            if (this.cachedStarPositions.length < 2) return;
            starCount = this.cachedStarPositions.length;
            getStarPos = (index) => this.cachedStarPositions[index];
        }

        for (let i = 0; i < lineCount; i++) {
            // Try to find a valid pair
            let attempts = 0;
            while (attempts < 5) {
                attempts++;
                const idx1 = Math.floor(Math.random() * starCount);
                const idx2 = Math.floor(Math.random() * starCount);

                if (idx1 === idx2) continue;

                const pos1 = getStarPos(idx1);
                const pos2 = getStarPos(idx2);

                // Calculate distance - skip if stars are too far apart (performance)
                const dx = pos2.x - pos1.x;
                const dy = pos2.y - pos1.y;
                const distSq = dx * dx + dy * dy; // Use squared distance to avoid sqrt

                if (distSq > 160000) continue; // 400^2 = 160000

                // Found a good pair
                this.constellationLines.push({
                    x1: pos1.x,
                    y1: pos1.y,
                    x2: pos2.x,
                    y2: pos2.y,
                    opacity: 0.7,
                    life: 1.0,
                    decay: 0.012,
                    hue: Math.random() * 40 + 200,
                });
                break;
            }
        }
    }

    triggerShootingStar() {
        const { starsContainer } = this.cachedDOMElements;
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
        const { nebulaBack } = this.cachedDOMElements;
        const { nebulaMid } = this.cachedDOMElements;

        const intensity = 1 + lineCount * 0.15 * this.comboMultiplier;

        if (nebulaBack) {
            nebulaBack.style.filter = `brightness(${intensity}) saturate(${1 + lineCount * 0.1})`;
            setTimeout(() => {
                if (nebulaBack) nebulaBack.style.filter = '';
            }, 800);
        }

        if (nebulaMid) {
            nebulaMid.style.filter = `brightness(${intensity}) saturate(${1 + lineCount * 0.1})`;
            setTimeout(() => {
                if (nebulaMid) nebulaMid.style.filter = '';
            }, 800);
        }
    }

    intensifyStars(comboCount) {
        const { starsContainer } = this.cachedDOMElements;
        if (!starsContainer) return;

        const now = Date.now();
        if (now - this.lastStarBoostTime < 250) {
            return;
        }
        this.lastStarBoostTime = now;

        const intensity = Math.min(comboCount * 0.2, 1.4);
        const brightness = 1 + intensity;
        const glowSize = 6 + intensity * 6;

        starsContainer.style.filter = `brightness(${brightness}) drop-shadow(0 0 ${glowSize}px rgba(200, 230, 255, ${0.35 + intensity * 0.25}))`;

        if (this.starBoostTimeout) {
            clearTimeout(this.starBoostTimeout);
        }
        this.starBoostTimeout = setTimeout(() => {
            if (this.cachedDOMElements.starsContainer) {
                this.cachedDOMElements.starsContainer.style.filter = '';
            }
            this.starBoostTimeout = null;
        }, 650);
    }

    glowMountainTops(comboCount) {
        const { mountainsDistant } = this.cachedDOMElements;
        const { mountainsFore } = this.cachedDOMElements;
        const now = Date.now();
        if (now - this.lastMountainGlowTime < this.mountainGlowCooldownMs) {
            return;
        }
        this.lastMountainGlowTime = now;

        // Silver glow intensity scales with combo count
        const intensity = Math.min(comboCount * 0.25, 2.0);
        const glowSize = Math.min(6 + comboCount * 1.8, 16);
        const primaryOpacity = 0.45 + intensity * 0.25;
        const secondaryOpacity = 0.35 + intensity * 0.2;
        const brightness = (1 + intensity * 0.18).toFixed(3);

        const silverGlow = `
            brightness(${brightness})
            drop-shadow(0 -${glowSize}px ${glowSize * 1.8}px rgba(233, 235, 255, ${primaryOpacity.toFixed(3)}))
            drop-shadow(0 -${(glowSize * 0.6).toFixed(2)}px ${(glowSize * 1.2).toFixed(2)}px rgba(255, 255, 255, ${secondaryOpacity.toFixed(3)}))
        `.replace(/\s+/g, ' ').trim();

        const applyGlow = (element, duration, timeoutKey) => {
            if (!element) return;
            element.style.transition = 'filter 0.9s ease-out';
            element.style.filter = silverGlow;
            clearTimeout(this[timeoutKey]);
            this[timeoutKey] = setTimeout(() => {
                if (element) {
                    element.style.filter = '';
                }
            }, duration);
        };

        applyGlow(mountainsDistant, 800, 'mountainGlowTimeoutDistant');
        applyGlow(mountainsFore, 900, 'mountainGlowTimeoutFore');
    }

    shouldThrottleComboEffects() {
        const now = Date.now();
        const timeSinceLast = now - this.lastComboEffectTime;
        this.lastComboEffectTime = now;
        return timeSinceLast < this.comboEffectCooldownMs || this.averageFrameTime > 24;
    }

    startAnimation() {
        const animate = (currentTime) => {
            // Don't stop animation, just don't process if not active
            if (!this.effectCtx || !this.effectCanvas || !this.beamsCtx || !this.beamsCanvas) {
                this.animationFrameId = requestAnimationFrame(animate);
                return;
            }

            // Track frame time for performance monitoring
            if (this.lastFrameTime > 0) {
                const frameTime = currentTime - this.lastFrameTime;
                this.frameTimeAccumulator += frameTime;
                this.frameTimeCount++;

                // Calculate average frame time every 30 frames
                if (this.frameTimeCount >= 30) {
                    this.averageFrameTime = this.frameTimeAccumulator / this.frameTimeCount;
                    this.frameTimeAccumulator = 0;
                    this.frameTimeCount = 0;
                }
            }
            this.lastFrameTime = currentTime;

            this.frameCount++;
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

            // Periodic effect cleanup to prevent memory buildup
            const now = Date.now();
            if (now - this.lastEffectCleanup > 5000) {
                this.trimEffectCollections();
                this.lastEffectCleanup = now;
            }

            // Update WebGL Star Ripples
            if (this.useWebGL && this.webglRenderer && this.stars.length > 0) {
                // Reset ripple boost for all stars first (optimization: only if we had ripples)
                // For now, simple reset
                if (this.starRipples.length > 0) {
                    for (let i = 0; i < this.stars.length; i++) {
                        this.stars[i].rippleBoost = 0;
                    }
                }

                // Process ripples
                for (let i = this.starRipples.length - 1; i >= 0; i--) {
                    const ripple = this.starRipples[i];
                    ripple.radius += ripple.speed;
                    ripple.life -= ripple.decay;

                    if (ripple.life <= 0) {
                        this.starRipples.splice(i, 1);
                        continue;
                    }

                    // Apply to stars
                    // Optimization: Spatial grid would be better, but for now brute force is okay for GPU upload
                    // actually, we calculate on CPU then upload. 
                    // To keep 60fps with 40k stars, we need to be careful.
                    // Let's only check stars if we have ripples.

                    const rSq = ripple.radius * ripple.radius;
                    const rOuterSq = (ripple.radius + ripple.width) * (ripple.radius + ripple.width);

                    // Optimization: Only iterate stars if we really need to. 
                    // But we need to reset rippleBoost anyway.
                    // Let's do a single pass over stars if there are ripples.
                }

                if (this.starRipples.length > 0) {
                    const ripples = this.starRipples;
                    for (let i = 0; i < this.stars.length; i++) {
                        const star = this.stars[i];
                        let totalBoost = 0;

                        for (let j = 0; j < ripples.length; j++) {
                            const r = ripples[j];
                            const dx = star.x - r.x;
                            const dy = star.y - r.y;
                            const distSq = dx * dx + dy * dy;

                            const dist = Math.sqrt(distSq);
                            if (dist >= r.radius && dist <= r.radius + r.width) {
                                // Inside ripple ring
                                const relPos = (dist - r.radius) / r.width; // 0 to 1
                                const intensity = Math.sin(relPos * Math.PI) * r.life;
                                totalBoost += intensity * 2.0; // Boost factor
                            }
                        }

                        star.rippleBoost = totalBoost;
                    }
                    this.webglRenderer.updateBrightness(this.stars);
                }
            }

            // Render WebGL stars
            if (this.useWebGL && this.webglRenderer) {
                // Pulse intensity from wolfhourPower or cosmicEnergy
                const pulse = this.wolfhourPower * 0.5;
                this.webglRenderer.render(this.animationTime, pulse, 1.0, 0.05, true);
            }

            // Clear canvases - only if there are effects to draw (performance optimization)
            const hasEffects = this.starBursts.length > 0 || this.cosmicWaves.length > 0
                || this.moonGlowPulses.length > 0 || this.constellationLines.length > 0
                || this.novaFlashes.length > 0 || this.sparkles.length > 0;
            const hasBeams = this.celestialBeams.length > 0;

            if (hasEffects) {
                this.effectCtx.clearRect(0, 0, this.effectCanvas.width, this.effectCanvas.height);
            }
            if (hasBeams) {
                this.beamsCtx.clearRect(0, 0, this.beamsCanvas.width, this.beamsCanvas.height);
            }

            // Draw effects - skip if performance is poor and no active effects
            if (hasEffects || hasBeams) {
                this.drawNovaFlashes();
                this.drawCelestialBeams(); // Draw beams behind bursts
                this.drawStarBursts();
                this.drawCosmicWaves();
                this.drawMoonPulses();
                this.drawConstellationLines();
                this.drawSparkles();
            }

            this.animationFrameId = requestAnimationFrame(animate);
        };

        animate(performance.now());
    }

    drawNovaFlashes() {
        for (let i = this.novaFlashes.length - 1; i >= 0; i--) {
            const nova = this.novaFlashes[i];
            nova.radius += (nova.maxRadius - nova.radius) * 0.1;
            nova.opacity -= nova.decay;

            if (nova.opacity <= 0) {
                this.novaFlashes.splice(i, 1);
                continue;
            }

            const gradient = this.effectCtx.createRadialGradient(nova.x, nova.y, 0, nova.x, nova.y, nova.radius);
            gradient.addColorStop(0, `hsla(${nova.hue}, 20%, 95%, ${nova.opacity})`);
            gradient.addColorStop(0.4, `hsla(${nova.hue}, 15%, 80%, ${nova.opacity * 0.5})`);
            gradient.addColorStop(1, `hsla(${nova.hue}, 10%, 50%, 0)`);

            this.effectCtx.fillStyle = gradient;
            this.effectCtx.beginPath();
            this.effectCtx.arc(nova.x, nova.y, nova.radius, 0, Math.PI * 2);
            this.effectCtx.fill();
        }
    }

    drawSparkles() {
        for (let i = this.sparkles.length - 1; i >= 0; i--) {
            const p = this.sparkles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.opacity -= p.decay;

            if (p.opacity <= 0) {
                this.sparkles.splice(i, 1);
                continue;
            }

            this.effectCtx.fillStyle = `hsla(${p.hue}, 20%, 90%, ${p.opacity})`;
            this.effectCtx.beginPath();
            this.effectCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.effectCtx.fill();

            // Cross shape for sparkle
            this.effectCtx.fillRect(p.x - p.size * 2, p.y - p.size * 0.5, p.size * 4, p.size);
            this.effectCtx.fillRect(p.x - p.size * 0.5, p.y - p.size * 2, p.size, p.size * 4);
        }
    }

    drawStarBursts() {
        if (this.starBursts.length === 0) return;

        const useShadows = this.activeQuality.useShadows && this.averageFrameTime < 20; // Disable shadows if < 50 FPS
        const useComplexGradients = this.activeQuality.useComplexGradients && this.averageFrameTime < 25;

        // Batch canvas state changes
        const ctx = this.effectCtx;

        for (let i = this.starBursts.length - 1; i >= 0; i--) {
            const burst = this.starBursts[i];

            burst.life -= burst.decay;

            if (burst.life <= 0) {
                this.starBursts.splice(i, 1);
                continue;
            }

            const opacity = burst.life * 0.9;
            const currentLife = burst.life;

            // Update and draw particles - optimized batch version
            for (let j = 0; j < burst.particles.length; j++) {
                const p = burst.particles[j];

                // Update position
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.12;

                const currentSize = p.size * currentLife;

                // Simple fill for better performance - only use gradients on high performance
                if (useComplexGradients) {
                    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, currentSize);
                    gradient.addColorStop(0, `hsla(${p.hue}, 10%, ${p.brightness + 10}%, ${opacity})`);
                    gradient.addColorStop(0.5, `hsla(${p.hue}, 5%, ${p.brightness}%, ${opacity * 0.7})`);
                    gradient.addColorStop(1, `hsla(${p.hue}, 0%, ${p.brightness - 10}%, 0)`);
                    ctx.fillStyle = gradient;
                } else {
                    ctx.fillStyle = `hsla(${p.hue}, 5%, ${p.brightness}%, ${opacity})`;
                }

                ctx.beginPath();
                ctx.arc(p.x, p.y, currentSize * 1.5, 0, Math.PI * 2);
                ctx.fill();

                // Add glow only if enabled and performance is good
                if (useShadows) {
                    ctx.shadowBlur = 15 * currentLife;
                    ctx.shadowColor = `hsla(${p.hue}, 10%, ${p.brightness}%, ${opacity * 0.4})`;

                    // Draw bright core with shadow
                    ctx.fillStyle = `hsla(${p.hue}, 0%, 95%, ${opacity})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, currentSize * 0.4, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.shadowBlur = 0;
                } else {
                    // Draw bright core without shadow
                    ctx.fillStyle = `hsla(${p.hue}, 0%, 95%, ${opacity})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, currentSize * 0.4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }

    drawCosmicWaves() {
        if (this.cosmicWaves.length === 0) return;

        // Adaptive quality based on performance
        const ringCount = this.averageFrameTime > 25 ? 1 : this.activeQuality.waveRingCount;
        const useShadows = this.activeQuality.useShadows && this.averageFrameTime < 20;
        const ctx = this.effectCtx;

        for (let i = this.cosmicWaves.length - 1; i >= 0; i--) {
            const wave = this.cosmicWaves[i];

            wave.radius += wave.growthRate;
            wave.opacity *= 0.97;

            if (wave.radius >= wave.maxRadius || wave.opacity < 0.05) {
                this.cosmicWaves.splice(i, 1);
                continue;
            }

            // Draw concentric rings - reduce count if performance is poor
            for (let j = 0; j < ringCount; j++) {
                const offset = j * 8;
                const currentRadius = wave.radius + offset;
                const ringOpacity = wave.opacity * (1 - j * 0.25);

                // Draw expanding ring with gradient
                const innerRadius = Math.max(0, currentRadius - 6);
                const outerRadius = currentRadius + 6;

                const gradient = ctx.createRadialGradient(wave.x, wave.y, innerRadius, wave.x, wave.y, outerRadius);
                gradient.addColorStop(0, `hsla(${wave.hue}, 0%, 85%, 0)`);
                gradient.addColorStop(0.4, `hsla(${wave.hue}, 5%, 90%, ${ringOpacity * 0.6})`);
                gradient.addColorStop(0.6, `hsla(${wave.hue}, 10%, 92%, ${ringOpacity})`);
                gradient.addColorStop(1, `hsla(${wave.hue}, 0%, 85%, 0)`);

                ctx.strokeStyle = gradient;
                ctx.lineWidth = wave.thickness;
                ctx.beginPath();
                ctx.arc(wave.x, wave.y, currentRadius, 0, Math.PI * 2);
                ctx.stroke();

                // Add glow to outer ring only if performance is good
                if (useShadows && j === 0) {
                    ctx.shadowBlur = 20;
                    ctx.shadowColor = `hsla(${wave.hue}, 15%, 92%, ${ringOpacity * 0.5})`;
                    ctx.stroke();
                    ctx.shadowBlur = 0;
                }
            }
        }
    }

    drawCelestialBeams() {
        const { useShadows } = this.activeQuality;
        const { useComplexGradients } = this.activeQuality;

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

            if (useComplexGradients) {
                // Draw outer glow first (complex version) - silver with low saturation
                const glowGradient = this.beamsCtx.createLinearGradient(beam.x, beam.y, beam.x, beam.y + beam.length);
                glowGradient.addColorStop(0, `hsla(${beam.hue}, 20%, 92%, ${opacity * 0.3})`);
                glowGradient.addColorStop(0.2, `hsla(${beam.hue}, 15%, 85%, ${opacity * 0.2})`);
                glowGradient.addColorStop(1, `hsla(${beam.hue}, 10%, 75%, 0)`);
                this.beamsCtx.fillStyle = glowGradient;
                this.beamsCtx.fillRect(beam.x - beam.width, beam.y, beam.width * 2, beam.length);
            }

            // Draw main beam with gradient - silver appearance
            const gradient = this.beamsCtx.createLinearGradient(beam.x, beam.y, beam.x, beam.y + beam.length);
            gradient.addColorStop(0, `hsla(${beam.hue}, 15%, 95%, ${opacity})`);
            gradient.addColorStop(0.15, `hsla(${beam.hue}, 12%, 90%, ${opacity * 0.9})`);
            gradient.addColorStop(0.5, `hsla(${beam.hue}, 10%, 85%, ${opacity * 0.6})`);
            gradient.addColorStop(1, `hsla(${beam.hue}, 5%, 75%, 0)`);

            this.beamsCtx.fillStyle = gradient;
            this.beamsCtx.fillRect(beam.x - beam.width / 2, beam.y, beam.width, beam.length);

            // Add bright core - pure white/silver
            if (useComplexGradients) {
                const coreGradient = this.beamsCtx.createLinearGradient(beam.x, beam.y, beam.x, beam.y + beam.length * 0.3);
                coreGradient.addColorStop(0, `hsla(${beam.hue}, 10%, 98%, ${opacity * 0.9})`);
                coreGradient.addColorStop(1, `hsla(${beam.hue}, 8%, 92%, 0)`);
                this.beamsCtx.fillStyle = coreGradient;
                this.beamsCtx.fillRect(beam.x - beam.width / 4, beam.y, beam.width / 2, beam.length * 0.3);
            }

            // Add subtle shadow blur (quality-based) - silver glow
            if (useShadows) {
                this.beamsCtx.shadowBlur = 25;
                this.beamsCtx.shadowColor = `hsla(${beam.hue}, 15%, 90%, ${opacity * 0.3})`;
                this.beamsCtx.fillRect(beam.x - beam.width / 4, beam.y, beam.width / 2, beam.length * 0.1);
                this.beamsCtx.shadowBlur = 0;
            }
        }
    }

    drawMoonPulses() {
        const { useShadows } = this.activeQuality;
        const { useComplexGradients } = this.activeQuality;

        for (let i = this.moonGlowPulses.length - 1; i >= 0; i--) {
            const pulse = this.moonGlowPulses[i];

            pulse.radius += pulse.growthRate;
            pulse.opacity *= 0.96;

            if (pulse.radius >= pulse.maxRadius || pulse.opacity < 0.05) {
                this.moonGlowPulses.splice(i, 1);
                continue;
            }

            if (useComplexGradients) {
                // Draw outer ethereal glow (complex version)
                const outerGradient = this.effectCtx.createRadialGradient(
                    pulse.x,
                    pulse.y,
                    pulse.radius - 30,
                    pulse.x,
                    pulse.y,
                    pulse.radius + 40,
                );
                outerGradient.addColorStop(0, `hsla(${pulse.hue}, 10%, 85%, 0)`);
                outerGradient.addColorStop(0.3, `hsla(${pulse.hue}, 15%, 90%, ${pulse.opacity * 0.25})`);
                outerGradient.addColorStop(0.7, `hsla(${pulse.hue}, 10%, 85%, ${pulse.opacity * 0.4})`);
                outerGradient.addColorStop(1, `hsla(${pulse.hue}, 5%, 80%, 0)`);

                this.effectCtx.fillStyle = outerGradient;
                this.effectCtx.beginPath();
                this.effectCtx.arc(pulse.x, pulse.y, pulse.radius + 20, 0, Math.PI * 2);
                this.effectCtx.fill();
            }

            // Draw main pulse ring
            const gradient = this.effectCtx.createRadialGradient(
                pulse.x,
                pulse.y,
                pulse.radius - 15,
                pulse.x,
                pulse.y,
                pulse.radius + 15,
            );
            gradient.addColorStop(0, `hsla(${pulse.hue}, 10%, 85%, 0)`);
            gradient.addColorStop(0.4, `hsla(${pulse.hue}, 15%, 92%, ${pulse.opacity * 0.8})`);
            gradient.addColorStop(0.6, `hsla(${pulse.hue}, 15%, 90%, ${pulse.opacity})`);
            gradient.addColorStop(1, `hsla(${pulse.hue}, 10%, 85%, 0)`);

            this.effectCtx.fillStyle = gradient;
            this.effectCtx.beginPath();
            this.effectCtx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
            this.effectCtx.fill();

            // Add bright inner ring (quality-based)
            if (useShadows) {
                this.effectCtx.shadowBlur = 25;
                this.effectCtx.shadowColor = `hsla(${pulse.hue}, 10%, 95%, ${pulse.opacity * 0.5})`;
            }
            this.effectCtx.strokeStyle = `hsla(${pulse.hue}, 5%, 95%, ${pulse.opacity})`;
            this.effectCtx.lineWidth = 2;
            this.effectCtx.beginPath();
            this.effectCtx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
            this.effectCtx.stroke();
            if (useShadows) {
                this.effectCtx.shadowBlur = 0;
            }
        }
    }

    drawConstellationLines() {
        const { useShadows } = this.activeQuality;
        const { useComplexGradients } = this.activeQuality;

        for (let i = this.constellationLines.length - 1; i >= 0; i--) {
            const line = this.constellationLines[i];

            line.life -= line.decay;

            if (line.life <= 0) {
                this.constellationLines.splice(i, 1);
                continue;
            }

            const opacity = line.opacity * line.life;

            if (useComplexGradients) {
                // Draw outer glow line (complex version)
                this.effectCtx.strokeStyle = `hsla(${line.hue}, 10%, 80%, ${opacity * 0.25})`;
                this.effectCtx.lineWidth = 4;
                this.effectCtx.beginPath();
                this.effectCtx.moveTo(line.x1, line.y1);
                this.effectCtx.lineTo(line.x2, line.y2);
                this.effectCtx.stroke();
            }

            // Draw main mystical connecting line
            this.effectCtx.strokeStyle = `hsla(${line.hue}, 15%, 80%, ${opacity * 0.7})`;
            this.effectCtx.lineWidth = 2;
            this.effectCtx.beginPath();
            this.effectCtx.moveTo(line.x1, line.y1);
            this.effectCtx.lineTo(line.x2, line.y2);
            this.effectCtx.stroke();

            // Draw bright core line (with optional shadow)
            if (useShadows) {
                this.effectCtx.shadowBlur = 10;
                this.effectCtx.shadowColor = `hsla(${line.hue}, 10%, 85%, ${opacity * 0.6})`;
            }
            this.effectCtx.strokeStyle = `hsla(${line.hue}, 5%, 90%, ${opacity})`;
            this.effectCtx.lineWidth = 1;
            this.effectCtx.beginPath();
            this.effectCtx.moveTo(line.x1, line.y1);
            this.effectCtx.lineTo(line.x2, line.y2);
            this.effectCtx.stroke();

            // Draw star connection points
            if (useComplexGradients) {
                if (useShadows) {
                    this.effectCtx.shadowBlur = 12;
                }
                this.effectCtx.fillStyle = `hsla(${line.hue}, 5%, 90%, ${opacity})`;
                this.effectCtx.beginPath();
                this.effectCtx.arc(line.x1, line.y1, 3, 0, Math.PI * 2);
                this.effectCtx.fill();
                this.effectCtx.beginPath();
                this.effectCtx.arc(line.x2, line.y2, 3, 0, Math.PI * 2);
                this.effectCtx.fill();
            }

            if (useShadows) {
                this.effectCtx.shadowBlur = 0;
            }
        }
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

        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        // Teardown quality listener
        this.teardownQualityListener();

        // Clear all effect arrays
        this.starBursts = [];
        this.cosmicWaves = [];
        this.celestialBeams = [];
        this.moonGlowPulses = [];
        this.constellationLines = [];
        this.cachedStarElements = [];
        if (this.starBoostTimeout) {
            clearTimeout(this.starBoostTimeout);
            this.starBoostTimeout = null;
        }
        if (this.mountainGlowTimeoutDistant) {
            clearTimeout(this.mountainGlowTimeoutDistant);
            this.mountainGlowTimeoutDistant = null;
        }
        if (this.mountainGlowTimeoutFore) {
            clearTimeout(this.mountainGlowTimeoutFore);
            this.mountainGlowTimeoutFore = null;
        }
        if (this.cachedDOMElements.starsContainer) {
            this.cachedDOMElements.starsContainer.style.filter = '';
        }
        if (this.cachedDOMElements.mountainsDistant) {
            this.cachedDOMElements.mountainsDistant.style.filter = '';
        }
        if (this.cachedDOMElements.mountainsFore) {
            this.cachedDOMElements.mountainsFore.style.filter = '';
        }

        // Reset state
        this.comboMultiplier = 1.0;
        this.cosmicEnergy = 0;
        this.wolfhourPower = 0;
        this.animationTime = 0;

        if (this.webglRenderer) {
            this.webglRenderer.destroy();
            this.webglRenderer = null;
        }
        if (this.webglCanvas) {
            this.webglCanvas.remove();
            this.webglCanvas = null;
        }

        super.stop();
    }
}
