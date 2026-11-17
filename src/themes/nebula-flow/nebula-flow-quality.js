/**
 * Nebula Flow — content tiers. Every tier keeps the whole picture and every event.
 *
 * lightTaps    taps toward the cluster for the dust's self-shadow (the depth of its shading)
 * detail       octaves of relief on the dust (its billows and their normals)
 * veils        the veils' second, finer filaments, and the wisps drifting in front of the dust
 * litGas       the cavity's gas lit as a volume (its billows read again a step nearer the light)
 * starLayers   lattices of far stars drawn in the nursery itself
 * farRim       the far range's rims follow its rough edges (else a soft light on its heads)
 * stars        field stars drawn as sprites (the bright ones wear diffraction spikes)
 * ambient      young stars already in the pillars with no play (their jets breathe)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        lightTaps: 3,
        detail: 1,
        veils: false,
        litGas: false,
        starLayers: 1,
        farRim: false,
        stars: 60,
        ambient: 2,
    }),
    Low: Object.freeze({
        lightTaps: 3,
        detail: 2,
        veils: false,
        litGas: false,
        starLayers: 1,
        farRim: false,
        stars: 90,
        ambient: 3,
    }),
    Medium: Object.freeze({
        lightTaps: 4,
        detail: 2,
        veils: true,
        litGas: true,
        starLayers: 2,
        farRim: true,
        stars: 120,
        ambient: 4,
    }),
    High: Object.freeze({
        lightTaps: 5,
        detail: 3,
        veils: true,
        litGas: true,
        starLayers: 2,
        farRim: true,
        stars: 150,
        ambient: 5,
    }),
    Ultra: Object.freeze({
        lightTaps: 6,
        detail: 3,
        veils: true,
        litGas: true,
        starLayers: 2,
        farRim: true,
        stars: 180,
        ambient: 6,
    }),
    Extreme: Object.freeze({
        lightTaps: 7,
        detail: 3,
        veils: true,
        litGas: true,
        starLayers: 2,
        farRim: true,
        stars: 220,
        ambient: 6,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
