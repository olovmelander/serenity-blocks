import {
    describe, expect, it, vi,
} from 'vitest';
import {
    createMasteryObservation, evaluateMasteryMetrics, planMasteryObservation, searchMastery,
    normalizeMasterySearchOptions, MASTERY_SEARCH_DEFAULTS,
} from '../../scripts/odyssey-benchmark/mastery-search.mjs';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { VictoryConditionEvaluator } from '../../src/core/odyssey/VictoryConditionEvaluator.js';
import { fillBag, spawnPiece } from '../../src/core/game.js';
import * as levels from '../../src/core/odyssey/data/levels.js';
import * as boardEvaluator from '../../src/core/ai/board-evaluator.js';
import * as pathfinder from '../../src/core/ai/reachability-pathfinder.js';
import { SHAPES } from '../../src/core/constants.js';
import { findConnectedComponents } from '../../src/core/cascade-helpers.js';
import { createVirtualClock } from '../../scripts/odyssey-benchmark/virtual-clock.mjs';

function rulesFor(levelId) {
    const level = levels.getLevelById(levelId);
    return { victory: level.victory, stars: level.stars, victoryLapPolicy: level.victoryLapPolicy || 'none' };
}

function metrics(values = {}) {
    return { ...new VictoryConditionEvaluator().getMetrics(), ...values };
}

function initialObservation(levelId = 49) {
    const level = levels.getLevelById(levelId);
    const engine = new GameplayHybridEngine();
    engine.configure(level);
    const state = engine.createGameState({ rngSeed: 9101 });
    fillBag(state.nextPieces, state.randomGenerator);
    spawnPiece(state);
    return { level, engine, state };
}

describe('bounded Odyssey mastery search', () => {
    it('requires actual joint tier-three metrics but keeps independent optional bonuses separate', () => {
        const rules = rulesFor(55);
        const progress = metrics({
            score: 500000, cascades: 35, maxCascadeDepth: 18, maxCombo: 18, tetrises: 0,
        });
        const quality = evaluateMasteryMetrics(rules, progress);
        expect(quality.masteryUntimedConditionsMet).toBe(true);
        expect(quality.tierThreeUntimedConditionsMet).toBe(true);
        expect(quality.allBonusesUntimedConditionsMet).toBe(false);
        expect(quality.bonuses.find((bonus) => bonus.type === 'tetris-count').untimedConditionMet).toBe(false);
        expect(quality.timedStars).toBeNull();
        // Showcase completion may follow a top-out; these authored tiers do not require survival.
        expect(evaluateMasteryMetrics(rules, progress, { isGameOver: true }).masteryUntimedConditionsMet).toBe(true);
        expect(evaluateMasteryMetrics(rules, { ...progress, maxCombo: 17 }).masteryUntimedConditionsMet).toBe(false);
        expect(evaluateMasteryMetrics(rules, { ...progress, cascades: 34 }).masteryUntimedConditionsMet).toBe(false);
        const missing = evaluateMasteryMetrics(rules, { ...progress, maxCombo: 17 }).residualRequirements.tierThree;
        expect(missing.find((requirement) => requirement.key === 'combo'))
            .toMatchObject({ actual: 17, target: 18, remaining: 1 });
        expect(evaluateMasteryMetrics(rulesFor(49), metrics({ score: 35000 })).scoreFinishHeadroom).toBe(1000);
    });

    it('passes only an allowlisted observation and is invariant to hidden seed, bag and RNG changes', () => {
        const { level, engine, state } = initialObservation();
        const preparation = vi.spyOn(boardEvaluator, 'analyzeCascadePreparation');
        try {
            const beforeQueue = state.nextPieces.slice();
            const beforeBoard = structuredClone(state.boardGrid);
            Object.defineProperty(state, 'rngSeed', {
                configurable: true, get: () => { throw new Error('Hidden seed read'); },
            });
            Object.defineProperty(state, 'randomGenerator', {
                configurable: true, get: () => { throw new Error('Hidden RNG read'); },
            });
            const first = createMasteryObservation(state, engine.getMetrics(), level);
            state.nextPieces.splice(3, state.nextPieces.length - 3, 'I', 'I', 'I', 'I');
            const second = createMasteryObservation(state, { ...engine.getMetrics(), hiddenSeed: 42 }, level);
            expect(first).toEqual(second);
            expect(Object.keys(first).sort()).toEqual([
                'boardGrid', 'context', 'currentPiece', 'finish', 'lockedPieces',
                'metrics', 'preview', 'rules', 'spawn', 'timing',
            ]);
            const frozenInput = structuredClone(first);
            const config = {
                maxNodes: 450, maxNodesPerPlan: 450, beamWidth: 1, unknownTailDepth: 1,
            };
            Object.defineProperty(config, 'seed', {
                enumerable: true, get: () => { throw new Error('Seed option read'); },
            });
            Object.defineProperty(config, 'randomGenerator', {
                enumerable: true, get: () => { throw new Error('RNG option read'); },
            });
            expect(Object.keys(normalizeMasterySearchOptions(config))).toEqual(Object.keys(MASTERY_SEARCH_DEFAULTS));
            const a = planMasteryObservation(first, config);
            const b = planMasteryObservation(second, config);
            expect(a).toEqual(b);
            expect(first).toEqual(frozenInput);
            expect(state.boardGrid).toEqual(beforeBoard);
            expect(state.nextPieces.slice(0, 3)).toEqual(beforeQueue.slice(0, 3));
            expect(a.actions.at(-1)).toEqual({ type: 'hardDrop' });
            expect(a.diagnostics.visibleHorizon).toBe(4);
            expect(a.diagnostics.completeTailEvaluations).toBe(1);
            expect(a.diagnostics.surrogateWitness).toBe(false);
            expect(a.diagnostics.surrogateTail).toContain('not-bag-prediction');
            expect(a.prediction.metricsAfter.piecesPlaced).toBe(1);
            expect(a.diagnostics.nodes).toBeLessThanOrEqual(450);
            expect([...new Set(preparation.mock.calls.map((args) => args[1].length))].sort()).toEqual([0, 1, 2, 3]);
        } finally {
            preparation.mockRestore();
            delete state.randomGenerator;
            delete state.rngSeed;
            state.reset(); engine.reset();
        }
    });

    it('enforces exact preview scope and positive bounded search options', async () => {
        const { level, engine, state } = initialObservation();
        try {
            const observation = createMasteryObservation(state, engine.getMetrics(), level);
            expect(() => planMasteryObservation({ ...observation, preview: ['I', 'O'] })).toThrow(/exactly three/);
            expect(() => planMasteryObservation({ ...observation, preview: ['I', 'O', 'T', 'S'] }))
                .toThrow(/exactly three/);
            expect(() => planMasteryObservation(observation, { unknownTailDepth: 2 })).toThrow(/unknownTailDepth/);
            expect(() => planMasteryObservation(observation, { maxNodes: 0 })).toThrow(/maxNodes/);
            expect(() => planMasteryObservation(observation, { setupStrategy: 'unknown' })).toThrow(/setupStrategy/);
            await expect(searchMastery({ levelId: 49, seed: 9101, maxPieces: 1025 })).rejects.toThrow(/maxPieces/);
        } finally { state.reset(); engine.reset(); }
    });

    it('enforces a real CPU wall budget while the installed virtual gameplay clock is frozen', () => {
        const { level, engine, state } = initialObservation();
        const observation = createMasteryObservation(state, engine.getMetrics(), level);
        const clock = createVirtualClock().install();
        try {
            const result = planMasteryObservation(observation, {
                maxNodes: 64, maxNodesPerPlan: 64, wallBudgetMs: 0.000001,
            });
            expect(clock.now).toBe(0);
            expect(performance.now()).toBe(0);
            expect(result.diagnostics.stoppedByWall).toBe(true);
            expect(result.diagnostics.nodes).toBeLessThan(64);
        } finally { clock.restore(); state.reset(); engine.reset(); }
    });

    it('preserves acquired-primary history after the showcase deadline without qualifying time bonuses', () => {
        const rules = structuredClone(rulesFor(55));
        rules.victory.bonuses = [{ type: 'time', target: 480 }];
        rules.stars.three = { score: 500000, bonuses: 1 };
        const late = metrics({ score: 500000, time: 600 });
        expect(evaluateMasteryMetrics(rules, late).primaryReachedUntimed).toBe(false);
        const acquired = evaluateMasteryMetrics(rules, late, { primaryAcquired: true });
        expect(acquired.primaryReachedUntimed).toBe(true);
        expect(acquired.masteryUntimedConditionsMet).toBe(false);
        expect(acquired.bonuses[0].untimedConditionMet).toBeNull();
        expect(acquired.bonuses[0].timeUnvalidated).toBe(true);
    });

    it('keeps an observed grounded T-spin on an empty path and models the current piece age', () => {
        const { level, engine, state } = initialObservation();
        const piece = state.currentPiece;
        Object.assign(piece, {
            x: 3, y: 20, rotation: 0, shapeKey: 'T', shape: structuredClone(SHAPES.T),
        });
        for (let x = 0; x < 10; x++) {
            if (x < 3 || x > 5) state.boardGrid[21][x] = { id: `floor:${x}` };
        }
        for (const [x, y] of [[3, 20], [5, 20], [3, 22], [5, 22]]) state.boardGrid[y][x] = { id: `${x}:${y}` };
        state.lockedPieces = findConnectedComponents(state.boardGrid);
        state.lastMoveWasRotation = true;
        state.simTimeMs = 400;
        state.pieceSpawnTime = 0;
        const placements = vi.spyOn(pathfinder, 'findReachablePlacements').mockImplementation(() => [{
            ...structuredClone(piece), actions: [], pathCost: 0,
        }]);
        try {
            const observation = createMasteryObservation(state, engine.getMetrics(), level, { actionIntervalMs: 100 });
            const plan = planMasteryObservation(observation, { maxNodes: 1, maxNodesPerPlan: 1 });
            expect(plan.actions).toEqual([{ type: 'hardDrop' }]);
            expect(plan.prediction.tSpin).toBe(true);
            expect(plan.prediction.b2bActiveAfter).toBe(true);
            expect(plan.prediction.lockBonus).toBe(38);
            observation.timing.lastMoveWasRotation = false;
            const unrotated = planMasteryObservation(observation, { maxNodes: 1, maxNodesPerPlan: 1 });
            expect(unrotated.prediction.tSpin).toBe(false);
        } finally { placements.mockRestore(); state.reset(); engine.reset(); }
    });

    it('shares the total node budget across all requested pieces and returns the legal partial trace', async () => {
        const progress = [];
        const candidate = await searchMastery({
            levelId: 49,
            seed: 9101,
            maxPieces: 3,
            maxNodes: 17,
            maxNodesPerPlan: 17,
            unknownTailDepth: 0,
            setupStrategy: 'structural-v1',
            onProgress: (entry) => progress.push(entry),
        });
        expect(candidate.status).toBe('inconclusive');
        expect(candidate.termination).toBe('piece-budget');
        expect(candidate.traceValid).toBe(true);
        expect(candidate.piecesPlaced).toBe(3);
        expect(candidate.compute.nodes).toBe(17);
        expect(candidate.compute.predictionMismatches).toBe(0);
        expect(candidate.trace.map((entry) => entry.planning.nodeBudget)).toEqual([5, 6, 6]);
        expect(progress.map((entry) => entry.step)).toEqual([1, 2, 3]);
        expect(candidate.trace.every((entry) => entry.preview.length === 3
            && entry.lockedPiece.cells === 4 && entry.completed
            && entry.actions.every((action) => action.accepted || action.legalStop)
            && entry.cellConservation.actual === entry.cellConservation.expected)).toBe(true);
    });

    it('stops an ordinary orb after the first primary-winning lock even when mastery is missing', async () => {
        const level = structuredClone(levels.getLevelById(49));
        level.victory.primary.target = 50;
        level.stars.three.score = 50;
        const lookup = vi.spyOn(levels, 'getLevelById').mockReturnValue(level);
        try {
            const candidate = await searchMastery({
                levelId: 49, seed: 9101, maxPieces: 5, maxNodes: 200, unknownTailDepth: 0,
            });
            expect(candidate.termination).toBe('primary-before-mastery');
            expect(candidate.piecesPlaced).toBe(1);
            expect(candidate.metrics.score).toBe(50);
            expect(candidate.primaryReachedAtPiece).toBe(1);
            expect(candidate.quality.masteryUntimedConditionsMet).toBe(false);
            expect(candidate.trace).toHaveLength(1);
        } finally { lookup.mockRestore(); }
    });

    it('does not require unrelated optional bonuses before retaining a tier-three candidate', async () => {
        const level = structuredClone(levels.getLevelById(55));
        level.victory.primary.target = 50;
        level.stars.three = { score: 50 };
        const lookup = vi.spyOn(levels, 'getLevelById').mockReturnValue(level);
        try {
            const candidate = await searchMastery({
                levelId: 55, seed: 9101, maxPieces: 5, maxNodes: 200, unknownTailDepth: 0,
            });
            expect(candidate.termination).toBe('untimed-tier-three-met');
            expect(candidate.status).toBe('candidate');
            expect(candidate.piecesPlaced).toBe(1);
            expect(candidate.quality.masteryUntimedConditionsMet).toBe(true);
            expect(candidate.quality.allBonusesUntimedConditionsMet).toBe(false);
            expect(candidate.quality.timedStars).toBeNull();
        } finally { lookup.mockRestore(); }
    });

    it('rejects recovered physics failures even after a legal cell-conserving clear', async () => {
        const original = GameplayHybridEngine.prototype.buildPhysicsCallbacks;
        const callbacks = vi.spyOn(GameplayHybridEngine.prototype, 'buildPhysicsCallbacks')
            .mockImplementation(function failingCompletion(base) {
                return {
                    ...original.call(this, base),
                    onCascadeComplete: () => { throw new Error('Injected post-clear failure'); },
                };
            });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const candidate = await searchMastery({
                levelId: 55,
                seed: 9101,
                maxPieces: 10,
                maxNodes: 12500,
                maxNodesPerPlan: 1250,
                wallBudgetMs: 30000,
            });
            expect(candidate.termination).toBe('physics-error');
            expect(candidate.traceValid).toBe(false);
            expect(candidate.status).toBe('inconclusive');
            expect(candidate.error).toContain('Injected post-clear failure');
            expect(candidate.trace.at(-1).lineClears.length).toBeGreaterThan(0);
            const cells = candidate.trace.at(-1).cellConservation;
            expect(cells.actual).toBe(cells.expected);
            expect(console.error).toBe(errors);
        } finally { callbacks.mockRestore(); errors.mockRestore(); }
    }, 30000);
});
