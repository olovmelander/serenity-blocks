import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { WINTER_TETROMINOS } from './winter-tetrominos.js';

export default class WinterTheme extends BaseTheme {
    constructor() {
        super('winter');
        this.canvas = null;
        this.ctx = null;
        this.snowParticles = [];
        this.windForce = 0;
        this.targetWindForce = 0;
        this.nextWindChange = 1800; // Start calm, first wind change after 10 seconds
        this.gustIntensity = 0;
        this.nextGust = 3600; // Start calm, first gust after 30 seconds
        this.gustDuration = 0;
        this.time = 0;
        this.maxParticles = 800; // Reduced from 1200
        this.resizeHandler = null;
        this.vortexParticles = [];
        this.groundSnow = [];
        this.streakParticles = [];
        this.spiralSystems = [];
        this.cameraShake = { x: 0, y: 0, intensity: 0 };
        this.distortionWaves = [];
        this.flashIntensity = 0;
        this.nextFlash = 3600; // Start calm, first flash after 60 seconds

        // Gameplay integration
        this.comboMultiplier = 1.0;
        this.comboDecay = 0;
        this.iceBurstParticles = [];
        this.frozenLightning = [];
        this.comboVortexes = [];
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;
        this.comboWindTimer = 0;

        // Performance optimization: Cache gradients and reusable objects
        this.gradientCache = {
            background: null,
            fog: null,
            vignette: null,
            lastWidth: 0,
            lastHeight: 0,
        };
        this.particlePool = {
            snow: [],
            ice: [],
            vortex: [],
            streak: [],
        };
        this.activeParticles = {
            snow: [],
            ice: [],
            vortex: [],
            streak: [],
        };
        this.offscreenMargin = 150; // Tighter culling boundary
        this.frameSkip = 0;
        this.particleBatchSize = 50; // Process particles in batches

        // Graphics quality presets
        this.qualityChangeHandler = null;
        this.qualityPresets = {
            Minimal: {
                // Snow particles
                maxParticles: 250,
                initialParticlePercent: 0.4,
                groundSnowCount: 12,
                // Combo effects
                iceBurstCap: 40,
                maxFrozenLightning: 0,
                maxComboVortexes: 1,
                // Gust effects
                streakParticlesCount: 5,
                vortexParticlesCount: 5,
                spiralSystemsCount: 0,
                // Rendering
                enableTrails: false,
                trailComplexity: 0,
                enableFrozenLightning: false,
                // Performance
                particleSortInterval: 20,
                windIndicatorInterval: 6,
            },
            Low: {
                // Snow particles
                maxParticles: 400,
                initialParticlePercent: 0.5,
                groundSnowCount: 20,
                // Combo effects
                iceBurstCap: 75,
                maxFrozenLightning: 2,
                maxComboVortexes: 2,
                // Gust effects
                streakParticlesCount: 10,
                vortexParticlesCount: 10,
                spiralSystemsCount: 1,
                // Rendering
                enableTrails: false,
                trailComplexity: 0,
                enableFrozenLightning: false,
                // Performance
                particleSortInterval: 15,
                windIndicatorInterval: 4,
            },
            Medium: {
                // Snow particles
                maxParticles: 800,
                initialParticlePercent: 0.6,
                groundSnowCount: 35,
                // Combo effects
                iceBurstCap: 150,
                maxFrozenLightning: 4,
                maxComboVortexes: 4,
                // Gust effects
                streakParticlesCount: 20,
                vortexParticlesCount: 20,
                spiralSystemsCount: 2,
                // Rendering
                enableTrails: true,
                trailComplexity: 1, // Simplified trails
                enableFrozenLightning: true,
                // Performance
                particleSortInterval: 10,
                windIndicatorInterval: 2,
            },
            High: {
                // Snow particles
                maxParticles: 1200,
                initialParticlePercent: 0.7,
                groundSnowCount: 50,
                // Combo effects
                iceBurstCap: 200,
                maxFrozenLightning: 6,
                maxComboVortexes: 6,
                // Gust effects
                streakParticlesCount: 30,
                vortexParticlesCount: 30,
                spiralSystemsCount: 3,
                // Rendering
                enableTrails: true,
                trailComplexity: 2, // Full trails
                enableFrozenLightning: true,
                // Performance
                particleSortInterval: 10,
                windIndicatorInterval: 2,
            },
            Ultra: {
                // Snow particles
                maxParticles: 1600,
                initialParticlePercent: 0.8,
                groundSnowCount: 70,
                // Combo effects
                iceBurstCap: 250,
                maxFrozenLightning: 8,
                maxComboVortexes: 8,
                // Gust effects
                streakParticlesCount: 40,
                vortexParticlesCount: 40,
                spiralSystemsCount: 4,
                // Rendering
                enableTrails: true,
                trailComplexity: 3, // Enhanced trails
                enableFrozenLightning: true,
                // Performance
                particleSortInterval: 8,
                windIndicatorInterval: 1,
            },
            Extreme: {
                // Snow particles
                maxParticles: 2200,
                initialParticlePercent: 0.9,
                groundSnowCount: 100,
                // Combo effects
                iceBurstCap: 350,
                maxFrozenLightning: 12,
                maxComboVortexes: 12,
                // Gust effects
                streakParticlesCount: 60,
                vortexParticlesCount: 60,
                spiralSystemsCount: 6,
                // Rendering
                enableTrails: true,
                trailComplexity: 4, // Maximum trails
                enableFrozenLightning: true,
                // Performance
                particleSortInterval: 6,
                windIndicatorInterval: 1,
            },
        };
        this.currentQuality = 'Medium';
        this.activePreset = this.qualityPresets.Medium;

        // Apply default preset values
        this.maxFrozenLightning = this.activePreset.maxFrozenLightning;
        this.maxComboVortexes = this.activePreset.maxComboVortexes;
        this.iceBurstCap = this.activePreset.iceBurstCap;
        this.enableFrozenLightning = this.activePreset.enableFrozenLightning;
    }

    getTetrominoConfig() {
        return WINTER_TETROMINOS;
    }

    /**
     * Get current graphics quality setting from game settings
     * @returns {string} Current quality level ('Low' | 'Medium' | 'High' | 'Ultra')
     */
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'Medium';
    }

    /**
     * Apply a graphics quality preset to the theme
     * @param {string} quality - Quality level to apply
     */
    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[WinterTheme] Unknown preset "${quality}", defaulting to Medium`);
            quality = 'Medium';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        const preset = this.activePreset;

        // Update limits
        this.maxParticles = preset.maxParticles;
        this.iceBurstCap = preset.iceBurstCap;
        this.maxFrozenLightning = preset.maxFrozenLightning;
        this.maxComboVortexes = preset.maxComboVortexes;
        this.enableFrozenLightning = preset.enableFrozenLightning;

        // Trim existing particle collections to new limits
        this.trimEffectCollections();

        console.log(`[WinterTheme] Applying ${quality} graphics preset`);
    }

    /**
     * Trim effect collections to match current quality preset limits
     */
    trimEffectCollections() {
        const clamp = (collection, limit) => {
            if (!collection || typeof limit !== 'number' || limit <= 0) return;
            if (collection.length > limit) {
                collection.splice(0, collection.length - limit);
            }
        };

        // Trim particle arrays to current limits
        clamp(this.snowParticles, this.maxParticles);
        clamp(this.iceBurstParticles, this.iceBurstCap);
        clamp(this.frozenLightning, this.maxFrozenLightning);
        clamp(this.comboVortexes, this.maxComboVortexes);
    }

    /**
     * Setup listener for graphics quality changes
     */
    setupQualityListener() {
        if (typeof window === 'undefined') return;

        this.teardownQualityListener();

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;

            // Apply new preset
            this.applyQualityPreset(newQuality);
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    /**
     * Remove graphics quality change listener
     */
    teardownQualityListener() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    async createScene() {
        // Apply graphics quality preset at scene creation
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        const preset = this.activePreset;

        this.canvas = document.getElementById('winter-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d', { alpha: true });

        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        // Initialize snow particles progressively for better startup performance
        this.snowParticles = [];
        const initialParticles = Math.floor(this.maxParticles * preset.initialParticlePercent);
        for (let i = 0; i < initialParticles; i++) {
            this.snowParticles.push(this.createSnowParticle(true));
        }

        // Initialize ground snow accumulation - using quality preset count
        this.groundSnow = [];
        for (let i = 0; i < preset.groundSnowCount; i++) {
            this.groundSnow.push({
                x: Math.random() * this.canvas.width,
                y: this.canvas.height - Math.random() * 100,
                size: Math.random() * 4 + 2,
                opacity: Math.random() * 0.3 + 0.1,
                drift: Math.random() * 0.5 - 0.25,
            });
        }

        this.setupEventListeners();

        this.animate();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        // Invalidate gradient cache on resize
        this.gradientCache.lastWidth = 0;
        this.gradientCache.lastHeight = 0;
    }

    // Performance: Create and cache gradients
    getCachedBackgroundGradient(comboBoost, flashBoost, gustBoost) {
        if (this.gradientCache.background
            && this.gradientCache.lastWidth === this.canvas.width
            && this.gradientCache.lastHeight === this.canvas.height
            && this.gradientCache.lastComboBoost === comboBoost
            && this.gradientCache.lastFlashBoost === flashBoost
            && this.gradientCache.lastGustBoost === gustBoost) {
            return this.gradientCache.background;
        }

        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, `rgb(${5 + flashBoost + comboBoost}, ${8 + flashBoost + comboBoost}, ${15 + flashBoost + comboBoost})`);
        gradient.addColorStop(0.4, `rgb(${8 + flashBoost + gustBoost + comboBoost}, ${12 + flashBoost + gustBoost + comboBoost}, ${20 + flashBoost + gustBoost + comboBoost})`);
        gradient.addColorStop(0.7, `rgb(${12 + gustBoost}, ${16 + gustBoost}, ${24 + gustBoost})`);
        gradient.addColorStop(1, `rgb(${18 + gustBoost}, ${22 + gustBoost}, ${30 + gustBoost})`);

        this.gradientCache.background = gradient;
        this.gradientCache.lastWidth = this.canvas.width;
        this.gradientCache.lastHeight = this.canvas.height;
        this.gradientCache.lastComboBoost = comboBoost;
        this.gradientCache.lastFlashBoost = flashBoost;
        this.gradientCache.lastGustBoost = gustBoost;

        return gradient;
    }

    getCachedFogGradient(gustBoost, comboBoost) {
        if (this.gradientCache.fog
            && this.gradientCache.lastWidth === this.canvas.width
            && this.gradientCache.lastFogGust === gustBoost
            && this.gradientCache.lastFogCombo === comboBoost) {
            return this.gradientCache.fog;
        }

        const fogGradient = this.ctx.createRadialGradient(
            this.canvas.width / 2,
            this.canvas.height * 0.6,
            0,
            this.canvas.width / 2,
            this.canvas.height * 0.6,
            this.canvas.width * 0.8,
        );
        fogGradient.addColorStop(0, `rgba(${20 + gustBoost * 2 + comboBoost}, ${25 + gustBoost * 2 + comboBoost}, ${35 + gustBoost * 2 + comboBoost}, 0.4)`);
        fogGradient.addColorStop(0.5, `rgba(${15 + gustBoost}, ${20 + gustBoost}, ${30 + gustBoost}, 0.25)`);
        fogGradient.addColorStop(1, 'rgba(10, 15, 25, 0)');

        this.gradientCache.fog = fogGradient;
        this.gradientCache.lastFogGust = gustBoost;
        this.gradientCache.lastFogCombo = comboBoost;

        return fogGradient;
    }

    getCachedVignetteGradient() {
        if (this.gradientCache.vignette
            && this.gradientCache.lastWidth === this.canvas.width
            && this.gradientCache.lastVignetteGust === this.gustIntensity) {
            return this.gradientCache.vignette;
        }

        const vignetteGradient = this.ctx.createRadialGradient(
            this.canvas.width / 2,
            this.canvas.height / 2,
            this.canvas.width * 0.2,
            this.canvas.width / 2,
            this.canvas.height / 2,
            this.canvas.width * 0.8,
        );
        vignetteGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignetteGradient.addColorStop(1, `rgba(0, 0, 0, ${0.5 + this.gustIntensity * 0.2})`);

        this.gradientCache.vignette = vignetteGradient;
        this.gradientCache.lastVignetteGust = this.gustIntensity;

        return vignetteGradient;
    }

    // Object pooling for particles
    getPooledParticle(type) {
        const pool = this.particlePool[type];
        return pool.length > 0 ? pool.pop() : null;
    }

    releaseParticle(type, particle) {
        const pool = this.particlePool[type];
        if (pool.length < 500) { // Max pool size
            pool.push(particle);
        }
    }

    setupEventListeners() {
        this.teardownEventListeners();

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.shouldProcessComboEffects()) return;
            this.handleLineClear(data);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.shouldProcessComboEffects()) return;
            this.handleCombo(data);
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    teardownEventListeners() {
        if (!this.eventUnsubscribers.length) {
            return;
        }

        this.eventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe?.();
            } catch (error) {
                console.error('[WinterTheme] Failed to remove event listener', error);
            }
        });

        this.eventUnsubscribers = [];
    }

    shouldProcessComboEffects() {
        if (!this.isActive) return false;
        if (typeof window === 'undefined') return true;
        const { settings } = window;
        return settings?.backgroundComboEffects === true;
    }

    normalizeEventPayload(payload = {}) {
        if (payload && typeof payload === 'object' && 'detail' in payload && payload.detail) {
            return payload.detail;
        }
        return payload || {};
    }

    // Event handlers
    handleLineClear(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        console.log(`[WinterTheme] Line clear event: ${lineCount} lines, combo: ${comboCount}`, detail);
        this.onLineClear(lineCount, comboCount);
    }

    handleCombo(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }

        console.log(`[WinterTheme] Combo event: ${comboCount}`, detail);
        // Combo is already handled in line clear
    }

    // Called by game when lines are cleared
    onLineClear(lineCount, comboCount) {
        console.log(`[WinterTheme] Processing line clear: ${lineCount} lines, combo: ${comboCount}`);

        // Increase combo multiplier
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.comboDecay = 180; // 3 seconds at 60fps

        // Create ice burst from center of screen
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // More particles for more lines - using quality preset cap
        const burstCount = Math.min(lineCount * 20 + comboCount * 15, this.iceBurstCap);
        for (let i = 0; i < burstCount; i++) {
            this.iceBurstParticles.push(this.createIceBurstParticle(centerX, centerY, lineCount));
        }

        // Trigger wind gust based on line count
        if (comboCount > 0) {
            const gustBonus = lineCount * 2 + comboCount;
            this.comboWindTimer = Math.max(this.comboWindTimer, 240 + comboCount * 60); // Only keep wind alive during combos
            this.targetWindForce = (Math.random() < 0.5 ? -1 : 1) * (8 + gustBonus);
            this.gustIntensity = Math.min(0.5 + lineCount * 0.15, 1.0);
            this.gustDuration = 40 + lineCount * 20;
            this.nextWindChange = this.time + Math.random() * 240 + 240; // Rare follow-up shifts while combo wind is active
            this.nextGust = this.time + Math.random() * 480 + 360; // Rare secondary gusts tied to combos
        } else {
            // Calm down when not in a combo streak
            this.comboWindTimer = 0;
            this.targetWindForce = 0;
            this.gustIntensity = 0;
            this.gustDuration = 0;
            this.nextWindChange = Infinity;
            this.nextGust = Infinity;
        }

        // Screen shake based on combo
        if (comboCount >= 3) {
            this.cameraShake.intensity = Math.min(comboCount * 2, 15);
        }

        // Create frozen lightning on big combos - quality check
        if (comboCount >= 5 && this.enableFrozenLightning && this.frozenLightning.length < this.maxFrozenLightning) {
            this.createFrozenLightning(centerX, centerY);
        }

        // Spawn combo vortexes for massive combos - quality limited
        if (comboCount >= 8 && this.comboVortexes.length < this.maxComboVortexes) {
            const vortexesToSpawn = Math.min(Math.floor(comboCount / 4), this.maxComboVortexes - this.comboVortexes.length);
            for (let i = 0; i < vortexesToSpawn; i++) {
                const vortex = this.createComboVortex(
                    Math.random() * this.canvas.width,
                    Math.random() * this.canvas.height * 0.5,
                );
                this.comboVortexes.push(vortex);
            }
        }

        // Flash effect (nearly invisible for comfort)
        this.flashIntensity = Math.min(0.003 + lineCount * 0.001, 0.01);
    }

    createIceBurstParticle(x, y, lineCount) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 15 + 5 + lineCount * 2;
        const size = Math.random() * 4 + 2;

        return {
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size,
            opacity: Math.random() * 0.8 + 0.4,
            life: 1.0,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.3,
            gravity: 0.3,
            glowIntensity: Math.random() * 0.5 + 0.5,
            sparkle: Math.random() * Math.PI * 2,
        };
    }

    createFrozenLightning(x, y) {
        const branches = [];
        const numBranches = Math.floor(Math.random() * 3) + 4;

        for (let i = 0; i < numBranches; i++) {
            const angle = (Math.PI * 2 / numBranches) * i + Math.random() * 0.5;
            const segments = [];
            let currentX = x;
            let currentY = y;

            for (let j = 0; j < 8; j++) {
                const length = Math.random() * 80 + 40;
                const nextX = currentX + Math.cos(angle + (Math.random() - 0.5) * 0.8) * length;
                const nextY = currentY + Math.sin(angle + (Math.random() - 0.5) * 0.8) * length;

                segments.push({
                    x1: currentX,
                    y1: currentY,
                    x2: nextX,
                    y2: nextY,
                });

                currentX = nextX;
                currentY = nextY;
            }

            branches.push(segments);
        }

        this.frozenLightning.push({
            branches,
            opacity: 1.0,
            life: 1.0,
            pulsePhase: 0,
        });
    }

    createComboVortex(x, y) {
        return {
            x,
            y,
            particles: [],
            angle: 0,
            radius: 0,
            maxRadius: Math.random() * 200 + 150,
            spinSpeed: 0.15,
            expansionRate: 3,
            life: 1.0,
            direction: Math.random() < 0.5 ? 1 : -1,
            intensity: 1.0,
        };
    }

    createSnowParticle(isInitial) {
        const depth = Math.random(); // 0 = far, 1 = near
        const depthScale = 0.2 + depth * 0.8;

        // Try to get from pool first
        const particle = this.getPooledParticle('snow');

        if (particle) {
            // Reset particle properties
            particle.x = isInitial ? Math.random() * this.canvas.width : Math.random() * this.canvas.width * 1.2 - this.canvas.width * 0.1;
            particle.y = isInitial ? Math.random() * this.canvas.height : -Math.random() * 50;
            particle.z = depth;
            particle.size = (Math.random() * 3 + 0.5) * depthScale;
            particle.vx = (Math.random() - 0.5) * 0.5;
            particle.vy = (Math.random() * 2 + 0.5) * depthScale;
            particle.opacity = (Math.random() * 0.7 + 0.3) * (0.4 + depth * 0.6);
            particle.rotation = Math.random() * Math.PI * 2;
            particle.rotationSpeed = (Math.random() - 0.5) * 0.08;
            particle.wobble = Math.random() * Math.PI * 2;
            particle.wobbleSpeed = Math.random() * 0.03 + 0.01;
            particle.trail.length = 0; // Clear trail
            particle.maxTrailLength = Math.floor(4 + depth * 8);
            return particle;
        }

        // Create new if pool is empty
        return {
            x: isInitial ? Math.random() * this.canvas.width : Math.random() * this.canvas.width * 1.2 - this.canvas.width * 0.1,
            y: isInitial ? Math.random() * this.canvas.height : -Math.random() * 50,
            z: depth,
            size: (Math.random() * 3 + 0.5) * depthScale,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() * 2 + 0.5) * depthScale,
            opacity: (Math.random() * 0.7 + 0.3) * (0.4 + depth * 0.6),
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.08,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: Math.random() * 0.03 + 0.01,
            trail: [],
            maxTrailLength: Math.floor(4 + depth * 8),
        };
    }

    createStreakParticle() {
        const side = Math.random() < 0.5 ? -100 : this.canvas.width + 100;
        const direction = side < 0 ? 1 : -1;

        return {
            x: side,
            y: Math.random() * this.canvas.height,
            vx: direction * (Math.random() * 30 + 20),
            vy: (Math.random() - 0.5) * 5,
            length: Math.random() * 150 + 100,
            size: Math.random() * 3 + 1,
            opacity: Math.random() * 0.8 + 0.4,
            life: 1.0,
        };
    }

    createVortexParticle(x, y) {
        return {
            x,
            y,
            angle: Math.random() * Math.PI * 2,
            speed: Math.random() * 4 + 2,
            size: Math.random() * 2.5 + 1,
            opacity: Math.random() * 0.9 + 0.3,
            life: 1.0,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.3,
        };
    }

    createSpiralSystem(x, y) {
        return {
            x,
            y,
            particles: [],
            angle: 0,
            radius: 0,
            maxRadius: Math.random() * 150 + 100,
            spinSpeed: (Math.random() - 0.5) * 0.1,
            expansionRate: Math.random() * 2 + 1,
            life: 1.0,
            direction: Math.random() < 0.5 ? 1 : -1,
        };
    }

    createDistortionWave() {
        return {
            x: Math.random() * this.canvas.width,
            y: 0,
            width: Math.random() * 200 + 100,
            height: this.canvas.height,
            speed: Math.random() * 3 + 2,
            opacity: Math.random() * 0.3 + 0.2,
            life: 1.0,
        };
    }

    animate() {
        if (!this.isActive) {
            return;
        }

        this.time += 1;

        // Decay combo multiplier
        if (this.comboDecay > 0) {
            this.comboDecay -= 1;
            if (this.comboDecay === 0) {
                this.comboMultiplier = 1.0;
            }
        }

        // Dynamic wind now driven only by combo activity
        const comboWindActive = this.comboWindTimer > 0 || this.gustDuration > 0;

        if (comboWindActive) {
            if (this.comboWindTimer > 0) {
                this.comboWindTimer -= 1;
            }

            if (this.time >= this.nextWindChange && this.comboWindTimer > 0) {
                this.targetWindForce = (Math.random() - 0.5) * 6 * this.comboMultiplier; // Small, rare shifts
                this.nextWindChange = this.time + Math.random() * 240 + 240; // ~4-8 seconds between shifts
            }

            if (this.time >= this.nextGust && this.gustDuration <= 0 && this.comboWindTimer > 0) {
                const gustStrength = (Math.random() * 4 + 5) * this.comboMultiplier;
                const gustDirection = Math.random() < 0.5 ? -1 : 1;
                this.targetWindForce = gustDirection * gustStrength;
                this.gustIntensity = 0.8;
                this.gustDuration = Math.random() * 50 + 30;
                this.nextGust = this.time + Math.random() * 480 + 360; // Far less frequent follow-up gusts

                // SCREEN SHAKE during powerful gusts
                if (gustStrength > 10) {
                    this.cameraShake.intensity = Math.min(gustStrength * 0.8, 12);
                }

                // Spawn horizontal streak particles during strong gusts - using quality preset count
                if (gustStrength > 8) {
                    for (let i = 0; i < this.activePreset.streakParticlesCount; i++) {
                        this.streakParticles.push(this.createStreakParticle());
                    }
                }

                // Spawn vortex particles during strong gusts - using quality preset count
                if (gustStrength > 7) {
                    for (let i = 0; i < this.activePreset.vortexParticlesCount; i++) {
                        const x = Math.random() * this.canvas.width;
                        const y = Math.random() * this.canvas.height * 0.7;
                        this.vortexParticles.push(this.createVortexParticle(x, y));
                    }
                }

                // Create spiral systems during extreme gusts - using quality preset count
                if (gustStrength > 11) {
                    for (let i = 0; i < this.activePreset.spiralSystemsCount; i++) {
                        const spiral = this.createSpiralSystem(
                            Math.random() * this.canvas.width,
                            Math.random() * this.canvas.height * 0.6,
                        );
                        this.spiralSystems.push(spiral);
                    }

                    // Distortion waves disabled - vertical pillar flashes removed for comfort
                }
            }
        } else {
            // No combo activity: quickly return to calm
            this.targetWindForce *= 0.9;
            this.windForce *= 0.9;
            if (Math.abs(this.targetWindForce) < 0.05) {
                this.targetWindForce = 0;
            }
            this.nextWindChange = Infinity;
            this.nextGust = Infinity;
        }

        // Fade gust intensity
        if (this.gustDuration > 0) {
            this.gustDuration -= 1;
            this.gustIntensity = Math.max(0, this.gustDuration / 80);
        } else {
            this.gustIntensity = 0;
        }

        // Camera shake decay
        if (this.cameraShake.intensity > 0) {
            this.cameraShake.intensity *= 0.92;
            this.cameraShake.x = (Math.random() - 0.5) * this.cameraShake.intensity;
            this.cameraShake.y = (Math.random() - 0.5) * this.cameraShake.intensity;
        } else {
            this.cameraShake.x = 0;
            this.cameraShake.y = 0;
        }

        // Smooth wind transition
        const windTransitionSpeed = this.gustIntensity > 0 ? 0.12 : 0.03;
        this.windForce += (this.targetWindForce - this.windForce) * windTransitionSpeed;

        // Random atmospheric flashes during extreme winds (barely visible for comfort)
        if (this.time >= this.nextFlash && Math.abs(this.windForce) > 14) { // Only during very extreme winds (increased threshold)
            this.flashIntensity = 0.001; // Barely visible flash (reduced from 0.003)
            this.nextFlash = this.time + Math.random() * 600 + 300; // More frequent (every 5-15 seconds at 60fps)
        }
        if (this.flashIntensity > 0) {
            this.flashIntensity *= 0.9; // Faster decay (was 0.85)
        }

        // Apply camera shake
        this.ctx.save();
        this.ctx.translate(this.cameraShake.x, this.cameraShake.y);

        // Dark atmospheric background with dynamic lighting (combo affects brightness)
        const comboBoost = Math.floor((this.comboMultiplier - 1) * 20);
        const flashBoost = Math.floor(this.flashIntensity * 5); // Reduced from 15 to 5
        const gustBoost = Math.floor(this.gustIntensity * 10); // Reduced from 15 to 10

        // Use cached gradients
        this.ctx.fillStyle = this.getCachedBackgroundGradient(comboBoost, flashBoost, gustBoost);
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Add atmospheric depth fog
        this.ctx.fillStyle = this.getCachedFogGradient(gustBoost, comboBoost);
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw frozen lightning
        for (let i = this.frozenLightning.length - 1; i >= 0; i--) {
            const lightning = this.frozenLightning[i];
            lightning.life -= 0.015;
            lightning.opacity = lightning.life;
            lightning.pulsePhase += 0.1;

            if (lightning.life <= 0) {
                this.frozenLightning.splice(i, 1);
                continue;
            }

            const pulseOpacity = lightning.opacity * (0.3 + Math.sin(lightning.pulsePhase) * 0.15);

            // Optimized: Draw all segments in batch with single stroke per layer
            this.ctx.lineCap = 'round';

            // Outer glow layer
            this.ctx.strokeStyle = `rgba(180, 220, 255, ${pulseOpacity * 0.15})`;
            this.ctx.lineWidth = 6;
            this.ctx.beginPath();
            for (const branch of lightning.branches) {
                for (const segment of branch) {
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                }
            }
            this.ctx.stroke();

            // Middle glow layer
            this.ctx.strokeStyle = `rgba(200, 235, 255, ${pulseOpacity * 0.3})`;
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            for (const branch of lightning.branches) {
                for (const segment of branch) {
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                }
            }
            this.ctx.stroke();

            // Core layer
            this.ctx.strokeStyle = `rgba(230, 245, 255, ${pulseOpacity * 0.5})`;
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            for (const branch of lightning.branches) {
                for (const segment of branch) {
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                }
            }
            this.ctx.stroke();
        }

        // Draw and update combo vortexes
        for (let i = this.comboVortexes.length - 1; i >= 0; i--) {
            const vortex = this.comboVortexes[i];

            vortex.angle += vortex.spinSpeed * vortex.direction;
            vortex.radius += vortex.expansionRate;
            vortex.life -= 0.005;
            vortex.intensity = vortex.life;

            // Spawn particles along the vortex
            if (Math.random() < 0.7 && vortex.radius < vortex.maxRadius) {
                const particleAngle = vortex.angle + Math.random() * Math.PI * 0.3;
                const particleRadius = vortex.radius + Math.random() * 40;
                vortex.particles.push({
                    x: vortex.x + Math.cos(particleAngle) * particleRadius,
                    y: vortex.y + Math.sin(particleAngle) * particleRadius,
                    size: Math.random() * 4 + 2,
                    opacity: Math.random() * 0.9 + 0.3,
                    vx: Math.cos(particleAngle) * 3,
                    vy: Math.sin(particleAngle) * 3,
                    life: 1.0,
                    sparkle: Math.random() * Math.PI * 2,
                });
            }

            // Update and draw vortex particles (optimized)
            for (let j = vortex.particles.length - 1; j >= 0; j--) {
                const p = vortex.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.015;
                p.opacity = p.life * vortex.intensity;
                p.sparkle += 0.2;

                if (p.life <= 0) {
                    vortex.particles.splice(j, 1);
                    continue;
                }

                const sparkleEffect = Math.sin(p.sparkle) * 0.15 + 0.35;

                // Optimized: No shadow blur for better performance
                this.ctx.globalAlpha = p.opacity * sparkleEffect * 0.5;
                this.ctx.fillStyle = 'rgba(240, 250, 255, 1)';
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.globalAlpha = 1;
            }

            if (vortex.life <= 0 || vortex.radius > vortex.maxRadius) {
                this.comboVortexes.splice(i, 1);
            }
        }

        // Draw and update ice burst particles (optimized rendering)
        for (let i = this.iceBurstParticles.length - 1; i >= 0; i--) {
            const particle = this.iceBurstParticles[i];

            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += particle.gravity;
            particle.vx *= 0.98;
            particle.rotation += particle.rotationSpeed;
            particle.life -= 0.02;
            particle.opacity = particle.life * 0.9;
            particle.sparkle += 0.15;

            if (particle.life <= 0 || particle.y > this.canvas.height) {
                this.releaseParticle('ice', particle);
                this.iceBurstParticles.splice(i, 1);
                continue;
            }

            const sparkleIntensity = Math.sin(particle.sparkle) * 0.2 + 0.3;

            this.ctx.save();
            this.ctx.translate(particle.x, particle.y);
            this.ctx.rotate(particle.rotation);

            // Optimized: No shadow blur for better performance
            this.ctx.globalAlpha = particle.opacity * sparkleIntensity * 0.5;

            // Ice shard shape
            this.ctx.fillStyle = 'rgba(220, 240, 255, 1)';
            this.ctx.beginPath();
            this.ctx.moveTo(0, -particle.size);
            this.ctx.lineTo(particle.size * 0.5, particle.size * 0.5);
            this.ctx.lineTo(-particle.size * 0.5, particle.size * 0.5);
            this.ctx.closePath();
            this.ctx.fill();

            // Highlight
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.beginPath();
            this.ctx.arc(-particle.size * 0.2, -particle.size * 0.3, particle.size * 0.3, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.globalAlpha = 1;
            this.ctx.restore();
        }

        // Distortion waves (vertical pillars) disabled for comfort - removed rendering code

        // Draw and update ground snow
        for (let i = this.groundSnow.length - 1; i >= 0; i--) {
            const snow = this.groundSnow[i];
            snow.x += this.windForce * 0.08 + snow.drift;

            // Wrap around
            if (snow.x < -10) snow.x = this.canvas.width + 10;
            if (snow.x > this.canvas.width + 10) snow.x = -10;

            this.ctx.beginPath();
            this.ctx.arc(snow.x, snow.y, snow.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(200, 210, 225, ${snow.opacity})`;
            this.ctx.fill();
        }

        // Update and draw spiral systems
        for (let i = this.spiralSystems.length - 1; i >= 0; i--) {
            const spiral = this.spiralSystems[i];

            spiral.angle += spiral.spinSpeed * spiral.direction;
            spiral.radius += spiral.expansionRate;
            spiral.life -= 0.008;

            // Spawn particles along the spiral
            if (Math.random() < 0.5 && spiral.radius < spiral.maxRadius) {
                const particleAngle = spiral.angle + Math.random() * Math.PI * 0.2;
                const particleRadius = spiral.radius + Math.random() * 30;
                spiral.particles.push({
                    x: spiral.x + Math.cos(particleAngle) * particleRadius,
                    y: spiral.y + Math.sin(particleAngle) * particleRadius,
                    size: Math.random() * 3 + 1,
                    opacity: Math.random() * 0.8 + 0.2,
                    vx: Math.cos(particleAngle) * 2,
                    vy: Math.sin(particleAngle) * 2,
                    life: 1.0,
                });
            }

            // Update and draw spiral particles
            for (let j = spiral.particles.length - 1; j >= 0; j--) {
                const p = spiral.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.02;
                p.opacity = p.life * 0.9;

                if (p.life <= 0) {
                    spiral.particles.splice(j, 1);
                    continue;
                }

                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(230, 240, 255, ${p.opacity})`;
                this.ctx.fill();
            }

            if (spiral.life <= 0 || spiral.radius > spiral.maxRadius) {
                this.spiralSystems.splice(i, 1);
            }
        }

        // Update and draw horizontal streak particles
        for (let i = this.streakParticles.length - 1; i >= 0; i--) {
            const streak = this.streakParticles[i];

            streak.x += streak.vx;
            streak.y += streak.vy;
            streak.life -= 0.015;
            streak.opacity = streak.life * 0.9;

            if (streak.life <= 0
                || streak.x < -200
                || streak.x > this.canvas.width + 200) {
                this.streakParticles.splice(i, 1);
                continue;
            }

            // Draw long horizontal streak
            const streakGradient = this.ctx.createLinearGradient(
                streak.x,
                streak.y,
                streak.x - Math.sign(streak.vx) * streak.length,
                streak.y,
            );
            streakGradient.addColorStop(0, `rgba(240, 245, 255, ${streak.opacity})`);
            streakGradient.addColorStop(0.3, `rgba(220, 230, 245, ${streak.opacity * 0.6})`);
            streakGradient.addColorStop(1, 'rgba(200, 215, 235, 0)');

            this.ctx.beginPath();
            this.ctx.moveTo(streak.x, streak.y);
            this.ctx.lineTo(streak.x - Math.sign(streak.vx) * streak.length, streak.y);
            this.ctx.strokeStyle = streakGradient;
            this.ctx.lineWidth = streak.size;
            this.ctx.lineCap = 'round';
            this.ctx.stroke();
        }

        // Update and draw vortex particles
        for (let i = this.vortexParticles.length - 1; i >= 0; i--) {
            const particle = this.vortexParticles[i];

            particle.x += Math.cos(particle.angle) * particle.speed;
            particle.y += Math.sin(particle.angle) * particle.speed * 0.5;
            particle.angle += 0.15;
            particle.rotation += particle.rotationSpeed;
            particle.life -= 0.012;
            particle.opacity = particle.life * 0.9;

            if (particle.life <= 0 || particle.y > this.canvas.height) {
                this.vortexParticles.splice(i, 1);
                continue;
            }

            this.ctx.save();
            this.ctx.translate(particle.x, particle.y);
            this.ctx.rotate(particle.rotation);
            this.ctx.globalAlpha = particle.opacity;
            this.ctx.fillStyle = 'rgb(225, 235, 250)';
            this.ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
            this.ctx.restore();
        }

        // Spawn new snow particles during gusts (more during combos)
        const spawnChance = (0.8 + this.gustIntensity * 0.4) * this.comboMultiplier;
        const maxParticlesWithCombo = Math.floor(this.maxParticles * Math.min(this.comboMultiplier, 1.5)); // Cap combo boost
        if (this.snowParticles.length < maxParticlesWithCombo && Math.random() < spawnChance) {
            this.snowParticles.push(this.createSnowParticle(false));
        }

        // Sort only occasionally for performance - using quality preset interval
        if (this.time % this.activePreset.particleSortInterval === 0) {
            this.snowParticles.sort((a, b) => a.z - b.z);
        }

        // Optimize: Use reverse loop and swap-remove pattern
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const margin = this.offscreenMargin;

        for (let i = this.snowParticles.length - 1; i >= 0; i--) {
            const particle = this.snowParticles[i];

            // Wind influence increases with gust intensity and combo
            const windInfluence = this.windForce * (0.4 + particle.z * 0.6) * (1 + this.gustIntensity * 0.8) * this.comboMultiplier;
            const gustTurbulence = this.gustIntensity * (Math.random() - 0.5) * 3;

            particle.vx += (windInfluence + gustTurbulence - particle.vx) * 0.08;
            particle.wobble += particle.wobbleSpeed;

            // Horizontal movement with wobble
            particle.x += particle.vx + Math.sin(particle.wobble) * 0.8 * (1 + this.gustIntensity * 1.5);

            // Vertical movement (faster during gusts and combos)
            particle.y += particle.vy * (1 + this.gustIntensity * 0.7) * this.comboMultiplier;

            particle.rotation += particle.rotationSpeed * (1 + this.gustIntensity);

            // Trail system for motion blur (optimize trail management)
            if (particle.trail.length < particle.maxTrailLength) {
                particle.trail.unshift({ x: particle.x, y: particle.y, opacity: particle.opacity });
            } else {
                // Reuse the last trail object
                const last = particle.trail.pop();
                last.x = particle.x;
                last.y = particle.y;
                last.opacity = particle.opacity;
                particle.trail.unshift(last);
            }

            // Tighter culling for offscreen particles
            if (particle.y > canvasHeight + margin
                || particle.x < -margin
                || particle.x > canvasWidth + margin) {
                this.releaseParticle('snow', particle);
                this.snowParticles.splice(i, 1);
                continue;
            }

            // Trail rendering based on quality settings
            if (this.activePreset.enableTrails && particle.trail.length > 2) {
                const { trailComplexity } = this.activePreset;

                // Quality 0: no trails
                // Quality 1: only very near particles with simplified trails
                // Quality 2: near particles with full trails
                // Quality 3: all particles with enhanced trails
                const shouldRenderTrail = trailComplexity === 3
                    || (trailComplexity === 2 && particle.z > 0.4)
                    || (trailComplexity === 1 && particle.z > 0.5);

                if (shouldRenderTrail) {
                    // Draw simplified trail using line instead of circles (much faster)
                    this.ctx.globalAlpha = particle.opacity * 0.3;
                    this.ctx.strokeStyle = 'rgba(180, 195, 220, 1)';
                    this.ctx.lineWidth = particle.size * 0.5;
                    this.ctx.lineCap = 'round';
                    this.ctx.beginPath();
                    this.ctx.moveTo(particle.trail[0].x, particle.trail[0].y);

                    // Skip more points for lower complexity
                    const skipPoints = trailComplexity === 3 ? 2 : 3;
                    for (let j = skipPoints; j < particle.trail.length; j += skipPoints) {
                        this.ctx.lineTo(particle.trail[j].x, particle.trail[j].y);
                    }
                    this.ctx.stroke();
                    this.ctx.globalAlpha = 1;
                }
            }

            // Draw main particle with rotation (optimized - no shadow blur)
            this.ctx.save();
            this.ctx.translate(particle.x, particle.y);
            this.ctx.rotate(particle.rotation);

            // Main particle (elongated for wind streak effect)
            const streakLength = 1 + Math.abs(this.windForce) * 0.4 * particle.z;
            this.ctx.globalAlpha = particle.opacity;
            this.ctx.fillStyle = 'rgba(240, 245, 255, 1)';
            this.ctx.beginPath();
            this.ctx.ellipse(
                0,
                0,
                particle.size,
                particle.size * streakLength,
                Math.atan2(particle.vy, particle.vx),
                0,
                Math.PI * 2,
            );
            this.ctx.fill();

            // Highlight (only for very near particles to save performance)
            if (particle.z > 0.6) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                this.ctx.beginPath();
                this.ctx.arc(-particle.size * 0.2, -particle.size * 0.2, particle.size * 0.5, 0, Math.PI * 2);
                this.ctx.fill();
            }

            this.ctx.globalAlpha = 1;
            this.ctx.restore();
        }

        // Atmospheric overlay during intense gusts
        if (this.gustIntensity > 0.4) {
            const overlayOpacity = (this.gustIntensity - 0.4) * 0.4 * this.comboMultiplier;
            const overlayGradient = this.ctx.createLinearGradient(0, 0, this.canvas.width * (this.windForce > 0 ? 1 : -1), this.canvas.height);
            overlayGradient.addColorStop(0, `rgba(210, 220, 235, ${overlayOpacity})`);
            overlayGradient.addColorStop(0.5, `rgba(190, 205, 225, ${overlayOpacity * 0.6})`);
            overlayGradient.addColorStop(1, 'rgba(170, 185, 210, 0)');
            this.ctx.fillStyle = overlayGradient;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // Add wind direction indicators - using quality preset interval
        if (Math.abs(this.windForce) > 4 && this.time % this.activePreset.windIndicatorInterval === 0) {
            const streakCount = Math.floor(Math.abs(this.windForce) * 1.5 * Math.min(this.comboMultiplier, 1.3)); // Reduced count
            const angle = Math.atan2(1, this.windForce);

            for (let i = 0; i < streakCount; i++) {
                const x = Math.random() * canvasWidth;
                const y = Math.random() * canvasHeight;
                const length = Math.abs(this.windForce) * 25 * (0.5 + Math.random() * 0.5);

                this.ctx.beginPath();
                this.ctx.moveTo(x, y);
                this.ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length * 0.3);
                this.ctx.strokeStyle = `rgba(210, 225, 240, ${Math.random() * 0.25 + 0.1})`;
                this.ctx.lineWidth = Math.random() * 2 + 0.5;
                this.ctx.stroke();
            }
        }

        // Vignette effect for depth (cached)
        this.ctx.fillStyle = this.getCachedVignetteGradient();
        this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        this.ctx.restore(); // Restore from camera shake

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    stop() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        this.teardownEventListeners();
        this.pendingComboCount = 0;

        // Remove graphics quality listener
        this.teardownQualityListener();

        super.stop();
    }
}
