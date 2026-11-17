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
    CANDLES,
    DUSK,
    EVENING,
    HOUR,
    LASER_SLOTS,
    PIECE_COLORS,
    PULSE,
    SKY_UNIFORMS,
    SynthwaveWorld,
    WHEEL_SHOW,
    WORLD_QUALITY,
    boardRectsDiffer,
    eveningHour,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-world.js';
import {
    SEA_STATES, SKY_KEYS, TEMPERAMENTS, TEMPERAMENT_CLOCK, WEATHERS, WEATHER_CLOCK, eveningLights, eveningLook,
    hourOfDusk, seaStateAt, skyColours, weatherAt,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-evening.js';
import { SHELL_KINDS } from '../../src/themes/synthwave-sunset/synthwave-sunset-fireworks.js';
import { BOAT_LANES, boatX } from '../../src/themes/synthwave-sunset/synthwave-sunset-life.js';
import { RIG, SHORE, SUN } from '../../src/themes/synthwave-sunset/synthwave-sunset-tsl.js';
import {
    PIER, PIER_HEAD, WHEEL, pierFrame, wheelWorldPosition,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-layout.js';
import { COASTER } from '../../src/themes/synthwave-sunset/synthwave-sunset-coaster.js';
import { shoreLineZ } from '../../src/themes/synthwave-sunset/synthwave-sunset-sea.js';
import {
    outwardness, box, lathe, makeOut, prism, roundedRectOutline, tube,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-geo.js';
import { HOTEL_WORDS, buildHotels, glyphCode } from '../../src/themes/synthwave-sunset/synthwave-sunset-hotels.js';
import { MIST, POST_LOOK, mistOpticalDepth } from '../../src/themes/synthwave-sunset/synthwave-sunset-post.js';
import {
    GULL_FLIGHTS, GULL_RIG, GULL_STARTLE, GullRoost, GullStartle, gullPosition, loopPosition, wingPose,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-gull-flight.js';
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
        onTwist: vi.fn(),
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
        expect(world.onPieceLock).toHaveBeenCalledWith({ type: 'T', x: 3, rotation: 0 }, { hardDrop: false, distance: 0 });
        expect(world.onLineClear).toHaveBeenCalledWith(2, {
            cascade: 1, combo: 1, twist: false, b2b: false,
        });
        expect(world.onCombo).toHaveBeenCalledWith(3);
        expect(world.onLevelUp).toHaveBeenCalledTimes(1);
        expect(world.onLevelUp).toHaveBeenLastCalledWith({ react: true });
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
        // The window's size comes through the viewport broadcaster, not a raw resize listener.
        expect(win.listenerCount('resize')).toBe(0);
        const resize = vi.spyOn(theme, 'resize').mockImplementation(() => {});
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 800, height: 600, dpr: 1 });
        expect(resize).toHaveBeenCalledTimes(1);
        resize.mockRestore();

        win.settings.backgroundComboEffects = false;
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        theme.flushEvents();
        expect(world.onLineClear).toHaveBeenCalledTimes(2);
        // A level is the world's light too: it still steps the evening, without its shells; a
        // second board's level does not.
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3, player: 2 });
        theme.flushEvents();
        expect(world.onLevelUp).toHaveBeenCalledTimes(2);
        expect(world.onLevelUp).toHaveBeenLastCalledWith({ react: false });

        win.settings.backgroundComboEffects = true;
        theme.stop();
        expect(world.dispose).toHaveBeenCalledTimes(1);
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        expect(world.onLineClear).toHaveBeenCalledTimes(2);
        expect(win.listenerCount('pointermove')).toBe(0);
        expect(win.listenerCount('resize')).toBe(0);
        const late = vi.spyOn(theme, 'resize').mockImplementation(() => {});
        eventBus.emit(EVENTS.VIEWPORT_RESIZED, { width: 640, height: 480, dpr: 1 });
        expect(late).not.toHaveBeenCalled();
    });

    it('counts the true combo whatever the setting; hands over hard drops, twists, B2B, perfect clears, waves', () => {
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
        eventBus.emit(EVENTS.HARD_DROP, { piece: { type: 'T', x: 3 }, distance: 12 });
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T', x: 3 } });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2, cascadeCount: 1 });
        eventBus.emit(EVENTS.TWIST, { lineCount: 2 });
        eventBus.emit(EVENTS.B2B, { active: true });
        theme.flushEvents();
        // A hard drop reaches the world with how far the piece fell.
        expect(world.onPieceLock).toHaveBeenLastCalledWith({ type: 'T', x: 3 }, { hardDrop: true, distance: 12 });
        expect(world.onLineClear).toHaveBeenLastCalledWith(2, {
            cascade: 1, combo: 4, twist: true, b2b: true,
        });
        expect(world.onChain).toHaveBeenLastCalledWith(4);
        expect(world.onTwist).not.toHaveBeenCalled();

        // Cascade waves arrive in their own ticks, each with its depth (COMBO announces it).
        eventBus.emit(EVENTS.COMBO, { comboCount: 2 });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 1 });
        theme.flushEvents();
        expect(world.onLineClear).toHaveBeenLastCalledWith(1, {
            cascade: 2, combo: 4, twist: false, b2b: false,
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

        // A twist that clears nothing still shows something.
        eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T', x: 4 } });
        eventBus.emit(EVENTS.TWIST, { lineCount: 0 });
        theme.flushEvents();
        expect(world.onTwist).toHaveBeenCalledTimes(1);
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

    it('builds the whole scene in a score of draws and disposes it', () => {
        const scene = new THREE.Scene();
        const world = new SynthwaveWorld({ scene, quality: 'High', random: seeded() }).build();
        const drawables = [];
        scene.traverse((obj) => {
            if (obj.isMesh || obj.isSprite) drawables.push(obj.name);
        });
        expect(drawables.sort()).toEqual([
            'SynthwaveBeams', 'SynthwaveBoats', 'SynthwaveCoasterBulbs', 'SynthwaveCoasterStructure', 'SynthwaveCoasterTrain',
            'SynthwaveFireworks', 'SynthwaveGulls', 'SynthwaveHotels', 'SynthwavePalms', 'SynthwavePierBulbs',
            'SynthwavePierStructure', 'SynthwavePromenadeLamps', 'SynthwavePromenadeStructure', 'SynthwaveSea', 'SynthwaveSkyDome',
            'SynthwaveWheelBulbs', 'SynthwaveWheelStructure',
        ]);
        // The people are drawn once their model has come (synthwave-sunset-strollers.test.js
        // attaches it): one more draw, 'SynthwaveStrollers'.
        expect(world.people.group.name).toBe('SynthwaveStrollers');
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
            type: 'J', x: 8, rotation: 0, color: '#D92B4A',
        });
        const right = world.u.chase1.value.y;
        // Both start near the bottom of the wheel (−π/2), the left column left of it.
        expect(left).toBeLessThan(-Math.PI / 2);
        expect(right).toBeGreaterThan(-Math.PI / 2);
        expect(Math.abs(left + Math.PI / 2)).toBeLessThan(0.8);
        expect(world.u.chaseCol1.value.getHex()).toBe(new THREE.Color('#D92B4A').getHex());
        expect(PIECE_COLORS.J.getHex()).toBe(new THREE.Color('#D92B4A').getHex());
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
        // Four lines: the finale volley and its gold crown, and the wheel's face bursts in gold.
        world.onLineClear(4);
        expect(world.fireworks.pending).toHaveLength(WORLD_QUALITY.High.finale + 1);
        expect(world.fireworks.pending.at(-1).kind).toBe('brocade');
        expect(world.u.wheelBurst.value.x).toBeCloseTo(world.time, 6);
        expect(world.u.wheelBurst.value.y).toBeGreaterThan(1);
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
        // The finale's crown is gold, and so is the sky it lights (it used to default to mint).
        world.onLineClear(4);
        expect(world.fireworks.pending.at(-1).kind).toBe('brocade');
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

    it('walks the evening by the clock alone, in the menus too: sunset, afterglow, night and back to the golden hour', () => {
        const { world } = builtWorld();
        const { seconds, hold } = EVENING;
        const at = (time) => {
            world.update({ time, delta: 0 });
            return {
                hour: world.hour,
                dusk: world.dusk,
                sunY: world.sunDir.y,
                power: world.u.pierPower.value,
                neon: world.u.wheelNeonMix.value,
                stars: world.u.skyLights.value.x,
                moon: world.u.skyLights.value.y,
                night: world.u.skyLights.value.w,
                gold: world.u.gold.value,
            };
        };
        // Mood 0 is the opening look: the sun on the sea, the ring pink, through the first rest
        // (no gameplay at all: the menus and Serenity walk the same evening).
        const opening = at(0);
        expect(opening.hour).toBe(HOUR.sunset);
        expect(opening.dusk).toBe(DUSK.rest);
        expect(opening.neon).toBe(0);
        expect(opening.moon).toBe(0);
        expect(at(seconds * hold * 0.9).hour).toBe(HOUR.sunset);
        // Toward the night first, back through the sunset to the golden hour, and round again.
        const walk = [HOUR.sunset, HOUR.afterglow, HOUR.night, HOUR.afterglow, HOUR.sunset, HOUR.gold, HOUR.sunset, HOUR.afterglow];
        walk.forEach((hour, k) => {
            const s = at(k * seconds);
            expect(s.hour, `stop ${k}`).toBeCloseTo(hour, 9);
            expect(s.neon, `ring at stop ${k}`).toBeCloseTo(k % 2, 9);
        });
        // The afterglow: the sun sunk, the pier's lights out to the wheel, the moon out.
        const afterglow = at(seconds);
        expect(afterglow.dusk).toBeCloseTo(1, 9);
        expect(afterglow.sunY).toBeLessThan(opening.sunY);
        expect(afterglow.power).toBeGreaterThan(opening.power);
        expect(afterglow.moon).toBeGreaterThan(0.3);
        expect(afterglow.night).toBeCloseTo(0, 9);
        // The night: the same sunk sun, the whole field of stars, a brighter moon.
        const night = at(2 * seconds);
        expect(night.night).toBeCloseTo(1, 9);
        expect(night.stars).toBeGreaterThan(afterglow.stars * 4);
        expect(night.moon).toBeGreaterThan(afterglow.moon);
        // The golden hour: the sun stands high in the wheel's hub, the pier's lights mostly off,
        // no star out.
        const gold = at(5 * seconds);
        expect(gold.gold).toBeCloseTo(1, 9);
        expect(gold.dusk).toBeCloseTo(0, 9);
        expect(gold.sunY).toBeGreaterThan(opening.sunY + 0.1);
        expect(gold.power).toBeLessThan(opening.power);
        expect(gold.stars).toBe(0);
        const hub = wheelWorldPosition();
        const toHub = Math.atan2(hub.y - RIG.height, Math.hypot(hub.x - RIG.x, hub.z - RIG.z));
        expect(Math.abs(Math.asin(gold.sunY) - toHub)).toBeLessThan(SUN.radius * 0.5);
        // It melts between stops, never jumps.
        let last = at(0).hour;
        for (let time = 0.5; time <= 6 * seconds; time += 0.5) {
            const h = at(time).hour;
            expect(Math.abs(h - last)).toBeLessThan(0.02);
            last = h;
        }
        // Halfway round, the ring burns blue-violet (the short way round the colour wheel), not
        // the pale grey-white of a straight mix of pink and mint.
        world.neonPhase = 0.5;
        world.neonTarget = 0.5;
        at(0);
        expect(world.u.wheelNeonMix.value).toBeCloseTo(0.5, 9);
        const ring = world.u.wheelNeon.value;
        expect(ring.b).toBeGreaterThan(Math.max(ring.r, ring.g) * 1.5);
        world.dispose();
    });

    it('steps the evening on a level, on top of the clock, turns the ring, and never pins it at either end', () => {
        const { world, camera } = builtWorld();
        const { seconds } = EVENING;
        const t1 = seconds * 0.15; // resting at the sunset, the ring pink
        world.update({ time: t1, delta: 0 });
        const before = world.hour;
        const sunY = world.sunDir.y;
        world.onLevelUp();
        expect(world.hourTarget).toBeCloseTo(EVENING.levelStep, 9);
        let t = run(world, camera, t1, 0.5);
        expect(world.hour).toBeGreaterThan(before); // eased in, not snapped
        expect(world.hour).toBeLessThan(before + EVENING.levelStep);
        t = run(world, camera, t, 15);
        expect(world.hour).toBeCloseTo(before + EVENING.levelStep, 3);
        expect(world.sunDir.y).toBeLessThan(sunY);
        expect(world.u.wheelNeonMix.value).toBeCloseTo(1, 3); // pink turned on to mint
        // A long run walks on past the night and back instead of stopping there, and the clock
        // still turns it.
        for (let i = 0; i < 20; i += 1) world.onLevelUp();
        t = run(world, camera, t, 20);
        const late = world.hour;
        expect(late).toBeCloseTo(eveningHour(21 * EVENING.levelStep, t), 3);
        expect(late).toBeGreaterThan(HOUR.gold);
        expect(late).toBeLessThan(HOUR.night);
        world.update({ time: t + seconds * 1.5, delta: 0 });
        expect(Math.abs(world.hour - late)).toBeGreaterThan(0.2);
        // A capture's seek puts the evening back on the clock's own walk.
        world.seek(5);
        expect(world.hour).toBe(HOUR.sunset);
        expect(world.hourTarget).toBe(0);
        // The playground's old measure still lands on the right hour.
        world.setDusk(1, { hold: true });
        expect(world.hour).toBeCloseTo(HOUR.afterglow, 9);
        world.update({ time: 400, delta: 0 });
        expect(world.hour).toBeCloseTo(HOUR.afterglow, 9);
        expect(hourOfDusk(DUSK.rest)).toBeCloseTo(HOUR.sunset, 9);
        world.dispose();
    });

    it('wears a different sunset, sky and sea by clocks of their own', () => {
        // Every temperament is a whole sky; the first is the opening look.
        const look = eveningLook(HOUR.sunset);
        const opening = skyColours(look, 0);
        const { world } = builtWorld();
        for (const key of SKY_KEYS) {
            const c = world.u[SKY_UNIFORMS[key]].value;
            expect([c.r, c.g, c.b], key).toEqual(opening[key]);
        }
        TEMPERAMENTS.forEach((temper) => {
            for (const key of SKY_KEYS) {
                for (const row of [temper.day, temper.dusk, temper.gold, temper.night]) {
                    expect(row[key], `${temper.name} ${key}`).toHaveLength(3);
                    row[key].forEach((v) => expect(Number.isFinite(v) && v >= 0).toBe(true));
                }
            }
        });
        // Whole phases are the temperaments themselves; between two the colours melt, never jump.
        const sunAt = (phase) => skyColours(look, phase).horizon1;
        const flamingo = sunAt(1);
        expect(flamingo[2]).toBeGreaterThan(opening.horizon1[2] * 1.5); // pinker than tangerine
        let last = sunAt(0);
        for (let phase = 0.02; phase <= TEMPERAMENTS.length; phase += 0.02) {
            const c = sunAt(phase);
            expect(Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2])).toBeLessThan(0.05);
            last = c;
        }
        // The night is darker overhead than the afterglow, the golden hour brighter than the sunset.
        const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        const zenith = (hour) => lum(skyColours(eveningLook(hour), 0).zenith);
        expect(zenith(HOUR.night)).toBeLessThan(zenith(HOUR.afterglow));
        expect(zenith(HOUR.afterglow)).toBeLessThan(zenith(HOUR.sunset));
        expect(zenith(HOUR.sunset)).toBeLessThan(zenith(HOUR.gold));
        // The lights: more of the pier lit and less daylight as the evening deepens.
        const lights = [HOUR.gold, HOUR.sunset, HOUR.afterglow, HOUR.night].map((h) => ({ ...eveningLights(eveningLook(h)) }));
        for (let i = 1; i < lights.length; i += 1) {
            expect(lights[i].power).toBeGreaterThanOrEqual(lights[i - 1].power);
            expect(lights[i].ambient).toBeLessThan(lights[i - 1].ambient);
            expect(lights[i].stars).toBeGreaterThan(lights[i - 1].stars);
        }

        // The weather: streaks first (the opening look), each weather whole on its stop.
        expect(weatherAt(0)).toEqual({ cirrus: WEATHERS[0].cirrus, mackerel: 0, towers: 0 });
        WEATHERS.forEach((w, k) => {
            world.update({ time: k * WEATHER_CLOCK.seconds, delta: 0 });
            const c = world.u.cloudCover.value;
            expect([c.x, c.y, c.z], w.name).toEqual([w.cirrus, w.mackerel, w.towers]);
        });
        // The sea: a light breeze first, then calmer and fresher by its own clock.
        expect(seaStateAt(0)).toBe(1);
        expect(new Set(SEA_STATES).size).toBe(SEA_STATES.length);
        world.update({ time: 0, delta: 0 });
        expect(world.u.seaState.value).toBe(1);
        // The three clocks and the hour's have different lengths, so the same evening does not
        // come round for a long while.
        const lengths = [EVENING.seconds, TEMPERAMENT_CLOCK.seconds, WEATHER_CLOCK.seconds];
        expect(new Set(lengths).size).toBe(3);
        // A held value stands whatever the clock (the playground's temper=, weather=, sea=).
        world.temperHeld = 2;
        world.weatherHeld = 3;
        world.seaHeld = 0.6;
        world.update({ time: 1234, delta: 0 });
        expect(world.temper).toBe(2);
        expect(world.u.cloudCover.value.z).toBe(1);
        expect(world.u.seaState.value).toBe(0.6);
        world.dispose();
    });

    it('flickers heat lightning in the towers only after dark, and holds it under Reduce flashing', () => {
        const { world, camera } = builtWorld();
        world.weatherHeld = 3;
        // By day the bank stands dark.
        world.setHour(HOUR.sunset, { hold: true });
        let t = 0;
        let peak = 0;
        for (let i = 0; i < 60 * 30; i += 1) {
            t = run(world, camera, t, 1 / 60);
            peak = Math.max(peak, world.u.bolt.value.z);
        }
        expect(peak).toBe(0);
        // After dark a flash comes within seconds, off the sun's own bearing, and goes out again.
        world.setHour(HOUR.night, { hold: true });
        let flashes = 0;
        let lit = false;
        for (let i = 0; i < 60 * 40; i += 1) {
            t = run(world, camera, t, 1 / 60);
            const b = world.u.bolt.value;
            peak = Math.max(peak, b.z);
            if (b.z > 0.05 && !lit) {
                flashes += 1;
                expect(Math.abs(b.x)).toBeGreaterThan(0.2);
            }
            lit = b.z > 0.05;
        }
        expect(peak).toBeGreaterThan(0.5);
        expect(flashes).toBeGreaterThan(2);
        world.dispose();
        vi.stubGlobal('window', { settings: { reduceFlashing: true } });
        const calm = builtWorld();
        calm.world.weatherHeld = 3;
        calm.world.setHour(HOUR.night, { hold: true });
        let calmPeak = 0;
        t = 0;
        for (let i = 0; i < 60 * 40; i += 1) {
            t = run(calm.world, calm.camera, t, 1 / 60);
            calmPeak = Math.max(calmPeak, calm.world.u.bolt.value.z);
        }
        expect(calmPeak).toBeGreaterThan(0);
        expect(calmPeak).toBeLessThan(peak * 0.5);
        calm.world.dispose();
    });

    it('still sends up its shells on a level-up, and steps the light without them when reactions are off', () => {
        const { world, camera } = builtWorld();
        run(world, camera, 0, 1);
        const before = world.fireworks.pending.length;
        world.onLevelUp();
        expect(world.fireworks.pending.length).toBe(before + 2);
        const quiet = builtWorld();
        const shells = quiet.world.fireworks.pending.length;
        quiet.world.onLevelUp({ react: false });
        expect(quiet.world.fireworks.pending.length).toBe(shells);
        run(quiet.world, quiet.camera, 0, 15);
        expect(quiet.world.hour).toBeCloseTo(HOUR.sunset + EVENING.levelStep, 3);
        world.dispose();
        quiet.world.dispose();
    });

    it('gives every event an instrument of its own', () => {
        const { world, camera } = builtWorld();
        const { u } = world;
        const fw = world.fireworks;
        const launch = vi.spyOn(fw, 'launch');
        const comet = vi.spyOn(fw, 'comet');
        const waterfall = vi.spyOn(fw, 'waterfall');
        const spray = vi.spyOn(fw, 'spray');
        const shells = () => launch.mock.calls.splice(0).map(([, o]) => o);
        let t = run(world, camera, 0, 1);

        // A lock is the wheel's alone: a band round its rims, nothing on the pier.
        world.onPieceLock({ type: 'T', x: 4 });
        expect(u.chase0.value.x).toBeCloseTo(world.time, 6);
        expect(u.pulse0.value.x).toBeLessThan(-1e5);
        // A hard drop is the pier's as well: a pulse of the piece's colour sets out along its
        // lights and is at the wheel within a second; a short fall sends a weaker one.
        t = run(world, camera, t, 0.5);
        world.onPieceLock({ type: 'Z', x: 4 }, { hardDrop: true, distance: PULSE.fullDrop });
        expect(u.pulse0.value.x).toBeCloseTo(world.time, 6);
        expect(u.pulse0.value.y).toBeCloseTo(PULSE.strength, 6);
        expect(u.pulseCol0.value.getHex()).toBe(PIECE_COLORS.Z.getHex());
        expect(1 / u.pulse0.value.z).toBeLessThan(1);
        world.onPieceLock({ type: 'O', x: 4 }, { hardDrop: true, distance: 1 });
        expect(u.pulse1.value.x).toBeCloseTo(world.time, 6);
        expect(u.pulse1.value.y).toBeLessThan(u.pulse0.value.y * 0.7);
        expect(launch).not.toHaveBeenCalled();

        // One line: one shell, its kind turning with each clear.
        const singles = [];
        for (let i = 0; i < 4; i += 1) {
            world.onLineClear(1);
            singles.push(...shells().map((o) => o.kind));
        }
        expect(singles).toHaveLength(4);
        expect(new Set(singles).size).toBe(4);
        // Two lines: a pair of one kind bursting together, side by side.
        world.onLineClear(2);
        const pair = shells();
        expect(pair).toHaveLength(2);
        expect(pair[0].kind).toBe(pair[1].kind);
        expect(pair[0].rise).toBe(pair[1].rise);
        expect(Math.abs(pair[0].x - pair[1].x)).toBeCloseTo(0.34, 6);
        // Three lines: a fan, two low and a gold palm above them.
        world.onLineClear(3);
        const fan = shells();
        expect(fan.map((o) => o.kind)).toEqual(['chrys', 'chrys', 'palm']);
        expect(fan[2].high).toBeGreaterThan(fan[0].high + 0.4);
        expect(fan[2].rise).toBeGreaterThan(fan[0].rise);
        expect(fan[0].x).toBeLessThan(fan[2].x);
        expect(fan[1].x).toBeGreaterThan(fan[2].x);

        // A twist: the wheel whirls and throws sparks off its rim (no shell for a bare twist).
        const whirl = world.spin.valueAt(world.time + 0.2);
        world.onTwist();
        expect(spray).toHaveBeenCalledTimes(1);
        expect(spray.mock.calls[0][1].radius).toBeGreaterThan(WHEEL.radius);
        expect(spray.mock.calls[0][1].center.distanceTo(wheelWorldPosition())).toBeLessThan(WHEEL.depth);
        expect(world.spin.valueAt(world.time + 0.2)).toBeGreaterThan(whirl);
        expect(launch).not.toHaveBeenCalled();
        // With lines the spray is fuller, and its shell is a lilac saturn.
        world.onLineClear(1, { twist: true });
        expect(spray).toHaveBeenCalledTimes(2);
        expect(spray.mock.calls[1][1].count).toBeGreaterThan(spray.mock.calls[0][1].count);
        expect(shells().map((o) => o.kind)).toEqual(['saturn']);

        // A back-to-back: the salute's rings and the laser fan from the hub, a beam more for each
        // in a row, held while they keep coming.
        expect(world.lasers.valueAt(world.time + 1)).toBe(0);
        world.onLineClear(2, { b2b: true });
        expect(shells().filter((o) => o.kind === 'ring' && o.high === 0.5)).toHaveLength(2);
        const firstFan = world.laserCount;
        world.onLineClear(2, { b2b: true });
        shells();
        expect(world.laserCount).toBe(firstFan + 1);
        expect(world.laserCount).toBeLessThanOrEqual(LASER_SLOTS);
        t = run(world, camera, t, 1);
        expect(world.lasers.valueAt(t)).toBeGreaterThan(0.6);
        expect(world.beams.lit).toBe(true);
        const colour = world.beams.iC.array;
        const litBeams = (from, to) => {
            let n = 0;
            for (let i = from; i < to; i += 1) if (colour[i * 4] + colour[i * 4 + 1] + colour[i * 4 + 2] > 0) n += 1;
            return n;
        };
        expect(litBeams(0, LASER_SLOTS)).toBe(world.laserCount);
        expect(litBeams(LASER_SLOTS, LASER_SLOTS + 4)).toBe(0);
        // Every laser leaves the hub and climbs above the horizon.
        for (let i = 0; i < world.laserCount; i += 1) {
            expect(world.beams.iB.array[i * 4 + 1]).toBeGreaterThan(0.2);
        }
        t = run(world, camera, t, 14);
        expect(world.beams.lit).toBe(false);
        expect(litBeams(0, LASER_SLOTS + 4)).toBe(0);

        // A cascade's later waves are the pier's: roman candles from its deck, more the deeper.
        world.onLineClear(1, { cascade: 2 });
        const shallow = comet.mock.calls.length;
        expect(shallow).toBeGreaterThanOrEqual(3);
        world.onLineClear(1, { cascade: 4 });
        expect(comet.mock.calls.length - shallow).toBeGreaterThan(shallow);
        const frame = pierFrame();
        for (const [, o] of comet.mock.calls) {
            const along = o.from.clone().sub(frame.far).dot(frame.along);
            const onStretch = (lane) => along >= lane[0] - 1e-6 && along <= lane[1] + 1e-6;
            expect(onStretch(CANDLES.far) || onStretch(CANDLES.near)).toBe(true);
            expect(o.from.y).toBeGreaterThan(PIER.deckY);
            expect(o.velocity.y).toBeGreaterThan(10);
        }
        expect(waterfall).not.toHaveBeenCalled();
        shells();

        // The perfect clear: the pier pours gold into the sea along its whole length, lit from
        // the land end out, under a curtain of gold willows; the wheel's face bursts in gold.
        comet.mockClear();
        world.onPerfectClear();
        expect(waterfall).toHaveBeenCalledTimes(2);
        const fall = waterfall.mock.calls[0][1];
        expect(fall.a.clone().sub(frame.far).dot(frame.along)).toBeGreaterThan(frame.length - 8);
        expect(fall.b.clone().sub(frame.far).dot(frame.along)).toBeCloseTo(PIER_HEAD.s1, 6);
        expect(fall.count).toBeGreaterThan(2000);
        expect(comet.mock.calls.length).toBe(12);
        expect(shells().every((o) => o.kind === 'willow')).toBe(true);
        expect(u.wheelBurst.value.x).toBeCloseTo(world.time, 6);
        expect(world.crown.valueAt(world.time + 0.5)).toBeGreaterThan(0.5);

        // A level: searchlights from the deck, a broad wave of gold along the pier's lights, the
        // wheel's face bursting in its new colour, a saturn and a ring.
        t = run(world, camera, t, 6);
        const pulsesBefore = [0, 1, 2, 3].map((i) => u[`pulse${i}`].value.x);
        world.onLevelUp();
        expect(shells().map((o) => o.kind)).toEqual(['saturn', 'ring']);
        const wave = [0, 1, 2, 3].map((i) => u[`pulse${i}`].value).find((v, i) => v.x !== pulsesBefore[i]);
        expect(wave.w).toBeGreaterThan(PULSE.width * 2);
        expect(wave.z).toBeLessThan(PULSE.speed);
        t = run(world, camera, t, 1.5);
        expect(world.search.valueAt(t)).toBeGreaterThan(0.6);
        expect(litBeams(LASER_SLOTS, LASER_SLOTS + 4)).toBe(4);
        expect(litBeams(0, LASER_SLOTS)).toBe(0);
        // The searchlights stand on the pier's deck and point up into the sky.
        for (let j = LASER_SLOTS; j < LASER_SLOTS + 4; j += 1) {
            expect(world.beams.iA.array[j * 4 + 1]).toBeGreaterThan(PIER.deckY);
            expect(world.beams.iB.array[j * 4 + 1]).toBeGreaterThan(0.8);
        }

        // Every shell the barge can fire bursts into live stars, none of them a broken number.
        fw.clear();
        for (const kind of SHELL_KINDS) {
            fw.burst({
                at: t, pos: new THREE.Vector3(-10, 80, -180), color: new THREE.Color(0xff5fa8), kind, scale: 1, stars: 120,
            });
        }
        let born = 0;
        for (let i = 0; i < fw.capacity; i += 1) {
            if (fw.iSpawn.array[i * 4 + 3] < t - 1) continue;
            born += 1;
            for (const attr of [fw.iSpawn, fw.iVel, fw.iLook, fw.iMotion]) {
                for (let k = 0; k < 4; k += 1) expect(Number.isFinite(attr.array[i * 4 + k])).toBe(true);
            }
            expect(fw.iVel.array[i * 4 + 3]).toBeGreaterThan(0);
        }
        expect(born).toBeGreaterThan(SHELL_KINDS.length * 60);
        // A seek leaves no event's light behind.
        world.seek(3);
        expect(world.lasers.valueAt(3.1)).toBe(0);
        expect(world.search.valueAt(3.1)).toBe(0);
        expect(u.wheelBurst.value.y).toBe(0);
        expect(u.pulse0.value.x).toBeLessThan(-1e5);
        world.dispose();
    });

    it('turns the wheel\'s light programmes by the clock, the classic first', () => {
        const { world } = builtWorld();
        const { seconds, programmes, hold } = WHEEL_SHOW;
        world.update({ time: 0, delta: 0 });
        expect(world.u.wheelShow.value.toArray()).toEqual([0, 1, 0, 0]);
        world.update({ time: seconds * hold * 0.9, delta: 0 });
        expect(world.u.wheelShow.value.z).toBe(0);
        const seen = new Set();
        for (let k = 0; k < programmes; k += 1) {
            world.update({ time: k * seconds, delta: 0 });
            const show = world.u.wheelShow.value;
            expect(show.z).toBeCloseTo(0, 9);
            seen.add(show.x);
        }
        expect(seen.size).toBe(programmes);
        world.update({ time: programmes * seconds, delta: 0 });
        expect(world.u.wheelShow.value.x).toBe(0);
        world.dispose();
    });

    it('keeps the boats clear of the pier', () => {
        const frame = pierFrame();
        // The boats: the dinghy sails between the beach and the pier and never reaches its piles;
        // the others pass beyond its far end. A quarter of an hour of courses.
        const pierX = (z) => frame.far.x + ((z - frame.far.z) / frame.along.z) * frame.along.x;
        BOAT_LANES.forEach((lane, i) => {
            let lo = Infinity;
            let hi = -Infinity;
            let step = 0;
            let last = boatX(i, 0);
            for (let time = 0; time <= 900; time += 1) {
                const x = boatX(i, time);
                lo = Math.min(lo, x);
                hi = Math.max(hi, x);
                step = Math.max(step, Math.abs(x - last));
                last = x;
            }
            expect(hi - lo).toBeCloseTo(lane.reach * 2, 0);
            // A sailing boat's pace: it never jumps.
            expect(step).toBeLessThan(6);
            if (lane.z > frame.far.z) expect(hi).toBeLessThan(pierX(lane.z) - lane.length);
            else expect(lane.z).toBeLessThan(frame.far.z - 40);
        });
        // Every tier keeps both.
        const { world } = builtWorld('Minimal');
        expect(world.parts.life.children.map((c) => c.name)).toEqual(['SynthwaveStrollers', 'SynthwaveBoats']);
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

    it('keeps its gulls wheeling in the open sky round the wheel, over the sea, one draw a tier', () => {
        const eye = new THREE.Vector3(RIG.x, RIG.height, RIG.z);
        const at = [0, 0, 0, 1];
        GULL_FLIGHTS.forEach((flight, i) => {
            let free = 0;
            let n = 0;
            for (let t = 0; t <= 600; t += 1.7) {
                gullPosition(i, t, at);
                const rel = new THREE.Vector3(at[0], at[1], at[2]).sub(eye);
                const flat = Math.hypot(rel.x, rel.z);
                const bearing = THREE.MathUtils.radToDeg(Math.atan2(rel.x, -rel.z));
                const elevation = THREE.MathUtils.radToDeg(Math.atan2(rel.y, flat));
                // Inside a wide game view, below its top edge, never over the beach.
                expect(bearing).toBeGreaterThan(-36);
                expect(bearing).toBeLessThan(42);
                expect(elevation).toBeGreaterThan(0.2);
                expect(elevation).toBeLessThan(37);
                expect(flat).toBeGreaterThan(25);
                expect(at[1]).toBeGreaterThan(2.5);
                expect(at[2]).toBeLessThan(shoreLineZ(at[0]));
                // The free sky left of a game's board (16:9): from the screen's edge to the board's.
                if (bearing > -14 && bearing < 20) free += 1;
                n += 1;
            }
            // All but the far bird's long glide stay mostly in it.
            if (flight.radius < 40) expect(free / n, `gull ${i}`).toBeGreaterThan(0.55);
        });
        for (const quality of ['Minimal', 'High', 'Extreme']) {
            const world = new SynthwaveWorld({ scene: new THREE.Scene(), quality, random: seeded() }).build();
            const { geometry } = world.gulls.mesh;
            expect(geometry.instanceCount).toBe(WORLD_QUALITY[quality].gulls);
            // WebGPU allows eight vertex buffers a draw: the flights share one.
            const buffers = new Set(Object.values(geometry.attributes).map((a) => a.data ?? a));
            expect(buffers.size).toBeLessThanOrEqual(8);
            world.dispose();
        }
    });

    it('flies each gull at a gull\'s pace, the mates beside their leaders', () => {
        const a = [0, 0, 0, 1];
        const b = [0, 0, 0, 1];
        GULL_FLIGHTS.forEach((_, i) => {
            for (let t = 3; t < 300; t += 11.3) {
                gullPosition(i, t - 0.05, a);
                gullPosition(i, t + 0.05, b);
                const speed = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.1;
                expect(speed, `gull ${i} at ${t}`).toBeGreaterThan(2.5);
                expect(speed, `gull ${i} at ${t}`).toBeLessThan(17);
            }
        });
        // 4 flies 1's loop and 7 flies 3's, near them all the time.
        for (const [mate, lead] of [[4, 1], [7, 3]]) {
            for (let t = 0; t < 300; t += 9.1) {
                gullPosition(mate, t, a);
                gullPosition(lead, t, b);
                expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(14);
            }
        }
    });

    it('startles the gulls with the fireworks: the bangs add up, the birds lift and scatter, then settle', () => {
        const one = new GullStartle();
        one.hit(0.5, 10);
        const two = new GullStartle();
        two.hit(0.5, 10);
        two.hit(0.5, 10.4);
        expect(two.value(11)).toBeGreaterThan(one.value(11));
        // A frenzy never runs far past the ceiling, and it is gone a while after.
        const many = new GullStartle();
        for (let k = 0; k < 30; k += 1) many.hit(0.6, 10 + k * 0.2);
        for (let t = 10; t < 20; t += 0.05) expect(many.value(t)).toBeLessThanOrEqual(GULL_STARTLE.ceiling * 1.25);
        expect(many.value(40)).toBeLessThan(0.02);
        // A startled bird is higher than the same bird at peace.
        const calm = [0, 0, 0, 1];
        const scared = [0, 0, 0, 1];
        gullPosition(0, 11, calm);
        gullPosition(0, 11, scared, { startle: one, now: 11 });
        expect(scared[1] - calm[1]).toBeGreaterThan(1.5);

        // In the world: a four-line clear's shells go up, burst, and the gulls take fright.
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 9000);
        const world = new SynthwaveWorld({ scene, quality: 'High', random: seeded() }).build();
        world.setLayout(16 / 9, null, { immediate: true });
        run(world, camera, 0, 0.5);
        expect(world.gulls.uStartle.value.x).toBe(0);
        world.onLineClear(4);
        run(world, camera, 0.5, 4);
        expect(world.gulls.startle.value(world.u.gullTime.value)).toBeGreaterThan(0.2);
        expect(world.gulls.uStartle.value.x).toBeGreaterThan(0);
        // A seek drops it.
        world.seek(30);
        world.update({ time: 30, delta: 0 });
        expect(world.gulls.startle.value(30)).toBe(0);
        world.dispose();
    });

    it('sends the gulls to roost as the evening runs out, in turn and the mates together, and brings them back', () => {
        const n = GULL_FLIGHTS.length;
        const roost = new GullRoost(n);
        const duskAt = (t) => eveningLook(eveningHour(0, t)).dusk;
        roost.seek(0, duskAt);
        const left = new Map();
        const at = [0, 0, 0, 1];
        let goneAll = false;
        for (let t = 0; t <= 560; t += 0.5) {
            roost.update(t, duskAt(t));
            for (let i = 0; i < n; i += 1) {
                if (roost.leaveAt[i] > roost.backAt[i] && !left.has(i)) left.set(i, roost.leaveAt[i]);
            }
            if (Math.abs(t - 250) < 0.25) {
                // By night every bird has gone (drawn at nothing).
                goneAll = GULL_FLIGHTS.every((_, i) => {
                    gullPosition(i, t, at, { leaveAt: roost.leaveAt[i], backAt: roost.backAt[i] });
                    return at[3] === 0;
                });
            }
        }
        expect(left.size).toBe(n);
        expect(goneAll).toBe(true);
        // In the order of their hours; the mates with their leaders.
        const order = [...left.entries()].sort((x, y) => x[1] - y[1]).map(([i]) => GULL_FLIGHTS[i].leaves);
        expect(order).toEqual([...order].sort((x, y) => x - y));
        expect(left.get(4)).toBe(left.get(1));
        expect(left.get(7)).toBe(left.get(3));
        // Back home (on their loops, full size) once the evening has walked back.
        GULL_FLIGHTS.forEach((_, i) => {
            expect(roost.backAt[i]).toBeGreaterThan(roost.leaveAt[i]);
            gullPosition(i, 560, at, { leaveAt: roost.leaveAt[i], backAt: roost.backAt[i] });
            const home = loopPosition(GULL_FLIGHTS[i], 560);
            expect(Math.hypot(at[0] - home[0], at[1] - home[1], at[2] - home[2])).toBeLessThan(1e-6);
            expect(at[3]).toBeGreaterThan(1);
        });
        // A seek rebuilds what the walk did: who is away, and since when.
        for (const t of [90, 105, 250, 440, 465]) {
            const walked = new GullRoost(n);
            walked.seek(0, duskAt);
            for (let s = 0.5; s <= t + 1e-6; s += 0.5) walked.update(s, duskAt(s));
            const seeked = new GullRoost(n);
            seeked.seek(t, duskAt);
            for (let i = 0; i < n; i += 1) {
                const away = (r) => r.leaveAt[i] > r.backAt[i];
                expect(away(seeked), `gull ${i} at ${t}`).toBe(away(walked));
                const since = (r) => (away(r) ? r.leaveAt[i] : r.backAt[i]);
                if (since(walked) > t - 100) expect(since(seeked), `gull ${i} at ${t}`).toBe(since(walked));
            }
        }
    });

    it('beats the gull\'s wings through the poses its model was built with', () => {
        const { poses } = GULL_RIG;
        const close = (pose, key) => Object.keys(pose).forEach((k) => expect(pose[k], `${key}.${k}`).toBeCloseTo(poses[key][k], 6));
        close(wingPose(0, 1), 'top');
        close(wingPose(Math.PI / 2, 1), 'down');
        close(wingPose(Math.PI, 1), 'bottom');
        close(wingPose(Math.PI * 1.5, 1), 'up');
        close(wingPose(1.234, 0), 'glide');
        // Round the cycle the wing never jumps.
        let last = wingPose(0, 1);
        for (let phi = 0.02; phi <= Math.PI * 2 + 1e-9; phi += 0.02) {
            const pose = wingPose(phi, 1);
            for (const k of Object.keys(pose)) expect(Math.abs(pose[k] - last[k])).toBeLessThan(0.05);
            last = pose;
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
