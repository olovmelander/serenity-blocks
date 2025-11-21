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
import { NEBULA_FLOW_TETROMINOS } from './nebula-flow-tetrominos.js';

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
        this.MAX_EMITTERS = 4; // Fewer emitters for calmer appearance

        // Color animation state
        this.colorState = null;
        this.resetColorState();

        // Emission Cycle State
        this.emissionState = 'IDLE';
        this.emissionTimer = 0;
        this.setNextEmissionCycle();

        // Fade timer to prevent edge accumulation
        this.fadeTimer = 0;
        this.FADE_INTERVAL = 10; // Gentle fade every 10 seconds

        // Random splat timer for screen-wide coverage
        this.randomSplatTimer = 0;
        this.RANDOM_SPLAT_INTERVAL = 8; // Random splat every 8 seconds (slower)

        console.log('[NebulaFlow] Constructor called');
    }

    async init() {
        console.log('[NebulaFlow] Initializing theme');
    }

    /**
     * Get tetromino visual configuration for this theme
     * @returns {Object} Tetromino configuration
     */
    getTetrominoConfig() {
        return NEBULA_FLOW_TETROMINOS;
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

            // Get or create the theme container and add canvas
            let container = document.getElementById('nebula-flow-theme');
            if (!container) {
                // Container was removed during cache eviction, recreate it
                container = document.createElement('div');
                container.id = 'nebula-flow-theme';
                container.className = 'theme-container';
                const backgroundContainer = document.getElementById('background-container');
                if (backgroundContainer) {
                    backgroundContainer.appendChild(container);
                } else {
                    document.body.appendChild(container);
                }
                console.log('[NebulaFlow] Theme container recreated');
            }
            container.appendChild(this.canvas);
            this.registerContainer(container);

            // Get quality setting (all levels use same extreme config)
            const quality = this.getQualitySetting();

            // Create fluid simulator with unified configuration
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

            // Reset timers
            this.fadeTimer = 0;
            this.randomSplatTimer = 0;

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
        // All quality levels use extreme settings for best experience
        // The simulation performs excellently, so no need to compromise
        const extremeConfig = {
            SIM_RESOLUTION: 320,
            DYE_RESOLUTION: 1280,
            DENSITY_DISSIPATION: 1.2,
            VELOCITY_DISSIPATION: 0.8,
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: 25,
            CURL: 45,
            SPLAT_RADIUS: 0.2,
            SPLAT_FORCE: 2500,
            SHADING: false,
            COLORFUL: true,
            BLOOM: false,
            SUNRAYS: false,
        };

        // All quality settings use the same extreme configuration
        const config = extremeConfig;

        return {
            ...config,
            BLOOM_ITERATIONS: 8,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 0.8,
            BLOOM_THRESHOLD: 0.6,
            BLOOM_SOFT_KNEE: 0.7,
            SUNRAYS_RESOLUTION: 196,
            SUNRAYS_WEIGHT: 1.0,
            BACK_COLOR: { r: 0, g: 0, b: 0 },
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

        // More dramatic effects for multi-line clears
        if (lineCount >= 4) {
            // Tetris! Create a wave effect
            this.createWaveEffect(lineCount);
        } else if (lineCount >= 2) {
            // Double/Triple - cascading horizontal flow
            this.createCascadeEffect(lineCount);
        } else {
            // Single line - simple flow
            this.createSimpleLineEffect(lineCount);
        }
    }

    /**
     * Simple line clear effect
     */
    createSimpleLineEffect(lineCount) {
        const splatCount = 4;
        for (let i = 0; i < splatCount; i++) {
            setTimeout(() => {
                this.addFlowingSplat(0.25);
            }, i * 100);
        }
    }

    /**
     * Cascading effect for double/triple line clears
     */
    createCascadeEffect(lineCount) {
        const splatCount = lineCount * 3;
        const intensity = 0.3 + (lineCount * 0.03);

        for (let i = 0; i < splatCount; i++) {
            setTimeout(() => {
                // Create horizontal wave pattern
                const x = (i / splatCount) + Math.random() * 0.2;
                const y = 0.3 + Math.random() * 0.4;
                
                const angle = Math.PI * 0.5 + (Math.random() - 0.5) * 0.5;
                const force = intensity * 500;
                const dx = Math.cos(angle) * force;
                const dy = Math.sin(angle) * force;

                const color = this.sampleColor(0.08, 0.08);
                this.simulator.splat(x, y, dx, dy, color);
            }, i * 80);
        }
    }

    /**
     * Wave effect for Tetris (4 lines)
     */
    createWaveEffect(lineCount) {
        const waveCount = 16;
        const intensity = 0.4 + (lineCount * 0.04);

        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => {
                // Create a flowing wave from left to right
                const progress = i / waveCount;
                const x = progress;
                const y = 0.5 + Math.sin(progress * Math.PI * 2) * 0.2;
                
                const angle = Math.PI * 0.25 + progress * Math.PI * 0.5;
                const force = intensity * 600;
                const dx = Math.cos(angle) * force;
                const dy = Math.sin(angle) * force;

                const color = this.sampleColor(0.1, 0.07);
                this.simulator.splat(x, y, dx, dy, color);

                // Add mirrored wave
                const yMirror = 0.5 - Math.sin(progress * Math.PI * 2) * 0.2;
                const dyMirror = -Math.sin(angle) * force;
                const color2 = this.sampleColor(0.1, 0.07);
                this.simulator.splat(x, yMirror, dx, dyMirror, color2);
            }, i * 50);
        }
    }

    /**
     * React to combos with spectacular swirling effects
     */
    onCombo(comboCount) {
        if (!this.simulator) return;

        // Intensity increases with combo count
        const intensity = Math.min(0.5, 0.25 + comboCount * 0.025);
        const spiralCount = Math.min(comboCount + 4, 16);

        // Pattern type based on combo count
        if (comboCount >= 8) {
            // Epic combo: Triple spiral explosion
            this.createTripleSpiralEffect(comboCount, intensity, spiralCount);
        } else if (comboCount >= 4) {
            // High combo: Dual spiral with rings
            this.createDualSpiralEffect(comboCount, intensity, spiralCount);
        } else {
            // Regular combo: Single spiral
            this.createSingleSpiralEffect(comboCount, intensity, spiralCount);
        }

        // Add central burst for combos 2+
        if (comboCount >= 2) {
            setTimeout(() => {
                this.createCentralBurst(comboCount, intensity);
            }, spiralCount * 40);
        }
    }

    /**
     * Single spiral effect for low combos
     */
    createSingleSpiralEffect(comboCount, intensity, spiralCount) {
        const centerX = 0.5;
        const centerY = 0.5;

        for (let i = 0; i < spiralCount; i++) {
            setTimeout(() => {
                const angle = (i / spiralCount) * Math.PI * 2;
                const radius = 0.25 + (comboCount * 0.02);

                const x = centerX + Math.cos(angle) * radius;
                const y = centerY + Math.sin(angle) * radius;

                // Velocity creates swirling motion
                const vx = -Math.sin(angle) * intensity * 700;
                const vy = Math.cos(angle) * intensity * 700;

                const color = this.sampleColor(0.1, 0.08);
                this.simulator.splat(x, y, vx, vy, color);
            }, i * 50);
        }
    }

    /**
     * Dual spiral effect for medium combos
     */
    createDualSpiralEffect(comboCount, intensity, spiralCount) {
        const centerX = 0.5;
        const centerY = 0.5;

        for (let i = 0; i < spiralCount; i++) {
            setTimeout(() => {
                const angle = (i / spiralCount) * Math.PI * 2;
                const radius = 0.3 + (comboCount * 0.015);

                // First spiral (clockwise)
                const x1 = centerX + Math.cos(angle) * radius;
                const y1 = centerY + Math.sin(angle) * radius;
                const vx1 = -Math.sin(angle) * intensity * 750;
                const vy1 = Math.cos(angle) * intensity * 750;

                // Second spiral (counter-clockwise)
                const x2 = centerX + Math.cos(-angle) * (radius * 0.6);
                const y2 = centerY + Math.sin(-angle) * (radius * 0.6);
                const vx2 = -Math.sin(-angle) * intensity * 650;
                const vy2 = Math.cos(-angle) * intensity * 650;

                const color1 = this.sampleColor(0.12, 0.08);
                const color2 = this.sampleColor(0.12, 0.08);

                this.simulator.splat(x1, y1, vx1, vy1, color1);
                this.simulator.splat(x2, y2, vx2, vy2, color2);
            }, i * 45);
        }
    }

    /**
     * Triple spiral effect for epic combos
     */
    createTripleSpiralEffect(comboCount, intensity, spiralCount) {
        const centerX = 0.5;
        const centerY = 0.5;

        for (let i = 0; i < spiralCount; i++) {
            setTimeout(() => {
                const angle = (i / spiralCount) * Math.PI * 2;
                
                // Three spirals at different radii
                for (let ring = 0; ring < 3; ring++) {
                    const radius = (0.2 + ring * 0.12) + (comboCount * 0.01);
                    const direction = ring % 2 === 0 ? 1 : -1; // Alternate direction
                    
                    const x = centerX + Math.cos(angle * direction) * radius;
                    const y = centerY + Math.sin(angle * direction) * radius;
                    const vx = -Math.sin(angle * direction) * intensity * (800 - ring * 100);
                    const vy = Math.cos(angle * direction) * intensity * (800 - ring * 100);

                    const color = this.sampleColor(0.15, 0.06);
                    this.simulator.splat(x, y, vx, vy, color);
                }
            }, i * 40);
        }
    }

    /**
     * Create a central burst explosion
     */
    createCentralBurst(comboCount, intensity) {
        const burstCount = Math.min(comboCount * 2, 20);
        const centerX = 0.5;
        const centerY = 0.5;

        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => {
                const angle = (i / burstCount) * Math.PI * 2;
                const force = intensity * 800;
                
                const vx = Math.cos(angle) * force;
                const vy = Math.sin(angle) * force;

                const color = this.sampleColor(0.1, 0.1);
                this.simulator.splat(centerX, centerY, vx, vy, color);
            }, i * 20);
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

        // Add splats across the screen for initial presence
        setTimeout(() => {
            const numSplats = 6; // Fewer initial splats for calmer start
            for (let i = 0; i < numSplats; i++) {
                setTimeout(() => {
                    // Distribute across screen
                    const x = 0.15 + Math.random() * 0.7;
                    const y = 0.15 + Math.random() * 0.7;
                    const angle = Math.random() * Math.PI * 2;
                    const force = 150 + Math.random() * 150; // Gentler force
                    const dx = Math.cos(angle) * force;
                    const dy = Math.sin(angle) * force;

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
            this.emitters.push(this.createEmitter());
        }
    }

    /**
     * Create a new emitter with random properties
     */
    createEmitter() {
        return {
            x: 0.2 + Math.random() * 0.6, // Start away from edges
            y: 0.2 + Math.random() * 0.6,
            vx: (Math.random() - 0.5) * 0.008, // Slower, gentler movement
            vy: (Math.random() - 0.5) * 0.008,
            phase: Math.random() * Math.PI * 2,
            freq: 0.001 + Math.random() * 0.003, // Slower frequencies
            colorState: this.createColorState(),
            lifetime: 20 + Math.random() * 30, // Respawn after 20-50 seconds (longer)
            age: 0,
        };
    }

    /**
     * Manage emission cycle (burst vs idle)
     */
    setNextEmissionCycle() {
        if (this.emissionState === 'EMITTING') {
            this.emissionState = 'IDLE';
            // Idle for 3.0-6.0 seconds (longer, more varied idle times)
            this.emissionTimer = 3.0 + Math.random() * 3.0;
        } else {
            this.emissionState = 'EMITTING';
            // Burst for 0.3-0.8 seconds (short, subtle bursts)
            this.emissionTimer = 0.3 + Math.random() * 0.5;
        }
    }

    updateEmissionCycle(dt) {
        this.emissionTimer -= dt;
        if (this.emissionTimer <= 0) {
            this.setNextEmissionCycle();
        }
    }

    /**
     * Apply a gentle fade to prevent long-term fluid accumulation at edges
     */
    applyGentleFade() {
        if (!this.simulator || !this.simulator.programs || !this.simulator.dye) return;

        const gl = this.simulator.gl;
        const clearProgram = this.simulator.programs.clear;

        if (!clearProgram) return;

        // Very subtle fade - multiply dye by 0.95 (5% reduction)
        clearProgram.bind();
        gl.uniform1i(clearProgram.uniforms.uTexture, this.simulator.dye.read.attach(0));
        gl.uniform1f(clearProgram.uniforms.value, 0.95);
        this.simulator.blit(this.simulator.dye.write);
        this.simulator.dye.swap();
    }

    /**
     * Add a random splat anywhere on screen for full coverage
     */
    addRandomScreenSplat() {
        if (!this.simulator) return;

        // Random position across entire screen
        const x = 0.15 + Math.random() * 0.7;
        const y = 0.15 + Math.random() * 0.7;

        // Random direction and force (gentler)
        const angle = Math.random() * Math.PI * 2;
        const force = 100 + Math.random() * 150; // Reduced force
        const dx = Math.cos(angle) * force;
        const dy = Math.sin(angle) * force;

        // Get a random color
        const color = this.sampleColor(0.08, 0.1);
        
        this.simulator.splat(x, y, dx, dy, color);
    }

    /**
     * Update autonomous emitters
     */
    updateEmitters(deltaTime) {
        if (!this.simulator || !this.isActive) return;

        // Only emit dye during EMITTING state
        if (this.emissionState !== 'EMITTING') return;

        // deltaTime should be in milliseconds, normalize to seconds
        const dt = deltaTime / 1000;

        this.emitters.forEach((emitter, index) => {
            // Update emitter age and respawn if needed
            emitter.age += dt;
            if (emitter.age >= emitter.lifetime) {
                // Respawn emitter at new random location
                const newEmitter = this.createEmitter();
                this.emitters[index] = newEmitter;
                return; // Skip this frame for the new emitter
            }

            // Move emitter in a smooth, wandering path
            emitter.phase += emitter.freq * dt; // Smooth phase change

            // Update position with some noise/wandering
            // Scale movement by delta time for consistent speed regardless of FPS
            const moveSpeed = dt * 0.3; // Slower, gentler movement
            emitter.x += Math.cos(emitter.phase) * moveSpeed + emitter.vx * dt;
            emitter.y += Math.sin(emitter.phase * 1.3) * moveSpeed + emitter.vy * dt;

            // Wrap around screen edges instead of bouncing - creates flow across entire screen
            if (emitter.x < 0) emitter.x += 1;
            if (emitter.x > 1) emitter.x -= 1;
            if (emitter.y < 0) emitter.y += 1;
            if (emitter.y > 1) emitter.y -= 1;

            // Add splat at emitter position with varied force
            const forceVariation = 0.6 + Math.random() * 0.4; // Vary force 60-100% (gentler)
            const forceX = Math.cos(emitter.phase) * 8 * forceVariation;
            const forceY = Math.sin(emitter.phase) * 8 * forceVariation;

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

            // Calculate delta time, but handle first frame and large gaps
            if (this.lastTime === 0) {
                this.lastTime = currentTime;
            }
            
            let deltaTime = (currentTime - this.lastTime) / 1000;
            this.lastTime = currentTime;

            // Cap extremely large time steps (e.g. when tab is inactive)
            // but don't cap normal frame variations
            if (deltaTime > 0.1) {
                deltaTime = 0.016666; // Reset to 60fps equivalent
            }

            // Apply slow motion factor for gentle fluid movement
            const dt = deltaTime * 0.2; // 5x slower simulation

            // Update emission cycle
            this.updateEmissionCycle(deltaTime);

            // Update fade timer - gentle periodic fade to prevent edge accumulation
            this.fadeTimer += deltaTime;
            if (this.fadeTimer >= this.FADE_INTERVAL) {
                this.fadeTimer = 0;
                // Apply a very gentle fade to the entire simulation
                if (this.simulator && this.simulator.programs && this.simulator.programs.clear) {
                    this.applyGentleFade();
                }
            }

            // Random splat timer - adds splats across entire screen for full coverage
            this.randomSplatTimer += deltaTime;
            if (this.randomSplatTimer >= this.RANDOM_SPLAT_INTERVAL) {
                this.randomSplatTimer = 0;
                this.addRandomScreenSplat();
            }

            // Update emitters
            this.updateEmitters(deltaTime * 1000); // Pass in milliseconds

            // Run simulation step
            if (this.simulator) {
                this.simulator.step(dt);
                this.simulator.render(null);
            }

            // Continue animation
            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.lastTime = 0; // Will be set on first frame
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
        this.fadeTimer = 0;
        this.randomSplatTimer = 0;

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
