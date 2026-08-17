import { describe, expect, it } from 'vitest';
import {
    aggregate, iqrOverlaps, quantile, summarizePhase,
} from '../../scripts/lib/hitch-stats.mjs';

/**
 * The hitch harness can only be exercised on a working WebGPU device, and that device is exactly
 * what becomes unreliable when perf work goes wrong. So the arithmetic that turns runs into a
 * headline number is tested here, independently of ever being able to run it.
 */

describe('quantile', () => {
    it('interpolates between neighbours', () => {
        expect(quantile([0, 10], 0.5)).toBe(5);
        expect(quantile([0, 10, 20, 30], 0.5)).toBe(15);
        expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
        expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
    });

    it('returns the endpoints at q=0 and q=1, and null when empty', () => {
        expect(quantile([7, 8, 9], 0)).toBe(7);
        expect(quantile([7, 8, 9], 1)).toBe(9);
        expect(quantile([], 0.5)).toBeNull();
        expect(quantile(null, 0.5)).toBeNull();
    });
});

describe('aggregate', () => {
    const runs = (...v) => v.map((x) => ({ m: x }));

    it('reports median and IQR, not the mean', () => {
        // The real motivation: one 4680ms outlier among otherwise ~200ms frames must not
        // dictate the headline. The mean here is ~1096; the median is 250.
        const a = aggregate(runs(200, 210, 250, 300, 4680), (r) => r.m);
        expect(a.median).toBe(250);
        expect(a.max).toBe(4680);
        expect(a.n).toBe(5);
    });

    it('DROPS non-finite metrics so a failed run cannot pull the median toward "fast"', () => {
        const withFailures = [{ m: 900 }, { m: null }, { m: undefined }, { m: NaN }, { m: 1100 }];
        const a = aggregate(withFailures, (r) => r.m);
        expect(a.n).toBe(2);
        expect(a.median).toBe(1000);
        // A 0-coercing implementation would report n=5 and a median of 0 — the exact failure
        // mode that would make a broken build look like a win.
        expect(a.median).not.toBe(0);
    });

    it('returns null when nothing measurable is present', () => {
        expect(aggregate([], (r) => r.m)).toBeNull();
        expect(aggregate([{ m: null }], (r) => r.m)).toBeNull();
    });
});

describe('summarizePhase', () => {
    const gaps = [
        { ms: 60, phase: 'forward' },
        { ms: 140, phase: 'forward' },
        { ms: 590, phase: 'forward' },
        { ms: 999, phase: 'backward' },
    ];

    it('counts only the requested phase', () => {
        const f = summarizePhase(gaps, 'forward');
        expect(f.gaps50).toBe(3);
        expect(f.gaps100).toBe(2);
        expect(f.worstMs).toBe(590);
        expect(f.totalStallMs).toBe(790);
    });

    it('is all-zero for a clean phase — the backward-pass result that proved first-visit cost', () => {
        const empty = summarizePhase([], 'backward');
        expect(empty).toEqual({
            gaps50: 0, gaps100: 0, worstMs: 0, totalStallMs: 0,
        });
    });
});

describe('iqrOverlaps', () => {
    it('flags an unresolved comparison when the ranges overlap', () => {
        expect(iqrOverlaps({ p25: 100, p75: 300 }, { p25: 250, p75: 500 })).toBe(true);
        expect(iqrOverlaps({ p25: 100, p75: 200 }, { p25: 200, p75: 400 })).toBe(true); // touching
    });

    it('reports separation only when the ranges are disjoint', () => {
        expect(iqrOverlaps({ p25: 100, p75: 199 }, { p25: 200, p75: 400 })).toBe(false);
    });

    it('treats a missing aggregate as unresolved rather than as a win', () => {
        expect(iqrOverlaps(null, { p25: 1, p75: 2 })).toBe(true);
        expect(iqrOverlaps({ p25: 1, p75: 2 }, null)).toBe(true);
    });
});
