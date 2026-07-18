#!/usr/bin/env node
// Odyssey perf compare (audit OD-01 budget consumer).
// - Compares two session JSONs (old flat single-run shape OR the v2
//   { manifest, aggregate, runs } shape — aggregate medians win when present).
// - --fail-on-regression: checks the candidate (--after) against
//   perf-budgets.json (override with --budgets): exceeds a declared `max` →
//   FAIL; no max but a declared baseline and candidate > baseline * 1.10 →
//   FAIL; null/absent baseline → SKIPPED (no baseline), NEVER a failure.
// - --self-test: proves both exit behaviors on built-in fixtures (all-null
//   budgets pass; a >10%-over-baseline candidate fails).
import { readFile } from 'fs/promises';
import path from 'path';

const REGRESSION_TOLERANCE = 1.10; // candidate may exceed a bare baseline by 10%

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const raw = token.slice(2);
        const [key, inline] = raw.split('=', 2);
        const normalized = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (inline !== undefined) {
            out[normalized] = inline;
        } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
            out[normalized] = argv[i + 1];
            i += 1;
        } else {
            out[normalized] = true;
        }
    }
    return out;
}

function requiredPath(name) {
    if (!args[name]) {
        throw new Error(`Missing --${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    }
    return path.resolve(String(args[name]));
}

async function readJson(file) {
    return JSON.parse(await readFile(file, 'utf8'));
}

function numberAt(obj, pathParts) {
    let current = obj;
    for (const part of pathParts) {
        current = current?.[part];
    }
    if (current === null || current === undefined || current === '') return null;
    const number = Number(current);
    return Number.isFinite(number) ? number : null;
}

/** A session file is either the legacy flat single-run payload or the v2
 * { manifest, aggregate, runs } shape. Normalize to { flat, aggregate }. */
function normalizeSession(session) {
    if (session && Array.isArray(session.runs)) {
        return {
            flat: session.runs[0] ?? null,
            aggregate: session.aggregate?.metrics ?? null,
            targetFrameRate: numberAt(session, ['manifest', 'session', 'targetFrameRate'])
                ?? numberAt(session, ['runs', 0, 'targetFrameRate']),
        };
    }
    return {
        flat: session ?? null,
        aggregate: null,
        targetFrameRate: numberAt(session, ['targetFrameRate']),
    };
}

/** Read a named metric: aggregate median when present, else legacy flat path. */
function metricValue(normalized, name, flatParts) {
    const aggregate = normalized.aggregate?.[name];
    if (aggregate && Number.isFinite(Number(aggregate.median))) {
        return Number(aggregate.median);
    }
    if (name === 'spikes') {
        const spikes = normalized.flat?.browser?.perf?.spikes;
        return Array.isArray(spikes) ? spikes.length : null;
    }
    return numberAt(normalized.flat, flatParts);
}

const METRIC_DEFS = [
    { name: 'boardVisibleMs', flat: ['parsedConsole', 'boardVisibleMs'] },
    { name: 'startup.totalMs', flat: ['parsedConsole', 'startup', 'totalMs'] },
    { name: 'startup.warmupMs', flat: ['parsedConsole', 'startup', 'buckets', 'warmup'] },
    { name: 'frame.p50', flat: ['browser', 'perf', 'frameTimeSummary', 'p50'] },
    { name: 'frame.p95', flat: ['browser', 'perf', 'frameTimeSummary', 'p95'] },
    { name: 'frame.p99', flat: ['browser', 'perf', 'frameTimeSummary', 'p99'] },
    { name: 'frame.max', flat: ['browser', 'perf', 'frameTimeSummary', 'max'] },
    { name: 'overBudget', flat: ['browser', 'perf', 'frameTimeSummary', 'overBudget'] },
    { name: 'spikes', flat: ['browser', 'perf', 'spikes', 'length'] },
    { name: 'drawCalls.avg', flat: ['browser', 'perf', 'counters', 'callsAvg'] },
    { name: 'triangles.avg', flat: ['browser', 'perf', 'counters', 'trianglesAvg'] },
    { name: 'longTasks.count', flat: ['browser', 'perf', 'longTasks', 'count'] },
    { name: 'longTasks.totalMs', flat: ['browser', 'perf', 'longTasks', 'totalMs'] },
    { name: 'memory.usedJSHeapSizeMB', flat: [] },
];

function metricRows(before, after) {
    return METRIC_DEFS.map((def) => ({
        name: def.name,
        before: metricValue(before, def.name, def.flat),
        after: metricValue(after, def.name, def.flat),
    }));
}

function format(value) {
    if (value === null || value === undefined) return 'n/a';
    if (!Number.isFinite(Number(value))) return String(value);
    return Number(value).toFixed(Math.abs(Number(value)) >= 100 ? 0 : 2);
}

function delta(before, after) {
    if (before === null || after === null || before === undefined || after === undefined) return 'n/a';
    const diff = after - before;
    const pct = before !== 0 ? ` (${((diff / before) * 100).toFixed(1)}%)` : '';
    return `${diff >= 0 ? '+' : ''}${format(diff)}${pct}`;
}

// ── Budget consumer (perf-budgets.json) ─────────────────────────────────────

const TIER_BY_TARGET = { 60: '60hz', 120: '120hz', 144: '144hz' };

/** Map session metrics onto perf-budgets.json entries. Each check resolves a
 * budget baseline and/or max for a candidate session; unresolved values stay
 * null and the row is SKIPPED. */
function budgetChecks(budgets, candidate) {
    const b = budgets?.budgets ?? {};
    const checks = [];

    const tier = TIER_BY_TARGET[candidate.targetFrameRate] ?? null;
    checks.push({
        metric: 'frame.p95',
        budgetRef: `frameP95Ms.perSurface.odyssey${tier ? ` + maxPerTier.${tier}` : ''}`,
        baseline: finiteOrNull(b.frameP95Ms?.perSurface?.odyssey),
        max: tier ? finiteOrNull(b.frameP95Ms?.maxPerTier?.[tier]) : null,
    });

    return checks;
}

function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

/** Verdict for one budget row. Pure — unit of the --self-test. */
export function budgetVerdict({ candidate, baseline, max }) {
    if (candidate === null || candidate === undefined) return 'SKIPPED (no candidate)';
    if (max !== null && max !== undefined) {
        return candidate > max ? 'FAIL (exceeds max)' : 'PASS';
    }
    if (baseline !== null && baseline !== undefined) {
        return candidate > baseline * REGRESSION_TOLERANCE
            ? `FAIL (>${Math.round((REGRESSION_TOLERANCE - 1) * 100)}% over baseline)`
            : 'PASS';
    }
    return 'SKIPPED (no baseline)';
}

function runBudgetCheck(budgets, candidateSession) {
    const rows = budgetChecks(budgets, candidateSession).map((check) => {
        const candidate = metricValue(
            candidateSession,
            check.metric,
            METRIC_DEFS.find((def) => def.name === check.metric)?.flat ?? [],
        );
        return {
            ...check,
            candidate,
            verdict: budgetVerdict({ candidate, baseline: check.baseline, max: check.max }),
        };
    });

    console.log('\nBudget check (perf-budgets.json)');
    console.log('| metric | budget ref | baseline | max | candidate | verdict |');
    console.log('|---|---|---:|---:|---:|---|');
    rows.forEach((row) => {
        const cells = [row.metric, row.budgetRef, format(row.baseline), format(row.max), format(row.candidate), row.verdict];
        console.log(`| ${cells.join(' | ')} |`);
    });

    const failures = rows.filter((row) => row.verdict.startsWith('FAIL'));
    if (failures.length > 0) {
        console.error(`\nBudget regression: ${failures.map((row) => row.metric).join(', ')}`);
        return false;
    }
    return true;
}

// ── Self-test (acceptance: OD-01 plan §2, item 5) ───────────────────────────

function selfTest() {
    let ok = true;
    const assert = (condition, label) => {
        console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`);
        if (!condition) ok = false;
    };

    // 1. Null baseline + no max → SKIPPED, never a failure.
    assert(
        budgetVerdict({ candidate: 12, baseline: null, max: null }) === 'SKIPPED (no baseline)',
        'null baseline reports SKIPPED (no baseline)',
    );
    // 2. Baseline exists, candidate >10% over → FAIL.
    assert(
        budgetVerdict({ candidate: 12, baseline: 10, max: null }).startsWith('FAIL'),
        'candidate >10% over baseline FAILs',
    );
    // 3. Baseline exists, candidate within 10% → PASS.
    assert(
        budgetVerdict({ candidate: 10.9, baseline: 10, max: null }) === 'PASS',
        'candidate within 10% of baseline PASSes',
    );
    // 4. Max exists and candidate exceeds it → FAIL.
    assert(
        budgetVerdict({ candidate: 17, baseline: null, max: 16.6 }).startsWith('FAIL'),
        'candidate over max FAILs',
    );
    // 5. Max exists and candidate is under it → PASS.
    assert(
        budgetVerdict({ candidate: 15, baseline: null, max: 16.6 }) === 'PASS',
        'candidate under max PASSes',
    );
    // 6. Missing candidate metric → SKIPPED, never a failure.
    assert(
        budgetVerdict({ candidate: null, baseline: 10, max: 5 }) === 'SKIPPED (no candidate)',
        'missing candidate metric reports SKIPPED',
    );

    // End-to-end: fixture sessions through the real table/exit logic.
    const fixtureSession = (p95) => normalizeSession({
        manifest: { session: { targetFrameRate: 60 } },
        aggregate: { metrics: { 'frame.p95': { count: 1, median: p95 } } },
        runs: [{}],
    });
    const nullBudgets = { budgets: { frameP95Ms: { perSurface: { odyssey: null }, maxPerTier: {} } } };
    const baselineBudgets = { budgets: { frameP95Ms: { perSurface: { odyssey: 10 }, maxPerTier: {} } } };
    assert(
        runBudgetCheck(nullBudgets, fixtureSession(12)) === true,
        'end-to-end: all-null budgets exit clean',
    );
    assert(
        runBudgetCheck(baselineBudgets, fixtureSession(12)) === false,
        'end-to-end: candidate 12 vs baseline 10 (>10%) exits non-zero',
    );

    if (!ok) {
        console.error('\n[odyssey-perf-compare] self-test FAILED');
        process.exitCode = 1;
        return;
    }
    console.log('\n[odyssey-perf-compare] self-test passed');
}

async function main() {
    if (args.selfTest) {
        selfTest();
        return;
    }

    const beforeFile = requiredPath('before');
    const afterFile = requiredPath('after');
    const before = normalizeSession(await readJson(beforeFile));
    const after = normalizeSession(await readJson(afterFile));
    const rows = metricRows(before, after);

    console.log('Odyssey perf compare');
    console.log(`before: ${path.relative(process.cwd(), beforeFile)}`);
    console.log(`after:  ${path.relative(process.cwd(), afterFile)}\n`);
    console.log('| metric | before | after | delta |');
    console.log('|---|---:|---:|---:|');
    rows.forEach((row) => {
        console.log(`| ${row.name} | ${format(row.before)} | ${format(row.after)} | ${delta(row.before, row.after)} |`);
    });

    if (args.failOnRegression) {
        const budgetsFile = path.resolve(String(args.budgets || 'perf-budgets.json'));
        const budgets = await readJson(budgetsFile);
        const clean = runBudgetCheck(budgets, after);
        if (!clean) process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(`[odyssey-perf-compare] ${error.message}`);
    process.exitCode = 1;
});
