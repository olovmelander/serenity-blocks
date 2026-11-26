import { COLS, ROWS } from '../constants.js';
import { settleLabelledBoard } from '../stillfall/stillfall-cascade.js';

/**
 * How strong versus players build, as a value for a board. Versus pays rows sent, which is lines
 * minus one: waves pay nothing. So a board is worth the largest clear it has ready, and what it
 * has put by for the next one: an edge column kept open, the rows beside it, its roof, and the
 * straights parked on the roof. Rows from an opponent count as rows like any other.
 * The weights come from this repo's own fit (reports/bots-versus-2026-11/fit.mjs).
 */
export const VERSUS_WEIGHTS = Object.freeze({
    vTests: 3,
    vLines: 11.36,
    vSquare: 13.97,
    vGap: 21.66,
    fill: 15.11,
    ready: 50.97,
    roof: 8.241,
    lowRoof: 18.67,
    roofGap: 0.3175,
    parked: 0.7984,
    tower: 24.38,
    material: 0.2824,
    density: 0.1582,
    bump: 12.47,
    holes: 82.53,
    height: 4.952,
    room: 3.775,
    danger: 2.254,
    attack: 40.25,
    attackSquare: 28.42,
    single: 4.996,
    small: 2.541,
    patience: 7.848,
    calm: 5.113,
    tLines: 40.36,
    tSquare: 2.414,
    kill: 150,
    opener: 300,
    right: 0.45,
    // The surface and the clears, as recorded strong players weigh them (round three). colTrans,
    // rowTrans: changes between filled and empty down each column and along each row; wellRight:
    // how far the right wall's column stands below its neighbours; wellsMid: inner columns three or
    // more below both neighbours; peak: the tallest column; readyMid: rows short of one inner cell;
    // clearHigh, clearGarbage: each line of a clear of one to four lines, by rows of stack over six
    // and by garbage rows on the board before it; big: each line of a fire past four. The surface
    // four are a quarter of what Stephen's own placements price them at (the full price lost to
    // these weights in live duels); the others stay at zero, where they leave the play as it was.
    colTrans: 34.545,
    rowTrans: 6.88,
    wellRight: 19.313,
    wellsMid: 20.448,
    peak: 0,
    readyMid: 0,
    clearHigh: 0,
    clearGarbage: 0,
    big: 0,
});

const FULL = (1 << COLS) - 1;
const SPAWN_LEFT = Math.floor(COLS / 2) - 2;
// Wide enough for a row with a wall on each side.
const bits = new Uint8Array(1 << (COLS + 2));
for (let i = 1; i < bits.length; i++) bits[i] = bits[i >> 1] + (i & 1);
const others = COLS - 1;
const EDGES = 1 | (1 << (COLS - 1));
const PAIRS = (1 << (COLS + 1)) - 1;

/**
 * The surface measures of round three (see VERSUS_WEIGHTS), weighted. The shelf's column counts
 * like any other: left out, its roof would hide whatever is dumped under it.
 */
function surface(board, w) {
    const { rows, tops, height, first } = board;
    let rowTrans = 0;
    let colTrans = 0;
    let readyMid = 0;
    let above = 0;
    for (let y = first; y < height; y++) {
        const mask = rows[y];
        const walled = 1 | (mask << 1) | (1 << (COLS + 1));
        rowTrans += bits[(walled ^ (walled >> 1)) & PAIRS];
        colTrans += bits[mask ^ above];
        above = mask;
        const missing = FULL ^ mask;
        if (bits[missing] === 1 && !(missing & EDGES)) readyMid++;
    }
    colTrans += bits[FULL ^ above];
    let peak = 0;
    let wellsMid = 0;
    for (let x = 0; x < COLS; x++) {
        peak = Math.max(peak, height - tops[x]);
        if (x > 0 && x < COLS - 1 && tops[x] - Math.max(tops[x - 1], tops[x + 1]) >= 3) wellsMid++;
    }
    const wellRight = Math.min(12, Math.max(0, tops[COLS - 1] - Math.max(tops[COLS - 2], tops[COLS - 3])));
    return peak * w.peak + readyMid * w.readyMid - colTrans * w.colTrans - rowTrans * w.rowTrans
        - wellRight * w.wellRight - wellsMid * w.wellsMid;
}

/** Whether any of the round-three surface weights is in use. */
function usesSurface(w) {
    return Boolean(w.colTrans || w.rowTrans || w.wellRight || w.wellsMid || w.peak || w.readyMid);
}

/** What an edge column has put by: rows filled beside it, the roof, straights standing on the roof. */
function shelf(board, col, w) {
    const { cells, rows, height } = board;
    const start = board.top;
    let best = 0;
    let y = height - 1;
    while (y >= start) {
        while (y >= start && cells[y * COLS + col]) y--;
        if (y < start) break;
        const bottom = y;
        while (y >= start && !cells[y * COLS + col]) y--;
        const top = y + 1;
        const roofed = y >= start;
        let fill = 0;
        let ready = 0;
        let counted = 0;
        for (let r = bottom; r >= top && counted < 10; r--, counted++) {
            const n = bits[rows[r]];
            if (!roofed && n < 5) break;
            const share = n / others;
            fill += share * share * share;
            if (n === others) ready++;
        }
        let value = fill * w.fill + ready * w.ready;
        if (roofed) {
            const depth = bottom - top + 1;
            value += Math.min(depth, 9) * w.roof - Math.max(0, 4 - depth) * w.lowRoof;
            const missing = FULL ^ rows[y];
            value -= bits[missing] * w.roofGap;
            let parked = 0;
            for (let r = y; r >= start;) {
                const id = cells[r * COLS + col];
                if (!id) { r--; continue; }
                let end = r;
                while (end - 1 >= start && cells[(end - 1) * COLS + col] === id) end--;
                if (id > 0 && r - end >= 2) parked += r - end + 1;
                r = end - 1;
            }
            value += Math.min(parked, ready) * w.parked + parked * w.tower;
        }
        if (value > best) best = value;
    }
    return best;
}

/**
 * What a versus seat plays by.
 * @typedef {{ weights: Record<string, number>, minAttackLines?: number, killRows?: number,
 *   worth?: number, flat?: boolean, roofRows?: number, opening?: boolean }} VersusPlay
 *   minAttackLines: the match's smallest attacking clear; killRows: the fewest rows that would
 *   keep some opponent's next piece from appearing; worth: what a row sent is worth (1; 0 while
 *   attacks deal nothing); flat: size earns no bonus (a hot potato's holder only counts rows);
 *   roofRows: Last Standing only, the rows of the well above the board's grid. There the piece
 *   comes in above the tower, and only the well's roof ends a player; opening: the first fire of
 *   this life is still to come (versusOpening).
 */

/** Rows a clear sends: lines minus one from the smallest attacking clear up, and the clean bonus. */
export function versusAttack(lines, perfect, minAttackLines = 2) {
    if (lines <= 0) return 0;
    return (lines >= minAttackLines ? lines - 1 : 0) + (perfect ? Math.floor((1 + lines) / 2) : 0);
}

/**
 * The fewest rows that would keep a player's next piece from appearing: their stack in the spawn
 * columns, and the rows already waiting for them, against the spawn cells just above the top.
 * @param {Array<Array<unknown>>} grid
 * @param {number} waiting
 */
export function rowsToBlockSpawn(grid, waiting) {
    let top = grid.length;
    for (let x = SPAWN_LEFT; x < SPAWN_LEFT + 4; x++) {
        let y = 0;
        while (y < top && !grid[y][x]) y++;
        top = y;
    }
    return Math.max(1, ROWS + 1 - (grid.length - top) - waiting);
}

/** A rise of this many rows can come at once (the most that wait), plus room to answer it. */
const ROOF_MARGIN = 24;

/**
 * Last Standing: the fewest rows that would lift a player's tower through the roof of the well,
 * counting the rows already waiting for them.
 * @param {Array<Array<unknown>>} grid
 * @param {number} wellRows
 * @param {number} waiting
 */
export function rowsToRoof(grid, wellRows, waiting) {
    let top = 0;
    while (top < grid.length && !grid[top].some(Boolean)) top++;
    return Math.max(1, wellRows - (grid.length - top) - waiting);
}

/** The value of a board to a versus player. `probe` is scratch. */
export function versusValue(board, play, pending, probe) {
    const w = play.weights;
    const {
        cells, rows, tops, counts, height,
    } = board;
    const left = shelf(board, 0, w);
    // Strong players keep the open column on the left wall far more often than on the right.
    const right = shelf(board, COLS - 1, w) * w.right;
    const edge = left >= right ? 0 : COLS - 1;
    let best = 0;
    let tested = 0;
    for (let y = Math.max(board.first, board.top); y < board.height && tested < w.vTests; y++) {
        const missing = FULL ^ rows[y];
        const gaps = bits[missing];
        if (!gaps || gaps > 3) continue;
        let open = true;
        for (let x = 0; x < COLS && open; x++) if ((missing & (1 << x)) && tops[x] < y) open = false;
        if (!open) continue;
        tested++;
        // Blocks keep their columns as they fall, so a clear takes at most as many lines as the
        // emptiest column then has cells. A test that cannot beat the best so far needs no settle.
        if (w.vLines >= 0 && w.vSquare >= 0) {
            let most = height;
            for (let x = 0; x < COLS; x++) most = Math.min(most, counts[x] + ((missing >> x) & 1));
            const reach = versusAttack(most, false, play.minAttackLines);
            if (reach * w.vLines + (play.flat ? 0 : reach * reach * w.vSquare) - gaps * w.vGap <= best) continue;
        }
        probe.set(cells);
        for (let x = 0; x < COLS; x++) if (missing & (1 << x)) probe[y * COLS + x] = probe.length + x + 8;
        const waves = settleLabelledBoard(probe, board.first, board.top);
        let lines = 0;
        for (const n of waves) lines += n;
        const sent = versusAttack(lines, false, play.minAttackLines);
        best = Math.max(best, sent * w.vLines + (play.flat ? 0 : sent * sent * w.vSquare) - gaps * w.vGap);
    }
    let bump = 0;
    let previous = -1;
    for (let x = 0; x < COLS; x++) {
        if (x === edge) continue;
        if (previous >= 0) bump += Math.abs(tops[x] - tops[previous]);
        previous = x;
    }
    // Cells kept empty in the edge column are the shelf's, not holes.
    const edgeHoles = height - tops[edge] - board.counts[edge];
    const centre = spawnColumnsTop(board);
    // The next piece must appear: the spawn columns against the top. In Last Standing it comes in
    // above the tower, and what ends a player is a rise through the well's roof.
    const squeeze = play.roofRows === undefined
        ? Math.max(0, (height - centre) + pending - (height - board.first - w.room))
        : Math.max(0, (height - board.top) + pending - (height + play.roofRows - ROOF_MARGIN));
    const value = best + Math.max(left, right) + board.stock * w.material + board.density * w.density
        - bump * w.bump - (board.holes - edgeHoles) * w.holes - (height - centre) * w.height - squeeze * squeeze * w.danger;
    return usesSurface(w) ? value + surface(board, w) : value;
}

/**
 * What a search reads once from the board it starts on: rows of stack over six in the spawn
 * columns, and the rows that hold garbage (at most ten).
 * @param {{ cells: Int32Array, top: number, height: number, tops: ArrayLike<number> }} board
 */
export function versusContext(board) {
    let garbage = 0;
    for (let y = board.top; y < board.height && garbage < 10; y++) {
        for (let x = 0; x < COLS; x++) {
            if (board.cells[y * COLS + x] < 0) { garbage++; break; }
        }
    }
    return { high: Math.max(0, board.height - spawnColumnsTop(board) - 6), garbage };
}

function spawnColumnsTop(board) {
    const { tops } = board;
    let top = board.height;
    for (let x = SPAWN_LEFT; x < SPAWN_LEFT + 4; x++) top = Math.min(top, tops[x]);
    return top;
}

/**
 * How little hurry there is, 0 to 1: a low stack with no rows waiting. Strong players hold a small
 * clear back on a low board and take it on a high one.
 */
export function versusCalm(board, pending, play) {
    if (pending > 0) return 0;
    // Last Standing: no hurry while the roof is far.
    if (play.roofRows !== undefined) return Math.min(1, Math.max(0, (play.roofRows + board.top - ROOF_MARGIN) / 12));
    return Math.max(0, 1 - (board.height - spawnColumnsTop(board)) / play.weights.calm);
}

/** The first fire of a life is held for this many lines... */
const OPENER_LINES = 6;
/** ...for at most this many pieces, and only while the spawn columns stand this low with what waits. */
const OPENER_PIECES = 34;
const OPENER_HEIGHT = 13;

/**
 * What a lock earns: rows sent, with a bonus for size, a cost for small change, and a cost for
 * cashing in under five lines while there is no hurry.
 */
export function versusReward(play, lines, perfect, calm = 0, context = null) {
    // Nothing sent counts now: a clear is neither earned nor held back.
    if (!lines || play.worth === 0) return 0;
    const w = play.weights;
    const sent = versusAttack(lines, perfect, play.minAttackLines);
    // A hot potato's holder wants rows now: no bonus for size, no cost for small change.
    if (play.flat) return sent * w.attack * 2;
    let reward = sent * w.attack + sent * sent * w.attackSquare;
    if (sent >= (play.killRows ?? Infinity)) reward += w.kill;
    if (lines === 1) reward -= w.single;
    else if (lines <= 3) reward -= w.small;
    if (lines < 5) reward -= calm * w.patience * (5 - lines);
    // The opening: the shelf is loaded before it is released.
    if (play.opening && lines < OPENER_LINES) reward -= w.opener * (OPENER_LINES - lines);
    // Round three: small clears on a high or garbage-filled board, and the lines of a big fire.
    if (context && lines <= 4 && (w.clearHigh || w.clearGarbage)) {
        reward += lines * (context.high * w.clearHigh + context.garbage * w.clearGarbage);
    }
    if (lines > 4 && w.big) reward += (lines - 4) * w.big;
    return reward;
}

/**
 * Whether a life is still in its opening: strong players build the shelf and park on it for some
 * twenty-five pieces, then release six lines or more. Over once a fire of five or more is made,
 * after OPENER_PIECES pieces, or when the stack and the rows waiting leave no room for it.
 * @param {{ tops: ArrayLike<number>, height: number }} board
 * @param {number} pending
 * @param {{ done: boolean, pieces: number }} life
 */
export function versusOpening(board, pending, life) {
    return !life.done && life.pieces <= OPENER_PIECES
        && (board.height - spawnColumnsTop(board)) + pending <= OPENER_HEIGHT;
}

/** What a shot another piece could make is worth now. */
export function versusTrigger(play, lines) {
    const w = play.weights;
    const sent = versusAttack(lines, false, play.minAttackLines);
    return sent * w.tLines + (play.flat ? 0 : sent * sent * w.tSquare);
}
