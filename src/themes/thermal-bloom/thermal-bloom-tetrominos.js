/**
 * Thermal Bloom piece palette.
 *
 * Every piece wears a colour of the basin: the living bands of the great spring (Phormidium
 * orange, Calothrix rust, the winter mats' green), its water (cobalt, vent turquoise), the sulfur
 * lemon of its hottest mats and the rose of the streamers in its runoff. A lock spills the piece's
 * own colour into the ground, so the board's colours and the basin's living colours are one
 * palette. No shape wears the colour a falling-block player expects of it (palette gate 0/7), and
 * the set is checked under protanopia, deuteranopia and tritanopia simulation (worst pair ΔE 17.3,
 * deuteranopia I/T; docs/theme-concepts/iris-springs.md §3.13). The cells read as glazed mineral
 * tiles: a soft wet highlight, a thin darker rim of the same hue, a slight inner shadow, and no
 * glow, pulse, shimmer or trails, so active, ghost, hold, next and multiplayer previews stay crisp.
 * Garbage is dead sinter gone grey, the colour of the world's own decay.
 */

export const THERMAL_BLOOM_TETROMINOS = {
    version: 2,

    colors: {
        I: '#FF9A3C', // Phormidium Orange
        O: '#3A78F0', // Iris Cobalt (bright)
        T: '#F5D020', // Sulfur Lemon
        S: '#19C2D6', // Vent Turquoise
        Z: '#619945', // Mat Green (the winter mats)
        J: '#E2559A', // Streamer Rose
        L: '#BD3B1A', // Calothrix Rust
        GARBAGE: '#7E776C', // Bleached Sinter
        CLEAN_GARBAGE: '#CFE3E0', // Opal
    },

    renderMode: 'solid',

    effects: {
        premium: true,
        phaser: {
            gradient: true,
            highlight: 0.22,
            shadow: 0.18,
            rim: true,
            rimAlpha: 0.45,
            rimWidthFactor: 0.05,
            gloss: true,
            glossAlpha: 0.12,
        },
    },

    rendererOverrides: {},
};
