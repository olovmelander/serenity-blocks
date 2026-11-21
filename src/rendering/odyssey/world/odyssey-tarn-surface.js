// @ts-check
/**
 * THE DRAWN WATERS' SURFACES (2026-11-20 the tarn, 2026-11-21 the north lake): the flat sheet a
 * drawn water is drawn on, and the places on the tarn where a ring may rise. Three-free: the world
 * renderer wraps the arrays, the tests read them.
 *
 * The shore is a drawn line now (ODYSSEY_TARN.outline, odyssey-world-height.js), not ellipses, so
 * the water is no longer a disc a lobe. It is one sheet cut to the shore: the cells of a grid over
 * the tarn's box that lie in the water or within `margin` of it. The margin is on dry ground, where
 * the bank stands over the sheet and the depth test hides it; the waterline itself is drawn by the
 * water's own depth (its film thins to nothing there), never by the sheet's edge.
 */
import {
    ODYSSEY_NORTH_LAKE, ODYSSEY_NORTH_LAKE_BOX, ODYSSEY_TARN, ODYSSEY_TARN_BOX, odysseyNorthLakeDistance,
    odysseyTarnDistance,
} from './odyssey-world-height.js';

/** The tarn's sheet: its grid cell (u) and how far past the waterline it reaches (u). */
export const TARN_SURFACE = Object.freeze({ cell: 3, margin: 5 });
/** The north lake's sheet (seen from 600-1000 u: a coarser grid, a wider margin under its bank). */
export const NORTH_LAKE_SURFACE = Object.freeze({ cell: 6, margin: 12 });

/**
 * A drawn water's sheet: vertex positions (x, y, z; y = the water's level) and triangle indices,
 * wound to face up. The cells of a grid over the water's `box` with a corner within `margin` of
 * the water (`distance` < margin).
 * @param {{box: readonly number[], distance: (x: number, z: number) => number, waterY: number}} water
 * @param {{cell: number, margin: number}} grid
 * @returns {{positions: Float32Array, indices: Uint32Array}}
 */
export function buildDrawnWaterSurface({ box, distance, waterY }, { cell, margin }) {
    const [x0, x1, z0, z1] = box;
    const nx = Math.ceil((x1 - x0) / cell);
    const nz = Math.ceil((z1 - z0) / cell);
    const wet = new Uint8Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j += 1) {
        for (let i = 0; i <= nx; i += 1) {
            wet[(j * (nx + 1)) + i] = distance(x0 + (i * cell), z0 + (j * cell)) < margin ? 1 : 0;
        }
    }
    const slot = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const positions = [];
    const indices = [];
    const vertex = (i, j) => {
        const k = (j * (nx + 1)) + i;
        if (slot[k] < 0) {
            slot[k] = positions.length / 3;
            positions.push(x0 + (i * cell), waterY, z0 + (j * cell));
        }
        return slot[k];
    };
    for (let j = 0; j < nz; j += 1) {
        for (let i = 0; i < nx; i += 1) {
            const any = wet[(j * (nx + 1)) + i] || wet[(j * (nx + 1)) + i + 1]
                || wet[((j + 1) * (nx + 1)) + i] || wet[((j + 1) * (nx + 1)) + i + 1];
            if (!any) continue;
            const a = vertex(i, j);
            const b = vertex(i + 1, j);
            const c = vertex(i, j + 1);
            const d = vertex(i + 1, j + 1);
            // +y faces: (a, c, b) and (b, c, d) with x to the right and z toward the viewer.
            indices.push(a, c, b, b, c, d);
        }
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** The tarn's sheet. */
export function buildTarnSurface({ cell = TARN_SURFACE.cell, margin = TARN_SURFACE.margin } = {}) {
    return buildDrawnWaterSurface(
        { box: ODYSSEY_TARN_BOX, distance: odysseyTarnDistance, waterY: ODYSSEY_TARN.waterY },
        { cell, margin },
    );
}

/** The north lake's sheet. */
export function buildNorthLakeSurface({ cell = NORTH_LAKE_SURFACE.cell, margin = NORTH_LAKE_SURFACE.margin } = {}) {
    return buildDrawnWaterSurface(
        { box: ODYSSEY_NORTH_LAKE_BOX, distance: odysseyNorthLakeDistance, waterY: ODYSSEY_NORTH_LAKE.waterY },
        { cell, margin },
    );
}

/**
 * Places in the open water, well spread: where a fish may rise. Chosen once by farthest-point
 * picking over the grid cells at least `clear` units inside the shore.
 * @param {number} count
 * @param {number} [clear]
 * @returns {number[][]} [x, z] each
 */
export function tarnOpenWater(count, clear = 7) {
    const [x0, x1, z0, z1] = ODYSSEY_TARN_BOX;
    const cells = [];
    for (let z = z0; z <= z1; z += 4) {
        for (let x = x0; x <= x1; x += 4) {
            if (odysseyTarnDistance(x, z) < -clear) cells.push([x, z]);
        }
    }
    if (!cells.length) return [];
    // Start from the cell nearest the box's middle, then always the cell farthest from the picks.
    const mid = [(x0 + x1) / 2, (z0 + z1) / 2];
    let first = cells[0];
    cells.forEach((c) => {
        if (Math.hypot(c[0] - mid[0], c[1] - mid[1]) < Math.hypot(first[0] - mid[0], first[1] - mid[1])) first = c;
    });
    const picks = [first];
    const nearest = cells.map((c) => Math.hypot(c[0] - first[0], c[1] - first[1]));
    while (picks.length < count) {
        let best = 0;
        for (let i = 1; i < cells.length; i += 1) if (nearest[i] > nearest[best]) best = i;
        const pick = cells[best];
        picks.push(pick);
        for (let i = 0; i < cells.length; i += 1) {
            nearest[i] = Math.min(nearest[i], Math.hypot(cells[i][0] - pick[0], cells[i][1] - pick[1]));
        }
    }
    return picks;
}
