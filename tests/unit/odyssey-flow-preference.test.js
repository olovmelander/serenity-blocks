import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createBoardInfoOverlay } from '../../src/ui/odyssey/BoardInfoOverlay.js';
import { SettingsManager } from '../../src/ui/settings.js';

let managers;

function createManager() {
    const manager = new SettingsManager();
    managers.push(manager);
    return manager;
}

function stubOverlayDocument() {
    const input = new EventTarget();
    input.checked = false;
    vi.stubGlobal('document', {
        createElement: () => ({
            innerHTML: '',
            querySelector: (selector) => (selector === '#odyssey-auto-continue' ? input : null),
        }),
    });
    return input;
}

beforeEach(() => {
    managers = [];
    const store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => store.set(key, value),
    });
    vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
    managers.forEach((manager) => manager.dispose());
    vi.unstubAllGlobals();
});

describe('Odyssey journey flow preference', () => {
    it('enables continuous play for new players and old saves without the preference', () => {
        const fresh = createManager();
        expect(fresh.get().odysseyAutoContinue).toBe(true);
        localStorage.setItem(fresh.STORAGE_KEY, JSON.stringify({ musicVolume: 0.3 }));
        const upgraded = createManager();
        upgraded.load();
        expect(upgraded.get().odysseyAutoContinue).toBe(true);
        expect(upgraded.get().musicVolume).toBe(0.3);
    });

    it('offers a labelled choice before Play and preserves either selection across reloads', () => {
        const manager = createManager();
        const input = stubOverlayDocument();
        const onAutoContinueChange = vi.fn((odysseyAutoContinue) => {
            manager.update({ odysseyAutoContinue });
            manager.save();
        });
        const { overlay } = createBoardInfoOverlay({
            autoContinue: manager.get().odysseyAutoContinue,
            onAutoContinueChange,
        });
        expect(input.checked).toBe(true);
        expect(overlay.innerHTML).toContain('for="odyssey-auto-continue"');
        expect(overlay.innerHTML).toContain('aria-describedby="odyssey-flow-preference-hint"');
        expect(overlay.innerHTML).toContain('Chapter reveals wait for you.');
        expect(overlay.innerHTML.indexOf('id="odyssey-auto-continue"'))
            .toBeLessThan(overlay.innerHTML.indexOf('id="level-panel-play-btn"'));
        expect(onAutoContinueChange).not.toHaveBeenCalled();

        for (const enabled of [false, true]) {
            input.checked = enabled;
            input.dispatchEvent(new Event('change'));
            expect(onAutoContinueChange).toHaveBeenLastCalledWith(enabled);
            const reloaded = createManager();
            reloaded.load();
            expect(reloaded.get().odysseyAutoContinue).toBe(enabled);
        }
        expect(onAutoContinueChange).toHaveBeenCalledTimes(2);
    });

    it('renders a returning player’s manual choice without resetting or saving it', () => {
        const input = stubOverlayDocument();
        const onAutoContinueChange = vi.fn();
        createBoardInfoOverlay({ autoContinue: false, onAutoContinueChange });
        expect(input.checked).toBe(false);
        expect(onAutoContinueChange).not.toHaveBeenCalled();
    });
});
