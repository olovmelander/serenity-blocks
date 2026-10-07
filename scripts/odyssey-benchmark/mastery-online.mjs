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

export const MASTERY_ONLINE_VERSION = 'adaptive-fixed-cadence-v1';
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
    if (config.timingPolicy !== 'fixed-cadence') throw new RangeError('Only fixed-cadence timing is implemented');
    return { config, level };
}

function validateWitness(witness) {
    if (witness?.kind !== 'online-mastery-witness' || witness.version !== MASTERY_ONLINE_VERSION
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
    };
}

async function execute(input, { planner = null, expected = null, replayWallBudgetMs = null } = {}) {
    const { config, level } = configuration(input);
    const clock = createVirtualClock();
    const requirements = getMasteryRequirements(level);
    const engine = new GameplayHybridEngine();
    const beganAt = realNow();
    const originalError = console.error;
    const commands = [];
    const trace = [];
    const decisions = [];
    const counters = {
        replans: 0, gravityReplans: 0, rejectedInputs: 0, groundedStops: 0, automaticLocks: 0, fallbackDrops: 0,
    };
    let state;
    let session;
    let callbacks;
    let loop;
    let active = null;
    let plan = null;
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
    let phase = 'setup';
    let replayCursor = 0;
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
    }

    function perform(command, source) {
        if (!active || active.lockedPiece || state.isProcessingPhysics || !state.currentPiece) {
            throw new Error('Input attempted outside an active falling piece');
        }
        if (!commandValid(command)) throw new Error('Planner returned an invalid command');
        const entry = active;
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
        nextActionAt = clock.now + config.actionIntervalMs;
        if (legalStop) {
            counters.groundedStops++;
            plan = null;
            replanReason = 'grounded-stop';
        } else if (!accepted) {
            counters.rejectedInputs++;
            plan = null;
            replanReason = 'rejected-input';
        } else if (plan) {
            plan.index++;
            plan.expectedPose = pose(state.currentPiece);
        }
    }

    function chooseCommand() {
        if (plan && !same(plan.expectedPose, pose(state.currentPiece))) {
            counters.gravityReplans++;
            plan = null;
            replanReason = 'gravity-changed-pose';
        }
        if (plan && plan.index >= plan.actions.length) { plan = null; replanReason = 'path-exhausted'; }
        if (!plan) {
            if (perPieceDecisions >= config.maxReplansPerPiece) {
                counters.fallbackDrops++;
                return { command: { type: 'hardDrop' }, source: 'fallback' };
            }
            if (decisions.length >= config.maxDecisions) { stopAtBudget('decision-budget'); return null; }
            if (nodes >= config.maxNodes) { stopAtBudget('node-budget'); return null; }
            updateMetrics();
            const observation = createMasteryObservation(state, engine.getMetrics(), level, {
                primaryAcquired: primaryReachedAtPiece !== null,
                actionIntervalMs: config.actionIntervalMs,
                reactionMs: config.reactionMs,
            });
            const observationHash = digest(observation);
            const before = realNow();
            const cpuBefore = process.cpuUsage();
            const selected = planner(observation, {
                beamWidth: config.beamWidth,
                maxNodes: config.maxNodes - nodes,
                maxNodesPerPlan: Math.min(config.maxNodesPerPlan, config.maxNodes - nodes),
                unknownTailDepth: config.unknownTailDepth,
                setupStrategy: config.setupStrategy,
                wallBudgetMs: Math.max(0.001, config.wallBudgetMs - (before - beganAt)),
            });
            const duration = realNow() - before;
            const cpu = process.cpuUsage(cpuBefore);
            const cpuMs = (cpu.user + cpu.system) / 1000;
            plannerCpuMs += cpuMs;
            plannerWallMs += duration;
            if (digest(observation) !== observationHash) throw new Error('Planner mutated its observation');
            const usedNodes = Number(selected?.diagnostics?.nodes) || 0;
            nodes += usedNodes;
            decisions.push({
                index: decisions.length + 1,
                step: active.step,
                atMs: clock.now,
                reason: replanReason,
                pose: pose(state.currentPiece),
                preview: observation.preview,
                observationHash,
                primaryAcquired: primaryReachedAtPiece !== null,
                plannerWallMs: duration,
                plannerCpuMs: cpuMs,
                nodes: usedNodes,
                diagnostics: selected?.diagnostics ?? null,
            });
            if (perPieceDecisions > 0) counters.replans++;
            perPieceDecisions++;
            if (realNow() - beganAt >= config.wallBudgetMs) { stopAtBudget('wall-budget'); return null; }
            if (!selected?.actions?.length) {
                counters.fallbackDrops++;
                return { command: { type: 'hardDrop' }, source: 'fallback' };
            }
            if (!selected.actions.every(commandValid)) throw new Error('Planner returned invalid command vocabulary');
            plan = { actions: selected.actions, index: 0, expectedPose: pose(state.currentPiece) };
        }
        return { command: plan.actions[plan.index], source: 'planner' };
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
                const command = expected.commands[replayCursor];
                if (command && command.atMs <= clock.now + EPSILON) {
                    if (Math.abs(command.atMs - clock.now) > EPSILON) {
                        throw new Error('Recorded input is not on its frame');
                    }
                    if (clock.now + EPSILON < nextActionAt) {
                        throw new Error('Recorded input violates cadence or reaction');
                    }
                    perform(command, command.source);
                    replayCursor++;
                }
                replayStop();
            } else if (active && !active.lockedPiece && !state.isProcessingPhysics && !terminal
                && clock.now + EPSILON >= nextActionAt) {
                const choice = chooseCommand();
                if (choice) perform(choice.command, choice.source);
            }
            phase = 'logic';
            if (!terminal) loop.logic(clock.now, frameMs);
            await clock.flush();
            completePiece();
            phase = 'render';
            if (!terminal) loop.render();
        }
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
            version: MASTERY_ONLINE_VERSION,
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
            counters,
            nodes,
            plannerWallMs,
            plannerCpuMs,
            plannerWallTimeChargedToSimulation: false,
            realtimePlanningFeasibility: 'unverified',
            timingPolicy: config.timingPolicy,
            physicsTimingPolicy: 'legacy-virtual-60hz-normal-motion',
            physicsDrainedThroughSeconds: clock.now / 1000,
            finishPolicy: 'Explicit policy Finish at authored tier three after primary; no live deadline auto-finish.',
            traceValid: true,
            allRecordedLocksComplete: trace.filter((entry) => entry.lockedPiece).every((entry) => entry.completed),
            interpretation: 'Adaptive choices with legal timed execution under a declared synthetic planning schedule. '
                + 'Measured planner CPU is bounded and reported but not charged to simulated time; '
                + 'real-time planning is unverified.',
        };
        if (expected) {
            const actualProjection = replayProjection(result);
            const expectedProjection = replayProjection(expected);
            const valid = replayCursor === expected.commands.length && same(actualProjection, expectedProjection);
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
            version: MASTERY_ONLINE_VERSION,
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
            counters,
            nodes,
            plannerWallMs,
            plannerCpuMs,
            plannerWallTimeChargedToSimulation: false,
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
export async function runOnlineMastery(options, { planner = planMasteryObservation } = {}) {
    return execute(options, { planner });
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
