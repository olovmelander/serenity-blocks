/** Bounded, observation-only mastery search. This is an offline experiment, not a gameplay AI. */
/* eslint-disable no-await-in-loop -- Commands and complete lock resolutions are strictly sequential. */
import { createHash } from 'node:crypto';
import {
    fillBag, spawnPiece, move, rotate, softDrop, hardDrop, canPlacePiece,
} from '../../src/core/game.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import { analyzeCascadePreparation, measureBoard } from '../../src/core/ai/board-evaluator.js';
import {
    COLS, HIDDEN_ROWS, SHAPES, PIECE_KEYS,
} from '../../src/core/constants.js';
import { resolveInfinitySpawnRow } from '../../src/core/infinity-spawn-policy.js';
import { calculateBuildHeight, checkInfinityGameOver } from '../../src/core/infinity-grid.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { normalizeSessionSeed } from '../../src/core/session-rng.js';
import { connectivityBoardKey } from './profiles.mjs';
import { getMasteryRequirements } from './authored-construction.mjs';

export const MASTERY_SEARCH_DEFAULTS = Object.freeze({
    maxPieces: 192,
    beamWidth: 8,
    maxNodes: 240000,
    maxNodesPerPlan: 2400,
    wallBudgetMs: 120000,
    unknownTailDepth: 1,
});
export const MASTERY_SEARCH_VERSION = 'observation-beam-v2';
const KNOWLEDGE_POLICY = 'current-plus-three-preview-receding-horizon';
const clone = (value) => structuredClone(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const hashBoard = (board) => hash(connectivityBoardKey(board));
const pose = (piece) => (piece ? {
    x: piece.x, y: piece.y, rotation: piece.rotation ?? 0, shapeKey: piece.shapeKey,
} : null);
const metricKeys = Object.keys(new VictoryConditionEvaluator().getMetrics());
const contextKeys = ['level', 'lines', 'linesUntilNextLevel', 'dropInterval', 'disableLevelProgression',
    'speedMultiplier', 'b2bActive', 'comboMultiplierEnabled', 'comboMultiplier', 'comboCount'];

function integerOption(name, value, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
    }
}

function configFor(options) {
    const config = { ...MASTERY_SEARCH_DEFAULTS, ...options };
    integerOption('maxPieces', config.maxPieces, 1, 1024);
    integerOption('beamWidth', config.beamWidth, 1, 64);
    integerOption('maxNodes', config.maxNodes, 1, 10000000);
    integerOption('maxNodesPerPlan', config.maxNodesPerPlan, 1, 100000);
    integerOption('unknownTailDepth', config.unknownTailDepth, 0, 1);
    if (!Number.isFinite(config.wallBudgetMs) || config.wallBudgetMs <= 0) {
        throw new RangeError('wallBudgetMs must be positive and finite');
    }
    return config;
}

function visiblePiece(piece) {
    return {
        ...pose(piece),
        shape: piece.shape.map((row) => row.slice()),
        pieceId: piece.pieceId,
        color: piece.color,
        isGarbage: Boolean(piece.isGarbage),
    };
}

/** Explicit allowlist: never copy a GameState, RNG, session seed, or hidden queue into the planner. */
export function createMasteryObservation(state, metrics, level) {
    return {
        boardGrid: state.boardGrid.map((row) => row.map((cell) => (cell ? {
            id: cell.id, color: cell.color, isGarbage: Boolean(cell.isGarbage),
        } : null))),
        lockedPieces: state.lockedPieces.map(visiblePiece),
        currentPiece: visiblePiece(state.currentPiece),
        preview: state.nextPieces.slice(0, 3),
        metrics: Object.fromEntries(metricKeys.map((key) => [key, metrics[key] || 0])),
        context: {
            ...Object.fromEntries(contextKeys.map((key) => [key, state[key]])),
            boardHeight: state.boardGrid.length,
            isInfinityMode: Boolean(state.isInfinityMode),
        },
        spawn: {
            isInfinityMode: Boolean(state.isInfinityMode),
            infinityVisibleRows: state.infinityVisibleRows,
            infinitySpawnPolicy: state.infinitySpawnPolicy,
            infinitySpawnOffsetRows: state.infinitySpawnOffsetRows,
            piecesPlaced: state.piecesPlaced,
        },
        rules: {
            levelId: level.id,
            victory: clone(level.victory),
            stars: clone(level.stars),
            victoryLapPolicy: level.victoryLapPolicy || 'none',
        },
    };
}

const metricAlias = (key) => ({
    combo: 'maxCombo',
    cascade: 'cascades',
    'max-cascade-depth': 'maxCascadeDepth',
    'tetris-count': 'tetrises',
    pieces: 'piecesPlaced',
    maxDeaths: 'deaths',
}[key] || key);

function residual(key, target, metrics, bonusCount = 0) {
    const metric = metricAlias(key);
    const actual = key === 'bonuses' ? bonusCount : metrics[metric] || 0;
    const upperBound = ['time', 'maxDeaths', 'pieces'].includes(key);
    return {
        key,
        metric,
        target,
        actual,
        upperBound,
        remaining: Math.max(0, upperBound ? actual - target : target - actual),
        met: upperBound ? actual <= target : actual >= target,
        timeUnvalidated: key === 'time',
    };
}

/** Exact production evaluator, with timing explicitly unqualified and optional bonuses kept separate. */
export function evaluateMasteryMetrics(rules, metrics, { isGameOver = false } = {}) {
    const evaluator = new VictoryConditionEvaluator();
    Object.assign(evaluator.trackedMetrics, metrics);
    const gameState = { ...metrics, isGameOver };
    const bonusResults = evaluator.evaluateBonuses(rules.victory.bonuses, gameState);
    const bonuses = (rules.victory.bonuses || []).map((bonus, index) => ({
        index,
        type: bonus.type,
        target: bonus.target,
        untimedConditionMet: bonus.type === 'time' ? null : bonusResults[index],
        timeUnvalidated: bonus.type === 'time',
    }));
    const qualifiedBonuses = bonuses.map((bonus) => bonus.untimedConditionMet === true);
    const conditions = { ...(rules.stars.three || {}) };
    delete conditions.time;
    const tierResult = evaluator.calculateStars({ one: conditions }, gameState, qualifiedBonuses);
    const tierThreeUntimedConditionsMet = tierResult === 1;
    const primaryReachedUntimed = rules.victory.primary.type !== 'time'
        && evaluator.evaluate(gameState, rules.victory);
    const bonusCount = qualifiedBonuses.filter(Boolean).length;
    return {
        primaryReachedUntimed,
        tierThreeUntimedConditionsMet,
        masteryUntimedConditionsMet: primaryReachedUntimed && tierThreeUntimedConditionsMet,
        allBonusesUntimedConditionsMet: bonuses.every((bonus) => bonus.timeUnvalidated || bonus.untimedConditionMet),
        bonuses,
        residualRequirements: {
            primary: residual(rules.victory.primary.type, rules.victory.primary.target, metrics),
            tierThree: Object.entries(rules.stars.three || {})
                .map(([key, target]) => residual(key, target, metrics, bonusCount)),
            optionalBonuses: bonuses,
        },
        scoreFinishHeadroom: rules.victory.primary.type === 'score'
            ? rules.victory.primary.target - (metrics.score || 0) : null,
        ordinaryFinishStopsSearch: rules.victoryLapPolicy !== 'showcase',
        timeUnvalidated: true,
        timedStars: null,
    };
}

function searchUtility(node, rules, previews) {
    const quality = evaluateMasteryMetrics(rules, node.metrics, { isGameOver: node.topOut });
    if (quality.masteryUntimedConditionsMet && !node.topOut) return 10000000;
    if (node.topOut) return -10000000;
    if (quality.primaryReachedUntimed && quality.ordinaryFinishStopsSearch) return -5000000;
    const board = measureBoard(node.boardGrid, { hiddenRows: node.context.isInfinityMode ? 0 : HIDDEN_ROWS });
    const preparation = analyzeCascadePreparation(node.boardGrid, previews, {
        hiddenRows: node.context.isInfinityMode ? 0 : HIDDEN_ROWS,
    });
    let score = preparation.preparationScore * 12 - board.holes * 9 - board.maxHeight * 3
        - board.bumpiness * 2 - board.topOutRisk * 500 - board.ceilingPressure * 2 - node.pathCost * 0.3;
    for (const requirement of quality.residualRequirements.tierThree) {
        if (requirement.timeUnvalidated || requirement.upperBound || !requirement.target) continue;
        const ratio = Math.min(1, requirement.actual / requirement.target);
        if (['maxCombo', 'maxCascadeDepth'].includes(requirement.metric)) score += 140000 * ratio ** 3;
        else if (requirement.metric === 'tetrises') score += 30000 * ratio;
        else if (requirement.metric === 'cascades') score += 20000 * ratio;
        else score += 10000 * ratio;
    }
    // Ordinary score goals end the attempt. Spending score headroom without the quality
    // conditions narrows the final-lock route and must not be mistaken for useful progress.
    if (quality.ordinaryFinishStopsSearch && quality.scoreFinishHeadroom !== null
        && !quality.tierThreeUntimedConditionsMet) score -= (node.metrics.score || 0) * 0.1;
    return score;
}

function futurePiece(node, key) {
    const shape = SHAPES[key].map((row) => row.slice());
    const y = node.spawn.isInfinityMode
        ? resolveInfinitySpawnRow({ ...node.spawn, boardGrid: node.boardGrid }) : HIDDEN_ROWS - 2;
    return {
        shapeKey: key, shape, rotation: 0, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y,
    };
}

/** Path-dependent T-spins require rotation at the landing row; hard-drop distance resets the flag. */
function placementTSpin(node, activePiece, placement) {
    if (placement.shapeKey !== 'T' || placement.actions.at(-1)?.type !== 'rotate') return false;
    const state = {
        boardGrid: node.boardGrid,
        lockedPieces: node.lockedPieces,
        currentPiece: clone(activePiece),
        lockResetCount: 0,
        lastMoveWasRotation: false,
    };
    for (const action of placement.actions) {
        if (action.type === 'move') move(state, action.dir);
        else if (action.type === 'rotate') rotate(state, action.dir);
        else if (action.type === 'softDrop') {
            state.currentPiece.y++;
            state.lastMoveWasRotation = false;
        }
    }
    if (!state.lastMoveWasRotation || state.currentPiece.y !== placement.y) return false;
    const corners = [[0, 0], [2, 0], [0, 2], [2, 2]];
    return corners.filter(([dx, dy]) => {
        const x = placement.x + dx;
        const y = placement.y + dy;
        return x < 0 || x >= COLS || y < 0 || y >= node.boardGrid.length || node.boardGrid[y][x] !== null;
    }).length >= 3;
}

function transition(node, activePiece, placement, serial, rules) {
    const lockFootprint = [];
    placement.shape.forEach((row, y) => row.forEach((cell, x) => {
        if (cell) lockFootprint.push({ x: placement.x + x, y: placement.y + y });
    }));
    const result = resolveCascade([...node.lockedPieces, {
        ...placement, pieceId: `mastery:${serial}`, color: placement.shapeKey,
    }], {
        ...node.context,
        comboState: {
            lockFootprint,
            manualColumns: [...new Set(lockFootprint.map((cell) => cell.x))],
            tSpin: placementTSpin(node, activePiece, placement),
        },
    });
    const evaluator = new VictoryConditionEvaluator();
    Object.assign(evaluator.trackedMetrics, node.metrics);
    evaluator.onPiecePlaced();
    for (const wave of result.waves) {
        evaluator.onLineClear(wave.fullLines.length);
        if (wave.cascadeCount >= 2) {
            evaluator.onCombo(wave.cascadeCount);
            evaluator.onCascade(wave.cascadeCount, wave.cascadeCount === 2);
        }
    }
    // isSeeking + a stationary simulation clock awards the actual maximum lock bonus.
    evaluator.updateScore(node.metrics.score + result.scoreDelta + 50);
    if (node.context.isInfinityMode) {
        evaluator.updateHeight(calculateBuildHeight({
            isInfinityMode: true, boardGrid: result.boardAfter, lockedPieces: result.lockedPiecesAfter,
        }));
    }
    const next = {
        boardGrid: result.boardAfter,
        lockedPieces: result.lockedPiecesAfter,
        metrics: evaluator.getMetrics(),
        context: {
            ...node.context,
            level: result.levelAfter,
            lines: result.linesAfter,
            linesUntilNextLevel: result.linesUntilNextLevelAfter,
            dropInterval: result.dropIntervalAfter,
            b2bActive: result.b2bActiveAfter,
            comboCount: result.comboCountAfter,
            comboMultiplier: result.comboMultiplierAfter,
        },
        spawn: { ...node.spawn, piecesPlaced: node.spawn.piecesPlaced + 1 },
        root: node.root || {
            placement, metricsAfter: evaluator.getMetrics(), boardHashAfter: hashBoard(result.boardAfter),
        },
        pathCost: node.pathCost + placement.pathCost,
        topOut: Boolean(node.context.isInfinityMode && checkInfinityGameOver({
            isInfinityMode: true, boardGrid: result.boardAfter, lockedPieces: result.lockedPiecesAfter,
        })),
    };
    const quality = evaluateMasteryMetrics(rules, next.metrics);
    // Ordinary primary completion wins its roof tie, matching the live Odyssey loop.
    if (quality.primaryReachedUntimed && quality.ordinaryFinishStopsSearch) next.topOut = false;
    next.terminal = next.topOut || quality.masteryUntimedConditionsMet
        || (quality.primaryReachedUntimed && quality.ordinaryFinishStopsSearch);
    return next;
}

/**
 * Pure planning boundary. The four known placements use current + exactly three previews.
 * An optional fifth placement averages seven independent best responses under a uniform
 * surrogate, NOT the actual 7-bag distribution or a prediction of the unrevealed piece.
 * Only the first known action plan can be executed; all deeper nodes are diagnostics.
 */
export function planMasteryObservation(observation, options = {}) {
    const config = configFor(options);
    if (observation.preview?.length !== 3 || observation.preview.some((key) => !SHAPES[key])) {
        throw new TypeError('The planner requires exactly three valid visible previews');
    }
    const started = performance.now();
    const budget = Math.min(config.maxNodes, config.maxNodesPerPlan);
    let nodes = 0;
    let visibleHorizon = 0;
    let completeTailEvaluations = 0;
    let stoppedByWall = false;
    const exhausted = () => {
        stoppedByWall ||= performance.now() - started >= config.wallBudgetMs;
        return nodes >= budget || stoppedByWall;
    };
    const { rules } = observation;
    let frontier = [{
        ...observation, root: null, pathCost: 0, terminal: false,
    }];
    const terminal = [];
    const expand = (parent, key, { current = false, limit = Infinity, previews = [] } = {}) => {
        const activePiece = current ? observation.currentPiece : futurePiece(parent, key);
        const placements = findReachablePlacements({ boardGrid: parent.boardGrid, currentPiece: activePiece });
        const children = [];
        for (const placement of placements) {
            if (exhausted() || children.length >= limit) break;
            nodes++;
            const child = transition(parent, activePiece, placement, nodes, rules);
            child.utility = searchUtility(child, rules, previews);
            children.push(child);
        }
        return children;
    };
    for (let depth = 0; depth < 4; depth++) {
        const children = [];
        for (const parent of frontier) {
            if (exhausted()) break;
            children.push(...expand(parent, depth ? observation.preview[depth - 1] : null, {
                current: depth === 0, previews: observation.preview.slice(depth),
            }));
        }
        if (!children.length) break;
        visibleHorizon = depth + 1;
        children.sort((a, b) => b.utility - a.utility || a.pathCost - b.pathCost);
        terminal.push(...children.filter((child) => child.terminal));
        frontier = children.filter((child) => !child.terminal).slice(0, config.beamWidth);
        if (!frontier.length) break;
    }
    if (config.unknownTailDepth && visibleHorizon === 4 && !exhausted()) {
        for (let index = 0; index < frontier.length; index++) {
            const parent = frontier[index];
            // Reserve at least one complete seven-shape average for each remaining leaf.
            const perShape = Math.floor((budget - nodes) / ((frontier.length - index) * PIECE_KEYS.length));
            if (perShape < 1 || exhausted()) break;
            const utilities = [];
            for (const key of PIECE_KEYS) {
                const children = expand(parent, key, { limit: perShape });
                if (!children.length) break;
                utilities.push(Math.max(...children.map((child) => child.utility)));
            }
            if (utilities.length === PIECE_KEYS.length) {
                parent.utility = utilities.reduce((sum, utility) => sum + utility, 0) / utilities.length;
                completeTailEvaluations++;
            }
        }
    }
    const selected = [...frontier, ...terminal].filter((node) => node.root)
        .sort((a, b) => b.utility - a.utility || a.pathCost - b.pathCost)[0];
    return {
        actions: selected ? [...clone(selected.root.placement.actions), { type: 'hardDrop' }] : [],
        prediction: selected ? {
            metricsAfter: selected.root.metricsAfter,
            boardHashAfter: selected.root.boardHashAfter,
            lockedPiece: pose(selected.root.placement),
        } : null,
        diagnostics: {
            nodes,
            nodeBudget: budget,
            visibleHorizon,
            completeTailEvaluations,
            surrogateTail: config.unknownTailDepth
                ? 'uniform-seven-shape-best-response-not-bag-prediction' : 'disabled',
            surrogateWitness: false,
            stoppedByWall,
            observationHash: hash(JSON.stringify(observation)),
            knowledgePolicy: KNOWLEDGE_POLICY,
        },
    };
}

function countOffBoardCells(state) {
    let count = 0;
    for (const piece of state.lockedPieces) {
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x] && (piece.y + y < 0 || piece.y + y >= state.boardGrid.length
                    || piece.x + x < 0 || piece.x + x >= COLS)) count++;
            }
        }
    }
    return count;
}

/** Execute only revealed placements against the real seeded production engine, draining every lock. */
export async function searchMastery(options = {}) {
    const config = configFor(options);
    normalizeSessionSeed(options.seed);
    const level = getLevelById(options.levelId);
    if (!level || level.mechanics?.versus) throw new RangeError('Mastery search requires an authored solo orb');
    const engine = new GameplayHybridEngine();
    engine.configure(level);
    const state = engine.createGameState({ rngSeed: options.seed });
    state.isSeeking = true;
    state.suppressExternalInput = true;
    if (state.isInfinityMode) engine.victoryEvaluator.updateHeight(calculateBuildHeight(state));
    const initialBoardHash = hashBoard(state.boardGrid);
    const initialCells = state.boardGrid.flat().filter(Boolean).length;
    const rules = { victory: level.victory, stars: level.stars, victoryLapPolicy: level.victoryLapPolicy || 'none' };
    const trace = [];
    const started = performance.now();
    let nodes = 0;
    let activeEntry;
    let termination = 'piece-budget';
    let traceValid = true;
    let primaryReachedAtPiece = null;
    let physicsError = null;
    const originalConsoleError = console.error;
    const callbacks = engine.buildPhysicsCallbacks({
        onPieceLock: (piece) => {
            activeEntry.lockedPiece = {
                ...pose(piece), shape: clone(piece.shape), cells: piece.shape.flat().filter(Boolean).length,
            };
        },
        onLineClear: (lines) => activeEntry.lineClears.push(lines),
    });
    try {
        // lockPiece recovers rejected physics promises internally; retain that failure signal.
        console.error = (...args) => {
            if (String(args[0]).includes('Physics processing failed')) {
                physicsError = args.find((arg) => arg instanceof Error) || new Error(String(args[0]));
            }
            originalConsoleError(...args);
        };
        fillBag(state.nextPieces, state.randomGenerator);
        for (let step = 1; step <= config.maxPieces; step++) {
            if (performance.now() - started >= config.wallBudgetMs) { termination = 'wall-budget'; break; }
            if (nodes >= config.maxNodes) { termination = 'node-budget'; break; }
            spawnPiece(state, null, () => { state.isGameOver = true; });
            if (state.isGameOver) { termination = 'top-out'; break; }
            const observation = createMasteryObservation(state, engine.getMetrics(), level);
            const plan = planMasteryObservation(observation, {
                ...config,
                maxNodesPerPlan: Math.min(
                    config.maxNodesPerPlan,
                    Math.max(1, Math.floor((config.maxNodes - nodes) / (config.maxPieces - step + 1))),
                ),
                wallBudgetMs: Math.max(0.001, config.wallBudgetMs - (performance.now() - started)),
            });
            nodes += plan.diagnostics.nodes;
            if (!plan.actions.length) {
                termination = plan.diagnostics.stoppedByWall ? 'wall-budget' : 'no-plan';
                break;
            }
            activeEntry = {
                step,
                shapeKey: state.currentPiece.shapeKey,
                preview: observation.preview,
                spawnPose: pose(state.currentPiece),
                boardHashBefore: hashBoard(state.boardGrid),
                plannedActions: plan.actions,
                actions: [],
                lineClears: [],
                planning: plan.diagnostics,
                prediction: plan.prediction,
            };
            trace.push(activeEntry);
            for (const command of plan.actions) {
                const beforePose = pose(state.currentPiece);
                const wasGrounded = command.type === 'softDrop'
                    && !canPlacePiece(state, state.currentPiece, state.currentPiece.x, state.currentPiece.y + 1);
                let accepted;
                if (command.type === 'move') accepted = move(state, command.dir);
                else if (command.type === 'rotate') accepted = rotate(state, command.dir);
                else if (command.type === 'softDrop') accepted = softDrop(state, null, callbacks);
                else accepted = hardDrop(state, null, callbacks);
                const legalStop = accepted === false && wasGrounded;
                activeEntry.actions.push({
                    ...command, accepted: accepted === true, legalStop, beforePose, afterPose: pose(state.currentPiece),
                });
                if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
                if (accepted === false && !legalStop) { traceValid = false; termination = 'rejected-action'; break; }
                if (physicsError) { traceValid = false; termination = 'physics-error'; break; }
            }
            engine.updateScore(state.score);
            if (state.isInfinityMode) engine.victoryEvaluator.updateHeight(calculateBuildHeight(state));
            activeEntry.metricsAfter = engine.getMetrics();
            activeEntry.boardHashAfter = hashBoard(state.boardGrid);
            activeEntry.completed = Boolean(activeEntry.lockedPiece)
                && !state.currentPiece && !state.isProcessingPhysics;
            const expectedCells = initialCells + engine.getMetrics().piecesPlaced * 4
                - engine.getMetrics().lines * COLS;
            const actualCells = state.boardGrid.flat().filter(Boolean).length + countOffBoardCells(state);
            activeEntry.cellConservation = { expected: expectedCells, actual: actualCells };
            const actualMetrics = activeEntry.metricsAfter;
            activeEntry.predictionMatches = plan.prediction.boardHashAfter === activeEntry.boardHashAfter
                && metricKeys.every((key) => plan.prediction.metricsAfter[key] === actualMetrics[key]);
            if (!activeEntry.completed || activeEntry.lockedPiece.cells !== 4 || expectedCells !== actualCells) {
                traceValid = false; termination = 'trace-validation-failure';
            }
            let quality = evaluateMasteryMetrics(rules, engine.getMetrics(), { isGameOver: state.isGameOver });
            if (quality.primaryReachedUntimed && primaryReachedAtPiece === null) primaryReachedAtPiece = step;
            if (options.onProgress) {
                await options.onProgress({
                    step,
                    nodes,
                    metrics: activeEntry.metricsAfter,
                    quality,
                    elapsedMs: performance.now() - started,
                    planning: plan.diagnostics,
                });
            }
            if (!traceValid) break;
            if (quality.primaryReachedUntimed && quality.ordinaryFinishStopsSearch) {
                termination = quality.masteryUntimedConditionsMet ? 'untimed-tier-three-met' : 'primary-before-mastery';
                break;
            }
            if (checkInfinityGameOver(state)) {
                state.isGameOver = true; termination = 'top-out'; break;
            }
            quality = evaluateMasteryMetrics(rules, engine.getMetrics(), { isGameOver: state.isGameOver });
            if (quality.masteryUntimedConditionsMet) { termination = 'untimed-tier-three-met'; break; }
        }
        const quality = evaluateMasteryMetrics(rules, engine.getMetrics(), { isGameOver: state.isGameOver });
        const qualified = traceValid && trace.every((entry) => entry.completed);
        return {
            schemaVersion: 1,
            kind: 'targeted-mastery-search',
            searchVersion: MASTERY_SEARCH_VERSION,
            levelId: level.id,
            seed: options.seed,
            previewLimit: 3,
            knowledgePolicy: KNOWLEDGE_POLICY,
            initialBoardHash,
            initialBoard: { hash: initialBoardHash, occupiedCells: initialCells, origin: 'authored-production-engine' },
            timed: false,
            timingPolicy: 'untimed-isSeeking-no-automatic-gravity',
            scoreModel: 'Production scoring at zero held time: maximum 50-point lock bonus. Timing unvalidated.',
            status: qualified && quality.masteryUntimedConditionsMet ? 'candidate' : 'inconclusive',
            termination,
            traceValid: qualified,
            topOut: Boolean(state.isGameOver),
            primaryReachedAtPiece,
            requirements: getMasteryRequirements(level),
            quality: {
                ...quality, qualified, masteryUntimedConditionsMet: qualified && quality.masteryUntimedConditionsMet,
            },
            metrics: { ...engine.getMetrics(), time: null },
            piecesPlaced: engine.getMetrics().piecesPlaced,
            budgets: Object.fromEntries(Object.keys(MASTERY_SEARCH_DEFAULTS).map((key) => [key, config[key]])),
            compute: {
                nodes,
                elapsedMs: performance.now() - started,
                predictionMismatches: trace.filter((entry) => !entry.predictionMatches).length,
            },
            trace,
            ...(physicsError ? { error: String(physicsError.message || physicsError) } : {}),
            interpretation: 'Executed trace only; surrogate nodes are not witnesses. Replay and timing required.',
        };
    } finally {
        console.error = originalConsoleError;
        if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
        state.reset();
        engine.reset();
    }
}
