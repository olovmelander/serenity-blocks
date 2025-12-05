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
        I: '#5ee7df', // Aurora teal
        O: '#ffd662', // Solar gold
        T: '#8b5cf6', // Nebula violet
        S: '#f472b6', // Cosmic pink
        Z: '#ff6b4a', // Supernova orange
        J: '#2d4a8c', // Stellar blue
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
