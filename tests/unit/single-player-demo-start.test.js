import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { SinglePlayerMode } from '../../src/core/game-modes/SinglePlayerMode.js';
import { GameState } from '../../src/core/game.js';
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
