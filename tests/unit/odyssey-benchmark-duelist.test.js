import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createBenchmarkBot } from '../../scripts/odyssey-benchmark/profiles.mjs';
import { CASCADE_CAPABILITY_FIXTURES } from '../../scripts/odyssey-benchmark/capabilities.mjs';
import { runAttempt } from '../../scripts/odyssey-benchmark/runtime.mjs';
import {
    GameState, hardDrop, move, rotate, softDrop, spawnPiece,
} from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import { calculateGarbage } from '../../src/core/garbage.js';

const duelLevel = {
    mechanics: { versus: { botDifficulty: 1, fragsToWin: 7 } },
    victory: { primary: { type: 'frags', target: 7 } },
};

function makeState(kind = 'chain') {
    const state = new GameState({ hitStopEnabled: false });
    state.isSeeking = true; // Fixture replay skips presentation waits, not gameplay rules.
    state.disableLevelProgression = true;
    const bottom = state.boardGrid.length - 1;
    if (kind === 'chain') state.lockedPieces = CASCADE_CAPABILITY_FIXTURES[0].pieces(bottom);
    else {
        state.lockedPieces = Array.from({ length: 4 }, (_, index) => ({
            x: 0, y: bottom - index, shape: [Array(9).fill(1)], pieceId: `row:${index}`, color: 'I',
        }));
        if (kind === 'quad-with-remainder') {
            state.lockedPieces.push({
                x: 0, y: bottom - 4, shape: [[1]], pieceId: 'remainder', color: 'I',
            });
        }
    }
    rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
    state.nextPieces = ['I', 'O', 'T', 'J', 'S', 'Z', 'L'];
    spawnPiece(state);
    return state;
}

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('experimental duel attack policy', () => {
    it.each(['native', 'steady', 'deliberate'])('retains cascade search, execution and random stream under %s cadence', (cadenceId) => {
        const state = makeState();
        try {
            const bots = ['cascade', 'duelist'].map((profileId) => createBenchmarkBot({
                gameState: state, actions: {}, profileId, cadenceId, decisionSeed: 91, levelConfig: duelLevel,
            }));
            expect(bots[1].config).toEqual(bots[0].config);
            expect(bots[1].decisionStream.getState()).toEqual(bots[0].decisionStream.getState());
        } finally { state.reset(); }
    });

    it.each([1, 6, 55, 59])('exactly preserves bounded real solo execution on orb %i', async (levelId) => {
        const args = {
            levelId, seed: 42, cadenceId: 'steady', maxSimSeconds: 5, maxPieces: 5, trace: true,
        };
        const { profileId: firstProfile, wallMs: firstWall, ...baseline } = await runAttempt({
            ...args, profile: 'cascade',
        });
        const { profileId: secondProfile, wallMs: secondWall, ...candidate } = await runAttempt({
            ...args, profile: 'duelist',
        });
        expect(baseline.outcome).not.toBe('error');
        expect(candidate).toEqual(baseline);
    });

    it.each(['chain', 'quad', 'quad-with-remainder'])('predicts the real sent garbage from legal %s fixture actions', async (kind) => {
        const state = makeState(kind);
        const sent = [];
        const callbacks = { onGarbageReady: (summary) => sent.push(calculateGarbage(summary).getTotalLines()) };
        const bot = createBenchmarkBot({
            gameState: state,
            profileId: 'duelist',
            levelConfig: duelLevel,
            decisionSeed: 42,
            actions: {
                moveLeft: () => move(state, -1),
                moveRight: () => move(state, 1),
                rotateLeft: () => rotate(state, 'left'),
                rotateRight: () => rotate(state, 'right'),
                rotateFlip: () => rotate(state, 'flip'),
                softDrop: () => softDrop(state, null, callbacks),
                hardDrop: () => hardDrop(state, null, callbacks),
            },
        });
        try {
            // This is a reachable-candidate projection check, not a claim that the
            // bounded policy always selects the fixture's strongest immediate clear.
            const candidates = bot.evaluatePlacements(state, findReachablePlacements(state));
            const candidate = candidates.find((entry) => entry.totalLines === (kind === 'chain' ? 2 : 4));
            expect(candidate).toBeDefined();
            expect(candidate.projectedAttack).toBe({ chain: 2, quad: 5, 'quad-with-remainder': 3 }[kind]);
            for (const action of [...candidate.actions, { type: 'hardDrop' }]) {
                expect(bot.scheduler.perform(action)).toBe(true);
            }
            if (state.latestPhysicsPromise) await state.latestPhysicsPromise;
            expect(sent.reduce((sum, rows) => sum + rows, 0)).toBe(candidate.projectedAttack);
            expect(state.lines).toBe(candidate.totalLines);
        } finally { state.reset(); }
    });

    it('changes only the duel reward on real reachable candidates and retains the pending-garbage danger gate', () => {
        const state = makeState();
        let pending = 0;
        const bots = ['cascade', 'duelist'].map((profileId) => createBenchmarkBot({
            gameState: state,
            actions: {},
            profileId,
            decisionSeed: 91,
            levelConfig: duelLevel,
            getPendingGarbage: () => pending,
        }));
        try {
            const candidates = bots[0].evaluatePlacements(state, findReachablePlacements(state));
            expect(candidates.some((candidate) => candidate.cascadeCount === 2)).toBe(true);
            for (const candidate of candidates) {
                const scores = bots.map((bot) => bot.rank([candidate])[0].evaluation.score);
                const originalWaveReward = candidate.cascadeCount >= 2 ? 200 + candidate.cascadeCount ** 2 * 45 : 0;
                expect(scores[1] - scores[0]).toBeCloseTo(candidate.projectedAttack * 45 - originalWaveReward, 10);
            }
            expect(bots[1].assessTactics(state.boardGrid, { sideLanes: [] }).danger).toBe(false);
            pending = 20;
            const tactics = bots.map((bot) => bot.assessTactics(state.boardGrid, { sideLanes: [] }));
            expect(tactics[1]).toEqual(tactics[0]);
            expect(tactics[1].danger).toBe(true);
            expect(bots[1].plan().candidate.totalLines).toBeGreaterThan(0);
        } finally { state.reset(); }
    });

    it('cannot use a different fourth preview or mutate the actual bag', () => {
        const states = [makeState(), makeState()];
        states[1].nextPieces.splice(3, 3, 'I', 'I', 'I');
        const bags = states.map((state) => state.nextPieces.slice());
        const bots = states.map((gameState) => createBenchmarkBot({
            gameState, actions: {}, profileId: 'duelist', decisionSeed: 91, levelConfig: duelLevel,
        }));
        try {
            const plans = bots.map((bot) => bot.plan());
            expect(plans[1].actions).toEqual(plans[0].actions);
            expect(plans[1].score).toBe(plans[0].score);
            expect(plans[0].candidate.nextShapeKeys).toHaveLength(3);
            expect(states.map((state) => state.nextPieces)).toEqual(bags);
            expect(bots[1].decisionStream.getState()).toEqual(bots[0].decisionStream.getState());
        } finally { states.forEach((state) => state.reset()); }
    });
});
