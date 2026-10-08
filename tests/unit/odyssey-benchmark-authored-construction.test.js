/* eslint-disable no-await-in-loop -- Replay each real lock and its full cascade before issuing the next piece. */
import { createHash } from 'node:crypto';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    demonstrateAuthoredConstruction, getMasteryRequirements,
} from '../../scripts/odyssey-benchmark/authored-construction.mjs';
import { BenchmarkBot, connectivityBoardKey } from '../../scripts/odyssey-benchmark/profiles.mjs';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { LEVEL_CONFIGS, getLevelById } from '../../src/core/odyssey/data/levels.js';
import {
    fillBag, spawnPiece, move, rotate, softDrop, hardDrop,
} from '../../src/core/game.js';
import { calculateBuildHeight, checkInfinityGameOver } from '../../src/core/infinity-grid.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const hash = (state) => createHash('sha256').update(connectivityBoardKey(state.boardGrid)).digest('hex');

function makeEngine(levelId, seed) {
    const engine = new GameplayHybridEngine();
    engine.configure(getLevelById(levelId));
    engine.createGameState({ rngSeed: seed });
    engine.gameState.isSeeking = true;
    if (engine.gameState.isInfinityMode) {
        engine.victoryEvaluator.updateHeight(calculateBuildHeight(engine.gameState));
    }
    return engine;
}

async function replay(record) {
    const engine = makeEngine(record.levelId, record.seed);
    const state = engine.gameState;
    const callbacks = engine.buildPhysicsCallbacks({});
    try {
        expect(hash(state)).toBe(record.initialBoardHash);
        fillBag(state.nextPieces, state.randomGenerator);
        for (const entry of record.trace) {
            spawnPiece(state, null, () => { state.isGameOver = true; });
            expect(state.isGameOver).toBe(false);
            expect(state.currentPiece.shapeKey).toBe(entry.shapeKey);
            expect(state.currentPiece.shape.flat().filter(Boolean)).toHaveLength(4);
            expect(state.nextPieces.slice(0, 3)).toEqual(entry.preview);
            expect(hash(state)).toBe(entry.boardHashBefore);
            for (const action of entry.actions) {
                let accepted;
                if (action.type === 'move') accepted = move(state, action.dir);
                else if (action.type === 'rotate') accepted = rotate(state, action.dir);
                else if (action.type === 'softDrop') accepted = softDrop(state, null, callbacks);
                else if (action.type === 'hardDrop') accepted = hardDrop(state, null, callbacks);
                else throw new Error(`Unexpected action ${action.type}`);
                expect(accepted).toBe(action.accepted);
                if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
            }
            engine.updateScore(state.score);
            if (state.isInfinityMode) engine.victoryEvaluator.updateHeight(calculateBuildHeight(state));
            expect(state.currentPiece).toBeNull();
            expect(state.isProcessingPhysics).toBe(false);
            expect(hash(state)).toBe(entry.boardHashAfter);
            expect(engine.getMetrics()).toEqual(entry.metricsAfter);
        }
        expect({ ...engine.getMetrics(), time: null }).toEqual(record.metrics);
    } finally { state.reset(); engine.reset(); }
}

describe('Authored construction requirements', () => {
    it('records exact combo/depth targets of 18, 12 and 8 without changing the authored configs', () => {
        const before = structuredClone(LEVEL_CONFIGS);
        const singingBowl = getMasteryRequirements(getLevelById(56));
        const neonDistrict = getMasteryRequirements(getLevelById(60));
        const fortyNine = getMasteryRequirements(getLevelById(49));
        expect(singingBowl.stars.three).toMatchObject({
            comboTarget: 18, maxCascadeDepthTarget: 10, effectiveChainDepth: 18,
        });
        expect(singingBowl.stars.two.effectiveChainDepth).toBe(6);
        expect(singingBowl.bonuses.map((bonus) => bonus.effectiveChainDepth)).toEqual([10, 0, 0, 18]);
        expect(neonDistrict.stars.three).toMatchObject({
            comboTarget: 12, maxCascadeDepthTarget: 7, effectiveChainDepth: 12,
        });
        expect(neonDistrict.stars.two.effectiveChainDepth).toBe(10);
        expect(fortyNine.stars.three.effectiveChainDepth).toBe(8);
        expect([singingBowl, neonDistrict, fortyNine].map((entry) => entry.maximumEffectiveChainDepth)).toEqual([18, 12, 8]);
        expect(singingBowl.primary.timeConstraints).toEqual([{ type: 'primary-acquisition-deadline', seconds: 480 }]);
        expect(neonDistrict.primary.timeConstraints).toEqual([{ type: 'primary-acquisition-deadline', seconds: 210 }]);
        expect(singingBowl.finishPolicy).toMatchObject({
            authored: 'showcase', stopAfterPrimaryResolution: false, drainEntireCascade: true,
        });
        expect(fortyNine.finishPolicy.stopAfterPrimaryResolution).toBe(true);
        expect(getMasteryRequirements(getLevelById(1)).stars.three.timeConstraints)
            .toEqual([{ type: 'completion-upper-bound', seconds: 120 }]);
        expect(LEVEL_CONFIGS).toEqual(before);
    });

    it.each([0, -1, 129, 1.5, Infinity, NaN])('rejects invalid piece budget %s', async (maxPieces) => {
        await expect(demonstrateAuthoredConstruction({
            levelId: 56, profileId: 'stacker', seed: 1, maxPieces,
        }))
            .rejects.toThrow(/integer from 1 to 128/);
    });

    it('rejects a missing seed, unknown orb/policy, and unsupported duel context', async () => {
        await expect(demonstrateAuthoredConstruction({ levelId: 56, profileId: 'stacker', maxPieces: 1 }))
            .rejects.toThrow(/uint32/);
        await expect(demonstrateAuthoredConstruction({
            levelId: 61, profileId: 'stacker', seed: 1, maxPieces: 1,
        }))
            .rejects.toThrow(/Unknown Odyssey/);
        await expect(demonstrateAuthoredConstruction({
            levelId: 56, profileId: 'unknown', seed: 1, maxPieces: 1,
        }))
            .rejects.toThrow(/Unknown benchmark profile/);
        await expect(demonstrateAuthoredConstruction({
            levelId: 59, profileId: 'stacker', seed: 1, maxPieces: 1,
        }))
            .rejects.toThrow(/supports solo orbs/);
    });
});

describe('Legal construction on authored boards', () => {
    function legalLeftStack() {
        const placement = findReachablePlacements(this.playerState).sort((a, b) => a.x - b.x || a.y - b.y)[0];
        return placement ? { actions: [...placement.actions, { type: 'hardDrop' }], candidate: placement } : null;
    }

    it.each([56, 60])('preserves orb %i authored rules with three visible previews', async (levelId) => {
        const before = structuredClone(getLevelById(levelId));
        const originEngine = makeEngine(levelId, 42);
        const originState = originEngine.gameState;
        const originalPlan = BenchmarkBot.prototype.plan;
        let plans = 0;
        vi.spyOn(BenchmarkBot.prototype, 'plan').mockImplementation(function plan(...args) {
            expect(this.playerState.nextPieces).toHaveLength(3);
            plans++;
            return originalPlan.apply(this, args);
        });
        try {
            const result = await demonstrateAuthoredConstruction({
                levelId, profileId: 'cascade', seed: 42, maxPieces: 3,
            });
            expect(result).toMatchObject({
                kind: 'authored-board-construction',
                levelId,
                profileId: 'cascade',
                seed: 42,
                timed: false,
                piecesPlaced: 3,
                pieceBudget: 3,
                rejectedActions: 0,
                allTetrominoes: true,
                addedCellsAfterStart: 0,
                traceValid: true,
                traceComplete: true,
                status: 'inconclusive',
                termination: 'piece-budget',
                primaryReachedAtPiece: null,
                quality: { timedStars: null, allUntimedRequirementsMet: false },
            });
            expect(result.metrics.time).toBeNull();
            expect(result.initialBoardHash).toBe(hash(originState));
            expect(result.initialBoard.lockedPieces).toEqual(originState.lockedPieces);
            expect(result.initialBoard).toMatchObject({
                rows: originState.boardGrid.length,
                occupiedCells: originState.boardGrid.flat().filter(Boolean).length,
            });
            expect(result.authoredState).toMatchObject({
                mechanics: before.mechanics,
                modifiers: before.modifiers,
                scoringLevel: originState.level,
                comboMultiplierEnabled: true,
                levelProgression: !originState.disableLevelProgression,
            });
            expect(result.trace).toHaveLength(plans);
            expect(result.trace.every((entry) => entry.preview.length === 3
                && entry.lockedPiece.cells === 4)).toBe(true);
            expect(result.trace.flatMap((entry) => entry.actions).every((action) => action.accepted)).toBe(true);
            expect(result.trace.every((entry) => entry.cellConservation.expected
                === entry.cellConservation.actual)).toBe(true);
            expect(result).not.toHaveProperty('preparedReplay');
            expect(result).not.toHaveProperty('stars');
            await replay(result);
            expect(getLevelById(levelId)).toEqual(before);
        } finally { originState.reset(); originEngine.reset(); }
    });

    it('drains orb 49 terminal cascades and stops at the actual primary before another piece', async () => {
        const result = await demonstrateAuthoredConstruction({
            levelId: 49, profileId: 'cascade', seed: 42, maxPieces: 128,
        });
        expect(result.termination).toBe('primary-complete');
        expect(result.primaryReachedAtPiece).toBe(result.piecesPlaced);
        expect(result.piecesPlaced).toBeLessThan(128);
        const last = result.trace.at(-1);
        expect(last.completed).toBe(true);
        expect(last.lineClears.length).toBeGreaterThan(1);
        expect(last.metricsBefore.score).toBeLessThan(getLevelById(49).victory.primary.target);
        expect(last.metricsAfter.score).toBeGreaterThanOrEqual(getLevelById(49).victory.primary.target);
        const tracedLines = result.trace.flatMap((entry) => entry.lineClears).reduce((sum, lines) => sum + lines, 0);
        expect(result.metrics.lines).toBe(tracedLines);
        expect(result.traceValid).toBe(true);
        expect(result.maximumDepth).toBe(result.metrics.maxCascadeDepth);
        expect(result.status).toBe('inconclusive'); // Primary completion is not a proof of all mastery targets.
        await replay(result);
    }, 20000);

    it('continues a showcase after the primary boundary rather than applying ordinary auto-finish', async () => {
        // Force only the evaluator boundary to keep this lifecycle test short; real authored
        // starts, input commands, locks, scoring and cascade drains remain intact.
        vi.spyOn(GameplayHybridEngine.prototype, 'checkVictory').mockImplementation(function reached() {
            return this.getMetrics().piecesPlaced >= 1;
        });
        const result = await demonstrateAuthoredConstruction({
            levelId: 56, profileId: 'stacker', seed: 42, maxPieces: 3,
        });
        expect(result).toMatchObject({
            primaryReachedAtPiece: 1,
            piecesPlaced: 3,
            termination: 'piece-budget',
            traceValid: true,
            status: 'inconclusive',
        });
        expect(result.trace.every((entry) => entry.completed)).toBe(true);
    });

    it.each([26, 80])('enforces the Infinity roof with a %i-piece budget', async (maxPieces) => {
        vi.spyOn(BenchmarkBot.prototype, 'plan').mockImplementation(legalLeftStack);
        const result = await demonstrateAuthoredConstruction({
            levelId: 56, profileId: 'stacker', seed: 42, maxPieces,
        });
        expect(result).toMatchObject({
            termination: 'top-out',
            topOut: true,
            piecesPlaced: 26,
            primaryReachedAtPiece: null,
            traceValid: true,
            traceComplete: true,
            rejectedActions: 0,
            addedCellsAfterStart: 0,
        });
        expect(result.trace).toHaveLength(26);
        expect(BenchmarkBot.prototype.plan).toHaveBeenCalledTimes(26);
        expect(result.metrics.height).toBeGreaterThanOrEqual(result.initialBoard.rows);
        await replay(result);
    });

    it('preserves ordinary-primary precedence when the drained board reaches the Infinity roof', async () => {
        vi.spyOn(BenchmarkBot.prototype, 'plan').mockImplementation(legalLeftStack);
        // Isolate the simultaneous-boundary order, leaving authored orb 5's board,
        // physics and normal finish policy intact. No score/board cells are injected.
        vi.spyOn(GameplayHybridEngine.prototype, 'checkVictory').mockImplementation(function reachedRoof() {
            return checkInfinityGameOver(this.gameState);
        });
        const result = await demonstrateAuthoredConstruction({
            levelId: 5, profileId: 'stacker', seed: 42, maxPieces: 80,
        });
        expect(result.termination).toBe('primary-complete');
        expect(result.primaryReachedAtPiece).toBe(result.piecesPlaced);
        expect(result.topOut).toBe(false);
        expect(result.traceValid).toBe(true);
    });

    it('accounts for a legal final lock partly above the Infinity roof without calling it injected cells', async () => {
        vi.spyOn(BenchmarkBot.prototype, 'plan').mockImplementation(legalLeftStack);
        const result = await demonstrateAuthoredConstruction({
            levelId: 5, profileId: 'stacker', seed: 42, maxPieces: 80,
        });
        expect(result).toMatchObject({
            termination: 'top-out',
            topOut: true,
            piecesPlaced: 11,
            primaryReachedAtPiece: null,
            traceValid: true,
            addedCellsAfterStart: 0,
        });
        expect(result.trace.at(-1).cellConservation).toEqual({
            expected: 60, actual: 60, visibleCells: 59, offBoardCells: 1,
        });
        await replay(result);
    });

    it('is deterministic for matched seeds without treating a bounded miss as impossibility', async () => {
        const options = {
            levelId: 60, profileId: 'stacker', seed: 42, maxPieces: 4,
        };
        const first = await demonstrateAuthoredConstruction(options);
        const second = await demonstrateAuthoredConstruction(options);
        expect(second).toEqual(first);
        expect(first.status).toBe('inconclusive');
        expect(first.interpretation).toContain('not an impossibility or difficulty verdict');
        expect(first.requirements.stars.three.effectiveChainDepth).toBe(12);
        expect(first.maximumDepth).toBeLessThan(12);
    });

    it.each([
        [null, 'no-plan'],
        [{ actions: [{ type: 'move', dir: 1 }] }, 'incomplete-plan'],
        [{ actions: [{ type: 'teleport', x: 0, y: 0 }] }, 'invalid-action'],
        [{ actions: Array.from({ length: 10 }, () => ({ type: 'move', dir: -1 })) }, 'rejected-action'],
        [{ actions: [{ type: 'hardDrop' }, { type: 'hardDrop' }] }, 'invalid-action'],
    ])('leaves missing, incomplete and illegal paths inconclusive (%s)', async (plan, termination) => {
        vi.spyOn(BenchmarkBot.prototype, 'plan').mockReturnValue(plan);
        const result = await demonstrateAuthoredConstruction({
            levelId: 49, profileId: 'stacker', seed: 42, maxPieces: 2,
        });
        expect(result).toMatchObject({ status: 'inconclusive', termination, traceValid: false });
        expect(result.quality.allUntimedRequirementsMet).toBe(false);
        expect(result.trace).toHaveLength(1);
        expect(result.trace[0].preview).toHaveLength(3);
    });

    it('records a policy exception as inconclusive rather than a successful trace', async () => {
        vi.spyOn(BenchmarkBot.prototype, 'plan').mockImplementation(() => { throw new Error('broken policy'); });
        const result = await demonstrateAuthoredConstruction({
            levelId: 49, profileId: 'stacker', seed: 42, maxPieces: 2,
        });
        expect(result).toMatchObject({
            status: 'inconclusive',
            termination: 'planning-error',
            traceValid: false,
            traceComplete: false,
            piecesPlaced: 0,
            error: 'broken policy',
        });
    });

    it('detects planner board injection and never qualifies that construction', async () => {
        vi.spyOn(BenchmarkBot.prototype, 'plan').mockImplementation(function inject() {
            this.playerState.boardGrid.at(-1)[0] = { id: 'injected', color: '#fff' };
            return { actions: [{ type: 'hardDrop' }] };
        });
        const result = await demonstrateAuthoredConstruction({
            levelId: 49, profileId: 'stacker', seed: 42, maxPieces: 2,
        });
        expect(result).toMatchObject({
            status: 'inconclusive',
            termination: 'planning-mutated-state',
            traceValid: false,
            piecesPlaced: 0,
            addedCellsAfterStart: 1,
        });
    });
});
