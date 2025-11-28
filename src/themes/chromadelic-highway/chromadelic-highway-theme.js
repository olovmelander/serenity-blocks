import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CHROMADELIC_HIGHWAY_TETROMINOS } from './chromadelic-highway-tetrominos.js';

export default class ChromadelicHighwayTheme extends BaseTheme {
    constructor() {
        super('chromadelic-highway');
        this.animationTime = 0;
        this.eventUnsubscribers = [];

        // Smooth easing for combo effects - current values
        this.wavePulseIntensity = 0;
        this.waveAmplitudeBoost = 0;
        this.colorSpeedBoost = 0;

        // Smooth easing - target values (lerp towards these)
        this.wavePulseTarget = 0;
        this.amplitudeBoostTarget = 0;
        this.colorSpeedTarget = 0;

        this.sparkles = [];
        this.maxSparkles = 60; // Will be set by quality preset
        this.stars = [];
        this.maxStars = 40; // Will be set by quality preset
        this.comboParticles = []; // Burst particles from combos
        this.shockwaves = []; // Rainbow shockwave rings

        // Canvas references
        this.waveCanvas = null;
        this.waveCtx = null;
        this.sparkleCanvas = null;
        this.sparkleCtx = null;

        // Performance: Cache gradient for waves
        this.cachedWaveGradient = null;
        this.cachedGradientWidth = 0;

        // Random time offset for varied starting positions
        this.timeOffset = Math.random() * 10000;

        // Graphics quality presets - optimized for better performance
        this.qualityPresets = {
            Minimal: {
                maxSparkles: 20,
                maxStars: 12,
                waveLayers: 2,
                waveStep: 15,
                maxShockwaves: 1,
                maxComboParticles: 10,
                particlesPerWave: 3,
                trailSegments: 1,
                shadowBlur: 0.3,
                glowLayers: false,
                waveGlowIntensity: 0.4,
            },
            Low: {
                maxSparkles: 20,
                maxStars: 15,
                waveLayers: 3,
                waveStep: 15,
                maxShockwaves: 1,
                maxComboParticles: 10,
                particlesPerWave: 3,
                trailSegments: 0,
                shadowBlur: 0,
                glowLayers: false,
                waveGlowIntensity: 0.4,
                skipFrames: 2, // Render every 3rd frame
                useSimpleGlow: true,
            },
            Medium: {
                maxSparkles: 30,
                maxStars: 20,
                waveLayers: 3,
                waveStep: 12,
                maxShockwaves: 2,
                maxComboParticles: 18,
                particlesPerWave: 5,
                trailSegments: 1,
                shadowBlur: 0,
                glowLayers: true,
                waveGlowIntensity: 0.6,
                skipFrames: 1, // Render every 2nd frame
                useSimpleGlow: true,
            },
            High: {
                maxSparkles: 40,
                maxStars: 25,
                waveLayers: 4,
                waveStep: 10,
                maxShockwaves: 2,
                maxComboParticles: 25,
                particlesPerWave: 6,
                trailSegments: 2,
                shadowBlur: 0,
                glowLayers: true,
                waveGlowIntensity: 0.8,
                skipFrames: 0, // Render every frame
                useSimpleGlow: true,
            },
            Ultra: {
                maxSparkles: 60,
                maxStars: 35,
                waveLayers: 5,
                waveStep: 8,
                maxShockwaves: 3,
                maxComboParticles: 35,
                particlesPerWave: 8,
                trailSegments: 3,
                shadowBlur: 0.3,
                glowLayers: true,
                waveGlowIntensity: 1.0,
                skipFrames: 0, // Render every frame
                useSimpleGlow: false,
            },
            Extreme: {
                maxSparkles: 90,
                maxStars: 50,
                waveLayers: 7,
                waveStep: 6,
                maxShockwaves: 5,
                maxComboParticles: 50,
                particlesPerWave: 12,
                trailSegments: 5,
                shadowBlur: 0.5,
                glowLayers: true,
                waveGlowIntensity: 1.3,
                skipFrames: 0, // Render every frame
                useSimpleGlow: false,
            },
        };

        this.currentQuality = 'Medium'; // Default to Medium for better performance
        this.activePreset = this.qualityPresets.Medium;
        this.frameCounter = 0;
    }

    /**
     * Apply graphics quality preset
     * @param {string} quality - Quality level: 'Low', 'Medium', 'High', or 'Ultra'
     */
    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`Unknown quality preset: ${quality}, using High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        // Update max limits based on preset
        this.maxSparkles = this.activePreset.maxSparkles;
        this.maxStars = this.activePreset.maxStars;

        console.log(`🌈 Chromadelic Highway: Applying ${quality} quality preset`);
    }

    /**
     * Get current graphics quality from settings
     * @returns {string} Quality level
     */
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    /**
     * Setup listener for graphics quality changes
     */
    setupQualityListener() {
        const qualityChangeHandler = () => {
            if (!this.isActive) return;

            const newQuality = this.getGraphicsQuality();
            if (newQuality !== this.currentQuality) {
                console.log(`🌈 Chromadelic Highway: Quality changed from ${this.currentQuality} to ${newQuality}`);
                this.applyQualityPreset(newQuality);

                // Reinitialize particles with new quality settings
                this.initSparkles();
                this.initStars();
            }
        };

        window.addEventListener('settingsChanged', qualityChangeHandler);

        // Store reference to remove later
        this.qualityChangeHandler = qualityChangeHandler;
    }

    async createScene() {
        // Apply graphics quality preset from settings
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);
        console.log(`🌈 Chromadelic Highway: Using ${quality} quality preset`);

        const container = this.getContainer('chromadelic-highway-theme');

        // Create background gradient (handled by CSS)
        const background = this.getContainer('chromadelic-highway-background');

        // Create flowing rainbow waves
        this.createRainbowWaves();

        // Create subtle sparkles
        this.createSparkles();

        // Setup event listeners for combo effects
        this.setupEventListeners();

        // Setup quality change listener
        this.setupQualityListener();

        // Initialize sparkle and star positions
        this.initSparkles();
        this.initStars();

        // Start animation loop
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

        // PERFORMANCE: Cap DPR at 1.5 for better performance on high-DPI displays
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

        // Frame skipping for performance
        if (this.frameCounter % (this.activePreset.skipFrames + 1) !== 0) {
            return;
        }

        const ctx = this.waveCtx;
        const width = this.waveWidth;
        const height = this.waveHeight;

        ctx.clearRect(0, 0, width, height);

        // Smooth rainbow color stops for gradient
        const rainbowStops = [
            { pos: 0.0, color: [255, 0, 100] }, // Pink-Red
            { pos: 0.15, color: [255, 100, 0] }, // Orange
            { pos: 0.3, color: [255, 200, 0] }, // Yellow
            { pos: 0.45, color: [0, 255, 150] }, // Green-Cyan
            { pos: 0.6, color: [0, 150, 255] }, // Cyan-Blue
            { pos: 0.75, color: [150, 50, 255] }, // Purple
            { pos: 0.9, color: [255, 0, 200] }, // Magenta
            { pos: 1.0, color: [255, 0, 100] }, // Back to Pink-Red (seamless loop)
        ];

        // Apply color speed boost for combo effects (speeds up rainbow cycling)
        const effectiveSpeed = 0.0006 * (1 + this.colorSpeedBoost * 0.5);
        const time = (this.animationTime + this.timeOffset) * effectiveSpeed;

        // Number of wave layers for depth (controlled by quality preset)
        const numLayers = this.activePreset.waveLayers;

        // Draw waves from back to front
        for (let layer = 0; layer < numLayers; layer++) {
            const layerDepth = layer / numLayers;

            // Layer-specific properties
            const layerSpeed = 0.4 + layerDepth * 0.7; // More movement variation
            const layerHeight = height * (0.15 + layerDepth * 0.3);
            const layerY = height * 0.3 + layerDepth * height * 0.35;
            const layerAlpha = 0.25 + layerDepth * 0.35; // More vibrant/opaque

            // Wave parameters with amplitude boost from combos
            const baseAmplitude = 50 + layerDepth * 70;
            const amplitude = baseAmplitude * (1 + this.waveAmplitudeBoost * 0.8); // Surge on combos!
            const frequency = 0.003 - layerDepth * 0.0008; // Wave frequency
            const phaseOffset = time * layerSpeed + layer * 0.8;

            // Breathing/pulsing effect - more pronounced
            const breathe = Math.sin(time * 2 + layer * 0.5) * 0.22 + 1;
            const pulseEffect = 1 + this.wavePulseIntensity * 0.4;

            // Draw wave path

            // Create gradient along the wave - only when needed
            const gradient = ctx.createLinearGradient(0, 0, width, 0);

            // Color offset for gradient rotation - faster color cycling
            const colorOffset = (time * 1.2 + layer * 0.3) % 1;

            // Add color stops
            for (let i = 0; i < rainbowStops.length; i++) {
                const stop = rainbowStops[i];
                const pos = (stop.pos + colorOffset) % 1;

                const [r, g, b] = stop.color;
                const alpha = layerAlpha * breathe * pulseEffect;

                gradient.addColorStop(pos, `rgba(${r}, ${g}, ${b}, ${alpha})`);
            }

            ctx.fillStyle = gradient;

            // Shadow blur disabled for performance - use alternative glow method
            if (this.activePreset.shadowBlur > 0) {
                const baseGlowIntensity = 30 + layerDepth * 50;
                const glowIntensity = baseGlowIntensity * this.activePreset.waveGlowIntensity;
                ctx.shadowBlur = glowIntensity * this.activePreset.shadowBlur;

                const glowHue = (time * 60 + layer * 50) % 360;
                ctx.shadowColor = `hsla(${glowHue}, 100%, 70%, ${layerAlpha * 1.2})`;
            }

            // Draw the wave shape
            ctx.beginPath();

            // Start from left edge, below the wave
            ctx.moveTo(0, height);

            // Draw bottom edge
            ctx.lineTo(0, layerY + layerHeight);

            // Wave detail controlled by quality preset (step size in pixels)
            // Draw wavy top edge
            for (let x = 0; x <= width; x += this.activePreset.waveStep) {
                const waveOffset = Math.sin(x * frequency + phaseOffset) * amplitude * breathe * pulseEffect;
                const waveY = layerY + waveOffset;

                ctx.lineTo(x, waveY);
            }

            // Close the path
            ctx.lineTo(width, layerY + layerHeight);
            ctx.lineTo(width, height);
            ctx.closePath();

            ctx.fill();

            // Reset shadow blur if it was set
            if (this.activePreset.shadowBlur > 0) {
                ctx.shadowBlur = 0;
            }
        }

        // Smooth easing for all combo effects - gentle, organic transitions
        const lerpFactor = 0.08; // Smooth interpolation speed (0.08 = gentle)

        // Smoothly lerp current values towards their targets
        this.wavePulseIntensity += (this.wavePulseTarget - this.wavePulseIntensity) * lerpFactor;
        this.waveAmplitudeBoost += (this.amplitudeBoostTarget - this.waveAmplitudeBoost) * lerpFactor;
        this.colorSpeedBoost += (this.colorSpeedTarget - this.colorSpeedBoost) * lerpFactor;

        // Smoothly decay targets back to 0 (natural fade-out)
        this.wavePulseTarget *= 0.97;
        this.amplitudeBoostTarget *= 0.97;
        this.colorSpeedTarget *= 0.97;

        // Clamp to 0 when very close
        if (Math.abs(this.wavePulseIntensity) < 0.001) this.wavePulseIntensity = 0;
        if (Math.abs(this.waveAmplitudeBoost) < 0.001) this.waveAmplitudeBoost = 0;
        if (Math.abs(this.colorSpeedBoost) < 0.001) this.colorSpeedBoost = 0;
        if (Math.abs(this.wavePulseTarget) < 0.001) this.wavePulseTarget = 0;
        if (Math.abs(this.amplitudeBoostTarget) < 0.001) this.amplitudeBoostTarget = 0;
        if (Math.abs(this.colorSpeedTarget) < 0.001) this.colorSpeedTarget = 0;
    }

    /**
     * Calculate wave surface positions at a given x coordinate
     * Used to spawn particles from the actual wave surface
     */
    getWaveSurfacePoint(xPercent, layerIndex = 2) {
        if (!this.waveWidth || !this.waveHeight) return { x: 0.5, y: 0.6 };

        const effectiveSpeed = 0.0006 * (1 + this.colorSpeedBoost * 0.5);
        const time = (this.animationTime + this.timeOffset) * effectiveSpeed;

        const numLayers = this.activePreset.waveLayers;
        const layerDepth = layerIndex / numLayers;
        const layerSpeed = 0.4 + layerDepth * 0.7;
        const layerY = this.waveHeight * (0.3 + layerDepth * 0.35);

        const baseAmplitude = 50 + layerDepth * 70;
        const amplitude = baseAmplitude * (1 + this.waveAmplitudeBoost * 0.8);
        const frequency = 0.003 - layerDepth * 0.0008;
        const phaseOffset = time * layerSpeed + layerIndex * 0.8;

        const breathe = Math.sin(time * 2 + layerIndex * 0.5) * 0.22 + 1;
        const pulseEffect = 1 + this.wavePulseIntensity * 0.4;

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

        // PERFORMANCE: Cap DPR at 1.5 for better performance on high-DPI displays
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

        // Rainbow color spectrum positions (evenly distributed)
        const rainbowHues = [
            0, // Red
            30, // Orange
            60, // Yellow
            120, // Green
            180, // Cyan
            240, // Blue
            280, // Purple
            320, // Magenta
        ];

        for (let i = 0; i < this.maxSparkles; i++) {
            // Create variety - some small stars, some medium, some larger particles
            const type = Math.random();
            let size; let speedY; let speedX; let twinkleSpeed; let
                glowSize;

            if (type < 0.5) {
                // Tiny distant rainbow sparkles (50% of particles)
                size = this.random(0.5, 1.2);
                speedY = this.random(0.00005, 0.0001);
                speedX = this.random(-0.00002, 0.00002);
                twinkleSpeed = this.random(0.002, 0.006); // Much slower twinkle
                glowSize = this.random(3, 6);
            } else if (type < 0.8) {
                // Medium rainbow sparkles (30% of particles)
                size = this.random(1.2, 2.5);
                speedY = this.random(0.0001, 0.0003);
                speedX = this.random(-0.00005, 0.00005);
                twinkleSpeed = this.random(0.004, 0.01); // Slower twinkle
                glowSize = this.random(6, 10);
            } else {
                // Larger glowing rainbow particles (20% of particles)
                size = this.random(2.5, 4);
                speedY = this.random(0.0002, 0.0005);
                speedX = this.random(-0.0001, 0.0001);
                twinkleSpeed = this.random(0.008, 0.018); // Slower twinkle
                glowSize = this.random(10, 16);
            }

            // Assign a base rainbow color from the spectrum
            const rainbowIndex = Math.floor(Math.random() * rainbowHues.length);
            const baseHue = rainbowHues[rainbowIndex];

            // Some particles spawn more near the wave region (bottom 70% of screen)
            const yPosition = Math.random() < 0.7 ? this.random(0.4, 1) : Math.random();

            this.sparkles.push({
                x: Math.random(),
                y: yPosition,
                size,
                speedY,
                speedX,
                phase: Math.random() * Math.PI * 2,
                twinkleSpeed,
                baseHue, // Base rainbow color
                hueOffset: this.random(-15, 15), // Slight variation
                colorCycleSpeed: this.random(0.3, 1.5), // How fast color shifts
                glowSize,
                baseAlpha: this.random(0.3, 0.8), // Varied base brightness
            });
        }
    }

    initStars() {
        this.stars = [];
        for (let i = 0; i < this.maxStars; i++) {
            this.stars.push({
                x: Math.random(),
                y: Math.random() * 0.4, // Only top 40% of screen
                size: this.random(0.6, 1.8),
                phase: Math.random() * Math.PI * 2,
                twinkleSpeed: this.random(0.001, 0.004), // Very slow twinkle for stars
                brightness: this.random(0.4, 0.9),
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

        // Batch rendering without individual save/restore for performance
        this.sparkles.forEach((sparkle) => {
            // Update sparkle position (drift with both vertical and horizontal movement)
            sparkle.y += sparkle.speedY;
            sparkle.x += sparkle.speedX;

            // Wrap around edges
            if (sparkle.y > 1) {
                sparkle.y = Math.random() < 0.7 ? this.random(0.4, 1) : 0;
                sparkle.x = Math.random();
            }
            if (sparkle.x < 0) sparkle.x = 1;
            if (sparkle.x > 1) sparkle.x = 0;

            // Screen position
            const x = sparkle.x * width;
            const y = sparkle.y * height;

            // Calculate rainbow hue that cycles with time, synced with waves
            // This makes the sparkles feel like they're part of the rainbow flow
            const timeFactor = time * 0.0006; // Same speed as wave animation
            const colorCycle = (timeFactor * sparkle.colorCycleSpeed * 60) % 360;
            const hue = (sparkle.baseHue + sparkle.hueOffset + colorCycle) % 360;

            // Twinkle effect with varied speeds
            const twinkle = (Math.sin(time * sparkle.twinkleSpeed + sparkle.phase) + 1) / 2;
            const alpha = sparkle.baseAlpha * (0.3 + twinkle * 0.7);
            const size = sparkle.size * (0.85 + twinkle * 0.15);

            // Enhanced rainbow saturation and lightness
            const saturation = 95 + twinkle * 5;
            const lightness = 65 + twinkle * 20;

            // PERFORMANCE: Use simple layered circles - no save/restore needed
            // Outer glow layers (only if quality allows)
            if (this.activePreset.glowLayers && sparkle.size > 2) {
                const outerHue = (hue + 20) % 360;

                // Outermost glow
                ctx.globalAlpha = alpha * 0.15;
                ctx.fillStyle = `hsla(${outerHue}, 100%, 70%, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
                ctx.fill();

                // Mid glow
                ctx.globalAlpha = alpha * 0.3;
                ctx.fillStyle = `hsla(${outerHue}, 100%, 70%, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, size * 1.8, 0, Math.PI * 2);
                ctx.fill();
            }

            // Main sparkle - no shadow blur for performance
            ctx.globalAlpha = alpha;
            ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, 1)`;

            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();

            // Reset alpha
            ctx.globalAlpha = 1;
        });

        // Draw stars at the top - no shadow blur for performance
        this.stars.forEach((star) => {
            const x = star.x * width;
            const y = star.y * height;

            // Very slow twinkle
            const twinkle = (Math.sin(time * star.twinkleSpeed + star.phase) + 1) / 2;
            const alpha = star.brightness * (0.5 + twinkle * 0.5);
            const size = star.size * (0.9 + twinkle * 0.1);

            // Outer glow (simple method)
            ctx.globalAlpha = alpha * 0.3;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x, y, size * 2, 0, Math.PI * 2);
            ctx.fill();

            // Main star
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1;
        });

        // Draw rainbow shockwave rings - optimized rendering
        this.shockwaves = this.shockwaves.filter((wave) => {
            wave.radius += wave.speed;
            wave.life -= 0.008;

            if (wave.life <= 0) return false;

            const centerX = wave.x * width;
            const centerY = wave.y * height;
            const lifeFactor = wave.life / wave.maxLife;

            // Draw expanding rainbow ring with simple method (no gradient for performance)
            const hueOffset = wave.startHue + (1 - lifeFactor) * 60;

            // Draw multiple concentric circles for gradient effect (faster than radial gradient)
            const numRings = 3;
            for (let i = 0; i < numRings; i++) {
                const ringFactor = i / numRings;
                const ringRadius = wave.radius + (i - numRings / 2) * 15;
                const ringAlpha = lifeFactor * 0.6 * (1 - ringFactor * 0.5);
                const ringHue = (hueOffset + i * 30) % 360;

                ctx.globalAlpha = ringAlpha;
                ctx.strokeStyle = `hsla(${ringHue}, 100%, 70%, 1)`;
                ctx.lineWidth = 25 * lifeFactor;

                ctx.beginPath();
                ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.globalAlpha = 1;

            return true;
        });

        // Draw combo burst particles with trails - integrated with waves!
        this.comboParticles = this.comboParticles.filter((particle) => {
            // Store previous position for trail
            const prevX = particle.x;
            const prevY = particle.y;

            // Update particle physics with wave influence
            particle.x += particle.vx;
            particle.y += particle.vy;

            // Gentle wave-like motion (particles flow with waves)
            const waveInfluence = Math.sin(this.animationTime * 0.003 + particle.x * 10) * 0.0003;
            particle.x += waveInfluence;

            particle.vy += 0.00015; // Gentle gravity
            particle.life -= 0.01; // Slower decay for more visible trails

            // Update particle hue to cycle through rainbow spectrum!
            particle.hue = (particle.hue + particle.hueCycleSpeed * 0.016) % 360;

            if (particle.life <= 0) return false; // Remove dead particles

            const x = particle.x * width;
            const y = particle.y * height;
            const prevScreenX = prevX * width;
            const prevScreenY = prevY * height;

            // Normalize life for smoother fade (0-1)
            const lifeFactor = Math.min(1, particle.life / 2.0);
            const alpha = lifeFactor ** 0.6 * particle.baseAlpha;
            const size = particle.size * (0.6 + lifeFactor * 0.4);

            // Trail segments controlled by quality preset - optimized
            if (particle.life < 2.0 && this.activePreset.trailSegments > 0) {
                const trailLength = this.activePreset.trailSegments;
                for (let t = 0; t < trailLength; t++) {
                    const trailFactor = t / trailLength;
                    const trailX = prevScreenX + (x - prevScreenX) * trailFactor;
                    const trailY = prevScreenY + (y - prevScreenY) * trailFactor;
                    const trailAlpha = alpha * (1 - trailFactor) * 0.3;
                    const trailSize = size * (0.8 - trailFactor * 0.3);
                    const trailHue = (particle.hue - trailFactor * 30) % 360;

                    ctx.globalAlpha = trailAlpha;
                    ctx.fillStyle = `hsla(${trailHue}, 100%, 70%, 1)`;

                    ctx.beginPath();
                    ctx.arc(trailX, trailY, trailSize, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Layered glow effect (only if quality allows) - simplified
            if (this.activePreset.glowLayers) {
                const outerHue = (particle.hue + 180) % 360;

                // Outermost glow
                ctx.globalAlpha = alpha * 0.2;
                ctx.fillStyle = `hsla(${outerHue}, 100%, 70%, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, size * 2.2, 0, Math.PI * 2);
                ctx.fill();

                // Mid glow
                ctx.globalAlpha = alpha * 0.35;
                ctx.fillStyle = `hsla(${outerHue}, 100%, 75%, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, size * 1.6, 0, Math.PI * 2);
                ctx.fill();
            }

            // Main particle - no shadow blur for performance
            ctx.globalAlpha = alpha;
            ctx.fillStyle = `hsla(${particle.hue}, 100%, ${75 + lifeFactor * 10}%, 1)`;

            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1;

            return true; // Keep particle alive
        });
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) {
                const settings = window.app?.settingsManager?.getSettings();
                // Default to true if setting not found
                if (settings?.backgroundComboEffects !== false) {
                    this.handleLineClear(data);
                }
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive) {
                const settings = window.app?.settingsManager?.getSettings();
                // Default to true if setting not found
                if (settings?.backgroundComboEffects !== false) {
                    this.handleCombo(data);
                }
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    handleLineClear() {
        // Gentle pulse the waves - smoothly add to target instead of instant
        this.wavePulseTarget = Math.min(0.6, this.wavePulseTarget + 0.15);
    }

    handleCombo(data) {
        const comboCount = data.comboCount || 1;
        const intensity = Math.min(1, comboCount / 10); // 0 to 1 based on combo

        // SMOOTHLY TRIGGER INTEGRATED EFFECTS - set targets, not instant values
        // Values will smoothly lerp towards these targets for organic feel

        // 1. Wave intensity pulse (reduced from 0.4-1.0 to 0.2-0.6 for subtlety)
        this.wavePulseTarget = Math.min(0.6, 0.2 + intensity * 0.4);

        // 2. Wave amplitude surge (reduced from 0.3-1.0 to 0.15-0.5 for subtlety)
        this.amplitudeBoostTarget = Math.min(0.5, 0.15 + intensity * 0.35);

        // 3. Rainbow color cycling (reduced from 0.4-1.0 to 0.2-0.5 for subtlety)
        this.colorSpeedTarget = Math.min(0.5, 0.2 + intensity * 0.3);

        // 4. Create rainbow shockwave rings (limited by quality preset)
        const baseShockwaves = Math.min(this.activePreset.maxShockwaves, 1 + Math.floor(comboCount / 3));
        const numShockwaves = Math.min(baseShockwaves, this.activePreset.maxShockwaves);
        for (let i = 0; i < numShockwaves; i++) {
            // Spawn shockwaves from different positions along the waves
            const xPos = 0.3 + (i / numShockwaves) * 0.4;
            const wavePoint = this.getWaveSurfacePoint(xPos, 2 + i);

            this.shockwaves.push({
                x: wavePoint.x,
                y: wavePoint.y,
                radius: 20,
                speed: 3 + i * 0.5,
                startHue: (i * 120) % 360, // Different rainbow colors
                life: 1,
                maxLife: 1,
            });
        }

        // 5. Spawn particles FROM the actual wave surfaces (integrated!)
        // Particle count controlled by quality preset
        const particlesPerWave = Math.min(
            this.activePreset.particlesPerWave,
            this.activePreset.particlesPerWave * 0.6 + comboCount * 0.5,
        );
        const numWaveLayers = 3; // Spawn from multiple wave layers

        for (let layer = 0; layer < numWaveLayers; layer++) {
            const waveLayer = 1 + layer; // Use layers 1, 2, 3

            for (let i = 0; i < particlesPerWave; i++) {
                // Distribute particles across the wave
                const xPos = 0.2 + Math.random() * 0.6;
                const surfacePoint = this.getWaveSurfacePoint(xPos, waveLayer);

                // Particles burst upward and outward from wave surface
                const angle = this.random(-Math.PI * 0.7, -Math.PI * 0.3); // Upward arc
                const speed = this.random(0.003, 0.008) * (1 + intensity * 0.5);
                const vx = Math.cos(angle) * speed;
                const vy = Math.sin(angle) * speed;

                // Rainbow color synchronized with current wave color at spawn position
                const effectiveSpeed = 0.0006 * (1 + this.colorSpeedBoost * 0.5);
                const time = (this.animationTime + this.timeOffset) * effectiveSpeed;
                const colorPhase = (time * 60 + xPos * 120 + layer * 80) % 360;
                const startHue = colorPhase;

                // Faster color cycling for higher combos
                const hueCycleSpeed = this.random(40, 100) * (1 + intensity);

                this.comboParticles.push({
                    x: surfacePoint.x,
                    y: surfacePoint.y,
                    vx,
                    vy,
                    size: this.random(2.5, 5) * (1 + intensity * 0.3),
                    hue: startHue,
                    hueCycleSpeed,
                    life: 2.0, // Longer life for better trails
                    baseAlpha: 0.9,
                });
            }
        }

        // Limit total combo particles by quality preset
        if (this.comboParticles.length > this.activePreset.maxComboParticles) {
            this.comboParticles = this.comboParticles.slice(-this.activePreset.maxComboParticles);
        }
    }

    animate() {
        if (!this.isActive) return;

        this.animationTime += 16; // Approximately 60fps
        this.frameCounter++;

        // Draw all layers
        this.drawRainbowWaves();
        this.drawSparkles();

        // Continue animation loop
        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    update(deltaTime) {
        // Optional: Additional per-frame updates can go here
    }

    resize(width, height) {
        this.resizeWaves();
        this.resizeSparkles();
    }

    stop() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Remove quality change listener
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        // Clear references
        this.waveCanvas = null;
        this.waveCtx = null;
        this.sparkleCanvas = null;
        this.sparkleCtx = null;
        this.sparkles = [];
        this.stars = [];
        this.comboParticles = [];
        this.shockwaves = [];

        super.stop();
    }

    /**
     * Get custom tetromino configuration for Chromadelic Highway theme
     * @returns {Object} Tetromino configuration with vibrant rainbow colors
     */
    getTetrominoConfig() {
        return CHROMADELIC_HIGHWAY_TETROMINOS;
    }
}
