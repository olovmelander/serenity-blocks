import {
    describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    WINTER_EVENT_HANDLERS, WinterDirector, resolvePieceColor,
} from '../../src/themes/winter/winter-director.js';
import { PLAYER_SLOTS } from '../../src/themes/winter/winter-composition.js';
import { WINTER_TETROMINOS } from '../../src/themes/winter/winter-tetrominos.js';
import { EVENTS } from '../../src/events/event-bus.js';

const source = readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'winter',
    'winter-director.js',
), 'utf8');

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};

function makeDirector(options = {}) {
    const calls = {
        lock: [], clear: [], combo: [], levelUp: [], gameOver: 0, order: [],
    };
    const sink = {
        // The director reuses its context objects: a sink must copy what it keeps.
        lock: vi.fn((c) => calls.lock.push({ ...c, rows: [...c.rows] })),
        clear: vi.fn((c) => calls.clear.push({ ...c, rows: [...c.rows], screen: c.screen ? { ...c.screen } : null })),
        combo: vi.fn((n, player) => {
            calls.combo.push([n, player]);
            calls.order.push(`combo:${n}`);
        }),
        levelUp: vi.fn((level) => calls.levelUp.push(level)),
        gameOver: vi.fn(() => {
            calls.gameOver += 1;
            calls.order.push('gameOver');
        }),
    };
    return { director: new WinterDirector({ sink, ...options }), calls, sink };
}

describe('winter director: the module', () => {
    it('is renderer-free: it draws nothing and knows no bus, no page and no three', () => {
        const imports = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
        expect(imports.sort()).toEqual([
            '../../core/combo-tracker.js',
            '../../events/lock-origin.js',
            './winter-composition.js',
            './winter-tetrominos.js',
        ]);
        expect(source).not.toMatch(/\bdocument\b|eventBus|from 'three/);
    });
});

describe('winter director: intake', () => {
    it('names a handler for every canonical gameplay event it listens to', () => {
        const director = new WinterDirector();
        for (const [event, handler] of Object.entries(WINTER_EVENT_HANDLERS)) {
            expect(EVENTS[event], event).toBeTruthy();
            expect(typeof director[handler], handler).toBe('function');
        }
        expect(Object.keys(WINTER_EVENT_HANDLERS).sort()).toEqual([
            'B2B', 'COMBO', 'HARD_DROP', 'LEVEL_UP', 'LINE_CLEAR', 'PERFECT_CLEAR', 'PIECE_LOCK', 'TSPIN',
        ]);
        expect(Object.isFrozen(WINTER_EVENT_HANDLERS)).toBe(true);
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
        expect(calls.lock[0].color).toBe(WINTER_TETROMINOS.colors.T);
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
        expect(resolvePieceColor({ color: 'T' })).toBe(WINTER_TETROMINOS.colors.T);
        expect(resolvePieceColor({ shapeKey: 'Z' })).toBe(WINTER_TETROMINOS.colors.Z);
        expect(resolvePieceColor({ type: 'nope' })).toBeNull();
        expect(resolvePieceColor(null)).toBeNull();
        // Every shape has a colour of the theme's own for its sparks to be struck in: a hex the
        // world can read, and no two alike (the sky holds each one apart).
        const shapes = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
        for (const shape of shapes) {
            expect(WINTER_TETROMINOS.colors[shape], shape).toMatch(/^#[0-9a-f]{6}$/i);
            expect(resolvePieceColor({ type: shape })).toBe(WINTER_TETROMINOS.colors[shape]);
        }
        expect(new Set(shapes.map((shape) => WINTER_TETROMINOS.colors[shape].toLowerCase())).size).toBe(shapes.length);
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

    it('works without a sink, and with one that listens to nothing', () => {
        for (const director of [new WinterDirector(), new WinterDirector({ sink: {} })]) {
            expect(() => {
                director.onHardDrop({ piece: I });
                director.onPieceLock({ piece: I });
                director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20] });
                director.onLevelUp({ level: 2 });
                director.flush();
                director.onGameOver();
                director.reset();
            }).not.toThrow();
        }
    });

    it('hands the sink the same two objects every frame', () => {
        const seen = { lock: new Set(), clear: new Set() };
        const director = new WinterDirector({
            sink: { lock: (c) => seen.lock.add(c), clear: (c) => seen.clear.add(c) },
        });
        for (let i = 0; i < 4; i++) {
            director.onPieceLock({ piece: i % 2 ? T : I, player: i % 2 });
            director.onLineClear({ lineCount: 1, clearedRows: [23], player: i % 2 });
            director.flush();
        }
        // Nothing is allocated per event: a sink that keeps a context must copy it.
        expect(seen.lock.size).toBe(1);
        expect(seen.clear.size).toBe(1);
    });
});

describe('winter director: settings and resets', () => {
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
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.configure({ lockRipple: false });
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

describe('winter director: game over', () => {
    it('is not a bus event: the theme forwards the window\'s game over to it', () => {
        expect('GAME_OVER' in WINTER_EVENT_HANDLERS).toBe(false);
        expect('GAME_START' in WINTER_EVENT_HANDLERS).toBe(false);
        expect(Object.values(WINTER_EVENT_HANDLERS)).not.toContain('onGameOver');
        expect(typeof new WinterDirector().onGameOver).toBe('function');
    });

    it('tells the sink the run ended, at once, after breaking every chain', () => {
        const { director, calls, sink } = makeDirector();
        for (const player of [0, 2]) {
            director.onPieceLock({ piece: I, player });
            director.onLineClear({ lineCount: 1, clearedRows: [23], player });
        }
        director.flush();
        calls.order.length = 0;
        expect(director.onGameOver()).toBe(true);
        // No flush needed: game over arrives outside the simulation tick.
        expect(sink.gameOver).toHaveBeenCalledOnce();
        expect(sink.gameOver).toHaveBeenCalledWith();
        // The fires sink before the fox curls up.
        expect(calls.order).toEqual(['combo:0', 'combo:0', 'gameOver']);
        expect(calls.combo.slice(-2)).toEqual([[0, 0], [0, 2]]);
        expect(director.slots.every((slot) => !slot.assigned && slot.tracker.combo === 0)).toBe(true);
        // Nothing is left over for the next frame.
        director.flush();
        expect(sink.gameOver).toHaveBeenCalledOnce();
    });

    it('drops the gameplay still staged when the run ends', () => {
        const { director, calls } = makeDirector();
        director.onHardDrop({ piece: I });
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20] });
        director.onLevelUp({ level: 9 });
        director.onGameOver();
        director.flush();
        expect(calls.lock).toHaveLength(0);
        expect(calls.clear).toHaveLength(0);
        expect(calls.levelUp).toEqual([]);
        expect(calls.combo).toEqual([]); // the chain was never reported, so there is no break to report
        expect(calls.gameOver).toBe(1);
    });

    it('starts the next run\'s chain from one', () => {
        const { director, calls } = makeDirector();
        for (let i = 0; i < 3; i++) {
            director.onPieceLock({ piece: I });
            director.onLineClear({ lineCount: 1, clearedRows: [23] });
            director.flush();
        }
        director.onGameOver();
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 1, clearedRows: [23] });
        director.flush();
        expect(calls.clear[calls.clear.length - 1].combo).toBe(1);
        expect(calls.combo.slice(-2)).toEqual([[0, 0], [1, 0]]);
    });

    it('forgets the run but says nothing when reactions are switched off', () => {
        const { director, sink } = makeDirector({ enabled: false });
        expect(director.onGameOver()).toBe(false);
        expect(sink.gameOver).not.toHaveBeenCalled();
        director.configure({ enabled: true });
        expect(director.onGameOver()).toBe(true);
        expect(sink.gameOver).toHaveBeenCalledOnce();
    });
});
