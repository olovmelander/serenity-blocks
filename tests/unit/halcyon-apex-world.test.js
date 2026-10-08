import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    HALCYON_APEX_PARTS, HalcyonApexWorld, REST_RIG, SUN_FLOOR, SURGE_COOL, fovForAspect,
} from '../../src/themes/halcyon-apex/halcyon-apex-world.js';
import {
    CLEAR_REACH, CLEAR_SHAPE, CLEAR_SLOTS, CLEAR_TRAVEL, DEG, HALCYON_PALETTES, HOLD_FADE, HOLD_MAX, HUSH_HOLD, LEY_A,
    LEY_B, LIFT_MAX, LOCK_SLOTS, PULSE_SLOTS, PULSE_SPEED, RING_REACH, RING_TAU, SITE, SUNFIRE, WISP_SLOTS, WISP_TAIL,
    clearPassTime, clearRadius, compositionFor, pieceColor, powerForCombo, pulseArrival, ringRadius,
} from '../../src/themes/halcyon-apex/halcyon-apex-core.js';
import { GEM } from '../../src/themes/halcyon-apex/halcyon-apex-plan.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/halcyon-apex/halcyon-apex-quality.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from '../../src/themes/halcyon-apex/halcyon-apex-composition.js';
import { sparkHeight, wispPoint } from '../../src/themes/halcyon-apex/halcyon-apex-fx.js';
import { beadShare } from '../../src/themes/halcyon-apex/halcyon-apex-atmosphere.js';

// Every test builds at least one whole sanctuary; on a loaded machine that can take a while.
vi.setConfig({ testTimeout: 30000 });

/** The Halcyon never hangs left of this bearing (the world's own floor; it does not export it). */
const BEARING_FLOOR = 8 * DEG;

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, capture = true, renderer = null, seed,
} = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new HalcyonApexWorld({
        scene, quality, capture, renderer, seed,
    }).build();
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
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60)), each = null) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
        if (each) each(sim);
    }
}

/** Advance the world to `time` on its own clock, in frames of 1/120 s or less. */
function runTo(world, camera, time, each = null) {
    const span = time - world.time;
    if (span > 0) run(world, camera, span, Math.max(1, Math.ceil(span * 120)), each);
}

/** Lay out the frame the world's clock already stands on (after an event, before the next step). */
function settle(world, camera) {
    world.updateCamera(camera, { time: world.time, delta: 0 });
    world.update({ time: world.time, delta: 0 }, camera);
}

/** Where a world point shows on screen (fractions, y down). */
function onScreen(camera, x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5 };
}

/** Slots of a pool whose timestamp (component 3 of `name`) says they have been used. */
function used(part, name) {
    const { array, count } = part.geometry.getAttribute(name);
    const out = [];
    for (let i = 0; i < count; i++) if (array[i * 4 + 3] > -50) out.push(i);
    return out;
}

/** The rings now on the lagoon: (x, z, birth, strength) and (colour, reach) of every slot in use. */
function rings(world) {
    return world.u.lockA
        .map((slot, i) => ({ place: slot.value, colour: world.u.lockC[i].value }))
        .filter((ring) => ring.place.w > 0);
}

/** The ring born at `time`: slots are found by their birth, never by index. */
function ringBornAt(world, time, tolerance = 1e-9) {
    return rings(world).find((ring) => Math.abs(ring.place.z - time) <= tolerance) ?? null;
}

/** The ley pulses in flight: (birth, line, strength) and colour of every slot in use, oldest first. */
function pulses(world) {
    return world.u.pulseA
        .map((slot, i) => ({ slot: slot.value, colour: world.u.pulseC[i].value }))
        .filter((pulse) => pulse.slot.z > 0)
        .sort((a, b) => a.slot.x - b.slot.x);
}

/** What `act` wrote into the pulse slots: the pulses it sent, in the order they were born. */
function pulsesSentBy(world, act) {
    const before = world.u.pulseA.map((slot) => slot.value.toArray().join());
    act();
    return pulses(world).filter((pulse) => !before.includes(pulse.slot.toArray().join()));
}

/** The wisp the world launched last: where it leaves, where it flies to, when and for how long. */
function lastWisp(world) {
    const first = ((world.counts.wisps - 1) % WISP_SLOTS) * WISP_TAIL * 4;
    const read = (name) => Array.from(world.wisps.geometry.getAttribute(name).array.slice(first, first + 4));
    const [fx, fy, fz, born] = read('aFrom');
    const [tx, ty, tz, flight] = read('aTo');
    return {
        from: [fx, fy, fz], to: [tx, ty, tz], born, flight, tint: read('aTint'),
    };
}

/** The crystal that floats at a world point right now, or −1. */
function gemAt(world, [x, y, z]) {
    for (let i = 0; i < world.crystals.count; i++) {
        const at = world.crystals.positionOf(i);
        if (Math.hypot(at[0] - x, at[1] - y, at[2] - z) < 1e-3) return i;
    }
    return -1;
}

/** The sparks thrown at `time`: where from and how fast upward. */
function sparksBornAt(world, time) {
    const birth = world.sparks.geometry.getAttribute('aBirth').array;
    const velocity = world.sparks.geometry.getAttribute('aVel').array;
    const out = [];
    for (let i = 0; i < world.sparks.count; i++) {
        if (Math.abs(birth[i * 4 + 3] - time) < 1e-4) {
            out.push({
                x: birth[i * 4], y: birth[i * 4 + 1], z: birth[i * 4 + 2], up: velocity[i * 4 + 1],
            });
        }
    }
    return out;
}

/**
 * A colour's hue as each channel's place between its weakest and its strongest: the same whatever
 * gain or lift the colour has been given on the way.
 */
function hue(colour) {
    const c = Array.from(colour).slice(0, 3);
    const lo = Math.min(...c);
    const span = Math.max(...c) - lo;
    return c.map((v) => (v - lo) / span);
}

const hueGap = (a, b) => Math.hypot(...hue(a).map((v, k) => v - hue(b)[k]));

/** The crystals of one kind, as indices into the world's list. */
const gemsOf = (world, kind) => world.crystals.gems.map((gem, i) => (gem.kind === kind ? i : -1)).filter((i) => i >= 0);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('halcyon apex world: build', () => {
    it('builds every tier from node materials only, with the parts its tier pays for', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const materials = new Set();
            scene.traverse((object) => {
                if (object.material) [].concat(object.material).forEach((material) => materials.add(material));
            });
            expect(materials.size, quality).toBeGreaterThan(8);
            for (const material of materials) {
                expect(material.isNodeMaterial, material.name).toBe(true);
                expect(material.isShaderMaterial, material.name).not.toBe(true);
            }
            // The whole picture and every event on every tier: every part the capture flag can
            // name, less the two a tier may leave out.
            const paid = HALCYON_APEX_PARTS
                .filter((name) => (name !== 'motes' || tier.motes > 0) && (name !== 'birds' || tier.birds > 0));
            expect(Object.keys(world.parts).sort(), quality).toEqual([...paid].sort());
            expect(Boolean(world.parts.motes), `${quality} motes`).toBe(tier.motes > 0);
            expect(Boolean(world.parts.birds), `${quality} birds`).toBe(tier.birds > 0);
            expect(world.birds ?? undefined, `${quality} flock`).toBe(world.parts.birds);
            expect(Boolean(world.reflection), `${quality} mirror`).toBe(tier.reflection > 0);
            // One sun and one shadow map, where the tier has one.
            expect(Boolean(world.sun), `${quality} sun`).toBe(tier.shadowMap > 0);
            expect(Boolean(world.shadowNode), `${quality} shadow`).toBe(tier.shadowMap > 0);
            const lights = [];
            scene.traverse((object) => {
                if (object.isLight) lights.push(object);
            });
            expect(lights, quality).toEqual(world.sun ? [world.sun] : []);
            if (world.sun) {
                expect(world.sun.isDirectionalLight).toBe(true);
                expect(world.sun.castShadow).toBe(true);
                expect(world.sun.shadow.mapSize.toArray()).toEqual([tier.shadowMap, tier.shadowMap]);
                expect(world.root.children).toContain(world.sun.target);
            }
            // Pools are as large as the tier says, and the crystals are the plan's.
            expect(world.sparks.count).toBe(tier.sparks);
            expect(world.parts.beads.count).toBe(tier.beads);
            expect(world.parts.upfall.count).toBe(tier.upfall);
            if (tier.motes > 0) expect(world.parts.motes.count).toBe(tier.motes);
            if (tier.birds > 0) expect(world.parts.birds.count).toBe(tier.birds);
            expect(world.crystals.count).toBe(world.plan.gems.length);
            expect(world.parts.crystals.geometry.instanceCount).toBe(world.crystals.count);
            expect(world.parts.halos.geometry.instanceCount).toBe(world.crystals.count);
            expect(world.getState()).toMatchObject({
                quality,
                crystals: world.plan.gems.length,
                masonry: (world.plan.stone.count + world.plan.dialStone.count) / 3,
                sparks: tier.sparks,
                beads: tier.beads,
                reflection: tier.reflection,
                shadowMap: tier.shadowMap,
            });
            // Both ley lines have a head in view to send a wisp to.
            expect(world.targets.a.length, quality).toBeGreaterThan(0);
            expect(world.targets.b.length, quality).toBeGreaterThan(0);
            for (const index of world.targets.a) expect(world.crystals.gems[index].kind).toBe(GEM.shard);
            for (const index of world.targets.b) expect(world.crystals.gems[index].kind).toBe(GEM.dial);
            // Wisps, row beams and motes are for the camera only: the lagoon's mirror skips layer 1.
            for (const name of Object.keys(world.parts)) {
                const cameraOnly = ['wisps', 'beams', 'motes'].includes(name);
                expect(world.parts[name].mesh.layers.mask, `${quality}.${name}`).toBe(cameraOnly ? 2 : 1);
            }
            world.dispose();
        }
    });

    it('lets the camera see the wisps, the row beams and the motes and keeps them out of the mirror', () => {
        const mirrored = QUALITY_NAMES.find((name) => QUALITY[name].reflection > 0 && QUALITY[name].motes > 0);
        const { camera, world } = makeWorld(mirrored);
        const mirror = world.reflection.reflector.getVirtualCamera(camera);
        for (const name of ['wisps', 'beams', 'motes']) {
            expect(camera.layers.test(world.parts[name].mesh.layers), name).toBe(true);
            expect(mirror.layers.test(world.parts[name].mesh.layers), name).toBe(false);
        }
        for (const name of ['sky', 'water', 'site', 'dial', 'crystals', 'sparks', 'beacons']) {
            expect(camera.layers.test(world.parts[name].mesh.layers), name).toBe(true);
            expect(mirror.layers.test(world.parts[name].mesh.layers), name).toBe(true);
        }
        world.dispose();
        // Without a mirror the camera is still shown layer 1.
        const plain = makeWorld(QUALITY_NAMES.find((name) => QUALITY[name].reflection === 0));
        expect(plain.world.reflection).toBeFalsy();
        expect(plain.camera.layers.test(plain.world.parts.wisps.mesh.layers)).toBe(true);
        plain.world.dispose();
    });

    it('never needs a frustum test or a matrix update for its parts', () => {
        const { world } = makeWorld('High');
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.frustumCulled, name).toBe(false);
            expect(world.parts[name].mesh.matrixAutoUpdate, name).toBe(false);
        });
        world.dispose();
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['sky', 'water', 'no-such-part']);
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'sky' || name === 'water');
        });
        world.showOnlyParts(Object.keys(world.parts));
        expect(Object.values(world.parts).every((part) => part.mesh.visible)).toBe(true);
        world.showOnlyParts([]);
        expect(Object.values(world.parts).some((part) => part.mesh.visible)).toBe(false);
        world.dispose();
    });

    it('releases every geometry, material and texture, leaves the scene and survives a second dispose', () => {
        const shadowed = QUALITY_NAMES.find((name) => QUALITY[name].shadowMap > 0 && QUALITY[name].reflection > 0);
        const renderer = { shadowMap: { enabled: false } };
        const { scene, camera, world } = makeWorld(shadowed, { renderer });
        expect(scene.children).toContain(world.root);
        expect(renderer.shadowMap.enabled).toBe(true); // the sun's map needs it
        // Each thing once, however many parts share it (the dial's stone and ley are the site's).
        const owned = new Set();
        Object.values(world.parts).forEach((part) => {
            owned.add(part.mesh.geometry);
            owned.add(part.mesh.material);
        });
        expect(world.textures.length).toBeGreaterThan(0);
        world.textures.forEach((texture) => owned.add(texture));
        owned.add(world.reflection);
        const disposals = [...owned].map((thing) => vi.spyOn(thing, 'dispose'));
        const shadowMap = vi.spyOn(world.sun.shadow, 'dispose');
        world.dispose();
        expect(scene.children).toHaveLength(0);
        disposals.forEach((disposal, i) => expect(disposal, `owned thing ${i}`).toHaveBeenCalledOnce());
        expect(shadowMap).toHaveBeenCalled(); // the sun's shadow map goes too
        // The renderer is handed back as it was found.
        expect(renderer.shadowMap.enabled).toBe(false);
        expect(world.parts).toEqual({});
        expect(world.textures).toEqual([]);
        for (const key of ['reflection', 'sun', 'shadowNode', 'stone', 'crystals', 'sparks', 'wisps', 'beams', 'u']) {
            expect(world[key], key).toBeNull();
        }
        expect(() => world.dispose()).not.toThrow();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(renderer.shadowMap.enabled).toBe(false);
        // A late frame or a late event after retirement is harmless.
        expect(() => {
            world.updateCamera(camera, { time: 11, delta: 0.016 });
            world.update({ time: 11, delta: 0.016 }, camera);
            world.onLock({ u: 0.5 });
            world.onClear({ lines: 4 });
            world.onCombo(3);
            world.levelUp(2);
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null);
            world.showOnlyParts(['sky']);
            world.resetSession();
            world.seek(3);
        }).not.toThrow();
        expect(world.getState()).toMatchObject({
            crystals: 0, masonry: 0, sparks: 0, held: [0, 0], arrivals: 0,
        });
    });

    it('hands the renderer\'s shadow switch back as it found it, and leaves it alone on a tier without shadows', () => {
        const shadowed = QUALITY_NAMES.find((name) => QUALITY[name].shadowMap > 0);
        const flat = QUALITY_NAMES.find((name) => QUALITY[name].shadowMap === 0);
        // Already on (another surface shares the renderer): still on afterwards.
        const on = { shadowMap: { enabled: true } };
        const kept = makeWorld(shadowed, { renderer: on });
        expect(on.shadowMap.enabled).toBe(true);
        kept.world.dispose();
        expect(on.shadowMap.enabled).toBe(true);
        // No shadow map on this tier: never touched.
        const off = { shadowMap: { enabled: false } };
        const plain = makeWorld(flat, { renderer: off });
        expect(plain.world.sun).toBeNull();
        expect(off.shadowMap.enabled).toBe(false);
        plain.world.dispose();
        expect(off.shadowMap.enabled).toBe(false);
    });

    it('builds without a renderer, and with one that has no shadow switch', () => {
        for (const quality of ['Minimal', 'High']) {
            for (const renderer of [null, undefined, {}]) {
                const { camera, world } = makeWorld(quality, { renderer });
                expect(Boolean(world.sun), quality).toBe(QUALITY[quality].shadowMap > 0);
                expect(() => {
                    world.onLock({ u: 0.3, hardDrop: true });
                    world.onClear({ lines: 4 });
                    run(world, camera, 0.5);
                    world.dispose();
                }).not.toThrow();
            }
        }
    });

    it('cuts the plan from the seed it is given, and from its own without one', () => {
        const seeded = makeWorld('Minimal', { seed: 77 });
        const own = makeWorld('Minimal');
        const again = makeWorld('Minimal');
        expect(seeded.world.plan.seed).toBe(77);
        expect(own.world.plan.seed).toBe(again.world.plan.seed);
        expect(JSON.stringify(own.world.plan.gems)).toBe(JSON.stringify(again.world.plan.gems));
        expect(JSON.stringify(seeded.world.plan.gems)).not.toBe(JSON.stringify(own.world.plan.gems));
        for (const { world } of [seeded, own, again]) world.dispose();
    });
});

describe('halcyon apex world: camera and composition', () => {
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

    it('stands in the lagoon at the origin, a little above the water, looking where the composition says', () => {
        const { camera, world } = makeWorld('Minimal');
        const comp = compositionFor(1600 / 900);
        expect(Math.abs(camera.position.x)).toBeLessThan(2);
        expect(Math.abs(camera.position.y - REST_RIG.height)).toBeLessThan(0.5);
        expect(camera.position.z).toBe(0);
        expect(camera.position.y).toBeGreaterThan(0);
        expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 3);
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        const forward = camera.getWorldDirection(new THREE.Vector3());
        expect(forward.z).toBeLessThan(0);
        expect(Math.asin(forward.y)).toBeCloseTo(comp.pitch, 1);
        expect(Math.atan2(-forward.x, -forward.z)).toBeCloseTo(comp.yaw, 1);
        // The rest camera is that rig without the drift.
        const rest = world.restCamera();
        expect(rest.position.toArray()).toEqual([0, REST_RIG.height, 0]);
        expect(rest.fov).toBe(fovForAspect(1600 / 900));
        expect(rest.getWorldDirection(new THREE.Vector3()).angleTo(forward)).toBeLessThan(0.05);
        world.dispose();
    });

    it('turns the rig toward the pyramid on an upright frame, and tips it as the composition says', () => {
        const wide = makeWorld('Minimal');
        const tall = makeWorld('Minimal', { width: 430, height: 932 });
        const look = ({ world }) => world.restCamera().getWorldDirection(new THREE.Vector3());
        const toPyramid = new THREE.Vector3(SITE.pyramid.x, 0, SITE.pyramid.z).normalize();
        const off = (direction) => new THREE.Vector3(direction.x, 0, direction.z).normalize().angleTo(toPyramid);
        expect(off(look(tall))).toBeLessThan(off(look(wide)));
        // Up or down is the composition's to say; the rig only has to follow it.
        expect(Math.sign(look(tall).y - look(wide).y))
            .toBe(Math.sign(compositionFor(430 / 932).pitch - compositionFor(1600 / 900).pitch));
        for (const [view, aspect] of [[wide, 1600 / 900], [tall, 430 / 932]]) {
            const comp = compositionFor(aspect);
            const direction = look(view);
            expect(Math.asin(direction.y)).toBeCloseTo(comp.pitch, 9);
            expect(Math.atan2(-direction.x, -direction.z)).toBeCloseTo(comp.yaw, 9);
            expect(view.world.restCamera().fov).toBe(fovForAspect(aspect));
            // The camera the theme renders with follows the same rig.
            expect(view.camera.getWorldDirection(new THREE.Vector3()).angleTo(direction)).toBeLessThan(0.05);
        }
        wide.world.dispose();
        tall.world.dispose();
    });

    it('hangs the sun where the composition wants it, whatever the frame', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [1024, 768], [900, 900], [430, 932]]) {
            const frame = `${width}x${height}`;
            const { world } = makeWorld('Minimal', { width, height });
            const comp = compositionFor(width / height);
            const sun = world.u.sunDir.value;
            expect(sun.length(), frame).toBeCloseTo(1, 9);
            expect(sun.y, frame).toBeGreaterThanOrEqual(Math.sin(SUN_FLOOR) - 1e-9);
            const wanted = world.restDirection(comp.sun.x, comp.sun.y, new THREE.Vector3());
            const rest = world.restCamera();
            const seen = onScreen(rest, sun.x * 1000, rest.position.y + sun.y * 1000, sun.z * 1000);
            if (wanted.y >= Math.sin(SUN_FLOOR)) {
                expect(seen.x, frame).toBeCloseTo(comp.sun.x, 6);
                expect(seen.y, frame).toBeCloseTo(comp.sun.y, 6);
            } else {
                // Too low for a sunrise: lifted to the floor on the same bearing.
                expect(Math.asin(sun.y), frame).toBeCloseTo(SUN_FLOOR, 9);
                expect(Math.atan2(sun.x, -sun.z), frame).toBeCloseTo(Math.atan2(wanted.x, -wanted.z), 9);
            }
            expect(world.getState().sun).toEqual(sun.toArray());
            world.dispose();
        }
    });

    it('never hangs the sun below its floor', () => {
        const { world } = makeWorld('Minimal');
        const sun = world.u.sunDir.value;
        const low = new THREE.Vector3();
        vi.spyOn(world, 'restDirection').mockImplementation((sx, sy, out) => out.copy(low));
        // A composition that asks for a sun on the horizon, or under it.
        for (const [x, y, z] of [[0.6, 0.01, -0.8], [0.3, -0.4, -0.9], [-0.2, 0, -1]]) {
            low.set(x, y, z).normalize();
            world.composeSky();
            expect(Math.asin(sun.y)).toBeCloseTo(SUN_FLOOR, 9);
            expect(sun.length()).toBeCloseTo(1, 9);
            // Lifted, not turned.
            expect(Math.atan2(sun.x, -sun.z)).toBeCloseTo(Math.atan2(low.x, -low.z), 9);
        }
        // One that is high enough is left alone.
        low.set(0.4, 0.5, -0.76).normalize();
        world.composeSky();
        expect(sun.distanceTo(low)).toBeLessThan(1e-12);
        world.dispose();
    });

    it('hangs the Halcyon before the sun at its distance, and stands the dial under it', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [900, 900], [430, 932]]) {
            const frame = `${width}x${height}`;
            const { world } = makeWorld('Minimal', { width, height });
            const sun = world.u.sunDir.value;
            const [hx, hy, hz] = world.halcyon;
            expect(Math.hypot(hx, hz), frame).toBeCloseTo(SITE.halcyon.distance, 9);
            expect(hy, frame).toBe(SITE.halcyon.height);
            expect(world.u.halcyonPos.value.toArray(), frame).toEqual(world.halcyon);
            expect(world.getState().halcyon, frame).toEqual(world.halcyon);
            // A little left of the sun's bearing, but never left of the open lagoon.
            const bearing = Math.atan2(hx, -hz);
            const wanted = Math.atan2(sun.x, -sun.z) + SITE.halcyon.bearing;
            expect(bearing, frame).toBeCloseTo(Math.max(BEARING_FLOOR, wanted), 9);
            expect(bearing, frame).toBeGreaterThanOrEqual(BEARING_FLOOR - 1e-9);
            expect(hz, frame).toBeLessThan(0);
            expect(hx, frame).toBeGreaterThan(0);
            // The dial: its masonry and its ley lines stand under the Halcyon, stone 0 toward the viewer.
            for (const name of ['dial', 'dialLey']) {
                const { mesh } = world.parts[name];
                expect(mesh.position.toArray(), `${frame} ${name}`).toEqual([hx, 0, hz]);
                expect(mesh.rotation.y, `${frame} ${name}`).toBeCloseTo(world.dialYaw, 12);
            }
            const dial = gemsOf(world, GEM.dial);
            expect(dial).toHaveLength(SITE.dial.stones);
            for (const index of dial) {
                const gem = world.crystals.gems[index];
                const at = world.crystals.positionOf(index);
                // Each crystal floats over its own stone, where the mesh draws that stone.
                const stone = new THREE.Vector3(gem.x, 0, gem.z).applyMatrix4(world.parts.dial.mesh.matrixWorld);
                expect(at[0], `${frame} stone ${index}`).toBeCloseTo(stone.x, 6);
                expect(at[2], `${frame} stone ${index}`).toBeCloseTo(stone.z, 6);
                expect(Math.hypot(at[0] - hx, at[2] - hz), frame).toBeCloseTo(SITE.dial.radius, 6);
            }
            const nearest = world.crystals.positionOf(dial[0]);
            expect(Math.hypot(nearest[0], nearest[2]), frame).toBeCloseTo(SITE.halcyon.distance - SITE.dial.radius, 6);
            // The Halcyon itself floats on that axis, and the Apex over the pyramid.
            const halcyon = world.crystals.positionOf(gemsOf(world, GEM.halcyon)[0]);
            expect([halcyon[0], halcyon[2]]).toEqual([hx, hz]);
            const apex = world.crystals.positionOf(gemsOf(world, GEM.apex)[0]);
            expect([apex[0], apex[2]]).toEqual([world.plan.apex[0], world.plan.apex[2]]);
            expect(world.u.apexPos.value.toArray()).toEqual(world.plan.apex);
            world.dispose();
        }
    });

    it('keeps the Halcyon right of its bearing floor however far left the sun is hung', () => {
        const { world } = makeWorld('Minimal');
        const aim = new THREE.Vector3();
        vi.spyOn(world, 'restDirection').mockImplementation((sx, sy, out) => out.copy(aim));
        for (const [x, y, z] of [[0, 0.3, -1], [-0.5, 0.3, -0.8], [0.1, 0.4, -1]]) {
            aim.set(x, y, z).normalize();
            world.composeSky();
            expect(Math.atan2(world.halcyon[0], -world.halcyon[2])).toBeCloseTo(BEARING_FLOOR, 9);
            expect(Math.hypot(world.halcyon[0], world.halcyon[2])).toBeCloseTo(SITE.halcyon.distance, 9);
        }
        // A sun well to the right takes the Halcyon with it.
        aim.set(0.7, 0.3, -0.65).normalize();
        world.composeSky();
        const wanted = Math.atan2(aim.x, -aim.z) + SITE.halcyon.bearing;
        expect(wanted).toBeGreaterThan(BEARING_FLOOR);
        expect(Math.atan2(world.halcyon[0], -world.halcyon[2])).toBeCloseTo(wanted, 9);
        world.dispose();
    });

    it('recomposes when the frame changes shape', () => {
        const { world } = makeWorld('Minimal');
        const sun = world.u.sunDir.value.clone();
        const halcyon = [...world.halcyon];
        const targets = JSON.stringify(world.targets);
        const viewport = world.u.viewport.value;
        world.setViewport(430, 932, 430 / 932);
        expect(viewport.toArray()).toEqual([430, 932]);
        expect(world.aspect).toBeCloseTo(430 / 932, 12);
        expect(world.u.sunDir.value.distanceTo(sun)).toBeGreaterThan(0.01);
        expect(Math.hypot(world.halcyon[0] - halcyon[0], world.halcyon[2] - halcyon[2])).toBeGreaterThan(0.1);
        expect(world.parts.dial.mesh.position.toArray()).toEqual([world.halcyon[0], 0, world.halcyon[2]]);
        expect(world.u.halcyonPos.value.toArray()).toEqual(world.halcyon);
        // The wisps' targets are found again for the new view.
        expect(JSON.stringify(world.targets)).not.toBe(targets);
        expect(world.targets.a.length).toBeGreaterThan(0);
        expect(world.targets.b.length).toBeGreaterThan(0);
        // A degenerate buffer or aspect is ignored.
        world.setViewport(0, 0, NaN);
        expect(viewport.toArray()).toEqual([430, 932]);
        expect(world.aspect).toBeCloseTo(430 / 932, 12);
        // A layout read brings the aspect too, and the picture goes back.
        world.setLayout(null, 1600 / 900);
        expect(world.u.sunDir.value.distanceTo(sun)).toBeLessThan(1e-12);
        expect(world.halcyon).toEqual(halcyon);
        expect(world.parts.dial.mesh.position.toArray()).toEqual([halcyon[0], 0, halcyon[2]]);
        world.dispose();
    });

    it('finds the lagoon under a screen point and falls back above the horizon', () => {
        const { camera, world } = makeWorld('Minimal');
        const strike = world.screenToLagoon(0.5, 0.95, { x: 0, z: 0 });
        // It is the point of the water that screen point shows: ahead, a few steps away.
        const seen = onScreen(camera, strike.x, 0, strike.z);
        expect(seen.x).toBeCloseTo(0.5, 6);
        expect(seen.y).toBeCloseTo(0.95, 6);
        expect(strike.z).toBeLessThan(0);
        // Left of centre on screen is left in the lagoon; higher on screen is further out.
        expect(world.screenToLagoon(0.2, 0.95, { x: 0, z: 0 }).x).toBeLessThan(strike.x);
        expect(world.screenToLagoon(0.5, 0.85, { x: 0, z: 0 }).z).toBeLessThan(strike.z);
        // A point in the sky has no water under it: so many metres ahead instead, on its bearing.
        const sky = world.screenToLagoon(0.5, 0.1, { x: 0, z: 0 }, 30);
        expect(Math.hypot(sky.x - camera.position.x, sky.z - camera.position.z)).toBeCloseTo(30, 6);
        expect(sky.z).toBeLessThan(0);
        expect(world.screenToLagoon(0.9, 0.05, { x: 0, z: 0 }, 30).x).toBeGreaterThan(sky.x);
        // Without an `out`, one object is reused.
        expect(world.screenToLagoon(0.5, 0.95)).toBe(world.screenToLagoon(0.4, 0.9));
        // A point in the air in front of the card.
        const [x, y, z] = world.screenToWorld(0.3, 0.6, 7, [0, 0, 0]);
        expect(camera.position.distanceTo(new THREE.Vector3(x, y, z))).toBeCloseTo(7, 6);
        expect(onScreen(camera, x, y, z).x).toBeCloseTo(0.3, 6);
        expect(onScreen(camera, x, y, z).y).toBeCloseTo(0.6, 6);
        world.dispose();

        // Before any camera is known: straight ahead of the rig.
        const blind = new HalcyonApexWorld({ scene: new THREE.Scene(), quality: 'Minimal' }).build();
        expect(blind.screenToLagoon(0.2, 0.9, { x: 5, z: 5 }, 14)).toEqual({ x: 0, z: -14 });
        expect(blind.screenToWorld(0.2, 0.9, 7, [1, 1, 1])).toEqual([0, REST_RIG.height, -7]);
        blind.dispose();
    });

    it('leans the view with the pointer', () => {
        const { camera, world } = makeWorld('Minimal');
        const at = (pointerX, pointerY) => {
            world.updateCamera(camera, {
                time: 10, delta: 0, pointerX, pointerY,
            });
            return { position: camera.position.clone(), heart: { ...world.heart } };
        };
        const rest = at(0, 0);
        const right = at(1, 0);
        const left = at(-1, 0);
        const down = at(0, 1);
        expect(right.position.x).toBeGreaterThan(rest.position.x + 0.1);
        expect(left.position.x).toBeLessThan(rest.position.x - 0.1);
        expect(down.position.y).toBeLessThan(rest.position.y);
        // The picture slides: the sun moves in the frame, opposite ways for opposite leans.
        expect((right.heart.x - rest.heart.x) * (left.heart.x - rest.heart.x)).toBeLessThan(0);
        expect(down.heart.y).not.toBeCloseTo(rest.heart.y, 4);
        world.dispose();
    });

    it('keeps the camera still under reduced motion, and keeps the feedback', () => {
        const { camera, world } = makeWorld('Low');
        world.setReducedMotion(true);
        run(world, camera, 3);
        const post = new THREE.Vector3(0, REST_RIG.height, 0);
        const up = new THREE.Vector3(0, 1, 0);
        const pose = camera.quaternion.clone();
        // No sway, no pointer lean, no impact punch.
        world.onLock({ u: 0.5, hardDrop: true, color: '#ffa8d0' });
        world.onClear({ lines: 4 });
        world.onCombo(8);
        let moved = 0;
        for (let i = 0; i < 120; i++) {
            const sim = {
                time: world.time + 1 / 60, delta: 1 / 60, pointerX: 1, pointerY: -1,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            if (camera.position.distanceTo(post) !== 0 || camera.up.distanceTo(up) !== 0) moved += 1;
            if (camera.fov !== fovForAspect(1600 / 900) || camera.quaternion.angleTo(pose) > 1e-9) moved += 1;
        }
        expect(moved).toBe(0);
        // Feedback stays: the ring, the wisp and its pulse, the wave, the charge.
        expect(rings(world).length).toBeGreaterThan(0);
        expect(world.counts).toMatchObject({
            locks: 1, wisps: 1, clears: 1, quads: 1,
        });
        expect(world.counts.pulses).toBeGreaterThan(0);
        expect(world.u.clearA[0].value.z).toBeGreaterThan(0);
        expect(world.power).toBeGreaterThan(0.5);
        world.dispose();

        // The sky's ring across a four-line clear is gentler, and the slow clocks run slower.
        const calm = makeWorld('Low');
        const lively = makeWorld('Low');
        calm.world.setReducedMotion(true);
        for (const { world: w } of [calm, lively]) w.onClear({ lines: 4 });
        expect(calm.world.u.shock.value.y).toBeGreaterThan(0);
        expect(calm.world.u.shock.value.y).toBeLessThan(lively.world.u.shock.value.y);
        for (const clock of ['cloudDrift', 'spin', 'beadLift']) {
            const from = [calm.world[clock], lively.world[clock]];
            run(calm.world, calm.camera, 1);
            run(lively.world, lively.camera, 1);
            expect(calm.world[clock] - from[0], clock).toBeGreaterThan(0);
            expect(calm.world[clock] - from[0], clock).toBeLessThan(lively.world[clock] - from[1]);
        }
        calm.world.dispose();
        lively.world.dispose();
    });
});

describe('halcyon apex world: locks', () => {
    it('drops a lock into the lagoon under the board and rings it in the piece\'s colour', () => {
        const { camera, world } = makeWorld('Low');
        const board = boardFor(world.layout, 0);
        expect(rings(world)).toHaveLength(0);
        world.onLock({ rows: [19], u: 0.9, color: '#ffa8d0' });
        // One ring, born now.
        expect(rings(world)).toHaveLength(1);
        const right = ringBornAt(world, world.time);
        expect(right).toBeTruthy();
        // On the water where it shows under the board's foot, below the piece's own column.
        const seen = onScreen(camera, right.place.x, 0, right.place.y);
        expect(seen.x).toBeCloseTo(boardPoint(board, 0.9, 19).x, 5);
        expect(seen.y).toBeGreaterThanOrEqual(board.y1 - 1e-6);
        expect(seen.y).toBeLessThanOrEqual(1);
        expect(world.screenToLagoon(seen.x, seen.y, { x: 0, z: 0 }).z).toBeCloseTo(right.place.y, 6);
        // The ring keeps the piece's hue.
        const rgb = pieceColor('#ffa8d0');
        expect(right.colour.x).toBeGreaterThan(0);
        expect(right.colour.y / right.colour.x).toBeCloseTo(rgb[1] / rgb[0], 6);
        expect(right.colour.z / right.colour.x).toBeCloseTo(rgb[2] / rgb[0], 6);
        expect(right.colour.w).toBeGreaterThan(0); // how far it runs
        const landed = right.place.x;
        // Left of the board's centre lands left of it.
        run(world, camera, 1 / 60, 1);
        world.onLock({ rows: [19], u: 0.05 });
        const left = ringBornAt(world, world.time);
        expect(left.place.x).toBeLessThan(landed);
        // A lock without a colour still rings, in the sanctuary's own.
        expect(Math.min(left.colour.x, left.colour.y, left.colour.z)).toBeGreaterThan(0);
        expect(rings(world)).toHaveLength(2);
        expect(world.counts.locks).toBe(2);
        // The rings switch the lagoon's loop on.
        settle(world, camera);
        expect(world.u.ringsLive.value).toBe(1);
        world.dispose();
    });

    it('sends the left half of the board to the causeway\'s line and the right half to the dial\'s', () => {
        const { camera, world } = makeWorld('Low');
        const lock = (u) => {
            run(world, camera, 1 / 60, 1);
            const [pulse] = pulsesSentBy(world, () => world.onLock({ u, rows: [15] }));
            const gem = world.crystals.gems[gemAt(world, lastWisp(world).to)];
            return { line: pulse.slot.y, kind: gem.kind, on: gem.line };
        };
        for (const u of [0, 0.2, 0.4]) expect(lock(u), `u = ${u}`).toEqual({ line: 0, kind: GEM.shard, on: 0 });
        for (const u of [0.6, 0.8, 1]) expect(lock(u), `u = ${u}`).toEqual({ line: 1, kind: GEM.dial, on: 1 });
        // A piece on the board's centre line goes one way, then the other.
        const centred = [lock(0.5), lock(0.5), lock(0.5), lock(0.5)].map((sent) => sent.line);
        expect(centred[1]).toBe(1 - centred[0]);
        expect(centred[2]).toBe(centred[0]);
        expect(centred[3]).toBe(centred[1]);
        world.dispose();
    });

    it('flies a wisp from the card to the head of a ley line and runs a pulse on from there', () => {
        for (const [u, line, kind, length] of [[0.1, 0, GEM.shard, LEY_A.length], [0.9, 1, GEM.dial, LEY_B.length]]) {
            const { camera, world } = makeWorld('Low');
            const card = cardUnion(world.layout);
            const board = boardFor(world.layout, 0);
            const rgb = pieceColor('#a8ffe8');
            expect(world.held).toEqual([0, 0]);
            world.onLock({ rows: [11, 12, 13], u, color: '#a8ffe8' });
            expect(world.counts).toMatchObject({ locks: 1, wisps: 1, pulses: 1 });

            // The wisp: a head and its tail in one slot, leaving the card's edge on the piece's
            // side at the piece's own height, now...
            const wisp = lastWisp(world);
            expect(used(world.wisps, 'aFrom')).toHaveLength(WISP_TAIL);
            expect(wisp.born).toBeCloseTo(world.time, 5);
            expect(wisp.flight).toBeGreaterThan(0);
            const start = onScreen(camera, ...wisp.from);
            expect(start.x).toBeCloseTo(line === 0 ? card.x0 : card.x1, 4);
            expect(start.y).toBeCloseTo(boardPoint(board, u, 12).y, 4);
            // ...and flying to a crystal at the head of that side's line, where it floats now,
            // in the piece's colour.
            const index = gemAt(world, wisp.to);
            expect(index).toBeGreaterThanOrEqual(0);
            const gem = world.crystals.gems[index];
            expect(gem.kind).toBe(kind);
            expect(gem.line).toBe(line);
            expect(line === 0 ? world.targets.a : world.targets.b).toContain(index);
            for (let k = 0; k < 3; k++) expect(wisp.tint[k]).toBeCloseTo(rgb[k], 6);

            // The pulse: one slot, on that line, in that colour, born so that its packet is at
            // the crystal just as the wisp gets there.
            const sent = pulses(world);
            expect(sent).toHaveLength(1);
            const [pulse] = sent;
            const arrive = wisp.born + wisp.flight;
            expect(pulse.slot.y).toBe(line);
            expect(pulse.slot.z).toBeGreaterThan(0);
            expect(pulse.slot.x).toBeCloseTo(arrive - gem.s / PULSE_SPEED, 4);
            expect(pulse.slot.x + pulseArrival(gem.s)).toBeCloseTo(arrive, 4);
            expect(pulse.colour.toArray().map((c, k) => c - rgb[k]).every((d) => Math.abs(d) < 1e-9)).toBe(true);

            // The great crystal at the end of the line takes the light when the pulse gets there:
            // not before, and not the other one.
            expect(world.crystals.lineLength(line)).toBe(length);
            const due = pulse.slot.x + length / PULSE_SPEED;
            expect(world.arrivals).toHaveLength(1);
            expect(world.arrivals[0]).toMatchObject({ kind: 'hold', line });
            expect(world.arrivals[0].time).toBeCloseTo(due, 9);
            expect(due).toBeGreaterThan(arrive);
            runTo(world, camera, due - 0.02);
            expect(world.held).toEqual([0, 0]);
            expect(world.u.pulsesLive.value).toBe(1);
            runTo(world, camera, due + 0.02);
            expect(world.held[line]).toBeGreaterThan(0);
            expect(world.held[1 - line]).toBe(0);
            expect(world.getState()).toMatchObject({ arrivals: 0, held: world.held });
            // The shaders are told: how much each holds, and in what colour.
            expect(world.u.held.value.toArray().slice(0, 2)).toEqual(world.held);
            const told = (line === 0 ? world.u.heldA : world.u.heldB).value.toArray();
            for (let k = 0; k < 3; k++) expect(told[k]).toBeCloseTo(rgb[k], 6);
            world.dispose();
        }
    });

    it('hits harder on a hard drop: two pulses, a crown of spray where it struck and a kick', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        soft.world.onLock({ u: 0.2, rows: [19], color: '#ffd4a8' });
        hard.world.onLock({
            u: 0.2, rows: [19], color: '#ffd4a8', hardDrop: true,
        });
        const softRing = ringBornAt(soft.world, soft.world.time);
        const hardRing = ringBornAt(hard.world, hard.world.time);
        // The same place, a stronger ring that runs further.
        expect(hardRing.place.x).toBeCloseTo(softRing.place.x, 9);
        expect(hardRing.place.y).toBeCloseTo(softRing.place.y, 9);
        expect(hardRing.place.w).toBeGreaterThan(softRing.place.w);
        expect(hardRing.colour.w).toBeGreaterThan(softRing.colour.w);
        // Two packets up the same line, one on the heels of the other, where a lock sends one.
        expect(soft.world.counts.pulses).toBe(1);
        expect(hard.world.counts.pulses).toBe(2);
        const [first, second] = pulses(hard.world);
        const [only] = pulses(soft.world);
        expect(first.slot.y).toBe(only.slot.y);
        expect(second.slot.y).toBe(first.slot.y);
        expect(second.slot.x).toBeGreaterThan(first.slot.x);
        expect(first.slot.z).toBeGreaterThan(only.slot.z);
        // One wisp either way, and the great crystal is promised both packets.
        expect(hard.world.counts.wisps).toBe(1);
        expect(hard.world.arrivals.filter((arrival) => arrival.kind === 'hold')).toHaveLength(2);
        expect(soft.world.arrivals.filter((arrival) => arrival.kind === 'hold')).toHaveLength(1);
        // A crown of spray: sparks thrown now, upward, from the water where it struck.
        const crown = sparksBornAt(hard.world, hard.world.time);
        expect(crown.length).toBeGreaterThan(0);
        for (const spark of crown) {
            expect(spark.x).toBeCloseTo(hardRing.place.x, 4);
            expect(spark.z).toBeCloseTo(hardRing.place.y, 4);
            expect(spark.y).toBeLessThan(1);
            expect(spark.up).toBeGreaterThan(0);
        }
        expect(sparksBornAt(soft.world, soft.world.time)).toHaveLength(0);
        // The camera takes the blow: the lens punches in, the view dips, and both settle.
        expect(hard.world.kick).toBeGreaterThan(soft.world.kick);
        expect(soft.world.kick).toBeGreaterThan(0);
        const rest = fovForAspect(1600 / 900);
        const height = hard.camera.position.y;
        settle(hard.world, hard.camera);
        expect(hard.camera.fov).toBeLessThan(rest);
        expect(hard.camera.position.y).toBeLessThan(height);
        expect(hard.world.getPostState().kick).toBe(hard.world.kick);
        expect(hard.world.getPostState().flash).toBeGreaterThan(0);
        run(hard.world, hard.camera, 3);
        expect(hard.world.kick).toBeLessThan(1e-6);
        expect(hard.camera.fov).toBeCloseTo(rest, 4);
        soft.world.dispose();
        hard.world.dispose();
    });

    it('never lets a great crystal hold more than its fill, and lets what it holds fade', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.9 });
        runTo(world, camera, world.arrivals[0].time + 0.02);
        const one = world.held[1];
        expect(one).toBeGreaterThan(0);
        expect(one).toBeLessThan(HOLD_MAX);
        // More locks than it can hold, each given time to land.
        let peak = one;
        const watch = () => {
            peak = Math.max(peak, world.held[1]);
        };
        const more = Math.ceil(HOLD_MAX / one) + 2;
        for (let i = 0; i < more; i++) {
            world.onLock({ u: 0.9 });
            run(world, camera, 0.1, 6, watch);
        }
        runTo(world, camera, Math.max(world.time, ...world.arrivals.map((arrival) => arrival.time)) + 0.02, watch);
        expect(world.arrivals).toHaveLength(0);
        expect(peak).toBeLessThanOrEqual(HOLD_MAX);
        expect(peak).toBeGreaterThan(HOLD_MAX * Math.exp(-1 / HOLD_FADE)); // it did fill
        expect(world.held[0]).toBe(0);
        expect(world.u.held.value.y).toBe(world.held[1]);
        // Left alone it fades to 1/e in HOLD_FADE seconds, whatever the frame rate.
        const before = world.held[1];
        run(world, camera, HOLD_FADE / 2, 30);
        run(world, camera, HOLD_FADE / 2, 600);
        expect(world.held[1]).toBeCloseTo(before / Math.E, 9);
        world.dispose();
    });

    it('reuses its ring and pulse slots and never grows a pool', () => {
        const { camera, world } = makeWorld('Low');
        const pool = ({ count, geometry }, name) => [
            count, geometry.instanceCount, geometry.getAttribute(name).array.length,
        ];
        const sizes = () => ({
            rings: [world.u.lockA.length, world.u.lockC.length],
            pulses: [world.u.pulseA.length, world.u.pulseC.length],
            clears: [world.u.clearA.length, world.u.clearC.length],
            wisps: pool(world.wisps, 'aFrom'),
            sparks: pool(world.sparks, 'aBirth'),
            crystals: pool(world.crystals, 'aPos'),
            drawn: world.root.children.length,
        });
        const before = sizes();
        expect(before.rings).toEqual([LOCK_SLOTS, LOCK_SLOTS]);
        expect(before.pulses).toEqual([PULSE_SLOTS, PULSE_SLOTS]);
        expect(before.clears).toEqual([CLEAR_SLOTS, CLEAR_SLOTS]);
        expect(before.wisps[0]).toBe(WISP_SLOTS * WISP_TAIL);
        const births = [];
        const total = Math.max(LOCK_SLOTS, PULSE_SLOTS, WISP_SLOTS) * 2 + 1;
        for (let i = 0; i < total; i++) {
            run(world, camera, 1 / 60, 1);
            world.onLock({ u: i % 2 ? 0.2 : 0.8, color: '#8090e0' });
            births.push(world.time);
        }
        expect(sizes()).toEqual(before);
        expect(world.counts).toMatchObject({ locks: total, wisps: total, pulses: total });
        // The slots hold the newest locks; the oldest have been written over.
        expect(world.u.lockA.map((slot) => slot.value.z).sort((a, b) => a - b)).toEqual(births.slice(-LOCK_SLOTS));
        expect(rings(world)).toHaveLength(LOCK_SLOTS);
        expect(pulses(world)).toHaveLength(PULSE_SLOTS);
        expect(used(world.wisps, 'aFrom')).toHaveLength(WISP_SLOTS * WISP_TAIL);
        // A ring on request goes round the same slots.
        for (let i = 0; i < LOCK_SLOTS + 2; i++) world.ring(i, -i, 500 + i, 1, [1, 0.5, 0.25], 0.5);
        expect(sizes()).toEqual(before);
        expect(world.u.lockA.map((slot) => slot.value.z).sort((a, b) => a - b))
            .toEqual(Array.from({ length: LOCK_SLOTS }, (_, i) => 502 + i));
        world.dispose();
    });

    it('aims at the click when a mode has no board to aim through', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        world.onLock({ screen: { x: 0.25, y: 0.8 }, color: '#ffc050' });
        // The ring lands on the water the click shows...
        const ring = ringBornAt(world, world.time);
        const seen = onScreen(camera, ring.place.x, 0, ring.place.y);
        expect(seen.x).toBeCloseTo(0.25, 5);
        expect(seen.y).toBeGreaterThanOrEqual(0.8 - 1e-6);
        // ...the wisp leaves from the click itself, for the line on the click's side.
        const start = onScreen(camera, ...lastWisp(world).from);
        expect(start.x).toBeCloseTo(0.25, 4);
        expect(start.y).toBeCloseTo(0.8, 4);
        expect(pulses(world)[0].slot.y).toBe(0);
        expect(world.crystals.gems[gemAt(world, lastWisp(world).to)].kind).toBe(GEM.shard);
        // A click in the sky still lands on the water below it.
        run(world, camera, 1 / 60, 1);
        const [pulse] = pulsesSentBy(world, () => world.onLock({ screen: { x: 0.75, y: 0.3 } }));
        const high = ringBornAt(world, world.time);
        const landed = onScreen(camera, high.place.x, 0, high.place.y);
        expect(landed.x).toBeCloseTo(0.75, 5);
        expect(landed.y).toBeGreaterThan(0.3);
        const lifted = onScreen(camera, ...lastWisp(world).from);
        expect(lifted.x).toBeCloseTo(0.75, 4);
        expect(lifted.y).toBeCloseTo(0.3, 4);
        expect(pulse.slot.y).toBe(1);
        world.dispose();
    });

    it('keeps a bounded queue of what is still to come, however many locks flood in', () => {
        const { camera, world } = makeWorld('Low');
        const lengths = [];
        for (let i = 0; i < 150; i++) {
            world.onLock({ u: i % 2 ? 0.1 : 0.9, hardDrop: true });
            lengths.push(world.arrivals.length);
        }
        // Three hundred pulses were sent; the queue stopped growing long before.
        expect(world.counts.pulses).toBe(300);
        const cap = Math.max(...lengths);
        expect(cap).toBeLessThan(150);
        expect(lengths.slice(-100).every((length) => length === cap)).toBe(true);
        expect(world.getState().arrivals).toBe(cap);
        // What is left resolves, and the crystals hold no more than their fill.
        run(world, camera, 4);
        expect(world.arrivals).toHaveLength(0);
        expect(world.held[0]).toBeGreaterThan(0);
        expect(world.held[1]).toBeGreaterThan(0);
        expect(Math.max(...world.held)).toBeLessThanOrEqual(HOLD_MAX);
        world.dispose();
    });

    it('resolves what falls due in one frame in the order it happened', () => {
        const { camera, world } = makeWorld('Low');
        const rgb = [0.4, 1, 0.9];
        // A clear's wave reaches the Apex a few milliseconds before a pulse does, inside one
        // frame: the crystal lets go of what it held, then takes the new light and keeps it.
        world.schedule({
            kind: 'hold', time: world.time + 0.010, line: 0, rgb, amount: 1,
        });
        world.schedule({
            kind: 'release', time: world.time + 0.004, line: 0, rgb, amount: 1, quad: false,
        });
        run(world, camera, 1 / 60, 1);
        expect(world.arrivals).toHaveLength(0);
        expect(world.held[0]).toBeGreaterThan(0);
        world.dispose();
    });
});

describe('halcyon apex world: clears, combos and the four-line clear', () => {
    it('sends a wave out from the foot of the board, one front per line, and fires the rows out of the card', () => {
        const { camera, world } = makeWorld('Low');
        const board = boardFor(world.layout, 0);
        const card = cardUnion(world.layout);
        expect(world.u.clearA.every((slot) => slot.value.z === 0)).toBe(true);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        const { stir } = world;
        world.onClear({ lines: 2, rows: [14, 13] });
        // One slot: born now, a front for each line, not the sunfire.
        const slot = world.u.clearA[0].value;
        expect(slot.x).toBe(world.time);
        expect(slot.y).toBe(2);
        expect(slot.z).toBeGreaterThan(0);
        expect(slot.w).toBe(0);
        expect(world.u.clearA.filter((other) => other.value.z > 0)).toHaveLength(1);
        // The wave's heart: the water under the middle of the board's foot.
        const heart = world.u.clearH[0].value;
        const seen = onScreen(camera, heart.x, 0, heart.y);
        expect(seen.x).toBeCloseTo((board.x0 + board.x1) / 2, 5);
        expect(seen.y).toBeGreaterThanOrEqual(board.y1 - 1e-6);
        expect(seen.y).toBeLessThanOrEqual(1);
        // The rows leave the card at their own heights, from its two edges, now, in the wave's colour.
        const beams = world.beams.uniforms;
        const rowY = (row) => boardPoint(board, 0.5, row).y;
        expect(beams.rows.value.toArray()).toEqual([rowY(14), rowY(13), -1, -1]);
        expect(beams.frame.value.toArray().slice(0, 3)).toEqual([card.x0, card.x1, world.time]);
        expect(beams.frame.value.w).toBeGreaterThan(0);
        expect(hueGap(beams.color.value.toArray(), world.u.clearC[0].value.toArray())).toBeLessThan(1e-6);
        // The sanctuary stirs, and the wave switches its loop on.
        expect(world.stir).toBeGreaterThan(stir);
        settle(world, camera);
        expect(world.u.clearLive.value).toBe(1);
        expect(world.counts).toMatchObject({ clears: 1, quads: 0 });
        // Without the rows' numbers, the lowest rows of the board are taken.
        world.onClear({ lines: 3 });
        expect(beams.rows.value.toArray()).toEqual([rowY(19), rowY(18), rowY(17), -1]);
        // The next clear takes the next slot; after the last slot comes the first again.
        expect(world.u.clearA[1 % CLEAR_SLOTS].value.y).toBe(3);
        for (let i = 2; i <= CLEAR_SLOTS; i++) world.onClear({ lines: 1 });
        expect(world.u.clearA[0].value.y).toBe(1);
        expect(world.u.clearA).toHaveLength(CLEAR_SLOTS);
        expect(world.counts.clears).toBe(CLEAR_SLOTS + 1);
        world.dispose();
    });

    it('keeps the row beams dark when no board is on screen, or when the clear is a click', () => {
        const away = makeWorld('Low', { live: false });
        away.world.onClear({ lines: 2 });
        expect(away.world.beams.uniforms.frame.value.w).toBe(0);
        expect(away.world.u.clearA[0].value.z).toBeGreaterThan(0); // the wave still runs
        away.world.dispose();

        const { camera, world } = makeWorld('Low');
        world.onClear({ lines: 2, screen: { x: 0.3, y: 0.85 } });
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        // The wave leaves the water the click shows.
        const heart = world.u.clearH[0].value;
        const seen = onScreen(camera, heart.x, 0, heart.y);
        expect(seen.x).toBeCloseTo(0.3, 5);
        expect(seen.y).toBeGreaterThanOrEqual(0.85 - 1e-6);
        world.dispose();
    });

    it('rings the crystals on both ley lines as the wave passes them', () => {
        const { world } = makeWorld('Low');
        expect(used(world.sparks, 'aBirth')).toHaveLength(0);
        world.onClear({ lines: 2 });
        const born = world.time;
        const heart = world.u.clearH[0].value;
        // Every spark the clear has thrown is promised to a crystal on a line, for the moment the
        // wave's first front gets there.
        const birth = world.sparks.geometry.getAttribute('aBirth').array;
        const rung = new Set();
        let stray = 0;
        for (const slot of used(world.sparks, 'aBirth')) {
            const index = gemAt(world, [birth[slot * 4], birth[slot * 4 + 1], birth[slot * 4 + 2]]);
            const at = index < 0 ? null : world.crystals.positionOf(index);
            const due = at ? born + clearPassTime(Math.hypot(at[0] - heart.x, at[2] - heart.y)) : NaN;
            if (Math.abs(birth[slot * 4 + 3] - due) < 1e-3) rung.add(index);
            else stray += 1;
        }
        expect(stray).toBe(0);
        expect(rung.size).toBeGreaterThan(0);
        const kinds = [...rung].map((index) => world.crystals.gems[index].kind);
        expect(kinds.every((kind) => kind === GEM.shard || kind === GEM.dial)).toBe(true);
        // Both lines answer: the causeway's shards and the dial's crystals.
        expect(kinds).toContain(GEM.shard);
        expect(kinds).toContain(GEM.dial);
        world.dispose();
    });

    it('answers one, two and three lines in different colours, ever stronger, and four in sunfire', () => {
        const answer = (clear, level = 1) => {
            const { world } = makeWorld('Low');
            world.levelUp(level, { silent: true });
            world.onClear(clear);
            const [birth, fronts, strength, sunfire] = world.u.clearA[0].value.toArray();
            const colour = world.u.clearC[0].value.toArray();
            const { stir, time: now } = world;
            world.dispose();
            return {
                birth, fronts, strength, sunfire, colour, stir, now,
            };
        };
        const by = [1, 2, 3, 4].map((lines) => answer({ lines }));
        by.forEach((clear, i) => {
            expect(clear.fronts).toBe(i + 1);
            expect(clear.sunfire).toBe(i === 3 ? 1 : 0);
            expect(Math.min(...clear.colour)).toBeGreaterThan(0);
            if (i > 0) {
                expect(clear.strength, `${i + 1} lines`).toBeGreaterThan(by[i - 1].strength);
                expect(clear.stir, `${i + 1} lines`).toBeGreaterThan(by[i - 1].stir);
            }
            // One to three lines go at once; four wait out the hush.
            expect(clear.birth).toBe(i === 3 ? clear.now + HUSH_HOLD : clear.now);
        });
        // One line in the ley's light, four in sunfire; no two alike.
        expect(hueGap(by[0].colour, HALCYON_PALETTES[0].ley)).toBeLessThan(1e-6);
        expect(hueGap(by[3].colour, SUNFIRE)).toBeLessThan(1e-6);
        for (let i = 0; i < 4; i++) {
            for (let j = i + 1; j < 4; j++) {
                expect(hueGap(by[i].colour, by[j].colour), `${i + 1} vs ${j + 1}`).toBeGreaterThan(0.05);
            }
        }
        // The level's hour colours the first three; sunfire is sunfire at any hour.
        const [dawn] = HALCYON_PALETTES;
        const later = HALCYON_PALETTES.findIndex((palette, i) => i > 0 && hueGap(palette.ley, dawn.ley) > 0.05);
        expect(later).toBeGreaterThan(0);
        expect(hueGap(answer({ lines: 1 }, later + 1).colour, HALCYON_PALETTES[later].ley)).toBeLessThan(1e-6);
        expect(hueGap(answer({ lines: 4 }, later + 1).colour, SUNFIRE)).toBeLessThan(1e-6);
        // Nonsense counts are clamped to what a board can clear.
        expect(answer({ lines: 9 })).toMatchObject({ fronts: 4, sunfire: 1 });
        for (const lines of [0, -3, NaN, undefined, 'x']) {
            expect(answer({ lines }), String(lines)).toMatchObject({ fronts: 1, sunfire: 0 });
        }
        expect(answer({ lines: 2.4 }).fronts).toBe(2);
    });

    it('lets each great crystal go of its light as the wave reaches it, the nearer one first', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.1 });
        run(world, camera, 1 / 60, 1);
        world.onLock({ u: 0.9 });
        runTo(world, camera, Math.max(...world.arrivals.map((arrival) => arrival.time)) + 0.05);
        expect(world.held[0]).toBeGreaterThan(0);
        expect(world.held[1]).toBeGreaterThan(0);
        expect(world.arrivals).toHaveLength(0);

        world.onClear({ lines: 1 });
        const born = world.time;
        const heart = world.u.clearH[0].value;
        const { apex } = world.plan;
        const [hx, , hz] = world.halcyon;
        // When the first front passes each of them.
        const pass = [
            born + clearPassTime(Math.hypot(apex[0] - heart.x, apex[2] - heart.y)),
            born + clearPassTime(Math.hypot(hx - heart.x, hz - heart.y)),
        ];
        // (The queue is in time order; read the two promises by their line.)
        const promised = world.arrivals.filter((arrival) => arrival.kind === 'release').sort((p, q) => p.line - q.line);
        expect(promised.map((arrival) => arrival.line)).toEqual([0, 1]);
        expect(promised[0].time).toBeCloseTo(pass[0], 9);
        expect(promised[1].time).toBeCloseTo(pass[1], 9);
        const [near, far] = pass[0] < pass[1] ? [0, 1] : [1, 0];
        // Whichever of the two stands nearer the board's foot is reached first.
        const away = [Math.hypot(apex[0] - heart.x, apex[2] - heart.y), Math.hypot(hx - heart.x, hz - heart.y)];
        expect(away[near]).toBeLessThan(away[far]);
        expect(pass[far] - pass[near]).toBeGreaterThan(0.05);

        runTo(world, camera, pass[near] - 0.02);
        expect(world.held[near]).toBeGreaterThan(0);
        expect(world.held[far]).toBeGreaterThan(0);
        runTo(world, camera, pass[near] + 0.02);
        expect(world.held[near]).toBe(0);
        expect(world.held[far]).toBeGreaterThan(0);
        runTo(world, camera, pass[far] - 0.02);
        expect(world.held[far]).toBeGreaterThan(0);
        runTo(world, camera, pass[far] + 0.02);
        expect(world.held).toEqual([0, 0]);
        expect(world.arrivals).toHaveLength(0);
        expect(world.u.held.value.toArray().slice(0, 2)).toEqual([0, 0]);
        world.dispose();
    });

    it('kicks the camera a beat after a clear, harder for more lines', () => {
        const { camera, world } = makeWorld('Low');
        world.onClear({ lines: 2 });
        const due = world.pendingKick.time;
        expect(due).toBeGreaterThan(world.time);
        expect(world.pendingKick.amount).toBeGreaterThan(0);
        settle(world, camera);
        expect(world.kick).toBe(0);
        runTo(world, camera, due - 0.01);
        expect(world.kick).toBe(0);
        runTo(world, camera, due + 0.01);
        expect(world.kick).toBeGreaterThan(0);
        expect(world.pendingKick.time).toBe(Infinity);
        expect(world.getPostState().kick).toBe(world.kick);
        expect(world.getPostState().flash).toBeGreaterThan(0);
        // Once, not on every frame after.
        const kicked = world.kick;
        run(world, camera, 0.2);
        expect(world.kick).toBeLessThan(kicked);
        const amounts = [1, 2, 3, 4].map((lines) => {
            const other = makeWorld('Minimal');
            other.world.onClear({ lines });
            const { amount } = other.world.pendingKick;
            other.world.dispose();
            return amount;
        });
        for (let i = 1; i < amounts.length; i++) expect(amounts[i]).toBeGreaterThan(amounts[i - 1]);
        world.dispose();
    });

    it('charges and lifts with the combo, and comes back down when the chain breaks', () => {
        const { camera, world } = makeWorld('Low');
        expect([world.power, world.lift]).toEqual([0, 0]);
        world.onCombo(4);
        expect(world.getState().combo).toBe(4);
        let previous = [0, 0];
        let wrong = 0;
        run(world, camera, 6, 360, () => {
            // Rising all the way, never past where it is going.
            if (world.power < previous[0] || world.power > powerForCombo(4) + 1e-12) wrong += 1;
            if (world.lift < previous[1] || world.lift > 4 + 1e-12) wrong += 1;
            previous = [world.power, world.lift];
        });
        expect(wrong).toBe(0);
        expect(world.power).toBeCloseTo(powerForCombo(4), 5);
        expect(world.lift).toBeCloseTo(4, 5);
        expect(world.u.power.value).toBe(world.power);
        expect(world.u.lift.value).toBe(world.lift);
        // A chain beyond the lift's reach charges on; the lift stops at its top.
        world.onCombo(LIFT_MAX + 7);
        run(world, camera, 8);
        expect(world.lift).toBeCloseTo(LIFT_MAX, 5);
        expect(world.lift).toBeLessThanOrEqual(LIFT_MAX);
        expect(world.power).toBeCloseTo(powerForCombo(LIFT_MAX + 7), 5);
        expect(world.power).toBeLessThanOrEqual(1);
        // The chain breaks: both come down, all the way.
        world.onCombo(0);
        previous = [world.power, world.lift];
        run(world, camera, 0.5, 30, () => {
            if (world.power > previous[0] || world.lift > previous[1]) wrong += 1;
            previous = [world.power, world.lift];
        });
        expect(wrong).toBe(0);
        expect(world.power).toBeGreaterThan(0);
        expect(world.lift).toBeGreaterThan(0);
        run(world, camera, 16);
        expect(world.power).toBeLessThan(1e-4);
        expect(world.lift).toBeLessThan(1e-4);
        // Nonsense is no chain; a fraction is rounded.
        for (const [given, taken] of [[NaN, 0], [-3, 0], [undefined, 0], [2.6, 3], ['5', 5]]) {
            world.onCombo(given);
            expect(world.combo, String(given)).toBe(taken);
        }
        world.dispose();
    });

    it('lifts the crystals off their rest, the pairs nearest the viewer first', () => {
        const rest = makeWorld('Low');
        const some = makeWorld('Low');
        const full = makeWorld('Low');
        some.world.onCombo(2);
        full.world.onCombo(LIFT_MAX);
        // The same clock in all three: only the chain differs.
        for (const { world, camera } of [rest, some, full]) run(world, camera, 8);
        const height = (view, index) => view.world.crystals.positionOf(index)[1];
        const rise = (view, index) => height(view, index) - height(rest, index);
        /** How many steps along a line (pair 0, pair 1, ...) have risen, and whether they are the first ones. */
        const risen = (view, kind) => {
            const steps = [];
            for (const index of gemsOf(view.world, kind)) {
                const { index: step } = view.world.crystals.gems[index];
                steps[step] = Math.max(steps[step] ?? 0, rise(view, index));
            }
            const up = steps.map((lifted) => lifted > 1e-6);
            // Nearest first: once a step is still on its plinth, so is every step beyond it.
            const nearestFirst = up.every((flag, step) => flag || !up.slice(step).some(Boolean));
            return { count: up.filter(Boolean).length, nearestFirst, steps };
        };
        for (const kind of [GEM.shard, GEM.dial]) {
            const low = risen(some, kind);
            const high = risen(full, kind);
            // A short chain lifts the first of them and leaves the far ones on their plinths...
            expect(low.count, `kind ${kind}`).toBeGreaterThan(0);
            expect(low.count, `kind ${kind}`).toBeLessThan(low.steps.length);
            expect(low.steps[0], `kind ${kind}`).toBeGreaterThan(0);
            expect(low.steps[low.steps.length - 1], `kind ${kind}`).toBe(0);
            expect(low.nearestFirst, `kind ${kind}`).toBe(true);
            // ...a long one lifts more of them, the same way round.
            expect(high.count, `kind ${kind}`).toBeGreaterThan(low.count);
            expect(high.nearestFirst, `kind ${kind}`).toBe(true);
            expect(high.steps[0], `kind ${kind}`).toBeGreaterThanOrEqual(low.steps[0] - 1e-9);
        }
        // Both crystals of a pair leave the deck together.
        const shards = gemsOf(some.world, GEM.shard);
        for (let pair = 0; pair < shards.length / 2; pair++) {
            expect(rise(some, shards[pair * 2]) > 1e-6, `pair ${pair}`).toBe(rise(some, shards[pair * 2 + 1]) > 1e-6);
        }
        // The two great crystals rise with the chain too.
        for (const kind of [GEM.apex, GEM.halcyon]) {
            const [index] = gemsOf(full.world, kind);
            expect(rise(full, index)).toBeGreaterThan(rise(some, index));
            expect(rise(some, index)).toBeGreaterThan(0);
        }
        // What the shaders draw is what the world says.
        const drawn = full.world.crystals.geometry.getAttribute('aPos').array;
        for (let i = 0; i < full.world.crystals.count; i++) {
            const at = full.world.crystals.positionOf(i);
            for (let k = 0; k < 3; k++) expect(drawn[i * 4 + k]).toBeCloseTo(at[k], 3);
        }
        for (const { world } of [rest, some, full]) world.dispose();
    });

    it('turns a lifting crystal no faster late in a session than at its start', () => {
        // How far the first pair of shards and the first stone's crystal turn in the frame a chain
        // starts to lift them, `start` seconds into the session.
        const turn = (start) => {
            const { camera, world } = makeWorld('Minimal');
            world.seek(start);
            settle(world, camera);
            const yaw = world.crystals.geometry.getAttribute('aPos').array;
            const watched = [...gemsOf(world, GEM.shard).slice(0, 2), gemsOf(world, GEM.dial)[0]];
            const before = watched.map((index) => yaw[index * 4 + 3]);
            world.onCombo(3);
            run(world, camera, 1 / 60, 1);
            const turned = watched.map((index, k) => yaw[index * 4 + 3] - before[k]);
            world.dispose();
            return turned;
        };
        const early = turn(10);
        const late = turn(3600);
        // A sixtieth of a second is a sixtieth of a second, an hour in or not.
        early.forEach((step, k) => expect(Math.abs(late[k] - step), `crystal ${k}`).toBeLessThan(0.5));
    });

    it('lets its breath go for a moment when a chain breaks', () => {
        const { camera, world } = makeWorld('Low');
        world.onCombo(3);
        run(world, camera, 2);
        expect(world.breath).toBe(1);
        world.onCombo(0);
        let low = 1;
        run(world, camera, 0.6, 72, () => {
            low = Math.min(low, world.breath);
        });
        expect(low).toBeLessThan(1 - 1e-3);
        expect(low).toBeGreaterThan(0);
        expect(world.u.breath.value).toBe(world.breath);
        run(world, camera, 6);
        expect(world.breath).toBeCloseTo(1, 5);
        // A single clear is no chain: nothing to let go of.
        world.onCombo(1);
        run(world, camera, 0.5);
        world.onCombo(0);
        low = 1;
        run(world, camera, 0.6, 72, () => {
            low = Math.min(low, world.breath);
        });
        expect(low).toBeCloseTo(1, 5);
        world.dispose();
    });

    it('holds its breath on four lines, then stands the beacons, rings the sky and throws the flock up', () => {
        const flocked = QUALITY_NAMES.find((name) => QUALITY[name].birds > 0);
        const { camera, world } = makeWorld(flocked);
        const scatter = vi.spyOn(world.birds, 'scatter');
        const rest = { ...world.getPostState() };
        const dip = (() => {
            // How far a broken chain lets the breath fall, to compare the hush with.
            const other = makeWorld('Minimal');
            other.world.onCombo(3);
            run(other.world, other.camera, 1);
            other.world.onCombo(0);
            let low = 1;
            run(other.world, other.camera, 0.6, 72, () => {
                low = Math.min(low, other.world.breath);
            });
            other.world.dispose();
            return low;
        })();

        world.onClear({ lines: 4 });
        const birth = world.time + HUSH_HOLD;
        expect(world.hushUntil).toBe(birth);
        expect(world.u.clearA[0].value.toArray().slice(0, 2)).toEqual([birth, 4]);
        expect(world.u.clearA[0].value.w).toBe(1);
        expect(world.u.beacon.value.x).toBe(birth);
        expect(world.u.beacon.value.y).toBeGreaterThan(0);
        expect(world.u.shock.value.x).toBe(birth);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        expect(scatter).toHaveBeenCalledOnce();
        expect(scatter).toHaveBeenCalledWith(birth);
        expect(world.counts).toMatchObject({ clears: 1, quads: 1 });
        expect(world.surge).toBeGreaterThan(0);
        expect(hueGap(world.u.clearC[0].value.toArray(), SUNFIRE)).toBeLessThan(1e-6);

        // The hush: every light sinks, fast and far, and the sun's shafts with them.
        let previous = world.breath;
        let rose = 0;
        let bright = 0;
        runTo(world, camera, birth - 0.005, () => {
            if (world.breath > previous) rose += 1;
            if (world.getPostState().shafts >= rest.shafts) bright += 1;
            previous = world.breath;
        });
        expect(rose).toBe(0);
        expect(bright).toBe(0);
        expect(world.breath).toBeLessThan(0.5);
        expect(world.breath).toBeLessThan(dip); // far deeper than a broken chain's sigh
        expect(world.breath).toBeGreaterThan(0);
        expect(world.u.breath.value).toBe(world.breath);
        // Then everything fires: the breath comes back, the shafts blaze past their rest.
        const sunk = world.breath;
        runTo(world, camera, birth + 0.25);
        expect(world.breath).toBeGreaterThan(sunk);
        expect(world.getPostState().shafts).toBeGreaterThan(rest.shafts);
        expect(world.getPostState().bloomBoost).toBeGreaterThan(rest.bloomBoost);
        runTo(world, camera, birth + 2);
        expect(world.breath).toBeCloseTo(1, 5);
        world.dispose();

        // A tier without a flock fires all the same.
        const bare = makeWorld(QUALITY_NAMES.find((name) => QUALITY[name].birds === 0));
        expect(bare.world.birds).toBeNull();
        expect(() => bare.world.onClear({ lines: 4 })).not.toThrow();
        expect(bare.world.counts.quads).toBe(1);
        bare.world.dispose();
    });

    it('surges on four lines and cools, hotter still for a perfect clear', () => {
        const four = makeWorld('Low');
        const perfect = makeWorld('Low');
        const three = makeWorld('Low');
        four.world.onClear({ lines: 4 });
        perfect.world.onClear({ lines: 1, perfect: true });
        three.world.onClear({ lines: 3 });
        expect(three.world.surge).toBe(0);
        expect(three.world.hushUntil).toBeLessThan(three.world.time);
        expect(three.world.u.beacon.value.y).toBe(0);
        expect(four.world.surge).toBeGreaterThan(0);
        expect(perfect.world.surge).toBeGreaterThan(four.world.surge);
        // A perfect clear fires as four lines whatever it cleared, and its beacons stand taller.
        expect(perfect.world.u.clearA[0].value.toArray().slice(0, 2)).toEqual([perfect.world.time + HUSH_HOLD, 4]);
        expect(perfect.world.u.clearA[0].value.w).toBe(1);
        expect(perfect.world.hushUntil).toBe(perfect.world.time + HUSH_HOLD);
        expect(perfect.world.u.beacon.value.y).toBeGreaterThan(four.world.u.beacon.value.y);
        expect(perfect.world.counts.quads).toBe(1);
        expect(hueGap(perfect.world.u.clearC[0].value.toArray(), SUNFIRE)).toBeLessThan(1e-6);
        // The overdrive cools to 1/e in SURGE_COOL seconds, at any frame rate.
        for (const { world, camera } of [four, perfect]) {
            const hot = world.surge;
            run(world, camera, SURGE_COOL / 2, 20);
            run(world, camera, SURGE_COOL / 2, 200);
            expect(world.surge).toBeCloseTo(hot / Math.E, 9);
            expect(world.u.surge.value).toBe(world.surge);
        }
        for (const { world } of [four, perfect, three]) world.dispose();
    });

    it('turns everything that floats on a T-spin, and sends two more rings from the wave\'s heart', () => {
        const spun = makeWorld('Low');
        const plain = makeWorld('Low');
        spun.world.onClear({ lines: 2, tspin: true });
        plain.world.onClear({ lines: 2 });
        expect(plain.world.twist).toBe(0);
        expect(rings(plain.world)).toHaveLength(0);
        expect(spun.world.twist).toBeGreaterThan(0);
        expect(spun.world.stir).toBeGreaterThanOrEqual(plain.world.stir);
        // Two rings from where the wave starts: one now, its echo a moment later.
        const sent = rings(spun.world).sort((a, b) => a.place.z - b.place.z);
        expect(sent).toHaveLength(2);
        const heart = spun.world.u.clearH[0].value;
        for (const ring of sent) {
            expect(ring.place.x).toBe(heart.x);
            expect(ring.place.y).toBe(heart.y);
        }
        expect(sent[0].place.z).toBe(spun.world.time);
        expect(sent[1].place.z).toBeGreaterThan(sent[0].place.z);
        expect(hueGap(sent[0].colour.toArray(), spun.world.u.clearC[0].value.toArray())).toBeLessThan(1e-6);
        // The crystals spin up...
        const from = [spun.world.spin, plain.world.spin];
        for (const { world, camera } of [spun, plain]) run(world, camera, 0.5);
        expect(spun.world.spin - from[0]).toBeGreaterThan(plain.world.spin - from[1]);
        expect(spun.world.u.spin.value).toBe(spun.world.spin);
        // ...and settle.
        run(spun.world, spun.camera, 10);
        expect(spun.world.twist).toBeLessThan(1e-4);
        spun.world.dispose();
        plain.world.dispose();
    });

    it('changes the hour with the level and cycles through its palettes', () => {
        const { camera, world } = makeWorld('Low');
        const names = HALCYON_PALETTES.map((palette) => palette.name);
        const plainKeys = ['zenith', 'rose', 'cloud', 'cloudShade', 'shallow', 'deep', 'stone'];
        const gap = (key, index) => {
            const wanted = HALCYON_PALETTES[index][key];
            return Math.hypot(...world.u[key].value.toArray().map((c, k) => c - wanted[k]));
        };
        for (let level = 1; level <= names.length * 2 + 1; level++) {
            world.levelUp(level, { silent: true });
            expect(world.getState()).toMatchObject({ level, palette: names[(level - 1) % names.length] });
        }
        // Silently: the colours are simply there on the next frame, without ceremony.
        world.levelUp(3, { silent: true });
        settle(world, camera);
        for (const key of plainKeys) expect(gap(key, 2), key).toBeLessThan(1e-12);
        expect(world.stir).toBe(0);
        expect(world.flash).toBe(0);
        expect(world.u.shock.value.y).toBe(0);
        // A level reached in play: a ring over the sky, a flash, and the colours ease across.
        world.levelUp(4);
        expect(world.getState()).toMatchObject({ level: 4, palette: names[3 % names.length] });
        expect(world.stir).toBeGreaterThan(0);
        expect(world.flash).toBeGreaterThan(0);
        expect(world.u.shock.value.x).toBe(world.time);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        settle(world, camera);
        for (const key of plainKeys) expect(gap(key, 2), key).toBeLessThan(1e-12); // not yet moved
        run(world, camera, 0.5);
        const next = 3 % names.length;
        for (const key of plainKeys) {
            const whole = Math.hypot(...HALCYON_PALETTES[next][key].map((c, k) => c - HALCYON_PALETTES[2][key][k]));
            if (whole > 1e-6) {
                // On its way: no longer the old hour, not yet the new one.
                expect(gap(key, 2), key).toBeGreaterThan(whole * 0.05);
                expect(gap(key, next), key).toBeGreaterThan(whole * 0.05);
                expect(gap(key, 2) + gap(key, next), key).toBeCloseTo(whole, 9); // straight across
            }
        }
        run(world, camera, 16);
        for (const key of plainKeys) expect(gap(key, next), key).toBeLessThan(1e-4);
        // Nonsense is level one.
        for (const [given, taken] of [['x', 1], [0, 1], [-4, 1], [NaN, 1], [2.6, 3]]) {
            world.levelUp(given, { silent: true });
            expect(world.level, String(given)).toBe(taken);
        }
        world.dispose();
    });
});

describe('halcyon apex world: time', () => {
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

    it('reaches the same state at 30 and at 240 frames a second', () => {
        const slow = makeWorld('Low');
        const fast = makeWorld('Low');
        script(slow.world, slow.camera, 30);
        script(fast.world, fast.camera, 240);
        const a = slow.world.getState();
        const b = fast.world.getState();
        /** The same to three parts in a hundred (events land on whole frames), or to a hair. */
        const near = (x, y, label) => {
            const allowed = 0.03 * Math.max(Math.abs(x), Math.abs(y)) + 2e-3;
            expect(Math.abs(x - y), label).toBeLessThanOrEqual(allowed);
        };
        expect(a.time).toBeCloseTo(b.time, 9);
        expect(a.counts).toEqual(b.counts);
        expect(a).toMatchObject({
            combo: b.combo, level: b.level, palette: b.palette, arrivals: b.arrivals,
        });
        // Something is still held, so the comparison is not of two empty sanctuaries.
        expect(Math.max(...a.held)).toBeGreaterThan(0);
        for (const key of ['power', 'lift', 'surge', 'stir', 'breath']) near(a[key], b[key], key);
        near(a.held[0], b.held[0], 'held by the Apex');
        near(a.held[1], b.held[1], 'held by the Halcyon');
        // The slow clocks are integrated frame by frame: close, not identical.
        for (const clock of ['cloudDrift', 'spin', 'beadLift']) near(slow.world[clock], fast.world[clock], clock);
        near(a.heart.x, b.heart.x, 'heart x');
        near(a.heart.y, b.heart.y, 'heart y');
        const postA = slow.world.getPostState();
        const postB = fast.world.getPostState();
        for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure']) near(postA[key], postB[key], key);
        for (const key of ['crystal', 'ley', 'zenith', 'sun']) {
            expect(slow.world.u[key].value.distanceTo(fast.world.u[key].value), key).toBeLessThan(5e-3);
        }
        // Event slots hold timestamps: they are identical whatever the frame rate.
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            expect(slow.world.u.clearA[i].value.toArray()).toEqual(fast.world.u.clearA[i].value.toArray());
        }
        expect(slow.world.u.shock.value.toArray()).toEqual(fast.world.u.shock.value.toArray());
        expect(slow.world.u.beacon.value.toArray()).toEqual(fast.world.u.beacon.value.toArray());
        // A ring's place and a wisp's flight depend on the camera's pose that frame: the same to a hair.
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const lockA = slow.world.u.lockA[i].value.toArray();
            const lockB = fast.world.u.lockA[i].value.toArray();
            for (let k = 0; k < 4; k++) expect(lockA[k], `lock slot ${i}[${k}]`).toBeCloseTo(lockB[k], 2);
        }
        for (let i = 0; i < PULSE_SLOTS; i++) {
            const pulseA = slow.world.u.pulseA[i].value.toArray();
            const pulseB = fast.world.u.pulseA[i].value.toArray();
            for (let k = 0; k < 4; k++) expect(pulseA[k], `pulse slot ${i}[${k}]`).toBeCloseTo(pulseB[k], 3);
        }
        slow.world.dispose();
        fast.world.dispose();
    });

    it('replays a frame: seek, then the same steps, gives the same sanctuary whatever came before', () => {
        const { camera, world } = makeWorld('Low');
        // What a frame is made of: the state, the post's inputs, the event slots, what the great
        // crystals hold, every pool's births and live slots, where every crystal is, the slow
        // clocks and the camera.
        const flat = (value) => (value !== null && typeof value === 'object' ? Object.values(value) : value);
        const pool = (part, names) => {
            const live = used(part, names[0]);
            const births = Array.from(part.geometry.getAttribute(names[0]).array).filter((v, i) => i % 4 === 3);
            const data = names.flatMap((name) => {
                const { array } = part.geometry.getAttribute(name);
                return live.flatMap((i) => Array.from(array.slice(i * 4, i * 4 + 4)));
            });
            return [...births, ...data];
        };
        /** Every slot's timing, and the colour of the slots in use (a dormant slot's is never read). */
        const slots = (timing, colour, strength) => world.u[timing].flatMap((slot, i) => [
            ...slot.value.toArray(),
            ...(slot.value.getComponent(strength) > 0 ? world.u[colour][i].value.toArray() : []),
        ]);
        const snapshot = () => [
            ...Object.values(world.getState()).flatMap(flat),
            ...['flash', 'kick', 'shafts', 'bloomBoost', 'exposure'].map((key) => world.getPostState()[key]),
            ...slots('lockA', 'lockC', 3),
            ...slots('clearA', 'clearC', 2),
            ...slots('pulseA', 'pulseC', 2),
            // (each live clear wave's own heart)
            ...world.u.clearA.flatMap((slot, i) => (slot.value.z > 0 ? world.u.clearH[i].value.toArray() : [])),
            ...['shock', 'beacon', 'held', 'heldA', 'heldB', 'sunDir']
                .flatMap((key) => world.u[key].value.toArray()),
            ...['rows', 'frame', 'color'].flatMap((key) => world.beams.uniforms[key].value.toArray()),
            ...pool(world.wisps, ['aFrom', 'aMid', 'aTo', 'aTint']),
            ...pool(world.sparks, ['aBirth', 'aVel', 'aTint']),
            ...world.crystals.geometry.getAttribute('aPos').array,
            ...world.arrivals.flatMap((arrival) => [arrival.time, arrival.line, arrival.amount]),
            world.cloudDrift,
            world.spin,
            world.beadLift,
            world.twist,
            ...camera.matrixWorld.toArray(),
        ];
        script(world, camera, 60);
        const first = snapshot();
        expect(first.length).toBeGreaterThan(1000);
        // Something else entirely in between...
        world.onCombo(9);
        world.onLock({ u: 0.5, hardDrop: true });
        world.onClear({ lines: 3, tspin: true });
        world.levelUp(4);
        world.setReducedMotion(true);
        run(world, camera, 3);
        world.setReducedMotion(false);
        // ...then the capture's recipe again.
        world.seek(10);
        settle(world, camera);
        script(world, camera, 60);
        const again = snapshot();
        expect(again).toHaveLength(first.length);
        let worst = 0;
        let unlike = 0;
        for (let i = 0; i < first.length; i++) {
            if (typeof first[i] === 'number') worst = Math.max(worst, Math.abs(first[i] - again[i]));
            else if (again[i] !== first[i]) unlike += 1;
        }
        expect(unlike).toBe(0);
        expect(worst).toBeLessThan(1e-9);
        world.dispose();
    });

    it('drops every event in flight when it seeks, and puts the slow clocks where the clock says', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1);
        world.onLock({ u: 0.9 });
        run(world, camera, 1.2);
        // Mid-flight: light held, more on its way, a chain lifting the crystals.
        expect(Math.max(...world.held)).toBeGreaterThan(0);
        expect(world.lift).toBeGreaterThan(1);
        world.onLock({ u: 0.2 });
        expect(world.arrivals.length).toBeGreaterThan(0);

        world.seek(40);
        expect(world.time).toBe(40);
        expect(world.getState()).toMatchObject({
            time: 40,
            combo: 0,
            power: 0,
            lift: 0,
            surge: 0,
            stir: 0,
            breath: 1,
            level: 1,
            palette: HALCYON_PALETTES[0].name,
            held: [0, 0],
            arrivals: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, wisps: 0, pulses: 0,
            },
        });
        expect(world.arrivals).toHaveLength(0);
        expect([world.flash, world.kick, world.twist, world.dip]).toEqual([0, 0, 0, 0]);
        expect(world.hushUntil).toBeLessThan(40);
        expect(world.pendingKick.time).toBe(Infinity);
        expect(rings(world)).toHaveLength(0);
        expect(pulses(world)).toHaveLength(0);
        for (let i = 0; i < CLEAR_SLOTS; i++) expect(world.u.clearA[i].value.z).toBe(0);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.u.beacon.value.y).toBe(0);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        expect(used(world.wisps, 'aFrom')).toHaveLength(0);
        expect(used(world.sparks, 'aBirth')).toHaveLength(0);
        // The slow clocks and the crystals stand where they would in a sanctuary that has only
        // ever idled to this moment.
        const idle = makeWorld('High');
        idle.world.seek(40);
        for (const clock of ['cloudDrift', 'spin', 'beadLift']) expect(world[clock], clock).toBe(idle.world[clock]);
        expect(Array.from(world.crystals.geometry.getAttribute('aPos').array))
            .toEqual(Array.from(idle.world.crystals.geometry.getAttribute('aPos').array));
        // The first frame after is the resting one: nothing live, nothing held.
        settle(world, camera);
        expect([world.u.ringsLive.value, world.u.clearLive.value, world.u.pulsesLive.value]).toEqual([0, 0, 0]);
        expect(world.u.held.value.toArray()).toEqual([0, 0, 0, 0]);
        expect(world.getPostState()).toMatchObject({ flash: 0, kick: 0, exposure: 1 });
        // A seek before the start of time is the start of time.
        world.seek(-5);
        expect(world.time).toBe(0);
        world.dispose();
        idle.world.dispose();
    });

    it('starts a new run with the sanctuary at rest and its slow clocks still running', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1.5);
        world.onLock({ u: 0.7 });
        run(world, camera, 1);
        expect(Math.max(...world.held)).toBeGreaterThan(0);
        const {
            time, cloudDrift, spin, beadLift,
        } = world;
        const targets = JSON.stringify(world.targets);
        world.resetSession();
        // The sky keeps its clocks: nothing jumps on screen...
        expect(world.time).toBe(time);
        expect(world.cloudDrift).toBe(cloudDrift);
        expect(world.spin).toBe(spin);
        expect(world.beadLift).toBe(beadLift);
        // ...but the run is forgotten: no chain, no held light, no event in flight.
        expect(world.getState()).toMatchObject({
            combo: 0,
            power: 0,
            lift: 0,
            surge: 0,
            stir: 0,
            breath: 1,
            level: 1,
            palette: HALCYON_PALETTES[0].name,
            held: [0, 0],
            arrivals: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, wisps: 0, pulses: 0,
            },
        });
        expect(rings(world)).toHaveLength(0);
        expect(pulses(world)).toHaveLength(0);
        for (let i = 0; i < CLEAR_SLOTS; i++) expect(world.u.clearA[i].value.z).toBe(0);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.u.beacon.value.y).toBe(0);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        expect(used(world.wisps, 'aFrom')).toHaveLength(0);
        // The board is still where it was and the lines still have their heads.
        expect(world.getState().layoutLive).toBe(true);
        expect(JSON.stringify(world.targets)).toBe(targets);
        world.onLock({ u: 0.2 });
        expect(world.counts).toMatchObject({ locks: 1, wisps: 1, pulses: 1 });
        // The next frame carries on from the same clocks, at their resting pace.
        const idle = makeWorld('High');
        const pace = {};
        for (const clock of ['cloudDrift', 'spin', 'beadLift']) pace[clock] = -idle.world[clock];
        run(idle.world, idle.camera, 1 / 60, 1);
        world.resetSession();
        run(world, camera, 1 / 60, 1);
        for (const [clock, from] of [['cloudDrift', cloudDrift], ['spin', spin], ['beadLift', beadLift]]) {
            expect(world[clock] - from, clock).toBeCloseTo(pace[clock] + idle.world[clock], 9);
            expect(world[clock] - from, clock).toBeGreaterThan(0);
        }
        world.dispose();
        idle.world.dispose();
    });

    it('goes quiet long after the last event: no loop left running, no light left held', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        const live = () => [world.u.ringsLive.value, world.u.clearLive.value, world.u.pulsesLive.value];
        expect(live()).toEqual([0, 0, 0]);
        world.onLock({ u: 0.2, hardDrop: true });
        settle(world, camera);
        expect(live()).toEqual([1, 0, 1]);
        world.onClear({ lines: 3 });
        world.onCombo(5);
        settle(world, camera);
        expect(live()).toEqual([1, 1, 1]);
        run(world, camera, 2);
        world.onLock({ u: 0.9 });
        run(world, camera, 2);
        expect(Math.max(...world.held)).toBeGreaterThan(0);
        world.onCombo(0);
        // Eight times the time a great crystal takes to lose its light to 1/e.
        run(world, camera, HOLD_FADE * 8, 960);
        expect(live()).toEqual([0, 0, 0]);
        expect(Math.max(...world.held)).toBeLessThan(HOLD_MAX * 1e-3);
        expect(world.u.held.value.toArray().slice(0, 2)).toEqual(world.held);
        expect(world.getState()).toMatchObject({ combo: 0, arrivals: 0 });
        for (const key of ['power', 'lift', 'surge', 'stir', 'flash', 'kick', 'twist', 'dip']) {
            expect(world[key], key).toBeLessThan(1e-6);
        }
        expect(world.breath).toBeCloseTo(1, 6);
        expect(world.u.breath.value).toBeCloseTo(1, 6);
        // The post is back at its exact resting look.
        const post = world.getPostState();
        expect(post.flash).toBeLessThan(1e-6);
        expect(post.kick).toBeLessThan(1e-6);
        expect(post.shafts).toBeCloseTo(rest.shafts, 6);
        expect(post.bloomBoost).toBeCloseTo(rest.bloomBoost, 6);
        expect(post.exposure).toBeCloseTo(1, 6);
        world.dispose();
    });
});

describe('halcyon apex world: what the post reads', () => {
    it('hands the post one reused object whose heart follows the sun on screen', () => {
        for (const [width, height] of [[1600, 900], [430, 932]]) {
            const { camera, world } = makeWorld('Minimal', { width, height });
            const post = world.getPostState();
            expect(world.getPostState()).toBe(post);
            expect(post.heart).toBe(world.heart);
            expect(world.getState().heart).toEqual(world.heart);
            for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure']) {
                expect(Number.isFinite(post[key]), key).toBe(true);
            }
            // At rest: no flash, no kick, no extra bloom, the iris open, the sun's shafts on.
            expect(post).toMatchObject({ flash: 0, kick: 0, exposure: 1 });
            expect(post.bloomBoost).toBeCloseTo(0, 12);
            expect(post.shafts).toBeGreaterThan(0);
            // The heart: where the sun stands in the frame the camera is about to draw...
            const sun = world.u.sunDir.value;
            const where = () => onScreen(
                camera,
                camera.position.x + sun.x * 1000,
                camera.position.y + sun.y * 1000,
                camera.position.z + sun.z * 1000,
            );
            expect(post.heart.x).toBeCloseTo(where().x, 9);
            expect(post.heart.y).toBeCloseTo(where().y, 9);
            // ...which is where the composition hangs it, but for the rig's slow drift.
            const comp = compositionFor(width / height);
            expect(post.heart.x).toBeCloseTo(comp.sun.x, 1);
            expect(post.heart.y).toBeCloseTo(comp.sun.y, 1);
            // It keeps following, frame after frame, in the same object.
            const before = { ...post.heart };
            run(world, camera, 4, 240);
            expect(world.getPostState()).toBe(post);
            expect(post.heart).toBe(world.heart);
            expect(post.heart.x).toBeCloseTo(where().x, 9);
            expect(post.heart.y).toBeCloseTo(where().y, 9);
            expect(Math.hypot(post.heart.x - before.x, post.heart.y - before.y)).toBeGreaterThan(0);
            world.dispose();
        }
    });

    it('closes the iris as the sanctuary flares, and drops the sun\'s shafts while it holds its breath', () => {
        const views = {
            one: makeWorld('Low'), four: makeWorld('Low'), perfect: makeWorld('Low'),
        };
        const rest = { ...views.four.world.getPostState() };
        views.one.world.onClear({ lines: 1 });
        views.four.world.onClear({ lines: 4 });
        views.perfect.world.onClear({ lines: 4, perfect: true });
        // In the middle of the hush: the shafts are down for the two that hold their breath.
        for (const { world, camera } of Object.values(views)) run(world, camera, HUSH_HOLD / 2, 6);
        expect(views.four.world.getPostState().shafts).toBeLessThan(rest.shafts);
        expect(views.perfect.world.getPostState().shafts).toBeLessThan(rest.shafts);
        expect(views.one.world.getPostState().shafts).toBeGreaterThan(rest.shafts);
        // Just after everything fires: the more the surge, the further the iris closes.
        for (const { world, camera } of Object.values(views)) run(world, camera, HUSH_HOLD / 2 + 0.05, 12);
        const exposure = (name) => views[name].world.getPostState().exposure;
        expect(exposure('one')).toBeLessThan(1);
        expect(exposure('four')).toBeLessThan(exposure('one'));
        expect(exposure('perfect')).toBeLessThan(exposure('four'));
        expect(exposure('perfect')).toBeGreaterThan(0);
        // A held chain closes it a little too.
        const chained = makeWorld('Low');
        chained.world.onCombo(6);
        run(chained.world, chained.camera, 4);
        expect(chained.world.getPostState().exposure).toBeLessThan(1);
        expect(chained.world.getPostState().shafts).toBeGreaterThan(rest.shafts);
        chained.world.dispose();
        // And it opens again as the surge cools.
        const fired = exposure('four');
        run(views.four.world, views.four.camera, SURGE_COOL, 60);
        const cooling = exposure('four');
        expect(cooling).toBeGreaterThan(fired);
        run(views.four.world, views.four.camera, SURGE_COOL * 8, 480);
        expect(exposure('four')).toBeGreaterThan(cooling);
        expect(exposure('four')).toBeCloseTo(1, 3);
        for (const { world } of Object.values(views)) world.dispose();
    });
});

describe('halcyon apex effects: closed forms', () => {
    it('flies a wisp along an arc from the board to the stone', () => {
        const from = [0, 2, -6];
        const mid = [-10, 14, -20];
        const to = [-30, 5, -50];
        expect(wispPoint(from, mid, to, 0)).toEqual(from);
        expect(wispPoint(from, mid, to, 1)).toEqual(to);
        const half = wispPoint(from, mid, to, 0.5);
        for (let k = 0; k < 3; k++) expect(half[k]).toBeCloseTo(from[k] * 0.25 + mid[k] * 0.5 + to[k] * 0.25, 9);
        // It bows upward on the way.
        expect(half[1]).toBeGreaterThan(Math.max(from[1], to[1]));
        const out = [0, 0, 0];
        expect(wispPoint(from, mid, to, 0.3, out)).toBe(out);
    });

    it('throws a spark up, lets it fall and settles it on the water', () => {
        expect(sparkHeight(4, 3, 0)).toBe(4);
        expect(sparkHeight(4, 3, 0.01)).toBeGreaterThan(4);
        // Up, over the top once, and down: never up again.
        const heights = [];
        for (let tau = 0; tau <= 12; tau += 0.05) heights.push(sparkHeight(4, 3, tau));
        const top = heights.indexOf(Math.max(...heights));
        expect(top).toBeGreaterThan(0);
        for (let i = 1; i < heights.length; i++) {
            if (i <= top) expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
            else expect(heights[i]).toBeLessThanOrEqual(heights[i - 1]);
            expect(heights[i]).toBeGreaterThan(0); // never under the surface
        }
        // It comes to rest just over the water and stays there.
        const settled = sparkHeight(4, 3, 1000);
        expect(settled).toBeLessThan(4);
        expect(sparkHeight(4, 3, 2000)).toBe(settled);
        // A spark thrown straight down settles at once, at the same height.
        expect(sparkHeight(0, -5, 0.5)).toBe(settled);
        // Thrown harder, it goes higher.
        expect(sparkHeight(4, 6, 0.3)).toBeGreaterThan(sparkHeight(4, 3, 0.3));
    });

    it('grows a lock ring fast, then settles it inside its reach', () => {
        expect(ringRadius(-1)).toBe(0);
        expect(ringRadius(0)).toBe(0);
        expect(ringRadius(RING_TAU)).toBeCloseTo(RING_REACH * (1 - 1 / Math.E), 9);
        let previous = 0;
        for (let age = 0.05; age < RING_TAU * 12; age += 0.05) {
            const radius = ringRadius(age);
            expect(radius).toBeGreaterThan(previous);
            expect(radius).toBeLessThan(RING_REACH);
            previous = radius;
        }
        // Faster at first than later.
        expect(ringRadius(RING_TAU) - ringRadius(0)).toBeGreaterThan(ringRadius(RING_TAU * 2) - ringRadius(RING_TAU));
        expect(ringRadius(RING_TAU * 12)).toBeGreaterThan(RING_REACH * 0.99);
    });

    it('runs a clear wave out through the sanctuary and knows when it passes a point', () => {
        expect(clearRadius(-1)).toBe(0);
        expect(clearRadius(0)).toBe(0);
        expect(clearRadius(CLEAR_TRAVEL)).toBeCloseTo(CLEAR_REACH, 9);
        expect(clearRadius(CLEAR_TRAVEL * 3)).toBeCloseTo(CLEAR_REACH, 9);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            const radius = clearRadius((CLEAR_TRAVEL * i) / 20);
            expect(radius).toBeGreaterThan(previous);
            previous = radius;
        }
        // The shape says whether it gathers speed (> 1) or spends it: half the time covers that
        // much less, or more, than half the way.
        const halfway = clearRadius(CLEAR_TRAVEL * 0.5) / CLEAR_REACH;
        expect(halfway).toBeCloseTo(0.5 ** CLEAR_SHAPE, 9);
        // The pass time is the wave's inverse: a crystal lets go exactly as the front arrives.
        for (const share of [0.01, 0.1, 0.33, 0.5, 0.9, 1]) {
            expect(clearRadius(clearPassTime(CLEAR_REACH * share))).toBeCloseTo(CLEAR_REACH * share, 6);
        }
        for (const age of [0.1, 0.5, 0.9].map((k) => k * CLEAR_TRAVEL)) {
            expect(clearPassTime(clearRadius(age))).toBeCloseTo(age, 9);
        }
        expect(clearPassTime(0)).toBe(0);
        expect(clearPassTime(CLEAR_REACH * 10)).toBe(CLEAR_TRAVEL);
        // Further out is later.
        expect(clearPassTime(CLEAR_REACH * 0.6)).toBeGreaterThan(clearPassTime(CLEAR_REACH * 0.3));
    });

    it('times a ley pulse by how far along its line a point lies', () => {
        expect(pulseArrival(0)).toBe(0);
        expect(pulseArrival(-40)).toBe(0); // the lead-in before the line's head
        expect(pulseArrival(PULSE_SPEED)).toBe(1);
        expect(pulseArrival(LEY_A.length)).toBeCloseTo(LEY_A.length / PULSE_SPEED, 12);
        expect(pulseArrival(LEY_A.foot + LEY_A.stair)).toBeGreaterThan(pulseArrival(LEY_A.foot));
        // The dial's line is the shorter: its great crystal is reached sooner.
        expect(pulseArrival(LEY_B.length)).toBeLessThan(pulseArrival(LEY_A.length));
    });

    it('wakes the beads with the chain, from none to all of them', () => {
        expect(beadShare(0)).toBe(0);
        expect(beadShare(-3)).toBe(0);
        expect(beadShare(LIFT_MAX)).toBe(1);
        expect(beadShare(LIFT_MAX * 4)).toBe(1);
        let previous = 0;
        for (let lift = 0; lift <= LIFT_MAX; lift += LIFT_MAX / 40) {
            const share = beadShare(lift);
            expect(share).toBeGreaterThanOrEqual(previous);
            expect(share).toBeGreaterThanOrEqual(0);
            expect(share).toBeLessThanOrEqual(1);
            previous = share;
        }
        // Part of the way up the chain, part of them are awake.
        expect(beadShare(LIFT_MAX / 2)).toBeGreaterThan(0);
        expect(beadShare(LIFT_MAX / 2)).toBeLessThan(1);
    });

    it('charges with the combo and never past full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-2)).toBe(0);
        expect(powerForCombo(1)).toBeGreaterThan(0);
        let previous = 0;
        for (let combo = 1; combo <= 40; combo++) {
            expect(powerForCombo(combo)).toBeGreaterThan(previous);
            expect(powerForCombo(combo)).toBeLessThanOrEqual(1);
            previous = powerForCombo(combo);
        }
        expect(powerForCombo(500)).toBeLessThanOrEqual(1);
    });
});
