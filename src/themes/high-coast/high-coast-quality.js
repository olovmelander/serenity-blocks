/**
 * High Coast — content budgets per quality tier. Every tier keeps the coast, the sea, the light,
 * the hours and every gameplay beat; the tiers scale the meshes, the sea's mirror march, the
 * ripple layers, the shadow targets, the cloud layers, the number of trees and the effect pools.
 *
 *   fanCols × fanRows     land mesh posts
 *   detail                rock detail near the eye (0 = the baked slopes only)
 *   seaRings × seaSpokes  sea mesh (the water's look is per pixel; the mesh only carries curvature)
 *   ripples, rippleNoise  wind ripple trains and noise layers on the water
 *   mirrorSteps           the march that finds the islands in the sea's mirror (0 = sky only)
 *   sparkle               single sparks of the sun near the eye
 *   shadow                sun-visibility target edge per field; shadowSteps their march
 *   clouds                1 = the cumulus deck overhead, 2 = + high cirrus; banks = cumulus heaps
 *   trees                 conifers on the islands and the headland
 *   motes                 spray, drips and birds in the air at once
 *   props                 the hamlet, the pine and the sign: 0 = silhouette detail only
 */
const tier = (o) => Object.freeze({ ...o, shadow: Object.freeze(o.shadow) });

export const QUALITY = Object.freeze({
    Minimal: tier({
        fanCols: 220,
        fanRows: 200,
        detail: 0,
        seaRings: 90,
        seaSpokes: 64,
        ripples: 2,
        rippleNoise: 1,
        mirrorSteps: 6,
        sparkle: false,
        shadow: { near: 256, mid: 128, far: 64 },
        shadowSteps: 20,
        clouds: 1,
        banks: 6,
        trees: 4000,
        motes: 256,
        props: 0,
        pixelRatioCap: 0.7,
    }),
    Low: tier({
        fanCols: 300,
        fanRows: 270,
        detail: 0,
        seaRings: 110,
        seaSpokes: 80,
        ripples: 3,
        rippleNoise: 2,
        mirrorSteps: 10,
        sparkle: false,
        shadow: { near: 384, mid: 192, far: 96 },
        shadowSteps: 26,
        clouds: 1,
        banks: 8,
        trees: 8000,
        motes: 512,
        props: 1,
        pixelRatioCap: 0.85,
    }),
    Medium: tier({
        fanCols: 420,
        fanRows: 380,
        detail: 1,
        seaRings: 140,
        seaSpokes: 96,
        ripples: 4,
        rippleNoise: 2,
        mirrorSteps: 16,
        sparkle: true,
        shadow: { near: 512, mid: 256, far: 128 },
        shadowSteps: 32,
        clouds: 2,
        banks: 10,
        trees: 14000,
        motes: 1024,
        props: 1,
        pixelRatioCap: 1.0,
    }),
    High: tier({
        fanCols: 560,
        fanRows: 500,
        detail: 2,
        seaRings: 170,
        seaSpokes: 112,
        ripples: 5,
        rippleNoise: 3,
        mirrorSteps: 22,
        sparkle: true,
        shadow: { near: 768, mid: 384, far: 192 },
        shadowSteps: 40,
        clouds: 2,
        banks: 11,
        trees: 22000,
        motes: 2048,
        props: 2,
        pixelRatioCap: 1.15,
    }),
    Ultra: tier({
        fanCols: 680,
        fanRows: 600,
        detail: 2,
        seaRings: 190,
        seaSpokes: 128,
        ripples: 5,
        rippleNoise: 3,
        mirrorSteps: 28,
        sparkle: true,
        shadow: { near: 1024, mid: 512, far: 256 },
        shadowSteps: 46,
        clouds: 2,
        banks: 12,
        trees: 30000,
        motes: 3072,
        props: 2,
        pixelRatioCap: 1.35,
    }),
    Extreme: tier({
        fanCols: 800,
        fanRows: 700,
        detail: 2,
        seaRings: 210,
        seaSpokes: 144,
        ripples: 5,
        rippleNoise: 3,
        mirrorSteps: 34,
        sparkle: true,
        shadow: { near: 1024, mid: 512, far: 256 },
        shadowSteps: 54,
        clouds: 2,
        banks: 12,
        trees: 38000,
        motes: 4096,
        props: 2,
        pixelRatioCap: 1.6,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
