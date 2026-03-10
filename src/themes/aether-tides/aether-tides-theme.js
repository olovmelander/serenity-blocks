/**
 * Aether Tides Theme - Deep Space Nebula with Gravity Wells
 *
 * Features:
 * - Modified fluid simulator with gravity and ambient motion
 * - Supernova effects on line clears
 * - Black hole gravity wells on combos
 * - Stardust trails on piece locks
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import AetherTidesSimulator from '../../utils/webgl/aether-tides-simulator.js';
import { AETHER_TIDES_TETROMINOS } from './aether-tides-tetrominos.js';

export default class AetherTidesTheme extends BaseTheme {
    constructor() {
        super('aether-tides');

        this.simulator = null;
        this.canvas = null;
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;
        this.effectTimeouts = new Set();

        // State
        this.blackHoleActive = false;
        this.blackHoleTimer = 0;
        this.blackHoleStrength = 0;

        console.log('[AetherTides] Constructor called');
    }

    scheduleEffectTimeout(callback, delayMs = 0) {
        const timeoutId = window.setTimeout(() => {
            this.effectTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        this.effectTimeouts.add(timeoutId);
        return timeoutId;
    }

    clearEffectTimeouts() {
        this.effectTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        this.effectTimeouts.clear();
    }

    async init() {
        console.log('[AetherTides] Initializing theme');
    }

    getTetrominoConfig() {
        return AETHER_TIDES_TETROMINOS;
    }

    async createScene() {
        console.log('[AetherTides] createScene() called');

        try {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'aether-tides-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.backgroundColor = '#000000'; // Deep space black
            this.canvas.style.pointerEvents = 'none';

            this.resize(window.innerWidth, window.innerHeight);

            const container = document.getElementById('aether-tides-theme');
            if (container) {
                container.appendChild(this.canvas);
                this.registerContainer(container);

                // Add starfield background if not present
                if (!container.querySelector('.starfield')) {
                    const stars = document.createElement('div');
                    stars.className = 'starfield';
                    stars.style.position = 'absolute';
                    stars.style.top = '0';
                    stars.style.left = '0';
                    stars.style.width = '100%';
                    stars.style.height = '100%';
                    stars.style.zIndex = '-1';
                    stars.style.backgroundImage = 'radial-gradient(white, rgba(255,255,255,.2) 2px, transparent 3px), radial-gradient(white, rgba(255,255,255,.15) 1px, transparent 2px), radial-gradient(white, rgba(255,255,255,.1) 2px, transparent 3px)';
                    stars.style.backgroundSize = '550px 550px, 350px 350px, 250px 250px';
                    stars.style.backgroundPosition = '0 0, 40px 60px, 130px 270px';
                    container.insertBefore(stars, this.canvas);
                }
            } else {
                console.error('[AetherTides] Theme container not found!');
                return;
            }

            const config = this.getConfig();
            this.simulator = new AetherTidesSimulator(this.canvas, config);

            const success = await this.simulator.init();
            if (!success) {
                console.error('[AetherTides] Failed to initialize aether tides simulator');
                return;
            }

            this.addWebGLLayer(this.canvas, -1);
            this.setupEventListeners();
            this.startAnimation();
            this.addInitialNebula();

            console.log('[AetherTides] createScene() completed');
        } catch (error) {
            console.error('[AetherTides] ERROR in createScene():', error);
            throw error;
        }
    }

    getConfig() {
        return {
            SIM_RESOLUTION: 256,
            DYE_RESOLUTION: 1024,
            DENSITY_DISSIPATION: 0.99, // Very slow fade for nebula look
            VELOCITY_DISSIPATION: 0.99, // Momentum keeps going
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: 20,
            CURL: 45, // Swirly
            SPLAT_RADIUS: 0.3, // Large soft splats
            SPLAT_FORCE: 4000,
            SHADING: true,
            COLORFUL: true,
            BLOOM: true,
            BLOOM_ITERATIONS: 8,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 0.6,
            BLOOM_THRESHOLD: 0.5,
            BLOOM_SOFT_KNEE: 0.7,
            SUNRAYS: false, // Maybe too heavy?
            BACK_COLOR: { r: 0, g: 0, b: 0 },
            TRANSPARENT: true, // Let stars show through
        };
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) this.onLineClear(data.lineCount);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive) this.onCombo(data.comboCount);
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive) this.onPieceLock();
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    // --- Effects ---

    getRandomCosmicColor() {
        const palette = [
            { r: 0.5, g: 0.0, b: 1.0 }, // Purple
            { r: 0.0, g: 1.0, b: 1.0 }, // Cyan
            { r: 1.0, g: 0.0, b: 0.5 }, // Magenta
            { r: 0.2, g: 0.0, b: 0.8 }, // Deep Blue
        ];
        return palette[Math.floor(Math.random() * palette.length)];
    }

    onLineClear(lineCount) {
        if (!this.simulator) return;

        // Supernova effect
        const count = lineCount * 5;
        const intensity = 1.0 + (lineCount * 0.2);

        // Center explosion
        this.simulator.splat(0.5, 0.5, 0, 0, { r: 1.0, g: 0.9, b: 0.5 }); // Bright core

        for (let i = 0; i < count; i++) {
            this.scheduleEffectTimeout(() => {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * 0.2;
                const x = 0.5 + Math.cos(angle) * dist;
                const y = 0.5 + Math.sin(angle) * dist;

                // Outward force
                const dx = Math.cos(angle) * 5000 * intensity;
                const dy = Math.sin(angle) * 5000 * intensity;

                const color = this.getRandomCosmicColor();
                this.simulator.splat(x, y, dx, dy, color);
            }, i * 30);
        }
    }

    onCombo(comboCount) {
        if (!this.simulator) return;

        // Black Hole effect
        // We activate the gravity well in the update loop
        this.blackHoleActive = true;
        this.blackHoleTimer = 2.0; // Lasts 2 seconds
        this.blackHoleStrength = 5000 * Math.min(comboCount, 5);

        // Visual indicator of black hole
        this.simulator.splat(0.5, 0.5, 0, 0, { r: 0.1, g: 0.0, b: 0.2 }); // Dark center
    }

    onPieceLock(data) {
        if (!this.simulator) return;

        // Get the piece shape if available
        const piece = data?.piece;
        if (!piece || !piece.shape || !piece.shape.length) {
            // Fallback to irregular puff if no shape data
            this.createIrregularPuff(0.3 + Math.random() * 0.4, 0.3 + Math.random() * 0.4);
            return;
        }

        // Create stardust puffs in the shape of the tetromino
        const baseX = 0.3 + Math.random() * 0.4;
        const baseY = 0.3 + Math.random() * 0.4;
        const blockSize = 0.04; // Size of each block in the shape
        const color = this.getRandomCosmicColor();

        // Iterate through the shape matrix
        for (let row = 0; row < piece.shape.length; row++) {
            for (let col = 0; col < piece.shape[row].length; col++) {
                if (piece.shape[row][col]) {
                    // Calculate position for this block
                    const x = baseX + (col - 1.5) * blockSize;
                    const y = baseY + (row - 1.5) * blockSize;

                    this.scheduleEffectTimeout(() => {
                        this.createIrregularPuff(x, y, color);
                    }, (row * piece.shape[row].length + col) * 40);
                }
            }
        }
    }

    /**
     * Create an irregular, streak-like puff instead of circular
     */
    createIrregularPuff(x, y, baseColor = null) {
        if (!this.simulator) return;

        const color = baseColor || this.getRandomCosmicColor();

        // Create multiple directional streaks to form an irregular shape
        const numStreaks = 3 + Math.floor(Math.random() * 4); // 3-6 streaks
        const baseAngle = Math.random() * Math.PI * 2;

        for (let i = 0; i < numStreaks; i++) {
            // Vary angle and distance for each streak
            const angleOffset = (Math.random() - 0.5) * Math.PI;
            const angle = baseAngle + angleOffset;
            const distance = 0.005 + Math.random() * 0.01; // Small offset from center

            // Position offset for this streak
            const offsetX = Math.cos(angle) * distance;
            const offsetY = Math.sin(angle) * distance;

            // Create directional force for streak
            const force = 200 + Math.random() * 200;
            const dx = Math.cos(angle) * force;
            const dy = Math.sin(angle) * force;

            // Add slight timing variation
            this.scheduleEffectTimeout(() => {
                this.simulator.splat(x + offsetX, y + offsetY, dx, dy, color);
            }, i * 15);
        }
    }

    addInitialNebula() {
        for (let i = 0; i < 8; i++) {
            const x = Math.random();
            const y = Math.random();
            const color = this.getRandomCosmicColor();
            this.simulator.splat(x, y, (Math.random() - 0.5) * 1000, (Math.random() - 0.5) * 1000, color);
        }
    }

    // --- Loop ---

    startAnimation() {
        const animate = (currentTime) => {
            if (!this.isActive) return;

            if (this.lastTime === 0) this.lastTime = currentTime;
            let dt = (currentTime - this.lastTime) / 1000;
            this.lastTime = currentTime;

            if (dt > 0.1) dt = 0.016;

            if (this.simulator) {
                // Apply Black Hole Gravity
                if (this.blackHoleActive) {
                    this.simulator.applyGravity(0.5, 0.5, -this.blackHoleStrength, 0.5, dt); // Negative force = pull
                    this.blackHoleTimer -= dt;
                    if (this.blackHoleTimer <= 0) {
                        this.blackHoleActive = false;
                    }
                }

                // Ambient Motion (Swirling)
                // Add small random splats to keep it moving
                if (Math.random() < 0.1) {
                    const x = Math.random();
                    const y = Math.random();
                    const color = { r: 0, g: 0, b: 0 }; // No color, just force
                    this.simulator.splat(x, y, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, color);
                }

                this.simulator.step(dt);
                this.simulator.render(null);
            }

            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };
        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    stop() {
        if (!this.isActive) return;
        this.clearEffectTimeouts();
        this.eventUnsubscribers.forEach((u) => u());
        this.eventUnsubscribers = [];
        super.stop();
    }

    cleanup() {
        this.stop();
        if (this.simulator) {
            this.simulator.cleanup();
            this.simulator = null;
        }
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        super.cleanup();
    }

    resize(width, height) {
        if (this.canvas) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        if (this.simulator) {
            this.simulator.resize(width, height);
        }
    }
}
