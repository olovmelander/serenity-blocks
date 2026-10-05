import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    LUNARA_PARTS, LunaraWorld, METEOR_BEAT, ORBIT_RATE, ORBIT_START, REST_RIG, SURGE_COOL, fovForAspect,
} from '../../src/themes/lunara/lunara-world.js';
import {
    CLEAR_SLOTS, CLEAR_TRAVEL, DEG, HUSH_HOLD, LOCK_SLOTS, LUNARA_PALETTES, MOONFIRE, STORE_HOLD, STORE_MAX,
    WISP_FLIGHT, WISP_SLOTS, WISP_TAIL, celestialAnchors, pieceColor, powerForCombo,
} from '../../src/themes/lunara/lunara-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/lunara/lunara-quality.js';
import { MAX_CRYSTALS, MAX_FLORA } from '../../src/themes/lunara/lunara-layout.js';
import { cardUnion, fallbackLayout } from '../../src/themes/lunara/lunara-composition.js';
import { MAX_RINGS } from '../../src/themes/lunara/lunara-sky.js';
import { MOON_DISTANCE } from '../../src/themes/lunara/lunara-moons.js';
import { shardHeight, wispPoint } from '../../src/themes/lunara/lunara-fx.js';

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, capture = true,
} = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new LunaraWorld({ scene, quality, capture }).build();
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

/**
 * A pool's per-instance array. The spires keep theirs CPU-side (`part.state`): their GPU copy is
 * interleaved, so the attribute's own array has another layout.
 */
function instanced(part, name) {
    const array = part.state?.[name] ?? part.geometry.getAttribute(name).array;
    return { array, count: part.geometry.getAttribute(name).count };
}

/** Slots of a pool whose timestamp (component 3 of `name`) says they have been used. */
function used(part, name) {
    const attribute = instanced(part, name);
    const out = [];
    for (let i = 0; i < attribute.count; i++) if (attribute.array[i * 4 + 3] > -50) out.push(i);
    return out;
}

/** When the wisps now in flight reach their spires (the latest arrival). */
function lastArrival(world) {
    const pulse = instanced(world.crystals, 'aPulse');
    return Math.max(...used(world.crystals, 'aPulse').map((i) => pulse.array[i * 4 + 3]));
}

/**
 * The ring a lock at `time` left on the flats: the slot (and its colour) born at that instant.
 * A lock may write more slots than this one, so slots are found by their birth, never by index.
 */
function ringBornAt(world, time, tolerance = 0) {
    const index = world.u.lockA.findIndex((slot) => Math.abs(slot.value.z - time) <= tolerance && slot.value.w > 0);
    return index < 0 ? null : { place: world.u.lockA[index].value, colour: world.u.lockC[index].value };
}

/** Where a crystal is drawn across the valley: upright frames squeeze the spires toward the middle. */
function drawnX(world, index) {
    return world.plan.crystals[index].x * world.squeeze;
}

/** Where a crystal's tip stands on screen (fraction of the width) from the rest camera. */
function tipScreenX(world, index) {
    const crystal = world.plan.crystals[index];
    const x = drawnX(world, index) + (crystal.tip[0] - crystal.x);
    return new THREE.Vector3(x, crystal.tip[1], crystal.tip[2]).project(world.restCamera()).x * 0.5 + 0.5;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('lunara world: build', () => {
    it('builds every tier from node materials only, with the parts its tier pays for', () => {
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
                expect(material.fog, material.name).toBe(false); // the atmosphere is in every material
            }
            // The whole picture and every event, on every tier.
            for (const part of [
                'sky', 'moon', 'companion', 'meteors', 'ranges', 'banks', 'water', 'crystals', 'glints', 'pillars',
                'shards', 'wisps', 'beams',
            ]) {
                expect(world.parts[part], `${quality}.${part}`).toBeTruthy();
            }
            // Every part answers to a name the capture flag can address.
            for (const name of Object.keys(world.parts)) expect(LUNARA_PARTS, name).toContain(name);
            expect(Boolean(world.reflection), `${quality} mirror`).toBe(tier.reflection > 0);
            expect(Boolean(world.parts.flowers), `${quality} flowers`).toBe(tier.flowers > 0);
            expect(Boolean(world.parts.motes), `${quality} motes`).toBe(tier.motes > 0);
            expect(world.crystals.count).toBe(Math.min(tier.crystals, MAX_CRYSTALS));
            expect(world.parts.crystals.geometry.instanceCount).toBe(world.crystals.count);
            expect(world.shards.count).toBe(tier.shards);
            expect(world.meteors.count).toBe(tier.meteors);
            expect(world.getState()).toMatchObject({
                quality,
                crystals: world.crystals.count,
                flowers: Math.min(tier.flowers, MAX_FLORA),
                motes: tier.motes,
                shards: tier.shards,
                reflection: tier.reflection,
            });
            // The spires either side of the card are there to be struck.
            expect(world.targets.left.length).toBeGreaterThan(0);
            expect(world.targets.right.length).toBeGreaterThan(0);
            // Wisps and the row beams are for the camera only: the flats' mirror skips layer 1.
            expect(world.parts.wisps.mesh.layers.mask).toBe(2);
            expect(world.parts.beams.mesh.layers.mask).toBe(2);
            expect(world.parts.crystals.mesh.layers.mask).toBe(1);
            expect(world.parts.sky.mesh.layers.mask).toBe(1);
            world.dispose();
        }
    });

    it('lets the camera see the wisps and the row beams and keeps them out of the mirror', () => {
        const { camera, world } = makeWorld('High');
        expect(camera.layers.test(world.parts.wisps.mesh.layers)).toBe(true);
        expect(camera.layers.test(world.parts.beams.mesh.layers)).toBe(true);
        const mirror = world.reflection.reflector.getVirtualCamera(camera);
        expect(mirror.layers.test(world.parts.wisps.mesh.layers)).toBe(false);
        expect(mirror.layers.test(world.parts.beams.mesh.layers)).toBe(false);
        expect(mirror.layers.test(world.parts.crystals.mesh.layers)).toBe(true);
        expect(mirror.layers.test(world.parts.moon.mesh.layers)).toBe(true);
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

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['sky', 'water', 'no-such-part']);
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'sky' || name === 'water');
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
        expect(world.textures.length).toBeGreaterThanOrEqual(3); // noise, heights, the moons' placeholder
        world.textures.forEach((texture) => disposals.push(vi.spyOn(texture, 'dispose')));
        disposals.push(vi.spyOn(world.reflection, 'dispose'));
        world.dispose();
        expect(scene.children).toHaveLength(0);
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(world.parts).toEqual({});
        expect(world.textures).toEqual([]);
        expect(world.reflection).toBeNull();
        expect(() => world.dispose()).not.toThrow();
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
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
        expect(world.getState()).toMatchObject({ held: 0, crystals: 0 });
    });
});

describe('lunara world: the moon map', () => {
    it('stands the moons smooth until the map arrives, then fades their faces in', async () => {
        const map = new THREE.Texture();
        vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, onLoad) => onLoad(map));
        const { camera, world } = makeWorld('Low', { capture: false });
        const placeholder = world.moonMap.value;
        expect(world.getState().mapReady).toBe(false);
        expect(world.mapFade.value).toBe(0);
        await expect(world.loadTextures()).resolves.toBe(true);
        expect(world.getState().mapReady).toBe(true);
        expect(world.moonMap.value).toBe(map);
        expect(world.moonMap.value).not.toBe(placeholder);
        expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
        expect(world.textures).toContain(map); // the world owns it now and disposes it
        let previous = world.mapFade.value;
        for (let i = 0; i < 600 && world.mapFade.value < 1; i++) {
            run(world, camera, 0.1);
            expect(world.mapFade.value).toBeGreaterThan(previous);
            previous = world.mapFade.value;
        }
        expect(world.mapFade.value).toBe(1);
        world.dispose();
    });

    it('shows the map at once in a capture', async () => {
        vi.spyOn(THREE.TextureLoader.prototype, 'load')
            .mockImplementation((url, onLoad) => onLoad(new THREE.Texture()));
        const { camera, world } = makeWorld('Low');
        await world.loadTextures();
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.mapFade.value).toBe(1);
        world.dispose();
    });

    it('keeps the moons smooth when the map fails, or cannot be decoded here at all', async () => {
        const { world } = makeWorld('Low');
        // No image decoding in this host: the loader throws.
        await expect(world.loadTextures()).resolves.toBe(false);
        vi.spyOn(THREE.TextureLoader.prototype, 'load')
            .mockImplementation((url, onLoad, onProgress, onError) => onError(new Error('404')));
        await expect(world.loadTextures()).resolves.toBe(false);
        expect(world.getState().mapReady).toBe(false);
        expect(world.mapFade.value).toBe(0);
        world.dispose();
    });

    it('throws away a map that arrives after the world has gone', async () => {
        let arrive = null;
        vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, onLoad) => {
            arrive = onLoad;
        });
        const { world } = makeWorld('Low');
        const pending = world.loadTextures();
        world.dispose();
        const late = new THREE.Texture();
        const dispose = vi.spyOn(late, 'dispose');
        arrive(late);
        await expect(pending).resolves.toBe(false);
        expect(dispose).toHaveBeenCalledOnce();
        expect(world.mapReady).toBe(false);
    });
});

describe('lunara world: camera and sky', () => {
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

    it('stands in the flats looking down the valley and a little up at the sky', () => {
        const { camera, world } = makeWorld('Minimal');
        expect(Math.abs(camera.position.x)).toBeLessThan(1.5);
        expect(Math.abs(camera.position.y - REST_RIG.height)).toBeLessThan(0.3);
        expect(camera.position.z).toBe(0);
        expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 3);
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        expect(forward.z).toBeLessThan(-0.95);
        expect(forward.y).toBeGreaterThan(0); // looking up
        expect(forward.y).toBeLessThan(0.3);
        world.dispose();
    });

    it('hangs the great moon where the composition wants it, in a wide frame and on an upright phone', () => {
        for (const [width, height] of [[1600, 900], [430, 932]]) {
            const { world } = makeWorld('Minimal', { width, height });
            const anchors = celestialAnchors(width / height);
            // The camera's slow drift moves it a hair; the composition holds.
            expect(world.heart.x).toBeCloseTo(anchors.moon.x, 1);
            expect(world.heart.y).toBeCloseTo(anchors.moon.y, 1);
            // The post's shafts stream from the same point.
            expect(world.getPostState().heart).toBe(world.heart);
            expect(world.getState().heart).toEqual(world.heart);
            expect(world.u.moonDir.value.length()).toBeCloseTo(1, 9);
            expect(world.u.moonDir.value.y).toBeGreaterThan(0);
            expect(world.u.planetDir.value.length()).toBeCloseTo(1, 9);
            // The moon's mesh hangs on its shell along that direction, as large as the sky says.
            const moon = world.parts.moon.mesh;
            const eye = new THREE.Vector3(0, REST_RIG.height, 0);
            expect(moon.position.distanceTo(eye)).toBeCloseTo(MOON_DISTANCE, 3);
            expect(moon.scale.x).toBeCloseTo(MOON_DISTANCE * Math.sin(world.u.discs.value.x), 6);
            world.dispose();
        }
    });

    it('recomposes the sky when the frame changes shape', () => {
        const { world } = makeWorld('Minimal');
        const wide = world.u.moonDir.value.clone();
        const viewport = world.u.viewport.value;
        world.setViewport(430, 932, 430 / 932);
        expect(viewport.toArray()).toEqual([430, 932]);
        expect(world.u.moonDir.value.distanceTo(wide)).toBeGreaterThan(0.01);
        // A degenerate buffer or aspect is ignored.
        world.setViewport(0, 0, NaN);
        expect(viewport.toArray()).toEqual([430, 932]);
        expect(world.aspect).toBeCloseTo(430 / 932, 9);
        world.dispose();
    });

    it('squeezes the spires toward the middle of an upright frame, and aims at them where they are drawn', () => {
        const wide = makeWorld('Low');
        expect(wide.world.squeeze).toBe(1);
        expect(wide.world.u.squeeze.value).toBe(1);
        wide.world.dispose();

        const { world } = makeWorld('Low', { width: 430, height: 932 });
        expect(world.squeeze).toBeLessThan(1);
        expect(world.squeeze).toBeGreaterThanOrEqual(0.5);
        expect(world.u.squeeze.value).toBe(world.squeeze);
        // The spires that frame the board come into view on both sides of the card.
        const hero = (index) => world.plan.crystals[index].hero;
        const card = cardUnion(world.layout);
        expect(world.targets.left.some(hero)).toBe(true);
        expect(world.targets.right.some(hero)).toBe(true);
        for (const index of world.targets.left) expect(tipScreenX(world, index)).toBeLessThan(card.x0);
        for (const index of world.targets.right) expect(tipScreenX(world, index)).toBeGreaterThan(card.x1);
        // A wisp flies to where its spire is drawn, not to where the plan lists it.
        world.onLock({ u: 0.1, rows: [14], color: '#a8e0ff' });
        const [struck] = used(world.crystals, 'aPulse');
        const crystal = world.plan.crystals[struck];
        const to = world.wisps.geometry.getAttribute('aTo').array;
        const along = (to[1] - crystal.y) / crystal.axis[1];
        expect(to[0] - crystal.axis[0] * along).toBeCloseTo(drawnX(world, struck), 3);
        expect(to[2] - crystal.axis[2] * along).toBeCloseTo(crystal.z, 3);
        // And a clear's wave reaches the spires in the order they stand in on screen.
        world.onClear({ lines: 1 });
        const heart = world.u.heart.value;
        const pulse = instanced(world.crystals, 'aPulse').array;
        const passes = [];
        for (let i = 0; i < world.crystals.count; i++) {
            passes.push([Math.hypot(drawnX(world, i) - heart.x, world.plan.crystals[i].z - heart.y), pulse[i * 4 + 3]]);
        }
        passes.sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < passes.length; i++) expect(passes[i][1]).toBeGreaterThanOrEqual(passes[i - 1][1] - 1e-5);
        world.dispose();
    });

    it('finds the flats under a screen point and falls back above the horizon', () => {
        const { camera, world } = makeWorld('Minimal');
        const strike = world.screenToFlats(0.5, 0.95, { x: 0, z: 0 });
        expect(strike.z).toBeLessThan(-3);
        expect(strike.z).toBeGreaterThan(-25);
        expect(Math.abs(strike.x - camera.position.x)).toBeLessThan(1);
        // Left of centre on screen is left in the valley.
        expect(world.screenToFlats(0.2, 0.9, { x: 0, z: 0 }).x).toBeLessThan(-1);
        // A point in the sky has no water under it: so many metres ahead instead.
        const sky = world.screenToFlats(0.5, 0.1, { x: 0, z: 0 }, 30);
        expect(Math.hypot(sky.x - camera.position.x, sky.z - camera.position.z)).toBeCloseTo(30, 6);
        expect(sky.z).toBeLessThan(0);
        // A point in the air in front of the card.
        const [x, y, z] = world.screenToWorld(0.5, 0.5, 6.5, [0, 0, 0]);
        expect(camera.position.distanceTo(new THREE.Vector3(x, y, z))).toBeCloseTo(6.5, 6);
        expect(z).toBeLessThan(-6);
        world.dispose();
    });

    it('circles the companion round the great moon, in front below and behind above', () => {
        const { camera, world } = makeWorld('Minimal');
        // On the world clock until gameplay bends it.
        expect(world.orbit).toBeCloseTo(ORBIT_START + 10 * ORBIT_RATE, 12);
        run(world, camera, 2);
        expect(world.orbit).toBeCloseTo(ORBIT_START + 12 * ORBIT_RATE, 9);
        expect(world.getState().orbit).toBe(world.orbit);

        const eye = new THREE.Vector3(0, REST_RIG.height, 0);
        const moonDir = world.u.moonDir.value;
        const moonRadius = world.u.discs.value.x;
        const companion = world.parts.companion.mesh;
        const sizes = [];
        for (let step = 0; step < 16; step++) {
            world.orbit = (step / 16) * Math.PI * 2 + 0.1;
            world.placeCompanion();
            const dir = world.u.companionDir.value;
            expect(dir.length()).toBeCloseTo(1, 9);
            // It never strays far from the moon it circles.
            expect(dir.angleTo(moonDir)).toBeLessThan(moonRadius * 4);
            const distance = companion.position.distanceTo(eye);
            if (Math.sin(world.orbit) < 0) expect(distance).toBeLessThan(MOON_DISTANCE);
            else expect(distance).toBeGreaterThan(MOON_DISTANCE);
            // The mesh stands along the direction the sky's materials are told.
            expect(companion.position.clone().sub(eye).normalize().distanceTo(dir)).toBeLessThan(1e-6);
            sizes.push(companion.scale.x / distance);
        }
        // Nearer or farther, it keeps its size in the sky, smaller than the great moon.
        for (const size of sizes) {
            expect(size).toBeCloseTo(sizes[0], 9);
            expect(size).toBeLessThan(Math.sin(moonRadius));
        }
        world.dispose();
    });

    it('leans the view with the pointer', () => {
        const { camera, world } = makeWorld('Minimal');
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 0, pointerY: 0,
        });
        const rest = camera.position.clone();
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 1, pointerY: 0,
        });
        expect(camera.position.x).toBeGreaterThan(rest.x + 0.1);
        world.updateCamera(camera, {
            time: 10, delta: 0, pointerX: 0, pointerY: 1,
        });
        expect(camera.position.y).toBeLessThan(rest.y);
        world.dispose();
    });

    it('keeps the camera still under reduced motion, and keeps the feedback', () => {
        const { camera, world } = makeWorld('Low');
        world.setReducedMotion(true);
        run(world, camera, 3);
        const still = () => {
            expect(camera.position.toArray()).toEqual([0, REST_RIG.height, 0]);
            expect(camera.up.toArray()).toEqual([0, 1, 0]);
            expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 9);
        };
        still();
        const pose = camera.quaternion.clone();
        // No sway, no pointer lean, no impact punch.
        world.onLock({ u: 0.5, hardDrop: true, color: '#ffa8d0' });
        world.onClear({ lines: 4 });
        world.onCombo(8);
        const { orbit } = world;
        for (let i = 0; i < 120; i++) {
            const sim = {
                time: world.time + 1 / 60, delta: 1 / 60, pointerX: 1, pointerY: -1,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            still();
            expect(camera.quaternion.angleTo(pose)).toBeLessThan(1e-9);
        }
        // The chain does not whirl the companion round.
        expect(world.orbit - orbit).toBeCloseTo(2 * ORBIT_RATE, 9);
        // Feedback stays: the ring, the wisp and the light it leaves, the wave, the charge.
        expect(world.u.lockA.some((slot) => slot.value.w > 0)).toBe(true);
        expect(world.counts.wisps).toBeGreaterThan(0);
        expect(world.u.clearA[0].value.z).toBeGreaterThan(0);
        expect(world.power).toBeGreaterThan(0.5);
        expect(world.counts.quads).toBe(1);
        world.dispose();

        // The sky's ring across a four-line clear is gentler, and the curtains drift slower.
        const calm = makeWorld('Low');
        const lively = makeWorld('Low');
        calm.world.setReducedMotion(true);
        calm.world.onClear({ lines: 4 });
        lively.world.onClear({ lines: 4 });
        expect(calm.world.u.shock.value.y).toBeGreaterThan(0);
        expect(calm.world.u.shock.value.y).toBeLessThan(lively.world.u.shock.value.y);
        const drift = [calm.world.auroraDrift, lively.world.auroraDrift];
        run(calm.world, calm.camera, 1);
        run(lively.world, lively.camera, 1);
        expect(calm.world.auroraDrift - drift[0]).toBeGreaterThan(0);
        expect(calm.world.auroraDrift - drift[0]).toBeLessThan(lively.world.auroraDrift - drift[1]);
        calm.world.dispose();
        lively.world.dispose();
    });
});

describe('lunara world: locks', () => {
    it('lands a lock in the flats under the board and rings it in the piece\'s colour', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.u.lockA.every((slot) => slot.value.w === 0)).toBe(true);
        world.onLock({ rows: [19], u: 0.9, color: '#ffa8d0' });
        const right = ringBornAt(world, world.time);
        expect(right).toBeTruthy();
        // A few metres ahead, under the foot of the board.
        expect(right.place.y).toBeLessThan(-3);
        expect(right.place.y).toBeGreaterThan(-25);
        // The ring keeps the piece's hue.
        const rgb = pieceColor('#ffa8d0');
        expect(right.colour.x).toBeGreaterThan(0);
        expect(right.colour.y / right.colour.x).toBeCloseTo(rgb[1] / rgb[0], 6);
        expect(right.colour.z / right.colour.x).toBeCloseTo(rgb[2] / rgb[0], 6);
        const landed = right.place.x;
        // Left of the board's centre lands left of it.
        run(world, camera, 1 / 60, 1);
        world.onLock({ rows: [19], u: 0.05 });
        const left = ringBornAt(world, world.time);
        expect(left.place.x).toBeLessThan(landed);
        // A lock without a colour still rings, in the valley's own.
        expect(left.colour.x).toBeGreaterThan(0);
        expect(left.colour.y).toBeGreaterThan(0);
        expect(left.colour.z).toBeGreaterThan(0);
        expect(world.counts.locks).toBe(2);
        world.dispose();
    });

    it('sends a wisp from the card into a spire on the piece\'s side, which keeps some of its light', () => {
        const { camera, world } = makeWorld('Low');
        const card = cardUnion(world.layout);
        expect(world.getState().held).toBe(0);
        world.onLock({ rows: [12], u: 0.1, color: '#a8ffe8' });
        expect(world.counts.wisps).toBe(1);
        // One spire has been promised the light, a moment from now.
        const struck = used(world.crystals, 'aPulse');
        expect(struck).toHaveLength(1);
        const [index] = struck;
        const arrive = lastArrival(world);
        expect(arrive).toBeGreaterThan(world.time);
        expect(arrive - world.time).toBeLessThanOrEqual(WISP_FLIGHT * 2.5);
        // It is one of the clustered spires, in view on the piece's side of the card.
        expect(index).toBeLessThan(world.plan.clustered);
        expect(tipScreenX(world, index)).toBeLessThan(card.x0);
        expect(tipScreenX(world, index)).toBeGreaterThan(0);

        // The wisp: a head and its tail in one slot, leaving the card's edge now...
        const from = world.wisps.geometry.getAttribute('aFrom');
        const to = world.wisps.geometry.getAttribute('aTo');
        const tint = world.wisps.geometry.getAttribute('aTint');
        expect(used(world.wisps, 'aFrom')).toHaveLength(WISP_TAIL);
        expect(from.array[3]).toBe(world.time);
        expect(to.array[3]).toBeCloseTo(arrive - world.time, 5); // its flight time
        const start = new THREE.Vector3(from.array[0], from.array[1], from.array[2]).project(camera);
        expect(start.x * 0.5 + 0.5).toBeCloseTo(card.x0, 2);
        // ...and flying into the stone, somewhere along its upper half, in the piece's colour.
        const crystal = world.plan.crystals[index];
        const along = (to.array[1] - crystal.y) / (crystal.tip[1] - crystal.y);
        expect(along).toBeGreaterThan(0.5);
        expect(along).toBeLessThan(1);
        const rgb = pieceColor('#a8ffe8');
        expect(tint.array[0]).toBeCloseTo(rgb[0], 6);
        expect(tint.array[1]).toBeCloseTo(rgb[1], 6);
        expect(tint.array[2]).toBeCloseTo(rgb[2], 6);
        // The spire rings too: a smaller ripple leaves its foot as the wisp arrives.
        const landing = ringBornAt(world, world.time);
        const ripple = ringBornAt(world, arrive, 1e-4);
        expect(ripple).toBeTruthy();
        expect(ripple.place.x).toBeCloseTo(drawnX(world, index), 6);
        expect(ripple.place.y).toBeCloseTo(crystal.z, 6);
        expect(ripple.place.w).toBeLessThan(landing.place.w);
        expect(ripple.colour.w).toBeLessThan(landing.colour.w); // it does not reach as far
        expect(ripple.colour.y / ripple.colour.x).toBeCloseTo(rgb[1] / rgb[0], 6);

        // Once it has arrived the spire holds the light, in that colour, and throws dust.
        run(world, camera, arrive - world.time + 0.05);
        expect(world.getState().held).toBeGreaterThan(0);
        expect(world.crystals.heldAt(index, world.time)).toBeCloseTo(world.getState().held, 9);
        const store = instanced(world.crystals, 'aStore');
        expect(store.array[index * 4 + 1]).toBeGreaterThan(store.array[index * 4]); // teal: green over red
        expect(used(world.shards, 'aBirth').length).toBeGreaterThan(0);

        // A piece on the other side goes to a spire on the other side.
        world.onLock({ rows: [12], u: 0.9, color: '#ffd4a8' });
        const other = used(world.crystals, 'aPulse').find((i) => i !== index);
        expect(tipScreenX(world, other)).toBeGreaterThan(card.x1);
        world.dispose();
    });

    it('hits harder and sends more wisps on a hard drop, and kicks the camera', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        soft.world.onLock({ u: 0.3 });
        hard.world.onLock({ u: 0.3, hardDrop: true });
        expect(ringBornAt(hard.world, hard.world.time).place.w)
            .toBeGreaterThan(ringBornAt(soft.world, soft.world.time).place.w);
        expect(hard.world.kick).toBeGreaterThan(soft.world.kick);
        expect(hard.world.flash).toBeGreaterThan(soft.world.flash);
        expect(soft.world.kick).toBeGreaterThan(0);
        // The kick reaches the post and dollies the lens.
        const { fov } = hard.camera;
        run(hard.world, hard.camera, 1 / 60, 1);
        expect(hard.world.getPostState().kick).toBeGreaterThan(0.1);
        expect(hard.camera.fov).toBeLessThan(fov);

        // One wisp for a lock; up to three for a hard drop (the spire and two neighbours).
        for (let i = 1; i < 6; i++) {
            run(soft.world, soft.camera, 0.3);
            run(hard.world, hard.camera, 0.3);
            soft.world.onLock({ u: (i + 0.5) / 6 });
            hard.world.onLock({ u: (i + 0.5) / 6, hardDrop: true });
        }
        expect(soft.world.counts.wisps).toBe(6);
        expect(hard.world.counts.wisps).toBeGreaterThan(6);
        expect(hard.world.counts.wisps).toBeLessThanOrEqual(18);
        // And the valley is left holding more.
        run(soft.world, soft.camera, WISP_FLIGHT * 2.5);
        run(hard.world, hard.camera, WISP_FLIGHT * 2.5);
        expect(hard.world.getState().held).toBeGreaterThan(soft.world.getState().held);
        soft.world.dispose();
        hard.world.dispose();
    });

    it('holds the light a long while and lets it fade', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, hardDrop: true, color: '#ffc050' });
        world.onLock({ u: 0.8, color: '#8090e0' });
        run(world, camera, lastArrival(world) - world.time + 0.05);
        const { held } = world.getState();
        expect(held).toBeGreaterThan(0);
        // Still most of it a tenth of a hold on...
        run(world, camera, STORE_HOLD * 0.1, 60);
        expect(world.getState().held).toBeLessThan(held);
        expect(world.getState().held / held).toBeCloseTo(Math.exp(-0.1), 6);
        // ...and 1/e of it a hold later.
        run(world, camera, STORE_HOLD * 0.9, 120);
        expect(world.getState().held / held).toBeCloseTo(Math.exp(-1), 6);
        run(world, camera, STORE_HOLD * 9, 120);
        expect(world.getState().held).toBeLessThan(held * 1e-3);
        world.dispose();
    });

    it('never lets one spire hold more than its fill', () => {
        const { world } = makeWorld('Low');
        const index = world.targets.left[0];
        for (let i = 0; i < 40; i++) world.crystals.strike(index, [1, 0.6, 0.2], world.time, 1.3);
        expect(world.crystals.heldAt(index, world.time)).toBeCloseTo(STORE_MAX, 5);
        expect(world.getState().held).toBeCloseTo(STORE_MAX, 5);
        // The hue survives the clamp.
        const store = instanced(world.crystals, 'aStore');
        expect(store.array[index * 4 + 1] / store.array[index * 4]).toBeCloseTo(0.6, 5);
        // A spire that is not drawn cannot be struck.
        expect(() => world.crystals.strike(world.crystals.count, [1, 1, 1], world.time)).not.toThrow();
        expect(() => world.crystals.strike(-1, [1, 1, 1], world.time)).not.toThrow();
        expect(world.getState().held).toBeCloseTo(STORE_MAX, 5);
        world.dispose();
    });

    it('reuses its lock slots as a ring and never grows a pool', () => {
        const { camera, world } = makeWorld('Low');
        const pools = [
            [world.wisps, 'aFrom', WISP_SLOTS * WISP_TAIL],
            [world.shards, 'aBirth', QUALITY.Low.shards],
            [world.meteors, 'aStart', QUALITY.Low.meteors],
            [world.crystals, 'aStore', world.crystals.count],
        ];
        const slots = world.u.lockA.slice();
        const colours = world.u.lockC.slice();
        const births = world.shards.geometry.getAttribute('aBirth');
        const { version } = births;
        const times = [];
        for (let i = 0; i < LOCK_SLOTS + 2; i++) {
            run(world, camera, 0.1);
            times.push(world.time);
            world.onLock({ u: (i + 0.5) / (LOCK_SLOTS + 2), hardDrop: i % 2 === 0, color: '#d8a8ff' });
        }
        expect(world.counts.locks).toBe(LOCK_SLOTS + 2);
        // More locks than slots: the same uniforms, every one of them written...
        expect(world.u.lockA).toHaveLength(LOCK_SLOTS);
        expect(world.u.lockC).toHaveLength(LOCK_SLOTS);
        world.u.lockA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        world.u.lockC.forEach((slot, i) => expect(slot).toBe(colours[i]));
        expect(world.u.lockA.every((slot) => slot.value.w > 0)).toBe(true);
        // ...the newest ring among them, the oldest overwritten.
        expect(ringBornAt(world, times[times.length - 1])).toBeTruthy();
        expect(ringBornAt(world, times[0])).toBeNull();
        expect(births.version).toBeGreaterThan(version);
        for (const [part, name, size] of pools) {
            expect(part.geometry.getAttribute(name).count, name).toBe(size);
            expect(part.geometry.instanceCount, name).toBe(size);
        }
        // More wisps than there are slots: the oldest are overwritten, none added.
        for (let i = 0; i < WISP_SLOTS; i++) world.onLock({ u: 0.3, hardDrop: true });
        expect(world.counts.wisps).toBeGreaterThan(WISP_SLOTS);
        expect(used(world.wisps, 'aFrom')).toHaveLength(WISP_SLOTS * WISP_TAIL);
        expect(used(world.shards, 'aBirth').length).toBeLessThanOrEqual(QUALITY.Low.shards);
        world.dispose();
    });

    it('rings the flats on request, round a fixed set of slots', () => {
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

    it('aims at the click when a mode has no board to aim through', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        expect(world.getState().layoutLive).toBe(false);
        world.onLock({ screen: { x: 0.2, y: 0.85 }, color: '#ffd4a8' });
        expect(ringBornAt(world, world.time).place.x).toBeLessThan(-1);
        run(world, camera, 1 / 60, 1);
        world.onLock({ screen: { x: 0.85, y: 0.9 } });
        expect(ringBornAt(world, world.time).place.x).toBeGreaterThan(1);
        const [left, right] = used(world.crystals, 'aPulse')
            .sort((a, b) => tipScreenX(world, a) - tipScreenX(world, b));
        expect(tipScreenX(world, left)).toBeLessThan(0.5);
        expect(tipScreenX(world, right)).toBeGreaterThan(0.5);
        // With no board at all a lock still lands where the solo board would stand.
        run(world, camera, 1 / 60, 1);
        world.onLock({ u: 0.5, rows: [19] });
        expect(ringBornAt(world, world.time).place.y).toBeLessThan(-3);
        expect(world.counts.wisps).toBe(3);
        world.dispose();
    });
});

describe('lunara world: clears, combos and the four-line clear', () => {
    it('sends a wave out from the foot of the board, one front per line, and fires the rows out of the card', () => {
        const { world } = makeWorld('Low');
        world.onClear({ rows: [19, 18], lines: 2 });
        const slot = world.u.clearA[0].value;
        expect(slot.x).toBe(world.time);
        expect(slot.y).toBe(2);
        expect(slot.z).toBeGreaterThan(0);
        expect(slot.w).toBe(0);
        // The wave's heart is in the flats under the board.
        const heart = world.u.heart.value;
        expect(heart.y).toBeLessThan(-3);
        expect(heart.y).toBeGreaterThan(-25);
        expect(Math.abs(heart.x)).toBeLessThan(3);
        const beams = world.beams.uniforms;
        const board = world.layout.boards[0];
        const card = world.layout.cards[0];
        expect(beams.frame.value.x).toBeCloseTo(card.x0, 9);
        expect(beams.frame.value.y).toBeCloseTo(card.x1, 9);
        expect(beams.frame.value.z).toBe(world.time);
        expect(beams.frame.value.w).toBeGreaterThan(0);
        // Row 19 is the floor row; row 18 the one above it.
        expect(beams.rows.value.x).toBeGreaterThan(beams.rows.value.y);
        expect(beams.rows.value.x).toBeLessThan(board.y1);
        expect(beams.rows.value.y).toBeGreaterThan(board.y0);
        expect(beams.rows.value.z).toBe(-1);
        expect(beams.rows.value.w).toBe(-1);
        expect(world.counts.clears).toBe(1);
        // Without rows it clears from the floor up.
        world.onClear({ lines: 3 });
        expect(beams.rows.value.x).toBeGreaterThan(beams.rows.value.y);
        expect(beams.rows.value.y).toBeGreaterThan(beams.rows.value.z);
        expect(beams.rows.value.z).toBeGreaterThan(0);
        expect(beams.rows.value.w).toBe(-1);
        world.dispose();
    });

    it('keeps the row beams dark when no board is on screen', () => {
        const { world } = makeWorld('Low', { live: false });
        world.onClear({ lines: 2 });
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        expect(world.u.clearA[0].value.z).toBeGreaterThan(0);
        // A click's clear starts where it was clicked, and fires no rows either.
        world.onClear({ lines: 1, screen: { x: 0.15, y: 0.9 } });
        expect(world.u.heart.value.x).toBeLessThan(-1);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        world.dispose();
    });

    it('answers one, two and three lines in different colours, ever stronger, and reuses its slots', () => {
        const { world } = makeWorld('Low');
        const slots = world.u.clearA.slice();
        world.onClear({ lines: 1 });
        const one = world.u.clearC[0].value.clone();
        const first = world.u.clearA[0].value.clone();
        world.onClear({ lines: 2 });
        const two = world.u.clearC[1].value.clone();
        const second = world.u.clearA[1].value.clone();
        world.onClear({ lines: 3 });
        const three = world.u.clearC[0].value.clone();
        expect(world.u.clearA).toHaveLength(CLEAR_SLOTS);
        world.u.clearA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        expect(world.u.clearA[0].value.y).toBe(3);
        expect(world.u.clearA[1].value.y).toBe(2);
        expect(one.distanceTo(two)).toBeGreaterThan(0.1);
        expect(one.distanceTo(three)).toBeGreaterThan(0.1);
        expect(two.distanceTo(three)).toBeGreaterThan(0.1);
        // Each is as bright as the others at its peak: only the hue tells them apart.
        const peak = (c) => Math.max(c.x, c.y, c.z);
        expect(peak(two)).toBeCloseTo(peak(one), 6);
        expect(peak(three)).toBeCloseTo(peak(one), 6);
        expect(second.z).toBeGreaterThan(first.z);
        expect(world.u.clearA[0].value.z).toBeGreaterThan(second.z);
        // No line count is one line; more than four is four.
        world.onClear({});
        expect(world.u.clearA[1].value.y).toBe(1);
        world.onClear({ lines: 9 });
        expect(world.u.clearA[0].value.y).toBe(4);
        expect(world.counts.clears).toBe(5);
        world.dispose();
    });

    it('lets every spire go of its light as the wave passes it', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, hardDrop: true, color: '#ffa8d0' });
        world.onLock({ u: 0.8, hardDrop: true, color: '#a8e0ff' });
        run(world, camera, lastArrival(world) - world.time + 0.05);
        const { held } = world.getState();
        expect(held).toBeGreaterThan(0);
        const holders = [];
        for (let i = 0; i < world.crystals.count; i++) if (world.crystals.heldAt(i, world.time) > 0) holders.push(i);

        const { storm } = world;
        world.onClear({ lines: 2 });
        const birth = world.time;
        expect(world.storm).toBeGreaterThan(storm); // the aurora surges
        // Nothing is lost yet: the wave has only just left.
        expect(world.getState().held).toBeCloseTo(held, 9);
        // Every spire answers when the front reaches it: nearer ones first, all within its travel.
        const pulse = instanced(world.crystals, 'aPulse');
        const heart = world.u.heart.value;
        const passes = [];
        for (let i = 0; i < world.crystals.count; i++) {
            const distance = Math.hypot(drawnX(world, i) - heart.x, world.plan.crystals[i].z - heart.y);
            passes.push([distance, pulse.array[i * 4 + 3]]);
        }
        passes.sort((a, b) => a[0] - b[0]);
        for (let i = 0; i < passes.length; i++) {
            expect(passes[i][1]).toBeGreaterThan(birth);
            expect(passes[i][1]).toBeLessThanOrEqual(birth + CLEAR_TRAVEL + 1e-4);
            if (i > 0) expect(passes[i][1]).toBeGreaterThanOrEqual(passes[i - 1][1] - 1e-5);
        }
        // A spire that held light flares in its own colour as it lets go, brighter than one that held none.
        const empty = world.targets.left.find((i) => !holders.includes(i));
        const flare = (i) => Math.max(pulse.array[i * 4], pulse.array[i * 4 + 1], pulse.array[i * 4 + 2]);
        expect(flare(holders[0])).toBeGreaterThan(flare(empty));

        // Once the wave has passed, the valley holds nothing.
        let previous = held;
        for (let i = 0; i < 20; i++) {
            run(world, camera, (CLEAR_TRAVEL * 1.05) / 20);
            expect(world.getState().held).toBeLessThanOrEqual(previous);
            previous = world.getState().held;
        }
        expect(world.getState().held).toBe(0);
        for (const i of holders) expect(world.crystals.heldAt(i, world.time)).toBe(0);
        // And it can be filled again.
        world.onLock({ u: 0.2, color: '#ffa8d0' });
        run(world, camera, lastArrival(world) - world.time + 0.05);
        expect(world.getState().held).toBeGreaterThan(0);
        world.dispose();
    });

    it('swells the moon\'s shafts at once and kicks the camera a beat after a clear', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        world.onClear({ lines: 2 });
        expect(world.kick).toBe(0);
        run(world, camera, 1 / 120, 1);
        const post = world.getPostState();
        expect(post.shafts).toBeGreaterThan(rest.shafts);
        expect(post.bloomBoost).toBeGreaterThan(rest.bloomBoost);
        // The iris closes as the valley flares, so its colours survive.
        expect(post.exposure).toBeLessThan(rest.exposure);
        let peak = 0;
        for (let i = 0; i < 96; i++) {
            run(world, camera, CLEAR_TRAVEL / 96, 1);
            peak = Math.max(peak, world.kick);
        }
        expect(peak).toBeGreaterThan(0.1);
        world.dispose();
    });

    it('charges with the combo: a halo ring round the moon for every step, and veins across its face', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({
            combo: 0, power: 0, rings: 0, veins: 0,
        });
        const rest = { aurora: world.u.aurora.value, shafts: world.getPostState().shafts, lift: world.moteLift };
        run(world, camera, 1);
        rest.lift = world.moteLift - rest.lift; // how far the motes rise in a second at rest
        // A single clear is not a chain: the valley stirs, no ring forms.
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
        expect(world.rings).toBeCloseTo(Math.min(MAX_RINGS, 3), 3);
        expect(world.getState()).toMatchObject({ combo: 4, power: world.power, rings: world.rings });
        expect(world.u.power.value).toBe(world.power);
        expect(world.u.rings.value).toBe(world.rings);
        expect(world.u.veins.value).toBeGreaterThan(0);
        expect(world.getState().veins).toBe(world.u.veins.value);
        // The moon can wear only so many.
        world.onCombo(MAX_RINGS + 20);
        run(world, camera, 5);
        expect(world.rings).toBeCloseTo(MAX_RINGS, 3);
        expect(world.rings).toBeLessThanOrEqual(MAX_RINGS);
        expect(world.power).toBeLessThanOrEqual(1);
        // The charge lifts the sky, the motes and the shafts, and quickens the companion.
        expect(world.u.aurora.value).toBeGreaterThan(rest.aurora);
        expect(world.getPostState().shafts).toBeGreaterThan(rest.shafts);
        const { orbit } = world;
        const lift = world.moteLift;
        run(world, camera, 1);
        expect(world.orbit - orbit).toBeGreaterThan(ORBIT_RATE * 1.5);
        expect(world.moteLift - lift).toBeGreaterThan(rest.lift * 1.5);

        // The chain breaks: the valley lets its breath go, and everything falls back.
        world.onCombo(0);
        expect(world.dip).toBeGreaterThan(0);
        run(world, camera, 0.2);
        expect(world.getState().breath).toBeLessThan(0.95);
        const falling = world.rings;
        expect(falling).toBeLessThan(MAX_RINGS);
        run(world, camera, 10);
        expect(world.power).toBeLessThan(0.01);
        expect(world.rings).toBeLessThan(0.01);
        expect(world.getState().veins).toBeLessThan(0.01);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        // Nonsense is no chain.
        world.onCombo(NaN);
        expect(world.combo).toBe(0);
        world.onCombo(-4);
        expect(world.combo).toBe(0);
        world.onCombo('3');
        expect(world.combo).toBe(3);
        world.dispose();
    });

    it('holds its breath on four lines, then stands the pillars, rings the sky and brings the meteors down', () => {
        const { camera, world } = makeWorld('High');
        const rest = { ...world.getPostState() };
        const aux = instanced(world.crystals, 'aAux');
        const standing = () => {
            const out = [];
            for (let i = 0; i < world.crystals.count; i++) if (aux.array[i * 4 + 2] > 0) out.push(i);
            return out;
        };
        expect(standing()).toHaveLength(0);
        expect(used(world.meteors, 'aStart')).toHaveLength(0);

        const t0 = world.time;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const slot = world.u.clearA[0].value;
        expect(slot.y).toBe(4);
        expect(slot.w).toBe(1); // moonfire
        // The wave waits for the breath to be let go.
        expect(slot.x).toBeCloseTo(t0 + HUSH_HOLD, 9);
        expect(world.counts.quads).toBe(1);
        const { surge } = world.getState();
        expect(surge).toBeGreaterThan(0.5);
        // It fires in moonfire: warm, red over green over blue.
        const fire = world.u.clearC[0].value;
        expect(fire.x).toBeGreaterThan(fire.y);
        expect(fire.y).toBeGreaterThan(fire.z);
        expect(fire.y / fire.x).toBeCloseTo((MOONFIRE[1] * 0.92 + 0.08) / (MOONFIRE[0] * 0.92 + 0.08), 6);

        // ── The hush: every light sinks ──
        run(world, camera, HUSH_HOLD * 0.9);
        expect(world.getState().breath).toBeCloseTo(0.12, 1);
        expect(world.getState().breath).toBeLessThan(0.2);
        expect(world.u.breath.value).toBe(world.getState().breath);
        expect(world.getPostState().shafts).toBeLessThan(rest.shafts);

        // ── Then everything fires ──
        run(world, camera, HUSH_HOLD * 0.1 + 0.5);
        expect(world.getState().breath).toBeGreaterThan(0.95);
        expect(world.getPostState().shafts).toBeGreaterThan(rest.shafts);
        expect(world.getPostState().exposure).toBeLessThan(0.9); // the iris closes on the flare
        expect(world.getState().veins).toBeGreaterThan(0.3); // the moon's veins fire
        // A prismatic ring crosses the sky from the great moon, born with the wave.
        expect(world.u.shock.value.x).toBeCloseTo(t0 + HUSH_HOLD, 9);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        // A pillar stands on the tallest spire of every cluster in view, from the moment the wave reaches it.
        const pillars = standing();
        expect(pillars.length).toBeGreaterThan(0);
        for (let i = 0; i < world.crystals.count; i++) {
            const crystal = world.plan.crystals[i];
            if (crystal.main && crystal.cluster >= 0) expect(pillars, `spire ${i}`).toContain(i);
        }
        for (const i of pillars) {
            expect(aux.array[i * 4 + 1]).toBeGreaterThan(t0 + HUSH_HOLD);
            expect(aux.array[i * 4 + 1]).toBeLessThanOrEqual(t0 + HUSH_HOLD + CLEAR_TRAVEL + 1e-4);
        }
        // Meteors fall, a moment after the breath is let go.
        const meteors = used(world.meteors, 'aStart');
        expect(meteors.length).toBeGreaterThan(1);
        const starts = world.meteors.geometry.getAttribute('aStart');
        for (const i of meteors) expect(starts.array[i * 4 + 3]).toBeGreaterThan(t0 + HUSH_HOLD);

        // ── And cools ──
        run(world, camera, t0 + SURGE_COOL - world.time, 240);
        expect(world.getState().surge).toBeCloseTo(surge * Math.exp(-1), 6);
        run(world, camera, SURGE_COOL * 8, 600);
        expect(world.getState().surge).toBeLessThan(0.01);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        expect(world.getPostState().exposure).toBeGreaterThan(0.99);
        expect(world.getPostState().shafts).toBeCloseTo(rest.shafts, 2);
        world.dispose();
    });

    it('fires a perfect clear as a four-line clear, hotter still', () => {
        const quad = makeWorld('Low');
        const perfect = makeWorld('Low');
        quad.world.onClear({ lines: 4 });
        perfect.world.onClear({ lines: 1, perfect: true });
        expect(perfect.world.u.clearA[0].value.toArray().slice(0, 2)).toEqual([perfect.world.time + HUSH_HOLD, 4]);
        expect(perfect.world.u.clearA[0].value.w).toBe(1);
        expect(perfect.world.counts.quads).toBe(1);
        expect(perfect.world.getState().surge).toBeGreaterThan(quad.world.getState().surge);
        run(perfect.world, perfect.camera, HUSH_HOLD * 0.9);
        expect(perfect.world.getState().breath).toBeLessThan(0.2);
        quad.world.dispose();
        perfect.world.dispose();
    });

    it('turns the sky on a T-spin and lets it settle', () => {
        const { camera, world } = makeWorld('Low');
        const calm = world.auroraDrift;
        run(world, camera, 0.5);
        const atRest = world.auroraDrift - calm;
        const quad = makeWorld('Low');
        quad.world.onClear({ lines: 4 });

        world.onClear({ lines: 2, tspin: true });
        expect(world.twist).toBe(1);
        expect(world.storm).toBeGreaterThan(0.5);
        // A small ring from the moon, at once: gentler than a four-line clear's.
        expect(world.u.shock.value.x).toBe(world.time);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        expect(world.u.shock.value.y).toBeLessThan(quad.world.u.shock.value.y);
        const before = world.auroraDrift;
        run(world, camera, 0.5);
        expect(world.auroraDrift - before).toBeGreaterThan(atRest * 2); // the curtains twist
        run(world, camera, 6);
        expect(world.twist).toBeLessThan(0.01);
        expect(world.counts.quads).toBe(0);
        quad.world.dispose();
        world.dispose();
    });

    it('changes the valley\'s colours with the level and cycles through its palettes', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ level: 1, palette: LUNARA_PALETTES[0].name });
        const before = world.u.crystal.value.clone();
        world.levelUp(2);
        expect(world.getState()).toMatchObject({ level: 2, palette: LUNARA_PALETTES[1].name });
        // The valley marks it: the aurora stirs and a ring crosses the sky.
        expect(world.storm).toBeGreaterThan(0);
        expect(world.u.shock.value.x).toBe(world.time);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        // The colours ease across, they do not snap.
        run(world, camera, 1 / 60, 1);
        const moved = world.u.crystal.value.distanceTo(before);
        expect(moved).toBeGreaterThan(0);
        expect(moved).toBeLessThan(0.1);
        run(world, camera, 8);
        const [r, g, b] = LUNARA_PALETTES[1].crystal;
        expect(world.u.crystal.value.distanceTo(new THREE.Vector3(r, g, b))).toBeLessThan(0.01);
        expect(world.u.crystal.value.distanceTo(before)).toBeGreaterThan(0.2);
        // Past the last palette it starts again.
        for (let level = 1; level <= LUNARA_PALETTES.length * 2 + 1; level++) {
            world.levelUp(level);
            expect(world.getState().palette).toBe(LUNARA_PALETTES[(level - 1) % LUNARA_PALETTES.length].name);
        }
        // A capture rests on a level's palette at once.
        world.levelUp(3, { silent: true });
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.getState().palette).toBe(LUNARA_PALETTES[2].name);
        for (const key of ['bed', 'zenith', 'crystal', 'auroraLow', 'auroraHigh']) {
            LUNARA_PALETTES[2][key].forEach((channel, k) => {
                expect(world.u[key].value.getComponent(k), key).toBeCloseTo(channel, 9);
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

describe('lunara world: time', () => {
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
        expect(a.time).toBeCloseTo(b.time, 9);
        expect(a.counts).toEqual(b.counts);
        expect(a).toMatchObject({ combo: b.combo, level: b.level, palette: b.palette });
        expect(a.held).toBeGreaterThan(0);
        for (const key of ['power', 'surge', 'storm', 'breath', 'rings', 'veins', 'held']) {
            expect(a[key], key).toBeCloseTo(b[key], 3);
        }
        // The slow clocks are integrated frame by frame: close, not identical.
        expect(a.orbit).toBeCloseTo(b.orbit, 2);
        expect(slow.world.auroraDrift).toBeCloseTo(fast.world.auroraDrift, 1);
        expect(slow.world.moteLift / fast.world.moteLift).toBeCloseTo(1, 2);
        expect(a.heart.x).toBeCloseTo(b.heart.x, 3);
        expect(a.heart.y).toBeCloseTo(b.heart.y, 3);
        const postA = slow.world.getPostState();
        const postB = fast.world.getPostState();
        for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure']) {
            expect(postA[key], key).toBeCloseTo(postB[key], 3);
        }
        expect(slow.world.u.crystal.value.distanceTo(fast.world.u.crystal.value)).toBeLessThan(1e-3);
        // Event slots hold timestamps: they are identical whatever the frame rate.
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            expect(slow.world.u.clearA[i].value.toArray()).toEqual(fast.world.u.clearA[i].value.toArray());
        }
        // A ring's place (and a wisp's flight) depends on the camera's pose that frame: the same to a hair.
        for (let i = 0; i < LOCK_SLOTS; i++) {
            const lockA = slow.world.u.lockA[i].value.toArray();
            const lockB = fast.world.u.lockA[i].value.toArray();
            for (let k = 0; k < 4; k++) expect(lockA[k], `lock slot ${i}[${k}]`).toBeCloseTo(lockB[k], 3);
        }
        expect(slow.world.u.shock.value.toArray()).toEqual(fast.world.u.shock.value.toArray());
        slow.world.dispose();
        fast.world.dispose();
    });

    it('replays a frame: seek, then the same steps, gives the same valley whatever came before', () => {
        const { camera, world } = makeWorld('Low');
        // What a frame is made of: the state, the post's inputs, the event slots, what every
        // spire holds and every pool's births, the sky's clocks and the camera.
        const flat = (value) => (typeof value === 'object' ? Object.values(value) : value);
        const births = (part, name) => Array.from(instanced(part, name).array).filter((v, i) => i % 4 === 3);
        const snapshot = () => [
            ...Object.values(world.getState()).flatMap(flat),
            ...['flash', 'kick', 'shafts', 'bloomBoost', 'exposure'].map((key) => world.getPostState()[key]),
            ...world.u.lockA.flatMap((slot) => slot.value.toArray()),
            ...world.u.clearA.flatMap((slot) => slot.value.toArray()),
            ...world.u.shock.value.toArray(),
            ...instanced(world.crystals, 'aStore').array,
            ...instanced(world.crystals, 'aPulse').array,
            ...births(world.wisps, 'aFrom'),
            ...births(world.shards, 'aBirth'),
            ...births(world.meteors, 'aStart'),
            world.auroraDrift,
            world.moteLift,
            world.orbit,
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
        // The same to well under a millimetre and a millisecond. (Not to the last bit: the lens
        // keeps up to a thousandth of a degree of the last impact, which moves where a ring lands.)
        let worst = 0;
        for (let i = 0; i < first.length; i++) {
            if (typeof first[i] === 'number') worst = Math.max(worst, Math.abs(first[i] - again[i]));
            else expect(again[i]).toBe(first[i]);
        }
        expect(worst).toBeLessThan(5e-4);
        world.dispose();
    });

    it('drops every event in flight when it seeks, and puts the sky where the clock says', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4 });
        world.onClear({ lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1);
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
            veins: 0,
            level: 1,
            palette: LUNARA_PALETTES[0].name,
            held: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, wisps: 0,
            },
        });
        expect(world.orbit).toBeCloseTo(ORBIT_START + 40 * ORBIT_RATE, 12);
        expect(world.meteorBeat).toBe(Math.floor(40 / METEOR_BEAT));
        for (let i = 0; i < LOCK_SLOTS; i++) expect(world.u.lockA[i].value.w).toBe(0);
        for (let i = 0; i < CLEAR_SLOTS; i++) expect(world.u.clearA[i].value.z).toBe(0);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        for (const [part, name] of [
            [world.wisps, 'aFrom'], [world.shards, 'aBirth'], [world.meteors, 'aStart'], [world.crystals, 'aPulse'],
        ]) {
            expect(used(part, name), name).toHaveLength(0);
        }
        const aux = instanced(world.crystals, 'aAux');
        for (let i = 0; i < world.crystals.count; i++) expect(aux.array[i * 4 + 2]).toBe(0); // no pillar stands
        // A seek before the start of time is the start of time.
        world.seek(-5);
        expect(world.time).toBe(0);
        world.dispose();
    });

    it('starts a new run with the valley at rest and the sky still turning', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1.5);
        world.onLock({ u: 0.7 });
        run(world, camera, 1);
        expect(world.getState().held).toBeGreaterThan(0);
        const {
            time, orbit, auroraDrift, moteLift, meteorBeat,
        } = world;
        world.resetSession();
        // The sky keeps its clocks: nothing jumps on screen...
        expect(world.time).toBe(time);
        expect(world.orbit).toBe(orbit);
        expect(world.auroraDrift).toBe(auroraDrift);
        expect(world.moteLift).toBe(moteLift);
        expect(world.meteorBeat).toBe(meteorBeat);
        // ...but the run is forgotten: no chain, no held light, no event in flight.
        expect(world.getState()).toMatchObject({
            combo: 0,
            power: 0,
            surge: 0,
            storm: 0,
            breath: 1,
            rings: 0,
            veins: 0,
            level: 1,
            palette: LUNARA_PALETTES[0].name,
            held: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, wisps: 0,
            },
        });
        for (let i = 0; i < LOCK_SLOTS; i++) expect(world.u.lockA[i].value.w).toBe(0);
        for (let i = 0; i < CLEAR_SLOTS; i++) expect(world.u.clearA[i].value.z).toBe(0);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.beams.uniforms.frame.value.w).toBe(0);
        expect(used(world.wisps, 'aFrom')).toHaveLength(0);
        // The spires are still there to be struck, and the board is still where it was.
        expect(world.getState().layoutLive).toBe(true);
        expect(world.targets.left.length).toBeGreaterThan(0);
        world.onLock({ u: 0.2 });
        expect(world.counts.wisps).toBe(1);
        // The next frame carries on from the same sky.
        run(world, camera, 1 / 60, 1);
        expect(world.orbit - orbit).toBeCloseTo(ORBIT_RATE / 60, 9);
        world.dispose();
    });

    it('throws a shooting star on the valley\'s own beat, never in a frozen frame', () => {
        const { camera, world } = makeWorld('Low');
        expect(used(world.meteors, 'aStart')).toHaveLength(0);
        run(world, camera, METEOR_BEAT - (world.time % METEOR_BEAT) + 0.1, 60);
        expect(used(world.meteors, 'aStart')).toHaveLength(1);
        // A capture stepping over a beat with the clock frozen adds none.
        world.update({ time: world.time + METEOR_BEAT, delta: 0 }, camera);
        expect(used(world.meteors, 'aStart')).toHaveLength(1);
        world.dispose();
    });

    it('returns to its exact resting look long after the last event', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        const aurora = world.u.aurora.value;
        world.onLock({ u: 0.5, hardDrop: true });
        world.onCombo(5);
        world.onClear({ lines: 3 });
        run(world, camera, 2);
        world.onCombo(0);
        run(world, camera, 40, 800);
        const post = world.getPostState();
        expect(post.flash).toBeLessThan(1e-6);
        expect(post.kick).toBeLessThan(1e-6);
        expect(post.shafts).toBeCloseTo(rest.shafts, 6);
        expect(post.bloomBoost).toBeCloseTo(rest.bloomBoost, 6);
        expect(post.exposure).toBeCloseTo(1, 6);
        expect(world.u.breath.value).toBeCloseTo(1, 6);
        expect(world.u.aurora.value).toBeCloseTo(aurora, 6);
        expect(world.getState()).toMatchObject({ combo: 0, held: 0 });
        expect(world.getState().power).toBeLessThan(1e-6);
        world.dispose();
    });
});

describe('lunara effects: closed forms', () => {
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

    it('throws crystal dust up, lets it fall and settles it on the water', () => {
        expect(shardHeight(4, 3, 0)).toBe(4);
        const rise = shardHeight(4, 3, 0.4);
        expect(rise).toBeGreaterThan(4);
        let previous = rise;
        for (let tau = 0.8; tau <= 6; tau += 0.4) {
            const height = shardHeight(4, 3, tau);
            expect(height).toBeLessThan(previous + 1e-9);
            expect(height).toBeGreaterThan(0); // never under the surface
            previous = height;
        }
        expect(shardHeight(4, 3, 6)).toBe(shardHeight(4, 3, 60));
        // Dust thrown straight down settles at once.
        expect(shardHeight(0, -5, 0.5)).toBe(shardHeight(4, 3, 60));
    });
});
