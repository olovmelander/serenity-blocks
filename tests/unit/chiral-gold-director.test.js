import { describe, expect, it } from 'vitest';
import {
    CHIRAL_GOLD_EVENT_HANDLERS,
    ChiralGoldDirector,
    resolvePieceColor,
} from '../../src/themes/chiral-gold/chiral-gold-director.js';
import { PLAYER_SLOTS } from '../../src/themes/chiral-gold/chiral-gold-composition.js';
import { CHIRAL_GOLD_TETROMINOS } from '../../src/themes/chiral-gold/chiral-gold-tetrominos.js';
import { EVENTS } from '../../src/events/event-bus.js';

/** A sink that copies what it is given (the director reuses its lock and clear objects). */
function createSink() {
    const calls = {
        locks: [], clears: [], combos: [], levels: [],
    };
    return {
        calls,
        sink: {
            lock: (c) => calls.locks.push({ ...c, rows: [...c.rows] }),
            clear: (c) => calls.clears.push({ ...c, rows: [...c.rows], screen: c.screen ? { ...c.screen } : null }),
            combo: (n, player) => calls.combos.push([n, player]),
            levelUp: (level) => calls.levels.push(level),
        },
    };
}

// Board rows carry four hidden rows above the visible twenty.
const T = {
    shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], x: 3, y: 22, type: 'T',
};
const I_LEFT = {
    shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], x: 0, y: 21, type: 'I',
};

describe('Chiral Gold director: stage on the bus, resolve on the frame', () => {
    it('answers every gameplay event the bus carries', () => {
        const director = new ChiralGoldDirector();
        for (const [key, handler] of Object.entries(CHIRAL_GOLD_EVENT_HANDLERS)) {
            expect(EVENTS[key], key).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
    });

    it('stages a lock and lands it once, with the rows and column of the occupied cells', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        expect(director.onPieceLock({ piece: T })).toBe(true);
        expect(calls.locks).toHaveLength(0);
        director.flush();
        expect(calls.locks).toHaveLength(1);
        const [lock] = calls.locks;
        // Shape rows 0 and 1 are occupied: board rows 22 and 23, visible rows 18 and 19.
        expect(lock.rows).toEqual([18, 19]);
        // Cells at columns 4 | 3 4 5: the centroid is the middle of column 4.
        expect(lock.u).toBeCloseTo(4.5 / 10, 12);
        expect(lock).toMatchObject({ player: 0, hardDrop: false, color: CHIRAL_GOLD_TETROMINOS.colors.T });
        director.flush();
        expect(calls.locks).toHaveLength(1);
    });

    it('measures the column from the cells, not from the padded matrix', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onPieceLock({ piece: I_LEFT });
        director.flush();
        expect(calls.locks[0].rows).toEqual([18]);
        expect(calls.locks[0].u).toBeCloseTo(0.2, 12);
    });

    it('folds a hard drop and its lock into one harder lock', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onHardDrop({ piece: T });
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.locks).toHaveLength(1);
        expect(calls.locks[0].hardDrop).toBe(true);
    });

    it('prefers the on-screen origin Infinity supplies over fixed-board row maths', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onPieceLock({ piece: { ...T, y: 431 }, viewportOrigin: { x: 0.25, y: 0.5 } });
        director.onLineClear({ lineCount: 2, clearedRows: [440, 441], viewportOrigin: { x: 0.5, y: 0.6 } });
        director.flush();
        expect(calls.locks[0].rows).toEqual([10]);
        expect(calls.locks[0].u).toBe(0.25);
        expect(calls.clears[0].rows).toEqual([12, 13]);
    });

    it('lands a clear with its visible rows and line count', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 2, clearedRows: [22, 23], cascadeCount: 1 });
        director.flush();
        expect(calls.clears).toHaveLength(1);
        expect(calls.clears[0]).toMatchObject({
            rows: [18, 19], lines: 2, combo: 1, cascade: 1, tspin: false, perfect: false, screen: null,
        });
        expect(calls.combos).toEqual([[1, 0]]);
    });

    it('lets the widest of several waves in one frame name the rows', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.onLineClear({ lineCount: 3, clearedRows: [21, 22, 23], cascadeCount: 2 });
        director.onCombo({ comboCount: 2 });
        director.flush();
        expect(calls.clears).toHaveLength(1);
        expect(calls.clears[0]).toMatchObject({ rows: [17, 18, 19], lines: 3, cascade: 2 });
    });

    it('counts the true combo: consecutive locks that clear, ended by one that does not', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        for (let i = 0; i < 3; i++) {
            director.onPieceLock({ piece: T });
            director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            director.flush();
        }
        expect(calls.clears.map((c) => c.combo)).toEqual([1, 2, 3]);
        expect(calls.combos).toEqual([[1, 0], [2, 0], [3, 0]]);
        // A lock that clears nothing is silent: the tracker learns the chain ended when the
        // next piece locks (ADR-0011), and the clear that follows starts a new chain at 1.
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.combos).toHaveLength(3);
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.combos.at(-1)).toEqual([0, 0]);
        director.flush();
        expect(calls.combos).toHaveLength(4);
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(calls.clears.at(-1).combo).toBe(1);
    });

    it('never mistakes the bus COMBO (cascade depth) for a combo', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 2 });
        director.onCombo({ comboCount: 7 });
        director.flush();
        expect(calls.clears[0].combo).toBe(1);
        expect(calls.clears[0].cascade).toBe(7);
        // A COMBO with no clear staged is ignored outright.
        director.onCombo({ comboCount: 9 });
        director.flush();
        expect(calls.clears).toHaveLength(1);
    });

    it('takes an explicit comboCount on the clear, and a meditation click as a clear on screen', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.setViewport(1000, 500);
        director.onLineClear({ lineCount: 1, comboCount: 4, position: { x: 250, y: 400 } });
        director.flush();
        expect(calls.clears[0]).toMatchObject({ combo: 4, screen: { x: 0.25, y: 0.8 } });
        director.onCombo({ comboCount: 6, position: { x: 2000, y: -50 } });
        director.flush();
        expect(calls.clears[1]).toMatchObject({ lines: 1, combo: 6, screen: { x: 1, y: 0 } });
    });

    it('carries T-spins, back-to-backs and perfect clears on the clear', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onPieceLock({ piece: T });
        director.onTSpin({ lineCount: 2 });
        director.onB2B({ active: true });
        director.onLineClear({ lineCount: 2, clearedRows: [22, 23] });
        director.onPerfectClear({});
        director.flush();
        expect(calls.clears[0]).toMatchObject({
            lines: 2, tspin: true, b2b: true, perfect: true,
        });
        // The flags do not leak into the next clear.
        director.onPieceLock({ piece: T });
        director.onB2B({ active: false });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        expect(calls.clears[1]).toMatchObject({ tspin: false, b2b: false, perfect: false });
    });

    it('keeps one chain per board and drops a sixth board rather than crossing wires', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        for (let player = 1; player <= PLAYER_SLOTS; player++) {
            director.onPieceLock({ piece: T, player });
            director.onLineClear({ lineCount: 1, clearedRows: [23], player });
        }
        expect(director.onPieceLock({ piece: T, player: 99 })).toBe(false);
        expect(director.droppedEvents).toBe(1);
        director.flush();
        expect(calls.locks.map((c) => c.player)).toEqual([1, 2, 3, 4, 5]);
        expect(calls.combos).toEqual([[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
        // Player 2 extends its chain; player 3 ends its own (two locks that clear nothing).
        director.onPieceLock({ piece: T, player: 2 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 2 });
        director.onPieceLock({ piece: T, player: 3 });
        director.onPieceLock({ piece: T, player: 3 });
        director.flush();
        expect(calls.combos.slice(5)).toEqual([[2, 2], [0, 3]]);
    });

    it('drops everything staged when reactions are switched off, and cannot replay it', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.configure({ enabled: false });
        expect(calls.combos.at(-1)).toEqual([0, 0]);
        expect(director.onPieceLock({ piece: T })).toBe(false);
        director.flush();
        director.configure({ enabled: true });
        director.flush();
        expect(calls.locks).toHaveLength(1);
        expect(calls.clears).toHaveLength(1);
    });

    it('can silence locks alone and keep the clears', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink, lockRipple: false });
        director.onHardDrop({ piece: T });
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        expect(calls.locks).toHaveLength(0);
        expect(calls.clears).toHaveLength(1);
        // Switched off between the staging and the frame: the staged lock is cancelled too.
        director.configure({ lockRipple: true });
        director.onPieceLock({ piece: T });
        director.configure({ lockRipple: false });
        director.flush();
        expect(calls.locks).toHaveLength(0);
    });

    it('reports a level-up once, on the frame', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onLevelUp({ level: 3 });
        director.onLevelUp({ level: 4 });
        expect(calls.levels).toEqual([]);
        director.flush();
        director.flush();
        expect(calls.levels).toEqual([4]);
        director.onLevelUp({});
        director.flush();
        expect(calls.levels).toEqual([4, 5]);
    });

    it('ends every chain on reset', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        director.onPieceLock({ piece: T, player: 1 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 1 });
        director.flush();
        director.onPieceLock({ piece: T, player: 1 });
        director.reset();
        expect(calls.combos.at(-1)).toEqual([0, 1]);
        director.flush();
        expect(calls.locks).toHaveLength(1);
        expect(director.slots.every((slot) => !slot.assigned && !slot.pending)).toBe(true);
    });

    it('survives malformed payloads without throwing or inventing gameplay', () => {
        const { sink, calls } = createSink();
        const director = new ChiralGoldDirector({ sink });
        for (const handler of Object.values(CHIRAL_GOLD_EVENT_HANDLERS)) {
            expect(() => director[handler](undefined)).not.toThrow();
            expect(() => director[handler]({ piece: { shape: 'x' }, clearedRows: 7, lineCount: 'two' })).not.toThrow();
        }
        director.onPieceLock({ piece: { shape: [[0, 0], [0, 0]] } });
        director.flush();
        // A lock with no cells has nowhere to land.
        expect(calls.locks).toHaveLength(0);
    });

    it("uses the piece's own colour when it carries one, the theme's otherwise", () => {
        expect(resolvePieceColor({ color: '#123abc', type: 'T' })).toBe('#123abc');
        expect(resolvePieceColor({ type: 'O' })).toBe(CHIRAL_GOLD_TETROMINOS.colors.O);
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBe(CHIRAL_GOLD_TETROMINOS.colors.Z);
        expect(resolvePieceColor({ type: 'nope' })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
    });
});
