import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CHROMADELIC_HIGHWAY_TETROMINOS } from './chromadelic-highway-tetrominos.js';
import WebGLChromadelicRenderer from './webgl-chromadelic-renderer.js';

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
        this.canvas = null;
        this.renderer = null;

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

        // Create single WebGL canvas
        if (container) {
            this.canvas = document.createElement('canvas');
            this.canvas.className = 'chromadelic-webgl-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.zIndex = '1'; // Behind UI but visible
            container.appendChild(this.canvas);

            this.renderer = new WebGLChromadelicRenderer(this.canvas);
            if (!this.renderer.init()) {
                console.error('Failed to init WebGL renderer for Chromadelic Highway');
                this.renderer = null;
                return; // Abort if renderer fails
            }

            this.resize();
            window.addEventListener('resize', () => this.resize());
        }

        this.setupEventListeners();
        this.setupQualityListener();
        this.initSparkles();
        this.initStars();

        this.animate();
    }

    resize() {
        if (!this.renderer || !this.canvas) return;

        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        const rect = this.canvas.getBoundingClientRect();

        this.renderer.resize(rect.width * dpr, rect.height * dpr);

        this.waveWidth = rect.width;
        this.waveHeight = rect.height;
    }





    getWaveSurfacePoint(xPercent, layerIndex = 2) {
        if (!this.waveWidth || !this.waveHeight) return { x: 0.5, y: 0.6 };

        const effectiveSpeed = 0.00002 * (1 + this.colorSpeedBoost * 0.6);
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

    hslToRgb(h, s, l) {
        s /= 100;
        l /= 100;
        const k = n => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return [f(0), f(8), f(4)];
    }

    animate() {
        if (!this.isActive || !this.renderer) return;

        this.animationTime += 16;
        this.frameCounter++;

        // Smooth easing
        const lerpFactor = 0.08;
        this.wavePulseIntensity += (this.wavePulseTarget - this.wavePulseIntensity) * lerpFactor;
        this.waveAmplitudeBoost += (this.amplitudeBoostTarget - this.waveAmplitudeBoost) * lerpFactor;
        this.colorSpeedBoost += (this.colorSpeedTarget - this.colorSpeedBoost) * lerpFactor;

        this.wavePulseTarget *= 0.96;
        this.amplitudeBoostTarget *= 0.96;
        this.colorSpeedTarget *= 0.96;

        const time = this.animationTime + this.timeOffset;
        const particles = [];

        // Update and collect Sparkles
        this.sparkles.forEach((sparkle) => {
            sparkle.y += sparkle.speedY;
            sparkle.x += sparkle.speedX;

            if (sparkle.y > 1) {
                sparkle.y = Math.random() < 0.7 ? this.random(0.4, 1) : 0;
                sparkle.x = Math.random();
            }
            if (sparkle.x < 0) sparkle.x = 1;
            if (sparkle.x > 1) sparkle.x = 0;

            const timeFactor = time * 0.0007;
            const colorCycle = (timeFactor * sparkle.colorCycleSpeed * 70) % 360;
            const hue = (sparkle.baseHue + sparkle.hueOffset + colorCycle) % 360;

            const twinkle = (Math.sin(time * sparkle.twinkleSpeed + sparkle.phase) + 1) / 2;
            const alpha = sparkle.baseAlpha * (0.35 + twinkle * 0.65);
            const size = sparkle.size * (0.85 + twinkle * 0.15) * 2.0; // Scale up for WebGL

            const saturation = 95 + twinkle * 5;
            const lightness = 65 + twinkle * 20;

            particles.push({
                x: sparkle.x,
                y: sparkle.y,
                size: size,
                color: this.hslToRgb(hue, saturation, lightness),
                alpha: alpha
            });
        });

        // Update and collect Stars
        this.stars.forEach((star) => {
            const twinkle = (Math.sin(time * star.twinkleSpeed + star.phase) + 1) / 2;
            const alpha = star.brightness * (0.5 + twinkle * 0.5);
            const size = star.size * (0.9 + twinkle * 0.1) * 1.5;

            const hue = star.isColored ? (star.hue + time * 0.01) % 360 : 0;
            const saturation = star.isColored ? 80 : 0;
            const lightness = star.isColored ? 80 : 100;

            particles.push({
                x: star.x,
                y: star.y,
                size: size,
                color: this.hslToRgb(hue, saturation, lightness),
                alpha: alpha
            });
        });

        // Update and collect Combo Particles
        this.comboParticles = this.comboParticles.filter((particle) => {
            particle.x += particle.vx;
            particle.y += particle.vy;

            const waveInfluence = Math.sin(this.animationTime * 0.003 + particle.x * 10) * 0.0004;
            particle.x += waveInfluence;

            particle.vy += 0.00012;
            particle.life -= 0.009;
            particle.hue = (particle.hue + particle.hueCycleSpeed * 0.018) % 360;

            if (particle.life <= 0) return false;

            const lifeFactor = Math.min(1, particle.life / 2.0);
            const alpha = lifeFactor ** 0.55 * particle.baseAlpha;
            const size = particle.size * (0.55 + lifeFactor * 0.45) * 2.0;

            particles.push({
                x: particle.x,
                y: particle.y,
                size: size,
                color: this.hslToRgb(particle.hue, 100, 78 + lifeFactor * 12),
                alpha: alpha
            });

            return true;
        });

        // Update and collect Lock Sparkles
        this.lockSparkles = this.lockSparkles.filter((sparkle) => {
            sparkle.x += sparkle.vx;
            sparkle.y += sparkle.vy;
            sparkle.vy += 0.0002; // Gravity
            sparkle.life -= 0.02;
            sparkle.hue = (sparkle.hue + 2) % 360;

            if (sparkle.life <= 0) return false;

            const lifeFactor = sparkle.life;
            const size = Math.max(0.5, sparkle.size * lifeFactor) * 2.5;

            particles.push({
                x: sparkle.x,
                y: sparkle.y,
                size: size,
                color: this.hslToRgb(sparkle.hue, 100, 85),
                alpha: lifeFactor
            });

            return true;
        });

        // Render
        this.renderer.render(time * 0.001, {
            amplitude: 50.0 + this.waveAmplitudeBoost * 50.0,
            frequency: 0.002,
            speed: 0.005 + this.colorSpeedBoost,
            pulseIntensity: this.wavePulseIntensity,
            particles: particles
        });

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
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
        if (!this.isActive || !this.renderer) return;

        this.animationTime += 16;
        this.frameCounter++;

        // Smooth easing
        const lerpFactor = 0.08;
        this.wavePulseIntensity += (this.wavePulseTarget - this.wavePulseIntensity) * lerpFactor;
        this.waveAmplitudeBoost += (this.amplitudeBoostTarget - this.waveAmplitudeBoost) * lerpFactor;
        this.colorSpeedBoost += (this.colorSpeedTarget - this.colorSpeedBoost) * lerpFactor;

        this.wavePulseTarget *= 0.96;
        this.amplitudeBoostTarget *= 0.96;
        this.colorSpeedTarget *= 0.96;

        const time = this.animationTime + this.timeOffset;
        const particles = [];

        // Update and collect Sparkles
        this.sparkles.forEach((sparkle) => {
            sparkle.y += sparkle.speedY;
            sparkle.x += sparkle.speedX;

            if (sparkle.y > 1) {
                sparkle.y = Math.random() < 0.7 ? this.random(0.4, 1) : 0;
                sparkle.x = Math.random();
            }
            if (sparkle.x < 0) sparkle.x = 1;
            if (sparkle.x > 1) sparkle.x = 0;

            const timeFactor = time * 0.0007;
            const colorCycle = (timeFactor * sparkle.colorCycleSpeed * 70) % 360;
            const hue = (sparkle.baseHue + sparkle.hueOffset + colorCycle) % 360;

            const twinkle = (Math.sin(time * sparkle.twinkleSpeed + sparkle.phase) + 1) / 2;
            const alpha = sparkle.baseAlpha * (0.35 + twinkle * 0.65);
            const size = sparkle.size * (0.85 + twinkle * 0.15) * 2.0;

            const saturation = 95 + twinkle * 5;
            const lightness = 65 + twinkle * 20;

            particles.push({
                x: sparkle.x,
                y: 1.0 - sparkle.y,
                size: size,
                color: this.hslToRgb(hue, saturation, lightness),
                alpha: alpha,
                type: 0
            });
        });

        // Update and collect Stars
        this.stars.forEach((star) => {
            const twinkle = (Math.sin(time * star.twinkleSpeed + star.phase) + 1) / 2;
            const alpha = star.brightness * (0.5 + twinkle * 0.5);
            const size = star.size * (0.9 + twinkle * 0.1) * 1.5;

            const hue = star.isColored ? (star.hue + time * 0.01) % 360 : 0;
            const saturation = star.isColored ? 80 : 0;
            const lightness = star.isColored ? 80 : 100;

            particles.push({
                x: star.x,
                y: 1.0 - star.y,
                size: size,
                color: this.hslToRgb(hue, saturation, lightness),
                alpha: alpha,
                type: 0
            });
        });

        // Update and collect Combo Particles
        this.comboParticles = this.comboParticles.filter((particle) => {
            particle.x += particle.vx;
            particle.y += particle.vy;

            const waveInfluence = Math.sin(this.animationTime * 0.003 + particle.x * 10) * 0.0004;
            particle.x += waveInfluence;

            particle.vy += 0.00012;
            particle.life -= 0.009;
            particle.hue = (particle.hue + particle.hueCycleSpeed * 0.018) % 360;

            if (particle.life <= 0) return false;

            const lifeFactor = Math.min(1, particle.life / 2.0);
            const alpha = lifeFactor ** 0.55 * particle.baseAlpha;
            const size = particle.size * (0.55 + lifeFactor * 0.45) * 2.0;

            particles.push({
                x: particle.x,
                y: 1.0 - particle.y,
                size: size,
                color: this.hslToRgb(particle.hue, 100, 78 + lifeFactor * 12),
                alpha: alpha,
                type: 0
            });

            return true;
        });

        // Update and collect Lock Sparkles
        this.lockSparkles = this.lockSparkles.filter((sparkle) => {
            sparkle.x += sparkle.vx;
            sparkle.y += sparkle.vy;
            sparkle.vy += 0.0002;
            sparkle.life -= 0.02;
            sparkle.hue = (sparkle.hue + 2) % 360;

            if (sparkle.life <= 0) return false;

            const lifeFactor = sparkle.life;
            const size = Math.max(0.5, sparkle.size * lifeFactor) * 2.5;

            particles.push({
                x: sparkle.x,
                y: 1.0 - sparkle.y,
                size: size,
                color: this.hslToRgb(sparkle.hue, 100, 85),
                alpha: lifeFactor,
                type: 0
            });

            return true;
        });

        // Update and collect Shockwaves
        this.shockwaves = this.shockwaves.filter((wave) => {
            wave.radius += wave.speed;
            wave.life -= 0.007;

            if (wave.life <= 0) return false;

            const lifeFactor = wave.life / wave.maxLife;
            const hueOffset = wave.startHue + (1 - lifeFactor) * 70;

            for (let i = 0; i < 3; i++) {
                const ringRadius = Math.max(1, wave.radius + (i - 1.5) * 18);
                const ringAlpha = lifeFactor * 0.55;
                const ringHue = (hueOffset + i * 35) % 360;

                particles.push({
                    x: wave.x,
                    y: 1.0 - wave.y,
                    size: ringRadius * 2.5,
                    color: this.hslToRgb(ringHue, 100, 72),
                    alpha: ringAlpha,
                    type: 1 // Ring
                });
            }

            return true;
        });

        // Update and collect Light Beams
        this.lightBeams = this.lightBeams.filter((beam) => {
            beam.life -= 0.006;
            beam.y += beam.speed;

            if (beam.life <= 0) return false;

            const lifeFactor = beam.life / beam.maxLife;
            const hue = (beam.hue + (1 - lifeFactor) * 40) % 360;

            particles.push({
                x: beam.x,
                y: 0.5,
                size: beam.width * 100,
                color: this.hslToRgb(hue, 100, 75),
                alpha: lifeFactor * 0.25,
                type: 2 // Beam
            });

            return true;
        });

        // Update and collect Lock Ripples
        this.lockRipples = this.lockRipples.filter((ripple) => {
            ripple.radius += ripple.speed;
            ripple.life -= 0.025;

            if (ripple.life <= 0) return false;

            const lifeFactor = ripple.life;

            for (let i = 0; i < 2; i++) {
                const ringRadius = Math.max(1, ripple.radius + i * 12);
                const ringAlpha = lifeFactor * 0.4;
                const hue = (ripple.hue + i * 30) % 360;

                particles.push({
                    x: ripple.x,
                    y: 1.0 - ripple.y,
                    size: ringRadius * 2.0,
                    color: this.hslToRgb(hue, 100, 75),
                    alpha: ringAlpha,
                    type: 1 // Ring
                });
            }

            return true;
        });

        // Render
        this.renderer.render(time * 0.001, {
            amplitude: 50.0 + this.waveAmplitudeBoost * 50.0,
            frequency: 0.002,
            speed: 1.0 + this.colorSpeedBoost,
            pulseIntensity: this.wavePulseIntensity,
            particles: particles
        });

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    random(min, max) {
        return min + Math.random() * (max - min);
    }

    resize(width, height) {
        if (!this.renderer || !this.canvas) return;

        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        const rect = this.canvas.getBoundingClientRect();

        // Fallback if rect is 0 (e.g. hidden)
        const w = rect.width || window.innerWidth;
        const h = rect.height || window.innerHeight;

        this.renderer.resize(w * dpr, h * dpr);

        this.waveWidth = w;
        this.waveHeight = h;
    }

    stop() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;

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
