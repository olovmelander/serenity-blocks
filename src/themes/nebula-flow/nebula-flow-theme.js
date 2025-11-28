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
import FluidSimulator from '../../utils/webgl/fluid-simulator.js';
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

        // Autonomous Emitters (will be scaled by quality in initEmitters)
        this.emitters = [];
        this.BASE_MAX_EMITTERS = 4; // Base count, scaled by quality
        this.MAX_EMITTERS = 4;

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
        // Quality presets with distinct visual differences
        const presets = {
            low: {
                SIM_RESOLUTION: 128,
                DYE_RESOLUTION: 512,
                DENSITY_DISSIPATION: 1.4,
                VELOCITY_DISSIPATION: 0.9,
                PRESSURE: 0.6,
                PRESSURE_ITERATIONS: 10,
                CURL: 20,
                SPLAT_RADIUS: 0.15,
                SPLAT_FORCE: 1500,
                SHADING: false,
                COLORFUL: true,
                BLOOM: false,
                SUNRAYS: false,
                BLOOM_ITERATIONS: 4,
                BLOOM_RESOLUTION: 128,
            },
            medium: {
                SIM_RESOLUTION: 192,
                DYE_RESOLUTION: 768,
                DENSITY_DISSIPATION: 1.3,
                VELOCITY_DISSIPATION: 0.85,
                PRESSURE: 0.7,
                PRESSURE_ITERATIONS: 15,
                CURL: 30,
                SPLAT_RADIUS: 0.18,
                SPLAT_FORCE: 2000,
                SHADING: false,
                COLORFUL: true,
                BLOOM: false,
                SUNRAYS: false,
                BLOOM_ITERATIONS: 6,
                BLOOM_RESOLUTION: 192,
            },
            high: {
                SIM_RESOLUTION: 256,
                DYE_RESOLUTION: 1024,
                DENSITY_DISSIPATION: 1.25,
                VELOCITY_DISSIPATION: 0.82,
                PRESSURE: 0.75,
                PRESSURE_ITERATIONS: 20,
                CURL: 38,
                SPLAT_RADIUS: 0.19,
                SPLAT_FORCE: 2250,
                SHADING: false,
                COLORFUL: true,
                BLOOM: false,
                SUNRAYS: false,
                BLOOM_ITERATIONS: 7,
                BLOOM_RESOLUTION: 224,
            },
            extreme: {
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
                BLOOM_ITERATIONS: 8,
                BLOOM_RESOLUTION: 256,
            },
        };

        // Store quality multiplier for scaling effects
        this.qualityMultipliers = {
            low: 0.4,
            medium: 0.65,
            high: 0.85,
            extreme: 1.0,
        };
        this.currentQualityMultiplier = this.qualityMultipliers[quality] || this.qualityMultipliers.medium;

        const config = presets[quality] || presets.medium;
        console.log(`[NebulaFlow] Applying ${quality} quality preset (multiplier: ${this.currentQualityMultiplier})`);

        return {
            ...config,
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
    createSimpleLineEffect() {
        const q = this.currentQualityMultiplier || 0.65;
        const splatCount = Math.max(1, Math.round(6 * q)); // Increased from 4 for more puffs
        for (let i = 0; i < splatCount; i++) {
            setTimeout(() => {
                this.addFlowingSplat(1.3 * q); // EXTREME force for massive puffs
            }, i * 100);
        }

        // Add even more emitter-style puffs for line clear
        this.triggerEmitterPuffs(12, 1200); // Increased from 8
    }

    /**
     * Cascading effect for double/triple line clears
     */
    createCascadeEffect(lineCount) {
        const q = this.currentQualityMultiplier || 0.65;
        const splatCount = Math.max(3, Math.round(lineCount * 4 * q)); // More splats
        const intensity = (1.6 + (lineCount * 0.12)) * q; // EXTREME intensity boost

        for (let i = 0; i < splatCount; i++) {
            setTimeout(() => {
                // Create horizontal wave pattern
                const x = (i / splatCount) + Math.random() * 0.2;
                const y = 0.3 + Math.random() * 0.4;

                const angle = Math.PI * 0.5 + (Math.random() - 0.5) * 0.5;
                const force = intensity * 2200; // EXTREME force for insane cascades
                const dx = Math.cos(angle) * force;
                const dy = Math.sin(angle) * force;

                const color = this.sampleColor(0.16, 0.08); // Even more vibrant
                this.simulator.splat(x, y, dx, dy, color);
            }, i * 80);
        }

        // Add even more emitter-style puffs for multi-line clears
        this.triggerEmitterPuffs(18, 1500); // Increased from 12
    }

    /**
     * Wave effect for Tetris (4 lines)
     */
    createWaveEffect(lineCount) {
        const q = this.currentQualityMultiplier || 0.65;
        const waveCount = Math.max(6, Math.round(20 * q)); // More waves for epic effect
        const intensity = (2.0 + (lineCount * 0.2)) * q; // EXTREME intensity for legendary Tetris

        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => {
                // Create a flowing wave from left to right
                const progress = i / waveCount;
                const x = progress;
                const y = 0.5 + Math.sin(progress * Math.PI * 2) * 0.2;

                const angle = Math.PI * 0.25 + progress * Math.PI * 0.5;
                const force = intensity * 2500; // EXTREME force for legendary Tetris waves
                const dx = Math.cos(angle) * force;
                const dy = Math.sin(angle) * force;

                const color = this.sampleColor(0.2, 0.07); // Maximum vibrancy
                this.simulator.splat(x, y, dx, dy, color);

                // Add mirrored wave only on higher quality
                if (q >= 0.6) {
                    const yMirror = 0.5 - Math.sin(progress * Math.PI * 2) * 0.2;
                    const dyMirror = -Math.sin(angle) * force;
                    const color2 = this.sampleColor(0.2, 0.07);
                    this.simulator.splat(x, yMirror, dx, dyMirror, color2);
                }
            }, i * 50);
        }

        // Add massive emitter-style puffs for epic Tetris
        this.triggerEmitterPuffs(24, 2000); // Increased from 16
    }

    /**
     * React to combos with spectacular swirling effects
     */
    onCombo(comboCount) {
        if (!this.simulator) return;

        const q = this.currentQualityMultiplier || 0.65;

        // Intensity increases with combo count, scaled by quality - dramatically increased
        const intensity = Math.min(1.2, 0.65 + comboCount * 0.05) * q; // Much bigger base and scaling
        const spiralCount = Math.max(2, Math.round(Math.min(comboCount + 4, 16) * q));

        // Pattern type based on combo count
        if (comboCount >= 8) {
            // Epic combo: Triple spiral explosion (simplified on low quality)
            if (q >= 0.6) {
                this.createTripleSpiralEffect(comboCount, intensity, spiralCount);
            } else {
                this.createDualSpiralEffect(comboCount, intensity, spiralCount);
            }
        } else if (comboCount >= 4) {
            // High combo: Dual spiral with rings (single on low quality)
            if (q >= 0.5) {
                this.createDualSpiralEffect(comboCount, intensity, spiralCount);
            } else {
                this.createSingleSpiralEffect(comboCount, intensity, spiralCount);
            }
        } else {
            // Regular combo: Single spiral
            this.createSingleSpiralEffect(comboCount, intensity, spiralCount);
        }

        // Add central burst for combos 2+ (skip on lowest quality)
        if (comboCount >= 2 && q >= 0.5) {
            setTimeout(() => {
                this.createCentralBurst(comboCount, intensity);
            }, spiralCount * 40);
        }
    }

    /**
     * Single spiral effect for low combos
     */
    createSingleSpiralEffect(comboCount, intensity, spiralCount) {
        const q = this.currentQualityMultiplier || 0.65;
        const centerX = 0.5;
        const centerY = 0.5;

        for (let i = 0; i < spiralCount; i++) {
            setTimeout(() => {
                const angle = (i / spiralCount) * Math.PI * 2;
                const radius = 0.25 + (comboCount * 0.02);

                const x = centerX + Math.cos(angle) * radius;
                const y = centerY + Math.sin(angle) * radius;

                // Velocity creates swirling motion - much bigger
                const vx = -Math.sin(angle) * intensity * 1400 * q; // Dramatically increased
                const vy = Math.cos(angle) * intensity * 1400 * q;

                const color = this.sampleColor(0.15, 0.08);
                this.simulator.splat(x, y, vx, vy, color);
            }, i * 50);
        }
    }

    /**
     * Dual spiral effect for medium combos
     */
    createDualSpiralEffect(comboCount, intensity, spiralCount) {
        const q = this.currentQualityMultiplier || 0.65;
        const centerX = 0.5;
        const centerY = 0.5;

        for (let i = 0; i < spiralCount; i++) {
            setTimeout(() => {
                const angle = (i / spiralCount) * Math.PI * 2;
                const radius = 0.3 + (comboCount * 0.015);

                // First spiral (clockwise) - much bigger force
                const x1 = centerX + Math.cos(angle) * radius;
                const y1 = centerY + Math.sin(angle) * radius;
                const vx1 = -Math.sin(angle) * intensity * 1500 * q; // Dramatically increased
                const vy1 = Math.cos(angle) * intensity * 1500 * q;

                const color1 = this.sampleColor(0.16, 0.08);
                this.simulator.splat(x1, y1, vx1, vy1, color1);

                // Second spiral only on medium+ quality
                if (q >= 0.6) {
                    const x2 = centerX + Math.cos(-angle) * (radius * 0.6);
                    const y2 = centerY + Math.sin(-angle) * (radius * 0.6);
                    const vx2 = -Math.sin(-angle) * intensity * 1350 * q; // Dramatically increased
                    const vy2 = Math.cos(-angle) * intensity * 1350 * q;

                    const color2 = this.sampleColor(0.16, 0.08);
                    this.simulator.splat(x2, y2, vx2, vy2, color2);
                }
            }, i * 45);
        }
    }

    /**
     * Triple spiral effect for epic combos
     */
    createTripleSpiralEffect(comboCount, intensity, spiralCount) {
        const q = this.currentQualityMultiplier || 0.65;
        const centerX = 0.5;
        const centerY = 0.5;

        // Reduce rings on lower quality
        const maxRings = q >= 0.85 ? 3 : 2;

        for (let i = 0; i < spiralCount; i++) {
            setTimeout(() => {
                const angle = (i / spiralCount) * Math.PI * 2;

                // Spirals at different radii
                for (let ring = 0; ring < maxRings; ring++) {
                    const radius = (0.2 + ring * 0.12) + (comboCount * 0.01);
                    const direction = ring % 2 === 0 ? 1 : -1; // Alternate direction

                    const x = centerX + Math.cos(angle * direction) * radius;
                    const y = centerY + Math.sin(angle * direction) * radius;
                    const vx = -Math.sin(angle * direction) * intensity * (1700 - ring * 100) * q; // Massively increased
                    const vy = Math.cos(angle * direction) * intensity * (1700 - ring * 100) * q;

                    const color = this.sampleColor(0.2, 0.06);
                    this.simulator.splat(x, y, vx, vy, color);
                }
            }, i * 40);
        }
    }

    /**
     * Create a central burst explosion
     */
    createCentralBurst(comboCount, intensity) {
        const q = this.currentQualityMultiplier || 0.65;
        const burstCount = Math.max(2, Math.round(Math.min(comboCount * 2, 20) * q));
        const centerX = 0.5;
        const centerY = 0.5;

        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => {
                const angle = (i / burstCount) * Math.PI * 2;
                const force = intensity * 1600 * q; // Massively increased for epic burst

                const vx = Math.cos(angle) * force;
                const vy = Math.sin(angle) * force;

                const color = this.sampleColor(0.15, 0.1);
                this.simulator.splat(centerX, centerY, vx, vy, color);
            }, i * 20);
        }
    }

    /**
     * React to piece locks with bigger pulse
     */
    onPieceLock() {
        if (!this.simulator) return;
        // Bigger ripple effect for piece locks
        this.addFlowingSplat(0.8);
    }

    /**
     * Add a flowing splat that drifts across the screen
     */
    addFlowingSplat(intensity = 0.5) {
        if (!this.simulator) return;

        const x = Math.random();
        const y = Math.random();

        const angle = Math.random() * Math.PI * 2;
        const force = intensity * 1000; // Dramatically increased for much bigger puffs
        const dx = Math.cos(angle) * force;
        const dy = Math.sin(angle) * force;

        const color = this.sampleColor(0.1, 0.08);
        this.simulator.splat(x, y, dx, dy, color);
    }

    /**
     * Add initial fluid for a visible background
     */
    addInitialFluid() {
        if (!this.simulator) return;

        const q = this.currentQualityMultiplier || 0.65;

        // Add splats across the screen for initial presence (scaled by quality)
        setTimeout(() => {
            const numSplats = Math.max(2, Math.round(6 * q));
            for (let i = 0; i < numSplats; i++) {
                setTimeout(() => {
                    // Distribute across screen
                    const x = 0.15 + Math.random() * 0.7;
                    const y = 0.15 + Math.random() * 0.7;
                    const angle = Math.random() * Math.PI * 2;
                    const force = (150 + Math.random() * 150) * q; // Scaled force
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
        const q = this.currentQualityMultiplier || 0.65;
        // Scale emitter count by quality: low=1, medium=2, high=3, extreme=4
        this.MAX_EMITTERS = Math.max(1, Math.round(this.BASE_MAX_EMITTERS * q));
        this.emitters = [];
        for (let i = 0; i < this.MAX_EMITTERS; i++) {
            this.emitters.push(this.createEmitter());
        }
        console.log(`[NebulaFlow] Initialized ${this.MAX_EMITTERS} emitters for quality multiplier ${q}`);
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

        const { gl } = this.simulator;
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

        const q = this.currentQualityMultiplier || 0.65;

        // Random position across entire screen
        const x = 0.15 + Math.random() * 0.7;
        const y = 0.15 + Math.random() * 0.7;

        // Random direction and force (scaled by quality)
        const angle = Math.random() * Math.PI * 2;
        const force = (100 + Math.random() * 150) * q;
        const dx = Math.cos(angle) * force;
        const dy = Math.sin(angle) * force;

        // Get a random color
        const color = this.sampleColor(0.08, 0.1);

        this.simulator.splat(x, y, dx, dy, color);
    }

    /**
     * Trigger emitter-style puffs (called during line clears)
     */
    triggerEmitterPuffs(count = 8, duration = 1000) {
        if (!this.simulator || !this.isActive) return;

        const q = this.currentQualityMultiplier || 0.65;
        const puffCount = Math.max(2, Math.round(count * q));

        for (let i = 0; i < puffCount; i++) {
            setTimeout(() => {
                // Random position across screen
                const x = 0.2 + Math.random() * 0.6;
                const y = 0.2 + Math.random() * 0.6;

                // EXTREME force for mind-blowing puffs
                const angle = Math.random() * Math.PI * 2;
                const force = (600 + Math.random() * 600) * q; // EXTREME: 600-1200 range
                const forceX = Math.cos(angle) * force;
                const forceY = Math.sin(angle) * force;

                // Get a vibrant color
                const color = this.sampleColor(0.18, 0.12);

                this.simulator.splat(x, y, forceX, forceY, color);
            }, (i / puffCount) * duration);
        }
    }

    /**
     * Update autonomous emitters - DISABLED (now only triggered on line clears)
     */
    updateEmitters() {
        // Automatic emission disabled - only triggered manually on line clears

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

            // Random splat timer - DISABLED (only triggered on line clears now)
            // this.randomSplatTimer += deltaTime;
            // if (this.randomSplatTimer >= this.RANDOM_SPLAT_INTERVAL) {
            //     this.randomSplatTimer = 0;
            //     this.addRandomScreenSplat();
            // }

            // Update emitters - DISABLED (only triggered on line clears now)
            // this.updateEmitters(deltaTime * 1000); // Pass in milliseconds

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
        this.eventUnsubscribers.forEach((unsub) => unsub());
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
        this.emitters.forEach((e) => e.colorState = this.createColorState());
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
            b: color[2] * 0.45,
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
            const nextScheme = options[Math.floor(Math.random() * options.length)] || this.currentSchemeName;

            this.setColorScheme(nextScheme);

            // Schedule next cycle (20-35 seconds for faster color changes)
            const delay = 20000 + Math.random() * 15000;
            this.colorCycleTimeout = setTimeout(cycleColors, delay);
        };

        // Start first cycle after 15 seconds
        this.colorCycleTimeout = setTimeout(cycleColors, 15000);
    }
}
