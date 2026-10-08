import { describe, expect, it } from 'vitest';
import {
    BOARD_GRID, PLAYER_SLOTS, boardFor, boardPoint, cardFor, cardUnion, fallbackLayout, layoutsDiffer, placeEcho,
    readLayoutRects, rectToTide,
} from '../../src/themes/aether-tides/aether-tides-composition.js';
import {
    AETHER_PALETTES, EVENT_ROWS, GYRE_ROWS, GYRE_SLOTS, NOVA_LIFE, PALETTE_KEYS, RING_LIFE, RING_ROWS, RING_SLOTS,
    RING_TAU, ROW_GYRE, ROW_RING, ROW_SPLAT, ROW_STAR, ROW_WELL, SIM_DT, SPLAT_CELL, SPLAT_ROUND, SPLAT_ROWS,
    SPLAT_SLOTS, STARFIRE, STAR_ROWS, STAR_SLOTS, TIDE_PERIOD, WELL_ROWS, WELL_SLOTS, approach, clamp01, lerp,
    linRGB, maelstromPosition, mulberry32, pieceColor, powerForCombo, ringPassTime, ringRadius, smooth, starSeat,
    tideStarPosition, wideness,
} from '../../src/themes/aether-tides/aether-tides-core.js';
import { TideEvents } from '../../src/themes/aether-tides/aether-tides-events.js';
import { AETHER_TIDES_TETROMINOS } from '../../src/themes/aether-tides/aether-tides-tetrominos.js';

const WIDE = 16 / 9;

/** Frames the sky is composed for: desktops, an ultrawide, a phone on its side, tablets and phones upright. */
const FRAMES = [
    [1600, 900], [1920, 1080], [2560, 1080], [3440, 1440], [1280, 1024], [1024, 768], [844, 390],
    // Squarish frames and upright tablets: the sky is still beside the card there.
    [1100, 1000], [1000, 1000], [768, 1024], [820, 1180],
    // Upright phones and narrow tablets: the sky is above and below it.
    [800, 1280], [430, 932], [390, 844],
];

/** The stylesheet's solo card for a frame, in tide space. */
function soloCard(width, height) {
    return rectToTide(fallbackLayout(width, height).cards[0], width / height);
}

/** How far a point stands outside a rect (0 = on it or inside). */
function gapTo(rect, x, y) {
    return Math.hypot(Math.max(rect.x0 - x, 0, x - rect.x1), Math.max(rect.y0 - y, 0, y - rect.y1));
}

const moved = (box, echo) => ({
    x0: box.x0 + echo.dx, y0: box.y0 + echo.dy, x1: box.x1 + echo.dx, y1: box.y1 + echo.dy,
});
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

describe('aether tides composition: the layout', () => {
    it('lays the solo board out from the stylesheet\'s formulas before a card exists', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [430, 932]]) {
            const layout = fallbackLayout(width, height);
            const card = layout.cards[0];
            const board = layout.boards[0];
            expect(layout.cardCount).toBe(0); // nothing is on screen: these are the stylesheet's sums
            expect(layout.cards).toHaveLength(1);
            expect(layout.boards).toHaveLength(PLAYER_SLOTS);
            expect(layout.boards.slice(1).every((b) => b === null)).toBe(true);
            expect((card.x0 + card.x1) / 2).toBeCloseTo(0.5, 9);
            expect((board.x0 + board.x1) / 2).toBeCloseTo(0.5, 9);
            expect(board.x0).toBeGreaterThan(card.x0);
            expect(board.x1).toBeLessThan(card.x1);
            expect(board.y0).toBeGreaterThan(card.y0);
            expect(board.y1).toBeLessThan(card.y1);
            // Ten columns by twenty rows of square cells.
            const cell = ((board.x1 - board.x0) * width) / BOARD_GRID.columns;
            expect(((board.y1 - board.y0) * height) / BOARD_GRID.rows).toBeCloseTo(cell, 6);
            // The playfield sits nearer the card's foot than its head.
            expect(card.y1 - board.y1).toBeLessThan(board.y0 - card.y0);
            // The stats bar stands to the right of the stage.
            expect(layout.hud.x0).toBeGreaterThan(card.x1);
            expect(cardUnion(layout)).toEqual(card);
            expect(boardFor(layout, 0)).toBe(board);
        }
        // Nonsense sizes still give finite rects.
        for (const layout of [fallbackLayout(0, 0), fallbackLayout(NaN, undefined), fallbackLayout(-5, 100)]) {
            for (const rect of [layout.cards[0], layout.boards[0], layout.hud]) {
                for (const key of ['x0', 'y0', 'x1', 'y1']) expect(Number.isFinite(rect[key])).toBe(true);
            }
        }
    });

    it('maps a column and a row onto the screen through the board rect, without allocating', () => {
        const board = {
            x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.9,
        };
        const out = { x: 0, y: 0 };
        expect(boardPoint(board, 0.5, 9, out)).toBe(out);
        expect(out.x).toBeCloseTo(0.5, 9);
        // Rows are measured to their centre line, one board-height / rows apart.
        const row = (board.y1 - board.y0) / BOARD_GRID.rows;
        expect(out.y).toBeCloseTo(board.y0 + row * 9.5, 9);
        expect(boardPoint(board, 0.5, 10).y - out.y).toBeCloseTo(row, 9);
        // The floor row is the last one; anything past the grid is clamped onto it.
        const floor = boardPoint(board, 0.5, BOARD_GRID.rows - 1);
        expect(boardPoint(board, -3, 400)).toEqual({ x: board.x0, y: floor.y });
        const head = boardPoint(board, 7, -7);
        expect(head.x).toBeCloseTo(board.x1, 9);
        expect(head.y).toBeCloseTo(board.y0 + row * 0.5, 9);
    });

    it('reads the live card, board and HUD rects, and nothing when no board is on screen', () => {
        const rect = (left, top, width, height) => ({
            left, top, right: left + width, bottom: top + height, width, height,
        });
        const el = (r) => ({ getBoundingClientRect: () => r });
        const card = el(rect(600, 50, 400, 800));
        const canvas = el(rect(650, 200, 300, 600));
        const hud = el(rect(1050, 250, 140, 400));
        const hidden = el(rect(0, 0, 0, 0));
        const offscreen = el(rect(-900, 50, 400, 800));
        const asked = [];
        const doc = {
            querySelectorAll: (selector) => {
                asked.push(selector);
                return selector.includes('player-card') ? [card, hidden, offscreen] : [];
            },
            querySelector: (selector) => {
                if (selector === '#phaser-game-container canvas') return canvas;
                if (selector === '.single-player-stats-bar') return hud;
                return null;
            },
        };
        const win = {
            innerWidth: 1600,
            innerHeight: 900,
            getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        };
        const layout = readLayoutRects(doc, win);
        // Only gameplay boards: the lobby's avatar cards reuse .player-card without data-player.
        expect(asked).toEqual(['.player-card[data-player]']);
        expect(layout.cardCount).toBe(1);
        expect(layout.cards).toEqual([{
            x0: 0.375, y0: 50 / 900, x1: 0.625, y1: 850 / 900,
        }]);
        expect(layout.boards).toHaveLength(PLAYER_SLOTS);
        expect(layout.boards[0].x0).toBeCloseTo(650 / 1600, 9);
        expect(layout.boards[0].y1).toBeCloseTo(800 / 900, 9);
        expect(layout.boards.slice(1).every((b) => b === null)).toBe(true);
        expect(layout.hud.x1).toBeCloseTo(1190 / 1600, 9);
        expect(layoutsDiffer(layout, readLayoutRects(doc, win))).toBe(false);
        expect(layoutsDiffer(layout, fallbackLayout(1600, 900))).toBe(true);

        // A card the stylesheet hides is not a board on screen.
        for (const style of [{ display: 'none' }, { visibility: 'hidden' }, { opacity: '0' }]) {
            const veiled = {
                ...win,
                getComputedStyle: () => ({
                    display: 'block', visibility: 'visible', opacity: '1', ...style,
                }),
            };
            expect(readLayoutRects(doc, veiled)).toBeNull();
        }
        const empty = { querySelectorAll: () => [], querySelector: () => null };
        expect(readLayoutRects(empty, win)).toBeNull();
        expect(readLayoutRects(null, win)).toBeNull();
        expect(readLayoutRects(doc, null)).toBeNull();
        expect(readLayoutRects({}, win)).toBeNull();
    });

    it('reads every local-multiplayer board into its own player slot', () => {
        const rect = (left, top, width, height) => ({
            left, top, right: left + width, bottom: top + height, width, height,
        });
        const el = (r) => ({ getBoundingClientRect: () => r });
        const cards = [el(rect(40, 100, 360, 700)), el(rect(440, 100, 360, 700)), el(rect(840, 100, 360, 700))];
        const canvases = {
            '#p1-phaser-container canvas': el(rect(70, 180, 300, 600)),
            '#p2-phaser-container canvas': el(rect(470, 180, 300, 600)),
            '#p3-phaser-container canvas': el(rect(870, 180, 300, 600)),
        };
        const doc = {
            querySelectorAll: () => cards,
            querySelector: (selector) => canvases[selector] ?? null,
        };
        const layout = readLayoutRects(doc, { innerWidth: 1600, innerHeight: 900 });
        expect(layout.cardCount).toBe(3);
        expect(layout.hud).toBeNull();
        expect(layout.boards[0]).toBeNull();
        expect(layout.boards[2].x0).toBeCloseTo(470 / 1600, 9);
        expect(layout.boards[4]).toBeNull();
        // A slot with no board of its own aims at the first board on screen.
        expect(boardFor(layout, 2)).toBe(layout.boards[2]);
        expect(boardFor(layout, 0)).toBe(layout.boards[1]);
        expect(boardFor(layout, 4)).toBe(layout.boards[1]);
        // Each board sits in its own card.
        expect(cardFor(layout, layout.boards[1])).toBe(layout.cards[0]);
        expect(cardFor(layout, layout.boards[3])).toBe(layout.cards[2]);
        expect(cardUnion(layout)).toEqual({
            x0: 40 / 1600, y0: 100 / 900, x1: 1200 / 1600, y1: 800 / 900,
        });
    });

    it('finds the card a board sits in, and falls back to the first card', () => {
        const a = {
            x0: 0.05, y0: 0.2, x1: 0.3, y1: 0.8,
        };
        const b = {
            x0: 0.35, y0: 0.1, x1: 0.6, y1: 0.7,
        };
        const layout = { cards: [a, b] };
        expect(cardFor(layout, {
            x0: 0.4, y0: 0.3, x1: 0.55, y1: 0.65,
        })).toBe(b);
        expect(cardFor(layout, {
            x0: 0.1, y0: 0.3, x1: 0.25, y1: 0.75,
        })).toBe(a);
        // A board outside every card, or none at all: the first card.
        expect(cardFor(layout, {
            x0: 0.8, y0: 0.3, x1: 0.95, y1: 0.75,
        })).toBe(a);
        expect(cardFor(layout, null)).toBe(a);
        expect(cardFor({ cards: [] }, a)).toBeNull();
        expect(cardFor(null, a)).toBeNull();
        expect(boardFor(null)).toBeNull();
        expect(boardFor({ boards: [null, null] }, 1)).toBeNull();
        expect(cardUnion({ cards: [] })).toBeNull();
        expect(cardUnion(null)).toBeNull();
        // The union is a copy: the first card is not widened in place.
        const union = cardUnion(layout);
        expect(union).not.toBe(a);
        expect(a.x1).toBe(0.3);
        expect(union).toEqual({
            x0: 0.05, y0: 0.1, x1: 0.6, y1: 0.8,
        });
    });

    it('tells two layout reads apart only when a rect has really moved', () => {
        const base = fallbackLayout(1600, 900);
        const copy = () => JSON.parse(JSON.stringify(base));
        expect(layoutsDiffer(base, copy())).toBe(false);
        expect(layoutsDiffer(null, null)).toBe(false);
        expect(layoutsDiffer(base, null)).toBe(true);
        expect(layoutsDiffer(null, base)).toBe(true);
        // Sub-pixel jitter is the same layout; a real move is not.
        const jitter = copy();
        jitter.cards[0].x0 += 0.001;
        jitter.boards[0].y1 -= 0.001;
        expect(layoutsDiffer(base, jitter)).toBe(false);
        expect(layoutsDiffer(base, jitter, 0.0005)).toBe(true);
        const movedCard = copy();
        movedCard.cards[0].x0 += 0.02;
        expect(layoutsDiffer(base, movedCard)).toBe(true);
        const secondBoard = copy();
        secondBoard.boards[3] = { ...base.boards[0] };
        expect(layoutsDiffer(base, secondBoard)).toBe(true);
        const noHud = copy();
        noHud.hud = null;
        expect(layoutsDiffer(base, noHud)).toBe(true);
        const counted = copy();
        counted.cardCount = 1;
        expect(layoutsDiffer(base, counted)).toBe(true);
    });

    it('turns a screen rect into tide space: the origin at the centre, y down, one unit half the height', () => {
        const out = {
            x0: 9, y0: 9, x1: 9, y1: 9,
        };
        const whole = rectToTide({
            x0: 0, y0: 0, x1: 1, y1: 1,
        }, WIDE, out);
        expect(whole).toBe(out);
        expect(whole.x0).toBeCloseTo(-WIDE, 12);
        expect(whole.x1).toBeCloseTo(WIDE, 12);
        expect(whole.y0).toBe(-1);
        expect(whole.y1).toBe(1);
        // The upper left quarter of the screen: up is negative.
        expect(rectToTide({
            x0: 0, y0: 0, x1: 0.5, y1: 0.5,
        }, 2)).toEqual({
            x0: -2, y0: -1, x1: 0, y1: 0,
        });
        // A square on screen stays a square in tide space, whatever the frame.
        for (const [width, height] of FRAMES) {
            const side = 120;
            const tide = rectToTide({
                x0: 0.1, y0: 0.2, x1: 0.1 + side / width, y1: 0.2 + side / height,
            }, width / height);
            expect(tide.x1 - tide.x0).toBeCloseTo(tide.y1 - tide.y0, 9);
            expect(tide.y1 - tide.y0).toBeCloseTo((side / height) * 2, 9);
        }
    });
});

describe('aether tides composition: where a lock\'s echo goes', () => {
    const card = {
        x0: -0.4, y0: -0.85, x1: 0.4, y1: 0.85,
    };
    const hud = {
        x0: 0.52, y0: -0.43, x1: 0.83, y1: 0.43,
    };
    const gap = 0.05;
    /** A piece low on the board, below the HUD's rows; and one at the HUD's height. */
    const low = {
        x0: -0.2, y0: 0.65, x1: 0, y1: 0.78,
    };
    const mid = {
        x0: -0.2, y0: -0.1, x1: 0, y1: 0.03,
    };

    it('moves the footprint straight out of the card on the preferred side, keeping its rows', () => {
        const left = placeEcho({
            box: low, card, obstacles: [hud], aspect: WIDE, gap, prefer: -1,
        });
        expect(left).toMatchObject({
            dy: 0, nx: -1, ny: 0, placed: true,
        });
        // Its near edge stands one gap outside the card.
        expect(low.x1 + left.dx).toBeCloseTo(card.x0 - gap, 9);
        const right = placeEcho({
            box: low, card, obstacles: [hud], aspect: WIDE, gap, prefer: 1,
        });
        expect(right).toMatchObject({
            dy: 0, nx: 1, ny: 0, placed: true,
        });
        expect(low.x0 + right.dx).toBeCloseTo(card.x1 + gap, 9);
        // The same piece, mirrored: the two echoes are different places.
        expect(right.dx).toBeGreaterThan(0);
        expect(left.dx).toBeLessThan(0);
        for (const echo of [left, right]) {
            expect(overlaps(moved(low, echo), card)).toBe(false);
            expect(Math.abs(moved(low, echo).x0)).toBeLessThan(WIDE);
            expect(Math.abs(moved(low, echo).x1)).toBeLessThan(WIDE);
        }
        // No preference is the left side; the input is never written to.
        expect(placeEcho({
            box: low, card, aspect: WIDE, gap,
        })).toEqual(left);
        expect(low).toEqual({
            x0: -0.2, y0: 0.65, x1: 0, y1: 0.78,
        });
    });

    it('writes into the object it is handed', () => {
        const out = {
            dx: 9, dy: 9, nx: 9, ny: 9, placed: false,
        };
        expect(placeEcho({
            box: low, card, obstacles: [], aspect: WIDE, gap, prefer: 1,
        }, out)).toBe(out);
        expect(out).toEqual({
            dx: card.x1 + gap - low.x0, dy: 0, nx: 1, ny: 0, placed: true,
        });
    });

    it('steps past a HUD that stands in the piece\'s rows, and not past one that does not', () => {
        // At the HUD's height there is no room between the card and the HUD: go beyond it.
        const beyond = placeEcho({
            box: mid, card, obstacles: [hud], aspect: WIDE, gap, prefer: 1,
        });
        expect(beyond).toMatchObject({ nx: 1, ny: 0, placed: true });
        expect(mid.x0 + beyond.dx).toBeCloseTo(hud.x1 + gap, 9);
        expect(overlaps(moved(mid, beyond), hud)).toBe(false);
        // Below the HUD's rows the echo sits right beside the card, under the HUD's column.
        const beside = placeEcho({
            box: low, card, obstacles: [hud], aspect: WIDE, gap, prefer: 1,
        });
        expect(low.x0 + beside.dx).toBeCloseTo(card.x1 + gap, 9);
        expect(overlaps(moved(low, beside), hud)).toBe(false);
        // A HUD far enough off leaves room for the footprint before it.
        const far = { ...hud, x0: 0.75, x1: 1.05 };
        const before = placeEcho({
            box: mid, card, obstacles: [far], aspect: WIDE, gap, prefer: 1,
        });
        expect(mid.x0 + before.dx).toBeCloseTo(card.x1 + gap, 9);
        expect(mid.x1 + before.dx).toBeLessThanOrEqual(far.x0 - gap);
        // The HUD is on the right: a piece sent left never meets it.
        const left = placeEcho({
            box: mid, card, obstacles: [hud], aspect: WIDE, gap, prefer: -1,
        });
        expect(mid.x1 + left.dx).toBeCloseTo(card.x0 - gap, 9);
    });

    it('steps past a row of neighbouring boards to the open sky beyond them', () => {
        const second = {
            x0: -1.25, y0: -0.85, x1: -0.5, y1: 0.85,
        };
        const echo = placeEcho({
            box: mid, card, obstacles: [second], aspect: 2.4, gap, prefer: -1,
        });
        expect(echo).toMatchObject({ nx: -1, placed: true });
        expect(mid.x1 + echo.dx).toBeCloseTo(second.x0 - gap, 9);
        // Two of them, listed in either order: beyond both.
        const third = {
            x0: -2.05, y0: -0.85, x1: -1.3, y1: 0.85,
        };
        for (const obstacles of [[second, third], [third, second]]) {
            const out = placeEcho({
                box: mid, card, obstacles, aspect: 2.4, gap, prefer: -1,
            });
            expect(out).toMatchObject({ nx: -1, placed: true });
            expect(mid.x1 + out.dx).toBeCloseTo(third.x0 - gap, 9);
            expect(mid.x0 + out.dx).toBeGreaterThan(-2.4);
        }
        // A third board that reaches the edge of the screen leaves nothing beyond it: the other side.
        const last = { ...third, x0: -2.3 };
        for (const obstacles of [[second, last], [last, second]]) {
            const out = placeEcho({
                box: mid, card, obstacles, aspect: 2.4, gap, prefer: -1,
            });
            expect(out).toMatchObject({ nx: 1, placed: true });
            expect(mid.x0 + out.dx).toBeCloseTo(card.x1 + gap, 9);
        }
    });

    it('falls to the other side when the preferred one has no room', () => {
        // A neighbouring board fills the sky to the left.
        const neighbour = {
            x0: -1.75, y0: -0.85, x1: -0.5, y1: 0.85,
        };
        const echo = placeEcho({
            box: low, card, obstacles: [neighbour], aspect: WIDE, gap, prefer: -1,
        });
        expect(echo).toMatchObject({
            dy: 0, nx: 1, ny: 0, placed: true,
        });
        expect(low.x0 + echo.dx).toBeCloseTo(card.x1 + gap, 9);
        // A card standing against the left edge of the screen.
        const edge = {
            x0: -1.74, y0: -0.85, x1: -0.9, y1: 0.85,
        };
        const box = {
            x0: -1.5, y0: 0.2, x1: -1.3, y1: 0.33,
        };
        const out = placeEcho({
            box, card: edge, aspect: WIDE, gap, prefer: -1,
        });
        expect(out).toMatchObject({ nx: 1, placed: true });
        expect(box.x0 + out.dx).toBeCloseTo(edge.x1 + gap, 9);
        // And against the right one, preferring the right.
        const mirrored = placeEcho({
            box: {
                x0: 1.3, y0: 0.2, x1: 1.5, y1: 0.33,
            },
            card: {
                x0: 0.9, y0: -0.85, x1: 1.74, y1: 0.85,
            },
            aspect: WIDE,
            gap,
            prefer: 1,
        });
        expect(mirrored).toMatchObject({ nx: -1, placed: true });
        expect(1.5 + mirrored.dx).toBeCloseTo(0.9 - gap, 9);
    });

    it('goes above or below on an upright screen, whichever is nearer the piece', () => {
        const aspect = 0.46;
        const tall = {
            x0: -0.4, y0: -0.6, x1: 0.4, y1: 0.6,
        };
        const upper = {
            x0: -0.1, y0: -0.4, x1: 0.1, y1: -0.27,
        };
        const lower = {
            x0: -0.1, y0: 0.3, x1: 0.1, y1: 0.43,
        };
        const up = placeEcho({
            box: upper, card: tall, aspect, gap, prefer: -1,
        });
        expect(up).toMatchObject({
            dx: 0, nx: 0, ny: -1, placed: true,
        });
        // It keeps its columns and stands one gap above the card.
        expect(upper.y1 + up.dy).toBeCloseTo(tall.y0 - gap, 9);
        const down = placeEcho({
            box: lower, card: tall, aspect, gap, prefer: 1,
        });
        expect(down).toMatchObject({
            dx: 0, nx: 0, ny: 1, placed: true,
        });
        expect(lower.y0 + down.dy).toBeCloseTo(tall.y1 + gap, 9);
        for (const [box, echo] of [[upper, up], [lower, down]]) {
            expect(overlaps(moved(box, echo), tall)).toBe(false);
            expect(Math.abs(moved(box, echo).y0)).toBeLessThan(1);
            expect(Math.abs(moved(box, echo).y1)).toBeLessThan(1);
        }
        // Something fills the sky under the card: the lower piece goes above instead.
        const bar = {
            x0: -0.45, y0: 0.62, x1: 0.45, y1: 1,
        };
        const over = placeEcho({
            box: lower, card: tall, obstacles: [bar], aspect, gap, prefer: 1,
        });
        expect(over).toMatchObject({ dx: 0, ny: -1, placed: true });
        expect(lower.y1 + over.dy).toBeCloseTo(tall.y0 - gap, 9);
        // A bar that is not over the piece's columns is not in its way.
        const aside = { ...bar, x0: 0.2 };
        expect(placeEcho({
            box: lower, card: tall, obstacles: [aside], aspect, gap, prefer: 1,
        }).ny).toBe(1);
        // A piece one cell wide still fits beside the card: sideways is always tried first.
        const sliver = {
            x0: -0.02, y0: 0.3, x1: 0, y1: 0.43,
        };
        const roomy = {
            x0: -0.34, y0: -0.6, x1: 0.34, y1: 0.6,
        };
        expect(placeEcho({
            box: sliver, card: roomy, aspect, gap, prefer: -1,
        })).toMatchObject({ nx: -1, ny: 0, placed: true });
    });

    it('stays where the piece is when nothing fits', () => {
        const full = {
            x0: -0.45, y0: -0.97, x1: 0.45, y1: 0.97,
        };
        for (const prefer of [-1, 1]) {
            const echo = placeEcho({
                box: mid, card: full, aspect: 0.46, gap, prefer,
            });
            expect(echo).toEqual({
                dx: 0, dy: 0, nx: prefer, ny: 0, placed: false,
            });
        }
    });

    it('lands every piece of the fallback layouts in open sky, clear of the card and the HUD', () => {
        for (const [width, height] of FRAMES) {
            const aspect = width / height;
            const layout = fallbackLayout(width, height);
            const board = rectToTide(layout.boards[0], aspect);
            const solo = rectToTide(layout.cards[0], aspect);
            const bar = rectToTide(layout.hud, aspect);
            const cw = (board.x1 - board.x0) / BOARD_GRID.columns;
            const ch = (board.y1 - board.y0) / BOARD_GRID.rows;
            for (let column = 0; column <= BOARD_GRID.columns - 3; column += 1) {
                for (let row = 0; row <= BOARD_GRID.rows - 2; row += 3) {
                    // A piece three cells wide and two tall.
                    const box = {
                        x0: board.x0 + column * cw,
                        y0: board.y0 + row * ch,
                        x1: board.x0 + (column + 3) * cw,
                        y1: board.y0 + (row + 2) * ch,
                    };
                    for (const prefer of [-1, 1]) {
                        const echo = placeEcho({
                            box, card: solo, obstacles: [bar], aspect, gap: cw * 0.7, prefer,
                        });
                        const label = `${width}x${height} column ${column} row ${row} prefer ${prefer}`;
                        expect(echo.placed, label).toBe(true);
                        expect(Math.abs(echo.nx) + Math.abs(echo.ny), label).toBe(1);
                        const at = moved(box, echo);
                        expect(overlaps(at, solo), label).toBe(false);
                        expect(overlaps(at, bar), label).toBe(false);
                        expect(at.x0, label).toBeGreaterThanOrEqual(-aspect);
                        expect(at.x1, label).toBeLessThanOrEqual(aspect);
                        expect(at.y0, label).toBeGreaterThanOrEqual(-1);
                        expect(at.y1, label).toBeLessThanOrEqual(1);
                    }
                }
            }
        }
    });

    it('never returns a number that is not one, whatever it is handed', () => {
        const rand = mulberry32(90210);
        const between = (lo, hi) => lo + (hi - lo) * rand();
        const rectIn = (x0, x1, y0, y1) => {
            const a = between(x0, x1);
            const b = between(x0, x1);
            const c = between(y0, y1);
            const d = between(y0, y1);
            return {
                x0: Math.min(a, b), y0: Math.min(c, d), x1: Math.max(a, b), y1: Math.max(c, d),
            };
        };
        const check = (echo, label) => {
            for (const key of ['dx', 'dy', 'nx', 'ny']) {
                expect(Number.isFinite(echo[key]), `${label}.${key}`).toBe(true);
            }
            expect(typeof echo.placed, label).toBe('boolean');
            expect([-1, 0, 1], label).toContain(echo.nx);
            expect([-1, 0, 1], label).toContain(echo.ny);
            if (echo.placed) expect(Math.abs(echo.nx) + Math.abs(echo.ny), label).toBe(1);
            else expect([echo.dx, echo.dy], label).toEqual([0, 0]);
        };
        for (let i = 0; i < 600; i += 1) {
            const aspect = between(0.4, 2.5);
            const around = rectIn(-aspect, aspect, -1, 1);
            const box = rectIn(around.x0, around.x1, around.y0, around.y1);
            const obstacles = Array.from({ length: Math.floor(between(0, 5)) }, () => rectIn(-aspect, aspect, -1, 1));
            const echo = placeEcho({
                box, card: around, obstacles, aspect, gap: between(0, 0.1), prefer: rand() < 0.5 ? -1 : 1,
            });
            check(echo, `case ${i}`);
            if (echo.placed) {
                // Out of its own card, and on the screen.
                const at = moved(box, echo);
                expect(overlaps(at, around), `case ${i}`).toBe(false);
                expect(at.x0, `case ${i}`).toBeGreaterThanOrEqual(-aspect - 1e-9);
                expect(at.x1, `case ${i}`).toBeLessThanOrEqual(aspect + 1e-9);
                expect(at.y0, `case ${i}`).toBeGreaterThanOrEqual(-1 - 1e-9);
                expect(at.y1, `case ${i}`).toBeLessThanOrEqual(1 + 1e-9);
            }
        }
        // Degenerate input: a point for a piece, a point for a card, a piece outside its card, no gap.
        const point = {
            x0: 0.1, y0: 0.1, x1: 0.1, y1: 0.1,
        };
        check(placeEcho({
            box: point, card, aspect: WIDE, gap: 0, prefer: 1,
        }), 'point piece');
        check(placeEcho({
            box: mid, card: point, aspect: WIDE, gap: 0, prefer: -1,
        }), 'point card');
        check(placeEcho({
            box: {
                x0: 1.2, y0: -0.9, x1: 1.6, y1: -0.5,
            },
            card,
            obstacles: [card, hud],
            aspect: WIDE,
            prefer: 0,
        }), 'piece outside its card');
        check(placeEcho({
            box: mid, card, obstacles: [], aspect: 0.01, gap,
        }), 'a sliver of a screen');
    });
});

describe('aether tides core maths', () => {
    it('lays the event table out as consecutive blocks of rows', () => {
        expect(ROW_SPLAT).toBe(0);
        expect(ROW_RING).toBe(ROW_SPLAT + SPLAT_SLOTS * SPLAT_ROWS);
        expect(ROW_WELL).toBe(ROW_RING + RING_SLOTS * RING_ROWS);
        expect(ROW_STAR).toBe(ROW_WELL + WELL_SLOTS * WELL_ROWS);
        expect(ROW_GYRE).toBe(ROW_STAR + STAR_SLOTS * STAR_ROWS);
        expect(EVENT_ROWS).toBe(ROW_GYRE + GYRE_SLOTS * GYRE_ROWS);
        for (const count of [SPLAT_SLOTS, RING_SLOTS, WELL_SLOTS, STAR_SLOTS, GYRE_SLOTS]) {
            expect(Number.isInteger(count)).toBe(true);
            expect(count).toBeGreaterThan(0);
        }
        // One lock (six cells at most, its push, its breath, its spark, a hard drop's streak)
        // and a four-line clear (eight jets) fit in the table together.
        expect(SPLAT_SLOTS).toBeGreaterThanOrEqual(6 + 4 + 8);
        expect(SPLAT_ROUND).not.toBe(SPLAT_CELL);
    });

    it('runs a blast front out fast, slows it, and knows when it passes a point', () => {
        for (const reach of [0.42, 0.78, 2.5]) {
            expect(ringRadius(-1, reach)).toBe(0);
            expect(ringRadius(0, reach)).toBe(0);
            let previous = 0;
            let previousStep = Infinity;
            for (let i = 1; i <= 40; i += 1) {
                const radius = ringRadius(i * 0.08, reach);
                expect(radius).toBeGreaterThan(previous);
                expect(radius).toBeLessThan(reach);
                // It slows: every step covers less than the one before.
                expect(radius - previous).toBeLessThan(previousStep);
                previousStep = radius - previous;
                previous = radius;
            }
            // It is all but spent by the end of its life.
            expect(ringRadius(RING_LIFE, reach)).toBeGreaterThan(reach * 0.95);
            expect(ringRadius(RING_TAU, reach)).toBeCloseTo(reach * (1 - 1 / Math.E), 12);
            // The pass time is the front's inverse: a star goes nova exactly as it arrives.
            for (const dist of [0.001, 0.05, reach * 0.3, reach * 0.5, reach * 0.9, reach * 0.99]) {
                const pass = ringPassTime(dist, reach);
                expect(pass).toBeGreaterThan(0);
                expect(ringRadius(pass, reach)).toBeCloseTo(dist, 9);
            }
            for (const age of [0.01, 0.3, 1, 2.5]) {
                expect(ringPassTime(ringRadius(age, reach), reach)).toBeCloseTo(age, 9);
            }
            // Nearer points are passed first.
            expect(ringPassTime(reach * 0.2, reach)).toBeLessThan(ringPassTime(reach * 0.6, reach));
            expect(ringPassTime(0, reach)).toBeCloseTo(0, 12);
            expect(ringPassTime(-3, reach)).toBeCloseTo(0, 12);
            // A point the front never reaches is never passed.
            expect(ringPassTime(reach, reach)).toBe(Infinity);
            expect(ringPassTime(reach * 4, reach)).toBe(Infinity);
            expect(ringPassTime(NaN, reach)).toBe(Infinity);
        }
    });

    it('charges with the combo and never past full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-2)).toBe(0);
        expect(powerForCombo(1)).toBeGreaterThan(0);
        let previous = 0;
        for (let combo = 1; combo <= 30; combo += 1) {
            expect(powerForCombo(combo)).toBeGreaterThan(previous);
            previous = powerForCombo(combo);
        }
        expect(powerForCombo(500)).toBeLessThanOrEqual(1);
        expect(powerForCombo(NaN)).toBe(0);
    });

    it('eases, blends and clamps', () => {
        expect(clamp01(-2)).toBe(0);
        expect(clamp01(0.3)).toBe(0.3);
        expect(clamp01(7)).toBe(1);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect(smooth(0, 2, -1)).toBe(0);
        expect(smooth(0, 2, 1)).toBe(0.5);
        expect(smooth(0, 2, 5)).toBe(1);
        expect(smooth(1, 3, 1.5)).toBeLessThan(0.25); // it starts gently
        // The same share of the gap however the time is cut into frames.
        expect(approach(3, 0)).toBe(0);
        const whole = approach(3, 0.1);
        const halves = 1 - (1 - approach(3, 0.05)) ** 2;
        expect(halves).toBeCloseTo(whole, 12);
        expect(approach(3, 100)).toBeCloseTo(1, 12);
        expect(SIM_DT).toBeCloseTo(1 / 60, 12);
    });

    it('converts sRGB hex to scene-linear and seeds a repeatable generator', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff).every((c) => Math.abs(c - 1) < 1e-9)).toBe(true);
        expect(linRGB(0x808080)[0]).toBeCloseTo(0.2158, 3);
        expect(linRGB(0xff0000)).toEqual([1, 0, 0]);
        const a = mulberry32(7);
        const b = mulberry32(7);
        const other = mulberry32(8);
        let same = 0;
        for (let i = 0; i < 50; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            if (v === other()) same += 1;
        }
        expect(same).toBeLessThan(3);
    });

    it('gives a lock the piece\'s colour, peak-normalised, with a floor in every channel', () => {
        for (const [key, hex] of Object.entries(AETHER_TIDES_TETROMINOS.colors)) {
            const rgb = pieceColor(hex);
            expect(rgb, key).toHaveLength(3);
            expect(Math.max(...rgb), key).toBeCloseTo(1, 9);
            expect(Math.min(...rgb), key).toBeGreaterThanOrEqual(0.04 - 1e-12);
            // The hue survives: the channels keep the order they have in the piece's own colour.
            const plain = linRGB(Number.parseInt(hex.slice(1), 16));
            const order = (c) => [0, 1, 2].sort((i, j) => c[j] - c[i]).join('');
            expect(order(rgb), key).toBe(order(plain));
        }
        // A pastel is pushed toward its own hue: the weakest channel falls further than it would
        // by normalising alone.
        const pastel = pieceColor('#ffa8d0');
        const plain = linRGB(0xffa8d0);
        expect(pastel[1]).toBeLessThan(plain[1] / Math.max(...plain));
        expect(pastel[0]).toBeGreaterThan(pastel[2]);
        expect(pastel[2]).toBeGreaterThan(pastel[1]);
        // A pure primary still reaches every channel; a grey stays a grey; black is not nothing.
        expect(pieceColor(0x0000ff)).toEqual([0.04, 0.04, 1]);
        expect(pieceColor('#808080')).toEqual([1, 1, 1]);
        expect(pieceColor(0x000000).every((c) => c > 0 && Number.isFinite(c))).toBe(true);
        // With or without the hash, in either case.
        expect(pieceColor('2ce0ff')).toEqual(pieceColor('#2CE0FF'));
        expect(pieceColor(' #2ce0ff ')).toEqual(pieceColor(0x2ce0ff));
        // Nonsense falls back to the given colour, else to the nebula's violet.
        expect(pieceColor('teal', 0x00ff00)[1]).toBeCloseTo(1, 9);
        expect(pieceColor(null)).toEqual(pieceColor(undefined));
        expect(pieceColor(null)).toEqual(pieceColor(AETHER_TIDES_TETROMINOS.colors.O));
        expect(pieceColor(NaN, 0x123456)).toEqual(pieceColor(0x123456));
        expect(pieceColor('#12345')).toEqual(pieceColor(null));
    });

    it('defines every palette key for every level\'s palette, in scene-linear light', () => {
        expect(AETHER_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(AETHER_PALETTES.map((p) => p.name)).size).toBe(AETHER_PALETTES.length);
        for (const palette of AETHER_PALETTES) {
            expect(typeof palette.name).toBe('string');
            for (const key of PALETTE_KEYS) {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of palette[key]) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                }
            }
            // The empty sky is dark; the gas and the stars are not.
            expect(Math.max(...palette.deep), palette.name).toBeLessThan(0.1);
            for (const key of ['gasA', 'gasB', 'gasC', 'star', 'companion', 'shock']) {
                expect(Math.max(...palette[key]), `${palette.name}.${key}`).toBeGreaterThan(0.5);
            }
        }
        expect(STARFIRE).toHaveLength(3);
        // Starfire is warm: red over green over blue.
        expect(STARFIRE[0]).toBeGreaterThan(STARFIRE[1]);
        expect(STARFIRE[1]).toBeGreaterThan(STARFIRE[2]);
    });
});

describe('aether tides sky: the two great stars, the maelstrom and the seats', () => {
    const times = Array.from({ length: 240 }, (_, i) => i * 3.7);

    it('keeps the Tide Star and its companion on the screen and never behind the card', () => {
        for (const [width, height] of FRAMES) {
            const aspect = width / height;
            const card = soloCard(width, height);
            for (const index of [0, 1]) {
                for (const time of times) {
                    const star = tideStarPosition(index, time, aspect);
                    const label = `${width}x${height} star ${index} t=${time}`;
                    expect(Number.isFinite(star.x) && Number.isFinite(star.y), label).toBe(true);
                    expect(Math.abs(star.x), label).toBeLessThan(aspect);
                    expect(Math.abs(star.y), label).toBeLessThan(1);
                    expect(gapTo(card, star.x, star.y), label).toBeGreaterThan(0.05);
                }
            }
        }
    });

    it('stands them on opposite sides of the card: beside it on a wide screen, above and below on a tall one', () => {
        for (const [width, height] of FRAMES) {
            const aspect = width / height;
            const card = soloCard(width, height);
            for (const time of times) {
                const a = tideStarPosition(0, time, aspect);
                const b = tideStarPosition(1, time, aspect);
                const label = `${width}x${height} t=${time}`;
                if (wideness(aspect) === 1) {
                    expect(a.x, label).toBeLessThan(card.x0);
                    expect(b.x, label).toBeGreaterThan(card.x1);
                } else {
                    expect(a.y, label).toBeLessThan(card.y0);
                    expect(b.y, label).toBeGreaterThan(card.y1);
                }
                // The Tide Star is the upper one, its companion the lower.
                expect(a.y, label).toBeLessThan(b.y);
            }
        }
    });

    it('switches between the upright and the wide sky where no common screen sits', () => {
        // A slow blend between the two layouts would carry the stars and the maelstrom straight
        // across the card on a squarish frame: every frame here is wholly one or the other.
        for (const [width, height] of FRAMES) {
            const w = wideness(width / height);
            expect(w === 0 || w === 1, `${width}x${height}`).toBe(true);
        }
        expect(wideness(9 / 16)).toBe(0);
        expect(wideness(10 / 16)).toBe(0);
        expect(wideness(820 / 1180)).toBe(1);
        expect(wideness(3 / 4)).toBe(1);
        expect(wideness(1)).toBe(1);
        expect(wideness(16 / 9)).toBe(1);
    });

    it('wanders each star round a slow loop of its own and brings it back', () => {
        const start = tideStarPosition(0, 12, WIDE);
        const quarter = tideStarPosition(0, 12 + TIDE_PERIOD / 4, WIDE);
        const round = tideStarPosition(0, 12 + TIDE_PERIOD, WIDE);
        expect(Math.hypot(quarter.x - start.x, quarter.y - start.y)).toBeGreaterThan(0.1);
        expect(round.x).toBeCloseTo(start.x, 9);
        expect(round.y).toBeCloseTo(start.y, 9);
        // A frame's worth of time moves it by less than a pixel or two: it never jumps.
        const next = tideStarPosition(0, 12 + SIM_DT, WIDE);
        expect(Math.hypot(next.x - start.x, next.y - start.y)).toBeLessThan(0.002);
        // The companion keeps another period, so the pair never repeats in step.
        const companion = tideStarPosition(1, 12, WIDE);
        const later = tideStarPosition(1, 12 + TIDE_PERIOD, WIDE);
        expect(Math.hypot(later.x - companion.x, later.y - companion.y)).toBeGreaterThan(0.05);
        // It writes into the object it is handed, and nonsense is a 16:9 frame.
        const out = { x: 0, y: 0 };
        expect(tideStarPosition(1, 40, WIDE, out)).toBe(out);
        expect(out).toEqual(tideStarPosition(1, 40, WIDE));
        for (const aspect of [NaN, 0, -2, undefined, Infinity]) {
            expect(tideStarPosition(0, 40, aspect)).toEqual(tideStarPosition(0, 40, WIDE));
            expect(maelstromPosition(40, aspect)).toEqual(maelstromPosition(40, WIDE));
        }
    });

    it('opens the maelstrom in open sky: on the screen, clear of the card', () => {
        for (const [width, height] of FRAMES) {
            const aspect = width / height;
            const card = soloCard(width, height);
            for (const time of times) {
                const well = maelstromPosition(time, aspect);
                const label = `${width}x${height} t=${time}`;
                expect(Number.isFinite(well.x) && Number.isFinite(well.y), label).toBe(true);
                expect(Math.abs(well.x), label).toBeLessThan(aspect);
                expect(Math.abs(well.y), label).toBeLessThan(1);
                expect(gapTo(card, well.x, well.y), label).toBeGreaterThan(0.1);
            }
            // The upper right on a wide screen, the lower left on a tall one.
            const well = maelstromPosition(0, aspect);
            if (wideness(aspect) === 1) {
                expect(well.x).toBeGreaterThan(card.x1);
                expect(well.y).toBeLessThan(0);
            } else {
                expect(well.x).toBeLessThan(0);
                expect(well.y).toBeGreaterThan(card.y1);
            }
        }
        // It only breathes about its place.
        const rest = maelstromPosition(0, WIDE);
        for (const time of times) {
            const well = maelstromPosition(time, WIDE);
            expect(Math.hypot(well.x - rest.x, well.y - rest.y)).toBeLessThan(0.15);
        }
        const out = { x: 0, y: 0 };
        expect(maelstromPosition(9, WIDE, out)).toBe(out);
    });

    it('seats the stars the board lights inside the region it is given, spread evenly, the same every time', () => {
        const region = {
            x0: -1.6, y0: -0.9, x1: -0.52, y1: 0.9,
        };
        const seats = Array.from({ length: 64 }, (_, n) => ({ ...starSeat(n, region) }));
        for (const seat of seats) {
            expect(seat.x).toBeGreaterThanOrEqual(region.x0);
            expect(seat.x).toBeLessThanOrEqual(region.x1);
            expect(seat.y).toBeGreaterThanOrEqual(region.y0);
            expect(seat.y).toBeLessThanOrEqual(region.y1);
        }
        // Deterministic in n.
        seats.forEach((seat, n) => expect(starSeat(n, region)).toEqual(seat));
        // No two of a run land on each other...
        let nearest = Infinity;
        for (let i = 0; i < 28; i += 1) {
            for (let j = i + 1; j < 28; j += 1) {
                nearest = Math.min(nearest, Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y));
            }
        }
        expect(nearest).toBeGreaterThan(0.05);
        // ...and a run fills every quarter of the region.
        const quarters = new Set(seats.slice(0, 16).map((seat) => {
            const u = (seat.x - region.x0) / (region.x1 - region.x0);
            const v = (seat.y - region.y0) / (region.y1 - region.y0);
            return `${u < 0.5 ? 0 : 1}${v < 0.5 ? 0 : 1}`;
        }));
        expect(quarters.size).toBe(4);
        // It writes into the object it is handed.
        const out = { x: 9, y: 9 };
        expect(starSeat(5, region, out)).toBe(out);
        expect(out).toEqual(seats[5]);
        // A region that is a single point seats every star on it; nonsense for n is still a seat.
        const point = {
            x0: 0.3, y0: -0.2, x1: 0.3, y1: -0.2,
        };
        expect(starSeat(11, point)).toEqual({ x: 0.3, y: -0.2 });
        for (const n of [-4, 2.7, NaN, 1e9]) {
            const seat = starSeat(n, region);
            expect(Number.isFinite(seat.x) && Number.isFinite(seat.y), `n=${n}`).toBe(true);
            expect(seat.x).toBeGreaterThanOrEqual(region.x0);
            expect(seat.x).toBeLessThanOrEqual(region.x1);
        }
    });
});

describe('aether tides event table', () => {
    const everyFinite = (events) => events.data.every((value) => Number.isFinite(value));
    /** A packed splat's rows, by its place among the live ones. */
    const packedSplat = (events, index) => Array.from(events.data.subarray(
        (ROW_SPLAT + index * SPLAT_ROWS) * 4,
        (ROW_SPLAT + (index + 1) * SPLAT_ROWS) * 4,
    ));
    const packedRing = (events, index) => Array.from(events.data.subarray(
        (ROW_RING + index * RING_ROWS) * 4,
        (ROW_RING + (index + 1) * RING_ROWS) * 4,
    ));

    it('starts with every slot spent and real numbers in every row', () => {
        const events = new TideEvents();
        expect(events.data).toBeInstanceOf(Float32Array);
        expect(events.data).toHaveLength(EVENT_ROWS * 4);
        expect(events.splats).toHaveLength(SPLAT_SLOTS);
        expect(events.rings).toHaveLength(RING_SLOTS);
        expect(events.wells).toHaveLength(WELL_SLOTS);
        expect(events.stars).toHaveLength(STAR_SLOTS);
        expect(events.gyres).toHaveLength(GYRE_SLOTS);
        expect(events.splatCount).toBe(0);
        expect(events.ringCount).toBe(0);
        expect(events.stolen).toBe(0);
        expect(everyFinite(events)).toBe(true);
        for (let i = 0; i < STAR_SLOTS; i += 1) expect(events.starAlive(i, 0)).toBe(false);
    });

    it('writes a splat into a spent slot, and reuses the slot once the splat has run', () => {
        const events = new TideEvents();
        const slots = events.splats.slice();
        const first = events.addSplat({
            ax: 0.5, ay: -0.25, t0: 1, duration: 0.5, radius: 0.125, kind: SPLAT_CELL, r: 2, g: 1, b: 0.5, heat: 3,
        }, 1);
        expect(first).toBe(slots[0]);
        // A splat that names no end stays where it starts.
        expect(first).toMatchObject({
            ax: 0.5, ay: -0.25, bx: 0.5, by: -0.25, t0: 1, duration: 0.5, radius: 0.125, kind: SPLAT_CELL, heat: 3,
        });
        const second = events.addSplat({
            ax: 1, ay: 1, bx: 2, by: 0, t0: 1, duration: 2,
        }, 1);
        expect(second).toBe(slots[1]);
        expect(second).toMatchObject({ bx: 2, by: 0, kind: SPLAT_ROUND });
        // The first has run by t = 1.5: the next splat takes its slot, and nothing was stolen.
        const third = events.addSplat({
            ax: -1, ay: 0, t0: 1.5, duration: 0.25, fx: 4,
        }, 1.5);
        expect(third).toBe(slots[0]);
        // Nothing of the splat it replaces is left behind.
        expect(third).toMatchObject({
            ax: -1, ay: 0, bx: -1, by: 0, r: 0, g: 0, b: 0, heat: 0, fx: 4, kind: SPLAT_ROUND,
        });
        expect(events.stolen).toBe(0);
        expect(events.splats).toHaveLength(SPLAT_SLOTS);
        events.splats.forEach((slot, i) => expect(slot).toBe(slots[i]));
    });

    it('ignores what is not a number and what is not a splat\'s to keep', () => {
        const events = new TideEvents();
        const slot = events.addSplat({
            ax: NaN, ay: undefined, bx: Infinity, t0: 2, duration: 1, radius: 'wide', colour: 'red', nonsense: 4,
        }, 2);
        expect(slot.ax).toBe(0);
        expect(slot.ay).toBe(0);
        expect(slot.bx).toBe(0);
        expect(slot.radius).toBeGreaterThan(0);
        expect(slot).not.toHaveProperty('colour');
        expect(slot).not.toHaveProperty('nonsense');
        events.pack(2);
        expect(everyFinite(events)).toBe(true);
    });

    it('steals the splat nearest its end when every slot is busy', () => {
        const events = new TideEvents();
        const slots = events.splats.slice();
        // Every slot in flight; slot 5 is the one that ends soonest.
        for (let i = 0; i < SPLAT_SLOTS; i += 1) {
            events.addSplat({ ax: i, t0: 10, duration: i === 5 ? 0.25 : 1 + i * 0.01 }, 10);
        }
        expect(events.stolen).toBe(0);
        const taken = events.addSplat({ ax: 99, t0: 10, duration: 3 }, 10);
        expect(taken).toBe(slots[5]);
        expect(taken.ax).toBe(99);
        expect(events.stolen).toBe(1);
        // The next one takes the next to end: slot 0 now.
        expect(events.addSplat({ ax: 98, t0: 10, duration: 3 }, 10)).toBe(slots[0]);
        expect(events.stolen).toBe(2);
        // Every other splat is untouched.
        for (let i = 1; i < SPLAT_SLOTS; i += 1) if (i !== 5) expect(slots[i].ax).toBe(i);
        events.pack(10);
        expect(events.splatCount).toBe(SPLAT_SLOTS);
    });

    it('packs the splats in flight first, in slot order, and counts them', () => {
        const events = new TideEvents();
        events.addSplat({
            ax: 1,
            ay: 2,
            bx: 3,
            by: 4,
            t0: 5,
            duration: 0.5,
            radius: 0.25,
            kind: SPLAT_CELL,
            r: 1.5,
            g: 2.5,
            b: 3.5,
            dust: 0.5,
            fx: -1,
            fy: 1,
            heat: 2,
            swirl: 0.75,
            bend: 0.125,
            ease: 1,
        }, 5);
        events.addSplat({ ax: 10, t0: 5, duration: 0.1 }, 5); // runs out first
        events.addSplat({ ax: 20, t0: 5, duration: 2 }, 5);
        events.addSplat({ ax: 30, t0: 7, duration: 1 }, 5); // has not started yet
        events.addSplat({ ax: 40, t0: 5, duration: 0 }, 5); // lasts no time: never drawn

        events.pack(5);
        expect(events.splatCount).toBe(4);
        expect(packedSplat(events, 0)).toEqual([
            1, 2, 3, 4, 5, 0.5, 0.25, SPLAT_CELL, 1.5, 2.5, 3.5, 0.5, -1, 1, 2, 0.75, 0.125, 1, 0, 0,
        ]);
        expect([0, 1, 2, 3].map((i) => packedSplat(events, i)[0])).toEqual([1, 10, 20, 30]);

        // A little later the short one has run: the rest close ranks.
        events.pack(5.25);
        expect(events.splatCount).toBe(3);
        expect([0, 1, 2].map((i) => packedSplat(events, i)[0])).toEqual([1, 20, 30]);
        // One that is still to start is packed all the same: the shaders gate it by its own clock.
        events.pack(6);
        expect(events.splatCount).toBe(2);
        expect([0, 1].map((i) => packedSplat(events, i)[0])).toEqual([20, 30]);
        expect(packedSplat(events, 1)[4]).toBe(7);
        events.pack(8.5);
        expect(events.splatCount).toBe(0);
        expect(events.pack(8.5)).toBe(events.data);
        expect(everyFinite(events)).toBe(true);
    });

    it('rings: a spent slot first, else the oldest front; packed live-first', () => {
        const events = new TideEvents();
        const slots = events.rings.slice();
        for (let i = 0; i < RING_SLOTS; i += 1) {
            const ring = events.addRing({
                x: i, y: -i, t0: 1 + i * 0.125, reach: 2, push: 0.5, width: 0.0625, heat: 3, rough: 1.5,
            }, 1 + i * 0.125);
            expect(ring).toBe(slots[i]);
        }
        expect(events.stolen).toBe(0);
        events.pack(2);
        expect(events.ringCount).toBe(RING_SLOTS);
        expect(packedRing(events, 3)).toEqual([3, -3, 1.375, 2, 0.5, 0.0625, 3, 1.5]);
        // Every slot in flight: the oldest front gives way.
        const taken = events.addRing({
            x: 50, y: 0, t0: 2, reach: 1,
        }, 2);
        expect(taken).toBe(slots[0]);
        expect(events.stolen).toBe(1);
        // What a ring leaves unsaid falls back to a front that pushes nothing.
        expect(taken).toMatchObject({
            x: 50, reach: 1, push: 0, heat: 0, rough: 0,
        });
        expect(taken.width).toBeGreaterThan(0);
        // Once a front's life is over its slot is free again, and it is no longer packed.
        const after = 1.125 + RING_LIFE;
        expect(events.addRing({ x: 60, t0: after }, after)).toBe(slots[1]);
        expect(events.stolen).toBe(1);
        events.pack(after);
        expect(events.ringCount).toBe(RING_SLOTS);
        events.pack(after + 0.2);
        expect(events.ringCount).toBe(RING_SLOTS - 1);
        expect(packedRing(events, 0)[0]).toBe(50);
        expect(packedRing(events, 1)[0]).toBe(60);
        expect(packedRing(events, 2)[0]).toBe(3);
        events.pack(after + RING_LIFE + 1);
        expect(events.ringCount).toBe(0);
    });

    it('keeps wells and gyres at their addresses', () => {
        const events = new TideEvents();
        const well = events.setWell(2, {
            x: 0.5, y: -0.5, flow: -4, radius: 0.125, swirl: 0.25, drain: 2, heat: 1.5, swirlRadius: 0.375,
        });
        expect(well).toBe(events.wells[2]);
        // Rewriting part of a well keeps the rest.
        events.setWell(2, { flow: -2, radius: NaN });
        expect(well).toMatchObject({ x: 0.5, flow: -2, radius: 0.125 });
        expect(events.setWell(WELL_SLOTS, { x: 1 })).toBeNull();
        expect(events.setWell(-1, { x: 1 })).toBeNull();
        const gyre = events.setGyre(1, {
            x: -1, y: 0.25, strength: -0.125, radius: 0.75,
        });
        expect(gyre).toBe(events.gyres[1]);
        expect(events.setGyre(GYRE_SLOTS, { x: 1 })).toBeNull();
        events.pack(0);
        const w = (ROW_WELL + 2 * WELL_ROWS) * 4;
        expect(Array.from(events.data.subarray(w, w + 8))).toEqual([0.5, -0.5, -2, 0.125, 0.25, 2, 1.5, 0.375]);
        const g = (ROW_GYRE + 1 * GYRE_ROWS) * 4;
        expect(Array.from(events.data.subarray(g, g + 4))).toEqual([-1, 0.25, -0.125, 0.75]);
        // The wells either side are still at rest.
        const before = (ROW_WELL + 1 * WELL_ROWS) * 4;
        expect(events.data[before + 2]).toBe(0);
    });

    it('lights the stars round-robin, so the oldest gives way first', () => {
        const events = new TideEvents();
        const slots = events.stars.slice();
        for (let i = 0; i < STAR_SLOTS; i += 1) {
            expect(events.addStar({
                x: i * 0.0625,
                y: -0.5,
                born: 10 + i,
                dies: 60 + i,
                r: 1,
                g: 0.5,
                b: 0.25,
                flux: 1.5,
                fromX: 0.25,
                fromY: 0.75,
                left: 9.5 + i,
                bend: 0.125,
            })).toBe(i);
        }
        expect(events.starCursor).toBe(0);
        events.pack(20);
        const o = (ROW_STAR + 3 * STAR_ROWS) * 4;
        expect(Array.from(events.data.subarray(o, o + STAR_ROWS * 4))).toEqual([
            0.1875, -0.5, 13, 63, 1, 0.5, 0.25, 1.5, 0.25, 0.75, 12.5, 0.125,
        ]);
        // One more than there are slots: the first star is the one replaced.
        expect(events.addStar({
            x: 2, y: 2, born: 100, r: 0, g: 1, b: 0,
        })).toBe(0);
        expect(events.starCursor).toBe(1);
        expect(events.stars).toHaveLength(STAR_SLOTS);
        events.stars.forEach((slot, i) => expect(slot).toBe(slots[i]));
        // What a star leaves unsaid: it burns on, at full flux, and its spark starts where it stands.
        expect(slots[0]).toMatchObject({
            x: 2, y: 2, born: 100, flux: 1, fromX: 2, fromY: 2, left: 100, bend: 0,
        });
        expect(slots[0].dies).toBeGreaterThan(1e6);
        expect(slots[1].x).toBe(0.0625);
        events.pack(100);
        expect(everyFinite(events)).toBe(true);
    });

    it('knows a star is burning from the moment it opens until its nova is over', () => {
        const events = new TideEvents();
        const index = events.addStar({
            x: 0, y: 0, born: 5, dies: 9, r: 1, g: 1, b: 1,
        });
        expect(events.starAlive(index, 4.99)).toBe(false); // its spark is still in flight
        expect(events.starAlive(index, 5)).toBe(true);
        expect(events.starAlive(index, 8.99)).toBe(true);
        expect(events.starAlive(index, 9 + NOVA_LIFE * 0.5)).toBe(true); // going nova
        expect(events.starAlive(index, 9 + NOVA_LIFE)).toBe(false);
        expect(events.starAlive(index + 1, 6)).toBe(false);
    });

    it('forgets everything in flight on a reset', () => {
        const events = new TideEvents();
        for (let i = 0; i < SPLAT_SLOTS + 3; i += 1) {
            events.addSplat({
                ax: i, t0: 4, duration: 5, r: 1,
            }, 4);
        }
        for (let i = 0; i < RING_SLOTS + 2; i += 1) {
            events.addRing({
                x: i, t0: 4, reach: 2, push: 1,
            }, 4);
        }
        for (let i = 0; i < 5; i += 1) {
            events.addStar({
                x: i, y: 0, born: 4, dies: 50, r: 1, g: 1, b: 1,
            });
        }
        events.setWell(0, { flow: -3, drain: 2 });
        events.setGyre(0, { strength: 0.5 });
        events.pack(4);
        expect(events.splatCount).toBe(SPLAT_SLOTS);
        expect(events.ringCount).toBe(RING_SLOTS);
        expect(events.stolen).toBe(5);
        const { data } = events;
        const slots = events.splats.slice();

        events.reset();
        expect(events.data).toBe(data);
        events.splats.forEach((slot, i) => expect(slot).toBe(slots[i]));
        expect(events.splatCount).toBe(0);
        expect(events.ringCount).toBe(0);
        expect(events.stolen).toBe(0);
        expect(events.starCursor).toBe(0);
        expect(events.wells[0]).toMatchObject({ flow: 0, drain: 0 });
        for (let i = 0; i < STAR_SLOTS; i += 1) expect(events.starAlive(i, 5)).toBe(false);
        events.pack(4);
        expect(events.splatCount).toBe(0);
        expect(events.ringCount).toBe(0);
        // The stars' rows hold a birth far in the past: nothing draws.
        for (let i = 0; i < STAR_SLOTS; i += 1) {
            expect(events.data[(ROW_STAR + i * STAR_ROWS) * 4 + 2]).toBeLessThan(-1e5);
            expect(events.data[(ROW_STAR + i * STAR_ROWS) * 4 + 3]).toBeLessThan(-1e5);
        }
        expect(everyFinite(events)).toBe(true);
        // And the table is ready to be written again from the first slot.
        expect(events.addSplat({ ax: 7, t0: 0, duration: 1 }, 0)).toBe(slots[0]);
        expect(events.addStar({
            x: 0, y: 0, born: 1, r: 1, g: 1, b: 1,
        })).toBe(0);
    });
});
