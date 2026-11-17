/**
 * Sunbraid — per-tier budgets. Every tier keeps the whole picture and every event: tiers cut
 * counts and detail, never a feature or a beat.
 *
 *  - fan: the land mesh's columns × rows (one fan round the eye);
 *  - monolith: the towers' level of detail (sunbraid-monoliths.js);
 *  - gliders: how many gliders ride the valley's air;
 *  - mirror: what the wet plain mirrors of the dome: the whole of it ('full'), or its gradient
 *    with a glow and a glint for each sun ('lean': the towers still stand in it).
 */
const TIERS = {
    Extreme: {
        fan: { cols: 360, rows: 300 },
        monolith: 'hi',
        gliders: 12,
        mirror: 'full',
    },
    Ultra: {
        fan: { cols: 320, rows: 270 },
        monolith: 'hi',
        gliders: 12,
        mirror: 'full',
    },
    High: {
        fan: { cols: 280, rows: 240 },
        monolith: 'hi',
        gliders: 10,
        mirror: 'full',
    },
    Medium: {
        fan: { cols: 220, rows: 190 },
        monolith: 'hi',
        gliders: 8,
        mirror: 'full',
    },
    Low: {
        fan: { cols: 160, rows: 140 },
        monolith: 'lo',
        gliders: 6,
        mirror: 'lean',
    },
    Minimal: {
        fan: { cols: 120, rows: 104 },
        monolith: 'lo',
        gliders: 4,
        mirror: 'lean',
    },
};

export const QUALITY = Object.freeze(Object.fromEntries(Object.entries(TIERS)
    .map(([name, tier]) => [name, Object.freeze({ name, ...tier })])));
export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

/** The tier for a quality name (High for anything unknown). */
export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
