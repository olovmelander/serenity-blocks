/**
 * Koi Pond — content tiers. Every tier keeps the whole picture and every event.
 *
 * sim          the wave simulation's grid (square cells over the pond's 22 x 13.2 m)
 * derive       the surface texture the picture samples (slopes, curvature, foam)
 * koi          fish in the pond
 * shadows      the moon's shadow map (0 = none: nothing throws a shadow on the bed)
 * pebbles      the bed's baked pebble texture (pixels across; the tile grows with it)
 * prism        caustics split by colour (two more fetches of the surface per fragment)
 * refraction   the bed and the fish bend through the surface (a copy of the frame)
 * pads         lily pads           lotus     flowers
 * leaves       maple leaves on the boughs      floaters   leaves and petals adrift
 * fireflies    over the water      droplets  spray pool for leaps and hard drops
 * mist         sheets of mist over the far water
 * dragon       body segments of the dragon a long chain wakes (0 = it stays asleep)
 */
const tier = (values) => Object.freeze(values);

export const QUALITY = Object.freeze({
    Minimal: tier({
        sim: [320, 192],
        derive: [320, 192],
        koi: 10,
        shadows: 0,
        pebbles: 512,
        prism: false,
        refraction: false,
        pads: 16,
        lotus: 4,
        leaves: 1400,
        floaters: 40,
        fireflies: 16,
        droplets: 160,
        mist: 0,
        dragon: 28,
    }),
    Low: tier({
        sim: [400, 240],
        derive: [400, 240],
        koi: 13,
        shadows: 0,
        pebbles: 512,
        prism: false,
        refraction: true,
        pads: 22,
        lotus: 5,
        leaves: 2400,
        floaters: 70,
        fireflies: 28,
        droplets: 260,
        mist: 2,
        dragon: 36,
    }),
    Medium: tier({
        sim: [480, 288],
        derive: [720, 432],
        koi: 17,
        shadows: 1024,
        pebbles: 1024,
        prism: false,
        refraction: true,
        pads: 30,
        lotus: 6,
        leaves: 4200,
        floaters: 110,
        fireflies: 44,
        droplets: 420,
        mist: 3,
        dragon: 48,
    }),
    High: tier({
        sim: [640, 384],
        derive: [1024, 614],
        koi: 22,
        shadows: 2048,
        pebbles: 1024,
        prism: true,
        refraction: true,
        pads: 38,
        lotus: 7,
        leaves: 6400,
        floaters: 160,
        fireflies: 46,
        droplets: 640,
        mist: 4,
        dragon: 64,
    }),
    Ultra: tier({
        sim: [640, 384],
        derive: [1280, 768],
        koi: 26,
        shadows: 2048,
        pebbles: 1024,
        prism: true,
        refraction: true,
        pads: 44,
        lotus: 8,
        leaves: 8000,
        floaters: 200,
        fireflies: 80,
        droplets: 800,
        mist: 5,
        dragon: 72,
    }),
    Extreme: tier({
        sim: [640, 384],
        derive: [1280, 768],
        koi: 30,
        shadows: 4096,
        pebbles: 1024,
        prism: true,
        refraction: true,
        pads: 50,
        lotus: 9,
        leaves: 9600,
        floaters: 240,
        fireflies: 96,
        droplets: 960,
        mist: 6,
        dragon: 80,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
