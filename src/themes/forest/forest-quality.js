/**
 * Forest — one table for everything a quality tier scales.
 *
 * groveTrees / farTrees   modelled trees beyond the hand-placed ones / sprite trees in the
 *                         stands behind them
 * foliage                 share of each tree's sprays that are instanced (survivors grow to
 *                         keep crowns closed)
 * limbs                   draw the limb geometry of the bark meshes
 * shadowMap               size of the one static moon shadow map
 * ferns, grass, fungi     fern rosettes, grass tufts and foxfire caps on the forest floor
 * flowers, rocks          wood stars in the moss, boulders
 * fireflies               ambient fireflies plus the hidden reserve the game calls on
 * trail                   segments in a firefly's light trail (0 draws no trails)
 * lightMap                side of the map the fireflies' light is gathered into (0: the
 *                         floor is not lit by them)
 * pulses                  waves of light the forest can carry at once
 * motes, mist             moths and dust in the moonbeams, banks of mist between the stands
 * stars                   draw the star field (the Milky Way comes with it)
 * godrays, godraysScale   raymarch steps and resolution of the volumetric moonbeams
 *                         (0 leaves a brighter haze toward the moon instead)
 * bloomScale, post        the RenderPipeline (off: the scene is drawn directly with ACES)
 * rays                    taps of the screen-space march that streams the moon's light through
 *                         the gaps in the boughs (0: none)
 * fungusLight             the fungi shed pools of their cold light on the moss round them
 * flurry                  what the events throw into the air besides fireflies (dew, spores,
 *                         wisps, leaves, falling gold): how many may be in flight at once
 * wisps                   wreaths of mist drifting low through the ride, near the eye
 */
const COLUMNS = ['groveTrees', 'farTrees', 'foliage', 'limbs', 'shadowMap', 'ferns', 'grass', 'fungi', 'flowers',
    'rocks', 'fireflies', 'trail', 'lightMap', 'pulses', 'motes', 'mist', 'stars', 'godrays', 'godraysScale',
    'bloomScale', 'post', 'rays', 'fungusLight', 'flurry', 'wisps'];
const ROWS = {
    Extreme: [58, 380, 1, true, [4096, 2048], 360, 5200, 260, 900, 26, 3600, 8, 128, 6, 520, 5, true, 40, 0.5, 0.5,
        true, 24, true, 3800, 14],
    Ultra: [52, 320, 1, true, [4096, 2048], 300, 4400, 220, 760, 24, 3000, 8, 128, 6, 420, 5, true, 32, 0.5, 0.5,
        true, 22, true, 3300, 12],
    High: [44, 260, 0.86, true, [2048, 1024], 250, 3400, 180, 600, 20, 2400, 6, 96, 5, 320, 4, true, 26, 0.5, 0.45,
        true, 20, true, 2600, 10],
    Medium: [34, 190, 0.62, true, [2048, 1024], 170, 2000, 120, 380, 16, 1600, 5, 64, 4, 200, 3, true, 16, 0.35,
        0.35, true, 14, true, 1730, 7],
    Low: [22, 120, 0.4, false, [1024, 512], 100, 900, 70, 180, 10, 900, 3, 0, 3, 110, 2, true, 0, 0, 0, false, 0,
        true, 1040, 4],
    Minimal: [14, 80, 0.28, false, [1024, 512], 60, 420, 36, 0, 6, 480, 0, 0, 2, 60, 1, false, 0, 0, 0, false, 0,
        false, 555, 0],
};

export const FOREST_TIERS = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [
    name,
    Object.freeze(Object.fromEntries(COLUMNS.map((key, index) => [key, row[index]]))),
])));

export function forestTier(quality) {
    return FOREST_TIERS[quality] || FOREST_TIERS.High;
}
