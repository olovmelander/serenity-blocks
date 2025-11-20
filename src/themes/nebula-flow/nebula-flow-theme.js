/**
 * Nebula Flow Theme - GPU-accelerated fluid animation background
 *
 * Features:
 * - Fully autonomous fluid dynamics simulation (no mouse control)
 * - Real-time fluid dynamics using WebGL
 * - Multiple color schemes (cosmic, ocean, aurora, prismatic)
 * - Spectacular game event reactions (combos, line clears)
 * - Performance-optimized with quality settings
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import FluidSimulator from './fluid-simulator.js';
import { getColorScheme, getRandomColor, lerpColor } from './color-schemes.js';

export default class NebulaFlowTheme extends BaseTheme {
    constructor() {
        super('nebula-flow');

        this.simulator = null;
        this.canvas = null;
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;

        // Configuration
        this.currentSchemeName = 'prismatic';
        this.colorScheme = getColorScheme(this.currentSchemeName);
        this.availableSchemes = ['cosmic', 'aurora', 'ocean', 'prismatic', 'fire'];

        // Autonomous animation timers
        this.colorCycleTimeout = null;

        // Autonomous Emitters
        this.emitters = [];
        this.MAX_EMITTERS = 5;

        // Color animation state
        this.colorState = null;
        this.resetColorState();

        // Emission Cycle State
        this.emissionState = 'IDLE';
        this.emissionTimer = 0;
        this.setNextEmissionCycle();

        console.log('[NebulaFlow] Constructor called');
    }

    async init() {
        console.log('[NebulaFlow] Initializing theme');
    }

    async createScene() {
        console.log('[NebulaFlow] createScene() called');

        try {
            // Create canvas for fluid simulation
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'nebula-flow-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.backgroundColor = 'black'; // Prevent white flash
            this.canvas.style.pointerEvents = 'none'; // Ensure no mouse interaction

            console.log('[NebulaFlow] Canvas element created with ID:', this.canvas.id);

            // Set canvas size
            this.resize(window.innerWidth, window.innerHeight);

            // Get the theme container and add canvas
            const container = document.getElementById('nebula-flow-theme');
            if (container) {
                container.appendChild(this.canvas);
                this.registerContainer(container);
            } else {
                console.error('[NebulaFlow] Theme container not found!');
                return;
            }

            // Get quality setting
            const quality = this.getQualitySetting();

            // Create fluid simulator with quality-adjusted settings
            const config = this.getConfig(quality);
            this.simulator = new FluidSimulator(this.canvas, config);

            // Initialize simulator
            const success = await this.simulator.init();
            if (!success) {
                console.error('[NebulaFlow] Failed to initialize fluid simulator');
                return;
            }

            console.log('[NebulaFlow] Fluid simulator initialized successfully');

            // Add canvas as WebGL layer
            this.addWebGLLayer(this.canvas, -1);

            // Setup game event listeners
            this.setupEventListeners();

            // Initialize autonomous emitters
            this.initEmitters();

            // Start animation loop
            this.startAnimation();

            // Cycle through color palettes
            this.startColorCycle();

            // Add initial fluid to make the background visible
            this.addInitialFluid();

            console.log('[NebulaFlow] createScene() completed successfully');
        } catch (error) {
            console.error('[NebulaFlow] ERROR in createScene():', error);
            throw error;
        }
    }

    /**
     * Get configuration based on quality setting
     */
    getConfig(quality) {
        const baseConfig = {
            SIM_RESOLUTION: 128,
            DYE_RESOLUTION: 512,
            DENSITY_DISSIPATION: 2.0,
            VELOCITY_DISSIPATION: 1.2,
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: 14,
            CURL: 30,
            SPLAT_RADIUS: 0.2,
            SPLAT_FORCE: 2500,
            SHADING: false,
            COLORFUL: true,
            BLOOM: false,
            BLOOM_ITERATIONS: 8,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 0.8,
            BLOOM_THRESHOLD: 0.6,
            BLOOM_SOFT_KNEE: 0.7,
            SUNRAYS: false,
            SUNRAYS_RESOLUTION: 196,
            SUNRAYS_WEIGHT: 1.0,
            BACK_COLOR: { r: 0, g: 0, b: 0 }, // Black background
            TRANSPARENT: false
        };

        const qualityMultipliers = {
            low: { sim: 0.25, dye: 0.25, iterations: 6, bloom: false, sunrays: false },
            medium: { sim: 0.5, dye: 0.5, iterations: 10, bloom: false, sunrays: false },
            high: { sim: 1.0, dye: 1.0, iterations: 14, bloom: false, sunrays: false },
        };

        const multiplier = qualityMultipliers[quality] || qualityMultipliers.medium;

        return {
            ...baseConfig,
            SIM_RESOLUTION: Math.floor(baseConfig.SIM_RESOLUTION * multiplier.sim),
            DYE_RESOLUTION: Math.floor(baseConfig.DYE_RESOLUTION * multiplier.dye),
            PRESSURE_ITERATIONS: multiplier.iterations,
            BLOOM: multiplier.bloom,
            SUNRAYS: multiplier.sunrays,
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
        console.log('[NebulaFlow] Setting up event listeners');

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
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        console.log('[NebulaFlow] Event listeners set up successfully');
    }

    /**
     * React to line clears with flowing splats
     */
    onLineClear(lineCount) {
        if (!this.simulator) return;

        // Create cascading splats that flow across the screen
        const splatCount = Math.min(lineCount * 2, 8);

        for (let i = 0; i < splatCount; i++) {
            setTimeout(() => {
                this.addFlowingSplat(0.25 + (lineCount * 0.02));
            }, i * 100);
        }
    }

    /**
     * React to combos with spectacular swirling effects
     */
    onCombo(comboCount) {
        if (!this.simulator) return;

        // Intensity increases with combo count
        const intensity = Math.min(0.4, 0.2 + comboCount * 0.02);

        // Create a spectacular vortex pattern
        const centerX = 0.5;
        const centerY = 0.5;
        const spiralCount = Math.min(comboCount + 2, 12);

        for (let i = 0; i < spiralCount; i++) {
            setTimeout(() => {
                const angle = (i / spiralCount) * Math.PI * 2;
                const radius = 0.3;

                const x = centerX + Math.cos(angle) * radius;
                const y = centerY + Math.sin(angle) * radius;

                // Velocity creates swirling motion
                const vx = -Math.sin(angle) * intensity * 600;
                const vy = Math.cos(angle) * intensity * 600;

                const color = this.sampleColor(0.08, 0.08);
                this.simulator.splat(x, y, vx, vy, color);
            }, i * 60);
        }
    }

    /**
     * React to piece locks with subtle pulse
     */
    onPieceLock() {
        if (!this.simulator) return;
        // Subtle ripple effect
        this.addFlowingSplat(0.2);
    }

    /**
     * Add a flowing splat that drifts across the screen
     */
    addFlowingSplat(intensity = 0.5) {
        if (!this.simulator) return;

        const x = Math.random();
        const y = Math.random();

        const angle = Math.random() * Math.PI * 2;
        const force = intensity * 400;
        const dx = Math.cos(angle) * force;
        const dy = Math.sin(angle) * force;

        const color = this.sampleColor(0.06, 0.08);
        this.simulator.splat(x, y, dx, dy, color);
    }

    /**
     * Add initial fluid for a visible background
     */
    addInitialFluid() {
        if (!this.simulator) return;

        // Add several large, vibrant splats to create initial visible fluid
        setTimeout(() => {
            for (let i = 0; i < 8; i++) {
                setTimeout(() => {
                    const x = 0.2 + Math.random() * 0.6;
                    const y = 0.2 + Math.random() * 0.6;
                    const angle = Math.random() * Math.PI * 2;
                    const dx = Math.cos(angle) * 300;
                    const dy = Math.sin(angle) * 300;

                    const color = this.sampleColor(0.1, 0.05);
                    this.simulator.splat(x, y, dx, dy, color);
                }, i * 200);
            }
        }, 300);
    }

    /**
     * Initialize autonomous emitters
     */
    initEmitters() {
        this.emitters = [];
        for (let i = 0; i < this.MAX_EMITTERS; i++) {
            this.emitters.push({
                x: Math.random(),
                y: Math.random(),
                vx: (Math.random() - 0.5) * 0.01,
                vy: (Math.random() - 0.5) * 0.01,
                phase: Math.random() * Math.PI * 2,
                freq: 0.002 + Math.random() * 0.005,
                colorState: this.createColorState(),
            });
        }
    }

    /**
     * Manage emission cycle (burst vs idle)
     */
    setNextEmissionCycle() {
        if (this.emissionState === 'EMITTING') {
            this.emissionState = 'IDLE';
            // Idle for 2.0-3.0 seconds (time to dissipate)
            this.emissionTimer = 2.0 + Math.random() * 1.0;
        } else {
            this.emissionState = 'EMITTING';
            // Burst for 0.4-0.8 seconds (short, subtle burst)
            this.emissionTimer = 0.4 + Math.random() * 0.4;
        }
    }

    updateEmissionCycle(dt) {
        this.emissionTimer -= dt;
        if (this.emissionTimer <= 0) {
            this.setNextEmissionCycle();
        }
    }

    /**
     * Update autonomous emitters
     */
    updateEmitters(deltaTime) {
        if (!this.simulator || !this.isActive) return;

        // Only emit dye during EMITTING state
        if (this.emissionState !== 'EMITTING') return;

        // Slow down emitter movement
        const dt = deltaTime * 0.0001;

        this.emitters.forEach(emitter => {
            // Move emitter in a smooth, wandering path
            emitter.phase += emitter.freq * deltaTime * 0.1; // Slower phase change

            // Update position with some noise/wandering
            // Reduced movement speed
            emitter.x += (Math.cos(emitter.phase) * 0.0005 + emitter.vx * 0.5);
            emitter.y += (Math.sin(emitter.phase * 1.3) * 0.0005 + emitter.vy * 0.5);

            // Bounce off walls
            if (emitter.x < 0 || emitter.x > 1) {
                emitter.vx *= -1;
                emitter.x = Math.max(0, Math.min(1, emitter.x));
            }
            if (emitter.y < 0 || emitter.y > 1) {
                emitter.vy *= -1;
                emitter.y = Math.max(0, Math.min(1, emitter.y));
            }

            // Add splat at emitter position
            // Reduced force for gentler flow
            const forceX = Math.cos(emitter.phase) * 10;
            const forceY = Math.sin(emitter.phase) * 10;

            // Advance color for this emitter
            const color = this.sampleColor(0.008, 0.12, emitter.colorState); // Faster color cycling

            // Add to simulation
            this.simulator.splat(emitter.x, emitter.y, forceX, forceY, color);
        });
    }

    /**
     * Start animation loop
     */
    startAnimation() {
        const animate = (currentTime) => {
            if (!this.isActive) return;

            const deltaTime = (currentTime - this.lastTime) / 1000;
            // Cap dt and apply slow motion factor
            const dt = Math.min(deltaTime, 0.016666) * 0.2; // 5x slower simulation
            this.lastTime = currentTime;

            // Update emission cycle
            this.updateEmissionCycle(deltaTime);

            // Update emitters
            this.updateEmitters(currentTime - (this.lastTime - deltaTime * 1000));

            // Run simulation step
            if (this.simulator) {
                this.simulator.step(dt);
                this.simulator.render(null);
            }

            // Continue animation
            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.lastTime = performance.now();
        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    /**
     * Stop theme
     */
    stop() {
        console.log('[NebulaFlow] stop() called');

        if (!this.isActive) return;

        if (this.colorCycleTimeout) {
            clearTimeout(this.colorCycleTimeout);
            this.colorCycleTimeout = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Call parent stop
        super.stop();

        console.log('[NebulaFlow] Stopped successfully');
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        console.log('[NebulaFlow] cleanup() called');

        // Stop first
        this.stop();

        // Cleanup simulator
        if (this.simulator) {
            this.simulator.cleanup();
            this.simulator = null;
        }

        // Remove canvas
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.emitters = [];
        this.resetColorState();

        // Call parent cleanup
        super.cleanup();

        console.log('[NebulaFlow] Cleaned up successfully');
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

    /**
     * Change color scheme
     */
    setColorScheme(schemeName) {
        this.colorScheme = getColorScheme(schemeName);
        this.currentSchemeName = schemeName;
        console.log('[NebulaFlow] Color scheme changed to:', schemeName);
        this.resetColorState();
        // Also reset emitter colors
        this.emitters.forEach(e => e.colorState = this.createColorState());
    }

    /**
     * Color state management
     */
    createColorState() {
        return {
            current: getRandomColor(this.colorScheme),
            target: getRandomColor(this.colorScheme),
            progress: 0,
        };
    }

    resetColorState() {
        this.colorState = this.createColorState();
    }

    advanceColor(state, step = 0.05) {
        if (!state) {
            state = this.createColorState();
        }

        state.progress = Math.min(1, state.progress + step);
        const color = lerpColor(state.current, state.target, state.progress);

        if (state.progress >= 1) {
            state.current = state.target;
            state.target = getRandomColor(this.colorScheme);
            state.progress = 0;
        }

        return color;
    }

    sampleColor(step = 0.05, ambientBlend = 0.1, state = this.colorState) {
        const base = this.advanceColor(state, step);
        const ambient = this.colorScheme.ambient || [0, 0, 0];
        const mix = Math.max(0, Math.min(1, ambientBlend));

        // Keep colors vibrant without oversaturation
        const color = lerpColor(base, ambient, mix);

        // Convert array [r,g,b] (0-1) to object {r,g,b} (0-1) for simulator
        // Use much lower intensity to prevent white flash on overlaps
        return {
            r: color[0] * 0.45,
            g: color[1] * 0.45,
            b: color[2] * 0.45
        };
    }

    /**
     * Cycle through color palettes for variety
     */
    startColorCycle() {
        const cycleColors = () => {
            if (!this.isActive) return;

            const options = this.availableSchemes.filter(
                (name) => name !== this.currentSchemeName,
            );
            const nextScheme =
                options[Math.floor(Math.random() * options.length)] || this.currentSchemeName;

            this.setColorScheme(nextScheme);

            // Schedule next cycle (20-35 seconds for faster color changes)
            const delay = 20000 + Math.random() * 15000;
            this.colorCycleTimeout = setTimeout(cycleColors, delay);
        };

        // Start first cycle after 15 seconds
        this.colorCycleTimeout = setTimeout(cycleColors, 15000);
    }
}
