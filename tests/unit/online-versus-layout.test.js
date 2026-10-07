/**
 * Online versus' stage (src/ui/online-versus-layout.js): your station is the hero in the
 * middle of the window, every opponent stays on screen (up to seven) in the column on its
 * left, the rail keeps the column on its right, a duel's opponent stands at your size, and
 * narrow windows stack — nothing past the window at any size.
 */
import { describe, expect, it } from 'vitest';
import {
    FIELD_CHROME, RAIL, fieldGrid, fieldStation, onlineLayout,
} from '../../src/ui/online-versus-layout.js';
import { versusStation } from '../../src/ui/local-versus-layout.js';

const SIZES = [
    [1024, 768], [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160],
    [390, 844], [820, 1180],
];

const fieldSize = (layout) => {
    if (!layout.fieldRows) return { width: 0, height: 0 };
    const s = fieldStation(layout.fieldBlock);
    return {
        width: layout.fieldColumns * s.width + (layout.fieldColumns - 1) * FIELD_CHROME.gap,
        height: layout.fieldRows * s.height + (layout.fieldRows - 1) * FIELD_CHROME.gap,
    };
};

describe('online versus layout', () => {
    it.each(SIZES)('fits the window at %ix%i with any number of opponents', (width, height) => {
        for (let opponents = 0; opponents <= 7; opponents++) {
            const layout = onlineLayout({
                width, height, opponents, inset: 16, topRow: 64,
            });
            const you = versusStation(layout.block);
            const field = fieldSize(layout);
            const stageHeight = height - layout.top - 16;
            if (layout.arrangement === 'stack') {
                expect(Math.max(you.width, field.width)).toBeLessThanOrEqual(width - 32);
                expect(you.height + (opponents ? field.height + layout.gap : 0)).toBeLessThanOrEqual(stageHeight);
            } else {
                // Two equal columns beside your station: the field fits the left one, the rail
                // the right one, and the three fit the window.
                expect(2 * layout.side + you.width + 2 * layout.gap).toBeLessThanOrEqual(width - 32);
                expect(field.width).toBeLessThanOrEqual(layout.side);
                expect(layout.rail).toBeLessThanOrEqual(layout.side);
                expect(layout.rail).toBeGreaterThanOrEqual(RAIL.min);
                expect(Math.max(you.height, field.height)).toBeLessThanOrEqual(stageHeight);
            }
            if (opponents) expect(layout.fieldRows * layout.fieldColumns).toBeGreaterThanOrEqual(opponents);
        }
    });

    it('puts your station in the middle of the window', () => {
        const layout = onlineLayout({ width: 1600, height: 900, opponents: 3 });
        expect(layout.arrangement).toBe('center');
        const you = versusStation(layout.block);
        const left = 16 + layout.side + layout.gap;
        expect(Math.abs(left + you.width / 2 - 800)).toBeLessThanOrEqual(1);
    });

    it('shows a duel\'s opponent at your size', () => {
        const layout = onlineLayout({ width: 1600, height: 900, opponents: 1 });
        expect(layout.fieldBlock).toBe(layout.block);
    });

    it('keeps your board the largest, and every opponent readable', () => {
        for (const [width, height] of SIZES.slice(0, 7)) {
            for (let opponents = 2; opponents <= 7; opponents++) {
                const layout = onlineLayout({ width, height, opponents });
                expect(layout.fieldBlock).toBeLessThan(layout.block);
                expect(layout.fieldBlock).toBeGreaterThanOrEqual(Math.min(8, layout.block * 0.34));
            }
        }
    });

    it('grows your board well past the old fixed card at 1600x900', () => {
        const layout = onlineLayout({ width: 1600, height: 900, opponents: 3 });
        // The old card's board was about 245 px wide (a 24.5 px block).
        expect(layout.block).toBeGreaterThanOrEqual(30);
    });

    it('stacks narrow and tall windows: the field over your station, no rail', () => {
        const phone = onlineLayout({ width: 390, height: 844, opponents: 3 });
        expect(phone.arrangement).toBe('stack');
        expect(phone.rail).toBe(0);
        expect(phone.block * 10).toBeLessThanOrEqual(390 - 32);
    });

    it('lays the field out in the fewest rows that give the biggest boards', () => {
        const grid = fieldGrid(4, 900, 800);
        expect(grid.rows * grid.columns).toBeGreaterThanOrEqual(4);
        const wide = fieldGrid(4, 2000, 500);
        expect(wide.rows).toBe(1);
        expect(fieldGrid(3, 600, 900, 12).block).toBeLessThanOrEqual(12);
    });
});
