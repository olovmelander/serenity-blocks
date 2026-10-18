import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    runOnlineMastery, replayOnlineMastery,
} from '../../scripts/odyssey-benchmark/mastery-online.mjs';
import * as search from '../../scripts/odyssey-benchmark/mastery-search.mjs';
import * as repair from '../../scripts/odyssey-benchmark/mastery-path-repair.mjs';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { demonstrateAuthoredConstruction } from '../../scripts/odyssey-benchmark/authored-construction.mjs';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import * as sessions from '../../src/core/odyssey/odyssey-level-session.js';

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const options = (extra = {}) => ({
    levelId: 55,
    seed: 9101,
    maxPieces: 3,
    beamWidth: 1,
    maxNodesPerPlan: 32,
    unknownTailDepth: 0,
    ...extra,
});
const drop = () => ({ actions: [{ type: 'hardDrop' }], diagnostics: { nodes: 1 } });
const poseEqual = (a, b) => a.shapeKey === b.shapeKey && a.x === b.x && a.y === b.y && a.rotation === b.rotation;
let cascadeFixture;
async function cascadePlanner() {
    cascadeFixture ||= await demonstrateAuthoredConstruction({
        levelId: 49, profileId: 'cascade', seed: 9101, maxPieces: 12,
    });
    return (observation) => {
        const target = cascadeFixture.trace[observation.metrics.piecesPlaced]?.lockedPiece;
        const placement = findReachablePlacements({
            ...observation.context,
            boardGrid: observation.boardGrid,
            currentPiece: observation.currentPiece,
        }).find((entry) => entry.x === target?.x && entry.y === target?.y && entry.rotation === target?.rotation);
        if (!placement) throw new Error('Recorded cascade test target is no longer reachable');
        return { actions: [...placement.actions, { type: 'hardDrop' }], diagnostics: { nodes: 1 } };
    };
}

describe('Adaptive mastery execution and timestamp replay', () => {
    it('records every command and lock and independently replays without a planner', async () => {
        const authored = structuredClone(getLevelById(55));
        const progress = [];
        const withProgress = options({ onProgress: (record) => progress.push(record) });
        const run = await runOnlineMastery(withProgress, { planner: drop });
        expect(run).toMatchObject({
            outcome: 'censored',
            reason: 'piece-budget',
            traceValid: true,
            allRecordedLocksComplete: true,
            previewLimit: 3,
            plannerWallTimeChargedToSimulation: false,
            realtimePlanningFeasibility: 'unverified',
            metrics: { piecesPlaced: 3 },
            counters: { automaticLocks: 0 },
        });
        expect(run.commands).toHaveLength(3);
        expect(progress.map((record) => record.piecesPlaced)).toEqual([1, 2, 3]);
        expect(run.config).not.toHaveProperty('onProgress');
        expect(run.trace.filter((entry) => entry.lockedPiece)).toHaveLength(3);
        expect(run.trace.filter((entry) => entry.lockedPiece)
            .every((entry) => entry.cellConservation.valid)).toBe(true);
        expect(run.decisions.every((decision) => decision.preview.length === 3
            && decision.observationHash.length === 64)).toBe(true);
        vi.spyOn(search, 'planMasteryObservation').mockImplementation(() => {
            throw new Error('No planner during replay');
        });
        const replay = await replayOnlineMastery(run);
        expect(replay).toMatchObject({
            status: 'pass', replayValid: true, traceComplete: true, decisions: [],
        });
        expect(replay.commands).toEqual(run.commands);
        expect(replay.trace).toEqual(run.trace);
        expect(replay.metrics).toEqual(run.metrics);
        expect(getLevelById(55)).toEqual(authored);
    });

    it('passes copied visible state, public history and budget options to planning', async () => {
        const seen = [];
        const run = await runOnlineMastery(options({ actionIntervalMs: 180 }), {
            planner: (observation, plannerOptions) => {
                seen.push(structuredClone({ observation, plannerOptions }));
                expect(observation.preview).toHaveLength(3);
                expect(observation).not.toHaveProperty('seed');
                expect(observation).not.toHaveProperty('randomGenerator');
                expect(observation).not.toHaveProperty('nextPieces');
                expect(plannerOptions).not.toHaveProperty('seed');
                expect(plannerOptions).not.toHaveProperty('levelId');
                expect(observation.finish.primaryAcquired).toBe(false);
                return drop();
            },
        });
        expect(run.traceValid).toBe(true);
        expect(seen).toHaveLength(3);
        expect(run.decisions.every((entry) => entry.plannerWallMs >= 0 && entry.plannerCpuMs >= 0)).toBe(true);
        expect(run.plannerCpuMs).toBeGreaterThanOrEqual(0);
    });

    it('replans from the actual falling pose when gravity changes a previously planned path', async () => {
        const run = await runOnlineMastery(options({ maxPieces: 2, actionIntervalMs: 600 }), {
            planner: (observation) => ({
                actions: observation.currentPiece.x > 0
                    ? [{ type: 'move', dir: -1 }, { type: 'hardDrop' }] : [{ type: 'hardDrop' }],
                diagnostics: { nodes: 1 },
            }),
        });
        expect(run.traceValid).toBe(true);
        expect(run.counters.gravityReplans).toBeGreaterThan(0);
        expect(run.decisions.some((decision) => decision.reason === 'gravity-changed-pose')).toBe(true);
        for (const decision of run.decisions) {
            const action = run.commands.find((command) => command.atMs === decision.atMs);
            expect(action).toBeDefined();
            expect(poseEqual(action.beforePose, decision.pose)).toBe(true);
        }
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('recovers from blocked movement and retains rejected commands in the replay witness', async () => {
        let calls = 0;
        const run = await runOnlineMastery(options({ maxPieces: 1, reactionMs: 0, actionIntervalMs: 1 }), {
            planner: () => ({
                actions: [++calls < 20 ? { type: 'move', dir: -1 } : { type: 'hardDrop' }],
                diagnostics: { nodes: 1 },
            }),
        });
        expect(run.traceValid).toBe(true);
        expect(run.counters.rejectedInputs).toBeGreaterThan(0);
        expect(run.commands.some((command) => !command.accepted && !command.legalStop)).toBe(true);
        expect(run.metrics.piecesPlaced).toBe(1);
        expect(run.commands.at(-1).type).toBe('hardDrop');
        const replay = await replayOnlineMastery(run);
        expect(replay.status).toBe('pass');
        expect(replay.commands.filter((command) => !command.accepted).length).toBe(run.counters.rejectedInputs);
    });

    it('discards redundant grounded drops and replans instead of waiting through a stale path', async () => {
        let calls = 0;
        const run = await runOnlineMastery(options({ maxPieces: 1, actionIntervalMs: 30 }), {
            planner: () => ({
                actions: ++calls === 1
                    ? [...Array.from({ length: 100 }, () => ({ type: 'softDrop' })), { type: 'hardDrop' }]
                    : [{ type: 'hardDrop' }],
                diagnostics: { nodes: 1 },
            }),
        });
        expect(run.traceValid).toBe(true);
        expect(run.counters.automaticLocks).toBe(0);
        // Gravity may force an earlier replan; if grounded, only one stale stop is consumed.
        expect(run.counters.groundedStops).toBeLessThanOrEqual(1);
        expect(run.decisions.length).toBeGreaterThan(1);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('records automatic locks before any input and continues on later pieces', async () => {
        const automaticOptions = options({ levelId: 49, maxPieces: 2, reactionMs: 60000 });
        const run = await runOnlineMastery(automaticOptions, { planner: drop });
        expect(run).toMatchObject({ outcome: 'censored', reason: 'piece-budget', traceValid: true });
        expect(run.commands).toHaveLength(0);
        expect(run.counters.automaticLocks).toBe(2);
        expect(run.trace.filter((entry) => entry.lockedPiece)
            .every((entry) => entry.lockSource === 'automatic')).toBe(true);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('replays a decision-budget stop before the frame that would automatically lock', async () => {
        const automaticOptions = options({ levelId: 49, maxPieces: 1, reactionMs: 60000 });
        const baseline = await runOnlineMastery(automaticOptions, { planner: drop });
        const automaticAt = baseline.trace.find((entry) => entry.lockedPiece).lockAtMs;
        const run = await runOnlineMastery(options({
            levelId: 49,
            maxPieces: 2,
            reactionMs: automaticAt - 100,
            actionIntervalMs: 100,
            maxDecisions: 1,
        }), { planner: () => ({ actions: [{ type: 'softDrop' }], diagnostics: { nodes: 1 } }) });
        expect(run).toMatchObject({ reason: 'decision-budget', stopPhase: 'input', counters: { automaticLocks: 0 } });
        expect(run.commands).toHaveLength(1);
        expect(run.commands[0].legalStop).toBe(true);
        expect(run.stoppedAtSeconds * 1000).toBeCloseTo(automaticAt);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('bounds repeated recovery and records the fallback drop explicitly', async () => {
        const run = await runOnlineMastery(options({ maxPieces: 1, maxReplansPerPiece: 1 }), {
            planner: () => ({ actions: [{ type: 'move', dir: -1 }], diagnostics: { nodes: 1 } }),
        });
        expect(run.counters.fallbackDrops).toBe(1);
        expect(run.commands.at(-1)).toMatchObject({ type: 'hardDrop', source: 'fallback', accepted: true });
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('keeps live showcase history after primary and chooses Finish explicitly at tier three', async () => {
        const observations = [];
        vi.spyOn(GameplayHybridEngine.prototype, 'checkVictory').mockImplementation(function reached() {
            return this.getMetrics().piecesPlaced >= 1;
        });
        vi.spyOn(GameplayHybridEngine.prototype, 'checkFailure').mockImplementation(function expired() {
            return this.getMetrics().piecesPlaced >= 1;
        });
        vi.spyOn(GameplayHybridEngine.prototype, 'calculateStars').mockImplementation(function stars() {
            return this.getMetrics().piecesPlaced >= 2 ? 3 : 1;
        });
        const run = await runOnlineMastery(options(), {
            planner: (observation) => { observations.push(observation.finish.primaryAcquired); return drop(); },
        });
        expect(run).toMatchObject({
            outcome: 'win',
            reason: 'manual-showcase-finish',
            primaryReachedAtPiece: 1,
            qualityCensored: false,
            metrics: { piecesPlaced: 2 },
        });
        expect(observations).toEqual([false, true]);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('detects changed timestamps and reported input results during independent replay', async () => {
        const run = await runOnlineMastery(options({ maxPieces: 1 }), { planner: drop });
        const changedTime = structuredClone(run);
        changedTime.commands[0].atMs -= 1;
        expect((await replayOnlineMastery(changedTime)).replayValid).toBe(false);
        const changedResult = structuredClone(run);
        changedResult.commands[0].accepted = false;
        const replay = await replayOnlineMastery(changedResult);
        expect(replay).toMatchObject({
            status: 'fail', replayValid: false, failure: { reason: 'recorded-execution-mismatch' },
        });
        await expect(replayOnlineMastery({ ...run, seed: 9103 })).rejects.toThrow(/identity/);
        const changedPrimary = { ...run, primaryReached: !run.primaryReached };
        expect((await replayOnlineMastery(changedPrimary)).replayValid).toBe(false);
    });

    it('runs the actual allowlisted planner under virtual time with bounded nodes', async () => {
        const run = await runOnlineMastery(options({ seed: 9102, maxPieces: 2, maxNodes: 128 }));
        expect(run.traceValid).toBe(true);
        expect(run.decisions.length).toBeGreaterThan(0);
        expect(run.nodes).toBeLessThanOrEqual(128);
        expect(run.plannerWallMs).toBeGreaterThan(0);
        expect(run.plannerCpuMs).toBeGreaterThan(0);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('rejects unsupported timing, bad cadence and planner-side observation mutation', async () => {
        await expect(runOnlineMastery(options({ timingPolicy: 'charged-latency' }))).rejects.toThrow(/fixed-cadence/);
        await expect(runOnlineMastery(options({ actionIntervalMs: 0 }))).rejects.toThrow(/positive/);
        const mutated = await runOnlineMastery(options(), {
            planner: (observation) => { observation.preview.push('T'); return drop(); },
        });
        expect(mutated).toMatchObject({
            status: 'error', traceValid: false, reason: 'Planner mutated its observation',
        });
    });

    it('checks acquisition deadlines after complete real cascade physics', async () => {
        const planner = await cascadePlanner();
        const runOptions = options({ levelId: 49, maxPieces: 12 });
        const baseline = await runOnlineMastery(runOptions, { planner });
        expect(baseline.traceValid).toBe(true);
        const last = baseline.trace.find((entry) => entry.step === 12);
        expect(last.lineClears.length).toBeGreaterThan(1);
        expect(last.resolvedAtMs - last.lockAtMs).toBeGreaterThan(300);
        let deadline = baseline.stoppedAtSeconds;
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
        const onTime = await runOnlineMastery(runOptions, { planner });
        expect(onTime).toMatchObject({ outcome: 'win', reason: 'primary-goal', primaryReached: true });
        expect((await replayOnlineMastery(onTime)).status).toBe('pass');
        deadline -= 0.001;
        const late = await runOnlineMastery(runOptions, { planner });
        expect(late).toMatchObject({ outcome: 'loss', reason: 'deadline', primaryReached: false });
        expect(late.metrics.lines).toBe(baseline.metrics.lines);
        expect((await replayOnlineMastery(late)).status).toBe('pass');
    });

    it('drains an in-flight lock after a cutoff without promoting a late goal', async () => {
        const planner = await cascadePlanner();
        const runOptions = options({ levelId: 49, maxPieces: 12 });
        const baseline = await runOnlineMastery(runOptions, { planner });
        const last = baseline.trace.find((entry) => entry.step === 12);
        vi.spyOn(GameplayHybridEngine.prototype, 'checkVictory').mockImplementation(function reached() {
            return this.getMetrics().lines >= baseline.metrics.lines;
        });
        const maxSimSeconds = (last.lockAtMs + 50) / 1000;
        const capped = await runOnlineMastery({ ...runOptions, maxSimSeconds }, { planner });
        expect(capped).toMatchObject({
            outcome: 'censored', reason: 'simulation-budget', primaryReached: false, traceValid: true,
        });
        expect(capped.physicsDrainedThroughSeconds).toBeGreaterThan(capped.stoppedAtSeconds);
        expect(capped.metrics.lines).toBe(baseline.metrics.lines);
        expect((await replayOnlineMastery(capped)).status).toBe('pass');
    });

    it('gives an ordinary fully resolved primary precedence over a simultaneous roof state', async () => {
        vi.spyOn(GameplayHybridEngine.prototype, 'checkVictory').mockImplementation(function reached() {
            if (this.getMetrics().piecesPlaced < 1) return false;
            this.gameState.isGameOver = true;
            return true;
        });
        const run = await runOnlineMastery(options({ levelId: 49 }), { planner: drop });
        expect(run).toMatchObject({ outcome: 'win', reason: 'primary-goal', primaryReachedAtPiece: 1 });
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('clears all replay qualification flags when final cleanup fails', async () => {
        const run = await runOnlineMastery(options({ maxPieces: 1 }), { planner: drop });
        vi.spyOn(sessions, 'drainOdysseyLevelSession').mockRejectedValueOnce(new Error('Injected cleanup failure'));
        const replay = await replayOnlineMastery(run);
        expect(replay).toMatchObject({
            status: 'error',
            reason: 'physics-drain-error',
            traceValid: false,
            replayValid: false,
            traceComplete: false,
            cleanupError: 'Injected cleanup failure',
        });
    });
});

describe('Charged planning and exact-target recovery', () => {
    const targetLeft = (observation) => {
        const placement = findReachablePlacements({
            ...observation.context,
            boardGrid: observation.boardGrid,
            currentPiece: observation.currentPiece,
        }).filter((entry) => entry.rotation === observation.currentPiece.rotation)
            .sort((a, b) => a.x - b.x)[0];
        return {
            actions: [...placement.actions, { type: 'hardDrop' }],
            prediction: {
                lockedPiece: {
                    shapeKey: placement.shapeKey, x: placement.x, y: placement.y, rotation: placement.rotation,
                },
            },
            diagnostics: { nodes: 1 },
        };
    };

    it('retains the geometric destination and repairs from the live falling pose', async () => {
        const seen = [];
        const run = await runOnlineMastery(options({
            maxPieces: 1, actionIntervalMs: 600, pathRepair: 'reachable-v1',
        }), {
            planner: targetLeft,
            repairer: (observation, target, repairOptions) => {
                seen.push(structuredClone({ observation, target, repairOptions }));
                expect(Object.keys(repairOptions).sort()).toEqual(['maxNodes', 'wallBudgetMs']);
                expect(observation).not.toHaveProperty('seed');
                expect(observation.preview).toHaveLength(3);
                return repair.repairMasteryPath(observation, target, repairOptions);
            },
        });
        expect(run).toMatchObject({ traceValid: true, metrics: { piecesPlaced: 1 } });
        expect(run.counters.planningCalls).toBe(1);
        expect(run.counters.repairSuccesses).toBeGreaterThan(0);
        expect(run.commands.some((entry) => entry.source === 'repair')).toBe(true);
        expect(run.trace[0].lockedPiece).toMatchObject(run.computeSchedule[0].target);
        expect(run.nodes).toBe(run.plannerNodes + run.repairNodes);
        expect(seen.every((entry) => entry.repairOptions.maxNodes <= 4096)).toBe(true);
        vi.spyOn(search, 'planMasteryObservation').mockImplementation(() => { throw new Error('Planner called'); });
        vi.spyOn(repair, 'repairMasteryPath').mockImplementation(() => { throw new Error('Repair called'); });
        const replay = await replayOnlineMastery(run);
        expect(replay.status).toBe('pass');
        expect(replay.computeSchedule).toEqual(run.computeSchedule);
    });

    it('charges failed repairs and waits a frame before full search', async () => {
        const run = await runOnlineMastery(options({
            maxPieces: 1,
            actionIntervalMs: 600,
            pathRepair: 'reachable-v1',
            planningLatency: 'fixed',
            fixedPlanningMs: 20,
        }), {
            planner: targetLeft,
            repairer: () => ({ actions: [], diagnostics: { nodes: 1 }, status: 'budget' }),
        });
        expect(run.traceValid).toBe(true);
        expect(run.counters.repairFailures).toBeGreaterThan(0);
        const index = run.computeSchedule.findIndex((entry) => entry.kind === 'repair'
            && entry.disposition === 'no-path');
        const failed = run.computeSchedule[index];
        const next = run.computeSchedule[index + 1];
        expect(failed.chargedMs).toBe(20);
        expect(next.kind).toBe('plan');
        expect(next.atMs).toBeGreaterThan(failed.settledAtMs);
        expect(run.planningChargedMs).toBe(run.computeSchedule.length * 20);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('runs gravity during positive planning latency and rejects a stale pose before any action', async () => {
        const run = await runOnlineMastery(options({
            maxPieces: 1, planningLatency: 'fixed', fixedPlanningMs: 1000, maxDecisions: 2,
        }), { planner: drop });
        expect(run).toMatchObject({ traceValid: true, reason: 'decision-budget' });
        expect(run.commands).toHaveLength(0);
        expect(run.computeSchedule.every((entry) => entry.disposition === 'stale-pose')).toBe(true);
        expect(run.computeSchedule[0].settledPose.y).toBeGreaterThan(run.computeSchedule[0].pose.y);
        expect(run.computeSchedule[1].atMs).toBeGreaterThan(run.computeSchedule[0].settledAtMs);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('lets an automatic lock and spawn invalidate a pending result before later inputs', async () => {
        const automatic = await runOnlineMastery(options({
            levelId: 49, maxPieces: 1, reactionMs: 60000,
        }), { planner: drop });
        const automaticAt = automatic.trace[0].lockAtMs;
        const run = await runOnlineMastery(options({
            levelId: 49,
            maxPieces: 2,
            reactionMs: automaticAt - 100,
            planningLatency: 'fixed',
            fixedPlanningMs: 200,
        }), { planner: drop });
        expect(run.traceValid).toBe(true);
        expect(run.trace[0].lockSource).toBe('automatic');
        expect(run.computeSchedule[0].disposition).toBe('stale-piece');
        expect(run.computeSchedule[0].settledStep).toBe(2);
        expect(run.commands.every((entry) => entry.step !== 1)).toBe(true);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('retains an interrupted computation when automatic lock reaches the piece budget', async () => {
        const automatic = await runOnlineMastery(options({
            levelId: 49, maxPieces: 1, reactionMs: 60000,
        }), { planner: drop });
        const automaticAt = automatic.trace[0].lockAtMs;
        const run = await runOnlineMastery(options({
            levelId: 49,
            maxPieces: 1,
            reactionMs: automaticAt - 100,
            planningLatency: 'fixed',
            fixedPlanningMs: 200,
        }), { planner: drop });
        expect(run).toMatchObject({ reason: 'piece-budget', counters: { automaticLocks: 1 } });
        expect(run.commands).toHaveLength(0);
        expect(run.computeSchedule[0].disposition).toBe('interrupted');
        expect(run.computeSchedule[0].settledAtMs).toBeLessThan(run.computeSchedule[0].readyAtMs);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('checks authored deadlines during computation before releasing the planned input', async () => {
        vi.spyOn(GameplayHybridEngine.prototype, 'checkFailure').mockImplementation(function deadline() {
            return this.getMetrics().time >= 0.1;
        });
        const run = await runOnlineMastery(options({
            reactionMs: 0, planningLatency: 'fixed', fixedPlanningMs: 100,
        }), { planner: drop });
        expect(run).toMatchObject({ outcome: 'loss', reason: 'deadline', primaryReached: false });
        expect(run.commands).toHaveLength(0);
        expect(run.computeSchedule).toHaveLength(1);
        expect(run.computeSchedule[0].disposition).toBe('interrupted');
        expect(run.stoppedAtSeconds).toBeLessThanOrEqual(0.1 + 1 / 60);
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('records measured wall charges once and replays their saved schedule without remeasurement', async () => {
        const run = await runOnlineMastery(options({
            maxPieces: 1, planningLatency: 'measured-wall',
        }), { planner: drop });
        expect(run).toMatchObject({
            traceValid: true, plannerWallTimeChargedToSimulation: true, realtimePlanningFeasibility: 'unverified',
        });
        expect(run.computeSchedule[0].chargedMs).toBe(run.computeSchedule[0].computeWallMs);
        expect(run.computeSchedule[0].settledAtMs).toBeGreaterThan(run.computeSchedule[0].readyAtMs);
        expect(run.commands[0].atMs).toBe(run.computeSchedule[0].settledAtMs);
        const replay = await replayOnlineMastery(run);
        expect(replay.status).toBe('pass');
        expect(replay.computeSchedule).toEqual(run.computeSchedule);
        expect(replay.plannerWallMs).toBe(0);
    });

    it('keeps zero fixed latency equivalent to the uncharged input schedule', async () => {
        const uncharged = await runOnlineMastery(options({ maxPieces: 2 }), { planner: drop });
        const fixed = await runOnlineMastery(options({
            maxPieces: 2, planningLatency: 'fixed', fixedPlanningMs: 0,
        }), { planner: drop });
        expect(fixed.commands).toEqual(uncharged.commands);
        expect(fixed.trace).toEqual(uncharged.trace);
        expect(fixed.metrics).toEqual(uncharged.metrics);
        expect(fixed.computeSchedule.every((entry) => entry.settledAtMs === entry.atMs)).toBe(true);
        expect((await replayOnlineMastery(fixed)).status).toBe('pass');
        const legacy = structuredClone(uncharged);
        legacy.version = 'adaptive-fixed-cadence-v1';
        delete legacy.computeSchedule;
        for (const key of ['planningLatency', 'fixedPlanningMs', 'pathRepair', 'maxRepairNodes']) {
            delete legacy.config[key];
        }
        expect((await replayOnlineMastery(legacy)).status).toBe('pass');
    });

    it('replays a zero-charge computation censored by its real wall budget before input', async () => {
        const run = await runOnlineMastery(options({ maxPieces: 1, wallBudgetMs: 100 }), {
            planner: () => {
                const until = process.hrtime.bigint() + 120000000n;
                while (process.hrtime.bigint() < until) { /* Deliberate bounded CPU overrun. */ }
                return drop();
            },
        });
        expect(run).toMatchObject({ reason: 'wall-budget', stopPhase: 'input', traceValid: true });
        expect(run.commands).toHaveLength(0);
        expect(run.computeSchedule[0]).toMatchObject({ chargedMs: 0, disposition: 'interrupted' });
        expect((await replayOnlineMastery(run)).status).toBe('pass');
    });

    it('rejects inconsistent repair results and verifies the actual target lock', async () => {
        const runOptions = options({ maxPieces: 1, actionIntervalMs: 600, pathRepair: 'reachable-v1' });
        const inconsistent = await runOnlineMastery(runOptions, {
            planner: targetLeft,
            repairer: () => ({ status: 'budget', actions: [{ type: 'hardDrop' }], diagnostics: { nodes: 1 } }),
        });
        expect(inconsistent).toMatchObject({
            status: 'error', traceValid: false, reason: 'Repairer returned inconsistent reachability evidence',
        });
        const missed = await runOnlineMastery(runOptions, {
            planner: targetLeft,
            repairer: (observation, target) => ({
                status: 'reachable', actions: [{ type: 'hardDrop' }], target, diagnostics: { nodes: 1 },
            }),
        });
        expect(missed).toMatchObject({
            status: 'error', traceValid: false, reason: 'Repaired path missed its exact lock target',
        });
        expect(missed.trace[0].targetValidation.targetAchieved).toBe(false);
    });

    it('rejects invalid latency, repair and numerical budgets', async () => {
        await Promise.all([
            { planningLatency: 'instant' }, { pathRepair: 'anything' }, { fixedPlanningMs: -1 },
            { fixedPlanningMs: Infinity }, { maxRepairNodes: 0 }, { maxRepairNodes: 100001 },
        ].map((config) => expect(runOnlineMastery(options(config))).rejects.toThrow()));
    });

    it('rejects tampered compute charges, observations, settlements and command ownership', async () => {
        const run = await runOnlineMastery(options({
            maxPieces: 1, planningLatency: 'fixed', fixedPlanningMs: 20,
        }), { planner: drop });
        expect(run.traceValid).toBe(true);
        const badCharge = structuredClone(run);
        badCharge.computeSchedule[0].chargedMs++;
        await expect(replayOnlineMastery(badCharge)).rejects.toThrow(/schedule/);
        const badObservation = structuredClone(run);
        badObservation.computeSchedule[0].observationHash = 'wrong';
        badObservation.decisions[0].observationHash = 'wrong';
        expect((await replayOnlineMastery(badObservation)).replayValid).toBe(false);
        const badSettle = structuredClone(run);
        badSettle.computeSchedule[0].settledAtMs -= 1;
        expect((await replayOnlineMastery(badSettle)).replayValid).toBe(false);
        const badCommand = structuredClone(run);
        badCommand.computeSchedule[0].actions[0] = { type: 'move', dir: -1 };
        expect((await replayOnlineMastery(badCommand)).replayValid).toBe(false);
        const missingCompute = structuredClone(run);
        missingCompute.computeSchedule = [];
        missingCompute.decisions = [];
        expect((await replayOnlineMastery(missingCompute)).replayValid).toBe(false);
        const earlyInput = structuredClone(run);
        earlyInput.commands[0].atMs = earlyInput.computeSchedule[0].atMs;
        expect((await replayOnlineMastery(earlyInput)).replayValid).toBe(false);
    });
});
