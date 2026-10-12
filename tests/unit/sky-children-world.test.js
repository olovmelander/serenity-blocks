/**
 * Sky Children — the world on the CPU: a real SkyChildrenWorld in a THREE.Scene, no renderer.
 *
 * These pin what a lock, a clear, a chain, four lines, a perfect clear, a T-spin and a new level DO
 * to the world, in what order and how often, and that every frame is a function of the clock and
 * the events (a seek and a replay at any frame rate land in the same place) — never a tuning
 * number: constants are imported, and the assertions are relations (counted, ordered, bounded,
 * monotonic). The build budgets are FINAL §6.3's.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    DIAL_MAX, HEAD_FADE, JOIN_ARC, REST_RIG, SKY_CHILDREN_PARTS, STROKES, STROKE_END, SkyChildrenWorld, fovForAspect, sprayFill,
} from '../../src/themes/sky-children/sky-children-world.js';
import { cellsFromMatrix, fallPoint, pieceLight } from '../../src/themes/sky-children/sky-children-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/sky-children/sky-children-quality.js';
import { fallbackLayout } from '../../src/themes/sky-children/sky-children-composition.js';
import {
    bowPoint, clearOfCalm, frameFor, nominalLayout, project,
} from '../../src/themes/sky-children/sky-children-frame.js';
import { HOUR_SECONDS, turnSeconds } from '../../src/themes/sky-children/sky-children-hours.js';
import {
    FALL_KIND, FALL_SLOT, FALL_SLOTS, HAIRLINES, PACKET_SLOTS, fallMeshes,
} from '../../src/themes/sky-children/sky-children-falls.js';
import { SPRAY_ROLE } from '../../src/themes/sky-children/sky-children-fx.js';
import { LOCK } from '../../src/themes/sky-children/sky-children-events.js';
import { SKY_CHILDREN_TETROMINOS } from '../../src/themes/sky-children/sky-children-tetrominos.js';

vi.setConfig({ testTimeout: 60_000 }); // every test builds at least one whole world

const COLORS = SKY_CHILDREN_TETROMINOS.colors;
const T_CELLS = cellsFromMatrix([[0, 1, 0], [1, 1, 1]]);
/** FINAL §6.3: scene triangles per tier (index.count / 3 × instances, summed over the scene). */
const TRIANGLE_BUDGET = Object.freeze({
    Minimal: 60_000, Low: 80_000, Medium: 100_000, High: 140_000, Ultra: 180_000, Extreme: 230_000,
});
/** FINAL §6.3: the scene draws at most this many meshes, the same set on every tier. */
const MAX_DRAWS = 15;

const worlds = [];
afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function makeWorld(quality = 'Low', {
    width = 1600, height = 900, layout, at = 10, reduce = false, capture = true,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SkyChildrenWorld({ scene, quality, capture }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setReducedMotion(reduce);
    world.setViewport(width, height, aspect);
    world.setLayout(layout === undefined ? fallbackLayout(width, height) : layout, aspect);
    settle(world, camera, at);
    return { scene, camera, world };
}

function settle(world, camera, time) {
    world.seek(time);
    const sim = {
        time, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

/** One frame as the theme runs it: the camera, the gameplay staged since the last frame, the world. */
function frame(world, camera, dt, during = null, pointer = [0, 0]) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: pointer[0], pointerY: pointer[1],
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, dt = 1 / 30, each = null) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
        frame(world, camera, dt);
        each?.(world);
    }
}

const lock = (world, extra = {}) => world.onLock({
    player: 0,
    u: 0.3,
    rows: [12, 11],
    color: COLORS.T,
    shape: 'T',
    cells: T_CELLS,
    hardDrop: false,
    screen: null,
    ...extra,
});
const clear = (world, extra = {}) => world.onClear({
    player: 0,
    rows: [19],
    lines: 1,
    combo: 1,
    cascade: 1,
    tspin: false,
    perfect: false,
    b2b: false,
    screen: null,
    ...extra,
});
const rgbOf = (hex) => pieceLight(hex, 0.35, [0, 0, 0]);
const heldSlots = (world) => world.held.map((h, slot) => (h.released ? -1 : slot)).filter((s) => s >= 0);
const liveLock = (world) => world.effects.locks.items.find((r) => !r.landed);
const slotInfo = (world, slot) => world.poolSlots.find((p) => p.slot === slot);
/** The fall rows the world wrote: [{ kind, duration, flow }] (each slot's three; the lives follow). */
const fallRows = (world) => {
    const rows = world.U.falls.array;
    const out = [];
    for (let i = 0; i < FALL_SLOTS * 3; i += 3) {
        out.push({ kind: rows[i].w, duration: rows[i + 2].y, flow: rows[i + 2].z });
    }
    return out;
};
const spillways = (world) => fallRows(world).filter((f) => f.kind === FALL_KIND.pour && f.duration > 0);

/** Every drawn mesh of the scene and its triangles (index.count / 3 × the instances it can draw). */
function census(scene) {
    const meshes = [];
    let triangles = 0;
    scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry;
        const perInstance = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
        let instances = 1;
        if (o.isInstancedMesh) instances = o.instanceMatrix.count;
        else if (g.isInstancedBufferGeometry) instances = g.instanceCount;
        triangles += perInstance * instances;
        meshes.push(o);
    });
    return { meshes, triangles };
}

/** Hold n pools quietly, one every `gap` seconds, alternating sides (oldest first). */
function holdMany(world, camera, n, gap = 0.2) {
    for (let i = 0; i < n; i++) {
        frame(world, camera, gap, () => lock(world, {
            silent: true, u: i % 2 ? 0.8 : 0.2, rows: [4 + (i % 14)], color: Object.values(COLORS)[i % 7],
        }));
    }
}

describe('Sky Children world: building', () => {
    it('builds every part on every tier, node materials only; dispose() empties the scene and frees it all', () => {
        for (const quality of QUALITY_NAMES) {
            const scene = new THREE.Scene();
            const world = new SkyChildrenWorld({ scene, quality, capture: true }).build();
            expect(Object.keys(world.parts).sort(), quality).toEqual([...SKY_CHILDREN_PARTS].sort());
            const materials = new Set();
            const geometries = new Set();
            scene.traverse((o) => {
                if (o.material) materials.add(o.material);
                if (o.geometry) geometries.add(o.geometry);
            });
            expect(materials.size, quality).toBeGreaterThan(0);
            expect([...materials].every((m) => m.isNodeMaterial && !m.isShaderMaterial), quality).toBe(true);
            // Every texture is baked in code: data textures, nothing decoded from a file.
            expect(world.textures.length, quality).toBeGreaterThan(0);
            expect(world.textures.every((t) => t.isDataTexture), quality).toBe(true);
            const freed = new Set();
            const listen = (thing) => thing.addEventListener('dispose', () => freed.add(thing));
            [...materials, ...geometries, ...world.textures].forEach(listen);
            const textures = [...world.textures];
            world.dispose();
            expect(scene.children, quality).toHaveLength(0);
            expect(textures.every((t) => freed.has(t)), `${quality}: textures`).toBe(true);
            expect([...materials].every((m) => freed.has(m)), `${quality}: materials`).toBe(true);
            expect([...geometries].every((g) => freed.has(g)), `${quality}: geometries`).toBe(true);
            expect(world.parts, quality).toEqual({});
            // Twice is harmless.
            expect(() => world.dispose()).not.toThrow();
        }
    });

    it('loads nothing: no fetch, no texture or image loader, on any tier', () => {
        const textureLoad = vi.spyOn(THREE.TextureLoader.prototype, 'load');
        const imageLoad = vi.spyOn(THREE.ImageLoader.prototype, 'load');
        const fileLoad = vi.spyOn(THREE.FileLoader.prototype, 'load');
        const request = vi.fn(() => Promise.reject(new Error('no network in a world build')));
        vi.stubGlobal('fetch', request);
        for (const quality of QUALITY_NAMES) {
            const { world, camera } = makeWorld(quality, { at: 5 });
            run(world, camera, 0.5);
        }
        expect(textureLoad).not.toHaveBeenCalled();
        expect(imageLoad).not.toHaveBeenCalled();
        expect(fileLoad).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });

    it('draws the same meshes on every tier, within FINAL §6.3\'s draw count, more triangles up the tiers', () => {
        const counts = {};
        const triangles = {};
        for (const quality of QUALITY_NAMES) {
            const { scene } = makeWorld(quality, { at: 5 });
            const { meshes, triangles: t } = census(scene);
            counts[quality] = meshes.map((m) => m.name).sort();
            triangles[quality] = t;
            expect(meshes.every((m) => m.name.startsWith('sky-children-')), quality).toBe(true);
        }
        // Measured (2026-10-11): 12 draws on every tier (FINAL plans 15: no corner meshes, no ribbon draw yet).
        const names = counts.Minimal;
        expect(names.length).toBeGreaterThan(0);
        expect(names.length).toBeLessThanOrEqual(MAX_DRAWS);
        for (const quality of QUALITY_NAMES) expect(counts[quality], quality).toEqual(names);
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            expect(triangles[QUALITY_NAMES[i]], QUALITY_NAMES[i]).toBeGreaterThan(triangles[QUALITY_NAMES[i - 1]]);
        }
    });

    // Instances counted at capacity. Measured 2026-10-11: Minimal 52.9 k, Low 69.5 k, Medium 85.0 k,
    // High 120.7 k, Ultra 151.8 k, Extreme 190.3 k (terrace segments follow each fan's width, the
    // falls' rows and the pools' rim were trimmed).
    it('stays within FINAL §6.3\'s scene triangle budget on every tier', () => {
        const over = [];
        for (const quality of QUALITY_NAMES) {
            const { scene } = makeWorld(quality, { at: 5 });
            const { triangles } = census(scene);
            const budget = TRIANGLE_BUDGET[quality];
            if (triangles > budget) over.push(`${quality} ${triangles} > ${budget}`);
        }
        expect(over).toEqual([]);
    });

    it('draws only the parts it is asked to, and all of them again on request', () => {
        const { world } = makeWorld('Minimal');
        const meshesOf = (name) => {
            const part = world.parts[name];
            return part.meshes || [part.mesh];
        };
        world.showOnlyParts(['sky']);
        for (const name of SKY_CHILDREN_PARTS) {
            meshesOf(name).forEach((m) => expect(m.visible, name).toBe(name === 'sky'));
        }
        world.showOnlyParts(['isles', 'pools', 'fx']);
        for (const name of SKY_CHILDREN_PARTS) {
            meshesOf(name).forEach((m) => expect(m.visible, name).toBe(['isles', 'pools', 'fx'].includes(name)));
        }
        world.showOnlyParts(null);
        for (const name of SKY_CHILDREN_PARTS) meshesOf(name).forEach((m) => expect(m.visible, name).toBe(true));
    });

    it('hands the post one reused object every frame', () => {
        const { world, camera } = makeWorld('Minimal');
        const post = world.getPostState();
        frame(world, camera, 1 / 60, () => clear(world, { lines: 2 }));
        expect(world.getPostState()).toBe(post);
        const fields = ['flash', 'iris', 'exposure', 'gradeShadow', 'gradeLight', 'flare'];
        expect(Object.keys(post)).toEqual(expect.arrayContaining(fields));
    });
});

describe('Sky Children world: replaying a moment', () => {
    /** A ~12 s script of everything the board can do (seconds after the start). */
    const SCRIPT = [
        [0.5, (w) => lock(w, {
            u: 0.2, rows: [12, 11], color: COLORS.S, shape: 'S',
        })],
        [1.0, (w) => lock(w, {
            u: 0.8, rows: [17, 16], color: COLORS.I, shape: 'I', hardDrop: true,
        })],
        [1.5, (w) => clear(w, { rows: [19], lines: 1, combo: 1 })],
        [2.0, (w) => lock(w, {
            u: 0.4, rows: [9, 8], color: COLORS.L, shape: 'L',
        })],
        [2.5, (w) => clear(w, { rows: [19, 18], lines: 2, combo: 2 })],
        [3.0, (w) => w.onCombo(3)],
        [3.5, (w) => clear(w, {
            rows: [19, 18, 17], lines: 3, combo: 3, b2b: true,
        })],
        [4.5, (w) => clear(w, { rows: [19, 18, 17, 16], lines: 4, combo: 4 })],
        [6.5, (w) => clear(w, {
            rows: [18, 17], lines: 2, combo: 5, tspin: true,
        })],
        [7.0, (w) => w.levelUp(2)],
        [8.0, (w) => w.onCombo(0)],
        [9.0, (w) => clear(w, {
            rows: [19, 18], lines: 2, combo: 1, perfect: true,
        })],
    ];

    /** Seek to `start`, then replay SCRIPT at `fps`; snapshot at every whole second. */
    function replay(fps, start = 10, seconds = 12) {
        const { world, camera } = makeWorld('Minimal', { at: start });
        const pending = [...SCRIPT];
        const shots = [];
        const steps = seconds * fps;
        for (let i = 1; i <= steps; i++) {
            const time = start + i / fps;
            const sim = {
                time, delta: 1 / fps, pointerX: 0, pointerY: 0,
            };
            world.updateCamera(camera, sim);
            while (pending.length && pending[0][0] <= i / fps + 1e-9) pending.shift()[1](world);
            world.update(sim, camera);
            if (i % fps === 0) {
                const { U } = world;
                shots.push({
                    state: world.getState(),
                    bow: U.bow.value.toArray(),
                    glory: U.glory.value.toArray(),
                    waterClock: U.waterClock.value,
                    sprayClock: U.sprayClock.value,
                    flow: U.flow.value.toArray(),
                    wring: U.wring.value.toArray(),
                    toll: U.toll.value.toArray(),
                    held: heldSlots(world),
                });
            }
        }
        return shots;
    }

    /**
     * An event lands between a frame's camera and its update, so the step after it runs the new
     * rates for that whole frame: a 30 fps replay leads by up to a frame of motion per event. Three
     * 30 fps frames bound the integrated values (the dial, the water and spray clocks).
     */
    const FRAME_TOL = 3 / 30;

    /** Deep equality, numbers within `tol`. */
    function near(a, b, tol, path = '') {
        if (typeof a === 'number') {
            expect(Math.abs(a - b), `${path}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);
        } else if (Array.isArray(a) || (a && typeof a === 'object')) {
            expect(Object.keys(a), path).toEqual(Object.keys(b));
            Object.keys(a).forEach((k) => near(a[k], b[k], tol, `${path}.${k}`));
        } else {
            expect(a, path).toEqual(b);
        }
    }

    it('replays any moment exactly: a seek is a function of the clock', () => {
        const a = makeWorld('Medium', { at: 47.5 }).world;
        const b = makeWorld('Medium', { at: 47.5 }).world;
        expect(a.getState()).toEqual(b.getState());
        expect(a.U.bow.value.toArray()).toEqual(b.U.bow.value.toArray());
        expect(a.U.rows.array.map((v) => v.toArray())).toEqual(b.U.rows.array.map((v) => v.toArray()));
        expect(a.U.strokes.array.map((v) => v.toArray())).toEqual(b.U.strokes.array.map((v) => v.toArray()));
        expect(a.U.falls.array.map((v) => v.toArray())).toEqual(b.U.falls.array.map((v) => v.toArray()));
    });

    it('gives the same state and the same uniforms for the same events at 30 fps and at 240 fps', () => {
        const slow = replay(30);
        const fast = replay(240);
        expect(slow).toHaveLength(12);
        expect(fast).toHaveLength(12);
        slow.forEach((shot, k) => {
            const at = `t+${k + 1}s`;
            const { dial, ...rest } = shot.state;
            const { dial: fastDial, ...fastRest } = fast[k].state;
            expect(rest, at).toEqual(fastRest);
            expect(Math.abs(dial - fastDial), `${at} dial`).toBeLessThan(FRAME_TOL);
            near(shot.bow, fast[k].bow, FRAME_TOL, `${at} U.bow`);
            near(shot.glory, fast[k].glory, 1e-3, `${at} U.glory`);
            near(shot.waterClock, fast[k].waterClock, FRAME_TOL, `${at} U.waterClock`);
            near(shot.sprayClock, fast[k].sprayClock, FRAME_TOL, `${at} U.sprayClock`);
            near(shot.flow, fast[k].flow, FRAME_TOL, `${at} U.flow`);
            near(shot.wring, fast[k].wring, FRAME_TOL, `${at} U.wring`);
            near(shot.toll, fast[k].toll, 1e-9, `${at} U.toll`);
            expect(shot.held, at).toEqual(fast[k].held);
        });
        // The script really did things: the glory rose, the bell rang, the wring ran.
        expect(Math.max(...slow.map((s) => s.glory[0]))).toBeGreaterThan(0.5);
        expect(slow[11].toll[1]).toBeGreaterThan(0);
        expect(slow[11].wring[1]).toBeGreaterThan(0);
    });

    // A seek forgets every event, the flock's one-shot flights (helix, launch, bank) included.
    it('forgets what came before a seek: a world seeked back matches a fresh one', () => {
        const fresh = makeWorld('Minimal', { at: 12 });
        const used = makeWorld('Minimal', { at: 12 });
        run(used.world, used.camera, 2);
        frame(used.world, used.camera, 1 / 30, () => {
            clear(used.world, { rows: [18, 17], lines: 2, tspin: true });
            used.world.levelUp(2);
        });
        run(used.world, used.camera, 1);
        settle(used.world, used.camera, 12);
        run(fresh.world, fresh.camera, 3);
        run(used.world, used.camera, 3);
        const poses = (w) => w.flock.poses.map((p) => [...p.pos, p.mode]);
        expect(used.world.getState()).toEqual(fresh.world.getState());
        expect(poses(used.world)).toEqual(poses(fresh.world));
    });
});

describe('Sky Children world: a lock', () => {
    it('sends the piece\'s light to a pool on the u side, which holds the colour once the flight lands', () => {
        for (const [u, side] of [[0.2, 'left'], [0.8, 'right']]) {
            const { world, camera } = makeWorld('Low');
            frame(world, camera, 1 / 30, () => lock(world, { u, color: COLORS.J, shape: 'J' }));
            const record = liveLock(world);
            expect(record, side).toBeTruthy();
            const slot = record.pool;
            const info = slotInfo(world, slot);
            expect(info, side).toBeTruthy();
            if (side === 'left') expect(info.x, side).toBeLessThan(world.cardMid);
            else expect(info.x, side).toBeGreaterThanOrEqual(world.cardMid);
            // Not yet: the light is in flight.
            expect(heldSlots(world), side).toEqual([]);
            const lands = record.at + LOCK.melt + record.flight;
            run(world, camera, lands - world.time - 0.05);
            expect(heldSlots(world), side).toEqual([]);
            run(world, camera, 0.15);
            expect(heldSlots(world), side).toEqual([slot]);
            expect(world.held[slot].rgb, side).toEqual(rgbOf(COLORS.J));
            expect(world.held[slot].silent, side).toBe(false);
            expect(world.getState().held, side).toBe(1);
        }
    });

    it('chooses the unlit pool on that side whose height is nearest the row', () => {
        const { world, camera } = makeWorld('High');
        frame(world, camera, 1 / 30, () => lock(world, { u: 0.25, rows: [6, 5] }));
        const chosen = slotInfo(world, liveLock(world).pool);
        const { card, board } = world.cardOf(0);
        const y = board.y0 + ((5.5 + 0.5) / 20) * (board.y1 - board.y0);
        const mid = (card.x0 + card.x1) / 2;
        const best = Math.min(...world.poolSlots.filter((p) => p.x < mid).map((p) => Math.abs(p.y - y)));
        expect(Math.abs(chosen.y - y)).toBeCloseTo(best, 9);
    });

    // The isles share the pool slots by their pool counts (FINAL §2.1: "the pool on that side").
    it('keeps pools on both sides of the card on every tier, so a right-hand lock lands on the right', () => {
        for (const quality of QUALITY_NAMES) {
            const { world, camera } = makeWorld(quality);
            world.cardOf(0);
            expect(world.poolSlots.some((p) => p.x >= world.cardMid), quality).toBe(true);
            frame(world, camera, 1 / 30, () => lock(world, { u: 0.8 }));
            expect(slotInfo(world, liveLock(world).pool).x, quality).toBeGreaterThanOrEqual(world.cardMid);
        }
    });

    // FINAL §2.1 "Lock, right side, HUD band": out of the band along the card–HUD gap, past the
    // HUD's corner, then the arc; the sparks keep off it too.
    it('never sends a right-hand thread across the stats bar, whatever the row', () => {
        const crossing = {};
        for (const rows of [[0], [1], [10, 9], [14], [19, 18]]) {
            const { world, camera } = makeWorld('Low');
            const { hud } = world.layout;
            frame(world, camera, 1 / 30, () => lock(world, { u: 0.8, rows }));
            const record = liveLock(world);
            const land = record.at + LOCK.melt + record.flight;
            for (let t = record.at; t < land; t += 0.01) {
                world.effects.emit(t, (x, y, z) => {
                    const p = world.screenOf([x, y, z]);
                    if (p.x > hud.x0 && p.x < hud.x1 && p.y > hud.y0 && p.y < hud.y1) {
                        const where = `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`;
                        crossing[`rows ${rows}`] ??= `t+${(t - record.at).toFixed(2)} at ${where}`;
                    }
                });
            }
        }
        expect(crossing).toEqual({});
    });

    it('lands a hard drop\'s jet at once, and dips the eye on a spring that settles', () => {
        const { world, camera } = makeWorld('Low');
        const rest = camera.quaternion.clone();
        frame(world, camera, 1 / 60, () => lock(world, { hardDrop: true, u: 0.2 }));
        const record = liveLock(world);
        expect(record.hard).toBe(true);
        expect(record.flight).toBeCloseTo(LOCK.jet, 9);
        run(world, camera, LOCK.jet + 0.03, 1 / 60);
        expect(heldSlots(world)).toEqual([record.pool]);
        // The dip: the (otherwise still, capture) eye has pitched since the drop...
        expect(camera.quaternion.angleTo(rest)).toBeGreaterThan(1e-3);
        // ...and is back at rest within a second.
        run(world, camera, 1, 1 / 60);
        expect(camera.quaternion.angleTo(rest)).toBeLessThan(1e-4);
    });

    it('holds the colour at once and draws nothing for a silent lock (pieceLockRipple off)', () => {
        const quiet = makeWorld('Low');
        const control = makeWorld('Low');
        const silent = { silent: true, hardDrop: true, color: COLORS.O };
        frame(quiet.world, quiet.camera, 1 / 30, () => lock(quiet.world, silent));
        frame(control.world, control.camera, 1 / 30);
        const held = heldSlots(quiet.world);
        expect(held).toHaveLength(1);
        expect(quiet.world.held[held[0]].silent).toBe(true);
        expect(quiet.world.held[held[0]].rgb).toEqual(rgbOf(COLORS.O));
        // No copy, no thread, no crown: the light layers carry what an untouched world carries.
        expect(liveLock(quiet.world)).toBeUndefined();
        expect(quiet.world.effects.locks.items.every((r) => r.at < 0)).toBe(true);
        run(quiet.world, quiet.camera, 1.5);
        run(control.world, control.camera, 1.5);
        // ...save the held pool's own jewel, its halo and its heart (the colour it holds, silent or not).
        expect(quiet.world.parts.fx.glows.count).toBe(control.world.parts.fx.glows.count + held.length * 2);
        // The eye does not dip for a silent hard drop either.
        expect(quiet.camera.quaternion.toArray()).toEqual(control.camera.quaternion.toArray());
    });
});

describe('Sky Children world: flashes', () => {
    it('plays at most three flare onsets in any second, however fast the drops land', () => {
        const { world, camera } = makeWorld('Low');
        const granted = [];
        const request = world.flashes.request.bind(world.flashes);
        world.flashes.request = (...args) => {
            const g = request(...args);
            if (g.strength > 0 && g.at <= world.time + 1e-3) granted.push(world.time);
            return g;
        };
        // Ten hard drops 0.1 s apart, alternating sides: ten landings inside about a second.
        for (let k = 0; k < 10; k++) {
            frame(world, camera, 0.1, () => lock(world, { hardDrop: true, u: k % 2 ? 0.8 : 0.2, rows: [10 + (k % 5)] }));
        }
        run(world, camera, 1.5, 1 / 30);
        expect(granted.length).toBeGreaterThan(0);
        for (let i = 0; i < granted.length; i++) {
            const inWindow = granted.filter((t) => t >= granted[i] && t < granted[i] + 1).length;
            expect(inWindow, `onsets in the second from ${granted[i].toFixed(2)} s`).toBeLessThanOrEqual(3);
        }
    });
});

describe('Sky Children world: a new run', () => {
    it('drains every held pool on a new run with nothing undefined in the lamps or the glows', () => {
        const { world, camera } = makeWorld('Low');
        holdMany(world, camera, 4);
        frame(world, camera, 1 / 30, () => world.resetSession());
        run(world, camera, 0.4);
        world.held.forEach((h) => {
            expect(h.released).toBe(true);
            expect(Number.isFinite(h.releasedAt)).toBe(true);
        });
        world.U.lamps.array.forEach((v, i) => {
            expect(Number.isFinite(v.x + v.y + v.z + v.w), `lamp row ${i}`).toBe(true);
        });
        const { glows } = world.parts.fx;
        const data = glows.mesh.geometry.getAttribute('aGlowA').data.array;
        for (let i = 0; i < glows.count * 12; i++) expect(Number.isFinite(data[i]), `glow float ${i}`).toBe(true);
    });
});

describe('Sky Children world: a clear', () => {
    it('releases the 3 / 6 / 9 oldest held pools for 1 / 2 / 3 lines and sends packets down the falls', () => {
        for (const lines of [1, 2, 3]) {
            const { world, camera } = makeWorld('High');
            holdMany(world, camera, 12);
            const before = heldSlots(world);
            expect(before, `${lines} lines`).toHaveLength(12);
            const oldest = [...before].sort((a, b) => world.held[a].at - world.held[b].at).slice(0, 3 * lines);
            expect(world.U.counts.value.x).toBe(0);
            frame(world, camera, 1 / 30, () => clear(world, { lines, rows: [19, 18, 17].slice(0, lines) }));
            const after = heldSlots(world);
            expect(after, `${lines} lines`).toHaveLength(12 - 3 * lines);
            oldest.forEach((slot) => expect(world.held[slot].released, `${lines} lines, slot ${slot}`).toBe(true));
            // Surges and coloured ribbons are riding the falls.
            expect(world.U.counts.value.x, `${lines} lines`).toBeGreaterThan(3 * lines);
            expect(world.U.counts.value.x, `${lines} lines`).toBeLessThanOrEqual(PACKET_SLOTS);
            const packets = world.U.packets.array;
            const ribbons = [];
            for (let i = 0; i < world.U.counts.value.x; i++) {
                if (packets[i * 2 + 1].w === 0) ribbons.push(packets[i * 2 + 1].toArray().slice(0, 3));
            }
            const colours = oldest.map((slot) => world.held[slot].rgb);
            colours.forEach((rgb) => expect(ribbons, `${lines} lines`).toContainEqual(rgb));
        }
    });

    it('never drops a colour ribbon before it has run off its fall, however fast the clears come', () => {
        const { world, camera } = makeWorld('High');
        holdMany(world, camera, 24, 0.05);
        const written = [];
        const packet = world.packet.bind(world);
        vi.spyOn(world, 'packet').mockImplementation((fall, born, width, strength, rgb, kind) => {
            if (kind === 0) written.push({ fall, born, rgb: [...rgb] });
            return packet(fall, born, width, strength, rgb, kind);
        });
        const rows = world.U.packets.array;
        const present = (r) => {
            for (let i = 0; i < world.U.counts.value.x; i++) {
                const a = rows[i * 2];
                const b = rows[i * 2 + 1];
                if (a.x === r.fall && a.y === r.born && b.w === 0 && b.x === r.rgb[0]) return true;
            }
            return false;
        };
        // A long chain, a clear every 0.8 s, two and three lines among them.
        for (let k = 0; k < 10; k++) {
            frame(world, camera, 0.8, () => {
                clear(world, { lines: 1 + (k % 3), combo: k + 1, rows: [19, 18, 17].slice(0, 1 + (k % 3)) });
                if (k % 2) holdMany(world, camera, 3, 0.01);
            });
            const water = world.U.waterClock.value;
            written.forEach((r, n) => {
                const length = world.fallCpu[r.fall].duration;
                if (water - r.born < length) expect(present(r), `ribbon ${n} after clear ${k}`).toBe(true);
            });
        }
        expect(written.length).toBeGreaterThan(20);
        expect(world.U.counts.value.x).toBeLessThanOrEqual(PACKET_SLOTS);
    });

    it('pours a meditation click\'s sheets, and sends its copy, from where it was clicked', () => {
        const { world, camera } = makeWorld('High');
        run(world, camera, 0.2);
        const sheet = vi.spyOn(world.effects, 'sheet');
        const click = { x: 0.22, y: 0.31 };
        frame(world, camera, 1 / 30, () => clear(world, { rows: [], screen: click }));
        expect(sheet).toHaveBeenCalledTimes(2);
        const p = { x: 0, y: 0, front: false };
        sheet.mock.calls.forEach(([, from], k) => {
            const d = Math.hypot(...from);
            world.screenOf([from[0] / d, from[1] / d, from[2] / d], p);
            expect(p.front, `sheet ${k}`).toBe(true);
            expect(Math.abs(p.x - click.x), `sheet ${k} x`).toBeLessThan(0.02);
            expect(Math.abs(p.y - click.y), `sheet ${k} y`).toBeLessThan(0.01);
        });
        // The lock a click makes leaves from beside the point too, a cell's size.
        frame(world, camera, 1 / 30, () => lock(world, { rows: [], u: 0.5, screen: click }));
        const r = liveLock(world);
        expect(r).toBeTruthy();
        const d = Math.hypot(...r.from);
        world.screenOf([r.from[0] / d, r.from[1] / d, r.from[2] / d], p);
        expect(Math.abs(p.x - click.x)).toBeLessThan(0.04);
        expect(Math.abs(p.y - click.y)).toBeLessThan(0.01);
    });

    it('halves the release under back-to-back (rounding up): the pools stay brimming', () => {
        for (const [lines, kept] of [[1, 2], [2, 3], [3, 5]]) {
            const { world, camera } = makeWorld('High');
            holdMany(world, camera, 12);
            frame(world, camera, 1 / 30, () => clear(world, { lines, b2b: true }));
            expect(heldSlots(world), `${lines} lines b2b`).toHaveLength(12 - kept);
        }
    });

    // The release halves only for a clear that is itself back-to-back.
    it('releases the full count again once a clear arrives without back-to-back', () => {
        const { world, camera } = makeWorld('High');
        holdMany(world, camera, 12);
        frame(world, camera, 1 / 30, () => clear(world, { lines: 1, combo: 1, b2b: true }));
        expect(heldSlots(world)).toHaveLength(10);
        frame(world, camera, 1 / 30, () => clear(world, { lines: 1, combo: 2, b2b: false }));
        expect(heldSlots(world)).toHaveLength(7);
        expect(world.flock.longWing).toBe(false);
    });

    it('still answers with nothing held: the Mother Fall and the span carry the accent', () => {
        const { world, camera } = makeWorld('Low');
        frame(world, camera, 1 / 30, () => clear(world, { lines: 1 }));
        const packets = world.U.packets.array;
        let ribbons = 0;
        for (let i = 0; i < world.U.counts.value.x; i++) if (packets[i * 2 + 1].w === 0) ribbons += 1;
        expect(ribbons).toBeGreaterThanOrEqual(2);
    });
});

describe('Sky Children world: four lines and a perfect clear', () => {
    it('hushes the falls for a third of a second, then opens the glory ring by ring, and pours every held pool', () => {
        const { world, camera } = makeWorld('Low');
        holdMany(world, camera, 5);
        run(world, camera, 1);
        const restWidth = world.U.flow.value.y;
        const t0 = world.time + 1 / 60;
        const water0 = world.U.waterClock.value;
        frame(world, camera, 1 / 60, () => clear(world, { rows: [19, 18, 17, 16], lines: 4 }));
        const hush = [];
        const after = [];
        let hushWater = null;
        const reveal = [];
        const strength = [];
        run(world, camera, 2.2, 1 / 60, (w) => {
            const age = w.time - t0;
            if (age < 0.33 - 1e-6) hush.push([w.U.flow.value.y, w.U.glory.value.x]);
            else if (hushWater === null) hushWater = w.U.waterClock.value - water0;
            if (age > 0.34 && age < 1.0) after.push(w.U.flow.value.y);
            reveal.push(w.U.glory.value.y);
            strength.push(w.U.glory.value.x);
        });
        // The hush: the falls thin to threads and the glory has not begun.
        expect(hush.length).toBeGreaterThan(15);
        hush.forEach(([width, glory]) => {
            expect(width).toBeLessThan(restWidth * 0.5);
            expect(glory).toBe(0);
        });
        // Water slowed (×0.15) through it: its clock ran far behind real time.
        expect(hushWater).toBeGreaterThan(0);
        expect(hushWater).toBeLessThan(0.33 * 0.3);
        // Then the falls come back.
        after.forEach((width) => expect(width).toBeGreaterThan(restWidth * 0.9));
        // The glory rises, and its reveal radius only grows, one ring per line.
        expect(Math.max(...strength)).toBeGreaterThan(0.9);
        for (let i = 1; i < reveal.length; i++) expect(reveal[i]).toBeGreaterThanOrEqual(reveal[i - 1] - 1e-9);
        const steps = reveal.filter((r, i) => i > 0 && r - reveal[i - 1] > 0.3).length;
        expect(steps).toBe(4); // each of the four rings opens with a step out
        expect(world.hush.rings).toBe(4);
        // The great pour has taken every held colour down the falls.
        expect(heldSlots(world)).toEqual([]);
        expect(world.getState().held).toBe(0);
        // The glory holds, then sinks into the mist.
        run(world, camera, 14, 1 / 10);
        expect(world.U.glory.value.x).toBeLessThan(1e-3);
    });

    // The pour fires on the first frame at or after pourAt, however long that frame is.
    it('pours every held pool even when the frame that crosses the pour is a long one', () => {
        const { world, camera } = makeWorld('Low');
        holdMany(world, camera, 5);
        run(world, camera, 1);
        frame(world, camera, 1 / 100, () => clear(world, { rows: [19, 18, 17, 16], lines: 4 }));
        run(world, camera, 1.59, 1 / 100);
        expect(heldSlots(world)).toHaveLength(5);
        frame(world, camera, 0.05);
        run(world, camera, 1, 1 / 30);
        expect(heldSlots(world)).toEqual([]);
    });

    it('opens eight rings on a perfect clear, after a longer hush, and runs the Far Gate\'s spillway', () => {
        const quad = makeWorld('Low');
        const perfect = makeWorld('Low');
        frame(quad.world, quad.camera, 1 / 30, () => clear(quad.world, { rows: [19, 18, 17, 16], lines: 4 }));
        frame(perfect.world, perfect.camera, 1 / 30, () => clear(perfect.world, { lines: 2, perfect: true }));
        expect(perfect.world.hush.length).toBeGreaterThan(quad.world.hush.length);
        expect(perfect.world.hush.rings).toBe(8);
        expect(spillways(perfect.world)).toEqual([]);
        // Each ring opens with a step out of the reveal radius: eight of them, against the quad's four.
        const steps = { quad: 0, perfect: 0 };
        const last = { quad: 0, perfect: 0 };
        const watch = (key) => (w) => {
            if (w.U.glory.value.y - last[key] > 0.3) steps[key] += 1;
            last[key] = w.U.glory.value.y;
        };
        run(perfect.world, perfect.camera, 1.8, 1 / 30, watch('perfect'));
        run(quad.world, quad.camera, 1.8, 1 / 30, watch('quad'));
        expect(spillways(perfect.world)).toEqual([]);
        run(perfect.world, perfect.camera, 0.4, 1 / 30, watch('perfect'));
        run(quad.world, quad.camera, 0.4, 1 / 30, watch('quad'));
        // Two seconds in: the spillway pours (only for a perfect clear).
        expect(spillways(perfect.world)).toHaveLength(1);
        expect(spillways(quad.world)).toEqual([]);
        run(perfect.world, perfect.camera, 2, 1 / 30, watch('perfect'));
        run(quad.world, quad.camera, 2, 1 / 30, watch('quad'));
        expect(steps).toEqual({ quad: 4, perfect: 8 });
        expect(perfect.world.U.glory.value.y).toBeGreaterThan(quad.world.U.glory.value.y);
        // It pours ~13 s and thins away; then the slot is dormant again.
        run(perfect.world, perfect.camera, 16, 1 / 10);
        expect(spillways(perfect.world)).toEqual([]);
    });
});

/** Where a world point is in the solved frame (x, y in 0..1 from the top left; front: ahead of the eye). */
const onScreen = (world, p) => {
    const d = Math.hypot(p[0], p[1], p[2]) || 1;
    return world.screenOf([p[0] / d, p[1] / d, p[2] / d], { x: 0, y: 0, front: false });
};
/** The spray the world laid this frame: [{ p, radius, role }] in the order it is drawn. */
const sprayPuffs = (world) => {
    const { spray } = world.parts;
    const data = spray.mesh.geometry.getAttribute('aSprayA').data.array;
    const out = [];
    for (let k = 0; k < spray.count; k++) {
        const o = k * 12;
        out.push({ p: [data[o], data[o + 1], data[o + 2]], radius: data[o + 3], role: data[o + 11] });
    }
    return out;
};
const triangles = ({ rows, cols }) => (rows > 1 ? (rows - 1) * cols * 2 : 0);
/** Two boards side by side (local multiplayer): the smile plan, the corners close under the cards. */
const TWO_BOARDS = Object.freeze({
    cardCount: 2,
    cards: [{
        x0: 0.16, x1: 0.42, y0: 0.12, y1: 0.88,
    }, {
        x0: 0.58, x1: 0.84, y0: 0.12, y1: 0.88,
    }],
    hud: null,
    boards: [],
});
/** How much of the frame the spray covers: every puff's quad, clipped to the frame, summed (screens). */
const sprayCover = (world) => {
    const { basis: { f, r, u }, tanX, tanY } = world.frame.cam;
    const span = (c, h) => Math.max(0, Math.min(1, c + h) - Math.max(0, c - h));
    return sprayPuffs(world).reduce((sum, { p, radius }) => {
        const z = p[0] * f[0] + p[1] * f[1] + p[2] * f[2];
        if (z < 1) return sum;
        const cx = 0.5 + (0.5 * (p[0] * r[0] + p[1] * r[1] + p[2] * r[2])) / (z * tanX);
        const cy = 0.5 - (0.5 * (p[0] * u[0] + p[1] * u[1] + p[2] * u[2])) / (z * tanY);
        return sum + span(cx, (0.5 * radius) / (z * tanX)) * span(cy, (0.5 * radius) / (z * tanY));
    }, 0);
};
/** The mean height of the Mother's plume (m): a tower thrown up out of it lifts it. */
const plumeHeight = (world) => {
    const m = world.fallCpu[FALL_SLOT.mother];
    const plume = sprayPuffs(world).filter((q) => q.role === SPRAY_ROLE.plume
        && Math.hypot(q.p[0] - m.lip[0], q.p[2] - m.lip[2]) < 150);
    return plume.reduce((a, q) => a + q.p[1], 0) / Math.max(1, plume.length);
};

describe('Sky Children world: the falls', () => {
    it('builds each fall only as fine as it needs: the Mother takes the most, an undrawn hairline none', () => {
        let last = 0;
        for (const quality of QUALITY_NAMES) {
            const tier = QUALITY[quality];
            const meshes = fallMeshes(tier);
            expect(meshes).toHaveLength(FALL_SLOTS);
            const mother = triangles(meshes[FALL_SLOT.mother]);
            meshes.forEach((m, f) => {
                if (f !== FALL_SLOT.mother) expect(triangles(m), `${quality} slot ${f}`).toBeLessThan(mother);
            });
            for (let i = 0; i < HAIRLINES; i++) {
                expect(triangles(meshes[FALL_SLOT.hair + i]) > 0, `${quality} hairline ${i}`).toBe(i < tier.hairlineFalls);
            }
            // The hero's curtain holds a third of the falls' triangles or more, and the falls grow up the tiers.
            const total = meshes.reduce((a, m) => a + triangles(m), 0);
            expect(mother / total, quality).toBeGreaterThan(1 / 3);
            expect(total, quality).toBeGreaterThan(last);
            last = total;
        }
    });

    it('tells the Mother Fall\'s whole life on screen: it breaks, goes to mist, and runs on out of the frame', () => {
        for (const size of [[1600, 900], [2560, 1080], [390, 844]]) {
            const [w, h] = size;
            const { world } = makeWorld('Low', { width: w, height: h, layout: nominalLayout(w / h) });
            const m = world.fallCpu[FALL_SLOT.mother];
            expect(m.breakAt, `${w}x${h}`).toBeLessThan(m.mistAt);
            expect(m.mistAt, `${w}x${h}`).toBeLessThan(m.tFrame);
            expect(m.tFrame, `${w}x${h}`).toBeLessThan(m.duration);
            // Where it breaks and where it goes to mist are both in the frame.
            for (const t of [m.breakAt, m.mistAt]) {
                const at = onScreen(world, fallPoint(m, t));
                expect(at.front && at.y > 0 && at.y < 1, `${w}x${h} at ${t.toFixed(2)} s`).toBe(true);
            }
        }
    });

    it('pours the Mother Fall where a phone shows it: on screen, mostly outside the card', () => {
        const phone = makeWorld('Low', { width: 390, height: 844, layout: nominalLayout(390 / 844) });
        const { card } = phone.world.cardOf(0);
        const m = phone.world.fallCpu[FALL_SLOT.mother];
        let seen = 0;
        for (let k = 0; k <= 6; k++) {
            const at = onScreen(phone.world, fallPoint(m, (m.tFrame * k) / 6));
            const inCard = at.x > card.x0 && at.x < card.x1 && at.y > card.y0 && at.y < card.y1;
            if (at.front && at.x > 0 && at.x < 1 && at.y > 0 && at.y < 1 && !inCard) seen += 1;
        }
        expect(seen).toBeGreaterThanOrEqual(4);
    });

    it('gives the Mother Fall the spray (a veil, a plume across the frame\'s edge), laid far to near', () => {
        const { world } = makeWorld('High');
        const puffs = sprayPuffs(world);
        expect(puffs.length).toBeGreaterThan(world.parts.spray.capacity * 0.8);
        // Far to near: each puff is laid over the ones behind it.
        for (let k = 1; k < puffs.length; k++) {
            expect(Math.hypot(...puffs[k].p)).toBeLessThanOrEqual(Math.hypot(...puffs[k - 1].p) + 1e-3);
        }
        // Whose is it: the nearest lip.
        const lips = [FALL_SLOT.mother, FALL_SLOT.span, FALL_SLOT.horse, FALL_SLOT.horse + 1, FALL_SLOT.horse + 2]
            .map((f) => world.fallCpu[f]);
        const owner = (p) => {
            let best = 0;
            lips.forEach((f, i) => {
                const d = Math.hypot(p[0] - f.lip[0], p[2] - f.lip[2]);
                if (d < Math.hypot(p[0] - lips[best].lip[0], p[2] - lips[best].lip[2])) best = i;
            });
            return best;
        };
        const mother = puffs.filter((q) => owner(q.p) === 0);
        const twin = puffs.filter((q) => owner(q.p) > 0);
        // Seen area (radius over distance, squared): the Mother's at least two and a half times the Twin's.
        const area = (list) => list.reduce((a, q) => a + (q.radius / Math.hypot(...q.p)) ** 2, 0);
        expect(area(mother)).toBeGreaterThan(2.5 * area(twin));
        // Her veil and her plume are there (her brink throws none; the span's does), and most of the
        // plume stands across the frame's lower edge.
        const roles = new Set(mother.map((q) => q.role));
        [SPRAY_ROLE.veil, SPRAY_ROLE.plume].forEach((r) => expect(roles.has(r), `role ${r}`).toBe(true));
        expect(new Set(twin.map((q) => q.role)).has(SPRAY_ROLE.lip)).toBe(true);
        const plume = mother.filter((q) => q.role === SPRAY_ROLE.plume).map((q) => onScreen(world, q.p));
        const edge = plume.filter((at) => at.front && at.y > 0.6 && at.y < 1.3);
        expect(edge.length / plume.length).toBeGreaterThan(0.8);
    });

    it('throws a tower of spray up out of the plume on a three-line clear, and lets it down again', () => {
        const { world, camera } = makeWorld('Low');
        const top = () => Math.max(...sprayPuffs(world).filter((q) => q.role === SPRAY_ROLE.plume).map((q) => q.p[1]));
        const before = top();
        frame(world, camera, 1 / 30, () => clear(world, { rows: [19, 18, 17], lines: 3 }));
        run(world, camera, 1.5);
        const thrown = top();
        expect(thrown).toBeGreaterThan(before + 30);
        run(world, camera, 6);
        expect(top()).toBeLessThan(thrown - 30);
    });

    it('carries a standing tower on when another burst lands, never throws it down and up again', () => {
        const { world, camera } = makeWorld('Low');
        const rest = plumeHeight(world);
        frame(world, camera, 1 / 30, () => clear(world, { rows: [19, 18, 17], lines: 3 }));
        let last = plumeHeight(world);
        let fall = 0;
        let most = 0;
        for (let i = 0; i < 30 * 7; i++) {
            // A second tower 1.5 s in, then a run of long hard drops four times a second.
            frame(world, camera, 1 / 30, () => {
                if (i === 45) clear(world, { rows: [19, 18, 17], lines: 3 });
                if (i >= 60 && i < 120 && i % 8 === 0) {
                    lock(world, {
                        hardDrop: true, dropRows: 17, u: 0.4, rows: [19, 18],
                    });
                }
            });
            const now = plumeHeight(world);
            fall = Math.max(fall, last - now);
            most = Math.max(most, now - rest);
            last = now;
        }
        expect(most).toBeGreaterThan(10);
        // Never more than a little of it let down in a frame (it comes down over seconds).
        expect(fall).toBeLessThan(most * 0.1);
    });

    it('swells the plume on a long hard drop, a far smaller thing than a three-line clear\'s tower', () => {
        const rise = (event) => {
            const { world, camera } = makeWorld('Low');
            const rest = plumeHeight(world);
            frame(world, camera, 1 / 30, () => event(world));
            let most = 0;
            run(world, camera, 3, 1 / 30, () => { most = Math.max(most, plumeHeight(world) - rest); });
            return most;
        };
        const swell = rise((w) => lock(w, {
            hardDrop: true, dropRows: 17, u: 0.4, rows: [19, 18],
        }));
        const tower = rise((w) => clear(w, { rows: [19, 18, 17], lines: 3 }));
        expect(swell).toBeGreaterThan(0.5);
        expect(swell).toBeLessThan(tower * 0.35);
    });

    it('throws no tower under reduced motion: the plume only thickens', () => {
        const { world, camera } = makeWorld('Low', { reduce: true });
        const rest = plumeHeight(world);
        frame(world, camera, 1 / 30, () => clear(world, { rows: [19, 18, 17], lines: 3 }));
        let most = 0;
        run(world, camera, 4, 1 / 30, () => { most = Math.max(most, plumeHeight(world) - rest); });
        expect(most).toBeLessThan(2);
    });

    it('keeps the spray\'s fill within its budget in every layout: finer puffs where the plume comes near', () => {
        const layouts = [
            [1920, 1080, (a) => nominalLayout(a)],
            [3840, 1080, (a) => nominalLayout(a)],
            [430, 932, (a) => nominalLayout(a)],
            [1920, 1080, () => TWO_BOARDS],
        ];
        for (const quality of ['High', 'Extreme']) {
            for (const [w, h, layout] of layouts) {
                const { world } = makeWorld(quality, { width: w, height: h, layout: layout(w / h) });
                expect(sprayCover(world), `${quality} ${w}x${h}`).toBeLessThan(sprayFill(world.parts.spray.capacity) * 1.2);
            }
        }
    });

    it('seats the span\'s spray on the width it is drawn at, broad after a two-line clear', () => {
        const { world, camera } = makeWorld('Low');
        frame(world, camera, 1 / 30, () => clear(world, { rows: [19, 18], lines: 2 }));
        run(world, camera, 0.5);
        const row = world.U.falls.array[FALL_SLOT.span * 3 + 2].z;
        expect(row).toBeGreaterThan(1.5);
        expect(world.fallCpu[FALL_SLOT.span].flow).toBe(row);
    });

    it('tells the Mother Fall\'s life above whatever edge stands in front of her (two boards)', () => {
        const { world } = makeWorld('Low', { width: 1920, height: 1080, layout: TWO_BOARDS });
        const m = world.fallCpu[FALL_SLOT.mother];
        // She breaks and goes to mist above the parapet's edge (or the frame's, where none stands).
        for (const t of [m.breakAt, m.mistAt]) {
            const at = onScreen(world, fallPoint(m, t));
            expect(at.front && at.y > 0 && at.y < world.edgeAt(at.x), `at ${t.toFixed(2)} s`).toBe(true);
        }
        // A tall frame never stretches the span's drop out into a long ruled line.
        const span = world.fallCpu[FALL_SLOT.span];
        expect(span.tFrame).toBeLessThan(world.frameCrossing(span));
    });

    it('pours the Mother Fall where her plume is seen beside two boards, never behind a card', () => {
        const wide = {
            ...TWO_BOARDS,
            cards: [{
                x0: 0.27, x1: 0.49, y0: 0.11, y1: 0.89,
            }, {
                x0: 0.51, x1: 0.73, y0: 0.11, y1: 0.89,
            }],
        };
        for (const layout of [TWO_BOARDS, wide]) {
            const { world } = makeWorld('Low', { width: 1280, height: 720, layout });
            const m = world.fallCpu[FALL_SLOT.mother];
            const plume = sprayPuffs(world).filter((q) => q.role === SPRAY_ROLE.plume
                && Math.hypot(q.p[0] - m.lip[0], q.p[2] - m.lip[2]) < 150).map((q) => onScreen(world, q.p));
            const seen = plume.filter((at) => at.front && at.x > 0 && at.x < 1 && at.y < world.edgeAt(at.x)
                && !layout.cards.some((c) => at.x > c.x0 && at.x < c.x1 && at.y > c.y0 && at.y < c.y1));
            expect(seen.length / plume.length, `cards from ${layout.cards[0].x0}`).toBeGreaterThan(0.5);
        }
    });
});

describe('Sky Children world: a T-spin', () => {
    it('wrings the falls from the water clock of the clear, sends two children up in a helix, swings the bell', () => {
        const { world, camera } = makeWorld('Low');
        expect(world.U.wring.value.y).toBe(0);
        const bellAtRest = world.parts.isles.bell.matrix.clone();
        let water = 0;
        frame(world, camera, 1 / 30, () => {
            water = world.U.waterClock.value;
            clear(world, { rows: [18, 17], lines: 2, tspin: true });
        });
        expect(world.U.wring.value.y).toBe(1);
        expect(world.U.wring.value.x).toBeCloseTo(water, 9);
        run(world, camera, 0.5);
        expect(world.flock.poses.filter((p) => p.mode === 2)).toHaveLength(2);
        // The bell swings on its stem.
        expect(world.parts.isles.bell.matrix.equals(bellAtRest)).toBe(false);
        // Reduced motion plays it at half strength.
        const calm = makeWorld('Low', { reduce: true });
        frame(calm.world, calm.camera, 1 / 30, () => clear(calm.world, { rows: [18, 17], lines: 2, tspin: true }));
        expect(calm.world.U.wring.value.y).toBeCloseTo(0.5, 9);
    });

    it('turns the link colours one stroke along the bow', () => {
        const { world, camera } = makeWorld('Low');
        const links = [['S', 1], ['I', 2], ['T', 3]];
        for (const [shape, n] of links) {
            frame(world, camera, 1 / 30, () => lock(world, { color: COLORS[shape], shape }));
            frame(world, camera, 1 / 30, () => clear(world, { combo: n }));
            run(world, camera, 1.1);
        }
        expect(world.dial).toBeCloseTo(3, 6);
        const thread = (i) => world.U.strokes.array[STROKES + i].toArray().slice(0, 3);
        expect([0, 1, 2].map(thread)).toEqual([rgbOf(COLORS.S), rgbOf(COLORS.I), rgbOf(COLORS.T)]);
        frame(world, camera, 1 / 30, () => clear(world, { combo: 0, tspin: true }));
        frame(world, camera, 1 / 30);
        expect([0, 1, 2].map(thread)).toEqual([rgbOf(COLORS.T), rgbOf(COLORS.S), rgbOf(COLORS.I)]);
    });
});

describe('Sky Children world: the chain paints the bow', () => {
    it('paints one stroke per link, each in at most a second and never in a pop', () => {
        const { world, camera } = makeWorld('Low');
        expect(world.U.bow.value.w).toBe(0);
        for (let n = 1; n <= 7; n++) {
            world.onCombo(n);
            const start = world.dial;
            let reached = null;
            let elapsed = 0;
            for (let i = 0; i < 40; i++) {
                const before = world.dial;
                frame(world, camera, 1 / 30);
                elapsed += 1 / 30;
                const step = world.dial - before;
                const backlog = n - before;
                // Never faster than one stroke a second, or the backlog over 0.8 s when links pile up.
                expect(step, `link ${n}`).toBeLessThanOrEqual(Math.max(1, backlog / 0.8) / 30 + 1e-9);
                if (world.dial < n) expect(step, `link ${n}`).toBeGreaterThanOrEqual(1 / 30 - 1e-9);
                if (reached === null && world.dial >= n - 1e-9) reached = elapsed;
                if (elapsed > 0.5 && elapsed < 0.55) expect(world.dial - start, `link ${n} at 0.5 s`).toBeLessThan(1);
            }
            expect(reached, `link ${n}`).not.toBeNull();
            expect(reached, `link ${n}`).toBeLessThanOrEqual(1.0 + 1 / 30 + 1e-9);
            expect(reached, `link ${n}`).toBeGreaterThan(0.9);
            expect(world.U.bow.value.w, `link ${n}`).toBeCloseTo(n, 9);
            expect(world.getState().combo).toBe(n);
        }
    });

    it('compresses a backlog: seven links at once paint in under seven seconds, still stroke by stroke', () => {
        const { world, camera } = makeWorld('Low');
        world.onCombo(7);
        let t = 0;
        let last = 0;
        while (world.dial < 7 - 1e-9 && t < 10) {
            frame(world, camera, 1 / 30);
            t += 1 / 30;
            expect(world.dial).toBeGreaterThan(last);
            last = world.dial;
        }
        expect(t).toBeLessThan(7);
        expect(t).toBeGreaterThan(2);
        // Capped at the dial's top.
        world.onCombo(40);
        run(world, camera, 12);
        expect(world.U.bow.value.w).toBe(DIAL_MAX);
    });

    it('unwinds newest-first at one stroke per 0.35 s when the chain breaks', () => {
        const { world, camera } = makeWorld('Low');
        world.onCombo(5);
        run(world, camera, 5);
        expect(world.dial).toBe(5);
        world.onCombo(0);
        run(world, camera, 0.35, 1 / 60);
        expect(world.dial).toBeCloseTo(4, 1);
        // The newest strokes go first: stroke 5 is withdrawn, stroke 4 still whole.
        expect(world.U.strokes.array[4].z).toBeLessThan(0.1);
        expect(world.U.strokes.array[3].z).toBeGreaterThan(0.9);
        run(world, camera, 5 * 0.35 - 0.35 - 0.05, 1 / 60);
        expect(world.dial).toBeGreaterThan(0);
        run(world, camera, 0.1, 1 / 60);
        expect(world.dial).toBe(0);
        expect(world.U.bow.value.w).toBe(0);
    });

    it('holds the bow four seconds after a break while back-to-back is live', () => {
        const { world, camera } = makeWorld('Low');
        world.onCombo(4);
        run(world, camera, 4);
        frame(world, camera, 1 / 30, () => clear(world, { combo: 4, b2b: true }));
        world.onCombo(0);
        run(world, camera, 3.8);
        expect(world.dial).toBe(4);
        run(world, camera, 0.3 + 4 * 0.35 + 0.1);
        expect(world.dial).toBe(0);
    });
});

/** The shader's smoothstep. */
const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const wrapPi = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

/**
 * The CPU twin of the shader's strokeMask for one stroke (tsl.js): how much of stroke i a
 * direction at φ shows, on the bow itself (no widening), from the rows the world wrote.
 */
function paintedAt(world, i, phi) {
    const rows = world.U.strokes.array;
    const s = rows[i];
    const e = rows[2 * STROKES + i];
    const sense = s.y < s.x ? -1 : 1;
    const along = wrapPi(phi - s.x) * sense;
    return smoothstep(e.x - e.y, e.x + e.y, along) * (1 - smoothstep(e.z - e.w, e.z + e.w, along)) * s.w;
}

describe('Sky Children world: the strokes\' ends and the brush', () => {
    /** The frame's strokes in the world's table order (7 primary, then 5 secondary). */
    const strokeOf = (world, i) => (i < 7 ? world.frame.strokes1[i] : world.frame.strokes2[i - 7]);
    const phiOfEnd = (s, end) => (end ? s.phi1 : s.phi0);

    it('pulls a joint tight once both sides are painted, the two ramps adding up to one across it', () => {
        const { world, camera } = makeWorld('Low');
        world.onCombo(DIAL_MAX);
        run(world, camera, 14);
        expect(world.dial).toBe(DIAL_MAX);
        let joints = 0;
        for (let i = 0; i < STROKES; i++) {
            const s = strokeOf(world, i);
            const base = i < 7 ? 0 : 7;
            const e = world.U.strokes.array[2 * STROKES + i];
            joints += s.joins.filter(Boolean).length;
            [0, 1].forEach((end) => {
                const j = s.joins[end];
                if (!j) return;
                // Tight, and centred on the joint.
                expect(end ? e.w : e.y, `S${i + 1}/${end}`).toBeCloseTo(STROKE_END.tight, 9);
                expect(end ? e.z : e.x, `S${i + 1}/${end}`).toBeCloseTo(end ? Math.abs(s.phi1 - s.phi0) : 0, 9);
                // No seam, no dark tick: the two strokes sum to one all across the joint.
                const at = phiOfEnd(s, end);
                for (let k = -8; k <= 8; k++) {
                    const phi = at + (k / 8) * 3 * STROKE_END.tight;
                    const sum = paintedAt(world, i, phi) + paintedAt(world, base + j.k, phi);
                    expect(sum, `S${i + 1}/${end} at ${k}`).toBeCloseTo(1, 6);
                }
            });
        }
        // The foot's start-to-start joint is among them.
        expect(world.frame.strokes1[0].joins[0]).toEqual({ k: 5, end: 0 });
        expect(joints).toBeGreaterThanOrEqual(8);
    });

    it('brushes out an end in open sky, runs a hidden end on under the card or out of the frame', () => {
        const { world, camera } = makeWorld('Low');
        // One link: stroke 1 laid, its neighbours not yet painted.
        world.onCombo(1);
        run(world, camera, 1.5);
        const e1 = world.U.strokes.array[2 * STROKES];
        const s1 = world.frame.strokes1[0];
        expect(s1.joins[1]).not.toBeNull();
        expect(e1.w).toBeCloseTo(STROKE_END.free, 9);
        expect(e1.y).toBeCloseTo(STROKE_END.free, 9);
        // The brushed end is symmetric about the stroke's end: half the light there.
        expect(paintedAt(world, 0, s1.phi1)).toBeCloseTo(0.5, 6);
        // Unpainted strokes write nothing.
        for (let i = 1; i < STROKES; i++) expect(paintedAt(world, i, strokeOf(world, i).phi0), `S${i + 1}`).toBe(0);
        // The whole chain: an end the card hides runs on under it, an end at the frame out of it,
        // so the bow is whole up to the card's margin and to the frame's edge.
        world.onCombo(7);
        run(world, camera, 8);
        const RUN_ON = [0, STROKE_END.calm, STROKE_END.edge];
        let hidden = 0;
        for (let i = 0; i < 7; i++) {
            const s = strokeOf(world, i);
            const e = world.U.strokes.array[2 * STROKES + i];
            const len = Math.abs(s.phi1 - s.phi0);
            if (!s.joins[1] && s.hides[1]) {
                hidden += 1;
                expect(e.z + e.w, `S${i + 1} end`).toBeCloseTo(len + RUN_ON[s.hides[1]], 9);
                expect(paintedAt(world, i, s.phi1), `S${i + 1} at its end`).toBeGreaterThan(0.99);
            }
            if (!s.joins[0] && s.hides[0]) {
                hidden += 1;
                expect(e.x - e.y, `S${i + 1} start`).toBeCloseTo(-RUN_ON[s.hides[0]], 9);
                expect(paintedAt(world, i, s.phi0), `S${i + 1} at its start`).toBeGreaterThan(0.99);
            }
        }
        expect(hidden).toBeGreaterThanOrEqual(3);
    });

    it('opens a joint as the next brush leaves it: soft until it has covered JOIN_ARC', () => {
        const { world, camera } = makeWorld('Low');
        world.onCombo(1);
        run(world, camera, 1.5);
        world.onCombo(2);
        // Stroke 2 a hair into its painting: its start (joined to stroke 1's end) still soft.
        frame(world, camera, 1 / 60);
        const rows = world.U.strokes.array;
        const len2 = Math.abs(world.frame.strokes1[1].phi1 - world.frame.strokes1[1].phi0);
        expect(rows[1].z * len2).toBeLessThan(JOIN_ARC);
        expect(rows[2 * STROKES + 1].y).toBeGreaterThan(STROKE_END.tight);
        expect(rows[2 * STROKES + 1].y).toBeCloseTo(rows[2 * STROKES].w, 9);
        run(world, camera, 1.2);
        expect(rows[2 * STROKES + 1].y).toBeCloseTo(STROKE_END.tight, 9);
        expect(rows[2 * STROKES].w).toBeCloseTo(STROKE_END.tight, 9);
    });

    it('rides the brush\'s head on the stroke being painted in the link\'s colour, fading HEAD_FADE s after', () => {
        const { world, camera } = makeWorld('Low');
        expect(world.U.bowHead.value.z).toBe(0);
        frame(world, camera, 1 / 30, () => {
            world.noteLink(1, COLORS.Z, 'Z');
            world.onCombo(1);
        });
        run(world, camera, 0.4);
        const head = world.U.bowHead.value;
        const s1 = world.frame.strokes1[0];
        const sense = Math.sign(s1.phi1 - s1.phi0);
        expect(head.z).toBe(1);
        expect(head.w).toBe(sense);
        expect(head.y).toBe(0);
        // Part way along the stroke, where the painted part ends.
        const along = (head.x - s1.phi0) * sense;
        expect(along).toBeGreaterThan(0);
        expect(along).toBeLessThan(Math.abs(s1.phi1 - s1.phi0));
        expect(along).toBeCloseTo(world.U.strokes.array[2 * STROKES].z, 9);
        expect(world.U.bowHeadColour.value.toArray().slice(0, 3)).toEqual(rgbOf(COLORS.Z));
        // Laid: the glint lingers, then is gone.
        run(world, camera, 0.8);
        expect(world.dial).toBe(1);
        const laidAt = world.time;
        run(world, camera, HEAD_FADE * 0.5);
        expect(head.z).toBeGreaterThan(0);
        expect(head.z).toBeLessThan(1);
        run(world, camera, HEAD_FADE - (world.time - laidAt) + 0.1);
        expect(head.z).toBe(0);
        // A break unwinds without a head.
        world.onCombo(0);
        run(world, camera, 0.2);
        expect(head.z).toBe(0);
    });

    it('stands the bow in the Mother Fall\'s spray: the column\'s bearing is the fall\'s, below the horizon', () => {
        const { world } = makeWorld('Low');
        const v = world.U.sprayColumn.value;
        // Elevations: from part way down the fall to under its foot, all below the horizon.
        expect(v.z).toBeLessThan(0);
        expect(v.w).toBeLessThan(v.z);
        // A column (the spray's skirt round the sheet), not a band across the Deep.
        expect(v.y).toBeGreaterThan(0);
        expect(v.y).toBeLessThan(0.2);
        // Left of A, on the bow's leg side (the frame's foot is left of the card).
        const { A } = world.frame;
        expect(v.x).toBeLessThan(Math.atan2(A[0], -A[2]));
    });
});

/** A stroke's on-screen length (frame heights) clear of the cards, the HUD and `layout.hides`. */
function shownLength(f, layout, R, s, samples = 400) {
    const d = [0, 0, 0];
    const p = { x: 0, y: 0, front: false };
    let length = 0;
    let prev = null;
    for (let i = 0; i <= samples; i++) {
        project(bowPoint(f.A, f.basis, R, s.phi0 + ((s.phi1 - s.phi0) * i) / samples, d), f.cam, p);
        const shows = clearOfCalm(p, layout);
        if (shows && prev) length += Math.hypot((p.x - prev.x) * f.cam.aspect, p.y - prev.y);
        prev = shows ? { x: p.x, y: p.y } : null;
    }
    return length;
}

/** A circle's run on screen (frame heights), and how much of it is clear of `layout`'s rects and hides. */
function circleRun(f, layout, R) {
    const d = [0, 0, 0];
    const p = { x: 0, y: 0, front: false };
    let total = 0;
    let shown = 0;
    let prev = null;
    for (let k = 0; k <= 3600; k++) {
        project(bowPoint(f.A, f.basis, R, (k * Math.PI) / 1800, d), f.cam, p);
        const on = p.front && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
        if (on && prev) {
            const step = Math.hypot((p.x - prev.x) * f.cam.aspect, p.y - prev.y);
            total += step;
            if (clearOfCalm(p, layout)) shown += step;
        }
        prev = on ? { x: p.x, y: p.y } : null;
    }
    return { total, clear: shown };
}

describe('Sky Children world: what stands in front of the bow', () => {
    // The Spring Isle, its congestus tower and the overlook's parapet stand in front of much of
    // the secondary (and the leg's far end): the strokes are cut round them, so every link paints
    // an arc the player sees, and the whole of what shows is painted by the full chain.
    it('cuts every stroke where it shows, round the isle, the tower and the parapet', () => {
        for (const [w, h] of [[1600, 900], [1680, 1050], [2560, 1080], [1024, 768]]) {
            const { world } = makeWorld('Low', { width: w, height: h });
            const f = world.frame;
            const hides = world.bowHides(f);
            // The isle, both halves of the parapet and the tower.
            expect(hides.length, `${w}×${h}`).toBe(4);
            const layout = { ...fallbackLayout(w, h), hides };
            for (const [strokes, R, name] of [[f.strokes1, f.R1, 'S'], [f.strokes2, f.R2, 'T']]) {
                let painted = 0;
                strokes.forEach((s, i) => {
                    const shown = shownLength(f, layout, R, s);
                    // Some 55–70 px at least on every screen (the primary's at least MIN_STROKE; at 4:3
                    // the congestus tower and the Spring Isle leave the secondary only about 0.38 of
                    // the frame's height for its five strokes).
                    expect(shown, `${w}×${h} ${name}${i + 1}`).toBeGreaterThan(name === 'S' ? 0.1 : 0.07);
                    painted += shown;
                });
                expect(painted / circleRun(f, layout, R).clear, `${w}×${h} ${name}`).toBeGreaterThan(0.95);
            }
            // The secondary no longer starts behind the isle: its first stroke shows from its start.
            const t1 = f.strokes2[0];
            expect(clearOfCalm(project(bowPoint(f.A, f.basis, f.R2, t1.phi0 + 0.01 * Math.sign(t1.phi1 - t1.phi0), [0, 0, 0]), f.cam), layout)).toBe(true);
        }
    });

    // On a phone the smile hangs in the strip under the card: most of the primary there shows,
    // clear of the card and of the parapet's blocks at the frame's foot.
    it('hangs the phone\'s smile where it shows, clear of the card and the parapet', () => {
        const { world } = makeWorld('Low', { width: 430, height: 932, layout: nominalLayout(430 / 932) });
        const f = world.frame;
        expect(f.plan).toBe('smile');
        const layout = { ...nominalLayout(430 / 932), hides: world.bowHides(f) };
        const run1 = circleRun(f, layout, f.R1);
        expect(run1.clear / run1.total).toBeGreaterThan(0.6);
        f.strokes1.forEach((s, i) => expect(shownLength(f, layout, f.R1, s), `S${i + 1}`).toBeGreaterThan(0.04));
        // The chain's drops are not thinned under the horizon there (the whole smile lies below it).
        expect(world.U.bowDeep.value.x).toBeGreaterThan(0.8);
    });
});

describe('Sky Children world: the hours', () => {
    it('turns the wheel one place on a level up (after turnSeconds), and the clock alone drifts it', () => {
        const idle = makeWorld('Minimal', { at: 20 });
        const level = makeWorld('Minimal', { at: 20 });
        frame(level.world, level.camera, 1 / 30, () => level.world.levelUp(2));
        frame(idle.world, idle.camera, 1 / 30);
        let last = 0;
        run(level.world, level.camera, turnSeconds(1) + 0.1, 1 / 30, (w) => {
            const gap = w.getState().place - idle.world.getState().place;
            expect(gap).toBeGreaterThanOrEqual(last - 1e-9);
            last = gap;
        });
        run(idle.world, idle.camera, turnSeconds(1) + 0.1);
        expect(level.world.getState().place - idle.world.getState().place).toBeCloseTo(1, 6);
        expect(level.world.U.toll.value.y).toBeGreaterThan(0);
        // The clock turns it by itself: one hour every HOUR_SECONDS.
        const early = makeWorld('Minimal', { at: 30 }).world.getState().place;
        const late = makeWorld('Minimal', { at: 30 + HOUR_SECONDS }).world.getState().place;
        expect(late - early).toBeCloseTo(1, 9);
    });

    it('stands on a level at once, with no toll, when told to do it silently', () => {
        const { world, camera } = makeWorld('Minimal', { at: 20 });
        const before = world.getState().place;
        frame(world, camera, 1 / 30, () => world.levelUp(4, { silent: true }));
        expect(world.getState().place - before).toBeCloseTo(3 + 1 / 30 / HOUR_SECONDS, 9);
        expect(world.U.toll.value.y).toBe(0);
    });

    it('runs the wheel forward to the next Jade Morning on a new run, never back, and drains what is held', () => {
        const { world, camera } = makeWorld('Low', { at: 40 });
        frame(world, camera, 1 / 30, () => world.levelUp(3, { silent: true }));
        holdMany(world, camera, 4);
        world.onCombo(3);
        run(world, camera, 3);
        const t1 = world.time;
        const { place } = world.getState();
        expect(place).toBeGreaterThan(2);
        expect(place).toBeLessThan(5);
        world.resetSession();
        expect(heldSlots(world)).toEqual([]);
        let last = place;
        run(world, camera, turnSeconds(5 - place) + 0.2, 1 / 30, (w) => {
            const now = w.getState().place;
            expect(now).toBeGreaterThanOrEqual(last - 1e-12);
            last = now;
        });
        const after = world.getState().place;
        // On the next Jade Morning (a multiple of 5), plus the clock's drift since the reset.
        expect(after - (world.time - t1) / HOUR_SECONDS).toBeCloseTo(5, 9);
        expect(world.getState().hour).toBe(0);
        expect(world.getState().combo).toBe(0);
        expect(world.dial).toBe(0);
    });
});

describe('Sky Children world: the eye and the layout', () => {
    it('keeps the camera still under reduced motion: no breathing, no parallax, no dip; the clock still turns', () => {
        const calm = makeWorld('Minimal', { reduce: true, capture: false, at: 30 });
        const rest = calm.camera.matrixWorld.clone();
        const { place } = calm.world.getState();
        for (let i = 0; i < 300; i++) {
            const pointer = [Math.sin(i * 0.1), Math.cos(i * 0.07)];
            frame(calm.world, calm.camera, 0.1, i === 5 ? () => lock(calm.world, { hardDrop: true }) : null, pointer);
            expect(calm.camera.matrixWorld.equals(rest), `frame ${i}`).toBe(true);
        }
        expect(calm.world.getState().place - place).toBeCloseTo(30 / HOUR_SECONDS, 9);
        // Without it the eye breathes and follows the pointer.
        const live = makeWorld('Minimal', { capture: false, at: 30 });
        const before = live.camera.quaternion.clone();
        frame(live.world, live.camera, 5, null, [1, -1]);
        expect(live.camera.quaternion.angleTo(before)).toBeGreaterThan(0.005);
    });

    it('solves the nominal frame with no layout, and the smile plan on a phone, where a lock still lands', () => {
        const { world } = makeWorld('Low', { layout: null });
        expect(world.getState().plan).toBe('leg');
        expect(world.frame.A).toEqual(frameFor(16 / 9, null, {}).A);
        world.setLayout(null);
        expect(world.getState().plan).toBe('leg');
        const phone = makeWorld('Low', { width: 390, height: 844, layout: null });
        expect(phone.world.getState().plan).toBe('smile');
        expect(phone.camera.fov).toBeCloseTo(fovForAspect(390 / 844), 9);
        // The A is solved behind the card on a phone, the bow a smile below it.
        expect(phone.world.getState().A.x).toBeCloseTo(0.5, 6);
        // With the phone's card on screen a lock still lands and holds.
        phone.world.setLayout(nominalLayout(390 / 844), 390 / 844);
        expect(phone.world.getState().plan).toBe('smile');
        frame(phone.world, phone.camera, 1 / 30, () => lock(phone.world, { u: 0.7 }));
        run(phone.world, phone.camera, 2);
        expect(heldSlots(phone.world)).toHaveLength(1);
        // The stylesheet's phone layout (its stats bar off screen) is a smile too.
        const sheet = makeWorld('Low', { width: 412, height: 915 });
        expect(sheet.world.getState().plan).toBe('smile');
    });

    // FINAL §2.1 "Lock, portrait", §9: the pools a phone uses are on screen, outside the card.
    it('keeps every pool on screen and outside the card on a phone', () => {
        const phone = makeWorld('Low', { width: 390, height: 844, layout: nominalLayout(390 / 844) });
        const { card } = phone.world.cardOf(0);
        const off = phone.world.poolSlots.filter((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1
            || (p.x > card.x0 && p.x < card.x1 && p.y > card.y0 && p.y < card.y1));
        expect(off.map((p) => `${p.isle}@${p.x.toFixed(2)},${p.y.toFixed(2)}`)).toEqual([]);
    });
});

describe('Sky Children world: a long session', () => {
    it('grows nothing over 200 events: rings, pools, tables and light layers stay within their capacity', () => {
        const { world, camera } = makeWorld('Low');
        const sizes = () => ({
            held: world.held.length,
            poolSlots: world.poolSlots.length,
            locks: world.effects.locks.items.length,
            crowns: world.effects.crowns.items.length,
            sheets: world.effects.sheets.items.length,
            packets: world.U.packets.array.length,
            strokes: world.U.strokes.array.length,
            falls: world.U.falls.array.length,
            lamps: world.U.lamps.array.length,
            poses: world.flock.poses.length,
            trails: world.trails.length,
            trailPoints: world.trails.map((t) => t.pts.length),
            links: world.links.length,
            linkShapes: world.linkShapes.length,
            fallCpu: world.fallCpu.length,
            textures: world.textures.length,
            children: world.root.children.length,
        });
        const start = sizes();
        const holdersOf = (w) => [
            w.held, w.poolSlots, w.effects.locks.items, w.U.packets.array, w.flock.poses, w.trails,
        ];
        const holders = holdersOf(world);
        const { glows } = world.parts.fx;
        const { spray } = world.parts;
        // Ten kinds of event in turn: locks (hard, silent), clears (b2b, T-spin), four lines or a
        // perfect clear, a broken chain (and now and then a level).
        const events = [];
        let combo = 0;
        for (let i = 0; i < 200; i++) {
            const kind = i % 10;
            if (kind < 5) {
                const piece = {
                    u: (i * 0.37) % 1,
                    rows: [i % 20],
                    color: Object.values(COLORS)[i % 7],
                    hardDrop: kind === 3,
                    silent: kind === 4,
                };
                events.push(() => lock(world, piece));
            } else if (kind < 8) {
                combo += 1;
                const lines = {
                    lines: 1 + (i % 3), combo, tspin: kind === 7, b2b: kind === 6,
                };
                events.push(() => clear(world, lines));
            } else if (kind === 8) {
                const perfect = i % 40 === 8;
                events.push(() => clear(world, { lines: 4, rows: [19, 18, 17, 16], perfect }));
            } else {
                combo = 0;
                const level = i % 30 === 9 ? 2 + Math.floor(i / 30) : 0;
                events.push(() => {
                    world.onCombo(0);
                    if (level) world.levelUp(level);
                });
            }
        }
        for (const event of events) {
            frame(world, camera, 0.1, event);
            expect(glows.count).toBeLessThanOrEqual(glows.capacity);
            expect(spray.count).toBeLessThanOrEqual(spray.capacity);
            expect(world.U.counts.value.x).toBeLessThanOrEqual(PACKET_SLOTS);
            expect(world.effects.landings.length).toBeLessThanOrEqual(QUALITY.Low.threads);
        }
        run(world, camera, 20, 1 / 10);
        expect(sizes()).toEqual(start);
        holdersOf(world).forEach((holder, k) => expect(holder, `holder ${k}`).toBe(holders[k]));
        expect(world.parts.fx.glows).toBe(glows);
        expect(world.lastLock.size).toBe(1);
    });
});
