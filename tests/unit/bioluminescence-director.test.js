import {
    describe, expect, it, vi,
} from 'vitest';
import {
    BIOLUMINESCENCE_EVENT_HANDLERS, BioluminescenceDirector, EXPLICIT_COMBO_HOLD, resolvePieceColor,
} from '../../src/themes/bioluminescence/bioluminescence-director.js';
import { PLAYER_SLOTS } from '../../src/themes/bioluminescence/bioluminescence-composition.js';
import { BIOLUMINESCENCE_TETROMINOS } from '../../src/themes/bioluminescence/bioluminescence-tetrominos.js';
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
    return { director: new BioluminescenceDirector({ sink, ...options }), calls, sink };
}

describe('bioluminescence director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new BioluminescenceDirector();
        for (const [event, handler] of Object.entries(BIOLUMINESCENCE_EVENT_HANDLERS)) {
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
        expect(calls.lock[0].color).toBe(BIOLUMINESCENCE_TETROMINOS.colors.T);
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
        expect(resolvePieceColor({ color: 'T' })).toBe(BIOLUMINESCENCE_TETROMINOS.colors.T);
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBe(BIOLUMINESCENCE_TETROMINOS.colors.Z);
        // A piece with no colour of its own stays colourless here: the world lights it in its teal.
        expect(resolvePieceColor({ type: 'nope' })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
    });

    it('gives every shape the theme draws a colour a lock can carry', () => {
        for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L']) {
            const { director, calls } = makeDirector();
            director.onPieceLock({ piece: { ...T, type } });
            director.flush();
            expect(calls.lock[0].color, type).toBe(BIOLUMINESCENCE_TETROMINOS.colors[type]);
            expect(calls.lock[0].color, type).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });

    it('keeps the colour a hard drop named when its lock arrives without one', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: { ...I, color: '#abcdef' } });
        director.onPieceLock({ piece: { shape: I.shape, x: I.x, y: I.y } });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0].color).toBe('#abcdef');
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
        // A click has no board: nothing locks.
        expect(calls.lock).toHaveLength(0);
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

    it('works without a sink, and with one that listens to only some of it', () => {
        const bare = new BioluminescenceDirector();
        expect(() => {
            bare.onPieceLock({ piece: T });
            bare.onLineClear({ lineCount: 1, clearedRows: [23] });
            bare.onLevelUp({ level: 2 });
            bare.flush();
            bare.reset();
        }).not.toThrow();
        const clear = vi.fn();
        const partial = new BioluminescenceDirector({ sink: { clear } });
        partial.onPieceLock({ piece: T });
        partial.onLineClear({ lineCount: 1, clearedRows: [23] });
        partial.flush();
        expect(clear).toHaveBeenCalledOnce();
    });
});

describe('bioluminescence director: a combo an event names itself', () => {
    const FRAME = 1 / 60;
    const at = { x: 250, y: 400 };
    /** A meditation click: LINE_CLEAR always, COMBO too from the third click of a chain. */
    function click(director, comboCount) {
        director.onLineClear({
            lineCount: Math.min(4, Math.floor((comboCount + 2) / 2)), comboCount, source: 'serenity-interaction', position: at,
        });
        if (comboCount >= 2) director.onCombo({ comboCount, source: 'serenity-interaction', position: at });
    }
    /** Flush `seconds` of frames with nothing staged. */
    function idle(director, seconds) {
        for (let i = 0; i < Math.round(seconds / FRAME); i++) director.flush(FRAME);
    }

    it('holds a click\'s combo from frame to frame instead of dropping it on the next one', () => {
        const { director, calls } = makeDirector();
        director.setViewport(1000, 500);
        click(director, 3);
        director.flush(FRAME);
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].combo).toBe(3);
        expect(calls.combo).toEqual([[3, 0]]);
        // The frames after it: the chain has not broken, and nothing says it has.
        idle(director, 1);
        expect(calls.combo).toEqual([[3, 0]]);
        expect(calls.clear).toHaveLength(1);
    });

    it('follows a chain of clicks up, and reports its end once, when the mode itself would forget it', () => {
        const { director, calls } = makeDirector();
        director.setViewport(1000, 500);
        for (let n = 0; n <= 5; n++) {
            click(director, n);
            director.flush(FRAME);
            idle(director, 0.4);
        }
        // The first two clicks are a chain of one; then it climbs. Never a zero in between.
        expect(calls.combo).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
        expect(calls.clear.map((c) => c.combo)).toEqual([1, 1, 2, 3, 4, 5]);
        // No click for a while: still held just short of the hold, let go just after it.
        idle(director, EXPLICIT_COMBO_HOLD - 0.4 - 0.1);
        expect(calls.combo).toHaveLength(5);
        idle(director, 0.2);
        expect(calls.combo[5]).toEqual([0, 0]);
        idle(director, 5);
        expect(calls.combo).toHaveLength(6);
        // The next click starts a new chain of one.
        click(director, 0);
        director.flush(FRAME);
        expect(calls.combo[6]).toEqual([1, 0]);
        expect(calls.clear[calls.clear.length - 1].combo).toBe(1);
    });

    it('lets a later, smaller combo replace the one it was holding', () => {
        const { director, calls } = makeDirector();
        click(director, 6);
        director.flush(FRAME);
        // The mode's chain ran out between two clicks: the next one says so itself.
        click(director, 0);
        director.flush(FRAME);
        expect(calls.combo).toEqual([[6, 0], [1, 0]]);
        // Two in one frame: the larger names the frame.
        click(director, 2);
        click(director, 4);
        director.flush(FRAME);
        expect(calls.combo[2]).toEqual([4, 0]);
        expect(calls.clear[2].combo).toBe(4);
    });

    it('holds until something ends it when it is given no clock', () => {
        const { director, calls } = makeDirector();
        click(director, 4);
        director.flush();
        for (let i = 0; i < 500; i++) director.flush();
        director.flush(NaN);
        director.flush(-3);
        expect(calls.combo).toEqual([[4, 0]]);
        director.reset();
        expect(calls.combo).toEqual([[4, 0], [0, 0]]);
        expect(director.slots.every((slot) => slot.held === 0)).toBe(true);
        // Switching reactions off lets go of it too.
        click(director, 3);
        director.flush();
        director.configure({ enabled: false });
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 0]);
        director.configure({ enabled: true });
        director.flush(FRAME);
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 0]);
    });

    it('never counts a click as a lock: when the hold ends the chain is over, not stuck at one', () => {
        const { director, calls } = makeDirector();
        for (let n = 0; n < 4; n++) {
            click(director, n);
            director.flush(FRAME);
        }
        expect(director.slots[0].tracker.combo).toBe(0);
        idle(director, EXPLICIT_COMBO_HOLD + 0.1);
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 0]);
    });

    it('holds Odyssey\'s victory lap until the next piece locks, and leaves the true chain exact', () => {
        const { director, calls } = makeDirector();
        // A lock that clears: the true combo is one.
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush(FRAME);
        expect(calls.combo).toEqual([[1, 0]]);
        // The victory lap, between two locks: COMBO then LINE_CLEAR, both saying ten.
        director.onCombo({ comboCount: 10 });
        director.onLineClear({ lineCount: 4, comboCount: 10 });
        director.flush(FRAME);
        expect(calls.clear[1]).toMatchObject({ lines: 4, combo: 10 });
        expect(calls.combo).toEqual([[1, 0], [10, 0]]);
        idle(director, 0.5);
        expect(calls.combo).toHaveLength(2);
        // The next piece locks and clears: the tracker speaks again, and it counted two locks
        // that cleared, not three.
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush(FRAME);
        expect(calls.clear[2].combo).toBe(2);
        expect(calls.combo[2]).toEqual([2, 0]);
        // Announced in the same tick as the lock that won the level, it is held just the same.
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.onLineClear({ lineCount: 4, comboCount: 10 });
        director.flush(FRAME);
        expect(calls.combo[3]).toEqual([10, 0]);
        expect(director.slots[0].tracker.combo).toBe(3);
        // A lock that clears nothing ends the lap; the true chain breaks one lock later, as ever.
        director.onPieceLock({ piece: T });
        director.flush(FRAME);
        expect(calls.combo[4]).toEqual([3, 0]);
        director.onPieceLock({ piece: T });
        director.flush(FRAME);
        expect(calls.combo[5]).toEqual([0, 0]);
    });

    it('keeps each board\'s held combo to itself', () => {
        const { director, calls } = makeDirector();
        director.onLineClear({
            lineCount: 1, comboCount: 5, position: at, player: 1,
        });
        director.onLineClear({
            lineCount: 1, comboCount: 2, position: at, player: 2,
        });
        director.flush(FRAME);
        expect(calls.combo).toEqual([[5, 1], [2, 2]]);
        // A lock on one board ends that board's hold only.
        director.onPieceLock({ piece: T, player: 2 });
        director.flush(FRAME);
        expect(calls.combo).toEqual([[5, 1], [2, 2], [0, 2]]);
        idle(director, EXPLICIT_COMBO_HOLD + 0.1);
        expect(calls.combo[3]).toEqual([0, 1]);
    });
});

describe('bioluminescence director: settings and resets', () => {
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

    it('cancels a lock already staged when the lock ripple is switched off mid-frame', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.configure({ lockRipple: false });
        director.flush();
        expect(calls.lock).toHaveLength(0);
        expect(calls.clear).toHaveLength(1);
        // Switched back on, the next lock lands.
        director.configure({ lockRipple: true });
        director.onPieceLock({ piece: I });
        director.flush();
        expect(calls.lock).toHaveLength(1);
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

    it('normalises the viewport it is given and falls back to the window for a click', () => {
        const { director, calls } = makeDirector();
        director.setViewport(NaN, -4);
        expect(director.viewportWidth).toBe(0);
        expect(director.viewportHeight).toBe(0);
        vi.stubGlobal('window', { innerWidth: 800, innerHeight: 400 });
        try {
            director.onCombo({ comboCount: 2, position: { x: 2000, y: 100 } });
            director.flush();
        } finally {
            vi.unstubAllGlobals();
        }
        // Off-screen clicks are clamped onto the window.
        expect(calls.clear[0].screen).toEqual({ x: 1, y: 0.25 });
    });
});
