/**
 * Grainfields — per-tier budgets.
 *
 *  - fan: the land mesh's columns × rows (one eye's fan: every triangle a few pixels);
 *  - fells: Lapporten's mesh, columns across the gate × rows along it;
 *  - clouds: 0 the deck alone, 1 + the walls of its gaps, 2 + the high cirrus;
 *  - cloudSteps, cloudScale: the deck marched as a volume (grainfields-clouds.js), samples along
 *    a ray and the target's resolution (0 steps: the deck drawn flat in the dome);
 *  - grain: the barley round the eye: `near` clumps (six stalks with awned ears, to `nearReach`
 *    metres) and `far` clumps (three stalks, on over the near field's crest to `farReach`; every
 *    tier reaches past the crest, so its skyline is ears), at constant density on screen;
 *  - forest: the shelterbelts: Blender trees out to `near` metres (keeping `sprays` of their
 *    sprays, fewer far out), sprites beyond when `sprites`;
 *  - herd, birds, motes: the horses, a flock's size, the mote pool;
 *  - lens: the ears by the lens (soft in the frame's bottom corners; a handful of quads).
 */
const TIERS = {
    Extreme: {
        fan: { cols: 320, rows: 300 },
        fells: { cols: 540, rows: 190 },
        clouds: 2,
        cloudSteps: 22,
        cloudScale: 0.5,
        grain: {
            near: 34000, far: 30000, nearReach: 34, farReach: 160,
        },
        forest: { near: 1300, sprays: 1, sprites: 1 },
        herd: 9,
        birds: 34,
        motes: 2600,
        lens: 6,
    },
    Ultra: {
        fan: { cols: 288, rows: 270 },
        fells: { cols: 480, rows: 170 },
        clouds: 2,
        cloudSteps: 20,
        cloudScale: 0.5,
        grain: {
            near: 28000, far: 24000, nearReach: 32, farReach: 155,
        },
        forest: { near: 1200, sprays: 1, sprites: 1 },
        herd: 9,
        birds: 30,
        motes: 2200,
        lens: 6,
    },
    High: {
        fan: { cols: 256, rows: 240 },
        fells: { cols: 420, rows: 150 },
        clouds: 2,
        cloudSteps: 18,
        cloudScale: 0.5,
        grain: {
            near: 22000, far: 18000, nearReach: 30, farReach: 150,
        },
        forest: { near: 1100, sprays: 0.85, sprites: 1 },
        herd: 8,
        birds: 26,
        motes: 1800,
        lens: 6,
    },
    Medium: {
        fan: { cols: 200, rows: 190 },
        fells: { cols: 320, rows: 120 },
        clouds: 1,
        cloudSteps: 14,
        cloudScale: 0.42,
        grain: {
            near: 12000, far: 10000, nearReach: 26, farReach: 145,
        },
        forest: { near: 800, sprays: 0.6, sprites: 1 },
        herd: 7,
        birds: 18,
        motes: 1100,
        lens: 6,
    },
    Low: {
        fan: { cols: 150, rows: 140 },
        fells: { cols: 240, rows: 92 },
        clouds: 0,
        cloudSteps: 10,
        cloudScale: 0.34,
        grain: {
            near: 6000, far: 5000, nearReach: 22, farReach: 140,
        },
        forest: { near: 520, sprays: 0.45, sprites: 1 },
        herd: 6,
        birds: 12,
        motes: 600,
        lens: 4,
    },
    Minimal: {
        fan: { cols: 110, rows: 100 },
        fells: { cols: 180, rows: 72 },
        clouds: 0,
        cloudSteps: 0,
        cloudScale: 0,
        grain: {
            near: 3000, far: 2400, nearReach: 18, farReach: 135,
        },
        forest: { near: 320, sprays: 0.35, sprites: 1 },
        herd: 5,
        birds: 8,
        motes: 300,
        lens: 2,
    },
};

export const QUALITY = Object.freeze(Object.fromEntries(Object.entries(TIERS)
    .map(([name, tier]) => [name, Object.freeze({ name, ...tier })])));
export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

/** The tier for a quality name (High for anything unknown). */
export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
