/**
 * Stillwater — content tiers. Every tier keeps the whole picture and every event.
 *
 * mirror      resolution scale of the pass that mirrors what stands in the scene (0 = none: the
 *             tarn still mirrors the sky, the moon and the far wood, which costs no pass)
 * lite        the cut-down sky function (no stars, no northern lights, one rank of spruce fewer)
 * glitter     the water's finest ripple
 * columns     the long reflections the lights lay on the water (wisps included)
 * cell        metres between the ground mesh's vertices
 * trunks      trees on the banks (the eight placed by hand always)
 * boughs      drooping spruce boughs
 * boulders, saplings, lilies, reeds, ferns, caps   what lies and grows there
 * eyes        pairs of eyes in the far wood
 * fireflies   fireflies over the banks
 * sparks      pool of the motes every splash, stroke and burst is made of
 * mist        sheets of mist lying over the water
 * troll       which of the troll's four meshes (0 = the finest)
 */
import { normalizeQuality } from '../../utils/quality.js';

export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        mirror: 0,
        lite: true,
        glitter: false,
        columns: false,
        cell: 1.3,
        trunks: 30,
        boughs: 18,
        boulders: 12,
        saplings: 36,
        lilies: 14,
        reeds: 0,
        ferns: 0,
        caps: 24,
        eyes: 10,
        fireflies: 0,
        sparks: 192,
        mist: 2,
        troll: 3,
    }),
    Low: Object.freeze({
        mirror: 0,
        lite: false,
        glitter: false,
        columns: true,
        cell: 1.0,
        trunks: 44,
        boughs: 30,
        boulders: 16,
        saplings: 60,
        lilies: 20,
        reeds: 140,
        ferns: 40,
        caps: 36,
        eyes: 14,
        fireflies: 50,
        sparks: 320,
        mist: 3,
        troll: 3,
    }),
    Medium: Object.freeze({
        mirror: 0.4,
        lite: false,
        glitter: true,
        columns: true,
        cell: 0.75,
        trunks: 70,
        boughs: 50,
        boulders: 22,
        saplings: 120,
        lilies: 30,
        reeds: 300,
        ferns: 90,
        caps: 60,
        eyes: 20,
        fireflies: 100,
        sparks: 640,
        mist: 4,
        troll: 2,
    }),
    High: Object.freeze({
        mirror: 0.5,
        lite: false,
        glitter: true,
        columns: true,
        cell: 0.55,
        trunks: 104,
        boughs: 76,
        boulders: 30,
        saplings: 200,
        lilies: 46,
        reeds: 520,
        ferns: 150,
        caps: 90,
        eyes: 28,
        fireflies: 150,
        sparks: 960,
        mist: 5,
        troll: 1,
    }),
    Ultra: Object.freeze({
        mirror: 0.6,
        lite: false,
        glitter: true,
        columns: true,
        cell: 0.5,
        trunks: 124,
        boughs: 92,
        boulders: 36,
        saplings: 250,
        lilies: 56,
        reeds: 700,
        ferns: 200,
        caps: 110,
        eyes: 28,
        fireflies: 200,
        sparks: 1280,
        mist: 6,
        troll: 0,
    }),
    Extreme: Object.freeze({
        mirror: 0.75,
        lite: false,
        glitter: true,
        columns: true,
        cell: 0.45,
        trunks: 140,
        boughs: 104,
        boulders: 40,
        saplings: 300,
        lilies: 64,
        reeds: 900,
        ferns: 260,
        caps: 130,
        eyes: 28,
        fireflies: 260,
        sparks: 1600,
        mist: 6,
        troll: 0,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    // (An own name only: 'constructor' and its kind are names every object answers to.)
    return Object.prototype.hasOwnProperty.call(QUALITY, quality) ? QUALITY[quality] : QUALITY.High;
}

/** Keep playground overrides and the shipped graphics setting on the same quality tier. */
export function resolveStillwaterQuality(params, settings) {
    return normalizeQuality(
        params?.get?.('quality')
        || settings?.effectQuality
        || settings?.graphicsQuality
        || 'High',
    );
}
