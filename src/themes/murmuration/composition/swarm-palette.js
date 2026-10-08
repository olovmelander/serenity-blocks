/**
 * Murmuration — the swarm's palette (three-free; shared by the shader and the show).
 *
 * Linear RGB, cyclic. Only about a third of the cycle is on screen at once, so the swarm
 * is never a rainbow: it wears two or three neighbouring hues, and which ones changes
 * slowly with time and steps on with each level.
 */
export const SWARM_PALETTE = Object.freeze([
    Object.freeze([0.36, 0.12, 1.00]), // violet
    Object.freeze([0.10, 0.32, 1.00]), // electric blue
    Object.freeze([0.00, 0.78, 1.00]), // cyan
    Object.freeze([0.16, 1.00, 0.72]), // mint
    Object.freeze([0.30, 0.62, 1.00]), // sky
    Object.freeze([0.62, 0.22, 1.00]), // purple
    Object.freeze([1.00, 0.16, 0.78]), // magenta
    Object.freeze([1.00, 0.30, 0.46]), // rose
]);

/** Fraction of the cycle the swarm spans from one side of the frame to the other. */
export const PALETTE_SPAN = 0.34;
/** How far the palette steps on per level. */
export const PALETTE_LEVEL_STEP = 0.17;

/**
 * The palette at cycle position `t` (any real number), written into `out` (a 3-array or
 * anything with r/g/b). Same smoothstep blend between stops as the shader.
 */
export function samplePalette(t, out = [0, 0, 0]) {
    const stops = SWARM_PALETTE.length;
    const scaled = (t - Math.floor(t)) * stops;
    const i0 = Math.floor(scaled) % stops;
    const i1 = (i0 + 1) % stops;
    const f = scaled - Math.floor(scaled);
    const blend = f * f * (3 - 2 * f);
    const a = SWARM_PALETTE[i0];
    const b = SWARM_PALETTE[i1];
    const r = a[0] + (b[0] - a[0]) * blend;
    const g = a[1] + (b[1] - a[1]) * blend;
    const bl = a[2] + (b[2] - a[2]) * blend;
    if (Array.isArray(out) || ArrayBuffer.isView(out)) {
        out[0] = r; out[1] = g; out[2] = bl;
    } else {
        out.r = r; out.g = g; out.b = bl;
    }
    return out;
}
