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
});

const FULL = (1 << COLS) - 1;
const SPAWN_LEFT = Math.floor(COLS / 2) - 2;
const bits = new Uint8Array(FULL + 1);
for (let i = 1; i <= FULL; i++) bits[i] = bits[i >> 1] + (i & 1);
const others = COLS - 1;

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
 *   worth?: number, flat?: boolean, roofRows?: number }} VersusPlay
 *   minAttackLines: the match's smallest attacking clear; killRows: the fewest rows that would
 *   keep some opponent's next piece from appearing; worth: what a row sent is worth (1; 0 while
 *   attacks deal nothing); flat: size earns no bonus (a hot potato's holder only counts rows);
 *   roofRows: Last Standing only, the rows of the well above the board's grid. There the piece
 *   comes in above the tower, and only the well's roof ends a player.
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
    const { cells, rows, tops } = board;
    const left = shelf(board, 0, w);
    const right = shelf(board, COLS - 1, w);
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
    const { height } = board;
    const edgeHoles = height - tops[edge] - board.counts[edge];
    const centre = spawnColumnsTop(board);
    // The next piece must appear: the spawn columns against the top. In Last Standing it comes in
    // above the tower, and what ends a player is a rise through the well's roof.
    const squeeze = play.roofRows === undefined
        ? Math.max(0, (height - centre) + pending - (height - board.first - w.room))
        : Math.max(0, (height - board.top) + pending - (height + play.roofRows - ROOF_MARGIN));
    return best + Math.max(left, right) + board.stock * w.material + board.density * w.density
        - bump * w.bump - (board.holes - edgeHoles) * w.holes - (height - centre) * w.height - squeeze * squeeze * w.danger;
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

/**
 * What a lock earns: rows sent, with a bonus for size, a cost for small change, and a cost for
 * cashing in under five lines while there is no hurry.
 */
export function versusReward(play, lines, perfect, calm = 0) {
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
    return reward;
}

/** What a shot another piece could make is worth now. */
export function versusTrigger(play, lines) {
    const w = play.weights;
    const sent = versusAttack(lines, false, play.minAttackLines);
    return sent * w.tLines + (play.flat ? 0 : sent * sent * w.tSquare);
}
