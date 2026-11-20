import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';

import ParhelionTheme from '../../src/themes/parhelion/parhelion-theme.js';
import {
    ParhelionOpticsState,
    RUN_END,
} from '../../src/themes/parhelion/sim/parhelion-optics-state.js';
import { duskOf } from '../../src/themes/parhelion/sim/parhelion-weather.js';
import { DEFAULT_LAYOUT } from '../../src/playground/effects/parhelion-composition.js';

/**
 * A run's end in Parhelion: the sun goes under (ParhelionOpticsState.gameOver), the night stands
 * behind the result screen and the menu, and gives the hour's light back by itself or, at once,
 * when the next run starts (sessionStart). First the optics state's own promises, then the theme
 * wrapper's wiring of the window's 'gameOver' and the mode manager's events onto it.
 *
 * Each "Was FAULT" line marks a promise the first version of the pass broke: this file found it, the code was fixed, and the test now holds it.
 */

const FRAME = 1 / 60;
const {
    fall, hold, dawn, wake, night: DEPTH,
} = RUN_END;
/** A whole run-end night left to itself. */
const WHOLE = fall + hold + dawn;

/** A state in which only the run's end moves the light: the clear air, the high sun, no happenings. */
function createState(options = {}) {
    const state = new ParhelionOpticsState('High');
    const vp = DEFAULT_LAYOUT;
    state.setLayout({
        card: vp.card, board: vp.board, queue: vp.next, hud: vp.hud, aspect: vp.aspect,
    });
    state.configure({
        air: 0, walk: 0, happenings: false, ...options,
    });
    return state;
}

/** The run-end night of `state` sampled every `dt` over [from, to]: `[t, night]` pairs. */
function sample(state, from, to, dt = 0.01) {
    const rows = [];
    const steps = Math.round((to - from) / dt);
    for (let i = 0; i <= steps; i++) {
        const t = from + i * dt;
        rows.push([t, state._overAt(t)]);
    }
    return rows;
}

/** The largest step between neighbours of a sampled curve. */
const widestStep = (rows) => rows.reduce(
    (widest, [, v], i) => (i === 0 ? 0 : Math.max(widest, Math.abs(v - rows[i - 1][1]))),
    0,
);

describe('Parhelion run end: the sun goes under (optics state)', () => {
    it('describes a night that falls, stands and dawns, each over a real length of time', () => {
        for (const seconds of [fall, hold, dawn, wake]) expect(seconds).toBeGreaterThan(0);
        expect(DEPTH).toBeGreaterThan(0.5);
        expect(DEPTH).toBeLessThanOrEqual(1);
        // A new run gets its day back sooner than the night would have given it.
        expect(wake).toBeLessThan(dawn);
    });

    it('falls over RUN_END.fall, stands RUN_END.hold, then gives the light back over RUN_END.dawn by itself', () => {
        const state = createState();
        const t0 = 10;
        state.gameOver(t0);
        const dt = 0.01;
        const rows = sample(state, t0 - 1, t0 + WHOLE + 2, dt);
        for (let i = 0; i < rows.length; i++) {
            const [t, v] = rows[i];
            const age = t - t0;
            const before = i > 0 ? rows[i - 1][1] : 0;
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(DEPTH + 1e-12);
            if (age <= 0) expect(v, `before, ${age}`).toBe(0);
            else if (age <= fall) expect(v, `falling, ${age}`).toBeGreaterThanOrEqual(before - 1e-12);
            else if (age <= fall + hold) expect(v, `standing, ${age}`).toBeCloseTo(DEPTH, 12);
            else if (age <= WHOLE) expect(v, `dawning, ${age}`).toBeLessThanOrEqual(before + 1e-12);
            else expect(v, `after, ${age}`).toBe(0);
        }
        // Eased at both ends of both turns: never a step steeper than a smoothstep's middle.
        expect(widestStep(rows)).toBeLessThanOrEqual(((1.5 * DEPTH * dt) / Math.min(fall, dawn)) * 1.01);
        expect(state._overAt(t0 + fall / 2)).toBeCloseTo(DEPTH / 2, 9);
        expect(state._overAt(t0 + fall + hold + dawn / 2)).toBeCloseTo(DEPTH / 2, 9);
    });

    it('shows as the night, its afterglow on both turns, and the stars while it stands', () => {
        const state = createState();
        const t0 = 5;
        state.gameOver(t0);
        const glow = { falling: 0, standing: 0, dawning: 0 };
        let stars = 0;
        let last = 0;
        let widest = 0;
        for (let t = t0; t <= t0 + WHOLE + 1; t += FRAME) {
            const out = state.update(t, FRAME);
            expect(out.night, `night at ${t}`).toBeCloseTo(state._overAt(t), 12);
            expect(out.dusk, `dusk at ${t}`).toBeCloseTo(duskOf(out.night), 12);
            const age = t - t0;
            if (age < fall) glow.falling = Math.max(glow.falling, out.dusk);
            else if (age < fall + hold) {
                glow.standing = Math.max(glow.standing, out.dusk);
                if (age > fall + 0.1) stars = Math.max(stars, out.stars);
            } else glow.dawning = Math.max(glow.dawning, out.dusk);
            widest = Math.max(widest, Math.abs(out.night - last));
            last = out.night;
        }
        expect(glow.falling).toBeGreaterThan(0.95);
        expect(glow.dawning).toBeGreaterThan(0.95);
        expect(glow.standing).toBeLessThan(glow.falling);
        expect(stars).toBeGreaterThan(0.9);
        expect(widest).toBeLessThan(0.02);
        // Day again, with nothing left over.
        const out = state.update(t0 + WHOLE + 2, FRAME);
        expect(out.night).toBe(0);
        expect(out.dusk).toBe(0);
        expect(out.stars).toBe(0);
    });

    it('survives resetSession, the menu and any setting: the one thing a reset must not take', () => {
        const state = createState();
        const twin = createState();
        const t0 = 4;
        state.gameOver(t0);
        twin.gameOver(t0);
        state.update(t0 + fall + 1, FRAME);
        const standing = state.out.night;
        expect(standing).toBeCloseTo(DEPTH, 12);
        state.resetSession();
        expect(state.update(t0 + fall + 1, 0).night).toBe(standing);
        state.resetSession();
        state.configure({ reducedMotion: true });
        state.configure({ reducedMotion: false });
        state.setLevel(1, t0 + fall + 2);
        for (const [t, v] of sample(twin, t0, t0 + WHOLE + 1, 0.05)) {
            expect(state._overAt(t), `at ${t}`).toBe(v);
        }
    });

    it('does nothing with reactions off, and a new run with no night to lift changes nothing', () => {
        const off = createState({ intensity: 0 });
        off.gameOver(3);
        for (const [, v] of sample(off, 3, 3 + WHOLE, 0.25)) expect(v).toBe(0);
        expect(off.update(3 + fall, FRAME).night).toBe(0);

        const state = createState();
        const twin = createState();
        state.sessionStart(2);
        expect(state.update(2.5, FRAME).night).toBe(0);
        // The night that follows is the night a state never told of a new run would have.
        state.gameOver(6);
        twin.gameOver(6);
        for (const [t, v] of sample(twin, 6, 6 + WHOLE + 1, 0.05)) expect(state._overAt(t), `at ${t}`).toBe(v);
    });

    it('lets a new run break the day at once, from where the night stands, with no jump', () => {
        const t0 = 10;
        // Called in the fall, in the stand, in the dawn.
        for (let at = 0.05; at < WHOLE - 0.05; at += 0.173) {
            const state = createState();
            state.gameOver(t0);
            const tc = t0 + at;
            const before = state._overAt(tc);
            expect(before).toBeGreaterThan(0);
            state.sessionStart(tc);
            expect(Math.abs(state._overAt(tc) - before), `continuity ${at} s in`).toBeLessThan(1e-6);
            const rows = sample(state, tc, tc + wake + 1, 0.01);
            for (let i = 1; i < rows.length; i++) {
                expect(rows[i][1], `lifting ${at} s in`).toBeLessThanOrEqual(rows[i - 1][1] + 1e-12);
            }
            expect(widestStep(rows), `${at} s in`).toBeLessThanOrEqual(((1.5 * DEPTH * 0.01) / wake) * 1.01);
            // Gone within RUN_END.wake, however deep it stood, and it stays gone.
            expect(state._overAt(tc + wake), `${at} s in`).toBe(0);
            expect(state._overAt(tc + WHOLE), `${at} s in`).toBe(0);
        }
    });

    it('lifts as fast through the optics: the day is back RUN_END.wake after a new run', () => {
        const state = createState();
        state.gameOver(2);
        const standing = state.update(2 + fall + 3, FRAME).night;
        state.sessionStart(2 + fall + 3);
        expect(state.update(2 + fall + 3, 0).night).toBeCloseTo(standing, 9);
        let last = standing;
        for (let t = 2 + fall + 3; t <= 2 + fall + 3 + wake + FRAME; t += FRAME) {
            const out = state.update(t, FRAME);
            expect(out.night).toBeLessThanOrEqual(last + 1e-12);
            last = out.night;
        }
        expect(last).toBe(0);
        expect(state.out.dusk).toBe(0);
    });

    it('never jumps for a second ending while it stands, and stands a whole hold again', () => {
        const t0 = 10;
        for (let at = 0.05; at < WHOLE + 1; at += 0.211) {
            const state = createState();
            state.gameOver(t0);
            const tc = t0 + at;
            const before = state._overAt(tc);
            state.gameOver(tc);
            expect(Math.abs(state._overAt(tc) - before), `continuity ${at} s in`).toBeLessThan(1e-6);
            // It falls on from there, never back, and is deep again within a fall.
            const rows = sample(state, tc, tc + fall, 0.01);
            for (let i = 1; i < rows.length; i++) {
                expect(rows[i][1], `falling on ${at} s in`).toBeGreaterThanOrEqual(rows[i - 1][1] - 1e-12);
            }
            expect(state._overAt(tc + fall), `${at} s in`).toBeCloseTo(DEPTH, 9);
            expect(state._overAt(tc + hold), `${at} s in`).toBeCloseTo(DEPTH, 9);
            // And it still ends by itself.
            expect(state._overAt(tc + WHOLE), `${at} s in`).toBe(0);
        }
    });

    it('falls afresh for the run after a new run broke the day', () => {
        const state = createState();
        const twin = createState();
        state.gameOver(3);
        state.sessionStart(3 + fall + 2);
        expect(state._overAt(3 + fall + 2 + wake)).toBe(0);
        // The next ending is a whole night again (the quick dawn was the new run's alone).
        state.gameOver(40);
        twin.gameOver(40);
        for (const [t, v] of sample(twin, 40, 40 + WHOLE + 1, 0.05)) {
            expect(state._overAt(t), `at ${t}`).toBeCloseTo(v, 12);
        }
        // A new run in the middle of that night's dawn, and an ending in the middle of the wake.
        const busy = createState();
        busy.gameOver(3);
        busy.sessionStart(3 + fall + 1);
        const mid = 3 + fall + 1 + wake / 2;
        const before = busy._overAt(mid);
        expect(before).toBeGreaterThan(0);
        busy.gameOver(mid);
        expect(Math.abs(busy._overAt(mid) - before)).toBeLessThan(1e-6);
        // (It was part fallen already: it is deep within a fall, stands a hold, and still ends.)
        expect(busy._overAt(mid + fall)).toBeCloseTo(DEPTH, 9);
        expect(busy._overAt(mid + hold)).toBeCloseTo(DEPTH, 9);
        expect(busy._overAt(mid + WHOLE)).toBe(0);
    });

    it('takes the state\'s own time when it is handed none, or nonsense', () => {
        for (const now of [undefined, Number.NaN, Infinity, -Infinity]) {
            const state = createState();
            state.update(12, FRAME);
            state.gameOver(now);
            expect(state._overAt(12), String(now)).toBe(0);
            expect(state._overAt(12 + fall), String(now)).toBeCloseTo(DEPTH, 12);
            state.sessionStart(now);
            const out = state.update(12 + fall, FRAME);
            expect(Number.isFinite(out.night) && Number.isFinite(out.dusk) && Number.isFinite(out.stars)).toBe(true);
        }
        // An ending still to come has cast no night yet.
        const early = createState();
        early.gameOver(100);
        expect(early._overAt(50)).toBe(0);
        expect(early.update(50, FRAME).night).toBe(0);
    });

    it('leaves the plain as a fresh one once the night is over', () => {
        const used = createState();
        const fresh = createState();
        used.gameOver(1);
        used.resetSession();
        used.sessionStart(1 + fall + 1);
        used.gameOver(9);
        const t = 9 + WHOLE + 1;
        const a = used.update(t, FRAME);
        const b = fresh.update(t, FRAME);
        for (const key of ['night', 'dusk', 'stars', 'stoneStars', 'nacre', 'dogTint']) {
            expect(a[key], key).toBe(b[key]);
        }
        expect(Array.from(a.sweep)).toEqual(Array.from(b.sweep));
        expect(Array.from(a.rays)).toEqual(Array.from(b.rays));
    });

    // Was FAULT 3 (found by this test, fixed 2026-11-20; what follows is what the code did then): sessionStart() only lifts a night that already shows (`_overAt(t) > 0`), and a
    // night that began at this very time is still 0. A new run that starts on the same theme time
    // as the last one ended (no frame drawn between the two events: an instant restart, or the
    // theme's loop held between them) is ignored: the night then falls over the NEW run to 0.94
    // and stands its whole 11 s there.
    it('casts no night over a run that starts in the instant the last one ended', () => {
        const state = createState();
        state.update(10, FRAME);
        state.gameOver(10);
        state.sessionStart(10);
        let deepest = 0;
        for (let t = 10; t <= 10 + WHOLE; t += FRAME) deepest = Math.max(deepest, state.update(t, FRAME).night);
        expect(deepest).toBeLessThan(1e-6);
    });
});

// ---------------------------------------------------------------------------------------
// The theme wrapper
// ---------------------------------------------------------------------------------------

function createModeManager() {
    const handlers = new Map();
    return {
        getCurrentModeId: () => 'single',
        on: vi.fn((event, handler) => {
            if (!handlers.has(event)) handlers.set(event, new Set());
            handlers.get(event).add(handler);
            return () => handlers.get(event)?.delete(handler);
        }),
        emit(event, data) {
            [...(handlers.get(event) || [])].forEach((handler) => handler(data));
        },
    };
}

function installBrowserStubs() {
    const listeners = new Map();
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const win = {
        addEventListener: vi.fn((event, handler) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(handler);
        }),
        removeEventListener: vi.fn((event, handler) => listeners.get(event)?.delete(handler)),
        dispatch(event, detail) {
            [...(listeners.get(event) || [])].forEach((handler) => handler({ type: event, detail }));
        },
        devicePixelRatio: 1,
        innerWidth: 1920,
        innerHeight: 1080,
        location: { hostname: 'localhost', protocol: 'http:', search: '' },
        matchMedia: vi.fn(() => media),
        settings: {},
        serenityBlocks: { gameModeManager: createModeManager() },
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', {
        body: { appendChild: vi.fn(), insertBefore: vi.fn(), firstChild: null },
        getElementById: vi.fn(() => null),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
    });
    vi.stubGlobal('navigator', { gpu: null, userAgent: 'vitest' });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return win;
}

/** A runtime as the effect hands the wrapper one, recording the order of what it is told. */
function createFakeRuntime(order) {
    const told = (name) => vi.fn(() => { order.push(name); });
    return {
        post: { pipeline: { dispose: vi.fn(), render: vi.fn() } },
        cue: vi.fn(),
        count: vi.fn(),
        setResonance: vi.fn(),
        setLevel: told('setLevel'),
        configure: vi.fn(),
        setLayout: vi.fn(),
        resize: vi.fn(),
        camera: vi.fn(),
        update: vi.fn(),
        render: vi.fn(),
        dispose: vi.fn(),
        resetSession: told('resetSession'),
        gameOver: told('gameOver'),
        sessionStart: told('sessionStart'),
    };
}

function createFakeRenderer() {
    const parent = { removeChild: vi.fn() };
    const canvas = { parentNode: parent, style: {}, setAttribute: vi.fn() };
    parent.removeChild.mockImplementation(() => { canvas.parentNode = null; });
    return {
        canvas,
        domElement: canvas,
        backend: { isWebGPUBackend: false },
        setAnimationLoop: vi.fn(),
        setPixelRatio: vi.fn(),
        setSize: vi.fn(),
        getPixelRatio: () => 1,
        dispose: vi.fn(),
    };
}

describe('Parhelion run end: the theme wrapper', () => {
    let win;
    const live = [];

    /** A theme wired the way createScene() leaves it, with fakes standing in for the GPU. */
    function build(runtime) {
        const theme = new ParhelionTheme();
        theme.isActive = true;
        theme.hasStarted = true;
        theme.lifecycleState = 'running';
        theme.renderer = createFakeRenderer();
        theme.scene = new THREE.Scene();
        theme.camera = new THREE.PerspectiveCamera(46, 16 / 9, 1, 12000);
        theme.runtime = runtime;
        theme.postProcessing = runtime.post.pipeline;
        theme.resize(1920, 1080);
        theme.setupReactions();
        live.push(theme);
        return theme;
    }

    beforeEach(() => {
        win = installBrowserStubs();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        live.splice(0).forEach((theme) => theme.cleanup());
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('window gameOver ends the run: the reactions are reset FIRST, then the sun goes under', () => {
        const order = [];
        const runtime = createFakeRuntime(order);
        const theme = build(runtime);
        vi.spyOn(theme.director, 'reset').mockImplementation(() => { order.push('director.reset'); });
        theme.level = 7;
        order.length = 0;

        win.dispatch('gameOver', { gameState: {} });

        expect(order).toEqual(['director.reset', 'resetSession', 'gameOver']);
        expect(runtime.gameOver).toHaveBeenCalledTimes(1);
        expect(theme.level).toBe(1);
        // The night is the runtime's to lift: the wrapper starts no new run of its own.
        expect(runtime.sessionStart).not.toHaveBeenCalled();
    });

    it('still resets but casts no night when effects were not allowed', () => {
        const order = [];
        const runtime = createFakeRuntime(order);
        const theme = build(runtime);
        const ended = () => {
            runtime.resetSession.mockClear();
            win.dispatch('gameOver');
            return runtime.resetSession.mock.calls.length;
        };

        theme.isPaused = true;
        expect(ended()).toBe(1);
        theme.isPaused = false;

        window.settings.backgroundComboEffects = false;
        expect(ended()).toBe(1);
        window.settings.backgroundComboEffects = true;

        win.dispatch('settingsChanged', { backgroundComboEffects: false });
        expect(ended()).toBe(1);
        win.dispatch('settingsChanged', { backgroundComboEffects: true });

        theme.isActive = false;
        expect(ended()).toBe(1);
        theme.isActive = true;
        expect(runtime.gameOver).not.toHaveBeenCalled();

        // Allowed again: the next run's end is a night.
        expect(ended()).toBe(1);
        expect(runtime.gameOver).toHaveBeenCalledTimes(1);
    });

    it('modeStarted reads the layout again AND breaks the day', () => {
        const order = [];
        const runtime = createFakeRuntime(order);
        const theme = build(runtime);
        theme.layoutDue.fill(Infinity);
        order.length = 0;

        window.serenityBlocks.gameModeManager.emit('modeStarted', { modeId: 'single' });

        expect(theme.layoutDue[0]).toBe(theme.elapsedTime);
        expect(runtime.sessionStart).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['sessionStart']);
        expect(runtime.resetSession).not.toHaveBeenCalled();
        expect(runtime.gameOver).not.toHaveBeenCalled();
    });

    it('modeStopped only resets (the night outlives the menu), modeActivated only reads the layout', () => {
        const order = [];
        const runtime = createFakeRuntime(order);
        const theme = build(runtime);
        const reset = vi.spyOn(theme.director, 'reset');
        order.length = 0;

        window.serenityBlocks.gameModeManager.emit('modeStopped', { modeId: 'single' });
        expect(order).toEqual(['resetSession']);
        expect(reset).toHaveBeenCalledTimes(1);

        theme.layoutDue.fill(Infinity);
        order.length = 0;
        window.serenityBlocks.gameModeManager.emit('modeActivated', { modeId: 'single' });
        expect(order).toEqual([]);
        expect(theme.layoutDue[0]).toBe(theme.elapsedTime);
        expect(runtime.gameOver).not.toHaveBeenCalled();
        expect(runtime.sessionStart).not.toHaveBeenCalled();
    });

    it('asks nothing of a runtime that has no run-end hooks, or of no runtime at all', () => {
        const runtime = createFakeRuntime([]);
        delete runtime.gameOver;
        delete runtime.sessionStart;
        delete runtime.resetSession;
        const theme = build(runtime);
        expect(() => {
            win.dispatch('gameOver');
            window.serenityBlocks.gameModeManager.emit('modeStarted', { modeId: 'single' });
            window.serenityBlocks.gameModeManager.emit('modeStopped', { modeId: 'single' });
        }).not.toThrow();
        // Without resetSession the Lower Sun is still walked back to level 1.
        expect(runtime.setLevel).toHaveBeenLastCalledWith(1);

        theme.runtime = null;
        expect(() => {
            theme.endRun();
            window.serenityBlocks.gameModeManager.emit('modeStarted', { modeId: 'single' });
        }).not.toThrow();
        theme.runtime = runtime;
    });

    it('on the real optics state: the night outlives the reset and modeStopped, and the next run lifts it', () => {
        // The effect's runtime hands the optics state its own clock; this one does the same.
        const optics = new ParhelionOpticsState('High');
        optics.configure({ air: 0, walk: 0, happenings: false });
        let now = 0;
        const frames = (seconds) => {
            for (let i = 0; i < Math.round(seconds / FRAME); i++) {
                now += FRAME;
                optics.update(now, FRAME);
            }
            return optics.out;
        };
        const runtime = {
            ...createFakeRuntime([]),
            setLevel: (n) => optics.setLevel(n, now),
            resetSession: () => optics.resetSession(),
            gameOver: () => optics.gameOver(now),
            sessionStart: () => optics.sessionStart(now),
        };
        const theme = build(runtime);
        theme.setRunLevel(6);
        frames(5);
        expect(optics.out.night).toBe(0);

        win.dispatch('gameOver');
        expect(theme.level).toBe(1);
        expect(optics.levelTo).toBe(1);
        expect(frames(fall).night).toBeCloseTo(DEPTH, 6);

        // Behind the result screen and the menu.
        window.serenityBlocks.gameModeManager.emit('modeStopped', { modeId: 'single' });
        expect(frames(1).night).toBeCloseTo(DEPTH, 6);

        // The next run: day within RUN_END.wake.
        window.serenityBlocks.gameModeManager.emit('modeStarted', { modeId: 'single' });
        const lifting = frames(wake / 2).night;
        expect(lifting).toBeGreaterThan(0);
        expect(lifting).toBeLessThan(DEPTH);
        expect(frames(wake / 2 + 2 * FRAME).night).toBe(0);
    });
});
