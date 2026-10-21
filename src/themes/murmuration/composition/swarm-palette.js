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

/** The fire a hot swarm turns to (linear RGB): ember, amber and gold, chosen by place. */
export const FIRE = Object.freeze({
    ember: Object.freeze([1.0, 0.13, 0.03]),
    amber: Object.freeze([1.0, 0.36, 0.04]),
    gold: Object.freeze([1.0, 0.66, 0.16]),
});
/** How fast the colours commit to the fire as heat rises: warmth = (heat × 0.9)^this. */
export const HEAT_EXPONENT = 0.65;

/**
 * How far toward the fire the swarm's colours have turned (0..1) at a heat (0..1). A formation
 * keeps most of its own colours (`shapeColor` 1 = held in a figure).
 */
export function heatWarmth(heat, shapeColor = 0) {
    const h = Math.max(0, heat) * 0.9 * (1 - Math.max(0, Math.min(1, shapeColor)) * 0.7);
    return h > 0 ? h ** HEAT_EXPONENT : 0;
}

/**
 * The colour `k` of the way from `a` to `b` (3-arrays, linear RGB), turning the hue in the
 * direction of rising hue (red → yellow → green → cyan → blue → magenta → red) about the
 * grey axis and easing chroma and level between the two — the shader's `murm_turnHue`.
 * From cyan toward fire that is through blue, violet and rose, never through green or grey.
 * Writes into `out` (may be `a`).
 */
export function turnHue(a, b, k, out = [0, 0, 0]) {
    const mA = (a[0] + a[1] + a[2]) / 3;
    const mB = (b[0] + b[1] + b[2]) / 3;
    const xA = (a[0] - mA) * 1.5;
    const yA = (a[1] - a[2]) * 0.8660254;
    const xB = (b[0] - mB) * 1.5;
    const yB = (b[1] - b[2]) * 0.8660254;
    const hA = Math.atan2(yA, xA);
    const turn = (Math.atan2(yB, xB) - hA) / (Math.PI * 2);
    const span = (turn - Math.floor(turn)) * Math.PI * 2;
    const angle = hA + span * k;
    const chroma = Math.hypot(xA, yA) + (Math.hypot(xB, yB) - Math.hypot(xA, yA)) * k;
    const m = mA + (mB - mA) * k;
    const x = Math.cos(angle) * chroma;
    const y = Math.sin(angle) * chroma;
    out[0] = Math.max(0, m + (x * 2) / 3);
    out[1] = Math.max(0, m - x / 3 + y * 0.5773503);
    out[2] = Math.max(0, m - x / 3 - y * 0.5773503);
    return out;
}

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
