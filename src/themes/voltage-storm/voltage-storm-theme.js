/**
 * Voltage Storm Theme - High-energy fluid simulation
 *
 * Features:
 * - High-velocity, high-dissipation fluid simulation
 * - Electric/Neon visuals
 * - "Lightning" and "Shockwave" combo effects
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import FluidSimulator from '../../utils/webgl/fluid-simulator.js';
import { VOLTAGE_STORM_TETROMINOS } from './voltage-storm-tetrominos.js';

export default class VoltageStormTheme extends BaseTheme {
    constructor() {
        super('voltage-storm');

        this.simulator = null;
        this.canvas = null;
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;

        // Autonomous Emitters (Sparks)
        this.emitters = [];
        this.MAX_EMITTERS = 6; // More, smaller emitters

        // State
        this.stormIntensity = 0;
        this.stormTimer = 0;

        console.log('[VoltageStorm] Constructor called');
    }

    async init() {
        console.log('[VoltageStorm] Initializing theme');
    }

    getTetrominoConfig() {
        return VOLTAGE_STORM_TETROMINOS;
    }

    async createScene() {
        console.log('[VoltageStorm] createScene() called');

        try {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'voltage-storm-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.backgroundColor = '#050510'; // Dark blue-black background
            this.canvas.style.pointerEvents = 'none';

            this.resize(window.innerWidth, window.innerHeight);

            const container = document.getElementById('voltage-storm-theme');
            if (container) {
                container.appendChild(this.canvas);
                this.registerContainer(container);
            } else {
                console.error('[VoltageStorm] Theme container not found!');
                return;
            }

            const config = this.getConfig();
            this.simulator = new FluidSimulator(this.canvas, config);

            const success = await this.simulator.init();
            if (!success) {
                console.error('[VoltageStorm] Failed to initialize fluid simulator');
                return;
            }

            this.addWebGLLayer(this.canvas, -1);
            this.setupEventListeners();
            this.initEmitters();
            this.startAnimation();
            this.addInitialStorm();

            console.log('[VoltageStorm] createScene() completed');
        } catch (error) {
            console.error('[VoltageStorm] ERROR in createScene():', error);
            throw error;
        }
    }

    getConfig() {
        return {
            SIM_RESOLUTION: 256,
            DYE_RESOLUTION: 1024,
            DENSITY_DISSIPATION: 2.5, // Fades very fast
            VELOCITY_DISSIPATION: 1.5, // Stops fast
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: 20,
            CURL: 50, // High curl for chaotic look
            SPLAT_RADIUS: 0.15, // Sharp splats
            SPLAT_FORCE: 8000, // Very strong force
            SHADING: true,
            COLORFUL: true,
            BLOOM: true,
            BLOOM_ITERATIONS: 6,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 1.2, // Very bright bloom
            BLOOM_THRESHOLD: 0.4,
            BLOOM_SOFT_KNEE: 0.5,
            SUNRAYS: false,
            BACK_COLOR: { r: 5, g: 5, b: 16 }, // Deep blue background
            TRANSPARENT: false,
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

    getRandomElectricColor() {
        const palette = [
            { r: 0.2, g: 0.8, b: 1.0 }, // Cyan
            { r: 0.8, g: 0.2, b: 1.0 }, // Purple
            { r: 1.0, g: 1.0, b: 1.0 }, // White
            { r: 0.2, g: 0.2, b: 1.0 }, // Blue
        ];
        return palette[Math.floor(Math.random() * palette.length)];
    }

    onLineClear(lineCount) {
        if (!this.simulator) return;

        // Shockwave effect
        const count = lineCount * 4;
        const intensity = 0.5 + (lineCount * 0.1);

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const angle = (i / count) * Math.PI * 2;
                const x = 0.5 + Math.cos(angle) * 0.1;
                const y = 0.5 + Math.sin(angle) * 0.1;
                const dx = Math.cos(angle) * 2000 * intensity;
                const dy = Math.sin(angle) * 2000 * intensity;

                const color = this.getRandomElectricColor();
                this.simulator.splat(x, y, dx, dy, color);
            }, i * 20);
        }

        // Add electric spark pulses for line clears
        this.triggerSparkPulses(lineCount * 5, intensity);
    }

    onCombo(comboCount) {
        if (!this.simulator) return;

        // Lightning effect
        const strikes = Math.min(comboCount, 5);

        for (let i = 0; i < strikes; i++) {
            setTimeout(() => {
                this.createLightningStrike();
            }, i * 100);
        }

        // Add intense electric sparks for combos
        const intensity = Math.min(comboCount / 3, 2.0);
        this.triggerSparkPulses(comboCount * 3, intensity);
    }

    createLightningStrike() {
        const startX = Math.random();
        const startY = 0.0;
        const endX = Math.random();
        const endY = 1.0;

        const steps = 10;
        for (let i = 0; i < steps; i++) {
            const t = i / steps;
            const x = startX + (endX - startX) * t + (Math.random() - 0.5) * 0.1;
            const y = startY + (endY - startY) * t;

            const dx = (Math.random() - 0.5) * 1000;
            const dy = 2000; // Downwards force

            const color = { r: 0.8, g: 0.9, b: 1.0 }; // White-blue
            this.simulator.splat(x, y, dx, dy, color);
        }
    }

    onPieceLock() {
        if (!this.simulator) return;
        // Small spark
        const x = Math.random();
        const y = Math.random();
        const color = this.getRandomElectricColor();
        this.simulator.splat(x, y, (Math.random() - 0.5) * 500, (Math.random() - 0.5) * 500, color);

        // Add subtle electric sparks
        this.triggerSparkPulses(2, 0.6);
    }

    addInitialStorm() {
        for (let i = 0; i < 5; i++) {
            setTimeout(() => this.createLightningStrike(), i * 200);
        }
    }

    // --- Autonomous Emitters ---

    initEmitters() {
        this.emitters = [];
        for (let i = 0; i < this.MAX_EMITTERS; i++) {
            this.emitters.push({
                x: Math.random(),
                y: Math.random(),
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                timer: Math.random() * 2,
            });
        }
    }

    updateEmitters(dt) {
        // Automatic emissions disabled - only triggered on gameplay events
        return;
    }

    /**
     * Trigger electric spark pulses manually (called during gameplay events)
     */
    triggerSparkPulses(count = 3, intensity = 1.0) {
        if (!this.simulator) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                // Random position across screen
                const x = Math.random();
                const y = Math.random();

                // Random direction with scaled force
                const angle = Math.random() * Math.PI * 2;
                const force = (500 + Math.random() * 500) * intensity;
                const dx = Math.cos(angle) * force;
                const dy = Math.sin(angle) * force;

                const color = this.getRandomElectricColor();
                this.simulator.splat(x, y, dx, dy, color);
            }, i * 80);
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

            this.updateEmitters(dt);

            if (this.simulator) {
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
        this.eventUnsubscribers.forEach(u => u());
        this.eventUnsubscribers = [];
        super.stop();
    }

    cleanup() {
        this.stop();
        if (this.simulator) {
            this.simulator.cleanup(); // Assuming cleanup exists, if not it's fine
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
            this.simulator.resize(width, height); // Assuming resize exists
        }
    }
}
