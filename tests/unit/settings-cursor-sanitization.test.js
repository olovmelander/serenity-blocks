import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsManager } from '../../src/ui/settings.js';

const STORAGE_KEY = 'serenityBlocksSettings';

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

describe('SettingsManager custom cursor sanitization', () => {
    beforeEach(() => {
        globalThis.localStorage = createLocalStorageMock();
    });

    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('sanitizes invalid custom cursor settings on load and persists the cleaned values', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            customCursorEnabled: 'true',
            customCursorIntensity: 'cinematic',
            customCursorVisibilityPreset: 'massive',
            customCursorReducedMotion: 'sometimes',
        }));

        const manager = new SettingsManager();
        const loaded = manager.load();

        expect(loaded.customCursorEnabled).toBe(true);
        expect(loaded.customCursorIntensity).toBe('standard');
        expect(loaded.customCursorVisibilityPreset).toBe('standard');
        expect(loaded.customCursorReducedMotion).toBe('system');

        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY));
        expect(persisted.customCursorEnabled).toBe(true);
        expect(persisted.customCursorIntensity).toBe('standard');
        expect(persisted.customCursorVisibilityPreset).toBe('standard');
        expect(persisted.customCursorReducedMotion).toBe('system');
    });

    it('sanitizes invalid custom cursor settings during update', () => {
        const manager = new SettingsManager();

        manager.update({
            customCursorEnabled: null,
            customCursorIntensity: 'extreme',
            customCursorVisibilityPreset: 'max',
            customCursorReducedMotion: 'maybe',
        }, false);

        const updated = manager.get();
        expect(updated.customCursorEnabled).toBe(true);
        expect(updated.customCursorIntensity).toBe('standard');
        expect(updated.customCursorVisibilityPreset).toBe('standard');
        expect(updated.customCursorReducedMotion).toBe('system');
    });
});
