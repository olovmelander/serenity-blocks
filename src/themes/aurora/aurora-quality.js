import { normalizeQuality } from '../../utils/quality.js';

/**
 * Every tier keeps the whole picture — curtains, stars, peaks, the mirrored lake and all
 * three event languages. Tiers trade march resolution, sample counts and offscreen work.
 *
 *   arcCount       resting arcs marched (the storm corona arc rides on top of these)
 *   marchSteps     samples along each arc's slice of the view ray
 *   curtainScale   aurora buffer size relative to the drawing buffer
 *   curtainHz      aurora buffer refresh cap; the scene itself runs at the target rate
 *   hdrCurtains    half-float aurora buffer (otherwise RGBA8, tone-compressed + dithered)
 *   mirrorScale    planar lake reflection resolution; 0 = analytic sky-and-aurora mirror
 */
export const QUALITY_PRESETS = Object.freeze({
    Extreme: Object.freeze({
        arcCount: 3,
        marchSteps: 22,
        curtainScale: 0.75,
        curtainHz: 90,
        hdrCurtains: true,
        starCount: 9000,
        terrainColumns: 320,
        terrainRows: 120,
        treeCount: 46,
        dustCount: 1500,
        meteorSlots: 8,
        rippleSlots: 8,
        sparkCount: 260,
        mirrorScale: 0.5,
        enablePost: true,
        bloomScale: 0.6,
        pixelRatio: 1.5,
    }),
    Ultra: Object.freeze({
        arcCount: 3,
        marchSteps: 18,
        curtainScale: 0.66,
        curtainHz: 72,
        hdrCurtains: true,
        starCount: 7000,
        terrainColumns: 280,
        terrainRows: 104,
        treeCount: 38,
        dustCount: 1100,
        meteorSlots: 6,
        rippleSlots: 8,
        sparkCount: 200,
        mirrorScale: 0.42,
        enablePost: true,
        bloomScale: 0.55,
        pixelRatio: 1.35,
    }),
    High: Object.freeze({
        arcCount: 3,
        marchSteps: 16,
        curtainScale: 0.5,
        curtainHz: 60,
        hdrCurtains: true,
        starCount: 5200,
        terrainColumns: 240,
        terrainRows: 88,
        treeCount: 30,
        dustCount: 800,
        meteorSlots: 6,
        rippleSlots: 6,
        sparkCount: 150,
        mirrorScale: 0.35,
        enablePost: true,
        bloomScale: 0.45,
        pixelRatio: 1.25,
    }),
    Medium: Object.freeze({
        arcCount: 3,
        marchSteps: 12,
        curtainScale: 0.42,
        curtainHz: 48,
        hdrCurtains: true,
        starCount: 3400,
        terrainColumns: 192,
        terrainRows: 72,
        treeCount: 22,
        dustCount: 480,
        meteorSlots: 4,
        rippleSlots: 6,
        sparkCount: 100,
        mirrorScale: 0.26,
        enablePost: true,
        bloomScale: 0.32,
        pixelRatio: 1,
    }),
    Low: Object.freeze({
        arcCount: 2,
        marchSteps: 10,
        curtainScale: 0.36,
        curtainHz: 30,
        hdrCurtains: false,
        starCount: 2000,
        terrainColumns: 144,
        terrainRows: 56,
        treeCount: 14,
        dustCount: 220,
        meteorSlots: 3,
        rippleSlots: 4,
        sparkCount: 60,
        mirrorScale: 0,
        enablePost: false,
        bloomScale: 0,
        pixelRatio: 0.9,
    }),
    Minimal: Object.freeze({
        arcCount: 2,
        marchSteps: 8,
        curtainScale: 0.3,
        curtainHz: 24,
        hdrCurtains: false,
        starCount: 1200,
        terrainColumns: 112,
        terrainRows: 44,
        treeCount: 8,
        dustCount: 100,
        meteorSlots: 2,
        rippleSlots: 3,
        sparkCount: 32,
        mirrorScale: 0,
        enablePost: false,
        bloomScale: 0,
        pixelRatio: 0.75,
    }),
});

/** `Minimum` is the label older saved settings carry for the cheapest tier. */
export function normalizeAuroraQuality(quality) {
    const legacyMinimum = String(quality ?? '').trim().toLowerCase() === 'minimum';
    return normalizeQuality(legacyMinimum ? 'Minimal' : quality);
}

export function resolveAuroraQuality(quality) {
    const name = normalizeAuroraQuality(quality);
    return { name, preset: QUALITY_PRESETS[name] };
}
