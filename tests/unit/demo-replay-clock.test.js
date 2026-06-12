import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { DemoPlayer } from '../../src/core/demo/DemoPlayer.js';
import { DemoRecorder, DEMO_TICK_MS } from '../../src/core/demo/DemoRecorder.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot } from '../../src/core/demo/demo-state.js';
import {
    GameState,
    fillBag,
    lockPiece,
    spawnPiece,
} from '../../src/core/game.js';
import { processPhysics } from '../../src/core/physics.js';
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
        let clock = 1000;
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
    });

    it('records accepted commands as v2 frame-indexed inputs', () => {
        const recorder = new DemoRecorder();
        const state = new GameState();
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
        expect(demo.inputs).toEqual([{ f: 6, t: 100, a: 'move', d: -1 }]);
        expect(demo.metadata.durationFrames).toBe(6);
        expect(demo.checkpoints.length).toBeGreaterThan(0);
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
