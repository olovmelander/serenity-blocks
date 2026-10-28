/**
 * Golden Forest — the cranes: the Blender-made bird, its wingbeat and its flight.
 *
 * The model (scripts/blender/golden_forest/crane.py, in golden-forest-crane.glb): its frame, real
 * size, hinge weights and plumage, both levels of detail, and that no authored pose tears the skin.
 * The flight (golden-forest-crane-flight.js, three-free): how a tier's budget is shared, the beat
 * through every authored pose with the slow downstroke, a sky that is the same for the same clock,
 * birds that never jump, bank into their circles and are never smaller than the least size; the
 * kettle in the open sky right of the board most of the time and in the frame always; every skein
 * crossing the low sun; the startle. The material (golden-forest-birds.js) through three's WGSL
 * and GLSL node builders against a stub renderer, both draws.
 */
import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseGoldenForestCrane } from '../../src/themes/golden-forest/golden-forest-assets.js';
import { GoldenForestBirds } from '../../src/themes/golden-forest/golden-forest-birds.js';
import {
    CRANE_BEAT, CRANE_EYE, CRANE_MIN_SPAN_ANGLE, CRANE_NEAR_SPAN_ANGLE, CRANE_RIG, CRANE_SPAN, CRANE_STRIDE,
    CRANE_SUN, CRUISE_BEAT, CraneSky, HARD_BEAT, KETTLE, SKEIN, SOAR_POSE, craneFlockSizes, foldPoint, strokePhase,
    wingPose,
} from '../../src/themes/golden-forest/golden-forest-crane-flight.js';
import { GOLDEN_FOREST_VIEWS, goldenForestEye } from '../../src/themes/golden-forest/golden-forest-composition.js';
import { GOLDEN_FOREST_SUN_DIRECTION, GoldenForestLight } from '../../src/themes/golden-forest/golden-forest-light.js';
import { GOLDEN_FOREST_TIERS } from '../../src/themes/golden-forest/golden-forest-quality.js';

vi.setConfig({ testTimeout: 60_000 });

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const assetDirectory = new URL('../../src/themes/golden-forest/assets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('asset-manifest.json', assetDirectory), 'utf8'));
const record = manifest.assets.find((entry) => entry.kind === 'crane');

async function parseCraneGlb() {
    const bytes = readFileSync(new URL('golden-forest-crane.glb', assetDirectory));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

let crane = null;
beforeAll(async () => {
    crane = parseGoldenForestCrane(await parseCraneGlb());
});
afterAll(() => {
    crane?.near.dispose();
    crane?.far?.dispose();
});

/** Where bird i of the kettle (or the skein) is drawn at t: its 16 instance floats, or null. */
function poseOf(sky, kettle, i, t, startle = 0, eye = CRANE_EYE) {
    const out = new Float32Array(CRANE_STRIDE);
    const pose = wingPose(0, 0, 0, SOAR_POSE, {});
    return sky.place(out, 0, kettle, i, t, startle, pose, 1, eye) ? out : null;
}

/** The landscape lens as a projector to screen fractions (x right, y down) and its frame half-angles. */
function landscapeLens(aspect = 16 / 9) {
    const view = GOLDEN_FOREST_VIEWS.landscape;
    const eye = goldenForestEye(view);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.3, 3400);
    camera.position.set(...eye);
    camera.lookAt(...view.target);
    camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    return (p) => {
        v.set(p[0], p[1], p[2]).project(camera);
        return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, front: v.z < 1 };
    };
}

describe('the crane (Blender, golden-forest-crane.glb)', () => {
    it('is a common crane at real size, in the frame the stage folds it in, in two levels of detail', () => {
        expect(record.species).toMatch(/Grus grus/);
        expect(crane.rig).toEqual(record.rig);
        expect(CRANE_RIG).toEqual(record.rig);
        for (const geometry of [crane.near, crane.far]) {
            geometry.computeBoundingBox();
            const { min, max } = geometry.boundingBox;
            // x the bird's left (span 2.1-2.3 m), y up, z forward (bill to toes 1.4-1.7 m).
            expect(max.x - min.x).toBeGreaterThan(2.1);
            expect(max.x - min.x).toBeLessThan(2.3);
            expect(max.z - min.z).toBeGreaterThan(1.4);
            expect(max.z - min.z).toBeLessThan(1.7);
            expect(Math.abs(max.x + min.x)).toBeLessThan(1e-3);
            expect(max.y - min.y).toBeLessThan(0.25);
            // The bill points forward, the legs trail behind.
            expect(max.z).toBeGreaterThan(0.75);
            expect(min.z).toBeLessThan(-0.7);
        }
        const tris = (geometry) => geometry.index.count / 3;
        expect(tris(crane.near)).toBe(record.meshes.crane.triangles);
        expect(tris(crane.far)).toBe(record.meshes.crane_far.triangles);
        expect(tris(crane.near)).toBeLessThan(3000);
        expect(tris(crane.far)).toBeLessThan(tris(crane.near) * 0.6);
    });

    it('weights each vertex to its hinges (none on the body, the whole hand past the wrist)', () => {
        for (const geometry of [crane.near, crane.far]) {
            const position = geometry.getAttribute('position');
            const wing = geometry.getAttribute('_wing');
            const colour = geometry.getAttribute('color');
            for (let i = 0; i < position.count; i += 1) {
                const x = Math.abs(position.getX(i));
                const w = [wing.getX(i), wing.getY(i), wing.getZ(i), wing.getW(i)];
                w.forEach((value) => {
                    expect(value).toBeGreaterThanOrEqual(0);
                    expect(value).toBeLessThanOrEqual(1);
                });
                if (x < CRANE_RIG.armBand[0] - 1e-3) expect(w[0]).toBe(0);
                if (x > CRANE_RIG.handBandTrailing[1] + 1e-3) {
                    expect(w[0]).toBeCloseTo(1, 2);
                    expect(w[1]).toBeCloseTo(1, 2);
                }
                // A wing vertex is never part of the head and neck.
                if (w[0] > 0) expect(w[3]).toBe(0);
                // Plumage is scene-linear, the alpha the thin-feather share.
                for (const read of ['getX', 'getY', 'getZ', 'getW']) {
                    expect(colour[read](i)).toBeGreaterThanOrEqual(0);
                    expect(colour[read](i)).toBeLessThanOrEqual(1);
                }
            }
        }
    });

    it('folds into every authored pose without tearing the skin', () => {
        const position = crane.near.getAttribute('position');
        const wing = crane.near.getAttribute('_wing');
        const index = crane.near.index.array;
        const rest = [];
        const weights = [];
        for (let i = 0; i < position.count; i += 1) {
            rest.push([position.getX(i), position.getY(i), position.getZ(i)]);
            weights.push([wing.getX(i), wing.getY(i), wing.getZ(i)]);
        }
        const poses = Object.entries(CRANE_RIG.poses);
        expect(poses.map(([name]) => name).sort()).toEqual(['bottom', 'down', 'glide', 'hardBottom', 'hardDown', 'hardTop',
            'hardUp', 'rest', 'soar', 'top', 'up'].sort());
        const worst = {};
        for (const [name, pose] of poses) {
            worst[name] = 0;
            const folded = rest.map((p, i) => foldPoint(p, weights[i], pose));
            for (let k = 0; k < index.length; k += 3) {
                for (let e = 0; e < 3; e += 1) {
                    const a = index[k + e];
                    const b = index[k + ((e + 1) % 3)];
                    const before = Math.hypot(...rest[a].map((v, c) => v - rest[b][c]));
                    const after = Math.hypot(...folded[a].map((v, c) => v - folded[b][c]));
                    if (before > 1e-3) worst[name] = Math.max(worst[name], after / before, before / after);
                }
            }
        }
        // The skin bends, stretched or bunched (the trailing edge folds in behind the wrist on the
        // upstroke): under 1.6x in the cruise beat and soaring, under 2x in the startled stroke.
        for (const [name, ratio] of Object.entries(worst)) {
            expect(ratio, name).toBeLessThan(name.startsWith('hard') ? 2 : 1.6);
        }
        // The rest pose is the model as built.
        rest.forEach((p, i) => foldPoint(p, weights[i], CRANE_RIG.poses.rest).forEach((v, c) => expect(v).toBeCloseTo(p[c], 6)));
    });

    it('refuses a crane without its weights or its rig', async () => {
        const gltf = await parseCraneGlb();
        gltf.scene.userData.rig = null;
        expect(() => parseGoldenForestCrane(gltf)).toThrow('[GoldenForest] Crane is missing its rig.');
        const bare = await parseCraneGlb();
        bare.scene.children.forEach((child) => child.geometry?.deleteAttribute('_wing'));
        expect(() => parseGoldenForestCrane(bare)).toThrow('"_wing"');
    });
});

describe('the wingbeat', () => {
    it('runs through every authored pose, the downstroke taking the slow share of the beat', () => {
        // φ = 0 top, π/2 mid-down, π bottom, 3π/2 mid-up: find θ for each by bisection.
        const thetaAt = (phi) => {
            let lo = 0;
            let hi = TAU;
            for (let k = 0; k < 60; k += 1) {
                const mid = (lo + hi) / 2;
                if (strokePhase(mid) < phi) lo = mid;
                else hi = mid;
            }
            return lo;
        };
        const keys = ['lift', 'sweep', 'bend', 'fold', 'curl'];
        [['top', 0], ['down', Math.PI / 2], ['bottom', Math.PI], ['up', Math.PI * 1.5]].forEach(([name, phi]) => {
            const pose = wingPose(thetaAt(phi), 0, 1);
            keys.forEach((key) => expect(pose[key], `${name}.${key}`).toBeCloseTo(CRANE_RIG.poses[name][key], 5));
            const hard = wingPose(thetaAt(phi), 1, 1);
            const hardName = `hard${name[0].toUpperCase()}${name.slice(1)}`;
            keys.forEach((key) => expect(hard[key], `${hardName}.${key}`).toBeCloseTo(CRANE_RIG.poses[hardName][key], 5));
        });
        // Slow down, quick up: the bottom of the stroke falls at the rig's share of the beat.
        expect(thetaAt(Math.PI) / TAU).toBeCloseTo(CRANE_RIG.downstroke, 3);
        expect(CRANE_RIG.downstroke).toBeGreaterThan(0.55);
        for (let k = 1; k <= 360; k += 1) expect(strokePhase((k * TAU) / 360)).toBeGreaterThan(strokePhase(((k - 1) * TAU) / 360));
        // Still wings when not beating; a hard beat is the deeper one.
        const still = wingPose(1.3, 0, 0);
        keys.forEach((key) => expect(still[key]).toBeCloseTo(SOAR_POSE[key], 9));
        expect(still.heave).toBeCloseTo(0, 9);
        expect(HARD_BEAT.lift[1]).toBeGreaterThan(CRUISE_BEAT.lift[1]);
        expect(CRANE_BEAT.cruise).toBeGreaterThan(2);
        expect(CRANE_BEAT.cruise).toBeLessThan(2.8);
    });
});

describe('the flight', () => {
    it('shares every tier\'s budget between a skein of 3-21 and the kettle', () => {
        for (const [name, tier] of Object.entries(GOLDEN_FOREST_TIERS)) {
            const sizes = craneFlockSizes(tier.birds);
            expect(sizes.skein + sizes.kettle, name).toBe(tier.birds);
            if (tier.birds) {
                expect(sizes.skein).toBeGreaterThanOrEqual(3);
                expect(sizes.skein).toBeLessThanOrEqual(SKEIN.birds);
                expect(sizes.kettle).toBeGreaterThan(sizes.skein);
            }
            expect(new CraneSky(tier.birds).count).toBe(tier.birds);
        }
        expect(craneFlockSizes(0)).toEqual({ pool: 0, skein: 0, kettle: 0 });
    });

    it('keeps its eye and sun equal to the composition\'s and the light\'s', () => {
        const eye = goldenForestEye(GOLDEN_FOREST_VIEWS.landscape);
        CRANE_EYE.forEach((v, c) => expect(v).toBeCloseTo(eye[c], 1));
        const sun = GOLDEN_FOREST_SUN_DIRECTION;
        expect(Math.asin(sun.y) / DEG).toBeCloseTo(CRANE_SUN.elevation, 6);
        expect(Math.atan2(sun.x, -sun.z) / DEG).toBeCloseTo(CRANE_SUN.azimuth, 6);
    });

    it('draws the same sky for the same clock, and another for another seed', () => {
        const write = (seed) => {
            const sky = new CraneSky(84, seed);
            const near = new Float32Array(84 * CRANE_STRIDE);
            const far = new Float32Array(84 * CRANE_STRIDE);
            const counts = sky.write(30.5, 0.2, CRANE_EYE, near, far);
            return { counts, near, far };
        };
        const a = write(7);
        const b = write(7);
        expect(a.counts).toEqual(b.counts);
        expect(a.near).toEqual(b.near);
        expect(a.far).toEqual(b.far);
        expect(write(8).far).not.toEqual(a.far);
        [...a.near, ...a.far].forEach((v) => expect(Number.isFinite(v)).toBe(true));
    });

    it('moves every bird smoothly: no jump, no snap of heading or bank, at 60 fps for a long evening', () => {
        const sky = new CraneSky(84, 11);
        const dt = 1 / 60;
        const birds = [...sky.kettle.map((_, i) => [true, i]), ...sky.skein.map((_, i) => [false, i])];
        let worstStep = 0;
        let worstTurn = 0;
        let worstLean = 0;
        let worstBank = 0;
        for (const [kettle, i] of birds) {
            let last = null;
            for (let t = 0; t < 240; t += dt) {
                const now = poseOf(sky, kettle, i, t);
                if (now && last) {
                    worstStep = Math.max(worstStep, Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2]));
                    const cosTurn = now[4] * last[4] + now[5] * last[5] + now[6] * last[6];
                    worstTurn = Math.max(worstTurn, Math.acos(Math.min(1, cosTurn)));
                    const cosLean = now[8] * last[8] + now[9] * last[9] + now[10] * last[10];
                    worstLean = Math.max(worstLean, Math.acos(Math.min(1, cosLean)));
                }
                if (now) worstBank = Math.max(worstBank, Math.acos(Math.min(1, now[9] / Math.hypot(now[8], now[9], now[10]))));
                last = now;
            }
        }
        // Under 18 m/s, under 1.5° of heading and of lean a frame; never more than the steepest bank
        // (and the climb or descent on top of it).
        expect(worstStep).toBeLessThan(18 * dt);
        expect(worstTurn).toBeLessThan(1.5 * DEG);
        expect(worstLean).toBeLessThan(1.5 * DEG);
        expect(worstBank).toBeLessThan(0.9);
    });

    it('banks the kettle into its turn and keeps heading and up square', () => {
        const sky = new CraneSky(84, 3);
        let banked = 0;
        sky.kettle.forEach((bird, i) => {
            const p = poseOf(sky, true, i, 40);
            const fwd = [p[4], p[5], p[6]];
            const up = [p[8], p[9], p[10]];
            expect(Math.hypot(...fwd)).toBeCloseTo(1, 4);
            expect(Math.hypot(...up)).toBeCloseTo(1, 4);
            expect(fwd[0] * up[0] + fwd[1] * up[1] + fwd[2] * up[2]).toBeCloseTo(0, 4);
            // Circling anticlockwise seen from above, the centre is on the bird's left: up leans left.
            const left = [fwd[2], 0, -fwd[0]];
            if (up[0] * left[0] + up[2] * left[2] > 0.2) banked += 1;
        });
        expect(banked / sky.kettle.length).toBeGreaterThan(0.8);
    });

    it('draws a far bird no smaller than the least size, and gives the near mesh to the near birds', () => {
        const sky = new CraneSky(84, 5);
        const near = new Float32Array(84 * CRANE_STRIDE);
        const far = new Float32Array(84 * CRANE_STRIDE);
        // From the landscape eye the sky is far: all far meshes. From inside the kettle, near ones.
        const fromEye = sky.write(130, 0, CRANE_EYE, near, far);
        expect(fromEye.near).toBe(0);
        const inside = sky.kettleAt(0, 130, 0, [0, 0, 0]);
        const close = sky.write(130, 0, [inside[0] + 6, inside[1], inside[2]], near, far);
        expect(close.near).toBeGreaterThan(0);
        const check = (array, count, eye, nearOnes) => {
            for (let k = 0; k < count; k += 1) {
                const o = k * CRANE_STRIDE;
                const dist = Math.hypot(array[o] - eye[0], array[o + 1] - eye[1], array[o + 2] - eye[2]);
                const angle = (CRANE_SPAN * array[o + 3]) / dist;
                expect(angle).toBeGreaterThanOrEqual(CRANE_MIN_SPAN_ANGLE * 0.999);
                expect(array[o + 3]).toBeGreaterThanOrEqual(0.9);
                if (nearOnes) expect(angle).toBeGreaterThan(CRANE_NEAR_SPAN_ANGLE);
                else expect(angle).toBeLessThanOrEqual(CRANE_NEAR_SPAN_ANGLE);
            }
        };
        sky.write(130, 0, CRANE_EYE, near, far);
        check(far, fromEye.far, CRANE_EYE, false);
        const eye = [inside[0] + 6, inside[1], inside[2]];
        sky.write(130, 0, eye, near, far);
        check(near, close.near, eye, true);
        check(far, close.far, eye, false);
    });

    it('keeps the kettle in the frame, mostly over the open sky right of the board', () => {
        const lens = landscapeLens();
        let right = 0;
        let behind = 0;
        let samples = 0;
        for (let t = 0; t < KETTLE.period; t += 0.5) {
            const c = lens(CraneSky.kettleCentre(t));
            expect(c.front).toBe(true);
            expect(c.x).toBeGreaterThan(0.2);
            expect(c.x).toBeLessThan(0.85);
            // Over the far treetops and under the top of the frame.
            expect(c.y).toBeGreaterThan(0.08);
            expect(c.y).toBeLessThan(0.4);
            if (c.x > 0.62) right += 1;
            if (c.x > 0.385 && c.x < 0.615) behind += 1;
            samples += 1;
        }
        expect(right / samples).toBeGreaterThan(0.45);
        expect(behind / samples).toBeLessThan(0.3);
    });

    it('sends every skein across the low sun, and none between passes', () => {
        const sun = GOLDEN_FOREST_SUN_DIRECTION;
        for (const seed of [1, 2, 3, 0x6372]) {
            const sky = new CraneSky(84, seed);
            for (let pass = 0; pass < 6; pass += 1) {
                let nearest = Infinity;
                for (let t = pass * SKEIN.period; t < (pass + 1) * SKEIN.period; t += 0.25) {
                    for (let i = 0; i < sky.skein.length; i += 1) {
                        const p = sky.skeinAt(i, t - SKEIN.phase, [0, 0, 0]);
                        if (!p) continue;
                        const d = p.map((v, c) => v - CRANE_EYE[c]);
                        const cos = (d[0] * sun.x + d[1] * sun.y + d[2] * sun.z) / Math.hypot(...d);
                        nearest = Math.min(nearest, Math.acos(Math.min(1, cos)));
                    }
                }
                expect(nearest / DEG, `seed ${seed} pass ${pass}`).toBeLessThan(3);
            }
            // Long after a pass has flown out, the sky waits for the next one.
            expect(sky.skeinAt(0, SKEIN.period - 1 - SKEIN.phase)).toBeNull();
        }
    });

    it('bursts the kettle wide and lifts it when startled, and quickens the beat without a jump', () => {
        const sky = new CraneSky(84, 9);
        const centre = CraneSky.kettleCentre(50);
        const spread = (s) => sky.kettle.reduce((sum, _, i) => {
            const p = sky.kettleAt(i, 50, s, [0, 0, 0]);
            return sum + Math.hypot(p[0] - centre[0], p[2] - centre[2]);
        }, 0) / sky.kettle.length;
        const height = (s) => sky.kettle.reduce((sum, _, i) => sum + sky.kettleAt(i, 50, s, [0, 0, 0])[1], 0) / sky.kettle.length;
        expect(spread(1) / spread(0)).toBeGreaterThan(2);
        expect(height(1) - height(0)).toBeCloseTo(KETTLE.lift, 0);
        // The beat's phase gains on the clock only while startled.
        sky.advance(1, 0);
        expect(sky.boost).toBe(0);
        sky.advance(0.2, 1);
        expect(sky.boost).toBeCloseTo(0.2 * CRANE_BEAT.startled, 9);
        // A long hitch counts as a quarter of a second at most.
        sky.advance(3, 1);
        expect(sky.boost).toBeCloseTo(0.45 * CRANE_BEAT.startled, 9);
        sky.reset();
        expect(sky.boost).toBe(0);
        // Startled, every kettle bird beats (its wing leaves the soaring pose within a beat).
        const near = new Float32Array(84 * CRANE_STRIDE);
        const far = new Float32Array(84 * CRANE_STRIDE);
        const lifts = new Set();
        for (let t = 50; t < 50.5; t += 0.05) {
            const n = sky.write(t, 1, CRANE_EYE, near, far);
            for (let k = 0; k < n.far; k += 1) lifts.add(Math.round(far[k * CRANE_STRIDE + 11] * 100));
        }
        expect(Math.max(...lifts) / 100).toBeGreaterThan(CRANE_RIG.poses.top.lift);
    });
});

describe('the cranes\' material', () => {
    function stubRenderer() {
        return {
            contextNode: context(),
            lighting: { enabled: false },
            backend: {
                device: null,
                capabilities: { getUniformBufferLimit: () => 65536 },
                extensions: { has: () => false },
                utils: { getTextureSampleData: () => ({ samples: 1, primarySamples: 1, isMSAA: false }) },
                compatibilityMode: false,
            },
            getRenderTarget: () => null,
            getMRT: () => null,
            shadowMap: { enabled: false, type: 0 },
            capabilities: {},
            library: { fromMaterial: (m) => m },
            nodes: {},
            getOutputRenderTarget: () => null,
            currentColorSpace: 'srgb',
            outputColorSpace: 'srgb',
            toneMapping: 0,
            xr: { enabled: false },
            debug: { checkShaderErrors: false, diagnostics: { keywords: true } },
            getUniformBufferLimit: () => 65536,
            hasFeature: () => false,
            isOutputTarget: false,
            logarithmicDepthBuffer: false,
            reverseDepth: false,
            highPrecision: false,
        };
    }

    it('builds both draws through the WGSL and the GLSL node builders, quietly and within budget', () => {
        const tier = GOLDEN_FOREST_TIERS.High;
        const light = new GoldenForestLight({ tier, rng: () => 0.5 });
        const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 3400);
        camera.position.set(...CRANE_EYE);
        const birds = new GoldenForestBirds({
            light, tier, rng: () => 0.25, crane, camera,
        }).build();
        expect(birds.count).toBe(tier.birds);
        expect(birds.meshes.map((mesh) => mesh.name)).toEqual(['GoldenForestBirds', 'GoldenForestBirdsFar']);
        for (const mesh of birds.meshes) {
            for (const Builder of [THREE.WGSLNodeBuilder, THREE.GLSLNodeBuilder]) {
                const heard = [];
                const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 300));
                const warn = vi.spyOn(console, 'warn').mockImplementation(listen);
                const error = vi.spyOn(console, 'error').mockImplementation(listen);
                let shaders;
                try {
                    const builder = new Builder(mesh, stubRenderer());
                    builder.scene = new THREE.Scene();
                    builder.camera = camera;
                    builder.context.material = mesh.material;
                    builder.material = mesh.material;
                    builder.build();
                    shaders = { vertex: builder.vertexShader, fragment: builder.fragmentShader };
                } finally {
                    warn.mockRestore();
                    error.mockRestore();
                }
                expect(heard, `${mesh.name} ${Builder.name}`).toEqual([]);
                for (const stage of ['vertex', 'fragment']) {
                    expect(shaders[stage].length, stage).toBeGreaterThan(200);
                    expect(shaders[stage].length, stage).toBeLessThan(48 * 1024);
                    expect(shaders[stage]).not.toMatch(/\bNaN\b|\bInfinity\b/);
                }
                // The four per-bird vec4s and the hinge weights reach the vertex stage.
                expect(shaders.vertex).toMatch(/iCraneA/);
                expect(shaders.vertex).toMatch(/_wing/);
            }
        }
        birds.dispose();
        light.dispose();
    });

    it('holds the startle the world wears, calmed by Reduce motion, and goes without birds without a crane', () => {
        const tier = GOLDEN_FOREST_TIERS.Low;
        const light = new GoldenForestLight({ tier, rng: () => 0.5 });
        const birds = new GoldenForestBirds({ light, tier, crane }).build();
        birds.update({}, 1 / 60, { flock: 0.8, motion: 0.5 }, 12);
        expect(birds.uStartle.value).toBeCloseTo(0.4, 9);
        const drawn = birds.drawnCounts();
        expect(drawn.near + drawn.far).toBeGreaterThan(0);
        birds.reset();
        expect(birds.uStartle.value).toBe(0);
        birds.dispose();
        // The same random draws with or without the crane, so the rest of the world grows the same.
        const counted = (withCrane) => {
            let draws = 0;
            const rng = () => {
                draws += 1;
                return 0.5;
            };
            const built = new GoldenForestBirds({
                light, tier, rng, crane: withCrane ? crane : null,
            }).build();
            const result = { draws, count: built.count, meshes: built.meshes.length };
            built.dispose();
            return result;
        };
        expect(counted(true).draws).toBe(tier.birds * 2);
        expect(counted(false)).toEqual({ draws: tier.birds * 2, count: 0, meshes: 0 });
        light.dispose();
    });
});
