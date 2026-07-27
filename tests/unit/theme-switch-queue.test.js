import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { ThemeManager } from '../../src/themes/theme-manager.js';
import { ThemesTab } from '../../src/ui/serenity-hub/ThemesTab.js';

// Serenity-hub theme-switch reliability. Previously, a switch requested while a
// (multi-second, heavy-WebGPU) transition was in flight was SILENTLY DROPPED
// (`if (isTransitioning) return`), and ThemesTab.selectTheme then committed the
// requested id to its shadow state + settings anyway — the hub claimed a theme
// that never started, and re-clicking it was a no-op ("new theme not starting
// properly"). These tests pin the fixed contract: coalesced queueing (latest
// request wins, promises settle with the finally-active theme), a drain from
// the prewarm lock too, an import timeout so a stalled module fetch cannot
// wedge isTransitioning forever, and truth-committing in the hub tab.

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function makeManager() {
    const manager = new TestThemeManager(
        { clearThemeResources: vi.fn() },
        { assetManager: {}, audioManager: null },
    );
    manager.themesSuspended = false;
    const forest = { name: 'forest' };
    manager.activeTheme = forest;
    manager.activeThemeName = 'forest';
    manager.themeInstances.set('forest', forest);
    manager.themeLRU = ['forest'];
    manager.disposeThemeInstance = vi.fn();

    const activations = [];
    const gates = new Map(); // themeName -> resolve fn holding that activation open
    manager.loadTheme = vi.fn(async (name) => ({ name }));
    manager.activateThemeInstance = vi.fn(async (theme, name) => {
        activations.push(name);
        if (gates.has(name)) {
            await new Promise((resolve) => { gates.get(name).push(resolve); });
        }
        theme.cleanupComplete = false;
        theme.isActive = true;
        theme.lifecycleState = 'running';
        manager.activeTheme = theme;
        manager.activeThemeName = name;
        manager.pendingThemeInstance = null;
        manager.pendingThemeName = null;
    });

    const hold = (name) => { gates.set(name, []); };
    const release = (name) => {
        (gates.get(name) || []).forEach((resolve) => resolve());
        gates.delete(name);
    };
    return {
        manager, activations, hold, release,
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('ThemeManager coalesced switch queue', () => {
    it('a switch requested mid-transition is queued and runs afterwards (not dropped)', async () => {
        const {
            manager, activations, hold, release,
        } = makeManager();
        hold('ocean');
        hold('winter');

        const first = manager.switchTheme('ocean');
        let firstSettled = false;
        first.then(() => { firstSettled = true; });
        await tick();
        expect(manager.isTransitioning).toBe(true);

        const second = manager.switchTheme('winter');
        await tick();
        // Old behavior: this request would have vanished here.
        expect(manager.queuedSwitchRequest?.themeName).toBe('winter');

        release('ocean');
        await tick();
        expect(activations).toEqual(['ocean', 'winter']);
        expect(firstSettled).toBe(false);

        release('winter');
        const settledOn = await second;
        await first;

        expect(activations).toEqual(['ocean', 'winter']);
        expect(manager.activeThemeName).toBe('winter');
        expect(settledOn).toBe('winter');
        expect(manager.queuedSwitchRequest).toBeNull();
        expect(manager.isTransitioning).toBe(false);
    });

    it('coalesces rapid clicks: only the LATEST queued request runs, all callers settle on it', async () => {
        const {
            manager, activations, hold, release,
        } = makeManager();
        hold('ocean');

        const first = manager.switchTheme('ocean');
        await tick();
        const second = manager.switchTheme('winter');
        const third = manager.switchTheme('lunara');
        await tick();

        release('ocean');
        await first;
        const [secondName, thirdName] = await Promise.all([second, third]);

        // 'winter' was superseded before it ever ran.
        expect(activations).toEqual(['ocean', 'lunara']);
        expect(manager.activeThemeName).toBe('lunara');
        expect(secondName).toBe('lunara');
        expect(thirdName).toBe('lunara');
    });

    it('re-clicking the in-flight theme settles without a redundant second switch', async () => {
        const {
            manager, activations, hold, release,
        } = makeManager();
        hold('ocean');

        const first = manager.switchTheme('ocean');
        await tick();
        const reclick = manager.switchTheme('ocean');
        await tick();

        release('ocean');
        await first;
        const settledOn = await reclick;

        expect(activations).toEqual(['ocean']);
        expect(settledOn).toBe('ocean');
    });

    it('prewarmTheme drains a switch queued during its lock (finally contract)', async () => {
        const { manager } = makeManager();
        manager.activeTheme = null;
        manager.themesSuspended = true;
        manager.loadTheme = vi.fn(async () => { throw new Error('boom'); });
        const drainSpy = vi.spyOn(manager, 'drainQueuedThemeSwitch');

        await manager.prewarmTheme('forest');

        expect(drainSpy).toHaveBeenCalled();
    });

    it('a stalled theme module import times out instead of wedging isTransitioning forever', async () => {
        vi.useFakeTimers();
        // Real loadTheme (no stub): empty cache, only a stuck importer registered.
        const manager = new TestThemeManager(
            { clearThemeResources: vi.fn() },
            { assetManager: {}, audioManager: null },
        );
        // A module import that never settles — previously this await hung forever.
        manager.themeRegistry.set('stuck-theme', () => new Promise(() => {}));

        const loadPromise = manager.loadTheme('stuck-theme', true);
        const outcome = loadPromise.then(
            () => 'resolved',
            (error) => error.message,
        );

        await vi.advanceTimersByTimeAsync(10001);
        await expect(outcome).resolves.toContain(
            'Theme "stuck-theme" module import timed out',
        );
    });
});

describe('ThemesTab.selectTheme commits the ACTUAL outcome (not the request)', () => {
    function makeTab({ activeThemeName = 'forest', switchTo = activeThemeName } = {}) {
        const tab = Object.create(ThemesTab.prototype);
        tab.themeManager = {
            activeThemeName,
            activeTheme: { name: activeThemeName },
            isTransitioning: false,
            switchTheme: vi.fn(async () => {
                // Simulate whatever the manager actually landed on (e.g. forest
                // fallback after a failed start, or a superseding click).
                tab.themeManager.activeThemeName = switchTo;
                tab.themeManager.activeTheme = { name: switchTo };
                return switchTo;
            }),
        };
        tab.settingsManager = { update: vi.fn(), save: vi.fn() };
        tab.currentTheme = activeThemeName;
        tab.updateThemeSelection = vi.fn();
        tab.updateCurrentThemeBadge = vi.fn();
        tab.refreshThemeParams = vi.fn();
        return tab;
    }

    it('persists the theme that actually activated, not the failed request', async () => {
        const tab = makeTab({ activeThemeName: 'forest', switchTo: 'forest' });

        await tab.selectTheme('broken-theme');

        // Old behavior: currentTheme/settings became 'broken-theme' while forest
        // was on screen — and re-clicking 'broken-theme' was a silent no-op.
        expect(tab.currentTheme).toBe('forest');
        expect(tab.settingsManager.update).toHaveBeenCalledWith({
            backgroundTheme: 'forest',
            backgroundMode: 'Specific',
        });
    });

    it('retries when the shadow state is desynced from the manager', async () => {
        const tab = makeTab({ activeThemeName: 'forest', switchTo: 'ocean' });
        // Desync: the tab believes 'ocean' is current (a previously dropped switch).
        tab.currentTheme = 'ocean';

        await tab.selectTheme('ocean');

        // Old guard (themeId === this.currentTheme) would have no-opped here.
        expect(tab.themeManager.switchTheme).toHaveBeenCalledWith('ocean');
        expect(tab.currentTheme).toBe('ocean');
    });

    it('skips the switch only when the manager is genuinely on that theme', async () => {
        const tab = makeTab({ activeThemeName: 'ocean' });
        tab.currentTheme = 'stale-shadow';

        await tab.selectTheme('ocean');

        expect(tab.themeManager.switchTheme).not.toHaveBeenCalled();
        expect(tab.currentTheme).toBe('ocean'); // shadow resynced
    });

    it('lets only the latest rapid selection persist settings', async () => {
        const tab = makeTab({ activeThemeName: 'forest' });
        const resolvers = [];
        tab.themeManager.switchTheme = vi.fn(() => new Promise((resolve) => {
            resolvers.push(resolve);
        }));

        const first = tab.selectTheme('ocean');
        const second = tab.selectTheme('winter');
        tab.themeManager.activeThemeName = 'winter';
        tab.themeManager.activeTheme = { name: 'winter' };

        resolvers[0]('winter');
        await first;
        expect(tab.settingsManager.update).not.toHaveBeenCalled();

        resolvers[1]('winter');
        await second;
        expect(tab.settingsManager.update).toHaveBeenCalledTimes(1);
        expect(tab.settingsManager.update).toHaveBeenCalledWith({
            backgroundTheme: 'winter',
            backgroundMode: 'Specific',
        });
    });
});
