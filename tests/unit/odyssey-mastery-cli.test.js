import {
    afterEach, describe, expect, it,
} from 'vitest';
import {
    existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { executeRun, parseOptions } from '../../scripts/odyssey-mastery.mjs';

const folders = [];
const temporary = () => {
    const folder = mkdtempSync(join(tmpdir(), 'odyssey-mastery-cli-'));
    folders.push(folder);
    return folder;
};
afterEach(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })));
const source = () => ({ revision: { head: 'frozen-test-source', sourceHash: 'source-digest' }, files: {}, patch: '' });

describe('Targeted mastery experiment configuration', () => {
    it('requires an explicit experiment and leaves help side-effect free', () => {
        expect(parseOptions([])).toEqual({ help: true });
        expect(parseOptions(['search', '--help'])).toEqual({ help: true });
        expect(() => parseOptions(['search'])).toThrow(/output/);
        expect(() => parseOptions(['search', '--output=new'])).toThrow(/level/);
    });

    it('allows the larger orb49 budget and keeps compute limits distinct', () => {
        const options = parseOptions(['search', '--level=49', '--seed=9101', '--output=new', '--max-pieces=192']);
        expect(options).toMatchObject({
            levelId: 49,
            seed: 9101,
            maxPieces: 192,
            beamWidth: 8,
            maxNodes: 240000,
            maxNodesPerPlan: 2400,
            unknownTailDepth: 1,
            wallBudgetMs: 120000,
        });
        expect(parseOptions(['search', '--level=55', '--seed=0', '--output=new', '--max-pieces=1024']).maxPieces)
            .toBe(1024);
    });

    it.each([
        ['--level=4'], ['--seed=-1'], ['--seed=4294967296'], ['--max-pieces=1025'],
        ['--max-nodes=0'], ['--beam-width=1.5'], ['--unknown-tail-depth=2'],
        ['--wall-ms=0'], ['--resume'], ['--mode=timed'], ['--max-pieces='],
    ])('rejects invalid or silently incompatible search conditions %j', (arg) => {
        const baseline = ['search', '--level=49', '--seed=9101', '--output=new'];
        const prefix = arg.split('=')[0];
        expect(() => parseOptions([...baseline.filter((item) => !item.startsWith(`${prefix}=`)), arg])).toThrow();
    });

    it('requires an input candidate and preserves exact finite input timing', () => {
        expect(() => parseOptions(['replay', '--output=new'])).toThrow(/candidate/);
        const options = parseOptions(['replay', '--candidate=x.json', '--output=new', '--mode=timed',
            '--reaction-ms=300', '--action-ms=180', '--max-seconds=600']);
        expect(options).toMatchObject({
            mode: 'timed', reactionMs: 300, actionIntervalMs: 180, maxSimSeconds: 600,
        });
        expect(() => parseOptions(['replay', '--candidate=x', '--output=new', '--mode=fast'])).toThrow(/mode/);
        expect(() => parseOptions(['replay', '--candidate=x', '--output=new', '--action-ms=0'])).toThrow();
    });

    it('declares online compute and timing limits without accepting an unimplemented latency model', () => {
        const baseline = ['online', '--level=59', '--seed=9102', '--output=new'];
        expect(parseOptions([...baseline, '--setup-strategy=structural-v1', '--reaction-ms=300', '--action-ms=180']))
            .toMatchObject({
                command: 'online',
                setupStrategy: 'structural-v1',
                timingPolicy: 'fixed-cadence',
                reactionMs: 300,
                actionIntervalMs: 180,
                maxDecisions: 2048,
                maxReplansPerPiece: 64,
                maxNodes: 240000,
                maxSimSeconds: 1800,
            });
        for (const option of ['--setup-strategy=unknown', '--timing-policy=charged-latency',
            '--max-decisions=0', '--replans-per-piece=0', '--action-ms=0', '--mode=timed']) {
            expect(() => parseOptions([...baseline, option])).toThrow();
        }
    });

    it('keeps independent online replay timing inside the witness', () => {
        expect(() => parseOptions(['replay-online', '--output=new'])).toThrow(/witness/);
        expect(parseOptions(['replay-online', '--witness=saved.json', '--output=new']))
            .toMatchObject({ command: 'replay-online', wallBudgetMs: 120000 });
        expect(() => parseOptions(['replay-online', '--witness=saved.json', '--output=new', '--action-ms=1']))
            .toThrow(/Unknown argument/);
    });
});

describe('Experiment preservation', () => {
    it('records configuration before search, retains progress, and checksums an inconclusive result', async () => {
        const outputDir = join(temporary(), 'run');
        const options = parseOptions(['search', '--level=49', '--seed=9101', `--output=${outputDir}`]);
        const result = { status: 'inconclusive', termination: 'node-budget', trace: [] };
        const summary = await executeRun(options, {
            captureSourceRevision: source,
            searchMastery: async (received) => {
                expect(JSON.parse(readFileSync(join(outputDir, 'config.json'))).options).toEqual(options);
                expect(existsSync(join(outputDir, 'source-manifest.json'))).toBe(true);
                received.onProgress({ piece: 1 });
                return result;
            },
        });
        const saved = readFileSync(join(outputDir, 'candidate.json'));
        expect(JSON.parse(saved)).toEqual(result);
        expect(summary.result.sha256).toBe(createHash('sha256').update(saved).digest('hex'));
        expect(readFileSync(join(outputDir, 'progress.jsonl'), 'utf8')).toBe('{"piece":1}\n');
        await expect(executeRun(options, { captureSourceRevision: source })).rejects.toThrow(/already exists/);
        expect(readFileSync(join(outputDir, 'candidate.json'))).toEqual(saved);
    });

    it('preserves failed searches instead of erasing or relabeling them', async () => {
        const outputDir = join(temporary(), 'failure');
        const options = parseOptions(['search', '--level=55', '--seed=9102', `--output=${outputDir}`]);
        await expect(executeRun(options, {
            captureSourceRevision: source,
            searchMastery: async () => { throw new Error('physics mismatch'); },
        })).rejects.toThrow('physics mismatch');
        expect(JSON.parse(readFileSync(join(outputDir, 'failure.json'))))
            .toMatchObject({ status: 'error', message: 'physics mismatch' });
        expect(existsSync(join(outputDir, 'config.json'))).toBe(true);
        expect(existsSync(join(outputDir, 'summary.json'))).toBe(false);
    });

    it('retains the result but rejects provenance if source changes during execution', async () => {
        const outputDir = join(temporary(), 'changed-source');
        const options = parseOptions(['search', '--level=49', '--seed=9101', `--output=${outputDir}`]);
        let captures = 0;
        await expect(executeRun(options, {
            captureSourceRevision: () => ({
                ...source(), revision: { head: 'same-head', sourceHash: String(captures++) },
            }),
            searchMastery: async () => ({ status: 'inconclusive', trace: [] }),
        })).rejects.toThrow(/Source changed/);
        expect(existsSync(join(outputDir, 'candidate.json'))).toBe(true);
        expect(existsSync(join(outputDir, 'failure.json'))).toBe(true);
        expect(existsSync(join(outputDir, 'summary.json'))).toBe(false);
    });

    it('copies exact candidate bytes and their checksum before independent replay', async () => {
        const parent = temporary();
        const candidatePath = join(parent, 'candidate.json');
        const bytes = '{"levelId":59,"seed":9103,"trace":[]}\n';
        writeFileSync(candidatePath, bytes);
        const outputDir = join(parent, 'replay');
        const options = parseOptions([
            'replay', `--candidate=${candidatePath}`, `--output=${outputDir}`, '--mode=timed',
        ]);
        await executeRun(options, {
            captureSourceRevision: source,
            replayMasteryCandidate: async (candidate, timing) => {
                expect(candidate).toEqual(JSON.parse(bytes));
                expect(timing.mode).toBe('timed');
                expect(readFileSync(join(outputDir, 'input-candidate.json'), 'utf8')).toBe(bytes);
                return { qualified: false, termination: 'automatic-lock-divergence' };
            },
        });
        const config = JSON.parse(readFileSync(join(outputDir, 'config.json')));
        expect(config.candidateSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('preserves the online witness and replays its exact bytes without calling the planner', async () => {
        const parent = temporary();
        const outputDir = join(parent, 'online');
        const options = parseOptions(['online', '--level=55', '--seed=9101', `--output=${outputDir}`]);
        const witness = {
            kind: 'online-mastery-witness',
            outcome: 'censored',
            commands: [],
            plannerWallTimeChargedToSimulation: false,
            realtimePlanningFeasibility: 'unverified',
        };
        await executeRun(options, {
            captureSourceRevision: source,
            runOnlineMastery: async (received) => {
                expect(JSON.parse(readFileSync(join(outputDir, 'config.json'))).options).toEqual(options);
                received.onProgress({ completedLocks: 1 });
                return witness;
            },
        });
        const witnessPath = join(outputDir, 'witness.json');
        const bytes = readFileSync(witnessPath);
        const replayDir = join(parent, 'replay');
        const replayOptions = parseOptions([
            'replay-online', `--witness=${witnessPath}`, `--output=${replayDir}`,
        ]);
        const summary = await executeRun(replayOptions, {
            captureSourceRevision: source,
            runOnlineMastery: () => { throw new Error('Replay must not call the planner'); },
            replayOnlineMastery: async (received) => {
                expect(received).toEqual(witness);
                expect(readFileSync(join(replayDir, 'input-witness.json'))).toEqual(bytes);
                return { replayValid: true, outcome: 'censored' };
            },
        });
        expect(summary.witnessSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
        expect(summary.candidateSha256).toBe(null);
        expect(summary.result.path).toBe('replay.json');
    });
});
