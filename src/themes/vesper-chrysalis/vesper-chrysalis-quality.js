/**
 * Vesper Chrysalis — content tiers. Every tier keeps the whole picture and every event.
 *
 * mirror      resolution scale of the pass that mirrors what stands in the scene (0 = none: the
 *             lake still mirrors the whole sky, which costs no pass)
 * lite        the cut-down sky function (no stars, one cloud octave, flat aurora)
 * glitter     the lake's finest ripple
 * blooms      lantern lilies afloat
 * whorls      rings of petals in each lily
 * pads        loose leaves floated round each lily (about so many)
 * spires      crystals in each of the two stands
 * reeds       blades in the foreground
 * threads     silk threads the chrysalis hangs by (the four long ones always)
 * dust        wing-scale pool
 * fireflies   fireflies over the water
 * flutter     moths that keep the chrysalis company, and the wings of a burst out of it
 * wingDetail  0 = veins and bands only, 1 = + the glitter of the scales, 2 = + fine cross-veins
 * glints      facets of the chrysalis that can flash a star
 * glintStride every n-th of the crystals' glint points is kept
 */
import { normalizeQuality } from '../../utils/quality.js';

export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        mirror: 0,
        lite: true,
        glitter: false,
        blooms: 10,
        whorls: 2,
        pads: 0,
        spires: 5,
        reeds: 0,
        threads: 7,
        dust: 160,
        fireflies: 36,
        flutter: 6,
        flutterBurst: 18,
        wingDetail: 0,
        glints: 24,
        glintStride: 4,
    }),
    Low: Object.freeze({
        mirror: 0,
        lite: false,
        glitter: false,
        blooms: 12,
        whorls: 2,
        pads: 1,
        spires: 6,
        reeds: 60,
        threads: 9,
        dust: 256,
        fireflies: 60,
        flutter: 8,
        flutterBurst: 28,
        wingDetail: 0,
        glints: 36,
        glintStride: 3,
    }),
    Medium: Object.freeze({
        mirror: 0.4,
        lite: false,
        glitter: true,
        blooms: 16,
        whorls: 3,
        pads: 2,
        spires: 8,
        reeds: 110,
        threads: 11,
        dust: 512,
        fireflies: 110,
        flutter: 12,
        flutterBurst: 44,
        wingDetail: 1,
        glints: 56,
        glintStride: 2,
    }),
    High: Object.freeze({
        mirror: 0.5,
        lite: false,
        glitter: true,
        blooms: 20,
        whorls: 3,
        pads: 2,
        spires: 9,
        reeds: 150,
        threads: 13,
        dust: 768,
        fireflies: 160,
        flutter: 16,
        flutterBurst: 64,
        wingDetail: 2,
        glints: 80,
        glintStride: 1,
    }),
    Ultra: Object.freeze({
        mirror: 0.6,
        lite: false,
        glitter: true,
        blooms: 22,
        whorls: 3,
        pads: 3,
        spires: 10,
        reeds: 190,
        threads: 15,
        dust: 1024,
        fireflies: 210,
        flutter: 20,
        flutterBurst: 84,
        wingDetail: 2,
        glints: 96,
        glintStride: 1,
    }),
    Extreme: Object.freeze({
        mirror: 0.75,
        lite: false,
        glitter: true,
        blooms: 24,
        whorls: 3,
        pads: 3,
        spires: 11,
        reeds: 230,
        threads: 17,
        dust: 1400,
        fireflies: 260,
        flutter: 24,
        flutterBurst: 110,
        wingDetail: 2,
        glints: 110,
        glintStride: 1,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}

/** Keep playground overrides and the shipped graphics setting on the same quality tier. */
export function resolveVesperQuality(params, settings) {
    return normalizeQuality(
        params?.get?.('quality')
        || settings?.effectQuality
        || settings?.graphicsQuality
        || 'High',
    );
}
