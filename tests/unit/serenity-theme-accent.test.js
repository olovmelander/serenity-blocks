import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import { accentFromPixels, groupAccent, knownAccent } from '../../src/ui/serenity-mode/serenity-theme-accent.js';
import { SerenityDrift } from '../../src/ui/serenity-mode/serenity-drift.js';

/**
 * Each theme lends its own light to the words over it, as each breathing world does: the most
 * vivid, bright hue in its artwork, made readable on a night shade.
 */

/** RGBA bytes for a picture made of [r, g, b, a, count] runs. */
function pixels(...runs) {
    const out = [];
    runs.forEach(([r, g, b, a, count]) => {
        for (let i = 0; i < count; i++) out.push(r, g, b, a);
    });
    return Uint8ClampedArray.from(out);
}

function lightness([r, g, b]) {
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

afterEach(() => vi.useRealTimers());

describe('a theme\'s accent', () => {
    it('is the vivid hue the artwork carries most of, not its dark ground', () => {
        // A night picture: mostly near-black blue, a band of magenta crystal, a little teal.
        const accent = accentFromPixels(pixels(
            [10, 12, 30, 255, 600],
            [220, 40, 180, 255, 140],
            [40, 200, 190, 255, 40],
        ));
        expect(accent).not.toBeNull();
        const [r, g, b] = accent;
        expect(r).toBeGreaterThan(g);
        expect(b).toBeGreaterThan(g);
    });

    it('is lifted to read on the night shades', () => {
        const accent = accentFromPixels(pixels([90, 20, 140, 255, 400]));
        expect(lightness(accent)).toBeGreaterThanOrEqual(0.64);
        expect(lightness(accent)).toBeLessThanOrEqual(0.82);
    });

    it('says nothing for a picture without colour, and ignores what is transparent', () => {
        expect(accentFromPixels(pixels([128, 128, 128, 255, 500], [20, 20, 20, 255, 500]))).toBeNull();
        expect(accentFromPixels(pixels([255, 0, 0, 0, 500]))).toBeNull();
    });

    it('falls back on the category\'s hue until the artwork has been read', () => {
        expect(groupAccent('forest')).toEqual([197, 241, 207]);
        expect(knownAccent('forest')).toEqual(groupAccent('forest'));
        expect(groupAccent('no-such-theme')).toEqual([184, 164, 255]);
    });
});

describe('how far drift has come', () => {
    it('reports the clock\'s progress toward the next theme, and nothing while held or off', () => {
        vi.useFakeTimers();
        const drift = new SerenityDrift({
            activeTheme: () => 'forest',
            pickNextTheme: () => 'aurora',
            themeForTrack: () => null,
            canUse: () => true,
            applyTheme: () => {},
        });
        expect(drift.progress()).toBeNull();
        drift.setPace('10');
        vi.advanceTimersByTime(2.5 * 60 * 1000);
        const { from, ms } = drift.progress();
        expect(from).toBeCloseTo(0.25, 2);
        expect(ms).toBe(7.5 * 60 * 1000);
        drift.hold('hub');
        expect(drift.progress()).toBeNull();
        drift.destroy();
    });
});
