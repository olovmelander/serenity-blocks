/**
 * Stillwater Theme - Tetromino Visual Configuration
 *
 * Mystical forest color palette inspired by tranquil waters,
 * twilight mist, and bioluminescent fireflies in a serene forest.
 *
 * Color Palette:
 * - Soft cyans and teals (water reflections)
 * - Gentle lavenders (twilight sky)
 * - Pale yellows (firefly light)
 * - Soft blues and greens (forest tranquility)
 */

export const STILLWATER_TETROMINOS = {
    version: 1,

    // Mystical forest palette
    colors: {
        I: '#5fc3c1',  // Soft Cyan (water/mist)
        O: '#fff9c4',  // Pale Yellow (firefly glow)
        T: '#b39ddb',  // Lavender (twilight)
        S: '#80deea',  // Cyan-Blue (water reflection)
        Z: '#4db6ac',  // Soft Teal (forest pool)
        J: '#81c784',  // Soft Green (forest canopy)
        L: '#64b5f6',  // Soft Blue (twilight sky)
        GARBAGE: '#1a1f2e', // Dark blue-grey (night forest)
    },

    // Gentle glow render mode (mystical forest aesthetic)
    renderMode: 'glow',

    effects: {
        // Subtle mystical glow
        glowRadius: 10,
        glowIntensity: 0.65,
        glowColor: 'auto', // Use piece color for glow

        // Soft outline for gentle definition
        outline: true,
        outlineWidth: 1.5,
        outlineColor: 'lighten',

        // Slow, tranquil pulsing like breathing
        pulse: true,
        pulseSpeed: 0.025,     // Very slow pulse for calm effect
        pulseAmplitude: 0.2,   // Gentle pulsing

        // Soft shimmer effect like water reflection
        shimmer: true,
        shimmerSpeed: 0.04,
        shimmerIntensity: 0.12,

        // Optional: Gentle trailing like mist (if supported)
        trails: true,
        trailLength: 0.1,
        trailOpacity: 0.25,
    },

    // Renderer-specific tweaks
    rendererOverrides: {
        canvas: {
            glowRadius: 8,       // Subtle glow in Canvas
            glowIntensity: 0.6,  // Gentle atmospheric glow
            outlineWidth: 1.5,   // Soft outline
        },
        phaser: {
            glowRadius: 12,      // Enhanced glow with WebGL
            glowIntensity: 0.7,  // Slightly more intense in WebGL
            outlineWidth: 2,     // Defined but soft outline
        },
    },
};
