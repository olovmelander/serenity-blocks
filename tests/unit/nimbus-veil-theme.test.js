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
import { NimbusWorld, RING_SLOTS, WORLD_QUALITY } from '../../src/themes/nimbus-veil/nimbus-veil-world.js';
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
            onPieceLock: vi.fn(),
            onHardDrop: vi.fn(),
            onLineClear: vi.fn(),
            onCombo: vi.fn(),
            onTSpin: vi.fn(),
            onB2B: vi.fn(),
            onPerfectClear: vi.fn(),
            onLevelUp: vi.fn(),
            dispose: vi.fn(),
        };
        theme.world = world;
        theme.setupEventListeners();

        eventBus.emit(EVENTS.HARD_DROP, { piece: { type: 'T' } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T' } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 3, cascadeCount: 1 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 4 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 0 });
        eventBus.emit(EVENTS.B2B, { active: true });
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 4 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        expect(world.onHardDrop).toHaveBeenCalledTimes(1);
        expect(world.onPieceLock).toHaveBeenCalledWith({ chain: 0 });
        expect(world.onLineClear).toHaveBeenCalledWith(3, { cascade: 1, combo: 1, chainStep: true });
        expect(world.onCombo).toHaveBeenCalledWith(4);
        expect(world.onTSpin).toHaveBeenCalledWith(0);
        expect(world.onB2B).toHaveBeenCalledTimes(1);
        expect(world.onPerfectClear).toHaveBeenCalledTimes(1);
        expect(world.onLevelUp).toHaveBeenCalledTimes(1);

        // The true combo comes from the lock sequence (ComboTracker), not from COMBO's depth: a
        // second clearing lock is combo 2, and the lock after it carries the chain in.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'I' } });
        expect(world.onPieceLock).toHaveBeenLastCalledWith({ chain: 1 });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, cascadeCount: 1 });
        expect(world.onLineClear).toHaveBeenLastCalledWith(1, { cascade: 1, combo: 2, chainStep: true });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1, cascadeCount: 2 });
        expect(world.onLineClear).toHaveBeenLastCalledWith(1, { cascade: 2, combo: 2, chainStep: false });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'O' } });
        expect(world.onPieceLock).toHaveBeenLastCalledWith({ chain: 2 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'S' } });
        expect(world.onPieceLock).toHaveBeenLastCalledWith({ chain: 0 });

        // A paused (parked) theme's clock stands still: nothing is queued onto it.
        theme.isPaused = true;
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
        expect(world.onLineClear).toHaveBeenCalledTimes(3);
        theme.isPaused = false;

        win.settings.backgroundComboEffects = false;
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(world.onLineClear).toHaveBeenCalledTimes(3);

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

describe('nimbus-veil build-up (shared/gameplay-surge.js)', () => {
    const DT = 1 / 60;
    const build = () => {
        const world = new NimbusWorld({ scene: new THREE.Scene(), random: seeded() }).build();
        world.setLayout(16 / 9, null, { immediate: true });
        const camera = new THREE.PerspectiveCamera(world.lens.vfov, world.lens.aspect, 0.5, 9000);
        const clock = { t: 0 };
        const frame = () => {
            clock.t += DT;
            world.updateCamera(camera, { time: clock.t, delta: DT });
            world.update({ time: clock.t, delta: DT });
        };
        const run = (seconds) => {
            for (let i = Math.round(seconds / DT); i > 0; i -= 1) frame();
        };
        frame();
        return {
            world, camera, clock, run,
        };
    };
    /** What the world shows: the frame-wide glow, the local blaze and every live band. */
    const light = (world) => {
        const { u } = world;
        return {
            sunPulse: u.sunPulse.value,
            seaGlow: u.seaGlow.value,
            beams: u.blaze.value.x,
            rims: u.blaze.value.y,
            glare: u.blaze.value.z,
            crowns: u.blaze.value.w,
            bands: u.rings.map((r) => ({ radius: r.value.x, energy: r.value.z })).filter((r) => r.energy > 1e-3),
        };
    };

    it('lets a weak event after a strong one only add light, and keeps every band rolling', () => {
        const a = build();
        const b = build();
        for (const { world } of [a, b]) {
            world.onPieceLock({ chain: 0 });
            world.onLineClear(4, { cascade: 1, combo: 1, chainStep: true });
            world.onB2B();
        }
        a.run(0.4);
        b.run(0.4);
        // b: a single, then the two waves of its cascade, right behind the quad.
        b.world.onPieceLock({ chain: 1 });
        b.world.onLineClear(1, { cascade: 1, combo: 2, chainStep: true });
        b.run(0.05);
        b.world.onCombo(2);
        b.world.onLineClear(1, { cascade: 2, combo: 2 });
        b.run(0.05);
        b.world.onCombo(3);
        b.world.onLineClear(1, { cascade: 3, combo: 2 });
        a.run(0.1);
        for (let i = 0; i < 150; i += 1) {
            a.run(DT);
            b.run(DT);
            const la = light(a.world);
            const lb = light(b.world);
            for (const key of ['sunPulse', 'seaGlow', 'beams', 'rims', 'glare', 'crowns']) {
                expect(lb[key], `${key} at frame ${i}`).toBeGreaterThanOrEqual(la[key] - 1e-9);
            }
            // The quad's wave and the back-to-back's tide line are still where they were.
            for (const band of la.bands) {
                const kept = lb.bands.some((o) => Math.abs(o.radius - band.radius) < 1e-6
                    && Math.abs(o.energy - band.energy) < 1e-6);
                expect(kept, `band at ${band.radius.toFixed(0)} at frame ${i}`).toBe(true);
            }
        }
        a.world.dispose();
        b.world.dispose();
    });

    it('shows every wave of a six-wave cascade at once, each deeper wave hotter than the last', () => {
        const { world, run } = build();
        world.onPieceLock({ chain: 0 });
        world.onLineClear(2, { cascade: 1, combo: 1, chainStep: true });
        for (let w = 2; w <= 6; w += 1) {
            run(0.36);
            world.onCombo(w);
            world.onLineClear(1, { cascade: w, combo: 1 });
        }
        run(DT);
        const bands = world.u.rings.filter((r) => r.value.z > 1e-3);
        expect(bands).toHaveLength(Math.min(6, RING_SLOTS));
        // Deeper, brighter, faster, hotter: each one-line wave past the first outdoes the last.
        const waves = world.rings.slice().sort((p, q) => p.t0 - q.t0);
        for (let i = 2; i < waves.length; i += 1) {
            expect(waves[i].energy).toBeGreaterThan(waves[i - 1].energy);
            expect(waves[i].dur).toBeLessThan(waves[i - 1].dur);
            expect(waves[i].heat).toBeGreaterThanOrEqual(waves[i - 1].heat);
        }
        expect(waves[waves.length - 1].heat).toBeGreaterThan(waves[0].heat + 0.6);
        world.dispose();
    });

    it('reads hotter deep into a long chain than after its first clear, then breathes back', () => {
        const { world, camera, run } = build();
        const restY = camera.position.y;
        const scroll = () => {
            const before = world.u.seaScroll.value;
            run(DT);
            return world.u.seaScroll.value - before;
        };
        const calmPace = scroll();
        const chainClear = (n, lines) => {
            world.onHardDrop();
            world.onPieceLock({ chain: n - 1 });
            world.onLineClear(lines, { cascade: 1, combo: n, chainStep: true });
        };
        chainClear(1, 1);
        run(0.6);
        const first = { ...light(world), exposure: world.postState().exposure, pace: scroll() };
        const plan = [1, 2, 1, 2, 2, 3, 2, 2, 3, 3, 4];
        plan.forEach((lines, i) => {
            run(0.64);
            chainClear(i + 2, lines);
        });
        run(0.6);
        const late = { ...light(world), exposure: world.postState().exposure, pace: scroll() };
        expect(world.heat.stage).toBeGreaterThanOrEqual(2);
        expect(late.beams).toBeGreaterThan(first.beams + 0.5);
        expect(late.rims).toBeGreaterThan(first.rims + 0.4);
        expect(late.glare).toBeGreaterThan(first.glare + 0.5);
        expect(late.pace).toBeGreaterThan(first.pace * 1.5);
        expect(late.exposure).toBeLessThan(first.exposure);
        // The payoff is local: the frame-wide glow stays low however hot play runs.
        expect(late.sunPulse).toBeLessThanOrEqual(0.45);
        expect(late.seaGlow).toBeLessThanOrEqual(0.6);
        expect(camera.position.y).toBeLessThan(restY - 0.5);

        // A perfect clear crowns it: every tower crown lights, and it is not a new clear.
        const bandsBefore = light(world).bands.length;
        world.onPerfectClear();
        run(0.5);
        expect(light(world).crowns).toBeGreaterThan(0.5);
        expect(light(world).bands.length).toBeLessThanOrEqual(Math.min(RING_SLOTS, bandsBefore + 1));

        // Hands at rest: the world breathes back to calm.
        run(12);
        const rest = light(world);
        expect(world.heat.stage).toBe(0);
        expect(rest.beams).toBeLessThan(0.02);
        expect(rest.rims).toBeLessThan(0.02);
        expect(rest.glare).toBeLessThan(0.02);
        expect(rest.crowns).toBeLessThan(0.02);
        expect(rest.sunPulse).toBeLessThan(0.01);
        expect(rest.bands).toHaveLength(0);
        expect(world.postState().exposure).toBeCloseTo(1, 2);
        expect(scroll()).toBeLessThan(calmPace * 1.06);
        world.dispose();
    });

    it('gives a new glint a finished sparkle slot, or the one nearest its end, never a long-lived one', () => {
        const world = new NimbusWorld({ scene: new THREE.Scene(), quality: 'Minimal', random: seeded() }).build();
        const { fx } = world;
        const n = fx.sparkleCapacity;
        const color = new THREE.Color(1, 1, 1);
        const half = Math.floor(n / 2);
        for (let i = 0; i < n; i += 1) fx.spawnSparkle(0, 0, 0, 0, 0, 0, 0, i < half ? 6 : 1, color, 4);
        for (let i = 0; i < 10; i += 1) fx.spawnSparkle(0.5, 0, 0, 0, 0, 0, 0, 2, color, 4);
        const ends = Array.from(fx.sparkEnd);
        expect(ends.filter((e) => e === 6)).toHaveLength(half);
        expect(ends.filter((e) => e === 2.5)).toHaveLength(10);
        world.dispose();
    });
});
