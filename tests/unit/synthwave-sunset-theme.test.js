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
    DUSK,
    PIECE_COLORS,
    SynthwaveWorld,
    WORLD_QUALITY,
    boardRectsDiffer,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-world.js';
import { RIG, SHORE, SUN } from '../../src/themes/synthwave-sunset/synthwave-sunset-tsl.js';
import { WHEEL, pierFrame, wheelWorldPosition } from '../../src/themes/synthwave-sunset/synthwave-sunset-layout.js';
import { COASTER } from '../../src/themes/synthwave-sunset/synthwave-sunset-coaster.js';
import { shoreLineZ } from '../../src/themes/synthwave-sunset/synthwave-sunset-sea.js';
import {
    outwardness, box, lathe, makeOut, prism, roundedRectOutline, tube,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-geo.js';
import { HOTEL_WORDS, buildHotels, glyphCode } from '../../src/themes/synthwave-sunset/synthwave-sunset-hotels.js';
import { MIST, POST_LOOK, mistOpticalDepth } from '../../src/themes/synthwave-sunset/synthwave-sunset-post.js';
import { GULL_LOOPS, gullPosition } from '../../src/themes/synthwave-sunset/synthwave-sunset-gulls.js';
import { REDUCED_FLASH_SCALE } from '../../src/utils/photosensitivity.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THEME_DIR = path.join(ROOT, 'src/themes/synthwave-sunset');

/** The 1080p solo card: 324 px wide, centred. */
const BOARD = {
    x0: (960 - 162) / 1920, y0: 0.21, x1: (960 + 162) / 1920, y1: 0.79,
};

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
        onChain: vi.fn(),
        onLevelUp: vi.fn(),
        onTSpin: vi.fn(),
        onPerfectClear: vi.fn(),
        dispose: vi.fn(),
    };
}

function seeded(seed = 1) {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

/** A built world with its camera at rest, laid out for the solo board. */
function builtWorld(quality = 'High') {
    const world = new SynthwaveWorld({ scene: new THREE.Scene(), quality, random: seeded() }).build();
    world.setLayout(16 / 9, BOARD, { immediate: true });
    const camera = new THREE.PerspectiveCamera(world.lens.vfov, world.lens.aspect, RIG.near, RIG.far);
    world.updateCamera(camera, { time: 0, delta: 0 });
    world.update({ time: 0, delta: 0 });
    return { world, camera };
}

/** Run the world forward `seconds` at 60 Hz from time `t0`. */
function run(world, camera, t0, seconds) {
    const steps = Math.round(seconds * 60);
    let t = t0;
    for (let i = 0; i < steps; i += 1) {
        t += 1 / 60;
        world.updateCamera(camera, { time: t, delta: 1 / 60 });
        world.update({ time: t, delta: 1 / 60 });
    }
    return t;
}

describe('synthwave-sunset theme wiring', () => {
    let win;
    beforeEach(() => {
        win = installBrowserStubs();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('stages the local board\'s events while backgroundComboEffects is on and hands them over once a frame, with the true combo', () => {
        const theme = new SynthwaveSunsetTheme();
        theme.isActive = true;
        const world = fakeWorld();
        theme.world = world;
        theme.setupEventListeners();

        // A lock and its clear arrive in one tick; nothing reaches the world before the flush.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T', x: 3, rotation: 0 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 3 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 2 });
        expect(world.onPieceLock).not.toHaveBeenCalled();
        theme.flushEvents();
        expect(world.onPieceLock).toHaveBeenCalledWith({ type: 'T', x: 3, rotation: 0 }, { hardDrop: false });
        expect(world.onLineClear).toHaveBeenCalledWith(2, {
            cascade: 1, combo: 1, tspin: false, b2b: false,
        });
        expect(world.onCombo).toHaveBeenCalledWith(3);
        expect(world.onLevelUp).toHaveBeenCalledTimes(1);
        expect(world.onChain).toHaveBeenLastCalledWith(1);

        // A second clearing lock extends the chain; a lock that clears nothing breaks it.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'I', x: 0, rotation: 0 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        theme.flushEvents();
        expect(world.onChain).toHaveBeenLastCalledWith(2);
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'O', x: 4, rotation: 0 } });
        theme.flushEvents();
        expect(world.onChain).toHaveBeenLastCalledWith(0);
        // A frame without events hands over nothing.
        const calls = world.onChain.mock.calls.length;
        theme.flushEvents();
        expect(world.onChain.mock.calls.length).toBe(calls);

        // A second board (a rival, a second player) does not drive the world.
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, player: 2 });
        theme.flushEvents();
        expect(world.onLineClear).toHaveBeenCalledTimes(2);

        expect(win.listenerCount('pointermove')).toBe(1);
        expect(win.listenerCount('resize')).toBe(1);

        win.settings.backgroundComboEffects = false;
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        theme.flushEvents();
        expect(world.onLineClear).toHaveBeenCalledTimes(2);

        win.settings.backgroundComboEffects = true;
        theme.stop();
        expect(world.dispose).toHaveBeenCalledTimes(1);
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(world.onLineClear).toHaveBeenCalledTimes(2);
        expect(win.listenerCount('pointermove')).toBe(0);
        expect(win.listenerCount('resize')).toBe(0);
    });

    it('counts the true combo whatever the setting; hands over hard drops, T-spins, B2B, perfect clears, waves', () => {
        const theme = new SynthwaveSunsetTheme();
        theme.isActive = true;
        const world = fakeWorld();
        theme.world = world;
        theme.setupEventListeners();

        // Reactions off: nothing reaches the world, but the chain is still counted.
        win.settings.backgroundComboEffects = false;
        for (let i = 0; i < 3; i += 1) {
            eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'I', x: 0 } });
            eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
            theme.flushEvents();
        }
        expect(world.onLineClear).not.toHaveBeenCalled();
        expect(theme.combo.combo).toBe(3);
        // Switched on mid-run, the next clearing lock is the chain's fourth.
        win.settings.backgroundComboEffects = true;
        eventBus.emit(EVENTS.HARD_DROP, { piece: { type: 'T', x: 3 } });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T', x: 3 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, cascadeCount: 1 });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 2 });
        eventBus.emit(EVENTS.B2B, { active: true });
        theme.flushEvents();
        expect(world.onPieceLock).toHaveBeenLastCalledWith({ type: 'T', x: 3 }, { hardDrop: true });
        expect(world.onLineClear).toHaveBeenLastCalledWith(2, {
            cascade: 1, combo: 4, tspin: true, b2b: true,
        });
        expect(world.onChain).toHaveBeenLastCalledWith(4);
        expect(world.onTSpin).not.toHaveBeenCalled();

        // Cascade waves arrive in their own ticks, each with its depth (COMBO announces it).
        eventBus.emit(EVENTS.COMBO, { comboCount: 2 });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        theme.flushEvents();
        expect(world.onLineClear).toHaveBeenLastCalledWith(1, {
            cascade: 2, combo: 4, tspin: false, b2b: false,
        });
        // Two waves landing in one frame (a stall) stay two clears, not one bigger one.
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, cascadeCount: 3 });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, cascadeCount: 4 });
        const before = world.onLineClear.mock.calls.length;
        theme.flushEvents();
        expect(world.onLineClear.mock.calls.slice(before).map(([lines, info]) => [lines, info.cascade]))
            .toEqual([[2, 3], [2, 4]]);

        // The perfect clear comes in its own tick: a crown, never a new clear.
        const clears = world.onLineClear.mock.calls.length;
        eventBus.emit(EVENTS.PERFECT_CLEAR, { depth: 4 });
        theme.flushEvents();
        expect(world.onPerfectClear).toHaveBeenCalledTimes(1);
        expect(world.onLineClear).toHaveBeenCalledTimes(clears);

        // A T-spin that clears nothing still shows something.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T', x: 4 } });
        eventBus.emit(EVENTS.TSPIN, { lineCount: 0 });
        theme.flushEvents();
        expect(world.onTSpin).toHaveBeenCalledTimes(1);
        expect(world.onChain).toHaveBeenLastCalledWith(0);
        theme.stop();
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
        // The outrun world is gone: no grid floor, no wireframe mountains, no box city.
        const retiredFiles = [
            'synthwave-shaders.js', 'synthwave-sunset-compute.js', 'synthwave-sunset-materials.js',
            'synthwave-sunset-floor.js', 'synthwave-sunset-skyline.js', 'synthwave-sunset-fx.js',
        ];
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
        const step = (seconds, frameMs) => {
            for (let t = 0; t < seconds * 1000; t += frameMs) theme.updateDynamicResolution(frameMs / 1000);
        };

        // A 30 FPS Target Frame Rate paces renders to ~33 ms: that is not overload.
        win.serenityBlocks = { settingsManager: { get: () => ({ targetFrameRate: 30 }) } };
        step(5, 33.4);
        expect(drs.scale).toBe(1);

        // Uncapped 60 Hz vsync: a real overload lowers the scale, the steady loop restores it.
        delete win.serenityBlocks;
        step(2, 45);
        expect(drs.scale).toBeLessThan(1);
        step(6, 16.7);
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
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('faces the sun with no board and puts it in the free zone left of a solo board', () => {
        const world = new SynthwaveWorld({ scene: new THREE.Scene(), random: seeded() });
        world.setLayout(16 / 9, null, { immediate: true });
        expect(world.sunScreenX(world.yaw)).toBeCloseTo(0.5, 3);

        world.setLayout(16 / 9, BOARD);
        expect(world.sunScreenX(world.targetYaw)).toBeCloseTo(BOARD.x0 / 2, 3);
        // Layout changes pan (eased), they never jump.
        expect(world.yaw).toBeCloseTo(0, 5);
        const camera = new THREE.PerspectiveCamera();
        world.updateCamera(camera, { time: 0, delta: 1 / 60 });
        expect(world.yaw).toBeGreaterThan(0);
        expect(world.yaw).toBeLessThan(world.targetYaw);
    });

    it('sets the sun into the sea behind the wheel\'s lower half, the pier running in from the right', () => {
        const world = new SynthwaveWorld({ scene: new THREE.Scene(), random: seeded() });
        const eye = new THREE.Vector3(RIG.x, RIG.height, RIG.z);
        const hub = wheelWorldPosition().sub(eye);
        const wheelRadius = Math.atan(WHEEL.radius / hub.length());
        const offHub = world.sunDir.angleTo(hub.clone().normalize());
        // The sun shows through the spokes: its disc reaches well inside the rim, below the hub.
        expect(offHub - SUN.radius).toBeLessThan(wheelRadius - 0.04);
        expect(offHub).toBeLessThan(wheelRadius + SUN.radius * 0.4);
        expect(world.sunDir.y).toBeLessThan(hub.clone().normalize().y);
        // At rest it stands on the sea, partly set.
        expect(world.sunDir.y).toBeGreaterThan(0);
        expect(world.sunDir.y).toBeLessThan(Math.sin(SUN.radius));
        // The pier: its far end under the wheel, its land end on the beach right of the eye.
        const frame = pierFrame();
        expect(frame.near.x).toBeGreaterThan(40);
        expect(frame.near.z).toBeGreaterThan(shoreLineZ(frame.near.x));
        expect(frame.far.z).toBeLessThan(shoreLineZ(frame.far.x) - 100);
    });

    it('builds the whole scene in a dozen draws and disposes it', () => {
        const scene = new THREE.Scene();
        const world = new SynthwaveWorld({ scene, quality: 'High', random: seeded() }).build();
        const drawables = [];
        scene.traverse((obj) => {
            if (obj.isMesh || obj.isSprite) drawables.push(obj.name);
        });
        expect(drawables.sort()).toEqual([
            'SynthwaveCoasterBulbs', 'SynthwaveCoasterStructure', 'SynthwaveCoasterTrain', 'SynthwaveFireworks',
            'SynthwaveGulls', 'SynthwaveHotels', 'SynthwavePalms', 'SynthwavePierBulbs', 'SynthwavePierStructure', 'SynthwavePromenadeLamps',
            'SynthwavePromenadeStructure', 'SynthwaveSea', 'SynthwaveSkyDome', 'SynthwaveWheelBulbs',
            'SynthwaveWheelStructure',
        ]);
        world.dispose();
        expect(scene.children).toHaveLength(0);
    });

    it('builds its solids with their normals pointing out', () => {
        const a = makeOut();
        box(a, new THREE.Vector3(3, 1, -2), new THREE.Vector3(2, 0.5, 1), [0, 0, 0, 0]);
        expect(outwardness(a)).toBeGreaterThan(0);
        const b = makeOut();
        tube(b, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 4, 0), new THREE.Vector3(1, 8, 0)], 0.5, 6, false, [0, 0, 0, 0]);
        // A tube's normals point away from its axis: every vertex sits radius out along its own.
        for (let i = 0; i < b.position.length / 3; i += 1) {
            const n = new THREE.Vector3().fromArray(b.normal, i * 3);
            expect(n.length()).toBeCloseTo(1, 5);
        }
        const c = makeOut();
        lathe(c, new THREE.Vector3(0, 0, 0), [[2, 0], [2.4, 1], [1.2, 2.5], [0.1, 3.2]], 16, () => [0, 0, 0, 0]);
        expect(outwardness(c)).toBeGreaterThan(0);
        // And the triangles wind counter-clockwise seen from outside, matching those normals.
        const p = (i) => new THREE.Vector3().fromArray(a.position, i * 3);
        const [i0, i1, i2] = a.index;
        const faceN = p(i1).sub(p(i0)).cross(p(i2).sub(p(i0))).normalize();
        expect(faceN.dot(new THREE.Vector3().fromArray(a.normal, i0 * 3))).toBeGreaterThan(0.99);
    });

    it('builds the hotels from prisms that face out, round ends without repeated points, and signs that spell their words', () => {
        // A prism on a plan with a quarter-round corner, in a turned basis: every triangle faces
        // the way its vertices' normals point.
        const out = makeOut();
        const along = new THREE.Vector3(0.6, 0, -0.8);
        const up = new THREE.Vector3(0, 1, 0);
        const B = { x: along, y: up, z: new THREE.Vector3().crossVectors(along, up) };
        prism(out, new THREE.Vector3(5, 0, -3), B, roundedRectOutline(20, 12, [5.4, 0.6, 0, 0.6], 8), 0, 18, () => [0, 0, 0, 0]);
        expect(outwardness(out)).toBeGreaterThan(0);
        const at = (i) => new THREE.Vector3().fromArray(out.position, i * 3);
        const nAt = (i) => new THREE.Vector3().fromArray(out.normal, i * 3);
        for (let t = 0; t < out.index.length; t += 3) {
            const [i0, i1, i2] = out.index.slice(t, t + 3);
            const face = at(i1).sub(at(i0)).cross(at(i2).sub(at(i0)));
            expect(face.dot(nAt(i0).add(nAt(i1)).add(nAt(i2)))).toBeGreaterThan(0);
        }
        const stadium = roundedRectOutline(24, 14, [7, 7, 7, 7], 10);
        stadium.forEach((q, i) => {
            const r = stadium[(i + 1) % stadium.length];
            expect(Math.hypot(q[0] - r[0], q[1] - r[1])).toBeGreaterThan(1e-3);
        });

        // The shader's decode (base-8 rows from the bottom, bit 4 = the left column) gives the
        // letter back, for every letter on every sign.
        const decode = (code, gx, gy) => Math.floor((Math.floor((code + 0.5) / 8 ** gy) % 8) / 2 ** (2 - gx)) % 2;
        const draw = (letter) => [4, 3, 2, 1, 0].map((gy) => [0, 1, 2].map((gx) => decode(glyphCode(letter), gx, gy)).join(''));
        expect(draw('H')).toEqual(['101', '101', '111', '101', '101']);
        expect(draw('S')).toEqual(['011', '100', '010', '001', '110']);
        HOTEL_WORDS.join('').split('').forEach((letter) => expect(() => glyphCode(letter)).not.toThrow());

        // The town: finite geometry, a beacon on every hotel, and all of it behind the seawall.
        const town = makeOut();
        const beacons = buildHotels(town, seeded(3));
        expect(beacons.length).toBeGreaterThanOrEqual(12);
        expect(town.position.every(Number.isFinite)).toBe(true);
        const shore = [];
        for (let x = 0; x <= 1000; x += 2) shore.push([x, shoreLineZ(x)]);
        let nearest = Infinity;
        for (let i = 0; i < town.position.length / 3; i += 5) {
            const x = town.position[i * 3];
            const z = town.position[i * 3 + 2];
            for (const [sx, sz] of shore) nearest = Math.min(nearest, Math.hypot(x - sx, z - sz));
        }
        expect(nearest).toBeGreaterThan(SHORE.promenade + 4);
    });

    it('runs a lock\'s chase round the wheel in the piece\'s colour from its column\'s side', () => {
        const { world } = builtWorld();
        world.update({ time: 8, delta: 0 });
        world.onPieceLock({ type: 'S', x: 0, rotation: 0 });
        const left = world.u.chase0.value.y;
        expect(world.u.chase0.value.x).toBeCloseTo(8, 6);
        expect(world.u.chaseCol0.value.getHex()).toBe(PIECE_COLORS.S.getHex());
        world.onPieceLock({
            type: 'J', x: 8, rotation: 0, color: '#4FB4FF',
        });
        const right = world.u.chase1.value.y;
        // Both start near the bottom of the wheel (−π/2), the left column left of it.
        expect(left).toBeLessThan(-Math.PI / 2);
        expect(right).toBeGreaterThan(-Math.PI / 2);
        expect(Math.abs(left + Math.PI / 2)).toBeLessThan(0.8);
        expect(world.u.chaseCol1.value.getHex()).toBe(new THREE.Color('#4FB4FF').getHex());
        world.dispose();
    });

    it('fires one shell per line from the barge and bursts them in the free sky left of the board', () => {
        const { world, camera } = builtWorld();
        world.onPieceLock({ type: 'T', x: 4, rotation: 0 });
        world.onLineClear(3);
        expect(world.fireworks.pending).toHaveLength(3);
        // The first shell takes the locking piece's colour.
        expect(world.fireworks.pending[0].color.getHex()).toBe(PIECE_COLORS.T.getHex());
        const bursts = world.fireworks.pending.map((b) => b.pos.clone());
        run(world, camera, 0, 3);
        expect(world.fireworks.pending).toHaveLength(0);
        for (const pos of bursts) {
            const ndc = pos.project(camera);
            const x = ndc.x * 0.5 + 0.5;
            const y = 0.5 - ndc.y * 0.5;
            // Left of the board, in the upper half of the frame, above the horizon.
            expect(x).toBeLessThan(BOARD.x0);
            expect(x).toBeGreaterThan(-0.05);
            expect(y).toBeGreaterThan(0.02);
            expect(y).toBeLessThan(0.5);
        }
        // Four lines: the finale volley and a gold willow.
        world.onLineClear(4);
        expect(world.fireworks.pending).toHaveLength(WORLD_QUALITY.High.finale + 1);
        expect(world.fireworks.pending.at(-1).kind).toBe('willow');
        world.dispose();
    });

    it('lifts the coaster a notch per link and rides the circuit when a chain of three breaks', () => {
        const { world, camera } = builtWorld();
        let t = 0;
        for (let link = 1; link <= 4; link += 1) {
            world.onChain(link);
            t = run(world, camera, t, 2.5);
        }
        expect(world.coaster.mode).toBe('lift');
        const { marks } = world.track;
        const notch4 = marks.liftFoot + (marks.liftTop - marks.liftFoot) * 0.5;
        expect(world.coaster.t).toBeCloseTo(notch4, 2);
        expect(world.u.coasterMeter.value).toBeCloseTo(world.coaster.t, 6);

        world.onChain(0);
        expect(world.coaster.mode).toBe('ride');
        // The tyre drive takes it over the crest, then the drop.
        t = run(world, camera, t, 4.5);
        expect(world.coaster.t).toBeGreaterThan(marks.liftTop);
        expect(world.u.coasterRide.value).toBeGreaterThan(0.3);
        t = run(world, camera, t, 25);
        expect(world.coaster.mode).toBe('idle');
        expect(world.coaster.t).toBeCloseTo(marks.station, 4);

        // A chain of two that breaks only rolls the train back to the station.
        world.onChain(1);
        world.onChain(2);
        t = run(world, camera, t, 2);
        world.onChain(0);
        expect(world.coaster.mode).toBe('idle');
        world.dispose();
    });

    it('builds the coaster as one closed circuit and a ride goes once round it into the station', () => {
        const { world, camera } = builtWorld();
        const { curve, marks } = world.track;
        const frame = pierFrame();
        expect(curve.closed).toBe(true);
        expect(curve.getPointAt(0).distanceTo(curve.getPointAt(1))).toBeLessThan(1e-3);
        // Both lines and both turns: the outbound and return lines, the far and near ends.
        const sc = (t) => {
            const rel = curve.getPointAt(t).sub(frame.far);
            return { s: rel.dot(frame.along), c: rel.dot(frame.across) };
        };
        const samples = Array.from({ length: 400 }, (_, i) => sc(i / 400));
        const cs = samples.map((q) => q.c);
        const ss = samples.map((q) => q.s);
        expect(Math.max(...cs)).toBeCloseTo(COASTER.across, 0);
        expect(Math.min(...cs)).toBeCloseTo(COASTER.returnAcross, 0);
        expect(Math.max(...ss)).toBeGreaterThan(COASTER.farTurn.s + 2);
        expect(Math.min(...ss)).toBeLessThan(COASTER.nearTurn.s - 2);
        // Gaps between neighbouring samples stay near the even step (arc length is approximate):
        // no break anywhere round the loop.
        const len = curve.getLength();
        for (let i = 0; i < 400; i += 1) {
            const a = curve.getPointAt(i / 400);
            const b = curve.getPointAt(((i + 1) % 400) / 400);
            expect(a.distanceTo(b)).toBeLessThan((len / 400) * 1.5);
        }
        expect(marks.station).toBeLessThan(marks.liftFoot);
        expect(marks.liftFoot).toBeLessThan(marks.liftTop);
        expect(marks.liftTop).toBeLessThan(marks.returnStart);

        // A ride: forward all the way, through the return line, and back into the station.
        world.onChain(3);
        let t = run(world, camera, 0, 4);
        world.onChain(0);
        let lap = 0;
        let last = world.coaster.t;
        let minC = Infinity;
        for (let i = 0; i < 60 * 40 && world.coaster.mode === 'ride'; i += 1) {
            t = run(world, camera, t, 1 / 60);
            if (world.coaster.t < last - 0.5) lap += 1;
            else expect(world.coaster.t).toBeGreaterThanOrEqual(last - 1e-9);
            last = world.coaster.t;
            minC = Math.min(minC, sc(world.coaster.t).c);
        }
        expect(world.coaster.mode).toBe('idle');
        expect(lap).toBe(1);
        expect(minC).toBeCloseTo(COASTER.returnAcross, 0);
        expect(world.coaster.t).toBeCloseTo(marks.station, 4);
        world.dispose();
    });

    it('never cuts light still burning: sky glows, wheel bands and the coaster meter build and drain', () => {
        const { world, camera } = builtWorld();
        const { u } = world;
        // A quad's finale, then a single hard on its heels: every burst adds to the sky's glow.
        world.onPieceLock({ type: 'I', x: 8 });
        world.onLineClear(4);
        let t = run(world, camera, 0, 0.5);
        world.onPieceLock({ type: 'O', x: 2 });
        world.onLineClear(1);
        let prev = u.burst0.value.w + u.burst1.value.w;
        let peak = prev;
        for (let i = 0; i < 60 * 4; i += 1) {
            t = run(world, camera, t, 1 / 60);
            const sum = u.burst0.value.w + u.burst1.value.w;
            // Between bursts the glow only fades at its own pace; a burst never knocks it down.
            expect(sum).toBeGreaterThanOrEqual(prev * Math.exp(-1.8 / 60) * 0.98 - 1e-6);
            prev = sum;
            peak = Math.max(peak, sum);
        }
        // The volley built a sky brighter than one burst.
        expect(peak).toBeGreaterThan(1.3);
        // The finale's willow is gold, and so is the sky it lights (it used to default to mint).
        world.onLineClear(4);
        expect(world.fireworks.pending.at(-1).kind).toBe('willow');
        expect(world.fireworks.pending.at(-1).color.getHex()).toBe(new THREE.Color(0xffb04c).getHex());

        // Rapid locks: no band round the wheel is cut off before it has begun to fade.
        t = run(world, camera, t, 3);
        const started = world.chases.map((ch) => ch.t0);
        let piled = 0;
        for (let i = 0; i < 12; i += 1) {
            world.onPieceLock({ type: 'T', x: i % 9 }, { hardDrop: i % 2 === 0 });
            piled = Math.max(piled, ...world.chases.map((ch) => ch.strength));
            world.chases.forEach((ch, k) => {
                if (ch.t0 !== started[k]) {
                    expect(world.time - started[k]).toBeGreaterThanOrEqual(1.15);
                    started[k] = ch.t0;
                }
            });
            t = run(world, camera, t, 0.15);
        }
        // ...the piled-up bands burn brighter instead.
        expect(piled).toBeGreaterThan(1.3);

        // The coaster: a chain that lets go drains its lemon down the lift instead of going dark.
        for (let link = 1; link <= 5; link += 1) {
            world.onChain(link);
            t = run(world, camera, t, 2);
        }
        const top = u.coasterMeter.value;
        world.onChain(0);
        t = run(world, camera, t, 1 / 60);
        expect(u.coasterCharge.value).toBeGreaterThan(0.9);
        expect(u.coasterMeter.value).toBeGreaterThan(top - 0.01);
        t = run(world, camera, t, 4);
        expect(u.coasterCharge.value).toBeLessThan(0.05);
        expect(world.coaster.mode).toBe('ride');
        // A chain built during the ride is not lost: it charges the lift, and the train climbs
        // it when it is back.
        world.onChain(1);
        world.onChain(2);
        t = run(world, camera, t, 3);
        expect(world.coaster.mode).toBe('ride');
        expect(u.coasterMeter.value).toBeGreaterThan(world.track.marks.liftFoot);
        expect(u.coasterCharge.value).toBeGreaterThan(0.9);
        for (let i = 0; i < 60 * 40 && world.coaster.mode === 'ride'; i += 1) t = run(world, camera, t, 1 / 60);
        expect(world.coaster.mode).toBe('lift');
        world.dispose();
    });

    it('builds with play: a long chain lights the bay hotter than its first clear, then breathes back', () => {
        const { world, camera } = builtWorld();
        const { u } = world;
        let t = run(world, camera, 0, 1);
        const rest = { power: u.pierPower.value - world.dusk * 0.85 };
        expect(world.exposure).toBe(1);
        const shellsFor = (fn) => {
            const before = world.fireworks.pending.length;
            fn();
            return world.fireworks.pending.length - before;
        };
        const clear = (link) => {
            world.onPieceLock({ type: 'O', x: link % 8 }, { hardDrop: true });
            return shellsFor(() => world.onLineClear(1, { combo: link }));
        };
        const firstShells = clear(1);
        world.onChain(1);
        t = run(world, camera, t, 0.64);
        const first = {
            power: u.pierPower.value,
            glow: u.wheelGlow.value,
            town: u.townLights.value,
            spin: world.bay.spin,
            chase: world.bay.chase,
        };
        let lastShells = 0;
        for (let link = 2; link <= 12; link += 1) {
            lastShells = clear(link);
            world.onChain(link);
            t = run(world, camera, t, 0.64);
        }
        // A cascade's deeper waves burst fuller than its first.
        const wave1 = shellsFor(() => world.onLineClear(2, { cascade: 1, combo: 12 }));
        const wave3 = shellsFor(() => world.onLineClear(2, { cascade: 3, combo: 12 }));
        expect(wave3).toBeGreaterThan(wave1);
        t = run(world, camera, t, 0.3);
        expect(world.heat.level).toBeGreaterThan(0.8);
        expect(world.heat.fever).toBeGreaterThan(0.3);
        expect(lastShells).toBeGreaterThan(firstShells);
        expect(u.pierPower.value).toBeGreaterThan(first.power);
        expect(u.wheelGlow.value).toBeGreaterThan(first.glow);
        expect(u.townLights.value).toBeGreaterThan(first.town);
        expect(world.bay.spin).toBeGreaterThan(first.spin + 1);
        expect(world.bay.chase).toBeGreaterThan(first.chase + 1);
        expect(world.exposure).toBeLessThan(1);
        // The perfect clear crowns it: gold willows across the sky, no second finale.
        const crown = shellsFor(() => world.onPerfectClear());
        expect(crown).toBeGreaterThanOrEqual(3);
        expect(world.fireworks.pending.slice(-crown).every((b) => b.kind === 'willow')).toBe(true);
        t = run(world, camera, t, 0.5);
        expect(world.bay.crown).toBeGreaterThan(0.5);

        // The hands rest: the bay breathes back to the evening (which has itself moved on a
        // little with the game: its lights are the evening's own again, nothing added).
        run(world, camera, t, 16);
        expect(world.heat.level).toBeLessThan(0.05);
        expect(world.bay.spin).toBeLessThan(0.05);
        expect(world.bay.power + world.bay.glow + world.bay.town).toBeLessThan(0.03);
        expect(u.wheelGlow.value).toBeCloseTo(0.85 + world.dusk * 0.5, 2);
        expect(u.pierPower.value).toBeLessThan(rest.power + world.dusk * 0.85 + 0.02);
        expect(u.townLights.value).toBeCloseTo(0.5 + world.dusk * 0.5, 1);
        expect(world.exposure).toBeGreaterThan(0.99);
        world.dispose();
    });

    it('deepens the evening while a game is played, steps it on a level, and holds it in the menus', () => {
        const { world, camera } = builtWorld();
        let t = run(world, camera, 0, 60);
        expect(world.dusk).toBeCloseTo(DUSK.rest, 5);
        world.onPieceLock({ type: 'O', x: 4, rotation: 0 });
        t = run(world, camera, t, 20);
        expect(world.dusk).toBeGreaterThan(DUSK.rest + 0.02);
        const before = world.duskTarget;
        world.onLevelUp();
        expect(world.duskTarget).toBeCloseTo(before + DUSK.levelStep, 6);
        // The sun sinks and the pier's lights spread with it.
        const sunY = world.sunDir.y;
        const power = world.u.pierPower.value;
        run(world, camera, t, 10);
        expect(world.sunDir.y).toBeLessThan(sunY);
        expect(world.u.pierPower.value).toBeGreaterThan(power);
        // A capture's seek puts the evening back where it was set.
        world.seek(5);
        expect(world.dusk).toBeCloseTo(DUSK.rest, 6);
        world.dispose();
    });

    it('holds the fireworks\' sky glow under Reduce flashing and fades the stars in', () => {
        vi.stubGlobal('window', { settings: { reduceFlashing: true } });
        const { world, camera } = builtWorld();
        world.onLineClear(1);
        const { at } = world.fireworks.pending[0];
        run(world, camera, 0, at + 0.12);
        expect(world.u.fireworkCalm.value).toBe(1);
        expect(world.u.burst0.value.w + world.u.burst1.value.w).toBeLessThanOrEqual(REDUCED_FLASH_SCALE * 1.2);
        vi.stubGlobal('window', { settings: { reduceFlashing: false } });
        world.onLineClear(1);
        const at2 = world.fireworks.pending[0].at;
        run(world, camera, at + 0.12, at2 - at + 0.05);
        expect(world.u.fireworkCalm.value).toBe(0);
        expect(Math.max(world.u.burst0.value.w, world.u.burst1.value.w)).toBeGreaterThan(0.5);
        world.dispose();
    });

    it('keeps its gulls wheeling in the free sky beside the board, low over the sea, one draw a tier', () => {
        const eye = new THREE.Vector3(RIG.x, RIG.height, RIG.z);
        const at = new THREE.Vector3();
        GULL_LOOPS.forEach((_, i) => {
            for (let t = 0; t <= 600; t += 7.3) {
                gullPosition(i, t, at);
                const rel = at.clone().sub(eye);
                const flat = Math.hypot(rel.x, rel.z);
                const bearing = THREE.MathUtils.radToDeg(Math.atan2(rel.x, -rel.z));
                const elevation = THREE.MathUtils.radToDeg(Math.atan2(rel.y, flat));
                // Between the left edge of a game's view and the board's left edge.
                expect(bearing).toBeGreaterThan(-24);
                expect(bearing).toBeLessThan(32);
                expect(elevation).toBeGreaterThan(1.5);
                expect(elevation).toBeLessThan(18);
                expect(flat).toBeGreaterThan(20);
                expect(at.z).toBeLessThan(shoreLineZ(at.x));
            }
        });
        for (const quality of ['Minimal', 'High', 'Extreme']) {
            const world = new SynthwaveWorld({ scene: new THREE.Scene(), quality, random: seeded() }).build();
            expect(world.parts.gulls.geometry.instanceCount).toBe(WORLD_QUALITY[quality].gulls);
            world.dispose();
        }
    });

    it('lays the sea mist on the far scene and the sun\'s lower limb, not on the near sand', () => {
        // The output pass's closed form: optical depth along a ray from the eye.
        const tau = (dirY, t) => mistOpticalDepth(RIG.height, dirY, t);
        const sand = tau(-RIG.height / 10, 10);
        const pierFoot = tau(0.005, 165);
        const wheelCrown = tau((WHEEL.hubY + WHEEL.radius - RIG.height) / 165, 165);
        expect(sand).toBeLessThan(0.03);
        expect(pierFoot).toBeGreaterThan(0.1);
        expect(pierFoot).toBeLessThan(0.6);
        expect(wheelCrown).toBeLessThan(pierFoot / 3);
        // The horizon itself is mist; the sun's centre keeps most of its light.
        expect(tau(0.0, MIST.reach) * MIST.overSky).toBeGreaterThan(1);
        expect(tau(Math.sin(SUN.radius * SUN.lift), MIST.reach) * MIST.overSky).toBeLessThan(0.35);
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
