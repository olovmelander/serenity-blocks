/**
 * Gameplay-piece treatment for Serenity Warp.
 * Mirrors the crystalline chromadelic palette used by the intro renderer.
 */
export const SERENITY_WARP_TETROMINOS = {
    version: 1,
    colors: {
        I: '#52ef32',
        O: '#ffa31a',
        T: '#536dff',
        S: '#35e6ef',
        Z: '#ff3b30',
        J: '#ffe23d',
        L: '#d33bea',
        GARBAGE: '#15102a',
    },
    renderMode: 'glow',
    effects: {
        glowRadius: 12,
        glowIntensity: 0.82,
        glowColor: 'auto',
        outline: true,
        outlineWidth: 1.8,
        outlineColor: 'lighten',
        innerGlow: true,
        innerGlowRadius: 3,
        innerGlowIntensity: 0.52,
        shimmer: true,
        shimmerSpeed: 0.035,
        shimmerIntensity: 0.22,
        pulse: true,
        pulseSpeed: 0.025,
        pulseAmplitude: 0.18,
        trails: true,
        trailLength: 0.17,
        trailOpacity: 0.34,
    },
    rendererOverrides: {
        canvas: {
            glowRadius: 10,
            glowIntensity: 0.75,
            outlineWidth: 1.5,
        },
        phaser: {
            glowRadius: 14,
            glowIntensity: 0.88,
            outlineWidth: 2,
        },
    },
};
