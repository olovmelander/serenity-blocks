import { describe, expect, it } from 'vitest';
import {
    BOARD_GRID, LOOM_MAX_RADIUS, PLAYER_SLOTS, REST_RIG, VIEW_HEIGHT,
    boardInLoom, cardUnion, fallbackLayout, layoutsDiffer, primaryBoard, readLayoutRects, screenToLoom, solveLoom,
} from '../../src/themes/astral-weave/astral-weave-composition.js';

const rect = (left, top, right, bottom) => ({
    left, top, right, bottom, width: right - left, height: bottom - top,
});

function fakeDom(elements, { width = 1280, height = 720 } = {}) {
    const node = (r, style = {}) => ({ getBoundingClientRect: () => r, style });
    const map = new Map(Object.entries(elements).map(([selector, r]) => [selector, r && node(r)]));
    const doc = {
        querySelectorAll: (selector) => (map.get(selector) ? [map.get(selector)] : []),
        querySelector: (selector) => map.get(selector) || null,
    };
    const win = {
        innerWidth: width,
        innerHeight: height,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    };
    return { doc, win };
}

describe('astral weave composition: the rest camera', () => {
    it('sees exactly one view height on the loom plane', () => {
        const half = REST_RIG.distance * Math.tan((REST_RIG.fov * Math.PI) / 360);
        expect(VIEW_HEIGHT).toBeCloseTo(half * 2, 10);
    });
});

describe('astral weave composition: seating the hoop on the card', () => {
    it('centres on the solo card and runs the rim through the side zones on a landscape screen', () => {
        const layout = fallbackLayout(1920, 1080);
        const loom = solveLoom(16 / 9, layout);
        expect(loom.cx).toBeCloseTo(0, 6);
        expect(loom.cy).toBeCloseTo(0, 6);
        expect(loom.radius).toBe(LOOM_MAX_RADIUS);
        const card = layout.cards[0];
        const cardHalfWidth = ((card.x1 - card.x0) / 2) * (16 / 9);
        // The rim passes outside the card and inside the frame.
        expect(loom.radius).toBeGreaterThan(cardHalfWidth + 0.15);
        expect(loom.radius).toBeLessThan(16 / 9 / 2);
    });

    it('keeps the rim inside a narrower landscape frame', () => {
        const loom = solveLoom(4 / 3, fallbackLayout(1024, 768));
        expect(loom.radius).toBeLessThan(4 / 3 / 2);
        expect(loom.radius).toBeGreaterThan(0.45);
    });

    it('runs the rim through the strips above and below the card on a portrait screen', () => {
        const aspect = 390 / 844;
        const layout = fallbackLayout(390, 844);
        const loom = solveLoom(aspect, layout);
        const card = layout.cards[0];
        const cardHalfHeight = (card.y1 - card.y0) / 2;
        expect(loom.radius).toBeGreaterThan(cardHalfHeight);
        expect(loom.radius).toBeLessThan(0.5);
        // Wider than the frame: only the crown and the foot of the hoop show.
        expect(loom.radius).toBeGreaterThan(aspect / 2);
    });

    it('follows a card that is not centred, without dragging the rim out of the frame', () => {
        const layout = {
            cards: [{
                x0: 0.4, y0: 0.16, x1: 0.6, y1: 1.02,
            }],
            boards: [],
        };
        const loom = solveLoom(16 / 9, layout);
        expect(loom.cy).toBeCloseTo(0.5 - 0.59, 6);
        const far = {
            cards: [{
                x0: 0.8, y0: 0.2, x1: 0.98, y1: 0.9,
            }],
            boards: [],
        };
        expect(solveLoom(16 / 9, far).cx).toBeLessThanOrEqual((16 / 9 / 2) * 0.35 + 1e-9);
    });

    it('seats the hoop on the union of several local boards', () => {
        const layout = {
            cards: [{
                x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.9,
            }, {
                x0: 0.7, y0: 0.2, x1: 0.9, y1: 0.9,
            }],
            boards: [],
        };
        expect(cardUnion(layout)).toEqual({
            x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.9,
        });
        const loom = solveLoom(16 / 9, layout);
        expect(loom.cx).toBeCloseTo(0, 6);
        expect(loom.radius).toBeGreaterThan(0.35);
        expect(loom.radius).toBeLessThanOrEqual(LOOM_MAX_RADIUS);
    });

    it('falls back to a centred hoop and survives hostile input', () => {
        expect(solveLoom(16 / 9, null)).toMatchObject({ cx: 0, cy: 0 });
        for (const aspect of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY, undefined]) {
            const loom = solveLoom(aspect, fallbackLayout(1920, 1080));
            expect(Number.isFinite(loom.radius)).toBe(true);
            expect(loom.radius).toBeGreaterThan(0);
        }
    });
});

describe('astral weave composition: the board on the loom', () => {
    it('maps the board rows to loom-local chords, top row first', () => {
        const aspect = 16 / 9;
        const layout = fallbackLayout(1920, 1080);
        const loom = solveLoom(aspect, layout);
        const board = boardInLoom(primaryBoard(layout), aspect, loom);
        expect(board.width).toBeGreaterThan(0);
        expect(board.rowStep).toBeGreaterThan(0);
        // Ten columns wide and twenty rows tall: a row is as tall as a column is wide.
        expect(board.rowStep * BOARD_GRID.rows).toBeCloseTo((board.width / BOARD_GRID.columns) * BOARD_GRID.rows, 6);
        // Every row is a chord of the unit hoop.
        for (let row = 0; row < BOARD_GRID.rows; row++) {
            expect(Math.abs(board.top - (row + 0.5) * board.rowStep)).toBeLessThan(1);
        }
    });

    it('round-trips a screen point through the loom', () => {
        const loom = { cx: 0.05, cy: -0.09, radius: 0.5 };
        const p = screenToLoom(0.5, 0.5, 16 / 9, loom);
        expect(p.x).toBeCloseTo(-0.05 / 0.5, 10);
        expect(p.y).toBeCloseTo(0.09 / 0.5, 10);
    });
});

describe('astral weave composition: reading the live layout', () => {
    it('reads the card, the board canvas and the stats bar as screen fractions', () => {
        const { doc, win } = fakeDom({
            '.player-card[data-player]': rect(506, 104, 758, 671),
            '#phaser-game-container canvas': rect(534, 242, 736, 647),
            '.single-player-stats-bar': rect(806, 186, 946, 574),
        }, { width: 1264, height: 655 });
        const layout = readLayoutRects(doc, win);
        expect(layout.cardCount).toBe(1);
        expect(layout.cards[0].x0).toBeCloseTo(506 / 1264, 10);
        expect(layout.boards).toHaveLength(PLAYER_SLOTS);
        expect(layout.boards[0].y1).toBeCloseTo(647 / 655, 10);
        expect(layout.hud.x1).toBeCloseTo(946 / 1264, 10);
        expect(primaryBoard(layout)).toBe(layout.boards[0]);
    });

    it('finds a local-multiplayer board by its player slot', () => {
        const { doc, win } = fakeDom({
            '.player-card[data-player]': rect(100, 100, 400, 700),
            '#p2-phaser-container canvas': rect(120, 200, 380, 680),
        });
        const layout = readLayoutRects(doc, win);
        expect(layout.boards[0]).toBeNull();
        expect(layout.boards[2]).toBeTruthy();
        expect(primaryBoard(layout)).toBe(layout.boards[2]);
    });

    it('returns null when no board is on screen, or the card is hidden or collapsed', () => {
        expect(readLayoutRects(null, null)).toBeNull();
        expect(readLayoutRects(fakeDom({}).doc, fakeDom({}).win)).toBeNull();
        const collapsed = fakeDom({ '.player-card[data-player]': rect(10, 10, 14, 14) });
        expect(readLayoutRects(collapsed.doc, collapsed.win)).toBeNull();
        const offscreen = fakeDom({ '.player-card[data-player]': rect(-900, 10, -600, 400) });
        expect(readLayoutRects(offscreen.doc, offscreen.win)).toBeNull();
        const hidden = fakeDom({ '.player-card[data-player]': rect(100, 100, 400, 700) });
        hidden.win.getComputedStyle = () => ({ display: 'none', visibility: 'visible', opacity: '1' });
        expect(readLayoutRects(hidden.doc, hidden.win)).toBeNull();
    });

    it('notices a layout change and ignores sub-pixel jitter', () => {
        const a = fallbackLayout(1920, 1080);
        const b = fallbackLayout(1920, 1080);
        expect(layoutsDiffer(a, b)).toBe(false);
        b.cards[0].x0 += 0.001;
        expect(layoutsDiffer(a, b)).toBe(false);
        b.boards[0].y0 += 0.02;
        expect(layoutsDiffer(a, b)).toBe(true);
        expect(layoutsDiffer(a, null)).toBe(true);
        expect(layoutsDiffer(null, null)).toBe(false);
    });
});
