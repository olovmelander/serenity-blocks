/**
 * Stellar Velocity Theme - Warp drive starfield effect
 *
 * Features:
 * - Dynamic 3D starfield with depth simulation
 * - Stars accelerating toward viewer (warp drive effect)
 * - Multiple star layers with varying speeds
 * - Spectacular combo effects with star bursts
 * - Interactive speed changes based on game events
 * - Tunnel vision effect during high combos
 * - Color transitions through deep space palettes
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { STELLAR_VELOCITY_TETROMINOS } from './stellar-velocity-tetrominos.js';

export default class StellarVelocityTheme extends BaseTheme {
    constructor() {
        super('stellar-velocity');

        this.canvas = null;
        this.ctx = null;
        this.stars = [];
        this.animationFrameId = null;
        this.eventUnsubscribers = [];

        // Warp drive configuration - EXTREMELY slow by default
        this.baseSpeed = 0.03; // Ultra-slow peaceful drift
        this.currentSpeed = this.baseSpeed;
        this.targetSpeed = this.baseSpeed;
        this.maxSpeed = 12.0; // Much higher max speed for intense warp
        this.acceleration = 0.05; // Faster acceleration for snappier response

        // Star field settings
        this.numStars = 1800; // Many more stars for immersive feeling
        this.numBackgroundStars = 1200; // Many more background stars for depth
        this.backgroundStars = [];
        this.fov = 250; // Wider FOV for gentler perspective
        this.targetFov = 250;
        this.centerX = 0;
        this.centerY = 0;

        // Tunnel effect - ABSOLUTE MAXIMUM to cover beyond screen edges
        this.tunnelRadius = 1500; // Extends beyond viewport for complete coverage
        this.targetTunnelRadius = 1500;

        // Color scheme
        this.currentColorScheme = 0;
        this.colorSchemes = [
            {
                name: 'classic', star: '#FFFFFF', trail: 'rgba(255, 255, 255, 0.5)', bg: '#000000',
            },
            {
                name: 'nebula', star: '#00FFFF', trail: 'rgba(0, 255, 255, 0.5)', bg: '#000510',
            },
            {
                name: 'solar', star: '#FFD700', trail: 'rgba(255, 215, 0, 0.5)', bg: '#001020',
            },
            {
                name: 'aurora', star: '#00FF88', trail: 'rgba(0, 255, 136, 0.5)', bg: '#000815',
            },
            {
                name: 'crimson', star: '#FF4466', trail: 'rgba(255, 68, 102, 0.5)', bg: '#100005',
            },
        ];
        this.colorCycleInterval = null;

        // Effects state
        this.comboMultiplier = 1.0;
        this.burstStars = [];
        this.maxBurstStars = 200;

        // Star trail effect
        this.showTrails = true;
        this.trailLength = 0.15;
        this.trailOpacity = 0.3; // Subtle trails at slow speed

        console.log('[StellarVelocity] Constructor called');
    }

    async init() {
        console.log('[StellarVelocity] Initializing theme');
    }

    /**
     * Get tetromino visual configuration for this theme
     */
    getTetrominoConfig() {
        return STELLAR_VELOCITY_TETROMINOS;
    }

    async createScene() {
        console.log('[StellarVelocity] createScene() called');

        try {
            // Create canvas for starfield
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'stellar-velocity-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.backgroundColor = this.getCurrentColorScheme().bg;

            console.log('[StellarVelocity] Canvas element created with ID:', this.canvas.id);

            // Get 2D context
            this.ctx = this.canvas.getContext('2d');

            // Set canvas size
            this.resize(window.innerWidth, window.innerHeight);

            // Get the theme container and add canvas
            const container = document.getElementById('stellar-velocity-theme');
            if (container) {
                container.appendChild(this.canvas);
                this.registerContainer(container);
            } else {
                console.error('[StellarVelocity] Theme container not found!');
                return;
            }

            // Initialize star field
            this.initStars();

            // Setup game event listeners
            this.setupEventListeners();

            // Start animation loop
            this.startAnimation();

            // Start color cycling
            this.startColorCycle();

            console.log('[StellarVelocity] createScene() completed successfully');
        } catch (error) {
            console.error('[StellarVelocity] ERROR in createScene():', error);
            throw error;
        }
    }

    /**
     * Get current color scheme
     */
    getCurrentColorScheme() {
        return this.colorSchemes[this.currentColorScheme];
    }

    /**
     * Initialize star field with 3D coordinates
     */
    initStars() {
        this.stars = [];
        this.backgroundStars = [];

        // Create moving stars
        for (let i = 0; i < this.numStars; i++) {
            this.stars.push(this.createStar());
        }

        // Create stationary background stars
        for (let i = 0; i < this.numBackgroundStars; i++) {
            this.backgroundStars.push(this.createBackgroundStar());
        }

        console.log(`[StellarVelocity] Initialized ${this.numStars} moving stars and ${this.numBackgroundStars} background stars`);
    }

    /**
     * Create a single star with 3D coordinates
     */
    createStar() {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * this.tunnelRadius;

        return {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
            z: Math.random() * 3000 + 1, // Deeper space for slower movement
            size: 0.4 + Math.random() * 0.8, // Much smaller stars (was 1-3)
            brightness: 0.4 + Math.random() * 0.4,
            prevScreenX: 0,
            prevScreenY: 0,
        };
    }

    /**
     * Create a stationary background star
     */
    createBackgroundStar() {
        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
            size: 0.3 + Math.random() * 0.9, // Smaller background stars
            brightness: 0.15 + Math.random() * 0.25,
            twinkle: Math.random() * Math.PI * 2,
            twinkleSpeed: 0.01 + Math.random() * 0.02, // Slower twinkle
        };
    }

    /**
     * Setup game event listeners
     */
    setupEventListeners() {
        console.log('[StellarVelocity] Setting up event listeners');

        // Line clear events - speed boost
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        // Combo events - dramatic effects
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        // Piece lock - subtle pulse
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        console.log('[StellarVelocity] Event listeners set up successfully');
    }

    /**
     * React to line clears with SUBTLE effects (not warp speed)
     */
    onLineClear(lineCount) {
        // Very gentle speed increase only
        const speedBoost = lineCount * 0.05; // Much smaller boost
        this.targetSpeed = Math.min(this.baseSpeed * 2, this.baseSpeed + speedBoost);

        // Only slight visual changes for Tetris
        if (lineCount >= 4) {
            this.targetTunnelRadius = 1200; // Just slightly narrower
            this.targetFov = 230;

            // Small burst for Tetris only
            for (let i = 0; i < 15; i++) {
                this.addBurstStar();
            }
        }

        // Reset to normal quickly
        setTimeout(() => {
            this.targetSpeed = this.baseSpeed;
            this.targetTunnelRadius = 1500;
            this.targetFov = 250;
        }, 1000);
    }

    /**
     * React to combos with SPECTACULAR WARP SPEED and star bursts
     */
    onCombo(comboCount) {
        // Moderate speed multiplier for combos
        this.comboMultiplier = 1.0 + (comboCount * 0.3);

        // WARP SPEED for combos!
        if (comboCount >= 8) {
            // MAXIMUM WARP!
            this.targetSpeed = this.maxSpeed * 1.5;
            this.targetTunnelRadius = 100; // Extreme tunnel vision
            this.targetFov = 50; // Very narrow FOV for deep tunnel effect
            this.trailOpacity = 0.9;

            // Massive star burst
            for (let i = 0; i < 200; i++) {
                this.addBurstStar();
            }
        } else if (comboCount >= 5) {
            // HIGH WARP SPEED
            this.targetSpeed = this.maxSpeed * 1.0;
            this.targetTunnelRadius = 300;
            this.targetFov = 100;
            this.trailOpacity = 0.8;

            // Large star burst
            for (let i = 0; i < 100; i++) {
                this.addBurstStar();
            }
        } else if (comboCount >= 3) {
            // MEDIUM WARP SPEED
            this.targetSpeed = this.maxSpeed * 0.6;
            this.targetTunnelRadius = 600;
            this.targetFov = 150;
            this.trailOpacity = 0.6;

            // Medium star burst
            for (let i = 0; i < 50; i++) {
                this.addBurstStar();
            }
        } else {
            // LOW WARP SPEED
            this.targetSpeed = this.maxSpeed * 0.3;
            this.targetTunnelRadius = 1000;
            this.targetFov = 200;
            this.trailOpacity = 0.4;

            // Small star burst
            for (let i = 0; i < 25; i++) {
                this.addBurstStar();
            }
        }

        // Reset after delay - longer for higher combos
        setTimeout(() => {
            this.comboMultiplier = 1.0;
            this.targetSpeed = this.baseSpeed;
            this.targetTunnelRadius = 1500;
            this.targetFov = 250;
            this.trailOpacity = 0.3; // Back to subtle
        }, 2000 + comboCount * 300);
    }

    /**
     * React to piece locks with barely noticeable effect
     */
    onPieceLock() {
        // Almost imperceptible - just adds 1-2 stars
        if (Math.random() < 0.3) { // Only 30% of the time
            this.addBurstStar();
        }
    }

    /**
     * Add a burst star for dramatic effects
     */
    addBurstStar() {
        if (this.burstStars.length >= this.maxBurstStars) {
            this.burstStars.shift(); // Remove oldest
        }

        const angle = Math.random() * Math.PI * 2;
        // Speed scales with current warp speed
        const baseSpeed = 3 + Math.random() * 10;
        const speedMultiplier = this.currentSpeed / this.baseSpeed;
        const speed = baseSpeed * Math.min(speedMultiplier, 8); // Allow faster bursts

        this.burstStars.push({
            x: this.centerX,
            y: this.centerY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 1 + Math.random() * 2.5, // Smaller burst stars
            brightness: 0.7 + Math.random() * 0.3,
            life: 1.0,
            decay: 0.008 + Math.random() * 0.015, // Longer-lived bursts
        });
    }

    /**
     * Update star field
     */
    updateStars() {
        // Smoothly interpolate speed
        this.currentSpeed += (this.targetSpeed - this.currentSpeed) * this.acceleration;

        // Smoothly interpolate tunnel radius
        this.tunnelRadius += (this.targetTunnelRadius - this.tunnelRadius) * 0.05;

        // Smoothly interpolate FOV
        this.fov += (this.targetFov - this.fov) * 0.05;

        // Update moving stars
        for (const star of this.stars) {
            // Move star toward viewer
            star.z -= this.currentSpeed * 10 * this.comboMultiplier;

            // Reset star if it passes the viewer
            if (star.z <= 1) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * this.tunnelRadius;
                star.x = Math.cos(angle) * radius;
                star.y = Math.sin(angle) * radius;
                star.z = 3000; // Match the deeper space depth
                star.prevScreenX = 0;
                star.prevScreenY = 0;
            }
        }

        // Update burst stars
        for (let i = this.burstStars.length - 1; i >= 0; i--) {
            const star = this.burstStars[i];

            star.x += star.vx;
            star.y += star.vy;
            star.life -= star.decay;

            // Remove dead stars
            if (star.life <= 0) {
                this.burstStars.splice(i, 1);
            }
        }

        // Update background stars (twinkling effect)
        for (const star of this.backgroundStars) {
            star.twinkle += star.twinkleSpeed;
        }
    }

    /**
     * Render star field
     */
    renderStars() {
        const colorScheme = this.getCurrentColorScheme();

        // Add camera shake at high speeds
        let shakeX = 0;
        let shakeY = 0;
        if (this.currentSpeed > 2.0) {
            const shakeIntensity = (this.currentSpeed - 2.0) * 2;
            shakeX = (Math.random() - 0.5) * shakeIntensity;
            shakeY = (Math.random() - 0.5) * shakeIntensity;
        }

        // Clear canvas with background color
        this.ctx.fillStyle = colorScheme.bg;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw background stars first (stationary, behind moving stars)
        this.ctx.fillStyle = colorScheme.star;
        for (const star of this.backgroundStars) {
            const alpha = star.brightness * (0.3 + Math.sin(star.twinkle) * 0.2);
            this.ctx.globalAlpha = alpha;
            this.ctx.beginPath();
            this.ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.globalAlpha = 1.0;

        // Draw moving stars with perspective projection
        for (const star of this.stars) {
            // Project 3D to 2D
            const scale = this.fov / star.z;
            const screenX = this.centerX + shakeX + star.x * scale;
            const screenY = this.centerY + shakeY + star.y * scale;
            const size = star.size * scale;

            // Only draw if on screen
            if (screenX < 0 || screenX > this.canvas.width
                || screenY < 0 || screenY > this.canvas.height) {
                star.prevScreenX = screenX;
                star.prevScreenY = screenY;
                continue;
            }

            // Draw motion trail ONLY during warp speed (when speed > 5x base)
            const isWarpSpeed = this.currentSpeed > this.baseSpeed * 5;
            if (this.showTrails && isWarpSpeed && star.prevScreenX !== 0) {
                // Calculate streak vector
                const dx = screenX - star.prevScreenX;
                const dy = screenY - star.prevScreenY;
                const distance = Math.hypot(dx, dy);

                // Only draw trail if moving fast enough
                if (distance > 1) {
                    // Exaggerate trail length based on speed
                    const streakFactor = Math.min(this.currentSpeed * 2, 20);
                    const tailX = screenX - dx * streakFactor;
                    const tailY = screenY - dy * streakFactor;

                    // Parse RGB from trail color and apply dynamic opacity
                    const trailAlpha = this.trailOpacity * Math.min(1, distance / 5);
                    const gradient = this.ctx.createLinearGradient(
                        tailX,
                        tailY,
                        screenX,
                        screenY,
                    );

                    const rgb = colorScheme.star.match(/\w\w/g)?.map((x) => parseInt(x, 16)) || [255, 255, 255];

                    // Fade out at the tail
                    gradient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
                    // Bright at the head
                    gradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.min(1, trailAlpha)})`);

                    this.ctx.strokeStyle = gradient;
                    this.ctx.lineWidth = Math.max(0.5, size * (1 + this.currentSpeed * 0.5)); // Thicker trails at high speed
                    this.ctx.beginPath();
                    this.ctx.moveTo(tailX, tailY);
                    this.ctx.lineTo(screenX, screenY);
                    this.ctx.stroke();
                }
            }

            // Draw star (smaller at slow speeds)
            const alpha = Math.min(1, star.brightness * scale * 3);
            this.ctx.globalAlpha = alpha;
            this.ctx.fillStyle = colorScheme.star;
            this.ctx.beginPath();
            this.ctx.arc(screenX, screenY, Math.max(0.5, size), 0, Math.PI * 2);
            this.ctx.fill();

            // Add subtle glow only at high speeds
            if (this.currentSpeed > this.baseSpeed * 3 && size > 0.8) {
                this.ctx.globalAlpha = alpha * 0.25;
                this.ctx.beginPath();
                this.ctx.arc(screenX, screenY, size * 2.5, 0, Math.PI * 2);
                this.ctx.fill();
            }

            this.ctx.globalAlpha = 1.0;

            // Store position for next frame
            star.prevScreenX = screenX;
            star.prevScreenY = screenY;
        }

        // Draw burst stars with better visuals
        this.ctx.fillStyle = colorScheme.star;
        for (const star of this.burstStars) {
            const alpha = star.life * star.brightness;

            // Apply camera shake
            const drawX = star.x + shakeX;
            const drawY = star.y + shakeY;

            // Draw core
            this.ctx.globalAlpha = alpha;
            this.ctx.beginPath();
            this.ctx.arc(drawX, drawY, star.size, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw inner glow
            this.ctx.globalAlpha = alpha * 0.5;
            this.ctx.beginPath();
            this.ctx.arc(drawX, drawY, star.size * 2, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw outer glow (more prominent during warp speed)
            if (this.currentSpeed > this.baseSpeed * 2) {
                this.ctx.globalAlpha = alpha * 0.25;
                this.ctx.beginPath();
                this.ctx.arc(drawX, drawY, star.size * 4, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
        this.ctx.globalAlpha = 1.0;
    }

    /**
     * Start animation loop
     */
    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            this.updateStars();
            this.renderStars();

            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    /**
     * Cycle through color schemes
     */
    startColorCycle() {
        const cycleColors = () => {
            if (!this.isActive) return;

            this.currentColorScheme = (this.currentColorScheme + 1) % this.colorSchemes.length;
            console.log('[StellarVelocity] Color scheme changed to:', this.getCurrentColorScheme().name);

            // Update canvas background color
            if (this.canvas) {
                this.canvas.style.backgroundColor = this.getCurrentColorScheme().bg;
            }

            // Schedule next cycle (30-45 seconds)
            const delay = 30000 + Math.random() * 15000;
            this.colorCycleInterval = setTimeout(cycleColors, delay);
        };

        // Start first cycle after 20 seconds
        this.colorCycleInterval = setTimeout(cycleColors, 20000);
    }

    /**
     * Stop theme
     */
    stop() {
        console.log('[StellarVelocity] stop() called');

        if (!this.isActive) return;

        if (this.colorCycleInterval) {
            clearTimeout(this.colorCycleInterval);
            this.colorCycleInterval = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Call parent stop
        super.stop();

        console.log('[StellarVelocity] Stopped successfully');
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        console.log('[StellarVelocity] cleanup() called');

        // Stop first
        this.stop();

        // Clear arrays
        this.stars = [];
        this.backgroundStars = [];
        this.burstStars = [];

        // Remove canvas
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;

        // Call parent cleanup
        super.cleanup();

        console.log('[StellarVelocity] Cleaned up successfully');
    }

    /**
     * Handle window resize
     */
    resize(width, height) {
        if (this.canvas) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.centerX = width / 2;
            this.centerY = height / 2;

            // Reposition background stars
            this.backgroundStars.forEach((star) => {
                if (star.x > width) star.x = Math.random() * width;
                if (star.y > height) star.y = Math.random() * height;
            });
        }
    }

    /**
     * Update (called each frame if needed)
     */
    update() {
        // Animation updates happen in animation loop
    }
}
