/**
 * Lunara — content tiers. Every tier keeps the whole picture and every event.
 *
 * crystals     spires drawn (the plan lists them by importance; a tier takes the first N)
 * flowers      lantern flowers
 * motes        spores of light in the air
 * shards       crystal-dust pool
 * meteors      shooting-star pool
 * curtains     aurora curtains (two noise fetches each)
 * nebula       the band of lit dust across the sky (two fetches)
 * reflection   planar reflector resolution scale for the flats (0 = mirror the sky function)
 * dispersion   the moons' refracted image splits per colour channel inside the spires
 * relief       the moons' terminator shows relief (two more fetches of the moon map)
 * glitter      sparkle on the water under the great moon
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        crystals: 70,
        flowers: 0,
        motes: 0,
        shards: 96,
        meteors: 8,
        curtains: 1,
        nebula: false,
        reflection: 0,
        dispersion: false,
        relief: false,
        glitter: false,
    }),
    Low: Object.freeze({
        crystals: 110,
        flowers: 60,
        motes: 300,
        shards: 160,
        meteors: 12,
        curtains: 2,
        nebula: true,
        reflection: 0,
        dispersion: false,
        relief: true,
        glitter: true,
    }),
    Medium: Object.freeze({
        crystals: 170,
        flowers: 140,
        motes: 700,
        shards: 320,
        meteors: 16,
        curtains: 3,
        nebula: true,
        reflection: 0.4,
        dispersion: true,
        relief: true,
        glitter: true,
    }),
    High: Object.freeze({
        crystals: 240,
        flowers: 220,
        motes: 1200,
        shards: 512,
        meteors: 24,
        curtains: 3,
        nebula: true,
        reflection: 0.5,
        dispersion: true,
        relief: true,
        glitter: true,
    }),
    Ultra: Object.freeze({
        crystals: 330,
        flowers: 320,
        motes: 2000,
        shards: 768,
        meteors: 32,
        curtains: 3,
        nebula: true,
        reflection: 0.62,
        dispersion: true,
        relief: true,
        glitter: true,
    }),
    Extreme: Object.freeze({
        crystals: 420,
        flowers: 420,
        motes: 3000,
        shards: 1024,
        meteors: 40,
        curtains: 3,
        nebula: true,
        reflection: 0.75,
        dispersion: true,
        relief: true,
        glitter: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
