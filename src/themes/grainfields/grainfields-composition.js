/**
 * Grainfields — composition (CPU only, three-free).
 *
 * The frame around the card: the barley filling the bottom of the frame up to its crest; on its
 * left Lapporten's gate with the sun's shafts pouring through it and a stand of larch; on its
 * right the right fell's long ridge and a shelterbelt along the skyline; above, the storm deck.
 *
 * The live gameplay layout as screen fractions (y down): the board cards, the boards inside them
 * and the solo HUD, read from the DOM (or the stylesheet's own formulas before a card shows).
 * Events aim at the part of the field that shows beside the card, never through it; the post's
 * calm zones follow the same rects.
 */

/** The playfield every board canvas shows. */
export const BOARD_GRID = Object.freeze({ columns: 10, rows: 20, hiddenRows: 4 });

/** Director / layout player slots: 0 = the solo board, 1..4 = local-multiplayer boards. */
export const PLAYER_SLOTS = 5;

/**
 * Gameplay boards (every board in index.html carries data-player; the lobby's avatar cards reuse
 * .player-card without it), the solo stats bar and the board canvases. The other overhauled
 * themes' selectors, plus online play's board, which reports its events as slot 0.
 */
export const BOARD_SELECTOR = '.player-card[data-player]';
export const HUD_SELECTOR = '.single-player-stats-bar';
export const SOLO_CANVAS_SELECTORS = Object.freeze([
    '#phaser-game-container canvas',
    '#main-game-canvas',
    '#single-player-game-canvas',
    '#online-main-board canvas',
]);
export const playerCanvasSelector = (player) => `#p${player}-phaser-container canvas`;

/** A CSS-px rect → screen fractions (x0, y0, x1, y1; y down). */
function toFractions(r, W, H) {
    return {
        x0: r.left / W, y0: r.top / H, x1: r.right / W, y1: r.bottom / H,
    };
}

/** The ordinary solo well before its DOM rects are available (keystone-solo.css). */
export function fallbackLayout(width, height) {
    const W = Math.max(1, width || 1);
    const H = Math.max(1, height || 1);
    const portrait = W <= H;
    const head = W <= 640 ? 64 : 74;
    const next = Math.min(62, Math.max(30, H * 0.062));
    const side = Math.min(240, Math.max(196, W * 0.15));
    const gap = Math.min(40, Math.max(20, W * 0.024));
    const strip = portrait ? Math.min(66, Math.max(52, H * 0.07)) : 0;
    const below = portrait ? strip + 12 : 0;
    const room = H - head - next - 10 - below - 22;
    const heightBudget = portrait ? room : Math.min(room, Math.max(520, room * 0.85));
    const widthBudget = portrait ? W - 32 : W - 2 * (16 + side + gap);
    const board = Math.max(140, Math.min(640, heightBudget / 2, widthBudget));
    const column = next + 10 + board * 2 + below;
    const top = Math.max(head, Math.min((H - column) / 2, H - 22 - column));
    const boardTop = top + next + 10;
    const boardBottom = boardTop + 2 * board;
    const left = (W - board) / 2;
    const right = left + board;
    const hud = portrait
        ? {
            left, right, top: boardBottom + 12, bottom: boardBottom + 12 + strip,
        }
        : {
            left: right + gap, right: right + gap + side, top: boardTop, bottom: boardTop + Math.min(280, board * 2),
        };
    const boards = new Array(PLAYER_SLOTS).fill(null);
    boards[0] = toFractions({
        left, right, top: boardTop, bottom: boardBottom,
    }, W, H);
    return {
        cardCount: 0,
        cards: [toFractions({
            left: left - 3, right: right + 3, top, bottom: boardBottom + 3,
        }, W, H)],
        hud: toFractions(hud, W, H),
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
    const line = (Math.max(0, Math.min(BOARD_GRID.rows - 1, row)) + 0.5) / BOARD_GRID.rows;
    out.y = board.y0 + (board.y1 - board.y0) * line;
    return out;
}

const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/**
 * True outside every card and HUD, including their margin. A numeric margin is in screen
 * fractions on both axes; { x, y } supports equal physical-pixel padding on non-square screens.
 * Invalid points are rejected so a missing projection cannot accidentally emit a visible chip.
 */
export function outsideKeepOut(layout, point, margin = 0.012) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
    const mx = Math.max(0, finite(typeof margin === 'number' ? margin : margin?.x, 0.012));
    const my = Math.max(0, finite(typeof margin === 'number' ? margin : margin?.y, 0.012));
    const rects = [...(layout?.cards || []), layout?.hud].filter(Boolean);
    return rects.every((r) => point.x < r.x0 - mx || point.x > r.x1 + mx
        || point.y < r.y0 - my || point.y > r.y1 + my);
}
