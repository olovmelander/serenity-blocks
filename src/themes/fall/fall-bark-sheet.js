/**
 * Fall — the bark sheet.
 *
 * The trees' UVs tile a sheet of bark 1.15 m wide and twice as tall (scripts/blender/fall_grove/wood.py),
 * whole turns round every limb, so one tileable texture wraps the whole grove without a seam. This
 * module draws that sheet: old bark as it grows, in plates.
 *
 *   R  height: tall plates, each at its own level and rounded at its edge, split by deep furrows
 *      that run up the trunk and fork; finer fissures across the plates; a fibrous grain
 *   G  tint: a tone for every plate, and the grain
 *   B  cavity: 1 down in a furrow, 0 on a plate (wider and softer than the furrow itself)
 *   A  blotches: slow, soft noise for moss and lichen
 *
 * Plain numbers from fixed hashes: no random generator is drawn from (the grove's own draws stay
 * as they were), no three.js, the same sheet every time, so it is drawn once a session.
 */

/** Texels across the sheet (it is twice as tall): 4.5 mm a texel. */
export const FALL_BARK_SHEET_SIZE = 256;

const hash = (x, y, salt) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
const ramp = (lo, hi, x) => {
    const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};
const wrap = (i, n) => ((i % n) + n) % n;

/** A grid of plate centres, one a cell, that repeats over the sheet. */
function plateGrid(cellsX, cellsY, salt) {
    const count = cellsX * cellsY;
    const grid = {
        cellsX, cellsY, x: new Float32Array(count), y: new Float32Array(count), level: new Float32Array(count),
    };
    for (let cy = 0; cy < cellsY; cy += 1) {
        for (let cx = 0; cx < cellsX; cx += 1) {
            const i = cy * cellsX + cx;
            grid.x[i] = 0.18 + 0.64 * hash(cx, cy, salt);
            grid.y[i] = 0.1 + 0.8 * hash(cx, cy, salt + 1);
            grid.level[i] = hash(cx, cy, salt + 2);
        }
    }
    return grid;
}

const NEAR = { gap: 0, level: 0 };

/** How far (u, v) is from the nearest plate's edge, in cells, and that plate's own level. */
function plateAt(grid, u, v, out = NEAR) {
    const x = u * grid.cellsX;
    const y = v * grid.cellsY;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let first = Infinity;
    let second = Infinity;
    let level = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const cx = ix + dx;
            const cy = iy + dy;
            const i = wrap(cy, grid.cellsY) * grid.cellsX + wrap(cx, grid.cellsX);
            const px = cx + grid.x[i] - x;
            const py = cy + grid.y[i] - y;
            const distance = Math.sqrt(px * px + py * py);
            if (distance < first) {
                second = first;
                first = distance;
                level = grid.level[i];
            } else if (distance < second) second = distance;
        }
    }
    // eslint-disable-next-line no-param-reassign
    out.gap = second - first;
    // eslint-disable-next-line no-param-reassign
    out.level = level;
    return out;
}

/** Soft value noise that repeats over the sheet. */
function valueNoise(u, v, cellsX, cellsY, salt) {
    const x = u * cellsX;
    const y = v * cellsY;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const tx = smooth(x - ix);
    const ty = smooth(y - iy);
    const at = (cx, cy) => hash(wrap(cx, cellsX), wrap(cy, cellsY), salt);
    return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty)
        + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
}

const TAU = Math.PI * 2;
// Plates about 14 cm wide and five times as tall; the fissures that score them half that.
const PLATES = plateGrid(8, 3, 11);
const FISSURES = plateGrid(15, 7, 37);

/** One texel of the sheet at (u, v) in 0..1, written as four numbers 0..1 into `out`. */
export function fallBarkSheetAt(u, v, out = [0, 0, 0, 0]) {
    // The furrows wander as they climb (whole waves over the sheet, so it still repeats).
    const bend = 0.03 * Math.sin(TAU * (v * 2 + 0.3)) + 0.014 * Math.sin(TAU * (v * 5 + u))
        + 0.006 * Math.sin(TAU * (v * 11 + u * 3 + 0.6));
    const plate = plateAt(PLATES, u + bend, v);
    const edge = ramp(0, 0.24, plate.gap);
    const { level } = plate;
    const cavity = 1 - ramp(0.02, 0.4, plate.gap);
    const fissure = ramp(0, 0.2, plateAt(FISSURES, u + bend * 1.6, v).gap);
    const grain = valueNoise(u, v, 48, 10, 71) * 0.6 + valueNoise(u, v, 96, 18, 73) * 0.4;
    // A plate stands proud and is rounded off toward its edge; fissures score it; the grain runs up it.
    const rounded = 1 - (1 - edge) * (1 - edge);
    const height = rounded * (0.62 + 0.38 * level) * (0.72 + 0.28 * fissure) * (0.82 + 0.18 * grain);
    const blotch = valueNoise(u, v, 4, 8, 97) * 0.62 + valueNoise(u, v, 9, 18, 101) * 0.38;
    /* eslint-disable no-param-reassign */
    out[0] = Math.max(0, Math.min(1, height));
    out[1] = Math.max(0, Math.min(1, level * 0.6 + grain * 0.4));
    out[2] = Math.max(0, Math.min(1, cavity));
    out[3] = Math.max(0, Math.min(1, blotch));
    /* eslint-enable no-param-reassign */
    return out;
}

/**
 * The sheet's texels (RGBA bytes, `size` across and twice as tall), a time slice a step.
 * @param {{ due: () => boolean, restart: () => void } | null} clock
 * @param {(clock: any, label: string) => Generator} [slice]
 */
export function* fallBarkSheetSteps(clock = null, slice = null, size = FALL_BARK_SHEET_SIZE) {
    const width = size;
    const height = size * 2;
    const data = new Uint8Array(width * height * 4);
    const texel = [0, 0, 0, 0];
    for (let row = 0; row < height; row += 1) {
        if (slice && (row & 7) === 0) yield* slice(clock, 'bark sheet');
        const v = (row + 0.5) / height;
        for (let column = 0; column < width; column += 1) {
            fallBarkSheetAt((column + 0.5) / width, v, texel);
            const o = (row * width + column) * 4;
            data[o] = Math.round(texel[0] * 255);
            data[o + 1] = Math.round(texel[1] * 255);
            data[o + 2] = Math.round(texel[2] * 255);
            data[o + 3] = Math.round(texel[3] * 255);
        }
    }
    return { data, width, height };
}

/** The sheet, drawn once a session and kept (it is the same every time). */
let kept = null;

/** The kept sheet, or null before it was first drawn. */
export function fallBarkSheetKept() {
    return kept;
}

/** Draw the sheet (a time slice a step) unless this session already has it. */
export function* fallBarkSheetOnce(clock = null, slice = null) {
    if (!kept) kept = yield* fallBarkSheetSteps(clock, slice);
    return kept;
}
