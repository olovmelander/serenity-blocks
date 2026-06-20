import { describe, expect, it } from 'vitest';
import { buildChapterWarmSamples, buildJourneyWarmSamples } from '../odyssey-warmup-plan.js';
import { getActiveOdysseyChapterPositions } from '../path-utils.js';

describe('buildJourneyWarmSamples (startup warm-up slimming)', () => {
    it('covers every internal seam, one interior sample per chapter, and both journey ends', () => {
        const chapterPositions = getActiveOdysseyChapterPositions();
        const samples = buildJourneyWarmSamples({ chapterPositions });

        // Journey ends.
        expect(samples[0]).toBe(0);
        expect(samples[samples.length - 1]).toBe(1);

        // Every internal boundary appears exactly (seam co-presence states).
        const internal = chapterPositions.filter((b) => b > 0.001 && b < 0.999);
        internal.forEach((b) => {
            expect(samples).toContain(b);
        });

        // One interior midpoint per chapter span.
        const stops = [0, ...internal.sort((a, b) => a - b), 1];
        for (let i = 0; i < stops.length - 1; i += 1) {
            expect(samples).toContain((stops[i] + stops[i + 1]) / 2);
        }

        // The whole point: drastically fewer renders than the old ~64-sample sweep.
        expect(samples.length).toBeLessThanOrEqual(2 * internal.length + 3);
        expect(samples.length).toBeLessThan(25);
    });

    it('returns a sorted, deduplicated, clamped list', () => {
        const samples = buildJourneyWarmSamples({
            chapterPositions: [0, 0.3, 0.3, 0.7, 1, NaN, -0.5, 1.5],
        });
        const sorted = [...samples].sort((a, b) => a - b);
        expect(samples).toEqual(sorted);
        expect(new Set(samples).size).toBe(samples.length);
        samples.forEach((s) => {
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThanOrEqual(1);
        });
        // 0, 0.15, 0.3, 0.5, 0.7, 0.85, 1
        expect(samples).toEqual([0, 0.15, 0.3, 0.5, 0.7, 0.85, 1]);
    });

    it('degrades to just the journey ends and one midpoint with no boundaries', () => {
        expect(buildJourneyWarmSamples({})).toEqual([0, 0.5, 1]);
        expect(buildJourneyWarmSamples()).toEqual([0, 0.5, 1]);
    });

    it('builds a local chapter-window sample set for capture-scoped warm-up', () => {
        const samples = buildChapterWarmSamples({
            chapterPositions: [0, 0.125, 0.25, 0.5, 1],
            chapterIds: [2, 3],
        });

        expect(samples).toEqual([0.125, 0.1875, 0.25, 0.375, 0.5]);
    });

    it('filters invalid capture chapter ids', () => {
        const samples = buildChapterWarmSamples({
            chapterPositions: [0, 0.25, 0.5, 1],
            chapterIds: [0, 2, 2, 99, Number.NaN],
        });

        expect(samples).toEqual([0.25, 0.375, 0.5]);
    });
});
