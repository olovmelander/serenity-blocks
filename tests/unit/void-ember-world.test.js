/**
 * Void Ember — the world, on the CPU: a real VoidEmberWorld in a THREE.Scene, no renderer.
 *
 * These pin behaviour and contracts — what a lock, a clear, a chain and a new level DO, in what
 * order and how often — never a tuning number: constants are imported, and the assertions are
 * relations (counted, ordered, bounded, monotonic).
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    HEAT_FLARE, REST_RIG, STOKE_MAX, SURGE_COOL, VOID_EMBER_PARTS, VoidEmberWorld, fovForAspect,
} from '../../src/themes/void-ember/void-ember-world.js';
import {
    AMBIENT_LOOPS, COMET_SLOTS, COMET_TAIL, EMBER, ERUPT_LIFE, HUSH_HOLD, IMPACT_SLOTS, LOCK_LOOPS, LOOP_LIFE,
    LOOP_SLOTS, PALETTE_HOME, PALETTE_STEP, REST_HEAT, VOID_PALETTES, WAVE_LIVE, WAVE_SLOTS, emberAnchors,
    heatForCombo, paletteAt, paletteName, palettePlace, pieceColor,
} from '../../src/themes/void-ember/void-ember-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/void-ember/void-ember-quality.js';
import { ROCK_CLASSES } from '../../src/themes/void-ember/void-ember-belt.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from '../../src/themes/void-ember/void-ember-composition.js';
import { VOID_EMBER_TETROMINOS } from '../../src/themes/void-ember/void-ember-tetrominos.js';

const COLORS = VOID_EMBER_TETROMINOS.colors;
const f32 = Math.fround;

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, layout, at = 10,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new VoidEmberWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(layout === undefined ? fallbackLayout(width, height) : layout, aspect);
    settle(world, camera, at);
    return { scene, camera, world };
}

/** The capture's recipe: jump the clock, then draw that moment with the simulation frozen. */
function settle(world, camera, time) {
    world.seek(time);
    const sim = {
        time, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

/**
 * One frame as the theme runs it: the camera (which stamps the clock), the gameplay staged since
 * the last frame, then the world.
 */
function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    for (let i = 0; i < steps; i++) frame(world, camera, seconds / steps);
}

/** Run in small frames until the clock is past `time`. */
function runPast(world, camera, time, margin = 0.05) {
    while (world.time <= time + margin) frame(world, camera, 1 / 60);
}

const lock = (extra = {}) => ({
    player: 0, rows: [12], u: 0.3, hardDrop: false, color: COLORS.J, screen: null, ...extra,
});
const clear = (lines, extra = {}) => ({
    player: 0,
    rows: [19, 18, 17, 16].slice(0, lines),
    lines,
    combo: 1,
    cascade: 1,
    tspin: false,
    perfect: false,
    b2b: false,
    screen: null,
    ...extra,
});

/** A pool's per-instance array. */
const column = (part, name) => part.geometry.getAttribute(name).array;

/** Instances of a pool whose timestamp (component 3 of `name`) is exactly `time`. */
function stamped(part, name, time) {
    const array = column(part, name);
    const out = [];
    for (let i = 0; i < array.length / 4; i++) if (array[i * 4 + 3] === f32(time)) out.push(i);
    return out;
}

/** What is queued, by kind, in the order it will happen. */
const queued = (world, kind) => world.queue.filter((moment) => moment.kind === kind);

/** The board's loops still standing on the star (a loop that is leaving holds nothing). */
function standing(world, time = world.time) {
    const out = [];
    for (let i = 0; i < LOCK_LOOPS; i++) if (world.loops.held(i, time) > 0) out.push(i);
    return out;
}

/** A copy of every loop slot's record. */
const slots = (world, first = 0, last = LOOP_SLOTS) => Array.from({ length: last - first }, (_, i) => {
    const slot = world.loops.slot(first + i);
    return { ...slot, site: [...slot.site], rgb: [...slot.rgb] };
});

/** A world point on screen (fractions, y down). */
function onScreen(camera, x, y, z) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5 };
}

/** Where the comet launched at `time` leaves from, on screen. */
function cometStart(world, camera, time) {
    const [first] = stamped(world.comets, 'aFrom', time);
    const from = column(world.comets, 'aFrom');
    return onScreen(camera, from[first * 4], from[first * 4 + 1], from[first * 4 + 2]);
}

/** The three rows of a wave slot, as plain arrays. */
const waveRows = (world, slot) => [0, 1, 2].map((k) => world.u.waves.array[slot * 3 + k].toArray());

/** Fill the star: one lock a second until every board slot holds a loop. */
function fillStar(world, camera, count = LOCK_LOOPS) {
    const shapes = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
    for (let i = 0; i < count; i++) {
        world.onLock(lock({ u: (i % 10) / 10 + 0.05, rows: [19 - (i % 18)], color: COLORS[shapes[i % 7]] }));
        run(world, camera, 1);
        while (queued(world, 'land').length) frame(world, camera, 1 / 60); // however long a comet flies
    }
}

describe('void ember world: tiers and parts', () => {
    it.each(QUALITY_NAMES)('builds the %s tier with exactly the listed parts, and disposes clean', (quality) => {
        const { scene, world } = makeWorld(quality);
        const tier = QUALITY[quality];
        expect(Object.keys(world.parts).sort()).toEqual([...VOID_EMBER_PARTS].sort());
        expect(scene.children).toEqual([world.root]);
        expect(world.root.children).toHaveLength(VOID_EMBER_PARTS.length);
        // Every part is a mesh on a node material, and every pool is drawn from the first frame
        // (dormant slots collapse; nothing is hidden and shown later).
        for (const name of VOID_EMBER_PARTS) {
            const { mesh } = world.parts[name];
            expect(mesh.isMesh && mesh.visible, name).toBe(true);
            expect(mesh.material.isNodeMaterial && !mesh.material.isShaderMaterial, name).toBe(true);
        }
        ROCK_CLASSES.forEach((cls, i) => expect(world.parts[cls.name].count, cls.name).toBe(tier.rocks[i]));
        expect(world.getState()).toMatchObject({
            quality,
            wind: tier.wind,
            sparks: tier.sparks,
            rocks: tier.rocks[0] + tier.rocks[1] + tier.rocks[2],
            combo: 0,
            level: 1,
            palette: paletteName(palettePlace(0, world.time)),
        });
        // The post's heat haze reads the world's own cloud texture.
        expect(world.noiseTexture.isTexture).toBe(true);

        // Everything it made is let go exactly once.
        const released = [];
        const watch = (thing) => {
            if (thing) released.push(vi.spyOn(thing, 'dispose'));
        };
        Object.values(world.parts).forEach((part) => {
            watch(part.geometry);
            watch(part.material);
            watch(part.extraGeometry);
        });
        world.textures.forEach(watch);
        expect(released.length).toBeGreaterThan(VOID_EMBER_PARTS.length * 2);
        world.dispose();
        world.dispose();
        released.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
        expect(scene.children).toEqual([]);
        expect(world.parts).toEqual({});
        expect(world.disposed).toBe(true);
        expect(world.noiseTexture).toBeNull();
        // A late call from a frame or a bus event that was already on its way is harmless.
        expect(() => {
            world.onLock(lock());
            world.onClear(clear(4));
            world.onCombo(3);
            world.levelUp(2);
            world.resetSession();
            world.update({ time: 99, delta: 1 / 60 });
            world.getState();
        }).not.toThrow();
    });

    it('draws only the named parts, and `rocks` names all three classes of stone', () => {
        const { world } = makeWorld();
        const visible = () => VOID_EMBER_PARTS.filter((name) => world.parts[name].mesh.visible).sort();
        const stones = ROCK_CLASSES.map((cls) => cls.name).sort();
        world.showOnlyParts(['rocks']);
        expect(visible()).toEqual(stones);
        world.showOnlyParts(['star', 'rocks', 'no-such-part']);
        expect(visible()).toEqual([...stones, 'star'].sort());
        world.showOnlyParts([ROCK_CLASSES[0].name, 'sky']);
        expect(visible()).toEqual([ROCK_CLASSES[0].name, 'sky'].sort());
        world.showOnlyParts(VOID_EMBER_PARTS);
        expect(visible()).toEqual([...VOID_EMBER_PARTS].sort());
    });

    it.each([
        ['a wide frame', 1600, 900], ['an ultrawide frame', 2100, 900], ['a square frame', 1000, 1000],
        ['an upright phone', 900, 1950],
    ])('hangs the star and the cinder world where the composition wants them in %s', (_label, width, height) => {
        const { world } = makeWorld('Minimal', { width, height });
        const aspect = width / height;
        const anchors = emberAnchors(aspect);
        const rest = world.restCamera();
        const star = world.u.centre.value;
        const at = onScreen(rest, star.x, star.y, star.z);
        expect(at.x).toBeCloseTo(anchors.x, 6);
        expect(at.y).toBeCloseTo(anchors.y, 6);
        // As large as the composition says: its radius in screen heights.
        const tan = Math.tan((fovForAspect(aspect) * Math.PI) / 360);
        expect(EMBER.radius / (world.distance * 2 * tan)).toBeCloseTo(anchors.radius, 6);
        const cinder = world.u.worldCentre.value;
        const far = onScreen(rest, cinder.x, cinder.y, cinder.z);
        expect(far.x).toBeCloseTo(anchors.world.x, 6);
        expect(far.y).toBeCloseTo(anchors.world.y, 6);
        // What the post is told follows the live camera, which only drifts a little off the rest pose.
        const state = world.getState();
        expect(Math.abs(state.heart.x - anchors.x)).toBeLessThan(0.03);
        expect(Math.abs(state.heart.y - anchors.y)).toBeLessThan(0.03);
        expect(state.heartRadius / anchors.radius).toBeGreaterThan(0.95);
        expect(state.heartRadius / anchors.radius).toBeLessThan(1.05);
        expect(world.getPostState().heart).toBe(world.heart);
    });
});

describe('void ember world: a lock is fuel', () => {
    it('launches one comet and queues its landing; nothing lands before its time', () => {
        const { world, camera } = makeWorld();
        const t0 = world.time;
        world.onLock(lock({ color: COLORS.J }));
        expect(world.counts).toMatchObject({ locks: 1, comets: 1 });
        const [landing, ...others] = queued(world, 'land');
        expect(others).toEqual([]);
        expect(landing.time).toBeGreaterThan(t0);
        // One comet: a head and its tail, all leaving now, in the piece's colour, bound for the site.
        const motes = stamped(world.comets, 'aFrom', t0);
        expect(motes).toHaveLength(COMET_TAIL);
        const to = column(world.comets, 'aTo');
        const tint = column(world.comets, 'aTint');
        const rgb = pieceColor(COLORS.J);
        for (const i of motes) {
            expect(t0 + to[i * 4 + 3]).toBeCloseTo(landing.time, 4); // its flight ends as it lands
            expect([to[i * 4], to[i * 4 + 1], to[i * 4 + 2]]).toEqual(landing.data.site.map(f32));
            expect([tint[i * 4], tint[i * 4 + 1], tint[i * 4 + 2]]).toEqual(rgb.map(f32));
        }
        expect(Math.hypot(...landing.data.site)).toBeCloseTo(1, 6);
        // Until it lands the star shows nothing of it.
        while (world.time + 1 / 60 < landing.time) {
            frame(world, camera, 1 / 60);
            expect(standing(world)).toEqual([]);
            expect(world.getState().impacts).toBe(0);
            expect(stamped(world.sparks, 'aBirth', landing.time)).toEqual([]);
        }
        expect(queued(world, 'land')).toHaveLength(1);

        runPast(world, camera, landing.time);
        expect(queued(world, 'land')).toEqual([]);
        // One more loop, born at the landing's own moment where the comet struck, in its colour.
        const [slot, ...more] = standing(world);
        expect(more).toEqual([]);
        expect(world.loops.slot(slot)).toMatchObject({ birth: landing.time, site: landing.data.site, rgb });
        expect(world.getState().loops).toBeGreaterThanOrEqual(1);
        // One impact on the photosphere, there and then.
        expect(world.getState().impacts).toBe(1);
        const [mark, glow] = world.u.impacts.array;
        expect(mark.toArray()).toEqual([...landing.data.site, landing.time]);
        expect(glow.toArray().slice(0, 3)).toEqual(rgb);
        expect(glow.w).toBeGreaterThan(0);
        // And sparks, thrown from the surface at that moment.
        const sparks = stamped(world.sparks, 'aBirth', landing.time);
        expect(sparks.length).toBeGreaterThan(0);
        expect(sparks.length).toBeLessThan(world.sparks.count / 2);
        const birth = column(world.sparks, 'aBirth');
        const centre = world.u.centre.value;
        for (const i of sparks) {
            const d = Math.hypot(birth[i * 4] - centre.x, birth[i * 4 + 1] - centre.y, birth[i * 4 + 2] - centre.z);
            expect(d).toBeCloseTo(EMBER.radius, 2);
        }
    });

    it('stamps an event with the frame that flushes it, and a landing with its own moment', () => {
        const { world, camera } = makeWorld();
        const t0 = world.time;
        // The theme flushes between updateCamera() and update(): the event belongs to this frame.
        frame(world, camera, 1 / 60, () => world.onLock(lock()));
        const t1 = t0 + 1 / 60;
        expect(stamped(world.comets, 'aFrom', t1)).toHaveLength(COMET_TAIL);
        expect(stamped(world.comets, 'aFrom', t0)).toEqual([]);
        const [landing] = queued(world, 'land');
        // A long frame that overshoots the landing still raises the loop AT the landing.
        frame(world, camera, 0.05);
        while (world.time < landing.time) frame(world, camera, 0.05);
        expect(world.time).toBeGreaterThan(landing.time);
        const [slot] = standing(world);
        expect(world.loops.slot(slot).birth).toBe(landing.time);
        expect(world.u.impacts.array[0].w).toBe(landing.time);
    });

    it('a hard drop throws three comets and raises three loops', () => {
        const { world, camera } = makeWorld();
        const t0 = world.time;
        world.onLock(lock({ hardDrop: true, color: COLORS.S }));
        expect(world.counts).toMatchObject({ locks: 1, comets: 3 });
        expect(stamped(world.comets, 'aFrom', t0)).toHaveLength(3 * COMET_TAIL);
        const landings = queued(world, 'land');
        expect(landings).toHaveLength(3);
        // Three different places on the star.
        const sites = landings.map((landing) => landing.data.site.map((v) => v.toFixed(4)).join());
        expect(new Set(sites).size).toBe(3);
        runPast(world, camera, Math.max(...landings.map((landing) => landing.time)));
        expect(standing(world)).toHaveLength(3);
        expect(world.getState().impacts).toBe(3);
        const rgb = pieceColor(COLORS.S);
        standing(world).forEach((slot) => expect(world.loops.slot(slot).rgb).toEqual(rgb));
        // It hits harder than a plain lock: one of the three is the heavy one.
        const plain = makeWorld();
        plain.world.onLock(lock());
        const amounts = landings.map((landing) => landing.data.amount);
        expect(Math.max(...amounts)).toBeGreaterThan(queued(plain.world, 'land')[0].data.amount);
        expect(world.stoke).toBeGreaterThan(plain.world.stoke);
    });

    it('two locks a tenth of a second apart raise two loops', () => {
        const { world, camera } = makeWorld();
        world.onLock(lock({ u: 0.2, color: COLORS.T }));
        run(world, camera, 0.1);
        expect(standing(world)).toEqual([]); // the first comet is still in flight
        world.onLock(lock({ u: 0.8, color: COLORS.Z }));
        runPast(world, camera, Math.max(...queued(world, 'land').map((landing) => landing.time)));
        const loops = standing(world).map((slot) => world.loops.slot(slot).rgb);
        expect(loops).toHaveLength(2);
        expect(loops).toEqual(expect.arrayContaining([pieceColor(COLORS.T), pieceColor(COLORS.Z)]));
    });

    it('two locks flushed in the same frame land as two loops, even when they land together', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 1 / 60, () => {
            world.onLock(lock({ u: 0.4, player: 1 }));
            world.onLock(lock({ u: 0.4, player: 2 }));
        });
        expect(world.counts).toMatchObject({ locks: 2, comets: 2 });
        // One long frame swallows both landings: both happen.
        frame(world, camera, 0.05);
        while (queued(world, 'land').length) frame(world, camera, 0.05);
        expect(standing(world)).toHaveLength(2);
        expect(world.getState().impacts).toBe(2);
    });

    it('the lock after a full star replaces the weakest loop and no other', () => {
        const { world, camera } = makeWorld();
        fillStar(world, camera);
        expect(standing(world)).toHaveLength(LOCK_LOOPS);
        const before = slots(world, 0, LOCK_LOOPS);
        const held = before.map((_, i) => world.loops.held(i, world.time));
        const weakest = held.indexOf(Math.min(...held));
        // The oldest loop holds the least: the light burns off.
        expect(before[weakest].birth).toBe(Math.min(...before.map((slot) => slot.birth)));

        world.onLock(lock({ color: '#123456' }));
        runPast(world, camera, queued(world, 'land')[0].time);
        const after = slots(world, 0, LOCK_LOOPS);
        const changed = after.map((slot, i) => (slot.birth === before[i].birth ? -1 : i)).filter((i) => i >= 0);
        expect(changed).toEqual([weakest]);
        expect(after[weakest].rgb).toEqual(pieceColor('#123456'));
        expect(standing(world)).toHaveLength(LOCK_LOOPS);
    });

    it('a hard drop on a full star replaces its three weakest loops, never one it has just raised', () => {
        const { world, camera } = makeWorld();
        fillStar(world, camera);
        const before = slots(world, 0, LOCK_LOOPS);
        const oldest = before.map((slot, i) => [slot.birth, i]).sort((a, b) => a[0] - b[0]).slice(0, 3)
            .map(([, i]) => i)
            .sort((a, b) => a - b);
        world.onLock(lock({ hardDrop: true, color: '#abcdef' }));
        runPast(world, camera, Math.max(...queued(world, 'land').map((landing) => landing.time)));
        const after = slots(world, 0, LOCK_LOOPS);
        const changed = after.map((slot, i) => (slot.birth === before[i].birth ? -1 : i)).filter((i) => i >= 0);
        expect(changed).toEqual(oldest);
        expect(standing(world)).toHaveLength(LOCK_LOOPS);
    });

    it('every lock stokes the ember a little, never past STOKE_MAX, and the stoking fades', () => {
        const { world, camera } = makeWorld();
        world.onLock(lock());
        const one = world.stoke;
        expect(one).toBeGreaterThan(0);
        expect(one).toBeLessThan(STOKE_MAX);
        for (let i = 0; i < 40; i++) {
            world.onLock(lock({ hardDrop: i % 2 === 0, u: (i % 10) / 10 }));
            expect(world.stoke).toBeLessThanOrEqual(STOKE_MAX);
        }
        expect(world.stoke).toBeCloseTo(STOKE_MAX, 9);
        // Stoking alone warms the ember by no more than that.
        let hottest = 0;
        for (let i = 0; i < 240; i++) {
            frame(world, camera, 1 / 60);
            hottest = Math.max(hottest, world.heat);
            expect(world.stoke).toBeLessThanOrEqual(STOKE_MAX);
        }
        expect(hottest).toBeGreaterThan(REST_HEAT);
        expect(hottest).toBeLessThanOrEqual(REST_HEAT + STOKE_MAX + 1e-9);
        run(world, camera, 90, 900);
        expect(world.stoke).toBeLessThan(one / 10);
        expect(world.heat).toBeCloseTo(REST_HEAT, 2);
    });

    it('reduced motion shortens the comet\'s flight and still raises the loop', () => {
        const usual = makeWorld();
        usual.world.onLock(lock());
        const flight = queued(usual.world, 'land')[0].time - usual.world.time;

        const { world, camera } = makeWorld();
        world.setReducedMotion(true);
        const t0 = world.time;
        world.onLock(lock());
        const [landing] = queued(world, 'land');
        expect(landing.time - t0).toBeGreaterThan(0);
        expect(landing.time - t0).toBeLessThan(flight);
        runPast(world, camera, landing.time);
        expect(standing(world)).toHaveLength(1);
        expect(world.getState().impacts).toBe(1);
        // The view stands still: no drift, no kick.
        expect(camera.position.toArray()).toEqual([0, 0, 0]);
        expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 9);
    });
});

describe('void ember world: a clear makes the star let go', () => {
    it('tears off every held loop, sheds each as sparks at its own moment, and spares the comet in flight', () => {
        const { world, camera } = makeWorld();
        fillStar(world, camera, 5);
        const held = slots(world, 0, LOCK_LOOPS).filter((slot) => slot.strength > 0);
        expect(held).toHaveLength(5);
        const t = world.time;
        // The piece that completes the lines locks in the same tick: its comet has only just left.
        world.onLock(lock({ color: COLORS.S }));
        world.onClear(clear(2));
        expect(world.counts).toMatchObject({ clears: 1, eruptions: 5, quads: 0 });
        expect(queued(world, 'land')).toHaveLength(1);
        // One shedding per torn loop, each at the moment its loop leaves, one after another.
        const sheds = queued(world, 'shed');
        expect(sheds).toHaveLength(5);
        sheds.forEach((shed, i) => {
            expect(shed.time).toBeGreaterThanOrEqual(t);
            if (i > 0) expect(shed.time).toBeGreaterThan(sheds[i - 1].time);
            expect(shed.data.n).toBeGreaterThan(0);
        });
        const leaving = slots(world, 0, LOCK_LOOPS).filter((slot) => slot.strength > 0);
        expect(leaving.map((slot) => slot.erupt).sort()).toEqual(sheds.map((shed) => shed.time).sort());
        expect(sheds.map((shed) => shed.data.site)).toEqual(expect.arrayContaining(held.map((slot) => slot.site)));
        expect(sheds.map((shed) => shed.data.rgb)).toEqual(expect.arrayContaining(held.map((slot) => slot.rgb)));
        // A loop holds its light until the moment it leaves, and nothing from then on: the first
        // goes with the wave, the others are still the star's for an instant.
        const last = sheds[sheds.length - 1].time;
        for (let i = 0; i < LOCK_LOOPS; i++) {
            const { strength, erupt } = world.loops.slot(i);
            if (strength > 0) {
                expect(world.loops.held(i, erupt - 1e-6)).toBeGreaterThan(0);
                expect(world.loops.held(i, erupt)).toBe(0);
            }
        }
        expect(standing(world, t)).toHaveLength(4);
        expect(standing(world, last)).toEqual([]);
        // No spark before its loop leaves.
        sheds.forEach((shed) => expect(stamped(world.sparks, 'aBirth', shed.time)).toEqual([]));

        const landing = queued(world, 'land')[0];
        runPast(world, camera, Math.max(landing.time, sheds[sheds.length - 1].time));
        expect(queued(world, 'shed')).toEqual([]);
        sheds.forEach((shed) => {
            expect(stamped(world.sparks, 'aBirth', shed.time)).toHaveLength(Math.round(shed.data.n));
        });
        // The clearing piece's own loop rose after the wave had left, and stands.
        const [slot, ...more] = standing(world);
        expect(more).toEqual([]);
        expect(world.loops.slot(slot)).toMatchObject({ birth: landing.time, rgb: pieceColor(COLORS.S) });
        expect(world.counts.eruptions).toBe(5);
    });

    it('a landing takes a free slot before any loop that is leaving', () => {
        const { world, camera } = makeWorld();
        fillStar(world, camera, 10);
        world.onLock(lock({ color: COLORS.S }));
        world.onClear(clear(1));
        const leaving = slots(world, 0, LOCK_LOOPS).map((slot, i) => (slot.strength > 0 ? i : -1))
            .filter((i) => i >= 0);
        expect(leaving).toHaveLength(10);
        const erupt = leaving.map((i) => world.loops.slot(i).erupt);
        // The clearing piece's comet lands, then the next piece's: both while the arcs are in the sky.
        runPast(world, camera, queued(world, 'land')[0].time);
        world.onLock(lock({ color: COLORS.L }));
        const second = queued(world, 'land')[0].time;
        expect(second - Math.min(...erupt)).toBeLessThan(ERUPT_LIFE);
        runPast(world, camera, second);
        const risen = standing(world);
        expect(risen).toHaveLength(2);
        risen.forEach((slot) => expect(leaving).not.toContain(slot));
        expect(leaving.map((i) => world.loops.slot(i).erupt)).toEqual(erupt);
    });

    it('while a full star\'s loops are leaving, each landing takes an arc\'s slot: a loop just raised is kept', () => {
        const { world, camera } = makeWorld();
        fillStar(world, camera);
        world.onLock(lock({ color: COLORS.S }));
        world.onClear(clear(1));
        expect(world.counts.eruptions).toBe(LOCK_LOOPS);
        const left = slots(world, 0, LOCK_LOOPS).map((slot) => slot.erupt);
        // Two more pieces, each locking as the one before lands, while arcs are still in the sky.
        const colours = [COLORS.S, COLORS.L, COLORS.Z];
        for (let i = 0; i < colours.length; i++) {
            const landing = queued(world, 'land')[0].time;
            expect(landing - Math.max(...left)).toBeLessThan(ERUPT_LIFE);
            runPast(world, camera, landing, 0.01);
            if (i + 1 < colours.length) world.onLock(lock({ color: colours[i + 1], u: 0.2 + 0.2 * i }));
        }
        runPast(world, camera, Math.max(...left));
        // All three stand, each in its own slot: no landing replaced a loop that had just risen.
        const up = standing(world);
        expect(up.map((slot) => world.loops.slot(slot).rgb)).toEqual(
            expect.arrayContaining(colours.map((hex) => pieceColor(hex))),
        );
        expect(up).toHaveLength(colours.length);
        // What gave way were arcs: the loops torn off first.
        const gaveWay = up.map((slot) => left[slot]).sort((a, b) => a - b);
        expect(gaveWay[gaveWay.length - 1]).toBeLessThan(Math.max(...left));
    });

    // On a full star the clearing piece's own comet lands inside the clear's stagger. A loop the
    // clear has promised to the wave (its lift-off a fraction of a second away) is not free: the
    // landing takes the slot of an arc that is already leaving, so every promised loop still flies.
    it('a loop the clear has promised to the wave still leaves: the landing takes an arc, not its slot', () => {
        const { world, camera } = makeWorld();
        fillStar(world, camera, 30); // fed for a while: the slots are no longer in order of age
        frame(world, camera, 1 / 60, () => {
            world.onLock(lock({ color: COLORS.S }));
            world.onClear(clear(1));
        });
        const due = slots(world, 0, LOCK_LOOPS).map((slot) => slot.erupt);
        const landing = queued(world, 'land')[0].time;
        // The scene the doubt is about: the comet lands while some loops are still waiting to leave.
        expect(due.some((moment) => moment > landing)).toBe(true);
        expect(due.some((moment) => moment <= landing)).toBe(true);
        runPast(world, camera, Math.max(...due));
        const [mine] = standing(world);
        expect(world.loops.slot(mine).rgb).toEqual(pieceColor(COLORS.S));
        expect(due[mine]).toBeLessThanOrEqual(landing); // it took the slot of an arc that had left
    });

    it('a hard drop and its own four-line clear in one frame: its loops stand after the flare', () => {
        for (const reduced of [false, true]) {
            const { world, camera } = makeWorld();
            world.setReducedMotion(reduced);
            fillStar(world, camera); // the hardest case: no slot is free
            frame(world, camera, 1 / 60, () => {
                world.onLock(lock({ hardDrop: true, color: COLORS.S }));
                world.onClear(clear(4));
                world.onCombo(1);
            });
            expect(world.counts).toMatchObject({ quads: 1, comets: LOCK_LOOPS + 3 });
            // (As the timings stand, the comets land after the flare in full motion and inside the
            // hush with reduced motion: both orders are played.)
            const landings = queued(world, 'land').map((moment) => moment.time);
            expect(landings).toHaveLength(3);
            const sheds = queued(world, 'shed').map((moment) => moment.time);
            runPast(world, camera, Math.max(...landings, ...sheds), 0.3);
            expect(world.surge).toBeGreaterThan(0); // the flare has happened
            // Its three loops stand, in the piece's colour, and nothing else does.
            const up = standing(world);
            expect(up.map((slot) => world.loops.slot(slot).rgb)).toEqual(Array(3).fill(pieceColor(COLORS.S)));
            // None of them was caught by the clear: they still hold their light seconds later.
            up.forEach((slot) => expect(world.loops.held(slot, world.time + ERUPT_LIFE * 3)).toBeGreaterThan(0));
            expect(queued(world, 'land')).toEqual([]);
        }
    });

    it.each([1, 2, 3, 4])('writes the wave of a %i-line clear: birth, fronts, colour, cover, direction', (lines) => {
        const { world, camera } = makeWorld();
        fillStar(world, camera, 3);
        const t = world.time;
        const slot = world.waveCursor % WAVE_SLOTS;
        world.onClear(clear(lines));
        const [a, b, c] = waveRows(world, slot);
        // (birth, strength, fronts, shell thickness)
        expect(a[0]).toBeCloseTo(lines === 4 ? t + HUSH_HOLD : t, 9);
        expect(a[1]).toBeGreaterThan(0);
        expect(a[2]).toBe(lines);
        expect(a[3]).toBeGreaterThan(0);
        // (colour, how much of the circle the shell covers)
        expect(Math.max(b[0], b[1], b[2])).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.min(b[0], b[1], b[2])).toBeGreaterThan(0);
        expect(b[3]).toBeGreaterThan(0);
        expect(b[3]).toBeLessThanOrEqual(1);
        if (lines === 4) expect(b[3]).toBe(1);
        // (the way it leaves, a unit vector in the corona's plane): toward the board.
        expect(Math.hypot(c[0], c[1])).toBeCloseTo(1, 9);
        const card = cardUnion(world.layout);
        expect(c[0] * ((card.x0 + card.x1) / 2 - world.heart.x)).toBeGreaterThan(0);
        // Only that slot was written.
        for (let other = 0; other < WAVE_SLOTS; other++) {
            if (other !== slot) expect(waveRows(world, other)[0][1], `slot ${other}`).toBe(0);
        }
        expect(world.getState().wavesLive).toBe(0); // counted on the next frame
        frame(world, camera, 1 / 60);
        expect(world.getState().wavesLive).toBeGreaterThan(0);
    });

    it('a wider clear sends a stronger wave over more of the circle; a perfect clear counts as four lines', () => {
        const waves = [1, 2, 3, 4].map((lines) => {
            const { world, camera } = makeWorld();
            fillStar(world, camera, 3);
            world.onClear(clear(lines));
            return waveRows(world, 0);
        });
        for (let i = 1; i < waves.length; i++) {
            expect(waves[i][0][1]).toBeGreaterThan(waves[i - 1][0][1]); // strength
            expect(waves[i][1][3]).toBeGreaterThan(waves[i - 1][1][3]); // cover
        }
        const { world } = makeWorld();
        world.onClear(clear(1, { perfect: true }));
        const [a, b] = waveRows(world, 0);
        expect(a[2]).toBe(4);
        expect(b[3]).toBe(1);
        expect(world.counts.quads).toBe(1);
        // Clears take the wave slots in turn.
        const ring = makeWorld();
        for (let i = 0; i < WAVE_SLOTS + 1; i++) {
            const slot = ring.world.waveCursor % WAVE_SLOTS;
            expect(slot).toBe(i % WAVE_SLOTS);
            run(ring.world, ring.camera, 0.5);
            ring.world.onClear(clear(1));
            expect(waveRows(ring.world, slot)[0][0]).toBe(ring.world.time);
        }
    });

    it('a wave is the star\'s own fire with a breath of what it tore off; a flare is the same whatever it tore', () => {
        // Two stars fed alike but for the colour of the pieces: the same heat, different loops.
        const fed = (color, lines) => {
            const { world, camera } = makeWorld();
            for (let i = 0; i < 6; i++) {
                world.onLock(lock({ color, u: 0.1 + 0.15 * i }));
                run(world, camera, 1);
            }
            expect(standing(world)).toHaveLength(6);
            world.onClear(clear(lines));
            return waveRows(world, 0)[1].slice(0, 3);
        };
        const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const teal = pieceColor(COLORS.J);
        const crimson = pieceColor(COLORS.S);
        const tealWave = fed(COLORS.J, 2);
        const crimsonWave = fed(COLORS.S, 2);
        // Each wave leans toward what its star was holding...
        expect(tealWave[1]).toBeGreaterThan(crimsonWave[1]);
        expect(tealWave[2]).toBeGreaterThan(crimsonWave[2]);
        expect(apart(tealWave, crimsonWave)).toBeGreaterThan(0.02);
        // ...but stays the star's own fire: the two differ far less than the pieces do.
        expect(apart(tealWave, crimsonWave)).toBeLessThan(apart(teal, crimson) / 2);
        expect(tealWave[0]).toBeGreaterThan(tealWave[2]);
        // Four lines flare in the nova's own colour, whatever was on the star.
        expect(fed(COLORS.J, 4)).toEqual(fed(COLORS.S, 4));
    });

    it('the cleared rows leave the live card as blades of light, at their own heights', () => {
        const { world } = makeWorld();
        const { frame: beam, rows, color } = world.beams.uniforms;
        expect(beam.value.w).toBe(0);
        const t = world.time;
        world.onClear(clear(3, { rows: [19, 12, 5] }));
        const card = cardUnion(world.layout);
        const board = boardFor(world.layout, 0);
        expect(beam.value.toArray().slice(0, 3)).toEqual([card.x0, card.x1, t]);
        expect(beam.value.w).toBeGreaterThan(0);
        expect(rows.value.toArray()).toEqual([
            boardPoint(board, 0.5, 19).y, boardPoint(board, 0.5, 12).y, boardPoint(board, 0.5, 5).y, -1,
        ]);
        expect(Math.max(...color.value.toArray())).toBeLessThanOrEqual(1 + 1e-9);
        // A clear that names no rows fires the bottom ones.
        world.onClear(clear(2, { rows: null }));
        expect(rows.value.toArray()).toEqual([boardPoint(board, 0.5, 19).y, boardPoint(board, 0.5, 18).y, -1, -1]);
    });

    it('four lines: the ember holds its breath, then flares at the wave\'s birth', () => {
        const { world, camera } = makeWorld();
        fillStar(world, camera, 4);
        const t = world.time;
        const slot = world.waveCursor % WAVE_SLOTS;
        world.onClear(clear(4));
        expect(world.counts).toMatchObject({ quads: 1, clears: 1 });
        // Every loop is torn off at once: the board's four, and the star's own that still burn.
        expect(world.counts.eruptions).toBeGreaterThan(4);
        expect(world.counts.eruptions).toBeLessThanOrEqual(4 + AMBIENT_LOOPS);
        const birth = waveRows(world, slot)[0][0];
        expect(birth).toBeCloseTo(t + HUSH_HOLD, 9);
        // They leave with the flare, one after another: until then the star still holds them...
        const board = slots(world, 0, LOCK_LOOPS).filter((entry) => entry.strength > 0);
        expect(board).toHaveLength(4);
        board.forEach((entry) => expect(entry.erupt).toBeGreaterThanOrEqual(birth));
        expect(world.loops.litCount(t)).toBeGreaterThanOrEqual(4);
        expect(standing(world, t)).toHaveLength(4);
        // ...and once the last has gone, nothing on the star is lit.
        const due = slots(world).filter((entry) => entry.strength > 0 && entry.erupt < birth + 60);
        const lastGone = Math.max(...due.map((entry) => entry.erupt));
        expect(world.loops.litCount(lastGone)).toBe(0);
        expect(standing(world, lastGone)).toEqual([]);
        expect(queued(world, 'surge').map((moment) => moment.time)).toEqual([birth]);
        // The hush: every light sinks, and nothing flares yet.
        let { breath } = world;
        expect(breath).toBeCloseTo(1, 2);
        while (world.time + 1 / 120 < birth) {
            frame(world, camera, 1 / 120);
            expect(world.breath).toBeLessThan(breath);
            ({ breath } = world);
            expect(world.surge).toBe(0);
            expect(world.u.breath.value).toBe(world.breath);
        }
        expect(breath).toBeLessThan(0.5);
        // The flare, on the first frame that reaches the birth.
        frame(world, camera, 1 / 60);
        expect(world.time).toBeGreaterThanOrEqual(birth);
        expect(world.surge).toBeGreaterThan(0.5);
        expect(queued(world, 'surge')).toEqual([]);
        const peak = world.surge;
        run(world, camera, 0.6);
        expect(world.breath).toBeGreaterThan(0.9); // the lights are back
        expect(world.heat).toBeGreaterThan(REST_HEAT);
        expect(world.surge).toBeLessThan(peak);
        run(world, camera, SURGE_COOL * 6);
        expect(world.surge).toBeLessThan(peak / 100);
        expect(world.getState().surge).toBe(world.surge);
    });

    it('a flare noticed late is as old as it is, not new', () => {
        const smooth = makeWorld();
        smooth.world.onClear(clear(4));
        run(smooth.world, smooth.camera, 1);
        const late = makeWorld();
        late.world.onClear(clear(4));
        // One long stall right across the birth.
        run(late.world, late.camera, 1, 2);
        expect(late.world.surge).toBeCloseTo(smooth.world.surge, 6);
    });

    it('never heats the ember past HEAT_FLARE, whatever the board does', () => {
        const { world, camera } = makeWorld();
        world.onCombo(40);
        let hottest = 0;
        for (let i = 0; i < 720; i++) {
            if (i % 20 === 0) world.onLock(lock({ hardDrop: true, u: (i % 200) / 200 }));
            if (i % 120 === 30) world.onClear(clear(4, { perfect: true }));
            frame(world, camera, 1 / 60);
            hottest = Math.max(hottest, world.heat);
            expect(world.u.heat.value).toBe(world.heat);
        }
        expect(hottest).toBeGreaterThan(heatForCombo(40));
        expect(hottest).toBeLessThanOrEqual(HEAT_FLARE + 1e-9);
    });

    it('a T-spin winds the corona up and it springs back', () => {
        const { world, camera } = makeWorld();
        expect(world.twist).toBe(0);
        world.onClear(clear(2, { tspin: true }));
        let widest = 0;
        for (let i = 0; i < 60; i++) {
            frame(world, camera, 1 / 60);
            widest = Math.max(widest, Math.abs(world.twist));
            expect(world.u.twist.value).toBe(world.twist);
        }
        expect(widest).toBeGreaterThan(0.01);
        run(world, camera, 12);
        expect(Math.abs(world.twist)).toBeLessThan(widest / 100);
        // A long stall cannot blow the spring up.
        world.onClear(clear(2, { tspin: true }));
        run(world, camera, 5, 5);
        expect(Number.isFinite(world.twist)).toBe(true);
        expect(Math.abs(world.twist)).toBeLessThan(widest * 4);
    });

    it('a clear\'s kick is not lost to the lock that follows it', () => {
        const peak = (script) => {
            const { world, camera } = makeWorld();
            world.onClear(clear(4));
            let most = 0;
            for (let i = 0; i < 90; i++) {
                frame(world, camera, 1 / 60, () => script(world, i));
                most = Math.max(most, world.getPostState().kick);
            }
            return most;
        };
        const alone = peak(() => {});
        expect(alone).toBeGreaterThan(0);
        // A lock inside the hush, and another right after it.
        const followed = peak((world, i) => {
            if (i === 6 || i === 12) world.onLock(lock());
        });
        expect(followed).toBeGreaterThanOrEqual(alone);
    });

    it('a ripple through the picture gives way only to a stronger one', () => {
        const { world, camera } = makeWorld();
        world.onClear(clear(4));
        const great = { ...world.spaceRipple };
        expect(great.strength).toBeGreaterThan(0);
        expect(great.birth).toBeGreaterThan(world.time);
        expect(world.getPostState().ripple.strength).toBe(0);
        // A T-spin inside the hush sends a lesser ring: the great one stays on its way.
        run(world, camera, HUSH_HOLD / 2);
        world.onClear(clear(2, { tspin: true }));
        expect(world.spaceRipple).toEqual(great);
        // It leaves the star at its birth and runs outward.
        runPast(world, camera, great.birth, 0.1);
        const ripple = { ...world.getPostState().ripple };
        expect(ripple.strength).toBeGreaterThan(0);
        expect(ripple.radius).toBeGreaterThan(0);
        run(world, camera, 0.2);
        expect(world.getPostState().ripple.radius).toBeGreaterThan(ripple.radius);
        // Reduced motion keeps the event and takes most of the bend away.
        const calm = makeWorld();
        calm.world.setReducedMotion(true);
        calm.world.onClear(clear(4));
        expect(calm.world.spaceRipple.strength).toBeGreaterThan(0);
        expect(calm.world.spaceRipple.strength).toBeLessThan(great.strength);
    });
});

describe('void ember world: chains and levels', () => {
    it('a chain blows the ember up toward heatForCombo, and it cools when the chain breaks', () => {
        const { world, camera } = makeWorld();
        expect(world.heat).toBeCloseTo(REST_HEAT, 9);
        const rest = world.getPostState().exposure;
        world.onCombo(5);
        let { heat } = world;
        for (let i = 0; i < 40; i++) {
            run(world, camera, 0.25);
            expect(world.heat).toBeGreaterThanOrEqual(heat);
            ({ heat } = world);
        }
        expect(heat).toBeGreaterThan(heatForCombo(4));
        expect(Math.abs(heat - heatForCombo(5))).toBeLessThan(0.02);
        // The iris closes as the ember heats, so its colours survive.
        expect(world.getPostState().exposure).toBeLessThan(rest);
        expect(world.u.iris.value).toBeGreaterThan(1);
        world.onCombo(12);
        run(world, camera, 10);
        expect(Math.abs(world.heat - heatForCombo(12))).toBeLessThan(0.02);
        expect(world.getState().combo).toBe(12);

        world.onCombo(0);
        ({ heat } = world);
        for (let i = 0; i < 80; i++) {
            run(world, camera, 0.5, 10);
            expect(world.heat).toBeLessThanOrEqual(heat);
            ({ heat } = world);
        }
        expect(Math.abs(heat - REST_HEAT)).toBeLessThan(0.02);
        expect(world.getPostState().exposure).toBeCloseTo(rest, 1);
        // Nonsense is no chain.
        world.onCombo(NaN);
        expect(world.combo).toBe(0);
        world.onCombo(-3);
        expect(world.combo).toBe(0);
    });

    it('each further step of a chain blows on the ember: one more mark on its face, there and then', () => {
        const { world, camera } = makeWorld();
        const marks = () => world.u.impactCount.value;
        world.onCombo(1); // a first clear is not a chain yet
        expect(marks()).toBe(0);
        frame(world, camera, 1 / 60);
        const t = world.time;
        world.onCombo(2);
        expect(marks()).toBe(1);
        const [site, glow] = world.u.impacts.array;
        expect(site.w).toBe(t);
        expect(Math.hypot(site.x, site.y, site.z)).toBeCloseTo(1, 9);
        expect(glow.w).toBeGreaterThan(0);
        expect(Math.max(glow.x, glow.y, glow.z)).toBeLessThanOrEqual(1 + 1e-9);
        // On the side of the star that faces the camera.
        const centre = world.u.centre.value;
        const out = world.siteWorld([site.x, site.y, site.z]).clone().sub(centre).normalize();
        expect(out.dot(camera.position.clone().sub(centre).normalize())).toBeGreaterThan(0.1);
        // The same step again is no new breath; the next one is; a broken chain is none.
        world.onCombo(2);
        expect(marks()).toBe(1);
        world.onCombo(3);
        expect(marks()).toBe(2);
        world.onCombo(0);
        expect(marks()).toBe(2);
        frame(world, camera, 1 / 60);
        expect(world.getState().impacts).toBe(2);
    });

    it('a new level moves the void one palette along and sends a cold ring; a silent one only the palette', () => {
        const { world, camera } = makeWorld();
        const slot = world.waveCursor % WAVE_SLOTS;
        const t = world.time;
        const before = world.getState().palette;
        world.levelUp(2);
        expect(world.getState().level).toBe(2);
        // A whole ring, leaving now.
        const [a, b] = waveRows(world, slot);
        expect(a[0]).toBe(t);
        expect(a[1]).toBeGreaterThan(0);
        expect(b[3]).toBe(1);
        expect(world.flash).toBeGreaterThan(0);
        // The void's PLACE eases over: not there on the next frame, there a while later.
        frame(world, camera, 1 / 60);
        const sky = () => world.u.voidCol.value.toArray();
        expect(sky()).not.toEqual(paletteAt(palettePlace(1, world.time)).void);
        run(world, camera, 20, 200);
        const settled = paletteAt(palettePlace(1, world.time));
        sky().forEach((v, i) => expect(v).toBeCloseTo(settled.void[i], 9));
        expect(world.levelPlace).toBe(1);
        expect(world.getState().palette).toBe(paletteName(palettePlace(1, world.time)));
        expect(world.getState().palette).not.toBe(before);

        const silent = makeWorld();
        silent.world.levelUp(3, { silent: true });
        expect(silent.world.getState()).toMatchObject({
            level: 3, palette: paletteName(palettePlace(2, silent.world.time)),
        });
        for (let i = 0; i < WAVE_SLOTS; i++) expect(waveRows(silent.world, i)[0][1]).toBe(0);
        expect(silent.world.flash).toBe(0);
        frame(silent.world, silent.camera, 1 / 60);
        const there = paletteAt(palettePlace(2, silent.world.time));
        expect(silent.world.u.voidCol.value.toArray()).toEqual(there.void);
        expect(silent.world.u.dustA.value.toArray()).toEqual(there.dustA);
        // Nonsense is level one.
        silent.world.levelUp(NaN, { silent: true });
        expect(silent.world.getState()).toMatchObject({
            level: 1, palette: paletteName(palettePlace(0, silent.world.time)),
        });
    });

    it('the void drifts by itself: a palette step on the clock, with no level change', () => {
        const { world, camera } = makeWorld();
        const names = [];
        for (let step = 0; step <= 8; step++) {
            world.seek(step * PALETTE_STEP + 1);
            frame(world, camera, 0);
            expect(world.getState()).toMatchObject({ level: 1 });
            names.push(world.getState().palette);
            // On the step itself the void rests on one palette.
            expect(world.getState().paletteMix === 0 || world.getState().paletteMix === 1).toBe(true);
        }
        // There and back along the hue-ordered line, starting from home: every palette is seen,
        // and each step lands on a neighbour.
        expect(names[0]).toBe(VOID_PALETTES[PALETTE_HOME].name);
        expect(new Set(names).size).toBe(VOID_PALETTES.length);
        const at = (name) => VOID_PALETTES.findIndex((palette) => palette.name === name);
        for (let i = 1; i < names.length; i++) expect(Math.abs(at(names[i]) - at(names[i - 1]))).toBe(1);
        expect(names[8]).toBe(names[0]);
        // Half-way through a step the sky is between the two, and a level adds to the clock.
        world.seek(PALETTE_STEP * 0.5);
        frame(world, camera, 0);
        expect(world.getState().paletteMix).toBeGreaterThan(0.3);
        expect(world.getState().paletteMix).toBeLessThan(0.7);
        world.levelUp(2, { silent: true });
        expect(world.getState().palette).toBe(paletteName(palettePlace(1, world.time)));
        // A seek and a replay agree: the palette is a function of the level and the clock.
        const replay = makeWorld();
        replay.world.seek(PALETTE_STEP * 2.4 - 3);
        run(replay.world, replay.camera, 3, 90);
        world.levelUp(1, { silent: true });
        world.seek(PALETTE_STEP * 2.4);
        frame(world, camera, 0);
        replay.world.u.dustA.value.toArray().forEach((v, i) => {
            expect(v).toBeCloseTo(world.u.dustA.value.toArray()[i], 6);
        });
    });
});

describe('void ember world: the clock', () => {
    /** A short game from t = 20, in fixed steps, and everything it left behind. */
    function play(world, camera) {
        settle(world, camera, 20);
        const script = {
            30: () => world.onLock(lock({ hardDrop: true, color: COLORS.I })),
            60: () => world.onLock(lock({ u: 0.7, color: COLORS.T })),
            90: () => {
                world.onLock(lock({ u: 0.5, color: COLORS.S }));
                world.onClear(clear(2));
                world.onCombo(1);
            },
            150: () => {
                world.onClear(clear(2, { tspin: true }));
                world.onCombo(2);
            },
            200: () => world.levelUp(2),
            210: () => world.onClear(clear(4)),
        };
        for (let i = 1; i <= 360; i++) frame(world, camera, 1 / 60, script[i] || null);
        return {
            state: world.getState(),
            post: JSON.parse(JSON.stringify(world.getPostState())),
            queue: world.queue.map((moment) => [moment.time, moment.kind]),
            loops: Array.from(column(world.loops, 'aShape')),
            sparks: Array.from(column(world.sparks, 'aBirth')),
            comets: Array.from(column(world.comets, 'aFrom')),
            waves: world.u.waves.array.map((row) => row.toArray()),
            impacts: world.u.impacts.array.map((row) => row.toArray()),
        };
    }

    it('seek plus a fixed-step replay gives the same frame, twice over and in another world', () => {
        const { world, camera } = makeWorld();
        const first = play(world, camera);
        expect(first.state.counts).toMatchObject({ locks: 3, clears: 3, quads: 1 });
        expect(first.state.time).toBeCloseTo(26, 9);
        const second = play(world, camera);
        expect(second).toEqual(first);
        const other = makeWorld();
        expect(play(other.world, other.camera)).toEqual(first);
    });

    it('a seek leaves the star its own prominences, where the clock says they are', () => {
        const { world, camera } = makeWorld();
        const own = () => slots(world, LOCK_LOOPS, LOOP_SLOTS)
            .map(({ birth, site, strength }) => ({ birth, site, strength }));
        world.seek(200);
        // Raised by the seek itself: a capture's first frame already shows them.
        const direct = own();
        expect(direct).toHaveLength(AMBIENT_LOOPS);
        direct.forEach((slot) => {
            expect(slot.strength).toBeGreaterThan(0);
            expect(slot.birth).toBeLessThanOrEqual(200);
            expect(Math.hypot(...slot.site)).toBeCloseTo(1, 6);
        });
        expect(world.loops.litCount(200, LOCK_LOOPS, LOOP_SLOTS)).toBeGreaterThan(0);
        // The board's slots are empty, and nothing is in flight.
        expect(standing(world, 200)).toEqual([]);
        expect(world.queue).toEqual([]);
        // The same ones whether the clock jumped there or ran there.
        settle(world, camera, 150);
        run(world, camera, 50, 500);
        expect(world.time).toBeCloseTo(200, 6);
        expect(own()).toEqual(direct);
        // And they come and go: a few minutes on, some have been raised anew.
        run(world, camera, 180, 900);
        expect(own().filter((slot, i) => slot.birth !== direct[i].birth).length).toBeGreaterThan(0);
    });

    it('one of the star\'s own prominences has lifted off and gone before its slot is raised again', () => {
        const { world, camera } = makeWorld('Minimal', { at: 100 });
        let before = slots(world, LOCK_LOOPS, LOOP_SLOTS);
        // Each is raised with its own lift-off already set, while it still has light to leave with.
        before.forEach((slot) => {
            expect(slot.erupt).toBeGreaterThan(slot.birth);
            expect(slot.erupt - slot.birth).toBeLessThan(LOOP_LIFE);
        });
        const raisedAgain = [];
        for (let i = 0; i < 2400; i++) {
            const held = before.map((_, k) => world.loops.held(LOCK_LOOPS + k, world.time));
            frame(world, camera, 1 / 20);
            const now = slots(world, LOCK_LOOPS, LOOP_SLOTS);
            for (let k = 0; k < now.length; k++) {
                if (now[k].birth !== before[k].birth) {
                    raisedAgain.push({ stillHeld: held[k], sinceItLeft: now[k].birth - before[k].erupt });
                }
            }
            before = now;
        }
        // Two minutes: every slot has turned over at least once.
        expect(raisedAgain.length).toBeGreaterThanOrEqual(AMBIENT_LOOPS);
        raisedAgain.forEach(({ stillHeld, sinceItLeft }) => {
            expect(stillHeld).toBe(0); // it had let go of the star...
            expect(sinceItLeft).toBeGreaterThanOrEqual(ERUPT_LIFE); // ...and its arc had left the sky
        });
    });

    it.each([0, 5, 40, 200])('a seek to t = %i s finds the prominences a run from zero would have', (time) => {
        const jumped = makeWorld('Minimal', { at: time });
        const ran = makeWorld('Minimal', { at: 0 });
        if (time > 0) run(ran.world, ran.camera, time, time * 20);
        expect(ran.world.time).toBeCloseTo(time, 6);
        const own = (world) => slots(world, LOCK_LOOPS, LOOP_SLOTS);
        // The same loops, born at the same moments in the same places, with the same lift-off set.
        expect(own(jumped.world)).toEqual(own(ran.world));
        // And the same per-strand data for the shader (the board's slots are empty in both).
        for (const name of ['aSite', 'aTan', 'aShape', 'aTint']) {
            const expected = Array.from(column(ran.world.loops, name));
            expect(Array.from(column(jumped.world.loops, name)), name).toEqual(expected);
        }
        own(jumped.world).forEach((slot) => {
            expect(slot.strength).toBeGreaterThan(0);
            expect(slot.birth).toBeLessThanOrEqual(time);
        });
    });

    it('a new run in the middle of a hush gives the ember its breath back', () => {
        const { world, camera } = makeWorld();
        world.onClear(clear(4));
        run(world, camera, HUSH_HOLD / 2);
        expect(world.breath).toBeLessThan(0.9);
        expect(queued(world, 'surge')).toHaveLength(1);
        const hushed = world.getPostState().rays;
        world.resetSession();
        expect(world.breath).toBe(1);
        expect(world.queue).toEqual([]);
        // It stays: the hush is over, and the flare that was queued for its end never comes.
        for (let i = 0; i < 60; i++) {
            frame(world, camera, 1 / 60);
            expect(world.breath).toBeGreaterThan(0.99);
            expect(world.u.breath.value).toBe(world.breath);
            expect(world.surge).toBe(0);
        }
        expect(world.getPostState().rays).toBeGreaterThan(hushed); // the post is out of its hush too
    });

    it('a new run empties the queue, the loops and the chain, and keeps the clocks', () => {
        const { world, camera } = makeWorld();
        fillStar(world, camera, 6);
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 2);
        world.onLock(lock({ hardDrop: true }));
        world.onClear(clear(4));
        run(world, camera, 0.1);
        expect(world.queue.length).toBeGreaterThan(0);
        expect(world.heat).toBeGreaterThan(REST_HEAT);
        const {
            time, spin, boil, flow,
        } = world;

        world.resetSession();
        expect(world.queue).toEqual([]);
        expect(standing(world)).toEqual([]);
        expect(world.getState()).toMatchObject({
            time,
            combo: 0,
            heat: REST_HEAT,
            stoke: 0,
            surge: 0,
            level: 1,
            palette: paletteName(palettePlace(world.levelPlace, time)),
            held: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, comets: 0, eruptions: 0,
            },
        });
        expect(world).toMatchObject({ spin, boil, flow });
        // Nothing is left in flight or about to fire.
        const dormant = (part, name) => Array.from(column(part, name)).filter((_, i) => i % 4 === 3)
            .every((stamp) => stamp < time - 50);
        expect(dormant(world.comets, 'aFrom')).toBe(true);
        expect(dormant(world.sparks, 'aBirth')).toBe(true);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        for (let i = 0; i < WAVE_SLOTS; i++) expect(waveRows(world, i)[0][1]).toBe(0);
        expect(world.spaceRipple.strength).toBe(0);

        // The next frame carries on from the same clocks, with the star's own prominences back.
        frame(world, camera, 1 / 60);
        expect(world.time).toBeCloseTo(time + 1 / 60, 9);
        expect(world.spin).toBeGreaterThan(spin);
        expect(world.boil).toBeGreaterThan(boil);
        expect(world.breath).toBeCloseTo(1, 1);
        expect(slots(world, LOCK_LOOPS, LOOP_SLOTS).every((slot) => slot.strength > 0)).toBe(true);
        // The void eases back to the first level's place on the palettes' line: no snap at game
        // over. (Its colours also drift on the clock, so the place is what is checked.)
        expect(world.levelPlace).toBeGreaterThan(1);
        const gap = world.levelPlace;
        run(world, camera, 1);
        expect(world.levelPlace).toBeLessThan(gap);
        expect(world.levelPlace).toBeGreaterThan(0);
        run(world, camera, 30, 300);
        expect(world.levelPlace).toBe(0);
        const home = paletteAt(palettePlace(0, world.time));
        world.u.voidCol.value.toArray().forEach((v, i) => expect(v).toBeCloseTo(home.void[i], 9));
        // And the next run counts from one.
        world.onLock(lock());
        expect(world.counts).toMatchObject({ locks: 1, comets: 1 });
    });

    it('tells the shaders whether any wave is alive, so a quiet sky skips the wave maths', () => {
        const { world, camera } = makeWorld();
        expect(world.u.wavesLive.value).toBe(0);
        expect(world.getState().wavesLive).toBe(0);
        world.onClear(clear(2));
        frame(world, camera, 1 / 60);
        expect(world.u.wavesLive.value).toBe(1);
        expect(world.getState().wavesLive).toBeGreaterThan(0);
        // A wave that has not left yet (the hush before a flare) already counts.
        const waiting = makeWorld();
        waiting.world.onClear(clear(4));
        frame(waiting.world, waiting.camera, 1 / 60);
        expect(waiting.world.u.wavesLive.value).toBe(1);
        // Long after the last one has crossed the frame, the flag drops again.
        run(world, camera, WAVE_LIVE + 0.5, 60);
        expect(world.u.wavesLive.value).toBe(0);
        expect(world.getState().wavesLive).toBe(0);
        // A new level's cold ring is a wave too.
        world.levelUp(2);
        frame(world, camera, 1 / 60);
        expect(world.u.wavesLive.value).toBe(1);
    });

    it('the pools are rings: a burst that outruns one still lands every comet', () => {
        const { world, camera } = makeWorld();
        const t = world.time;
        const drops = Math.ceil(COMET_SLOTS / 3) + 1; // more comets at once than there are slots
        for (let i = 0; i < drops; i++) world.onLock(lock({ hardDrop: true, u: i / drops, player: i % 4 }));
        expect(world.counts.comets).toBe(drops * 3);
        expect(world.counts.comets).toBeGreaterThan(COMET_SLOTS);
        // Every comet slot is flying, and every landing is still due.
        expect(stamped(world.comets, 'aFrom', t)).toHaveLength(COMET_SLOTS * COMET_TAIL);
        const landings = queued(world, 'land');
        expect(landings).toHaveLength(drops * 3);
        runPast(world, camera, Math.max(...landings.map((landing) => landing.time)));
        expect(standing(world)).toHaveLength(Math.min(LOCK_LOOPS, drops * 3));
        // The photosphere keeps as many marks as it has slots: the newest.
        expect(world.getState().impacts).toBe(Math.min(IMPACT_SLOTS, drops * 3));
        expect(world.u.impactCount.value).toBeLessThanOrEqual(IMPACT_SLOTS);
        const newest = Math.max(...landings.map((landing) => landing.time));
        expect(world.u.impacts.array.filter((_, i) => i % 2 === 0).some((mark) => mark.w === newest)).toBe(true);
    });

    it('turns the star, boils it and streams the wind faster the hotter it is', () => {
        const cool = makeWorld();
        const hot = makeWorld();
        hot.world.onCombo(10);
        const before = { boil: cool.world.boil, flow: cool.world.flow, spin: cool.world.spin };
        run(cool.world, cool.camera, 10);
        run(hot.world, hot.camera, 10);
        expect(cool.world.spin).toBeGreaterThan(before.spin);
        expect(cool.world.boil).toBeGreaterThan(before.boil);
        expect(hot.world.boil).toBeGreaterThan(cool.world.boil);
        expect(hot.world.flow).toBeGreaterThan(cool.world.flow);
        expect(hot.world.spin).toBeCloseTo(cool.world.spin, 9); // heat does not turn it; a T-spin does
        hot.world.onClear(clear(2, { tspin: true }));
        run(cool.world, cool.camera, 2);
        run(hot.world, hot.camera, 2);
        expect(hot.world.spin).toBeGreaterThan(cool.world.spin);
        // A frozen frame (a capture) moves no clock and changes no heat.
        const still = ({
            time, spin, boil, flow, heat, twist, stoke, surge,
        }) => ({
            time, spin, boil, flow, heat, twist, stoke, surge,
        });
        const held = still(hot.world);
        frame(hot.world, hot.camera, 0);
        frame(hot.world, hot.camera, 0);
        expect(still(hot.world)).toEqual(held);
    });
});

describe('void ember world: aiming at the board', () => {
    const FRAMES = [['16:9', 1600, 900], ['21:9', 2100, 900], ['9:19.5', 900, 1950]];

    it('with no board on screen it aims at where the solo board would hang', () => {
        const { world, camera } = makeWorld('Minimal', { layout: null });
        const aspect = 1600 / 900;
        expect(world.layoutLive).toBe(false);
        expect(world.getState().layoutLive).toBe(false);
        expect(world.layout).toEqual(fallbackLayout(aspect * 1000, 1000));
        // A lock still feeds the star, from that card's edge.
        const t = world.time;
        const board = boardFor(world.layout, 0);
        const card = world.cardFor(board);
        expect(card).toEqual(cardUnion(world.layout));
        const point = boardPoint(board, 0.3, 12);
        const exit = { ...world.cardExit(point.x, point.y, card) };
        world.onLock(lock({ u: 0.3, rows: [12] }));
        const start = cometStart(world, camera, t);
        expect(start.x).toBeCloseTo(exit.x, 4);
        expect(start.y).toBeCloseTo(exit.y, 4);
        expect(exit.x).toBeCloseTo(card.x0, 9);
        // A clear still sends its wave; only the blades need a real card to leave from.
        world.onClear(clear(2));
        expect(waveRows(world, 0)[0][1]).toBeGreaterThan(0);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        // The fallback follows the frame's shape.
        world.setViewport(900, 1950, 900 / 1950);
        expect(world.layout).toEqual(fallbackLayout((900 / 1950) * 1000, 1000));
    });

    it('follows the live board: the comet leaves the card where the line to the star crosses its edge', () => {
        const { world, camera } = makeWorld();
        const moved = fallbackLayout(1600, 900);
        const shift = (rect) => ({
            x0: rect.x0 + 0.1, y0: rect.y0, x1: rect.x1 + 0.1, y1: rect.y1,
        });
        moved.cards = moved.cards.map(shift);
        moved.boards[0] = shift(moved.boards[0]);
        world.setLayout(moved);
        expect(world.layoutLive).toBe(true);
        expect(world.layout).toBe(moved);
        for (const [u, row] of [[0.1, 2], [0.5, 10], [0.9, 19]]) {
            const point = boardPoint(moved.boards[0], u, row);
            const exit = { ...world.cardExit(point.x, point.y, world.cardFor(moved.boards[0])) };
            run(world, camera, 0.2);
            const t = world.time;
            world.onLock(lock({ u, rows: [row] }));
            const start = cometStart(world, camera, t);
            expect(start.x).toBeCloseTo(exit.x, 3);
            expect(start.y).toBeCloseTo(exit.y, 3);
            expect(exit.x).toBeCloseTo(moved.cards[0].x0, 9);
        }
        // A click with no board (the meditation mode) leaves from where it was made.
        run(world, camera, 0.2);
        const t = world.time;
        world.onLock(lock({ screen: { x: 0.8, y: 0.3 } }));
        const start = cometStart(world, camera, t);
        expect(start.x).toBeCloseTo(0.8, 4);
        expect(start.y).toBeCloseTo(0.3, 4);
    });

    it('cardFor is a board\'s own card when there are several, and every card as one otherwise', () => {
        const { world } = makeWorld();
        // One card: the card itself (the union of one).
        const solo = world.layout;
        expect(world.cardFor(solo.boards[0])).toEqual(solo.cards[0]);
        expect(world.cardFor(null)).toEqual(cardUnion(solo));
        // Several: the card the board's centre is in.
        const cards = [0, 1, 2].map((i) => ({
            x0: 0.1 + i * 0.28, y0: 0.15, x1: 0.34 + i * 0.28, y1: 0.85,
        }));
        const inside = (card) => ({
            x0: card.x0 + 0.03, y0: card.y0 + 0.2, x1: card.x1 - 0.03, y1: card.y1 - 0.02,
        });
        const boards = [null, inside(cards[0]), inside(cards[1]), inside(cards[2]), null];
        const layout = {
            cardCount: 3, cards, hud: null, boards,
        };
        world.setLayout(layout);
        [1, 2, 3].forEach((player) => expect(world.cardFor(boards[player])).toBe(cards[player - 1]));
        // No board, or a board that sits in none of them: all the cards together.
        const union = cardUnion(layout);
        expect(world.cardFor(null)).toEqual(union);
        expect(world.cardFor({
            x0: 0.01, y0: 0.9, x1: 0.05, y1: 0.99,
        })).toEqual(union);
        expect(union).toEqual({
            x0: cards[0].x0, y0: 0.15, x1: cards[2].x1, y1: 0.85,
        });
        // A board whose rect pokes out of its card still belongs to the card its centre is in.
        expect(world.cardFor({
            x0: cards[1].x0 - 0.02, y0: 0.3, x1: cards[1].x1 - 0.1, y1: 0.95,
        })).toBe(cards[1]);
    });

    it.each(FRAMES)('cardExit is a point of the card\'s edge between the lock and the star (%s)', (
        _label,
        width,
        height,
    ) => {
        const { world } = makeWorld('Minimal', { width, height });
        const card = cardUnion(world.layout);
        const board = boardFor(world.layout, 0);
        const { heart } = world;
        const edges = new Set();
        for (let row = 0; row < 20; row++) {
            for (const u of [0, 0.25, 0.5, 0.75, 1]) {
                const from = boardPoint(board, u, row);
                const exit = { ...world.cardExit(from.x, from.y, card) };
                // On the card's edge...
                const on = [
                    Math.abs(exit.x - card.x0), Math.abs(exit.x - card.x1), Math.abs(exit.y - card.y0),
                    Math.abs(exit.y - card.y1),
                ];
                expect(Math.min(...on)).toBeLessThan(1e-9);
                edges.add(on.indexOf(Math.min(...on)));
                expect(exit.x).toBeGreaterThanOrEqual(card.x0 - 1e-9);
                expect(exit.x).toBeLessThanOrEqual(card.x1 + 1e-9);
                expect(exit.y).toBeGreaterThanOrEqual(card.y0 - 1e-9);
                expect(exit.y).toBeLessThanOrEqual(card.y1 + 1e-9);
                // ...on the straight line from the lock to the star, between the two.
                const k = (exit.x - from.x) / (heart.x - from.x);
                expect(k).toBeGreaterThanOrEqual(0);
                expect(k).toBeLessThan(1);
                expect(exit.y).toBeCloseTo(from.y + (heart.y - from.y) * k, 9);
            }
        }
        // The star is left of the card in a wide frame; on an upright phone it is above it too.
        if (width > height) expect([...edges]).toEqual([0]);
        else expect([...edges].every((edge) => edge === 0 || edge === 2)).toBe(true);
        // A point that is not in the card is where it leaves from; so is any point when there is
        // no card, or when the star itself is behind the card.
        expect({ ...world.cardExit(card.x0 - 0.05, 0.5, card) }).toEqual({ x: card.x0 - 0.05, y: 0.5 });
        expect({ ...world.cardExit(0.5, 0.5, null) }).toEqual({ x: 0.5, y: 0.5 });
        const over = {
            x0: Math.min(heart.x, 0.5) - 0.05, y0: Math.min(heart.y, 0.5) - 0.05, x1: 0.95, y1: 0.95,
        };
        expect({ ...world.cardExit(0.5, 0.5, over) }).toEqual({ x: 0.5, y: 0.5 });
        // It fills the point it is handed.
        const out = { x: 0, y: 0 };
        expect(world.cardExit(0.5, 0.5, card, out)).toBe(out);
    });

    it.each(FRAMES)('pickSite is a unit vector on the side of the star that faces the camera (%s)', (
        _label,
        width,
        height,
    ) => {
        const { world, camera } = makeWorld('Minimal', { width, height });
        const board = boardFor(world.layout, 0);
        const card = world.cardFor(board);
        const centre = world.u.centre.value;
        const toCamera = camera.position.clone().sub(centre).normalize();
        const seen = new Set();
        for (let row = 0; row < 20; row++) {
            for (const u of [0, 0.25, 0.5, 0.75, 1]) {
                const from = boardPoint(board, u, row);
                const exit = { ...world.cardExit(from.x, from.y, card) };
                for (let salt = 0; salt < 3; salt++) {
                    const site = [...world.pickSite(exit.x, exit.y, salt)];
                    expect(Math.hypot(...site)).toBeCloseTo(1, 9);
                    const out = world.siteWorld(site).clone().sub(centre).normalize();
                    expect(out.dot(toCamera)).toBeGreaterThan(0.1);
                    seen.add(site.map((v) => v.toFixed(2)).join());
                }
            }
        }
        // Spread over the face, not one spot.
        expect(seen.size).toBeGreaterThan(100);
        // The same lock picks the same place (the world's own count seeds it), another lock another.
        const first = [...world.pickSite(0.4, 0.5, 0)];
        expect([...world.pickSite(0.4, 0.5, 0)]).toEqual(first);
        world.onLock(lock());
        expect([...world.pickSite(0.4, 0.5, 0)]).not.toEqual(first);
    });

    it('a piece higher on the board strikes higher on the star, in a wide frame', () => {
        const { world } = makeWorld();
        const board = boardFor(world.layout, 0);
        const card = world.cardFor(board);
        const centre = world.u.centre.value;
        const height = (row) => {
            let sum = 0;
            for (let i = 0; i < 40; i++) {
                const from = boardPoint(board, 0.5, row);
                const exit = { ...world.cardExit(from.x, from.y, card) };
                sum += world.siteWorld([...world.pickSite(exit.x, exit.y, 0)]).y - centre.y;
                world.counts.locks += 1; // the next lock's own draw
            }
            return sum / 40;
        };
        expect(height(1)).toBeGreaterThan(height(10));
        expect(height(10)).toBeGreaterThan(height(19));
    });

    it('with four boards a lock\'s comet leaves from its own card, never from the star', () => {
        const cards = [0, 1, 2, 3].map((i) => ({
            x0: 0.04 + i * 0.235, y0: 0.12, x1: 0.255 + i * 0.235, y1: 0.88,
        }));
        const boards = [null, ...cards.map((card) => ({
            x0: card.x0 + 0.02, y0: card.y0 + 0.12, x1: card.x1 - 0.02, y1: card.y1 - 0.03,
        }))];
        const { world, camera } = makeWorld('Minimal', {
            layout: {
                cardCount: 4, cards, hud: null, boards,
            },
        });
        const seen = [];
        for (const player of [1, 2, 3, 4]) {
            run(world, camera, 0.2);
            const t = world.time;
            world.onLock(lock({ player, u: 0.5, rows: [10] }));
            const start = cometStart(world, camera, t);
            const own = cards[player - 1];
            expect(world.cardFor(boards[player])).toBe(own);
            expect(start.x, `player ${player}`).toBeGreaterThanOrEqual(own.x0 - 1e-3);
            expect(start.x, `player ${player}`).toBeLessThanOrEqual(own.x1 + 1e-3);
            const point = boardPoint(boards[player], 0.5, 10);
            const behind = world.heart.x > own.x0 && world.heart.x < own.x1;
            if (behind) {
                // The star is behind this card: the comet leaves from the piece itself.
                expect(start.x, `player ${player}`).toBeCloseTo(point.x, 3);
                expect(start.y, `player ${player}`).toBeCloseTo(point.y, 3);
            } else {
                // It crosses its own card's edge on the star's side, on the way to the star.
                expect(start.x, `player ${player}`).toBeCloseTo(own.x0, 3);
                expect(Math.abs(start.y - world.heart.y)).toBeLessThanOrEqual(Math.abs(point.y - world.heart.y));
            }
            seen.push(behind);
        }
        // Both cases were played: the star is behind one of the four cards.
        expect(seen.filter(Boolean)).toHaveLength(1);
    });

    it('each board\'s clear fires its own rows, and any board\'s lock feeds the one star', () => {
        const cards = [0, 1].map((i) => ({
            x0: 0.3 + i * 0.22, y0: 0.12, x1: 0.5 + i * 0.22, y1: 0.88,
        }));
        const boards = [null, ...cards.map((card) => ({
            x0: card.x0 + 0.02, y0: card.y0 + 0.2, x1: card.x1 - 0.02, y1: card.y1 - 0.03,
        })), null, null];
        boards[2].y0 += 0.1; // the second board hangs lower
        const { world, camera } = makeWorld('Minimal', {
            layout: {
                cardCount: 2, cards, hud: null, boards,
            },
        });
        const edges = () => world.beams.uniforms.frame.value.toArray().slice(0, 2);
        world.onClear(clear(1, { player: 1, rows: [19] }));
        const first = world.beams.uniforms.rows.value.x;
        expect(first).toBe(boardPoint(boards[1], 0.5, 19).y);
        expect(edges()).toEqual([cards[0].x0, cards[0].x1]); // from its own card's edges
        world.onClear(clear(1, { player: 2, rows: [4] }));
        expect(world.beams.uniforms.rows.value.x).toBe(boardPoint(boards[2], 0.5, 4).y);
        expect(edges()).toEqual([cards[1].x0, cards[1].x1]);
        // A player with no board of its own on screen is aimed at the first board there is.
        world.onClear(clear(1, { player: 4, rows: [19] }));
        expect(world.beams.uniforms.rows.value.x).toBe(first);
        world.onLock(lock({ player: 1 }));
        world.onLock(lock({ player: 2 }));
        runPast(world, camera, Math.max(...queued(world, 'land').map((landing) => landing.time)));
        expect(standing(world)).toHaveLength(2);
    });
});
