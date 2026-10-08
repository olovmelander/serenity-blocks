/**
 * Forest — the plan of the place, as plain numbers.
 *
 * Where the eye stands, where the moon hangs, and the ride: a long opening in the old wood
 * that runs from the eye straight toward the moon and falls away into a misty valley. The
 * moon is low, so it can only light ground that looks down the ride at open sky; everything
 * else in the picture follows from that line. No three.js here, so the terrain, the light
 * rig, the layout and the tests can all share it.
 */
const DEG = Math.PI / 180;

export const FOREST_MOON_AZIMUTH_DEGREES = -24;
export const FOREST_MOON_ELEVATION_DEGREES = 19;
/** Angular radius of the moon's disc: far larger than life, as the forest has always had it. */
export const FOREST_MOON_RADIUS_DEGREES = 4.4;

/** Ground position of the eye; `FOREST_VIEWS` in forest-composition.js adds its height. */
export const FOREST_EYE = Object.freeze({ x: 0, z: 13 });

const AXIS_X = Math.sin(FOREST_MOON_AZIMUTH_DEGREES * DEG);
const AXIS_Z = -Math.cos(FOREST_MOON_AZIMUTH_DEGREES * DEG);
/** Unit ground vector from the eye toward the moon. */
export const FOREST_RIDE_AXIS = Object.freeze({ x: AXIS_X, z: AXIS_Z });

/** A ground point in ride terms: `s` metres along it from the eye, `d` metres to its right. */
export function forestRide(x, z) {
    const dx = x - FOREST_EYE.x;
    const dz = z - FOREST_EYE.z;
    return { s: dx * AXIS_X + dz * AXIS_Z, d: dx * -AXIS_Z + dz * AXIS_X };
}

/** The ground point `s` metres along the ride and `d` metres to its right. */
export function forestRidePoint(s, d = 0) {
    return {
        x: FOREST_EYE.x + s * AXIS_X + d * -AXIS_Z,
        z: FOREST_EYE.z + s * AXIS_Z + d * AXIS_X,
    };
}

/** Bearing of a ground point from the eye, in degrees (negative: left of straight ahead). */
export function forestBearing(x, z) {
    return Math.atan2(x - FOREST_EYE.x, FOREST_EYE.z - z) / DEG;
}

/** Half the width of the ride's open floor at a distance along it. */
export function forestRideHalfWidth(s) {
    return 7 + Math.max(0, s) * 0.045;
}
