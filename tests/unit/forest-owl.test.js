/**
 * Forest — the eagle owl: the model on disk (src/themes/forest/assets/owl.glb), its rig, its flights,
 * the limbs it sits on (grown into the elders, spruce-elder.glb and pine-elder.glb), its mind, the
 * reactions' cues it hears, and its shaders, built through three's own node builders against a stub
 * renderer (the WGSL of the WebGPU backend and the GLSL of the WebGL2 fallback). No GPU. The harness
 * is tests/unit/verdant-hills-sheep.test.js's.
 */
import { readFileSync } from 'node:fs';
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context, float } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FOREST_FEATURE_TREES, FOREST_VIEWS, forestEye } from '../../src/themes/forest/forest-composition.js';
import { ForestLight } from '../../src/themes/forest/forest-light.js';
import { FOREST_OWL_EYE, ForestOwl } from '../../src/themes/forest/forest-owl.js';
import {
    OWL_FLIGHT, planFlight, sampleFlight, strokeClock, wingbeat,
} from '../../src/themes/forest/forest-owl-flight.js';
import {
    OWL_GATES, OWL_GROUND, OWL_MOON_LOOP, OWL_TIMING, ForestOwlMind,
} from '../../src/themes/forest/forest-owl-mind.js';
import {
    FOREST_OWL_HOME, FOREST_OWL_LIMBS, FOREST_OWL_PERCHES, forestOwlLimb, forestOwlNeighbours, limbAt,
} from '../../src/themes/forest/forest-owl-perches.js';
import {
    OWL_BONES, OWL_BONE_INDEX, OWL_DRAWN_SCALE, OWL_PLAN, OWL_POSTURE, OWL_ROOT_HEIGHT, createOwlPose,
    owlFlightBody, poseOwl, qMirror, qMul, qRotate,
} from '../../src/themes/forest/forest-owl-rig.js';
import { forestTier } from '../../src/themes/forest/forest-quality.js';
import { ForestReactions } from '../../src/themes/forest/forest-reactions.js';
import { forestGroundHeight } from '../../src/themes/forest/forest-terrain.js';
import { seededRandom } from '../../src/utils/helpers.js';

vi.setConfig({ testTimeout: 90_000 });

const asset = new URL('../../src/themes/forest/assets/owl.glb', import.meta.url);
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STEP = 1 / 60;
const DEG = Math.PI / 180;

function readExtras() {
    const bytes = readFileSync(asset);
    const length = bytes.readUInt32LE(12);
    return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
}

/** An elder from the pack: its extras, its bark's positions (its own frame) and indices. */
function readTree(name) {
    const bytes = readFileSync(new URL(`../../src/themes/forest/assets/${name}.glb`, import.meta.url));
    const length = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
    const bin = bytes.subarray(20 + length + 8);
    const SIZE = { 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    // KHR_mesh_quantization: positions are normalised shorts, scaled and moved by their node.
    const read = (index, size) => {
        const acc = json.accessors[index];
        const bv = json.bufferViews[acc.bufferView];
        const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
        const bytesEach = SIZE[acc.componentType];
        const stride = bv.byteStride || size * bytesEach;
        const out = new Float64Array(acc.count * size);
        for (let i = 0; i < acc.count; i += 1) {
            for (let k = 0; k < size; k += 1) {
                const at = offset + i * stride + k * bytesEach;
                let v;
                if (acc.componentType === 5126) v = bin.readFloatLE(at);
                else if (acc.componentType === 5122) v = bin.readInt16LE(at) / (acc.normalized ? 32767 : 1);
                else if (acc.componentType === 5125) v = bin.readUInt32LE(at);
                else v = bin.readUInt16LE(at);
                out[i * size + k] = acc.normalized ? Math.max(-1, v) : v;
            }
        }
        return out;
    };
    const node = json.nodes.find((n) => n.name === 'bark');
    const bark = json.meshes[node.mesh].primitives[0];
    const positions = read(bark.attributes.POSITION, 3);
    const scale = node.scale || [1, 1, 1];
    const move = node.translation || [0, 0, 0];
    for (let i = 0; i < positions.length; i += 1) positions[i] = move[i % 3] + scale[i % 3] * positions[i];
    return {
        extras: json.scenes[json.scene || 0].extras,
        positions,
        indices: Uint32Array.from(read(bark.indices, 1)),
    };
}

/** Every tree that stands in the glade by design, as forest-trees.js `trunks()` hands them over (crowns too). */
const FEATURE_TREES = FOREST_FEATURE_TREES.map((tree) => {
    const { extras } = readTree(tree.asset);
    const y = forestGroundHeight(tree.x, tree.z) - 0.05;
    const c = Math.cos(tree.yaw || 0);
    const s = Math.sin(tree.yaw || 0);
    const k = tree.scale;
    return {
        asset: tree.asset,
        x: tree.x,
        z: tree.z,
        y,
        radius: extras.trunkRadius * k,
        height: extras.height * k,
        crown: {
            x: tree.x + (extras.crownCentre[0] * c + extras.crownCentre[2] * s) * k,
            y: y + extras.crownCentre[1] * k,
            z: tree.z + (-extras.crownCentre[0] * s + extras.crownCentre[2] * c) * k,
            rx: Math.max(extras.crownRadii[0], extras.crownRadii[2]) * k,
            ry: extras.crownRadii[1] * k,
        },
    };
});

/** The elders' trunks as the theme hands them to the owl (forest-trees.js `trunks()`). */
const ELDER_TRUNKS = ['spruce-elder', 'pine-elder'].map((name) => {
    const tree = FOREST_FEATURE_TREES.find((t) => t.asset === name);
    const { extras } = readTree(name);
    return {
        asset: name,
        x: tree.x,
        z: tree.z,
        y: forestGroundHeight(tree.x, tree.z) - 0.05,
        radius: extras.trunkRadius * tree.scale,
        height: extras.height * tree.scale,
    };
});

async function loadOwl() {
    const bytes = readFileSync(asset);
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

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

function build(Builder, object, material) {
    const builder = new Builder(object, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = material;
    builder.material = material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

function listening(fn) {
    const heard = [];
    const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 400));
    const warn = vi.spyOn(console, 'warn').mockImplementation(listen);
    const error = vi.spyOn(console, 'error').mockImplementation(listen);
    try {
        return [fn(), heard];
    } finally {
        warn.mockRestore();
        error.mockRestore();
    }
}

const angleBetween = (a, b) => {
    const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return 2 * Math.acos(Math.min(1, d)) / DEG;
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** The game's landscape view (16:9) with the default card and score panel: what the player sees. */
function gameSight() {
    const view = FOREST_VIEWS.landscape;
    const camera = new THREE.PerspectiveCamera(view.fov, 16 / 9, 0.3, 3400);
    camera.position.set(...forestEye(view));
    camera.lookAt(...view.target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const card = {
        x0: 0.4, x1: 0.6, y0: 0.115, y1: 0.885,
    };
    const panel = {
        x0: 0.622, x1: 0.772, y0: 0.188, y1: 0.493,
    };
    const over = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    const v = new THREE.Vector3();
    return (x, y, z, size) => {
        v.set(x, y, z).project(camera);
        if (v.z >= 1) return false;
        const sx = (v.x + 1) / 2;
        const sy = (1 - v.y) / 2;
        const d = camera.position.distanceTo(new THREE.Vector3(x, y, z));
        const h = size / (2 * d * Math.tan(25 * DEG));
        const w = (h * 9) / 16;
        const box = {
            x0: sx - w / 2, x1: sx + w / 2, y0: sy - h / 2, y1: sy + h / 2,
        };
        if (box.x0 < 0.015 || box.x1 > 0.985 || box.y0 < 0.015 || box.y1 > 0.985) return false;
        return !over(box, card) && !over(box, panel);
    };
}

/** The game's landscape frame (16:9): whether any of a thing `size` metres across is in it at all. */
function gameView() {
    const view = FOREST_VIEWS.landscape;
    const camera = new THREE.PerspectiveCamera(view.fov, 16 / 9, 0.3, 3400);
    camera.position.set(...forestEye(view));
    camera.lookAt(...view.target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const v = new THREE.Vector3();
    return (x, y, z, size) => {
        v.set(x, y, z).project(camera);
        if (v.z >= 1) return false;
        const sx = (v.x + 1) / 2;
        const sy = (1 - v.y) / 2;
        const d = camera.position.distanceTo(new THREE.Vector3(x, y, z));
        const h = size / (2 * d * Math.tan(25 * DEG));
        const w = (h * 9) / 16;
        return sx + w / 2 > -0.02 && sx - w / 2 < 1.02 && sy + h / 2 > -0.02 && sy - h / 2 < 1.02;
    };
}

/** A cue frame the mind hears: events pushed at times, newest by serial. */
function cueTape(events) {
    const cues = [];
    const frame = { owl: { serial: 0, cues } };
    let next = 0;
    return {
        frame,
        at(t) {
            while (next < events.length && t >= events[next][0]) {
                const serial = cues.length + 1;
                cues.push({
                    serial, kind: events[next][1], lines: 4, column: 0.5, row: 0.2, strength: 1,
                });
                frame.owl.serial = serial;
                next += 1;
            }
            return frame;
        },
    };
}

describe('Forest owl: the model on disk', () => {
    let gltf;
    let extras;
    beforeAll(async () => {
        gltf = await loadOwl();
        extras = readExtras().asset.extras;
    });

    it('is one skinned mesh on the rig the theme poses, bone for bone', () => {
        const meshes = [];
        gltf.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
        expect(meshes).toHaveLength(1);
        const [mesh] = meshes;
        // (The skin lists its joints in the armature's tree order; the theme finds them by name.)
        expect(mesh.skeleton.bones.map((b) => b.name).sort()).toEqual([...OWL_BONES].sort());
        expect(extras.bones).toEqual([...OWL_BONES]);
        // Every bone rests unturned: a rotation the theme sets reads in the owl's own frame.
        for (const bone of mesh.skeleton.bones) {
            const q = bone.quaternion;
            expect(Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z), bone.name).toBeLessThan(1e-4);
        }
        expect(mesh.geometry.index.count / 3).toBe(extras.triangles);
        expect(extras.triangles).toBeLessThan(24000);
    });

    it('is built on the plan the rig mirrors', () => {
        const { plan } = extras;
        expect(plan.posture).toBe(OWL_PLAN.posture);
        expect(plan.rootHeight).toBeCloseTo(OWL_PLAN.rootHeight, 6);
        ['elbow', 'wrist', 'tip'].forEach((k) => expect(plan[k]).toEqual(OWL_PLAN[k]));
        expect(plan.primaryAngle).toEqual(OWL_PLAN.primaryAngle);
        expect(plan.tertialAngle).toEqual(OWL_PLAN.tertialAngle);
        expect(plan.toeDirections).toEqual(OWL_PLAN.toeDirections);
        expect(plan.toeLengths).toEqual(OWL_PLAN.toeLengths);
        plan.eye.forEach((v, i) => expect(v).toBeCloseTo(FOREST_OWL_EYE.centre[i], 6));
    });

    it('stands its root over the perch and is the same on both sides', () => {
        gltf.scene.updateMatrixWorld(true);
        const at = (name) => new THREE.Vector3().setFromMatrixPosition(gltf.scene.getObjectByName(name).matrixWorld);
        expect(at('root').y).toBeCloseTo(OWL_ROOT_HEIGHT, 4);
        for (const name of OWL_BONES.filter((n) => /L(\d*|\d+[ab])$/.test(n))) {
            const right = name.replace(/L(\d*[ab]?)$/, 'R$1');
            const l = at(name);
            const r = at(right);
            expect(r.x, name).toBeCloseTo(-l.x, 4);
            expect(r.y, name).toBeCloseTo(l.y, 4);
            expect(r.z, name).toBeCloseTo(l.z, 4);
        }
    });

    it('carries a plumage code on every vertex and skin weights that add up', () => {
        let mesh;
        gltf.scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
        const { attributes } = mesh.geometry;
        ['position', 'normal', 'color', '_plumage', 'skinIndex', 'skinWeight'].forEach((k) => expect(attributes[k], k).toBeDefined());
        const code = attributes._plumage;
        const weights = attributes.skinWeight;
        const kinds = new Set();
        for (let i = 0; i < code.count; i += 1) {
            const kind = Math.round(code.getX(i) * 16);
            kinds.add(kind);
            const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
            expect(Math.abs(sum - 1)).toBeLessThan(0.01);
        }
        // Body, face, eyes, bill, talons, every kind of feather, the lids, the feet, the arm.
        expect([...kinds].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });
});

describe('Forest owl: the rig', () => {
    const wingStates = [
        { fold: 1 }, { fold: 0 }, { fold: 0.5 }, {
            fold: 0, dihedral: -28, sweep: -6, twist: -5, load: 1, fan: 1.08,
        }, {
            fold: 0, dihedral: 24, flex: 0.5, handTwist: 28, fan: 0.88,
        },
    ];

    it('writes a unit turn for every bone, whatever the pose', () => {
        const pose = createOwlPose();
        for (const state of wingStates) {
            pose.wings.forEach((w) => Object.assign(w, state));
            pose.head = [140, 40, -30];
            pose.legs.forEach((l) => Object.assign(l, { tuck: 0.5, reach: 0.5, spread: 0.5 }));
            const frame = poseOwl(pose);
            frame.rotations.forEach((q, i) => {
                expect(q.every(Number.isFinite), OWL_BONES[i]).toBe(true);
                expect(Math.hypot(...q), OWL_BONES[i]).toBeCloseTo(1, 6);
            });
        }
    });

    it('turns the right wing as the mirror of the left', () => {
        const pose = createOwlPose();
        for (const state of wingStates) {
            pose.wings.forEach((w) => Object.assign(w, state));
            const frame = poseOwl(pose);
            OWL_BONES.filter((n) => /^(humerus|ulna|hand|alula|primary|secondary|tertial)L/.test(n)).forEach((name) => {
                const right = name.replace('L', 'R');
                const l = frame.rotations[OWL_BONE_INDEX[name]];
                const r = frame.rotations[OWL_BONE_INDEX[right]];
                const m = qMirror(l);
                expect(angleBetween(m, r), name).toBeLessThan(1e-4);
            });
        }
    });

    it('folds and unfolds without a jump: every joint turns a little at a time', () => {
        const pose = createOwlPose();
        let last = null;
        for (let f = 0; f <= 1.0001; f += 0.02) {
            pose.wings.forEach((w) => Object.assign(w, { fold: f }));
            const rotations = poseOwl(pose).rotations.map((q) => q.slice());
            if (last) rotations.forEach((q, i) => expect(angleBetween(q, last[i]), OWL_BONES[i]).toBeLessThan(10));
            last = rotations;
        }
    });

    it('lays the folded flight feathers down the perched body', () => {
        const pose = createOwlPose();
        const frame = poseOwl(pose);
        const R = frame.rotations;
        const world = (chain) => chain.reduce((acc, name) => qMul(acc, R[OWL_BONE_INDEX[name]]), [0, 0, 0, 1]);
        // A primary's own direction at rest, in the owl's frame (the flight frame turned by the posture).
        const toOwl = (v) => qRotate([Math.sin(-OWL_POSTURE * DEG / 2), 0, 0, Math.cos(-OWL_POSTURE * DEG / 2)], v);
        OWL_PLAN.primaryAngle.forEach((angle, i) => {
            const rest = toOwl([Math.sin(angle * DEG), 0, -Math.cos(angle * DEG)]);
            const q = world(['root', 'chest', 'humerusL', 'ulnaL', 'handL', `primaryL${i + 1}`]);
            const d = qRotate(q, rest);
            // Down along the body (and a little back), not out from it.
            expect(d[1], `primary ${i + 1}`).toBeLessThan(-0.6);
            expect(Math.abs(d[0]), `primary ${i + 1}`).toBeLessThan(0.3);
        });
    });

    it('lays the body level for flight and upright on a perch', () => {
        const axis = [0, Math.sin(OWL_POSTURE * DEG), Math.cos(OWL_POSTURE * DEG)];
        const level = qRotate(owlFlightBody(0, 0, 0), axis);
        expect(level[1]).toBeCloseTo(0, 6);
        expect(level[2]).toBeCloseTo(1, 6);
        expect(angleBetween(owlFlightBody(0, OWL_POSTURE, 0), [0, 0, 0, 1])).toBeLessThan(1e-4);
        // A positive bank rolls it to its left: the left wing (+x) drops.
        const left = qRotate(owlFlightBody(0, 0, 30), [1, 0, 0]);
        expect(left[1]).toBeLessThan(-0.4);
    });
});

describe('Forest owl: flight', () => {
    it('beats with a long downstroke, and the beat closes on itself', () => {
        expect(strokeClock(0)).toBeCloseTo(0, 9);
        expect(strokeClock(0.56)).toBeCloseTo(0.5, 9);
        const w = {};
        const a = wingbeat(0.9999, 1, w);
        const wa = { ...w };
        const b = wingbeat(1.0, 1, w);
        Object.keys(wa).forEach((k) => expect(Math.abs(wa[k] - w[k]), k).toBeLessThan(0.05));
        expect(Math.abs(a.lift - b.lift)).toBeLessThan(1e-3);
        let lo = Infinity;
        let hi = -Infinity;
        for (let p = 0; p < 1; p += 0.01) {
            wingbeat(p, 1, w);
            lo = Math.min(lo, w.dihedral);
            hi = Math.max(hi, w.dihedral);
        }
        expect(hi).toBeGreaterThan(35);
        expect(lo).toBeLessThan(-15);
        // Gliding (no beat): the wings rest just above level.
        wingbeat(0.3, 0, w);
        expect(w.dihedral).toBeCloseTo(7, 6);
    });

    it('flies the moon loop smoothly from the limb and back to it', () => {
        const S = [FOREST_OWL_HOME.x, FOREST_OWL_HOME.y + 0.24, FOREST_OWL_HOME.z];
        const flight = planFlight([S, [S[0] - 0.4, S[1] - 0.55, S[2] - 1], ...OWL_MOON_LOOP, S], { cruise: 5.6 });
        expect(flight.duration).toBeGreaterThan(6);
        expect(flight.duration).toBeLessThan(16);
        const s = {};
        let last = null;
        for (let t = 0; t <= flight.duration; t += STEP) {
            sampleFlight(flight, t, s);
            expect([s.x, s.y, s.z, s.heading, s.bank, s.climb, s.amp, s.phase].every(Number.isFinite)).toBe(true);
            expect(Math.abs(s.bank)).toBeLessThanOrEqual(OWL_FLIGHT.bank + 1e-9);
            expect(s.amp).toBeGreaterThanOrEqual(0);
            expect(s.amp).toBeLessThanOrEqual(1);
            expect(s.speed).toBeGreaterThan(0.5);
            if (last) {
                expect(Math.abs(wrap(s.heading - last.heading)) / DEG).toBeLessThan(6);
                expect(Math.abs(s.bank - last.bank)).toBeLessThan(3);
                expect(Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z)).toBeLessThan(0.15);
            }
            last = { ...s };
        }
        expect(sampleFlight(flight, -1, {}).x).toBeCloseTo(S[0], 6);
        expect(sampleFlight(flight, flight.duration + 5, {}).z).toBeCloseTo(S[2], 6);
        // It slows to land.
        expect(sampleFlight(flight, flight.duration - 0.01, {}).speed).toBeLessThan(2);
    });
});

describe('Forest owl: where it sits', () => {
    it('perches on the top of its limbs, across them, facing the eye as well as each lets it', () => {
        for (const perch of FOREST_OWL_PERCHES) {
            expect([perch.x, perch.y, perch.z, perch.heading, perch.radius].every(Number.isFinite), perch.id).toBe(true);
            expect(perch.y, perch.id).toBeGreaterThan(forestGroundHeight(perch.x, perch.z) + 0.5);
            if (!perch.limb) continue;
            const at = limbAt(forestOwlLimb(perch.limb), perch.u);
            expect(perch.y, perch.id).toBeCloseTo(at.top, 6);
            expect(Math.abs(Math.abs(wrap(perch.heading - perch.run)) - Math.PI / 2), perch.id).toBeLessThan(1e-6);
            const toEye = Math.atan2(0 - perch.x, 13 - perch.z);
            const other = wrap(perch.heading + Math.PI);
            expect(Math.abs(wrap(perch.heading - toEye)), perch.id)
                .toBeLessThanOrEqual(Math.abs(wrap(other - toEye)) + 1e-9);
            // Out from the bark, with room for its body beside the trunk.
            expect(perch.clear, perch.id).toBeGreaterThan(0.4);
        }
        expect(FOREST_OWL_HOME.id).toBe('limb');
        // Places along its home limb to sidle between, and more than a handful of perches in all.
        expect(forestOwlNeighbours(FOREST_OWL_HOME).map((p) => p.id).sort()).toEqual(['limbIn', 'limbOut']);
        expect(FOREST_OWL_PERCHES.length).toBeGreaterThanOrEqual(11);
        expect(new Set(FOREST_OWL_PERCHES.map((p) => p.id)).size).toBe(FOREST_OWL_PERCHES.length);
    });

    it('is seen whole in the game at 16:9 on its home limb and nearly every other perch', () => {
        const sight = gameSight();
        const seen = FOREST_OWL_PERCHES.filter((perch) => sight(perch.x, perch.y + 0.24 * OWL_DRAWN_SCALE, perch.z, 0.9));
        ['limbIn', 'limb', 'limbOut', 'lowIn', 'low', 'log', 'stump'].forEach((id) => {
            expect(seen.map((p) => p.id), id).toContain(id);
        });
        expect(seen.length).toBeGreaterThanOrEqual(FOREST_OWL_PERCHES.length - 2);
    });

    it("sits on limbs grown into the elders: the trees' own bark, drawn on every tier", () => {
        for (const name of ['spruce-elder', 'pine-elder']) {
            const { extras, positions, indices } = readTree(name);
            const tree = FOREST_FEATURE_TREES.find((t) => t.asset === name);
            const y0 = forestGroundHeight(tree.x, tree.z) - 0.05;
            const c = Math.cos(tree.yaw);
            const s = Math.sin(tree.yaw);
            const world = (x, y, z) => [tree.x + (x * c + z * s) * tree.scale, y0 + y * tree.scale,
                tree.z + (-x * s + z * c) * tree.scale];
            // The module the perches read is the trees' own record, placed where the tree stands.
            const records = extras.owlLimbs;
            expect(records.length).toBeGreaterThan(1);
            records.forEach((record) => {
                const limb = forestOwlLimb(record.id);
                expect(limb.tree).toBe(name);
                expect(limb.stations.length).toBe(record.centres.length);
                [0, Math.floor(record.centres.length / 2), record.centres.length - 1].forEach((i) => {
                    const [x, y, z] = world(...record.centres[i]);
                    const st = limb.stations[i];
                    expect(Math.hypot(st[0] - x, st[1] - y, st[2] - z)).toBeLessThan(0.002);
                    expect(Math.abs(st[3] - (y0 + record.tops[i] * tree.scale))).toBeLessThan(0.002);
                });
            });
            // Every seat stands on bark (the highest bark under it is its top), and that bark is in the part of
            // the mesh every tier draws (the trunk, the roots and the owl's limbs come first).
            const core = new Set(indices.subarray(0, extras.barkCoreIndices));
            FOREST_OWL_PERCHES.filter((p) => p.tree === name).forEach((perch) => {
                let top = -Infinity;
                let drawn = true;
                for (let v = 0; v < positions.length / 3; v += 1) {
                    const [x, y, z] = world(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
                    if (Math.hypot(x - perch.x, z - perch.z) < 0.04 && Math.abs(y - perch.y) < 0.15) {
                        top = Math.max(top, y);
                        drawn = drawn && core.has(v);
                    }
                }
                expect(Math.abs(top - perch.y), perch.id).toBeLessThan(0.02);
                expect(drawn, perch.id).toBe(true);
            });
        }
    });
});

describe('Forest owl: its mind', () => {
    const groundHeight = forestGroundHeight;

    function live(seconds, {
        seed = 7919, events = [], motion = 1, sight = gameSight(), view = null, trees = ELDER_TRUNKS, each,
    } = {}) {
        const mind = new ForestOwlMind({ rng: seededRandom(seed), groundHeight });
        mind.setSight(sight);
        mind.setTrunks(trees);
        if (view) mind.setView(view);
        mind.setBoard({ x: -0.3, y: 2.3, z: 7 });
        const tape = cueTape(events);
        const steps = Math.round(seconds / STEP);
        for (let i = 1; i <= steps; i += 1) {
            mind.update(STEP, tape.at(i * STEP), { motion });
            each?.(mind, i * STEP);
        }
        return mind;
    }

    it('starts on its limb, still, its wings folded', () => {
        const mind = new ForestOwlMind({ rng: seededRandom(1), groundHeight });
        mind.update(STEP, {});
        expect(mind.mode).toBe('perched');
        expect(mind.perch).toBe(FOREST_OWL_HOME);
        expect(mind.place).toMatchObject({ x: FOREST_OWL_HOME.x, y: FOREST_OWL_HOME.y, z: FOREST_OWL_HOME.z });
        mind.pose.wings.forEach((w) => expect(w.fold).toBeGreaterThan(0.9));
    });

    it('flies out across the moon after four lines, and comes home', () => {
        const legs = [];
        let after = null;
        live(30, {
            events: [[5, 'quad']],
            each: (m) => {
                if (m.leg && legs[legs.length - 1] !== m.leg.style) legs.push(m.leg.style);
                if (legs.length === 1 && !m.leg && after === null) after = m.perch;
            },
        });
        expect(legs[0]).toBe('moon');
        expect(after).toBe(FOREST_OWL_HOME);
    });

    it('moves on to another perch it can be seen on for a level-up', () => {
        const visits = new Set();
        live(20, {
            seed: 11,
            events: [[3, 'level']],
            each: (m) => { if (m.mode === 'perched') visits.add(m.perch.id); },
        });
        expect(visits.size).toBeGreaterThan(1);
    });

    it('wanders the glade as it likes: many perches, sidles, turns, hops, hunts, and its acts', () => {
        const perches = new Set();
        const acts = new Set();
        const legs = new Set();
        const misses = new Set();
        for (const seed of [7919, 101, 5, 11, 23]) {
            live(600, {
                seed,
                events: [[100, 'level'], [300, 'level']],
                each: (m) => {
                    if (m.mode === 'perched') perches.add(m.perch.id);
                    if (m.act) acts.add(m.act.kind === 'stretch' ? `stretch:${m.act.variant}` : m.act.kind);
                    if (m.leg) legs.add(m.leg.style);
                    if (m.perch.kind === 'ground') misses.add(m.groundCatch ? 'catch' : 'miss');
                },
            });
        }
        expect(perches.size).toBeGreaterThanOrEqual(9);
        expect(perches.has('ground')).toBe(true);
        ['sidle', 'turn', 'preen', 'doze', 'tall'].forEach((kind) => expect(acts.has(kind), kind).toBe(true));
        expect([...acts].some((a) => a.startsWith('stretch'))).toBe(true);
        ['plain', 'hop', 'strike', 'climb'].forEach((style) => expect(legs.has(style), style).toBe(true));
        expect(misses).toEqual(new Set(['catch', 'miss']));
    });

    it('leaves the glade only out of frame, a while at a time, and comes back by other ways', () => {
        const view = gameView();
        let away = 0;
        let changes = 0;
        let seenChanging = 0;
        const exits = new Set();
        const entries = new Set();
        let last = 'perched';
        for (const seed of [7919, 101, 5]) {
            live(900, {
                seed,
                view,
                trees: FEATURE_TREES,
                events: [[200, 'level'], [500, 'quad']],
                each: (m) => {
                    if (m.mode === 'away') away += STEP;
                    if ((m.mode === 'away') !== (last === 'away')) {
                        changes += 1;
                        if (view(m.place.x, m.place.y + 0.24, m.place.z, 1.6)) seenChanging += 1;
                        if (m.mode === 'away') exits.add(m.perch.gate.id);
                    }
                    if (m.leg?.style === 'enter') entries.add(m.perch.gate.id);
                    last = m.mode;
                },
            });
        }
        expect(changes).toBeGreaterThanOrEqual(4);
        expect(seenChanging).toBe(0);
        // Away now and then, never most of the night.
        expect(away / 2700).toBeGreaterThan(0.04);
        expect(away / 2700).toBeLessThan(0.35);
        expect(exits.size + entries.size).toBeGreaterThanOrEqual(4);
        // Every gate is out of the 16:9 frame, and every way in is open air.
        OWL_GATES.forEach((g) => expect(view(g.at[0], g.at[1], g.at[2], 3), g.id).toBe(false));
    });

    it('flies its many ways clear of the trunks, the crowns, the floor and the eye', () => {
        const view = gameView();
        const kinds = new Set();
        let worstCrown = Infinity;
        let worstTrunk = Infinity;
        let worstEye = Infinity;
        for (const seed of [7919, 11, 23, 4242]) {
            live(900, {
                seed,
                view,
                trees: FEATURE_TREES,
                events: [[100, 'level'], [300, 'level']],
                each: (m) => {
                    if (m.leg?.kind) kinds.add(m.leg.kind);
                    if (m.mode !== 'flight') return;
                    const { x, z } = m.place;
                    const y = m.place.y + 0.24;
                    expect(y).toBeGreaterThan(groundHeight(x, z) + 0.1);
                    worstEye = Math.min(worstEye, Math.hypot(x, y - 2.2, z - 13));
                    if (!view(x, y, z, 1.6)) return;
                    FEATURE_TREES.forEach((t) => {
                        if (y < t.y + t.height) worstTrunk = Math.min(worstTrunk, Math.hypot(x - t.x, z - t.z) - t.radius);
                        const c = t.crown;
                        worstCrown = Math.min(worstCrown, ((x - c.x) ** 2 + (z - c.z) ** 2) / c.rx ** 2 + ((y - c.y) / c.ry) ** 2);
                    });
                },
            });
        }
        ['direct', 'meander', 'patrol', 'overshoot', 'circle'].forEach((kind) => expect(kinds.has(kind), kind).toBe(true));
        // In frame: never inside the heart of a crown, a body's width from the bark; never close to the eye.
        expect(worstCrown).toBeGreaterThan(0.7);
        expect(worstTrunk).toBeGreaterThan(0.2);
        expect(worstEye).toBeGreaterThan(4);
    });

    it('has spells of restlessness and of stillness, and the game stirs it', () => {
        let low = 1;
        let high = 0;
        const mind = live(1800, {
            seed: 23,
            each: (m) => {
                low = Math.min(low, m.restless);
                high = Math.max(high, m.restless);
            },
        });
        expect(low).toBeLessThan(0.3);
        expect(high).toBeGreaterThan(0.7);
        const before = mind.restless;
        mind.react({ kind: 'quad', serial: 1, lines: 4 });
        expect(mind.restless).toBeGreaterThan(before);
        mind.react({ kind: 'over', serial: 2 });
        expect(mind.restless).toBeLessThanOrEqual(0.15);
    });

    it('misses now and then: it stands in the ferns, looks about and flies up to a perch', () => {
        const mind = new ForestOwlMind({ rng: seededRandom(3), groundHeight });
        mind.setSight(gameSight());
        mind.setTrunks(ELDER_TRUNKS);
        mind.hold(true);
        mind.update(STEP, {});
        expect(mind.send('miss')).toBe(true);
        let landed = null;
        let stood = false;
        let up = null;
        let caught = null;
        for (let t = 0; t < 30 && !up; t += STEP) {
            mind.update(STEP, {});
            if (mind.mode === 'perched' && mind.perch.kind === 'ground') {
                if (landed === null) landed = mind.time;
                caught = mind.groundCatch;
                // Mantled for a moment as it strikes, then the wings folded away as it stands.
                if (mind.time - landed > 1.3) stood = stood || mind.pose.wings.every((w) => w.fold > 0.9);
            }
            if (landed !== null && mind.mode === 'perched' && mind.perch.kind !== 'ground') up = mind.perch;
        }
        expect(landed).not.toBeNull();
        expect(caught).toBe(false);
        expect(stood).toBe(true);
        expect(up).not.toBeNull();
    });

    it('hops round to face the other way, and sidles along its limb to another place on it', () => {
        const mind = new ForestOwlMind({ rng: seededRandom(4), groundHeight });
        mind.hold(true);
        mind.update(STEP, {});
        expect(mind.send('turn')).toBe(true);
        for (let i = 0; i < 90; i += 1) mind.update(STEP, {});
        expect(mind.turned).toBe(true);
        expect(Math.abs(wrap(mind.attitude.heading - FOREST_OWL_HOME.heading - Math.PI))).toBeLessThan(0.05);
        expect(mind.send('sidle', 'limbOut')).toBe(true);
        for (let i = 0; i < 6 * 60 && mind.act; i += 1) mind.update(STEP, {});
        mind.update(STEP, {});
        expect(mind.perch.id).toBe('limbOut');
        expect(mind.place.x).toBeCloseTo(mind.perch.x, 6);
        expect(mind.place.y).toBeCloseTo(mind.perch.y, 6);
        // Still facing away along the way it was turned.
        expect(Math.abs(wrap(mind.attitude.heading - mind.perch.heading - Math.PI))).toBeLessThan(0.05);
    });

    it.each([['stretch', 'wingLeg'], ['stretch', 'wingsUp'], ['preen', 'left'], ['preen', 'breast'], ['doze', null],
        ['tall', null], ['turn', null]])('%s (%s) comes and goes on its perch without a jump', (kind, variant) => {
        const mind = new ForestOwlMind({ rng: seededRandom(6), groundHeight });
        mind.hold(true);
        mind.update(STEP, {});
        expect(mind.send(kind, variant)).toBe(true);
        const frame = poseOwl(mind.pose);
        let previous = frame.rotations.map((q) => q.slice());
        let worst = 0;
        let worstBone = '';
        for (let i = 0; i < 30 * 60 && (mind.act || i < 10); i += 1) {
            mind.update(STEP, {});
            poseOwl(mind.pose, frame);
            frame.rotations.forEach((q, j) => {
                expect(q.every(Number.isFinite)).toBe(true);
                const turn = angleBetween(q, previous[j]);
                // Eyelids blink shut in a few frames; every other joint moves a little at a time.
                if (turn > worst && !OWL_BONES[j].startsWith('lid')) {
                    worst = turn;
                    worstBone = OWL_BONES[j];
                }
            });
            previous = frame.rotations.map((q) => q.slice());
        }
        expect(mind.act).toBeNull();
        expect(worst, worstBone).toBeLessThan(12);
        mind.pose.wings.forEach((w) => expect(w.fold).toBeGreaterThan(0.9));
    });

    it('never goes where the player cannot see it land', () => {
        const refused = new Set(['log', 'stump']);
        const base = gameSight();
        const sight = (x, y, z, size) => !FOREST_OWL_PERCHES.some((p) => refused.has(p.id)
            && Math.hypot(p.x - x, p.z - z) < 0.5) && base(x, y, z, size);
        const visited = new Set();
        live(600, {
            sight,
            events: [[20, 'level'], [120, 'level'], [240, 'level'], [400, 'level']],
            each: (m) => { if (m.mode === 'perched') visited.add(m.perch.id); },
        });
        refused.forEach((id) => expect(visited.has(id), id).toBe(false));
    });

    it('stays home under reduced motion', () => {
        let left = false;
        live(400, {
            motion: 0.35,
            events: [[10, 'quad'], [60, 'level'], [120, 'perfect']],
            each: (m) => { if (m.mode !== 'perched') left = true; },
        });
        expect(left).toBe(false);
    });

    it('dozes when the run ends and wakes with the next', () => {
        const mind = live(5, { events: [[1, 'over']] });
        expect(mind.drowsy).toBeGreaterThan(0.5);
        expect(mind.pose.blink[0]).toBeGreaterThan(0.25);
    });

    it('lives a night without a jump, a NaN or a dive through the floor or a trunk', () => {
        let last = null;
        const worst = {
            place: 0, heading: 0, pitch: 0, bank: 0, head: 0,
        };
        let flights = 0;
        live(900, {
            seed: 4242,
            events: [[30, 'quad'], [100, 'level'], [160, 'quad'], [230, 'level'], [300, 'drop'], [420, 'perfect'],
                [500, 'level'], [600, 'over'], [700, 'clear']],
            each: (m) => {
                const { place, attitude, pose } = m;
                const values = [place.x, place.y, place.z, attitude.heading, attitude.pitch, attitude.bank, ...pose.head,
                    ...pose.body, ...pose.blink, pose.tufts];
                expect(values.every(Number.isFinite)).toBe(true);
                expect(place.y).toBeGreaterThan(groundHeight(place.x, place.z) - 0.2);
                // A body's width (and more) from the elders' bark whenever it flies.
                if (m.mode === 'flight') {
                    for (const tree of ELDER_TRUNKS) {
                        expect(Math.hypot(place.x - tree.x, place.z - tree.z) - tree.radius).toBeGreaterThan(0.2);
                    }
                }
                // (Coming back from out of the glade it starts again at another gate, unseen.)
                if (last && last.mode !== 'away' && m.mode !== 'away') {
                    worst.place = Math.max(worst.place, Math.hypot(place.x - last.x, place.y - last.y, place.z - last.z));
                    worst.heading = Math.max(worst.heading, Math.abs(wrap(attitude.heading - last.heading)) / DEG);
                    worst.pitch = Math.max(worst.pitch, Math.abs(attitude.pitch - last.pitch));
                    worst.bank = Math.max(worst.bank, Math.abs(attitude.bank - last.bank));
                    worst.head = Math.max(worst.head, ...pose.head.map((v, i) => Math.abs(v - last.head[i])));
                    if (m.mode === 'flight' && last.mode !== 'flight') flights += 1;
                }
                last = {
                    x: place.x, y: place.y, z: place.z, heading: attitude.heading, pitch: attitude.pitch,
                    bank: attitude.bank, head: pose.head.slice(), mode: m.mode,
                };
            },
        });
        expect(flights).toBeGreaterThan(8);
        // Per frame at 60 fps: an owl's quickest movements (the hop round on a perch turns it 12), never a snap.
        expect(worst.place).toBeLessThan(0.16);
        expect(worst.heading).toBeLessThan(13);
        expect(worst.pitch).toBeLessThan(5);
        expect(worst.bank).toBeLessThan(5);
        expect(worst.head).toBeLessThan(30);
    });

    it('lives the same night at any frame rate', () => {
        const at = (fps) => {
            const mind = new ForestOwlMind({ rng: seededRandom(7919), groundHeight });
            const tape = cueTape([[30, 'quad'], [100, 'level']]);
            const out = [];
            const checks = [20, 35, 45, 105, 140];
            let c = 0;
            for (let i = 1; i <= 141 * fps; i += 1) {
                const t = i / fps;
                mind.update(1 / fps, tape.at(t));
                if (c < checks.length && t >= checks[c] - 1e-9) {
                    out.push({ mode: mind.mode, perch: mind.perch.id, place: { ...mind.place } });
                    c += 1;
                }
            }
            return out;
        };
        const reference = at(60);
        for (const fps of [30, 144]) {
            at(fps).forEach((s, i) => {
                expect(s.mode).toBe(reference[i].mode);
                expect(s.perch).toBe(reference[i].perch);
                expect(Math.hypot(s.place.x - reference[i].place.x, s.place.y - reference[i].place.y,
                    s.place.z - reference[i].place.z)).toBeLessThan(0.2);
            });
        }
    });

    it('stoops only to open ground it can be seen on, a short glide from its perch', () => {
        const sight = gameSight();
        OWL_GROUND.forEach((g) => {
            expect(sight(g.x, forestGroundHeight(g.x, g.z) + 0.3, g.z, 0.7), `${g.x},${g.z}`).toBe(true);
            // Clear of the trunks that stand in the glade.
            FOREST_FEATURE_TREES.forEach((t) => expect(Math.hypot(g.x - t.x, g.z - t.z), `${g.x},${g.z}`).toBeGreaterThan(1.5));
        });
        expect(OWL_TIMING.launch).toBeGreaterThan(0.3);
    });
});

describe('Forest owl: the reactions\' cues', () => {
    it('numbers every event it hears and forgets them with a new session', () => {
        const reactions = new ForestReactions({ quality: 'High', rng: seededRandom(3) });
        expect(reactions.getFrame().owl.serial).toBe(0);
        reactions.onHardDrop({ distance: 16 });
        reactions.onPieceLock({ piece: { x: 3, y: 20, shape: [[1]] } });
        reactions.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        const { owl } = reactions.getFrame();
        expect(owl.serial).toBe(2);
        const kinds = owl.cues.filter((c) => c.serial > 0).sort((a, b) => a.serial - b.serial).map((c) => c.kind);
        expect(kinds).toEqual(['drop', 'quad']);
        reactions.onGameOver();
        reactions.onGameOver();
        expect(reactions.getFrame().owl.serial).toBe(3);
        reactions.reset();
        expect(reactions.getFrame().owl.serial).toBe(0);
    });
});

describe('Forest owl: drawn', () => {
    let owl;
    let light;
    beforeAll(async () => {
        const gltf = await loadOwl();
        light = new ForestLight({ tier: forestTier('High'), rng: seededRandom(5) });
        // The moon's shadow lookup is the light rig's (it needs a renderer with shadow maps, which the
        // stub is not): a constant stands in for it, so what is checked here is the owl's own graph.
        light.shadowNode = float(1);
        owl = new ForestOwl({ light, gltf }).build();
    });

    it('maps every bone and poses the skeleton it was given', () => {
        expect(owl.stats.owlBones).toBe(OWL_BONES.length);
        const mind = new ForestOwlMind({ rng: seededRandom(2), groundHeight: forestGroundHeight });
        mind.update(STEP, {});
        owl.apply(mind.place, mind.pose);
        expect(owl.pivot.position.x).toBeCloseTo(FOREST_OWL_HOME.x, 6);
        expect(owl.pivot.scale.x).toBeCloseTo(OWL_DRAWN_SCALE, 6);
        owl.bones.forEach((bone) => expect([bone.quaternion.x, bone.quaternion.w].every(Number.isFinite)).toBe(true));
    });

    it.each(BACKENDS)('builds its plumage for %s without a word', (_name, Builder) => {
        for (const [object, material] of [[owl.body, owl.material]]) {
            const [out, heard] = listening(() => build(Builder, object, material));
            expect(heard).toEqual([]);
            expect(out.fragment.length).toBeGreaterThan(2000);
            expect(out.fragment.length).toBeLessThan(96 * 1024);
            for (const stage of [out.vertex, out.fragment]) {
                expect(stage).not.toMatch(/\bNaN\b|\bInfinity\b|\[object Object\]/);
            }
        }
    });
});
