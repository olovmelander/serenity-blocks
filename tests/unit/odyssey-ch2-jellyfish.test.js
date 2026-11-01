/**
 * THE JELLYFISH (2026-11-01, docs/ODYSSEY_CH2_JELLYFISH_2026-11.md): a living drift in chapter 2's
 * open water. Each jelly hangs in its own place and drifts on its own slow loop by the clock alone
 * (odyssey-jellyfish-drift.js); one instanced draw beats and trails them (odyssey-jellyfish.js).
 *
 * - the beat: a fast contraction, a slow relaxation, a glide up the axis and a sink back;
 * - the material builds for WebGPU (WGSL) and the WebGL2 fallback (GLSL) without a word;
 * - the drift on the real rail camera (tests/unit/helpers/odyssey-camera-rig.js) over the climb
 *   at the drift's pace from eight clock phases: never empty water, a near one now and then,
 *   restraint (a few in frame, not a crowd), never over the orbs, clear of the eye, the rail,
 *   the big animals, the bed and the surface;
 * - the sea's rules: behind the 1->2 steam, and never switched off in view at the breach.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { float, uniform } from 'three/tsl';
import {
    JELLY_KINDS, OCEAN_JELLIES, jellyAt, jellyBeatS, jellyHang, jellyHome, jellySqueeze, jellySurge,
} from '../../src/rendering/odyssey/composition/odyssey-jellyfish-drift.js';
import { createOdysseyJellyfish } from '../../src/rendering/odyssey/world/odyssey-jellyfish.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import {
    steamQuenchDensity, steamQuenchSeamT,
} from '../../src/rendering/odyssey/composition/odyssey-steam-quench.js';
import {
    OCEAN_ROAM, roamAt, roamLane,
} from '../../src/rendering/odyssey/composition/odyssey-ocean-roam.js';
import { WHALE_PASS_PAIR } from '../../src/rendering/odyssey/composition/odyssey-whale-pass.js';
import {
    ODYSSEY_THROUGH_SURFACE, throughSurfaceShare,
} from '../../src/rendering/odyssey/composition/odyssey-through-surface.js';
import { createOdysseyWorld } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { unassignedReads } from './helpers/tsl-node-build.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

vi.setConfig({ testTimeout: 60_000 });

const canvas = {
    style: {},
    width: 1280,
    height: 720,
    addEventListener() {},
    removeEventListener() {},
    getContext() { return null; },
    setAttribute() {},
};
function stubRenderer(forceWebGL) {
    const renderer = new THREE.WebGPURenderer({ canvas, forceWebGL });
    renderer.hasFeature = () => false;
    renderer._initialized = true;
    renderer._bindings = { getSharedBindGroup: (group) => group };
    if (forceWebGL) renderer.backend.capabilities = { getUniformBufferLimit: () => 16384, getMaxAnisotropy: () => 1 };
    else renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
    return renderer;
}

afterEach(() => { vi.restoreAllMocks(); });

const SEA = 287.31;
const createJellies = () => createOdysseyJellyfish({
    uTime: uniform(0),
    uLife: uniform(1),
    seaLevel: SEA,
    haze: (c) => c.mul(float(0.9)),
    grade: (c) => c,
});

describe('a jelly beats: fast in, slow out, and glides on the stroke', () => {
    it('contracts in about a quarter of the beat and relaxes over the rest, smooth across beats', () => {
        expect(jellySqueeze(0)).toBeCloseTo(0, 6);
        expect(jellySqueeze(0.26)).toBeCloseTo(1, 6);
        expect(jellySqueeze(0.999)).toBeLessThan(0.01);
        // Relaxing is slower than contracting: half-way out takes longer than half-way in.
        const halfIn = [...Array(1000).keys()].map((i) => i / 1000).find((f) => jellySqueeze(f) >= 0.5);
        const halfOut = [...Array(1000).keys()].map((i) => i / 1000).find((f) => f > 0.26 && jellySqueeze(f) <= 0.5);
        expect(halfOut - 0.26).toBeGreaterThan(halfIn * 1.4);
    });

    it('glides most of its stroke early in the beat and keeps moving forward', () => {
        expect(jellySurge(0)).toBeCloseTo(0, 6);
        expect(jellySurge(1)).toBeCloseTo(1, 6);
        expect(jellySurge(0.4)).toBeGreaterThan(0.55);
        for (let f = 0; f < 1; f += 0.01) expect(jellySurge(f + 0.01)).toBeGreaterThanOrEqual(jellySurge(f));
    });

    it('bobs where it hangs: up its axis on each beat, back down between them', () => {
        OCEAN_JELLIES.forEach((j, i) => {
            const at = { x: 0, y: 0, z: 0 };
            const home = jellyHome(j);
            let lo = Infinity;
            let hi = -Infinity;
            for (let t = 0; t < 400; t += 0.37) {
                jellyAt(j, t, at);
                lo = Math.min(lo, at.y - home.y);
                hi = Math.max(hi, at.y - home.y);
                expect(Math.hypot(at.x - home.x, at.z - home.z), `jelly ${i}`).toBeLessThan(j.loop + 1e-6);
            }
            expect(hi - lo, `jelly ${i}`).toBeLessThan((2 * j.bob) + (j.r * JELLY_KINDS[j.kind].glide) + 1e-6);
        });
    });

    it('beats slower the bigger it is', () => {
        const moon = (r) => jellyBeatS({ ...OCEAN_JELLIES[0], kind: 0, r });
        expect(moon(1.6)).toBeGreaterThan(moon(0.8));
    });
});

describe('the jellies build for both backends', () => {
    const build = (mesh, forceWebGL) => {
        const scene = new THREE.Scene();
        scene.add(mesh);
        const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 6000);
        camera.position.set(-8, 150, 3);
        camera.updateMatrixWorld(true);
        mesh.updateMatrixWorld(true);
        const renderer = stubRenderer(forceWebGL);
        const heard = [];
        vi.spyOn(console, 'warn').mockImplementation((...a) => heard.push(a.join(' ')));
        vi.spyOn(console, 'error').mockImplementation((...a) => heard.push(a.join(' ')));
        const builder = renderer.backend.createNodeBuilder(mesh, renderer);
        builder.scene = scene;
        builder.material = mesh.material;
        builder.camera = camera;
        builder.context.material = mesh.material;
        builder.lightsNode = renderer.lighting.getNode(scene);
        builder.fogNode = null;
        builder.clippingContext = null;
        builder.build();
        expect(builder.fragmentShader.length).toBeGreaterThan(200);
        expect(builder.vertexShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
        expect(builder.fragmentShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
        if (!forceWebGL) {
            expect(unassignedReads(builder.vertexShader)).toEqual([]);
            expect(unassignedReads(builder.fragmentShader)).toEqual([]);
        }
        return { heard, vertex: builder.vertexShader, fragment: builder.fragmentShader };
    };

    [['WGSL', false], ['GLSL', true]].forEach(([label, forceWebGL]) => {
        it(`builds the drift (${label})`, () => {
            const said = [];
            vi.spyOn(console, 'warn').mockImplementation((...a) => said.push(a.join(' ')));
            vi.spyOn(console, 'error').mockImplementation((...a) => said.push(a.join(' ')));
            const jellies = createJellies();
            expect(said, 'while building the nodes').toEqual([]);
            vi.restoreAllMocks();
            const out = build(jellies.mesh, forceWebGL);
            expect(out.heard).toEqual([]);
            jellies.dispose();
        });
    });

    it('is one draw of one small mesh, under eight vertex buffers', () => {
        const jellies = createJellies();
        const { geometry } = jellies.mesh;
        expect(geometry.instanceCount).toBe(OCEAN_JELLIES.length);
        expect(Object.keys(geometry.attributes).length).toBeLessThanOrEqual(8);
        expect(geometry.getAttribute('position').count).toBeLessThan(1000);
        expect(jellies.mesh.material.transparent).toBe(true);
        expect(jellies.mesh.material.depthWrite).toBe(false);
        expect(jellies.mesh.material.depthNode).toBeTruthy();
        jellies.dispose();
    });
});

/**
 * THE DRIFT ON THE REAL CAMERA. The climb at Act I's idle drift (~4.1 u/s) from the 1->2
 * boundary to the breach, from eight clock phases (the clock is wherever the player's time has
 * put it), once the steam has mostly cleared. A jelly counts as seen when its bell is in frame,
 * at least ~8 px tall at 900 px (0.009 of the frame) and near enough to read through the water.
 */
describe("chapter 2's jellies drift where the climb sees them (real camera, the drift's pace)", () => {
    const rig = createOdysseyCameraRig();
    const [c1] = [rig.cp[1]];
    const breach = rig.parkOf(11);
    const DT = 0.2;
    const DRIFT = 4.1;
    const PATH_LENGTH = 2533;
    const PHASES = [0, 17, 33, 52, 71, 94, 117, 139];
    const SEEN = 0.009;
    const NEAR = 0.045;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(rig.camera.fov / 2));
    const pose = (p) => {
        const camera = rig.poseAt(p).clone();
        camera.aspect = 16 / 9;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        return camera;
    };
    const clearOfSteam = (p) => 1 - Math.min(1, 1.25 * steamQuenchDensity(steamQuenchSeamT(p, c1)));
    // The climb under the water, once the steam has mostly cleared.
    const drift = (() => {
        const out = [];
        for (let p = c1 + 0.004; p < 0.1347; p += (DRIFT / PATH_LENGTH) * DT) {
            if (clearOfSteam(p) < 0.6) continue;
            const orbs = rig.layout.levelPositions.filter((x) => x > p - 0.004 && x < p + 0.04)
                .map((x) => getOdysseyPathPointAt(x));
            const rail = [];
            for (let q = p; q < p + 0.03; q += 0.0005) rail.push(getOdysseyPathPointAt(q));
            out.push({
                p, camera: pose(p), orbs, rail,
            });
        }
        return out;
    })();
    const parks = [6, 8, 9, 10].map((id) => ({ id, camera: pose(rig.parkOf(id)) }));
    const at = (j, t) => {
        const v = jellyAt(j, t, { x: 0, y: 0, z: 0 });
        return new THREE.Vector3(v.x, v.y, v.z);
    };
    const onScreen = (camera, point, size) => {
        const forward = camera.getWorldDirection(new THREE.Vector3());
        const ahead = point.clone().sub(camera.position).dot(forward) > 0;
        const ndc = point.clone().project(camera);
        const d = point.distanceTo(camera.position);
        const length = size / (d * 2 * tanHalf);
        return {
            ndc, d, length, in: ahead && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95,
        };
    };
    // ...and near enough to read through the water: looking up into the light a jelly shows far
    // off (~135 u), looking along the water it is lost sooner (~85 u; the captures' measure).
    const reads = (camera, s, point) => s.d < 85 + (50 * Math.max(0, (point.y - camera.position.y) / s.d));
    const seenIn = (camera, t) => OCEAN_JELLIES.map((j) => {
        const point = at(j, t);
        const s = onScreen(camera, point, 2 * j.r);
        return { ...s, reads: reads(camera, s, point) };
    }).filter((s) => s.in && s.length > SEEN && s.reads);

    it('is never empty water along the climb, whatever the clock', () => {
        let frames = 0;
        let empty = 0;
        let pairs = 0;
        let near = 0;
        let total = 0;
        let most = 0;
        PHASES.forEach((t0) => drift.forEach((f, i) => {
            const seen = seenIn(f.camera, t0 + (i * DT));
            frames += 1;
            if (seen.length === 0) empty += 1;
            if (seen.length >= 2) pairs += 1;
            if (seen.some((s) => s.length > NEAR)) near += 1;
            total += seen.length;
            most = Math.max(most, seen.length);
        }));
        console.log('drift', {
            frames, empty, pairs: pairs / frames, near: near / frames, mean: total / frames, most,
        });
        // Something in the water in every frame, two or more almost always...
        expect(empty, 'frames with no jelly').toBe(0);
        expect(pairs / frames).toBeGreaterThan(0.9);
        // ...a near one (~40 px and up) for a good share of the climb...
        expect(near / frames).toBeGreaterThan(0.6);
        // ...and restraint: a handful in frame, never a crowd.
        expect(total / frames).toBeLessThan(6.5);
        expect(most).toBeLessThanOrEqual(9);
    });

    it('keeps a few in frame at the orbs the eye parks at', () => {
        parks.forEach(({ id, camera }) => {
            let few = 0;
            let n = 0;
            for (let t = 0; t < 300; t += 1) {
                n += 1;
                if (seenIn(camera, t).length >= (id === 10 ? 1 : 2)) few += 1;
            }
            console.log('park', id, few / n);
            expect(few / n, `orb ${id}`).toBeGreaterThan(0.9);
        });
    });

    it('never lies over the orbs or the rail ahead', () => {
        let shown = 0;
        let over = 0;
        PHASES.forEach((t0) => drift.forEach((f, i) => {
            const t = t0 + (i * DT);
            OCEAN_JELLIES.forEach((j) => {
                const s = onScreen(f.camera, at(j, t), 2 * j.r);
                if (!s.in || s.length < SEEN) return;
                shown += 1;
                // Its whole reach on screen (bell, strands and drift) as a disc.
                const reach = ((j.r * 1.3) + (jellyHang(j) * 0.6)) / (s.d * 2 * tanHalf);
                const hits = (pt, pad) => {
                    const o = onScreen(f.camera, pt, 1);
                    return o.in && o.d > s.d
                        && Math.hypot((o.ndc.x - s.ndc.x) * (16 / 9), o.ndc.y - s.ndc.y) < reach + pad;
                };
                if (f.orbs.some((o) => hits(o, 4.4 / (o.distanceTo(f.camera.position) * tanHalf)))) over += 1;
                else if (f.rail.some((q) => hits(q, 0))) over += 1;
            });
        }));
        console.log('over', { shown, over, share: over / shown });
        expect(shown).toBeGreaterThan(1000);
        expect(over / shown).toBeLessThan(0.01);
    });

    it('keeps clear of the eye, the rail, the orbs, the bed and the surface', () => {
        const eyes = [...drift.map((f) => f.camera.position), ...parks.map((k) => k.camera.position)];
        const rail = [];
        for (let p = c1; p < breach; p += 0.0005) rail.push(getOdysseyPathPointAt(p));
        const orbs = [6, 7, 8, 9, 10, 11].map((id) => getOdysseyPathPointAt(rig.layout.levelPositionsById[id]));
        const line = new THREE.Line3();
        const closest = new THREE.Vector3();
        const segment = (a, b) => (pt) => line.set(a, b).closestPointToPoint(pt, true, closest).distanceTo(pt);
        OCEAN_JELLIES.forEach((j, i) => {
            const k = JELLY_KINDS[j.kind];
            for (let t = 0; t < 300; t += 2.3) {
                const bell = at(j, t);
                const tip = bell.clone().setY(bell.y - jellyHang(j));
                const body = segment(tip, bell);
                expect(Math.min(...eyes.map(body)), `jelly ${i} from the eye`).toBeGreaterThan(Math.max(8, 3 * j.r));
                expect(Math.min(...rail.map(body)), `jelly ${i} from the rail`).toBeGreaterThan(j.r + 3);
                expect(Math.min(...orbs.map(body)), `jelly ${i} from the orbs`).toBeGreaterThan(10);
                expect(bell.y + (j.r * k.height), `jelly ${i} under the surface`).toBeLessThan(ODYSSEY_SEA_LEVEL - 1);
                expect(tip.y, `jelly ${i} over the bed`).toBeGreaterThan(odysseyWorldHeight(tip.x, tip.z) + 3);
            }
        });
    });

    it('keeps out of the big animals\' way and apart from each other', () => {
        const animals = [
            [OCEAN_ROAM.whaleShark, 46], [OCEAN_ROAM.manta, 24], [OCEAN_ROAM.whales, 58],
            [roamLane(OCEAN_ROAM.whales, WHALE_PASS_PAIR.calf), 26],
        ];
        for (let t = 0; t < 600; t += 1.5) {
            const jellies = OCEAN_JELLIES.map((j) => at(j, t));
            animals.forEach(([route, size]) => {
                const a = roamAt(route, t, { x: 0, y: 0, z: 0 });
                const animal = new THREE.Vector3(a.x, a.y, a.z);
                jellies.forEach((p, i) => {
                    expect(p.distanceTo(animal), `jelly ${i} at t=${t}`)
                        .toBeGreaterThan((size * 0.5) + OCEAN_JELLIES[i].r + 4);
                });
            });
            for (let a = 0; a < jellies.length; a += 1) {
                for (let b = a + 1; b < jellies.length; b += 1) {
                    expect(jellies[a].distanceTo(jellies[b]), `jellies ${a}/${b}`).toBeGreaterThan(6);
                }
            }
        }
    });

    /**
     * PASSED, NEVER SWITCHED OFF IN VIEW (the fish's and the manta's rule since 2026-10-31). The
     * glide from orb 10 to orb 11 carries the eye up through the surface. Over that glide, from
     * many clock phases and at two paces, the jellies are never switched off while one of them is
     * in frame and would still show through the surface.
     */
    it('carries the jellies through the breach until the climb has passed them', () => {
        const jellies = createJellies();
        const from = rig.parkOf(10);
        const to = rig.parkOf(11);
        let seenFromAbove = 0;
        for (let k = 0; k < 24; k += 1) {
            for (const glideS of [1, 3]) {
                const t0 = k * 13.7;
                let wasDrawn = false;
                for (let t = 0; t <= glideS + 2; t += 1 / 30) {
                    const p = from + ((to - from) * Math.min(1, t / glideS));
                    const camera = pose(p);
                    const eye = camera.position;
                    const drawn = eye.y < ODYSSEY_SEA_LEVEL || jellies.seenFromAbove(camera, t0 + t);
                    const showing = OCEAN_JELLIES.some((j) => {
                        const pt = at(j, t0 + t);
                        return rig.inFrame(camera, pt, 1.05)
                            && throughSurfaceShare(eye, pt, ODYSSEY_SEA_LEVEL) > ODYSSEY_THROUGH_SURFACE.floor * 2;
                    });
                    if (wasDrawn && !drawn) expect(showing, `switched off in view at p ${p.toFixed(4)}`).toBe(false);
                    if (drawn && showing && eye.y > ODYSSEY_SEA_LEVEL) seenFromAbove += 1;
                    wasDrawn = drawn;
                }
            }
        }
        console.log('seenFromAbove', seenFromAbove);
        // Some are still there under the surface once the eye has broken through it.
        expect(seenFromAbove).toBeGreaterThan(0);
        jellies.dispose();
    });
});

describe('the world draws them by the sea\'s rules', () => {
    const railSamples = Array.from({ length: 48 }, (_, i) => {
        const pt = getOdysseyPathPointAt(i / 47);
        return { x: pt.x, y: pt.y, z: pt.z };
    });
    const world = createOdysseyWorld({
        quality: 'low', forest: false, cloudField: false, railSamples,
    });
    const mesh = world.group.getObjectByName('odyssey-world-jellyfish');

    it('is one mesh of the world, behind the 1->2 steam and after the sea and the fish', () => {
        expect(mesh).toBeTruthy();
        expect(world.stats.jellyfish).toBe(OCEAN_JELLIES.length);
        expect(mesh.material.depthNode).toBeTruthy();
        expect(mesh.renderOrder).toBeGreaterThan(world.group.getObjectByName('odyssey-world-fish').renderOrder);
        // Drawn before the steam's shell (renderOrder 12), so the shell covers it.
        expect(mesh.renderOrder).toBeLessThan(12);
    });

    it('is there from the 1->2 boundary (behind the steam), never on the cavern side', () => {
        const rail = { x: -8, y: 150, z: 3 };
        world.setQuenchCarry(0.45);
        world.update(1, rail, 0.05, 130);
        expect(mesh.visible).toBe(false);
        world.setQuenchCarry(0.52);
        world.update(1.016, rail, 0.05, 130);
        expect(mesh.visible).toBe(true);
        world.update(1.03, rail, 0.05, 200);
        expect(mesh.visible).toBe(true);
    });
});
