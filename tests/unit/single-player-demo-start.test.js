import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { SinglePlayerMode } from '../../src/core/game-modes/SinglePlayerMode.js';
import { GameState, spawnPiece } from '../../src/core/game.js';
import { DEMO_FIXED_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

describe('SinglePlayerMode demo start validation', () => {
    beforeEach(() => {
        vi.stubGlobal('document', { getElementById: () => null });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('rejects an unsupported demo before the mode enters its running state', async () => {
        const mode = new SinglePlayerMode({});
        mode.isActive = true;
        const demo = {
            version: '3.0',
            sim: {
                tickMs: 1000 / 60,
                durationFrames: 1,
                inputFormat: 'edges-v1',
            },
            initialState: { seed: 7, level: 1 },
            inputs: [],
            metadata: { duration: 17 },
        };

        await expect(mode.onStart({ demo })).rejects.toThrow('Unsupported or invalid demo data');

        expect(mode.isRunning).toBe(false);
        expect(mode.isPlayingDemo).toBe(false);
        expect(mode.gameState).toBeNull();
        expect(mode.demoPlayer.demo).toBeNull();
    });

    it('uses the latched GameState policy instead of live reduced-motion settings', () => {
        const mode = new SinglePlayerMode({
            settingsManager: { get: () => ({ reducedMotion: true }) },
        });
        mode.gameState = new GameState({ hitStopEnabled: true });

        mode._applyHardDropTiming();
        expect(mode.gameState.hitStopRemaining).toBe(30);

        mode.gameState = new GameState({ hitStopEnabled: false });
        mode._applyHardDropTiming();
        mode._applyPerfectClearTiming();
        expect(mode.gameState.hitStopRemaining).toBe(0);
    });

    it('binds fixed hit-stop producers to the captured clock and state', () => {
        const getClearTier = vi.fn(() => ({ hitStop: 999 }));
        const mode = new SinglePlayerMode({
            settingsManager: { get: () => ({ reducedMotion: false }) },
            soundManager: {
                sfxPlayer: {
                    playDrop: vi.fn(),
                    playPerfectClear: vi.fn(),
                },
            },
        });
        const capturedState = new GameState({ hitStopEnabled: true });
        mode.gameState = capturedState;
        mode._activeSession = Object.freeze({
            gameState: capturedState,
            generation: 1,
            simulationClock: DEMO_FIXED_SIMULATION_CLOCK,
        });
        mode._getBoardScene = vi.fn(() => ({
            playHardDropEffect: vi.fn(),
            playLineClearImpact: vi.fn(),
            sharedEffects: {
                getClearTier,
                playPerfectClear: vi.fn(),
            },
        }));
        const callbacks = mode._getPhysicsCallbacks();

        // Retiring the live flag and replacing the public state must not switch
        // an already-created fixed callback onto renderer-derived timing.
        mode._fixedTickEnabled = false;
        const replacementState = new GameState({ hitStopEnabled: true });
        mode.gameState = replacementState;

        callbacks.onHardDrop({});
        expect(capturedState.hitStopRemaining).toBe(30);
        callbacks.onLineClearImpact(4, 1);
        expect(capturedState.hitStopRemaining).toBe(70);
        callbacks.onPerfectClear(1, 0);
        expect(capturedState.hitStopRemaining).toBe(110);
        expect(replacementState.hitStopRemaining).toBe(0);
        expect(getClearTier).not.toHaveBeenCalled();
    });
});

// Audit 2026-11-18 A18-CORE-3: the pause sheet opened and closed over a replay.
describe('SinglePlayerMode pause sheet over a replay', () => {
    let clock;
    let frames;

    beforeEach(() => {
        // The game has been open for two minutes when the replay starts.
        clock = 120000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        frames = [];
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            frames.push(callback);
            return frames.length;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('document', { getElementById: () => null });
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function replayingMode() {
        const mode = new SinglePlayerMode({});
        expect(mode.demoPlayer.loadDemo({
            version: '2.0',
            sim: { tickMs: 1000 / 60 },
            initialState: { seed: 99, level: 1 },
            inputs: [],
            metadata: { duration: 4000 },
        })).toBe(true);
        const state = new GameState();
        mode.gameState = state;
        mode.isRunning = true;
        mode.isPlayingDemo = true;
        mode.demoPlayer.startPlayback({ spawnPiece: () => spawnPiece(state) }, state);
        return { mode, player: mode.demoPlayer, state };
    }

    const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    async function playFrames(count) {
        await settle();
        for (let i = 0; i < count; i += 1) {
            clock += 16;
            frames.shift()();
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
    }

    async function gravityAfter({ pauseSheet }) {
        frames.length = 0;
        const { mode, player, state } = replayingMode();
        await playFrames(15);
        if (pauseSheet) {
            mode.onPause();
            clock += 500;
            mode.onResume();
        }
        await playFrames(15);
        const result = { simTimeMs: state.simTimeMs, dropCounter: state.dropCounter };
        player.stopPlayback({ notify: false });
        return result;
    }

    it('keeps gravity on the replay clock across the sheet', async () => {
        const watched = await gravityAfter({ pauseSheet: false });
        const paused = await gravityAfter({ pauseSheet: true });

        expect(paused.simTimeMs).toBeCloseTo(watched.simTimeMs, 6);
        expect(paused.dropCounter).toBeCloseTo(watched.dropCounter, 6);
    });

    it('leaves a replay paused from the playback bar paused when the sheet closes', async () => {
        const { mode, player, state } = replayingMode();
        await playFrames(2);

        player.pausePlayback();
        mode.onPause();
        mode.onResume();

        expect(mode.isPaused).toBe(false);
        expect(player.isPaused).toBe(true);
        expect(state.isPaused).toBe(true);
        player.stopPlayback({ notify: false });
    });

    it('resumes a replay the sheet itself paused', async () => {
        const { mode, player, state } = replayingMode();
        await playFrames(2);

        mode.onPause();
        expect(player.isPaused).toBe(true);
        mode.onResume();

        expect(player.isPaused).toBe(false);
        expect(state.isPaused).toBe(false);
        player.stopPlayback({ notify: false });
    });
});
