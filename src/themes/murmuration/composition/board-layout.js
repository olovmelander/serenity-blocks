/**
 * Murmuration — where the boards are (CPU only, three-free).
 *
 * The swarm's waves start where play happens: under the piece that locked, along the rows
 * that cleared. This module finds a board canvas on screen and maps a board column and
 * row onto the window.
 */

/** The playfield every board canvas shows. */
export const BOARD_GRID = Object.freeze({ columns: 10, rows: 20, hiddenRows: 4 });

/** Director player slots: 0 = the solo board, 1..4 = local-multiplayer boards. */
export const PLAYER_SLOTS = 5;

/** The board canvases, in the order the theme has always looked for them. */
export const BOARD_CANVAS_SELECTOR = [
    '#phaser-game-container canvas', '#online-main-board canvas', '.phaser-board-container canvas',
].join(', ');
export const playerCanvasSelector = (player) => `#p${player}-phaser-container canvas`;

/** The solo board's usual place when none is on screen: a tall rect in the middle. */
export const FALLBACK_BOARD = Object.freeze({
    x0: 0.38, y0: 0.18, x1: 0.62, y1: 0.82,
});

function visibleRect(el, win) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    const style = typeof win.getComputedStyle === 'function' ? win.getComputedStyle(el) : null;
    if (style && (style.visibility === 'hidden' || style.visibility === 'collapse')) return null;
    return r;
}

/**
 * The board canvas for a player as window fractions (x0, y0, x1, y1; y down), or null.
 * Player 0 — and any player without a canvas of their own — gets the first visible board.
 */
export function readBoardRect(player = 0, doc = globalThis.document, win = globalThis.window) {
    if (!doc || !win || typeof doc.querySelectorAll !== 'function') return null;
    const W = Math.max(1, win.innerWidth || 1);
    const H = Math.max(1, win.innerHeight || 1);
    let rect = null;
    if (player > 0 && typeof doc.querySelector === 'function') {
        rect = visibleRect(doc.querySelector(playerCanvasSelector(player)), win);
    }
    if (!rect) {
        const boards = doc.querySelectorAll(BOARD_CANVAS_SELECTOR);
        for (let i = 0; i < boards.length && !rect; i += 1) rect = visibleRect(boards[i], win);
    }
    if (!rect) return null;
    return {
        x0: rect.left / W, y0: rect.top / H, x1: rect.right / W, y1: rect.bottom / H,
    };
}

/**
 * Where on screen a board column / row is (window fractions, y down).
 * `u` = fraction across the board's columns; `row` = visible row (0 = top, 19 = floor),
 * measured to the row's centre line.
 */
export function boardPoint(board, u, row, out = { x: 0.5, y: 0.5 }) {
    const b = board || FALLBACK_BOARD;
    const clampedRow = Math.max(0, Math.min(BOARD_GRID.rows - 1, row));
    out.x = b.x0 + (b.x1 - b.x0) * Math.max(0, Math.min(1, u));
    out.y = b.y0 + (b.y1 - b.y0) * ((clampedRow + 0.5) / BOARD_GRID.rows);
    return out;
}
