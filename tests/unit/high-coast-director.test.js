import {
    describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    HIGH_COAST_EVENT_HANDLERS, HighCoastDirector, resolvePieceColor, themePieceColor,
} from '../../src/themes/high-coast/high-coast-director.js';
import { PLAYER_SLOTS } from '../../src/themes/high-coast/high-coast-composition.js';
import { HIGH_COAST_TETROMINOS } from '../../src/themes/high-coast/high-coast-tetrominos.js';
import { PIECE_CODE, cellsFromMatrix } from '../../src/themes/high-coast/high-coast-core.js';
import { EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'high-coast',
);

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};
const SHAPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
/** A locked piece: its key, the matrix's top-left cell (absolute board rows) and the matrix. */
const piece = (type, x, y, shape) => ({
    shape, x, y, type,
});
const tableColor = (key) => HIGH_COAST_TETROMINOS.colors[key];
/** Ten copies of one code: a row the well knows nothing of. */
const row = (code) => new Array(10).fill(code);
const {
    I: CI, T: CT, Z: CZ, L: CL, S: CS, O: CO, GARBAGE: CG,
} = PIECE_CODE;

function makeDirector(options = {}) {
    const calls = {
        lock: [], clear: [], spin: [], combo: [], b2b: [], levelUp: [], order: [],
    };
    const sink = {
        // The director reuses its context objects: a sink must copy what it keeps.
        lock: vi.fn((c) => {
            calls.order.push('lock');
            calls.lock.push({ ...c, rows: [...c.rows], cells: c.cells ? [...c.cells] : null });
        }),
        clear: vi.fn((c) => {
            calls.order.push('clear');
            calls.clear.push({
                ...c, rows: [...c.rows], rowCodes: [...c.rowCodes], screen: c.screen ? { ...c.screen } : null,
            });
        }),
        spin: vi.fn((c) => {
            calls.order.push('spin');
            calls.spin.push({ ...c });
        }),
        combo: vi.fn((n, player) => {
            calls.order.push('combo');
            calls.combo.push([n, player]);
        }),
        b2b: vi.fn((level, player) => {
            calls.order.push('b2b');
            calls.b2b.push([level, player]);
        }),
        levelUp: vi.fn((level) => {
            calls.order.push('levelUp');
            calls.levelUp.push(level);
        }),
    };
    return { director: new HighCoastDirector({ sink, ...options }), calls, sink };
}

/** One frame: a piece locks and its first wave clears `rows` in the same tick. */
function clearingLock(director, locked, rows, extra = {}) {
    director.onPieceLock({ piece: locked, ...extra });
    director.onLineClear({
        lineCount: rows.length, clearedRows: rows, cascadeCount: 1, ...extra,
    });
}

describe('high-coast director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new HighCoastDirector();
        expect(Object.keys(HIGH_COAST_EVENT_HANDLERS).sort()).toEqual([
            'B2B', 'COMBO', 'HARD_DROP', 'LEVEL_UP', 'LINE_CLEAR', 'PERFECT_CLEAR', 'PIECE_LOCK', 'TSPIN',
        ]);
        for (const [event, handler] of Object.entries(HIGH_COAST_EVENT_HANDLERS)) {
            expect(EVENTS[event], event).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
    });

    it('stays renderer-free: it imports its own modules and two shared game modules', () => {
        const imports = (name) => [...readFileSync(path.join(themeDir, name), 'utf8')
            .matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort();
        expect(imports('high-coast-director.js')).toEqual([
            '../../core/combo-tracker.js',
            '../../events/lock-origin.js',
            './high-coast-composition.js',
            './high-coast-core.js',
            './high-coast-tetrominos.js',
        ]);
        expect(imports('high-coast-tetrominos.js')).toEqual([]);
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
        expect(calls.lock[0].color).toBe(tableColor('T'));
        expect(calls.lock[0].shape).toBe('T');
        expect(calls.lock[0].cells).toEqual(cellsFromMatrix(T.shape));
        expect(calls.lock[0]).toMatchObject({
            hardDrop: false, distance: 0, player: 0, screen: null,
        });
        director.flush();
        expect(calls.lock).toHaveLength(1);
    });

    it('folds a hard drop and its lock into one harder lock that knows how far it fell', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({
            piece: I, startY: 4, endY: 23, distance: 19,
        });
        director.onPieceLock({ piece: I });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0]).toMatchObject({ hardDrop: true, distance: 19, rows: [19] });
        // A payload without a distance: the rows between start and end.
        director.onHardDrop({ piece: I, startY: 9, endY: 23 });
        director.onPieceLock({ piece: I });
        director.flush();
        expect(calls.lock[1]).toMatchObject({ hardDrop: true, distance: 14 });
        // Nothing usable, or nonsense: no distance at all.
        director.onHardDrop({ piece: I, distance: -3 });
        director.onPieceLock({ piece: I });
        director.flush();
        expect(calls.lock[2]).toMatchObject({ hardDrop: true, distance: 0 });
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: I });
        director.flush();
        expect(calls.lock[3].distance).toBe(0);
        // A piece that settled on its own was never dropped: the distance does not carry over.
        director.onPieceLock({ piece: I });
        director.flush();
        expect(calls.lock[4]).toMatchObject({ hardDrop: false, distance: 0 });
    });

    it('prefers the piece\'s own hex colour and falls back to the theme\'s colour for its shape', () => {
        expect(resolvePieceColor({ color: '#12abEF', type: 'T' })).toBe('#12abEF');
        expect(resolvePieceColor({ color: 'T' })).toBe(tableColor('T'));
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBe(tableColor('Z'));
        expect(resolvePieceColor({ type: 'nope' })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
        // Entries of the table that are no piece are never a piece's colour.
        for (const key of ['colors', 'effects', 'version', 'renderMode', 'constructor', 'toString']) {
            expect(resolvePieceColor({ type: key }), key).toBeNull();
        }
    });

    it('reads the theme\'s table in either shape a tetromino config comes in', () => {
        const byShape = {
            T: { color: '#102030', borderColor: '#000000' }, ghost: { color: 'rgba(255, 255, 255, 0.15)' },
        };
        const byMap = { version: 1, colors: { T: '#405060', GARBAGE: '#111111' } };
        expect(themePieceColor('T', byShape)).toBe('#102030');
        expect(themePieceColor('T', byMap)).toBe('#405060');
        expect(themePieceColor('GARBAGE', byMap)).toBe('#111111');
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

    it('sets every shape\'s spinnaker in its own colour', () => {
        const { director, calls } = makeDirector();
        SHAPES.forEach((type) => {
            director.onPieceLock({ piece: { ...T, type } });
            director.flush();
        });
        expect(calls.lock.map((c) => c.color)).toEqual(SHAPES.map(tableColor));
        expect(calls.lock.map((c) => c.shape)).toEqual(SHAPES);
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

    it('names a clear\'s rows lowest first, whatever order the payload lists them in', () => {
        const { director, calls } = makeDirector();
        director.onLineClear({ lineCount: 3, clearedRows: [20, 23, 21], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[0].rows).toEqual([19, 17, 16]);
        expect(calls.clear[0].rowCodes).toHaveLength(30);
    });

    it('places a scrolling board\'s clear from its on-screen origin', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: { ...I, y: 512 }, viewportOrigin: { x: 0.5, y: 0.5 } });
        director.onLineClear({
            lineCount: 2, clearedRows: [512, 513], cascadeCount: 1, viewportOrigin: { x: 0.5, y: 0.5 },
        });
        director.flush();
        // Two rows about the origin's row, lowest first, never the absolute rows of a board
        // hundreds tall.
        expect(calls.clear[0].rows).toEqual([11, 10]);
        expect(calls.clear[0].lines).toBe(2);
    });

    it('hands the sink a slot\'s lock, then its clear, then the combo that clear raised', () => {
        const { director, calls } = makeDirector();
        director.onLevelUp({ level: 2 });
        clearingLock(director, I, [23]);
        director.flush();
        expect(calls.order).toEqual(['levelUp', 'lock', 'clear', 'combo']);
        // The clear already carries the chain it belongs to: the sink need not wait for combo().
        expect(calls.clear[0].combo).toBe(1);
        clearingLock(director, I, [23]);
        director.flush();
        expect(calls.clear[1].combo).toBe(2);
        expect(calls.order.slice(4)).toEqual(['lock', 'clear', 'combo']);
    });

    it('carries T-spins, perfect clears and back-to-backs on the clear', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        director.onTSpin({ lineCount: 2 });
        director.onB2B({ active: true });
        director.onPerfectClear({ depth: 2 });
        director.flush();
        expect(calls.clear[0]).toMatchObject({
            lines: 2, tspin: true, b2b: true, perfect: true,
        });
        // An inactive B2B is not one.
        expect(director.onB2B({ active: false })).toBe(false);
        // And none of the three outlives the clear it rode on.
        clearingLock(director, I, [23]);
        director.flush();
        expect(calls.clear[1]).toMatchObject({
            lines: 1, tspin: false, b2b: false, perfect: false,
        });
    });

    it('answers a T-spin that cleared nothing with a spin of its own, never a clear', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: T });
        director.onTSpin({ lineCount: 0 });
        director.flush();
        expect(calls.clear).toEqual([]);
        expect(calls.spin).toEqual([{ player: 0, screen: null }]);
        expect(calls.order).toEqual(['lock', 'spin']);
        // A T-spin that clears rides on its clear, with no spin besides.
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.onTSpin({ lineCount: 1 });
        director.flush();
        expect(calls.spin).toHaveLength(1);
        expect(calls.clear[0]).toMatchObject({ lines: 1, tspin: true });
    });

    it('resolves a perfect clear on its own frame as a clear with no rows', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        director.flush();
        // The game says so once the last wave has settled, a frame or more later.
        director.onPerfectClear({ depth: 4, perfectClearBonus: 800 });
        director.flush();
        expect(calls.clear).toHaveLength(2);
        expect(calls.clear[1]).toMatchObject({
            lines: 1, rows: [], rowCodes: [], perfect: true, screen: null,
        });
        // Its frame has no lock in it: the chain stands.
        expect(calls.combo).toEqual([[1, 0]]);
    });

    it('turns a meditation click into a clear at a screen position', () => {
        const { director, calls } = makeDirector();
        director.setViewport(1000, 500);
        director.onCombo({ comboCount: 4, position: { x: 250, y: 400 } });
        director.flush();
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].combo).toBe(4);
        expect(calls.clear[0].screen).toEqual({ x: 0.25, y: 0.8 });
        expect(calls.clear[0].rows).toEqual([]);
    });

    it('reports a click\'s combo for the frame its clear resolves in, then the tracker\'s own again', () => {
        const { director, calls } = makeDirector();
        director.setViewport(1000, 500);
        // The meditation mode emits LINE_CLEAR and COMBO per click and never a PIECE_LOCK, so the
        // tracker counts one chain of one however long the clicks go on.
        director.onLineClear({ lineCount: 2, comboCount: 4, position: { x: 500, y: 250 } });
        director.onCombo({ comboCount: 4, position: { x: 500, y: 250 } });
        director.flush();
        expect(calls.clear).toHaveLength(1);
        // A click has a point on the screen, not rows on a board.
        expect(calls.clear[0]).toMatchObject({
            lines: 2, combo: 4, cascade: 1, rows: [], rowCodes: [], screen: { x: 0.5, y: 0.5 },
        });
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
            director.onCombo({ comboCount: 'many' });
            director.onLevelUp({});
            director.flush();
        }).not.toThrow();
        expect(calls.lock).toHaveLength(0);
        // A clear whose rows are unusable still counts the lines the payload named, and sheds
        // them along the floor like a clear that names none.
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].lines).toBe(2);
        expect(calls.clear[0].rows).toEqual([19, 18]);
        expect(calls.clear[0].rowCodes).toEqual([...row(CG), ...row(CG)]);
        expect(calls.levelUp).toEqual([1]);
    });

    it('delivers a staged event once, even to a sink that throws on it', () => {
        const { director, calls, sink } = makeDirector();
        sink.lock.mockImplementationOnce(() => { throw new Error('the world choked'); });
        clearingLock(director, I, [23]);
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
        clearingLock(director, I, [23, 22, 21, 20]);
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
        const bare = new HighCoastDirector();
        const partial = new HighCoastDirector({ sink: { clear: vi.fn() } });
        for (const director of [bare, partial]) {
            expect(() => {
                director.onHardDrop({ piece: I });
                director.onPieceLock({ piece: I });
                director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20] });
                director.onB2B({ active: true });
                director.onLevelUp({ level: 2 });
                director.flush();
                director.onPieceLock({ piece: T });
                director.flush();
                director.reset();
            }).not.toThrow();
        }
        expect(partial.sink.clear).toHaveBeenCalledOnce();
    });
});

describe('high-coast director: the shadow well', () => {
    it('says what a cleared row was made of, cell by cell, left to right', () => {
        const { director, calls } = makeDirector();
        // Four pieces fill the floor row (board row 23, the 20th visible one).
        const pieces = [
            piece('I', 0, 23, [[1, 1, 1, 1]]), // cols 0-3
            piece('O', 4, 22, [[1, 1], [1, 1]]), // cols 4-5, and row 22
            piece('L', 6, 22, [[0, 0, 1], [1, 1, 1]]), // cols 6-8, and col 8 of row 22
        ];
        pieces.forEach((locked) => {
            director.onPieceLock({ piece: locked });
            director.flush();
        });
        // The last one, an upright I down column 9, completes the row in its own tick.
        clearingLock(director, piece('I', 9, 20, [[1], [1], [1], [1]]), [23]);
        director.flush();
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].rows).toEqual([19]);
        expect(calls.clear[0].rowCodes).toEqual([CI, CI, CI, CI, CO, CO, CL, CL, CL, CI]);
    });

    it('drops the rows above a clear into its place, and forgets the row it cleared', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: piece('I', 0, 23, [[1, 1, 1, 1]]) });
        director.onPieceLock({ piece: piece('O', 4, 22, [[1, 1], [1, 1]]) });
        director.onPieceLock({ piece: piece('L', 6, 22, [[0, 0, 1], [1, 1, 1]]) });
        clearingLock(director, piece('I', 9, 20, [[1], [1], [1], [1]]), [23]);
        director.flush();
        // Row 22 now lies on the floor: the O's top, the L's corner and the upright I.
        director.onPieceLock({ piece: piece('I', 0, 23, [[1, 1, 1, 1]]) });
        clearingLock(director, piece('Z', 5, 22, [[1, 1, 0], [0, 1, 1]]), [23]);
        director.flush();
        expect(calls.clear[1].rowCodes).toEqual([CI, CI, CI, CI, CO, CO, CZ, CZ, CL, CI]);
        // And now the Z's top half and the I's next cell, with nothing known in between: cells
        // the well never saw filled are garbage.
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[2].rowCodes).toEqual([CG, CG, CG, CG, CG, CZ, CZ, CG, CG, CI]);
    });

    it('lists several cleared rows lowest first, each row\'s codes in step with its row', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: piece('S', 0, 22, [[0, 1, 1], [1, 1, 0]]) });
        director.onPieceLock({ piece: piece('T', 3, 22, [[1, 1, 1], [0, 1, 0]]) });
        // The payload lists the rows top first; the clear names the floor row first.
        director.onLineClear({ lineCount: 2, clearedRows: [22, 23], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[0].rows).toEqual([19, 18]);
        expect(calls.clear[0].rowCodes).toEqual([
            CS, CS, CG, CG, CT, CG, CG, CG, CG, CG, // board row 23
            CG, CS, CS, CT, CT, CT, CG, CG, CG, CG, // board row 22
        ]);
    });

    it('calls every cell of a row it never saw garbage while no piece has locked', () => {
        const { director, calls } = makeDirector();
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[0].rowCodes).toEqual(row(CG));
    });

    it('deals a row it knows nothing of from the last pieces that locked', () => {
        const { director, calls } = makeDirector();
        ['I', 'T', 'Z', 'L', 'S'].forEach((type, i) => {
            director.onPieceLock({ piece: piece(type, i, 4, [[1]]) });
            director.flush();
        });
        // A row no lock touched: the latest pieces in runs, newest first.
        director.onLineClear({ lineCount: 1, clearedRows: [12], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[0].rows).toEqual([8]);
        expect(calls.clear[0].rowCodes).toEqual([CS, CS, CS, CL, CL, CZ, CZ, CZ, CT, CT]);
    });

    it('places a synthetic clear that names no rows along the floor, in the latest pieces\' colours', () => {
        const { director, calls } = makeDirector();
        ['I', 'T', 'Z', 'L', 'S'].forEach((type, i) => {
            director.onPieceLock({ piece: piece(type, i, 4, [[1]]) });
            director.flush();
        });
        // Odyssey's goal flourish: a four-line clear with no rows, then a COMBO naming its combo.
        director.onLineClear({
            lineCount: 4, clearedRows: [], comboCount: 6, source: 'odyssey-goal', levelId: 3,
        });
        director.onCombo({ comboCount: 6, source: 'odyssey-goal', levelId: 3 });
        director.flush();
        expect(calls.clear[0]).toMatchObject({
            lines: 4, rows: [19, 18, 17, 16], combo: 6, cascade: 1,
        });
        // Each row lower down starts one piece further back.
        expect(calls.clear[0].rowCodes).toEqual([
            CS, CS, CS, CL, CL, CZ, CZ, CZ, CT, CT,
            CL, CL, CL, CZ, CZ, CT, CT, CT, CI, CI,
            CZ, CZ, CZ, CT, CT, CI, CI, CI, CS, CS,
            CT, CT, CT, CI, CI, CS, CS, CS, CL, CL,
        ]);
    });

    it('places Odyssey\'s victory lap along the floor as one clear of its own combo, not a cascade', () => {
        const { director, calls } = makeDirector();
        director.onCombo({ comboCount: 10 });
        director.onLineClear({ lineCount: 4, comboCount: 10 });
        director.flush();
        expect(calls.clear[0]).toMatchObject({
            lines: 4, rows: [19, 18, 17, 16], combo: 10, cascade: 1,
        });
        expect(calls.clear[0].rowCodes).toEqual(new Array(40).fill(CG));
        expect(calls.combo).toEqual([[10, 0]]);
    });

    it('keys a scrolling board\'s cells by their absolute rows', () => {
        const { director, calls } = makeDirector();
        const origin = { x: 0.5, y: 0.9 };
        director.onPieceLock({ piece: piece('I', 0, 481, [[1, 1, 1, 1]]), viewportOrigin: origin });
        director.onPieceLock({ piece: piece('O', 4, 480, [[1, 1], [1, 1]]), viewportOrigin: origin });
        director.onLineClear({
            lineCount: 1, clearedRows: [481], cascadeCount: 1, viewportOrigin: origin,
        });
        director.flush();
        // The row on screen comes from the origin; what it was made of, from the well.
        expect(calls.clear[0].rows).toEqual([18]);
        expect(calls.clear[0].rowCodes).toEqual([CI, CI, CI, CI, CO, CO, CG, CG, CG, CG]);
        director.onLineClear({
            lineCount: 1, clearedRows: [481], cascadeCount: 1, viewportOrigin: origin,
        });
        director.flush();
        expect(calls.clear[1].rowCodes).toEqual([CG, CG, CG, CG, CO, CO, CG, CG, CG, CG]);
    });

    it('remembers a scrolling board\'s latest 64 rows and lets the oldest go', () => {
        const { director, calls } = makeDirector();
        for (let i = 0; i < 70; i++) {
            director.onPieceLock({
                piece: piece('T', 0, 1000 + i, [[1]]), viewportOrigin: { x: 0.05, y: 0.5 },
            });
        }
        director.flush();
        // The first six rows written were let go: each is dealt from the ring (all T here).
        director.onLineClear({ lineCount: 1, clearedRows: [1005], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[0].rowCodes).toEqual(row(CT));
        // The oldest row kept and the newest are known cell by cell.
        director.onLineClear({ lineCount: 1, clearedRows: [1006], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[1].rowCodes).toEqual([CT, ...new Array(9).fill(CG)]);
        director.onLineClear({ lineCount: 1, clearedRows: [1069], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[2].rowCodes).toEqual([CT, ...new Array(9).fill(CG)]);
    });

    it('empties the well on a perfect clear', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: piece('I', 0, 22, [[1, 1, 1, 1]]) });
        director.flush();
        director.onPerfectClear({ depth: 1 });
        director.flush();
        // The ring still remembers the I; the board is empty, so its row is dealt from the ring.
        director.onLineClear({ lineCount: 1, clearedRows: [22], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[1].rowCodes).toEqual(row(CI));
    });
});

describe('high-coast director: the combo', () => {
    it('counts the true combo across locks and reports the break on the lock that broke it', () => {
        const { director, calls } = makeDirector();
        for (let i = 0; i < 3; i++) {
            clearingLock(director, I, [23]);
            director.flush();
        }
        expect(calls.clear.map((c) => c.combo)).toEqual([1, 2, 3]);
        expect(calls.combo).toEqual([[1, 0], [2, 0], [3, 0]]);
        // A piece's first clear lands in the tick it locks in: a lock that reaches the frame
        // without one cleared nothing, and the chain is over now.
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.combo).toEqual([[1, 0], [2, 0], [3, 0], [0, 0]]);
        expect(calls.order.slice(-2)).toEqual(['lock', 'combo']);
        // The tracker learns of it only when the next piece locks; that 0 is not told twice.
        director.onPieceLock({ piece: T });
        director.flush();
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.combo).toEqual([[1, 0], [2, 0], [3, 0], [0, 0]]);
        // A new chain starts from one.
        clearingLock(director, I, [23]);
        director.flush();
        expect(calls.combo[calls.combo.length - 1]).toEqual([1, 0]);
        expect(calls.clear[calls.clear.length - 1].combo).toBe(1);
    });

    it('reports the break on the breaking lock even with the lock ripple off', () => {
        const { director, calls } = makeDirector({ lockRipple: false });
        clearingLock(director, I, [23]);
        director.flush();
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.lock).toHaveLength(0);
        expect(calls.combo).toEqual([[1, 0], [0, 0]]);
    });

    it('picks the chain back up when a lock\'s clear turns up after its frame', () => {
        const { director, calls } = makeDirector();
        clearingLock(director, I, [23]);
        director.flush();
        clearingLock(director, I, [23]);
        director.flush();
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.combo).toEqual([[1, 0], [2, 0], [0, 0]]);
        // Online play: the clear that lock made arrives a frame late, before the next lock.
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        expect(calls.combo).toEqual([[1, 0], [2, 0], [0, 0], [3, 0]]);
        expect(calls.clear[calls.clear.length - 1].combo).toBe(3);
        // A lock that clears nothing ends the resumed chain in turn, once.
        director.onPieceLock({ piece: T });
        director.flush();
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.combo).toEqual([[1, 0], [2, 0], [0, 0], [3, 0], [0, 0]]);
    });

    it('tells of a break even when the next piece starts a new chain in the same frame', () => {
        const { director, calls } = makeDirector();
        clearingLock(director, I, [23]);
        director.flush();
        clearingLock(director, I, [23]);
        director.flush();
        // Two locks in one frame: the first clears nothing, the second clears a line.
        director.onPieceLock({ piece: T });
        clearingLock(director, I, [23]);
        director.flush();
        expect(calls.combo).toEqual([[1, 0], [2, 0], [0, 0], [1, 0]]);
        expect(calls.clear[calls.clear.length - 1].combo).toBe(1);
    });

    it('never breaks a board\'s chain for another board\'s lock', () => {
        const { director, calls } = makeDirector();
        clearingLock(director, I, [23], { player: 1 });
        director.flush();
        director.onPieceLock({ piece: T, player: 2 });
        director.flush();
        expect(calls.combo).toEqual([[1, 1]]);
        director.onPieceLock({ piece: T, player: 1 });
        director.flush();
        expect(calls.combo).toEqual([[1, 1], [0, 1]]);
    });
});

describe('high-coast director: cascade depth', () => {
    it('holds a COMBO that comes before its clear for that clear (local multiplayer)', () => {
        const { director, calls } = makeDirector();
        // Local multiplayer's clears carry no cascade count; the depth is told only by COMBO,
        // just before the wave's LINE_CLEAR, in the same tick.
        clearingLock(director, I, [23, 22], { player: 2 });
        director.flush();
        director.onCombo({ comboCount: 2, player: 2 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 2 });
        director.flush();
        director.onCombo({ comboCount: 3, player: 2 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 2 });
        director.flush();
        expect(calls.clear.map((c) => c.cascade)).toEqual([1, 2, 3]);
        // The waves are one lock: the combo does not climb with them.
        expect(calls.clear.map((c) => c.combo)).toEqual([1, 1, 1]);
        expect(calls.combo).toEqual([[1, 2]]);
    });

    it('lets a held COMBO go at the end of its frame, and keeps it to its own board', () => {
        const { director, calls } = makeDirector();
        director.onCombo({ comboCount: 4, player: 2 });
        director.flush();
        expect(calls.clear).toHaveLength(0);
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 2 });
        director.flush();
        expect(calls.clear[0].cascade).toBe(1);
        director.onCombo({ comboCount: 3, player: 1 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 3 });
        director.flush();
        expect(calls.clear[1]).toMatchObject({ player: 3, cascade: 1 });
    });

    it('agrees with single player, whose clears name their own wave', () => {
        const { director, calls } = makeDirector();
        clearingLock(director, I, [23]);
        director.flush();
        director.onCombo({ comboCount: 2 });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22], cascadeCount: 2 });
        director.flush();
        expect(calls.clear.map((c) => c.cascade)).toEqual([1, 2]);
    });
});

describe('high-coast director: back-to-back', () => {
    /** One difficult lock: a four-line clear, then the game's B2B when a run is already live. */
    const quad = (director, b2b = true) => {
        clearingLock(director, I, [23, 22, 21, 20]);
        if (b2b) director.onB2B({ active: true });
    };
    /** A T-spin: the TSPIN (and any B2B) come after the wave's LINE_CLEAR, in its tick. */
    const tspin = (director, lines, b2b = true) => {
        director.onPieceLock({ piece: T });
        director.onLineClear({
            lineCount: lines, clearedRows: [23, 22, 21].slice(0, lines), cascadeCount: 1,
        });
        director.onTSpin({ lineCount: lines });
        if (b2b) director.onB2B({ active: true });
    };

    it('steps the level with each back-to-back, at most four, and ends it on an easy clear', () => {
        const { director, calls } = makeDirector();
        // The first difficult clear only arms the run: the game sends no B2B for it.
        tspin(director, 2, false);
        director.flush();
        expect(calls.b2b).toEqual([]);
        quad(director);
        director.flush();
        expect(calls.b2b).toEqual([[1, 0]]);
        expect(calls.clear[calls.clear.length - 1].b2b).toBe(true);
        // A T-spin single is difficult too, though it clears fewer than four lines.
        tspin(director, 1);
        director.flush();
        quad(director);
        director.flush();
        expect(calls.b2b).toEqual([[1, 0], [2, 0], [3, 0]]);
        quad(director);
        director.flush();
        expect(calls.b2b).toEqual([[1, 0], [2, 0], [3, 0], [4, 0]]);
        quad(director);
        director.flush();
        expect(calls.b2b).toEqual([[1, 0], [2, 0], [3, 0], [4, 0]]);
        // No producer ever says the run ended: a single with no T-spin after it ends it.
        clearingLock(director, I, [23]);
        director.flush();
        expect(calls.b2b).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [0, 0]]);
        expect(calls.order.slice(-4)).toEqual(['lock', 'clear', 'combo', 'b2b']);
        // A lock that clears nothing leaves the run as it was.
        quad(director, false);
        director.flush();
        quad(director);
        director.flush();
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.b2b).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [0, 0], [1, 0]]);
    });

    it('keeps the run through a cascade wave of fewer than four lines', () => {
        const { director, calls } = makeDirector();
        quad(director, false);
        director.flush();
        quad(director);
        director.flush();
        // The same lock cascading: a later wave is no new clear of the run's.
        director.onCombo({ comboCount: 2 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 2 });
        director.flush();
        expect(calls.b2b).toEqual([[1, 0]]);
    });

    it('ends the run when an easy clear lands before a fresh difficult one in the same frame', () => {
        const { director, calls } = makeDirector();
        quad(director, false);
        director.flush();
        quad(director);
        quad(director);
        director.flush();
        expect(calls.b2b).toEqual([[2, 0]]);
        clearingLock(director, I, [23]);
        quad(director, false);
        director.flush();
        expect(calls.b2b).toEqual([[2, 0], [0, 0]]);
    });

    it('keeps each board\'s run to itself', () => {
        const { director, calls } = makeDirector();
        director.onB2B({ active: true, player: 1 });
        director.onB2B({ active: true, player: 2 });
        director.onB2B({ active: true, player: 2 });
        director.flush();
        expect(calls.b2b).toEqual([[1, 1], [2, 2]]);
    });
});

describe('high-coast director: settings and resets', () => {
    it('drops everything staged, and every combo, when reactions are switched off', () => {
        const { director, calls } = makeDirector();
        clearingLock(director, I, [23]);
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

    it('ends the back-to-back run and forgets every well when reactions are switched off', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: piece('I', 0, 23, [[1, 1, 1, 1]]) });
        director.onB2B({ active: true });
        director.flush();
        expect(calls.b2b).toEqual([[1, 0]]);
        director.configure({ enabled: false });
        expect(calls.b2b).toEqual([[1, 0], [0, 0]]);
        // Switched off twice is still off: nothing more to report.
        director.configure({ enabled: false });
        expect(calls.b2b).toEqual([[1, 0], [0, 0]]);
        director.configure({ enabled: true });
        director.flush();
        expect(calls.b2b).toEqual([[1, 0], [0, 0]]);
        // The board it saw is gone with the slot; so are the last pieces' codes.
        director.onLineClear({ lineCount: 1, clearedRows: [23], cascadeCount: 1 });
        director.flush();
        expect(calls.clear[0].rowCodes).toEqual(row(CG));
        // The next back-to-back starts a run from the first step.
        director.onB2B({ active: true });
        director.flush();
        expect(calls.b2b).toEqual([[1, 0], [0, 0], [1, 0]]);
    });

    it('takes no gameplay at all while reactions are off, whatever the event', () => {
        const { director, calls } = makeDirector({ enabled: false });
        expect(director.onHardDrop({ piece: I })).toBe(false);
        expect(director.onPieceLock({ piece: I })).toBe(false);
        expect(director.onLineClear({ lineCount: 2, clearedRows: [23, 22] })).toBe(false);
        expect(director.onCombo({ comboCount: 3, position: { x: 10, y: 10 } })).toBe(false);
        expect(director.onCombo({ comboCount: 3 })).toBe(false);
        expect(director.onTSpin({ lineCount: 2 })).toBe(false);
        expect(director.onB2B({ active: true })).toBe(false);
        expect(director.onPerfectClear({ depth: 1 })).toBe(false);
        director.flush();
        expect(calls).toEqual({
            lock: [], clear: [], spin: [], combo: [], b2b: [], levelUp: [], order: [],
        });
        expect(director.slots.every((slot) => !slot.assigned)).toBe(true);
    });

    it('keeps clears when only the lock ripple is switched off', () => {
        const { director, calls } = makeDirector({ lockRipple: false });
        director.onHardDrop({ piece: I, distance: 12 });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22] });
        director.flush();
        expect(calls.lock).toHaveLength(0);
        expect(calls.clear).toHaveLength(1);
        // The well still keeps count with the ripple off: the clear knows its own I.
        expect(calls.clear[0].rowCodes.slice(0, 10)).toEqual([CG, CG, CG, CG, CG, CG, CI, CI, CI, CI]);
    });

    it('cancels a lock already staged when the lock ripple is switched off before the frame', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: I, distance: 12 });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.configure({ lockRipple: false });
        director.flush();
        expect(calls.lock).toHaveLength(0);
        expect(calls.clear).toHaveLength(1);
        // Switched back on, the next lock lands again, and the cancelled drop's distance is gone.
        director.configure({ lockRipple: true });
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0]).toMatchObject({ hardDrop: false, distance: 0 });
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
        clearingLock(director, I, [23], { player: 3 });
        director.onB2B({ active: true, player: 3 });
        director.flush();
        director.onLevelUp({ level: 7 });
        director.reset();
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 3]);
        expect(calls.b2b[calls.b2b.length - 1]).toEqual([0, 3]);
        expect(director.slots.every((slot) => !slot.assigned && slot.tracker.combo === 0)).toBe(true);
        // A level staged for the run that ended is not announced to the next one.
        director.flush();
        expect(calls.levelUp).toEqual([]);
        // Nor is the break of a chain that ended with it.
        director.onPieceLock({ piece: T, player: 3 });
        director.flush();
        expect(calls.combo).toEqual([[1, 3], [0, 3]]);
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
