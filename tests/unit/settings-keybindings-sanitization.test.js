import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsManager } from '../../src/ui/settings.js';

const STORAGE_KEY = 'serenityBlocksSettings';
const GAMEPLAY_ACTIONS = [
    'moveLeft',
    'moveRight',
    'rotateRight',
    'rotateLeft',
    'flip',
    'softDrop',
    'hardDrop',
];

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        },
        clear() {
            store.clear();
        },
    };
}

describe('SettingsManager keybinding sanitization', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });

    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('sanitizes legacy Serenity keybind fields on load and persists cleaned settings', () => {
        const seeded = {
            keyBindings: {
                moveLeft: 'j',
                nextTrack: 'Shift',
                randomTheme: 'b',
                toggleFullscreen: 'f',
                togglePause: 'p',
            },
            player2KeyBindings: {
                moveRight: 'l',
                nextTrack: 'Shift',
            },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));

        const manager = new SettingsManager();
        const loaded = manager.load();

        expect(loaded.keyBindings.moveLeft).toBe('j');
        expect(loaded.player2KeyBindings.moveRight).toBe('l');
        expect(loaded.keyBindings.nextTrack).toBeUndefined();
        expect(loaded.keyBindings.randomTheme).toBeUndefined();
        expect(loaded.keyBindings.toggleFullscreen).toBeUndefined();
        expect(loaded.keyBindings.togglePause).toBeUndefined();
        expect(loaded.player2KeyBindings.nextTrack).toBeUndefined();
        expect(Object.keys(loaded.keyBindings).sort()).toEqual([...GAMEPLAY_ACTIONS].sort());
        expect(Object.keys(loaded.player2KeyBindings).sort()).toEqual([...GAMEPLAY_ACTIONS].sort());

        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.keyBindings.nextTrack).toBeUndefined();
        expect(persisted.keyBindings.randomTheme).toBeUndefined();
        expect(persisted.keyBindings.toggleFullscreen).toBeUndefined();
        expect(persisted.keyBindings.togglePause).toBeUndefined();
        expect(persisted.player2KeyBindings.nextTrack).toBeUndefined();
        expect(Object.keys(persisted.keyBindings).sort()).toEqual([...GAMEPLAY_ACTIONS].sort());
        expect(Object.keys(persisted.player2KeyBindings).sort()).toEqual([...GAMEPLAY_ACTIONS].sort());
    });

    it('sanitizes unknown keybinding fields during update', () => {
        const manager = new SettingsManager();

        manager.update({
            keyBindings: {
                moveLeft: 'j',
                nextTrack: 'Shift',
                randomTheme: 'b',
            },
            player2KeyBindings: {
                moveRight: 'l',
                toggleFullscreen: 'f',
            },
        }, false);

        const updated = manager.get();
        expect(updated.keyBindings.moveLeft).toBe('j');
        expect(updated.player2KeyBindings.moveRight).toBe('l');
        expect(updated.keyBindings.nextTrack).toBeUndefined();
        expect(updated.keyBindings.randomTheme).toBeUndefined();
        expect(updated.player2KeyBindings.toggleFullscreen).toBeUndefined();
        expect(Object.keys(updated.keyBindings).sort()).toEqual([...GAMEPLAY_ACTIONS].sort());
        expect(Object.keys(updated.player2KeyBindings).sort()).toEqual([...GAMEPLAY_ACTIONS].sort());
    });

    it('removes stale unknown bindings even when update does not include keyBindings', () => {
        const manager = new SettingsManager();
        manager.settings.keyBindings = {
            ...manager.settings.keyBindings,
            nextTrack: 'Shift',
        };
        manager.settings.player2KeyBindings = {
            ...manager.settings.player2KeyBindings,
            randomTheme: 'b',
        };

        manager.update({ musicVolume: 0.4 }, false);
        const updated = manager.get();

        expect(updated.keyBindings.nextTrack).toBeUndefined();
        expect(updated.player2KeyBindings.randomTheme).toBeUndefined();
        expect(updated.musicVolume).toBe(0.4);
    });
});
