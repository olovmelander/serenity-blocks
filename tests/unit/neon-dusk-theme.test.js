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

import NeonDuskTheme from '../../src/themes/neon-dusk/neon-dusk-theme.js';
import { NeonDuskWorld, WORLD_QUALITY } from '../../src/themes/neon-dusk/neon-dusk-world.js';
import { POST_LOOK } from '../../src/themes/neon-dusk/neon-dusk-post.js';
import { GRID_SPACING, RIG, SUN } from '../../src/themes/neon-dusk/neon-dusk-tsl.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THEME_DIR = path.join(ROOT, 'src/themes/neon-dusk');

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

const seeded = () => {
    let s = 7;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
};

/** The solo layout's board rect on a 1920×1080 screen. */
const SOLO_BOARD = {
    x0: (960 - 162) / 1920, y0: 0.21, x1: (960 + 162) / 1920, y1: 0.79,
};

function viewCamera(world) {
    world.update({ time: 9, delta: 0 });
    const camera = new THREE.PerspectiveCamera(world.lens.vfov, world.lens.aspect, RIG.near, RIG.far);
    world.updateCamera(camera, { time: 0, delta: 0 });
    camera.updateProjectionMatrix();
    return camera;
}

describe('neon-dusk theme wiring', () => {
    let win;
    beforeEach(() => {
        win = installBrowserStubs();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reacts to gameplay only with background effects on, passes the piece, and stop() unsubscribes', () => {
        const theme = new NeonDuskTheme();
        theme.isActive = true;
        const world = {
            onPieceLock: vi.fn(), onLineClear: vi.fn(), onCombo: vi.fn(), onLevelUp: vi.fn(), dispose: vi.fn(),
        };
        theme.world = world;
        theme.setupEventListeners();

        const piece = { type: 'T', x: 3, rotation: 1 };
        eventBus.emit(EVENTS.PIECE_LOCK, { piece });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 3 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 4 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        expect(world.onPieceLock).toHaveBeenCalledWith(piece);
        expect(world.onLineClear).toHaveBeenCalledWith(3);
        expect(world.onCombo).toHaveBeenCalledWith(4);
        expect(world.onLevelUp).toHaveBeenCalledTimes(1);

        win.settings.backgroundComboEffects = false;
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(world.onLineClear).toHaveBeenCalledTimes(1);

        theme.stop();
        expect(world.dispose).toHaveBeenCalledTimes(1);
        win.settings.backgroundComboEffects = true;
        eventBus.emit(EVENTS.COMBO, { comboCount: 5 });
        expect(world.onCombo).toHaveBeenCalledTimes(1);
        expect(win.listenerCount('pointermove')).toBe(0);
        expect(win.listenerCount('resize')).toBe(0);
    });

    it('survives stop() on a theme that never built a scene', () => {
        const theme = new NeonDuskTheme();
        expect(() => theme.stop()).not.toThrow();
        expect(() => theme.stop()).not.toThrow();
    });

    it('is one node-material path: no classic materials, composer, WebGLRenderer, compute or MaterialX noise', () => {
        for (const name of readdirSync(THEME_DIR).filter((f) => f.endsWith('.js'))) {
            const src = readFileSync(path.join(THEME_DIR, name), 'utf8');
            expect(src, name).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(src, name).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(src, name).not.toMatch(/EffectComposer|UnrealBloomPass/);
            expect(src, name).not.toMatch(/from 'three';/);
            expect(src, name).not.toMatch(/\bmx_(?:noise|fractal)\w*\s*\(|import\s*\{[^}]*\bmx_/);
        }
        for (const retired of ['neon-dusk-shaders.js', 'neon-dusk-materials.js', 'neon-dusk-compute.js']) {
            expect(existsSync(path.join(THEME_DIR, retired)), retired).toBe(false);
        }
    });

    it('has a post look and a world tier for every quality level', () => {
        for (const quality of ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']) {
            expect(WORLD_QUALITY[quality], quality).toBeTruthy();
            expect(POST_LOOK[quality], quality).toBeTruthy();
        }
        // The second scene render (the mirror) is a showcase-tier cost only.
        expect(WORLD_QUALITY.Low.reflection).toBe(0);
        expect(WORLD_QUALITY.Minimal.reflection).toBe(0);
    });
});

describe('neon-dusk world', () => {
    it('faces the sun with no board and puts it in the free zone left of a solo board', () => {
        const world = new NeonDuskWorld({ scene: new THREE.Scene(), random: seeded() });
        world.setLayout(16 / 9, null, { immediate: true });
        expect(world.sunScreenX(world.yaw)).toBeCloseTo(0.5, 3);
        world.setLayout(16 / 9, SOLO_BOARD);
        expect(world.sunScreenX(world.targetYaw)).toBeCloseTo(SOLO_BOARD.x0 / 2, 3);
    });

    it('builds the dusk in a handful of draws and disposes it', () => {
        const scene = new THREE.Scene();
        const world = new NeonDuskWorld({ scene, quality: 'High', random: seeded() }).build();
        let drawables = 0;
        scene.traverse((obj) => {
            if (obj.isMesh || obj.isSprite) drawables += 1;
        });
        // sky, mountains, floor, dust, burst pixels, tiles
        expect(drawables).toBe(6);
        expect(world.reflection).toBeTruthy();
        world.dispose();
        expect(scene.children).toHaveLength(0);
    });

    it('opens a pass in the ranges where the sun sets, and stacks the ranges in depth', () => {
        const world = new NeonDuskWorld({ scene: new THREE.Scene(), random: seeded() }).build();
        const geo = world.parts.mountains.geometry;
        const pos = geo.attributes.position.array;
        const info = geo.attributes.aInfo.array;
        const passTop = [-Infinity, -Infinity, -Infinity];
        const crest = [[], [], []];
        for (let i = 0; i < geo.attributes.position.count; i += 1) {
            const dx = pos[i * 3] - RIG.x;
            const dz = pos[i * 3 + 2] - RIG.z;
            const dist = Math.hypot(dx, dz);
            const az = Math.atan2(dx, -dz);
            const elev = Math.atan2(pos[i * 3 + 1] - RIG.height, dist);
            const range = Math.round(info[i * 2]);
            if (Math.abs(az) < THREE.MathUtils.degToRad(1.5)) passTop[range] = Math.max(passTop[range], elev);
            if (Math.abs(az) > 0.6 && Math.abs(az) < 1.2) crest[range].push(elev);
        }
        // The sun's centre clears every range at the bottom of the pass.
        for (const top of passTop) expect(top).toBeLessThan(SUN.elevation);
        // Away from the pass each farther range rises higher in the view, so all three read.
        const p90 = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length * 0.9)];
        expect(p90(crest[0])).toBeGreaterThan(p90(crest[1]));
        expect(p90(crest[1])).toBeGreaterThan(p90(crest[2]));
        world.dispose();
    });

    it('ships one art-directed terrain: the same mountains whatever the session random', () => {
        const a = new NeonDuskWorld({ scene: new THREE.Scene(), random: seeded() }).build();
        const b = new NeonDuskWorld({ scene: new THREE.Scene(), random: Math.random }).build();
        const pa = a.parts.mountains.geometry.attributes.position.array;
        const pb = b.parts.mountains.geometry.attributes.position.array;
        expect(pa.length).toBe(pb.length);
        let maxDiff = 0;
        for (let i = 0; i < pa.length; i += 1) maxDiff = Math.max(maxDiff, Math.abs(pa[i] - pb[i]));
        expect(maxDiff).toBe(0);
        a.dispose();
        b.dispose();
    });

    it('lights the locked tetromino as four grid cells beside the board', () => {
        const world = new NeonDuskWorld({ scene: new THREE.Scene(), random: seeded() }).build();
        world.setLayout(16 / 9, SOLO_BOARD, { immediate: true });
        const camera = viewCamera(world);
        world.onPieceLock({ type: 'T', x: 1, rotation: 0 });
        const { iCell } = world.fx.tiles;
        const live = [];
        for (let i = 0; i < iCell.count; i += 1) {
            if (iCell.array[i * 4 + 2] > -1e5) live.push([iCell.array[i * 4], iCell.array[i * 4 + 1]]);
        }
        expect(live).toHaveLength(4);
        const S = GRID_SPACING;
        const scroll = world.u.scroll.value;
        const frac = (v) => ((v % 1) + 1) % 1;
        for (const [x, z] of live) {
            // Cell centres sit half a cell off the grid lines (x lines fixed, z lines scrolling).
            expect(Math.abs(frac(x / S) - 0.5)).toBeLessThan(1e-6);
            expect(Math.abs(frac((z - scroll) / S) - 0.5)).toBeLessThan(1e-6);
            const ndc = new THREE.Vector3(x, 0, z).project(camera);
            expect(ndc.x).toBeLessThan(SOLO_BOARD.x0 * 2 - 1);
            expect(Math.abs(ndc.y)).toBeLessThan(1);
        }
        // A T: three in a row and one more beside the middle.
        const rows = new Map();
        for (const [, z] of live) rows.set(z.toFixed(3), (rows.get(z.toFixed(3)) || 0) + 1);
        expect([...rows.values()].sort()).toEqual([1, 3]);
        world.dispose();
    });

    it('sends the combo pixels from the sun across the whole screen', () => {
        const world = new NeonDuskWorld({ scene: new THREE.Scene(), random: seeded() }).build();
        world.setLayout(16 / 9, SOLO_BOARD, { immediate: true });
        const camera = viewCamera(world);
        const sun = new THREE.Vector2();
        world.getSunScreen(camera, sun);

        world.onCombo(5);
        const { iSpawn, iVel, iMotion } = world.fx.burst;
        const p = new THREE.Vector3();
        const ends = [];
        for (let i = 0; i < iSpawn.count; i += 1) {
            if (iSpawn.array[i * 4 + 3] < 0) continue;
            p.fromArray(iSpawn.array, i * 4).project(camera);
            expect(Math.abs(p.x * 0.5 + 0.5 - sun.x)).toBeLessThan(0.12);
            p.fromArray(iSpawn.array, i * 4)
                .addScaledVector(new THREE.Vector3().fromArray(iVel.array, i * 4), 1 / iMotion.array[i * 4])
                .project(camera);
            ends.push([p.x, p.y]);
        }
        expect(ends.length).toBeGreaterThan(100);
        const cells = new Set();
        for (const [x, y] of ends) {
            if (Math.abs(x) > 1 || Math.abs(y) > 1) continue;
            cells.add(`${Math.min(3, Math.floor((x + 1) * 2))},${Math.min(2, Math.floor((y + 1) * 1.5))}`);
        }
        expect(cells.size).toBeGreaterThanOrEqual(11);
        world.dispose();
    });

    it('clears every live pixel and tile on the GPU too (one full-buffer upload range)', () => {
        const world = new NeonDuskWorld({ scene: new THREE.Scene(), random: seeded() }).build();
        world.onCombo(4);
        world.onPieceLock({ type: 'I', x: 7 });
        world.seek(0);
        world.onPieceLock({ type: 'O', x: 2 });
        const { iCell } = world.fx.tiles;
        expect(iCell.updateRanges.some((r) => r.start === 0 && r.count === iCell.array.length)).toBe(true);
        const { iSpawn } = world.fx.burst;
        expect(iSpawn.updateRanges.some((r) => r.start === 0 && r.count === iSpawn.array.length)).toBe(true);
        world.dispose();
    });
});
