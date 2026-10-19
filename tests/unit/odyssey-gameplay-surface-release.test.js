/* eslint-disable import/first */
/**
 * Odyssey hides the shared gameplay surfaces inline (the board container, the Phaser host,
 * the stats bar and the theme layer) while its map is up, and only a level's reveal shows
 * them again. Leaving from the map to the menu kept them hidden for the next mode: Infinity
 * played and locked pieces on a black screen, and a theme switch could not lift it, because
 * the theme layer itself sat at opacity 0. Deactivation hands them back.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// BoardJuice's renderer alias is outside the Vitest resolver; this path never constructs it.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { InfinityMode } from '../../src/core/game-modes/InfinityMode.js';

const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The slice of CSSStyleDeclaration the modes use: camelCase assignment and setProperty. */
function createStyle() {
    const values = new Map();
    const api = {
        setProperty(name, value) { values.set(name, String(value)); },
        removeProperty(name) { values.delete(name); },
        getPropertyValue(name) { return values.get(name) ?? ''; },
    };
    return new Proxy(api, {
        get: (target, key) => (key in target ? target[key] : values.get(kebab(String(key))) ?? ''),
        set: (target, key, value) => {
            if (value === '') target.removeProperty(kebab(String(key)));
            else target.setProperty(kebab(String(key)), value);
            return true;
        },
    });
}

function createElement() {
    return {
        style: createStyle(),
        classList: { add: vi.fn(), remove: vi.fn() },
        dataset: {},
    };
}

function createPage() {
    const ids = {
        'single-player-container': createElement(),
        'phaser-game-container': createElement(),
        'multiplayer-container': createElement(),
        'intro-animation': createElement(),
    };
    const selectors = {
        '.single-player-stage': createElement(),
        '.single-player-stats-bar': createElement(),
        '.background-container': createElement(),
    };
    return {
        ids,
        selectors,
        document: {
            getElementById: (id) => ids[id] || null,
            querySelector: (selector) => selectors[selector] || null,
        },
    };
}

function createOdyssey() {
    const mode = Object.create(OdysseyMode.prototype);
    [
        '_ensureOdysseyNavigatorButton', '_showCinematicLoadingOverlay',
        'closeOdysseyNavigator', 'setOdysseyNavigatorButtonVisible',
    ].forEach((method) => { mode[method] = vi.fn(); });
    return mode;
}

function createInfinity() {
    const mode = Object.create(InfinityMode.prototype);
    mode.deps = {};
    return mode;
}

describe('Odyssey hands the gameplay surfaces back on deactivation', () => {
    let page;

    beforeEach(() => {
        page = createPage();
        vi.stubGlobal('document', page.document);
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([
        ['the map, never entering a level', () => {}],
        ['the map, back from a level', (mode) => mode._hideGameplaySurfaceForBoardReturn()],
    ])('Infinity started after leaving from %s is not hidden', async (_path, onMap) => {
        const odyssey = createOdyssey();
        odyssey._showOdysseyUI();
        onMap(odyssey);
        // onDeactivate's UI teardown; main.js then hides the containers for the menu.
        odyssey._hideOdysseyUI();
        page.ids['single-player-container'].style.display = 'none';

        await createInfinity().onActivate();

        const surfaces = [
            page.ids['single-player-container'],
            page.ids['phaser-game-container'],
            page.selectors['.single-player-stats-bar'],
            page.selectors['.background-container'],
        ];
        surfaces.forEach(({ style }) => {
            expect(style.visibility).not.toBe('hidden');
            expect(style.opacity).toBe('');
        });
        expect(page.ids['single-player-container'].style.display).toBe('flex');
    });
});
