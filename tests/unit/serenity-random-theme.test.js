import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { SerenityMode } from '../../src/core/game-modes/SerenityMode.js';

function makeMode() {
    const themeManager = {
        activeThemeName: 'forest',
        getRandomTheme: vi.fn(() => 'ocean'),
        canSelectTheme: vi.fn(() => true),
    };
    themeManager.switchTheme = vi.fn(async (theme) => {
        themeManager.activeThemeName = theme;
        return theme;
    });
    const mode = new SerenityMode({ themeManager });
    mode.isActive = true;
    mode._showNotification = vi.fn();
    return { mode, themeManager };
}

afterEach(() => vi.restoreAllMocks());

describe('Serenity random-theme feedback', () => {
    it('waits for an actual theme change before announcing it', async () => {
        const { mode, themeManager } = makeMode();
        let finish;
        themeManager.switchTheme.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const changing = mode._randomTheme();
        expect(mode._showNotification).not.toHaveBeenCalled();
        themeManager.activeThemeName = 'ocean';
        finish('ocean');
        await expect(changing).resolves.toBe(true);
        expect(mode._showNotification).toHaveBeenCalledExactlyOnceWith('Theme Changed');
    });

    it('stays quiet when Forest is the only owned theme', async () => {
        const { mode, themeManager } = makeMode();
        themeManager.getRandomTheme.mockReturnValue('forest');
        await expect(mode._randomTheme()).resolves.toBe(false);
        expect(themeManager.switchTheme).not.toHaveBeenCalled();
        expect(mode._showNotification).not.toHaveBeenCalled();
    });

    it('stays quiet while an Odyssey scope prevents free selection', async () => {
        const { mode, themeManager } = makeMode();
        themeManager.canSelectTheme.mockReturnValue(false);
        await expect(mode._randomTheme()).resolves.toBe(false);
        expect(themeManager.switchTheme).not.toHaveBeenCalled();
        expect(mode._showNotification).not.toHaveBeenCalled();
    });

    it('does not claim success when a failed theme falls back to another theme', async () => {
        const { mode, themeManager } = makeMode();
        themeManager.activeThemeName = 'winter';
        themeManager.switchTheme.mockImplementation(async () => {
            themeManager.activeThemeName = 'forest';
            return 'forest';
        });
        await expect(mode._randomTheme()).resolves.toBe(false);
        expect(mode._showNotification).not.toHaveBeenCalled();
    });

    it('handles a rejected switch without an unhandled keyboard-handler promise', async () => {
        const { mode, themeManager } = makeMode();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        themeManager.switchTheme.mockRejectedValue(new Error('Renderer unavailable'));
        await expect(mode._randomTheme()).resolves.toBe(false);
        expect(mode._showNotification).not.toHaveBeenCalled();
    });

    it('only announces the latest of rapid coalesced selections', async () => {
        const { mode, themeManager } = makeMode();
        const finish = [];
        themeManager.switchTheme.mockImplementation(() => new Promise((resolve) => { finish.push(resolve); }));
        const first = mode._randomTheme();
        const second = mode._randomTheme();
        themeManager.activeThemeName = 'ocean';
        finish.forEach((resolve) => resolve('ocean'));
        expect(await first).toBe(false);
        expect(await second).toBe(true);
        expect(mode._showNotification).toHaveBeenCalledTimes(1);
    });

    it('does not leave a late notification behind after the player leaves Serenity', async () => {
        const { mode, themeManager } = makeMode();
        let finish;
        themeManager.switchTheme.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const changing = mode._randomTheme();
        mode.isActive = false;
        themeManager.activeThemeName = 'ocean';
        finish('ocean');
        await expect(changing).resolves.toBe(false);
        expect(mode._showNotification).not.toHaveBeenCalled();
    });
});
