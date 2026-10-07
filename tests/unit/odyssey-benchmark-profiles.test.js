import {
    describe, expect, it, vi,
} from 'vitest';
import {
    BENCHMARK_CADENCES, BENCHMARK_PROFILES, connectivityBoardKey, createBenchmarkBot, restrictBotPreview,
} from '../../scripts/odyssey-benchmark/profiles.mjs';
import {
    CASCADE_CAPABILITY_FIXTURES, demonstrateConstruction, getConstructionDepthTargets, validateCapabilities,
} from '../../scripts/odyssey-benchmark/capabilities.mjs';
import {
    GameState, hardDrop, move, rotate, softDrop, spawnPiece,
} from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';

function preparedState() {
    const state = new GameState();
    state.disableLevelProgression = true;
    const fixture = CASCADE_CAPABILITY_FIXTURES[0];
    state.lockedPieces = fixture.pieces(state.boardGrid.length - 1);
    rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
    state.nextPieces = ['I', 'O', 'T', 'J', 'Z', 'S', 'L'];
    spawnPiece(state);
    return state;
}

describe('benchmark-only bot profiles', () => {
    it('caps planning knowledge without consuming, trimming or replacing the real bag', () => {
        const state = { nextPieces: ['I', 'O', 'T', 'S', 'Z', 'J'] };
        const bag = state.nextPieces;
        const originalPlan = vi.fn(function inspect() { return this.playerState.nextPieces; });
        const bot = restrictBotPreview({ playerState: state, plan: originalPlan });
        expect(bot.plan()).toEqual(['I', 'O', 'T']);
        expect(bot.playerState).toBe(state);
        expect(state.nextPieces).toBe(bag);
        expect(state.nextPieces).toHaveLength(6);
        originalPlan.mockImplementation(() => { throw new Error('failed search'); });
        expect(() => bot.plan()).toThrow('failed search');
        expect(bot.playerState).toBe(state);
        expect(state.nextPieces).toBe(bag);
    });

    it('defines bounded and distinct strategy/execution profiles with no latent filler probes', () => {
        const state = preparedState();
        try {
            const bots = BENCHMARK_PROFILES.map(({ id }) => createBenchmarkBot({
                gameState: state, actions: {}, profileId: id, decisionSeed: 19,
            }));
            expect(bots.slice(0, 4).map((bot) => bot.config.lookaheadDepth)).toEqual([0, 1, 2, 2]);
            expect(bots.slice(0, 4).map((bot) => bot.config.actionIntervalMs)).toEqual([150, 90, 65, 100]);
            expect(bots.every((bot) => bot.config.latentChainEval === false)).toBe(true);
            expect(bots.every((bot) => bot.scheduler.config === bot.config)).toBe(true);
            expect(() => createBenchmarkBot({ gameState: state, actions: {}, profileId: 'unknown' })).toThrow();
        } finally { state.reset(); }
    });

    it('varies pace independently of strategy, search budget and mistakes', () => {
        const state = preparedState();
        try {
            expect(BENCHMARK_CADENCES.map(({ id }) => id)).toEqual(['native', 'steady', 'deliberate']);
            for (const cadenceId of ['steady', 'deliberate']) {
                const bots = BENCHMARK_PROFILES.map(({ id }) => createBenchmarkBot({
                    gameState: state, actions: {}, profileId: id, cadenceId, decisionSeed: 19,
                }));
                expect(new Set(bots.map((bot) => bot.config.actionIntervalMs)).size).toBe(1);
                expect(bots.slice(0, 4).map((bot) => bot.config.lookaheadDepth)).toEqual([0, 1, 2, 2]);
                expect(bots.slice(0, 4).map((bot) => bot.config.mistakeChance)).toEqual([0.04, 0.01, 0, 0]);
                expect(bots.map((bot) => bot.decisionStream.getState())).toEqual(
                    Array(bots.length).fill(bots[0].decisionStream.getState()),
                );
            }
            expect(() => createBenchmarkBot({
                gameState: state, actions: {}, profileId: 'expert', cadenceId: 'fast',
            }))
                .toThrow('Unknown benchmark cadence');
        } finally { state.reset(); }
    });

    it('discards a rejected path and replans from the real pose on a later input slot', () => {
        const state = preparedState();
        const hardDropAction = vi.fn(() => true);
        const moveAction = vi.fn()
            .mockImplementationOnce(() => { softDrop(state, null, null); return false; })
            .mockImplementation(() => move(state, -1));
        const bot = createBenchmarkBot({
            gameState: state,
            profileId: 'expert',
            cadenceId: 'steady',
            decisionSeed: 21,
            actions: { moveLeft: moveAction, hardDrop: hardDropAction },
        });
        const plannedPoses = [];
        vi.spyOn(bot, 'plan').mockImplementation(() => {
            plannedPoses.push({ x: state.currentPiece.x, y: state.currentPiece.y });
            return { actions: [{ type: 'move', dir: -1 }, { type: 'hardDrop' }] };
        });
        try {
            bot.update(16, 0);
            bot.update(200, 200);
            expect(bot.replanCount).toBe(1);
            expect(bot.scheduler.queue).toEqual([]);
            expect(bot.lastPlan).toBeNull();
            expect(hardDropAction).not.toHaveBeenCalled();
            bot.update(99, 299);
            expect(bot.plan).toHaveBeenCalledTimes(1);
            bot.update(1, 300);
            expect(bot.plan).toHaveBeenCalledTimes(2);
            expect(plannedPoses[1].y).toBe(plannedPoses[0].y + 1);
            expect(moveAction).toHaveBeenCalledTimes(2);
            expect(hardDropAction).not.toHaveBeenCalled();
        } finally { state.reset(); }
    });

    it('reads only the supplied visible garbage meter for the survival gate', () => {
        const state = preparedState();
        let pending = 0;
        const bot = createBenchmarkBot({
            gameState: state, actions: {}, profileId: 'cascade', getPendingGarbage: () => pending,
        });
        try {
            expect(bot.getPendingGarbage()).toBe(0);
            pending = 20;
            expect(bot.assessTactics(state.boardGrid, { sideLanes: [] }).danger).toBe(true);
            expect(state.pendingGarbage).toBeUndefined();
            pending = -10;
            expect(bot.getPendingGarbage()).toBe(0);
            pending = NaN;
            expect(bot.getPendingGarbage()).toBe(0);
        } finally { state.reset(); }
    });

    it('treats a grounded soft-drop stop as legal and keeps the following hard drop', () => {
        const state = preparedState();
        while (softDrop(state, null, null)) { /* Reach the real collision boundary. */ }
        const bot = createBenchmarkBot({
            gameState: state,
            profileId: 'expert',
            cadenceId: 'steady',
            actions: { softDrop: () => softDrop(state, null, null), hardDrop: () => true },
        });
        vi.spyOn(bot, 'plan').mockReturnValue({ actions: [{ type: 'softDrop' }, { type: 'hardDrop' }] });
        try {
            bot.update(16, 0);
            bot.update(200, 200);
            expect(bot.replanCount).toBe(0);
            expect(bot.lastPlan).not.toBeNull();
            expect(bot.scheduler.queue).toEqual([{ type: 'hardDrop' }]);
        } finally { state.reset(); }
    });

    it('bounds gravity/kick replanning and commits one later actual-pose drop through the live gates', async () => {
        const state = new GameState({ hitStopEnabled: false });
        state.isSeeking = true;
        state.nextPieces = ['S', 'O', 'I', 'T'];
        spawnPiece(state);
        state.currentPiece.x = 0;
        let now = 0;
        const performed = [];
        const realAction = (type, action) => () => {
            const accepted = action();
            performed.push({ type, at: now, accepted });
            return accepted;
        };
        const bot = createBenchmarkBot({
            gameState: state,
            profileId: 'expert',
            cadenceId: 'steady',
            decisionSeed: 44,
            actions: {
                rotateRight: realAction('rotate', () => rotate(state, 'right')),
                moveLeft: realAction('move', () => move(state, -1)),
                hardDrop: realAction('drop', () => hardDrop(state, null, { spawnPiece: () => spawnPiece(state) })),
            },
        });
        vi.spyOn(bot, 'plan').mockImplementation(() => ({
            actions: [
                { type: 'rotate', dir: 'right' }, ...Array(10).fill({ type: 'move', dir: -1 }), { type: 'hardDrop' },
            ],
        }));
        try {
            bot.update(16, now);
            for (let tick = 0; tick < 30 && !bot.fallbackPending; tick++) {
                now += 100;
                bot.update(100, now);
                // Competing real downward movement changes the pose between queued inputs.
                softDrop(state, null, null);
            }
            expect(bot.fallbackPending).toBe(true);
            expect(bot.pieceRetryCount).toBe(3);
            expect(bot.maxPieceRetries).toBe(3);
            expect(bot.replanCount).toBe(3);
            expect(bot.plan).toHaveBeenCalledTimes(3);
            expect(performed.filter((action) => action.type === 'drop')).toHaveLength(0);
            expect(bot.scheduler.queue).toEqual([]);
            const beforeFallback = performed.length;
            now += 99;
            bot.update(99, now);
            expect(performed).toHaveLength(beforeFallback);
            now += 1;
            for (const flag of ['isPaused', 'isProcessingPhysics', 'hitStopRemaining']) {
                state[flag] = flag === 'hitStopRemaining' ? 30 : true;
                bot.update(100, now);
                expect(performed).toHaveLength(beforeFallback);
                expect(bot.fallbackPending).toBe(true);
                state[flag] = flag === 'hitStopRemaining' ? 0 : false;
            }
            const actualPose = { x: state.currentPiece.x, rotation: state.currentPiece.rotation };
            bot.update(1, now);
            expect(bot.fallbackDrops).toBe(1);
            expect(performed.at(-1)).toMatchObject({ type: 'drop', at: now, accepted: true });
            expect(new Set(performed.map((action) => action.at)).size).toBe(performed.length);
            expect(state.lockedPieces.at(-1)).toMatchObject(actualPose);
            await state.latestPhysicsPromise;
            now += 100;
            bot.update(100, now);
            expect(bot.pieceRetryCount).toBe(0);
            expect(bot.fallbackPending).toBe(false);
            expect(bot.fallbackDrops).toBe(1);
            bot.reset();
            expect(bot.pieceRetryCount).toBe(0);
            expect(bot.retrySpawnToken).toBeNull();
            expect(bot.replanCount).toBe(3);
        } finally { await state.latestPhysicsPromise; state.reset(); }
    });

    it('executes a real Quad through an open edge well without a single', async () => {
        const state = new GameState({ hitStopEnabled: false });
        state.isSeeking = true;
        const bottom = state.boardGrid.length - 1;
        state.lockedPieces = Array.from({ length: 4 }, (_, index) => ({
            x: 0, y: bottom - index, shape: [Array(9).fill(1)], pieceId: `quad-row:${index}`, color: 'I',
        }));
        rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
        state.nextPieces = ['I', 'O', 'T', 'J'];
        spawnPiece(state);
        const onLineClear = vi.fn();
        const bot = createBenchmarkBot({
            gameState: state,
            profileId: 'quad',
            decisionSeed: 44,
            levelConfig: { victory: { primary: { type: 'tetrises', target: 1 }, bonuses: [{ type: 'no-singles' }] } },
            getMetrics: () => ({ tetrises: 0, singles: 0 }),
            actions: {
                moveRight: () => move(state, 1),
                moveLeft: () => move(state, -1),
                rotateRight: () => rotate(state, 'right'),
                rotateLeft: () => rotate(state, 'left'),
                rotateFlip: () => rotate(state, 'flip'),
                softDrop: () => softDrop(state, null, null),
                hardDrop: () => hardDrop(state, null, { onLineClear }),
            },
        });
        try {
            const plan = bot.plan();
            expect(plan.candidate.waves.map(({ lineCount }) => lineCount)).toEqual([4]);
            expect(plan.candidate.metricsAfter.singles).toBe(0);
            // Execute the reachability proof with the same synchronous core action API.
            for (const action of plan.actions) expect(bot.scheduler.perform(action)).toBe(true);
            await state.latestPhysicsPromise;
            expect(state.lines).toBe(4);
            expect(onLineClear.mock.calls.map(([lines]) => lines)).toEqual([4]);
        } finally { state.reset(); }
    });

    it('preserves a viable no-singles bonus rather than cashing in a safe single for primary completion', () => {
        const state = new GameState();
        const bottom = state.boardGrid.length - 1;
        state.lockedPieces = [{
            x: 0, y: bottom, shape: [Array(8).fill(1)], pieceId: 'safe-single-row', color: 'I',
        }];
        rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
        state.nextPieces = ['O', 'I', 'T', 'J'];
        spawnPiece(state);
        const bot = createBenchmarkBot({
            gameState: state,
            actions: {},
            profileId: 'quad',
            decisionSeed: 42,
            levelConfig: { victory: { primary: { type: 'lines', target: 1 }, bonuses: [{ type: 'no-singles' }] } },
            getMetrics: () => ({ singles: 0 }),
        });
        try {
            expect(findReachablePlacements(state).some((placement) => placement.x === 8)).toBe(true);
            const plan = bot.plan();
            expect(plan.candidate.metricsAfter.singles).toBe(0);
            expect(plan.candidate.totalLines).toBe(0);
        } finally { state.reset(); }
    });

    it('repeats seeded decisions and cannot see bag entries beyond the third preview', () => {
        const a = preparedState();
        const b = preparedState();
        b.nextPieces.splice(3, 3, 'I', 'I', 'I');
        const bagA = a.nextPieces.slice();
        const bagB = b.nextPieces.slice();
        a.randomGenerator = vi.fn(() => 0.3);
        b.randomGenerator = vi.fn(() => 0.8);
        try {
            const make = (state) => createBenchmarkBot({
                gameState: state,
                actions: {},
                profileId: 'expert',
                decisionSeed: 91,
                levelConfig: { victory: { primary: { type: 'cascade', target: 1 } } },
            });
            const first = make(a);
            const second = make(b);
            const planA = first.plan();
            const planB = second.plan();
            expect(planA.actions).toEqual(planB.actions);
            expect(planA.score).toBe(planB.score);
            expect(first.decisionStream.getState()).toEqual(second.decisionStream.getState());
            expect(planA.candidate.nextShapeKeys).toHaveLength(3);
            expect(planA.candidate.evaluation.metrics.latentDischarge).toBeNull();
            expect(a.nextPieces).toEqual(bagA);
            expect(b.nextPieces).toEqual(bagB);
            expect(a.randomGenerator).not.toHaveBeenCalled();
            expect(b.randomGenerator).not.toHaveBeenCalled();
        } finally { a.reset(); b.reset(); }
    });

    it('keeps connectivity in cache keys while normalizing incidental id names', () => {
        expect(connectivityBoardKey([[{ id: 'a' }, { id: 'a' }]]))
            .toBe(connectivityBoardKey([[{ id: 7 }, { id: 7 }]]));
        expect(connectivityBoardKey([[{ id: 'a' }, { id: 'a' }]]))
            .not.toBe(connectivityBoardKey([[{ id: 'a' }, { id: 'b' }]]));
    });

    it('uses real per-wave scoring, level and Odyssey multiplier metadata', () => {
        const state = preparedState();
        state.level = 7;
        state.comboMultiplierEnabled = true;
        state.comboMultiplier = 2;
        const bot = createBenchmarkBot({
            gameState: state, actions: {}, profileId: 'cascade', decisionSeed: 2,
        });
        try {
            const bottom = state.boardGrid.length - 1;
            const placement = findReachablePlacements(state).find((candidate) => candidate.x === 0
                && candidate.y === bottom - 1 && candidate.rotation === 0);
            const [candidate] = bot.evaluatePlacements(state, [placement]);
            const expected = resolveCascade([...state.lockedPieces, {
                ...placement, pieceId: 'check', color: 'I',
            }], {
                level: 7,
                lines: 0,
                linesUntilNextLevel: 15,
                dropInterval: state.dropInterval,
                disableLevelProgression: true,
                comboMultiplierEnabled: true,
                comboMultiplier: 2,
            });
            expect(candidate.projectedScore).toBe(expected.scoreDelta);
            expect(candidate.waves.map((wave) => wave.score)).toEqual(expected.waves.map((wave) => wave.points));
            expect(candidate.totalLines).toBe(2);
            expect(candidate.metricsAfter.cascades).toBe(1);
            expect(candidate.metricsAfter.maxCombo).toBe(2);
            expect(Number.isFinite(bot.rank([candidate])[0].evaluation.score)).toBe(true);
        } finally { state.reset(); }
    });

    it('distinguishes cascade sequences from depth when rewarding actual remaining orb progress', () => {
        const state = preparedState();
        const bot = createBenchmarkBot({
            gameState: state,
            actions: {},
            profileId: 'expert',
            decisionSeed: 5,
            levelConfig: { victory: { primary: { type: 'cascade', target: 3 } } },
            getMetrics: () => ({ cascades: 1, time: 10 }),
        });
        try {
            expect(bot.currentMetrics().cascades).toBe(1);
            expect(bot.objectiveUtility({
                metricsBefore: { cascades: 1 },
                metricsAfter: { cascades: 2 },
                pathCost: 0,
            })).toBe(900);
            bot.levelConfig.victory = {
                primary: { type: 'combo', target: 4 },
                bonuses: [{ type: 'no-singles' }],
            };
            expect(bot.objectiveUtility({
                metricsBefore: { maxCombo: 2, singles: 0 },
                metricsAfter: { maxCombo: 4, singles: 1 },
                pathCost: 0,
            })).toBe(1580);
        } finally { state.reset(); }
    });
});

describe('measured benchmark capability gates', () => {
    it('covers the effective authored chain requirements, including twelve and eighteen waves', () => {
        expect(getConstructionDepthTargets()).toEqual([3, 4, 5, 6, 7, 8, 10, 12, 15, 18]);
    });

    it('constructs and replays a deeper chain using only real seeded tetromino actions', async () => {
        const demonstration = await demonstrateConstruction({ profileId: 'expert', seed: 1001, maxPieces: 16 });
        expect(demonstration.kind).toBe('empty-board-construction');
        expect(demonstration.status).toBe('pass');
        expect(demonstration.maximumDepth).toBe(3);
        expect(demonstration.insertedCells).toBe(0);
        expect(demonstration.allTetrominoes).toBe(true);
        expect(demonstration.rejectedActions).toBe(0);
        // The live cascade callback reports multi-wave sequences; a lone clear has depth zero in these metrics.
        expect(demonstration.trace.every((step) => (step.predictedDepth >= 2 ? step.predictedDepth : 0)
            === step.maximumDepth)).toBe(true);
        expect(demonstration.preparedReplay).toMatchObject({
            kind: 'prepared-from-legal-construction',
            sourceConstructionId: demonstration.id,
            status: 'pass',
            maximumDepth: 3,
            rejectedActions: 0,
        });
        expect(() => JSON.stringify(demonstration)).not.toThrow();
    }, 30000);

    it('validates reachable canonical/legacy outcomes and bounded two-wave strategy claims', async () => {
        const result = await validateCapabilities({ constructionSeeds: [1001], constructionMaxPieces: 8 });
        expect(result.timed).toBe(false);
        expect(result.mechanics.status).toBe('pass');
        expect(result.mechanics.fixtures).toHaveLength(6);
        expect(result.mechanics.fixtures.every((fixture) => fixture.reachable && fixture.canonicalMatches)).toBe(true);
        expect(result.mechanics.connectivityCacheCollision.status).toBe('pass');
        expect(result.mechanics.fixtures.find((fixture) => fixture.id === 'odyssey-score-modifier')
            .aiSimulator.scoreProjection.matches).toBe(false);
        expect(result.profiles.map((profile) => profile.profileId)).toEqual(['stacker', 'cascade', 'expert', 'quad']);
        expect(result.profiles.every((profile) => profile.validatedMaxCascadeDepth <= 2)).toBe(true);
        expect(result.profiles.find((profile) => profile.profileId === 'cascade').status).toBe('pass');
        expect(result.profiles.every((profile) => profile.limitations.some(
            (text) => text.includes('authored effective wave requirements'),
        ))).toBe(true);
        for (const profile of result.profiles) {
            expect(profile.construction.kind).toBe('empty-board-construction');
            expect(profile.construction.timed).toBe(false);
            expect(profile.construction.targets.map(({ targetDepth }) => targetDepth))
                .toEqual(getConstructionDepthTargets());
            expect(profile.construction.targets.every(({ status }) => status === 'inconclusive')).toBe(true);
            expect(profile.construction.demonstrations).toHaveLength(2);
            for (const demo of profile.construction.demonstrations) {
                expect(demo.insertedCells).toBe(0);
                expect(demo.previewLimit).toBe(3);
                expect(demo.allTetrominoes).toBe(true);
                expect(demo.rejectedActions).toBe(0);
                expect(demo.trace.length).toBeLessThanOrEqual(8);
                expect(demo.trace.every((step) => step.preview.length === 3
                    && step.actions.at(-1).type === 'hardDrop')).toBe(true);
            }
        }
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }, 30000);

    it('separates authored mastery and extends the empty-board stopping target to its requirement', async () => {
        const result = await validateCapabilities({
            profileIds: ['stacker'],
            constructionSeeds: [1001],
            constructionMaxPieces: 1,
            constructionLevelIds: [55, 59],
        });
        expect(result.mechanics.status).toBe('pass');
        expect(result.profiles[0].construction.demonstrations.every((demo) => demo.targetDepth === 18)).toBe(true);
        expect(result.authoredConstruction).toMatchObject({ timed: false, kind: 'authored-board-construction' });
        expect(result.authoredConstruction.demonstrations.map((demo) => [demo.levelId, demo.maximumDepth,
            demo.requirements.maximumEffectiveChainDepth])).toEqual([[55, 0, 18], [59, 0, 12]]);
        expect(result.authoredConstruction.demonstrations.every((demo) => demo.status === 'inconclusive')).toBe(true);
    }, 30000);
});
