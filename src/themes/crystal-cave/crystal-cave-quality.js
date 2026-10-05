import { normalizeQuality } from '../../utils/quality.js';

// Low tiers preserve the hero composition, scaling detail and offscreen work.
export const QUALITY_PRESETS = Object.freeze({
    Extreme: {
        crystalClusterCount: 52, particleCount: 1600, crystalClusters: 52, dustCount: 1600, eventParticles: 220, maxArcs: 7, maxRipples: 7, enablePost: true, reflectionScale: 0.4, pixelRatio: 1.5,
    },
    Ultra: {
        crystalClusterCount: 42, particleCount: 1200, crystalClusters: 42, dustCount: 1200, eventParticles: 180, maxArcs: 6, maxRipples: 6, enablePost: true, reflectionScale: 0.35, pixelRatio: 1.35,
    },
    High: {
        crystalClusterCount: 32, particleCount: 900, crystalClusters: 32, dustCount: 900, eventParticles: 140, maxArcs: 5, maxRipples: 5, enablePost: true, reflectionScale: 0.3, pixelRatio: 1.25,
    },
    Medium: {
        crystalClusterCount: 22, particleCount: 550, crystalClusters: 22, dustCount: 550, eventParticles: 100, maxArcs: 4, maxRipples: 4, enablePost: true, reflectionScale: 0.22, pixelRatio: 1,
    },
    Low: {
        crystalClusterCount: 14, particleCount: 260, crystalClusters: 14, dustCount: 260, eventParticles: 64, maxArcs: 3, maxRipples: 3, enablePost: false, reflectionScale: 0, pixelRatio: 0.9,
    },
    Minimal: {
        crystalClusterCount: 10, particleCount: 120, crystalClusters: 10, dustCount: 120, eventParticles: 36, maxArcs: 2, maxRipples: 2, enablePost: false, reflectionScale: 0, pixelRatio: 0.75,
    },
});

export function resolveCrystalCaveQuality(quality) {
    const name = normalizeQuality(quality);
    return { name, preset: QUALITY_PRESETS[name] };
}
