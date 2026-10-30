/**
 * The breathing bench's rule for which figures may be quoted (ADR-0016, docs/BREATHING_PERF_PASS_2026-10.md):
 * repeats of a reading agree when their p50 is within 5 % or two 65.536 µs timestamp steps and their
 * p95 within 10 % or two steps; the closest agreeing pair is the figure, a void reading never counts,
 * and repeats that drew different content (draws, buffer) give no figure at all.
 */
import { describe, expect, it } from 'vitest';
import { TIMESTAMP_STEP_MS, agrees, summarise } from '../../scripts/lib/breathing-bench-summary.mjs';

const reading = (repeat, p50, p95, extra = {}) => ({
    repeat,
    variant: 'base',
    dsf: 1,
    width: 1920,
    height: 1080,
    tier: 'High',
    world: 'forest-breath',
    mood: 0,
    lung: 'mid',
    maxFps: 0,
    vsync: false,
    drawCalls: 18,
    buffer: '1920x1080',
    gpu: { p50, p95 },
    cpu: { p50: 0.5, p95: 0.7 },
    parts: { scene: p50 * 0.9 },
    void: null,
    ...extra,
});

describe('breathing bench: agreeing repeats', () => {
    it('lets two figures differ by two timestamp steps exactly, but not by three', () => {
        const a = 18 * TIMESTAMP_STEP_MS;
        expect(agrees(a, a + 2 * TIMESTAMP_STEP_MS, 0.05)).toBe(true);
        expect(agrees(a, a + 3 * TIMESTAMP_STEP_MS, 0.05)).toBe(false);
        // Large figures use the share instead.
        expect(agrees(5.0, 5.2, 0.05)).toBe(true);
        expect(agrees(5.0, 5.4, 0.05)).toBe(false);
        expect(agrees(NaN, 1, 0.05)).toBe(false);
    });

    it('keeps the closest agreeing pair and leaves the outlier repeat out', () => {
        const [row] = summarise([reading(0, 2.49, 2.62), reading(1, 2.95, 3.4), reading(2, 2.49, 2.69)]);
        expect(row.agree).toBe(true);
        expect(row.gpuP50).toBeCloseTo(2.49, 6);
        expect(row.gpuP50s).toEqual([2.49, 2.95, 2.49]);
    });

    it('gives no figure when no pair agrees, when a repeat is void, or when the content differs', () => {
        expect(summarise([reading(0, 1.0, 1.2), reading(1, 1.3, 1.5)])[0].agree).toBe(false);
        expect(summarise([reading(0, 1.0, 1.2), reading(1, 1.0, 1.2, { void: 'window moved' })])[0].agree).toBe(false);
        expect(summarise([reading(0, 1.0, 1.2), reading(1, 1.0, 1.2, { drawCalls: 16 })])[0].agree).toBe(false);
    });

    it('keeps tiers, lungs, variants and capped runs apart', () => {
        const rows = summarise([
            reading(0, 1, 1.1), reading(1, 1, 1.1),
            reading(0, 1, 1.1, { lung: 'full' }), reading(0, 1, 1.1, { variant: '-canopy' }),
            reading(0, 1, 1.1, { maxFps: 60 }), reading(0, 1, 1.1, { vsync: true }),
        ]);
        expect(rows).toHaveLength(5);
        expect(rows.filter((row) => row.agree)).toHaveLength(1);
    });
});
