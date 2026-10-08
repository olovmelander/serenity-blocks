/**
 * Aether Tides — composition (CPU only, three-free).
 *
 * The gameplay card stands in the middle of the nebula like a pane of dark glass. The picture is
 * built for what stays visible around it: the river of gas crosses the frame behind the card, the
 * Tide Star and its companion circle it, and the open sky fills the two far corners.
 *
 * This module reads the live card, board and HUD rects (screen fractions, y down) and maps board
 * columns and rows onto the screen; the world turns those into tide-space points (where a locking
 * cell pours its colour into the fluid, where a cleared row's jets leave the card).
 */

/** The playfield every board canvas shows. */
export const BOARD_GRID = Object.freeze({ columns: 10, rows: 20, hiddenRows: 4 });

/** Director / layout player slots: 0 = the solo board, 1..4 = local-multiplayer boards. */
export const PLAYER_SLOTS = 5;

/**
 * Gameplay boards (every board in index.html carries data-player; the lobby's avatar cards reuse
 * .player-card without it), the solo stats bar and the board canvases. Same selectors as the
 * other overhauled themes.
 */
export const BOARD_SELECTOR = '.player-card[data-player]';
export const HUD_SELECTOR = '.single-player-stats-bar';
export const SOLO_CANVAS_SELECTORS = Object.freeze([
    '#phaser-game-container canvas',
    '#main-game-canvas',
    '#single-player-game-canvas',
]);
export const playerCanvasSelector = (player) => `#p${player}-phaser-container canvas`;

/** A CSS-px rect → screen fractions (x0, y0, x1, y1; y down). */
function toFractions(r, W, H) {
    return {
        x0: r.left / W, y0: r.top / H, x1: r.right / W, y1: r.bottom / H,
    };
}

/**
 * The solo layout from the stylesheet's own formulas (public/styles/main.css), used before a card
 * is on screen: board = min(clamp(220, 22vw, 300), (100vh − 250)/2), card ≈ 1.19·board wide and
 * 2·board + 158 tall with the playfield seated at its foot, the stats bar 60 px right of the stage.
 */
export function fallbackLayout(width, height) {
    const W = Math.max(1, width || 1);
    const H = Math.max(1, height || 1);
    const board = Math.max(120, Math.min(Math.max(220, Math.min(0.22 * W, 300)), (H - 250) / 2));
    const cw = 1.19 * board;
    const ch = 2 * board + 158;
    const stage = Math.min(Math.max(300, Math.min(0.35 * W, 400)), (H - 200) / 2);
    const hx0 = W / 2 + stage / 2 + 60;
    const hh = Math.min(385, H * 0.5);
    const cardBottom = H / 2 + ch / 2;
    const boards = new Array(PLAYER_SLOTS).fill(null);
    boards[0] = toFractions({
        left: W / 2 - board / 2, right: W / 2 + board / 2, top: cardBottom - 24 - 2 * board, bottom: cardBottom - 24,
    }, W, H);
    return {
        cardCount: 0,
        cards: [toFractions({
            left: W / 2 - cw / 2, right: W / 2 + cw / 2, top: H / 2 - ch / 2, bottom: cardBottom,
        }, W, H)],
        hud: toFractions({
            left: hx0, right: hx0 + 140, top: H / 2 - hh / 2, bottom: H / 2 + hh / 2,
        }, W, H),
        boards,
    };
}

/**
 * Read the visible gameplay rects from the DOM (screen fractions). Returns null when no board is
 * visible (menus, boot, the meditation mode): the world then aims its events at the fallback
 * board and the post keeps its calm rects off.
 */
export function readLayoutRects(doc = globalThis.document, win = globalThis.window) {
    if (!doc || !win || typeof doc.querySelectorAll !== 'function') return null;
    const W = Math.max(1, win.innerWidth || 1);
    const H = Math.max(1, win.innerHeight || 1);
    const visibleRect = (el) => {
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        const r = el.getBoundingClientRect();
        if (!(r.width > 8 && r.height > 8)) return null;
        if (r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) return null;
        const cs = typeof win.getComputedStyle === 'function' ? win.getComputedStyle(el) : null;
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05)) return null;
        return r;
    };
    const cards = [];
    doc.querySelectorAll(BOARD_SELECTOR).forEach((el) => {
        const r = visibleRect(el);
        if (r) cards.push(toFractions(r, W, H));
    });
    if (!cards.length) return null;
    const boards = new Array(PLAYER_SLOTS).fill(null);
    for (let i = 0; i < SOLO_CANVAS_SELECTORS.length && !boards[0]; i++) {
        const r = visibleRect(doc.querySelector(SOLO_CANVAS_SELECTORS[i]));
        if (r) boards[0] = toFractions(r, W, H);
    }
    for (let player = 1; player < PLAYER_SLOTS; player++) {
        const r = visibleRect(doc.querySelector(playerCanvasSelector(player)));
        if (r) boards[player] = toFractions(r, W, H);
    }
    const hudRect = visibleRect(doc.querySelector(HUD_SELECTOR));
    return {
        cardCount: cards.length,
        cards,
        hud: hudRect ? toFractions(hudRect, W, H) : null,
        boards,
    };
}

/** True when two layout reads differ by more than eps (screen fractions). */
export function layoutsDiffer(a, b, eps = 0.004) {
    if (!a || !b) return a !== b;
    if (a.cardCount !== b.cardCount || a.cards.length !== b.cards.length) return true;
    const rectDiff = (r, s) => {
        if (!r || !s) return r !== s;
        return Math.abs(r.x0 - s.x0) > eps || Math.abs(r.y0 - s.y0) > eps
            || Math.abs(r.x1 - s.x1) > eps || Math.abs(r.y1 - s.y1) > eps;
    };
    for (let i = 0; i < a.cards.length; i++) {
        if (rectDiff(a.cards[i], b.cards[i])) return true;
    }
    for (let i = 0; i < PLAYER_SLOTS; i++) {
        if (rectDiff(a.boards?.[i] ?? null, b.boards?.[i] ?? null)) return true;
    }
    return rectDiff(a.hud, b.hud);
}

/** The board for a director player slot: its own canvas, else the first board on screen. */
export function boardFor(layout, player = 0) {
    if (!layout?.boards) return null;
    const own = layout.boards[player];
    if (own) return own;
    for (let i = 0; i < layout.boards.length; i++) {
        if (layout.boards[i]) return layout.boards[i];
    }
    return null;
}

/** The union of every card (screen fractions), or null. */
export function cardUnion(layout) {
    const cards = layout?.cards;
    if (!cards?.length) return null;
    const u = { ...cards[0] };
    for (let i = 1; i < cards.length; i++) {
        u.x0 = Math.min(u.x0, cards[i].x0);
        u.y0 = Math.min(u.y0, cards[i].y0);
        u.x1 = Math.max(u.x1, cards[i].x1);
        u.y1 = Math.max(u.y1, cards[i].y1);
    }
    return u;
}

/**
 * Where on screen a board column / row is (screen fractions, y down).
 * `u` = fraction across the board's ten columns; `row` = visible row (0 = top, 19 = floor),
 * measured to the row's centre line.
 */
export function boardPoint(board, u, row, out = { x: 0.5, y: 0.5 }) {
    out.x = board.x0 + (board.x1 - board.x0) * Math.max(0, Math.min(1, u));
    const r = Math.max(0, Math.min(BOARD_GRID.rows - 1, row));
    out.y = board.y0 + (board.y1 - board.y0) * ((r + 0.5) / BOARD_GRID.rows);
    return out;
}

/** A screen-fraction rect (y down) as a tide-space rect: x in [−aspect, aspect], y in [−1, 1]. */
export function rectToTide(rect, aspect, out = {
    x0: 0, y0: 0, x1: 0, y1: 0,
}) {
    out.x0 = (rect.x0 - 0.5) * 2 * aspect;
    out.x1 = (rect.x1 - 0.5) * 2 * aspect;
    out.y0 = (rect.y0 - 0.5) * 2;
    out.y1 = (rect.y1 - 0.5) * 2;
    return out;
}

/** The card a board sits in (the first card that contains the board's centre), else the first card. */
export function cardFor(layout, board) {
    const cards = layout?.cards;
    if (!cards?.length) return null;
    if (board) {
        const cx = (board.x0 + board.x1) * 0.5;
        const cy = (board.y0 + board.y1) * 0.5;
        for (let i = 0; i < cards.length; i++) {
            const c = cards[i];
            if (cx >= c.x0 && cx <= c.x1 && cy >= c.y0 && cy <= c.y1) return c;
        }
    }
    return cards[0];
}

/**
 * Where a locked piece's echo goes: the piece's own footprint, moved straight out of its card
 * into open sky, so the echo keeps the piece's shape and its row (or its columns).
 *
 * All rects are tide space. `box` is the piece's footprint on the board, `card` its card,
 * `obstacles` everything else that hides the sky (other cards, the HUD). Tries the preferred side
 * first, then the other side, then above or below (nearest first); a side is taken only if the
 * whole footprint fits between the last obstacle and the edge of the screen. If nothing fits the
 * echo stays where the piece is.
 *
 * @returns {{ dx: number, dy: number, nx: number, ny: number, placed: boolean }} the move, and the
 *          unit direction out of the card
 */
export function placeEcho({
    box, card, obstacles = [], aspect, gap = 0.04, prefer = -1,
}, out = {
    dx: 0, dy: 0, nx: 0, ny: 0, placed: false,
}) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    const inRows = (o) => o.y0 < box.y1 + gap && o.y1 > box.y0 - gap;
    const inColumns = (o) => o.x0 < box.x1 + gap && o.x1 > box.x0 - gap;
    const set = (dx, dy, nx, ny, placed) => {
        out.dx = dx;
        out.dy = dy;
        out.nx = nx;
        out.ny = ny;
        out.placed = placed;
        return out;
    };
    const sideways = (dir) => {
        let edge = dir < 0 ? card.x0 : card.x1;
        // Anything standing so close beyond the edge that the footprint cannot sit before it is
        // stepped past (the HUD beside the card, a neighbouring board).
        for (let pass = 0; pass < 4; pass++) {
            let moved = false;
            for (let i = 0; i < obstacles.length; i++) {
                const o = obstacles[i];
                if (!inRows(o)) continue;
                if (dir < 0 && o.x0 < edge - 1e-4 && o.x1 > edge - (w + 2 * gap)) {
                    edge = o.x0;
                    moved = true;
                } else if (dir > 0 && o.x1 > edge + 1e-4 && o.x0 < edge + (w + 2 * gap)) {
                    edge = o.x1;
                    moved = true;
                }
            }
            if (!moved) break;
        }
        const room = dir < 0 ? (edge - gap) + aspect : aspect - (edge + gap);
        if (room < w + gap * 0.5) return false;
        set(dir < 0 ? edge - gap - box.x1 : edge + gap - box.x0, 0, dir, 0, true);
        return true;
    };
    const upright = (dir) => {
        let edge = dir < 0 ? card.y0 : card.y1;
        for (let pass = 0; pass < 4; pass++) {
            let moved = false;
            for (let i = 0; i < obstacles.length; i++) {
                const o = obstacles[i];
                if (!inColumns(o)) continue;
                if (dir < 0 && o.y0 < edge - 1e-4 && o.y1 > edge - (h + 2 * gap)) {
                    edge = o.y0;
                    moved = true;
                } else if (dir > 0 && o.y1 > edge + 1e-4 && o.y0 < edge + (h + 2 * gap)) {
                    edge = o.y1;
                    moved = true;
                }
            }
            if (!moved) break;
        }
        const room = dir < 0 ? (edge - gap) + 1 : 1 - (edge + gap);
        if (room < h + gap * 0.5) return false;
        set(0, dir < 0 ? edge - gap - box.y1 : edge + gap - box.y0, 0, dir, true);
        return true;
    };
    const first = prefer > 0 ? 1 : -1;
    if (sideways(first) || sideways(-first)) return out;
    const nearer = (box.y0 + box.y1) * 0.5 < (card.y0 + card.y1) * 0.5 ? -1 : 1;
    if (upright(nearer) || upright(-nearer)) return out;
    return set(0, 0, first, 0, false);
}
