/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ STELLAR DRIFT ✧ - Tetromino Configuration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Deep space color palette for tetrominoes
 */

export const STELLAR_DRIFT_TETROMINOS = {
    version: 1,
    colors: {
        I: '#ffd662', // Solar gold
        O: '#5ee7df', // Aurora teal
        T: '#ff6b4a', // Supernova orange
        S: '#f472b6', // Cosmic pink
        Z: '#2d4a8c', // Stellar blue
        J: '#8b5cf6', // Nebula violet
        L: '#4a1a6b', // Deep indigo
        GARBAGE: '#3a3a5a', // Space dust gray
    },
    renderMode: 'glow',
    effects: {
        glowRadius: 8,
        glowIntensity: 0.6,
        outline: true,
        outlineWidth: 1,
        outlineColor: 'rgba(255, 255, 255, 0.3)',
    },
};
