import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { ThemeManager } from '../../src/themes/theme-manager.js';

// A theme the boot pre-warm built hidden must still be revealed when it becomes the active
// theme. The pre-warm hides a theme through a flag on the theme object; a visible
// activation that runs while the warm is still in flight (the player entered a mode
// mid-warm) used to read that flag and leave the container hidden behind a running theme.
// The starter theme makes that window seconds long now that it has real assets to load.

function fakeClassList(initial = []) {
    const names = new Set(initial);
    return {
        add: (name) => names.add(name),
        remove: (name) => names.delete(name),
        contains: (name) => names.has(name),
    };
}

function fakeContainer(id, classes = ['theme-container'], inline = {}) {
    const style = { ...inline };
    return {
        id,
        classList: fakeClassList(classes),
        style: {
            ...style,
            removeProperty(name) {
                delete this[name];
            },
        },
    };
}

function stubDocument(containers) {
    vi.stubGlobal('document', {
        getElementById: (id) => containers.find((container) => container.id === id) || null,
        querySelectorAll: () => containers,
        createElement: () => fakeContainer('created'),
        body: { appendChild: () => {} },
    });
}

function makeManager() {
    return new ThemeManager(
        { clearThemeResources: vi.fn(), cleanup: vi.fn() },
        { assetManager: {} },
    );
}

describe('a pre-warmed theme is revealed when it becomes the active theme', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('a visible activation clears the pre-warm hidden flag before the theme starts', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        stubDocument([fakeContainer('forest-theme')]);
        const manager = makeManager();
        const seen = [];
        const theme = {
            name: 'forest',
            _prewarmHidden: true,
            isActive: false,
            isPaused: false,
            cleanup: vi.fn(),
            async start() {
                seen.push(this._prewarmHidden);
                this.isActive = true;
                this.hasStarted = true;
                this.lifecycleState = 'running';
                return true;
            },
        };
        await manager.activateThemeInstance(theme, 'forest');
        expect(seen).toEqual([false]);
        expect(theme._prewarmHidden).toBe(false);
        manager.cleanup();
    });

    it('reveals the container of a running theme and hides every other', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const forest = fakeContainer('forest-theme', ['theme-container'], { opacity: '0', visibility: 'hidden' });
        const ocean = fakeContainer('ocean-theme', ['theme-container', 'active']);
        stubDocument([forest, ocean]);
        const manager = makeManager();
        const theme = { name: 'forest', isActive: true, isPaused: false };
        expect(manager.revealThemeContainer(theme, 'forest')).toBe(true);
        expect(forest.classList.contains('active')).toBe(true);
        expect(ocean.classList.contains('active')).toBe(false);
        // Inline styles outrank the class: they must go too.
        expect(forest.style.opacity).toBeUndefined();
        expect(forest.style.visibility).toBeUndefined();
        manager.cleanup();
    });

    it('leaves a paused, stopped or already visible theme alone', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const forest = fakeContainer('forest-theme');
        const ocean = fakeContainer('ocean-theme', ['theme-container', 'active']);
        stubDocument([forest, ocean]);
        const manager = makeManager();
        const paused = { name: 'forest', isActive: true, isPaused: true };
        const stopped = { name: 'forest', isActive: false, isPaused: false };
        expect(manager.revealThemeContainer(paused, 'forest')).toBe(false);
        expect(manager.revealThemeContainer(stopped, 'forest')).toBe(false);
        expect(manager.revealThemeContainer(null, 'forest')).toBe(false);
        expect(forest.classList.contains('active')).toBe(false);
        expect(ocean.classList.contains('active')).toBe(true);
        const running = (name) => ({ name, isActive: true, isPaused: false });
        expect(manager.revealThemeContainer(running('ocean'), 'ocean')).toBe(false);
        expect(manager.revealThemeContainer(running('missing'), 'missing')).toBe(false);
        manager.cleanup();
    });
});
