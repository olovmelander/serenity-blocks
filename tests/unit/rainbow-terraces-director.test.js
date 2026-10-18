/**
 * Rainbow Terraces — the gameplay director (ported from Serenity Warp's and Ocean's): what reaches the
 * world from the bus, in what order and how often. Silent locks (the lock ripple off) and the
 * hard drop's distance are this theme's own.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RAINBOW_TERRACES_EVENT_HANDLERS, RainbowTerracesDirector, resolvePieceColor, themePieceColor,
} from '../../src/themes/rainbow-terraces/rainbow-terraces-director.js';
import { PLAYER_SLOTS } from '../../src/themes/rainbow-terraces/rainbow-terraces-composition.js';
import { RAINBOW_TERRACES_TETROMINOS } from '../../src/themes/rainbow-terraces/rainbow-terraces-tetrominos.js';
import { cellsFromMatrix } from '../../src/themes/rainbow-terraces/rainbow-terraces-core.js';
import { EVENTS } from '../../src/events/event-bus.js';

const themesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'themes');
const themeDir = path.join(themesDir, 'rainbow-terraces');

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};
const SHAPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
/** The table's colour for a shape, in whichever of the two shapes the table is written. */
const tableColor = (key) => RAINBOW_TERRACES_TETROMINOS.colors?.[key] ?? RAINBOW_TERRACES_TETROMINOS[key]?.color;

function makeDirector(options = {}) {
    const calls = {
        lock: [], clear: [], combo: [], levelUp: [], order: [],
    };
    const sink = {
        // The director reuses its context objects: a sink must copy what it keeps.
        lock: vi.fn((c) => {
            calls.order.push('lock');
            calls.lock.push({ ...c, rows: [...c.rows], cells: c.cells ? [...c.cells] : null });
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
    return { director: new RainbowTerracesDirector({ sink, ...options }), calls, sink };
}

describe('rainbow terraces director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new RainbowTerracesDirector();
        expect(Object.keys(RAINBOW_TERRACES_EVENT_HANDLERS).sort()).toEqual([
            'B2B', 'COMBO', 'HARD_DROP', 'LEVEL_UP', 'LINE_CLEAR', 'PERFECT_CLEAR', 'PIECE_LOCK', 'TSPIN',
        ]);
        expect(Object.isFrozen(RAINBOW_TERRACES_EVENT_HANDLERS)).toBe(true);
        for (const [event, handler] of Object.entries(RAINBOW_TERRACES_EVENT_HANDLERS)) {
            expect(EVENTS[event], event).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
    });

    it('stays renderer-free: it imports the composition, the colours, the core and two shared game modules', () => {
        const imports = (name) => [...readFileSync(path.join(themeDir, name), 'utf8')
            .matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort();
        expect(imports('rainbow-terraces-director.js')).toEqual([
            '../../core/combo-tracker.js',
            '../../events/lock-origin.js',
            './rainbow-terraces-composition.js',
            './rainbow-terraces-core.js',
            './rainbow-terraces-tetrominos.js',
        ]);
        expect(imports('rainbow-terraces-composition.js')).toEqual([]);
        expect(imports('rainbow-terraces-tetrominos.js')).toEqual([]);
    });

    it('stages a lock and resolves it once, on flush, with its rows, column, colour and shape', () => {
        const { director, calls, sink } = makeDirector();
        director.onPieceLock({ piece: T });
        expect(sink.lock).not.toHaveBeenCalled();
        director.flush();
        expect(calls.lock).toHaveLength(1);
        // Rows are visible rows: the matrix carries four hidden ones.
        expect(calls.lock[0].rows).toEqual([18, 19]);
        // The column is the centroid of the OCCUPIED cells, as a fraction of the ten columns.
        expect(calls.lock[0].u).toBeCloseTo((3 + 1.5) / 10, 6);
        expect(calls.lock[0]).toMatchObject({
            player: 0,
            color: tableColor('T'),
            shape: 'T',
            cells: cellsFromMatrix(T.shape),
            hardDrop: false,
            dropRows: 0,
            silent: false,
            screen: null,
        });
        director.flush();
        expect(calls.lock).toHaveLength(1);
    });

    it('hands over the piece\'s cells in the orientation it locked in, centred, y up', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onPieceLock({ piece: { ...I, shape: [[1], [1], [1], [1]], player: 1 }, player: 1 });
        director.flush();
        const [flat, upright] = calls.lock;
        expect(flat.cells).toEqual([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]);
        expect(upright.cells).toEqual([0, 1.5, 0, 0.5, 0, -0.5, 0, -1.5]);
        // A piece with no matrix to read has no cells, and a key too long to be a shape is none.
        director.onPieceLock({ piece: { type: 'Tetromino-T', color: '#123456' }, viewportOrigin: { x: 0.5, y: 0.5 } });
        director.flush();
        expect(calls.lock[2]).toMatchObject({
            cells: null, shape: null, color: '#123456', rows: [10],
        });
    });

    it('folds a hard drop and its lock into one harder lock that knows how far it fell', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: I, distance: 14 });
        director.onPieceLock({ piece: I });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0]).toMatchObject({ hardDrop: true, dropRows: 14, rows: [19] });
        // A drop with no distance on it fell no measured way; nonsense is none; and the next lock
        // without a drop carries none over.
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: I });
        director.flush();
        director.onHardDrop({ piece: I, distance: -3 });
        director.onPieceLock({ piece: I });
        director.flush();
        director.onHardDrop({ piece: I, distance: 'far' });
        director.onPieceLock({ piece: I });
        director.flush();
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.lock.map((c) => [c.hardDrop, c.dropRows])).toEqual([
            [true, 14], [true, 0], [true, 0], [true, 0], [false, 0],
        ]);
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
        const byShape = {
            T: { color: '#102030', borderColor: '#000000' },
            ghost: { color: 'rgba(255, 255, 255, 0.15)' },
        };
        const byMap = { version: 1, colors: { T: '#405060', GARBAGE: '#111111' } };
        expect(themePieceColor('T', byShape)).toBe('#102030');
        expect(themePieceColor('T', byMap)).toBe('#405060');
        expect(themePieceColor('GARBAGE', byMap)).toBe('#111111');
        // Only a hex is a colour a pool can hold.
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

    it('pours every shape into its pool in its own colour', () => {
        const { director, calls } = makeDirector();
        SHAPES.forEach((type) => {
            director.onPieceLock({ piece: { ...T, type } });
            director.flush();
        });
        expect(calls.lock.map((c) => c.color)).toEqual(SHAPES.map(tableColor));
        expect(new Set(calls.lock.map((c) => c.color)).size).toBe(SHAPES.length);
        expect(calls.lock.map((c) => c.shape)).toEqual(SHAPES);
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

    it('places a scrolling board\'s clear from its on-screen origin', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: { ...I, y: 512 }, viewportOrigin: { x: 0.5, y: 0.5 } });
        director.onLineClear({
            lineCount: 2, clearedRows: [512, 513], cascadeCount: 1, viewportOrigin: { x: 0.5, y: 0.5 },
        });
        director.flush();
        // Two rows about the origin's row, never the absolute rows of a board hundreds tall.
        expect(calls.clear[0].rows).toEqual([10, 11]);
        expect(calls.clear[0].lines).toBe(2);
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

    it('reports a chain that broke and began again within one lock: the bow withdraws, then is painted anew', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(calls.combo).toEqual([[1, 0]]);
        // A piece that clears nothing...
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.combo).toEqual([[1, 0]]);
        // ...then one that clears: the tracker went 1 -> 0 -> 1 inside this one lock.
        calls.order.length = 0;
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(calls.combo).toEqual([[1, 0], [0, 0], [1, 0]]);
        expect(calls.order).toEqual(['combo', 'lock', 'clear', 'combo']);
        expect(calls.clear[1].combo).toBe(1);
    });

    it('carries T-spins, perfect clears and back-to-backs on the clear, and only on that clear', () => {
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
        // And none of the three outlives the clear it rode on.
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

    it('reports a click\'s combo for the frame its clear resolves in, then the tracker\'s own again', () => {
        const { director, calls } = makeDirector();
        director.setViewport(1000, 500);
        director.onLineClear({ lineCount: 2, comboCount: 4, position: { x: 500, y: 250 } });
        director.onCombo({ comboCount: 4, position: { x: 500, y: 250 } });
        director.flush();
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0]).toMatchObject({ lines: 2, combo: 4, screen: { x: 0.5, y: 0.5 } });
        expect(calls.combo).toEqual([[4, 0]]);
        director.flush();
        expect(calls.combo).toEqual([[4, 0], [1, 0]]);
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

    it('delivers a staged event once, even to a sink that throws on it', () => {
        const { director, calls, sink } = makeDirector();
        sink.lock.mockImplementationOnce(() => { throw new Error('the world choked'); });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.onPieceLock({ piece: T, player: 2 });
        expect(() => director.flush()).toThrow(/the world choked/);
        expect(sink.lock).toHaveBeenCalledTimes(1);
        // The frame after: the lock that threw is gone with its clear; it is not tried again. The
        // other board's lock, which that frame never reached, lands now, and so does the combo.
        expect(() => director.flush()).not.toThrow();
        expect(sink.lock).toHaveBeenCalledTimes(2);
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0].player).toBe(2);
        expect(calls.clear).toHaveLength(0);
        expect(calls.combo).toEqual([[1, 0]]);
        director.flush();
        expect(sink.lock).toHaveBeenCalledTimes(2);
    });

    it('delivers a clear once, even to a sink that throws on it', () => {
        const { director, sink } = makeDirector();
        sink.clear.mockImplementationOnce(() => { throw new Error('the world choked'); });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        expect(() => director.flush()).toThrow(/the world choked/);
        // Its lock had landed before the clear threw; neither comes back.
        expect(sink.lock).toHaveBeenCalledTimes(1);
        expect(sink.clear).toHaveBeenCalledTimes(1);
        expect(() => director.flush()).not.toThrow();
        expect(sink.lock).toHaveBeenCalledTimes(1);
        expect(sink.clear).toHaveBeenCalledTimes(1);
    });

    it('announces a level once, even to a sink that throws on it', () => {
        const { director, sink } = makeDirector();
        sink.levelUp.mockImplementationOnce(() => { throw new Error('the world choked'); });
        director.onLevelUp({ level: 2 });
        expect(() => director.flush()).toThrow(/the world choked/);
        expect(() => director.flush()).not.toThrow();
        expect(sink.levelUp).toHaveBeenCalledTimes(1);
    });

    it('works without a sink, or with one that takes only some of the calls', () => {
        const bare = new RainbowTerracesDirector();
        const partial = new RainbowTerracesDirector({ sink: { clear: vi.fn() } });
        for (const director of [bare, partial]) {
            expect(() => {
                director.onHardDrop({ piece: I, distance: 12 });
                director.onPieceLock({ piece: I });
                director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20] });
                director.onLevelUp({ level: 2 });
                director.flush();
                director.reset();
            }).not.toThrow();
        }
        expect(partial.sink.clear).toHaveBeenCalledOnce();
    });
});

describe('rainbow terraces director: silent locks', () => {
    it('still delivers every lock while the lock ripple is off, silent, with no drop', () => {
        const { director, calls } = makeDirector({ lockRipple: false });
        director.onHardDrop({ piece: I, distance: 14 });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22] });
        director.flush();
        // The pool still takes the colour (so a clear always has colour to release); the world is
        // told to skip the copy, the thread, the splash and the camera dip.
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0]).toMatchObject({
            silent: true,
            hardDrop: false,
            dropRows: 0,
            rows: [19],
            u: 0.8,
            color: tableColor('I'),
            shape: 'I',
            cells: [-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0],
        });
        expect(calls.clear).toHaveLength(1);
        expect(calls.order).toEqual(['lock', 'clear', 'combo']);
    });

    it('leaves the chain\'s bookkeeping as it is: silent locks count and break chains alike', () => {
        const loud = makeDirector();
        const silent = makeDirector({ lockRipple: false });
        for (const { director } of [loud, silent]) {
            for (let i = 0; i < 3; i++) {
                director.onPieceLock({ piece: I });
                director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
                director.flush();
            }
            director.onPieceLock({ piece: T });
            director.flush();
            director.onPieceLock({ piece: T });
            director.flush();
        }
        expect(silent.calls.combo).toEqual(loud.calls.combo);
        expect(silent.calls.combo).toEqual([[1, 0], [2, 0], [3, 0], [0, 0]]);
        expect(silent.calls.clear.map((c) => c.combo)).toEqual([1, 2, 3]);
        expect(silent.calls.lock).toHaveLength(5);
        expect(silent.calls.lock.every((c) => c.silent && !c.hardDrop)).toBe(true);
        expect(loud.calls.lock.every((c) => !c.silent)).toBe(true);
    });

    it('lands a lock staged before the ripple was switched off silently, never cancelling it', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: I, distance: 9 });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.configure({ lockRipple: false });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0]).toMatchObject({ silent: true, hardDrop: false, dropRows: 0 });
        expect(calls.clear).toHaveLength(1);
        // Switched back on, the next lock lands with its show again.
        director.configure({ lockRipple: true });
        director.onHardDrop({ piece: T, distance: 9 });
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.lock[1]).toMatchObject({ silent: false, hardDrop: true, dropRows: 9 });
    });
});

describe('rainbow terraces director: settings and resets', () => {
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

    it('takes no gameplay at all while reactions are off, whatever the event', () => {
        const { director, calls } = makeDirector({ enabled: false });
        expect(director.onHardDrop({ piece: I })).toBe(false);
        expect(director.onPieceLock({ piece: I })).toBe(false);
        expect(director.onLineClear({ lineCount: 2, clearedRows: [23, 22] })).toBe(false);
        expect(director.onCombo({ comboCount: 3, position: { x: 10, y: 10 } })).toBe(false);
        expect(director.onTSpin({ lineCount: 2 })).toBe(false);
        expect(director.onB2B({ active: true })).toBe(false);
        expect(director.onPerfectClear({ depth: 1 })).toBe(false);
        director.flush();
        expect(calls.lock).toEqual([]);
        expect(calls.clear).toEqual([]);
        expect(calls.combo).toEqual([]);
        expect(calls.levelUp).toEqual([]);
        expect(director.slots.every((slot) => !slot.assigned)).toBe(true);
    });

    it('reports a level once, whatever the reactions setting', () => {
        const { director, calls } = makeDirector({ enabled: false });
        director.onLevelUp({ level: 4 });
        director.flush();
        director.flush();
        expect(calls.levelUp).toEqual([4]);
        // A payload without a level counts on from the last one.
        director.onLevelUp({});
        director.flush();
        expect(calls.levelUp).toEqual([4, 5]);
    });

    it('starts a new run with every slot free', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I, player: 3 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 3 });
        director.flush();
        director.onLevelUp({ level: 7 });
        director.reset();
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 3]);
        expect(director.slots.every((slot) => !slot.assigned && slot.tracker.combo === 0 && !slot.broke)).toBe(true);
        // A level staged for the run that ended is not announced to the next one.
        director.flush();
        expect(calls.levelUp).toEqual([]);
    });

    it('normalises a click against the size it was given, else the window\'s', () => {
        const { director, calls } = makeDirector();
        director.setViewport(NaN, -4);
        expect(director.viewportWidth).toBe(0);
        expect(director.viewportHeight).toBe(0);
        vi.stubGlobal('window', { innerWidth: 800, innerHeight: 400 });
        try {
            director.onCombo({ comboCount: 2, position: { x: 2000, y: -50 } });
            director.flush();
        } finally {
            vi.unstubAllGlobals();
        }
        // Clamped onto the window.
        expect(calls.clear[0].screen).toEqual({ x: 1, y: 0 });
    });
});
