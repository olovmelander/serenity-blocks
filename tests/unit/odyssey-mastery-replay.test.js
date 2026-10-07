/* eslint-disable no-await-in-loop -- Each replay owns one process-local virtual clock. */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { demonstrateAuthoredConstruction } from '../../scripts/odyssey-benchmark/authored-construction.mjs';
import { replayMasteryCandidate } from '../../scripts/odyssey-benchmark/mastery-replay.mjs';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';
import { BenchmarkBot } from '../../scripts/odyssey-benchmark/profiles.mjs';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const fixtures = new Map();
async function witness(levelId = 55, maxPieces = 3) {
    const key = `${levelId}:${maxPieces}`;
    if (!fixtures.has(key)) {
        fixtures.set(key, await demonstrateAuthoredConstruction({
            levelId, profileId: 'cascade', seed: 9101, maxPieces,
        }));
    }
    return structuredClone(fixtures.get(key));
}

describe('Independent mastery candidate replay', () => {
    it.each([49, 55, 59])('reconstructs orb %i without invoking the candidate planner', async (levelId) => {
        const candidate = await witness(levelId);
        const authored = structuredClone(getLevelById(levelId));
        vi.spyOn(BenchmarkBot.prototype, 'plan').mockImplementation(() => { throw new Error('Planner must not run'); });
        const result = await replayMasteryCandidate(candidate);
        expect(result).toMatchObject({
            status: 'pass',
            timed: false,
            replayValid: true,
            traceComplete: true,
            piecesReplayed: 3,
            automaticLocks: 0,
            metrics: { time: null },
            quality: { timedStars: null },
            timeConstraintsStatus: 'unverified',
        });
        expect(result.metrics.maxCascadeDepth).toBe(candidate.metrics.maxCascadeDepth);
        expect(result.metrics.lines).toBe(candidate.metrics.lines);
        expect(result.trace.map((entry) => entry.boardHashAfter))
            .toEqual(candidate.trace.map((entry) => entry.boardHashAfter));
        expect(result.trace.every((entry) => entry.cellConservation.valid)).toBe(true);
        expect(result.knowledge.certification).toContain('does not certify planner information access');
        expect(getLevelById(levelId)).toEqual(authored);
    });

    it.each([
        ['authored-start-mismatch', (record) => { record.initialBoardHash = '0'.repeat(64); }],
        ['preview-mismatch', (record) => { record.trace[0].preview[2] = 'unknown'; }],
        ['board-continuity-mismatch', (record) => { record.trace[1].boardHashBefore = '0'.repeat(64); }],
        ['board-replay-mismatch', (record) => { record.trace[0].boardHashAfter = '0'.repeat(64); }],
        ['lock-replay-mismatch', (record) => { record.trace[0].lockedPiece.x++; }],
        ['command-after-lock', (record) => { record.trace[0].plannedActions.push({ type: 'move', dir: 1 }); }],
    ])('rejects %s instead of trusting candidate metadata', async (reason, mutate) => {
        const candidate = await witness();
        mutate(candidate);
        const result = await replayMasteryCandidate(candidate);
        expect(result.status).toBe('fail');
        expect(result.replayValid).toBe(false);
        expect(result.failure.reason).toBe(reason);
    });

    it('rejects teleports, fourth previews, zero cadence, and oversized traces', async () => {
        const candidate = await witness();
        const teleport = structuredClone(candidate);
        teleport.trace[0].plannedActions = [{ type: 'setPose', x: 0, y: 0 }];
        await expect(replayMasteryCandidate(teleport)).rejects.toThrow(/legal commands/);
        const fourth = structuredClone(candidate);
        fourth.trace[0].preview.push('T');
        await expect(replayMasteryCandidate(fourth)).rejects.toThrow(/three previews/);
        await expect(replayMasteryCandidate(candidate, { mode: 'timed', actionIntervalMs: 0 }))
            .rejects.toThrow(/positive/);
        await expect(replayMasteryCandidate({ ...candidate, trace: Array(1025).fill(candidate.trace[0]) }))
            .rejects.toThrow(/1 to 1024/);
        // Longer search witnesses are admitted structurally, then checked semantically.
        const long = await replayMasteryCandidate({ ...candidate, trace: Array(129).fill(candidate.trace[0]) });
        expect(long.status).toBe('fail');
        expect(long.failure.reason).toBe('piece-sequence-mismatch');
    });

    it('detects a legal command vocabulary with an unreachable movement path', async () => {
        const candidate = await witness();
        candidate.trace[0].plannedActions = [
            ...Array.from({ length: 20 }, () => ({ type: 'move', dir: -1 })), { type: 'hardDrop' },
        ];
        const result = await replayMasteryCandidate(candidate);
        expect(result.failure.reason).toBe('command-rejected');
        expect(result.trace[0].actions.at(-1).accepted).toBe(false);
    });

    it('uses finite per-piece reactions and action cadence, with fresh held-time scoring', async () => {
        const candidate = await witness();
        const result = await replayMasteryCandidate(candidate, {
            mode: 'timed', reactionMs: 150, actionIntervalMs: 100,
        });
        expect(result).toMatchObject({
            status: 'pass', replayValid: true, traceComplete: true, automaticLocks: 0,
        });
        expect(result.metrics.time).toBeGreaterThan(0);
        expect(result.metrics.score).toBeLessThan(candidate.metrics.score);
        for (const entry of result.trace) {
            expect(entry.actions[0].atMs - entry.spawnAtMs).toBeGreaterThanOrEqual(150 - 1e-7);
            for (let i = 1; i < entry.actions.length; i++) {
                expect(entry.actions[i].atMs - entry.actions[i - 1].atMs).toBeGreaterThanOrEqual(100 - 1e-7);
            }
        }
        expect(result.metrics.time * 1000).toBeGreaterThanOrEqual(result.trace.at(-1).lockAtMs);
        expect(result.finishPolicy.afterShowcasePrimary).toContain('no deadline or three-star auto-finish');
    });

    it('does not disable gravity to rescue an untimed trace at slow reaction speed', async () => {
        const candidate = await witness(49, 1);
        const untimed = await replayMasteryCandidate(candidate);
        expect(untimed.status).toBe('pass');
        const timed = await replayMasteryCandidate(candidate, { mode: 'timed', reactionMs: 60000 });
        expect(timed.status).toBe('fail');
        expect(timed.automaticLocks).toBe(1);
        expect(timed.failure.reason).toBe('automatic-lock');
        expect(timed.trace[0].lockedPiece).toBeDefined();
        expect(timed.trace[0].actions).toHaveLength(0);
    });

    it('drains actual multi-wave physics and charges its waits to timed execution', async () => {
        const candidate = await witness(49, 128);
        expect(candidate.termination).toBe('primary-complete');
        const full = await replayMasteryCandidate(candidate);
        expect(full).toMatchObject({ status: 'pass', outcome: 'win', reason: 'primary-goal' });
        expect(full.metrics.score).toBe(candidate.metrics.score);
        expect(full.trace.reduce((sum, entry) => sum + entry.lineClears.reduce((a, b) => a + b, 0), 0))
            .toBe(full.metrics.lines);
        const firstMulti = candidate.trace.findIndex((entry) => entry.lineClears.length > 1);
        expect(firstMulti).toBeGreaterThanOrEqual(0);
        candidate.trace = candidate.trace.slice(0, firstMulti + 1);
        const timed = await replayMasteryCandidate(candidate, { mode: 'timed' });
        expect(timed.status).toBe('pass');
        const last = timed.trace.at(-1);
        expect(last.lineClears.length).toBeGreaterThan(1);
        expect(last.resolvedAtMs - last.lockAtMs).toBeGreaterThan(300);
        expect(timed.metrics.time * 1000).toBe(last.resolvedAtMs);
        expect(timed.metrics.score).toBeLessThan(candidate.trace.at(-1).metricsAfter.score);
    }, 20000);

    it('uses the real evaluator deadline at the fully settled cascade boundary', async () => {
        const candidate = await witness(49, 128);
        const firstMulti = candidate.trace.findIndex((entry) => entry.lineClears.length > 1);
        candidate.trace = candidate.trace.slice(0, firstMulti + 1);
        const baseline = await replayMasteryCandidate(candidate, { mode: 'timed' });
        const settledSeconds = baseline.trace.at(-1).resolvedAtMs / 1000;
        let deadline = settledSeconds;
        const rules = () => ({
            primary: { type: 'lines', target: baseline.metrics.lines },
            failure: { type: 'time', value: deadline },
        });
        vi.spyOn(GameplayHybridEngine.prototype, 'checkVictory').mockImplementation(function reached() {
            return this.victoryEvaluator.evaluate(this.gameState, rules());
        });
        vi.spyOn(GameplayHybridEngine.prototype, 'checkFailure').mockImplementation(function expired() {
            return this.victoryEvaluator.evaluateFailure(this.gameState, rules());
        });
        const onTime = await replayMasteryCandidate(candidate, { mode: 'timed' });
        expect(onTime).toMatchObject({ outcome: 'win', primaryReached: true, reason: 'primary-goal' });
        deadline -= 0.001;
        const late = await replayMasteryCandidate(candidate, { mode: 'timed' });
        expect(late).toMatchObject({ outcome: 'loss', primaryReached: false, reason: 'deadline' });
        expect(late.metrics.lines).toBe(baseline.metrics.lines);
        expect(late.trace.at(-1).resolvedAtMs).toBe(baseline.trace.at(-1).resolvedAtMs);
    });

    it('censors an unfinished timed prefix when its simulation budget ends', async () => {
        const result = await replayMasteryCandidate(await witness(), {
            mode: 'timed', maxSimSeconds: 0.1,
        });
        expect(result).toMatchObject({
            status: 'inconclusive',
            outcome: 'censored',
            reason: 'simulation-budget',
            traceComplete: false,
            replayValid: true,
            primaryReached: false,
        });
    });

    it('records cleanup physics beyond a harness cutoff without promoting the censored attempt', async () => {
        const candidate = await witness(49, 128);
        const firstMulti = candidate.trace.findIndex((entry) => entry.lineClears.length > 1);
        candidate.trace = candidate.trace.slice(0, firstMulti + 1);
        const full = await replayMasteryCandidate(candidate, { mode: 'timed' });
        const cutoffSeconds = (full.trace.at(-1).lockAtMs + 50) / 1000;
        const limited = await replayMasteryCandidate(candidate, { mode: 'timed', maxSimSeconds: cutoffSeconds });
        expect(limited).toMatchObject({ outcome: 'censored', reason: 'simulation-budget', primaryReached: false });
        expect(limited.stoppedAtSeconds).toBeCloseTo(cutoffSeconds);
        expect(limited.physicsDrainedThroughSeconds).toBeGreaterThan(limited.stoppedAtSeconds);
        expect(limited.trace.at(-1).cellConservation.valid).toBe(true);
    });

    it('keeps tier-three requirements distinct from optional bonus completion', async () => {
        const candidate = await witness();
        vi.spyOn(GameplayHybridEngine.prototype, 'evaluateBonuses').mockReturnValue([false, false, false, false]);
        // Only the evaluator result is stubbed; replay still executes actual seeded commands/physics.
        vi.spyOn(VictoryConditionEvaluator.prototype, 'calculateStars').mockReturnValue(1);
        const result = await replayMasteryCandidate(candidate);
        expect(result.quality.tierThreeConditionsMet).toBe(true);
        expect(result.quality.optionalBonuses.every((bonus) => bonus.conditionMet === false)).toBe(true);
        expect(result.quality.timedStars).toBeNull();
    });

    it('finishes a showcase manually after the candidate ends, without an optional-bonus gate', async () => {
        const candidate = await witness();
        vi.spyOn(GameplayHybridEngine.prototype, 'checkVictory').mockImplementation(function reached() {
            return this.getMetrics().piecesPlaced >= 1;
        });
        vi.spyOn(GameplayHybridEngine.prototype, 'checkFailure').mockImplementation(function expired() {
            return this.getMetrics().piecesPlaced >= 1;
        });
        vi.spyOn(GameplayHybridEngine.prototype, 'calculateStars').mockReturnValue(3);
        const result = await replayMasteryCandidate(candidate, { mode: 'timed' });
        expect(result).toMatchObject({
            status: 'pass',
            outcome: 'win',
            reason: 'manual-showcase-finish',
            primaryReachedAtPiece: 1,
            piecesReplayed: 3,
            qualityCensored: false,
        });
        expect(result.metrics.time).toBeGreaterThan(result.goalReachedAtSeconds);
        expect(result.quality.timedStars).toBeTypeOf('number');
    });

    it('permits zero reaction time while keeping actions on the finite frame/cadence schedule', async () => {
        const result = await replayMasteryCandidate(await witness(), { mode: 'timed', reactionMs: 0 });
        expect(result.status).toBe('pass');
        expect(result.trace[0].actions[0].atMs).toBeGreaterThan(0);
        expect(result.cadence.actionIntervalMs).toBe(100);
    });

    it('retains a primary win while censoring quality on a later harness cutoff', async () => {
        const candidate = await witness();
        vi.spyOn(GameplayHybridEngine.prototype, 'checkVictory').mockImplementation(function reached() {
            return this.getMetrics().piecesPlaced >= 1;
        });
        const full = await replayMasteryCandidate(candidate, { mode: 'timed' });
        const cutoff = await replayMasteryCandidate(candidate, {
            mode: 'timed', maxSimSeconds: full.goalReachedAtSeconds + 0.05,
        });
        expect(cutoff).toMatchObject({
            outcome: 'win',
            reason: 'simulation-budget',
            primaryReached: true,
            qualityCensored: true,
            quality: { censored: true },
            traceComplete: false,
        });
    });

    it('does not use an untimed early auto-finish to dismiss timed score headroom', async () => {
        const candidate = await witness(49);
        vi.spyOn(GameplayHybridEngine.prototype, 'checkVictory').mockImplementation(function reached() {
            return this.gameState.isSeeking && this.getMetrics().piecesPlaced >= 1;
        });
        const untimed = await replayMasteryCandidate(candidate);
        expect(untimed.failure.reason).toBe('untimed-primary-auto-finish');
        expect(untimed.piecesReplayed).toBe(1);
        const timed = await replayMasteryCandidate(candidate, { mode: 'timed' });
        expect(timed).toMatchObject({
            status: 'pass', piecesReplayed: 3, outcome: 'censored', reason: 'candidate-exhausted',
        });
    });
});
