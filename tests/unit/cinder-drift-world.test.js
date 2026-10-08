import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    CINDER_DRIFT_PARTS, CinderDriftWorld, FOUNTAINS_FOR_LINES, REST_RIG, SURGE_COOL, fovForAspect,
} from '../../src/themes/cinder-drift/cinder-drift-world.js';
import {
    BOMB_SLOTS, BOMB_TAIL, CINDER_PALETTES, CLEAR_SLOTS, CLEAR_TRAVEL, DEG, DRIFT_SPEED, FOUNTAIN_SLOTS, GRAVITY,
    HUSH_HOLD, LAKE, PALETTE_KEYS, RING_SLOTS, SKYLIGHT, STREAM_SLOTS, WHITE_HEAT, clearPassTime, fissuresForCombo,
    flightTime, powerForCombo, rigForAspect,
} from '../../src/themes/cinder-drift/cinder-drift-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/cinder-drift/cinder-drift-quality.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from '../../src/themes/cinder-drift/cinder-drift-composition.js';
import { FLASH_SLOTS, bombPoint, dropHeight } from '../../src/themes/cinder-drift/cinder-drift-fx.js';

// A world bakes its plan and its textures on the CPU (a few tenths of a second a build): leave a
// loaded machine room for the tests that build several.
vi.setConfig({ testTimeout: 30000 });

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, capture = true,
} = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new CinderDriftWorld({ scene, quality, capture }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(live ? fallbackLayout(width, height) : null, width / height);
    world.seek(10);
    world.updateCamera(camera, { time: 10, delta: 0 });
    world.update({ time: 10, delta: 0 }, camera);
    return { scene, camera, world };
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

/** One frozen frame at the world's own time: the camera, then the world. */
function freeze(world, camera) {
    const sim = { time: world.time, delta: 0 };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

/** A pool's per-instance array. */
const instanced = (part, name) => part.geometry.getAttribute(name).array;

/** Slots of a pool whose timestamp (component 3 of `name`) says they have been used. */
function used(part, name) {
    const array = instanced(part, name);
    const out = [];
    for (let i = 0; i < array.length / 4; i++) if (array[i * 4 + 3] > -50) out.push(i);
    return out;
}

/** Drops thrown from within `radius` metres (across the lake) of a point, born at `since` or later. */
function dropsFrom(world, x, z, { radius = 0.01, since = -50 } = {}) {
    const birth = instanced(world.spatter, 'aBirth');
    const out = [];
    for (let i = 0; i < world.spatter.count; i++) {
        const born = birth[i * 4 + 3] >= since - 1e-3;
        if (born && Math.hypot(birth[i * 4] - x, birth[i * 4 + 2] - z) <= radius) out.push(i);
    }
    return out;
}

/** Sparks: the drops that rise instead of falling (they leave the card, not the lake). */
function sparks(world, since) {
    const birth = instanced(world.spatter, 'aBirth');
    const phys = instanced(world.spatter, 'aPhys');
    const out = [];
    for (let i = 0; i < world.spatter.count; i++) {
        if (birth[i * 4 + 3] >= since - 1e-3 && phys[i * 4] < 0) {
            out.push([birth[i * 4], birth[i * 4 + 1], birth[i * 4 + 2]]);
        }
    }
    return out;
}

/** The ribbons standing on the lake (fountains, a lock's jet): where, from when, how long, how tall. */
function standing(world) {
    const A = instanced(world.falls, 'aA');
    const B = instanced(world.falls, 'aB');
    const T = instanced(world.falls, 'aT');
    const out = [];
    for (let i = 0; i < world.falls.count; i++) {
        if (T[i * 4] > -50) {
            out.push({
                x: A[i * 4],
                z: A[i * 4 + 2],
                width: A[i * 4 + 3],
                height: B[i * 4 + 1],
                time: T[i * 4],
                life: T[i * 4 + 1],
            });
        }
    }
    return out;
}

/** The bursts of light fired, as { x, y, z, time, size }. */
function flashes(world) {
    const at = instanced(world.flashes, 'aAt');
    const tint = instanced(world.flashes, 'aTint');
    return used(world.flashes, 'aAt').map((i) => ({
        x: at[i * 4], y: at[i * 4 + 1], z: at[i * 4 + 2], time: at[i * 4 + 3], size: tint[i * 4 + 3],
    }));
}

/** The bombs in flight, one entry per bomb (its head): where from, how fast, when, for how long. */
function bombs(world) {
    const from = instanced(world.bombs, 'aFrom');
    const vel = instanced(world.bombs, 'aVel');
    const out = [];
    for (let slot = 0; slot < BOMB_SLOTS; slot++) {
        const i = slot * BOMB_TAIL * 4;
        if (from[i + 3] > -50) {
            out.push({
                slot,
                from: [from[i], from[i + 1], from[i + 2]],
                velocity: [vel[i], vel[i + 1], vel[i + 2]],
                time: from[i + 3],
                flight: vel[i + 3],
            });
        }
    }
    return out;
}

/**
 * The ring a lock at `time` sent through the crust: the slot (and its colour) born at that
 * instant. Slots are found by their birth, never by index.
 */
function ringBornAt(world, time, tolerance = 0) {
    const index = world.u.ringA.findIndex((slot) => Math.abs(slot.value.z - time) <= tolerance && slot.value.w > 0);
    if (index < 0) return null;
    const place = world.u.ringA[index].value;
    return {
        x: place.x, z: place.y, strength: place.w, colour: world.u.ringC[index].value,
    };
}

/** Where a world point stands on screen (fractions, y down). */
function onScreen(camera, x, y, z) {
    const point = new THREE.Vector3(x, y, z).project(camera);
    return { x: point.x * 0.5 + 0.5, y: 0.5 - point.y * 0.5 };
}

const near = (a, b, tolerance = 1e-3) => Math.abs(a - b) <= tolerance;

/** True when a burst of light has been fired at a point of the lake. */
const flashedAt = (world, x, z) => flashes(world).some((flash) => near(flash.x, x) && near(flash.z, z));

/** What the post reads each frame, and what it reads when nothing is happening. */
const POST_KEYS = ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure', 'haze', 'horizon'];
const AT_REST = Object.freeze({
    flash: 0, kick: 0, exposure: 1, haze: 1,
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('cinder drift world: build', () => {
    it('builds every tier from node materials only, with the parts its tier pays for', () => {
        const columns = [];
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const materials = new Set();
            scene.traverse((object) => {
                if (object.material) materials.add(object.material);
            });
            expect(materials.size).toBe(Object.keys(world.parts).length);
            for (const material of materials) {
                expect(material.isNodeMaterial, material.name).toBe(true);
                expect(material.isShaderMaterial, material.name).not.toBe(true);
                expect(material.fog, material.name).toBe(false); // the atmosphere is in every material
            }
            // The whole picture and every event on every tier; only the air is paid for by tier.
            const paid = { embers: tier.embers > 0, smoke: tier.smoke > 0, shaft: tier.shaft };
            for (const part of CINDER_DRIFT_PARTS) {
                expect(Boolean(world.parts[part]), `${quality}.${part}`).toBe(paid[part] ?? true);
            }
            // Every part answers to a name the capture flag can address, and is in the scene.
            for (const name of Object.keys(world.parts)) {
                expect(CINDER_DRIFT_PARTS, name).toContain(name);
                expect(world.root.children, name).toContain(world.parts[name].mesh);
            }
            expect(scene.children).toContain(world.root);
            expect(world.plan.detail).toBe(tier.detail);
            expect(world.parts.columns.geometry.instanceCount).toBe(world.plan.columns.length);
            expect(world.spatter.count).toBe(tier.spatter);
            expect(world.spatter.geometry.instanceCount).toBe(tier.spatter);
            expect(world.bombs.geometry.instanceCount).toBe(BOMB_SLOTS * BOMB_TAIL);
            expect(world.flashes.geometry.instanceCount).toBe(FLASH_SLOTS);
            expect(world.getState()).toMatchObject({
                quality,
                columns: world.plan.columns.length,
                standing: world.plan.counts.standing,
                hanging: world.plan.counts.hanging,
                embers: tier.embers,
                smoke: tier.smoke,
                spatter: tier.spatter,
            });
            columns.push(world.plan.columns.length);
            world.dispose();
        }
        // A lower tier cuts its columns coarser.
        for (let i = 1; i < columns.length; i++) expect(columns[i]).toBeGreaterThanOrEqual(columns[i - 1]);
        expect(columns[columns.length - 1]).toBeGreaterThan(columns[0]);
    });

    it('draws the cheapest tier without its air, and the full picture from the next one up', () => {
        const minimal = makeWorld('Minimal').world;
        for (const part of ['embers', 'smoke', 'shaft']) expect(minimal.parts[part], part).toBeUndefined();
        for (const part of ['columns', 'lake', 'shell', 'falls', 'spatter', 'bombs', 'flashes', 'jets']) {
            expect(minimal.parts[part], part).toBeTruthy();
        }
        expect(minimal.getState()).toMatchObject({ embers: 0, smoke: 0 });
        minimal.dispose();
        const low = makeWorld('Low').world;
        expect(Object.keys(low.parts).sort()).toEqual([...CINDER_DRIFT_PARTS].sort());
        expect(low.parts.embers.count).toBe(QUALITY.Low.embers);
        expect(low.parts.smoke.count).toBe(QUALITY.Low.smoke);
        low.dispose();
    });

    it('never needs a frustum test or a matrix update for its parts', () => {
        const { world } = makeWorld('Low');
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.frustumCulled, name).toBe(false);
            expect(world.parts[name].mesh.matrixAutoUpdate, name).toBe(false);
        });
        world.dispose();
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['lake', 'columns', 'no-such-part']);
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'lake' || name === 'columns');
        });
        world.showOnlyParts([]);
        expect(Object.values(world.parts).some((part) => part.mesh.visible)).toBe(false);
        world.showOnlyParts(Object.keys(world.parts));
        expect(Object.values(world.parts).every((part) => part.mesh.visible)).toBe(true);
        world.dispose();
    });

    it('bakes every texture it reads and tells the rock where the fall and the fissures are', () => {
        const load = vi.spyOn(THREE.TextureLoader.prototype, 'load');
        const { world } = makeWorld('Minimal');
        // Nothing is loaded: noise, plates, shore and the lake's memory of heat are all made here.
        expect(load).not.toHaveBeenCalled();
        expect(world.textures.length).toBeGreaterThanOrEqual(4);
        for (const texture of world.textures) expect(texture.isDataTexture, texture.name).toBe(true);
        expect(new Set(world.textures.map((texture) => texture.name)).size).toBe(world.textures.length);
        for (const key of ['noiseTex', 'plateTex', 'shoreTex', 'heatTex']) {
            expect(world.textures, key).toContain(world.u[key]);
        }
        expect(world.u.heatTex).toBe(world.heatTex);
        // The heat field tiles with the crust; the shore map does not.
        expect(world.heatTex.wrapS).toBe(THREE.RepeatWrapping);
        expect(world.u.shoreTex.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(world.heatTex.image.data).toHaveLength(world.heat.data.length);

        expect(world.u.fallPos.value.toArray()).toEqual(world.plan.fallLight);
        expect(world.u.fallFoot.value.toArray()).toEqual(world.plan.fall.foot);
        expect(world.u.skyTop.value.toArray()).toEqual(SKYLIGHT.top);
        expect(world.u.skyFoot.value.toArray()).toEqual(SKYLIGHT.foot);
        expect(world.u.fissureAt).toHaveLength(STREAM_SLOTS);
        world.plan.streams.forEach((stream, i) => {
            expect(world.u.fissureAt[i].value.toArray()).toEqual([...stream.lip, 1]);
        });
        expect(world.u.ringA).toHaveLength(RING_SLOTS);
        expect(world.u.ringC).toHaveLength(RING_SLOTS);
        expect(world.u.clearA).toHaveLength(CLEAR_SLOTS);
        expect(world.u.clearC).toHaveLength(CLEAR_SLOTS);
        // At rest: the first palette, nothing in flight, every light at full.
        expect(world.getState()).toMatchObject({
            time: 10,
            combo: 0,
            power: 0,
            surge: 0,
            breath: 1,
            level: 1,
            palette: CINDER_PALETTES[0].name,
            heat: 0,
            pending: 0,
        });
        for (const key of PALETTE_KEYS) {
            CINDER_PALETTES[0][key].forEach((channel, k) => {
                expect(world.u[key].value.getComponent(k), key).toBeCloseTo(channel, 9);
            });
        }
        expect(world.u.ringsLive.value).toBe(0);
        expect(world.u.clearLive.value).toBe(0);
        world.dispose();
    });

    it('scales its drop counts to the pool its tier has', () => {
        const pools = ['Minimal', 'Low', 'High'].map((quality) => {
            const { world } = makeWorld(quality);
            const out = {
                pool: world.spatter.count, many: world.drops(1000), few: world.drops(1), none: world.drops(0),
            };
            world.dispose();
            expect(world.drops(1000), quality).toBe(0); // nothing to throw them from any more
            return out;
        });
        for (let i = 0; i < pools.length; i++) {
            const {
                pool, many, few, none,
            } = pools[i];
            expect(Number.isInteger(many)).toBe(true);
            // An event is never left with nothing to show.
            expect(few).toBeGreaterThanOrEqual(1);
            expect(none).toBeGreaterThanOrEqual(1);
            expect(many).toBeGreaterThan(few);
            if (i > 0) {
                // In proportion to the pool: twice the pool, twice the drops.
                expect(many).toBeGreaterThan(pools[i - 1].many);
                expect(many / pools[i - 1].many).toBeCloseTo(pool / pools[i - 1].pool, 1);
            }
        }
    });

    it('releases every geometry, material and texture, leaves the scene and survives a second dispose', () => {
        const { scene, camera, world } = makeWorld('Medium');
        expect(scene.children).toContain(world.root);
        expect(world.disposed).toBe(false);
        const disposals = [];
        Object.values(world.parts).forEach((part) => {
            disposals.push(vi.spyOn(part.geometry, 'dispose'), vi.spyOn(part.material, 'dispose'));
        });
        expect(world.textures.length).toBeGreaterThanOrEqual(4); // noise, plates, shore, heat
        world.textures.forEach((texture) => disposals.push(vi.spyOn(texture, 'dispose')));
        // Something in flight when it goes.
        world.onLock({ u: 0.3, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(5);
        run(world, camera, 0.5);
        expect(world.pending.length).toBeGreaterThan(0);

        world.dispose();
        expect(world.disposed).toBe(true);
        expect(scene.children).toHaveLength(0);
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(world.parts).toEqual({});
        expect(world.textures).toEqual([]);
        expect(world.disposables).toEqual([]);
        for (const key of ['u', 'heatTex', 'falls', 'spatter', 'bombs', 'flashes', 'jets']) {
            expect(world[key], key).toBeNull();
        }
        expect(() => world.dispose()).not.toThrow();
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        // A late frame or a late event after retirement is harmless.
        const { locks, clears } = world.counts;
        expect(() => {
            world.updateCamera(camera, { time: 11, delta: 0.016 });
            world.update({ time: 11, delta: 0.016 }, camera);
            world.onLock({ u: 0.5 });
            world.onLock({ screen: { x: 0.2, y: 0.9 }, hardDrop: true });
            world.onClear({ lines: 4 });
            world.onClear({ lines: 1, perfect: true, tspin: true });
            world.onCombo(3);
            world.levelUp(2);
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null);
            world.setReducedMotion(true);
            world.showOnlyParts(['lake']);
            world.getPostState();
            world.heatAt(0, -10);
            world.resetSession();
            world.seek(3);
        }).not.toThrow();
        expect(world.counts.locks).toBeLessThanOrEqual(locks);
        expect(world.counts.clears).toBeLessThanOrEqual(clears);
        expect(world.getState()).toMatchObject({
            spatter: 0, embers: 0, smoke: 0, pending: 0, heat: 0,
        });
    });
});

describe('cinder drift world: camera', () => {
    it('holds its horizontal view, clamped for very wide and very tall frames', () => {
        const free = (aspect) => (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / aspect)) / DEG;
        expect(fovForAspect(16 / 9)).toBeCloseTo(free(16 / 9), 9);
        expect(fovForAspect(16 / 9)).toBeGreaterThan(REST_RIG.minFov);
        expect(fovForAspect(16 / 9)).toBeLessThan(REST_RIG.maxFov);
        expect(fovForAspect(4 / 3)).toBeGreaterThan(fovForAspect(16 / 9));
        expect(fovForAspect(32 / 9)).toBe(REST_RIG.minFov);
        expect(fovForAspect(9 / 19.5)).toBe(REST_RIG.maxFov);
        for (const aspect of [0, -1, 0.01, 0.2, 0.5, 1, 2, 4, 40]) {
            expect(fovForAspect(aspect)).toBeGreaterThanOrEqual(REST_RIG.minFov);
            expect(fovForAspect(aspect)).toBeLessThanOrEqual(REST_RIG.maxFov);
        }
        // Nonsense falls back to a 16:9 frame.
        expect(fovForAspect(NaN)).toBe(fovForAspect(16 / 9));
        expect(fovForAspect(undefined)).toBe(fovForAspect(16 / 9));
        expect(fovForAspect(Infinity)).toBe(fovForAspect(16 / 9));
    });

    it('stands on its ledge over the lake, looking down the chamber and a little up', () => {
        const { camera, world } = makeWorld('Minimal');
        expect(Math.abs(camera.position.x)).toBeLessThan(1.5);
        expect(Math.abs(camera.position.y - REST_RIG.height)).toBeLessThan(0.3);
        expect(camera.position.z).toBe(0);
        expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 9);
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        expect(forward.z).toBeLessThan(-0.95);
        expect(forward.y).toBeGreaterThan(0); // looking up, at the roof
        expect(forward.y).toBeLessThan(0.3);
        // The lake's far edge is a little under the middle of the frame: the haze rises from below it.
        expect(world.horizon).toBeGreaterThan(0.5);
        expect(world.horizon).toBeLessThan(0.75);
        expect(world.getPostState().horizon).toBe(world.horizon);
        expect(world.getState().horizon).toBe(world.horizon);
        // The great fall is in the picture, left of the card: the post's shafts stream from it.
        const card = cardUnion(world.layout);
        expect(world.heart.x).toBeGreaterThan(0);
        expect(world.heart.x).toBeLessThan(card.x0);
        expect(world.heart.y).toBeGreaterThan(0);
        expect(world.heart.y).toBeLessThan(world.horizon);
        expect(world.getPostState().heart).toBe(world.heart);
        expect(world.getState().heart).toEqual(world.heart);
        const light = world.plan.fallLight;
        const fall = onScreen(camera, light[0], light[1], light[2]);
        expect(fall.x).toBeCloseTo(world.heart.x, 1);
        world.dispose();
    });

    it('turns toward the fall and looks up in an upright frame, and recomposes when the frame changes', () => {
        const wide = makeWorld('Minimal');
        const tall = makeWorld('Minimal', { width: 430, height: 932 });
        const forward = (camera) => camera.getWorldDirection(new THREE.Vector3());
        /** How far the camera is turned to the left of the chamber's axis, and tilted up (radians). */
        const yaw = (camera) => Math.atan2(-forward(camera).x, -forward(camera).z);
        const pitch = (camera) => Math.asin(forward(camera).y);
        const rig = rigForAspect(430 / 932);
        expect(tall.camera.fov).toBe(REST_RIG.maxFov);
        // It stands as its rig says (give or take its slow sway): further left, further up.
        expect(yaw(tall.camera)).toBeCloseTo(rig.yaw, 1);
        expect(pitch(tall.camera)).toBeCloseTo(rig.pitch, 1);
        expect(yaw(wide.camera)).toBeCloseTo(rigForAspect(16 / 9).yaw, 1);
        expect(yaw(tall.camera)).toBeGreaterThan(yaw(wide.camera));
        expect(pitch(tall.camera)).toBeGreaterThan(pitch(wide.camera));
        // Turning left brings the fall toward the middle of the picture.
        const light = tall.world.plan.fallLight;
        const straight = new THREE.PerspectiveCamera(REST_RIG.maxFov, 430 / 932, REST_RIG.near, REST_RIG.far);
        straight.position.copy(tall.camera.position);
        straight.lookAt(straight.position.x, straight.position.y, -10);
        straight.updateMatrixWorld();
        expect(tall.world.heart.x).toBeGreaterThan(onScreen(straight, light[0], light[1], light[2]).x);
        expect(tall.world.heart.x).toBeLessThan(0.5);
        expect(tall.world.getPostState().heart).toBe(tall.world.heart);
        tall.world.dispose();

        // The same world, told its frame has changed shape.
        const { camera, world } = wide;
        const viewport = world.u.viewport.value;
        const { layout } = world;
        expect(viewport.toArray()).toEqual([1600, 900]);
        world.setViewport(430, 932, 430 / 932);
        expect(viewport.toArray()).toEqual([430, 932]);
        expect(world.aspect).toBeCloseTo(430 / 932, 12);
        const before = yaw(camera);
        world.updateCamera(camera, { time: world.time, delta: 0 });
        expect(camera.fov).toBe(REST_RIG.maxFov);
        expect(yaw(camera)).toBeGreaterThan(before);
        expect(yaw(camera)).toBeCloseTo(rig.yaw, 1);
        // A live board is kept where the page says it is.
        expect(world.layout).toBe(layout);
        // A degenerate buffer or aspect is ignored.
        world.setViewport(0, 0, NaN);
        world.setViewport(-4, 300, -2);
        expect(viewport.toArray()).toEqual([430, 932]);
        expect(world.aspect).toBeCloseTo(430 / 932, 12);
        // With no board on screen the world aims at where the solo board would stand in the new frame.
        world.setLayout(null);
        expect(world.getState().layoutLive).toBe(false);
        const upright = cardUnion(world.layout);
        world.setViewport(1600, 900, 16 / 9);
        const landscape = cardUnion(world.layout);
        expect(landscape.x1 - landscape.x0).toBeLessThan(upright.x1 - upright.x0);
        world.setLayout(layout, 16 / 9);
        expect(world.getState().layoutLive).toBe(true);
        expect(world.layout).toBe(layout);
        world.dispose();
    });

    it('finds the lake under a screen point and falls back above its far edge', () => {
        const { camera, world } = makeWorld('Minimal');
        const strike = world.screenToLake(0.5, 0.95, { x: 0, z: 0 });
        expect(strike.z).toBeLessThan(-3);
        expect(strike.z).toBeGreaterThan(-25);
        expect(Math.abs(strike.x - camera.position.x)).toBeLessThan(1);
        // The point really is under that pixel.
        for (const [sx, sy] of [[0.5, 0.95], [0.2, 0.9], [0.8, 0.7]]) {
            const hit = world.screenToLake(sx, sy, { x: 0, z: 0 });
            const back = onScreen(camera, hit.x, 0, hit.z);
            expect(back.x).toBeCloseTo(sx, 6);
            expect(back.y).toBeCloseTo(sy, 6);
        }
        // Lower on the screen is nearer; left of centre on screen is left in the chamber.
        expect(world.screenToLake(0.5, 0.8, { x: 0, z: 0 }).z).toBeLessThan(strike.z);
        expect(world.screenToLake(0.2, 0.9, { x: 0, z: 0 }).x).toBeLessThan(camera.position.x - 1);
        // A point above the lake's far edge has no lava under it: so many metres ahead instead.
        const sky = world.screenToLake(0.5, 0.1, { x: 0, z: 0 }, 30);
        expect(Math.hypot(sky.x - camera.position.x, sky.z - camera.position.z)).toBeCloseTo(30, 6);
        expect(sky.z).toBeLessThan(0);
        // So does a point so close under the far edge that it is absurdly far away.
        const far = world.screenToLake(0.3, world.horizon + 0.002, { x: 0, z: 0 }, 30);
        expect(Math.hypot(far.x - camera.position.x, far.z - camera.position.z)).toBeCloseTo(30, 6);
        expect(far.x).toBeLessThan(camera.position.x);
        // It writes into the object it is given, or into its own scratch.
        const out = { x: 0, z: 0 };
        expect(world.screenToLake(0.5, 0.9, out)).toBe(out);
        expect(world.screenToLake(0.5, 0.9)).toBe(world.screenToLake(0.4, 0.8));
        // A point in the air in front of the card.
        const [x, y, z] = world.screenToWorld(0.5, 0.5, 6.5, [0, 0, 0]);
        expect(camera.position.distanceTo(new THREE.Vector3(x, y, z))).toBeCloseTo(6.5, 6);
        expect(z).toBeLessThan(-6);
        const edge = world.screenToWorld(0.25, 0.4, 6.5, [0, 0, 0]);
        const seen = onScreen(camera, edge[0], edge[1], edge[2]);
        expect(seen.x).toBeCloseTo(0.25, 6);
        expect(seen.y).toBeCloseTo(0.4, 6);
        world.dispose();

        // Before a camera is known: straight ahead of the ledge.
        const unbound = new CinderDriftWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
        expect(unbound.screenToLake(0.2, 0.9, { x: 5, z: 5 }, 7)).toEqual({ x: 0, z: -7 });
        expect(unbound.screenToWorld(0.2, 0.9, 6.5, [1, 1, 1])).toEqual([0, REST_RIG.height, -6.5]);
    });

    it('leans the view with the pointer', () => {
        const { camera, world } = makeWorld('Minimal');
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 0, pointerY: 0,
        });
        const rest = camera.position.clone();
        const ahead = camera.getWorldDirection(new THREE.Vector3());
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 1, pointerY: 0,
        });
        expect(camera.position.x).toBeGreaterThan(rest.x + 0.1);
        // It leans, and looks a little the same way.
        expect(camera.getWorldDirection(new THREE.Vector3()).x).toBeGreaterThan(ahead.x);
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 0, pointerY: 1,
        });
        expect(camera.position.y).toBeLessThan(rest.y);
        world.dispose();
    });

    it('keeps the camera still under reduced motion, and keeps the feedback', () => {
        const { camera, world } = makeWorld('Low');
        world.setReducedMotion(true);
        expect(world.reducedMotion).toBe(true);
        run(world, camera, 3);
        const still = () => {
            // (An exact zero of either sign.)
            expect(Math.abs(camera.position.x)).toBe(0);
            expect(camera.position.y).toBe(REST_RIG.height);
            expect(camera.position.z).toBe(0);
            expect(Math.abs(camera.up.x)).toBe(0);
            expect(camera.up.y).toBe(1);
            expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 9);
        };
        still();
        const pose = camera.quaternion.clone();
        // No sway, no pointer lean, no impact punch, no shaking.
        world.onLock({ u: 0.3, hardDrop: true, color: '#ff8800' });
        world.onClear({ lines: 4 });
        world.onCombo(8);
        expect(world.shake).toBeGreaterThan(0);
        for (let i = 0; i < 120; i++) {
            const sim = {
                time: world.time + 1 / 60, delta: 1 / 60, pointerX: 1, pointerY: -1,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            still();
            expect(camera.quaternion.angleTo(pose)).toBeLessThan(1e-9);
        }
        // Feedback stays: the ring, the pool, the wave, the fountains, the pressure.
        expect(world.u.ringA.some((slot) => slot.value.w > 0)).toBe(true);
        expect(world.getState().heat).toBeGreaterThan(0);
        expect(world.u.clearA[0].value.z).toBeGreaterThan(0);
        expect(world.counts).toMatchObject({
            locks: 1, clears: 1, quads: 1, fountains: FOUNTAIN_SLOTS,
        });
        expect(world.power).toBeGreaterThan(powerForCombo(1));
        world.dispose();

        // The shock through the rock is gentler, and the crust and the cinders drift slower.
        const calm = makeWorld('Low');
        const lively = makeWorld('Low');
        calm.world.setReducedMotion(true);
        calm.world.setReducedMotion('yes'); // only `true` is true
        expect(calm.world.reducedMotion).toBe(false);
        calm.world.setReducedMotion(true);
        calm.world.onClear({ lines: 4 });
        lively.world.onClear({ lines: 4 });
        expect(calm.world.u.shock.value.y).toBeGreaterThan(0);
        expect(calm.world.u.shock.value.y).toBeLessThan(lively.world.u.shock.value.y);
        const start = [calm.world.drift, lively.world.drift, calm.world.lift, lively.world.lift];
        run(calm.world, calm.camera, 1);
        run(lively.world, lively.camera, 1);
        expect(calm.world.drift - start[0]).toBeGreaterThan(0);
        expect(calm.world.drift - start[0]).toBeLessThan(lively.world.drift - start[1]);
        expect(calm.world.lift - start[2]).toBeGreaterThan(0);
        expect(calm.world.lift - start[2]).toBeLessThan(lively.world.lift - start[3]);
        // The lively camera, meanwhile, has been shaken off its rest.
        const { position } = lively.camera;
        expect(Math.abs(position.x) + Math.abs(position.y - REST_RIG.height)).toBeGreaterThan(0);
        calm.world.dispose();
        lively.world.dispose();
    });
});

describe('cinder drift world: locks', () => {
    it('drops the piece\'s heat into the lake beside the card: a ring, a pool, a crown of lava', () => {
        const { camera, world } = makeWorld('Low');
        const card = cardUnion(world.layout);
        const board = boardFor(world.layout, 0);
        expect(world.u.ringA.every((slot) => slot.value.w === 0)).toBe(true);
        expect(world.getState().heat).toBe(0);
        const { version } = world.heat;
        world.onLock({ rows: [19], u: 0.9, color: '#ffcc00' });
        expect(world.counts.locks).toBe(1);

        // ── The ring: on the lake, this side of its far edge, in open lava ──
        const right = ringBornAt(world, world.time);
        expect(right).toBeTruthy();
        const struck = onScreen(camera, right.x, 0, right.z);
        expect(struck.y).toBeGreaterThan(world.horizon);
        expect(struck.y).toBeLessThan(1);
        expect(right.z).toBeLessThan(0);
        expect(right.x).toBeGreaterThan(LAKE.x0);
        expect(right.x).toBeLessThan(LAKE.x1);
        expect(world.plan.depthAt(right.x, right.z)).toBeLessThan(0);
        // Beside the card, on the piece's side of it.
        expect(struck.x).toBeGreaterThan(card.x1);
        expect(struck.x).toBeLessThan(1);
        // It burns in the lava's colour with a breath of the piece's in it: warm, red over green over blue.
        expect(right.colour.x).toBeGreaterThan(right.colour.y);
        expect(right.colour.y).toBeGreaterThan(right.colour.z);
        expect(right.colour.z).toBeGreaterThan(0);
        expect(right.colour.w).toBeGreaterThan(0); // how far it reaches
        expect(right.colour.w).toBeLessThanOrEqual(1);

        // ── The pool it melts: hottest where it struck, and the texture is told ──
        expect(world.heatAt(right.x, right.z)).toBeGreaterThan(0);
        expect(world.heatAt(right.x, right.z)).toBeGreaterThan(world.heatAt(right.x + 1.5, right.z));
        expect(world.heatAt(right.x - 30, right.z - 30)).toBe(0);
        expect(world.heat.version).toBeGreaterThan(version);
        expect(world.getState().heat).toBeGreaterThan(0);
        expect(world.heat.ref).toBe(world.time);

        // ── The strike: a crown of drops thrown up, a jet of lava, a burst of light ──
        const crown = dropsFrom(world, right.x, right.z, { since: world.time });
        expect(crown.length).toBeGreaterThan(0);
        expect(crown.length).toBeLessThanOrEqual(world.spatter.count);
        const velocity = instanced(world.spatter, 'aVel');
        const birth = instanced(world.spatter, 'aBirth');
        for (const i of crown) {
            expect(velocity[i * 4 + 1]).toBeGreaterThan(0); // up
            expect(velocity[i * 4 + 3]).toBeGreaterThan(0); // a life
            expect(birth[i * 4 + 3]).toBeCloseTo(world.time, 4);
        }
        const jet = standing(world).filter((ribbon) => near(ribbon.x, right.x) && near(ribbon.z, right.z));
        expect(jet).toHaveLength(1);
        expect(jet[0].time).toBeCloseTo(world.time, 4);
        expect(jet[0].height).toBeGreaterThan(0);
        expect(jet[0].life).toBeGreaterThan(0);
        const burst = flashes(world).filter((flash) => near(flash.x, right.x) && near(flash.z, right.z));
        expect(burst).toHaveLength(1);
        expect(burst[0].time).toBeCloseTo(world.time, 4);
        expect(burst[0].size).toBeGreaterThan(0);

        // ── Sparks leave the card's edge on the piece's side, at the piece's own height ──
        const thrown = sparks(world, world.time);
        expect(thrown.length).toBeGreaterThan(0);
        const from = onScreen(camera, ...thrown[0]);
        expect(from.x).toBeCloseTo(card.x1, 4);
        expect(from.y).toBeCloseTo(boardPoint(board, 0.9, 19).y, 4);
        for (const spark of thrown) expect(spark).toEqual(thrown[0]);

        // A piece on the other side strikes the other side, and its sparks leave the other edge.
        run(world, camera, 1 / 60, 1);
        expect(world.u.ringsLive.value).toBe(1);
        world.onLock({ rows: [19], u: 0.1 });
        const left = ringBornAt(world, world.time);
        const leftStruck = onScreen(camera, left.x, 0, left.z);
        expect(leftStruck.x).toBeLessThan(card.x0);
        expect(leftStruck.x).toBeGreaterThan(0);
        expect(left.x).toBeLessThan(right.x);
        expect(onScreen(camera, ...sparks(world, world.time)[0]).x).toBeCloseTo(card.x0, 4);
        // A lock without a colour still rings, as an ember.
        expect(left.colour.x).toBeGreaterThan(left.colour.y);
        expect(left.colour.y).toBeGreaterThan(left.colour.z);
        expect(left.colour.z).toBeGreaterThan(0);
        expect(world.counts.locks).toBe(2);
        // The first ring is still running: a lock takes a slot, it does not take them all.
        expect(ringBornAt(world, 10)).toBeTruthy();
        world.dispose();
    });

    it('lands further out the further the piece is from the middle, nearer the lower it lies', () => {
        const { camera, world } = makeWorld('Low');
        const card = cardUnion(world.layout);
        const strike = (lock) => {
            run(world, camera, 1 / 60, 1);
            world.onLock(lock);
            const ring = ringBornAt(world, world.time);
            return { ...ring, screen: onScreen(camera, ring.x, 0, ring.z) };
        };
        const edge = strike({ rows: [19], u: 0.95 });
        const inner = strike({ rows: [19], u: 0.65 });
        expect(inner.screen.x).toBeGreaterThan(card.x1);
        expect(edge.screen.x).toBeGreaterThan(inner.screen.x);
        const mirrored = strike({ rows: [19], u: 0.05 });
        expect(mirrored.screen.x).toBeLessThan(card.x0);
        expect(mirrored.screen.x).toBeLessThan(strike({ rows: [19], u: 0.35 }).screen.x);
        // A piece locked high on the board strikes further up the lake.
        const high = strike({ rows: [2, 3], u: 0.95 });
        expect(high.z).toBeLessThan(edge.z);
        expect(high.screen.y).toBeLessThan(edge.screen.y);
        expect(high.screen.y).toBeGreaterThan(world.horizon);
        // The tallest piece is aimed by the row through its middle.
        const tall = strike({ rows: [16, 17, 18, 19], u: 0.95 });
        expect(tall.z).toBeLessThan(edge.z);
        expect(tall.z).toBeGreaterThan(high.z);
        // Every one of them is on open lava.
        for (const hit of [edge, inner, mirrored, high, tall]) expect(world.plan.depthAt(hit.x, hit.z)).toBeLessThan(0);
        world.dispose();
    });

    it('takes a piece in the middle of the board to either side in turn', () => {
        const { camera, world } = makeWorld('Low');
        const card = cardUnion(world.layout);
        const sides = [];
        for (let i = 0; i < 4; i++) {
            run(world, camera, 1 / 60, 1);
            world.onLock({ rows: [19], u: 0.5 });
            const ring = ringBornAt(world, world.time);
            const { x } = onScreen(camera, ring.x, 0, ring.z);
            expect(x < card.x0 || x > card.x1).toBe(true);
            sides.push(x < 0.5 ? -1 : 1);
        }
        expect(sides[1]).toBe(-sides[0]);
        expect(sides[2]).toBe(sides[0]);
        expect(sides[3]).toBe(sides[1]);
        // A lock that says nothing at all is a lock in the middle, on the floor.
        run(world, camera, 1 / 60, 1);
        expect(() => world.onLock()).not.toThrow();
        expect(ringBornAt(world, world.time)).toBeTruthy();
        expect(world.counts.locks).toBe(5);
        world.dispose();
    });

    it('strikes harder on a hard drop, and shakes the chamber', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        soft.world.onLock({ u: 0.3, rows: [19] });
        hard.world.onLock({ u: 0.3, rows: [19], hardDrop: true });
        const softRing = ringBornAt(soft.world, soft.world.time);
        const hardRing = ringBornAt(hard.world, hard.world.time);
        // The same place, a stronger ring that reaches further, a hotter pool, a bigger crown.
        expect(hardRing.x).toBeCloseTo(softRing.x, 9);
        expect(hardRing.z).toBeCloseTo(softRing.z, 9);
        expect(hardRing.strength).toBeGreaterThan(softRing.strength);
        expect(hardRing.colour.w).toBeGreaterThan(softRing.colour.w);
        expect(hard.world.heatAt(hardRing.x, hardRing.z)).toBeGreaterThan(soft.world.heatAt(softRing.x, softRing.z));
        expect(hard.world.getState().heat).toBeGreaterThan(soft.world.getState().heat);
        const crown = ({ world }, ring) => dropsFrom(world, ring.x, ring.z, { since: world.time }).length;
        expect(crown(hard, hardRing)).toBeGreaterThan(crown(soft, softRing));
        expect(sparks(hard.world, 10).length).toBeGreaterThan(sparks(soft.world, 10).length);
        const jet = ({ world }) => standing(world)[0];
        expect(jet(hard).height).toBeGreaterThan(jet(soft).height);
        expect(flashes(hard.world)[0].size).toBeGreaterThan(flashes(soft.world)[0].size);
        // It punches the lens and the post, and only the hard drop shakes the camera.
        expect(soft.world.kick).toBeGreaterThan(0);
        expect(hard.world.kick).toBeGreaterThan(soft.world.kick);
        expect(hard.world.flash).toBeGreaterThan(soft.world.flash);
        expect(soft.world.shake).toBe(0);
        expect(hard.world.shake).toBeGreaterThan(0);
        const { fov } = hard.camera;
        run(soft.world, soft.camera, 1 / 60, 1);
        run(hard.world, hard.camera, 1 / 60, 1);
        expect(hard.world.getPostState().kick).toBeGreaterThan(0.1);
        expect(hard.world.getPostState().kick).toBeGreaterThan(soft.world.getPostState().kick);
        expect(hard.world.getPostState().flash).toBeGreaterThan(soft.world.getPostState().flash);
        expect(hard.camera.fov).toBeLessThan(fov);
        expect(hard.camera.position.distanceTo(soft.camera.position)).toBeGreaterThan(1e-4);
        // The shaking dies away, and the two cameras stand together again.
        run(soft.world, soft.camera, 4);
        run(hard.world, hard.camera, 4);
        expect(hard.world.shake).toBeLessThan(1e-4);
        expect(hard.world.kick).toBeLessThan(1e-6);
        expect(hard.camera.position.distanceTo(soft.camera.position)).toBeLessThan(1e-4);
        expect(hard.camera.fov).toBeCloseTo(soft.camera.fov, 4);
        soft.world.dispose();
        hard.world.dispose();
    });

    it('strikes below the card in an upright frame, under the piece\'s own column', () => {
        const { camera, world } = makeWorld('Low', { width: 430, height: 932 });
        const card = cardUnion(world.layout);
        const board = boardFor(world.layout, 0);
        const strike = (u, rows = [19]) => {
            run(world, camera, 1 / 60, 1);
            world.onLock({ rows, u, color: '#ff8800' });
            const ring = ringBornAt(world, world.time);
            return { ...ring, screen: onScreen(camera, ring.x, 0, ring.z) };
        };
        const left = strike(0.1);
        const right = strike(0.9);
        for (const hit of [left, right, strike(0.5), strike(0.3, [4, 5])]) {
            // There is no room beside the card: the lake shows under it.
            expect(hit.screen.y).toBeGreaterThan(card.y1);
            expect(hit.screen.y).toBeLessThan(1);
            expect(hit.screen.y).toBeGreaterThan(world.horizon);
            expect(hit.screen.x).toBeGreaterThanOrEqual(board.x0 - 1e-6);
            expect(hit.screen.x).toBeLessThanOrEqual(board.x1 + 1e-6);
            expect(world.plan.depthAt(hit.x, hit.z)).toBeLessThan(0);
            expect(world.heatAt(hit.x, hit.z)).toBeGreaterThan(0);
        }
        // Left and right follow the piece's column.
        expect(left.screen.x).toBeCloseTo(boardPoint(board, 0.1, 19).x, 4);
        expect(right.screen.x).toBeCloseTo(boardPoint(board, 0.9, 19).x, 4);
        expect(left.screen.x).toBeLessThan(0.5);
        expect(right.screen.x).toBeGreaterThan(0.5);
        // The sparks still leave the card by the edge on the piece's side.
        expect(onScreen(camera, ...sparks(world, world.time - 1 / 120)[0]).x).toBeLessThan(0.5);
        expect(world.counts.locks).toBe(4);
        world.dispose();
    });

    it('reuses its ring slots and never grows a pool', () => {
        const { camera, world } = makeWorld('Low');
        const pools = [
            [world.spatter, 'aBirth', QUALITY.Low.spatter],
            [world.bombs, 'aFrom', BOMB_SLOTS * BOMB_TAIL],
            [world.flashes, 'aAt', FLASH_SLOTS],
            [world.falls, 'aT', world.falls.count],
        ];
        const slots = world.u.ringA.slice();
        const colours = world.u.ringC.slice();
        const births = world.spatter.geometry.getAttribute('aBirth');
        const { version } = births;
        const times = [];
        for (let i = 0; i < RING_SLOTS + 2; i++) {
            run(world, camera, 0.1);
            times.push(world.time);
            world.onLock({ u: (i + 0.5) / (RING_SLOTS + 2), hardDrop: i % 2 === 0, color: '#cc3300' });
        }
        expect(world.counts.locks).toBe(RING_SLOTS + 2);
        // More locks than slots: the same uniforms, every one of them written...
        expect(world.u.ringA).toHaveLength(RING_SLOTS);
        expect(world.u.ringC).toHaveLength(RING_SLOTS);
        world.u.ringA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        world.u.ringC.forEach((slot, i) => expect(slot).toBe(colours[i]));
        expect(world.u.ringA.every((slot) => slot.value.w > 0)).toBe(true);
        // ...the newest ring among them, the oldest overwritten.
        expect(ringBornAt(world, times[times.length - 1])).toBeTruthy();
        expect(ringBornAt(world, times[0])).toBeNull();
        expect(births.version).toBeGreaterThan(version);
        for (const [part, name, size] of pools) {
            expect(part.geometry.getAttribute(name).count, name).toBe(size);
            expect(part.geometry.instanceCount, name).toBe(size);
        }
        // Far more locks than any pool holds: nothing grows, nothing throws.
        for (let i = 0; i < 60; i++) world.onLock({ u: (i % 10) / 10 + 0.05, hardDrop: true, rows: [19 - (i % 12)] });
        expect(used(world.spatter, 'aBirth').length).toBeLessThanOrEqual(QUALITY.Low.spatter);
        expect(used(world.flashes, 'aAt')).toHaveLength(FLASH_SLOTS);
        for (const [part, name, size] of pools) expect(part.geometry.getAttribute(name).count, name).toBe(size);
        world.dispose();
    });

    it('rings the lake on request, round a fixed set of slots', () => {
        const { world } = makeWorld('Minimal');
        const slots = world.u.ringA.slice();
        const writes = RING_SLOTS * 2 + 1;
        for (let i = 0; i < writes; i++) world.ring(i, -i, 20 + i, 0.5, [1, 0.5, 0.25], i % 2 ? 0.4 : undefined);
        expect(world.u.ringA).toHaveLength(RING_SLOTS);
        world.u.ringA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        // The newest ring is there as it was asked for, reaching the whole way by default...
        const newest = ringBornAt(world, 20 + writes - 1);
        expect([newest.x, newest.z, newest.strength]).toEqual([writes - 1, 1 - writes, 0.5]);
        expect(newest.colour.toArray()).toEqual([1, 0.5, 0.25, 1]);
        // ...the one before it with the reach it was given, and the oldest are gone.
        expect(ringBornAt(world, 20 + writes - 2).colour.w).toBe(0.4);
        expect(ringBornAt(world, 20 + writes - RING_SLOTS)).toBeTruthy();
        expect(ringBornAt(world, 20 + writes - RING_SLOTS - 1)).toBeNull();
        expect(ringBornAt(world, 20)).toBeNull();
        world.dispose();
    });

    it('aims at the click when a mode has no board to aim through', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        expect(world.getState().layoutLive).toBe(false);
        world.onLock({ screen: { x: 0.2, y: 0.85 }, color: '#ffcc00' });
        const left = ringBornAt(world, world.time);
        const leftAt = onScreen(camera, left.x, 0, left.z);
        expect(leftAt.x).toBeCloseTo(0.2, 6);
        expect(leftAt.y).toBeCloseTo(0.85, 6);
        // A click throws no sparks from a card: it has none.
        expect(sparks(world, world.time)).toHaveLength(0);
        expect(dropsFrom(world, left.x, left.z, { since: world.time }).length).toBeGreaterThan(0);
        run(world, camera, 1 / 60, 1);
        world.onLock({ screen: { x: 0.85, y: 0.9 } });
        const right = ringBornAt(world, world.time);
        expect(onScreen(camera, right.x, 0, right.z).x).toBeCloseTo(0.85, 6);
        expect(right.x).toBeGreaterThan(left.x);
        // A click in the roof lands on the lake under it, this side of its far edge.
        run(world, camera, 1 / 60, 1);
        world.onLock({ screen: { x: 0.6, y: 0.1 } });
        const roof = ringBornAt(world, world.time);
        const roofAt = onScreen(camera, roof.x, 0, roof.z);
        expect(roofAt.x).toBeCloseTo(0.6, 6);
        expect(roofAt.y).toBeGreaterThan(world.horizon);
        expect(roofAt.y).toBeLessThan(0.85);
        // With no board on screen a lock still lands where the solo board would stand...
        run(world, camera, 1 / 60, 1);
        world.onLock({ u: 0.2, rows: [19] });
        const solo = ringBornAt(world, world.time);
        expect(onScreen(camera, solo.x, 0, solo.z).y).toBeGreaterThan(world.horizon);
        expect(world.plan.depthAt(solo.x, solo.z)).toBeLessThan(0);
        // ...and with no layout at all, to the side its column says.
        world.setLayout({
            cardCount: 0, cards: [], hud: null, boards: [],
        });
        run(world, camera, 1 / 60, 1);
        world.onLock({ u: 0.8 });
        const bare = ringBornAt(world, world.time);
        expect(onScreen(camera, bare.x, 0, bare.z).x).toBeGreaterThan(0.5);
        run(world, camera, 1 / 60, 1);
        world.onLock({ u: 0.2 });
        const other = ringBornAt(world, world.time);
        expect(onScreen(camera, other.x, 0, other.z).x).toBeLessThan(0.5);
        expect(world.counts.locks).toBe(6);
        world.dispose();
    });
});

describe('cinder drift world: clears', () => {
    it('sends a wave out from the foot of the board, one front per line, and fires the rows out of the card', () => {
        const { camera, world } = makeWorld('Low');
        const board = boardFor(world.layout, 0);
        const card = cardUnion(world.layout);
        world.onClear({ rows: [19, 18], lines: 2 });
        const slot = world.u.clearA[0].value;
        expect(slot.x).toBe(world.time);
        expect(slot.y).toBe(2);
        expect(slot.z).toBeGreaterThan(0);
        expect(slot.w).toBe(0);
        // The wave's heart is on the lake under the board, and the lake is melted there.
        const heart = world.u.heart.value;
        const under = onScreen(camera, heart.x, 0, heart.y);
        expect(under.x).toBeCloseTo((board.x0 + board.x1) / 2, 6);
        expect(under.y).toBeGreaterThan(board.y1);
        expect(under.y).toBeLessThan(1);
        expect(heart.y).toBeLessThan(0);
        expect(world.plan.depthAt(heart.x, heart.y)).toBeLessThan(0);
        expect(world.heatAt(heart.x, heart.y)).toBeGreaterThan(0);
        // The cleared rows leave the card by both edges, at their own heights.
        const jets = world.jets.uniforms;
        expect(jets.frame.value.x).toBeCloseTo(card.x0, 9);
        expect(jets.frame.value.y).toBeCloseTo(card.x1, 9);
        expect(jets.frame.value.z).toBe(world.time);
        expect(jets.frame.value.w).toBeGreaterThan(0);
        // Row 19 is the floor row; row 18 the one above it.
        expect(jets.rows.value.x).toBeCloseTo(boardPoint(board, 0.5, 19).y, 9);
        expect(jets.rows.value.y).toBeCloseTo(boardPoint(board, 0.5, 18).y, 9);
        expect(jets.rows.value.x).toBeGreaterThan(jets.rows.value.y);
        expect(jets.rows.value.x).toBeLessThan(board.y1);
        expect(jets.rows.value.y).toBeGreaterThan(board.y0);
        expect(jets.rows.value.z).toBe(-1);
        expect(jets.rows.value.w).toBe(-1);
        // And sparks go with them, from both edges of the card.
        const origins = [];
        const birth = instanced(world.spatter, 'aBirth');
        for (const i of used(world.spatter, 'aBirth')) {
            // (Everything the lake throws leaves its surface; these leave the card, in the air.)
            const [x, y, z] = [birth[i * 4], birth[i * 4 + 1], birth[i * 4 + 2]];
            if (y > 0.5) origins.push(onScreen(camera, x, y, z));
        }
        expect(origins.length).toBeGreaterThan(0);
        expect(origins.some((point) => near(point.x, card.x0, 1e-4))).toBe(true);
        expect(origins.some((point) => near(point.x, card.x1, 1e-4))).toBe(true);
        for (const point of origins) {
            expect(near(point.x, card.x0, 1e-4) || near(point.x, card.x1, 1e-4)).toBe(true);
            expect(near(point.y, jets.rows.value.x, 1e-4) || near(point.y, jets.rows.value.y, 1e-4)).toBe(true);
        }
        expect(world.counts.clears).toBe(1);
        const two = { strength: jets.frame.value.w, heat: jets.heat.value };
        // Without rows it clears from the floor up.
        world.onClear({ lines: 3 });
        expect(jets.rows.value.x).toBeGreaterThan(jets.rows.value.y);
        expect(jets.rows.value.y).toBeGreaterThan(jets.rows.value.z);
        expect(jets.rows.value.z).toBeGreaterThan(0);
        expect(jets.rows.value.w).toBe(-1);
        // More lines burn hotter and stronger.
        expect(jets.heat.value).toBeGreaterThan(two.heat);
        expect(jets.frame.value.w).toBeGreaterThan(two.strength);
        world.dispose();
    });

    it('keeps the row jets dark when no board is on screen', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        world.onClear({ lines: 2 });
        expect(world.jets.uniforms.frame.value.w).toBe(0);
        expect(world.u.clearA[0].value.z).toBeGreaterThan(0);
        expect(world.counts.fountains).toBe(FOUNTAINS_FOR_LINES[2]); // the lake still answers
        // A click's clear starts where it was clicked, and fires no rows either.
        world.onClear({ lines: 1, screen: { x: 0.15, y: 0.9 } });
        const heart = world.u.heart.value;
        const at = onScreen(camera, heart.x, 0, heart.y);
        expect(at.x).toBeCloseTo(0.15, 6);
        expect(at.y).toBeCloseTo(0.9, 6);
        expect(world.jets.uniforms.frame.value.w).toBe(0);
        // A click in the roof starts its wave on the lake.
        world.onClear({ lines: 1, screen: { x: 0.5, y: 0.05 } });
        expect(onScreen(camera, heart.x, 0, heart.y).y).toBeGreaterThan(world.horizon);
        world.dispose();
    });

    it('answers one, two and three lines ever stronger and whiter, and reuses its slots', () => {
        const { world } = makeWorld('Low');
        const slots = world.u.clearA.slice();
        const waves = [];
        for (let lines = 1; lines <= 3; lines++) {
            world.onClear({ lines });
            const slot = (lines - 1) % CLEAR_SLOTS;
            expect(world.u.clearA[slot].value.x).toBe(world.time); // at once: only four lines wait
            expect(world.u.clearA[slot].value.y).toBe(lines);
            expect(world.u.clearA[slot].value.w).toBe(0);
            waves.push({ strength: world.u.clearA[slot].value.z, colour: world.u.clearC[slot].value.clone() });
        }
        expect(world.u.clearA).toHaveLength(CLEAR_SLOTS);
        world.u.clearA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        const [one, two, three] = waves;
        expect(two.strength).toBeGreaterThan(one.strength);
        expect(three.strength).toBeGreaterThan(two.strength);
        // One line answers in the lava's body, three in its heart: the same peak, a whiter fire.
        const peak = (c) => Math.max(c.x, c.y, c.z);
        for (const wave of waves) expect(peak(wave.colour)).toBeCloseTo(1, 9);
        const { mid, hot } = CINDER_PALETTES[0];
        expect(one.colour.y / one.colour.x).toBeCloseTo(mid[1] / mid[0], 6);
        expect(three.colour.y / three.colour.x).toBeCloseTo(hot[1] / hot[0], 6);
        expect(two.colour.y).toBeGreaterThan(one.colour.y);
        expect(three.colour.y).toBeGreaterThan(two.colour.y);
        expect(three.colour.z).toBeGreaterThan(one.colour.z);
        // No line count is one line; more than four is four; nonsense is one.
        const next = () => world.u.clearA[world.counts.clears % CLEAR_SLOTS].value;
        let slot = next();
        world.onClear({});
        expect(slot.y).toBe(1);
        slot = next();
        world.onClear({ lines: 'many' });
        expect(slot.y).toBe(1);
        slot = next();
        world.onClear({ lines: 9 });
        expect(slot.y).toBe(4);
        expect(slot.w).toBe(1);
        expect(world.counts).toMatchObject({ clears: 6, quads: 1 });
        world.dispose();
    });

    it('opens a fissure across the lake: fountains for the lines cleared, and a pool where each stands', () => {
        expect(FOUNTAINS_FOR_LINES).toHaveLength(5);
        for (let lines = 1; lines <= 4; lines++) {
            expect(FOUNTAINS_FOR_LINES[lines]).toBeGreaterThan(FOUNTAINS_FOR_LINES[lines - 1]);
            expect(FOUNTAINS_FOR_LINES[lines] % 2).toBe(0); // in pairs, one each side of the card
        }
        expect(FOUNTAINS_FOR_LINES[4]).toBe(FOUNTAIN_SLOTS);
        const { camera, world } = makeWorld('Low');
        const heights = [];
        for (let lines = 1; lines <= 3; lines++) {
            world.seek(10);
            freeze(world, camera);
            world.onClear({ lines });
            const stand = FOUNTAINS_FOR_LINES[lines];
            expect(world.counts.fountains, `${lines} lines`).toBe(stand);
            const heart = world.u.heart.value;
            const ribbons = standing(world);
            expect(ribbons, `${lines} lines`).toHaveLength(stand);
            // The pairs nearest the card stand, each as the wave reaches it.
            for (let k = 0; k < stand; k++) {
                const fountain = world.plan.fountains[k];
                const ribbon = ribbons.find((r) => near(r.x, fountain.x) && near(r.z, fountain.z));
                expect(ribbon, `fountain ${k}`).toBeTruthy();
                const pass = clearPassTime(Math.hypot(fountain.x - heart.x, fountain.z - heart.y));
                expect(ribbon.time).toBeGreaterThanOrEqual(world.time + pass - 1e-4);
                expect(ribbon.time).toBeLessThan(world.time + pass + 0.5);
                expect(ribbon.life).toBeGreaterThan(0);
                expect(ribbon.height).toBeGreaterThan(0);
                expect(ribbon.width).toBeGreaterThan(0);
                // It throws drops over its life, upward, starting as it stands.
                const drops = dropsFrom(world, fountain.x, fountain.z, { radius: 0.6, since: ribbon.time });
                expect(drops.length, `fountain ${k}`).toBeGreaterThan(0);
                const velocity = instanced(world.spatter, 'aVel');
                for (const i of drops) expect(velocity[i * 4 + 1]).toBeGreaterThan(0);
                // And a burst of light as it breaks the crust.
                expect(flashedAt(world, fountain.x, fountain.z), `fountain ${k}`).toBe(true);
            }
            // (How tall the pair beside the card stands.)
            const pair = world.plan.fountains.slice(0, 2)
                .map((f) => ribbons.find((r) => near(r.x, f.x) && near(r.z, f.z)));
            heights.push((pair[0].height + pair[1].height) / 2);
            // A pool is promised under each, for the moment it stands.
            expect(world.pending, `${lines} lines`).toHaveLength(stand);
            expect(world.getState().pending).toBe(stand);
            for (const fountain of world.plan.fountains.slice(0, stand)) {
                expect(world.heatAt(fountain.x, fountain.z)).toBe(0);
            }
            // The clock passes them: each pool is melted on the frame its moment comes, none early.
            let melted = 0;
            for (let frame = 0; frame < 600 && world.pending.length; frame++) {
                const waiting = world.pending.slice();
                run(world, camera, 1 / 60, 1);
                for (const pool of waiting) {
                    if (world.pending.includes(pool)) {
                        expect(pool.time).toBeGreaterThan(world.time);
                    } else {
                        expect(pool.time).toBeLessThanOrEqual(world.time);
                        expect(pool.time).toBeGreaterThan(world.time - 1 / 60 - 1e-9);
                        expect(world.heatAt(pool.x, pool.z)).toBeGreaterThan(0);
                        melted += 1;
                    }
                }
            }
            expect(melted, `${lines} lines`).toBe(stand);
            expect(world.pending).toHaveLength(0);
            // The fountains light the chamber while they stand.
            expect(world.u.curtain.value).toBeGreaterThan(0);
            expect(world.getState().curtain).toBe(world.u.curtain.value);
        }
        // More lines, taller fountains.
        expect(heights[1]).toBeGreaterThan(heights[0]);
        expect(heights[2]).toBeGreaterThan(heights[1]);
        world.dispose();
    });

    it('closes the iris and thickens the haze at once, and kicks the camera a beat after a clear', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        world.onClear({ lines: 2 });
        expect(world.kick).toBe(0);
        expect(world.storm).toBeGreaterThan(0);
        run(world, camera, 1 / 120, 1);
        const post = world.getPostState();
        expect(post.haze).toBeGreaterThan(rest.haze);
        // The iris closes as the chamber flares, so its colours survive.
        expect(post.exposure).toBeLessThan(rest.exposure);
        expect(post.exposure).toBeGreaterThan(0);
        expect(world.u.clearLive.value).toBe(1);
        let peak = 0;
        for (let i = 0; i < 96; i++) {
            run(world, camera, CLEAR_TRAVEL / 96, 1);
            peak = Math.max(peak, world.kick);
        }
        expect(peak).toBeGreaterThan(0.1);
        world.dispose();
    });

    it('holds its breath on four lines, then stands the whole fissure up and throws bombs across the chamber', () => {
        const { camera, world } = makeWorld('Low');
        const tier = QUALITY.Low;
        const rest = { ...world.getPostState() };
        const restHot = world.u.hot.value.clone();
        expect(bombs(world)).toHaveLength(0);
        const t0 = world.time;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const slot = world.u.clearA[0].value;
        expect(slot.y).toBe(4);
        expect(slot.w).toBe(1); // white heat
        // The wave waits for the breath to be let go.
        expect(slot.x).toBeCloseTo(t0 + HUSH_HOLD, 9);
        const thrown = Math.min(BOMB_SLOTS, tier.bombs);
        expect(world.counts).toMatchObject({
            clears: 1, quads: 1, fountains: FOUNTAIN_SLOTS, bombs: thrown,
        });
        const { surge } = world.getState();
        expect(surge).toBeGreaterThan(0);
        // It fires toward the white of the forge: at its peak like every wave, still fire (red over
        // green over blue), and no less white than the lava's own heart, no whiter than white heat.
        const fire = world.u.clearC[0].value.toArray();
        const atPeak = (rgb) => rgb.map((c) => c / Math.max(...rgb));
        const heart = atPeak(CINDER_PALETTES[0].hot);
        const whitest = atPeak(WHITE_HEAT);
        expect(Math.max(...fire)).toBeCloseTo(1, 9);
        expect(fire[0]).toBeGreaterThanOrEqual(fire[1]);
        expect(fire[1]).toBeGreaterThan(fire[2]);
        for (let c = 0; c < 3; c++) {
            expect(fire[c], `channel ${c}`).toBeGreaterThanOrEqual(Math.min(heart[c], whitest[c]) - 1e-9);
            expect(fire[c], `channel ${c}`).toBeLessThanOrEqual(Math.max(heart[c], whitest[c]) + 1e-9);
        }
        // A shock runs out through the rock, born with the wave.
        expect(world.u.shock.value.x).toBeCloseTo(t0 + HUSH_HOLD, 9);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        // The whole fissure will stand, no fountain before the breath is let go.
        const ribbons = standing(world);
        expect(ribbons).toHaveLength(FOUNTAIN_SLOTS);
        for (const fountain of world.plan.fountains) {
            const ribbon = ribbons.find((r) => near(r.x, fountain.x) && near(r.z, fountain.z));
            expect(ribbon).toBeTruthy();
            expect(ribbon.time).toBeGreaterThan(t0 + HUSH_HOLD);
            expect(ribbon.time).toBeLessThan(t0 + HUSH_HOLD + CLEAR_TRAVEL);
        }

        // ── The bombs: each leaves a fountain's foot after the hush and comes down on the lake ──
        const inFlight = bombs(world);
        expect(inFlight).toHaveLength(thrown);
        const tint = instanced(world.bombs, 'aTint');
        const from = instanced(world.bombs, 'aFrom');
        const landings = [];
        for (const bomb of inFlight) {
            expect(bomb.time).toBeGreaterThan(t0 + HUSH_HOLD);
            expect(bomb.flight).toBeGreaterThan(0);
            expect(world.plan.fountains.some((f) => near(f.x, bomb.from[0]) && near(f.z, bomb.from[2]))).toBe(true);
            const landing = bombPoint(bomb.from, bomb.velocity, bomb.flight);
            expect(landing[1]).toBeCloseTo(0, 3);
            expect(flightTime(bomb.velocity[1], bomb.from[1])).toBeCloseTo(bomb.flight, 3);
            // Up and over: it is above where it left half-way there.
            expect(bombPoint(bomb.from, bomb.velocity, bomb.flight / 2)[1]).toBeGreaterThan(bomb.from[1]);
            // Out across the lake, ahead of the camera.
            expect(landing[0]).toBeGreaterThan(LAKE.x0);
            expect(landing[0]).toBeLessThan(LAKE.x1);
            expect(landing[2]).toBeLessThan(0);
            expect(landing[2]).toBeGreaterThan(LAKE.z0);
            landings.push({ x: landing[0], z: landing[2], time: bomb.time + bomb.flight });
            // The head and the embers strung behind it share one throw.
            for (let j = 0; j < BOMB_TAIL; j++) {
                const i = (bomb.slot * BOMB_TAIL + j) * 4;
                expect(from[i + 3]).toBe(from[bomb.slot * BOMB_TAIL * 4 + 3]);
                expect(tint[i + 3]).toBeCloseTo(j / (BOMB_TAIL - 1), 6);
            }
        }
        // A pool is promised under every fountain and where every bomb will land.
        expect(world.pending).toHaveLength(FOUNTAIN_SLOTS + thrown);
        for (const landing of landings) {
            const pool = world.pending.find((p) => near(p.x, landing.x, 1e-2) && near(p.z, landing.z, 1e-2));
            expect(pool).toBeTruthy();
            expect(pool.time).toBeCloseTo(landing.time, 3);
            expect(pool.time).toBeGreaterThan(t0 + HUSH_HOLD);
        }
        // Both sides of the chamber get some.
        expect(landings.some((landing) => landing.x < 0)).toBe(true);
        expect(landings.some((landing) => landing.x > 0)).toBe(true);

        // ── The hush: every light sinks ──
        run(world, camera, HUSH_HOLD * 0.9);
        expect(world.getState().breath).toBeLessThan(0.5);
        expect(world.u.breath.value).toBe(world.getState().breath);
        expect(world.u.curtain.value).toBe(0);
        expect(world.getPostState().shafts).toBeLessThan(rest.shafts);

        // ── Then everything goes up ──
        let kick = 0;
        let shake = 0;
        for (let i = 0; i < 36; i++) {
            run(world, camera, (HUSH_HOLD * 0.1 + 0.5) / 36, 1);
            kick = Math.max(kick, world.kick);
            shake = Math.max(shake, world.shake);
        }
        expect(kick).toBeGreaterThan(0.1);
        expect(shake).toBeGreaterThan(0.1);
        expect(world.getState().breath).toBeGreaterThan(0.95);
        expect(world.u.curtain.value).toBeGreaterThan(0.2); // the curtain of fire stands
        const post = world.getPostState();
        expect(post.haze).toBeGreaterThan(rest.haze);
        expect(post.exposure).toBeLessThan(rest.exposure); // the iris closes on the flare
        expect(post.exposure).toBeGreaterThan(0);
        expect(world.getState().fallGain).toBeGreaterThan(1); // the fall swells
        expect(world.u.surge.value).toBe(world.getState().surge);
        // Every fire burns toward white.
        const white = new THREE.Vector3(...WHITE_HEAT);
        expect(world.u.hot.value.distanceTo(white)).toBeLessThan(restHot.distanceTo(white));
        // The crust races, and the cinders storm upward.
        const { drift, lift } = world;
        run(world, camera, 0.5);
        expect(world.drift - drift).toBeGreaterThan(DRIFT_SPEED * 0.5 * 1.1);
        expect(world.lift - lift).toBeGreaterThan(0.5 * 1.1);

        // ── The bombs land: the lake is melted where each comes down ──
        // (Every fountain has stood by now, and has its pool; the bombs are still in the air.)
        expect(world.pending).toHaveLength(thrown);
        let landed = 0;
        for (let frame = 0; frame < 900 && world.pending.length; frame++) {
            const waiting = world.pending.slice();
            run(world, camera, 1 / 60, 1);
            for (const pool of waiting) {
                if (!world.pending.includes(pool)) {
                    expect(pool.time).toBeLessThanOrEqual(world.time);
                    expect(world.heatAt(pool.x, pool.z)).toBeGreaterThan(0);
                    landed += 1;
                }
            }
        }
        expect(landed).toBe(thrown);
        expect(world.pending).toHaveLength(0);

        // ── And cools ──
        expect(world.getState().surge).toBeCloseTo(surge * Math.exp(-(world.time - t0) / SURGE_COOL), 6);
        run(world, camera, SURGE_COOL * 8, 600);
        expect(world.getState().surge).toBeLessThan(0.01);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        expect(world.getState().fallGain).toBeCloseTo(1, 2);
        expect(world.getPostState().exposure).toBeGreaterThan(0.99);
        expect(world.getPostState().shafts).toBeCloseTo(rest.shafts, 2);
        expect(world.getPostState().haze).toBeCloseTo(1, 2);
        expect(world.u.hot.value.distanceTo(restHot)).toBeLessThan(1e-3);
        expect(world.counts).toMatchObject({ clears: 1, quads: 1, bombs: thrown });
        world.dispose();
    });

    it('fires a perfect clear as a four-line clear, hotter still', () => {
        const quad = makeWorld('Low');
        const perfect = makeWorld('Low');
        quad.world.onClear({ lines: 4 });
        perfect.world.onClear({ lines: 1, perfect: true });
        expect(perfect.world.u.clearA[0].value.toArray().slice(0, 2)).toEqual([perfect.world.time + HUSH_HOLD, 4]);
        expect(perfect.world.u.clearA[0].value.w).toBe(1);
        // Every fountain stands, however few lines it took.
        expect(perfect.world.counts).toMatchObject({
            quads: 1, fountains: FOUNTAIN_SLOTS, bombs: quad.world.counts.bombs,
        });
        expect(standing(perfect.world)).toHaveLength(FOUNTAIN_SLOTS);
        expect(perfect.world.getState().surge).toBeGreaterThan(quad.world.getState().surge);
        run(perfect.world, perfect.camera, HUSH_HOLD * 0.9);
        expect(perfect.world.getState().breath).toBeLessThan(0.5);
        quad.world.dispose();
        perfect.world.dispose();
    });

    it('turns the crust round the foot of the board on a T-spin', () => {
        const plain = makeWorld('Low');
        const { camera, world } = makeWorld('Low');
        expect(world.u.whirl.value.w).toBe(0);
        plain.world.onClear({ lines: 2 });
        world.onClear({ lines: 2, tspin: true });
        const whirl = world.u.whirl.value;
        const heart = world.u.heart.value;
        expect(whirl.z).toBe(world.time);
        expect(whirl.w).not.toBe(0);
        // Round a point on the lake by the wave's heart, further up the chamber.
        expect(whirl.x).toBe(heart.x);
        expect(whirl.y).toBeLessThan(heart.y);
        expect(world.plan.depthAt(whirl.x, whirl.y)).toBeLessThan(0);
        // It stirs the chamber more than the same clear without the spin, and is no four-line clear.
        expect(world.storm).toBeGreaterThan(plain.world.storm);
        expect(world.counts.quads).toBe(0);
        expect(plain.world.u.whirl.value.w).toBe(0);
        const first = whirl.w;
        // The next one turns the other way.
        run(world, camera, 0.5);
        world.onClear({ lines: 1, tspin: true });
        expect(whirl.z).toBe(world.time);
        expect(Math.sign(whirl.w)).toBe(-Math.sign(first));
        expect(Math.abs(whirl.w)).toBe(Math.abs(first));
        // A clear without one leaves the crust turning as it was.
        run(world, camera, 0.5);
        const turning = whirl.toArray();
        world.onClear({ lines: 3 });
        expect(whirl.toArray()).toEqual(turning);
        // The chamber settles.
        const stirred = world.storm;
        run(world, camera, 8);
        expect(world.storm).toBeLessThan(stirred * 0.1);
        plain.world.dispose();
        world.dispose();
    });
});

describe('cinder drift world: combos and levels', () => {
    it('raises the chamber\'s pressure with the chain, and cracks a fissure for every step past the first', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({
            combo: 0, power: 0, fissures: 0, fallGain: 1,
        });
        const rest = { ...world.getPostState(), drift: world.drift, lift: world.lift };
        run(world, camera, 1);
        rest.drift = world.drift - rest.drift; // how far the crust drifts, and the cinders rise, in a second at rest
        rest.lift = world.lift - rest.lift;
        expect(rest.drift).toBeCloseTo(DRIFT_SPEED, 9);

        // A single clear is not a chain: the pressure stirs, no fissure opens.
        world.onCombo(1);
        run(world, camera, 3);
        expect(world.power).toBeCloseTo(powerForCombo(1), 2);
        expect(world.getState().fissures).toBe(0);

        // Four in a row: three fissures, one after another, nearest first.
        world.onCombo(4);
        const cracked = [];
        const birth = instanced(world.spatter, 'aBirth');
        for (let frame = 0; frame < 250; frame++) {
            run(world, camera, 1 / 60, 1);
            if (frame === 5) {
                // Easing in: neither the pressure nor the cracks arrive at once.
                expect(world.power).toBeGreaterThan(powerForCombo(1));
                expect(world.power).toBeLessThan(powerForCombo(4));
                expect(world.fissures).toBeGreaterThan(0);
                expect(world.fissures).toBeLessThan(fissuresForCombo(4));
            }
            world.plan.streams.forEach((stream, index) => {
                if (cracked.includes(index)) return;
                // The cliff cracks: sparks from the stream's lip, and a burst of light, that frame.
                const [x, y, z] = stream.lip;
                const drops = dropsFrom(world, x, z, { since: world.time });
                if (!drops.length) return;
                expect(birth[drops[0] * 4 + 1], `stream ${index}`).toBeCloseTo(y, 4);
                expect(flashedAt(world, x, z), `stream ${index}`).toBe(true);
                cracked.push(index);
            });
        }
        expect(cracked).toEqual(Array.from({ length: fissuresForCombo(4) }, (_, index) => index));
        expect(world.power).toBeCloseTo(powerForCombo(4), 3);
        expect(world.fissures).toBeCloseTo(fissuresForCombo(4), 3);
        expect(world.getState()).toMatchObject({ combo: 4, power: world.power, fissures: world.fissures });
        expect(world.u.power.value).toBe(world.power);
        expect(world.u.fissures.value).toBe(world.fissures);
        // An open stream pours into the lake: its foot is kept molten.
        for (let i = 0; i < fissuresForCombo(4); i++) {
            const { foot } = world.plan.streams[i];
            expect(world.heatAt(foot[0], foot[2]), `stream ${i}`).toBeGreaterThan(0);
        }

        // The chamber can crack only so many times.
        world.onCombo(STREAM_SLOTS + 20);
        run(world, camera, 6);
        expect(world.fissures).toBeCloseTo(STREAM_SLOTS, 2);
        expect(world.fissures).toBeLessThanOrEqual(STREAM_SLOTS);
        expect(world.power).toBeLessThanOrEqual(1);
        expect(world.power).toBeCloseTo(powerForCombo(STREAM_SLOTS + 20), 2);
        // The pressure swells the fall, thickens the haze, closes the iris and drives the crust and the cinders.
        expect(world.getState().fallGain).toBeGreaterThan(1.05);
        expect(world.u.fallGain.value).toBe(world.getState().fallGain);
        const post = world.getPostState();
        expect(post.haze).toBeGreaterThan(rest.haze);
        expect(post.exposure).toBeLessThan(rest.exposure);
        const { drift, lift } = world;
        run(world, camera, 1);
        expect(world.drift - drift).toBeGreaterThan(rest.drift * 1.2);
        expect(world.lift - lift).toBeGreaterThan(rest.lift * 1.2);

        // The chain breaks: the chamber lets its breath go, and everything falls back.
        world.onCombo(0);
        expect(world.dip).toBeGreaterThan(0);
        run(world, camera, 0.2);
        expect(world.getState().breath).toBeLessThan(0.95);
        expect(world.fissures).toBeLessThan(STREAM_SLOTS);
        run(world, camera, 14);
        expect(world.power).toBeLessThan(0.01);
        expect(world.fissures).toBeLessThan(0.01);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        expect(world.getState().fallGain).toBeCloseTo(1, 2);
        // A single clear that is not followed up is no broken chain.
        world.dip = 0;
        world.onCombo(1);
        world.onCombo(0);
        expect(world.dip).toBe(0);
        // Nonsense is no chain.
        world.onCombo(NaN);
        expect(world.combo).toBe(0);
        world.onCombo(-4);
        expect(world.combo).toBe(0);
        world.onCombo(undefined);
        expect(world.combo).toBe(0);
        world.onCombo('3');
        expect(world.combo).toBe(3);
        world.onCombo(2.6);
        expect(world.combo).toBe(3);
        world.dispose();
    });

    it('burns a different fire with the level and cycles through its palettes', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ level: 1, palette: CINDER_PALETTES[0].name });
        // Follow the colour that changes most between the first two palettes.
        const vector = (rgb) => new THREE.Vector3(rgb[0], rgb[1], rgb[2]);
        const [from, to] = CINDER_PALETTES;
        const changes = PALETTE_KEYS.map((name) => vector(from[name]).distanceTo(vector(to[name])));
        const key = PALETTE_KEYS[changes.indexOf(Math.max(...changes))];
        const span = Math.max(...changes);
        expect(span).toBeGreaterThan(0);
        const before = world.u[key].value.clone();
        world.levelUp(2);
        expect(world.getState()).toMatchObject({ level: 2, palette: CINDER_PALETTES[1].name });
        // The chamber marks it: it stirs, flashes, and a shock runs through the rock.
        expect(world.storm).toBeGreaterThan(0);
        expect(world.flash).toBeGreaterThan(0);
        expect(world.u.shock.value.x).toBe(world.time);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        // The colours ease across, they do not snap.
        run(world, camera, 1 / 60, 1);
        const moved = world.u[key].value.distanceTo(before);
        expect(moved).toBeGreaterThan(0);
        expect(moved).toBeLessThan(span * 0.1);
        run(world, camera, 8);
        expect(world.u[key].value.distanceTo(vector(CINDER_PALETTES[1][key]))).toBeLessThan(span * 0.02);
        expect(world.u[key].value.distanceTo(before)).toBeGreaterThan(span * 0.9);
        // Past the last palette it starts again.
        for (let level = 1; level <= CINDER_PALETTES.length * 2 + 1; level++) {
            world.levelUp(level);
            expect(world.getState().palette).toBe(CINDER_PALETTES[(level - 1) % CINDER_PALETTES.length].name);
        }
        // A capture rests on a level's palette at once, without the fanfare.
        run(world, camera, 12);
        const { storm } = world;
        const shock = world.u.shock.value.toArray();
        world.levelUp(3, { silent: true });
        expect(world.storm).toBe(storm);
        expect(world.u.shock.value.toArray()).toEqual(shock);
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.getState().palette).toBe(CINDER_PALETTES[2].name);
        for (const name of PALETTE_KEYS) {
            CINDER_PALETTES[2][name].forEach((channel, k) => {
                expect(world.u[name].value.getComponent(k), name).toBeCloseTo(channel, 9);
            });
        }
        // Nonsense is level one.
        world.levelUp(NaN);
        expect(world.getState().level).toBe(1);
        world.levelUp(-3);
        expect(world.getState().level).toBe(1);
        world.levelUp('4');
        expect(world.getState().level).toBe(4);
        world.dispose();
    });

    it('feeds the post finite, bounded numbers through every event', () => {
        const { camera, world } = makeWorld('Low');
        const post = world.getPostState();
        expect(world.getPostState()).toBe(post); // one reused object
        const inspect = (label) => {
            for (const key of POST_KEYS) expect(Number.isFinite(post[key]), `${label}: ${key}`).toBe(true);
            for (const key of ['flash', 'kick', 'shafts', 'horizon']) {
                expect(post[key], `${label}: ${key}`).toBeGreaterThanOrEqual(0);
            }
            // The bloom may be dimmed while the chamber is ablaze, never turned inside out
            // (the post scales its glare by 1 + boost / 2).
            expect(1 + post.bloomBoost * 0.5, label).toBeGreaterThan(0);
            expect(post.exposure, label).toBeGreaterThan(0);
            expect(post.exposure, label).toBeLessThanOrEqual(1);
            expect(post.haze, label).toBeGreaterThanOrEqual(1);
            expect(post.horizon, label).toBeLessThanOrEqual(1);
            expect(post.heart, label).toBe(world.heart);
            expect(Number.isFinite(post.heart.x) && Number.isFinite(post.heart.y), label).toBe(true);
        };
        inspect('rest');
        expect(post).toMatchObject(AT_REST);
        const events = [
            () => world.onLock({ u: 0.2, hardDrop: true, color: '#fff5e6' }),
            () => world.onClear({ lines: 4, rows: [19, 18, 17, 16], tspin: true }),
            () => world.onCombo(12),
            () => world.levelUp(3),
            () => world.onClear({ lines: 1, perfect: true }),
            () => world.onLock({ screen: { x: 0.9, y: 0.02 }, hardDrop: true }),
            () => world.onCombo(0),
            () => world.onClear({ lines: 3, screen: { x: 0.1, y: 0.99 } }),
        ];
        events.forEach((event, index) => {
            event();
            for (let frame = 0; frame < 30; frame++) {
                run(world, camera, 1 / 60, 1);
                inspect(`event ${index}, frame ${frame}`);
            }
        });
        // And everything the chamber remembers is a number too.
        const state = world.getState();
        const numbers = [
            'time', 'power', 'surge', 'storm', 'breath', 'fissures', 'fallGain', 'curtain', 'drift', 'heat',
        ];
        for (const key of numbers) expect(Number.isFinite(state[key]), key).toBe(true);
        expect(world.heat.data.every((heat) => Number.isFinite(heat))).toBe(true);
        for (const slot of [...world.u.ringA, ...world.u.clearA]) {
            expect(slot.value.toArray().every((v) => Number.isFinite(v))).toBe(true);
        }
        world.dispose();
    });
});

describe('cinder drift world: time', () => {
    const script = (world, camera, fps) => {
        world.onLock({ u: 0.3, hardDrop: true, color: '#ffcc00' });
        world.onClear({ lines: 2 });
        world.onCombo(3);
        run(world, camera, 1.5, Math.round(1.5 * fps));
        world.onClear({ lines: 4 });
        world.onCombo(4);
        run(world, camera, 2, Math.round(2 * fps));
        world.onLock({ u: 0.8, color: '#cc3300' });
        world.levelUp(2);
        run(world, camera, 1.5, Math.round(1.5 * fps));
    };

    /** What a frame is made of: the state, the post's inputs, every event slot, every pool, the lake's memory. */
    const snapshot = (world, camera) => {
        const flat = (value) => (typeof value === 'object' ? Object.values(value) : value);
        const births = (part, name, component = 3) => Array.from(instanced(part, name))
            .filter((v, i) => i % 4 === component);
        /** A live slot's whole vector; a dormant slot keeps whatever it last held, which nothing draws. */
        const live = (part, name, clock) => {
            const array = instanced(part, name);
            const times = instanced(part, clock);
            return Array.from(array).filter((v, i) => times[Math.floor(i / 4) * 4 + 3] > -50);
        };
        return [
            ...Object.values(world.getState()).flatMap(flat),
            ...POST_KEYS.map((key) => world.getPostState()[key]),
            ...world.u.ringA.flatMap((slot) => slot.value.toArray()),
            ...world.u.clearA.flatMap((slot) => slot.value.toArray()),
            ...world.u.clearC.flatMap((slot) => slot.value.toArray()),
            ...world.u.shock.value.toArray(),
            ...world.u.whirl.value.toArray(),
            ...world.u.heart.value.toArray(),
            ...world.jets.uniforms.frame.value.toArray(),
            ...PALETTE_KEYS.flatMap((key) => world.u[key].value.toArray()),
            ...births(world.spatter, 'aBirth'),
            ...live(world.spatter, 'aBirth', 'aBirth'),
            ...live(world.spatter, 'aVel', 'aBirth'),
            ...live(world.spatter, 'aTint', 'aBirth'),
            ...live(world.spatter, 'aPhys', 'aBirth'),
            ...births(world.bombs, 'aFrom'),
            ...live(world.bombs, 'aVel', 'aFrom'),
            ...births(world.flashes, 'aAt'),
            ...births(world.falls, 'aT', 0),
            ...world.heat.data,
            world.heat.ref,
            world.u.heatRef.value,
            world.drift,
            world.flow,
            world.lift,
            world.pending.length,
            ...camera.matrixWorld.toArray(),
        ];
    };

    it('reaches the same state at 30 and at 240 frames a second', () => {
        const slow = makeWorld('Low');
        const fast = makeWorld('Low');
        script(slow.world, slow.camera, 30);
        script(fast.world, fast.camera, 240);
        const a = slow.world.getState();
        const b = fast.world.getState();
        expect(a.time).toBeCloseTo(b.time, 9);
        expect(a.counts).toEqual(b.counts);
        expect(a).toMatchObject({
            combo: b.combo, level: b.level, palette: b.palette, pending: b.pending,
        });
        expect(a.heat).toBeGreaterThan(0);
        expect(a.surge).toBeGreaterThan(0);
        for (const key of ['power', 'surge', 'storm', 'breath', 'fissures', 'curtain']) {
            expect(a[key], key).toBeCloseTo(b[key], 3);
        }
        // The slow clocks, and what is eased toward them, are integrated frame by frame: close, not identical.
        expect(a.fallGain).toBeCloseTo(b.fallGain, 1);
        expect(a.drift / b.drift).toBeCloseTo(1, 2);
        expect(slow.world.flow / fast.world.flow).toBeCloseTo(1, 2);
        expect(slow.world.lift / fast.world.lift).toBeCloseTo(1, 2);
        expect(a.heat / b.heat).toBeCloseTo(1, 1);
        expect(a.heart.x).toBeCloseTo(b.heart.x, 3);
        expect(a.heart.y).toBeCloseTo(b.heart.y, 3);
        const postA = slow.world.getPostState();
        const postB = fast.world.getPostState();
        for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure', 'haze', 'horizon']) {
            expect(postA[key], key).toBeCloseTo(postB[key], 3);
        }
        expect(slow.world.u.mid.value.distanceTo(fast.world.u.mid.value)).toBeLessThan(1e-3);
        // Event slots hold timestamps: they are identical whatever the frame rate.
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            expect(slow.world.u.clearA[i].value.toArray()).toEqual(fast.world.u.clearA[i].value.toArray());
        }
        expect(slow.world.u.shock.value.toArray()).toEqual(fast.world.u.shock.value.toArray());
        // A ring's place (and the moment a bomb lands, which follows from where the wave started)
        // depends on the camera's pose that frame: the same to a hair.
        for (let i = 0; i < RING_SLOTS; i++) {
            const ringA = slow.world.u.ringA[i].value.toArray();
            const ringB = fast.world.u.ringA[i].value.toArray();
            expect(ringA[2], `ring slot ${i}`).toBeCloseTo(ringB[2], 5);
            for (let k = 0; k < 4; k++) expect(ringA[k], `ring slot ${i}[${k}]`).toBeCloseTo(ringB[k], 2);
        }
        slow.world.dispose();
        fast.world.dispose();
    });

    it('is the same chamber twice: two worlds given the same script agree to the last bit', () => {
        const a = makeWorld('Low');
        const b = makeWorld('Low');
        script(a.world, a.camera, 60);
        script(b.world, b.camera, 60);
        expect(a.world.getState()).toEqual(b.world.getState());
        expect({ ...a.world.getPostState() }).toEqual({ ...b.world.getPostState() });
        const first = snapshot(a.world, a.camera);
        const second = snapshot(b.world, b.camera);
        expect(first.length).toBeGreaterThan(1000);
        expect(second).toHaveLength(first.length);
        let differing = 0;
        for (let i = 0; i < first.length; i++) if (!Object.is(first[i], second[i])) differing += 1;
        expect(differing).toBe(0);
        a.world.dispose();
        b.world.dispose();
    });

    it('replays a frame: seek, then the same steps, gives the same chamber whatever came before', () => {
        const { camera, world } = makeWorld('Low');
        script(world, camera, 60);
        const first = snapshot(world, camera);
        const state = world.getState();
        expect(state.heat).toBeGreaterThan(0);
        expect(state.counts).toMatchObject({ locks: 2, clears: 2, quads: 1 });
        // Something else entirely in between...
        world.onCombo(9);
        world.onLock({ u: 0.5, hardDrop: true });
        world.onClear({ lines: 3, tspin: true });
        world.levelUp(4);
        world.setReducedMotion(true);
        run(world, camera, 3);
        world.setReducedMotion(false);
        expect(world.getState()).not.toEqual(state);
        // ...then the capture's recipe again.
        world.seek(10);
        freeze(world, camera);
        script(world, camera, 60);
        expect(world.getState()).toEqual(state);
        const again = snapshot(world, camera);
        expect(again).toHaveLength(first.length);
        // The same frame. (To a rounding error, not to the last bit: a seek eases the palette
        // back onto the first one, and lands within one unit in the last place of it.)
        let worst = 0;
        for (let i = 0; i < first.length; i++) {
            if (typeof first[i] === 'number') worst = Math.max(worst, Math.abs(first[i] - again[i]));
            else expect(again[i]).toBe(first[i]);
        }
        expect(worst).toBeLessThan(1e-12);
        world.dispose();
    });

    it('holds a frozen frame still: a frame with no time in it changes nothing', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.3, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(5);
        world.levelUp(2);
        run(world, camera, 0.7);
        // The first frozen frame settles what was easing (a capture rests on its targets)...
        freeze(world, camera);
        const held = snapshot(world, camera);
        const { version } = world.heat;
        // ...and every one after it is the same frame.
        for (let i = 0; i < 3; i++) {
            freeze(world, camera);
            world.update({ time: world.time, delta: 0 }, camera);
            world.update({ time: world.time }, camera); // no delta is no time
            const now = snapshot(world, camera);
            let differing = 0;
            for (let k = 0; k < held.length; k++) if (!Object.is(held[k], now[k])) differing += 1;
            expect(differing).toBe(0);
        }
        expect(world.heat.version).toBe(version);
        world.dispose();

        // The chamber's own life never fires in a frozen frame, however far the clock is moved.
        const rest = makeWorld('Low');
        rest.world.update({ time: rest.world.time + 7.3, delta: 0 }, rest.camera);
        expect(used(rest.world.spatter, 'aBirth')).toHaveLength(0);
        expect(rest.world.getState()).toMatchObject({ heat: 0, power: 0, breath: 1 });
        // A negative step is no step.
        const { drift } = rest.world;
        rest.world.update({ time: rest.world.time, delta: -1 }, rest.camera);
        expect(rest.world.drift).toBe(drift);
        rest.world.dispose();
    });

    it('drops every event in flight when it seeks, and puts the clocks where the time says', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4, rows: [19, 18, 17, 16], tspin: true });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1);
        expect(world.getState().pending).toBeGreaterThan(0);
        world.seek(40);
        expect(world.time).toBe(40);
        expect(world.getState()).toMatchObject({
            time: 40,
            combo: 0,
            power: 0,
            surge: 0,
            storm: 0,
            breath: 1,
            fissures: 0,
            fallGain: 1,
            curtain: 0,
            level: 1,
            palette: CINDER_PALETTES[0].name,
            heat: 0,
            pending: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, fountains: 0, bombs: 0,
            },
        });
        // The crust is where forty seconds of drifting at rest would have carried it.
        expect(world.drift).toBeCloseTo(40 * DRIFT_SPEED, 12);
        expect(world.getState().drift).toBe(world.drift);
        expect(world.flow).toBe(40);
        expect(world.lift).toBe(40);
        expect(world.kick).toBe(0);
        expect(world.shake).toBe(0);
        expect(world.flash).toBe(0);
        for (let i = 0; i < RING_SLOTS; i++) expect(world.u.ringA[i].value.w).toBe(0);
        for (let i = 0; i < CLEAR_SLOTS; i++) expect(world.u.clearA[i].value.z).toBe(0);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.u.whirl.value.w).toBe(0);
        expect(world.jets.uniforms.frame.value.w).toBe(0);
        for (const [part, name] of [[world.spatter, 'aBirth'], [world.bombs, 'aFrom'], [world.flashes, 'aAt']]) {
            expect(used(part, name), name).toHaveLength(0);
        }
        expect(standing(world)).toHaveLength(0);
        expect(world.heat.ref).toBe(40);
        expect(world.heat.data.every((heat) => heat === 0)).toBe(true);
        // The next frame draws the chamber at rest, in its first palette.
        freeze(world, camera);
        expect(world.u.time.value).toBe(40);
        expect(world.u.drift.value).toBe(world.drift);
        expect(world.u.ringsLive.value).toBe(0);
        expect(world.u.clearLive.value).toBe(0);
        expect(world.u.curtain.value).toBe(0);
        CINDER_PALETTES[0].mid.forEach((channel, k) => {
            expect(world.u.mid.value.getComponent(k)).toBeCloseTo(channel, 9);
        });
        expect(world.getPostState()).toMatchObject(AT_REST);
        // A seek before the start of time is the start of time.
        world.seek(-5);
        expect(world.time).toBe(0);
        expect(world.drift).toBe(0);
        // Under reduced motion the crust has drifted less far by the same moment.
        world.setReducedMotion(true);
        world.seek(40);
        expect(world.drift).toBeGreaterThan(0);
        expect(world.drift).toBeLessThan(40 * DRIFT_SPEED);
        world.dispose();
    });

    it('starts a new run with the chamber at rest and the crust still drifting', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1.5);
        world.onLock({ u: 0.7 });
        run(world, camera, 1);
        expect(world.getState().heat).toBeGreaterThan(0);
        expect(world.getState().fissures).toBeGreaterThan(1);
        const {
            time, drift, flow, lift, layout,
        } = world;
        world.resetSession();
        // The slow clocks are kept: nothing jumps on screen...
        expect(world.time).toBe(time);
        expect(world.drift).toBe(drift);
        expect(world.flow).toBe(flow);
        expect(world.lift).toBe(lift);
        // ...but the run is forgotten: no chain, no pool, no event in flight.
        expect(world.getState()).toMatchObject({
            combo: 0,
            power: 0,
            surge: 0,
            storm: 0,
            breath: 1,
            fissures: 0,
            fallGain: 1,
            curtain: 0,
            level: 1,
            palette: CINDER_PALETTES[0].name,
            heat: 0,
            pending: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, fountains: 0, bombs: 0,
            },
        });
        for (let i = 0; i < RING_SLOTS; i++) expect(world.u.ringA[i].value.w).toBe(0);
        for (let i = 0; i < CLEAR_SLOTS; i++) expect(world.u.clearA[i].value.z).toBe(0);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.jets.uniforms.frame.value.w).toBe(0);
        expect(used(world.spatter, 'aBirth')).toHaveLength(0);
        expect(used(world.bombs, 'aFrom')).toHaveLength(0);
        expect(standing(world)).toHaveLength(0);
        // The board is still where it was, and the lake still takes a lock.
        expect(world.getState().layoutLive).toBe(true);
        expect(world.layout).toBe(layout);
        world.onLock({ u: 0.2 });
        expect(world.counts.locks).toBe(1);
        expect(world.getState().heat).toBeGreaterThan(0);
        // The next frame carries on from the same crust, at its resting pace.
        run(world, camera, 1 / 60, 1);
        expect(world.drift - drift).toBeCloseTo(DRIFT_SPEED / 60, 9);
        expect(world.u.drift.value).toBe(world.drift);
        world.dispose();
    });

    it('lives on its own between events: the fall throws spray at its foot, never in a frozen frame', () => {
        const { camera, world } = makeWorld('Low');
        const { foot, width } = world.plan.fall;
        const birth = instanced(world.spatter, 'aBirth');
        const velocity = instanced(world.spatter, 'aVel');
        // Drops leaving the lake's surface where the fall comes down (a pipe overhead may drip there too).
        const spray = () => dropsFrom(world, foot[0], foot[2], { radius: width }).filter((i) => birth[i * 4 + 1] < 1);
        expect(used(world.spatter, 'aBirth')).toHaveLength(0);
        run(world, camera, 2);
        const thrown = spray();
        expect(thrown.length).toBeGreaterThan(0);
        for (const i of thrown) expect(velocity[i * 4 + 1]).toBeGreaterThan(0); // upward
        // A capture stepping the clock with frozen frames adds none.
        const pool = used(world.spatter, 'aBirth').length;
        world.update({ time: world.time + 3, delta: 0 }, camera);
        expect(spray()).toHaveLength(thrown.length);
        expect(used(world.spatter, 'aBirth')).toHaveLength(pool);
        // Nothing at rest touches the post: the picture is steady.
        expect(world.getPostState()).toMatchObject(AT_REST);
        expect(world.counts).toEqual({
            locks: 0, clears: 0, quads: 0, fountains: 0, bombs: 0,
        });
        world.dispose();
    });

    it('returns to its resting look long after the last event', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        world.onLock({ u: 0.5, hardDrop: true });
        world.onCombo(5);
        world.onClear({ lines: 3 });
        run(world, camera, 2);
        world.onClear({ lines: 4 });
        run(world, camera, 2);
        world.onCombo(0);
        const { heat } = world.getState();
        expect(heat).toBeGreaterThan(0);
        run(world, camera, 60, 1200);
        const post = world.getPostState();
        expect(post.flash).toBeLessThan(1e-6);
        expect(post.kick).toBeLessThan(1e-6);
        expect(post.shafts).toBeCloseTo(rest.shafts, 4);
        expect(post.bloomBoost).toBeCloseTo(rest.bloomBoost, 4);
        expect(post.exposure).toBeCloseTo(1, 4);
        expect(post.haze).toBeCloseTo(1, 4);
        expect(world.u.breath.value).toBeCloseTo(1, 6);
        expect(world.u.curtain.value).toBeLessThan(1e-6);
        expect(world.u.fallGain.value).toBeCloseTo(1, 4);
        expect(world.u.fissures.value).toBeLessThan(1e-6);
        expect(world.u.ringsLive.value).toBe(0);
        expect(world.u.clearLive.value).toBe(0);
        expect(world.shake).toBeLessThan(1e-6);
        expect(world.getState()).toMatchObject({ combo: 0, pending: 0 });
        expect(world.getState().power).toBeLessThan(1e-6);
        // The lake has all but forgotten the run: what is left is its own slow bubbling.
        expect(world.getState().heat).toBeLessThan(heat * 0.5);
        world.dispose();
    });
});

describe('cinder drift effects: closed forms', () => {
    it('throws a drop up, lets it fall and lays it on the crust', () => {
        expect(dropHeight(4, 3, 0)).toBe(4);
        const rise = dropHeight(4, 3, 0.2);
        expect(rise).toBeGreaterThan(4);
        let previous = dropHeight(4, 3, 0.6);
        for (let tau = 0.8; tau <= 6; tau += 0.4) {
            const height = dropHeight(4, 3, tau);
            expect(height).toBeLessThan(previous + 1e-9);
            expect(height).toBeGreaterThan(0); // never under the surface
            previous = height;
        }
        // It lies where it landed.
        expect(dropHeight(4, 3, 6)).toBe(dropHeight(4, 3, 60));
        expect(dropHeight(4, 3, 60)).toBeLessThan(0.5);
        // A drop thrown straight down from the surface settles at once.
        expect(dropHeight(0, -5, 0.5)).toBe(dropHeight(4, 3, 60));
        // Thrown harder it climbs higher; in thicker air, less high.
        expect(dropHeight(0.2, 8, 0.5)).toBeGreaterThan(dropHeight(0.2, 5, 0.5));
        expect(dropHeight(0.2, 8, 0.5, GRAVITY, 2)).toBeLessThan(dropHeight(0.2, 8, 0.5, GRAVITY, 0.35));
        // Without much air it is a body in free flight: it comes down when the core's maths says.
        const landing = flightTime(8, 0.2);
        expect(dropHeight(0.2, 8, landing * 0.5, GRAVITY, 1e-6)).toBeGreaterThan(0.2);
        expect(dropHeight(0.2, 8, landing * 0.98, GRAVITY, 1e-6)).toBeGreaterThan(dropHeight(4, 3, 60));
        expect(dropHeight(0.2, 8, landing * 1.02, GRAVITY, 1e-6)).toBe(dropHeight(4, 3, 60));
        // A spark is a drop made light: it rises, and goes on rising.
        let spark = dropHeight(3, 1, 0, -1.5, 2.3);
        for (let tau = 0.1; tau <= 1.3; tau += 0.1) {
            const height = dropHeight(3, 1, tau, -1.5, 2.3);
            expect(height).toBeGreaterThan(spark);
            spark = height;
        }
    });

    it('flies a bomb along its arc and brings it down on the lake', () => {
        const from = [-9, 2.5, -36];
        const target = [22, 0, -80];
        const flight = 3.2;
        // The throw the world makes: there in `flight` seconds, under the same gravity.
        const velocity = [
            (target[0] - from[0]) / flight,
            (0.5 * GRAVITY * flight * flight - from[1]) / flight,
            (target[2] - from[2]) / flight,
        ];
        expect(bombPoint(from, velocity, 0)).toEqual(from);
        const landing = bombPoint(from, velocity, flight);
        for (let k = 0; k < 3; k++) expect(landing[k]).toBeCloseTo(target[k], 9);
        expect(flightTime(velocity[1], from[1])).toBeCloseTo(flight, 9);
        // It goes up and over: highest about the middle, straight across the lake as seen from above.
        const half = bombPoint(from, velocity, flight / 2);
        expect(half[1]).toBeGreaterThan(from[1]);
        expect(half[1]).toBeGreaterThan(bombPoint(from, velocity, flight * 0.1)[1]);
        expect(half[1]).toBeGreaterThan(bombPoint(from, velocity, flight * 0.9)[1]);
        expect(half[0]).toBeCloseTo((from[0] + target[0]) / 2, 9);
        expect(half[2]).toBeCloseTo((from[2] + target[2]) / 2, 9);
        const out = [0, 0, 0];
        expect(bombPoint(from, velocity, 1, out)).toBe(out);
        expect(out).toEqual(bombPoint(from, velocity, 1));
    });
});
