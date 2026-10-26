/**
 * Verdant Hills — the flock, drawn (src/themes/verdant-hills/verdant-hills-sheep.js): the two models
 * on their skeletons, the table of bones the vertex stage skins by, and its shaders, built through
 * three's own node builders against a stub renderer (the WGSL of the WebGPU backend and the GLSL of
 * the WebGL2 fallback). No GPU: the harness is tests/unit/grainfields-shaders.test.js's.
 */
import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VerdantHillsFlock } from '../../src/themes/verdant-hills/verdant-hills-flock.js';
import { VerdantHillsLight } from '../../src/themes/verdant-hills/verdant-hills-light.js';
import { VERDANT_HILLS_TIERS } from '../../src/themes/verdant-hills/verdant-hills-quality.js';
import {
    EWE_BONES, LAMB_BONES, createSheepSpec,
} from '../../src/themes/verdant-hills/verdant-hills-sheep-rig.js';
import { VerdantHillsSheep, parseVerdantHillsSheep } from '../../src/themes/verdant-hills/verdant-hills-sheep.js';
import { seededRandom } from '../../src/utils/helpers.js';

vi.setConfig({ testTimeout: 60_000 });

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 48 * 1024;
const directory = new URL('../../src/themes/verdant-hills/assets/', import.meta.url);

async function model(file, bones, name) {
    const bytes = readFileSync(new URL(file, directory));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ), '');
    return parseVerdantHillsSheep(gltf, bones, name);
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
    } catch (thrown) {
        return [{ thrown }, heard];
    } finally {
        warn.mockRestore();
        error.mockRestore();
    }
}

/** A small flock on a flat meadow: two ewes, a lamb. */
const MEADOW = Object.freeze({ ground: () => 0, allowed: () => true, seen: () => true });
const ENTRIES = Object.freeze([
    {
        x: 0, z: 0, yaw: 0.4, scale: 1.15, group: 0, lamb: false, mother: -1, look: 0.2,
    },
    {
        x: 1.4, z: -0.6, yaw: 0.3, scale: 1.12, group: 0, lamb: true, mother: 0, look: 0.7,
    },
    {
        x: 4, z: 2, yaw: -0.2, scale: 1.2, group: 0, lamb: false, mother: -1, look: 0.5, black: true,
    },
]);

describe('Verdant Hills sheep: drawn', () => {
    let models;
    let light;
    let flock;
    let sheep;

    beforeAll(async () => {
        models = {
            ewe: await model('verdant-ewe.glb', EWE_BONES, 'ewe'),
            lamb: await model('verdant-lamb.glb', LAMB_BONES, 'lamb'),
        };
        light = new VerdantHillsLight({ tier: VERDANT_HILLS_TIERS.High, rng: seededRandom(5) });
        flock = new VerdantHillsFlock({
            entries: ENTRIES, land: MEADOW, seed: 3,
        });
        sheep = new VerdantHillsSheep({ light, models, flock }).build();
    });

    afterAll(() => {
        sheep?.dispose();
        models?.ewe.geometry.dispose();
        models?.lamb.geometry.dispose();
    });

    it('reads each model off its skeleton, and turns away one that is not on it', async () => {
        expect(models.ewe.triangles).toBeGreaterThan(1500);
        expect(models.lamb.triangles).toBeGreaterThan(1000);
        expect(Object.keys(models.ewe.geometry.attributes).sort())
            .toEqual(['_bones', '_weights', 'color', 'normal', 'position']);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await model('verdant-lamb.glb', EWE_BONES.map((bone, i) => (i === 3 ? ['throat', ...bone.slice(1)]
            : bone)), 'lamb')).toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it('draws the ewes in one draw and the lambs in another, and a shadow under every sheep', () => {
        const meshes = sheep.group.children;
        expect(meshes.map((mesh) => mesh.name)).toEqual(['VerdantHills ewes', 'VerdantHills lambs',
            'VerdantHills sheep shadows']);
        expect(meshes[0].geometry.instanceCount).toBe(2);
        expect(meshes[1].geometry.instanceCount).toBe(1);
        expect(meshes[2].geometry.instanceCount).toBe(3);
        expect(sheep.triangles).toBe(models.ewe.triangles * 2 + models.lamb.triangles);
        // Each instance knows its row of the table, and who it is (the black ewe among them).
        const looks = meshes[0].geometry.attributes.look.array;
        expect([looks[0], looks[4]]).toEqual([0, 2]);
        expect(looks[6]).toBe(1);
        expect(meshes[1].geometry.attributes.look.array[0]).toBe(1);
    });

    it('writes the bones each sheep is posed by: a vertex skinned from the table lands where the rig puts it', () => {
        run();
        const { data } = sheep;
        const ROW = EWE_BONES.length * 2 + 2;
        flock.sheep.forEach((s) => {
            const { head } = s.rig.index;
            const { nose } = s.rig.marks;
            // Skin the nose as the vertex stage does (the head bone alone).
            const o = (s.index * ROW + head * 2) * 4;
            const q = data.slice(o, o + 4);
            const t = data.slice(o + 4, o + 8);
            const turned = rotate(q, nose);
            const skinned = [turned[0] * t[3] + t[0], turned[1] * t[3] + t[1], turned[2] * t[3] + t[2]];
            // The rig's own answer, carried into the world by the sheep's heading, size and place.
            const local = s.rig.point(s.posture, 'head', nose);
            const h = s.heading;
            const want = [
                s.x + (local[0] * Math.cos(h) + local[2] * Math.sin(h)) * s.scale,
                s.y + s.lift - 0.02 * s.scale + local[1] * s.scale,
                s.z + (-local[0] * Math.sin(h) + local[2] * Math.cos(h)) * s.scale,
            ];
            for (let k = 0; k < 3; k++) expect(skinned[k]).toBeCloseTo(want[k], 4);
            // Every quaternion is a unit one with w ≥ 0, and every size the sheep's.
            for (let b = 0; b < EWE_BONES.length; b++) {
                const r = (s.index * ROW + b * 2) * 4;
                expect(Math.hypot(data[r], data[r + 1], data[r + 2], data[r + 3])).toBeCloseTo(1, 5);
                expect(data[r + 3]).toBeGreaterThanOrEqual(0);
                expect(data[r + 7]).toBeCloseTo(s.scale, 6);
            }
        });
        // (Sent to the GPU again after each write.)
        expect(sheep.table.version).toBeGreaterThan(1);
        expect(createSheepSpec()).toHaveLength(38);
    });

    it('builds every material for WebGPU and the WebGL2 fallback without a word', () => {
        for (const [backend, Builder] of BACKENDS) {
            sheep.group.children.forEach((mesh) => {
                const [built, heard] = listening(() => build(Builder, mesh, mesh.material));
                expect(built.thrown, `${backend} ${mesh.name}`).toBeUndefined();
                expect(heard, `${backend} ${mesh.name}`).toEqual([]);
                expect(built.vertex.length, `${backend} ${mesh.name}`).toBeLessThan(STAGE_BUDGET);
                expect(built.fragment.length, `${backend} ${mesh.name}`).toBeLessThan(STAGE_BUDGET);
                // The pose comes from the table by a plain fetch, on both backends.
                const fetch = backend === 'WGSL' ? /textureLoad\(/ : /texelFetch\(/;
                expect(built.vertex, `${backend} ${mesh.name}`).toMatch(fetch);
                expect(`${built.vertex}${built.fragment}`).not.toMatch(/\bNaN\b|Infinity/);
            });
        }
    });

    function run() {
        for (let i = 0; i < 120; i++) flock.step(1 / 60, {});
        sheep.update();
    }
});

/** Turn a vector by a unit quaternion. */
function rotate(q, v) {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
