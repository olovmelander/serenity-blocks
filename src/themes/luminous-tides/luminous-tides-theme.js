/**
 * Luminous Tides Theme - Enhanced Bioluminescent Deep Ocean
 *
 * Features:
 * - Advanced WebGL wave simulation with realistic physics
 * - Mesmerizing bioluminescent glow effects
 * - Atmospheric depth and lighting
 * - Subtle autonomous wave motion
 * - Dynamic game event reactions
 * - Deep ocean mystery and tranquility
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
        this.lightingOverlay = null;
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;

        // Enhanced lighting state
        this.lightBrightness = 0;
        this.targetBrightness = 0;
        this.lightPulsePhase = 0;

        // Ambient wave system - tall narrow waves, very spread out
        this.ambientWaveTimer = 0;
        this.AMBIENT_WAVE_INTERVAL = 18.0; // Much less frequent
        this.nextAmbientPattern = 0; // Track pattern variation

        // Energy tracking for visual feedback
        this.waveEnergy = 0;
        this.energyDecay = 0.75; // Very fast energy decay

        console.log('[LuminousTides] Enhanced theme constructed');
    }

    async init() {
        console.log('[LuminousTides] Initializing enhanced theme');
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
            this.canvas.style.backgroundColor = '#000204'; // Deep abyss
            this.canvas.style.pointerEvents = 'none';

            this.resize(window.innerWidth, window.innerHeight);

            // Get container
            const container = document.getElementById('luminous-tides-theme');
            if (!container) {
                console.error('[LuminousTides] Theme container not found!');
                return;
            }

            // Clear existing content
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }

            // Create atmospheric lighting overlay
            this.lightingOverlay = document.createElement('div');
            this.lightingOverlay.id = 'luminous-tides-lighting';
            this.lightingOverlay.style.position = 'absolute';
            this.lightingOverlay.style.top = '0';
            this.lightingOverlay.style.left = '0';
            this.lightingOverlay.style.width = '100%';
            this.lightingOverlay.style.height = '100%';
            this.lightingOverlay.style.background =
                'radial-gradient(ellipse at 50% 30%, rgba(20, 60, 100, 0.15) 0%, rgba(0, 0, 0, 0) 70%)';
            this.lightingOverlay.style.pointerEvents = 'none';
            this.lightingOverlay.style.mixBlendMode = 'screen';
            this.lightingOverlay.style.transition = 'none';

            // Add canvas and overlay to container
            container.appendChild(this.canvas);
            container.appendChild(this.lightingOverlay);
            this.registerContainer(container);

            // Get quality setting and config
            const quality = this.getQualitySetting();
            const config = this.getConfig(quality);

            // Create enhanced wave simulator
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

            // Add initial atmospheric waves
            this.addInitialWaves();

            console.log('[LuminousTides] createScene() completed successfully');
        } catch (error) {
            console.error('[LuminousTides] ERROR in createScene():', error);
            throw error;
        }
    }

    /**
     * Get enhanced wave simulator configuration
     * Tall narrow surf waves that fade very quickly to calm
     */
    getConfig(quality) {
        const baseConfig = WAVE_QUALITY_PRESETS[quality] || WAVE_QUALITY_PRESETS.medium;

        return {
            ...baseConfig,

            // Surf wave physics - tall and narrow, very fast fade
            WAVE_DAMPING: 0.86,               // VERY fast fade-out to calm
            SURFACE_TENSION: 0.03,            // Keeps waves focused/narrow
            DISPLACEMENT_SCALE: 3.5,          // Tall surf waves
            DIFFUSION: 0.004,                 // Low diffusion (narrow waves)
            GRAVITY: 9.8,

            // Atmospheric deep ocean colors
            WATER_COLOR: { r: 0.03, g: 0.12, b: 0.22 },    // Deep blue-green
            DEEP_COLOR: { r: 0.01, g: 0.04, b: 0.10 },     // Abyssal depths
            FOAM_COLOR: { r: 0.12, g: 0.25, b: 0.35 },     // Subtle foam

            // Bioluminescent glow - bright but focused
            GLOW_ENABLED: true,
            GLOW_COLOR: { r: 0.08, g: 0.45, b: 0.62 },     // Bioluminescent cyan
            GLOW_INTENSITY: 1.4,              // Bright for tall waves
            GLOW_SPREAD: 2.0,                 // Less spread (focused)

            // Enhanced atmospheric lighting
            DEPTH_FADE: 2.0,                  // Strong depth for tall waves
            AMBIENT_LIGHT: 0.12,              // Subtle ambient
            SPECULAR_INTENSITY: 0.50,         // Stronger highlights on tall waves
            SPECULAR_POWER: 20.0,             // Sharp specular

            // Effects (foam disabled for cleaner look)
            FOAM_ENABLED: false,
            CAUSTICS_ENABLED: baseConfig.CAUSTICS_ENABLED,
            CAUSTICS_INTENSITY: 0.4,
            CAUSTICS_SCALE: 1.8,

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
     * React to line clears with elegant bioluminescent waves
     */
    onLineClear(lineCount) {
        if (!this.simulator) return;

        if (lineCount >= 4) {
            // Tetris! Spectacular bioluminescent bloom
            this.createTetrisBloom();
            this.flashLight(0.4, 1.5);
            this.waveEnergy = Math.min(this.waveEnergy + 0.8, 1.0);
        } else if (lineCount >= 2) {
            // Multi-line: Flowing luminous waves
            this.createMultiLineFlow(lineCount);
            this.flashLight(0.25, 1.0);
            this.waveEnergy = Math.min(this.waveEnergy + 0.5, 1.0);
        } else {
            // Single line: Gentle ripple
            this.createGentleRipple();
            this.flashLight(0.15, 0.6);
            this.waveEnergy = Math.min(this.waveEnergy + 0.25, 1.0);
        }
    }

    /**
     * Trigger light flash effect
     */
    flashLight(intensity = 0.2, duration = 1.0) {
        this.targetBrightness = intensity;
        this.lightPulsePhase = duration;
    }

    /**
     * Update lighting overlay
     */
    updateLighting(deltaTime) {
        if (!this.lightingOverlay) return;

        // Smooth interpolation towards target
        const fadeSpeed = 6.0;
        this.lightBrightness += (this.targetBrightness - this.lightBrightness) * fadeSpeed * deltaTime;

        // Auto-decay based on pulse phase
        if (this.lightPulsePhase > 0) {
            this.lightPulsePhase -= deltaTime;
            const decay = Math.exp(-2.0 * deltaTime);
            this.targetBrightness *= decay;
        } else {
            this.targetBrightness *= Math.pow(0.05, deltaTime);
        }

        // Apply to overlay
        if (this.lightBrightness > 0.01) {
            const brightness = this.lightBrightness;
            this.lightingOverlay.style.background =
                `radial-gradient(ellipse at 50% 30%,
                    rgba(20, 80, 120, ${(brightness * 0.3).toFixed(3)}) 0%,
                    rgba(10, 50, 80, ${(brightness * 0.15).toFixed(3)}) 40%,
                    rgba(0, 0, 0, 0) 80%)`;
        } else {
            this.lightingOverlay.style.background =
                'radial-gradient(ellipse at 50% 30%, rgba(20, 60, 100, 0.15) 0%, rgba(0, 0, 0, 0) 70%)';
        }
    }

    /**
     * Create smooth, organic wave
     */
    createSmoothWave(x, y, radius, amplitude, buildup = 4, delay = 100) {
        for (let i = 0; i < buildup; i++) {
            setTimeout(() => {
                const t = (i + 1) / buildup;
                const eased = t * t * (3.0 - 2.0 * t); // Smooth step
                const currentAmplitude = amplitude * eased;

                this.simulator.createSwell(x, y, {
                    radius: radius,
                    amplitude: currentAmplitude / buildup
                });
            }, i * delay);
        }
    }

    /**
     * Gentle ripple for single line clear - tall narrow surf wave
     */
    createGentleRipple() {
        // Single tall narrow wave
        const x = 0.3 + Math.random() * 0.4;
        const y = 0.3 + Math.random() * 0.4;

        const radius = 0.08 + Math.random() * 0.05; // Small radius (narrow)
        const amplitude = 1.8 + Math.random() * 0.8; // Tall amplitude

        this.createSmoothWave(x, y, radius, amplitude, 7, 100);
    }

    /**
     * Flowing waves for double/triple line clears - tall narrow waves, far apart
     */
    createMultiLineFlow(lineCount) {
        const waveCount = Math.max(1, lineCount - 1); // Very few waves

        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => {
                // Create tall narrow waves
                const progress = i / Math.max(waveCount, 1);

                // Alternate between flowing patterns
                let x, y;
                if (i % 2 === 0) {
                    // Flow from left
                    x = 0.2 + progress * 0.3;
                    y = 0.35 + Math.sin(progress * Math.PI) * 0.3;
                } else {
                    // Flow from right
                    x = 0.8 - progress * 0.3;
                    y = 0.4 + Math.cos(progress * Math.PI) * 0.25;
                }

                const radius = 0.10 + Math.random() * 0.06; // Small radius (narrow)
                const amplitude = 1.6 + Math.random() * 1.0; // Tall amplitude

                this.createSmoothWave(x, y, radius, amplitude, 7, 120);
            }, i * 800); // Much more spacing
        }
    }

    /**
     * Spectacular bioluminescent bloom for Tetris - tall narrow surf waves
     */
    createTetrisBloom() {
        const bloomCount = 3; // Very few waves

        // Tall center wave
        setTimeout(() => {
            this.createSmoothWave(0.5, 0.5, 0.14, 3.0, 9, 140);
        }, 0);

        // Radiating tall narrow waves
        for (let i = 0; i < bloomCount; i++) {
            setTimeout(() => {
                const angle = (i / bloomCount) * Math.PI * 2;
                const distance = 0.28 + Math.random() * 0.10;

                const x = 0.5 + Math.cos(angle) * distance;
                const y = 0.5 + Math.sin(angle) * distance;

                const radius = 0.11 + Math.random() * 0.06; // Small radius (narrow)
                const amplitude = 2.2 + Math.random() * 1.2; // Very tall

                this.createSmoothWave(x, y, radius, amplitude, 8, 130);
            }, i * 600 + 400); // Much more spacing
        }

        // One additional wave
        setTimeout(() => {
            const x = 0.35 + Math.random() * 0.3;
            const y = 0.35 + Math.random() * 0.3;
            const radius = 0.12 + Math.random() * 0.06;
            const amplitude = 2.0 + Math.random() * 0.8;

            this.createSmoothWave(x, y, radius, amplitude, 7, 140);
        }, 2000); // Much later
    }

    /**
     * React to combos with escalating bioluminescence - tall narrow waves
     */
    onCombo(comboCount) {
        if (!this.simulator) return;

        const intensity = Math.min(1.0 + comboCount * 0.15, 2.5);
        const waveCount = Math.min(comboCount, 4); // Very few waves

        this.flashLight(0.2 + comboCount * 0.03, 1.2);
        this.waveEnergy = Math.min(this.waveEnergy + 0.4 + comboCount * 0.05, 1.0);

        // Create tall narrow waves in a spiral pattern
        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => {
                const angle = (i / waveCount) * Math.PI * 2 + comboCount * 0.5;
                const distance = 0.20 + (i / waveCount) * 0.18;

                const x = 0.5 + Math.cos(angle) * distance;
                const y = 0.5 + Math.sin(angle) * distance;

                const radius = 0.09 + Math.random() * 0.05; // Small radius (narrow)
                const amplitude = (1.4 + Math.random() * 0.8) * intensity; // Tall

                this.createSmoothWave(x, y, radius, amplitude, 7, 110);
            }, i * 500); // Much more spacing
        }
    }

    /**
     * React to piece locks with subtle pulse
     */
    onPieceLock() {
        if (!this.simulator) return;

        // Subtle ripple - piece landing creates small disturbance
        if (Math.random() < 0.3) { // Only 30% of the time for subtlety
            const x = 0.3 + Math.random() * 0.4;
            const y = 0.7 + Math.random() * 0.2;

            this.createSmoothWave(x, y, 0.08, 0.4, 3, 60);
        }
    }

    /**
     * Add initial atmospheric waves - tall narrow introduction
     */
    addInitialWaves() {
        if (!this.simulator) return;

        // Create gentle introduction with tall narrow waves
        setTimeout(() => {
            // Single initial wave to establish atmosphere
            const x = 0.4 + Math.random() * 0.2;
            const y = 0.4 + Math.random() * 0.2;
            const radius = 0.10 + Math.random() * 0.05;
            const amplitude = 1.2 + Math.random() * 0.6;

            this.createSmoothWave(x, y, radius, amplitude, 8, 150);
        }, 800);
    }

    /**
     * Create ambient wave patterns - subtle organic motion
     */
    createAmbientWave() {
        if (!this.simulator) return;

        // Cycle through different ambient patterns for variety
        const pattern = this.nextAmbientPattern % 4;
        this.nextAmbientPattern++;

        switch (pattern) {
            case 0: // Single gentle swell
                this.createGentleSwell();
                break;
            case 1: // Crossing waves
                this.createCrossingWaves();
                break;
            case 2: // Circular ripple
                this.createCircularRipple();
                break;
            case 3: // Edge wave
                this.createEdgeWave();
                break;
        }

        // Subtle light pulse
        this.flashLight(0.08, 0.5);
    }

    /**
     * Gentle swell from random position - tall narrow surf wave
     */
    createGentleSwell() {
        const x = 0.3 + Math.random() * 0.4;
        const y = 0.3 + Math.random() * 0.4;
        const radius = 0.10 + Math.random() * 0.06; // Small radius (narrow)
        const amplitude = 1.0 + Math.random() * 0.6; // Tall

        this.createSmoothWave(x, y, radius, amplitude, 8, 140);
    }

    /**
     * Two waves crossing paths - tall narrow waves far apart
     */
    createCrossingWaves() {
        // First tall wave
        const x1 = 0.25 + Math.random() * 0.25;
        const y1 = 0.3 + Math.random() * 0.4;
        this.createSmoothWave(x1, y1, 0.09, 1.2, 7, 120);

        // Second tall wave (much more delayed)
        setTimeout(() => {
            const x2 = 0.5 + Math.random() * 0.25;
            const y2 = 0.3 + Math.random() * 0.4;
            this.createSmoothWave(x2, y2, 0.09, 1.2, 7, 120);
        }, 1200); // Much more spacing
    }

    /**
     * Circular expanding ripple - single tall narrow ring
     */
    createCircularRipple() {
        const centerX = 0.4 + Math.random() * 0.2;
        const centerY = 0.4 + Math.random() * 0.2;

        // Just one tall ring
        const radius = 0.08 + Math.random() * 0.04; // Small (narrow)
        const amplitude = 1.4 + Math.random() * 0.6; // Tall
        this.createSmoothWave(centerX, centerY, radius, amplitude, 7, 110);
    }

    /**
     * Wave from edge - tall narrow wave
     */
    createEdgeWave() {
        const side = Math.floor(Math.random() * 4);
        let x, y;

        switch (side) {
            case 0: // Top
                x = 0.3 + Math.random() * 0.4;
                y = 0.15;
                break;
            case 1: // Right
                x = 0.85;
                y = 0.3 + Math.random() * 0.4;
                break;
            case 2: // Bottom
                x = 0.3 + Math.random() * 0.4;
                y = 0.85;
                break;
            case 3: // Left
                x = 0.15;
                y = 0.3 + Math.random() * 0.4;
                break;
        }

        this.createSmoothWave(x, y, 0.11, 1.3, 7, 130); // Tall narrow
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
                deltaTime = 0.016666;
            }

            // Ambient wave timer
            this.ambientWaveTimer += deltaTime;
            if (this.ambientWaveTimer >= this.AMBIENT_WAVE_INTERVAL) {
                this.ambientWaveTimer = 0;
                this.createAmbientWave();
            }

            // Decay wave energy
            this.waveEnergy *= Math.pow(this.energyDecay, deltaTime * 60);

            // Update lighting
            this.updateLighting(deltaTime);

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

        // Reset state
        this.ambientWaveTimer = 0;
        this.lightBrightness = 0;
        this.targetBrightness = 0;
        this.lightPulsePhase = 0;
        this.waveEnergy = 0;
        this.nextAmbientPattern = 0;

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
