/**
 * Cinder Drift Theme - Atmospheric smoke with glowing embers
 *
 * Features:
 * - Rising smoke simulation with buoyancy
 * - Glowing ember particles at the base
 * - Dark, moody atmosphere with warm accents
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import SmokeSimulator from '../../utils/webgl/smoke-simulator.js';
import { CINDER_DRIFT_TETROMINOS } from './cinder-drift-tetrominos.js';

export default class CinderDriftTheme extends BaseTheme {
    constructor() {
        super('cinder-drift');

        this.simulator = null;
        this.canvas = null;
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;

        // Ember emitters (fewer for less frequent puffing)
        this.embers = [];
        this.MAX_EMBERS = 5;

        console.log('[CinderDrift] Constructor called');
    }

    async init() {
        console.log('[CinderDrift] Initializing theme');
    }

    getTetrominoConfig() {
        return CINDER_DRIFT_TETROMINOS;
    }

    async createScene() {
        console.log('[CinderDrift] createScene() called');

        try {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'cinder-drift-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.backgroundColor = '#0a0806'; // Deep dark gray-black
            this.canvas.style.pointerEvents = 'none';

            this.resize(window.innerWidth, window.innerHeight);

            const container = document.getElementById('cinder-drift-theme');
            if (container) {
                container.appendChild(this.canvas);
                this.registerContainer(container);
            } else {
                console.error('[CinderDrift] Theme container not found!');
                return;
            }

            const config = this.getConfig();
            this.simulator = new SmokeSimulator(this.canvas, config);

            const success = await this.simulator.init();
            if (!success) {
                console.error('[CinderDrift] Failed to initialize smoke simulator');
                return;
            }

            this.addWebGLLayer(this.canvas, -1);
            this.setupEventListeners();
            this.initEmbers();
            this.startAnimation();
            this.addInitialSmoke();

            console.log('[CinderDrift] createScene() completed');
        } catch (error) {
            console.error('[CinderDrift] ERROR in createScene():', error);
            throw error;
        }
    }

    getConfig() {
        return {
            SIM_RESOLUTION: 128,
            DYE_RESOLUTION: 1024,
            DENSITY_DISSIPATION: 2.0, // Very slow fade for lingering smoke
            VELOCITY_DISSIPATION: 1.5, // Very high dissipation = very slow movement
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: 20,
            CURL: 40, // More turbulence for dramatic swirls
            SPLAT_RADIUS: 0.25, // Larger smoke volumes
            SPLAT_FORCE: 6000, // More dramatic motion
            SHADING: true,
            COLORFUL: true, // Enable color for orange/red tints
            BLOOM: true,
            BLOOM_ITERATIONS: 8,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 0.9, // Brighter glow
            BLOOM_THRESHOLD: 0.3, // Lower threshold for more glow
            BLOOM_SOFT_KNEE: 0.8,
            SUNRAYS: false,
            BACK_COLOR: { r: 10, g: 8, b: 6 },
            TRANSPARENT: false,
            BUOYANCY: 0.25, // Gentle rise for pillars
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

    // --- Ember System ---

    initEmbers() {
        this.embers = [];
        for (let i = 0; i < this.MAX_EMBERS; i++) {
            this.embers.push({
                x: Math.random(),
                y: 0.02 + Math.random() * 0.08, // Spread across bottom
                brightness: 0.6 + Math.random() * 0.4,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: 0.8 + Math.random() * 0.7, // Faster, more dynamic pulse
                emitTimer: Math.random() * 2.0, // Longer start delay
            });
        }
    }

    updateEmbers(dt) {
        // Automatic ember emissions disabled - only triggered on gameplay events

    }

    /**
     * Trigger ember-style smoke puffs manually (called during gameplay events)
     */
    triggerEmberPuffs(count = 3, intensity = 1.0) {
        if (!this.simulator) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                // Random ember position at bottom
                const x = Math.random();
                const y = 0.02 + Math.random() * 0.08;

                // Brighter smoke with orange/red tints
                const smokeColor = {
                    r: 0.25 + intensity * 0.4,
                    g: 0.15 + intensity * 0.2,
                    b: 0.10 + intensity * 0.1,
                };

                // Tall vertical pillar
                const dx = (Math.random() - 0.5) * 30;
                const dy = 400 + Math.random() * 300;

                this.simulator.splat(x, y, dx, dy, smokeColor);
            }, i * 100);
        }
    }

    // --- Effects ---

    getSmokeColor(intensity = 1.0) {
        // Brighter smoke with warm orange/red tints for excitement
        return {
            r: 0.35 * intensity, // More orange
            g: 0.22 * intensity, // Warmer
            b: 0.15 * intensity, // Slight warmth
        };
    }

    onLineClear(lineCount) {
        if (!this.simulator) return;

        // MASSIVE smoke explosions for line clears
        const plumes = lineCount * 5; // Way more smoke
        for (let i = 0; i < plumes; i++) {
            setTimeout(() => {
                const x = Math.random();
                const y = 0.2 + Math.random() * 0.4;
                const dx = (Math.random() - 0.5) * 100; // Narrow spread
                const dy = 500 + Math.random() * 400; // High pillars

                const color = this.getSmokeColor(1.0 + lineCount * 0.2);
                this.simulator.splat(x, y, dx, dy, color);
            }, i * 30); // Faster succession
        }

        // Add ember-style puffs for line clears
        this.triggerEmberPuffs(lineCount * 4, 0.8);
    }

    onCombo(comboCount) {
        if (!this.simulator) return;

        // FIRE ERUPTION for combos!
        const intensity = Math.min(comboCount / 5, 2.0);
        const eruptions = comboCount * 3;

        for (let i = 0; i < eruptions; i++) {
            setTimeout(() => {
                const x = Math.random();
                const y = 0.05 + Math.random() * 0.15;
                const dx = (Math.random() - 0.5) * 120;
                const dy = 600 + Math.random() * 400; // Very tall combo pillars

                // Bright orange/red smoke for combos (like flames)
                const color = {
                    r: 0.5 * intensity, // Bright orange/red
                    g: 0.25 * intensity, // Flame color
                    b: 0.1 * intensity, // Hot
                };

                this.simulator.splat(x, y, dx, dy, color);
            }, i * 50); // Rapid succession
        }

        // Add intense ember puffs for combos
        this.triggerEmberPuffs(comboCount * 2, intensity);
    }

    onPieceLock() {
        if (!this.simulator) return;

        // Small smoke puff
        const x = 0.3 + Math.random() * 0.4;
        const y = 0.2 + Math.random() * 0.2;
        const color = this.getSmokeColor(0.5);
        this.simulator.splat(x, y, (Math.random() - 0.5) * 40, 60, color);

        // Add subtle ember puff
        this.triggerEmberPuffs(2, 0.5);
    }

    addInitialSmoke() {
        // Add dramatic initial smoke atmosphere
        for (let i = 0; i < 20; i++) {
            setTimeout(() => {
                const x = Math.random();
                const y = Math.random() * 0.5;
                const color = this.getSmokeColor(0.6 + Math.random() * 0.6);
                this.simulator.splat(x, y, (Math.random() - 0.5) * 100, 100, color);
            }, i * 80);
        }
    }

    // --- Animation Loop ---

    startAnimation() {
        const animate = (currentTime) => {
            if (!this.isActive) return;

            if (this.lastTime === 0) this.lastTime = currentTime;
            let dt = (currentTime - this.lastTime) / 1000;
            this.lastTime = currentTime;

            if (dt > 0.1) dt = 0.016;

            this.updateEmbers(dt);

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
