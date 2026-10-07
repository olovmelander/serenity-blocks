/** Independent command execution witnesses; this module never calls a search policy. */
/* eslint-disable no-await-in-loop -- Commands, physics barriers and virtual frames are ordered. */
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
import { connectivityBoardKey } from './profiles.mjs';
import { createVirtualClock } from './virtual-clock.mjs';

const FRAME_MS = 1000 / 60;
const wallNow = () => Number(process.hrtime.bigint()) / 1e6;
const hash = (state) => createHash('sha256').update(connectivityBoardKey(state.boardGrid)).digest('hex');
const pose = (piece) => (piece ? {
    shapeKey: piece.shapeKey, x: piece.x, y: piece.y, rotation: piece.rotation,
} : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function validCommand(command) {
    if (command?.type === 'move') return [-1, 1].includes(command.dir);
    if (command?.type === 'rotate') return ['left', 'right', 'flip'].includes(command.dir);
    return command?.type === 'softDrop' || command?.type === 'hardDrop';
}

function validate(candidate, options) {
    normalizeSessionSeed(candidate?.seed);
    const level = getLevelById(candidate.levelId);
    if (!level || level.mechanics?.versus) throw new RangeError('Replay requires an authored solo orb');
    if (candidate.previewLimit !== 3 || !/^[a-f0-9]{64}$/.test(candidate.initialBoardHash || '')) {
        throw new TypeError('Candidate requires previewLimit 3 and a recorded initialBoardHash');
    }
    if (!Array.isArray(candidate.trace) || candidate.trace.length < 1 || candidate.trace.length > 1024) {
        throw new RangeError('Candidate trace must contain 1 to 1024 pieces');
    }
    for (const entry of candidate.trace) {
        if (!Array.isArray(entry.preview) || entry.preview.length !== 3
            || !Array.isArray(entry.plannedActions) || !entry.plannedActions.length
            || entry.plannedActions.length > 512 || !entry.plannedActions.every(validCommand)
            || !/^[a-f0-9]{64}$/.test(entry.boardHashBefore || '')
            || !/^[a-f0-9]{64}$/.test(entry.boardHashAfter || '')) {
            throw new TypeError('Each candidate piece needs three previews, board hashes and 1 to 512 legal commands');
        }
    }
    if (!['untimed', 'timed'].includes(options.mode)) throw new TypeError('Replay mode must be untimed or timed');
    if (!Number.isFinite(options.reactionMs) || options.reactionMs < 0) {
        throw new RangeError('reactionMs must be finite and nonnegative');
    }
    for (const key of ['actionIntervalMs', 'maxSimSeconds', 'wallBudgetMs']) {
        if (!Number.isFinite(options[key]) || options[key] <= 0) {
            throw new RangeError(`${key} must be finite and positive`);
        }
    }
    return level;
}

function conservation(state, initialCells, metrics) {
    const rows = state.boardGrid.length;
    const columns = state.boardGrid[0].length;
    let outside = 0;
    const occupied = new Set();
    let overlap = false;
    for (const piece of state.lockedPieces) {
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (!piece.shape[y][x]) continue;
                const px = piece.x + x;
                const py = piece.y + y;
                const key = `${px},${py}`;
                overlap ||= occupied.has(key);
                occupied.add(key);
                if (px < 0 || px >= columns || py < 0 || py >= rows) outside++;
            }
        }
    }
    const visible = state.boardGrid.flat().filter(Boolean).length;
    const expected = initialCells + metrics.piecesPlaced * 4 - metrics.lines * columns;
    return {
        expected,
        actual: visible + outside,
        visible,
        offBoard: outside,
        overlap,
        valid: !overlap && expected === visible + outside && occupied.size === visible + outside,
    };
}

function quality(engine, requirements, timed) {
    const observedBonuses = engine.evaluateBonuses();
    const qualifiedBonuses = observedBonuses.map((met, i) => met
        && (timed || !requirements.bonuses[i].timeConstraints.length));
    const tiers = Object.fromEntries(['one', 'two', 'three'].map((tier) => {
        const conditions = { ...requirements.stars[tier].conditions };
        if (!timed) delete conditions.time;
        const stars = engine.victoryEvaluator.calculateStars({ one: conditions }, engine.gameState, qualifiedBonuses);
        return [tier, {
            conditionsMet: stars === 1,
            timingVerified: timed,
        }];
    }));
    return {
        tiers,
        // Optional bonus completion is reported separately; it is not an extra tier-three gate.
        optionalBonuses: requirements.bonuses.map((bonus, i) => ({
            index: i,
            type: bonus.type,
            conditionMet: timed || !bonus.timeConstraints.length ? observedBonuses[i] : null,
        })),
        tierThreeConditionsMet: tiers.three.conditionsMet,
        timedStars: timed ? engine.calculateStars() : null,
    };
}

/**
 * Replay a recorded policy's commands from the authored start, independently of its planner.
 * Static commands certify execution only: matching three previews cannot prove that their
 * author did not use future bag information. Solver observation-boundary tests own that claim.
 */
export async function replayMasteryCandidate(input, {
    mode: replayMode = 'untimed', reactionMs = 150, actionIntervalMs = 100,
    maxSimSeconds = 1800, wallBudgetMs = 120000,
} = {}) {
    const candidate = structuredClone(input);
    const options = {
        mode: replayMode, reactionMs, actionIntervalMs, maxSimSeconds, wallBudgetMs,
    };
    const level = validate(candidate, options);
    const requirements = getMasteryRequirements(level);
    const timed = replayMode === 'timed';
    const clock = createVirtualClock();
    const startedAt = wallNow();
    const originalError = console.error;
    const engine = new GameplayHybridEngine();
    let state;
    let session;
    let loop;
    let physicsError;
    let failure = null;
    let terminal = null;
    let active = null;
    let cursor = 0;
    let inputActive = false;
    let draining = false;
    let automaticLocks = 0;
    let primaryReachedAtPiece = null;
    let goalReachedAtSeconds = null;
    let nextActionAt = 0;
    let initialCells = 0;
    let result;
    const trace = [];
    // A budget may stop inputs halfway through a wave. Keep that lock's metric
    // callbacks owned during the explicit drain; never promote its late goal.
    const isActive = () => !!session && !session.retired && (!terminal || draining);
    const fail = (reason, details = {}) => { failure ||= { reason, step: cursor + 1, ...details }; };
    const finish = (outcome, reason, qualityCensored = false) => {
        terminal ||= {
            outcome, reason, qualityCensored, stoppedAtSeconds: timed ? clock.now / 1000 : null,
        };
    };
    const updateMetrics = () => {
        engine.updateScore(state.score);
        engine.updateTime(timed ? clock.now / 1000 : 0);
        if (state.isInfinityMode) engine.victoryEvaluator.updateHeight(calculateBuildHeight(state));
    };
    const topOut = () => {
        state.isGameOver = true;
        if (state.goalComplete) finish('win', 'showcase-top-out');
        else finish('loss', 'top-out');
    };
    const checkGoals = () => {
        if (!isActive()) return;
        updateMetrics();
        if (state.isProcessingPhysics || state.goalComplete) return;
        if (engine.checkVictory()) {
            primaryReachedAtPiece = engine.getMetrics().piecesPlaced;
            goalReachedAtSeconds = timed ? clock.now / 1000 : null;
            if (requirements.finishPolicy.stopAfterPrimaryResolution) finish('win', 'primary-goal');
            else { state.goalComplete = true; state.victoryLapActive = true; }
        } else if (timed && engine.checkFailure()) finish('loss', state.isGameOver ? 'top-out' : 'deadline');
    };
    const stopAtBudget = (reason) => finish(state.goalComplete ? 'win' : 'censored', reason, !!state.goalComplete);

    function beginEntry() {
        if (active || cursor >= candidate.trace.length || !state.currentPiece || state.isProcessingPhysics) return;
        const expected = candidate.trace[cursor];
        active = {
            step: cursor + 1,
            shapeKey: state.currentPiece.shapeKey,
            spawnPose: pose(state.currentPiece),
            spawnAtMs: state.pieceSpawnTime,
            preview: state.nextPieces.slice(0, 3),
            boardHashBefore: hash(state),
            actions: [],
            lineClears: [],
            maximumDepth: 0,
            completed: false,
        };
        trace.push(active);
        if (active.shapeKey !== expected.shapeKey) fail('piece-sequence-mismatch');
        if (!same(active.preview, expected.preview)) fail('preview-mismatch');
        if (active.boardHashBefore !== expected.boardHashBefore) fail('board-continuity-mismatch');
        if (state.currentPiece.shape.flat().filter(Boolean).length !== 4) fail('non-tetromino');
        nextActionAt = Math.max(clock.now, state.pieceSpawnTime + reactionMs);
    }

    function perform(callbacks) {
        const command = candidate.trace[cursor].plannedActions[active.actions.length];
        if (!command) { fail('incomplete-plan'); return; }
        if (active.lockedPiece || !state.currentPiece) { fail('command-after-lock'); return; }
        const beforePose = pose(state.currentPiece);
        const grounded = command.type === 'softDrop'
            && !canPlacePiece(state, state.currentPiece, state.currentPiece.x, state.currentPiece.y + 1);
        let accepted;
        inputActive = true;
        try {
            if (command.type === 'move') accepted = move(state, command.dir);
            else if (command.type === 'rotate') accepted = rotate(state, command.dir);
            else if (command.type === 'softDrop') accepted = softDrop(state, null, callbacks);
            else accepted = hardDrop(state, null, callbacks);
        } finally { inputActive = false; }
        const legalStop = accepted === false && grounded;
        active.actions.push({
            ...command,
            atMs: timed ? clock.now : null,
            accepted: accepted === true,
            legalStop,
            beforePose,
            afterPose: pose(state.currentPiece),
        });
        nextActionAt = clock.now + actionIntervalMs;
        if (!accepted && !legalStop) fail(timed ? 'timed-command-rejected' : 'command-rejected');
        if (active.lockedPiece && active.actions.length !== candidate.trace[cursor].plannedActions.length) {
            fail('command-after-lock');
        }
    }

    function completeEntry() {
        if (!active?.lockedPiece || state.isProcessingPhysics || active.completed) return;
        updateMetrics();
        const expected = candidate.trace[cursor];
        active.metricsAfter = engine.getMetrics();
        active.resolvedAtMs = timed ? clock.now : null;
        active.boardHashAfter = hash(state);
        active.cellConservation = conservation(state, initialCells, active.metricsAfter);
        active.completed = true;
        if (!active.cellConservation.valid) fail('cell-conservation-failure');
        if (active.boardHashAfter !== expected.boardHashAfter) {
            fail(timed ? 'timed-board-divergence' : 'board-replay-mismatch');
        }
        if (expected.lockedPiece && !same(pose(active.lockedPiece), pose(expected.lockedPiece))) {
            fail(timed ? 'timed-lock-divergence' : 'lock-replay-mismatch');
        }
        if (active.actions.length !== expected.plannedActions.length) fail('automatic-lock-before-plan-complete');
        cursor++;
        active = null;
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
        state = engine.createGameState({ rngSeed: candidate.seed });
        state.isSeeking = !timed;
        state.suppressExternalInput = true;
        state.lastTime = clock.now;
        initialCells = state.boardGrid.flat().filter(Boolean).length;
        if (hash(state) !== candidate.initialBoardHash) fail('authored-start-mismatch');
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
        let callbacks;
        const mode = {
            deps: { frameRateController, settingsManager: { get: () => ({ reducedMotion: false }) } },
            statsUpdateInterval: 100,
            _isLevelSessionActive: isActive,
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
        callbacks = timed ? createOdysseyPhysicsCallbacks(mode, session) : engine.buildPhysicsCallbacks({});
        if (callbacks.spawnPiece) {
            const originalSpawn = callbacks.spawnPiece;
            callbacks.spawnPiece = () => { if (!terminal && !failure) originalSpawn(); };
        }
        for (const [name, observe] of Object.entries({
            onPieceLock: (piece) => {
                if (!inputActive) { automaticLocks++; fail('automatic-lock'); }
                if (!active || active.lockedPiece) fail('unexpected-lock');
                else {
                    active.lockedPiece = { ...pose(piece), shape: structuredClone(piece.shape) };
                    active.lockAtMs = timed ? clock.now : null;
                    if (piece.shape.flat().filter(Boolean).length !== 4) fail('non-tetromino');
                }
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
        if (timed) startOdysseyGameplayLoop(mode, session);
        while (!terminal && !failure) {
            if (physicsError) throw physicsError;
            if (wallNow() - startedAt >= wallBudgetMs) { stopAtBudget('wall-budget'); break; }
            if (timed && clock.now / 1000 >= maxSimSeconds) { stopAtBudget('simulation-budget'); break; }
            completeEntry();
            checkGoals();
            if (terminal || failure) break;
            if (!state.isProcessingPhysics && checkInfinityGameOver(state)) { topOut(); break; }
            if (cursor === candidate.trace.length) {
                if (state.goalComplete) finish('win', 'manual-showcase-finish');
                else finish('censored', 'candidate-exhausted');
                break;
            }
            if (!timed && !state.currentPiece && !state.isProcessingPhysics) spawnPiece(state, null, topOut);
            beginEntry();
            if (terminal || failure) break;
            if (timed) {
                await clock.advance(Math.min(FRAME_MS, maxSimSeconds * 1000 - clock.now));
                if (active && !active.lockedPiece && !state.isProcessingPhysics && clock.now + 1e-7 >= nextActionAt) {
                    perform(callbacks);
                }
                loop.logic(clock.now, FRAME_MS);
                await clock.flush();
                completeEntry();
                loop.render();
            } else {
                perform(callbacks);
                if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
            }
        }
        // Even rejected command paths retain the complete preceding lock's physics evidence.
        draining = true;
        if (state.latestPhysicsPromise) await clock.settle(state.latestPhysicsPromise);
        draining = false;
        if (physicsError) throw physicsError;
        completeEntry();
        updateMetrics();
        if (failure) stopAtBudget('execution-interrupted');
        const complete = cursor === candidate.trace.length && !failure;
        const unusedPieces = candidate.trace.length - cursor;
        if (!timed && terminal?.reason === 'primary-goal' && unusedPieces) {
            fail('untimed-primary-auto-finish', { unusedPieces });
        }
        const observedQuality = quality(engine, requirements, timed);
        const completionStatus = complete ? 'pass' : 'inconclusive';
        result = {
            schemaVersion: 1,
            kind: 'mastery-candidate-replay',
            levelId: level.id,
            seed: candidate.seed,
            mode: replayMode,
            timed,
            status: failure ? 'fail' : completionStatus,
            replayValid: !failure,
            traceComplete: complete,
            failure,
            ...terminal,
            primaryReached: primaryReachedAtPiece !== null,
            primaryReachedAtPiece,
            goalReachedAtSeconds,
            metrics: { ...engine.getMetrics(), time: timed ? clock.now / 1000 : null },
            maximumDepth: engine.getMetrics().maxCascadeDepth,
            quality: {
                ...observedQuality,
                masteryConditionsMet: primaryReachedAtPiece !== null && observedQuality.tierThreeConditionsMet,
                censored: Boolean(terminal?.qualityCensored),
            },
            requirements,
            piecesReplayed: cursor,
            unusedPieces,
            automaticLocks,
            trace,
            cadence: timed ? { reactionMs, actionIntervalMs, frameMs: FRAME_MS } : null,
            budgets: { maxSimSeconds, wallBudgetMs },
            physicsDrainedThroughSeconds: timed ? clock.now / 1000 : null,
            timingPolicy: timed ? 'legacy-virtual-60hz-normal-motion' : 'untimed-isSeeking-no-automatic-gravity',
            timeConstraintsStatus: timed ? 'observed-under-declared-cadence' : 'unverified',
            finishPolicy: {
                authored: level.victoryLapPolicy,
                candidateEndAfterShowcasePrimary: 'requested-manual-finish',
                afterShowcasePrimary: 'manual-finish-or-top-out; no deadline or three-star auto-finish',
            },
            knowledge: {
                previewLimit: 3,
                declaredPolicy: candidate.knowledgePolicy ?? null,
                certification: 'Static command execution witness; '
                    + 'preview agreement does not certify planner information access.',
            },
            interpretation: 'Replay legality, primary completion, tier-three conditions and optional bonuses '
                + 'are separate observations. Untimed scoring and route termination do not predict '
                + 'timed scoring or feasibility.',
        };
    } catch (error) {
        result = {
            schemaVersion: 1,
            kind: 'mastery-candidate-replay',
            levelId: level.id,
            seed: candidate.seed,
            mode: replayMode,
            timed,
            status: 'error',
            outcome: 'error',
            reason: error.message || String(error),
            replayValid: false,
            traceComplete: false,
            failure,
            trace,
        };
    } finally {
        try {
            if (session) {
                retireOdysseyLevelSession(session);
                await clock.settle(drainOdysseyLevelSession(session));
            }
        } catch (error) {
            result.status = 'error'; result.outcome = 'error'; result.reason = 'physics-drain-error';
            result.cleanupError = error.message || String(error);
        } finally {
            state?.reset(); engine.reset();
            console.error = originalError;
            clock.restore();
        }
    }
    result.wallMs = wallNow() - startedAt;
    return result;
}
