/**
 * The well height of a Last Standing match (local versus on Infinity boards).
 *
 * Every player's well is this many rows tall, and a stack that reaches its roof is out.
 * The setup sheet offers 40 to 1,000 rows and starts at 100. An Infinity board opens 44
 * rows tall and grows upward ten rows at a time as the tower nears its top, so a well
 * shorter than 44 rows opens at its full height and never grows.
 *
 * Pure: the sheet's field, the config it emits and the match state all read these numbers.
 */

/** The well heights a match may choose (the setup sheet's stepper). */
export const INFINITY_WELL_ROWS_MIN = 40;
export const INFINITY_WELL_ROWS_MAX = 1000;
export const INFINITY_WELL_ROWS_DEFAULT = 100;

/** The stepper's stride: tens up to this height, fifties above it. */
export const INFINITY_WELL_ROWS_FINE_STEP = 10;
export const INFINITY_WELL_ROWS_COARSE_STEP = 50;
export const INFINITY_WELL_ROWS_FINE_BELOW = 100;

/** The rows an Infinity board opens with before it grows. */
export const INFINITY_OPENING_ROWS = 44;

/**
 * A well height as a match accepts it: a whole number of rows within the range. A missing
 * or unreadable height is the default; a number outside the range is brought to its edge.
 * @param {unknown} value a form field's text or a config's number
 * @returns {number}
 */
export function readInfinityWellRows(value) {
    const asked = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(asked)) return INFINITY_WELL_ROWS_DEFAULT;
    return Math.min(INFINITY_WELL_ROWS_MAX, Math.max(INFINITY_WELL_ROWS_MIN, asked));
}

/**
 * The rows a well of this height opens with: the usual opening grid, or the whole well
 * when it is shorter than that.
 * @param {unknown} wellRows
 * @returns {number}
 */
export function infinityWellOpeningRows(wellRows) {
    return Math.min(INFINITY_OPENING_ROWS, readInfinityWellRows(wellRows));
}
