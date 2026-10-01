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

import NimbusVeilTheme from '../../src/themes/nimbus-veil/nimbus-veil-theme.js';
import { NimbusWorld, WORLD_QUALITY } from '../../src/themes/nimbus-veil/nimbus-veil-world.js';
import { POST_LOOK } from '../../src/themes/nimbus-veil/nimbus-veil-post.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THEME_DIR = path.join(ROOT, 'src/themes/nimbus-veil');

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
        settings: {},
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

describe('nimbus-veil theme wiring', () => {
    let win;
    beforeEach(() => {
        win = installBrowserStubs();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reacts to gameplay unless background effects are switched off, and stop() unsubscribes', () => {
        const theme = new NimbusVeilTheme();
        theme.isActive = true;
        const world = {
            onPieceLock: vi.fn(), onLineClear: vi.fn(), onCombo: vi.fn(), onLevelUp: vi.fn(), dispose: vi.fn(),
        };
        theme.world = world;
        theme.setupEventListeners();

        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T' } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 3 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 4 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        expect(world.onPieceLock).toHaveBeenCalledTimes(1);
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
        const theme = new NimbusVeilTheme();
        expect(() => theme.stop()).not.toThrow();
        expect(() => theme.stop()).not.toThrow();
    });

    it('is one node-material path: no classic materials, composer, WebGLRenderer or MaterialX noise', () => {
        for (const name of readdirSync(THEME_DIR).filter((f) => f.endsWith('.js'))) {
            const src = readFileSync(path.join(THEME_DIR, name), 'utf8');
            expect(src, name).not.toMatch(/new\s+[\w$.]*ShaderMaterial\s*\(/);
            expect(src, name).not.toMatch(/new\s+[\w$.]*WebGLRenderer\s*\(/);
            expect(src, name).not.toMatch(/EffectComposer|UnrealBloomPass/);
            expect(src, name).not.toMatch(/from 'three';/);
            expect(src, name).not.toMatch(/\bmx_(?:noise|fractal)\w*\s*\(|import\s*\{[^}]*\bmx_/);
        }
        expect(existsSync(path.join(THEME_DIR, 'nimbus-veil-shaders.js'))).toBe(false);
    });

    it('has a post look and a world tier for every quality level', () => {
        for (const quality of ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']) {
            expect(WORLD_QUALITY[quality], quality).toBeTruthy();
            expect(POST_LOOK[quality], quality).toBeTruthy();
        }
    });
});

describe('nimbus-veil world', () => {
    it('faces the sun with no board and puts it in the free zone left of a solo board', () => {
        const world = new NimbusWorld({ scene: new THREE.Scene(), random: seeded() });
        world.setLayout(16 / 9, null, { immediate: true });
        expect(world.sunScreenX(world.yaw)).toBeCloseTo(0.5, 3);
        const board = {
            x0: (960 - 162) / 1920, y0: 0.21, x1: (960 + 162) / 1920, y1: 0.79,
        };
        world.setLayout(16 / 9, board);
        expect(world.sunScreenX(world.targetYaw)).toBeCloseTo(board.x0 / 2, 3);
    });

    it('builds the cloudscape in a handful of draws and disposes it', () => {
        const scene = new THREE.Scene();
        const world = new NimbusWorld({ scene, quality: 'High', random: seeded() }).build();
        let drawables = 0;
        scene.traverse((obj) => {
            if (obj.isMesh || obj.isSprite) drawables += 1;
        });
        // sky, cloud sea, cumulus, two veils, motes, sparkles
        expect(drawables).toBe(7);
        world.dispose();
        expect(scene.children).toHaveLength(0);
    });

    it('sends the combo glints from the sun across the whole screen', () => {
        const world = new NimbusWorld({ scene: new THREE.Scene(), random: seeded() }).build();
        world.setLayout(16 / 9, {
            x0: (960 - 162) / 1920, y0: 0.21, x1: (960 + 162) / 1920, y1: 0.79,
        }, { immediate: true });
        world.update({ time: 9, delta: 0 });
        const camera = new THREE.PerspectiveCamera(world.lens.vfov, world.lens.aspect, 0.5, 9000);
        world.updateCamera(camera, { time: 0, delta: 0 });
        camera.updateProjectionMatrix();
        const sun = new THREE.Vector2();
        world.getSunScreen(camera, sun);

        world.onCombo(5);
        const { iSpawn, iVel, iMotion } = world.fx.sparkles;
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
});
