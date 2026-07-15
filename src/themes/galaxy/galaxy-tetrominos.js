/**
 * Galaxy Theme - Tetromino Visual Configuration
 *
 * A cosmic palette drawn from the depths of space:
 * - Electric cyans like ion trails through nebulae
 * - Blazing golds of stellar cores and supernovae
 * - Deep violets of dark matter clouds
 * - Aurora teals dancing at the edge of space
 * - Hot magentas of solar flares
 * - Midnight indigos of the void between stars
 * - Ember oranges of dying comets
 */

export const GALAXY_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ffd54f', // Supernova gold - warm stellar core
        O: '#d050ff', // Nebula violet - rich and cosmic
        T: '#00ffc8', // Aurora teal - ethereal glow
        S: '#ff4da6', // Solar flare magenta - hot pink energy
        Z: '#6366f1', // Deep space indigo - mysterious depth
        J: '#ff8a50', // Comet ember - trailing warmth
        L: '#00e5ff', // Ion trail cyan - brighter, more electric
        GARBAGE: '#0a0015', // Interstellar void - near black with hint of purple
    },

    renderMode: 'glow',

    effects: {
        // Enhanced glow for cosmic feel
        glowRadius: 18,
        glowIntensity: 0.95,
        glowColor: '#80d4ff',

        // Subtle outline for definition against dark space
        outline: true,
        outlineWidth: 2.2,
        outlineColor: '#050012',

        // Gentle pulse like distant stars
        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.35,

        // Cosmic shimmer effect
        shimmer: true,
        shimmerSpeed: 0.08,
        shimmerIntensity: 0.3,

        // Light trails for movement
        trails: true,
        trailLength: 0.32,
        trailOpacity: 0.45,

        // Inner glow for depth
        innerGlow: true,
        innerGlowRadius: 4,
        innerGlowIntensity: 0.6,
    },

    rendererOverrides: {
        canvas: {
            glowRadius: 14,
            glowIntensity: 0.88,
            outlineWidth: 1.9,
            pulseAmplitude: 0.28,
        },
        phaser: {
            glowRadius: 20,
            glowIntensity: 1.0,
            outlineWidth: 2.5,
            pulseAmplitude: 0.38,
        },
    },
};
