import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { RAINY_WINDOW_TETROMINOS } from './rainy-window-tetrominos.js';

export default class RainyWindowTheme extends BaseTheme {
    constructor() {
        super('rainy-window');
        this.canvas = null;
        this.ctx = null;
        this.drops = [];
        this.ripples = [];
        this.splashes = [];
        this.lightningBolts = [];
        this.mistParticles = [];
        this.resizeHandler = null;
        this.waterSurfaceY = 0;
        this.time = 0;
        this.nextLightning = Math.random() * 300 + 200;
        this.windForce = 0;
        this.targetWindForce = 0;
        this.nextWindChange = Math.random() * 200 + 100;
        this.maxDrops = 180; // Reduced by 10% for better performance
        this.dropSpawnProbability = 0.45;
        this.currentDropCap = 63; // Reduced by 10% for better performance
        this.maxRipples = 120;
        this.lightningFlashIntensity = 0;
        this.lightningRipples = [];
        this.gustIntensity = 0;
        this.nextGust = Math.random() * 200 + 100;
        this.gustDuration = 0;

        // Gameplay effects
        this.comboMultiplier = 1.0;
        this.comboDecay = 0;
        this.rainBurstDrops = [];
        this.thunderStrikes = [];
        this.waterExplosions = [];
        this.comboRainCurtains = [];
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        // Effect limits (Ultra defaults)
        this.maxMistParticles = 250;
        this.maxSplashes = 50;
        this.maxActiveDrops = 350;
        this.maxRainBurstDrops = 100;
        this.maxThunderStrikes = 6;
        this.maxComboRainCurtains = 4;
        this.maxLightningBolts = 4;
        this.lightningEnabled = true;
        this.lightningIntervalMin = 200;
        this.lightningIntervalMax = 500;
        this.gustIntensityMultiplier = 1;
        this.comboEffectScale = 1;
        this.mistSpawnMultiplier = 1;
        this.splashSpawnMultiplier = 1;

        // Graphics quality
        this.qualityChangeHandler = null;
        this.qualityPresets = {
            Minimal: {
                maxDrops: 50,
                dropSpawnProbability: 0.15,
                currentDropCap: 25,
                maxRipples: 30,
                maxMistParticles: 80,
                maxSplashes: 12,
                maxActiveDrops: 100,
                maxRainBurstDrops: 20,
                maxThunderStrikes: 0,
                maxComboRainCurtains: 0,
                maxLightningBolts: 0,
                lightningEnabled: false,
                lightningIntervalMin: 900,
                lightningIntervalMax: 1200,
                gustIntensityMultiplier: 0.5,
                comboEffectScale: 0.3,
                mistSpawnMultiplier: 0.4,
                splashSpawnMultiplier: 0.5,
            },
            Low: {
                maxDrops: 80,
                dropSpawnProbability: 0.22,
                currentDropCap: 35,
                maxRipples: 50,
                maxMistParticles: 120,
                maxSplashes: 20,
                maxActiveDrops: 160,
                maxRainBurstDrops: 35,
                maxThunderStrikes: 1,
                maxComboRainCurtains: 1,
                maxLightningBolts: 1,
                lightningEnabled: false,
                lightningIntervalMin: 700,
                lightningIntervalMax: 1000,
                gustIntensityMultiplier: 0.6,
                comboEffectScale: 0.45,
                mistSpawnMultiplier: 0.5,
                splashSpawnMultiplier: 0.6,
            },
            Medium: {
                maxDrops: 120,
                dropSpawnProbability: 0.32,
                currentDropCap: 48,
                maxRipples: 60,
                maxMistParticles: 170,
                maxSplashes: 30,
                maxActiveDrops: 240,
                maxRainBurstDrops: 60,
                maxThunderStrikes: 3,
                maxComboRainCurtains: 2,
                maxLightningBolts: 2,
                lightningEnabled: true,
                lightningIntervalMin: 400,
                lightningIntervalMax: 650,
                gustIntensityMultiplier: 0.75,
                comboEffectScale: 0.7,
                mistSpawnMultiplier: 0.7,
                splashSpawnMultiplier: 0.8,
            },
            High: {
                maxDrops: 150,
                dropSpawnProbability: 0.4,
                currentDropCap: 58,
                maxRipples: 80,
                maxMistParticles: 210,
                maxSplashes: 40,
                maxActiveDrops: 280,
                maxRainBurstDrops: 80,
                maxThunderStrikes: 4,
                maxComboRainCurtains: 3,
                maxLightningBolts: 3,
                lightningEnabled: true,
                lightningIntervalMin: 280,
                lightningIntervalMax: 520,
                gustIntensityMultiplier: 0.9,
                comboEffectScale: 0.85,
                mistSpawnMultiplier: 0.85,
                splashSpawnMultiplier: 0.9,
            },
            Ultra: {
                maxDrops: 180,
                dropSpawnProbability: 0.45,
                currentDropCap: 63,
                maxRipples: 100,
                maxMistParticles: 250,
                maxSplashes: 50,
                maxActiveDrops: 350,
                maxRainBurstDrops: 100,
                maxThunderStrikes: 6,
                maxComboRainCurtains: 4,
                maxLightningBolts: 4,
                lightningEnabled: true,
                lightningIntervalMin: 200,
                lightningIntervalMax: 500,
                gustIntensityMultiplier: 1,
                comboEffectScale: 1,
                mistSpawnMultiplier: 1,
                splashSpawnMultiplier: 1,
            },
            Extreme: {
                maxDrops: 250,
                dropSpawnProbability: 0.55,
                currentDropCap: 85,
                maxRipples: 140,
                maxMistParticles: 350,
                maxSplashes: 70,
                maxActiveDrops: 500,
                maxRainBurstDrops: 150,
                maxThunderStrikes: 10,
                maxComboRainCurtains: 6,
                maxLightningBolts: 6,
                lightningEnabled: true,
                lightningIntervalMin: 150,
                lightningIntervalMax: 400,
                gustIntensityMultiplier: 1.2,
                comboEffectScale: 1.3,
                mistSpawnMultiplier: 1.3,
                splashSpawnMultiplier: 1.3,
            },
        };
        this.currentQuality = 'Ultra';
        this.activePreset = this.qualityPresets.Ultra;

        // Performance optimization: Cache static data to avoid recreation every frame
        this.colorSchemes = {
            lightning: {
                base: { r: 140, g: 180, b: 255 },
                highlight: { r: 200, g: 230, b: 255 },
                accent: { r: 230, g: 245, b: 255 },
            },
            splash: {
                base: { r: 160, g: 200, b: 235 },
                highlight: { r: 200, g: 230, b: 250 },
                accent: { r: 220, g: 240, b: 255 },
            },
            strong: {
                base: { r: 140, g: 175, b: 220 },
                highlight: { r: 180, g: 210, b: 245 },
                accent: { r: 200, g: 225, b: 255 },
            },
            gentle: {
                base: { r: 120, g: 155, b: 190 },
                highlight: { r: 160, g: 195, b: 230 },
                accent: { r: 180, g: 210, b: 240 },
            },
            normal: {
                base: { r: 125, g: 160, b: 200 },
                highlight: { r: 165, g: 195, b: 230 },
                accent: { r: 185, g: 210, b: 240 },
            },
        };

        this.ringConfigs = {
            lightning: { count: 5, spacing: 12, pattern: 'electric' },
            splash: { count: 4, spacing: 15, pattern: 'burst' },
            strong: { count: 6, spacing: 8, pattern: 'wave' },
            gentle: { count: 5, spacing: 12, pattern: 'smooth' },
            normal: { count: 5, spacing: 10, pattern: 'standard' },
        };

        this.fadeRates = {
            lightning: 0.003,
            splash: 0.008,
            strong: 0.005,
            gentle: 0.006,
            normal: 0.007,
        };
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[RainyWindow] Unknown preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        const preset = this.activePreset;

        this.maxDrops = preset.maxDrops;
        this.dropSpawnProbability = preset.dropSpawnProbability;
        this.currentDropCap = Math.min(preset.currentDropCap, this.maxDrops);
        this.maxRipples = preset.maxRipples;
        this.maxMistParticles = preset.maxMistParticles;
        this.maxSplashes = preset.maxSplashes;
        this.maxActiveDrops = preset.maxActiveDrops;
        this.maxRainBurstDrops = preset.maxRainBurstDrops;
        this.maxThunderStrikes = preset.maxThunderStrikes;
        this.maxComboRainCurtains = preset.maxComboRainCurtains;
        this.maxLightningBolts = preset.maxLightningBolts;
        this.lightningEnabled = preset.lightningEnabled;
        this.lightningIntervalMin = preset.lightningIntervalMin;
        this.lightningIntervalMax = preset.lightningIntervalMax;
        this.gustIntensityMultiplier = preset.gustIntensityMultiplier;
        this.comboEffectScale = preset.comboEffectScale;
        this.mistSpawnMultiplier = preset.mistSpawnMultiplier;
        this.splashSpawnMultiplier = preset.splashSpawnMultiplier;

        this.trimEffectCollections();
        this.scheduleNextLightning();

        console.log(`[RainyWindow] Applying ${quality} graphics preset`);
    }

    trimEffectCollections() {
        const clamp = (collection, limit) => {
            if (!collection || typeof limit !== 'number' || limit <= 0) return;
            if (collection.length > limit) {
                collection.splice(0, collection.length - limit);
            }
        };

        clamp(this.drops, this.maxActiveDrops);
        clamp(this.ripples, this.maxRipples);
        clamp(this.splashes, this.maxSplashes);
        clamp(this.mistParticles, this.maxMistParticles);
        clamp(this.lightningBolts, this.maxLightningBolts);
        clamp(this.thunderStrikes, this.maxThunderStrikes);
        clamp(this.comboRainCurtains, this.maxComboRainCurtains);
        clamp(this.rainBurstDrops, this.maxRainBurstDrops);

        if (!this.lightningEnabled) {
            this.lightningBolts.length = 0;
            this.lightningRipples.length = 0;
            this.thunderStrikes.length = 0;
        }
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;

        this.teardownQualityListener();

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;
            this.applyQualityPreset(newQuality);
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    scheduleNextLightning() {
        if (!this.lightningEnabled) {
            this.nextLightning = Infinity;
            return;
        }

        const min = this.lightningIntervalMin ?? 200;
        const max = this.lightningIntervalMax ?? 500;
        const interval = Math.random() * (max - min) + min;
        this.nextLightning = this.time + interval;
    }

    async createScene() {
        this.canvas = document.getElementById('rain-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();
        this.scheduleNextLightning();

        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        this.drops = [];
        this.ripples = [];
        this.splashes = [];
        this.mistParticles = [];

        for (let i = 0; i < Math.min(this.currentDropCap, 90); i++) {
            this.drops.push(this.createDrop(true));
        }

        this.setupEventListeners();
        this.animate();
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
        if (!this.eventUnsubscribers.length) return;

        this.eventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe?.();
            } catch (error) {
                console.error('[RainyWindowTheme] Failed to remove event listener', error);
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

    handleLineClear(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        this.onLineClear(lineCount, comboCount);
    }

    handleCombo(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }
    }

    onLineClear(lineCount, comboCount) {
        // Increase combo multiplier
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.comboDecay = 180; // 3 seconds at 60fps

        // Create rain burst - intense rain from line clears
        const burstCount = Math.min(
            Math.ceil((lineCount * 15 + comboCount * 10) * this.comboEffectScale),
            this.maxRainBurstDrops,
        );
        for (let i = 0; i < burstCount; i++) {
            this.rainBurstDrops.push(this.createRainBurstDrop(lineCount));
        }

        // Trigger wind gust and rain intensity
        const gustBonus = (lineCount * 1.5 + comboCount * 2) * this.gustIntensityMultiplier;
        this.targetWindForce = (Math.random() < 0.5 ? -1 : 1) * (4 + gustBonus);
        this.gustIntensity = Math.min((0.4 + lineCount * 0.15) * this.gustIntensityMultiplier, 1.0);
        this.gustDuration = (30 + lineCount * 15) * this.gustIntensityMultiplier;

        // Increase drop spawn rate temporarily
        this.currentDropCap = Math.min(
            this.currentDropCap + lineCount * 10 * this.comboEffectScale,
            this.maxDrops,
        );

        // Create water explosion on water surface
        const explosionCount = Math.min(
            Math.ceil((lineCount + Math.floor(comboCount / 2)) * this.comboEffectScale),
            4,
        );
        for (let i = 0; i < explosionCount; i++) {
            const x = Math.random() * this.canvas.width;
            const depth = Math.random();
            this.waterExplosions.push(this.createWaterExplosion(x, this.getWaterY(depth), depth, lineCount));
        }

        // Thunder strikes for combos
        if (comboCount >= 3) {
            this.createComboThunderStrike(comboCount);
        }

        // Rain curtains for big combos
        if (comboCount >= 5 && this.comboRainCurtains.length < this.maxComboRainCurtains) {
            const availableSlots = this.maxComboRainCurtains - this.comboRainCurtains.length;
            const curtainCount = Math.min(Math.floor(comboCount / 3), 3, availableSlots);
            for (let i = 0; i < curtainCount; i++) {
                this.comboRainCurtains.push(this.createRainCurtain());
            }
        }

        // Flash effect for big line clears
        if (lineCount >= 3) {
            this.lightningFlashIntensity = Math.min(
                (0.15 + lineCount * 0.05) * this.comboEffectScale,
                0.35,
            );
        }
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        // Water surface starts at 60% down the screen
        this.waterSurfaceY = this.canvas.height * 0.6;

        // Performance optimization: Pre-create gradients that don't change
        this.baseSkyGradient = this.ctx.createLinearGradient(0, 0, 0, this.waterSurfaceY);
        this.baseSkyGradient.addColorStop(0, 'rgb(8, 9, 14)');
        this.baseSkyGradient.addColorStop(0.5, 'rgb(14, 16, 20)');
        this.baseSkyGradient.addColorStop(1, 'rgb(20, 22, 28)');

        // Cache fog gradients (3 layers)
        this.fogGradients = [];
        for (let i = 0; i < 3; i++) {
            const fogY = this.waterSurfaceY - (i * 100) - 50;
            const fogGradient = this.ctx.createLinearGradient(0, fogY - 40, 0, fogY + 40);
            fogGradient.addColorStop(0, 'rgba(30, 40, 50, 0)');
            fogGradient.addColorStop(0.5, `rgba(30, 40, 50, ${0.03 + i * 0.01})`);
            fogGradient.addColorStop(1, 'rgba(30, 40, 50, 0)');
            this.fogGradients.push({ gradient: fogGradient, y: fogY });
        }
    }

    createDrop(isInitial) {
        const maxY = isInitial ? this.waterSurfaceY : -50;
        const length = Math.random() * 15 + 10;
        return {
            x: Math.random() * this.canvas.width,
            y: isInitial ? Math.random() * maxY : -Math.random() * 100,
            z: Math.random(), // Depth: 0 (far) to 1 (near)
            r: Math.random() * 1.8 + 1.2,
            vy: Math.random() * 6 + 5,
            vx: Math.random() * 0.5 - 0.25,
            opacity: Math.random() * 0.5 + 0.4,
            length,
            baseLength: length,
        };
    }

    createRipple(x, y, dropSize, depth, isLightning = false) {
        // Scale ripple size based on depth (smaller = farther away)
        const depthScale = 0.3 + depth * 0.7;

        // Create variety in ripple types with distinct visual styles
        let rippleType; let
            style;
        if (isLightning) {
            rippleType = 'lightning';
            style = 'electric'; // Electric burst pattern
        } else {
            const rand = Math.random();
            if (rand < 0.2) {
                rippleType = 'splash';
                style = 'burst'; // Fast expanding burst
            } else if (rand < 0.4) {
                rippleType = 'strong';
                style = 'wave'; // Multiple wave rings
            } else if (rand < 0.6) {
                rippleType = 'gentle';
                style = 'smooth'; // Smooth expanding circle
            } else {
                rippleType = 'normal';
                style = 'ripple'; // Standard ripple
            }
        }

        const sizeMultiplier = {
            splash: 1.8,
            strong: 1.4,
            gentle: 0.8,
            normal: 1.0,
            lightning: 2.0,
        }[rippleType];

        const speedMultiplier = {
            splash: 1.5,
            strong: 1.0,
            gentle: 0.7,
            normal: 1.0,
            lightning: 1.2,
        }[rippleType];

        return {
            x,
            y,
            radius: 0,
            maxRadius: (dropSize * 10 + Math.random() * 30 + 40) * depthScale * sizeMultiplier,
            opacity: rippleType === 'splash' ? 1.5 : (rippleType === 'strong' ? 1.2 : 1.0),
            speed: (Math.random() * 0.8 + 0.6) * depthScale * speedMultiplier,
            lineWidth: (Math.random() * 2 + 1.5) * depthScale * (rippleType === 'splash' ? 1.5 : rippleType === 'strong' ? 1.3 : 1.0),
            depth,
            phase: 0,
            frequency: Math.random() * 0.1 + 0.05,
            isLightning,
            shimmer: Math.random() * Math.PI * 2,
            rippleType,
            style,
            pulseSpeed: Math.random() * 0.05 + 0.03,
            rotation: Math.random() * Math.PI * 2, // Random rotation for variety
        };
    }

    createLightningBolt() {
        if (!this.lightningEnabled) return null;

        const startX = this.canvas.width * (0.15 + Math.random() * 0.7);
        const mainSegs = [];
        const branchSegs = [];
        let x = startX;
        let y = 0;
        const targetY = this.waterSurfaceY + Math.random() * 100;
        const depth = Math.random();

        // Main bolt - separate segments by type for performance
        while (y < targetY) {
            const nextY = y + Math.random() * 30 + 20;
            const nextX = x + (Math.random() - 0.5) * 40;
            mainSegs.push({
                x1: x, y1: y, x2: nextX, y2: nextY,
            });

            // Random branches
            if (Math.random() > 0.7) {
                const branchLength = Math.random() * 100 + 50;
                const branchAngle = (Math.random() - 0.5) * Math.PI * 0.6;
                const bx = nextX + Math.cos(branchAngle) * branchLength;
                const by = nextY + Math.sin(branchAngle) * branchLength;
                branchSegs.push({
                    x1: nextX, y1: nextY, x2: bx, y2: by,
                });
            }

            x = nextX;
            y = nextY;
        }

        return {
            mainSegs,
            branchSegs,
            opacity: 1.0,
            life: 1.0,
            glowIntensity: 1.0,
            originX: startX,
            originY: 0,
            impactX: x, // Final x position where bolt ends
            impactY: y, // Final y position where bolt ends
            depth,
        };
    }

    createMist(x, y, depth) {
        const particles = [];
        const baseCount = Math.floor(Math.random() * 6) + 4;
        const count = Math.max(1, Math.round(baseCount * this.mistSpawnMultiplier));
        const depthScale = 0.3 + depth * 0.7;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 1.5 + 0.5;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed * depthScale,
                vy: -Math.random() * 2 - 1, // Upward drift
                life: 1.0,
                size: (Math.random() * 3 + 2) * depthScale,
                opacity: Math.random() * 0.3 + 0.2,
            });
        }
        return particles;
    }

    createSplash(x, y, depth) {
        const particles = [];
        const baseCount = Math.floor(Math.random() * 4) + 3;
        const count = Math.max(1, Math.round(baseCount * this.splashSpawnMultiplier));
        const depthScale = 0.3 + depth * 0.7;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 0.8;
            const speed = (Math.random() * 3 + 2) * depthScale;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed * -1,
                life: 1.0,
                size: (Math.random() * 2 + 1) * depthScale,
            });
        }
        return particles;
    }

    createRainBurstDrop(lineCount) {
        const depth = Math.random();
        const depthScale = 0.4 + depth * 0.6;
        const intensity = 1 + lineCount * 0.3;

        return {
            x: Math.random() * this.canvas.width,
            y: -Math.random() * 200 - 50,
            z: depth,
            r: (Math.random() * 2 + 1.5) * depthScale * intensity,
            vy: (Math.random() * 8 + 10) * depthScale * intensity,
            vx: (Math.random() - 0.5) * 2,
            opacity: Math.random() * 0.6 + 0.5,
            length: (Math.random() * 20 + 15) * intensity,
            baseLength: (Math.random() * 20 + 15) * intensity,
            life: 1.0,
            glow: Math.random() * 0.5 + 0.5,
        };
    }

    createComboThunderStrike(comboCount) {
        const bolt = this.createLightningBolt();
        if (!bolt) return;
        bolt.intensity = Math.min(comboCount * 0.2, 1.5);
        bolt.glowIntensity = Math.min(comboCount * 0.3, 2.0);
        if (this.thunderStrikes.length >= this.maxThunderStrikes) {
            this.thunderStrikes.shift();
        }
        this.thunderStrikes.push(bolt);

        // Flash intensity based on combo
        this.lightningFlashIntensity = Math.min(0.2 + comboCount * 0.05, 0.4);

        // Create multiple ripples
        const waterY = this.getWaterY(bolt.depth);
        const numRipples = Math.min(
            Math.max(1, Math.floor((3 + comboCount) * this.comboEffectScale)),
            8,
        );
        for (let i = 0; i < numRipples && this.lightningRipples.length < this.maxRipples; i++) {
            this.lightningRipples.push({
                x: bolt.impactX + (Math.random() - 0.5) * 100,
                y: waterY,
                depth: bolt.depth,
                size: 12 + Math.random() * 10,
                delay: i * 2,
                spawned: false,
            });
        }
    }

    createWaterExplosion(x, y, depth, lineCount) {
        const particles = [];
        const count = Math.min(20 + lineCount * 5, 40);
        const depthScale = 0.3 + depth * 0.7;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = (Math.random() * 8 + 4) * depthScale;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - Math.random() * 3,
                size: (Math.random() * 3 + 2) * depthScale,
                opacity: Math.random() * 0.8 + 0.4,
                life: 1.0,
                gravity: 0.25,
                glow: Math.random() * 0.6 + 0.4,
            });
        }

        return {
            x,
            y,
            depth,
            particles,
            ripplePhase: 0,
            life: 1.0,
        };
    }

    createRainCurtain() {
        const x = Math.random() * this.canvas.width;
        const width = Math.random() * 150 + 100;
        const drops = [];
        const dropCount = Math.floor(width / 8);

        for (let i = 0; i < dropCount; i++) {
            const offsetX = (i / dropCount) * width - width / 2;
            drops.push({
                x: x + offsetX,
                y: -Math.random() * 100,
                vy: Math.random() * 12 + 15,
                length: Math.random() * 25 + 20,
                size: Math.random() * 2.5 + 1.5,
                opacity: Math.random() * 0.7 + 0.5,
                delay: Math.random() * 20,
            });
        }

        return {
            x,
            width,
            drops,
            life: 1.0,
            intensity: 1.0,
        };
    }

    // Calculate Y position on water surface based on depth
    getWaterY(depth) {
        // Creates perspective: far (depth=0) appears higher, near (depth=1) appears lower
        const perspectiveRange = this.canvas.height * 0.3;
        return this.waterSurfaceY + (depth * perspectiveRange);
    }

    drawWaterSurface() {
        const surfaceHeight = this.canvas.height - this.waterSurfaceY;

        const waterGradient = this.ctx.createLinearGradient(0, this.waterSurfaceY, 0, this.canvas.height);
        waterGradient.addColorStop(0, 'rgba(20, 24, 34, 0.9)');
        waterGradient.addColorStop(0.5, 'rgba(14, 16, 22, 0.95)');
        waterGradient.addColorStop(1, 'rgba(6, 7, 12, 1)');
        this.ctx.fillStyle = waterGradient;
        this.ctx.fillRect(0, this.waterSurfaceY, this.canvas.width, surfaceHeight);

        // Draw perspective grid lines for depth perception
        this.ctx.strokeStyle = 'rgba(60, 75, 90, 0.08)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) {
            const depth = i / 10;
            const y = this.getWaterY(depth);
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }

        // Draw subtle water surface line with animation at horizon
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.waterSurfaceY);

        for (let x = 0; x < this.canvas.width; x += 20) {
            const wave = Math.sin((x + this.time) * 0.01) * 1.5;
            this.ctx.lineTo(x, this.waterSurfaceY + wave);
        }

        this.ctx.strokeStyle = 'rgba(100, 120, 140, 0.4)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Add atmospheric perspective fog
        const fogGradient = this.ctx.createLinearGradient(0, this.waterSurfaceY, 0, this.waterSurfaceY + 150);
        fogGradient.addColorStop(0, 'rgba(40, 50, 60, 0.2)');
        fogGradient.addColorStop(1, 'rgba(40, 50, 60, 0)');
        this.ctx.fillStyle = fogGradient;
        this.ctx.fillRect(0, this.waterSurfaceY, this.canvas.width, 150);
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

        // Dynamic wind system with gusts (slower, less erratic)
        if (this.time >= this.nextWindChange) {
            this.targetWindForce = (Math.random() - 0.5) * 2; // Wind from -1 to 1 (reduced from 3)
            this.nextWindChange = this.time + Math.random() * 400 + 300; // Longer intervals
        }

        // Wind gust system
        if (this.time >= this.nextGust && this.gustDuration <= 0) {
            // Trigger a random wind gust
            const gustStrength = (Math.random() * 1.5 + 1) * this.gustIntensityMultiplier;
            const gustDirection = Math.random() < 0.5 ? -1 : 1;
            this.targetWindForce = gustDirection * gustStrength;
            this.gustIntensity = 1.0;
            this.gustDuration = (Math.random() * 40 + 30) * this.gustIntensityMultiplier; // 30-70 frames
            this.nextGust = this.time + Math.random() * 400 + 300; // Less frequent
        }

        // Fade gust intensity
        if (this.gustDuration > 0) {
            this.gustDuration -= 1;
            this.gustIntensity = Math.max(0, this.gustDuration / 50);
        } else {
            this.gustIntensity = 0;
        }

        // Smooth wind transition (slower transitions)
        const windTransitionSpeed = this.gustIntensity > 0 ? 0.05 : 0.015; // Slower than before
        this.windForce += (this.targetWindForce - this.windForce) * windTransitionSpeed;

        // Lightning timing
        if (this.lightningEnabled && this.time >= this.nextLightning) {
            const bolt = this.createLightningBolt();
            if (bolt) {
                if (this.lightningBolts.length >= this.maxLightningBolts) {
                    this.lightningBolts.shift();
                }
                this.lightningBolts.push(bolt);

                // Set flash intensity for atmospheric effect
                this.lightningFlashIntensity = Math.max(this.lightningFlashIntensity, 0.25);

                // Trigger wind gust with lightning
                const gustStrength = (Math.random() * 2.5 + 2) * this.gustIntensityMultiplier;
                const gustDirection = Math.random() < 0.5 ? -1 : 1;
                this.targetWindForce = gustDirection * gustStrength;
                this.gustIntensity = 1.0;
                this.gustDuration = (Math.random() * 50 + 40) * this.gustIntensityMultiplier; // 40-90 frames

                // Create ripples on water when lightning strikes (reduced for performance)
                const waterY = this.getWaterY(bolt.depth);
                const numRipples = Math.max(1, Math.floor((2 + Math.random() * 2) * this.comboEffectScale));
                for (let i = 0; i < numRipples && this.lightningRipples.length < this.maxRipples; i++) {
                    this.lightningRipples.push({
                        x: bolt.impactX + (Math.random() - 0.5) * 80,
                        y: waterY,
                        depth: bolt.depth,
                        size: 9 + Math.random() * 7,
                        delay: i * 3,
                        spawned: false,
                    });
                }
            }

            this.scheduleNextLightning();
        }

        // Fade lightning flash
        if (this.lightningFlashIntensity > 0) {
            this.lightningFlashIntensity -= 0.02;
        }

        // Spawn lightning ripples with delay
        for (let i = this.lightningRipples.length - 1; i >= 0; i--) {
            const lr = this.lightningRipples[i];
            lr.delay -= 1;
            if (lr.delay <= 0 && !lr.spawned) {
                if (this.ripples.length < this.maxRipples) {
                    this.ripples.push(this.createRipple(lr.x, lr.y, lr.size, lr.depth, true));
                }
                lr.spawned = true;
                this.lightningRipples.splice(i, 1);
            }
        }

        // Dark atmospheric background with lightning flash (optimized)
        if (this.lightningFlashIntensity > 0) {
            // Only create new gradient if there's a lightning flash
            const flashBoost = Math.floor(this.lightningFlashIntensity * 30);
            const skyGradient = this.ctx.createLinearGradient(0, 0, 0, this.waterSurfaceY);
            skyGradient.addColorStop(0, `rgb(${8 + flashBoost}, ${9 + flashBoost}, ${14 + flashBoost})`);
            skyGradient.addColorStop(0.5, `rgb(${14 + flashBoost}, ${16 + flashBoost}, ${20 + flashBoost})`);
            skyGradient.addColorStop(1, `rgb(${20 + flashBoost}, ${22 + flashBoost}, ${28 + flashBoost})`);
            this.ctx.fillStyle = skyGradient;
        } else {
            // Use cached gradient when no flash
            this.ctx.fillStyle = this.baseSkyGradient;
        }
        this.ctx.fillRect(0, 0, this.canvas.width, this.waterSurfaceY);

        // Draw water surface
        this.drawWaterSurface();

        // Add atmospheric fog layers (use cached gradients)
        for (let i = 0; i < 3; i++) {
            const fog = this.fogGradients[i];
            this.ctx.fillStyle = fog.gradient;
            this.ctx.fillRect(0, fog.y - 40, this.canvas.width, 80);
        }

        // Draw and update lightning bolts
        for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
            const bolt = this.lightningBolts[i];

            bolt.life -= 0.08;
            bolt.opacity = bolt.life;

            if (bolt.life <= 0) {
                this.lightningBolts.splice(i, 1);
                continue;
            }

            // Draw segments with batched rendering for better performance
            // Segments are already separated by type during creation
            this.ctx.lineCap = 'round';

            // Draw main segments (thickness = 3) - all layers
            if (bolt.mainSegs.length > 0) {
                const { mainSegs } = bolt;
                // Layer 1: Wide atmospheric glow
                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(120, 150, 200, ${bolt.opacity * 0.12})`;
                this.ctx.lineWidth = 3 * 12;
                this.ctx.stroke();

                // Layer 2: Extended outer glow
                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(150, 180, 220, ${bolt.opacity * 0.25})`;
                this.ctx.lineWidth = 3 * 8;
                this.ctx.stroke();

                // Layer 3: Outer glow
                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(180, 200, 235, ${bolt.opacity * 0.4})`;
                this.ctx.lineWidth = 3 * 5;
                this.ctx.stroke();

                // Layer 4: Middle glow
                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(200, 220, 245, ${bolt.opacity * 0.6})`;
                this.ctx.lineWidth = 3 * 2.5;
                this.ctx.stroke();

                // Layer 5: Core
                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(240, 245, 255, ${bolt.opacity})`;
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
            }

            // Draw branch segments (thickness = 1.5) - all layers
            if (bolt.branchSegs.length > 0) {
                const { branchSegs } = bolt;
                // Layer 1: Wide atmospheric glow
                this.ctx.beginPath();
                for (const seg of branchSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(120, 150, 200, ${bolt.opacity * 0.12})`;
                this.ctx.lineWidth = 1.5 * 12;
                this.ctx.stroke();

                // Layer 2: Extended outer glow
                this.ctx.beginPath();
                for (const seg of branchSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(150, 180, 220, ${bolt.opacity * 0.25})`;
                this.ctx.lineWidth = 1.5 * 8;
                this.ctx.stroke();

                // Layer 3: Outer glow
                this.ctx.beginPath();
                for (const seg of branchSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(180, 200, 235, ${bolt.opacity * 0.4})`;
                this.ctx.lineWidth = 1.5 * 5;
                this.ctx.stroke();

                // Layer 4: Middle glow
                this.ctx.beginPath();
                for (const seg of branchSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(200, 220, 245, ${bolt.opacity * 0.6})`;
                this.ctx.lineWidth = 1.5 * 2.5;
                this.ctx.stroke();

                // Layer 5: Core
                this.ctx.beginPath();
                for (const seg of branchSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(240, 245, 255, ${bolt.opacity})`;
                this.ctx.lineWidth = 1.5;
                this.ctx.stroke();
            }
        }

        // Draw and update combo thunder strikes
        for (let i = this.thunderStrikes.length - 1; i >= 0; i--) {
            const bolt = this.thunderStrikes[i];

            bolt.life -= 0.1;
            bolt.opacity = bolt.life * bolt.intensity;

            if (bolt.life <= 0) {
                this.thunderStrikes.splice(i, 1);
                continue;
            }

            this.ctx.lineCap = 'round';

            // Enhanced rendering for combo thunder
            if (bolt.mainSegs.length > 0) {
                const { mainSegs } = bolt;

                // Extra wide atmospheric glow
                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(140, 170, 220, ${bolt.opacity * 0.15 * bolt.glowIntensity})`;
                this.ctx.lineWidth = 3 * 16;
                this.ctx.stroke();

                // Wide glow
                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(160, 190, 240, ${bolt.opacity * 0.3 * bolt.glowIntensity})`;
                this.ctx.lineWidth = 3 * 10;
                this.ctx.stroke();

                // Middle layers (same as regular lightning)
                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(180, 200, 235, ${bolt.opacity * 0.4})`;
                this.ctx.lineWidth = 3 * 5;
                this.ctx.stroke();

                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(200, 220, 245, ${bolt.opacity * 0.6})`;
                this.ctx.lineWidth = 3 * 2.5;
                this.ctx.stroke();

                // Bright core
                this.ctx.beginPath();
                for (const seg of mainSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(245, 250, 255, ${bolt.opacity * bolt.intensity})`;
                this.ctx.lineWidth = 3.5;
                this.ctx.stroke();
            }

            // Draw branch segments
            if (bolt.branchSegs.length > 0) {
                const { branchSegs } = bolt;

                this.ctx.beginPath();
                for (const seg of branchSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(140, 170, 220, ${bolt.opacity * 0.15 * bolt.glowIntensity})`;
                this.ctx.lineWidth = 1.5 * 14;
                this.ctx.stroke();

                this.ctx.beginPath();
                for (const seg of branchSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(200, 220, 245, ${bolt.opacity * 0.6})`;
                this.ctx.lineWidth = 1.5 * 2.5;
                this.ctx.stroke();

                this.ctx.beginPath();
                for (const seg of branchSegs) {
                    this.ctx.moveTo(seg.x1, seg.y1);
                    this.ctx.lineTo(seg.x2, seg.y2);
                }
                this.ctx.strokeStyle = `rgba(240, 250, 255, ${bolt.opacity * bolt.intensity})`;
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }
        }

        // Draw and update water explosions
        for (let i = this.waterExplosions.length - 1; i >= 0; i--) {
            const explosion = this.waterExplosions[i];

            explosion.life -= 0.02;
            explosion.ripplePhase += 0.15;

            if (explosion.life <= 0) {
                this.waterExplosions.splice(i, 1);
                continue;
            }

            // Update and draw particles
            for (let j = explosion.particles.length - 1; j >= 0; j--) {
                const p = explosion.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.vy += p.gravity;
                p.vx *= 0.98;
                p.life -= 0.025;
                p.opacity = p.life * 0.9;

                if (p.life <= 0 || p.y > this.canvas.height) {
                    explosion.particles.splice(j, 1);
                    continue;
                }

                // Draw glowing water particle
                this.ctx.globalAlpha = p.opacity * p.glow;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(180, 210, 240, 0.4)';
                this.ctx.fill();

                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(220, 240, 255, 1)';
                this.ctx.fill();
                this.ctx.globalAlpha = 1;
            }
        }

        // Draw and update rain curtains
        for (let i = this.comboRainCurtains.length - 1; i >= 0; i--) {
            const curtain = this.comboRainCurtains[i];

            curtain.life -= 0.008;
            curtain.intensity = curtain.life;

            if (curtain.life <= 0) {
                this.comboRainCurtains.splice(i, 1);
                continue;
            }

            // Update and draw curtain drops
            for (const drop of curtain.drops) {
                if (drop.delay > 0) {
                    drop.delay -= 1;
                    continue;
                }

                drop.y += drop.vy * curtain.intensity;

                const waterY = this.getWaterY(0.5);
                if (drop.y < waterY) {
                    const gradient = this.ctx.createLinearGradient(
                        drop.x,
                        drop.y - drop.length,
                        drop.x,
                        drop.y,
                    );
                    gradient.addColorStop(0, 'rgba(200, 230, 255, 0)');
                    gradient.addColorStop(0.5, `rgba(220, 240, 255, ${drop.opacity * curtain.intensity * 0.5})`);
                    gradient.addColorStop(1, `rgba(230, 245, 255, ${drop.opacity * curtain.intensity})`);

                    this.ctx.beginPath();
                    this.ctx.moveTo(drop.x, drop.y - drop.length);
                    this.ctx.lineTo(drop.x, drop.y);
                    this.ctx.strokeStyle = gradient;
                    this.ctx.lineWidth = drop.size;
                    this.ctx.lineCap = 'round';
                    this.ctx.stroke();

                    // Glowing drop head
                    this.ctx.globalAlpha = drop.opacity * curtain.intensity * 0.7;
                    this.ctx.beginPath();
                    this.ctx.arc(drop.x, drop.y, drop.size * 1.5, 0, Math.PI * 2);
                    this.ctx.fillStyle = 'rgba(240, 250, 255, 1)';
                    this.ctx.fill();
                    this.ctx.globalAlpha = 1;
                }

                // Create ripple when hitting water
                if (drop.y >= waterY && this.ripples.length < this.maxRipples) {
                    this.ripples.push(this.createRipple(drop.x, waterY, drop.size, 0.5, false));
                    drop.y = waterY + 100; // Move off screen
                }
            }
        }

        // Draw and update rain burst drops
        for (let i = this.rainBurstDrops.length - 1; i >= 0; i--) {
            const drop = this.rainBurstDrops[i];

            const windInfluence = this.windForce * (0.15 + drop.z * 0.25);
            drop.vx += (windInfluence - drop.vx) * 0.02;
            drop.y += drop.vy * this.comboMultiplier;
            drop.x += drop.vx;
            drop.life -= 0.015;

            const waterY = this.getWaterY(drop.z);

            if (drop.life <= 0 || drop.y >= waterY) {
                if (drop.y >= waterY && this.ripples.length < this.maxRipples) {
                    this.ripples.push(this.createRipple(drop.x, waterY, drop.r, drop.z));
                    if (
                        Math.random() > 0.6
                        && this.splashes.length < this.maxSplashes
                    ) {
                        this.splashes.push(this.createSplash(drop.x, waterY, drop.z));
                    }
                }
                this.rainBurstDrops.splice(i, 1);
                continue;
            }

            if (drop.y < waterY) {
                const depthScale = 0.4 + drop.z * 0.6;
                const scaledR = drop.r * depthScale;
                const scaledLength = drop.length * depthScale;

                // Enhanced glowing rain drop
                const gradient = this.ctx.createLinearGradient(
                    drop.x,
                    drop.y - scaledLength,
                    drop.x,
                    drop.y,
                );
                gradient.addColorStop(0, 'rgba(200, 230, 255, 0)');
                gradient.addColorStop(0.4, `rgba(220, 240, 255, ${drop.opacity * 0.5 * drop.glow})`);
                gradient.addColorStop(1, `rgba(240, 250, 255, ${drop.opacity * drop.glow})`);

                this.ctx.beginPath();
                this.ctx.moveTo(drop.x, drop.y - scaledLength);
                this.ctx.lineTo(drop.x, drop.y);
                this.ctx.strokeStyle = gradient;
                this.ctx.lineWidth = scaledR * 0.7;
                this.ctx.lineCap = 'round';
                this.ctx.stroke();

                // Bright glowing head
                this.ctx.globalAlpha = drop.opacity * drop.glow * 0.6;
                this.ctx.beginPath();
                this.ctx.arc(drop.x, drop.y, scaledR * 2, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(220, 240, 255, 0.5)';
                this.ctx.fill();

                this.ctx.beginPath();
                this.ctx.arc(drop.x, drop.y, scaledR, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(245, 250, 255, 1)';
                this.ctx.fill();
                this.ctx.globalAlpha = 1;
            }
        }

        // Spawn new raindrops (affected by wind gusts and combos)
        this.currentDropCap += (this.maxDrops - this.currentDropCap) * 0.0025;
        const gustSpawnBoost = 1 + this.gustIntensity * 0.3; // Spawn more drops during gusts
        const spawnChance = this.dropSpawnProbability * (0.6 + this.currentDropCap / this.maxDrops * 0.4) * (1 + Math.abs(this.windForce) * 0.12) * gustSpawnBoost;
        if (this.drops.length < this.currentDropCap && Math.random() < spawnChance) {
            const newDrop = this.createDrop(false);
            // Offset spawn position based on wind (rain comes from angle during gusts)
            newDrop.x += this.windForce * 50 * this.gustIntensity;
            this.drops.push(newDrop);
        }

        // Draw and update ripples on water surface with depth
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const ripple = this.ripples[i];

            ripple.radius += ripple.speed;
            ripple.phase += ripple.frequency;
            ripple.shimmer += ripple.pulseSpeed;

            // Use cached fade rates
            ripple.opacity -= this.fadeRates[ripple.rippleType];

            if (ripple.opacity <= 0 || ripple.radius >= ripple.maxRadius) {
                this.ripples.splice(i, 1);
                continue;
            }

            // Apply depth-based effects
            const { depth } = ripple;
            const depthAlpha = 0.4 + depth * 0.6;

            ripple.y = this.getWaterY(depth);

            // Realistic ripple wave pattern with oscillation
            const waveAmplitude = Math.sin(ripple.phase) * 0.3 + 0.7;
            const shimmerEffect = Math.sin(ripple.shimmer) * 0.4 + 0.6;
            const pulseEffect = Math.sin(ripple.shimmer * 1.5) * 0.2 + 0.8;

            // Use cached color schemes and ring configs
            const colors = this.colorSchemes[ripple.rippleType];
            const config = this.ringConfigs[ripple.rippleType];

            // Render based on ripple pattern/style
            for (let j = 0; j < config.count; j++) {
                const waveOffset = j * config.spacing * (0.3 + depth * 0.7);
                const offsetRadius = ripple.radius - waveOffset;
                if (offsetRadius <= 0) continue;

                const waveAlpha = ripple.opacity * (1 - j * 0.13) * depthAlpha * waveAmplitude * pulseEffect;
                const flatten = 0.3 + depth * 0.35;

                this.ctx.save();
                this.ctx.translate(ripple.x, ripple.y);
                this.ctx.scale(1, flatten);

                // Different rotation patterns for each style
                if (config.pattern === 'electric') {
                    this.ctx.rotate(ripple.rotation + Math.sin(ripple.phase * 2 + j) * 0.1);
                } else if (config.pattern === 'burst') {
                    this.ctx.rotate(ripple.rotation + j * 0.3);
                } else if (config.pattern === 'wave') {
                    this.ctx.rotate(Math.sin(ripple.phase + j * 0.5) * 0.05);
                } else {
                    this.ctx.rotate(Math.sin(ripple.phase + j) * 0.02);
                }

                // Pattern-specific rendering
                if (config.pattern === 'electric') {
                    // Lightning: Optimized electric look with 2 layers (reduced from 3)
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                    this.ctx.strokeStyle = `rgba(${colors.base.r - 10}, ${colors.base.g - 10}, ${colors.base.b}, ${waveAlpha * 0.4})`;
                    this.ctx.lineWidth = (ripple.lineWidth + 3) * (1 - j * 0.1);
                    this.ctx.stroke();

                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                    const r = colors.highlight.r + (colors.accent.r - colors.highlight.r) * shimmerEffect * 0.5;
                    const g = colors.highlight.g + (colors.accent.g - colors.highlight.g) * shimmerEffect * 0.5;
                    const b = colors.highlight.b + (colors.accent.b - colors.highlight.b) * shimmerEffect * 0.5;
                    this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${waveAlpha})`;
                    this.ctx.lineWidth = ripple.lineWidth * 1.3 * (1 - j * 0.12);
                    this.ctx.stroke();
                } else if (config.pattern === 'burst') {
                    // Splash: Fast, bold rings with high contrast
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                    this.ctx.strokeStyle = `rgba(${colors.base.r}, ${colors.base.g}, ${colors.base.b}, ${waveAlpha * 0.6})`;
                    this.ctx.lineWidth = (ripple.lineWidth + 2) * (1 - j * 0.2);
                    this.ctx.stroke();

                    // Bold main ring
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                    const r = colors.base.r + (colors.highlight.r - colors.base.r) * pulseEffect;
                    const g = colors.base.g + (colors.highlight.g - colors.base.g) * pulseEffect;
                    const b = colors.base.b + (colors.highlight.b - colors.base.b) * pulseEffect;
                    this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${waveAlpha})`;
                    this.ctx.lineWidth = ripple.lineWidth * 1.5 * (1 - j * 0.22);
                    this.ctx.stroke();
                } else if (config.pattern === 'wave') {
                    // Strong: Multiple layered waves with medium intensity
                    if (j < 3) {
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                        this.ctx.strokeStyle = `rgba(${colors.base.r - 15}, ${colors.base.g - 15}, ${colors.base.b - 10}, ${waveAlpha * 0.25})`;
                        this.ctx.lineWidth = (ripple.lineWidth + 2.5) * (1 - j * 0.1);
                        this.ctx.stroke();
                    }

                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                    const r = colors.base.r + (colors.highlight.r - colors.base.r) * depth * shimmerEffect;
                    const g = colors.base.g + (colors.highlight.g - colors.base.g) * depth * shimmerEffect;
                    const b = colors.base.b + (colors.highlight.b - colors.base.b) * depth * shimmerEffect;
                    this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${waveAlpha * 0.75})`;
                    this.ctx.lineWidth = ripple.lineWidth * (1 - j * 0.15);
                    this.ctx.stroke();

                    if (j < 4) {
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                        this.ctx.strokeStyle = `rgba(${colors.highlight.r}, ${colors.highlight.g}, ${colors.highlight.b}, ${waveAlpha * 0.5})`;
                        this.ctx.lineWidth = ripple.lineWidth * 0.6 * (1 - j * 0.2);
                        this.ctx.stroke();
                    }
                } else if (config.pattern === 'smooth') {
                    // Gentle: Soft, blended rings with low intensity
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                    this.ctx.strokeStyle = `rgba(${colors.base.r}, ${colors.base.g}, ${colors.base.b}, ${waveAlpha * 0.35})`;
                    this.ctx.lineWidth = (ripple.lineWidth + 1.5) * (1 - j * 0.14);
                    this.ctx.stroke();

                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                    const r = colors.base.r + (colors.highlight.r - colors.base.r) * shimmerEffect * 0.5;
                    const g = colors.base.g + (colors.highlight.g - colors.base.g) * shimmerEffect * 0.5;
                    const b = colors.base.b + (colors.highlight.b - colors.base.b) * shimmerEffect * 0.5;
                    this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${waveAlpha * 0.6})`;
                    this.ctx.lineWidth = ripple.lineWidth * 0.8 * (1 - j * 0.16);
                    this.ctx.stroke();
                } else {
                    // Standard: Balanced medium ripples
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                    this.ctx.strokeStyle = `rgba(${colors.base.r}, ${colors.base.g}, ${colors.base.b}, ${waveAlpha * 0.4})`;
                    this.ctx.lineWidth = (ripple.lineWidth + 1) * (1 - j * 0.12);
                    this.ctx.stroke();

                    if (j < 4) {
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                        const r = colors.base.r + (colors.highlight.r - colors.base.r) * depth * shimmerEffect;
                        const g = colors.base.g + (colors.highlight.g - colors.base.g) * depth * shimmerEffect;
                        const b = colors.base.b + (colors.highlight.b - colors.base.b) * depth * shimmerEffect;
                        this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${waveAlpha * 0.7})`;
                        this.ctx.lineWidth = ripple.lineWidth * (1 - j * 0.18);
                        this.ctx.stroke();
                    }
                }

                this.ctx.restore();
            }
        }

        // Update and draw splash particles
        for (let i = this.splashes.length - 1; i >= 0; i--) {
            const particles = this.splashes[i];
            let allDead = true;

            for (let j = particles.length - 1; j >= 0; j--) {
                const p = particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.3; // Gravity
                p.life -= 0.04;

                if (p.life > 0) {
                    allDead = false;
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    this.ctx.fillStyle = `rgba(200, 220, 240, ${p.life * 0.8})`;
                    this.ctx.fill();
                }
            }

            if (allDead) {
                this.splashes.splice(i, 1);
            }
        }

        for (let i = this.mistParticles.length - 1; i >= 0; i--) {
            const particle = this.mistParticles[i];
            particle.x += particle.vx + this.windForce * 0.05;
            particle.y += particle.vy;
            particle.vy += 0.01;
            particle.life -= 0.02;
            particle.opacity = Math.max(0, particle.opacity - 0.01);

            if (particle.life <= 0) {
                this.mistParticles.splice(i, 1);
                continue;
            }

            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(200, 220, 240, ${particle.opacity})`;
            this.ctx.fill();
        }

        // Draw and update raindrops
        for (let i = this.drops.length - 1; i >= 0; i--) {
            const drop = this.drops[i];
            const windInfluence = this.windForce * (0.15 + drop.z * 0.25);
            drop.vx += (windInfluence - drop.vx) * 0.02;
            drop.y += drop.vy;
            drop.x += drop.vx;

            // Calculate water surface Y at this drop's depth
            const waterY = this.getWaterY(drop.z);

            // Scale drop based on depth for perspective
            const depthScale = 0.4 + drop.z * 0.6;
            const scaledR = drop.r * depthScale;
            // Length increases dramatically during gusts
            const gustLengthMultiplier = 1 + this.gustIntensity * 0.4;
            const scaledLength = drop.length * depthScale * (1 + Math.abs(this.windForce) * 0.1) * gustLengthMultiplier;
            // More dramatic skew during gusts
            const streakSkew = this.windForce * (3 + this.gustIntensity * 2);

            // Only draw if above water
            if (drop.y < waterY) {
                // Draw motion blur streak
                const gradient = this.ctx.createLinearGradient(
                    drop.x,
                    drop.y - scaledLength,
                    drop.x,
                    drop.y,
                );
                gradient.addColorStop(0, 'rgba(200, 220, 240, 0)');
                gradient.addColorStop(0.3, `rgba(210, 230, 250, ${drop.opacity * 0.3})`);
                gradient.addColorStop(1, `rgba(220, 235, 255, ${drop.opacity * 0.7})`);

                this.ctx.beginPath();
                this.ctx.moveTo(drop.x - streakSkew, drop.y - scaledLength);
                this.ctx.lineTo(drop.x, drop.y);
                this.ctx.strokeStyle = gradient;
                this.ctx.lineWidth = scaledR * 0.6;
                this.ctx.lineCap = 'round';
                this.ctx.stroke();

                // Draw drop head with glow
                this.ctx.beginPath();
                this.ctx.arc(drop.x, drop.y, scaledR * 1.5, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(220, 235, 255, ${drop.opacity * 0.2})`;
                this.ctx.fill();

                this.ctx.beginPath();
                this.ctx.arc(drop.x, drop.y, scaledR, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(230, 240, 255, ${drop.opacity})`;
                this.ctx.fill();
            }

            // Check if drop hits water surface at its depth
            if (drop.y >= waterY) {
                if (this.ripples.length < this.maxRipples) {
                    this.ripples.push(this.createRipple(drop.x, waterY, drop.r, drop.z));
                }
                if (Math.random() > 0.5 && this.splashes.length < this.maxSplashes) {
                    this.splashes.push(this.createSplash(drop.x, waterY, drop.z));
                }
                if (Math.random() > 0.3 && this.mistParticles.length < this.maxMistParticles) {
                    const newMist = this.createMist(drop.x, waterY - 3, drop.z);
                    const available = Math.max(0, this.maxMistParticles - this.mistParticles.length);
                    if (available > 0) {
                        this.mistParticles.push(...newMist.slice(0, available));
                    }
                }
                this.drops.splice(i, 1);
                continue;
            }

            // Remove drops that go off screen horizontally
            if (drop.x < -50 || drop.x > this.canvas.width + 50) {
                this.drops.splice(i, 1);
            }
        }

        // Limit arrays for performance
        if (this.ripples.length > this.maxRipples) {
            this.ripples = this.ripples.slice(-this.maxRipples);
        }
        if (this.drops.length > this.maxActiveDrops) {
            this.drops = this.drops.slice(-this.maxActiveDrops);
        }
        if (this.splashes.length > this.maxSplashes) {
            this.splashes = this.splashes.slice(-this.maxSplashes);
        }
        if (this.mistParticles.length > this.maxMistParticles) {
            this.mistParticles = this.mistParticles.slice(-this.maxMistParticles);
        }
        if (this.rainBurstDrops.length > this.maxRainBurstDrops) {
            this.rainBurstDrops = this.rainBurstDrops.slice(-this.maxRainBurstDrops);
        }
        if (this.drops.length > this.maxDrops) {
            this.drops = this.drops.slice(-this.maxDrops);
        }

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
        this.teardownQualityListener();

        super.stop();
    }

    resume() {
        console.log('[RainyWindow] Resuming theme...');

        // Call base resume to handle common setup
        super.resume();

        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();
        this.scheduleNextLightning();

        // Reacquire canvas context if it was lost
        if (!this.ctx && this.canvas) {
            console.log('[RainyWindow] Reacquiring canvas context');
            this.ctx = this.canvas.getContext('2d');
        }

        // If canvas doesn't exist or context can't be acquired, need full restart
        if (!this.canvas || !this.ctx) {
            console.warn('[RainyWindow] Canvas or context unavailable, full restart required');
            return false;
        }

        // Re-setup resize handler
        if (!this.resizeHandler) {
            this.resizeHandler = () => this.resizeCanvas();
            window.addEventListener('resize', this.resizeHandler, false);
        }

        // Re-setup event listeners
        this.setupEventListeners();

        console.log('[RainyWindow] Theme resumed successfully');
        return true;
    }

    /**
     * Provide rainy window tetromino palette so tiles match the scene
     * @returns {Object} Rainy Window tetromino configuration
     */
    getTetrominoConfig() {
        return RAINY_WINDOW_TETROMINOS;
    }
}
