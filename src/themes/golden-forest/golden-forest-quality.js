/**
 * Golden Forest — one table for everything a quality tier scales.
 *
 * groveTrees / farTrees   modelled conifers beyond the hand-placed ones / sprite trees on the
 *                         far shores
 * foliage                 share of each tree's needle sprays that are instanced (survivors
 *                         grow to keep crowns closed)
 * limbs                   draw the limb geometry of the bark meshes
 * shadowMap               size of the one static sun shadow map
 * reeds .. rocks          instanced shore detail
 * sparks                  fireflies (ambient plus the hidden event reserve)
 * motes, birds, mist      sunlit dust, the flock, mist banks on the water
 * ripples                 rings the lake can carry at once
 * reflection              resolution scale of the lake's planar mirror
 * godrays, godraysScale   raymarch steps and resolution of the volumetric sun shafts
 *                         (0 leaves a warmer haze toward the sun instead)
 * ribbons                 light ribbons a long combo draws across the sky
 * bloomScale, post        the RenderPipeline (off: the scene is drawn directly with ACES)
 */
const COLUMNS = ['groveTrees', 'farTrees', 'foliage', 'limbs', 'shadowMap', 'reeds', 'grass', 'rocks', 'sparks',
    'motes', 'birds', 'mist', 'ripples', 'reflection', 'godrays', 'godraysScale', 'ribbons', 'bloomScale', 'post'];
const ROWS = {
    Extreme: [46, 420, 1, true, [4096, 2048], 2600, 5200, 70, 3400, 520, 140, 6, 10, 0.75, 40, 0.5, 4, 0.5, true],
    Ultra: [40, 360, 1, true, [4096, 2048], 2200, 4400, 60, 2800, 420, 110, 6, 10, 0.6, 32, 0.5, 4, 0.5, true],
    High: [34, 300, 0.86, true, [2048, 1024], 1800, 3400, 52, 2200, 320, 84, 5, 8, 0.5, 26, 0.5, 3, 0.45, true],
    Medium: [26, 220, 0.62, true, [2048, 1024], 1100, 2000, 40, 1400, 200, 56, 4, 6, 0.4, 16, 0.35, 3, 0.35, true],
    Low: [18, 140, 0.4, false, [1024, 512], 520, 900, 26, 800, 110, 30, 3, 4, 0.3, 0, 0, 2, 0, false],
    Minimal: [12, 90, 0.28, false, [1024, 512], 260, 420, 16, 420, 60, 0, 2, 4, 0.22, 0, 0, 2, 0, false],
};

export const GOLDEN_FOREST_TIERS = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [
    name,
    Object.freeze(Object.fromEntries(COLUMNS.map((key, index) => [key, row[index]]))),
])));

export function goldenForestTier(quality) {
    return GOLDEN_FOREST_TIERS[quality] || GOLDEN_FOREST_TIERS.High;
}
