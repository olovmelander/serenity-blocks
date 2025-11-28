/**
 * Chromatic Impasto Simulator - Thick Oil Paint Simulation
 * Based on FluidSimulator with configurations for viscous, bold paint strokes
 * Inspired by Bengt Lindström's expressionist impasto technique
 * License: MIT
 */

import FluidSimulator from './fluid-simulator.js';

export default class ChromaticImpastoSimulator extends FluidSimulator {
    constructor(canvas, config = {}) {
        // Call parent constructor with merged config optimized for thick impasto paint
        super(canvas, {
            SIM_RESOLUTION: 256,
            DYE_RESOLUTION: 1024,
            CAPTURE_RESOLUTION: 512,
            DENSITY_DISSIPATION: 0.985, // Very slow dissipation for thick paint
            VELOCITY_DISSIPATION: 0.92, // Very high viscosity like thick oil paint
            PRESSURE: 0.85,
            PRESSURE_ITERATIONS: 30,
            CURL: 70, // Very strong swirling for bold expressionist strokes
            SPLAT_RADIUS: 0.4, // Very thick brush strokes
            SPLAT_FORCE: 7000, // Bold, forceful application
            SHADING: true,
            COLORFUL: true,
            COLOR_UPDATE_SPEED: 6,
            PAUSED: false,
            BACK_COLOR: { r: 0.08, g: 0.08, b: 0.08 }, // Darker canvas
            TRANSPARENT: false,
            BLOOM: false, // Paint doesn't glow
            BLOOM_ITERATIONS: 0,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 0.0,
            BLOOM_THRESHOLD: 0.6,
            BLOOM_SOFT_KNEE: 0.7,
            SUNRAYS: false,
            SUNRAYS_RESOLUTION: 196,
            SUNRAYS_WEIGHT: 1.0,
            ...config,
        });

        // Track paint layers for blending and texture
        this.paintLayers = [];
        this.maxLayers = 15; // More layers for richer texture
    }

    /**
     * Override splat to add paint-like behavior
     */
    splat(x, y, dx, dy, color) {
        // Add to paint layers history
        this.paintLayers.push({
            x,
            y,
            dx,
            dy,
            color,
            timestamp: Date.now(),
        });

        // Keep only recent layers
        if (this.paintLayers.length > this.maxLayers) {
            this.paintLayers.shift();
        }

        // Call parent splat
        super.splat(x, y, dx, dy, color);
    }

    /**
     * Apply swirling vortex effect for expressionist motion
     * @param {number} centerX - X position (0-1)
     * @param {number} centerY - Y position (0-1)
     * @param {number} strength - Vortex strength
     * @param {number} radius - Radius of effect (0-1)
     * @param {number} dt - Delta time
     */
    applyVortex(centerX, centerY, strength, radius, dt) {
        // Create circular motion by applying tangential forces
        const numPoints = 12;
        const angleStep = (Math.PI * 2) / numPoints;

        for (let i = 0; i < numPoints; i++) {
            const angle = i * angleStep;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;

            // Tangential force (perpendicular to radius)
            const dx = -Math.sin(angle) * strength * dt;
            const dy = Math.cos(angle) * strength * dt;

            // Apply force without adding color
            this.splat(x, y, dx, dy, { r: 0, g: 0, b: 0 });
        }
    }

    /**
     * Apply bold stroke along a line
     * @param {number} x1 - Start X (0-1)
     * @param {number} y1 - Start Y (0-1)
     * @param {number} x2 - End X (0-1)
     * @param {number} y2 - End Y (0-1)
     * @param {object} color - RGB color object
     * @param {number} thickness - Stroke thickness multiplier
     */
    applyBoldStroke(x1, y1, x2, y2, color, thickness = 1.0) {
        const steps = 15;
        const baseRadius = this.config.SPLAT_RADIUS * thickness;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;

            // Vary radius slightly for organic feel
            const radiusVariation = 0.8 + Math.random() * 0.4;
            const force = this.config.SPLAT_FORCE * radiusVariation;

            // Direction along the stroke
            const dx = (x2 - x1) * force * 0.3;
            const dy = (y2 - y1) * force * 0.3;

            setTimeout(() => {
                this.splat(x, y, dx, dy, color);
            }, i * 30);
        }
    }

    /**
     * Get blended color from recent paint layers at a position
     * Simulates paint mixing on canvas
     */
    getBlendedColor(x, y) {
        if (this.paintLayers.length === 0) {
            return { r: 0.16, g: 0.16, b: 0.16 };
        }

        // Find nearby paint layers
        const nearby = this.paintLayers.filter((layer) => {
            const dist = Math.sqrt((layer.x - x) ** 2 + (layer.y - y) ** 2);
            return dist < 0.1;
        });

        if (nearby.length === 0) {
            return this.paintLayers[this.paintLayers.length - 1].color;
        }

        // Blend colors
        let r = 0; let g = 0; let
            b = 0;
        nearby.forEach((layer) => {
            r += layer.color.r;
            g += layer.color.g;
            b += layer.color.b;
        });

        const count = nearby.length;
        return {
            r: r / count,
            g: g / count,
            b: b / count,
        };
    }

    /**
     * Override cleanup to clear paint layers
     */
    cleanup() {
        this.paintLayers = [];
        super.cleanup();
    }
}
