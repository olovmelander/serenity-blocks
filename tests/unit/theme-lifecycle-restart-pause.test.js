/* eslint-disable max-classes-per-file */
import { readFileSync } from 'fs';
import path from 'path';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { BaseTheme } from '../../src/themes/base-theme.js';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';

/**
 * Theme lifecycle holes from the theme and rendering audit (2026-10):
 * - THM-228 / PIPE-19: restarting a STOPPED instance (the manager stops instead of pausing when
 *   suspended runtimes are not kept) built a second renderer and doubled every subscription,
 *   because start() released the old runtime only when the theme was active or paused.
 * - THM-182 / THM-21: a quality rebuild that ran or finished while the theme was paused started a
 *   frame loop that drew behind the menu.
 */

const ROOT = path.resolve(__dirname, '../..');

class TestTheme extends BaseTheme {
    constructor() {
        super('serenity-warp');
        this.renderers = [];
        this.eventUnsubscribers = [];
    }

    async createScene() {
        const renderer = { dispose: vi.fn(), id: this.renderers.length };
        this.renderers.push(renderer);
        this.renderer = renderer;
        this.scene = { children: [], clear: vi.fn(), traverse: () => {} };
        this.eventUnsubscribers.push(vi.fn());
    }
}

describe('theme lifecycle: restart and pause', () => {
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

    it('releases the runtime a stopped theme still holds before it builds again', async () => {
        const theme = new TestTheme();
        const disposeRenderer = vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {});
        await theme.start(null, {});
        const [first] = theme.renderers;
        const firstSubscription = theme.eventUnsubscribers[0];

        theme.stop(); // the manager's suspend when suspended runtimes are not kept
        expect(theme.renderer).toBe(first); // stop() alone keeps it

        await theme.start(null, {});
        expect(disposeRenderer).toHaveBeenCalledWith(first);
        expect(firstSubscription).toHaveBeenCalledOnce(); // unsubscribed, not doubled
        expect(theme.eventUnsubscribers).toHaveLength(1);
        expect(theme.renderer).toBe(theme.renderers[1]);
    });

    it('does not release anything on a first start', async () => {
        const theme = new TestTheme();
        const release = vi.spyOn(theme, 'releaseManagedGpuResources');
        await theme.start(null, {});
        expect(release).not.toHaveBeenCalled();
    });

    it('a frame loop never draws while the theme is paused, and can be started again on resume', () => {
        const frames = [];
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
            frames.push(callback);
            return frames.length;
        }));
        vi.stubGlobal('window', {});
        const theme = new TestTheme();
        theme.isActive = true;
        theme.isPaused = true; // a rebuild finished after the menu paused the theme
        theme.animationLoopStarted = true;
        const draw = vi.fn();
        theme.safeAnimate(draw)(0);
        expect(draw).not.toHaveBeenCalled();
        expect(frames).toHaveLength(0); // the loop ended instead of spinning behind the menu
        expect(theme.animationLoopStarted).toBe(false); // so restartRenderLoop() can start it
    });

    it('wolfhour waits for resume instead of rebuilding behind the menu', () => {
        const theme = Object.create(WolfhourTheme.prototype);
        Object.assign(theme, {
            isActive: true, isPaused: true, qualityRebuildPending: false, rebuildPending: false,
        });
        theme.scheduleRuntimeRebuild = vi.fn();
        theme.requestRuntimeQualityRebuild('settingsChanged');
        expect(theme.scheduleRuntimeRebuild).not.toHaveBeenCalled();
        expect(theme.rebuildPending).toBe(true);

        theme.isPaused = false;
        theme.rebuildPending = false;
        theme.requestRuntimeQualityRebuild('settingsChanged');
        expect(theme.scheduleRuntimeRebuild).toHaveBeenCalledOnce();
    });

    it('moonlit-forest and parhelion keep a paused theme from drawing after a rebuild', () => {
        const moonlit = readFileSync(path.join(ROOT, 'src/themes/moonlit-forest/moonlit-forest-theme.js'), 'utf8');
        const rebuild = moonlit.indexOf('this.createScene().catch((error) => {\n                        console.error(\'[MoonlitForest] Quality rebuild failed:\'');
        expect(rebuild).toBeGreaterThan(-1);
        expect(moonlit.slice(rebuild - 260, rebuild)).toContain('if (this.isPaused) {');
        const parhelion = readFileSync(path.join(ROOT, 'src/themes/parhelion/parhelion-theme.js'), 'utf8');
        expect(parhelion).toContain('if (!this.isPaused) this.animate();');
    });
});
