/**
 * Voltage Storm — content tiers. Every tier keeps the whole picture and every event.
 *
 * skyScale     the sky target's size as a fraction of the drawing buffer (the cloud is soft:
 *              it is marched at reduced resolution and the water mirrors the same image)
 * march        steps through the cloud's underside per sky pixel
 * detail       a second noise read per step (the fine erosion of the lobes) and a tap toward
 *              the horizon's light (the lobes' lit and shaded sides)
 * flashSteps   true: each march step is lit by every live stroke; false: once per pixel
 * towers       collectors drawn (the plan lists them nearest first)
 * mirror       the towers' and the bolts' mirror images in the water
 * rain         streaks in the air round the camera
 * sparks       spark pool
 * boltDetail   0..2: how finely a bolt is drawn (segments, branches, twigs)
 * noise3d      edge of the cloud's baked 3D noise (voxels)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        skyScale: 0.3,
        march: 5,
        detail: false,
        flashSteps: false,
        towers: 6,
        mirror: false,
        rain: 900,
        sparks: 96,
        boltDetail: 0,
        noise3d: 32,
    }),
    Low: Object.freeze({
        skyScale: 0.36,
        march: 7,
        detail: false,
        flashSteps: false,
        towers: 8,
        mirror: true,
        rain: 1800,
        sparks: 160,
        boltDetail: 0,
        noise3d: 32,
    }),
    Medium: Object.freeze({
        skyScale: 0.42,
        march: 10,
        detail: true,
        flashSteps: false,
        towers: 10,
        mirror: true,
        rain: 3600,
        sparks: 288,
        boltDetail: 1,
        noise3d: 48,
    }),
    High: Object.freeze({
        skyScale: 0.6,
        march: 14,
        detail: true,
        flashSteps: true,
        towers: 10,
        mirror: true,
        rain: 6000,
        sparks: 448,
        boltDetail: 2,
        noise3d: 48,
    }),
    Ultra: Object.freeze({
        skyScale: 0.7,
        march: 18,
        detail: true,
        flashSteps: true,
        towers: 10,
        mirror: true,
        rain: 9000,
        sparks: 640,
        boltDetail: 2,
        noise3d: 64,
    }),
    Extreme: Object.freeze({
        skyScale: 0.85,
        march: 24,
        detail: true,
        flashSteps: true,
        towers: 10,
        mirror: true,
        rain: 13000,
        sparks: 900,
        boltDetail: 2,
        noise3d: 64,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
