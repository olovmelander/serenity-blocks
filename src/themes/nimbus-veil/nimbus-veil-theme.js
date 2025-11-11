import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

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

        // Canvas elements
        this.canvas = null;
        this.ctx = null;

        // Performance optimizations
        this.colorCache = new Map();
        this.offscreenCanvas = null; // For pre-rendering clouds
        this.offscreenCtx = null;
        this.needsRedraw = true; // Flag to track if clouds need re-rendering
        this.frameSkip = 0; // Skip frames for performance
        this.updateCounter = 0; // Counter for selective updates
        this.cachedSinCos = { sin: 0, cos: 0 }; // Cache trig values

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
     */
    async start(webglRenderer, resources) {
        await super.start(webglRenderer, resources);

        await this.createScene();
        this.startAnimation();
    }

    /**
     * Create the cloud scene
     */
    async createScene() {
        console.log('[Nimbus Veil] Creating scene...');

        try {
            // Create floating cloud particles
            this.createCloudParticles();

            // Create mist overlay
            this.createMistParticles();

            // Setup canvas for particle effects
            this.createCloudCanvas();

            // Setup event listeners for reactive effects
            this.setupEventListeners();

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
    createCloudParticles() {
        const colors = this.getCloudColors();

        // Create 11 cloud particles - large, dynamic, visually stunning
        for (let i = 0; i < 11; i++) {
            const baseSize = Math.random() * 120 + 50; // Much larger clouds (50-170px)
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
                // Subtle morphing properties for gentle size changes
                morphSpeed: Math.random() * 0.004 + 0.002, // Slower morphing (was 0.01-0.025)
                morphTimer: Math.random() * 10, // Start at random point in morph cycle
                swayAmplitude: Math.random() * 0.35 + 0.2, // Much more sway
                swaySpeed: Math.random() * 0.02 + 0.015 // Faster sway
            });
        }
    }

    /**
     * Create mist/fog particles for depth
     */
    createMistParticles() {
        // Create 7 larger mist particles for enhanced background depth
        for (let i = 0; i < 7; i++) {
            const baseSize = Math.random() * 200 + 100; // Bigger mist (100-300px)
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
                // Subtle morphing properties
                morphSpeed: Math.random() * 0.003 + 0.001, // Slower morphing (was 0.006-0.018)
                morphTimer: Math.random() * 10,
                swayAmplitude: Math.random() * 0.25 + 0.12, // More sway
                swaySpeed: Math.random() * 0.015 + 0.008 // Faster sway
            });
        }

        // Create 30 small moving particles (highly optimized)
        for (let i = 0; i < 30; i++) {
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
            desynchronized: true // Performance optimization
        });

        console.log('[Nimbus Veil] Canvas initialized:', this.canvas.width, 'x', this.canvas.height);
    }

    /**
     * Main animation loop (optimized for smoothness)
     */
    startAnimation() {
        const animate = (currentTime) => {
            if (!this.isActive) return;

            // Calculate delta time
            const deltaTime = currentTime - this.lastFrameTime;
            this.lastFrameTime = currentTime;

            // Accumulate elapsed time (smoother than Date.now())
            this.elapsedTime += deltaTime * 0.001; // Convert to seconds

            // Update and render every frame (let GPU handle it)
            this.updateParticles(deltaTime);
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

        // Update wind only every 3 frames
        if (this.updateCounter % 3 === 0) {
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

        // Lightning (ultra rare)
        if (this.updateCounter % 30 === 0 && Math.random() < 0.0005) {
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

        // Update trig cache only every 2 frames
        if (this.updateCounter % 2 === 0) {
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

            // Subtle morphing for gentle size changes
            particle.morphTimer += particle.morphSpeed;
            if (particle.morphTimer > 1) {
                particle.morphTimer = 0;
                particle.targetSize = particle.baseSize * (0.9 + Math.random() * 0.2); // 90%-110% size variation (was 75%-125%)
            }

            particle.size += (particle.targetSize - particle.size) * 0.015; // Slower, smoother transitions (was 0.03)

            // Movement
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

            particle.morphTimer += particle.morphSpeed;
            if (particle.morphTimer > 1) {
                particle.morphTimer = 0;
                particle.targetSize = particle.baseSize * (0.9 + Math.random() * 0.2); // 90%-110% size variation (was 70%-130%)
            }

            particle.size += (particle.targetSize - particle.size) * 0.012; // Slower, smoother transitions (was 0.025)

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
    }

    /**
     * Render particles to canvas (smooth & optimized)
     */
    renderCanvas() {
        if (!this.ctx) return;

        // Render at 20 FPS (every 3rd frame for performance)
        this.frameSkip++;
        if (this.frameSkip % 3 !== 0) {
            return;
        }

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw lightning flashes (behind clouds)
        if (this.lightningFlashes.length > 0) {
            this.ctx.save();
            this.ctx.globalAlpha = this.lightningFlashes[0].opacity * 0.15;
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
        }

        // Batch render mist with same blur value (reduced filter changes)
        this.ctx.save();
        this.ctx.filter = 'blur(50px)'; // Fixed blur for all mist (reduced for performance)
        this.ctx.fillStyle = '#ffffff';

        // Draw all mist particles in one batch
        for (let i = 0; i < this.mistParticles.length; i++) {
            const particle = this.mistParticles[i];
            if (particle.currentOpacity < 0.01) continue;

            this.ctx.globalAlpha = particle.currentOpacity;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, 6.28318); // Use constant for 2π
            this.ctx.fill();
        }
        this.ctx.restore();

        // Batch render clouds with fixed blur (major performance boost)
        this.ctx.save();
        this.ctx.filter = 'blur(35px)'; // Fixed blur for all clouds (softer, more ethereal)

        // Group clouds by color for fewer state changes
        const whiteColor = 'rgba(255, 255, 255, 0.9)';
        this.ctx.fillStyle = whiteColor;

        for (let i = 0; i < this.cloudParticles.length; i++) {
            const particle = this.cloudParticles[i];
            if (particle.currentOpacity < 0.01) continue;

            this.ctx.globalAlpha = particle.currentOpacity;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, 6.28318);
            this.ctx.fill();
        }
        this.ctx.restore();

        // Draw moving particles (no blur, ultra-fast batch render)
        this.ctx.save();
        this.ctx.filter = 'none';
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
    }

    /**
     * Create a lightning flash effect
     */
    createLightningFlash() {
        this.lightningFlashes.push({
            age: 0,
            duration: 0.15 + Math.random() * 0.1, // 0.15-0.25 seconds
            opacity: 1
        });

        console.log('[Nimbus Veil] Lightning flash!');

        // Sometimes create a double flash
        if (Math.random() < 0.3) {
            setTimeout(() => {
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
     * React to combo events
     */
    onCombo(comboCount) {
        if (comboCount >= 3) {
            this.createCloudWave(comboCount);
        }

        // Speed up drift temporarily
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
    }

    /**
     * React to piece lock events
     */
    onPieceLock(piece) {
        // 30% chance to create a small cloud puff
        if (Math.random() < 0.3) {
            this.createCloudPuff();
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
     */
    createCloudWave(comboCount) {
        const wavesContainer = document.getElementById('nimbus-veil-waves');
        if (!wavesContainer) return;

        const waveCount = Math.min(comboCount - 2, 3);

        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => {
                const wave = document.createElement('div');
                wave.className = 'nimbus-veil-wave';
                wavesContainer.appendChild(wave);

                setTimeout(() => {
                    wave.remove();
                }, 3000);
            }, i * 200);
        }
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

        // Clear cache
        this.colorCache.clear();
    }
}
