/**
 * Fault Lines became Stillfall on 2026-10-18. What a player already has still means it: the
 * solves saved under the old key, a saved game mode of 'fault-lines' and the mode's id
 * everywhere the game names it.
 */
import {
    afterEach, beforeEach, describe, expect, it,
} from 'vitest';
import { GAME_MODES } from '../../src/core/constants.js';
import { SettingsManager } from '../../src/ui/settings.js';
import { readSolvedStillfall } from '../../src/ui/stillfall/stillfall-hud.js';

const OLD_SOLVED = 'serenity.faultLines.solved';
const NEW_SOLVED = 'serenity.stillfall.solved';

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); },
    };
}

describe('Fault Lines became Stillfall', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });
    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('names the mode stillfall, and the old id is no mode', () => {
        expect(GAME_MODES.STILLFALL).toBe('stillfall');
        expect(Object.values(GAME_MODES)).not.toContain('fault-lines');
    });

    it('moves the solves saved under the old key, once', () => {
        localStorage.setItem(OLD_SOLVED, JSON.stringify(['first-fall', 'staircase']));
        expect(readSolvedStillfall()).toEqual(['first-fall', 'staircase']);
        expect(JSON.parse(localStorage.getItem(NEW_SOLVED))).toEqual(['first-fall', 'staircase']);
        expect(localStorage.getItem(OLD_SOLVED)).toBeNull();
        // The new key wins from then on.
        localStorage.setItem(OLD_SOLVED, JSON.stringify(['lanterns']));
        expect(readSolvedStillfall()).toEqual(['first-fall', 'staircase']);
    });

    it('reads nothing when there is nothing to move', () => {
        expect(readSolvedStillfall()).toEqual([]);
        expect(localStorage.getItem(NEW_SOLVED)).toBeNull();
    });

    it('heals a saved game mode of fault-lines to stillfall and writes it back', () => {
        localStorage.setItem('serenityBlocksSettings', JSON.stringify({ gameMode: 'fault-lines', musicVolume: 0.3 }));
        const loaded = new SettingsManager().load();
        expect(loaded.gameMode).toBe(GAME_MODES.STILLFALL);
        expect(loaded.musicVolume).toBe(0.3);
        expect(JSON.parse(localStorage.getItem('serenityBlocksSettings')).gameMode).toBe('stillfall');
    });
});
