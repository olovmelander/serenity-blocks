import {
    afterEach, describe, expect, it,
} from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSummary, writeReports } from '../../scripts/odyssey-benchmark/report.mjs';

const profiles = [{ id: 'stacker', label: 'Conservative stacker' }, { id: 'expert', label: 'Objective specialist' }];
const level = (id = 1, type = 'lines', target = 10, baseMode = 'standard') => ({
    id,
    name: `Orb ${id}`,
    chapter: 1,
    mechanics: { baseMode },
    victory: { primary: { type, target }, bonuses: [] },
    stars: { one: { [type]: target }, three: { [type]: target, maxCascadeDepth: 8 } },
});
const attempt = (overrides = {}) => ({
    levelId: 1,
    seed: 1001,
    profileId: 'stacker',
    outcome: 'win',
    reason: 'objective',
    elapsedSeconds: 10,
    pieces: 15,
    stars: 2,
    metrics: {
        lines: 10, score: 1000, cascades: 2, maxCascadeDepth: 2, maxCombo: 2,
    },
    wallMs: 100,
    ...overrides,
});
const summarize = (attempts, extra = {}) => buildSummary({
    attempts, levels: [level()], profiles, ...extra,
});
const temporaryDirs = [];
afterEach(async () => {
    const targets = temporaryDirs.splice(0).map((directory) => {
        const target = resolve(directory);
        if (!target.startsWith(resolve(tmpdir(), 'odyssey-benchmark-report-'))) throw new Error('Unexpected test directory');
        return target;
    });
    await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));
});

describe('Odyssey benchmark aggregation', () => {
    it('keeps censored/error attempts outside the terminal denominator and exposes unresolved bounds', () => {
        const summary = summarize([
            attempt(), attempt({ seed: 2, outcome: 'loss', reason: 'top-out' }),
            attempt({ seed: 3, outcome: 'censored', reason: 'wall-budget' }),
            attempt({ seed: 4, outcome: 'error', reason: 'physics-rejected' }),
        ]);
        const group = summary.groups[0];
        expect(group.counts).toEqual({
            win: 1, loss: 1, censored: 1, error: 1,
        });
        expect(group.successRate).toBe(0.5);
        expect(group.terminal).toBe(2);
        expect(group.completionCoverage).toBe(0.5);
        expect(group.overallWinBounds).toEqual({ low: 0.25, high: 0.75, denominator: 4 });
        expect(group.failureCauses).toEqual({ 'top-out': 1 });
        expect(group.censorCauses).toEqual({ 'wall-budget': 1 });
        expect(group.errorCauses).toEqual({ 'physics-rejected': 1 });
    });

    it('normalizes a budget mislabeled as a loss without converting real authored time failures', () => {
        const summary = summarize([
            attempt({ outcome: 'loss', reason: 'simulation-budget' }),
            attempt({ seed: 2, outcome: 'loss', reason: 'time' }),
        ]);
        expect(summary.groups[0].counts).toEqual({
            win: 0, loss: 1, censored: 1, error: 0,
        });
        expect(summary.warnings[0]).toContain('normalized to censored');
    });

    it('uses Wilson intervals at the boundaries and leaves empty cells unknown', () => {
        const summary = summarize([attempt()]);
        const successful = summary.groups[0];
        expect(successful.interval95.low).toBeCloseTo(0.2065493144, 9);
        expect(successful.interval95.high).toBeCloseTo(1, 12);
        const empty = summary.groups[1];
        expect(empty.status).toBe('not-run');
        expect(empty.successRate).toBeNull();
        expect(empty.interval95).toBeNull();
        expect(empty.completionCoverage).toBeNull();
        const zero = summarize([attempt({ outcome: 'loss' })]).groups[0];
        expect(zero.interval95.low).toBeCloseTo(0, 12);
        expect(zero.interval95.high).toBeCloseTo(0.7934506856, 9);
    });

    it('keeps terminal durations separate from capped observations and counts awarded win stars only', () => {
        const group = summarize([
            attempt({ elapsedSeconds: 10, stars: 1 }),
            attempt({ seed: 2, elapsedSeconds: 30, stars: 3 }),
            attempt({
                seed: 3, elapsedSeconds: 20, stars: 0, outcome: 'loss',
            }),
            attempt({
                seed: 4, elapsedSeconds: 1000, stars: 3, outcome: 'censored', goalReached: true, lapCensored: true,
            }),
        ]).groups[0];
        expect(group.durations.terminal).toEqual({
            n: 3, median: 20, p90: 28, p95: 29, max: 30,
        });
        expect(group.durations.censored.median).toBe(1000);
        expect(group.stars).toEqual({
            0: 0, 1: 1, 2: 0, 3: 1, missing: 0,
        });
        expect(group.showcase).toMatchObject({ goalReached: 1, lapCensored: 1 });
        expect(group.counts.win).toBe(2);
    });

    it('maps combo to maxCombo and tracks exact upper-bound time/death star deficits', () => {
        const config = level(1, 'combo', 8);
        config.stars.three = { combo: 8, time: 30, maxDeaths: 1 };
        const group = summarize([attempt({
            elapsedSeconds: 30.9,
            metrics: {
                combos: 40, maxCombo: 3, time: 30.9, deaths: 2,
            },
        })], { levels: [config] }).groups[0];
        expect(group.goals.primary.metric).toBe('maxCombo');
        expect(group.goals.primary.remaining.median).toBe(5);
        const goals = group.goals.stars.find((star) => star.tier === 'three').conditions;
        expect(goals.find((goal) => goal.metric === 'time').remaining.median).toBeCloseTo(0.9);
        expect(goals.find((goal) => goal.metric === 'deaths').remaining.median).toBe(1);
    });

    it('does not invent zero-valued metrics for missing observations or runtime errors', () => {
        const group = summarize([
            attempt({ metrics: {}, outcome: 'censored' }),
            attempt({ seed: 2, metrics: { lines: 8 } }),
            attempt({ seed: 3, metrics: { lines: 0 }, outcome: 'error' }),
        ]).groups[0];
        expect(group.goals.primary.observations).toBe(1);
        expect(group.goals.primary.remaining.median).toBe(2);
        expect(group.metrics.maxCascadeDepth.n).toBe(0);
        expect(group.metrics.maxCascadeDepth.median).toBeNull();
    });

    it('fences actual fail statuses by nested mechanics scope, including orbs with no attempts', () => {
        const capabilities = {
            status: 'fail',
            mechanics: {
                status: 'fail',
                fixtures: [{
                    id: 'infinity-roof', status: 'fail', scope: { baseModes: ['infinity'], objectiveTypes: ['cascade'] },
                }],
            },
            profiles: [],
        };
        const summary = summarize([attempt()], {
            capabilities, levels: [level(), level(2, 'cascade', 5, 'infinity')],
        });
        expect(summary.groups.find((group) => group.levelId === 1 && group.profileId === 'stacker').successRate).toBe(1);
        const unsupported = summary.groups.filter((group) => group.levelId === 2);
        expect(unsupported).toHaveLength(2);
        expect(unsupported.every((group) => group.status === 'inconclusive' && group.successRate === null)).toBe(true);
    });

    it('does not smear a mixed overall strategy result onto other profiles or unrelated objectives', () => {
        const capabilities = {
            version: 1,
            timed: false,
            status: 'inconclusive',
            mechanics: { status: 'pass', fixtures: [{ id: 'standard-two-wave', status: 'pass' }] },
            profiles: [
                {
                    profileId: 'stacker',
                    status: 'inconclusive',
                    validatedMaxCascadeDepth: 2,
                    scope: { baseModes: ['standard', 'infinity'], objectiveTypes: ['cascade', 'combo'] },
                },
                { profileId: 'expert', status: 'pass', validatedMaxCascadeDepth: 2 },
            ],
        };
        const summary = summarize([
            attempt(), attempt({ profileId: 'expert' }),
            attempt({ levelId: 2 }), attempt({ levelId: 2, profileId: 'expert' }),
        ], { capabilities, levels: [level(), level(2, 'cascade', 5, 'infinity')] });
        expect(summary.groups.filter((group) => group.evidence.inconclusive).map((group) => [group.levelId, group.profileId]))
            .toEqual([[2, 'stacker']]);
        expect(summary.groups.find((group) => group.levelId === 2 && group.profileId === 'expert').successRate).toBe(1);
        expect(summary.groups.every((group) => group.evidence.strategyUnvalidated)).toBe(true);
        expect(summary.groups[0].evidence.limitations.join(' ')).toContain('strategy remains unvalidated');
    });

    it('makes unsafely failed shared cache validation inconclusive even alongside a scoped failure', () => {
        const summary = summarize([attempt()], {
            capabilities: {
                mechanics: {
                    status: 'fail',
                    connectivityCacheCollision: { status: 'fail' },
                    fixtures: [{
                        id: 'infinity', status: 'fail', scope: { baseModes: ['infinity'] },
                    }],
                },
            },
        });
        expect(summary.groups.every((group) => group.evidence.inconclusive)).toBe(true);
    });

    it('reports actual duel names/counters at stop and does not mix capped duration into terminal duration', () => {
        const group = summarize([
            attempt({
                duel: {
                    botName: 'Cinder', playerFrags: 7, botFrags: 2, deaths: 2, round: 9,
                },
            }),
            attempt({
                seed: 2,
                outcome: 'censored',
                elapsedSeconds: 200,
                duel: {
                    botName: 'Cinder', playerFrags: 3, botFrags: 1, deaths: 1, round: 5,
                },
            }),
        ], { levels: [level(1, 'frags', 7)] }).groups[0];
        expect(group.duel.botNames).toEqual(['Cinder']);
        expect(group.duel.playerFrags.median).toBe(5);
        expect(group.duel.deaths.median).toBe(1.5);
        expect(group.duel.duration.median).toBe(105);
        expect(group.durations.terminal.median).toBe(10);
    });

    it('compares only matched terminal seeds and separately excludes duplicate/unresolved pairs', () => {
        const attempts = [
            attempt({ seed: 1 }), attempt({ seed: 1, profileId: 'expert', outcome: 'loss' }),
            attempt({ seed: 2, outcome: 'loss' }), attempt({ seed: 2, profileId: 'expert' }),
            attempt({ seed: 3 }), attempt({ seed: 3, profileId: 'expert', outcome: 'censored' }),
            attempt({ seed: 4 }), attempt({ seed: 4 }), attempt({ seed: 4, profileId: 'expert' }),
            attempt({ seed: 5 }),
        ];
        const pair = summarize(attempts).pairedComparisons[0];
        expect(pair.matchedSeeds).toBe(4);
        expect(pair.terminalPairs).toBe(2);
        expect(pair.counts).toEqual({
            bothWin: 0, bothLoss: 0, aOnlyWin: 1, bOnlyWin: 1, unresolved: 1, duplicateSeeds: 1,
        });
        expect(pair.winRateDifferenceBMinusA).toBe(0);
        expect(pair.pairedCompletionCoverage).toBe(0.5);
    });

    it('rejects spike verdicts in a pilot or selectively censored run and only flags measured review candidates', () => {
        const attempts = (samples, censor = false) => Array.from({ length: samples }, (_, seed) => [
            attempt({ seed }), attempt({ seed, levelId: 2, outcome: 'loss' }),
            ...(censor ? [attempt({ seed: seed + 100, outcome: 'censored' }),
                attempt({ seed: seed + 100, levelId: 2, outcome: 'censored' })] : []),
        ]).flat();
        const options = { levels: [level(), level(2, 'lines', 12)] };
        expect(summarize(attempts(5), options).reviewCandidates).toEqual([]);
        expect(summarize(attempts(20, true), options).reviewCandidates).toEqual([]);
        const candidate = summarize(attempts(20), options).reviewCandidates[0];
        expect(candidate.fromLevelId).toBe(1);
        expect(candidate.toLevelId).toBe(2);
        expect(candidate.pairedSeeds).toBe(20);
        expect(candidate.interpretation).toContain('Review candidate only');
    });

    it('preserves primary showcase wins while declaring truncated star quality and the exact run revision', () => {
        const revision = { head: 'abcdef0123456789', benchmarkHash: '1234567890abcdef', workingTreeImplementation: true };
        const summary = summarize([
            attempt({
                reason: 'showcase-finished', stars: 1, goalReached: true, lapCensored: true, lapEndReason: 'wall-budget',
            }),
            attempt({
                seed: 2, outcome: 'censored', reason: 'wall-budget', goalReached: true,
            }),
        ], { revision });
        expect(summary.totals.counts).toEqual({
            win: 1, loss: 0, censored: 1, error: 0,
        });
        expect(summary.totals.stars[1]).toBe(1);
        expect(summary.totals.showcase.lapCensored).toBe(1);
        expect(summary.warnings[0]).toContain('Primary-goal wins remain valid');
        expect(summary.methodology.stars).toContain('understate eventual star quality');
        expect(summary.revision).toEqual(revision);
        expect(summary.revisionLabel).toBe('abcdef012345 · benchmark 1234567890ab · working tree implementation');
    });

    it('keeps scenario and cadence identity separate even when the same orb/policy/seed repeats', () => {
        const summary = summarize([
            attempt(), attempt({ scenarioId: 'slower', outcome: 'loss' }),
            attempt({ cadenceId: 'steady', elapsedSeconds: 50 }),
        ]);
        const actual = summary.groups.filter((group) => group.profileId === 'stacker');
        expect(actual).toHaveLength(3);
        expect(new Set(actual.map((group) => group.groupId)).size).toBe(3);
        expect(actual.every((group) => group.attempted === 1)).toBe(true);
        expect(actual.find((group) => group.scenarioId === 'baseline' && group.cadenceId === 'native').counts.win).toBe(1);
        expect(actual.find((group) => group.scenarioId === 'slower').counts.loss).toBe(1);
        expect(actual.find((group) => group.cadenceId === 'steady').durations.win.median).toBe(50);
        expect(summary.profileSummaries.every((group) => group.interval95 === null)).toBe(true);
        expect(summary.totals.interval95).toBeNull();
        expect(summary.totals.inferenceScope).toBe('descriptive-pooled');
        expect(actual.every((group) => group.interval95 && group.inferenceScope === 'orb-policy-scenario-cadence')).toBe(true);
    });

    it('honors scoped scenario manifests and variant effective goal rules for unrun groups', () => {
        const variant = { ...level(2), victory: { primary: { type: 'lines', target: 99 } } };
        const summary = summarize([], {
            levels: [level(), level(2)],
            config: {
                scenarioIds: ['baseline', 'slower'],
                cadenceIds: ['native', 'steady'],
                scenarios: [{ id: 'baseline', label: 'Authored rules', levelIds: null }, { id: 'slower', label: 'Slower orb', levelIds: [2] }],
                effectiveLevels: [{ scenarioId: 'slower', level: variant }],
            },
        });
        expect(summary.groups).toHaveLength(12);
        expect(summary.groups.some((group) => group.levelId === 1 && group.scenarioId === 'slower')).toBe(false);
        const unrun = summary.groups.find((group) => group.levelId === 2 && group.scenarioId === 'slower');
        expect(unrun.target).toBe(99);
        expect(unrun.scenarioLabel).toBe('Slower orb');
        expect(unrun.status).toBe('not-run');
        expect(unrun.interval95).toBeNull();
    });

    it('pairs variants only at a fixed policy/cadence and separates primary wins from capped quality', () => {
        const summary = summarize([
            attempt({ seed: 1, stars: 2, goalReachedAtSeconds: 10 }),
            attempt({
                seed: 1, scenarioId: 'slower', stars: 3, goalReachedAtSeconds: 15, elapsedSeconds: 20,
            }),
            attempt({ seed: 2, stars: 1 }),
            attempt({
                seed: 2, scenarioId: 'slower', stars: 2, goalReached: true, lapCensored: true, reason: 'wall-budget',
            }),
            attempt({ seed: 3, cadenceId: 'steady' }),
            attempt({ seed: 3, scenarioId: 'slower', cadenceId: 'native' }),
            attempt({ seed: 4, profileId: 'expert', scenarioId: 'slower' }),
        ]);
        const pair = summary.scenarioComparisons.find((entry) => entry.profileId === 'stacker' && entry.cadenceId === 'native');
        expect(pair.matchedSeeds).toBe(2);
        expect(pair.counts.bothWin).toBe(2);
        expect(pair.quality).toMatchObject({ completePairs: 1, lapCensoredPairs: 1, missingStarPairs: 0 });
        expect(pair.quality.starDifferenceBMinusA.median).toBe(1);
        expect(pair.bothWinPrimaryDurationDifferenceBMinusA.median).toBe(2.5);
        expect(summary.groups.find((group) => group.profileId === 'stacker' && group.scenarioId === 'slower' && group.cadenceId === 'native').counts.win).toBe(3);
    });

    it('keeps policy pairs inside their condition instead of treating variants as duplicate seeds', () => {
        const summary = summarize([
            attempt(), attempt({ profileId: 'expert' }),
            attempt({ scenarioId: 'slower', outcome: 'loss' }), attempt({ scenarioId: 'slower', profileId: 'expert' }),
        ]);
        const pairs = summary.pairedComparisons.filter((pair) => pair.matchedSeeds);
        expect(pairs).toHaveLength(2);
        expect(pairs.every((pair) => pair.matchedSeeds === 1 && pair.counts.duplicateSeeds === 0)).toBe(true);
        expect(pairs.find((pair) => pair.scenarioId === 'slower').winRateDifferenceBMinusA).toBe(1);
    });

    it('measures duel attack throughput, completed round coverage and actual input-lock ownership', () => {
        const telemetry = {
            players: [{
                attackLinesSent: 30, cleanLinesSent: 4, deaths: 2, creditedDeaths: 1, uncreditedDeaths: 1,
            }, { attackLinesSent: 12 }],
            activeSeconds: 60,
            resolutionSeconds: 20,
            intermissionSeconds: 10,
            rounds: [
                {
                    round: 1,
                    completed: true,
                    durationSeconds: 50,
                    activeSeconds: 40,
                    players: [{ attackLinesSent: 20 }, {}],
                    deathEvents: [{ victimIndex: 0, attackerIndex: 1, credited: true }],
                },
                {
                    round: 2,
                    completed: false,
                    durationSeconds: 40,
                    activeSeconds: 20,
                    players: [{ attackLinesSent: 10 }, {}],
                    deathEvents: [{ victimIndex: 0, attackerIndex: null, credited: false }],
                },
            ],
        };
        const summary = summarize([attempt({
            elapsedSeconds: 120,
            duel: { telemetry },
            telemetry: {
                locks: {
                    input: 7, automatic: 3, hardDrop: 6, softDrop: 1,
                },
                failedActions: 2,
                legalSoftDropStops: 5,
                policy: {
                    replans: 19, fallbackDrops: 1, pieceRetries: 19, maxPieceRetries: 3,
                },
            },
        })]);
        const group = summary.groups[0];
        expect(group.duel.telemetry.players[0].attackLinesPerActiveMinute.median).toBe(30);
        expect(group.duel.telemetry.players[0].attackLinesPerMatchMinute.median).toBe(15);
        expect(group.duel.telemetry.players[0].cleanLinesSent.median).toBe(4);
        expect(group.duel.telemetry.players[0].uncreditedDeaths.median).toBe(1);
        expect(group.duel.telemetry.rounds.map((round) => round.completed)).toEqual([1, 0]);
        expect(group.duel.telemetry.rounds[1].deathEvents).toEqual({ credited: 0, uncredited: 1 });
        expect(group.inputTelemetry.locks.automatic.median).toBe(3);
        expect(group.inputTelemetry.legalSoftDropStops.median).toBe(5);
        expect(group.inputTelemetry.policy.replans.median).toBe(19);
        expect(group.inputTelemetry.policy.fallbackDrops.median).toBe(1);
        expect(group.inputTelemetry.policy.maxPieceRetries.median).toBe(3);
        expect(group.duel.telemetry.interpretation).toContain('No cancellation counter');
    });

    it('pairs measured attack-rate and completed-round deltas without including partial rounds', () => {
        const duel = (lines, duration, completed = true) => ({
            telemetry: {
                activeSeconds: 60,
                players: [{ attackLinesSent: lines }, { attackLinesSent: lines / 2 }],
                rounds: [{ round: 1, completed, durationSeconds: duration }, { round: 2, completed: false, durationSeconds: 99 }],
            },
        });
        const pair = summarize([
            attempt({ duel: duel(10, 20) }), attempt({ scenarioId: 'slower', duel: duel(25, 35) }),
        ]).scenarioComparisons[0];
        expect(pair.duelAttackLinesPerActiveMinuteDifferenceBMinusA.map((player) => player.median)).toEqual([15, 7.5]);
        expect(pair.completedRoundDurationDifferenceBMinusA).toMatchObject({ n: 1, median: 15 });
    });

    it('uses real empty-board construction evidence without invalidating unrelated authored objectives', () => {
        const capabilities = {
            status: 'pass',
            mechanics: { status: 'pass' },
            profiles: [{
                profileId: 'stacker',
                status: 'pass',
                validatedMaxCascadeDepth: 8,
                construction: {
                    kind: 'empty-board-construction',
                    timed: false,
                    status: 'inconclusive',
                    scope: { baseModes: ['standard', 'infinity'], objectiveTypes: ['cascade', 'combo'] },
                    validatedMaxCascadeDepth: 2,
                    targets: [{ targetDepth: 8, status: 'inconclusive' }],
                },
            }],
        };
        const group = summarize([attempt()], { capabilities }).groups[0];
        expect(group.successRate).toBe(1);
        expect(group.evidence.inconclusive).toBe(false);
        expect(group.evidence).toMatchObject({ preparedDepth: 8, constructedDepth: 2, strategyUnvalidated: true });
        expect(group.evidence.limitations.join(' ')).toContain('empty-board construction');
    });

    it('does not promote a single observed deep construction into all-seed target validation', () => {
        const capabilities = {
            profiles: [{
                profileId: 'stacker',
                status: 'pass',
                validatedMaxCascadeDepth: 2,
                construction: {
                    kind: 'empty-board-construction',
                    timed: false,
                    status: 'pass',
                    validatedMaxCascadeDepth: 8,
                    targets: [
                        {
                            targetDepth: 3, status: 'pass', passedDemonstrations: 6, totalDemonstrations: 6,
                        },
                        {
                            targetDepth: 8, status: 'inconclusive', passedDemonstrations: 1, totalDemonstrations: 6,
                        },
                    ],
                },
            }],
        };
        const unsupported = summarize([attempt()], { capabilities }).groups[0];
        expect(unsupported.evidence).toMatchObject({ constructedDepth: 8, constructionValidatedDepth: 3, strategyUnvalidated: true });
        const config = level();
        config.stars.three.maxCascadeDepth = 3;
        const supported = summarize([attempt()], { capabilities, levels: [config] }).groups[0];
        expect(supported.evidence.strategyUnvalidated).toBe(false);
        expect(supported.evidence.preparedDepth).toBe(2);
    });

    it('reports authored lap windows as unlimited and optional caps as separate quality censoring', () => {
        const group = summarize([
            attempt({
                goalReached: true,
                goalReachedAtSeconds: 10,
                elapsedSeconds: 100,
                stars: 3,
                showcaseFinishPolicy: { mode: 'authored-deadline', maxLapSeconds: null },
            }),
            attempt({
                seed: 2,
                goalReached: true,
                goalReachedAtSeconds: 20,
                elapsedSeconds: 80,
                stars: 1,
                qualityCensored: true,
                reason: 'simulation-budget',
                showcaseFinishPolicy: { mode: 'explicit-lap-window', maxLapSeconds: 60 },
            }),
        ]).groups[0];
        expect(group.counts.win).toBe(2);
        expect(group.showcase.lapWindows).toEqual([null, 60]);
        expect(group.showcase.primarySeconds.median).toBe(15);
        expect(group.showcase.completeQualityWins).toBe(1);
        expect(group.showcase.completeQualityStars.median).toBe(3);
        expect(group.showcase.qualityCensored).toBe(1);
        expect(group.showcase.primaryCensored).toBe(0);
    });

    it('writes portable, JSON-safe reports and prevents HTML/script injection from data labels', async () => {
        const outputDir = await mkdtemp(join(tmpdir(), 'odyssey-benchmark-report-'));
        temporaryDirs.push(outputDir);
        const malicious = '</script><img src=x onerror="window.INJECTED=true">';
        const result = await writeReports({
            outputDir,
            attempts: [attempt({ outcome: 'loss', reason: 'wall-budget', wallMs: Infinity })],
            levels: [{ ...level(), name: malicious }],
            profiles,
            config: { capSeconds: 30, large: 2n, invalid: NaN },
            revision: { head: 'abc123', benchmarkHash: 'def456', workingTreeImplementation: true },
        });
        const raw = JSON.parse((await readFile(result.paths.raw, 'utf8')).trim());
        expect(raw.outcome).toBe('loss');
        expect(raw.wallMs).toBeNull();
        expect(raw.scenarioId).toBe('baseline');
        expect(raw.cadenceId).toBe('native');
        expect(raw.attemptId).toBe('[1,"stacker","baseline","native",1001]');
        const summary = JSON.parse(await readFile(result.paths.summary, 'utf8'));
        expect(summary.config).toEqual({ capSeconds: 30, large: '2', invalid: null });
        expect(summary.groups[0].counts.censored).toBe(1);
        expect(summary.levels[0].name).toBe(malicious);
        const html = await readFile(result.paths.html, 'utf8');
        expect(html).not.toContain(malicious);
        expect(html).toContain('\\u003c/script>');
        expect(html).toContain('__ODYSSEY_REPORT_READY__');
        expect(html).not.toMatch(/<script[^>]+src=/);
        expect(html).toContain('Completion coverage');
        expect(html).toContain('id="heatmap"');
        expect(html).toContain('id="curve"');
        expect(html).toContain('id="scenario"');
        expect(html).toContain('id="cadence"');
        expect(html).toContain('id="variant-rows"');
        const markdown = await readFile(result.paths.markdown, 'utf8');
        expect(markdown).toContain('Preliminary pilot');
        expect(markdown).toContain('Revision: abc123');
        expect(markdown).not.toContain('[object Object]');
    });
});
