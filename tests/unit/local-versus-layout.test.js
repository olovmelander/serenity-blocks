import { describe, expect, it } from 'vitest';
import { versusLayout, versusStation } from '../../src/ui/local-versus-layout.js';

const fits = (layout, width, height, players, infinity = false) => {
    const station = versusStation(layout.block, layout.queue, infinity);
    const columns = Math.ceil(players / layout.rows);
    const totalWidth = columns * station.width + (columns - 1) * layout.gap + 2 * layout.inset;
    const totalHeight = layout.top + layout.rows * station.height + (layout.rows - 1) * 20 + layout.inset;
    return totalWidth <= width && totalHeight <= height;
};

describe('local versus layout', () => {
    it('puts the queue beside the board when height is short (two players, wide window)', () => {
        const layout = versusLayout({ width: 1920, height: 1080, players: 2 });
        expect(layout.queue).toBe('side');
        expect(layout.rows).toBe(1);
        // Larger than the old 40 px blocks the queue-on-top layout allowed.
        expect(layout.block).toBeGreaterThanOrEqual(44);
    });

    it('puts the queue above the board when width is short (four players)', () => {
        const layout = versusLayout({ width: 1920, height: 1080, players: 4 });
        expect(layout.queue).toBe('top');
        expect(layout.columns).toBe(4);
        expect(layout.block).toBeGreaterThanOrEqual(38);
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

    it('gives Last Standing the queue above and room for its minimap', () => {
        const layout = versusLayout({
            width: 1600, height: 900, players: 2, infinity: true,
        });
        expect(layout.queue).toBe('top');
        expect(fits(layout, 1600, 900, 2, true)).toBe(true);
    });
});
