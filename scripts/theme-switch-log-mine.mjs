/**
 * Derive a per-theme first-entry phase decomposition from a committed
 * `capture:themes` run — zero GPU, zero new measurement.
 *
 * The 61-theme validation matrix (`scripts/validate-all-themes.mjs`) already commits, per theme,
 * a timestamped console log plus a `lifecycle.timings` block. Nobody had read the logs as a
 * timeline. They contain enough to split the first-entry wall clock into:
 *
 *   import   — the theme's dynamic chunk import
 *   device   — Dawn's `requestAdapter()` -> the theme's next log line. ONE-TIME PER PROCESS,
 *              not per theme: the second `requestAdapter()` in the same process costs 6-47 ms
 *              on 20 of the 24 themes that log the mark. Reported, never summed into a
 *              per-theme budget.
 *   nonDev   — everything else inside the theme's own start window: scene build + warm compile
 *   tail     — start-complete -> activation-complete
 *
 * plus the largest single silent gap in the start window and the two log lines that bracket it,
 * which is what identifies the dominant step without a new instrument.
 *
 * ADR-0016: these are DERIVED numbers from a single committed run (n = 1, Electron 38 on the
 * 82JU's Vega 8 iGPU — the harness passes no `force_high_performance_gpu`, so this is Lane B).
 * They rank; they do not budget. A budget cell needs the Stage-0 theme perf lane with n >= 3.
 *
 * Usage:
 *   node scripts/theme-switch-log-mine.mjs                 # table
 *   node scripts/theme-switch-log-mine.mjs --json          # full rows
 *   node scripts/theme-switch-log-mine.mjs --out <file>    # write a JSON cell
 */
import {
    readFileSync, readdirSync, writeFileSync, mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = path.join(ROOT, 'docs', 'theme-screenshots', 'logs');
const RESULTS = path.join(ROOT, 'docs', 'theme-screenshots', 'results');

const TS = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/;
// Dawn logs this from `requestAdapter()` when a caller passes `powerPreference` on Windows.
// Themes that do not pass it never emit the mark, so its ABSENCE means "not separable here",
// never "no device was created".
const ADAPTER_MARK = 'powerPreference option is currently ignored';

function readEvents(file) {
    const events = [];
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = TS.exec(line);
        if (m) events.push({ t: Date.parse(m[1]), line });
    }
    return events;
}

export function mineTheme(id, events, result) {
    const find = (needle, from = 0) => {
        for (let i = from; i < events.length; i += 1) if (events[i].line.includes(needle)) return i;
        return -1;
    };
    const span = (a, b) => ((a >= 0 && b >= a) ? events[b].t - events[a].t : null);

    const iSwitch = find(`switchTheme called: ${id}`);
    if (iSwitch < 0) return { id, error: 'no switchTheme line' };
    const iDisk = find(`Loading theme "${id}" from disk`, iSwitch);
    const iLoaded = find(`Theme loaded: ${id}`, iSwitch);
    const iLoadCall = find(`Calling loadTheme for: ${id}`, iSwitch);
    const iComplete = find(`[BaseTheme] Theme start complete: ${id}`, iSwitch);
    const iActive = find(`Theme activation complete: ${id}`, iSwitch);

    const adapterAt = [];
    events.forEach((e, i) => { if (e.line.includes(ADAPTER_MARK)) adapterAt.push(i); });
    const adapterGaps = adapterAt
        .map((i) => (i + 1 < events.length ? events[i + 1].t - events[i].t : null))
        .filter((v) => v !== null);
    const deviceMs = (adapterAt.length && adapterAt[0] > iLoadCall && adapterAt[0] < iComplete)
        ? adapterGaps[0] : null;

    let dominant = null;
    if (iLoadCall >= 0 && iComplete > iLoadCall) {
        let best = { ms: 0, after: null, before: null };
        for (let i = iLoadCall; i < iComplete; i += 1) {
            const gap = events[i + 1].t - events[i].t;
            if (gap > best.ms) best = { ms: gap, after: events[i].line, before: events[i + 1].line };
        }
        dominant = best;
    }

    const sceneMs = span(iLoadCall, iComplete);
    return {
        id,
        firstEntryMs: span(iSwitch, iActive),
        importMs: span(iDisk, iLoaded),
        sceneWindowMs: sceneMs,
        deviceMs,
        nonDeviceMs: sceneMs === null ? null : sceneMs - (deviceMs || 0),
        tailMs: span(iComplete, iActive),
        // Second `requestAdapter()` in the same process — the warm cost of device acquisition.
        deviceWarmMs: adapterGaps.length > 1 ? adapterGaps[1] : null,
        reEntryMs: result?.lifecycle?.timings?.secondTargetSelection ?? null,
        switchAwayMs: result?.lifecycle?.timings?.['cleanup-anchor'] ?? null,
        warnings: result?.console?.warningCount ?? null,
        errors: result?.console?.errorCount ?? null,
        clockDeprecations: events.filter((e) => e.line.includes('THREE.Clock: This module has been deprecated')).length,
        dominantGapMs: dominant?.ms ?? null,
        dominantGapAfter: dominant?.after ?? null,
        dominantGapBefore: dominant?.before ?? null,
    };
}

function mineAll() {
    const rows = [];
    for (const file of readdirSync(LOGS).filter((f) => f.endsWith('.log'))) {
        const id = file.replace(/\.log$/, '');
        let result = null;
        try { result = JSON.parse(readFileSync(path.join(RESULTS, `${id}.json`), 'utf8')); } catch { /* id/dir mismatch */ }
        rows.push(mineTheme(id, readEvents(path.join(LOGS, file)), result));
    }
    return rows.filter((r) => !r.error).sort((a, b) => (b.firstEntryMs || 0) - (a.firstEntryMs || 0));
}

function percentile(values, p) {
    const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
}

function main() {
    const rows = mineAll();
    const outIndex = process.argv.indexOf('--out');
    const cold = rows.map((r) => r.firstEntryMs);
    const warm = rows.map((r) => r.reEntryMs);
    const dev = rows.map((r) => r.deviceMs).filter(Number.isFinite);
    const devWarm = rows.map((r) => r.deviceWarmMs).filter(Number.isFinite);

    const summary = {
        themes: rows.length,
        firstEntryMs: { median: percentile(cold, 0.5), p90: percentile(cold, 0.9), max: percentile(cold, 1) },
        reEntryMs: { median: percentile(warm, 0.5), p90: percentile(warm, 0.9), max: percentile(warm, 1) },
        deviceInitMs: {
            observedOn: dev.length, median: percentile(dev, 0.5), min: percentile(dev, 0), max: percentile(dev, 1),
        },
        deviceInitWarmMs: {
            observedOn: devWarm.length, median: percentile(devWarm, 0.5), max: percentile(devWarm, 1),
        },
    };

    if (outIndex > 0 && process.argv[outIndex + 1]) {
        const out = path.resolve(process.argv[outIndex + 1]);
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, `${JSON.stringify({
            schemaVersion: 1,
            kind: 'theme-switch-log-mine',
            provenance: {
                derivedFrom: 'docs/theme-screenshots/{logs,results} — capture:themes run 2026-08-21',
                machine: 'Legion 82JU, Electron 38, DEFAULT adapter = Radeon Vega 8 iGPU (Lane B): the theme harness passes no force_high_performance_gpu',
                protocol: 'n=1, one fresh Electron per theme, anchor theme = forest (no 3D)',
                admissibility: 'ADR-0016: derived from a single committed run. Ranks, does not budget.',
            },
            summary,
            rows,
        }, null, 2)}\n`);
        console.log(`wrote ${out}`);
        return;
    }

    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ summary, rows }, null, 2));
        return;
    }

    const n = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '-');
    console.log('theme'.padEnd(21) + ['cold', 'import', 'device', 'nonDev', 'reEntry', 'devWarm', 'away'].map((h) => h.padStart(8)).join(''));
    for (const r of rows) {
        console.log(r.id.padEnd(21)
            + n(r.firstEntryMs).padStart(8) + n(r.importMs).padStart(8) + n(r.deviceMs).padStart(8)
            + n(r.nonDeviceMs).padStart(8) + n(r.reEntryMs).padStart(8) + n(r.deviceWarmMs).padStart(8)
            + n(r.switchAwayMs).padStart(8));
    }
    console.log(`\n${JSON.stringify(summary, null, 2)}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
