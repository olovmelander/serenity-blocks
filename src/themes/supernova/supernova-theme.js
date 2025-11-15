import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class SupernovaTheme extends BaseTheme {
    constructor() {
        super('supernova');
        this.eventUnsubscribers = [];
        this.stars = [];
        this.shockwaveParticles = [];
        this.animationFrame = null;
        this.canvas = null;
        this.ctx = null;

        // Performance optimization
        this.lastFrameTime = 0;
        this.targetFrameTime = 1000 / 60; // 60 FPS
        this.particleRenderBatch = 10; // Render particles in batches

        // Pre-compute color cache
        this.colorCache = new Map();

        // Effect state tracking for smooth transitions
        this.activeEffectTimeout = null;
        this.currentBrightness = 100;
        this.currentSaturation = 100;

        // Drift state for slow screen movement
        this.driftAngle = 0;
        this.driftSpeed = 0.0005; // Very slow drift (radians per frame) - about 2 minutes per cycle
        this.driftRadius = 0; // Will be set based on screen size
        this.driftX = 0;
        this.driftY = 0;
        this.baseCenterX = 0;
        this.baseCenterY = 0;
    }

    async createScene() {
        console.log('[Supernova] Creating scene...');

        try {
            // Create background stars
            this.createStars();

            // Create expanding shockwave particles using canvas
            this.createShockwaveCanvas();

            // Create energy rays
            this.createEnergyRays();

            // Create pulsing core filaments
            this.createCoreFilaments();

            // Setup event listeners for reactive effects
            this.setupEventListeners();

            console.log('[Supernova] Scene created successfully!');
        } catch (error) {
            console.error('[Supernova] Error in createScene():', error);
            throw error;
        }
    }

    /**
     * Create background stars
     */
    createStars() {
        const starsContainer = document.getElementById('supernova-stars');
        if (!starsContainer || starsContainer.children.length > 0) return;

        const fragment = document.createDocumentFragment();
        const starCount = 100; // Reduced from 150 for performance

        // Define star color palette matching the supernova theme
        const starColors = [
            'rgba(255, 255, 255, 1)',      // White
            'rgba(100, 220, 255, 1)',      // Bright cyan
            'rgba(150, 100, 255, 1)',      // Electric purple
            'rgba(255, 80, 220, 1)',       // Hot pink
            'rgba(255, 150, 100, 1)',      // Orange
            'rgba(255, 200, 80, 1)',       // Golden yellow
            'rgba(80, 255, 200, 1)',       // Turquoise
            'rgba(180, 150, 255, 1)',      // Lavender
        ];

        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'supernova-star';
            const size = this.random(0.5, 2);
            const isBright = Math.random() < 0.15; // 15% chance of bright star

            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${this.random(0, 100)}%`;
            star.style.top = `${this.random(0, 100)}%`;
            star.style.backgroundColor = starColors[Math.floor(Math.random() * starColors.length)];
            star.style.opacity = `${this.random(0.4, 0.9).toFixed(2)}`;
            star.style.animationDelay = `${this.random(0, 5)}s`;

            if (isBright) {
                star.classList.add('supernova-star-bright');
                star.style.boxShadow = `0 0 ${size * 3}px ${star.style.backgroundColor}`;
            }

            fragment.appendChild(star);
            this.stars.push(star);
        }

        starsContainer.appendChild(fragment);
        this.registerContainer(starsContainer);
    }

    /**
     * Create shockwave particles using canvas for better performance
     */
    createShockwaveCanvas() {
        this.canvas = document.getElementById('supernova-shockwave-canvas');
        if (!this.canvas) {
            console.warn('[Supernova] Shockwave canvas not found!');
            return;
        }

        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        this.ctx = this.canvas.getContext('2d', {
            alpha: true,
            desynchronized: true // Enable async rendering
        });

        // Initialize shockwave particles - Reduced for performance
        const particleCount = 250; // Reduced from 350
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // Initialize drift parameters
        this.baseCenterX = centerX;
        this.baseCenterY = centerY;
        this.driftRadius = Math.min(this.canvas.width, this.canvas.height) * 0.30; // 30% of smaller dimension for large screen coverage

        // Supernova color palette - vibrant explosion colors
        const colors = [
            { r: 100, g: 220, b: 255 },   // Bright cyan (core)
            { r: 80, g: 180, b: 255 },    // Cyan-blue
            { r: 150, g: 100, b: 255 },   // Electric purple
            { r: 255, g: 80, b: 220 },    // Hot pink
            { r: 255, g: 100, b: 150 },   // Pink-red
            { r: 255, g: 150, b: 100 },   // Orange
            { r: 255, g: 200, b: 80 },    // Golden yellow
            { r: 180, g: 150, b: 255 },   // Lavender
        ];

        for (let i = 0; i < particleCount; i++) {
            const angle = this.random(0, Math.PI * 2);
            const distance = this.random(50, 400);
            const expansionSpeed = this.random(0.1, 0.4);
            const size = this.random(1.5, 3.5);
            const opacity = this.random(0.35, 0.75);

            // Color based on distance - blue center, magenta outer
            const colorIndex = Math.floor((distance / 400) * colors.length);
            const color = colors[Math.min(colorIndex, colors.length - 1)];

            this.shockwaveParticles.push({
                angle,
                distance,
                maxDistance: this.random(300, 500),
                expansionSpeed,
                size,
                opacity,
                baseOpacity: opacity,
                color,
                pulse: this.random(0, Math.PI * 2),
                pulseSpeed: this.random(0.02, 0.05),
                // Orbital motion for turbulence
                orbitAngle: this.random(0, Math.PI * 2),
                orbitSpeed: this.random(-0.01, 0.01),
                turbulence: this.random(0.5, 2),
            });
        }

        // Start animation
        this.animateShockwave(this.canvas, this.ctx, centerX, centerY);
    }

    /**
     * Animate shockwave particles - OPTIMIZED
     */
    animateShockwave(canvas, ctx, centerX, centerY) {
        if (!this.isActive) return;

        // Frame throttling for performance
        const now = performance.now();
        const deltaTime = now - this.lastFrameTime;

        if (deltaTime < this.targetFrameTime) {
            this.animationFrame = requestAnimationFrame(() =>
                this.animateShockwave(canvas, ctx, centerX, centerY)
            );
            return;
        }

        this.lastFrameTime = now - (deltaTime % this.targetFrameTime);

        // Update drift - creates a slow figure-8 pattern
        this.driftAngle += this.driftSpeed;
        this.driftX = Math.cos(this.driftAngle) * this.driftRadius;
        this.driftY = Math.sin(this.driftAngle * 2) * this.driftRadius * 0.5; // Half amplitude on Y for figure-8

        // Update DOM element positions to follow the drift
        this.updateDriftPositions();

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Remove expired combo particles
        this.shockwaveParticles = this.shockwaveParticles.filter(particle => {
            if (particle.isComboParticle) {
                particle.lifetime += deltaTime;
                return particle.lifetime < particle.maxLifetime;
            }
            return true; // Keep non-combo particles
        });

        // Batch particle updates and renders
        const particleCount = this.shockwaveParticles.length;

        for (let i = 0; i < particleCount; i++) {
            const particle = this.shockwaveParticles[i];

            // Expand outward
            particle.distance += particle.expansionSpeed;

            // Add turbulence/orbital motion
            particle.orbitAngle += particle.orbitSpeed;
            const turbulenceX = Math.cos(particle.orbitAngle) * particle.turbulence;
            const turbulenceY = Math.sin(particle.orbitAngle) * particle.turbulence;

            // Update pulse
            particle.pulse += particle.pulseSpeed;

            // Reset if particle goes beyond max distance
            if (particle.distance > particle.maxDistance) {
                particle.distance = this.random(30, 80);
                particle.opacity = particle.baseOpacity;
            }

            // Fade out as it expands
            const fadeStart = particle.maxDistance * 0.7;
            if (particle.distance > fadeStart) {
                const fadeProgress = (particle.distance - fadeStart) / (particle.maxDistance - fadeStart);
                particle.opacity = particle.baseOpacity * (1 - fadeProgress);
            }

            // Fade out combo particles based on lifetime
            if (particle.isComboParticle) {
                const lifetimeProgress = particle.lifetime / particle.maxLifetime;
                // Start fading at 70% of lifetime
                if (lifetimeProgress > 0.7) {
                    const fadeOutProgress = (lifetimeProgress - 0.7) / 0.3;
                    particle.opacity *= (1 - fadeOutProgress);
                }
            }

            // Calculate position with turbulence (canvas itself is drifting)
            const x = centerX + Math.cos(particle.angle) * particle.distance + turbulenceX;
            const y = centerY + Math.sin(particle.angle) * particle.distance + turbulenceY;

            // Calculate pulsing opacity
            const pulseOpacity = Math.max(0, particle.opacity + Math.sin(particle.pulse) * 0.15);

            // Skip particles that are too dim (optimization)
            if (pulseOpacity < 0.05) continue;

            // Cache color string for better performance
            const { r, g, b } = particle.color;
            const colorKey = `${r}-${g}-${b}`;

            if (!this.colorCache.has(colorKey)) {
                const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, particle.size * 2.5);
                gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
                gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.5)`);
                gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
                this.colorCache.set(colorKey, gradient);
            }

            // Draw particle with cached gradient
            ctx.save();
            ctx.translate(x, y);
            ctx.globalAlpha = pulseOpacity;
            ctx.fillStyle = this.colorCache.get(colorKey);
            ctx.beginPath();
            ctx.arc(0, 0, particle.size * 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        this.animationFrame = requestAnimationFrame(() =>
            this.animateShockwave(canvas, ctx, centerX, centerY)
        );
    }

    /**
     * Update positions of DOM elements to follow the drift
     */
    updateDriftPositions() {
        // Apply drift using CSS translate property for all elements (consistent approach)
        const starsContainer = document.getElementById('supernova-stars');
        if (starsContainer) {
            starsContainer.style.translate = `${this.driftX}px ${this.driftY}px`;
        }

        const core = document.querySelector('.supernova-core');
        if (core) {
            core.style.translate = `${this.driftX}px ${this.driftY}px`;
        }

        const shell = document.querySelector('.supernova-shell');
        if (shell) {
            shell.style.translate = `${this.driftX}px ${this.driftY}px`;
        }

        const canvas = document.getElementById('supernova-shockwave-canvas');
        if (canvas) {
            canvas.style.translate = `${this.driftX}px ${this.driftY}px`;
        }

        const raysContainer = document.getElementById('supernova-rays');
        if (raysContainer) {
            raysContainer.style.translate = `${this.driftX}px ${this.driftY}px`;
        }

        const filamentsContainer = document.getElementById('supernova-filaments');
        if (filamentsContainer) {
            filamentsContainer.style.translate = `${this.driftX}px ${this.driftY}px`;
        }

        const pulsesContainer = document.getElementById('supernova-pulses');
        if (pulsesContainer) {
            pulsesContainer.style.translate = `${this.driftX}px ${this.driftY}px`;
        }

        const burstsContainer = document.getElementById('supernova-bursts');
        if (burstsContainer) {
            burstsContainer.style.translate = `${this.driftX}px ${this.driftY}px`;
        }

        const explosionsContainer = document.getElementById('supernova-explosions');
        if (explosionsContainer) {
            explosionsContainer.style.translate = `${this.driftX}px ${this.driftY}px`;
        }
    }

    /**
     * Create energy rays radiating from core
     */
    createEnergyRays() {
        const rayContainer = document.getElementById('supernova-rays');
        if (!rayContainer) return;

        // Create 10 major energy rays (reduced from 12 for performance)
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 10; i++) {
            const ray = document.createElement('div');
            ray.className = 'supernova-ray';

            const angle = (i * 36) + this.random(-10, 10);
            const length = this.random(300, 600);
            const width = this.random(60, 120);
            const duration = this.random(5, 10);

            ray.style.setProperty('--ray-angle', `${angle}deg`);
            ray.style.setProperty('--ray-length', `${length}px`);
            ray.style.setProperty('--ray-width', `${width}px`);
            ray.style.setProperty('--ray-duration', `${duration}s`);
            ray.style.animationDelay = `${this.random(0, 4)}s`;

            fragment.appendChild(ray);
        }

        rayContainer.appendChild(fragment);
        this.registerContainer(rayContainer);
    }

    /**
     * Create pulsing filaments in the core
     */
    createCoreFilaments() {
        const filamentContainer = document.getElementById('supernova-filaments');
        if (!filamentContainer) return;

        const fragment = document.createDocumentFragment();
        const filamentCount = 15; // Reduced from 18 for performance

        for (let i = 0; i < filamentCount; i++) {
            const filament = document.createElement('div');
            filament.className = 'supernova-filament';

            const angle = (i * 24) + this.random(-10, 10);
            const length = this.random(80, 150);
            const duration = this.random(3, 6);

            filament.style.setProperty('--filament-angle', `${angle}deg`);
            filament.style.setProperty('--filament-length', `${length}px`);
            filament.style.setProperty('--filament-duration', `${duration}s`);
            filament.style.animationDelay = `${this.random(0, 3)}s`;

            fragment.appendChild(filament);
        }

        filamentContainer.appendChild(fragment);
        this.registerContainer(filamentContainer);
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
        console.log('[Supernova] Line clear:', lineCount);

        // Brighten core
        this.brightenCore(lineCount);

        // Create shockwave pulse
        this.createShockwavePulse(lineCount);

        // Brighten stars
        this.brightenStars(lineCount);

        // Pulse rays
        this.pulseRays(lineCount);
    }

    /**
     * React to combos
     */
    onCombo(comboCount) {
        console.log('[Supernova] Combo:', comboCount);

        // Intensify supernova
        this.intensifySupernova(comboCount);

        // Create energy burst for big combos
        if (comboCount >= 3) {
            this.createEnergyBurst(comboCount);
        }

        // Super explosion for massive combos
        if (comboCount >= 5) {
            this.createSuperExplosion(comboCount);
        }
    }

    /**
     * React to piece locks
     */
    onPieceLock(piece) {
        // Subtle particle pulse
        if (Math.random() < 0.3) {
            this.pulseShockwaveParticles();
        }
    }

    /**
     * Brighten supernova core on line clear
     */
    brightenCore(intensity) {
        const core = document.querySelector('.supernova-core');
        if (!core) return;

        const originalFilter = core.style.filter;
        const originalScale = core.style.scale;
        core.style.transition = 'filter 0.4s ease-out, scale 0.4s ease-out';
        core.style.filter = `brightness(${1 + intensity * 0.4}) saturate(${100 + intensity * 30}%)`;
        // Use scale property (separate from transform) to preserve both animation and drift
        core.style.scale = `${1 + intensity * 0.08}`;

        setTimeout(() => {
            core.style.filter = originalFilter;
            core.style.scale = originalScale;
        }, 400);
    }

    /**
     * Create shockwave pulse effect
     */
    createShockwavePulse(intensity) {
        const pulseContainer = document.getElementById('supernova-pulses');
        if (!pulseContainer) return;

        const pulseCount = Math.min(intensity, 3);

        for (let i = 0; i < pulseCount; i++) {
            setTimeout(() => {
                const pulse = document.createElement('div');
                pulse.className = 'supernova-pulse';

                const duration = 1.5 + this.random(0, 0.5);
                pulse.style.animationDuration = `${duration}s`;
                pulse.style.animationDelay = `${i * 0.15}s`;

                pulseContainer.appendChild(pulse);

                setTimeout(() => {
                    if (pulse.parentNode) {
                        pulse.parentNode.removeChild(pulse);
                    }
                }, (duration + i * 0.15) * 1000);
            }, i * 200);
        }
    }

    /**
     * Brighten stars
     */
    brightenStars(intensity) {
        const starsToBrighten = Math.min(Math.floor(intensity * 10), this.stars.length);

        for (let i = 0; i < starsToBrighten; i++) {
            const star = this.stars[Math.floor(Math.random() * this.stars.length)];
            if (star) {
                const originalOpacity = star.style.opacity;
                const originalTransform = star.style.transform;
                star.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
                star.style.opacity = '1';
                star.style.transform = 'scale(1.5)';

                setTimeout(() => {
                    star.style.opacity = originalOpacity;
                    star.style.transform = originalTransform;
                }, 300 + Math.random() * 200);
            }
        }
    }

    /**
     * Pulse energy rays
     */
    pulseRays(intensity) {
        const rays = document.querySelectorAll('.supernova-ray');
        rays.forEach((ray, index) => {
            setTimeout(() => {
                ray.style.transition = 'opacity 0.4s ease-out, filter 0.4s ease-out';
                ray.style.opacity = '1';
                ray.style.filter = `brightness(${1 + intensity * 0.3})`;

                setTimeout(() => {
                    ray.style.opacity = '';
                    ray.style.filter = '';
                }, 400);
            }, index * 50);
        });
    }

    /**
     * Intensify supernova
     */
    intensifySupernova(comboCount) {
        const theme = document.getElementById('supernova-theme');
        if (!theme) return;

        // Clear any existing timeout
        if (this.activeEffectTimeout) {
            clearTimeout(this.activeEffectTimeout);
            this.activeEffectTimeout = null;
        }

        // Calculate new target values (accumulate but cap)
        const targetBrightness = Math.min(this.currentBrightness + comboCount * 15, 170);
        const targetSaturation = Math.min(this.currentSaturation + comboCount * 25, 200);

        this.currentBrightness = targetBrightness;
        this.currentSaturation = targetSaturation;

        // Apply the effect with smooth transition
        theme.style.transition = 'filter 0.3s ease-out';
        theme.style.filter = `brightness(${this.currentBrightness}%) saturate(${this.currentSaturation}%)`;

        // Gradually fade back to normal
        this.activeEffectTimeout = setTimeout(() => {
            this.fadeBackToNormal(theme);
        }, 800 + comboCount * 100);
    }

    /**
     * Gradually fade effects back to normal state
     */
    fadeBackToNormal(theme) {
        if (!theme) return;

        // Smoothly transition back to normal
        theme.style.transition = 'filter 1.5s ease-in-out';
        theme.style.filter = 'brightness(100%) saturate(100%)';

        // Reset internal state
        this.currentBrightness = 100;
        this.currentSaturation = 100;

        // Clear the timeout reference
        this.activeEffectTimeout = null;
    }

    /**
     * Create energy burst effect
     */
    createEnergyBurst(comboCount) {
        const burstContainer = document.getElementById('supernova-bursts');
        if (!burstContainer) return;

        const burstCount = Math.min(comboCount - 2, 4);

        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => {
                const burst = document.createElement('div');
                burst.className = 'supernova-burst';

                const angle = this.random(0, 360);
                const duration = 1.2 + this.random(0, 0.8);

                burst.style.setProperty('--burst-angle', `${angle}deg`);
                burst.style.animationDuration = `${duration}s`;

                burstContainer.appendChild(burst);

                setTimeout(() => {
                    if (burst.parentNode) {
                        burst.parentNode.removeChild(burst);
                    }
                }, duration * 1000);
            }, i * 300);
        }
    }

    /**
     * Create super explosion effect for massive combos
     */
    createSuperExplosion(comboCount) {
        const explosionContainer = document.getElementById('supernova-explosions');
        if (!explosionContainer) return;

        const explosion = document.createElement('div');
        explosion.className = 'supernova-super-explosion';

        explosion.style.setProperty('--explosion-intensity', Math.min(comboCount, 8));

        explosionContainer.appendChild(explosion);

        // Add extra shockwave particles
        this.createExplosionParticles(comboCount);

        setTimeout(() => {
            if (explosion.parentNode) {
                explosion.parentNode.removeChild(explosion);
            }
        }, 2000);
    }

    /**
     * Create explosion particles for super explosions
     */
    createExplosionParticles(intensity) {
        const particleCount = Math.min(intensity * 8, 50);

        const colors = [
            { r: 100, g: 220, b: 255 },   // Bright cyan
            { r: 150, g: 100, b: 255 },   // Electric purple
            { r: 255, g: 80, b: 220 },    // Hot pink
            { r: 255, g: 150, b: 100 },   // Orange
            { r: 255, g: 200, b: 80 },    // Golden yellow
            { r: 80, g: 255, b: 200 },    // Turquoise
        ];

        for (let i = 0; i < particleCount; i++) {
            const angle = this.random(0, Math.PI * 2);
            const speed = this.random(2, 6);
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.shockwaveParticles.push({
                angle,
                distance: this.random(50, 100),
                maxDistance: this.random(400, 600),
                expansionSpeed: speed,
                size: this.random(2, 5),
                opacity: 0.9,
                baseOpacity: 0.9,
                color,
                pulse: this.random(0, Math.PI * 2),
                pulseSpeed: this.random(0.03, 0.06),
                orbitAngle: this.random(0, Math.PI * 2),
                orbitSpeed: this.random(-0.02, 0.02),
                turbulence: this.random(1, 3),
                isComboParticle: true, // Mark as temporary combo particle
                lifetime: 0, // Track how long this particle has existed
                maxLifetime: 3000, // Remove after 3 seconds
            });
        }
    }

    /**
     * Pulse shockwave particles
     */
    pulseShockwaveParticles() {
        this.shockwaveParticles.forEach(particle => {
            particle.baseOpacity = Math.min(particle.baseOpacity * 1.3, 1);

            setTimeout(() => {
                particle.baseOpacity = particle.opacity;
            }, 300);
        });
    }

    stop() {
        // Cancel animation frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Clear any active effect timeouts
        if (this.activeEffectTimeout) {
            clearTimeout(this.activeEffectTimeout);
            this.activeEffectTimeout = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Clear particles
        this.shockwaveParticles = [];
        this.stars = [];

        // Clear canvas references
        this.canvas = null;
        this.ctx = null;

        // Clear color cache to prevent memory leaks
        this.colorCache.clear();

        // Reset performance tracking
        this.lastFrameTime = 0;

        // Reset effect state
        this.currentBrightness = 100;
        this.currentSaturation = 100;

        // Reset drift state
        this.driftAngle = 0;
        this.driftX = 0;
        this.driftY = 0;
        this.baseCenterX = 0;
        this.baseCenterY = 0;
        this.driftRadius = 0;

        // Clear any active effects
        const theme = document.getElementById('supernova-theme');
        if (theme) {
            theme.style.filter = '';
            theme.style.transition = '';
        }

        // Clear drift transforms from all elements
        const core = document.querySelector('.supernova-core');
        if (core) {
            core.style.translate = '';
            core.style.scale = '';
        }

        const shell = document.querySelector('.supernova-shell');
        if (shell) {
            shell.style.translate = '';
        }

        const containers = [
            'supernova-stars',
            'supernova-shockwave-canvas',
            'supernova-rays',
            'supernova-filaments',
            'supernova-pulses',
            'supernova-bursts',
            'supernova-explosions'
        ];

        containers.forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                container.style.translate = '';
            }
        });

        super.stop();
    }
}
