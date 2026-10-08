/**
 * Summer — one table for everything a quality tier scales.
 *
 * groveTrees / farTrees   modelled birches and spruces beyond the hand-placed ones / sprite
 *                         trees on the far shores
 * foliage                 share of each tree's sprays that are instanced (survivors grow to
 *                         keep crowns closed)
 * limbs                   draw the limb geometry of the bark meshes
 * shadowMap               size of the one static sun shadow map
 * grassNear / grassFar    grass clumps close to the lens (curved blades) / out to the shore
 * flowersNear / flowersFar  modelled wildflowers on the crest / simplified ones beyond it
 * reeds, rocks, lilies    instanced shore detail
 * petals                  the petal, seed and pollen pool the game throws into the air
 * motes, butterflies, birds, mist   sunlit pollen, butterflies, swallows, haze banks
 * ripples / waves         rings the lake can carry / gusts the meadow can carry at once
 * reflection              resolution scale of the lake's planar mirror
 * godrays, godraysScale   raymarch steps and resolution of the volumetric sun shafts
 *                         (0 leaves a warmer haze toward the sun instead)
 * ribbons                 streamers a long combo unfurls around the board
 * bloomScale, post        the RenderPipeline (off: the scene is drawn directly with ACES)
 */
const COLUMNS = ['groveTrees', 'farTrees', 'foliage', 'limbs', 'shadowMap', 'grassNear', 'grassFar', 'flowersNear',
    'flowersFar', 'reeds', 'rocks', 'lilies', 'petals', 'motes', 'butterflies', 'birds', 'mist', 'ripples', 'waves',
    'reflection', 'godrays', 'godraysScale', 'ribbons', 'bloomScale', 'post'];
const ROWS = {
    Extreme: [44, 460, 1, true, [4096, 2048], 15000, 34000, 5200, 30000, 2200, 46, 150, 3600, 620, 64, 26, 5, 10,
        6, 0.75, 40, 0.5, 6, 0.5, true],
    Ultra: [38, 400, 1, true, [4096, 2048], 12500, 28000, 4400, 25000, 1900, 40, 130, 3000, 520, 52, 22, 5, 10,
        6, 0.6, 32, 0.5, 6, 0.5, true],
    High: [32, 340, 0.86, true, [2048, 1024], 10000, 22000, 3600, 20000, 1500, 34, 110, 2400, 400, 40, 18, 4, 8,
        6, 0.5, 26, 0.5, 5, 0.45, true],
    Medium: [24, 250, 0.62, true, [2048, 1024], 6500, 14000, 2400, 13000, 950, 26, 80, 1500, 250, 26, 12, 3, 6,
        4, 0.4, 16, 0.35, 4, 0.35, true],
    Low: [16, 160, 0.4, false, [1024, 512], 3400, 7000, 1300, 6500, 480, 18, 50, 850, 130, 14, 8, 2, 4,
        4, 0.3, 0, 0, 3, 0, false],
    Minimal: [10, 100, 0.28, false, [1024, 512], 1800, 3600, 700, 3200, 240, 12, 28, 450, 70, 8, 0, 2, 4,
        4, 0.22, 0, 0, 2, 0, false],
};

export const SUMMER_TIERS = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [
    name,
    Object.freeze(Object.fromEntries(COLUMNS.map((key, index) => [key, row[index]]))),
])));

export function summerTier(quality) {
    return SUMMER_TIERS[quality] || SUMMER_TIERS.High;
}
