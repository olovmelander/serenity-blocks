/**
 * Bioluminescence — content tiers. Every tier keeps the whole picture and every event.
 *
 * mushrooms    planned mushrooms drawn (the plan lists them by importance; a tier takes the first N)
 * sprouts      fairy-ring sprouts a chain can raise
 * crystals     crystals drawn
 * spikes       stalactites, stalagmites and columns
 * worms        glow-worms in the vault; `threads` of them hang a beaded line
 * vines        hanging vines
 * motes        spores adrift in the air
 * jellies      air-jellies (three drift at rest; a chain raises the others)
 * spores       the pool of spores a bloom, a clear and the Great Bloom throw
 * pads         pads of light floating near the shores
 * lamps        lights the rock, the caps and the water evaluate per fragment
 * scatter      lamps that also light the mist (a halo each; 0 = no halos)
 * reflection   planar reflector resolution scale for the pool (0 = mirror the cave's glow)
 * sparkle      the plankton's individual sparks
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        mushrooms: 70,
        sprouts: 24,
        crystals: 20,
        spikes: 50,
        worms: 600,
        threads: 0,
        vines: 12,
        motes: 0,
        jellies: 6,
        spores: 160,
        pads: 0,
        lamps: 6,
        scatter: 0,
        reflection: 0,
        sparkle: false,
    }),
    Low: Object.freeze({
        mushrooms: 110,
        sprouts: 40,
        crystals: 28,
        spikes: 80,
        worms: 1200,
        threads: 60,
        vines: 20,
        motes: 250,
        jellies: 8,
        spores: 260,
        pads: 12,
        lamps: 8,
        scatter: 6,
        reflection: 0,
        sparkle: true,
    }),
    Medium: Object.freeze({
        mushrooms: 160,
        sprouts: 60,
        crystals: 36,
        spikes: 110,
        worms: 2200,
        threads: 120,
        vines: 28,
        motes: 600,
        jellies: 10,
        spores: 420,
        pads: 20,
        lamps: 12,
        scatter: 10,
        reflection: 0.4,
        sparkle: true,
    }),
    High: Object.freeze({
        mushrooms: 210,
        sprouts: 80,
        crystals: 40,
        spikes: 130,
        worms: 3400,
        threads: 180,
        vines: 36,
        motes: 1000,
        jellies: 12,
        spores: 640,
        pads: 26,
        lamps: 12,
        scatter: 12,
        reflection: 0.5,
        sparkle: true,
    }),
    Ultra: Object.freeze({
        mushrooms: 240,
        sprouts: 100,
        crystals: 46,
        spikes: 150,
        worms: 4400,
        threads: 240,
        vines: 40,
        motes: 1600,
        jellies: 14,
        spores: 900,
        pads: 30,
        lamps: 12,
        scatter: 12,
        reflection: 0.62,
        sparkle: true,
    }),
    Extreme: Object.freeze({
        mushrooms: 260,
        sprouts: 110,
        crystals: 46,
        spikes: 150,
        worms: 5200,
        threads: 300,
        vines: 44,
        motes: 2400,
        jellies: 14,
        spores: 1200,
        pads: 30,
        lamps: 12,
        scatter: 12,
        reflection: 0.75,
        sparkle: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
