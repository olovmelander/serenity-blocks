import { describe, expect, it } from 'vitest';
import {
    BOARD_GRID, BOARD_SELECTOR, HUD_SELECTOR, PLAYER_SLOTS, SOLO_CANVAS_SELECTORS,
    boardFor, boardPoint, cardUnion, fallbackLayout, layoutsDiffer, playerCanvasSelector, readLayoutRects,
} from '../../src/themes/void-ember/void-ember-composition.js';

const rect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});
const el = (r) => ({ getBoundingClientRect: () => r });
const visible = { display: 'block', visibility: 'visible', opacity: '1' };

describe('void ember composition: the board before it is on screen', () => {
    it('lays the solo board out from the stylesheet\'s formulas before a card exists', () => {
        const layout = fallbackLayout(1600, 900);
        expect(layout.cardCount).toBe(0);
        const card = layout.cards[0];
        const board = layout.boards[0];
        expect((card.x0 + card.x1) / 2).toBeCloseTo(0.5, 6);
        expect(board.x0).toBeGreaterThan(card.x0);
        expect(board.x1).toBeLessThan(card.x1);
        expect(board.y1).toBeLessThan(card.y1);
        // The playfield is two cells tall for each cell wide.
        expect(((board.y1 - board.y0) * 900) / ((board.x1 - board.x0) * 1600)).toBeCloseTo(2, 6);
        expect(layout.hud.x0).toBeGreaterThan(card.x1);
        expect(cardUnion(layout)).toEqual(card);
        expect(boardFor(layout, 0)).toBe(board);
        expect(boardFor(layout, 3)).toBe(board); // a missing board falls back to the first on screen
        expect(boardFor(null)).toBeNull();
    });

    it('lays out the solo board from the stylesheet\'s formulas, for any frame', () => {
        for (const [width, height] of [[1600, 900], [1920, 1080], [2560, 1080], [1024, 768], [430, 932]]) {
            const layout = fallbackLayout(width, height);
            const card = layout.cards[0];
            const board = layout.boards[0];
            expect(layout.cardCount).toBe(0); // nothing was read from the page
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
        }
        // Nonsense is a one-pixel window, not a division by zero.
        const tiny = fallbackLayout(0, NaN);
        expect(Object.values(tiny.cards[0]).every((v) => Number.isFinite(v))).toBe(true);
    });
});

describe('void ember composition: board columns and rows on screen', () => {
    it('maps a column and a row onto the screen through the board rect', () => {
        const board = {
            x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.9,
        };
        expect(boardPoint(board, 0, 0)).toEqual({ x: 0.4, y: 0.2 + 0.7 * (0.5 / BOARD_GRID.rows) });
        const foot = boardPoint(board, 1, 19);
        expect(foot.x).toBeCloseTo(0.6, 9);
        expect(foot.y).toBeCloseTo(0.9 - 0.7 * (0.5 / BOARD_GRID.rows), 9);
        // Out-of-range input is clamped onto the board.
        expect(boardPoint(board, 7, 99).x).toBeCloseTo(0.6, 9);
    });

    it('maps columns and rows onto a board without allocating', () => {
        const board = {
            x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.9,
        };
        const out = { x: 0, y: 0 };
        expect(boardPoint(board, 0.5, 9, out)).toBe(out);
        expect(out.x).toBeCloseTo(0.5, 9);
        // Rows are measured to their centre line, one board-height / rows apart.
        const row = (board.y1 - board.y0) / BOARD_GRID.rows;
        expect(out.y).toBeCloseTo(board.y0 + row * 9.5, 9);
        const next = boardPoint(board, 0.5, 10);
        expect(next.y - out.y).toBeCloseTo(row, 9);
        // The floor row is the last one; anything past the grid is clamped onto it.
        const floor = boardPoint(board, 0.5, BOARD_GRID.rows - 1);
        expect(boardPoint(board, -3, 400)).toEqual({ x: board.x0, y: floor.y });
        expect(boardPoint(board, 0, -7).y).toBeCloseTo(board.y0 + row * 0.5, 9);
    });

    it('joins every card on screen into one rect', () => {
        const a = {
            x0: 0.05, y0: 0.2, x1: 0.3, y1: 0.8,
        };
        const b = {
            x0: 0.35, y0: 0.1, x1: 0.6, y1: 0.7,
        };
        const c = {
            x0: 0.65, y0: 0.25, x1: 0.95, y1: 0.9,
        };
        const layout = {
            cardCount: 3, cards: [a, b, c], hud: null, boards: new Array(PLAYER_SLOTS).fill(null),
        };
        const union = cardUnion(layout);
        expect(union).toEqual({
            x0: 0.05, y0: 0.1, x1: 0.95, y1: 0.9,
        });
        // A copy: the first card is not widened in place.
        expect(union).not.toBe(a);
        expect(a.x1).toBe(0.3);
        expect(cardUnion({ cards: [] })).toBeNull();
        expect(cardUnion(null)).toBeNull();
        // A board for a player who has none is the first board on screen.
        layout.boards[2] = b;
        expect(boardFor(layout, 2)).toBe(b);
        expect(boardFor(layout, 0)).toBe(b);
        layout.boards[2] = null;
        expect(boardFor(layout, 0)).toBeNull();
    });
});

describe('void ember composition: reading the page', () => {
    it('reads the live card, board and HUD rects, and nothing when no board is on screen', () => {
        const card = el(rect(600, 50, 400, 800));
        const canvas = el(rect(650, 200, 300, 600));
        const hud = el(rect(1050, 250, 140, 400));
        const hidden = el(rect(0, 0, 0, 0));
        const doc = {
            querySelectorAll: (selector) => (selector.includes('player-card') ? [card, hidden] : []),
            querySelector: (selector) => {
                if (selector === '#phaser-game-container canvas') return canvas;
                if (selector === '.single-player-stats-bar') return hud;
                return null;
            },
        };
        const win = { innerWidth: 1600, innerHeight: 900, getComputedStyle: () => visible };
        const layout = readLayoutRects(doc, win);
        expect(layout.cardCount).toBe(1);
        expect(layout.cards[0]).toEqual({
            x0: 0.375, y0: 50 / 900, x1: 0.625, y1: 850 / 900,
        });
        expect(layout.boards[0].x0).toBeCloseTo(650 / 1600, 9);
        expect(layout.hud.x1).toBeCloseTo(1190 / 1600, 9);
        expect(layoutsDiffer(layout, readLayoutRects(doc, win))).toBe(false);
        expect(layoutsDiffer(layout, fallbackLayout(1600, 900))).toBe(true);

        const empty = { querySelectorAll: () => [], querySelector: () => null };
        expect(readLayoutRects(empty, win)).toBeNull();
        expect(readLayoutRects(null, win)).toBeNull();
    });

    it('asks the page for the gameplay boards, never the lobby\'s avatar cards', () => {
        const asked = [];
        const doc = {
            querySelectorAll: (selector) => {
                asked.push(selector);
                return [];
            },
            querySelector: () => null,
        };
        readLayoutRects(doc, { innerWidth: 800, innerHeight: 600 });
        expect(asked).toEqual([BOARD_SELECTOR]);
        expect(BOARD_SELECTOR).toBe('.player-card[data-player]');
        expect(HUD_SELECTOR).toBe('.single-player-stats-bar');
        expect(SOLO_CANVAS_SELECTORS).toContain('#phaser-game-container canvas');
        expect(playerCanvasSelector(3)).toBe('#p3-phaser-container canvas');
    });

    it('gives each local-multiplayer board its own slot and takes the first solo canvas it finds', () => {
        const cards = [el(rect(40, 100, 300, 600)), el(rect(360, 100, 300, 600)), el(rect(680, 100, 300, 600))];
        const canvases = {
            '#main-game-canvas': el(rect(10, 10, 100, 200)),
            '#single-player-game-canvas': el(rect(500, 10, 100, 200)),
            [playerCanvasSelector(1)]: el(rect(60, 200, 250, 500)),
            [playerCanvasSelector(3)]: el(rect(700, 200, 250, 500)),
        };
        const doc = {
            querySelectorAll: () => cards,
            querySelector: (selector) => canvases[selector] || null,
        };
        const win = { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => visible };
        const layout = readLayoutRects(doc, win);
        expect(layout.cardCount).toBe(3);
        expect(layout.hud).toBeNull();
        // The first solo selector that has a visible canvas wins.
        expect(layout.boards[0].x0).toBeCloseTo(0.01, 9);
        expect(layout.boards[1].x0).toBeCloseTo(0.06, 9);
        expect(layout.boards[2]).toBeNull();
        expect(layout.boards[3].x0).toBeCloseTo(0.7, 9);
        expect(layout.boards[4]).toBeNull();
        expect(boardFor(layout, 3)).toBe(layout.boards[3]);
        expect(boardFor(layout, 2)).toBe(layout.boards[0]);
    });

    it('does not count a card that is hidden, see-through, tiny or off screen', () => {
        const win = (style) => ({ innerWidth: 1000, innerHeight: 800, getComputedStyle: () => style });
        const one = (r) => ({ querySelectorAll: () => [el(r)], querySelector: () => null });
        const on = rect(100, 100, 300, 600);
        expect(readLayoutRects(one(on), win(visible))).not.toBeNull();
        expect(readLayoutRects(one(on), win({ ...visible, display: 'none' }))).toBeNull();
        expect(readLayoutRects(one(on), win({ ...visible, visibility: 'hidden' }))).toBeNull();
        expect(readLayoutRects(one(on), win({ ...visible, opacity: '0.01' }))).toBeNull();
        expect(readLayoutRects(one(rect(100, 100, 6, 600)), win(visible))).toBeNull();
        expect(readLayoutRects(one(rect(-400, 100, 300, 600)), win(visible))).toBeNull();
        expect(readLayoutRects(one(rect(100, 900, 300, 600)), win(visible))).toBeNull();
        // A window that cannot report styles is taken at its word about the rect.
        expect(readLayoutRects(one(on), { innerWidth: 1000, innerHeight: 800 })).not.toBeNull();
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
        const moved = copy();
        moved.cards[0].x0 += 0.02;
        expect(layoutsDiffer(base, moved)).toBe(true);

        const boardMoved = copy();
        boardMoved.boards[0].y0 += 0.05;
        expect(layoutsDiffer(base, boardMoved)).toBe(true);
        const secondBoard = copy();
        secondBoard.boards[3] = { ...base.boards[0] };
        expect(layoutsDiffer(base, secondBoard)).toBe(true);
        const noHud = copy();
        noHud.hud = null;
        expect(layoutsDiffer(base, noHud)).toBe(true);
        const counted = copy();
        counted.cardCount = 1;
        expect(layoutsDiffer(base, counted)).toBe(true);
        const twoCards = copy();
        twoCards.cards.push({ ...base.cards[0] });
        expect(layoutsDiffer(base, twoCards)).toBe(true);
    });
});
