/**
 * Painted Ages — a field's texture data, prepared on the CPU (createFieldTexture in
 * painted-ages-tsl.js uploads it).
 */
import { halfBits } from '../../rendering/half-float.js';

/**
 * Rows [j0, j1) of `fieldTextureData` into `data`, for a build that yields between bands of rows.
 * The same arithmetic in the same order as reading each cell's neighbours through an edge clamp,
 * with three's half-float bits (rendering/half-float.js): identical data, several times faster
 * (Painted Ages' first visit spent 58-66 ms per 1024² field in one task here, 2026-10-31).
 */
export function fillFieldTextureRows(data, heights, sky, field, j0, j1) {
    const { size } = field;
    const cell = field.span / (size - 1);
    const range = field.hi - field.lo;
    const last = size - 1;
    for (let j = j0; j < j1; j++) {
        const rm = Math.max(0, j - 1) * size;
        const r0 = j * size;
        const rp = Math.min(last, j + 1) * size;
        for (let i = 0; i < size; i++) {
            const im = i > 0 ? i - 1 : 0;
            const ip = i < last ? i + 1 : last;
            const gx = (heights[rm + ip] + 2 * heights[r0 + ip] + heights[rp + ip]
                - heights[rm + im] - 2 * heights[r0 + im] - heights[rp + im]) / (8 * cell);
            const gz = (heights[rp + im] + 2 * heights[rp + i] + heights[rp + ip]
                - heights[rm + im] - 2 * heights[rm + i] - heights[rm + ip]) / (8 * cell);
            const o = (r0 + i) * 4;
            data[o] = halfBits((heights[r0 + i] - field.lo) / range);
            data[o + 1] = halfBits(gx);
            data[o + 2] = halfBits(gz);
            data[o + 3] = halfBits(sky[r0 + i] / 255);
        }
    }
}

/**
 * A field's GPU form: (height normalised to its [lo, hi], dh/dx, dh/dz, sky) as half floats, the
 * slope read off the heights a little smoothed (a Sobel pair) so a normal per cell never shows
 * as a grid of dots. (The near and mid fields' drainage is its own 8-bit texture:
 * createFlowTexture.)
 */
export function fieldTextureData(heights, sky, field) {
    const data = new Uint16Array(field.size * field.size * 4);
    fillFieldTextureRows(data, heights, sky, field, 0, field.size);
    return data;
}
