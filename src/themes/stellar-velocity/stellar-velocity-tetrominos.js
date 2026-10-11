/**
 * Stellar Velocity Theme - Tetromino Visual Configuration
 *
 * Every piece is a band of the starbow, the ring starlight splits into at speed, and the hoop
 * it lays on the course burns in the same colour:
 * - Redshift rose and flare orange, the bow's outer bands
 * - Sodium gold
 * - Mint, where the bow turns
 * - Ice cyan and blueshift blue
 * - Ultraviolet, dead ahead
 * Garbage is what the light has left behind: cold dust.
 */

export const STELLAR_VELOCITY_TETROMINOS = {
    version: 1,

    colors: {
        I: '#ff6fb1', // Redshift rose
        O: '#7fe9ff', // Ice cyan
        T: '#ffc94a', // Sodium gold
        S: '#b48cff', // Ultraviolet
        Z: '#5dffa8', // Mint
        J: '#ff8a4a', // Flare orange
        L: '#5a9bff', // Blueshift blue
        GARBAGE: '#10141f', // Cold dust
    },

    renderMode: 'glow',

    effects: {
        // The cool halo of something lit from within
        glowRadius: 18,
        glowIntensity: 0.95,
        glowColor: '#9fdcff',

        // A dark, cold edge for definition against the canyon
        outline: true,
        outlineWidth: 2.2,
        outlineColor: '#04060d',

        // A slow pulse, like a drive idling
        pulse: true,
        pulseSpeed: 0.035,
        pulseAmplitude: 0.32,

        // Starlight running over the faces
        shimmer: true,
        shimmerSpeed: 0.09,
        shimmerIntensity: 0.3,

        // Light trails for movement
        trails: true,
        trailLength: 0.36,
        trailOpacity: 0.48,

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
            pulseAmplitude: 0.26,
        },
        phaser: {
            glowRadius: 20,
            glowIntensity: 1.0,
            outlineWidth: 2.5,
            pulseAmplitude: 0.36,
        },
    },
};
