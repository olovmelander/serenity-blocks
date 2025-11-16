/**
 * @fileoverview Ice Temple Theme - Immersive frozen vistas with auroras, ice cracks, and drifting shards.
 */

import { BaseTheme } from '../base-theme.js';
import { iceTempleCache } from '../../utils/cache.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { ICE_TEMPLE_TETROMINOS } from './ice-temple-tetrominos.js';

export default class IceTempleTheme extends BaseTheme {
    constructor() {
        super('ice-temple');

        // Gameplay integration
        this.comboMultiplier = 1.0;
        this.comboDecay = 0;
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;
        this.qualityListener = null;
        this.currentQuality = 'Ultra';
        this.activePreset = null;

        // Canvas for dynamic effects
        this.effectsCanvas = null;
        this.effectsCtx = null;
        this.animationId = null;
        this.time = 0;

        // Effect particles
        this.iceShardBurst = [];
        this.auroraWaves = [];
        this.frozenCrystals = [];
        this.comboRings = [];
        this.glacialLightning = [];
        this.iceStorm = [];

        // Dynamic state
        this.auroraIntensity = 0.85;
        this.targetAuroraIntensity = 0.85;
        this.crackGlow = 0;
        this.flashIntensity = 0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };

        // Effect limits and adaptive performance state
        this.effectLimits = {
            maxIceShards: 550,
            maxFrozenCrystals: 220,
            maxComboRings: 6,
            maxGlacialLightning: 3,
            maxIceStormParticles: 240,
        };

        this.comboCooldownMs = 220;
        this.lastLineClearTime = 0;
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.averageFrameTime = 16.67;
        this.adaptiveScale = 1;

        this.spawnScales = {
            shards: 1,
            crystals: 1,
            rings: 1,
            lightning: 1,
            storm: 1,
            aurora: 1,
        };

        this.effectToggles = {
            glacialLightning: true,
            iceStorm: true,
        };

        this.qualityPresets = {
            Low: {
                effectLimits: {
                    maxIceShards: 220,
                    maxFrozenCrystals: 90,
                    maxComboRings: 3,
                    maxGlacialLightning: 1,
                    maxIceStormParticles: 90,
                },
                spawnScale: {
                    shards: 0.55,
                    crystals: 0.5,
                    rings: 0.55,
                    lightning: 0.55,
                    storm: 0.4,
                    aurora: 0.9,
                },
                enableGlacialLightning: true,
                enableIceStorm: false,
                comboCooldownMs: 260,
            },
            Medium: {
                effectLimits: {
                    maxIceShards: 360,
                    maxFrozenCrystals: 150,
                    maxComboRings: 4,
                    maxGlacialLightning: 2,
                    maxIceStormParticles: 150,
                },
                spawnScale: {
                    shards: 0.75,
                    crystals: 0.7,
                    rings: 0.8,
                    lightning: 0.8,
                    storm: 0.7,
                    aurora: 1,
                },
                enableGlacialLightning: true,
                enableIceStorm: true,
                comboCooldownMs: 230,
            },
            High: {
                effectLimits: {
                    maxIceShards: 520,
                    maxFrozenCrystals: 220,
                    maxComboRings: 6,
                    maxGlacialLightning: 3,
                    maxIceStormParticles: 220,
                },
                spawnScale: {
                    shards: 1,
                    crystals: 1,
                    rings: 1,
                    lightning: 1,
                    storm: 1,
                    aurora: 1.05,
                },
                enableGlacialLightning: true,
                enableIceStorm: true,
                comboCooldownMs: 210,
            },
            Ultra: {
                effectLimits: {
                    maxIceShards: 650,
                    maxFrozenCrystals: 260,
                    maxComboRings: 7,
                    maxGlacialLightning: 4,
                    maxIceStormParticles: 280,
                },
                spawnScale: {
                    shards: 1.15,
                    crystals: 1.1,
                    rings: 1.1,
                    lightning: 1.15,
                    storm: 1.15,
                    aurora: 1.1,
                },
                enableGlacialLightning: true,
                enableIceStorm: true,
                comboCooldownMs: 200,
            },
        };
    }

    getTetrominoConfig() {
        return ICE_TEMPLE_TETROMINOS;
    }

    async init() {
        // Theme resources are created on-demand in createScene()
        this.setupEffectsCanvas();
    }

    setupEffectsCanvas() {
        // Create or get the effects canvas
        let canvas = document.getElementById('ice-temple-effects-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'ice-temple-effects-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '10';

            const themeContainer = document.getElementById('ice-temple-theme');
            if (themeContainer) {
                themeContainer.appendChild(canvas);
            }
        }

        this.effectsCanvas = canvas;
        this.effectsCtx = canvas.getContext('2d', { alpha: true });
        this.resizeEffectsCanvas();

        window.addEventListener('resize', () => this.resizeEffectsCanvas());
    }

    resizeEffectsCanvas() {
        if (!this.effectsCanvas) return;
        this.effectsCanvas.width = window.innerWidth;
        this.effectsCanvas.height = window.innerHeight;
    }

    async createScene() {
        this.applyQualityPreset(this.getGraphicsQuality());

        this.createStars();
        this.createAurora();
        this.createIceField();
        this.createCrackNetwork();
        this.createFrostHaze();
        this.createMistLayers();
        this.createSnowfall();
        this.createRefractions();

        // Setup gameplay event listeners
        this.setupEventListeners();

        // Start animation loop
        this.startEffectsAnimation();

        // Listen for graphics quality changes
        this.setupQualityListener();
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
                console.error('[IceTempleTheme] Failed to remove event listener', error);
            }
        });

        this.eventUnsubscribers = [];
    }

    shouldProcessComboEffects() {
        if (!this.isActive) return false;
        if (typeof window === 'undefined') return true;
        const settings = window.settings;
        return settings?.backgroundComboEffects === true;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'Ultra';
    }

    applyQualityPreset(quality) {
        const preset = this.qualityPresets[quality] || this.qualityPresets['Ultra'];
        const presetName = this.qualityPresets[quality] ? quality : 'Ultra';
        this.currentQuality = presetName;
        this.activePreset = preset;

        if (preset.effectLimits) {
            Object.assign(this.effectLimits, preset.effectLimits);
        }
        if (preset.spawnScale) {
            Object.assign(this.spawnScales, preset.spawnScale);
        }

        this.effectToggles.glacialLightning = preset.enableGlacialLightning !== false;
        this.effectToggles.iceStorm = preset.enableIceStorm !== false;

        if (typeof preset.comboCooldownMs === 'number') {
            this.comboCooldownMs = preset.comboCooldownMs;
        }

        this.trimEffectCollections();
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;

        this.teardownQualityListener();
        this.qualityListener = (event) => {
            const nextQuality = event.detail?.effectQuality;
            if (!nextQuality || nextQuality === this.currentQuality) {
                return;
            }
            this.applyQualityPreset(nextQuality);
        };

        window.addEventListener('settingsChanged', this.qualityListener);
    }

    teardownQualityListener() {
        if (this.qualityListener && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityListener);
            this.qualityListener = null;
        }
    }

    shouldThrottleEffects() {
        const now = Date.now();
        const timeSinceLast = now - this.lastLineClearTime;
        const performanceDrop = this.averageFrameTime > 24;
        const shardPressure = this.iceShardBurst.length >= this.effectLimits.maxIceShards * 0.85;
        const stormPressure = this.iceStorm.length >= this.effectLimits.maxIceStormParticles * 0.85;
        return (
            performanceDrop ||
            shardPressure ||
            stormPressure ||
            (this.adaptiveScale ?? 1) < 0.65 ||
            timeSinceLast < this.comboCooldownMs
        );
    }

    isPerformanceStressed(threshold = 24) {
        return this.averageFrameTime > threshold;
    }

    calculateAdaptiveScale() {
        const frame = this.averageFrameTime;
        if (frame <= 18) return 1;
        if (frame <= 20) return 0.92;
        if (frame <= 23) return 0.8;
        if (frame <= 26) return 0.68;
        if (frame <= 30) return 0.56;
        return 0.45;
    }

    getSpawnScale(type) {
        const presetScale = this.spawnScales?.[type] ?? 1;
        const adaptive = this.adaptiveScale ?? 1;
        const scale = presetScale * adaptive;
        return Math.max(0.35, Math.min(scale, 1.4));
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

        console.log(`[IceTempleTheme] Line clear: ${lineCount} lines, combo: ${comboCount}`);
        this.onLineClear(lineCount, comboCount);
    }

    handleCombo(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }

        console.log(`[IceTempleTheme] Combo: ${comboCount}`);
    }

    onLineClear(lineCount, comboCount) {
        if (!this.effectsCanvas) return;

        const throttled = this.shouldThrottleEffects();
        this.lastLineClearTime = Date.now();

        // Update combo multiplier
        this.comboMultiplier = Math.min(1 + comboCount * 0.25, 2.5);
        this.comboDecay = 180; // 3 seconds at 60fps

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;

        // Aurora pulse effect
        const auroraScale = this.getSpawnScale('aurora');
        this.targetAuroraIntensity = Math.min((0.85 + lineCount * 0.1 + comboCount * 0.05) * auroraScale, 1.7);
        this.pulseAurora(lineCount, comboCount);

        // Ice shard burst
        const shardScale = this.getSpawnScale('shards');
        let shardCount = Math.floor((lineCount * 35 + comboCount * 18) * shardScale * (throttled ? 0.55 : 1));
        const shardCapacity = Math.max(this.effectLimits.maxIceShards - this.iceShardBurst.length, 0);
        shardCount = Math.max(0, Math.min(shardCount, shardCapacity));
        for (let i = 0; i < shardCount; i++) {
            this.iceShardBurst.push(this.createIceShardParticle(centerX, centerY, lineCount));
        }

        // Crack glow pulse
        this.crackGlow = Math.min(0.6 + lineCount * 0.15 + comboCount * 0.1, 1.0);

        // Flash effect
        this.flashIntensity = Math.min(0.2 + lineCount * 0.08, 0.5);

        // Frozen crystals for multi-line clears
        if (lineCount >= 2) {
            const crystalCapacity = Math.max(this.effectLimits.maxFrozenCrystals - this.frozenCrystals.length, 0);
            const crystalScale = this.getSpawnScale('crystals');
            let crystalCount = Math.floor(lineCount * 12 * crystalScale * (throttled ? 0.6 : 1));
            crystalCount = Math.max(0, Math.min(crystalCount, crystalCapacity));
            for (let i = 0; i < crystalCount; i++) {
                this.frozenCrystals.push(this.createFrozenCrystal(centerX, centerY));
            }
        }

        // Combo rings
        if (comboCount >= 2) {
            const ringCapacity = Math.max(this.effectLimits.maxComboRings - this.comboRings.length, 0);
            const ringScale = this.getSpawnScale('rings');
            let ringCount = Math.min(Math.max(1, Math.floor(comboCount * ringScale)), 5, ringCapacity);
            if (throttled) {
                ringCount = Math.min(ringCount, 1);
            }
            for (let i = 0; i < ringCount; i++) {
                this.comboRings.push(this.createComboRing(centerX, centerY, i));
            }
        }

        // Glacial lightning for big combos
        const lightningThreshold = throttled ? 6 : 5;
        const lightningCap = Math.max(1, Math.floor(this.effectLimits.maxGlacialLightning * this.getSpawnScale('lightning')));
        if (
            this.effectToggles.glacialLightning &&
            comboCount >= lightningThreshold &&
            this.glacialLightning.length < lightningCap
        ) {
            this.createGlacialLightning(centerX, centerY, comboCount, throttled);
        }

        // Ice storm for massive combos
        const stormThreshold = throttled ? 9 : 8;
        const stormCap = Math.max(1, Math.floor(this.effectLimits.maxIceStormParticles * this.getSpawnScale('storm')));
        if (this.effectToggles.iceStorm && comboCount >= stormThreshold && this.iceStorm.length < stormCap) {
            this.triggerIceStorm(comboCount, throttled);
        }

        // Screen shake
        if (comboCount >= 3 || lineCount >= 3) {
            this.screenShake.intensity = Math.min((comboCount + lineCount) * 1.5, 12);
        }

        this.trimEffectCollections();
    }

    pulseAurora(lineCount, comboCount) {
        const auroraScale = this.getSpawnScale('aurora');
        const intensity = (0.3 + lineCount * 0.1 + comboCount * 0.15) * auroraScale;
        const duration = 60 + comboCount * 20;

        this.auroraWaves.push({
            intensity: Math.min(intensity, 1.8),
            life: 1.0,
            duration: duration,
            phase: 0,
            speed: 0.08 + comboCount * 0.02,
        });
    }

    createIceShardParticle(x, y, lineCount) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 12 + 6 + lineCount * 2;
        const size = Math.random() * 5 + 3;

        return {
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: size,
            opacity: Math.random() * 0.8 + 0.4,
            life: 1.0,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.25,
            gravity: 0.25,
            sparkle: Math.random() * Math.PI * 2,
            color: Math.random() < 0.3 ? 'cyan' : 'white',
        };
    }

    createFrozenCrystal(x, y) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 200 + 50;

        return {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            targetX: x + Math.cos(angle) * (distance + 300),
            targetY: y + Math.sin(angle) * (distance + 300),
            size: Math.random() * 4 + 2,
            opacity: Math.random() * 0.7 + 0.5,
            life: 1.0,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.2,
            sparkle: Math.random() * Math.PI * 2,
        };
    }

    createComboRing(x, y, index) {
        return {
            x: x,
            y: y,
            radius: 20 + index * 15,
            maxRadius: 300 + index * 80,
            opacity: 0.9,
            life: 1.0,
            thickness: 3 + index,
            expansionSpeed: 4 + index * 0.5,
            pulsePhase: index * Math.PI * 0.4,
        };
    }

    createGlacialLightning(x, y, comboCount, throttled = false) {
        if (!this.effectToggles.glacialLightning) {
            return;
        }
        const lightningScale = this.getSpawnScale('lightning');
        const dynamicCap = Math.max(1, Math.floor(this.effectLimits.maxGlacialLightning * lightningScale));
        if (this.glacialLightning.length >= dynamicCap) {
            return;
        }

        const branches = [];
        const branchCap = throttled ? 4 : 8;
        const numBranches = Math.min(Math.floor(comboCount / 2) + 3, branchCap);

        for (let i = 0; i < numBranches; i++) {
            const angle = (Math.PI * 2 / numBranches) * i + Math.random() * 0.4;
            const segments = [];
            let currentX = x;
            let currentY = y;

            const segmentCount = throttled ? Math.max(4, 4 + Math.floor(comboCount / 4)) : 6 + Math.floor(comboCount / 3);
            for (let j = 0; j < segmentCount; j++) {
                const length = Math.random() * 70 + 50;
                const nextX = currentX + Math.cos(angle + (Math.random() - 0.5) * 0.7) * length;
                const nextY = currentY + Math.sin(angle + (Math.random() - 0.5) * 0.7) * length;

                segments.push({ x1: currentX, y1: currentY, x2: nextX, y2: nextY });
                currentX = nextX;
                currentY = nextY;
            }

            branches.push(segments);
        }

        this.glacialLightning.push({
            branches: branches,
            opacity: 1.0,
            life: 1.0,
            pulsePhase: 0,
        });
    }

    triggerIceStorm(comboCount, throttled = false) {
        if (!this.effectToggles.iceStorm) {
            return;
        }
        const stormScale = this.getSpawnScale('storm');
        const dynamicLimit = Math.max(1, Math.floor(this.effectLimits.maxIceStormParticles * stormScale));
        const remainingAllowance = dynamicLimit - this.iceStorm.length;
        if (remainingAllowance <= 0) return;

        const baseCapacity = Math.max(this.effectLimits.maxIceStormParticles - this.iceStorm.length, 0);
        const capacity = Math.min(baseCapacity, remainingAllowance);
        if (capacity <= 0) return;

        let stormCount = Math.min(comboCount * 18, capacity, 220);
        if (throttled) {
            stormCount = Math.min(stormCount, 100);
        }
        stormCount = Math.max(0, stormCount);

        for (let i = 0; i < stormCount; i++) {
            this.iceStorm.push({
                x: Math.random() * this.effectsCanvas.width,
                y: -Math.random() * 200,
                vx: (Math.random() - 0.5) * 8,
                vy: Math.random() * 6 + 4,
                size: Math.random() * 3 + 1,
                opacity: Math.random() * 0.6 + 0.4,
                life: 1.0,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.3,
            });
        }
    }

    trimEffectCollections() {
        const clamp = (collection, limit) => {
            if (collection.length > limit) {
                collection.splice(0, collection.length - limit);
            }
        };

        clamp(this.iceShardBurst, this.effectLimits.maxIceShards);
        clamp(this.frozenCrystals, this.effectLimits.maxFrozenCrystals);
        clamp(this.comboRings, this.effectLimits.maxComboRings);
        clamp(this.iceStorm, this.effectLimits.maxIceStormParticles);
        clamp(this.glacialLightning, this.effectLimits.maxGlacialLightning);
    }

    startEffectsAnimation() {
        if (!this.isActive || !this.effectsCanvas) return;
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.animateEffects();
    }

    animateEffects() {
        if (!this.isActive || !this.effectsCanvas) return;

        const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
        if (this.lastFrameTime > 0) {
            const frameTime = now - this.lastFrameTime;
            this.frameTimeAccumulator += frameTime;
            this.frameTimeCount += 1;
            if (this.frameTimeCount >= 30) {
                this.averageFrameTime = this.frameTimeAccumulator / this.frameTimeCount;
                this.frameTimeAccumulator = 0;
                this.frameTimeCount = 0;
            }
        }
        this.lastFrameTime = now;
        this.adaptiveScale = this.calculateAdaptiveScale();

        this.time += 1;

        // Decay combo multiplier
        if (this.comboDecay > 0) {
            this.comboDecay -= 1;
            if (this.comboDecay === 0) {
                this.comboMultiplier = 1.0;
            }
        }

        // Smooth aurora intensity transition
        this.auroraIntensity += (this.targetAuroraIntensity - this.auroraIntensity) * 0.05;
        if (Math.abs(this.targetAuroraIntensity - this.auroraIntensity) < 0.01) {
            this.targetAuroraIntensity = 0.85;
        }

        // Apply aurora intensity to aurora container
        const auroraContainer = this.getContainer('ice-temple-aurora');
        if (auroraContainer) {
            auroraContainer.style.opacity = this.auroraIntensity.toString();
        }

        // Decay crack glow
        if (this.crackGlow > 0) {
            this.crackGlow *= 0.95;
            const cracksContainer = this.getContainer('ice-temple-cracks');
            if (cracksContainer) {
                cracksContainer.style.filter = `brightness(${1 + this.crackGlow})`;
            }
        }

        // Decay flash
        if (this.flashIntensity > 0) {
            this.flashIntensity *= 0.88;
        }

        // Screen shake decay
        if (this.screenShake.intensity > 0) {
            this.screenShake.intensity *= 0.90;
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity;
        } else {
            this.screenShake.x = 0;
            this.screenShake.y = 0;
        }

        // Clear canvas
        this.effectsCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);

        // Apply screen shake
        this.effectsCtx.save();
        this.effectsCtx.translate(this.screenShake.x, this.screenShake.y);

        // Draw flash effect
        if (this.flashIntensity > 0.01) {
            this.effectsCtx.fillStyle = `rgba(180, 220, 255, ${this.flashIntensity * 0.4})`;
            this.effectsCtx.fillRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
        }

        // Draw and update all effects
        this.updateAuroraWaves();
        this.updateGlacialLightning();
        this.updateComboRings();
        this.updateIceShardBurst();
        this.updateFrozenCrystals();
        this.updateIceStorm();
        this.trimEffectCollections();

        this.effectsCtx.restore();

        this.animationId = requestAnimationFrame(() => this.animateEffects());
    }

    updateAuroraWaves() {
        if (this.auroraWaves.length === 0) return;

        const lowPerf = this.isPerformanceStressed(25);
        for (let i = this.auroraWaves.length - 1; i >= 0; i--) {
            const wave = this.auroraWaves[i];
            wave.phase += wave.speed;
            wave.life -= 1 / wave.duration;

            if (wave.life <= 0) {
                this.auroraWaves.splice(i, 1);
                continue;
            }

            const opacity = wave.intensity * wave.life * (0.7 + Math.sin(wave.phase) * 0.3);
            const gradient = this.effectsCtx.createRadialGradient(
                this.effectsCanvas.width / 2, this.effectsCanvas.height * 0.3, 0,
                this.effectsCanvas.width / 2, this.effectsCanvas.height * 0.3, this.effectsCanvas.width * 0.6
            );
            const innerOpacity = lowPerf ? opacity * 0.4 : opacity * 0.6;
            const midOpacity = lowPerf ? opacity * 0.25 : opacity * 0.4;
            gradient.addColorStop(0, `rgba(116, 185, 255, ${innerOpacity})`);
            gradient.addColorStop(0.5, `rgba(85, 239, 196, ${midOpacity})`);
            gradient.addColorStop(1, 'rgba(162, 155, 254, 0)');

            this.effectsCtx.fillStyle = gradient;
            this.effectsCtx.fillRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
        }
    }

    updateGlacialLightning() {
        if (this.glacialLightning.length === 0) return;

        const lowPerf = this.isPerformanceStressed(23);
        for (let i = this.glacialLightning.length - 1; i >= 0; i--) {
            const lightning = this.glacialLightning[i];
            lightning.life -= 0.012;
            lightning.opacity = lightning.life;
            lightning.pulsePhase += 0.12;

            if (lightning.life <= 0) {
                this.glacialLightning.splice(i, 1);
                continue;
            }

            const pulseOpacity = lightning.opacity * (0.75 + Math.sin(lightning.pulsePhase) * 0.25);

            for (const branch of lightning.branches) {
                for (const segment of branch) {
                    if (!lowPerf) {
                        this.effectsCtx.beginPath();
                        this.effectsCtx.moveTo(segment.x1, segment.y1);
                        this.effectsCtx.lineTo(segment.x2, segment.y2);
                        this.effectsCtx.strokeStyle = `rgba(116, 185, 255, ${pulseOpacity * 0.35})`;
                        this.effectsCtx.lineWidth = 10;
                        this.effectsCtx.lineCap = 'round';
                        this.effectsCtx.stroke();

                        this.effectsCtx.beginPath();
                        this.effectsCtx.moveTo(segment.x1, segment.y1);
                        this.effectsCtx.lineTo(segment.x2, segment.y2);
                        this.effectsCtx.strokeStyle = `rgba(180, 220, 255, ${pulseOpacity * 0.65})`;
                        this.effectsCtx.lineWidth = 5;
                        this.effectsCtx.stroke();
                    }

                    this.effectsCtx.beginPath();
                    this.effectsCtx.moveTo(segment.x1, segment.y1);
                    this.effectsCtx.lineTo(segment.x2, segment.y2);
                    this.effectsCtx.strokeStyle = `rgba(230, 250, 255, ${pulseOpacity})`;
                    this.effectsCtx.lineWidth = lowPerf ? 1.4 : 2;
                    this.effectsCtx.stroke();
                }
            }
        }
    }

    updateComboRings() {
        if (this.comboRings.length === 0) return;

        const lowPerf = this.isPerformanceStressed(23);
        for (let i = this.comboRings.length - 1; i >= 0; i--) {
            const ring = this.comboRings[i];
            ring.radius += ring.expansionSpeed;
            ring.life -= 0.01;
            ring.opacity = ring.life * 0.8;
            ring.pulsePhase += 0.1;

            if (ring.life <= 0 || ring.radius > ring.maxRadius) {
                this.comboRings.splice(i, 1);
                continue;
            }

            const pulseOpacity = ring.opacity * (0.7 + Math.sin(ring.pulsePhase) * 0.3);

            if (!lowPerf) {
                this.effectsCtx.beginPath();
                this.effectsCtx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
                this.effectsCtx.strokeStyle = `rgba(116, 185, 255, ${pulseOpacity * 0.4})`;
                this.effectsCtx.lineWidth = ring.thickness + 6;
                this.effectsCtx.stroke();
            }

            this.effectsCtx.beginPath();
            this.effectsCtx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            this.effectsCtx.strokeStyle = `rgba(200, 235, 255, ${pulseOpacity})`;
            this.effectsCtx.lineWidth = lowPerf ? ring.thickness * 0.8 : ring.thickness;
            this.effectsCtx.stroke();
        }
    }

    updateIceShardBurst() {
        if (this.iceShardBurst.length === 0) return;

        const lowPerf = this.isPerformanceStressed(26);
        for (let i = this.iceShardBurst.length - 1; i >= 0; i--) {
            const particle = this.iceShardBurst[i];

            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += particle.gravity;
            particle.vx *= 0.98;
            particle.rotation += particle.rotationSpeed;
            particle.life -= 0.015;
            particle.opacity = particle.life * 0.85;
            particle.sparkle += 0.18;

            if (particle.life <= 0 || particle.y > this.effectsCanvas.height) {
                this.iceShardBurst.splice(i, 1);
                continue;
            }

            const sparkleIntensity = Math.sin(particle.sparkle) * 0.35 + 0.65;

            this.effectsCtx.save();
            this.effectsCtx.translate(particle.x, particle.y);
            this.effectsCtx.rotate(particle.rotation);

            // Glow
            const glowSize = particle.size * 3.5;
            const glowGradient = this.effectsCtx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
            const glowColor = particle.color === 'cyan' ? '116, 185, 255' : '200, 230, 255';
            glowGradient.addColorStop(0, `rgba(${glowColor}, ${particle.opacity * 0.7 * sparkleIntensity})`);
            glowGradient.addColorStop(0.5, `rgba(${glowColor}, ${particle.opacity * 0.4 * sparkleIntensity})`);
            glowGradient.addColorStop(1, `rgba(${glowColor}, 0)`);
            this.effectsCtx.fillStyle = glowGradient;
            this.effectsCtx.fillRect(-glowSize, -glowSize, glowSize * 2, glowSize * 2);

            // Ice shard shape (hexagon)
            this.effectsCtx.beginPath();
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 3) {
                const px = Math.cos(angle) * particle.size;
                const py = Math.sin(angle) * particle.size;
                if (angle === 0) {
                    this.effectsCtx.moveTo(px, py);
                } else {
                    this.effectsCtx.lineTo(px, py);
                }
            }
            this.effectsCtx.closePath();
            const fillColor = particle.color === 'cyan' ? `rgba(150, 215, 255, ${particle.opacity * sparkleIntensity})` : `rgba(230, 245, 255, ${particle.opacity * sparkleIntensity})`;
            this.effectsCtx.fillStyle = fillColor;
            this.effectsCtx.fill();

            // Highlight
            this.effectsCtx.beginPath();
            this.effectsCtx.arc(-particle.size * 0.2, -particle.size * 0.3, particle.size * 0.4, 0, Math.PI * 2);
            this.effectsCtx.fillStyle = `rgba(255, 255, 255, ${particle.opacity * 0.9 * sparkleIntensity})`;
            this.effectsCtx.fill();

            this.effectsCtx.restore();
        }
    }

    updateFrozenCrystals() {
        for (let i = this.frozenCrystals.length - 1; i >= 0; i--) {
            const crystal = this.frozenCrystals[i];

            crystal.x += (crystal.targetX - crystal.x) * 0.08;
            crystal.y += (crystal.targetY - crystal.y) * 0.08;
            crystal.rotation += crystal.rotationSpeed;
            crystal.life -= 0.012;
            crystal.opacity = crystal.life * 0.8;
            crystal.sparkle += 0.2;

            if (crystal.life <= 0) {
                this.frozenCrystals.splice(i, 1);
                continue;
            }

            const sparkleIntensity = Math.sin(crystal.sparkle) * 0.4 + 0.6;

            this.effectsCtx.save();
            this.effectsCtx.translate(crystal.x, crystal.y);
            this.effectsCtx.rotate(crystal.rotation);

            if (!lowPerf) {
                const glowSize = crystal.size * 2.5;
                const glowGradient = this.effectsCtx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
                glowGradient.addColorStop(0, `rgba(180, 220, 255, ${crystal.opacity * 0.6 * sparkleIntensity})`);
                glowGradient.addColorStop(1, 'rgba(160, 200, 240, 0)');
                this.effectsCtx.fillStyle = glowGradient;
                this.effectsCtx.fillRect(-glowSize, -glowSize, glowSize * 2, glowSize * 2);
            }

            this.effectsCtx.beginPath();
            this.effectsCtx.moveTo(0, -crystal.size);
            this.effectsCtx.lineTo(crystal.size * 0.5, 0);
            this.effectsCtx.lineTo(0, crystal.size);
            this.effectsCtx.lineTo(-crystal.size * 0.5, 0);
            this.effectsCtx.closePath();
            this.effectsCtx.fillStyle = `rgba(220, 240, 255, ${crystal.opacity * sparkleIntensity})`;
            this.effectsCtx.fill();

            this.effectsCtx.restore();
        }
    }

    updateIceStorm() {
        if (this.iceStorm.length === 0) return;

        const lowPerf = this.isPerformanceStressed(26);
        for (let i = this.iceStorm.length - 1; i >= 0; i--) {
            const particle = this.iceStorm[i];

            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.rotation += particle.rotationSpeed;
            particle.life -= 0.008;
            particle.opacity = particle.life * 0.7;

            if (particle.life <= 0 || particle.y > this.effectsCanvas.height) {
                this.iceStorm.splice(i, 1);
                continue;
            }

            this.effectsCtx.save();
            this.effectsCtx.translate(particle.x, particle.y);
            this.effectsCtx.rotate(particle.rotation);

            if (!lowPerf) {
                const glowGradient = this.effectsCtx.createRadialGradient(0, 0, 0, 0, 0, particle.size * 2);
                glowGradient.addColorStop(0, `rgba(200, 230, 255, ${particle.opacity * 0.5})`);
                glowGradient.addColorStop(1, 'rgba(180, 210, 240, 0)');
                this.effectsCtx.fillStyle = glowGradient;
                this.effectsCtx.fillRect(-particle.size * 2, -particle.size * 2, particle.size * 4, particle.size * 4);
            }

            this.effectsCtx.beginPath();
            this.effectsCtx.arc(0, 0, particle.size, 0, Math.PI * 2);
            this.effectsCtx.fillStyle = `rgba(240, 250, 255, ${particle.opacity})`;
            this.effectsCtx.fill();

            this.effectsCtx.restore();
        }
    }

    createStars() {
        const container = this.getContainer('ice-temple-stars');
        if (!container) return;

        const width = container.clientWidth || 1920;
        const height = container.clientHeight || 1080;
        const cacheKey = `ice-temple-stars-${width}x${height}`;

        // Use canvas for static stars, only animate a few bright ones
        if (!iceTempleCache.has(cacheKey)) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { alpha: true });

            const rng = this.seededRandom(11111);
            // Draw 220 static stars on canvas
            for (let i = 0; i < 220; i++) {
                const size = rng() * 1.4 + 0.4;
                const x = rng() * width;
                const y = rng() * height;
                const opacity = 0.3 + rng() * 0.4;

                const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 0.7);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
                gradient.addColorStop(0.7, `rgba(255, 255, 255, ${opacity * 0.3})`);
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

                ctx.fillStyle = gradient;
                ctx.fillRect(x - size, y - size, size * 2, size * 2);
            }

            iceTempleCache.set(cacheKey, canvas.toDataURL('image/png'));
        }

        // Set canvas as background
        container.style.backgroundImage = `url(${iceTempleCache.get(cacheKey)})`;
        container.style.backgroundSize = 'cover';

        // Only animate 20 bright twinkling stars
        if (container.children.length) return;
        const rng = this.seededRandom(11112);
        for (let i = 0; i < 20; i++) {
            const star = document.createElement('div');
            star.className = 'ice-temple-star';
            const size = rng() * 1.6 + 0.8;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${rng() * 100}%`;
            star.style.top = `${rng() * 100}%`;
            star.style.setProperty('--min-opacity', `${0.4 + rng() * 0.3}`);
            star.style.setProperty('--max-opacity', `${0.7 + rng() * 0.3}`);
            star.style.setProperty('--twinkle-duration', `${3 + rng() * 2.5}s`);
            star.style.setProperty('--twinkle-delay', `${rng() * 4}s`);
            container.appendChild(star);
        }
    }

    createAurora() {
        const container = this.getContainer('ice-temple-aurora');
        if (!container || container.children.length) return;

        // Reduce from 4 to 3 aurora curtains for better performance
        const colors = ['#74b9ff', '#55efc4', '#a29bfe'];
        const rng = this.seededRandom(12222);
        for (let i = 0; i < 3; i++) {
            const curtain = document.createElement('div');
            curtain.className = 'ice-aurora-curtain';
            curtain.style.setProperty('--aurora-color', colors[i]);
            curtain.style.setProperty('--aurora-duration', `${24 + i * 5 + rng() * 4}s`);
            curtain.style.setProperty('--aurora-delay', `${i * 3}s`);
            curtain.style.left = `${i * 30}%`;
            curtain.style.width = `${35}%`; // Wider to maintain coverage
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

        // Reduce crack count from 20 to 10 for better performance
        const rng = this.seededRandom(13337);
        const crackCount = 10;
        for (let i = 0; i < crackCount; i++) {
            const crack = document.createElement('div');
            crack.className = 'ice-temple-crack';
            crack.style.left = `${rng() * 100}%`;
            crack.style.top = `${55 + rng() * 40}%`;
            crack.style.setProperty('--crack-length', `${28 + rng() * 50}vh`); // Longer cracks
            crack.style.setProperty('--crack-thickness', `${0.9 + rng() * 2}px`); // Slightly thicker
            crack.style.setProperty('--crack-rotate', `${-40 + rng() * 80}deg`);
            crack.style.setProperty('--crack-delay', `${rng() * 6}s`);
            crack.style.setProperty('--crack-glow', `${0.4 + rng() * 0.4}`);
            const glintDuration = 5 + rng() * 4;
            crack.style.setProperty('--crack-glint-duration', `${glintDuration}s`);
            crack.style.setProperty('--crack-phase', `-${rng() * glintDuration}s`);
            if (rng() > 0.5) {
                crack.classList.add('branching');
                crack.style.setProperty('--branch-rotate', `${-35 + rng() * 70}deg`);
                crack.style.setProperty('--branch-length', `${15 + rng() * 25}vh`); // Longer branches
            }
            container.appendChild(crack);
        }
    }

    createFrostHaze() {
        const container = this.getContainer('ice-temple-ice-shards');
        if (!container || container.children.length) return;

        // Reduce frost haze count from 12 to 6 for better performance
        const rng = this.seededRandom(17777);
        const spriteCount = 6;
        for (let i = 0; i < spriteCount; i++) {
            const haze = document.createElement('div');
            haze.className = 'ice-temple-frost-haze';
            const size = 120 + rng() * 180; // Much larger to maintain visual density
            haze.style.width = `${size}px`;
            haze.style.height = `${size}px`;
            haze.style.left = `${rng() * 100}%`;
            haze.style.top = `${rng() * 100}%`;
            const duration = 20 + rng() * 16;
            haze.style.setProperty('--haze-duration', `${duration}s`);
            haze.style.setProperty('--haze-delay', `-${rng() * duration}s`);
            haze.style.setProperty('--haze-drift-x', `${rng() * 20 - 10}vw`);
            haze.style.setProperty('--haze-drift-y', `${rng() * 12 - 6}vh`);
            haze.style.setProperty('--haze-scale', `${0.8 + rng() * 0.8}`);
            haze.style.setProperty('--haze-opacity', `${0.18 + rng() * 0.3}`);
            container.appendChild(haze);
        }
    }

    createMistLayers() {
        const container = this.getContainer('ice-temple-mist');
        if (!container || container.children.length) return;

        // Reduce from 3 to 2 mist layers for better performance
        for (let i = 0; i < 2; i++) {
            const mist = document.createElement('div');
            mist.className = 'ice-temple-mist-layer';
            mist.style.setProperty('--mist-duration', `${26 + i * 10}s`);
            mist.style.setProperty('--mist-delay', `${i * -5}s`);
            mist.style.opacity = `${0.14 + i * 0.08}`; // Slightly more visible
            mist.dataset.layer = i === 0 ? 'back' : 'front';
            container.appendChild(mist);
        }
    }

    createSnowfall() {
        const container = this.getContainer('ice-temple-snow');
        if (!container || container.children.length) return;

        // Reduce snowflake count from 45 to 25 for better performance
        const rng = this.seededRandom(15555);
        const flakeCount = 25;
        for (let i = 0; i < flakeCount; i++) {
            const snowflake = document.createElement('div');
            snowflake.className = 'ice-temple-snowflake';
            const size = rng() * 2.6 + 1.5; // Larger to compensate for fewer flakes
            snowflake.style.width = `${size}px`;
            snowflake.style.height = `${size}px`;
            snowflake.style.left = `${rng() * 100}%`;

            const depthFactor = rng();
            const duration = 12 + depthFactor * 10;
            snowflake.style.setProperty('--fall-duration', `${duration}s`);
            snowflake.style.setProperty('--fall-delay', `-${rng() * duration}s`);
            snowflake.style.setProperty('--sway-amount', `${rng() * 60 - 30}px`);
            snowflake.style.setProperty('--snow-scale', `${0.8 + depthFactor * 1}`);
            snowflake.style.setProperty('--snow-opacity', `${0.45 + (1 - depthFactor) * 0.5}`);
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
        // Reduce from 14 to 8 rays for better performance
        for (let i = 0; i < 8; i++) {
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

    stop() {
        // Cancel animation frame
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        this.teardownQualityListener();

        // Teardown event listeners
        this.teardownEventListeners();
        this.pendingComboCount = 0;

        // Clean up effects canvas
        if (this.effectsCanvas) {
            this.effectsCanvas.remove();
            this.effectsCanvas = null;
            this.effectsCtx = null;
        }

        // Clear all effect arrays
        this.iceShardBurst = [];
        this.auroraWaves = [];
        this.frozenCrystals = [];
        this.comboRings = [];
        this.glacialLightning = [];
        this.iceStorm = [];

        // Reset state
        this.auroraIntensity = 0.85;
        this.targetAuroraIntensity = 0.85;
        this.crackGlow = 0;
        this.flashIntensity = 0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.comboMultiplier = 1.0;
        this.comboDecay = 0;
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.averageFrameTime = 16.67;
        this.lastLineClearTime = 0;
        this.adaptiveScale = 1;

        super.stop();
    }
}
