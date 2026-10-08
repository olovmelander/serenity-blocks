import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import MurmurationTheme from '../../src/themes/murmuration/murmuration-theme.js';
import { PALETTE_LEVEL_STEP } from '../../src/themes/murmuration/composition/swarm-palette.js';
import { NO_POST_EXPOSURE } from '../../src/themes/murmuration/composition/swarm-tiers.js';
import { SwarmPostPipeline } from '../../src/themes/murmuration/post/render-pipeline.js';
import { FLUID_BUDGETS } from '../../src/themes/murmuration/sim/fluid-particles.js';
import { initializeThemeNodeRenderer } from '../../src/themes/shared/node-renderer.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

vi.mock('../../src/themes/shared/node-renderer.js', () => ({ initializeThemeNodeRenderer: vi.fn() }));
// The post stack needs a real device; a stand-in with its surface lets tiers that use it be built.
vi.mock('../../src/themes/murmuration/post/render-pipeline.js', async (importOriginal) => {
    const actual = await importOriginal();
    class FakePostPipeline {
        constructor(renderer, scene, camera, options) {
            this.options = options;
            this.mrtEnabled = options.useMRT === true;
            this.disposed = false;
            this.renders = 0;
            FakePostPipeline.made.push(this);
        }

        // eslint-disable-next-line class-methods-use-this
        isEnabled() { return true; }

        // eslint-disable-next-line class-methods-use-this
        setProfile() {}

        // eslint-disable-next-line class-methods-use-this
        setBoardHalo() {}

        // eslint-disable-next-line class-methods-use-this
        updateDynamic() {}

        render() { this.renders += 1; }

        dispose() { this.disposed = true; }
    }
    FakePostPipeline.made = [];
    return { ...actual, SwarmPostPipeline: FakePostPipeline };
});

const started = [];

/** The theme on the WebGL2 backend (CPU swarm) with its real settings wiring and frame loop. */
async function startTheme(effectQuality = 'Minimal') {
    const listeners = new Map();
    const container = {
        appendChild: vi.fn(), classList: { remove: vi.fn() }, style: { removeProperty: vi.fn() },
    };
    const win = {
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        settings: { effectQuality },
        location: { search: '' },
        addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
        removeEventListener: vi.fn(),
        matchMedia: vi.fn(() => ({ matches: false })),
        getComputedStyle: () => ({ visibility: 'visible' }),
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', {
        getElementById: () => container,
        querySelectorAll: () => [],
        querySelector: () => null,
    });
    const loop = { next: null };
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        loop.next = callback;
        return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let pixelRatio = 1;
    const renderer = {
        isWebGPURenderer: true,
        backend: { isWebGLBackend: true },
        domElement: {},
        setPixelRatio: vi.fn((ratio) => { pixelRatio = ratio; }),
        getPixelRatio: () => pixelRatio,
        setSize: vi.fn(),
        compute: vi.fn(),
        render: vi.fn(),
    };
    initializeThemeNodeRenderer.mockResolvedValue(renderer);

    const theme = new MurmurationTheme();
    theme.isActive = true;
    vi.spyOn(theme, 'setupRendererResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'removeRendererResilience').mockImplementation(() => {});
    vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {});
    vi.spyOn(theme, '_setupResize').mockImplementation(() => {});
    vi.spyOn(theme, 'shouldRenderFrame').mockReturnValue(true);
    vi.spyOn(theme.clock, 'getDelta').mockReturnValue(1 / 60);
    const ratio = vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(1);
    await theme.init();
    await theme.createScene();
    started.push(theme);
    return {
        theme, win, listeners, renderer, container, ratio, frame: () => loop.next(0),
    };
}

describe('Murmuration theme: a tier or render scale changed while it runs', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        SwarmPostPipeline.made.length = 0;
        initializeThemeNodeRenderer.mockClear();
    });
    afterEach(() => {
        for (const theme of started.splice(0)) theme.stop();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('rebuilds the tier between frames, on the renderer and canvas it already has', async () => {
        const {
            theme, listeners, renderer, container, frame,
        } = await startTheme('Minimal');
        const first = {
            sim: theme.fluidSim, sky: theme.nebula, show: theme.show, director: theme.playDirector,
        };
        const simGone = vi.spyOn(first.sim, 'dispose');
        const skyGone = vi.spyOn(first.sky, 'dispose');
        expect(first.sim.count).toBe(FLUID_BUDGETS.Minimal.count);
        expect(theme.postPipeline).toBeNull();
        expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
        expect(renderer.toneMappingExposure).toBe(NO_POST_EXPOSURE);

        // The window event's detail names only the keys that changed.
        listeners.get('settingsChanged')({ detail: { effectQuality: 'Low' } });
        // Nothing is swapped from inside the event: the frame in progress keeps its world.
        expect(theme.qualityName).toBe('Minimal');
        expect(theme.fluidSim).toBe(first.sim);

        frame();
        expect(theme.qualityName).toBe('Low');
        expect(theme.fluidSim).not.toBe(first.sim);
        expect(theme.fluidSim.count).toBe(FLUID_BUDGETS.Low.count);
        expect(simGone).toHaveBeenCalledTimes(1);
        expect(skyGone).toHaveBeenCalledTimes(1);
        expect(theme.nebula).not.toBe(first.sky);
        // The show and the director are new and wired to the new swarm …
        expect(theme.show).not.toBe(first.show);
        expect(theme.show.sim).toBe(theme.fluidSim);
        expect(theme.show.visual).toBe(theme.fluidRenderer);
        expect(theme.fxState).toBe(theme.show.fx);
        expect(theme.playDirector).not.toBe(first.director);
        // … Low has the post stack, which now tone-maps instead of the renderer …
        expect(SwarmPostPipeline.made).toHaveLength(1);
        expect(theme.postPipeline).toBe(SwarmPostPipeline.made[0]);
        expect(theme.postPipeline.mrtEnabled).toBe(false);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(theme.postPipeline.renders).toBe(1); // the same frame drew the new world
        // … and none of it asked for a new renderer or canvas.
        expect(theme.renderer).toBe(renderer);
        expect(initializeThemeNodeRenderer).toHaveBeenCalledTimes(1);
        expect(container.appendChild).toHaveBeenCalledTimes(1);

        // And back, by the bus's `{ type, value }` shape: the post stack is let go.
        const post = theme.postPipeline;
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'effectQuality', value: 'Minimal' });
        frame();
        expect(theme.qualityName).toBe('Minimal');
        expect(post.disposed).toBe(true);
        expect(theme.postPipeline).toBeNull();
        expect(theme.fluidSim.count).toBe(FLUID_BUDGETS.Minimal.count);
        expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
        expect(SwarmPostPipeline.made).toHaveLength(1);
    });

    it('keeps the level palette and a held heart across the swap', async () => {
        const { theme, listeners, frame } = await startTheme('Minimal');
        theme.show.levelUp(3, { silent: true });
        listeners.get('gameOver')();
        expect(theme._heartHeld).toBe(true);
        expect(theme.show.getState().shape).toBe('heart');

        listeners.get('settingsChanged')({ detail: { effectQuality: 'Low' } });
        frame();
        expect(theme.qualityName).toBe('Low');
        expect(theme.show.getState().level).toBe(3);
        expect(theme.show.getState().palettePhase).toBeCloseTo(2 * PALETTE_LEVEL_STEP, 6);
        expect(theme._heartHeld).toBe(true);
        expect(theme.show.getState().shape).toBe('heart');
        expect(theme.fluidSim.currentShape).toBe('heart');
    });

    it('leaves the world alone when a payload names the tier it already runs', async () => {
        const { theme, listeners, frame } = await startTheme('Minimal');
        const { fluidSim, show } = theme;

        // The bus's full-settings shape carries every key, changed or not.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, {
            settings: { effectQuality: 'Minimal', pieceLockRipple: false }, source: 'test',
        });
        frame();
        expect(theme.fluidSim).toBe(fluidSim);
        expect(theme.show).toBe(show);
        expect(theme.playDirector.lockRipple).toBe(false); // the toggles still applied at once

        // A change taken back before the next frame costs nothing either.
        listeners.get('settingsChanged')({ detail: { effectQuality: 'Low' } });
        listeners.get('settingsChanged')({ detail: { effectQuality: 'Minimal' } });
        frame();
        expect(theme.fluidSim).toBe(fluidSim);
        // A payload about something else does not touch the tier.
        listeners.get('settingsChanged')({ detail: { musicVolume: 0.2 } });
        frame();
        expect(theme.fluidSim).toBe(fluidSim);
        expect(SwarmPostPipeline.made).toHaveLength(0);
    });

    it('re-reads the pixel ratio at the next frame after a render-scale change', async () => {
        const {
            theme, renderer, ratio, frame,
        } = await startTheme('Minimal');
        const { fluidSim } = theme;
        renderer.setPixelRatio.mockClear();
        renderer.setSize.mockClear();

        // main.js applies the global scale in its own handler; by the next frame it has.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'renderScale', value: 0.75 });
        ratio.mockReturnValue(0.75);
        expect(renderer.setPixelRatio).not.toHaveBeenCalled();
        frame();
        expect(renderer.setPixelRatio).toHaveBeenCalledTimes(1);
        expect(renderer.setPixelRatio).toHaveBeenCalledWith(0.75);
        expect(renderer.setSize).toHaveBeenCalledWith(1280, 720);
        expect(theme._pixelHeight).toBeCloseTo(720 * 0.75, 6);
        expect(theme.fluidSim).toBe(fluidSim); // the swarm is not rebuilt for a scale change

        // The same scale again is not applied twice.
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'renderScale', value: 0.75 });
        frame();
        expect(renderer.setPixelRatio).toHaveBeenCalledTimes(1);
    });

    it('drops a pending change when it stops', async () => {
        const { theme, listeners } = await startTheme('Minimal');
        listeners.get('settingsChanged')({ detail: { effectQuality: 'Low', renderScale: 0.5 } });
        expect(theme._pendingQuality).toBe('Low');
        expect(theme._pixelRatioStale).toBe(true);
        theme.stop();
        expect(theme._pendingQuality).toBeNull();
        expect(theme._pixelRatioStale).toBe(false);
        expect(theme.fluidSim).toBeNull();
        expect(theme.show).toBeNull();
    });
});
