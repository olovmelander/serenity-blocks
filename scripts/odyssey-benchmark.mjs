import { fork, execFileSync } from 'node:child_process';
import {
    appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVEL_CONFIGS } from '../src/core/odyssey/data/levels.js';
import { BENCHMARK_PROFILES, BENCHMARK_CADENCES } from './odyssey-benchmark/profiles.mjs';
import { BENCHMARK_SCENARIOS, supportsScenario, resolveScenario } from './odyssey-benchmark/scenarios.mjs';
import { writeReports } from './odyssey-benchmark/report.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');

function integer(value, name, min, max) {
    if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer`);
    const number = Number(value);
    if (number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return number;
}

export function parseOptions(args) {
    const values = {};
    const flags = new Set(['help', 'resume', 'trace', 'capabilities-only']);
    const allowed = new Set([
        ...flags, 'levels', 'profiles', 'samples', 'seed-start', 'workers',
        'max-seconds', 'max-pieces', 'wall-ms', 'output', 'scenarios', 'cadences', 'lap-seconds',
    ]);
    for (let index = 0; index < args.length; index++) {
        const match = args[index].match(/^--([^=]+)(?:=(.*))?$/);
        if (!match || !allowed.has(match[1])) throw new Error(`Unknown argument: ${args[index]}`);
        const name = match[1];
        if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: --${name}`);
        if (flags.has(name) && match[2] !== undefined) throw new Error(`--${name} does not take a value`);
        values[name] = flags.has(name) ? true : (match[2] ?? args[++index]);
        if (values[name] === undefined || (!flags.has(name) && String(values[name]).startsWith('--'))) {
            throw new Error(`Missing value for --${name}`);
        }
    }
    const levelIds = values.levels === undefined || values.levels === 'all'
        ? LEVEL_CONFIGS.map((level) => level.id)
        : String(values.levels).split(',').flatMap((part) => {
            const range = part.match(/^(\d+)-(\d+)$/);
            if (!range) return [integer(part, 'level', 1, 59)];
            const from = integer(range[1], 'level', 1, 59);
            const to = integer(range[2], 'level', from, 59);
            return Array.from({ length: to - from + 1 }, (_, index) => from + index);
        });
    const profileIds = values.profiles === undefined || values.profiles === 'all'
        ? BENCHMARK_PROFILES.map((profile) => profile.id)
        : String(values.profiles).split(',');
    for (const id of profileIds) {
        if (!BENCHMARK_PROFILES.some((profile) => profile.id === id)) throw new Error(`Unknown profile: ${id}`);
    }
    const selection = (value, entries, fallback, name) => {
        const ids = value === 'all' ? entries.map((entry) => entry.id) : String(value ?? fallback).split(',');
        if (ids.some((id) => !entries.some((entry) => entry.id === id))) throw new Error(`Unknown ${name}: ${value}`);
        return [...new Set(ids)];
    };
    const scenarioIds = selection(values.scenarios, BENCHMARK_SCENARIOS, 'baseline', 'scenario');
    const cadenceIds = selection(values.cadences, BENCHMARK_CADENCES, 'native', 'cadence');
    const hasCompatibleScenario = levelIds.some((id) => {
        const level = LEVEL_CONFIGS.find((entry) => entry.id === id);
        return scenarioIds.some((scenarioId) => supportsScenario(scenarioId, level));
    });
    if (!hasCompatibleScenario) throw new Error('No selected scenario supports the selected orbs');
    return {
        levelIds: [...new Set(levelIds)],
        profileIds: [...new Set(profileIds)],
        scenarioIds,
        cadenceIds,
        samples: integer(values.samples ?? 20, 'samples', 1, 10000),
        seedStart: integer(values['seed-start'] ?? 1001, 'seed-start', 0, 4294957295),
        workers: integer(values.workers ?? 4, 'workers', 1, 16),
        maxSimSeconds: integer(values['max-seconds'] ?? 1800, 'max-seconds', 1, 7200),
        maxPieces: integer(values['max-pieces'] ?? 3000, 'max-pieces', 1, 20000),
        wallBudgetMs: integer(values['wall-ms'] ?? 120000, 'wall-ms', 100, 600000),
        lapWindowSeconds: values['lap-seconds'] === undefined || values['lap-seconds'] === 'full'
            ? null : integer(values['lap-seconds'], 'lap-seconds', 1, 7200),
        outputDir: resolve(values.output ?? 'artifacts/odyssey-benchmark'),
        resume: Boolean(values.resume),
        trace: Boolean(values.trace),
        capabilitiesOnly: Boolean(values['capabilities-only']),
        help: Boolean(values.help),
    };
}

export function buildTasks(options) {
    const tasks = [];
    for (let sample = 0; sample < options.samples; sample++) {
        for (const levelId of options.levelIds) {
            for (const profileId of options.profileIds) {
                for (const cadenceId of options.cadenceIds) {
                    for (const scenarioId of options.scenarioIds) {
                        const level = LEVEL_CONFIGS.find((entry) => entry.id === levelId);
                        if (!supportsScenario(scenarioId, level)) continue;
                        tasks.push({
                            levelId,
                            seed: options.seedStart + sample,
                            profile: profileId,
                            scenarioId,
                            cadenceId,
                            lapWindowSeconds: options.lapWindowSeconds,
                            maxSimSeconds: options.maxSimSeconds,
                            maxPieces: options.maxPieces,
                            wallBudgetMs: options.wallBudgetMs,
                            trace: options.trace,
                        });
                    }
                }
            }
        }
    }
    return tasks;
}

export function attemptKey(attempt) {
    return [attempt.levelId, attempt.profileId ?? attempt.profile, attempt.seed,
        attempt.scenarioId || 'baseline', attempt.cadenceId || 'native'].join(':');
}

function revisionInfo() {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const files = [
        scriptPath, ...['runtime', 'virtual-clock', 'profiles', 'capabilities', 'report', 'scenarios']
            .map((name) => resolve(repoRoot, `scripts/odyssey-benchmark/${name}.mjs`)),
    ];
    const digest = createHash('sha256');
    for (const file of files) digest.update(readFileSync(file));
    const sourceFiles = execFileSync('git', [
        'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
        'src', 'package.json', 'package-lock.json',
    ], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter((file) => /\.(?:[cm]?[jt]s|json)$/.test(file)).sort();
    const applicationDigest = createHash('sha256');
    for (const file of sourceFiles) {
        applicationDigest.update(`${file}\0`);
        const path = resolve(repoRoot, file);
        applicationDigest.update(existsSync(path) ? readFileSync(path) : '<deleted>');
    }
    return {
        head,
        benchmarkHash: digest.digest('hex'),
        applicationHash: applicationDigest.digest('hex'),
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        workingTreeImplementation: true,
    };
}

export function validateResumeConfiguration(previous, current) {
    const keys = [
        'levelIds', 'profileIds', 'seedStart', 'samples', 'maxSimSeconds',
        'maxPieces', 'wallBudgetMs', 'trace', 'revision', 'capabilitiesOnly',
        'scenarioIds', 'cadenceIds', 'lapWindowSeconds', 'effectiveLevels', 'visiblePreviews',
        'humanPlanningPreviewLimit', 'opponentKnowledgePolicy',
        'opponentVisiblePreviewCount', 'opponentPlanningPreviewLimit',
    ];
    for (const key of keys) {
        if (JSON.stringify(previous[key]) !== JSON.stringify(current[key])) {
            throw new Error(`Resume configuration differs: ${key}; use a new output directory`);
        }
    }
}

async function workerMain() {
    const { runAttempt } = await import('./odyssey-benchmark/runtime.mjs');
    process.on('message', async ({ type, task }) => {
        if (type !== 'attempt') return;
        let attempt;
        try {
            attempt = await runAttempt(task);
        } catch (error) {
            attempt = {
                levelId: task.levelId,
                seed: task.seed,
                profileId: task.profile,
                scenarioId: task.scenarioId,
                cadenceId: task.cadenceId,
                outcome: 'error',
                reason: 'harness_exception',
                error: String(error.stack || error),
            };
        }
        process.send({ type: 'result', attempt });
    });
    process.on('disconnect', () => process.exit(0));
    process.send({ type: 'ready' });
}

async function runPool(tasks, options, onResult) {
    let cursor = 0;
    let aborted = false;
    const children = new Set();
    const runnerLog = resolve(options.outputDir, 'runner.log');
    const startWorker = () => new Promise((resolveWorker, rejectWorker) => {
        let child;
        let current = null;
        let watchdog = null;
        let restarting = false;
        let settled = false;
        const finish = () => {
            settled = true;
            if (watchdog) clearTimeout(watchdog);
            children.delete(child);
            if (child.connected) child.disconnect();
            resolveWorker();
        };
        const assign = () => {
            if (aborted) { finish(); return; }
            current = tasks[cursor++];
            if (!current) { finish(); return; }
            child.send({ type: 'attempt', task: current });
            watchdog = setTimeout(() => {
                restarting = true;
                onResult({
                    levelId: current.levelId,
                    seed: current.seed,
                    profileId: current.profile,
                    scenarioId: current.scenarioId,
                    cadenceId: current.cadenceId,
                    outcome: 'censored',
                    reason: 'worker_wall_budget',
                    wallMs: options.wallBudgetMs + 10000,
                });
                current = null;
                child.kill();
            }, options.wallBudgetMs + 10000);
        };
        child = fork(scriptPath, ['--worker'], {
            cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
        });
        children.add(child);
        child.stderr.on('data', (chunk) => appendFileSync(runnerLog, chunk));
        child.on('error', (error) => {
            settled = true;
            if (watchdog) clearTimeout(watchdog);
            rejectWorker(error);
        });
        child.on('message', (message) => {
            if (aborted || settled || restarting) return;
            if (message.type === 'ready') assign();
            if (message.type === 'result') {
                clearTimeout(watchdog);
                watchdog = null;
                current = null;
                onResult(message.attempt);
                assign();
            }
        });
        child.on('exit', (code) => {
            children.delete(child);
            if (settled || aborted) return;
            if (current) {
                clearTimeout(watchdog);
                onResult({
                    levelId: current.levelId,
                    seed: current.seed,
                    profileId: current.profile,
                    scenarioId: current.scenarioId,
                    cadenceId: current.cadenceId,
                    outcome: 'error',
                    reason: 'worker_exit',
                    error: `Exit ${code}`,
                });
                restarting = true;
            }
            if (restarting) startWorker().then(resolveWorker, rejectWorker);
            else rejectWorker(new Error(`Benchmark worker exited before becoming ready (exit ${code})`));
        });
    });
    try {
        await Promise.all(Array.from({ length: Math.min(options.workers, tasks.length) }, startWorker));
    } finally {
        aborted = true;
        for (const child of children) child.kill();
    }
}

export async function main(args = process.argv.slice(2)) {
    const options = parseOptions(args);
    if (options.help) {
        console.log('Odyssey benchmark: --levels all|1-5,16 --profiles all|stacker,cascade,expert,quad');
        console.log('--scenarios baseline|all|orb59-deadline210 --cadences native|steady|deliberate|all');
        console.log('--samples 20 --seed-start 1001 --workers 4 --max-seconds 1800 --max-pieces 3000');
        console.log('--lap-seconds full|60 --wall-ms 120000 --output artifacts/odyssey-benchmark');
        console.log('--resume --trace --capabilities-only');
        return;
    }
    mkdirSync(options.outputDir, { recursive: true });
    const revision = revisionInfo();
    const config = {
        ...options,
        plannedAttempts: options.capabilitiesOnly ? 0 : buildTasks(options).length,
        clock: 'legacy-variable-v1 at controlled 60 Hz',
        visiblePreviews: 3,
        humanPlanningPreviewLimit: 3,
        opponentKnowledgePolicy: 'production-full-real-bag',
        opponentVisiblePreviewCount: 3,
        opponentPlanningPreviewLimit: null,
        syntheticProfiles: true,
        revision,
        scenarios: BENCHMARK_SCENARIOS.filter((entry) => options.scenarioIds.includes(entry.id)),
        cadences: BENCHMARK_CADENCES.filter((entry) => options.cadenceIds.includes(entry.id)),
        effectiveLevels: options.levelIds.flatMap((id) => options.scenarioIds
            .filter((scenarioId) => supportsScenario(scenarioId, LEVEL_CONFIGS.find((level) => level.id === id)))
            .map((scenarioId) => ({
                scenarioId,
                level: resolveScenario(LEVEL_CONFIGS.find((level) => level.id === id), scenarioId),
            }))),
    };
    const configPath = resolve(options.outputDir, 'config.json');
    const rawPath = resolve(options.outputDir, 'raw.jsonl');
    const capabilitiesPath = resolve(options.outputDir, 'capabilities.json');
    let attempts = [];
    let capabilities;
    if (options.resume) {
        if (!existsSync(configPath)) throw new Error('Cannot resume without config.json');
        const previous = JSON.parse(readFileSync(configPath, 'utf8'));
        validateResumeConfiguration(previous, config);
        if (existsSync(rawPath)) {
            attempts = readFileSync(rawPath, 'utf8').trim().split('\n').filter(Boolean)
                .map((line) => JSON.parse(line));
        }
        capabilities = JSON.parse(readFileSync(capabilitiesPath, 'utf8'));
    } else {
        if (existsSync(rawPath) || existsSync(configPath)) {
            throw new Error('Output already has a run; use --resume or a new directory');
        }
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('Validating reachable cascade fixtures and test-player capabilities...');
        const { validateCapabilities } = await import('./odyssey-benchmark/capabilities.mjs');
        capabilities = await validateCapabilities({ profileIds: options.profileIds });
        writeFileSync(capabilitiesPath, JSON.stringify(capabilities, null, 2));
        writeFileSync(rawPath, '');
    }
    if (!options.capabilitiesOnly && capabilities.mechanics?.status !== 'pass') {
        throw new Error('Mechanics validation did not pass; inspect capabilities.json before running the campaign');
    }
    const completed = new Set(attempts.map(attemptKey));
    const tasks = options.capabilitiesOnly ? []
        : buildTasks(options).filter((task) => !completed.has(attemptKey(task)));
    const counts = {
        win: 0, loss: 0, censored: 0, error: 0,
    };
    attempts.forEach((attempt) => { counts[attempt.outcome]++; });
    console.log(`Running ${tasks.length} attempts across ${options.levelIds.length} orbs`
        + ` and ${options.profileIds.length} profiles, ${options.scenarioIds.length} scenarios`
        + ` and ${options.cadenceIds.length} input cadences.`);
    await runPool(tasks, options, (attempt) => {
        attempts.push(attempt);
        appendFileSync(rawPath, `${JSON.stringify(attempt)}\n`);
        counts[attempt.outcome]++;
        if (attempts.length % 10 === 0 || attempts.length === config.plannedAttempts) {
            console.log(`${attempts.length}/${config.plannedAttempts}: ${JSON.stringify(counts)}`);
        }
    });
    const reports = await writeReports({
        outputDir: options.outputDir,
        attempts,
        capabilities,
        config,
        revision,
        levels: LEVEL_CONFIGS.filter((level) => options.levelIds.includes(level.id)),
        profiles: BENCHMARK_PROFILES.filter((profile) => options.profileIds.includes(profile.id)),
    });
    console.log(JSON.stringify({ attempts: attempts.length, counts, paths: reports.paths }, null, 2));
    if (counts.error > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
    const operation = process.argv.includes('--worker') ? workerMain() : main();
    operation.catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
}
