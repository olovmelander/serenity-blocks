/**
 * Waves — content tiers. Every tier keeps the whole picture and every event.
 *
 * arcRows      mesh rows from the foot of the face over the roof to the lip
 * floorRows    mesh rows across the trough and the sea in front of the wave
 * nearStep     metres between mesh columns near the eye (they widen with distance)
 * noise        the water's noise field (pixels across)
 * lace         its field of foam cells (pixels across)
 * trace        1: reflections are traced inside the tube; 0: one environment lookup
 * caustics     the bars of light the moving roof lets through onto the face and the trough
 * clouds       octaves in the sky's cloud deck
 * rings        refracting rings alive at once       ribbons   colour comets alive at once
 * droplets     the lip's standing rain              spray     pool for throws and splashes
 * mist         sheets of spindrift and spray        dolphins  the largest pod a chain can call
 * foam         puffs of white water an animal tears up where it breaks the surface
 * whitewater   puffs of white water standing where the lip lands (roll, burst and mist)
 * life         how full the sea is: the share of each pod, school and flock that comes
 */
const tier = (values) => Object.freeze(values);

export const QUALITY = Object.freeze({
    Minimal: tier({
        arcRows: 56,
        floorRows: 14,
        nearStep: 0.42,
        noise: 128,
        lace: 128,
        trace: 0,
        caustics: false,
        clouds: 1,
        rings: 4,
        ribbons: 5,
        droplets: 420,
        spray: 420,
        mist: 10,
        foam: 24,
        whitewater: 16,
        dolphins: 3,
        life: 0.5,
    }),
    Low: tier({
        arcRows: 72,
        floorRows: 16,
        nearStep: 0.34,
        noise: 256,
        lace: 128,
        trace: 0,
        caustics: false,
        clouds: 2,
        rings: 5,
        ribbons: 6,
        droplets: 700,
        spray: 700,
        mist: 14,
        foam: 32,
        whitewater: 22,
        dolphins: 4,
        life: 0.65,
    }),
    Medium: tier({
        arcRows: 96,
        floorRows: 20,
        nearStep: 0.26,
        noise: 256,
        lace: 256,
        trace: 1,
        caustics: true,
        clouds: 2,
        rings: 6,
        ribbons: 8,
        droplets: 1300,
        spray: 1300,
        mist: 20,
        foam: 48,
        whitewater: 34,
        dolphins: 5,
        life: 0.85,
    }),
    High: tier({
        arcRows: 128,
        floorRows: 24,
        nearStep: 0.2,
        noise: 512,
        lace: 256,
        trace: 1,
        caustics: true,
        clouds: 3,
        rings: 8,
        ribbons: 10,
        droplets: 2200,
        spray: 2400,
        mist: 28,
        foam: 72,
        whitewater: 50,
        dolphins: 6,
        life: 1,
    }),
    Ultra: tier({
        arcRows: 160,
        floorRows: 28,
        nearStep: 0.16,
        noise: 512,
        lace: 256,
        trace: 1,
        caustics: true,
        clouds: 3,
        rings: 8,
        ribbons: 12,
        droplets: 3200,
        spray: 3000,
        mist: 34,
        foam: 84,
        whitewater: 60,
        dolphins: 7,
        life: 1,
    }),
    Extreme: tier({
        arcRows: 192,
        floorRows: 32,
        nearStep: 0.13,
        noise: 512,
        lace: 256,
        trace: 1,
        caustics: true,
        clouds: 3,
        rings: 8,
        ribbons: 12,
        droplets: 4200,
        spray: 3600,
        mist: 40,
        foam: 96,
        whitewater: 70,
        dolphins: 7,
        life: 1,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
