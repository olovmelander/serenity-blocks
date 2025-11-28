/**
 * Chromatic Impasto Theme - Inspired by Bengt Lindström's "Kvinnan Alpha"
 *
 * Features:
 * - Thick, viscous fluid simulation mimicking oil paint
 * - Bold expressionist color palette from the painting
 * - Swirling, energetic brushstroke-like movements
 * - High contrast color interactions
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import ChromaticImpastoSimulator from '../../utils/webgl/chromatic-impasto-simulator.js';
import { CHROMATIC_IMPASTO_TETROMINOS } from './chromatic-impasto-tetrominos.js';

export default class ChromaticImpastoTheme extends BaseTheme {
    constructor() {
        super('chromatic-impasto');

        this.simulator = null;
        this.canvas = null;
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;

        // State for expressionist effects
        this.paintSwirlActive = false;
        this.paintSwirlTimer = 0;
        this.paintSwirlIntensity = 0;

        console.log('[ChromaticImpasto] Constructor called');
    }

    async init() {
        console.log('[ChromaticImpasto] Initializing theme');
    }

    getTetrominoConfig() {
        return CHROMATIC_IMPASTO_TETROMINOS;
    }

    async createScene() {
        console.log('[ChromaticImpasto] createScene() called');

        try {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'chromatic-impasto-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.backgroundColor = '#0a0a0a'; // Very dark canvas background
            this.canvas.style.pointerEvents = 'none';

            this.resize(window.innerWidth, window.innerHeight);

            const container = document.getElementById('chromatic-impasto-theme');
            if (container) {
                container.appendChild(this.canvas);
                this.registerContainer(container);

                // Add textured canvas background - like a painter's canvas
                if (!container.querySelector('.canvas-texture')) {
                    const texture = document.createElement('div');
                    texture.className = 'canvas-texture';
                    texture.style.position = 'absolute';
                    texture.style.top = '0';
                    texture.style.left = '0';
                    texture.style.width = '100%';
                    texture.style.height = '100%';
                    texture.style.zIndex = '-1';
                    texture.style.backgroundColor = '#1a1a1a';
                    // Canvas weave texture
                    texture.style.backgroundImage = `
                        repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,.2) 1px, rgba(0,0,0,.2) 2px),
                        repeating-linear-gradient(90deg, transparent, transparent 1px, rgba(0,0,0,.2) 1px, rgba(0,0,0,.2) 2px)
                    `;
                    texture.style.backgroundSize = '4px 4px';
                    container.insertBefore(texture, this.canvas);
                }
            } else {
                console.error('[ChromaticImpasto] Theme container not found!');
                return;
            }

            const config = this.getConfig();
            this.simulator = new ChromaticImpastoSimulator(this.canvas, config);

            const success = await this.simulator.init();
            if (!success) {
                console.error('[ChromaticImpasto] Failed to initialize simulator');
                return;
            }

            this.addWebGLLayer(this.canvas, -1);
            this.setupEventListeners();
            this.startAnimation();
            this.addInitialPaintStrokes();

            console.log('[ChromaticImpasto] createScene() completed');
        } catch (error) {
            console.error('[ChromaticImpasto] ERROR in createScene():', error);
            throw error;
        }
    }

    getConfig() {
        return {
            SIM_RESOLUTION: 256,
            DYE_RESOLUTION: 1024,
            DENSITY_DISSIPATION: 0.985, // Much slower fade for thick paint that stays
            VELOCITY_DISSIPATION: 0.92, // Very viscous, like thick oil paint
            PRESSURE: 0.85,
            PRESSURE_ITERATIONS: 30,
            CURL: 70, // Very strong swirling for bold expressionist strokes
            SPLAT_RADIUS: 0.4, // Thick, bold paint strokes
            SPLAT_FORCE: 7000, // More forceful application
            SHADING: true,
            COLORFUL: true,
            BLOOM: false, // Paint doesn't glow
            SUNRAYS: false,
            BACK_COLOR: { r: 0.08, g: 0.08, b: 0.08 }, // Darker canvas
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
            if (this.isActive) this.onPieceLock(data);
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    // --- Color Palette from "Kvinnan Alpha" ---

    getLindstromColor() {
        const palette = [
            { r: 0.7, g: 0.0, b: 0.0 }, // Blood red
            { r: 0.9, g: 0.1, b: 0.1 }, // Crimson
            { r: 1.0, g: 0.5, b: 0.0 }, // Bright orange
            { r: 1.0, g: 0.75, b: 0.0 }, // Golden yellow
            { r: 0.95, g: 0.9, b: 0.1 }, // Pure yellow
            { r: 0.0, g: 0.85, b: 0.8 }, // Bright cyan/turquoise
            { r: 0.0, g: 0.6, b: 0.55 }, // Deep teal
            { r: 0.0, g: 0.4, b: 0.15 }, // Dark green (almost black-green)
            { r: 0.1, g: 0.5, b: 0.3 }, // Forest green
            { r: 0.0, g: 0.2, b: 0.8 }, // Deep blue
            { r: 0.2, g: 0.4, b: 1.0 }, // Bright blue
            { r: 1.0, g: 0.98, b: 0.85 }, // Cream white
            { r: 0.95, g: 0.95, b: 0.95 }, // Pure white
        ];
        return palette[Math.floor(Math.random() * palette.length)];
    }

    getContrastingColor(baseColor) {
        // Return a color that contrasts well with the base
        const avgBrightness = (baseColor.r + baseColor.g + baseColor.b) / 3;

        if (avgBrightness > 0.5) {
            // If bright, return dark, saturated colors
            const darkPalette = [
                { r: 0.7, g: 0.0, b: 0.0 }, // Blood red
                { r: 0.0, g: 0.4, b: 0.15 }, // Black-green
                { r: 0.0, g: 0.2, b: 0.8 }, // Deep blue
                { r: 0.0, g: 0.6, b: 0.55 }, // Deep teal
                { r: 0.1, g: 0.5, b: 0.3 }, // Forest green
            ];
            return darkPalette[Math.floor(Math.random() * darkPalette.length)];
        }
        // If dark, return bright, bold colors
        const brightPalette = [
            { r: 1.0, g: 0.75, b: 0.0 }, // Golden yellow
            { r: 0.95, g: 0.9, b: 0.1 }, // Pure yellow
            { r: 0.0, g: 0.85, b: 0.8 }, // Bright cyan
            { r: 1.0, g: 0.5, b: 0.0 }, // Bright orange
            { r: 1.0, g: 0.98, b: 0.85 }, // Cream white
            { r: 0.2, g: 0.4, b: 1.0 }, // Bright blue
        ];
        return brightPalette[Math.floor(Math.random() * brightPalette.length)];
    }

    // --- Effects ---

    onLineClear(lineCount) {
        if (!this.simulator) return;

        // Extremely bold expressionist explosion with thick paint
        const count = lineCount * 12; // More splats
        const intensity = 2.0 + (lineCount * 0.5);

        // Multiple central bursts with bold colors
        const centerColor = this.getLindstromColor();
        const contrastColor = this.getContrastingColor(centerColor);

        // Thick center splat
        this.simulator.splat(0.5, 0.5, 0, 0, centerColor);
        setTimeout(() => {
            this.simulator.splat(0.5, 0.5, 0, 0, contrastColor);
        }, 50);

        // Explosive radial bursts
        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
                const dist = 0.1 + Math.random() * 0.3;
                const x = 0.5 + Math.cos(angle) * dist;
                const y = 0.5 + Math.sin(angle) * dist;

                // Very strong outward force
                const dx = Math.cos(angle) * 8000 * intensity;
                const dy = Math.sin(angle) * 8000 * intensity;

                const color = Math.random() < 0.6 ? this.getLindstromColor() : this.getContrastingColor(centerColor);
                this.simulator.splat(x, y, dx, dy, color);

                // Add secondary splats for thickness
                if (Math.random() < 0.3) {
                    setTimeout(() => {
                        this.simulator.splat(x, y, dx * 0.5, dy * 0.5, color);
                    }, 30);
                }
            }, i * 20);
        }
    }

    onCombo(comboCount) {
        if (!this.simulator) return;

        // Aggressive swirling vortex - like violent brushstrokes
        this.paintSwirlActive = true;
        this.paintSwirlTimer = 3.5;
        this.paintSwirlIntensity = Math.min(comboCount * 1500, 12000);

        // Add multiple thick paint splats at center with bold colors
        const primaryColor = this.getLindstromColor();
        const secondaryColor = this.getContrastingColor(primaryColor);

        this.simulator.splat(0.5, 0.5, 0, 0, primaryColor);
        setTimeout(() => {
            this.simulator.splat(0.5, 0.5, 0, 0, secondaryColor);
        }, 100);

        // Add swirling paint strokes
        const numStrokes = Math.min(comboCount * 2, 10);
        for (let i = 0; i < numStrokes; i++) {
            setTimeout(() => {
                const angle = (i / numStrokes) * Math.PI * 2;
                const x = 0.5 + Math.cos(angle) * 0.2;
                const y = 0.5 + Math.sin(angle) * 0.2;
                const dx = -Math.sin(angle) * 3000;
                const dy = Math.cos(angle) * 3000;
                this.simulator.splat(x, y, dx, dy, this.getLindstromColor());
            }, i * 150);
        }
    }

    onPieceLock(data) {
        if (!this.simulator) return;

        // Get the piece shape if available
        const piece = data?.piece;
        if (!piece || !piece.shape || !piece.shape.length) {
            // Fallback to bold stroke
            this.createBoldStroke(0.3 + Math.random() * 0.4, 0.3 + Math.random() * 0.4);
            return;
        }

        // Create thick paint dabs in the shape of the tetromino
        const baseX = 0.3 + Math.random() * 0.4;
        const baseY = 0.3 + Math.random() * 0.4;
        const blockSize = 0.05;
        const primaryColor = this.getLindstromColor();
        const accentColor = this.getContrastingColor(primaryColor);

        // Iterate through the shape matrix
        for (let row = 0; row < piece.shape.length; row++) {
            for (let col = 0; col < piece.shape[row].length; col++) {
                if (piece.shape[row][col]) {
                    const x = baseX + (col - 1.5) * blockSize;
                    const y = baseY + (row - 1.5) * blockSize;

                    setTimeout(() => {
                        // Use primary color for most blocks, accent for edges
                        const isEdge = row === 0 || col === 0
                                     || row === piece.shape.length - 1
                                     || col === piece.shape[row].length - 1;
                        const color = (isEdge && Math.random() < 0.5) ? accentColor : primaryColor;
                        this.createBoldStroke(x, y, color);
                    }, (row * piece.shape[row].length + col) * 50);
                }
            }
        }
    }

    /**
     * Create a bold, thick paint stroke with impasto technique
     */
    createBoldStroke(x, y, baseColor = null) {
        if (!this.simulator) return;

        const color = baseColor || this.getLindstromColor();
        const accentColor = this.getContrastingColor(color);

        // Create multiple overlapping layers for thick impasto effect
        const numLayers = 6 + Math.floor(Math.random() * 4); // More layers
        const baseAngle = Math.random() * Math.PI * 2;

        for (let i = 0; i < numLayers; i++) {
            const angleVariation = (Math.random() - 0.5) * Math.PI * 0.6;
            const angle = baseAngle + angleVariation;
            const distance = Math.random() * 0.012; // Wider spread

            const offsetX = Math.cos(angle) * distance;
            const offsetY = Math.sin(angle) * distance;

            // Stronger force for bold application
            const force = 500 + Math.random() * 600;
            const dx = Math.cos(angle) * force;
            const dy = Math.sin(angle) * force;

            // Use accent color occasionally for texture
            const strokeColor = (i === 0 && Math.random() < 0.3) ? accentColor : color;

            setTimeout(() => {
                this.simulator.splat(x + offsetX, y + offsetY, dx, dy, strokeColor);

                // Add highlight on top layer
                if (i === numLayers - 1 && Math.random() < 0.4) {
                    setTimeout(() => {
                        const highlight = { r: 1.0, g: 0.98, b: 0.85 };
                        this.simulator.splat(x, y, dx * 0.3, dy * 0.3, highlight);
                    }, 50);
                }
            }, i * 25);
        }
    }

    addInitialPaintStrokes() {
        // Add initial bold, dramatic strokes across the canvas
        for (let i = 0; i < 16; i++) {
            setTimeout(() => {
                const x = 0.2 + Math.random() * 0.6;
                const y = 0.2 + Math.random() * 0.6;
                const color = this.getLindstromColor();
                const angle = Math.random() * Math.PI * 2;

                // Stronger, bolder initial strokes
                const force = 3000 + Math.random() * 3000;
                const dx = Math.cos(angle) * force;
                const dy = Math.sin(angle) * force;

                // Primary stroke
                this.simulator.splat(x, y, dx, dy, color);

                // Add secondary layer for thickness
                setTimeout(() => {
                    const offset = 0.02;
                    const contrastColor = this.getContrastingColor(color);
                    this.simulator.splat(
                        x + (Math.random() - 0.5) * offset,
                        y + (Math.random() - 0.5) * offset,
                        dx * 0.7,
                        dy * 0.7,
                        Math.random() < 0.5 ? color : contrastColor,
                    );
                }, 100);
            }, i * 180);
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
                // Apply swirling vortex during combos
                if (this.paintSwirlActive) {
                    // Create circular swirling motion
                    const angle = currentTime * 0.001;
                    const radius = 0.2;
                    const x = 0.5 + Math.cos(angle) * radius;
                    const y = 0.5 + Math.sin(angle) * radius;

                    const dx = -Math.sin(angle) * this.paintSwirlIntensity;
                    const dy = Math.cos(angle) * this.paintSwirlIntensity;

                    const color = { r: 0, g: 0, b: 0 }; // Just force, no color
                    this.simulator.splat(x, y, dx, dy, color);

                    this.paintSwirlTimer -= dt;
                    if (this.paintSwirlTimer <= 0) {
                        this.paintSwirlActive = false;
                    }
                }

                // Ambient paint motion - bold, expressive swirling
                if (Math.random() < 0.12) { // More frequent
                    const x = Math.random();
                    const y = Math.random();
                    const angle = Math.random() * Math.PI * 2;
                    const force = 250 + Math.random() * 250; // Stronger force

                    // Occasionally add color
                    const addColor = Math.random() < 0.15;
                    const color = addColor ? this.getLindstromColor() : { r: 0, g: 0, b: 0 };

                    this.simulator.splat(x, y, Math.cos(angle) * force, Math.sin(angle) * force, color);
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
