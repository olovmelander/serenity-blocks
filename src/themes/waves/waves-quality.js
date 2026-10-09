/**
 * Waves — content tiers. Every tier keeps the whole picture and every event.
 *
 * arcRows      mesh rows from the foot of the face over the roof to the lip
 * floorRows    mesh rows across the trough and the sea in front of the wave
 * nearStep     metres between mesh columns near the eye (they widen with distance)
 * noise        the water's noise field (pixels across)
 * trace        1: reflections are traced inside the tube; 0: one environment lookup
 * caustics     the bars of light the moving roof lets through onto the face and the trough
 * clouds       octaves in the sky's cloud deck
 * rings        refracting rings alive at once       ribbons   colour comets alive at once
 * droplets     the lip's standing rain              spray     pool for throws and splashes
 * mist         sheets of spindrift and spray        dolphins  the largest pod a chain can call
 */
const tier = (values) => Object.freeze(values);

export const QUALITY = Object.freeze({
    Minimal: tier({
        arcRows: 56,
        floorRows: 14,
        nearStep: 0.42,
        noise: 128,
        trace: 0,
        caustics: false,
        clouds: 1,
        rings: 4,
        ribbons: 5,
        droplets: 420,
        spray: 420,
        mist: 10,
        dolphins: 3,
    }),
    Low: tier({
        arcRows: 72,
        floorRows: 16,
        nearStep: 0.34,
        noise: 256,
        trace: 0,
        caustics: false,
        clouds: 2,
        rings: 5,
        ribbons: 6,
        droplets: 700,
        spray: 700,
        mist: 14,
        dolphins: 4,
    }),
    Medium: tier({
        arcRows: 96,
        floorRows: 20,
        nearStep: 0.26,
        noise: 256,
        trace: 1,
        caustics: true,
        clouds: 2,
        rings: 6,
        ribbons: 8,
        droplets: 1300,
        spray: 1300,
        mist: 20,
        dolphins: 5,
    }),
    High: tier({
        arcRows: 128,
        floorRows: 24,
        nearStep: 0.2,
        noise: 512,
        trace: 1,
        caustics: true,
        clouds: 3,
        rings: 8,
        ribbons: 10,
        droplets: 2200,
        spray: 2400,
        mist: 28,
        dolphins: 6,
    }),
    Ultra: tier({
        arcRows: 160,
        floorRows: 28,
        nearStep: 0.16,
        noise: 512,
        trace: 1,
        caustics: true,
        clouds: 3,
        rings: 8,
        ribbons: 12,
        droplets: 3200,
        spray: 3000,
        mist: 34,
        dolphins: 7,
    }),
    Extreme: tier({
        arcRows: 192,
        floorRows: 32,
        nearStep: 0.13,
        noise: 512,
        trace: 1,
        caustics: true,
        clouds: 3,
        rings: 8,
        ribbons: 12,
        droplets: 4200,
        spray: 3600,
        mist: 40,
        dolphins: 7,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
