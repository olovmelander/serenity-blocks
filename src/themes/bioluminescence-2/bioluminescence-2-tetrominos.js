/**
 * Bioluminescence II — tetromino palette + render config.
 *
 * Same shape as the original BIOLUMINESCENCE_TETROMINOS (version / colors /
 * renderMode / effects / rendererOverrides) so the renderer pipeline treats it
 * identically — but a distinct, harmonious palette drawn from the new theme's
 * reference art: deep cyan + teal + aqua glow with violet + magenta accents and a
 * white-cyan "coral core" highlight. Glow render mode for the signature
 * bioluminescent bloom.
 */
export const BIOLUMINESCENCE_2_TETROMINOS = {
    version: 1,

    // Reef-glow spectrum: cyan/teal/aqua body with violet + magenta accents.
    colors: {
        I: '#46e6ff', // bright cyan (the coral-tree / waterfall glow)
        O: '#caf4ff', // white-cyan (coral core highlight)
        T: '#2fd6d8', // teal (plankton glow)
        S: '#39c8e8', // aqua
        Z: '#7b54f0', // violet (foreground bloom)
        J: '#4f7cff', // crystal blue
        L: '#d14fd0', // magenta (foreground mushrooms)
        GARBAGE: '#1b3358', // deep cavern blue (minimal glow)
    },

    // Signature glowing render mode (bioluminescent bloom).
    renderMode: 'glow',

    effects: {
        // Soft glowing aura around each block.
        glowRadius: 9,
        glowIntensity: 0.65,
        glowColor: 'auto', // use the piece color for its glow

        // Brighter outline for crisp definition against the dark board.
        outline: true,
        outlineWidth: 2,
        outlineColor: 'lighten',

        // Slow organic pulse, like breathing bioluminescent organisms.
        pulse: true,
        pulseSpeed: 0.03,
        pulseAmplitude: 0.16,
    },

    // Renderer-specific tweaks (mirrors the original theme's overrides).
    rendererOverrides: {
        canvas: {
            glowRadius: 7,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 11,
            glowIntensity: 0.72,
        },
    },
};
