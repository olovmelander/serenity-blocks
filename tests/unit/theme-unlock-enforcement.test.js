import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ThemeManager } from '../../src/themes/theme-manager.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function makeManager(owned = ['forest']) {
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
    };
    const manager = new TestThemeManager(null, { themeCollection: collection, assetManager: {} });
    manager.queueAdjacentThemePreload = vi.fn();
    const starts = [];
    const gates = new Map();
    manager.loadTheme = vi.fn(async (name) => {
        const theme = {
            name,
            async start() {
                starts.push(name);
                if (gates.has(name)) await gates.get(name).promise;
                this.isActive = true;
                this.hasStarted = true;
                this.lifecycleState = 'running';
                return true;
            },
            stop() { this.isActive = false; },
            cleanup() { this.cleanupComplete = true; },
        };
        manager.themeInstances.set(name, theme);
        return theme;
    });
    return {
        manager, collection, starts, gates, listeners,
    };
}

const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('theme ownership enforcement', () => {
    it('keeps Forest usable for new installs and excludes locked themes from every automatic choice', async () => {
        const { manager } = makeManager();
        expect(manager.getAvailableThemes()).toEqual(['forest']);
        for (let level = 1; level <= 200; level += 1) {
            expect(manager.getThemeForLevel(level)).toBe('forest');
            expect(manager.getRandomTheme()).toBe('forest');
        }
        await expect(manager.switchTheme('ocean')).resolves.toBe('forest');
        expect(manager.loadTheme).not.toHaveBeenCalled();
    });

    it('refreshes the shuffle deck after a grant without immediately repeating the current theme', () => {
        const { manager, collection } = makeManager(['forest', 'ocean']);
        manager.activeThemeName = 'ocean';
        manager.themeShuffleDeck = ['forest'];
        collection.grant('winter');
        const cycle = [manager.getRandomTheme(), manager.getRandomTheme()];
        expect(new Set(cycle)).toEqual(new Set(['forest', 'winter']));
        expect(cycle).not.toContain('ocean');
    });

    it('removes the current theme from an already shuffled deck after a manual selection', async () => {
        const { manager } = makeManager(['forest', 'ocean', 'winter']);
        manager.themeShuffleDeck = ['forest', 'ocean'];
        await manager.switchTheme('ocean');
        expect(manager.getRandomTheme()).toBe('forest');
    });

    it('does not let a locked rapid request displace an accepted owned selection', async () => {
        const { manager, gates } = makeManager(['forest', 'ocean']);
        manager.themesSuspended = false;
        const gate = deferred();
        gates.set('ocean', gate);
        const accepted = manager.switchTheme('ocean');
        await tick();
        const intent = manager.themeIntentGeneration;
        await manager.switchTheme('winter');
        expect(manager.themeIntentGeneration).toBe(intent);
        gate.resolve();
        expect(await accepted).toBe('ocean');
        expect(manager.loadTheme.mock.calls.map(([id]) => id)).toEqual(['ocean']);
    });

    it('checks ownership using the canonical theme for retired saved identifiers', async () => {
        const { manager } = makeManager(['forest', 'sky-children']);
        await expect(manager.switchTheme('sky-children-v2')).resolves.toBe('sky-children');
        expect(manager.loadTheme).toHaveBeenCalledWith('sky-children');
    });

    it('a timed random switch stays owned while an Odyssey permission exists', async () => {
        vi.useFakeTimers();
        const { manager } = makeManager();
        manager.beginOdysseyThemeScope('ocean');
        manager.startRandomThemeInterval(1);
        await vi.advanceTimersByTimeAsync(60000);
        expect(manager.loadTheme).not.toHaveBeenCalled();
        manager.stopRandomThemeInterval();
    });

    it('unsubscribes ownership updates during terminal cleanup', () => {
        const { manager, listeners } = makeManager();
        expect(listeners.size).toBe(1);
        manager.cleanup();
        expect(listeners.size).toBe(0);
    });
});

describe('temporary Odyssey theme playback', () => {
    it('permits only the exact orb theme and never lends permission to a manual switch', async () => {
        const { manager } = makeManager();
        const scope = manager.beginOdysseyThemeScope('ocean');
        await manager.switchTheme('ocean', true, { ...scope });
        await manager.switchTheme('winter', true, scope);
        await manager.switchTheme('ocean');
        expect(manager.loadTheme).not.toHaveBeenCalled();
        await expect(manager.switchTheme('ocean', true, scope)).resolves.toBe('ocean');
        expect(manager.isThemeUnlocked('ocean')).toBe(false);
        expect(manager.getAvailableThemes()).toEqual(['forest']);
    });

    it('blocks even owned manual selections while the authored orb owns playback', async () => {
        const { manager } = makeManager(['forest', 'winter']);
        const scope = manager.beginOdysseyThemeScope('ocean');
        await manager.switchTheme('ocean', true, scope);
        expect(manager.isOdysseyThemeScopeActive()).toBe(true);
        expect(manager.canSelectTheme('winter')).toBe(false);
        await expect(manager.switchTheme('winter')).resolves.toBe('ocean');
        expect(manager.loadTheme.mock.calls.map(([id]) => id)).toEqual(['ocean']);
        await manager.endOdysseyThemeScope(scope);
        expect(manager.canSelectTheme('winter')).toBe(true);
    });

    it('rejects a stale queued scope before its theme loads', async () => {
        const { manager } = makeManager();
        manager.isTransitioning = true;
        const oldScope = manager.beginOdysseyThemeScope('ocean');
        const queued = manager.switchTheme('ocean', true, oldScope);
        manager.beginOdysseyThemeScope('winter');
        manager.isTransitioning = false;
        await manager.drainQueuedThemeSwitch();
        expect(await queued).toBe('forest');
        expect(manager.loadTheme).not.toHaveBeenCalled();
    });

    it('revokes a delayed start and restores the owned preference before settling exit', async () => {
        const {
            manager, starts, gates,
        } = makeManager(['forest', 'winter']);
        manager.themesSuspended = false;
        const gate = deferred();
        gates.set('ocean', gate);
        const scope = manager.beginOdysseyThemeScope('ocean', { restoreTheme: 'winter' });
        const changes = [];
        const unsubscribe = eventBus.on(EVENTS.THEME_CHANGED, ({ themeName }) => changes.push(themeName));
        const entering = manager.switchTheme('ocean', true, scope);
        await tick();
        expect(starts).toEqual(['ocean']);
        const leaving = manager.endOdysseyThemeScope(scope);
        gate.resolve();
        expect(await leaving).toBe('winter');
        expect(await entering).toBe('winter');
        expect(changes).not.toContain('ocean');
        expect(manager.activeThemeName).toBe('winter');
        unsubscribe();
    });

    it('checks the orb owner again when a deferred import completes', async () => {
        const { manager } = makeManager();
        const load = deferred();
        const originalLoad = manager.loadTheme;
        manager.loadTheme = vi.fn((name) => (name === 'ocean' ? load.promise : originalLoad(name)));
        let current = true;
        const scope = manager.beginOdysseyThemeScope('ocean', { isCurrent: () => current });
        const entering = manager.switchTheme('ocean', true, scope);
        current = false;
        load.resolve({ name: 'ocean', start: vi.fn() });
        expect(await entering).toBe('forest');
        expect(manager.pendingThemeName).toBe('forest');
    });

    it('rejects a stale end without revoking the new orb and keeps its restore preference', async () => {
        const { manager } = makeManager(['forest', 'winter']);
        const oldScope = manager.beginOdysseyThemeScope('ocean', { restoreTheme: 'winter' });
        const nextScope = manager.beginOdysseyThemeScope('lunara');
        await manager.endOdysseyThemeScope(oldScope);
        await expect(manager.switchTheme('lunara', true, nextScope)).resolves.toBe('lunara');
        await expect(manager.endOdysseyThemeScope(nextScope)).resolves.toBe('winter');
    });

    it('recovers a failed Odyssey runtime while retaining its narrow permission', async () => {
        const { manager } = makeManager();
        manager.themesSuspended = false;
        const scope = manager.beginOdysseyThemeScope('ocean');
        await manager.switchTheme('ocean', true, scope);
        const failed = manager.activeTheme;
        manager.handleThemeRuntimeFailure(failed, 'ocean', new Error('context lost'));
        await manager.switchDrainPromise;
        expect(manager.activeThemeName).toBe('ocean');
        expect(manager.activeTheme).not.toBe(failed);
        expect(manager.isThemeUnlocked('ocean')).toBe(false);
        await manager.endOdysseyThemeScope(scope);
        expect(manager.activeThemeName).toBe('forest');
    });

    it('cannot resume a locked pending orb after its gameplay owner has expired', async () => {
        const { manager, starts } = makeManager();
        let current = true;
        const scope = manager.beginOdysseyThemeScope('ocean', { isCurrent: () => current });
        await manager.switchTheme('ocean', true, scope);
        current = false;
        await manager.resumeThemes();
        expect(starts).toEqual(['forest']);
        expect(manager.activeThemeName).toBe('forest');
    });

    it('waits for an active orb to publish its theme instead of resuming an unrelated pending theme', async () => {
        const { manager, starts } = makeManager();
        await manager.switchTheme('forest');
        const scope = manager.beginOdysseyThemeScope('ocean');
        await expect(manager.resumeThemes()).resolves.toBeUndefined();
        expect(starts).toEqual([]);
        expect(manager.themesSuspended).toBe(true);
        await manager.switchTheme('ocean', true, scope);
        await manager.resumeThemes();
        expect(starts).toEqual(['ocean']);
    });
});
