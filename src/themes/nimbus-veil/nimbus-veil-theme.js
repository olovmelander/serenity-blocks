import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { NIMBUS_VEIL_TETROMINOS } from './nimbus-veil-tetrominos.js';

/**
 * Nimbus Veil Theme
 *
 * A serene, atmospheric theme featuring ethereal white clouds drifting across
 * a dark, transparent sky. Inspired by isolated cloud formations suspended in
 * a mysterious void.
 *
 * Visual elements:
 * - Multiple cloud layers with different drift speeds (parallax effect)
 * - Soft, wispy cloud particles on canvas
 * - Gentle pulsing glow on game events
 * - Subtle mist/fog overlay for depth
 */
export default class NimbusVeilTheme extends BaseTheme {
    constructor() {
        super('nimbus-veil');

        // Animation state
        this.lastFrameTime = 0;
        this.targetFrameTime = 1000 / 60; // 60 FPS for smooth animation
        this.animationFrame = null;
        this.elapsedTime = 0; // Accumulated time instead of Date.now()

        // Cloud particles
        this.cloudParticles = [];
        this.mistParticles = [];
        this.movingParticles = []; // Small moving particles
        this.lightningFlashes = []; // Lightning flash effects
        this.comboRings = []; // Expanding rings for combo effects
        this.sparkles = []; // Sparkle particles for combos

        // Canvas elements
        this.canvas = null;
        this.ctx = null;

        // Performance optimizations
        this.colorCache = new Map();
        this.offscreenCanvas = null; // For pre-rendering clouds
        this.offscreenCtx = null;
        this.mistCanvas = null; // Separate canvas for mist (pre-rendered once)
        this.mistCtx = null;
        this.needsRedraw = true; // Flag to track if clouds need re-rendering
        this.frameSkip = 0; // Skip frames for performance
        this.updateCounter = 0; // Counter for selective updates
        this.cachedSinCos = { sin: 0, cos: 0 }; // Cache trig values

        // Layer caching for performance
        this.cloudLayerCanvas = null;
        this.cloudLayerCtx = null;
        this.mistLayerCanvas = null;
        this.mistLayerCtx = null;
        this.layersNeedUpdate = true;

        // Cache frequently used values
        this.cachedWidth = 0;
        this.cachedHeight = 0;
        this.cachedWindX = 0;
        this.cachedWindY = 0;

        // Ambient effects
        this.windIntensity = 0.5; // 0-1 scale
        this.windDirection = 0; // Radians
        this.windChangeTimer = 0;

        // Event state
        this.eventUnsubscribers = [];

        // Combo/effect limits
        this.MAX_COMBO_RINGS = 6;
        this.MAX_SPARKLES = 50;
        this.MAX_LIGHTNING_FLASHES = 3;
        this.lightningChance = 0.0005;

        // Graphics quality presets
        this.qualityChangeHandler = null;
        this.qualityPresets = {
            'Low': {
                cloudParticles: 3,
                mistParticles: 2,
                movingParticles: 6,
                maxComboRings: 4,
                maxSparkles: 25,
                maxLightning: 1,
                lightningChance: 0.0002,
            },
            'Medium': {
                cloudParticles: 4,
                mistParticles: 3,
                movingParticles: 8,
                maxComboRings: 5,
                maxSparkles: 40,
                maxLightning: 2,
                lightningChance: 0.00035,
            },
            'High': {
                cloudParticles: 5,
                mistParticles: 4,
                movingParticles: 12,
                maxComboRings: 6,
                maxSparkles: 50,
                maxLightning: 3,
                lightningChance: 0.0005,
            },
            'Ultra': {
                cloudParticles: 6,
                mistParticles: 5,
                movingParticles: 16,
                maxComboRings: 8,
                maxSparkles: 70,
                maxLightning: 4,
                lightningChance: 0.0008,
            }
        };

        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets['High'];
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`Nimbus Veil: Unknown quality preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        const preset = this.activePreset;
        this.MAX_COMBO_RINGS = preset.maxComboRings;
        this.MAX_SPARKLES = preset.maxSparkles;
        this.MAX_LIGHTNING_FLASHES = preset.maxLightning;
        this.lightningChance = preset.lightningChance;

        this.trimEffectCollections();

        console.log(`☁️ Nimbus Veil: Applying ${quality} quality preset`);
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
            this.refreshQualityDependentElements();
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    refreshQualityDependentElements() {
        this.createCloudParticles(true);
        this.createMistParticles(true);
        this.trimEffectCollections();
        this.forceLayerPrerender();
    }

    trimEffectCollections() {
        this.trimCollection(this.comboRings, this.MAX_COMBO_RINGS);
        this.trimCollection(this.sparkles, this.MAX_SPARKLES);
        this.trimCollection(this.lightningFlashes, this.MAX_LIGHTNING_FLASHES);
    }

    trimCollection(collection, limit) {
        if (!collection || typeof limit !== 'number') return;
        if (limit <= 0) {
            collection.length = 0;
            return;
        }
        if (collection.length > limit) {
            collection.splice(0, collection.length - limit);
        }
    }

    forceLayerPrerender() {
        if (this.mistLayerCtx && this.mistLayerCanvas) {
            this.prerenderMistLayer();
        }
        if (this.cloudLayerCtx && this.cloudLayerCanvas) {
            this.prerenderCloudLayer();
        }
    }

    /**
     * Cloud colors - soft whites and light grays
     */
    getCloudColors() {
        return [
            'rgba(255, 255, 255, 0.9)',   // Pure white
            'rgba(245, 245, 250, 0.85)',  // Slight blue-white
            'rgba(240, 240, 245, 0.8)',   // Light gray-white
            'rgba(235, 235, 240, 0.75)',  // Softer white
            'rgba(230, 230, 235, 0.7)',   // Dim white
        ];
    }

    /**
     * Initialize the theme
     * Note: super.start() already calls createScene(), so we don't call it again
     */
    async start(webglRenderer, resources) {
        await super.start(webglRenderer, resources);

        // Start animation after scene is created
        this.startAnimation();
    }

    /**
     * Create the cloud scene
     */
    async createScene() {
        console.log('[Nimbus Veil] Creating scene...');

        try {
            const quality = this.getGraphicsQuality();
            this.applyQualityPreset(quality);

            // Create floating cloud particles
            this.createCloudParticles(true);

            // Create mist overlay
            this.createMistParticles(true);

            // Setup canvas for particle effects
            this.createCloudCanvas();
            this.forceLayerPrerender();

            // Setup event listeners for reactive effects
            this.setupEventListeners();
            this.setupQualityListener();

            console.log('[Nimbus Veil] Scene created successfully!');
            console.log(`[Nimbus Veil] Performance mode: ${this.cloudParticles.length} clouds, ${this.mistParticles.length} mist, ${this.movingParticles.length} particles`);
        } catch (error) {
            console.error('[Nimbus Veil] Error in createScene():', error);
            throw error;
        }
    }

    /**
     * Create background cloud particles
     */
    createCloudParticles(force = false) {
        const colors = this.getCloudColors();

        if (force) {
            this.cloudParticles = [];
        }

        const targetCount = this.activePreset?.cloudParticles ?? 4;
        this.cloudParticles = [];

        // Create cloud particles - large, dynamic, visually stunning (heavily optimized)
        for (let i = 0; i < targetCount; i++) {
            const baseSize = Math.random() * 140 + 70; // Larger clouds to compensate (70-210px)
            this.cloudParticles.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                size: baseSize,
                baseSize: baseSize, // Store original size
                targetSize: baseSize, // Target size for morphing
                opacity: Math.random() * 0.45 + 0.3, // 0.3-0.75 (very visible)
                color: colors[Math.floor(Math.random() * colors.length)],
                speedX: Math.random() * 0.6 + 0.2, // Faster, more dynamic horizontal drift
                speedY: (Math.random() - 0.5) * 0.25, // More vertical drift
                blur: Math.random() * 35 + 25, // 25-60px blur
                pulseSpeed: Math.random() * 0.025 + 0.015, // Faster pulsing
                pulseOffset: Math.random() * Math.PI * 2,
                swayAmplitude: Math.random() * 0.35 + 0.2, // Much more sway
                swaySpeed: Math.random() * 0.02 + 0.015 // Faster sway
                // REMOVED morphing for performance - clouds stay constant size
            });
        }
    }

    /**
     * Create mist/fog particles for depth
     */
    createMistParticles(force = false) {
        if (force) {
            this.mistParticles = [];
            this.movingParticles = [];
        }

        const mistCount = this.activePreset?.mistParticles ?? 3;
        const movingCount = this.activePreset?.movingParticles ?? 10;

        this.mistParticles = [];
        // Create 3 larger mist particles for enhanced background depth (heavily optimized)
        for (let i = 0; i < mistCount; i++) {
            const baseSize = Math.random() * 250 + 150; // Bigger mist to compensate (150-400px)
            this.mistParticles.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                size: baseSize,
                baseSize: baseSize,
                targetSize: baseSize,
                opacity: Math.random() * 0.15 + 0.06, // 0.06-0.21 (more visible)
                speedX: Math.random() * 0.35 + 0.15, // Faster horizontal drift
                speedY: (Math.random() - 0.5) * 0.15, // More vertical drift
                blur: Math.random() * 65 + 55, // 55-120px heavy blur
                pulseSpeed: Math.random() * 0.02 + 0.01, // Faster pulsing
                pulseOffset: Math.random() * Math.PI * 2,
                swayAmplitude: Math.random() * 0.25 + 0.12, // More sway
                swaySpeed: Math.random() * 0.015 + 0.008 // Faster sway
                // REMOVED morphing for performance - mist stays constant size
            });
        }

        this.movingParticles = [];
        // Create 10 small moving particles (heavily optimized for max performance)
        for (let i = 0; i < movingCount; i++) {
            this.movingParticles.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                size: Math.random() * 2 + 0.5, // 0.5-2.5px tiny particles
                opacity: Math.random() * 0.6 + 0.3, // 0.3-0.9
                speedX: (Math.random() - 0.5) * 1.5, // Faster movement in both directions
                speedY: (Math.random() - 0.5) * 1.5,
                twinkleSpeed: Math.random() * 0.03 + 0.01,
                twinkleOffset: Math.random() * Math.PI * 2
            });
        }
    }

    /**
     * Setup HTML5 canvas for cloud rendering
     */
    createCloudCanvas() {
        this.canvas = document.getElementById('nimbus-veil-cloud-canvas');
        if (!this.canvas) {
            console.warn('[Nimbus Veil] Cloud canvas not found!');
            return;
        }

        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        this.ctx = this.canvas.getContext('2d', {
            alpha: true,
            desynchronized: true, // Performance optimization
            willReadFrequently: false
        });

        // Create offscreen canvases for layer caching (MASSIVE performance boost)
        this.createLayerCanvases();

        console.log('[Nimbus Veil] Canvas initialized:', this.canvas.width, 'x', this.canvas.height);
    }

    /**
     * Create offscreen canvases for pre-rendering blurred layers
     * This is the key performance optimization - render blur ONCE, composite every frame
     */
    createLayerCanvases() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Cloud layer canvas (pre-rendered with blur)
        this.cloudLayerCanvas = document.createElement('canvas');
        this.cloudLayerCanvas.width = width;
        this.cloudLayerCanvas.height = height;
        this.cloudLayerCtx = this.cloudLayerCanvas.getContext('2d', {
            alpha: true,
            willReadFrequently: false
        });

        // Mist layer canvas (pre-rendered with heavy blur)
        this.mistLayerCanvas = document.createElement('canvas');
        this.mistLayerCanvas.width = width;
        this.mistLayerCanvas.height = height;
        this.mistLayerCtx = this.mistLayerCanvas.getContext('2d', {
            alpha: true,
            willReadFrequently: false
        });

        console.log('[Nimbus Veil] Layer canvases created for pre-rendering');
    }

    /**
     * Main animation loop (optimized for 60 FPS)
     */
    startAnimation() {
        const animate = (currentTime) => {
            if (!this.isActive) return;

            // Calculate delta time
            const deltaTime = currentTime - this.lastFrameTime;
            this.lastFrameTime = currentTime;

            // Accumulate elapsed time (smoother than Date.now())
            this.elapsedTime += deltaTime * 0.001; // Convert to seconds

            // Update particle positions every frame
            this.updateParticles(deltaTime);

            // Render at full 60 FPS (no frame skipping!)
            this.renderCanvas();

            this.animationFrame = requestAnimationFrame(animate);
        };

        this.lastFrameTime = performance.now();
        this.animationFrame = requestAnimationFrame(animate);
    }

    /**
     * Update particle positions and states (ultra-optimized)
     */
    updateParticles(deltaTime) {
        this.updateCounter++;
        const time = this.elapsedTime;

        // Cache dimensions (only update if changed)
        const currentWidth = window.innerWidth;
        const currentHeight = window.innerHeight;
        if (this.cachedWidth !== currentWidth || this.cachedHeight !== currentHeight) {
            this.cachedWidth = currentWidth;
            this.cachedHeight = currentHeight;
        }
        const width = this.cachedWidth;
        const height = this.cachedHeight;

        // Update wind only every 10 frames (heavily reduced for performance)
        if (this.updateCounter % 10 === 0) {
            this.windChangeTimer += deltaTime * 0.003;
            if (this.windChangeTimer > 10) {
                this.windChangeTimer = 0;
                this.windIntensity = Math.random() * 0.6 + 0.2;
                this.windDirection = Math.random() * Math.PI * 2;
            }
            // Cache wind calculations
            this.cachedWindX = Math.cos(this.windDirection) * this.windIntensity * 0.15;
            this.cachedWindY = Math.sin(this.windDirection) * this.windIntensity * 0.15;
        }
        const windX = this.cachedWindX;
        const windY = this.cachedWindY;

        // Lightning (ultra rare) - check less frequently for performance
        if (this.updateCounter % 60 === 0 && Math.random() < (this.lightningChance || 0.0005)) {
            this.createLightningFlash();
        }

        // Update lightning flashes (only if they exist)
        if (this.lightningFlashes.length > 0) {
            const dt = deltaTime * 0.001;
            for (let i = this.lightningFlashes.length - 1; i >= 0; i--) {
                const flash = this.lightningFlashes[i];
                flash.age += dt;
                flash.opacity = 1 - (flash.age / flash.duration);
                if (flash.age >= flash.duration) {
                    this.lightningFlashes.splice(i, 1);
                }
            }
        }

        // Update trig cache only every 5 frames (heavily reduced for performance)
        if (this.updateCounter % 5 === 0) {
            this.cachedSinCos.sin = Math.sin(time * 0.5);
            this.cachedSinCos.cos = Math.cos(time * 0.5);
        }
        const sinTime = this.cachedSinCos.sin;
        const cosTime = this.cachedSinCos.cos;

        // Pre-calculate lightning state once
        const hasLightning = this.lightningFlashes.length > 0;
        const lightningBoost = hasLightning ? 0.3 : 0;
        const lightningDim = hasLightning ? -0.1 : 0;
        const lightningBrightness = hasLightning ? 0.4 : 0;

        // Update cloud particles (optimized loop)
        const windX12 = windX * 1.2;
        const windY12 = windY * 1.2;

        for (let i = 0, len = this.cloudParticles.length; i < len; i++) {
            const particle = this.cloudParticles[i];

            // Movement (REMOVED morphing calculations for performance)
            particle.x += particle.speedX + sinTime * particle.swayAmplitude + windX12;
            particle.y += particle.speedY + cosTime * particle.swayAmplitude * 0.5 + windY12;

            // Wrap around
            if (particle.x > width + particle.size) particle.x = -particle.size;
            else if (particle.y > height + particle.size) particle.y = -particle.size;
            else if (particle.y < -particle.size) particle.y = height + particle.size;

            // Opacity (minimal pulsing)
            particle.currentOpacity = particle.opacity * (0.95 + Math.sin(time * particle.pulseSpeed + particle.pulseOffset) * 0.05 + lightningBoost);
        }

        // Update mist particles (optimized loop)
        const windX08 = windX * 0.8;
        const windY08 = windY * 0.8;
        const sinTime08 = sinTime * 0.8;
        const cosTime06 = cosTime * 0.6;

        for (let i = 0, len = this.mistParticles.length; i < len; i++) {
            const particle = this.mistParticles[i];

            // Movement (REMOVED morphing calculations for performance)
            particle.x += particle.speedX + sinTime08 * particle.swayAmplitude + windX08;
            particle.y += particle.speedY + cosTime06 * particle.swayAmplitude + windY08;

            if (particle.x > width + particle.size) particle.x = -particle.size;
            else if (particle.y > height + particle.size) particle.y = -particle.size;
            else if (particle.y < -particle.size) particle.y = height + particle.size;

            particle.currentOpacity = particle.opacity * (0.92 + Math.sin(time * particle.pulseSpeed + particle.pulseOffset) * 0.08 + lightningDim);
        }

        // Update moving particles (optimized loop)
        const windX25 = windX * 2.5;
        const windY25 = windY * 2.5;

        for (let i = 0, len = this.movingParticles.length; i < len; i++) {
            const particle = this.movingParticles[i];

            particle.x += particle.speedX + windX25;
            particle.y += particle.speedY + windY25;

            if (particle.x > width) particle.x = 0;
            else if (particle.x < 0) particle.x = width;
            if (particle.y > height) particle.y = 0;
            else if (particle.y < 0) particle.y = height;

            particle.currentOpacity = particle.opacity * (0.5 + Math.sin(time * particle.twinkleSpeed + particle.twinkleOffset) * 0.5 + lightningBrightness);
        }

        // Update combo rings (expand and fade out)
        const dt = deltaTime * 0.001;
        for (let i = this.comboRings.length - 1; i >= 0; i--) {
            const ring = this.comboRings[i];
            ring.age += dt;
            ring.radius += ring.expansionSpeed * deltaTime;
            ring.opacity = (1 - (ring.age / ring.lifetime)) * ring.maxOpacity;

            if (ring.age >= ring.lifetime) {
                this.comboRings.splice(i, 1);
            }
        }

        // Update sparkles (move and fade out)
        for (let i = this.sparkles.length - 1; i >= 0; i--) {
            const sparkle = this.sparkles[i];
            sparkle.age += dt;
            sparkle.x += sparkle.vx * deltaTime;
            sparkle.y += sparkle.vy * deltaTime;
            sparkle.vy += sparkle.gravity * deltaTime; // Apply gravity
            sparkle.opacity = (1 - (sparkle.age / sparkle.lifetime)) * sparkle.maxOpacity;

            if (sparkle.age >= sparkle.lifetime) {
                this.sparkles.splice(i, 1);
            }
        }
    }

    /**
     * Pre-render mist layer with blur (called once or when particles change significantly)
     */
    prerenderMistLayer() {
        if (!this.mistLayerCtx) return;

        const ctx = this.mistLayerCtx;

        // Clear the layer
        ctx.clearRect(0, 0, this.mistLayerCanvas.width, this.mistLayerCanvas.height);

        // Apply blur filter ONCE for all mist (reduced blur for performance)
        ctx.save();
        ctx.filter = 'blur(40px)'; // Reduced from 50px for performance
        ctx.fillStyle = '#ffffff';

        // Draw all mist particles with their BASE opacity
        for (let i = 0; i < this.mistParticles.length; i++) {
            const particle = this.mistParticles[i];
            ctx.globalAlpha = particle.opacity;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, 6.28318);
            ctx.fill();
        }
        ctx.restore();
    }

    /**
     * Pre-render cloud layer with blur (called once or when particles change significantly)
     */
    prerenderCloudLayer() {
        if (!this.cloudLayerCtx) return;

        const ctx = this.cloudLayerCtx;

        // Clear the layer
        ctx.clearRect(0, 0, this.cloudLayerCanvas.width, this.cloudLayerCanvas.height);

        // Apply blur filter ONCE for all clouds (slightly reduced for performance)
        ctx.save();
        ctx.filter = 'blur(30px)'; // Reduced from 35px for performance
        ctx.fillStyle = '#ffffff';

        // Draw all cloud particles with their BASE opacity
        for (let i = 0; i < this.cloudParticles.length; i++) {
            const particle = this.cloudParticles[i];
            ctx.globalAlpha = particle.opacity;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, 6.28318);
            ctx.fill();
        }
        ctx.restore();
    }

    /**
     * Render particles to canvas (ULTRA-OPTIMIZED - 60 FPS capable)
     * Key optimization: Composite pre-rendered blurred layers instead of applying blur every frame
     */
    renderCanvas() {
        if (!this.ctx) return;

        // Pre-render layers every 10 frames (particles move slowly, don't need to re-blur constantly)
        // This is a MAJOR performance boost - blur is expensive!
        this.frameSkip++;
        if (this.frameSkip % 10 === 0) {
            this.prerenderMistLayer();
            this.prerenderCloudLayer();
        }

        // Clear main canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw lightning flashes (behind everything)
        if (this.lightningFlashes.length > 0) {
            this.ctx.save();
            this.ctx.globalAlpha = this.lightningFlashes[0].opacity * 0.15;
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
        }

        // Composite pre-rendered mist layer (NO BLUR FILTER - instant!)
        this.ctx.save();
        this.ctx.globalAlpha = 1.0;
        this.ctx.drawImage(this.mistLayerCanvas, 0, 0);
        this.ctx.restore();

        // Composite pre-rendered cloud layer (NO BLUR FILTER - instant!)
        this.ctx.save();
        this.ctx.globalAlpha = 1.0;
        this.ctx.drawImage(this.cloudLayerCanvas, 0, 0);
        this.ctx.restore();

        // Draw moving particles (no blur, ultra-fast batch render)
        this.ctx.save();
        this.ctx.fillStyle = '#ffffff';

        // Single path for all particles (maximum performance)
        this.ctx.beginPath();
        for (let i = 0; i < this.movingParticles.length; i++) {
            const particle = this.movingParticles[i];
            if (particle.currentOpacity < 0.05) continue;

            this.ctx.moveTo(particle.x + particle.size, particle.y);
            this.ctx.arc(particle.x, particle.y, particle.size, 0, 6.28318);
        }

        // Fill all at once
        this.ctx.globalAlpha = 0.6; // Fixed alpha for all
        this.ctx.fill();
        this.ctx.restore();

        // Draw combo rings
        if (this.comboRings.length > 0) {
            this.ctx.save();
            for (let i = 0; i < this.comboRings.length; i++) {
                const ring = this.comboRings[i];
                this.ctx.globalAlpha = ring.opacity;
                this.ctx.strokeStyle = ring.color;
                this.ctx.lineWidth = ring.thickness;
                this.ctx.beginPath();
                this.ctx.arc(ring.x, ring.y, ring.radius, 0, 6.28318);
                this.ctx.stroke();
            }
            this.ctx.restore();
        }

        // Draw sparkles
        if (this.sparkles.length > 0) {
            this.ctx.save();
            for (let i = 0; i < this.sparkles.length; i++) {
                const sparkle = this.sparkles[i];
                this.ctx.globalAlpha = sparkle.opacity;

                // Draw sparkle as a small cross/star
                this.ctx.strokeStyle = sparkle.color;
                this.ctx.lineWidth = 2;
                this.ctx.lineCap = 'round';

                // Horizontal line
                this.ctx.beginPath();
                this.ctx.moveTo(sparkle.x - sparkle.size, sparkle.y);
                this.ctx.lineTo(sparkle.x + sparkle.size, sparkle.y);
                this.ctx.stroke();

                // Vertical line
                this.ctx.beginPath();
                this.ctx.moveTo(sparkle.x, sparkle.y - sparkle.size);
                this.ctx.lineTo(sparkle.x, sparkle.y + sparkle.size);
                this.ctx.stroke();
            }
            this.ctx.restore();
        }
    }

    /**
     * Create a lightning flash effect
     */
    createLightningFlash() {
        if (this.MAX_LIGHTNING_FLASHES > 0 && this.lightningFlashes.length >= this.MAX_LIGHTNING_FLASHES) {
            this.lightningFlashes.splice(0, this.lightningFlashes.length - this.MAX_LIGHTNING_FLASHES + 1);
        }
        this.lightningFlashes.push({
            age: 0,
            duration: 0.15 + Math.random() * 0.1, // 0.15-0.25 seconds
            opacity: 1
        });

        console.log('[Nimbus Veil] Lightning flash!');

        // Sometimes create a double flash
        if (Math.random() < 0.3) {
            setTimeout(() => {
                if (this.MAX_LIGHTNING_FLASHES > 0 && this.lightningFlashes.length >= this.MAX_LIGHTNING_FLASHES) {
                    this.lightningFlashes.splice(0, this.lightningFlashes.length - this.MAX_LIGHTNING_FLASHES + 1);
                }
                this.lightningFlashes.push({
                    age: 0,
                    duration: 0.1 + Math.random() * 0.05,
                    opacity: 1
                });
            }, 100 + Math.random() * 100);
        }
    }

    /**
     * Setup game event listeners
     */
    setupEventListeners() {
        const settings = this.resources?.settings || {};

        // Line clear effect
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onLineClear(data.lineCount);
            }
        });

        // Combo effect
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onCombo(data.comboCount);
            }
        });

        // Piece lock effect
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.onPieceLock(data.piece);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    /**
     * React to line clear events
     */
    onLineClear(lineCount) {
        // Create expanding cloud ripple
        this.createCloudRipple(lineCount);

        // Brighten random clouds temporarily
        const brightenCount = Math.min(lineCount * 5, 20);
        const randomClouds = this.getRandomParticles(this.cloudParticles, brightenCount);

        randomClouds.forEach(cloud => {
            const originalOpacity = cloud.opacity;
            cloud.opacity = Math.min(cloud.opacity * 1.5, 0.9);

            // Fade back to normal
            setTimeout(() => {
                cloud.opacity = originalOpacity;
            }, 800);
        });
    }

    /**
     * React to combo events - Enhanced with rings and sparkles!
     */
    onCombo(comboCount) {
        // Create expanding rings around random clouds
        const ringCount = Math.min(Math.floor(comboCount / 2), 5); // 1 ring per 2 combos, max 5
        for (let i = 0; i < ringCount; i++) {
            // Pick a random cloud to center the ring on
            if (this.cloudParticles.length > 0) {
                const cloud = this.cloudParticles[Math.floor(Math.random() * this.cloudParticles.length)];

                this.comboRings.push({
                    x: cloud.x,
                    y: cloud.y,
                    radius: 20 + (i * 10), // Stagger initial sizes
                    expansionSpeed: 0.3 + (comboCount * 0.02), // Faster for higher combos
                    thickness: 3 + Math.min(comboCount * 0.5, 5), // Thicker for higher combos
                    opacity: 1,
                    maxOpacity: 0.7,
                    color: `rgba(200, 220, 255, ${0.8})`, // Soft blue-white
                    age: 0,
                    lifetime: 1.5 + (comboCount * 0.1) // Longer for higher combos
                });
                this.trimCollection(this.comboRings, this.MAX_COMBO_RINGS);
            }
        }

        // Create sparkles bursting from clouds
        const sparkleCount = Math.min(comboCount * 3, 30); // 3 sparkles per combo, max 30
        for (let i = 0; i < sparkleCount; i++) {
            // Pick a random cloud as sparkle source
            if (this.cloudParticles.length > 0) {
                const cloud = this.cloudParticles[Math.floor(Math.random() * this.cloudParticles.length)];

                // Random burst direction
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 0.3 + 0.1;

                this.sparkles.push({
                    x: cloud.x + (Math.random() - 0.5) * cloud.size,
                    y: cloud.y + (Math.random() - 0.5) * cloud.size,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    gravity: 0.0002, // Slight downward pull
                    size: Math.random() * 4 + 2, // 2-6px
                    opacity: 1,
                    maxOpacity: 0.9,
                    color: Math.random() > 0.5 ? 'rgba(255, 255, 255, 1)' : 'rgba(200, 220, 255, 1)',
                    age: 0,
                    lifetime: 0.8 + Math.random() * 0.4 // 0.8-1.2 seconds
                });
                this.trimCollection(this.sparkles, this.MAX_SPARKLES);
            }
        }

        // Add color tint to clouds during high combos
        if (comboCount >= 5) {
            this.cloudParticles.forEach(particle => {
                const originalColor = particle.color;
                particle.color = 'rgba(200, 220, 255, 0.85)'; // Blue tint

                // Restore after 500ms
                setTimeout(() => {
                    particle.color = originalColor;
                }, 500);
            });
        }

        // Speed up drift temporarily (existing effect, kept)
        const speedMultiplier = 1 + (comboCount * 0.1);
        this.cloudParticles.forEach(particle => {
            particle.speedX *= speedMultiplier;
        });

        // Restore speed after 1 second
        setTimeout(() => {
            this.cloudParticles.forEach(particle => {
                particle.speedX /= speedMultiplier;
            });
        }, 1000);

        // Push clouds outward from center for dramatic combos (10+)
        if (comboCount >= 10) {
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;

            this.cloudParticles.forEach(particle => {
                const dx = particle.x - centerX;
                const dy = particle.y - centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance > 0) {
                    const pushStrength = 5;
                    particle.x += (dx / distance) * pushStrength;
                    particle.y += (dy / distance) * pushStrength;
                }
            });
        }
    }

    /**
     * React to piece lock events
     */
    onPieceLock(piece) {
        // DISABLED for performance - cloud puffs on every piece create too many particles
        // Just brighten a random cloud instead
        if (Math.random() < 0.15 && this.cloudParticles.length > 0) {
            const cloud = this.cloudParticles[Math.floor(Math.random() * this.cloudParticles.length)];
            const originalOpacity = cloud.opacity;
            cloud.opacity = Math.min(cloud.opacity * 1.2, 0.8);
            setTimeout(() => {
                cloud.opacity = originalOpacity;
            }, 300);
        }
    }

    /**
     * Create expanding cloud ripple effect
     */
    createCloudRipple(intensity = 1) {
        const pulsesContainer = document.getElementById('nimbus-veil-pulses');
        if (!pulsesContainer) return;

        const pulse = document.createElement('div');
        pulse.className = 'nimbus-veil-pulse';
        pulse.style.width = '100px';
        pulse.style.height = '100px';

        pulsesContainer.appendChild(pulse);

        // Remove after animation
        setTimeout(() => {
            pulse.remove();
        }, 2500);
    }

    /**
     * Create cloud wave effect for combos
     * REMOVED: Now using canvas-based rings instead of DOM elements
     */
    createCloudWave() {
        // No longer needed - combo effects now use canvas rings and sparkles
        // See onCombo() method for new implementation
    }

    /**
     * Create small cloud puff effect
     */
    createCloudPuff() {
        // Add a temporary cloud particle
        const colors = this.getCloudColors();
        const puff = {
            x: window.innerWidth / 2 + (Math.random() - 0.5) * 200,
            y: window.innerHeight / 2 + (Math.random() - 0.5) * 200,
            size: Math.random() * 40 + 20,
            opacity: 0.6,
            color: colors[0],
            speedX: (Math.random() - 0.5) * 0.5,
            speedY: -Math.random() * 0.3 - 0.2, // Float upward
            blur: 25,
            pulseSpeed: 0.02,
            pulseOffset: 0,
            currentOpacity: 0.6,
            lifetime: 2000, // 2 seconds
            createdAt: Date.now()
        };

        this.cloudParticles.push(puff);

        // Remove after lifetime
        setTimeout(() => {
            const index = this.cloudParticles.indexOf(puff);
            if (index > -1) {
                this.cloudParticles.splice(index, 1);
            }
        }, puff.lifetime);
    }

    /**
     * Get random particles from array
     */
    getRandomParticles(array, count) {
        const shuffled = [...array].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
    }

    /**
     * Cleanup theme resources
     */
    stop() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        super.stop();

        // Cancel animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Clear particles
        this.cloudParticles = [];
        this.mistParticles = [];
        this.movingParticles = [];
        this.lightningFlashes = [];
        this.comboRings = [];
        this.sparkles = [];

        // Reset ambient effects
        this.windIntensity = 0.5;
        this.windDirection = 0;
        this.windChangeTimer = 0;

        // Clear canvas
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        this.canvas = null;
        this.ctx = null;

        // Clear layer canvases
        if (this.cloudLayerCtx) {
            this.cloudLayerCtx.clearRect(0, 0, this.cloudLayerCanvas.width, this.cloudLayerCanvas.height);
        }
        if (this.mistLayerCtx) {
            this.mistLayerCtx.clearRect(0, 0, this.mistLayerCanvas.width, this.mistLayerCanvas.height);
        }
        this.cloudLayerCanvas = null;
        this.cloudLayerCtx = null;
        this.mistLayerCanvas = null;
        this.mistLayerCtx = null;

        // Clear cache
        this.colorCache.clear();
    }

    /**
     * Provide Nimbus Veil themed tetromino styling (soft cloud palette)
     * @returns {Object} Nimbus Veil tetromino configuration
     */
    getTetrominoConfig() {
        return NIMBUS_VEIL_TETROMINOS;
    }
}
