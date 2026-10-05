/**
 * Astral Weave — composition (CPU only, three-free).
 *
 * "The Loom of Heaven." A monumental hoop hangs in deep space with the gameplay card at its
 * heart, strung with a string-art weave whose envelope blooms in the two side zones. The card
 * covers the centre column, so the picture is built for what stays visible:
 *
 *   SIDES  — the hoop's flanks and the weave's cusps (the petals of the rosette point inward
 *            at the card from left and right), and the weft threads leaving the board rows.
 *   ABOVE  — the crown of the hoop, where a four-line clear gathers the whole weave.
 *   AROUND — the warp: anchor threads running from the hoop out past the edges of the frame.
 *
 * The camera never moves the loom off the card: the loom is solved in SCREEN space from the live
 * card rect (or the stylesheet's own formulas before a card exists) and then placed on the
 * z = 0 plane, where one view height is exactly VIEW_HEIGHT world units.
 *
 * Units: "view units" are fractions of the view height, origin at the screen centre, x right,
 * y up — so a layout solved here is independent of resolution and only depends on the aspect.
 */

const DEG = Math.PI / 180;

/** The rest camera: on the +Z axis, looking down −Z at the loom plane (z = 0). */
export const REST_RIG = Object.freeze({
    fov: 50,
    distance: 10,
    near: 0.2,
    far: 120,
});

/** World height of the z = 0 plane as seen by the rest camera. */
export const VIEW_HEIGHT = 2 * REST_RIG.distance * Math.tan((REST_RIG.fov * DEG) / 2);

/** The playfield every board canvas shows. */
export const BOARD_GRID = Object.freeze({ columns: 10, rows: 20, hiddenRows: 4 });

/** Director / layout player slots: 0 = the solo board, 1..4 = local-multiplayer boards. */
export const PLAYER_SLOTS = 5;

/** The hoop never grows past this fraction of the view height (its crown stays near the frame). */
export const LOOM_MAX_RADIUS = 0.58;
/** How far into the free room beside / above the card the hoop reaches. */
export const LOOM_SIDE_REACH = 0.78;
export const LOOM_VERTICAL_REACH = 0.55;

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
 * visible (menus, boot, the meditation mode): the world then keeps the fallback loom and the post
 * keeps its calm rects off.
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

/** The board that owns the weft rows: the solo board, else the lowest-numbered local board. */
export function primaryBoard(layout) {
    if (!layout?.boards) return null;
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
 * Solve the hoop from the card(s): centred on them, its rim running through whichever free zone
 * is roomier — the sides on a landscape screen, the strips above and below on a portrait one.
 * Returns view units ({ cx, cy, radius }; see the file header).
 */
export function solveLoom(aspect, layout, out = { cx: 0, cy: 0, radius: LOOM_MAX_RADIUS }) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const card = cardUnion(layout);
    if (!card) {
        out.cx = 0;
        out.cy = 0;
        out.radius = Math.min(LOOM_MAX_RADIUS, a * 0.46);
        return out;
    }
    const halfW = a / 2;
    const cardHalfW = Math.max(0, (card.x1 - card.x0) * 0.5 * a);
    const cardHalfH = Math.max(0, (card.y1 - card.y0) * 0.5);
    // The hoop follows the card, but never drags its rim out of the frame on one side.
    const cx = Math.max(-halfW * 0.35, Math.min(halfW * 0.35, ((card.x0 + card.x1) * 0.5 - 0.5) * a));
    const cy = Math.max(-0.12, Math.min(0.12, 0.5 - (card.y0 + card.y1) * 0.5));
    const sideRoom = Math.max(0, halfW - Math.abs(cx) - cardHalfW);
    const verticalRoom = Math.max(0, 0.5 - Math.abs(cy) - cardHalfH);
    const radius = sideRoom >= verticalRoom
        ? cardHalfW + LOOM_SIDE_REACH * sideRoom
        : cardHalfH + LOOM_VERTICAL_REACH * verticalRoom;
    out.cx = cx;
    out.cy = cy;
    out.radius = Math.max(0.2, Math.min(LOOM_MAX_RADIUS, radius));
    return out;
}

/** Screen fraction (y down) → loom-local coordinates (the hoop is the unit circle, y up). */
export function screenToLoom(sx, sy, aspect, loom, out = { x: 0, y: 0 }) {
    out.x = ((sx - 0.5) * aspect - loom.cx) / loom.radius;
    out.y = ((0.5 - sy) - loom.cy) / loom.radius;
    return out;
}

/**
 * The primary board in loom-local coordinates: `left`/`width` span the ten columns, `top` is the
 * upper edge of the first visible row and `rowStep` one row down (positive number).
 */
export function boardInLoom(board, aspect, loom, out = {
    left: 0, width: 0, top: 0, rowStep: 0,
}) {
    const a = screenToLoom(board.x0, board.y0, aspect, loom);
    const left = a.x;
    const top = a.y;
    const b = screenToLoom(board.x1, board.y1, aspect, loom);
    out.left = left;
    out.width = b.x - left;
    out.top = top;
    out.rowStep = (top - b.y) / BOARD_GRID.rows;
    return out;
}
