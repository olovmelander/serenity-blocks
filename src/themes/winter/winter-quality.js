/**
 * Winter — content tiers. Every tier keeps the whole picture and every event.
 *
 * ground      [rings, columns] of the fan of snow, ice and fells the eye looks over
 * curtains    sheets of aurora the sky draws (each is three noise fetches and a few sines)
 * mirror      the lake's ice mirrors the aurora (one more, coarser, sky lookup)
 * ghostLod    the finest mesh the framing trees may use (0 = the full ghost)
 * mid / far   trees on the spits / in the wood on the far shore
 * shadows     side of the baked map of the trees' moon shadows (0 = none)
 * snow        falling flakes
 * dust        diamond dust in the air round the viewer
 * sparks      the fox fires' pool: sparks and powder share it
 * prints      paw prints the snow keeps
 * glints      the snow's sparkle
 * fur         shells of fur the fox's coat is drawn in over its skin (0 = a painted coat); the
 *             polar bear, seen from further off, wears half as many
 * veils       veils of light the fox of light wears
 * spirit      the fox of light a four-line clear sends across the sky
 * galaxy      the band of the galaxy over the left of the sky (one more noise read and a hash)
 * lumps       the high cloud's second, lumpier read
 * mist        banks of mist over the lake (the far ones are kept first)
 * devil       sprites in the snow devil a twist raises
 */
const tier = (ground, curtains, mirror, ghostLod, mid, far, shadows, snow, dust, sparks, prints, glints, fur, veils, sky) => Object.freeze({
    ground, curtains, mirror, ghostLod, mid, far, shadows, snow, dust, sparks, prints, glints, fur, veils, spirit: true, ...sky,
});
const sky = (galaxy, lumps, mist, devil) => ({
    galaxy, lumps, mist, devil,
});

export const QUALITY = Object.freeze({
    Minimal: tier([120, 96], 2, false, 1, 26, 160, 256, 700, 0, 260, 48, false, 0, 0, sky(false, false, 2, 90)),
    Low: tier([150, 128], 2, false, 1, 40, 280, 512, 1300, 160, 420, 72, true, 6, 0, sky(true, false, 3, 130)),
    Medium: tier([190, 160], 3, true, 0, 56, 460, 768, 2200, 320, 700, 96, true, 10, 3, sky(true, true, 4, 180)),
    High: tier([230, 200], 3, true, 0, 70, 700, 1024, 3400, 520, 1000, 128, true, 14, 5, sky(true, true, 4, 240)),
    Ultra: tier([270, 240], 4, true, 0, 84, 900, 1024, 4800, 800, 1400, 160, true, 18, 6, sky(true, true, 4, 300)),
    Extreme: tier([320, 280], 4, true, 0, 96, 1200, 1536, 6400, 1200, 1900, 192, true, 24, 8, sky(true, true, 4, 380)),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
