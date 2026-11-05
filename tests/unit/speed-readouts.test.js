/**
 * Both Speed readouts kept their own table from when level 1 was a 1000 ms drop. The game's drop
 * table had moved on, so the ledger showed 1.7x at level 5 and the results sheet 8.3x, with the
 * game really 6.0x faster than level 1, and every Infinity results sheet read 1.4x at level 1.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { LEVEL_SPEEDS } from '../../src/core/constants.js';
import { getSpeedMultiplier } from '../../src/core/scoring.js';
import { updateStats } from '../../src/rendering/draw.js';
import { computeResultFigures } from '../../src/ui/modals.js';

function element() {
    const names = new Set();
    return {
        textContent: '',
        set className(value) { names.clear(); }, // as a browser does: assigning replaces the classes
        style: { setProperty() {} },
        offsetWidth: 0,
        classList: {
            add: (name) => names.add(name),
            remove: (name) => names.delete(name),
            contains: (name) => names.has(name),
        },
    };
}

describe('the ledger\'s Speed', () => {
    const speed = element(); // updateStats keeps the elements it looks up for the page's life

    beforeEach(() => {
        vi.stubGlobal('document', {
            getElementById: (id) => (id === 'speed' ? speed : element()),
            querySelector: () => element(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const show = (level) => updateStats({
        score: 0, lines: 0, level, linesUntilNextLevel: 10, startTime: 0, piecesPlaced: 0,
    });

    it.each([
        [1, '1.0x'], [5, '6.0x'], [10, '12.4x'], [20, '20.0x'],
    ])('at level %i reads %s', (level, expected) => {
        show(level);

        expect(speed.textContent).toBe(expected);
    });

    it('agrees with the scoring module at every level', () => {
        for (let level = 1; level <= 30; level += 1) {
            show(level);
            expect(speed.textContent).toBe(getSpeedMultiplier(level));
        }
    });

    it('turns to its warning and danger tints on the true speed', () => {
        show(4);
        expect(speed.classList.contains('warning')).toBe(false);
        show(5);
        expect(speed.classList.contains('warning')).toBe(true);
        show(20);
        expect(speed.classList.contains('danger')).toBe(true);
    });
});

describe('the results sheet\'s Speed', () => {
    const speedAt = (level) => computeResultFigures({
        score: 0, lines: 0, piecesPlaced: 0, dropInterval: LEVEL_SPEEDS[level - 1],
    }, 1000).speed;

    it.each([
        [1, '1.0'], [5, '6.0'], [10, '12.4'],
    ])('at level %i reads %s', (level, expected) => {
        expect(speedAt(level)).toBe(expected);
    });

    it('agrees with the ledger at every level', () => {
        for (let level = 1; level <= 30; level += 1) {
            expect(`${speedAt(level)}x`).toBe(getSpeedMultiplier(level));
        }
    });
});
