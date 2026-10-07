/** Legal construction from authored starts, without a gameplay clock or competing gravity. */
/* eslint-disable no-await-in-loop -- A lock's entire physics resolution must finish before the next command/piece. */
import { createHash } from 'node:crypto';
import {
    fillBag, spawnPiece, move, rotate, softDrop, hardDrop, canPlacePiece,
} from '../../src/core/game.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { normalizeSessionSeed } from '../../src/core/session-rng.js';
import { calculateBuildHeight, checkInfinityGameOver } from '../../src/core/infinity-grid.js';
import { BENCHMARK_PROFILES, connectivityBoardKey, createBenchmarkBot } from './profiles.mjs';

const TIERS = ['one', 'two', 'three'];
const positive = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const clone = (value) => structuredClone(value);

function chainRequirement(conditions) {
    const comboTarget = positive(conditions.combo ?? conditions.maxCombo);
    const maxCascadeDepthTarget = positive(conditions.maxCascadeDepth ?? conditions['max-cascade-depth']);
    return {
        comboTarget,
        maxCascadeDepthTarget,
        // Production triggerCombo and triggerCascadeWave carry the cascade-wave ordinal.
        // A combo requirement of 18 is therefore not qualified by demonstrating depth 10.
        effectiveChainDepth: Math.max(comboTarget, maxCascadeDepthTarget),
    };
}

/** Read exact authored quality requirements; this helper neither changes nor evaluates them. */
export function getMasteryRequirements(level) {
    if (!level?.victory?.primary || !level?.stars) throw new TypeError('An authored level configuration is required');
    const primary = clone(level.victory.primary);
    const deadline = level.victory.failure?.type === 'time'
        ? { type: 'primary-acquisition-deadline', seconds: level.victory.failure.value } : null;
    const stars = Object.fromEntries(TIERS.map((tier) => {
        const conditions = clone(level.stars[tier] || {});
        return [tier, {
            conditions,
            ...chainRequirement(conditions),
            timeConstraints: conditions.time === undefined ? []
                : [{ type: 'completion-upper-bound', seconds: conditions.time }],
            bonusCount: positive(conditions.bonuses),
        }];
    }));
    const bonuses = (level.victory.bonuses || []).map((bonus, index) => ({
        index,
        ...clone(bonus),
        ...chainRequirement({ [bonus.type]: bonus.target }),
        timeConstraints: bonus.type === 'time' ? [{ type: 'completion-upper-bound', seconds: bonus.target }] : [],
    }));
    const primaryChain = chainRequirement({ [primary.type]: primary.target });
    return {
        levelId: level.id,
        primary: {
            ...primary,
            ...primaryChain,
            timeConstraints: [
                ...(deadline ? [deadline] : []),
                ...(primary.type === 'time' ? [{ type: 'survival-lower-bound', seconds: primary.target }] : []),
            ],
        },
        stars,
        bonuses,
        maximumEffectiveChainDepth: Math.max(
            primaryChain.effectiveChainDepth,
            ...Object.values(stars).map((entry) => entry.effectiveChainDepth),
            ...bonuses.map((entry) => entry.effectiveChainDepth),
        ),
        finishPolicy: {
            authored: level.victoryLapPolicy || 'none',
            stopAfterPrimaryResolution: level.victoryLapPolicy !== 'showcase',
            drainEntireCascade: true,
            showcaseCanContinueAfterPrimary: level.victoryLapPolicy === 'showcase',
        },
        comboSemantics: 'Peak cascade-wave ordinal, as reported by the production Odyssey metric hooks.',
        timedValidationRequired: true,
    };
}

function pose(piece) {
    return piece ? {
        x: piece.x, y: piece.y, rotation: piece.rotation, shapeKey: piece.shapeKey,
    } : null;
}

function boardHash(state) {
    return createHash('sha256').update(connectivityBoardKey(state.boardGrid)).digest('hex');
}

function offBoardCells(state) {
    let cells = 0;
    const rows = state.boardGrid.length;
    const columns = state.boardGrid[0].length;
    for (const piece of state.lockedPieces) {
        for (let y = 0; y < piece.shape.length; y++) {
            for (let x = 0; x < piece.shape[y].length; x++) {
                if (piece.shape[y][x]
                    && (piece.y + y < 0 || piece.y + y >= rows || piece.x + x < 0 || piece.x + x >= columns)) {
                    cells++;
                }
            }
        }
    }
    return cells;
}

function untimedQuality(engine, requirements) {
    const bonusResults = engine.evaluateBonuses();
    const bonuses = requirements.bonuses.map((bonus) => ({
        index: bonus.index,
        type: bonus.type,
        untimedConditionMet: bonus.timeConstraints.length ? null : bonusResults[bonus.index],
        timeUnvalidated: bonus.timeConstraints.length > 0,
    }));
    // A time-only bonus cannot count toward a required bonus total in an untimed run.
    const qualifiedBonuses = bonuses.map((bonus) => bonus.untimedConditionMet === true);
    const stars = Object.fromEntries(TIERS.map((tier) => {
        const conditions = { ...requirements.stars[tier].conditions };
        delete conditions.time;
        const evaluator = engine.victoryEvaluator;
        const met = evaluator.calculateStars({ one: conditions }, engine.gameState, qualifiedBonuses) === 1;
        return [tier, {
            untimedConditionsMet: met,
            timeUnvalidated: requirements.stars[tier].timeConstraints.length > 0,
        }];
    }));
    return { stars, bonuses };
}

function validCommand(command) {
    if (command?.type === 'move') return command.dir === -1 || command.dir === 1;
    if (command?.type === 'rotate') return ['left', 'right', 'flip'].includes(command.dir);
    return command?.type === 'softDrop' || command?.type === 'hardDrop';
}

/**
 * Demonstrate what this bounded policy actually builds from one authored start.
 * No clock advances or automatic gravity runs; isSeeking skips presentation waits.
 * Consequently neither primary acquisition deadlines nor timed star ratings are validated.
 */
export async function demonstrateAuthoredConstruction({
    levelId, profileId, seed, maxPieces = 128, decisionSeed = 'authored-construction-v1',
}) {
    if (!Number.isSafeInteger(maxPieces) || maxPieces < 1 || maxPieces > 128) {
        throw new RangeError('Construction piece budget must be an integer from 1 to 128');
    }
    normalizeSessionSeed(seed);
    const level = getLevelById(levelId);
    if (!level) throw new RangeError(`Unknown Odyssey orb: ${levelId}`);
    if (!BENCHMARK_PROFILES.some((profile) => profile.id === profileId)) {
        throw new RangeError(`Unknown benchmark profile: ${profileId}`);
    }
    const requirements = getMasteryRequirements(level);
    if (level.mechanics?.versus) {
        throw new RangeError('Authored construction supports solo orbs; duel simulation is timed gameplay');
    }

    const engine = new GameplayHybridEngine();
    engine.configure(level);
    const state = engine.createGameState({ rngSeed: seed });
    state.isSeeking = true;
    state.suppressExternalInput = true;
    if (state.isInfinityMode) engine.victoryEvaluator.updateHeight(calculateBuildHeight(state));
    const trace = [];
    const originalConsoleError = console.error;
    let physicsError = null;
    let planningError = null;
    let activeEntry = null;
    let rejectedActions = 0;
    let legalSoftDropStops = 0;
    let allTetrominoes = true;
    let addedCellsAfterStart = 0;
    let traceValid = true;
    let termination = 'piece-budget';
    let primaryReachedAtPiece = null;
    let quality;
    const initialBoard = {
        origin: 'GameplayHybridEngine.createGameState authored start',
        hash: boardHash(state),
        hashAlgorithm: 'sha256 of canonical connectivityBoardKey',
        rows: state.boardGrid.length,
        columns: state.boardGrid[0]?.length || 0,
        authoredRows: level.mechanics.board.rows,
        authoredStartingRows: level.mechanics.board.startingRows || 0,
        occupiedCells: state.boardGrid.flat().filter(Boolean).length,
        lockedPieces: clone(state.lockedPieces),
    };
    const authoredState = {
        baseMode: level.mechanics.baseMode,
        mechanics: clone(level.mechanics),
        modifiers: clone(level.modifiers),
        victory: clone(level.victory),
        stars: clone(level.stars),
        scoringLevel: state.level,
        dropInterval: state.dropInterval,
        levelProgression: !state.disableLevelProgression,
        comboMultiplierEnabled: Boolean(state.comboMultiplierEnabled),
        comboMultiplier: state.comboMultiplier || 1,
    };
    const callbacks = engine.buildPhysicsCallbacks({
        onPieceLock: (piece) => {
            const cells = piece.shape.flat().filter(Boolean).length;
            allTetrominoes &&= cells === 4;
            if (activeEntry) activeEntry.lockedPiece = { ...pose(piece), cells, shape: clone(piece.shape) };
        },
        onLineClear: (lines) => { activeEntry?.lineClears.push(lines); },
        triggerCascadeWave: (depth) => {
            if (activeEntry) activeEntry.maximumDepth = Math.max(activeEntry.maximumDepth, depth);
        },
        onCascadeComplete: (depth) => {
            if (activeEntry) activeEntry.resolvedWaves = depth;
        },
        // The driver deliberately owns spawning after awaiting the entire lock promise.
        // onCascadeComplete precedes the perfect-clear score bonus; it is too early to stop.
    });
    const checked = (name, action) => () => {
        const beforePose = pose(state.currentPiece);
        const wasGrounded = name === 'softDrop' && state.currentPiece
            && !canPlacePiece(state, state.currentPiece, state.currentPiece.x, state.currentPiece.y + 1);
        const accepted = action();
        const legalStop = accepted === false && Boolean(wasGrounded);
        if (accepted === false) rejectedActions++;
        if (legalStop) legalSoftDropStops++;
        activeEntry?.actions.push({
            ...activeEntry.currentCommand,
            accepted: accepted === true,
            legalStop,
            beforePose,
            afterPose: pose(state.currentPiece),
        });
        return accepted;
    };
    const actions = {
        moveLeft: checked('moveLeft', () => move(state, -1)),
        moveRight: checked('moveRight', () => move(state, 1)),
        rotateLeft: checked('rotateLeft', () => rotate(state, 'left')),
        rotateRight: checked('rotateRight', () => rotate(state, 'right')),
        rotateFlip: checked('rotateFlip', () => rotate(state, 'flip')),
        softDrop: checked('softDrop', () => softDrop(state, null, callbacks)),
        hardDrop: checked('hardDrop', () => hardDrop(state, null, callbacks)),
    };
    try {
        // Legacy lockPiece catches physics errors. Preserve that signal instead of letting
        // its recovery path be mistaken for a complete legal construction demonstration.
        console.error = (...args) => {
            if (String(args[0]).includes('Physics processing failed')) {
                physicsError = args.find((arg) => arg instanceof Error) || new Error(String(args[0]));
            }
            originalConsoleError(...args);
        };
        const bot = createBenchmarkBot({
            gameState: state,
            actions,
            profileId,
            decisionSeed: `${decisionSeed}:${seed}`,
            levelConfig: level,
            getMetrics: () => engine.getMetrics(),
        });
        fillBag(state.nextPieces, state.randomGenerator);
        for (let step = 1; step <= maxPieces; step++) {
            spawnPiece(state, null, () => { state.isGameOver = true; });
            if (state.isGameOver) { termination = 'top-out'; break; }
            if (!state.currentPiece) { termination = 'missing-piece'; traceValid = false; break; }
            activeEntry = {
                step,
                shapeKey: state.currentPiece.shapeKey,
                spawnPose: pose(state.currentPiece),
                preview: state.nextPieces.slice(0, 3),
                boardHashBefore: boardHash(state),
                metricsBefore: engine.getMetrics(),
                actions: [],
                lineClears: [],
                maximumDepth: 0,
                resolvedWaves: 0,
                completed: false,
            };
            trace.push(activeEntry);
            allTetrominoes &&= state.currentPiece.shape.flat().filter(Boolean).length === 4;
            const queuedPiecesBeforePlan = JSON.stringify(state.nextPieces);
            let plan;
            try {
                plan = bot.plan();
            } catch (error) {
                planningError = error;
                termination = 'planning-error'; traceValid = false; break;
            }
            if (boardHash(state) !== activeEntry.boardHashBefore
                || JSON.stringify(pose(state.currentPiece)) !== JSON.stringify(activeEntry.spawnPose)
                || JSON.stringify(state.nextPieces) !== queuedPiecesBeforePlan) {
                addedCellsAfterStart = Math.max(0, state.boardGrid.flat().filter(Boolean).length
                    - initialBoard.occupiedCells - 4 * engine.getMetrics().piecesPlaced
                    + initialBoard.columns * engine.getMetrics().lines);
                termination = 'planning-mutated-state'; traceValid = false; break;
            }
            if (!plan || !Array.isArray(plan.actions) || !plan.actions.length) {
                termination = 'no-plan'; traceValid = false; break;
            }
            activeEntry.plannedActions = clone(plan.actions);
            for (const command of plan.actions) {
                if (!validCommand(command) || !state.currentPiece || activeEntry.lockedPiece) {
                    activeEntry.actions.push({ ...clone(command), accepted: false, invalid: true });
                    rejectedActions++;
                    termination = 'invalid-action'; traceValid = false; break;
                }
                activeEntry.currentCommand = command;
                bot.scheduler.perform(command);
                const result = activeEntry.actions.at(-1);
                if (!result || (!result.accepted && !result.legalStop)) {
                    termination = 'rejected-action'; traceValid = false; break;
                }
                if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
                if (physicsError) { termination = 'physics-error'; traceValid = false; break; }
            }
            if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
            delete activeEntry.currentCommand;
            engine.updateScore(state.score);
            if (state.isInfinityMode) engine.victoryEvaluator.updateHeight(calculateBuildHeight(state));
            activeEntry.metricsAfter = engine.getMetrics();
            activeEntry.boardHashAfter = boardHash(state);
            activeEntry.completed = Boolean(activeEntry.lockedPiece) && !state.isProcessingPhysics && traceValid;
            if (!traceValid) break;
            if (!activeEntry.completed || state.currentPiece) {
                termination = 'incomplete-plan'; traceValid = false; break;
            }
            if (!allTetrominoes) { termination = 'invalid-tetromino'; traceValid = false; break; }
            const expectedCells = initialBoard.occupiedCells + 4 * engine.getMetrics().piecesPlaced
                - initialBoard.columns * engine.getMetrics().lines;
            // Production permits a final Infinity lock partly above y=0. Those
            // cells remain in lockedPieces but are outside the displayed grid.
            const visibleCells = state.boardGrid.flat().filter(Boolean).length;
            const outsideCells = offBoardCells(state);
            const actualCells = visibleCells + outsideCells;
            activeEntry.cellConservation = {
                expected: expectedCells, actual: actualCells, visibleCells, offBoardCells: outsideCells,
            };
            if (actualCells !== expectedCells) {
                addedCellsAfterStart = Math.max(0, actualCells - expectedCells);
                activeEntry.validationIssue = 'cell-conservation-failure';
                state.isGameOver ||= checkInfinityGameOver(state);
                termination = state.isGameOver ? 'top-out' : 'cell-conservation-failure';
                traceValid = false; break;
            }
            if (engine.checkVictory() && primaryReachedAtPiece === null) primaryReachedAtPiece = step;
            quality = untimedQuality(engine, requirements);
            if (primaryReachedAtPiece !== null && requirements.finishPolicy.stopAfterPrimaryResolution) {
                termination = 'primary-complete'; break;
            }
            // Match the live loop's ordinary-primary precedence, then enforce its
            // absolute Infinity roof rule before allowing another piece to spawn.
            if (checkInfinityGameOver(state)) {
                state.isGameOver = true;
                termination = 'top-out'; break;
            }
            if (primaryReachedAtPiece !== null && quality.stars.three.untimedConditionsMet
                && quality.bonuses.every((bonus) => bonus.timeUnvalidated || bonus.untimedConditionMet)) {
                termination = 'untimed-requirements-met'; break;
            }
        }
        quality = untimedQuality(engine, requirements);
        const traceComplete = trace.every((entry) => entry.completed);
        const fulfilled = primaryReachedAtPiece !== null && quality.stars.three.untimedConditionsMet
            && quality.bonuses.every((bonus) => bonus.timeUnvalidated || bonus.untimedConditionMet);
        const qualified = traceValid && traceComplete && allTetrominoes && !physicsError;
        return {
            schemaVersion: 1,
            id: `authored:${level.id}:${profileId}:${seed}:${decisionSeed}`,
            kind: 'authored-board-construction',
            levelId: level.id,
            profileId,
            seed,
            decisionSeed,
            effectiveDecisionSeed: `${decisionSeed}:${seed}`,
            timed: false,
            timingPolicy: 'untimed-isSeeking-no-automatic-gravity',
            timingLimitations: [
                'No input cadence, competing gravity, survival time or acquisition deadline is validated.',
                'isSeeking skips presentation delays; the gameplay clock does not advance.',
                'Production scoring runs with zero held time, awarding the maximum 50-point lock bonus.',
                'Untimed requirement observations do not award or validate timed stars.',
            ],
            status: qualified && fulfilled ? 'pass' : 'inconclusive',
            termination,
            primaryReachedAtPiece,
            primaryReachedUntimed: primaryReachedAtPiece !== null,
            maximumDepth: engine.getMetrics().maxCascadeDepth,
            metrics: { ...engine.getMetrics(), time: null },
            requirements,
            quality: {
                ...quality, qualified, allUntimedRequirementsMet: qualified && fulfilled, timedStars: null,
            },
            pieceBudget: maxPieces,
            piecesPlaced: engine.getMetrics().piecesPlaced,
            rejectedActions,
            legalSoftDropStops,
            failedActions: rejectedActions - legalSoftDropStops,
            topOut: Boolean(state.isGameOver),
            traceValid: qualified,
            traceComplete,
            allTetrominoes,
            previewLimit: 3,
            addedCellsAfterStart,
            addedCellsMeaning: 'Unexpected added cells beyond authored starting rows and recorded tetromino locks.',
            initialBoard,
            initialBoardOrigin: initialBoard.origin,
            initialBoardHash: initialBoard.hash,
            authoredState,
            rngDescriptor: clone(state.rngDescriptor),
            trace,
            ...(physicsError || planningError
                ? { error: String((physicsError || planningError).message || physicsError || planningError) } : {}),
            interpretation: fulfilled && qualified
                ? 'A legal trace met the authored untimed conditions; timing remains unvalidated.'
                : 'Untimed conditions remain unqualified; not an impossibility or difficulty verdict.',
        };
    } finally {
        console.error = originalConsoleError;
        if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
        state.reset();
        engine.reset();
    }
}
