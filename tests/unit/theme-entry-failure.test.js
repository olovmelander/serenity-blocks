/**
 * A theme that cannot start must never keep the player from the game. The Forest fallback lived
 * only in the switch path, but a theme picked on the menu first starts inside resumeThemes(), at
 * mode entry: the failure rolled the mode back and left the player on nothing, every attempt.
 * A warm failing during an entry was worse: it disposed the instance the entry was adopting, and
 * the entry returned normally with no theme, themes still suspended and later picks refused.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

function element(id = 'el') {
    const names = new Set();
    return {
        id,
        children: [],
        dataset: {},
        style: { removeProperty() {}, setProperty() {} },
        classList: {
            add: (name) => names.add(name),
            remove: (name) => names.delete(name),
            contains: (name) => names.has(name),
        },
        appendChild(child) { this.children.push(child); },
        removeChild(child) { this.children = this.children.filter((c) => c !== child); },
        contains(child) { return this.children.includes(child); },
        setAttribute() {},
        getAttribute() { return null; },
    };
}

function themeClass(name, createScene = async function build() {
    this.scene = { children: [] };
    this.renderer = { render() {} };
}) {
    return class extends BaseTheme {
        constructor() { super(name); }

        async createScene() { return createScene.call(this); }
    };
}

function managerWith(themes) {
    const manager = new TestThemeManager({
        cleanup: vi.fn(), clearThemeResources: vi.fn(), loadTheme: vi.fn(),
    });
    Object.entries({ forest: themeClass('forest'), ...themes }).forEach(([name, Theme]) => {
        manager.themeRegistry.set(name, async () => ({ default: Theme }));
    });
    return manager;
}

/** What the menu does: a pick is deferred, so the theme first starts at mode entry. */
async function pickOnMenu(manager, themeName) {
    manager.suspendThemes();
    await manager.switchTheme(themeName, true);
    expect(manager.activeTheme).toBeNull();
    expect(manager.pendingThemeName).toBe(themeName);
}

const broken = async function build() { throw new Error('createScene exploded'); };
const never = () => new Promise(() => {});
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('a theme that cannot start at mode entry', () => {
    beforeEach(() => {
        const containers = new Map();
        vi.stubGlobal('document', {
            hidden: false,
            getElementById(id) {
                if (!containers.has(id) && id.endsWith('-theme')) containers.set(id, element(id));
                return containers.get(id) || null;
            },
            querySelectorAll: (selector) => (selector === '.theme-container' ? [...containers.values()] : []),
            createElement: () => element(),
            body: element('body'),
            addEventListener() {},
            removeEventListener() {},
        });
        vi.stubGlobal('window', {
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {},
            innerWidth: 1280,
            innerHeight: 720,
            devicePixelRatio: 1,
            location: { search: '' },
        });
        vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
        vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(() => callback(performance.now()), 4));
        vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('falls back to Forest, and the game goes on', async () => {
        const manager = managerWith({ aurora: themeClass('aurora', broken) });
        await pickOnMenu(manager, 'aurora');

        await expect(manager.resumeThemes()).resolves.toBeUndefined();

        expect(manager.activeTheme?.name).toBe('forest');
        expect(manager.activeThemeName).toBe('forest');
        expect(manager.themesSuspended).toBe(false);
        expect(manager.pendingThemeName).toBeNull();
    });

    it('falls back when the theme is too slow on this machine', async () => {
        const manager = managerWith({ aurora: themeClass('aurora', never) });
        manager.getThemeLifecycleTimeout = () => 40;
        await pickOnMenu(manager, 'aurora');

        await manager.resumeThemes();

        expect(manager.activeTheme?.name).toBe('forest');
    });

    it('plays on the plain background when Forest cannot start either', async () => {
        const manager = managerWith({
            aurora: themeClass('aurora', broken), forest: themeClass('forest', broken),
        });
        await pickOnMenu(manager, 'aurora');

        await expect(manager.resumeThemes()).resolves.toBeUndefined();

        expect(manager.activeTheme).toBeNull();
        expect(manager.activeThemeName).toBeNull();
        expect(manager.themesSuspended).toBe(false);
    });

    it('still takes a later theme pick after playing on plain', async () => {
        const manager = managerWith({
            aurora: themeClass('aurora', broken),
            forest: themeClass('forest', broken),
            ocean: themeClass('ocean'),
        });
        await pickOnMenu(manager, 'aurora');
        await manager.resumeThemes();

        await manager.switchTheme('ocean', true);

        expect(manager.activeTheme?.name).toBe('ocean');
    });

    it('does not try Forest twice when Forest is what failed', async () => {
        const start = vi.fn(broken);
        const manager = managerWith({ forest: themeClass('forest', start) });
        await pickOnMenu(manager, 'forest');

        await expect(manager.resumeThemes()).resolves.toBeUndefined();

        expect(start).toHaveBeenCalledOnce();
        expect(manager.activeTheme).toBeNull();
    });

    it('leaves an Odyssey world to its own plain path', async () => {
        const manager = managerWith({ aurora: themeClass('aurora', broken) });
        await pickOnMenu(manager, 'aurora');
        manager.isOdysseyThemeScopeActive = () => true;

        await expect(manager.resumeThemes()).rejects.toThrow('createScene exploded');

        expect(manager.activeTheme).toBeNull();
    });

    it('starts nothing when the player left while the theme was failing', async () => {
        let fail;
        const manager = managerWith({
            aurora: themeClass('aurora', () => new Promise((_resolve, reject) => { fail = reject; })),
        });
        await pickOnMenu(manager, 'aurora');
        const entry = manager.resumeThemes();
        await vi.waitFor(() => expect(fail).toBeTruthy());

        manager.suspendThemes();
        fail(new Error('createScene exploded'));
        await entry;

        expect(manager.activeTheme).toBeNull();
        expect(manager.themesSuspended).toBe(true);
    });

    describe('a boot warm of the same theme, under way as the player enters', () => {
        /** A warm is inside createScene when the entry arrives. */
        async function enterDuringWarm(manager) {
            manager.activeThemeName = 'aurora';
            const warm = manager.prewarmTheme('aurora');
            await wait(20);
            const entry = manager.resumeThemes();
            await wait(20);
            return { entry, warm };
        }

        it('gets a start of its own when the warm fails', async () => {
            let calls = 0;
            let failWarm;
            const manager = managerWith({
                aurora: themeClass('aurora', async function build() {
                    calls += 1;
                    if (calls === 1) {
                        await new Promise((_resolve, reject) => { failWarm = reject; });
                    }
                    this.scene = { children: [] };
                    this.renderer = { render() {} };
                }),
            });

            const { entry, warm } = await enterDuringWarm(manager);
            failWarm(new Error('warm build failed'));
            await entry;
            await warm;

            expect(calls).toBe(2);
            expect(manager.activeTheme?.name).toBe('aurora');
            expect(manager.themesSuspended).toBe(false);
        });

        it('falls back to Forest when that start fails as well', async () => {
            let calls = 0;
            let failWarm;
            const manager = managerWith({
                aurora: themeClass('aurora', async () => {
                    calls += 1;
                    if (calls === 1) await new Promise((_resolve, reject) => { failWarm = reject; });
                    throw new Error('createScene exploded');
                }),
            });

            const { entry, warm } = await enterDuringWarm(manager);
            failWarm(new Error('warm build failed'));
            await entry;
            await warm;

            expect(manager.activeTheme?.name).toBe('forest');
            expect(manager.themesSuspended).toBe(false);
        });

        it('adopts a warm that only outlived its own limit', async () => {
            let finish;
            const manager = managerWith({
                aurora: themeClass('aurora', async function build() {
                    await new Promise((resolve) => { finish = resolve; });
                    this.scene = { children: [] };
                    this.renderer = { render() {} };
                }),
            });
            manager.getThemeLifecycleTimeout = (name) => (name === 'aurora' ? 400 : 1000);

            const { entry, warm } = await enterDuringWarm(manager);
            finish();
            await entry;
            await warm;

            expect(manager.activeTheme?.name).toBe('aurora');
        });

        it('does not hang the entry on a warm that never finishes', async () => {
            const manager = managerWith({ aurora: themeClass('aurora', never) });
            manager.getThemeLifecycleTimeout = () => 60;

            const { entry } = await enterDuringWarm(manager);
            const outcome = await Promise.race([entry.then(() => 'entered'), wait(1000).then(() => 'hung')]);

            expect(outcome).toBe('entered');
            expect(manager.activeTheme?.name).toBe('forest');
        });
    });
});

describe('a mode that cannot start from its card', () => {
    it('brings the menu back, which it hid while loading', () => {
        const main = readFileSync('src/main.js', 'utf8');
        const failure = main.slice(main.indexOf("console.error('[Main] Failed to start game from card selection:'"));

        expect(failure.slice(0, 500)).toContain("this.modalManager.show('start');");
    });
});
