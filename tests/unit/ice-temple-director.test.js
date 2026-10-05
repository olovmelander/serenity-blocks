import {
    describe, expect, it, vi,
} from 'vitest';
import {
    ICE_TEMPLE_EVENT_HANDLERS, IceTempleDirector, resolvePieceColor,
} from '../../src/themes/ice-temple/ice-temple-director.js';
import {
    BOARD_GRID, PLAYER_SLOTS, boardFor, boardPoint, cardUnion, fallbackLayout, layoutsDiffer, readLayoutRects,
} from '../../src/themes/ice-temple/ice-temple-composition.js';
import { ICE_TEMPLE_TETROMINOS } from '../../src/themes/ice-temple/ice-temple-tetrominos.js';
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
    return { director: new IceTempleDirector({ sink, ...options }), calls, sink };
}

describe('ice temple director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new IceTempleDirector();
        for (const [event, handler] of Object.entries(ICE_TEMPLE_EVENT_HANDLERS)) {
            expect(EVENTS[event], event).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
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
        expect(calls.lock[0].color).toBe(ICE_TEMPLE_TETROMINOS.colors.T);
        expect(calls.lock[0].hardDrop).toBe(false);
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
        expect(resolvePieceColor({ color: 'T' })).toBe(ICE_TEMPLE_TETROMINOS.colors.T);
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBe(ICE_TEMPLE_TETROMINOS.colors.Z);
        expect(resolvePieceColor({ type: 'nope' })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
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
        for (let player = 0; player < PLAYER_SLOTS; player++) expect(director.onPieceLock({ piece: T, player })).toBe(true);
        expect(director.onPieceLock({ piece: T, player: 99 })).toBe(false);
        expect(director.droppedEvents).toBe(1);
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
});

describe('ice temple director: settings and resets', () => {
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
    });

    it('reports a level once', () => {
        const { director, calls } = makeDirector();
        director.onLevelUp({ level: 4 });
        director.flush();
        director.flush();
        expect(calls.levelUp).toEqual([4]);
    });

    it('starts a new run with every slot free', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I, player: 3 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 3 });
        director.flush();
        director.reset();
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 3]);
        expect(director.slots.every((slot) => !slot.assigned && slot.tracker.combo === 0)).toBe(true);
    });
});

describe('ice temple composition', () => {
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
        const rect = (left, top, width, height) => ({
            left, top, right: left + width, bottom: top + height, width, height,
        });
        const el = (r) => ({ getBoundingClientRect: () => r });
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
        const win = {
            innerWidth: 1600, innerHeight: 900, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        };
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
});
