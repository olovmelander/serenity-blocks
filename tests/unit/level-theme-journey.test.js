import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    LEVELS_PER_THEME, LevelThemeJourney, dealOnTop, levelStage,
} from '../../src/themes/level-theme-journey.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

function makeManager(owned, active = null) {
    const owners = new Set(owned);
    const listeners = new Set();
    const collection = {
        isUnlocked: (id) => owners.has(id),
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        grant: (id) => {
            owners.add(id);
            listeners.forEach((listener) => listener());
        },
        touch: () => listeners.forEach((listener) => listener()),
    };
    const manager = new TestThemeManager(null, { themeCollection: collection, assetManager: {} });
    manager.activeThemeName = active;
    // A switch that lands at once, unless a test holds it in flight.
    manager.switchTheme = vi.fn(async (id) => {
        manager.activeThemeName = id;
        return id;
    });
    return { manager, collection };
}

/** Play levels `from`..`to`, letting each requested switch land; returns one theme per stretch. */
function play(manager, from, to) {
    const stretches = [];
    for (let level = from; level <= to; level += 1) {
        manager.followLevelJourney(level);
        if ((level - 1) % LEVELS_PER_THEME === 0) stretches.push(manager.activeThemeName);
    }
    return stretches;
}

const FIVE = ['fall', 'forest', 'ocean', 'summer', 'winter'];

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('level stages', () => {
    it('holds three levels per stretch', () => {
        expect(LEVELS_PER_THEME).toBe(3);
        expect([1, 2, 3, 4, 6, 7, 30].map(levelStage)).toEqual([0, 0, 0, 1, 1, 2, 9]);
        expect([0, -5, undefined, 'x'].map(levelStage)).toEqual([0, 0, 0, 0]);
    });

    it('deals newly owned themes on top of the deck without duplicating them', () => {
        expect(dealOnTop(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c', 'b']);
        const dealt = dealOnTop(['a'], ['x', 'y']);
        expect(dealt[0]).toBe('a');
        expect(new Set(dealt.slice(1))).toEqual(new Set(['x', 'y']));
    });
});

describe('LevelThemeJourney', () => {
    function makeJourney(onScreen = 'forest') {
        const draws = ['ocean', 'winter', 'fall'];
        const drawNext = vi.fn(() => draws.shift());
        const journey = new LevelThemeJourney({
            onScreen: () => onScreen,
            drawNext,
            isOwned: (id) => id !== 'locked',
        });
        return { journey, drawNext };
    }

    it('starts on the theme on screen and draws one new theme per stretch', () => {
        const { journey, drawNext } = makeJourney();
        const themes = [1, 2, 3, 4, 5, 6, 7].map((level) => journey.themeFor(level));
        expect(themes).toEqual(['forest', 'forest', 'forest', 'ocean', 'ocean', 'ocean', 'winter']);
        expect(drawNext.mock.calls).toEqual([['forest'], ['ocean']]);
    });

    it('asks for a switch once per stretch, even while that switch is still building', () => {
        const { journey } = makeJourney();
        expect(journey.nextSwitch(1, 'forest')).toBeNull();
        expect(journey.nextSwitch(4, 'forest')).toBe('ocean');
        for (let frame = 0; frame < 20; frame += 1) {
            expect(journey.nextSwitch(4, 'forest')).toBeNull();
        }
        expect(journey.nextSwitch(5, 'ocean')).toBeNull();
    });

    it('treats a lower level as a new game and starts over from the screen', () => {
        const { journey, drawNext } = makeJourney('summer');
        journey.restart(1, 'forest');
        journey.themeFor(7);
        expect(journey.themeFor(1)).toBe('summer');
        expect(drawNext).toHaveBeenCalledTimes(1);
    });

    it('skips a start theme the player does not own', () => {
        const { journey } = makeJourney();
        expect(journey.restart(1, 'locked')).toBe('forest');
        expect(journey.restart(4, 'ocean')).toBe('ocean');
        expect(journey.stage).toBe(1);
    });
});

describe('ThemeManager level journey', () => {
    it('shows every owned theme once before any repeats, from the theme on screen', () => {
        const { manager } = makeManager(FIVE, 'ocean');
        manager.restartLevelJourney(1);
        const stretches = play(manager, 1, 15);
        expect(stretches[0]).toBe('ocean');
        expect(new Set(stretches)).toEqual(new Set(FIVE));
        expect(manager.switchTheme).toHaveBeenCalledTimes(4);
    });

    it('does not open every game with the same run of themes', () => {
        const openings = new Set();
        for (let game = 0; game < 12; game += 1) {
            const { manager } = makeManager(FIVE, 'forest');
            manager.restartLevelJourney(1);
            openings.add(play(manager, 1, 9).join(','));
        }
        expect(openings.size).toBeGreaterThan(1);
    });

    it('carries on from the last theme of the previous game', () => {
        const { manager } = makeManager(FIVE, 'forest');
        manager.restartLevelJourney(1);
        const first = play(manager, 1, 12);
        manager.restartLevelJourney(1);
        const second = play(manager, 1, 3);
        expect(second[0]).toBe(first.at(-1));
        expect(manager.switchTheme).toHaveBeenCalledTimes(3);
    });

    it('requests a switch once while it is in flight', () => {
        const { manager } = makeManager(FIVE, 'forest');
        manager.switchTheme = vi.fn(() => new Promise(() => {}));
        manager.restartLevelJourney(1);
        for (let frame = 0; frame < 30; frame += 1) manager.followLevelJourney(4);
        expect(manager.switchTheme).toHaveBeenCalledTimes(1);
    });

    it('opens the app on the player\'s chosen theme when they own it', () => {
        const { manager } = makeManager(FIVE);
        expect(manager.restartLevelJourney(1, 'winter')).toBe('winter');
        expect(manager.restartLevelJourney(1, 'lunara')).toBe('forest');
    });

    it('shows a newly unlocked theme at the next change', () => {
        const { manager, collection } = makeManager(FIVE, 'forest');
        manager.restartLevelJourney(1);
        play(manager, 1, 4);
        collection.grant('lunara');
        expect(play(manager, 5, 7)).toEqual(['lunara']);
    });

    it('keeps the deck when a collection update grants nothing', () => {
        const { manager, collection } = makeManager(FIVE, 'forest');
        manager.themeShuffleDeck = ['ocean', 'winter'];
        collection.touch();
        expect(manager.themeShuffleDeck).toEqual(['ocean', 'winter']);
    });
});
