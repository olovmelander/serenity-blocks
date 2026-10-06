// @ts-check
/**
 * @fileoverview Board sizes and arrangement for online versus (OnlineMultiplayerMode).
 *
 * Your station is the stage's hero, in the middle of the window, in local versus'
 * anatomy (local-versus-layout.js): a name plate, the next queue over the well's open
 * top, the well with the garbage meter just outside its left wall, one line of stats.
 * Two equal columns stand beside it: on the left the field — every opponent, up to
 * seven, each a smaller station (a plate, the next piece, the well and its meter); a
 * duel's one opponent at your size — and on the right the rail (scoreboard, battle log,
 * chat). Narrow or tall windows stack: the opponents in a row over your station, no rail.
 *
 * keystone-online.css draws the same sizes from the variables applyOnlineLayout sets,
 * so the CSS and the board sizing never disagree.
 */
import { VERSUS_CHROME, versusStation } from './local-versus-layout.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** An opponent's station, smaller: chrome in px at its own unit. */
export const FIELD_CHROME = Object.freeze({
    plate: 24, // name and frags on one line
    plateGap: 4,
    queueGap: 4,
    gap: 14, // between stations in the field
});

/** The rail's width: at least this, and no wider than this when its column is wider. */
export const RAIL = Object.freeze({ min: 260, max: 400 });

/** Type scale on an opponent's station: 1 at 16 px blocks. */
export const fieldUnit = (block) => clamp(block / 16, 0.75, 1.5);

/**
 * Sizes that follow from an opponent's block size.
 * @param {number} block
 */
export function fieldParts(block) {
    const unit = fieldUnit(block);
    const nextHeight = clamp(Math.round(block * 1.4), 14, 64);
    return {
        unit,
        plate: Math.round(FIELD_CHROME.plate * unit),
        trash: clamp(Math.round(block * 0.32), 4, 12),
        meterGap: 2 + clamp(Math.round(block * 0.12), 2, 6),
        nextHeight,
        nextWidth: Math.round((nextHeight * 5) / 3),
    };
}

/**
 * An opponent's station footprint for a block size.
 * @param {number} block
 */
export function fieldStation(block) {
    const p = fieldParts(block);
    return {
        width: p.trash + p.meterGap + 10 * block,
        height: p.plate + FIELD_CHROME.plateGap + p.nextHeight + FIELD_CHROME.queueGap + 20 * block,
    };
}

/** Largest integer x in [lo, hi] with ok(x), or lo when none fits. */
function largest(lo, hi, ok) {
    if (!ok(lo)) return lo;
    let a = lo;
    let b = hi;
    while (b - a > 1) {
        const mid = Math.floor((a + b) / 2);
        if (ok(mid)) a = mid; else b = mid;
    }
    return ok(b) ? b : a;
}

/**
 * The opponents' grid for a field box: the arrangement that gives the largest block.
 * @param {number} count opponents
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @param {number} [maxBlock] no larger than this
 * @returns {{ block: number, rows: number, columns: number }}
 */
export function fieldGrid(count, boxWidth, boxHeight, maxBlock = 48) {
    let best = { block: 0, rows: 1, columns: count };
    for (let rows = 1; rows <= count; rows++) {
        const columns = Math.ceil(count / rows);
        const fits = (block) => {
            const s = fieldStation(block);
            return columns * s.width + (columns - 1) * FIELD_CHROME.gap <= boxWidth
                && rows * s.height + (rows - 1) * FIELD_CHROME.gap <= boxHeight;
        };
        const block = largest(4, Math.max(4, maxBlock), fits);
        // A tie keeps fewer rows: a line-up reads better than a stack.
        if (fits(block) && block > best.block) best = { block, rows, columns };
    }
    return best;
}

/**
 * How large the opponents' blocks may be against yours: at least `share`, at most `cap`.
 * @param {number} count opponents
 */
function fieldShares(count) {
    if (count === 1) return { share: 0.75, cap: 1 };
    if (count <= 3) return { share: 0.5, cap: 0.64 };
    if (count <= 5) return { share: 0.4, cap: 0.56 };
    return { share: 0.34, cap: 0.5 };
}

/** Small stations show the next piece alone; large ones the whole queue. */
function fieldSizeClass(block) {
    if (block >= 22) return 'l';
    if (block >= 13) return 'm';
    return 's';
}

/**
 * @typedef {object} OnlineLayoutInput
 * @property {number} width viewport width
 * @property {number} height viewport height
 * @property {number} opponents 0–7 (0: alone in the match; a spectator's: everyone, up to 7)
 * @property {number} [inset] the window's edge inset
 * @property {number} [topRow] the top row's bottom (the tray's), from the window's top
 */

/**
 * @typedef {object} OnlineLayout
 * @property {'center'|'stack'} arrangement
 * @property {number} block your board's block size (px)
 * @property {number} fieldBlock an opponent's block size (px); a duel's is yours
 * @property {number} fieldRows
 * @property {number} fieldColumns
 * @property {number} side the width of each column beside your station (0 when stacked)
 * @property {number} rail the rail's width (0: no rail)
 * @property {number} gap px between your station and the columns beside it
 * @property {number} top px from the window's top to the stage
 * @property {number} inset
 * @property {number} stationWidth your station's footprint
 * @property {number} stationHeight
 */

/**
 * The largest boards for the window, and where everything stands.
 * @param {OnlineLayoutInput} input
 * @returns {OnlineLayout}
 */
export function onlineLayout({
    width, height, opponents, inset = 16, topRow = 64,
}) {
    const count = clamp(Math.round(Number(opponents)) || 0, 0, 7);
    const top = topRow + VERSUS_CHROME.topGap;
    const narrow = width < 900 || height > width * 1.15;
    const gap = clamp(Math.round(width * 0.022), 14, 44);
    const innerWidth = width - 2 * inset;
    const stageHeight = height - top - inset;
    const result = (arrangement, block, grid, side, rail) => {
        const station = versusStation(block);
        return {
            arrangement,
            block,
            fieldBlock: grid.block,
            fieldRows: grid.rows,
            fieldColumns: grid.columns,
            side,
            rail,
            gap,
            top,
            inset,
            stationWidth: station.width,
            stationHeight: station.height,
        };
    };

    if (narrow) {
        // The opponents in a row over your station (two rows past four), no rail.
        const rows = count > 4 ? 2 : 1;
        const columns = Math.max(1, Math.ceil(count / rows));
        const fieldHeight = (block) => (count ? rows * fieldStation(block).height + (rows - 1) * FIELD_CHROME.gap : 0);
        const fieldWidth = (block) => columns * fieldStation(block).width + (columns - 1) * FIELD_CHROME.gap;
        // The field takes about a fifth of the height; your board the rest.
        const fieldBlock = count ? largest(4, 24, (b) => fieldWidth(b) <= innerWidth
            && fieldHeight(b) <= stageHeight * 0.24) : 0;
        const spare = stageHeight - (count ? fieldHeight(fieldBlock) + gap : 0);
        const block = largest(8, 64, (b) => {
            const s = versusStation(b);
            return s.width <= innerWidth && s.height <= spare;
        });
        const grid = { block: fieldBlock, rows: count ? rows : 0, columns: count ? columns : 0 };
        return result('stack', block, grid, 0, 0);
    }

    // Your station in the middle of the window; two equal columns beside it.
    const side = (block) => Math.floor((innerWidth - versusStation(block).width - 2 * gap) / 2);
    // The opponents keep at least `share` of your block, so seven of them still read as
    // boards, and at most `cap`, so yours stays the one you play; a duel's opponent
    // stands at your size when its column allows.
    const { share, cap } = fieldShares(count);
    const fieldFor = (block) => (count
        ? fieldGrid(count, side(block), stageHeight, Math.floor(block * cap))
        : { block: 0, rows: 0, columns: 0 });
    const block = largest(8, 80, (b) => versusStation(b).height <= stageHeight
        && side(b) >= RAIL.min
        && (!count || fieldFor(b).block >= Math.ceil(b * share)));
    const columnWidth = side(block);
    return result('center', block, fieldFor(block), columnWidth, clamp(columnWidth, RAIL.min, RAIL.max));
}

/**
 * Hands a layout to the stylesheet: sizes as variables on the online stage, the
 * arrangement and the field's rows and columns as data attributes.
 * @param {HTMLElement | null} stage #online-multiplayer-container
 * @param {OnlineLayout} layout
 */
export function applyOnlineLayout(stage, layout) {
    if (!stage) return;
    const fp = fieldParts(layout.fieldBlock || 8);
    const vars = {
        '--ov-block': `${layout.block}px`,
        '--ov-field-block': `${layout.fieldBlock}px`,
        '--ov-field-unit': fp.unit.toFixed(3),
        '--ov-field-plate-h': `${fp.plate}px`,
        '--ov-field-trash': `${fp.trash}px`,
        '--ov-field-meter-gap': `${fp.meterGap}px`,
        '--ov-field-next-w': `${fp.nextWidth}px`,
        '--ov-field-next-h': `${fp.nextHeight}px`,
        '--ov-field-columns': String(Math.max(1, layout.fieldColumns)),
        '--ov-field-rows': String(Math.max(1, layout.fieldRows)),
        '--ov-rail': `${layout.rail}px`,
        '--ov-side': `${layout.side}px`,
        '--ov-gap': `${layout.gap}px`,
        '--ov-top': `${layout.top}px`,
        '--ov-inset': `${layout.inset}px`,
    };
    Object.entries(vars).forEach(([name, value]) => stage.style.setProperty(name, value));
    stage.dataset.arrangement = layout.arrangement;
    stage.dataset.fieldSize = fieldSizeClass(layout.fieldBlock || 0);
}
