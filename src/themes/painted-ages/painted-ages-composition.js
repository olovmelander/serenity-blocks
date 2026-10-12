/**
 * Painted Ages — composition (CPU only, three-free).
 *
 * One diagonal sweep leads from the near crest at lower left to the far ranks at upper right.
 * The low rhyolite basin is a foreground pocket. Two deposition fronts sit at different depths,
 * with pale pour lanes beside the live card; upright screens gather both lanes below the card.
 * Card, board and HUD rects use screen fractions with y down. Bow placement uses the same
 * physical antisolar geometry as the sky, and reports when framing cannot satisfy every bound.
 */
import { PORTRAIT_RIG } from './painted-ages-core.js';

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

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const radians = (degrees) => (degrees * Math.PI) / 180;
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/** Half a board cell is kept clear beyond the card/HUD, as well as the effect's own radius. */
function cellSize(layout) {
    const board = boardFor(layout);
    return board ? {
        x: (board.x1 - board.x0) / BOARD_GRID.columns,
        y: (board.y1 - board.y0) / BOARD_GRID.rows,
    } : { x: 0.025, y: 0.04 };
}

function layoutAspect(layout) {
    const cell = cellSize(layout);
    return clamp(cell.y / Math.max(0.0001, cell.x), 0.2, 5);
}

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

function laneClear(layout, head, foot, margin) {
    // A segment intersects a rectangle iff the intervals of its x and y slabs overlap.
    // Unlike point sampling, this also catches a narrow HUD between the two endpoints.
    const rects = [...(layout?.cards || []), layout?.hud].filter(Boolean);
    return rects.every((r) => {
        let enter = 0;
        let leave = 1;
        for (const [axis, low, high] of [['x', 'x0', 'x1'], ['y', 'y0', 'y1']]) {
            const d = foot[axis] - head[axis];
            const min = r[low] - margin[axis];
            const max = r[high] + margin[axis];
            if (Math.abs(d) < 1e-12) {
                if (head[axis] < min || head[axis] > max) return true;
            } else {
                const a = (min - head[axis]) / d;
                const b = (max - head[axis]) / d;
                enter = Math.max(enter, Math.min(a, b));
                leave = Math.min(leave, Math.max(a, b));
                if (enter > leave) return true;
            }
        }
        return enter > leave;
    });
}

function frontCandidate(layout, id, aspect, column = 0.5, row = 0.5) {
    const cell = cellSize(layout);
    const margin = { x: cell.x + 0.004, y: cell.y + 0.004 };
    const union = cardUnion(layout);
    const phone = aspect < 0.62;
    const width = Math.max(0.009, cell.x);
    const edge = Math.max(0.018, width * 0.5);
    const target = phone ? {
        x: 0.1 + column * 0.8,
        y: Math.max(0.77, (union?.y1 ?? 0.72) + margin.y + 0.003),
    } : {
        x: id === 0 ? (union?.x0 ?? 0.4) - margin.x - 0.035
            : (union?.x1 ?? 0.6) + margin.x + 0.07,
        y: (id === 0 ? 0.59 : 0.43) + (row - 0.5) * 0.27,
    };
    let best = null;
    let distance = Infinity;
    // Search screen lanes, not just endpoints: multiplayer cards may cover either flank.
    for (let xi = 0; xi <= 48; xi++) {
        const x = edge + ((1 - 2 * edge) * xi) / 48;
        for (let yi = 0; yi <= 20; yi++) {
            const y = phone ? target.y + yi * 0.005 : 0.34 + yi * 0.023;
            const length = phone ? Math.min(cell.y * 4.2, 0.995 - y) : Math.max(cell.y * 4.2, 0.14);
            if (length < cell.y * 1.5 || y + length > 0.995) continue;
            const head = { x, y };
            const drift = id === 0 ? -0.035 : 0.025;
            const foot = { x: clamp(x + (phone ? 0 : drift), edge, 1 - edge), y: y + length };
            if (!laneClear(layout, head, foot, margin)) continue;
            const score = (x - target.x) ** 2 * (phone ? 4 : 1) + (y - target.y) ** 2;
            if (score < distance) {
                distance = score;
                best = { head, foot };
            }
        }
    }
    // A viewport completely covered by UI has no legal lane. Keep its pool dormant.
    const head = best?.head || { x: -2, y: -2 };
    const foot = best?.foot || { x: -2, y: -2 };
    return {
        id,
        depth: id === 0 ? 190 : 470,
        head,
        foot,
        pourLane: [head, foot],
        width: best ? width : 0,
        visible: !!best,
    };
}

/** Near/lower left and far/higher right front anchors; both become lower lanes on a phone. */
export function frontScreenPoints(layout, aspect = layoutAspect(layout)) {
    const ratio = clamp(finite(aspect, 16 / 9), 0.2, 5);
    return [frontCandidate(layout, 0, ratio, 0.28), frontCandidate(layout, 1, ratio, 0.72)];
}

/**
 * Aim a chute at this player's column and rows. Desktop rows choose a head on the appropriate
 * flank. On phones only the column chooses its lane below the card; row height cannot move it.
 * The returned screen/end aliases let instanced pools consume the same head/foot coordinates.
 */
export function pickChute(layout, player = 0, u = 0.5, rows = []) {
    const aspect = layoutAspect(layout);
    const column = clamp(finite(u, 0.5), 0, 1);
    const rowValues = (Array.isArray(rows) ? rows : [rows]).filter(Number.isFinite);
    const row = rowValues.length ? rowValues.reduce((a, b) => a + b, 0) / rowValues.length : 12;
    const own = boardFor(layout, player);
    const aim = own ? boardPoint(own, column, row) : { x: column, y: 0.65 };
    const union = cardUnion(layout);
    const center = union ? (union.x0 + union.x1) * 0.5 : 0.5;
    const front = aspect < 0.62 ? Number(column >= 0.5) : Number(aim.x >= center);
    const position = aspect < 0.62 ? column : clamp((aim.y - 0.34) / 0.46, 0, 1);
    const chute = Math.min(19, Math.floor(position * 20));
    const lane = frontCandidate(layout, front, aspect, (chute + 0.5) / 20, position);
    return {
        ...lane, front, chute: front * 20 + chute, player, screen: lane.head, end: lane.foot,
    };
}

/** Camera framing shared with the physical bow solver (degrees, y up in view space). */
export function bowCamera(aspect) {
    if (aspect < 0.62) return PORTRAIT_RIG;
    const landscapeFov = aspect > 2.1 ? 36 : 42;
    return {
        fov: landscapeFov,
        yaw: 0,
        pitch: -7,
    };
}

/**
 * Sample both physical bow legs above the world horizon. Azimuth is positive degrees LEFT
 * of the world view axis; returned x/y are screen fractions and may be outside the frame.
 * Radius is the angular distance from the true antisolar direction, never a screen ellipse.
 */
export function bowScreenPoints(azimuth, aspect, elevation = 12, sway = 0, radius = 42.3) {
    const camera = bowCamera(aspect);
    const pitch = radians(camera.pitch);
    const scale = Math.tan(radians(camera.fov) * 0.5);
    const e = radians(elevation);
    const anti = radians(180 - azimuth - sway - camera.yaw);
    const points = [];
    for (let altitude = 0; altitude <= radius - elevation; altitude += 0.75) {
        const h = radians(altitude);
        const cosine = (Math.cos(radians(radius)) + Math.sin(h) * Math.sin(e))
            / (Math.cos(h) * Math.cos(e));
        if (Math.abs(cosine) > 1) continue;
        const offset = Math.acos(clamp(cosine, -1, 1));
        for (const sign of [-1, 1]) {
            const az = anti + sign * offset;
            const x = Math.cos(h) * Math.sin(az);
            const y = Math.sin(h);
            const z = Math.cos(h) * Math.cos(az);
            const forward = z * Math.cos(pitch) + y * Math.sin(pitch);
            if (forward <= 0) continue;
            const up = y * Math.cos(pitch) - z * Math.sin(pitch);
            points.push({
                x: 0.5 + x / (2 * forward * scale * aspect),
                y: 0.5 - up / (2 * forward * scale),
                altitude,
                radius,
            });
        }
    }
    return points;
}

function sunScore(layout, aspect, azimuth) {
    let visibleSamples = 0;
    let overlapSamples = 0;
    let missingArcs = 0;
    let minimumClearSamples = Infinity;
    let minimumPrimarySkySamples = Infinity;
    const portrait = aspect < 0.62;
    const skyBottom = Math.min(0.985, (cardUnion(layout)?.y0 ?? 0.3) - 0.012);
    const cell = cellSize(layout);
    const margin = { x: Math.max(0.012, cell.x * 0.5), y: Math.max(0.012, cell.y * 0.5) };
    for (const elevation of [12, 22]) {
        for (let sway = -6; sway <= 6; sway += 2) {
            for (const radius of [40.4, 42.3, 50.4, 53.4]) {
                let clear = 0;
                let primarySky = 0;
                for (const p of bowScreenPoints(azimuth, aspect, elevation, sway, radius)) {
                    if (p.x < 0.015 || p.x > 0.985 || p.y < 0.015 || p.y > 0.985) continue;
                    visibleSamples++;
                    if (outsideKeepOut(layout, p, margin)) {
                        clear++;
                        if (radius < 43 && p.y < skyBottom) primarySky++;
                    } else overlapSamples++;
                }
                if (!clear) missingArcs++;
                minimumClearSamples = Math.min(minimumClearSamples, clear);
                if (radius < 43) minimumPrimarySkySamples = Math.min(minimumPrimarySkySamples, primarySky);
            }
        }
    }
    const preferred = aspect < 0.62 ? 140 : 115;
    // With the downward portrait lens, a sliver beside the card can sit behind the Chevron
    // Face. Keep a useful primary segment in the upper sky; secondary legs may crop instead.
    const primaryPenalty = portrait ? Math.max(0, 6 - minimumPrimarySkySamples) * 10000 : 0;
    const score = primaryPenalty + missingArcs * 2000 + overlapSamples * 4 - minimumClearSamples * 3
        - visibleSamples * 0.025 + Math.abs(azimuth - preferred) * 0.005;
    return {
        azimuth,
        visibleSamples,
        overlapSamples,
        missingArcs,
        minimumClearSamples,
        minimumPrimarySkySamples,
        score,
        clearSamples: visibleSamples - overlapSamples,
        fullyClear: overlapSamples === 0 && missingArcs === 0,
    };
}

/**
 * Layout geometry can make the concept's strict constraint impossible: a 53.4° radius arc is
 * wider than a phone's entire view, and a HUD can cover the only visible leg. Prefer a visible
 * primary segment in the phone's upper sky, then preserve secondary legs and minimize UI
 * overlap; the post's calm mask covers the remaining occluded leg. Diagnostics expose this
 * tradeoff instead of claiming a false fit. Landscape scoring preserves a piece of every arc.
 */
export function solveSunLayout(layout, aspect = layoutAspect(layout)) {
    const ratio = clamp(finite(aspect, 16 / 9), 0.2, 5);
    let best = null;
    for (let azimuth = 105; azimuth <= 145; azimuth += 0.5) {
        const candidate = sunScore(layout, ratio, azimuth);
        if (!best || candidate.score < best.score) best = candidate;
    }
    return best;
}

/** Positive degrees to the LEFT; add the time-varying ±6° sway after solving at layout time. */
export function solveSunAzimuth(layout, aspect = layoutAspect(layout)) {
    return solveSunLayout(layout, aspect).azimuth;
}
