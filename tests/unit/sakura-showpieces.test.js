/**
 * Sakura Twilight — the showpieces (sakura-showpieces.js): the crown of spray a hard drop raises,
 * the twist's double helix, the blizzard, the gate's light and the star fox.
 *
 * Everything they do on the CPU is a few numbers per slot, so all of it is checked here without
 * a GPU: who gets which slot, what a launch writes, what a frame makes of the reactions' frame,
 * when the star fox arrives and where its path runs on the screen. Their shaders are built in
 * sakura-shaders.test.js. Where the source does not do what its contract says the test is kept
 * as `it.fails` under a `// Was a fault (fixed 2026-11-18):` comment, so it turns red the day the source is put right.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { SAKURA_TORII, SAKURA_VIEWS, sakuraViewFor } from '../../src/themes/sakura-twilight/sakura-composition.js';
import { SakuraLight } from '../../src/themes/sakura-twilight/sakura-light.js';
import { SAKURA_TIERS, sakuraTier } from '../../src/themes/sakura-twilight/sakura-quality.js';
import {
    SAKURA_HELIX_SECONDS, SAKURA_HELIX_SLOTS, SAKURA_SPIRIT_FLIGHT, SAKURA_SPIRIT_SECONDS, SAKURA_SPLASH_SECONDS,
    SAKURA_SPLASH_SLOTS, SakuraShowpieces, sakuraGatePlace, sakuraSpiritPath,
} from '../../src/themes/sakura-twilight/sakura-showpieces.js';
import { SAKURA_CONSTELLATIONS } from '../../src/themes/sakura-twilight/sakura-sky.js';
import { SAKURA_DEFAULT_BOARD } from '../../src/themes/sakura-twilight/sakura-stage.js';
import {
    SAKURA_WATER_LEVEL, sakuraLand, sakuraTerrainHeight,
} from '../../src/themes/sakura-twilight/sakura-terrain.js';

const STEP = 1 / 60;
const TIER_ORDER = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const LIGHT_NAMES = ['SakuraSplash', 'SakuraHelix', 'SakuraGateLight', 'SakuraGateGlow', 'SakuraStarFox'];
/** The star fox's light begins to stand in the gate this long before its head is through. */
const GLOW_LEAD = 0.15;
const owned = [];

function seeded(seed = 7) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** A light rig and the showpieces on it; `build` makes the meshes too (a stand-in petal). */
function create({
    quality = 'Minimal', build = false, blossoms, ...options
} = {}) {
    const tier = sakuraTier(quality);
    const light = new SakuraLight({ tier, rng: seeded() });
    const petal = new THREE.PlaneGeometry(1, 1);
    const pack = blossoms === undefined ? { meshes: { petal_far: petal } } : blossoms;
    const show = new SakuraShowpieces({
        light, tier, blossoms: pack, ...options,
    });
    if (build) show.build();
    owned.push(show, light, petal);
    /** Move the garden's clock (the showpieces read the rig's). */
    const at = (time, frame = {}) => light.update(time, frame);
    return {
        tier, light, show, petal, at,
    };
}

/** Run the clock forward frame by frame from `from` to `to`, updating the showpieces each frame. */
function run(garden, from, to, frame = {}, stream = 0, dt = STEP) {
    const steps = Math.round((to - from) / dt);
    for (let step = 1; step <= steps; step += 1) {
        garden.at(from + step * dt);
        garden.show.update(from + step * dt, dt, frame, stream);
    }
    return from + steps * dt;
}

const splashLeft = (show, now, index) => {
    const slot = show.splashData[index];
    const age = now - slot.z;
    return age < 0 || age >= SAKURA_SPLASH_SECONDS ? 0 : SAKURA_SPLASH_SECONDS - age;
};
const helixLeft = (show, now, index) => {
    const age = now - show.helixData[index].w;
    return age < 0 || age >= SAKURA_HELIX_SECONDS ? 0 : SAKURA_HELIX_SECONDS - age;
};
const liveSplashes = (show, now) => show.splashData.filter((_, index) => splashLeft(show, now, index) > 0);
const liveHelices = (show, now) => show.helixData.filter((_, index) => helixLeft(show, now, index) > 0);
const rows = (data) => data.map((row) => row.toArray());
const everyFinite = (data) => data.every((row) => row.toArray().every(Number.isFinite));

function frameCamera(aspect = 16 / 9) {
    const view = sakuraViewFor(aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 4000);
    camera.position.set(view.position[0], view.position[1], view.position[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
}

/** The star fox's curve at `t` (0 the stars .. 1 the gate): the bezier its shader draws. */
function onPath(path, t) {
    const one = 1 - t;
    return path.from.clone().multiplyScalar(one * one)
        .add(path.over.clone().multiplyScalar(2 * one * t))
        .add(path.to.clone().multiplyScalar(t * t));
}

/** Where a world point falls on the screen (fractions, y down) and how far ahead of the eye it is. */
function onScreen(camera, point) {
    const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const projected = point.clone().project(camera);
    return { x: projected.x * 0.5 + 0.5, y: 0.5 - projected.y * 0.5, depth };
}

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    vi.restoreAllMocks();
});

describe('Sakura showpieces, built', () => {
    it('keeps a few slots for each instrument, and lives that end', () => {
        expect(SAKURA_SPLASH_SLOTS).toBe(6);
        expect(SAKURA_HELIX_SLOTS).toBe(3);
        expect(SAKURA_SPLASH_SECONDS).toBeGreaterThan(0.5);
        expect(SAKURA_SPLASH_SECONDS).toBeLessThan(3);
        expect(SAKURA_HELIX_SECONDS).toBeGreaterThan(1);
        expect(SAKURA_HELIX_SECONDS).toBeLessThan(5);
        // The star fox is a few seconds in the sky and its light lingers in the gate after it.
        expect(SAKURA_SPIRIT_FLIGHT).toBeGreaterThan(1.5);
        expect(SAKURA_SPIRIT_FLIGHT).toBeLessThan(5);
        expect(SAKURA_SPIRIT_SECONDS).toBeGreaterThan(SAKURA_SPIRIT_FLIGHT + 2);
        expect(SAKURA_SPIRIT_SECONDS).toBeLessThan(15);
    });

    it('builds one draw for each instrument, none of them parked invisible or culled', () => {
        const { show, tier, petal } = create({ build: true });
        expect(show.group.name).toBe('SakuraShowpieces');
        const meshes = show.group.children;
        expect(meshes.map((mesh) => mesh.name)).toEqual(['SakuraSplash', 'SakuraHelix', 'SakuraPetalBlizzard',
            'SakuraGateLight', 'SakuraGateGlow', 'SakuraStarFox']);
        for (const mesh of meshes) {
            expect(mesh.isMesh, mesh.name).toBe(true);
            // (At rest a showpiece is drawn folded onto a point, so its pipeline exists before play.)
            expect(mesh.visible, mesh.name).toBe(true);
            expect(mesh.frustumCulled, mesh.name).toBe(false);
            expect(mesh.matrixAutoUpdate, mesh.name).toBe(false);
            expect(mesh.material.isNodeMaterial, mesh.name).toBe(true);
            expect(mesh.material.name, mesh.name).toBe(mesh.name);
            expect(mesh.material.fog, mesh.name).toBe(false);
            expect(mesh.material.positionNode, mesh.name).toBeTruthy();
            expect(mesh.material.colorNode, mesh.name).toBeTruthy();
        }
        // Light that adds is drawn additively, over the solid garden and never into its depth.
        for (const name of LIGHT_NAMES) {
            const mesh = meshes.find((entry) => entry.name === name);
            expect(mesh.material.transparent, name).toBe(true);
            expect(mesh.material.depthWrite, name).toBe(false);
            expect(mesh.material.blending, name).toBe(THREE.AdditiveBlending);
            expect(mesh.renderOrder, name).toBeGreaterThan(0);
        }
        // The blizzard's petals are solid, seen from both sides, and cast nothing.
        const blizzard = meshes.find((entry) => entry.name === 'SakuraPetalBlizzard');
        expect(blizzard.material.transparent).toBe(false);
        expect(blizzard.material.side).toBe(THREE.DoubleSide);
        expect(blizzard.castShadow).toBe(false);
        expect(blizzard.geometry).toBe(petal);
        expect(blizzard.count).toBe(tier.blizzard);
        expect(show.blizzardMesh).toBe(blizzard);
        // A whole number of drops, petals and sparks to a slot.
        expect(show.splashMesh.count % SAKURA_SPLASH_SLOTS).toBe(0);
        expect(show.splashMesh.count / SAKURA_SPLASH_SLOTS).toBeGreaterThan(8);
        expect(show.helixMesh.count % (SAKURA_HELIX_SLOTS * 2)).toBe(0);
        expect(show.helixMesh.count / SAKURA_HELIX_SLOTS).toBeGreaterThan(20);
        expect(show.spiritMesh.count).toBeGreaterThan(30);
        expect(show.gateMesh.isInstancedMesh).toBeFalsy();
        // The sprites share one quad.
        expect(show.helixMesh.geometry).toBe(show.splashMesh.geometry);
        expect(show.spiritMesh.geometry).toBe(show.splashMesh.geometry);
    });

    it('streams fewer petals the lower the tier, and none without a petal to stream', () => {
        const counts = TIER_ORDER.map((quality) => {
            const { show } = create({ quality, build: true });
            expect(show.blizzardMesh.count, quality).toBe(SAKURA_TIERS[quality].blizzard);
            return show.blizzardMesh.count;
        });
        expect(counts).toEqual([2200, 1800, 1400, 900, 500, 280]);
        for (const tier of Object.values(SAKURA_TIERS)) {
            expect(Number.isInteger(tier.blizzard) && tier.blizzard > 0).toBe(true);
            // A fraction of the petals the simulation carries: the blizzard is the far layer.
            expect(tier.blizzard).toBeLessThan(tier.petals);
        }
        // The far petal when the pack has one, else the near petal; with neither, no blizzard
        // (and everything else is still built).
        const near = new THREE.PlaneGeometry(1, 1);
        owned.push(near);
        expect(create({ build: true, blossoms: { meshes: { petal: near } } }).show.blizzardMesh.geometry).toBe(near);
        for (const blossoms of [null, {}, { meshes: {} }]) {
            const { show } = create({ build: true, blossoms });
            expect(show.blizzardMesh).toBeUndefined();
            expect(show.group.children.map((mesh) => mesh.name)).toEqual(LIGHT_NAMES);
        }
        // A tier that streams none builds none (and nonsense is none).
        for (const blizzard of [0, -40, NaN, undefined, null]) {
            const none = create({ build: true, tier: { ...sakuraTier('Minimal'), blizzard } });
            expect(none.show.group.children.map((mesh) => mesh.name), String(blizzard)).toEqual(LIGHT_NAMES);
        }
    });

    it('takes its chances from a generator of its own: the same every time, and none of anyone else\'s', () => {
        // (Two gardens built one after the other: were the chances the page's, they would differ.)
        const first = create({ build: true });
        const second = create({ build: true });
        const chancesOf = ({ show }) => show.group.children.flatMap((mesh) => {
            const attributes = [];
            mesh.material.positionNode.traverse((node) => {
                if (node.value?.isInstancedBufferAttribute) attributes.push(Array.from(node.value.array));
            });
            return attributes;
        });
        const a = chancesOf(first);
        const b = chancesOf(second);
        expect(a.length).toBeGreaterThanOrEqual(5);
        expect(b).toEqual(a);
        for (const array of a) expect(array.every(Number.isFinite)).toBe(true);
        // Given other chances it draws from those instead.
        const calls = { count: 0 };
        const mine = () => { calls.count += 1; return 0.25; };
        const third = create({ build: true, rng: mine });
        expect(calls.count).toBeGreaterThan(100);
        expect(chancesOf(third)).not.toEqual(a);
    });

    it('starts with every slot spent, the gate dark and no star fox', () => {
        const { show, light } = create({ build: true });
        expect(show.splashData).toHaveLength(SAKURA_SPLASH_SLOTS);
        expect(show.helixData).toHaveLength(SAKURA_HELIX_SLOTS);
        expect(show.helixLook).toHaveLength(SAKURA_HELIX_SLOTS);
        expect(liveSplashes(show, light.uTime.value)).toEqual([]);
        expect(liveHelices(show, light.uTime.value)).toEqual([]);
        expect(show.uGate.value).toBe(0);
        expect(show.uBlizzard.value).toBe(0);
        expect(show.uSpirit.value.y).toBe(0);
        expect(show.arrived).toBe(true);
        // A slot "launched" long ago draws nothing however late the clock (its age is past its life).
        for (const slot of show.splashData) expect(slot.z).toBeLessThan(-100);
        for (const slot of show.helixData) expect(slot.w).toBeLessThan(-100);
        expect(show.uSpirit.value.x).toBeLessThan(-100);
        // Frames at rest change nothing.
        const arrive = vi.fn();
        show.onArrive = arrive;
        for (let frame = 0; frame < 120; frame += 1) {
            light.update(frame * STEP, {});
            show.update(frame * STEP, STEP, {}, 0);
            expect(show.uGate.value).toBe(0);
            expect(show.uBlizzard.value).toBe(0);
        }
        expect(arrive).not.toHaveBeenCalled();
    });

    it('disposes what it made once, leaves the borrowed petal alone and is gone from the scene', () => {
        const { show, petal } = create({ build: true });
        const parent = new THREE.Group();
        parent.add(show.group);
        const geometries = new Set(show.group.children.map((mesh) => mesh.geometry));
        geometries.delete(petal);
        const materials = show.group.children.map((mesh) => mesh.material);
        const instanced = show.group.children.filter((mesh) => mesh.isInstancedMesh);
        expect(geometries.size).toBe(2);
        expect(new Set(materials).size).toBe(6);
        const once = [...geometries, ...materials, ...instanced].map((resource) => vi.spyOn(resource, 'dispose'));
        const borrowed = vi.spyOn(petal, 'dispose');
        show.dispose();
        once.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(borrowed).not.toHaveBeenCalled();
        expect(show.group.parent).toBeNull();
        expect(show.group.children).toHaveLength(0);
        expect(show.owned).toHaveLength(0);
        // Again is nothing.
        expect(() => show.dispose()).not.toThrow();
        once.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });
});

describe('Sakura showpieces: the crown of spray', () => {
    it('writes one slot for a launch: where, when and how hard', () => {
        const { show, at } = create();
        at(12.5);
        expect(show.splash(-7.25, -14.5, 0.6)).toBe(true);
        const live = liveSplashes(show, 12.5);
        expect(live).toHaveLength(1);
        expect(live[0].toArray()).toEqual([-7.25, -14.5, 12.5, expect.closeTo(0.6, 6)]);
        // The strength is how far the piece fell, held to a crown that can be seen and no more than whole.
        for (const [asked, held] of [[0.01, 0.15], [0.15, 0.15], [0.4, 0.4], [1, 1], [7, 1], [1e9, 1]]) {
            const fresh = create();
            fresh.at(3);
            expect(fresh.show.splash(1, 2, asked)).toBe(true);
            expect(liveSplashes(fresh.show, 3)[0].w, String(asked)).toBeCloseTo(held, 6);
        }
        // Left out, it is a middling crown.
        const plain = create();
        plain.at(3);
        expect(plain.show.splash(1, 2)).toBe(true);
        expect(liveSplashes(plain.show, 3)[0].w).toBeCloseTo(0.6, 6);
    });

    it('refuses nonsense without touching a slot', () => {
        const { show, at } = create();
        at(5);
        show.splash(1, 1, 0.5);
        const before = rows(show.splashData);
        for (const [x, z, strength] of [[NaN, 0, 1], [0, NaN, 1], [Infinity, 0, 1], [0, -Infinity, 1],
            [undefined, 0, 1], [0, undefined, 1], [null, 0, 1], ['3', 0, 1], [0, '4', 1], [[], 0, 1], [{}, 0, 1],
            [0, 0, 0], [0, 0, -1], [0, 0, -Infinity], [0, 0, NaN], [0, 0, null], [0, 0, 'hard'], [0, 0, {}]]) {
            expect(show.splash(x, z, strength), `${String(x)}, ${String(z)}, ${String(strength)}`).toBe(false);
            expect(rows(show.splashData)).toEqual(before);
        }
        expect(show.splash()).toBe(false);
        expect(rows(show.splashData)).toEqual(before);
    });

    it('takes a spent slot while there is one, and only then the crown with the least left', () => {
        const { show, at } = create();
        // Twenty hard drops in two seconds: a crown lasts 1.25 s, so the six slots fill and turn over.
        let reused = 0;
        for (let launch = 0; launch < 20; launch += 1) {
            const now = 30 + launch * 0.1;
            at(now);
            const left = show.splashData.map((_, index) => splashLeft(show, now, index));
            const before = rows(show.splashData);
            expect(show.splash(launch, -launch, 0.7)).toBe(true);
            const changed = rows(show.splashData).map((row, index) => (
                row.some((value, i) => value !== before[index][i]) ? index : -1)).filter((index) => index >= 0);
            expect(changed, `launch ${launch}`).toHaveLength(1);
            const [taken] = changed;
            if (left.some((value) => value === 0)) {
                // Nothing in flight is cut short while a spent slot exists.
                expect(left[taken], `launch ${launch} took a live crown with ${left[taken]} s left`).toBe(0);
            } else {
                reused += 1;
                expect(left[taken], `launch ${launch}`).toBe(Math.min(...left));
            }
            expect(show.splashData[taken].toArray()).toEqual([launch, -launch, now, expect.closeTo(0.7, 6)]);
            expect(liveSplashes(show, now).length).toBeLessThanOrEqual(SAKURA_SPLASH_SLOTS);
        }
        // (A crown outlasts six launches a tenth of a second apart: some had to make room.)
        expect(reused).toBeGreaterThan(5);
        // The newest six are the ones standing.
        const standing = liveSplashes(show, 31.9).map((slot) => slot.x).sort((a, b) => a - b);
        expect(standing).toEqual([14, 15, 16, 17, 18, 19]);
        // Left alone they all fall back, and the next launch takes a slot without cutting anything.
        at(31.9 + SAKURA_SPLASH_SECONDS + 0.01);
        expect(liveSplashes(show, 31.9 + SAKURA_SPLASH_SECONDS + 0.01)).toEqual([]);
    });

    it('fills all six slots before it reuses one, whatever order they were spent in', () => {
        const { show, at } = create();
        at(10);
        for (let index = 0; index < SAKURA_SPLASH_SLOTS; index += 1) expect(show.splash(index, 0, 1)).toBe(true);
        expect(liveSplashes(show, 10).map((slot) => slot.x).sort()).toEqual([0, 1, 2, 3, 4, 5]);
        // Slots 1 and 4 are older than the rest and fall back first.
        show.splashData[1].z = 9.2;
        show.splashData[4].z = 9.24;
        at(10.5);
        expect(liveSplashes(show, 10.5)).toHaveLength(4);
        show.splash(100, 0, 1);
        show.splash(101, 0, 1);
        expect(liveSplashes(show, 10.5).map((slot) => slot.x).sort((a, b) => a - b)).toEqual([0, 2, 3, 5, 100, 101]);
        // A launch at the very instant a crown ends counts it spent.
        const edge = create();
        edge.at(0);
        for (let index = 0; index < SAKURA_SPLASH_SLOTS; index += 1) edge.show.splash(index, 0, 1);
        edge.show.splashData[3].z = -SAKURA_SPLASH_SECONDS;
        edge.show.splash(50, 0, 1);
        expect(edge.show.splashData[3].x).toBe(50);
    });

    // Was a fault (fixed 2026-11-18): sakura-showpieces.js splash() (lines 236-243) weighs what is left of a crown by its
    // strength (`w * (1 - age / SECONDS)`), so with every slot standing a weak crown a twentieth
    // of a second old is the one cut, not the strong one that has all but fallen back. The header
    // and the contract say "the one with the least of its life left" (helix() does exactly that).
    // Reproduce: five splash(x, z, 1) at t = 10, at t = 11 one splash(x, z, 0.15), at t = 11.05 a
    // seventh: the 0.15 crown born 0.05 s ago is overwritten; the five have 0.2 s left.
    it('gives up the crown with the least time left, however strong it was', () => {
        const { show, at } = create();
        at(10);
        for (let index = 0; index < 5; index += 1) show.splash(index, 0, 1);
        at(11);
        show.splash(77, 0, 0.15);
        at(11.05);
        show.splash(88, 0, 1);
        expect(liveSplashes(show, 11.05).map((slot) => slot.x)).toContain(77);
    });
});

describe('Sakura showpieces: the double helix', () => {
    it('writes one slot for a launch: its foot, when, how strong, which way it turns and how tall', () => {
        const { show, at } = create();
        at(8);
        expect(show.helix(4.5, 1.2, -3, -1, 0.75, 6.5)).toBe(true);
        const index = show.helixData.findIndex((_, slot) => helixLeft(show, 8, slot) > 0);
        expect(show.helixData[index].toArray()).toEqual([4.5, expect.closeTo(1.2, 6), -3, 8]);
        expect(show.helixLook[index].toArray()).toEqual([0.75, -1, 6.5, 0]);
        // The side is a turn one way or the other and nothing else; the strength and the height are held.
        const looks = (...args) => {
            const fresh = create();
            fresh.at(1);
            expect(fresh.show.helix(0, 0, 0, ...args)).toBe(true);
            return fresh.show.helixLook[fresh.show.helixData.findIndex((_, slot) => helixLeft(fresh.show, 1, slot) > 0)]
                .toArray();
        };
        expect(looks()).toEqual([1, 1, 5, 0]);
        expect(looks(-0.001)).toEqual([1, -1, 5, 0]);
        expect(looks(-9)).toEqual([1, -1, 5, 0]);
        for (const side of [0, 1, 9, NaN, undefined, 'left', null]) expect(looks(side)[1], String(side)).toBe(1);
        expect(looks(1, 0.01)[0]).toBeCloseTo(0.3, 6);
        expect(looks(1, 9)[0]).toBeCloseTo(1.3, 6);
        expect(looks(1, 1, 0.2)[2]).toBe(2);
        expect(looks(1, 1, -40)[2]).toBe(2);
        expect(looks(1, 1, 30)[2]).toBe(30);
    });

    it('refuses nonsense without touching a slot', () => {
        const { show, at } = create();
        at(5);
        show.helix(1, 1, 1, 1, 1, 5);
        const before = [rows(show.helixData), rows(show.helixLook)];
        for (const [x, y, z, strength] of [[NaN, 0, 0, 1], [0, NaN, 0, 1], [0, 0, NaN, 1], [Infinity, 0, 0, 1],
            [0, -Infinity, 0, 1], [undefined, 0, 0, 1], [0, null, 0, 1], [0, 0, '2', 1], [0, 0, 0, 0], [0, 0, 0, -2],
            [0, 0, 0, NaN], [0, 0, 0, null], [0, 0, 0, 'x']]) {
            expect(show.helix(x, y, z, 1, strength, 5), `${String(x)}, ${String(y)}, ${String(z)}, ${String(strength)}`)
                .toBe(false);
            expect([rows(show.helixData), rows(show.helixLook)]).toEqual(before);
        }
        expect(show.helix()).toBe(false);
    });

    // Was a fault (fixed 2026-11-18): sakura-showpieces.js helix() (line 318 checks only x, y, z; line 331 `Math.max(2,
    // height)`) accepts a height that is not a number: Math.max(2, NaN) is NaN, and the slot's
    // height goes to the shader as NaN (every petal of that helix is placed at NaN) or as Infinity.
    // Reproduce: light.update(1, {}); show.helix(0, 0, 0, 1, 1, NaN) returns true and
    // show.helixLook[0].z is NaN. The contract: non-finite arguments are refused, no slot written.
    it('refuses a height that is not a number', () => {
        const { show, at } = create();
        at(5);
        const before = [rows(show.helixData), rows(show.helixLook)];
        const taken = [NaN, Infinity, -Infinity].map((height) => show.helix(0, 0, 0, 1, 1, height));
        expect(everyFinite(show.helixLook)).toBe(true);
        expect(taken).toEqual([false, false, false]);
        expect([rows(show.helixData), rows(show.helixLook)]).toEqual(before);
    });

    it('takes a spent slot while there is one, and only then the helix furthest through its turn', () => {
        const { show, at } = create();
        const order = [];
        for (let launch = 0; launch < 12; launch += 1) {
            const now = 50 + launch * 0.6;
            at(now);
            const left = show.helixData.map((_, index) => helixLeft(show, now, index));
            const before = rows(show.helixData);
            expect(show.helix(launch, 0, 0, 1, 1, 5)).toBe(true);
            const taken = rows(show.helixData)
                .findIndex((row, index) => row.some((value, i) => value !== before[index][i]));
            order.push(taken);
            if (left.some((value) => value === 0)) expect(left[taken], `launch ${launch}`).toBe(0);
            else expect(left[taken], `launch ${launch}`).toBe(Math.min(...left));
            expect(liveHelices(show, now).length).toBeLessThanOrEqual(SAKURA_HELIX_SLOTS);
        }
        // Every slot is used.
        expect(new Set(order).size).toBe(SAKURA_HELIX_SLOTS);
        // Three twists inside one helix's life fill the slots; each keeps its own look.
        const three = create();
        three.at(1);
        three.show.helix(1, 0, 0, -1, 0.5, 3);
        three.at(1.2);
        three.show.helix(2, 0, 0, 1, 1, 7);
        three.at(1.4);
        three.show.helix(3, 0, 0, -1, 1.2, 9);
        expect(liveHelices(three.show, 1.4)).toHaveLength(3);
        const looks = three.show.helixData.map((slot, index) => [slot.x, ...three.show.helixLook[index].toArray()]);
        expect(looks.sort((a, b) => a[0] - b[0])).toEqual([
            [1, 0.5, -1, 3, 0], [2, 1, 1, 7, 0], [3, expect.closeTo(1.2, 6), -1, 9, 0],
        ]);
    });
});

describe('Sakura showpieces: the star fox', () => {
    it('sets out one at a time: a second during the flight is refused, and changes nothing', () => {
        const { show, at } = create();
        at(20);
        expect(show.spirit(1)).toBe(true);
        expect(show.uSpirit.value.toArray()).toEqual([20, 1]);
        expect(show.arrived).toBe(false);
        for (const age of [0, 0.001, 1, SAKURA_SPIRIT_FLIGHT - 0.001]) {
            at(20 + age);
            expect(show.spirit(0.5), `age ${age}`).toBe(false);
            expect(show.uSpirit.value.toArray()).toEqual([20, 1]);
        }
        // Its flight over, another may set out.
        at(20 + SAKURA_SPIRIT_FLIGHT + 1e-6);
        show.update(0, 0, {}, 0);
        expect(show.spirit(0.5)).toBe(true);
        expect(show.uSpirit.value.x).toBe(20 + SAKURA_SPIRIT_FLIGHT + 1e-6);
        expect(show.uSpirit.value.y).toBeCloseTo(0.5, 6);
    });

    it('holds its power to what can be seen and no more than a blaze', () => {
        for (const [asked, held] of [[undefined, 1], [1, 1], [0, 0.4], [-3, 0.4], [0.4, 0.4], [0.7, 0.7], [9, 1.3],
            [Infinity, 1.3], [null, 0.4]]) {
            const { show, at } = create();
            at(2);
            expect(show.spirit(asked), String(asked)).toBe(true);
            expect(show.uSpirit.value.y, String(asked)).toBeCloseTo(held, 6);
        }
    });

    // Was a fault (fixed 2026-11-18): sakura-showpieces.js spirit() (line 523, `Math.min(1.3, Math.max(0.4, power))`) takes a
    // power that is not a number: the slot's power is NaN, and from the moment the star fox nears
    // the gate update() writes NaN into `uGate` — the gate's shaft, its glow and the torii's own
    // ember (the garden's prop material) all shade NaN. Reproduce: light.update(1, {});
    // show.spirit(NaN) returns true; light.update(1 + 2.9, {}); show.update(0, 0, {}, 0);
    // show.uGate.value is NaN. The contract: non-finite arguments are refused, no slot written.
    it('refuses a power that is not a number, and never lets one reach the gate', () => {
        for (const power of [NaN, 'bright', {}]) {
            const { show, at } = create();
            at(1);
            const taken = show.spirit(power);
            at(1 + SAKURA_SPIRIT_FLIGHT + 0.2);
            show.update(0, 0, {}, 0);
            expect(Number.isFinite(show.uGate.value), `uGate after spirit(${String(power)})`).toBe(true);
            expect(Number.isFinite(show.uSpirit.value.y)).toBe(true);
            expect(taken).toBe(false);
        }
    });

    it('arrives exactly once, on the first frame its age has passed the flight', () => {
        for (const fps of [30, 60, 144]) {
            const garden = create();
            const arrive = vi.fn();
            garden.show.onArrive = arrive;
            garden.at(100);
            garden.show.spirit(0.9);
            const dt = 1 / fps;
            let arrivedAt = null;
            for (let frame = 1; frame <= fps * 12; frame += 1) {
                const now = 100 + frame * dt;
                garden.at(now);
                garden.show.update(now, dt, {}, 0);
                if (arrive.mock.calls.length && arrivedAt === null) arrivedAt = now - 100;
            }
            expect(arrive, `${fps} fps`).toHaveBeenCalledOnce();
            // Through the gate, with the power it set out with.
            const gate = sakuraGatePlace();
            expect(arrive.mock.calls[0]).toEqual([gate.x, gate.z, expect.closeTo(0.9, 6)]);
            expect(arrivedAt).toBeGreaterThanOrEqual(SAKURA_SPIRIT_FLIGHT - 1e-9);
            expect(arrivedAt).toBeLessThan(SAKURA_SPIRIT_FLIGHT + dt + 1e-9);
            expect(garden.show.arrived).toBe(true);
        }
    });

    it('arrives once for every star fox, however the frames fall', () => {
        const garden = create();
        const arrive = vi.fn();
        garden.show.onArrive = arrive;
        // One long frame that steps right over the flight: it still arrives, once.
        garden.at(10);
        garden.show.spirit(1);
        garden.at(10 + SAKURA_SPIRIT_FLIGHT + 0.4);
        garden.show.update(0, 0.4, {}, 0);
        garden.show.update(0, 0, {}, 0);
        expect(arrive).toHaveBeenCalledOnce();
        // Three more, each sent as soon as the last has landed.
        let now = 20;
        for (let fox = 0; fox < 3; fox += 1) {
            garden.at(now);
            expect(garden.show.spirit(0.6 + fox * 0.2)).toBe(true);
            now = run(garden, now, now + SAKURA_SPIRIT_FLIGHT + 0.05);
            expect(arrive).toHaveBeenCalledTimes(2 + fox);
            expect(arrive.mock.calls.at(-1)[2]).toBeCloseTo(0.6 + fox * 0.2, 6);
        }
        // And nothing arrives by itself afterwards.
        run(garden, now, now + 30);
        expect(arrive).toHaveBeenCalledTimes(4);
        // No listener is no trouble.
        garden.show.onArrive = null;
        garden.at(now + 40);
        garden.show.spirit(1);
        expect(() => run(garden, now + 40, now + 45)).not.toThrow();
    });

    it('is forgotten by a reset: a star fox in the sky never arrives', () => {
        const garden = create();
        const arrive = vi.fn();
        garden.show.onArrive = arrive;
        garden.at(5);
        garden.show.spirit(1);
        run(garden, 5, 6.5);
        garden.show.reset();
        run(garden, 6.5, 20);
        expect(arrive).not.toHaveBeenCalled();
        expect(garden.show.uGate.value).toBe(0);
        // The next one sets out at once and arrives as any other.
        expect(garden.show.spirit(1)).toBe(true);
        run(garden, 20, 24);
        expect(arrive).toHaveBeenCalledOnce();
    });
});

describe('Sakura showpieces: the gate\'s light', () => {
    it('glows after the star fox as a rise and a long fall: dark before, never more than whole, dark again', () => {
        const { afterglow } = SakuraShowpieces;
        // Dark all the way down from the stars (its light begins to stand as the head reaches the gate).
        for (let age = -5; age < SAKURA_SPIRIT_FLIGHT - GLOW_LEAD; age += 0.01) {
            expect(afterglow(age), `age ${age}`).toBe(0);
        }
        // Dark again, for good, once its light has gone.
        for (const age of [SAKURA_SPIRIT_SECONDS, SAKURA_SPIRIT_SECONDS + 0.001, 60, 1e6, 1e12, Infinity]) {
            expect(afterglow(age), `age ${age}`).toBe(0);
        }
        // Nonsense is no glow.
        for (const age of [NaN, undefined, null, 'soon', {}, -Infinity]) expect(afterglow(age), String(age)).toBe(0);
        let peak = 0;
        let peakAt = 0;
        let last = 0;
        let steepest = 0;
        const dt = 0.001;
        for (let age = SAKURA_SPIRIT_FLIGHT - GLOW_LEAD - 0.01; age <= SAKURA_SPIRIT_SECONDS + 0.01; age += dt) {
            const glow = afterglow(age);
            expect(glow).toBeGreaterThanOrEqual(0);
            expect(glow).toBeLessThanOrEqual(1);
            steepest = Math.max(steepest, Math.abs(glow - last));
            if (glow > peak) {
                peak = glow;
                peakAt = age;
            }
            last = glow;
        }
        // It rises smoothly (no step anywhere: the steepest millisecond is a small one)...
        expect(steepest).toBeLessThan(0.006);
        // ...to all but whole a quarter second after the head is through the gate...
        expect(peak).toBeGreaterThan(0.95);
        expect(peakAt).toBeGreaterThan(SAKURA_SPIRIT_FLIGHT);
        expect(peakAt).toBeLessThan(SAKURA_SPIRIT_FLIGHT + 0.5);
        // ...and falls away from there without ever turning back up.
        let previous = afterglow(peakAt);
        for (let age = peakAt; age <= SAKURA_SPIRIT_SECONDS; age += 0.01) {
            expect(afterglow(age)).toBeLessThanOrEqual(previous + 1e-12);
            previous = afterglow(age);
        }
        // Half its light is still there a second and a half later; the last second is an ember.
        expect(afterglow(SAKURA_SPIRIT_FLIGHT + 1.2)).toBeGreaterThan(0.45);
        expect(afterglow(SAKURA_SPIRIT_SECONDS - 0.2)).toBeLessThan(0.03);
    });

    it('stands as tall as the back-to-backs in a row or the star fox left it, whichever is more', () => {
        const garden = create();
        const { show } = garden;
        garden.at(1);
        // Back-to-backs: the frame's corona, a little under three quarters of it.
        for (const [corona, gate] of [[0, 0], [0.5, 0.36], [1, 0.72], [1.6, 1.152], [9, 1.152], [-2, 0]]) {
            show.update(1, STEP, { corona }, 0);
            expect(show.uGate.value, `corona ${corona}`).toBeCloseTo(gate, 9);
        }
        for (const corona of [NaN, Infinity, -Infinity, undefined, null, 'wide', {}]) {
            show.update(1, STEP, { corona }, 0);
            expect(show.uGate.value, String(corona)).toBe(0);
        }
        // The star fox: its afterglow times its power, up to a blaze of 1.6.
        for (const power of [0.4, 1, 1.3]) {
            const fox = create();
            fox.at(10);
            fox.show.spirit(power);
            let peak = 0;
            for (let frame = 1; frame <= 60 * 9; frame += 1) {
                const now = 10 + frame * STEP;
                fox.at(now);
                fox.show.update(now, STEP, {}, 0);
                const expected = Math.min(1.6, 1.6 * SakuraShowpieces.afterglow(now - 10) * fox.show.uSpirit.value.y);
                expect(fox.show.uGate.value).toBeCloseTo(expected, 9);
                expect(fox.show.uGate.value).toBeGreaterThanOrEqual(0);
                expect(fox.show.uGate.value).toBeLessThanOrEqual(1.6);
                peak = Math.max(peak, fox.show.uGate.value);
            }
            expect(peak, `power ${power}`).toBeCloseTo(Math.min(1.6, 1.6 * power), 1);
            expect(fox.show.uGate.value).toBe(0);
        }
        // Both at once: the brighter of the two, never their sum.
        const both = create();
        both.at(10);
        both.show.spirit(0.5);
        both.at(10 + SAKURA_SPIRIT_FLIGHT + 0.15);
        both.show.update(0, STEP, { corona: 1.6 }, 0);
        const blaze = 1.6 * 0.5 * SakuraShowpieces.afterglow(SAKURA_SPIRIT_FLIGHT + 0.15);
        expect(both.show.uGate.value).toBeCloseTo(Math.max(1.152, blaze), 9);
    });

    it('rises and falls a little a frame: the star fox never switches the gate on or off', () => {
        const garden = create();
        garden.at(0);
        garden.show.spirit(1.3);
        let last = 0;
        let steepest = 0;
        for (let frame = 1; frame <= 60 * 9; frame += 1) {
            garden.at(frame * STEP);
            garden.show.update(frame * STEP, STEP, {}, 0);
            steepest = Math.max(steepest, Math.abs(garden.show.uGate.value - last));
            last = garden.show.uGate.value;
        }
        // (Its fastest is the rise: all of 1.6 in under a third of a second, eased at both ends.)
        expect(steepest).toBeLessThan(0.2);
    });

    // Was a fault (fixed 2026-11-18): sakura-showpieces.js spirit() (line 522) refuses a second star fox only while the
    // first is in the sky (2.9 s); its light then stands in the gate until SAKURA_SPIRIT_SECONDS
    // (7.5 s). A perfect clear in that time relaunches the one slot: update() reads afterglow(0)
    // and the gate goes from a blaze to dark in a single frame, 2.75 s before it lights again.
    // Reproduce: light.update(0, {}); show.spirit(1); step to t = 3.1 (uGate 1.55); show.spirit(1)
    // returns true; next show.update(): uGate 0. Nothing in flight should be cut short.
    it('keeps the gate burning when a second star fox sets out under the first one\'s light', () => {
        const garden = create();
        garden.at(0);
        garden.show.spirit(1);
        const now = run(garden, 0, SAKURA_SPIRIT_FLIGHT + 0.2);
        const blazing = garden.show.uGate.value;
        expect(blazing).toBeGreaterThan(1.4);
        expect(garden.show.spirit(1)).toBe(true);
        run(garden, now, now + STEP);
        expect(blazing - garden.show.uGate.value).toBeLessThan(0.3);
    });
});

describe('Sakura showpieces: the blizzard', () => {
    it('is as thick as the most that asks for it: the air\'s stream, the four-line storm or a fever\'s edge', () => {
        const garden = create();
        const { show } = garden;
        garden.at(1);
        const blizzardOf = (frame, stream) => {
            show.update(1, STEP, frame, stream);
            return show.uBlizzard.value;
        };
        expect(blizzardOf({}, 0)).toBe(0);
        expect(blizzardOf({}, 0.5)).toBeCloseTo(0.5, 12);
        expect(blizzardOf({ blizzard: 0.8 }, 0.5)).toBeCloseTo(0.8, 12);
        expect(blizzardOf({ blizzard: 0.3 }, 0.5)).toBeCloseTo(0.5, 12);
        expect(blizzardOf({ fever: 1 }, 0)).toBeCloseTo(0.22, 12);
        expect(blizzardOf({ fever: 0.5, blizzard: 0.05 }, 0)).toBeCloseTo(0.11, 12);
        expect(blizzardOf({ blizzard: 1, fever: 1 }, 1)).toBe(1);
        // Under Reduce motion less of it is in the air (never none of a storm, never more than all).
        expect(blizzardOf({ blizzard: 1, motion: 0 }, 0)).toBeCloseTo(0.45, 12);
        expect(blizzardOf({ blizzard: 1, motion: 0.35 }, 0)).toBeCloseTo(0.45 + 0.55 * 0.35, 12);
        expect(blizzardOf({ blizzard: 1, motion: 1 }, 0)).toBe(1);
        expect(blizzardOf({ blizzard: 1, motion: 7 }, 0)).toBe(1);
        expect(blizzardOf({ blizzard: 1, motion: -7 }, 0)).toBeCloseTo(0.45, 12);
        for (const motion of [NaN, undefined, null, 'calm', Infinity]) {
            expect(blizzardOf({ blizzard: 0.6, motion }, 0), String(motion)).toBeCloseTo(0.6, 12);
        }
    });

    it('stays between none and all whatever it is handed', () => {
        const garden = create();
        const { show } = garden;
        garden.at(1);
        const junk = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 0.5, 1, 2, 1e308, -1e308, '0.5', 'x', [], [1],
            {}, true, false, () => 1];
        for (const blizzard of junk) {
            for (const fever of junk) {
                for (const stream of [undefined, NaN, Infinity, -3, 0, 0.5, 9, 'x', null]) {
                    show.update(1, STEP, {
                        blizzard, fever, motion: fever, corona: blizzard,
                    }, stream);
                    const label = `${String(blizzard)} / ${String(fever)} / ${String(stream)}`;
                    expect(show.uBlizzard.value >= 0 && show.uBlizzard.value <= 1, `uBlizzard ${label}`).toBe(true);
                    expect(show.uGate.value >= 0 && show.uGate.value <= 1.6, `uGate ${label}`).toBe(true);
                }
            }
        }
        // No frame at all is an empty one.
        show.update(1, STEP);
        expect(show.uBlizzard.value).toBe(0);
        expect(show.uGate.value).toBe(0);
        expect(() => show.update()).not.toThrow();
    });

    it('rides the wind: how far it has been carried is the wind\'s own sum, and never runs back', () => {
        const garden = create();
        const { show, light } = garden;
        garden.at(0);
        show.update(0, STEP, {}, 0);
        expect(show.uCarried.value).toBe(0);
        let last = 0;
        let sum = 0;
        for (let frame = 1; frame <= 600; frame += 1) {
            // The wind rises and falls as play does; the petals only ever go on.
            const gust = 0.5 + 0.5 * Math.sin(frame * 0.05);
            light.update(frame * STEP, { gust, level: gust });
            show.update(frame * STEP, STEP, {}, 0);
            const speed = 1.2 + light.uWind.value * 9 + light.uGust.value * 2.5;
            sum += STEP * speed;
            expect(show.uCarried.value).toBeGreaterThan(last);
            expect(show.uCarried.value - last).toBeCloseTo(STEP * speed, 9);
            last = show.uCarried.value;
        }
        expect(show.uCarried.value).toBeCloseTo(sum, 6);
        // A frame drawn twice, a paused clock: nothing moves.
        show.update(10, STEP, {}, 0);
        show.update(10, 0, {}, 0);
        expect(show.uCarried.value).toBe(last);
        // A clock that jumped or went back lands where the resting breeze would have carried it.
        garden.at(400);
        show.update(400, STEP, {}, 0);
        expect(show.uCarried.value).toBeCloseTo(400 * (1.2 + 0.24 * 9), 9);
        garden.at(3);
        show.update(3, STEP, {}, 0);
        expect(show.uCarried.value).toBeCloseTo(3 * (1.2 + 0.24 * 9), 9);
        // A slow frame (half a second) is still a frame.
        const here = show.uCarried.value;
        garden.at(3.5);
        show.update(3.5, 0.5, {}, 0);
        expect(show.uCarried.value).toBeCloseTo(here + 0.5 * (1.2 + light.uWind.value * 9), 9);
    });
});

describe('Sakura showpieces through time and resets', () => {
    it('reads the garden\'s clock and nothing else: the time and step it is handed may be anything', () => {
        const garden = create();
        const arrive = vi.fn();
        garden.show.onArrive = arrive;
        garden.at(7);
        garden.show.spirit(1);
        garden.show.splash(1, 1, 1);
        garden.show.helix(1, 0, 1, 1, 1, 5);
        for (const [time, dt] of [[NaN, NaN], [Infinity, -1], [-50, 1e9], [undefined, undefined], ['now', null],
            [1e12, 0]]) {
            expect(() => garden.show.update(time, dt, { corona: 1 }, 0.5)).not.toThrow();
            expect(garden.show.uGate.value).toBeCloseTo(0.72, 9);
            expect(garden.show.uBlizzard.value).toBeCloseTo(0.5, 9);
            expect(Number.isFinite(garden.show.uCarried.value)).toBe(true);
        }
        expect(arrive).not.toHaveBeenCalled();
        expect(liveSplashes(garden.show, 7)).toHaveLength(1);
    });

    it('treats what was launched in a future the clock came back from as spent', () => {
        const garden = create();
        const { show } = garden;
        const arrive = vi.fn();
        show.onArrive = arrive;
        garden.at(500);
        for (let index = 0; index < SAKURA_SPLASH_SLOTS; index += 1) show.splash(index, 0, 1);
        for (let index = 0; index < SAKURA_HELIX_SLOTS; index += 1) show.helix(index, 0, 0, 1, 1, 5);
        show.spirit(1);
        // A new run: the clock is back near its start, and nothing was reset.
        garden.at(4);
        show.update(4, STEP, {}, 0);
        expect(liveSplashes(show, 4)).toEqual([]);
        expect(liveHelices(show, 4)).toEqual([]);
        expect(show.uGate.value).toBe(0);
        // Launches find room at once (every slot reads as spent) and cut nothing.
        expect(show.splash(9, 9, 1)).toBe(true);
        expect(show.helix(9, 0, 9, 1, 1, 5)).toBe(true);
        expect(show.spirit(1)).toBe(true);
        expect(liveSplashes(show, 4)).toHaveLength(1);
        expect(liveHelices(show, 4)).toHaveLength(1);
        run(garden, 4, 4 + SAKURA_SPIRIT_SECONDS + 1);
        expect(arrive).toHaveBeenCalledOnce();
        expect(everyFinite(show.splashData) && everyFinite(show.helixData) && everyFinite(show.helixLook)).toBe(true);
    });

    it('comes back to rest on reset: every slot spent, the gate dark, the air empty', () => {
        const garden = create({ build: true });
        const { show } = garden;
        garden.at(40);
        for (let index = 0; index < SAKURA_SPLASH_SLOTS; index += 1) show.splash(index, index, 1);
        for (let index = 0; index < SAKURA_HELIX_SLOTS; index += 1) show.helix(index, 1, index, -1, 1.2, 8);
        show.spirit(1.3);
        run(garden, 40, 40 + SAKURA_SPIRIT_FLIGHT + 0.3, { corona: 1.6, blizzard: 1, fever: 1 }, 1);
        expect(show.uGate.value).toBeGreaterThan(1);
        expect(show.uBlizzard.value).toBe(1);
        const pools = [show.splashData, show.helixData, show.helixLook, show.uSpirit.value];
        show.reset();
        // Nothing was allocated: the same arrays of the same rows.
        expect([show.splashData, show.helixData, show.helixLook, show.uSpirit.value]).toEqual(pools);
        [show.splashData, show.helixData, show.helixLook, show.uSpirit.value].forEach((pool, index) => {
            expect(pool).toBe(pools[index]);
        });
        expect(rows(show.splashData)).toEqual(Array.from({ length: SAKURA_SPLASH_SLOTS }, () => [0, 0, -1000, 0]));
        expect(rows(show.helixData)).toEqual(Array.from({ length: SAKURA_HELIX_SLOTS }, () => [0, 0, 0, -1000]));
        expect(show.uSpirit.value.toArray()).toEqual([-1000, 0]);
        expect(show.uGate.value).toBe(0);
        expect(show.uBlizzard.value).toBe(0);
        expect(show.arrived).toBe(true);
        const now = garden.light.uTime.value;
        expect(liveSplashes(show, now)).toEqual([]);
        expect(liveHelices(show, now)).toEqual([]);
        // And the next frame of a garden at rest keeps it so.
        run(garden, now, now + 1);
        expect(show.uGate.value).toBe(0);
        expect(show.uBlizzard.value).toBe(0);
        // The meshes are the same ones, still drawn (folded away).
        expect(show.group.children).toHaveLength(6);
        expect(show.group.children.every((mesh) => mesh.visible)).toBe(true);
    });

    it('stays finite and inside its ranges through a storm of launches, seeks and resets', () => {
        const garden = create();
        const { show, light } = garden;
        const random = seeded(4242);
        const arrivals = [];
        show.onArrive = (x, z, power) => arrivals.push([x, z, power]);
        let now = 0;
        let foxes = 0;
        for (let step = 0; step < 20000; step += 1) {
            const dice = random();
            if (dice < 0.86) now += STEP;
            else if (dice < 0.9) now += random() * 3;
            else if (dice < 0.93) now = Math.max(0, now - random() * 40);
            else if (dice < 0.94) now += 600;
            light.update(now, {
                gust: random(), level: random(), fever: random(), hush: random() < 0.1 ? 1 : 0,
            });
            const act = random();
            if (act < 0.2) show.splash((random() - 0.5) * 60, -random() * 60, random() * 1.4 - 0.2);
            else if (act < 0.3) {
                const [x, y, z] = [(random() - 0.5) * 20, random() * 2, -random() * 10];
                show.helix(x, y, z, random() - 0.5, random() * 2, random() * 12);
            } else if (act < 0.34 && show.spirit(random() * 2)) foxes += 1;
            else if (act < 0.345) show.reset();
            show.update(now, STEP, {
                blizzard: random() * 1.5 - 0.2,
                corona: random() * 2,
                fever: random(),
                motion: random() < 0.5 ? random() : 1,
            }, random() < 0.3 ? random() : 0);
            expect(show.uGate.value >= 0 && show.uGate.value <= 1.6, `uGate ${show.uGate.value} at step ${step}`)
                .toBe(true);
            expect(show.uBlizzard.value >= 0 && show.uBlizzard.value <= 1, `uBlizzard at step ${step}`).toBe(true);
            expect(Number.isFinite(show.uCarried.value), `uCarried at step ${step}`).toBe(true);
            if (step % 97 === 0) {
                expect(everyFinite(show.splashData) && everyFinite(show.helixData) && everyFinite(show.helixLook))
                    .toBe(true);
                expect(show.uSpirit.value.toArray().every(Number.isFinite)).toBe(true);
                expect(liveSplashes(show, now).length).toBeLessThanOrEqual(SAKURA_SPLASH_SLOTS);
                for (const slot of show.splashData) expect(slot.w >= 0 && slot.w <= 1).toBe(true);
                for (const look of show.helixLook) {
                    expect(look.x >= 0 && look.x <= 1.3 && Math.abs(look.y) === 1 && look.z >= 2).toBe(true);
                }
            }
        }
        // Star foxes set out and arrived; never more arrivals than set out, each through the gate.
        expect(foxes).toBeGreaterThan(20);
        expect(arrivals.length).toBeGreaterThan(5);
        expect(arrivals.length).toBeLessThanOrEqual(foxes);
        const gate = sakuraGatePlace();
        for (const [x, z, power] of arrivals) {
            expect([x, z]).toEqual([gate.x, gate.z]);
            expect(power >= 0.4 && power <= 1.3).toBe(true);
        }
    });
});

describe('Sakura showpieces: the gate and the star fox\'s way down', () => {
    it('finds the gate where the torii stands in the lake', () => {
        const gate = sakuraGatePlace();
        expect(gate.x).toBe(SAKURA_TORII.x);
        expect(gate.z).toBe(SAKURA_TORII.z);
        expect(gate.scale).toBe(SAKURA_TORII.scale);
        // It stands in open water: its foot is the lake's level, not the bed under it.
        expect(sakuraLand(gate.x, gate.z)).toBeLessThan(0);
        expect(sakuraTerrainHeight(gate.x, gate.z)).toBeLessThan(SAKURA_WATER_LEVEL);
        expect(gate.foot).toBe(SAKURA_WATER_LEVEL);
        expect(gate.top).toBeCloseTo(gate.foot + 7.6 * gate.scale, 9);
        expect(gate.top - gate.foot).toBeGreaterThan(6);
        expect(sakuraGatePlace()).toEqual(gate);
        expect(sakuraGatePlace()).not.toBe(gate);
        // The showpieces keep the same place.
        expect(create().show.gate).toEqual(gate);
    });

    it('leaves the Fox among the stars, far off and high, and ends inside the gate', () => {
        const path = sakuraSpiritPath();
        const gate = sakuraGatePlace();
        const eye = new THREE.Vector3(...SAKURA_VIEWS.landscape.position);
        for (const point of [path.from, path.over, path.to]) expect(point.toArray().every(Number.isFinite)).toBe(true);
        // From where the Fox is drawn in the sky, seen from where the garden is seen.
        const fox = SAKURA_CONSTELLATIONS.find((figure) => figure.name === 'The Fox');
        expect(fox).toBeTruthy();
        const toward = path.from.clone().sub(eye).normalize();
        const azimuth = THREE.MathUtils.radToDeg(Math.atan2(toward.x, -toward.z));
        const elevation = THREE.MathUtils.radToDeg(Math.asin(toward.y));
        expect(azimuth).toBeCloseTo(fox.at[0], 6);
        expect(elevation).toBeCloseTo(fox.at[1], 6);
        // Out in the sky: hundreds of metres off, far above the lake, beyond the gate.
        expect(path.from.distanceTo(eye)).toBeGreaterThan(400);
        expect(path.from.y).toBeGreaterThan(SAKURA_WATER_LEVEL + 100);
        expect(path.from.z).toBeLessThan(gate.z - 200);
        // Into the gate: between its posts, above the water, under its beam.
        expect(path.to.x).toBe(gate.x);
        expect(path.to.z).toBe(gate.z);
        expect(path.to.y).toBeGreaterThan(gate.foot + 1);
        expect(path.to.y).toBeLessThan(gate.top - 1);
        // It comes down all the way and nearer all the way, never through the water or the ground.
        let last = onPath(path, 0);
        for (let step = 1; step <= 200; step += 1) {
            const point = onPath(path, step / 200);
            expect(point.y, `t ${step / 200}`).toBeLessThan(last.y);
            expect(point.distanceTo(eye)).toBeLessThan(last.distanceTo(eye));
            expect(point.y).toBeGreaterThan(Math.max(SAKURA_WATER_LEVEL, sakuraTerrainHeight(point.x, point.z)) + 1);
            last = point;
        }
        expect(onPath(path, 0).distanceTo(path.from)).toBe(0);
        expect(onPath(path, 1).distanceTo(path.to)).toBeLessThan(1e-9);
        // The default eye is the landscape framing's; another eye moves the sky end, not the gate.
        const other = sakuraSpiritPath([10, 6, 30]);
        expect(other.to.equals(path.to)).toBe(true);
        expect(other.from.clone().sub(path.from).toArray()).toEqual([10, expect.closeTo(1.7, 9), 14]);
        expect(create().show.path.from.equals(path.from)).toBe(true);
    });

    it.each([
        ['16:9', 16 / 9], ['16:10', 16 / 10], ['21:9', 21 / 9],
    ])('flies in front of the eye, down the open sky left of the board, at %s', (_label, aspect) => {
        const camera = frameCamera(aspect);
        const path = sakuraSpiritPath();
        let inTheOpen = 0;
        const samples = 400;
        for (let step = 0; step <= samples; step += 1) {
            const seen = onScreen(camera, onPath(path, step / samples));
            // Every point of the curve is ahead of the eye, inside its range, and on the screen.
            expect(seen.depth, `t ${step / samples}`).toBeGreaterThan(50);
            expect(seen.depth).toBeLessThan(camera.far);
            expect(seen.x).toBeGreaterThan(0.02);
            expect(seen.y).toBeGreaterThan(0.02);
            expect(seen.y).toBeLessThan(0.6);
            // Never behind the board card: it stays left of the card's edge to the last.
            expect(seen.x, `t ${step / samples}`).toBeLessThan(SAKURA_DEFAULT_BOARD.x0);
            if (seen.x > 0.1 && seen.x < SAKURA_DEFAULT_BOARD.x0) inTheOpen += 1;
        }
        expect(inTheOpen / (samples + 1)).toBeGreaterThan(0.9);
        // It ends where the gate is seen.
        const gate = sakuraGatePlace();
        const end = onScreen(camera, onPath(path, 1));
        const foot = onScreen(camera, new THREE.Vector3(gate.x, gate.foot, gate.z));
        const top = onScreen(camera, new THREE.Vector3(gate.x, gate.top, gate.z));
        expect(end.x).toBeCloseTo(foot.x, 3);
        expect(end.y).toBeLessThan(foot.y);
        expect(end.y).toBeGreaterThan(top.y);
        // And it starts well up the sky, to come down through most of the frame's height.
        expect(onScreen(camera, onPath(path, 0)).y).toBeLessThan(0.2);
    });

    it('is still in front of the eye and mostly in frame in a 4:3 window and in portrait', () => {
        const path = sakuraSpiritPath();
        for (const aspect of [4 / 3, 0.75, 9 / 19.5]) {
            const camera = frameCamera(aspect);
            let inFrame = 0;
            for (let step = 0; step <= 200; step += 1) {
                const seen = onScreen(camera, onPath(path, step / 200));
                expect(seen.depth, `aspect ${aspect}`).toBeGreaterThan(50);
                if (seen.x > 0 && seen.x < 1 && seen.y > 0 && seen.y < 1) inFrame += 1;
            }
            expect(inFrame / 201, `aspect ${aspect}`).toBeGreaterThan(0.75);
        }
    });

    // Was a fault (fixed 2026-11-18): sakura-showpieces.js sakuraSpiritPath() (line 103, the swing ten degrees left of the
    // Fox) takes the star fox off the left edge of the screen in a narrow landscape window: the
    // landscape framing is used from an aspect of 0.85 up, and from there to about 1.1 the curve
    // is outside the frame for most of the flight (at 0.86: 6 % of it on screen; at 1.0: 48 %;
    // a window snapped to half a 16:9 monitor is 0.89). Reproduce: frame a camera with
    // sakuraViewFor(0.89) at that aspect, project the bezier of sakuraSpiritPath(): x < 0.
    it('is seen for most of its flight in the narrowest landscape windows too', () => {
        const shares = [0.86, 0.89, 1].map((aspect) => {
            const camera = frameCamera(aspect);
            // (The world lays the flight through the framing it is seen in: SakuraShowpieces.setView.)
            const view = sakuraViewFor(aspect);
            const path = sakuraSpiritPath(view.position, { view, aspect });
            let inFrame = 0;
            for (let step = 0; step <= 200; step += 1) {
                const seen = onScreen(camera, onPath(path, step / 200));
                if (seen.depth > 0 && seen.x > 0 && seen.x < 1 && seen.y > 0 && seen.y < 1) inFrame += 1;
            }
            return inFrame / 201;
        });
        for (const share of shares) expect(share).toBeGreaterThan(0.75);
    });
});
