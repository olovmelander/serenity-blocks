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
    'godraysScale', 'bloomScale', 'post'];
const ROWS = {
    Extreme: [20, 110, 1, true, [4096, 2048], 15000, 9000, 12, 46, 220, 14, 40, 60, 5, 0.5, 36, 0.5, 0.5, true],
    Ultra: [18, 100, 1, true, [4096, 2048], 12500, 7500, 12, 40, 180, 14, 34, 52, 5, 0.5, 30, 0.5, 0.5, true],
    High: [16, 90, 0.86, true, [2048, 1024], 10000, 6000, 10, 34, 140, 12, 28, 44, 4, 0.4, 24, 0.5, 0.45, true],
    Medium: [12, 70, 0.6, true, [2048, 1024], 6500, 3800, 8, 24, 90, 10, 20, 30, 3, 0.3, 14, 0.35, 0.35, true],
    Low: [9, 50, 0.36, false, [1024, 512], 3200, 2000, 6, 16, 50, 8, 12, 18, 2, 0, 0, 0, 0, false],
    Minimal: [6, 36, 0.26, false, [1024, 512], 1600, 1100, 4, 10, 28, 6, 8, 12, 2, 0, 0, 0, 0, false],
};

export const SAKURA_TIERS = Object.freeze(Object.fromEntries(Object.entries(ROWS).map(([name, row]) => [
    name,
    Object.freeze(Object.fromEntries(COLUMNS.map((key, index) => [key, row[index]]))),
])));

export function sakuraTier(quality) {
    return SAKURA_TIERS[quality] || SAKURA_TIERS.High;
}
