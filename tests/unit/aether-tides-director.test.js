import {
    describe, expect, it, vi,
} from 'vitest';
import {
    AETHER_TIDES_EVENT_HANDLERS, AetherTidesDirector, resolvePieceColor,
} from '../../src/themes/aether-tides/aether-tides-director.js';
import { BOARD_GRID, PLAYER_SLOTS } from '../../src/themes/aether-tides/aether-tides-composition.js';
import { AETHER_TIDES_TETROMINOS } from '../../src/themes/aether-tides/aether-tides-tetrominos.js';
import { COLORS } from '../../src/core/constants.js';
import { EVENTS } from '../../src/events/event-bus.js';

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};

/** The sink a world would be: it copies what it keeps, because the director reuses its objects. */
function makeDirector(options = {}) {
    const calls = {
        lock: [], clear: [], combo: [], levelUp: [],
    };
    const sink = {
        lock: vi.fn((c) => calls.lock.push({
            ...c, rows: [...c.rows], cells: c.cells.map((cell) => [...cell]),
        })),
        clear: vi.fn((c) => calls.clear.push({ ...c, rows: [...c.rows], screen: c.screen ? { ...c.screen } : null })),
        combo: vi.fn((n, player) => calls.combo.push([n, player])),
        levelUp: vi.fn((level) => calls.levelUp.push(level)),
    };
    return { director: new AetherTidesDirector({ sink, ...options }), calls, sink };
}

describe('aether tides director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new AetherTidesDirector();
        for (const [event, handler] of Object.entries(AETHER_TIDES_EVENT_HANDLERS)) {
            expect(EVENTS[event], event).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
    });

    it('stages a lock and resolves it once, on flush, with its cells, rows, column and colour', () => {
        const { director, calls, sink } = makeDirector();
        director.onPieceLock({ piece: T });
        expect(sink.lock).not.toHaveBeenCalled();
        director.flush();
        expect(calls.lock).toHaveLength(1);
        // The piece's OCCUPIED cells, on the visible board: the matrix carries four hidden rows.
        expect(calls.lock[0].cells).toEqual([[4, 18], [3, 19], [4, 19], [5, 19]]);
        expect(calls.lock[0].rows).toEqual([18, 19]);
        // The column is the centroid of the occupied cells, as a fraction of the ten columns.
        expect(calls.lock[0].u).toBeCloseTo((3 + 1.5) / 10, 6);
        expect(calls.lock[0].color).toBe(AETHER_TIDES_TETROMINOS.colors.T);
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
        expect(calls.lock[0].cells).toEqual([[6, 19], [7, 19], [8, 19], [9, 19]]);
    });

    it('prefers the piece\'s own hex colour and falls back to the theme\'s colour for its shape', () => {
        expect(resolvePieceColor({ color: '#12abEF', type: 'T' })).toBe('#12abEF');
        expect(resolvePieceColor({ color: 'T' })).toBe(AETHER_TIDES_TETROMINOS.colors.T);
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBe(AETHER_TIDES_TETROMINOS.colors.Z);
        expect(resolvePieceColor({ type: 'nope' })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
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

    it('hands the sink the lock before the clear it caused', () => {
        const order = [];
        const director = new AetherTidesDirector({
            sink: {
                lock: () => order.push('lock'),
                clear: () => order.push('clear'),
                combo: () => order.push('combo'),
            },
        });
        // The bus delivers the hard drop first, then the lock, then the clear.
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        director.flush();
        expect(order).toEqual(['lock', 'clear', 'combo']);
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

    it('lets an explicit combo raise the chain (Odyssey\'s victory lap)', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I });
        director.onLineClear({
            lineCount: 1, clearedRows: [23], cascadeCount: 1, comboCount: 6,
        });
        director.flush();
        expect(calls.clear[0].combo).toBe(6);
        expect(calls.combo).toEqual([[6, 0]]);
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
        expect(calls.lock).toHaveLength(0);
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0].combo).toBe(4);
        expect(calls.clear[0].screen).toEqual({ x: 0.25, y: 0.8 });
        // A click outside the window is clamped onto it.
        director.onCombo({ comboCount: 5, position: { x: -40, y: 9000 } });
        director.flush();
        expect(calls.clear[1].screen).toEqual({ x: 0, y: 1 });
    });

    it('keeps each local-multiplayer board\'s combo, and its cells, to itself', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: I, player: 1 });
        director.onLineClear({ lineCount: 1, clearedRows: [23], player: 1 });
        director.onPieceLock({ piece: T, player: 2 });
        director.flush();
        const byPlayer = Object.fromEntries(calls.lock.map((c) => [c.player, c]));
        expect(Object.keys(byPlayer).sort()).toEqual(['1', '2']);
        expect(byPlayer[1].cells).toEqual([[6, 19], [7, 19], [8, 19], [9, 19]]);
        expect(byPlayer[2].cells).toEqual([[4, 18], [3, 19], [4, 19], [5, 19]]);
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
            director.onPieceLock({ piece: { shape: [null, 7, 'row'], x: 1, y: 1 } });
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

describe('aether tides director: the piece\'s cells', () => {
    /** Lock one piece and return what the sink was handed. */
    function lockOf(piece, extra = {}) {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece, ...extra });
        director.flush();
        return calls.lock[0];
    }

    it('reads the occupied cells of a padded matrix, never its bounding box', () => {
        // The I piece as the game carries it: one full row of a 4×4 matrix.
        const flat = lockOf({
            shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], x: 3, y: 21, type: 'I',
        });
        expect(flat.cells).toEqual([[3, 18], [4, 18], [5, 18], [6, 18]]);
        expect(flat.rows).toEqual([18]);
        // Stood on end: one column of the same matrix.
        const upright = lockOf({
            shape: [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]], x: 3, y: 20, type: 'I',
        });
        expect(upright.cells).toEqual([[5, 16], [5, 17], [5, 18], [5, 19]]);
        expect(upright.rows).toEqual([16, 17, 18, 19]);
        expect(upright.u).toBeCloseTo(0.55, 6);
        // An S piece in a 3×3 matrix with an empty bottom row; colour ids instead of ones.
        const s = lockOf({
            shape: [[0, 5, 5], [5, 5, 0], [0, 0, 0]], x: 0, y: 22, type: 'S',
        });
        expect(s.cells).toEqual([[1, 18], [2, 18], [0, 19], [1, 19]]);
        expect(s.rows).toEqual([18, 19]);
    });

    it('counts rows from the top of the visible board: the hidden rows are taken off', () => {
        expect(BOARD_GRID.hiddenRows).toBe(4);
        const top = lockOf({ ...T, y: BOARD_GRID.hiddenRows });
        expect(top.cells).toEqual([[4, 0], [3, 1], [4, 1], [5, 1]]);
        const floor = lockOf({ ...T, y: BOARD_GRID.hiddenRows + BOARD_GRID.rows - 2 });
        expect(floor.cells).toEqual([[4, 18], [3, 19], [4, 19], [5, 19]]);
        // A piece with no position stands at the spawn column, on the first visible row.
        const nowhere = lockOf({ shape: [[1, 1], [1, 1]], type: 'O' });
        expect(nowhere.cells).toEqual([[4, 0], [5, 0], [4, 1], [5, 1]]);
    });

    it('clamps every cell onto the ten columns and twenty visible rows', () => {
        // Locked out above the board: the hidden rows fold onto the top row.
        const above = lockOf({ ...T, y: 1 });
        expect(above.cells).toEqual([[4, 0], [3, 0], [4, 0], [5, 0]]);
        // A position below the floor, or off either side, cannot leave the board.
        const below = lockOf({ ...T, y: 90 });
        expect(below.cells).toEqual([[4, 19], [3, 19], [4, 19], [5, 19]]);
        const left = lockOf({ ...T, x: -1 });
        expect(left.cells).toEqual([[0, 18], [0, 19], [0, 19], [1, 19]]);
        const right = lockOf({ ...T, x: 8 });
        expect(right.cells).toEqual([[9, 18], [8, 19], [9, 19], [9, 19]]);
        for (const lock of [above, below, left, right]) {
            for (const [column, row] of lock.cells) {
                expect(Number.isInteger(column)).toBe(true);
                expect(Number.isInteger(row)).toBe(true);
                expect(column).toBeGreaterThanOrEqual(0);
                expect(column).toBeLessThan(BOARD_GRID.columns);
                expect(row).toBeGreaterThanOrEqual(0);
                expect(row).toBeLessThan(BOARD_GRID.rows);
            }
        }
        // A fractional position (a piece caught mid-animation) lands on whole cells.
        expect(lockOf({ ...I, x: 2.4, y: 22.6 }).cells).toEqual([[2, 19], [3, 19], [4, 19], [5, 19]]);
    });

    it('hands over at most six cells, however large the shape', () => {
        const slab = lockOf({
            shape: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], x: 2, y: 10, type: 'O',
        });
        expect(slab.cells).toEqual([[2, 6], [3, 6], [4, 6], [2, 7], [3, 7], [4, 7]]);
        // The rows and the column still describe the whole piece.
        expect(slab.rows).toEqual([6, 7, 8]);
        expect(slab.u).toBeCloseTo(0.35, 6);
        // A pentomino fits whole.
        const plus = lockOf({
            shape: [[0, 1, 0], [1, 1, 1], [0, 1, 0]], x: 4, y: 20,
        });
        expect(plus.cells).toEqual([[5, 16], [4, 17], [5, 17], [6, 17], [5, 18]]);
        // A matrix larger than any piece is read only as far as a piece can reach.
        const wide = lockOf({ shape: [new Array(40).fill(1)], x: 0, y: 23 });
        expect(wide.cells).toHaveLength(6);
        expect(wide.u).toBeCloseTo(0.4, 6);
    });

    it('has no cells for a scrolling board: the on-screen origin gives the row and the column', () => {
        const { director, calls } = makeDirector();
        director.onPieceLock({ piece: { ...T, y: 480 }, viewportOrigin: { x: 0.8, y: 0.25 } });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0].cells).toEqual([]);
        expect(calls.lock[0].rows).toEqual([5]);
        expect(calls.lock[0].u).toBeCloseTo(0.8, 6);
        expect(calls.lock[0].color).toBe(AETHER_TIDES_TETROMINOS.colors.T);
        // An origin off the playfield is clamped onto it.
        director.onPieceLock({ piece: { ...T, y: 481 }, viewportOrigin: { x: 4, y: 1 } });
        director.flush();
        expect(calls.lock[1].cells).toEqual([]);
        expect(calls.lock[1].rows).toEqual([19]);
        expect(calls.lock[1].u).toBe(1);
        // A hard drop that names the origin and a lock that names it again: still no cells.
        director.onHardDrop({ piece: { ...I, y: 300 }, viewportOrigin: { x: 0.3, y: 0.5 } });
        director.onPieceLock({ piece: { ...I, y: 300 }, viewportOrigin: { x: 0.3, y: 0.5 } });
        director.flush();
        expect(calls.lock[2]).toMatchObject({ hardDrop: true, cells: [], rows: [10] });
        // An origin that is not one falls back to the matrix, cells and all.
        director.onPieceLock({ piece: T, viewportOrigin: { x: NaN, y: 0.5 } });
        director.flush();
        expect(calls.lock[3].cells).toEqual([[4, 18], [3, 19], [4, 19], [5, 19]]);
        expect(calls.lock[3].rows).toEqual([18, 19]);
    });

    it('forgets a board\'s cells once a scrolling lock replaces it in the same frame', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: T });
        director.onPieceLock({ piece: T, viewportOrigin: { x: 0.5, y: 0.5 } });
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0].cells).toEqual([]);
        expect(calls.lock[0].rows).toEqual([10]);
    });

    it('reuses its buffers: one cells array, six pair arrays, no growth', () => {
        const seen = { lists: [], pairs: [], snapshots: [] };
        const director = new AetherTidesDirector({
            sink: {
                lock: (c) => {
                    seen.lists.push(c.cells);
                    seen.pairs.push([...c.cells]);
                    seen.snapshots.push(c.cells.map((cell) => [...cell]));
                },
            },
        });
        const [slot] = director.slots;
        const buffer = slot.lockCells;
        expect(buffer).toBeInstanceOf(Int16Array);
        expect(buffer).toHaveLength(12);
        const pairs = director._cellPairs.slice();
        expect(pairs).toHaveLength(6);

        director.onPieceLock({ piece: T });
        director.flush();
        director.onPieceLock({ piece: I });
        director.flush();
        director.onPieceLock({ piece: { shape: [[1, 1, 1], [1, 1, 1]], x: 0, y: 4 } });
        director.flush();
        director.onPieceLock({ piece: T, viewportOrigin: { x: 0.5, y: 0.5 } });
        director.flush();

        // The same array every time, filled with the same pair objects in order.
        expect(seen.lists.every((list) => list === seen.lists[0])).toBe(true);
        seen.pairs.forEach((list) => list.forEach((pair, i) => expect(pair).toBe(pairs[i])));
        expect(director._cellPairs).toHaveLength(6);
        director._cellPairs.forEach((pair, i) => expect(pair).toBe(pairs[i]));
        expect(director.slots[0].lockCells).toBe(buffer);
        // Which is why a sink must copy: what it was handed has been overwritten since.
        expect(seen.snapshots.map((cells) => cells.length)).toEqual([4, 4, 6, 0]);
        expect(seen.snapshots[0]).toEqual([[4, 18], [3, 19], [4, 19], [5, 19]]);
        expect(seen.snapshots[1]).toEqual([[6, 19], [7, 19], [8, 19], [9, 19]]);
        expect(seen.lists[0]).toHaveLength(0);
        expect(pairs[0]).toEqual([0, 0]); // the six-cell lock's first pair, still in place
        // A shorter piece after a longer one leaves none of the longer one's cells behind.
        director.onPieceLock({ piece: { shape: [[1]], x: 7, y: 9 } });
        director.flush();
        expect(seen.snapshots[4]).toEqual([[7, 5]]);
    });

    it('keeps the staged cells when a later event of the same frame carries no usable shape', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: { type: 'I' } }); // no matrix: the hard drop's footprint stands
        director.flush();
        expect(calls.lock).toHaveLength(1);
        expect(calls.lock[0].cells).toEqual([[6, 19], [7, 19], [8, 19], [9, 19]]);
        expect(calls.lock[0].hardDrop).toBe(true);
    });
});

describe('aether tides director: settings and resets', () => {
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
        expect(director.slots.every((slot) => slot.lockCellCount === 0 && slot.lockRowCount === 0)).toBe(true);
    });

    it('keeps clears when only the lock ripple is switched off', () => {
        const { director, calls } = makeDirector({ lockRipple: false });
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22] });
        director.flush();
        expect(calls.lock).toHaveLength(0);
        expect(calls.clear).toHaveLength(1);
        // Switched off mid-frame: the lock already staged is cancelled, the clear is not.
        const live = makeDirector();
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
        director.onPieceLock({ piece: T, player: 3 });
        director.reset();
        expect(calls.combo[calls.combo.length - 1]).toEqual([0, 3]);
        expect(director.slots.every((slot) => !slot.assigned && slot.tracker.combo === 0)).toBe(true);
        expect(director.slots.every((slot) => slot.lockCellCount === 0)).toBe(true);
        director.flush();
        expect(calls.lock).toHaveLength(1);
    });

    it('works with no sink at all', () => {
        const director = new AetherTidesDirector();
        expect(() => {
            director.onHardDrop({ piece: I });
            director.onPieceLock({ piece: I });
            director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20] });
            director.onLevelUp({ level: 2 });
            director.flush();
            director.reset();
        }).not.toThrow();
    });
});

describe('aether tides tetrominos', () => {
    it('gives every piece, and garbage, a colour of this theme in the shape the style manager reads', () => {
        const config = AETHER_TIDES_TETROMINOS;
        expect(config.version).toBe(1);
        expect(config.renderMode).toBe('glow');
        // The seven pieces and garbage, under the keys the game colours a cell by.
        expect(Object.keys(config.colors).sort()).toEqual(['GARBAGE', 'I', 'J', 'L', 'O', 'S', 'T', 'Z']);
        for (const [key, colour] of Object.entries(config.colors)) {
            expect(COLORS, key).toHaveProperty(key);
            expect(colour, key).toMatch(/^#[0-9A-F]{6}$/i);
        }
        expect(config.colors).toMatchObject({
            I: '#F5C542', J: '#FF7A3C', L: '#2CE0FF', O: '#8A5CFF', S: '#FF4D6D', T: '#3CE68C', Z: '#3A7BFF',
        });
        // Seven pieces a player can tell apart.
        const pieces = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'].map((key) => config.colors[key].toLowerCase());
        expect(new Set(pieces).size).toBe(7);
        // Garbage is dark: it must never read as a piece.
        const garbage = Number.parseInt(config.colors.GARBAGE.slice(1), 16);
        expect(Math.max((garbage >> 16) & 255, (garbage >> 8) & 255, garbage & 255)).toBeLessThan(0x60);
        expect(config.effects).toMatchObject({ glowColor: 'auto', outline: true });
        expect(config.rendererOverrides).toHaveProperty('canvas');
        expect(config.rendererOverrides).toHaveProperty('phaser');
        // The old per-piece shape ({ I: { color } }, ghost) is gone: nothing ever read it.
        expect(config.I).toBeUndefined();
        expect(config.ghost).toBeUndefined();
    });
});
