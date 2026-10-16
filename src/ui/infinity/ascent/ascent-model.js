// @ts-check

/**
 * Where the view is, in the terms the ascent's senses use: how high it looks, how far above or
 * below the rows the game plays in, and how much sky or depth that makes. Pure, no DOM.
 *
 * The story is relative to the player's own rows ("home": where the game holds the camera):
 * - above home is the open sky over the tower. Rising into it, the world sinks away below and a
 *   night sky comes down from the top of the screen, with its stars;
 * - below home is the tower already built, down to the floor. Descending, the world rises past
 *   and a haze of depth climbs from below (never all of it: the build is the subject there).
 */

export const ASCENT = Object.freeze({
    /** Rows above home where the sky starts to come down, and where it has covered the world. */
    SKY_FROM_ROWS: 3,
    SKY_FULL_ROWS: 24,
    /** Rows below home where the depth haze starts to rise, the rows where it is fullest, and how full. */
    DEEP_FROM_ROWS: 3,
    DEEP_FULL_ROWS: 50,
    DEEP_MAX: 0.8,
    /** The signal's saturating scale (rows) for `rise`, and the speed (rows a second) for `speed` 1. */
    RISE_ROWS: 22,
    SPEED_ROWS: 40,
    /** The theme layer moves at this share of the board's speed (parallax), up to its caps. */
    THEME_PARALLAX: 0.12,
    THEME_SINK_CAP: 0.3,
    THEME_LIFT_CAP: 0.06,
    /** A soft tick every this many rows of height. */
    TICK_ROWS: 10,
    /** Milestones as shares of the ceiling (the HUD's and the tower map's). */
    MILESTONE_SHARES: Object.freeze([0.1, 0.25, 0.5, 0.75, 1]),
});

/** @param {number} value @param {number} min @param {number} max */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** @param {number} edge0 @param {number} edge1 @param {number} x */
export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * @typedef {object} ViewMetrics
 * @property {number} height rows from the floor to the view's centre
 * @property {number} summitHeight rows built (0 for an empty floor)
 * @property {number} riseRows rows the view is above home (negative: below)
 * @property {number} sky 0..1 how much night sky has come down
 * @property {number} deep 0..DEEP_MAX how much depth haze has risen
 * @property {number} rise -1..1 the signal's saturating place
 * @property {number} aboveSummit rows the view's centre is above the summit (negative: below)
 */

/**
 * @param {{top: number, home: number, visibleRows: number, boardLength: number, summitRow: number}} view
 *   top: the camera's first row; home: the camera's first row at play; summitRow: the highest
 *   row with a block (boardLength when none)
 * @returns {ViewMetrics}
 */
export function viewMetrics({
    top, home, visibleRows, boardLength, summitRow,
}) {
    const rows = visibleRows > 0 ? visibleRows : 20;
    const length = Number.isFinite(boardLength) ? boardLength : 0;
    const centre = top + rows / 2;
    const height = Math.max(0, length - centre);
    const summitHeight = Number.isFinite(summitRow) && summitRow < length ? length - summitRow : 0;
    const riseRows = (Number.isFinite(home) ? home : top) - top;
    return {
        height,
        summitHeight,
        riseRows,
        sky: smoothstep(ASCENT.SKY_FROM_ROWS, ASCENT.SKY_FULL_ROWS, riseRows),
        deep: ASCENT.DEEP_MAX * smoothstep(ASCENT.DEEP_FROM_ROWS, ASCENT.DEEP_FULL_ROWS, -riseRows),
        rise: Math.tanh(riseRows / ASCENT.RISE_ROWS),
        aboveSummit: height - summitHeight,
    };
}

/**
 * How far the theme layer moves (CSS px, + down) while the view is `riseRows` above home: a
 * slow parallax at first that eases into a cap, so the world sinks as you rise and lifts a
 * little as you descend.
 * @param {number} riseRows @param {number} rowPx the board's row height on screen
 * @param {number} viewportHeight
 */
export function themeShift(riseRows, rowPx, viewportHeight) {
    if (!(rowPx > 0) || !(viewportHeight > 0) || !Number.isFinite(riseRows)) return 0;
    const raw = riseRows * rowPx * ASCENT.THEME_PARALLAX;
    const cap = (raw > 0 ? ASCENT.THEME_SINK_CAP : ASCENT.THEME_LIFT_CAP) * viewportHeight;
    return cap * Math.tanh(raw / cap);
}

/**
 * The multiples of `step` passed going from `from` to `to` (either way), in the order passed.
 * @param {number} from @param {number} to @param {number} step
 * @returns {number[]}
 */
export function crossings(from, to, step) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(step > 0) || from === to) return [];
    const out = [];
    if (to > from) {
        for (let m = Math.floor(from / step + 1) * step; m <= to; m += step) out.push(m);
    } else {
        // Going down, a line is passed when the height falls below it.
        for (let m = Math.ceil(to / step) * step; m < from; m += step) out.unshift(m);
    }
    // The floor (0) is no tick; a jump across hundreds of rows reports the first few.
    return out.filter((m) => m > 0).slice(0, 64);
}

/**
 * The milestone heights for a ceiling (the HUD's: 100, 250, 500, 750, 1000 for 1,000 rows).
 * @param {number} maxRows
 * @returns {number[]}
 */
export function milestoneHeights(maxRows) {
    const ceiling = Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 1000;
    return [...new Set(ASCENT.MILESTONE_SHARES.map((share) => Math.max(1, Math.round(ceiling * share))))];
}
