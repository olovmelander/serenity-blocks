/**
 * Verdant Hills — one table for everything a quality tier scales.
 *
 * fieldTrees / farTrees   modelled oaks beyond the hand-placed ones / sprite trees on the
 *                         far hills
 * foliage                 share of each tree's sprays that are instanced (survivors grow to
 *                         keep crowns closed)
 * limbs                   draw the limb geometry of the bark meshes
 * shadowMap               size of the one static sun shadow map of the home hill
 * grassNear / grassFar    grass clumps close to the lens (curved blades) / out over the hill
 * flowers                 buttercups, daisies, clover and dandelion clocks near the lens
 * seeds                   the seed, petal and chaff pool the game throws into the wind
 * motes, birds, sheep     sunlit pollen, swallows, the flock on the far pasture
 * waves                   gusts the grass can carry at once
 * ribbons                 wind ribbons that can be in the air at once (never fewer than one
 *                         event can ask for: a four-line clear sends ten)
 * cloudSteps, cloudScale  raymarch steps and resolution of the cumulus (0 steps draws the
 *                         clouds as one flat layer in the sky itself)
 * shafts, shaftsScale     steps and resolution of the light that falls between the clouds
 *                         (0 leaves a warmer haze toward the sun instead)
 * bloomScale, post        the RenderPipeline (off: the scene is drawn directly with ACES)
 */
const COLUMNS = ['fieldTrees', 'farTrees', 'foliage', 'limbs', 'shadowMap', 'grassNear', 'grassFar', 'flowers',
    'seeds', 'motes', 'birds', 'sheep', 'waves', 'ribbons', 'cloudSteps', 'cloudScale', 'shafts', 'shaftsScale',
    'bloomScale', 'post'];
const ROWS = {
    Extreme: [40, 900, 1, true, [4096, 4096], 26000, 60000, 6000, 3600, 500, 22, 60, 6, 18, 72, 0.6, 28, 0.5,
        0.5, true],
    Ultra: [34, 760, 1, true, [4096, 4096], 22000, 50000, 5000, 3000, 420, 18, 50, 6, 16, 60, 0.5, 24, 0.5,
        0.5, true],
    High: [28, 620, 0.86, true, [2048, 2048], 18000, 40000, 4000, 2400, 340, 14, 40, 6, 14, 48, 0.5, 20, 0.5,
        0.45, true],
    Medium: [20, 440, 0.62, true, [2048, 2048], 11000, 25000, 2600, 1500, 220, 10, 28, 4, 12, 30, 0.4, 12, 0.35,
        0.35, true],
    Low: [12, 260, 0.4, false, [1024, 1024], 5600, 12000, 1300, 850, 120, 6, 16, 4, 12, 16, 0.33, 0, 0,
        0, false],
    Minimal: [8, 150, 0.28, false, [1024, 1024], 2900, 6000, 650, 450, 60, 0, 8, 4, 12, 0, 0, 0, 0,
        0, false],
};

export const VERDANT_HILLS_TIERS = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [
    name,
    Object.freeze(Object.fromEntries(COLUMNS.map((key, index) => [key, row[index]]))),
])));

export function verdantHillsTier(quality) {
    return VERDANT_HILLS_TIERS[quality] || VERDANT_HILLS_TIERS.High;
}
