import { describe, expect, it } from 'vitest';
import {
    VERSUS_COLS, versusLayout, versusParts, versusStation,
} from '../../src/ui/local-versus-layout.js';

const fits = (layout, width, height, players, infinity = false) => {
    const station = versusStation(layout.block, infinity);
    const columns = Math.ceil(players / layout.rows);
    const totalWidth = columns * station.width + (columns - 1) * layout.gap + 2 * layout.inset;
    const totalHeight = layout.top + layout.rows * station.height + (layout.rows - 1) * 20 + layout.inset;
    return totalWidth <= width && totalHeight <= height;
};

describe('local versus layout', () => {
    it('sizes two and four players on one row of a 1080p window', () => {
        const two = versusLayout({ width: 1920, height: 1080, players: 2 });
        expect(two.rows).toBe(1);
        expect(two.block).toBeGreaterThanOrEqual(38);
        const four = versusLayout({ width: 1920, height: 1080, players: 4 });
        expect(four.columns).toBe(4);
        expect(four.block).toBeGreaterThanOrEqual(36);
    });

    it('fits the queue row (label, next tile, two later tiles) over the board', () => {
        [20, 28, 34, 44, 60, 80].forEach((block) => {
            const p = versusParts(block);
            const label = 48;
            const row = label + p.nextWidth + 2 * p.laterWidth + 3 * p.nextGap;
            expect(row, `block ${block}`).toBeLessThanOrEqual(VERSUS_COLS * block);
            // Wide tiles, as pieces are; the later ones smaller.
            expect(p.nextWidth).toBeGreaterThan(p.nextHeight);
            expect(p.laterHeight).toBeLessThan(p.nextHeight);
        });
    });

    it('always fits the window, from a 1024 × 768 tablet to 4K, two to four players', () => {
        const sizes = [[1024, 768], [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160]];
        sizes.forEach(([width, height]) => {
            [2, 3, 4].forEach((players) => {
                const layout = versusLayout({ width, height, players });
                expect(fits(layout, width, height, players), `${players}P at ${width}×${height}`).toBe(true);
                expect(layout.block).toBeGreaterThanOrEqual(20);
            });
        });
    });

    it('wraps onto two rows only where that gives the bigger board (tall windows)', () => {
        expect(versusLayout({ width: 1920, height: 1080, players: 4 }).rows).toBe(1);
        const tall = versusLayout({ width: 768, height: 1366, players: 4 });
        expect(tall.rows).toBe(2);
        expect(tall.columns).toBe(2);
        expect(fits(tall, 768, 1366, 4)).toBe(true);
    });

    it('gives Last Standing room for its minimap', () => {
        const layout = versusLayout({
            width: 1600, height: 900, players: 2, infinity: true,
        });
        expect(fits(layout, 1600, 900, 2, true)).toBe(true);
        expect(layout.stationWidth).toBeGreaterThan(versusStation(layout.block).width);
    });
});
