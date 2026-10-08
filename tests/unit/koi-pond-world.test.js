import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    DRAGON_CHAIN, DRAGON_VISIT, FULL_CHAIN, HUSH_HOLD, KOI_POND_PARTS, KoiPondWorld, REST_RIG, fovForAspect,
} from '../../src/themes/koi-pond/koi-pond-world.js';
import {
    POND, POND_LENGTH, POND_WIDTH, groundHeight, pieceLight, shoreDistance, waterDepth,
} from '../../src/themes/koi-pond/koi-pond-core.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/koi-pond/koi-pond-quality.js';
import { POST_LOOK } from '../../src/themes/koi-pond/koi-pond-post.js';
import { fallbackLayout, restEye } from '../../src/themes/koi-pond/koi-pond-composition.js';
import { planFlora } from '../../src/themes/koi-pond/koi-pond-flora.js';
import { LANTERN_AT, growMaples, planGarden } from '../../src/themes/koi-pond/koi-pond-garden.js';
import { bakePebbles } from '../../src/themes/koi-pond/koi-pond-bed.js';
import { PondLight, RING_SLOTS, WAVE_SPEED } from '../../src/themes/koi-pond/koi-pond-light.js';
import {
    PLUNGER_SLOTS, PondSurface, SIM_STEP, WAKE_EXTRA, WAKE_STRIDE, bakeWaterMask,
} from '../../src/themes/koi-pond/koi-pond-surface.js';

vi.setConfig({ testTimeout: 30_000 }); // every test builds a pond or two, on a machine that may be busy

const DT = 1 / 60;
const worlds = [];

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, capture = true, seed = undefined, layout = null,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new KoiPondWorld({
        scene, quality, capture, seed,
    }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(live ? (layout || fallbackLayout(width, height)) : null, aspect);
    world.seek(0);
    world.updateCamera(camera, { time: 0, delta: 0 });
    world.update({ time: 0, delta: 0 }, camera);
    worlds.push(world);
    return { scene, camera, world };
}

/** Advance the world from its current time by `seconds`, one simulation step a frame. */
function run(world, camera, seconds, each = null) {
    const t0 = world.time;
    const steps = Math.round(seconds / DT);
    for (let i = 1; i <= steps; i++) {
        each?.(i);
        const sim = { time: t0 + i * DT, delta: DT };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

/** The koi's poses, as plain numbers. */
function poses(world) {
    const { school } = world;
    return [school.x, school.y, school.z, school.heading, school.phase, school.glow, school.joined]
        .map((list) => Array.from(list));
}

const inRectangle = (x, z) => x >= POND.minX && x <= POND.maxX && z >= POND.minZ && z <= POND.maxZ;

afterEach(() => {
    for (const world of worlds.splice(0)) world.dispose();
    vi.restoreAllMocks();
});

describe('koi pond world: build', () => {
    it.each(QUALITY_NAMES)('builds the %s tier from node materials, with the parts its tier pays for', (quality) => {
        const { scene, world } = makeWorld(quality);
        const tier = QUALITY[quality];
        expect(scene.children).toEqual([world.root]);
        const materials = new Set();
        scene.traverse((object) => {
            if (object.material) materials.add(object.material);
        });
        expect(materials.size).toBeGreaterThan(8);
        for (const material of materials) {
            expect(material.isNodeMaterial, material.name).toBe(true);
            expect(material.isShaderMaterial, material.name).not.toBe(true);
        }
        // The whole picture and every event, on every tier.
        const always = [
            'ground', 'stones', 'lantern', 'wood', 'leaves', 'iris', 'pads', 'lilies', 'floaters', 'koi', 'water',
            'pools', 'spray',
        ];
        for (const part of always) expect(world.parts[part], `${quality}.${part}`).toBeTruthy();
        expect(Boolean(world.parts.dragon), `${quality} dragon`).toBe(tier.dragon > 0);
        expect(Boolean(world.parts.fireflies), `${quality} fireflies`).toBe(tier.fireflies > 0);
        expect(Boolean(world.parts.fireflyMirror), `${quality} fireflies in the water`).toBe(tier.fireflies > 0);
        expect(Boolean(world.parts.mist), `${quality} mist`).toBe(tier.mist > 0);
        // Every part answers to a name the capture flag can address, and hangs under the world's root.
        for (const name of Object.keys(world.parts)) {
            expect(KOI_POND_PARTS, name).toContain(name);
            expect(world.parts[name].mesh.parent, name).toBe(world.root);
            expect(world.parts[name].mesh.visible, name).toBe(true);
        }
        expect(world.school.count).toBe(tier.koi);
        expect(world.spray.count).toBe(tier.droplets);
        expect(world.rocks).toBe(world.garden.standing);
        expect(world.school.rocks).toBe(world.rocks); // the koi go round the rocks the garden stood in the water
        expect(world.getState()).toMatchObject({
            quality,
            time: 0,
            combo: 0,
            power: 0,
            breath: 1,
            level: 1,
            koi: tier.koi,
            airborne: 0,
            joined: 0,
            dragon: 0,
            drops: 0,
            waveSteps: 0, // no renderer: no waves, the koi swim all the same
            counts: {
                locks: 0, clears: 0, quads: 0, leaps: 0, steps: 0, splashes: 0,
            },
        });
        expect(world.getState().lilies).toBeGreaterThan(0);
        expect(world.getState().lilies).toBeLessThanOrEqual(tier.lotus);
        // The moon hangs above the horizon, a unit direction; the lantern burns where the garden stood it.
        expect(world.light.moonDirection.length()).toBeCloseTo(1, 9);
        expect(world.light.moonDirection.y).toBeGreaterThan(0.2);
        expect(world.light.u.lantern.value.toArray().slice(0, 3)).toEqual(world.garden.lantern.flame);
        expect(world.surface).toBeNull();
    });

    it('names every part its richest tier draws, and no part twice', () => {
        const { world } = makeWorld('Extreme');
        expect(Object.keys(world.parts).sort()).toEqual([...KOI_POND_PARTS].sort());
        expect(new Set(KOI_POND_PARTS).size).toBe(KOI_POND_PARTS.length);
    });

    it('falls back to the High tier for a quality it does not know', () => {
        const scene = new THREE.Scene();
        const world = new KoiPondWorld({ scene, quality: 'Nonsense' });
        worlds.push(world);
        expect(world.tier).toBe(QUALITY.High);
        expect(new KoiPondWorld({ scene }).tier).toBe(QUALITY.High);
        // Nothing is in the scene until it is built.
        expect(scene.children).toHaveLength(0);
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['ground', 'water', 'no-such-part']);
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'ground' || name === 'water');
        });
        world.showOnlyParts(Object.keys(world.parts));
        expect(Object.values(world.parts).every((part) => part.mesh.visible)).toBe(true);
    });

    it('releases every geometry, material and texture it made, leaves the scene and survives a second dispose', () => {
        const { scene, camera, world } = makeWorld('Medium');
        const made = new Map();
        scene.traverse((object) => {
            if (object.geometry) made.set(object.geometry, `geometry of ${object.name || object.type}`);
            if (object.material) made.set(object.material, `material ${object.material.name || object.type}`);
        });
        made.set(world.light.noiseTexture, 'the noise texture');
        expect(made.size).toBeGreaterThan(16);
        const spies = [...made.entries()].map(([resource, label]) => [vi.spyOn(resource, 'dispose'), label]);
        const { root, light } = world;
        const disposeLight = vi.spyOn(light, 'dispose');
        world.dispose();
        expect(scene.children).toHaveLength(0);
        expect(root.parent).toBeNull();
        expect(spies.filter(([spy]) => spy.mock.calls.length === 0).map(([, label]) => label)).toEqual([]);
        expect(disposeLight).toHaveBeenCalledOnce();
        expect(world.disposed).toBe(true);
        expect(world.parts).toEqual({});
        const released = [
            'light', 'surface', 'school', 'koi', 'lilies', 'pools', 'spray', 'dragon', 'fireflies', 'mist',
        ];
        for (const key of released) expect(world[key], key).toBeNull();
        expect(() => world.dispose()).not.toThrow();
        expect(disposeLight).toHaveBeenCalledOnce();
        // A late frame or a late event after retirement is harmless.
        expect(() => {
            world.updateCamera(camera, { time: 11, delta: 0.016 });
            world.update({ time: 11, delta: 0.016 }, camera);
            world.onLock({ u: 0.5 });
            world.onLock({ u: 0.2, hardDrop: true, color: '#ff7b52' });
            world.onClear({ lines: 4 });
            world.onClear({ lines: 2, perfect: true });
            world.onCombo(9);
            world.levelUp(2);
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null);
            world.setReducedMotion(true);
            world.showOnlyParts(['ground']);
            world.resetSession();
            world.seek(3);
        }).not.toThrow();
        expect(world.getState()).toMatchObject({
            koi: 0, airborne: 0, joined: 0, dragon: 0, drops: 0, moon: null,
        });
    });
});

describe('koi pond world: locks', () => {
    it('drops a lock through the card into the pond, in the piece\'s colour, and throws a pebble of light', () => {
        const { camera, world } = makeWorld('Low');
        run(world, camera, 2);
        const ring = vi.spyOn(world.light, 'ring');
        const startle = vi.spyOn(world.school, 'startle');
        const t0 = world.time;
        world.onLock({ rows: [12, 11], u: 0.2, color: '#ff7b52' });
        expect(world.counts.locks).toBe(1);
        // ── At once: a ring under the piece's column, behind the card ──
        expect(ring).toHaveBeenCalledOnce();
        const [x, z, birth, strength, rgb] = ring.mock.calls[0];
        expect(birth).toBe(t0);
        expect(strength).toBeGreaterThan(0);
        expect(waterDepth(x, z)).toBeGreaterThan(0.5); // out over the basin
        const under = new THREE.Vector3(x, 0, z).project(camera);
        const board = world.layout.boards[0];
        expect(under.x * 0.5 + 0.5).toBeGreaterThan(board.x0);
        expect(under.x * 0.5 + 0.5).toBeLessThan((board.x0 + board.x1) / 2); // a fifth of the way across
        expect(0.5 - under.y * 0.5).toBeGreaterThan(board.y0);
        expect(0.5 - under.y * 0.5).toBeLessThan(board.y1);
        // The ring keeps the piece's hue.
        const hue = pieceLight('#ff7b52');
        expect(rgb[1] / rgb[0]).toBeCloseTo(hue[1] / hue[0], 9);
        expect(rgb[2] / rgb[0]).toBeCloseTo(hue[2] / hue[0], 9);
        // ── On its way: one pebble, and nothing has frightened the fish yet ──
        expect(world.queue).toHaveLength(1);
        expect(startle).not.toHaveBeenCalled();
        const landing = world.queue[0].time;
        expect(landing).toBeGreaterThan(t0 + 0.3);
        expect(landing).toBeLessThan(t0 + 1.5);
        run(world, camera, 2 * DT);
        expect(world.getState().drops).toBeGreaterThan(0); // the pebble and its sparks are in the air
        // ── It lands: a second, stronger ring where it fell, left of the card, and the koi there dart ──
        run(world, camera, landing - world.time + 2 * DT);
        expect(world.queue).toHaveLength(0);
        expect(ring).toHaveBeenCalledTimes(2);
        const [lx, lz, landed, landedStrength, landedRgb] = ring.mock.calls[1];
        expect(landed).toBeGreaterThanOrEqual(landing - DT);
        expect(landed).toBeLessThanOrEqual(landing + 2 * DT);
        expect(landedStrength).toBeGreaterThan(strength);
        expect(lx).toBeLessThan(x - 0.5); // thrown out of the card's left edge, away from it
        expect(waterDepth(lx, lz)).toBeGreaterThan(0.1);
        expect(landedRgb[1] / landedRgb[0]).toBeCloseTo(hue[1] / hue[0], 9);
        expect(startle).toHaveBeenCalledOnce();
        expect(startle.mock.calls[0].slice(0, 2)).toEqual([lx, lz]);
        // The camera felt it, a little.
        expect(world.kick).toBeGreaterThan(0);
        expect(world.kick).toBeLessThan(0.1);
    });

    it('throws a lock right of the middle out of the card\'s right edge, and one with no colour in moon white', () => {
        const { camera, world } = makeWorld('Low');
        const ring = vi.spyOn(world.light, 'ring');
        world.onLock({ rows: [19], u: 0.9 });
        run(world, camera, 1.6);
        expect(ring).toHaveBeenCalledTimes(2);
        const [[x], [lx, lz, , , rgb]] = ring.mock.calls;
        expect(lx).toBeGreaterThan(x + 0.5);
        expect(waterDepth(lx, lz)).toBeGreaterThan(0.1);
        const white = pieceLight(null);
        expect(rgb[0] / rgb[2]).toBeCloseTo(white[0] / white[2], 9);
        expect(rgb[1] / rgb[2]).toBeCloseTo(white[1] / white[2], 9);
        // Dead centre alternates sides, so the middle column does not always throw the same way.
        ring.mockClear();
        world.onLock({ u: 0.5 });
        world.onLock({ u: 0.5 });
        run(world, camera, 1.6);
        const landings = ring.mock.calls.filter((call) => call[2] > world.time - 1.5).map((call) => call[0]);
        expect(Math.min(...landings)).toBeLessThan(-1);
        expect(Math.max(...landings)).toBeGreaterThan(1);
    });

    it('hits harder on a hard drop: three pebbles, a wider fright, a kick and a gust', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        const softStartle = vi.spyOn(soft.world.school, 'startle');
        const hardStartle = vi.spyOn(hard.world.school, 'startle');
        const hardRing = vi.spyOn(hard.world.light, 'ring');
        const softRing = vi.spyOn(soft.world.light, 'ring');
        soft.world.onLock({ u: 0.3, rows: [18], color: '#7eeeff' });
        hard.world.onLock({
            u: 0.3, rows: [18], color: '#7eeeff', hardDrop: true,
        });
        expect(soft.world.queue).toHaveLength(1);
        expect(hard.world.queue).toHaveLength(3);
        expect(hardRing.mock.calls[0][3]).toBeGreaterThan(softRing.mock.calls[0][3]);
        expect(hard.world.kick).toBeGreaterThan(soft.world.kick * 2);
        expect(hard.world.gust).toBeGreaterThan(soft.world.gust);
        expect(hard.world.getPostState()).toBe(hard.world.getPostState());
        // The kick pulls the lens in for a moment, then lets go.
        const { fov } = hard.camera;
        run(hard.world, hard.camera, DT);
        run(soft.world, soft.camera, DT);
        expect(hard.camera.fov).toBeLessThan(fov - 0.05);
        expect(hard.world.getPostState().flash).toBeGreaterThan(soft.world.getPostState().flash);
        run(hard.world, hard.camera, 2);
        run(soft.world, soft.camera, 2);
        expect(hard.camera.fov).toBeCloseTo(fov, 3);
        // Three landings fanned out, each a stronger and wider fright than the one of a soft lock.
        expect(softStartle).toHaveBeenCalledOnce();
        expect(hardStartle).toHaveBeenCalledTimes(3);
        expect(new Set(hardStartle.mock.calls.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`)).size).toBe(3);
        for (const [x, z, strength, reach] of hardStartle.mock.calls) {
            expect(waterDepth(x, z)).toBeGreaterThan(0.1);
            expect(strength).toBeGreaterThan(softStartle.mock.calls[0][2]);
            expect(reach).toBeGreaterThan(softStartle.mock.calls[0][3]);
        }
        expect(hard.world.counts.locks).toBe(1);
    });

    it('lands every pebble in the water the waves are simulated on, wherever the piece locked', () => {
        // "It must come down in the water."
        const strays = [];
        for (const [width, height] of [[1600, 900], [2560, 1080], [1024, 768], [430, 932]]) {
            const { camera, world } = makeWorld('Minimal', { width, height });
            const ring = vi.spyOn(world.light, 'ring');
            let n = 0;
            for (let row = 1; row <= 19; row += 3) {
                for (let column = 0; column <= 10; column += 2) {
                    world.onLock({ rows: [row], u: column / 10, hardDrop: (n += 1) % 3 === 0 });
                    run(world, camera, 3 * DT);
                }
            }
            run(world, camera, 2);
            expect(world.queue).toHaveLength(0);
            expect(ring.mock.calls.length).toBeGreaterThan(80);
            for (const [x, z] of ring.mock.calls) {
                const where = `${width}x${height}: light at (${x.toFixed(2)}, ${z.toFixed(2)})`;
                if (!(waterDepth(x, z) > 0)) strays.push(`${where} is on the bank`);
                else if (!inRectangle(x, z)) strays.push(`${where} is off the simulated water`);
            }
            world.dispose();
        }
        expect(strays).toEqual([]);
    });

    it('aims at the click when a mode has no board, and at the solo board\'s place when nothing is said', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        expect(world.getState().layoutLive).toBe(false);
        const ring = vi.spyOn(world.light, 'ring');
        world.onLock({ screen: { x: 0.2, y: 0.6 }, color: '#ffc852' });
        const [left] = ring.mock.calls[0];
        expect(left).toBeLessThan(-1);
        world.onLock({ screen: { x: 0.85, y: 0.6 } });
        expect(ring.mock.calls[1][0]).toBeGreaterThan(1);
        world.onLock({});
        const [x, z] = ring.mock.calls[2];
        expect(Math.abs(x)).toBeLessThan(1);
        expect(waterDepth(x, z)).toBeGreaterThan(0.5);
        run(world, camera, 1.6);
        expect(world.counts.locks).toBe(3);
        expect(world.queue).toHaveLength(0);
    });

    it('follows the board it is given: a lock lands under a board on the left or on the right', () => {
        const at = (x0) => ({
            cardCount: 1,
            cards: [{
                x0: x0 - 0.02, y0: 0.1, x1: x0 + 0.22, y1: 0.9,
            }],
            hud: null,
            boards: [{
                x0, y0: 0.2, x1: x0 + 0.2, y1: 0.85,
            }, null, null, null, null],
        });
        const { world } = makeWorld('Minimal', { layout: at(0.1) });
        expect(world.getState().layoutLive).toBe(true);
        const ring = vi.spyOn(world.light, 'ring');
        world.onLock({ u: 0.5, rows: [10] });
        expect(ring.mock.calls[0][0]).toBeLessThan(-1.5);
        world.setLayout(at(0.7));
        world.onLock({ u: 0.5, rows: [10] });
        expect(ring.mock.calls[1][0]).toBeGreaterThan(1.5);
        // A player with no board of their own is answered at the first board on screen.
        world.onLock({ u: 0.5, rows: [10], player: 3 });
        expect(ring.mock.calls[2][0]).toBeCloseTo(ring.mock.calls[1][0], 9);
        // The board gone: back to where the solo board would float.
        world.setLayout(null);
        expect(world.getState().layoutLive).toBe(false);
        world.onLock({ u: 0.5, rows: [10] });
        expect(Math.abs(ring.mock.calls[3][0])).toBeLessThan(0.5);
    });

    it('keeps its bands of light and its work queue bounded however fast the pieces lock', () => {
        const { camera, world } = makeWorld('Low');
        const slots = world.light.ringA.slice();
        for (let i = 0; i < 60; i++) {
            world.onLock({ u: (i % 10) / 10 + 0.05, rows: [19 - (i % 12)], hardDrop: i % 2 === 0 });
            run(world, camera, 4 * DT);
            expect(world.queue.length).toBeLessThanOrEqual(60);
        }
        expect(world.light.ringA).toHaveLength(RING_SLOTS);
        world.light.ringA.forEach((slot, i) => expect(slot).toBe(slots[i]));
        expect(world.getState().drops).toBeLessThanOrEqual(world.spray.count);
        run(world, camera, 3);
        expect(world.queue).toHaveLength(0);
        expect(world.counts.locks).toBe(60);
    });
});

describe('koi pond world: clears, chains and the four-line clear', () => {
    const LINES = [[1, 1], [2, 2], [3, 3]];
    it.each(LINES)('sends %s koi over the water for %s lines, a lily a line, more light', (lines, flights) => {
        const { camera, world } = makeWorld('High');
        run(world, camera, 10); // the school spreads out first
        const leap = vi.spyOn(world.school, 'leap');
        const ring = vi.spyOn(world.light, 'ring');
        const rest = { ...world.getPostState() };
        const before = world.getState();
        expect(before.liliesOpen).toBe(0);
        world.onClear({ rows: [19, 18, 17].slice(0, lines), lines });
        expect(world.counts.clears).toBe(1);
        expect(world.counts.quads).toBe(0);
        expect(world.hushUntil).toBeLessThan(world.time); // no held breath for less than four
        let airborne = 0;
        run(world, camera, 3, () => { airborne = Math.max(airborne, world.getState().airborne); });
        // One koi a line (each from the other reach than the last), the third with a turn in the air.
        const asked = leap.mock.calls.map(([options]) => options);
        expect(asked.filter((options) => options.side !== 0)).toHaveLength(flights);
        expect(world.counts.leaps).toBe(flights);
        expect(airborne).toBeGreaterThanOrEqual(1);
        if (lines >= 2) expect(asked[1].side).toBe(-asked[0].side);
        expect(asked.some((options) => options.twist)).toBe(lines === 3);
        // Each breaks the surface and falls back into it.
        expect(world.counts.splashes).toBe(flights * 2);
        // A gold ring crosses the pond from under the board, a lily opens for every line...
        const gold = ring.mock.calls[0];
        expect(waterDepth(gold[0], gold[1])).toBeGreaterThan(0.5);
        expect(gold[4][0]).toBeGreaterThan(gold[4][1]);
        expect(gold[4][1]).toBeGreaterThan(gold[4][2]);
        expect(world.getState().liliesOpen).toBe(lines);
        // ...and the light swelled: the post blooms more and stops down so the colours survive.
        expect(world.glow).toBeGreaterThan(0);
        expect(world.getPostState().bloomBoost).toBeGreaterThan(rest.bloomBoost);
        expect(world.getPostState().exposure).toBeLessThan(rest.exposure);
        // Long after, the pond is at rest again: lilies closed, nobody in the air.
        run(world, camera, 30);
        expect(world.getState()).toMatchObject({ liliesOpen: 0, airborne: 0 });
        expect(world.glow).toBeLessThan(1e-4);
        expect(world.getPostState().exposure).toBeCloseTo(1, 3);
    });

    it('turns one koi over in the air for a T-spin, and reads nonsense as one line', () => {
        const { camera, world } = makeWorld('Low');
        run(world, camera, 10);
        const leap = vi.spyOn(world.school, 'leap');
        world.onClear({ lines: 2, tspin: true });
        expect(leap.mock.calls[0][0]).toMatchObject({ twist: true });
        run(world, camera, 1);
        expect(leap.mock.calls[1][0]).toMatchObject({ twist: false });
        leap.mockClear();
        for (const lines of [NaN, undefined, 0, -3, 'x']) {
            world.onClear({ lines });
            run(world, camera, 1);
        }
        expect(world.counts.clears).toBe(6);
        expect(world.counts.quads).toBe(0);
        // More than four is four.
        world.onClear({ lines: 9 });
        expect(world.counts.quads).toBe(1);
        // A click's clear starts where it was clicked.
        const ring = vi.spyOn(world.light, 'ring');
        run(world, camera, 12);
        ring.mockClear();
        world.onClear({ lines: 1, screen: { x: 0.15, y: 0.6 } });
        run(world, camera, 2 * DT);
        expect(ring.mock.calls[0][0]).toBeLessThan(-1.5);
    });

    it('holds its breath on four lines, then sends the school over the water and raises the dragon', () => {
        const { camera, world } = makeWorld('High');
        run(world, camera, 10);
        const leap = vi.spyOn(world.school, 'leap');
        const ring = vi.spyOn(world.light, 'ring');
        const t0 = world.time;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.counts).toMatchObject({ clears: 1, quads: 1, leaps: 0 });
        expect(world.hushUntil).toBeCloseTo(t0 + HUSH_HOLD, 9);
        expect(world.school.hush).toBeCloseTo(HUSH_HOLD, 6);
        // ── The hush: every light sinks, the koi hang still, nothing has leapt, no ring has gone out ──
        run(world, camera, HUSH_HOLD * 0.8);
        expect(world.getState().breath).toBeLessThan(0.3);
        expect(world.light.u.breath.value).toBe(world.getState().breath);
        expect(leap).not.toHaveBeenCalled();
        expect(ring).not.toHaveBeenCalled();
        expect(world.getState().airborne).toBe(0);
        // ── Then everything goes ──
        let airborne = 0;
        run(world, camera, 2.2, () => { airborne = Math.max(airborne, world.getState().airborne); });
        expect(ring.mock.calls[0][2]).toBeGreaterThanOrEqual(t0 + HUSH_HOLD - DT);
        expect(leap.mock.calls.filter(([options]) => options.side !== 0)).toHaveLength(6);
        expect(world.counts.leaps).toBeGreaterThanOrEqual(4);
        expect(airborne).toBeGreaterThanOrEqual(3); // several in the air at once
        expect(world.getState().breath).toBeCloseTo(1, 2);
        // A lily a line at least.
        expect(world.getState().liliesOpen).toBeGreaterThanOrEqual(Math.min(4, world.getState().lilies));
        // The dragon comes up for it...
        expect(world.getState().dragon).toBeGreaterThan(0.5);
        expect(world.dragon.arch).toBeGreaterThan(0.3); // ...and rears
        // ...stays its visit, and goes back down.
        run(world, camera, DRAGON_VISIT + 12);
        expect(world.getState().dragon).toBe(0);
        expect(world.getState().airborne).toBe(0);
    });

    it('answers a perfect clear as four lines whatever it cleared: every lily, eight flights', () => {
        const { camera, world } = makeWorld('High');
        run(world, camera, 10);
        const leap = vi.spyOn(world.school, 'leap');
        world.onClear({ rows: [19], lines: 1, perfect: true });
        expect(world.counts.quads).toBe(1);
        run(world, camera, 3);
        expect(leap.mock.calls.filter(([options]) => options.side !== 0)).toHaveLength(8);
        expect(world.getState().liliesOpen).toBe(world.getState().lilies);
    });

    it('charges with the chain: koi join the ring, the lilies count it, a long chain wakes the dragon', () => {
        const { camera, world } = makeWorld('High');
        run(world, camera, 5);
        expect(world.getState()).toMatchObject({
            combo: 0, power: 0, joined: 0, liliesOpen: 0, dragon: 0,
        });
        // A single clear is not a chain.
        world.onCombo(1);
        run(world, camera, 6);
        expect(world.getState()).toMatchObject({ combo: 1, joined: 0, liliesOpen: 0 });
        expect(world.power).toBeCloseTo(1 / FULL_CHAIN, 2);
        // A chain: the school starts to circle, the lilies open one by one as its gauge.
        world.onCombo(4);
        expect(world.school.chain).toBe(4);
        run(world, camera, 8);
        const four = world.getState();
        expect(four.joined).toBeGreaterThan(0);
        expect(four.joined).toBeLessThan(four.koi);
        expect(four.liliesOpen).toBe(Math.ceil((3 / (FULL_CHAIN - 1)) * four.lilies));
        expect(four.power).toBeCloseTo(4 / FULL_CHAIN, 2);
        expect(world.light.u.power.value).toBe(four.power);
        expect(four.dragon).toBe(0);
        expect(world.getPostState().warm).toBeGreaterThan(0);
        // Long enough and the dragon wakes under the board; fully charged, everything is alight.
        world.onCombo(DRAGON_CHAIN);
        run(world, camera, 6);
        expect(world.getState().dragon).toBeGreaterThan(0.5);
        world.onCombo(FULL_CHAIN + 6);
        run(world, camera, 8);
        const full = world.getState();
        expect(full.power).toBeCloseTo(1, 2);
        expect(full.power).toBeLessThanOrEqual(1);
        expect(full.joined).toBe(full.koi);
        expect(full.liliesOpen).toBe(full.lilies);
        expect(world.getPostState().warm).toBeLessThanOrEqual(1);
        expect(world.getPostState().exposure).toBeLessThan(1);
        // The chain breaks: the charge drains, the koi go home, the dragon sinks.
        world.onCombo(0);
        expect(world.school.chain).toBe(0);
        run(world, camera, 25);
        expect(world.getState()).toMatchObject({
            combo: 0, joined: 0, liliesOpen: 0, dragon: 0,
        });
        expect(world.power).toBeLessThan(0.01);
        // Nonsense is no chain.
        world.onCombo(NaN);
        expect(world.combo).toBe(0);
        world.onCombo(-4);
        expect(world.combo).toBe(0);
        world.onCombo('3');
        expect(world.combo).toBe(3);
    });

    it('opens every lily and lifts the light on a new level, silently when told to', () => {
        const { camera, world } = makeWorld('Low');
        world.levelUp(4);
        expect(world.getState().level).toBe(4);
        expect(world.glow).toBeGreaterThanOrEqual(0.5);
        expect(world.stir).toBe(1);
        run(world, camera, 2.5);
        expect(world.getState().liliesOpen).toBe(world.getState().lilies);
        // Resting on a level (a capture) changes nothing but the number.
        const quiet = makeWorld('Low');
        quiet.world.levelUp(7, { silent: true });
        expect(quiet.world.getState().level).toBe(7);
        expect(quiet.world.glow).toBe(0);
        expect(quiet.world.stir).toBe(0);
        // Nonsense is level one.
        for (const level of [NaN, 0, -2, undefined, 'x']) {
            quiet.world.levelUp(level, { silent: true });
            expect(quiet.world.getState().level).toBe(1);
        }
    });

    it('hands the post a reused state of finite numbers', () => {
        const { camera, world } = makeWorld('Low');
        const post = world.getPostState();
        expect(post).toEqual({
            flash: 0, bloomBoost: 0, exposure: 1, warm: 0,
        });
        world.onLock({ hardDrop: true, u: 0.4 });
        world.onClear({ lines: 4 });
        world.onCombo(12);
        run(world, camera, 3, () => {
            expect(world.getPostState()).toBe(post);
            for (const key of ['flash', 'bloomBoost', 'exposure', 'warm']) {
                expect(Number.isFinite(post[key]), key).toBe(true);
                expect(post[key], key).toBeGreaterThanOrEqual(0);
            }
            expect(post.exposure).toBeLessThanOrEqual(1);
            expect(post.exposure).toBeGreaterThan(0.5);
            expect(post.warm).toBeLessThanOrEqual(1);
        });
        expect(post.bloomBoost).toBeGreaterThan(0);
    });
});

describe('koi pond world: time', () => {
    it('takes one step of the pond a sixtieth of a second, however the frames fall', () => {
        const slow = makeWorld('Low');
        const fast = makeWorld('Low');
        for (let i = 1; i <= 60; i++) {
            const sim = { time: i / 30, delta: 1 / 30 };
            slow.world.updateCamera(slow.camera, sim);
            slow.world.update(sim, slow.camera);
        }
        for (let i = 1; i <= 480; i++) {
            const sim = { time: i / 240, delta: 1 / 240 };
            fast.world.updateCamera(fast.camera, sim);
            fast.world.update(sim, fast.camera);
        }
        expect(slow.world.counts.steps).toBe(120);
        expect(fast.world.counts.steps).toBe(120);
        expect(poses(fast.world)).toEqual(poses(slow.world));
        expect(fast.world.school.time).toBeCloseTo(2, 4);
    });

    it('rations a live frame to five steps and plays a capture in full', () => {
        const live = makeWorld('Minimal', { capture: false });
        live.world.update({ time: 1, delta: 1 }, live.camera);
        expect(live.world.counts.steps).toBe(5);
        expect(live.world.accumulator).toBe(0); // the rest of the stall is dropped, not owed
        live.world.update({ time: 1 + DT, delta: DT }, live.camera);
        expect(live.world.counts.steps).toBe(6);
        const capture = makeWorld('Minimal', { capture: true });
        capture.world.update({ time: 1, delta: 1 }, capture.camera);
        expect(capture.world.counts.steps).toBe(60);
        // A frame of no time steps nothing, and neither does a negative one.
        capture.world.update({ time: 1, delta: 0 }, capture.camera);
        capture.world.update({ time: 1, delta: -3 }, capture.camera);
        capture.world.update({ time: 1 }, capture.camera);
        expect(capture.world.counts.steps).toBe(60);
    });

    it('replays a frame: seek, then the same steps, gives the same pond whatever came before', () => {
        const script = (world, camera) => {
            world.seek(3);
            run(world, camera, 4, (i) => {
                if (i === 30) world.onLock({ u: 0.2, rows: [12, 11], color: '#ff7b52' });
                if (i === 60) {
                    world.onLock({
                        u: 0.8, rows: [18], hardDrop: true, color: '#7eeeff',
                    });
                }
                if (i === 90) world.onClear({ rows: [19, 18, 17], lines: 3 });
                if (i === 90) world.onCombo(5);
                if (i === 150) world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
                if (i === 200) world.levelUp(2);
            });
            return { poses: poses(world), state: world.getState(), drops: Array.from(world.spray.py) };
        };
        const a = makeWorld('Medium');
        const first = script(a.world, a.camera);
        expect(first.state.counts).toMatchObject({ locks: 2, clears: 2, quads: 1 });
        expect(first.state.counts.leaps).toBeGreaterThan(3);
        expect(first.state.time).toBeCloseTo(7, 9);
        // A second pond, the same script: the same koi, the same spray, the same numbers.
        const b = makeWorld('Medium');
        expect(script(b.world, b.camera)).toEqual(first);
        // The first pond again, after everything it has been through.
        a.world.onCombo(12);
        a.world.onClear({ lines: 4, perfect: true });
        run(a.world, a.camera, 5);
        expect(script(a.world, a.camera)).toEqual(first);
        // Another school of koi is another pond.
        const c = makeWorld('Medium', { seed: 99 });
        expect(script(c.world, c.camera).poses).not.toEqual(first.poses);
    });

    it('drops every event in flight when it seeks, and stills the pond', () => {
        const { camera, world } = makeWorld('High');
        const still = makeWorld('High');
        run(world, camera, 3);
        world.onLock({ hardDrop: true, u: 0.3 });
        world.onClear({ lines: 4 });
        world.onCombo(9);
        world.levelUp(5);
        run(world, camera, 2);
        expect(world.getState().airborne + world.getState().joined + world.getState().drops).toBeGreaterThan(0);
        world.onLock({ u: 0.7 });
        expect(world.queue.length).toBeGreaterThan(0);
        world.seek(42);
        expect(world.queue).toHaveLength(0);
        expect(world.getState()).toMatchObject({
            time: 42,
            combo: 0,
            power: 0,
            glow: 0,
            breath: 1,
            level: 1,
            airborne: 0,
            joined: 0,
            dragon: 0,
            drops: 0,
            liliesOpen: 0,
            counts: {
                locks: 0, clears: 0, quads: 0, leaps: 0, steps: 0, splashes: 0,
            },
        });
        expect(world.kick).toBe(0);
        expect(world.hushUntil).toBeLessThan(0);
        expect(world.school.chain).toBe(0);
        // The koi are back where a pond sought to that time starts them (the clock turns their places).
        still.world.seek(42);
        expect(poses(world)).toEqual(poses(still.world));
        still.world.seek(7);
        expect(poses(world)).not.toEqual(poses(still.world));
        // A seek before the start of time is a seek to it.
        world.seek(-5);
        expect(world.time).toBe(0);
    });

    it('ends the chain and forgets what is pending for a new run, and leaves the koi swimming', () => {
        const { camera, world } = makeWorld('High');
        run(world, camera, 3);
        world.onCombo(8);
        world.onClear({ lines: 4 });
        world.onLock({ u: 0.4 });
        run(world, camera, 0.2);
        const before = poses(world);
        const { counts } = world.getState();
        expect(world.queue.length).toBeGreaterThan(0);
        world.resetSession();
        expect(world.getState()).toMatchObject({ combo: 0, counts });
        expect(world.school.chain).toBe(0);
        expect(world.queue).toHaveLength(0);
        expect(world.hushUntil).toBeLessThan(world.time);
        expect(poses(world)).toEqual(before);
        // Nothing that was queued fires afterwards; the dragon the four lines raised goes back down.
        const { leaps } = world.counts;
        run(world, camera, 20);
        expect(world.counts.leaps).toBe(leaps);
        expect(world.getState()).toMatchObject({ dragon: 0, joined: 0 });
    });

    it('holds a frozen frame still, and still takes what gameplay sends it', () => {
        const { camera, world } = makeWorld('Low');
        run(world, camera, 2);
        const before = poses(world);
        for (let i = 0; i < 5; i++) {
            world.updateCamera(camera, { time: world.time, delta: 0 });
            world.update({ time: world.time, delta: 0 }, camera);
        }
        expect(poses(world)).toEqual(before);
        expect(world.counts.steps).toBe(120);
        world.onLock({ u: 0.3 });
        world.onClear({ lines: 2 });
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.counts).toMatchObject({ locks: 1, clears: 1 });
        expect(world.getState().breath).toBe(1);
    });
});

describe('koi pond world: camera and composition', () => {
    it('stands over the near water and looks steeply down at the pond\'s middle', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [430, 932]]) {
            const { camera, world } = makeWorld('Minimal', { width, height });
            const aspect = width / height;
            const eye = restEye(aspect);
            // A slow drift, as of someone leaning over the water: never far from the rig.
            run(world, camera, 30, () => {
                const { x, y, z } = camera.position;
                expect(Math.hypot(x - eye.x, y - eye.y, z - eye.z)).toBeLessThan(0.6);
            });
            expect(camera.fov).toBeCloseTo(fovForAspect(aspect), 6);
            expect(camera.near).toBe(REST_RIG.near);
            expect(camera.far).toBe(REST_RIG.far);
            const forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            expect(forward.y).toBeLessThan(-0.6);
            expect(forward.z).toBeLessThan(0);
            // The middle of the screen is the middle of the pond.
            const middle = world.screenToWater(0.5, 0.5, { x: 0, z: 0 });
            expect(Math.hypot(middle.x, middle.z)).toBeLessThan(0.5);
            expect(world.aspect).toBeCloseTo(aspect, 12);
        }
    });

    it('finds the water under a screen point and keeps the answer on the pond', () => {
        const { world } = makeWorld('Minimal');
        const left = world.screenToWater(0.2, 0.5, { x: 0, z: 0 });
        const right = world.screenToWater(0.8, 0.5, { x: 0, z: 0 });
        expect(left.x).toBeLessThan(-2);
        expect(right.x).toBeGreaterThan(2);
        expect(Math.abs(left.z - right.z)).toBeLessThan(0.5); // level, but for the camera's slow drift
        // Up the screen is away from the viewer.
        const far = world.screenToWater(0.5, 0.2, { x: 0, z: 0 });
        const near = world.screenToWater(0.5, 0.8, { x: 0, z: 0 });
        expect(far.z).toBeLessThan(near.z);
        // Off the screen, the answer is held to the pond.
        for (const [sx, sy] of [[-4, 0.5], [5, 0.5], [0.5, -6], [0.5, 9], [NaN, 0.5]]) {
            const hit = world.screenToWater(sx, sy, { x: 0, z: 0 });
            if (Number.isNaN(sx)) continue;
            expect(inRectangle(hit.x, hit.z), `${sx}, ${sy}`).toBe(true);
        }
        // It writes into what it is given.
        const out = { x: 9, z: 9 };
        expect(world.screenToWater(0.5, 0.5, out)).toBe(out);
    });

    it('leans the view with the pointer', () => {
        const { camera, world } = makeWorld('Minimal');
        const at = (pointerX, pointerY) => {
            world.updateCamera(camera, {
                time: 10, delta: 0, pointerX, pointerY,
            });
            return camera.position.clone();
        };
        const rest = at(0, 0);
        expect(at(1, 0).x).toBeGreaterThan(rest.x + 0.2);
        expect(at(-1, 0).x).toBeLessThan(rest.x - 0.2);
        expect(at(0, 1).distanceTo(rest)).toBeGreaterThan(0.1);
        expect(at(0, 0).distanceTo(rest)).toBeCloseTo(0, 12);
    });

    it('keeps the camera still under reduced motion, and keeps the feedback', () => {
        const { camera, world } = makeWorld('Low');
        world.setReducedMotion(true);
        const eye = restEye(1600 / 900);
        const startle = vi.spyOn(world.school, 'startle');
        world.onLock({ u: 0.3, hardDrop: true, color: '#ffadd2' });
        world.onClear({ lines: 4 });
        world.onCombo(8);
        run(world, camera, 3, (i) => {
            world.updateCamera(camera, {
                time: world.time, delta: 0, pointerX: 1, pointerY: -1,
            });
            if (i % 20) return;
            expect(camera.position.x).toBeCloseTo(eye.x, 12);
            expect(camera.position.y).toBeCloseTo(eye.y, 12);
            expect(camera.position.z).toBeCloseTo(eye.z, 12);
            expect(camera.up.toArray()).toEqual([0, 1, 0]);
            expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 9);
        });
        // The light lands at once instead of flying; the koi still dart, leap and gather.
        expect(startle).toHaveBeenCalledTimes(3);
        expect(world.counts).toMatchObject({ locks: 1, clears: 1, quads: 1 });
        expect(world.counts.leaps).toBeGreaterThan(0);
        expect(world.power).toBeGreaterThan(0.3);
        // Anything but true is not reduced.
        world.setReducedMotion('yes');
        expect(world.reducedMotion).toBe(false);
    });

    it('recomposes the moon when the frame changes shape, and ignores a degenerate one', () => {
        const { world } = makeWorld('Minimal');
        const wide = world.light.moonDirection.clone();
        const viewport = world.light.u.viewport.value;
        expect(viewport.toArray()).toEqual([1600, 900]);
        world.setViewport(430, 932, 430 / 932);
        expect(viewport.toArray()).toEqual([430, 932]);
        expect(world.light.moonDirection.distanceTo(wide)).toBeGreaterThan(0.01);
        expect(world.light.moonDirection.length()).toBeCloseTo(1, 9);
        expect(world.light.moonDirection.y).toBeGreaterThan(0);
        expect(world.light.u.moonDir.value.distanceTo(world.light.moonDirection)).toBeCloseTo(0, 9);
        const rounded = world.light.moonDirection.toArray().map((v) => Math.round(v * 1000) / 1000);
        expect(world.getState().moon).toEqual(rounded);
        const tall = world.light.moonDirection.clone();
        world.setViewport(0, 0, NaN);
        world.setViewport(-5, 100, -2);
        expect(viewport.toArray()).toEqual([430, 932]);
        expect(world.aspect).toBeCloseTo(430 / 932, 12);
        expect(world.light.moonDirection.distanceTo(tall)).toBe(0);
        // The layout call may carry the aspect too.
        world.setLayout(null, 16 / 9);
        expect(world.aspect).toBeCloseTo(16 / 9, 12);
        expect(world.light.moonDirection.distanceTo(wide)).toBeCloseTo(0, 9);
        // With no board on screen the fallback follows the frame's shape.
        expect(world.layout.boards[0]).toEqual(fallbackLayout((16 / 9) * 1000, 1000).boards[0]);
    });

    it('lays the moon\'s image on the water left of the card in a wide frame, below it on an upright phone', () => {
        const mirrored = (width, height) => {
            const { world } = makeWorld('Minimal', { width, height });
            // The ray that mirrors to the moon: where on the water the eye sees its disc.
            const cam = world.restCamera();
            const moon = world.light.moonDirection;
            const t = cam.position.y / moon.y;
            const point = new THREE.Vector3(cam.position.x + moon.x * t, 0, cam.position.z + moon.z * t).project(cam);
            return { x: point.x * 0.5 + 0.5, y: 0.5 - point.y * 0.5, card: world.layout.cards[0] };
        };
        const wide = mirrored(1600, 900);
        expect(wide.x).toBeGreaterThan(0.05);
        expect(wide.x).toBeLessThan(wide.card.x0);
        expect(wide.y).toBeGreaterThan(0.2);
        expect(wide.y).toBeLessThan(0.8);
        const tall = mirrored(430, 932);
        // (Above the card a tall screen shows only the far bank: the open water is at its foot.)
        expect(tall.x).toBeCloseTo(0.5, 1);
        expect(tall.y).toBeGreaterThan(tall.card.y1);
        expect(tall.y).toBeLessThan(1);
    });
});

describe('koi pond plans: the garden', () => {
    const garden = planGarden();

    it('is the same garden every time, and another for another seed', () => {
        expect(planGarden()).toEqual(garden);
        expect(planGarden(5).rocks).not.toEqual(garden.rocks);
        expect(garden.rocks.length).toBeGreaterThan(20);
        for (const rock of garden.rocks) {
            for (const key of ['x', 'y', 'z', 'radius', 'squash', 'turn', 'tone', 'moss']) {
                expect(Number.isFinite(rock[key]), key).toBe(true);
            }
            expect(rock.radius).toBeGreaterThan(0.1);
            expect(rock.radius).toBeLessThan(1.2);
            expect([0, 1, 2]).toContain(rock.shape);
        }
    });

    it('stands its standing rocks in the water, each one drawn where the koi are told it is', () => {
        expect(garden.standing.length).toBeGreaterThanOrEqual(4);
        const ashore = [];
        for (const rock of garden.standing) {
            const where = `(${rock.x}, ${rock.z})`;
            const depth = waterDepth(rock.x, rock.z);
            // "Stones standing in the water: the koi go round them, the rings break on them."
            const inland = (-shoreDistance(rock.x, rock.z)).toFixed(2);
            if (!(depth > 0)) ashore.push(`the standing rock at ${where} is ${inland} m up the bank`);
            expect(inRectangle(rock.x, rock.z), where).toBe(true);
            expect(Math.abs(rock.x), `${where} is under the card`).toBeGreaterThan(1.75);
            // The stone that is drawn: at the same place, a little wider than the koi's idea of it, above the water.
            const drawn = garden.rocks.find((r) => r.x === rock.x && r.z === rock.z);
            expect(drawn, where).toBeTruthy();
            expect(rock.radius, where).toBeLessThanOrEqual(drawn.radius);
            expect(rock.radius, where).toBeGreaterThan(drawn.radius * 0.8);
            expect(drawn.y + drawn.radius * drawn.squash, where).toBeGreaterThan(0.02);
        }
        expect(ashore).toEqual([]);
    });

    it('stands the lantern on the right bank by the water, its flame above its foot', () => {
        const { lantern } = garden;
        expect(lantern.x).toBe(LANTERN_AT.x);
        expect(lantern.x).toBeGreaterThan(2); // right of the card
        expect(shoreDistance(lantern.x, lantern.z)).toBeLessThan(0); // on the bank...
        expect(shoreDistance(lantern.x, lantern.z)).toBeGreaterThan(-2); // ...by the water
        expect(waterDepth(lantern.x, lantern.z)).toBe(0);
        expect(groundHeight(lantern.x, lantern.z)).toBeGreaterThan(0);
        expect(lantern.y).toBeCloseTo(groundHeight(lantern.x, lantern.z), 0);
        expect(lantern.flame[0]).toBe(lantern.x);
        expect(lantern.flame[2]).toBe(lantern.z);
        expect(lantern.flame[1]).toBeGreaterThan(lantern.y + 0.3);
        expect(lantern.flame[1]).toBeLessThan(lantern.y + 1.5);
        // It may stand on a stone of its own; no other stone of the waterline stands in it.
        for (const rock of garden.rocks) {
            if (rock.x === lantern.x && rock.z === lantern.z) continue;
            const where = `rock at (${rock.x.toFixed(2)}, ${rock.z.toFixed(2)})`;
            expect(Math.hypot(rock.x - lantern.x, rock.z - lantern.z), where).toBeGreaterThan(0.25);
        }
    });

    it('plants the iris where the bank meets the water', () => {
        expect(garden.iris.length).toBeGreaterThan(8);
        for (const clump of garden.iris) {
            const where = `iris at (${clump.x.toFixed(2)}, ${clump.z.toFixed(2)})`;
            expect(Math.abs(shoreDistance(clump.x, clump.z)), where).toBeLessThan(0.5);
            expect(clump.y, where).toBeGreaterThanOrEqual(-0.08);
            expect(clump.y, where).toBeGreaterThanOrEqual(groundHeight(clump.x, clump.z) - 1e-9);
            expect(clump.blades, where).toBeGreaterThanOrEqual(5);
            expect(clump.height, where).toBeGreaterThan(0.3);
            expect(Math.abs(clump.x - garden.lantern.x), where).toBeGreaterThan(0.5);
        }
    });

    it.each(QUALITY_NAMES)('grows the maples of the %s tier inside its leaf budget, over bank and pond', (name) => {
        const budget = QUALITY[name].leaves;
        const grown = growMaples(budget);
        // Thinned evenly to the budget: never over it, and all but a leaf or two of it.
        expect(grown.count).toBeLessThanOrEqual(budget);
        expect(grown.count).toBeGreaterThanOrEqual(budget - 2);
        expect(grown.grown).toBeGreaterThanOrEqual(budget); // there is more tree than any tier draws
        expect(grown.leaves).toBeInstanceOf(Float32Array);
        expect(grown.leaves).toHaveLength(grown.count * 8);
        const bands = [0, 0];
        for (let i = 0; i < grown.count; i++) {
            const [x, y, z, size, , , , tone] = grown.leaves.subarray(i * 8, i * 8 + 8);
            for (let k = 0; k < 8; k++) expect(Number.isFinite(grown.leaves[i * 8 + k])).toBe(true);
            expect(y).toBeGreaterThan(0.8); // in the boughs, well clear of the water
            expect(y).toBeLessThan(4);
            expect(Math.abs(x)).toBeLessThan(12);
            expect(z).toBeLessThan(2);
            expect(z).toBeGreaterThan(-6);
            expect(size).toBeGreaterThan(0.05);
            expect(size).toBeLessThan(0.3);
            expect(tone).toBeGreaterThanOrEqual(0);
            expect(tone).toBeLessThan(2);
            bands[Math.floor(tone)] += 1;
            // The old maple leans out over the left reach, the young one stands behind the lantern.
            expect(Math.floor(tone) === 0 ? x < 0 : x > 0).toBe(true);
        }
        expect(bands[0]).toBeGreaterThan(bands[1]);
        expect(bands[1]).toBeGreaterThan(grown.count * 0.1);
        // The wood: one indexed mesh of tubes.
        expect(grown.wood.positions.length).toBe(grown.wood.normals.length);
        expect(grown.wood.positions.length % 3).toBe(0);
        expect(grown.wood.indices.length % 3).toBe(0);
        expect(Math.max(...grown.wood.indices)).toBeLessThan(grown.wood.positions.length / 3);
        expect(grown.wood.positions.every((value) => Number.isFinite(value))).toBe(true);
        // The same tree every time; the wood does not depend on the leaf budget.
        const again = growMaples(budget);
        expect(Buffer.from(again.leaves.buffer).equals(Buffer.from(grown.leaves.buffer))).toBe(true);
        expect(growMaples(100).wood.positions).toEqual(grown.wood.positions);
    });
});

describe('koi pond plans: what floats', () => {
    const { standing } = planGarden();

    it.each(QUALITY_NAMES)('lays the pads of the %s tier in water, off the rocks, the card and each other', (name) => {
        const tier = QUALITY[name];
        const flora = planFlora({ pads: tier.pads, lotus: tier.lotus, rocks: standing });
        // About the budget (each raft takes its share of it, rounded).
        expect(Math.abs(flora.pads.length - tier.pads)).toBeLessThanOrEqual(2);
        const faults = [];
        flora.pads.forEach((pad, i) => {
            const where = `pad ${i} at (${pad.x.toFixed(2)}, ${pad.z.toFixed(2)}) r ${pad.radius.toFixed(2)}`;
            expect(pad.radius, where).toBeGreaterThanOrEqual(0.2);
            expect(pad.radius, where).toBeLessThanOrEqual(0.5);
            if (!(waterDepth(pad.x, pad.z) > 0.1)) faults.push(`${where}: its middle is not in water`);
            for (let k = 0; k < 12; k++) {
                const a = (k / 12) * Math.PI * 2;
                if (!(waterDepth(pad.x + Math.cos(a) * pad.radius, pad.z + Math.sin(a) * pad.radius) > 0)) {
                    faults.push(`${where}: its rim lies on the bank`);
                    break;
                }
            }
            // The strip the card floats over, and the koi rise through, stays open water.
            if (Math.abs(pad.x) - pad.radius < 1.75 - 1e-9) faults.push(`${where}: in the card's strip`);
            if (!inRectangle(pad.x, pad.z)) faults.push(`${where}: off the simulated water`);
            for (const rock of standing) {
                const apart = Math.hypot(rock.x - pad.x, rock.z - pad.z);
                if (apart < rock.radius + pad.radius * 0.8 - 1e-9) {
                    faults.push(`${where}: on the rock at (${rock.x}, ${rock.z})`);
                }
            }
            for (let j = 0; j < i; j++) {
                const other = flora.pads[j];
                const apart = Math.hypot(other.x - pad.x, other.z - pad.z);
                if (apart < (other.radius + pad.radius) * 0.9 - 1e-9) faults.push(`${where}: over pad ${j}`);
            }
        });
        expect(faults).toEqual([]);
        // Rafts in both reaches.
        expect(flora.pads.filter((pad) => pad.x < 0).length).toBeGreaterThan(flora.pads.length * 0.25);
        expect(flora.pads.filter((pad) => pad.x > 0).length).toBeGreaterThan(flora.pads.length * 0.25);

        // The lilies stand among the pads: as many as the tier has, apart, in water, clear of the card.
        expect(flora.lilies.length).toBeGreaterThan(0);
        expect(flora.lilies.length).toBeLessThanOrEqual(tier.lotus);
        flora.lilies.forEach((lily, i) => {
            const where = `lily ${i} at (${lily.x.toFixed(2)}, ${lily.z.toFixed(2)})`;
            expect(waterDepth(lily.x, lily.z), where).toBeGreaterThan(0.14);
            expect(Math.abs(lily.x), where).toBeGreaterThan(2);
            const onAPad = flora.pads.some((pad) => Math.hypot(pad.x - lily.x, pad.z - lily.z) < pad.radius + 1e-6);
            expect(onAPad, where).toBe(true);
            for (let j = 0; j < i; j++) {
                const other = flora.lilies[j];
                expect(Math.hypot(other.x - lily.x, other.z - lily.z), where).toBeGreaterThanOrEqual(1.15);
            }
            expect(lily.scale, where).toBeGreaterThan(0.2);
        });
        // The same plan every time; another for another seed.
        expect(planFlora({ pads: tier.pads, lotus: tier.lotus, rocks: standing })).toEqual(flora);
        expect(planFlora({
            pads: tier.pads, lotus: tier.lotus, rocks: standing, seed: 8,
        }).pads).not.toEqual(flora.pads);
    });

    it('bakes a tileable field of pebbles: colour with height, relief with the gaps, the same every time', () => {
        const size = 64;
        const baked = bakePebbles(size);
        expect(baked.size).toBe(size);
        expect(baked.colour).toBeInstanceOf(Uint8Array);
        expect(baked.colour).toHaveLength(size * size * 4);
        expect(baked.relief).toHaveLength(size * size * 4);
        const again = bakePebbles(size);
        expect(Buffer.from(again.colour).equals(Buffer.from(baked.colour))).toBe(true);
        expect(Buffer.from(again.relief).equals(Buffer.from(baked.relief))).toBe(true);
        expect(Buffer.from(bakePebbles(size, 9).colour).equals(Buffer.from(baked.colour))).toBe(false);
        // Stones and the gaps between them: the height (alpha) runs from the bed to a dome.
        let low = 255;
        let high = 0;
        let tilt = 0;
        for (let i = 0; i < size * size; i++) {
            low = Math.min(low, baked.colour[i * 4 + 3]);
            high = Math.max(high, baked.colour[i * 4 + 3]);
            expect(baked.relief[i * 4 + 3]).toBe(255);
            tilt += baked.relief[i * 4] + baked.relief[i * 4 + 1];
        }
        expect(low).toBeLessThan(20);
        expect(high).toBeGreaterThan(150);
        // The normals lean every way and so average flat (0.5 = flat).
        expect(tilt / (size * size * 2) / 255).toBeCloseTo(0.5, 1);
        // It tiles: across the wrap the height steps no more than it does between neighbours anywhere.
        const height = (i, j) => baked.colour[(((j + size) % size) * size + ((i + size) % size)) * 4 + 3];
        let seam = 0;
        let inside = 0;
        for (let k = 0; k < size; k++) {
            seam = Math.max(seam, Math.abs(height(0, k) - height(-1, k)), Math.abs(height(k, 0) - height(k, -1)));
            for (let i = 1; i < size; i++) {
                const across = Math.abs(height(i, k) - height(i - 1, k));
                inside = Math.max(inside, across, Math.abs(height(k, i) - height(k, i - 1)));
            }
        }
        expect(seam).toBeLessThanOrEqual(inside);
        // The sizes the tiers ask for are whole tiles.
        for (const name of QUALITY_NAMES) expect(((QUALITY[name].pebbles / 1024) * 54) % 1).toBe(0);
    });
});

describe('koi pond tiers', () => {
    it('defines every quality tier for the world and the post', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(Object.isFrozen(QUALITY[name])).toBe(true);
            expect(tierFor(name)).toBe(QUALITY[name]);
            expect(POST_LOOK[name]).toBeTruthy();
        }
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
    });

    it('scales every budget monotonically with the tier, and keeps the whole picture and every event on each', () => {
        const keys = [
            'koi', 'shadows', 'pebbles', 'pads', 'lotus', 'leaves', 'floaters', 'fireflies', 'droplets',
            'mist', 'dragon',
        ];
        for (let i = 0; i < QUALITY_NAMES.length; i++) {
            const tier = QUALITY[QUALITY_NAMES[i]];
            for (const key of keys) expect(Number.isInteger(tier[key]), `${QUALITY_NAMES[i]}.${key}`).toBe(true);
            // Koi to leap, lilies to open, spray for the splash, a dragon for the chain.
            for (const key of ['koi', 'pads', 'lotus', 'leaves', 'droplets', 'dragon']) {
                expect(tier[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThan(0);
            }
            expect(tier.koi, QUALITY_NAMES[i]).toBeGreaterThanOrEqual(8); // six go over the water at once
            if (i === 0) continue;
            const below = QUALITY[QUALITY_NAMES[i - 1]];
            for (const key of keys) expect(tier[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(below[key]);
            for (const key of ['sim', 'derive']) {
                expect(tier[key][0], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(below[key][0]);
                expect(tier[key][1], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(below[key][1]);
            }
            for (const key of ['prism', 'refraction']) {
                expect(Number(tier[key]), `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(Number(below[key]));
            }
            const look = POST_LOOK[QUALITY_NAMES[i]];
            const lookBelow = POST_LOOK[QUALITY_NAMES[i - 1]];
            expect(Number(look.bloom)).toBeGreaterThanOrEqual(Number(lookBelow.bloom));
            expect(look.bloomResolution).toBeGreaterThanOrEqual(lookBelow.bloomResolution);
        }
    });

    it.each(QUALITY_NAMES)('simulates the %s tier\'s waves on square cells, stably, a wake for every koi', (name) => {
        const tier = QUALITY[name];
        const [w, h] = tier.sim;
        // Square cells: the grid has the pond's own proportions, to within a texel.
        expect(Math.abs(w * (POND_LENGTH / POND_WIDTH) - h)).toBeLessThanOrEqual(1);
        expect(Math.abs(tier.derive[0] * (POND_LENGTH / POND_WIDTH) - tier.derive[1])).toBeLessThanOrEqual(1);
        expect(tier.derive[0]).toBeGreaterThanOrEqual(w);
        // The discrete wave equation's stiffness, 2 (c dt / dx)^2, must stay below 1.
        const cell = POND_WIDTH / w;
        expect(2 * ((WAVE_SPEED * SIM_STEP) / cell) ** 2).toBeLessThan(1);
        expect(2 * ((WAVE_SPEED * SIM_STEP) / (POND_LENGTH / h)) ** 2).toBeLessThan(1);
        expect(SIM_STEP).toBe(1 / 60);

        // The surface itself (no renderer is needed to build it, only to step it).
        const light = new PondLight({ tier });
        const surface = new PondSurface({ light, tier, rocks: planGarden().standing });
        expect(surface.simSize).toEqual([w, h]);
        expect(surface.cell).toBeCloseTo(cell, 12);
        expect(surface.targets.map((target) => [target.width, target.height])).toEqual([[w, h], [w, h]]);
        expect([surface.output.width, surface.output.height]).toEqual(tier.derive);
        // A wake for every koi, and room beside them for the dragon's back.
        expect(surface.wakeSlots).toBeGreaterThanOrEqual(tier.koi + WAKE_EXTRA);
        expect(WAKE_STRIDE).toBe(6);
        expect(light.surface.value).toBe(surface.output.texture); // every material reads the one texture
        surface.dispose();
        light.dispose();
    });

    it('steps the surface between its two targets with the renderer it is handed, and keeps its slots fixed', () => {
        const tier = QUALITY.Minimal;
        const light = new PondLight({ tier });
        const surface = new PondSurface({ light, tier });
        const drawn = [];
        let target = 'canvas';
        const renderer = {
            getRenderTarget: () => target,
            setRenderTarget: (next) => { target = next; },
            getClearColor: (colour) => colour,
            getClearAlpha: () => 1,
            setClearColor: vi.fn(),
            clear: vi.fn(),
            render: (object) => drawn.push([object, target]),
        };
        surface.reset(renderer, 5);
        expect(renderer.clear).toHaveBeenCalledTimes(2); // both height fields start flat
        expect(target).toBe('canvas'); // and the renderer is handed back as it came
        expect(surface.simTime).toBe(5);
        // Plungers and wakes go round fixed slots.
        for (let i = 0; i < PLUNGER_SLOTS + 3; i++) surface.plunge(i * 0.1, 0, { amp: 0.02 });
        expect(surface.plungers).toHaveLength(PLUNGER_SLOTS);
        expect(surface.plungers[2].x).toBeCloseTo((PLUNGER_SLOTS + 2) * 0.1, 12);
        const wakes = new Float32Array((surface.wakeSlots + 4) * WAKE_STRIDE).fill(0.5);
        expect(() => surface.setWakes(wakes, surface.wakeSlots + 4)).not.toThrow();
        expect(surface.wakeData).toHaveLength(surface.wakeSlots);
        // One step: source one target, draw the other, swap, advance the clock by a sixtieth.
        surface.stepOnce(renderer);
        expect(drawn).toEqual([[surface.stepQuad, surface.targets[1]]]);
        expect(surface.read).toBe(1);
        expect(surface.steps).toBe(1);
        expect(surface.simTime).toBeCloseTo(5 + SIM_STEP, 12);
        surface.stepOnce(renderer);
        expect(drawn[1]).toEqual([surface.stepQuad, surface.targets[0]]);
        surface.derive(renderer, 5.5);
        expect(drawn[2]).toEqual([surface.deriveQuad, surface.output]);
        expect(surface.u.time.value).toBe(5.5);
        // update(): whole steps only, the remainder carried, the renderer handed back.
        target = 'canvas';
        drawn.length = 0;
        surface.update(renderer, 2.5 * SIM_STEP, 6);
        expect(drawn.filter(([object]) => object === surface.stepQuad)).toHaveLength(2);
        expect(surface.accumulator).toBeCloseTo(0.5 * SIM_STEP, 9);
        expect(target).toBe('canvas');
        const owned = [
            ...surface.targets, surface.output, surface.maskTexture, surface.stepMaterial, surface.deriveMaterial,
        ];
        const disposals = owned.map((resource) => vi.spyOn(resource, 'dispose'));
        surface.dispose();
        surface.dispose();
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(() => surface.update(renderer, 1, 7)).not.toThrow(); // a late frame after retirement
        light.dispose();
    });

    it('masks the waves off the bank and out of the standing rocks', () => {
        const [w, h] = [110, 66];
        const rocks = planGarden().standing;
        const mask = bakeWaterMask(w, h, rocks);
        expect(mask).toHaveLength(w * h * 4);
        const column = (x) => Math.floor(((x - POND.minX) / POND_WIDTH) * w);
        const texel = (x, z) => Math.floor(((z - POND.minZ) / POND_LENGTH) * h) * w + column(x);
        const at = (x, z) => mask[texel(x, z) * 4];
        expect(at(4, 0.5)).toBe(255); // open water in the right reach
        expect(at(0, 0.4)).toBe(255); // the basin
        expect(at(0, -6)).toBe(0); // the far bank
        expect(at(-10.5, -3)).toBe(0); // the left horn of the cove
        for (const rock of rocks.filter((r) => waterDepth(r.x, r.z) > 0)) {
            expect(at(rock.x, rock.z), `rock at (${rock.x}, ${rock.z})`).toBeLessThan(40);
        }
        // Without rocks the same water is open where they stood.
        const open = bakeWaterMask(w, h);
        expect(open[texel(6.75, 1.25) * 4]).toBe(255);
        for (let i = 3; i < mask.length; i += 4) expect(mask[i]).toBe(255);
    });
});
