/**
 * Two things that outlived what they belonged to: Serenity turned a controller the player had
 * disabled back on for the rest of the session, and the "Watching Replay" badge stayed over the
 * menu and the next run after a replay was left through the pause menu.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));

const { SerenityMode } = await import('../../src/core/game-modes/SerenityMode.js');

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
