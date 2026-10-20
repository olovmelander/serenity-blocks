/**
 * Cosmic Noir — content tiers. Every tier keeps the whole picture and every event.
 *
 * march       steps along a view ray through the smoke
 * taps        reads of the smoke toward the pulsar per lit step (0 = the beams light it flat)
 * detail      the finer read that frays the smoke's filaments
 * scale       the smoke's target, as a share of the drawing buffer
 * noise       the baked smoke volume's edge, in texels
 * skyLayers   lattices of far stars behind the smoke
 * dust        film dust specks on the print (the post)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        march: 12, taps: 0, detail: false, scale: 0.34, noise: 32, skyLayers: 1, dust: false,
    }),
    Low: Object.freeze({
        march: 16, taps: 0, detail: false, scale: 0.4, noise: 48, skyLayers: 2, dust: true,
    }),
    Medium: Object.freeze({
        march: 22, taps: 1, detail: true, scale: 0.45, noise: 64, skyLayers: 2, dust: true,
    }),
    High: Object.freeze({
        march: 30, taps: 1, detail: true, scale: 0.55, noise: 64, skyLayers: 3, dust: true,
    }),
    Ultra: Object.freeze({
        march: 38, taps: 1, detail: true, scale: 0.65, noise: 64, skyLayers: 3, dust: true,
    }),
    Extreme: Object.freeze({
        march: 46, taps: 1, detail: true, scale: 0.75, noise: 64, skyLayers: 3, dust: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
