/* eslint-disable no-console, no-await-in-loop */
/**
 * ODYSSEY HITCH BASELINE — one Electron PROCESS per measured run.
 *
 * WHY (2026-08-17): the in-process multi-run mode of odyssey-hitch-harness.mjs wedged this dev
 * machine twice ("GPU state invalid after WaitForGetOffsetInRange") — its iGPU has TDR form under
 * sustained WebGPU (memory: odyssey-capture-constraint), and stacking several windows x two full
 * journey traverses in ONE GPU process is exactly the forbidden workload. Every probe that ever
 * succeeded here ran as a single fresh process. So this orchestrator spawns the harness with
 * `--runs 1` once per measured run: full GPU-process teardown between runs, a crash poisons only
 * its own run (retried once), and Chromium's post-crash 3D-API domain-blocking resets with the
 * process.
 *
 * Protocol (the parts that make the numbers comparable):
 *  - variants interleaved (A,B,A,B,...), never blocked;
 *  - one DISCARDED warm-up spawn per variant first (fresh-build pipeline caches read as cold);
 *  - median + IQR only, failed runs excluded (never coerced to 0);
 *  - RESOLVED / NOT-RESOLVED verdict per metric from IQR overlap.
 *
 * Usage (preview server must already be up: npm run build && npx vite preview --port 4173):
 *   node scripts/odyssey-hitch-baseline.mjs --runs 5 \
 *     --variant "base=" --variant "candidate=odysseySomeFlag=1"
 * Defaults: runs 5, one "base=" variant, settle 12000, scroll 20000, end 0.8.
 */
import { spawn } from 'child_process';
import {
    mkdirSync, readFileSync, writeFileSync, rmSync,
} from 'fs';
import path from 'path';
import { aggregate, iqrOverlaps } from './lib/hitch-stats.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
    console.log(`odyssey-hitch-baseline — one Electron process per run; aggregates median/IQR.

  --runs N            measured runs per variant (default 5)
  --variant name=flags  repeatable (default: one "base=" variant)
  --port N            preview port (default 4173)
  --end P             forward scroll end progress (default 0.8)
  --scroll-ms MS      per-pass scroll duration (default 20000)
  --settle-ms MS      post-reveal idle dwell (default 12000)
  --spawn-timeout-ms MS  kill a wedged spawn (default 180000)
  --no-warmup         skip the discarded warm-up spawn per variant
  --out PATH          combined json (default artifacts/odyssey-hitch/baseline-<stamp>.json)
`);
    process.exit(0);
}

const ROOT = process.cwd();
const RUNS = Number(args.runs || 5);
const PORT = Number(args.port || 4173);
const END_P = Number(args.end || 0.8);
const SCROLL_MS = Number(args['scroll-ms'] || 20000);
const SETTLE_MS = Number(args['settle-ms'] || 12000);
const SPAWN_TIMEOUT_MS = Number(args['spawn-timeout-ms'] || 180000);
const WARMUP = args['no-warmup'] ? 0 : 1;
const VARIANTS = (args.variant ? [].concat(args.variant) : ['base=']).map((spec) => {
    const i = String(spec).indexOf('=');
    return i === -1
        ? { name: String(spec), flags: '' }
        : { name: String(spec).slice(0, i), flags: String(spec).slice(i + 1) };
});
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = args.out || path.join('artifacts', 'odyssey-hitch', `baseline-${STAMP}.json`);
const TMP_DIR = path.join('artifacts', 'odyssey-hitch', `tmp-${STAMP}`);

/**
 * Spawn one single-run harness process and return its parsed run record (or a failure record).
 * Retries once on failure — with process isolation a retry is meaningful, unlike in-process
 * where a GPU crash poisons everything after it.
 * @param {{name: string, flags: string}} variant variant under test
 * @param {string} tag 'warmup' | 'measured'
 * @param {number} index run index (-1 for warmup)
 * @returns {Promise<object>} run record
 */
async function spawnRun(variant, tag, index) {
    const outFile = path.join(TMP_DIR, `${variant.name}-${tag}-${index}.json`);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const label = `${variant.name}/${tag}${index >= 0 ? ` #${index + 1}` : ''}`;
        console.log(`[spawn${attempt > 1 ? ' retry' : ''}] ${label}`);
        const ok = await runProcess([
            'scripts/run-electron.mjs', 'scripts/odyssey-hitch-harness.mjs',
            '--runs', '1', '--no-warmup',
            '--variant', `${variant.name}=${variant.flags}`,
            '--port', String(PORT), '--end', String(END_P),
            '--scroll-ms', String(SCROLL_MS), '--settle-ms', String(SETTLE_MS),
            '--run-timeout-ms', String(Math.max(60000, SPAWN_TIMEOUT_MS - 30000)),
            '--out', outFile,
        ], SPAWN_TIMEOUT_MS);
        if (ok) {
            try {
                const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
                const run = (parsed.results || []).find((r) => r.tag === 'measured' && !r.failed);
                if (run) return { ...run, tag, spawnAttempt: attempt };
            } catch { /* fall through to retry */ }
        }
        console.log(`  ${label}: attempt ${attempt} produced no usable run`);
    }
    return { variant: variant.name, tag, failed: true };
}

/**
 * Run one child process to completion with a hard kill timeout.
 * @param {string[]} argv node args
 * @param {number} timeoutMs kill deadline
 * @returns {Promise<boolean>} true when the process exited 0
 */
function runProcess(argv, timeoutMs) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        const killer = setTimeout(() => {
            console.log('  spawn timed out — killing');
            try { child.kill('SIGKILL'); } catch { /* already gone */ }
            finish(false);
        }, timeoutMs);
        const tail = [];
        const keep = (chunk) => {
            for (const line of String(chunk).split('\n')) {
                if (/GPU state invalid|child-process-gone|render-process-gone|HARNESS FAILED|ERR_/.test(line)) {
                    tail.push(line.trim());
                }
            }
        };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        child.on('exit', (code) => {
            clearTimeout(killer);
            if (tail.length) tail.slice(0, 4).forEach((l) => console.log(`  ! ${l}`));
            finish(code === 0);
        });
        child.on('error', () => { clearTimeout(killer); finish(false); });
    });
}

function fmt(a) {
    return a
        ? `${String(a.median).padStart(6)}  [${a.p25}-${a.p75}]  (min ${a.min}, max ${a.max}, n=${a.n})`
        : '       - (no usable runs)';
}

async function main() {
    mkdirSync(TMP_DIR, { recursive: true });
    const results = [];

    for (let w = 0; w < WARMUP; w += 1) {
        for (const v of VARIANTS) results.push(await spawnRun(v, 'warmup', -1));
    }
    for (let i = 0; i < RUNS; i += 1) {
        for (const v of VARIANTS) results.push(await spawnRun(v, 'measured', i));
    }

    const measured = results.filter((r) => r.tag === 'measured' && !r.failed);
    const failed = results.filter((r) => r.tag === 'measured' && r.failed).length;
    const summary = {};
    console.log(`\n===== MEDIAN [IQR] over ${RUNS} target runs/variant (1 process per run) =====`);
    if (failed) console.log(`!! ${failed} measured run(s) failed after retry — excluded below.`);
    for (const v of VARIANTS) {
        const rs = measured.filter((r) => r.variant === v.name);
        const s = {
            boardInitMs: aggregate(rs, (r) => r.boardInitMs),
            boardVisibleMs: aggregate(rs, (r) => r.boardVisibleMs),
            fwdTotalStallMs: aggregate(rs, (r) => r.forward.totalStallMs),
            fwdGaps100: aggregate(rs, (r) => r.forward.gaps100),
            fwdWorstMs: aggregate(rs, (r) => r.forward.worstMs),
            bwdTotalStallMs: aggregate(rs, (r) => r.backward.totalStallMs),
            warmedAll: rs.filter((r) => r.renderWarmedAll).length,
            sweepComplete: rs.filter((r) => r.bgRenderWarmComplete).length,
            validationErrors: rs.reduce((a, r) => a + (r.validationErrors || 0), 0),
            usableRuns: rs.length,
        };
        summary[v.name] = s;
        console.log(`\n--- ${v.name} (flags: ${v.flags || 'none'})  usable ${rs.length}/${RUNS}`);
        console.log(`  board init ms      ${fmt(s.boardInitMs)}`);
        console.log(`  board visible ms   ${fmt(s.boardVisibleMs)}`);
        console.log(`  fwd stall total ms ${fmt(s.fwdTotalStallMs)}`);
        console.log(`  fwd gaps >100ms    ${fmt(s.fwdGaps100)}`);
        console.log(`  fwd worst gap ms   ${fmt(s.fwdWorstMs)}`);
        console.log(`  bwd stall total ms ${fmt(s.bwdTotalStallMs)}`);
        console.log(`  warmed-all ${s.warmedAll}/${rs.length}   sweep-complete ${s.sweepComplete}/${rs.length}`);
        console.log(`  validation errors  ${s.validationErrors}`);
    }

    if (VARIANTS.length > 1) {
        const base = VARIANTS[0];
        console.log(`\n===== RESOLVED vs "${base.name}"? (IQR overlap) =====`);
        for (const v of VARIANTS.slice(1)) {
            for (const m of ['fwdTotalStallMs', 'fwdGaps100', 'fwdWorstMs', 'boardVisibleMs']) {
                const a = summary[base.name]?.[m];
                const b = summary[v.name]?.[m];
                const overlap = iqrOverlaps(a, b);
                let dir = '';
                if (!overlap && a && b) dir = b.median < a.median ? ' — better' : ' — WORSE';
                console.log(`  ${v.name} ${m.padEnd(18)} ${overlap ? 'NOT RESOLVED (add runs)' : 'resolved'}${dir}`);
            }
        }
    }

    writeFileSync(OUT, JSON.stringify({
        stamp: STAMP,
        protocol: {
            runs: RUNS,
            endP: END_P,
            scrollMs: SCROLL_MS,
            settleMs: SETTLE_MS,
            isolation: 'process-per-run',
        },
        variants: VARIANTS,
        summary,
        results,
    }, null, 2));
    rmSync(TMP_DIR, { recursive: true, force: true });
    console.log(`\nwrote ${OUT}`);
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
        if (out[key] === undefined) out[key] = next;
        else out[key] = [].concat(out[key], next);
        i += 1;
    }
    return out;
}

main().catch((e) => { console.error('BASELINE FAILED', e); process.exit(1); });
