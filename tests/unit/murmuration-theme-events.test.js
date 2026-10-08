import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import MurmurationTheme from '../../src/themes/murmuration/murmuration-theme.js';
import { SWARM_EVENT_HANDLERS } from '../../src/themes/murmuration/composition/play-director.js';
import { RANDOM_SHAPE_POOL } from '../../src/themes/murmuration/composition/swarm-show.js';
import { SWARM_FOCAL } from '../../src/themes/murmuration/composition/swarm-tiers.js';
import { FLUID_BUDGETS } from '../../src/themes/murmuration/sim/fluid-particles.js';
import { SHAPE_NAMES } from '../../src/themes/murmuration/sim/shape-formations.js';
import { initializeThemeNodeRenderer } from '../../src/themes/shared/node-renderer.js';
import { THEME_REGISTRY } from '../../src/themes/theme-registry.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

vi.mock('../../src/themes/shared/node-renderer.js', () => ({ initializeThemeNodeRenderer: vi.fn() }));

const T = {
    shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
};
const I = {
    shape: [[1, 1, 1, 1]], x: 6, y: 23, type: 'I',
};
const WINDOW_EVENTS = ['gameOver', 'startGameWithMode', 'settingsChanged', 'pointermove'];

const started = [];

/**
 * The theme on the WebGL2 backend at the lightest tier (CPU swarm, no post stack), with its real
 * event wiring and its real frame: `frame()` runs one 60 Hz frame of the theme's own loop.
 */
async function startTheme({
    settings = {}, reducedMotion = false, width = 1280, height = 720, boards = [],
} = {}) {
    const listeners = new Map();
    const container = {
        appendChild: vi.fn(), classList: { remove: vi.fn() }, style: { removeProperty: vi.fn() },
    };
    const win = {
        innerWidth: width,
        innerHeight: height,
        devicePixelRatio: 1,
        settings: { effectQuality: 'Minimal', ...settings },
        location: { search: '' },
        addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
        removeEventListener: vi.fn((type, handler) => {
            if (listeners.get(type) === handler) listeners.delete(type);
        }),
        matchMedia: vi.fn(() => ({ matches: reducedMotion })),
        getComputedStyle: () => ({ visibility: 'visible' }),
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', {
        getElementById: () => container,
        // Board canvases, as [left, width] spans across the window (CSS px).
        querySelectorAll: (selector) => (selector.includes(' canvas') ? boards.map(([left, span]) => ({
            getBoundingClientRect: () => ({
                left, right: left + span, top: 60, bottom: height - 60, width: span, height: height - 120,
            }),
        })) : []),
        querySelector: () => null,
    });
    const loop = { next: null };
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        loop.next = callback;
        return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const renderer = {
        isWebGPURenderer: true,
        backend: { isWebGLBackend: true },
        domElement: {},
        setPixelRatio: vi.fn(),
        getPixelRatio: () => 1,
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
    await theme.init();
    await theme.createScene();
    started.push(theme);

    const frame = (count = 1) => {
        for (let i = 0; i < count; i += 1) loop.next(0);
    };
    /** The show's clock alone (no swarm step): for stretches where only the choreography matters. */
    const wait = (seconds) => {
        const frames = Math.round(seconds * 60);
        for (let i = 0; i < frames; i += 1) {
            theme.time += 1 / 60;
            theme.playDirector?.flush();
            theme.show?.update(1 / 60, theme.time);
        }
    };
    return {
        theme, win, listeners, renderer, container, frame, wait,
    };
}

const busy = (theme) => theme.fluidSim._impulsePositions.filter((slot) => slot.value.w > 0);

describe('Murmuration theme: gameplay wiring', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const theme of started.splice(0)) theme.stop();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('starts the swarm, the show and the director, and listens on the bus and the window', async () => {
        const {
            theme, win, listeners, renderer, container,
        } = await startTheme();
        expect(theme.name).toBe('murmuration');
        expect(container.appendChild).toHaveBeenCalledWith(renderer.domElement);
        expect(theme.fluidSim.isCPU).toBe(true);
        expect(theme.fluidSim.count).toBe(FLUID_BUDGETS.Minimal.count);
        expect(theme.show.sim).toBe(theme.fluidSim);
        expect(theme.show.visual).toBe(theme.fluidRenderer);
        expect(theme.fxState).toBe(theme.show.fx);
        expect(theme.playDirector.enabled).toBe(true);
        expect([...listeners.keys()].sort()).toEqual([...WINDOW_EVENTS].sort());
        expect(win.addEventListener).toHaveBeenCalledTimes(WINDOW_EVENTS.length);
        // Every gameplay event the director handles has a live subscription.
        for (const key of [...Object.keys(SWARM_EVENT_HANDLERS), 'SETTINGS_CHANGED']) {
            expect(eventBus.listeners.has(EVENTS[key]), key).toBe(true);
        }
        // The swarm is centred on its focal point and the first frame has already been drawn.
        expect(theme.fluidSim.uFocalPoint.value.toArray()).toEqual([SWARM_FOCAL.x, SWARM_FOCAL.y, SWARM_FOCAL.z]);
        expect(renderer.render).toHaveBeenCalledTimes(1);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it('is still registered under its old id, with the name players now see', () => {
        const entry = THEME_REGISTRY.find(({ id }) => id === 'murmuration');
        expect(entry).toMatchObject({
            displayName: 'Murmuration',
            module: './murmuration/murmuration-theme.js',
        });
        expect(new MurmurationTheme().name).toBe('murmuration');
    });

    it.each([
        ['a pair flanking the solo board on a wide screen', {}, 1],
        ['one centred figure on a phone', {
            width: 390, height: 844, boards: [[39, 312]],
        }, 0],
        ['one centred figure when boards span the screen', { boards: [[120, 300], [860, 300]] }, 0],
    ])('lays formations out for the frame: %s', async (name, options, twinned) => {
        const { theme, listeners, wait } = await startTheme(options);
        expect(theme.setShape('torus')).toBe(true);
        expect(theme.fluidSim.uShapeTwin.value.x).toBe(twinned);
        if (twinned) {
            // Each copy is clear of the middle of the screen, and inside it.
            const offset = theme.fluidSim.uShapeTwin.value.y;
            expect(offset).toBeGreaterThan(2);
            expect(offset).toBeLessThan(theme.fluidSim.uExtent.value.x * 1.2);
        }
        // The game-over heart is always one heart, in the middle.
        theme.setShape('free');
        wait(4);
        listeners.get('gameOver')();
        expect(theme.fluidSim.currentShape).toBe('heart');
        expect(theme.fluidSim.uShapeTwin.value.toArray()).toEqual([0, 0]);
    });

    it('runs its frame on the CPU path: the swarm flies, nothing is dispatched to compute', async () => {
        const { theme, renderer, frame } = await startTheme();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const before = Array.from(theme.fluidSim.positionData.slice(0, 400));
        const { time } = theme;
        frame(30);
        expect(error).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(theme.fluidSim).toBeTruthy(); // the step did not fail and tear the swarm down
        expect(theme.time - time).toBeCloseTo(0.5, 9);
        expect(renderer.render).toHaveBeenCalledTimes(31);
        expect(renderer.render).toHaveBeenLastCalledWith(theme.scene, theme.camera);
        expect(renderer.compute).not.toHaveBeenCalled();
        expect(Array.from(theme.fluidSim.positionData.slice(0, 400))).not.toEqual(before);
        expect(theme.fluidSim.positionData.every(Number.isFinite)).toBe(true);
        // The sky and the motes are on the theme's clock.
        expect(theme.nebula.uniforms.uTime.value).toBe(theme.time);
        expect(theme.fluidRenderer.uniforms.uTime.value).toBe(theme.time);
        expect(theme.fluidSim.uTime.value).toBe(theme.time);
    });

    it('stages gameplay on the bus and lands it on the next frame, where it happened on the board', async () => {
        const { theme, frame } = await startTheme();
        const lock = vi.spyOn(theme.show, 'lock');
        const clear = vi.spyOn(theme.show, 'clear');
        eventBus.emit(EVENTS.HARD_DROP, { piece: I, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        expect(lock).not.toHaveBeenCalled(); // staged, not yet applied
        expect(busy(theme)).toHaveLength(0);
        frame();
        expect(lock).toHaveBeenCalledOnce();
        expect(lock.mock.calls[0][0]).toMatchObject({ hardDrop: true, rows: [19], player: 0 });
        expect(clear).toHaveBeenCalledOnce();
        expect(clear.mock.calls[0][0]).toMatchObject({ lines: 2, rows: [19, 18], combo: 1 });
        expect(busy(theme)).toHaveLength(2);
        expect(theme.show.comboCount).toBe(1);
        // The I landed right of centre on the floor: its ring starts right of and below the swarm's
        // middle, on the swarm's own plane. The clear's ring starts on the board's centre line.
        const [lockRing, clearRing] = busy(theme).map((slot) => slot.value);
        expect(lockRing.x).toBeGreaterThan(SWARM_FOCAL.x + 0.5);
        expect(lockRing.y).toBeLessThan(SWARM_FOCAL.y - 1);
        expect(lockRing.z).toBe(SWARM_FOCAL.z);
        expect(Math.abs(clearRing.x - SWARM_FOCAL.x)).toBeLessThan(0.2);
        expect(clearRing.y).toBeLessThan(SWARM_FOCAL.y - 1);

        // Paused: the bus is ignored, nothing is staged for later.
        theme.isPaused = true;
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        theme.isPaused = false;
        frame();
        expect(lock).toHaveBeenCalledOnce();
    });

    it('gathers the heart when a run ends on the window, and holds it', async () => {
        const { theme, listeners, wait } = await startTheme();
        wait(0.5);
        expect(theme.show.shape.name).toBe('free');
        listeners.get('gameOver')({ detail: { gameState: {} } });
        expect(theme.show.shape.name).toBe('heart');
        expect(theme.fluidSim.currentShape).toBe('heart');
        wait(20);
        expect(theme.show.shape.name).toBe('heart');
        expect(theme.fluidSim.currentShape).toBe('heart');
        expect(theme.fluidSim.uShapeStrength.value).toBeGreaterThan(0.5);
        expect(theme.show.getState().queued).toBe(0); // the chain that drew it in has run out
    });

    it('lets the heart go on the next lock, and that lock still lands', async () => {
        const { theme, listeners, wait } = await startTheme();
        listeners.get('gameOver')();
        wait(3);
        const lock = vi.spyOn(theme.show, 'lock');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        expect(theme.show.shape.target).toBeGreaterThan(0); // not before the frame
        wait(1 / 60);
        expect(theme.show.shape.target).toBe(0);
        expect(lock).toHaveBeenCalledOnce();
        expect(lock.mock.calls[0][0].rows).toEqual([18, 19]);
        wait(4);
        expect(theme.show.shape.name).toBe('free');
        expect(theme.fluidSim.currentShape).toBe('free');
        expect(theme.fluidSim.uShapeStrength.value).toBe(0);
        // Later locks have nothing left to release.
        const restart = vi.spyOn(theme.show, 'gameStart');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        wait(1 / 60);
        expect(restart).not.toHaveBeenCalled();
        expect(lock).toHaveBeenCalledTimes(2);
    });

    it('lets the heart go when the next run is started from the menu', async () => {
        const { theme, listeners, wait } = await startTheme();
        listeners.get('gameOver')();
        wait(3);
        listeners.get('startGameWithMode')({ detail: { mode: 'single' } });
        expect(theme.show.shape.target).toBe(0);
        wait(4);
        expect(theme.fluidSim.currentShape).toBe('free');
        // Starting a run with no heart held is harmless.
        expect(() => listeners.get('startGameWithMode')()).not.toThrow();
    });

    it('forgets the run that ended: the lock that killed it does not release the heart', async () => {
        const { theme, listeners, wait } = await startTheme();
        for (let i = 0; i < 3; i += 1) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            wait(1 / 60);
        }
        expect(theme.show.comboCount).toBe(3);
        expect(theme.show.heatTarget).toBeGreaterThan(0);
        // The last piece locks and tops the board out in the same tick.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        listeners.get('gameOver')();
        expect(theme.show.comboCount).toBe(0);
        expect(theme.show.heatTarget).toBe(0);
        wait(1);
        expect(theme.show.shape.name).toBe('heart');
        expect(theme.show.shape.target).toBeGreaterThan(0);
    });

    it('ignores a run ending while it is not the active theme', async () => {
        const { theme, listeners } = await startTheme();
        theme.isActive = false;
        listeners.get('gameOver')();
        expect(theme.show.shape.name).toBe('free');
        theme.isActive = true;
    });

    it('honours the reaction settings, in every shape they arrive in', async () => {
        const {
            theme, win, listeners, wait,
        } = await startTheme();
        const lock = vi.spyOn(theme.show, 'lock');
        const clear = vi.spyOn(theme.show, 'clear');
        // The app refreshes window.settings before it tells the themes what changed.
        const change = (changes) => {
            Object.assign(win.settings, changes);
            listeners.get('settingsChanged')({ detail: changes });
        };
        change({ backgroundComboEffects: false });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23] });
        wait(1 / 60);
        expect(lock).not.toHaveBeenCalled();
        expect(clear).not.toHaveBeenCalled();

        change({ backgroundComboEffects: true, pieceLockRipple: false });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        wait(1 / 60);
        expect(lock).not.toHaveBeenCalled();
        expect(clear).toHaveBeenCalledOnce();
        // An unrelated setting changes nothing.
        change({ musicVolume: 0.2 });
        expect(theme.playDirector).toMatchObject({ enabled: true, lockRipple: false });

        change({ reducedMotion: true });
        expect(theme.show.reducedMotion).toBe(true);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { reducedMotion: false }, source: 'menu' });
        expect(theme.show.reducedMotion).toBe(false);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'reducedMotion', value: 'true' });
        expect(theme.show.reducedMotion).toBe(true);
        eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'reducedMotion', value: 'off' });
        expect(theme.show.reducedMotion).toBe(false);
    });

    it('starts with the settings already saved, and with the system\'s reduced-motion preference', async () => {
        const saved = await startTheme({ settings: { pieceLockRipple: false, reducedMotion: 'on' } });
        expect(saved.theme.show.reducedMotion).toBe(true);
        expect(saved.theme.playDirector).toMatchObject({ enabled: true, lockRipple: false });

        const system = await startTheme({ reducedMotion: true });
        expect(system.win.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
        expect(system.theme.show.reducedMotion).toBe(true);
        // The setting cannot switch off what the system asks for.
        system.listeners.get('settingsChanged')({ detail: { reducedMotion: false } });
        expect(system.theme.show.reducedMotion).toBe(true);
        // And the pointer no longer leans the view.
        const pointer = vi.spyOn(system.theme.cameraDirector, 'setPointer');
        system.listeners.get('pointermove')({ clientX: 1280, clientY: 0 });
        expect(pointer).not.toHaveBeenCalled();
    });

    it('leans the view with the pointer', async () => {
        const { theme, listeners } = await startTheme();
        const pointer = vi.spyOn(theme.cameraDirector, 'setPointer');
        listeners.get('pointermove')({ clientX: 1280, clientY: 180 });
        expect(pointer).toHaveBeenCalledWith(1, -0.5);
    });

    it('offers formations to the console and through its public API', async () => {
        const { theme, win, wait } = await startTheme();
        const helper = win.murmuration;
        expect(helper.list()).toBe(SHAPE_NAMES);
        expect(helper.pool()).toEqual([...RANDOM_SHAPE_POOL]);
        expect(helper.current()).toBe('free');
        expect(helper.shape('torus', 0.8)).toBe(true);
        expect(helper.current()).toBe('torus');
        expect(helper.state()).toMatchObject({ shape: 'torus' });
        expect(helper.shape('nope')).toBe(false);
        wait(30);
        expect(helper.current()).toBe('torus'); // held until released
        helper.strength(0.3);
        expect(theme.show.shape.target).toBe(0.3);
        // A gameplay moment does not take over a shape someone asked for by name.
        theme.show.clear({ lines: 4, rows: [19, 18, 17, 16] });
        expect(helper.current()).toBe('torus');
        helper.release();
        wait(4);
        expect(helper.current()).toBe('free');
        expect(RANDOM_SHAPE_POOL).toContain(helper.roll());

        // autoReleaseMs: it lets go by itself.
        theme.setShape('free');
        wait(4);
        expect(theme.setShape('star', {}, 0.7, 500)).toBe(true);
        wait(0.4);
        expect(theme.show.shape.target).toBe(0.7);
        wait(0.2);
        expect(theme.show.shape.target).toBe(0);
        // With no formation, the strength goes straight to the simulation.
        wait(4);
        theme.setShapeStrength(0.25);
        expect(theme.fluidSim.uShapeStrength.value).toBe(0.25);
    });

    it('carries on without the swarm when its step fails', async () => {
        const {
            theme, listeners, renderer, frame,
        } = await startTheme();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { show } = theme;
        const { mesh } = theme.fluidRenderer;
        vi.spyOn(theme.fluidSim, 'stepCPU').mockImplementation(() => { throw new Error('out of memory'); });
        frame();
        expect(warn).toHaveBeenCalledOnce();
        expect(theme.fluidSim).toBeNull();
        expect(theme.fluidRenderer).toBeNull();
        expect(theme.scene.children).not.toContain(mesh);
        expect(show.sim).toBeNull();
        expect(show.visual).toBeNull();
        // The sky still draws, and gameplay still reaches the show without throwing.
        const rendered = renderer.render.mock.calls.length;
        eventBus.emit(EVENTS.HARD_DROP, { piece: I });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: I });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20] });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        listeners.get('gameOver')();
        frame(30);
        expect(renderer.render).toHaveBeenCalledTimes(rendered + 30);
        expect(error).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledOnce(); // it is not retried every frame
        expect(theme.setShape('torus')).toBe(false);
        expect(() => theme.resize(800, 600)).not.toThrow();
    });
});

describe('Murmuration theme: stopping', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        for (const theme of started.splice(0)) theme.stop();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('removes every listener it added and lets go of the show and the director', async () => {
        const {
            theme, win, listeners, frame,
        } = await startTheme();
        const added = win.addEventListener.mock.calls.map(([type, handler]) => [type, handler]);
        const late = new Map(listeners);
        const {
            show, playDirector, fluidSim, renderer,
        } = theme;
        const disposeShow = vi.spyOn(show, 'dispose');
        const resetDirector = vi.spyOn(playDirector, 'reset');
        const disposeSim = vi.spyOn(fluidSim, 'dispose');
        // A quad's follow-ups and a game-over chain are still queued when the theme stops.
        show.clear({ lines: 4, rows: [19, 18, 17, 16] });
        late.get('gameOver')();
        expect(show.getState().queued).toBeGreaterThan(0);

        theme.stop();
        expect(added).toHaveLength(WINDOW_EVENTS.length);
        for (const [type, handler] of added) expect(win.removeEventListener).toHaveBeenCalledWith(type, handler);
        expect(listeners.size).toBe(0);
        for (const key of [...Object.keys(SWARM_EVENT_HANDLERS), 'SETTINGS_CHANGED']) {
            expect(eventBus.listeners.has(EVENTS[key]), key).toBe(false);
        }
        expect(theme.eventUnsubscribers).toEqual([]);
        expect(theme.show).toBeNull();
        expect(theme.playDirector).toBeNull();
        expect(disposeShow).toHaveBeenCalledOnce();
        expect(resetDirector).toHaveBeenCalled();
        expect(disposeSim).toHaveBeenCalledOnce();
        expect(show.getState().queued).toBe(0);
        expect(show.sim).toBeNull();
        const released = [
            'fluidSim', 'fluidRenderer', 'nebula', 'postPipeline', 'cameraDirector', 'renderer', 'scene', 'camera',
        ];
        for (const key of released) expect(theme[key], key).toBeNull();
        expect(theme.disposeRenderer).toHaveBeenCalledWith(renderer, { nullInstance: false });
        expect(win.murmuration).toBeUndefined();
        expect(theme.isActive).toBe(false);
        expect(cancelAnimationFrame).toHaveBeenCalled();

        // A second stop is harmless, and removes nothing twice.
        const removed = win.removeEventListener.mock.calls.length;
        expect(() => theme.stop()).not.toThrow();
        expect(win.removeEventListener).toHaveBeenCalledTimes(removed);
        expect(disposeShow).toHaveBeenCalledOnce();
        expect(theme.disposeRenderer).toHaveBeenCalledTimes(1);

        // So is anything that arrives late: a window event already dispatched, the bus, a frame.
        expect(() => {
            late.get('gameOver')();
            late.get('startGameWithMode')();
            late.get('settingsChanged')({ detail: { reducedMotion: true } });
            late.get('pointermove')({ clientX: 10, clientY: 10 });
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, clearedRows: [23, 22, 21, 20] });
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { backgroundComboEffects: false } });
            frame();
            theme.resize(640, 480);
            theme.setShape('torus');
            theme.setShapeStrength(0.5);
        }).not.toThrow();
        expect(theme.show).toBeNull();
        expect(theme.setShape('torus')).toBe(false);
    });

    it('starts again cleanly after a stop: one set of listeners, a lock lands once', async () => {
        const first = await startTheme();
        first.theme.stop();
        const { theme, win, wait } = await startTheme();
        expect(win.addEventListener).toHaveBeenCalledTimes(WINDOW_EVENTS.length);
        const lock = vi.spyOn(theme.show, 'lock');
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: T });
        wait(1 / 60);
        expect(lock).toHaveBeenCalledOnce();
        expect(first.theme.show).toBeNull();
    });
});
