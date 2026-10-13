import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BOARD_GRID, BOARD_SELECTOR, HUD_SELECTOR, PLAYER_SLOTS, REST_RIG, SOLO_CANVAS_SELECTORS, boardFor, boardPoint,
    cardFor, fallbackLayout, fovForAspect, playerCanvasSelector, readLayoutRects,
} from '../../src/themes/luminous-tides/luminous-tides-composition.js';
import { DEG, EYE } from '../../src/themes/luminous-tides/luminous-tides-core.js';

const rect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});
const el = (r) => ({ getBoundingClientRect: () => r });
const visible = { display: 'block', visibility: 'visible', opacity: '1' };
const source = readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'luminous-tides',
    'luminous-tides-composition.js',
), 'utf8');

/** The frames the composition must hold: a tall phone, tablets, a square, 16:9 and 21:9. */
const ASPECTS = [0.46, 388 / 844, 0.62, 0.75, 1, 4 / 3, 16 / 10, 16 / 9, 2, 21 / 9];

describe('luminous tides composition: the rest camera', () => {
    it('stands the eye where the shore puts it, with a lens that can see the whole frame', () => {
        expect(REST_RIG.eye).toBe(EYE);
        expect(REST_RIG.eye.y).toBeGreaterThan(0); // above the mean sea, on the sand
        expect(REST_RIG.near).toBeGreaterThan(0);
        expect(REST_RIG.far).toBeGreaterThan(REST_RIG.near);
        expect(REST_RIG.minFov).toBeLessThan(REST_RIG.maxFov);
        expect(REST_RIG.hFov).toBeGreaterThan(REST_RIG.minFov);
        expect(REST_RIG.hFov).toBeLessThan(REST_RIG.maxFov);
        expect(Object.isFrozen(REST_RIG)).toBe(true);
    });

    it('gives a vertical field of view inside the rig\'s bounds for every aspect, a tall phone to 21:9', () => {
        let last = Infinity;
        for (const aspect of ASPECTS) {
            const fov = fovForAspect(aspect);
            expect(fov, `fovForAspect(${aspect})`).toBeGreaterThan(1);
            expect(fov, `fovForAspect(${aspect})`).toBeLessThan(179);
            expect(fov, `fovForAspect(${aspect})`).toBeGreaterThanOrEqual(REST_RIG.minFov);
            expect(fov, `fovForAspect(${aspect})`).toBeLessThanOrEqual(REST_RIG.maxFov);
            // A wider frame never needs a taller lens.
            expect(fov, `fovForAspect(${aspect})`).toBeLessThanOrEqual(last + 1e-9);
            last = fov;
        }
        // Where it is not clamped, the rig holds its horizontal field of view.
        for (const aspect of [1, 16 / 10, 16 / 9]) {
            const v = fovForAspect(aspect);
            if (v <= REST_RIG.minFov || v >= REST_RIG.maxFov) continue;
            const h = (2 * Math.atan(Math.tan((v * DEG) / 2) * aspect)) / DEG;
            expect(h, `${aspect}`).toBeCloseTo(REST_RIG.hFov, 9);
        }
        // The bounds hold at the extremes, and nonsense is a 16:9 frame.
        expect(fovForAspect(0.2)).toBe(REST_RIG.maxFov);
        expect(fovForAspect(10)).toBe(REST_RIG.minFov);
        expect(fovForAspect(NaN)).toBe(fovForAspect(16 / 9));
        expect(fovForAspect(undefined)).toBe(fovForAspect(16 / 9));
        expect(Number.isFinite(fovForAspect(0))).toBe(true);
        expect(Number.isFinite(fovForAspect(-3))).toBe(true);
    });
});

describe('luminous tides composition: the board before it is on screen', () => {
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
        expect(layout.boards).toHaveLength(PLAYER_SLOTS);
        expect(layout.boards.slice(1).every((b) => b === null)).toBe(true);
        expect(boardFor(layout, 0)).toBe(board);
        expect(boardFor(layout, 3)).toBe(board); // a missing board falls back to the first on screen
        expect(boardFor(null)).toBeNull();
        expect(boardFor({ boards: [null, null] }, 1)).toBeNull();
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
    });

    it('makes a degenerate window a pixel, never a division by nothing', () => {
        for (const [w, h] of [[0, 0], [NaN, NaN], [1, 1], [430, 932], [3840, 1080]]) {
            const tiny = fallbackLayout(w, h);
            const numbers = [tiny.cards[0], tiny.boards[0], tiny.hud].flatMap((r) => [r.x0, r.y0, r.x1, r.y1]);
            expect(numbers.every(Number.isFinite), `${w}x${h}`).toBe(true);
            expect(tiny.boards[0].x1, `${w}x${h}`).toBeGreaterThan(tiny.boards[0].x0);
        }
    });
});

describe('luminous tides composition: board columns and rows on screen', () => {
    it('finds the card a board sits in', () => {
        const left = {
            x0: 0.05, y0: 0.1, x1: 0.45, y1: 0.9,
        };
        const right = {
            x0: 0.55, y0: 0.1, x1: 0.95, y1: 0.9,
        };
        const layout = { cards: [left, right] };
        const board = (x0) => ({
            x0, y0: 0.3, x1: x0 + 0.2, y1: 0.85,
        });
        expect(cardFor(layout, board(0.1))).toBe(left);
        expect(cardFor(layout, board(0.7))).toBe(right);
        // A board in no card, or no board at all: the first card.
        expect(cardFor(layout, board(2))).toBe(left);
        expect(cardFor(layout, null)).toBe(left);
        expect(cardFor({ cards: [] }, board(0.1))).toBeNull();
        expect(cardFor(null, board(0.1))).toBeNull();
        // The fallback layout's board sits in the fallback layout's card.
        const solo = fallbackLayout(1600, 900);
        expect(cardFor(solo, solo.boards[0])).toBe(solo.cards[0]);
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
        expect(boardPoint(board, 7, 99).y).toBeCloseTo(foot.y, 9);
        expect(boardPoint(board, -2, -5)).toEqual(boardPoint(board, 0, 0));
        expect(BOARD_GRID).toMatchObject({ columns: 10, rows: 20, hiddenRows: 4 });
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
});

describe('luminous tides composition: reading the page', () => {
    it('reads the live card, board and HUD rects, and nothing when no board is on screen', () => {
        const card = el(rect(600, 50, 400, 800));
        const canvas = el(rect(650, 200, 300, 600));
        const hud = el(rect(1050, 250, 140, 400));
        const hidden = el(rect(0, 0, 0, 0));
        const second = el(rect(1100, 300, 200, 400));
        const doc = {
            querySelectorAll: (selector) => (selector === BOARD_SELECTOR ? [card, hidden] : []),
            querySelector: (selector) => {
                if (selector === SOLO_CANVAS_SELECTORS[0]) return canvas;
                if (selector === HUD_SELECTOR) return hud;
                if (selector === playerCanvasSelector(2)) return second;
                return null;
            },
        };
        const win = { innerWidth: 1600, innerHeight: 900, getComputedStyle: () => visible };
        const layout = readLayoutRects(doc, win);
        expect(layout.cardCount).toBe(1);
        expect(layout.cards[0]).toEqual({
            x0: 0.375, y0: 50 / 900, x1: 0.625, y1: 850 / 900,
        });
        expect(layout.boards).toHaveLength(PLAYER_SLOTS);
        expect(layout.boards[0].x0).toBeCloseTo(650 / 1600, 9);
        expect(layout.hud.x1).toBeCloseTo(1190 / 1600, 9);
        // A local-multiplayer board is read into its own player's slot.
        expect(layout.boards[2].x0).toBeCloseTo(1100 / 1600, 9);
        expect(layout.boards[1]).toBeNull();
        expect(boardFor(layout, 2)).toBe(layout.boards[2]);
        expect(boardFor(layout, 4)).toBe(layout.boards[0]);
        expect(readLayoutRects(doc, win)).toEqual(layout);

        const empty = { querySelectorAll: () => [], querySelector: () => null };
        expect(readLayoutRects(empty, win)).toBeNull();
        expect(readLayoutRects(null, win)).toBeNull();
        expect(readLayoutRects(doc, null)).toBeNull();
        // A card with no canvas and no HUD yet is still a layout: the world aims at its card.
        const bare = readLayoutRects({ querySelectorAll: () => [card], querySelector: () => null }, win);
        expect(bare).toMatchObject({ cardCount: 1, hud: null });
        expect(bare.boards.every((b) => b === null)).toBe(true);
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
        expect(SOLO_CANVAS_SELECTORS).toContain('#main-game-canvas');
        expect(SOLO_CANVAS_SELECTORS).toContain('#single-player-game-canvas');
        expect(Object.isFrozen(SOLO_CANVAS_SELECTORS)).toBe(true);
        expect(playerCanvasSelector(3)).toBe('#p3-phaser-container canvas');
    });

    it('finds online play\'s board, which reports its events as the solo slot', () => {
        expect(SOLO_CANVAS_SELECTORS).toContain('#online-main-board canvas');
        const card = el(rect(600, 50, 400, 800));
        const online = el(rect(640, 180, 320, 640));
        const solo = el(rect(10, 10, 100, 200));
        const page = (canvases) => ({
            querySelectorAll: () => [card],
            querySelector: (selector) => canvases[selector] || null,
        });
        const win = { innerWidth: 1600, innerHeight: 900, getComputedStyle: () => visible };
        const layout = readLayoutRects(page({ '#online-main-board canvas': online }), win);
        expect(layout.boards[0]).toEqual({
            x0: 0.4, y0: 0.2, x1: 0.6, y1: 820 / 900,
        });
        expect(boardFor(layout, 0)).toBe(layout.boards[0]);
        // A solo board on screen still comes first: the online board is the last one asked for.
        expect(SOLO_CANVAS_SELECTORS[SOLO_CANVAS_SELECTORS.length - 1]).toBe('#online-main-board canvas');
        const both = readLayoutRects(page({ '#online-main-board canvas': online, '#main-game-canvas': solo }), win);
        expect(both.boards[0].x0).toBeCloseTo(10 / 1600, 9);
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
        expect(readLayoutRects(one(rect(2000, 50, 400, 800)), win(visible))).toBeNull();
        // A window that cannot report styles is taken at its word about the rect.
        expect(readLayoutRects(one(on), { innerWidth: 1000, innerHeight: 800 })).not.toBeNull();
    });

    it('stays three-free and reads only the document and window it is handed', () => {
        const imports = [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)]
            .map((m) => m[1]);
        expect(imports.every((name) => name.startsWith('./luminous-tides-')), imports.join()).toBe(true);
        expect(source).not.toMatch(/\bdocument\.|\bwindow\./);
    });
});
