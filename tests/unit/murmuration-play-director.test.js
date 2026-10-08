import {
    describe, expect, it, vi,
} from 'vitest';
import {
    SWARM_EVENT_HANDLERS, SwarmPlayDirector, resolvePieceColor,
} from '../../src/themes/murmuration/composition/play-director.js';
import { BOARD_GRID, PLAYER_SLOTS } from '../../src/themes/murmuration/composition/board-layout.js';
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
    return { director: new SwarmPlayDirector({ sink, ...options }), calls, sink };
}

describe('swarm play director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new SwarmPlayDirector();
        // The theme skips a key the bus does not have, silently: a typo here is a dead reaction.
        for (const [event, handler] of Object.entries(SWARM_EVENT_HANDLERS)) {
            expect(EVENTS[event], event).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
        expect(Object.keys(SWARM_EVENT_HANDLERS)).toEqual(expect.arrayContaining([
            'PIECE_LOCK', 'HARD_DROP', 'LINE_CLEAR', 'COMBO', 'TSPIN', 'B2B', 'PERFECT_CLEAR', 'LEVEL_UP',
        ]));
    });

    it('stages a lock and resolves it once, on flush, with its rows and column', () => {
        const { director, calls, sink } = makeDirector();
        expect(director.onPieceLock({ piece: T })).toBe(true);
        expect(sink.lock).not.toHaveBeenCalled();
        director.flush();
        expect(calls.lock).toHaveLength(1);
        // Rows are visible rows: the matrix carries the hidden ones on top.
        expect(calls.lock[0].rows).toEqual([22 - BOARD_GRID.hiddenRows, 23 - BOARD_GRID.hiddenRows]);
        // The column is the centroid of the OCCUPIED cells, as a fraction of the board's width.
        expect(calls.lock[0].u).toBeCloseTo((3 + 1.5) / BOARD_GRID.columns, 6);
        expect(calls.lock[0]).toMatchObject({
            player: 0, hardDrop: false, color: null, screen: null,
        });
        director.flush();
        expect(calls.lock).toHaveLength(1);
    });

    it('reads rows and column from the cells a piece fills, not from its padded matrix', () => {
        const { director, calls } = makeDirector();
        // A vertical I in a 4x4 matrix: one column, four rows, three empty columns of padding.
        const upright = {
            shape: [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]], x: 0, y: 20,
        };
        director.onPieceLock({ piece: upright });
        director.flush();
        expect(calls.lock[0].rows).toEqual([16, 17, 18, 19]);
        expect(calls.lock[0].u).toBeCloseTo(2.5 / BOARD_GRID.columns, 6);
        // Empty rows of the matrix are not rows of the piece.
        director.onPieceLock({ piece: { shape: [[0, 0, 0], [1, 1, 0], [0, 1, 1]], x: 7, y: 21 } });
        director.flush();
        expect(calls.lock[1].rows).toEqual([18, 19]);
        expect(calls.lock[1].u).toBeCloseTo((7 + 1.5) / BOARD_GRID.columns, 6);
        // Anything off the visible board is clamped onto it.
        director.onPieceLock({ piece: { shape: [[1, 1]], x: 40, y: 99 } });
        director.onPieceLock({ piece: { shape: [[1, 1]], x: -9, y: -5 }, player: 1 });
        director.flush();
        expect(calls.lock[2]).toMatchObject({ rows: [BOARD_GRID.rows - 1], u: 1 });
        expect(calls.lock[3]).toMatchObject({ rows: [0], u: 0, player: 1 });
    });

    it('folds a hard drop and its lock into one harder lock', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: I, distance: 14 });
        director.onPieceLock({ piece: I });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0].hardDrop).toBe(true);
        expect(calls.lock[0].rows).toEqual([19]);
        expect(calls.lock[0].u).toBeCloseTo(0.8, 6);
        // The next piece is an ordinary lock again.
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.lock[1].hardDrop).toBe(false);
    });

    it('carries the piece\'s own hex colour and nothing else: the swarm has no per-piece palette', () => {
        expect(resolvePieceColor({ color: '#12abEF', type: 'T' })).toBe('#12abEF');
        expect(resolvePieceColor({ color: 'T' })).toBeNull();
        expect(resolvePieceColor({ color: '#fff' })).toBeNull();
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBeNull();
        expect(resolvePieceColor({ color: 0x12abef })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: { ...T, color: '#12abEF' } });
        director.flush();
        expect(calls.lock[0].color).toBe('#12abEF');
        // The colour does not leak onto the next, colourless piece.
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.lock[1].color).toBeNull();
    });

    it('uses an on-screen lock origin when a mode supplies one (a scrolling board)', () => {
        const { director, calls } = makeDirector();
        // Infinity's piece.y is an absolute row in the hundreds; viewportOrigin is where it is on screen.
        director.onPieceLock({ piece: { ...T, y: 480 }, viewportOrigin: { x: 0.8, y: 0.25 } });
        director.flush();
        expect(calls.lock[0].rows).toEqual([5]);
        expect(calls.lock[0].u).toBeCloseTo(0.8, 6);
        // Out of range is clamped onto the board; nonsense falls back to the piece's own cells.
        director.onPieceLock({ piece: T, viewportOrigin: { x: 4, y: 7 } });
        director.flush();
        expect(calls.lock[1]).toMatchObject({ rows: [BOARD_GRID.rows - 1], u: 1 });
        director.onPieceLock({ piece: T, viewportOrigin: { x: NaN, y: 0.5 } });
        director.flush();
        expect(calls.lock[2].rows).toEqual([18, 19]);
        // And the cleared rows follow it too, centred on the origin.
        director.onPieceLock({ piece: { ...I, y: 480 }, viewportOrigin: { x: 0.5, y: 0.5 } });
        director.onLineClear({ lineCount: 3, clearedRows: [480, 479, 478], viewportOrigin: { x: 0.5, y: 0.5 } });
        director.flush();
        expect(calls.clear[0].rows).toEqual([9, 10, 11]);
    });

    it('resolves the widest clear of a frame and keeps the cascade depth apart from the combo', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.onCombo({ comboCount: 2 }); // cascade depth, never a combo
        director.onLineClear({ lineCount: 3, clearedRows: [23, 22, 21], cascadeCount: 2 });
        director.flush();
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0]).toMatchObject({
            lines: 3, cascade: 2, combo: 1, player: 0, tspin: false, perfect: false, b2b: false, screen: null,
        });
        expect(calls.clear[0].rows).toEqual([19, 18, 17]);
        expect(calls.combo).toEqual([[1, 0]]);
        // A COMBO with no clear staged is nothing at all.
        director.onCombo({ comboCount: 6 });
        director.flush();
        expect(calls.clear).toHaveLength(1);
        expect(calls.combo).toEqual([[1, 0]]);
    });

    it('counts the lines a clear names, or its rows when it names none, up to four', () => {
        const lines = (payload) => {
            const { director, calls } = makeDirector();
            director.onLineClear(payload);
            director.flush();
            return calls.clear[0].lines;
        };
        expect(lines({ lineCount: 2 })).toBe(2);
        expect(lines({ clearedRows: [23, 22, 21] })).toBe(3);
        expect(lines({})).toBe(1);
        expect(lines({ lineCount: 9, clearedRows: [23, 22, 21, 20, 19, 18] })).toBe(4);
        expect(lines({ lineCount: 0 })).toBe(1);
    });

    it('counts the true combo across locks and reports the break', () => {
        const { director, calls } = makeDirector();
        for (let i = 0; i < 3; i += 1) {
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
        // The next chain starts at one.
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22] });
        director.flush();
        expect(calls.clear.at(-1).combo).toBe(1);
        expect(calls.combo.at(-1)).toEqual([1, 0]);
    });

    it('does not count a cascade\'s later waves as more combo, even across frames', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        // The same lock is still cascading on the next frame.
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22], cascadeCount: 2 });
        director.onCombo({ comboCount: 2 });
        director.flush();
        expect(calls.clear.map((c) => [c.combo, c.cascade])).toEqual([[1, 1], [1, 2]]);
        expect(calls.combo).toEqual([[1, 0]]);
    });

    it('lets an explicit combo count raise the chain (a victory lap)', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], comboCount: 5 });
        director.flush();
        expect(calls.clear[0].combo).toBe(5);
        expect(calls.combo).toEqual([[5, 0]]);
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
        // The flags belong to that clear only.
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        expect(calls.clear[1]).toMatchObject({ tspin: false, b2b: false, perfect: false });
        // A T-spin names its own lines when the clear has not arrived yet; a perfect clear implies one.
        director.onPieceLock({ piece: T });
        director.onTSpin({ lineCount: 3 });
        director.flush();
        expect(calls.clear[2]).toMatchObject({ lines: 3, tspin: true });
        director.onPerfectClear({});
        director.flush();
        expect(calls.clear[3]).toMatchObject({ lines: 1, perfect: true });
    });

    it('turns a meditation click into a clear at a screen position', () => {
        const { director, calls } = makeDirector();
        director.setViewport(1000, 500);
        director.onCombo({ comboCount: 4, position: { x: 250, y: 400 } });
        director.flush();
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].combo).toBe(4);
        expect(calls.clear[0].screen).toEqual({ x: 0.25, y: 0.8 });
        expect(calls.lock).toHaveLength(0);
        // Off-window clicks are clamped; the next clear without a position has no screen point.
        director.onCombo({ comboCount: 5, position: { x: 4000, y: -30 } });
        director.flush();
        expect(calls.clear[1].screen).toEqual({ x: 1, y: 0 });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        expect(calls.clear[2].screen).toBeNull();
        // Without a window size a position cannot be placed.
        const blind = makeDirector();
        blind.director.onCombo({ comboCount: 2, position: { x: 250, y: 400 } });
        blind.director.flush();
        expect(blind.calls.clear[0].screen).toBeNull();
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
        // Player 2's dry locks never break player 1's chain.
        for (let i = 0; i < 2; i += 1) {
            director.onPieceLock({ piece: T, player: 2 });
            director.onPieceLock({ piece: I, player: 1 });
            director.onLineClear({ lineCount: 1, clearedRows: [23], player: 1 });
            director.flush();
        }
        expect(calls.combo).toEqual([[1, 1], [2, 1], [3, 1]]);
    });

    it('gives every player a slot of their own and drops events beyond them instead of growing', () => {
        const { director, calls } = makeDirector();
        for (let player = 0; player < PLAYER_SLOTS; player += 1) {
            expect(director.onPieceLock({ piece: T, player })).toBe(true);
        }
        expect(director.slots).toHaveLength(PLAYER_SLOTS);
        expect(director.onPieceLock({ piece: T, player: 99 })).toBe(false);
        expect(director.onLineClear({ lineCount: 4, player: 99 })).toBe(false);
        expect(director.droppedEvents).toBe(2);
        // A known player still gets through, and a missing or odd id is the solo board.
        expect(director.onHardDrop({ piece: T, player: PLAYER_SLOTS - 1 })).toBe(true);
        expect(director.slotFor({ player: 'two' })).toBe(director.slotFor({}));
        expect(director.slotFor({ player: 1.9 })).toBe(director.slotFor({ player: 1 }));
        director.flush();
        expect(calls.lock.map((c) => c.player)).toEqual([0, 1, 2, 3, 4]);
        // A new run hands the slots out afresh.
        director.reset();
        expect(director.onPieceLock({ piece: T, player: 99 })).toBe(true);
    });

    it('hands the sink the same two objects every frame: a sink copies what it keeps', () => {
        const { director, sink } = makeDirector();
        for (let i = 0; i < 2; i += 1) {
            director.onPieceLock({ piece: I });
            director.onLineClear({ lineCount: 1, clearedRows: [23] });
            director.flush();
        }
        expect(sink.lock.mock.calls[1][0]).toBe(sink.lock.mock.calls[0][0]);
        expect(sink.clear.mock.calls[1][0]).toBe(sink.clear.mock.calls[0][0]);
        expect(sink.lock.mock.calls[0][0].rows).toBe(sink.lock.mock.calls[1][0].rows);
    });

    it('survives malformed payloads without calling the sink', () => {
        const { director, calls } = makeDirector();
        expect(() => {
            director.onPieceLock(null);
            director.onPieceLock({ piece: { shape: 'nope' } });
            director.onPieceLock({ piece: { shape: [[0, 0], [0, 0]], x: 1, y: 1 } });
            director.onHardDrop(undefined);
            director.onLineClear({ lineCount: NaN, clearedRows: [NaN, 'x'] });
            director.onCombo(null);
            director.onTSpin(undefined);
            director.onLevelUp({});
            director.flush();
        }).not.toThrow();
        expect(calls.lock).toHaveLength(0);
        // A clear whose rows are unusable still counts the lines the payload named.
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].lines).toBe(2);
        expect(calls.clear[0].rows).toEqual([]);
        expect(calls.levelUp).toEqual([1]);
        // No sink at all is fine too.
        const mute = new SwarmPlayDirector();
        expect(() => {
            mute.onPieceLock({ piece: I });
            mute.onLineClear({ lineCount: 1, clearedRows: [23] });
            mute.onLevelUp({ level: 2 });
            mute.flush();
            mute.reset();
        }).not.toThrow();
    });
});

describe('swarm play director: settings and resets', () => {
    it('drops everything staged, and every combo, when reactions are switched off', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20] });
        director.onTSpin({ lineCount: 2 });
        director.configure({ enabled: false });
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 0]);
        const intakes = ['onPieceLock', 'onHardDrop', 'onLineClear', 'onCombo', 'onTSpin', 'onB2B', 'onPerfectClear'];
        for (const intake of intakes) {
            expect(director[intake]({ piece: I, lineCount: 1, position: { x: 1, y: 1 } }), intake).toBe(false);
        }
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.clear).toHaveLength(1);
        // Re-enabling never replays what was dropped, and the chain starts over.
        director.configure({ enabled: true });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.clear).toHaveLength(1);
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        expect(calls.clear.at(-1).combo).toBe(1);
    });

    it('keeps clears when only the lock ripple is switched off', () => {
        const { director, calls } = makeDirector({ lockRipple: false });
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22] });
        director.flush();
        expect(calls.lock).toHaveLength(0);
        expect(calls.clear).toHaveLength(1);
        expect(calls.combo).toEqual([[1, 0]]);
        // Switched off mid-frame, a lock already staged is cancelled and its clear kept.
        const live = makeDirector();
        live.director.onHardDrop({ piece: I });
        live.director.onPieceLock({ piece: I });
        live.director.onLineClear({ lineCount: 1, clearedRows: [23] });
        live.director.configure({ lockRipple: false });
        live.director.flush();
        expect(live.calls.lock).toHaveLength(0);
        expect(live.calls.clear).toHaveLength(1);
        live.director.configure({ lockRipple: true });
        live.director.onPieceLock({ piece: T });
        live.director.flush();
        expect(live.calls.lock).toHaveLength(1);
    });

    it('leaves a setting it was not told about as it is', () => {
        const { director } = makeDirector({ lockRipple: false });
        director.configure({});
        director.configure();
        expect(director.enabled).toBe(true);
        expect(director.lockRipple).toBe(false);
        director.configure({ enabled: false });
        expect(director.lockRipple).toBe(false);
        expect(director.enabled).toBe(false);
    });

    it('reports a level once', () => {
        const { director, calls } = makeDirector();
        director.onLevelUp({ level: 4 });
        director.flush();
        director.flush();
        expect(calls.levelUp).toEqual([4]);
        // Two in one frame: the latest. No level named: the next one.
        director.onLevelUp({ level: 5 });
        director.onLevelUp({ level: 6 });
        director.flush();
        director.onLevelUp({});
        director.flush();
        expect(calls.levelUp).toEqual([4, 6, 7]);
    });

    it('starts a new run with every slot free', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I, player: 3 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 3 });
        director.flush();
        director.onPieceLock({ piece: I, player: 3 });
        director.onLevelUp({ level: 9 });
        director.reset();
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 3]);
        expect(director.slots.every((slot) => !slot.assigned && !slot.pending && slot.tracker.combo === 0)).toBe(true);
        // Nothing staged before the reset lands after it.
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.levelUp).toEqual([]);
        // A second reset has nothing more to say.
        const reported = calls.combo.length;
        director.reset();
        expect(calls.combo).toHaveLength(reported);
    });
});
