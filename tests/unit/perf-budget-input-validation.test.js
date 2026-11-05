import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateBudgetsShape } from '../../scripts/perf-budgets-gate.mjs';

const roots = [];
const comparePath = fileURLToPath(new URL('../../scripts/odyssey-perf-compare.mjs', import.meta.url));
const gatePath = fileURLToPath(new URL('../../scripts/perf-budgets-gate.mjs', import.meta.url));
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'serenity-perf-input-'));
    roots.push(root);
    return root;
}

describe('performance budget input validation', () => {
    it.each([null, false, 0, ''])('fails the CLI for invalid JSON document %j', (document) => {
        const root = fixture();
        mkdirSync(path.join(root, 'scripts'));
        copyFileSync(comparePath, path.join(root, 'scripts/odyssey-perf-compare.mjs'));
        writeFileSync(path.join(root, 'perf-budgets.json'), JSON.stringify(document));
        const result = spawnSync(process.execPath, [gatePath], { cwd: root, encoding: 'utf8' });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('shape problems');
    });

    it('rejects arrays as document or budgets objects', () => {
        expect(validateBudgetsShape([])).toContain('document is not an object');
        expect(validateBudgetsShape({ budgets: [] })).toContain('missing top-level "budgets" object');
    });

    it.each([null, '', false, []])('does not turn an invalid aggregate median %j into zero', (median) => {
        const root = fixture();
        const session = {
            aggregate: { metrics: { 'frame.p95': { count: 0, median } } },
            runs: [{ targetFrameRate: 60, browser: { perf: { frameTimeSummary: { p95: 20 } } } }],
        };
        const sessionPath = path.join(root, 'session.json');
        const budgetsPath = path.join(root, 'budgets.json');
        writeFileSync(sessionPath, JSON.stringify(session));
        writeFileSync(budgetsPath, JSON.stringify({ budgets: { frameP95Ms: { maxPerTier: { '60hz': 16.6 } } } }));
        const result = spawnSync(process.execPath, [comparePath, '--before', sessionPath, '--after', sessionPath, '--budgets', budgetsPath, '--fail-on-regression'], { encoding: 'utf8' });
        expect(result.status, result.stdout).toBe(1);
        expect(result.stderr).toContain('Budget regression: frame.p95');
    });
});
