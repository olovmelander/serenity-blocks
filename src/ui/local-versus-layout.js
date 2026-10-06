// @ts-check
/**
 * @fileoverview Board size and arrangement for local versus (LocalMultiplayerMode).
 *
 * Every player has a station: a name plate, the next queue in a row over the well's
 * open top, the board with its garbage meter on the left, and one line of stats under
 * it. The block size is the largest that fits the window below the top row (the match
 * bar and the controls tray). Stations wrap onto two rows only where that gives the
 * bigger board (tall windows).
 *
 * public/styles/keystone-versus.css draws the same sizes from the CSS variables
 * LocalMultiplayerMode sets from this result, so the two never disagree.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Board grid size. */
export const VERSUS_COLS = 10;
export const VERSUS_ROWS = 20;

/** Fixed chrome around a board, in px at unit 1 (unit scales with the block). */
export const VERSUS_CHROME = Object.freeze({
    plate: 48, // name plate
    plateGap: 8,
    queueGap: 8, // between the queue and the well
    meta: 20, // stats line under the board
    metaGap: 6,
    topGap: 12, // between the top row and the stations
    rowGap: 20, // between two rows of stations
    minimap: 63, // Last Standing's minimap column (55 + gap)
});

/** Plate and type scale for a block size: 1 at 34 px blocks, up to 1.6 on 1440p and 4K. */
export const versusUnit = (block) => clamp(block / 34, 0.85, 1.6);

/**
 * Sizes that follow from a block size (px). Shared with the CSS through variables.
 * @param {number} block
 */
export function versusParts(block) {
    const unit = versusUnit(block);
    // The queue's tiles are wide, as pieces are: the next piece's, then the two after
    // it at four fifths. Its pieces draw at about half a block.
    const nextHeight = clamp(Math.round(block * 1.5), 30, 90);
    const nextWidth = Math.round((nextHeight * 5) / 3);
    return {
        unit,
        plate: Math.round(VERSUS_CHROME.plate * unit),
        meta: Math.round(VERSUS_CHROME.meta * unit),
        trash: clamp(Math.round(block * 0.3), 7, 14),
        nextWidth,
        nextHeight,
        laterWidth: Math.round(nextWidth * 0.8),
        laterHeight: Math.round(nextHeight * 0.8),
        nextGap: clamp(Math.round(block * 0.22), 4, 12),
    };
}

/**
 * @typedef {object} VersusLayoutInput
 * @property {number} width viewport width
 * @property {number} height viewport height
 * @property {number} players 2–4
 * @property {boolean} [infinity] Last Standing: a minimap column, queue above
 * @property {number} [inset] the window's edge inset (the tray's inset)
 * @property {number} [topRow] the top row's height from the window's top (tray bottom)
 */

/**
 * @typedef {object} VersusLayout
 * @property {number} block block size in px (integer)
 * @property {number} rows rows of stations
 * @property {number} columns stations per row
 * @property {number} gap px between stations in a row
 * @property {number} top px from the window's top to the stations' area
 * @property {number} inset px at the window's other edges
 * @property {number} stationWidth
 * @property {number} stationHeight
 */

/**
 * Station footprint for a block size.
 * @param {number} block
 * @param {boolean} [infinity]
 */
export function versusStation(block, infinity = false) {
    const p = versusParts(block);
    // The garbage channel sits flush inside the well, against the board.
    const width = p.trash + VERSUS_COLS * block + (infinity ? VERSUS_CHROME.minimap : 0);
    const height = p.plate + VERSUS_CHROME.plateGap
        + p.nextHeight + VERSUS_CHROME.queueGap
        + VERSUS_ROWS * block
        + VERSUS_CHROME.metaGap + p.meta;
    return { width, height };
}

/**
 * The largest board for the window, and how the stations are arranged.
 * @param {VersusLayoutInput} input
 * @returns {VersusLayout}
 */
export function versusLayout({
    width, height, players, infinity = false, inset = 16, topRow = 64,
}) {
    const count = clamp(Math.round(players) || 2, 1, 4);
    const top = topRow + VERSUS_CHROME.topGap;
    const gap = clamp(Math.round(width * 0.025), 16, 64);
    const fits = (block, rows) => {
        const columns = Math.ceil(count / rows);
        const station = versusStation(block, infinity);
        const totalWidth = columns * station.width + (columns - 1) * gap + 2 * inset;
        const totalHeight = top + rows * station.height + (rows - 1) * VERSUS_CHROME.rowGap + inset;
        return totalWidth <= width && totalHeight <= height;
    };
    const largest = (rows) => {
        let lo = 6;
        let hi = 80;
        if (!fits(lo, rows)) return lo;
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            if (fits(mid, rows)) lo = mid; else hi = mid;
        }
        return Math.floor(lo);
    };

    // A second row only pays on tall windows; one row reads as a line-up, so it wins
    // unless two rows give a clearly bigger board.
    const rowsOptions = count >= 2 && height > width ? [1, 2] : [1];
    const candidates = rowsOptions.map((rows) => ({ block: largest(rows), rows }));
    const preference = (c) => c.block + (c.rows === 1 ? 2 : 0);
    const chosen = candidates.reduce((best, c) => (preference(c) > preference(best) ? c : best));
    const station = versusStation(chosen.block, infinity);
    return {
        block: chosen.block,
        rows: chosen.rows,
        columns: Math.ceil(count / chosen.rows),
        gap,
        top,
        inset,
        stationWidth: station.width,
        stationHeight: station.height,
    };
}

/**
 * The window and the tray's row, measured (the tray's tokens are CSS: keystone-overlays.css).
 * @returns {{ width: number, height: number, inset: number, topRow: number }}
 */
export function readVersusViewport() {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const px = (name, fallback) => {
        const value = parseFloat(css.getPropertyValue(name));
        return Number.isFinite(value) ? value : fallback;
    };
    const inset = px('--sb-play-inset', 16);
    return {
        width: window.innerWidth,
        height: window.innerHeight,
        inset,
        topRow: inset + px('--sb-play-tray', 48),
    };
}

/**
 * Hands a layout to the stylesheet: sizes as variables on the local stage, the rows of
 * stations as a data attribute.
 * @param {HTMLElement | null} stage #multiplayer-container
 * @param {VersusLayout} layout
 */
export function applyVersusLayout(stage, layout) {
    if (!stage) return;
    const p = versusParts(layout.block);
    const vars = {
        '--lv-block': `${layout.block}px`,
        '--lv-unit': p.unit.toFixed(3),
        '--board-width': `${VERSUS_COLS * layout.block}px`,
        '--board-height': `${VERSUS_ROWS * layout.block}px`,
        '--lv-plate-h': `${p.plate}px`,
        '--lv-meta-h': `${p.meta}px`,
        '--lv-trash': `${p.trash}px`,
        '--lv-next-w': `${p.nextWidth}px`,
        '--lv-next-h': `${p.nextHeight}px`,
        '--lv-later-w': `${p.laterWidth}px`,
        '--lv-later-h': `${p.laterHeight}px`,
        '--next-piece-gap': `${p.nextGap}px`,
        '--lv-gap': `${layout.gap}px`,
        '--lv-top': `${layout.top}px`,
        '--lv-inset': `${layout.inset}px`,
        '--lv-columns': String(layout.columns),
    };
    Object.entries(vars).forEach(([name, value]) => stage.style.setProperty(name, value));
    stage.dataset.rows = String(layout.rows);
}
