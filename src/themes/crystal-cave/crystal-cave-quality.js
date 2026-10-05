import { normalizeQuality } from '../../utils/quality.js';

/**
 * One table for everything a tier scales. Every tier draws the same cavern and the same
 * hero crystals; lower tiers trace fewer internal bounces, drop the mirror and the
 * backdrop-refracting water, thin the small crystals and shrink the event pools.
 *
 *   bounces        internal ray segments traced inside a crystal
 *   dispersion     split the first exit into three wavelengths
 *   inclusions     growth phantoms and rainbow fractures inside the stone
 *   relief         light the rock's fine relief from the baked direction
 *   reflectionScale resolution of the pool's planar mirror (0 = none)
 *   refraction     bend the pool bed through the surface (needs a backdrop copy)
 *   druzy          share of the small crystals that is kept
 */
export const QUALITY_PRESETS = Object.freeze({
    Extreme: Object.freeze({
        bounces: 4, dispersion: true, inclusions: true, relief: true, reflectionScale: 0.5, refraction: true, druzy: 1, glowworms: 3200, motes: 1200, glints: 320, shaft: true, sparks: 640, fans: 8, beams: 14, rings: 12, enablePost: true, bloomScale: 0.6, pixelRatio: 1.5,
    }),
    Ultra: Object.freeze({
        bounces: 3, dispersion: true, inclusions: true, relief: true, reflectionScale: 0.45, refraction: true, druzy: 1, glowworms: 2600, motes: 900, glints: 260, shaft: true, sparks: 520, fans: 6, beams: 12, rings: 10, enablePost: true, bloomScale: 0.55, pixelRatio: 1.35,
    }),
    High: Object.freeze({
        bounces: 3, dispersion: true, inclusions: true, relief: true, reflectionScale: 0.38, refraction: true, druzy: 1, glowworms: 2000, motes: 700, glints: 200, shaft: true, sparks: 400, fans: 6, beams: 10, rings: 8, enablePost: true, bloomScale: 0.45, pixelRatio: 1.25,
    }),
    Medium: Object.freeze({
        bounces: 2, dispersion: false, inclusions: true, relief: true, reflectionScale: 0.28, refraction: true, druzy: 0.7, glowworms: 1200, motes: 400, glints: 120, shaft: true, sparks: 260, fans: 4, beams: 8, rings: 6, enablePost: true, bloomScale: 0.32, pixelRatio: 1,
    }),
    Low: Object.freeze({
        bounces: 1, dispersion: false, inclusions: false, relief: false, reflectionScale: 0, refraction: false, druzy: 0.4, glowworms: 600, motes: 160, glints: 60, shaft: true, sparks: 140, fans: 3, beams: 5, rings: 4, enablePost: false, bloomScale: 0, pixelRatio: 0.9,
    }),
    Minimal: Object.freeze({
        bounces: 1, dispersion: false, inclusions: false, relief: false, reflectionScale: 0, refraction: false, druzy: 0.25, glowworms: 300, motes: 80, glints: 30, shaft: true, sparks: 80, fans: 2, beams: 3, rings: 3, enablePost: false, bloomScale: 0, pixelRatio: 0.75,
    }),
});

export function resolveCrystalCaveQuality(quality) {
    const name = normalizeQuality(quality);
    return { name, preset: QUALITY_PRESETS[name] };
}
