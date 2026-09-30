import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three/webgpu';

import ParhelionTheme from '../../src/themes/parhelion/parhelion-theme.js';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { THEME_REGISTRY, getThemeMeta } from '../../src/themes/theme-registry.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { PARHELION_TETROMINOS } from '../../src/themes/parhelion/parhelion-tetrominos.js';
import { CUE } from '../../src/themes/parhelion/sim/parhelion-reaction-director.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THEME_DIR = path.join(ROOT, 'src/themes/parhelion');
const EFFECTS_DIR = path.join(ROOT, 'src/playground/effects');
const TESTS_DIR = path.join(ROOT, 'tests/unit');
const THEME_FILE = path.join(THEME_DIR, 'parhelion-theme.js');
const POST_FILE = path.join(EFFECTS_DIR, 'parhelion-post.js');

function listJs(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listJs(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

function parhelionSourceFiles() {
    return [
        ...listJs(THEME_DIR),
        ...readdirSync(EFFECTS_DIR)
            .filter((name) => name.startsWith('parhelion') && name.endsWith('.js'))
            .map((name) => path.join(EFFECTS_DIR, name)),
    ];
}

function parhelionTestFiles() {
    return readdirSync(TESTS_DIR)
        .filter((name) => name.startsWith('parhelion') && name.endsWith('.js'))
        .map((name) => path.join(TESTS_DIR, name));
}

function methodBody(source, signature) {
    const start = source.indexOf(`    ${signature} {`);
    expect(start, `${signature} not found`).toBeGreaterThan(-1);
    const end = source.indexOf('\n    }\n', start);
    return source.slice(start, end);
}

const T_PIECE = Object.freeze({
    shapeKey: 'T', shape: [[0, 1, 0], [1, 1, 1]], x: 4, y: 21,
});

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
        count(event) {
            return handlers.get(event)?.size ?? 0;
        },
    };
}

function installBrowserStubs() {
    const listeners = new Map();
    const media = {
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    const win = {
        addEventListener: vi.fn((event, handler) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(handler);
        }),
        removeEventListener: vi.fn((event, handler) => listeners.get(event)?.delete(handler)),
        dispatch(event, detail) {
            [...(listeners.get(event) || [])].forEach((handler) => handler({ type: event, detail }));
        },
        listenerCount(event) {
            return listeners.get(event)?.size ?? 0;
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
    let rafId = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => {
        rafId += 1;
        return rafId;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return win;
}

function createFakeRuntime(order = []) {
    return {
        post: { pipeline: { dispose: vi.fn(), render: vi.fn() } },
        cue: vi.fn(),
        count: vi.fn(),
        setResonance: vi.fn(),
        setLevel: vi.fn(),
        configure: vi.fn(),
        setLayout: vi.fn(() => order.push('layout')),
        resize: vi.fn(),
        camera: vi.fn(() => order.push('camera')),
        update: vi.fn(() => order.push('update')),
        render: vi.fn(() => order.push('render')),
        dispose: vi.fn(() => order.push('runtime.dispose')),
    };
}

function createFakeRenderer(order = []) {
    const parent = { removeChild: vi.fn() };
    const canvas = { parentNode: parent, style: {}, setAttribute: vi.fn() };
    parent.removeChild.mockImplementation(() => { canvas.parentNode = null; });
    return {
        canvas,
        parent,
        domElement: canvas,
        backend: { isWebGPUBackend: false },
        setAnimationLoop: vi.fn(),
        setPixelRatio: vi.fn(),
        setSize: vi.fn(),
        getPixelRatio: () => 1,
        dispose: vi.fn(() => order.push('renderer.dispose')),
    };
}

/** A theme wired the way createScene() leaves it, with fakes standing in for the GPU. */
function buildLiveTheme(order = []) {
    const theme = new ParhelionTheme();
    const runtime = createFakeRuntime(order);
    const renderer = createFakeRenderer(order);
    theme.isActive = true;
    theme.hasStarted = true;
    theme.lifecycleState = 'running';
    theme.renderer = renderer;
    theme.scene = new THREE.Scene();
    theme.camera = new THREE.PerspectiveCamera(46, 16 / 9, 1, 12000);
    theme.runtime = runtime;
    theme.postProcessing = runtime.post.pipeline;
    theme.resize(1920, 1080);
    theme.setupReactions();
    return { theme, runtime, renderer };
}

describe('Parhelion theme wiring', () => {
    let win;
    const live = [];

    function build(order) {
        const built = buildLiveTheme(order);
        live.push(built.theme);
        return built;
    }

    beforeEach(() => {
        win = installBrowserStubs();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        // Tear every theme down so no handler leaks onto the shared event bus.
        live.splice(0).forEach((theme) => theme.cleanup());
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('source contracts (spec §12)', () => {
        it('never builds an MRT scene pass in any Parhelion file', () => {
            // Calls only: the post module's header comment explains why there is "no setMRT".
            const offenders = parhelionSourceFiles()
                .filter((file) => /\bsetMRT\s*\(|\bmrt\s*\(/.test(readFileSync(file, 'utf8')));
            expect(offenders).toEqual([]);
        });

        it('keeps the post chain as the single tone map + encode, with half-res bloom', () => {
            const post = readFileSync(POST_FILE, 'utf8');
            expect(post).toMatch(/\.outputColorTransform\s*=\s*false/);
            expect(post).toMatch(/setResolutionScale\(\s*0\.5\s*\*/);
        });

        it('carries no forbidden block-game names in any Parhelion source or test', () => {
            // Built from pieces so this file never contains the words it bans.
            const banned = new RegExp(['tet', '(?:', 'ris', '|', 'rimino', ')'].join(''), 'i');
            const offenders = [...parhelionSourceFiles(), ...parhelionTestFiles()]
                .filter((file) => banned.test(readFileSync(file, 'utf8')))
                .map((file) => path.relative(ROOT, file));
            expect(offenders).toEqual([]);
        });

        it('guards the loop starter and clears subscriptions before subscribing', () => {
            const source = readFileSync(THEME_FILE, 'utf8');
            expect(methodBody(source, 'animate()')).toMatch(/^\s*animate\(\)\s*\{\s*if \(this\.animationLoopStarted\b/);
            const setup = methodBody(source, 'setupReactions()');
            const clearAt = setup.indexOf('this.clearEventUnsubscribers();');
            expect(clearAt).toBeGreaterThan(-1);
            expect(clearAt).toBeLessThan(setup.indexOf('eventBus.on('));
            expect(clearAt).toBeLessThan(setup.indexOf('this.registerEventListener('));
        });

        it('adds no raw resize listener and no ShaderMaterial', () => {
            const pattern = /new\s+[\w$.]*ShaderMaterial\s*\(|addEventListener\(\s*['"]resize/;
            const offenders = parhelionSourceFiles().filter((file) => pattern.test(readFileSync(file, 'utf8')));
            expect(offenders).toEqual([]);
        });
    });

    describe('registry', () => {
        it('appends Parhelion last, in the sky group, under the heavy-GPU policy', () => {
            expect(THEME_REGISTRY.at(-1).id).toBe('parhelion');
            expect(getThemeMeta('parhelion')).toMatchObject({
                id: 'parhelion',
                displayName: 'Parhelion',
                module: './parhelion/parhelion-theme.js',
                icon: './parhelion/parhelion-theme-icon.png',
                group: 'sky',
                resourceProfile: 'heavy-gpu',
                performanceClass: 'heavy',
                startupEligible: false,
            });
            expect(existsSync(path.join(ROOT, 'src/themes', getThemeMeta('parhelion').module))).toBe(true);
        });
    });

    describe('construction and inert lifecycle (Node, stub globals)', () => {
        it('constructs with zero args, no DOM or GPU work, and answers the static hooks', async () => {
            const theme = new ParhelionTheme();
            expect(theme).toBeInstanceOf(BaseTheme);
            expect(theme.name).toBe('parhelion');
            expect(theme.renderer).toBeNull();
            expect(theme.runtime).toBeNull();
            expect(theme.postProcessing).toBeNull();
            expect(theme.eventUnsubscribers).toEqual([]);
            expect(document.getElementById).not.toHaveBeenCalled();
            expect(window.addEventListener).not.toHaveBeenCalled();

            expect(theme.getWarmupRoots()).toEqual([]);
            expect(theme.usesMrtScenePass()).toBe(false);
            expect(theme.getTetrominoConfig()).toBe(PARHELION_TETROMINOS);
            await expect(theme.whenCriticalReady()).resolves.toBe(false);
            expect(theme.resume()).toBe(false); // no runtime → the manager does a full restart

            expect(() => {
                theme.stop();
                theme.stop();
                theme.cleanup();
                theme.cleanup();
            }).not.toThrow();
            expect(theme.cleanupComplete).toBe(true);
            expect(theme.lifecycleState).toBe('stopped');
        });

        it('normalises all six effect-quality tiers', () => {
            const theme = new ParhelionTheme();
            ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'].forEach((tier) => {
                window.settings.effectQuality = tier.toLowerCase();
                expect(theme.getRendererSettingsSnapshot().quality).toBe(tier);
            });
            window.settings.effectQuality = 'bogus';
            expect(theme.getRendererSettingsSnapshot().quality).toBe('High');
        });

        it('hands create() the tier, the seed and a param set without playground-only mocks', () => {
            const theme = new ParhelionTheme();
            theme.quality = 'Ultra';
            const params = new URLSearchParams('board=1&t=8&parhelionSeed=42&parhelionCalmDebug=1');
            const context = theme.createRuntimeContext(params, 800, 600);
            expect(context.tier).toBe('Ultra');
            expect(context.sizes).toEqual({ width: 800, height: 600 });
            expect(context.THREE).toBe(THREE);
            expect(context.params.has('board')).toBe(false);
            expect(context.params.has('t')).toBe(false);
            expect(context.params.get('parhelionCalmDebug')).toBe('1');
            expect(context.params.get('quality')).toBe('Ultra');
            expect(context.seed).toBe(42);
            const replay = theme.createRuntimeContext(params, 800, 600);
            expect([context.rng(), context.rng()]).toEqual([replay.rng(), replay.rng()]);
            expect(params.has('board')).toBe(true); // the caller's params are untouched

            const unseeded = theme.createRuntimeContext(new URLSearchParams(), 800, 600);
            expect('seed' in unseeded).toBe(false);
            expect('rng' in unseeded).toBe(false);
        });

        it('reads ?parhelionFixedDt in seconds (or milliseconds above 1)', () => {
            const theme = new ParhelionTheme();
            expect(theme.readFixedDelta(new URLSearchParams('parhelionFixedDt=0.02'))).toBeCloseTo(0.02, 9);
            expect(theme.readFixedDelta(new URLSearchParams('parhelionFixedDt=16.5'))).toBeCloseTo(0.0165, 9);
            expect(theme.readFixedDelta(new URLSearchParams('parhelionFixedDt=-1'))).toBe(0);
            expect(theme.readFixedDelta(new URLSearchParams())).toBe(0);
        });
    });

    describe('gameplay reactions', () => {
        it('stages events only while active, unpaused and with combo effects on', () => {
            const { theme, runtime } = build();
            const clear = { lineCount: 1, clearedRows: [23], cascadeCount: 1 };

            eventBus.emit(EVENTS.LINE_CLEAR, clear);
            expect(runtime.cue).not.toHaveBeenCalled(); // handlers stage only
            theme.director.update(1 / 60);
            expect(runtime.cue).toHaveBeenCalledTimes(1);
            expect(runtime.cue.mock.calls[0][0].kind).toBe(CUE.CLEAR);

            theme.isPaused = true;
            eventBus.emit(EVENTS.LINE_CLEAR, clear);
            theme.director.update(1 / 60);
            expect(runtime.cue).toHaveBeenCalledTimes(1);

            theme.isPaused = false;
            window.settings.backgroundComboEffects = false;
            eventBus.emit(EVENTS.LINE_CLEAR, clear);
            theme.director.update(1 / 60);
            expect(runtime.cue).toHaveBeenCalledTimes(1);

            theme.isActive = false;
            window.settings.backgroundComboEffects = true;
            eventBus.emit(EVENTS.LINE_CLEAR, clear);
            theme.director.update(1 / 60);
            expect(runtime.cue).toHaveBeenCalledTimes(1);
        });

        it('routes pieceLockRipple through the director: no lock cue, but the lock still counts', () => {
            const { theme, runtime } = build();
            win.dispatch('settingsChanged', { pieceLockRipple: false });
            expect(theme.director.lockRipple).toBe(false);

            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T_PIECE });
            theme.director.update(1 / 60);
            expect(runtime.cue).not.toHaveBeenCalled();
            expect(theme.director.lockCount).toBe(1);

            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T_PIECE });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.director.update(1 / 60);
            expect(runtime.cue).toHaveBeenCalledTimes(1);
            expect(runtime.cue.mock.calls[0][0].kind).toBe(CUE.CLEAR);
            expect(theme.director.lockCount).toBe(2);
        });

        it('maps the director sink onto the runtime (cue, count, resonance, level)', () => {
            const { theme, runtime } = build();
            for (let lock = 0; lock < 12; lock += 1) {
                eventBus.emit(EVENTS.PIECE_LOCK, { piece: T_PIECE });
                theme.director.update(1 / 60);
            }
            expect(runtime.cue).toHaveBeenCalledTimes(12);
            expect(runtime.count).toHaveBeenCalledWith(12);

            eventBus.emit(EVENTS.PIECE_LOCK, { piece: T_PIECE });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, clearedRows: [22, 23], cascadeCount: 1 });
            theme.director.update(0.1);
            expect(runtime.setResonance).toHaveBeenCalled();
            expect(runtime.setResonance.mock.calls.at(-1)[0]).toBeGreaterThan(0);

            eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
            theme.director.update(1 / 60);
            expect(runtime.setLevel).toHaveBeenCalledWith(3);
        });

        it('pushes reduced-motion / combo-effect settings into the director and the runtime', () => {
            const { theme, runtime } = build();
            expect(runtime.configure).toHaveBeenLastCalledWith({ reducedMotion: false, intensity: 1 });

            win.dispatch('settingsChanged', { reducedMotion: true });
            expect(runtime.configure).toHaveBeenLastCalledWith({ reducedMotion: true, intensity: 1 });
            expect(theme.director.reducedMotion).toBe(true);

            // The bus payload leads window.settings.
            eventBus.emit(EVENTS.SETTINGS_CHANGED, {
                settings: { reducedMotion: false, backgroundComboEffects: false, effectQuality: 'High' },
                source: 'local',
            });
            expect(runtime.configure).toHaveBeenLastCalledWith({ reducedMotion: false, intensity: 0 });
            expect(theme.director.intensity).toBe(0);
        });

        it('queues a rebuild for effectQuality / antialiasing and a resize for renderScale', () => {
            const { theme } = build();
            const rebuild = vi.spyOn(theme, 'queueRebuild').mockImplementation(() => {});
            const resize = vi.spyOn(theme, 'queueResize').mockImplementation(() => {});

            win.dispatch('settingsChanged', { effectQuality: 'low' });
            expect(rebuild).toHaveBeenCalledTimes(1);
            expect(theme.pendingQuality).toBe('Low');

            theme.pendingQuality = null;
            win.dispatch('settingsChanged', { enableAntialiasing: false });
            expect(rebuild).toHaveBeenCalledTimes(2);
            expect(theme.pendingAntialiasing).toBe(false);

            theme.pendingAntialiasing = null;
            eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'renderScale', value: 0.75 });
            expect(resize).toHaveBeenCalledTimes(1);
            expect(rebuild).toHaveBeenCalledTimes(2);
        });

        it('resets on window gameOver and on the mode manager modeStopped', () => {
            const { theme, runtime } = build();
            const reset = vi.spyOn(theme.director, 'reset');
            win.dispatch('gameOver');
            expect(reset).toHaveBeenCalledTimes(1);
            expect(runtime.setLevel).toHaveBeenLastCalledWith(1); // Lower Sun back to rest

            runtime.resetSession = vi.fn();
            window.serenityBlocks.gameModeManager.emit('modeStopped', { modeId: 'single' });
            expect(reset).toHaveBeenCalledTimes(2);
            expect(runtime.resetSession).toHaveBeenCalledTimes(1);
        });

        it('re-running setupReactions never stacks a second subscription set', () => {
            const { theme, runtime } = build();
            const manager = window.serenityBlocks.gameModeManager;
            theme.setupReactions();
            theme.setupReactions();

            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23], cascadeCount: 1 });
            theme.director.update(1 / 60);
            expect(runtime.cue).toHaveBeenCalledTimes(1);
            expect(win.listenerCount('gameOver')).toBe(1);
            expect(win.listenerCount('settingsChanged')).toBe(1);
            expect(manager.count('modeStarted')).toBe(1);
            expect(manager.count('modeActivated')).toBe(1);
            expect(manager.count('modeStopped')).toBe(1);
        });
    });

    describe('frame loop', () => {
        it('runs director.update first, then camera/update, render, then the layout re-reads', () => {
            const order = [];
            const { theme } = build(order);
            const update = theme.director.update.bind(theme.director);
            theme.director.update = (dt) => {
                order.push('director');
                update(dt);
            };
            theme.scheduleLayoutReads();
            order.length = 0;
            theme.stepFrame(1000);
            expect(order).toEqual(['director', 'camera', 'update', 'render', 'layout']);
        });

        it('clamps dt to [0, 0.05] from RAF timestamps, or uses the fixed step', () => {
            const { theme, runtime } = build();
            theme.stepFrame(1000);
            expect(runtime.update.mock.calls.at(-1)[1]).toBeCloseTo(1 / 60, 9);
            theme.stepFrame(1500);
            expect(runtime.update.mock.calls.at(-1)[1]).toBe(0.05);
            theme.stepFrame(1400);
            expect(runtime.update.mock.calls.at(-1)[1]).toBe(0);
            theme.fixedDelta = 0.02;
            theme.stepFrame(9000);
            expect(runtime.update.mock.calls.at(-1)[1]).toBe(0.02);
            const [t] = runtime.update.mock.calls.at(-1);
            expect(t).toBeCloseTo(theme.elapsedTime, 12);
        });

        it('re-reads the DOM rects now, +0.5 s and +1.5 s on frame time, with no timers', () => {
            const { theme, runtime } = build();
            const timers = vi.spyOn(globalThis, 'setTimeout');
            theme.fixedDelta = 0.1;
            const t0 = theme.elapsedTime;
            theme.scheduleLayoutReads();
            const at = [];
            runtime.setLayout.mockImplementation(() => at.push(theme.elapsedTime - t0));
            for (let frame = 0; frame < 30; frame += 1) theme.stepFrame(frame * 100);

            expect(at).toHaveLength(3);
            expect(at[0]).toBeCloseTo(0.1, 9);
            expect(at[1]).toBeGreaterThanOrEqual(0.5 - 1e-9);
            expect(at[1]).toBeLessThan(0.6 + 1e-9);
            expect(at[2]).toBeGreaterThanOrEqual(1.5 - 1e-9);
            expect(at[2]).toBeLessThan(1.6 + 1e-9);
            expect(timers).not.toHaveBeenCalled();

            // No board in this DOM stub: the reader's fallback layout, one reused object.
            const layouts = runtime.setLayout.mock.calls.map(([layout]) => layout);
            expect(layouts[0].fallback).toBe(true);
            expect(new Set(layouts).size).toBe(1);
        });

        it('resizes from VIEWPORT_RESIZED, falling back to the live viewport for an empty payload', () => {
            const { theme, runtime } = build();
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 1584, height: 787, dpr: 1 });
            expect(theme.appliedSize).toMatchObject({ w: 1584, h: 787 });
            expect(runtime.resize).toHaveBeenLastCalledWith(1584, 787, theme.appliedSize.pixelRatio);
            eventBus.emit(EVENTS.VIEWPORT_RESIZED, {});
            expect(theme.appliedSize.w).toBeGreaterThan(1);
            expect(theme.appliedSize.h).toBeGreaterThan(1);
        });

        it('schedules a re-read on resize, modeStarted and modeActivated', () => {
            const { theme } = build();
            theme.layoutDue.fill(Infinity);
            theme.resize(1680, 1050);
            expect(theme.layoutDue[0]).toBe(theme.elapsedTime);

            theme.layoutDue.fill(Infinity);
            window.serenityBlocks.gameModeManager.emit('modeStarted', { modeId: 'single' });
            expect(theme.layoutDue[0]).toBe(theme.elapsedTime);

            theme.layoutDue.fill(Infinity);
            window.serenityBlocks.gameModeManager.emit('modeActivated', { modeId: 'single' });
            expect(theme.layoutDue[2]).toBe(theme.elapsedTime + 1.5);
        });

        it('starts one loop only; pause() re-arms it for restartRenderLoop()', () => {
            const { theme } = build();
            theme.animate();
            theme.animate();
            expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
            expect(theme.animationIds).toHaveLength(1);

            expect(theme.pause()).toBe(true);
            expect(theme.animationLoopStarted).toBe(false);
            expect(theme.resume()).toBe(true);
            theme.restartRenderLoop();
            theme.restartRenderLoop();
            expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
            expect(theme.lastFrameTimeMs).toBeNull();
        });
    });

    describe('teardown', () => {
        it('stop()/cleanup() are synchronous, idempotent and leave nothing live', () => {
            const order = [];
            const { theme, runtime, renderer } = build(order);
            const resilience = theme.removeRendererResilience.bind(theme);
            theme.removeRendererResilience = () => {
                order.push('resilience');
                resilience();
            };
            theme.animate();
            const { director } = theme;
            live.splice(live.indexOf(theme), 1);

            const result = theme.cleanup();
            expect(result).toBeUndefined();
            theme.cleanup();
            theme.stop();

            expect(runtime.dispose).toHaveBeenCalledTimes(1);
            expect(renderer.dispose).toHaveBeenCalledTimes(1);
            expect(order.indexOf('resilience')).toBeGreaterThan(-1);
            expect(order.indexOf('resilience')).toBeLessThan(order.indexOf('renderer.dispose'));
            expect(renderer.canvas.parentNode).toBeNull();
            expect(director.disposed).toBe(true);

            expect(theme.renderer).toBeNull();
            expect(theme.scene).toBeNull();
            expect(theme.camera).toBeNull();
            expect(theme.runtime).toBeNull();
            expect(theme.postProcessing).toBeNull();
            expect(theme.director).toBeNull();
            expect(theme.eventUnsubscribers).toEqual([]);
            expect(theme.animationIds).toEqual([]);
            expect(theme._eventListeners ?? []).toEqual([]);
            expect(theme.cleanupComplete).toBe(true);
            expect(theme.isActive).toBe(false);
            expect(theme.lifecycleState).toBe('stopped');

            const manager = window.serenityBlocks.gameModeManager;
            expect(win.listenerCount('gameOver')).toBe(0);
            expect(win.listenerCount('settingsChanged')).toBe(0);
            ['modeStarted', 'modeActivated', 'modeStopped'].forEach((event) => {
                expect(manager.count(event)).toBe(0);
            });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, clearedRows: [23] });
            expect(runtime.cue).not.toHaveBeenCalled();
        });
    });
});
