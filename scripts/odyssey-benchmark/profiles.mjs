/** Benchmark policies only: these do not change the game's opponent tiers. */
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { analyzeCascadePreparation, evaluateCandidate, measureBoard } from '../../src/core/ai/board-evaluator.js';
import { computeLandingHeight, computeProjectedAttack } from '../../src/core/ai/cascade-simulator.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import { findConnectedComponents } from '../../src/core/cascade-helpers.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { COLS, HIDDEN_ROWS, SHAPES } from '../../src/core/constants.js';
import { canPlacePiece } from '../../src/core/game.js';
import { RandomStream } from '../../src/core/rng.js';
import { resolveInfinitySpawnRow, usesDeterministicInfinitySpawn } from '../../src/core/infinity-spawn-policy.js';
import { CHAIN_PROFILE, chainUtility } from './chain-policy.mjs';

export const BENCHMARK_PROFILES = Object.freeze([
    Object.freeze({
        id: 'stacker',
        label: 'Conservative stacker',
        difficulty: 4,
        lookaheadDepth: 0,
        description: 'Prioritizes a low, clean stack and immediate clears; no multi-piece search.',
        reactionMs: [180, 300],
        actionIntervalMs: 150,
        mistakeChance: 0.04,
    }),
    Object.freeze({
        id: 'cascade',
        label: 'Cascade builder',
        difficulty: 7,
        lookaheadDepth: 1,
        description: 'Values legal chain outcomes and supported machine preparation with one-piece lookahead.',
        reactionMs: [90, 150],
        actionIntervalMs: 90,
        mistakeChance: 0.01,
    }),
    Object.freeze({
        id: 'expert',
        label: 'Objective specialist',
        difficulty: 9,
        lookaheadDepth: 2,
        description: 'Uses the orb goal and quality conditions with two-piece lookahead; not a human skill rating.',
        reactionMs: [35, 65],
        actionIntervalMs: 65,
        mistakeChance: 0,
    }),
    Object.freeze({
        id: 'quad',
        label: 'Quad builder',
        difficulty: 8,
        lookaheadDepth: 2,
        description: 'Keeps an open edge well for Quads, avoids singles when safe, and considers orb quality goals.',
        reactionMs: [120, 180],
        actionIntervalMs: 100,
        mistakeChance: 0,
    }),
    Object.freeze({
        id: 'duelist',
        label: 'Attack builder',
        difficulty: 7,
        lookaheadDepth: 1,
        description: 'Uses cascade policy timing and search, rewarding outgoing garbage in duels; unchanged in solo orbs.',
        reactionMs: [90, 150],
        actionIntervalMs: 90,
        mistakeChance: 0.01,
        experimental: true,
    }),
    CHAIN_PROFILE,
]);

/** Execution pace is independent of strategy, search depth and decision randomness. */
export const BENCHMARK_CADENCES = Object.freeze([
    Object.freeze({
        id: 'native',
        label: 'Native profile pace',
        description: 'Retains each profile\'s original reaction and action intervals.',
    }),
    Object.freeze({
        id: 'steady',
        label: 'Steady pace',
        description: 'Uses the same moderate input timing for every strategy.',
        reactionMs: Object.freeze([120, 180]),
        actionIntervalMs: 100,
    }),
    Object.freeze({
        id: 'deliberate',
        label: 'Deliberate pace',
        description: 'Uses the same slower input timing for every strategy.',
        reactionMs: Object.freeze([250, 350]),
        actionIntervalMs: 180,
    }),
]);

/** A planning view only. Neither bag contents nor production state are mutated. */
export function restrictBotPreview(bot, previewCount = 3) {
    const count = Number.isFinite(previewCount) ? Math.max(0, Math.min(3, Math.floor(previewCount))) : 3;
    const originalPlan = bot.plan;
    bot.plan = function restrictedPlan(...args) {
        const actualState = this.playerState;
        this.playerState = new Proxy(actualState, {
            get(target, key, receiver) {
                if (key === 'nextPieces') return (target.nextPieces || []).slice(0, count);
                return Reflect.get(target, key, receiver);
            },
        });
        try {
            return originalPlan.apply(this, args);
        } finally {
            this.playerState = actualState;
        }
    };
    return bot;
}

/** Canonical labels retain connectivity while ignoring incidental piece-id names. */
export function connectivityBoardKey(boardGrid) {
    const labels = new Map();
    return boardGrid.map((row, y) => row.map((cell, x) => {
        if (!cell) return '.';
        const id = cell.id ?? `cell:${x}:${y}`;
        if (!labels.has(id)) labels.set(id, labels.size);
        return labels.get(id);
    }).join(',')).join('|');
}

function contextFor(state) {
    return {
        boardHeight: state.boardGrid.length,
        isInfinityMode: Boolean(state.isInfinityMode),
        level: state.level || 1,
        lines: state.lines || 0,
        linesUntilNextLevel: state.linesUntilNextLevel ?? 15,
        dropInterval: state.dropInterval || 1000,
        disableLevelProgression: Boolean(state.disableLevelProgression),
        speedMultiplier: state.speedMultiplier,
        b2bActive: Boolean(state.b2bActive),
        comboMultiplierEnabled: Boolean(state.comboMultiplierEnabled),
        comboMultiplier: state.comboMultiplier || 1,
        comboCount: state.comboCount || 0,
    };
}

function shapeKey(piece) {
    return typeof piece === 'string' ? piece : piece?.shapeKey || piece?.type;
}

function outcomeMetrics(candidate, metrics) {
    const { waves } = candidate;
    const depth = waves.length;
    return {
        ...metrics,
        lines: (metrics.lines || 0) + candidate.totalLines,
        score: (metrics.score || 0) + candidate.projectedScore,
        cascades: (metrics.cascades || 0) + (depth >= 2 ? 1 : 0),
        maxCombo: Math.max(metrics.maxCombo || 0, depth >= 2 ? depth : 0),
        maxCascadeDepth: Math.max(metrics.maxCascadeDepth || 0, depth >= 2 ? depth : 0),
        tetrises: (metrics.tetrises || 0) + waves.filter((wave) => wave.lineCount === 4).length,
        singles: (metrics.singles || 0) + waves.filter((wave) => wave.lineCount === 1).length,
        piecesPlaced: (metrics.piecesPlaced || 0) + 1,
        height: Math.max(metrics.height || 0, candidate.boardMetrics.maxHeight),
    };
}

function progressReward(type, target, before, after) {
    const aliases = {
        cascade: 'cascades',
        combo: 'maxCombo',
        'max-cascade-depth': 'maxCascadeDepth',
        'tetris-count': 'tetrises',
    };
    const key = aliases[type] || type;
    if (!(target > 0) || type === 'time' || type === 'frags') return 0;
    const start = Math.min(target, before[key] || 0);
    const end = Math.min(target, after[key] || 0);
    return Math.max(0, end - start) / Math.max(1, target - start);
}

export class BenchmarkBot extends PuzzleBotController {
    constructor({
        gameState, actions, profileId, decisionSeed, levelConfig, getMetrics,
        cadenceId = 'native', getPendingGarbage,
    }) {
        const profile = BENCHMARK_PROFILES.find((entry) => entry.id === profileId);
        if (!profile) throw new RangeError(`Unknown benchmark profile: ${profileId}`);
        const cadence = BENCHMARK_CADENCES.find((entry) => entry.id === cadenceId);
        if (!cadence) throw new RangeError(`Unknown benchmark cadence: ${cadenceId}`);
        const decisions = new RandomStream(decisionSeed ?? 'odyssey-benchmark', 'bot-decisions');
        super({
            playerIndex: 0,
            playerState: gameState,
            actions,
            difficulty: profile.difficulty,
            rng: () => decisions.next(),
        });
        this.profile = profile;
        this.cadence = cadence;
        this.levelConfig = levelConfig || {};
        this.getMetrics = getMetrics;
        this.readPendingGarbage = getPendingGarbage;
        this.decisionStream = decisions;
        this.replanCount = 0;
        this.fallbackDrops = 0;
        this.pieceRetryCount = 0;
        this.maxPieceRetries = 0;
        this.retrySpawnToken = null;
        this.fallbackPending = false;
        this.lastActionResult = null;
        this.actionRejected = false;
        this.quadWellColumn = null;
        this.config = {
            ...this.config,
            reactionMs: (cadence.reactionMs || profile.reactionMs).slice(),
            actionIntervalMs: cadence.actionIntervalMs || profile.actionIntervalMs,
            mistakeChance: profile.mistakeChance,
            heuristicNoise: 0,
            lookaheadDepth: profile.lookaheadDepth,
            lookaheadBreadth: 6, // Four root candidates, at most two at future plies.
            latentChainEval: false, // No arbitrary-cell or unreachable hypothetical triggers.
            cascadePlanning: ['cascade', 'expert', 'duelist', 'chain'].includes(profile.id),
            buildVsFire: ['cascade', 'expert', 'duelist', 'chain'].includes(profile.id),
        };
        this.scheduler.config = this.config;
        // Only explicit rejection invalidates a path. Legacy adapters may return undefined
        // after an accepted action, so absence of a return value is not a rejection.
        this.scheduler.actions = Object.fromEntries(Object.entries(actions || {}).map(([key, action]) => [
            key,
            typeof action === 'function' ? (...args) => {
                const state = this.playerState;
                const piece = state.currentPiece;
                const groundedSoftDrop = key === 'softDrop' && piece && !state.isPaused
                    && !state.isGameOver && !state.isProcessingPhysics
                    && !canPlacePiece(state, piece, piece.x, piece.y + 1);
                const accepted = action(...args);
                this.lastActionResult = { key, accepted };
                if (accepted === false && !groundedSoftDrop) this.actionRejected = true;
                return accepted;
            } : action,
        ]));
        this.contextByBoard = new WeakMap();
        this.simulationSerial = 0;
    }

    reset() {
        super.reset();
        this.actionRejected = false;
        this.pieceRetryCount = 0;
        this.retrySpawnToken = null;
        this.fallbackPending = false;
        this.lastActionResult = null;
        this.quadWellColumn = null;
    }

    update(deltaMs, nowMs) {
        const state = this.playerState;
        if (!state || !state.isAlive || state.isGameOver || state.isStopped || state.isPaused
            || state.isProcessingPhysics || state.hitStopRemaining > 0) return;
        if (!state.currentPiece) { this.reset(); return; }
        const spawnToken = Number.isFinite(state.piecesPlaced) ? `count:${state.piecesPlaced}` : state.currentPiece;
        if (spawnToken !== this.retrySpawnToken) {
            this.retrySpawnToken = spawnToken;
            this.pieceRetryCount = 0;
            this.fallbackPending = false;
        }
        if (this.fallbackPending) {
            if (nowMs < this.readyAtMs) return;
            this.fallbackPending = false;
            this.lastActionResult = null;
            this.actionRejected = false;
            // Static reachability cannot guarantee a path still fits after timed gravity.
            // After three failed paths, commit the actual pose instead of cycling kicks.
            this.lastPlan = { actions: [{ type: 'hardDrop' }], fallback: true };
            this.scheduler.setActions(this.lastPlan.actions);
            this.scheduler.update(deltaMs);
            if (this.lastActionResult?.key === 'hardDrop' && this.lastActionResult.accepted !== false) {
                this.fallbackDrops++;
            }
            // A rejected fallback waits for natural lock/termination or a new spawn;
            // never retry the same piece indefinitely or issue another same-frame input.
            this.actionRejected = false;
            return;
        }
        super.update(deltaMs, nowMs);
        if (!this.actionRejected) return;
        this.actionRejected = false;
        this.replanCount++;
        this.pieceRetryCount++;
        this.maxPieceRetries = Math.max(this.maxPieceRetries, this.pieceRetryCount);
        this.scheduler.clear();
        this.lastPlan = null;
        this.machinePlan = null;
        // Gravity or an arriving attack can invalidate a reachable path. Search again
        // from the actual pose on a later input slot, never execute the stale tail.
        this.readyAtMs = nowMs + this.config.actionIntervalMs;
        this.fallbackPending = this.pieceRetryCount >= 3;
    }

    getPendingGarbage() {
        if (!this.readPendingGarbage) return super.getPendingGarbage();
        const lines = this.readPendingGarbage();
        return Number.isFinite(lines) ? Math.max(0, lines) : 0;
    }

    currentMetrics() {
        return {
            lines: this.playerState.lines || 0,
            score: this.playerState.score || 0,
            piecesPlaced: this.playerState.piecesPlaced || 0,
            ...(this.getMetrics?.() || {}),
        };
    }

    plan() {
        this.contextByBoard = new WeakMap();
        const state = this.playerState;
        const board = state.boardGrid || state.board;
        if (this.profile.id === 'quad' && this.quadWellColumn === null) {
            const metrics = measureBoard(board, { hiddenRows: state.isInfinityMode ? 0 : HIDDEN_ROWS });
            this.quadWellColumn = metrics.heights[0] < metrics.heights[COLS - 1] ? 0 : COLS - 1;
        }
        this.contextByBoard.set(board, {
            context: contextFor(state),
            lockedPieces: state.lockedPieces || findConnectedComponents(board),
            metrics: this.currentMetrics(),
        });
        const placements = findReachablePlacements(state);
        const preparation = analyzeCascadePreparation(board, state.nextPieces.map(shapeKey), {
            hiddenRows: state.isInfinityMode ? 0 : HIDDEN_ROWS,
        });
        const ranked = this.rank(this.evaluatePlacements(state, placements, preparation));
        const tactics = this.assessTactics(board, preparation);
        const expanded = this.applyTacticalBias(this.applyLookahead(ranked), tactics);
        const selected = this.chooseSelection(expanded, ranked, tactics);
        if (!selected) return null;
        this.updateMachinePlan(selected, tactics);
        return {
            actions: [...selected.actions, { type: 'hardDrop' }],
            candidate: selected,
            score: selected.evaluation.score,
            tactics,
        };
    }

    evaluatePlacements(state, placements, sharedPreparationBefore = null) {
        const board = state.boardGrid || state.board;
        const before = this.contextByBoard.get(board) || {
            context: contextFor({ ...this.playerState, boardGrid: board }),
            lockedPieces: findConnectedComponents(board),
            metrics: this.currentMetrics(),
        };
        const hiddenRows = state.isInfinityMode ? 0 : HIDDEN_ROWS;
        const nextShapeKeys = (state.nextPieces || []).slice(0, 3).map(shapeKey).filter(Boolean);
        const preparationBefore = sharedPreparationBefore
            || analyzeCascadePreparation(board, nextShapeKeys, { hiddenRows });
        return placements.map((placement) => {
            // Unique even if two future tetrominoes occupy the same pose.
            const pieceId = `benchmark:${++this.simulationSerial}`;
            const lockFootprint = [];
            placement.shape.forEach((row, y) => row.forEach((cell, x) => {
                if (cell > 0) lockFootprint.push({ x: placement.x + x, y: placement.y + y });
            }));
            const result = resolveCascade([...before.lockedPieces, {
                ...placement, pieceId, color: placement.shapeKey,
            }], {
                ...before.context,
                comboState: { lockFootprint, manualColumns: [...new Set(lockFootprint.map((cell) => cell.x))] },
            });
            const waves = result.waves.map((wave) => ({
                lineCount: wave.fullLines.length, waveIndex: wave.cascadeCount, score: wave.points,
            }));
            const perfectClear = result.lockedPiecesAfter.length === 0;
            const candidate = {
                ...placement,
                boardGrid: result.boardAfter,
                hiddenRows,
                nextShapeKeys,
                waves,
                cascadeCount: waves.length,
                totalLines: result.linesClearedThisTurn,
                projectedScore: result.scoreDelta,
                projectedAttack: computeProjectedAttack(result.linesClearedThisTurn, perfectClear),
                perfectClear,
                maxWaveLines: Math.max(0, ...waves.map((wave) => wave.lineCount)),
                cascadeWeightedLines: waves.reduce((sum, wave) => sum + wave.lineCount * wave.waveIndex, 0),
                cascadeLineScore: 0, // The AI's quadratic pseudo-score is not a live scoring event.
                landingHeight: computeLandingHeight(placement, board.length),
                preparationBefore,
                preparationAfter: analyzeCascadePreparation(result.boardAfter, nextShapeKeys, { hiddenRows }),
                boardMetrics: measureBoard(result.boardAfter, { hiddenRows }),
                metricsBefore: before.metrics,
            };
            candidate.metricsAfter = outcomeMetrics(candidate, before.metrics);
            this.contextByBoard.set(result.boardAfter, {
                lockedPieces: result.lockedPiecesAfter,
                metrics: candidate.metricsAfter,
                context: {
                    ...before.context,
                    level: result.levelAfter,
                    lines: result.linesAfter,
                    linesUntilNextLevel: result.linesUntilNextLevelAfter,
                    dropInterval: result.dropIntervalAfter,
                    b2bActive: result.b2bActiveAfter,
                    comboMultiplier: result.comboMultiplierAfter,
                    comboCount: result.comboCountAfter,
                },
            });
            return candidate;
        });
    }

    rank(candidates, config = this.config) {
        return candidates.map((candidate) => {
            const evaluation = evaluateCandidate(candidate, { ...config, latentChainEval: false }, this.rng);
            const { boardMetrics: metrics } = candidate;
            let score;
            let chainTieBreak;
            if (this.profile.id === 'stacker') {
                score = candidate.totalLines * 48 + (candidate.perfectClear ? 90 : 0)
                    - metrics.holes * 22 - metrics.weightedHoles * 0.4 - metrics.aggregateHeight * 0.7
                    - metrics.maxHeight * 3 - metrics.bumpiness * 1.8 - metrics.topOutRisk * 200
                    - metrics.pressureRatio * 140 - candidate.pathCost * 0.3;
            } else if (this.profile.id === 'quad') {
                score = this.quadUtility(candidate) + this.objectiveUtility(candidate);
            } else if (this.profile.id === 'chain') {
                score = chainUtility(candidate);
                // Preserve the frozen prototype's stable expert ordering only when
                // two chain utilities tie; it is not added to the chain reward.
                chainTieBreak = evaluation.score
                    + 0.018 * (candidate.projectedScore - evaluation.metrics.projectedScore)
                    + (candidate.cascadeCount >= 2 ? 200 + candidate.cascadeCount ** 2 * 45 : 0)
                    + this.objectiveUtility(candidate);
            } else {
                // Replace the evaluator's level-1 aggregate score term with the actual per-wave delta.
                score = evaluation.score + 0.018 * (candidate.projectedScore - evaluation.metrics.projectedScore);
                if (this.profile.id === 'duelist' && this.levelConfig.mechanics?.versus
                    && this.levelConfig.victory?.primary?.type === 'frags') {
                    // Same cascade search/survival policy; replace its raw-wave premium
                    // with the existing specialist's reward for actual outgoing rows.
                    score += candidate.projectedAttack * 45;
                } else score += candidate.cascadeCount >= 2 ? 200 + candidate.cascadeCount ** 2 * 45 : 0;
                if (this.profile.id === 'expert') score += this.objectiveUtility(candidate);
            }
            return {
                ...candidate,
                evaluation: {
                    ...evaluation,
                    score,
                    ...(this.profile.id === 'chain' ? { chainTieBreak } : {}),
                    objectiveUtility: ['expert', 'quad'].includes(this.profile.id)
                        ? this.objectiveUtility(candidate) : 0,
                    projectedScore: candidate.projectedScore,
                },
            };
        }).sort((a, b) => {
            const difference = b.evaluation.score - a.evaluation.score;
            if (this.profile.id !== 'chain' || difference !== 0) return difference;
            return b.evaluation.chainTieBreak - a.evaluation.chainTieBreak;
        });
    }

    quadUtility(candidate) {
        const metrics = candidate.boardMetrics;
        const well = this.quadWellColumn ?? COLS - 1;
        const pending = this.getPendingGarbage();
        const danger = metrics.safeStackMargin - pending < 6;
        const quads = candidate.waves.filter((wave) => wave.lineCount === 4).length;
        const singles = candidate.waves.filter((wave) => wave.lineCount === 1).length;
        const protectNoSingles = (candidate.metricsBefore.singles || 0) === 0
            && (this.levelConfig.victory?.bonuses || []).some((bonus) => bonus.type === 'no-singles');
        const singlePenalty = protectNoSingles ? 2400 : 550;
        let wellCells = 0;
        let readyRows = 0;
        for (const cells of candidate.boardGrid) {
            if (cells[well]) wellCells++;
            else if (cells.every((cell, x) => x === well || Boolean(cell))) readyRows++;
        }
        const surface = metrics.heights.filter((_, x) => x !== well);
        const bumpiness = surface.slice(1).reduce((sum, height, x) => sum + Math.abs(height - surface[x]), 0);
        return quads * 1800 + candidate.totalLines * (danger ? 140 : 35)
            - singles * (danger ? 0 : singlePenalty) + (candidate.perfectClear ? 160 : 0)
            + Math.min(4, readyRows) * 70 - wellCells * (danger ? 12 : 70)
            - metrics.holes * 65 - metrics.weightedHoles * 0.7 - metrics.aggregateHeight * 0.8
            - metrics.maxHeight * 5 - bumpiness * 3 - metrics.topOutRisk * 500
            - metrics.pressureRatio * 240 - candidate.pathCost * 0.4;
    }

    objectiveUtility(candidate) {
        const { primary, bonuses = [], failure } = this.levelConfig.victory || {};
        const before = candidate.metricsBefore;
        const after = candidate.metricsAfter;
        let value = primary ? progressReward(primary.type, primary.target, before, after) * 1800 : 0;
        if (primary?.type === 'frags') value += candidate.projectedAttack * 45;
        for (const bonus of bonuses) {
            if (bonus.type === 'no-singles' && before.singles === 0) {
                value -= (after.singles - before.singles) * 220;
            } else if (bonus.type === 'pieces') {
                value -= (candidate.totalLines === 0 ? 10 : 0);
            } else value += progressReward(bonus.type, bonus.target, before, after) * 240;
        }
        for (const [type, target] of Object.entries(this.levelConfig.stars?.three || {})) {
            value += progressReward(type, target, before, after) * 120;
        }
        // A duration cost estimates input effort, not simulated gameplay time or physics delay.
        const hurry = failure?.type === 'time' && failure.value - (before.time || 0) < 15 ? 3 : 1;
        value -= candidate.pathCost * this.config.actionIntervalMs * 0.015 * hurry;
        return value;
    }

    chooseSelection(ranked) {
        if (!ranked.length) return null;
        // The production GO override ignores orb objectives; use the profile's complete ranking instead.
        if (this.rng() < this.config.mistakeChance) {
            return ranked[Math.floor(this.rng() * Math.min(3, ranked.length))];
        }
        return ranked[0];
    }

    evaluateFuture(board, shapeKeys, depth, config, cache) {
        if (depth <= 0 || !shapeKeys.length) return { candidate: null, depth: 0, score: 0 };
        const before = this.contextByBoard.get(board);
        const key = `${shapeKeys.join(',')}:${depth}:${connectivityBoardKey(board)}:${JSON.stringify({
            context: before?.context, metrics: before?.metrics,
        })}`;
        if (cache.has(key)) return cache.get(key);
        const shape = SHAPES[shapeKeys[0]];
        const state = {
            ...this.playerState,
            boardGrid: board,
            board,
            nextPieces: shapeKeys.slice(1),
            piecesPlaced: Math.max(1, this.playerState.piecesPlaced || 0),
        };
        let y = HIDDEN_ROWS - 2;
        if (state.isInfinityMode) {
            y = usesDeterministicInfinitySpawn(state) ? resolveInfinitySpawnRow(state)
                : Math.max(0, Math.floor(state.cameraRow || 0) - 2);
        }
        state.currentPiece = {
            shape: shape.map((row) => row.slice()),
            shapeKey: shapeKeys[0],
            type: shapeKeys[0],
            rotation: 0,
            x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
            y,
        };
        const ranked = this.rank(this.evaluatePlacements(state, findReachablePlacements(state)), config);
        let best = { candidate: null, depth: 0, score: -100000 };
        for (const candidate of ranked.slice(0, 2)) {
            const child = this.evaluateFuture(candidate.boardGrid, shapeKeys.slice(1), depth - 1, config, cache);
            const score = candidate.evaluation.score + child.score * (config.lookaheadWeight || 0.65);
            if (score > best.score) {
                best = {
                    candidate, child, depth: 1 + child.depth, score,
                };
            }
        }
        cache.set(key, best);
        return best;
    }
}

export function createBenchmarkBot(options) {
    return restrictBotPreview(new BenchmarkBot(options));
}
