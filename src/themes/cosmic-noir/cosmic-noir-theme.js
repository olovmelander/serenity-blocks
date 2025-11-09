import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

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

        // Performance optimization
        this.lastFrameTime = 0;
        this.targetFrameTime = 1000 / 60; // 60 FPS
        this.colorCache = new Map();
    }

    async createScene() {
        console.log('[Cosmic Noir] Creating scene...');

        try {
            // Create background stars
            this.createStars();

            // Create drifting galaxy particles
            this.createGalaxyCanvas();

            // Setup event listeners for reactive effects
            this.setupEventListeners();

            console.log('[Cosmic Noir] Scene created successfully!');
        } catch (error) {
            console.error('[Cosmic Noir] Error in createScene():', error);
            throw error;
        }
    }

    /**
     * Create background stars with varying brightness
     */
    createStars() {
        const starsContainer = document.getElementById('cosmic-noir-stars');
        if (!starsContainer || starsContainer.children.length > 0) return;

        const fragment = document.createDocumentFragment();
        const starCount = 120;

        // Grayscale palette - pure monochrome
        const starColors = [
            'rgba(255, 255, 255, 1)',      // Bright white
            'rgba(230, 230, 230, 1)',      // Light gray
            'rgba(200, 200, 200, 1)',      // Medium gray
            'rgba(180, 180, 180, 1)',      // Gray
            'rgba(160, 160, 160, 1)',      // Darker gray
        ];

        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'cosmic-noir-star';
            const size = this.random(0.5, 2.5);
            const isBright = Math.random() < 0.2; // 20% chance of bright star

            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${this.random(0, 100)}%`;
            star.style.top = `${this.random(0, 100)}%`;
            star.style.backgroundColor = starColors[Math.floor(Math.random() * starColors.length)];
            star.style.opacity = `${this.random(0.3, 0.95).toFixed(2)}`;
            star.style.animationDelay = `${this.random(0, 5)}s`;

            if (isBright) {
                star.classList.add('cosmic-noir-star-bright');
                star.style.boxShadow = `0 0 ${size * 4}px rgba(255, 255, 255, 0.8)`;
            }

            fragment.appendChild(star);
            this.stars.push(star);
        }

        starsContainer.appendChild(fragment);
        this.registerContainer(starsContainer);
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
            desynchronized: true
        });

        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // Create galaxy drift particles (200 particles)
        for (let i = 0; i < 200; i++) {
            const angle = this.random(0, Math.PI * 2);
            const distance = this.random(100, 600);
            const brightness = Math.floor(this.random(120, 255));

            this.galaxyParticles.push({
                angle,
                distance,
                driftSpeed: this.random(0.0005, 0.002),
                orbitSpeed: this.random(-0.0003, 0.0003),
                size: this.random(1, 3),
                opacity: this.random(0.2, 0.7),
                baseOpacity: this.random(0.2, 0.7),
                brightness,
                pulse: this.random(0, Math.PI * 2),
                pulseSpeed: this.random(0.01, 0.03),
            });
        }

        // Create dust/grain particles (100 smaller particles)
        for (let i = 0; i < 100; i++) {
            this.dustParticles.push({
                x: this.random(0, this.canvas.width),
                y: this.random(0, this.canvas.height),
                vx: this.random(-0.3, 0.3),
                vy: this.random(-0.3, 0.3),
                size: this.random(0.5, 1.5),
                opacity: this.random(0.15, 0.4),
                brightness: Math.floor(this.random(150, 220)),
            });
        }

        // Start animation
        this.animateGalaxy(centerX, centerY);
    }

    /**
     * Animate galaxy drift and dust particles - OPTIMIZED
     */
    animateGalaxy(centerX, centerY) {
        if (!this.isActive) return;

        const now = performance.now();
        const deltaTime = now - this.lastFrameTime;

        if (deltaTime < this.targetFrameTime) {
            this.animationFrame = requestAnimationFrame(() =>
                this.animateGalaxy(centerX, centerY)
            );
            return;
        }

        this.lastFrameTime = now - (deltaTime % this.targetFrameTime);

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw galaxy particles
        for (let i = 0; i < this.galaxyParticles.length; i++) {
            const particle = this.galaxyParticles[i];

            // Drift outward slowly
            particle.distance += particle.driftSpeed;

            // Orbital motion for galaxy swirl effect
            particle.angle += particle.orbitSpeed;

            // Pulse animation
            particle.pulse += particle.pulseSpeed;

            // Reset if too far
            if (particle.distance > 700) {
                particle.distance = this.random(100, 200);
                particle.angle = this.random(0, Math.PI * 2);
            }

            // Calculate position
            const x = centerX + Math.cos(particle.angle) * particle.distance;
            const y = centerY + Math.sin(particle.angle) * particle.distance;

            // Calculate pulsing opacity
            const pulseOpacity = Math.max(0, particle.baseOpacity + Math.sin(particle.pulse) * 0.15);

            // Skip very dim particles
            if (pulseOpacity < 0.05) continue;

            // Draw particle with gradient
            const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, particle.size * 2);
            gradient.addColorStop(0, `rgba(${particle.brightness}, ${particle.brightness}, ${particle.brightness}, ${pulseOpacity})`);
            gradient.addColorStop(0.5, `rgba(${particle.brightness}, ${particle.brightness}, ${particle.brightness}, ${pulseOpacity * 0.5})`);
            gradient.addColorStop(1, `rgba(${particle.brightness}, ${particle.brightness}, ${particle.brightness}, 0)`);

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(x, y, particle.size * 2, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw dust/grain particles
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

        this.animationFrame = requestAnimationFrame(() =>
            this.animateGalaxy(centerX, centerY)
        );
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
        const starsToBrighten = Math.min(Math.floor(intensity * 12), this.stars.length);

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
     * Create galaxy pulse effect
     */
    createGalaxyPulse(intensity) {
        const pulseContainer = document.getElementById('cosmic-noir-pulses');
        if (!pulseContainer) return;

        const pulse = document.createElement('div');
        pulse.className = 'cosmic-noir-pulse';
        pulse.style.setProperty('--pulse-intensity', intensity);

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
        this.galaxyParticles.forEach(particle => {
            particle.driftSpeed *= (1 + intensity * 0.2);

            setTimeout(() => {
                particle.driftSpeed /= (1 + intensity * 0.2);
            }, 800);
        });
    }

    /**
     * Intensify galaxy brightness
     */
    intensifyGalaxy(comboCount) {
        const theme = document.getElementById('cosmic-noir-theme');
        if (!theme) return;

        const brightness = 100 + Math.min(comboCount * 12, 60);
        theme.style.filter = `brightness(${brightness}%) contrast(${100 + comboCount * 8}%)`;

        setTimeout(() => {
            theme.style.filter = '';
        }, 1000 + comboCount * 100);
    }

    /**
     * Create galaxy wave effect
     */
    createGalaxyWave(comboCount) {
        const waveContainer = document.getElementById('cosmic-noir-waves');
        if (!waveContainer) return;

        for (let i = 0; i < Math.min(comboCount - 2, 3); i++) {
            setTimeout(() => {
                const wave = document.createElement('div');
                wave.className = 'cosmic-noir-wave';
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
        this.galaxyParticles.forEach(particle => {
            particle.baseOpacity = Math.min(particle.baseOpacity * 1.2, 1);

            setTimeout(() => {
                particle.baseOpacity /= 1.2;
            }, 200);
        });
    }

    stop() {
        // Cancel animation frame
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Clear particles
        this.galaxyParticles = [];
        this.dustParticles = [];
        this.stars = [];

        // Clear canvas references
        this.canvas = null;
        this.ctx = null;

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
}
