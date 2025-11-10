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
        this.targetFrameTime = 1000 / 60; // 60 FPS
        this.animationFrame = null;

        // Cloud particles
        this.cloudParticles = [];
        this.mistParticles = [];
        this.movingParticles = []; // Small moving particles

        // Canvas elements
        this.canvas = null;
        this.ctx = null;

        // Color cache for performance
        this.colorCache = new Map();

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

        // Create 35 cloud particles - balanced visibility
        for (let i = 0; i < 35; i++) {
            const baseSize = Math.random() * 60 + 25;
            this.cloudParticles.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                size: baseSize,
                baseSize: baseSize, // Store original size
                targetSize: baseSize, // Target size for morphing
                opacity: Math.random() * 0.35 + 0.2, // 0.2-0.55 (more visible)
                color: colors[Math.floor(Math.random() * colors.length)],
                speedX: Math.random() * 0.4 + 0.15, // Faster horizontal drift
                speedY: (Math.random() - 0.5) * 0.15, // More vertical drift
                blur: Math.random() * 35 + 25, // 25-60px blur
                pulseSpeed: Math.random() * 0.02 + 0.01,
                pulseOffset: Math.random() * Math.PI * 2,
                // Morphing properties
                morphSpeed: Math.random() * 0.01 + 0.005,
                morphTimer: Math.random() * 10, // Start at random point in morph cycle
                swayAmplitude: Math.random() * 0.2 + 0.1, // How much to sway
                swaySpeed: Math.random() * 0.015 + 0.01
            });
        }
    }

    /**
     * Create mist/fog particles for depth
     */
    createMistParticles() {
        // Create 20 larger mist particles for background depth
        for (let i = 0; i < 20; i++) {
            const baseSize = Math.random() * 160 + 70;
            this.mistParticles.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                size: baseSize,
                baseSize: baseSize,
                targetSize: baseSize,
                opacity: Math.random() * 0.12 + 0.04, // 0.04-0.16 (more visible)
                speedX: Math.random() * 0.25 + 0.1, // Faster horizontal drift
                speedY: (Math.random() - 0.5) * 0.1, // More vertical drift
                blur: Math.random() * 65 + 55, // 55-120px heavy blur
                pulseSpeed: Math.random() * 0.015 + 0.005,
                pulseOffset: Math.random() * Math.PI * 2,
                // Morphing properties
                morphSpeed: Math.random() * 0.008 + 0.004,
                morphTimer: Math.random() * 10,
                swayAmplitude: Math.random() * 0.15 + 0.08,
                swaySpeed: Math.random() * 0.01 + 0.005
            });
        }

        // Create 120 small moving particles
        for (let i = 0; i < 120; i++) {
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
     * Main animation loop
     */
    startAnimation() {
        const animate = (currentTime) => {
            if (!this.isActive) return;

            // Throttle to target FPS
            const deltaTime = currentTime - this.lastFrameTime;
            if (deltaTime < this.targetFrameTime) {
                this.animationFrame = requestAnimationFrame(animate);
                return;
            }

            this.lastFrameTime = currentTime;

            // Update and render
            this.updateParticles(deltaTime);
            this.renderCanvas();

            this.animationFrame = requestAnimationFrame(animate);
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    /**
     * Update particle positions and states
     */
    updateParticles(deltaTime) {
        const time = Date.now() / 1000;
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Update cloud particles
        this.cloudParticles.forEach(particle => {
            // Morphing timer
            particle.morphTimer += particle.morphSpeed;

            // Every ~5-10 seconds, change target size
            if (particle.morphTimer > 1) {
                particle.morphTimer = 0;
                // New target size: grow or shrink by 30-70%
                const sizeMultiplier = Math.random() * 0.4 + 0.8; // 0.8-1.2x
                particle.targetSize = particle.baseSize * sizeMultiplier;
            }

            // Smoothly morph towards target size
            const sizeDiff = particle.targetSize - particle.size;
            particle.size += sizeDiff * 0.02; // Smooth interpolation

            // Add organic sway to movement
            const swayX = Math.sin(time * particle.swaySpeed) * particle.swayAmplitude;
            const swayY = Math.cos(time * particle.swaySpeed * 0.8) * particle.swayAmplitude * 0.5;

            // Drift movement with sway
            particle.x += particle.speedX + swayX;
            particle.y += particle.speedY + swayY;

            // Wrap around screen
            if (particle.x > width + particle.size) {
                particle.x = -particle.size;
            }
            if (particle.y > height + particle.size) {
                particle.y = -particle.size;
            } else if (particle.y < -particle.size) {
                particle.y = height + particle.size;
            }

            // Pulse opacity
            const basePulse = Math.sin(time * particle.pulseSpeed + particle.pulseOffset);
            particle.currentOpacity = particle.opacity * (0.8 + basePulse * 0.2);
        });

        // Update mist particles
        this.mistParticles.forEach(particle => {
            // Morphing timer
            particle.morphTimer += particle.morphSpeed;

            // Every ~8-15 seconds, change target size (slower than clouds)
            if (particle.morphTimer > 1) {
                particle.morphTimer = 0;
                // New target size: grow or shrink more dramatically for mist
                const sizeMultiplier = Math.random() * 0.5 + 0.75; // 0.75-1.25x
                particle.targetSize = particle.baseSize * sizeMultiplier;
            }

            // Smoothly morph towards target size
            const sizeDiff = particle.targetSize - particle.size;
            particle.size += sizeDiff * 0.015; // Slower interpolation for mist

            // Add organic sway to movement
            const swayX = Math.sin(time * particle.swaySpeed) * particle.swayAmplitude;
            const swayY = Math.cos(time * particle.swaySpeed * 0.7) * particle.swayAmplitude * 0.6;

            // Drift movement with sway
            particle.x += particle.speedX + swayX;
            particle.y += particle.speedY + swayY;

            // Wrap around
            if (particle.x > width + particle.size) {
                particle.x = -particle.size;
            }
            if (particle.y > height + particle.size) {
                particle.y = -particle.size;
            } else if (particle.y < -particle.size) {
                particle.y = height + particle.size;
            }

            // Pulse
            const basePulse = Math.sin(time * particle.pulseSpeed + particle.pulseOffset);
            particle.currentOpacity = particle.opacity * (0.7 + basePulse * 0.3);
        });

        // Update moving particles
        this.movingParticles.forEach(particle => {
            particle.x += particle.speedX;
            particle.y += particle.speedY;

            // Wrap around screen
            if (particle.x > width) {
                particle.x = 0;
            } else if (particle.x < 0) {
                particle.x = width;
            }
            if (particle.y > height) {
                particle.y = 0;
            } else if (particle.y < 0) {
                particle.y = height;
            }

            // Twinkle effect
            const twinkle = Math.sin(time * particle.twinkleSpeed + particle.twinkleOffset);
            particle.currentOpacity = particle.opacity * (0.5 + twinkle * 0.5);
        });
    }

    /**
     * Render particles to canvas
     */
    renderCanvas() {
        if (!this.ctx) return;

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw mist layer (background)
        this.mistParticles.forEach(particle => {
            if (particle.currentOpacity < 0.01) return;

            this.ctx.save();
            this.ctx.filter = `blur(${particle.blur}px)`;
            this.ctx.globalAlpha = particle.currentOpacity;
            this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';

            this.ctx.beginPath();
            this.ctx.arc(
                particle.x,
                particle.y,
                particle.size,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
            this.ctx.restore();
        });

        // Draw cloud particles (middle layer)
        this.cloudParticles.forEach(particle => {
            if (particle.currentOpacity < 0.01) return;

            this.ctx.save();
            this.ctx.filter = `blur(${particle.blur}px)`;
            this.ctx.globalAlpha = particle.currentOpacity;
            this.ctx.fillStyle = particle.color;

            this.ctx.beginPath();
            this.ctx.arc(
                particle.x,
                particle.y,
                particle.size,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
            this.ctx.restore();
        });

        // Draw moving particles (foreground - no blur for crisp movement)
        this.ctx.save();
        this.ctx.filter = 'none';
        this.movingParticles.forEach(particle => {
            if (particle.currentOpacity < 0.05) return;

            this.ctx.globalAlpha = particle.currentOpacity;
            this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';

            this.ctx.beginPath();
            this.ctx.arc(
                particle.x,
                particle.y,
                particle.size,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
        });
        this.ctx.restore();
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
