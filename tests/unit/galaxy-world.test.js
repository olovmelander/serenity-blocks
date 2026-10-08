import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GALAXY_PARTS, GalaxyWorld, METEOR_BEAT, REST_RIG, SPIN_RATE, SURGE_COOL, fovForAspect,
} from '../../src/themes/galaxy/galaxy-world.js';
import {
    CLEAR_SLOTS, DEG, GALAXY, GALAXY_PALETTES, HUSH_HOLD, LOCK_SLOTS, MAX_RINGS, SEED_SLOTS, SEED_TAIL, STORE_HOLD,
    STORE_MAX, WAVE_TRAVEL, galaxyAnchors, pieceColor, powerForCombo, wavePassTime,
} from '../../src/themes/galaxy/galaxy-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/galaxy/galaxy-quality.js';
import {
    MAX_GIANTS, MAX_NURSERIES, MAX_STARS, nurseryPosition,
} from '../../src/themes/galaxy/galaxy-plan.js';
import { boardPoint, cardUnion, fallbackLayout } from '../../src/themes/galaxy/galaxy-composition.js';
import { SPARK_DRAG, seedPoint, sparkTravel } from '../../src/themes/galaxy/galaxy-fx.js';

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, capture = true,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new GalaxyWorld({ scene, quality, capture }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(live ? fallbackLayout(width, height) : null, width / height);
    settle(world, camera, 10);
    return { scene, camera, world };
}

/** The capture's recipe: jump the clock, then draw that moment with the simulation frozen. */
function settle(world, camera, time) {
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
}

/** Seconds the pattern takes to turn once at rest. */
const TURN = (Math.PI * 2) / SPIN_RATE;

/**
 * A world at a moment of the pattern's turn when nurseries stand clear of the card on BOTH sides
 * of it. The galaxy hangs left of the board in a wide frame, so the far arm's end is right of the
 * card only for part of each turn; a test about "the piece's own side" needs such a moment.
 */
function makeWorldLitBothSides(quality, options) {
    const made = makeWorld(quality, options);
    for (let k = 0; k < 48; k++) {
        settle(made.world, made.camera, 10 + Math.round((TURN * k) / 48));
        made.world.findTargets();
        if (made.world.targets.left.length > 0 && made.world.targets.right.length > 0) return made;
    }
    throw new Error('no moment of the turn shows nurseries on both sides of the card');
}

/** The same, at a moment when only one side of the card has any: `lit` is that side (−1 left, +1 right). */
function makeWorldLitOneSide(quality, options) {
    const made = makeWorld(quality, options);
    for (let k = 0; k < 48; k++) {
        settle(made.world, made.camera, 10 + Math.round((TURN * k) / 48));
        made.world.findTargets();
        const { left, right } = made.world.getState().targets;
        if ((left > 0) !== (right > 0)) return { ...made, lit: left > 0 ? -1 : 1 };
    }
    throw new Error('no moment of the turn leaves one side of the card bare');
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

/** Step the world one small frame at a time until `done()`; false if `limit` seconds pass first. */
function runUntil(world, camera, done, { step = 1 / 120, limit = 10 } = {}) {
    const stop = world.time + limit;
    while (!done() && world.time < stop) run(world, camera, step, 1);
    return done();
}

/** A pool's per-instance array. */
function instanced(part, name) {
    const attribute = part.geometry.getAttribute(name);
    return { array: attribute.array, count: attribute.count, attribute };
}

/** Slots of a pool whose timestamp (component 3 of `name`) says they have been used. */
function used(part, name) {
    const { array, count } = instanced(part, name);
    const out = [];
    for (let i = 0; i < count; i++) if (array[i * 4 + 3] > -50) out.push(i);
    return out;
}

/**
 * What a world has promised its nurseries: every seed in flight, with the nursery it flies to and
 * the moment it lands. Returns a reader, `[{ index, rgb, time, amount }]` in the order sent.
 */
function watchSeeds(world) {
    const spy = vi.spyOn(world.nurseries, 'strike');
    return () => spy.mock.calls.map(([index, rgb, time, amount]) => ({
        index, rgb: [...rgb], time, amount,
    }));
}

/** When the last of these seeds lands. */
const lastLanding = (seeds) => Math.max(...seeds.map((seed) => seed.time));

/**
 * The ring born at `time` in the gas: the slot (and its colour) stamped with that instant. A lock
 * may write more slots than one, so slots are found by their birth, never by index.
 */
function ringBornAt(world, time, tolerance = 0) {
    const index = world.u.lockA.findIndex((slot) => Math.abs(slot.value.z - time) <= tolerance && slot.value.w > 0);
    return index < 0 ? null : { place: world.u.lockA[index].value, colour: world.u.lockC[index].value };
}

/** A nursery's state as the shader reads it: (epoch, flash time, flash amount, kind 0 lit / 1 nova). */
function flashOf(world, index) {
    const { array } = instanced(world.nurseries, 'aHold');
    return { time: array[index * 4 + 1], amount: array[index * 4 + 2], kind: array[index * 4 + 3] };
}

/** The moment a wave born at `birth` reaches a nursery: its first front passing that radius. */
function waveReaches(world, index, birth) {
    return birth + wavePassTime(instanced(world.nurseries, 'aSite').array[index * 4]);
}

/** Nurseries holding any light now. */
function holders(world) {
    const out = [];
    for (let i = 0; i < world.nurseries.count; i++) if (world.nurseries.heldAt(i, world.time) > 0) out.push(i);
    return out;
}

/** Where a nursery stands on screen (fractions, y down) for a camera. */
function nurseryScreen(world, index, camera = world.restCamera()) {
    const [x, y, z] = world.nurseryWorld(index, [0, 0, 0]);
    const p = new THREE.Vector3(x, y, z).project(camera);
    return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5, depth: p.z };
}

/** A world point on screen (fractions, y down). */
function onScreen(x, y, z, camera) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5 };
}

const inside = (rect, p) => p.x > rect.x0 && p.x < rect.x1 && p.y > rect.y0 && p.y < rect.y1;

/** A rect widened by `pad` on every side (screen fractions). */
const grow = (rect, pad) => ({
    x0: rect.x0 - pad, y0: rect.y0 - pad, x1: rect.x1 + pad, y1: rect.y1 + pad,
});

/** The nurseries a list of targets names (the world may keep where each stands on screen with it). */
const indicesOf = (targets) => targets.map((target) => (typeof target === 'number' ? target : target.index));

afterEach(() => {
    vi.restoreAllMocks();
});

describe('galaxy world: build', () => {
    it('builds every tier from node materials only, with the whole picture and every event', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const materials = new Set();
            scene.traverse((object) => {
                if (object.material) materials.add(object.material);
            });
            expect(materials.size).toBeGreaterThan(10);
            for (const material of materials) {
                expect(material.isNodeMaterial, material.name).toBe(true);
                expect(material.isShaderMaterial, material.name).not.toBe(true);
                expect(material.fog, material.name).toBe(false);
                // Nothing writes depth: the sky is drawn first, the gas over it, every light on top.
                expect(material.depthWrite, material.name).toBe(false);
            }
            // The whole picture and every event, on every tier; every part answers to a name the
            // capture flag can address.
            expect(Object.keys(world.parts).sort()).toEqual([...GALAXY_PARTS].sort());
            expect(world.nurseries.count).toBe(Math.min(tier.nurseries, MAX_NURSERIES));
            expect(world.parts.nurseries.geometry.instanceCount).toBe(world.nurseries.count);
            expect(world.parts.stars.count).toBe(Math.min(tier.stars, MAX_STARS));
            expect(world.parts.stars.geometry.instanceCount).toBe(world.parts.stars.count);
            // The plan builds only the suns its tier draws.
            expect(world.plan.stars.count).toBe(world.parts.stars.count);
            expect(world.parts.giants.count).toBe(Math.min(tier.giants, MAX_GIANTS));
            expect(world.sparks.count).toBe(tier.sparks);
            expect(world.meteors.count).toBe(tier.meteors);
            expect(world.seeds.count).toBe(SEED_SLOTS * SEED_TAIL);
            expect(world.getState()).toMatchObject({
                quality,
                stars: world.parts.stars.count,
                nurseries: world.nurseries.count,
                sparks: tier.sparks,
                march: tier.march,
            });
            // There are nurseries in view, clear of the card, to be lit.
            expect(world.getState().targets).toEqual({ left: 0, right: 0 }); // not looked for until a lock asks
            world.findTargets();
            expect(world.targets.left.length + world.targets.right.length, quality).toBeGreaterThan(0);
            expect(world.getState().targets).toEqual({
                left: world.targets.left.length, right: world.targets.right.length,
            });
            world.dispose();
        }
    });

    it('draws the sky first and the far jet under the disc, the near one over it', () => {
        const { world } = makeWorld('Low');
        const order = (name) => world.parts[name].mesh.renderOrder;
        for (const name of GALAXY_PARTS) {
            if (name !== 'sky') expect(order(name), name).toBeGreaterThan(order('sky'));
        }
        // The dust dims the jet that points away.
        expect(order('jetFar')).toBeLessThan(order('disc'));
        expect(order('jetNear')).toBeGreaterThan(order('disc'));
        // The suns and the nurseries are lights in the gas; what gameplay throws is drawn over them.
        expect(order('stars')).toBeGreaterThan(order('disc'));
        expect(order('nurseries')).toBeGreaterThan(order('disc'));
        for (const name of ['sparks', 'seeds', 'beams']) expect(order(name), name).toBeGreaterThan(order('nurseries'));
        world.dispose();
    });

    it('never needs a frustum test or a matrix update for its parts', () => {
        const { world } = makeWorld('High');
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.frustumCulled, name).toBe(false);
            expect(world.parts[name].mesh.matrixAutoUpdate, name).toBe(false);
        });
        world.dispose();
    });

    it('hangs the same foreground stars on every tier, the brightest first', () => {
        const few = makeWorld('Minimal');
        const many = makeWorld('High');
        const a = instanced(few.world.parts.giants, 'aDir');
        const b = instanced(many.world.parts.giants, 'aDir');
        expect(a.count).toBe(QUALITY.Minimal.giants);
        expect(b.count).toBe(QUALITY.High.giants);
        expect(a.count).toBeLessThan(b.count);
        // A lower tier draws fewer suns and fewer of these, never different ones.
        expect(Array.from(b.array.subarray(0, a.count * 4))).toEqual(Array.from(a.array));
        for (let i = 1; i < b.count; i++) expect(b.array[i * 4 + 3]).toBeLessThanOrEqual(b.array[(i - 1) * 4 + 3]);
        few.world.dispose();
        many.world.dispose();
    });

    it('parks its dormant pool slots ahead of the camera, never on it', () => {
        const { camera, world } = makeWorld('Low');
        const pools = [[world.seeds, 'aFrom'], [world.sparks, 'aBirth']];
        const ahead = (x, y, z) => -new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse).z;
        for (const [part, name] of pools) {
            const { array, count } = instanced(part, name);
            expect(used(part, name), name).toHaveLength(0);
            // In front of the lens and well clear of it, wherever the camera has drifted to: a
            // slot that draws nothing must still project to somewhere.
            let nearest = Infinity;
            for (let i = 0; i < count; i++) {
                nearest = Math.min(nearest, ahead(array[i * 4], array[i * 4 + 1], array[i * 4 + 2]));
            }
            expect(nearest, name).toBeGreaterThan(REST_RIG.near * 10);
        }
        // A meteor's start is an offset from the camera: out on the sky, never zero.
        const starts = instanced(world.meteors, 'aStart');
        expect(used(world.meteors, 'aStart')).toHaveLength(0);
        for (let i = 0; i < starts.count; i++) {
            const offset = Math.hypot(starts.array[i * 4], starts.array[i * 4 + 1], starts.array[i * 4 + 2]);
            expect(offset).toBeGreaterThan(world.distance);
            expect(starts.array[i * 4 + 2]).toBeLessThan(0);
        }
        world.dispose();
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['sky', 'disc', 'no-such-part']);
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'sky' || name === 'disc');
        });
        world.showOnlyParts(Object.keys(world.parts));
        expect(Object.values(world.parts).every((part) => part.mesh.visible)).toBe(true);
        world.dispose();
    });

    it('releases every geometry, material and texture, leaves the scene and survives a second dispose', () => {
        const { scene, camera, world } = makeWorld('Medium');
        expect(scene.children).toContain(world.root);
        const disposals = [];
        Object.values(world.parts).forEach((part) => {
            disposals.push(vi.spyOn(part.geometry, 'dispose'), vi.spyOn(part.material, 'dispose'));
        });
        expect(world.textures.length).toBeGreaterThanOrEqual(1); // the baked noise
        world.textures.forEach((texture) => disposals.push(vi.spyOn(texture, 'dispose')));
        expect(world.disposed).toBe(false);
        world.dispose();
        expect(world.disposed).toBe(true);
        expect(scene.children).toHaveLength(0);
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(world.parts).toEqual({});
        expect(world.textures).toEqual([]);
        for (const key of ['u', 'nurseries', 'sparks', 'seeds', 'beams', 'meteors', 'nucleus']) {
            expect(world[key], key).toBeNull();
        }
        expect(() => world.dispose()).not.toThrow();
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        // A late frame or a late event after retirement is harmless.
        expect(() => {
            world.updateCamera(camera, { time: 11, delta: 0.016 });
            world.update({ time: 11, delta: 0.016 }, camera);
            world.onLock({ u: 0.5 });
            world.onLock({ screen: { x: 0.2, y: 0.8 }, hardDrop: true });
            world.onClear({ lines: 4 });
            world.onCombo(3);
            world.levelUp(2);
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null);
            world.setReducedMotion(true);
            world.showOnlyParts(['sky']);
            world.findTargets();
            world.resetSession();
            world.seek(3);
        }).not.toThrow();
        expect(world.getState()).toMatchObject({
            held: 0, nurseries: 0, stars: 0, sparks: 0, counts: { locks: 0, clears: 0, seeds: 0 },
        });
    });
});

describe('galaxy world: the galaxy\'s place, pose and camera', () => {
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

    it('looks down the −z axis through a long lens, drifting a little', () => {
        const { camera, world } = makeWorld('Minimal');
        expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 9);
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        // Far enough back that the disc keeps its shape, and the whole of it is inside the far plane.
        expect(world.distance).toBeGreaterThan(GALAXY.radius);
        expect(world.distance + GALAXY.bound).toBeLessThan(REST_RIG.far);
        expect(world.getState().distance).toBe(world.distance);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        expect(forward.z).toBeLessThan(-0.99);
        // The drift is small beside the distance to the galaxy, and it is a drift: it moves on.
        expect(camera.position.length()).toBeLessThan(world.distance * 0.1);
        const before = camera.position.clone();
        run(world, camera, 2);
        expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
        expect(camera.position.length()).toBeLessThan(world.distance * 0.1);
        world.dispose();
    });

    it('hangs the nucleus where the composition wants it, as large as it says, in a wide frame and on a phone', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [430, 932]]) {
            const frame = `${width}x${height}`;
            const { camera, world } = makeWorld('Minimal', { width, height });
            const anchors = galaxyAnchors(width / height);
            // The camera's slow drift slides it a little; the composition holds.
            expect(Math.abs(world.heart.x - anchors.x), frame).toBeLessThan(0.1);
            expect(Math.abs(world.heart.y - anchors.y), frame).toBeLessThan(0.1);
            // The post's rays and its ripple come from the same point.
            expect(world.getPostState().heart).toBe(world.heart);
            expect(world.getState().heart).toEqual(world.heart);
            // With the camera at rest it is exactly there.
            world.setReducedMotion(true);
            run(world, camera, 1 / 60, 1);
            expect(world.heart.x, frame).toBeCloseTo(anchors.x, 5);
            expect(world.heart.y, frame).toBeCloseTo(anchors.y, 5);
            const centre = world.u.centre.value;
            expect(centre.length(), frame).toBeCloseTo(world.distance, 6);
            expect(centre.z, frame).toBeLessThan(0);
            expect(world.u.nucleusDir.value.length(), frame).toBeCloseTo(1, 9);
            expect(world.u.nucleusDir.value.distanceTo(centre.clone().normalize()), frame).toBeLessThan(1e-9);
            // The arms end about `radius` screen heights from the nucleus: measured along the
            // disc's long axis, the one direction in its plane that lies across the line of sight.
            const frameMatrix = world.u.frame.value;
            const major = new THREE.Vector3().crossVectors(world.u.axis.value, centre).normalize();
            const rim = centre.clone().addScaledVector(major, GALAXY.radius);
            const inDisc = rim.clone().applyMatrix4(frameMatrix.clone().invert());
            expect(inDisc.length(), frame).toBeCloseTo(GALAXY.radius, 6);
            expect(inDisc.y, frame).toBeCloseTo(0, 6);
            const a = onScreen(centre.x, centre.y, centre.z, camera);
            const b = onScreen(rim.x, rim.y, rim.z, camera);
            const span = Math.hypot((b.x - a.x) * (width / height), b.y - a.y);
            expect(span / anchors.radius, frame).toBeGreaterThan(0.8);
            expect(span / anchors.radius, frame).toBeLessThan(1.25);
            // The companion spiral: a direction in the sky, a small angular size.
            expect(world.u.companionDir.value.length(), frame).toBeCloseTo(1, 9);
            expect(world.u.companion.value.x, frame).toBeGreaterThan(0);
            expect(world.u.companion.value.x, frame).toBeLessThan(Math.atan(GALAXY.radius / world.distance));
            const far = world.u.companionDir.value.clone().multiplyScalar(1000);
            const c = onScreen(far.x, far.y, far.z, camera);
            expect(c.x, frame).toBeCloseTo(anchors.companion.x, 5);
            expect(c.y, frame).toBeCloseTo(anchors.companion.y, 5);
            world.dispose();
        }
    });

    it('recomposes when the frame changes shape', () => {
        const { world } = makeWorld('Minimal');
        const wide = world.u.centre.value.clone();
        const { distance } = world;
        const pixel = world.u.pixelAngle.value;
        const viewport = world.u.viewport.value;
        world.setViewport(430, 932, 430 / 932);
        expect(viewport.toArray()).toEqual([430, 932]);
        expect(world.aspect).toBeCloseTo(430 / 932, 9);
        expect(world.u.centre.value.distanceTo(wide)).toBeGreaterThan(1);
        expect(world.distance).not.toBe(distance);
        // A pixel's footprint follows the lens and the buffer.
        expect(world.u.pixelAngle.value).toBeCloseTo((2 * Math.tan((fovForAspect(430 / 932) * DEG) / 2)) / 932, 12);
        expect(world.u.pixelAngle.value).not.toBe(pixel);
        // With no board on screen the events aim at where the solo board would hang in this frame.
        world.setLayout(null);
        expect(world.getState().layoutLive).toBe(false);
        const tall = cardUnion(world.layout);
        world.setViewport(1600, 900, 1600 / 900);
        expect(cardUnion(world.layout).x1 - cardUnion(world.layout).x0).toBeLessThan(tall.x1 - tall.x0);
        // A degenerate buffer or aspect is ignored.
        world.setViewport(0, 0, NaN);
        expect(viewport.toArray()).toEqual([1600, 900]);
        expect(world.aspect).toBeCloseTo(1600 / 900, 9);
        world.setLayout(null, -2);
        expect(world.aspect).toBeCloseTo(1600 / 900, 9);
        world.dispose();
    });

    it('leans the disc back from the line of sight, in a frame that is a rigid turn about the nucleus', () => {
        const { camera, world } = makeWorld('Minimal');
        const anchors = galaxyAnchors(1600 / 900);
        const frame = world.u.frame.value;
        const x = new THREE.Vector3().setFromMatrixColumn(frame, 0);
        const y = new THREE.Vector3().setFromMatrixColumn(frame, 1);
        const z = new THREE.Vector3().setFromMatrixColumn(frame, 2);
        // Orthonormal and right-handed: lengths and angles in the galaxy's frame are the world's.
        for (const axis of [x, y, z]) expect(axis.length()).toBeCloseTo(1, 9);
        expect(x.dot(y)).toBeCloseTo(0, 9);
        expect(y.dot(z)).toBeCloseTo(0, 9);
        expect(z.dot(x)).toBeCloseTo(0, 9);
        expect(frame.determinant()).toBeCloseTo(1, 9);
        expect(new THREE.Vector3().setFromMatrixPosition(frame).distanceTo(world.u.centre.value)).toBeLessThan(1e-9);
        // The axis the jets run along is the frame's own.
        expect(world.u.axis.value.distanceTo(y)).toBeLessThan(1e-9);
        // The disc is drawn in that frame.
        expect(world.parts.disc.mesh.matrixWorld.equals(frame)).toBe(true);
        // It leans back by its inclination, give or take the few degrees it breathes: neither
        // face-on nor edge-on, the near jet on the camera's side of the disc.
        const toCamera = world.u.centre.value.clone().normalize().negate();
        const tilt = Math.acos(y.dot(toCamera));
        expect(Math.abs(tilt - anchors.inclination)).toBeLessThan(8 * DEG);
        expect(world.u.camLocal.value.y).toBeGreaterThan(0);
        // The camera in the galaxy's frame is the camera, seen from there.
        const back = world.u.camLocal.value.clone().applyMatrix4(frame);
        expect(back.distanceTo(camera.position)).toBeLessThan(1e-6);
        // At rest it leans by exactly that.
        world.setReducedMotion(true);
        run(world, camera, 1 / 60, 1);
        const still = new THREE.Vector3().setFromMatrixColumn(world.u.frame.value, 1);
        expect(Math.acos(still.dot(toCamera))).toBeCloseTo(anchors.inclination, 9);
        world.dispose();
    });

    it('turns the pattern on the world clock, and the nurseries with it', () => {
        const { camera, world } = makeWorld('Minimal');
        // On the world clock until gameplay bends it.
        expect(world.spin).toBeCloseTo(10 * SPIN_RATE, 12);
        expect(world.flow).toBeCloseTo(10, 12);
        const before = world.nurseryWorld(0, [0, 0, 0]);
        run(world, camera, 2);
        expect(world.spin).toBeCloseTo(12 * SPIN_RATE, 9);
        expect(world.flow).toBeCloseTo(12, 9);
        expect(world.getState().spin).toBe(world.spin);
        expect(world.u.flow.value).toBe(world.flow);
        expect(world.u.time.value).toBe(world.time);
        const after = world.nurseryWorld(0, [0, 0, 0]);
        expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeGreaterThan(0);
        world.dispose();
    });

    it('places a nursery in the world exactly where its shader draws it', () => {
        const { world } = makeWorld('Low');
        const frame = world.u.frame.value;
        const out = [0, 0, 0];
        for (let i = 0; i < world.nurseries.count; i += 5) {
            const site = world.plan.nurseries[i];
            expect(world.nurseryWorld(i, out)).toBe(out);
            // The vertex stage: the site on its arm for this winding, through the galaxy's frame.
            const local = nurseryPosition(site, world.u.winding.value);
            const drawn = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(frame);
            expect(out[0]).toBeCloseTo(drawn.x, 9);
            expect(out[1]).toBeCloseTo(drawn.y, 9);
            expect(out[2]).toBeCloseTo(drawn.z, 9);
            // In the disc, at its own radius from the nucleus.
            expect(drawn.distanceTo(world.u.centre.value)).toBeCloseTo(Math.hypot(site.radius, site.y), 6);
            // The shader reads the same site.
            const { array } = instanced(world.nurseries, 'aSite');
            expect(array[i * 4]).toBeCloseTo(site.radius, 4);
            expect(array[i * 4 + 1]).toBeCloseTo(site.offset, 5);
            expect(array[i * 4 + 2]).toBeCloseTo(site.y, 5);
        }
        world.dispose();
    });

    it('finds the nurseries that stand clear of the card and the HUD, on each side of it', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [1024, 768], [430, 932]]) {
            const frame = `${width}x${height}`;
            const { world } = makeWorld('High', { width, height });
            world.findTargets();
            const card = cardUnion(world.layout);
            const centre = (card.x0 + card.x1) / 2;
            const left = indicesOf(world.targets.left);
            const right = indicesOf(world.targets.right);
            expect(left.length + right.length, frame).toBeGreaterThan(0);
            expect(left.length + right.length, frame).toBeLessThanOrEqual(world.nurseries.count);
            expect(new Set([...left, ...right]).size, frame).toBe(left.length + right.length);
            for (const [list, side] of [[left, -1], [right, 1]]) {
                for (const index of list) {
                    const p = nurseryScreen(world, index);
                    // In the frame, in front of the camera, not behind the card, on its own side.
                    expect(p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1 && p.depth < 1, `${frame} #${index}`).toBe(true);
                    expect(inside(card, p), `${frame} #${index}`).toBe(false);
                    if (world.layout.hud) expect(inside(world.layout.hud, p), `${frame} #${index}`).toBe(false);
                    expect(Math.sign(p.x - centre) || side, `${frame} #${index}`).toBe(side);
                }
            }
            // And none that stands clear is left out: every other nursery is hidden or out of frame.
            const found = new Set([...left, ...right]);
            const covers = [card, world.layout.hud].filter(Boolean).map((rect) => grow(rect, 0.03));
            for (let i = 0; i < world.nurseries.count; i++) {
                if (found.has(i)) continue;
                const p = nurseryScreen(world, i);
                const atTheEdge = p.x < 0.08 || p.x > 0.92 || p.y < 0.08 || p.y > 0.92;
                const hidden = covers.some((rect) => inside(rect, p));
                expect(atTheEdge || hidden, `${frame} #${i} at ${p.x.toFixed(3)}, ${p.y.toFixed(3)}`).toBe(true);
            }
            world.dispose();
        }
    });

    it('always has a nursery in view to light, wherever the pattern has turned to', () => {
        for (const [width, height] of [[1600, 900], [430, 932]]) {
            const frame = `${width}x${height}`;
            const { camera, world } = makeWorld('Minimal', { width, height });
            let rightSide = 0;
            let leftSide = 0;
            const moments = 24;
            for (let k = 0; k < moments; k++) {
                settle(world, camera, (TURN * k) / moments);
                world.findTargets();
                const { left, right } = world.targets;
                expect(left.length + right.length, `${frame} at ${Math.round(world.time)} s`).toBeGreaterThan(0);
                if (left.length) leftSide += 1;
                if (right.length) rightSide += 1;
            }
            // The galaxy hangs left of the board in a wide frame, so that side is never bare; the
            // far arm's end comes round to the other side of the card for part of each turn.
            if (width > height) expect(leftSide, frame).toBe(moments);
            expect(leftSide, frame).toBeGreaterThan(0);
            expect(rightSide, frame).toBeGreaterThan(0);
            world.dispose();
        }
    });

    it('finds the world point under a screen point', () => {
        const { camera, world } = makeWorld('Minimal');
        for (const [sx, sy, depth] of [[0.5, 0.5, 6.5], [0.2, 0.9, 80], [0.93, 0.1, 150]]) {
            const out = [0, 0, 0];
            expect(world.screenToWorld(sx, sy, depth, out)).toBe(out);
            const point = new THREE.Vector3(out[0], out[1], out[2]);
            expect(camera.position.distanceTo(point)).toBeCloseTo(depth, 6);
            const p = onScreen(point.x, point.y, point.z, camera);
            expect(p.x).toBeCloseTo(sx, 6);
            expect(p.y).toBeCloseTo(sy, 6);
        }
        // Left of centre on screen is left in the world; ahead is down −z.
        expect(world.screenToWorld(0.2, 0.5, 100, [0, 0, 0])[0]).toBeLessThan(camera.position.x);
        expect(world.screenToWorld(0.5, 0.5, 100, [0, 0, 0])[2]).toBeLessThan(-90);
        world.dispose();
    });

    it('leans the view, and the galaxy, with the pointer', () => {
        const { camera, world } = makeWorld('Minimal');
        const at = (pointerX, pointerY) => {
            const sim = {
                time: 10, delta: 0, pointerX, pointerY,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            return { position: camera.position.clone(), axis: world.u.axis.value.clone() };
        };
        const rest = at(0, 0);
        const right = at(1, 0);
        expect(right.position.x).toBeGreaterThan(rest.position.x + 0.1);
        expect(right.axis.distanceTo(rest.axis)).toBeGreaterThan(1e-3);
        const down = at(0, 1);
        expect(down.position.y).toBeLessThan(rest.position.y);
        expect(down.axis.distanceTo(rest.axis)).toBeGreaterThan(1e-3);
        // And back.
        expect(at(0, 0).position.distanceTo(rest.position)).toBeLessThan(1e-9);
        world.dispose();
    });

    it('keeps the camera still under reduced motion, and keeps the feedback', () => {
        const { camera, world } = makeWorld('Low');
        const seeds = watchSeeds(world);
        world.setReducedMotion(true);
        run(world, camera, 3);
        const still = () => {
            expect(camera.position.length()).toBe(0);
            expect(camera.up.distanceTo(new THREE.Vector3(0, 1, 0))).toBe(0);
            expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 9);
        };
        still();
        const pose = camera.quaternion.clone();
        const axis = world.u.axis.value.clone();
        // No sway, no pointer lean, no impact punch.
        world.onLock({ u: 0.5, hardDrop: true, color: '#ffa8d0' });
        world.onClear({ lines: 4 });
        world.onCombo(8);
        const { spin } = world;
        for (let i = 0; i < 120; i++) {
            const sim = {
                time: world.time + 1 / 60, delta: 1 / 60, pointerX: 1, pointerY: -1,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            still();
            expect(camera.quaternion.angleTo(pose)).toBeLessThan(1e-9);
        }
        // The chain does not whirl the pattern round: it keeps its own slowed, even turn, and the
        // disc does not rock.
        expect(world.spin - spin).toBeGreaterThan(0);
        expect(world.spin - spin).toBeLessThan(2 * SPIN_RATE);
        const even = world.spin - spin;
        run(world, camera, 2);
        expect(world.spin - spin - even).toBeCloseTo(even, 9);
        const turned = new THREE.Vector3().setFromMatrixColumn(world.u.frame.value, 1);
        expect(turned.distanceTo(axis)).toBeLessThan(1e-9);
        // Feedback stays: the seeds, the ring, the wave and the novas it sets off, the charge.
        expect(world.counts.seeds).toBeGreaterThan(0);
        expect(seeds()).toHaveLength(world.counts.seeds);
        expect(world.u.lockA.some((slot) => slot.value.w > 0)).toBe(true);
        expect(world.u.waveA[0].value.z).toBeGreaterThan(0);
        expect(world.power).toBeGreaterThan(0.5);
        expect(world.counts.quads).toBe(1);
        expect(world.counts.novas).toBeGreaterThan(0);
        world.dispose();

        // What crosses the whole picture is gentler, and a seed does not linger in flight.
        const calm = makeWorld('Low');
        const lively = makeWorld('Low');
        calm.world.setReducedMotion(true);
        const calmSeeds = watchSeeds(calm.world);
        const livelySeeds = watchSeeds(lively.world);
        for (const { world: w } of [calm, lively]) {
            w.onLock({ u: 0.2, color: '#ffa8d0' });
            w.onClear({ lines: 4 });
        }
        expect(calm.world.u.shock.value.y).toBeGreaterThan(0);
        expect(calm.world.u.shock.value.y).toBeLessThan(lively.world.u.shock.value.y);
        expect(calmSeeds()[0].time).toBeLessThan(livelySeeds()[0].time);
        let calmRipple = 0;
        let livelyRipple = 0;
        let calmWind = 0;
        let livelyWind = 0;
        for (let i = 0; i < 60; i++) {
            run(calm.world, calm.camera, 1 / 60, 1);
            run(lively.world, lively.camera, 1 / 60, 1);
            calmRipple = Math.max(calmRipple, calm.world.getPostState().ripple.strength);
            livelyRipple = Math.max(livelyRipple, lively.world.getPostState().ripple.strength);
            calmWind = Math.max(calmWind, Math.abs(calm.world.u.winding.value - GALAXY.winding));
            livelyWind = Math.max(livelyWind, Math.abs(lively.world.u.winding.value - GALAXY.winding));
        }
        expect(calmRipple).toBeGreaterThan(0);
        expect(calmRipple).toBeLessThan(livelyRipple);
        expect(calmWind).toBeLessThan(livelyWind);
        calm.world.dispose();
        lively.world.dispose();
    });
});

describe('galaxy world: locks', () => {
    it('sends a seed from the card\'s edge into a nursery on the piece\'s side, which lights when it lands', () => {
        const { camera, world } = makeWorldLitBothSides('Low');
        const seeds = watchSeeds(world);
        const card = cardUnion(world.layout);
        expect(world.getState().held).toBe(0);
        expect(world.u.lockA.every((slot) => slot.value.w === 0)).toBe(true);
        world.onLock({ rows: [12], u: 0.1, color: '#a8ffe8' });
        expect(world.counts).toMatchObject({ locks: 1, seeds: 1 });
        // One nursery has been promised the light, a moment from now: one in view on that side.
        expect(seeds()).toHaveLength(1);
        const [seed] = seeds();
        expect(indicesOf(world.targets.left)).toContain(seed.index);
        expect(nurseryScreen(world, seed.index).x).toBeLessThan(0.5);
        expect(seed.time).toBeGreaterThan(world.time);
        expect(seed.amount).toBeGreaterThan(0);
        const rgb = pieceColor('#a8ffe8');
        expect(seed.rgb).toEqual(rgb);

        // The seed: a head and its tail in one slot, leaving the card's edge now, at the piece's height...
        const from = instanced(world.seeds, 'aFrom').array;
        const mid = instanced(world.seeds, 'aMid').array;
        const to = instanced(world.seeds, 'aTo').array;
        const tint = instanced(world.seeds, 'aTint').array;
        expect(used(world.seeds, 'aFrom')).toHaveLength(SEED_TAIL);
        expect(from[3]).toBe(world.time);
        expect(from[3] + to[3]).toBeCloseTo(seed.time, 4); // its flight ends as the nursery lights
        const start = onScreen(from[0], from[1], from[2], camera);
        expect(start.x).toBeCloseTo(card.x0, 3);
        expect(start.y).toBeCloseTo(boardPoint(world.layout.boards[0], 0.1, 12).y, 3);
        // ...and falling into the galaxy, in the piece's colour. It is told WHICH nursery, not
        // where: the shader finds that nursery at every moment of the flight, so the seed lands
        // in it however the pattern turns and the arms wind meanwhile.
        const site = world.plan.nurseries[seed.index];
        expect(to[0]).toBeCloseTo(site.radius, 4);
        expect(to[1]).toBeCloseTo(site.offset, 5);
        expect(to[2]).toBeCloseTo(site.y, 5);
        const aimed = nurseryPosition({ radius: to[0], offset: to[1], y: to[2] }, world.u.winding.value);
        const end = new THREE.Vector3(aimed[0], aimed[1], aimed[2]).applyMatrix4(world.u.frame.value);
        const home = world.nurseryWorld(seed.index, [0, 0, 0]);
        expect(end.distanceTo(new THREE.Vector3(home[0], home[1], home[2]))).toBeLessThan(1e-3);
        expect(Math.hypot(from[0], from[1], from[2])).toBeLessThan(end.length());
        for (let k = 0; k < 3; k++) expect(tint[k]).toBeCloseTo(rgb[k], 6);
        // Its arc bows out of the disc's plane, toward the camera's side of it.
        const bow = new THREE.Vector3(mid[0], mid[1], mid[2]);
        expect(bow.length()).toBeGreaterThan(0);
        expect(bow.clone().normalize().dot(world.u.axis.value)).toBeCloseTo(1, 5);
        // Every mote of the tail flies the same arc, each a little behind the one before.
        expect(mid[3]).toBe(0);
        for (let j = 1; j < SEED_TAIL; j++) {
            expect(from[j * 4 + 3]).toBe(from[3]);
            expect(to[j * 4]).toBe(to[0]);
            expect(to[j * 4 + 3]).toBe(to[3]);
            expect(mid[j * 4 + 3]).toBeGreaterThan(mid[(j - 1) * 4 + 3]);
        }
        expect(mid[(SEED_TAIL - 1) * 4 + 3]).toBeCloseTo(1, 6);

        // Nothing is lit, rung or thrown until it lands.
        run(world, camera, (seed.time - world.time) * 0.5);
        expect(world.getState().held).toBe(0);
        expect(world.nurseries.pendingCount()).toBe(1);
        expect(world.u.lockA.every((slot) => slot.value.w === 0)).toBe(true);
        expect(world.u.ripplesLive.value).toBe(0);
        expect(used(world.sparks, 'aBirth')).toHaveLength(0);
        // The frame the clock passes its landing: the nursery lights, where it stands THEN.
        expect(runUntil(world, camera, () => world.nurseries.pendingCount() === 0)).toBe(true);
        expect(world.time).toBeGreaterThanOrEqual(seed.time);
        expect(world.time - seed.time).toBeLessThan(1 / 60);
        const landed = world.nurseryWorld(seed.index, [0, 0, 0]);
        expect(world.nurseries.heldAt(seed.index, world.time)).toBeGreaterThan(0);
        expect(world.getState().held).toBeCloseTo(world.nurseries.heldAt(seed.index, world.time), 9);
        expect(holders(world)).toEqual([seed.index]);
        // It holds the piece's colour, and its flash is stamped with the moment of landing, not the frame's.
        const kept = world.nurseries.tintOf(seed.index);
        for (let k = 0; k < 3; k++) expect(kept[k]).toBeCloseTo(rgb[k], 6);
        const flash = flashOf(world, seed.index);
        expect(flash.time).toBeCloseTo(seed.time, 4);
        expect(flash.amount).toBeCloseTo(seed.amount, 6);
        expect(flash.kind).toBe(0);
        // A ring leaves it through the gas, in the galaxy's own frame, born as the seed landed.
        const ring = ringBornAt(world, seed.time, 1e-9);
        expect(ring).toBeTruthy();
        const place = nurseryPosition(site, world.u.winding.value);
        expect(ring.place.x).toBeCloseTo(place[0], 9);
        expect(ring.place.y).toBeCloseTo(place[2], 9);
        expect(ring.place.w).toBeGreaterThan(0);
        expect(ring.colour.y / ring.colour.x).toBeCloseTo(rgb[1] / rgb[0], 6);
        expect(ring.colour.z / ring.colour.x).toBeCloseTo(rgb[2] / rgb[0], 6);
        expect(ring.colour.w).toBeGreaterThan(0);
        expect(world.u.lockA.filter((slot) => slot.value.w > 0)).toHaveLength(1);
        expect(world.u.ripplesLive.value).toBe(1);
        // And sparks fly from it, from that same place and moment.
        const births = instanced(world.sparks, 'aBirth').array;
        const thrown = used(world.sparks, 'aBirth');
        expect(thrown.length).toBeGreaterThan(0);
        for (const i of thrown) {
            expect(births[i * 4 + 3]).toBeCloseTo(seed.time, 4);
            for (let k = 0; k < 3; k++) expect(births[i * 4 + k]).toBeCloseTo(landed[k], 3);
        }

        // A piece on the other side goes to a nursery on the other side, from the other edge.
        world.onLock({ rows: [12], u: 0.9, color: '#ffd4a8' });
        const other = seeds()[1];
        expect(indicesOf(world.targets.right)).toContain(other.index);
        expect(nurseryScreen(world, other.index).x).toBeGreaterThan(0.5);
        expect(onScreen(from[SEED_TAIL * 4], from[SEED_TAIL * 4 + 1], from[SEED_TAIL * 4 + 2], camera).x)
            .toBeCloseTo(card.x1, 3);
        expect(world.counts).toMatchObject({ locks: 2, seeds: 2 });
        world.dispose();
    });

    it('hits harder and sends more seeds on a hard drop, and kicks the camera', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        const softSeeds = watchSeeds(soft.world);
        const hardSeeds = watchSeeds(hard.world);
        soft.world.onLock({ u: 0.3 });
        hard.world.onLock({ u: 0.3, hardDrop: true });
        // The same nursery, more light; and up to two more seeds into its neighbours.
        expect(hardSeeds()[0].index).toBe(softSeeds()[0].index);
        expect(hardSeeds()[0].amount).toBeGreaterThan(softSeeds()[0].amount);
        expect(softSeeds()).toHaveLength(1);
        expect(hardSeeds().length).toBeGreaterThanOrEqual(1);
        expect(hardSeeds().length).toBeLessThanOrEqual(3);
        for (const extra of hardSeeds().slice(1)) {
            expect(extra.index).not.toBe(hardSeeds()[0].index);
            expect(extra.amount).toBeLessThan(hardSeeds()[0].amount);
        }
        expect(hard.world.kick).toBeGreaterThan(soft.world.kick);
        expect(hard.world.flash).toBeGreaterThan(soft.world.flash);
        expect(soft.world.kick).toBeGreaterThan(0);
        // The kick reaches the post and dollies the lens.
        const { fov } = hard.camera;
        run(hard.world, hard.camera, 1 / 60, 1);
        run(soft.world, soft.camera, 1 / 60, 1);
        expect(hard.world.getPostState().kick).toBeGreaterThan(soft.world.getPostState().kick);
        expect(hard.world.getPostState().flash).toBeGreaterThan(soft.world.getPostState().flash);
        expect(hard.camera.fov).toBeLessThan(fov);
        // When they land, the harder one rings the gas harder and further, and throws more sparks.
        const [softSeed] = softSeeds();
        const [hardSeed] = hardSeeds();
        run(soft.world, soft.camera, softSeed.time - soft.world.time + 0.01);
        run(hard.world, hard.camera, hardSeed.time - hard.world.time + 0.01);
        const softRing = ringBornAt(soft.world, softSeed.time, 1e-9);
        const hardRing = ringBornAt(hard.world, hardSeed.time, 1e-9);
        expect(hardRing.place.w).toBeGreaterThan(softRing.place.w);
        expect(hardRing.colour.w).toBeGreaterThan(softRing.colour.w);
        const sparksAt = (world, time) => {
            const { array } = instanced(world.sparks, 'aBirth');
            return used(world.sparks, 'aBirth').filter((i) => Math.abs(array[i * 4 + 3] - time) < 1e-4).length;
        };
        expect(sparksAt(soft.world, softSeed.time)).toBeGreaterThan(0);
        expect(sparksAt(hard.world, hardSeed.time)).toBeGreaterThan(sparksAt(soft.world, softSeed.time));

        // One seed for a lock; up to three for a hard drop.
        for (let i = 1; i < 6; i++) {
            run(soft.world, soft.camera, 0.3);
            run(hard.world, hard.camera, 0.3);
            soft.world.onLock({ u: (i + 0.5) / 6 });
            hard.world.onLock({ u: (i + 0.5) / 6, hardDrop: true });
        }
        expect(soft.world.counts.seeds).toBe(6);
        expect(hard.world.counts.seeds).toBeGreaterThan(6);
        expect(hard.world.counts.seeds).toBeLessThanOrEqual(18);
        expect(hard.world.counts.locks).toBe(6);
        // And the galaxy is left holding more.
        run(soft.world, soft.camera, lastLanding(softSeeds()) - soft.world.time + 0.05);
        run(hard.world, hard.camera, lastLanding(hardSeeds()) - hard.world.time + 0.05);
        expect(soft.world.getState().held).toBeGreaterThan(0);
        expect(hard.world.getState().held).toBeGreaterThan(soft.world.getState().held);
        soft.world.dispose();
        hard.world.dispose();
    });

    it('holds the light a long while and lets it fade', () => {
        const { camera, world } = makeWorld('Low');
        const seeds = watchSeeds(world);
        world.onLock({ u: 0.2, hardDrop: true, color: '#ffc050' });
        world.onLock({ u: 0.8, color: '#8090e0' });
        run(world, camera, lastLanding(seeds()) - world.time + 0.05);
        const { held } = world.getState();
        expect(held).toBeGreaterThan(0);
        // Nothing is written while it fades: the light is a function of the clock.
        const { attribute } = instanced(world.nurseries, 'aHold');
        const { version } = attribute;
        // Still most of it a tenth of a hold on...
        run(world, camera, STORE_HOLD * 0.1, 60);
        expect(world.getState().held).toBeLessThan(held);
        expect(world.getState().held / held).toBeCloseTo(Math.exp(-0.1), 6);
        // ...and 1/e of it a hold later.
        run(world, camera, STORE_HOLD * 0.9, 120);
        expect(world.getState().held / held).toBeCloseTo(Math.exp(-1), 6);
        run(world, camera, STORE_HOLD * 9, 120);
        expect(world.getState().held).toBeLessThan(held * 1e-3);
        expect(attribute.version).toBe(version);
        world.dispose();
    });

    it('never lets one nursery hold more than its fill, and mixes the colours it is given', () => {
        const { world } = makeWorld('Low');
        const index = 3;
        for (let i = 0; i < 40; i++) world.nurseries.strike(index, [1, 0.6, 0.2], world.time, 1.3);
        world.nurseries.update(world.time);
        expect(world.nurseries.heldAt(index, world.time)).toBeCloseTo(STORE_MAX, 5);
        expect(world.getState().held).toBeCloseTo(STORE_MAX, 5);
        // The hue survives the clamp.
        const full = world.nurseries.tintOf(index);
        expect(full[1] / full[0]).toBeCloseTo(0.6, 5);
        expect(full[2] / full[0]).toBeCloseTo(0.2, 5);
        // A nursery that is not drawn cannot be struck.
        expect(() => world.nurseries.strike(world.nurseries.count, [1, 1, 1], world.time, 1)).not.toThrow();
        expect(() => world.nurseries.strike(-1, [1, 1, 1], world.time, 1)).not.toThrow();
        expect(world.nurseries.pendingCount()).toBe(0);
        world.nurseries.update(world.time);
        expect(world.getState().held).toBeCloseTo(STORE_MAX, 5);

        // A second colour joins the first in proportion to the light each brought.
        const other = 7;
        world.nurseries.strike(other, [1, 0, 0], world.time, 1);
        world.nurseries.strike(other, [0, 0, 1], world.time, 1);
        world.nurseries.update(world.time);
        const mixed = world.nurseries.tintOf(other);
        expect(mixed[0]).toBeCloseTo(0.5, 5);
        expect(mixed[1]).toBeCloseTo(0, 5);
        expect(mixed[2]).toBeCloseTo(0.5, 5);
        expect(world.nurseries.heldAt(other, world.time)).toBeCloseTo(2, 5);
        world.dispose();
    });

    it('reuses its lock slots as a ring and never grows a pool', () => {
        const { camera, world } = makeWorld('Low');
        const seeds = watchSeeds(world);
        const pools = [
            [world.seeds, 'aFrom', SEED_SLOTS * SEED_TAIL],
            [world.sparks, 'aBirth', QUALITY.Low.sparks],
            [world.meteors, 'aStart', QUALITY.Low.meteors],
            [world.nurseries, 'aHold', world.nurseries.count],
        ];
        const slots = world.u.lockA.slice();
        const colours = world.u.lockC.slice();
        const births = world.sparks.geometry.getAttribute('aBirth');
        const { version } = births;
        for (let i = 0; i < LOCK_SLOTS + 2; i++) {
            run(world, camera, 0.1);
            world.onLock({ u: (i + 0.5) / (LOCK_SLOTS + 2), hardDrop: i % 2 === 0, color: '#d8a8ff' });
        }
        expect(world.counts.locks).toBe(LOCK_SLOTS + 2);
        const sent = seeds();
        expect(sent.length).toBeGreaterThan(LOCK_SLOTS);
        // Every seed rings the gas as it lands. More rings than slots: the same uniforms, every
        // one of them written...
        run(world, camera, lastLanding(sent) - world.time + 0.05);
        expect(world.nurseries.pendingCount()).toBe(0);
        expect(world.u.lockA).toHaveLength(LOCK_SLOTS);
        expect(world.u.lockC).toHaveLength(LOCK_SLOTS);
        world.u.lockA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        world.u.lockC.forEach((slot, i) => expect(slot).toBe(colours[i]));
        expect(world.u.lockA.every((slot) => slot.value.w > 0)).toBe(true);
        // ...holding the last LOCK_SLOTS landings, the earlier ones overwritten.
        const ascending = (a, b) => a - b;
        const landings = sent.map((seed) => seed.time).sort(ascending);
        expect(world.u.lockA.map((slot) => slot.value.z).sort(ascending)).toEqual(landings.slice(-LOCK_SLOTS));
        expect(births.version).toBeGreaterThan(version);
        for (const [part, name, size] of pools) {
            expect(part.geometry.getAttribute(name).count, name).toBe(size);
            expect(part.geometry.instanceCount, name).toBe(size);
        }
        // More seeds than there are slots: the oldest are overwritten, none added.
        for (let i = 0; i < SEED_SLOTS; i++) world.onLock({ u: 0.3, hardDrop: true });
        expect(world.counts.seeds).toBeGreaterThan(SEED_SLOTS);
        expect(used(world.seeds, 'aFrom')).toHaveLength(SEED_SLOTS * SEED_TAIL);
        expect(used(world.sparks, 'aBirth').length).toBeLessThanOrEqual(QUALITY.Low.sparks);
        world.dispose();
    });

    it('rings the gas on request, round a fixed set of slots', () => {
        const { world } = makeWorld('Minimal');
        const slots = world.u.lockA.slice();
        const writes = LOCK_SLOTS * 2 + 1;
        for (let i = 0; i < writes; i++) world.ring(i, -i, 20 + i, 0.5, [1, 0.5, 0.25], i % 2 ? 0.4 : undefined);
        expect(world.u.lockA).toHaveLength(LOCK_SLOTS);
        world.u.lockA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        // The newest ring is there as it was asked for, reaching the whole way by default...
        const newest = ringBornAt(world, 20 + writes - 1);
        expect(newest.place.toArray()).toEqual([writes - 1, 1 - writes, 20 + writes - 1, 0.5]);
        expect(newest.colour.w).toBe(1);
        expect(newest.colour.y / newest.colour.x).toBeCloseTo(0.5, 9);
        expect(newest.colour.z / newest.colour.x).toBeCloseTo(0.25, 9);
        // ...the one before it with the reach it was given, and the oldest are gone.
        expect(ringBornAt(world, 20 + writes - 2).colour.w).toBe(0.4);
        expect(ringBornAt(world, 20 + writes - LOCK_SLOTS)).toBeTruthy();
        expect(ringBornAt(world, 20 + writes - LOCK_SLOTS - 1)).toBeNull();
        expect(ringBornAt(world, 20)).toBeNull();
        world.dispose();
    });

    it('takes turns for a piece on the board\'s centre line, and aims at the click when there is no board', () => {
        const centred = makeWorldLitBothSides('Low');
        const centredSeeds = watchSeeds(centred.world);
        centred.world.onLock({ u: 0.5, rows: [19] });
        centred.world.onLock({ u: 0.5, rows: [19] });
        const sides = centredSeeds().map((seed) => Math.sign(nurseryScreen(centred.world, seed.index).x - 0.5));
        expect(sides.sort()).toEqual([-1, 1]);
        centred.world.dispose();

        const { camera, world } = makeWorldLitBothSides('Low', { live: false });
        const seeds = watchSeeds(world);
        expect(world.getState().layoutLive).toBe(false);
        const from = instanced(world.seeds, 'aFrom').array;
        world.onLock({ screen: { x: 0.2, y: 0.85 }, color: '#ffd4a8' });
        // The seed leaves the click itself.
        const click = onScreen(from[0], from[1], from[2], camera);
        expect(click.x).toBeCloseTo(0.2, 4);
        expect(click.y).toBeCloseTo(0.85, 4);
        expect(nurseryScreen(world, seeds()[0].index).x).toBeLessThan(0.5);
        run(world, camera, 1 / 60, 1);
        world.onLock({ screen: { x: 0.85, y: 0.9 } });
        expect(nurseryScreen(world, seeds()[1].index).x).toBeGreaterThan(0.5);
        // With no board at all a lock still sends its seed, from where the solo board would hang.
        run(world, camera, 1 / 60, 1);
        world.onLock({ u: 0.1, rows: [19] });
        expect(world.counts.seeds).toBe(3);
        const fallback = onScreen(from[SEED_TAIL * 8], from[SEED_TAIL * 8 + 1], from[SEED_TAIL * 8 + 2], camera);
        expect(fallback.x).toBeCloseTo(cardUnion(world.layout).x0, 3);
        // A lock without a colour still lights its nursery, in the galaxy's own.
        expect(seeds()[2].rgb.every((channel) => channel > 0)).toBe(true);
        world.dispose();
    });

    it('sends a seed by the other edge when its own side has nothing to light, and none with nothing in view', () => {
        const { camera, world, lit } = makeWorldLitOneSide('Low');
        const seeds = watchSeeds(world);
        const card = cardUnion(world.layout);
        // A piece on the bare side: its seed leaves by the other edge, for a nursery that is there.
        world.onLock({ u: lit < 0 ? 0.9 : 0.1, rows: [10], color: '#a8ffe8' });
        expect(seeds()).toHaveLength(1);
        expect(Math.sign(nurseryScreen(world, seeds()[0].index).x - 0.5)).toBe(lit);
        const from = instanced(world.seeds, 'aFrom').array;
        expect(onScreen(from[0], from[1], from[2], camera).x).toBeCloseTo(lit < 0 ? card.x0 : card.x1, 3);
        // Nothing in view at all (a card that covers the frame): the lock is felt, no seed flies.
        world.setLayout({
            cardCount: 1,
            cards: [{
                x0: 0, y0: 0, x1: 1, y1: 1,
            }],
            hud: null,
            boards: world.layout.boards,
        });
        const { kick } = world;
        expect(() => world.onLock({ u: 0.1, rows: [10], hardDrop: true })).not.toThrow();
        expect(world.getState().targets).toEqual({ left: 0, right: 0 });
        expect(seeds()).toHaveLength(1);
        expect(world.counts).toMatchObject({ locks: 2, seeds: 1 });
        expect(world.kick).toBeGreaterThan(kick);
        // A clear over it is still a clear.
        expect(() => world.onClear({ lines: 2, rows: [19, 18] })).not.toThrow();
        expect(world.counts.clears).toBe(1);
        world.dispose();
    });

    it('survives a lock whose screen point is malformed', () => {
        const { world } = makeWorld('Low');
        const points = [{ x: 0.2 }, { y: 0.4 }, {}, { x: NaN, y: NaN }];
        for (const screen of points) {
            expect(() => world.onLock({ screen, color: '#ffffff' }), JSON.stringify(screen)).not.toThrow();
        }
        // Each is still a lock: counted, and felt.
        expect(world.counts.locks).toBe(points.length);
        expect(world.kick).toBeGreaterThan(0);
        world.dispose();
    });

    it('lights the part of the galaxy beside the row a piece locked on', () => {
        const { camera, world } = makeWorld('High');
        const seeds = watchSeeds(world);
        const board = world.layout.boards[0];
        // The same column, near the top of the board and on its floor, a handful of times each.
        const rows = [2, 19];
        for (let i = 0; i < 12; i++) {
            world.onLock({ u: 0.2, rows: [rows[i % 2]], color: '#a8ffe8' });
            run(world, camera, 1 / 60, 1);
        }
        const sent = seeds();
        expect(sent).toHaveLength(12);
        const height = (k) => sent.filter((_, i) => i % 2 === k).map((seed) => nurseryScreen(world, seed.index).y);
        const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
        const high = mean(height(0));
        const low = mean(height(1));
        // Higher on the board, higher in the picture: each nearer its own row than the other's.
        expect(high).toBeLessThan(low);
        const top = boardPoint(board, 0.2, rows[0]).y;
        const floor = boardPoint(board, 0.2, rows[1]).y;
        expect(Math.abs(high - top)).toBeLessThan(Math.abs(high - floor));
        expect(Math.abs(low - floor)).toBeLessThan(Math.abs(low - top));
        // And it does not light the same nursery every time.
        expect(new Set(sent.map((seed) => seed.index)).size).toBeGreaterThan(2);
        world.dispose();
    });
});

describe('galaxy world: clears, combos and the four-line clear', () => {
    it('sends a wave out from the nucleus, one front per line, and fires the rows out of the card', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.u.wavesLive.value).toBe(0);
        world.onClear({ rows: [19, 18], lines: 2 });
        const slot = world.u.waveA[0].value;
        expect(slot.x).toBe(world.time);
        expect(slot.y).toBe(2);
        expect(slot.z).toBeGreaterThan(0);
        expect(slot.w).toBe(0);
        const beams = world.beams.uniforms;
        const board = world.layout.boards[0];
        const card = world.layout.cards[0];
        expect(beams.frame.value.x).toBeCloseTo(card.x0, 9);
        expect(beams.frame.value.y).toBeCloseTo(card.x1, 9);
        expect(beams.frame.value.z).toBe(world.time);
        expect(beams.frame.value.w).toBeGreaterThan(0);
        // Row 19 is the floor row; row 18 the one above it.
        expect(beams.rows.value.x).toBeCloseTo(boardPoint(board, 0.5, 19).y, 9);
        expect(beams.rows.value.y).toBeCloseTo(boardPoint(board, 0.5, 18).y, 9);
        expect(beams.rows.value.x).toBeGreaterThan(beams.rows.value.y);
        expect(beams.rows.value.x).toBeLessThan(board.y1);
        expect(beams.rows.value.y).toBeGreaterThan(board.y0);
        expect(beams.rows.value.z).toBe(-1);
        expect(beams.rows.value.w).toBe(-1);
        expect(world.counts.clears).toBe(1);
        // The shaders walk their wave loops only while a wave is in the disc.
        run(world, camera, 1 / 60, 1);
        expect(world.u.wavesLive.value).toBe(1);
        // Without rows it clears from the floor up.
        world.onClear({ lines: 3 });
        expect(beams.rows.value.x).toBeGreaterThan(beams.rows.value.y);
        expect(beams.rows.value.y).toBeGreaterThan(beams.rows.value.z);
        expect(beams.rows.value.z).toBeGreaterThan(0);
        expect(beams.rows.value.w).toBe(-1);
        run(world, camera, 30, 300);
        expect(world.u.wavesLive.value).toBe(0);
        world.dispose();
    });

    it('keeps the row beams dark when no board is on screen', () => {
        const { world } = makeWorld('Low', { live: false });
        world.onClear({ lines: 2 });
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        expect(world.u.waveA[0].value.z).toBeGreaterThan(0);
        world.dispose();
        // A click's clear fires no rows either, board or no board.
        const live = makeWorld('Low');
        live.world.onClear({ lines: 1, screen: { x: 0.15, y: 0.9 } });
        expect(live.world.beams.uniforms.frame.value.w).toBe(0);
        expect(live.world.u.waveA[0].value.z).toBeGreaterThan(0);
        live.world.dispose();
    });

    it('answers one, two and three lines in different colours, ever stronger, and reuses its slots', () => {
        const { world } = makeWorld('Low');
        const slots = world.u.waveA.slice();
        const waves = [];
        for (const lines of [1, 2, 3]) {
            world.onClear({ lines });
            const at = (lines - 1) % CLEAR_SLOTS;
            waves.push({ colour: world.u.waveC[at].value.clone(), slot: world.u.waveA[at].value.clone() });
        }
        expect(world.u.waveA).toHaveLength(CLEAR_SLOTS);
        world.u.waveA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        const [one, two, three] = waves;
        expect([one.slot.y, two.slot.y, three.slot.y]).toEqual([1, 2, 3]);
        expect(one.colour.distanceTo(two.colour)).toBeGreaterThan(0.1);
        expect(one.colour.distanceTo(three.colour)).toBeGreaterThan(0.1);
        expect(two.colour.distanceTo(three.colour)).toBeGreaterThan(0.1);
        // Each is as bright as the others at its peak: only the hue tells them apart.
        const peak = (c) => Math.max(c.x, c.y, c.z);
        expect(peak(two.colour)).toBeCloseTo(peak(one.colour), 6);
        expect(peak(three.colour)).toBeCloseTo(peak(one.colour), 6);
        expect(two.slot.z).toBeGreaterThan(one.slot.z);
        expect(three.slot.z).toBeGreaterThan(two.slot.z);
        // None of them is a four-line clear.
        expect(world.counts.quads).toBe(0);
        // No line count is one line; more than four is four.
        world.onClear({});
        expect(world.u.waveA[3 % CLEAR_SLOTS].value.y).toBe(1);
        world.onClear({ lines: 9 });
        expect(world.u.waveA[4 % CLEAR_SLOTS].value.y).toBe(4);
        expect(world.counts).toMatchObject({ clears: 5, quads: 1 });
        world.dispose();
    });

    it('hears from its nurseries what they did and when, soonest first, and nothing when nothing happened', () => {
        const { world } = makeWorld('Low');
        const { nurseries } = world;
        const { attribute } = instanced(nurseries, 'aHold');
        const { version } = attribute;
        const t = world.time;
        // Nothing waiting: nothing applied, nothing written.
        expect(nurseries.update(t)).toEqual([]);
        expect(attribute.version).toBe(version);

        // A seed that lands now, another on its way that will land ahead of the front, and a
        // wave leaving the nucleus — asked for in no particular order.
        const [near, far] = [2, 5].sort((a, b) => waveReaches(world, a, 0) - waveReaches(world, b, 0));
        const landsAt = t + waveReaches(world, far, 0) / 2;
        nurseries.strike(far, [0.2, 0.4, 1], landsAt, 0.5);
        nurseries.release(t, { floor: 0 });
        nurseries.strike(near, [1, 0.5, 0.25], t, 1);
        expect(nurseries.pendingCount()).toBe(nurseries.count + 2);
        const applied = nurseries.update(t + WAVE_TRAVEL + 1);
        expect(nurseries.pendingCount()).toBe(0);
        expect(attribute.version).toBeGreaterThan(version);
        // Two landings and two novas; the dark nurseries the wave passed are not in the list.
        expect(applied).toHaveLength(4);
        for (let i = 1; i < applied.length; i++) expect(applied[i].time).toBeGreaterThanOrEqual(applied[i - 1].time);
        const landings = applied.filter((event) => event.kind === 0);
        const novas = applied.filter((event) => event.kind === 1);
        expect(landings).toHaveLength(2);
        expect(landings[0]).toMatchObject({
            index: near, time: t, amount: 1, rgb: [1, 0.5, 0.25],
        });
        expect(landings[1]).toMatchObject({
            index: far, time: landsAt, amount: 0.5, rgb: [0.2, 0.4, 1],
        });
        expect(novas.map((event) => event.index).sort()).toEqual([near, far].sort());
        for (const nova of novas) {
            expect(nova.time).toBeCloseTo(waveReaches(world, nova.index, t), 9);
            // What it held as the front arrived, and how bright it went off.
            expect(nova.held).toBeGreaterThan(0);
            expect(nova.amount).toBeGreaterThan(0);
            expect(nurseries.heldAt(nova.index, t + WAVE_TRAVEL + 1)).toBe(0);
        }
        const byIndex = (index) => novas.find((event) => event.index === index);
        expect(byIndex(near).held).toBeGreaterThan(byIndex(far).held);
        expect(byIndex(near).amount).toBeGreaterThanOrEqual(byIndex(far).amount);

        // The list is reused: the next frame's is the same array, empty again, and writes nothing.
        const settled = attribute.version;
        const next = nurseries.update(t + WAVE_TRAVEL + 2);
        expect(next).toBe(applied);
        expect(next).toHaveLength(0);
        expect(attribute.version).toBe(settled);
        // A wave over a dark galaxy is asked of every nursery and changes none of them.
        nurseries.release(t + WAVE_TRAVEL + 2, { floor: 0 });
        expect(nurseries.update(t + WAVE_TRAVEL * 2 + 3)).toHaveLength(0);
        expect(nurseries.pendingCount()).toBe(0);
        expect(attribute.version).toBe(settled);
        // With a floor (a four-line clear) the dark ones go off too, each as bright as the floor.
        nurseries.release(t + WAVE_TRAVEL * 2 + 3, { floor: 0.25 });
        const eruption = nurseries.update(t + WAVE_TRAVEL * 3 + 4);
        expect(eruption).toHaveLength(nurseries.count);
        expect(eruption.every((event) => event.kind === 1 && event.amount === 0.25 && event.held === 0)).toBe(true);
        world.dispose();
    });

    it('asks every nursery to let go as a clear\'s wave passes it, and sets off the ones holding light', () => {
        const { camera, world } = makeWorld('Low');
        const seeds = watchSeeds(world);
        world.onLock({ u: 0.2, hardDrop: true, color: '#ffa8d0' });
        world.onLock({ u: 0.8, hardDrop: true, color: '#a8e0ff' });
        run(world, camera, lastLanding(seeds()) - world.time + 0.05);
        const { held } = world.getState();
        expect(held).toBeGreaterThan(0);
        const lit = holders(world);
        expect(lit.length).toBeGreaterThanOrEqual(2);
        const colours = new Map(lit.map((index) => [index, world.nurseries.tintOf(index)]));
        const brightest = lit.reduce((a, b) => (
            world.nurseries.heldAt(a, world.time) >= world.nurseries.heldAt(b, world.time) ? a : b));

        const release = vi.spyOn(world.nurseries, 'release');
        const emit = vi.spyOn(world.sparks, 'emit');
        const { storm } = world;
        world.onClear({ lines: 2 });
        const birth = world.time;
        expect(world.u.waveA[0].value.x).toBe(birth);
        expect(release).toHaveBeenCalledOnce();
        expect(release.mock.calls[0][0]).toBe(birth);
        expect(world.storm).toBeGreaterThan(storm);
        // The wave has only just left the nucleus: nothing has gone off, nothing is lost, nothing
        // is thrown. Every nursery is asked when the front reaches it, and decides then.
        expect(world.counts.novas).toBe(0);
        expect(world.getState().held).toBeCloseTo(held, 6);
        expect(world.nurseries.pendingCount()).toBe(world.nurseries.count);
        expect(emit).not.toHaveBeenCalled();

        // What should go off: exactly the nurseries holding light, each at the moment the first
        // front reaches its radius, nearer the nucleus first.
        const novas = lit.map((index) => ({ index, time: waveReaches(world, index, birth), place: null }))
            .sort((a, b) => a.time - b.time);
        for (const nova of novas) {
            expect(nova.time).toBeGreaterThan(birth);
            expect(nova.time).toBeLessThanOrEqual(birth + WAVE_TRAVEL);
        }
        // Frame by frame: a nursery keeps its light until the front arrives, and not a frame longer.
        // A nova never runs ahead of its wave, and is counted as it goes off.
        const last = novas[novas.length - 1].time;
        while (world.time < last + 0.05) {
            run(world, camera, 1 / 120, 1);
            let gone = 0;
            for (const nova of novas) {
                const holding = world.nurseries.heldAt(nova.index, world.time) > 0;
                expect(holding, `nursery ${nova.index} at ${world.time}`).toBe(world.time < nova.time);
                if (!holding) gone += 1;
                // Where it stands on the frame it goes off.
                if (!holding && !nova.place) nova.place = world.nurseryWorld(nova.index, [0, 0, 0]);
            }
            expect(world.counts.novas).toBe(gone);
        }
        expect(world.counts.novas).toBe(lit.length);
        // Each went off in the colour it was keeping, stamped with the moment the front passed.
        for (const nova of novas) {
            const flash = flashOf(world, nova.index);
            expect(flash.kind).toBe(1);
            expect(flash.time).toBeCloseTo(nova.time, 4);
            expect(flash.amount).toBeGreaterThan(0);
            const kept = colours.get(nova.index);
            const now = world.nurseries.tintOf(nova.index);
            for (let k = 0; k < 3; k++) expect(now[k]).toBe(kept[k]);
        }
        // The dark ones did nothing.
        for (let i = 0; i < world.nurseries.count; i++) {
            if (!lit.includes(i)) expect(flashOf(world, i), `nursery ${i}`).toMatchObject({ amount: 0, kind: 0 });
        }
        // Each nova throws its debris once, at its own moment, from where the nursery stood as it
        // went off: the pattern has turned since the clear.
        expect(emit).toHaveBeenCalledTimes(novas.length);
        emit.mock.calls.forEach(([burst], k) => {
            const nova = novas[k];
            expect(burst.time, `nova ${nova.index}`).toBeCloseTo(nova.time, 9);
            expect(burst.n, `nova ${nova.index}`).toBeGreaterThan(0);
            expect(burst.x, `nova ${nova.index}`).toBeCloseTo(nova.place[0], 9);
            expect(burst.y, `nova ${nova.index}`).toBeCloseTo(nova.place[1], 9);
            expect(burst.z, `nova ${nova.index}`).toBeCloseTo(nova.place[2], 9);
            // In the colour it was holding, if it held enough to have one of its own.
            if (nova.index === brightest) expect(burst.rgb).toEqual(colours.get(brightest));
        });
        const births = instanced(world.sparks, 'aBirth').array;
        const thrown = used(world.sparks, 'aBirth');
        for (const nova of novas) {
            expect(thrown.some((i) => Math.abs(births[i * 4 + 3] - nova.time) < 1e-4), `nova ${nova.index}`).toBe(true);
        }

        // Once the wave has left the disc, the galaxy holds nothing and nothing is waiting.
        run(world, camera, birth + WAVE_TRAVEL + 0.05 - world.time);
        expect(world.getState().held).toBe(0);
        expect(world.nurseries.pendingCount()).toBe(0);
        // And it can be lit again.
        const again = seeds().length;
        world.onLock({ u: 0.2, color: '#ffa8d0' });
        run(world, camera, seeds()[again].time - world.time + 0.05);
        expect(world.getState().held).toBeGreaterThan(0);
        world.dispose();
    });

    it('sets off more the more of the galaxy the player has lit', () => {
        const dark = makeWorld('Low');
        const one = makeWorld('Low');
        const many = makeWorld('Low');
        const oneSeeds = watchSeeds(one.world);
        const manySeeds = watchSeeds(many.world);
        one.world.onLock({ u: 0.2, color: '#ffa8d0' });
        for (let i = 0; i < 5; i++) {
            many.world.onLock({ u: (i + 0.5) / 5, hardDrop: true, color: '#a8e0ff' });
            run(many.world, many.camera, 0.2);
        }
        run(one.world, one.camera, lastLanding(oneSeeds()) - one.world.time + 0.05);
        run(many.world, many.camera, lastLanding(manySeeds()) - many.world.time + 0.05);
        const lit = holders(many.world).length;
        expect(lit).toBeGreaterThan(1);
        for (const { world } of [dark, one, many]) world.onClear({ lines: 1 });
        // The sky stirs more...
        expect(one.world.storm).toBeGreaterThan(dark.world.storm);
        expect(many.world.storm).toBeGreaterThan(one.world.storm);
        // ...and more goes off as the wave runs out through the disc.
        for (const { world, camera } of [dark, one, many]) run(world, camera, WAVE_TRAVEL + 0.1);
        expect(dark.world.counts.novas).toBe(0);
        expect(one.world.counts.novas).toBe(1);
        expect(many.world.counts.novas).toBe(lit);
        // A clear over a dark galaxy still sends its wave; nothing answers it.
        expect(dark.world.u.waveA[0].value.z).toBeGreaterThan(0);
        for (let i = 0; i < dark.world.nurseries.count; i++) {
            expect(flashOf(dark.world, i)).toMatchObject({ amount: 0, kind: 0 });
        }
        expect(dark.world.nurseries.pendingCount()).toBe(0);
        for (const { world } of [dark, one, many]) world.dispose();
    });

    it('lets a seed keep its light when it lands behind the front, and takes it when it lands ahead', () => {
        for (const clearFirst of [false, true]) {
            const { camera, world } = makeWorld('Low');
            const byRadius = Array.from({ length: world.nurseries.count }, (_, i) => i)
                .sort((a, b) => world.plan.nurseries[a].radius - world.plan.nurseries[b].radius);
            const inner = byRadius[0];
            const outer = byRadius[byRadius.length - 1];
            const birth = world.time;
            const passInner = wavePassTime(world.plan.nurseries[inner].radius);
            const passOuter = wavePassTime(world.plan.nurseries[outer].radius);
            expect(passOuter).toBeGreaterThan(passInner);
            // Both seeds land at the same moment: after the front has passed the inner nursery,
            // before it reaches the outer one. The order they were asked in does not matter.
            const land = birth + (passInner + passOuter) / 2;
            const send = () => {
                world.nurseries.strike(inner, [1, 0.2, 0.2], land, 1);
                world.nurseries.strike(outer, [0.2, 0.2, 1], land, 1);
            };
            if (clearFirst) {
                world.onClear({ lines: 1 });
                send();
            } else {
                send();
                world.onClear({ lines: 1 });
            }
            run(world, camera, WAVE_TRAVEL + 0.1);
            expect(world.nurseries.heldAt(inner, world.time), `clear first: ${clearFirst}`).toBeGreaterThan(0.5);
            expect(flashOf(world, inner).kind).toBe(0);
            expect(world.nurseries.heldAt(outer, world.time), `clear first: ${clearFirst}`).toBe(0);
            expect(flashOf(world, outer).kind).toBe(1);
            expect(flashOf(world, outer).time).toBeCloseTo(birth + passOuter, 4);
            expect(world.nurseries.pendingCount()).toBe(0);
            world.dispose();
        }
    });

    it('sets off a seed that was still in flight at the clear, with its debris, when the wave arrives', () => {
        const { camera, world } = makeWorld('Low');
        const seeds = watchSeeds(world);
        world.onLock({ u: 0.2, rows: [8], color: '#a8ffe8' });
        const [seed] = seeds();
        // Clear while the seed is on its way — late enough in its flight that it lands before
        // the front has run out from the nucleus to its nursery.
        const flight = seed.time - world.time;
        const reach = waveReaches(world, seed.index, 0);
        run(world, camera, flight - Math.min(flight, reach) / 2);
        expect(world.time).toBeLessThan(seed.time);
        expect(world.nurseries.pendingCount()).toBe(1);
        expect(world.getState().held).toBe(0);
        const emit = vi.spyOn(world.sparks, 'emit');
        world.onClear({ lines: 1 });
        const arrives = waveReaches(world, seed.index, world.time);
        expect(arrives).toBeGreaterThan(seed.time);
        // Nothing holds light at the moment of the clear: nothing is counted or thrown for it yet.
        expect(world.counts.novas).toBe(0);
        expect(emit).not.toHaveBeenCalled();

        // The seed lands: its nursery lights, rings the gas and throws its landing sparks.
        expect(runUntil(world, camera, () => world.time >= seed.time)).toBe(true);
        expect(world.nurseries.heldAt(seed.index, world.time)).toBeGreaterThan(0);
        expect(flashOf(world, seed.index).kind).toBe(0);
        expect(ringBornAt(world, seed.time, 1e-9)).toBeTruthy();
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0][0].time).toBe(seed.time);
        expect(world.counts.novas).toBe(0);

        // Then the front arrives and takes it: a nova, counted once, its debris thrown at that
        // moment from where the nursery stands by then.
        expect(runUntil(world, camera, () => world.counts.novas > 0)).toBe(true);
        expect(world.time).toBeGreaterThanOrEqual(arrives);
        expect(world.time - arrives).toBeLessThan(1 / 60);
        const place = world.nurseryWorld(seed.index, [0, 0, 0]);
        expect(world.counts.novas).toBe(1);
        expect(world.nurseries.heldAt(seed.index, world.time)).toBe(0);
        expect(flashOf(world, seed.index).kind).toBe(1);
        expect(flashOf(world, seed.index).time).toBeCloseTo(arrives, 4);
        expect(emit).toHaveBeenCalledTimes(2);
        const [debris] = emit.mock.calls[1];
        expect(debris.time).toBeCloseTo(arrives, 9);
        expect(debris.n).toBeGreaterThan(0);
        expect(debris.x).toBeCloseTo(place[0], 9);
        expect(debris.y).toBeCloseTo(place[1], 9);
        expect(debris.z).toBeCloseTo(place[2], 9);
        // Nothing else goes off, and nothing goes off twice.
        run(world, camera, WAVE_TRAVEL);
        expect(world.counts.novas).toBe(1);
        expect(emit).toHaveBeenCalledTimes(2);
        expect(world.getState().held).toBe(0);
        expect(world.nurseries.pendingCount()).toBe(0);
        world.dispose();
    });

    it('counts each nova once when two clears follow close on each other', () => {
        const { camera, world } = makeWorld('Low');
        const seeds = watchSeeds(world);
        for (let i = 0; i < 4; i++) {
            world.onLock({
                u: i % 2 ? 0.8 : 0.2, rows: [3 + i * 5], hardDrop: true, color: '#ffa8d0',
            });
            run(world, camera, 0.1);
        }
        run(world, camera, lastLanding(seeds()) - world.time + 0.05);
        const lit = holders(world);
        expect(lit.length).toBeGreaterThan(1);
        const emit = vi.spyOn(world.sparks, 'emit');
        world.onClear({ lines: 1 });
        const first = world.time;
        run(world, camera, 0.1);
        world.onClear({ lines: 2 });
        // Two waves are on their way, the second on the heels of the first.
        expect(world.counts.clears).toBe(2);
        expect(world.nurseries.pendingCount()).toBeGreaterThan(world.nurseries.count);
        run(world, camera, WAVE_TRAVEL + 0.2);
        // The first took what each nursery held; the second found them dark and set nothing off.
        expect(world.counts.novas).toBe(lit.length);
        expect(emit).toHaveBeenCalledTimes(lit.length);
        const gone = [];
        for (let i = 0; i < world.nurseries.count; i++) if (flashOf(world, i).kind === 1) gone.push(i);
        expect(gone).toEqual(lit);
        for (const index of lit) expect(flashOf(world, index).time).toBeCloseTo(waveReaches(world, index, first), 4);
        expect(world.getState().held).toBe(0);
        expect(world.nurseries.pendingCount()).toBe(0);
        world.dispose();
    });

    it('swells the nucleus\'s rays at once and kicks the camera a beat after a clear', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        world.onClear({ lines: 2 });
        expect(world.kick).toBe(0);
        run(world, camera, 1 / 120, 1);
        const post = world.getPostState();
        expect(post.rays).toBeGreaterThan(rest.rays);
        expect(post.bloomBoost).toBeGreaterThan(rest.bloomBoost);
        // The iris closes as the galaxy flares, so its colours survive.
        expect(post.exposure).toBeLessThan(rest.exposure);
        let peak = 0;
        for (let i = 0; i < 96; i++) {
            run(world, camera, WAVE_TRAVEL / 96, 1);
            peak = Math.max(peak, world.kick);
        }
        expect(peak).toBeGreaterThan(0.1);
        world.dispose();
    });

    it('charges with the combo: a ring round the nucleus for every step, the jets pushed out, a quicker turn', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ combo: 0, power: 0, rings: 0 });
        const glare = () => world.nucleus.uniforms.glare.value.x;
        const rest = {
            reach: world.jetReach, gain: world.u.jets.value.y, rays: world.getPostState().rays, glare: glare(),
        };
        expect(world.u.jets.value.x).toBe(world.jetReach);
        // A single clear is not a chain: the nucleus stirs, no ring stands.
        world.onCombo(1);
        run(world, camera, 3);
        expect(world.power).toBeCloseTo(powerForCombo(1), 2);
        expect(world.rings).toBe(0);
        // Four in a row: three rings, easing in.
        world.onCombo(4);
        run(world, camera, 0.1);
        expect(world.rings).toBeGreaterThan(0);
        expect(world.rings).toBeLessThan(3);
        expect(world.power).toBeGreaterThan(powerForCombo(1));
        expect(world.power).toBeLessThan(powerForCombo(4));
        run(world, camera, 4);
        expect(world.power).toBeCloseTo(powerForCombo(4), 3);
        expect(world.rings).toBeCloseTo(3, 3);
        expect(world.getState()).toMatchObject({
            combo: 4, power: world.power, rings: world.rings, jetReach: world.jetReach,
        });
        expect(world.u.power.value).toBe(world.power);
        expect(world.u.rings.value).toBe(world.rings);
        // The nucleus can wear only so many.
        world.onCombo(MAX_RINGS + 20);
        run(world, camera, 5);
        expect(world.rings).toBeCloseTo(MAX_RINGS, 3);
        expect(world.rings).toBeLessThanOrEqual(MAX_RINGS);
        expect(world.power).toBeLessThanOrEqual(1);
        // The charge pushes the jets out along the axis, lights the nucleus and its rays, turns
        // the pattern faster and streams the old suns through the arms.
        expect(world.jetReach).toBeGreaterThan(rest.reach);
        expect(world.jetReach).toBeLessThanOrEqual(1);
        expect(world.u.jets.value.x).toBe(world.jetReach);
        expect(world.u.jets.value.y).toBeGreaterThan(rest.gain);
        expect(world.getPostState().rays).toBeGreaterThan(rest.rays);
        expect(glare()).toBeGreaterThan(rest.glare);
        const { spin, flow } = world;
        run(world, camera, 1);
        expect(world.spin - spin).toBeGreaterThan(SPIN_RATE * 1.5);
        expect(world.flow - flow).toBeGreaterThan(1.5);

        // The chain breaks: the galaxy lets its breath go, and everything falls back.
        world.onCombo(0);
        expect(world.dip).toBeGreaterThan(0);
        run(world, camera, 0.2);
        expect(world.getState().breath).toBeLessThan(0.95);
        expect(world.u.breath.value).toBe(world.getState().breath);
        expect(world.rings).toBeLessThan(MAX_RINGS);
        run(world, camera, 14);
        expect(world.power).toBeLessThan(0.01);
        expect(world.rings).toBeLessThan(0.01);
        expect(world.jetReach).toBeCloseTo(rest.reach, 2);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        // A chain of one that ends takes no breath.
        world.onCombo(1);
        world.onCombo(0);
        expect(world.dip).toBeLessThan(1e-6);
        // Nonsense is no chain.
        world.onCombo(NaN);
        expect(world.combo).toBe(0);
        world.onCombo(-4);
        expect(world.combo).toBe(0);
        world.onCombo('3');
        expect(world.combo).toBe(3);
        world.dispose();
    });

    it('holds its breath on four lines, then the nucleus erupts', () => {
        const { camera, world } = makeWorld('High');
        const post = () => world.getPostState();
        const glare = () => world.nucleus.uniforms.glare.value.x;
        const rest = {
            rays: post().rays,
            exposure: post().exposure,
            bloomBoost: post().bloomBoost,
            reach: world.jetReach,
            gain: world.u.jets.value.y,
            glare: glare(),
        };
        expect(post().ripple.strength).toBe(0);
        expect(used(world.meteors, 'aStart')).toHaveLength(0);
        expect(world.u.jets.value.w).toBe(0);

        const t0 = world.time;
        const birth = t0 + HUSH_HOLD;
        const radiant = world.u.nucleusDir.value.clone();
        const { spin } = world;
        const emit = vi.spyOn(world.sparks, 'emit');
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const slot = world.u.waveA[0].value;
        expect(slot.y).toBe(4);
        expect(slot.w).toBe(1); // starfire
        // The wave waits for the breath to be let go, and so do the jets' burst and the sky's ring.
        expect(slot.x).toBeCloseTo(birth, 9);
        expect(world.u.jets.value.z).toBeCloseTo(birth, 9);
        expect(world.u.jets.value.w).toBeGreaterThan(0);
        expect(world.u.shock.value.x).toBeCloseTo(birth, 9);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        expect(world.counts.quads).toBe(1);
        // It fires in starfire: warm, red over green over blue.
        const fire = world.u.waveC[0].value;
        expect(fire.x).toBeGreaterThan(fire.y);
        expect(fire.y).toBeGreaterThan(fire.z);
        // The rows leave the card at once.
        expect(world.beams.uniforms.frame.value.z).toBe(t0);
        expect(world.beams.uniforms.rows.value.toArray().every((y) => y > 0)).toBe(true);

        // ── The hush: every light sinks, and nothing has begun ──
        run(world, camera, HUSH_HOLD * 0.9);
        expect(world.getState().breath).toBeLessThan(0.3);
        expect(world.u.breath.value).toBe(world.getState().breath);
        expect(post().rays).toBeLessThan(rest.rays);
        expect(post().ripple.strength).toBe(0);
        expect(holders(world)).toEqual([]);
        for (let i = 0; i < world.nurseries.count; i++) expect(flashOf(world, i).kind).toBe(0);
        expect(world.counts.novas).toBe(0);
        expect(emit).not.toHaveBeenCalled();
        // The overdrive waits with the breath: the jets stay where they were and the pattern
        // keeps its resting turn until the nucleus goes.
        expect(world.getState().surge).toBe(0);
        expect(world.u.surge.value).toBe(0);
        expect(world.jetReach).toBeCloseTo(rest.reach, 9);
        expect(world.spin - spin).toBeCloseTo(SPIN_RATE * HUSH_HOLD * 0.9, 9);

        // ── Then the nucleus erupts, and the overdrive begins with it ──
        expect(runUntil(world, camera, () => world.getState().surge > 0)).toBe(true);
        expect(world.time).toBeGreaterThanOrEqual(birth);
        expect(world.time - birth).toBeLessThan(1 / 60);
        const begun = { time: world.time, surge: world.getState().surge };
        expect(begun.surge).toBeGreaterThan(0.5);
        expect(world.u.surge.value).toBe(begun.surge);
        let wound = 0;
        for (let i = 0; i < 40; i++) {
            run(world, camera, 0.5 / 40, 1);
            wound = Math.max(wound, Math.abs(world.u.winding.value - GALAXY.winding));
        }
        expect(world.getState().breath).toBeGreaterThan(0.95);
        expect(post().rays).toBeGreaterThan(rest.rays);
        expect(post().bloomBoost).toBeGreaterThan(rest.bloomBoost);
        expect(post().exposure).toBeLessThan(rest.exposure); // the iris closes on the flare
        expect(glare()).toBeGreaterThan(rest.glare);
        // Both jets push out and burn hotter.
        expect(world.jetReach).toBeGreaterThan(rest.reach);
        expect(world.u.jets.value.x).toBe(world.jetReach);
        expect(world.u.jets.value.y).toBeGreaterThan(rest.gain);
        // Space itself ripples out from the nucleus.
        expect(post().ripple.strength).toBeGreaterThan(0);
        expect(post().ripple.radius).toBeGreaterThan(0);
        // The arms wound tighter on the way.
        expect(wound).toBeGreaterThan(0);
        // The nucleus spits stars, a moment after the breath is let go.
        const meteors = used(world.meteors, 'aStart');
        expect(meteors.length).toBeGreaterThan(1);
        const starts = instanced(world.meteors, 'aStart').array;
        for (const i of meteors) {
            expect(starts[i * 4 + 3]).toBeGreaterThan(birth);
            const from = new THREE.Vector3(starts[i * 4], starts[i * 4 + 1], starts[i * 4 + 2]).normalize();
            expect(from.dot(radiant)).toBeGreaterThan(0.98);
        }

        // ── Every nursery goes nova as the wave passes it ──
        run(world, camera, birth + WAVE_TRAVEL + 0.05 - world.time);
        for (let i = 0; i < world.nurseries.count; i++) {
            const flash = flashOf(world, i);
            expect(flash.kind, `nursery ${i}`).toBe(1);
            expect(flash.amount, `nursery ${i}`).toBeGreaterThan(0);
            expect(flash.time, `nursery ${i}`).toBeGreaterThan(birth);
            expect(flash.time, `nursery ${i}`).toBeLessThanOrEqual(birth + WAVE_TRAVEL + 1e-4);
        }
        expect(world.nurseries.pendingCount()).toBe(0);
        // Each is counted as it goes, once, and throws its debris in the wave's own starfire.
        expect(world.counts.novas).toBe(world.nurseries.count);
        expect(emit).toHaveBeenCalledTimes(world.nurseries.count);
        const [[first]] = emit.mock.calls;
        expect(first.rgb[0]).toBeGreaterThan(first.rgb[1]);
        expect(first.rgb[1]).toBeGreaterThan(first.rgb[2]);
        for (const [burst] of emit.mock.calls) {
            expect(burst.n).toBeGreaterThan(0);
            expect(burst.rgb).toEqual(first.rgb);
            expect(burst.time).toBeGreaterThan(birth);
        }

        // ── And cools: to 1/e of where it began, one SURGE_COOL on ──
        run(world, camera, begun.time + SURGE_COOL - world.time, 240);
        expect(world.getState().surge).toBeCloseTo(begun.surge * Math.exp(-1), 6);
        run(world, camera, SURGE_COOL * 10, 900);
        expect(world.getState().surge).toBeLessThan(0.01);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        expect(post().exposure).toBeGreaterThan(0.99);
        expect(post().rays).toBeCloseTo(rest.rays, 2);
        expect(post().ripple.strength).toBeLessThan(1e-6);
        expect(world.jetReach).toBeCloseTo(rest.reach, 2);
        expect(world.u.winding.value).toBeCloseTo(GALAXY.winding, 6);
        world.dispose();
    });

    it('lights a lit nursery\'s nova brighter than a dark one\'s on four lines', () => {
        const { camera, world } = makeWorld('Low');
        const seeds = watchSeeds(world);
        world.onLock({ u: 0.2, hardDrop: true, color: '#ffa8d0' });
        run(world, camera, lastLanding(seeds()) - world.time + 0.05);
        const lit = holders(world);
        expect(lit.length).toBeGreaterThan(0);
        world.onClear({ lines: 4 });
        run(world, camera, HUSH_HOLD + WAVE_TRAVEL + 0.1);
        const dark = Array.from({ length: world.nurseries.count }, (_, i) => i).find((i) => !lit.includes(i));
        expect(flashOf(world, dark).kind).toBe(1);
        expect(flashOf(world, dark).amount).toBeGreaterThan(0);
        for (const index of lit) {
            expect(flashOf(world, index).amount).toBeGreaterThanOrEqual(flashOf(world, dark).amount);
        }
        expect(world.getState().held).toBe(0);
        world.dispose();
    });

    it('fires a perfect clear as a four-line clear, hotter still', () => {
        const quad = makeWorld('Low');
        const perfect = makeWorld('Low');
        quad.world.onClear({ lines: 4 });
        perfect.world.onClear({ lines: 1, perfect: true });
        expect(perfect.world.u.waveA[0].value.toArray().slice(0, 2)).toEqual([perfect.world.time + HUSH_HOLD, 4]);
        expect(perfect.world.u.waveA[0].value.w).toBe(1);
        expect(perfect.world.counts.quads).toBe(1);
        expect(perfect.world.u.jets.value.w).toBeGreaterThan(quad.world.u.jets.value.w);
        run(perfect.world, perfect.camera, HUSH_HOLD * 0.9);
        run(quad.world, quad.camera, HUSH_HOLD * 0.9);
        expect(perfect.world.getState().breath).toBeLessThan(0.3);
        expect(perfect.world.getState().surge).toBe(0);
        // Once the breath is let go, its overdrive is the stronger.
        run(perfect.world, perfect.camera, HUSH_HOLD * 0.1 + 0.05);
        run(quad.world, quad.camera, HUSH_HOLD * 0.1 + 0.05);
        expect(quad.world.getState().surge).toBeGreaterThan(0);
        expect(perfect.world.getState().surge).toBeGreaterThan(quad.world.getState().surge);
        // Dark as the galaxy is, every nursery goes off.
        run(perfect.world, perfect.camera, WAVE_TRAVEL + 0.1);
        expect(perfect.world.counts.novas).toBe(perfect.world.nurseries.count);
        quad.world.dispose();
        perfect.world.dispose();
    });

    it('keeps the eruption\'s ring and ripple when a perfect clear is a T-spin too', () => {
        const quad = makeWorld('Low');
        const both = makeWorld('Low');
        const spun = makeWorld('Low');
        quad.world.onClear({ lines: 4 });
        both.world.onClear({ lines: 2, tspin: true, perfect: true });
        spun.world.onClear({ lines: 2, tspin: true });
        const birth = both.world.time + HUSH_HOLD;
        // The sky's ring is the eruption's: as strong, and born when the breath is let go, not
        // the small ring a plain T-spin sends at once.
        expect(both.world.u.shock.value.toArray()).toEqual(quad.world.u.shock.value.toArray());
        expect(both.world.u.shock.value.x).toBeCloseTo(birth, 9);
        expect(both.world.u.shock.value.y).toBeGreaterThan(spun.world.u.shock.value.y);
        expect(spun.world.u.shock.value.x).toBe(spun.world.time);
        expect(both.world.counts).toMatchObject({ clears: 1, quads: 1 });
        // Nothing crosses the picture during the hush; the plain T-spin's ripple is already out.
        for (const { world, camera } of [quad, both, spun]) run(world, camera, HUSH_HOLD * 0.9);
        expect(both.world.getPostState().ripple.strength).toBe(0);
        expect(both.world.getState().breath).toBeLessThan(0.3);
        expect(spun.world.getPostState().ripple.strength).toBeGreaterThan(0);
        // Then the same ripple as any eruption's, stronger than a T-spin's ever is.
        let peak = 0;
        let spunPeak = spun.world.getPostState().ripple.strength;
        let wound = 0;
        let quadWound = 0;
        for (let i = 0; i < 60; i++) {
            for (const { world, camera } of [quad, both, spun]) run(world, camera, 1 / 60, 1);
            const { ripple } = both.world.getPostState();
            expect(ripple.strength).toBeCloseTo(quad.world.getPostState().ripple.strength, 12);
            expect(ripple.radius).toBeCloseTo(quad.world.getPostState().ripple.radius, 12);
            peak = Math.max(peak, ripple.strength);
            spunPeak = Math.max(spunPeak, spun.world.getPostState().ripple.strength);
            wound = Math.max(wound, Math.abs(both.world.u.winding.value - GALAXY.winding));
            quadWound = Math.max(quadWound, Math.abs(quad.world.u.winding.value - GALAXY.winding));
        }
        expect(peak).toBeGreaterThan(spunPeak);
        // It is still a T-spin: the arms wind further than an eruption alone winds them.
        expect(wound).toBeGreaterThan(quadWound);
        for (const { world } of [quad, both, spun]) world.dispose();
    });

    it('fires the jets on three lines, short of an eruption', () => {
        const three = makeWorld('Low');
        const quad = makeWorld('Low');
        three.world.onClear({ lines: 3 });
        quad.world.onClear({ lines: 4 });
        // A burst at once, weaker than a four-line clear's, and no held breath before it.
        expect(three.world.u.jets.value.z).toBe(three.world.time);
        expect(three.world.u.jets.value.w).toBeGreaterThan(0);
        expect(three.world.u.jets.value.w).toBeLessThan(quad.world.u.jets.value.w);
        // Its overdrive begins at once (a four-line clear's waits for the held breath)...
        expect(three.world.getState().surge).toBeGreaterThan(0);
        expect(quad.world.getState().surge).toBe(0);
        expect(three.world.counts.quads).toBe(0);
        expect(used(three.world.meteors, 'aStart').length).toBeGreaterThan(0);
        expect(used(three.world.meteors, 'aStart').length).toBeLessThan(used(quad.world.meteors, 'aStart').length);
        run(three.world, three.camera, HUSH_HOLD * 0.9);
        run(quad.world, quad.camera, HUSH_HOLD * 0.9);
        expect(three.world.getState().breath).toBeGreaterThan(0.9);
        expect(quad.world.getState().breath).toBeLessThan(0.3);
        // ...and is the weaker of the two once the eruption has begun.
        run(three.world, three.camera, HUSH_HOLD * 0.1 + 0.05);
        run(quad.world, quad.camera, HUSH_HOLD * 0.1 + 0.05);
        expect(three.world.getState().surge).toBeGreaterThan(0);
        expect(three.world.getState().surge).toBeLessThan(quad.world.getState().surge);
        // The dark nurseries stay dark: only an eruption sets those off.
        run(three.world, three.camera, WAVE_TRAVEL + 0.1);
        run(quad.world, quad.camera, WAVE_TRAVEL + 0.1);
        expect(three.world.counts.novas).toBe(0);
        expect(quad.world.counts.novas).toBe(quad.world.nurseries.count);
        three.world.dispose();
        quad.world.dispose();
    });

    it('winds the arms up on a T-spin and lets them spring back', () => {
        const { camera, world } = makeWorld('Low');
        const plain = makeWorld('Low');
        const quad = makeWorld('Low');
        plain.world.onClear({ lines: 2 });
        quad.world.onClear({ lines: 4 });

        world.onClear({ lines: 2, tspin: true });
        expect(world.storm).toBeGreaterThan(plain.world.storm);
        // A small ring from the nucleus, at once: gentler than a four-line clear's.
        expect(world.u.shock.value.x).toBe(world.time);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        expect(world.u.shock.value.y).toBeLessThan(quad.world.u.shock.value.y);
        expect(plain.world.u.shock.value.y).toBe(0);
        expect(world.counts.quads).toBe(0);
        // The arms wind tighter, and every nursery rides its arm round.
        let wound = 0;
        let carried = 0;
        let ripple = 0;
        for (let i = 0; i < 60; i++) {
            run(world, camera, 1 / 60, 1);
            run(plain.world, plain.camera, 1 / 60, 1);
            wound = Math.max(wound, world.u.winding.value - GALAXY.winding);
            ripple = Math.max(ripple, world.getPostState().ripple.strength);
            const now = world.nurseryWorld(world.nurseries.count - 1, [0, 0, 0]);
            const base = plain.world.nurseryWorld(world.nurseries.count - 1, [0, 0, 0]);
            carried = Math.max(carried, Math.hypot(now[0] - base[0], now[1] - base[1], now[2] - base[2]));
            // A plain clear leaves the arms alone.
            expect(plain.world.u.winding.value).toBe(GALAXY.winding);
        }
        expect(wound).toBeGreaterThan(1e-3);
        expect(carried).toBeGreaterThan(0.01);
        expect(ripple).toBeGreaterThan(0);
        // Then they spring back and settle where they were.
        run(world, camera, 8);
        expect(world.u.winding.value).toBeCloseTo(GALAXY.winding, 6);
        expect(world.getState().twist).toBeCloseTo(0, 6);
        plain.world.dispose();
        quad.world.dispose();
        world.dispose();
    });

    it('changes the galaxy\'s colours with the level and cycles through its palettes', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ level: 1, palette: GALAXY_PALETTES[0].name });
        const before = world.u.nursery.value.clone();
        const target = new THREE.Vector3(...GALAXY_PALETTES[1].nursery);
        expect(target.distanceTo(before)).toBeGreaterThan(0);
        world.levelUp(2);
        expect(world.getState()).toMatchObject({ level: 2, palette: GALAXY_PALETTES[1].name });
        // The galaxy marks it: the sky stirs, a ring crosses it and a shooting star or two fall.
        expect(world.storm).toBeGreaterThan(0);
        expect(world.u.shock.value.x).toBe(world.time);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        expect(used(world.meteors, 'aStart').length).toBeGreaterThan(0);
        // The colours ease across, they do not snap.
        run(world, camera, 1 / 60, 1);
        const moved = world.u.nursery.value.distanceTo(before);
        expect(moved).toBeGreaterThan(0);
        expect(moved).toBeLessThan(target.distanceTo(before) * 0.5);
        run(world, camera, 10);
        expect(world.u.nursery.value.distanceTo(target)).toBeLessThan(0.01);
        // Past the last palette it starts again.
        for (let level = 1; level <= GALAXY_PALETTES.length * 2 + 1; level++) {
            world.levelUp(level);
            expect(world.getState().palette).toBe(GALAXY_PALETTES[(level - 1) % GALAXY_PALETTES.length].name);
        }
        // A capture rests on a level's palette at once.
        world.levelUp(3, { silent: true });
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.getState().palette).toBe(GALAXY_PALETTES[2].name);
        for (const [key, uniform] of [
            ['nursery', 'nursery'], ['dust', 'dust'], ['jet', 'jet'], ['nebulaA', 'nebulaA'], ['nebulaB', 'nebulaB'],
            ['void', 'voidCol'],
        ]) {
            GALAXY_PALETTES[2][key].forEach((channel, k) => {
                expect(world.u[uniform].value.getComponent(k), key).toBeCloseTo(channel, 9);
            });
        }
        // Nonsense is level one.
        world.levelUp(NaN);
        expect(world.getState().level).toBe(1);
        world.levelUp(-3);
        expect(world.getState().level).toBe(1);
        world.dispose();
    });
});

describe('galaxy world: time', () => {
    const script = (world, camera, fps) => {
        world.onLock({ u: 0.3, hardDrop: true, color: '#ffc050' });
        world.onClear({ lines: 2 });
        world.onCombo(3);
        run(world, camera, 1.5, Math.round(1.5 * fps));
        world.onClear({ lines: 4 });
        world.onCombo(4);
        run(world, camera, 2, Math.round(2 * fps));
        world.onLock({ u: 0.8, color: '#8090e0' });
        world.levelUp(2);
        run(world, camera, 1.5, Math.round(1.5 * fps));
    };
    const POST_KEYS = ['flash', 'kick', 'rays', 'bloomBoost', 'exposure'];

    it('reaches the same state at 30 and at 240 frames a second', () => {
        const slow = makeWorld('Low');
        const fast = makeWorld('Low');
        script(slow.world, slow.camera, 30);
        script(fast.world, fast.camera, 240);
        const a = slow.world.getState();
        const b = fast.world.getState();
        expect(a.time).toBeCloseTo(b.time, 9);
        expect(a.counts).toEqual(b.counts);
        expect(a).toMatchObject({ combo: b.combo, level: b.level, palette: b.palette });
        expect(a.held).toBeGreaterThan(0);
        for (const key of ['power', 'surge', 'storm', 'breath', 'rings', 'held']) {
            expect(a[key], key).toBeCloseTo(b[key], 3);
        }
        // The overdrive begins at the eruption's own moment, whichever frame noticed it.
        expect(a.surge).toBeGreaterThan(0);
        expect(a.surge).toBeCloseTo(b.surge, 9);
        // And each nova was counted once, whatever the frame rate.
        expect(a.counts.novas).toBeGreaterThan(0);
        // What is integrated frame by frame is close, not identical.
        for (const key of ['twist', 'jetReach', 'spin']) expect(a[key], key).toBeCloseTo(b[key], 2);
        expect(slow.world.flow / fast.world.flow).toBeCloseTo(1, 2);
        expect(a.heart.x).toBeCloseTo(b.heart.x, 3);
        expect(a.heart.y).toBeCloseTo(b.heart.y, 3);
        const postA = slow.world.getPostState();
        const postB = fast.world.getPostState();
        for (const key of POST_KEYS) expect(postA[key], key).toBeCloseTo(postB[key], 3);
        expect(postA.ripple.strength).toBeCloseTo(postB.ripple.strength, 6);
        expect(postA.ripple.radius).toBeCloseTo(postB.ripple.radius, 6);
        expect(slow.world.u.nursery.value.distanceTo(fast.world.u.nursery.value)).toBeLessThan(1e-3);
        // Event slots hold timestamps: they are identical whatever the frame rate.
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            expect(slow.world.u.waveA[i].value.toArray()).toEqual(fast.world.u.waveA[i].value.toArray());
        }
        expect(slow.world.u.shock.value.toArray()).toEqual(fast.world.u.shock.value.toArray());
        expect(slow.world.u.jets.value.z).toBe(fast.world.u.jets.value.z);
        // A seed's flight depends on the camera's pose that frame: the same to a hair.
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const lockA = slow.world.u.lockA[i].value.toArray();
            const lockB = fast.world.u.lockA[i].value.toArray();
            for (let k = 0; k < 4; k++) expect(lockA[k], `lock slot ${i}[${k}]`).toBeCloseTo(lockB[k], 2);
        }
        // The same nurseries hold the same light.
        expect(holders(slow.world)).toEqual(holders(fast.world));
        slow.world.dispose();
        fast.world.dispose();
    });

    it('replays a frame: seek, then the same steps, gives the same galaxy whatever came before', () => {
        const { camera, world } = makeWorld('Low');
        // What a frame is made of: the state, the post's inputs, the event slots, what every
        // nursery holds and every pool's births, the galaxy's clocks and frame, and the camera.
        const flat = (value) => (typeof value === 'object' ? Object.values(value) : value);
        const births = (part, name) => Array.from(instanced(part, name).array).filter((v, i) => i % 4 === 3);
        /** Everything the seeds in flight (or flown) are drawn from; a slot never used holds nothing to compare. */
        const flights = () => used(world.seeds, 'aFrom').flatMap((i) => ['aFrom', 'aMid', 'aTo', 'aTint']
            .flatMap((name) => Array.from(instanced(world.seeds, name).array.subarray(i * 4, i * 4 + 4))));
        const snapshot = () => [
            ...Object.values(world.getState()).flatMap(flat),
            ...POST_KEYS.map((key) => world.getPostState()[key]),
            ...Object.values(world.getPostState().ripple),
            ...world.u.lockA.flatMap((slot) => slot.value.toArray()),
            ...world.u.waveA.flatMap((slot) => slot.value.toArray()),
            ...world.u.shock.value.toArray(),
            ...world.u.jets.value.toArray(),
            ...world.beams.uniforms.frame.value.toArray(),
            ...instanced(world.nurseries, 'aHold').array,
            ...instanced(world.nurseries, 'aTint').array,
            ...births(world.seeds, 'aFrom'),
            ...flights(),
            ...births(world.sparks, 'aBirth'),
            ...births(world.meteors, 'aStart'),
            world.nurseries.pendingCount(),
            world.u.winding.value,
            world.flow,
            world.spin,
            ...world.u.frame.value.toArray(),
            ...camera.matrixWorld.toArray(),
        ];
        script(world, camera, 60);
        const first = snapshot();
        expect(first.length).toBeGreaterThan(1000);
        // Something else entirely in between...
        world.onCombo(9);
        world.onLock({ u: 0.5, hardDrop: true });
        world.onClear({ lines: 3, tspin: true });
        world.setReducedMotion(true);
        run(world, camera, 3);
        world.setReducedMotion(false);
        // ...then the capture's recipe again.
        world.seek(10);
        world.updateCamera(camera, { time: 10, delta: 0 });
        world.update({ time: 10, delta: 0 }, camera);
        script(world, camera, 60);
        const again = snapshot();
        expect(again).toHaveLength(first.length);
        let worst = 0;
        for (let i = 0; i < first.length; i++) {
            if (typeof first[i] === 'number') worst = Math.max(worst, Math.abs(first[i] - again[i]));
            else expect(again[i]).toBe(first[i]);
        }
        expect(worst).toBeLessThan(1e-9);
        world.dispose();
    });

    it('drops every event in flight when it seeks, and puts the pattern where the clock says', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1);
        world.onClear({ lines: 2, tspin: true });
        run(world, camera, 0.1);
        expect(world.nurseries.pendingCount()).toBeGreaterThan(0); // a wave still on its way
        world.seek(40);
        expect(world.time).toBe(40);
        expect(world.getState()).toMatchObject({
            time: 40,
            combo: 0,
            power: 0,
            surge: 0,
            storm: 0,
            breath: 1,
            rings: 0,
            twist: 0,
            level: 1,
            palette: GALAXY_PALETTES[0].name,
            held: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, seeds: 0, novas: 0,
            },
        });
        expect(world.spin).toBeCloseTo(40 * SPIN_RATE, 12);
        expect(world.flow).toBeCloseTo(40, 12);
        expect(world.meteorBeat).toBe(Math.floor(40 / METEOR_BEAT));
        for (let i = 0; i < LOCK_SLOTS; i++) expect(world.u.lockA[i].value.w).toBe(0);
        for (let i = 0; i < CLEAR_SLOTS; i++) expect(world.u.waveA[i].value.z).toBe(0);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.u.jets.value.w).toBe(0);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        for (const [part, name] of [[world.seeds, 'aFrom'], [world.sparks, 'aBirth'], [world.meteors, 'aStart']]) {
            expect(used(part, name), name).toHaveLength(0);
        }
        expect(world.nurseries.pendingCount()).toBe(0);
        for (let i = 0; i < world.nurseries.count; i++) expect(flashOf(world, i)).toMatchObject({ amount: 0, kind: 0 });
        // The frame it draws next is the galaxy at rest at that time.
        world.updateCamera(camera, { time: 40, delta: 0 });
        world.update({ time: 40, delta: 0 }, camera);
        const fresh = makeWorld('High');
        fresh.world.seek(40);
        fresh.world.updateCamera(fresh.camera, { time: 40, delta: 0 });
        fresh.world.update({ time: 40, delta: 0 }, fresh.camera);
        expect(world.getPostState()).toEqual(fresh.world.getPostState());
        expect(world.u.winding.value).toBe(GALAXY.winding);
        expect(world.u.frame.value.toArray()).toEqual(fresh.world.u.frame.value.toArray());
        expect(world.u.jets.value.toArray()).toEqual(fresh.world.u.jets.value.toArray());
        expect(world.u.nursery.value.distanceTo(fresh.world.u.nursery.value)).toBeLessThan(1e-12);
        expect(world.u.wavesLive.value).toBe(0);
        expect(world.u.ripplesLive.value).toBe(0);
        expect(camera.matrixWorld.toArray()).toEqual(fresh.camera.matrixWorld.toArray());
        expect(camera.fov).toBe(fresh.camera.fov);
        fresh.world.dispose();
        // Under reduced motion the pattern keeps its own, slower clock.
        world.setReducedMotion(true);
        world.seek(40);
        expect(world.spin).toBeGreaterThan(0);
        expect(world.spin).toBeLessThan(40 * SPIN_RATE);
        // A seek before the start of time is the start of time.
        world.seek(-5);
        expect(world.time).toBe(0);
        expect(world.spin).toBe(0);
        world.dispose();
    });

    it('starts a new run with the galaxy at rest and still turning', () => {
        const { camera, world } = makeWorld('High');
        const seeds = watchSeeds(world);
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        // Once the eruption's wave has left the disc, a lock lights a nursery that keeps its light...
        run(world, camera, HUSH_HOLD + WAVE_TRAVEL + 0.1);
        world.onLock({ u: 0.7 });
        run(world, camera, lastLanding(seeds()) - world.time + 0.05);
        // ...and a clear sends a wave for it that is still on its way when the run ends.
        world.onClear({ lines: 2, tspin: true });
        run(world, camera, 0.05);
        expect(world.getState().held).toBeGreaterThan(0);
        expect(world.nurseries.pendingCount()).toBeGreaterThan(0);
        const {
            time, spin, flow, meteorBeat,
        } = world;
        world.resetSession();
        // The galaxy keeps its clocks: nothing jumps on screen...
        expect(world.time).toBe(time);
        expect(world.spin).toBe(spin);
        expect(world.flow).toBe(flow);
        expect(world.meteorBeat).toBe(meteorBeat);
        // ...but the run is forgotten: no chain, no held light, no event in flight.
        expect(world.getState()).toMatchObject({
            combo: 0,
            power: 0,
            surge: 0,
            storm: 0,
            breath: 1,
            rings: 0,
            twist: 0,
            level: 1,
            palette: GALAXY_PALETTES[0].name,
            held: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, seeds: 0, novas: 0,
            },
        });
        for (let i = 0; i < LOCK_SLOTS; i++) expect(world.u.lockA[i].value.w).toBe(0);
        for (let i = 0; i < CLEAR_SLOTS; i++) expect(world.u.waveA[i].value.z).toBe(0);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.u.jets.value.w).toBe(0);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        expect(used(world.seeds, 'aFrom')).toHaveLength(0);
        expect(used(world.sparks, 'aBirth')).toHaveLength(0);
        expect(world.nurseries.pendingCount()).toBe(0);
        for (let i = 0; i < world.nurseries.count; i++) expect(flashOf(world, i)).toMatchObject({ amount: 0, kind: 0 });
        // A wave that was on its way sets nothing off in the new run.
        run(world, camera, WAVE_TRAVEL + HUSH_HOLD);
        expect(world.counts.novas).toBe(0);
        for (let i = 0; i < world.nurseries.count; i++) expect(flashOf(world, i).kind).toBe(0);
        expect(world.getPostState().ripple.strength).toBe(0);
        expect(world.u.winding.value).toBe(GALAXY.winding);
        // The nurseries are still there to be lit, and the board is still where it was.
        expect(world.getState().layoutLive).toBe(true);
        world.onLock({ u: 0.2 });
        expect(world.counts.seeds).toBe(1);
        expect(world.targets.left.length).toBeGreaterThan(0);
        // The next frame carries on from the same turn.
        const turned = world.spin;
        run(world, camera, 1 / 60, 1);
        expect(world.spin - turned).toBeCloseTo(SPIN_RATE / 60, 9);
        world.dispose();
    });

    it('throws a shooting star on the sky\'s own beat, never in a frozen frame', () => {
        const { camera, world } = makeWorld('Low');
        expect(used(world.meteors, 'aStart')).toHaveLength(0);
        run(world, camera, METEOR_BEAT - (world.time % METEOR_BEAT) + 0.1, 60);
        expect(used(world.meteors, 'aStart')).toHaveLength(1);
        // A capture stepping over a beat with the clock frozen adds none.
        world.update({ time: world.time + METEOR_BEAT, delta: 0 }, camera);
        expect(used(world.meteors, 'aStart')).toHaveLength(1);
        world.dispose();
    });

    it('writes nothing to the GPU while nothing happens', () => {
        const { camera, world } = makeWorld('Low');
        const watched = [
            [world.nurseries, 'aHold'], [world.nurseries, 'aTint'], [world.seeds, 'aFrom'], [world.sparks, 'aBirth'],
            [world.parts.stars, 'aOrbit'],
        ].map(([part, name]) => {
            const { attribute } = instanced(part, name);
            return [name, attribute, attribute.version];
        });
        run(world, camera, 3);
        for (const [name, attribute, version] of watched) expect(attribute.version, name).toBe(version);
        // A wave over a dark galaxy asks every nursery and changes none: still nothing is written.
        world.onClear({ lines: 1 });
        run(world, camera, WAVE_TRAVEL + 0.2);
        expect(world.nurseries.pendingCount()).toBe(0);
        for (const [name, attribute, version] of watched) expect(attribute.version, name).toBe(version);
        // A lock writes its seed now, and its nursery and its sparks when the seed lands, and
        // then nothing more.
        const seeds = watchSeeds(world);
        const [hold, , from, sparks] = watched;
        world.onLock({ u: 0.2, color: '#ffa8d0' });
        expect(from[1].version).toBeGreaterThan(from[2]);
        expect(hold[1].version).toBe(hold[2]);
        expect(sparks[1].version).toBe(sparks[2]);
        run(world, camera, seeds()[0].time - world.time + 0.05);
        expect(hold[1].version).toBeGreaterThan(hold[2]);
        expect(sparks[1].version).toBeGreaterThan(sparks[2]);
        const settled = watched.map(([, attribute]) => attribute.version);
        run(world, camera, 3);
        expect(watched.map(([, attribute]) => attribute.version)).toEqual(settled);
        world.dispose();
    });

    it('returns to its exact resting look long after the last event', () => {
        const { camera, world } = makeWorld('Low');
        const glare = () => world.nucleus.uniforms.glare.value.toArray();
        const rest = { ...world.getPostState(), glare: glare(), jets: world.u.jets.value.toArray() };
        world.onLock({ u: 0.5, hardDrop: true });
        world.onCombo(5);
        world.onClear({ lines: 3, tspin: true });
        run(world, camera, 2);
        world.onCombo(0);
        run(world, camera, 60, 1200);
        const post = world.getPostState();
        expect(post.flash).toBeLessThan(1e-6);
        expect(post.kick).toBeLessThan(1e-6);
        expect(post.rays).toBeCloseTo(rest.rays, 6);
        expect(post.bloomBoost).toBeCloseTo(rest.bloomBoost, 6);
        expect(post.exposure).toBeCloseTo(1, 6);
        expect(post.ripple.strength).toBeLessThan(1e-9);
        expect(world.u.breath.value).toBeCloseTo(1, 6);
        expect(world.u.skyPulse.value).toBeLessThan(1e-6);
        expect(world.u.winding.value).toBeCloseTo(GALAXY.winding, 9);
        expect(world.u.jets.value.x).toBeCloseTo(rest.jets[0], 6);
        expect(world.u.jets.value.y).toBeCloseTo(rest.jets[1], 6);
        glare().forEach((value, k) => expect(value).toBeCloseTo(rest.glare[k], 6));
        // The shaders are back to skipping their event loops.
        expect(world.u.wavesLive.value).toBe(0);
        expect(world.u.ripplesLive.value).toBe(0);
        expect(world.getState().combo).toBe(0);
        expect(world.getState().power).toBeLessThan(1e-6);
        expect(world.nurseries.pendingCount()).toBe(0);
        world.dispose();
    });
});

describe('galaxy effects: closed forms', () => {
    it('flies a seed along an arc from the board to the nursery', () => {
        const from = [0, 2, -6];
        const mid = [-10, 14, -20];
        const to = [-30, 5, -50];
        expect(seedPoint(from, mid, to, 0)).toEqual(from);
        expect(seedPoint(from, mid, to, 1)).toEqual(to);
        const half = seedPoint(from, mid, to, 0.5);
        for (let k = 0; k < 3; k++) expect(half[k]).toBeCloseTo(from[k] * 0.25 + mid[k] * 0.5 + to[k] * 0.25, 9);
        // It bows toward the point that pulls its middle aside.
        expect(half[1]).toBeGreaterThan(Math.max(from[1], to[1]));
        const out = [0, 0, 0];
        expect(seedPoint(from, mid, to, 0.3, out)).toBe(out);
    });

    it('throws a spark fast and drags it to a halt', () => {
        expect(sparkTravel(0)).toBe(0);
        expect(sparkTravel(-2)).toBe(0);
        let previous = 0;
        let step = Infinity;
        for (let tau = 0.1; tau <= 4; tau += 0.1) {
            const gone = sparkTravel(tau);
            expect(gone).toBeGreaterThan(previous);
            // Each tenth of a second covers less than the one before.
            expect(gone - previous).toBeLessThan(step);
            step = gone - previous;
            previous = gone;
        }
        // It never gets further than its first speed over the drag.
        expect(sparkTravel(1e3)).toBeCloseTo(1 / SPARK_DRAG, 9);
        expect(sparkTravel(4)).toBeLessThan(1 / SPARK_DRAG);
    });
});
