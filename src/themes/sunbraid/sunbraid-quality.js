/**
 * Sunbraid — per-tier budgets. Every tier keeps the whole picture and every event: tiers cut
 * counts and detail, never a feature or a beat.
 *
 *  - fan: the land mesh's columns × rows (one fan round the eye);
 *  - stoneDetail: the stones' radial segments (doubled for the big far stones);
 *  - spire: the towers' meshes, bearings × heights;
 *  - gliders: how many gliders ride the valley's air.
 */
const TIERS = {
    Extreme: {
        fan: { cols: 360, rows: 300 },
        stoneDetail: 26,
        spire: { segs: 96, rings: 200 },
        gliders: 8,
    },
    Ultra: {
        fan: { cols: 320, rows: 270 },
        stoneDetail: 24,
        spire: { segs: 88, rings: 180 },
        gliders: 8,
    },
    High: {
        fan: { cols: 280, rows: 240 },
        stoneDetail: 22,
        spire: { segs: 80, rings: 160 },
        gliders: 6,
    },
    Medium: {
        fan: { cols: 220, rows: 190 },
        stoneDetail: 18,
        spire: { segs: 64, rings: 130 },
        gliders: 5,
    },
    Low: {
        fan: { cols: 160, rows: 140 },
        stoneDetail: 14,
        spire: { segs: 48, rings: 100 },
        gliders: 4,
    },
    Minimal: {
        fan: { cols: 120, rows: 104 },
        stoneDetail: 12,
        spire: { segs: 40, rings: 80 },
        gliders: 3,
    },
};

export const QUALITY = Object.freeze(Object.fromEntries(Object.entries(TIERS)
    .map(([name, tier]) => [name, Object.freeze({ name, ...tier })])));
export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

/** The tier for a quality name (High for anything unknown). */
export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
