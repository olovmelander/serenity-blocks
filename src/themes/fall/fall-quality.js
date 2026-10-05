/**
 * Fall — one table for everything a quality tier scales.
 *
 * groveTrees / farTrees   modelled trees behind the two hero trees / sprite trees beyond them
 * foliage                 share of each tree's sprays that are instanced (survivors grow to
 *                         keep crowns closed)
 * twigs                   draw the finest bark geometry
 * shadowMap               size of the one static sun shadow map
 * litter .. rocks         instanced forest-floor detail
 * leaves                  leaves in the air (ambient plus the hidden event reserve)
 * motes, wisps, mist      sunlit dust, drifting lights, mist banks
 * godrays, godraysScale   raymarch steps and resolution of the volumetric sun shafts
 *                         (0 leaves a warmer haze toward the sun instead)
 * bloomScale, post        the RenderPipeline (off: the scene is drawn directly with ACES)
 */
const COLUMNS = ['groveTrees', 'farTrees', 'foliage', 'twigs', 'shadowMap', 'litter', 'grass', 'ferns', 'rocks',
    'leaves', 'motes', 'wisps', 'mist', 'godrays', 'godraysScale', 'bloomScale', 'post'];
const ROWS = {
    Extreme: [30, 190, 1, true, [4096, 2048], 9000, 3400, 130, 64, 4200, 520, 40, 5, 40, 0.5, 0.5, true],
    Ultra: [27, 160, 1, true, [4096, 2048], 7500, 2900, 110, 56, 3400, 420, 34, 5, 32, 0.5, 0.5, true],
    High: [24, 130, 0.86, true, [2048, 1024], 5600, 2300, 90, 48, 2600, 320, 28, 4, 26, 0.5, 0.45, true],
    Medium: [18, 90, 0.6, true, [2048, 1024], 3200, 1400, 56, 36, 1600, 200, 20, 3, 16, 0.35, 0.35, true],
    Low: [13, 60, 0.34, false, [1024, 512], 1300, 700, 30, 24, 900, 110, 12, 2, 0, 0, 0, false],
    Minimal: [9, 40, 0.24, false, [1024, 512], 600, 360, 16, 16, 500, 60, 8, 2, 0, 0, 0, false],
};

export const FALL_TIERS = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [
    name,
    Object.freeze(Object.fromEntries(COLUMNS.map((key, index) => [key, row[index]]))),
])));

export function fallTier(quality) {
    return FALL_TIERS[quality] || FALL_TIERS.High;
}
