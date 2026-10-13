/**
 * Rainbark — composition (CPU only, three-free).
 *
 * The gameplay card hangs in the blue air of a grove of painted giants, and the picture is built
 * asymmetrically round what stays visible beside it:
 *
 *   LEFT   — the Elder, a cropped wall of painted bark close to the camera; its card-facing face
 *            is the peel lane where locks peel strips and clears shed rings.
 *   BEHIND — the grove receding on a diagonal from the dense left to a sparse right, each rank
 *            paler and bluer, opening an aisle of light behind the HUD; what shows through the
 *            card is soft-clipped by the post.
 *   RIGHT  — open, sunlit air where the HUD sits, then the two Sisters set deep (Sister Two
 *            slim and deeper still, a band of air between them on every row), the nearer one's
 *            face the second peel lane; never a colonnade, never an arch over a vista.
 *   ABOVE / BELOW — the canopy lace and its gaps; the luminous mist floor between the trunks. On
 *            an upright phone the Elder is a band down the left edge, Sister One's card-facing
 *            side a band down the right, and the crown gap opens above the card.
 *
 * This module reads the live card, board and HUD rects (screen fractions, y down) and maps board
 * columns and rows onto the screen, and solves where the hero trunks stand round them
 * (trunkBand): the world applies it whenever the layout or the aspect changes and casts lock and
 * clear rows from it onto the bark.
 */

import {
    HERO_REF_Y, HERO_TRUNKS, TAU, TWIN_SEEDS, TWIN_TRUNKS, aspectWeights, eyeRow, fallbackCard, fallbackHud, lensRow,
    restLens, trunkRecord, trunkSpan,
} from './rainbark-core.js';

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

/**
 * The solo layout from the stylesheet's own formulas (public/styles/main.css), used before a card
 * is on screen: board = min(clamp(220, 22vw, 300), (100vh − 250)/2), card ≈ 1.19·board wide and
 * 2·board + 158 tall with the playfield seated at its foot, the stats bar 60 px right of the stage.
 */
export function fallbackLayout(width, height) {
    const W = Math.max(1, width || 1);
    const H = Math.max(1, height || 1);
    const board = Math.max(120, Math.min(Math.max(220, Math.min(0.22 * W, 300)), (H - 250) / 2));
    const ch = 2 * board + 158;
    const cardBottom = H / 2 + ch / 2;
    const boards = new Array(PLAYER_SLOTS).fill(null);
    boards[0] = toFractions({
        left: W / 2 - board / 2, right: W / 2 + board / 2, top: cardBottom - 24 - 2 * board, bottom: cardBottom - 24,
    }, W, H);
    return {
        cardCount: 0,
        // The card and the HUD are the core's (the grove plan measures its keep-outs against the
        // same rects).
        cards: [fallbackCard(W, H)],
        hud: fallbackHud(W, H),
        boards,
    };
}

/**
 * The CSS height a frame is assumed to have when only its aspect is known (no layout and no
 * window size yet): a 1080-line screen, so the 16:9 fallback is the 1920 × 1080 reference.
 */
export const FALLBACK_HEIGHT = 1080;

/** The solo fallback layout for a frame of `aspect`, at its CSS size when known. */
export function fallbackFor(aspect, cssWidth = 0, cssHeight = 0) {
    if (cssWidth > 0 && cssHeight > 0) return fallbackLayout(cssWidth, cssHeight);
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    return fallbackLayout(a * FALLBACK_HEIGHT, FALLBACK_HEIGHT);
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

// ── The composition solver ──────────────────────────────────────────────────────

/** The trunks trunkBand places, in the order of its placements. */
export const BAND_TRUNKS = Object.freeze(['Elder', 'Sister One', 'Sister Two', 'R1a', 'R1b', 'Twin A', 'Twin B']);
/** Falling things keep at least this far (screen fraction) outside the card and HUD rects (§6.0). */
export const LANE_MARGIN = 0.02;
/** A silhouette nearer a card or the HUD than this (screen fraction) touches it and is pushed out. */
export const TOUCH_MARGIN = 0.01;
/**
 * The right of the frame is open, sunlit air (§0.3): Sister Two, and the 21:9 Twin beyond her,
 * stand at least SISTER_GAP clear of the silhouette before them on every row (top, eye, bottom);
 * R1b shows only with R1B_GAP of air to Sister One and HUD_AIR clear of the HUD (else the right
 * reads as one colonnade the weight of the Elder's side, and the frame as a symmetric vista).
 */
export const SISTER_GAP = 0.035;
export const R1B_GAP = 0.04;
export const HUD_AIR = 0.04;
/**
 * A HUD with less than this share of its width on screen is not one the composition stands round.
 */
export const HUD_SEEN = 0.5;
/**
 * Sister One shows only with at least this much of the frame (screen fraction) left for her band
 * right of the HUD; with less, the right edge is air.
 */
export const SISTER_BAND = 0.04;
/**
 * The peel lanes' widths (radians) and their inset from the silhouette (§4.2 step 4). The Elder's
 * is 42° (the spec's 30° foreshortened to a 70-pixel sliver at 16:9; 42° holds x .19–.26).
 */
export const LANE_WIDTH = Object.freeze({ elder: 42 * (Math.PI / 180), sister: 60 * (Math.PI / 180) });
export const LANE_INSET = 6 * (Math.PI / 180);
/** A lane narrows (to no less than LANE_LEAST) until its left edge stands LANE_EDGE inside the frame. */
export const LANE_LEAST = 16 * (Math.PI / 180);
export const LANE_EDGE = 0.008;
/** The share of their lean the heroes keep on an upright screen (all of it from 1.5 : 1 up). */
export const HERO_LEAN_UPRIGHT = 0.3;
/** Most rects the solver keeps clear (four local-multiplayer cards and the HUD, or the solo card). */
const MAX_RECTS = 6;

const BAND_DEFS = BAND_TRUNKS.map((name) => HERO_TRUNKS.find((t) => t.name === name)
    || TWIN_TRUNKS.find((t) => t.name === name));

const rectOf = () => ({
    x0: 0, y0: 0, x1: 0, y1: 0,
});

/** A reusable result for trunkBand (pass it back as `out`: the solver then allocates nothing). */
export function createBand() {
    return {
        aspect: 16 / 9,
        camY: HERO_REF_Y,
        k: 1,
        w: 0,
        placements: BAND_DEFS.map((trunk) => ({
            name: trunk.name,
            trunk,
            code: trunk.code,
            group: trunk.group,
            x: trunk.x,
            z: trunk.z,
            radius: trunk.radius,
            lean: trunk.lean,
            show: true,
            x0: 0,
            x1: 0,
        })),
        lanes: [
            {
                code: 1, side: 'card', theta0: 0, theta1: 0, x0: 0, x1: 0, thetaLeft: 0, thetaRight: 0,
            },
            {
                code: 2, side: 'sun', theta0: 0, theta1: 0, x0: 0, x1: 0, thetaLeft: 0, thetaRight: 0,
            },
        ],
        keepOut: Array.from({ length: MAX_RECTS }, rectOf),
        keepOutCount: 0,
    };
}

const bandLens = {};
const bandRow = { rise: 0, scale: 1 };
const bandRecord = new Float32Array(16);
const bandSpan = [0, 0];
const bandRects = Array.from({ length: MAX_RECTS }, rectOf);
const bandUnion = rectOf();

/** A rect worth keeping clear: some of it on screen. */
const onScreen = (r) => Boolean(r) && r.x1 > 0 && r.x0 < 1 && r.y1 > 0 && r.y0 < 1 && r.x1 > r.x0 && r.y1 > r.y0;
/**
 * A HUD the heroes stand round: at least HUD_SEEN of its width on screen, beside the cards (right
 * of them, level with them), on any aspect: an upright tablet or monitor keeps the stats bar
 * beside the board, and Sister One then stands right of it. The row the stylesheet reflows it into
 * on a narrow frame (under the card, the frame's width: fallbackHud) is not one any upright trunk
 * could stand clear of; falling things keep out of it, as of any HUD on screen.
 */
export const hudBeside = (r, cards) => onScreen(r) && Boolean(cards)
    && (Math.min(r.x1, 1) - Math.max(r.x0, 0)) >= HUD_SEEN * (r.x1 - r.x0)
    && r.x0 >= cards.x1 - TOUCH_MARGIN && r.y0 < cards.y1 && r.y1 > cards.y0;

/** A mutable stand-in for a table trunk (the tables are frozen) moved to the solver's (x, z). */
const PLACE = {
    name: '', x: 0, z: 0, radius: 1, top: 170, taper: 0.45, lean: 0, leanTo: 0, finAmp: 0, finHeight: 10, sway: 0,
};

/**
 * How much of its lean a hero keeps on this frame (set per solve): on an upright screen the
 * pitched lens already converges the trunks toward the crown, and a lean toward the card would
 * walk Sister One's band off the edge to clear the card's top.
 */
let leanK = 1;

/** The record of `trunk` stood at (x, z), pivoted at camY (into bandRecord). */
function recordOf(trunk, seed, x, z, camY) {
    PLACE.name = trunk.name;
    PLACE.radius = trunk.radius;
    PLACE.top = trunk.top;
    PLACE.taper = trunk.taper;
    PLACE.lean = trunk.lean * leanK;
    PLACE.leanTo = trunk.leanTo;
    PLACE.finAmp = trunk.finAmp;
    PLACE.finHeight = trunk.finHeight;
    PLACE.x = x;
    PLACE.z = z;
    return trunkRecord(PLACE, seed, bandRecord, 0, camY);
}

/** The screen-x span of `trunk` stood at (x, z) on row sy (into bandSpan). */
function spanOf(trunk, seed, x, z, sy, camY) {
    return trunkSpan(recordOf(trunk, seed, x, z, camY), bandLens, sy, camY, 0, bandSpan);
}

/** How far `measure` of the trunk stood at (x, z) on row sy misses `target`. */
function missBy(trunk, seed, x, z, measure, target, camY, sy) {
    return measure(spanOf(trunk, seed, x, z, sy, camY)) - target;
}

/**
 * Stand `trunk` at depth z so that `measure(span)` on the eye row equals `target` (a measure that
 * grows with x: an edge or the centre). Regula falsi on a bracket that widens until it holds.
 */
function solveX(trunk, seed, z, measure, target, camY, sy) {
    const depth = Math.max(1, -z);
    lensRow(bandLens, sy, bandRow);
    const guess = ((target - 0.5) / (0.5 * bandRow.scale)) * bandLens.tanH * depth;
    let lo = guess - 4;
    let hi = guess + 4;
    let flo = missBy(trunk, seed, lo, z, measure, target, camY, sy);
    let fhi = missBy(trunk, seed, hi, z, measure, target, camY, sy);
    for (let i = 0; i < 12 && flo > 0; i++) {
        lo -= 8 * (i + 1);
        flo = missBy(trunk, seed, lo, z, measure, target, camY, sy);
    }
    for (let i = 0; i < 12 && fhi < 0; i++) {
        hi += 8 * (i + 1);
        fhi = missBy(trunk, seed, hi, z, measure, target, camY, sy);
    }
    if (!(flo <= 0 && fhi >= 0)) return guess;
    let side = 0;
    let x = guess;
    for (let i = 0; i < 40; i++) {
        x = (lo * fhi - hi * flo) / (fhi - flo);
        const fx = missBy(trunk, seed, x, z, measure, target, camY, sy);
        if (Math.abs(fx) < 1e-6 || hi - lo < 1e-5) break;
        if (fx < 0) {
            lo = x;
            flo = fx;
            if (side === -1) fhi /= 2;
            side = -1;
        } else {
            hi = x;
            fhi = fx;
            if (side === 1) flo /= 2;
            side = 1;
        }
    }
    return x;
}

/** Each HERO_TRUNKS name's index (its seed's place in the plan's hero seeds). */
const HERO_INDEX = new Map(HERO_TRUNKS.map((t, i) => [t.name, i]));
const bandWeights = { k: 1, w: 0 };

/** A hero's seed from the plan's (by table order), or a fixed stand-in. */
function seedFor(name, seeds) {
    const i = HERO_INDEX.has(name) ? HERO_INDEX.get(name) : -1;
    return seeds && i >= 0 && Number.isFinite(seeds[i]) ? seeds[i] : 1 + (i < 0 ? 7 : i);
}

/** Record a placement: where it stands, whether it shows, its lean and its eye-row silhouette. */
function settlePlace(place, seed, x, z, show, camY) {
    place.x = x;
    place.z = z;
    place.show = show;
    place.lean = place.trunk.lean * leanK;
    const s = spanOf(place.trunk, seed, x, z, eyeRow(bandLens), camY);
    place.x0 = s[0];
    place.x1 = s[1];
    // The radius on the eye's storey (the lanes and the tests read it).
    place.radius = bandRecord[2] * (1 - (bandRecord[3] * camY) / Math.max(bandRecord[5] - bandRecord[4], 1));
}

const rightEdge = (s) => s[1];
const leftEdge = (s) => s[0];
const centreOf = (s) => (s[0] + s[1]) / 2;

/**
 * How far (screen fraction) a trunk stood at (x, z) intrudes on the rects (each widened by
 * TOUCH_MARGIN), tested on each rect's top, middle and bottom rows: > 0 means it touches.
 * `away` = −1 for a trunk that must clear them leftward, +1 rightward.
 */
function intrusion(trunk, seed, x, z, camY, rects, count, away) {
    let worst = 0;
    for (let i = 0; i < count; i++) {
        const r = rects[i];
        for (let j = 0; j < 3; j++) {
            const sy = Math.min(1, Math.max(0, r.y0 + ((r.y1 - r.y0) * j) / 2));
            const s = spanOf(trunk, seed, x, z, sy, camY);
            if (s[1] > r.x0 - TOUCH_MARGIN && s[0] < r.x1 + TOUCH_MARGIN) {
                worst = Math.max(worst, away < 0 ? s[1] - (r.x0 - TOUCH_MARGIN) : r.x1 + TOUCH_MARGIN - s[0]);
            }
        }
    }
    return worst;
}

/**
 * Place a trunk by a measure on the eye row, then push it out (by `away`) while it touches a rect.
 * Returns x.
 */
function placeClear(trunk, seed, z, measure, target, camY, rects, count, away) {
    const sy = eyeRow(bandLens);
    let goal = target;
    let x = solveX(trunk, seed, z, measure, goal, camY, sy);
    for (let pass = 0; pass < 6; pass++) {
        const into = intrusion(trunk, seed, x, z, camY, rects, count, away);
        if (!(into > 0)) break;
        goal += away * (into + 1e-3);
        x = solveX(trunk, seed, z, measure, goal, camY, sy);
    }
    return x;
}

/** The rows two neighbours keep their air on: near the top, the eye's row (−1), near the bottom. */
const GAP_ROWS = [0.02, -1, 0.98];
const gapEdges = [0, 0, 0];
const rowOf = (sy) => (sy < 0 ? eyeRow(bandLens) : sy);

/** The right silhouette of a placement on each of GAP_ROWS (into gapEdges). */
function rightEdges(place, seed, camY) {
    for (let r = 0; r < GAP_ROWS.length; r++) {
        gapEdges[r] = spanOf(place.trunk, seed, place.x, place.z, rowOf(GAP_ROWS[r]), camY)[1];
    }
    return gapEdges;
}

/**
 * Stand a trunk at depth z beyond the silhouette whose right edges (GAP_ROWS) are `edges`, with
 * at least `gap` of air between them on every row, then push it out while it touches a rect.
 * Returns x.
 */
function placeBeyond(trunk, seed, z, edges, gap, camY, rects, count) {
    const sy = eyeRow(bandLens);
    let goal = edges[1] + gap;
    let x = solveX(trunk, seed, z, leftEdge, goal, camY, sy);
    for (let pass = 0; pass < 6; pass++) {
        let least = Infinity;
        for (let r = 0; r < GAP_ROWS.length; r++) {
            least = Math.min(least, spanOf(trunk, seed, x, z, rowOf(GAP_ROWS[r]), camY)[0] - edges[r]);
        }
        if (!(gap - least > 1e-4)) break;
        goal += gap - least;
        x = solveX(trunk, seed, z, leftEdge, goal, camY, sy);
    }
    let into = intrusion(trunk, seed, x, z, camY, rects, count, 1);
    for (let pass = 0; pass < 6 && into > 0; pass++) {
        goal += into + 1e-3;
        x = solveX(trunk, seed, z, leftEdge, goal, camY, sy);
        into = intrusion(trunk, seed, x, z, camY, rects, count, 1);
    }
    return x;
}

/** The θ (radians, the tube's own angle) of a trunk's right or left silhouette seen from the eye. */
function silhouetteTheta(x, z, radius, side) {
    const d = Math.max(Math.hypot(x, z), radius + 1e-3);
    const toEye = Math.atan2(-z, -x);
    const turn = Math.PI / 2 - Math.asin(Math.min(1, radius / d));
    return side > 0 ? toEye - turn : toEye + turn;
}

const wrapTheta = (t) => t - TAU * Math.floor(t / TAU);

/** Screen x (fraction, eye row) of the point at θ on a trunk of radius r stood at (x, z). */
function surfaceX(x, z, radius, theta) {
    const sy = eyeRow(bandLens);
    lensRow(bandLens, sy, bandRow);
    const px = x + radius * Math.cos(theta);
    const pz = z + radius * Math.sin(theta);
    return 0.5 + (0.5 * (px / Math.max(-pz, 1e-3)) * bandRow.scale) / bandLens.tanH;
}

/**
 * A peel lane: θ from theta0 over `width` on a placed trunk, its screen extent, and which end of
 * it shows at the left (thetaLeft, at x0) and at the right (thetaRight, at x1): board columns run
 * across a lane left to right as they do on the board.
 */
function writeLane(lane, place, theta0, width) {
    const t0 = wrapTheta(theta0);
    lane.theta0 = t0;
    lane.theta1 = t0 + width;
    const a = surfaceX(place.x, place.z, place.radius, t0);
    const b = surfaceX(place.x, place.z, place.radius, t0 + width);
    lane.x0 = Math.min(a, b);
    lane.x1 = Math.max(a, b);
    lane.thetaLeft = a <= b ? lane.theta0 : lane.theta1;
    lane.thetaRight = a <= b ? lane.theta1 : lane.theta0;
}

/**
 * The composition solver (§2.3, with the A2 review's open right): where the hero trunks stand for
 * the live card and HUD rects.
 *  - The Elder: right silhouette at card.x0 − card.x0·(0.08 + 0.26k) on the eye's row, depth
 *    9 − w; cropped on the left.
 *  - Sister One: left silhouette at max(card.x1, hud.x1) + 0.012 + 0.063k, depth 24 (with no
 *    HUD beside the card, hudBeside, only the card counts; on an upright frame her card-facing
 *    side is then the right edge band, and with less than SISTER_BAND left right of a HUD she is
 *    hidden).
 *  - Sister Two: deep and slim (depth 62), SISTER_GAP of air beyond Sister One on every row;
 *    hidden upright or when she would stand off the right edge.
 *  - R1a: centred in the left air lane between the Elder and the card at depth 45, hidden when the
 *    lane cannot hold her; R1b: HUD_AIR right of the card or HUD at depth 48, shown only with
 *    R1B_GAP of air before Sister One (never at the fallback layouts: the right stays open air).
 *  - The 21:9 Twin, one fused silhouette SISTER_GAP beyond Sister Two, only in an ultrawide frame.
 * Every silhouette is then tested on the top, middle and bottom rows of each card and the HUD,
 * and pushed outward while it touches one. Also returns the two peel lanes (θ range on the
 * Elder's card-facing side and on Sister One's sunlit side, or her card-facing side when that is
 * the only one on screen) and the keep-out rects (cards and HUD widened by LANE_MARGIN) for the
 * event stages. The trunks' axes pass through (x, z) at `camY` (the world pivots them at the
 * eye's storey), so the composition holds on every level.
 * @param {object|null} layout  the live rects (readLayoutRects), or null for the solo fallback
 * @param {number} aspect
 * @param {object} [options]
 * @param {number} [options.camY]   the eye's storey (metres)
 * @param {number[]} [options.seeds]  each HERO_TRUNKS entry's seed (its bow), by table order
 * @param {object} [options.css]  the frame's CSS size { width, height } (the fallback's, when
 *                                there is no layout; else FALLBACK_HEIGHT lines are assumed)
 * @param {object} [out]  a createBand() result to fill (then nothing is allocated)
 */
export function trunkBand(layout, aspect, { camY = HERO_REF_Y, seeds = null, css = null } = {}, out = createBand()) {
    restLens(aspect, bandLens);
    const { k, w } = aspectWeights(bandLens.aspect, bandWeights);
    out.aspect = bandLens.aspect;
    out.camY = camY;
    out.k = k;
    out.w = w;
    leanK = HERO_LEAN_UPRIGHT + (1 - HERO_LEAN_UPRIGHT) * k;
    // No layout: the solo fallback the world itself stands in for one.
    const source = layout?.cards?.length ? layout : fallbackFor(bandLens.aspect, css?.width, css?.height);
    // The rects to keep clear, and the cards' union (the formulas read it).
    let count = 0;
    const u = bandUnion;
    u.x0 = Infinity;
    u.y0 = Infinity;
    u.x1 = -Infinity;
    u.y1 = -Infinity;
    for (let i = 0; i < source.cards.length && count < MAX_RECTS - 1; i++) {
        const c = source.cards[i];
        if (!onScreen(c)) continue;
        Object.assign(bandRects[count++], c);
        u.x0 = Math.min(u.x0, c.x0);
        u.y0 = Math.min(u.y0, c.y0);
        u.x1 = Math.max(u.x1, c.x1);
        u.y1 = Math.max(u.y1, c.y1);
    }
    if (!count) {
        Object.assign(u, fallbackCard(bandLens.aspect * FALLBACK_HEIGHT, FALLBACK_HEIGHT));
        Object.assign(bandRects[count++], u);
    }
    const hud = hudBeside(source.hud, u) ? source.hud : null;
    if (hud) Object.assign(bandRects[count++], hud);
    // The keep-outs: every card and any HUD on screen, stood round or not.
    const cards = hud ? count - 1 : count;
    const keep = cards + (onScreen(source.hud) ? 1 : 0);
    out.keepOutCount = keep;
    for (let i = 0; i < keep; i++) {
        const r = i < cards ? bandRects[i] : source.hud;
        const o = out.keepOut[i];
        o.x0 = r.x0 - LANE_MARGIN;
        o.y0 = r.y0 - LANE_MARGIN;
        o.x1 = r.x1 + LANE_MARGIN;
        o.y1 = r.y1 + LANE_MARGIN;
    }

    const { placements } = out;
    const elder = placements[0];
    const one = placements[1];
    const two = placements[2];
    const r1a = placements[3];
    const r1b = placements[4];
    const twinA = placements[5];
    const twinB = placements[6];
    const rightOf = Math.max(u.x1, hud ? hud.x1 : u.x1);

    // The Elder: a cropped wall on the left.
    const elderSeed = seedFor('Elder', seeds);
    const elderZ = -(9 - w);
    const elderGoal = u.x0 - u.x0 * (0.08 + 0.26 * k);
    const elderX = placeClear(elder.trunk, elderSeed, elderZ, rightEdge, elderGoal, camY, bandRects, count, -1);
    settlePlace(elder, elderSeed, elderX, elderZ, true, camY);

    // Sister One, just right of the HUD (or of the card when the HUD is not beside it); on an
    // upright frame with the HUD beside the card she runs off the right edge as its band, or,
    // with less than SISTER_BAND of the frame left for her, the right edge is air.
    const oneSeed = seedFor('Sister One', seeds);
    const oneZ = one.trunk.z;
    const oneX = placeClear(one.trunk, oneSeed, oneZ, leftEdge, rightOf + 0.012 + 0.063 * k, camY, bandRects, count, 1);
    settlePlace(one, oneSeed, oneX, oneZ, true, camY);
    one.show = one.x0 <= 1 - SISTER_BAND;

    // Sister Two, deep beyond her with a band of air on every row; never on an upright screen or
    // off the right edge.
    const twoSeed = seedFor('Sister Two', seeds);
    const twoZ = two.trunk.z;
    const oneEdges = rightEdges(one, oneSeed, camY);
    const twoX = placeBeyond(two.trunk, twoSeed, twoZ, oneEdges, SISTER_GAP, camY, bandRects, count);
    settlePlace(two, twoSeed, twoX, twoZ, false, camY);
    two.show = bandLens.aspect >= 1 && two.x1 < 0.97;

    // R1a in the left air lane, if it can hold her clear of both sides.
    const r1aSeed = seedFor('R1a', seeds);
    const laneL = elder.x1 + LANE_MARGIN;
    const laneR = u.x0 - LANE_MARGIN;
    const r1aX = placeClear(r1a.trunk, r1aSeed, r1a.trunk.z, centreOf, (laneL + laneR) / 2, camY, bandRects, count, -1);
    settlePlace(r1a, r1aSeed, r1aX, r1a.trunk.z, true, camY);
    r1a.show = r1a.x0 >= laneL - 1e-4 && r1a.x1 <= laneR + 1e-4;

    // R1b in the air right of the card and HUD: only where she keeps a band of air on both sides.
    const r1bSeed = seedFor('R1b', seeds);
    const r1bX = placeClear(r1b.trunk, r1bSeed, r1b.trunk.z, leftEdge, rightOf + HUD_AIR, camY, bandRects, count, 1);
    settlePlace(r1b, r1bSeed, r1bX, r1b.trunk.z, false, camY);
    r1b.show = r1b.x0 >= rightOf + HUD_AIR - 1e-4 && r1b.x1 + R1B_GAP <= one.x0 && r1b.x1 < 0.98;

    // The Twin, only when the frame is ultrawide: one fused silhouette beyond Sister Two.
    const ultra = w >= 0.5;
    const before = two.show ? two : one;
    const twinZ = twinA.trunk.z;
    const edges = rightEdges(before, two.show ? twoSeed : oneSeed, camY);
    const twinX = placeBeyond(twinA.trunk, TWIN_SEEDS[0], twinZ, edges, SISTER_GAP, camY, bandRects, count);
    settlePlace(twinA, TWIN_SEEDS[0], twinX, twinZ, false, camY);
    settlePlace(twinB, TWIN_SEEDS[1], twinX + (twinB.trunk.x - twinA.trunk.x), twinB.trunk.z, false, camY);
    twinA.show = ultra && twinA.x0 < 0.97;
    twinB.show = twinA.show;

    // The peel lanes: the Elder's card-facing side, Sister One's sunlit side (her card-facing side
    // when her outer side is off the right edge).
    const laneE = out.lanes[0];
    const laneS = out.lanes[1];
    const thetaE = silhouetteTheta(elder.x, elder.z, elder.radius, 1);
    // (On a narrow frame the Elder's face is a band at the left edge: her lane narrows until it
    // stands on screen, never under LANE_LEAST.)
    let widthE = LANE_WIDTH.elder;
    writeLane(laneE, elder, thetaE + LANE_INSET, widthE);
    while (laneE.x0 < LANE_EDGE && widthE > LANE_LEAST) {
        widthE = Math.max(LANE_LEAST, widthE - 2 * (Math.PI / 180));
        writeLane(laneE, elder, thetaE + LANE_INSET, widthE);
    }
    laneE.side = 'card';
    const outerOn = one.x1 < 0.985;
    if (outerOn) {
        writeLane(laneS, one, silhouetteTheta(one.x, one.z, one.radius, 1) + LANE_INSET, LANE_WIDTH.sister);
        laneS.side = 'sun';
    } else {
        const thetaL = silhouetteTheta(one.x, one.z, one.radius, -1) - LANE_INSET - LANE_WIDTH.sister;
        writeLane(laneS, one, thetaL, LANE_WIDTH.sister);
        laneS.side = 'card';
    }
    return out;
}
