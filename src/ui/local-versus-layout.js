// @ts-check
/**
 * @fileoverview Board size and arrangement for local versus (LocalMultiplayerMode).
 *
 * Every player has a station: a name plate, the board with its garbage meter on the
 * left and the next queue beside it or above it, and one line of stats under it. The
 * block size is the largest that fits the window below the top row (the match bar and
 * the controls tray). The queue goes beside the board when that gives the bigger board
 * (two or three players on a wide window, where height is short) and above it when
 * width is short (four players, narrow windows). Stations wrap onto two rows only
 * where that gives the bigger board (tall windows).
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
    meta: 20, // stats line under the board
    metaGap: 6,
    queueGap: 8, // queue above the board
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
    const highlight = clamp(block * 2.2, 44, 132);
    return {
        unit,
        plate: Math.round(VERSUS_CHROME.plate * unit),
        meta: Math.round(VERSUS_CHROME.meta * unit),
        trash: clamp(Math.round(block * 0.26), 6, 12),
        gutter: clamp(Math.round(block * 0.2), 4, 8),
        nextHighlight: highlight,
        nextPiece: clamp(block * 1.9, 38, 112),
        nextGap: clamp(block * 0.25, 4, 14),
        // The queue beside the board: its widest tile and a little air.
        queueColumn: highlight + 8,
        // The queue above the board: the tallest tile and the tray's padding.
        queueRow: highlight + 2 * clamp(block * 0.25, 4, 14),
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
 * @property {'side'|'top'} queue where the next queue sits
 * @property {number} rows rows of stations
 * @property {number} columns stations per row
 * @property {number} gap px between stations in a row
 * @property {number} top px from the window's top to the stations' area
 * @property {number} inset px at the window's other edges
 * @property {number} stationWidth
 * @property {number} stationHeight
 */

/**
 * Station footprint for a block size and arrangement.
 * @param {number} block
 * @param {'side'|'top'} queue
 * @param {boolean} infinity
 */
export function versusStation(block, queue, infinity = false) {
    const p = versusParts(block);
    const board = VERSUS_COLS * block;
    const width = p.trash + p.gutter + board
        + (queue === 'side' ? p.gutter + p.queueColumn : 0)
        + (infinity ? VERSUS_CHROME.minimap : 0);
    const height = p.plate + VERSUS_CHROME.plateGap
        + (queue === 'top' ? p.queueRow + VERSUS_CHROME.queueGap : 0)
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
    const fits = (block, queue, rows) => {
        const columns = Math.ceil(count / rows);
        const station = versusStation(block, queue, infinity);
        const totalWidth = columns * station.width + (columns - 1) * gap + 2 * inset;
        const totalHeight = top + rows * station.height + (rows - 1) * VERSUS_CHROME.rowGap + inset;
        return totalWidth <= width && totalHeight <= height;
    };
    const largest = (queue, rows) => {
        let lo = 6;
        let hi = 80;
        if (!fits(lo, queue, rows)) return lo;
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            if (fits(mid, queue, rows)) lo = mid; else hi = mid;
        }
        return Math.floor(lo);
    };

    /** @type {Array<'side'|'top'>} */
    const queues = infinity ? ['top'] : ['side', 'top'];
    // A second row only pays on tall windows; one row reads as a line-up.
    const rowsOptions = count >= 2 && height > width ? [1, 2] : [1];
    const candidates = rowsOptions.flatMap((rows) => queues.map((queue) => ({
        block: largest(queue, rows), queue, rows,
    })));
    // The queue beside the board is the genre's reading order and one row reads as a
    // line-up, so either wins unless the other gives a clearly bigger board.
    const preference = (c) => c.block + (c.queue === 'side' ? 1.5 : 0) + (c.rows === 1 ? 2 : 0);
    const chosen = candidates.reduce((best, c) => (preference(c) > preference(best) ? c : best));
    const station = versusStation(chosen.block, chosen.queue, infinity);
    return {
        block: chosen.block,
        queue: chosen.queue,
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
 * Hands a layout to the stylesheet: sizes as variables on the local stage, the queue's
 * place and the station grid as data attributes.
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
        '--lv-gutter': `${p.gutter}px`,
        '--lv-queue-col': `${p.queueColumn}px`,
        '--next-piece-size': `${p.nextPiece}px`,
        '--next-piece-highlight-size': `${p.nextHighlight}px`,
        '--next-piece-gap': `${p.nextGap}px`,
        '--lv-gap': `${layout.gap}px`,
        '--lv-top': `${layout.top}px`,
        '--lv-inset': `${layout.inset}px`,
        '--lv-columns': String(layout.columns),
    };
    Object.entries(vars).forEach(([name, value]) => stage.style.setProperty(name, value));
    stage.dataset.queue = layout.queue;
    stage.dataset.rows = String(layout.rows);
}
