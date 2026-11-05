/**
 * Two things that outlived what they belonged to: Serenity turned a controller the player had
 * disabled back on for the rest of the session, and the "Watching Replay" badge stayed over the
 * menu and the next run after a replay was left through the pause menu.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
vi.mock('../../src/ui/next-queue-ui.js', () => ({ updateNextQueue: vi.fn() }));

const { SerenityMode } = await import('../../src/core/game-modes/SerenityMode.js');
const { SinglePlayerMode } = await import('../../src/core/game-modes/SinglePlayerMode.js');
const { GameState } = await import('../../src/core/game.js');
const { DEMO_LEGACY_SIMULATION_CLOCK } = await import('../../src/core/demo/DemoRecorder.js');

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Serenity and the controller setting', () => {
    function mode(settings) {
        const gamepadController = { enable: vi.fn(), disableMenuNavigation: vi.fn() };
        const serenity = Object.create(SerenityMode.prototype);
        serenity.deps = { gamepadController, settingsManager: settings && { get: () => settings } };
        vi.spyOn(console, 'log').mockImplementation(() => {});
        return { gamepadController, serenity };
    }

    it('leaves a controller the player disabled off', () => {
        const { gamepadController, serenity } = mode({ gamepadEnabled: false });

        serenity._prepareGamepad();

        expect(gamepadController.enable).not.toHaveBeenCalled();
    });

    it('turns an enabled controller on and hands it to Serenity', () => {
        const { gamepadController, serenity } = mode({ gamepadEnabled: true });

        serenity._prepareGamepad();

        expect(gamepadController.enable).toHaveBeenCalledOnce();
        expect(gamepadController.disableMenuNavigation).toHaveBeenCalledOnce();
    });

    it('keeps the default on where no setting can be read', () => {
        const { gamepadController, serenity } = mode(null);

        serenity._prepareGamepad();

        expect(gamepadController.enable).toHaveBeenCalledOnce();
    });

    it('still takes menu navigation away from a disabled controller', () => {
        const { gamepadController, serenity } = mode({ gamepadEnabled: false });

        serenity._prepareGamepad();

        expect(gamepadController.disableMenuNavigation).toHaveBeenCalledOnce();
    });

    it('asks nothing of a game with no controller', () => {
        const serenity = Object.create(SerenityMode.prototype);
        serenity.deps = {};

        expect(() => serenity._prepareGamepad()).not.toThrow();
    });
});

describe('the Watching Replay badge', () => {
    function replaying({ playingDemo }) {
        const names = new Set(['visible']);
        const badge = {
            classList: { toggle: (name, on) => (on ? names.add(name) : names.delete(name)) },
        };
        vi.stubGlobal('document', {
            getElementById: (id) => (id === 'demo-indicator' ? badge : null),
            querySelector: () => null,
            querySelectorAll: () => [],
        });
        vi.stubGlobal('window', { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} });
        vi.stubGlobal('cancelAnimationFrame', () => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});

        const mode = new SinglePlayerMode({ settingsManager: { get: () => ({}) }, frameRateController: { stopHybridLoop() {} } });
        const gameState = new GameState({});
        mode.isActive = true;
        mode.isRunning = true;
        mode.isPlayingDemo = playingDemo;
        mode.gameState = gameState;
        mode._sessionGeneration = 1;
        mode._activeSession = Object.freeze({
            generation: 1, gameState, simulationClock: DEMO_LEGACY_SIMULATION_CLOCK, rngDescriptor: null,
        });
        mode.playbackControls = { hide: vi.fn(), show: vi.fn() };
        mode.demoPlayer.stopPlayback = vi.fn();
        return { mode, names };
    }

    it('leaves with the replay', async () => {
        const { mode, names } = replaying({ playingDemo: true });

        await mode.onStop();

        expect(names.has('visible')).toBe(false);
        expect(mode.playbackControls.hide).toHaveBeenCalled();
    });

    it('is not touched by a stop that was no replay', async () => {
        const { mode, names } = replaying({ playingDemo: false });

        await mode.onStop();

        expect(names.has('visible')).toBe(true);
    });
});
