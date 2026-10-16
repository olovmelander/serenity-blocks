/**
 * Sakura Twilight — the shape of the land (CPU only, three-free).
 *
 * The banks, the cove, the islet and the far shore as analytic functions, and the surface a petal
 * lands on. The terrain (sakura-terrain.js) builds its mesh and bed from them; the petals'
 * simulation reads the surface from them, on the page or in its worker (sakura-petal-sim.worker.js).
 */

export const SAKURA_WATER_LEVEL = 0;
/** The ground mesh and the lake-bed map cover this rectangle. */
export const SAKURA_TERRAIN_BOUNDS = Object.freeze({
    minX: -150, maxX: 150, minZ: -210, maxZ: 40,
});
/** Hermite smoothstep (the land's own; three-free). */
export const sakuraSmooth = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/** z of the near shoreline: a cove straight ahead, a lobe of bank on either side. */
export function sakuraShore(x) {
    const side = Math.abs(x);
    return 4.5 - 8 * sakuraSmooth(3.5, 10.5, side) + 5 * sakuraSmooth(17, 30, side)
        + 0.7 * Math.sin(x * 0.37 + 1.1) + 0.45 * Math.sin(x * 0.83 + 0.2);
}

/** Metres inland (positive) or offshore (negative) of the nearest shoreline. */
export function sakuraLand(x, z) {
    const wobble = 0.9 * Math.sin(x * 0.31 + z * 0.17) + 0.6 * Math.sin(x * 0.13 - z * 0.41 + 2);
    const nearBank = z - sakuraShore(x);
    const leftPoint = (1 - Math.hypot((x + 42) / 26, (z + 28) / 37)) * 24 + wobble;
    const rightPoint = (1 - Math.hypot((x - 51) / 25, (z + 32) / 37)) * 24 + wobble;
    // A channel of open water lies between the islet and the right point: the bridge's.
    const islet = (1 - Math.hypot(x - 15.5, z + 27) / 5) * 5 + wobble * 0.3;
    const farShore = -152 - z + 8 * Math.sin(x * 0.013 + 1) + 4 * Math.sin(x * 0.041);
    return Math.max(nearBank, leftPoint, rightPoint, islet, farShore);
}

export function sakuraTerrainHeight(x, z) {
    const land = sakuraLand(x, z);
    if (land <= 0) return Math.max(-3.2, land * 0.32);
    const rise = 1 - Math.exp(-land * 0.5);
    const knoll = 1.9 * Math.exp(-((x / 24) ** 2) - (((z - 18) / 9.5) ** 2));
    const roll = 0.28 * Math.sin(x * 0.09 + 0.3) * Math.sin(z * 0.07 + 1.1);
    return 1.25 * rise + knoll * sakuraSmooth(0, 5, land) + roll * rise;
}

/**
 * A height (metres) no surface reaches: the bank rises under 1.25 m, the knoll adds at most 1.9 m
 * and the roll at most 0.28 m (the highest ground is about 3.23 m, on the knoll). The petals are
 * not tested against the ground while they fall above it.
 */
export const SAKURA_SURFACE_CEILING = 3.45;

/** The surface a petal lands on: the ground, or the lake where the ground is under it. */
export function sakuraSurfaceHeight(x, z) {
    return Math.max(SAKURA_WATER_LEVEL, sakuraTerrainHeight(x, z));
}

/** How far the stepping-stone path keeps back from the water. */
export const SAKURA_PATH_SETBACK = 2.4;

/** z of the stepping-stone path: it follows the near shore round the cove and both lobes. */
export function sakuraPathZ(x) {
    return sakuraShore(x) + SAKURA_PATH_SETBACK;
}

export function sakuraPathDistance(x, z) {
    return Math.abs(z - sakuraPathZ(x));
}
