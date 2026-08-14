/**
 * TILING VALUE NOISE for the world's texture bakes.
 *
 * Extracted from `bakeDetailNormal`, where it was a closure that DID NOT TILE — and every
 * channel of the 256² detail texture is sampled with `RepeatWrapping`, so a field that does
 * not tile draws a hard straight line across the world at every tile boundary.
 *
 * THE BUG, for anyone tempted to re-inline this. The hash wrapped the lattice index at `res`:
 *
 *     const h = (ix, iy) => { const wx = ((ix % res) + res) % res; ... }
 *
 * A value-noise lattice at frequency `freq` has `res * freq` cells across the tile, not `res`
 * of them — eight at 1/32, ten at 1/26. `ix` therefore never reached 256 and the modulo never
 * engaged, so the value at texel 255 and the value at texel 0 came from unrelated hash cells.
 * MEASURED on the shipped bake, 2026-08-13: the silhouette field stepped **0.228 mean / 0.410
 * worst** across its v seam against an interior texel-to-texel step of 0.0047 — 48x — while
 * the deck's whole anti-aliased alpha edge is 0.06 wide. One texel took the sky from clear to
 * solid cloud, which is the razor straight edge the ch5 captures had been showing since the
 * silhouette rebake, and which three earlier bisects (screen-derivative footprint, altitude
 * corridor, clipmap ring structure) correctly ruled out one at a time.
 *
 * TWO THINGS ARE REQUIRED FOR A LATTICE TO CLOSE, and the old code had neither:
 *  1. the hash must wrap at the CELL COUNT, and
 *  2. the cell count must be an INTEGER — 256/26 is 9.85, so no wrap of any kind could have
 *     made that frequency tile. The frequency is snapped to the nearest whole cell count,
 *     which moves 1/26 to 1/25.6 and 1/11 to 1/11.13; both are ~1 % scale changes in a
 *     detail octave, and 1/32 is exactly 8 cells already and does not move at all.
 *
 * The cell count is mixed into the hash so two octaves of the same field do not correlate at
 * the tile origin, where both would otherwise read cell (0, 0).
 *
 * @param {number} res texture resolution the noise must tile across
 * @returns {(x:number, y:number, freq:number)=>number} sampler in [0, 1), periodic in `res`
 */
export function createTilingValueNoise(res) {
    const hash = (ix, iy, cells) => {
        const wx = ((ix % cells) + cells) % cells;
        const wy = ((iy % cells) + cells) % cells;
        let v = (wx * 374761393) + (wy * 668265263) + (cells * 2654435761);
        v = Math.imul(v ^ (v >>> 13), 1274126177);
        return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
    };
    return (x, y, freq) => {
        const cells = Math.max(1, Math.round(res * freq));
        const f = cells / res;
        const fx = x * f;
        const fy = y * f;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const ux = tx * tx * (3 - (2 * tx));
        const uy = ty * ty * (3 - (2 * ty));
        const a = hash(ix, iy, cells);
        const b = hash(ix + 1, iy, cells);
        const c = hash(ix, iy + 1, cells);
        const d = hash(ix + 1, iy + 1, cells);
        return (((a * (1 - ux)) + (b * ux)) * (1 - uy)) + (((c * (1 - ux)) + (d * ux)) * uy);
    };
}
