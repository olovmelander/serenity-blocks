/**
 * Waystones was removed on 2026-10-18. A player who last chose it still has
 * `gameMode: 'waystones'` saved, and startup preloads the saved mode (an unknown id throws
 * in GameModeManager._ensureMode), so settings heal a retired mode to the default on load.
 */
import {
    afterEach, beforeEach, describe, expect, it,
} from 'vitest';
import { SettingsManager } from '../../src/ui/settings.js';
import { GAME_MODES } from '../../src/core/constants.js';

const STORAGE_KEY = 'serenityBlocksSettings';

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('a saved game mode the game no longer has', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('heals to Single Player on load and writes the healed value back', () => {
        expect(Object.values(GAME_MODES)).not.toContain('waystones');
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameMode: 'waystones', musicVolume: 0.4 }));
        const loaded = new SettingsManager().load();
        expect(loaded.gameMode).toBe(GAME_MODES.SINGLE_PLAYER);
        expect(loaded.musicVolume).toBe(0.4);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).gameMode).toBe(GAME_MODES.SINGLE_PLAYER);
    });

    it('keeps every mode the game still has', () => {
        for (const mode of Object.values(GAME_MODES)) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameMode: mode }));
            expect(new SettingsManager().load().gameMode).toBe(mode);
        }
    });
});
