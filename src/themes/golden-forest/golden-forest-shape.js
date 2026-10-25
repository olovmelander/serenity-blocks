/**
 * Golden Forest — the shape of the land (CPU only, three-free).
 *
 * The land is one analytic height function (golden-forest-terrain.js describes it), drawn as a grid
 * that coarsens with distance (goldenForestSurfaceHeight reads that drawn ground), and the lake
 * map is that function baked into bytes: R the ground's height (biased), G metres from the shore
 * out on the water / 40. The map is a pure function of the module (0.12 s of main thread on a first
 * visit, play-feel probe 2026-10-16), kept in the shared bake cache (read-only); a first visit
 * bakes it in a module Worker (golden-forest-bake.worker.js, started by golden-forest-bakes.js).
 */
import { bakeOnce } from '../shared/bake-cache.js';

export const GOLDEN_FOREST_BOUNDS = Object.freeze({
    minX: -340, maxX: 340, minZ: -420, maxZ: 44,
});
/** Heights are stored in the lake map as (height + bias) / range. */
export const GOLDEN_FOREST_MAP_BIAS = 4;
export const GOLDEN_FOREST_MAP_RANGE = 8;

/** three's MathUtils.clamp and .smoothstep (r186), operation for operation (this module is three-free). */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function ramp(x, min, max) {
    if (x <= min) return 0;
    if (x >= max) return 1;
    const t = (x - min) / (max - min);
    return t * t * (3 - 2 * t);
}

/** Metres inland of a tapered capsule's edge (negative offshore). */
function capsule(x, z, ax, az, bx, bz, ra, rb) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    return ra + (rb - ra) * t - Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** z of the near bank's waterline: two small points carry the framing trees. */
function nearWaterline(x) {
    return 8 + 1.6 * Math.sin(x * 0.13 + 0.7) + 0.7 * Math.sin(x * 0.31 + 2)
        - 7.2 * Math.exp(-(((x + 13) / 7) ** 2)) - 9.4 * Math.exp(-(((x - 12.5) / 6) ** 2));
}

/** Signed metres inland for each piece of land (negative: out on the water). */
export function goldenForestShores(x, z) {
    const wobble = 2.4 * Math.sin(x * 0.09 + z * 0.05) + 1.1 * Math.sin(x * 0.23 - z * 0.17);
    return {
        near: z - nearWaterline(x),
        headland: capsule(x, z, -190, -128, -26, -98, 32, 9) + wobble,
        promontory: capsule(x, z, 100, -46, 26, -61, 21, 7) + wobble * 0.8,
        right: (x - (25 + 0.17 * -z + 5 * Math.sin(z * 0.045 + 1))) * 0.9,
        far: -(z + 216 - 14 * Math.sin(x * 0.011 + 1) - 6 * Math.sin(x * 0.037)),
        island: capsule(x, z, 47, -138, 59, -143, 9, 7) + wobble * 0.4,
        islet: capsule(x, z, -19.5, -45.6, -14.4, -44, 2.7, 2),
        spit: capsule(x, z, 30, -4, 19.5, -10.5, 7.5, 5),
    };
}

/** Metres inland of the nearest shore (negative: out on the water). */
export function goldenForestShoreDistance(x, z) {
    return inlandOf(goldenForestShores(x, z));
}

/** Metres inland of the nearest of the shores read at a point. */
function inlandOf(s) {
    return Math.max(s.near, s.headland, s.promontory, s.right, s.far, s.island, s.islet, s.spit);
}

/** Height of the ground; the lake bed where it is below zero. */
export function goldenForestGroundHeight(x, z) {
    const s = goldenForestShores(x, z);
    return groundFromShores(x, z, s, inlandOf(s));
}

/** The ground's height from the shores at a point and how far inland it lies. */
function groundFromShores(x, z, s, inland) {
    if (inland < 0) return -3.6 * (1 - Math.exp(inland * 0.13));
    const relief = (Math.sin(x * 0.21 + z * 0.13) * 0.12 + Math.sin(x * 0.53 - z * 0.37) * 0.06)
        * ramp(inland, 0.5, 5);
    // A low lip at the water's edge, then the bank rising gently behind it.
    return 0.26 * (1 - Math.exp(-inland * 1.5)) + 0.07 * inland + 0.7 * ramp(inland, 1.5, 9) + relief
        + 34 * ramp(s.far, 20, 170) * (0.72 + 0.28 * Math.sin(x * 0.008 + 2))
        + 10 * ramp(s.right, 6, 70)
        + 4.5 * ramp(s.headland, 3, 16)
        + 3.4 * ramp(s.promontory, 2, 10)
        + 2 * ramp(s.island, 1, 6)
        + 0.45 * ramp(s.islet, 0.2, 1.6)
        + 0.9 * ramp(s.spit, 1, 4.5);
}

/** Grid lines that are close together around the camera and widen with distance. */
function gridLines(min, max, denseMin, denseMax, denseStep, growth) {
    const lines = [];
    for (let value = denseMin; value <= denseMax + 1e-6; value += denseStep) lines.push(value);
    let step = denseStep;
    for (let value = denseMax; value < max;) {
        step *= growth;
        value = Math.min(max, value + step);
        lines.push(value);
    }
    step = denseStep;
    for (let value = denseMin; value > min;) {
        step *= growth;
        value = Math.max(min, value - step);
        lines.unshift(value);
    }
    return lines;
}

/**
 * The lines of the ground mesh's grid (golden-forest-terrain.js draws it): 0.45 m apart around the
 * camera, each further one a tenth wider, so across the lake a cell is metres deep.
 */
export const GOLDEN_FOREST_GROUND_GRID = Object.freeze({
    xs: Object.freeze(gridLines(GOLDEN_FOREST_BOUNDS.minX, GOLDEN_FOREST_BOUNDS.maxX, -34, 34, 0.45, 1.1)),
    zs: Object.freeze(gridLines(GOLDEN_FOREST_BOUNDS.minZ, GOLDEN_FOREST_BOUNDS.maxZ, -8, 22, 0.45, 1.1)),
});

let gridHeights = null;

/** The ground's height at every vertex of the grid, row by row along z (the mesh's own floats). */
export function goldenForestGridHeights() {
    if (!gridHeights) {
        const { xs, zs } = GOLDEN_FOREST_GROUND_GRID;
        gridHeights = new Float32Array(xs.length * zs.length);
        for (let row = 0; row < zs.length; row += 1) {
            for (let column = 0; column < xs.length; column += 1) {
                gridHeights[row * xs.length + column] = goldenForestGroundHeight(xs[column], zs[row]);
            }
        }
    }
    return gridHeights;
}

/** The cell [lines[i], lines[i + 1]] that holds a value, clamped to the grid. */
function cellOf(lines, value) {
    let low = 0;
    let high = lines.length - 2;
    while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (lines[middle] <= value) low = middle;
        else high = middle - 1;
    }
    return low;
}

/**
 * Height of the ground as it is drawn: the grid's flat triangles. They cut under every crest of the
 * analytic land, by more than a metre where a cell metres deep spans a steep bank across the lake,
 * so whatever stands on the ground is planted on this rather than on goldenForestGroundHeight.
 */
export function goldenForestSurfaceHeight(x, z) {
    const { xs, zs } = GOLDEN_FOREST_GROUND_GRID;
    const heights = goldenForestGridHeights();
    const column = cellOf(xs, x);
    const row = cellOf(zs, z);
    const u = clamp((x - xs[column]) / (xs[column + 1] - xs[column]), 0, 1);
    const v = clamp((z - zs[row]) / (zs[row + 1] - zs[row]), 0, 1);
    const a = row * xs.length + column;
    const ha = heights[a];
    const hb = heights[a + 1];
    const hc = heights[a + xs.length];
    const hd = heights[a + xs.length + 1];
    // The mesh splits each cell from its (column + 1, row) corner to its (column, row + 1) corner.
    return u + v <= 1
        ? ha + (hb - ha) * u + (hc - ha) * v
        : hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
}

export const LAKE_MAP_WIDTH = 512;
export const LAKE_MAP_HEIGHT = 384;
/** The bake cache's key for the lake map. */
export const lakeMapKey = (width, height) => `golden-forest:lake-map:${width}x${height}`;

/** The lake map's bytes (RGBA8, row 0 at minZ). */
function computeLakeMap(width, height) {
    const data = new Uint8Array(width * height * 4);
    const {
        minX, maxX, minZ, maxZ,
    } = GOLDEN_FOREST_BOUNDS;
    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
            const x = minX + ((maxX - minX) * column) / (width - 1);
            const z = minZ + ((maxZ - minZ) * row) / (height - 1);
            // One reading of the shores serves both the height and the distance.
            const s = goldenForestShores(x, z);
            const inland = inlandOf(s);
            const ground = groundFromShores(x, z, s, inland);
            const offshore = -inland;
            const offset = (row * width + column) * 4;
            data[offset] = Math.round(clamp((ground + GOLDEN_FOREST_MAP_BIAS) / GOLDEN_FOREST_MAP_RANGE, 0, 1) * 255);
            data[offset + 1] = Math.round(clamp(offshore / 40, 0, 1) * 255);
            data[offset + 3] = 255;
        }
    }
    return data;
}

/** The lake map's bytes, baked once. */
export function bakeLakeMap(width = LAKE_MAP_WIDTH, height = LAKE_MAP_HEIGHT) {
    return bakeOnce(lakeMapKey(width, height), () => computeLakeMap(width, height));
}
