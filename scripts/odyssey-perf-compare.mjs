#!/usr/bin/env node
import { readFile } from 'fs/promises';
import path from 'path';

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
    const number = Number(current);
    return Number.isFinite(number) ? number : null;
}

function metricRows(before, after) {
    return [
        {
            name: 'boardVisibleMs',
            before: numberAt(before, ['parsedConsole', 'boardVisibleMs']),
            after: numberAt(after, ['parsedConsole', 'boardVisibleMs']),
        },
        {
            name: 'startup.totalMs',
            before: numberAt(before, ['parsedConsole', 'startup', 'totalMs']),
            after: numberAt(after, ['parsedConsole', 'startup', 'totalMs']),
        },
        {
            name: 'startup.warmupMs',
            before: numberAt(before, ['parsedConsole', 'startup', 'buckets', 'warmup']),
            after: numberAt(after, ['parsedConsole', 'startup', 'buckets', 'warmup']),
        },
        {
            name: 'frame.p50',
            before: numberAt(before, ['browser', 'perf', 'frameTimeSummary', 'p50']),
            after: numberAt(after, ['browser', 'perf', 'frameTimeSummary', 'p50']),
        },
        {
            name: 'frame.p95',
            before: numberAt(before, ['browser', 'perf', 'frameTimeSummary', 'p95']),
            after: numberAt(after, ['browser', 'perf', 'frameTimeSummary', 'p95']),
        },
        {
            name: 'frame.p99',
            before: numberAt(before, ['browser', 'perf', 'frameTimeSummary', 'p99']),
            after: numberAt(after, ['browser', 'perf', 'frameTimeSummary', 'p99']),
        },
        {
            name: 'frame.max',
            before: numberAt(before, ['browser', 'perf', 'frameTimeSummary', 'max']),
            after: numberAt(after, ['browser', 'perf', 'frameTimeSummary', 'max']),
        },
        {
            name: 'overBudget',
            before: numberAt(before, ['browser', 'perf', 'frameTimeSummary', 'overBudget']),
            after: numberAt(after, ['browser', 'perf', 'frameTimeSummary', 'overBudget']),
        },
        {
            name: 'spikes',
            before: before?.browser?.perf?.spikes?.length ?? null,
            after: after?.browser?.perf?.spikes?.length ?? null,
        },
        {
            name: 'drawCalls.avg',
            before: numberAt(before, ['browser', 'perf', 'counters', 'callsAvg']),
            after: numberAt(after, ['browser', 'perf', 'counters', 'callsAvg']),
        },
        {
            name: 'triangles.avg',
            before: numberAt(before, ['browser', 'perf', 'counters', 'trianglesAvg']),
            after: numberAt(after, ['browser', 'perf', 'counters', 'trianglesAvg']),
        },
    ];
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

async function main() {
    const beforeFile = requiredPath('before');
    const afterFile = requiredPath('after');
    const before = await readJson(beforeFile);
    const after = await readJson(afterFile);
    const rows = metricRows(before, after);

    console.log(`Odyssey perf compare\nbefore: ${path.relative(process.cwd(), beforeFile)}\nafter:  ${path.relative(process.cwd(), afterFile)}\n`);
    console.log('| metric | before | after | delta |');
    console.log('|---|---:|---:|---:|');
    rows.forEach((row) => {
        console.log(`| ${row.name} | ${format(row.before)} | ${format(row.after)} | ${delta(row.before, row.after)} |`);
    });

    if (args.failOnRegression) {
        const regressions = rows.filter((row) => (
            row.before !== null
            && row.after !== null
            && Number.isFinite(row.before)
            && Number.isFinite(row.after)
            && row.after > row.before
            && ['startup.totalMs', 'startup.warmupMs', 'frame.p95', 'frame.p99', 'spikes'].includes(row.name)
        ));
        if (regressions.length > 0) {
            console.error(`\nRegression detected: ${regressions.map((row) => row.name).join(', ')}`);
            process.exitCode = 1;
        }
    }
}

main().catch((error) => {
    console.error(`[odyssey-perf-compare] ${error.message}`);
    process.exitCode = 1;
});
