/**
 * Nebula Flow Theme - GPU-accelerated fluid animation background
 *
 * Features:
 * - Real-time fluid dynamics simulation using WebGL
 * - Multiple color schemes (cosmic, ocean, aurora)
 * - Interactive mouse/touch input
 * - Game event reactions (combos, line clears)
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
        this.starCanvas = null;
        this.starContext = null;
        this.starDpr = 1;
        this.stars = [];
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;

        // Configuration
        this.currentSchemeName = 'cosmic';
        this.colorScheme = getColorScheme(this.currentSchemeName);
        this.availableSchemes = ['cosmic', 'aurora', 'ocean', 'prismatic'];
        this.autoSplatInterval = null;
        this.gentleFlowInterval = null;
        this.colorCycleInterval = null;
        this.colorCycleTimeout = null;
        this.pointerSplatCooldown = 500; // Increase from 220ms to 500ms - much less frequent!
        this.lastPointerSplatTime = 0;
        this.pendingSplatTimeouts = new Set();
        this.activeInjections = new Map();
        this.injectionQueue = [];
        this.maxConcurrentInjections = 6;

        // Mouse tracking
        this.pointerX = 0;
        this.pointerY = 0;
        this.pointerDown = false;
        this.colorState = null;
        this.starColorState = null;
        this.resetColorState();

        console.log('[NebulaFlow] Constructor called');
    }

    async init() {
        console.log('[NebulaFlow] Initializing theme');
        // Initialization happens in createScene
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
            this.canvas.style.pointerEvents = 'none'; // Let game events pass through

            // TEMP: Add border to verify canvas is visible
            console.log('[NebulaFlow] Canvas element created with ID:', this.canvas.id);

            // Set canvas size
            this.resize(window.innerWidth, window.innerHeight);

            // Get the theme container and add canvas
            const container = document.getElementById('nebula-flow-theme');
            if (container) {
                this.createStarfieldLayer(container);
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
            if (this.starCanvas) {
                this.addWebGLLayer(this.starCanvas, -2);
            }
            this.addWebGLLayer(this.canvas, -1); // Behind game

            // Setup mouse/touch interaction
            this.setupInteraction();

            // Setup game event listeners
            this.setupEventListeners();

            // Start animation loop
            this.startAnimation();

            // Start ambient motion
            this.startAmbientMotion();

            // Cycle through complementary color palettes
            this.startColorCycle();

            // Add 2 initial splats with smooth, slow appearance
            console.log('[NebulaFlow] Adding initial splats...');
            this.scheduleTimeout(() => {
                this.addRandomSplat(true, 0.15, {
                    fadeIn: 3.0,    // Very slow fade in
                    hold: 2.0,
                    fadeOut: 6.0,   // Very slow fade out
                });
            }, 1000);
            this.scheduleTimeout(() => {
                this.addRandomSplat(true, 0.15, {
                    fadeIn: 3.0,
                    hold: 2.0,
                    fadeOut: 6.0,
                });
            }, 2500);

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
            simResolution: 128,
            dyeResolution: 512,
            pressureIterations: 4,
            velocityDissipation: 0.986,
            densityDissipation: 0.9985, // Extremely slow fade for cohesive trails
            splatRadius: 0.26,
            splatForce: 2000,
            bloomIntensity: 0.22,
            timeScale: 0.32,
        };

        // Adjust based on quality
        const qualityMultipliers = {
            low: { sim: 0.55, dye: 0.55, iterations: 3, bloom: 0.16, force: 0.75, time: 0.36 },
            medium: { sim: 1.0, dye: 1.0, iterations: 4, bloom: 0.24, force: 1.0, time: 0.32 },
            high: { sim: 1.45, dye: 1.45, iterations: 5, bloom: 0.32, force: 1.18, time: 0.28 },
        };

        const multiplier = qualityMultipliers[quality] || qualityMultipliers.medium;

        return {
            ...baseConfig,
            simResolution: Math.floor(baseConfig.simResolution * multiplier.sim),
            dyeResolution: Math.floor(baseConfig.dyeResolution * multiplier.dye),
            pressureIterations: multiplier.iterations,
            bloomIntensity: multiplier.bloom,
            splatForce: baseConfig.splatForce * multiplier.force,
            timeScale: multiplier.time,
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
     * Setup mouse/touch interaction
     */
    setupInteraction() {
        // Track pointer movement across the whole window
        const canvas = this.canvas;

        const handlePointerMove = (e) => {
            if (!this.isActive || !this.simulator) return;

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Calculate movement delta
            const dx = x - this.pointerX;
            const dy = y - this.pointerY;

            this.pointerX = x;
            this.pointerY = y;

            // Only add splat if there's significant movement
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                const now = performance.now();
                if (now - this.lastPointerSplatTime < this.pointerSplatCooldown) {
                    return;
                }

                this.lastPointerSplatTime = now;

                const pointerScale = this.pointerDown ? 0.006 : 0.0025;
                const softenedDx = dx * pointerScale;
                const softenedDy = dy * pointerScale;
                const color = this.getPointerColor();

                this.injectFluid(x, y, softenedDx, softenedDy, color, {
                    fadeIn: this.pointerDown ? 0.6 : 0.95,
                    hold: this.pointerDown ? 0.45 : 0.65,
                    fadeOut: this.pointerDown ? 2.4 : 3.4,
                    drift: 0.02,
                });
            }
        };

        const handlePointerDown = (e) => {
            this.pointerDown = true;
            this.lastPointerSplatTime = 0;
            const rect = canvas.getBoundingClientRect();
            this.pointerX = e.clientX - rect.left;
            this.pointerY = e.clientY - rect.top;
        };

        const handlePointerUp = () => {
            this.pointerDown = false;
        };

        // Add event listeners to window for full coverage
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointerup', handlePointerUp);

        // Store for cleanup
        this.interactionCleanup = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('pointerup', handlePointerUp);
        };
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
     * React to line clears with splats
     */
    onLineClear(lineCount) {
        console.log('[NebulaFlow] onLineClear called with lineCount:', lineCount);

        if (!this.simulator) return;

        // Create splats based on line count
        const splatCount = Math.max(1, Math.floor(lineCount / 2));
        for (let i = 0; i < splatCount; i++) {
            this.scheduleTimeout(() => {
                const intensity = 0.42 + Math.min(lineCount, 4) * 0.04;
                this.addRandomSplat(true, intensity, { fadeIn: 1.1, fadeOut: 3.2, hold: 0.5 });
            }, i * 220);
        }
    }

    /**
     * React to combos with intense splats
     */
    onCombo(comboCount) {
        console.log('[NebulaFlow] onCombo called with comboCount:', comboCount);

        if (!this.simulator) return;

        // More intense effect for higher combos
        const intensity = 0.45 + Math.min(comboCount, 12) * 0.04;

        // Create multiple splats in a pattern
        for (let i = 0; i < 3; i++) {
            this.scheduleTimeout(() => {
                this.addRandomSplat(true, intensity, {
                    fadeIn: 0.9 + i * 0.18,
                    hold: 0.4,
                    fadeOut: 3.0,
                });
            }, i * 140);
        }
    }

    /**
     * React to piece locks with subtle pulse
     */
    onPieceLock(piece) {
        if (!this.simulator) return;

        // Subtle single splat
        this.addRandomSplat(false, 0.34, { fadeIn: 0.9, hold: 0.5, fadeOut: 2.4 });
    }

    /**
     * Add a random splat to the simulation
     */
    addRandomSplat(large = false, intensityMultiplier = 1.0, envelopeOptions = {}) {
        if (!this.simulator) return;

        const x = Math.random() * this.canvas.width;
        const y = Math.random() * this.canvas.height;

        const angle = Math.random() * Math.PI * 2;
        const baseForce = large ? 0.08 : 0.032;
        const force = baseForce * intensityMultiplier;
        const dx = Math.cos(angle) * force;
        const dy = Math.sin(angle) * force;

        const color = this.sampleColor(0.03, 0.32);
        const envelope = {
            fadeIn: envelopeOptions.fadeIn ?? (large ? 1.2 : 0.95),
            hold: envelopeOptions.hold ?? (large ? 0.65 : 0.45),
            fadeOut: envelopeOptions.fadeOut ?? (large ? 3.8 : 3.2),
            drift: envelopeOptions.drift ?? 0.02,
        };

        this.injectFluid(x, y, dx, dy, color, envelope);
    }

    /**
     * Start ambient motion (automatic splats)
     */
    startAmbientMotion() {
        if (this.autoSplatInterval) {
            clearTimeout(this.autoSplatInterval);
            this.autoSplatInterval = null;
        }
        if (this.gentleFlowInterval) {
            clearInterval(this.gentleFlowInterval);
            this.gentleFlowInterval = null;
        }

        // Add splats at random intervals
        const scheduleAmbient = (delay) => {
            this.autoSplatInterval = this.scheduleTimeout(addAmbientSplat, delay);
        };

        const addAmbientSplat = () => {
            if (this.isActive) {
                // Gentle, smooth splats that fade in and out
                this.addRandomSplat(false, 0.25);

                // Schedule next splat (5-8 seconds for nice flow)
                const delay = 5000 + Math.random() * 3000;
                scheduleAmbient(delay);
            }
        };

        // Start after a short delay
        scheduleAmbient(3000);

        // DISABLE gentleFlowInterval - it's adding too many splats!
        // Comment out the continuous flow for now
        /*
        let flowAngle = Math.random() * Math.PI * 2;
        this.gentleFlowInterval = setInterval(() => {
            if (!this.isActive || !this.simulator) return;

            flowAngle += 0.08;
            const radius = Math.min(this.canvas.width, this.canvas.height) * 0.3;
            const centerX = this.canvas.width * 0.5;
            const centerY = this.canvas.height * 0.5;

            const x = centerX + Math.cos(flowAngle) * radius;
            const y = centerY + Math.sin(flowAngle) * radius;

            const swirlSpeed = 0.02;
            const dx = -Math.sin(flowAngle) * swirlSpeed;
            const dy = Math.cos(flowAngle) * swirlSpeed;

            const color = this.sampleColor(0.018, 0.28);
            this.injectFluid(x, y, dx, dy, color, {
                fadeIn: 1.4,
                hold: 0.9,
                fadeOut: 3.6,
                drift: 0.04,
            });
        }, 3800);
        */
        // Gentle flow disabled to reduce splat frequency
    }

    /**
     * Start animation loop
     */
    startAnimation() {
        const animate = (currentTime) => {
            if (!this.isActive) return;

            const deltaTime = currentTime - this.lastTime;
            this.lastTime = currentTime;

            // Run simulation step
            if (this.simulator) {
                this.simulator.step(deltaTime);
            }

            this.updateStarfield(deltaTime);

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

        // Stop ambient motion
        if (this.autoSplatInterval) {
            const timerHost = typeof window !== 'undefined' ? window : globalThis;
            timerHost.clearTimeout(this.autoSplatInterval);
            this.pendingSplatTimeouts.delete(this.autoSplatInterval);
            this.autoSplatInterval = null;
        }
        if (this.gentleFlowInterval) {
            clearInterval(this.gentleFlowInterval);
            this.gentleFlowInterval = null;
        }
        if (this.colorCycleInterval) {
            clearInterval(this.colorCycleInterval);
            this.colorCycleInterval = null;
        }
        if (this.colorCycleTimeout) {
            const timerHost = typeof window !== 'undefined' ? window : globalThis;
            timerHost.clearTimeout(this.colorCycleTimeout);
            this.pendingSplatTimeouts.delete(this.colorCycleTimeout);
            this.colorCycleTimeout = null;
        }
        if (this.pendingSplatTimeouts.size > 0) {
            this.pendingSplatTimeouts.forEach((id) => clearTimeout(id));
            this.pendingSplatTimeouts.clear();
        }
        if (this.activeInjections.size > 0) {
            [...this.activeInjections.values()].forEach((injection) => this.cancelInjection(injection));
        }
        this.injectionQueue.length = 0;

        // Cleanup interaction listeners
        if (this.interactionCleanup) {
            this.interactionCleanup();
            this.interactionCleanup = null;
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
        if (this.starCanvas && this.starCanvas.parentNode) {
            this.starCanvas.parentNode.removeChild(this.starCanvas);
        }
        this.starCanvas = null;
        this.starContext = null;
        this.starDpr = 1;
        this.stars = [];
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

        if (this.starCanvas) {
            this.starDpr = window.devicePixelRatio || 1;
            this.starCanvas.width = width * this.starDpr;
            this.starCanvas.height = height * this.starDpr;
            if (this.starContext) {
                this.starContext.setTransform(1, 0, 0, 1, 0, 0);
            }
            this.invalidateStars();
        }
    }

    /**
     * Update (called each frame if needed)
     */
    update(deltaTime) {
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
        this.invalidateStars();
    }

    /**
     * Generate a subtle color for pointer interaction
     */
    getPointerColor() {
        const blendFactor = this.pointerDown ? 0.72 : 0.86;
        const step = this.pointerDown ? 0.015 : 0.01;
        return this.sampleColor(step, blendFactor, this.colorState);
    }

    createColorState() {
        return {
            current: getRandomColor(this.colorScheme),
            target: getRandomColor(this.colorScheme),
            progress: 0,
        };
    }

    resetFluidColors() {
        this.colorState = this.createColorState();
    }

    resetStarColors() {
        this.starColorState = this.createColorState();
    }

    resetColorState() {
        this.resetFluidColors();
        this.resetStarColors();
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

    sampleColor(step = 0.05, ambientBlend = 0.35, state = this.colorState) {
        const base = this.advanceColor(state, step);
        const ambient = this.colorScheme.ambient || [0, 0, 0];
        const mix = Math.max(0, Math.min(1, ambientBlend));
        return lerpColor(base, ambient, mix);
    }

    scheduleTimeout(callback, delay) {
        const timerHost = typeof window !== 'undefined' ? window : globalThis;
        const timeoutId = timerHost.setTimeout(() => {
            this.pendingSplatTimeouts.delete(timeoutId);
            callback();
        }, delay);
        this.pendingSplatTimeouts.add(timeoutId);
        return timeoutId;
    }

    scheduleInjectionTimeout(callback, delay, injection) {
        const timeoutId = this.scheduleTimeout(() => {
            if (injection && this.activeInjections.has(injection.id)) {
                injection.timeouts.delete(timeoutId);
                callback();
            }
        }, delay);
        if (injection) {
            injection.timeouts.add(timeoutId);
        }
        return timeoutId;
    }

    cancelInjection(injection) {
        if (!injection) return;
        injection.timeouts.forEach((timeoutId) => {
            const timerHost = typeof window !== 'undefined' ? window : globalThis;
            timerHost.clearTimeout(timeoutId);
            this.pendingSplatTimeouts.delete(timeoutId);
        });
        injection.timeouts.clear();
        this.activeInjections.delete(injection.id);
        const index = this.injectionQueue.indexOf(injection);
        if (index >= 0) {
            this.injectionQueue.splice(index, 1);
        }
    }

    finishInjection(injection) {
        if (!injection) return;
        this.cancelInjection(injection);
    }

    easeInOut(t) {
        const clamped = Math.max(0, Math.min(1, t));
        return clamped * clamped * (3 - 2 * clamped);
    }

    envelopeAmplitude(time, fadeIn, hold, fadeOut) {
        const safeFadeIn = Math.max(0.001, fadeIn);
        const safeFadeOut = Math.max(0.001, fadeOut);
        if (time <= fadeIn) {
            return this.easeInOut(time / safeFadeIn);
        }
        if (time <= fadeIn + hold) {
            return 1;
        }
        const decayT = (time - fadeIn - hold) / safeFadeOut;
        return this.easeInOut(Math.max(0, 1 - decayT));
    }

    injectFluid(x, y, dx, dy, color, options = {}) {
        if (!this.simulator) return;

        const fadeIn = Math.max(0.05, options.fadeIn ?? 2.5); // Very long, smooth fade in
        const hold = Math.max(0, options.hold ?? 2.0); // Hold visible longer
        const fadeOut = Math.max(0.4, options.fadeOut ?? 5.0); // Very long, smooth fade out
        const totalDuration = fadeIn + hold + fadeOut;
        // ULTRA SMOOTH: Many tiny steps create butter-smooth animation
        const stepInterval = Math.max(0.06, options.stepInterval ?? 0.08); // 80ms intervals = silky smooth
        const steps = Math.min(120, Math.max(40, Math.ceil(totalDuration / stepInterval) + 1)); // 40-120 steps for ultra smoothness
        const drift = options.drift ?? 30; // More drift for flowing movement
        const driftAngle = options.driftAngle ?? Math.random() * Math.PI * 2;
        const driftX = Math.cos(driftAngle) * drift;
        const driftY = Math.sin(driftAngle) * drift;

        const injection = {
            id: Symbol('injection'),
            timeouts: new Set(),
            createdAt: performance.now(),
        };

        if (this.activeInjections.size >= this.maxConcurrentInjections) {
            const oldest = this.injectionQueue.shift();
            if (oldest) {
                this.cancelInjection(oldest);
            }
        }

        this.activeInjections.set(injection.id, injection);
        this.injectionQueue.push(injection);

        for (let i = 0; i < steps; i++) {
            const t = (i / (steps - 1)) * totalDuration;
            const amplitude = this.envelopeAmplitude(t, fadeIn, hold, fadeOut);

            // Skip very low amplitudes to prevent flickering during early fade-in
            if (amplitude < 0.05) continue;

            // Use amplitude for force, ensure minimum for smooth visibility
            const scaledAmplitude = Math.max(0.05, amplitude);
            const px = x + driftX * (t / totalDuration);
            const py = y + driftY * (t / totalDuration);
            const scaledDx = dx * scaledAmplitude;
            const scaledDy = dy * scaledAmplitude;

            // Scale color with amplitude - now safe because we skip low amplitudes
            // Use linear scaling for natural fade
            const scaledColor = color
                ? [
                    color[0] * scaledAmplitude,
                    color[1] * scaledAmplitude,
                    color[2] * scaledAmplitude,
                ]
                : null;

            this.scheduleInjectionTimeout(() => {
                if (!this.simulator || !this.isActive) return;
                this.simulator.addSplat(px, py, scaledDx, scaledDy, scaledColor);
            }, t * 1000, injection);
        }

        const cleanupDelay = totalDuration * 1000 + 200;
        this.scheduleInjectionTimeout(() => this.finishInjection(injection), cleanupDelay, injection);
    }

    /**
     * Cycle through muted palettes for variety
     */
    startColorCycle() {
        const pickNextScheme = () => {
            if (!this.isActive) return;

            const options = this.availableSchemes.filter(
                (name) => name !== this.currentSchemeName,
            );
            const nextScheme =
                options[Math.floor(Math.random() * options.length)] || this.currentSchemeName;

            this.setColorScheme(nextScheme);
        };

        if (this.colorCycleInterval) {
            clearInterval(this.colorCycleInterval);
        }
        if (this.colorCycleTimeout) {
            clearTimeout(this.colorCycleTimeout);
        }

        this.colorCycleTimeout = setTimeout(pickNextScheme, 20000);
        this.colorCycleInterval = setInterval(pickNextScheme, 60000);
    }

    /**
     * Create and initialize a starfield canvas
     */
    createStarfieldLayer(container) {
        this.starCanvas = document.createElement('canvas');
        this.starCanvas.id = 'nebula-flow-stars';
        this.starCanvas.style.position = 'absolute';
        this.starCanvas.style.top = '0';
        this.starCanvas.style.left = '0';
        this.starCanvas.style.width = '100%';
        this.starCanvas.style.height = '100%';
        this.starCanvas.style.pointerEvents = 'none';
        this.starCanvas.style.opacity = '0.9';

        this.starDpr = window.devicePixelRatio || 1;
        this.starCanvas.width = window.innerWidth * this.starDpr;
        this.starCanvas.height = window.innerHeight * this.starDpr;

        this.starContext = this.starCanvas.getContext('2d');
        if (this.starContext) {
            this.starContext.setTransform(1, 0, 0, 1, 0, 0);
        }

        container.appendChild(this.starCanvas);
        this.resetStarColors();
        this.generateStars();
        this.updateStarfield(0);
    }

    generateStars() {
        if (!this.starCanvas || !this.starContext) {
            return;
        }

        const width = this.starCanvas.width / this.starDpr;
        const height = this.starCanvas.height / this.starDpr;
        const targetDensity = 0.00015; // More stars for better depth
        const baseCount = Math.max(80, Math.floor(width * height * targetDensity));

        this.stars = Array.from({ length: baseCount }, () => {
            const driftAngle = Math.random() * Math.PI * 2;
            return {
                x: Math.random(),
                y: Math.random(),
                radius: 1.2 + Math.random() * 1.8, // Slightly smaller for subtlety
                baseAlpha: 0.3 + Math.random() * 0.25, // Brighter base alpha
                twinkleSpeed: 0.4 + Math.random() * 0.6, // Faster twinkling
                twinkleOffset: Math.random() * Math.PI * 2,
                driftSpeed: 0.003 + Math.random() * 0.005,
                driftAngle,
                hueShift: Math.random() * 0.2,
                color: this.getStarColor(),
                phase: Math.random() * Math.PI * 2,
            };
        });
    }

    invalidateStars() {
        if (!this.starCanvas) return;
        this.resetStarColors();
        this.generateStars();
        this.updateStarfield(0);
    }

    getStarColor() {
        const softWhite = [1, 1, 1];
        const base = this.sampleColor(0.012, 0.32, this.starColorState);
        return lerpColor(softWhite, base, 0.36);
    }

    updateStarfield(deltaTime) {
        if (!this.starContext || !this.starCanvas || !this.stars.length) {
            return;
        }

        const ctx = this.starContext;
        const width = this.starCanvas.width / this.starDpr;
        const height = this.starCanvas.height / this.starDpr;
        const dt = Math.min(deltaTime, 50) / 1000;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(this.starDpr, this.starDpr);
        ctx.clearRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'lighter';

        for (const star of this.stars) {
            star.phase += star.twinkleSpeed * dt;
            const twinkle = (Math.sin(star.phase + star.twinkleOffset) + 1) * 0.5;
            const alpha = star.baseAlpha + twinkle * star.baseAlpha * 0.55;

            const drift = star.driftSpeed * dt;
            star.x += Math.cos(star.driftAngle) * drift * 0.85;
            star.y += Math.sin(star.driftAngle) * drift * 0.85;

            // Wrap coordinates softly
            if (star.x < -0.05) star.x += 1.1;
            else if (star.x > 1.05) star.x -= 1.1;
            if (star.y < -0.05) star.y += 1.1;
            else if (star.y > 1.05) star.y -= 1.1;

            const px = star.x * width;
            const py = star.y * height;
            const radius = star.radius * (0.85 + twinkle * 0.35);

            const innerAlpha = Math.min(1, alpha * 2.3);
            const outerAlpha = Math.min(1, alpha * 0.28);
            const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius * 4.8);

            const [r, g, b] = star.color;
            const to255 = (value) => Math.floor(value * 255);
            gradient.addColorStop(
                0,
                `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${innerAlpha})`,
            );
            gradient.addColorStop(
                0.6,
                `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${outerAlpha})`,
            );
            gradient.addColorStop(1, `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, 0)`);

            ctx.fillStyle = gradient;
            ctx.fillRect(px - radius * 6, py - radius * 6, radius * 12, radius * 12);
        }
        ctx.restore();
    }
}
