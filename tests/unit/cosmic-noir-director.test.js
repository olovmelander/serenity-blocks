import {
    describe, expect, it, vi,
} from 'vitest';
import {
    COSMIC_NOIR_EVENT_HANDLERS, CosmicNoirDirector, resolvePieceColor, themePieceColor,
} from '../../src/themes/cosmic-noir/cosmic-noir-director.js';
import { PLAYER_SLOTS } from '../../src/themes/cosmic-noir/cosmic-noir-composition.js';
import { COSMIC_NOIR_TETROMINOS } from '../../src/themes/cosmic-noir/cosmic-noir-tetrominos.js';
import { EVENTS } from '../../src/events/event-bus.js';

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};
const SHAPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
/** The table's colour for a shape, in whichever of the two shapes the table is written. */
const tableColor = (key) => COSMIC_NOIR_TETROMINOS.colors?.[key] ?? COSMIC_NOIR_TETROMINOS[key]?.color;

function makeDirector(options = {}) {
    const calls = {
        lock: [], clear: [], combo: [], levelUp: [], order: [],
    };
    const sink = {
        // The director reuses its context objects: a sink must copy what it keeps.
        lock: vi.fn((c) => {
            calls.order.push('lock');
            calls.lock.push({ ...c, rows: [...c.rows] });
        }),
        clear: vi.fn((c) => {
            calls.order.push('clear');
            calls.clear.push({ ...c, rows: [...c.rows], screen: c.screen ? { ...c.screen } : null });
        }),
        combo: vi.fn((n, player) => {
            calls.order.push('combo');
            calls.combo.push([n, player]);
        }),
        levelUp: vi.fn((level) => {
            calls.order.push('levelUp');
            calls.levelUp.push(level);
        }),
    };
    return { director: new CosmicNoirDirector({ sink, ...options }), calls, sink };
}

describe('cosmic noir director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new CosmicNoirDirector();
        for (const [event, handler] of Object.entries(COSMIC_NOIR_EVENT_HANDLERS)) {
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
        expect(calls.lock[0].color).toBe(tableColor('T'));
        expect(calls.lock[0].hardDrop).toBe(false);
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
        expect(resolvePieceColor({ color: 'T' })).toBe(tableColor('T'));
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBe(tableColor('Z'));
        expect(resolvePieceColor({ type: 'nope' })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
        // Entries of the table that are no piece are never a piece's colour.
        for (const key of ['ghost', 'grid', 'locked', 'colors', 'effects', 'version', 'constructor', 'toString']) {
            expect(resolvePieceColor({ type: key }), key).toBeNull();
        }
    });

    it('reads the theme\'s table in either shape a tetromino config comes in', () => {
        const byShape = { T: { color: '#102030', borderColor: '#000000' }, ghost: { color: 'rgba(255, 255, 255, 0.15)' } };
        const byMap = { version: 1, colors: { T: '#405060', GARBAGE: '#111111' } };
        expect(themePieceColor('T', byShape)).toBe('#102030');
        expect(themePieceColor('T', byMap)).toBe('#405060');
        expect(themePieceColor('GARBAGE', byMap)).toBe('#111111');
        // Only a hex is a colour the world can use.
        expect(themePieceColor('ghost', byShape)).toBeNull();
        expect(themePieceColor('Z', byShape)).toBeNull();
        expect(themePieceColor('colors', byMap)).toBeNull();
        expect(themePieceColor(undefined, byMap)).toBeNull();
        expect(themePieceColor('T', null)).toBeNull();
        // The shipped table names a hex for every one of the seven shapes.
        for (const shape of SHAPES) {
            expect(themePieceColor(shape), shape).toMatch(/^#[0-9a-f]{6}$/i);
            expect(themePieceColor(shape), shape).toBe(tableColor(shape));
        }
    });

    it('hands every shape its own grey', () => {
        const { director, calls } = makeDirector();
        SHAPES.forEach((type) => {
            director.onPieceLock({ piece: { ...T, type } });
            director.flush();
        });
        expect(calls.lock.map((c) => c.color)).toEqual(SHAPES.map(tableColor));
        expect(new Set(calls.lock.map((c) => c.color)).size).toBe(SHAPES.length);
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

    it('hands the sink a slot\'s lock, then its clear, then the combo that clear raised', () => {
        const { director, calls } = makeDirector();
        director.onLevelUp({ level: 2 });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(calls.order).toEqual(['levelUp', 'lock', 'clear', 'combo']);
        // The clear already carries the chain it belongs to: the sink need not wait for combo().
        expect(calls.clear[0].combo).toBe(1);
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[1].combo).toBe(2);
        expect(calls.order.slice(4)).toEqual(['lock', 'clear', 'combo']);
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
        for (let player = 0; player < PLAYER_SLOTS; player++) {
            expect(director.onPieceLock({ piece: T, player })).toBe(true);
        }
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

    it('works without a sink, and with one that listens to only some of it', () => {
        const bare = new CosmicNoirDirector();
        expect(() => {
            bare.onPieceLock({ piece: I });
            bare.onLineClear({ lineCount: 1, clearedRows: [23] });
            bare.onLevelUp({ level: 2 });
            bare.flush();
            bare.reset();
        }).not.toThrow();
        const clear = vi.fn();
        const partial = new CosmicNoirDirector({ sink: { clear } });
        partial.onPieceLock({ piece: I });
        partial.onLineClear({ lineCount: 1, clearedRows: [23] });
        expect(() => partial.flush()).not.toThrow();
        expect(clear).toHaveBeenCalledOnce();
    });
});

describe('cosmic noir director: settings and resets', () => {
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

    it('cancels a lock already staged when the lock ripple is switched off before the frame', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: I });
        director.configure({ lockRipple: false });
        director.flush();
        expect(calls.lock).toHaveLength(0);
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
});
