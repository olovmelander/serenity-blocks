/**
 * Fluid Dreams — content tiers. Every tier keeps the whole picture and every event.
 *
 * steps        march budget of a view ray through the liquid
 * bounceSteps  march budget of a reflected ray
 * bounces      rays followed per pixel: 1 = each surface mirrors the sky only; 2 = the Great Drop
 *              stands in the sea and the sea in the Drop; 3 = a drop also shows in a drop
 * stars / warp the sky's resolved stars; its ink folded through itself (two more fetches)
 * dispersion   a drop's lens splits red and blue
 * farDrops     the drops far out on the sea, to the sea line
 * lobes        lobes turning inside the Great Drop
 * satellites   the most satellites a chain of clears raises
 * crown        a four-line clear's crown stands up as liquid (else as spray only)
 * crownSpokes  points of that crown (three balls each)
 * mirrorExtras the sea also mirrors the Great Drop's satellites and crown, not only its body
 * motes        mist rising off the sea
 * spray        droplet pool
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        steps: 26,
        bounceSteps: 8,
        bounces: 1,
        stars: false,
        warp: false,
        dispersion: false,
        farDrops: false,
        lobes: 2,
        satellites: 3,
        crown: false,
        crownSpokes: 6,
        mirrorExtras: false,
        motes: 0,
        spray: 640,
    }),
    Low: Object.freeze({
        steps: 34,
        bounceSteps: 12,
        bounces: 2,
        stars: true,
        warp: false,
        dispersion: false,
        farDrops: true,
        lobes: 3,
        satellites: 4,
        crown: true,
        crownSpokes: 6,
        mirrorExtras: false,
        motes: 220,
        spray: 640,
    }),
    Medium: Object.freeze({
        steps: 44,
        bounceSteps: 18,
        bounces: 2,
        stars: true,
        warp: true,
        dispersion: false,
        farDrops: true,
        lobes: 3,
        satellites: 6,
        crown: true,
        crownSpokes: 7,
        mirrorExtras: false,
        motes: 520,
        spray: 768,
    }),
    High: Object.freeze({
        steps: 56,
        bounceSteps: 24,
        bounces: 2,
        stars: true,
        warp: true,
        dispersion: true,
        farDrops: true,
        lobes: 4,
        satellites: 8,
        crown: true,
        crownSpokes: 8,
        mirrorExtras: false,
        motes: 900,
        spray: 1024,
    }),
    Ultra: Object.freeze({
        steps: 72,
        bounceSteps: 30,
        bounces: 3,
        stars: true,
        warp: true,
        dispersion: true,
        farDrops: true,
        lobes: 4,
        satellites: 8,
        crown: true,
        crownSpokes: 10,
        mirrorExtras: true,
        motes: 1400,
        spray: 1280,
    }),
    Extreme: Object.freeze({
        steps: 88,
        bounceSteps: 38,
        bounces: 3,
        stars: true,
        warp: true,
        dispersion: true,
        farDrops: true,
        lobes: 4,
        satellites: 8,
        crown: true,
        crownSpokes: 10,
        mirrorExtras: true,
        motes: 2000,
        spray: 1536,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
