import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { DemoPlayer } from '../../src/core/demo/DemoPlayer.js';
import { GameState, fillBag, spawnPiece } from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { captureGameStateSnapshot } from '../../src/core/demo/demo-state.js';
import { seededRandom } from '../../src/utils/helpers.js';

const golden = JSON.parse(readFileSync(new URL('../fixtures/demo-seek-baseline.json', import.meta.url), 'utf8'));

function makeDemo(kind = 'empty') {
    const demo = {
        version: '2.0',
        sim: { tickMs: 1000 / 60, durationFrames: 600 },
        initialState: { seed: 17, level: 1, settings: { hitStopEnabled: true } },
        inputs: kind === 'empty' ? [] : [
            { f: 10, a: 'move', d: -1 },
            { f: 10, a: 'move', d: 1 },
            { f: 10, a: 'rotate', d: 'flip' },
            { f: 10, a: 'rotate', d: 'flip' },
            { f: 20, a: 'hardDrop' },
            { f: 30, a: 'move', d: -1, q: true },
            { f: 55, a: 'hardDrop' },
            { f: 280, a: 'move', d: -1 },
            { f: 280, a: 'move', d: 1 },
            { f: 280, a: 'softDrop' },
        ],
        metadata: { duration: 10000 },
    };
    if (kind === 'clear') {
        const state = new GameState({ hitStopEnabled: true });
        state.randomGenerator = seededRandom(17);
        fillBag(state.nextPieces, state.randomGenerator);
        spawnPiece(state);
        Object.assign(state.currentPiece, { shape: [[1, 1, 1, 1]], shapeKey: 'I', x: 3, y: 0 });
        state.lockedPieces = [{
            shape: [[1, 1, 1, 0, 0, 0, 0, 1, 1, 1]],
            x: 0,
            y: state.boardGrid.length - 1,
            pieceId: 900,
            color: '#666666',
            type: 'garbage',
        }];
        state.lines = 14;
        state.linesUntilNextLevel = 1;
        rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
        demo.checkpoints = [{ f: 0, t: 0, inputIndex: 0, state: captureGameStateSnapshot(state) }];
    }
    return demo;
}

function makePlayer(demo = makeDemo()) {
    const player = new DemoPlayer({});
    player.loadDemo(demo);
    player.gameState = new GameState({ hitStopEnabled: true });
    player.isPlaying = true;
    player._scheduleLoop = vi.fn();
    const state = player.gameState;
    const log = [];
    const timing = (name, duration) => (...args) => {
        log.push([name, state.simTimeMs, ...args.map(arg => typeof arg === 'object' ? '<object>' : arg)]);
        state.hitStopRemaining = Math.max(state.hitStopRemaining, duration);
    };
    player.callbacks = {
        spawnPiece: () => spawnPiece(state),
        drawCallback: vi.fn(),
        updateStatsCallback: vi.fn(),
        updateStats: vi.fn(),
        physicsCallbacks: {
            spawnPiece: () => {
                log.push(['spawn', state.simTimeMs]);
                spawnPiece(state);
            },
        },
        replayTimingCallbacks: {
            onHardDrop: timing('hardDrop', 30),
            onLineClearImpact: timing('clearImpact', 70),
            onPerfectClear: timing('perfectClear', 110),
        },
    };
    const applyInput = player._applyInput.bind(player);
    player._applyInput = (...args) => {
        log.push(['input', args[0].f, args[0].a, args[0].d ?? null, state.simTimeMs]);
        return applyInput(...args);
    };
    return { player, state, log };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

describe('DemoPlayer explicit seek responsiveness and ownership', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(golden.scenarios)('keeps the pre-optimization $kind snapshot and ordered timing callbacks', async (baseline) => {
        const { player, state, log } = makePlayer(makeDemo(baseline.kind));
        const checkpoints = vi.spyOn(player, '_captureRuntimeCheckpoint');
        await player.seek(5000);

        const hash = createHash('sha256').update(JSON.stringify(captureGameStateSnapshot(state))).digest('hex');
        expect(hash).toBe(baseline.canonicalHash);
        expect(log).toEqual(baseline.log);
        expect(state.randomGenerator.getState()).toBe(baseline.rngState);
        expect(player.currentInputIndex).toBe(baseline.currentInputIndex);
        expect(checkpoints).toHaveBeenCalledTimes(baseline.workload.steps);
        expect(player.callbacks.drawCallback).toHaveBeenCalledTimes(1);
        expect(player.callbacks.updateStats).toHaveBeenCalledTimes(1);
        expect(player.callbacks.updateStatsCallback).not.toHaveBeenCalled();
    });

    it('runs an actual timer before completing a long seek, at a bounded stable boundary', async () => {
        vi.spyOn(performance, 'now').mockReturnValue(1000);
        const { player, state } = makePlayer();
        const checkpoints = vi.spyOn(player, '_captureRuntimeCheckpoint');
        let observation;
        const browserTask = new Promise(resolve => {
            setTimeout(() => {
                observation = {
                    time: state.simTimeMs,
                    steps: checkpoints.mock.calls.length,
                    seeking: state.isSeeking,
                    processingPhysics: state.isProcessingPhysics,
                    draws: player.callbacks.drawCallback.mock.calls.length,
                    stats: player.callbacks.updateStats.mock.calls.length,
                };
                resolve();
            }, 0);
        });

        await player.seek(5000);
        await browserTask;

        expect(observation.steps).toBe(120);
        expect(observation.time).toBeGreaterThan(0);
        expect(observation.time).toBeLessThan(5000);
        expect(observation).toMatchObject({ seeking: true, processingPhysics: false, draws: 0, stats: 0 });
        expect(state.simTimeMs).toBe(5000);
        expect(state.simFrame).toBe(300);
    });

    it('also yields when a short group of complete operations consumes its time budget', async () => {
        let clock = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        const { player } = makePlayer();
        let stepsInSlice = 0;
        const checkpoint = player._captureRuntimeCheckpoint.bind(player);
        vi.spyOn(player, '_captureRuntimeCheckpoint').mockImplementation(() => {
            stepsInSlice++;
            clock += 3;
            checkpoint();
        });
        const slices = [];
        vi.spyOn(player, '_yieldSeekTask').mockImplementation(async () => {
            slices.push(stepsInSlice);
            stepsInSlice = 0;
        });

        await player.seek(1000);

        expect(slices.length).toBeGreaterThan(1);
        expect(slices.every(steps => steps <= 3)).toBe(true);
        expect(player.gameState.simFrame).toBe(60);
    });

    it('yields during dense same-frame commands without dropping or reordering them', async () => {
        vi.spyOn(performance, 'now').mockReturnValue(1000);
        const demo = makeDemo();
        demo.inputs = Array.from({ length: 1000 }, (_, index) => ({ f: 0, a: 'move', d: index % 2 ? 1 : -1 }));
        const { player } = makePlayer(demo);
        player.callbacks.applyCommand = vi.fn(() => true);
        let observedCommands;
        const browserTask = new Promise(resolve => {
            setTimeout(() => {
                observedCommands = player.callbacks.applyCommand.mock.calls.length;
                resolve();
            }, 0);
        });

        await player.seek(0);
        await browserTask;

        expect(observedCommands).toBe(120);
        expect(player.callbacks.applyCommand.mock.calls.map(([command]) => command.value))
            .toEqual(demo.inputs.map(input => input.d));
        expect(player.currentInputIndex).toBe(1000);
        expect(player.callbacks.drawCallback).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('keeps ordinary playback callback cadence, fast forward=%s', async (fastForward) => {
        const { player } = makePlayer();
        player._resetState();
        const yieldTask = vi.spyOn(player, '_yieldSeekTask');

        await player._advanceTo(5000, { muted: fastForward, seeking: fastForward });

        expect(player.callbacks.drawCallback).toHaveBeenCalledTimes(300);
        expect(player.callbacks.updateStatsCallback).toHaveBeenCalledTimes(300);
        expect(player.callbacks.updateStats).not.toHaveBeenCalled();
        expect(yieldTask).not.toHaveBeenCalled();
    });

    it('retires a seek stopped by input during a cooperative yield', async () => {
        const { player, state } = makePlayer();
        const callbacks = player.callbacks;
        vi.spyOn(player, '_yieldSeekTask').mockImplementation(async () => {
            player.stopPlayback({ notify: false });
        });

        await player.seek(5000);

        expect(state.simTimeMs).toBeLessThan(5000);
        expect(state).toMatchObject({ isSeeking: false, isReplay: false, suppressExternalInput: false });
        expect(callbacks.drawCallback).not.toHaveBeenCalled();
        expect(callbacks.updateStats).not.toHaveBeenCalled();
        expect(player._scheduleLoop).not.toHaveBeenCalled();
    });

    it('lets a newer seek finish without the older seek overwriting its result', async () => {
        const { player, state } = makePlayer();
        vi.spyOn(player, '_yieldSeekTask').mockImplementationOnce(() => player.seek(500));

        await player.seek(5000);

        expect(player.playheadMs).toBe(500);
        expect(state.simTimeMs).toBe(500);
        expect(state.simFrame).toBe(30);
        expect(state.isSeeking).toBe(false);
        expect(player.callbacks.drawCallback).toHaveBeenCalledTimes(1);
        expect(player.callbacks.updateStats).toHaveBeenCalledTimes(1);
        expect(player._scheduleLoop).toHaveBeenCalledTimes(1);
    });

    it('retires the old seek when a new playback session starts during a yield', async () => {
        vi.spyOn(performance, 'now').mockReturnValue(1000);
        const { player } = makePlayer();
        const originalCallbacks = player.callbacks;
        const replacement = new GameState();
        const replacementCallbacks = {
            spawnPiece: vi.fn(() => spawnPiece(replacement)),
            updateStats: vi.fn(),
            drawCallback: vi.fn(),
            onStart: vi.fn(),
        };
        vi.spyOn(player, '_yieldSeekTask').mockImplementationOnce(async () => {
            player.startPlayback(replacementCallbacks, replacement);
        });

        await player.seek(5000);

        expect(replacement.simTimeMs).toBe(0);
        expect(player.playheadMs).toBe(0);
        expect(player.isSeeking).toBe(false);
        expect(replacementCallbacks.spawnPiece).toHaveBeenCalledTimes(1);
        expect(replacementCallbacks.onStart).toHaveBeenCalledTimes(1);
        expect(replacementCallbacks.updateStats).toHaveBeenCalledTimes(1);
        expect(originalCallbacks.drawCallback).not.toHaveBeenCalled();
        expect(originalCallbacks.updateStats).not.toHaveBeenCalled();
    });

    it.each(['gameState', 'demo', 'callbacks'])('fences a replaced %s even without a token change', async (field) => {
        const { player, state } = makePlayer();
        const callbacks = player.callbacks;
        const replacement = field === 'gameState' ? new GameState() : { ...player[field] };
        if (field === 'gameState') replacement.isPaused = true;
        let timeAtReplacement;
        vi.spyOn(player, '_yieldSeekTask').mockImplementation(async () => {
            timeAtReplacement = state.simTimeMs;
            player[field] = replacement;
        });

        await player.seek(5000);

        expect(state.simTimeMs).toBe(timeAtReplacement);
        expect(player.playheadMs).toBe(0);
        expect(callbacks.drawCallback).not.toHaveBeenCalled();
        expect(callbacks.updateStats).not.toHaveBeenCalled();
        expect(player._scheduleLoop).not.toHaveBeenCalled();
        if (field === 'gameState') {
            expect(replacement.simTimeMs).toBe(0);
            expect(replacement.isPaused).toBe(true);
        }
    });

    it('does not advance replacement counters after an awaited command finishes', async () => {
        const demo = makeDemo();
        demo.inputs = [{ f: 0, a: 'move', d: -1 }];
        const { player } = makePlayer(demo);
        const pending = deferred();
        player.callbacks.applyCommand = vi.fn(() => pending.promise);
        const seek = player.seek(0);
        await Promise.resolve();
        expect(player.callbacks.applyCommand).toHaveBeenCalledTimes(1);
        player.gameState = new GameState();
        player.currentInputIndex = 77;
        player.lastSimulatedTime = 777;
        pending.resolve(true);

        await seek;

        expect(player.currentInputIndex).toBe(77);
        expect(player.lastSimulatedTime).toBe(777);
        expect(player.playheadMs).toBe(0);
    });

    it('waits for the current cascade before resetting a board for a new seek', async () => {
        const { player, state } = makePlayer();
        const pending = deferred();
        state.latestPhysicsPromise = pending.promise;
        state.isProcessingPhysics = true;
        const reset = vi.spyOn(player, '_resetState');
        const seek = player.seek(0);
        await Promise.resolve();
        expect(reset).not.toHaveBeenCalled();
        expect(state.latestPhysicsPromise).toBe(pending.promise);
        pending.resolve();

        await seek;

        expect(reset).toHaveBeenCalledTimes(1);
        expect(state.latestPhysicsPromise).toBeNull();
        expect(state.isProcessingPhysics).toBe(false);
        expect(state.currentPiece).not.toBeNull();
    });

    it('cannot clear replacement physics when an older physics wait settles', async () => {
        const { player, state } = makePlayer();
        const pending = deferred();
        state.latestPhysicsPromise = pending.promise;
        state.isProcessingPhysics = true;
        const seek = player.seek(0);
        const replacement = new GameState();
        const replacementPhysics = Promise.resolve();
        replacement.latestPhysicsPromise = replacementPhysics;
        replacement.isProcessingPhysics = true;
        replacement.simTimeMs = 777;
        player.gameState = replacement;
        player.lastSimulatedTime = 777;
        pending.resolve();

        await seek;

        expect(replacement.latestPhysicsPromise).toBe(replacementPhysics);
        expect(replacement.isProcessingPhysics).toBe(true);
        expect(player.lastSimulatedTime).toBe(777);
        expect(player._scheduleLoop).not.toHaveBeenCalled();
    });

    it('fences delayed spawn callbacks belonging to a retired seek', async () => {
        const demo = makeDemo();
        demo.inputs = [{ f: 0, a: 'hardDrop' }];
        const { player, state } = makePlayer(demo);
        const pending = deferred();
        const spawned = vi.fn();
        player.callbacks.physicsCallbacks.spawnPiece = spawned;
        player.callbacks.applyCommand = vi.fn((_command, { callbacks }) => {
            state.isProcessingPhysics = true;
            state.latestPhysicsPromise = pending.promise.then(() => callbacks.physicsCallbacks.spawnPiece());
            return true;
        });
        const seek = player.seek(0);
        await Promise.resolve();
        await Promise.resolve();
        expect(player.callbacks.applyCommand).toHaveBeenCalledTimes(1);
        player.stopPlayback({ notify: false });
        player.gameState = new GameState();
        pending.resolve();

        await seek;

        expect(spawned).not.toHaveBeenCalled();
        expect(player.gameState.piecesPlaced).toBe(0);
    });

    it('fences final draw and scheduling if final stats replace playback', async () => {
        const { player } = makePlayer();
        const callbacks = player.callbacks;
        callbacks.updateStats.mockImplementation(() => {
            player.gameState = new GameState();
        });

        await player.seek(500);

        expect(callbacks.updateStats).toHaveBeenCalledTimes(1);
        expect(callbacks.drawCallback).not.toHaveBeenCalled();
        expect(player._scheduleLoop).not.toHaveBeenCalled();
        expect(player.gameState.simTimeMs).toBe(0);
    });

    it('restores pause after the final presentation without scheduling live replay', async () => {
        const { player, state } = makePlayer();
        player.isPaused = true;
        state.isPaused = true;

        await player.seek(5000);

        expect(state.simFrame).toBe(300);
        expect(state.isPaused).toBe(true);
        expect(player.isPaused).toBe(true);
        expect(player.callbacks.drawCallback).toHaveBeenCalledTimes(1);
        expect(player._scheduleLoop).not.toHaveBeenCalled();
    });

    it.each(['pause', 'resume'])('honors %s input during a seek without skipping simulation work', async (action) => {
        const { player, state } = makePlayer(makeDemo('plain'));
        player.isPaused = action === 'resume';
        state.isPaused = player.isPaused;
        vi.spyOn(player, '_yieldSeekTask').mockImplementationOnce(async () => {
            if (action === 'pause') player.pausePlayback();
            else player.resumePlayback();
            expect(state.isPaused).toBe(false);
        });

        await player.seek(5000);

        const snapshot = captureGameStateSnapshot(state);
        snapshot.isPaused = false;
        const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
        expect(hash).toBe(golden.scenarios.find(scenario => scenario.kind === 'plain').canonicalHash);
        expect(state.simFrame).toBe(300);
        expect(player.isPaused).toBe(action === 'pause');
        expect(state.isPaused).toBe(action === 'pause');
        expect(player._scheduleLoop).toHaveBeenCalledTimes(action === 'pause' ? 0 : 1);
        expect(player.callbacks.drawCallback).toHaveBeenCalledTimes(1);
    });
});
