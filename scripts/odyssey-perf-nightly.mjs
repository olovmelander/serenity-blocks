#!/usr/bin/env node
// SB-09 closure: the nightly perf-compare lane, run on REAL hardware (the
// RTX/iGPU dev machines — hosted CI cannot render meaningfully, see
// .github/workflows/gpu-validation.yml header and reports/odyssey-perf/README.md).
//
// One command:
//   npm run perf:odyssey:nightly            # auto-picks newest committed idle baseline
//   npm run perf:odyssey:nightly -- --baseline reports/odyssey-perf/baseline-rtx5080-cold-fresh-idle.json
//
// What it does:
//   1. Captures a fresh pinned steady-state cell (cold cache, idle scenario,
//      single run — multi-run in-process reloads crash some GPUs, see README)
//      into artifacts/odyssey/perf-nightly/<timestamp>/cold-idle.json via the
//      existing baseline orchestrator (which starts/stops its own dev server).
//   2. Runs odyssey-perf-compare --fail-on-regression: candidate vs the
//      committed baseline AND vs perf-budgets.json. Exit code is the verdict —
//      nonzero on regression, so a scheduler can alert on failure.
//
// Schedule it nightly on Windows (run from the repo root, adjust time):
//   schtasks /Create /TN "SerenityBlocksPerfNightly" /SC DAILY /ST 03:30 ^
//     /TR "cmd /c cd /d C:\Users\olovm\serenity-blocks && npm run perf:odyssey:nightly >> artifacts\odyssey\perf-nightly\nightly.log 2>&1"
//
// Notes: do NOT pass --hide (a hidden window throttles to 1 fps and poisons
// the numbers). On hybrid laptops confirm manifest.webglRenderer names the
// discrete GPU (Windows per-app graphics preference can override
// force_high_performance_gpu — README "Which physical GPU?").

import { spawnSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports', 'odyssey-perf');
const args = process.argv.slice(2);

function argValue(name) {
    const index = args.indexOf(`--${name}`);
    if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('--')) {
        return args[index + 1];
    }
    const inline = args.find((a) => a.startsWith(`--${name}=`));
    return inline ? inline.split('=').slice(1).join('=') : null;
}

function newestCommittedIdleBaseline() {
    let names = [];
    try {
        names = readdirSync(REPORTS_DIR).filter((n) => /^baseline-.+-idle\.json$/.test(n));
    } catch {
        return null;
    }
    if (!names.length) return null;
    return names
        .map((n) => path.join(REPORTS_DIR, n))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function run(argv) {
    const result = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit' });
    if (result.error) throw result.error;
    return result.status ?? 1;
}

function main() {
    const baseline = argValue('baseline')
        ? path.resolve(String(argValue('baseline')))
        : newestCommittedIdleBaseline();
    if (!baseline || !existsSync(baseline)) {
        console.error('[perf-nightly] No committed steady-state baseline found '
            + '(reports/odyssey-perf/baseline-*-idle.json). Capture one first:\n'
            + '  npm run perf:odyssey:baseline -- --committed --tag <machine-tag> --caches cold --scenario idle');
        process.exitCode = 1;
        return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(ROOT, 'artifacts', 'odyssey', 'perf-nightly', stamp);
    const candidate = path.join(outDir, 'cold-idle.json');

    console.log(`[perf-nightly] baseline:  ${path.relative(ROOT, baseline)}`);
    console.log(`[perf-nightly] capturing: ${path.relative(ROOT, candidate)}`);

    // 1. Fresh pinned steady-state capture (exploratory mode → gitignored artifacts).
    const captureStatus = run([
        path.join('scripts', 'odyssey-perf-baseline.mjs'),
        '--caches', 'cold',
        '--scenarios', 'idle',
        '--out-dir', outDir,
    ]);
    if (captureStatus !== 0 || !existsSync(candidate)) {
        console.error(`[perf-nightly] FAIL: capture did not produce ${path.relative(ROOT, candidate)} `
            + `(exit ${captureStatus})`);
        process.exitCode = 1;
        return;
    }

    // 2. Compare + budget gate; the exit code is the nightly verdict.
    const compareStatus = run([
        path.join('scripts', 'odyssey-perf-compare.mjs'),
        '--before', baseline,
        '--after', candidate,
        '--fail-on-regression',
    ]);
    if (compareStatus !== 0) {
        console.error('[perf-nightly] FAIL: regression vs committed baseline / perf-budgets.json');
        process.exitCode = 1;
        return;
    }
    console.log('[perf-nightly] PASS');
}

main();
