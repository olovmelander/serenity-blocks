/**
 * Winter — the world (winter-world.js), built without a GPU and driven the way the playground
 * effect and the theme drive it: the camera first, then the frame's events, then update().
 *
 * What is pinned is the choreography's structure — which slot an event writes, what it queues,
 * what rises and what sinks afterwards, what a seek and a new session keep — not its tuning:
 * every timing and gain is read from the modules.
 */

import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { WINTER_PARTS, WinterWorld } from '../../src/themes/winter/winter-world.js';
import { planGhosts } from '../../src/themes/winter/winter-ghosts.js';
import {
    EYE, FRAME_TREES, GUST_SLOTS, HOURS, HOUR_KEYS, HUSH_HOLD, REST_RIG, RING_SLOTS, SKY_SLOTS, SPARK_RISE, SPIRIT_RUN,
    bearingFor, fovForAspect, moonDirection, pieceColor, powerForCombo,
} from '../../src/themes/winter/winter-core.js';
import { SHADOW_RECT } from '../../src/themes/winter/winter-field.js';
import { BEAM_ROWS } from '../../src/themes/winter/winter-fx.js';
import { spiritPath } from '../../src/themes/winter/winter-fox.js';
import { FOX_CLIPS, MOUSING } from '../../src/themes/winter/winter-fox-mind.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/winter/winter-quality.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from '../../src/themes/winter/winter-composition.js';

const LANDSCAPE = [1600, 900];
const PORTRAIT = [430, 932];
/** The tier most of these worlds are built at: every part, small pools, a small shadow map. */
const TIER = 'Low';

/** Stand-in trees for every world in this file (the baked asset is winter-ghosts.test.js's). */
let ghosts;
beforeAll(() => {
    ghosts = planGhosts();
});

function makeWorld(quality = TIER, [width, height] = LANDSCAPE) {
    const scene = new THREE.Scene();
    const world = new WinterWorld({
        scene, quality, capture: true, ghosts, fox: false,
    }).build();
    const camera = new THREE.PerspectiveCamera(50, width / height, REST_RIG.near, REST_RIG.far);
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    // As the theme does before its first frame: the camera stands where events aim through it.
    world.updateCamera(camera, { time: 0, delta: 0 });
    world.update({ time: 0, delta: 0 }, camera);
    return { world, scene, camera };
}

/** One frame, in the theme's order (its events are flushed between the two calls). */
const frame = (world, camera, time, delta = 0) => {
    const sim = {
        time, delta, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
};

/** Fixed steps from `from` to `to`, as the playground effect's seek replays them. */
const step = (world, camera, from, to, dt = 1 / 60) => {
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i++) frame(world, camera, from + i * h, h);
};

const data = (part, name) => part.geometry.getAttribute(name).array;
/** Rows of the spark pool thrown at or after `time`: [{ nature, tint, birth }]. */
function thrownSince(world, time) {
    const birth = data(world.sparks, 'aBirth');
    const tint = data(world.sparks, 'aTint');
    const kind = data(world.sparks, 'aKind');
    const rows = [];
    for (let i = 0; i < world.sparks.count; i++) {
        if (birth[i * 4 + 3] >= time) {
            rows.push({
                birth: birth[i * 4 + 3],
                at: [birth[i * 4], birth[i * 4 + 1], birth[i * 4 + 2]],
                tint: [tint[i * 4], tint[i * 4 + 1], tint[i * 4 + 2]],
                powder: kind[i * 4 + 1] === 1,
            });
        }
    }
    return rows;
}
/** The first mesh a part draws (the trees hang under a group). */
function drawables(part) {
    const found = [];
    part.mesh.traverse((object) => {
        if (object.isMesh) found.push(object);
    });
    return found;
}
/**
 * The slots of a pool that are in use, each with every attribute's four numbers (null for a
 * parked slot). `live` is asked about the slot's row of the first attribute named.
 */
function liveRows(part, names, live) {
    const arrays = names.map((name) => data(part, name));
    return Array.from({ length: part.count }, (_, i) => {
        if (!live(arrays[0].subarray(i * 4, i * 4 + 4))) return null;
        return arrays.map((array) => Array.from(array.subarray(i * 4, i * 4 + 4)));
    });
}
const sum = (list) => list.reduce((total, v) => total + v, 0);
const finite = (v) => Number.isFinite(v);
/**
 * The light the sky holds for a piece is the piece's own hue pushed out (a pale piece would only
 * bleach the fires): peak 1, every channel alight, strongest and weakest where the piece's are.
 */
function expectHueOf(held, rgb, label = '') {
    expect(Math.max(...held), label).toBeCloseTo(1, 9);
    held.forEach((c) => {
        expect(c, label).toBeGreaterThan(0);
        expect(c, label).toBeLessThanOrEqual(1);
    });
    expect(held.indexOf(Math.max(...held)), label).toBe(rgb.indexOf(Math.max(...rgb)));
    expect(held.indexOf(Math.min(...held)), label).toBe(rgb.indexOf(Math.min(...rgb)));
    // No paler than the piece: at least as far from grey.
    expect(Math.min(...held), label).toBeLessThanOrEqual(Math.min(...rgb) + 1e-9);
}

describe('WinterWorld: what it builds', () => {
    it('builds every part at every tier and lets go of all of it', () => {
        const always = ['sky', 'ground', 'trees', 'snow', 'sparks', 'beams', 'prints'];
        expect(WINTER_PARTS).toEqual(expect.arrayContaining(always));
        QUALITY_NAMES.forEach((quality) => {
            const { world, scene } = makeWorld(quality);
            const tier = QUALITY[quality];
            // (The fox and its like of light join when the model arrives; none is fetched here.)
            const expected = WINTER_PARTS
                .filter((name) => name !== 'fox' && name !== 'spirit' && (name !== 'dust' || tier.dust > 0));
            expect(Object.keys(world.parts).sort(), quality).toEqual([...expected].sort());
            expect(scene.children).toEqual([world.root]);
            Object.keys(world.parts).forEach((name) => {
                const part = world.parts[name];
                expect(part.mesh.parent, `${quality} ${name}`).toBe(world.root);
                const meshes = drawables(part);
                expect(meshes.length, `${quality} ${name}`).toBeGreaterThan(0);
                meshes.forEach((mesh) => {
                    expect(mesh.material.isNodeMaterial, `${quality} ${name}`).toBe(true);
                    // Every attribute is its own vertex buffer on WebGPU, and a pipeline binds
                    // eight (an instanced mesh's matrix is one more).
                    const buffers = Object.keys(mesh.geometry.attributes).length + (mesh.isInstancedMesh ? 1 : 0);
                    expect(buffers, `${quality} ${name}`).toBeLessThanOrEqual(8);
                    expect(mesh.geometry.getAttribute('position'), `${quality} ${name}`).toBeTruthy();
                    // Nothing here moves by its matrix or may be culled by a stale bound.
                    expect(mesh.frustumCulled, `${quality} ${name}`).toBe(false);
                });
            });
            const state = world.getState();
            expect(state.quality).toBe(quality);
            expect(state.source).toBe('plan');
            expect(state.groundVertices).toBe((tier.ground[0] + 1) * (tier.ground[1] + 1));
            expect(state.sparks).toBe(tier.sparks);
            expect(state.snow).toBe(tier.snow);
            expect(world.prints.count).toBe(tier.prints);
            if (tier.dust > 0) expect(world.parts.dust.count).toBe(tier.dust);
            // Every tree of the plan is planted, the framing ones among them.
            expect(state.trees).toBe(world.trees.length);
            expect(state.trees).toBeGreaterThan(FRAME_TREES.length);
            expect(state.trees).toBeLessThanOrEqual(FRAME_TREES.length + tier.mid + tier.far);
            expect(sum(drawables(world.parts.trees).map((mesh) => mesh.count))).toBe(state.trees);
            expect(state.treeTriangles).toBeGreaterThan(0);
            // The pools are always drawn, whole: a dormant slot is a quad of no size.
            expect(world.sparks.geometry.instanceCount).toBe(tier.sparks);
            expect(world.beams.geometry.instanceCount).toBe(BEAM_ROWS * 2);
            // The moon shadows' map covers the patch the field says it does.
            const rect = world.u.shadowRect.value;
            expect([rect.x, rect.y]).toEqual([SHADOW_RECT.x0, SHADOW_RECT.z0]);
            expect(rect.z).toBeCloseTo(1 / SHADOW_RECT.width, 12);
            expect(rect.w).toBeCloseTo(1 / SHADOW_RECT.depth, 12);
            const shadow = world.u.shadowTex.image;
            expect(shadow.data).toHaveLength(shadow.width * shadow.height);
            if (tier.shadows > 0) {
                expect(shadow.width).toBe(tier.shadows);
                expect(shadow.data.some((v) => v < 128), quality).toBe(true);
            }

            world.dispose();
            expect(scene.children).toHaveLength(0);
            expect(world.u).toBeNull();
            expect(world.parts).toEqual({});
            // Again, and everything a frame or an event may still call: nothing throws.
            world.dispose();
            expect(() => {
                world.onLock({ u: 0.5 });
                world.onClear({ lines: 4 });
                world.onCombo(3);
                world.levelUp(2);
                world.onGameOver();
                world.setViewport(800, 600, 4 / 3);
                world.setLayout(null, 16 / 9);
                world.showOnlyParts(['sky']);
                world.update({ time: 1, delta: 1 / 60 });
            }).not.toThrow();
            expect(scene.children).toHaveLength(0);
        });
    });

    it('ignores events before it is built', () => {
        const scene = new THREE.Scene();
        const world = new WinterWorld({ scene, ghosts, fox: false });
        expect(() => {
            world.setViewport(430, 932, 430 / 932);
            world.onLock({ u: 0.2, color: '#ff9ccf' });
            world.onClear({ lines: 2 });
            world.levelUp(3);
            world.update({ time: 1, delta: 1 / 60 });
        }).not.toThrow();
        expect(world.counts.locks).toBe(0);
        expect(scene.children).toHaveLength(0);
        // Built afterwards, it is laid out for the frame it was told about.
        world.build();
        expect(world.u.moonDir.value.x).toBeCloseTo(moonDirection(430 / 932)[0], 12);
        const [first] = world.trees;
        expect(Math.atan2(first.x, -first.z)).toBeCloseTo(bearingFor(FRAME_TREES[0][0], 430 / 932), 9);
        world.dispose();
    });

    it('does its arithmetic in load(), a step at a time, and builds the same world from it', async () => {
        const direct = makeWorld();
        const scene = new THREE.Scene();
        const world = new WinterWorld({
            scene, quality: TIER, capture: true, ghosts, fox: false,
        });
        const loaded = await world.load();
        expect(loaded).toEqual({ source: 'plan' });
        // Nothing is in the scene yet, and no GPU-side object exists.
        expect(scene.children).toHaveLength(0);
        expect(world.u).toBeNull();
        expect(world.trees.length).toBeGreaterThan(FRAME_TREES.length);
        world.build();
        world.setViewport(LANDSCAPE[0], LANDSCAPE[1], LANDSCAPE[0] / LANDSCAPE[1]);
        expect(world.getState().trees).toBe(direct.world.getState().trees);
        expect(world.getState().groundVertices).toBe(direct.world.getState().groundVertices);
        const bytes = (part, name) => Array.from(part.geometry.getAttribute(name).array.slice(0, 3000));
        expect(bytes(world.parts.ground, 'position')).toEqual(bytes(direct.world.parts.ground, 'position'));
        expect(bytes(world.parts.ground, 'normal')).toEqual(bytes(direct.world.parts.ground, 'normal'));
        expect(Array.from(world.u.shadowTex.image.data)).toEqual(Array.from(direct.world.u.shadowTex.image.data));
        expect(world.trees).toEqual(direct.world.trees);
        // What load() prepared has been handed over, not kept.
        expect(world._fan).toBeNull();
        expect(world._mask).toBeNull();
        world.dispose();
        direct.world.dispose();
    });

    it('re-plants at build when the frame changed shape after load()', async () => {
        const upright = PORTRAIT[0] / PORTRAIT[1];
        const world = new WinterWorld({
            scene: new THREE.Scene(), quality: TIER, capture: true, ghosts, fox: false,
        });
        await world.load();
        const planted = world.trees[0].x;
        world.setViewport(PORTRAIT[0], PORTRAIT[1], upright);
        world.build();
        expect(Math.abs(world.trees[0].x)).toBeLessThan(Math.abs(planted));
        const direct = makeWorld(TIER, PORTRAIT);
        expect(world.trees).toEqual(direct.world.trees);
        // The shadows are the upright frame's moon's, not the ones load() drew for the default.
        expect(Array.from(world.u.shadowTex.image.data)).toEqual(Array.from(direct.world.u.shadowTex.image.data));
        world.dispose();
        direct.world.dispose();
    });

    it('gives up quietly when it is disposed while loading', async () => {
        const scene = new THREE.Scene();
        const world = new WinterWorld({
            scene, quality: TIER, capture: true, ghosts, fox: false,
        });
        const loading = world.load();
        world.dispose();
        await expect(loading).resolves.toBeTruthy();
        expect(scene.children).toHaveLength(0);
        expect(world.u).toBeNull();
    });

    it('draws only the parts a capture asks for', () => {
        const { world } = makeWorld();
        const names = Object.keys(world.parts);
        world.showOnlyParts(['sky', 'ground']);
        names.forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'sky' || name === 'ground');
        });
        world.showOnlyParts(['sparks']);
        names.forEach((name) => expect(world.parts[name].mesh.visible, name).toBe(name === 'sparks'));
        // A name it does not have is nobody's: everything is hidden, nothing throws.
        world.showOnlyParts(['fox']);
        names.forEach((name) => expect(world.parts[name].mesh.visible, name).toBe(false));
        world.showOnlyParts(names);
        names.forEach((name) => expect(world.parts[name].mesh.visible, name).toBe(true));
        world.dispose();
    });
});

describe('WinterWorld: the camera and the frame', () => {
    it('stands the camera at the eye, tilted up, and hangs the lens\'s glare on the moon', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 3);
        expect(camera.fov).toBeCloseTo(fovForAspect(16 / 9), 9);
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        // A slow drift about the eye, never a walk.
        expect(camera.position.distanceTo(new THREE.Vector3(EYE.x, EYE.y, EYE.z))).toBeLessThan(0.5);
        const looking = camera.getWorldDirection(new THREE.Vector3());
        expect(looking.z).toBeLessThan(-0.9);
        expect(Math.asin(looking.y)).toBeCloseTo(REST_RIG.pitch, 1);
        // The moon is in the frame, right of the middle and above it.
        const { heart } = world;
        expect(heart.x).toBeGreaterThan(0.5);
        expect(heart.x).toBeLessThan(1);
        expect(heart.y).toBeGreaterThan(0);
        expect(heart.y).toBeLessThan(0.5);
        expect(world.getPostState().heart).toBe(heart);
        // The sky's dome is carried with the camera.
        expect(world.parts.sky.mesh.position.toArray()).toEqual(camera.position.toArray());
        // Pixels a metre covers at a metre: the viewport's height over the lens.
        const expected = world.u.viewport.value.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
        expect(world.u.pxScale.value).toBeCloseTo(expected, 6);
        world.dispose();
    });

    it('holds still for reduced motion', () => {
        const { world, camera } = makeWorld();
        world.setReducedMotion(true);
        step(world, camera, 0, 2);
        expect(camera.position.toArray()).toEqual([EYE.x, EYE.y, EYE.z]);
        const pose = camera.quaternion.toArray();
        world.onLock({ u: 0.4, hardDrop: true, color: '#6de0ff' });
        frame(world, camera, 2.01, 0.01);
        expect(camera.fov).toBe(fovForAspect(16 / 9));
        step(world, camera, 2.01, 5);
        expect(camera.quaternion.toArray()).toEqual(pose);
        // The wind still blows, only gentler.
        expect(world.windRun[0]).toBeGreaterThan(0);
        const { world: lively, camera: other } = makeWorld();
        step(lively, other, 0, 5);
        expect(world.windRun[0]).toBeLessThan(lively.windRun[0]);
        world.dispose();
        lively.dispose();
    });

    it('aims a screen point into the world and down onto the snow', () => {
        const { world, camera } = makeWorld();
        const ahead = world.screenToWorld(0.5, 0.5, 5.5, [0, 0, 0]);
        const axis = camera.getWorldDirection(new THREE.Vector3());
        expect(Math.hypot(ahead[0] - camera.position.x, ahead[1] - camera.position.y, ahead[2] - camera.position.z))
            .toBeCloseTo(5.5, 6);
        expect(ahead[0] - camera.position.x).toBeCloseTo(axis.x * 5.5, 3);
        expect(ahead[2] - camera.position.z).toBeCloseTo(axis.z * 5.5, 3);
        // Left of the frame is left in the world, the top of it is up.
        const through = (sx, sy) => world.screenToWorld(sx, sy, 5, [0, 0, 0]);
        expect(through(0.1, 0.5)[0]).toBeLessThan(through(0.9, 0.5)[0]);
        expect(through(0.5, 0.1)[1]).toBeGreaterThan(through(0.5, 0.9)[1]);
        // The foot of the frame meets the snow a few metres ahead...
        const foot = world.screenToSnow(0.5, 0.95);
        expect(foot.z).toBeLessThan(-2);
        expect(Math.hypot(foot.x, foot.z)).toBeLessThan(15);
        expect(Math.abs(foot.x)).toBeLessThan(1);
        // ...and lower in the frame is nearer.
        expect(Math.hypot(world.screenToSnow(0.5, 0.99).z)).toBeLessThan(Math.hypot(foot.z));
        // A ray that comes down far off stops at the limit, on its own bearing...
        const horizon = 0.5 - new THREE.Vector3(camera.position.x, camera.position.y, -1e6).project(camera).y / 2;
        expect(horizon).toBeGreaterThan(0.5); // (the camera is tilted up: the horizon is below the middle)
        const away = (p) => Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
        const grazing = world.screenToSnow(0.3, horizon + 0.01, 12);
        expect(away(grazing)).toBeCloseTo(12, 6);
        expect(grazing.x).toBeLessThan(0);
        expect(grazing.z).toBeLessThan(0);
        // ...and one that never comes down is given a place no farther than that.
        const sky = world.screenToSnow(0.3, 0.1, 12);
        expect(away(sky)).toBeLessThanOrEqual(12 + 1e-9);
        expect(away(sky)).toBeGreaterThan(6);
        expect(sky.x).toBeLessThan(0);
        expect(sky.z).toBeLessThan(0);
        expect(finite(sky.x) && finite(sky.z)).toBe(true);
        world.dispose();
    });

    it('hands the post stack finite numbers, whatever has just happened', () => {
        const { world, camera } = makeWorld();
        const check = (label) => {
            const post = world.getPostState();
            for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure', 'glare']) {
                expect(finite(post[key]), `${label}: ${key}`).toBe(true);
                expect(post[key], `${label}: ${key}`).toBeGreaterThanOrEqual(0);
            }
            expect(post.exposure, label).toBeGreaterThan(0);
            expect(post.glareColor.every(finite), label).toBe(true);
            expect(finite(post.heart.x) && finite(post.heart.y), label).toBe(true);
            // The object is reused frame to frame.
            expect(world.getPostState()).toBe(post);
        };
        check('at rest');
        step(world, camera, 0, 1);
        world.onLock({ u: 0.3, hardDrop: true, color: '#ffe2a0' });
        world.onCombo(7);
        frame(world, camera, 1 + 1 / 60, 1 / 60);
        check('a hard drop');
        expect(world.getPostState().kick).toBeGreaterThan(0);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        step(world, camera, 1 + 1 / 60, 1.1);
        check('holding its breath');
        step(world, camera, 1.1, 4);
        check('the sky open');
        world.onGameOver();
        step(world, camera, 4, 30);
        check('long after');
        // And everything the materials read is finite too.
        const { u } = world;
        const numbers = [
            'time', 'power', 'surge', 'breath', 'gale', 'auroraRun', 'halo', 'foxGlow', 'foxEyes', 'stars', 'pxScale',
            'glintGrid',
        ];
        numbers.forEach((key) => expect(finite(u[key].value), key).toBe(true));
        const vectors = [
            'moonDir', 'glowDir', 'curtains', 'windRun', 'foxPos', 'spirit', 'flare',
            ...HOUR_KEYS.map((k) => (k === 'moon' ? 'moonCol' : k)),
        ];
        vectors.forEach((key) => expect(u[key].value.toArray().every(finite), key).toBe(true));
        [...u.ringA, ...u.ringC, ...u.gustA, ...u.skyA, ...u.skyC].forEach((slot) => {
            expect(slot.value.toArray().every(finite)).toBe(true);
        });
        world.dispose();
    });
});

describe('WinterWorld: a piece locks', () => {
    it('sends a ring out from under the board and gives the sky the piece\'s colour', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        const before = world.getState().counts;
        expect(before.locks).toBe(0);
        const colour = '#ff9ccf';
        world.onLock({ u: 0.2, rows: [12, 11], color: colour });
        const state = world.getState();
        expect(state.counts.locks).toBe(1);
        expect(state.counts.sparks).toBeGreaterThan(before.sparks + 3);
        // ── The ring: (x, z, when, how hard) + (colour, reach) in the first slot only ──
        const ring = world.u.ringA[0].value;
        expect(ring.z).toBe(world.time);
        expect(ring.w).toBeGreaterThan(0);
        expect(ring.y).toBeLessThan(-2); // on the snow ahead, under the foot of the board
        expect(Math.hypot(ring.x, ring.y)).toBeLessThan(15);
        const rgb = pieceColor(colour);
        const lit = world.u.ringC[0].value;
        expect(lit.w).toBeGreaterThan(0);
        // The piece's own hue (whatever the gain).
        expect(lit.y / lit.x).toBeCloseTo(rgb[1] / rgb[0], 9);
        expect(lit.z / lit.x).toBeCloseTo(rgb[2] / rgb[0], 9);
        for (let i = 1; i < RING_SLOTS; i++) expect(world.u.ringA[i].value.w).toBe(0);
        // ── The sky: (bearing, when the sparks arrive, how much) + colour ──
        const sky = world.u.skyA[0].value;
        expect(sky.y).toBeGreaterThan(world.time);
        expect(sky.y).toBeLessThan(world.time + SPARK_RISE * 2);
        expect(sky.z).toBeGreaterThan(0);
        // A piece on the left leaves the card's left edge: the sky left of the board takes it.
        expect(sky.x).toBeLessThan(0);
        expectHueOf(world.u.skyC[0].value.toArray(), rgb);
        for (let i = 1; i < SKY_SLOTS; i++) expect(world.u.skyA[i].value.z).toBe(0);
        // ── What was thrown: sparks in the piece's colour, and powder off the snow ──
        const thrown = thrownSince(world, world.time);
        expect(thrown).toHaveLength(state.counts.sparks - before.sparks);
        const sparks = thrown.filter((row) => !row.powder);
        const powder = thrown.filter((row) => row.powder);
        expect(sparks.length).toBeGreaterThan(2);
        expect(powder.length).toBeGreaterThan(0);
        sparks.forEach((row) => {
            expect(row.tint[1] / row.tint[0]).toBeCloseTo(rgb[1] / rgb[0], 4);
            expect(row.tint[2] / row.tint[0]).toBeCloseTo(rgb[2] / rgb[0], 4);
            // They leave from in front of the viewer, off the card's left edge.
            expect(row.at[0]).toBeLessThan(0);
            expect(row.at[2]).toBeLessThan(0);
        });
        // The powder is kicked up where the ring starts.
        powder.forEach((row) => expect(Math.hypot(row.at[0] - ring.x, row.at[2] - ring.y)).toBeLessThan(1.5));
        // The lens feels it.
        expect(world.kick).toBeGreaterThan(0);
        expect(world.storm).toBeGreaterThan(0);
        world.dispose();
    });

    it('takes the side of the board the piece is on, and hits harder on a hard drop', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onLock({ u: 0.85, rows: [15], color: '#6de0ff' });
        expect(world.u.skyA[0].value.x).toBeGreaterThan(0);
        const thrown = thrownSince(world, world.time).filter((row) => !row.powder);
        thrown.forEach((row) => expect(row.at[0]).toBeGreaterThan(0));
        const soft = {
            ring: world.u.ringA[0].value.clone(),
            reach: world.u.ringC[0].value.w,
            sky: world.u.skyA[0].value.z,
            sparks: world.counts.sparks,
        };
        step(world, camera, 1, 1.5);
        const ringSlot = world.ringCursor % RING_SLOTS;
        world.onLock({
            u: 0.85, rows: [15], color: '#6de0ff', hardDrop: true,
        });
        // The next slot of each, harder and reaching farther.
        expect(ringSlot).toBe(1);
        expect(world.u.ringA[1].value.z).toBe(world.time);
        expect(world.u.ringA[1].value.w).toBeGreaterThan(soft.ring.w);
        expect(world.u.ringC[1].value.w).toBeGreaterThan(soft.reach);
        expect(world.u.ringA[0].value.toArray()).toEqual(soft.ring.toArray());
        const hard = world.u.skyA.map((slot) => slot.value).filter((slot) => slot.z > soft.sky);
        expect(hard.length).toBe(1);
        expect(thrownSince(world, world.time).length).toBeGreaterThan(soft.sparks);
        // A point on screen may stand in for the board (boards the layout does not know).
        step(world, camera, 1.5, 1.6);
        const skySlot = world.skyCursor % SKY_SLOTS;
        world.onLock({ screen: { x: 0.15, y: 0.4 }, color: '#5df2a6' });
        expect(world.counts.locks).toBe(3);
        expect(world.u.skyA[skySlot].value.y).toBeGreaterThan(world.time);
        expect(world.u.skyA[skySlot].value.x).toBeLessThan(0);
        // With no colour given the fallback colour is used: still a light, never black.
        world.onLock({ u: 0.5 });
        expect(world.counts.locks).toBe(4);
        world.dispose();
    });

    it('goes round its ring and sky slots without growing them', () => {
        const { world, camera } = makeWorld();
        const rounds = Math.max(RING_SLOTS, SKY_SLOTS) + 2;
        for (let i = 0; i < rounds; i++) {
            step(world, camera, i, i + 1);
            // (The fox's answering flick takes a sky slot of its own: the cursors say which is next.)
            const ring = world.ringCursor % RING_SLOTS;
            const sky = world.skyCursor % SKY_SLOTS;
            world.onLock({ u: 0.3, rows: [10], color: '#b79bff' });
            expect(world.u.ringA[ring].value.z, `lock ${i}`).toBe(world.time);
            expect(world.u.skyA[sky].value.y, `lock ${i}`).toBeGreaterThan(world.time);
            // One slot of each a lock, and no other touched.
            expect(world.ringCursor % RING_SLOTS).toBe((ring + 1) % RING_SLOTS);
            expect(world.skyCursor % SKY_SLOTS).toBe((sky + 1) % SKY_SLOTS);
        }
        // It has been round every slot more than once, and there are no more than there were.
        expect(world.ringCursor).toBeGreaterThan(RING_SLOTS);
        expect(world.skyCursor).toBeGreaterThan(SKY_SLOTS);
        expect(world.u.ringA).toHaveLength(RING_SLOTS);
        expect(world.u.ringC).toHaveLength(RING_SLOTS);
        expect(world.u.skyA).toHaveLength(SKY_SLOTS);
        expect(world.u.skyC).toHaveLength(SKY_SLOTS);
        expect(world.counts.locks).toBe(rounds);
        world.dispose();
    });

    it('flicks the fox\'s tail when the ring reaches it, in the piece\'s colour', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onLock({ u: 0.5, rows: [19], color: '#ffe2a0' });
        // Queued for when the ring gets there: later than now, sooner than it could ever take.
        expect(world.flicks).toHaveLength(1);
        const due = world.flicks[0].time;
        expect(due).toBeGreaterThan(world.time);
        expect(due).toBeLessThan(world.time + 4);
        expect(world.counts.flicks).toBe(0);
        const sparksBefore = world.counts.sparks;
        const poolBefore = Array.from(data(world.sparks, 'aBirth'));
        const skySlot = world.skyCursor % SKY_SLOTS;
        // Not yet...
        if (due - 1 > 2 / 60) {
            step(world, camera, 1, (1 + due) / 2);
            expect(world.counts.flicks).toBe(0);
            expect(world.flicks).toHaveLength(1);
        }
        // ...and then it does: sparks off its tail, and the sky above it takes the colour too.
        step(world, camera, world.time, due + 0.05);
        expect(world.counts.flicks).toBe(1);
        expect(world.flicks).toHaveLength(0);
        expect(world.counts.sparks).toBeGreaterThan(sparksBefore);
        expect(world.mind.flick).toBeGreaterThan(0);
        const rgb = pieceColor('#ffe2a0');
        expect(world.u.skyA[skySlot].value.z).toBeGreaterThan(0);
        expect(world.u.skyA[skySlot].value.y).toBeGreaterThan(due);
        expect(world.u.skyC[skySlot].value.toArray()).toEqual(world.u.skyC[0].value.toArray());
        expectHueOf(world.u.skyC[skySlot].value.toArray(), rgb);
        // The rows of the pool written since the lock: what the tail struck.
        const birth = data(world.sparks, 'aBirth');
        const tint = data(world.sparks, 'aTint');
        const struck = [];
        for (let i = 0; i < world.sparks.count; i++) {
            if (birth[i * 4 + 3] !== poolBefore[i * 4 + 3] || birth[i * 4] !== poolBefore[i * 4]) struck.push(i);
        }
        expect(struck).toHaveLength(world.counts.sparks - sparksBefore);
        // They leave from the fox, not from the card, at the moment the ring arrived, in the
        // piece's colour.
        const { pose } = world.mind;
        struck.forEach((i) => {
            expect(Math.hypot(birth[i * 4] - pose.x, birth[i * 4 + 2] - pose.z)).toBeLessThan(2);
            expect(birth[i * 4 + 3]).toBeGreaterThanOrEqual(due - 1e-5);
            expect(tint[i * 4 + 1] / tint[i * 4]).toBeCloseTo(rgb[1] / rgb[0], 4);
        });
        world.dispose();
    });

    it('lets a sleeping fox lie: a ring that arrives after the run is over flicks no tail', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onLock({ u: 0.5, rows: [19], color: '#ffe2a0' });
        expect(world.flicks).toHaveLength(1);
        const due = world.flicks[0].time;
        const skySlots = world.skyCursor;
        // The run ends while the ring is still on its way.
        world.onGameOver();
        expect(world.mind.asleep).toBe(true);
        step(world, camera, 1, due + 2);
        expect(world.counts.flicks).toBe(0);
        expect(world.flicks).toHaveLength(0);
        expect(world.mind.flick).toBe(0);
        expect(world.getState().fox.mode).toBe('sleep');
        // Only the lock's own slot of the sky was written.
        expect(world.skyCursor).toBe(skySlots);
        world.dispose();
    });

    it('wakes a sleeping fox when a piece locks: a run has begun, announced or not', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onGameOver();
        step(world, camera, 1, 5);
        expect(world.getState().fox.mode).toBe('sleep');
        const lay = [world.mind.pose.x, world.mind.pose.z];
        world.onLock({ u: 0.4, rows: [19], color: '#6de0ff' });
        expect(world.mind.asleep).toBe(false);
        frame(world, camera, 5 + 1 / 60, 1 / 60);
        const woken = world.getState().fox;
        expect(woken.mode).not.toBe('sleep');
        expect(Math.hypot(woken.x - lay[0], woken.z - lay[1])).toBeLessThan(0.1);
        // Awake, it answers the ring like any other.
        const due = world.flicks.length ? world.flicks[0].time : world.time;
        step(world, camera, world.time, due + 0.1);
        expect(world.counts.flicks).toBe(1);
        // A lock does nothing to a fox that is already up.
        const { mode } = world.mind;
        const { clip } = world.mind;
        world.onLock({ u: 0.6, rows: [18], color: '#6de0ff' });
        expect([world.mind.mode, world.mind.clip]).toEqual([mode, clip]);
        world.dispose();
    });
});

describe('WinterWorld: lines clear', () => {
    it('sends a gust from under the board and strums the sky, harder the more lines', () => {
        const { world, camera } = makeWorld();
        let previous = { gust: 0, flare: 0 };
        for (let lines = 1; lines <= 3; lines++) {
            step(world, camera, world.time, world.time + 2);
            const rows = Array.from({ length: lines }, (_, i) => 19 - i);
            world.onClear({ rows, lines });
            const slot = (lines - 1) % GUST_SLOTS;
            const gust = world.u.gustA[slot].value;
            // (x, z, when, how hard): from the snow under the board, now.
            expect(gust.z, `${lines} lines`).toBe(world.time);
            expect(gust.w, `${lines} lines`).toBeGreaterThan(previous.gust);
            expect(gust.y).toBeLessThan(-2);
            expect(Math.hypot(gust.x, gust.y)).toBeLessThan(15);
            // The flare: (when, how hard).
            const flare = world.u.flare.value;
            expect(flare.x, `${lines} lines`).toBe(world.time);
            expect(flare.y, `${lines} lines`).toBeGreaterThan(previous.flare);
            previous = { gust: gust.w, flare: flare.y };
            expect(world.counts.clears).toBe(lines);
            expect(world.counts.quads).toBe(0);
            // No hush for less than four: the night keeps breathing.
            frame(world, camera, world.time + 1 / 60, 1 / 60);
            expect(world.u.breath.value).toBeGreaterThan(0.9);
            expect(world.mind.mode).not.toBe('pounce');
        }
        expect(world.u.gustA).toHaveLength(GUST_SLOTS);
        world.dispose();
    });

    it('lifts the fires for a moment, throws jets from the card, and makes the fox spring', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 2);
        const rest = world.getState();
        world.onClear({ rows: [19, 18], lines: 2 });
        const thrown = thrownSince(world, world.time).filter((row) => !row.powder);
        // Jets from both edges of the card.
        expect(thrown.some((row) => row.at[0] < 0)).toBe(true);
        expect(thrown.some((row) => row.at[0] > 0)).toBe(true);
        expect(world.mind.dash).toBeGreaterThan(0);
        step(world, camera, 2, 2.5);
        const lifted = world.getState();
        expect(lifted.swell).toBeGreaterThan(0);
        expect(sum(lifted.curtains)).toBeGreaterThan(sum(rest.curtains));
        expect(lifted.storm).toBeGreaterThan(rest.storm);
        expect(lifted.fox.speed).toBeGreaterThan(rest.fox.speed);
        // ...and it passes.
        step(world, camera, 2.5, 30);
        const after = world.getState();
        expect(after.swell).toBeLessThan(lifted.swell * 0.01);
        expect(sum(after.curtains)).toBeCloseTo(sum(rest.curtains), 2);
        world.dispose();
    });

    it('shakes the trees\' loads loose from three lines up, when the gust reaches them', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onClear({ rows: [19], lines: 1 });
        expect(world.dumps).toHaveLength(0);
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        // One load for each tall framing tree (never more), each when the gust gets to it.
        expect(world.crowns.length).toBeGreaterThan(0);
        expect(world.crowns.length).toBeLessThanOrEqual(world.trees.filter((tree) => tree.frame).length);
        expect(world.dumps.length).toBeGreaterThan(0);
        expect(world.dumps.length).toBeLessThanOrEqual(world.crowns.length);
        world.dumps.forEach((dump) => {
            expect(dump.time).toBeGreaterThan(world.time);
            expect(world.crowns).toContain(dump.crown);
        });
        const last = Math.max(...world.dumps.map((dump) => dump.time));
        const before = world.counts.sparks;
        step(world, camera, 1, last + 0.1);
        expect(world.dumps).toHaveLength(0);
        expect(world.counts.sparks).toBeGreaterThan(before);
        // Powder, from up in the crowns.
        const fallen = thrownSince(world, 1.0001).filter((row) => row.powder);
        expect(fallen.some((row) => row.at[1] > 3)).toBe(true);
        world.dispose();
    });

    it('fires the row beams at the cleared rows\' heights, and only with a board on screen', () => {
        const { world, camera } = makeWorld();
        const { rows, frame: beam } = world.beams.uniforms;
        // No live layout (menus, the meditation mode): the gust runs, the beams stay dark.
        frame(world, camera, 3, 0);
        world.onClear({ rows: [19], lines: 1 });
        expect(world.counts.clears).toBe(1);
        expect(beam.value.w).toBe(0);
        const layout = fallbackLayout(1600, 900);
        world.setLayout(layout, 1600 / 900);
        expect(world.getState().layoutLive).toBe(true);
        frame(world, camera, 4, 0);
        world.onClear({ rows: [19, 18], lines: 2 });
        const card = cardUnion(layout);
        const board = boardFor(layout, 0);
        expect(beam.value.x).toBeCloseTo(card.x0, 9);
        expect(beam.value.y).toBeCloseTo(card.x1, 9);
        expect(beam.value.z).toBe(4);
        expect(beam.value.w).toBeGreaterThan(0);
        // Row 19 is the floor row, row 18 the one above it; the other two strips stay unused.
        expect(rows.value.x).toBeCloseTo(boardPoint(board, 0.5, 19).y, 9);
        expect(rows.value.y).toBeCloseTo(boardPoint(board, 0.5, 18).y, 9);
        expect(rows.value.x).toBeGreaterThan(rows.value.y);
        expect(rows.value.z).toBeLessThan(0);
        expect(rows.value.w).toBeLessThan(0);
        // More lines hit harder.
        const two = beam.value.w;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(beam.value.w).toBeGreaterThan(two);
        expect(rows.value.w).toBeCloseTo(boardPoint(board, 0.5, 16).y, 9);
        // A new session parks them; the layout going away switches them off again.
        world.resetSession();
        expect(beam.value.w).toBe(0);
        world.setLayout(null);
        expect(world.getState().layoutLive).toBe(false);
        world.onClear({ rows: [19], lines: 1 });
        expect(beam.value.w).toBe(0);
        world.dispose();
    });

    it('spins a wheel of sparks round the card on a T-spin', () => {
        const plain = makeWorld();
        const spun = makeWorld();
        for (const { world, camera } of [plain, spun]) step(world, camera, 0, 1);
        plain.world.onClear({ rows: [19, 18], lines: 2 });
        spun.world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        expect(spun.world.counts.sparks).toBeGreaterThan(plain.world.counts.sparks);
        expect(spun.world.storm).toBeGreaterThan(plain.world.storm);
        plain.world.dispose();
        spun.world.dispose();
    });
});

describe('WinterWorld: four lines', () => {
    it('holds the night\'s breath, then opens the sky: the surge, the pounce and the fox of light', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        const rest = world.getState();
        const restShafts = world.getPostState().shafts;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.counts.quads).toBe(1);
        const opens = 1 + HUSH_HOLD;
        // Everything is set for the moment the hush ends.
        expect(world.spiritAt).toBeGreaterThanOrEqual(opens);
        expect(world.spiritAt).toBeLessThan(opens + 2);
        expect(world.u.flare.value.x).toBeCloseTo(opens, 9);
        expect(world.u.gustA[0].value.z).toBeCloseTo(opens, 9);
        expect(world.dumps.length).toBeGreaterThan(0);
        // ── The hush: every light sinks, and nothing has happened yet ──
        step(world, camera, 1, 1 + HUSH_HOLD * 0.8, 1 / 120);
        expect(world.u.breath.value).toBeLessThan(0.5);
        expect(world.getState().breath).toBe(world.u.breath.value);
        expect(world.surge).toBe(0);
        expect(world.mind.mode).not.toBe('pounce');
        expect(world.getPostState().shafts).toBeLessThan(restShafts);
        // ── Then: the surge, and the fox pounces ──
        step(world, camera, world.time, opens + 0.05, 1 / 120);
        expect(world.surge).toBeGreaterThan(0.5);
        expect(world.u.surge.value).toBe(world.surge);
        expect(world.mind.mode).toBe('pounce');
        expect(world.getState().fox.clip).toBe('Pounce');
        step(world, camera, world.time, opens + 0.5);
        expect(world.u.breath.value).toBeGreaterThan(0.8);
        expect(sum(world.getState().curtains)).toBeGreaterThan(sum(rest.curtains) + 1);
        // It leaves the snow, and lands with a burst: a ring from where it comes down.
        let highest = 0;
        const rings = world.ringCursor;
        const { sparks } = world.counts;
        for (let t = world.time; t < opens + FOX_CLIPS.Pounce + 0.2; t += 1 / 60) {
            frame(world, camera, t + 1 / 60, 1 / 60);
            highest = Math.max(highest, world.mind.pose.lift);
        }
        expect(highest).toBeGreaterThan(0.2);
        expect(world.mind.pose.lift).toBe(0);
        expect(world.ringCursor).toBeGreaterThan(rings);
        expect(world.counts.sparks).toBeGreaterThan(sparks);
        expect(world.mind.mode).toBe('gait');
        // ── The fox of light crosses the sky, and is gone ──
        expect(world.u.spirit.value.z).toBeGreaterThan(0);
        const bearings = [];
        let brightest = 0;
        for (const k of [0.3, 0.5, 0.7, 0.9]) {
            expect(world.spiritAt + SPIRIT_RUN * k).toBeGreaterThan(world.time);
            step(world, camera, world.time, world.spiritAt + SPIRIT_RUN * k);
            bearings.push(world.u.spirit.value.x);
            brightest = Math.max(brightest, world.getState().spirit);
            expect(world.u.spirit.value.z).toBe(world.getState().spirit);
            // The sky is lit under the very bearing the fox of light's body is drawn at.
            const along = (world.time - world.spiritAt) / SPIRIT_RUN;
            expect(world.u.spirit.value.x).toBeCloseTo(Math.tan(spiritPath(along).bearing), 9);
        }
        expect(brightest).toBeGreaterThan(0.9);
        // Left to right.
        for (let i = 1; i < bearings.length; i++) expect(bearings[i]).toBeGreaterThan(bearings[i - 1]);
        expect(bearings[0]).toBeLessThan(0);
        expect(bearings[bearings.length - 1]).toBeGreaterThan(0);
        step(world, camera, world.time, world.spiritAt + SPIRIT_RUN + 0.1);
        expect(world.getState().spirit).toBe(0);
        // ── And the surge cools ──
        step(world, camera, world.time, world.time + 40);
        expect(world.surge).toBeLessThan(0.01);
        expect(sum(world.getState().curtains)).toBeCloseTo(sum(rest.curtains), 1);
        world.dispose();
    });

    it('treats a perfect clear as one, whatever its lines, and harder', () => {
        const four = makeWorld();
        const perfect = makeWorld();
        for (const { world, camera } of [four, perfect]) step(world, camera, 0, 1);
        four.world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        perfect.world.onClear({ rows: [19], lines: 1, perfect: true });
        expect(perfect.world.counts.quads).toBe(1);
        expect(perfect.world.spiritAt).toBe(four.world.spiritAt);
        for (const { world, camera } of [four, perfect]) step(world, camera, 1, 1 + HUSH_HOLD + 0.1, 1 / 120);
        expect(perfect.world.surge).toBeGreaterThan(four.world.surge);
        expect(perfect.world.mind.mode).toBe('pounce');
        four.world.dispose();
        perfect.world.dispose();
    });

    it('does not forget a clear that arrives while the night still holds its breath', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        frame(world, camera, 1 + HUSH_HOLD * 0.5, HUSH_HOLD * 0.5);
        world.onClear({ rows: [19], lines: 1 });
        step(world, camera, world.time, 1 + HUSH_HOLD + 0.2, 1 / 120);
        // The four lines' surge, pounce and fox of light all still came.
        expect(world.surge).toBeGreaterThan(0.5);
        expect(world.swell).toBeGreaterThan(0);
        expect(world.mind.mode).toBe('pounce');
        expect(world.spiritAt).toBeGreaterThan(1);
        expect(world.counts.clears).toBe(2);
        expect(world.counts.quads).toBe(1);
        world.dispose();
    });
});

describe('WinterWorld: the chain', () => {
    it('burns as brightly as the combo says, sheet after sheet, and sinks when it breaks', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 2);
        const rest = world.getState();
        const restAir = { halo: world.u.halo.value, gale: world.u.gale.value, exposure: world.getPostState().exposure };
        expect(rest.power).toBe(0);
        expect(world.u.power.value).toBe(0);
        world.onCombo(5);
        expect(world.getState().combo).toBe(5);
        // It rises toward the combo's charge and never past it.
        let previous = 0;
        for (let t = 2; t < 4; t += 0.25) {
            step(world, camera, t, t + 0.25);
            const { power } = world.getState();
            expect(power).toBeGreaterThan(previous);
            expect(power).toBeLessThanOrEqual(powerForCombo(5));
            previous = power;
        }
        step(world, camera, 4, 12);
        const lit = world.getState();
        expect(lit.power).toBeCloseTo(powerForCombo(5), 3);
        expect(world.u.power.value).toBe(lit.power);
        // Every sheet burns at least as brightly as at rest, and all of them together far more.
        lit.curtains.forEach((energy, i) => {
            expect(energy, `sheet ${i}`).toBeGreaterThanOrEqual(rest.curtains[i] - 1e-9);
        });
        expect(sum(lit.curtains)).toBeGreaterThan(sum(rest.curtains) * 2);
        expect(world.u.curtains.value.toArray()).toEqual(lit.curtains);
        // The ring round the moon, the wind, the fox and its coat all rise with it.
        expect(world.u.halo.value).toBeGreaterThan(restAir.halo);
        expect(world.u.gale.value).toBeGreaterThan(restAir.gale);
        expect(lit.fox.glow).toBeGreaterThan(0.3);
        expect(world.u.foxGlow.value).toBe(lit.fox.glow);
        expect(lit.fox.speed).toBeGreaterThan(rest.fox.speed);
        // The twilight has turned toward the fires' night: the lens opens.
        expect(world.getPostState().exposure).toBeGreaterThan(restAir.exposure);
        const hour = HOURS[0];
        const zenith = world.u.zenith.value.toArray();
        const between = (c, k) => (c - hour.calm.zenith[k]) / (hour.lit.zenith[k] - hour.calm.zenith[k]);
        zenith.forEach((c, k) => {
            expect(between(c, k)).toBeGreaterThan(0.3);
            expect(between(c, k)).toBeLessThanOrEqual(1 + 1e-9);
        });
        // A longer chain burns brighter still.
        world.onCombo(12);
        step(world, camera, 12, 20);
        expect(world.getState().power).toBeGreaterThan(lit.power);
        expect(sum(world.getState().curtains)).toBeGreaterThan(sum(lit.curtains));
        // The chain breaks: the fires sink back, slower than they rose.
        world.onCombo(0);
        expect(world.getState().combo).toBe(0);
        step(world, camera, 20, 21);
        expect(world.getState().power).toBeGreaterThan(0.2);
        step(world, camera, 21, 45);
        const sunk = world.getState();
        expect(sunk.power).toBeLessThan(0.01);
        expect(sum(sunk.curtains)).toBeCloseTo(sum(rest.curtains), 1);
        expect(sunk.fox.glow).toBeLessThan(0.05);
        world.dispose();
    });

    it('reads a combo however it is reported', () => {
        const { world } = makeWorld();
        for (const [given, combo] of [[3.4, 3], ['4', 4], [-2, 0], [NaN, 0], [undefined, 0], [null, 0]]) {
            world.onCombo(given);
            expect(world.combo, String(given)).toBe(combo);
        }
        world.dispose();
    });

    it('can be held at a charge for a capture, and given back to the chain', () => {
        const { world, camera } = makeWorld();
        world.holdPower(0.7);
        frame(world, camera, 1, 0);
        // (A frame of no length snaps to it: a capture sees it at once.)
        expect(world.getState().power).toBe(0.7);
        world.holdPower(5);
        frame(world, camera, 1, 0);
        expect(world.getState().power).toBe(1);
        world.holdPower(null);
        step(world, camera, 1, 30);
        expect(world.getState().power).toBeLessThan(0.01);
        world.dispose();
    });
});

describe('WinterWorld: the hours', () => {
    it('turns the hour with the level and comes back round', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 0.5);
        expect(world.getState().hour).toBe(HOURS[0].name);
        for (let level = 1; level <= HOURS.length * 2 + 1; level++) {
            world.levelUp(level, { silent: true });
            expect(world.getState().level).toBe(level);
            expect(world.getState().hour, `level ${level}`).toBe(HOURS[(level - 1) % HOURS.length].name);
        }
        // Nonsense is the first level.
        for (const bad of [0, -3, NaN, undefined, 'x']) {
            world.levelUp(bad, { silent: true });
            expect(world.getState().level).toBe(1);
            expect(world.getState().hour).toBe(HOURS[0].name);
        }
        world.dispose();
    });

    it('eases the sky into the new hour, or snaps to it when told to be silent', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 0.5);
        const key = (name) => (name === 'moon' ? 'moonCol' : name);
        const read = () => HOUR_KEYS.map((name) => world.u[key(name)].value.toArray());
        const calm = (hour) => HOUR_KEYS.map((name) => hour.calm[name]);
        /** The largest difference in any channel of any of the hour's colours. */
        const far = (a, b) => Math.max(...a.flatMap((colour, i) => colour.map((c, k) => Math.abs(c - b[i][k]))));
        expect(far(read(), calm(HOURS[0]))).toBeLessThan(1e-9);
        // Aloud: the sky is strummed and the fox answers, and the colours take their time.
        const { sparks } = world.counts;
        world.levelUp(2);
        expect(world.u.flare.value.x).toBe(world.time);
        expect(world.u.flare.value.y).toBeGreaterThan(0);
        expect(world.counts.sparks).toBeGreaterThan(sparks);
        frame(world, camera, 0.5 + 1 / 60, 1 / 60);
        const start = far(read(), calm(HOURS[1]));
        expect(start).toBeGreaterThan(far(calm(HOURS[0]), calm(HOURS[1])) * 0.5);
        step(world, camera, world.time, 12);
        expect(far(read(), calm(HOURS[1]))).toBeLessThan(start * 0.01);
        expect(world.u.stars.value).toBeCloseTo(HOURS[1].calm.stars, 3);
        // Silent (a restored session): there at once, with no flare.
        const flare = world.u.flare.value.clone();
        world.levelUp(4, { silent: true });
        frame(world, camera, 12, 0);
        expect(far(read(), calm(HOURS[3]))).toBeLessThan(1e-9);
        expect(world.u.flare.value.toArray()).toEqual(flare.toArray());
        world.dispose();
    });
});

describe('WinterWorld: seek, replay and a new session', () => {
    /** A fixed script from a seek: locks, a chain, a four-line clear. */
    function replay(world, camera) {
        world.seek(5);
        frame(world, camera, 5, 0);
        world.onLock({
            u: 0.7, rows: [12], hardDrop: true, color: '#00a8ff',
        });
        world.onCombo(3);
        step(world, camera, 5, 6, 1 / 120);
        world.onLock({ u: 0.2, rows: [15, 14], color: '#ff9ccf' });
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(world, camera, 6, 9.5, 1 / 120);
        world.levelUp(2);
        step(world, camera, 9.5, 11, 1 / 120);
        const { u } = world;
        return {
            state: world.getState(),
            post: JSON.parse(JSON.stringify(world.getPostState())),
            // Every slot of the pools that is in use (a parked slot's stale numbers are never read).
            pools: liveRows(world.sparks, ['aBirth', 'aVel', 'aTint', 'aKind'], (row) => row[3] > -100),
            prints: liveRows(world.prints, ['aMade', 'aPrint'], (row) => row[0] > -1000),
            slots: [...u.ringA, ...u.ringC, ...u.gustA, ...u.skyA, ...u.skyC].map((slot) => slot.value.toArray()),
            uniforms: ['time', 'power', 'surge', 'breath', 'gale', 'auroraRun', 'halo', 'foxGlow', 'foxEyes', 'stars']
                .map((k) => u[k].value),
            vectors: ['windRun', 'curtains', 'foxPos', 'spirit', 'flare', 'zenith', 'fire']
                .map((k) => u[k].value.toArray()),
        };
    }

    it('replays to the same state after a seek, in a fresh world', () => {
        const run = () => {
            const { world, camera } = makeWorld();
            const result = replay(world, camera);
            world.dispose();
            return result;
        };
        const first = run();
        expect(first.state.counts.locks).toBe(2);
        expect(first.state.counts.quads).toBe(1);
        expect(first.state.counts.prints).toBeGreaterThan(0);
        expect(run()).toEqual(first);
    });

    it('replays to the same state in the same world: a seek forgets everything in flight', () => {
        const { world, camera } = makeWorld();
        const first = replay(world, camera);
        // Leave it in the middle of things, then seek and play the same script again.
        world.onCombo(9);
        world.onClear({ rows: [19, 18, 17], lines: 3, tspin: true });
        step(world, camera, 11, 13.3);
        world.onGameOver();
        step(world, camera, 13.3, 14);
        expect(replay(world, camera)).toEqual(first);
        world.dispose();
    });

    it('starts a seek from the world\'s clock alone', () => {
        const { world, camera } = makeWorld();
        world.onCombo(4);
        world.levelUp(3);
        world.onLock({ u: 0.4, color: '#ffe2a0' });
        step(world, camera, 0, 3);
        world.seek(40);
        expect(world.time).toBe(40);
        const state = world.getState();
        expect(state.combo).toBe(0);
        expect(state.level).toBe(1);
        expect(state.hour).toBe(HOURS[0].name);
        const counted = ['locks', 'clears', 'quads', 'sparks', 'flicks', 'prints'];
        expect(Object.keys(state.counts)).toEqual(expect.arrayContaining(counted));
        Object.keys(state.counts).forEach((name) => expect(state.counts[name], name).toBe(0));
        expect(world.flicks).toHaveLength(0);
        expect(world.prints.pressed).toBe(0);
        expect(thrownSince(world, -50)).toHaveLength(0);
        world.u.ringA.forEach((slot) => expect(slot.value.w).toBe(0));
        world.u.skyA.forEach((slot) => expect(slot.value.z).toBe(0));
        // The wind and the rays have run as long as the clock says: two seeks agree.
        const wind = [...world.windRun];
        expect(wind[0]).toBeGreaterThan(0);
        world.seek(80);
        expect(world.windRun[0]).toBeCloseTo(wind[0] * 2, 9);
        expect(world.auroraRun).toBeGreaterThan(0);
        // Never before the beginning.
        world.seek(-5);
        expect(world.time).toBe(0);
        world.dispose();
    });

    it('keeps the clock, the wind and the prints through a new session, and drops the chain', () => {
        const { world, camera } = makeWorld();
        world.onCombo(6);
        world.levelUp(3, { silent: true });
        step(world, camera, 0, 6);
        world.onLock({ u: 0.6, rows: [14], color: '#6de0ff' });
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        step(world, camera, 6, 6.1);
        const before = world.getState();
        const kept = {
            wind: [...world.windRun],
            aurora: world.auroraRun,
            pressed: world.prints.pressed,
            prints: Array.from(data(world.prints, 'aMade')),
            fox: [world.mind.s, world.mind.phase, world.mind.mode, world.mind.clip, world.mind.glow],
            glow: world.u.glow.value.toArray(),
        };
        expect(kept.pressed).toBeGreaterThan(3);
        expect(before.power).toBeGreaterThan(0.5);
        // (The third hour's last light is not the first's: an ease and a snap can be told apart.)
        const first = HOURS[0].calm.glow;
        const apart = Math.max(...kept.glow.map((c, k) => Math.abs(c - first[k])));
        expect(apart).toBeGreaterThan(0.1);

        world.resetSession();
        const after = world.getState();
        // ── Kept: nothing jumps ──
        expect(after.time).toBe(before.time);
        expect(world.windRun).toEqual(kept.wind);
        expect(world.auroraRun).toBe(kept.aurora);
        expect(world.prints.pressed).toBe(kept.pressed);
        expect(Array.from(data(world.prints, 'aMade'))).toEqual(kept.prints);
        expect(after.power).toBe(before.power);
        expect(after.curtains).toEqual(before.curtains);
        // The fox is left where and as it is: its place, its gait, its clip, its coat's light.
        expect([world.mind.s, world.mind.phase, world.mind.mode, world.mind.clip, world.mind.glow]).toEqual(kept.fox);
        // ── Dropped: the chain, the level, and everything in flight ──
        expect(after.combo).toBe(0);
        expect(after.level).toBe(1);
        expect(after.hour).toBe(HOURS[0].name);
        expect(world.flicks).toHaveLength(0);
        expect(world.dumps).toHaveLength(0);
        expect(thrownSince(world, -50)).toHaveLength(0);
        world.u.ringA.forEach((slot) => expect(slot.value.w).toBe(0));
        world.u.gustA.forEach((slot) => expect(slot.value.w).toBe(0));
        world.u.skyA.forEach((slot) => expect(slot.value.z).toBe(0));
        expect(world.u.flare.value.y).toBe(0);
        expect(world.spiritAt).toBeLessThan(0);
        // A frame later nothing has snapped: the fires and the hour's colours have barely moved.
        frame(world, camera, 6.1 + 1e-3, 1e-3);
        expect(world.getState().power).toBeCloseTo(before.power, 2);
        world.u.glow.value.toArray().forEach((c, k) => expect(Math.abs(c - kept.glow[k])).toBeLessThan(apart * 0.02));
        expect(world.u.breath.value).toBeCloseTo(before.breath, 1);
        // The pounce that was pending is not played into the new run.
        step(world, camera, world.time, 6.1 + HUSH_HOLD + 0.2, 1 / 120);
        expect(world.mind.mode).not.toBe('pounce');
        expect(world.counts.quads).toBe(0);
        // The fires sink on their own, and the first hour's colours ease back in. (Twenty
        // seconds on the clock is still inside that hour's rest: later it would be melting into
        // the next by itself, which winter-hours.test.js covers.)
        expect(world.getState().power).toBeLessThan(before.power);
        expect(world.getState().power).toBeGreaterThan(before.power * 0.5);
        step(world, camera, world.time, world.time + 20);
        expect(world.getState().power).toBeLessThan(0.01);
        world.u.glow.value.toArray().forEach((c, k) => expect(c).toBeCloseTo(first[k], 3));
        // The fox goes on from where it was, leaving more prints behind the old ones.
        expect(world.prints.pressed).toBeGreaterThan(kept.pressed);
        world.dispose();
    });

    it('curls the fox up when the run is over, and wakes it for the next', () => {
        const { world, camera } = makeWorld();
        world.onCombo(4);
        step(world, camera, 0, 4);
        world.onGameOver();
        expect(world.getState().combo).toBe(0);
        expect(world.mind.asleep).toBe(true);
        step(world, camera, 4, 8);
        const asleep = world.getState().fox;
        expect(asleep.mode).toBe('sleep');
        expect(asleep.clip).toBe('CurlSleep');
        expect(asleep.speed).toBeLessThan(0.01);
        const lay = [asleep.x, asleep.z];
        const { pressed } = world.prints;
        step(world, camera, 8, 20);
        // It lies where it lay, and leaves no prints.
        expect([world.getState().fox.x, world.getState().fox.z]).toEqual(lay);
        expect(world.prints.pressed).toBe(pressed);
        world.resetSession();
        expect(world.mind.asleep).toBe(false);
        frame(world, camera, 20 + 1 / 60, 1 / 60);
        const woken = world.getState().fox;
        expect(woken.mode).not.toBe('sleep');
        // It wakes where it lay.
        expect(Math.hypot(woken.x - lay[0], woken.z - lay[1])).toBeLessThan(0.1);
        // ...stretches, and is on its round again.
        expect(woken.clip).toBe('Stretch');
        step(world, camera, world.time, world.time + FOX_CLIPS.Stretch + 3);
        expect(world.getState().fox.mode).toBe('gait');
        expect(world.prints.pressed).toBeGreaterThan(pressed);
        world.dispose();
    });

    // (Once a new session reset the fox's mind: it then woke by cross-fading from the first frame
    // of its run, and a sleeping fox snapped to its feet.)
    it('wakes the fox out of the clip it was sleeping in', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 2);
        world.onGameOver();
        step(world, camera, 2, 8);
        expect(world.mind.clip).toBe('CurlSleep');
        world.resetSession();
        frame(world, camera, 8 + 1 / 60, 1 / 60);
        const { pose } = world.mind;
        world.dispose();
        expect(pose.clip).toBe('Stretch');
        expect(pose.blend).toBeLessThan(1);
        expect(pose.from).toBe('CurlSleep');
    });

    it('leaves a fox that had stopped to look about doing what it was doing', () => {
        const { world, camera } = makeWorld();
        let t = 0;
        // (It pulls up, turns to face the viewer, and only then chooses what to do.)
        while (!world.mind.act && t < 60) {
            step(world, camera, t, t + 0.25);
            t += 0.25;
        }
        const idle = { mode: world.mind.mode, clip: world.mind.clip, act: world.mind.act };
        world.resetSession();
        const after = { mode: world.mind.mode, clip: world.mind.clip, act: world.mind.act };
        world.dispose();
        // (At rest the fox does stop within a minute.)
        expect(idle.mode).toBe('idle');
        expect(idle.clip).not.toBe('Run');
        expect(after).toEqual(idle);
    });

    it('leaves a fox that had only just pulled up to turn and face the viewer', () => {
        const { world, camera } = makeWorld();
        let t = 0;
        while (world.mind.mode !== 'idle' && t < 60) {
            step(world, camera, t, t + 1 / 60);
            t += 1 / 60;
        }
        expect(world.mind.mode).toBe('idle');
        expect(world.mind.act).toBeNull();
        const facing = world.mind.pose.heading;
        world.resetSession();
        expect(world.mind.mode).toBe('idle');
        expect(world.mind.pose.heading).toBe(facing);
        // It goes on turning, and then does what it stopped for.
        step(world, camera, t, t + 3);
        expect(world.mind.act).not.toBeNull();
        expect(world.mind.pose.heading).not.toBe(facing);
        world.dispose();
    });
});

describe('WinterWorld: the fox on the snow', () => {
    it('tells its coat how far its eyes are shut: a blink awake, shut asleep', () => {
        const { world, camera } = makeWorld();
        expect(world.u.foxEyes.value).toBe(0);
        let blinked = 0;
        for (let t = 0; t < 12; t += 1 / 60) {
            frame(world, camera, t + 1 / 60, 1 / 60);
            expect(world.u.foxEyes.value).toBe(world.mind.pose.eyes);
            blinked = Math.max(blinked, world.u.foxEyes.value);
        }
        expect(blinked).toBeGreaterThan(0.5);
        world.onGameOver();
        step(world, camera, world.time, world.time + 5);
        expect(world.mind.asleep).toBe(true);
        expect(world.u.foxEyes.value).toBe(1);
        // A new run: they open again.
        world.resetSession();
        let opened = 1;
        for (let i = 0; i < 30; i++) {
            frame(world, camera, world.time + 1 / 60, 1 / 60);
            opened = Math.min(opened, world.u.foxEyes.value);
        }
        expect(opened).toBe(0);
        world.dispose();
    });

    it('has the fox look to where a piece\'s sparks leave, and round at the viewer when the sky is strummed', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 2);
        expect(world.mind.attending).toBeNull();
        world.onLock({ u: 0.5, rows: [19], color: '#ffe2a0' });
        const lock = world.mind.attending;
        // Somewhere by the board, for a moment...
        expect([lock.x, lock.y, lock.z].every(finite)).toBe(true);
        expect(lock.until).toBeGreaterThan(world.time);
        expect(lock.until).toBeLessThan(world.time + 5);
        expect(lock.weight).toBeGreaterThan(0);
        expect(lock.weight).toBeLessThanOrEqual(1);
        // ...and a longer, harder look for a hard drop.
        world.onLock({
            u: 0.5, rows: [19], color: '#ffe2a0', hardDrop: true,
        });
        expect(world.mind.attending.weight).toBeGreaterThan(lock.weight);
        expect(world.mind.attending.until).toBeGreaterThan(lock.until);
        // Its head does turn for it: not where it would have been carried untold.
        const { world: untold, camera: other } = makeWorld();
        step(untold, other, 0, 2.5);
        step(world, camera, 2, 2.5);
        const turned = Math.hypot(
            world.mind.pose.lookYaw - untold.mind.pose.lookYaw,
            world.mind.pose.lookPitch - untold.mind.pose.lookPitch,
        );
        expect(turned).toBeGreaterThan(0.05);
        expect([world.mind.pose.x, world.mind.pose.z]).toEqual([untold.mind.pose.x, untold.mind.pose.z]);
        untold.dispose();
        // A new level: it looks at whoever is playing.
        step(world, camera, world.time, world.time + 4);
        world.levelUp(2);
        expect(world.mind.attending).toMatchObject({ x: EYE.x, y: EYE.y, z: EYE.z });
        expect(world.mind.attending.until).toBeGreaterThan(world.time);
        // Told of a level in silence (a restored game), it is not disturbed.
        const told = world.mind.attending;
        world.levelUp(3, { silent: true });
        expect(world.mind.attending).toBe(told);
        world.dispose();
    });

    it('throws the snow up where the fox hunts: a puff as it lands, scrapes as it digs, a shower as it shakes', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 2);
        const { mind } = world;
        mind.rehearse(MOUSING, world.time);
        const rings = world.ringCursor;
        const emit = vi.spyOn(world.sparks, 'emit');
        const thrown = { land: [], dig: [], shake: [] };
        const length = MOUSING.reduce((total, clip) => total + FOX_CLIPS[clip], 0);
        for (let t = world.time; t < 2 + length; t += 1 / 60) {
            const calls = emit.mock.calls.length;
            const { sparks } = world.counts;
            frame(world, camera, t + 1 / 60, 1 / 60);
            const events = mind.events.map((event) => event.type);
            const emitted = emit.mock.calls.slice(calls).map(([options]) => options);
            const where = `${mind.clip} at ${mind.clipTime.toFixed(2)} s`;
            // Nothing is thrown but by something the fox did: one throw for each thing it did.
            expect(emitted.length, where).toBe(events.length);
            events.forEach((type, i) => {
                expect(Object.keys(thrown), where).toContain(type);
                thrown[type].push(emitted[i]);
            });
            // It is snow, not fire, it flies from where the fox is, and all of it is counted.
            emitted.forEach((options) => {
                expect(options.powder, where).toBe(true);
                expect(Math.hypot(options.from[0] - mind.pose.x, options.from[2] - mind.pose.z), where).toBeLessThan(1);
                expect(options.time, where).toBe(world.time);
            });
            const counted = emit.mock.results.slice(calls).reduce((total, result) => total + result.value, 0);
            expect(world.counts.sparks - sparks, where).toBe(counted);
        }
        emit.mockRestore();
        expect(thrown.land).toHaveLength(1);
        expect(thrown.shake).toHaveLength(1);
        expect(thrown.dig.length).toBeGreaterThanOrEqual(4);
        // What its forepaws scrape out flies back between its hind legs: from before its middle,
        // thrown behind it and up.
        const ahead = [Math.sin(mind.pose.heading), Math.cos(mind.pose.heading)];
        thrown.dig.forEach((options) => {
            const fromMiddle = [options.from[0] - mind.pose.x, options.from[2] - mind.pose.z];
            expect(fromMiddle[0] * ahead[0] + fromMiddle[1] * ahead[1]).toBeGreaterThan(0);
            expect(options.toward[0] * ahead[0] + options.toward[2] * ahead[1]).toBeLessThan(0);
            expect(options.toward[1]).toBeGreaterThan(0);
        });
        // The leap of its hunt is not the pounce of four lines: no ring goes out from where it lands.
        expect(world.ringCursor).toBe(rings);
        expect(world.mind.pose.lift).toBe(0);
        world.dispose();
    });

    // (A regression: a fox told between two frames to shake itself — a capture that opens on the
    // shake — shook dry. What begins between steps is told with the next one.)
    it('throws the snow from a shake that began between two frames', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 2);
        const emit = vi.spyOn(world.sparks, 'emit');
        world.mind.rehearse(['Shake'], world.time);
        expect(emit).not.toHaveBeenCalled();
        frame(world, camera, world.time + 1 / 60, 1 / 60);
        const thrown = emit.mock.calls.map(([options]) => options);
        expect(thrown).toHaveLength(1);
        expect(thrown[0].powder).toBe(true);
        const { pose } = world.mind;
        expect(Math.hypot(thrown[0].from[0] - pose.x, thrown[0].from[2] - pose.z)).toBeLessThan(1);
        // Once: the frames after it throw nothing more.
        step(world, camera, world.time, world.time + 0.5);
        expect(emit).toHaveBeenCalledTimes(1);
        emit.mockRestore();
        world.dispose();
    });

    // (The sparks the tail strikes leave from the tip of the tail the body carries, wherever
    // that is: beside a sitting fox, not a fixed point behind it.)
    it('strikes its sparks from where its tail is', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 2);
        world.mind.rehearse(['Sit'], world.time);
        step(world, camera, world.time, world.time + 3);
        const { mind } = world;
        const emit = vi.spyOn(world.sparks, 'emit');
        // A ring of powder reaches it (as a lock queues one): its tail flicks and strikes.
        world.flicks.push({ time: world.time, rgb: [1, 0.8, 0.5], strength: 1 });
        frame(world, camera, world.time + 1 / 60, 1 / 60);
        const struck = emit.mock.calls.map(([options]) => [...options.from]);
        emit.mockRestore();
        expect(world.counts.flicks).toBe(1);
        expect(struck.length).toBeGreaterThan(0);
        const tip = mind.tail();
        struck.forEach((from) => {
            expect(Math.hypot(from[0] - tip[0], from[1] - tip[1], from[2] - tip[2])).toBeLessThan(0.05);
        });
        // Beside it, on the side it has its tail: a good way off the line straight behind it.
        const { x, z, heading } = mind.pose;
        const beside = (tip[0] - x) * Math.cos(heading) - (tip[2] - z) * Math.sin(heading);
        expect(Math.sign(beside)).toBe(mind.side);
        expect(Math.abs(beside)).toBeGreaterThan(0.2);
        world.dispose();
    });

    it('kicks the snow up behind a running fox, and not behind a trotting one', () => {
        const kicked = (combo) => {
            const { world, camera } = makeWorld();
            if (combo) world.onCombo(combo);
            step(world, camera, 0, 4);
            const emit = vi.spyOn(world.sparks, 'emit');
            const { prints } = world.counts;
            step(world, camera, 4, 5);
            const puffs = emit.mock.calls.map(([options]) => options).filter((options) => options.powder);
            const pressed = world.counts.prints - prints;
            const { speed, pose } = world.mind;
            emit.mockRestore();
            world.dispose();
            return {
                puffs, pressed, speed, heading: pose.heading,
            };
        };
        const trot = kicked(0);
        expect(trot.pressed).toBeGreaterThan(0);
        expect(trot.puffs).toHaveLength(0);
        const run = kicked(6);
        expect(run.speed).toBeGreaterThan(trot.speed * 2);
        // A puff a footfall, low over the snow.
        expect(run.pressed).toBeGreaterThan(trot.pressed);
        expect(run.puffs).toHaveLength(run.pressed);
        run.puffs.forEach((options) => {
            expect(options.n).toBe(1);
            expect(options.toward[1]).toBeGreaterThan(0);
        });
    });
});

describe('WinterWorld: the frame\'s shape', () => {
    /** The instanced mesh the first framing tree is drawn by, and its matrix there. */
    function firstTree(world) {
        const [fraction, , , kind] = FRAME_TREES[0];
        // (A framing tree is drawn no finer than the tier's coarsest allowed mesh.)
        const lod = Math.max(world.trees[0].lod, world.tier.ghostLod);
        const mesh = drawables(world.parts.trees).find((m) => m.userData.key === `${kind}:${lod}`);
        const m = mesh.instanceMatrix.array;
        return {
            mesh, fraction, x: m[12], z: m[14], scale: m[5],
        };
    }

    it('re-plants for an upright screen: the trees, their shadows, the moon and the fox\'s round', () => {
        for (const quality of ['Minimal', TIER]) {
            const { world, camera } = makeWorld(quality);
            const wide = {
                trees: world.trees,
                x: world.trees[0].x,
                moon: world.u.moonDir.value.x,
                round: world.mind.round.length,
                shadow: world.u.shadowTex.version,
                mask: Array.from(world.u.shadowTex.image.data),
                heart: world.heart.x,
                glints: world.u.glintGrid.value,
                matrix: firstTree(world).mesh.instanceMatrix.version,
            };
            expect(firstTree(world).x).toBeCloseTo(wide.x, 4);
            expect(firstTree(world).z).toBeCloseTo(world.trees[0].z, 4);
            const drawn = firstTree(world);
            expect(drawn.scale).toBeCloseTo(world.trees[0].height / drawn.mesh.userData.height, 5);

            expect(() => world.setViewport(PORTRAIT[0], PORTRAIT[1], PORTRAIT[0] / PORTRAIT[1])).not.toThrow();
            expect(world.aspect).toBeCloseTo(PORTRAIT[0] / PORTRAIT[1], 12);
            expect(world.u.viewport.value.toArray()).toEqual(PORTRAIT);
            // The framing trees are drawn in toward the middle...
            expect(world.trees).not.toBe(wide.trees);
            expect(world.trees).toHaveLength(wide.trees.length);
            expect(Math.abs(world.trees[0].x)).toBeLessThan(Math.abs(wide.x));
            expect(Math.sign(world.trees[0].x)).toBe(Math.sign(firstTree(world).fraction));
            // ...and so are the instances the GPU draws.
            expect(firstTree(world).x).toBeCloseTo(world.trees[0].x, 4);
            expect(firstTree(world).mesh.instanceMatrix.version).toBeGreaterThan(wide.matrix);
            expect(sum(drawables(world.parts.trees).map((mesh) => mesh.count))).toBe(world.trees.length);
            // The moon stands nearer the middle, its shadows are drawn again...
            expect(world.u.moonDir.value.x).toBeLessThan(wide.moon);
            expect(world.u.moonDir.value.toArray()).toEqual(moonDirection(world.aspect));
            expect(world.u.shadowTex.version).toBeGreaterThan(wide.shadow);
            expect(Array.from(world.u.shadowTex.image.data)).not.toEqual(wide.mask);
            // ...the fox's round is narrower, and the events still have a board to aim at.
            expect(world.mind.round.length).toBeLessThan(wide.round);
            expect(world.layout.boards[0]).toBeTruthy();
            frame(world, camera, 1, 0);
            world.onLock({ u: 0.5, rows: [19], color: '#5df2a6' });
            world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
            step(world, camera, 1, 3);
            expect(world.getState().counts.locks).toBe(1);
            expect(world.u.ringA[0].value.toArray().every(finite)).toBe(true);
            expect(world.heart.x).toBeGreaterThan(0.5);
            expect(world.heart.x).toBeLessThan(1);

            // The same shape again changes nothing; a degenerate one is ignored.
            const { trees } = world;
            const { version } = world.u.shadowTex;
            world.setViewport(PORTRAIT[0] * 2, PORTRAIT[1] * 2, PORTRAIT[0] / PORTRAIT[1]);
            world.setViewport(0, 0, NaN);
            world.setLayout(null, -1);
            expect(world.trees).toBe(trees);
            expect(world.u.shadowTex.version).toBe(version);
            expect(world.u.viewport.value.toArray()).toEqual([PORTRAIT[0] * 2, PORTRAIT[1] * 2]);

            // Back to landscape through the layout's own aspect: as it was first planted.
            expect(() => world.setLayout(fallbackLayout(...LANDSCAPE), LANDSCAPE[0] / LANDSCAPE[1])).not.toThrow();
            expect(world.trees[0].x).toBeCloseTo(wide.x, 9);
            expect(firstTree(world).x).toBeCloseTo(wide.x, 4);
            expect(Array.from(world.u.shadowTex.image.data)).toEqual(wide.mask);
            expect(world.u.moonDir.value.x).toBeCloseTo(wide.moon, 12);
            expect(world.mind.round.length).toBeCloseTo(wide.round, 6);
            world.dispose();
        }
    });

    it('moves nothing between frames the plan holds at one width', () => {
        const { world } = makeWorld();
        const { trees } = world;
        const { version } = world.u.shadowTex;
        // (Wide frames stop spreading at the planned half width: 16:10 and 16:9 share it.)
        expect(moonDirection(16 / 10)).toEqual(moonDirection(16 / 9));
        world.setViewport(1920, 1200, 16 / 10);
        expect(world.aspect).toBe(16 / 10);
        expect(world.trees).toBe(trees);
        expect(world.u.shadowTex.version).toBe(version);
        world.dispose();
    });

    it('keeps the snow\'s sparkle a few pixels to a cell whatever the frame', () => {
        const { world } = makeWorld();
        const small = world.u.glintGrid.value;
        world.setViewport(3200, 1800, 16 / 9);
        expect(world.u.glintGrid.value).toBeGreaterThan(small * 1.5);
        world.setViewport(1600, 900, 16 / 9);
        expect(world.u.glintGrid.value).toBe(small);
        world.dispose();
    });

    it('aims at the solo board until a live layout says otherwise', () => {
        const { world } = makeWorld();
        expect(world.getState().layoutLive).toBe(false);
        expect(boardFor(world.layout, 0)).toBeTruthy();
        expect(cardUnion(world.layout)).toBeTruthy();
        const live = fallbackLayout(1600, 900);
        world.setLayout(live);
        expect(world.layout).toBe(live);
        expect(world.getState().layoutLive).toBe(true);
        // A resize does not throw the live rects away.
        world.setViewport(1280, 720, 16 / 9);
        expect(world.layout).toBe(live);
        world.setLayout(null);
        expect(world.getState().layoutLive).toBe(false);
        expect(boardFor(world.layout, 0)).toBeTruthy();
        world.dispose();
    });
});
