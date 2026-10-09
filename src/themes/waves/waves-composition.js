/**
 * Waves — composition (CPU only, three-free).
 *
 * The gameplay card hangs in the middle of the tube like a pane of dark glass, and the lens is
 * turned a little toward the face of the wave, so the picture is built for what stays visible
 * around the card:
 *
 *   LEFT   — the eye of the barrel: the open sea, the horizon, the low sun and its road of
 *            light on the water, the lip falling across it as a tearing curtain.
 *   ABOVE  — the roof: thin water with the sky and the sun burning through it.
 *   RIGHT  — the face of the wave: deep glass that mirrors the eye, drawn up and over in long
 *            streaks, running back to the unbroken shoulder ahead.
 *   BELOW  — the trough, sliding under the board, where a locked piece falls in.
 *
 * This module holds the camera rig, reads the live card, board and HUD rects (screen fractions,
 * y down) and maps board columns and rows onto the screen; the world turns those into rays to
 * find where on the water an event lands.
 */
import { DEG, clamp01 } from './waves-core.js';

/** The playfield every board canvas shows. */
export const BOARD_GRID = Object.freeze({ columns: 10, rows: 20, hiddenRows: 4 });

/** Director / layout player slots: 0 = the solo board, 1..4 = local-multiplayer boards. */
export const PLAYER_SLOTS = 5;

/** The rest camera: where the rider's eye is, in the tube. */
export const REST_RIG = Object.freeze({
    /** A little toward the face and well under the roof (metres). */
    eye: Object.freeze({ x: 0.55, y: 1.32, z: 0 }),
    /** The horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 101,
    minFov: 60,
    maxFov: 96,
    near: 0.06,
    far: 6000,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/**
 * Where the lens points for an aspect: `yaw` turns it toward the face of the wave (degrees to
 * the right of the line), `pitch` lifts it. With a board on a wide screen the eye of the barrel
 * is pushed clear of the card to the left; without one it comes back toward the middle; on a
 * tall screen the card fills the width, so the lens turns to face the sun and dips until the eye
 * of the barrel stands in the margin above the card and the trough runs under it.
 */
export function viewFor(aspect, hasBoard, out = { yaw: 0, pitch: 0 }) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const tall = clamp01((1.15 - a) / 0.6);
    const wideYaw = hasBoard ? 17 : 9;
    // Tall: turned to face the sun, and (with a board) looking down the trough at it.
    const tallYaw = hasBoard ? -13 : -5;
    out.yaw = wideYaw + (tallYaw - wideYaw) * tall;
    out.pitch = 3.5 + ((hasBoard ? -32 : 1) - 3.5) * tall;
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
