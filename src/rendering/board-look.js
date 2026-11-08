/**
 * @fileoverview Two things every board draws besides the pieces and the stack:
 *
 * - The landing glow. Where the falling piece will land, the surface under each of its
 *   columns lights up softly in the piece's colour. It is light on the landing spot, never a
 *   second, see-through copy of the piece.
 * - Garbage, in the world's own material: the GARBAGE colour of the theme's palette, lifted
 *   until it reads on the dark field, faintly tinted by the player who sent it, every other
 *   row a shade darker so it lies in layers. It is never a neutral grey.
 *
 * Pure colour maths and Phaser Graphics calls only; base-board-scene.js and shared-effects.js
 * use it for the main boards in every mode, canvas-drawing-utils.js for the online mini boards.
 */

/** Garbage is never darker than this (relative luminance): the old slate read well at ~0.08. */
export const GARBAGE_MIN_LUMINANCE = 0.075;
/** Clean garbage (its holes line up) sits a little lighter than plain garbage. */
export const CLEAN_GARBAGE_MIN_LUMINANCE = 0.11;
/** Nor lighter than this, so garbage never passes for a piece. */
export const GARBAGE_MAX_LUMINANCE = 0.2;
/**
 * Garbage is a muted material (HSL saturation at most this): a near-black navy lifted to be
 * readable would otherwise turn a vivid royal blue that reads as a piece.
 */
export const GARBAGE_MAX_SATURATION = 0.42;
/** How much of the sender's colour shows in the garbage they sent. */
export const GARBAGE_ATTACKER_TINT = 0.22;
/** Every other garbage row is this much darker, so the rows read as layers of material. */
export const GARBAGE_STRATA = 0.9;
/** The material when a world has none (no theme loaded): a deep slate. */
export const FALLBACK_GARBAGE_MATERIAL = 0x4a5068;

const channels = (int) => [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
const pack = (r, g, b) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

/** Mix two 0xRRGGBB colours: t = 0 gives a, t = 1 gives b. */
export function mixColor(a, b, t) {
    const [ar, ag, ab] = channels(a);
    const [br, bg, bb] = channels(b);
    return pack(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** WCAG relative luminance of a 0xRRGGBB colour (0 black … 1 white). */
export function relativeLuminance(int) {
    const linear = (c) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = channels(int);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function toHsl(int) {
    const [r, g, b] = channels(int).map((c) => c / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
}

function fromHsl(h, s, l) {
    if (s === 0) return pack(l * 255, l * 255, l * 255);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
        let x = t;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    return pack(hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255);
}

/**
 * The same hue, saturation no higher than `saturationCap`, lighter or darker until its luminance
 * lies in [min, max]. Luminance rises with HSL lightness, so a bisection on lightness finds the
 * nearest fit.
 */
export function clampLuminance(int, min, max, saturationCap = 1) {
    const [h, raw, l] = toHsl(int);
    const s = Math.min(raw, saturationCap);
    const start = s < raw ? fromHsl(h, s, l) : int;
    const luminance = relativeLuminance(start);
    if (luminance >= min && luminance <= max) return start;
    const target = luminance < min ? min : max;
    let low = luminance < min ? l : 0;
    let high = luminance < min ? 1 : l;
    for (let step = 0; step < 24; step++) {
        const mid = (low + high) / 2;
        if (relativeLuminance(fromHsl(h, s, mid)) < target) low = mid;
        else high = mid;
    }
    return fromHsl(h, s, luminance < min ? high : low);
}

/**
 * The colour of garbage on the board: the world's material, tinted by its sender, kept readable.
 * @param {number|null|undefined} materialInt the world's GARBAGE colour (0xRRGGBB)
 * @param {{attackerInt?: number|null, clean?: boolean}} [options]
 *   attackerInt: the sender's colour, when the garbage carries one; clean: holes in line.
 * @returns {number} 0xRRGGBB
 */
export function garbageMaterialColor(materialInt, { attackerInt = null, clean = false } = {}) {
    let color = Number.isFinite(materialInt) ? materialInt : FALLBACK_GARBAGE_MATERIAL;
    if (Number.isFinite(attackerInt)) color = mixColor(color, attackerInt, GARBAGE_ATTACKER_TINT);
    const min = clean ? CLEAN_GARBAGE_MIN_LUMINANCE : GARBAGE_MIN_LUMINANCE;
    return clampLuminance(color, min, GARBAGE_MAX_LUMINANCE, GARBAGE_MAX_SATURATION);
}

/** One garbage row's shade: every other row (by its row in the world) a little darker. */
export function garbageRowShade(int, worldY) {
    if ((((worldY % 2) + 2) % 2) === 0) return int;
    const [r, g, b] = channels(int);
    return pack(r * GARBAGE_STRATA, g * GARBAGE_STRATA, b * GARBAGE_STRATA);
}

/**
 * Where a piece touches down: for each run of neighbouring columns whose lowest cell sits on
 * the same row, that row (in the shape's own rows) and the run's first and last column.
 * @param {ArrayLike<ArrayLike<unknown>>} shape
 * @returns {{x0: number, x1: number, bottom: number}[]}
 */
export function landingRuns(shape) {
    const width = Math.max(0, ...Array.from(shape, (row) => row?.length || 0));
    const runs = [];
    for (let x = 0; x < width; x++) {
        let bottom = -1;
        for (let y = shape.length - 1; y >= 0; y--) {
            if (shape[y]?.[x]) {
                bottom = y;
                break;
            }
        }
        if (bottom < 0) continue;
        const last = runs[runs.length - 1];
        if (last && last.x1 === x - 1 && last.bottom === bottom) last.x1 = x;
        else runs.push({ x0: x, x1: x, bottom });
    }
    return runs;
}

/**
 * The landing glow: under each column of the falling piece, at the row it will land on, a soft
 * light rises from the surface, a thin bright line marks the surface itself, and a little light
 * spills onto what lies beneath.
 * @param {object} graphics a Phaser Graphics (fillGradientStyle, fillStyle, fillRect)
 * @param {object} options
 * @param {ArrayLike<ArrayLike<unknown>>} options.shape the piece's cells
 * @param {number} options.originX the piece's column
 * @param {number} options.landingY the row the piece's top lands on
 * @param {number} options.blockSize px per cell
 * @param {number} options.colorInt the piece's colour
 * @param {number} options.pulse 0..1, the board's slow breathing pulse
 * @param {number} [options.firstVisibleRow] rows above this are not drawn (hidden rows)
 */
export function drawLandingGlow(graphics, {
    shape, originX, landingY, blockSize, colorInt, pulse, firstVisibleRow = -Infinity,
}) {
    const light = mixColor(colorInt, 0xffffff, 0.35);
    const glowAlpha = 0.18 + 0.16 * pulse;
    const lineAlpha = 0.5 + 0.3 * pulse;
    const rise = blockSize * 0.9;
    const spill = blockSize * 0.3;
    const line = Math.max(1.5, blockSize * 0.08);
    for (const run of landingRuns(shape)) {
        const row = landingY + run.bottom;
        if (row < firstVisibleRow) continue;
        const x = (originX + run.x0) * blockSize;
        const w = (run.x1 - run.x0 + 1) * blockSize;
        const surface = (row + 1) * blockSize;
        graphics.fillGradientStyle(light, light, light, light, 0, 0, glowAlpha, glowAlpha);
        graphics.fillRect(x, surface - rise, w, rise);
        graphics.fillGradientStyle(light, light, light, light, glowAlpha * 0.6, glowAlpha * 0.6, 0, 0);
        graphics.fillRect(x, surface, w, spill);
        graphics.fillStyle(light, lineAlpha);
        graphics.fillRect(x, surface - line, w, line);
    }
}
