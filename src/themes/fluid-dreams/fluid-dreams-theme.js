/**
 * @fileoverview Fluid Dreams Theme - Dreamy flowing scene with morphing blobs, iridescent bubbles, and flowing ribbons
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { FLUID_DREAMS_TETROMINOS } from './fluid-dreams-tetrominos.js';

/**
 * Fluid Dreams Theme
 * Features:
 * - Morphing blobs with gooey effects
 * - Iridescent bubbles floating upward
 * - Flowing ribbon streams
 */
export default class FluidDreamsTheme extends BaseTheme {
    constructor() {
        super('fluid-dreams');

        // Gameplay effects
        this.liquidSplashes = [];
        this.iridescenceWaves = [];
        this.dreamRipples = [];
        this.fluidStreams = [];
        this.prismBursts = [];
        this.morphBlobs = [];
        this.comboMultiplier = 1.0;
        this.effectsAnimationFrame = null;
        this.lastEffectsFrameTime = 0;
        this.eventUnsubscribers = [];

        // Store references to DOM blobs
        this.domBlobs = [];
        this.blobPulses = new Map();

        // Performance limits - more aggressive
        this.MAX_PARTICLES = 80;
        this.MAX_WAVES = 4;
        this.MAX_RIPPLES = 6;
        this.MAX_STREAMS = 3;
        this.MAX_BURSTS = 1;
        this.MAX_BLOBS = 1;
        this.qualityChangeHandler = null;
        this.qualityPresets = {
            'Minimal': {
                blobCount: 4,
                bubbleCount: 8,
                ribbonCount: 2,
                maxParticles: 35,
                maxWaves: 2,
                maxRipples: 2,
                maxStreams: 1,
                maxBursts: 1,
                maxBlobs: 1,
            },
            'Low': {
                blobCount: 6,
                bubbleCount: 14,
                ribbonCount: 3,
                maxParticles: 55,
                maxWaves: 3,
                maxRipples: 4,
                maxStreams: 2,
                maxBursts: 1,
                maxBlobs: 1,
            },
            'Medium': {
                blobCount: 7,
                bubbleCount: 18,
                ribbonCount: 4,
                maxParticles: 70,
                maxWaves: 4,
                maxRipples: 5,
                maxStreams: 3,
                maxBursts: 1,
                maxBlobs: 1,
            },
            'High': {
                blobCount: 8,
                bubbleCount: 22,
                ribbonCount: 5,
                maxParticles: 90,
                maxWaves: 5,
                maxRipples: 6,
                maxStreams: 4,
                maxBursts: 2,
                maxBlobs: 2,
            },
            'Ultra': {
                blobCount: 10,
                bubbleCount: 26,
                ribbonCount: 6,
                maxParticles: 110,
                maxWaves: 6,
                maxRipples: 8,
                maxStreams: 5,
                maxBursts: 2,
                maxBlobs: 2,
            },
            'Extreme': {
                blobCount: 14,
                bubbleCount: 35,
                ribbonCount: 8,
                maxParticles: 150,
                maxWaves: 8,
                maxRipples: 11,
                maxStreams: 7,
                maxBursts: 3,
                maxBlobs: 3,
            }
        };
        this.currentQuality = 'Ultra';
        this.activePreset = this.qualityPresets['Ultra'];
    }

    applyQualityPreset(quality, { skipRefresh = false } = {}) {
        if (!this.qualityPresets[quality]) {
            console.warn(`Fluid Dreams: Unknown quality preset "${quality}", defaulting to Ultra`);
            quality = 'Ultra';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        this.MAX_PARTICLES = this.activePreset.maxParticles;
        this.MAX_WAVES = this.activePreset.maxWaves;
        this.MAX_RIPPLES = this.activePreset.maxRipples;
        this.MAX_STREAMS = this.activePreset.maxStreams;
        this.MAX_BURSTS = this.activePreset.maxBursts;
        this.MAX_BLOBS = this.activePreset.maxBlobs;

        if (!skipRefresh) {
            this.refreshQualityDependentElements();
        }

        console.log(`💧 Fluid Dreams: Applying ${quality} quality preset`);
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'Ultra';
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;

        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
        }

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;

            this.applyQualityPreset(newQuality);
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    refreshQualityDependentElements() {
        this.createMorphingBlobs(true);
        this.createBubbles(true);
        this.createRibbons(true);
        this.trimEffectCollections();
    }

    trimEffectCollections() {
        this.trimArray(this.liquidSplashes, this.MAX_PARTICLES);
        this.trimArray(this.iridescenceWaves, this.MAX_WAVES);
        this.trimArray(this.dreamRipples, this.MAX_RIPPLES);
        this.trimArray(this.fluidStreams, this.MAX_STREAMS);
        this.trimArray(this.prismBursts, this.MAX_BURSTS);
        this.trimArray(this.morphBlobs, this.MAX_BLOBS);
    }

    trimArray(collection, limit) {
        if (!collection || typeof limit !== 'number') return;
        if (collection.length > limit) {
            collection.splice(0, collection.length - limit);
        }
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality, { skipRefresh: true });

        // 1. Morphing Blobs for Gooey Effect
        this.createMorphingBlobs(true);

        // 2. Iridescent Bubbles
        this.createBubbles(true);

        // 3. Flowing Ribbons
        this.createRibbons(true);

        // Setup gameplay effects
        this.setupGameplayEffects();
        this.setupQualityListener();
    }

    createMorphingBlobs(force = false) {
        const blobContainer = this.getContainer('morphing-blobs');
        if (!blobContainer) return;
        if (!force && blobContainer.children.length > 0) return;

        blobContainer.textContent = '';
        this.domBlobs = [];
        this.blobPulses.clear();

        const numBlobs = this.activePreset?.blobCount ?? 8;
        for (let i = 0; i < numBlobs; i++) {
            const blob = document.createElement('div');
            blob.className = 'morph-blob';
            const size = Math.random() * 150 + 100;
            blob.style.width = `${size}px`;
            blob.style.height = `${size}px`;

            blob.style.setProperty('--x-start', `${Math.random() * 80 + 10}vw`);
            blob.style.setProperty('--y-start', `${Math.random() * 80 + 10}vh`);
            blob.style.setProperty('--x-end', `${Math.random() * 80 + 10}vw`);
            blob.style.setProperty('--y-end', `${Math.random() * 80 + 10}vh`);
            blob.style.setProperty('--scale-start', `${Math.random() * 0.5 + 0.8}`);
            blob.style.setProperty('--scale-end', `${Math.random() * 0.5 + 0.8}`);

            blob.style.animationDelay = `-${Math.random() * 10}s, -${Math.random() * 15}s, -${Math.random() * 20}s`;
            blobContainer.appendChild(blob);

            this.domBlobs.push(blob);
            this.blobPulses.set(blob, { intensity: 0, lastPulse: 0 });
        }
    }

    createBubbles(force = false) {
        const bubbleContainer = this.getContainer('iridescent-bubbles');
        if (!bubbleContainer) return;
        if (!force && bubbleContainer.children.length > 0) return;

        bubbleContainer.textContent = '';
        const numBubbles = this.activePreset?.bubbleCount ?? 20;
        for (let i = 0; i < numBubbles; i++) {
            const bubble = document.createElement('div');
            bubble.className = 'iridescent-bubble';
            const size = Math.random() * 80 + 20;
            bubble.style.width = `${size}px`;
            bubble.style.height = `${size}px`;

            bubble.style.setProperty('--x-start', `${Math.random() * 100}vw`);
            bubble.style.setProperty('--y-start', `${110}vh`);
            bubble.style.setProperty('--x-end', `${Math.random() * 100}vw`);
            bubble.style.setProperty('--y-end', `${-10}vh`);
            bubble.style.setProperty('--scale', `${Math.random() * 0.4 + 0.8}`);

            const duration = Math.random() * 15 + 20;
            bubble.style.animationDuration = `${duration}s`;
            bubble.style.animationDelay = `-${Math.random() * duration}s`;
            bubbleContainer.appendChild(bubble);
        }
    }

    createRibbons(force = false) {
        const ribbonContainer = this.getContainer('ribbon-streams');
        if (!ribbonContainer) return;
        if (!force && ribbonContainer.children.length > 0) return;

        ribbonContainer.textContent = '';
        const numRibbons = this.activePreset?.ribbonCount ?? 5;
        for (let i = 0; i < numRibbons; i++) {
            const ribbon = document.createElement('div');
            ribbon.className = 'ribbon-stream';

            ribbon.style.setProperty('--x-start', `${Math.random() * 120 - 10}vw`);
            ribbon.style.setProperty('--y-start', `${Math.random() * 120 - 10}vh`);
            ribbon.style.setProperty('--x-end', `${Math.random() * 120 - 10}vw`);
            ribbon.style.setProperty('--y-end', `${Math.random() * 120 - 10}vh`);
            ribbon.style.setProperty('--r-start', `${Math.random() * 720 - 360}deg`);
            ribbon.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);

            const duration = Math.random() * 20 + 30;
            ribbon.style.animationDelay = `-${Math.random() * duration}s, -${Math.random() * 10}s`;
            ribbonContainer.appendChild(ribbon);
        }
    }

    setupGameplayEffects() {
        // Create canvas for gameplay effects
        const themeContainer = document.getElementById('fluid-dreams-theme');
        if (!themeContainer) return;

        let canvas = document.getElementById('fluid-dreams-effects-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'fluid-dreams-effects-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '100';
            themeContainer.appendChild(canvas);
        }

        this.effectsCanvas = canvas;
        this.effectsCtx = canvas.getContext('2d', { alpha: true, desynchronized: true });

        // Size canvas
        const resizeCanvas = () => {
            if (!this.effectsCanvas) return;
            const rect = themeContainer.getBoundingClientRect();
            this.effectsCanvas.width = rect.width;
            this.effectsCanvas.height = rect.height;
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Setup event listeners
        this.setupEventListeners();

        // Start effects animation loop
        this.startEffectsLoop();
    }

    setupEventListeners() {
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

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    handleLineClear(data) {
        const { lineCount } = data;
        this.createLiquidSplash(lineCount);

        if (lineCount >= 2) {
            this.createDreamRipples(lineCount);
        }

        if (lineCount >= 3) {
            this.createFluidStreams(lineCount);
        }

        // Pulse DOM blobs on line clear
        this.pulseDOMBlobs(lineCount * 0.3);
    }

    handleCombo(data) {
        const { comboCount } = data;
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.5);

        if (comboCount >= 2) {
            this.createIridescenceWave(comboCount);
        }

        if (comboCount >= 4) {
            this.createPrismBurst(comboCount);
        }

        if (comboCount >= 6) {
            this.createMorphBlob(comboCount);
        }

        // Strong pulse on combos
        this.pulseDOMBlobs(comboCount * 0.4 + 0.5);

        // Connect effects to blobs
        if (comboCount >= 3) {
            this.createBlobConnectionEffects(comboCount);
        }
    }

    pulseDOMBlobs(intensity) {
        // Pulse all DOM blobs
        this.domBlobs.forEach((blob) => {
            const pulseData = this.blobPulses.get(blob);
            if (pulseData) {
                pulseData.intensity = Math.min(pulseData.intensity + intensity, 2.0);
                pulseData.lastPulse = Date.now();

                // Apply transform scale pulse
                const currentScale = 1 + pulseData.intensity * 0.3;
                blob.style.transform = `scale(${currentScale})`;
                blob.style.filter = `brightness(${1 + pulseData.intensity * 0.4}) saturate(${1 + pulseData.intensity * 0.5})`;
            }
        });
    }

    createBlobConnectionEffects(comboCount) {
        if (!this.effectsCanvas || this.domBlobs.length < 2 || this.fluidStreams.length >= this.MAX_STREAMS) return;

        // Reduced connection count
        const connectionCount = Math.min(Math.floor(comboCount / 2), this.MAX_STREAMS - this.fluidStreams.length);
        for (let i = 0; i < connectionCount; i++) {
            const blob1 = this.domBlobs[Math.floor(Math.random() * this.domBlobs.length)];
            const blob2 = this.domBlobs[Math.floor(Math.random() * this.domBlobs.length)];

            if (blob1 === blob2) continue;

            // Get blob positions
            const rect1 = blob1.getBoundingClientRect();
            const rect2 = blob2.getBoundingClientRect();
            const canvasRect = this.effectsCanvas.getBoundingClientRect();

            const x1 = rect1.left + rect1.width / 2 - canvasRect.left;
            const y1 = rect1.top + rect1.height / 2 - canvasRect.top;
            const x2 = rect2.left + rect2.width / 2 - canvasRect.left;
            const y2 = rect2.top + rect2.height / 2 - canvasRect.top;

            // Create flowing stream between blobs - reduced segments
            const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            const points = [];
            const segments = Math.min(Math.floor(distance / 30), 15); // Fewer segments

            for (let j = 0; j <= segments; j++) {
                const t = j / segments;
                const perpAngle = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
                const waveOffset = Math.sin(t * Math.PI * 3) * 30;

                points.push({
                    x: x1 + (x2 - x1) * t + Math.cos(perpAngle) * waveOffset,
                    y: y1 + (y2 - y1) * t + Math.sin(perpAngle) * waveOffset,
                });
            }

            this.fluidStreams.push({
                points,
                life: 1.0,
                maxLife: 1.5 + Math.random() * 0.5,
                hue: Math.random() * 360,
                width: Math.random() * 10 + 6,
                flowOffset: 0,
                flowSpeed: Math.random() * 0.15 + 0.1,
                particleEmit: true,
            });
        }
    }

    createLiquidSplash(lineCount) {
        if (!this.effectsCanvas) return;

        // Enforce particle limit
        if (this.liquidSplashes.length >= this.MAX_PARTICLES) {
            // Remove oldest particles
            this.liquidSplashes.splice(0, Math.floor(this.MAX_PARTICLES * 0.3));
        }

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;
        const colors = [
            { h: 280, s: 70, l: 65 }, // Purple
            { h: 200, s: 80, l: 60 }, // Cyan
            { h: 320, s: 75, l: 70 }, // Pink
            { h: 180, s: 70, l: 65 }, // Aqua
        ];

        // Reduced particle count for performance
        const particleCount = Math.min(lineCount * 12 + this.comboMultiplier * 8, this.MAX_PARTICLES);

        // Spawn some particles from center
        const centerParticles = Math.floor(particleCount * 0.6);
        for (let i = 0; i < centerParticles; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = (Math.random() * 4 + 3) * this.comboMultiplier;
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.liquidSplashes.push({
                x: centerX,
                y: centerY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                maxLife: Math.random() * 0.9 + 0.7,
                size: Math.random() * 8 + 3,
                color,
                viscosity: Math.random() * 0.15 + 0.85,
                shimmer: Math.random() * Math.PI * 2,
                trail: [],
            });
        }

        // Spawn remaining particles from blob positions
        const blobParticles = particleCount - centerParticles;
        if (this.domBlobs.length > 0 && blobParticles > 0) {
            const particlesPerBlob = Math.ceil(blobParticles / this.domBlobs.length);

            this.domBlobs.forEach((blob) => {
                const rect = blob.getBoundingClientRect();
                const canvasRect = this.effectsCanvas.getBoundingClientRect();
                const blobX = rect.left + rect.width / 2 - canvasRect.left;
                const blobY = rect.top + rect.height / 2 - canvasRect.top;

                for (let i = 0; i < particlesPerBlob; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const speed = (Math.random() * 3 + 2) * this.comboMultiplier;
                    const color = colors[Math.floor(Math.random() * colors.length)];

                    this.liquidSplashes.push({
                        x: blobX,
                        y: blobY,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        life: 1.0,
                        maxLife: Math.random() * 0.9 + 0.7,
                        size: Math.random() * 8 + 3,
                        color,
                        viscosity: Math.random() * 0.15 + 0.85,
                        shimmer: Math.random() * Math.PI * 2,
                        trail: [],
                    });
                }
            });
        }
    }

    createIridescenceWave(comboCount) {
        if (!this.effectsCanvas) return;

        // Limit waves
        if (this.iridescenceWaves.length >= this.MAX_WAVES) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        const waveCount = Math.min(comboCount, this.MAX_WAVES - this.iridescenceWaves.length);

        // Half waves from random positions
        const randomWaves = Math.floor(waveCount / 2);
        for (let i = 0; i < randomWaves; i++) {
            this.iridescenceWaves.push({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: 0,
                maxRadius: Math.random() * 400 + 300,
                life: 1.0,
                maxLife: 1.5 + Math.random() * 0.8,
                hueOffset: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 0.05,
                rotation: 0,
            });
        }

        // Half waves from blob positions
        const blobWaves = waveCount - randomWaves;
        if (this.domBlobs.length > 0) {
            for (let i = 0; i < blobWaves; i++) {
                const blob = this.domBlobs[Math.floor(Math.random() * this.domBlobs.length)];
                const rect = blob.getBoundingClientRect();
                const canvasRect = this.effectsCanvas.getBoundingClientRect();
                const blobX = rect.left + rect.width / 2 - canvasRect.left;
                const blobY = rect.top + rect.height / 2 - canvasRect.top;

                this.iridescenceWaves.push({
                    x: blobX,
                    y: blobY,
                    radius: 0,
                    maxRadius: Math.random() * 400 + 300,
                    life: 1.0,
                    maxLife: 1.5 + Math.random() * 0.8,
                    hueOffset: Math.random() * 360,
                    rotationSpeed: (Math.random() - 0.5) * 0.05,
                    rotation: 0,
                });
            }
        }
    }

    createDreamRipples(lineCount) {
        if (!this.effectsCanvas) return;

        // Limit ripples
        if (this.dreamRipples.length >= this.MAX_RIPPLES) return;

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;

        const rippleCount = Math.min(lineCount * 2, this.MAX_RIPPLES - this.dreamRipples.length);
        for (let i = 0; i < rippleCount; i++) {
            this.dreamRipples.push({
                x: centerX + (Math.random() - 0.5) * 200,
                y: centerY + (Math.random() - 0.5) * 200,
                radius: 0,
                maxRadius: Math.random() * 250 + 200,
                life: 1.0,
                maxLife: 1.2 + Math.random() * 0.6,
                hue: Math.random() * 360,
                frequency: Math.random() * 8 + 6,
                amplitude: Math.random() * 15 + 10,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }

    createFluidStreams(lineCount) {
        if (!this.effectsCanvas) return;

        // Limit streams
        if (this.fluidStreams.length >= this.MAX_STREAMS) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        const streamCount = Math.min(lineCount, this.MAX_STREAMS - this.fluidStreams.length);
        for (let i = 0; i < streamCount; i++) {
            const startX = Math.random() * width;
            const startY = Math.random() * height;
            const angle = Math.random() * Math.PI * 2;
            const length = Math.random() * 300 + 200;

            const points = [];
            const segments = 20;
            for (let j = 0; j <= segments; j++) {
                const t = j / segments;
                const deviation = Math.sin(t * Math.PI * 4) * 50;
                points.push({
                    x: startX + Math.cos(angle) * length * t + Math.cos(angle + Math.PI / 2) * deviation,
                    y: startY + Math.sin(angle) * length * t + Math.sin(angle + Math.PI / 2) * deviation,
                });
            }

            this.fluidStreams.push({
                points,
                life: 1.0,
                maxLife: 1.0 + Math.random() * 0.5,
                hue: Math.random() * 360,
                width: Math.random() * 8 + 4,
                flowOffset: 0,
                flowSpeed: Math.random() * 0.1 + 0.05,
            });
        }
    }

    createPrismBurst(comboCount) {
        if (!this.effectsCanvas) return;

        // Limit prism bursts
        if (this.prismBursts.length >= this.MAX_BURSTS) return;

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;

        const rayCount = Math.min(comboCount * 2, 12); // Reduced from *3, 18 to *2, 12
        const rays = [];

        for (let i = 0; i < rayCount; i++) {
            const angle = (Math.PI * 2 / rayCount) * i;
            const length = Math.random() * 200 + 150;
            rays.push({
                angle,
                length,
                hue: (360 / rayCount) * i,
                width: Math.random() * 6 + 3,
            });
        }

        this.prismBursts.push({
            x: centerX,
            y: centerY,
            rays,
            life: 1.0,
            maxLife: 1.2 + Math.random() * 0.5,
            rotation: 0,
            rotationSpeed: (Math.random() - 0.5) * 0.08,
            expansion: 0,
        });
    }

    createMorphBlob(comboCount) {
        if (!this.effectsCanvas) return;

        // Limit morph blobs
        if (this.morphBlobs.length >= this.MAX_BLOBS) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        const blobCount = Math.min(Math.floor(comboCount / 4), this.MAX_BLOBS - this.morphBlobs.length);
        for (let i = 0; i < blobCount; i++) {
            const points = [];
            const numPoints = 8;
            const baseRadius = Math.random() * 80 + 60;

            for (let j = 0; j < numPoints; j++) {
                const angle = (Math.PI * 2 / numPoints) * j;
                const radius = baseRadius + (Math.random() - 0.5) * 40;
                points.push({
                    angle,
                    radius,
                    targetRadius: baseRadius + (Math.random() - 0.5) * 40,
                    morphSpeed: Math.random() * 0.02 + 0.01,
                });
            }

            this.morphBlobs.push({
                x: Math.random() * width,
                y: Math.random() * height,
                points,
                life: 1.0,
                maxLife: 2.5 + Math.random() * 1.0,
                hue: Math.random() * 360,
                hueShift: (Math.random() - 0.5) * 2,
                rotation: 0,
                rotationSpeed: (Math.random() - 0.5) * 0.03,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
            });
        }
    }

    startEffectsLoop() {
        if (this.effectsAnimationFrame) return;

        const tick = (timestamp) => {
            if (!this.effectsAnimationFrame || !this.isActive) {
                return;
            }

            if (!this.lastEffectsFrameTime) {
                this.lastEffectsFrameTime = timestamp;
            }

            const delta = Math.min((timestamp - this.lastEffectsFrameTime) / 1000, 0.1);
            this.lastEffectsFrameTime = timestamp;

            this.updateEffects(delta);
            this.renderEffects();

            this.effectsAnimationFrame = requestAnimationFrame(tick);
        };

        this.lastEffectsFrameTime = 0;
        this.effectsAnimationFrame = requestAnimationFrame(tick);
    }

    stopEffectsLoop() {
        if (this.effectsAnimationFrame) {
            cancelAnimationFrame(this.effectsAnimationFrame);
            this.effectsAnimationFrame = null;
        }
        this.lastEffectsFrameTime = 0;
    }

    updateEffects(delta) {
        // Update blob pulses
        const now = Date.now();
        this.domBlobs.forEach((blob) => {
            const pulseData = this.blobPulses.get(blob);
            if (pulseData && pulseData.intensity > 0) {
                // Decay intensity over time
                const timeSincePulse = (now - pulseData.lastPulse) / 1000;
                pulseData.intensity = Math.max(0, pulseData.intensity - delta * 0.8);

                // Update blob visual
                const currentScale = 1 + pulseData.intensity * 0.3;
                blob.style.transform = `scale(${currentScale})`;
                blob.style.filter = `brightness(${1 + pulseData.intensity * 0.4}) saturate(${1 + pulseData.intensity * 0.5})`;

                // Create ripples from pulsing blobs - reduced rate
                if (pulseData.intensity > 0.8 && Math.random() > 0.95 && this.dreamRipples.length < this.MAX_RIPPLES) {
                    const rect = blob.getBoundingClientRect();
                    const canvasRect = this.effectsCanvas?.getBoundingClientRect();
                    if (canvasRect) {
                        const blobX = rect.left + rect.width / 2 - canvasRect.left;
                        const blobY = rect.top + rect.height / 2 - canvasRect.top;

                        this.dreamRipples.push({
                            x: blobX,
                            y: blobY,
                            radius: 0,
                            maxRadius: Math.random() * 150 + 100,
                            life: 1.0,
                            maxLife: 0.8 + Math.random() * 0.4,
                            hue: Math.random() * 360,
                            frequency: Math.random() * 6 + 4,
                            amplitude: Math.random() * 10 + 5,
                            phase: Math.random() * Math.PI * 2,
                        });
                    }
                }
            }
        });

        // Update liquid splashes
        for (let i = this.liquidSplashes.length - 1; i >= 0; i--) {
            const p = this.liquidSplashes[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.1; // Gentle gravity
            p.vx *= p.viscosity;
            p.vy *= p.viscosity;
            p.life -= delta / p.maxLife;
            p.shimmer += 0.15;

            if (p.life <= 0) {
                this.liquidSplashes.splice(i, 1);
            }
        }

        // Update iridescence waves
        for (let i = this.iridescenceWaves.length - 1; i >= 0; i--) {
            const wave = this.iridescenceWaves[i];
            wave.radius += (wave.maxRadius / wave.maxLife) * delta;
            wave.life -= delta / wave.maxLife;
            wave.rotation += wave.rotationSpeed;

            if (wave.life <= 0) {
                this.iridescenceWaves.splice(i, 1);
            }
        }

        // Update dream ripples
        for (let i = this.dreamRipples.length - 1; i >= 0; i--) {
            const ripple = this.dreamRipples[i];
            ripple.radius += (ripple.maxRadius / ripple.maxLife) * delta;
            ripple.life -= delta / ripple.maxLife;
            ripple.phase += 0.1;

            if (ripple.life <= 0) {
                this.dreamRipples.splice(i, 1);
            }
        }

        // Update fluid streams
        for (let i = this.fluidStreams.length - 1; i >= 0; i--) {
            const stream = this.fluidStreams[i];
            stream.life -= delta / stream.maxLife;
            stream.flowOffset += stream.flowSpeed;

            if (stream.life <= 0) {
                this.fluidStreams.splice(i, 1);
            }
        }

        // Update prism bursts
        for (let i = this.prismBursts.length - 1; i >= 0; i--) {
            const burst = this.prismBursts[i];
            burst.life -= delta / burst.maxLife;
            burst.rotation += burst.rotationSpeed;
            burst.expansion += delta * 100;

            if (burst.life <= 0) {
                this.prismBursts.splice(i, 1);
            }
        }

        // Update morph blobs
        for (let i = this.morphBlobs.length - 1; i >= 0; i--) {
            const blob = this.morphBlobs[i];
            blob.life -= delta / blob.maxLife;
            blob.x += blob.vx;
            blob.y += blob.vy;
            blob.rotation += blob.rotationSpeed;
            blob.hue += blob.hueShift;

            // Morph blob points
            blob.points.forEach((point) => {
                const diff = point.targetRadius - point.radius;
                point.radius += diff * point.morphSpeed;

                // Set new target occasionally
                if (Math.abs(diff) < 5) {
                    point.targetRadius = blob.points[0].radius * 0.7 + (Math.random() - 0.5) * 60;
                }
            });

            if (blob.life <= 0) {
                this.morphBlobs.splice(i, 1);
            }
        }
    }

    renderEffects() {
        if (!this.effectsCanvas || !this.effectsCtx) return;

        const ctx = this.effectsCtx;
        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Render dream ripples - optimized with fewer points
        this.dreamRipples.forEach((ripple) => {
            const alpha = ripple.life * 0.6;
            ctx.strokeStyle = `hsla(${ripple.hue}, 70%, 65%, ${alpha})`;
            ctx.lineWidth = 3;
            ctx.shadowBlur = 20;
            ctx.shadowColor = `hsl(${ripple.hue}, 70%, 65%)`;

            // Draw wavy ripple - reduced angle step from 0.1 to 0.15 for better performance
            ctx.beginPath();
            for (let angle = 0; angle <= Math.PI * 2; angle += 0.15) {
                const wave = Math.sin(angle * ripple.frequency + ripple.phase) * ripple.amplitude;
                const r = ripple.radius + wave;
                const x = ripple.x + Math.cos(angle) * r;
                const y = ripple.y + Math.sin(angle) * r;
                if (angle === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.closePath();
            ctx.stroke();
        });

        // Render iridescence waves - reduced from 4 to 3 rings for performance
        this.iridescenceWaves.forEach((wave) => {
            const alpha = wave.life * 0.5;
            ctx.save();
            ctx.translate(wave.x, wave.y);
            ctx.rotate(wave.rotation);

            // Multiple colored rings - reduced to 3 rings
            for (let ring = 0; ring < 3; ring++) {
                const hue = (wave.hueOffset + ring * 120) % 360;
                const radius = wave.radius + ring * 20;
                ctx.strokeStyle = `hsla(${hue}, 80%, 70%, ${alpha * (1 - ring * 0.25)})`;
                ctx.lineWidth = 4;
                ctx.shadowBlur = 20; // Reduced from 25
                ctx.shadowColor = `hsl(${hue}, 80%, 70%)`;
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.restore();
        });

        // Render fluid streams - optimized gradient
        this.fluidStreams.forEach((stream) => {
            const alpha = stream.life * 0.7;

            // Create gradient along path - reduced color stops from 6 to 3
            const gradient = ctx.createLinearGradient(
                stream.points[0].x,
                stream.points[0].y,
                stream.points[stream.points.length - 1].x,
                stream.points[stream.points.length - 1].y
            );

            for (let i = 0; i <= 2; i++) {
                const hue = (stream.hue + i * 120) % 360;
                gradient.addColorStop(i / 2, `hsl(${hue}, 75%, 65%)`);
            }

            ctx.strokeStyle = gradient;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = stream.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.shadowBlur = 15; // Reduced from 20
            ctx.shadowColor = `hsl(${stream.hue}, 75%, 65%)`;

            ctx.beginPath();
            ctx.moveTo(stream.points[0].x, stream.points[0].y);
            for (let i = 1; i < stream.points.length; i++) {
                ctx.lineTo(stream.points[i].x, stream.points[i].y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        });

        // Render liquid splashes
        this.liquidSplashes.forEach((p) => {
            const alpha = p.life;
            const shimmer = Math.sin(p.shimmer) * 0.3 + 0.7;
            const { h, s, l } = p.color;

            // Outer glow
            const glowGradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
            glowGradient.addColorStop(0, `hsla(${h}, ${s}%, ${l}%, ${alpha * shimmer * 0.6})`);
            glowGradient.addColorStop(0.5, `hsla(${h}, ${s}%, ${l}%, ${alpha * shimmer * 0.3})`);
            glowGradient.addColorStop(1, `hsla(${h}, ${s}%, ${l}%, 0)`);

            ctx.fillStyle = glowGradient;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
            ctx.fill();

            // Core
            const coreGradient = ctx.createRadialGradient(
                p.x - p.size * 0.3,
                p.y - p.size * 0.3,
                0,
                p.x,
                p.y,
                p.size
            );
            coreGradient.addColorStop(0, `hsla(${h}, ${s}%, ${Math.min(l + 20, 95)}%, ${alpha * shimmer})`);
            coreGradient.addColorStop(0.6, `hsla(${h}, ${s}%, ${l}%, ${alpha * shimmer * 0.8})`);
            coreGradient.addColorStop(1, `hsla(${h}, ${s}%, ${l - 10}%, ${alpha * shimmer * 0.5})`);

            ctx.fillStyle = coreGradient;
            ctx.shadowBlur = 15;
            ctx.shadowColor = `hsl(${h}, ${s}%, ${l}%)`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });

        // Render prism bursts
        this.prismBursts.forEach((burst) => {
            const alpha = burst.life;
            ctx.save();
            ctx.translate(burst.x, burst.y);
            ctx.rotate(burst.rotation);

            burst.rays.forEach((ray) => {
                const length = ray.length + burst.expansion;
                ctx.strokeStyle = `hsla(${ray.hue}, 85%, 70%, ${alpha})`;
                ctx.lineWidth = ray.width;
                ctx.shadowBlur = 25;
                ctx.shadowColor = `hsl(${ray.hue}, 85%, 70%)`;
                ctx.lineCap = 'round';

                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos(ray.angle) * length, Math.sin(ray.angle) * length);
                ctx.stroke();
            });

            ctx.restore();
        });

        // Render morph blobs
        this.morphBlobs.forEach((blob) => {
            const alpha = blob.life * 0.6;
            ctx.save();
            ctx.translate(blob.x, blob.y);
            ctx.rotate(blob.rotation);

            // Create blob path
            ctx.beginPath();
            for (let i = 0; i < blob.points.length; i++) {
                const point = blob.points[i];
                const nextPoint = blob.points[(i + 1) % blob.points.length];

                const x1 = Math.cos(point.angle) * point.radius;
                const y1 = Math.sin(point.angle) * point.radius;
                const x2 = Math.cos(nextPoint.angle) * nextPoint.radius;
                const y2 = Math.sin(nextPoint.angle) * nextPoint.radius;

                const cpAngle = point.angle + (nextPoint.angle - point.angle) / 2;
                const cpRadius = (point.radius + nextPoint.radius) / 2;
                const cpX = Math.cos(cpAngle) * cpRadius;
                const cpY = Math.sin(cpAngle) * cpRadius;

                if (i === 0) {
                    ctx.moveTo(x1, y1);
                }
                ctx.quadraticCurveTo(cpX, cpY, x2, y2);
            }
            ctx.closePath();

            // Fill with gradient
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, blob.points[0].radius * 1.5);
            gradient.addColorStop(0, `hsla(${blob.hue}, 75%, 75%, ${alpha})`);
            gradient.addColorStop(0.5, `hsla(${(blob.hue + 60) % 360}, 70%, 65%, ${alpha * 0.7})`);
            gradient.addColorStop(1, `hsla(${(blob.hue + 120) % 360}, 65%, 55%, ${alpha * 0.4})`);

            ctx.fillStyle = gradient;
            ctx.shadowBlur = 30;
            ctx.shadowColor = `hsl(${blob.hue}, 75%, 70%)`;
            ctx.fill();

            // Outline
            ctx.strokeStyle = `hsla(${blob.hue}, 80%, 85%, ${alpha * 0.8})`;
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.restore();
        });

        // Reset shadow
        ctx.shadowBlur = 0;
    }

    stop() {
        this.stopEffectsLoop();
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
        super.stop();
    }

    cleanup() {
        this.cleanupEffects();
        super.cleanup();
    }

    cleanupEffects() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Clear effect arrays
        this.liquidSplashes = [];
        this.iridescenceWaves = [];
        this.dreamRipples = [];
        this.fluidStreams = [];
        this.prismBursts = [];
        this.morphBlobs = [];

        // Reset blob styles
        this.domBlobs.forEach((blob) => {
            blob.style.transform = '';
            blob.style.filter = '';
        });
        this.domBlobs = [];
        this.blobPulses.clear();

        // Stop animation loop
        this.stopEffectsLoop();

        // Remove canvas
        if (this.effectsCanvas) {
            this.effectsCanvas.remove();
            this.effectsCanvas = null;
            this.effectsCtx = null;
        }
    }

    /**
     * Provide Fluid Dreams themed tetromino styling (liquid neon palette)
     * @returns {Object} Fluid Dreams tetromino configuration
     */
    getTetrominoConfig() {
        return FLUID_DREAMS_TETROMINOS;
    }
}
