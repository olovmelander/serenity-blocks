/**
 * Registry-driven, TDR-safe theme validation orchestrator.
 *
 * One production preview server is shared, but every selected theme runs in a
 * fresh Electron process. Workers are deliberately serial: Chromium can keep
 * a damaged/lost GPU device state alive across page reloads, and this machine's
 * iGPU has TDR-crashed on multi-theme journey captures.
 *
 * Usage:
 *   node scripts/validate-all-themes.mjs --list
 *   node scripts/validate-all-themes.mjs --theme neon-district
 *   node scripts/validate-all-themes.mjs
 *   node scripts/validate-all-themes.mjs --skip-build
 *   node scripts/validate-all-themes.mjs \
 *     --theme neon-district --base-url http://127.0.0.1:4174
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
    mkdir,
    readFile,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_REGISTRY } from '../src/themes/theme-registry.js';
// Lazy electron import: the npm shim throws when the binary is absent
// (npm ci --ignore-scripts), and the unit tests import this module only for
// its pure argument/matrix helpers. Spawning workers still requires the binary.
const electronPath = await import('electron').then((m) => m.default ?? m).catch(() => null);

export const THEME_VALIDATION_CONCURRENCY = 1;
export const DEFAULT_THEME_VALIDATION_PORT = 4174;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VITE_CLI = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const WORKER_SCRIPT = path.join(ROOT, 'scripts', 'capture-theme-screenshots.mjs');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'docs', 'theme-screenshots');
const BOOLEAN_OPTIONS = new Set([
    'all',
    'headed',
    'help',
    'list',
    'perf',
    'perf-resume',
    'skip-build',
]);
const VALUE_OPTIONS = new Set([
    'base-url',
    'build-timeout-ms',
    'cooldown-ms',
    'failure-cooldown-ms',
    'out',
    'perf-idle-ms',
    'perf-out',
    'perf-profile-dir',
    'perf-quality',
    'perf-settle-ms',
    'perf-target-fps',
    'perf-url-params',
    'port',
    'server-timeout-ms',
    'settle-ms',
    'theme',
    'worker-timeout-ms',
]);
// The perf lane's own defaults. Kept beside the option names so a reader sees both at once.
export const PERF_LANE_DEFAULTS = Object.freeze({
    // 10_000 matches every committed cell under reports/theme-perf/. The old default (20_000)
    // never matched any of them, so omitting --perf-idle-ms silently produced a different
    // measurement — same p50, double the samples, max outliers a 10 s window never sees. It cost
    // three runs on 2026-08-25 (sweep doc section 22) before anyone noticed.
    idleMs: 10_000,
    settleMs: 4_000,
    quality: 'High',
    targetFps: 60,
    cooldownFloorMs: 8_000,
    outputDir: 'reports/theme-perf',
    profileDir: 'artifacts/theme-perf-profile',
});
let activeWorkerProcess = null;

function parsePositiveInt(value, fallback, label) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return Math.floor(parsed);
}

function parseNonNegativeInt(value, fallback, label) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${label} must be a non-negative integer.`);
    }
    return Math.floor(parsed);
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    throw new Error(`Expected a boolean value, received "${value}".`);
}

export function parseThemeValidationArgs(argv) {
    const raw = {
        themes: [],
        positionals: [],
    };
    const booleanValues = new Set([
        '0',
        '1',
        'false',
        'no',
        'off',
        'on',
        'true',
        'yes',
    ]);

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--') {
            continue;
        }
        if (!token.startsWith('--')) {
            raw.positionals.push(token);
            continue;
        }

        const [key, inlineValue] = token.slice(2).split('=', 2);
        if (!BOOLEAN_OPTIONS.has(key) && !VALUE_OPTIONS.has(key)) {
            throw new Error(`Unknown option "--${key}". Use --help for supported options.`);
        }
        if (
            key !== 'theme'
            && Object.hasOwn(raw, key)
        ) {
            throw new Error(`Option "--${key}" may only be specified once.`);
        }
        const next = argv[index + 1];
        let value = inlineValue;
        if (
            value === undefined
            && BOOLEAN_OPTIONS.has(key)
            && (!next || !booleanValues.has(next.toLowerCase()))
        ) {
            value = true;
        } else if (value === undefined && next && !next.startsWith('--')) {
            value = next;
            index += 1;
        }
        if (value === undefined && BOOLEAN_OPTIONS.has(key)) {
            value = true;
        } else if (value === undefined) {
            throw new Error(`Option "--${key}" requires a value.`);
        }

        if (key === 'theme') {
            if (typeof value !== 'string') {
                throw new Error('--theme requires a registered theme id.');
            }
            raw.themes.push(value);
        } else {
            raw[key] = value;
        }
    }

    raw.themes.push(...raw.positionals);
    if (parseBoolean(raw.all, false) && raw.themes.length > 0) {
        throw new Error('--all cannot be combined with --theme or positional ids.');
    }

    let externalBaseUrl = null;
    if (typeof raw['base-url'] === 'string') {
        const parsedUrl = new URL(raw['base-url']);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('--base-url must use http: or https:.');
        }
        externalBaseUrl = parsedUrl.toString();
    }

    const port = parsePositiveInt(
        raw.port,
        DEFAULT_THEME_VALIDATION_PORT,
        '--port',
    );
    const outputDir = path.resolve(
        ROOT,
        typeof raw.out === 'string' ? raw.out : DEFAULT_OUTPUT_DIR,
    );

    return Object.freeze({
        requestedThemeIds: [...new Set(raw.themes)],
        help: parseBoolean(raw.help, false),
        list: parseBoolean(raw.list, false),
        externalBaseUrl,
        port,
        outputDir,
        skipBuild: externalBaseUrl
            ? true
            : parseBoolean(raw['skip-build'], false),
        headed: parseBoolean(raw.headed, false),
        settleMs: parseNonNegativeInt(raw['settle-ms'], 2_000, '--settle-ms'),
        perf: parseBoolean(raw.perf, false),
        perfResume: parseBoolean(raw['perf-resume'], false),
        perfIdleMs: parseNonNegativeInt(
            raw['perf-idle-ms'],
            PERF_LANE_DEFAULTS.idleMs,
            '--perf-idle-ms',
        ),
        perfSettleMs: parseNonNegativeInt(
            raw['perf-settle-ms'],
            PERF_LANE_DEFAULTS.settleMs,
            '--perf-settle-ms',
        ),
        perfQuality: typeof raw['perf-quality'] === 'string'
            ? raw['perf-quality']
            : PERF_LANE_DEFAULTS.quality,
        perfTargetFps: parsePositiveInt(
            raw['perf-target-fps'],
            PERF_LANE_DEFAULTS.targetFps,
            '--perf-target-fps',
        ),
        perfOutputDir: path.resolve(
            ROOT,
            typeof raw['perf-out'] === 'string' ? raw['perf-out'] : PERF_LANE_DEFAULTS.outputDir,
        ),
        perfProfileDir: path.resolve(
            ROOT,
            typeof raw['perf-profile-dir'] === 'string'
                ? raw['perf-profile-dir']
                : PERF_LANE_DEFAULTS.profileDir,
        ),
        // One query-string fragment forwarded to the worker's app URL (e.g.
        // 'goldenForestFixedDt=16.67&goldenForestSeed=1') for pinned-content A/B arms.
        perfUrlParams: typeof raw['perf-url-params'] === 'string' ? raw['perf-url-params'] : null,
        cooldownMs: parseNonNegativeInt(
            raw['cooldown-ms'],
            2_000,
            '--cooldown-ms',
        ),
        failureCooldownMs: parseNonNegativeInt(
            raw['failure-cooldown-ms'],
            15_000,
            '--failure-cooldown-ms',
        ),
        workerTimeoutMs: parsePositiveInt(
            raw['worker-timeout-ms'],
            420_000,
            '--worker-timeout-ms',
        ),
        buildTimeoutMs: parsePositiveInt(
            raw['build-timeout-ms'],
            600_000,
            '--build-timeout-ms',
        ),
        serverTimeoutMs: parsePositiveInt(
            raw['server-timeout-ms'],
            120_000,
            '--server-timeout-ms',
        ),
    });
}

export function resolveThemeValidationEntries(
    options,
    registry = THEME_REGISTRY,
) {
    const byId = new Map(registry.map((entry) => [entry.id, entry]));
    if (options.requestedThemeIds.length === 0) {
        return [...registry];
    }

    const unknown = options.requestedThemeIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
        throw new Error(
            `Unknown theme id${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
        );
    }

    return options.requestedThemeIds.map((id) => byId.get(id));
}

export function buildThemeWorkerArgs({
    entry,
    baseUrl,
    outputDir,
    runId,
    settleMs,
    headed,
    perf = false,
    perfIdleMs,
    perfSettleMs,
    perfQuality,
    perfTargetFps,
    perfOutputDir,
    perfProfileDir,
    perfUrlParams,
}) {
    return [
        WORKER_SCRIPT,
        '--',
        '--theme',
        entry.id,
        '--base-url',
        baseUrl,
        '--out',
        outputDir,
        '--run-id',
        runId,
        '--settle-ms',
        String(settleMs),
        ...(headed ? ['--headed', 'true'] : []),
        ...(perf
            ? [
                '--perf', 'true',
                '--perf-idle-ms', String(perfIdleMs),
                '--perf-settle-ms', String(perfSettleMs),
                '--perf-quality', String(perfQuality),
                '--perf-target-fps', String(perfTargetFps),
                '--perf-out', perfOutputDir,
                ...(perfUrlParams ? ['--url-params', perfUrlParams] : []),
                // Per-theme userData so every worker gets its OWN Dawn shader cache: a shared
                // profile would make theme N+1's compile numbers warm-cache and incomparable.
                '--perf-profile-dir', path.join(perfProfileDir, entry.id),
            ]
            : []),
    ];
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitForServer(url, timeoutMs, previewState = null) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
        if (previewState?.exited) {
            throw new Error(
                `Vite preview exited before becoming ready (${previewState.exitLabel}).`,
            );
        }
        try {
            // Intentional polling while the production preview starts.
            const response = await fetch(url, { method: 'GET' });
            if (response.ok) return;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await delay(500);
    }

    throw new Error(
        `Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`,
    );
}

function waitForExit(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        child.once('exit', resolve);
    });
}

async function terminateProcessTree(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    if (process.platform === 'win32') {
        await new Promise((resolve) => {
            const killer = spawn(
                'taskkill.exe',
                ['/PID', String(child.pid), '/T', '/F'],
                {
                    stdio: 'ignore',
                    windowsHide: true,
                },
            );
            killer.once('error', resolve);
            killer.once('exit', resolve);
        });
        return;
    }

    child.kill('SIGTERM');
    await Promise.race([
        waitForExit(child),
        delay(2_000),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
    }
}

async function runBuild(config) {
    const logPath = path.join(config.outputDir, 'build.log');
    console.log('[ThemeValidation] Building the production bundle...');

    const child = spawn(process.execPath, [VITE_CLI, 'build'], {
        cwd: ROOT,
        env: {
            ...process.env,
            FORCE_COLOR: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(String(chunk)));
    child.stderr.on('data', (chunk) => chunks.push(String(chunk)));

    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
    }, config.buildTimeoutMs);
    const outcome = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
    }).finally(() => {
        clearTimeout(timer);
    });
    const output = chunks.join('');
    await writeFile(logPath, output, 'utf8');

    if (timedOut || outcome.code !== 0) {
        throw new Error(
            `Production build failed (${timedOut ? 'timeout' : outcome.signal || outcome.code}). `
            + `See ${path.relative(ROOT, logPath)}.`,
        );
    }
}

function startPreviewServer(config, inheritedChunks = []) {
    const state = {
        process: null,
        chunks: [...inheritedChunks],
        exited: false,
        exitLabel: null,
    };
    const child = spawn(
        process.execPath,
        [
            VITE_CLI,
            'preview',
            '--host',
            '127.0.0.1',
            '--port',
            String(config.port),
            '--strictPort',
        ],
        {
            cwd: ROOT,
            env: {
                ...process.env,
                FORCE_COLOR: '0',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        },
    );
    state.process = child;
    child.stdout.on('data', (chunk) => state.chunks.push(String(chunk)));
    child.stderr.on('data', (chunk) => state.chunks.push(String(chunk)));
    child.once('error', (error) => {
        state.exited = true;
        state.exitLabel = error?.message || String(error);
    });
    child.once('exit', (code, signal) => {
        state.exited = true;
        state.exitLabel = signal || code;
    });
    return state;
}

async function ensurePreviewServer(config, baseUrl, previewState) {
    if (config.externalBaseUrl) {
        await waitForServer(baseUrl, config.serverTimeoutMs);
        return previewState;
    }

    if (previewState) {
        try {
            await waitForServer(
                baseUrl,
                Math.min(config.serverTimeoutMs, 5_000),
                previewState,
            );
            return previewState;
        } catch (error) {
            console.warn(
                '[ThemeValidation] Preview health check failed; restarting it before '
                + `the next isolated worker (${error?.message || error}).`,
            );
            await terminateProcessTree(previewState.process);
        }
    }

    const inheritedChunks = previewState?.chunks ?? [];
    if (inheritedChunks.length > 0) {
        inheritedChunks.push(
            `\n[ThemeValidation] Preview restarted at ${new Date().toISOString()}.\n`,
        );
    }
    const nextPreviewState = startPreviewServer(config, inheritedChunks);
    await waitForServer(baseUrl, config.serverTimeoutMs, nextPreviewState);
    return nextPreviewState;
}

async function stopPreviewServer(config, previewState) {
    if (!previewState) return;
    await terminateProcessTree(previewState.process);
    await writeFile(
        path.join(config.outputDir, 'preview.log'),
        previewState.chunks.join(''),
        'utf8',
    );
}

async function runThemeWorker(config, entry, baseUrl, runId) {
    const workerArgs = buildThemeWorkerArgs({
        entry,
        baseUrl,
        outputDir: config.outputDir,
        runId,
        settleMs: config.settleMs,
        headed: config.headed,
        perf: config.perf,
        perfIdleMs: config.perfIdleMs,
        perfSettleMs: config.perfSettleMs,
        perfQuality: config.perfQuality,
        perfTargetFps: config.perfTargetFps,
        perfOutputDir: config.perfOutputDir,
        perfProfileDir: config.perfProfileDir,
        perfUrlParams: config.perfUrlParams,
    });
    const env = {
        ...process.env,
        FORCE_COLOR: '0',
    };
    delete env.ELECTRON_RUN_AS_NODE;

    if (!electronPath) {
        throw new Error('Electron binary missing — run `node node_modules/electron/install.js` first.');
    }
    const child = spawn(electronPath, workerArgs, {
        cwd: ROOT,
        env,
        stdio: 'inherit',
        windowsHide: !config.headed,
    });
    activeWorkerProcess = child;
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
    }, config.workerTimeoutMs);
    let outcome;
    try {
        outcome = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', (code, signal) => resolve({ code, signal }));
        });
    } finally {
        clearTimeout(timer);
        if (activeWorkerProcess === child) {
            activeWorkerProcess = null;
        }
    }

    return {
        ...outcome,
        timedOut,
    };
}

async function readWorkerReport(config, entry, runId, outcome) {
    const relativeReportPath = path.join(
        'results',
        `${entry.id}.json`,
    );
    const reportPath = path.join(config.outputDir, relativeReportPath);
    let report = null;
    let reportError = null;

    try {
        report = JSON.parse(await readFile(reportPath, 'utf8'));
        if (report.runId !== runId) {
            reportError = (
                `Worker report has stale run id "${report.runId}", expected "${runId}".`
            );
            report = null;
        }
    } catch (error) {
        reportError = error?.message || String(error);
    }

    const processPassed = outcome.code === 0 && !outcome.timedOut;
    const reportPassed = report?.passed === true;
    const passed = processPassed && reportPassed;
    const orchestrationError = passed
        ? null
        : (
            reportError
            || (outcome.timedOut
                ? `Worker exceeded ${config.workerTimeoutMs}ms.`
                : `Worker exited with ${outcome.signal || outcome.code}.`)
        );

    return {
        theme: entry.id,
        displayName: entry.displayName,
        performanceClass: entry.performanceClass,
        passed,
        screenshot: report?.screenshot?.path || null,
        report: path.relative(ROOT, reportPath),
        lifecycleFailureCount: report?.lifecycle?.checks
            ?.filter((check) => !check.passed).length ?? null,
        consoleErrorCount: report?.console?.errorCount ?? null,
        perfCell: report?.perf
            ? path.relative(ROOT, path.join(config.perfOutputDir, `${entry.id}.json`))
            : null,
        perfAdmissible: report?.perf?.admissible ?? null,
        perfInadmissibleReasons: report?.perf?.inadmissibleReasons ?? null,
        processFailureCount: report?.console?.processFailureCount
            ?? report?.console?.processFailures?.length
            ?? null,
        orchestrationError,
        workerExit: {
            code: outcome.code,
            signal: outcome.signal,
            timedOut: outcome.timedOut,
        },
    };
}

async function writeAggregateReport(config, {
    runId,
    baseUrl,
    selectedEntries,
    results,
    startedAt,
    interrupted = false,
}) {
    const report = {
        schemaVersion: 3,
        generatedAt: new Date().toISOString(),
        startedAt,
        runId,
        baseUrl,
        registryThemeCount: THEME_REGISTRY.length,
        selectedThemeCount: selectedEntries.length,
        completedThemeCount: results.length,
        passed: results.filter((result) => result.passed).length,
        failed: results.filter((result) => !result.passed).length,
        interrupted,
        execution: {
            concurrency: THEME_VALIDATION_CONCURRENCY,
            processIsolation: 'fresh-electron-process-per-theme',
            productionBuild: !config.skipBuild,
            externalServer: Boolean(config.externalBaseUrl),
            cooldownMs: config.cooldownMs,
            failureCooldownMs: config.failureCooldownMs,
            perfLane: Boolean(config.perf),
            perfIdleMs: config.perf ? config.perfIdleMs : null,
            perfQuality: config.perf ? config.perfQuality : null,
            perfTargetFps: config.perf ? config.perfTargetFps : null,
        },
        selectedThemes: selectedEntries.map(({ id }) => id),
        results,
    };
    await writeFile(
        path.join(config.outputDir, 'capture-report.json'),
        JSON.stringify(report, null, 2),
        'utf8',
    );
    return report;
}

function printThemeList(entries) {
    entries.forEach((entry) => {
        console.log(
            `${entry.id}\t${entry.performanceClass}\t${entry.displayName}`,
        );
    });
}

function printUsage() {
    console.log(`Usage:
  node scripts/validate-all-themes.mjs --list
  node scripts/validate-all-themes.mjs --theme <id> [--theme <id> ...]
  node scripts/validate-all-themes.mjs [options] [theme-id ...]

Every selected theme runs serially in a fresh Electron process.

Selection:
  --all                         Validate the complete registry (the default)
  --theme <id>                  Validate a registered id; repeatable
  --list                        Print the selected registry matrix and exit

Server and build:
  --base-url <url>              Use an existing HTTP(S) server; implies --skip-build
  --port <number>               Local preview port (default: ${DEFAULT_THEME_VALIDATION_PORT})
  --skip-build[=<boolean>]      Reuse the current dist bundle (default: false)
  --build-timeout-ms <ms>       Production build timeout (default: 600000)
  --server-timeout-ms <ms>      Preview/server readiness timeout (default: 120000)

Worker execution:
  --out <directory>             Artifact directory (default: docs/theme-screenshots)
  --settle-ms <ms>              Pre-screenshot settle time (default: 2000)
  --cooldown-ms <ms>            Delay after a passing worker (default: 2000)
  --failure-cooldown-ms <ms>    Delay after a failing worker (default: 15000)
  --worker-timeout-ms <ms>      Per-Electron-process timeout (default: 420000)
  --headed[=<boolean>]          Show each Electron window (default: false)

General:
  --help                        Print this help and exit`);
}

/**
 * Drop themes that already have a committed perf cell.
 *
 * A 61-theme serial GPU sweep is over an hour long, and this machine restarts under it (Windows
 * Update took one down at theme 8). Re-measuring what already succeeded wastes GPU time and, worse,
 * would re-roll cells that are already good. Selection only — it changes nothing about how a theme
 * is measured, so a resumed cell stays comparable with the ones before it.
 */
export function filterAlreadyMeasured(entries, perfOutputDir, log = () => {}) {
    const remaining = [];
    const done = [];
    for (const entry of entries) {
        if (existsSync(path.join(perfOutputDir, `${entry.id}.json`))) done.push(entry.id);
        else remaining.push(entry);
    }
    if (done.length) {
        log(`[ThemeValidation] --perf-resume: skipping ${done.length} theme(s) that already have a `
            + `cell: ${done.join(', ')}`);
    }
    return remaining;
}

export async function runThemeValidation(argv = process.argv.slice(2)) {
    const config = parseThemeValidationArgs(argv);
    let selectedEntries = resolveThemeValidationEntries(config);
    if (config.perf && config.perfResume) {
        selectedEntries = filterAlreadyMeasured(
            selectedEntries,
            config.perfOutputDir,
            (m) => console.log(m),
        );
    }
    if (config.help) {
        printUsage();
        return 0;
    }
    if (config.list) {
        printThemeList(selectedEntries);
        return 0;
    }

    await mkdir(config.outputDir, { recursive: true });
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const startedAt = new Date().toISOString();
    const baseUrl = config.externalBaseUrl
        || `http://127.0.0.1:${config.port}/`;
    const results = [];
    let previewState = null;
    let interrupted = false;

    const interrupt = () => {
        interrupted = true;
        terminateProcessTree(activeWorkerProcess);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);

    try {
        if (!config.skipBuild) {
            await runBuild(config);
        }
        if (!config.externalBaseUrl) {
            console.log(
                `[ThemeValidation] Starting production preview at ${baseUrl}`,
            );
            previewState = await ensurePreviewServer(config, baseUrl, null);
        } else {
            await waitForServer(baseUrl, config.serverTimeoutMs);
        }

        console.log(
            `[ThemeValidation] ${selectedEntries.length} theme(s), `
            + `concurrency=${THEME_VALIDATION_CONCURRENCY}, `
            + 'fresh Electron process per theme.',
        );

        for (let index = 0; index < selectedEntries.length; index += 1) {
            if (interrupted) break;
            const entry = selectedEntries[index];
            previewState = await ensurePreviewServer(
                config,
                baseUrl,
                previewState,
            );
            console.log(
                `[ThemeValidation] [${index + 1}/${selectedEntries.length}] `
                + `${entry.id} (${entry.performanceClass})`,
            );
            const outcome = await runThemeWorker(
                config,
                entry,
                baseUrl,
                runId,
            );
            const result = await readWorkerReport(
                config,
                entry,
                runId,
                outcome,
            );
            results.push(result);
            await writeAggregateReport(config, {
                runId,
                baseUrl,
                selectedEntries,
                results,
                startedAt,
                interrupted,
            });

            if (index < selectedEntries.length - 1 && !interrupted) {
                // The perf lane needs a longer floor than the lifecycle lane: the GPU has to be
                // idle and cool before the next theme's compile numbers mean anything.
                const cooldown = Math.max(
                    result.passed ? config.cooldownMs : config.failureCooldownMs,
                    config.perf ? PERF_LANE_DEFAULTS.cooldownFloorMs : 0,
                );
                if (cooldown > 0) {
                    console.log(
                        `[ThemeValidation] Cooling down for ${cooldown}ms `
                        + `after ${entry.id}.`,
                    );
                    await delay(cooldown);
                }
            }
        }
    } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
        await stopPreviewServer(config, previewState);
    }

    const aggregate = await writeAggregateReport(config, {
        runId,
        baseUrl,
        selectedEntries,
        results,
        startedAt,
        interrupted,
    });
    console.log(
        `[ThemeValidation] Complete: ${aggregate.passed} passed, `
        + `${aggregate.failed} failed, `
        + `${aggregate.completedThemeCount}/${aggregate.selectedThemeCount} completed.`,
    );
    console.log(
        `[ThemeValidation] Report: ${path.relative(
            ROOT,
            path.join(config.outputDir, 'capture-report.json'),
        )}`,
    );

    return (
        !interrupted
        && aggregate.completedThemeCount === aggregate.selectedThemeCount
        && aggregate.failed === 0
    ) ? 0 : 2;
}

if (
    process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
    runThemeValidation()
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .catch((error) => {
            console.error('[ThemeValidation] Fatal error:', error);
            process.exitCode = 1;
        });
}
