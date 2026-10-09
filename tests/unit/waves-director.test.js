import {
    describe, expect, it, vi,
} from 'vitest';
import {
    WAVES_EVENT_HANDLERS, WavesDirector, resolvePieceColor,
} from '../../src/themes/waves/waves-director.js';
import {
    BOARD_GRID, BOARD_SELECTOR, HUD_SELECTOR, PLAYER_SLOTS, SOLO_CANVAS_SELECTORS, boardFor, boardPoint, cardFor,
    fallbackLayout, playerCanvasSelector, readLayoutRects,
} from '../../src/themes/waves/waves-composition.js';
import { WAVES_TETROMINOS } from '../../src/themes/waves/waves-tetrominos.js';
import { EVENTS } from '../../src/events/event-bus.js';

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};

function makeDirector(options = {}) {
    const calls = {
        lock: [], clear: [], combo: [], levelUp: [],
    };
    const sink = {
        // The director reuses its context objects: a sink must copy what it keeps.
        lock: vi.fn((c) => calls.lock.push({ ...c, rows: [...c.rows] })),
        clear: vi.fn((c) => calls.clear.push({ ...c, rows: [...c.rows], screen: c.screen ? { ...c.screen } : null })),
        combo: vi.fn((n, player) => calls.combo.push([n, player])),
        levelUp: vi.fn((level) => calls.levelUp.push(level)),
    };
    return { director: new WavesDirector({ sink, ...options }), calls, sink };
}

describe('waves director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new WavesDirector();
        for (const [event, handler] of Object.entries(WAVES_EVENT_HANDLERS)) {
            expect(EVENTS[event], event).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
        // Everything the wave answers: locks, drops, clears, chains, T-spins, perfect clears, levels.
        const heard = Object.keys(WAVES_EVENT_HANDLERS);
        for (const event of ['PIECE_LOCK', 'HARD_DROP', 'LINE_CLEAR', 'COMBO', 'TSPIN', 'PERFECT_CLEAR', 'LEVEL_UP']) {
            expect(heard, event).toContain(event);
        }
        expect(Object.isFrozen(WAVES_EVENT_HANDLERS)).toBe(true);
    });

    it('stages a lock and resolves it once, on flush, with its rows, column and colour', () => {
        const { director, calls, sink } = makeDirector();
        director.onPieceLock({ piece: T });
        expect(sink.lock).not.toHaveBeenCalled();
        director.flush();
        expect(calls.lock).toHaveLength(1);
        // Rows are visible rows: the matrix carries four hidden ones.
        expect(calls.lock[0].rows).toEqual([18, 19]);
        // The column is the centroid of the OCCUPIED cells, as a fraction of the ten columns.
        expect(calls.lock[0].u).toBeCloseTo((3 + 1.5) / 10, 6);
        expect(calls.lock[0].color).toBe(WAVES_TETROMINOS.colors.T);
        expect(calls.lock[0].hardDrop).toBe(false);
        expect(calls.lock[0].player).toBe(0);
        expect(calls.lock[0].screen).toBeNull();
        director.flush();
        expect(calls.lock).toHaveLength(1);
    });

    it('folds a hard drop and its lock into one harder lock', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: I, distance: 14 });
        director.onPieceLock({ piece: I });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0].hardDrop).toBe(true);
        expect(calls.lock[0].rows).toEqual([19]);
    });

    it('prefers the piece\'s own hex colour and falls back to the theme\'s colour for its shape', () => {
        expect(resolvePieceColor({ color: '#12abEF', type: 'T' })).toBe('#12abEF');
        expect(resolvePieceColor({ color: 'T' })).toBe(WAVES_TETROMINOS.colors.T);
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBe(WAVES_TETROMINOS.colors.Z);
        expect(resolvePieceColor({ type: 'nope' })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
        // Every shape the game deals has a colour of its own to leave in the water.
        const seven = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map((type) => resolvePieceColor({ type }));
        for (const color of seven) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(new Set(seven).size).toBe(7);
    });

    it('uses an on-screen lock origin when a mode supplies one (a scrolling board)', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: { ...T, y: 480 }, viewportOrigin: { x: 0.8, y: 0.25 } });
        director.flush();
        expect(calls.lock[0].rows).toEqual([5]);
        expect(calls.lock[0].u).toBeCloseTo(0.8, 6);
    });

    it('resolves the widest clear of a frame and keeps the cascade depth apart from the combo', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.onCombo({ comboCount: 2 }); // cascade depth, never a combo
        director.onLineClear({ lineCount: 3, clearedRows: [23, 22, 21], cascadeCount: 2 });
        director.flush();
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0]).toMatchObject({ lines: 3, cascade: 2, combo: 1 });
        expect(calls.clear[0].rows).toEqual([19, 18, 17]);
        expect(calls.combo).toEqual([[1, 0]]);
    });

    it('counts the true combo across locks and reports the break', () => {
        const { director, calls } = makeDirector();
        for (let i = 0; i < 3; i++) {
            director.onPieceLock({ piece: I });
            director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            director.flush();
        }
        expect(calls.clear.map((c) => c.combo)).toEqual([1, 2, 3]);
        expect(calls.combo).toEqual([[1, 0], [2, 0], [3, 0]]);
        // A lock that clears nothing ends the chain. Physics emits no "resolved with no clears"
        // callback, so the tracker learns of it when the NEXT piece locks.
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.combo[calls.combo.length - 1]).toEqual([3, 0]);
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 0]);
    });

    it('carries T-spins, perfect clears and back-to-backs on the clear', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        director.onTSpin({ lineCount: 2 });
        director.onB2B({ active: true });
        director.onPerfectClear({ depth: 1 });
        director.flush();
        expect(calls.clear[0]).toMatchObject({
            lines: 2, tspin: true, b2b: true, perfect: true,
        });
        // An inactive B2B is not one.
        expect(director.onB2B({ active: false })).toBe(false);
        // The next clear carries none of them over.
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[1]).toMatchObject({
            lines: 1, tspin: false, b2b: false, perfect: false,
        });
    });

    it('turns a meditation click into a clear at a screen position', () => {
        const { director, calls } = makeDirector();
        director.setViewport(1000, 500);
        director.onCombo({ comboCount: 4, position: { x: 250, y: 400 } });
        director.flush();
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].combo).toBe(4);
        expect(calls.clear[0].screen).toEqual({ x: 0.25, y: 0.8 });
    });

    it('keeps each local-multiplayer board\'s combo to itself', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I, player: 1 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 1 });
        director.onPieceLock({ piece: T, player: 2 });
        director.flush();
        expect(calls.lock.map((c) => c.player).sort()).toEqual([1, 2]);
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].player).toBe(1);
        expect(calls.combo).toEqual([[1, 1]]);
    });

    it('drops events beyond its player slots instead of growing', () => {
        const { director } = makeDirector();
        for (let player = 0; player < PLAYER_SLOTS; player++) {
            expect(director.onPieceLock({ piece: T, player })).toBe(true);
        }
        expect(director.onPieceLock({ piece: T, player: 99 })).toBe(false);
        expect(director.droppedEvents).toBe(1);
        expect(director.slots).toHaveLength(PLAYER_SLOTS);
    });

    it('survives malformed payloads without calling the sink', () => {
        const { director, calls } = makeDirector();
        expect(() => {
            director.onPieceLock(null);
            director.onPieceLock({ piece: { shape: 'nope' } });
            director.onPieceLock({ piece: { shape: [[0, 0], [0, 0]], x: 1, y: 1 } });
            director.onHardDrop(undefined);
            director.onLineClear({ lineCount: NaN, clearedRows: [NaN, 'x'] });
            director.onLevelUp({});
            director.flush();
        }).not.toThrow();
        expect(calls.lock).toHaveLength(0);
        // A clear whose rows are unusable still counts the lines the payload named.
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].lines).toBe(2);
        expect(calls.clear[0].rows).toEqual([]);
        expect(calls.levelUp).toEqual([1]);
    });

    it('works with no sink at all, and with a sink that only hears some of it', () => {
        const bare = new WavesDirector();
        expect(() => {
            bare.onPieceLock({ piece: T });
            bare.onLineClear({ lineCount: 1, clearedRows: [23] });
            bare.onLevelUp({ level: 2 });
            bare.flush();
            bare.reset();
        }).not.toThrow();
        const combo = vi.fn();
        const partial = new WavesDirector({ sink: { combo } });
        partial.onPieceLock({ piece: T });
        partial.onLineClear({ lineCount: 1, clearedRows: [23] });
        partial.onLevelUp({ level: 2 });
        expect(() => partial.flush()).not.toThrow();
        expect(combo).toHaveBeenCalledExactlyOnceWith(1, 0);
    });
});

describe('waves director: settings and resets', () => {
    it('drops everything staged, and every combo, when reactions are switched off', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        director.onPieceLock({ piece: I });
        director.configure({ enabled: false });
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 0]);
        expect(director.onPieceLock({ piece: I })).toBe(false);
        director.flush();
        expect(calls.lock).toHaveLength(1);
        // Re-enabling never replays what was dropped.
        director.configure({ enabled: true });
        director.flush();
        expect(calls.lock).toHaveLength(1);
    });

    it('keeps clears when only the lock ripple is switched off', () => {
        const { director, calls } = makeDirector({ lockRipple: false });
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22] });
        director.flush();
        expect(calls.lock).toHaveLength(0);
        expect(calls.clear).toHaveLength(1);
        // Switched off between a lock and its frame: the staged lock is cancelled, the clear is not.
        const late = makeDirector();
        late.director.onPieceLock({ piece: I });
        late.director.onLineClear({ lineCount: 1, clearedRows: [23] });
        late.director.configure({ lockRipple: false });
        late.director.flush();
        expect(late.calls.lock).toHaveLength(0);
        expect(late.calls.clear).toHaveLength(1);
        // And back on: the next lock lands.
        late.director.configure({ lockRipple: true });
        late.director.onPieceLock({ piece: I });
        late.director.flush();
        expect(late.calls.lock).toHaveLength(1);
    });

    it('reports a level once', () => {
        const { director, calls } = makeDirector();
        director.onLevelUp({ level: 4 });
        director.flush();
        director.flush();
        expect(calls.levelUp).toEqual([4]);
        // A level with no number is the next one.
        director.onLevelUp({});
        director.flush();
        expect(calls.levelUp).toEqual([4, 5]);
    });

    it('starts a new run with every slot free', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I, player: 3 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 3 });
        director.flush();
        director.onLevelUp({ level: 9 });
        director.reset();
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 3]);
        expect(director.slots.every((slot) => !slot.assigned && slot.tracker.combo === 0)).toBe(true);
        // Nothing staged before the reset comes out after it.
        director.flush();
        expect(calls.levelUp).toEqual([]);
        expect(calls.lock).toHaveLength(1);
        expect(calls.clear).toHaveLength(1);
    });
});

describe('waves composition', () => {
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
        // A degenerate window is a pixel, never a division by nothing.
        for (const [w, h] of [[0, 0], [NaN, NaN], [1, 1], [430, 932], [3840, 1080]]) {
            const tiny = fallbackLayout(w, h);
            const numbers = [tiny.cards[0], tiny.boards[0], tiny.hud].flatMap((r) => [r.x0, r.y0, r.x1, r.y1]);
            expect(numbers.every(Number.isFinite), `${w}x${h}`).toBe(true);
            expect(tiny.boards[0].x1, `${w}x${h}`).toBeGreaterThan(tiny.boards[0].x0);
        }
    });

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
        // It writes into what it is given.
        const out = { x: 9, y: 9 };
        expect(boardPoint(board, 0.5, 10, out)).toBe(out);
        expect(out.x).toBeCloseTo(0.5, 9);
        expect(BOARD_GRID).toMatchObject({ columns: 10, rows: 20 });
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
        const win = {
            innerWidth: 1600,
            innerHeight: 900,
            getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        };
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

        // What is on the page but not on the screen is not there.
        const shown = { display: 'block', visibility: 'visible', opacity: '1' };
        for (const style of [{ display: 'none' }, { visibility: 'hidden' }, { opacity: '0' }]) {
            const dark = { ...win, getComputedStyle: () => ({ ...shown, ...style }) };
            expect(readLayoutRects(doc, dark), JSON.stringify(style)).toBeNull();
        }
        const offscreen = { ...doc, querySelectorAll: () => [el(rect(2000, 50, 400, 800))] };
        expect(readLayoutRects(offscreen, win)).toBeNull();
        const empty = { querySelectorAll: () => [], querySelector: () => null };
        expect(readLayoutRects(empty, win)).toBeNull();
        expect(readLayoutRects(null, win)).toBeNull();
        expect(readLayoutRects(doc, null)).toBeNull();
        // A card with no canvas and no HUD yet is still a layout: the world aims at its card.
        const bare = readLayoutRects({ querySelectorAll: () => [card], querySelector: () => null }, win);
        expect(bare).toMatchObject({ cardCount: 1, hud: null });
        expect(bare.boards.every((b) => b === null)).toBe(true);
    });
});
