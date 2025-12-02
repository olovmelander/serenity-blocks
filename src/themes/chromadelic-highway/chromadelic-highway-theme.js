import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CHROMADELIC_HIGHWAY_TETROMINOS } from './chromadelic-highway-tetrominos.js';

/**
 * Chromadelic Highway Theme - Enhanced Neon Dream
 * 
 * A stunning visualization of flowing rainbow waves and psychedelic effects.
 * Features:
 * - Multi-layered rainbow wave system with dynamic glow
 * - Ambient sparkles and twinkling stars
 * - Rainbow shockwave rings on combos
 * - Particle bursts from wave surfaces
 * - Piece lock effects (wave pulses, rainbow ripples, sparkle bursts)
 * - Light beams and aurora streaks
 * - Neon grid lines for retro aesthetic
 */
export default class ChromadelicHighwayTheme extends BaseTheme {
    constructor() {
        super('chromadelic-highway');
        this.animationTime = 0;
        this.eventUnsubscribers = [];

        // Smooth easing for combo effects - current values
        this.wavePulseIntensity = 0;
        this.waveAmplitudeBoost = 0;
        this.colorSpeedBoost = 0;

        // Smooth easing - target values
        this.wavePulseTarget = 0;
        this.amplitudeBoostTarget = 0;
        this.colorSpeedTarget = 0;

        // Visual elements
        this.sparkles = [];
        this.maxSparkles = 60;
        this.stars = [];
        this.maxStars = 40;
        this.comboParticles = [];
        this.shockwaves = [];
        this.lightBeams = [];
        this.auroraStreaks = [];
        this.lockRipples = [];
        this.lockSparkles = [];

        // Canvas references
        this.waveCanvas = null;
        this.waveCtx = null;
        this.sparkleCanvas = null;
        this.sparkleCtx = null;

        // Performance cache
        this.cachedWaveGradient = null;
        this.cachedGradientWidth = 0;

        // Random time offset
        this.timeOffset = Math.random() * 10000;

        // Enhanced rainbow color palette
        this.rainbowPalette = [
            { hue: 0, color: [255, 50, 100] },     // Hot Pink
            { hue: 30, color: [255, 120, 0] },     // Orange
            { hue: 60, color: [255, 220, 0] },     // Yellow
            { hue: 120, color: [0, 255, 120] },    // Green
            { hue: 180, color: [0, 220, 255] },    // Cyan
            { hue: 240, color: [80, 120, 255] },   // Blue
            { hue: 280, color: [160, 80, 255] },   // Purple
            { hue: 320, color: [255, 50, 180] },   // Magenta
        ];

        // Quality presets - Enhanced with new effects
        this.qualityPresets = {
            Minimal: {
                maxSparkles: 15,
                maxStars: 10,
                waveLayers: 2,
                waveStep: 18,
                maxShockwaves: 1,
                maxComboParticles: 8,
                particlesPerWave: 2,
                trailSegments: 0,
                shadowBlur: 0,
                glowLayers: false,
                waveGlowIntensity: 0.3,
                skipFrames: 2,
                useSimpleGlow: true,
                maxLightBeams: 0,
                maxAuroraStreaks: 0,
                enableLockEffects: false,
                lockRippleCount: 0,
                lockSparkleCount: 0,
            },
            Low: {
                maxSparkles: 25,
                maxStars: 15,
                waveLayers: 3,
                waveStep: 15,
                maxShockwaves: 1,
                maxComboParticles: 12,
                particlesPerWave: 3,
                trailSegments: 0,
                shadowBlur: 0,
                glowLayers: false,
                waveGlowIntensity: 0.4,
                skipFrames: 1,
                useSimpleGlow: true,
                maxLightBeams: 1,
                maxAuroraStreaks: 1,
                enableLockEffects: true,
                lockRippleCount: 1,
                lockSparkleCount: 2,
            },
            Medium: {
                maxSparkles: 40,
                maxStars: 25,
                waveLayers: 4,
                waveStep: 12,
                maxShockwaves: 2,
                maxComboParticles: 20,
                particlesPerWave: 5,
                trailSegments: 1,
                shadowBlur: 0,
                glowLayers: true,
                waveGlowIntensity: 0.6,
                skipFrames: 1,
                useSimpleGlow: true,
                maxLightBeams: 2,
                maxAuroraStreaks: 2,
                enableLockEffects: true,
                lockRippleCount: 2,
                lockSparkleCount: 4,
            },
            High: {
                maxSparkles: 55,
                maxStars: 35,
                waveLayers: 5,
                waveStep: 10,
                maxShockwaves: 3,
                maxComboParticles: 30,
                particlesPerWave: 7,
                trailSegments: 2,
                shadowBlur: 0,
                glowLayers: true,
                waveGlowIntensity: 0.8,
                skipFrames: 0,
                useSimpleGlow: true,
                maxLightBeams: 3,
                maxAuroraStreaks: 3,
                enableLockEffects: true,
                lockRippleCount: 3,
                lockSparkleCount: 6,
            },
            Ultra: {
                maxSparkles: 75,
                maxStars: 45,
                waveLayers: 6,
                waveStep: 8,
                maxShockwaves: 4,
                maxComboParticles: 45,
                particlesPerWave: 10,
                trailSegments: 3,
                shadowBlur: 0.2,
                glowLayers: true,
                waveGlowIntensity: 1.0,
                skipFrames: 0,
                useSimpleGlow: false,
                maxLightBeams: 5,
                maxAuroraStreaks: 4,
                enableLockEffects: true,
                lockRippleCount: 4,
                lockSparkleCount: 8,
            },
            Extreme: {
                maxSparkles: 100,
                maxStars: 60,
                waveLayers: 8,
                waveStep: 6,
                maxShockwaves: 6,
                maxComboParticles: 60,
                particlesPerWave: 14,
                trailSegments: 5,
                shadowBlur: 0.4,
                glowLayers: true,
                waveGlowIntensity: 1.3,
                skipFrames: 0,
                useSimpleGlow: false,
                maxLightBeams: 7,
                maxAuroraStreaks: 6,
                enableLockEffects: true,
                lockRippleCount: 5,
                lockSparkleCount: 12,
            },
        };

        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets.High;
        this.frameCounter = 0;
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`Unknown quality preset: ${quality}, using High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        this.maxSparkles = this.activePreset.maxSparkles;
        this.maxStars = this.activePreset.maxStars;

        console.log(`🌈 Chromadelic Highway: Applied ${quality} quality preset`);
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    setupQualityListener() {
        const qualityChangeHandler = () => {
            if (!this.isActive) return;

            const newQuality = this.getGraphicsQuality();
            if (newQuality !== this.currentQuality) {
                this.applyQualityPreset(newQuality);
                this.initSparkles();
                this.initStars();
            }
        };

        window.addEventListener('settingsChanged', qualityChangeHandler);
        this.qualityChangeHandler = qualityChangeHandler;
    }

    async createScene() {
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);

        const container = this.getContainer('chromadelic-highway-theme');
        const background = this.getContainer('chromadelic-highway-background');

        this.createRainbowWaves();
        this.createSparkles();
        this.setupEventListeners();
        this.setupQualityListener();
        this.initSparkles();
        this.initStars();

        this.animate();
    }

    createRainbowWaves() {
        const waveContainer = this.getContainer('chromadelic-highway-waves');

        if (waveContainer && waveContainer.children.length === 0) {
            this.waveCanvas = document.createElement('canvas');
            this.waveCanvas.className = 'chromadelic-wave-canvas';
            this.waveCtx = this.waveCanvas.getContext('2d', { alpha: true });

            waveContainer.appendChild(this.waveCanvas);

            this.resizeWaves();
            window.addEventListener('resize', () => this.resizeWaves());
        } else if (waveContainer && waveContainer.children.length > 0) {
            this.waveCanvas = waveContainer.querySelector('.chromadelic-wave-canvas');
            if (this.waveCanvas) {
                this.waveCtx = this.waveCanvas.getContext('2d', { alpha: true });
                this.resizeWaves();
            }
        }
    }

    resizeWaves() {
        if (!this.waveCanvas) return;

        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        const rect = this.waveCanvas.getBoundingClientRect();

        this.waveCanvas.width = rect.width * dpr;
        this.waveCanvas.height = rect.height * dpr;

        this.waveCtx.scale(dpr, dpr);

        this.waveWidth = rect.width;
        this.waveHeight = rect.height;
    }

    drawRainbowWaves() {
        if (!this.waveCtx || !this.waveCanvas) return;

        if (this.frameCounter % (this.activePreset.skipFrames + 1) !== 0) {
            return;
        }

        const ctx = this.waveCtx;
        const width = this.waveWidth;
        const height = this.waveHeight;

        ctx.clearRect(0, 0, width, height);

        // Enhanced rainbow color stops
        const rainbowStops = [
            { pos: 0.0, color: [255, 50, 120] },
            { pos: 0.12, color: [255, 100, 0] },
            { pos: 0.25, color: [255, 200, 0] },
            { pos: 0.38, color: [120, 255, 80] },
            { pos: 0.5, color: [0, 255, 180] },
            { pos: 0.62, color: [0, 180, 255] },
            { pos: 0.75, color: [120, 80, 255] },
            { pos: 0.88, color: [255, 50, 200] },
            { pos: 1.0, color: [255, 50, 120] },
        ];

        const effectiveSpeed = 0.0007 * (1 + this.colorSpeedBoost * 0.6);
        const time = (this.animationTime + this.timeOffset) * effectiveSpeed;

        const numLayers = this.activePreset.waveLayers;

        // Draw waves from back to front
        for (let layer = 0; layer < numLayers; layer++) {
            const layerDepth = layer / numLayers;

            const layerSpeed = 0.35 + layerDepth * 0.8;
            const layerHeight = height * (0.12 + layerDepth * 0.35);
            const layerY = height * 0.28 + layerDepth * height * 0.38;
            const layerAlpha = 0.2 + layerDepth * 0.4;

            const baseAmplitude = 45 + layerDepth * 80;
            const amplitude = baseAmplitude * (1 + this.waveAmplitudeBoost * 0.9);
            const frequency = 0.0025 - layerDepth * 0.0007;
            const phaseOffset = time * layerSpeed + layer * 0.9;

            const breathe = Math.sin(time * 2.2 + layer * 0.6) * 0.25 + 1;
            const pulseEffect = 1 + this.wavePulseIntensity * 0.5;

            // Create gradient
            const gradient = ctx.createLinearGradient(0, 0, width, 0);
            const colorOffset = (time * 1.4 + layer * 0.35) % 1;

            for (let i = 0; i < rainbowStops.length; i++) {
                const stop = rainbowStops[i];
                const pos = (stop.pos + colorOffset) % 1;
                const [r, g, b] = stop.color;
                const alpha = layerAlpha * breathe * pulseEffect;
                gradient.addColorStop(pos, `rgba(${r}, ${g}, ${b}, ${alpha})`);
            }

            ctx.fillStyle = gradient;

            if (this.activePreset.shadowBlur > 0) {
                const baseGlowIntensity = 35 + layerDepth * 55;
                const glowIntensity = baseGlowIntensity * this.activePreset.waveGlowIntensity;
                ctx.shadowBlur = glowIntensity * this.activePreset.shadowBlur;
                const glowHue = (time * 70 + layer * 55) % 360;
                ctx.shadowColor = `hsla(${glowHue}, 100%, 70%, ${layerAlpha * 1.3})`;
            }

            // Draw wave shape
            ctx.beginPath();
            ctx.moveTo(0, height);
            ctx.lineTo(0, layerY + layerHeight);

            for (let x = 0; x <= width; x += this.activePreset.waveStep) {
                const waveOffset = Math.sin(x * frequency + phaseOffset) * amplitude * breathe * pulseEffect;
                const secondaryWave = Math.sin(x * frequency * 2.5 + phaseOffset * 1.3) * amplitude * 0.15;
                const waveY = layerY + waveOffset + secondaryWave;
                ctx.lineTo(x, waveY);
            }

            ctx.lineTo(width, layerY + layerHeight);
            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fill();

            if (this.activePreset.shadowBlur > 0) {
                ctx.shadowBlur = 0;
            }
        }

        // Smooth easing
        const lerpFactor = 0.08;
        this.wavePulseIntensity += (this.wavePulseTarget - this.wavePulseIntensity) * lerpFactor;
        this.waveAmplitudeBoost += (this.amplitudeBoostTarget - this.waveAmplitudeBoost) * lerpFactor;
        this.colorSpeedBoost += (this.colorSpeedTarget - this.colorSpeedBoost) * lerpFactor;

        this.wavePulseTarget *= 0.96;
        this.amplitudeBoostTarget *= 0.96;
        this.colorSpeedTarget *= 0.96;

        // Clamp values
        if (Math.abs(this.wavePulseIntensity) < 0.001) this.wavePulseIntensity = 0;
        if (Math.abs(this.waveAmplitudeBoost) < 0.001) this.waveAmplitudeBoost = 0;
        if (Math.abs(this.colorSpeedBoost) < 0.001) this.colorSpeedBoost = 0;
        if (Math.abs(this.wavePulseTarget) < 0.001) this.wavePulseTarget = 0;
        if (Math.abs(this.amplitudeBoostTarget) < 0.001) this.amplitudeBoostTarget = 0;
        if (Math.abs(this.colorSpeedTarget) < 0.001) this.colorSpeedTarget = 0;
    }

    getWaveSurfacePoint(xPercent, layerIndex = 2) {
        if (!this.waveWidth || !this.waveHeight) return { x: 0.5, y: 0.6 };

        const effectiveSpeed = 0.0007 * (1 + this.colorSpeedBoost * 0.6);
        const time = (this.animationTime + this.timeOffset) * effectiveSpeed;

        const numLayers = this.activePreset.waveLayers;
        const layerDepth = layerIndex / numLayers;
        const layerSpeed = 0.35 + layerDepth * 0.8;
        const layerY = this.waveHeight * (0.28 + layerDepth * 0.38);

        const baseAmplitude = 45 + layerDepth * 80;
        const amplitude = baseAmplitude * (1 + this.waveAmplitudeBoost * 0.9);
        const frequency = 0.0025 - layerDepth * 0.0007;
        const phaseOffset = time * layerSpeed + layerIndex * 0.9;

        const breathe = Math.sin(time * 2.2 + layerIndex * 0.6) * 0.25 + 1;
        const pulseEffect = 1 + this.wavePulseIntensity * 0.5;

        const x = xPercent * this.waveWidth;
        const waveOffset = Math.sin(x * frequency + phaseOffset) * amplitude * breathe * pulseEffect;
        const y = layerY + waveOffset;

        return {
            x: xPercent,
            y: y / this.waveHeight,
        };
    }

    createSparkles() {
        const sparkleContainer = this.getContainer('chromadelic-highway-sparkles');

        if (sparkleContainer && sparkleContainer.children.length === 0) {
            this.sparkleCanvas = document.createElement('canvas');
            this.sparkleCanvas.className = 'chromadelic-sparkle-canvas';
            this.sparkleCtx = this.sparkleCanvas.getContext('2d');

            sparkleContainer.appendChild(this.sparkleCanvas);

            this.resizeSparkles();
            window.addEventListener('resize', () => this.resizeSparkles());
        } else if (sparkleContainer && sparkleContainer.children.length > 0) {
            this.sparkleCanvas = sparkleContainer.querySelector('.chromadelic-sparkle-canvas');
            if (this.sparkleCanvas) {
                this.sparkleCtx = this.sparkleCanvas.getContext('2d');
                this.resizeSparkles();
            }
        }
    }

    resizeSparkles() {
        if (!this.sparkleCanvas) return;

        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        const rect = this.sparkleCanvas.getBoundingClientRect();

        this.sparkleCanvas.width = rect.width * dpr;
        this.sparkleCanvas.height = rect.height * dpr;

        this.sparkleCtx.scale(dpr, dpr);

        this.sparkleWidth = rect.width;
        this.sparkleHeight = rect.height;
    }

    initSparkles() {
        this.sparkles = [];

        const rainbowHues = [0, 30, 60, 120, 180, 240, 280, 320];

        for (let i = 0; i < this.maxSparkles; i++) {
            const type = Math.random();
            let size, speedY, speedX, twinkleSpeed, glowSize;

            if (type < 0.5) {
                size = this.random(0.6, 1.4);
                speedY = this.random(0.00004, 0.0001);
                speedX = this.random(-0.00003, 0.00003);
                twinkleSpeed = this.random(0.002, 0.006);
                glowSize = this.random(4, 7);
            } else if (type < 0.8) {
                size = this.random(1.4, 2.8);
                speedY = this.random(0.0001, 0.0003);
                speedX = this.random(-0.00006, 0.00006);
                twinkleSpeed = this.random(0.004, 0.012);
                glowSize = this.random(7, 12);
            } else {
                size = this.random(2.8, 4.5);
                speedY = this.random(0.0002, 0.0005);
                speedX = this.random(-0.00012, 0.00012);
                twinkleSpeed = this.random(0.008, 0.02);
                glowSize = this.random(12, 18);
            }

            const rainbowIndex = Math.floor(Math.random() * rainbowHues.length);
            const baseHue = rainbowHues[rainbowIndex];
            const yPosition = Math.random() < 0.7 ? this.random(0.4, 1) : Math.random();

            this.sparkles.push({
                x: Math.random(),
                y: yPosition,
                size,
                speedY,
                speedX,
                phase: Math.random() * Math.PI * 2,
                twinkleSpeed,
                baseHue,
                hueOffset: this.random(-20, 20),
                colorCycleSpeed: this.random(0.4, 1.8),
                glowSize,
                baseAlpha: this.random(0.35, 0.85),
            });
        }
    }

    initStars() {
        this.stars = [];
        for (let i = 0; i < this.maxStars; i++) {
            const isColoredStar = Math.random() < 0.3;
            this.stars.push({
                x: Math.random(),
                y: Math.random() * 0.4,
                size: this.random(0.6, 2),
                phase: Math.random() * Math.PI * 2,
                twinkleSpeed: this.random(0.001, 0.005),
                brightness: this.random(0.45, 0.95),
                isColored: isColoredStar,
                hue: isColoredStar ? Math.floor(Math.random() * 360) : 0,
            });
        }
    }

    drawSparkles() {
        if (!this.sparkleCtx || !this.sparkleCanvas) return;

        const ctx = this.sparkleCtx;
        const width = this.sparkleWidth;
        const height = this.sparkleHeight;

        ctx.clearRect(0, 0, width, height);

        const time = this.animationTime + this.timeOffset;

        // Draw light beams
        this.drawLightBeams(ctx, width, height, time);

        // Draw aurora streaks
        this.drawAuroraStreaks(ctx, width, height, time);

        // Draw sparkles
        this.sparkles.forEach((sparkle) => {
            sparkle.y += sparkle.speedY;
            sparkle.x += sparkle.speedX;

            if (sparkle.y > 1) {
                sparkle.y = Math.random() < 0.7 ? this.random(0.4, 1) : 0;
                sparkle.x = Math.random();
            }
            if (sparkle.x < 0) sparkle.x = 1;
            if (sparkle.x > 1) sparkle.x = 0;

            const x = sparkle.x * width;
            const y = sparkle.y * height;

            const timeFactor = time * 0.0007;
            const colorCycle = (timeFactor * sparkle.colorCycleSpeed * 70) % 360;
            const hue = (sparkle.baseHue + sparkle.hueOffset + colorCycle) % 360;

            const twinkle = (Math.sin(time * sparkle.twinkleSpeed + sparkle.phase) + 1) / 2;
            const alpha = sparkle.baseAlpha * (0.35 + twinkle * 0.65);
            const size = sparkle.size * (0.85 + twinkle * 0.15);

            const saturation = 95 + twinkle * 5;
            const lightness = 65 + twinkle * 20;

            if (this.activePreset.glowLayers && sparkle.size > 2.2) {
                const outerHue = (hue + 25) % 360;

                ctx.globalAlpha = alpha * 0.12;
                ctx.fillStyle = `hsla(${outerHue}, 100%, 70%, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, size * 3, 0, Math.PI * 2);
                ctx.fill();

                ctx.globalAlpha = alpha * 0.25;
                ctx.fillStyle = `hsla(${outerHue}, 100%, 72%, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, size * 2, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.globalAlpha = alpha;
            ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, 1)`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1;
        });

        // Draw stars
        this.stars.forEach((star) => {
            const x = star.x * width;
            const y = star.y * height;

            const twinkle = (Math.sin(time * star.twinkleSpeed + star.phase) + 1) / 2;
            const alpha = star.brightness * (0.5 + twinkle * 0.5);
            const size = star.size * (0.9 + twinkle * 0.1);

            ctx.globalAlpha = alpha * 0.25;
            const starColor = star.isColored 
                ? `hsla(${(star.hue + time * 0.01) % 360}, 80%, 80%, 1)` 
                : '#ffffff';
            ctx.fillStyle = starColor;
            ctx.beginPath();
            ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = alpha;
            ctx.fillStyle = starColor;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1;
        });

        // Draw lock ripples
        this.drawLockRipples(ctx, width, height);

        // Draw lock sparkles
        this.drawLockSparkles(ctx, width, height);

        // Draw shockwaves
        this.drawShockwaves(ctx, width, height);

        // Draw combo particles
        this.drawComboParticles(ctx, width, height, time);
    }

    drawLightBeams(ctx, width, height, time) {
        this.lightBeams = this.lightBeams.filter((beam) => {
            beam.life -= 0.006;
            beam.y += beam.speed;

            if (beam.life <= 0) return false;

            const x = beam.x * width;
            const beamWidth = beam.width * width;
            const lifeFactor = beam.life / beam.maxLife;

            const gradient = ctx.createLinearGradient(x - beamWidth / 2, 0, x + beamWidth / 2, 0);
            const hue = (beam.hue + (1 - lifeFactor) * 40) % 360;
            
            gradient.addColorStop(0, `hsla(${hue}, 100%, 70%, 0)`);
            gradient.addColorStop(0.3, `hsla(${hue}, 100%, 75%, ${lifeFactor * 0.15})`);
            gradient.addColorStop(0.5, `hsla(${hue}, 100%, 85%, ${lifeFactor * 0.25})`);
            gradient.addColorStop(0.7, `hsla(${hue}, 100%, 75%, ${lifeFactor * 0.15})`);
            gradient.addColorStop(1, `hsla(${hue}, 100%, 70%, 0)`);

            ctx.fillStyle = gradient;
            ctx.fillRect(x - beamWidth / 2, 0, beamWidth, height * 0.7);

            return true;
        });
    }

    drawAuroraStreaks(ctx, width, height, time) {
        this.auroraStreaks = this.auroraStreaks.filter((streak) => {
            streak.life -= 0.005;
            streak.phase += 0.03;

            if (streak.life <= 0) return false;

            const lifeFactor = streak.life / streak.maxLife;
            const y = streak.y * height;
            const streakHeight = streak.height * height;

            ctx.beginPath();
            
            for (let x = 0; x <= width; x += 20) {
                const waveY = y + Math.sin(x * 0.01 + streak.phase) * streakHeight * 0.5;
                if (x === 0) {
                    ctx.moveTo(x, waveY);
                } else {
                    ctx.lineTo(x, waveY);
                }
            }

            const hue = (streak.hue + (1 - lifeFactor) * 60) % 360;
            ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${lifeFactor * 0.3})`;
            ctx.lineWidth = streakHeight * lifeFactor;
            ctx.stroke();

            return true;
        });
    }

    drawLockRipples(ctx, width, height) {
        this.lockRipples = this.lockRipples.filter((ripple) => {
            ripple.radius += ripple.speed;
            ripple.life -= 0.025;

            if (ripple.life <= 0) return false;

            const x = ripple.x * width;
            const y = ripple.y * height;
            const lifeFactor = ripple.life;

            // Draw multiple rings
            for (let i = 0; i < 3; i++) {
                const ringRadius = Math.max(1, ripple.radius + i * 12);
                const ringAlpha = lifeFactor * 0.4 * (1 - i * 0.3);
                const hue = (ripple.hue + i * 30) % 360;

                ctx.globalAlpha = ringAlpha;
                ctx.strokeStyle = `hsla(${hue}, 100%, 75%, 1)`;
                ctx.lineWidth = Math.max(0.5, 3 - i * 0.8);

                ctx.beginPath();
                ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.globalAlpha = 1;
            return true;
        });
    }

    drawLockSparkles(ctx, width, height) {
        this.lockSparkles = this.lockSparkles.filter((sparkle) => {
            sparkle.x += sparkle.vx;
            sparkle.y += sparkle.vy;
            sparkle.vy += 0.0002; // Gravity
            sparkle.life -= 0.02;
            sparkle.hue = (sparkle.hue + 2) % 360;

            if (sparkle.life <= 0) return false;

            const x = sparkle.x * width;
            const y = sparkle.y * height;
            const lifeFactor = sparkle.life;
            const size = Math.max(0.5, sparkle.size * lifeFactor);

            // Glow
            ctx.globalAlpha = lifeFactor * 0.3;
            ctx.fillStyle = `hsla(${sparkle.hue}, 100%, 70%, 1)`;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(1, size * 2.5), 0, Math.PI * 2);
            ctx.fill();

            // Core
            ctx.globalAlpha = lifeFactor * 0.9;
            ctx.fillStyle = `hsla(${sparkle.hue}, 100%, 85%, 1)`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1;
            return true;
        });
    }

    drawShockwaves(ctx, width, height) {
        this.shockwaves = this.shockwaves.filter((wave) => {
            wave.radius += wave.speed;
            wave.life -= 0.007;

            if (wave.life <= 0) return false;

            const centerX = wave.x * width;
            const centerY = wave.y * height;
            const lifeFactor = wave.life / wave.maxLife;

            const hueOffset = wave.startHue + (1 - lifeFactor) * 70;

            const numRings = 4;
            for (let i = 0; i < numRings; i++) {
                const ringFactor = i / numRings;
                const ringRadius = Math.max(1, wave.radius + (i - numRings / 2) * 18);
                const ringAlpha = lifeFactor * 0.55 * (1 - ringFactor * 0.4);
                const ringHue = (hueOffset + i * 35) % 360;

                ctx.globalAlpha = ringAlpha;
                ctx.strokeStyle = `hsla(${ringHue}, 100%, 72%, 1)`;
                ctx.lineWidth = 22 * lifeFactor;

                ctx.beginPath();
                ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.globalAlpha = 1;
            return true;
        });
    }

    drawComboParticles(ctx, width, height, time) {
        this.comboParticles = this.comboParticles.filter((particle) => {
            const prevX = particle.x;
            const prevY = particle.y;

            particle.x += particle.vx;
            particle.y += particle.vy;

            const waveInfluence = Math.sin(this.animationTime * 0.003 + particle.x * 10) * 0.0004;
            particle.x += waveInfluence;

            particle.vy += 0.00012;
            particle.life -= 0.009;
            particle.hue = (particle.hue + particle.hueCycleSpeed * 0.018) % 360;

            if (particle.life <= 0) return false;

            const x = particle.x * width;
            const y = particle.y * height;
            const prevScreenX = prevX * width;
            const prevScreenY = prevY * height;

            const lifeFactor = Math.min(1, particle.life / 2.0);
            const alpha = lifeFactor ** 0.55 * particle.baseAlpha;
            const size = particle.size * (0.55 + lifeFactor * 0.45);

            // Trail
            if (particle.life < 2.0 && this.activePreset.trailSegments > 0) {
                const trailLength = this.activePreset.trailSegments;
                for (let t = 0; t < trailLength; t++) {
                    const trailFactor = t / trailLength;
                    const trailX = prevScreenX + (x - prevScreenX) * trailFactor;
                    const trailY = prevScreenY + (y - prevScreenY) * trailFactor;
                    const trailAlpha = alpha * (1 - trailFactor) * 0.35;
                    const trailSize = Math.max(0.5, size * (0.75 - trailFactor * 0.3));
                    const trailHue = (particle.hue - trailFactor * 35 + 360) % 360;

                    ctx.globalAlpha = trailAlpha;
                    ctx.fillStyle = `hsla(${trailHue}, 100%, 72%, 1)`;
                    ctx.beginPath();
                    ctx.arc(trailX, trailY, trailSize, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Glow
            if (this.activePreset.glowLayers) {
                const outerHue = (particle.hue + 180) % 360;

                ctx.globalAlpha = alpha * 0.18;
                ctx.fillStyle = `hsla(${outerHue}, 100%, 72%, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, Math.max(1, size * 2.5), 0, Math.PI * 2);
                ctx.fill();

                ctx.globalAlpha = alpha * 0.32;
                ctx.fillStyle = `hsla(${outerHue}, 100%, 78%, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, Math.max(0.5, size * 1.7), 0, Math.PI * 2);
                ctx.fill();
            }

            // Main particle
            ctx.globalAlpha = alpha;
            ctx.fillStyle = `hsla(${particle.hue}, 100%, ${78 + lifeFactor * 12}%, 1)`;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.5, size), 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1;
            return true;
        });
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) {
                const settings = typeof window !== 'undefined' ? window.settings : null;
                if (settings?.backgroundComboEffects !== false) {
                    this.handleLineClear(data);
                }
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive) {
                const settings = typeof window !== 'undefined' ? window.settings : null;
                if (settings?.backgroundComboEffects !== false) {
                    this.handleCombo(data);
                }
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive) {
                const settings = typeof window !== 'undefined' ? window.settings : null;
                if (settings?.backgroundComboEffects !== false) {
                    this.handlePieceLock();
                }
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    handleLineClear(data) {
        const lineCount = data.lineCount || 1;
        
        // Pulse the waves
        this.wavePulseTarget = Math.min(0.7, this.wavePulseTarget + 0.2);

        // Add light beams for multi-line clears
        if (lineCount >= 2 && this.lightBeams.length < this.activePreset.maxLightBeams) {
            for (let i = 0; i < Math.min(lineCount - 1, 2); i++) {
                this.lightBeams.push({
                    x: 0.2 + Math.random() * 0.6,
                    y: 0,
                    speed: 0.001,
                    width: 0.03 + Math.random() * 0.02,
                    hue: Math.random() * 360,
                    life: 1,
                    maxLife: 1,
                });
            }
        }

        // Add aurora streaks for Tetris
        if (lineCount >= 4 && this.auroraStreaks.length < this.activePreset.maxAuroraStreaks) {
            for (let i = 0; i < 2; i++) {
                this.auroraStreaks.push({
                    y: 0.15 + Math.random() * 0.2,
                    height: 0.05 + Math.random() * 0.03,
                    hue: Math.random() * 360,
                    phase: Math.random() * Math.PI * 2,
                    life: 1,
                    maxLife: 1,
                });
            }
        }
    }

    handleCombo(data) {
        const comboCount = data.comboCount || 1;
        const intensity = Math.min(1, comboCount / 10);

        // Wave effects
        this.wavePulseTarget = Math.min(0.7, 0.25 + intensity * 0.45);
        this.amplitudeBoostTarget = Math.min(0.6, 0.18 + intensity * 0.42);
        this.colorSpeedTarget = Math.min(0.6, 0.22 + intensity * 0.38);

        // Shockwaves
        const baseShockwaves = Math.min(this.activePreset.maxShockwaves, 1 + Math.floor(comboCount / 3));
        for (let i = 0; i < baseShockwaves; i++) {
            const xPos = 0.25 + (i / baseShockwaves) * 0.5;
            const wavePoint = this.getWaveSurfacePoint(xPos, 2 + i);

            this.shockwaves.push({
                x: wavePoint.x,
                y: wavePoint.y,
                radius: 25,
                speed: 3.5 + i * 0.6,
                startHue: (i * 110) % 360,
                life: 1,
                maxLife: 1,
            });
        }

        // Particles from waves
        const particlesPerWave = Math.min(
            this.activePreset.particlesPerWave,
            this.activePreset.particlesPerWave * 0.6 + comboCount * 0.6,
        );
        const numWaveLayers = 3;

        for (let layer = 0; layer < numWaveLayers; layer++) {
            const waveLayer = 1 + layer;

            for (let i = 0; i < particlesPerWave; i++) {
                const xPos = 0.15 + Math.random() * 0.7;
                const surfacePoint = this.getWaveSurfacePoint(xPos, waveLayer);

                const angle = this.random(-Math.PI * 0.75, -Math.PI * 0.25);
                const speed = this.random(0.003, 0.009) * (1 + intensity * 0.6);
                const vx = Math.cos(angle) * speed;
                const vy = Math.sin(angle) * speed;

                const effectiveSpeed = 0.0007 * (1 + this.colorSpeedBoost * 0.6);
                const time = (this.animationTime + this.timeOffset) * effectiveSpeed;
                const colorPhase = (time * 70 + xPos * 130 + layer * 90) % 360;
                const startHue = colorPhase;
                const hueCycleSpeed = this.random(45, 110) * (1 + intensity);

                this.comboParticles.push({
                    x: surfacePoint.x,
                    y: surfacePoint.y,
                    vx,
                    vy,
                    size: this.random(2.8, 5.5) * (1 + intensity * 0.35),
                    hue: startHue,
                    hueCycleSpeed,
                    life: 2.2,
                    baseAlpha: 0.92,
                });
            }
        }

        // Light beams for high combos
        if (comboCount >= 5 && this.lightBeams.length < this.activePreset.maxLightBeams) {
            this.lightBeams.push({
                x: 0.3 + Math.random() * 0.4,
                y: 0,
                speed: 0.001,
                width: 0.04 + Math.random() * 0.03,
                hue: Math.random() * 360,
                life: 1,
                maxLife: 1,
            });
        }

        // Aurora for very high combos
        if (comboCount >= 7 && this.auroraStreaks.length < this.activePreset.maxAuroraStreaks) {
            this.auroraStreaks.push({
                y: 0.1 + Math.random() * 0.25,
                height: 0.04 + Math.random() * 0.04,
                hue: Math.random() * 360,
                phase: Math.random() * Math.PI * 2,
                life: 1,
                maxLife: 1,
            });
        }

        // Limit particles
        if (this.comboParticles.length > this.activePreset.maxComboParticles) {
            this.comboParticles = this.comboParticles.slice(-this.activePreset.maxComboParticles);
        }
    }

    handlePieceLock() {
        if (!this.activePreset.enableLockEffects) return;

        // Subtle wave pulse
        this.wavePulseTarget = Math.min(this.wavePulseTarget + 0.08, 0.3);

        // Create lock ripples
        const rippleCount = this.activePreset.lockRippleCount;
        for (let i = 0; i < rippleCount; i++) {
            if (this.lockRipples.length >= this.activePreset.lockRippleCount * 2) break;
            
            // Spawn ripples at random positions near waves
            const xPos = 0.2 + Math.random() * 0.6;
            const wavePoint = this.getWaveSurfacePoint(xPos, 2);
            
            this.lockRipples.push({
                x: wavePoint.x,
                y: wavePoint.y,
                radius: 8,
                speed: 2 + Math.random(),
                hue: Math.random() * 360,
                life: 1,
            });
        }

        // Create lock sparkles
        const sparkleCount = this.activePreset.lockSparkleCount;
        for (let i = 0; i < sparkleCount; i++) {
            if (this.lockSparkles.length >= this.activePreset.lockSparkleCount * 3) break;
            
            const xPos = 0.15 + Math.random() * 0.7;
            const wavePoint = this.getWaveSurfacePoint(xPos, 1 + Math.floor(Math.random() * 3));
            
            const angle = this.random(-Math.PI * 0.8, -Math.PI * 0.2);
            const speed = this.random(0.002, 0.005);
            
            this.lockSparkles.push({
                x: wavePoint.x,
                y: wavePoint.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: this.random(2, 4),
                hue: Math.random() * 360,
                life: 1,
            });
        }
    }

    animate() {
        if (!this.isActive) return;

        this.animationTime += 16;
        this.frameCounter++;

        this.drawRainbowWaves();
        this.drawSparkles();

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    random(min, max) {
        return min + Math.random() * (max - min);
    }

    resize(width, height) {
        this.resizeWaves();
        this.resizeSparkles();
    }

    stop() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        this.waveCanvas = null;
        this.waveCtx = null;
        this.sparkleCanvas = null;
        this.sparkleCtx = null;
        this.sparkles = [];
        this.stars = [];
        this.comboParticles = [];
        this.shockwaves = [];
        this.lightBeams = [];
        this.auroraStreaks = [];
        this.lockRipples = [];
        this.lockSparkles = [];

        super.stop();
    }

    getTetrominoConfig() {
        return CHROMADELIC_HIGHWAY_TETROMINOS;
    }
}
