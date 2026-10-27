#!/usr/bin/env node
/**
 * Theme fleet bench: every theme played in the real game, one fresh Electron per theme.
 *
 *   node scripts/theme-fleet-bench.mjs --base-url=http://127.0.0.1:4317 --themes=all \
 *        --quality=High --tag=base
 *
 * Serve a production build made with VITE_DEV_HARNESS=1 (the storms need the harness's
 * gameplay-event handle): `VITE_DEV_HARNESS=1 npx vite build --outDir <dir>` then
 * `npx vite preview --outDir <dir> --port <p> --strictPort`.
 *
 * Per theme it writes <out>/<tag>/cells/<theme>.json (raw) and, at the end, summary.json and
 * table.md (frame rate at rest and in storms, frame-time p95/p99, main-thread and GPU ms per
 * frame, load times cold and warm, the longest load freeze). Defaults match the owner's laptop:
 * a 1707x1067 window at scale 1.5 (2560x1600 at 150 %), vsync and the frame-rate limit off
 * (`--vsync=1` measures the panel's real cadence instead), the game's target frame rate unlimited.
 *
 * Options: --themes=a,b|all  --skip=a,b  --quality=High  --target-fps=0  --vsync=0  --anchor=nimbus-veil
 *   --width=1707 --height=1067 --scale=1.5  --rest-ms --storm-ms --gpu-ms --intro-ms
 *   --profile=1 (CPU profile of storm 1)  --low-power=1 (the integrated GPU)  --query=k=v,k2=v2
 *   --switches=name,name:value (extra Chromium switches)  --skip-existing=1  --no-second-visit=1  --shots=0  --out=reports/theme-fleet-bench
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { getThemeIds } from '../src/themes/theme-registry.js';
import { summarizeCell } from './lib/theme-fleet-bench-page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function parseArgs(argv) {
    const o = {};
    for (const a of argv) {
        const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
        if (m) o[m[1]] = m[2] === undefined ? '1' : m[2];
    }
    return o;
}

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export function buildTable(rows, { budgetMs }) {
    const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
    const sec = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(2) : '-');
    const lines = [
        '| Theme | Rest fps | Storm fps (worst) | Rest p99 / storm p99 ms | Main thread ms | GPU busy ms (util %) | Limit | Draws | Cold: shown / full s | Cold freeze ms | Warm: shown s | Warm freeze ms |',
        '|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|',
    ];
    for (const r of rows) {
        if (!r.ok) { lines.push(`| ${r.theme} | error: ${r.error} |||||||||||`); continue; }
        const rest = r.rest || {};
        const storms = [r.storm1, r.storm2].filter((x) => x && Number.isFinite(x.fps));
        const worst = storms.length ? storms.reduce((a, b) => (a.fps <= b.fps ? a : b)) : {};
        const stormP99 = storms.length ? Math.max(...storms.map((x) => x.p99 || 0)) : null;
        const l1 = r.load1 || {}; const l2 = r.load2 || {};
        const limit = worst.limit && worst.limit !== 'ok' ? `storm: ${worst.limit}` : (rest.limit || '-');
        lines.push(`| ${r.theme} | ${f(rest.fps, 0)} | ${f(worst.fps, 0)} | ${f(rest.p99, 2)} / ${f(stormP99, 2)} | ${f(rest.busyP50, 2)} / ${f(worst.busyP50, 2)} | ${f(rest.gpuMsEst, 2)} (${f(rest.gpuUtil?.util, 0)}) / ${f(worst.gpuMsEst, 2)} (${f(worst.gpuUtil?.util, 0)}) | ${limit} | ${f(rest.draws?.p50, 0)} | ${sec(l1.shown)} / ${sec(l1.full)} | ${f(l1.longestFrameMs, 0)} | ${sec(l2.shown)} | ${f(l2.longestFrameMs, 0)} |`);
    }
    lines.push('', `Frame budget ${budgetMs.toFixed(2)} ms (${(1000 / budgetMs).toFixed(0)} fps). Main thread and GPU columns read rest / worst storm. GPU busy = nvidia-smi utilization x frame time. Limit: ok = holds the budget; gpu = GPU >= 90 % busy; main = page main thread fills the frame; other = GPU process / compositor. "Freeze" = the longest frame during the in-play switch.`);
    return lines.join('\n');
}

async function runWorker(specPath, timeoutMs) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    return new Promise((resolve) => {
        const child = spawn(electronPath, [path.join(here, 'theme-fleet-bench-worker.mjs'), `--spec=${specPath}`], {
            env, stdio: ['ignore', 'pipe', 'pipe'],
        });
        const tail = [];
        const keep = (d) => {
            for (const line of d.toString().split(/\r?\n/)) {
                if (!line.trim()) continue;
                if (line.includes('[bench-worker')) process.stdout.write(`  ${line}\n`);
                tail.push(line);
                if (tail.length > 40) tail.shift();
            }
        };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
        child.on('exit', (code) => { clearTimeout(timer); resolve({ code, tail }); });
    });
}

async function main() {
    const a = parseArgs(process.argv.slice(2));
    if (!a['base-url']) {
        console.error('--base-url=<preview server> is required');
        process.exit(2);
    }
    const all = getThemeIds();
    const skip = new Set((a.skip || '').split(',').filter(Boolean));
    const themes = (!a.themes || a.themes === 'all' ? all : a.themes.split(',')).filter((t) => !skip.has(t));
    const unknown = themes.filter((t) => !all.includes(t));
    if (unknown.length) { console.error('unknown themes:', unknown.join(', ')); process.exit(2); }

    const tag = a.tag || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const outRoot = path.resolve(root, a.out || 'reports/theme-fleet-bench', tag);
    const cellsDir = path.join(outRoot, 'cells');
    const shotsDir = a.shots === '0' ? null : path.join(outRoot, 'shots');
    fs.mkdirSync(cellsDir, { recursive: true });
    const targetFps = num(a['target-fps'], 0);
    const budgetMs = 1000 / num(a['budget-fps'], 240);
    const anchor = a.anchor || 'nimbus-veil';
    const altAnchor = a['alt-anchor'] || 'astral-weave';
    const query = Object.fromEntries((a.query || '').split(',').filter(Boolean).map((kv) => kv.split('=')));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-bench-'));

    const meta = {
        tag, baseUrl: a['base-url'], quality: a.quality || 'High', targetFps, vsync: a.vsync === '1',
        size: [num(a.width, 1707), num(a.height, 1067)], scale: num(a.scale, 1.5), anchor, query,
        lowPowerGpu: a['low-power'] === '1', switches: a.switches || '', startedAt: new Date().toISOString(), host: os.hostname(),
        cpu: os.cpus()[0]?.model,
    };
    fs.writeFileSync(path.join(outRoot, 'meta.json'), JSON.stringify(meta, null, 2));
    console.log(`[bench] ${themes.length} themes -> ${outRoot}`);

    for (const [i, themeId] of themes.entries()) {
        const outPath = path.join(cellsDir, `${themeId}.json`);
        if (a['skip-existing'] === '1' && fs.existsSync(outPath)) {
            try { if (!JSON.parse(fs.readFileSync(outPath, 'utf8')).error) continue; } catch { /* rerun */ }
        }
        const spec = {
            themeId,
            anchorTheme: themeId === anchor ? altAnchor : anchor,
            baseUrl: a['base-url'],
            quality: meta.quality,
            targetFps,
            vsync: meta.vsync,
            width: meta.size[0],
            height: meta.size[1],
            scaleFactor: meta.scale,
            lowPowerGpu: meta.lowPowerGpu,
            extraSwitches: Object.fromEntries((a.switches || '').split(',').filter(Boolean).map((kv) => { const i = kv.indexOf(':'); return i < 0 ? [kv, true] : [kv.slice(0, i), kv.slice(i + 1)]; })),
            userDataDir: path.join(scratch, `${themeId}-${Date.now()}`),
            outPath,
            shotDir: shotsDir,
            profile: a.profile === '1',
            profileLoad: a['profile-load'] === '1',
            query,
            introWaitMs: num(a['intro-ms'], 12_000),
            restMs: num(a['rest-ms'], 6000),
            stormMs: num(a['storm-ms'], 8000),
            gpuMs: num(a['gpu-ms'], 4000),
            gpuWindow: a['gpu-window'] === '1',
            secondVisit: a['no-second-visit'] !== '1',
            evalAfterLoad: a['eval-file'] ? fs.readFileSync(path.resolve(a['eval-file']), 'utf8') : null,
            exitAfterEval: a['exit-after-eval'] === '1',
            hardTimeoutMs: num(a['hard-timeout-ms'], 240_000),
            evalTimeoutMs: num(a['eval-timeout-ms'], 60_000),
        };
        const specPath = path.join(scratch, `${themeId}.spec.json`);
        fs.writeFileSync(specPath, JSON.stringify(spec));
        const t0 = Date.now();
        console.log(`[bench] (${i + 1}/${themes.length}) ${themeId}`);
        const { code, tail } = await runWorker(specPath, spec.hardTimeoutMs + 20_000);
        if (!fs.existsSync(outPath)) {
            fs.writeFileSync(outPath, JSON.stringify({ themeId, quality: meta.quality, error: `worker-exit-${code}`, tail }));
        }
        const s = summarizeCell(JSON.parse(fs.readFileSync(outPath, 'utf8')), { budgetMs });
        console.log(`[bench]   ${themeId}: rest ${s.rest?.fps ?? '-'} fps, storms ${s.storm1?.fps ?? '-'} / ${s.storm2?.fps ?? '-'}, cold shown ${s.load1?.shown ?? '-'} ms, ${((Date.now() - t0) / 1000).toFixed(0)} s${s.error ? `, ERROR ${s.error}` : ''}`);
        try { fs.rmSync(spec.userDataDir, { recursive: true, force: true }); } catch { /* locked */ }
        await new Promise((r) => { setTimeout(r, num(a['cool-ms'], 3000)); });
    }

    const rows = [];
    for (const f of fs.readdirSync(cellsDir).filter((x) => x.endsWith('.json'))) {
        rows.push(summarizeCell(JSON.parse(fs.readFileSync(path.join(cellsDir, f), 'utf8')), { budgetMs }));
    }
    rows.sort((x, y) => (x.rest?.fps ?? -1) - (y.rest?.fps ?? -1));
    fs.writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify({ meta, rows }, null, 2));
    fs.writeFileSync(path.join(outRoot, 'table.md'), `${buildTable(rows, { budgetMs })}\n`);
    console.log(`[bench] done: ${path.join(outRoot, 'table.md')}`);
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* locked */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
