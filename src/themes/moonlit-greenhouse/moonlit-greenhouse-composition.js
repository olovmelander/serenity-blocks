/**
 * Moonlit Greenhouse — composition (CPU only, three-free).
 *
 * The gameplay card stands at the far end of the lily canal, over the vanishing point of the
 * nave. The picture is built for what stays visible round it:
 *
 *   LEFT   — the moon through the glass, its beams slanting down across the canal, the palms
 *            and the left beds, where the board's blooms open.
 *   RIGHT  — the right beds, the tree ferns and the lanterns; the HUD sits on this side.
 *   ABOVE  — the iron ribs and the glazing converging down the vault.
 *   BELOW  — the near water of the canal with its lily pads and the vault mirrored in it.
 *   BEHIND — the Queen of the Night opens behind the card, her petals reaching out round it.
 *   On an upright phone the moon stands above the card and the water fills the foot.
 *
 * This module reads the live card, board and HUD rects (screen fractions, y down) and maps board
 * columns and rows onto the screen; the world turns those into rays (where a lock leaves the
 * card, where the cleared rows release their fireflies).
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
    const line = (Math.max(0, Math.min(BOARD_GRID.rows - 1, row)) + 0.5) / BOARD_GRID.rows;
    out.y = board.y0 + (board.y1 - board.y0) * line;
    return out;
}

// ── The greenhouse's framing ────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v) => clamp(v, 0, 1);

/** The rest camera's lens: the horizontal field it holds, the vertical one clamped. */
export const REST_RIG = Object.freeze({
    hFov: 78,
    minFov: 46,
    maxFov: 84,
    near: 0.08,
    far: 400,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** The card a board sits in (the one holding its centre), else the first card. */
export function cardFor(layout, board) {
    const cards = layout?.cards;
    if (!cards?.length) return null;
    if (board) {
        const cx = (board.x0 + board.x1) / 2;
        const cy = (board.y0 + board.y1) / 2;
        const own = cards.find((c) => cx >= c.x0 && cx <= c.x1 && cy >= c.y0 && cy <= c.y1);
        if (own) return own;
    }
    return cards[0];
}

/**
 * The frame for an aspect and a layout (`layout` as readLayoutRects gives it, or null):
 *   moonX, moonY   where on screen the moon stands (fractions, y down): in the free margin left
 *                  of the card on a wide screen, above the card on a tall one
 *   pitch          how far the lens is lifted (degrees): a little more on a tall screen, so the
 *                  vault shows over the card and the canal under it
 *   tall           0 on a wide screen, 1 on an upright phone
 */
export function frameFor(aspect, layout, out = {}) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const tall = clamp01((1.2 - a) / 0.6);
    let left = 0.41;
    let top = 0.15;
    const cards = layout?.cards;
    if (cards?.length) {
        left = 1;
        top = 1;
        for (let i = 0; i < cards.length; i += 1) {
            left = Math.min(left, cards[i].x0);
            top = Math.min(top, cards[i].y0);
        }
    }
    // Wide: the middle of the left margin, a little toward the card, high in the frame.
    const wideX = clamp(left * 0.58, 0.08, 0.34);
    const wideY = 0.2;
    // Tall: above the card, left of the middle.
    const tallX = 0.34;
    const tallY = clamp(top * 0.46, 0.06, 0.24);
    out.moonX = wideX + (tallX - wideX) * tall;
    out.moonY = wideY + (tallY - wideY) * tall;
    out.pitch = 4.5 + 6 * tall;
    out.tall = tall;
    return out;
}

/**
 * Where on screen a locked piece's bloom opens (screen fractions, y down).
 *
 * The card hides what is behind it, so a bloom opens BESIDE it, in the beds or on the canal: on
 * the side its column is nearer, further out the further its column is from the middle, and
 * nearer the eye (lower on screen) the lower the piece came to rest. On the right the stats bar
 * is kept clear. With no room beside the card (an upright phone) it opens under the card, on
 * the water, its column picking the place across. `jitter` (two numbers in −1..1) keeps two
 * pieces off the same spot.
 */
export function aimLanding(layout, card, piece, u, row, jitter = null, out = { x: 0.5, y: 0.9 }) {
    const depth = clamp01(row / (BOARD_GRID.rows - 1));
    const jx = jitter ? jitter[0] : 0;
    const jy = jitter ? jitter[1] : 0;
    // The beds show from about the middle of the frame down; the near water at the foot.
    const top = 0.56;
    const y = top + (0.94 - top) * depth ** 0.9 + jy * 0.025;
    const leftRoom = card.x0;
    const hud = layout?.hud && layout.hud.x0 >= card.x1 - 0.02 ? layout.hud : null;
    const rightFrom = hud ? hud.x1 : card.x1;
    const rightRoom = 1 - rightFrom;
    const side = u < 0.5 ? -1 : 1;
    if (side < 0 && leftRoom > 0.12) {
        const reach = (1 - 2 * u) * (leftRoom - 0.08) * 0.82;
        out.x = clamp(card.x0 - 0.04 - reach + jx * 0.016, 0.03, card.x0 - 0.025);
        out.y = clamp(y, top, 0.97);
    } else if (side > 0 && rightRoom > 0.1) {
        const reach = (2 * u - 1) * (rightRoom - 0.07) * 0.82;
        out.x = clamp(rightFrom + 0.035 + reach + jx * 0.016, rightFrom + 0.02, 0.97);
        out.y = clamp(y, top, 0.97);
    } else if (side > 0 && leftRoom > 0.12) {
        out.x = clamp(card.x0 - 0.035 - (1 - u) * 0.08 + jx * 0.016, 0.03, card.x0 - 0.02);
        out.y = clamp(y, top, 0.97);
    } else if (card.y1 < 0.92) {
        // Under the card: the column picks the place across the water, the row its depth.
        out.x = clamp(0.5 + (u - 0.5) * 0.8 + jx * 0.03, 0.06, 0.94);
        out.y = clamp(card.y1 + 0.02 + (1 - card.y1 - 0.04) * depth ** 0.8 + jy * 0.012, card.y1 + 0.015, 0.985);
    } else {
        out.x = side < 0 ? Math.max(0.02, leftRoom * 0.5) : Math.min(0.98, 1 - rightRoom * 0.5);
        out.y = clamp(y, top, 0.97);
    }
    return out;
}

/**
 * Where a seed of light leaves the card for the garden: the card's edge on the side it lands,
 * at the piece's own height (or the foot of the card when it lands beneath it).
 */
export function aimLeave(card, piece, landing, out = { x: 0.5, y: 0.5 }) {
    if (landing.x < card.x0) {
        out.x = card.x0;
        out.y = piece.y;
    } else if (landing.x > card.x1) {
        out.x = card.x1;
        out.y = piece.y;
    } else {
        out.x = piece.x;
        out.y = card.y1;
    }
    return out;
}
