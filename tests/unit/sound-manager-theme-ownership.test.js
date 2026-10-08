import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SoundManager } from '../../src/audio/sound-manager.js';

const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function setup() {
    const manager = new SoundManager();
    const settings = { autoThemeChange: true, themeLinkedMode: true };
    manager.settingsManager = {
        get: () => settings,
        update: vi.fn(),
        save: vi.fn(),
    };
    manager.themeManager = {
        activeThemeName: 'forest',
        themeIntentGeneration: 0,
        isThemeUnlocked: vi.fn(() => true),
        canSelectTheme: vi.fn(() => true),
        switchTheme: vi.fn(async (id) => {
            manager.themeManager.themeIntentGeneration += 1;
            manager.themeManager.activeThemeName = id;
            return id;
        }),
    };
    const dropdown = { value: 'forest' };
    vi.stubGlobal('document', { getElementById: () => dropdown });
    return { manager, dropdown };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('music-linked theme ownership', () => {
    it('allows a music choice without switching or persisting its locked theme', async () => {
        const { manager, dropdown } = setup();
        manager.musicTrack = 'Ocean';
        manager.themeManager.isThemeUnlocked.mockReturnValue(false);
        await manager.applyAutoThemeChange('Ocean');
        expect(manager.musicTrack).toBe('Ocean');
        expect(manager.themeManager.switchTheme).not.toHaveBeenCalled();
        expect(manager.settingsManager.save).not.toHaveBeenCalled();
        expect(dropdown.value).toBe('forest');
    });

    it('does not use Odyssey permission to override its authored theme with an owned music-linked theme', async () => {
        const { manager } = setup();
        manager.themeManager.canSelectTheme.mockReturnValue(false);
        await manager.applyAutoThemeChange('Winter');
        expect(manager.themeManager.switchTheme).not.toHaveBeenCalled();
        expect(manager.settingsManager.update).not.toHaveBeenCalled();
    });

    it('persists the actual owned fallback, not the requested theme that failed', async () => {
        const { manager, dropdown } = setup();
        manager.themeManager.switchTheme.mockResolvedValue('forest');
        await manager.applyAutoThemeChange('Ocean');
        expect(manager.settingsManager.update).toHaveBeenCalledWith({ backgroundTheme: 'forest' });
        expect(dropdown.value).toBe('forest');
    });

    it('lets only the latest queued music request persist its final outcome', async () => {
        const { manager } = setup();
        const pending = [];
        manager.themeManager.switchTheme.mockImplementation(() => {
            manager.themeManager.themeIntentGeneration += 1;
            return new Promise((resolve) => { pending.push(resolve); });
        });
        const first = manager.applyAutoThemeChange('Ocean');
        await tick();
        const second = manager.applyAutoThemeChange('Winter');
        await tick();
        manager.themeManager.activeThemeName = 'winter';
        pending[0]('winter');
        await first;
        expect(manager.settingsManager.update).not.toHaveBeenCalled();
        pending[1]('winter');
        await second;
        expect(manager.settingsManager.update).toHaveBeenCalledExactlyOnceWith({ backgroundTheme: 'winter' });
    });

    it('does not overwrite a newer manual selection after awaiting a music theme switch', async () => {
        const { manager } = setup();
        let finish;
        manager.themeManager.switchTheme.mockImplementation(() => {
            manager.themeManager.themeIntentGeneration += 1;
            return new Promise((resolve) => { finish = resolve; });
        });
        const pending = manager.applyAutoThemeChange('Ocean');
        await tick();
        manager.themeManager.themeIntentGeneration += 1;
        manager.themeManager.activeThemeName = 'winter';
        finish('winter');
        await pending;
        expect(manager.settingsManager.update).not.toHaveBeenCalled();
    });

    it('invalidates an earlier theme continuation even when the newer song has no theme', async () => {
        const { manager } = setup();
        let finish;
        manager.themeManager.switchTheme.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        const pending = manager.applyAutoThemeChange('Ocean');
        await tick();
        await manager.applyAutoThemeChange('ElectricDreams');
        manager.themeManager.activeThemeName = 'ocean';
        finish('ocean');
        await pending;
        expect(manager.settingsManager.update).not.toHaveBeenCalled();
    });

    it('does not persist a theme after the music-link owner was suspended during a switch', async () => {
        const { manager } = setup();
        let finish;
        manager.themeManager.switchTheme.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        const pending = manager.applyAutoThemeChange('Ocean');
        await tick();
        manager.suspendThemeLinkedMusic();
        manager.themeManager.activeThemeName = 'ocean';
        finish('ocean');
        await pending;
        expect(manager.settingsManager.update).not.toHaveBeenCalled();
    });

    it('handles a rejected switch without writing an unearned selection or unhandled rejection', async () => {
        const { manager } = setup();
        manager.themeManager.switchTheme.mockRejectedValue(new Error('renderer unavailable'));
        await expect(manager.applyAutoThemeChange('Ocean')).resolves.toBeUndefined();
        expect(manager.settingsManager.update).not.toHaveBeenCalled();
    });
});
