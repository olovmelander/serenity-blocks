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

        // Ambient wave state - puff pattern with natural dissipation
        this.ambientWaveTimer = 0;
        this.AMBIENT_WAVE_INTERVAL = 30.0; // Time between wave cycles
        this.waveResetTimer = 0;
        this.WAVE_RESET_INTERVAL = 3.0; // Clear waves after 3 seconds of calm
        this.isCalm = true; // Track if ocean is in calm state
        this.lastWaveTime = 0; // Track when last wave was created

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
            WAVE_DAMPING: 0.90,              // High damping for smooth dissipation
            SURFACE_TENSION: 0.06,           // Higher tension keeps waves localized
            DISPLACEMENT_SCALE: 2.3,         // Dramatic waves with natural fade
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
            // Add extra ambient waves for Tetris
            this.triggerAmbientWaves(5, 1.5);
        } else if (lineCount >= 2) {
            // Multi-line: Flowing waves
            this.createMultiLineWaves(lineCount);
            // Add ambient waves for multi-line
            this.triggerAmbientWaves(4, 1.2);
        } else {
            // Single line: Simple ripple
            this.createSimpleRipple();
            // Add subtle ambient waves
            this.triggerAmbientWaves(3, 1.0);
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
     * Create a smooth wave that builds up gradually
     */
    createSmoothWave(x, y, radius, amplitude, steps = 5, duration = 150) {
        const stepDelay = duration / steps;

        for (let i = 0; i < steps; i++) {
            setTimeout(() => {
                // Ease-in curve for smooth start
                const t = (i + 1) / steps;
                const eased = t * t; // Quadratic ease-in
                const currentAmplitude = amplitude * eased;

                this.simulator.createSwell(x, y, {
                    radius: radius,
                    amplitude: currentAmplitude / steps // Divide to prevent over-accumulation
                });
            }, i * stepDelay);
        }
    }

    /**
     * Simple ripple for single line clear - stormy wave puff from random location
     */
    createSimpleRipple() {
        this.lastWaveTime = performance.now();

        // Spawn from completely random position - anywhere on screen
        const x = 0.1 + Math.random() * 0.8;
        const y = 0.1 + Math.random() * 0.8;

        // Highly varied radius and amplitude for unique waves each time
        const radius = 0.08 + Math.random() * 0.18; // 0.08-0.26 (much wider range)
        const amplitude = 0.6 + Math.random() * 0.8; // 0.6-1.4 (more dramatic variation)

        this.createSmoothWave(x, y, radius, amplitude, 4, 120);

        // Flash storm light
        this.flashStormLight(0.12);
    }

    /**
     * Wave puffs for double/triple line clears - storm surge from multiple directions
     */
    createMultiLineWaves(lineCount) {
        this.lastWaveTime = performance.now();

        const puffCount = lineCount * 2; // Reduced waves for faster dissipation

        // Stronger storm flash for multi-line
        this.flashStormLight(0.18);

        for (let i = 0; i < puffCount; i++) {
            setTimeout(() => {
                // Random position across entire screen
                const x = 0.05 + Math.random() * 0.9;
                const y = 0.05 + Math.random() * 0.9;

                // Wide variation for each wave - mix of small ripples and large swells
                const radius = 0.08 + Math.random() * 0.20; // 0.08-0.28
                const amplitude = 0.7 + Math.random() * 1.0; // 0.7-1.7

                this.createSmoothWave(x, y, radius, amplitude, 4, 120);
            }, i * 120);  // Slightly slower succession
        }
    }

    /**
     * Dramatic puff cascade for Tetris (4 lines) - massive storm from all directions
     */
    createTetrisCascade() {
        this.lastWaveTime = performance.now();

        const puffCount = 10;  // Reduced for faster dissipation

        // Dramatic storm lightning for Tetris
        this.flashStormLight(0.3);

        for (let i = 0; i < puffCount; i++) {
            setTimeout(() => {
                // Completely random positions - spawn from edges and center
                const edgeRoll = Math.random();
                let x, y;

                if (edgeRoll < 0.3) {
                    // Spawn from edges (30% chance)
                    const edge = Math.floor(Math.random() * 4);
                    switch(edge) {
                        case 0: x = Math.random(); y = 0.05; break; // Top
                        case 1: x = Math.random(); y = 0.95; break; // Bottom
                        case 2: x = 0.05; y = Math.random(); break; // Left
                        case 3: x = 0.95; y = Math.random(); break; // Right
                    }
                } else {
                    // Spawn randomly anywhere (70% chance)
                    x = 0.05 + Math.random() * 0.9;
                    y = 0.05 + Math.random() * 0.9;
                }

                // Extremely varied waves - from tiny ripples to massive swells
                const radius = 0.10 + Math.random() * 0.28; // 0.10-0.38 (huge range)
                const amplitude = 1.0 + Math.random() * 1.5; // 1.0-2.5 (dramatic variation)

                this.createSmoothWave(x, y, radius, amplitude, 5, 150);

                // Additional flashes during cascade
                if (i % 3 === 0) {
                    this.flashStormLight(0.2);
                }
            }, i * 100);  // Slightly slower for less overlap
        }
    }

    /**
     * React to combos with bursts of storm wave puffs from all directions
     */
    onCombo(comboCount) {
        if (!this.simulator) return;

        this.lastWaveTime = performance.now();

        const puffCount = Math.min(comboCount + 3, 10);  // Reduced for faster dissipation

        // Escalating storm flash based on combo
        this.flashStormLight(0.15 + (comboCount * 0.02));

        // Create waves radiating from different quadrants
        for (let i = 0; i < puffCount; i++) {
            setTimeout(() => {
                // Choose random quadrant and position within it
                const quadrant = Math.floor(Math.random() * 4);
                let x, y;

                switch(quadrant) {
                    case 0: // Top-left
                        x = 0.05 + Math.random() * 0.45;
                        y = 0.05 + Math.random() * 0.45;
                        break;
                    case 1: // Top-right
                        x = 0.5 + Math.random() * 0.45;
                        y = 0.05 + Math.random() * 0.45;
                        break;
                    case 2: // Bottom-left
                        x = 0.05 + Math.random() * 0.45;
                        y = 0.5 + Math.random() * 0.45;
                        break;
                    case 3: // Bottom-right
                        x = 0.5 + Math.random() * 0.45;
                        y = 0.5 + Math.random() * 0.45;
                        break;
                }

                // Highly varied waves - each combo wave looks different
                const radius = 0.09 + Math.random() * 0.18; // 0.09-0.27 (wide range)
                const amplitude = 1.0 + (comboCount * 0.12) + (Math.random() * 0.8); // More variation

                this.createSmoothWave(x, y, radius, amplitude, 4, 120);
            }, i * 90);  // Slower to reduce overlap
        }

        // Add intense ambient waves for combos
        const intensity = Math.min(1.0 + (comboCount * 0.15), 2.0);
        this.triggerAmbientWaves(comboCount + 2, intensity);
    }

    /**
     * React to piece locks - DISABLED (no effects on piece locks)
     */
    onPieceLock() {
        // No piece lock effects in this theme
        return;
    }

    /**
     * Add initial wave puffs for visual presence - stormy start from different directions
     */
    addInitialWaves() {
        if (!this.simulator) return;

        // Start with stormy wave presence from different corners
        setTimeout(() => {
            const corners = [
                [0.15, 0.15], // Top-left
                [0.85, 0.15], // Top-right
                [0.5, 0.85]   // Bottom-center
            ];

            for (let i = 0; i < corners.length; i++) {
                setTimeout(() => {
                    const [baseX, baseY] = corners[i];
                    // Add small random offset from corner
                    const x = baseX + (Math.random() - 0.5) * 0.2;
                    const y = baseY + (Math.random() - 0.5) * 0.2;

                    // Each initial wave looks different
                    const radius = 0.12 + Math.random() * 0.15; // 0.12-0.27 (varied)
                    const amplitude = 0.8 + Math.random() * 0.6; // 0.8-1.4 (varied)

                    this.createSmoothWave(x, y, radius, amplitude, 5, 200);
                }, i * 180);
            }
        }, 300);
    }

    /**
     * Create ambient waves - DISABLED (now only triggered on line clears and combos)
     */
    createAmbientWave() {
        // Automatic ambient waves disabled - only triggered on gameplay events
        return;
    }

    /**
     * Trigger ambient-style waves manually (called during line clears and combos)
     */
    triggerAmbientWaves(count = 3, intensity = 1.0) {
        if (!this.simulator) return;

        // Mark that we're no longer calm and update last wave time
        this.isCalm = false;
        this.lastWaveTime = performance.now();

        // Storm flash scaled by intensity
        this.flashStormLight(0.10 * intensity);

        // Create storm swells from different areas
        const puffCount = Math.max(2, Math.round(count));

        for (let i = 0; i < puffCount; i++) {
            setTimeout(() => {
                // Sometimes spawn from edges, sometimes from center
                const fromEdge = Math.random() < 0.4;
                let x, y;

                if (fromEdge) {
                    // Spawn near an edge
                    const side = Math.floor(Math.random() * 4);
                    switch(side) {
                        case 0: x = 0.05 + Math.random() * 0.2; y = Math.random(); break; // Left edge
                        case 1: x = 0.75 + Math.random() * 0.2; y = Math.random(); break; // Right edge
                        case 2: x = Math.random(); y = 0.05 + Math.random() * 0.2; break; // Top edge
                        case 3: x = Math.random(); y = 0.75 + Math.random() * 0.2; break; // Bottom edge
                    }
                } else {
                    // Random center position
                    x = 0.15 + Math.random() * 0.7;
                    y = 0.15 + Math.random() * 0.7;
                }

                // Varied ambient waves scaled by intensity
                const radius = (0.10 + Math.random() * 0.15) * intensity;
                const amplitude = (0.7 + Math.random() * 0.7) * intensity;

                this.createSmoothWave(x, y, radius, amplitude, 4, 150);
            }, i * 160);
        }
    }

    /**
     * Reset wave field to calm state - waves fade naturally through damping
     */
    resetWaveField() {
        if (!this.simulator) return;

        // Check if enough time has passed since last wave
        const now = performance.now();
        const timeSinceLastWave = (now - this.lastWaveTime) / 1000;

        // Mark as calm after waves have had time to dissipate naturally
        if (timeSinceLastWave >= this.WAVE_RESET_INTERVAL && !this.isCalm) {
            this.isCalm = true;
            console.log('[LuminousTides] Ocean returning to calm - waves fading naturally');
        }
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

            // Ambient wave timer - DISABLED (only triggered on gameplay events now)
            // this.ambientWaveTimer += deltaTime;
            // if (this.ambientWaveTimer >= this.AMBIENT_WAVE_INTERVAL) {
            //     this.ambientWaveTimer = 0;
            //     this.createAmbientWave();
            // }

            // Check if we should reset wave field (clear accumulated waves during calm periods)
            this.resetWaveField();

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
        this.isCalm = true;
        this.lastWaveTime = 0;

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
