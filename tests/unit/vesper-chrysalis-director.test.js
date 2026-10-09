import {
    describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    VESPER_EVENT_HANDLERS, VesperDirector, resolvePieceColor,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-director.js';
import { PLAYER_SLOTS } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-composition.js';
import { VESPER_CHRYSALIS_TETROMINOS } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-tetrominos.js';
import { EVENTS } from '../../src/events/event-bus.js';

const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'vesper-chrysalis',
);

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
    return { director: new VesperDirector({ sink, ...options }), calls, sink };
}

describe('vesper chrysalis director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new VesperDirector();
        expect(Object.keys(VESPER_EVENT_HANDLERS).sort()).toEqual([
            'B2B', 'COMBO', 'HARD_DROP', 'LEVEL_UP', 'LINE_CLEAR', 'PERFECT_CLEAR', 'PIECE_LOCK', 'TSPIN',
        ]);
        for (const [event, handler] of Object.entries(VESPER_EVENT_HANDLERS)) {
            expect(EVENTS[event], event).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
    });

    it('stays renderer-free: it imports the composition, the piece colours and two shared game modules', () => {
        const imports = (name) => [...readFileSync(path.join(themeDir, name), 'utf8')
            .matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort();
        expect(imports('vesper-chrysalis-director.js')).toEqual([
            '../../core/combo-tracker.js',
            '../../events/lock-origin.js',
            './vesper-chrysalis-composition.js',
            './vesper-chrysalis-tetrominos.js',
        ]);
        expect(imports('vesper-chrysalis-composition.js')).toEqual([]);
        expect(imports('vesper-chrysalis-tetrominos.js')).toEqual([]);
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
        expect(calls.lock[0].color).toBe(VESPER_CHRYSALIS_TETROMINOS.colors.T);
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
        expect(resolvePieceColor({ color: 'T' })).toBe(VESPER_CHRYSALIS_TETROMINOS.colors.T);
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBe(VESPER_CHRYSALIS_TETROMINOS.colors.Z);
        expect(resolvePieceColor({ type: 'nope' })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
        // Every shape the game deals has a colour here, and each is a hex the world can read.
        for (const shape of ['I', 'O', 'T', 'S', 'Z', 'J', 'L']) {
            expect(resolvePieceColor({ type: shape }), shape).toMatch(/^#[0-9a-f]{6}$/i);
            expect(resolvePieceColor({ type: shape })).toBe(VESPER_CHRYSALIS_TETROMINOS.colors[shape]);
        }
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
        // The meditation mode emits LINE_CLEAR and COMBO per click and never a PIECE_LOCK, so the
        // tracker counts one chain of one however long the clicks go on.
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
        const bare = new VesperDirector();
        const partial = new VesperDirector({ sink: { clear: vi.fn() } });
        for (const director of [bare, partial]) {
            expect(() => {
                director.onHardDrop({ piece: I });
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

describe('vesper chrysalis director: settings and resets', () => {
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
        expect(calls).toEqual({
            lock: [], clear: [], combo: [], levelUp: [],
        });
        expect(director.slots.every((slot) => !slot.assigned)).toBe(true);
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
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.configure({ lockRipple: false });
        director.flush();
        expect(calls.lock).toHaveLength(0);
        expect(calls.clear).toHaveLength(1);
        // Switched back on, the next lock lands again.
        director.configure({ lockRipple: true });
        director.onPieceLock({ piece: T });
        director.flush();
        expect(calls.lock).toHaveLength(1);
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
        expect(director.slots.every((slot) => !slot.assigned && slot.tracker.combo === 0)).toBe(true);
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
