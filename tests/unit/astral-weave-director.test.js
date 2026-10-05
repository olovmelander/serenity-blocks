import { describe, expect, it } from 'vitest';
import {
    ASTRAL_WEAVE_EVENT_HANDLERS, AstralWeaveDirector,
} from '../../src/themes/astral-weave/astral-weave-director.js';
import { PLAYER_SLOTS } from '../../src/themes/astral-weave/astral-weave-composition.js';
import { EVENTS } from '../../src/events/event-bus.js';

const HIDDEN = 4;

function recorder() {
    const calls = [];
    const copy = (c) => ({ ...c, rows: [...c.rows], screen: c.screen ? { ...c.screen } : null });
    return {
        calls,
        sink: {
            lock: (c) => calls.push(['lock', copy(c)]),
            clear: (c) => calls.push(['clear', copy(c)]),
            combo: (n, player) => calls.push(['combo', n, player]),
            levelUp: (level) => calls.push(['levelUp', level]),
        },
        of: (kind) => calls.filter(([k]) => k === kind).map(([, ...rest]) => (rest.length === 1 ? rest[0] : rest)),
    };
}

/** A lock that clears `rows` (absolute row indexes, hidden rows included). */
function clearingLock(director, rows, extra = {}) {
    director.onPieceLock({ piece: { shape: [[1, 1, 1, 1]], x: 3, y: rows[rows.length - 1] } });
    director.onLineClear({
        lineCount: rows.length, clearedRows: rows, cascadeCount: 1, ...extra,
    });
}

describe('astral weave director: wiring', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new AstralWeaveDirector();
        for (const [key, handler] of Object.entries(ASTRAL_WEAVE_EVENT_HANDLERS)) {
            expect(EVENTS[key], `EVENTS.${key}`).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
    });
});

describe('astral weave director: locks', () => {
    it('reports the visible rows the piece occupies and its column, from the occupied cells', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        // An S piece: two rows, padded matrix. Occupied columns 4,5 (row 0) and 3,4 (row 1).
        director.onPieceLock({ piece: { shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]], x: 3, y: HIDDEN + 17 } });
        expect(r.calls).toEqual([]); // staged only
        director.flush();
        const [lock] = r.of('lock');
        expect(lock.rows).toEqual([17, 18]);
        expect(lock.u).toBeCloseTo((4.5 + 5.5 + 3.5 + 4.5) / 4 / 10, 10);
        expect(lock.hardDrop).toBe(false);
        expect(lock.player).toBe(0);
    });

    it('folds a hard drop and the lock of the same piece into one cue', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        const piece = { shape: [[1], [1], [1], [1]], x: 9, y: HIDDEN + 16 };
        director.onHardDrop({
            piece, startY: 2, endY: 20, distance: 18,
        });
        director.onPieceLock({ piece });
        director.flush();
        expect(r.of('lock')).toHaveLength(1);
        expect(r.of('lock')[0]).toMatchObject({ rows: [16, 17, 18, 19], hardDrop: true });
        expect(r.of('lock')[0].u).toBeCloseTo(0.95, 10);
    });

    it("prefers Infinity's on-playfield viewport origin over the absolute piece row", () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        director.onPieceLock({
            piece: { shape: [[1, 1]], x: 4, y: 412 },
            viewportOrigin: { x: 0.3, y: 0.52 },
        });
        director.flush();
        expect(r.of('lock')[0]).toMatchObject({ rows: [10], u: 0.3 });
    });

    it('clamps rows that are above the visible field or below its floor', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        director.onPieceLock({ piece: { shape: [[1], [1]], x: 0, y: 0 } });
        director.flush();
        expect(r.of('lock')[0].rows).toEqual([0, 0]);
        director.onPieceLock({ piece: { shape: [[1]], x: 0, y: 900 } });
        director.flush();
        expect(r.of('lock')[1].rows).toEqual([19]);
    });

    it('stays silent for a lock with no usable piece and for hostile payloads', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        const hostile = [
            undefined, null, {}, { piece: null }, { piece: { shape: 'x' } }, { piece: { shape: [[0, 0]] } },
        ];
        for (const payload of hostile) {
            expect(() => director.onPieceLock(payload)).not.toThrow();
        }
        director.flush();
        expect(r.of('lock')).toEqual([]);
    });

    it('drops locks when the lock ripple is off but keeps the clears', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink, lockRipple: false });
        clearingLock(director, [HIDDEN + 19]);
        director.flush();
        expect(r.of('lock')).toEqual([]);
        expect(r.of('clear')).toHaveLength(1);
    });
});

describe('astral weave director: clears and the true combo', () => {
    it('reports the cleared visible rows, the line count and the cascade depth', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        director.onPieceLock({ piece: { shape: [[1, 1, 1, 1]], x: 0, y: HIDDEN + 19 } });
        director.onLineClear({ lineCount: 2, clearedRows: [HIDDEN + 18, HIDDEN + 19], cascadeCount: 1 });
        director.onCombo({ comboCount: 3 }); // the bus's COMBO is cascade DEPTH, not a combo
        director.flush();
        const [clear] = r.of('clear');
        expect(clear).toMatchObject({
            rows: [18, 19], lines: 2, combo: 1, cascade: 3, tspin: false, perfect: false,
        });
    });

    it('counts consecutive clearing locks, not cascade waves, and breaks on a lock that clears nothing', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        clearingLock(director, [HIDDEN + 19]);
        director.flush();
        // The same lock cascades: a second wave must not advance the combo.
        director.onLineClear({ lineCount: 1, clearedRows: [HIDDEN + 19], cascadeCount: 2 });
        director.flush();
        clearingLock(director, [HIDDEN + 19]);
        director.flush();
        clearingLock(director, [HIDDEN + 18, HIDDEN + 19]);
        director.flush();
        expect(r.of('clear').map((c) => c.combo)).toEqual([1, 1, 2, 3]);
        expect(r.of('combo').map(([n]) => n)).toEqual([1, 2, 3]);

        // A lock that clears nothing: the chain is known to be broken at the lock after it.
        director.onPieceLock({ piece: { shape: [[1]], x: 0, y: HIDDEN + 10 } });
        director.flush();
        director.onPieceLock({ piece: { shape: [[1]], x: 1, y: HIDDEN + 10 } });
        director.flush();
        expect(r.of('combo').map(([n]) => n)).toEqual([1, 2, 3, 0]);
    });

    it('marks a four-line clear, a T-spin, a perfect clear and a back-to-back', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        director.onPieceLock({ piece: { shape: [[1], [1], [1], [1]], x: 0, y: HIDDEN + 16 } });
        director.onLineClear({
            lineCount: 4, clearedRows: [HIDDEN + 16, HIDDEN + 17, HIDDEN + 18, HIDDEN + 19], cascadeCount: 1,
        });
        director.onTSpin({ lineCount: 2 });
        director.onB2B({ active: true });
        director.onPerfectClear({ depth: 1 });
        director.flush();
        expect(r.of('clear')[0]).toMatchObject({
            rows: [16, 17, 18, 19], lines: 4, tspin: true, b2b: true, perfect: true,
        });
    });

    it('keeps the widest wave when several clears are staged in one frame', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        director.onPieceLock({ piece: { shape: [[1, 1]], x: 0, y: HIDDEN + 19 } });
        director.onLineClear({ lineCount: 1, clearedRows: [HIDDEN + 19], cascadeCount: 1 });
        director.onLineClear({ lineCount: 3, clearedRows: [HIDDEN + 15, HIDDEN + 16, HIDDEN + 17], cascadeCount: 2 });
        director.flush();
        expect(r.of('clear')).toHaveLength(1);
        expect(r.of('clear')[0]).toMatchObject({ rows: [15, 16, 17], lines: 3, cascade: 2 });
    });

    it('anchors a meditation click on the screen and takes its click combo', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        director.setViewport(1000, 500);
        director.onLineClear({ lineCount: 1, position: { x: 250, y: 400 }, comboCount: 4 });
        director.flush();
        const [clear] = r.of('clear');
        expect(clear.screen).toEqual({ x: 0.25, y: 0.8 });
        expect(clear.combo).toBe(4);
    });

    it('keeps one combo per local player', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        for (const player of [1, 2, 1, 1]) {
            director.onPieceLock({ piece: { shape: [[1]], x: 0, y: HIDDEN + 19 }, player });
            director.onLineClear({ lineCount: 1, clearedRows: [HIDDEN + 19], player });
            director.flush();
        }
        expect(r.of('clear').map((c) => [c.player, c.combo])).toEqual([[1, 1], [2, 1], [1, 2], [1, 3]]);
    });

    it('counts and drops events once every player slot is taken', () => {
        const director = new AstralWeaveDirector();
        for (let player = 0; player < PLAYER_SLOTS; player++) {
            expect(director.onPieceLock({ piece: { shape: [[1]], x: 0, y: 5 }, player })).toBe(true);
        }
        expect(director.onPieceLock({ piece: { shape: [[1]], x: 0, y: 5 }, player: 99 })).toBe(false);
        expect(director.droppedEvents).toBe(1);
    });
});

describe('astral weave director: settings and sessions', () => {
    it('stages nothing while reactions are off and cannot replay stale gameplay when re-enabled', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        clearingLock(director, [HIDDEN + 19]);
        director.flush();
        clearingLock(director, [HIDDEN + 19]); // staged, never flushed
        director.configure({ enabled: false });
        expect(r.of('combo').map(([n]) => n)).toEqual([1, 0]);
        clearingLock(director, [HIDDEN + 19]);
        director.flush();
        expect(r.of('clear')).toHaveLength(1);
        director.configure({ enabled: true });
        director.flush();
        expect(r.of('clear')).toHaveLength(1);
        clearingLock(director, [HIDDEN + 19]);
        director.flush();
        expect(r.of('clear')[1].combo).toBe(1);
    });

    it('resets every combo for a new run', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        clearingLock(director, [HIDDEN + 19]);
        director.flush();
        clearingLock(director, [HIDDEN + 19]);
        director.flush();
        director.reset();
        clearingLock(director, [HIDDEN + 19]);
        director.flush();
        expect(r.of('combo').map(([n]) => n)).toEqual([1, 2, 0, 1]);
    });

    it('passes the level through once per level-up', () => {
        const r = recorder();
        const director = new AstralWeaveDirector({ sink: r.sink });
        director.onLevelUp({ level: 4 });
        director.flush();
        director.flush();
        director.onLevelUp({});
        director.flush();
        expect(r.of('levelUp')).toEqual([4, 5]);
    });

    it('reuses its cue objects: nothing is allocated per event', () => {
        const seen = new Set();
        const director = new AstralWeaveDirector({ sink: { lock: (c) => seen.add(c), clear: (c) => seen.add(c) } });
        for (let i = 0; i < 20; i++) {
            clearingLock(director, [HIDDEN + 19]);
            director.flush();
        }
        expect(seen.size).toBe(2);
    });
});
