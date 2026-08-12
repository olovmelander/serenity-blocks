import { describe, expect, it } from 'vitest';

import { DEFAULT_CAPACITY, PerfRing, percentileOf } from './perf-ring.js';

// Wave -1's exit criterion is a MEASUREMENT DISCIPLINE, which makes it exactly the kind of
// thing that should be a test rather than a comment: a ring that quietly grows, or a summary
// that quietly reports a mean, still looks like it is working.

describe('percentileOf', () => {
    it('is nearest-rank, so every result is a sample that actually occurred', () => {
        const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        expect(percentileOf(s, 0.50)).toBe(5);
        expect(percentileOf(s, 0.95)).toBe(10);
        expect(percentileOf(s, 0.99)).toBe(10);
        // No interpolation: 5.5 would be a frame nobody rendered.
        expect(s).toContain(percentileOf(s, 0.5));
    });

    it('handles the degenerate ends', () => {
        expect(percentileOf([], 0.5)).toBeNull();
        expect(percentileOf([42], 0.99)).toBe(42);
        expect(percentileOf([1, 2, 3], 0)).toBe(1);
        expect(percentileOf([1, 2, 3], 1)).toBe(3);
    });
});

describe('PerfRing', () => {
    it('is fixed-size — it overwrites rather than grows', () => {
        const ring = new PerfRing(8);
        for (let i = 0; i < 100; i += 1) ring.push(i);
        expect(ring.size).toBe(8);
        expect(ring.count).toBe(100);
        // The retained window is the LAST 8 samples (92..99), not the first.
        const s = ring.summarize();
        expect(s.min).toBe(92);
        expect(s.max).toBe(99);
    });

    it('reports no mean at all', () => {
        const ring = new PerfRing(4);
        [1, 2, 3, 4].forEach((v) => ring.push(v));
        const keys = Object.keys(ring.summarize());
        expect(keys).not.toContain('mean');
        expect(keys).not.toContain('avg');
        expect(keys).not.toContain('average');
        expect(keys.sort()).toEqual(['max', 'min', 'p50', 'p95', 'p99', 'samples']);
    });

    it('does not let a tail hide behind a typical frame — the reason mean is banned', () => {
        // 2 % of frames hitch. Real numbers: the p50/p99 pair from
        // reports/odyssey-perf/baseline-rtx5080-cold-fresh-load.json.
        const ring = new PerfRing(100);
        for (let i = 0; i < 98; i += 1) ring.push(5.9);
        ring.push(199.5);
        ring.push(199.5);
        const s = ring.summarize();
        expect(s.p50).toBe(5.9);
        expect(s.p99).toBe(199.5);
        // The mean here is 9.8 ms — a frame that never happened, and one that makes a pair of
        // 200 ms hitches read as a rounding error. That is the whole reason for the ban.
    });

    it('is honest about a single outlier: p99 misses it, max does not', () => {
        // Nearest-rank p99 over 100 samples is the 99th smallest, so ONE bad frame in 100 is
        // below it by construction. Worth pinning, because reading p99 as "the worst frame"
        // is how a reproducible hitch gets declared fixed.
        const ring = new PerfRing(100);
        for (let i = 0; i < 99; i += 1) ring.push(5.9);
        ring.push(199.5);
        const s = ring.summarize();
        expect(s.p99).toBe(5.9);
        expect(s.max).toBe(199.5);
    });

    it('drops non-finite samples instead of poisoning the percentiles', () => {
        const ring = new PerfRing(8);
        expect(ring.push(1)).toBe(true);
        expect(ring.push(null)).toBe(false);
        expect(ring.push(undefined)).toBe(false);
        expect(ring.push(NaN)).toBe(false);
        expect(ring.push(Infinity)).toBe(false);
        expect(ring.push(3)).toBe(true);
        expect(ring.size).toBe(2);
        expect(ring.summarize().p50).toBe(1);
    });

    it('summarizes correctly before the buffer has wrapped', () => {
        const ring = new PerfRing(50);
        [7, 3, 9, 1].forEach((v) => ring.push(v));
        const s = ring.summarize();
        expect(s.samples).toBe(4);
        expect(s.min).toBe(1);
        expect(s.max).toBe(9);
        expect(s.p50).toBe(3);
    });

    it('sorts numerically — a Float64Array default sort must not go lexicographic', () => {
        const ring = new PerfRing(8);
        [10, 9, 100, 2].forEach((v) => ring.push(v));
        const s = ring.summarize();
        // Lexicographic order would put 100 before 2 and report min 10 / max 9.
        expect(s.min).toBe(2);
        expect(s.max).toBe(100);
    });

    it('reset keeps the allocation but forgets the samples, for A/B runs', () => {
        const ring = new PerfRing(16);
        for (let i = 0; i < 20; i += 1) ring.push(i);
        ring.reset();
        expect(ring.size).toBe(0);
        expect(ring.summarize().p50).toBeNull();
        ring.push(42);
        expect(ring.summarize().p50).toBe(42);
    });

    it('rejects a capacity that would silently disable the buffer', () => {
        expect(() => new PerfRing(0)).toThrow(/positive integer/);
        expect(() => new PerfRing(-1)).toThrow(/positive integer/);
        expect(() => new PerfRing(2.5)).toThrow(/positive integer/);
        expect(new PerfRing().capacity).toBe(DEFAULT_CAPACITY);
    });

    it('allocates nothing on push, so it is safe in the render loop', () => {
        const ring = new PerfRing(64);
        // Structural proof rather than a heap probe: the backing stores are allocated once in
        // the constructor and push() only ever indexes into them.
        const buffer = ring._buffer;
        const scratch = ring._scratch;
        for (let i = 0; i < 500; i += 1) ring.push(i * 0.5);
        ring.summarize();
        expect(ring._buffer).toBe(buffer);
        expect(ring._scratch).toBe(scratch);
        expect(buffer.length).toBe(64);
    });
});
