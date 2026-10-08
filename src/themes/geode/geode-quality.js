/**
 * Geode — content tiers. Every tier keeps the whole picture and every event.
 *
 * heroes        hero crystals drawn (the plan lists them by importance; a tier takes the first N,
 *               which is the same number from each of the eighteen clusters)
 * crownPerRing  crystals in each ring the chain grows
 * druzy         small points of the lining
 * motes         dust in the air
 * stars         points of the lining that flash a star
 * shards        crystal-dust pool
 * glitter       the lining's glints blend two grain sizes (false = one evaluation a pixel)
 * dispersion    the hero facets' spectral fire
 * fracture      the four-line clear's crack network on the wall
 * caustics      patches of spectral light wander over the lining (one noise fetch per point)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        heroes: 54,
        crownPerRing: 12,
        druzy: 1400,
        motes: 0,
        stars: 120,
        shards: 96,
        glitter: false,
        dispersion: false,
        fracture: true,
        caustics: false,
    }),
    Low: Object.freeze({
        heroes: 108,
        crownPerRing: 16,
        druzy: 3200,
        motes: 300,
        stars: 220,
        shards: 160,
        glitter: false,
        dispersion: false,
        fracture: true,
        caustics: true,
    }),
    Medium: Object.freeze({
        heroes: 180,
        crownPerRing: 22,
        druzy: 7000,
        motes: 700,
        stars: 340,
        shards: 320,
        glitter: true,
        dispersion: true,
        fracture: true,
        caustics: true,
    }),
    High: Object.freeze({
        heroes: 252,
        crownPerRing: 28,
        druzy: 11000,
        motes: 1200,
        stars: 520,
        shards: 512,
        glitter: true,
        dispersion: true,
        fracture: true,
        caustics: true,
    }),
    Ultra: Object.freeze({
        heroes: 324,
        crownPerRing: 34,
        druzy: 16000,
        motes: 1800,
        stars: 680,
        shards: 768,
        glitter: true,
        dispersion: true,
        fracture: true,
        caustics: true,
    }),
    Extreme: Object.freeze({
        heroes: 360,
        crownPerRing: 40,
        druzy: 22000,
        motes: 2600,
        stars: 840,
        shards: 1024,
        glitter: true,
        dispersion: true,
        fracture: true,
        caustics: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
