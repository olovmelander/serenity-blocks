// @ts-check
/**
 * @fileoverview The colour of a board's walls, and the rule they keep: a board's near-black
 * field never stands in a light-blue frame.
 *
 * The stylesheets draw each well's walls in a hue lifted toward cream (82 % hue, 18 % #fff6e9:
 * keystone-solo.css, keystone-versus.css, keystone-online.css). A player's colour can be any
 * hex (the palettes, a peer's choice), so the code that puts it on a board's card also sets
 * `--player-wall` to boardWallColor(colour): the same mix, deepened when it would come out
 * light blue, so a cyan player keeps a cyan frame, only a deep one. tests/unit/board-walls.test.js
 * holds the palettes and the stylesheets' own walls to the same rule.
 */

/** @typedef {{ r: number, g: number, b: number, a: number }} Rgba channels 0-255, alpha 0-1 */

/** The cream the walls are lifted toward, and the hue's share of the mix. */
export const WALL_LIFT = '#fff6e9';
export const WALL_HUE_SHARE = 0.82;

/** Light blue: a hue in this band, at least this saturated and this bright (WCAG luminance). */
export const LIGHT_BLUE = Object.freeze({
    hueMin: 170, hueMax: 215, minSaturation: 0.25, minLuminance: 0.25,
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const clamp255 = (value) => Math.min(255, Math.max(0, value));

/**
 * One channel of rgb()/rgba(): a number 0-255 or a percentage.
 * @param {string} token
 */
function channel(token) {
    const value = Number.parseFloat(token);
    if (!Number.isFinite(value)) return Number.NaN;
    return token.trim().endsWith('%') ? (value / 100) * 255 : value;
}

/**
 * Alpha: a number 0-1 or a percentage.
 * @param {string} token
 */
function alpha(token) {
    const value = Number.parseFloat(token);
    if (!Number.isFinite(value)) return Number.NaN;
    return clamp01(token.trim().endsWith('%') ? value / 100 : value);
}

/**
 * Reads a CSS colour: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `rgba()` (comma or
 * space syntax).
 * @param {unknown} color
 * @returns {Rgba | null} null when it isn't one of those
 */
export function parseCssColor(color) {
    if (typeof color !== 'string') return null;
    const text = color.trim().toLowerCase();
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
    if (hex) {
        const digits = hex[1].length <= 4 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
        const byte = (i) => Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
        return {
            r: byte(0), g: byte(1), b: byte(2), a: digits.length === 8 ? byte(3) / 255 : 1,
        };
    }
    const fn = /^rgba?\(([^()]*)\)$/.exec(text);
    if (!fn) return null;
    const [body, slashAlpha, ...extra] = fn[1].split('/');
    const parts = body.includes(',') ? body.split(',') : body.trim().split(/\s+/);
    if (slashAlpha !== undefined) parts.push(slashAlpha);
    if (extra.length || (parts.length !== 3 && parts.length !== 4)) return null;
    const [r, g, b] = parts.slice(0, 3).map(channel);
    const a = parts.length === 4 ? alpha(parts[3]) : 1;
    if (![r, g, b, a].every(Number.isFinite)) return null;
    return {
        r: clamp255(r), g: clamp255(g), b: clamp255(b), a,
    };
}

/**
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {string} `#rrggbb`
 */
export function toHex({ r, g, b }) {
    return `#${[r, g, b].map((c) => Math.round(clamp255(c)).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * WCAG relative luminance, 0 (black) to 1 (white).
 * @param {{ r: number, g: number, b: number }} rgb
 */
export function relativeLuminance({ r, g, b }) {
    const lin = (c) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {{ h: number, s: number, l: number }} hue in degrees, saturation and lightness 0-1
 */
export function rgbToHsl({ r, g, b }) {
    const [rn, gn, bn] = [r / 255, g / 255, b / 255];
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return { h: (h * 60 + 360) % 360, s, l };
}

/**
 * @param {{ h: number, s: number, l: number }} hsl
 * @returns {{ r: number, g: number, b: number }} channels 0-255
 */
export function hslToRgb({ h, s, l }) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const sector = Math.floor((((h % 360) + 360) % 360) / 60);
    const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/**
 * Whether a colour reads as light blue (its alpha aside): a hue from 170° to 215°, HSL
 * saturation of at least 0.25 and a WCAG relative luminance of at least 0.25.
 * @param {string | { r: number, g: number, b: number }} color
 */
export function isLightBlue(color) {
    const rgb = typeof color === 'string' ? parseCssColor(color) : color;
    if (!rgb) return false;
    const { h, s } = rgbToHsl(rgb);
    return h >= LIGHT_BLUE.hueMin && h <= LIGHT_BLUE.hueMax
        && s >= LIGHT_BLUE.minSaturation
        && relativeLuminance(rgb) >= LIGHT_BLUE.minLuminance;
}

/**
 * A colour as `#rrggbb`, deepened if it is light blue: same hue and saturation, the lightness
 * lowered a step at a time until it no longer is (alpha is dropped: walls are opaque).
 * @param {string} color
 * @returns {string | null} null when the colour can't be read
 */
export function deepenLightBlue(color) {
    const rgb = parseCssColor(color);
    if (!rgb) return null;
    const hex = toHex(rgb);
    if (!isLightBlue(hex)) return hex;
    const { h, s, l } = rgbToHsl(rgb);
    for (let step = 1; step <= 100; step++) {
        const deeper = toHex(hslToRgb({ h, s, l: Math.max(0, l - step * 0.01) }));
        if (!isLightBlue(deeper)) return deeper;
    }
    return '#000000';
}

/**
 * The colour a board's walls are painted in for a player colour: the stylesheets' mix (82 %
 * colour, 18 % cream, in sRGB), deepened when that mix is light blue.
 * @param {string} color
 * @returns {string | null} `#rrggbb`, or null when the colour can't be read
 */
export function boardWallColor(color) {
    const rgb = parseCssColor(color);
    const lift = /** @type {Rgba} */ (parseCssColor(WALL_LIFT));
    if (!rgb) return null;
    const mix = (c, k) => c * WALL_HUE_SHARE + k * (1 - WALL_HUE_SHARE);
    return deepenLightBlue(toHex({ r: mix(rgb.r, lift.r), g: mix(rgb.g, lift.g), b: mix(rgb.b, lift.b) }));
}

/**
 * Puts a player's colour on a board's card: `--player-primary` (the plate, the next tile, the
 * glow) and `--player-wall` (the walls, boardWallColor). For a colour it can't read, the
 * stylesheet's own mix draws the walls.
 * @param {{ style: { setProperty: Function, removeProperty?: Function } } | null | undefined} element
 * @param {string} color
 */
export function applyPlayerColor(element, color) {
    if (!element?.style) return;
    element.style.setProperty('--player-primary', color);
    const wall = boardWallColor(color);
    if (wall) element.style.setProperty('--player-wall', wall);
    else element.style.removeProperty?.('--player-wall');
}
