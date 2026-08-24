/**
 * Aggregate the committed per-theme perf cells (reports/theme-perf/<theme>.json) into one
 * ranked table — Stage 3 of the fleet sweep.
 *
 * Pure reporting: reads cells, writes AGGREGATE.md + AGGREGATE.json. No GPU, no Electron.
 *
 * ADR-0016 discipline is carried through rather than smoothed over:
 *  - an inadmissible cell stays in the table, marked, with its reasons — it is never dropped,
 *    because a silently missing row reads as "covered" when it was not;
 *  - a null keeps its reason;
 *  - GPU deltas below 0.065536 ms are printed as "below resolution", never as 0.
 *
 * Usage:
 *   node scripts/theme-perf-aggregate.mjs
 *   node scripts/theme-perf-aggregate.mjs --dir reports/theme-perf --out reports/theme-perf
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU_QUANTUM_MS } from './lib/theme-perf-instrument.mjs';
import { rankThemePerfCells } from './lib/theme-perf-cell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argValue(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadCells(dir) {
    const cells = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        if (file.startsWith('AGGREGATE') || file.startsWith('switch-log-mine')) continue;
        try {
            const cell = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
            if (cell && cell.kind !== 'theme-switch-log-mine' && cell.theme) cells.push(cell);
        } catch (error) {
            console.warn(`[theme-perf-aggregate] skipped ${file}: ${error.message}`);
        }
    }
    return cells;
}

const n = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
/** A GPU figure under one timestamp tick is "below resolution", never "zero cost" (ADR-0016). */
const gpu = (v) => {
    if (!Number.isFinite(v)) return '—';
    return v < GPU_QUANTUM_MS ? `<${GPU_QUANTUM_MS}` : v.toFixed(3);
};

function markdown(cells) {
    const ranked = rankThemePerfCells(cells);
    const admissible = cells.filter((c) => c.admissible).length;

    let md = '# Theme perf lane — aggregate\n\n';
    md += `Cells: **${cells.length}**, admissible **${admissible}**, `
        + `inadmissible **${cells.length - admissible}** (kept and marked, never dropped).\n\n`;

    const adapters = [...new Set(cells
        .map((c) => c.adapter?.webglRendererString)
        .filter(Boolean))];
    if (adapters.length) {
        md += `Adapter(s) observed: ${adapters.map((a) => `\`${a}\``).join(', ')}\n\n`;
        if (adapters.length > 1) {
            md += '> ⚠️ More than one adapter across the run — these cells are NOT comparable with '
                + 'each other. Re-run the odd ones out.\n\n';
        }
    }

    md += '## Ranked — worst single pipeline compile first (the lava-lake signature)\n\n';
    md += '| # | theme | kind | worst pipeline ms | sync pipes | switch ms | first GPU frame ms '
        + '| idle wall p95 | cpu p95 | gpu p95 | draws | GC/s | adm |\n';
    md += '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|\n';
    ranked.forEach((r, i) => {
        md += `| ${i + 1} | ${r.theme} | ${r.kind ?? '—'} | ${n(r.worstPipelineMs, 0)} `
            + `| ${r.syncPipelines ?? '—'} | ${n(r.switchWallMs, 0)} `
            + `| ${n(r.firstFrameGpuCompleteMs, 0)} | ${n(r.idleWallP95, 2)} `
            + `| ${n(r.idleCpuP95, 2)} | ${gpu(r.idleGpuP95)} | ${r.drawCalls ?? '—'} `
            + `| ${n(r.gcPerSecond, 2)} | ${r.admissible ? '✓' : '✗'} |\n`;
    });

    const bad = cells.filter((c) => !c.admissible);
    if (bad.length) {
        md += '\n## Inadmissible cells, and why\n\n';
        for (const c of bad) {
            md += `- **${c.theme}** — ${(c.inadmissibleReasons || []).join('; ')}\n`;
        }
    }

    md += '\n## Worst single pipelines across the fleet\n\n';
    const rows = cells.flatMap((c) => (c.pipelines?.rows || [])
        .map((r) => ({ theme: c.theme, ...r })))
        .filter((r) => Number.isFinite(r.ms))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 25);
    md += '| theme | ms | material class | label |\n|---|---:|---|---|\n';
    for (const r of rows) {
        md += `| ${r.theme} | ${Math.round(r.ms)} | ${r.materialClass ?? `_${r.materialClassReason}_`} | \`${r.label}\` |\n`;
    }

    md += '\n## Sync pipeline creations (post-reveal stall candidates)\n\n';
    md += 'These carry `ms: null` by construction — the call returns before the GPU compiles.\n\n';
    md += '| theme | sync count | first at ms | labels (first 5) |\n|---|---:|---:|---|\n';
    for (const c of cells.filter((x) => (x.pipelines?.syncCount ?? 0) > 0)
        .sort((a, b) => b.pipelines.syncCount - a.pipelines.syncCount)) {
        const s = c.pipelines.syncRows || [];
        md += `| ${c.theme} | ${c.pipelines.syncCount} | ${n(s[0]?.atMs, 0)} `
            + `| ${s.slice(0, 5).map((r) => `\`${r.label}\``).join(' ')} |\n`;
    }

    md += '\n## Drift between the two visits (bounds how much of a delta is noise)\n\n';
    md += '| theme | gpu p50 Δ | wall p95 Δ | content match | void reason |\n|---|---:|---:|:--:|---|\n';
    for (const c of cells) {
        md += `| ${c.theme} | ${gpu(c.drift?.visitGpuP50DeltaMs)} | ${n(c.drift?.visitWallP95DeltaMs, 2)} `
            + `| ${c.content?.contentMatch === true ? '✓' : '✗'} | ${c.drift?.voidReason ?? '—'} |\n`;
    }

    md += '\n---\n\n';
    md += 'Notes carried from every cell:\n\n';
    for (const note of cells[0]?.notes || []) md += `- ${note}\n`;
    return md;
}

function main() {
    const dir = path.resolve(ROOT, argValue('dir', 'reports/theme-perf'));
    const out = path.resolve(ROOT, argValue('out', 'reports/theme-perf'));
    const cells = loadCells(dir);
    if (!cells.length) {
        console.error(`[theme-perf-aggregate] no cells in ${dir}`);
        process.exitCode = 1;
        return;
    }
    writeFileSync(path.join(out, 'AGGREGATE.md'), markdown(cells), 'utf8');
    writeFileSync(
        path.join(out, 'AGGREGATE.json'),
        `${JSON.stringify({
            schemaVersion: 1,
            cells: cells.length,
            admissible: cells.filter((c) => c.admissible).length,
            ranked: rankThemePerfCells(cells),
        }, null, 2)}\n`,
        'utf8',
    );
    console.log(`[theme-perf-aggregate] ${cells.length} cells -> ${path.relative(ROOT, out)}/AGGREGATE.{md,json}`);
}

main();
