#!/usr/bin/env node
// SB-09 closure: make perf-budgets.json falsifiable in CI without fake
// measurements. GitHub-hosted runners cannot produce meaningful frame times
// (see .github/workflows/gpu-validation.yml header), so this gate never
// measures anything. Instead it enforces the parts that ARE checkable
// anywhere:
//
//  1. odyssey-perf-compare --self-test — proves the budget checker can still
//     fail (guards the gate itself against silent breakage).
//  2. perf-budgets.json structural lint — the file's own contract is
//     "visible and lintable, never silently unfalsifiable": it must parse,
//     have a budgets object, and every declared baseline/max/min must be a
//     finite number or null (null = declared-but-pending, allowed).
//  3. Committed-evidence check — every committed steady-state baseline cell
//     (reports/odyssey-perf/baseline-*-idle.json) must still satisfy the
//     declared budgets via `odyssey-perf-compare --fail-on-regression`.
//     This catches budget/baseline drift at PR time: tightening a budget
//     below the committed evidence, or committing a regressed baseline,
//     fails here. Only *-idle.json cells are gated — load cells include
//     startup/compile hitches and must not be held to the steady-state
//     frame budget (reports/odyssey-perf/README.md).
//
// No committed idle cells → honest SKIP (exit 0): budgets with null
// baselines are declared-but-pending, never a false red. Real frame-time
// gating on fresh captures stays on real hardware via
// `npm run perf:odyssey:nightly` (scripts/odyssey-perf-nightly.mjs).

import { spawnSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = process.cwd();
const COMPARE = path.join('scripts', 'odyssey-perf-compare.mjs');
const REPORTS_DIR = path.join(ROOT, 'reports', 'odyssey-perf');

/**
 * Structural lint for perf-budgets.json. Returns a list of problems
 * (empty = valid). Exported for unit tests.
 * @param {any} budgetsDoc parsed JSON document
 */
export function validateBudgetsShape(budgetsDoc) {
    const problems = [];
    if (!budgetsDoc || typeof budgetsDoc !== 'object') {
        return ['document is not an object'];
    }
    if (!budgetsDoc.budgets || typeof budgetsDoc.budgets !== 'object') {
        return ['missing top-level "budgets" object'];
    }

    const checkLeaf = (value, keyPath) => {
        if (value === null) return; // declared, baseline pending — allowed
        if (typeof value === 'number' && Number.isFinite(value)) return;
        problems.push(`${keyPath} must be a finite number or null, got: ${JSON.stringify(value)}`);
    };

    const walk = (node, keyPath) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
            const childPath = `${keyPath}.${key}`;
            if (['baseline', 'max', 'min'].includes(key)) {
                checkLeaf(value, childPath);
            } else if (typeof value === 'string' && /note|calibration|comment|description/i.test(key)) {
                // Prose fields — allowed. Strings under any OTHER key fall
                // through to the leaf check ("TBD" as a budget value is exactly
                // the silently-unfalsifiable state this lint exists to catch).
            } else if (value && typeof value === 'object') {
                walk(value, childPath);
            } else if (typeof value === 'number' || value === null) {
                // Bare numeric leaves (e.g. perSurface.odyssey, maxPerTier.60hz)
                checkLeaf(value, childPath);
            } else {
                problems.push(`${childPath} has unexpected type: ${typeof value}`);
            }
        }
    };
    walk(budgetsDoc.budgets, 'budgets');
    return problems;
}

/**
 * Committed steady-state cells: only *-idle.json baselines are budget-gated.
 * Exported for unit tests.
 * @param {string[]} fileNames names within reports/odyssey-perf
 */
export function selectIdleCells(fileNames) {
    return fileNames
        .filter((name) => /^baseline-.+-idle\.json$/.test(name))
        .sort();
}

function run(label, argv) {
    console.log(`\n[perf-budgets-gate] ${label}`);
    const result = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit' });
    return result.status === 0;
}

function main() {
    let ok = true;

    // 1. The gate can still fail (self-test proves both exit behaviors).
    if (!run('compare tool self-test', [COMPARE, '--self-test'])) {
        console.error('[perf-budgets-gate] FAIL: odyssey-perf-compare --self-test');
        ok = false;
    }

    // 2. Budgets file parses + structural lint.
    let budgetsDoc = null;
    try {
        budgetsDoc = JSON.parse(readFileSync(path.join(ROOT, 'perf-budgets.json'), 'utf8'));
    } catch (error) {
        console.error(`[perf-budgets-gate] FAIL: perf-budgets.json unreadable: ${error.message}`);
        ok = false;
    }
    if (budgetsDoc) {
        const problems = validateBudgetsShape(budgetsDoc);
        if (problems.length) {
            console.error('[perf-budgets-gate] FAIL: perf-budgets.json shape problems:');
            problems.forEach((p) => console.error(`  - ${p}`));
            ok = false;
        } else {
            console.log('[perf-budgets-gate] perf-budgets.json shape OK');
        }
    }

    // 3. Committed steady-state evidence still satisfies the declared budgets.
    let cells = [];
    try {
        cells = selectIdleCells(readdirSync(REPORTS_DIR));
    } catch {
        // Directory absent — treated as zero cells below.
    }
    if (!cells.length) {
        console.log('[perf-budgets-gate] SKIP: no committed steady-state baselines '
            + '(reports/odyssey-perf/baseline-*-idle.json) — budgets stay declared-but-pending. '
            + 'Capture one: npm run perf:odyssey:baseline -- --committed --tag <tag> --caches cold --scenario idle');
    }
    for (const cell of cells) {
        const cellPath = path.join(REPORTS_DIR, cell);
        const clean = run(`budget check vs committed ${cell}`, [
            COMPARE, '--before', cellPath, '--after', cellPath, '--fail-on-regression',
        ]);
        if (!clean) {
            console.error(`[perf-budgets-gate] FAIL: committed baseline ${cell} breaches perf-budgets.json `
                + '(budget tightened below evidence, or a regressed baseline was committed)');
            ok = false;
        }
    }

    if (!ok) {
        console.error('\n[perf-budgets-gate] FAIL');
        process.exitCode = 1;
        return;
    }
    console.log('\n[perf-budgets-gate] PASS');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
