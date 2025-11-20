/**
 * Tetromino visual configuration for Stellar Velocity theme
 *
 * Color palette inspired by deep space and cosmic phenomena:
 * - Electric blue (warp energy)
 * - Solar gold (star energy)
 * - Quantum purple (hyperspace)
 * - Nebula pink (cosmic dust)
 * - Plasma green (aurora)
 * - Stellar white (pure starlight)
 * - Antimatter red (exotic matter)
 */

export const STELLAR_VELOCITY_TETROMINOS = {
    I: {
        color: '#00D9FF', // Electric Blue - warp drive energy
        borderColor: '#00A8CC',
        shadowColor: 'rgba(0, 217, 255, 0.4)',
        glowColor: 'rgba(0, 217, 255, 0.6)',
    },
    O: {
        color: '#FFD700', // Solar Gold - star energy
        borderColor: '#CCA600',
        shadowColor: 'rgba(255, 215, 0, 0.4)',
        glowColor: 'rgba(255, 215, 0, 0.6)',
    },
    T: {
        color: '#9D4EDD', // Quantum Purple - hyperspace
        borderColor: '#7B2CBF',
        shadowColor: 'rgba(157, 78, 221, 0.4)',
        glowColor: 'rgba(157, 78, 221, 0.6)',
    },
    S: {
        color: '#FF69B4', // Nebula Pink - cosmic dust
        borderColor: '#CC5490',
        shadowColor: 'rgba(255, 105, 180, 0.4)',
        glowColor: 'rgba(255, 105, 180, 0.6)',
    },
    Z: {
        color: '#00FF88', // Plasma Green - aurora
        borderColor: '#00CC6D',
        shadowColor: 'rgba(0, 255, 136, 0.4)',
        glowColor: 'rgba(0, 255, 136, 0.6)',
    },
    J: {
        color: '#F0F0F0', // Stellar White - pure starlight
        borderColor: '#C0C0C0',
        shadowColor: 'rgba(240, 240, 240, 0.4)',
        glowColor: 'rgba(240, 240, 240, 0.6)',
    },
    L: {
        color: '#FF4466', // Antimatter Red - exotic matter
        borderColor: '#CC3652',
        shadowColor: 'rgba(255, 68, 102, 0.4)',
        glowColor: 'rgba(255, 68, 102, 0.6)',
    },
    ghost: {
        color: 'rgba(255, 255, 255, 0.15)',
        borderColor: 'rgba(255, 255, 255, 0.3)',
        shadowColor: 'rgba(255, 255, 255, 0.1)',
        glowColor: 'rgba(255, 255, 255, 0.2)',
    },
    // Grid styling
    grid: {
        lineColor: 'rgba(100, 150, 255, 0.15)', // Subtle blue grid
        backgroundColor: 'rgba(0, 0, 20, 0.7)', // Dark semi-transparent
    },
    // Locked blocks styling (can add effects)
    locked: {
        shadowIntensity: 0.5,
        glowIntensity: 0.3,
    },
};
