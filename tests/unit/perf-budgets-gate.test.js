import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectIdleCells, validateBudgetsShape } from '../../scripts/perf-budgets-gate.mjs';

// SB-09 closure: the CI perf-budget gate's checkable pieces. The gate never
// measures on hosted runners; it lints perf-budgets.json (the file's own
// "visible and lintable, never silently unfalsifiable" contract) and re-checks
// committed steady-state baselines against the declared budgets.

describe('validateBudgetsShape', () => {
    it('accepts the real committed perf-budgets.json', () => {
        const doc = JSON.parse(readFileSync(new URL('../../perf-budgets.json', import.meta.url), 'utf8'));
        expect(validateBudgetsShape(doc)).toEqual([]);
    });

    it('accepts declared-but-pending (null) baselines', () => {
        const doc = { budgets: { timeToMenuReadyMs: { baseline: null, max: 4000 } } };
        expect(validateBudgetsShape(doc)).toEqual([]);
    });

    it('rejects a missing budgets object', () => {
        expect(validateBudgetsShape({})).toEqual(['missing top-level "budgets" object']);
        expect(validateBudgetsShape(null)).toEqual(['document is not an object']);
    });

    it('rejects non-numeric baseline/max values (silently unfalsifiable strings)', () => {
        const doc = { budgets: { frameP95Ms: { perSurface: { odyssey: 'TBD' } } } };
        const problems = validateBudgetsShape(doc);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('budgets.frameP95Ms.perSurface.odyssey');
    });

    it('rejects NaN/Infinity leaves', () => {
        const doc = { budgets: { snapshotDeltaWireBytesP95: { baseline: Infinity, max: 80 } } };
        expect(validateBudgetsShape(doc)).toHaveLength(1);
    });
});

describe('selectIdleCells', () => {
    it('gates only steady-state (*-idle.json) baseline cells', () => {
        const files = [
            'README.md',
            'baseline-rtx5080-cold-fresh-idle.json',
            'baseline-rtx5080-cold-fresh-load.json', // load = startup diagnostic, not gated
            'baseline-rtx5080-index.json',
            'baseline-igpu-warm-fresh-idle.json',
        ];
        expect(selectIdleCells(files)).toEqual([
            'baseline-igpu-warm-fresh-idle.json',
            'baseline-rtx5080-cold-fresh-idle.json',
        ]);
    });

    it('returns empty (honest SKIP upstream) when no idle cells exist', () => {
        expect(selectIdleCells(['baseline-rtx5080-cold-fresh-load.json', 'README.md'])).toEqual([]);
    });
});
