/**
 * Painted Ages — content budgets per quality tier. Every tier keeps the land, the light, the
 * hours and every gameplay beat; the tiers scale the mesh, the flutes, the shadow targets, the
 * cloud layers and the fixed effect pools.
 *
 *   fanCols × fanRows  land mesh posts
 *   flutes             rill octaves near the eye (0 = the baked slopes only)
 *   shadow             sun-visibility target edge per field; shadowSteps their march
 *   clouds             1 = the cumulus deck overhead, 2 = + high cirrus; banks = cumulus heaps on the horizon
 *   motes              pigment motes in the air at once (dust, sparks, rain streaks)
 *   props              the boardwalk and pavilion's detail (0 = silhouette parts only)
 */
const tier = (o) => Object.freeze({ ...o, shadow: Object.freeze(o.shadow) });

export const QUALITY = Object.freeze({
    Minimal: tier({
        fanCols: 220, fanRows: 200, flutes: 0, shadow: { near: 256, mid: 128, far: 64 }, shadowSteps: 22,
        clouds: 1, banks: 5, motes: 256, props: 0, pixelRatioCap: 0.7,
    }),
    Low: tier({
        fanCols: 300, fanRows: 270, flutes: 0, shadow: { near: 384, mid: 192, far: 96 }, shadowSteps: 28,
        clouds: 1, banks: 7, motes: 512, props: 1, pixelRatioCap: 0.85,
    }),
    Medium: tier({
        fanCols: 420, fanRows: 380, flutes: 1, shadow: { near: 512, mid: 256, far: 128 }, shadowSteps: 34,
        clouds: 2, banks: 9, motes: 1024, props: 1, pixelRatioCap: 1.0,
    }),
    High: tier({
        fanCols: 560, fanRows: 500, flutes: 2, shadow: { near: 768, mid: 384, far: 192 }, shadowSteps: 42,
        clouds: 2, banks: 10, motes: 2048, props: 2, pixelRatioCap: 1.15,
    }),
    Ultra: tier({
        fanCols: 680, fanRows: 600, flutes: 2, shadow: { near: 1024, mid: 512, far: 256 }, shadowSteps: 48,
        clouds: 2, banks: 10, motes: 3072, props: 2, pixelRatioCap: 1.35,
    }),
    Extreme: tier({
        fanCols: 800, fanRows: 700, flutes: 2, shadow: { near: 1024, mid: 512, far: 256 }, shadowSteps: 56,
        clouds: 2, banks: 10, motes: 4096, props: 2, pixelRatioCap: 1.6,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
