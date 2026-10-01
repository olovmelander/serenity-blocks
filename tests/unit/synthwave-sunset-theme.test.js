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

import SynthwaveSunsetTheme from '../../src/themes/synthwave-sunset/synthwave-sunset-theme.js';
import {
    SynthwaveWorld,
    WORLD_QUALITY,
    boardRectsDiffer,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-world.js';
import { GRID_SPACING, SCROLL_SPEED, SCROLL_WRAP } from '../../src/themes/synthwave-sunset/synthwave-sunset-tsl.js';
import { POST_LOOK } from '../../src/themes/synthwave-sunset/synthwave-sunset-post.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THEME_DIR = path.join(ROOT, 'src/themes/synthwave-sunset');

function installBrowserStubs() {
    const listeners = new Map();
    const win = {
        addEventListener: vi.fn((event, handler) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(handler);
        }),
        removeEventListener: vi.fn((event, handler) => listeners.get(event)?.delete(handler)),
        listenerCount: (event) => listeners.get(event)?.size ?? 0,
        devicePixelRatio: 1,
        innerWidth: 1920,
        innerHeight: 1080,
        location: { hostname: 'localhost', protocol: 'http:', search: '' },
        matchMedia: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
        settings: { backgroundComboEffects: true },
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', {
        body: { appendChild: vi.fn() },
        getElementById: vi.fn(() => null),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return win;
}

function fakeWorld() {
    return {
        onPieceLock: vi.fn(),
        onLineClear: vi.fn(),
        onCombo: vi.fn(),
        onLevelUp: vi.fn(),
        dispose: vi.fn(),
    };
}

describe('synthwave-sunset theme wiring', () => {
    let win;
    beforeEach(() => {
        win = installBrowserStubs();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('routes gameplay events to the world only while backgroundComboEffects is on, and stop() unsubscribes', () => {
        const theme = new SynthwaveSunsetTheme();
        theme.isActive = true;
        const world = fakeWorld();
        theme.world = world;
        theme.setupEventListeners();

        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T', x: 3, rotation: 0 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 3 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        expect(world.onPieceLock).toHaveBeenCalledWith({ type: 'T', x: 3, rotation: 0 });
        expect(world.onLineClear).toHaveBeenCalledWith(2);
        expect(world.onCombo).toHaveBeenCalledWith(3);
        expect(world.onLevelUp).toHaveBeenCalledTimes(1);
        expect(win.listenerCount('pointermove')).toBe(1);
        expect(win.listenerCount('resize')).toBe(1);

        win.settings.backgroundComboEffects = false;
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(world.onLineClear).toHaveBeenCalledTimes(1);

        win.settings.backgroundComboEffects = true;
        theme.stop();
        expect(world.dispose).toHaveBeenCalledTimes(1);
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(world.onLineClear).toHaveBeenCalledTimes(1);
        expect(win.listenerCount('pointermove')).toBe(0);
        expect(win.listenerCount('resize')).toBe(0);
    });

    it('survives stop() on a theme that never built a scene (stale-start retirement path)', () => {
        const theme = new SynthwaveSunsetTheme();
        expect(() => theme.stop()).not.toThrow();
        expect(() => theme.stop()).not.toThrow();
    });

    it('keeps one node-material path: no classic ShaderMaterial or WebGLRenderer anywhere in the theme', () => {
        const files = readdirSync(THEME_DIR).filter((name) => name.endsWith('.js'));
        for (const name of files) {
            const src = readFileSync(path.join(THEME_DIR, name), 'utf8');
            expect(src, name).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(src, name).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            // MaterialX noise is a DXC compile pathology here: no calls, no imports.
            expect(src, name).not.toMatch(/\bmx_(?:noise|fractal)\w*\s*\(|import\s*\{[^}]*\bmx_/);
        }
        const retiredFiles = ['synthwave-shaders.js', 'synthwave-sunset-compute.js', 'synthwave-sunset-materials.js'];
        for (const retired of retiredFiles) {
            expect(existsSync(path.join(THEME_DIR, retired)), retired).toBe(false);
        }
    });

    it('dynamic resolution judges load against the frame cap and recovers after a hitch', () => {
        const theme = new SynthwaveSunsetTheme();
        theme.renderer = {};
        theme.resize = vi.fn();
        const drs = theme.dynamicResolution;
        drs.enabled = true;
        const run = (seconds, frameMs) => {
            for (let t = 0; t < seconds * 1000; t += frameMs) theme.updateDynamicResolution(frameMs / 1000);
        };

        // A 30 FPS Target Frame Rate paces renders to ~33 ms: that is not overload.
        win.serenityBlocks = { settingsManager: { get: () => ({ targetFrameRate: 30 }) } };
        run(5, 33.4);
        expect(drs.scale).toBe(1);

        // Uncapped 60 Hz vsync: a real overload lowers the scale, the steady loop restores it.
        delete win.serenityBlocks;
        run(2, 45);
        expect(drs.scale).toBeLessThan(1);
        run(6, 16.7);
        expect(drs.scale).toBe(1);

        // Tab switches / long stalls are ignored entirely.
        const before = drs.emaMs;
        theme.updateDynamicResolution(2.0);
        expect(drs.emaMs).toBe(before);
    });

    it('has a post look and a world tier for every quality level', () => {
        for (const quality of ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']) {
            expect(WORLD_QUALITY[quality], quality).toBeTruthy();
            expect(POST_LOOK[quality], quality).toBeTruthy();
        }
    });
});

describe('synthwave-sunset world', () => {
    const random = (() => {
        let s = 1;
        return () => {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
    })();

    it('faces the sun with no board and puts it in the free zone left of a solo board', () => {
        const world = new SynthwaveWorld({ scene: new THREE.Scene(), random });
        world.setLayout(16 / 9, null, { immediate: true });
        expect(world.sunScreenX(world.yaw)).toBeCloseTo(0.5, 3);

        // The 1080p solo card: 324 px wide, centred.
        const board = {
            x0: (960 - 162) / 1920, y0: 0.21, x1: (960 + 162) / 1920, y1: 0.79,
        };
        world.setLayout(16 / 9, board);
        expect(world.sunScreenX(world.targetYaw)).toBeCloseTo(board.x0 / 2, 3);
        // Layout changes pan (eased), they never jump.
        expect(world.yaw).toBeCloseTo(0, 5);
        const camera = new THREE.PerspectiveCamera();
        world.updateCamera(camera, { time: 0, delta: 1 / 60 });
        expect(world.yaw).toBeGreaterThan(0);
        expect(world.yaw).toBeLessThan(world.targetYaw);
    });

    it('builds the whole scene in a handful of draws and disposes it', () => {
        const scene = new THREE.Scene();
        const world = new SynthwaveWorld({ scene, quality: 'High', random }).build();
        let drawables = 0;
        scene.traverse((obj) => {
            if (obj.isMesh || obj.isSprite) drawables += 1;
        });
        // sky, floor, mountains, city, palms, cells, sparks, motes
        expect(drawables).toBe(8);
        world.dispose();
        expect(scene.children).toHaveLength(0);
    });

    it('snaps locked-piece cells onto the scrolling grid', () => {
        const world = new SynthwaveWorld({ scene: new THREE.Scene(), random }).build();
        world.setLayout(16 / 9, null, { immediate: true });
        world.update({ time: 37.3, delta: 0 });
        world.onPieceLock({ type: 'O', x: 4, rotation: 0 });
        const cell = world.fx.cells.iCell.array;
        const scroll = (37.3 * SCROLL_SPEED) % SCROLL_WRAP;
        let lit = 0;
        for (let i = 0; i < cell.length; i += 4) {
            if (cell[i + 3] <= 0) continue;
            lit += 1;
            const fx = (cell[i] / GRID_SPACING) % 1;
            const fz = ((((cell[i + 1] - scroll) / GRID_SPACING) % 1) + 1) % 1;
            expect(Math.abs(Math.abs(fx) - 0.5)).toBeLessThan(1e-6);
            expect(Math.abs(fz - 0.5)).toBeLessThan(1e-4);
            expect(cell[i + 2]).toBeCloseTo(37.3, 4); // stored as float32
        }
        expect(lit).toBe(4);
        world.dispose();
    });

    it('sprays the combo burst from the sun across the whole screen', () => {
        const world = new SynthwaveWorld({ scene: new THREE.Scene(), random }).build();
        const board = {
            x0: (960 - 162) / 1920, y0: 0.21, x1: (960 + 162) / 1920, y1: 0.79,
        };
        world.setLayout(16 / 9, board, { immediate: true });
        world.update({ time: 12, delta: 0 });
        const camera = new THREE.PerspectiveCamera(world.lens.vfov, world.lens.aspect, 0.5, 8000);
        world.updateCamera(camera, { time: 0, delta: 0 });
        camera.updateProjectionMatrix();
        const sun = new THREE.Vector2();
        world.getSunScreen(camera, sun);

        world.onCombo(4);
        const { iSpawn, iVel, iMotion } = world.fx.sparks;
        const start = new THREE.Vector3();
        const end = new THREE.Vector3();
        const ends = [];
        for (let i = 0; i < iSpawn.count; i += 1) {
            if (iSpawn.array[i * 4 + 3] < 0) continue; // parked slot
            const drag = iMotion.array[i * 4];
            start.fromArray(iSpawn.array, i * 4).project(camera);
            // Every spark starts on the sun's disc (screen UV, y down)...
            expect(Math.abs(start.x * 0.5 + 0.5 - sun.x)).toBeLessThan(0.12);
            expect(Math.abs(0.5 - start.y * 0.5 - sun.y)).toBeLessThan(0.2);
            // ...and its drag-limited flight ends somewhere on (or just past) the screen.
            end.fromArray(iSpawn.array, i * 4).addScaledVector(
                new THREE.Vector3().fromArray(iVel.array, i * 4),
                1 / drag,
            ).project(camera);
            ends.push([end.x, end.y]);
        }
        expect(ends.length).toBeGreaterThan(100);
        const xs = ends.map((e) => e[0]);
        const ys = ends.map((e) => e[1]);
        // The spray reaches both screen edges and the top and bottom, not just the sun's zone.
        expect(Math.min(...xs)).toBeLessThan(-0.85);
        expect(Math.max(...xs)).toBeGreaterThan(0.85);
        expect(Math.min(...ys)).toBeLessThan(-0.6);
        expect(Math.max(...ys)).toBeGreaterThan(0.85);
        // ...and covers the screen: sparks land in (nearly) every cell of a 4 × 3 grid.
        const cells = new Set();
        for (const [x, y] of ends) {
            if (Math.abs(x) > 1 || Math.abs(y) > 1) continue;
            cells.add(`${Math.min(3, Math.floor((x + 1) * 2))},${Math.min(2, Math.floor((y + 1) * 1.5))}`);
        }
        expect(cells.size).toBeGreaterThanOrEqual(11);
        world.dispose();
    });

    it('treats board rects within half a percent as the same layout', () => {
        const a = {
            x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.8,
        };
        expect(boardRectsDiffer(a, { ...a, x0: 0.402 })).toBe(false);
        expect(boardRectsDiffer(a, { ...a, x0: 0.41 })).toBe(true);
        expect(boardRectsDiffer(a, null)).toBe(true);
        expect(boardRectsDiffer(null, null)).toBe(false);
    });
});
