/** Offline construction, adaptive execution and replay experiments with preserved provenance. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function integer(value, name, min, max) {
    if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer`);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
        throw new Error(`${name} must be between ${min} and ${max}`);
    }
    return number;
}

export function parseOptions(args) {
    const command = args[0];
    if (!command || command === '--help' || command === 'help') return { help: true };
    if (!['search', 'replay', 'online', 'replay-online'].includes(command)) {
        throw new Error('Choose search, replay, online or replay-online');
    }
    const searchArguments = [
        'level', 'seed', 'max-pieces', 'beam-width', 'max-nodes', 'nodes-per-plan',
        'unknown-tail-depth', 'setup-strategy',
    ];
    const timingArguments = ['reaction-ms', 'action-ms', 'max-seconds'];
    const commandArguments = {
        search: searchArguments,
        replay: ['candidate', 'mode', ...timingArguments],
        online: [...searchArguments, ...timingArguments, 'timing-policy', 'max-decisions', 'replans-per-piece'],
        'replay-online': ['witness'],
    };
    const allowed = new Set(['output', 'wall-ms', 'help', ...commandArguments[command]]);
    const values = {};
    for (let index = 1; index < args.length; index++) {
        const match = args[index].match(/^--([^=]+)(?:=(.*))?$/);
        if (!match || !allowed.has(match[1])) throw new Error(`Unknown argument: ${args[index]}`);
        const [, name, inline] = match;
        if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: --${name}`);
        if (name === 'help') {
            if (inline !== undefined) throw new Error('--help does not take a value');
            values.help = true;
        } else {
            const value = inline ?? args[++index];
            if (value === undefined || value === '' || value.startsWith('--')) {
                throw new Error(`Missing value for --${name}`);
            }
            values[name] = value;
        }
    }
    if (values.help) return { help: true };
    if (!values.output) throw new Error('--output is required; use a new directory for each experiment');
    const options = {
        command,
        outputDir: resolve(values.output),
        wallBudgetMs: integer(values['wall-ms'] ?? 120000, 'wall-ms', 100, 3600000),
    };
    if (command === 'replay-online') {
        if (!values.witness) throw new Error('--witness is required');
        return { ...options, witnessPath: resolve(values.witness) };
    }
    const timing = () => ({
        reactionMs: integer(values['reaction-ms'] ?? 150, 'reaction-ms', 0, 10000),
        actionIntervalMs: integer(values['action-ms'] ?? 100, 'action-ms', 1, 10000),
        maxSimSeconds: integer(values['max-seconds'] ?? 1800, 'max-seconds', 1, 7200),
    });
    if (command === 'search' || command === 'online') {
        const setupStrategy = values['setup-strategy'] ?? 'none';
        if (!['none', 'structural-v1'].includes(setupStrategy)) {
            throw new Error('setup-strategy must be none or structural-v1');
        }
        const timingPolicy = values['timing-policy'] ?? 'fixed-cadence';
        if (timingPolicy !== 'fixed-cadence') throw new Error('timing-policy must be fixed-cadence');
        const levelId = integer(values.level, 'level', 1, 59);
        if (![49, 55, 59].includes(levelId)) throw new Error('Targeted search supports orbs 49, 55 and 59');
        return {
            ...options,
            ...(command === 'online' ? {
                ...timing(),
                timingPolicy,
                maxDecisions: integer(values['max-decisions'] ?? 2048, 'max-decisions', 1, 100000),
                maxReplansPerPiece: integer(values['replans-per-piece'] ?? 64, 'replans-per-piece', 1, 1024),
            } : {}),
            setupStrategy,
            levelId,
            seed: integer(values.seed, 'seed', 0, 4294967295),
            maxPieces: integer(values['max-pieces'] ?? 192, 'max-pieces', 1, 1024),
            beamWidth: integer(values['beam-width'] ?? 8, 'beam-width', 1, 64),
            maxNodes: integer(values['max-nodes'] ?? 240000, 'max-nodes', 1, 10000000),
            maxNodesPerPlan: integer(values['nodes-per-plan'] ?? 2400, 'nodes-per-plan', 1, 100000),
            unknownTailDepth: integer(values['unknown-tail-depth'] ?? 1, 'unknown-tail-depth', 0, 1),
        };
    }
    if (!values.candidate) throw new Error('--candidate is required');
    const mode = values.mode ?? 'untimed';
    if (!['untimed', 'timed'].includes(mode)) throw new Error('mode must be untimed or timed');
    return {
        ...options,
        candidatePath: resolve(values.candidate),
        mode,
        ...timing(),
    };
}

/** Hash the actual application and experiment bytes, using full relative-path ordering. */
export function captureSourceRevision(root = repoRoot) {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    const names = [...new Set(git([
        'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
        'src', 'package.json', 'package-lock.json', 'scripts/odyssey-benchmark.mjs',
        'scripts/odyssey-benchmark', 'scripts/odyssey-mastery.mjs',
    ]).split('\0').filter((name) => /\.(?:[cm]?[jt]s|json)$/.test(name)))].sort();
    const digest = createHash('sha256');
    const files = {};
    for (const name of names) {
        const path = resolve(root, name);
        if (!existsSync(path)) throw new Error(`Tracked source is missing: ${name}`);
        const bytes = readFileSync(path);
        files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
        digest.update(`${name}\0`);
        digest.update(bytes);
    }
    return {
        revision: {
            head: git(['rev-parse', 'HEAD']).trim(),
            sourceHash: digest.digest('hex'),
            sourceHashAlgorithm: 'sha256 of sorted relative path, NUL, file bytes',
            runtime: { node: process.version, platform: process.platform, arch: process.arch },
            workingTreeStatus: git(['status', '--porcelain']).trim(),
        },
        files,
        patch: git(['diff', '--binary', 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json']),
    };
}

/** Dependency injection supports failure/provenance checks without launching an expensive search. */
export async function executeRun(options, dependencies = {}) {
    if (existsSync(options.outputDir)) throw new Error('Output directory already exists; use a fresh directory');
    const inputPath = options.command === 'replay' ? options.candidatePath : options.witnessPath;
    const inputBytes = inputPath ? readFileSync(inputPath) : null;
    const input = inputBytes ? JSON.parse(inputBytes.toString('utf8')) : null;
    const source = (dependencies.captureSourceRevision || captureSourceRevision)();
    const configuration = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        purpose: 'Exploratory construction, adaptive execution or independent replay; '
            + 'not human calibration or confirmation.',
        options,
        revision: source.revision,
        candidateSha256: options.command === 'replay' ? sha256(inputBytes) : null,
        witnessSha256: options.command === 'replay-online' ? sha256(inputBytes) : null,
    };
    // Non-recursive final mkdir prevents accidental overwrites after the earlier existence check.
    mkdirSync(dirname(options.outputDir), { recursive: true });
    mkdirSync(options.outputDir);
    const write = (name, value) => writeFileSync(resolve(options.outputDir, name), json(value), { flag: 'wx' });
    write('config.json', configuration);
    write('source-manifest.json', source.files);
    writeFileSync(resolve(options.outputDir, 'source.patch'), source.patch, { flag: 'wx' });
    if (inputBytes) {
        const name = options.command === 'replay-online' ? 'input-witness.json' : 'input-candidate.json';
        writeFileSync(resolve(options.outputDir, name), inputBytes, { flag: 'wx' });
    }
    const started = process.hrtime.bigint();
    try {
        let result;
        if (options.command === 'search') {
            const search = dependencies.searchMastery
                || (await import('./odyssey-benchmark/mastery-search.mjs')).searchMastery;
            result = await search({
                ...options,
                onProgress: (progress) => {
                    appendFileSync(resolve(options.outputDir, 'progress.jsonl'), `${JSON.stringify(progress)}\n`);
                },
            });
        } else if (options.command === 'online') {
            const online = dependencies.runOnlineMastery
                || (await import('./odyssey-benchmark/mastery-online.mjs')).runOnlineMastery;
            result = await online({
                ...options,
                onProgress: (progress) => {
                    appendFileSync(resolve(options.outputDir, 'progress.jsonl'), `${JSON.stringify(progress)}\n`);
                },
            });
        } else if (options.command === 'replay-online') {
            const replay = dependencies.replayOnlineMastery
                || (await import('./odyssey-benchmark/mastery-online.mjs')).replayOnlineMastery;
            result = await replay(input, options);
        } else {
            const replay = dependencies.replayMasteryCandidate
                || (await import('./odyssey-benchmark/mastery-replay.mjs')).replayMasteryCandidate;
            result = await replay(input, options);
        }
        const filenames = {
            search: 'candidate.json', replay: 'replay.json', online: 'witness.json', 'replay-online': 'replay.json',
        };
        const filename = filenames[options.command];
        write(filename, result);
        const bytes = readFileSync(resolve(options.outputDir, filename));
        const after = (dependencies.captureSourceRevision || captureSourceRevision)().revision;
        if (after.head !== source.revision.head || after.sourceHash !== source.revision.sourceHash) {
            throw new Error('Source changed during the experiment; result retained but provenance is invalid');
        }
        const summary = {
            status: 'completed',
            command: options.command,
            elapsedWallMs: Number(process.hrtime.bigint() - started) / 1e6,
            result: { path: filename, bytes: bytes.length, sha256: sha256(bytes) },
            revision: source.revision,
            candidateSha256: configuration.candidateSha256,
            witnessSha256: configuration.witnessSha256,
            sourceStable: true,
            interpretation: 'Completed means the tool returned a result. '
                + 'Inspect its validity, termination and mastery fields before making any capability claim.',
        };
        write('summary.json', summary);
        return summary;
    } catch (error) {
        write('failure.json', {
            status: 'error',
            message: String(error?.message || error),
            stack: error?.stack,
            elapsedWallMs: Number(process.hrtime.bigint() - started) / 1e6,
        });
        throw error;
    }
}

export const HELP = `Odyssey targeted mastery experiments (offline; no production retuning)

Search: node scripts/odyssey-mastery.mjs search --level 49 --seed 9101 --output <new-directory>
  --max-pieces 192 --beam-width 8 --max-nodes 240000 --nodes-per-plan 2400
  --unknown-tail-depth 1 --setup-strategy none|structural-v1 --wall-ms 120000

Replay: node scripts/odyssey-mastery.mjs replay --candidate <candidate.json> --output <new-directory>
  --mode untimed|timed --reaction-ms 150 --action-ms 100 --max-seconds 1800 --wall-ms 120000

Online: node scripts/odyssey-mastery.mjs online --level 49 --seed 9101 --output <new-directory>
  Search options plus --reaction-ms 150 --action-ms 100 --max-seconds 1800
  --timing-policy fixed-cadence --max-decisions 2048 --replans-per-piece 64
  Planner wall time is measured but not charged to simulation; real-time feasibility is unverified.

Replay online: node scripts/odyssey-mastery.mjs replay-online --witness <witness.json> --output <new-directory>
  --wall-ms 120000 (uses the witness's recorded command timestamps, without calling the planner)

Every invocation writes its configuration/source fingerprints before outcomes and retains failures.
Search misses are inconclusive. Timed scripted replay is separate from online or human feasibility.
Use development seeds 9101–9103 while changing the solver; reserve confirmation seeds 11001+.
`;

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
    try {
        const options = parseOptions(process.argv.slice(2));
        if (options.help) process.stdout.write(HELP);
        else process.stdout.write(json(await executeRun(options)));
    } catch (error) {
        process.stderr.write(`${error?.stack || error}\n`);
        process.exitCode = 1;
    }
}
