import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SunfallTheme from '../../src/themes/sunfall/sunfall-theme.js';
import { SUNFALL_TETROMINOS } from '../../src/themes/sunfall/sunfall-tetrominos.js';
import { SunfallWorld } from '../../src/themes/sunfall/sunfall-world.js';
import { SunfallDirector } from '../../src/themes/sunfall/sunfall-director.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

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

        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T', x: 4, y: 12 } });
        expect(theme.director.flushPulse).toBeGreaterThan(0.8);

        eventBus.emit(EVENTS.HARD_DROP, { pieceType: 'I', x: 3, y: 15, distance: 10 });
        expect(theme.director.snapPulse).toBeGreaterThan(0.8);

        eventBus.emit(EVENTS.LINE_CLEAR, {
            lineCount: 4,
            rows: [16, 17, 18, 19],
            isTSpin: true,
            isPerfectClear: true,
            b2bCount: 2,
        });
        expect(theme.director.cataractPulse).toBeGreaterThan(0.8);
        expect(theme.director.turningPulse).toBeGreaterThan(0.8);
        expect(theme.director.zenithPulse).toBeGreaterThan(0.8);
        expect(theme.director.b2bLevel).toBe(2);

        eventBus.emit(EVENTS.COMBO, { comboCount: 7 });
        expect(theme.director.comboCount).toBe(7);

        eventBus.emit(EVENTS.LEVEL_UP, { level: 8 });
        expect(theme.director.level).toBe(8);

        theme.disposeRuntime();
        expect(theme.world).toBeNull();
        expect(theme.director).toBeNull();
    });
});
