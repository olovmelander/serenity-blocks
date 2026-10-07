/** Mechanics validation skips presentation delays. It is never a timed campaign attempt. */
/* eslint-disable no-await-in-loop -- Each real-engine fixture is completed and retired before the next;
   bounded sequential demonstrations avoid overlapping the legacy game's shared action scratch buffers. */
import {
    GameState, spawnPiece, move, rotate, softDrop, hardDrop, fillBag,
} from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { processPhysicsLegacy } from '../../src/core/physics.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { simulatePlacement } from '../../src/core/ai/cascade-simulator.js';
import { calculateLineClearScore } from '../../src/core/scoring.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import { INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1 } from '../../src/core/infinity-spawn-policy.js';
import { bindLegacySessionRng } from '../../src/core/session-rng.js';
import { BENCHMARK_PROFILES, connectivityBoardKey, createBenchmarkBot } from './profiles.mjs';

function row(x, y, width, pieceId) {
    return {
        x, y, pieceId, shape: [Array(width).fill(1)], color: 'I', type: 'I', shapeKey: 'I',
    };
}

function clonePieces(pieces) {
    return pieces.map((piece) => ({ ...piece, shape: piece.shape.map((cells) => cells.slice()) }));
}

function makeState(fixture, current = fixture.shapeKey) {
    const state = new GameState({
        isInfinityMode: Boolean(fixture.infinity),
        initialInfinityRows: fixture.infinity ? 44 : undefined,
        infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
        hitStopEnabled: false,
    });
    state.isSeeking = true;
    state.disableLevelProgression = true;
    state.level = fixture.level || 3;
    state.comboMultiplierEnabled = Boolean(fixture.comboMultiplier);
    state.comboMultiplier = fixture.comboMultiplier || 1;
    state.comboCount = fixture.comboMultiplier ? 2 : 0;
    state.lockedPieces = clonePieces(fixture.pieces(state.boardGrid.length - 1));
    rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
    state.nextPieces = [current, ...(fixture.nextPieces || ['I', 'O', 'T'])];
    spawnPiece(state, null, () => { state.isGameOver = true; });
    return state;
}

export const CASCADE_CAPABILITY_FIXTURES = Object.freeze([
    {
        id: 'standard-two-wave',
        shapeKey: 'I',
        expectedLines: 2,
        expectedWaves: 2,
        pieces: (bottom) => [row(4, bottom, 6, 'floor'), row(4, bottom - 1, 6, 'shelf'),
            row(0, bottom - 3, 4, 'payload')],
        placement: (bottom) => ({ x: 0, y: bottom - 1, rotation: 0 }),
    },
    {
        id: 'infinity-two-wave',
        infinity: true,
        shapeKey: 'I',
        expectedLines: 2,
        expectedWaves: 2,
        pieces: (bottom) => [row(4, bottom, 6, 'floor'), row(4, bottom - 1, 6, 'shelf'),
            row(0, bottom - 3, 4, 'payload')],
        placement: (bottom) => ({ x: 0, y: bottom - 1, rotation: 0 }),
    },
    {
        id: 'odyssey-score-modifier',
        level: 7,
        comboMultiplier: 2,
        shapeKey: 'I',
        expectedLines: 2,
        expectedWaves: 2,
        pieces: (bottom) => [row(4, bottom, 6, 'floor'), row(4, bottom - 1, 6, 'shelf'),
            row(0, bottom - 3, 4, 'payload')],
        placement: (bottom) => ({ x: 0, y: bottom - 1, rotation: 0 }),
    },
    {
        id: 'infinity-playable-roof',
        infinity: true,
        shapeKey: 'O',
        expectedLines: 1,
        expectedWaves: 1,
        pieces: () => [row(0, 1, 4, 'left'), row(6, 1, 4, 'right'), row(4, 2, 2, 'support')],
        placement: () => ({ x: 4, y: 0, rotation: 0 }),
    },
    {
        id: 'connected-payload',
        shapeKey: 'I',
        expectedLines: 1,
        expectedWaves: 1,
        pieces: (bottom) => [row(0, bottom, 6, 'floor'), row(0, bottom - 1, 1, 'support'),
            row(0, bottom - 3, 2, 'payload')],
        placement: (bottom) => ({ x: 6, y: bottom - 1, rotation: 0 }),
    },
    {
        id: 'separate-payload',
        shapeKey: 'I',
        expectedLines: 1,
        expectedWaves: 1,
        pieces: (bottom) => [row(0, bottom, 6, 'floor'), row(0, bottom - 1, 1, 'support'),
            row(0, bottom - 3, 1, 'payload-a'), row(1, bottom - 3, 1, 'payload-b')],
        placement: (bottom) => ({ x: 6, y: bottom - 1, rotation: 0 }),
    },
]);

function occupiedBoardKey(board) {
    return board.map((cells) => cells.map((cell) => (cell ? '#' : '.')).join('')).join('|');
}

function resolutionContext(state, placement) {
    const lockFootprint = [];
    placement.shape.forEach((cells, y) => cells.forEach((cell, x) => {
        if (cell) lockFootprint.push({ x: placement.x + x, y: placement.y + y });
    }));
    return {
        boardHeight: state.boardGrid.length,
        isInfinityMode: state.isInfinityMode,
        level: state.level,
        lines: state.lines,
        linesUntilNextLevel: state.linesUntilNextLevel,
        dropInterval: state.dropInterval,
        disableLevelProgression: true,
        comboMultiplierEnabled: state.comboMultiplierEnabled,
        comboMultiplier: state.comboMultiplier,
        comboCount: state.comboCount,
        comboState: { lockFootprint, manualColumns: [...new Set(lockFootprint.map((cell) => cell.x))] },
    };
}

async function validateMechanics(fixture) {
    const state = makeState(fixture);
    try {
        const target = fixture.placement(state.boardGrid.length - 1);
        const placement = findReachablePlacements(state).find((candidate) => candidate.x === target.x
        && candidate.y === target.y && candidate.rotation === target.rotation);
        if (!placement) return { id: fixture.id, status: 'fail', reason: 'Fixture trigger is not reachable.' };
        const pieces = [...state.lockedPieces, { ...placement, pieceId: 'trigger', color: fixture.shapeKey }];
        const context = resolutionContext(state, placement);
        const canonical = resolveCascade(pieces, context);
        const ai = simulatePlacement(state, placement);
        const live = {
            ...context,
            ...state,
            lockedPieces: clonePieces(pieces),
            currentPiece: null,
            boardGrid: state.boardGrid.map((cells) => cells.map((cell) => (cell ? { ...cell } : null))),
            comboState: context.comboState,
            score: 0,
            isSeeking: true,
        };
        const waves = [];
        await processPhysicsLegacy(live, { onLineClear: (count) => waves.push(count) });
        const actual = {
            lines: live.lines, waves: waves.length, waveLines: waves, score: live.score,
        };
        const expected = { lines: fixture.expectedLines, waves: fixture.expectedWaves };
        const canonicalMatches = canonical.linesClearedThisTurn === actual.lines
        && canonical.waves.length === actual.waves && canonical.scoreDelta === actual.score
        && connectivityBoardKey(canonical.boardAfter) === connectivityBoardKey(live.boardGrid);
        const aiMatches = ai.totalLines === actual.lines && ai.cascadeCount === actual.waves
            && connectivityBoardKey(ai.boardGrid) === connectivityBoardKey(live.boardGrid);
        const heuristicScore = calculateLineClearScore(ai.totalLines, 1, Math.max(1, ai.cascadeCount), ai.perfectClear);
        // The initial fixture occupancy and canonical afterstate expose connectivity-cache collisions.
        const measurement = {
            id: fixture.id,
            status: canonicalMatches && actual.lines === expected.lines
            && actual.waves === expected.waves ? 'pass' : 'fail',
            scope: {
                baseModes: [fixture.infinity ? 'infinity' : 'standard'],
                objectiveTypes: ['cascade', 'combo', 'score', 'lines', 'tetrises'],
            },
            reachable: true,
            expected,
            actual,
            canonicalMatches,
            aiSimulator: {
                status: aiMatches ? 'pass' : 'fail',
                lines: ai.totalLines,
                waves: ai.cascadeCount,
                scoreProjection: {
                    estimated: heuristicScore,
                    actual: actual.score,
                    matches: heuristicScore === actual.score,
                },
            },
            initialOccupancy: occupiedBoardKey(state.boardGrid),
            initialConnectivity: connectivityBoardKey(state.boardGrid),
            finalConnectivity: connectivityBoardKey(live.boardGrid),
        };
        return measurement;
    } finally {
        state.reset();
    }
}

async function demonstrateStrategy(fixture, profileId, decisionSeed, twoPieces = false) {
    const state = makeState({ ...fixture, nextPieces: ['I', 'O', 'T'] }, twoPieces ? 'O' : fixture.shapeKey);
    try {
        let maximumDepth = 0;
        let cascades = 0;
        let rejectedActions = 0;
        let hardDrops = 0;
        const callbacks = {
            triggerCascadeWave: (depth) => { maximumDepth = Math.max(maximumDepth, depth); },
            onCascadeComplete: (depth) => { if (depth >= 2) cascades++; },
            spawnPiece: () => spawnPiece(state, null, () => { state.isGameOver = true; }),
        };
        const checked = (action) => (...args) => {
            const accepted = action(...args);
            if (!accepted) rejectedActions++;
            return accepted;
        };
        const actions = {
            moveLeft: checked(() => move(state, -1)),
            moveRight: checked(() => move(state, 1)),
            rotateLeft: checked(() => rotate(state, 'left')),
            rotateRight: checked(() => rotate(state, 'right')),
            rotateFlip: checked(() => rotate(state, 'flip')),
            softDrop: checked(() => softDrop(state, null, null)),
            hardDrop: () => { hardDrops++; return hardDrop(state, null, callbacks); },
        };
        const bot = createBenchmarkBot({
            gameState: state,
            actions,
            profileId,
            decisionSeed,
            levelConfig: { victory: { primary: { type: 'cascade', target: 1 }, bonuses: [] } },
            getMetrics: () => ({
                cascades, maxCombo: maximumDepth, score: state.score, lines: state.lines,
            }),
        });
        let plans = 0;
        for (let step = 0; step < (twoPieces ? 2 : 1) && state.currentPiece && !state.isGameOver; step++) {
            const plan = bot.plan();
            if (!plan) break;
            plans++;
            for (const action of plan.actions) bot.scheduler.perform(action);
            if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
        }
        const demonstrated = maximumDepth >= 2 && rejectedActions === 0;
        const measurement = {
            id: `${fixture.id}${twoPieces ? ':preserve-then-fire' : ':fire'}`,
            kind: 'prepared-fixture',
            timed: false,
            status: demonstrated ? 'pass' : 'inconclusive',
            maximumDepth,
            cascades,
            plans,
            hardDrops,
            rejectedActions,
            topOut: state.isGameOver,
            reason: demonstrated ? 'Executed a reachable two-wave chain with real game actions.'
                : 'This bounded policy did not demonstrate the chain; this is not a level difficulty verdict.',
        };
        return measurement;
    } finally {
        state.reset();
    }
}

function pose(piece) {
    return {
        x: piece.x, y: piece.y, rotation: piece.rotation, shapeKey: piece.shapeKey,
    };
}

function realActions(state, callbacks, onAction = () => {}) {
    const checked = (type, action) => (...args) => {
        const accepted = action(...args);
        onAction(type, accepted);
        return accepted;
    };
    return {
        moveLeft: checked('moveLeft', () => move(state, -1)),
        moveRight: checked('moveRight', () => move(state, 1)),
        rotateLeft: checked('rotateLeft', () => rotate(state, 'left')),
        rotateRight: checked('rotateRight', () => rotate(state, 'right')),
        rotateFlip: checked('rotateFlip', () => rotate(state, 'flip')),
        softDrop: checked('softDrop', () => softDrop(state, null, null)),
        hardDrop: checked('hardDrop', () => hardDrop(state, null, callbacks)),
    };
}

async function replayConstructedTrigger(snapshot, trace, sourceId) {
    // Snapshot cells come exclusively from the preceding real tetromino action trace.
    // Replaying the trigger is a prepared-position claim, not a second construction run.
    const state = makeState({ ...snapshot, pieces: () => snapshot.lockedPieces }, snapshot.shapeKey);
    try {
        let maximumDepth = 0;
        let rejectedActions = 0;
        const callbacks = { triggerCascadeWave: (depth) => { maximumDepth = Math.max(maximumDepth, depth); } };
        const bot = createBenchmarkBot({
            gameState: state,
            actions: realActions(state, callbacks, (_, accepted) => { if (accepted === false) rejectedActions++; }),
            profileId: 'expert',
            decisionSeed: 'constructed-trigger-replay',
        });
        for (const action of trace.actions) bot.scheduler.perform(action);
        if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
        return {
            kind: 'prepared-from-legal-construction',
            timed: false,
            sourceConstructionId: sourceId,
            maximumDepth,
            rejectedActions,
            status: maximumDepth === trace.maximumDepth && rejectedActions === 0 ? 'pass' : 'fail',
            expectedDepth: trace.maximumDepth,
            sourcePrefixPieces: trace.step - 1,
        };
    } finally { state.reset(); }
}

/** No cells, attacks or pieces are injected after the empty board is created. */
export async function demonstrateConstruction({
    profileId, seed, infinity = false, maxPieces = 40, decisionSeed = 'capabilities-v2',
}) {
    if (!Number.isSafeInteger(maxPieces) || maxPieces < 1 || maxPieces > 128) {
        throw new RangeError('Construction piece budget must be an integer from 1 to 128');
    }
    const state = new GameState({
        isInfinityMode: infinity,
        initialInfinityRows: infinity ? 44 : undefined,
        infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
        hitStopEnabled: false,
        disableLevelProgression: true,
    });
    state.isSeeking = true;
    bindLegacySessionRng(state, seed);
    fillBag(state.nextPieces, state.randomGenerator);
    const id = `${infinity ? 'infinity' : 'standard'}:empty:${profileId}:${seed}`;
    try {
        let maximumDepth = 0;
        let currentDepth = 0;
        let cascades = 0;
        let tetrises = 0;
        let singles = 0;
        let rejectedActions = 0;
        let allTetrominoes = true;
        const trace = [];
        let bestSnapshot = null;
        let bestTrace = null;
        const callbacks = {
            triggerCascadeWave: (depth) => {
                currentDepth = Math.max(currentDepth, depth);
                maximumDepth = Math.max(maximumDepth, depth);
            },
            onLineClear: (lines) => {
                if (lines === 1) singles++;
                if (lines === 4) tetrises++;
            },
            onCascadeComplete: (depth) => { if (depth >= 2) cascades++; },
            spawnPiece: () => spawnPiece(state, null, () => { state.isGameOver = true; }),
        };
        const actions = realActions(state, callbacks, (_, accepted) => { if (accepted === false) rejectedActions++; });
        spawnPiece(state, null, () => { state.isGameOver = true; });
        const bot = createBenchmarkBot({
            gameState: state,
            actions,
            profileId,
            decisionSeed: `${decisionSeed}:${seed}`,
            levelConfig: {
                victory: { primary: { type: 'combo', target: 10 }, bonuses: [] },
                stars: { three: { maxCascadeDepth: 10 } },
            },
            getMetrics: () => ({
                cascades, maxCombo: maximumDepth, maxCascadeDepth: maximumDepth, tetrises, singles,
            }),
        });
        for (let step = 1; step <= maxPieces && state.currentPiece && !state.isGameOver; step++) {
            const plan = bot.plan();
            if (!plan) break;
            const snapshot = {
                infinity,
                shapeKey: state.currentPiece.shapeKey,
                level: state.level,
                lockedPieces: clonePieces(state.lockedPieces),
            };
            const beforeLines = state.lines;
            const tetrominoCells = state.currentPiece.shape.flat().filter(Boolean).length;
            allTetrominoes &&= tetrominoCells === 4;
            currentDepth = 0;
            const entry = {
                step,
                shapeKey: state.currentPiece.shapeKey,
                spawnPose: pose(state.currentPiece),
                preview: state.nextPieces.slice(0, 3),
                actions: [],
                predictedDepth: plan.candidate.cascadeCount,
            };
            for (const action of plan.actions) {
                if (action.type === 'hardDrop') entry.preDropPose = pose(state.currentPiece);
                const priorRejections = rejectedActions;
                bot.scheduler.perform(action);
                entry.actions.push({ ...action });
                if (rejectedActions > priorRejections) break;
            }
            if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
            entry.maximumDepth = currentDepth;
            entry.lines = state.lines - beforeLines;
            trace.push(entry);
            if (!bestTrace || currentDepth > bestTrace.maximumDepth) {
                bestSnapshot = snapshot;
                bestTrace = entry;
            }
            // Seeking removes competing gravity. A rejected path is a validation failure,
            // not permission to teleport or continue the remaining planned inputs.
            if (rejectedActions > 0 || maximumDepth >= 10) break;
        }
        const preparedReplay = bestTrace?.maximumDepth >= 3
            ? await replayConstructedTrigger(bestSnapshot, bestTrace, id) : null;
        return {
            id,
            kind: 'empty-board-construction',
            timed: false,
            profileId,
            seed,
            baseMode: infinity ? 'infinity' : 'standard',
            status: maximumDepth >= 3 && rejectedActions === 0 && allTetrominoes ? 'pass' : 'inconclusive',
            maximumDepth,
            cascades,
            tetrises,
            singles,
            piecesPlaced: trace.length,
            pieceBudget: maxPieces,
            rejectedActions,
            topOut: state.isGameOver,
            previewLimit: 3,
            insertedCells: 0,
            allTetrominoes,
            trace,
            preparedReplay,
            reason: maximumDepth >= 3 ? 'A real action trace constructed a chain from an empty board.'
                : 'The bounded policy did not construct a three-wave chain; deeper goals remain inconclusive.',
        };
    } finally { state.reset(); }
}

export async function validateCapabilities(options = {}) {
    const profileIds = options.profileIds || BENCHMARK_PROFILES.map((profile) => profile.id);
    const mechanicsFixtures = [];
    for (const fixture of CASCADE_CAPABILITY_FIXTURES) {
        try {
            mechanicsFixtures.push(await validateMechanics(fixture));
        } catch (error) {
            mechanicsFixtures.push({ id: fixture.id, status: 'fail', reason: String(error?.message || error) });
        }
    }
    const connected = mechanicsFixtures.find((fixture) => fixture.id === 'connected-payload');
    const separate = mechanicsFixtures.find((fixture) => fixture.id === 'separate-payload');
    const cacheCollisionValidated = Boolean(connected?.reachable && separate?.reachable
        && connected.initialOccupancy === separate.initialOccupancy
        && connected.initialConnectivity !== separate.initialConnectivity
        && connected.finalConnectivity !== separate.finalConnectivity);
    const profiles = [];
    for (const profileId of profileIds) {
        const demonstrations = [];
        for (const fixture of CASCADE_CAPABILITY_FIXTURES.slice(0, 2)) {
            for (const twoPieces of [false, true]) {
                try {
                    demonstrations.push(await demonstrateStrategy(
                        fixture,
                        profileId,
                        options.decisionSeed ?? 'capabilities-v1',
                        twoPieces,
                    ));
                } catch (error) {
                    demonstrations.push({
                        id: fixture.id,
                        status: 'inconclusive',
                        reason: String(error?.message || error),
                    });
                }
            }
        }
        const passed = demonstrations.filter((demo) => demo.status === 'pass');
        const constructionDemos = [];
        for (const seed of options.constructionSeeds || [1001, 1002, 1003]) {
            for (const infinity of [false, true]) {
                constructionDemos.push(await demonstrateConstruction({
                    profileId,
                    seed,
                    infinity,
                    maxPieces: options.constructionMaxPieces ?? 40,
                    decisionSeed: options.decisionSeed ?? 'capabilities-v2',
                }));
            }
        }
        const validConstruction = constructionDemos.filter((demo) => demo.rejectedActions === 0 && demo.allTetrominoes);
        const constructedDepth = Math.max(0, ...validConstruction.map((demo) => demo.maximumDepth));
        const targets = [3, 5, 8, 10].map((targetDepth) => {
            const passedDemonstrations = validConstruction.filter((demo) => demo.maximumDepth >= targetDepth).length;
            return {
                targetDepth,
                passedDemonstrations,
                totalDemonstrations: constructionDemos.length,
                status: constructionDemos.length > 0 && passedDemonstrations === constructionDemos.length
                    ? 'pass' : 'inconclusive',
            };
        });
        profiles.push({
            profileId,
            status: passed.length === demonstrations.length ? 'pass' : 'inconclusive',
            demonstrations,
            validatedMaxCascadeDepth: Math.max(0, ...passed.map((demo) => demo.maximumDepth)),
            scope: {
                baseModes: ['standard', 'infinity'],
                objectiveTypes: ['cascade', 'combo'],
                maximumValidatedDepth: Math.max(0, ...passed.map((demo) => demo.maximumDepth)),
            },
            construction: {
                kind: 'empty-board-construction',
                timed: false,
                status: targets[0].status,
                demonstrations: constructionDemos,
                targets,
                validatedMaxCascadeDepth: constructedDepth,
                scope: { baseModes: ['standard', 'infinity'], objectiveTypes: ['cascade', 'combo'] },
            },
            limitations: ['Two-wave prepared fixtures do not validate building deep chains from an empty board.',
                'Construction targets are measured per seed and mode; a missed 8–10-stage goal is inconclusive.',
                'Mechanics demonstrations bypass reaction, gravity timing and presentation delays.',
                'Planner scoring omits the time-dependent lock bonus; campaign scoring uses actual game state.'],
        });
    }
    const mechanicsPassed = mechanicsFixtures.every((fixture) => fixture.status === 'pass') && cacheCollisionValidated;
    let status = mechanicsPassed ? 'pass' : 'fail';
    if (mechanicsPassed && profiles.some((profile) => profile.status !== 'pass')) status = 'inconclusive';
    return {
        version: 2,
        timed: false,
        kind: 'mechanics-and-strategy-validation',
        status,
        mechanics: {
            status: mechanicsPassed ? 'pass' : 'fail',
            fixtures: mechanicsFixtures,
            connectivityCacheCollision: {
                status: cacheCollisionValidated ? 'pass' : 'fail',
                meaning: 'Equal occupancy can yield different component outcomes; benchmark keys retain connectivity.',
            },
        },
        profiles,
        limitations: ['This is mechanics validation, not clock-faithful campaign or human challenge calibration.',
            'Passing shared physics fixtures does not establish a policy can construct arbitrary cascade objectives.'],
    };
}
