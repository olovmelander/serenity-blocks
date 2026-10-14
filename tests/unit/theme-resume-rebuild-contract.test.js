/* eslint-disable max-classes-per-file */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { BaseTheme } from '../../src/themes/base-theme.js';
import { ThemeManager } from '../../src/themes/theme-manager.js';

/**
 * A rebuild chosen while a theme is parked (a new quality tier behind the menu) is one full
 * restart, never a resume followed by a rebuild (theme and rendering audit 2026-10: THM-33,
 * THM-93 and copies). Resuming and then rebuilding retired the renderer the manager's render
 * check was watching: it saw no frame, called the theme frozen and restarted it a second time.
 * BaseTheme.resume() now refuses, the manager restarts the theme, and a start clears the flag.
 */

const ROOT = path.resolve(__dirname, '../..');

class TestTheme extends BaseTheme {
    constructor() {
        super('serenity-warp');
        this.builds = 0;
    }

    async createScene() {
        this.builds += 1;
    }
}

class TestThemeManager extends ThemeManager {
    initializeRegistry() {}
}

function parked() {
    const theme = new TestTheme();
    theme.hasStarted = true;
    theme.isActive = true;
    theme.isPaused = true;
    theme.lifecycleState = 'paused';
    return theme;
}

function jsFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return jsFiles(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

/** The body of every `resume() {` method in a file. */
function resumeBodies(source) {
    return [...source.matchAll(/\n {4}resume\(\) \{\n/g)]
        .map((match) => source.slice(match.index, source.indexOf('\n    }\n', match.index)));
}

describe('a rebuild chosen while parked is one restart', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('document', {
            hidden: false,
            getElementById: () => null,
            querySelectorAll: () => [],
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('BaseTheme.resume() hands back a theme with a rebuild pending, and resumes one without', () => {
        const waiting = parked();
        waiting.rebuildPending = true;
        expect(waiting.resume()).toBe(false);
        expect(waiting.isPaused).toBe(true);
        expect(waiting.lifecycleState).toBe('paused');

        expect(parked().resume()).toBe(true);
    });

    it('the restart builds once and clears the flag', async () => {
        const theme = parked();
        theme.rebuildPending = true;
        await theme.start(null, {});
        expect(theme.builds).toBe(1);
        expect(theme.rebuildPending).toBe(false);
        expect(theme.lifecycleState).toBe('running');
    });

    it('no theme queues a rebuild from its own resume()', () => {
        const offenders = [];
        for (const file of jsFiles(path.join(ROOT, 'src/themes'))) {
            for (const body of resumeBodies(readFileSync(file, 'utf8'))) {
                if (/queueRebuild\(|this\.createScene\(/.test(body)) offenders.push(path.relative(ROOT, file));
            }
        }
        expect(offenders).toEqual([]);
    });

    describe('the hidden-tab resume', () => {
        function managerWith(theme) {
            const renderer = { cleanup: vi.fn(), clearThemeResources: vi.fn(), loadTheme: vi.fn() };
            const manager = new TestThemeManager(renderer, { assetManager: {}, audioManager: null });
            manager.activeTheme = theme;
            manager.activeThemeName = theme.name;
            manager.activateThemeInstance = vi.fn(async () => theme.name);
            return manager;
        }

        it('restarts a theme that refused because a rebuild is pending, instead of kicking its loop', () => {
            const frames = vi.fn();
            vi.stubGlobal('requestAnimationFrame', frames);
            const theme = parked();
            theme.rebuildPending = true;
            const manager = managerWith(theme);
            manager.resumeActiveThemeAfterHiddenTab();
            expect(manager.activateThemeInstance).toHaveBeenCalledOnce();
            expect(manager.activateThemeInstance.mock.calls[0][0]).toBe(theme);
            expect(frames).not.toHaveBeenCalled();
        });

        it('resumes any other theme and restarts its render loop', () => {
            const frames = vi.fn((callback) => callback());
            vi.stubGlobal('requestAnimationFrame', frames);
            const theme = parked();
            theme.restartRenderLoop = vi.fn();
            const manager = managerWith(theme);
            manager.resumeActiveThemeAfterHiddenTab();
            expect(manager.activateThemeInstance).not.toHaveBeenCalled();
            expect(theme.lifecycleState).toBe('running');
            expect(theme.restartRenderLoop).toHaveBeenCalledOnce();
        });
    });

    it('main.js hands the hidden-tab resume to the theme manager', () => {
        const main = readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
        const body = main.slice(main.indexOf('    resumeFullRendering() {'));
        const resumeFullRendering = body.slice(0, body.indexOf('\n    }\n'));
        expect(resumeFullRendering).toContain('this.themeManager?.resumeActiveThemeAfterHiddenTab();');
    });
});
