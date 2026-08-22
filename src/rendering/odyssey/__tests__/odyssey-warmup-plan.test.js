import { describe, expect, it } from 'vitest';
import {
    ODYSSEY_MOTION_WARM_SAMPLES,
    buildChapterWarmSamples,
    buildJourneyWarmSamples,
    buildMotionWarmSamples,
    buildPointWarmSamples,
    buildRenderWarmOrder,
} from '../odyssey-warmup-plan.js';
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

    it('builds a single current-position warm-up sample', () => {
        expect(buildPointWarmSamples({ position: 0.42 })).toEqual([0.42]);
        expect(buildPointWarmSamples({ position: -1 })).toEqual([0]);
        expect(buildPointWarmSamples({ position: 2 })).toEqual([1]);
        expect(buildPointWarmSamples({ position: Number.NaN })).toEqual([0]);
    });
});

describe('buildRenderWarmOrder (post-reveal background render-warm sweep)', () => {
    // REGRESSION (2026-08-17): the sweep used to enumerate 1..total unconditionally. Under One
    // World (the DEFAULT) chapters 2-5 are suppressed and never created, so the sweep burned
    // 30 x 300ms = 9s waiting for EACH of them — ~36s — and chapters 6-8 were never warmed
    // before the player scrolled into them. Asserting the sweep's INPUT SET is the point: the
    // bug was invisible because nothing checked which chapters were enqueued.
    it('never enqueues a suppressed chapter', () => {
        const order = buildRenderWarmOrder({ total: 8, focus: 1, suppressed: [2, 3, 4, 5] });
        expect(order).not.toContain(2);
        expect(order).not.toContain(3);
        expect(order).not.toContain(4);
        expect(order).not.toContain(5);
        expect(order).toEqual([1, 6, 7, 8]);
    });

    it('accepts a Set of suppressed ids (the shape ChapterEnvironmentManager exposes)', () => {
        const order = buildRenderWarmOrder({ total: 8, focus: 1, suppressed: new Set([2, 3, 4, 5]) });
        expect(order).toEqual([1, 6, 7, 8]);
    });

    it('visits chapters nearest the player first so the sweep warms what is about to be reached', () => {
        expect(buildRenderWarmOrder({ total: 8, focus: 6, suppressed: [2, 3, 4, 5] })).toEqual([6, 7, 8, 1]);
        expect(buildRenderWarmOrder({ total: 5, focus: 3 })).toEqual([3, 2, 4, 1, 5]);
    });

    it('warms every chapter when nothing is suppressed (legacy diorama path)', () => {
        expect(buildRenderWarmOrder({ total: 8, focus: 1 }).sort((a, b) => a - b))
            .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('returns an empty order rather than looping when every chapter is suppressed', () => {
        expect(buildRenderWarmOrder({ total: 4, focus: 1, suppressed: [1, 2, 3, 4] })).toEqual([]);
        expect(buildRenderWarmOrder({ total: 0 })).toEqual([]);
        expect(buildRenderWarmOrder()).toEqual([]);
    });
});

describe('buildMotionWarmSamples (Phase A — the traverse band)', () => {
    // The measured first-visible-frame reveals the scrub exists to cover (masterplan F1).
    const REVEALS = [
        { name: 'steam quench', p: 0.0049 },
        { name: 'lava fall', p: 0.0306 },
        { name: 'One World act gate', p: 0.0427 },
        { name: 'breach seam band start', p: 0.043 },
        { name: 'forest chunk uploads', p: 0.19 },
    ];

    it('covers every measured reveal: some sample lies AT or PAST each threshold', () => {
        const samples = buildMotionWarmSamples({ position: 0 });
        REVEALS.forEach(({ name, p }) => {
            const covering = samples.find((s) => s >= p);
            expect(covering, `${name} (p=${p}) must be covered`).toBeDefined();
        });
        // And the scrub actually crosses each threshold rather than jumping the whole band
        // in one step — no gap between consecutive samples exceeds 0.04 inside the band.
        for (let i = 1; i < samples.length; i += 1) {
            if (samples[i] <= 0.1) expect(samples[i] - samples[i - 1]).toBeLessThanOrEqual(0.04);
        }
    });

    it('starts at the reveal position and ascends', () => {
        const samples = buildMotionWarmSamples({ position: 0 });
        expect(samples[0]).toBe(0);
        expect([...samples].sort((a, b) => a - b)).toEqual(samples);
    });

    it('drops authored points already BEHIND a mid-band reveal position', () => {
        const samples = buildMotionWarmSamples({ position: 0.04 });
        expect(samples[0]).toBe(0.04);
        expect(samples.every((s) => s >= 0.04)).toBe(true);
        expect(samples).toContain(0.045);
    });

    it('uses a relative sweep for a deep resume — authored early points are far behind', () => {
        const samples = buildMotionWarmSamples({ position: 0.6 });
        expect(samples[0]).toBe(0.6);
        expect(samples.every((s) => s >= 0.6 && s <= 0.81)).toBe(true);
        expect(samples.length).toBeGreaterThanOrEqual(4);
    });

    it('clamps a resume near the journey end instead of sampling past 1', () => {
        const samples = buildMotionWarmSamples({ position: 0.95 });
        expect(samples.every((s) => s <= 1)).toBe(true);
        expect(samples[samples.length - 1]).toBe(1);
    });

    it('fails safe on garbage input — a plain point sample, never a throw', () => {
        expect(buildMotionWarmSamples({ position: Number.NaN })[0]).toBe(0);
        expect(buildMotionWarmSamples({})[0]).toBe(0);
    });

    it('keeps the scrub bounded — this runs behind the overlay, not forever', () => {
        expect(buildMotionWarmSamples({ position: 0 }).length).toBeLessThanOrEqual(
            ODYSSEY_MOTION_WARM_SAMPLES.length + 1,
        );
    });
});
