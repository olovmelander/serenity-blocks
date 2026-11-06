import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { DemoPlayer } from '../../src/core/demo/DemoPlayer.js';
import { GameState, fillBag, spawnPiece } from '../../src/core/game.js';
import {
    captureGameStateSnapshot,
    isRestorableDemoCheckpointSnapshot,
} from '../../src/core/demo/demo-state.js';
import { seededRandom } from '../../src/utils/helpers.js';

// A saved replay's checkpoints are optional shortcuts. One whose structure is
// damaged must be dropped at load so a seek replays from an earlier state,
// instead of throwing half-way through restore or on the first spawn after it.

const tickMs = 1000 / 60;
const recording = (extra = {}) => ({
    version: '2.0',
    sim: { tickMs, durationFrames: 60 },
    initialState: { seed: 17, level: 1 },
    inputs: [{ f: 10, a: 'move', d: -1 }, { f: 25, a: 'move', d: 1 }],
    metadata: { duration: 1000 },
    ...extra,
});

function checkpoint({ infinity = false } = {}) {
    const state = new GameState({ isInfinityMode: infinity });
    state.randomGenerator = seededRandom(17);
    fillBag(state.nextPieces, state.randomGenerator);
    spawnPiece(state);
    state.simTimeMs = 20 * tickMs;
    state.simFrame = 20;
    state.score = 999;
    return {
        f: 20, t: state.simTimeMs, inputIndex: 1, state: captureGameStateSnapshot(state),
    };
}

function seekingPlayer(demo, { infinity = false } = {}) {
    const player = new DemoPlayer({});
    expect(player.loadDemo(demo)).toBe(true);
    const state = new GameState({ isInfinityMode: infinity });
    player.gameState = state;
    player.callbacks = { spawnPiece: () => spawnPiece(state) };
    player.isPlaying = true;
    player._scheduleLoop = vi.fn();
    return player;
}

const damaged = (mutate) => {
    const saved = checkpoint();
    mutate(saved.state);
    return saved;
};

const malformed = [
    ['current piece shape has a null row', (s) => { s.currentPiece.shape = [null]; }],
    ['current piece is a boolean', (s) => { s.currentPiece = true; }],
    ['locked pieces are a record', (s) => { s.lockedPieces = { 0: s.currentPiece }; }],
    ['locked pieces contain null', (s) => { s.lockedPieces = [null]; }],
    ['board grid has a null row', (s) => { s.boardGrid[3] = null; }],
    ['next pieces are a record', (s) => { s.nextPieces = { 0: 'I' }; }],
    ['piece counts are a number', (s) => { s.pieceCounts = 1; }],
];

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('damaged replay checkpoints', () => {
    it.each(malformed)('replays from the seed when %s', async (_name, mutate) => {
        const expected = seekingPlayer(recording());
        const actual = seekingPlayer(recording({ checkpoints: [damaged(mutate)] }));
        expect(actual.checkpoints).toHaveLength(0);
        await expected.seek(500);

        await expect(actual.seek(500)).resolves.toBeUndefined();

        expect(actual.isSeeking).toBe(false);
        expect(actual.gameState.isSeeking).toBe(false);
        expect(captureGameStateSnapshot(actual.gameState)).toEqual(captureGameStateSnapshot(expected.gameState));
        expect(actual.currentInputIndex).toBe(expected.currentInputIndex);
        // The next spawn must work on the restored queue and counters.
        actual.gameState.currentPiece = null;
        expect(spawnPiece(actual.gameState)).not.toBeNull();
    });

    it('replays an Infinity session from the seed when its board has a null row', async () => {
        const saved = checkpoint({ infinity: true });
        saved.state.boardGrid[2] = null;
        const expected = seekingPlayer(recording(), { infinity: true });
        const actual = seekingPlayer(recording({ checkpoints: [saved] }), { infinity: true });
        await expected.seek(500);

        await expect(actual.seek(500)).resolves.toBeUndefined();

        expect(actual.isSeeking).toBe(false);
        expect(captureGameStateSnapshot(actual.gameState)).toEqual(captureGameStateSnapshot(expected.gameState));
    });

    it('falls back to an earlier valid checkpoint rather than the seed', async () => {
        const earlier = checkpoint();
        earlier.state.score = 111;
        const later = damaged((s) => { s.boardGrid[0] = null; });
        later.f = 28;
        later.t = 28 * tickMs;
        later.inputIndex = 2;
        later.state.simFrame = 28;
        later.state.simTimeMs = later.t;
        const player = seekingPlayer(recording({ checkpoints: [earlier, later] }));

        await player.seek(500);

        expect(player.gameState.score).toBe(111);
        expect(player.currentInputIndex).toBe(2);
        expect(player.isSeeking).toBe(false);
    });
});

describe('restorable replay checkpoints are kept', () => {
    it('restores a complete checkpoint', async () => {
        const player = seekingPlayer(recording({ checkpoints: [checkpoint()] }));
        await player.seek(500);
        expect(player.gameState.score).toBe(999);
        expect(player.currentInputIndex).toBe(2);
    });

    it('restores a legacy checkpoint that omits optional containers', async () => {
        const saved = checkpoint();
        for (const key of [
            'lockedPieces', 'boardGrid', 'board', 'pieceCounts', 'lineClearCounts',
            'comboState', 'handicaps', 'lastPlacedPieceX', 'inputQueue', 'playerInput', 'blindTimers',
        ]) {
            delete saved.state[key];
        }
        const player = seekingPlayer(recording({ checkpoints: [saved] }));
        await player.seek(500);
        expect(player.gameState.score).toBe(999);
        expect(player.isSeeking).toBe(false);
    });

    it('accepts a terminal checkpoint without a current piece', () => {
        const saved = checkpoint();
        saved.state.currentPiece = null;
        saved.state.isGameOver = true;
        expect(isRestorableDemoCheckpointSnapshot(saved.state)).toBe(true);
        const player = new DemoPlayer({});
        expect(player.loadDemo(recording({ checkpoints: [saved] }))).toBe(true);
        expect(player.checkpoints).toHaveLength(1);
    });

    it('accepts a matching Infinity checkpoint and its aliased board', async () => {
        const saved = checkpoint({ infinity: true });
        expect(isRestorableDemoCheckpointSnapshot(saved.state)).toBe(true);
        const player = seekingPlayer(recording({ checkpoints: [saved] }), { infinity: true });
        await player.seek(500);
        expect(player.gameState.score).toBe(999);
        expect(player.gameState.board).toBe(player.gameState.boardGrid);
    });

    it('never adopts an Infinity checkpoint in a non-Infinity session, and replays from the seed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const expected = seekingPlayer(recording());
        const player = seekingPlayer(recording({ checkpoints: [checkpoint({ infinity: true })] }));
        expect(player.checkpoints).toHaveLength(1);
        await expected.seek(500);

        await expect(player.seek(500)).resolves.toBeUndefined();

        expect(warn).toHaveBeenCalledWith(
            '[DemoPlayer] Skipping a checkpoint that cannot be restored:',
            expect.objectContaining({ message: 'Infinity checkpoint requires an Infinity session' }),
        );
        expect(player.gameState.isInfinityMode).toBe(false);
        expect(player.isSeeking).toBe(false);
        expect(player.gameState.suppressExternalInput).toBe(true);
        expect(captureGameStateSnapshot(player.gameState)).toEqual(captureGameStateSnapshot(expected.gameState));
        expect(player.checkpoints).toHaveLength(0);
    });

    it('replays from the seed when an Infinity checkpoint has an incomplete rule descriptor', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const saved = checkpoint({ infinity: true });
        delete saved.state.infinityVisibleRows;
        const expected = seekingPlayer(recording(), { infinity: true });
        const player = seekingPlayer(recording({ checkpoints: [saved] }), { infinity: true });
        await expected.seek(500);

        await expect(player.seek(500)).resolves.toBeUndefined();

        expect(player.isSeeking).toBe(false);
        expect(captureGameStateSnapshot(player.gameState)).toEqual(captureGameStateSnapshot(expected.gameState));
    });
});
