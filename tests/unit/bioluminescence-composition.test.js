import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BOARD_GRID, BOARD_SELECTOR, HUD_SELECTOR, PLAYER_SLOTS, SOLO_CANVAS_SELECTORS, boardFor, boardPoint, cardUnion,
    fallbackLayout, layoutsDiffer, playerCanvasSelector, readLayoutRects,
} from '../../src/themes/bioluminescence/bioluminescence-composition.js';

const source = readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'bioluminescence',
    'bioluminescence-composition.js',
), 'utf8');

const rect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});
const el = (r) => ({ getBoundingClientRect: () => r });
const shown = { display: 'block', visibility: 'visible', opacity: '1' };

/** A document double: cards by the board selector, everything else by exact selector. */
function page({ cards = [], elements = {} } = {}) {
    return {
        querySelectorAll: (selector) => (selector === BOARD_SELECTOR ? cards : []),
        querySelector: (selector) => elements[selector] ?? null,
    };
}

describe('bioluminescence composition', () => {
    it('is three-free and imports nothing', () => {
        expect(source).not.toMatch(/^\s*import\s/m);
        expect(source).not.toMatch(/\bTHREE\b/);
    });

    it('names the playfield and the selectors the game\'s boards answer to', () => {
        expect(BOARD_GRID).toEqual({ columns: 10, rows: 20, hiddenRows: 4 });
        expect(Object.isFrozen(BOARD_GRID)).toBe(true);
        expect(PLAYER_SLOTS).toBe(5);
        expect(BOARD_SELECTOR).toBe('.player-card[data-player]');
        expect(HUD_SELECTOR).toBe('.single-player-stats-bar');
        expect(SOLO_CANVAS_SELECTORS).toEqual([
            '#phaser-game-container canvas', '#main-game-canvas', '#single-player-game-canvas',
        ]);
        expect(playerCanvasSelector(3)).toBe('#p3-phaser-container canvas');
    });

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

    it('reads the live card, board and HUD rects, and nothing when no board is on screen', () => {
        const card = el(rect(600, 50, 400, 800));
        const canvas = el(rect(650, 200, 300, 600));
        const hud = el(rect(1050, 250, 140, 400));
        const hidden = el(rect(0, 0, 0, 0));
        const doc = page({
            cards: [card, hidden],
            elements: { '#phaser-game-container canvas': canvas, '.single-player-stats-bar': hud },
        });
        const win = { innerWidth: 1600, innerHeight: 900, getComputedStyle: () => shown };
        const layout = readLayoutRects(doc, win);
        expect(layout.cardCount).toBe(1);
        expect(layout.cards[0]).toEqual({
            x0: 0.375, y0: 50 / 900, x1: 0.625, y1: 850 / 900,
        });
        expect(layout.boards[0].x0).toBeCloseTo(650 / 1600, 9);
        expect(layout.hud.x1).toBeCloseTo(1190 / 1600, 9);
        expect(layoutsDiffer(layout, readLayoutRects(doc, win))).toBe(false);
        expect(layoutsDiffer(layout, fallbackLayout(1600, 900))).toBe(true);

        expect(readLayoutRects(page(), win)).toBeNull();
        expect(readLayoutRects(null, win)).toBeNull();
        expect(readLayoutRects(doc, null)).toBeNull();
        expect(readLayoutRects({}, win)).toBeNull();
    });

    it('counts only what can be seen: not the hidden, the transparent or the off-screen', () => {
        const win = {
            innerWidth: 1000,
            innerHeight: 800,
            getComputedStyle: (node) => node.style ?? shown,
        };
        const styled = (r, style) => ({ ...el(r), style: { ...shown, ...style } });
        const visible = el(rect(300, 100, 300, 600));
        const cards = [
            styled(rect(0, 0, 300, 600), { display: 'none' }),
            styled(rect(0, 0, 300, 600), { visibility: 'hidden' }),
            styled(rect(0, 0, 300, 600), { opacity: '0.01' }),
            el(rect(-400, 100, 300, 600)), // wholly left of the window
            el(rect(300, 900, 300, 600)), // wholly below it
            el(rect(300, 100, 6, 600)), // a sliver
            { nope: true }, // not an element
            visible,
        ];
        const layout = readLayoutRects(page({ cards }), win);
        expect(layout.cardCount).toBe(1);
        expect(layout.cards).toEqual([{
            x0: 0.3, y0: 0.125, x1: 0.6, y1: 0.875,
        }]);
        // No canvas and no HUD on screen: the card alone is still a layout.
        expect(layout.boards).toEqual(new Array(PLAYER_SLOTS).fill(null));
        expect(layout.hud).toBeNull();
        // A window that cannot report computed styles is taken at its rects' word.
        const plain = readLayoutRects(page({ cards }), { innerWidth: 1000, innerHeight: 800 });
        expect(plain.cardCount).toBe(4);
    });

    it('finds the solo canvas under any of its selectors and each local-multiplayer board under its own', () => {
        const win = { innerWidth: 2000, innerHeight: 1000, getComputedStyle: () => shown };
        const card = el(rect(100, 100, 400, 800));
        for (const selector of SOLO_CANVAS_SELECTORS) {
            const layout = readLayoutRects(page({
                cards: [card], elements: { [selector]: el(rect(200, 300, 200, 400)) },
            }), win);
            expect(layout.boards[0], selector).toEqual({
                x0: 0.1, y0: 0.3, x1: 0.2, y1: 0.7,
            });
        }
        const boards = readLayoutRects(page({
            cards: [card, el(rect(600, 100, 400, 800)), el(rect(1100, 100, 400, 800))],
            elements: {
                [playerCanvasSelector(1)]: el(rect(200, 300, 200, 400)),
                [playerCanvasSelector(2)]: el(rect(700, 300, 200, 400)),
                [playerCanvasSelector(4)]: el(rect(1200, 300, 200, 400)),
            },
        }), win);
        expect(boards.cardCount).toBe(3);
        expect(boards.boards[0]).toBeNull();
        expect(boards.boards[1].x0).toBeCloseTo(0.1, 9);
        expect(boards.boards[2].x0).toBeCloseTo(0.35, 9);
        expect(boards.boards[3]).toBeNull();
        expect(boards.boards[4].x0).toBeCloseTo(0.6, 9);
        // A player's lock leaves that player's board; a player with no board borrows the first.
        expect(boardFor(boards, 2)).toBe(boards.boards[2]);
        expect(boardFor(boards, 0)).toBe(boards.boards[1]);
        expect(boardFor(boards, 3)).toBe(boards.boards[1]);
    });
});

describe('bioluminescence composition helpers', () => {
    it('seats the fallback board at the foot of its card in a wide frame and an upright one', () => {
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
        }
    });

    it('survives a frame with no size', () => {
        for (const [width, height] of [[0, 0], [NaN, undefined], [-5, 10]]) {
            const layout = fallbackLayout(width, height);
            for (const r of [layout.cards[0], layout.boards[0], layout.hud]) {
                for (const key of ['x0', 'y0', 'x1', 'y1']) {
                    expect(Number.isFinite(r[key]), `${width}x${height} ${key}`).toBe(true);
                }
            }
        }
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
