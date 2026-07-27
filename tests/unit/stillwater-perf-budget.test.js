import { readFileSync } from 'fs';

import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    evaluateStillwaterFrameBudget,
    validatePerSurfaceBudgets,
} from '../../scripts/stillwater-perf-budget.mjs';

const PERF_BUDGETS = JSON.parse(readFileSync(
    new URL('../../perf-budgets.json', import.meta.url),
    'utf8',
));
const validationHarnessSource = readFileSync(
    new URL('../../scripts/stillwater-wave8-validation.mjs', import.meta.url),
    'utf8',
);

describe('Stillwater calibrated performance budget', () => {
    it('keeps every per-surface entry scalar, finite, and non-negative or pending', () => {
        expect(validatePerSurfaceBudgets(PERF_BUDGETS)).toEqual({
            ok: true,
            errors: [],
        });
        expect(PERF_BUDGETS.budgets.frameP95Ms.perSurface.stillwater).toBe(6);
    });

    it('rejects a baseline regression even when the absolute tier ceiling passes', () => {
        const result = evaluateStillwaterFrameBudget({
            candidateP95Ms: 6.7,
            absoluteBudgetMs: 16.6,
            baselineP95Ms: 6,
            enforceBaseline: true,
        });
        expect(result).toMatchObject({
            ok: false,
            absolutePass: true,
            baselinePass: false,
        });
        expect(result.regressionBudgetMs).toBeCloseTo(6.6, 6);
    });

    it('passes only when both independently enforced gates pass', () => {
        expect(evaluateStillwaterFrameBudget({
            candidateP95Ms: 6.5,
            absoluteBudgetMs: 16.6,
            baselineP95Ms: 6,
            enforceBaseline: true,
        })).toMatchObject({
            ok: true,
            absolutePass: true,
            baselinePass: true,
        });
    });

    it('requires dense primary-metric coverage in serialized manual lanes', () => {
        expect(validationHarnessSource).toContain(
            'Math.floor((durationMs / 1_000) * 15)',
        );
        expect(validationHarnessSource).toContain(
            'Math.floor(referenceSamples * 0.95)',
        );
        expect(validationHarnessSource).toContain(
            'hasTimestampMetricCoverage(summary)',
        );
        expect(validationHarnessSource).toContain(
            'hasPrimaryMetricCoverage(idleSummary, CONFIG.idleMs)',
        );
        expect(validationHarnessSource).toContain(
            'hasPrimaryMetricCoverage(reactionSummary, CONFIG.reactionMs)',
        );
    });

    it('warms the production frame graph by elapsed time before each manual sample', () => {
        expect(validationHarnessSource).toContain(
            "parseDuration(ARGS['manual-warmup-ms'], 20000)",
        );
        expect(validationHarnessSource).toContain(
            "parseDuration(ARGS['manual-warmup-max-ms'], 60000)",
        );
        expect(validationHarnessSource).toContain(
            'warmupFrameIndex * targetFrameMs',
        );
        expect(validationHarnessSource).toContain(
            'manualWarmupMs: CONFIG.manualWarmupMs',
        );
        expect(validationHarnessSource).toContain(
            'neutral_warmup_stationary_and_comparable',
        );
        expect(validationHarnessSource).toContain(
            'deltaMs <= toleranceMs + comparisonEpsilonMs',
        );
        expect(validationHarnessSource).toContain(
            'target-paced-isolated-manual-production-frame',
        );
        expect(validationHarnessSource).toContain(
            'reactionSequence: CONFIG.reactionSequence',
        );
    });
});
