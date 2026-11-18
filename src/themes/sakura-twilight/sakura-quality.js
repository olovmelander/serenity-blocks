/**
 * Sakura Twilight — one table for everything a quality tier scales.
 *
 * groveTrees / farTrees   modelled cherries behind the two hero trees / sprite trees on the
 *                         far shore
 * foliage                 share of each tree's blossom sprays that are instanced (survivors
 *                         grow to keep crowns closed)
 * twigs                   draw the finest bark geometry
 * shadowMap               size of the one static moon shadow map
 * grass                   instanced tufts on the near bank
 * petals                  petals in the air (ambient plus the hidden event reserve)
 * blizzard                petals of the far blizzard a four-line clear and a petal wind stream
 *                         through the garden (stateless: no simulation)
 * cranes                  the most birds in a flight of cranes crossing the sky (a skein has five
 *                         to nine; a tier with fewer flies that many)
 * lamps                   lanterns that light the ground and bark in the shader
 * paperLanterns           paper lanterns hung in the trees
 * fireflies, foxfire      fireflies over the grass; spirit flames a combo can kindle
 * waterLanterns, skyLanterns   floats on the lake; lanterns a level-up releases
 * mist                    mist banks over the water
 * mirror                  resolution scale of the lake's planar reflection (0: the lake
 *                         mirrors the sky analytically)
 * godrays, godraysScale   raymarch steps and resolution of the volumetric moon shafts
 * bloomScale, post        the RenderPipeline (off: the scene is drawn directly with ACES)
 */
const COLUMNS = ['groveTrees', 'farTrees', 'foliage', 'twigs', 'shadowMap', 'grass', 'petals', 'lamps',
    'paperLanterns', 'fireflies', 'foxfire', 'waterLanterns', 'skyLanterns', 'mist', 'mirror', 'godrays',
    'godraysScale', 'bloomScale', 'post', 'blizzard'];
const ROWS = {
    Extreme: [20, 110, 1, true, [4096, 2048], 15000, 9000, 12, 46, 220, 14, 40, 60, 5, 0.5, 36, 0.5, 0.5, true, 2200],
    Ultra: [18, 100, 1, true, [4096, 2048], 12500, 7500, 12, 40, 180, 14, 34, 52, 5, 0.5, 30, 0.5, 0.5, true, 1800],
    High: [16, 90, 0.86, true, [2048, 1024], 10000, 6000, 10, 34, 140, 12, 28, 44, 4, 0.4, 24, 0.5, 0.45, true, 1400],
    Medium: [12, 70, 0.6, true, [2048, 1024], 6500, 3800, 8, 24, 90, 10, 20, 30, 3, 0.3, 14, 0.35, 0.35, true, 900],
    Low: [9, 50, 0.36, false, [1024, 512], 3200, 2000, 6, 16, 50, 8, 12, 18, 2, 0, 0, 0, 0, false, 500],
    Minimal: [6, 36, 0.26, false, [1024, 512], 1600, 1100, 4, 10, 28, 6, 8, 12, 2, 0, 0, 0, 0, false, 280],
};
// One more column, in a row of its own (the table's rows are as long as a line may be): `cranes`.
const CRANES = {
    Extreme: 9, Ultra: 9, High: 8, Medium: 7, Low: 5, Minimal: 4,
};

export const SAKURA_TIERS = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [
    name,
    Object.freeze({ ...Object.fromEntries(COLUMNS.map((key, index) => [key, row[index]])), cranes: CRANES[name] }),
])));

export function sakuraTier(quality) {
    return SAKURA_TIERS[quality] || SAKURA_TIERS.High;
}
