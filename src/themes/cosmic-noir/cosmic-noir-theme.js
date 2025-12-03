import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { COSMIC_NOIR_TETROMINOS } from './cosmic-noir-tetrominos.js';
import WebGLCosmicRenderer from './webgl-cosmic-renderer.js';

export default class CosmicNoirTheme extends BaseTheme {
    constructor() {
        super('cosmic-noir');
        this.eventUnsubscribers = [];
        this.stars = [];
        this.galaxyParticles = [];
        this.dustParticles = [];
        this.animationFrame = null;
        this.canvas = null;
        this.ctx = null;

        // Galaxy center position (the "planet" / "black hole")
        this.galaxyCenterX = 0;
        this.galaxyCenterY = 0;

        // Drifting Black Moon properties
        this.moonBaseX = 0;
        this.moonBaseY = 0;
        this.moonOffsetX = 0;
        this.moonOffsetY = 0;
        this.moonRadius = 90; // Default from CSS (180px / 2)

        // Lissajous phase for drift
        this.moonPhaseX = Math.random() * Math.PI * 2;
        this.moonPhaseY = Math.random() * Math.PI * 2;
        this.moonPhaseX2 = Math.random() * Math.PI * 2;
        this.moonPhaseY2 = Math.random() * Math.PI * 2;

        // DOM Element for the planet
        this.planetElement = null;

        // Combo effect timeout tracker
        this.intensifyTimeout = null;

        // Performance optimization
        this.lastFrameTime = 0;
        this.targetFrameTime = 1000 / 60; // 60 FPS
        this.colorCache = new Map();
        this.time = 0;

        // WebGL Renderer
        this.cosmicCanvas = null;
        this.cosmicRenderer = null;
        this.useWebGL = true;

        // Quality preset state
        this.starsContainer = null;
        this.waveContainer = null;
        this.qualityChangeHandler = null;
        this.qualityPresets = {
            Minimal: {
                starCount: 1000,
                galaxyParticles: 200,
                dustParticles: 40,
                maxWaveBursts: 1,
            },
            Low: {
                starCount: 2000,
                galaxyParticles: 400,
                dustParticles: 60,
                maxWaveBursts: 1,
            },
            Medium: {
                starCount: 4000,
                galaxyParticles: 800,
                dustParticles: 80,
                maxWaveBursts: 2,
            },
            High: {
                starCount: 8000,
                galaxyParticles: 1500,
                dustParticles: 110,
                maxWaveBursts: 3,
            },
            Ultra: {
                starCount: 15000,
                galaxyParticles: 2500,
                dustParticles: 150,
                maxWaveBursts: 4,
            },
            Extreme: {
                starCount: 25000,
                galaxyParticles: 4000,
                dustParticles: 200,
                maxWaveBursts: 6,
            },
        };
        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets.High;
        this.maxWaveBursts = this.activePreset.maxWaveBursts;
    }

    applyQualityPreset(quality, { skipRefresh = false } = {}) {
        if (!this.qualityPresets[quality]) {
            console.warn(`Cosmic Noir: Unknown quality preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        this.maxWaveBursts = this.activePreset.maxWaveBursts;

        if (!skipRefresh) {
            this.refreshQualityDependentElements();
        }

        console.log(`🌌 Cosmic Noir: Applying ${quality} quality preset`);
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
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
        this.createStars(true);
        this.generateGalaxyParticles();

        if (this.useWebGL && this.cosmicRenderer) {
            // Re-allocate for both stars and galaxy particles
            const totalParticles = this.activePreset.starCount + this.activePreset.galaxyParticles;
            this.cosmicRenderer.allocateParticles(totalParticles);
            this.uploadParticlesToWebGL();
        }

        if (this.canvas && this.ctx) {
            this.generateDustParticles();
        }
    }

    /**
     * Initialize WebGL renderer
     */
    initWebGLRenderer() {
        if (!this.canvas) return;

        try {
            this.cosmicCanvas = document.createElement('canvas');
            this.cosmicCanvas.width = this.canvas.width;
            this.cosmicCanvas.height = this.canvas.height;
            // Insert before the main canvas to act as background
            this.canvas.parentNode.insertBefore(this.cosmicCanvas, this.canvas);
            this.cosmicCanvas.style.position = 'absolute';
            this.cosmicCanvas.style.top = '0';
            this.cosmicCanvas.style.left = '0';
            this.cosmicCanvas.style.width = '100%';
            this.cosmicCanvas.style.height = '100%';
            this.cosmicCanvas.style.zIndex = '-1'; // Behind the main canvas

            this.cosmicRenderer = new WebGLCosmicRenderer(this.cosmicCanvas);

            if (this.cosmicRenderer.init()) {
                const totalParticles = this.activePreset.starCount + this.activePreset.galaxyParticles;
                this.cosmicRenderer.allocateParticles(totalParticles);
                this.useWebGL = true;
                console.log('🌌 Cosmic Noir: WebGL renderer active');
            } else {
                this.useWebGL = false;
                this.cosmicRenderer = null;
                if (this.cosmicCanvas.parentNode) {
                    this.cosmicCanvas.parentNode.removeChild(this.cosmicCanvas);
                }
                this.cosmicCanvas = null;
                console.log('🌌 Cosmic Noir: Falling back to Canvas2D');
            }
        } catch (e) {
            console.warn('🌌 Cosmic Noir: WebGL init failed:', e);
            this.useWebGL = false;
        }
    }

    uploadParticlesToWebGL() {
        if (!this.useWebGL || !this.cosmicRenderer) return;

        const allParticles = [];

        // 1. Stars (Background)
        // Convert relative coordinates to pixel coordinates for WebGL
        const pixelStars = this.stars.map(star => ({
            ...star,
            x: star.x * this.canvas.width,
            y: star.y * this.canvas.height,
            pulseBoost: 0,
            type: 0 // Star
        }));
        allParticles.push(...pixelStars);

        // 2. Galaxy Particles (Orbiting)
        // These are already generated with radius/angle in generateGalaxyParticles
        // We pass them as is, the shader handles the orbit
        // We need to ensure x = radius, y = angle for the shader
        const galaxyParticles = this.galaxyParticles.map(p => ({
            x: p.distance, // Radius
            y: p.angle,    // Angle offset
            size: p.size,
            color: `rgba(${p.brightness}, ${p.brightness}, ${p.brightness}, ${p.opacity})`,
            brightness: 1.0,
            pulseBoost: 0,
            type: 1 // Galaxy Particle
        }));
        allParticles.push(...galaxyParticles);

        this.cosmicRenderer.uploadParticles(allParticles);
    }

    async createScene() {
        console.log('[Cosmic Noir] Creating scene...');

        try {
            const quality = this.getGraphicsQuality();
            this.applyQualityPreset(quality, { skipRefresh: true });

            // Get DOM elements
            this.planetElement = document.querySelector('.cosmic-noir-planet');
            if (this.planetElement) {
                // Stop CSS animation so we can control it via JS
                this.planetElement.style.animation = 'none';
            } else {
                console.warn('[Cosmic Noir] Planet element not found!');
            }

            // Create galaxy canvas (foreground elements - now just dust)
            this.createGalaxyCanvas();

            // Initialize WebGL (background stars + galaxy particles)
            this.initWebGLRenderer();

            // Create particles
            this.createStars(true);
            this.generateGalaxyParticles();
            this.uploadParticlesToWebGL();

            // Setup listener for runtime graphics changes
            this.setupQualityListener();

            // Setup event listeners for reactive effects
            this.setupEventListeners();

            // Initial resize to set moon position
            this.resizeCanvas();
            window.addEventListener('resize', () => this.resizeCanvas());

            console.log('[Cosmic Noir] Scene created successfully!');
        } catch (error) {
            console.error('[Cosmic Noir] Error in createScene():', error);
            throw error;
        }
    }

    resizeCanvas() {
        if (!this.canvas) return;

        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        if (this.cosmicCanvas) {
            this.cosmicCanvas.width = window.innerWidth;
            this.cosmicCanvas.height = window.innerHeight;
            if (this.cosmicRenderer) {
                this.cosmicRenderer.resize(window.innerWidth, window.innerHeight);
                this.uploadParticlesToWebGL();
            }
        }

        // Calculate base position of the planet (right: 15%, top: 25%)
        this.moonBaseX = this.canvas.width * 0.85;
        this.moonBaseY = this.canvas.height * 0.25;

        // Update galaxy center
        this.updateGalaxyCenter();
    }

    updateGalaxyCenter() {
        const centerX = (this.canvas.width * 0.85) - 90;
        const centerY = (this.canvas.height * 0.25) + 90;

        this.galaxyCenterX = centerX + this.moonOffsetX;
        this.galaxyCenterY = centerY + this.moonOffsetY;
    }

    /**
     * Create background stars
     */
    createStars(force = false) {
        this.stars = [];
        const starCount = this.activePreset?.starCount ?? 2000;

        // Grayscale palette - pure monochrome
        const starColors = [
            'rgba(255, 255, 255, 1)', // Bright white
            'rgba(230, 230, 230, 1)', // Light gray
            'rgba(200, 200, 200, 1)', // Medium gray
            'rgba(180, 180, 180, 1)', // Gray
            'rgba(160, 160, 160, 1)', // Darker gray
        ];

        for (let i = 0; i < starCount; i++) {
            const size = this.random(0.5, 2.5);
            const isBright = Math.random() < 0.2;

            this.stars.push({
                x: Math.random(), // Relative 0-1
                y: Math.random(), // Relative 0-1
                size: size,
                color: starColors[Math.floor(Math.random() * starColors.length)],
                brightness: this.random(0.3, 0.95),
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: Math.random() * 0.02 + 0.005,
                isBright: isBright
            });
        }

        // Clear old DOM stars
        const oldStarsContainer = document.getElementById('cosmic-noir-stars');
        if (oldStarsContainer) {
            oldStarsContainer.innerHTML = '';
        }
    }

    /**
     * Create galaxy dust and particle canvas
     */
    createGalaxyCanvas() {
        this.canvas = document.getElementById('cosmic-noir-galaxy-canvas');
        if (!this.canvas) {
            console.warn('[Cosmic Noir] Galaxy canvas not found!');
            return;
        }

        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        this.ctx = this.canvas.getContext('2d', {
            alpha: true,
            desynchronized: true,
        });

        this.generateDustParticles();

        // Start animation
        this.animateGalaxy();
    }

    generateGalaxyParticles() {
        this.galaxyParticles = [];
        const count = this.activePreset?.galaxyParticles ?? 200;

        for (let i = 0; i < count; i++) {
            const angle = this.random(0, Math.PI * 2);
            // Distribute particles around the black hole
            // Closer particles are denser
            const distance = this.random(100, 500);
            const brightness = Math.floor(this.random(120, 255));

            this.galaxyParticles.push({
                angle,
                distance,
                // Slightly smaller particles as requested
                size: this.random(0.5, 2.0),
                opacity: this.random(0.2, 0.7),
                brightness,
                // These properties are now handled by shader or unused
                driftSpeed: 0,
                orbitSpeed: 0,
                pulse: 0,
                pulseSpeed: 0,
            });
        }
    }

    generateDustParticles() {
        this.dustParticles = [];
        const count = this.activePreset?.dustParticles ?? 100;
        for (let i = 0; i < count; i++) {
            this.dustParticles.push({
                x: this.random(0, this.canvas?.width || window.innerWidth),
                y: this.random(0, this.canvas?.height || window.innerHeight),
                vx: this.random(-0.3, 0.3),
                vy: this.random(-0.3, 0.3),
                size: this.random(0.5, 1.5),
                opacity: this.random(0.15, 0.4),
                brightness: Math.floor(this.random(150, 220)),
            });
        }
    }

    /**
     * Animate galaxy drift and dust particles - OPTIMIZED
     */
    animateGalaxy() {
        if (!this.isActive) return;

        const now = performance.now();
        const deltaTime = now - this.lastFrameTime;

        if (deltaTime < this.targetFrameTime) {
            this.animationFrame = requestAnimationFrame(() => this.animateGalaxy());
            return;
        }

        this.lastFrameTime = now - (deltaTime % this.targetFrameTime);
        this.time += 0.016; // Approx 60fps increment

        // Update Moon/Planet Drift - SLOWER
        const time = Date.now() * 0.000005; // Even slower drift
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Lissajous figure for organic drift
        // Amplitude: 15% of screen width/height
        const driftAmpX = w * 0.15;
        const driftAmpY = h * 0.15;

        const targetOffsetX = Math.sin(time * 2 + this.moonPhaseX) * Math.cos(time * 1.5 + this.moonPhaseX2) * driftAmpX;
        const targetOffsetY = Math.cos(time * 2.5 + this.moonPhaseY) * Math.sin(time * 1.2 + this.moonPhaseY2) * driftAmpY;

        // Smooth interpolation
        this.moonOffsetX += (targetOffsetX - this.moonOffsetX) * 0.02;
        this.moonOffsetY += (targetOffsetY - this.moonOffsetY) * 0.02;

        // Update DOM element position
        if (this.planetElement) {
            this.planetElement.style.transform = `translate(${this.moonOffsetX}px, ${this.moonOffsetY}px)`;
        }

        // Update Galaxy Center (Absolute position for Canvas/WebGL)
        this.updateGalaxyCenter();

        // Render WebGL Stars & Galaxy Particles
        if (this.useWebGL && this.cosmicRenderer) {
            this.cosmicRenderer.render(
                this.time,
                0, // Global pulse
                { x: this.galaxyCenterX, y: this.galaxyCenterY },
                this.moonRadius // Use ~90px radius for event horizon
            );
        }

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw dust/grain particles (Foreground)
        for (let i = 0; i < this.dustParticles.length; i++) {
            const dust = this.dustParticles[i];

            // Drift motion
            dust.x += dust.vx;
            dust.y += dust.vy;

            // Wrap around edges
            if (dust.x < 0) dust.x = this.canvas.width;
            if (dust.x > this.canvas.width) dust.x = 0;
            if (dust.y < 0) dust.y = this.canvas.height;
            if (dust.y > this.canvas.height) dust.y = 0;

            // Draw small grain
            this.ctx.fillStyle = `rgba(${dust.brightness}, ${dust.brightness}, ${dust.brightness}, ${dust.opacity})`;
            this.ctx.fillRect(dust.x, dust.y, dust.size, dust.size);
        }

        // Note: Galaxy particles are now rendered via WebGL

        this.animationFrame = requestAnimationFrame(() => this.animateGalaxy());
    }

    /**
     * Setup event listeners for reactive effects
     */
    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    /**
     * React to line clears
     */
    onLineClear(lineCount) {
        console.log('[Cosmic Noir] Line clear:', lineCount);
        this.brightenStars(lineCount);
        this.createGalaxyPulse(lineCount);
        this.intensifyDrift(lineCount);
    }

    /**
     * React to combos
     */
    onCombo(comboCount) {
        console.log('[Cosmic Noir] Combo:', comboCount);
        this.intensifyGalaxy(comboCount);

        if (comboCount >= 3) {
            this.createGalaxyWave(comboCount);
        }
    }

    /**
     * React to piece locks
     */
    onPieceLock(piece) {
        if (Math.random() < 0.25) {
            this.subtleGalaxyPulse();
        }
    }

    /**
     * Brighten stars on line clear
     */
    brightenStars(intensity) {
        // Placeholder for WebGL uniform update if needed
    }

    /**
     * Create galaxy pulse effect
     */
    createGalaxyPulse(intensity) {
        const pulseContainer = document.getElementById('cosmic-noir-pulses');
        if (!pulseContainer) return;

        const pulse = document.createElement('div');
        pulse.className = 'cosmic-noir-pulse';
        pulse.style.setProperty('--pulse-intensity', intensity);

        // Position pulse at the current galaxy center
        pulse.style.left = `${this.galaxyCenterX}px`;
        pulse.style.top = `${this.galaxyCenterY}px`;

        pulseContainer.appendChild(pulse);

        setTimeout(() => {
            if (pulse.parentNode) {
                pulse.parentNode.removeChild(pulse);
            }
        }, 2000);
    }

    /**
     * Intensify particle drift
     */
    intensifyDrift(intensity) {
        // Now handled by shader if we want, or just visual effects
    }

    /**
     * Intensify galaxy brightness
     */
    intensifyGalaxy(comboCount) {
        const theme = document.getElementById('cosmic-noir-theme');
        if (!theme) {
            return;
        }

        if (this.intensifyTimeout) {
            clearTimeout(this.intensifyTimeout);
        }

        theme.style.transition = 'none';

        const brightness = 100 + Math.min(comboCount * 15, 80);
        const contrast = 100 + Math.min(comboCount * 12, 70);
        theme.style.filter = `brightness(${brightness}%) contrast(${contrast}%)`;

        const duration = 2000 + (comboCount * 200);
        this.intensifyTimeout = setTimeout(() => {
            theme.style.transition = 'filter 0.8s ease-out';
            theme.style.filter = 'brightness(100%) contrast(100%)';

            setTimeout(() => {
                theme.style.transition = '';
                theme.style.filter = '';
            }, 800);

            this.intensifyTimeout = null;
        }, duration);
    }

    /**
     * Create galaxy wave effect
     */
    createGalaxyWave(comboCount) {
        if (!this.waveContainer) {
            this.waveContainer = document.getElementById('cosmic-noir-waves');
        }
        const { waveContainer } = this;
        if (!waveContainer) return;

        // Use current galaxy center
        const planetCenterX = this.galaxyCenterX;
        const planetCenterY = this.galaxyCenterY;

        const containerCenterX = window.innerWidth / 2;
        const containerCenterY = window.innerHeight / 2;

        const offsetX = planetCenterX - containerCenterX;
        const offsetY = planetCenterY - containerCenterY;

        const burstCount = Math.min(comboCount - 2, this.maxWaveBursts);
        for (let i = 0; i < burstCount; i++) {
            if (waveContainer.children.length >= this.maxWaveBursts) break;
            setTimeout(() => {
                const wave = document.createElement('div');
                wave.className = 'cosmic-noir-wave';

                wave.style.left = `${offsetX}px`;
                wave.style.top = `${offsetY}px`;

                waveContainer.appendChild(wave);

                setTimeout(() => {
                    if (wave.parentNode) {
                        wave.parentNode.removeChild(wave);
                    }
                }, 2500);
            }, i * 400);
        }
    }

    /**
     * Subtle galaxy pulse on piece lock
     */
    subtleGalaxyPulse() {
        // Handled by shader global pulse if connected
    }

    stop() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        // Reset planet animation
        if (this.planetElement) {
            this.planetElement.style.animation = '';
            this.planetElement.style.transform = '';
        }

        // Cancel animation frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Clear any pending intensify timeout
        if (this.intensifyTimeout) {
            clearTimeout(this.intensifyTimeout);
            this.intensifyTimeout = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Clear particles
        this.galaxyParticles = [];
        this.dustParticles = [];
        this.stars = [];

        // Clear canvas references
        this.canvas = null;
        this.ctx = null;

        // Clean up WebGL
        if (this.cosmicRenderer) {
            this.cosmicRenderer.destroy();
            this.cosmicRenderer = null;
        }
        if (this.cosmicCanvas && this.cosmicCanvas.parentNode) {
            this.cosmicCanvas.parentNode.removeChild(this.cosmicCanvas);
        }
        this.cosmicCanvas = null;

        // Clear color cache
        this.colorCache.clear();

        // Reset performance tracking
        this.lastFrameTime = 0;

        // Clear any active effects
        const theme = document.getElementById('cosmic-noir-theme');
        if (theme) {
            theme.style.filter = '';
        }

        super.stop();
    }

    /**
     * Provide Cosmic Noir themed tetromino styling (monochrome glow)
     * @returns {Object} Cosmic Noir tetromino configuration
     */
    getTetrominoConfig() {
        return COSMIC_NOIR_TETROMINOS;
    }
}
