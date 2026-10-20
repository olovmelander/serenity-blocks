/**
 * Aether Tides — content tiers. Every tier keeps the whole picture and every event.
 *
 * cells       velocity cells of the fluid's grid (about; the grid is cut to the screen's shape)
 * dyeHeight   rows of the dye (the gas and the dust); its width follows the screen
 * sweeps      pressure passes per step (two Jacobi sweeps each)
 * lightSteps  samples each pixel of the light buffer takes toward a star (0 = no shadows)
 * nearSteps   dye reads the picture takes along the last stretch toward each great star, so a
 *             cloud's face is lit at the dye's own resolution (0 = no crisp fronts)
 * farSky      the far galaxy band's own stars and the faraway galaxies (the band's glow is always
 *             drawn)
 * starLayers  depths of background stars
 * underglow   a soft second reading of the gas under the sharp one (four more dye reads)
 * sparkles    motes of stardust the events throw
 * spikes      diffraction spikes on the stars the board lights
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        cells: 9000,
        dyeHeight: 216,
        sweeps: 4,
        lightSteps: 0,
        nearSteps: 0,
        farSky: false,
        starLayers: 2,
        underglow: false,
        sparkles: 96,
        spikes: false,
    }),
    Low: Object.freeze({
        cells: 16000,
        dyeHeight: 324,
        sweeps: 5,
        lightSteps: 10,
        nearSteps: 2,
        farSky: false,
        starLayers: 2,
        underglow: false,
        sparkles: 192,
        spikes: true,
    }),
    Medium: Object.freeze({
        cells: 26000,
        dyeHeight: 432,
        sweeps: 6,
        lightSteps: 14,
        nearSteps: 3,
        farSky: true,
        starLayers: 3,
        underglow: true,
        sparkles: 384,
        spikes: true,
    }),
    High: Object.freeze({
        cells: 40000,
        dyeHeight: 576,
        sweeps: 8,
        lightSteps: 18,
        nearSteps: 4,
        farSky: true,
        starLayers: 3,
        underglow: true,
        sparkles: 640,
        spikes: true,
    }),
    Ultra: Object.freeze({
        cells: 56000,
        dyeHeight: 720,
        sweeps: 9,
        lightSteps: 22,
        nearSteps: 5,
        farSky: true,
        starLayers: 3,
        underglow: true,
        sparkles: 900,
        spikes: true,
    }),
    Extreme: Object.freeze({
        cells: 76000,
        dyeHeight: 900,
        sweeps: 10,
        lightSteps: 26,
        nearSteps: 6,
        farSky: true,
        starLayers: 3,
        underglow: true,
        sparkles: 1200,
        spikes: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
