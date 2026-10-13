/**
 * Luminous Tides — content tiers. Every tier keeps the whole picture and every event: tiers cut
 * counts and detail terms, never a feature or a beat.
 *
 * skyNoise      the sky's noise field (pixels across)        seaNoise   the water's and the sand's
 * slices        slices the cloud deck is drawn in (its relief)
 * mirror        slices of the deck the water mirrors (0: the water mirrors the air, the coast and the stars)
 * fine          the cloud's torn edges                       milky      the Milky Way
 * rings         rings of the shore's fan mesh                spokes     its spokes
 * ripples       ripple layers read from the noise (1..3)
 * sparkle       sizes of spark in the foam (1..3: coarse, medium, fine)
 * backwash      the previous wave's swash is drawn too (no edge pops off when the next one arrives)
 * splashes      drops that can be lighting the water at once  breakers  clear-waves alive at once
 * drops         the splash-droplet pool                      fish       the shoal a T-spin sends
 * streaks       rain streaks near the eye                    palms      palms on the tree line (density)
 * spray         droplets of spray off breaking lips alive at once
 */
const tier = (values) => Object.freeze(values);

export const QUALITY = Object.freeze({
    Minimal: tier({
        skyNoise: 256,
        seaNoise: 256,
        slices: 2,
        mirror: 0,
        fine: false,
        milky: false,
        rings: 120,
        spokes: 96,
        ripples: 1,
        sparkle: 1,
        backwash: false,
        splashes: 6,
        breakers: 4,
        drops: 160,
        fish: 8,
        streaks: 220,
        spray: 90,
        palms: 0.55,
    }),
    Low: tier({
        skyNoise: 256,
        seaNoise: 256,
        slices: 2,
        mirror: 0,
        fine: false,
        milky: true,
        rings: 150,
        spokes: 120,
        ripples: 2,
        sparkle: 2,
        backwash: true,
        splashes: 8,
        breakers: 5,
        drops: 260,
        fish: 10,
        streaks: 360,
        spray: 140,
        palms: 0.7,
    }),
    Medium: tier({
        skyNoise: 512,
        seaNoise: 512,
        slices: 3,
        mirror: 1,
        fine: true,
        milky: true,
        rings: 190,
        spokes: 150,
        ripples: 3,
        sparkle: 2,
        backwash: true,
        splashes: 10,
        breakers: 6,
        drops: 420,
        fish: 14,
        streaks: 560,
        spray: 200,
        palms: 0.85,
    }),
    High: tier({
        skyNoise: 512,
        seaNoise: 512,
        slices: 4,
        mirror: 1,
        fine: true,
        milky: true,
        rings: 240,
        spokes: 190,
        ripples: 3,
        sparkle: 3,
        backwash: true,
        splashes: 12,
        breakers: 6,
        drops: 640,
        fish: 18,
        streaks: 800,
        spray: 280,
        palms: 1,
    }),
    Ultra: tier({
        skyNoise: 512,
        seaNoise: 512,
        slices: 5,
        mirror: 2,
        fine: true,
        milky: true,
        rings: 280,
        spokes: 220,
        ripples: 3,
        sparkle: 3,
        backwash: true,
        splashes: 14,
        breakers: 6,
        drops: 820,
        fish: 22,
        streaks: 1000,
        spray: 340,
        palms: 1,
    }),
    Extreme: tier({
        skyNoise: 512,
        seaNoise: 512,
        slices: 6,
        mirror: 2,
        fine: true,
        milky: true,
        rings: 320,
        spokes: 250,
        ripples: 3,
        sparkle: 3,
        backwash: true,
        splashes: 16,
        breakers: 6,
        drops: 1000,
        fish: 26,
        streaks: 1200,
        spray: 400,
        palms: 1,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return Object.prototype.hasOwnProperty.call(QUALITY, quality) ? QUALITY[quality] : QUALITY.High;
}
