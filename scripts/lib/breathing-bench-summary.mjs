/**
 * Reading scripts/breathing-gpu-bench.mjs output: which repeats agree, and the summary table.
 * No Electron here, so the bench's --summary and other scripts can use it.
 */
/* eslint-disable no-console */

/** Timestamps arrive on this grid (ADR-0016): differences inside it are below resolution. */
export const TIMESTAMP_STEP_MS = 0.065536;

/** What a reading measured: repeats of it share this key. */
function readingKey(reading) {
    return [
        reading.variant || 'base', reading.dsf, reading.width, reading.height, reading.tier, reading.world,
        reading.mood, reading.lung, reading.maxFps || 0, reading.vsync === false ? 'uncapped' : 'vsync',
    ].join('|');
}

/** Two figures agree when they differ by at most two timestamp steps or `share` of their mean. */
export function agrees(a, b, share) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    // A hair of slack: two figures exactly two steps apart differ by a float sum of steps.
    return Math.abs(a - b) <= Math.max(2 * TIMESTAMP_STEP_MS, share * ((a + b) / 2)) + 1e-9;
}

/** The closest pair of repeats that agree (p50 within 5 %, p95 within 10 %, or two steps), or null. */
function agreeingPair(usable) {
    let pair = null;
    for (let i = 0; i < usable.length; i++) {
        for (let j = i + 1; j < usable.length; j++) {
            const [a, b] = [usable[i], usable[j]];
            if (agrees(a.gpu.p50, b.gpu.p50, 0.05) && agrees(a.gpu.p95, b.gpu.p95, 0.1)) {
                const gap = Math.abs(a.gpu.p50 - b.gpu.p50) + Math.abs(a.gpu.p95 - b.gpu.p95);
                if (!pair || gap < pair.gap) pair = { gap, runs: [a, b] };
            }
        }
    }
    return pair;
}

/**
 * Group readings by what they measured. A figure is kept from the closest pair of repeats that
 * agree: a repeat that caught the GPU in another power state is left out, and a reading with no
 * agreeing pair (or whose repeats drew different content) has no figure (`agree` false).
 */
export function summarise(readings) {
    const groups = new Map();
    readings.forEach((reading) => {
        const key = readingKey(reading);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(reading);
    });
    return [...groups.values()].map((runs) => {
        const usable = runs.filter((run) => !run.void);
        const sameContent = usable.every((run) => run.drawCalls === usable[0].drawCalls
            && run.buffer === usable[0].buffer);
        const pair = sameContent ? agreeingPair(usable) : null;
        const valid = pair ? pair.runs : usable;
        const mean = (pick) => valid.reduce((sum, run) => sum + pick(run), 0) / Math.max(valid.length, 1);
        const parts = {};
        valid.forEach((run) => Object.entries(run.parts || {}).forEach(([name, ms]) => {
            parts[name] = (parts[name] || 0) + ms / valid.length;
        }));
        return {
            ...runs[0],
            repeats: runs.length,
            valid: usable.length,
            agree: Boolean(pair),
            sameContent,
            presentHz: mean((run) => run.presentHz ?? NaN),
            fps: mean((run) => run.fps ?? NaN),
            gpuP50: mean((run) => run.gpu.p50),
            gpuP95: mean((run) => run.gpu.p95),
            gpuP50s: usable.map((run) => run.gpu.p50),
            gpuP95s: usable.map((run) => run.gpu.p95),
            cpuP50: mean((run) => run.cpu.p50),
            cpuP95: mean((run) => run.cpu.p95),
            parts,
            powerW: mean((run) => run.nvsmi?.powerW ?? NaN),
            clockMHz: mean((run) => run.nvsmi?.clockMHz ?? NaN),
        };
    });
}

export function printSummary(file, rows) {
    const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
    console.log(`# ${file}`);
    console.log(['screen', 'tier', 'world', 'lungs', 'buffer', 'draws', 'GPU p50', 'GPU p95', 'CPU p50', 'CPU p95',
        'scene', 'bloom', 'shafts', 'output', 'W', 'repeats agree'].join(' | '));
    rows.forEach((row) => {
        const p = row.parts;
        const variant = row.variant && row.variant !== 'base' ? ` <${row.variant}>` : '';
        const repeats = `${row.agree ? 'yes' : 'NO'} (${row.gpuP50s.map((v) => f(v)).join(' / ')})`;
        console.log([`${row.width}x${row.height}@${row.dsf ?? 'native'}${variant}`, row.tier, row.world, row.lung,
            row.buffer, row.drawCalls, f(row.gpuP50), f(row.gpuP95), f(row.cpuP50), f(row.cpuP95),
            f(p.scene ?? p.direct), f(p.bloom), f(p.shafts), f(p.output), f(row.powerW, 0), repeats].join(' | '));
    });
}
