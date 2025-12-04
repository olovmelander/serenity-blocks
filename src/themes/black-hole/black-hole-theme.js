import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { performanceMonitor } from '../../utils/performance-monitor.js';
import { normalizeQuality } from '../../utils/quality.js';
import { BLACK_HOLE_TETROMINOS } from './black-hole-tetrominos.js';
import WebGLBlackHoleRenderer from './webgl-black-hole-renderer.js';

const QUALITY_PRESETS = {
    Extreme: {
        starCount: 2000, // Increased for WebGL
        initialParticles: 1800,
        maxParticles: 3000,
        minParticles: 1000,
        adaptiveStep: 100,
        targetFps: 60,
        renderScale: 1.0,
        effectIntensity: 1.3,
        pulseCoverage: 1.0,
        comboBurstLimit: 200,
        eruptionLimit: 300,
        allowEruptions: true,
        lineEffectCooldown: 50,
        comboEffectCooldown: 80,
        smallBurstLimit: 30,
        starBurstLimit: 10,
        trailDetail: 1.0,
        useCanvasStars: false,
        skipPhysicsDistance: 1.6,
    },
    Ultra: {
        starCount: 1500,
        initialParticles: 1500,
        maxParticles: 2500,
        minParticles: 800,
        adaptiveStep: 80,
        targetFps: 60,
        renderScale: 1.0,
        effectIntensity: 1.0,
        pulseCoverage: 0.9,
        comboBurstLimit: 150,
        eruptionLimit: 200,
        allowEruptions: true,
        lineEffectCooldown: 70,
        comboEffectCooldown: 100,
        smallBurstLimit: 20,
        starBurstLimit: 8,
        trailDetail: 0.8,
        useCanvasStars: false,
        skipPhysicsDistance: 1.8,
    },
    High: {
        starCount: 1000,
        initialParticles: 1000,
        maxParticles: 2000,
        minParticles: 500,
        adaptiveStep: 50,
        targetFps: 60,
        renderScale: 1.0, // WebGL can handle 1.0
        effectIntensity: 0.8,
        pulseCoverage: 0.7,
        comboBurstLimit: 100,
        eruptionLimit: 150,
        allowEruptions: true,
        lineEffectCooldown: 100,
        comboEffectCooldown: 150,
        smallBurstLimit: 15,
        starBurstLimit: 5,
        trailDetail: 0.6,
        useCanvasStars: true,
        skipPhysicsDistance: 2.0,
    },
    Medium: {
        starCount: 500,
        initialParticles: 500,
        maxParticles: 1000,
        minParticles: 300,
        adaptiveStep: 30,
        targetFps: 60,
        renderScale: 0.8,
        effectIntensity: 0.6,
        pulseCoverage: 0.5,
        comboBurstLimit: 50,
        eruptionLimit: 80,
        allowEruptions: true,
        lineEffectCooldown: 150,
        comboEffectCooldown: 200,
        smallBurstLimit: 10,
        starBurstLimit: 3,
        trailDetail: 0.4,
        useCanvasStars: true,
        skipPhysicsDistance: 2.2,
    },
    Low: {
        starCount: 200,
        initialParticles: 200,
        maxParticles: 500,
        minParticles: 150,
        adaptiveStep: 20,
        targetFps: 40,
        renderScale: 0.6,
        effectIntensity: 0.4,
        pulseCoverage: 0.3,
        comboBurstLimit: 30,
        eruptionLimit: 40,
        allowEruptions: false,
        lineEffectCooldown: 200,
        comboEffectCooldown: 300,
        smallBurstLimit: 5,
        starBurstLimit: 2,
        trailDetail: 0.2,
        useCanvasStars: true,
        skipPhysicsDistance: 2.5,
    },
    Minimal: {
        starCount: 100,
        initialParticles: 100,
        maxParticles: 200,
        minParticles: 50,
        adaptiveStep: 10,
        targetFps: 30,
        renderScale: 0.5,
        effectIntensity: 0.2,
        pulseCoverage: 0.2,
        comboBurstLimit: 15,
        eruptionLimit: 20,
        allowEruptions: false,
        lineEffectCooldown: 300,
        comboEffectCooldown: 400,
        smallBurstLimit: 3,
        starBurstLimit: 1,
        trailDetail: 0.1,
        useCanvasStars: true,
        skipPhysicsDistance: 3.0,
    },
};

export default class BlackHoleTheme extends BaseTheme {
    constructor() {
        super('black-hole');
        this.eventUnsubscribers = [];
        this.stars = [];
        this.animationFrame = null;
        this.canvas = null;
        this.ctx = null;
        this.webglRenderer = null;
        this.useWebGL = false;
        this.particles = [];
        this.particleSpriteCache = new Map();
        this.boundAnimateStardust = this.animateStardust.bind(this);
        this.handleResize = this.handleResize.bind(this);
        this.resizeAttached = false;
        this.settingsListener = null;
        this.qualityProfile = QUALITY_PRESETS.High;
        this.effectIntensityMultiplier = this.qualityProfile.effectIntensity;
        this.baseBlackHolePullRadius = 400;
        this.baseBlackHolePullStrength = 0.5;
        this.blackHoleX = 0;
        this.blackHoleY = 0;
        this.diskIntensity = 1.0;
        this.diskScale = 1.0;
        this.diskTargetIntensity = 1.0;
        this.diskTargetScale = 1.0;
        this.blackHoleScale = 1.0;
        this.baseRadius = 60;

        // Black hole drift animation
        this.blackHoleDriftVelocityX = 0;
        this.blackHoleDriftVelocityY = 0;
        this.blackHoleDriftSpeed = 0.03; // Extremely slow drift speed (reduced from 0.15)
        this.blackHoleTargetX = 0;
        this.blackHoleTargetY = 0;
        this.blackHoleDriftChangeTimer = 0;
        this.blackHoleDriftChangeCooldown = 30000; // Change direction every 30 seconds (very slow changes)
        this.pendingParticleSpawns = [];
        this.accumulatedFrameTime = 0;
        this.lastFrameTime = 0;
        this.qualityLevel = 'High';
        this.maxParticles = this.qualityProfile.maxParticles;
        this.minParticles = this.qualityProfile.minParticles;
        this.dynamicParticleBudget = this.maxParticles;
        this.frameInterval = 1000 / this.qualityProfile.targetFps;
        this.renderScale = this.qualityProfile.renderScale ?? 1;
        this.trailDetailFactor = this.qualityProfile.trailDetail;
        this.frameTimeEMA = this.frameInterval;
        this.lowPowerMode = false;
        this.lastLineEffectTime = 0;
        this.lastComboEffectTime = 0;
        this.particlePool = [];
        this.blackHolePullRadius = this.baseBlackHolePullRadius * (0.8 + this.effectIntensityMultiplier * 0.4);
        this.blackHolePullStrength = this.baseBlackHolePullStrength * (0.7 + this.effectIntensityMultiplier * 0.6);
        // Pre-compute squared radius for faster distance checks
        this.blackHolePullRadiusSquared = this.blackHolePullRadius * this.blackHolePullRadius;
        // Spatial partitioning - particles beyond this don't need physics
        this.physicsSkipDistance = this.qualityProfile.skipPhysicsDistance || 2.0;
        this.physicsSkipDistanceSquared = (this.blackHolePullRadius * this.physicsSkipDistance) ** 2;
        // Fast inverse square root lookup table for optimization
        this.invSqrtLUT = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) {
            this.invSqrtLUT[i] = 1 / Math.sqrt(i / 10 + 0.1);
        }
        // Frame skip counter for adaptive rendering
        this.frameSkipCounter = 0;
        this.frameSkipCounter = 0;
        this.trailRenderThrottle = 0;
        this.starFlashIntensity = 0;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityProfile(level) {
        const normalized = normalizeQuality(level || 'High');
        const profile = QUALITY_PRESETS[normalized] || QUALITY_PRESETS.High;
        this.qualityLevel = normalized;
        this.qualityProfile = profile;
        this.effectIntensityMultiplier = profile.effectIntensity;
        this.maxParticles = profile.maxParticles;
        this.minParticles = profile.minParticles;
        this.dynamicParticleBudget = profile.maxParticles;
        this.renderScale = profile.renderScale ?? 1;
        this.trailDetailFactor = profile.trailDetail;
        this.lowPowerMode = false;
        this.frameInterval = 1000 / profile.targetFps;
        this.frameTimeEMA = this.frameInterval;

        if (this.useWebGL && this.webglRenderer) {
            this.webglRenderer.allocateParticles(this.maxParticles);
        }

        if (this.particles.length > this.maxParticles) {
            this.cullParticlesToBudget(this.maxParticles);
        }
        this.updateGravityDefaults();
        this.updateTrailDetailFactor();
    }

    scaleEffectIntensity(value, fallback = 1) {
        const scaled = value * this.effectIntensityMultiplier;
        return Math.max(fallback, scaled);
    }

    getScaledCount(base, limit, fallback = 1) {
        const scaled = this.scaleEffectIntensity(base, fallback);
        return Math.max(fallback, Math.min(limit, Math.round(scaled)));
    }

    canRunLineEffects() {
        const now = performance.now();
        if (now - this.lastLineEffectTime < this.qualityProfile.lineEffectCooldown) {
            return false;
        }
        this.lastLineEffectTime = now;
        return true;
    }

    updateGravityDefaults() {
        this.blackHolePullRadius = this.baseBlackHolePullRadius * (0.8 + this.effectIntensityMultiplier * 0.4);
        this.blackHolePullStrength = this.baseBlackHolePullStrength * (0.7 + this.effectIntensityMultiplier * 0.6);
        // Update squared radius for optimized distance checks
        this.blackHolePullRadiusSquared = this.blackHolePullRadius * this.blackHolePullRadius;
        // Update spatial partitioning distance
        this.physicsSkipDistance = this.qualityProfile.skipPhysicsDistance || 2.0;
        this.physicsSkipDistanceSquared = (this.blackHolePullRadius * this.physicsSkipDistance) ** 2;
    }

    updateTrailDetailFactor() {
        const base = this.qualityProfile.trailDetail;
        this.trailDetailFactor = this.lowPowerMode ? Math.max(0.2, base * 0.5) : base;
    }

    /**
     * Attach settings listener to react to quality changes
     */
    attachSettingsListener() {
        if (this.settingsListener || typeof window === 'undefined') return;
        this.settingsListener = (event) => {
            if (event?.detail?.effectQuality !== undefined) {
                console.log('[BlackHole] Quality setting changed to:', event.detail.effectQuality);
                this.applyQualityProfile(event.detail.effectQuality);
            }
        };
        window.addEventListener('settingsChanged', this.settingsListener);
    }

    /**
     * Detach settings listener
     */
    detachSettingsListener() {
        if (this.settingsListener && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.settingsListener);
            this.settingsListener = null;
        }
    }

    canRunComboEffects() {
        const now = performance.now();
        if (now - this.lastComboEffectTime < this.qualityProfile.comboEffectCooldown) {
            return false;
        }
        this.lastComboEffectTime = now;
        return true;
    }

    adjustPerformanceTargets(delta) {
        if (!delta || !Number.isFinite(delta)) {
            return;
        }

        const emaWeight = 0.15;
        this.frameTimeEMA = (this.frameTimeEMA ?? delta) * (1 - emaWeight) + delta * emaWeight;

        const highThreshold = this.frameInterval * 1.35;
        const lowThreshold = this.frameInterval * 0.9;
        const previousLowPower = this.lowPowerMode;
        let budgetChanged = false;

        if (this.frameTimeEMA > highThreshold && this.dynamicParticleBudget > this.minParticles) {
            this.dynamicParticleBudget = Math.max(
                this.minParticles,
                this.dynamicParticleBudget - this.qualityProfile.adaptiveStep,
            );
            budgetChanged = true;
        } else if (this.frameTimeEMA < lowThreshold && this.dynamicParticleBudget < this.maxParticles) {
            this.dynamicParticleBudget = Math.min(
                this.maxParticles,
                this.dynamicParticleBudget + this.qualityProfile.adaptiveStep,
            );
            budgetChanged = true;
        }

        const lowPowerThreshold = this.minParticles + this.qualityProfile.adaptiveStep;
        if (this.dynamicParticleBudget <= lowPowerThreshold) {
            this.lowPowerMode = true;
        } else if (this.dynamicParticleBudget >= this.maxParticles * 0.9) {
            this.lowPowerMode = false;
        }
        if (previousLowPower !== this.lowPowerMode) {
            this.updateTrailDetailFactor();
        }

        if (budgetChanged && this.particles.length > this.dynamicParticleBudget) {
            this.cullParticlesToBudget(this.dynamicParticleBudget);
        }
    }

    async createScene() {
        console.log('[BlackHole] Creating scene...');

        try {
            this.applyQualityProfile(this.getCurrentQualityLevel());

            // Initialize WebGL Renderer first (via stardust canvas setup)
            // This sets this.useWebGL which is needed for star field creation
            this.initRenderer();

            // Create star field (will use WebGL if initialized)
            this.createStarField();

            // Setup event listeners
            this.setupEventListeners();

            // Attach settings listener to react to quality changes
            this.attachSettingsListener();

            // Start animation loop
            this.startAnimation();

            console.log('[BlackHole] Scene created successfully!');
        } catch (error) {
            console.error('[BlackHole] Error in createScene():', error);
            throw error;
        }
    }

    /**
     * Create multi-colored star field
     */
    createStarField() {
        const { starCount } = this.qualityProfile;

        if (this.useWebGL && this.webglRenderer) {
            this.createWebGLStarField(starCount);
            return;
        }

        const useCanvas = this.qualityProfile.useCanvasStars;

        if (useCanvas) {
            // High-performance canvas-based star field
            this.createCanvasStarField(starCount);
        } else {
            // Higher quality DOM-based star field (slower)
            this.createDOMStarField(starCount);
        }
    }

    createWebGLStarField(starCount) {
        const starColors = [
            'rgba(255, 255, 255, 1)', // White
            'rgba(180, 220, 255, 1)', // Cyan-white
            'rgba(255, 240, 180, 1)', // Yellow-white
            'rgba(255, 200, 140, 1)', // Orange
            'rgba(150, 200, 255, 1)', // Blue
            'rgba(255, 180, 220, 1)', // Pink
            'rgba(200, 180, 255, 1)', // Purple
        ];

        const stars = [];
        const { width, height } = this.canvas;

        for (let i = 0; i < starCount; i++) {
            stars.push({
                x: this.random(0, width),
                y: this.random(0, height),
                size: this.random(1.0, 3.0),
                color: starColors[Math.floor(Math.random() * starColors.length)],
                twinkleSpeed: this.random(0.005, 0.015),
                twinklePhase: this.random(0, Math.PI * 2),
            });
        }

        this.webglRenderer.setStars(stars);
    }

    /**
     * Create canvas-based star field (high performance)
     */
    createCanvasStarField(starCount) {
        const canvas = document.createElement('canvas');
        canvas.id = 'stellar-stars-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '5';
        canvas.style.pointerEvents = 'none';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

        // Define star color palette
        const starColors = [
            'rgba(255, 255, 255, 1)', // White
            'rgba(180, 220, 255, 1)', // Cyan-white
            'rgba(255, 240, 180, 1)', // Yellow-white
            'rgba(255, 200, 140, 1)', // Orange
            'rgba(150, 200, 255, 1)', // Blue
            'rgba(255, 180, 220, 1)', // Pink
            'rgba(200, 180, 255, 1)', // Purple
        ];

        // Generate static star data
        this.canvasStars = [];
        for (let i = 0; i < starCount; i++) {
            this.canvasStars.push({
                x: this.random(0, canvas.width),
                y: this.random(0, canvas.height),
                size: this.random(0.5, 2.5),
                color: starColors[Math.floor(Math.random() * starColors.length)],
                opacity: this.random(0.5, 1),
                twinkleSpeed: this.random(0.005, 0.015),
                twinklePhase: this.random(0, Math.PI * 2),
                isBright: Math.random() < 0.1,
            });
        }

        // Store references before first render so helper has dimensions
        this.starCanvas = canvas;
        this.starCtx = ctx;

        // Render stars once on canvas
        this.renderCanvasStars(ctx);

        const starsContainer = document.getElementById('stellar-stars');
        if (starsContainer) {
            starsContainer.appendChild(canvas);
            this.registerContainer(starsContainer);
        }

        // Animate stars with requestAnimationFrame
        this.animateCanvasStars();
    }

    /**
     * Render canvas stars
     */
    renderCanvasStars(ctx) {
        if (!ctx || !this.canvasStars) return;
        const canvas = this.starCanvas || ctx.canvas;
        if (!canvas) {
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const now = performance.now() * 0.001; // Convert to seconds

        for (const star of this.canvasStars) {
            // Calculate twinkle effect
            star.twinklePhase += star.twinkleSpeed;
            const twinkle = 0.5 + 0.5 * Math.sin(star.twinklePhase);
            const currentOpacity = star.opacity * (0.7 + 0.3 * twinkle);

            ctx.fillStyle = star.color;
            ctx.globalAlpha = currentOpacity;

            if (star.isBright) {
                // Bright stars with glow
                ctx.shadowBlur = star.size * 2;
                ctx.shadowColor = star.color;
                ctx.fillRect(star.x, star.y, star.size * 1.5, star.size * 1.5);
                ctx.shadowBlur = 0;
            } else {
                ctx.fillRect(star.x, star.y, star.size, star.size);
            }
        }

        ctx.globalAlpha = 1;
    }

    /**
     * Animate canvas stars
     */
    animateCanvasStars() {
        if (!this.isActive || !this.starCanvas) return;

        this.renderCanvasStars(this.starCtx);
        this.starAnimationFrame = requestAnimationFrame(() => this.animateCanvasStars());
    }

    /**
     * Create DOM-based star field (higher quality, slower)
     */
    createDOMStarField(starCount) {
        const starsContainer = document.getElementById('stellar-stars');
        if (!starsContainer || starsContainer.children.length > 0) return;

        const fragment = document.createDocumentFragment();

        // Define star color palette based on the nebula image
        const starColors = [
            { color: 'rgba(255, 255, 255, 1)', weight: 35 }, // White
            { color: 'rgba(180, 220, 255, 1)', weight: 15 }, // Cyan-white
            { color: 'rgba(255, 240, 180, 1)', weight: 12 }, // Yellow-white
            { color: 'rgba(255, 200, 140, 1)', weight: 10 }, // Orange
            { color: 'rgba(150, 200, 255, 1)', weight: 10 }, // Blue
            { color: 'rgba(255, 180, 220, 1)', weight: 8 }, // Pink
            { color: 'rgba(200, 180, 255, 1)', weight: 5 }, // Purple
            { color: 'rgba(255, 150, 100, 1)', weight: 3 }, // Red-orange
            { color: 'rgba(100, 220, 255, 1)', weight: 2 }, // Bright cyan
        ];

        const getRandomStarColor = () => {
            const rand = Math.random() * 100;
            let cumulative = 0;
            for (const colorOption of starColors) {
                cumulative += colorOption.weight;
                if (rand <= cumulative) {
                    return colorOption.color;
                }
            }
            return starColors[0].color;
        };

        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'stellar-star';

            const size = this.random(0.5, 3);
            const isBright = Math.random() < 0.1; // 10% chance of bright star

            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${this.random(0, 100)}%`;
            star.style.top = `${this.random(0, 100)}%`;
            star.style.backgroundColor = getRandomStarColor();
            star.style.opacity = `${this.random(0.5, 1).toFixed(2)}`;
            star.style.animationDelay = `${this.random(0, 8)}s`;

            if (isBright) {
                star.classList.add('stellar-star-bright');
                star.style.boxShadow = `0 0 ${size * 2}px ${star.style.backgroundColor}`;
            }

            fragment.appendChild(star);
            this.stars.push(star);
        }

        starsContainer.appendChild(fragment);
        this.registerContainer(starsContainer);
    }

    /**
     * Initialize the renderer (WebGL or Canvas)
     */
    initRenderer() {
        this.canvas = document.getElementById('stellar-stardust-canvas');
        if (!this.canvas) {
            console.warn('[BlackHole] Stardust canvas not found!');
            return;
        }

        // Try to initialize WebGL renderer first
        this.webglRenderer = new WebGLBlackHoleRenderer(this.canvas);
        if (this.webglRenderer.init()) {
            this.useWebGL = true;
            this.webglRenderer.allocateParticles(this.maxParticles);
            console.log('[BlackHole] WebGL renderer initialized');
        } else {
            this.useWebGL = false;
            this.ctx = this.canvas.getContext('2d', { alpha: true, desynchronized: true });
            console.log('[BlackHole] Falling back to Canvas2D');
        }

        this.particles = [];
        this.handleResize();
        if (!this.resizeAttached) {
            window.addEventListener('resize', this.handleResize);
            this.resizeAttached = true;
        }
        this.updateGravityDefaults();

        // Pre-compute particle sprites for better performance (only needed for Canvas2D)
        if (!this.useWebGL) {
            this.precomputeParticleSprites();
        }

        // Create stardust particles being pulled into black hole
        const particleCount = Math.min(this.qualityProfile.initialParticles, this.dynamicParticleBudget);
        for (let i = 0; i < particleCount; i++) {
            this.addParticle({
                x: this.random(0, this.canvas.width),
                y: this.random(0, this.canvas.height),
                size: this.random(1.5, 3.5),
                speedX: this.random(-0.5, 0.5),
                speedY: this.random(-0.5, 0.5),
                opacity: this.random(0.4, 0.9),
                color: this.getNebulaColor(),
                pulse: this.random(0, Math.PI * 2),
                pulseSpeed: this.random(0.01, 0.03),
                orbitAngle: this.random(0, Math.PI * 2), // For orbital motion
                orbitSpeed: this.random(0.005, 0.02), // Orbital velocity
            }, { persistent: true });
        }
    }

    /**
     * Start the animation loop
     */
    startAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
        this.lastFrameTime = performance.now();
        this.animationFrame = requestAnimationFrame(this.boundAnimateStardust);
    }

    /**
     * Get random nebula color
     */
    getNebulaColor() {
        // Use pre-defined colors that we've already cached sprites for
        if (!this.nebulaColors) {
            this.nebulaColors = [
                { r: 255, g: 100, b: 180 }, // Magenta
                { r: 80, g: 180, b: 255 }, // Cyan
                { r: 255, g: 150, b: 80 }, // Orange
                { r: 180, g: 100, b: 255 }, // Purple
                { r: 100, g: 220, b: 255 }, // Bright cyan
                { r: 255, g: 120, b: 200 }, // Hot pink
                { r: 200, g: 130, b: 255 }, // Violet
                { r: 255, g: 170, b: 100 }, // Coral
                { r: 140, g: 230, b: 255 }, // Aqua
            ];
        }
        return this.nebulaColors[Math.floor(Math.random() * this.nebulaColors.length)];
    }

    /**
     * Pre-compute particle sprites for all nebula colors
     */
    precomputeParticleSprites() {
        const colors = [
            { r: 255, g: 100, b: 180 }, // Magenta
            { r: 80, g: 180, b: 255 }, // Cyan
            { r: 255, g: 150, b: 80 }, // Orange
            { r: 180, g: 100, b: 255 }, // Purple
            { r: 100, g: 220, b: 255 }, // Bright cyan
            { r: 255, g: 120, b: 200 }, // Hot pink
            { r: 200, g: 130, b: 255 }, // Violet
            { r: 255, g: 170, b: 100 }, // Coral
            { r: 140, g: 230, b: 255 }, // Aqua
        ];

        // Pre-generate sprites for all colors
        colors.forEach((color) => {
            this.getParticleSprite(color);
        });
    }

    /**
     * Update black hole drifting position for smooth, slow movement
     */
    updateBlackHoleDrift(delta) {
        const { width } = this.canvas;
        const { height } = this.canvas;

        // Update drift change timer
        this.blackHoleDriftChangeTimer += delta;

        // Change drift direction periodically
        if (this.blackHoleDriftChangeTimer >= this.blackHoleDriftChangeCooldown) {
            this.blackHoleDriftChangeTimer = 0;

            // Define safe boundaries (keep black hole away from edges)
            const marginX = width * 0.15; // 15% margin from edges
            const marginY = height * 0.15;
            const minX = marginX;
            const maxX = width - marginX;
            const minY = marginY;
            const maxY = height - marginY;

            // Pick a new random target position within safe boundaries
            this.blackHoleTargetX = minX + Math.random() * (maxX - minX);
            this.blackHoleTargetY = minY + Math.random() * (maxY - minY);
        }

        // Update base radius based on screen size (responsive)
        this.baseRadius = Math.min(width, height) * 0.08;

        // Smoothly drift toward target position with interpolation
        const dx = this.blackHoleTargetX - this.blackHoleX;
        const dy = this.blackHoleTargetY - this.blackHoleY;

        // Use extremely gentle interpolation for slow, smooth drifting
        const smoothingFactor = 0.0005; // Very low value for gentle drift (was 0.008)

        // Apply exponential smoothing (easing) for ultra-smooth motion
        this.blackHoleX += dx * smoothingFactor;
        this.blackHoleY += dy * smoothingFactor;

        // Update velocity for consistency (optional, for future use)
        this.blackHoleDriftVelocityX = dx * smoothingFactor;
        this.blackHoleDriftVelocityY = dy * smoothingFactor;

        // Update DOM black hole position to match canvas position
        this.updateBlackHoleDOMPosition();
    }

    /**
     * Update the DOM black hole element position to match canvas coordinates
     */
    updateBlackHoleDOMPosition() {
        const blackHole = document.getElementById('stellar-black-hole');
        if (!blackHole) return;

        // Hide DOM black hole if using WebGL
        if (this.useWebGL) {
            // Only set this once if possible, but setting it repeatedly is cheap if value doesn't change
            if (blackHole.style.opacity !== '0') {
                blackHole.style.opacity = '0';
                const disk = document.querySelector('.black-hole-accretion-disk');
                if (disk) disk.style.opacity = '0';
            }
            return; // Skip position updates for invisible element
        }

        // Add smooth transition on first setup
        if (!blackHole.dataset.driftInitialized) {
            // Use very slow, linear transition for seamless drift
            blackHole.style.transition = 'left 2s linear, top 2s linear';
            blackHole.dataset.driftInitialized = 'true';
        }

        const { width } = this.canvas;
        const { height } = this.canvas;

        // Convert canvas coordinates to viewport percentages
        const percentX = (this.blackHoleX / width) * 100;
        const percentY = (this.blackHoleY / height) * 100;

        // Apply smooth CSS transform
        blackHole.style.left = `${percentX}%`;
        blackHole.style.top = `${percentY}%`;
        blackHole.style.opacity = '1';
    }

    /**
     * Animate stardust particles with black hole gravity
     */
    animateStardust() {
        const profiling = performanceMonitor?.enabled;
        if (profiling) performanceMonitor.startSection('theme:black-hole:stardust');

        try {
            if (!this.isActive) return;
            if (!this.useWebGL && !this.ctx) return;

            const { width } = this.canvas;
            const { height } = this.canvas;
            const now = performance.now();
            const delta = now - this.lastFrameTime;
            this.lastFrameTime = now;
            this.accumulatedFrameTime += delta;
            this.adjustPerformanceTargets(delta);

            // Smoothly update disk parameters
            this.diskIntensity += (this.diskTargetIntensity - this.diskIntensity) * 0.1;
            this.diskScale += (this.diskTargetScale - this.diskScale) * 0.1;

            // Update black hole drifting position
            this.updateBlackHoleDrift(delta);

            if (this.accumulatedFrameTime >= this.frameInterval * 3) {
                this.accumulatedFrameTime = this.frameInterval * 2;
            }

            // Adaptive frame skipping for very low FPS scenarios
            if (this.accumulatedFrameTime < this.frameInterval) {
                this.animationFrame = requestAnimationFrame(this.boundAnimateStardust);
                return;
            }

            // Cap accumulated time to prevent spiral of death
            const maxFrameSkip = this.frameInterval * 2.5;
            if (this.accumulatedFrameTime > maxFrameSkip) {
                this.accumulatedFrameTime = maxFrameSkip;
            }

            this.accumulatedFrameTime -= this.frameInterval;

            this.processScheduledSpawns(now);

            if (!this.useWebGL && this.ctx) {
                this.ctx.clearRect(0, 0, width, height);
            }

            const { particles } = this;
            let writeIndex = 0;

            // Batch similar operations together and reduce sqrt operations
            const bhX = this.blackHoleX;
            const bhY = this.blackHoleY;
            const bhPullRadius = this.blackHolePullRadius;
            const bhPullRadiusSq = this.blackHolePullRadiusSquared;
            const bhPullStrength = this.blackHolePullStrength;
            const invBhPullRadius = 1 / bhPullRadius;
            const physicsSkipDistSq = this.physicsSkipDistanceSquared;

            // WebGL Optimization: Access TypedArrays directly
            const useWebGL = this.useWebGL && this.webglRenderer;
            let gpuPos, gpuSize, gpuColor, gpuAlpha, gpuBright;
            if (useWebGL) {
                gpuPos = this.webglRenderer.positionData;
                gpuSize = this.webglRenderer.sizeData;
                gpuColor = this.webglRenderer.colorData;
                gpuAlpha = this.webglRenderer.alphaData;
                gpuBright = this.webglRenderer.brightnessData;
            }

            for (let i = 0; i < particles.length; i++) {
                const particle = particles[i];
                if (!particle) {
                    continue;
                }

                if (particle.lifetime !== undefined) {
                    particle.lifetime -= 1;
                    if (particle.lifetime <= 0) {
                        this.releaseParticle(particle);
                        continue;
                    }
                    if (particle.lifetime < 30) {
                        particle.opacity *= 0.95;
                    }
                }

                const dx = bhX - particle.x;
                const dy = bhY - particle.y;
                const distanceSquared = dx * dx + dy * dy;

                // Spatial partitioning: skip expensive physics for distant particles
                if (distanceSquared < physicsSkipDistSq) {
                    // Use squared distance for comparison to avoid sqrt
                    if (distanceSquared < bhPullRadiusSq && distanceSquared > 25) {
                        // Fast inverse square root approximation for distance calculation
                        let distance;
                        if (distanceSquared < 1024) {
                            distance = distanceSquared * this.invSqrtLUT[Math.floor(distanceSquared * 10)] / 10;
                        } else {
                            distance = Math.sqrt(distanceSquared);
                        }

                        const invDistance = 1 / distance;
                        const force = bhPullStrength * (bhPullRadius - distance) * invBhPullRadius;
                        const dirX = dx * invDistance;
                        const dirY = dy * invDistance;

                        particle.speedX += dirX * force * 0.1;
                        particle.speedY += dirY * force * 0.1;

                        if (particle.orbitAngle === undefined) {
                            particle.orbitAngle = Math.atan2(dy, dx);
                            particle.orbitSpeed = this.random(0.01, 0.03);
                        }

                        particle.orbitAngle += particle.orbitSpeed * (1 + force);
                        const tangentX = -dirY;
                        const tangentY = dirX;
                        particle.speedX += tangentX * particle.orbitSpeed * 2;
                        particle.speedY += tangentY * particle.orbitSpeed * 2;

                        particle.speedX *= 0.98;
                        particle.speedY *= 0.98;

                        if (particle.lifetime === undefined) {
                            const proximityFactor = 1 - (distance * invBhPullRadius);
                            particle.opacity = Math.min(0.9, particle.opacity * (1 + proximityFactor * 0.1));
                        }
                    }
                }

                particle.x += particle.speedX;
                particle.y += particle.speedY;

                // Use squared distance for this check too
                if (distanceSquared < 3600) { // 60 * 60
                    if (particle.lifetime !== undefined && !particle.persistent) {
                        this.releaseParticle(particle);
                        continue;
                    }

                    const angle = Math.random() * Math.PI * 2;
                    const dist = this.random(Math.max(width, height) * 0.6, Math.max(width, height) * 0.8);
                    particle.x = bhX + Math.cos(angle) * dist;
                    particle.y = bhY + Math.sin(angle) * dist;
                    particle.speedX = this.random(-0.5, 0.5);
                    particle.speedY = this.random(-0.5, 0.5);
                    particle.opacity = this.random(0.4, 0.9);
                }

                if (particle.x < -50) particle.x = width + 50;
                if (particle.x > width + 50) particle.x = -50;
                if (particle.y < -50) particle.y = height + 50;
                if (particle.y > height + 50) particle.y = -50;

                if (particle.pulse === undefined) {
                    particle.pulse = 0;
                    particle.pulseSpeed = this.random(0.02, 0.05);
                }
                particle.pulse += particle.pulseSpeed;

                // Update WebGL arrays directly
                if (useWebGL && gpuPos) {
                    const i2 = writeIndex * 2;
                    const i3 = writeIndex * 3;
                    gpuPos[i2] = particle.x;
                    gpuPos[i2 + 1] = particle.y;
                    gpuSize[writeIndex] = particle.size;

                    if (particle.color) {
                        gpuColor[i3] = particle.color.r / 255;
                        gpuColor[i3 + 1] = particle.color.g / 255;
                        gpuColor[i3 + 2] = particle.color.b / 255;
                    } else {
                        gpuColor[i3] = 1; gpuColor[i3 + 1] = 1; gpuColor[i3 + 2] = 1;
                    }

                    gpuAlpha[writeIndex] = particle.opacity;
                    gpuBright[writeIndex] = particle.brightness || 0;
                }

                // Render (only if not WebGL)
                if (!useWebGL && this.ctx) {
                    const sprite = this.getParticleSprite(particle.color);
                    if (sprite) {
                        this.ctx.globalAlpha = particle.opacity;
                        // Round coordinates to avoid sub-pixel rendering overhead
                        this.ctx.drawImage(
                            sprite,
                            (particle.x - particle.size * 10) | 0,
                            (particle.y - particle.size * 10) | 0,
                            (particle.size * 20) | 0,
                            (particle.size * 20) | 0,
                        );
                    }
                }

                particles[writeIndex++] = particle;
            }

            particles.length = writeIndex;

            // WebGL Rendering
            if (useWebGL) {
                // Update star flash
                if (this.starFlashIntensity > 0.01) {
                    this.starFlashIntensity *= 0.95; // Decay
                } else {
                    this.starFlashIntensity = 0;
                }
                this.webglRenderer.setStarFlash(this.starFlashIntensity);

                this.webglRenderer.setBlackHoleParams(
                    this.blackHoleX,
                    this.blackHoleY,
                    this.baseRadius * this.blackHoleScale,
                    this.diskIntensity,
                    this.diskScale
                );

                // Pass the filled arrays to the renderer
                // We pass the full arrays but the renderer will only draw 'writeIndex' points
                this.webglRenderer.updateParticles(
                    writeIndex,
                    gpuPos,
                    gpuSize,
                    gpuColor,
                    gpuAlpha,
                    gpuBright
                );
                this.webglRenderer.render(now * 0.001);
            }

            this.animationFrame = requestAnimationFrame(this.boundAnimateStardust);
        } finally {
            if (profiling) performanceMonitor.endSection('theme:black-hole:stardust');
        }
    }

    /**
     * Setup event listeners
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
        console.log('[BlackHole] Line clear:', lineCount);

        const scaledIntensity = this.scaleEffectIntensity(lineCount, 1);
        const allowFullEffects = this.canRunLineEffects();

        if (allowFullEffects) {
            this.brightenNebula(scaledIntensity);
            this.createStarBurst(scaledIntensity);
            this.brightenStars(scaledIntensity);
        }

        this.pulseBlackHole(scaledIntensity);
        this.surgeGravity(scaledIntensity);

        if (allowFullEffects) {
            this.createBlackHoleParticleBurst(scaledIntensity);
        }
    }

    /**
     * React to combos
     */
    onCombo(comboCount) {
        console.log('[BlackHole] Combo:', comboCount);

        const scaledCombo = this.scaleEffectIntensity(comboCount, 1);
        const allowFullEffects = this.canRunComboEffects();

        this.intensifyNebula(scaledCombo);
        this.intensifyBlackHole(scaledCombo);
        this.surgeGravity(scaledCombo * 2);
        this.accelerateAccretionDisk(Math.max(1, Math.round(scaledCombo)));

        if (allowFullEffects && scaledCombo >= 3) {
            this.createGravitationalWave(scaledCombo);
        }

        if (allowFullEffects && (scaledCombo >= 5 || (this.useWebGL && scaledCombo >= 2)) && this.qualityProfile.allowEruptions) {
            this.createParticleEruption(scaledCombo);
        }

        if (allowFullEffects) {
            this.shiftNebulaColors(scaledCombo);
        }
    }

    /**
     * React to piece locks
     */
    onPieceLock(piece) {
        this.triggerLockEffect();
    }

    /**
     * Trigger the visual effect for a piece lock
     */
    triggerLockEffect() {
        // 1. Visual Ripple
        this.createLockRipple();

        // 2. Black Hole Pulse (Sharper than line clear)
        if (this.useWebGL) {
            // Set IMMEDIATE values for instant flash/impact
            this.diskIntensity = 2.5;
            this.diskScale = 1.15;

            // Ensure targets are reset so it decays back to normal
            this.diskTargetIntensity = 1.0;
            this.diskTargetScale = 1.0;
        } else {
            this.pulseBlackHole(0.8); // Stronger pulse for fallback
        }

        // 3. Particle Burst (Hawking Radiation)
        this.createLockParticles();
    }

    /**
     * Create a violet ripple effect
     */
    createLockRipple() {
        const container = document.getElementById('stellar-bursts');
        if (!container) return;

        const ripple = document.createElement('div');
        ripple.className = 'black-hole-lock-ripple';

        // Position at black hole
        const width = this.canvas?.width || window.innerWidth;
        const height = this.canvas?.height || window.innerHeight;
        const percentX = (this.blackHoleX / width) * 100;
        const percentY = (this.blackHoleY / height) * 100;

        ripple.style.left = `${percentX}%`;
        ripple.style.top = `${percentY}%`;

        container.appendChild(ripple);

        setTimeout(() => {
            if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
        }, 1000);
    }

    /**
     * Create a burst of fast particles
     */
    createLockParticles() {
        // Burst of fast, violet/white particles
        const count = this.getScaledCount(20, 40);
        const speedBase = 5;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = this.random(speedBase, speedBase * 2.5);
            const size = this.random(2, 4.5);

            this.addParticle({
                x: this.blackHoleX,
                y: this.blackHoleY,
                size: size,
                speedX: Math.cos(angle) * speed,
                speedY: Math.sin(angle) * speed,
                opacity: 1,
                // Mix of Violet, Cyan, and White
                color: Math.random() > 0.6 ? { r: 180, g: 100, b: 255 } :
                    (Math.random() > 0.5 ? { r: 100, g: 200, b: 255 } : { r: 255, g: 255, b: 255 }),
                pulse: 0,
                pulseSpeed: 0.1,
                lifetime: 45,
                brightness: 2.5 // Very bright
            });
        }
    }

    /**
     * Brighten nebula clouds
     */
    brightenNebula(intensity) {
        const nebulas = document.querySelectorAll('.stellar-nebula-cloud');
        nebulas.forEach((nebula, index) => {
            setTimeout(() => {
                nebula.style.transition = 'filter 0.5s ease-out';
                nebula.style.filter = `brightness(${1 + intensity * 0.25}) saturate(${100 + intensity * 20}%)`;

                setTimeout(() => {
                    nebula.style.filter = '';
                }, 500);
            }, index * 80);
        });
    }

    /**
     * Create star burst effect
     */
    createStarBurst(intensity) {
        const burstContainer = document.getElementById('stellar-bursts');
        if (!burstContainer) return;

        const burstCount = this.getScaledCount(
            Math.min(intensity, this.qualityProfile.starBurstLimit),
            this.qualityProfile.starBurstLimit,
        );

        // Calculate black hole position as percentages
        const width = this.canvas?.width || window.innerWidth;
        const height = this.canvas?.height || window.innerHeight;
        const bhPercentX = (this.blackHoleX / width) * 100;
        const bhPercentY = (this.blackHoleY / height) * 100;

        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => {
                const burst = document.createElement('div');
                burst.className = 'stellar-star-burst';

                // Position bursts near the black hole with some randomness
                const offsetX = this.random(-15, 15);
                const offsetY = this.random(-15, 15);
                burst.style.left = `${bhPercentX + offsetX}%`;
                burst.style.top = `${bhPercentY + offsetY}%`;

                burstContainer.appendChild(burst);

                setTimeout(() => {
                    if (burst.parentNode) {
                        burst.parentNode.removeChild(burst);
                    }
                }, 1500);
            }, i * 200);
        }
    }

    /**
     * Brighten stars
     */
    brightenStars(intensity) {
        if (this.useWebGL) {
            this.starFlashIntensity = Math.min(2.0, this.starFlashIntensity + intensity * 0.5);
            return;
        }

        const starsToBrighten = Math.min(
            Math.max(1, Math.floor(intensity * 15 * this.effectIntensityMultiplier)),
            this.stars.length,
        );

        for (let i = 0; i < starsToBrighten; i++) {
            const star = this.stars[Math.floor(Math.random() * this.stars.length)];
            if (star) {
                const originalOpacity = star.style.opacity;
                star.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
                star.style.opacity = '1';
                star.style.transform = 'scale(1.5)';

                setTimeout(() => {
                    star.style.opacity = originalOpacity;
                    star.style.transform = '';
                }, 300 + Math.random() * 200);
            }
        }
    }

    /**
     * Pulse stardust particles
     */
    pulseStardust(intensity) {
        const total = this.particles.length;
        if (!total) return;

        const boost = 1.1 + 0.4 * this.effectIntensityMultiplier;
        const opacityBoost = 1 + 0.3 * this.effectIntensityMultiplier;
        let coverage = Math.min(1, this.qualityProfile.pulseCoverage);
        if (this.lowPowerMode) {
            coverage = Math.min(coverage, 0.35);
        }
        const targetCount = Math.min(total, Math.max(8, Math.round(total * coverage)));
        const step = Math.max(1, Math.floor(total / targetCount));
        const affected = [];

        for (let i = 0; i < total && affected.length < targetCount; i += step) {
            const particle = this.particles[i];
            if (!particle) continue;
            particle.speedX *= boost;
            particle.speedY *= boost;
            particle.opacity = Math.min(particle.opacity * opacityBoost, 1);
            affected.push(particle);
        }

        const revertDelay = 300 + intensity * 80;
        setTimeout(() => {
            affected.forEach((particle) => {
                if (!particle) return;
                particle.speedX /= boost;
                particle.speedY /= boost;
                particle.opacity = Math.max(particle.opacity / opacityBoost, 0.2);
            });
        }, revertDelay);
    }

    /**
     * Intensify nebula
     */
    intensifyNebula(comboCount) {
        const theme = document.getElementById('stellar-nursery-theme');
        if (!theme) return;

        const brightness = 100 + Math.min(comboCount * 15, 60);
        const saturation = 100 + Math.min(comboCount * 20, 80);

        theme.style.filter = `brightness(${brightness}%) saturate(${saturation}%)`;

        setTimeout(() => {
            theme.style.filter = '';
        }, 1000 + comboCount * 100);
    }

    /**
     * Create supernova effect
     */
    createSupernova(comboCount) {
        const supernovaContainer = document.getElementById('stellar-supernova');
        if (!supernovaContainer) return;

        const supernova = document.createElement('div');
        supernova.className = 'stellar-supernova';

        // Calculate black hole position as percentages
        const width = this.canvas?.width || window.innerWidth;
        const height = this.canvas?.height || window.innerHeight;
        const bhPercentX = (this.blackHoleX / width) * 100;
        const bhPercentY = (this.blackHoleY / height) * 100;

        // Position supernova near the black hole with some randomness
        const offsetX = this.random(-10, 10);
        const offsetY = this.random(-10, 10);
        supernova.style.left = `${bhPercentX + offsetX}%`;
        supernova.style.top = `${bhPercentY + offsetY}%`;
        supernova.style.setProperty('--supernova-intensity', Math.min(comboCount, 5));

        supernovaContainer.appendChild(supernova);

        setTimeout(() => {
            if (supernova.parentNode) {
                supernova.parentNode.removeChild(supernova);
            }
        }, 2500);
    }

    /**
     * Shift nebula colors
     */
    shiftNebulaColors(comboCount) {
        const nebulas = document.querySelectorAll('.stellar-nebula-cloud');
        nebulas.forEach((nebula, index) => {
            const hueShift = (comboCount * 10) % 360;

            setTimeout(() => {
                nebula.style.transition = 'filter 1s ease-out';
                nebula.style.filter = `hue-rotate(${hueShift}deg)`;

                setTimeout(() => {
                    nebula.style.filter = '';
                }, 1000);
            }, index * 100);
        });
    }

    /**
     * Create small particle burst
     */
    createSmallParticleBurst() {
        // Add a few temporary fast-moving particles
        const count = this.getScaledCount(5, this.qualityProfile.smallBurstLimit);
        for (let i = 0; i < count; i++) {
            this.addParticle({
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
                size: this.random(1, 2),
                speedX: this.random(-2, 2),
                speedY: this.random(-2, 2),
                opacity: 0.8,
                color: this.getNebulaColor(),
                pulse: 0,
                pulseSpeed: 0.05,
                lifetime: 30,
            });
        }
    }

    /**
     * Pulse black hole on line clear
     */
    pulseBlackHole(intensity) {
        const blackHole = document.getElementById('stellar-black-hole');
        if (!blackHole) return;

        blackHole.style.transition = 'transform 0.4s ease-out, filter 0.4s ease-out';
        blackHole.style.transform = `scale(${1 + intensity * 0.05})`;
        blackHole.style.filter = `brightness(${1 + intensity * 0.1})`;

        if (this.useWebGL) {
            this.diskTargetScale = 1.0 + intensity * 0.1;
            this.diskTargetIntensity = 1.0 + intensity * 0.2;
            this.blackHoleScale = 1.0 + intensity * 0.05;
        }

        setTimeout(() => {
            blackHole.style.transform = '';
            blackHole.style.filter = '';
            if (this.useWebGL) {
                this.diskTargetScale = 1.0;
                this.diskTargetIntensity = 1.0;
                this.blackHoleScale = 1.0;
            }
        }, 400);
    }

    /**
     * Intensify black hole on combo
     */
    intensifyBlackHole(comboCount) {
        const accretionDisk = document.querySelector('.black-hole-accretion-disk');
        const accretionGlow = document.querySelector('.black-hole-accretion-glow');

        if (accretionDisk) {
            accretionDisk.style.transition = 'opacity 0.6s ease-out, filter 0.6s ease-out';
            accretionDisk.style.opacity = Math.min(1, 0.6 + comboCount * 0.1);
            accretionDisk.style.filter = `blur(3px) brightness(${1 + comboCount * 0.15})`;

            setTimeout(() => {
                accretionDisk.style.opacity = '';
                accretionDisk.style.filter = '';
            }, 600 + comboCount * 100);
        }

        if (accretionGlow) {
            accretionGlow.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
            accretionGlow.style.opacity = Math.min(1, 0.6 + comboCount * 0.1);
            accretionGlow.style.transform = `scale(${1 + comboCount * 0.05})`;

            setTimeout(() => {
                accretionGlow.style.opacity = '';
                accretionGlow.style.transform = '';
            }, 600 + comboCount * 100);
        }

        if (this.useWebGL) {
            this.diskTargetIntensity = 1.0 + comboCount * 0.3;
            this.diskTargetScale = 1.0 + comboCount * 0.1;

            setTimeout(() => {
                this.diskTargetIntensity = 1.0;
                this.diskTargetScale = 1.0;
            }, 600 + comboCount * 100);
        }
    }

    /**
     * Surge gravity temporarily
     */
    surgeGravity(intensity) {
        // Cancel any existing gravity animation
        if (this.gravityAnimationFrame) {
            cancelAnimationFrame(this.gravityAnimationFrame);
        }

        const baseStrength = this.baseBlackHolePullStrength;
        const baseRadius = this.baseBlackHolePullRadius;

        // Calculate target values
        const targetStrength = baseStrength * (1 + intensity * 0.3);
        const targetRadius = baseRadius * (1 + intensity * 0.1);

        // Store start values and time
        const startStrength = this.blackHolePullStrength;
        const startRadius = this.blackHolePullRadius;
        const startTime = performance.now();
        const surgeUpDuration = 300; // 300ms to surge up
        const holdDuration = 800 + intensity * 100; // Hold at peak
        const slowDownDuration = 1500; // 1.5s to slowly return to normal

        const animateGravity = (currentTime) => {
            const elapsed = currentTime - startTime;

            if (elapsed < surgeUpDuration) {
                // Surge up phase (fast)
                const progress = elapsed / surgeUpDuration;
                const eased = this.easeOutQuad(progress);
                this.blackHolePullStrength = startStrength + (targetStrength - startStrength) * eased;
                this.blackHolePullRadius = startRadius + (targetRadius - startRadius) * eased;
                this.gravityAnimationFrame = requestAnimationFrame(animateGravity);
            } else if (elapsed < surgeUpDuration + holdDuration) {
                // Hold at peak
                this.blackHolePullStrength = targetStrength;
                this.blackHolePullRadius = targetRadius;
                this.gravityAnimationFrame = requestAnimationFrame(animateGravity);
            } else if (elapsed < surgeUpDuration + holdDuration + slowDownDuration) {
                // Slow down phase (gradual)
                const progress = (elapsed - surgeUpDuration - holdDuration) / slowDownDuration;
                const eased = this.easeInOutCubic(progress);
                this.blackHolePullStrength = targetStrength + (baseStrength - targetStrength) * eased;
                this.blackHolePullRadius = targetRadius + (baseRadius - targetRadius) * eased;
                this.gravityAnimationFrame = requestAnimationFrame(animateGravity);
            } else {
                // Animation complete - return to base values
                this.blackHolePullStrength = baseStrength;
                this.blackHolePullRadius = baseRadius;
                this.gravityAnimationFrame = null;
            }
        };

        this.gravityAnimationFrame = requestAnimationFrame(animateGravity);
    }

    // Easing functions
    easeOutQuad(t) {
        return t * (2 - t);
    }

    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    }

    /**
     * Create particle burst from black hole
     */
    createBlackHoleParticleBurst(intensity) {
        const burstCount = this.getScaledCount(
            Math.min(intensity * 10, this.qualityProfile.comboBurstLimit),
            this.qualityProfile.comboBurstLimit,
        );

        const speedScale = 0.8 + this.effectIntensityMultiplier * 0.5;
        for (let i = 0; i < burstCount; i++) {
            const angle = (Math.PI * 2 * i) / burstCount;
            const speed = this.random(2, 5) * speedScale;

            this.addParticle({
                x: this.blackHoleX,
                y: this.blackHoleY,
                size: this.random(2.5, 5.0),
                speedX: Math.cos(angle) * speed,
                speedY: Math.sin(angle) * speed,
                opacity: this.random(0.6, 1),
                color: this.getNebulaColor(),
                pulse: this.random(0, Math.PI * 2),
                pulseSpeed: this.random(0.02, 0.05),
                orbitAngle: angle,
                orbitSpeed: this.random(0.01, 0.03),
                lifetime: 60, // Will fade out
                brightness: 1.5,
            });
        }
    }

    /**
     * Accelerate accretion disk rotation - Optimized with requestAnimationFrame
     */
    accelerateAccretionDisk(comboCount) {
        const disk = document.querySelector('.black-hole-accretion-disk');
        if (!disk) return;

        // Cancel any existing disk animation
        if (this.diskAnimationTimeout) {
            clearTimeout(this.diskAnimationTimeout);
            this.diskAnimationTimeout = null;
        }
        if (this.diskSlowdownTimeout) {
            clearTimeout(this.diskSlowdownTimeout);
            this.diskSlowdownTimeout = null;
        }

        const normalDuration = 20; // 20s normal rotation
        const fastDuration = Math.max(5, normalDuration - comboCount * 2);

        // Use will-change to hint browser about animation
        disk.style.willChange = 'animation-duration';

        // Quick acceleration to fast speed
        disk.style.transition = 'animation-duration 0.3s ease-out';
        disk.style.animationDuration = `${fastDuration}s`;

        // Hold at fast speed
        this.diskAnimationTimeout = setTimeout(() => {
            // Gradual slowdown back to normal
            disk.style.transition = 'animation-duration 2s ease-in-out';
            disk.style.animationDuration = `${normalDuration}s`;

            // Clear transition after slowdown completes
            this.diskSlowdownTimeout = setTimeout(() => {
                disk.style.transition = '';
                disk.style.willChange = 'auto';
                this.diskAnimationTimeout = null;
                this.diskSlowdownTimeout = null;
            }, 2000);
        }, 1000 + comboCount * 150); // Hold for longer on bigger combos
    }

    /**
     * Create gravitational wave effect
     */
    createGravitationalWave(comboCount) {
        const waveContainer = document.getElementById('stellar-bursts');
        if (!waveContainer) return;

        const waveCount = Math.min(
            Math.max(1, Math.floor(comboCount - 2)),
            3,
        );
        if (waveCount <= 0) return;

        // Calculate black hole position as percentages
        const width = this.canvas?.width || window.innerWidth;
        const height = this.canvas?.height || window.innerHeight;
        const percentX = (this.blackHoleX / width) * 100;
        const percentY = (this.blackHoleY / height) * 100;

        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => {
                const wave = document.createElement('div');
                wave.className = 'gravitational-wave';
                // Position waves at the black hole's current location
                wave.style.left = `${percentX}%`;
                wave.style.top = `${percentY}%`;
                wave.style.setProperty('--wave-delay', `${i * 0.2}s`);

                waveContainer.appendChild(wave);

                setTimeout(() => {
                    if (wave.parentNode) {
                        wave.parentNode.removeChild(wave);
                    }
                }, 2000);
            }, i * 300);
        }
    }

    /**
     * Create massive particle eruption (Relativistic Jets)
     */
    createParticleEruption(comboCount) {
        if (!this.qualityProfile.allowEruptions) {
            return;
        }

        // Much higher count for WebGL
        const baseLimit = this.useWebGL ? this.qualityProfile.eruptionLimit * 3 : this.qualityProfile.eruptionLimit;

        const eruptionCount = this.getScaledCount(
            Math.min(comboCount * (this.useWebGL ? 50 : 12), baseLimit),
            baseLimit,
        );

        if (eruptionCount <= 0) {
            return;
        }

        const startTime = performance.now();
        // Faster emission
        const spacing = Math.max(2, 10 - this.effectIntensityMultiplier * 5);

        // Jet direction (random angle)
        const jetAngle = Math.random() * Math.PI * 2;
        const jetSpread = 0.4; // Narrow cone

        for (let i = 0; i < eruptionCount; i++) {
            const spawnTime = startTime + i * spacing;

            this.scheduleParticleSpawn(spawnTime, (index, total) => {
                // Two opposing jets
                const isOpposite = Math.random() > 0.5;
                const baseAngle = isOpposite ? jetAngle + Math.PI : jetAngle;
                const angle = baseAngle + (Math.random() - 0.5) * jetSpread;

                const speed = this.random(5, 15) * (1 + comboCount * 0.1); // High speed
                const distance = 10; // Start near center

                return {
                    x: this.blackHoleX + Math.cos(angle) * distance,
                    y: this.blackHoleY + Math.sin(angle) * distance,
                    size: this.random(4.0, 7.0),
                    speedX: Math.cos(angle) * speed,
                    speedY: Math.sin(angle) * speed,
                    opacity: 1.0,
                    color: isOpposite ? { r: 100, g: 200, b: 255 } : { r: 255, g: 100, b: 100 }, // Blue and Red jets (Doppler effect)
                    pulse: 0,
                    pulseSpeed: 0.1,
                    orbitAngle: angle,
                    orbitSpeed: 0,
                    lifetime: 100,
                    brightness: 2.0, // Glow boost
                };
            });
        }

        // Shockwave ring
        if (comboCount >= 2) {
            const ringCount = Math.min(comboCount * 20, 200);
            for (let i = 0; i < ringCount; i++) {
                const angle = (Math.PI * 2 * i) / ringCount;
                const speed = 3 + comboCount * 0.5;

                this.scheduleParticleSpawn(startTime, () => ({
                    x: this.blackHoleX,
                    y: this.blackHoleY,
                    size: this.random(2.0, 4.5),
                    speedX: Math.cos(angle) * speed,
                    speedY: Math.sin(angle) * speed,
                    opacity: 0.8,
                    color: { r: 200, g: 100, b: 255 },
                    lifetime: 80,
                    brightness: 0.5,
                }));
            }
        }
    }

    drawParticle(ctx, particle) {
        if (!particle || !ctx || !particle.color) {
            return;
        }

        if (!isFinite(particle.x) || !isFinite(particle.y) || !isFinite(particle.size) || particle.size <= 0) {
            return;
        }

        const { r, g, b } = particle.color;
        const baseOpacity = isFinite(particle.opacity) ? particle.opacity : 0;

        // LOD: Skip very dim particles for performance
        if (baseOpacity < 0.1) {
            return;
        }

        const pulse = particle.pulse || 0;
        const pulseOpacity = Math.max(0, Math.min(1, baseOpacity + Math.sin(pulse) * 0.2));

        // Calculate distance from black hole for LOD
        const dx = this.blackHoleX - particle.x;
        const dy = this.blackHoleY - particle.y;
        const distSq = dx * dx + dy * dy;
        const pullRadiusSq = this.blackHolePullRadiusSquared;

        // LOD: Determine detail level based on distance and size
        let lodLevel = 0; // 0 = highest detail, 2 = lowest
        if (distSq > pullRadiusSq * 4) {
            lodLevel = 2; // Far away - lowest detail
        } else if (distSq > pullRadiusSq * 2) {
            lodLevel = 1; // Medium distance - medium detail
        }

        // Draw sprite with LOD-adjusted size
        const sprite = this.getParticleSprite(particle.color);
        if (!sprite) {
            return;
        }

        let sizeFactor;
        if (lodLevel === 2) {
            sizeFactor = this.lowPowerMode ? 2 : 2.5; // Smallest
        } else if (lodLevel === 1) {
            sizeFactor = this.lowPowerMode ? 2.5 : 3; // Medium
        } else {
            sizeFactor = this.lowPowerMode ? 3 : 4; // Largest
        }

        const drawSize = particle.size * sizeFactor;
        if (drawSize <= 0) {
            return;
        }
        const halfSize = drawSize / 2;
        ctx.globalAlpha = pulseOpacity;
        ctx.drawImage(sprite, particle.x - halfSize, particle.y - halfSize, drawSize, drawSize);

        // LOD: Only draw trails for high-detail particles (close to black hole)
        const detailFactor = this.trailDetailFactor ?? 1;
        if (lodLevel === 0 && detailFactor > 0.2 && (this.trailRenderThrottle++ % 3 === 0)) {
            const speedX = isFinite(particle.speedX) ? particle.speedX : 0;
            const speedY = isFinite(particle.speedY) ? particle.speedY : 0;
            const speedSquared = speedX * speedX + speedY * speedY;

            // Only draw trails for fast-moving particles (avoid sqrt)
            if (speedSquared > 4) { // speed > 2
                const speed = Math.sqrt(speedSquared);
                const trailLength = Math.min(speed * 3, 10);

                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${pulseOpacity * 0.3})`;
                ctx.lineWidth = particle.size * 0.5 * detailFactor;
                ctx.beginPath();
                ctx.moveTo(particle.x - speedX * trailLength, particle.y - speedY * trailLength);
                ctx.lineTo(particle.x, particle.y);
                ctx.stroke();
            }
        }

        ctx.globalAlpha = 1;
    }

    getParticleSprite(color) {
        if (!color) {
            return null;
        }
        const key = `${color.r},${color.g},${color.b}`;

        // Check cache first
        const cached = this.particleSpriteCache.get(key);
        if (cached) {
            return cached;
        }

        // Create new sprite with optimized settings
        const spriteSize = 48; // Reduced from 64 for better performance
        const offscreen = document.createElement('canvas');
        offscreen.width = spriteSize;
        offscreen.height = spriteSize;
        const spriteCtx = offscreen.getContext('2d', { alpha: true, willReadFrequently: false });
        if (!spriteCtx) {
            return null;
        }

        const halfSize = spriteSize / 2;
        const gradient = spriteCtx.createRadialGradient(
            halfSize,
            halfSize,
            spriteSize / 8,
            halfSize,
            halfSize,
            halfSize,
        );
        gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 1)`);
        gradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`);
        gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);

        spriteCtx.fillStyle = gradient;
        spriteCtx.beginPath();
        spriteCtx.arc(halfSize, halfSize, halfSize, 0, Math.PI * 2);
        spriteCtx.fill();

        this.particleSpriteCache.set(key, offscreen);
        return offscreen;
    }

    addParticle(particle, options = {}) {
        if (!particle) {
            return;
        }
        const { persistent = false } = options;
        const budget = this.dynamicParticleBudget || this.maxParticles;
        if (this.particles.length >= budget && !persistent) {
            return;
        }
        const pooled = this.obtainParticle(particle);
        if (persistent) {
            pooled.persistent = true;
        } else {
            pooled.persistent = false;
        }
        this.particles.push(pooled);
        if (this.particles.length > budget) {
            this.cullParticlesToBudget(budget);
        }
    }

    cullParticlesToBudget(limit = this.dynamicParticleBudget || this.maxParticles) {
        let excess = this.particles.length - limit;
        if (excess <= 0) {
            return;
        }
        for (let i = this.particles.length - 1; i >= 0 && excess > 0; i--) {
            const candidate = this.particles[i];
            if (candidate && !candidate.persistent) {
                this.particles.splice(i, 1);
                this.releaseParticle(candidate);
                excess--;
            }
        }
        if (this.particles.length > limit) {
            this.particles.length = limit;
        }
    }

    processScheduledSpawns(currentTime) {
        if (!this.pendingParticleSpawns.length) {
            return;
        }

        const remaining = [];
        for (let i = 0; i < this.pendingParticleSpawns.length; i++) {
            const spawn = this.pendingParticleSpawns[i];
            if (!spawn) {
                continue;
            }

            if (spawn.time <= currentTime) {
                const budget = this.dynamicParticleBudget || this.maxParticles;
                if (this.particles.length >= budget) {
                    // PERFORMANCE FIX: Don't accumulate old spawns forever
                    // If spawn is more than 5 seconds old, drop it instead of keeping it
                    const age = currentTime - spawn.time;
                    if (age < 5000) { // Only keep spawns less than 5 seconds old
                        remaining.push(spawn);
                    }
                    continue;
                }
                const count = spawn.count || 1;
                for (let j = 0; j < count; j++) {
                    if (this.particles.length >= budget) {
                        break;
                    }
                    const particle = spawn.factory ? spawn.factory(j, count) : null;
                    if (particle) {
                        this.addParticle(particle, spawn.options);
                    }
                }
            } else {
                remaining.push(spawn);
            }
        }
        this.pendingParticleSpawns = remaining;
    }

    scheduleParticleSpawn(time, factory, options = {}, count = 1) {
        if (!factory || typeof factory !== 'function') {
            return;
        }

        // PERFORMANCE FIX: Limit pending spawns to prevent unbounded growth
        // Drop oldest spawns if queue gets too large
        const MAX_PENDING_SPAWNS = 200;
        if (this.pendingParticleSpawns.length >= MAX_PENDING_SPAWNS) {
            this.pendingParticleSpawns.shift(); // Remove oldest
        }

        this.pendingParticleSpawns.push({
            time, factory, options, count,
        });
    }

    handleResize() {
        if (!this.canvas) {
            return;
        }
        const displayWidth = window.innerWidth;
        const displayHeight = window.innerHeight;
        const scaledWidth = Math.max(1, Math.round(displayWidth * (this.renderScale ?? 1)));
        const scaledHeight = Math.max(1, Math.round(displayHeight * (this.renderScale ?? 1)));
        if (this.canvas.width !== scaledWidth || this.canvas.height !== scaledHeight) {
            this.canvas.width = scaledWidth;
            this.canvas.height = scaledHeight;
            if (this.ctx) {
                this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
            if (this.useWebGL && this.webglRenderer) {
                this.webglRenderer.resize(scaledWidth, scaledHeight);
            }
        }
        this.canvas.style.width = `${displayWidth}px`;
        this.canvas.style.height = `${displayHeight}px`;

        // Initialize black hole position (starting point)
        this.blackHoleX = scaledWidth * 0.35;
        this.blackHoleY = scaledHeight * 0.5;

        // Set initial drift target to a nearby position for smooth start
        const marginX = scaledWidth * 0.15;
        const marginY = scaledHeight * 0.15;
        const minX = marginX;
        const maxX = scaledWidth - marginX;
        const minY = marginY;
        const maxY = scaledHeight - marginY;

        this.blackHoleTargetX = minX + Math.random() * (maxX - minX);
        this.blackHoleTargetY = minY + Math.random() * (maxY - minY);

        // Update DOM position immediately
        this.updateBlackHoleDOMPosition();
    }

    stop() {
        // Cancel animation frames
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        if (this.starAnimationFrame) {
            cancelAnimationFrame(this.starAnimationFrame);
            this.starAnimationFrame = null;
        }
        if (this.resizeAttached) {
            window.removeEventListener('resize', this.handleResize);
            this.resizeAttached = false;
        }

        // Detach settings listener
        this.detachSettingsListener();

        this.particles.forEach((particle) => {
            if (!particle) return;
            particle.persistent = false;
            this.releaseParticle(particle);
        });
        this.particles = [];

        // Clean up canvas stars
        if (this.canvasStars) {
            this.canvasStars = null;
        }
        if (this.starCanvas) {
            this.starCanvas = null;
        }
        if (this.starCtx) {
            this.starCtx = null;
        }

        // Cancel gravity animation
        if (this.gravityAnimationFrame) {
            cancelAnimationFrame(this.gravityAnimationFrame);
            this.gravityAnimationFrame = null;
        }

        // Clear disk animation timeouts
        if (this.diskAnimationTimeout) {
            clearTimeout(this.diskAnimationTimeout);
            this.diskAnimationTimeout = null;
        }
        if (this.diskSlowdownTimeout) {
            clearTimeout(this.diskSlowdownTimeout);
            this.diskSlowdownTimeout = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Clear data
        this.stars = [];
        this.particles = [];
        this.canvas = null;
        this.ctx = null;
        this.particleSpriteCache.clear();
        this.blackHolePullRadius = this.baseBlackHolePullRadius;
        this.blackHolePullStrength = this.baseBlackHolePullStrength;
        this.pendingParticleSpawns = [];

        // Clear any active effects
        const theme = document.getElementById('stellar-nursery-theme');
        if (theme) {
            theme.style.filter = '';
        }

        super.stop();
    }

    /**
     * Provide Black Hole themed tetromino styling (gravity stretched colors)
     * @returns {Object} Black Hole tetromino configuration
     */
    getTetrominoConfig() {
        return BLACK_HOLE_TETROMINOS;
    }

    obtainParticle(props) {
        let particle;
        if (this.particlePool.length > 0) {
            particle = this.particlePool.pop();
            // Reuse existing object, just update properties
            Object.assign(particle, props);
        } else {
            // Create new particle object
            particle = { ...props };
        }
        particle.active = true;
        return particle;
    }

    releaseParticle(particle) {
        if (!particle || particle.persistent) return;

        // Mark as inactive and return to pool
        particle.active = false;
        particle.lifetime = undefined;

        // Maintain reasonable pool size
        const poolLimit = Math.min(this.maxParticles * 1.5, 1000);
        if (this.particlePool.length < poolLimit) {
            this.particlePool.push(particle);
        }
    }
}
