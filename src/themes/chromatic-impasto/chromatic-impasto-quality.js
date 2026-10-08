/**
 * Chromatic Impasto — content tiers. Every tier keeps the whole painting and every event.
 *
 * canvasScale  paint texels per screen pixel (the painting is a texture a little larger than
 *              the frame); canvasMax caps its height
 * density      share of the underpainting's strokes that are laid
 * parallax     steps the view ray takes up to the paint's surface (0 = flat lookup)
 * shadowTaps   samples of the relief marched toward the lamp (0 = no cast shadows)
 * wideAo       a second, wider ring of occlusion taps
 * weave        the cloth's weave has its own relief (else only its tone)
 * droplets     drops of thrown paint in the air at once
 * motes        dust in the lamp's beam
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        canvasScale: 0.7,
        canvasMax: 720,
        density: 0.6,
        parallax: 0,
        shadowTaps: 0,
        wideAo: false,
        weave: false,
        droplets: 96,
        motes: 0,
    }),
    Low: Object.freeze({
        canvasScale: 0.85,
        canvasMax: 900,
        density: 0.75,
        parallax: 0,
        shadowTaps: 3,
        wideAo: false,
        weave: true,
        droplets: 160,
        motes: 0,
    }),
    Medium: Object.freeze({
        canvasScale: 1.0,
        canvasMax: 1152,
        density: 0.9,
        parallax: 1,
        shadowTaps: 5,
        wideAo: false,
        weave: true,
        droplets: 256,
        motes: 28,
    }),
    High: Object.freeze({
        canvasScale: 1.2,
        canvasMax: 1408,
        density: 1,
        parallax: 2,
        shadowTaps: 8,
        wideAo: true,
        weave: true,
        droplets: 384,
        motes: 44,
    }),
    Ultra: Object.freeze({
        canvasScale: 1.35,
        canvasMax: 1664,
        density: 1.1,
        parallax: 2,
        shadowTaps: 10,
        wideAo: true,
        weave: true,
        droplets: 512,
        motes: 60,
    }),
    Extreme: Object.freeze({
        canvasScale: 1.5,
        canvasMax: 1920,
        density: 1.2,
        parallax: 3,
        shadowTaps: 12,
        wideAo: true,
        weave: true,
        droplets: 640,
        motes: 76,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
