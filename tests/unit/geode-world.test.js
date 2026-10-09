import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GEODE_PARTS, GeodeWorld, REST_RIG, SPARK_DEPTH, SURGE_COOL, fovForAspect,
} from '../../src/themes/geode/geode-world.js';
import {
    CAVITY, CLEAR_SLOTS, CLEAR_TRAVEL, CROWN_COLORS, CROWN_RINGS, DEG, GEODEFIRE, GEODE_PALETTES, HUSH_HOLD,
    MINERALS, MINERAL_HOLD, MINERAL_PERIOD, PULSE_SLOTS, STORE_HOLD, STORE_MAX, STRIKE_SLOTS,
    WISP_SLOTS, WISP_TAIL, clearPassTime, crownForCombo, mineralDrift, paletteAt, pieceColor, powerForCombo,
} from '../../src/themes/geode/geode-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/geode/geode-quality.js';
import { boardPoint, cardUnion, fallbackLayout } from '../../src/themes/geode/geode-composition.js';
import { BEAM_ROWS, shardReach, wispPoint } from '../../src/themes/geode/geode-fx.js';

// Every test builds a whole world (a noise field, a plan, nine node materials): slow on a loaded machine.
vi.setConfig({ testTimeout: 30000 });

function makeWorld(quality = 'Low', {
    width = 1600, height = 900, live = true, capture = true, reduced = false,
} = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new GeodeWorld({ scene, quality, capture }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduced);
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
 * A pool's per-instance array. The crystals keep theirs CPU-side (`part.state`): their GPU copy
 * is interleaved, so the attribute's own array has another layout.
 */
function instanced(part, name) {
    const array = part.state?.[name] ?? part.geometry.getAttribute(name).array;
    return { array, count: array.length / 4 };
}

/** Slots of a pool whose timestamp (component 3 of `name`) says they have been used. */
function used(part, name) {
    const attribute = instanced(part, name);
    const out = [];
    for (let i = 0; i < attribute.count; i++) if (attribute.array[i * 4 + 3] > -50) out.push(i);
    return out;
}

/** Uniform slots whose timestamp (component `at`) says they are in use. */
const inUse = (slots, at) => slots.filter((slot) => slot.value.getComponent(at) > -50);

/** The heart rings born at `time`: each slot's place (birth, strength, reach) and colour. */
function ringsBornAt(world, time) {
    const out = [];
    world.u.pulseA.forEach((slot, i) => {
        if (slot.value.x === time) out.push({ place: slot.value, colour: world.u.pulseC[i].value });
    });
    return out;
}

/** One crystal's four numbers in a per-crystal state array: a colour and a time. */
const slotOf = (data, index) => Array.from(data.subarray(index * 4, index * 4 + 4));
const peakIn = (data, index) => Math.max(data[index * 4], data[index * 4 + 1], data[index * 4 + 2]);

/** The crystals with a flash set in `data`, the earliest first. */
function flashesIn(world, data) {
    const out = [];
    for (let i = 0; i < world.crystals.count; i++) {
        if (data[i * 4 + 3] > -50) out.push({ index: i, time: data[i * 4 + 3], peak: peakIn(data, i) });
    }
    return out.sort((a, b) => a.time - b.time);
}

/** The crystals a spark or a chime has told to flash (a strike's flash), the earliest first. */
const flashes = (world) => flashesIn(world, world.crystals.state.aFlash);

/** The crystals a wave has told to flare as it passes them (a release's flash), the earliest first. */
const flares = (world) => flashesIn(world, world.crystals.state.aRelease);

/**
 * The (up to two) moments at which a wave already on its way will pass a crystal and empty it,
 * the earlier first; Infinity where none is due.
 */
const cutsOf = (world, index) => [0, 3].map((k) => {
    const at = world.crystals.state.aAux[index * 4 + k];
    return at > 1e8 ? Infinity : at;
});

/** What every crystal holds at this moment. */
const heldNow = (world) => Array.from(
    { length: world.crystals.count },
    (_, i) => world.crystals.heldAt(i, world.time),
);

/** The crystals whose light is not what it was in `before`, each as a line of text. */
function changedSince(world, before) {
    const out = [];
    heldNow(world).forEach((held, k) => {
        if (Math.abs(held - before[k]) > 1e-5) out.push(`crystal ${k}: ${before[k]} -> ${held}`);
    });
    return out;
}

/** The drawn crystal that stands at a strike slot's place (a ripple leaves a crystal's own root). */
function crystalAt(world, place) {
    return world.list.findIndex((c) => c.x === place.x && c.y === place.y && c.z === place.z);
}

/** Where a crystal shows across the rest frame (fraction of the width): the point a spark is aimed by. */
function screenX(world, index, along = 0.7) {
    const c = world.list[index];
    return new THREE.Vector3(
        c.x + c.axis[0] * c.height * along,
        c.y + c.axis[1] * c.height * along,
        c.z + c.axis[2] * c.height * along,
    ).project(world.restCamera()).x * 0.5 + 0.5;
}

/** Every palette colour the world is showing, by key. */
function shownPalette(world) {
    const out = {
        fill: world.u.fill.value.toArray(),
        rock: world.u.rock.value.toArray(),
        druzy: world.u.druzy.value.toArray(),
    };
    world.u.bands.forEach((slot, i) => {
        out[`band${i}`] = slot.value.toArray();
    });
    world.u.minerals.forEach((slot, i) => {
        out[`m${i}`] = slot.value.toArray();
    });
    return out;
}

/** The world shows exactly the palette at `phase` (the heart apart: it breathes and warms). */
function expectPalette(world, phase, digits = 9) {
    const want = paletteAt(phase);
    const shown = shownPalette(world);
    for (const key of Object.keys(shown)) {
        shown[key].forEach((channel, c) => expect(channel, `${key}[${c}]`).toBeCloseTo(want[key][c], digits));
    }
}

/** A colour (a vector or an array) keeps the hue of `rgb`: the same ratios between its channels. */
function expectHue(colour, rgb, digits = 5) {
    const [r, g, b] = Array.isArray(colour) ? colour : [colour.x, colour.y, colour.z];
    expect(r).toBeGreaterThan(0);
    expect(g / r).toBeCloseTo(rgb[1] / rgb[0], digits);
    expect(b / r).toBeCloseTo(rgb[2] / rgb[0], digits);
}

/** A world whose crystals hold light: two hard drops, landed. Also returns the crystals that hold some. */
function litWorld() {
    const { camera, world } = makeWorld('Low');
    world.onLock({ u: 0.2, hardDrop: true, color: '#ff70ff' });
    world.onLock({ u: 0.8, hardDrop: true, color: '#60ffff' });
    run(world, camera, Math.max(...flashes(world).map((flash) => flash.time)) - world.time + 0.05);
    const holders = [];
    for (let i = 0; i < world.crystals.heroes; i++) if (world.crystals.heldAt(i, world.time) > 0) holders.push(i);
    expect(holders.length).toBeGreaterThan(1);
    return { camera, world, holders };
}

const egg = (p) => (p.x / CAVITY.a) ** 2 + (p.y / CAVITY.a) ** 2 + ((p.z - CAVITY.zc) / CAVITY.c) ** 2;
const peakOf = (v) => Math.max(v.x, v.y, v.z);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('geode world: build', () => {
    it('builds every part at every tier, from node materials only, with the counts its tier pays for', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            // The whole picture and every event, on every tier, each under a name a capture can address.
            expect(Object.keys(world.parts).sort(), quality).toEqual([...GEODE_PARTS].sort());
            expect(scene.children).toHaveLength(1);
            expect(scene.children[0]).toBe(world.root);
            expect(world.root.children).toHaveLength(GEODE_PARTS.length);
            for (const name of GEODE_PARTS) {
                const part = world.parts[name];
                const label = `${quality}.${name}`;
                expect(part.mesh.parent, label).toBe(world.root);
                expect(part.mesh.material, label).toBe(part.material);
                expect(part.mesh.geometry, label).toBe(part.geometry);
                expect(part.material.isNodeMaterial, label).toBe(true);
                expect(part.material.isShaderMaterial, label).not.toBe(true);
                expect(part.material.fog, label).toBe(false); // the cavity's air is in every material
            }
            // Heroes first, then the whole crown: three draws share the one list.
            const crown = CROWN_RINGS * tier.crownPerRing;
            expect(world.crystals, quality).toBe(world.parts.crystals);
            expect(world.crystals.heroes, quality).toBe(tier.heroes);
            expect(world.crystals.count, quality).toBe(tier.heroes + crown);
            expect(world.list, quality).toHaveLength(world.crystals.count);
            for (const name of ['crystals', 'glints', 'beams']) {
                expect(world.parts[name].geometry.instanceCount, `${quality}.${name}`).toBe(world.crystals.count);
            }
            expect(world.parts.druzy.count, quality).toBe(tier.druzy);
            expect(world.parts.druzy.geometry.instanceCount, quality).toBe(tier.druzy);
            expect(world.parts.air.motes, quality).toBe(tier.motes);
            expect(world.parts.air.stars, quality).toBe(tier.stars);
            expect(world.parts.air.geometry.instanceCount, quality).toBe(tier.motes + tier.stars);
            // The pools gameplay draws from: always the same size, always drawn.
            expect(world.shards, quality).toBe(world.parts.shards);
            expect(world.shards.count, quality).toBe(tier.shards);
            expect(world.shards.geometry.instanceCount, quality).toBe(tier.shards);
            expect(world.wisps.count, quality).toBe(WISP_SLOTS * WISP_TAIL);
            expect(world.wisps.geometry.instanceCount, quality).toBe(WISP_SLOTS * WISP_TAIL);
            expect(world.rowBeams.geometry.instanceCount, quality).toBe(BEAM_ROWS * 2);
            expect(world.getState(), quality).toMatchObject({
                quality,
                time: 10,
                combo: 0,
                level: 1,
                palette: GEODE_PALETTES[0].name,
                held: 0,
                crystals: tier.heroes + crown,
                heroes: tier.heroes,
                druzy: tier.druzy,
                motes: tier.motes,
                stars: tier.stars,
                shards: tier.shards,
                layoutLive: true,
                counts: {
                    locks: 0, clears: 0, quads: 0, wisps: 0, shatters: 0,
                },
            });
            // The crystals either side of the card are there to be struck.
            expect(world.targets.left.length, quality).toBeGreaterThan(0);
            expect(world.targets.right.length, quality).toBeGreaterThan(0);
            expect(world.getState().targets, quality).toEqual({
                left: world.targets.left.length, right: world.targets.right.length,
            });
            world.dispose();
        }
    });

    it('builds the High tier for a quality it does not know, and the same geode every time', () => {
        const scene = new THREE.Scene();
        const unknown = new GeodeWorld({ scene, quality: 'Nope' }).build();
        expect(unknown.crystals.heroes).toBe(QUALITY.High.heroes);
        expect(unknown.shards.count).toBe(QUALITY.High.shards);
        const high = new GeodeWorld({ scene: new THREE.Scene(), quality: 'High' }).build();
        expect(JSON.stringify(high.list)).toBe(JSON.stringify(unknown.list));
        // Another seed grows another geode in the same cavity.
        const other = new GeodeWorld({ scene: new THREE.Scene(), quality: 'High', seed: 77 }).build();
        expect(other.plan.seed).toBe(77);
        expect(JSON.stringify(other.list)).not.toBe(JSON.stringify(high.list));
        expect(other.crystals.count).toBe(high.crystals.count);
        unknown.dispose();
        high.dispose();
        other.dispose();
    });

    it('never needs a frustum test or a matrix update for its parts', () => {
        const { world } = makeWorld('High');
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.frustumCulled, name).toBe(false);
            expect(world.parts[name].mesh.matrixAutoUpdate, name).toBe(false);
            expect(world.parts[name].mesh.visible, name).toBe(true); // no pool waits hidden for its first event
        });
        world.dispose();
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['shell', 'crystals', 'no-such-part']);
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'shell' || name === 'crystals');
        });
        world.showOnlyParts([]);
        expect(Object.values(world.parts).some((part) => part.mesh.visible)).toBe(false);
        world.showOnlyParts(GEODE_PARTS);
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
        expect(disposals).toHaveLength(GEODE_PARTS.length * 2);
        expect(world.textures.length).toBeGreaterThanOrEqual(1); // the noise field
        world.textures.forEach((texture) => disposals.push(vi.spyOn(texture, 'dispose')));
        expect(world.disposed).toBe(false);
        world.dispose();
        expect(world.disposed).toBe(true);
        expect(scene.children).toHaveLength(0);
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(world.parts).toEqual({});
        expect(world.textures).toEqual([]);
        expect(() => world.dispose()).not.toThrow();
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        // A late frame or a late event after retirement is harmless.
        expect(() => {
            world.updateCamera(camera, { time: 11, delta: 0.016 });
            world.update({ time: 11, delta: 0.016 }, camera);
            world.onLock({ u: 0.5 });
            world.onLock({ u: 0.2, hardDrop: true });
            world.onClear({ lines: 4 });
            world.onCombo(3);
            world.onCombo(0);
            world.levelUp(2);
            world.levelUp(3, { silent: true });
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null);
            world.setLayout(fallbackLayout(800, 600), 800 / 600);
            world.showOnlyParts(['shell']);
            world.resetSession();
            world.seek(3);
        }).not.toThrow();
        expect(world.getState()).toMatchObject({ held: 0, crystals: 0, heroes: 0 });
    });
});

describe('geode world: camera', () => {
    it('holds its horizontal view, clamped for very wide and very tall frames', () => {
        const horizontal = (aspect) => (2 * Math.atan(Math.tan((fovForAspect(aspect) * DEG) / 2) * aspect)) / DEG;
        let previous = Infinity;
        let unclamped = 0;
        for (let i = 0; i <= 60; i++) {
            const aspect = 0.3 * (4.2 / 0.3) ** (i / 60); // 0.3 .. 4.2
            const fov = fovForAspect(aspect);
            expect(fov).toBeGreaterThanOrEqual(REST_RIG.minFov);
            expect(fov).toBeLessThanOrEqual(REST_RIG.maxFov);
            // The wider the frame, the lower the lens: the same width of geode in view.
            expect(fov).toBeLessThanOrEqual(previous);
            previous = fov;
            if (fov > REST_RIG.minFov && fov < REST_RIG.maxFov) {
                expect(horizontal(aspect)).toBeCloseTo(REST_RIG.hFov, 6);
                unclamped += 1;
            }
        }
        expect(unclamped).toBeGreaterThan(0);
        expect(fovForAspect(50)).toBe(REST_RIG.minFov);
        expect(fovForAspect(0.05)).toBe(REST_RIG.maxFov);
        expect(REST_RIG.minFov).toBeLessThan(REST_RIG.maxFov);
        // Nonsense is a wide desktop frame.
        expect(fovForAspect(NaN)).toBe(fovForAspect(16 / 9));
        expect(fovForAspect(undefined)).toBe(fovForAspect(16 / 9));
    });

    it('floats on the geode\'s axis, looking at the heart', () => {
        const { camera, world } = makeWorld('Low');
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        expect(camera.fov).toBe(fovForAspect(1600 / 900));
        // The rest camera the composition is measured in: on the axis, looking down it.
        const rest = world.restCamera();
        expect(rest.position.toArray()).toEqual([0, 0, 0]);
        expect(rest.aspect).toBeCloseTo(1600 / 900, 9);
        expect(rest.fov).toBe(fovForAspect(1600 / 900));
        const gaze = rest.getWorldDirection(new THREE.Vector3());
        expect(gaze.z).toBeCloseTo(-1, 9);
        // The heart's light comes from a point on the axis, just inside the far pole...
        const heart = world.u.heartPos.value;
        expect(heart.x).toBe(0);
        expect(heart.y).toBe(0);
        expect(heart.z).toBeGreaterThan(CAVITY.zc - CAVITY.c);
        expect(heart.z).toBeLessThan(CAVITY.zc);
        // ...at the middle of the rest frame.
        const centre = heart.clone().project(rest);
        expect(centre.x).toBeCloseTo(0, 9);
        expect(centre.y).toBeCloseTo(0, 9);
        // The live camera floats: it wanders, never out of the hollow, never losing the heart.
        let wandered = 0;
        for (let i = 0; i < 60; i++) {
            run(world, camera, 2, 1);
            wandered = Math.max(wandered, camera.position.length());
            expect(egg(camera.position)).toBeLessThan(1);
            expect(world.heart.x).toBeGreaterThan(0);
            expect(world.heart.x).toBeLessThan(1);
            expect(world.heart.y).toBeGreaterThan(0);
            expect(world.heart.y).toBeLessThan(1);
            // The heart on screen is where the camera really sees it.
            const seen = heart.clone().project(camera);
            expect(world.heart.x).toBeCloseTo(seen.x * 0.5 + 0.5, 9);
            expect(world.heart.y).toBeCloseTo(0.5 - seen.y * 0.5, 9);
        }
        expect(wandered).toBeGreaterThan(0.1);
        // The post reads the same point, not a copy of it.
        expect(world.getPostState().heart).toBe(world.heart);
        expect(world.getState().heart).toEqual(world.heart);
        world.dispose();
    });

    it('follows the frame: a new shape of window changes the lens and what a spark can be sent to', () => {
        const { camera, world } = makeWorld('Low');
        const wide = { left: [...world.targets.left], right: [...world.targets.right] };
        // An upright phone: the card fills most of the width.
        world.setViewport(390, 844, 390 / 844);
        world.setLayout(fallbackLayout(390, 844), 390 / 844);
        world.updateCamera(camera, { time: world.time, delta: 0 });
        expect(world.u.viewport.value.toArray()).toEqual([390, 844]);
        expect(camera.fov).toBe(fovForAspect(390 / 844));
        expect(camera.fov).toBeGreaterThan(fovForAspect(1600 / 900));
        expect(world.restCamera().aspect).toBeCloseTo(390 / 844, 9);
        expect(world.targets).not.toEqual(wide);
        expect(world.targets.left.length + world.targets.right.length).toBeGreaterThan(0);
        // No board on screen: events aim at where the solo board would hang in this frame.
        world.setLayout(null);
        expect(world.getState().layoutLive).toBe(false);
        const upright = cardUnion(world.layout);
        expect(upright).toBeTruthy();
        // The window goes back to a desktop's shape: the card and the crystals in reach follow at once.
        world.setViewport(1600, 900, 1600 / 900);
        expect(cardUnion(world.layout)).not.toEqual(upright);
        const boardless = makeWorld('Low', { live: false });
        expect(cardUnion(world.layout)).toEqual(cardUnion(boardless.world.layout));
        expect(world.targets).toEqual(boardless.world.targets);
        boardless.world.dispose();
        // The board comes back where it was: the same crystals are in reach again.
        world.setLayout(fallbackLayout(1600, 900), 1600 / 900);
        expect(world.targets).toEqual(wide);
        // Nonsense leaves the frame as it was.
        world.setViewport(0, -4, NaN);
        expect(world.u.viewport.value.toArray()).toEqual([1600, 900]);
        expect(world.targets).toEqual(wide);
        world.dispose();
    });

    it('aims at the crystals of the new frame when the window changes shape with no board on screen', () => {
        const frames = [[1600, 900], [390, 844], [3440, 1440], [1000, 1000]];
        for (const [from, to] of [[1, 0], [0, 1], [2, 3], [3, 2]]) {
            const [width, height] = frames[to];
            const label = `${frames[from].join('x')} -> ${width}x${height}`;
            const resized = makeWorld('Low', { width: frames[from][0], height: frames[from][1], live: false });
            const before = { left: [...resized.world.targets.left], right: [...resized.world.targets.right] };
            // The size alone: no layout follows it, for there is no board to measure.
            resized.world.setViewport(width, height, width / height);
            const fresh = makeWorld('Low', { width, height, live: false });
            expect(resized.world.getState().layoutLive, label).toBe(false);
            // The solo board's card is where it would hang in the new frame...
            expect(resized.world.layout, label).toEqual(fresh.world.layout);
            // ...and a spark is sent to what shows beside THAT card, not beside the old one.
            expect(resized.world.targets, label).toEqual(fresh.world.targets);
            expect(resized.world.targets, label).not.toEqual(before);
            resized.world.dispose();
            fresh.world.dispose();
        }
    });

    it('leans the view with the pointer', () => {
        const { camera, world } = makeWorld('Low');
        const at = (pointerX, pointerY) => {
            world.updateCamera(camera, {
                time: 10, delta: 0, pointerX, pointerY,
            });
            return camera.position.clone();
        };
        const rest = at(0, 0);
        const right = at(1, 0);
        expect(right.x).toBeGreaterThan(rest.x);
        expect(right.y).toBeCloseTo(rest.y, 9);
        // The heart stays in view as the camera leans.
        expect(world.heart.x).toBeGreaterThan(0);
        expect(world.heart.x).toBeLessThan(1);
        const left = at(-1, 0);
        expect(left.x).toBeLessThan(rest.x);
        expect(rest.x - left.x).toBeCloseTo(right.x - rest.x, 9);
        // A pointer low on the screen lowers the view.
        const down = at(0, 1);
        expect(down.y).toBeLessThan(rest.y);
        expect(down.x).toBeCloseTo(rest.x, 9);
        expect(at(0, -1).y).toBeGreaterThan(rest.y);
        // No pointer at all is a pointer at rest.
        world.updateCamera(camera, { time: 10, delta: 0 });
        expect(camera.position.distanceTo(rest)).toBeLessThan(1e-12);
        world.dispose();
    });

    it('finds the world point along the ray through a screen point', () => {
        const { camera, world } = makeWorld('Low');
        for (const [sx, sy, depth] of [[0.3, 0.7, 12], [0.5, 0.5, SPARK_DEPTH], [0.95, 0.1, 40]]) {
            const out = [0, 0, 0];
            expect(world.screenToWorld(sx, sy, depth, out)).toBe(out);
            const point = new THREE.Vector3(...out);
            expect(point.distanceTo(camera.position)).toBeCloseTo(depth, 6);
            const screen = point.clone().project(camera);
            expect(screen.x * 0.5 + 0.5).toBeCloseTo(sx, 6);
            expect(0.5 - screen.y * 0.5).toBeCloseTo(sy, 6);
        }
        world.dispose();
        // Before any camera is bound it aims straight down the axis, and a lock still lands.
        const blind = new GeodeWorld({ scene: new THREE.Scene(), quality: 'Minimal' }).build();
        expect(blind.screenToWorld(0.2, 0.9, 5, [1, 1, 1])).toEqual([0, 0, -5]);
        expect(() => blind.onLock({ u: 0.2 })).not.toThrow();
        expect(blind.counts.locks).toBe(1);
        blind.dispose();
    });
});

describe('geode world: locks', () => {
    it('answers a lock with a ring from the heart in the piece\'s colour', () => {
        const { camera, world } = makeWorld('Low');
        expect(inUse(world.u.pulseA, 0)).toHaveLength(0);
        world.onLock({ rows: [19], u: 0.9, color: '#ff70ff' });
        // One slot, born now.
        expect(inUse(world.u.pulseA, 0)).toHaveLength(1);
        const [ring] = ringsBornAt(world, world.time);
        expect(ring).toBeTruthy();
        expect(ring.place.y).toBeGreaterThan(0); // its strength
        expect(ring.place.z).toBeGreaterThan(0); // how far down the wall it reaches
        expectHue(ring.colour, pieceColor('#ff70ff'));
        // A lock without a colour still rings, in a colour of the geode's own.
        run(world, camera, 1 / 60, 1);
        world.onLock({ rows: [19], u: 0.1 });
        const [plain] = ringsBornAt(world, world.time);
        expectHue(plain.colour, pieceColor(null));
        expect(Math.min(plain.colour.x, plain.colour.y, plain.colour.z)).toBeGreaterThan(0);
        expect(inUse(world.u.pulseA, 0)).toHaveLength(2);
        expect(world.counts.locks).toBe(2);
        world.dispose();
    });

    it('sends one spark from the card into a crystal, which rings, keeps the light and ripples the wall', () => {
        const { camera, world } = makeWorld('Low');
        const card = cardUnion(world.layout);
        const board = world.layout.boards[0];
        const rgb = pieceColor('#60ffff');
        const t0 = world.time;
        expect(world.getState().held).toBe(0);
        expect(flashes(world)).toHaveLength(0);
        world.onLock({ rows: [12, 13], u: 0.2, color: '#60ffff' });
        expect(world.counts).toMatchObject({ locks: 1, wisps: 1 });

        // ── The spark: a head and its tail in one slot of the pool ──
        expect(used(world.wisps, 'aFrom')).toHaveLength(WISP_TAIL);
        const from = world.wisps.geometry.getAttribute('aFrom').array;
        const mid = world.wisps.geometry.getAttribute('aMid').array;
        const to = world.wisps.geometry.getAttribute('aTo').array;
        const tint = world.wisps.geometry.getAttribute('aTint').array;
        const flight = to[3];
        expect(from[3]).toBe(t0); // it leaves now
        expect(flight).toBeGreaterThan(0);
        expect(flight).toBeLessThan(3);
        for (let j = 1; j < WISP_TAIL; j++) {
            // Every mote of the tail flies the same arc, each a little further behind the head.
            for (let k = 0; k < 4; k++) {
                expect(from[j * 4 + k]).toBe(from[k]);
                expect(to[j * 4 + k]).toBe(to[k]);
                expect(tint[j * 4 + k]).toBe(tint[k]);
            }
            expect(mid[j * 4 + 3]).toBeGreaterThan(mid[(j - 1) * 4 + 3]);
        }
        expect(mid[3]).toBe(0);
        expect(mid[(WISP_TAIL - 1) * 4 + 3]).toBe(1);
        // In the piece's colour.
        for (let k = 0; k < 3; k++) expect(tint[k]).toBeCloseTo(rgb[k], 6);
        // It leaves the card's edge on the piece's side, at the piece's height, a fixed way out...
        const start = new THREE.Vector3(from[0], from[1], from[2]);
        expect(start.distanceTo(camera.position)).toBeCloseTo(SPARK_DEPTH, 4);
        const onScreen = start.clone().project(camera);
        expect(onScreen.x * 0.5 + 0.5).toBeCloseTo(card.x0, 4);
        expect(0.5 - onScreen.y * 0.5).toBeCloseTo(boardPoint(board, 0.2, 13).y, 4);

        // ── The ripple: one slot, at the root of the crystal the spark is flying to ──
        const ripples = inUse(world.u.strikeA, 3);
        expect(ripples).toHaveLength(1);
        const place = ripples[0].value;
        const arrive = place.w;
        expect(arrive).toBeCloseTo(t0 + flight, 5);
        const target = crystalAt(world, place);
        expect(target).toBeGreaterThanOrEqual(0);
        expect(target).toBeLessThan(world.crystals.heroes); // a hero, never one of the crown
        const ripple = world.u.strikeC[world.u.strikeA.indexOf(ripples[0])].value;
        expectHue(ripple, rgb);
        expect(ripple.w).toBeGreaterThan(0);
        // ...a crystal in view on the piece's side of the card.
        expect(world.targets.left).toContain(target);
        expect(world.targets.right).not.toContain(target);
        expect(screenX(world, target)).toBeLessThan(card.x0);
        expect(screenX(world, target)).toBeGreaterThan(0);
        // The spark enters the stone on its axis, somewhere in its upper half.
        const crystal = world.list[target];
        const reach = [to[0] - crystal.x, to[1] - crystal.y, to[2] - crystal.z];
        const along = reach[0] * crystal.axis[0] + reach[1] * crystal.axis[1] + reach[2] * crystal.axis[2];
        expect(along / crystal.height).toBeGreaterThanOrEqual(0.5 - 1e-4);
        expect(along / crystal.height).toBeLessThan(1);
        expect(Math.hypot(
            reach[0] - crystal.axis[0] * along,
            reach[1] - crystal.axis[1] * along,
            reach[2] - crystal.axis[2] * along,
        )).toBeLessThan(1e-3);

        // ── The crystal: it flashes when the spark arrives, and only then holds its light ──
        const answered = flashes(world);
        expect(answered[0].index).toBe(target);
        expect(answered[0].time).toBeCloseTo(arrive, 4);
        expect(answered[0].peak).toBeGreaterThan(0);
        // If its cluster chimes with it, each of the others answers later and fainter.
        for (let k = 1; k < answered.length; k++) {
            const other = world.list[answered[k].index];
            expect(other.cluster, `chime ${k}`).toBe(crystal.cluster);
            expect(other.ring, `chime ${k}`).toBe(0);
            expect(answered[k].time, `chime ${k}`).toBeGreaterThan(answered[k - 1].time);
            expect(answered[k].peak, `chime ${k}`).toBeLessThan(answered[0].peak);
        }
        expect(world.crystals.heldAt(target, t0)).toBe(0);
        expect(world.crystals.heldAt(target, arrive - 1e-3)).toBe(0);
        expect(world.crystals.heldAt(target, arrive + 1e-3)).toBeGreaterThan(0);
        expect(world.getState().held).toBe(0); // the spark is still in flight
        const store = world.crystals.state.aStore;
        expectHue([store[target * 4], store[target * 4 + 1], store[target * 4 + 2]], rgb, 4);
        expect(store[target * 4 + 3]).toBeCloseTo(arrive, 4);
        // It throws dust from where the spark went in, the moment it arrives.
        const dust = used(world.shards, 'aBirth');
        expect(dust.length).toBeGreaterThan(0);
        expect(dust.length).toBeLessThanOrEqual(world.shards.count);
        const births = world.shards.geometry.getAttribute('aBirth').array;
        for (const i of dust) {
            expect(births[i * 4 + 3]).toBeCloseTo(arrive, 4);
            for (let k = 0; k < 3; k++) expect(births[i * 4 + k]).toBeCloseTo(to[k], 4);
        }

        // Just before the spark lands the geode holds nothing; once it has, it does.
        run(world, camera, arrive - t0 - 0.02);
        expect(world.getState().held).toBe(0);
        run(world, camera, answered[answered.length - 1].time - world.time + 0.05);
        const { held } = world.getState();
        expect(held).toBeGreaterThan(0);
        let sum = 0;
        for (const { index } of answered) {
            const share = world.crystals.heldAt(index, world.time);
            expect(share).toBeGreaterThan(0);
            // The struck crystal holds the most.
            expect(share).toBeLessThanOrEqual(world.crystals.heldAt(target, world.time));
            sum += share;
        }
        expect(held).toBeCloseTo(sum, 9);
        expect(world.crystals.totalHeld(world.time)).toBe(held);
        world.dispose();
    });

    it('strikes a crystal on the piece\'s own side of the card: left of it or right of it', () => {
        const { camera, world } = makeWorld('Low');
        const card = cardUnion(world.layout);
        const send = vi.spyOn(world, 'sendWisp');
        const struck = { left: new Set(), right: new Set() };
        for (let i = 0; i < 12; i++) {
            const u = (i + 0.5) / 12;
            world.onLock({ u, rows: [8 + (i % 10)] });
            expect(send).toHaveBeenCalledTimes(i + 1);
            const index = send.mock.calls[i][0];
            const side = u < 0.5 ? 'left' : 'right';
            expect(world.targets[side], `lock ${i}`).toContain(index);
            if (u < 0.5) expect(screenX(world, index), `lock ${i}`).toBeLessThan(card.x0);
            else expect(screenX(world, index), `lock ${i}`).toBeGreaterThan(card.x1);
            // The spark leaves that edge of the card.
            const start = new THREE.Vector3(...send.mock.calls[i][1]).project(camera);
            expect(start.x * 0.5 + 0.5, `lock ${i}`).toBeCloseTo(u < 0.5 ? card.x0 : card.x1, 4);
            struck[side].add(index);
            run(world, camera, 0.25);
        }
        // Not always the same bell.
        expect(struck.left.size).toBeGreaterThan(1);
        expect(struck.right.size).toBeGreaterThan(1);
        // A piece down the middle of the board goes to one side, the next to the other.
        world.onLock({ u: 0.5 });
        world.onLock({ u: 0.5 });
        const [first, second] = send.mock.calls.slice(-2).map((call) => call[0]);
        expect(world.targets.left.includes(first)).not.toBe(world.targets.left.includes(second));
        world.dispose();
    });

    it('lists what a spark can be sent to: crystals in view, clear of the card, the nearest to it first', () => {
        for (const [width, height] of [[1600, 900], [1000, 1000], [3440, 1440], [390, 844]]) {
            const { world } = makeWorld('High', { width, height });
            const card = cardUnion(world.layout);
            const label = `${width}x${height}`;
            for (const side of ['left', 'right']) {
                let previous = -Infinity;
                for (const index of world.targets[side]) {
                    expect(index, label).toBeLessThan(world.crystals.heroes);
                    expect(world.list[index].ring, label).toBe(0);
                    const sx = screenX(world, index);
                    const away = side === 'left' ? card.x0 - sx : sx - card.x1;
                    expect(away, `${label} ${side} ${index}`).toBeGreaterThan(0);
                    expect(sx, label).toBeGreaterThan(0);
                    expect(sx, label).toBeLessThan(1);
                    expect(away, `${label} ${side} order`).toBeGreaterThanOrEqual(previous);
                    previous = away;
                }
            }
            expect(world.targets.left.filter((index) => world.targets.right.includes(index)), label).toEqual([]);
            expect(new Set(world.targets.left).size, label).toBe(world.targets.left.length);
            expect(world.targets.left.length + world.targets.right.length, label).toBeGreaterThan(0);
            world.dispose();
        }
    });

    it('still rings when the card hides every crystal on a side, or all of them', () => {
        const { world } = makeWorld('Low');
        const send = vi.spyOn(world, 'sendWisp');
        const { boards } = fallbackLayout(1600, 900);
        // A card over the whole left of the frame: a piece on the left has only the right to send its light to.
        world.setLayout({
            cardCount: 1,
            cards: [{
                x0: 0, y0: 0, x1: 0.62, y1: 1,
            }],
            hud: null,
            boards,
        });
        expect(world.targets.left).toHaveLength(0);
        expect(world.targets.right.length).toBeGreaterThan(0);
        world.onLock({ u: 0.1 });
        expect(send).toHaveBeenCalledTimes(1);
        expect(world.targets.right).toContain(send.mock.calls[0][0]);
        // A card over everything: the heart still answers, no spark flies.
        world.setLayout({
            cardCount: 1,
            cards: [{
                x0: 0, y0: 0, x1: 1, y1: 1,
            }],
            hud: null,
            boards,
        });
        expect(world.targets).toEqual({ left: [], right: [] });
        const rings = inUse(world.u.pulseA, 0).length;
        expect(() => world.onLock({ u: 0.8, hardDrop: true })).not.toThrow();
        expect(send).toHaveBeenCalledTimes(1);
        expect(inUse(world.u.pulseA, 0)).toHaveLength(rings + 1);
        expect(world.counts.locks).toBe(2);
        world.dispose();
    });

    it('aims from the click when a mode has no board to aim through', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        const send = vi.spyOn(world, 'sendWisp');
        world.onLock({ screen: { x: 0.15, y: 0.4 }, color: '#ffd060' });
        let start = new THREE.Vector3(...send.mock.calls[0][1]).project(camera);
        expect(start.x * 0.5 + 0.5).toBeCloseTo(0.15, 4);
        expect(0.5 - start.y * 0.5).toBeCloseTo(0.4, 4);
        expect(world.targets.left).toContain(send.mock.calls[0][0]);
        world.onLock({ screen: { x: 0.85, y: 0.7 }, u: 0.1 }); // the click wins over the column
        start = new THREE.Vector3(...send.mock.calls[1][1]).project(camera);
        expect(start.x * 0.5 + 0.5).toBeCloseTo(0.85, 4);
        expect(world.targets.right).toContain(send.mock.calls[1][0]);
        world.dispose();
    });

    it('hits harder and sends three sparks into three crystals on a hard drop, and kicks the camera', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        const softSend = vi.spyOn(soft.world, 'sendWisp');
        const hardSend = vi.spyOn(hard.world, 'sendWisp');
        soft.world.onLock({ u: 0.3, color: '#ffa050' });
        hard.world.onLock({ u: 0.3, hardDrop: true, color: '#ffa050' });
        // One ring each: the hard one stronger, and reaching further down the wall.
        const [softRing] = ringsBornAt(soft.world, soft.world.time);
        const [hardRing] = ringsBornAt(hard.world, hard.world.time);
        expect(inUse(hard.world.u.pulseA, 0)).toHaveLength(1);
        expect(hardRing.place.y).toBeGreaterThan(softRing.place.y);
        expect(hardRing.place.z).toBeGreaterThan(softRing.place.z);
        expect(hard.world.kick).toBeGreaterThan(soft.world.kick);
        expect(hard.world.flash).toBeGreaterThan(soft.world.flash);
        expect(soft.world.kick).toBeGreaterThan(0);
        // The same first crystal, struck harder; then two others on that side, more gently.
        expect(softSend).toHaveBeenCalledTimes(1);
        expect(hardSend).toHaveBeenCalledTimes(3);
        expect(hardSend.mock.calls[0][0]).toBe(softSend.mock.calls[0][0]);
        expect(hardSend.mock.calls[0][3]).toBeGreaterThan(softSend.mock.calls[0][3]);
        expect(new Set(hardSend.mock.calls.map((call) => call[0])).size).toBe(3);
        for (const call of hardSend.mock.calls.slice(1)) {
            expect(hard.world.targets.left).toContain(call[0]);
            expect(call[3]).toBeLessThan(hardSend.mock.calls[0][3]);
        }
        expect(inUse(hard.world.u.strikeA, 3)).toHaveLength(3);
        // The kick reaches the post and dollies the lens.
        const { fov } = hard.camera;
        run(hard.world, hard.camera, 1 / 60, 1);
        run(soft.world, soft.camera, 1 / 60, 1);
        expect(hard.world.getPostState().kick).toBeGreaterThan(soft.world.getPostState().kick);
        expect(hard.world.getPostState().flash).toBeGreaterThan(soft.world.getPostState().flash);
        expect(hard.camera.fov).toBeLessThan(fov);
        expect(hard.camera.fov).toBeLessThan(soft.camera.fov);

        // One spark for a lock, three for a hard drop: every time.
        const perDrop = [hard.world.counts.wisps];
        for (let i = 1; i < 12; i++) {
            run(soft.world, soft.camera, 0.3);
            run(hard.world, hard.camera, 0.3);
            const before = hard.world.counts.wisps;
            soft.world.onLock({ u: (i + 0.5) / 12 });
            hard.world.onLock({ u: (i + 0.5) / 12, hardDrop: true });
            perDrop.push(hard.world.counts.wisps - before);
        }
        expect(soft.world.counts.wisps).toBe(12);
        expect(perDrop).toEqual(new Array(12).fill(3));
        expect(hard.world.counts.wisps).toBe(36);
        // And the geode is left holding more.
        run(soft.world, soft.camera, 3);
        run(hard.world, hard.camera, 3);
        expect(hard.world.getState().held).toBeGreaterThan(soft.world.getState().held);
        soft.world.dispose();
        hard.world.dispose();
    });

    it('sends a hard drop\'s three sparks into three different crystals on its side, at every tier', () => {
        for (const quality of ['Minimal', 'Low', 'High']) {
            const { camera, world } = makeWorld(quality);
            const send = vi.spyOn(world, 'sendWisp');
            expect(world.targets.left.length, quality).toBeGreaterThanOrEqual(3);
            expect(world.targets.right.length, quality).toBeGreaterThanOrEqual(3);
            for (let i = 0; i < 36; i++) {
                const u = (((i * 5) % 12) + 0.5) / 12;
                const label = `${quality} drop ${i}`;
                send.mockClear();
                world.onLock({ u, hardDrop: true, rows: [6 + (i % 12)] });
                expect(send, label).toHaveBeenCalledTimes(3);
                const struck = send.mock.calls.map((call) => call[0]);
                expect(new Set(struck).size, label).toBe(3);
                for (const index of struck) expect(world.targets[u < 0.5 ? 'left' : 'right'], label).toContain(index);
                // The piece's own crystal takes the most.
                expect(send.mock.calls[1][3], label).toBeLessThan(send.mock.calls[0][3]);
                expect(send.mock.calls[2][3], label).toBeLessThan(send.mock.calls[0][3]);
                run(world, camera, 0.1);
            }
            expect(world.counts.wisps, quality).toBe(108);
            world.dispose();
        }
    });

    it('keeps a hard drop on its own side while it shows three crystals, and borrows the other\'s below that', () => {
        const { world } = makeWorld('High');
        const send = vi.spyOn(world, 'sendWisp');
        const { boards } = fallbackLayout(1600, 900);
        const cardTo = (x0, x1) => ({
            cardCount: 1,
            cards: [{
                x0, y0: 0, x1, y1: 1,
            }],
            hud: null,
            boards,
        });
        // Widen the card over the right of the frame until three crystals, then two, then one show beside it.
        const narrow = new Map();
        for (let x1 = 0.62; x1 < 1 && narrow.size < 3; x1 += 0.001) {
            world.setLayout(cardTo(0.38, x1));
            const shown = world.targets.right.length;
            if (shown >= 1 && shown <= 3 && !narrow.has(shown)) narrow.set(shown, world.layout);
        }
        expect([...narrow.keys()].sort()).toEqual([1, 2, 3]);
        for (const [shown, layout] of narrow) {
            world.setLayout(layout);
            const { left, right } = world.targets;
            expect(right).toHaveLength(shown);
            expect(left.length).toBeGreaterThanOrEqual(3);
            // Its own crystals come first in what a piece on the right can strike.
            expect(world.targetsOn(1)).toEqual(shown === 3 ? right : [...right, ...left]);
            expect(world.targetsOn(-1)).toEqual(left);
            const all = new Set();
            for (let i = 0; i < 24; i++) {
                const label = `${shown} on the right, drop ${i}`;
                send.mockClear();
                world.onLock({ u: 0.8, hardDrop: true });
                const struck = send.mock.calls.map((call) => call[0]);
                // Three sparks, into three crystals, every time.
                expect(struck, label).toHaveLength(3);
                expect(new Set(struck).size, label).toBe(3);
                for (const index of struck) {
                    expect(world.targetsOn(1), label).toContain(index);
                    all.add(index);
                }
                // With exactly three on its side, those are the three: none is sent across the card.
                if (shown === 3) expect([...struck].sort(), label).toEqual([...right].sort());
                // A soft lock sends its one spark the same way.
                send.mockClear();
                world.onLock({ u: 0.8 });
                expect(send, label).toHaveBeenCalledTimes(1);
                expect(world.targetsOn(1), label).toContain(send.mock.calls[0][0]);
            }
            // Below three, the other side's crystals make up the number.
            if (shown < 3) expect([...all].some((index) => left.includes(index)), `${shown} shown`).toBe(true);
        }

        // A card over nearly everything: with fewer than three crystals in the whole frame, one spark each.
        const few = new Map();
        for (let x1 = 0.62; x1 < 1 && few.size < 2; x1 += 0.001) {
            world.setLayout(cardTo(0, x1));
            const shown = world.targets.right.length;
            if (shown >= 1 && shown <= 2 && !few.has(shown)) few.set(shown, world.layout);
        }
        expect([...few.keys()].sort()).toEqual([1, 2]);
        for (const [shown, layout] of few) {
            world.setLayout(layout);
            expect(world.targets.left).toHaveLength(0);
            for (const u of [0.2, 0.8]) {
                for (let i = 0; i < 8; i++) {
                    send.mockClear();
                    world.onLock({ u, hardDrop: true });
                    const struck = send.mock.calls.map((call) => call[0]);
                    expect([...struck].sort(), `${shown} in the frame`).toEqual([...world.targets.right].sort());
                }
            }
        }
        world.dispose();
    });

    it('sends a piece on the left of an upright phone to the right\'s crystals when the left shows too few', () => {
        const { world } = makeWorld('Minimal', { width: 390, height: 844 });
        const send = vi.spyOn(world, 'sendWisp');
        const { left, right } = world.targets;
        // The card fills the frame: at the lowest tier hardly a crystal shows to the left of it.
        expect(left.length).toBeGreaterThan(0);
        expect(left.length).toBeLessThan(3);
        expect(right.length).toBeGreaterThanOrEqual(3);
        expect(world.targetsOn(-1)).toEqual([...left, ...right]);
        expect(world.targetsOn(1)).toEqual(right);
        const struckFrom = { left: new Set(), right: new Set() };
        for (let i = 0; i < 40; i++) {
            const side = i % 2 ? 'right' : 'left';
            send.mockClear();
            world.onLock({ u: side === 'left' ? 0.2 : 0.8, hardDrop: true });
            const struck = send.mock.calls.map((call) => call[0]);
            expect(struck, `drop ${i}`).toHaveLength(3);
            expect(new Set(struck).size, `drop ${i}`).toBe(3);
            struck.forEach((index) => struckFrom[side].add(index));
        }
        // A piece on the right keeps to the right; one on the left reaches both, its own crystal among them.
        for (const index of struckFrom.right) expect(right).toContain(index);
        for (const index of struckFrom.left) expect([...left, ...right]).toContain(index);
        expect(left.some((index) => struckFrom.left.has(index))).toBe(true);
        expect(right.some((index) => struckFrom.left.has(index))).toBe(true);
        world.dispose();
    });

    it('holds the light a long while and lets it fade', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, color: '#ffd060' });
        const answered = flashes(world);
        const { index } = answered[0];
        const arrive = answered[0].time;
        run(world, camera, answered[answered.length - 1].time - world.time + 0.05);
        const full = world.crystals.heldAt(index, arrive + 1e-3);
        expect(full).toBeGreaterThan(0);
        // To 1/e in STORE_HOLD seconds, whenever it is asked.
        expect(world.crystals.heldAt(index, arrive + STORE_HOLD)).toBeCloseTo(full * Math.exp(-1), 3);
        expect(world.crystals.heldAt(index, arrive + STORE_HOLD * 3)).toBeCloseTo(full * Math.exp(-3), 3);
        let previous = world.getState().held;
        for (let i = 0; i < 10; i++) {
            run(world, camera, STORE_HOLD / 5, 10);
            const now = world.getState().held;
            expect(now).toBeLessThan(previous);
            expect(now).toBeGreaterThan(0);
            previous = now;
        }
        world.dispose();
    });

    it('never lets one crystal hold more than its fill', () => {
        const { camera, world } = makeWorld('Low');
        const [target] = world.targets.left;
        const from = world.screenToWorld(0.3, 0.5, SPARK_DEPTH, [0, 0, 0]);
        let last = world.time;
        for (let i = 0; i < 12; i++) {
            last = world.sendWisp(target, from, [1, 0.9, 0.8], 4);
            run(world, camera, 0.1);
            expect(world.crystals.heldAt(target, last + 1e-3)).toBeLessThanOrEqual(STORE_MAX + 1e-6);
        }
        // Brim-full, in the hue it was filled with.
        expect(world.crystals.heldAt(target, last + 1e-3)).toBeGreaterThan(STORE_MAX * 0.9);
        const store = world.crystals.state.aStore;
        expectHue([store[target * 4], store[target * 4 + 1], store[target * 4 + 2]], [1, 0.9, 0.8], 4);
        expect(world.counts.wisps).toBe(12);
        // A crystal that is not drawn at this tier takes no spark.
        expect(world.sendWisp(world.list.length + 5, from, [1, 1, 1], 1)).toBe(world.time);
        expect(world.counts.wisps).toBe(12);
        world.dispose();
    });

    it('shows a crystal promised two sparks neither before the first one lands, and both from then on', () => {
        const { camera, world } = makeWorld('Low');
        const [target] = world.targets.left;
        const from = world.screenToWorld(0.3, 0.5, SPARK_DEPTH, [0, 0, 0]);
        const warm = [1, 0.5, 0.2];
        const cool = [0.2, 0.5, 1];
        const first = world.sendWisp(target, from, warm, 0.85);
        expect(world.crystals.heldAt(target, world.time)).toBe(0);
        const alone = world.crystals.heldAt(target, first + 1e-3);
        expect(alone).toBeGreaterThan(0);
        const { aStore, aFlash } = world.crystals.state;
        const flash = Array.from(aFlash.subarray(target * 4, target * 4 + 4));

        run(world, camera, 0.1);
        const second = world.sendWisp(target, from, cool, 0.7);
        expect(first).toBeGreaterThan(world.time); // the first spark is still in flight
        expect(second).toBeGreaterThan(first);
        // Nothing shows while both are on their way: not now, not a moment before the first lands.
        expect(world.crystals.heldAt(target, world.time)).toBe(0);
        expect(world.getState().held).toBe(0);
        expect(world.crystals.heldAt(target, first - 1e-3)).toBe(0);
        // The second's light joins the first's and lands with it: more than one spark leaves, in both their colours.
        expect(world.crystals.heldAt(target, first + 1e-3)).toBeGreaterThan(alone * 1.1);
        expect(aStore[target * 4 + 3]).toBeCloseTo(first, 4);
        const both = warm.map((v, c) => v * 0.85 + cool[c] * 0.7);
        expectHue(Array.from(aStore.subarray(target * 4, target * 4 + 3)), both, 4);
        // One flash, when the first lands, and the brighter spark's: here the first's own.
        expect(Array.from(aFlash.subarray(target * 4, target * 4 + 4))).toEqual(flash);

        // And so it plays: dark until the first spark is in, lit from then on.
        run(world, camera, first - world.time - 0.02);
        expect(world.crystals.heldAt(target, world.time)).toBe(0);
        expect(world.getState().held).toBe(0);
        run(world, camera, 0.04);
        expect(world.crystals.heldAt(target, world.time)).toBeGreaterThan(alone * 1.1);
        world.dispose();
    });

    it('never lights a crystal at the instant of a lock: its light comes with a spark, not ahead of it', () => {
        for (const quality of ['Minimal', 'Low', 'High']) {
            const { camera, world } = makeWorld(quality);
            const strike = vi.spyOn(world.crystals, 'strike');
            let promisedTwice = 0;
            for (let i = 0; i < 12; i++) {
                const label = `${quality} lock ${i}`;
                const before = heldNow(world);
                const total = world.getState().held;
                strike.mockClear();
                world.onLock({ u: i % 2 ? 0.8 : 0.2, hardDrop: true, color: '#60ffff' });
                // Every spark of this lock, and every chime it will set off, is still to come...
                expect(strike.mock.calls.length, label).toBeGreaterThanOrEqual(3);
                for (const call of strike.mock.calls) expect(call[2], label).toBeGreaterThan(world.time);
                // ...so no crystal holds any more than it did a moment ago.
                expect(changedSince(world, before), label).toEqual([]);
                expect(world.getState().held, label).toBeCloseTo(total, 4);
                // The case that used to light early: a crystal promised light twice over by one lock.
                const promised = new Map();
                for (const [index] of strike.mock.calls) promised.set(index, (promised.get(index) || 0) + 1);
                promisedTwice += [...promised.values()].filter((times) => times > 1).length;
                // The first of them to land does light its crystal.
                const [index, , arrive] = strike.mock.calls[0];
                expect(world.crystals.heldAt(index, arrive + 1e-3), label).toBeGreaterThan(before[index]);
                run(world, camera, 2);
            }
            expect(promisedTwice, quality).toBeGreaterThan(0);
            expect(world.getState().held, quality).toBeGreaterThan(0);
            world.dispose();
        }
    });

    it('keeps the struck crystal\'s own flash when a neighbour\'s chime comes back to it', () => {
        const { camera, world } = makeWorld('Low');
        const send = vi.spyOn(world, 'sendWisp');
        const { aFlash } = world.crystals.state;
        const flashOf = (index) => Array.from(aFlash.subarray(index * 4, index * 4 + 4));
        // Note what each crystal was told to flash by the first light a lock promises it.
        const promises = [];
        const firstFlash = new Map();
        const strike = world.crystals.strike.bind(world.crystals);
        vi.spyOn(world.crystals, 'strike').mockImplementation((index, ...rest) => {
            strike(index, ...rest);
            promises.push([index, ...rest]);
            if (!firstFlash.has(index)) firstFlash.set(index, flashOf(index));
        });
        const rgb = pieceColor('#ffa050');
        let chimedBack = 0;
        for (let i = 0; i < 24; i++) {
            const label = `lock ${i}`;
            send.mockClear();
            promises.length = 0;
            firstFlash.clear();
            world.onLock({ u: i % 2 ? 0.8 : 0.2, hardDrop: true, color: '#ffa050' });
            const [target, , , amount] = send.mock.calls[0];
            const arrive = send.mock.results[0].value;
            // The first light promised to the piece's crystal is its own spark's: a flash in the piece's colour.
            const mine = promises.filter(([index]) => index === target);
            expect(mine[0][2], label).toBe(arrive);
            expect(mine[0][3], label).toBe(amount);
            const own = firstFlash.get(target);
            expectHue(own, rgb, 4);
            expect(own[3], label).toBeCloseTo(arrive, 4);
            if (mine.length > 1) {
                // One of the two other sparks went into its cluster, and the chime came round to it, fainter.
                chimedBack += 1;
                for (const echo of mine.slice(1)) expect(echo[3], label).toBeLessThan(amount);
            }
            // Either way it flashes as its own spark told it to: when that spark lands, and as brightly.
            expect(flashOf(target), label).toEqual(own);
            // Whatever a crystal is told more than once, it never ends fainter than it was first told.
            for (const [index, flash] of firstFlash) {
                expect(Math.max(...flashOf(index).slice(0, 3)), `${label} crystal ${index}`)
                    .toBeGreaterThanOrEqual(Math.max(...flash.slice(0, 3)));
            }
            run(world, camera, 2);
        }
        expect(chimedBack).toBeGreaterThan(0);
        world.dispose();
    });

    it('reuses its slots as rings and never grows a pool', () => {
        const { camera, world } = makeWorld('Low');
        const pulses = world.u.pulseA.slice();
        const strikes = world.u.strikeA.slice();
        const pools = [
            [world.wisps, 'aFrom'], [world.shards, 'aBirth'],
        ].map(([part, name]) => [part.geometry.getAttribute(name), part.geometry.getAttribute(name).array]);
        const times = [];
        const total = Math.max(PULSE_SLOTS, STRIKE_SLOTS, WISP_SLOTS) + 3;
        for (let i = 0; i < total; i++) {
            times.push(world.time);
            world.onLock({ u: i % 2 ? 0.8 : 0.2, color: '#60ff90' });
            run(world, camera, 0.1);
        }
        expect(world.u.pulseA).toHaveLength(PULSE_SLOTS);
        expect(world.u.strikeA).toHaveLength(STRIKE_SLOTS);
        world.u.pulseA.forEach((slot, i) => expect(slot).toBe(pulses[i]));
        world.u.strikeA.forEach((slot, i) => expect(slot).toBe(strikes[i]));
        // The rings that remain are the newest ones: the oldest slots were written over.
        const births = world.u.pulseA.map((slot) => slot.value.x).sort((a, b) => a - b);
        expect(births).toEqual(times.slice(-PULSE_SLOTS));
        expect(inUse(world.u.strikeA, 3)).toHaveLength(STRIKE_SLOTS);
        expect(used(world.wisps, 'aFrom')).toHaveLength(WISP_SLOTS * WISP_TAIL);
        for (const [attribute, array] of pools) expect(attribute.array).toBe(array);
        expect(world.counts.wisps).toBe(total);
        world.dispose();
    });
});

describe('geode world: clears', () => {
    it('sends a wave from the heart, one front per line, and fires the rows out of the card', () => {
        const { world } = makeWorld('Low');
        world.onClear({ rows: [19, 18], lines: 2 });
        const slot = world.u.clearA[0].value;
        expect(slot.x).toBe(world.time);
        expect(slot.y).toBe(2);
        expect(slot.z).toBeGreaterThan(0);
        expect(slot.w).toBe(0); // not geodefire
        expect(peakOf(world.u.clearC[0].value)).toBeGreaterThan(0);
        const beams = world.rowBeams.uniforms;
        const board = world.layout.boards[0];
        const card = world.layout.cards[0];
        expect(beams.frame.value.x).toBeCloseTo(card.x0, 9);
        expect(beams.frame.value.y).toBeCloseTo(card.x1, 9);
        expect(beams.frame.value.z).toBe(world.time);
        expect(beams.frame.value.w).toBeGreaterThan(0);
        // Each blade at its own row's height: row 19 is the floor row, row 18 the one above it.
        expect(beams.rows.value.x).toBeCloseTo(boardPoint(board, 0.5, 19).y, 9);
        expect(beams.rows.value.y).toBeCloseTo(boardPoint(board, 0.5, 18).y, 9);
        expect(beams.rows.value.x).toBeGreaterThan(beams.rows.value.y);
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

    it('keeps the row beams dark unless a live board is on screen', () => {
        const { world } = makeWorld('Low', { live: false });
        world.onClear({ lines: 2 });
        expect(world.rowBeams.uniforms.frame.value.w).toBe(0);
        // The wave still runs.
        expect(world.u.clearA[0].value.x).toBe(world.time);
        expect(world.u.clearA[0].value.z).toBeGreaterThan(0);
        // The board appears: now they fire.
        world.setLayout(fallbackLayout(1600, 900), 1600 / 900);
        world.onClear({ lines: 2 });
        expect(world.rowBeams.uniforms.frame.value.w).toBeGreaterThan(0);
        world.dispose();
        // A click's clear has no rows to fire, board or not.
        const live = makeWorld('Low');
        live.world.onClear({ lines: 1, screen: { x: 0.15, y: 0.9 } });
        expect(live.world.rowBeams.uniforms.frame.value.w).toBe(0);
        expect(live.world.counts.clears).toBe(1);
        live.world.dispose();
    });

    it('answers one, two and three lines in different colours, ever stronger, and reuses its slots', () => {
        const { world } = makeWorld('Low');
        const slots = world.u.clearA.slice();
        world.onClear({ lines: 1 });
        const one = world.u.clearC[0].value.clone();
        const first = world.u.clearA[0].value.clone();
        world.onClear({ lines: 2 });
        const two = world.u.clearC[1 % CLEAR_SLOTS].value.clone();
        const second = world.u.clearA[1 % CLEAR_SLOTS].value.clone();
        world.onClear({ lines: 3 });
        const three = world.u.clearC[2 % CLEAR_SLOTS].value.clone();
        const third = world.u.clearA[2 % CLEAR_SLOTS].value.clone();
        expect(world.u.clearA).toHaveLength(CLEAR_SLOTS);
        world.u.clearA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        expect([first.y, second.y, third.y]).toEqual([1, 2, 3]);
        expect(one.distanceTo(two)).toBeGreaterThan(0.02);
        expect(one.distanceTo(three)).toBeGreaterThan(0.02);
        expect(two.distanceTo(three)).toBeGreaterThan(0.02);
        // Each is as bright as the others at its peak: only the hue tells them apart.
        expect(peakOf(two)).toBeCloseTo(peakOf(one), 6);
        expect(peakOf(three)).toBeCloseTo(peakOf(one), 6);
        expect(second.z).toBeGreaterThan(first.z);
        expect(third.z).toBeGreaterThan(second.z);
        // No line count is one line; more than four is four.
        world.onClear({});
        expect(world.u.clearA[3 % CLEAR_SLOTS].value.y).toBe(1);
        world.onClear({ lines: 9 });
        expect(world.u.clearA[4 % CLEAR_SLOTS].value.y).toBe(4);
        expect(world.counts.clears).toBe(5);
        world.dispose();
    });

    it('lets every crystal go of its light at the moment the wave passes it', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, hardDrop: true, color: '#ff70ff' });
        world.onLock({ u: 0.8, hardDrop: true, color: '#60ffff' });
        run(world, camera, Math.max(...flashes(world).map((flash) => flash.time)) - world.time + 0.05);
        const { held } = world.getState();
        expect(held).toBeGreaterThan(0);
        const holders = [];
        for (let i = 0; i < world.crystals.heroes; i++) if (world.crystals.heldAt(i, world.time) > 0) holders.push(i);
        expect(holders.length).toBeGreaterThan(1);
        const dust = used(world.shards, 'aBirth').length;

        const { storm } = world;
        const { aFlash, aRelease, aAux } = world.crystals.state;
        const struck = Array.from(aFlash);
        expect(flares(world)).toHaveLength(0);
        world.onClear({ lines: 2 });
        const birth = world.time;
        expect(world.storm).toBeGreaterThan(storm);
        // Nothing is lost yet: the wave has only just left the heart.
        expect(world.getState().held).toBeCloseTo(held, 9);
        // Every hero answers as the front reaches the ring of the wall it stands on...
        for (let i = 0; i < world.crystals.heroes; i++) {
            const pass = birth + clearPassTime(world.list[i].w);
            expect(aRelease[i * 4 + 3], `hero ${i}`).toBeCloseTo(pass, 4);
            expect(aAux[i * 4], `hero ${i}`).toBeCloseTo(pass, 4); // and is empty from then on
            expect(pass).toBeGreaterThan(birth);
            expect(pass).toBeLessThanOrEqual(birth + CLEAR_TRAVEL);
        }
        // ...those nearer the heart first. The crown is not a bell: it does not answer.
        const order = [...holders].sort((a, b) => world.list[a].w - world.list[b].w);
        for (let k = 1; k < order.length; k++) {
            expect(aRelease[order[k] * 4 + 3]).toBeGreaterThanOrEqual(aRelease[order[k - 1] * 4 + 3]);
        }
        expect(flares(world)).toHaveLength(world.crystals.heroes);
        for (let i = world.crystals.heroes; i < world.crystals.count; i++) {
            expect(aRelease[i * 4 + 3]).toBeLessThan(-50);
        }
        // The flare is the wave's own: what the sparks told the crystals to flash is as it was.
        expect(Array.from(aFlash)).toEqual(struck);
        // A crystal holds its light until the front arrives, and nothing after.
        for (const i of holders) {
            const pass = birth + clearPassTime(world.list[i].w);
            expect(world.crystals.heldAt(i, pass - 1e-3), `holder ${i}`).toBeGreaterThan(0);
            expect(world.crystals.heldAt(i, pass + 1e-3), `holder ${i}`).toBe(0);
        }
        // It flares in its own colour as it lets go: brighter than a crystal that held nothing.
        const empty = world.targets.left.find((i) => !holders.includes(i));
        expect(empty).toBeGreaterThanOrEqual(0);
        expect(peakIn(aRelease, empty)).toBeGreaterThan(0); // the wave lights it all the same
        expect(peakIn(aRelease, holders[0])).toBeGreaterThan(peakIn(aRelease, empty));
        // And throws dust from its tip.
        expect(used(world.shards, 'aBirth').length).toBeGreaterThan(dust);

        // Once the wave has passed, the geode holds nothing.
        let previous = held;
        for (let i = 0; i < 20; i++) {
            run(world, camera, (CLEAR_TRAVEL * 1.05) / 20);
            expect(world.getState().held).toBeLessThanOrEqual(previous);
            previous = world.getState().held;
        }
        expect(world.getState().held).toBe(0);
        for (const i of holders) expect(world.crystals.heldAt(i, world.time)).toBe(0);
        // And it can be filled again.
        world.onLock({ u: 0.2, color: '#ff70ff' });
        run(world, camera, Math.max(...flashes(world).map((flash) => flash.time)) - world.time + 0.05);
        expect(world.getState().held).toBeGreaterThan(0);
        world.dispose();
    });

    it('flashes twice for the piece that clears a line: as its spark lands, and again as the wave passes', () => {
        const { camera, world } = makeWorld('Low');
        const send = vi.spyOn(world, 'sendWisp');
        const { aFlash, aRelease, aAux } = world.crystals.state;
        const rgb = pieceColor('#60ffff');
        const t0 = world.time;
        // As the director delivers them: the lock, then its clear, in the same tick.
        world.onLock({ u: 0.2, color: '#60ffff' });
        const struck = Array.from(aFlash);
        const dust = used(world.shards, 'aBirth').length;
        world.onClear({ lines: 1 });
        const [target] = send.mock.calls[0];
        const arrive = send.mock.results[0].value;
        const pass = t0 + clearPassTime(world.list[target].w);
        expect(arrive).toBeLessThan(pass); // the spark is in before the wave gets there

        // The spark's flash is its own still, for the piece's crystal and for every one that chimes with it.
        expect(Array.from(aFlash)).toEqual(struck);
        expect(aFlash[target * 4 + 3]).toBeCloseTo(arrive, 4);
        expectHue(slotOf(aFlash, target), rgb, 4);
        // The wave's flare is set for the moment it passes, and so is the letting go.
        expect(aRelease[target * 4 + 3]).toBeCloseTo(pass, 4);
        expect(aAux[target * 4]).toBeCloseTo(pass, 4);
        // By then the crystal holds the spark's light: it flares with that, brighter than one the lock never reached...
        const reached = new Set(flashes(world).map((flash) => flash.index));
        const bare = world.targets.left.find((index) => !reached.has(index));
        expect(bare).toBeGreaterThanOrEqual(0);
        expect(peakIn(aRelease, target)).toBeGreaterThan(peakIn(aRelease, bare) * 1.5);
        // ...and throws dust from its tip as it does.
        const births = world.shards.geometry.getAttribute('aBirth').array;
        const { tip } = world.list[target];
        const thrown = used(world.shards, 'aBirth').filter((i) => Math.abs(births[i * 4 + 3] - pass) < 1e-4
            && Math.hypot(births[i * 4] - tip[0], births[i * 4 + 1] - tip[1], births[i * 4 + 2] - tip[2]) < 1e-3);
        expect(used(world.shards, 'aBirth').length).toBeGreaterThan(dust);
        expect(thrown.length).toBeGreaterThan(0);

        // And so it plays: dark, lit when the spark lands, emptied when the wave passes.
        expect(world.crystals.heldAt(target, arrive - 1e-3)).toBe(0);
        expect(world.crystals.heldAt(target, arrive + 1e-3)).toBeGreaterThan(0);
        expect(world.crystals.heldAt(target, pass - 1e-3)).toBeGreaterThan(0);
        expect(world.crystals.heldAt(target, pass + 1e-3)).toBe(0);
        run(world, camera, arrive - t0 + 0.05);
        expect(world.crystals.heldAt(target, world.time)).toBeGreaterThan(0);
        run(world, camera, pass - world.time + 0.05);
        expect(world.crystals.heldAt(target, world.time)).toBe(0);
        world.dispose();
    });

    it('lights no crystal ahead of its spark when the next piece locks while a clear\'s wave is on its way', () => {
        const { camera, world } = makeWorld('Low');
        const strike = vi.spyOn(world.crystals, 'strike');
        world.onLock({ u: 0.2, hardDrop: true, color: '#60ffff' }); // the piece that completes the line
        world.onClear({ lines: 1 }); // its wave leaves the heart
        const promised = new Map(strike.mock.calls.map(([index, , arrive]) => [index, arrive]));
        run(world, camera, 0.3); // the next piece comes down
        expect(world.getState().held).toBe(0); // nothing has landed yet
        const before = heldNow(world);
        strike.mockClear();
        world.onLock({ u: 0.2, hardDrop: true, color: '#ffd060' });
        // It promises more light to crystals the first piece's sparks are still flying to...
        const again = strike.mock.calls.filter(([index]) => promised.get(index) > world.time);
        expect(again.length).toBeGreaterThan(0);
        // ...and none of them shows any of it yet.
        expect(changedSince(world, before)).toEqual([]);
        expect(world.getState().held).toBe(0);
        // Each lights when the first spark promised to it lands, not before.
        for (const [index] of again) {
            const lands = world.crystals.state.aStore[index * 4 + 3];
            expect(lands, `crystal ${index}`).toBeGreaterThan(world.time);
            expect(world.crystals.heldAt(index, lands - 1e-3), `crystal ${index}`).toBe(0);
            expect(world.crystals.heldAt(index, lands + 1e-3), `crystal ${index}`).toBeGreaterThan(0);
        }
        world.dispose();
    });

    it('lights no crystal ahead of its spark however soon the next piece follows a clear, at every tier', () => {
        for (const quality of ['Minimal', 'Low', 'High']) {
            const { camera, world } = makeWorld(quality);
            const strike = vi.spyOn(world.crystals, 'strike');
            for (const gap of [0.2, 0.4, 0.6]) {
                let struckAgain = 0;
                for (let i = 0; i < 40; i++) {
                    const label = `${quality}, ${gap} s after the clear, trial ${i}`;
                    const u = i % 2 ? 0.8 : 0.2;
                    strike.mockClear();
                    world.onLock({ u, hardDrop: true, color: '#60ffff' });
                    world.onClear({ lines: 1 + (i % 3) });
                    const promised = new Map(strike.mock.calls.map(([index, , arrive]) => [index, arrive]));
                    run(world, camera, gap, 3);
                    const before = heldNow(world);
                    strike.mockClear();
                    world.onLock({ u, hardDrop: true, color: '#ffd060' });
                    if (strike.mock.calls.some(([index]) => promised.get(index) > world.time)) struckAgain += 1;
                    expect(changedSince(world, before), label).toEqual([]);
                    // Let the sparks land and the wave go by before the next pair.
                    run(world, camera, 2.6, 13);
                }
                // The trials do put the case: a crystal struck again with a spark in flight and a wave due.
                expect(struckAgain, `${quality}, ${gap} s`).toBeGreaterThan(0);
            }
            world.dispose();
        }
    });

    it('takes with the wave the light that lands while the wave is on its way', () => {
        const { camera, world } = makeWorld('Low');
        // The crystal the wave reaches last: time for three sparks to land before it does.
        const [target] = [...world.targets.left].sort((a, b) => world.list[b].w - world.list[a].w);
        const from = world.screenToWorld(0.3, 0.5, SPARK_DEPTH, [0, 0, 0]);
        const warm = [1, 0.5, 0.2];
        const cool = [0.2, 0.5, 1];
        const green = [0.3, 1, 0.3];
        const { aRelease, aAux } = world.crystals.state;
        const t0 = world.time;
        const first = world.sendWisp(target, from, warm, 0.85);
        world.onClear({ lines: 1 });
        const pass = t0 + clearPassTime(world.list[target].w);
        expect(first).toBeLessThan(pass);
        const flare = slotOf(aRelease, target);
        expect(flare[3]).toBeCloseTo(pass, 4);

        // A second spark, sent while the first is in flight: it joins it, and the wave will take both.
        run(world, camera, 0.1);
        const second = world.sendWisp(target, from, cool, 0.85);
        expect(first).toBeGreaterThan(world.time);
        expect(second).toBeLessThan(pass);
        expect(world.crystals.heldAt(target, world.time)).toBe(0);
        const both = world.crystals.heldAt(target, first + 1e-3);
        expect(both).toBeGreaterThan(0);
        // The letting go still stands for the moment the wave passes, and its flare has the second spark's colour in it.
        expect(aAux[target * 4]).toBeCloseTo(pass, 4);
        const flareTwo = slotOf(aRelease, target);
        expect(flareTwo[3]).toBe(flare[3]);
        expectHue(flareTwo.slice(0, 3).map((v, c) => v - flare[c]), cool, 3);

        // A third, sent once those have landed and still landing before the wave: the same.
        run(world, camera, first - world.time + 0.05);
        const lit = world.crystals.heldAt(target, world.time);
        expect(lit).toBeGreaterThan(0);
        const third = world.sendWisp(target, from, green, 0.6);
        expect(third).toBeLessThan(pass);
        expect(world.crystals.heldAt(target, world.time)).toBeCloseTo(lit, 5); // no more until it lands
        expect(world.crystals.heldAt(target, third + 1e-3)).toBeGreaterThan(lit);
        expect(aAux[target * 4]).toBeCloseTo(pass, 4);
        const flareThree = slotOf(aRelease, target);
        expect(flareThree[3]).toBe(flare[3]);
        expectHue(flareThree.slice(0, 3).map((v, c) => v - flareTwo[c]), green, 3);

        // All of it is there until the wave arrives, and none after.
        expect(world.crystals.heldAt(target, pass - 1e-3)).toBeGreaterThan(both);
        expect(world.crystals.heldAt(target, pass + 1e-3)).toBe(0);
        run(world, camera, pass - world.time - 0.02);
        expect(world.crystals.heldAt(target, world.time)).toBeGreaterThan(both);
        run(world, camera, 0.04);
        expect(world.crystals.heldAt(target, world.time)).toBe(0);
        // Emptied, it can be filled again.
        run(world, camera, 1);
        const again = world.sendWisp(target, from, warm, 0.85);
        expect(world.crystals.heldAt(target, again + 1e-3)).toBeGreaterThan(0);
        expect(world.crystals.heldAt(target, again + 5)).toBeGreaterThan(0);
        world.dispose();
    });

    it('keeps the light of a spark that lands after the wave has passed, and only that light', () => {
        const { camera, world } = makeWorld('Low');
        const [target] = world.targets.left;
        const from = world.screenToWorld(0.3, 0.5, SPARK_DEPTH, [0, 0, 0]);
        const warm = [1, 0.5, 0.2];
        const cool = [0.2, 0.5, 1];
        const { aStore, aRelease, aAux } = world.crystals.state;
        // A crystal holding a warm light.
        const filled = world.sendWisp(target, from, warm, 0.85);
        run(world, camera, filled - world.time + 0.3);
        const had = world.crystals.heldAt(target, world.time);
        expect(had).toBeGreaterThan(0);
        const t0 = world.time;
        world.onClear({ lines: 1 });
        const pass = t0 + clearPassTime(world.list[target].w);
        const flare = slotOf(aRelease, target);

        // A cool spark is sent just before the wave reaches the crystal: it will land after the wave has gone by.
        run(world, camera, pass - t0 - 0.3);
        const before = world.crystals.heldAt(target, world.time);
        const land = world.sendWisp(target, from, cool, 0.85);
        expect(world.time).toBeLessThan(pass);
        expect(land).toBeGreaterThan(pass);
        // Until the wave arrives the crystal shows what it held: the warm light, and no more.
        expect(world.crystals.heldAt(target, world.time)).toBeCloseTo(before, 5);
        expect(world.crystals.heldAt(target, pass - 1e-3)).toBeGreaterThan(0);
        expect(world.crystals.heldAt(target, pass - 1e-3)).toBeLessThan(had);
        // The wave takes that, as it was always going to: the same flare, at the same moment.
        expect(aAux[target * 4]).toBeCloseTo(pass, 4);
        expect(slotOf(aRelease, target)).toEqual(flare);
        expect(world.crystals.heldAt(target, pass + 1e-3)).toBe(0);
        expect(world.crystals.heldAt(target, land - 1e-3)).toBe(0);
        // Then the spark lands in an empty crystal and stays: the cool light alone, none of the warm.
        const kept = world.crystals.heldAt(target, land + 1e-3);
        expect(kept).toBeGreaterThan(0);
        expectHue(slotOf(aStore, target).slice(0, 3), cool, 4);
        expect(world.crystals.heldAt(target, land + STORE_HOLD)).toBeCloseTo(kept * Math.exp(-1), 3);

        // Played through: lit, emptied by the wave, lit again by the spark, and still lit long after.
        run(world, camera, pass - world.time + 0.02);
        expect(world.crystals.heldAt(target, world.time)).toBe(0);
        run(world, camera, land - world.time + 0.05);
        expect(world.crystals.heldAt(target, world.time)).toBeCloseTo(kept, 2);
        run(world, camera, 4, 80);
        expect(world.crystals.heldAt(target, world.time)).toBeGreaterThan(kept * 0.8);
        // The next wave takes it like any other light.
        const t1 = world.time;
        world.onClear({ lines: 1 });
        const next = t1 + clearPassTime(world.list[target].w);
        expect(world.crystals.heldAt(target, next - 1e-3)).toBeGreaterThan(0);
        expect(world.crystals.heldAt(target, next + 1e-3)).toBe(0);
        world.dispose();
    });

    it('keeps both of two waves due at a crystal, the earlier first, and lets go as the first one passes', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, hardDrop: true, color: '#ff70ff' });
        world.onLock({ u: 0.8, hardDrop: true, color: '#60ffff' });
        run(world, camera, Math.max(...flashes(world).map((flash) => flash.time)) - world.time + 0.05);
        const holders = [];
        for (let i = 0; i < world.crystals.heroes; i++) if (world.crystals.heldAt(i, world.time) > 0) holders.push(i);
        expect(holders.length).toBeGreaterThan(1);
        const { aRelease } = world.crystals.state;

        const first = world.time;
        world.onClear({ lines: 1 });
        for (let i = 0; i < world.crystals.heroes; i++) expect(cutsOf(world, i)[1], `hero ${i}`).toBe(Infinity);
        // The second wave leaves while the first is part of the way along the wall.
        run(world, camera, 1.3);
        const second = world.time;
        world.onClear({ lines: 2 });
        const due = { both: 0, second: 0 };
        for (let i = 0; i < world.crystals.heroes; i++) {
            const reach = clearPassTime(world.list[i].w);
            const [earlier, later] = cutsOf(world, i);
            if (first + reach > second) {
                // The first wave has yet to reach it: both are due, in the order they will pass it...
                due.both += 1;
                expect(earlier, `hero ${i}`).toBeCloseTo(first + reach, 4);
                expect(later, `hero ${i}`).toBeCloseTo(second + reach, 4);
                // ...and the flare set for the first is not put off by the second.
                expect(aRelease[i * 4 + 3], `hero ${i}`).toBeCloseTo(first + reach, 4);
            } else {
                // The first has been and gone: only the second is due.
                due.second += 1;
                expect(earlier, `hero ${i}`).toBeCloseTo(second + reach, 4);
                expect(later, `hero ${i}`).toBe(Infinity);
                expect(aRelease[i * 4 + 3], `hero ${i}`).toBeCloseTo(second + reach, 4);
            }
        }
        expect(due.both).toBeGreaterThan(0);
        expect(due.second).toBeGreaterThan(0);
        // The crown is not a bell: no wave is ever due at it.
        for (let i = world.crystals.heroes; i < world.crystals.count; i++) {
            expect(cutsOf(world, i)).toEqual([Infinity, Infinity]);
        }
        // Every crystal that held light when the first wave left has let it go by the time that wave has passed it.
        let waited = 0;
        for (const i of holders) {
            const pass = first + clearPassTime(world.list[i].w);
            if (pass > second) {
                waited += 1;
                expect(world.crystals.heldAt(i, pass - 1e-3), `holder ${i}`).toBeGreaterThan(0);
            }
            expect(world.crystals.heldAt(i, Math.max(pass, second) + 1e-3), `holder ${i}`).toBe(0);
        }
        expect(waited).toBeGreaterThan(0);
        // And the geode is empty once both have run their course.
        run(world, camera, CLEAR_TRAVEL * 1.05);
        expect(world.getState().held).toBe(0);
        world.dispose();
    });

    it('takes with a second clear the light its own piece brought, the first wave still on the wall', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, color: '#60ffff' });
        world.onClear({ lines: 1 });
        const first = world.time;
        run(world, camera, 1); // a second later the next piece clears another line
        const strike = vi.spyOn(world.crystals, 'strike');
        world.onLock({ u: 0.2, color: '#ffd060' });
        world.onClear({ lines: 1 });
        const second = world.time;
        const { aStore } = world.crystals.state;
        const struck = [...new Set(strike.mock.calls.map(([index]) => index))];
        expect(struck.length).toBeGreaterThan(1);
        const taken = { byFirst: 0, bySecond: 0, byNeither: 0 };
        for (const k of struck) {
            const label = `crystal ${k}`;
            const reach = clearPassTime(world.list[k].w);
            const lands = aStore[k * 4 + 3];
            expect(lands, label).toBeGreaterThan(second);
            // Light is taken by the first wave to pass its crystal once it has landed there.
            const passes = [first + reach, second + reach];
            const taker = passes.findIndex((pass) => pass >= lands);
            taken[['byFirst', 'bySecond'][taker] || 'byNeither'] += 1;
            if (taker < 0) {
                // The last of a chime can land after both waves have gone by: it stays.
                expect(world.crystals.heldAt(k, lands + 1), label).toBeGreaterThan(0);
            } else {
                if (lands < passes[taker] - 0.01) {
                    expect(world.crystals.heldAt(k, lands + 1e-3), label).toBeGreaterThan(0);
                    expect(world.crystals.heldAt(k, passes[taker] - 1e-3), label).toBeGreaterThan(0);
                }
                expect(world.crystals.heldAt(k, passes[taker] + 1e-3), label).toBe(0);
                expect(world.crystals.heldAt(k, second + reach + 1), label).toBe(0);
            }
        }
        // The piece's light lands after the first wave has passed its crystal and before its own wave does.
        expect(taken.bySecond).toBeGreaterThan(0);
        // Played through: every crystal a wave was to empty is empty once the second has run its course.
        run(world, camera, CLEAR_TRAVEL + 0.1);
        for (const k of struck) {
            if (aStore[k * 4 + 3] <= second + clearPassTime(world.list[k].w)) {
                expect(world.crystals.heldAt(k, world.time), `crystal ${k}`).toBe(0);
            }
        }
        world.dispose();
    });

    it('takes a crystal\'s old light for good when the wave passes before a spark already sent has landed', () => {
        const { camera, world } = makeWorld('Low');
        const { crystals } = world;
        const { aStore } = crystals.state;
        // Three neighbours, the nearest the heart first: `bare` holds nothing, `full` a warm light,
        // and `brim` all a crystal can hold, of a pale light.
        const [bare, full, brim] = world.targets.left.slice(0, 3).sort((a, b) => world.list[a].w - world.list[b].w);
        const warm = [1, 0.5, 0.2];
        const pale = [0.8, 0.9, 1];
        const cool = [0.2, 0.5, 1];
        crystals.strike(full, warm, world.time, 1, world.time);
        for (let i = 0; i < 6; i++) crystals.strike(brim, pale, world.time, 4, world.time);
        run(world, camera, 1);
        const now = world.time;
        expect(crystals.heldAt(full, now)).toBeGreaterThan(0);
        expect(crystals.heldAt(brim, now)).toBeGreaterThan(STORE_MAX * 0.9);
        expect(crystals.heldAt(bare, now)).toBe(0);
        const passOf = (i) => now + clearPassTime(world.list[i].w);
        const land = passOf(brim) + 0.3;
        // The same cool spark is sent to each, to land after...
        for (const i of [bare, full, brim]) crystals.strike(i, cool, land, 1.3, now);
        // Until then the brim-full one would have had to make room: the spark's light on top is over the fill.
        expect(Math.max(...slotOf(aStore, brim).slice(0, 3))).toBeCloseTo(STORE_MAX, 5);
        // ...the wave that leaves in the same tick has passed them.
        const { amounts } = crystals.release(now, [1, 1, 1], 1, { now });
        const alone = crystals.heldAt(bare, land + 1e-3);
        expect(alone).toBeGreaterThan(0);
        for (const i of [full, brim]) {
            const label = i === full ? 'full' : 'brim';
            // The wave finds the old light there, and takes it.
            const found = crystals.heldAt(i, passOf(i) - 1e-3);
            expect(found, label).toBeGreaterThan(0);
            expect(amounts[i], label).toBeCloseTo(found, 3);
            expect(crystals.heldAt(i, passOf(i) + 1e-3), label).toBe(0);
            expect(crystals.heldAt(i, land - 1e-3), label).toBe(0);
            // When the spark lands, the cool light alone is in the stone: none of the old has come back,
            // however full the crystal had been.
            expectHue(slotOf(aStore, i).slice(0, 3), cool, 3);
            expect(crystals.heldAt(i, land + 1e-3), label).toBeGreaterThan(0);
            expect(crystals.heldAt(i, land + 1e-3), label).toBeLessThanOrEqual(alone + 1e-6);
        }
        // Each holds exactly what the one that had held none does: a little light before, or all it could take.
        for (const i of [full, brim]) {
            expect(crystals.heldAt(i, land + 1e-3)).toBeCloseTo(alone, 5);
            expect(crystals.heldAt(i, land + 5)).toBeCloseTo(crystals.heldAt(bare, land + 5), 5);
            for (let c = 0; c < 3; c++) expect(aStore[i * 4 + c]).toBeCloseTo(aStore[bare * 4 + c], 5);
        }
        world.dispose();
    });

    it('lets a single clear inside a four-line clear\'s hush cut first, the fracture\'s own wave after it', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, hardDrop: true, color: '#ff70ff' });
        world.onLock({ u: 0.8, hardDrop: true, color: '#60ffff' });
        run(world, camera, Math.max(...flashes(world).map((flash) => flash.time)) - world.time + 0.05);
        const holders = [];
        for (let i = 0; i < world.crystals.heroes; i++) if (world.crystals.heldAt(i, world.time) > 0) holders.push(i);
        expect(holders.length).toBeGreaterThan(1);
        const { aAux, aRelease } = world.crystals.state;

        // Four lines: the geode holds its breath, and its wave leaves when it lets go.
        const quad = world.time + HUSH_HOLD;
        world.onClear({ lines: 4 });
        for (let i = 0; i < world.crystals.heroes; i++) {
            expect(aRelease[i * 4 + 3], `hero ${i}`).toBeCloseTo(quad + clearPassTime(world.list[i].w), 4);
        }
        // Before it has, another line is cleared: that wave leaves at once, ahead of the fracture's.
        run(world, camera, HUSH_HOLD * 0.45);
        const single = world.time;
        expect(single).toBeLessThan(quad);
        world.onClear({ lines: 1 });
        expect(world.u.clearA[0].value.x).toBeCloseTo(quad, 9);
        expect(world.u.clearA[1].value.x).toBeCloseTo(single, 9);
        let lances = 0;
        for (let i = 0; i < world.crystals.heroes; i++) {
            const reach = clearPassTime(world.list[i].w);
            // Both are due at every crystal: the single's wave first, though it was the second to be cleared.
            const [earlier, later] = cutsOf(world, i);
            expect(earlier, `hero ${i}`).toBeCloseTo(single + reach, 4);
            expect(later, `hero ${i}`).toBeCloseTo(quad + reach, 4);
            // The flare that is set is for the wave that gets there first.
            expect(aRelease[i * 4 + 3], `hero ${i}`).toBeCloseTo(single + reach, 4);
            // The lance still leaves with the fracture's wave, from the tallest of each cluster.
            expect(aAux[i * 4 + 1], `hero ${i}`).toBeCloseTo(quad + reach, 4);
            if (world.list[i].main) {
                lances += 1;
                expect(aAux[i * 4 + 2], `hero ${i}`).toBeGreaterThan(0);
            } else {
                expect(aAux[i * 4 + 2], `hero ${i}`).toBe(0);
            }
        }
        expect(lances).toBeGreaterThan(0);
        // What a crystal holds goes with the first wave to pass it, and is not back for the second.
        for (const i of holders) {
            const reach = clearPassTime(world.list[i].w);
            expect(world.crystals.heldAt(i, single + reach - 1e-3), `holder ${i}`).toBeGreaterThan(0);
            expect(world.crystals.heldAt(i, single + reach + 1e-3), `holder ${i}`).toBe(0);
            expect(world.crystals.heldAt(i, quad + reach + 1e-3), `holder ${i}`).toBe(0);
        }
        // One crystal, frame by frame: it flares as the single's wave passes it, and again as the fracture's does.
        const [watched] = holders;
        const reach = clearPassTime(world.list[watched].w);
        run(world, camera, single + reach - world.time + 0.01);
        expect(aRelease[watched * 4 + 3]).toBeCloseTo(single + reach, 4);
        expect(world.crystals.heldAt(watched, world.time)).toBe(0);
        expect(peakIn(aRelease, watched)).toBeGreaterThan(0);
        run(world, camera, quad + reach - world.time + 0.01);
        expect(aRelease[watched * 4 + 3]).toBeCloseTo(quad + reach, 4);
        expect(peakIn(aRelease, watched)).toBeGreaterThan(0);
        // In the end every crystal has flared for the fracture's wave, the last to pass it.
        run(world, camera, HUSH_HOLD + CLEAR_TRAVEL * 1.05);
        for (let i = 0; i < world.crystals.heroes; i++) {
            expect(aRelease[i * 4 + 3], `hero ${i}`).toBeCloseTo(quad + clearPassTime(world.list[i].w), 4);
        }
        expect(world.getState().held).toBe(0);
        world.dispose();
    });

    it('answers the waves the shaders still draw when a third leaves the heart: the oldest is forgotten', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, hardDrop: true, color: '#ff70ff' });
        world.onLock({ u: 0.8, hardDrop: true, color: '#60ffff' });
        run(world, camera, Math.max(...flashes(world).map((flash) => flash.time)) - world.time + 0.05);
        const holders = [];
        for (let i = 0; i < world.crystals.heroes; i++) if (world.crystals.heldAt(i, world.time) > 0) holders.push(i);
        expect(holders.length).toBeGreaterThan(1);
        const { aRelease } = world.crystals.state;

        const born = [world.time];
        world.onClear({ lines: 1 });
        run(world, camera, 0.7);
        born.push(world.time);
        world.onClear({ lines: 2 });
        run(world, camera, 0.55);
        const flaresBefore = Array.from(aRelease);
        born.push(world.time);
        world.onClear({ lines: 3 });
        expect(world.counts.clears).toBe(3);
        // The shaders have a slot for each of the last waves only: the third is written over the first.
        const drawn = world.u.clearA.map((slot) => slot.value.x).sort((a, b) => a - b);
        expect(drawn).toEqual(born.slice(-CLEAR_SLOTS));
        expect(drawn).not.toContain(born[0]);
        const seen = { forgot: 0, passed: 0 };
        for (let i = 0; i < world.crystals.heroes; i++) {
            const label = `hero ${i}`;
            const reach = clearPassTime(world.list[i].w);
            // Every crystal is due to answer the waves that are drawn and have yet to reach it: those, and no other.
            const due = drawn.map((birth) => birth + reach).filter((pass) => pass > world.time);
            const cuts = cutsOf(world, i).filter((cut) => Number.isFinite(cut));
            expect(cuts, label).toHaveLength(due.length);
            cuts.forEach((cut, k) => expect(cut, label).toBeCloseTo(due[k], 4));
            if (born[0] + reach > born[2]) {
                // The first wave had yet to reach it: the flare that waited for that wave waits for the second
                // instead, with the second's own in it.
                seen.forgot += 1;
                expect(aRelease[i * 4 + 3], label).toBeCloseTo(born[1] + reach, 4);
                expect(peakIn(aRelease, i), label).toBeGreaterThan(peakIn(flaresBefore, i));
            } else {
                seen.passed += 1;
            }
        }
        expect(seen.forgot).toBeGreaterThan(0);
        expect(seen.passed).toBeGreaterThan(0);
        // What a crystal held goes with the first wave to pass it that is still drawn then: the first wave if it
        // had been by before the third left, the second if not.
        let kept = 0;
        for (const i of holders) {
            const reach = clearPassTime(world.list[i].w);
            const first = born[0] + reach;
            const taker = first > born[2] ? born[1] + reach : first;
            if (first > born[2]) {
                kept += 1;
                expect(world.crystals.heldAt(i, first + 1e-3), `holder ${i}`).toBeGreaterThan(0); // no wave is there
                expect(world.crystals.heldAt(i, taker - 1e-3), `holder ${i}`).toBeGreaterThan(0);
            }
            expect(world.crystals.heldAt(i, Math.max(taker, born[2]) + 1e-3), `holder ${i}`).toBe(0);
        }
        expect(kept).toBeGreaterThan(0);
        run(world, camera, CLEAR_TRAVEL * 1.05);
        expect(world.getState().held).toBe(0);
        world.dispose();
    });

    it('forgets the wave the shaders stop drawing when a third follows a single inside a fracture\'s hush', () => {
        const { camera, world, holders } = litWorld();
        const { aRelease } = world.crystals.state;
        // Four lines, another line inside the hush, and a third wave while both are on the wall.
        const quad = world.time + HUSH_HOLD;
        world.onClear({ lines: 4 });
        run(world, camera, HUSH_HOLD * 0.45);
        const single = world.time;
        world.onClear({ lines: 1 });
        run(world, camera, 0.4);
        const third = world.time;
        world.onClear({ lines: 2 });
        // The third is written over the oldest wave, the fracture's: though that one would have passed the
        // crystals AFTER the single's.
        const drawn = world.u.clearA.map((slot) => slot.value.x).sort((a, b) => a - b);
        expect(drawn[0]).toBeCloseTo(single, 9);
        expect(drawn[1]).toBeCloseTo(third, 9);
        expect(single).toBeLessThan(quad);
        for (let i = 0; i < world.crystals.heroes; i++) {
            const label = `hero ${i}`;
            const reach = clearPassTime(world.list[i].w);
            // Every crystal answers the waves that are drawn: the single's and the third's, not the fracture's.
            const [earlier, later] = cutsOf(world, i);
            expect(earlier, label).toBeCloseTo(single + reach, 4);
            expect(later, label).toBeCloseTo(third + reach, 4);
        }
        // What a crystal holds goes with the single's wave, and the wall is dark where the fracture's would be.
        for (const i of holders) {
            const reach = clearPassTime(world.list[i].w);
            expect(world.crystals.heldAt(i, single + reach - 1e-3), `holder ${i}`).toBeGreaterThan(0);
            expect(world.crystals.heldAt(i, single + reach + 1e-3), `holder ${i}`).toBe(0);
        }
        // Played through, each crystal flares for the single's wave and then for the third's: never for a
        // wave that is not there.
        const [watched] = holders;
        const reach = clearPassTime(world.list[watched].w);
        run(world, camera, single + reach - world.time + 0.01);
        expect(aRelease[watched * 4 + 3]).toBeCloseTo(single + reach, 4);
        run(world, camera, quad + reach - world.time + 0.01);
        expect(aRelease[watched * 4 + 3]).toBeCloseTo(single + reach, 4);
        run(world, camera, third + reach - world.time + 0.01);
        expect(aRelease[watched * 4 + 3]).toBeCloseTo(third + reach, 4);
        run(world, camera, CLEAR_TRAVEL);
        expect(world.getState().held).toBe(0);
        world.dispose();
    });

    it('keeps a crystal\'s old light under a spark when the wave that would have taken it first is forgotten', () => {
        const warm = [1, 0.5, 0.2];
        const cool = [0.2, 0.5, 1];
        // Twice: with the second wave leaving late, so that nothing passes the crystal before the spark lands
        // once the first is forgotten; and with it leaving on the first one's heels, so that it still does.
        for (const secondAfter of [0.8, 0.05]) {
            const label = `second wave ${secondAfter} s after the first`;
            const { camera, world } = makeWorld('Low');
            const [target] = world.targets.left;
            const from = world.screenToWorld(0.3, 0.5, SPARK_DEPTH, [0, 0, 0]);
            const reach = clearPassTime(world.list[target].w);
            const { aStore, aPrev } = world.crystals.state;
            const filled = world.sendWisp(target, from, warm, 0.85);
            run(world, camera, filled - world.time + 0.3); // the crystal holds a warm light
            const t0 = world.time;
            let lands = 0;
            // (seconds after the first wave leaves, in order)
            const script = [
                [0, () => world.onClear({ lines: 1 })], // a first wave, due at the crystal at t0 + reach
                [0.7, () => { lands = world.sendWisp(target, from, cool, 0.85); }], // a spark to land after that
                [secondAfter, () => world.onClear({ lines: 1 })],
                [0.9, () => world.onClear({ lines: 1 })], // a third wave: the first is no longer drawn
            ].sort((a, b) => a[0] - b[0]);
            for (const [at, event] of script) {
                const wait = t0 + at - world.time;
                if (wait > 1e-9) run(world, camera, wait);
                event();
            }
            expect(lands, label).toBeGreaterThan(t0 + reach); // the first wave would have taken the warm light first
            expect(world.time, label).toBeLessThan(t0 + reach); // ...but it is forgotten before it gets there
            expect(world.u.clearA.map((slot) => slot.value.x), label).not.toContain(t0);
            const [earlier, later] = cutsOf(world, target);
            expect(earlier, label).toBeCloseTo(t0 + secondAfter + reach, 4);
            expect(later, label).toBeCloseTo(t0 + 0.9 + reach, 4);
            const before = world.crystals.heldAt(target, lands - 1e-3);
            const brought = slotOf(aStore, target).slice(0, 3).map((v, c) => v - aPrev[target * 3 + c]);
            if (earlier > lands) {
                // No wave now passes the crystal before the spark lands: the warm light is there until it
                // does, and still there under the cool once it has.
                expect(before, label).toBeGreaterThan(0);
                expect(world.crystals.heldAt(target, lands + 1e-3), label).toBeGreaterThan(before);
                expect(aStore[target * 4], label).toBeGreaterThan(before); // the warm light's red
                expectHue(brought, cool, 3); // and on top of it, exactly what the spark brings
                // The next wave takes both.
                expect(world.crystals.heldAt(target, earlier + 1e-3), label).toBe(0);
            } else {
                // The second wave still passes before the spark lands: it takes the warm light, and the spark
                // lands in an empty crystal.
                expect(world.crystals.heldAt(target, earlier - 1e-3), label).toBeGreaterThan(0);
                expect(before, label).toBe(0);
                expectHue(slotOf(aStore, target).slice(0, 3), cool, 3);
                expect(world.crystals.heldAt(target, lands + 1e-3), label).toBeGreaterThan(0);
                expect(world.crystals.heldAt(target, later + 1e-3), label).toBe(0);
            }
            world.dispose();
        }
    });

    it('flares a crystal for the second of two waves too, in the colour of the light that wave takes', () => {
        const { camera, world } = makeWorld('Low');
        const [target] = world.targets.left;
        const [bare] = world.targets.right;
        const from = world.screenToWorld(0.3, 0.5, SPARK_DEPTH, [0, 0, 0]);
        const warm = [1, 0.5, 0.2];
        const cool = [0.2, 0.5, 1];
        const { aRelease } = world.crystals.state;
        const reach = clearPassTime(world.list[target].w);
        // A piece clears a line; a second later the next one does.
        const t0 = world.time;
        world.sendWisp(target, from, warm, 0.85);
        world.onClear({ lines: 1 });
        run(world, camera, 1);
        const t1 = world.time;
        const lands = world.sendWisp(target, from, cool, 0.85);
        world.onClear({ lines: 1 });
        const passes = [t0 + reach, t1 + reach];
        // The first wave is still on its way to the crystal; the second piece's light lands between the two.
        expect(passes[0]).toBeGreaterThan(t1);
        expect(lands).toBeGreaterThan(passes[0]);
        expect(lands).toBeLessThan(passes[1]);
        expect(cutsOf(world, target)[0]).toBeCloseTo(passes[0], 4);
        expect(cutsOf(world, target)[1]).toBeCloseTo(passes[1], 4);

        // As the first wave passes: its flare, and the first piece's light is gone.
        run(world, camera, passes[0] - world.time + 0.005);
        expect(aRelease[target * 4 + 3]).toBeCloseTo(passes[0], 4);
        expect(world.crystals.heldAt(target, world.time)).toBe(0);
        // The second piece's light lands, and is there until its own wave arrives.
        run(world, camera, lands - world.time + 0.02);
        const lit = world.crystals.heldAt(target, world.time);
        expect(lit).toBeGreaterThan(0);
        run(world, camera, passes[1] - world.time - 0.1);
        expect(aRelease[target * 4 + 3]).toBeCloseTo(passes[0], 4); // the first flare still has the slot
        expect(world.crystals.heldAt(target, world.time)).toBeGreaterThan(lit * 0.9);
        // As the second wave passes: its own flare, set for that very moment, and the light is gone.
        run(world, camera, passes[1] - world.time + 0.005);
        expect(aRelease[target * 4 + 3]).toBeCloseTo(passes[1], 4);
        expect(world.crystals.heldAt(target, world.time)).toBe(0);
        expect(world.crystals.heldAt(target, passes[1] + 1e-3)).toBe(0);
        // The flare has the second piece's colour in it: over what a crystal no spark reached flares with.
        run(world, camera, clearPassTime(world.list[bare].w) + 0.1);
        expect(aRelease[bare * 4 + 3]).toBeCloseTo(t1 + clearPassTime(world.list[bare].w), 4);
        const own = slotOf(aRelease, target).slice(0, 3).map((v, c) => v - aRelease[bare * 4 + c]);
        expectHue(own, cool, 3);
        expect(world.getState().held).toBe(0);
        world.dispose();
    });

    it('flares every crystal as each wave of a run of clears passes it, whatever the pace, even or not', () => {
        const even = (gap) => Array.from({ length: 6 }, (_, n) => Math.round(n * gap * 60));
        // The frames (60 a second) on which a line is cleared, and whether three waves are ever on the wall
        // at once: the oldest is then written over before it gets to the far crystals.
        const paces = [
            ['every 0.6 s', even(0.6), true],
            ['every second', even(1), false],
            ['every 1.5 s', even(1.5), false],
            // Uneven: the fourth leaves once the first has been by the near crystals, with the second and
            // the third still due there.
            ['at 0, 1.0, 1.4 and 1.8 s', [0, 60, 84, 108], true],
            ['in a flurry', [0, 20, 50, 75, 110, 130, 190, 200], true],
        ];
        for (const [label, frames, crowded] of paces) {
            const { camera, world } = makeWorld('Low');
            const { aRelease } = world.crystals.state;
            const { heroes } = world.crystals;
            const born = [];
            const tally = { flared: 0, forgotten: 0 };
            for (let frame = 0; frame < frames[frames.length - 1] + 150; frame++) {
                // A line, or two, or three.
                if (frames.includes(frame)) {
                    born.push(world.time);
                    world.onClear({ lines: 1 + (born.length % 3) });
                }
                const before = world.time;
                run(world, camera, 1 / 60, 1);
                const drawn = world.u.clearA.map((slot) => slot.value.x);
                for (let n = 0; n < born.length; n++) {
                    for (let i = 0; i < heroes; i++) {
                        const pass = born[n] + clearPassTime(world.list[i].w);
                        if (pass > before && pass <= world.time) {
                            if (drawn.includes(born[n])) {
                                // On the frame a wave that is still drawn passes a crystal, the flare is that wave's.
                                tally.flared += 1;
                                expect(aRelease[i * 4 + 3], `${label}: wave ${n}, hero ${i}`).toBeCloseTo(pass, 4);
                            } else {
                                tally.forgotten += 1;
                            }
                        }
                    }
                }
            }
            // Every wave has been by every crystal, drawn or not.
            expect(tally.flared + tally.forgotten, label).toBe(frames.length * heroes);
            expect(tally.flared, label).toBeGreaterThan(0);
            if (crowded) expect(tally.forgotten, label).toBeGreaterThan(0);
            else expect(tally.forgotten, label).toBe(0);
            expect(world.getState().held).toBe(0);
            world.dispose();
        }
    });

    it('swells the heart\'s shafts at once and kicks the camera a beat after a clear', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        world.onClear({ lines: 2 });
        expect(world.kick).toBe(0);
        run(world, camera, 1 / 120, 1);
        const post = world.getPostState();
        expect(post.shafts).toBeGreaterThan(rest.shafts);
        expect(post.bloomBoost).toBeGreaterThan(rest.bloomBoost);
        // The iris closes as the geode flares, so its colours survive.
        expect(post.exposure).toBeLessThan(rest.exposure);
        let peak = 0;
        for (let i = 0; i < 96; i++) {
            run(world, camera, CLEAR_TRAVEL / 96, 1);
            peak = Math.max(peak, world.kick);
        }
        expect(peak).toBeGreaterThan(0);
        world.dispose();
    });
});

describe('geode world: the four-line clear and the T-spin', () => {
    it('holds its breath on four lines, then fractures, throws a lance from every cluster and rings the frame', () => {
        const { camera, world } = makeWorld('High');
        const rest = { ...world.getPostState(), prism: { ...world.getPostState().prism } };
        const { aAux } = world.crystals.state;
        const lances = () => {
            const out = [];
            for (let i = 0; i < world.crystals.count; i++) if (aAux[i * 4 + 2] > 0) out.push(i);
            return out;
        };
        expect(lances()).toHaveLength(0);
        expect(rest.prism).toEqual({ radius: 0, strength: 0 });
        const dust = used(world.shards, 'aBirth').length;

        const t0 = world.time;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const birth = t0 + HUSH_HOLD;
        const slot = world.u.clearA[0].value;
        expect(slot.y).toBe(4);
        expect(slot.w).toBe(1); // geodefire
        // The wave waits for the breath to be let go.
        expect(slot.x).toBeCloseTo(birth, 9);
        expect(world.counts).toMatchObject({ clears: 1, quads: 1 });
        const { surge } = world.getState();
        expect(surge).toBeGreaterThan(0);
        // It fires in geodefire: the channels in that colour's own order.
        const fire = world.u.clearC[0].value.toArray();
        const rank = (rgb) => [0, 1, 2].sort((a, b) => rgb[b] - rgb[a]);
        expect(rank(fire)).toEqual(rank(GEODEFIRE));
        // The fracture is set to open with the wave...
        expect(world.u.shock.value.x).toBeCloseTo(birth, 9);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        // ...and a lance to leave the tallest crystal of every cluster, and no other, as the wave reaches it.
        const thrown = lances();
        const mains = [];
        for (let i = 0; i < world.crystals.count; i++) if (world.list[i].main) mains.push(i);
        expect(mains).toHaveLength(world.plan.clusters.length);
        expect(thrown).toEqual(mains);
        for (const i of thrown) {
            expect(i).toBeLessThan(world.crystals.heroes);
            expect(aAux[i * 4 + 1]).toBeCloseTo(birth + clearPassTime(world.list[i].w), 4);
        }
        // Each throws dust with it.
        expect(used(world.shards, 'aBirth').length).toBeGreaterThan(dust);

        // ── The hush: every light sinks, and nothing has broken yet ──
        run(world, camera, HUSH_HOLD * 0.9);
        const hushed = world.getState().breath;
        expect(hushed).toBeLessThan(0.5);
        expect(world.u.breath.value).toBe(hushed);
        expect(world.getPostState().shafts).toBeLessThan(rest.shafts);
        expect(world.getPostState().prism).toEqual({ radius: 0, strength: 0 });
        expect(world.u.live.value.w).toBe(0);

        // ── Then everything fires ──
        run(world, camera, HUSH_HOLD * 0.1 + 0.05);
        expect(world.u.live.value.w).toBe(1);
        const ring = { ...world.getPostState().prism };
        expect(ring.radius).toBeGreaterThan(0);
        expect(ring.strength).toBeGreaterThan(0);
        run(world, camera, 0.45);
        expect(world.getState().breath).toBeGreaterThan(hushed); // it breathes out
        expect(world.getPostState().shafts).toBeGreaterThan(rest.shafts);
        expect(world.getPostState().exposure).toBeLessThan(rest.exposure); // the iris closes on the flare
        // The prism ring crosses the frame: wider and fainter as it goes.
        expect(world.getPostState().prism.radius).toBeGreaterThan(ring.radius);
        expect(world.getPostState().prism.strength).toBeLessThan(ring.strength);
        expect(world.getPostState().prism.strength).toBeGreaterThan(0);
        expect(world.u.surge.value).toBe(world.getState().surge);

        // ── And cools ──
        run(world, camera, t0 + SURGE_COOL - world.time, 240);
        expect(world.getState().surge).toBeCloseTo(surge * Math.exp(-1), 6);
        run(world, camera, SURGE_COOL * 10, 600);
        expect(world.getState().surge).toBeLessThan(0.01);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        expect(world.getPostState().exposure).toBeGreaterThan(0.99);
        expect(world.getPostState().shafts).toBeCloseTo(rest.shafts, 2);
        // The ring has left the frame and the wall has healed.
        expect(world.getPostState().prism).toEqual({ radius: 0, strength: 0 });
        expect(world.u.live.value.w).toBe(0);
        world.dispose();
    });

    it('throws every lance alike, whether its crystal holds light or none', () => {
        const { camera, world } = makeWorld('Low');
        const mains = [];
        for (let i = 0; i < world.crystals.heroes; i++) if (world.list[i].main) mains.push(i);
        expect(mains.length).toBeGreaterThan(1);
        // Fill one cluster's tallest crystal to the brim; leave the rest empty.
        const [full] = mains;
        const from = world.screenToWorld(0.3, 0.5, SPARK_DEPTH, [0, 0, 0]);
        let landed = world.time;
        for (let i = 0; i < 4; i++) landed = world.sendWisp(full, from, [1, 0.9, 0.8], 4);
        run(world, camera, landed - world.time + 0.4);
        expect(world.crystals.heldAt(full, world.time)).toBeGreaterThan(STORE_MAX * 0.9);
        const empty = mains.filter((i) => world.crystals.heldAt(i, world.time) === 0);
        expect(empty.length).toBeGreaterThan(0);

        world.onClear({ lines: 4 });
        const { aAux, aRelease } = world.crystals.state;
        expect(aAux[full * 4 + 2]).toBeGreaterThan(0);
        for (const i of mains) expect(aAux[i * 4 + 2], `main ${i}`).toBe(aAux[full * 4 + 2]);
        // What it held shows in its flare instead.
        expect(peakIn(aRelease, full)).toBeGreaterThan(peakIn(aRelease, empty[0]) * 2);
        world.dispose();
    });

    it('fires a perfect clear as a four-line clear, hotter still', () => {
        const quad = makeWorld('Low');
        const perfect = makeWorld('Low');
        quad.world.onClear({ lines: 4 });
        perfect.world.onClear({ lines: 1, perfect: true });
        const slot = perfect.world.u.clearA[0].value;
        expect(slot.x).toBeCloseTo(perfect.world.time + HUSH_HOLD, 9);
        expect(slot.y).toBe(4);
        expect(slot.w).toBe(1);
        expect(perfect.world.counts.quads).toBe(1);
        expect(perfect.world.getState().surge).toBeGreaterThan(quad.world.getState().surge);
        expect(perfect.world.u.shock.value.y).toBeGreaterThan(0);
        run(perfect.world, perfect.camera, HUSH_HOLD * 0.9);
        expect(perfect.world.getState().breath).toBeLessThan(0.5);
        quad.world.dispose();
        perfect.world.dispose();
    });

    it('turns the agate a notch on a T-spin and rings the frame without breaking the wall', () => {
        const { camera, world } = makeWorld('Low');
        const quad = makeWorld('Low');
        quad.world.onClear({ lines: 4 });
        run(quad.world, quad.camera, HUSH_HOLD + 0.05);

        expect(world.twistTarget).toBe(0);
        world.onClear({ lines: 2, tspin: true });
        const notch = world.twistTarget;
        expect(notch).toBeGreaterThan(0);
        expect(world.twist).toBe(0); // it turns, it does not jump
        expect(world.storm).toBeGreaterThan(0);
        expect(world.counts).toMatchObject({ clears: 1, quads: 0 });
        // No fracture, no held breath...
        expect(world.u.shock.value.x).toBeLessThan(-50);
        expect(world.u.shock.value.y).toBe(0);
        run(world, camera, 0.05);
        expect(world.u.live.value.w).toBe(0);
        expect(world.getState().breath).toBeGreaterThan(0.9);
        // ...but a prism ring from the heart, at once: fainter than a four-line clear's at the same age.
        const ring = world.getPostState().prism;
        expect(ring.radius).toBeGreaterThan(0);
        expect(ring.strength).toBeGreaterThan(0);
        expect(ring.radius).toBeCloseTo(quad.world.getPostState().prism.radius, 6);
        expect(ring.strength).toBeLessThan(quad.world.getPostState().prism.strength);
        // The bands turn toward the notch and settle on it.
        expect(world.twist).toBeGreaterThan(0);
        expect(world.twist).toBeLessThan(notch);
        expect(world.u.twist.value).toBe(world.twist);
        run(world, camera, 20, 400);
        expect(world.twist).toBeCloseTo(notch, 4);
        expect(world.getState().twist).toBe(world.twist);
        expect(world.getPostState().prism).toEqual({ radius: 0, strength: 0 });
        // Each T-spin is one more notch the same way.
        world.onClear({ lines: 1, tspin: true });
        expect(world.twistTarget).toBeCloseTo(notch * 2, 12);
        // A T-spin that is also a four-line clear's equal keeps the fracture.
        world.onClear({ lines: 2, tspin: true, perfect: true });
        expect(world.twistTarget).toBeCloseTo(notch * 3, 12);
        expect(world.u.shock.value.x).toBeCloseTo(world.time + HUSH_HOLD, 9);
        expect(world.counts.quads).toBe(1);
        quad.world.dispose();
        world.dispose();
    });
});

describe('geode world: combos and levels', () => {
    it('grows a ring of the crown for every step of a chain, announced by the heart in the ring\'s colour', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ combo: 0, power: 0, crown: 0 });
        const drift0 = world.drift;
        run(world, camera, 1);
        const atRest = world.drift - drift0; // how far the dust is carried in a second at rest
        const calm = world.u.heart.value.length();
        // A single clear is not a chain: the geode stirs, no ring grows, the heart announces nothing.
        world.onCombo(1);
        expect(inUse(world.u.pulseA, 0)).toHaveLength(0);
        run(world, camera, 12, 240);
        expect(world.power).toBeCloseTo(powerForCombo(1), 3);
        expect(world.crown).toBe(0);
        // Four in a row: three rings, easing in.
        world.onCombo(4);
        const [announced] = ringsBornAt(world, world.time);
        expect(announced).toBeTruthy();
        expectHue(announced.colour, CROWN_COLORS[crownForCombo(4) - 1]);
        run(world, camera, 0.1);
        expect(world.crown).toBeGreaterThan(0);
        expect(world.crown).toBeLessThan(crownForCombo(4));
        expect(world.power).toBeGreaterThan(powerForCombo(1));
        expect(world.power).toBeLessThan(powerForCombo(4));
        run(world, camera, 12, 240);
        expect(world.crown).toBe(crownForCombo(4));
        expect(world.power).toBeCloseTo(powerForCombo(4), 3);
        expect(world.getState()).toMatchObject({ combo: 4, power: world.power, crown: world.crown });
        expect(world.u.power.value).toBe(world.power);
        expect(world.u.crown.value).toBe(world.crown);
        // The same chain reported again announces nothing; the next step announces the next ring.
        world.onCombo(4);
        expect(ringsBornAt(world, world.time)).toHaveLength(0);
        world.onCombo(5);
        const [next] = ringsBornAt(world, world.time);
        expectHue(next.colour, CROWN_COLORS[crownForCombo(5) - 1]);
        // The crown has only so many rings.
        world.onCombo(CROWN_RINGS + 20);
        run(world, camera, 12, 240);
        expect(world.crown).toBe(CROWN_RINGS);
        expect(world.power).toBeLessThanOrEqual(1);
        const full = ringsBornAt(world, world.time).length;
        world.onCombo(CROWN_RINGS + 21);
        expect(ringsBornAt(world, world.time)).toHaveLength(full);
        // The charge brightens the heart and quickens the dust.
        expect(world.u.heart.value.length()).toBeGreaterThan(calm);
        const { drift } = world;
        run(world, camera, 1);
        expect(world.drift - drift).toBeGreaterThan(atRest * 1.01);
        expect(world.u.drift.value).toBe(world.drift);
        // Nonsense is no chain.
        world.onCombo(NaN);
        expect(world.combo).toBe(0);
        world.onCombo(-4);
        expect(world.combo).toBe(0);
        world.onCombo('3');
        expect(world.combo).toBe(3);
        world.dispose();
    });

    it('shatters the crown when a chain breaks, and lets its breath go', () => {
        const { camera, world } = makeWorld('Low');
        world.onCombo(5);
        run(world, camera, 12, 240);
        expect(world.crown).toBe(crownForCombo(5));
        const dust = used(world.shards, 'aBirth').length;
        expect(world.counts.shatters).toBe(0);
        const now = world.time;
        world.onCombo(0);
        expect(world.combo).toBe(0);
        expect(world.counts.shatters).toBe(1);
        expect(world.dip).toBeGreaterThan(0);
        // The standing rings burst into dust, in their own colours, from now on.
        const thrown = used(world.shards, 'aBirth');
        expect(thrown.length).toBeGreaterThan(dust);
        const births = world.shards.geometry.getAttribute('aBirth').array;
        const tints = world.shards.geometry.getAttribute('aTint').array;
        const tips = world.plan.crown.filter((crystal) => crystal.ring <= crownForCombo(5));
        for (const i of thrown) {
            expect(births[i * 4 + 3]).toBeGreaterThanOrEqual(now - 1e-4);
            const from = tips.find((crystal) => Math.hypot(
                crystal.tip[0] - births[i * 4],
                crystal.tip[1] - births[i * 4 + 1],
                crystal.tip[2] - births[i * 4 + 2],
            ) < 1e-3);
            expect(from, `shard ${i}`).toBeTruthy();
            expectHue([tints[i * 4], tints[i * 4 + 1], tints[i * 4 + 2]], CROWN_COLORS[from.ring - 1], 3);
        }
        // The crown falls, the geode dims a moment, and both come back to rest.
        run(world, camera, 0.15);
        expect(world.crown).toBeLessThan(crownForCombo(5));
        expect(world.crown).toBeGreaterThan(0);
        expect(world.getState().breath).toBeLessThan(1);
        run(world, camera, 20, 400);
        expect(world.crown).toBe(0);
        expect(world.u.crown.value).toBe(0);
        expect(world.power).toBeLessThan(0.01);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        // Breaking again shatters nothing: there is no chain.
        world.onCombo(0);
        expect(world.counts.shatters).toBe(1);
        world.dispose();
    });

    it('has nothing to shatter after a single clear, or before a ring has grown', () => {
        const { camera, world } = makeWorld('Low');
        world.onCombo(1);
        run(world, camera, 2);
        world.onCombo(0);
        expect(world.counts.shatters).toBe(0);
        expect(world.dip).toBe(0);
        expect(used(world.shards, 'aBirth')).toHaveLength(0);
        // A chain reported and broken within one frame never stood a ring.
        world.onCombo(3);
        world.onCombo(0);
        expect(world.counts.shatters).toBe(0);
        expect(used(world.shards, 'aBirth')).toHaveLength(0);
        world.dispose();
    });

    it('recrystallises as another mineral with the level, and cycles through its palettes', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ level: 1, palette: GEODE_PALETTES[0].name });
        const target = new THREE.Vector3(...GEODE_PALETTES[1].druzy);
        const before = world.u.druzy.value.clone();
        const apart = before.distanceTo(target);
        expect(apart).toBeGreaterThan(0.05);
        world.levelUp(2);
        expect(world.getState()).toMatchObject({ level: 2, palette: GEODE_PALETTES[1].name });
        // The geode marks it: it stirs, and a pale wave carries the new mineral down the wall.
        expect(world.storm).toBeGreaterThan(0);
        const waves = world.u.clearA.filter((slot) => slot.value.x === world.time);
        expect(waves).toHaveLength(1);
        expect(waves[0].value.y).toBeGreaterThanOrEqual(1);
        expect(waves[0].value.z).toBeGreaterThan(0);
        expect(waves[0].value.w).toBe(0);
        expect(world.counts.clears).toBe(0); // it is not a clear
        expect(world.u.shock.value.y).toBe(0);
        // The colours ease across, they do not snap.
        run(world, camera, 1 / 60, 1);
        const moved = world.u.druzy.value.distanceTo(before);
        expect(moved).toBeGreaterThan(0);
        expect(moved).toBeLessThan(apart * 0.2);
        run(world, camera, 20, 400);
        expect(mineralDrift(world.time)).toBe(0); // (the clock has not begun to turn it yet)
        expect(world.u.druzy.value.distanceTo(target)).toBeLessThan(apart * 0.01);
        // Past the last palette it starts again.
        for (let level = 1; level <= GEODE_PALETTES.length * 2 + 1; level++) {
            world.levelUp(level);
            expect(world.getState().palette).toBe(GEODE_PALETTES[(level - 1) % GEODE_PALETTES.length].name);
        }
        // A capture rests on a level's mineral at once, without a stir or a wave.
        const { storm } = world;
        const waveSlots = world.u.clearA.map((slot) => slot.value.toArray());
        world.levelUp(3, { silent: true });
        expect(world.storm).toBe(storm);
        expect(world.u.clearA.map((slot) => slot.value.toArray())).toEqual(waveSlots);
        world.update({ time: world.time, delta: 0 }, camera);
        expect(mineralDrift(world.time)).toBe(0); // the clock is still holding the mineral
        expect(world.getState()).toMatchObject({ level: 3, palette: GEODE_PALETTES[2].name, mineral: 2 });
        expect(world.u.minerals).toHaveLength(MINERALS);
        expectPalette(world, 2);
        GEODE_PALETTES[2].druzy.forEach((channel, k) => {
            expect(world.u.druzy.value.getComponent(k)).toBeCloseTo(channel, 9);
        });
        // Nonsense is level one.
        world.levelUp(NaN);
        expect(world.getState().level).toBe(1);
        world.levelUp(-3);
        expect(world.getState().level).toBe(1);
        world.levelUp('4');
        expect(world.getState()).toMatchObject({ level: 4, palette: GEODE_PALETTES[3 % GEODE_PALETTES.length].name });
        world.dispose();
    });

    it('turns through its minerals by the clock alone, resting on each before it melts into the next', () => {
        const { camera, world } = makeWorld('Low');
        const hold = MINERAL_PERIOD * MINERAL_HOLD;
        const at = (time) => {
            run(world, camera, time - world.time, Math.max(1, Math.round((time - world.time) * 4)));
            return world.getState();
        };
        // It rests on the first mineral...
        expect(at(hold / 2)).toMatchObject({ level: 1, mineral: 0, palette: GEODE_PALETTES[0].name });
        expectPalette(world, 0);
        // ...then melts into the second with no event and no level: no stir, no wave...
        const turning = at(hold + (MINERAL_PERIOD - hold) / 2);
        expect(turning.mineral).toBeCloseTo(0.5, 9);
        expectPalette(world, turning.mineral);
        expect(turning).toMatchObject({ level: 1, combo: 0, counts: { locks: 0, clears: 0 } });
        expect(world.storm).toBe(0);
        expect(inUse(world.u.clearA, 0)).toHaveLength(0);
        // ...rests on that one...
        expect(at(MINERAL_PERIOD + hold / 2)).toMatchObject({ level: 1, mineral: 1, palette: GEODE_PALETTES[1].name });
        expectPalette(world, 1);
        // ...and comes round to the first again.
        expect(at(MINERAL_PERIOD * GEODE_PALETTES.length + hold / 2)).toMatchObject({
            level: 1, mineral: GEODE_PALETTES.length, palette: GEODE_PALETTES[0].name,
        });
        expectPalette(world, 0);
        world.dispose();
    });

    it('shows the same mineral whether the clock ran there or was set there, at any frame rate', () => {
        const time = MINERAL_PERIOD * 1.75;
        const shown = [10, 60].map((fps) => {
            const { camera, world } = makeWorld('Low');
            run(world, camera, time - world.time, Math.round((time - world.time) * fps));
            const out = { time: world.time, mineral: world.getState().mineral, palette: shownPalette(world) };
            world.dispose();
            return out;
        });
        const { camera, world } = makeWorld('Low');
        world.seek(time);
        world.update({ time, delta: 0 }, camera);
        expect(world.getState().mineral).toBe(mineralDrift(time));
        expect(world.getState().mineral).toBeGreaterThan(1.3);
        expect(world.getState().mineral).toBeLessThan(1.7);
        expectPalette(world, mineralDrift(time));
        for (const ran of shown) {
            expect(ran.mineral).toBeCloseTo(mineralDrift(time), 9);
            for (const key of Object.keys(ran.palette)) {
                ran.palette[key].forEach((channel, c) => {
                    expect(channel, key).toBeCloseTo(shownPalette(world)[key][c], 9);
                });
            }
        }
        world.dispose();
    });

    it('takes a level as one step on top of wherever the clock has turned it', () => {
        const { camera, world } = makeWorld('Low');
        // A third of the way into the melt from the first mineral to the second.
        const time = MINERAL_PERIOD * (MINERAL_HOLD + (1 - MINERAL_HOLD) * 0.3);
        run(world, camera, time - world.time, 200);
        const drift = mineralDrift(world.time);
        expect(drift).toBeGreaterThan(0.1);
        expect(drift).toBeLessThan(0.4);
        expect(world.getState()).toMatchObject({ level: 1, palette: GEODE_PALETTES[0].name });
        world.levelUp(2);
        expect(world.getState()).toMatchObject({ level: 2, palette: GEODE_PALETTES[1].name });
        // The pale wave it sends is the colour of the heart it is heading for.
        const wave = world.u.clearA.findIndex((slot) => slot.value.x === world.time);
        expect(wave).toBeGreaterThanOrEqual(0);
        const heart = paletteAt(1 + drift).heart.map((channel) => channel * 0.7 + 0.3);
        world.u.clearC[wave].value.toArray().forEach((channel, c) => expect(channel).toBeCloseTo(heart[c], 9));
        // The step eases in...
        run(world, camera, 1 / 60, 1);
        const ahead = world.getState().mineral - mineralDrift(world.time);
        expect(ahead).toBeGreaterThan(0);
        expect(ahead).toBeLessThan(0.05);
        // ...and then the geode is a whole mineral ahead of the clock, and stays so as the clock turns.
        run(world, camera, 15);
        expect(world.getState().mineral).toBeCloseTo(1 + mineralDrift(world.time), 12);
        expectPalette(world, 1 + mineralDrift(world.time));
        run(world, camera, MINERAL_PERIOD, 360);
        expect(world.getState().level).toBe(2);
        expect(world.getState().mineral).toBeGreaterThan(2);
        expectPalette(world, 1 + mineralDrift(world.time));
        // A new run starts from level one again; the clock keeps its place.
        world.resetSession();
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.getState()).toMatchObject({ level: 1, mineral: mineralDrift(world.time) });
        expectPalette(world, mineralDrift(world.time));
        world.dispose();
    });

    it('turns at the same pace under reduced motion: a slow change of colour is not motion', () => {
        const time = MINERAL_PERIOD * 0.8;
        const shown = [false, true].map((reduced) => {
            const { camera, world } = makeWorld('Low', { reduced });
            run(world, camera, time - world.time, 120);
            const out = { mineral: world.getState().mineral, palette: shownPalette(world) };
            world.dispose();
            return out;
        });
        expect(shown[0].mineral).toBeGreaterThan(0.5);
        expect(shown[1]).toEqual(shown[0]);
    });

    it('lights the heart in its level\'s own colour at rest', () => {
        for (let level = 1; level <= GEODE_PALETTES.length; level++) {
            const { camera, world } = makeWorld('Minimal');
            world.levelUp(level, { silent: true });
            world.update({ time: world.time, delta: 0 }, camera);
            expectHue(world.u.heart.value, GEODE_PALETTES[level - 1].heart);
            world.dispose();
        }
    });

    it('sends a level-up\'s pale wave as a wave like any other: every crystal lets go as it passes', () => {
        const { camera, world, holders } = litWorld();
        const { aRelease } = world.crystals.state;
        const { held } = world.getState();
        const dust = used(world.shards, 'aBirth').length;
        const born = world.time;
        world.levelUp(2);
        expect(world.u.clearA[0].value.x).toBe(born);
        // Nothing is lost yet, and nothing is thrown: it is not a line clear.
        expect(world.getState().held).toBeCloseTo(held, 9);
        expect(world.counts.clears).toBe(0);
        expect(used(world.shards, 'aBirth')).toHaveLength(dust);
        // Every hero is due to answer it as it passes, with a flare; the crown is not.
        for (let i = 0; i < world.crystals.heroes; i++) {
            const pass = born + clearPassTime(world.list[i].w);
            expect(cutsOf(world, i)[0], `hero ${i}`).toBeCloseTo(pass, 4);
            expect(cutsOf(world, i)[1], `hero ${i}`).toBe(Infinity);
            expect(aRelease[i * 4 + 3], `hero ${i}`).toBeCloseTo(pass, 4);
            expect(peakIn(aRelease, i), `hero ${i}`).toBeGreaterThan(0);
        }
        for (let i = world.crystals.heroes; i < world.crystals.count; i++) {
            expect(cutsOf(world, i)).toEqual([Infinity, Infinity]);
        }
        // A crystal that holds light flares with it, brighter than one that holds none, and is empty after.
        const bare = world.targets.left.find((i) => !holders.includes(i));
        expect(bare).toBeGreaterThanOrEqual(0);
        for (const i of holders) {
            const pass = born + clearPassTime(world.list[i].w);
            expect(peakIn(aRelease, i), `holder ${i}`).toBeGreaterThan(peakIn(aRelease, bare));
            expect(world.crystals.heldAt(i, pass - 1e-3), `holder ${i}`).toBeGreaterThan(0);
            expect(world.crystals.heldAt(i, pass + 1e-3), `holder ${i}`).toBe(0);
        }
        run(world, camera, CLEAR_TRAVEL * 1.05);
        expect(world.getState().held).toBe(0);
        world.dispose();
    });

    it('leaves no crystal answering a wave whose slot a level-up has taken', () => {
        const { camera, world, holders } = litWorld();
        const first = world.time;
        world.onClear({ lines: 1 });
        run(world, camera, 0.7);
        // The clear that brings the level up: its wave and the level's pale one take both the shaders' slots.
        const second = world.time;
        world.onClear({ lines: 1 });
        world.levelUp(2);
        const drawn = world.u.clearA.map((slot) => slot.value.x).sort((a, b) => a - b);
        expect(drawn).toEqual(new Array(CLEAR_SLOTS).fill(second));
        // Every crystal is due to answer the waves that are drawn and have yet to reach it: those, and no other.
        for (let i = 0; i < world.crystals.heroes; i++) {
            const reach = clearPassTime(world.list[i].w);
            const due = drawn.map((birth) => birth + reach).filter((pass) => pass > world.time);
            const cuts = cutsOf(world, i).filter((cut) => Number.isFinite(cut));
            expect(cuts, `hero ${i}`).toHaveLength(due.length);
            cuts.forEach((cut, k) => expect(cut, `hero ${i}`).toBeCloseTo(due[k], 4));
        }
        // What a crystal holds stays where the first wave would have passed it, and goes with the two that are drawn.
        let waited = 0;
        for (const i of holders) {
            const reach = clearPassTime(world.list[i].w);
            if (first + reach > second) {
                waited += 1;
                expect(world.crystals.heldAt(i, first + reach + 1e-3), `holder ${i}`).toBeGreaterThan(0);
                expect(world.crystals.heldAt(i, second + reach - 1e-3), `holder ${i}`).toBeGreaterThan(0);
            }
            expect(world.crystals.heldAt(i, second + reach + 1e-3), `holder ${i}`).toBe(0);
        }
        expect(waited).toBeGreaterThan(0);
        run(world, camera, CLEAR_TRAVEL * 1.05);
        expect(world.getState().held).toBe(0);
        world.dispose();
    });

    it('releases nothing on a silent level-up', () => {
        const { camera, world, holders } = litWorld();
        const { state } = world.crystals;
        const before = Object.values(state).map((array) => Array.from(array));
        const slots = world.u.clearA.map((slot) => slot.value.toArray());
        const { held } = world.getState();
        world.levelUp(3, { silent: true });
        expect(world.getState()).toMatchObject({ level: 3, palette: GEODE_PALETTES[2].name });
        // No wave, no letting go due, no flare: the crystals are as they were.
        expect(world.u.clearA.map((slot) => slot.value.toArray())).toEqual(slots);
        expect(Object.values(state).map((array) => Array.from(array))).toEqual(before);
        expect(flares(world)).toHaveLength(0);
        for (const i of holders) expect(cutsOf(world, i)).toEqual([Infinity, Infinity]);
        expect(world.getState().held).toBeCloseTo(held, 9);
        // And they keep their light long after a wave would have run its course.
        run(world, camera, CLEAR_TRAVEL * 1.05);
        expect(world.getState().held).toBeGreaterThan(held * 0.9);
        for (const i of holders) expect(world.crystals.heldAt(i, world.time), `holder ${i}`).toBeGreaterThan(0);
        world.dispose();
    });
});

describe('geode world: reduced motion', () => {
    it('stills the camera and shortens a spark\'s flight, and keeps the feedback', () => {
        const calm = makeWorld('Low', { reduced: true });
        const live = makeWorld('Low');
        expect(calm.world.reducedMotion).toBe(true);
        // The camera rests on the axis whatever the clock and the pointer say.
        for (const time of [10, 23.7, 61, 240]) {
            calm.world.updateCamera(calm.camera, {
                time, delta: 0, pointerX: 1, pointerY: -1,
            });
            calm.camera.position.toArray().forEach((value) => expect(value).toBeCloseTo(0, 12));
            const gaze = calm.camera.getWorldDirection(new THREE.Vector3());
            expect(gaze.z).toBeCloseTo(-1, 9);
            expect(calm.camera.up.x).toBeCloseTo(0, 12);
            expect(calm.world.heart.x).toBeCloseTo(0.5, 9);
            expect(calm.world.heart.y).toBeCloseTo(0.5, 9);
        }
        calm.world.updateCamera(calm.camera, { time: 10, delta: 0 });
        // A hard drop still rings the heart, sends its sparks and leaves light behind...
        calm.world.onLock({ u: 0.2, hardDrop: true, color: '#60ffff' });
        live.world.onLock({ u: 0.2, hardDrop: true, color: '#60ffff' });
        expect(ringsBornAt(calm.world, calm.world.time)).toHaveLength(1);
        expect(calm.world.counts.wisps).toBeGreaterThan(0);
        expect(calm.world.kick).toBeGreaterThan(0);
        // ...sooner: the spark does not make the long flight.
        const flight = (world) => world.wisps.geometry.getAttribute('aTo').array[3];
        expect(flight(calm.world)).toBeGreaterThan(0);
        expect(flight(calm.world)).toBeLessThan(flight(live.world));
        // The impact reaches the post, but the lens does not dolly.
        run(calm.world, calm.camera, 1 / 60, 1);
        run(live.world, live.camera, 1 / 60, 1);
        expect(calm.world.getPostState().kick).toBeGreaterThan(0);
        expect(calm.camera.fov).toBe(fovForAspect(1600 / 900));
        expect(live.camera.fov).toBeLessThan(fovForAspect(1600 / 900));
        calm.camera.position.toArray().forEach((value) => expect(value).toBeCloseTo(0, 12));
        run(calm.world, calm.camera, 2);
        expect(calm.world.getState().held).toBeGreaterThan(0);
        // The dust drifts, slowly.
        const calmDrift = calm.world.drift;
        const liveDrift = live.world.drift;
        run(calm.world, calm.camera, 2);
        run(live.world, live.camera, 4);
        run(calm.world, calm.camera, 2);
        expect(calm.world.drift - calmDrift).toBeGreaterThan(0);
        expect(calm.world.drift - calmDrift).toBeLessThan(live.world.drift - liveDrift);
        // A four-line clear still holds its breath, and breaks the wall more gently.
        calm.world.onClear({ lines: 4 });
        live.world.onClear({ lines: 4 });
        expect(calm.world.u.shock.value.y).toBeGreaterThan(0);
        expect(calm.world.u.shock.value.y).toBeLessThan(live.world.u.shock.value.y);
        run(calm.world, calm.camera, HUSH_HOLD * 0.9);
        expect(calm.world.getState().breath).toBeLessThan(0.5);
        // Only a real `true` asks for it.
        calm.world.setReducedMotion('yes');
        expect(calm.world.reducedMotion).toBe(false);
        calm.world.setReducedMotion(true);
        expect(calm.world.reducedMotion).toBe(true);
        calm.world.dispose();
        live.world.dispose();
    });
});

describe('geode world: what the shaders and the post are told', () => {
    it('raises a live flag while a ring, a ripple, a wave or a fracture is in the geode, and drops it after', () => {
        const { camera, world } = makeWorld('Low');
        const live = () => world.u.live.value.toArray();
        const settle = () => run(world, camera, 40, 400);
        expect(live()).toEqual([0, 0, 0, 0]);
        // A lock: a ring from the heart now, a ripple when its spark lands.
        world.onLock({ u: 0.3 });
        run(world, camera, 1 / 60, 1);
        expect(live()).toEqual([1, 1, 0, 0]);
        run(world, camera, 1);
        expect(live()).toEqual([1, 1, 0, 0]);
        settle();
        expect(live()).toEqual([0, 0, 0, 0]);
        // A clear: a wave.
        world.onClear({ lines: 2 });
        run(world, camera, 1 / 60, 1);
        expect(live()).toEqual([0, 0, 1, 0]);
        settle();
        expect(live()).toEqual([0, 0, 0, 0]);
        // A four-line clear: the wave is on its way through the hush, the fracture opens after it.
        world.onClear({ lines: 4 });
        run(world, camera, HUSH_HOLD / 2, 4);
        expect(live()).toEqual([0, 0, 1, 0]);
        run(world, camera, HUSH_HOLD, 8);
        expect(live()).toEqual([0, 0, 1, 1]);
        settle();
        expect(live()).toEqual([0, 0, 0, 0]);
        // A new ring of the crown is a ring from the heart; a new level is a wave.
        world.onCombo(3);
        run(world, camera, 1 / 60, 1);
        expect(live()).toEqual([1, 0, 0, 0]);
        world.onCombo(0);
        settle();
        world.levelUp(2);
        run(world, camera, 1 / 60, 1);
        expect(live()).toEqual([0, 0, 1, 0]);
        // A T-spin's ring is the post's alone: the wall does not fracture.
        settle();
        world.onClear({ lines: 2, tspin: true });
        run(world, camera, 1 / 60, 1);
        expect(live()).toEqual([0, 0, 1, 0]);
        expect(world.u.time.value).toBe(world.time);
        world.dispose();
    });

    it('hands the crystals\' draws what gameplay wrote: five attributes in one buffer, each in its own place', () => {
        const { camera, world } = makeWorld('Low');
        const sizes = {
            aStore: 4, aPrev: 3, aFlash: 4, aRelease: 4, aAux: 4,
        };
        const names = Object.keys(sizes);
        expect(Object.keys(world.crystals.state)).toEqual(names);
        const buffer = world.crystals.geometry.getAttribute('aStore').data;
        expect(buffer.isInstancedInterleavedBuffer).toBe(true);
        expect(buffer.stride).toBe(Object.values(sizes).reduce((sum, size) => sum + size, 0));
        expect(buffer.array).toHaveLength(world.crystals.count * buffer.stride);
        /** The part of the shared buffer an attribute reads, crystal by crystal. */
        const drawn = (attribute) => {
            const out = [];
            for (let i = 0; i < world.crystals.count; i++) {
                const at = i * buffer.stride + attribute.offset;
                for (let k = 0; k < attribute.itemSize; k++) out.push(buffer.array[at + k]);
            }
            return out;
        };
        const check = (label) => {
            let offset = 0;
            for (const name of names) {
                const attribute = world.crystals.geometry.getAttribute(name);
                // One buffer, the attributes side by side in it, none over another.
                expect(attribute.data, `${label} ${name}`).toBe(buffer);
                expect(attribute.itemSize, `${label} ${name}`).toBe(sizes[name]);
                expect(attribute.offset, `${label} ${name}`).toBe(offset);
                offset += sizes[name];
                // The glints and the lances read the very same attributes.
                expect(world.parts.glints.geometry.getAttribute(name), `${label} ${name}`).toBe(attribute);
                expect(world.parts.beams.geometry.getAttribute(name), `${label} ${name}`).toBe(attribute);
                // And what it shows the shader is what gameplay last wrote.
                expect(drawn(attribute), `${label} ${name}`).toEqual(Array.from(world.crystals.state[name]));
            }
        };
        check('at rest');
        // A spark in flight, a wave due, a lance set, a flash from each: every attribute has something in it.
        let { version } = buffer;
        const written = (label) => {
            expect(buffer.version, label).toBeGreaterThan(version); // marked for upload
            ({ version } = buffer);
            check(label);
        };
        world.onLock({ u: 0.2, hardDrop: true, color: '#ff70ff' });
        written('after a lock');
        run(world, camera, 1);
        world.onLock({ u: 0.2, hardDrop: true, color: '#60ffff' });
        written('after a second lock');
        world.onClear({ lines: 4 });
        written('after a clear');
        const { state } = world.crystals;
        expect(flashes(world).length).toBeGreaterThan(0);
        expect(flares(world)).toHaveLength(world.crystals.heroes);
        expect(Array.from(state.aPrev).some((v) => v > 0)).toBe(true);
        expect(Array.from(state.aStore).some((v) => v > 0)).toBe(true);
        let lances = 0;
        for (let i = 0; i < world.crystals.count; i++) if (state.aAux[i * 4 + 2] > 0) lances += 1;
        expect(lances).toBeGreaterThan(0);
        world.seek(30);
        written('after a seek');
        world.dispose();
    });

    it('hands the post one reused object of finite numbers, its exposure falling in a surge', () => {
        const { camera, world } = makeWorld('Low');
        const post = world.getPostState();
        expect(world.getPostState()).toBe(post);
        expect(Object.keys(post).sort()).toEqual([
            'bloomBoost', 'exposure', 'flash', 'heart', 'kick', 'prism', 'shafts',
        ]);
        // At rest: an open iris, the heart's own shafts, nothing else.
        expect(post).toMatchObject({
            flash: 0, kick: 0, exposure: 1, prism: { radius: 0, strength: 0 },
        });
        expect(post.bloomBoost).toBeLessThan(1e-12);
        expect(post.shafts).toBeGreaterThan(0);
        const { prism } = post;
        const finite = () => {
            for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure']) {
                expect(Number.isFinite(post[key]), key).toBe(true);
                expect(post[key], key).toBeGreaterThanOrEqual(0);
            }
            expect(post.exposure).toBeLessThanOrEqual(1);
            expect(post.exposure).toBeGreaterThan(0);
            for (const key of ['radius', 'strength']) {
                expect(Number.isFinite(post.prism[key]), key).toBe(true);
                expect(post.prism[key], key).toBeGreaterThanOrEqual(0);
            }
            expect(Number.isFinite(post.heart.x) && Number.isFinite(post.heart.y)).toBe(true);
        };
        // A busy run: every frame the same object, every number usable.
        const events = [
            () => world.onLock({ u: 0.2, hardDrop: true, color: '#ffa050' }),
            () => world.onClear({ lines: 1 }),
            () => world.onCombo(2),
            () => world.onClear({ lines: 3, tspin: true }),
            () => world.onCombo(3),
            () => world.levelUp(2),
            () => world.onClear({ lines: 4 }),
            () => world.onCombo(0),
            () => world.onClear({ lines: 2, perfect: true }),
        ];
        let lowest = 1;
        for (const event of events) {
            event();
            for (let i = 0; i < 30; i++) {
                run(world, camera, 1 / 60, 1);
                expect(world.getPostState()).toBe(post);
                expect(post.prism).toBe(prism);
                expect(post.heart).toBe(world.heart);
                finite();
                lowest = Math.min(lowest, post.exposure);
            }
        }
        // In the surge of the last four-line clear the iris is closed...
        expect(world.getState().surge).toBeGreaterThan(0);
        expect(post.exposure).toBeLessThan(1);
        expect(lowest).toBeLessThan(1);
        const closed = post.exposure;
        // ...and opens again as the surge cools.
        run(world, camera, SURGE_COOL);
        expect(post.exposure).toBeGreaterThan(closed);
        run(world, camera, SURGE_COOL * 12, 600);
        expect(post.exposure).toBeCloseTo(1, 3);
        finite();
        world.dispose();
    });
});

describe('geode world: time', () => {
    const script = (world, camera, fps) => {
        world.onLock({ u: 0.3, hardDrop: true, color: '#ffa050' });
        world.onClear({ lines: 2 });
        world.onCombo(3);
        run(world, camera, 1.5, Math.round(1.5 * fps));
        world.onClear({ lines: 4 });
        world.onCombo(4);
        run(world, camera, 2, Math.round(2 * fps));
        world.onLock({ u: 0.8, color: '#ff70ff' });
        world.onClear({ lines: 1, tspin: true });
        world.levelUp(2);
        run(world, camera, 1.5, Math.round(1.5 * fps));
        // One more piece, whose sparks land after the last wave has gone by: its light stays.
        world.onLock({ u: 0.2, hardDrop: true, color: '#60ffff' });
        run(world, camera, 1, fps);
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
        for (const key of ['power', 'surge', 'storm', 'breath', 'crown', 'twist', 'held']) {
            expect(a[key], key).toBeCloseTo(b[key], 3);
        }
        // The slow clock is integrated frame by frame: close, not identical.
        expect(slow.world.drift / fast.world.drift).toBeCloseTo(1, 2);
        expect(a.heart.x).toBeCloseTo(b.heart.x, 3);
        expect(a.heart.y).toBeCloseTo(b.heart.y, 3);
        const postA = slow.world.getPostState();
        const postB = fast.world.getPostState();
        for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure']) {
            expect(postA[key], key).toBeCloseTo(postB[key], 3);
        }
        expect(postA.prism.radius).toBeCloseTo(postB.prism.radius, 6);
        expect(postA.prism.strength).toBeCloseTo(postB.prism.strength, 6);
        expect(slow.world.u.druzy.value.distanceTo(fast.world.u.druzy.value)).toBeLessThan(1e-3);
        // Event slots hold timestamps: they are identical whatever the frame rate.
        for (let i = 0; i < CLEAR_SLOTS; i++) {
            expect(slow.world.u.clearA[i].value.toArray()).toEqual(fast.world.u.clearA[i].value.toArray());
        }
        for (let i = 0; i < PULSE_SLOTS; i++) {
            expect(slow.world.u.pulseA[i].value.toArray()).toEqual(fast.world.u.pulseA[i].value.toArray());
        }
        expect(slow.world.u.shock.value.toArray()).toEqual(fast.world.u.shock.value.toArray());
        // A spark's flight depends on the camera's pose that frame: the same to a hair.
        for (let i = 0; i < STRIKE_SLOTS; i++) {
            const strikeA = slow.world.u.strikeA[i].value.toArray();
            const strikeB = fast.world.u.strikeA[i].value.toArray();
            for (let k = 0; k < 4; k++) expect(strikeA[k], `strike slot ${i}[${k}]`).toBeCloseTo(strikeB[k], 3);
        }
        slow.world.dispose();
        fast.world.dispose();
    });

    it('replays a frame: seek, then the same steps, gives the same geode whatever came before', () => {
        const { camera, world } = makeWorld('Low');
        // What a frame is made of: the state, the post's inputs, the event slots, what every
        // crystal holds and every pool's births, the slow clocks and the camera.
        const flat = (value) => (typeof value === 'object' ? Object.values(value) : value);
        const births = (part, name) => Array.from(instanced(part, name).array).filter((v, i) => i % 4 === 3);
        const snapshot = () => [
            ...Object.values(world.getState()).flatMap(flat),
            ...['flash', 'kick', 'shafts', 'bloomBoost', 'exposure'].map((key) => world.getPostState()[key]),
            world.getPostState().prism.radius,
            world.getPostState().prism.strength,
            ...world.u.pulseA.flatMap((slot) => slot.value.toArray()),
            ...world.u.strikeA.flatMap((slot) => slot.value.toArray()),
            ...world.u.clearA.flatMap((slot) => slot.value.toArray()),
            ...world.u.shock.value.toArray(),
            ...world.u.live.value.toArray(),
            ...world.u.heart.value.toArray(),
            ...world.u.druzy.value.toArray(),
            ...world.rowBeams.uniforms.frame.value.toArray(),
            ...Object.values(world.crystals.state).flatMap((array) => Array.from(array)),
            ...births(world.wisps, 'aFrom'),
            ...births(world.shards, 'aBirth'),
            world.drift,
            world.twist,
            world.twistTarget,
            ...camera.matrixWorld.toArray(),
            camera.fov,
        ];
        script(world, camera, 60);
        const first = snapshot();
        expect(first.length).toBeGreaterThan(1000);
        // Something else entirely in between...
        world.onCombo(9);
        world.onLock({ u: 0.5, hardDrop: true });
        world.onClear({ lines: 3, tspin: true });
        world.levelUp(5);
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
        // Everything is a function of the clock and the events' own timestamps: the same to the last digit.
        expect(worst).toBeLessThan(1e-9);
        world.dispose();
    });

    it('drops every event in flight when it seeks, and puts the dust where the clock says', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4, tspin: true });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1);
        expect(world.getState().held).toBeGreaterThan(0);
        world.seek(40);
        expect(world.time).toBe(40);
        expect(world.getState()).toMatchObject({
            time: 40,
            combo: 0,
            power: 0,
            surge: 0,
            storm: 0,
            breath: 1,
            crown: 0,
            twist: 0,
            level: 1,
            palette: GEODE_PALETTES[0].name,
            held: 0,
            layoutLive: true,
            counts: {
                locks: 0, clears: 0, quads: 0, wisps: 0, shatters: 0,
            },
        });
        expect(world.twistTarget).toBe(0);
        expect(world.drift).toBe(40);
        expect(inUse(world.u.pulseA, 0)).toHaveLength(0);
        expect(inUse(world.u.strikeA, 3)).toHaveLength(0);
        expect(inUse(world.u.clearA, 0)).toHaveLength(0);
        expect(world.u.shock.value.x).toBeLessThan(-50);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.rowBeams.uniforms.frame.value.w).toBe(0);
        expect(used(world.wisps, 'aFrom')).toHaveLength(0);
        expect(used(world.shards, 'aBirth')).toHaveLength(0);
        expect(flashes(world)).toHaveLength(0);
        expect(flares(world)).toHaveLength(0);
        const {
            aAux, aStore, aPrev, aRelease,
        } = world.crystals.state;
        for (let i = 0; i < world.crystals.count; i++) {
            expect(aAux[i * 4 + 2]).toBe(0); // no lance stands
            expect(cutsOf(world, i)).toEqual([Infinity, Infinity]); // no wave is due
            expect(aStore[i * 4] + aStore[i * 4 + 1] + aStore[i * 4 + 2]).toBe(0);
            expect(aPrev[i * 3] + aPrev[i * 3 + 1] + aPrev[i * 3 + 2]).toBe(0);
            expect(peakIn(aRelease, i)).toBe(0);
        }
        // The next frame is a geode at rest, as far through its first mineral as the clock says.
        world.updateCamera(camera, { time: 40, delta: 0 });
        world.update({ time: 40, delta: 0 }, camera);
        expect(world.getState()).toMatchObject({ level: 1, mineral: mineralDrift(40) });
        expectPalette(world, mineralDrift(40));
        expect(world.u.live.value.toArray()).toEqual([0, 0, 0, 0]);
        expect(world.getPostState()).toMatchObject({
            flash: 0, kick: 0, exposure: 1, prism: { radius: 0, strength: 0 },
        });
        expect(world.getPostState().bloomBoost).toBeLessThan(1e-12);
        // The crystals are still there to be struck.
        expect(world.targets.left.length).toBeGreaterThan(0);
        world.onLock({ u: 0.2 });
        expect(world.counts.wisps).toBe(1);
        // A seek before the start of time is the start of time.
        world.seek(-5);
        expect(world.time).toBe(0);
        expect(world.drift).toBe(0);
        world.dispose();
    });

    it('starts a new run with the geode at rest and the dust still drifting', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1.5);
        world.onLock({ u: 0.7 });
        run(world, camera, 1);
        expect(world.getState().held).toBeGreaterThan(0);
        const { time, drift } = world;
        expect(drift).toBeGreaterThan(time); // the run has carried the dust further than the clock alone
        world.resetSession();
        // The dust keeps its place: nothing jumps on screen...
        expect(world.time).toBe(time);
        expect(world.drift).toBe(drift);
        // ...but the run is forgotten: no chain, no held light, no event in flight, the first mineral.
        expect(world.getState()).toMatchObject({
            combo: 0,
            power: 0,
            surge: 0,
            storm: 0,
            breath: 1,
            crown: 0,
            twist: 0,
            level: 1,
            palette: GEODE_PALETTES[0].name,
            held: 0,
            layoutLive: true,
            counts: {
                locks: 0, clears: 0, quads: 0, wisps: 0, shatters: 0,
            },
        });
        expect(inUse(world.u.pulseA, 0)).toHaveLength(0);
        expect(inUse(world.u.strikeA, 3)).toHaveLength(0);
        expect(inUse(world.u.clearA, 0)).toHaveLength(0);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.rowBeams.uniforms.frame.value.w).toBe(0);
        expect(used(world.wisps, 'aFrom')).toHaveLength(0);
        expect(flashes(world)).toHaveLength(0);
        expect(flares(world)).toHaveLength(0);
        // The crystals are still there to be struck, and the board is still where it was.
        expect(world.targets.left.length).toBeGreaterThan(0);
        world.onLock({ u: 0.2 });
        expect(world.counts.wisps).toBe(1);
        // The next frame carries on from the same dust, at its resting pace.
        run(world, camera, 1 / 60, 1);
        expect(world.drift - drift).toBeCloseTo(1 / 60, 9);
        world.dispose();
    });

    it('returns to its resting look long after the last event', () => {
        const { camera, world } = makeWorld('Low');
        const rest = { ...world.getPostState() };
        world.onLock({ u: 0.5, hardDrop: true });
        world.onCombo(5);
        world.onClear({ lines: 3 });
        run(world, camera, 2);
        world.onCombo(0);
        run(world, camera, 60, 1200);
        const post = world.getPostState();
        expect(post.flash).toBeLessThan(1e-6);
        expect(post.kick).toBeLessThan(1e-6);
        expect(post.shafts).toBeCloseTo(rest.shafts, 6);
        expect(post.bloomBoost).toBeCloseTo(rest.bloomBoost, 6);
        expect(post.exposure).toBeCloseTo(1, 6);
        expect(post.prism).toEqual({ radius: 0, strength: 0 });
        expect(world.u.breath.value).toBeCloseTo(1, 6);
        expect(world.u.live.value.toArray()).toEqual([0, 0, 0, 0]);
        expect(world.getState()).toMatchObject({ combo: 0, held: 0, crown: 0 });
        expect(world.getState().power).toBeLessThan(1e-6);
        expect(world.getState().surge).toBeLessThan(1e-6);
        // Its colours are the clock's and nothing an event left behind.
        expect(mineralDrift(world.time)).toBeGreaterThan(0.2);
        expectHue(world.u.heart.value, paletteAt(mineralDrift(world.time)).heart);
        expectPalette(world, mineralDrift(world.time));
        // The dust is back to its resting pace.
        const { drift } = world;
        run(world, camera, 1);
        expect(world.drift - drift).toBeCloseTo(1, 4);
        world.dispose();
    });
});

describe('geode effects: closed forms', () => {
    it('flies a spark along an arc from the board to the stone', () => {
        const from = [0, 2, -6];
        const mid = [-10, 14, -20];
        const to = [-30, 5, -50];
        expect(wispPoint(from, mid, to, 0)).toEqual(from);
        expect(wispPoint(from, mid, to, 1)).toEqual(to);
        const half = wispPoint(from, mid, to, 0.5);
        for (let k = 0; k < 3; k++) expect(half[k]).toBeCloseTo(from[k] * 0.25 + mid[k] * 0.5 + to[k] * 0.25, 9);
        // It bows toward its middle point on the way.
        expect(half[1]).toBeGreaterThan(Math.max(from[1], to[1]));
        const out = [0, 0, 0];
        expect(wispPoint(from, mid, to, 0.3, out)).toBe(out);
    });

    it('throws crystal dust that slows in the air and comes to rest', () => {
        expect(shardReach(0)).toBe(0);
        let previous = 0;
        let stride = Infinity;
        for (let tau = 0.25; tau <= 5; tau += 0.25) {
            const reach = shardReach(tau);
            expect(reach).toBeGreaterThan(previous);
            // Each quarter of a second carries it less far than the one before.
            expect(reach - previous).toBeLessThan(stride);
            stride = reach - previous;
            previous = reach;
        }
        // It never travels as far as it would have with no air to slow it.
        expect(shardReach(5)).toBeLessThan(5);
        expect(shardReach(600) - shardReach(60)).toBeLessThan(1e-6);
    });
});
