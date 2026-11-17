/**
 * Vesper Chrysalis — composition (CPU only, three-free).
 *
 * The gameplay card hangs in front of the scene like a pane of dark glass, and the picture is
 * built for what stays visible around it. This module is the screen side of that: it reads the
 * live card, board and HUD rects (screen fractions, y down) and maps board columns and rows onto
 * the screen. The world aims its gameplay events through those points (the column and rows a
 * piece locked on, the rows a clear emptied), and the post keeps its calm zones over the card
 * and the HUD. The wings measure here how much of each of them the card and the HUD hide.
 */

import {
    CHRYSALIS, DEG, EYE, WINGS, WING_REACH, fovForAspect, wingPoint,
} from './vesper-chrysalis-core.js';

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

// ── Where the chrysalis hangs so the board does not hide it ─────────────────────

/** The band of the screen the chrysalis hangs in at rest (fractions, y down). */
export const PERCH_BAND = Object.freeze({ y0: 0.26, y1: 0.54 });
/** The chrysalis itself keeps clear of the frame's edges (the crystal stands there). */
const PERCH_EDGE = 0.13;
/** The open middle (between two boards) the chrysalis stays in; the narrowest side column. */
const PERCH_ROOM = 0.13;
/**
 * The least scale on the wings an open column beside a board must allow: narrower than that (an
 * upright tablet) the chrysalis rises into the sky above the card instead, where there is one.
 */
const PERCH_SIDE_WINGS = 0.3;
/** A wing may reach this close to the frame's edge, and no closer than this to a card. */
const WING_EDGE = 0.015;
const WING_GAP = 0.02;

/** Metres across the whole frame at the chrysalis's distance, for a frame of `aspect`. */
function acrossFor(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    return 2 * Math.tan((fovForAspect(a) * DEG) / 2) * a * Math.abs(CHRYSALIS.z - EYE.z);
}

/**
 * Where on screen the chrysalis should hang so that it is seen, with its wings: `{ x, room }`,
 * x a fraction of the width and room how far a wing may reach to either side of it (the same
 * unit), or null when it can stay where it is (nothing covers the middle of the frame, or
 * nowhere is better). The card stands in front of the middle of the picture, so in a solo game
 * the chrysalis hangs in the middle of the open water beside it, its wings spread over that
 * water and no further; between two boards it stays between them. `aspect` sizes the chrysalis
 * on screen (it keeps itself off the crystal stands at the frame's edges).
 */
export function perchPlace(layout, aspect = 16 / 9) {
    const rects = [];
    (layout?.cards ?? []).forEach((r) => { if (r) rects.push(r); });
    if (layout?.hud) rects.push(layout.hud);
    const blocks = rects
        .filter((r) => r.y0 < PERCH_BAND.y1 && r.y1 > PERCH_BAND.y0 && r.x1 > r.x0)
        .map((r) => [r.x0, r.x1])
        .sort((a, b) => a[0] - b[0]);
    if (!blocks.length) return null;
    // The open columns between the covers (the wings may reach almost to the frame's edge).
    const open = [];
    let at = WING_EDGE;
    blocks.forEach(([x0, x1]) => {
        if (x0 - WING_GAP > at) open.push([at, Math.min(x0 - WING_GAP, 1 - WING_EDGE)]);
        at = Math.max(at, x1 + WING_GAP);
    });
    if (at < 1 - WING_EDGE) open.push([at, 1 - WING_EDGE]);
    // The middle is open (two boards with the chrysalis between them): it stays.
    const middle = open.find(([x0, x1]) => x0 <= 0.5 - PERCH_ROOM / 2 && x1 >= 0.5 + PERCH_ROOM / 2);
    if (middle) return null;
    let best = null;
    open.forEach((column) => {
        const width = column[1] - column[0];
        if (width < PERCH_ROOM) return;
        // The widest column; the left one when two are alike (the HUD stands to the right).
        if (!best || width > best[1] - best[0] + 0.02) best = column;
    });
    if (!best) return null;
    const [x0, x1] = best;
    // The middle of the column, so the wings have as much room on one side as the other; the
    // chrysalis itself stays off the crystal stands at the frame's edges.
    const body = (CHRYSALIS.radius * 1.15) / acrossFor(aspect);
    const x = Math.max(PERCH_EDGE + body, Math.min(1 - PERCH_EDGE - body, (x0 + x1) / 2));
    return { x, room: Math.max(0, Math.min(x - x0, x1 - x)) };
}

/** Where on screen (x, a fraction of the width) the chrysalis hangs beside a board, or null. */
export function perchScreenX(layout, aspect = 16 / 9) {
    return perchPlace(layout, aspect)?.x ?? null;
}

/** The least strip above the cards (a share of the screen's height) the chrysalis is hung in. */
const PERCH_STRIP = 0.11;

/**
 * Where on screen (y, a fraction, of its middle) the chrysalis should hang when no open water
 * beside the board will take it (an upright phone: the card fills the width): in the strip of sky
 * above the card, when there is one. null when there is none.
 */
export function perchScreenY(layout) {
    const cards = (layout?.cards ?? []).filter(Boolean);
    if (!cards.length) return null;
    // Only when something does stand in front of the middle of the picture.
    const covered = cards.some((r) => r.x0 < 0.5 && r.x1 > 0.5 && r.y0 < PERCH_BAND.y1 && r.y1 > PERCH_BAND.y0);
    if (!covered) return null;
    let top = 1;
    cards.forEach((r) => { top = Math.min(top, r.y0); });
    if (layout.hud && layout.hud.x0 < 0.6 && layout.hud.x1 > 0.4) top = Math.min(top, layout.hud.y0);
    return top >= PERCH_STRIP ? top * 0.5 + 0.004 : null;
}

/** The wings' scale that lets a wing reach `room` metres out from the chrysalis's middle, at most 1. */
function wingsFor(room) {
    return Math.max(0.2, Math.min(1, (room - WINGS.root[0]) / (WINGS.span * WING_REACH)));
}

/**
 * The same as an offset in metres from the chrysalis's place at rest, for a frame of `aspect`:
 * to the side of the board when there is open water there, else up into the sky above it. And
 * `wings`, the scale on the wings' span that keeps them in the room they have there (1 where
 * nothing stands in front of the picture, or between two boards).
 * @returns {{ x: number, y: number, wings: number }}
 */
export function perchFor(layout, aspect, out = { x: 0, y: 0, wings: 1 }) {
    out.x = 0;
    out.y = 0;
    out.wings = 1;
    if (!layout) return out;
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const halfHeight = Math.tan((fovForAspect(a) * DEG) / 2);
    const distance = Math.abs(CHRYSALIS.z - EYE.z);
    // Metres across the frame at the chrysalis, for one whole screen width.
    const across = acrossFor(a);
    const place = perchPlace(layout, a);
    const side = place ? wingsFor(place.room * across) : 0;
    const beside = () => {
        out.x = (place.x - 0.5) * across - CHRYSALIS.x;
        out.wings = side;
        return out;
    };
    // Beside the board, when the open water there holds the wings at a size worth the name.
    if (place && side >= PERCH_SIDE_WINGS) return beside();
    const sy = perchScreenY(layout);
    if (sy === null) return place ? beside() : out;
    // Else up in the sky above the card: the height at which its middle stands at that place on
    // the screen, the wings spread across the whole width of the frame and no further.
    const elevation = EYE.pitch + Math.atan((0.5 - sy) * 2 * halfHeight);
    const middle = EYE.y + distance * Math.tan(elevation);
    out.y = Math.max(0, middle - (CHRYSALIS.foot + CHRYSALIS.length * 0.5));
    out.wings = wingsFor((0.5 - WING_EDGE) * across);
    return out;
}

// ── What the card hides of the wings ────────────────────────────────────────────

/** Rays across each wing (an = i / (WING_COVER_SAMPLES − 1)) the cover table holds. */
export const WING_COVER_SAMPLES = 13;
/** Steps the march takes along a ray, root to margin, before it refines the edge. */
const COVER_STEPS = 24;
const COVER_REFINE = 6;
/**
 * A gap between two covers narrower than this (screen heights) still hides: the HUD stands
 * ~0.04 of the screen's height right of the card, and a wing coming out into that slot only to
 * vanish behind the HUD would be written there for nothing.
 */
export const COVER_GAP = 0.07;

function coveredBy(rects, x, y) {
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r && x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
    }
    return false;
}

/**
 * How far out along one ray of a wing (`an` across it) the card and the HUD hide it: the `v`
 * (0 = root, 1 = margin) where the ray comes out from behind them for good, 0 when the root is
 * not behind a cover, 1 when the whole ray is behind one.
 *
 * `project(p, out)` writes a world point's screen position (fractions, y down) into `out` and
 * returns false when it is behind the eye; `w` and `beat` are the wings' unfurling and stroke
 * now (a young wing is gathered, and the stroke turns it), so the answer is for this frame.
 */
export function wingCoverAlong(project, rects, aspect, kind, side, an, w, beat, scratch = {}, mount = undefined) {
    const p = scratch.p || (scratch.p = [0, 0, 0]);
    const s = scratch.s || (scratch.s = { x: 0, y: 0 });
    const at = (v) => {
        wingPoint(kind, side, an, v, w, beat, p, mount);
        return project(p, s) ? coveredBy(rects, s.x, s.y) : false;
    };
    if (!rects?.length || !at(0)) return 0;
    const a = Math.max(0.1, aspect || 1);
    let hidden = 0;
    let gap = 0;
    let px = s.x;
    let py = s.y;
    for (let i = 1; i <= COVER_STEPS; i++) {
        const v = i / COVER_STEPS;
        const inside = at(v);
        if (inside) {
            hidden = v;
            gap = 0;
        } else {
            gap += Math.hypot((s.x - px) * a, s.y - py);
            if (gap > COVER_GAP) break;
        }
        px = s.x;
        py = s.y;
    }
    if (hidden >= 1) return 1;
    // The edge lies between the last hidden step and the next one.
    let lo = hidden;
    let hi = Math.min(1, hidden + 1 / COVER_STEPS);
    for (let k = 0; k < COVER_REFINE; k++) {
        const mid = (lo + hi) / 2;
        if (at(mid)) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * The whole cover table: for each ray i, (left forewing, right forewing, left hindwing, right
 * hindwing), the layout the wing shader reads (out[i] is anything with set(x, y, z, w)).
 */
export function fillWingCover(out, project, rects, aspect, w, beat, scratch = {}, mount = undefined) {
    const n = Math.min(out.length, WING_COVER_SAMPLES);
    for (let i = 0; i < n; i++) {
        const an = i / (WING_COVER_SAMPLES - 1);
        out[i].set(
            wingCoverAlong(project, rects, aspect, 0, -1, an, w, beat, scratch, mount),
            wingCoverAlong(project, rects, aspect, 0, 1, an, w, beat, scratch, mount),
            wingCoverAlong(project, rects, aspect, 1, -1, an, w, beat, scratch, mount),
            wingCoverAlong(project, rects, aspect, 1, 1, an, w, beat, scratch, mount),
        );
    }
    return out;
}

/** One wing's cover at `an`, read from the table as the shader reads it (linear between rays). */
export function wingCoverAt(table, kind, side, an) {
    const f = Math.max(0, Math.min(1, an)) * (WING_COVER_SAMPLES - 1);
    const i0 = Math.min(WING_COVER_SAMPLES - 1, Math.floor(f));
    const i1 = Math.min(WING_COVER_SAMPLES - 1, i0 + 1);
    const t = f - i0;
    const pick = (e) => {
        if (kind === 0) return side < 0 ? e.x : e.y;
        return side < 0 ? e.z : e.w;
    };
    return pick(table[i0]) + (pick(table[i1]) - pick(table[i0])) * t;
}

/**
 * Where along a wing ray (v) a front stands that is `f` of the way from the ray's cover `c` to
 * its margin: the wing is written, and folds back, only where it can be seen.
 */
export const frontPast = (c, f) => c + f * (1 - c);

/**
 * Where on screen a board column / row is (screen fractions, y down).
 * `u` = fraction across the board's ten columns; `row` = visible row (0 = top, 19 = floor),
 * measured to the row's centre line.
 */
export function boardPoint(board, u, row, out = { x: 0.5, y: 0.5 }) {
    const v = (Math.max(0, Math.min(BOARD_GRID.rows - 1, row)) + 0.5) / BOARD_GRID.rows;
    out.x = board.x0 + (board.x1 - board.x0) * Math.max(0, Math.min(1, u));
    out.y = board.y0 + (board.y1 - board.y0) * v;
    return out;
}
