import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    applyRandomThemeRotation, shouldRotateRandomTheme, syncRandomThemeRotation,
} from '../../src/themes/random-theme-rotation.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

function stubManager() {
    const manager = {
        randomThemeInterval: null,
        randomThemeIntervalMinutes: null,
        startRandomThemeInterval: vi.fn((minutes) => {
            manager.randomThemeInterval = {};
            manager.randomThemeIntervalMinutes = minutes;
        }),
        stopRandomThemeInterval: vi.fn(() => { manager.randomThemeInterval = null; }),
    };
    return manager;
}

const running = (id) => ({ getModeId: () => id, isRunning: true });
const random = { backgroundMode: 'Random', randomThemeInterval: 60 };

describe('Random background: when its timer runs', () => {
    it('rotates only in a running game on a visible page, and never in Serenity or Odyssey', () => {
        const base = {
            backgroundMode: 'Random', modeId: 'single', modeRunning: true, hidden: false,
        };
        expect(shouldRotateRandomTheme(base)).toBe(true);
        expect(shouldRotateRandomTheme({ ...base, modeId: 'infinity' })).toBe(true);
        expect(shouldRotateRandomTheme({ ...base, modeId: null, modeRunning: false })).toBe(false); // the menu
        expect(shouldRotateRandomTheme({ ...base, hidden: true })).toBe(false);
        expect(shouldRotateRandomTheme({ ...base, backgroundMode: 'Level' })).toBe(false);
        expect(shouldRotateRandomTheme({ ...base, backgroundMode: 'Specific' })).toBe(false);
        expect(shouldRotateRandomTheme({ ...base, modeId: 'serenity' })).toBe(false);
        expect(shouldRotateRandomTheme({ ...base, modeId: 'odyssey' })).toBe(false);
    });

    it('stays off on the menu, starts with a game, keeps its cadence, and stops when hidden or left', () => {
        const themeManager = stubManager();
        const sync = (mode, settings = random, hidden = false) => applyRandomThemeRotation({
            themeManager, settings, mode, hidden,
        });

        expect(sync(null)).toBe(false); // boot, on the menu
        expect(themeManager.startRandomThemeInterval).not.toHaveBeenCalled();

        expect(sync(running('single'))).toBe(true);
        expect(themeManager.startRandomThemeInterval).toHaveBeenCalledWith(1);
        sync(running('single')); // a second sync does not reset the cadence
        expect(themeManager.startRandomThemeInterval).toHaveBeenCalledOnce();

        sync(running('single'), { ...random, randomThemeInterval: 120 });
        expect(themeManager.startRandomThemeInterval).toHaveBeenLastCalledWith(2);

        expect(sync(running('single'), random, true)).toBe(false);
        expect(themeManager.randomThemeInterval).toBeNull();
        sync(running('single'));
        expect(sync(running('single'), { ...random, backgroundMode: 'Level' })).toBe(false); // e.g. Steam Cloud
        expect(themeManager.randomThemeInterval).toBeNull();
    });

    it('reads the app for main.js: its settings, its current mode and the page', () => {
        const app = {
            themeManager: stubManager(),
            settingsManager: { get: () => random },
            gameModeManager: { getCurrentMode: () => running('infinity') },
        };
        expect(syncRandomThemeRotation(app)).toBe(true);
        vi.stubGlobal('document', { hidden: true });
        expect(syncRandomThemeRotation(app)).toBe(false);
        vi.unstubAllGlobals();
    });
});

describe('Random background: the timer itself never switches behind the menu or a hidden page', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function makeManager() {
        const collection = { isUnlocked: () => true, subscribe: () => () => {} };
        const manager = new TestThemeManager(null, { themeCollection: collection, assetManager: {} });
        manager.queueAdjacentThemePreload = vi.fn();
        manager.loadTheme = vi.fn(async (name) => ({
            name, async start() { return true; }, stop() {}, cleanup() {},
        }));
        manager.getRandomTheme = () => 'ocean';
        return manager;
    }

    it('skips its ticks while the themes are parked for the menu', async () => {
        vi.useFakeTimers();
        const manager = makeManager();
        const switchTheme = vi.spyOn(manager, 'switchTheme');
        manager.themesSuspended = true;
        manager.startRandomThemeInterval(1);
        await vi.advanceTimersByTimeAsync(180000);
        expect(switchTheme).not.toHaveBeenCalled();
        manager.stopRandomThemeInterval();
    });

    it('skips its ticks while the page is hidden, and switches once a tick when shown', async () => {
        vi.useFakeTimers();
        const manager = makeManager();
        const switchTheme = vi.spyOn(manager, 'switchTheme').mockResolvedValue('ocean');
        manager.themesSuspended = false; // in a game (the manager starts suspended, for the menu)
        vi.stubGlobal('document', { hidden: true });
        manager.startRandomThemeInterval(1);
        await vi.advanceTimersByTimeAsync(120000);
        expect(switchTheme).not.toHaveBeenCalled();
        vi.stubGlobal('document', { hidden: false });
        await vi.advanceTimersByTimeAsync(60000);
        expect(switchTheme).toHaveBeenCalledOnce();
        manager.stopRandomThemeInterval();
    });
});
