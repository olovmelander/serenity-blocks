import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { DemoPlayer } from '../../src/core/demo/DemoPlayer.js';
import {
    DemoRecorder,
    DEMO_COMMAND_INPUT_FORMAT,
    DEMO_TICK_MS,
    LEGACY_DEMO_HIT_STOP_ENABLED,
} from '../../src/core/demo/DemoRecorder.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot } from '../../src/core/demo/demo-state.js';
import { startDas } from '../../src/core/das.js';
import {
    GameState,
    fillBag,
    lockPiece,
    spawnPiece,
} from '../../src/core/game.js';
import { processPhysics } from '../../src/core/physics.js';
import { enqueueInputEdge } from '../../src/core/player-input-state.js';
import { seededRandom } from '../../src/utils/helpers.js';

function makeDemo(overrides = {}) {
    return {
        version: '2.0',
        sim: { tickMs: DEMO_TICK_MS, durationFrames: 600 },
        initialState: { seed: 7, level: 1 },
        inputs: [],
        metadata: { duration: 10000 },
        ...overrides,
    };
}

describe('Demo replay clock', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rebases playback speed changes from the current playhead', () => {
        let clock = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);

        const player = new DemoPlayer({});
        player.loadDemo(makeDemo());
        player.isPlaying = true;
        player.playheadMs = 1000;
        player.lastWallTime = 1000;

        clock = 1250;
        expect(player.setPlaybackSpeed(4)).toBe(4);
        expect(player.getCurrentTime()).toBe(1250);

        clock = 1500;
        expect(player.getCurrentTime()).toBe(2250);
    });

    it('keeps paused playback time stable until resume', () => {
        let clock = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);

        const player = new DemoPlayer({});
        player.loadDemo(makeDemo());
        player.isPlaying = true;
        player.playheadMs = 1000;
        player.lastWallTime = 1000;
        player.gameState = new GameState();

        clock = 1500;
        player.pausePlayback();
        expect(player.getCurrentTime()).toBe(1500);

        clock = 3000;
        expect(player.getCurrentTime()).toBe(1500);

        player.resumePlayback();
        clock = 3500;
        expect(player.getCurrentTime()).toBe(2000);
    });

    it('does not complete replay just because seek lands on a game-over state before duration', async () => {
        const clock = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);

        const player = new DemoPlayer({});
        player.loadDemo(makeDemo({ metadata: { duration: 10000 } }));
        player.callbacks = {};
        player.gameState = new GameState();
        player.isPlaying = true;
        player.lastWallTime = 1000;
        player.onPlaybackEnd = vi.fn();
        player._advanceTo = vi.fn(async (targetMs) => {
            player.lastSimulatedTime = targetMs;
            player.gameState.isGameOver = true;
        });
        player._scheduleLoop = vi.fn();

        await player.seek(5000);
        await player._loop();

        expect(player.onPlaybackEnd).not.toHaveBeenCalled();
        expect(player.isPlaying).toBe(true);
        expect(player._scheduleLoop).toHaveBeenCalled();
    });

    it('completes replay when the playhead reaches duration', async () => {
        vi.spyOn(performance, 'now').mockImplementation(() => 1000);

        const player = new DemoPlayer({});
        player.loadDemo(makeDemo({ metadata: { duration: 10000 } }));
        player.callbacks = {};
        player.gameState = new GameState();
        player.isPlaying = true;
        player.playheadMs = 10000;
        player.lastWallTime = 1000;
        player.onPlaybackEnd = vi.fn();
        player._advanceTo = vi.fn(async () => {});
        player._scheduleLoop = vi.fn();

        await player._loop();

        expect(player.onPlaybackEnd).toHaveBeenCalledTimes(1);
        expect(player.isPlaying).toBe(false);
    });

    it('normalizes v1 timestamp inputs to simulation frames', () => {
        const player = new DemoPlayer({});
        player.loadDemo(makeDemo({
            version: '1.0',
            sim: undefined,
            inputs: [
                { t: 50, a: 'move', d: -1 },
                { t: 17, a: 'rotate', d: 'right' },
            ],
            metadata: { duration: 100 },
        }));

        expect(player.demo.inputs.map((input) => input.f)).toEqual([1, 3]);
        expect(player.demo.inputs.map((input) => input.a)).toEqual(['rotate', 'move']);
        expect(player.demo.inputs[1].t).toBe(Math.round(3 * DEMO_TICK_MS));
        expect(player.demo.sim.inputFormat).toBe(DEMO_COMMAND_INPUT_FORMAT);
        expect(player.demo.initialState.settings.hitStopEnabled)
            .toBe(LEGACY_DEMO_HIT_STOP_ENABLED);
    });

    it('uses the deterministic legacy hit-stop default instead of target state', () => {
        const player = new DemoPlayer({});
        expect(player.loadDemo(makeDemo())).toBe(true);
        player.gameState = new GameState({ hitStopEnabled: false });
        player.callbacks = {};

        player._resetState();

        expect(player.gameState.hitStopEnabled).toBe(LEGACY_DEMO_HIT_STOP_ENABLED);
    });

    it('rejects input formats whose playback semantics are not implemented', () => {
        const player = new DemoPlayer({});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(player.loadDemo(makeDemo({
            sim: {
                tickMs: DEMO_TICK_MS,
                durationFrames: 1,
                inputFormat: 'edges-v1',
            },
        }))).toBe(false);
        expect(player.demo).toBeNull();
    });

    it('clears a previously loaded demo when a later load fails', () => {
        const player = new DemoPlayer({});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(player.loadDemo(makeDemo())).toBe(true);

        expect(player.loadDemo(makeDemo({
            sim: {
                tickMs: DEMO_TICK_MS,
                durationFrames: 1,
                inputFormat: '',
            },
        }))).toBe(false);

        expect(player.demo).toBeNull();
        expect(player.checkpoints).toEqual([]);
        expect(player.currentInputIndex).toBe(0);
    });

    it('rejects unknown demo rules versions before input-format inference', () => {
        const player = new DemoPlayer({});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(player.loadDemo(makeDemo({
            version: '99.0',
            sim: { tickMs: DEMO_TICK_MS, durationFrames: 1 },
        }))).toBe(false);
        expect(player.demo).toBeNull();
    });

    it.each([
        ['missing initial state', { initialState: undefined }],
        ['negative tick', { sim: { tickMs: -16, durationFrames: 1 } }],
        ['unknown rules', {
            version: '99.0',
            sim: {
                tickMs: DEMO_TICK_MS,
                durationFrames: 1,
                inputFormat: DEMO_COMMAND_INPUT_FORMAT,
            },
        }],
    ])('rejects a demo with %s', (_label, overrides) => {
        const player = new DemoPlayer({});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(player.loadDemo(makeDemo(overrides))).toBe(false);
        expect(player.demo).toBeNull();
    });

    it.each([
        ['null entry', null],
        ['unknown action', { t: 0, a: 'warp' }],
        ['missing timing', { a: 'hardDrop' }],
        ['negative timing', { t: -1, a: 'hardDrop' }],
        ['invalid move direction', { t: 0, a: 'move', d: 0 }],
        ['invalid rotate direction', { t: 0, a: 'rotate', d: 'clockwise' }],
        ['unexpected drop payload', { t: 0, a: 'softDrop', d: 'fast' }],
        ['non-boolean queued marker', { t: 0, a: 'hardDrop', q: 1 }],
    ])('rejects the complete demo when it contains a %s', (_label, input) => {
        const player = new DemoPlayer({});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => player.loadDemo(makeDemo({ inputs: [input] }))).not.toThrow();
        expect(player.demo).toBeNull();
    });

    it('records accepted commands as v2 frame-indexed inputs', () => {
        const recorder = new DemoRecorder();
        const state = new GameState({
            inputHandling: { dasDelay: 91, dasInterval: 23, softDropInterval: 17 },
        });
        state.randomGenerator = seededRandom(11);
        fillBag(state.nextPieces, state.randomGenerator);
        spawnPiece(state);
        state.simFrame = 6;
        state.simTimeMs = 100;

        recorder.startRecording(state, { themeBasedTetrominos: true }, 11);
        recorder.recordCommand({ type: 'move', value: -1 }, state);
        const demo = recorder.stopRecording({
            score: 10,
            lines: 2,
            level: 1,
            durationMs: 100,
            durationFrames: 6,
        });

        expect(demo.version).toBe('2.0');
        expect(demo.sim.tickMs).toBe(DEMO_TICK_MS);
        expect(demo.sim.inputFormat).toBe(DEMO_COMMAND_INPUT_FORMAT);
        expect(demo.initialState.settings).toEqual({
            themeBasedTetrominos: true,
            dasDelay: 91,
            dasInterval: 23,
            softDropInterval: 17,
            hitStopEnabled: true,
        });
        expect(demo.inputs).toEqual([{
            f: 6,
            t: 100,
            a: 'move',
            d: -1,
        }]);
        expect(demo.metadata.durationFrames).toBe(6);
        expect(demo.checkpoints.length).toBeGreaterThan(0);
    });

    it('does not restore checkpoint DAS state for accepted-command demos', async () => {
        const checkpointState = new GameState();
        checkpointState.randomGenerator = seededRandom(17);
        fillBag(checkpointState.nextPieces, checkpointState.randomGenerator);
        spawnPiece(checkpointState);
        checkpointState.simFrame = 60;
        checkpointState.simTimeMs = 1000;
        startDas(checkpointState.playerInput.das.moveLeft);
        enqueueInputEdge(checkpointState.playerInput, {
            tick: 61,
            subframe: 0,
            action: 'move',
            value: -1,
            phase: 'up',
        });

        const player = new DemoPlayer({});
        player.loadDemo(makeDemo({
            checkpoints: [{
                f: 60,
                t: 1000,
                inputIndex: 0,
                state: captureGameStateSnapshot(checkpointState),
            }],
        }));
        player.gameState = new GameState();
        player.callbacks = {};
        player._advanceTo = vi.fn(async () => {});

        await player.seek(1500);

        expect(player.gameState.playerInput.das.moveLeft.active).toBe(false);
        expect(player.gameState.playerInput.pendingEdges).toEqual([]);
    });

    it('clears replay-owned input state before returning control to live input', () => {
        const player = new DemoPlayer({});
        player.gameState = new GameState();
        player.gameState.isPaused = true;
        startDas(player.gameState.playerInput.das.moveRight);
        enqueueInputEdge(player.gameState.playerInput, {
            tick: 1,
            subframe: 0,
            action: 'move',
            value: 1,
            phase: 'up',
        });

        player.stopPlayback({ notify: false });

        expect(player.gameState.playerInput.das.moveRight.active).toBe(false);
        expect(player.gameState.playerInput.pendingEdges).toEqual([]);
        expect(player.gameState.suppressExternalInput).toBe(false);
        expect(player.gameState.isPaused).toBe(false);
    });

    it('restores the recorded hit-stop policy independently of local settings', () => {
        const player = new DemoPlayer({});
        player.loadDemo(makeDemo({
            initialState: {
                seed: 7,
                level: 1,
                settings: { hitStopEnabled: false },
            },
        }));
        player.gameState = new GameState({ hitStopEnabled: true });
        player.callbacks = {};

        player._resetState();

        expect(player.gameState.hitStopEnabled).toBe(false);
    });

    it('marks commands that were accepted into the post-physics input buffer', () => {
        const recorder = new DemoRecorder();
        const state = new GameState();
        state.randomGenerator = seededRandom(13);
        fillBag(state.nextPieces, state.randomGenerator);
        spawnPiece(state);
        state.simFrame = 12;
        state.simTimeMs = 200;

        recorder.startRecording(state, {}, 13);
        recorder.recordCommand({ type: 'move', value: 1, queued: true }, state);

        expect(recorder.getDemo().inputs).toEqual([{
            f: 12,
            t: 200,
            a: 'move',
            d: 1,
            q: true,
        }]);
    });

    it('does not keep unstable mid-physics checkpoints in new recordings', () => {
        const recorder = new DemoRecorder();
        const state = new GameState();
        state.randomGenerator = seededRandom(41);
        state.simFrame = 30;
        state.simTimeMs = 500;
        state.currentPiece = null;
        state.isProcessingPhysics = true;

        recorder.startRecording(state, {}, 41);
        recorder.recordCheckpoint(state, true);

        expect(recorder.getDemo().checkpoints).toEqual([]);
    });

    it('filters unstable saved checkpoints when loading demos', () => {
        const stableState = new GameState();
        stableState.randomGenerator = seededRandom(53);
        fillBag(stableState.nextPieces, stableState.randomGenerator);
        spawnPiece(stableState);
        stableState.simFrame = 60;
        stableState.simTimeMs = 1000;

        const unstableState = new GameState();
        unstableState.randomGenerator = seededRandom(53);
        unstableState.simFrame = 30;
        unstableState.simTimeMs = 500;
        unstableState.currentPiece = null;
        unstableState.isProcessingPhysics = true;

        const player = new DemoPlayer({});
        player.loadDemo(makeDemo({
            checkpoints: [
                {
                    f: 30,
                    t: 500,
                    inputIndex: 0,
                    state: captureGameStateSnapshot(unstableState),
                },
                {
                    f: 60,
                    t: 1000,
                    inputIndex: 0,
                    state: captureGameStateSnapshot(stableState),
                },
            ],
        }));

        expect(player.demo.checkpoints).toHaveLength(1);
        expect(player.demo.checkpoints[0].f).toBe(60);
    });

    it('keeps exact checkpoint simulation time instead of rounding it back to frame time', () => {
        const state = new GameState();
        state.randomGenerator = seededRandom(61);
        fillBag(state.nextPieces, state.randomGenerator);
        spawnPiece(state);
        state.simFrame = 64;
        state.simTimeMs = 1070;

        const player = new DemoPlayer({});
        player.loadDemo(makeDemo({
            checkpoints: [{
                f: 64,
                t: 1067,
                inputIndex: 0,
                state: captureGameStateSnapshot(state),
            }],
        }));

        expect(player.demo.checkpoints[0].t).toBe(1070);
    });

    it('does not rewind replay simulation time when applying an older buffered input', async () => {
        const player = new DemoPlayer({});
        const state = new GameState();
        state.simTickMs = DEMO_TICK_MS;
        state.simTimeMs = 1070;
        state.lastTime = 1070;
        state.simFrame = Math.round(1070 / DEMO_TICK_MS);
        player.gameState = state;
        player.lastSimulatedTime = 1070;

        const callbacks = {
            applyCommand: vi.fn(() => true),
        };

        await player._applyInput({
            f: 60,
            t: 1000,
            a: 'move',
            d: -1,
            q: true,
        }, callbacks);

        expect(callbacks.applyCommand).toHaveBeenCalledWith(
            {
                type: 'move',
                value: -1,
                a: 'move',
                d: -1,
            },
            {
                record: false,
                muted: false,
                callbacks,
            },
        );
        expect(state.simTimeMs).toBe(1070);
        expect(state.lastTime).toBe(1070);
        expect(state.simFrame).toBe(Math.round(1070 / DEMO_TICK_MS));
        expect(player.lastSimulatedTime).toBe(1070);
    });

    it('keeps replay timing mutations while muting replay presentation callbacks', () => {
        const timing = {
            onHardDrop: vi.fn(),
            onLineClearImpact: vi.fn(),
            onPerfectClear: vi.fn(),
        };
        const player = new DemoPlayer({});
        player.callbacks = {
            replayTimingCallbacks: timing,
            physicsCallbacks: {
                onHardDrop: vi.fn(),
                onLineClearImpact: vi.fn(),
                onPerfectClear: vi.fn(),
            },
        };

        const muted = player._getMutedCallbacks();
        muted.physicsCallbacks.onHardDrop({ distance: 5 });
        muted.physicsCallbacks.onLineClearImpact(4, 1);
        muted.physicsCallbacks.onPerfectClear(4, 1000);

        expect(timing.onHardDrop).toHaveBeenCalledWith({ distance: 5 });
        expect(timing.onLineClearImpact).toHaveBeenCalledWith(4, 1);
        expect(timing.onPerfectClear).toHaveBeenCalledWith(4, 1000);
        expect(player.callbacks.physicsCallbacks.onHardDrop).not.toHaveBeenCalled();
        expect(player.callbacks.physicsCallbacks.onLineClearImpact).not.toHaveBeenCalled();
        expect(player.callbacks.physicsCallbacks.onPerfectClear).not.toHaveBeenCalled();
    });

    it('advances replay simulation time for skipped line-clear animation delays', async () => {
        const state = new GameState();
        state.isReplay = true;
        state.isSeeking = true;
        state.simTimeMs = 1000;
        state.lastTime = 1000;
        state.simTickMs = DEMO_TICK_MS;
        state.hitStopRemaining = 70;
        state.lockedPieces = [{
            x: 0,
            y: state.boardGrid.length - 1,
            shape: [Array(10).fill(1)],
            shapeKey: 'I',
            color: '#ffffff',
            pieceId: 1,
        }];
        state.comboState = {
            manualColumns: [0],
            lockFootprint: Array.from({ length: 10 }, (_, x) => ({
                x,
                y: state.boardGrid.length - 1,
            })),
        };

        await processPhysics(state, {});

        expect(state.simTimeMs).toBe(1070);
        expect(state.lastTime).toBe(1070);
        expect(state.simFrame).toBe(Math.round(1070 / DEMO_TICK_MS));
        expect(state.hitStopRemaining).toBe(0);
    });

    it('restores game snapshots including RNG state', () => {
        const state = new GameState();
        state.randomGenerator = seededRandom(23);
        fillBag(state.nextPieces, state.randomGenerator);
        spawnPiece(state);
        state.score = 42;
        state.simTimeMs = 500;
        state.simFrame = 30;

        const snapshot = captureGameStateSnapshot(state);
        const expectedNextRandom = seededRandom(23);
        expectedNextRandom.setState(snapshot.rngState);

        state.score = 99;
        state.currentPiece.x += 3;
        state.randomGenerator();

        restoreGameStateSnapshot(state, snapshot, { seed: 23, isReplay: true });

        expect(state.score).toBe(42);
        expect(state.currentPiece.x).toBe(snapshot.currentPiece.x);
        expect(state.simFrame).toBe(30);
        expect(state.randomGenerator()).toBe(expectedNextRandom());
        expect(state.isReplay).toBe(true);
    });

    it('uses simulation time for lock bonus', () => {
        vi.spyOn(performance, 'now').mockImplementation(() => 999999);

        const state = new GameState();
        state.randomGenerator = seededRandom(31);
        fillBag(state.nextPieces, state.randomGenerator);
        spawnPiece(state);
        state.pieceSpawnTime = 0;
        state.simTimeMs = 1000;

        lockPiece(state, null, null);

        expect(state.score).toBe(20);
    });
});
