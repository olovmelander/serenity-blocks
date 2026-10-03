// Actual baseline/current methods with counted DOM/array substitutes.
// Counts describe executed work, not elapsed time, heap, layout, GPU cost or FPS.
// Run from any directory: node reports/core-ui-pass3/shared-work-probe.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const recordedBaselineCommit = 'b52959f';
const baselineTree = '071fd7a4856e288abc892fe6a2c3f9d2a165195b';
// Connector publication can recreate commit metadata with the same file tree.
// Resolve by the tree fingerprint so a fresh clone can reproduce this probe.
const baselineCommit = execFileSync('git', ['log', '--all', '--format=%H %T'], {
    cwd: fileURLToPath(root), encoding: 'utf8',
}).split('\n').find((line) => line.endsWith(` ${baselineTree}`))?.split(' ')[0];
if (!baselineCommit) throw new Error(`Audit baseline tree ${baselineTree} is unavailable; fetch the full history.`);
const files = ['src/utils/performance-monitor.js', 'src/ui/effects/enhanced-breathing-indicator.js', 'src/core/infinity-grid.js'];
const originalLog = console.log;
console.log = () => {};
const sources = {};

async function modules(lane) {
    return Promise.all(files.map(async (file) => {
        const source = lane === 'before'
            ? execFileSync('git', ['show', `${baselineCommit}:${file}`], { cwd: fileURLToPath(root), encoding: 'utf8' })
            : await readFile(new URL(file, root), 'utf8');
        sources[file] ||= {};
        sources[file][lane] = createHash('sha256').update(source).digest('hex');
        const absoluteImports = source.replace(/from\s+(['"])(\.[^'"]+)\1/g,
            (_, quote, path) => `from ${quote}${new URL(path, new URL(file, root)).href}${quote}`);
        return import(`data:text/javascript;base64,${Buffer.from(absoluteImports).toString('base64')}`);
    }));
}

function probe([monitorModule, breathingModule, gridModule]) {
    const counts = {};
    let cells = 0;
    const board = Array.from({ length: 1000 }, (_, row) => new Proxy(Array.from({ length: 10 }, (_, col) => row === 0 && col === 0 ? {} : null), {
        get(target, key, receiver) { if (/^\d+$/.test(String(key))) cells++; return Reflect.get(target, key, receiver); },
    }));
    counts.topRow = { rows: 1000, columns: 10, result: gridModule.calculateTopRow({ board }), cellReads: cells };
    const monitor = new monitorModule.PerformanceMonitor();
    let sorts = 0;
    let averages = 0;
    const originalSort = Array.prototype.sort;
    const originalReduce = Array.prototype.reduce;
    Array.prototype.sort = function (...args) { sorts++; return originalSort.apply(this, args); };
    Array.prototype.reduce = function (...args) { averages++; return originalReduce.apply(this, args); };
    try { for (let i = 0; i < 240; i++) monitor.recordCounters({ calls: i, triangles: i * 10 }); }
    finally { Array.prototype.sort = originalSort; Array.prototype.reduce = originalReduce; }
    counts.counterCollection = { calls: 240, overlayVisible: false, enabled: monitor.enabled, sorts, averageTraversals: averages, result: { ...monitor.renderCounters } };
    const makeNode = (work) => ({
        style: new Proxy({ setProperty() { work.styles++; } }, { set(t, k, v) { work.styles++; t[k] = v; return true; } }),
        set textContent(value) { work.labels++; },
    });
    const Progress = breathingModule.EnhancedBreathingIndicator;
    const work = { queries: 0, labels: 0, styles: 0 };
    const indicator = Object.create(Progress.prototype);
    const dots = Array.from({ length: 20 }, () => ({ ...makeNode(work), dataset: { group: '1' } }));
    Object.assign(indicator, {
        progressContainer: {}, roundIndicator: makeNode(work), progressBarFill: makeNode(work),
        breathDotsContainer: { querySelectorAll() { work.queries++; return dots; } },
        _progressState: { visible: true, totalBreaths: 20, currentBreath: 4 },
    });
    const data = { round: 1, totalRounds: 3, breathCount: 4, totalBreaths: 20, sessionProgress: 0.3, sessionColor: { r: 100, g: 200, b: 255 } };
    for (let i = 0; i < 100; i++) indicator.updateProgress(data);
    counts.identicalProgress = { callbacks: 100, dots: 20, ...work };
    const holdWork = { labels: 0, styles: 0 };
    const hold = Object.create(Progress.prototype);
    Object.assign(hold, {
        isActive: true, currentPhase: 'hold1', phaseStartTime: performance.now(), pattern: [4, 60, 4, 4],
        technique: { color: { r: 100, g: 200, b: 255 } }, showText: true,
        outerRing: makeNode(holdWork), middleRing: makeNode(holdWork), innerRing: makeNode(holdWork), coreCircle: makeNode(holdWork),
        indicator: makeNode(holdWork), textPrompt: makeNode(holdWork),
    });
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    try { for (let i = 0; i < 240; i++) hold._animate(); }
    finally { globalThis.requestAnimationFrame = originalRaf; }
    counts.constantHold = { callbacks: 240, ...holdWork };
    return counts;
}

try {
    const before = await modules('before');
    const after = await modules('after');
    const result = {
        instrument: 'Actual methods with counted substitutes; no timing/FPS claim. Counter result summaries are read after counted collection.',
        baselineCommit,
        recordedBaselineCommit,
        baselineTree,
        sources,
        before: [probe(before), probe(before)],
        after: [probe(after), probe(after)],
    };
    if (JSON.stringify(result.before[0]) !== JSON.stringify(result.before[1])
        || JSON.stringify(result.after[0]) !== JSON.stringify(result.after[1])) throw new Error('Repeated probes disagree');
    if (JSON.stringify(result.before[0].counterCollection.result) !== JSON.stringify(result.after[0].counterCollection.result)) throw new Error('Counter summaries changed');
    originalLog(JSON.stringify(result, null, 2));
} finally { console.log = originalLog; }
