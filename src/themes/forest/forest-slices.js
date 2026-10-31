/**
 * Forest — the time slices of a first build.
 *
 * The forest builds in steps (shared/build-steps.js): the world yields between its parts, and the
 * parts' long loops yield whenever a slice of work has run. Each breath costs the theme still
 * playing a frame; a first switch into the Forest held single tasks of 20-40 ms before (the light
 * and the floor, the sprays, the understory, the firefly animals laid out, 2026-10-31).
 */

/** The work a time-sliced loop of a first build does between breaths (ms). */
export const FOREST_SLICE_MS = 8;

/**
 * A breath in a time-sliced loop: yields `label` once the slice has run, and starts the next.
 * @param {{ due: () => boolean, restart: () => void }} clock
 * @param {string} label
 */
export function* forestSlice(clock, label) {
    if (clock.due()) {
        yield label;
        clock.restart();
    }
}

/**
 * three's BufferGeometry.computeVertexNormals() of an indexed mesh, as steps: each face's cross
 * product added to its three corners' float32 sums in the same order, then each sum normalised as
 * Vector3.normalize() does, so the same bits (the same as Verdant Hills' and Spring's).
 * @param {ArrayLike<number>} position
 * @param {ArrayLike<number>} index
 * @param {{ due: () => boolean, restart: () => void }} clock
 * @returns {Generator<string, Float32Array>}
 */
export function* forestVertexNormalsSteps(position, index, clock) {
    const normal = new Float32Array(position.length);
    for (let i = 0; i < index.length; i += 3) {
        const a = index[i] * 3;
        const b = index[i + 1] * 3;
        const c = index[i + 2] * 3;
        const bx = position[b];
        const by = position[b + 1];
        const bz = position[b + 2];
        const cbx = position[c] - bx;
        const cby = position[c + 1] - by;
        const cbz = position[c + 2] - bz;
        const abx = position[a] - bx;
        const aby = position[a + 1] - by;
        const abz = position[a + 2] - bz;
        const nx = cby * abz - cbz * aby;
        const ny = cbz * abx - cbx * abz;
        const nz = cbx * aby - cby * abx;
        // All three sums are read before any is written, as three does (a corner named twice).
        const ax0 = normal[a] + nx;
        const ay0 = normal[a + 1] + ny;
        const az0 = normal[a + 2] + nz;
        const bx0 = normal[b] + nx;
        const by0 = normal[b + 1] + ny;
        const bz0 = normal[b + 2] + nz;
        const cx0 = normal[c] + nx;
        const cy0 = normal[c + 1] + ny;
        const cz0 = normal[c + 2] + nz;
        normal[a] = ax0;
        normal[a + 1] = ay0;
        normal[a + 2] = az0;
        normal[b] = bx0;
        normal[b + 1] = by0;
        normal[b + 2] = bz0;
        normal[c] = cx0;
        normal[c + 1] = cy0;
        normal[c + 2] = cz0;
        if (i % 6144 === 0) yield* forestSlice(clock, 'normals');
    }
    for (let i = 0; i < normal.length; i += 3) {
        const x = normal[i];
        const y = normal[i + 1];
        const z = normal[i + 2];
        const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
        normal[i] = x * scale;
        normal[i + 1] = y * scale;
        normal[i + 2] = z * scale;
        if (i % 6144 === 0) yield* forestSlice(clock, 'normals');
    }
    return normal;
}
