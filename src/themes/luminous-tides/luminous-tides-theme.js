/**
 * Luminous Tides Theme - Bioluminescent water waves
 *
 * Features:
 * - WebGL-based wave simulation with realistic physics
 * - Bioluminescent cyan/turquoise glowing effects
 * - Gentle autonomous wave motion
 * - Game event reactions (ripples, swells, cascades)
 * - Underwater caustics and foam effects
 * - Calming, meditative atmosphere
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import WaveSimulator, { WAVE_QUALITY_PRESETS } from '../../utils/webgl/wave-simulator.js';
import { LUMINOUS_TIDES_TETROMINOS } from './luminous-tides-tetrominos.js';

export default class LuminousTidesTheme extends BaseTheme {
    constructor() {
        super('luminous-tides');

        this.simulator = null;
        this.canvas = null;
        this.lightingOverlay = null; // For storm lighting effects
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;

        // Storm lighting state
        this.stormBrightness = 0; // 0-1, current brightness
        this.targetBrightness = 0; // Target brightness to fade to

        // Ambient wave state - puff pattern with reset
        this.ambientWaveTimer = 0;
        this.AMBIENT_WAVE_INTERVAL = 8.0; // Longer interval for complete dissipation
        this.waveResetTimer = 0;
        this.WAVE_RESET_INTERVAL = 7.5; // Reset slightly before next wave

        console.log('[LuminousTides] Constructor called');
    }

    async init() {
        console.log('[LuminousTides] Initializing theme');
    }

    getTetrominoConfig() {
        return LUMINOUS_TIDES_TETROMINOS;
    }

    async createScene() {
        console.log('[LuminousTides] createScene() called');

        try {
            // Create canvas for wave simulation
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'luminous-tides-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.backgroundColor = '#000408'; // Very dark stormy ocean
            this.canvas.style.pointerEvents = 'none';

            this.resize(window.innerWidth, window.innerHeight);

            // Get container (should exist in HTML)
            const container = document.getElementById('luminous-tides-theme');
            if (!container) {
                console.error('[LuminousTides] Theme container not found in HTML!');
                return;
            }

            // Clear any existing content from container to prevent duplicates
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }

            // Create lighting overlay for storm flash effects
            this.lightingOverlay = document.createElement('div');
            this.lightingOverlay.id = 'luminous-tides-lighting';
            this.lightingOverlay.style.position = 'absolute';
            this.lightingOverlay.style.top = '0';
            this.lightingOverlay.style.left = '0';
            this.lightingOverlay.style.width = '100%';
            this.lightingOverlay.style.height = '100%';
            this.lightingOverlay.style.backgroundColor = 'rgba(50, 120, 150, 0)'; // Cyan-blue tint
            this.lightingOverlay.style.pointerEvents = 'none';
            this.lightingOverlay.style.transition = 'none';

            // Add canvas and overlay to container
            container.appendChild(this.canvas);
            container.appendChild(this.lightingOverlay);
            this.registerContainer(container);

            // Get quality setting
            const quality = this.getQualitySetting();
            const config = this.getConfig(quality);

            // Create wave simulator
            this.simulator = new WaveSimulator(this.canvas, config);

            const success = await this.simulator.init();
            if (!success) {
                console.error('[LuminousTides] Failed to initialize wave simulator');
                return;
            }

            console.log('[LuminousTides] Wave simulator initialized successfully');

            // Setup game event listeners
            this.setupEventListeners();

            // Start animation loop
            this.startAnimation();

            // Add initial waves for visual presence
            this.addInitialWaves();

            console.log('[LuminousTides] createScene() completed successfully');
        } catch (error) {
            console.error('[LuminousTides] ERROR in createScene():', error);
            throw error;
        }
    }

    /**
     * Get wave simulator configuration based on quality
     */
    getConfig(quality) {
        // Start with quality preset
        const baseConfig = WAVE_QUALITY_PRESETS[quality] || WAVE_QUALITY_PRESETS.medium;

        // Wave simulation configuration - puff-style waves that dissipate quickly
        return {
            ...baseConfig,

            // Wave surface colors (darker, stormy ocean)
            WATER_COLOR: { r: 0.05, g: 0.15, b: 0.25 },    // Dark stormy water
            FOAM_COLOR: { r: 0.15, g: 0.3, b: 0.4 },       // Darker foam
            DEEP_COLOR: { r: 0.02, g: 0.08, b: 0.15 },     // Very dark depths

            // Wave physics for puff pattern - stormy ocean waves
            WAVE_DAMPING: 0.92,              // High damping for fast dissipation (like fluid)
            SURFACE_TENSION: 0.03,           // Higher tension keeps waves localized
            DISPLACEMENT_SCALE: 2.0,         // More dramatic wave height for storm feeling
            GRAVITY: 9.8,

            // Minimal effects - focus on wave simulation
            FOAM_ENABLED: false,             // No foam effects
            CAUSTICS_ENABLED: false,         // No caustic patterns

            // Transparency
            TRANSPARENT: false,
        };
    }

    /**
     * Get quality setting from game settings
     */
    getQualitySetting() {
        if (typeof window !== 'undefined' && window.settings) {
            const quality = window.settings.effectQuality || 'Medium';
            return quality.toLowerCase();
        }
        return 'medium';
    }

    /**
     * Setup game event listeners
     */
    setupEventListeners() {
        console.log('[LuminousTides] Setting up event listeners');

        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        // Listen for piece lock events
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        console.log('[LuminousTides] Event listeners set up successfully');
    }

    /**
     * React to line clears with cascading luminous waves
     */
    onLineClear(lineCount) {
        if (!this.simulator) return;

        if (lineCount >= 4) {
            // Tetris! Create dramatic wave cascade
            this.createTetrisCascade();
        } else if (lineCount >= 2) {
            // Multi-line: Flowing waves
            this.createMultiLineWaves(lineCount);
        } else {
            // Single line: Simple ripple
            this.createSimpleRipple();
        }
    }

    /**
     * Trigger storm lighting flash effect
     */
    flashStormLight(intensity = 0.15) {
        this.targetBrightness = intensity;
    }

    /**
     * Update storm lighting overlay
     */
    updateStormLighting(deltaTime) {
        if (!this.lightingOverlay) return;

        // Smoothly interpolate brightness towards target
        const fadeSpeed = 8.0; // Fast fade for lightning effect
        this.stormBrightness += (this.targetBrightness - this.stormBrightness) * fadeSpeed * deltaTime;

        // Auto-decay target brightness (creates flash then fade)
        this.targetBrightness *= Math.pow(0.1, deltaTime);

        // Apply brightness to overlay
        this.lightingOverlay.style.backgroundColor = 
            `rgba(50, 120, 150, ${this.stormBrightness.toFixed(3)})`;
    }

    /**
     * Simple ripple for single line clear - stormy wave puff
     */
    createSimpleRipple() {
        const x = 0.3 + Math.random() * 0.4;
        const y = 0.3 + Math.random() * 0.4;

        this.simulator.createSwell(x, y, {
            radius: 0.15,
            amplitude: 1.0  // More dramatic for storm feeling
        });

        // Flash storm light
        this.flashStormLight(0.12);
    }

    /**
     * Wave puffs for double/triple line clears - storm surge
     */
    createMultiLineWaves(lineCount) {
        const puffCount = lineCount * 3; // More waves for storm effect

        // Stronger storm flash for multi-line
        this.flashStormLight(0.18);

        for (let i = 0; i < puffCount; i++) {
            setTimeout(() => {
                const x = 0.2 + Math.random() * 0.6;
                const y = 0.2 + Math.random() * 0.6;

                this.simulator.createSwell(x, y, {
                    radius: 0.16,
                    amplitude: 1.2  // Stormy intensity
                });
            }, i * 100);  // Faster succession for storm feeling
        }
    }

    /**
     * Dramatic puff cascade for Tetris (4 lines) - massive storm
     */
    createTetrisCascade() {
        const puffCount = 15;  // More waves for dramatic storm

        // Dramatic storm lightning for Tetris
        this.flashStormLight(0.3);

        for (let i = 0; i < puffCount; i++) {
            setTimeout(() => {
                const x = 0.15 + Math.random() * 0.7;
                const y = 0.15 + Math.random() * 0.7;

                this.simulator.createSwell(x, y, {
                    radius: 0.22,
                    amplitude: 1.8  // Massive storm waves
                });

                // Additional flashes during cascade
                if (i % 3 === 0) {
                    this.flashStormLight(0.2);
                }
            }, i * 80);  // Rapid succession for tempest effect
        }
    }

    /**
     * React to combos with bursts of storm wave puffs
     */
    onCombo(comboCount) {
        if (!this.simulator) return;

        const puffCount = Math.min(comboCount + 5, 15);  // More waves for storm

        // Escalating storm flash based on combo
        this.flashStormLight(0.15 + (comboCount * 0.02));

        // Random storm puffs across the screen
        for (let i = 0; i < puffCount; i++) {
            setTimeout(() => {
                const x = 0.2 + Math.random() * 0.6;
                const y = 0.2 + Math.random() * 0.6;

                this.simulator.createSwell(x, y, {
                    radius: 0.17,
                    amplitude: 1.3 + (comboCount * 0.15)  // Escalating storm
                });
            }, i * 70);  // Faster for storm urgency
        }
    }

    /**
     * React to piece locks with ripple - like rain on water
     */
    onPieceLock() {
        if (!this.simulator) return;

        // Rain-like ripple on stormy ocean
        const x = 0.3 + Math.random() * 0.4;
        const y = 0.3 + Math.random() * 0.4;

        this.simulator.createSwell(x, y, {
            radius: 0.10,
            amplitude: 0.6  // More noticeable on dark water
        });

        // Subtle light ripple
        this.flashStormLight(0.06);
    }

    /**
     * Add initial wave puffs for visual presence - stormy start
     */
    addInitialWaves() {
        if (!this.simulator) return;

        // Start with stormy wave presence
        setTimeout(() => {
            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    const x = 0.2 + Math.random() * 0.6;
                    const y = 0.2 + Math.random() * 0.6;

                    this.simulator.createSwell(x, y, {
                        radius: 0.18,
                        amplitude: 1.0  // Immediate storm presence
                    });
                }, i * 180);
            }
        }, 300);
    }

    /**
     * Create ambient waves periodically - stormy ocean swells
     */
    createAmbientWave() {
        if (!this.simulator) return;

        // Gentle ambient storm flash
        this.flashStormLight(0.10);

        // Create storm swells that roll across the dark ocean
        const puffCount = 3 + Math.floor(Math.random() * 3); // 3-5 puffs

        for (let i = 0; i < puffCount; i++) {
            setTimeout(() => {
                const x = 0.2 + Math.random() * 0.6;
                const y = 0.2 + Math.random() * 0.6;

                this.simulator.createSwell(x, y, {
                    radius: 0.18,
                    amplitude: 1.2  // Stronger ambient storm presence
                });
            }, i * 140);
        }
    }

    /**
     * Reset wave field to calm state
     */
    resetWaveField() {
        if (!this.simulator) return;

        // The wave simulator will naturally dissipate with high damping
        // This is just a marker for when we've completed a cycle
        console.log('[LuminousTides] Wave cycle complete - ready for new puff');
    }

    /**
     * Start animation loop
     */
    startAnimation() {
        const animate = (currentTime) => {
            if (!this.isActive) return;

            // Calculate delta time
            if (this.lastTime === 0) {
                this.lastTime = currentTime;
            }

            let deltaTime = (currentTime - this.lastTime) / 1000;
            this.lastTime = currentTime;

            // Cap extremely large time steps
            if (deltaTime > 0.1) {
                deltaTime = 0.016666; // Reset to 60fps equivalent
            }

            // Update ambient wave timer - create puffs periodically
            this.ambientWaveTimer += deltaTime;
            if (this.ambientWaveTimer >= this.AMBIENT_WAVE_INTERVAL) {
                this.ambientWaveTimer = 0;
                this.createAmbientWave();
            }

            // Update wave reset timer - mark cycle completion
            this.waveResetTimer += deltaTime;
            if (this.waveResetTimer >= this.WAVE_RESET_INTERVAL) {
                this.waveResetTimer = 0;
                this.resetWaveField();
            }

            // Update storm lighting effect
            this.updateStormLighting(deltaTime);

            // Run wave simulation
            if (this.simulator) {
                this.simulator.step(deltaTime);
                this.simulator.render(null);
            }

            // Continue animation
            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.lastTime = 0;
        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    /**
     * Stop theme
     */
    stop() {
        console.log('[LuminousTides] stop() called');

        if (!this.isActive) return;

        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Call parent stop
        super.stop();

        console.log('[LuminousTides] Stopped successfully');
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        console.log('[LuminousTides] cleanup() called');

        // Stop first
        this.stop();

        // Cleanup simulator
        if (this.simulator) {
            this.simulator.cleanup();
            this.simulator = null;
        }

        // Remove canvas and overlay
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;

        if (this.lightingOverlay && this.lightingOverlay.parentNode) {
            this.lightingOverlay.parentNode.removeChild(this.lightingOverlay);
        }
        this.lightingOverlay = null;

        // Reset timers and lighting state
        this.ambientWaveTimer = 0;
        this.waveResetTimer = 0;
        this.stormBrightness = 0;
        this.targetBrightness = 0;

        // Call parent cleanup
        super.cleanup();

        console.log('[LuminousTides] Cleaned up successfully');
    }

    /**
     * Handle window resize
     */
    resize(width, height) {
        if (this.canvas) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        if (this.simulator) {
            this.simulator.resize(width, height);
        }
    }

    /**
     * Update (called each frame if needed)
     */
    update() {
        // Simulation updates happen in animation loop
    }
}
