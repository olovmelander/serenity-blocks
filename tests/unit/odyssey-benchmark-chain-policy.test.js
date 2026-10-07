import {
    describe, expect, it, vi,
} from 'vitest';
import { CHAIN_PROFILE, chainUtility } from '../../scripts/odyssey-benchmark/chain-policy.mjs';
import { BenchmarkBot, createBenchmarkBot } from '../../scripts/odyssey-benchmark/profiles.mjs';
import {
    CASCADE_CAPABILITY_FIXTURES, demonstrateConstruction,
} from '../../scripts/odyssey-benchmark/capabilities.mjs';
import { GameState, spawnPiece } from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import { checkInfinityGameOver } from '../../src/core/infinity-grid.js';

function candidate(depth, previousDepth = 0) {
    return {
        cascadeCount: depth,
        totalLines: depth,
        metricsBefore: { maxCascadeDepth: previousDepth },
        preparationAfter: { preparationScore: 0 },
        boardMetrics: {
            holes: 0, maxHeight: 0, bumpiness: 0, topOutRisk: 0,
        },
        pathCost: 0,
    };
}

function preparedState(tail) {
    const state = new GameState();
    state.disableLevelProgression = true;
    state.lockedPieces = CASCADE_CAPABILITY_FIXTURES[0].pieces(state.boardGrid.length - 1);
    rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
    state.nextPieces = ['I', 'O', 'T', 'J', ...tail];
    spawnPiece(state);
    state.randomGenerator = vi.fn(() => 0.5);
    return state;
}

describe('experimental chain construction policy', () => {
    it('rewards a new depth record while reducing repeated shallow discharges', () => {
        const repeat = chainUtility(candidate(3, 3));
        const first = chainUtility(candidate(3, 2));
        const improvement = chainUtility(candidate(4, 3));
        expect(first).toBeGreaterThan(repeat * 10);
        expect(improvement).toBeGreaterThan(first);
        expect(chainUtility(candidate(1))).toBe(0);
    });

    it('keeps aggregate lines distinct from wave depth and does not mutate candidates', () => {
        const severalLines = { ...candidate(3, 2), totalLines: 9 };
        const before = structuredClone(severalLines);
        expect(chainUtility(severalLines)).toBe(chainUtility(candidate(3, 2)));
        expect(severalLines).toEqual(before);
    });

    it('uses the full three-preview horizon without reading or consuming the hidden bag', () => {
        const a = preparedState(['S', 'Z', 'L']);
        const b = preparedState(['I', 'I', 'I']);
        const bags = [a.nextPieces.slice(), b.nextPieces.slice()];
        try {
            const bots = [a, b].map((gameState) => createBenchmarkBot({
                gameState, actions: {}, profileId: 'chain', decisionSeed: 91,
            }));
            expect(CHAIN_PROFILE.experimental).toBe(true);
            expect(bots[0].config.lookaheadDepth).toBe(3);
            expect(bots[0].config.lookaheadBreadth).toBe(6);
            expect(bots[0].config.latentChainEval).toBe(false);
            const plans = bots.map((bot) => bot.plan());
            expect(plans[0].actions).toEqual(plans[1].actions);
            expect(plans[0].score).toBe(plans[1].score);
            expect(plans[0].candidate.nextShapeKeys).toHaveLength(3);
            expect(plans[0].candidate.evaluation.metrics.latentDischarge).toBeNull();
            expect([a.nextPieces, b.nextPieces]).toEqual(bags);
            expect(a.randomGenerator).not.toHaveBeenCalled();
            expect(b.randomGenerator).not.toHaveBeenCalled();
        } finally { a.reset(); b.reset(); }
    });

    it('stops an empty-board Infinity construction at the real roof before planning another piece', async () => {
        let plansAfterRoof = 0;
        const plan = vi.spyOn(BenchmarkBot.prototype, 'plan').mockImplementation(function stackAtEdge() {
            if (checkInfinityGameOver(this.playerState)) plansAfterRoof++;
            const placement = findReachablePlacements(this.playerState)
                .sort((a, b) => a.x - b.x || a.y - b.y)[0];
            return placement ? {
                actions: [...placement.actions, { type: 'hardDrop' }], candidate: placement,
            } : null;
        });
        try {
            const demo = await demonstrateConstruction({
                profileId: 'chain', seed: 42, infinity: true, maxPieces: 80,
            });
            expect(demo.topOut).toBe(true);
            expect(demo.piecesPlaced).toBeLessThan(80);
            expect(demo.rejectedActions).toBe(0);
            expect(demo.allTetrominoes).toBe(true);
            expect(plansAfterRoof).toBe(0);
            expect(plan).toHaveBeenCalledTimes(demo.piecesPlaced);
            expect(demo.trace.at(-1).actions.at(-1).type).toBe('hardDrop');
        } finally { plan.mockRestore(); }
    });

    it('constructs and independently replays the corrected four-wave seeded trace', async () => {
        // The six-wave result belonged to b89bbec's row-compacting physics.
        // Preserve the same policy, seed and budget while pinning the corrected geometry.
        const demo = await demonstrateConstruction({
            profileId: 'chain',
            seed: 9101,
            infinity: true,
            maxPieces: 90,
            decisionSeed: 'capabilities-v2',
        });
        expect(demo.kind).toBe('empty-board-construction');
        expect(demo.maximumDepth).toBe(4);
        expect(demo.piecesPlaced).toBe(90);
        expect(demo.insertedCells).toBe(0);
        expect(demo.allTetrominoes).toBe(true);
        expect(demo.rejectedActions).toBe(0);
        expect(demo.topOut).toBe(false);
        expect(demo.trace.every((step) => step.preview.length === 3
            && step.actions.at(-1).type === 'hardDrop'
            && (step.predictedDepth >= 2 ? step.predictedDepth : 0) === step.maximumDepth)).toBe(true);
        expect(demo.trace.find((step) => step.maximumDepth === 4).step).toBe(63);
        expect(demo.preparedReplay).toMatchObject({
            kind: 'prepared-from-legal-construction',
            sourceConstructionId: demo.id,
            sourcePrefixPieces: 62,
            status: 'pass',
            maximumDepth: 4,
            rejectedActions: 0,
        });
    }, 30000);
});
