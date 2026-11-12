/**
 * Cosmic Noir — content tiers. Every tier keeps the whole picture and every event.
 *
 * march       the most steps a view ray takes to find the sea of smoke
 * shadow      taps toward the lamp that find a swell's shadow on the sea (0 = shade by slope alone)
 * fine        the sea's finest layer (wisps near the eye) and the ripples a lock leaves
 * tower       the most steps a view ray takes to find the lighthouse and its rock
 * air         arcs the lamp's light in the air is summed over along a view ray
 * wisps       steps through the smoke that drifts past the lens (0 = none)
 * detail      the smoke in the air is read for its threads, and the galaxy for its dust
 * scale       the air's target, as a share of the drawing buffer
 * noise       the baked smoke volume's edge, in texels
 * sea         the baked sea field's edge, in texels
 * skyLayers   lattices of far stars
 * dust        film dust specks on the print (the post)
 *
 * The drawing buffer itself grows with the tier's pixel ratio (High 1.15, Ultra 1.35, Extreme 1.6),
 * so the air's target stops growing past High: what the upper tiers add is steps (finer shadows on
 * the sea, cleaner shafts).
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        march: 20, shadow: 0, fine: false, tower: 40, air: 8, wisps: 0, detail: false, scale: 0.34, noise: 32, sea: 128, skyLayers: 1, dust: false,
    }),
    Low: Object.freeze({
        march: 28, shadow: 4, fine: false, tower: 48, air: 10, wisps: 0, detail: false, scale: 0.4, noise: 48, sea: 128, skyLayers: 2, dust: true,
    }),
    Medium: Object.freeze({
        march: 40, shadow: 6, fine: true, tower: 56, air: 12, wisps: 4, detail: true, scale: 0.45, noise: 64, sea: 256, skyLayers: 2, dust: true,
    }),
    High: Object.freeze({
        march: 52, shadow: 8, fine: true, tower: 64, air: 14, wisps: 6, detail: true, scale: 0.55, noise: 64, sea: 256, skyLayers: 3, dust: true,
    }),
    Ultra: Object.freeze({
        march: 64, shadow: 10, fine: true, tower: 72, air: 16, wisps: 6, detail: true, scale: 0.52, noise: 64, sea: 256, skyLayers: 3, dust: true,
    }),
    Extreme: Object.freeze({
        march: 76, shadow: 12, fine: true, tower: 80, air: 18, wisps: 8, detail: true, scale: 0.48, noise: 64, sea: 256, skyLayers: 3, dust: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
