/**
 * Grainfields — the world's choreography, run without a renderer: the land prepared once (and the
 * trees' authored assets served from disk), a scene, a camera, and the world driven in fixed steps
 * (camera, then events, then the frame, as the theme does). One world serves most of the file:
 * each test seeks it back to the same start.
 *
 * The look is still being tuned, so the gameplay beats are held as relations (a chain lowers the
 * deck's cover, four lines tear it over the gate, a perfect clear stills the wind), not as numbers.
 * The model is tests/unit/high-coast-world.test.js.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadGrainfieldsAssets } from '../../src/themes/grainfields/grainfields-assets.js';
import {
    GRAINFIELDS_PARTS, GrainfieldsWorld, REST_RIG, fovForAspect,
} from '../../src/themes/grainfields/grainfields-world.js';
import {
    DECK, DEG, EYE, PIECE_COLORS, PLACES, TIMING, hexToLinear,
} from '../../src/themes/grainfields/grainfields-core.js';
import { HOURS } from '../../src/themes/grainfields/grainfields-hours.js';
import { deckThreshold } from '../../src/themes/grainfields/grainfields-tsl.js';
import { PULSE } from '../../src/themes/grainfields/grainfields-reactions.js';

vi.setConfig({ testTimeout: 60_000 });

const START = 10;
const QUALITY = 'Minimal';
const HAS_HERD = GRAINFIELDS_PARTS.includes('herd');
/** The land, prepared once (no assets), and the trees' assets. */
let land;
let assets;
/** The world most tests share (seeked back to START by each). */
let shared;

/** The trees' authored assets, served from disk (and a tiny sprite sheet in place of the PNG). */
async function diskAssets() {
    const directory = new URL('../../src/themes/grainfields/assets/', import.meta.url);
    const loader = {
        loadAsync: async (url) => {
            const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
            const bytes = readFileSync(new URL(name, directory));
            return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
        },
    };
    const textureLoader = { loadAsync: async () => new THREE.DataTexture(new Uint8Array(16), 2, 2) };
    return loadGrainfieldsAssets({ loader, textureLoader });
}

const sim = (time, delta, pointerX = 0, pointerY = 0) => ({
    time, delta, pointerX, pointerY,
});

function makeWorld({ withAssets = true } = {}) {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new GrainfieldsWorld({
        scene, quality: QUALITY, capture: true, prepared: { ...land, assets: withAssets ? assets : null },
    });
    const built = world.build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
    return {
        scene, camera, world, built,
    };
}

/** Seek a world to `time` and draw that frame, as a capture does. */
function begin({ world, camera }, time = START) {
    world.seek(time);
    world.updateCamera(camera, sim(time, 0));
    world.update(sim(time, 0), camera);
}

/** Run the world from its current time to `to` in steps of dt, as the theme's frames do. */
function stepTo({ world, camera }, to, dt = 1 / 30) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const time = from + i * h;
        world.updateCamera(camera, sim(time, 0));
        world.update(sim(time, h), camera);
    }
}

/** Every value the materials read, flattened (the tables included). */
function uniformValues(world) {
    const out = [];
    for (const [key, node] of Object.entries(world.u)) {
        if (key === 'tables' || !node || !('value' in node)) continue;
        const { value } = node;
        if (typeof value === 'number') out.push([key, value]);
        else if (value?.toArray) value.toArray().forEach((v, i) => out.push([`${key}.${i}`, v]));
    }
    for (const [name, rows] of Object.entries(world.u.tables)) {
        rows.forEach((row, r) => row.toArray().forEach((v, i) => out.push([`${name}[${r}].${i}`, v])));
    }
    return out;
}

const objectCount = (root) => {
    let n = 0;
    root.traverse(() => { n += 1; });
    return n;
};

/** The event motes' ring: where each was thrown from (x, y, z, start time). */
const dust = (world) => world.parts.motes.meshes[1].geometry.attributes.aFrom.array;
const thrownAt = (world, time) => {
    const from = dust(world);
    let n = 0;
    for (let i = 3; i < from.length; i += 4) if (from[i] >= time - 1e-6 && from[i] < time + 1) n += 1;
    return n;
};

/** A session with something of everything in it, from the world's current time. */
function play(w) {
    const { world } = w;
    const t = world.time;
    world.onLock({ u: 0.2, rows: [18], color: PIECE_COLORS[0] });
    world.onClear({ lines: 2, combo: 1, rowCodes: Array.from({ length: 20 }, (_, i) => i % 7) });
    stepTo(w, t + 1);
    world.levelUp(2);
    for (let n = 2; n <= 5; n++) {
        world.onLock({
            u: n / 7, rows: [19], color: PIECE_COLORS[n % 7], hardDrop: n === 3, distance: 12,
        });
        world.onClear({ lines: 1, combo: n, tspin: n === 4 });
        world.onCombo(n);
        stepTo(w, world.time + 0.8);
    }
    world.onLock({ u: 0.7, rows: [19, 18, 17, 16], color: PIECE_COLORS[3] });
    world.onClear({ lines: 4, combo: 1 });
    world.onCombo(0);
    world.onB2B(2);
    stepTo(w, world.time + 2);
    world.onClear({ lines: 1, perfect: true });
    stepTo(w, world.time + 1.5);
}

beforeAll(async () => {
    land = GrainfieldsWorld.prepareSync(QUALITY);
    assets = await diskAssets();
    shared = makeWorld();
    begin(shared);
});

afterAll(() => {
    shared?.world.dispose();
    vi.restoreAllMocks();
});

describe('GrainfieldsWorld build', () => {
    it('builds every named part into one root in the scene, the trees with their assets, and hands itself back', () => {
        const { world, scene, built } = shared;
        expect(built).toBe(world);
        expect(Object.keys(world.parts).sort()).toEqual([...GRAINFIELDS_PARTS].sort());
        expect(world.root.parent).toBe(scene);
        for (const name of GRAINFIELDS_PARTS) {
            const part = world.parts[name];
            const meshes = part.meshes || [part.mesh];
            expect(meshes.length, name).toBeGreaterThan(0);
            for (const mesh of meshes) expect(mesh.parent, name).toBe(world.root);
        }
        expect(world.getState()).toMatchObject({ quality: QUALITY, parts: expect.arrayContaining([...GRAINFIELDS_PARTS]) });
        expect(world.getState().sceneChildren).toBe(world.root.children.length);
        // The path the shaders read is written once, from the plan.
        expect(world.u.tables.path[0].z).toBe(0);
        expect(world.u.tables.path[world.u.tables.path.length - 1].z).toBeCloseTo(1, 9);
    });

    it('builds every part but the trees and the herd without their assets (the belts stand as the land\'s canopy)', () => {
        const bare = makeWorld({ withAssets: false });
        try {
            const authored = new Set(['trees', 'herd']);
            expect(Object.keys(bare.world.parts).sort()).toEqual(GRAINFIELDS_PARTS.filter((name) => !authored.has(name)).sort());
            expect(bare.world.parts.trees).toBeUndefined();
            expect(bare.world.parts.herd).toBeUndefined();
            begin(bare);
            stepTo(bare, START + 0.5);
            expect(bare.world.getState().parts).not.toContain('trees');
        } finally {
            bare.world.dispose();
        }
    });

    it('draws everything with node materials (both renderer backends)', () => {
        const plain = [];
        let materials = 0;
        shared.world.root.traverse((object) => {
            if (!object.material) return;
            (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => {
                materials += 1;
                if (!material.isNodeMaterial) plain.push(`${object.name || object.type}: ${material.type}`);
            });
        });
        expect(plain).toEqual([]);
        expect(materials).toBeGreaterThanOrEqual(GRAINFIELDS_PARTS.length);
    });

    it('shows only the parts a capture asks for, and all of them again', () => {
        const { world } = shared;
        const meshesOf = (name) => world.parts[name].meshes || [world.parts[name].mesh];
        world.showOnlyParts(['sky', 'land']);
        for (const name of GRAINFIELDS_PARTS) {
            for (const mesh of meshesOf(name)) expect(mesh.visible, name).toBe(name === 'sky' || name === 'land');
        }
        world.showOnlyParts(GRAINFIELDS_PARTS);
        for (const name of GRAINFIELDS_PARTS) {
            for (const mesh of meshesOf(name)) expect(mesh.visible, name).toBe(true);
        }
    });

    it('stands the camera at the eye on the rig for its aspect, looking out level and a touch up; reduced motion holds it still', () => {
        const { world, camera } = shared;
        begin(shared);
        world.updateCamera(camera, sim(20, 0));
        expect(camera.position.toArray()).toEqual([EYE.x, EYE.y, EYE.z]);
        expect(camera.fov).toBe(fovForAspect(16 / 9));
        const at = (t, px = 0) => {
            world.updateCamera(camera, sim(t, 0, px));
            return camera.quaternion.clone();
        };
        expect(at(20).angleTo(at(37))).toBeGreaterThan(1e-4); // the lens breathes
        expect(at(20).angleTo(at(20, 1))).toBeGreaterThan(1e-3); // the pointer leans it
        world.setReducedMotion(true);
        try {
            expect(at(20).angleTo(at(37))).toBeLessThan(1e-6);
            expect(at(20).angleTo(at(20, 1))).toBeLessThan(1e-6);
        } finally {
            world.setReducedMotion(false);
        }
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        expect(forward.y).toBeGreaterThan(-0.02);
        expect(forward.y).toBeLessThan(0.15);
        expect(forward.z).toBeLessThan(-0.9);
        begin(shared);
    });

    it('keeps the scene\'s object count stable through every kind of event and many frames', () => {
        const { world, scene } = shared;
        begin(shared);
        const before = {
            scene: scene.children.length, root: world.root.children.length, objects: objectCount(world.root),
        };
        play(shared);
        world.onGameOver();
        stepTo(shared, world.time + TIMING.dusk);
        world.onSessionStart();
        world.resetSession();
        stepTo(shared, world.time + 5, 1 / 15);
        expect({
            scene: scene.children.length, root: world.root.children.length, objects: objectCount(world.root),
        }).toEqual(before);
        expect(world.getState().sceneChildren).toBe(before.root);
    });
});

describe('GrainfieldsWorld: events reach the reactions and the counters', () => {
    it('tears a lock\'s gap, stands its beam and lifts the piece\'s dust; a hard drop rings the wind out', () => {
        const { world } = shared;
        begin(shared);
        const color = PIECE_COLORS[1];
        world.onLock({ u: 0.2, rows: [14], color });
        expect(world.counts).toMatchObject({ locks: 1, hardDrops: 0 });
        expect(world.reactions.gaps).toHaveLength(1);
        world.reactions.gaps[0].rgb.forEach((v, k) => expect(v).toBeCloseTo(hexToLinear(color)[k], 12));
        expect(world.reactions.gaps[0].at).toBe(START);
        expect(thrownAt(world, START)).toBeGreaterThan(0);
        stepTo(shared, START + TIMING.gapOpen);
        expect(world.u.gapCount.value).toBe(1);
        expect(world.parts.beams.count).toBe(1);
        expect(world.parts.beams.mesh.visible).toBe(true);
        world.onLock({
            u: 0.8, rows: [12], color: PIECE_COLORS[2], hardDrop: true, distance: 14,
        });
        expect(world.counts).toMatchObject({ locks: 2, hardDrops: 1 });
        expect(world.reactions.pulses.map((p) => p.kind)).toEqual([PULSE.ring]);
        expect(world.reactions.gaps[1].radius).toBeGreaterThan(world.reactions.gaps[0].radius);
        stepTo(shared, START + TIMING.gapOpen + 0.5);
        expect(world.u.pulseCount.value).toBe(1);
        // The gaps close in their time, and the beams with them.
        stepTo(shared, START + TIMING.gapOpen + TIMING.gapLife + 1, 0.25);
        expect(world.u.gapCount.value).toBe(0);
        expect(world.parts.beams.count).toBe(0);
    });

    it('blows a clear\'s lanes of wind, wheels a T-spin, tears four lines open over the gate and clears the sky on a perfect clear', () => {
        const { world } = shared;
        begin(shared);
        const wheel = HAS_HERD ? vi.spyOn(world.parts.herd, 'wheel') : null;
        try {
            world.onClear({ lines: 2, combo: 1 });
            expect(world.counts).toMatchObject({ clears: 1, lines: 2 });
            expect(world.reactions.trails).toHaveLength(1);
            expect(thrownAt(world, START)).toBeGreaterThan(0); // chaff where the lane starts
            world.onClear({ lines: 1, combo: 2, tspin: true });
            expect(world.counts).toMatchObject({ clears: 2, lines: 3, tspins: 1 });
            expect(world.reactions.pulses.map((p) => p.kind)).toEqual([PULSE.whirl]);
            if (wheel) expect(wheel).toHaveBeenCalledWith(START);
            // Four lines: two lanes, and the tear where the sun's ray to a point over the gate meets the deck.
            world.onClear({ lines: 4, combo: 3 });
            expect(world.counts).toMatchObject({ clears: 3, lines: 7, quads: 1 });
            expect(world.reactions.trails).toHaveLength(4);
            const { drift, sunDir } = world.deckState();
            const lift = (world.reactions.tearX - drift[0] - PLACES.gate.x) / sunDir[0];
            expect((world.reactions.tearZ - drift[1] - PLACES.gate.z) / sunDir[2]).toBeCloseTo(lift, 6);
            expect(lift).toBeGreaterThan(0);
            expect(lift * Math.max(0.035, sunDir[1])).toBeLessThan(DECK.base);
            stepTo(shared, START + TIMING.tearIn);
            expect(world.u.tear.value.w).toBeCloseTo(1, 6);
            expect(world.u.tear.value.x).toBe(world.reactions.tearX);
            expect(world.u.tear.value.y).toBe(world.reactions.tearZ);
            expect(world.u.flare.value).toBeGreaterThan(0.5);
            expect(world.getPostState().flash).toBeGreaterThan(0);
            stepTo(shared, START + TIMING.tearLife, 0.25);
            expect(world.u.tear.value.w).toBe(0);
            expect(world.u.flare.value).toBe(0);
            expect(world.getPostState().flash).toBe(0);
            // A perfect clear: the sky clears and the wind falls still, then both return.
            const windBefore = world.u.windStrength.value;
            world.onClear({ lines: 2, perfect: true });
            expect(world.counts.perfects).toBe(1);
            stepTo(shared, world.time + 3);
            expect(world.u.clearSky.value).toBeCloseTo(1, 6);
            expect(world.u.still.value).toBeCloseTo(1, 6);
            expect(world.u.windStrength.value).toBeLessThan(windBefore * 0.5);
            stepTo(shared, world.time + TIMING.clearHold + TIMING.clearReturn, 0.25);
            expect(world.u.clearSky.value).toBe(0);
        } finally {
            wheel?.mockRestore();
        }
    });

    it('breaks the storm open with a chain: counts each step, lowers the deck\'s cover, raises the wind, then lets it close', () => {
        const { world } = shared;
        begin(shared);
        const run = HAS_HERD ? vi.spyOn(world.parts.herd, 'run') : null;
        try {
            const cover0 = world.u.cover.value;
            const wind0 = world.u.windStrength.value;
            expect(cover0).toBeCloseTo(world.light.cover, 9); // no chain, no dusk: the hour's own
            world.onCombo(1);
            expect(world.counts.chainSteps).toBe(0);
            for (let n = 2; n <= 4; n++) world.onCombo(n);
            expect(world.counts.chainSteps).toBe(3);
            expect(world).toMatchObject({ combo: 4, peak: 4 });
            expect(world.reactions.combo).toBe(4);
            if (run) expect(run).toHaveBeenCalledTimes(1);
            stepTo(shared, START + TIMING.breakIn + 0.5);
            expect(world.u.breaking.value).toBeGreaterThan(0.3);
            expect(world.u.cover.value).toBeLessThan(world.light.cover - 0.1);
            expect(world.u.cover.value).toBeLessThan(cover0 - 0.1);
            expect(world.u.cover.value).toBeGreaterThanOrEqual(0.05);
            expect(world.u.deckLo.value.x).toBe(deckThreshold(world.u.cover.value));
            expect(world.u.windStrength.value).toBeGreaterThan(wind0);
            // The chain ends: the deck closes again over TIMING.breakOut; the peak is remembered.
            world.onCombo(0);
            expect(world).toMatchObject({ combo: 0, peak: 4 });
            stepTo(shared, world.time + TIMING.breakOut + 0.5, 0.25);
            expect(world.u.breaking.value).toBe(0);
            expect(world.u.cover.value).toBeCloseTo(world.light.cover, 9);
        } finally {
            run?.mockRestore();
        }
    });

    it('carries a back-to-back run to the reactions: wider beams and a stronger wind', () => {
        const { world } = shared;
        begin(shared);
        const wind0 = world.u.windStrength.value;
        world.onB2B(3);
        world.onB2B(1);
        expect(world.counts.b2bSteps).toBe(1);
        expect(world.b2b).toBe(1);
        world.onB2B(3);
        expect(world.counts.b2bSteps).toBe(2);
        expect(world.reactions.b2b).toBe(3);
        world.update(sim(START, 0), shared.camera);
        expect(world.u.windStrength.value).toBeGreaterThan(wind0);
        world.onLock({ u: 0.3, rows: [12] });
        world.onB2B(0);
        world.onLock({ u: 0.3, rows: [12] });
        expect(world.reactions.gaps[0].radius).toBeGreaterThan(world.reactions.gaps[1].radius);
    });

    it('steps the hour forward on a level-up, with a wave and a skein (a silent one lands at once and is not counted)', () => {
        const { world } = shared;
        begin(shared);
        expect(world.light.place).toBeCloseTo(START / TIMING.hour, 9);
        expect(world.u.skein.value).toBeLessThan(0);
        world.levelUp(2);
        expect(world.counts.levelUps).toBe(1);
        expect(world.levelUpAt).toBe(START);
        expect(world.u.skein.value).toBe(START);
        expect(world.reactions.pulses.map((p) => p.kind)).toEqual([PULSE.wave]);
        stepTo(shared, START + TIMING.levelTurn + 0.2);
        expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(1, 9);
        expect(world.getState()).toMatchObject({ level: 2, hour: { from: 1, name: HOURS[1].name } });
        world.levelUp(3, { silent: true });
        expect(world.counts.levelUps).toBe(1);
        expect(world.u.skein.value).toBe(START);
        stepTo(shared, world.time + 0.1);
        expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(2, 9);
    });

    it('keeps the light through a new run, and the next level-up steps forward from it', () => {
        const { world } = shared;
        begin(shared);
        world.levelUp(2);
        world.levelUp(3);
        for (let n = 1; n <= 3; n++) world.onCombo(n);
        world.onB2B(2);
        stepTo(shared, START + TIMING.levelTurn + 0.2);
        const { place } = world.light;
        expect(place - world.time / TIMING.hour).toBeCloseTo(2, 9);
        world.resetSession();
        expect(world).toMatchObject({
            level: 1, combo: 0, peak: 0, b2b: 0,
        });
        expect(world.reactions).toMatchObject({ combo: 0, b2b: 0 });
        stepTo(shared, world.time + 1 / 30);
        expect(world.light.place).toBeCloseTo(place + 1 / 30 / TIMING.hour, 9);
        world.levelUp(2);
        stepTo(shared, world.time + TIMING.levelTurn + 0.2);
        expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(3, 9);
    });

    it('lets dusk fall at game over and brings the morning when the next session starts', () => {
        const { world } = shared;
        begin(shared);
        world.onSessionStart();
        expect(world.counts.mornings).toBe(0); // no dusk, no morning
        world.onGameOver();
        expect(world.counts.gameOvers).toBe(1);
        stepTo(shared, START + TIMING.dusk + 0.2);
        expect(world.dusk).toBeCloseTo(1, 6);
        expect(world.u.dusk.value).toBeCloseTo(1, 6);
        expect(world.getState().dusk).toBeCloseTo(1, 6);
        world.onSessionStart();
        expect(world.counts.mornings).toBe(1);
        stepTo(shared, world.time + TIMING.dawn + 0.2);
        expect(world.dusk).toBe(0);
        expect(world.u.dusk.value).toBe(0);
    });

    it('under reduced motion: no wave, no skein, no dust; the hour still turns, at once', () => {
        const { world } = shared;
        begin(shared);
        world.setReducedMotion(true);
        try {
            world.levelUp(2);
            expect(world.counts.levelUps).toBe(1);
            expect(world.reactions.pulses).toHaveLength(0);
            expect(world.u.skein.value).toBeLessThan(0);
            stepTo(shared, START + 0.1);
            expect(world.light.place - world.time / TIMING.hour).toBeCloseTo(1, 9);
            world.onLock({ u: 0.2, rows: [14] });
            world.onClear({ lines: 2, tspin: true });
            expect(world.reactions.gaps).toHaveLength(1);
            expect(thrownAt(world, world.time)).toBe(0);
        } finally {
            world.setReducedMotion(false);
        }
    });
});

describe('GrainfieldsWorld: the frame writes the uniforms', () => {
    it('writes the hour\'s light, the camera and the deck into the uniforms every frame', () => {
        const { world, camera } = shared;
        begin(shared);
        stepTo(shared, START + 3);
        const L = world.light;
        for (const key of ['sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade']) {
            expect(world.u[key].value.toArray(), key).toEqual(L[key]);
        }
        expect(world.u.sunDir.value.toArray()).toEqual(L.dir);
        for (const key of ['sunUp', 'day', 'hazeDensity', 'mistDensity', 'stars']) expect(world.u[key].value, key).toBe(L[key]);
        expect(world.u.time.value).toBe(world.time);
        // The camera.
        expect(world.u.eye.value.toArray()).toEqual(camera.position.toArray());
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        world.u.camFwd.value.toArray().forEach((v, k) => expect(v).toBeCloseTo(forward.getComponent(k), 9));
        expect(world.u.camRight.value.dot(world.u.camFwd.value)).toBeCloseTo(0, 9);
        expect(world.u.tanHalfFov.value).toBeCloseTo(Math.tan((camera.fov * DEG) / 2), 12);
        expect(world.u.pixelAngle.value).toBeCloseTo((2 * world.u.tanHalfFov.value) / 900, 12);
        // The deck drifts and the gusts run at constant speeds: closed forms of the clock.
        const d1 = world.u.drift.value.clone();
        const g1 = world.u.gust.value;
        stepTo(shared, 2 * world.time);
        expect(world.u.drift.value.x).toBeCloseTo(2 * d1.x, 6);
        expect(world.u.drift.value.y).toBeCloseTo(2 * d1.y, 6);
        expect(world.u.gust.value).toBeCloseTo(2 * g1, 6);
        expect(Math.hypot(d1.x, d1.y)).toBeGreaterThan(0);
        // The deck's cover and its thresholds; the sun's gap, the storm's core, the fells' shafts.
        expect(world.u.cover.value >= 0.05 && world.u.cover.value <= 0.97).toBe(true);
        expect(world.u.deckLo.value.toArray()).toEqual([deckThreshold(world.u.cover.value), deckThreshold(0.975)]);
        expect(world.u.sunGap.value.z).toBeGreaterThan(0);
        expect(world.u.sunGap.value.w).toBe(1);
        const core = world.u.stormCore.value;
        expect(core.w >= 0 && core.w <= 1).toBe(true);
        world.u.tables.rays.forEach((ray, k) => {
            expect(ray.toArray().every(Number.isFinite), `ray ${k}`).toBe(true);
            expect(ray.z, `ray ${k}`).toBeGreaterThan(0);
            expect(ray.w >= 0 && ray.w <= 1, `ray ${k}`).toBe(true);
        });
        // An hour override (a capture) pins the light.
        world.setCaptureOverrides({ hour: 1 });
        try {
            stepTo(shared, world.time + 1);
            expect(world.light.place).toBe(1);
            expect(world.getState().hour.name).toBe(HOURS[1].name);
        } finally {
            world.setCaptureOverrides({ hour: null });
        }
        begin(shared);
    });

    it('hands the post one object, every frame, with finite values', () => {
        const { world } = shared;
        begin(shared);
        const post = world.getPostState();
        world.onClear({ lines: 4, combo: 1 });
        world.onCombo(2);
        for (let k = 1; k <= 20; k++) {
            stepTo(shared, START + k / 10);
            expect(world.getPostState()).toBe(post);
        }
        for (const key of ['exposure', 'bloomBoost', 'air', 'flash', 'saturation']) {
            expect(Number.isFinite(post[key]), key).toBe(true);
        }
        expect(post.flashColour.every(Number.isFinite)).toBe(true);
        expect(post.exposure).toBeGreaterThan(0);
    });

    it('keeps every uniform finite over a long scripted session', () => {
        const { world } = shared;
        begin(shared, 0);
        const bad = [];
        let combo = 0;
        for (let frame = 1; frame <= 1500; frame++) {
            const t = frame / 15;
            if (frame % 22 === 0) {
                world.onLock({
                    u: (frame * 0.173) % 1,
                    rows: [19 - (frame % 20)],
                    color: PIECE_COLORS[frame % 8],
                    hardDrop: frame % 66 === 0,
                    distance: frame % 19,
                });
            }
            if (frame % 44 === 0) {
                const lines = 1 + (frame % 4);
                combo = frame % 440 < 330 ? combo + 1 : 0;
                world.onClear({ lines, combo: Math.max(1, combo), tspin: frame % 352 === 0 });
                world.onCombo(combo);
                world.onB2B(lines === 4 ? Math.min(4, world.b2b + 1) : 0);
            }
            if (frame === 700) world.onClear({ lines: 4, perfect: true });
            if (frame % 400 === 0) world.levelUp(world.level + 1);
            if (frame === 1100) world.onGameOver();
            if (frame === 1160) {
                world.onSessionStart();
                world.resetSession();
            }
            world.updateCamera(shared.camera, sim(t, 0, Math.sin(t), Math.cos(t * 0.7)));
            world.update(sim(t, 1 / 15), shared.camera);
            if (frame % 30 === 0) {
                for (const [key, v] of uniformValues(world)) {
                    if (!Number.isFinite(v)) bad.push(`${key} at ${t.toFixed(2)} s: ${v}`);
                }
            }
        }
        expect(bad.slice(0, 10)).toEqual([]);
        expect(world.counts.locks).toBeGreaterThan(50);
        expect(world.counts.gameOvers).toBe(1);
        begin(shared);
    });
});

describe('GrainfieldsWorld state', () => {
    /** What a capture would see: the session, every uniform and the post. */
    const read = ({ world }) => ({
        state: world.getState(),
        uniforms: uniformValues(world),
        post: structuredClone(world.getPostState()),
    });

    it('seeks: everything in flight is dropped, the light stands where the clock puts it', () => {
        const { world } = shared;
        begin(shared);
        play(shared);
        world.onGameOver();
        stepTo(shared, world.time + 1);
        expect(world.reactions.gaps.length).toBeGreaterThan(0);
        world.seek(START);
        expect([world.reactions.gaps, world.reactions.trails, world.reactions.pulses]).toEqual([[], [], []]);
        expect(world.reactions).toMatchObject({ combo: 0, b2b: 0 });
        expect(world).toMatchObject({
            time: START, level: 1, combo: 0, peak: 0, b2b: 0, dusk: 0, duskTarget: 0,
        });
        expect(Object.values(world.counts).every((n) => n === 0)).toBe(true);
        expect(world.wheel.place(START)).toBeCloseTo(START / TIMING.hour, 12);
        expect(world.u.skein.value).toBeLessThan(0);
        // The motes in flight are gone.
        const from = dust(world);
        for (let i = 3; i < from.length; i += 4) expect(from[i]).toBeLessThan(-1e5);
        world.updateCamera(shared.camera, sim(START, 0));
        world.update(sim(START, 0), shared.camera);
        expect([world.u.gapCount.value, world.u.trailCount.value, world.u.pulseCount.value]).toEqual([0, 0, 0]);
        expect([world.u.breaking.value, world.u.tear.value.w, world.u.flare.value, world.u.clearSky.value]).toEqual([0, 0, 0, 0]);
        expect(world.light.place).toBeCloseTo(START / TIMING.hour, 12);
        expect(world.u.dusk.value).toBe(0);
        // A nonsense time seeks to the start of the clock.
        world.seek(Number.NaN);
        expect(world.time).toBe(0);
        begin(shared);
    });

    it('seeks deterministically: a seek and the same events write the same uniforms and the same post', () => {
        begin(shared);
        play(shared);
        const first = read(shared);
        expect(first.state.counts).toMatchObject({
            locks: 6, hardDrops: 1, clears: 7, quads: 1, tspins: 1, perfects: 1, levelUps: 1, chainSteps: 4, b2bSteps: 1,
        });
        begin(shared);
        play(shared);
        expect(read(shared)).toEqual(first);
    });

    // BUG (grainfields-motes.js createMotes, with grainfields-world.js seek): the event motes draw
    // their places from a generator (`random`) and fill a ring (`next`) that live in createMotes'
    // closure; reset() only clears the ring's start times. So after a seek the same events throw
    // their dust elsewhere than a fresh world does (and than the last seek did): an in-page seek (a
    // playground contact sheet) never reproduces a frame of a lock's dust or a clear's chaff. High
    // Coast's world had the same trap. Fix, in the motes' reset(): `random = 0x9e3779b9; next = 0;`.
    it('makes a seeked world indistinguishable from a fresh one: the same events throw the same dust', () => {
        const fresh = makeWorld({ withAssets: false });
        try {
            for (const w of [fresh, shared]) {
                begin(w);
                play(w);
            }
            const a = Array.from(dust(shared.world));
            const b = Array.from(dust(fresh.world));
            expect(b.some((v, i) => i % 4 === 3 && v > 0)).toBe(true); // something was thrown up
            expect(a.filter((v, i) => !Object.is(v, b[i])).length).toBe(0);
        } finally {
            fresh.world.dispose();
            begin(shared);
        }
    });

    it('round-trips a session through export and import (structured-clone equal)', () => {
        begin(shared);
        play(shared);
        const snapshot = structuredClone(shared.world.exportSessionState());
        expect(snapshot).toEqual(shared.world.exportSessionState());
        const other = makeWorld({ withAssets: false });
        try {
            begin(other, shared.world.time);
            other.world.importSessionState(snapshot);
            expect(structuredClone(other.world.exportSessionState())).toEqual(snapshot);
            expect(other.world.counts).toEqual(shared.world.counts);
            expect(other.world).toMatchObject({
                level: shared.world.level, combo: shared.world.combo, peak: shared.world.peak, b2b: shared.world.b2b,
            });
            for (const t of [shared.world.time, shared.world.time + 3, shared.world.time + 250]) {
                expect(other.world.wheel.place(t), `t = ${t}`).toBeCloseTo(shared.world.wheel.place(t), 12);
            }
            // A snapshot of another shape, or none, changes nothing.
            other.world.importSessionState({ record: [] });
            other.world.importSessionState(null);
            other.world.importSessionState(undefined);
            expect(structuredClone(other.world.exportSessionState())).toEqual(snapshot);
        } finally {
            other.world.dispose();
        }
    });

    it('keeps the light in its place through a rebuild in place (export, a new world, import), mid-turn and in a dusk', () => {
        const { world } = shared;
        begin(shared);
        play(shared);
        world.levelUp(4);
        stepTo(shared, world.time + TIMING.levelTurn * 0.4); // mid-turn
        world.onGameOver();
        stepTo(shared, world.time + TIMING.dusk * 0.5); // mid-dusk
        const snapshot = structuredClone(world.exportSessionState());
        const rebuilt = makeWorld({ withAssets: false });
        try {
            // As the theme's createScene does: the new world seeks to the clock, takes the level up
            // again silently, then the snapshot.
            rebuilt.world.seek(world.time);
            rebuilt.world.levelUp(world.level, { silent: true });
            rebuilt.world.importSessionState(snapshot);
            const lightKeys = ['sun', 'fill', 'zenith', 'horizon', 'glow', 'haze', 'cloudLit', 'sunDir', 'dusk', 'day', 'sunUp', 'stars'];
            for (const dt of [1 / 30, 1, TIMING.levelTurn, TIMING.dusk, 60]) {
                const t = world.time + dt;
                for (const w of [shared, rebuilt]) {
                    w.world.updateCamera(w.camera, sim(t, 0));
                    w.world.update(sim(t, 1 / 30), w.camera);
                }
                expect(rebuilt.world.light.place, `+${dt} s`).toBeCloseTo(world.light.place, 9);
                for (const key of lightKeys) {
                    const a = world.u[key].value;
                    const b = rebuilt.world.u[key].value;
                    expect(typeof b === 'number' ? b : b.toArray(), `${key} +${dt} s`).toEqual(typeof a === 'number' ? a : a.toArray());
                }
                const { cover: coverA, ...hourA } = world.getState().hour;
                const { cover: coverB, ...hourB } = rebuilt.world.getState().hour;
                expect(hourB, `+${dt} s`).toEqual(hourA);
                expect(Number.isFinite(coverA) && Number.isFinite(coverB)).toBe(true);
            }
            expect(rebuilt.world.level).toBe(world.level);
            expect(rebuilt.world.counts).toEqual(world.counts);
        } finally {
            rebuilt.world.dispose();
            begin(shared);
        }
    });

    // BUG (grainfields-world.js, SNAPSHOT / importSessionState): a rebuild in place carries the
    // world's `combo` and `b2b` scalars but not the reactions that draw them (reactions.combo, its
    // break's breakFrom/breakTo/breakAt, reactions.b2b), so the rebuilt world reports a chain of 5
    // while its storm stands unbroken: at a quality change or a GPU recovery mid-chain the deck's
    // cover jumps back by 0.5 × breaking (0.39 at a chain of five) in one frame, the wind drops, and
    // the back-to-back run's wider beams are lost until the next combo or b2b event. Dusk, the same
    // kind of eased state, is carried (duskFrom, duskTarget, duskAt). Fix: after the scalars,
    // `this.reactions.setCombo(this.combo, -1e6); this.reactions.setB2B(this.b2b);` in
    // importSessionState (the break then stands settled), or export the reactions' break state.
    it('draws the same storm after an import as the world it came from: the chain\'s break and the back-to-back run', () => {
        const { world } = shared;
        begin(shared);
        for (let n = 2; n <= 5; n++) world.onCombo(n);
        world.onB2B(3);
        stepTo(shared, START + TIMING.breakIn + 1);
        const snapshot = structuredClone(world.exportSessionState());
        const rebuilt = makeWorld({ withAssets: false });
        try {
            rebuilt.world.seek(world.time);
            rebuilt.world.importSessionState(snapshot);
            const t = world.time + 1 / 30;
            for (const w of [shared, rebuilt]) {
                w.world.updateCamera(w.camera, sim(t, 0));
                w.world.update(sim(t, 1 / 30), w.camera);
            }
            expect(world.u.breaking.value).toBeGreaterThan(0.3);
            for (const key of ['breaking', 'cover', 'windStrength']) {
                expect(rebuilt.world.u[key].value, key).toBeCloseTo(world.u[key].value, 9);
            }
        } finally {
            rebuilt.world.dispose();
            begin(shared);
        }
    });
});

describe('GrainfieldsWorld teardown', () => {
    it('disposes once, however often it is asked; a frame after it does nothing', () => {
        const own = makeWorld({ withAssets: false });
        const { world, scene, camera } = own;
        begin(own);
        world.onLock({ u: 0.3, rows: [12], color: PIECE_COLORS[1] });
        const disposeLand = vi.spyOn(world.parts.land.mesh.geometry, 'dispose');
        const disposeSky = vi.spyOn(world.parts.sky, 'dispose');
        world.dispose();
        expect(() => world.dispose()).not.toThrow();
        expect(disposeLand).toHaveBeenCalledOnce();
        expect(disposeSky).toHaveBeenCalledOnce();
        expect(world.disposed).toBe(true);
        expect(world.root.parent).toBeNull();
        expect(world.root.children).toHaveLength(0);
        expect(scene.children).not.toContain(world.root);
        const { time } = world;
        expect(() => {
            world.update(sim(time + 1, 0.1), camera);
            world.prerender({});
        }).not.toThrow();
        expect(world.time).toBe(time);
        // A world never built disposes too.
        const unbuilt = new GrainfieldsWorld({ scene: new THREE.Scene(), quality: QUALITY });
        expect(() => {
            unbuilt.dispose();
            unbuilt.dispose();
        }).not.toThrow();
    });
});
