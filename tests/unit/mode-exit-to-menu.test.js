/* eslint-disable import/first */
/**
 * "Back to menu" from Odyssey's level select and from Serenity asks the app to return
 * to the menu (EXIT_TO_MAIN_MENU → main.js _returnToMainMenu, which stops and
 * deactivates the mode through GameModeManager, then shows the menu). Both modes used
 * to deactivate themselves and dispatch a window 'returnToMenu' event that nothing
 * turned into a menu: a blank screen with the manager still holding the inactive mode
 * (audit 2026-10-13: LIFE-03).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

// BoardJuice's renderer alias is outside the Vitest resolver; this path never constructs it.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
import { readFileSync } from 'node:fs';
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { SerenityMode } from '../../src/core/game-modes/SerenityMode.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe.each([['Odyssey', OdysseyMode], ['Serenity', SerenityMode]])('%s "Back to menu"', (_name, Mode) => {
    it('asks the app to return to the menu instead of tearing itself down', async () => {
        const mode = Object.create(Mode.prototype);
        mode.onStop = vi.fn();
        mode.onDeactivate = vi.fn();
        const dispatchEvent = vi.fn();
        vi.stubGlobal('window', { dispatchEvent });
        const requests = vi.fn();
        const off = eventBus.on(EVENTS.EXIT_TO_MAIN_MENU, requests);

        await mode._exitToMenu();
        off();

        expect(requests).toHaveBeenCalledOnce();
        expect(mode.onStop).not.toHaveBeenCalled();
        expect(mode.onDeactivate).not.toHaveBeenCalled();
        expect(dispatchEvent).not.toHaveBeenCalled();
    });
});

it('main.js answers EXIT_TO_MAIN_MENU by stopping and deactivating the mode through the manager', () => {
    const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/eventBus\.on\(EVENTS\.EXIT_TO_MAIN_MENU, \(\) => \{\s*this\._returnToMainMenu\(\);/);
    expect(main).toMatch(/async _returnToMainMenu\(\) \{[\s\S]*?await this\.gameModeManager\.stopCurrentMode\(\);\s*await this\.gameModeManager\.deactivateCurrentMode\(\);[\s\S]*?this\.modalManager\.show\('start'\);/);
});
