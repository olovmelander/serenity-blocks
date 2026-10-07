/* eslint-disable no-await-in-loop -- Preserve sequential virtual frames and physics barriers. */
import {
    canPlacePiece, fillBag, hardDrop, move, rotate, softDrop, spawnPiece,
} from '../../src/core/game.js';
import { calculateBuildHeight } from '../../src/core/infinity-grid.js';
import { normalizeSessionSeed } from '../../src/core/session-rng.js';
import { startOdysseyGameplayLoop } from '../../src/core/game-modes/odyssey-gameplay-loop.js';
import { createOdysseyPhysicsCallbacks } from '../../src/core/game-modes/odyssey-physics-callbacks.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { OdysseyBotMatch } from '../../src/core/odyssey/OdysseyBotMatch.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import {
    createOdysseyLevelSession, drainOdysseyLevelSession, fenceOdysseyPhysicsCallbacks,
    retireOdysseyLevelSession,
} from '../../src/core/odyssey/odyssey-level-session.js';
import { createBenchmarkBot } from './profiles.mjs';
import { resolveScenario } from './scenarios.mjs';
import { createVirtualClock } from './virtual-clock.mjs';

const FRAME_MS = 1000 / 60;
const ATTACK_COUNTERS = [
    'attacksSent', 'attackLinesSent', 'cleanLinesSent',
    'attacksReceived', 'attackLinesReceived', 'cleanLinesReceived',
];
const wallNow = () => Number(process.hrtime.bigint()) / 1e6;

/** Run real legacy Odyssey rules without presentation or campaign persistence. */
export async function runAttempt({
    levelId, seed, profile = 'stacker', maxSimSeconds = 900, maxPieces = 1200,
    wallBudgetMs = 20000, trace = false, scenarioId = 'baseline', cadenceId = 'native',
    lapWindowSeconds = null,
}) {
    const startedAt = wallNow();
    const profileId = typeof profile === 'string' ? profile : profile?.id || profile?.profileId;
    const commandTrace = [];
    const actionsTaken = {
        attempted: 0, accepted: 0, rejected: 0, failed: 0, legalStops: 0, locks: 0, byAction: {},
    };
    const clock = createVirtualClock();
    let session;
    let humanBot;
    let result;
    let terminal;
    let humanPieces = 0;
    let goalReachedAtSeconds = null;
    let goalMetrics = null;
    let goalStars = null;
    let lapEndReason = null;
    let runtimeError = null;
    let cleanupError = null;
    let loop;
    let mode;
    let activeInputAction = null;
    const locks = {
        input: 0, automatic: 0, hardDrop: 0, softDrop: 0,
    };
    const duelRounds = [];
    let currentRound;
    let initialPhysicsPolicy;
    let showcaseFinishPolicy;
    const originalConsoleError = console.error;
    const isActive = () => !!session && !session.retired && !terminal;

    function pose() {
        const state = session.gameState;
        const piece = state.currentPiece;
        return {
            piece: piece ? {
                shapeKey: piece.shapeKey, x: piece.x, y: piece.y, rotation: piece.rotation,
            } : null,
            dropIntervalMs: state.dropInterval,
            dropCounterMs: state.dropCounter,
            grounded: state.isGrounded,
            lockTimerMs: state.lockTimer,
            lockGroundedSinceMs: state.lockGroundedSince,
            pieceAgeMs: Number.isFinite(state.pieceSpawnTime) ? clock.now - state.pieceSpawnTime : null,
            lastLogicTimeMs: state.lastTime,
            hitStopRemainingMs: state.hitStopRemaining,
            processingPhysics: state.isProcessingPhysics,
            paused: state.isPaused,
            gameOver: state.isGameOver,
            schedulerCooldownMs: humanBot?.scheduler?.cooldownMs ?? null,
            reactionReadyAtMs: humanBot?.readyAtMs ?? null,
        };
    }

    function duelPlayers() {
        const { multiplayer } = session.duel;
        return multiplayer.players.map((state, index) => ({
            ...Object.fromEntries(ATTACK_COUNTERS.map((key) => [key, multiplayer.getPlayerMetrics(index)[key]])),
            frags: multiplayer.frags[index],
            deaths: multiplayer.deaths[index],
        }));
    }

    function startRound() {
        if (currentRound?.completed) {
            currentRound.intermissionSeconds = (clock.now - currentRound.endedAtMs) / 1000;
        }
        currentRound = {
            round: session.duel.round,
            startedAtMs: clock.now,
            firstDeathAtMs: null,
            endedAtMs: null,
            completed: false,
            intermissionSeconds: 0,
            baseline: duelPlayers(),
            deathEvents: [],
        };
        duelRounds.push(currentRound);
    }

    function observeDuel() {
        const { duel } = session;
        const originalMarkTopOut = duel.markTopOut.bind(duel);
        duel.markTopOut = (index) => {
            originalMarkTopOut(index);
            if (duel.pendingDeaths.has(index) && currentRound.firstDeathAtMs === null) {
                currentRound.firstDeathAtMs = clock.now;
            }
        };
        const originalHandleDeaths = duel.multiplayer.handlePlayerDeaths.bind(duel.multiplayer);
        duel.multiplayer.handlePlayerDeaths = (indices) => {
            // The real barrier has restored each first-notification attacker here.
            const attackers = [...duel.multiplayer.lastAttackerIds];
            const eliminated = originalHandleDeaths(indices);
            if (eliminated.length) {
                currentRound.firstDeathAtMs ??= clock.now;
                currentRound.deathEvents = eliminated.map((victimIndex) => {
                    const attacker = attackers[victimIndex];
                    const credited = Number.isInteger(attacker) && attacker >= 0
                        && attacker < duel.players.length && attacker !== victimIndex;
                    return { victimIndex, attackerIndex: credited ? attacker : null, credited };
                });
                currentRound.completed = true;
                currentRound.endedAtMs = clock.now;
                currentRound.finalPlayers = duelPlayers();
            }
            return eliminated;
        };
        startRound();
    }

    function duelTelemetry() {
        if (!session?.duel) return null;
        const finalPlayers = duelPlayers();
        const rounds = duelRounds.map((round) => {
            const endMs = round.endedAtMs ?? clock.now;
            const activeEndMs = round.firstDeathAtMs ?? endMs;
            const players = (round.finalPlayers || finalPlayers).map((player, index) => {
                const deltas = Object.entries(player).map(([key, value]) => [key, value - round.baseline[index][key]]);
                const deaths = round.deathEvents.filter((event) => event.victimIndex === index);
                return {
                    ...Object.fromEntries(deltas),
                    creditedDeaths: deaths.filter((event) => event.credited).length,
                    uncreditedDeaths: deaths.filter((event) => !event.credited).length,
                };
            });
            return {
                round: round.round,
                completed: round.completed,
                startSeconds: round.startedAtMs / 1000,
                endSeconds: endMs / 1000,
                durationSeconds: (endMs - round.startedAtMs) / 1000,
                activeSeconds: (activeEndMs - round.startedAtMs) / 1000,
                resolutionSeconds: (endMs - activeEndMs) / 1000,
                intermissionSeconds: round.intermissionSeconds
                    || (round.completed && round === currentRound ? (clock.now - endMs) / 1000 : 0),
                players,
                deathEvents: round.deathEvents,
            };
        });
        return {
            players: finalPlayers.map((player, index) => ({
                ...player,
                creditedDeaths: rounds.reduce((sum, round) => sum + round.players[index].creditedDeaths, 0),
                uncreditedDeaths: rounds.reduce((sum, round) => sum + round.players[index].uncreditedDeaths, 0),
            })),
            activeSeconds: rounds.reduce((sum, round) => sum + round.activeSeconds, 0),
            resolutionSeconds: rounds.reduce((sum, round) => sum + round.resolutionSeconds, 0),
            intermissionSeconds: rounds.reduce((sum, round) => sum + round.intermissionSeconds, 0),
            rounds,
        };
    }

    function telemetry() {
        return {
            locks: { ...locks },
            failedActions: actionsTaken.failed,
            legalSoftDropStops: actionsTaken.legalStops,
            activeSeconds: session?.duel ? duelTelemetry().activeSeconds : clock.now / 1000,
            policy: {
                replans: humanBot?.replanCount ?? 0,
                fallbackDrops: humanBot?.fallbackDrops ?? 0,
                pieceRetries: humanBot?.pieceRetryCount ?? 0,
                maxPieceRetries: humanBot?.maxPieceRetries ?? 0,
            },
        };
    }

    function planningKnowledge() {
        const inactivePolicy = session ? 'not-applicable' : 'uninitialized';
        return {
            humanPlanningPreviewLimit: 3,
            // Retain the historical field: null now means no opponent planning cap.
            opponentPreviewCount: null,
            opponentVisiblePreviewCount: session?.duel ? 3 : null,
            opponentPlanningPreviewLimit: null,
            opponentKnowledgePolicy: session?.duel ? 'production-full-real-bag' : inactivePolicy,
        };
    }

    function metrics() {
        if (!session) return {};
        return {
            ...session.hybridEngine.getMetrics(),
            score: session.duel?.score ?? session.gameState.score,
            time: clock.now / 1000,
        };
    }

    function finish(outcome, reason) {
        if (!terminal) terminal = { outcome, reason, elapsedSeconds: clock.now / 1000 };
    }

    function recordGoal() {
        if (goalReachedAtSeconds !== null) return;
        goalReachedAtSeconds = clock.now / 1000;
        goalMetrics = metrics();
        goalStars = session.hybridEngine.calculateStars();
    }

    function finishLap(reason) {
        lapEndReason = reason;
        finish('win', 'showcase-finished');
    }

    function topOut() {
        if (!isActive()) return;
        session.hybridEngine.updateTime(clock.now / 1000);
        session.hybridEngine.updateScore(session.duel?.score ?? session.gameState.score);
        if (session.duel) session.duel.markTopOut(0);
        else if (session.gameState.goalComplete) finishLap('top-out');
        else finish('loss', 'top-out');
    }

    function callbacks() {
        if (session.physicsCallbacks) return session.physicsCallbacks;
        const wrapped = createOdysseyPhysicsCallbacks(mode, session);
        const { onPieceLock } = wrapped;
        wrapped.onPieceLock = (...args) => {
            humanPieces++;
            locks[activeInputAction ? 'input' : 'automatic']++;
            if (activeInputAction === 'hardDrop' || activeInputAction === 'softDrop') locks[activeInputAction]++;
            if (trace) {
                const piece = args[0];
                commandTrace.push({
                    kind: 'lock',
                    atMs: clock.now,
                    round: session.duel?.round || 1,
                    source: activeInputAction || 'automatic',
                    shapeKey: piece.shapeKey,
                    pose: pose(),
                });
            }
            return onPieceLock(...args);
        };
        session.physicsCallbacks = fenceOdysseyPhysicsCallbacks(wrapped, isActive);
        return session.physicsCallbacks;
    }

    function action(name, callback) {
        return (...args) => {
            const shapeKey = session.gameState.currentPiece?.shapeKey || null;
            const before = trace ? pose() : null;
            const state = session.gameState;
            const allowed = isActive() && !state.isStopped;
            const canAct = allowed && !!state.currentPiece && !state.isPaused
                && !state.isGameOver && !state.isProcessingPhysics;
            const groundedSoftDrop = name === 'softDrop' && canAct
                && !canPlacePiece(state, state.currentPiece, state.currentPiece.x, state.currentPiece.y + 1);
            const previousPieces = humanPieces;
            let accepted;
            activeInputAction = name;
            try { accepted = allowed && !!callback(...args); } finally { activeInputAction = null; }
            const locked = humanPieces > previousPieces;
            const legalStop = !accepted && groundedSoftDrop;
            const failed = !accepted && !legalStop;
            actionsTaken.attempted++;
            actionsTaken[accepted ? 'accepted' : 'rejected']++;
            if (failed) actionsTaken.failed++;
            if (legalStop) actionsTaken.legalStops++;
            if (locked) actionsTaken.locks++;
            if (!actionsTaken.byAction[name]) {
                actionsTaken.byAction[name] = {
                    attempted: 0, accepted: 0, rejected: 0, failed: 0, legalStops: 0, locks: 0,
                };
            }
            const counts = actionsTaken.byAction[name];
            counts.attempted++;
            counts[accepted ? 'accepted' : 'rejected']++;
            if (failed) counts.failed++;
            if (legalStop) counts.legalStops++;
            if (locked) counts.locks++;
            if (trace) {
                let outcome = accepted ? 'accepted' : 'rejected';
                if (legalStop) outcome = 'grounded';
                if (locked) outcome = 'locked';
                commandTrace.push({
                    kind: 'input',
                    atMs: clock.now,
                    round: session.duel?.round || 1,
                    action: name,
                    accepted,
                    shapeKey,
                    outcome,
                    before,
                    after: pose(),
                });
            }
            return accepted;
        };
    }

    try {
        normalizeSessionSeed(seed);
        if (![maxSimSeconds, maxPieces, wallBudgetMs].every((value) => Number.isFinite(value) && value > 0)) {
            throw new TypeError('Attempt budgets must be finite positive numbers');
        }
        if (lapWindowSeconds !== null && (!Number.isFinite(lapWindowSeconds) || lapWindowSeconds <= 0)) {
            throw new TypeError('Lap window must be null or a finite positive number');
        }
        const authoredLevelConfig = getLevelById(levelId);
        if (!authoredLevelConfig) throw new RangeError(`Unknown Odyssey level ${levelId}`);
        const levelConfig = resolveScenario(authoredLevelConfig, scenarioId);
        const deadline = levelConfig.victory.failure.type === 'time'
            ? levelConfig.victory.failure.value : Infinity;
        const defaultShowcaseMode = Number.isFinite(deadline) ? 'authored-deadline' : 'harness-budget';
        showcaseFinishPolicy = {
            mode: lapWindowSeconds !== null ? 'explicit-lap-window' : defaultShowcaseMode,
            targetStars: 3,
            maxLapSeconds: lapWindowSeconds,
            finishAtDeadline: true,
        };
        clock.install();
        console.error = (...args) => {
            if (String(args[0]).includes('Physics processing failed')) {
                runtimeError = args.find((arg) => arg instanceof Error) || new Error(String(args[0]));
            }
            originalConsoleError(...args);
        };
        const hybridEngine = new GameplayHybridEngine();
        hybridEngine.configure(levelConfig);
        const gameState = hybridEngine.createGameState({ rngSeed: seed });
        const authoredInitialInterval = gameState.dropInterval;
        if (levelConfig.benchmarkPhysicsPolicy?.initialFallMs) {
            const target = levelConfig.benchmarkPhysicsPolicy.initialFallMs;
            gameState.speedMultiplier = (gameState.speedMultiplier || 1) * (authoredInitialInterval / target);
            gameState.dropInterval = target;
        }
        initialPhysicsPolicy = {
            authoredInitialIntervalMs: authoredInitialInterval,
            initialIntervalMs: gameState.dropInterval,
            speedMultiplier: gameState.speedMultiplier || 1,
            levelProgression: !gameState.disableLevelProgression,
            scenario: levelConfig.benchmarkPhysicsPolicy || null,
        };
        gameState.suppressExternalInput = true;
        gameState.lastTime = clock.now;
        session = createOdysseyLevelSession({
            gameState,
            hybridEngine,
            levelConfig,
            levelId,
            generation: 1,
            rngDescriptor: gameState.rngDescriptor,
            simulationClock: 'legacy-variable-v1',
        });
        if (levelConfig.mechanics.versus) {
            session.duel = new OdysseyBotMatch(session, {
                seed, isActive, onRoundStart: () => { startRound(); humanBot?.reset(); },
            });
            initialPhysicsPolicy.initialIntervalMs = session.gameState.dropInterval;
            initialPhysicsPolicy.levelProgression = !session.gameState.disableLevelProgression;
            observeDuel();
            // Keep the production opponent's real state and full queued bag. Only
            // createBenchmarkBot restricts planning to the player's three HUD previews.
        }
        const actions = {
            moveLeft: action('moveLeft', () => move(gameState, -1)),
            moveRight: action('moveRight', () => move(gameState, 1)),
            rotateLeft: action('rotateLeft', () => rotate(gameState, 'left')),
            rotateRight: action('rotateRight', () => rotate(gameState, 'right')),
            rotateFlip: action('rotateFlip', () => rotate(gameState, 'flip')),
            softDrop: action('softDrop', () => softDrop(gameState, null, callbacks())),
            hardDrop: action('hardDrop', () => hardDrop(gameState, null, callbacks())),
        };
        humanBot = createBenchmarkBot({
            gameState,
            actions,
            profileId,
            cadenceId,
            decisionSeed: (seed ^ 0x9e3779b9) >>> 0,
            levelConfig,
            getMetrics: () => hybridEngine.getMetrics(),
            getPendingGarbage: () => session.duel?.multiplayer.garbageQueues[0].getTotalLines() || 0,
        });
        fillBag(gameState.nextPieces, gameState.randomGenerator);
        spawnPiece(gameState, null, topOut);
        session.duel?.prepareBot();
        const frameRateController = {
            isRunning: false,
            needsHybridMode: () => true,
            startHybridLoop(logic, render) { loop = { logic, render }; this.isRunning = true; },
            stopHybridLoop() { this.isRunning = false; },
        };
        mode = {
            deps: { frameRateController, settingsManager: { get: () => ({ reducedMotion: false }) } },
            statsUpdateInterval: 100,
            _isLevelSessionActive: isActive,
            _stopFixedTickSession() {},
            _getBoardScene: () => null,
            _getPhysicsCallbacks: callbacks,
            _updateStats() {},
            _updateOdysseyHUD() {},
            _updateMinimap() {},
            _refreshNextQueue() {},
            _handleGameOver: topOut,
            _checkVictoryConditions() {
                if (!isActive()) return;
                hybridEngine.updateTime(clock.now / 1000);
                hybridEngine.updateScore(session.duel?.score ?? gameState.score);
                if (session.duel) {
                    session.duel.syncMetrics();
                    if (session.duel.error) throw session.duel.error;
                    if (session.duel.multiplayer.isGameOver) {
                        if (session.duel.multiplayer.winner === 0) {
                            recordGoal();
                            finish('win', 'seven-frags');
                        } else finish('loss', session.duel.multiplayer.winner === null ? 'draw' : 'bot');
                    }
                    return;
                }
                if (gameState.isProcessingPhysics) return;
                if (gameState.isInfinityMode) {
                    hybridEngine.victoryEvaluator.updateHeight(calculateBuildHeight(gameState));
                }
                if (gameState.goalComplete) {
                    if (hybridEngine.calculateStars() === 3) finishLap('three-stars');
                    else if (clock.now / 1000 >= deadline) finishLap('deadline');
                    else if (lapWindowSeconds !== null && clock.now / 1000 - goalReachedAtSeconds >= lapWindowSeconds) {
                        finishLap('lap-time-limit');
                    }
                    return;
                }
                if (hybridEngine.checkVictory()) {
                    recordGoal();
                    if (levelConfig.victoryLapPolicy === 'none') finish('win', 'primary-goal');
                    else {
                        gameState.goalComplete = true;
                        gameState.victoryLapActive = true;
                    }
                } else if (hybridEngine.checkFailure()) finish('loss', gameState.isGameOver ? 'top-out' : 'deadline');
            },
        };
        startOdysseyGameplayLoop(mode, session);
        while (!terminal) {
            if (runtimeError) throw runtimeError;
            const pieceLimitReached = humanPieces >= maxPieces;
            const piecesSettled = !(session.duel?.players || [gameState])
                .some((state) => state.isProcessingPhysics) && !session.duel?.transition;
            let budgetReason = null;
            if (wallNow() - startedAt >= wallBudgetMs) budgetReason = 'wall-budget';
            else if (clock.now / 1000 >= maxSimSeconds) budgetReason = 'simulation-budget';
            else if (pieceLimitReached && piecesSettled) budgetReason = 'piece-budget';
            if (budgetReason) {
                if (gameState.goalComplete) finishLap(budgetReason);
                else finish('censored', budgetReason);
                break;
            }
            const frameMs = Math.min(FRAME_MS, maxSimSeconds * 1000 - clock.now);
            await clock.advance(frameMs);
            if (!pieceLimitReached) humanBot.update(frameMs, clock.now);
            loop.logic(clock.now, frameMs);
            await clock.flush();
            if (runtimeError) throw runtimeError;
            loop.render();
        }
        result = {
            levelId,
            seed,
            profileId,
            scenarioId,
            cadenceId,
            ...terminal,
            pieces: humanPieces,
            stars: terminal.outcome === 'win' ? hybridEngine.calculateStars() : 0,
            metrics: metrics(),
            bonusResults: hybridEngine.evaluateBonuses(),
            goalReached: goalReachedAtSeconds !== null,
            goalReachedAtSeconds,
            goalMetrics,
            goalStars,
            lapEndReason,
            lapCensored: lapEndReason === 'lap-time-limit' || !!lapEndReason?.endsWith('budget'),
            primaryCensored: terminal.outcome === 'censored',
            qualityCensored: lapEndReason === 'lap-time-limit' || !!lapEndReason?.endsWith('budget'),
            actions: actionsTaken,
            telemetry: telemetry(),
            duel: session.duel ? { ...session.duel.getResult(), telemetry: duelTelemetry() } : null,
            simulationClock: session.simulationClock,
            timingPolicy: 'legacy-virtual-60hz-normal-motion',
            ...planningKnowledge(),
            showcaseFinishPolicy,
            effectiveConfig: {
                baseMode: levelConfig.mechanics.baseMode,
                board: levelConfig.mechanics.board,
                speed: levelConfig.mechanics.speed,
                physicsPolicy: initialPhysicsPolicy,
                modifiers: levelConfig.modifiers.active,
                visiblePreviewCount: 3,
                victory: levelConfig.victory,
                stars: levelConfig.stars,
                victoryLapPolicy: levelConfig.victoryLapPolicy,
            },
            ...(trace ? { trace: commandTrace } : {}),
        };
    } catch (error) {
        result = {
            levelId,
            seed,
            profileId,
            scenarioId,
            cadenceId,
            outcome: 'error',
            reason: error.message || String(error),
            elapsedSeconds: clock.now / 1000,
            pieces: humanPieces,
            stars: 0,
            metrics: metrics(),
            goalReached: goalReachedAtSeconds !== null,
            goalReachedAtSeconds,
            actions: actionsTaken,
            telemetry: telemetry(),
            duel: session?.duel ? { ...session.duel.getResult(), telemetry: duelTelemetry() } : null,
            ...planningKnowledge(),
            showcaseFinishPolicy,
            ...(trace ? { trace: commandTrace } : {}),
        };
    } finally {
        try {
            if (session) {
                retireOdysseyLevelSession(session);
                humanBot?.reset();
                try {
                    await clock.settle(Promise.all([
                        drainOdysseyLevelSession(session), session.duel?.transition,
                    ]));
                } finally {
                    // The pool holds active pieces strongly across jobs in a worker.
                    // Release only this attempt's pieces after capturing its result.
                    for (const state of session.duel?.players || [session.gameState]) {
                        state.reset();
                        state.isStopped = true;
                    }
                }
            }
        } catch (error) { cleanupError = error.message || String(error); }
        console.error = originalConsoleError;
        clock.restore();
    }
    if (cleanupError) {
        result.outcome = 'error';
        result.reason = 'physics-drain-error';
        result.cleanupError = cleanupError;
    }
    result.wallMs = wallNow() - startedAt;
    return JSON.parse(JSON.stringify(result));
}
