/** Adaptive benchmark execution and independent replay of its timestamped inputs. */
/* eslint-disable no-await-in-loop -- Production frames and complete physics barriers are sequential. */
import { createHash } from 'node:crypto';
import {
    canPlacePiece, fillBag, hardDrop, move, rotate, softDrop, spawnPiece,
} from '../../src/core/game.js';
import { calculateBuildHeight, checkInfinityGameOver } from '../../src/core/infinity-grid.js';
import { normalizeSessionSeed } from '../../src/core/session-rng.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import {
    createOdysseyLevelSession, drainOdysseyLevelSession, retireOdysseyLevelSession,
} from '../../src/core/odyssey/odyssey-level-session.js';
import { createOdysseyPhysicsCallbacks } from '../../src/core/game-modes/odyssey-physics-callbacks.js';
import { startOdysseyGameplayLoop } from '../../src/core/game-modes/odyssey-gameplay-loop.js';
import { getMasteryRequirements } from './authored-construction.mjs';
import { createMasteryObservation, planMasteryObservation } from './mastery-search.mjs';
import {
    masteryBoardHash, measureMasteryCellConservation, evaluateMasteryQuality,
} from './mastery-replay.mjs';
import { createVirtualClock } from './virtual-clock.mjs';
import { repairMasteryPath } from './mastery-path-repair.mjs';

export const MASTERY_ONLINE_VERSION = 'adaptive-fixed-cadence-v2';
const LEGACY_ONLINE_VERSION = 'adaptive-fixed-cadence-v1';
export const MASTERY_ONLINE_DEFAULTS = Object.freeze({
    maxPieces: 192,
    reactionMs: 150,
    actionIntervalMs: 100,
    maxSimSeconds: 1800,
    wallBudgetMs: 120000,
    timingPolicy: 'fixed-cadence',
    maxDecisions: 2048,
    maxReplansPerPiece: 64,
    beamWidth: 8,
    maxNodes: 240000,
    maxNodesPerPlan: 2400,
    unknownTailDepth: 1,
    setupStrategy: 'none',
    pathRepair: 'none',
    maxRepairNodes: 4096,
    planningLatency: 'uncharged',
    fixedPlanningMs: 200,
});
const FRAME_MS = 1000 / 60;
const EPSILON = 1e-7;
const realNow = () => Number(process.hrtime.bigint()) / 1e6;
const pose = (piece) => (piece ? {
    shapeKey: piece.shapeKey, x: piece.x, y: piece.y, rotation: piece.rotation ?? 0,
} : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const commandValid = (command) => command?.type === 'hardDrop' || command?.type === 'softDrop'
    || (command?.type === 'move' && [-1, 1].includes(command.dir))
    || (command?.type === 'rotate' && ['left', 'right', 'flip'].includes(command.dir));
const harnessReasons = new Set(['piece-budget', 'simulation-budget', 'wall-budget', 'node-budget', 'decision-budget']);

function configuration(input) {
    normalizeSessionSeed(input?.seed);
    const level = getLevelById(input.levelId);
    if (!level || level.mechanics?.versus) throw new RangeError('Adaptive mastery requires an authored solo orb');
    const config = {
        levelId: input.levelId,
        seed: input.seed,
        ...Object.fromEntries(Object.entries(MASTERY_ONLINE_DEFAULTS)
            .map(([key, value]) => [key, input[key] ?? value])),
    };
    for (const [key, maximum] of Object.entries({
        maxPieces: 1024,
        maxDecisions: 100000,
        maxReplansPerPiece: 1024,
        beamWidth: 64,
        maxNodes: 10000000,
        maxNodesPerPlan: 100000,
        maxRepairNodes: 100000,
    })) {
        if (!Number.isSafeInteger(config[key]) || config[key] < 1 || config[key] > maximum) {
            throw new RangeError(`${key} must be an integer from 1 to ${maximum}`);
        }
    }
    if (!Number.isFinite(config.reactionMs) || config.reactionMs < 0) {
        throw new RangeError('reactionMs must be nonnegative');
    }
    for (const key of ['actionIntervalMs', 'maxSimSeconds', 'wallBudgetMs']) {
        if (!Number.isFinite(config[key]) || config[key] <= 0) {
            throw new RangeError(`${key} must be finite and positive`);
        }
    }
    if (![0, 1].includes(config.unknownTailDepth)) throw new RangeError('unknownTailDepth must be 0 or 1');
    if (!['none', 'structural-v1'].includes(config.setupStrategy)) throw new RangeError('Unknown setup strategy');
    if (!['none', 'reachable-v1'].includes(config.pathRepair)) throw new RangeError('Unknown path repair strategy');
    if (!['uncharged', 'measured-wall', 'fixed'].includes(config.planningLatency)) {
        throw new RangeError('Unknown planning latency model');
    }
    if (!Number.isFinite(config.fixedPlanningMs) || config.fixedPlanningMs < 0) {
        throw new RangeError('fixedPlanningMs must be finite and nonnegative');
    }
    if (config.timingPolicy !== 'fixed-cadence') throw new RangeError('Only fixed-cadence timing is implemented');
    return { config, level };
}

function validateWitness(witness) {
    if (witness?.kind !== 'online-mastery-witness'
        || ![MASTERY_ONLINE_VERSION, LEGACY_ONLINE_VERSION].includes(witness.version)
        || !Array.isArray(witness.commands) || !Array.isArray(witness.trace)
        || !Number.isFinite(witness.stoppedAtSeconds) || witness.stoppedAtSeconds < 0
        || !['setup', 'boundary', 'timers', 'input', 'logic', 'render'].includes(witness.stopPhase)) {
        throw new TypeError('A complete versioned online mastery witness is required');
    }
    if (witness.levelId !== witness.config?.levelId || witness.seed !== witness.config?.seed) {
        throw new TypeError('Witness identity must match its recorded configuration');
    }
    let previous = -Infinity;
    for (const command of witness.commands) {
        if (!commandValid(command) || !Number.isFinite(command.atMs) || command.atMs < 0
            || command.atMs <= previous || command.atMs > witness.stoppedAtSeconds * 1000 + EPSILON) {
            throw new TypeError('Recorded inputs must be legal commands with strictly increasing bounded timestamps');
        }
        previous = command.atMs;
    }
    const { config } = configuration(witness.config);
    if (witness.version === LEGACY_ONLINE_VERSION) {
        if (config.planningLatency !== 'uncharged' || config.pathRepair !== 'none') {
            throw new TypeError('Legacy witnesses cannot declare latency or path repair');
        }
        return;
    }
    if (!Array.isArray(witness.computeSchedule) || !Array.isArray(witness.decisions)
        || witness.computeSchedule.length !== witness.decisions.length) {
        throw new TypeError('A complete computation schedule and matching decisions are required');
    }
    let previousStart = -Infinity;
    let previousEnd = -Infinity;
    for (const [index, event] of witness.computeSchedule.entries()) {
        const decision = witness.decisions[index];
        let charge = 0;
        if (config.planningLatency === 'fixed') charge = config.fixedPlanningMs;
        if (config.planningLatency === 'measured-wall') charge = event.computeWallMs;
        if (event.index !== index + 1 || !['plan', 'repair'].includes(event.kind)
            || (event.kind === 'repair' && config.pathRepair !== 'reachable-v1')
            || !Number.isFinite(event.atMs) || event.atMs < 0 || event.atMs <= previousStart
            || event.atMs + EPSILON < previousEnd
            || !Number.isFinite(event.computeWallMs) || event.computeWallMs < 0
            || !Number.isFinite(event.chargedMs) || Math.abs(event.chargedMs - charge) > EPSILON
            || !Number.isFinite(event.readyAtMs) || Math.abs(event.readyAtMs - event.atMs - charge) > EPSILON
            || !Number.isFinite(event.settledAtMs) || event.settledAtMs + EPSILON < event.atMs
            || event.settledAtMs > witness.stoppedAtSeconds * 1000 + EPSILON
            || !['accepted', 'no-path', 'stale-piece', 'stale-board', 'stale-pose', 'interrupted', 'error']
                .includes(event.disposition)
            || (event.disposition !== 'interrupted' && event.settledAtMs + EPSILON < event.readyAtMs)
            || !Array.isArray(event.actions) || !event.actions.every(commandValid)
            || event.hasActions !== Boolean(event.actions.length)
            || (event.kind === 'repair' && (!['reachable', 'unreachable', 'budget'].includes(event.repairStatus)
                || event.hasActions !== (event.repairStatus === 'reachable')
                || (event.hasActions && (event.actions.at(-1).type !== 'hardDrop'
                    || event.actions.slice(0, -1).some((action) => action.type === 'hardDrop')))))
            || (![null, undefined].includes(event.error) && typeof event.error !== 'string')
            || !decision || decision.index !== event.index || decision.kind !== event.kind
            || decision.step !== event.step || decision.atMs !== event.atMs
            || decision.observationHash !== event.observationHash || !same(decision.pose, event.pose)
            || decision.chargedMs !== event.chargedMs
            || Math.abs((event.kind === 'plan' ? decision.plannerWallMs : decision.repairWallMs)
                - event.computeWallMs) > EPSILON) {
            throw new TypeError('Invalid, overlapping or inconsistent recorded computation schedule');
        }
        previousStart = event.atMs;
        previousEnd = event.settledAtMs;
    }
}

function replayProjection(result) {
    return {
        levelId: result.levelId,
        seed: result.seed,
        initialBoardHash: result.initialBoardHash,
        commands: result.commands,
        trace: result.trace,
        outcome: result.outcome,
        reason: result.reason,
        qualityCensored: result.qualityCensored,
        primaryReachedAtPiece: result.primaryReachedAtPiece,
        primaryReached: result.primaryReached,
        goalReachedAtSeconds: result.goalReachedAtSeconds,
        stoppedAtSeconds: result.stoppedAtSeconds,
        stopPhase: result.stopPhase,
        physicsDrainedThroughSeconds: result.physicsDrainedThroughSeconds,
        metrics: result.metrics,
        quality: result.quality,
        ...(result.version === MASTERY_ONLINE_VERSION ? { computeSchedule: result.computeSchedule } : {}),
    };
}

async function execute(input, {
    planner = null, repairer = repairMasteryPath, expected = null, replayWallBudgetMs = null,
} = {}) {
    const { config, level } = configuration(input);
    const clock = createVirtualClock();
    const requirements = getMasteryRequirements(level);
    const engine = new GameplayHybridEngine();
    const beganAt = realNow();
    const originalError = console.error;
    const commands = [];
    const trace = [];
    const decisions = [];
    const computeSchedule = [];
    const modernReplay = expected?.version === MASTERY_ONLINE_VERSION;
    const counters = {
        replans: 0,
        gravityReplans: 0,
        rejectedInputs: 0,
        groundedStops: 0,
        automaticLocks: 0,
        fallbackDrops: 0,
        planningCalls: 0,
        repairAttempts: 0,
        repairSuccesses: 0,
        repairFailures: 0,
        staleComputations: 0,
    };
    let state;
    let session;
    let callbacks;
    let loop;
    let active = null;
    let plan = null;
    let repairTarget = null;
    let pendingCompute = null;
    let replanReason = 'spawn';
    let perPieceDecisions = 0;
    let nextActionAt = 0;
    let inputSource = null;
    let terminal = null;
    let draining = false;
    let physicsError;
    let primaryReachedAtPiece = null;
    let goalReachedAtSeconds = null;
    let initialBoardHash;
    let initialCells = 0;
    let nodes = 0;
    let plannerWallMs = 0;
    let plannerCpuMs = 0;
    let repairWallMs = 0;
    let repairCpuMs = 0;
    let plannerNodes = 0;
    let repairNodes = 0;
    let phase = 'setup';
    let replayCursor = 0;
    let replayComputeCursor = 0;
    let logicThroughMs = 0;
    let result;
    const owns = () => !!session && !session.retired && (!terminal || draining);
    const finish = (outcome, reason, qualityCensored = false) => {
        terminal ||= {
            outcome, reason, qualityCensored, stoppedAtSeconds: clock.now / 1000, stopPhase: phase,
        };
    };
    const stopAtBudget = (reason) => finish(state.goalComplete ? 'win' : 'censored', reason, !!state.goalComplete);
    const updateMetrics = () => {
        engine.updateScore(state.score);
        engine.updateTime(clock.now / 1000);
        if (state.isInfinityMode) engine.victoryEvaluator.updateHeight(calculateBuildHeight(state));
    };
    const topOut = () => {
        state.isGameOver = true;
        finish(state.goalComplete ? 'win' : 'loss', state.goalComplete ? 'showcase-top-out' : 'top-out');
    };
    const checkGoals = () => {
        if (terminal || !owns()) return;
        updateMetrics();
        if (state.isProcessingPhysics || state.goalComplete) return;
        if (engine.checkVictory()) {
            primaryReachedAtPiece = engine.getMetrics().piecesPlaced;
            goalReachedAtSeconds = clock.now / 1000;
            if (requirements.finishPolicy.stopAfterPrimaryResolution) finish('win', 'primary-goal');
            else { state.goalComplete = true; state.victoryLapActive = true; }
        } else if (engine.checkFailure()) finish('loss', state.isGameOver ? 'top-out' : 'deadline');
    };

    function beginPiece() {
        if (active || terminal || !state.currentPiece || state.isProcessingPhysics) return;
        active = {
            step: trace.length + 1,
            shapeKey: state.currentPiece.shapeKey,
            spawnPose: pose(state.currentPiece),
            spawnAtMs: state.pieceSpawnTime,
            preview: state.nextPieces.slice(0, 3),
            boardHashBefore: masteryBoardHash(state),
            actions: [],
            lineClears: [],
            maximumDepth: 0,
            completed: false,
        };
        trace.push(active);
        plan = null;
        repairTarget = null;
        perPieceDecisions = 0;
        replanReason = 'spawn';
        nextActionAt = Math.max(nextActionAt, state.pieceSpawnTime + config.reactionMs);
    }

    function completePiece() {
        if (!active?.lockedPiece || state.isProcessingPhysics) return;
        updateMetrics();
        active.metricsAfter = engine.getMetrics();
        active.boardHashAfter = masteryBoardHash(state);
        active.resolvedAtMs = clock.now;
        active.cellConservation = measureMasteryCellConservation(state, initialCells, active.metricsAfter);
        active.completed = true;
        if (!active.cellConservation.valid) throw new Error('Online cell-conservation failure');
        if (!expected) {
            input.onProgress?.({
                step: active.step,
                piecesPlaced: active.metricsAfter.piecesPlaced,
                metrics: structuredClone(active.metricsAfter),
                nodes,
                decisions: decisions.length,
                counters: { ...counters },
                simSeconds: clock.now / 1000,
                elapsedWallMs: realNow() - beganAt,
            });
        }
        active = null;
        plan = null;
        repairTarget = null;
    }

    function perform(command, source) {
        if (!active || active.lockedPiece || state.isProcessingPhysics || !state.currentPiece) {
            throw new Error('Input attempted outside an active falling piece');
        }
        if (!commandValid(command)) throw new Error('Planner returned an invalid command');
        const entry = active;
        const targetAtInput = source === 'repair' ? plan?.target : null;
        const beforePose = pose(state.currentPiece);
        const grounded = command.type === 'softDrop'
            && !canPlacePiece(state, state.currentPiece, state.currentPiece.x, state.currentPiece.y + 1);
        let accepted;
        inputSource = source;
        try {
            if (command.type === 'move') accepted = move(state, command.dir);
            else if (command.type === 'rotate') accepted = rotate(state, command.dir);
            else if (command.type === 'softDrop') accepted = softDrop(state, null, callbacks);
            else accepted = hardDrop(state, null, callbacks);
        } finally { inputSource = null; }
        const legalStop = accepted === false && grounded;
        const event = {
            type: command.type,
            ...(command.dir !== undefined ? { dir: command.dir } : {}),
            step: entry.step,
            atMs: clock.now,
            source,
            accepted: accepted === true,
            legalStop,
            beforePose,
            afterPose: pose(state.currentPiece),
        };
        commands.push(event);
        entry.actions.push(event);
        if (source === 'repair' && command.type === 'hardDrop') {
            entry.targetValidation = {
                target: targetAtInput,
                actual: pose(entry.lockedPiece),
                targetAchieved: Boolean(targetAtInput && same(pose(targetAtInput), pose(entry.lockedPiece))),
            };
            if (!entry.targetValidation.targetAchieved) throw new Error('Repaired path missed its exact lock target');
        }
        nextActionAt = clock.now + config.actionIntervalMs;
        if (legalStop) {
            counters.groundedStops++;
            repairTarget = plan?.target || null;
            plan = null;
            replanReason = 'grounded-stop';
        } else if (!accepted) {
            counters.rejectedInputs++;
            repairTarget = plan?.target || null;
            plan = null;
            replanReason = 'rejected-input';
        } else if (plan) {
            plan.index++;
            plan.expectedPose = pose(state.currentPiece);
        }
    }

    const currentObservation = () => {
        updateMetrics();
        return createMasteryObservation(state, engine.getMetrics(), level, {
            primaryAcquired: primaryReachedAtPiece !== null,
            actionIntervalMs: config.actionIntervalMs,
            reactionMs: config.reactionMs,
        });
    };
    const latencyFor = (duration) => {
        if (config.planningLatency === 'measured-wall') return duration;
        return config.planningLatency === 'fixed' ? config.fixedPlanningMs : 0;
    };
    const computationDisposition = (event) => {
        if (!active || active.step !== event.step || active.lockedPiece || state.isProcessingPhysics) {
            return 'stale-piece';
        }
        if (masteryBoardHash(state) !== event.boardHash) return 'stale-board';
        if (!same(pose(state.currentPiece), event.pose)) return 'stale-pose';
        if (event.error) return 'error';
        return event.hasActions ? 'accepted' : 'no-path';
    };

    function settleComputation() {
        if (!pendingCompute || clock.now + EPSILON < pendingCompute.event.readyAtMs
            || (pendingCompute.event.chargedMs > 0 && logicThroughMs + EPSILON < pendingCompute.event.readyAtMs)) {
            return null;
        }
        const pending = pendingCompute;
        pendingCompute = null;
        const { event, selected } = pending;
        event.settledAtMs = clock.now;
        event.disposition = computationDisposition(event);
        event.settledPose = pose(state.currentPiece);
        event.settledStep = active?.step ?? null;
        event.settledBoardHash = masteryBoardHash(state);
        if (event.error) throw new Error(event.error);
        if (event.disposition.startsWith('stale-')) {
            counters.staleComputations++;
            // Only an unchanged board and the same piece may keep its geometric destination.
            repairTarget = event.disposition === 'stale-pose' ? pending.target : null;
            replanReason = `computation-${event.disposition}`;
            return null;
        }
        if (event.disposition === 'no-path') {
            if (event.kind === 'repair') {
                counters.repairFailures++;
                repairTarget = null;
                replanReason = 'repair-failed';
                return null; // A full search may start on a later input frame, never recursively here.
            }
            counters.fallbackDrops++;
            return { command: { type: 'hardDrop' }, source: 'fallback' };
        }
        if (event.kind === 'repair') counters.repairSuccesses++;
        plan = {
            actions: structuredClone(selected?.actions || event.actions),
            index: 0,
            expectedPose: pose(state.currentPiece),
            target: pending.target,
            source: event.kind === 'repair' ? 'repair' : 'planner',
        };
        repairTarget = null;
        return { command: plan.actions[0], source: plan.source };
    }

    function startComputation(kind) {
        const observation = currentObservation();
        const observationHash = digest(observation);
        const target = kind === 'repair' ? structuredClone(repairTarget) : null;
        const targetHash = digest(target);
        const before = realNow();
        const cpuBefore = process.cpuUsage();
        const nodeLimit = Math.min(
            kind === 'repair' ? config.maxRepairNodes : config.maxNodesPerPlan,
            config.maxNodes - nodes,
        );
        let selected;
        let computationError = null;
        try {
            selected = kind === 'repair' ? repairer(observation, target, {
                maxNodes: nodeLimit,
                wallBudgetMs: Math.max(0.001, config.wallBudgetMs - (before - beganAt)),
            }) : planner(observation, {
                beamWidth: config.beamWidth,
                maxNodes: config.maxNodes - nodes,
                maxNodesPerPlan: nodeLimit,
                unknownTailDepth: config.unknownTailDepth,
                setupStrategy: config.setupStrategy,
                wallBudgetMs: Math.max(0.001, config.wallBudgetMs - (before - beganAt)),
            });
            if (digest(observation) !== observationHash) throw new Error('Planner mutated its observation');
            if (digest(target) !== targetHash) throw new Error('Repairer mutated its target');
            if (kind === 'repair' && (!['reachable', 'unreachable', 'budget'].includes(selected?.status)
                || Boolean(selected?.actions?.length) !== (selected.status === 'reachable')
                || (selected.status === 'reachable' && (!same(pose(selected.target), pose(target))
                    || selected.actions.at(-1).type !== 'hardDrop'
                    || selected.actions.slice(0, -1).some((action) => action.type === 'hardDrop'))))) {
                throw new Error('Repairer returned inconsistent reachability evidence');
            }
            if (selected?.actions?.length && !selected.actions.every(commandValid)) {
                throw new Error('Planner returned invalid command vocabulary');
            }
        } catch (error) { computationError = error.message || String(error); }
        const duration = realNow() - before;
        const cpu = process.cpuUsage(cpuBefore);
        const cpuMs = (cpu.user + cpu.system) / 1000;
        const usedNodes = selected?.diagnostics?.nodes ?? 0;
        if (!Number.isSafeInteger(usedNodes) || usedNodes < 0 || usedNodes > nodeLimit) {
            computationError = 'Computation exceeded its declared node budget';
        }
        nodes += Number.isSafeInteger(usedNodes) && usedNodes >= 0 ? usedNodes : 0;
        if (kind === 'repair') {
            counters.repairAttempts++; repairWallMs += duration; repairCpuMs += cpuMs; repairNodes += usedNodes;
        } else {
            counters.planningCalls++; plannerWallMs += duration; plannerCpuMs += cpuMs; plannerNodes += usedNodes;
        }
        const chargedMs = latencyFor(duration);
        const event = {
            index: computeSchedule.length + 1,
            kind,
            step: active.step,
            atMs: clock.now,
            readyAtMs: clock.now + chargedMs,
            chargedMs,
            computeWallMs: duration,
            observationHash,
            pose: pose(state.currentPiece),
            boardHash: masteryBoardHash(state),
            target: kind === 'repair' ? target : (selected?.prediction?.lockedPiece || null),
            actions: structuredClone(selected?.actions || []),
            hasActions: Boolean(selected?.actions?.length),
            repairStatus: kind === 'repair' ? (selected?.status || null) : null,
            error: computationError,
            settledAtMs: null,
            disposition: 'pending',
        };
        computeSchedule.push(event);
        decisions.push({
            index: decisions.length + 1,
            kind,
            step: active.step,
            atMs: clock.now,
            reason: replanReason,
            pose: pose(state.currentPiece),
            preview: observation.preview,
            observationHash,
            primaryAcquired: primaryReachedAtPiece !== null,
            plannerWallMs: kind === 'plan' ? duration : 0,
            plannerCpuMs: kind === 'plan' ? cpuMs : 0,
            repairWallMs: kind === 'repair' ? duration : 0,
            repairCpuMs: kind === 'repair' ? cpuMs : 0,
            chargedMs,
            nodes: usedNodes,
            diagnostics: selected?.diagnostics ?? null,
        });
        if (perPieceDecisions > 0) counters.replans++;
        perPieceDecisions++;
        pendingCompute = {
            event, selected, target: kind === 'repair' ? target : (selected?.prediction?.lockedPiece || null),
        };
        // Even failed attempts have a window. A wall cutoff may censor it before readiness.
        if (realNow() - beganAt >= config.wallBudgetMs) { stopAtBudget('wall-budget'); return null; }
        return settleComputation();
    }

    function chooseCommand() {
        if (pendingCompute) return settleComputation();
        if (plan && !same(plan.expectedPose, pose(state.currentPiece))) {
            counters.gravityReplans++;
            repairTarget = plan.target;
            plan = null;
            replanReason = 'gravity-changed-pose';
        }
        if (plan && plan.index >= plan.actions.length) {
            repairTarget = plan.target; plan = null; replanReason = 'path-exhausted';
        }
        if (!plan) {
            if (perPieceDecisions >= config.maxReplansPerPiece) {
                counters.fallbackDrops++;
                return { command: { type: 'hardDrop' }, source: 'fallback' };
            }
            if (decisions.length >= config.maxDecisions) { stopAtBudget('decision-budget'); return null; }
            if (nodes >= config.maxNodes) { stopAtBudget('node-budget'); return null; }
            const kind = config.pathRepair === 'reachable-v1' && repairTarget ? 'repair' : 'plan';
            return startComputation(kind);
        }
        return { command: plan.actions[plan.index], source: plan.source };
    }

    function replayComputation() {
        if (!modernReplay) return;
        if (pendingCompute) { settleComputation(); return; }
        if (plan && (!same(plan.expectedPose, pose(state.currentPiece)) || plan.index >= plan.actions.length)) {
            repairTarget = plan.target;
            plan = null;
        }
        const recorded = expected.computeSchedule[replayComputeCursor];
        if (!recorded || recorded.atMs > clock.now + EPSILON) return;
        if (Math.abs(recorded.atMs - clock.now) > EPSILON || !active || active.lockedPiece
            || state.isProcessingPhysics || clock.now + EPSILON < nextActionAt) {
            throw new Error('Recorded computation is not on an eligible input frame');
        }
        const observation = currentObservation();
        if (recorded.step !== active.step || !same(recorded.pose, pose(state.currentPiece))
            || recorded.boardHash !== masteryBoardHash(state) || recorded.observationHash !== digest(observation)) {
            throw new Error('Recorded computation observation mismatch');
        }
        if (plan || perPieceDecisions >= config.maxReplansPerPiece
            || replayComputeCursor >= config.maxDecisions
            || (recorded.kind === 'repair' && (!repairTarget || !same(recorded.target, repairTarget)))) {
            throw new Error('Recorded computation violates policy ownership or recovery budget');
        }
        const event = {
            ...structuredClone(recorded), settledAtMs: null, disposition: 'pending',
        };
        delete event.settledPose; delete event.settledStep; delete event.settledBoardHash;
        computeSchedule.push(event);
        pendingCompute = { event, target: event.target };
        plan = null;
        perPieceDecisions++;
        replayComputeCursor++;
        // A computation can exhaust its real wall budget before even a zero-charge release.
        replayStop();
        if (!terminal) settleComputation();
    }

    function interruptComputation() {
        if (!pendingCompute) return;
        const { event } = pendingCompute;
        event.settledAtMs = clock.now;
        event.disposition = 'interrupted';
        event.settledPose = pose(state.currentPiece);
        event.settledStep = active?.step ?? null;
        event.settledBoardHash = masteryBoardHash(state);
        pendingCompute = null;
    }

    function replayStop() {
        if (!expected || clock.now + EPSILON < expected.stoppedAtSeconds * 1000 || terminal
            || phase !== expected.stopPhase) return;
        if (expected.reason === 'manual-showcase-finish') {
            if (!state.goalComplete || state.isProcessingPhysics || engine.calculateStars() !== 3) {
                throw new Error('Recorded manual mastery finish is not available');
            }
            finish('win', 'manual-showcase-finish');
        } else if (harnessReasons.has(expected.reason)) stopAtBudget(expected.reason);
        else throw new Error('Recorded authored terminal event did not occur');
    }

    try {
        clock.install();
        console.error = (...args) => {
            if (String(args[0]).includes('Physics processing failed')) {
                physicsError = args.find((arg) => arg instanceof Error) || new Error(String(args[0]));
            }
            originalError(...args);
        };
        engine.configure(level);
        state = engine.createGameState({ rngSeed: config.seed });
        state.suppressExternalInput = true;
        state.lastTime = clock.now;
        initialCells = state.boardGrid.flat().filter(Boolean).length;
        initialBoardHash = masteryBoardHash(state);
        session = createOdysseyLevelSession({
            gameState: state,
            hybridEngine: engine,
            levelConfig: level,
            levelId: level.id,
            generation: 1,
            rngDescriptor: state.rngDescriptor,
            simulationClock: 'legacy-variable-v1',
        });
        const frameRateController = {
            isRunning: false,
            needsHybridMode: () => true,
            startHybridLoop(logic, render) { loop = { logic, render }; this.isRunning = true; },
            stopHybridLoop() { this.isRunning = false; },
        };
        const mode = {
            deps: { frameRateController, settingsManager: { get: () => ({ reducedMotion: false }) } },
            statsUpdateInterval: 100,
            _isLevelSessionActive: owns,
            _stopFixedTickSession() {},
            _getBoardScene: () => null,
            _getPhysicsCallbacks: () => callbacks,
            _updateStats() {},
            _updateOdysseyHUD() {},
            _updateMinimap() {},
            _refreshNextQueue() {},
            _handleGameOver: topOut,
            _checkVictoryConditions: checkGoals,
        };
        callbacks = createOdysseyPhysicsCallbacks(mode, session);
        const originalSpawn = callbacks.spawnPiece;
        callbacks.spawnPiece = () => {
            try {
                completePiece();
                if (!terminal) { originalSpawn(); beginPiece(); }
            } catch (error) { physicsError = error; throw error; }
        };
        for (const [name, observe] of Object.entries({
            onPieceLock: (piece) => {
                if (!active || active.lockedPiece) throw new Error('Unowned online piece lock');
                if (!inputSource) counters.automaticLocks++;
                active.lockedPiece = { ...pose(piece), shape: structuredClone(piece.shape) };
                active.lockAtMs = clock.now;
                active.lockSource = inputSource || 'automatic';
                if (piece.shape.flat().filter(Boolean).length !== 4) throw new Error('Non-tetromino lock');
            },
            onLineClear: (lines) => active?.lineClears.push(lines),
            triggerCascadeWave: (depth) => { if (active) active.maximumDepth = Math.max(active.maximumDepth, depth); },
        })) {
            const original = callbacks[name];
            callbacks[name] = (...args) => { original?.(...args); observe(...args); };
        }
        session.physicsCallbacks = callbacks;
        fillBag(state.nextPieces, state.randomGenerator);
        spawnPiece(state, null, topOut);
        beginPiece();
        startOdysseyGameplayLoop(mode, session);
        while (!terminal) {
            phase = 'boundary';
            if (physicsError) throw physicsError;
            completePiece();
            checkGoals();
            if (terminal) break;
            if (!state.isProcessingPhysics && checkInfinityGameOver(state)) { topOut(); break; }
            if (expected) {
                replayStop();
                if (realNow() - beganAt >= replayWallBudgetMs) {
                    throw new Error('Independent replay wall budget exhausted');
                }
            } else if (state.goalComplete && !state.isProcessingPhysics && engine.calculateStars() === 3) {
                // A benchmark policy explicitly chooses the live Finish action here.
                finish('win', 'manual-showcase-finish');
            } else if (realNow() - beganAt >= config.wallBudgetMs) stopAtBudget('wall-budget');
            else if (clock.now / 1000 >= config.maxSimSeconds) stopAtBudget('simulation-budget');
            else if (engine.getMetrics().piecesPlaced >= config.maxPieces && !state.isProcessingPhysics) {
                stopAtBudget('piece-budget');
            }
            if (terminal) break;
            const limitMs = expected ? expected.stoppedAtSeconds * 1000 : config.maxSimSeconds * 1000;
            const frameMs = Math.min(FRAME_MS, Math.max(0, limitMs - clock.now));
            if (frameMs <= EPSILON) throw new Error('Online execution made no clock progress');
            phase = 'timers';
            await clock.advance(frameMs);
            completePiece();
            beginPiece();
            phase = 'input';
            if (expected) {
                replayComputation();
                const command = expected.commands[replayCursor];
                if (command && command.atMs <= clock.now + EPSILON) {
                    if (Math.abs(command.atMs - clock.now) > EPSILON) {
                        throw new Error('Recorded input is not on its frame');
                    }
                    if (pendingCompute) throw new Error('Recorded input occurs during computation');
                    if (modernReplay) {
                        const candidate = plan?.actions[plan.index];
                        const lastCompute = computeSchedule.at(-1);
                        const matchingPlan = ['planner', 'repair'].includes(command.source)
                            && plan?.source === command.source
                            && candidate?.type === command.type && candidate?.dir === command.dir;
                        const matchingFallback = command.source === 'fallback' && command.type === 'hardDrop'
                            && (perPieceDecisions >= config.maxReplansPerPiece
                                || (lastCompute?.kind === 'plan' && lastCompute.disposition === 'no-path'
                                    && Math.abs(lastCompute.settledAtMs - clock.now) <= EPSILON));
                        if (!matchingPlan && !matchingFallback) {
                            throw new Error('Recorded input has no matching computation or bounded fallback');
                        }
                    }
                    if (clock.now + EPSILON < nextActionAt) {
                        throw new Error('Recorded input violates cadence or reaction');
                    }
                    perform(command, command.source);
                    replayCursor++;
                }
                replayStop();
            } else if (pendingCompute && !terminal) {
                const choice = settleComputation();
                if (choice) perform(choice.command, choice.source);
            } else if (active && !active.lockedPiece && !state.isProcessingPhysics && !terminal
                && clock.now + EPSILON >= nextActionAt) {
                const choice = chooseCommand();
                if (choice) perform(choice.command, choice.source);
            }
            phase = 'logic';
            if (!terminal) { loop.logic(clock.now, frameMs); logicThroughMs = clock.now; }
            await clock.flush();
            completePiece();
            phase = 'render';
            if (!terminal) loop.render();
        }
        interruptComputation();
        draining = true;
        if (state.latestPhysicsPromise) await clock.settle(state.latestPhysicsPromise);
        draining = false;
        if (physicsError) throw physicsError;
        completePiece();
        updateMetrics();
        const quality = evaluateMasteryQuality(engine, requirements, true);
        result = {
            schemaVersion: 1,
            kind: 'online-mastery-witness',
            version: expected?.version || MASTERY_ONLINE_VERSION,
            status: 'observed',
            levelId: level.id,
            seed: config.seed,
            config,
            ...terminal,
            timed: true,
            initialBoardHash,
            previewLimit: 3,
            knowledgePolicy: 'current-plus-three-preview-receding-horizon',
            primaryReached: primaryReachedAtPiece !== null,
            primaryReachedAtPiece,
            goalReachedAtSeconds,
            metrics: engine.getMetrics(),
            maximumDepth: engine.getMetrics().maxCascadeDepth,
            quality: {
                ...quality,
                masteryConditionsMet: primaryReachedAtPiece !== null && quality.tierThreeConditionsMet,
                censored: Boolean(terminal.qualityCensored),
            },
            requirements,
            commands,
            trace,
            decisions,
            computeSchedule,
            counters,
            nodes,
            plannerWallMs,
            plannerCpuMs,
            repairWallMs,
            repairCpuMs,
            plannerNodes,
            repairNodes,
            planningChargedMs: computeSchedule.reduce((sum, entry) => sum + entry.chargedMs, 0),
            planningElapsedMs: computeSchedule.reduce((sum, entry) => sum + entry.settledAtMs - entry.atMs, 0),
            planningLatency: config.planningLatency,
            plannerWallTimeChargedToSimulation: config.planningLatency === 'measured-wall',
            realtimePlanningFeasibility: 'unverified',
            timingPolicy: config.timingPolicy,
            physicsTimingPolicy: 'legacy-virtual-60hz-normal-motion',
            computeReleasePolicy: 'Positive charge releases at the first input frame after logic reaches readyAtMs; '
                + 'zero charge may release immediately.',
            physicsDrainedThroughSeconds: clock.now / 1000,
            finishPolicy: 'Explicit policy Finish at authored tier three after primary; no live deadline auto-finish.',
            traceValid: true,
            allRecordedLocksComplete: trace.filter((entry) => entry.lockedPiece).every((entry) => entry.completed),
            interpretation: 'Adaptive choices with legal timed execution under a declared synthetic planning schedule. '
                + `Planning latency model: ${config.planningLatency}; computations release after their charge. `
                + 'Measured process CPU is reported; this schedule does not establish real-time player feasibility.',
        };
        if (expected) {
            const actualProjection = replayProjection(result);
            const expectedProjection = replayProjection(expected);
            const valid = replayCursor === expected.commands.length
                && (!modernReplay || replayComputeCursor === expected.computeSchedule.length)
                && same(actualProjection, expectedProjection);
            result.kind = 'online-mastery-replay';
            result.replayValid = valid;
            result.traceComplete = valid;
            result.status = valid ? 'pass' : 'fail';
            result.failure = valid ? null : { reason: 'recorded-execution-mismatch' };
            result.expectedExecutionHash = digest(expectedProjection);
            result.actualExecutionHash = digest(actualProjection);
        }
    } catch (error) {
        result = {
            schemaVersion: 1,
            kind: expected ? 'online-mastery-replay' : 'online-mastery-witness',
            version: expected?.version || MASTERY_ONLINE_VERSION,
            config,
            levelId: level.id,
            seed: config.seed,
            status: 'error',
            outcome: 'error',
            reason: error.message || String(error),
            traceValid: false,
            replayValid: false,
            traceComplete: false,
            commands,
            trace,
            decisions,
            computeSchedule,
            counters,
            nodes,
            plannerWallMs,
            plannerCpuMs,
            repairWallMs,
            repairCpuMs,
            plannerNodes,
            repairNodes,
            planningChargedMs: computeSchedule.reduce((sum, entry) => sum + entry.chargedMs, 0),
            planningElapsedMs: computeSchedule.reduce((sum, entry) => sum + entry.settledAtMs - entry.atMs, 0),
            planningLatency: config.planningLatency,
            plannerWallTimeChargedToSimulation: config.planningLatency === 'measured-wall',
            realtimePlanningFeasibility: 'unverified',
        };
    } finally {
        try {
            if (session) {
                retireOdysseyLevelSession(session);
                await clock.settle(drainOdysseyLevelSession(session));
            }
        } catch (error) {
            result.status = 'error'; result.outcome = 'error'; result.traceValid = false;
            result.replayValid = false; result.traceComplete = false;
            result.reason = 'physics-drain-error'; result.cleanupError = error.message || String(error);
        } finally {
            state?.reset(); engine.reset(); console.error = originalError; clock.restore();
        }
    }
    result.wallMs = realNow() - beganAt;
    return result;
}

/** The optional injected planner is a focused-test seam; it receives only the allowlisted observation. */
export async function runOnlineMastery(options, {
    planner = planMasteryObservation, repairer = repairMasteryPath,
} = {}) {
    return execute(options, { planner, repairer });
}

/** Reconstruct every recorded command and automatic lock without evaluating the planner. */
export async function replayOnlineMastery(input, { wallBudgetMs = 120000 } = {}) {
    const witness = structuredClone(input);
    validateWitness(witness);
    if (!Number.isFinite(wallBudgetMs) || wallBudgetMs <= 0) {
        throw new RangeError('Replay wall budget must be positive');
    }
    return execute(witness.config, { expected: witness, replayWallBudgetMs: wallBudgetMs });
}
