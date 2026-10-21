/**
 * Starlight — content tiers. Every tier keeps the whole picture and every event.
 *
 * stars       stars in the sky (each one a strip that can be drawn out into a trail)
 * segments    quads along a star's trail (a trail is an arc round the pole)
 * mirror      the share of the stars, brightest first, the water repeats
 * detail      the Milky Way's fine weave and its star grain
 * dustDetail  the dust's frayed edges and the threads drawn out along the band
 * nebulae     the emission clouds along the band
 * airglow     the banded airglow low in the sky
 * ripples     the water's fine ripple read (the swell and the rings are on every tier)
 * meteors     shooting stars in the air at once
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        stars: 4000,
        segments: 6,
        mirror: 0.45,
        detail: false,
        dustDetail: false,
        nebulae: false,
        airglow: false,
        ripples: false,
        meteors: 6,
    }),
    Low: Object.freeze({
        stars: 8000,
        segments: 8,
        mirror: 0.55,
        detail: false,
        dustDetail: false,
        nebulae: true,
        airglow: false,
        ripples: false,
        meteors: 8,
    }),
    Medium: Object.freeze({
        stars: 16000,
        segments: 10,
        mirror: 0.7,
        detail: true,
        dustDetail: true,
        nebulae: true,
        airglow: true,
        ripples: true,
        meteors: 10,
    }),
    High: Object.freeze({
        stars: 30000,
        segments: 14,
        mirror: 0.85,
        detail: true,
        dustDetail: true,
        nebulae: true,
        airglow: true,
        ripples: true,
        meteors: 12,
    }),
    Ultra: Object.freeze({
        stars: 42000,
        segments: 16,
        mirror: 1,
        detail: true,
        dustDetail: true,
        nebulae: true,
        airglow: true,
        ripples: true,
        meteors: 14,
    }),
    Extreme: Object.freeze({
        stars: 56000,
        segments: 20,
        mirror: 1,
        detail: true,
        dustDetail: true,
        nebulae: true,
        airglow: true,
        ripples: true,
        meteors: 16,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return Object.prototype.hasOwnProperty.call(QUALITY, quality) ? QUALITY[quality] : QUALITY.High;
}
