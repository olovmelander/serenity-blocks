/**
 * Sunset — composition (CPU only, three-free).
 *
 * The gameplay card stands in the middle of the picture like a pane of dark glass, so the
 * picture is built for what stays visible round it:
 *
 *   LEFT   the sun's side: it comes down the sky left of the card and sets into the sea there,
 *          its road of light running from the horizon to the bottom of the frame.
 *   RIGHT  the moon's side: at night it rides down the sky right of the card (beyond the stats
 *          bar) and sets there at first light.
 *   ABOVE  the cloud deck, running in over the eye's head toward the place the sun sets.
 *   BELOW  the near sea, where a locked piece's lantern is set on the water.
 *
 * This module holds the camera rig, reads the live card, board and HUD rects (screen fractions,
 * y down), decides from them where the horizon, the sun and the moon stand, and maps board
 * columns and rows onto the screen; the world turns those into rays to find where on the sea a
 * lantern lands.
 */
import {
    DEG, EYE_HEIGHT, clamp, clamp01,
} from './sunset-core.js';

/** The playfield every board canvas shows. */
export const BOARD_GRID = Object.freeze({ columns: 10, rows: 20, hiddenRows: 4 });

/** Director / layout player slots: 0 = the solo board, 1..4 = local-multiplayer boards. */
export const PLAYER_SLOTS = 5;

/** The rest camera: an eye floating over the sea, looking west. */
export const REST_RIG = Object.freeze({
    eye: Object.freeze({ x: 0, y: EYE_HEIGHT, z: 0 }),
    /** The horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 80,
    minFov: 42,
    maxFov: 82,
    near: 0.25,
    far: 40000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/** How far the sun's and the moon's paths lean (degrees of azimuth per degree of height). */
export const PATH_LEAN = 0.34;

/**
 * The frame for an aspect and a layout (`layout` as readLayoutRects gives it, or null when no
 * board is on screen):
 *   horizon   where the horizon stands on screen (fraction of the height, from the top)
 *   pitch     how far the lens is lifted to put it there (degrees)
 *   sunX      where on screen the sun sets (fraction of the width), and sunAz the azimuth that
 *             puts it there (degrees right of the line the eye looks down)
 *   moonX, moonAz   the same for the moon
 * With a board the sun stands in the middle of the margin left of the card (a little toward the
 * card) and the moon in the free strip right of the card and the stats bar; without one both
 * come in toward the thirds of the frame.
 */
export function frameFor(aspect, layout, out = {}) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const tall = clamp01((1.15 - a) / 0.6);
    const tanV = Math.tan((fovForAspect(a) * DEG) / 2);
    const tanH = tanV * a;
    // The sky is the picture: the horizon stands low. On a tall screen the card hides the middle,
    // so it stands at the middle and the sea takes the lower half.
    const horizon = 0.61 + (0.52 - 0.61) * tall;
    const pitch = Math.atan((2 * horizon - 1) * tanV);
    let sunX = 0.3;
    let moonX = 0.72;
    const cards = layout?.cards;
    if (cards?.length) {
        let left = 1;
        let right = 0;
        for (let i = 0; i < cards.length; i += 1) {
            left = Math.min(left, cards[i].x0);
            right = Math.max(right, cards[i].x1);
        }
        if (layout.hud && layout.hud.x0 >= right - 0.02) right = Math.max(right, layout.hud.x1);
        sunX = clamp(left * 0.56, 0.07, 0.36);
        moonX = clamp(right + (1 - right) * 0.52, 0.64, 0.93);
    }
    const toAzimuth = (x) => Math.atan((2 * x - 1) * tanH * Math.cos(pitch)) / DEG;
    out.horizon = horizon;
    out.pitch = pitch / DEG;
    out.sunX = sunX;
    out.sunAz = toAzimuth(sunX);
    out.moonX = moonX;
    out.moonAz = toAzimuth(moonX);
    return out;
}

/**
 * Where on screen a locked piece's lantern is set on the sea (screen fractions, y down).
 *
 * The card hides what is behind it, so a lantern lands BESIDE it: on the side its column is
 * nearer, further out the further its column is from the middle, and nearer the eye the lower
 * the piece came to rest (a piece on the floor lands at the bottom of the frame; one high on a
 * tall stack lands far out toward the horizon). On the right the stats bar is kept clear. With no
 * room beside the card (a tall screen) it lands under the card, or failing that in what strip
 * there is. `jitter` (two numbers in −1..1) keeps two pieces off the same spot.
 */
export function aimLanding(layout, card, piece, u, row, horizon, jitter = null, out = { x: 0.5, y: 0.9 }) {
    const depth = clamp01(row / (BOARD_GRID.rows - 1));
    const jx = jitter ? jitter[0] : 0;
    const jy = jitter ? jitter[1] : 0;
    const top = horizon + 0.05;
    const y = top + (0.95 - top) * depth ** 0.85 + jy * 0.028;
    const leftRoom = card.x0;
    const hud = layout?.hud && layout.hud.x0 >= card.x1 - 0.02 ? layout.hud : null;
    const rightFrom = hud ? hud.x1 : card.x1;
    const rightRoom = 1 - rightFrom;
    const side = u < 0.5 ? -1 : 1;
    if (side < 0 && leftRoom > 0.12) {
        const reach = (1 - 2 * u) * (leftRoom - 0.075) * 0.86;
        out.x = clamp(card.x0 - 0.035 - reach + jx * 0.018, 0.02, card.x0 - 0.02);
        out.y = clamp(y, top, 0.975);
    } else if (side > 0 && rightRoom > 0.1) {
        const reach = (2 * u - 1) * (rightRoom - 0.06) * 0.86;
        out.x = clamp(rightFrom + 0.03 + reach + jx * 0.018, rightFrom + 0.015, 0.98);
        out.y = clamp(y, top, 0.975);
    } else if (side > 0 && leftRoom > 0.12) {
        // No room on the right: it crosses to the sun's side, close in by the card.
        out.x = clamp(card.x0 - 0.03 - (1 - u) * 0.08 + jx * 0.018, 0.02, card.x0 - 0.015);
        out.y = clamp(y, top, 0.975);
    } else if (card.y1 < 0.93) {
        out.x = clamp(piece.x + jx * 0.03, 0.03, 0.97);
        out.y = clamp(card.y1 + 0.025 + (1 - depth) * 0.02 + Math.abs(jy) * 0.015, top, 0.985);
    } else {
        out.x = side < 0 ? Math.max(0.015, leftRoom * 0.5) : Math.min(0.985, 1 - rightRoom * 0.5);
        out.y = clamp(y, top, 0.975);
    }
    return out;
}

/**
 * Where the light leaves the card for the sea: the edge of the card on the side the lantern
 * lands, at the piece's own height (or the foot of the card when it lands beneath it).
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
 * board.
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

/** The card a board sits in: the one that contains its middle, else the first. */
export function cardFor(layout, board) {
    const cards = layout?.cards;
    if (!cards?.length) return null;
    if (board) {
        const cx = (board.x0 + board.x1) / 2;
        const cy = (board.y0 + board.y1) / 2;
        for (let i = 0; i < cards.length; i++) {
            const c = cards[i];
            if (cx >= c.x0 && cx <= c.x1 && cy >= c.y0 && cy <= c.y1) return c;
        }
    }
    return cards[0];
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
