import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SunfallTheme from '../../src/themes/sunfall/sunfall-theme.js';
import { SUNFALL_TETROMINOS } from '../../src/themes/sunfall/sunfall-tetrominos.js';
import { SunfallWorld } from '../../src/themes/sunfall/sunfall-world.js';
import { SunfallDirector } from '../../src/themes/sunfall/sunfall-director.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { PIECE_SWATCH_RGB } from '../../src/themes/sunfall/sunfall-core.js';

const themeFile = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'sunfall',
    'sunfall-theme.js',
);

describe('sunfall-theme', () => {
    it('keeps sunfall-theme.js under the <= 300 LOC shell budget', () => {
        const src = readFileSync(themeFile, 'utf8');
        const lineCount = src.split(/\r?\n/).length;
        expect(lineCount).toBeLessThanOrEqual(300);
    });

    it('exposes the SUNFALL_TETROMINOS config', () => {
        const theme = new SunfallTheme();
        expect(theme.name).toBe('sunfall');
        expect(theme.getTetrominoConfig()).toBe(SUNFALL_TETROMINOS);
    });

    it('routes gameplay events from eventBus through SunfallDirector and cleans up cleanly', () => {
        const theme = new SunfallTheme();
        theme.isActive = true;
        theme.isPaused = false;
        theme.director = new SunfallDirector({ level: 1 });
        theme.world = new SunfallWorld({ quality: 'Low' });
        theme.setupEvents();

        // The canonical payloads (src/events/gameplay-events.js), as every mode sends them.
        const T = [[0, 1, 0], [1, 1, 1]];
        eventBus.emit(EVENTS.PIECE_LOCK, {
            piece: {
                shapeKey: 'L', shape: T, x: 0, y: 20,
            },
        });
        expect(theme.director.flushPulse).toBeGreaterThan(0.8);
        // The piece's own pigment, on its own side, at its own rows (the hidden rows taken off).
        expect(theme.director.flushColor).toEqual(PIECE_SWATCH_RGB.L);
        const lock = theme.director.lockEvents.at(-1);
        expect(lock.u).toBeLessThan(0.5);
        expect(lock.cells.map((c) => c.row).sort()).toEqual([16, 17, 17, 17]);

        // A hard drop and its lock (same tick) are one piece: one lock, one kick.
        const I = [[1, 1, 1, 1]];
        const locks = theme.director.lockSerial;
        eventBus.emit(EVENTS.HARD_DROP, {
            piece: {
                shapeKey: 'I', shape: I, x: 6, y: 23,
            },
            distance: 10,
        });
        eventBus.emit(EVENTS.PIECE_LOCK, {
            piece: {
                shapeKey: 'I', shape: I, x: 6, y: 23,
            },
        });
        expect(theme.director.snapPulse).toBeGreaterThan(0.8);
        expect(theme.director.snapColor).toEqual(PIECE_SWATCH_RGB.I);
        expect(theme.director.lockSerial).toBe(locks + 1);

        // A quad, read from lineCount and clearedRows; a T-spin and a back-to-back after it.
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [20, 21, 22, 23], cascadeCount: 1 });
        expect(theme.director.cataractPulse).toBeGreaterThan(0.8);
        expect(theme.director.clearEvents.at(-1).rows).toEqual([16, 17, 18, 19]);
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        expect(theme.director.turningPulse).toBeGreaterThan(0.8);
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.B2B, { active: true });
        expect(theme.director.b2bLevel).toBe(2);

        // The late perfect clear crowns the quad still pouring: the zenith swings in, the
        // cataract is fed (never restarted from the rim).
        for (let i = 0; i < 4; i += 1) theme.director.step(0.09);
        const age = theme.director.cataractAge;
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 4, perfectClearBonus: 1000 });
        for (let i = 0; i < 9; i += 1) theme.director.step(0.1);
        expect(theme.director.zenithPulse).toBeGreaterThan(0.8);
        expect(theme.director.cataractAge).toBeCloseTo(age + 0.9, 5);

        // COMBO is the cascade depth (the wave's LINE_CLEAR carries it): each wave opens more.
        eventBus.emit(EVENTS.COMBO, { comboCount: 3 });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 3 });
        expect(theme.director.comboCount).toBeGreaterThanOrEqual(3);

        eventBus.emit(EVENTS.LEVEL_UP, { level: 8 });
        expect(theme.director.level).toBe(8);

        theme.disposeRuntime();
        expect(theme.world).toBeNull();
        expect(theme.director).toBeNull();
    });
});
