import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { DemoPlayer } from '../../src/core/demo/DemoPlayer.js';
import { GameState, fillBag, spawnPiece } from '../../src/core/game.js';
import { captureGameStateSnapshot } from '../../src/core/demo/demo-state.js';
import { seededRandom } from '../../src/utils/helpers.js';

const tickMs = 1000 / 60;
const recording = () => ({
    version: '2.0',
    sim: { tickMs, durationFrames: 60 },
    initialState: { seed: 17, level: 1 },
    inputs: [{ f: 10, a: 'move', d: -1 }, { f: 25, a: 'move', d: 1 }],
    metadata: { duration: 1000 },
});

function checkpoint(inputIndex) {
    const state = new GameState();
    state.randomGenerator = seededRandom(17);
    fillBag(state.nextPieces, state.randomGenerator);
    spawnPiece(state);
    state.simTimeMs = 20 * tickMs;
    state.simFrame = 20;
    state.score = 999;
    return {
        f: 20, t: state.simTimeMs, inputIndex, state: captureGameStateSnapshot(state),
    };
}

function seekingPlayer(demo) {
    const player = new DemoPlayer({});
    expect(player.loadDemo(demo)).toBe(true);
    const state = new GameState();
    player.gameState = state;
    player.callbacks = { spawnPiece: () => spawnPiece(state) };
    player.isPlaying = true;
    player._scheduleLoop = vi.fn();
    return player;
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('replay frame ownership', () => {
    function scheduler() {
        const callbacks = [];
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            callbacks.push(callback);
            return callbacks.length - 1;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const player = new DemoPlayer({});
        player.isPlaying = true;
        return { player, callbacks };
    }

    it('schedules only one frame when the browser returns handle zero', () => {
        const { player } = scheduler();
        player._scheduleLoop();
        player._scheduleLoop();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it('cancels handle zero when playback stops', () => {
        const { player } = scheduler();
        player._scheduleLoop();
        player.stopPlayback({ notify: false });
        expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
        expect(player.animationId).toBeNull();
    });

    it('does not let a retired callback enter or clear the restarted playback', () => {
        const { player, callbacks } = scheduler();
        player._scheduleLoop();
        const oldCallback = callbacks[0];
        player.stopPlayback({ notify: false });
        player.demo = recording();
        player._resetState = vi.fn();
        player._captureRuntimeCheckpoint = vi.fn();
        const loop = vi.spyOn(player, '_loop').mockResolvedValue();
        player.startPlayback({}, new GameState());
        player._scheduleLoop();
        const currentHandle = player.animationId;
        loop.mockClear();

        oldCallback();

        expect(loop).not.toHaveBeenCalled();
        expect(player.animationId).toBe(currentHandle);
        callbacks[currentHandle]();
        expect(loop).toHaveBeenCalledOnce();
        expect(player.animationId).toBeNull();
    });
});

describe('invalid optional replay checkpoints', () => {
    it.each([-1, 0.5, 3])('replays from valid state when a checkpoint input index is %s', async (inputIndex) => {
        const expected = seekingPlayer(recording());
        const actual = seekingPlayer({ ...recording(), checkpoints: [checkpoint(inputIndex)] });
        await expected.seek(500);
        await expect(actual.seek(500)).resolves.toBeUndefined();
        expect(captureGameStateSnapshot(actual.gameState)).toEqual(captureGameStateSnapshot(expected.gameState));
        expect(actual.currentInputIndex).toBe(expected.currentInputIndex);
    });

    it('retains valid explicit indices and derives an omitted legacy index', async () => {
        for (const inputIndex of [1, undefined]) {
            const player = seekingPlayer({ ...recording(), checkpoints: [checkpoint(inputIndex)] });
            await player.seek(500);
            expect(player.gameState.score).toBe(999);
            expect(player.currentInputIndex).toBe(2);
            expect(player.isSeeking).toBe(false);
        }
    });

    it('retains end-of-input checkpoints with an explicit or omitted index', async () => {
        for (const inputIndex of [2, undefined]) {
            const saved = checkpoint(inputIndex);
            saved.f = 40;
            saved.t = 40 * tickMs;
            saved.state.simFrame = 40;
            saved.state.simTimeMs = saved.t;
            const player = seekingPlayer({ ...recording(), checkpoints: [saved] });
            await player.seek(900);
            expect(player.gameState.score).toBe(999);
            expect(player.currentInputIndex).toBe(2);
            expect(player.isSeeking).toBe(false);
        }
    });
});
