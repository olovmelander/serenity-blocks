/**
 * Aurora colour, in linear working space. The curtain colours follow the emissions that
 * make a real display: oxygen green for the body, oxygen red for the high crown, nitrogen
 * pink along an energised lower border and nitrogen blue-violet in the tallest rays.
 */
export const AURORA_COLORS = Object.freeze({
    greenWarm: Object.freeze([0.2, 1.0, 0.27]),
    greenCool: Object.freeze([0.03, 0.88, 0.5]),
    crown: Object.freeze([0.95, 0.06, 0.2]),
    fringe: Object.freeze([1.0, 0.2, 0.62]),
    violet: Object.freeze([0.4, 0.22, 1.0]),
    corona: Object.freeze([0.52, 0.42, 1.0]),
    skyZenith: Object.freeze([0.0028, 0.0046, 0.021]),
    skyHorizon: Object.freeze([0.0085, 0.019, 0.047]),
    airglow: Object.freeze([0.008, 0.022, 0.018]),
    snow: Object.freeze([0.58, 0.66, 0.8]),
    rock: Object.freeze([0.035, 0.045, 0.07]),
    water: Object.freeze([0.003, 0.009, 0.018]),
});

/** Tint a pulse takes when the payload names no piece: cycled per event. */
export const PULSE_CYCLE = Object.freeze([
    Object.freeze([0.3, 1.0, 0.65]),
    Object.freeze([0.25, 0.85, 1.0]),
    Object.freeze([0.72, 0.5, 1.0]),
    Object.freeze([1.0, 0.45, 0.85]),
    Object.freeze([0.75, 1.0, 0.45]),
]);

/** Storm tints the green body leans toward as a clear streak grows. */
export const STORM_TINTS = Object.freeze([
    Object.freeze([0.05, 0.95, 0.85]),
    Object.freeze([0.3, 0.6, 1.0]),
    Object.freeze([0.75, 0.35, 1.0]),
    Object.freeze([1.0, 0.3, 0.7]),
]);

/** sRGB hex / "#rrggbb" → linear RGB triple written into `out`; false when unparseable. */
export function parseColor(value, out) {
    let hex = null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        hex = Math.max(0, Math.min(0xffffff, Math.floor(value)));
    } else if (typeof value === 'string') {
        const match = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(value);
        if (match) {
            const digits = match[1].length === 3
                ? match[1].split('').map((digit) => digit + digit).join('')
                : match[1];
            hex = Number.parseInt(digits, 16);
        }
    }
    if (hex === null) return false;
    const channel = (byte) => {
        const c = byte / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    out[0] = channel((hex >> 16) & 255);
    out[1] = channel((hex >> 8) & 255);
    out[2] = channel(hex & 255);
    return true;
}

/**
 * Push a colour to full vividness without changing its hue: pulses are light, so a dark
 * or pastel piece colour still has to read as a clear, saturated glow.
 */
export function vivid(color, out = color) {
    const high = Math.max(color[0], color[1], color[2], 1e-4);
    const low = Math.min(color[0], color[1], color[2]);
    // Lift to full value, then pull the floor down so a pale piece still carries its hue.
    const floor = (low / high) * 0.8;
    for (let i = 0; i < 3; i += 1) out[i] = Math.max(0, (color[i] / high - floor) / (1 - floor));
    return out;
}
