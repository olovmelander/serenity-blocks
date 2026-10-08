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
 */
const COLUMNS = ['groveTrees', 'farTrees', 'foliage', 'limbs', 'shadowMap', 'ferns', 'grass', 'fungi', 'flowers',
    'rocks', 'fireflies', 'trail', 'lightMap', 'pulses', 'motes', 'mist', 'stars', 'godrays', 'godraysScale',
    'bloomScale', 'post'];
const ROWS = {
    Extreme: [58, 380, 1, true, [4096, 2048], 360, 5200, 260, 900, 26, 3600, 8, 128, 6, 520, 5, true, 40, 0.5, 0.5,
        true],
    Ultra: [52, 320, 1, true, [4096, 2048], 300, 4400, 220, 760, 24, 3000, 8, 128, 6, 420, 5, true, 32, 0.5, 0.5,
        true],
    High: [44, 260, 0.86, true, [2048, 1024], 250, 3400, 180, 600, 20, 2400, 6, 96, 5, 320, 4, true, 26, 0.5, 0.45,
        true],
    Medium: [34, 190, 0.62, true, [2048, 1024], 170, 2000, 120, 380, 16, 1600, 5, 64, 4, 200, 3, true, 16, 0.35,
        0.35, true],
    Low: [22, 120, 0.4, false, [1024, 512], 100, 900, 70, 180, 10, 900, 3, 0, 3, 110, 2, true, 0, 0, 0, false],
    Minimal: [14, 80, 0.28, false, [1024, 512], 60, 420, 36, 0, 6, 480, 0, 0, 2, 60, 1, false, 0, 0, 0, false],
};

export const FOREST_TIERS = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [
    name,
    Object.freeze(Object.fromEntries(COLUMNS.map((key, index) => [key, row[index]]))),
])));

export function forestTier(quality) {
    return FOREST_TIERS[quality] || FOREST_TIERS.High;
}
