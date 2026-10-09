/**
 * Winter shader gate — no GPU needed.
 *
 * Every part's material is built through three's own node builders against a stub renderer: the
 * WGSL one the WebGPU backend uses and the GLSL one of the WebGL2 fallback, at the richest tier
 * the theme defaults to and at the leanest. A graph that one builder cannot turn into a shader
 * (a conditional the GLSL builder has no stack for, a helper that reads a uniform it was never
 * handed) throws or warns here instead of leaving a part undrawn on someone's machine.
 *
 * The fox and the fox of light are built on the theme's own model (a skinned mesh with painted
 * vertices and no textures to decode), handed over at once instead of fetched.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, the driver), so a shader the
 * browser rejects can still pass. The post stack's output pass is not built here either. The
 * harness is the one of tests/unit/himalayan-peak-shaders.test.js.
 */

import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WINTER_PARTS, WinterWorld } from '../../src/themes/winter/winter-world.js';
import { planGhosts } from '../../src/themes/winter/winter-ghosts.js';
import { createFox, createSpiritFox, spiritPath } from '../../src/themes/winter/winter-fox.js';
import { FOX_CLIPS, FoxMind } from '../../src/themes/winter/winter-fox-mind.js';
import { QUALITY } from '../../src/themes/winter/winter-quality.js';
import {
    FOX_SCALE, SPIRIT_RUN, bakeNoise, createNoiseTexture, createShadowTexture, createWinterUniforms, foxRound,
} from '../../src/themes/winter/winter-tsl.js';

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/**
 * The largest stage today is the ground's fragment at 29 KB of WGSL (High). A feature unrolled
 * in JS instead of looped shows up here as a module of 100 KB.
 */
const STAGE_BUDGET = 48 * 1024;

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

/** Both stages of a mesh's material as one backend would write them. */
function buildShaders(Builder, mesh) {
    const builder = new Builder(mesh, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = mesh.material;
    builder.material = mesh.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

/** The mesh a part draws (the trees' and the foxes' hang under a group). */
function drawable(part) {
    let found = null;
    part.mesh.traverse((object) => {
        if (!found && object.isMesh) found = object;
    });
    return found;
}

/** Every `w_*` function a WGSL stage defines: name → body. */
function helpers(wgsl) {
    return [...wgsl.matchAll(/^fn (w_\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm)]
        .map((m) => ({ name: m[1], body: m[2] }));
}

/** What a helper's body names that is neither an argument nor a local: uniforms, arrays, textures. */
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** The theme's own fox, parsed afresh (createFox takes the model over). */
async function readFox() {
    const file = readFileSync(new URL('../../src/themes/winter/assets/arctic-fox.glb', import.meta.url));
    return new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
}

describe.each(TIERS)('winter shaders at %s', (quality) => {
    let world;
    /** part → backend → { vertex, fragment } */
    const built = {};
    /** What three said while building, per part and backend. */
    const said = {};

    beforeAll(async () => {
        const gltf = await readFox();
        world = new WinterWorld({
            scene: new THREE.Scene(), quality, capture: true, ghosts: planGhosts(), fox: false,
        }).build();
        // The fox joins a running world when its model arrives; here it is handed over at once,
        // in the world's own order (the fox, then its like of light).
        world.parts.fox = createFox(world.u, gltf);
        world.parts.spirit = createSpiritFox(world.u, gltf);
        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        Object.keys(world.parts).forEach((name) => {
            built[name] = {};
            said[name] = {};
            BACKENDS.forEach(([label, Builder]) => {
                const heard = [];
                const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 400));
                warn.mockImplementation(listen);
                error.mockImplementation(listen);
                try {
                    built[name][label] = buildShaders(Builder, drawable(world.parts[name]));
                } catch (thrown) {
                    built[name][label] = { thrown };
                }
                said[name][label] = heard;
            });
        });
        warn.mockRestore();
        error.mockRestore();
    });

    afterAll(() => {
        world.parts.fox.dispose();
        world.parts.spirit.dispose();
        delete world.parts.fox;
        delete world.parts.spirit;
        world.dispose();
    });

    it('has a material to build for every part the tier draws', () => {
        const expected = WINTER_PARTS.filter((name) => name !== 'dust' || QUALITY[quality].dust > 0);
        expect(Object.keys(built).sort()).toEqual([...expected].sort());
        Object.keys(world.parts).forEach((name) => {
            const mesh = drawable(world.parts[name]);
            expect(mesh, name).toBeTruthy();
            expect(mesh.material.isNodeMaterial, name).toBe(true);
        });
        // The trees are instanced; the foxes are the real model: skinned, painted, with normals.
        expect(drawable(world.parts.trees).isInstancedMesh).toBe(true);
        for (const name of ['fox', 'spirit']) {
            const fox = drawable(world.parts[name]);
            expect(fox.isSkinnedMesh, name).toBe(true);
            const attributes = Object.keys(fox.geometry.attributes);
            const needed = ['position', 'normal', 'color', 'skinIndex', 'skinWeight', 'aTail'];
            expect(attributes, name).toEqual(expect.arrayContaining(needed));
            // Every attribute is its own vertex buffer on WebGPU, and a pipeline binds eight.
            expect(attributes.length, name).toBeLessThanOrEqual(8);
        }
        // Two bodies, two materials, one mesh's worth of vertices.
        expect(drawable(world.parts.spirit).material).not.toBe(drawable(world.parts.fox).material);
        expect(drawable(world.parts.spirit).geometry).toBe(drawable(world.parts.fox).geometry);
    });

    it.each(WINTER_PARTS)('builds the %s for WebGPU and for the WebGL2 fallback without a word', (name) => {
        if (!built[name]) {
            // Only the diamond dust is ever left out, and only where the tier has none.
            expect(name).toBe('dust');
            expect(QUALITY[quality].dust).toBe(0);
            return;
        }
        BACKENDS.forEach(([label]) => {
            const out = built[name][label];
            expect(out.thrown, `${name}, ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(said[name][label], `${name}, ${label}`).toEqual([]);
            for (const stage of ['vertex', 'fragment']) {
                expect(typeof out[stage], `${name}, ${label} ${stage}`).toBe('string');
                expect(out[stage].length, `${name}, ${label} ${stage}`).toBeGreaterThan(200);
                expect(Buffer.byteLength(out[stage]), `${name}, ${label} ${stage}`).toBeLessThan(STAGE_BUDGET);
                expect(equalEdges(out[stage]), `${name}, ${label} ${stage}`).toEqual([]);
            }
            // No MaterialX noise anywhere (a DXC compile pathology): the noise is a baked texture.
            expect(`${out.vertex}${out.fragment}`, `${name}, ${label}`).not.toMatch(/mx_\w+/);
        });
        expect(built[name].WGSL.vertex).toMatch(/@vertex/);
        expect(built[name].WGSL.fragment).toMatch(/@fragment/);
        expect(built[name].GLSL.vertex).toMatch(/void main\(\)/);
        expect(built[name].GLSL.fragment).toMatch(/void main\(\)/);
    });

    it('emits each shared helper once per stage, as a function of its arguments alone', () => {
        const names = new Set();
        Object.keys(built).forEach((part) => {
            for (const stage of ['vertex', 'fragment']) {
                const found = helpers(built[part].WGSL[stage]);
                // Defined once: a helper without a layout would be inlined, not defined at all.
                expect(new Set(found.map((helper) => helper.name)).size, `${part} ${stage}`).toBe(found.length);
                found.forEach((helper) => {
                    names.add(helper.name);
                    // A function with a layout is written once and reused by later materials: a
                    // uniform, a uniform array or a texture it closed over is declared only in the
                    // first shader that built it.
                    expect(captures(helper.body), `${helper.name} in the ${part}'s ${stage} stage`).toBeNull();
                });
            }
        });
        // The sky's stars hash their cells with one of them at every tier.
        expect([...names]).toContain('w_hash23');
        expect(helpers(built.sky.WGSL.fragment).map((helper) => helper.name)).toContain('w_hash23');
        expect(built.sky.GLSL.fragment).toMatch(/vec3 w_hash23\s*\(/);
    });

    it('hashes the snow\'s sparkle only where the tier has glints, and reads its noise from the texture', () => {
        const tier = QUALITY[quality];
        const groundHelpers = helpers(built.ground.WGSL.fragment).map((helper) => helper.name);
        expect(groundHelpers.includes('w_hash23')).toBe(tier.glints);
        expect(built.sky.WGSL.fragment).toMatch(/textureSample/);
        expect(built.ground.WGSL.fragment).toMatch(/textureSample/);
    });
});

describe('winter fox: the body the mind poses', () => {
    let gltf;
    let u;
    let textures;
    let fox;
    let spirit;
    const bone = (name) => {
        let found = null;
        fox.mesh.traverse((child) => {
            if (child.isBone && child.name === name) found = child;
        });
        return found;
    };
    const pose = (over = {}) => ({
        x: 2,
        y: 0.1,
        z: -11,
        heading: 0.6,
        lift: 0,
        clip: 'Run',
        clipTime: 0.3,
        from: 'Run',
        fromTime: 0,
        blend: 1,
        ...over,
    });

    beforeAll(async () => {
        gltf = await readFox();
        const noise = createNoiseTexture(bakeNoise());
        const shadow = createShadowTexture(new Uint8Array(4).fill(255), 2);
        textures = [noise, shadow];
        u = createWinterUniforms({ noise, shadow });
        fox = createFox(u, gltf);
        spirit = createSpiritFox(u, gltf);
    });
    afterAll(() => {
        fox.dispose();
        spirit.dispose();
        textures.forEach((texture) => texture.dispose());
    });

    it('has every clip the mind may ask for, as long as the mind thinks it is', () => {
        const clips = Object.fromEntries(gltf.animations.map((clip) => [clip.name, clip.duration]));
        Object.keys(FOX_CLIPS).forEach((name) => {
            expect(clips[name], name).toBeGreaterThan(0);
            expect(clips[name], name).toBeCloseTo(FOX_CLIPS[name], 3);
        });
        // A tail to flick: the bones the swing turns and the vertices the fires light.
        for (const name of ['tail1', 'tail2', 'tail3']) expect(bone(name), name).toBeTruthy();
        const tail = drawable(fox).geometry.getAttribute('aTail');
        const weights = Array.from(tail.array);
        expect(weights.every((w) => w >= 0 && w <= 1 + 1e-6)).toBe(true);
        const lit = weights.filter((w) => w > 0.5).length;
        expect(lit).toBeGreaterThan(10);
        expect(lit).toBeLessThan(weights.length * 0.5);
    });

    it('stands the body where the mind says, turned its way, lifted on a pounce', () => {
        fox.update(pose(), 0);
        expect(fox.mesh.position.x).toBe(2);
        expect(fox.mesh.position.z).toBe(-11);
        expect(fox.mesh.position.y).toBeCloseTo(0.1, 1);
        expect(fox.mesh.rotation.y).toBe(0.6);
        expect(fox.mesh.scale.x).toBe(FOX_SCALE);
        const ground = fox.mesh.position.y;
        fox.update(pose({ lift: 0.8 }), 0);
        expect(fox.mesh.position.y - ground).toBeCloseTo(0.8, 9);
        // Another clip, another pose; a cross-fade lies between the two.
        const spine = bone('spine');
        const at = (over) => {
            fox.update(pose(over), 0);
            return spine.quaternion.clone();
        };
        const run = at({ clip: 'Run', clipTime: 0.2 });
        const curl = at({ clip: 'CurlSleep', clipTime: 2 });
        expect(curl.angleTo(run)).toBeGreaterThan(0.05);
        const half = at({
            clip: 'CurlSleep', clipTime: 2, from: 'Run', fromTime: 0.2, blend: 0.5,
        });
        expect(half.angleTo(run)).toBeGreaterThan(0.01);
        expect(half.angleTo(curl)).toBeGreaterThan(0.01);
        expect(half.angleTo(run)).toBeLessThan(curl.angleTo(run));
        // A time past a clip's end is held at its end, never wrapped or thrown.
        expect(() => fox.update(pose({ clip: 'Pounce', clipTime: 99 }), 0)).not.toThrow();
        expect(() => fox.update(pose({ clip: 'NoSuchClip' }), 0)).not.toThrow();
    });

    it('turns the tail by the swing it is given', () => {
        const tail = bone('tail1');
        fox.update(pose({ clipTime: 0.31 }), 0);
        const still = tail.quaternion.clone();
        fox.update(pose({ clipTime: 0.3101 }), 0.2);
        const swung = tail.quaternion.angleTo(still);
        expect(swung).toBeGreaterThan(0.05);
        expect(swung).toBeLessThan(0.3);
        // The other way for the other sign, and back to the clip's own pose with none.
        fox.update(pose({ clipTime: 0.3102 }), -0.2);
        expect(tail.quaternion.angleTo(still)).toBeCloseTo(swung, 2);
        fox.update(pose({ clipTime: 0.3103 }), 0);
        expect(tail.quaternion.angleTo(still)).toBeLessThan(0.01);
    });

    // (A regression: the tail's turn is added with rotateZ() after mixer.update(0), and three's
    // PropertyMixer only writes a bone when its animated value CHANGED since the last update.
    // Drawing the same pose twice — a frozen-time capture, a paused frame, the still stretch of
    // the Stretch clip — once put the second turn on top of the first; the poser now takes its
    // own turn off again before the mixer runs.)
    it('poses the tail the same however many times one pose is drawn', () => {
        const tail = bone('tail1');
        const held = pose({ clipTime: 0.4 });
        fox.update(held, 0.06);
        const once = tail.quaternion.clone();
        for (let i = 0; i < 6; i++) fox.update(held, 0.06);
        expect(tail.quaternion.angleTo(once)).toBeLessThan(1e-6);
    });

    // (A regression: CurlSleep is not a held pose. The model curls down over its first 0.8 s,
    // lies curled until 2.1 s and then gets up again, so a mind that LOOPED the clip had the
    // sleeping fox on its feet every 2.7 s. The clip is now played into its lying stretch and
    // held there.)
    it('keeps a sleeping fox curled up', () => {
        const bones = [];
        fox.mesh.traverse((child) => {
            if (child.isBone) bones.push(child);
        });
        const snapshot = () => bones.map((b) => b.quaternion.clone());
        /** The largest turn of any bone between two poses (radians). */
        const apart = (a, b) => Math.max(...a.map((q, i) => q.angleTo(b[i])));
        fox.update(pose({ clip: 'LookAround', clipTime: 0 }), 0);
        const stand = snapshot();
        // (For scale: the clip's own held curl is a long way from a stand. This much holds.)
        fox.update(pose({ clip: 'CurlSleep', clipTime: FOX_CLIPS.CurlSleep * 0.5 }), 0);
        const curled = apart(snapshot(), stand);
        expect(curled).toBeGreaterThan(1);
        // The run is over: the mind sleeps, and the body is posed from it for a quarter minute.
        const mind = new FoxMind(foxRound(16 / 9));
        mind.sleep(0);
        const dt = 1 / 30;
        let straightest = Infinity;
        for (let t = dt; t < 15; t += dt) {
            mind.step(dt, t, { power: 0, surge: 0 });
            if (t > 3) {
                fox.update(mind.pose, 0);
                straightest = Math.min(straightest, apart(snapshot(), stand));
            }
        }
        expect(mind.asleep).toBe(true);
        expect(mind.pose.clip).toBe('CurlSleep');
        // Once down it stays down: never back to within a fifth of the way to its feet.
        expect(straightest).toBeGreaterThan(curled * 0.8);
    });

    it('sends the fox of light across the sky for as long as its run lasts, and hides it otherwise', () => {
        expect(spirit.mesh.visible).toBe(false);
        for (const age of [-1, 0, SPIRIT_RUN, SPIRIT_RUN + 3]) {
            expect(spirit.update(age), `age ${age}`).toBe(0);
            expect(spirit.mesh.visible, `age ${age}`).toBe(false);
        }
        let previous = -Infinity;
        let brightest = 0;
        for (let k = 0.05; k < 1; k += 0.1) {
            const glow = spirit.update(SPIRIT_RUN * k);
            expect(spirit.mesh.visible).toBe(true);
            expect(glow).toBeGreaterThan(0);
            expect(glow).toBeLessThanOrEqual(1);
            brightest = Math.max(brightest, glow);
            const p = spirit.mesh.position;
            expect([p.x, p.y, p.z].every((v) => Number.isFinite(v))).toBe(true);
            // Far off, ahead, above the horizon, crossing left to right.
            expect(Math.hypot(p.x, p.z)).toBeGreaterThan(1000);
            expect(p.z).toBeLessThan(0);
            const bearing = Math.atan2(p.x, -p.z);
            expect(bearing).toBeGreaterThan(previous);
            previous = bearing;
            // Where its path says, and that path is the one the world lights the sky along.
            const path = spiritPath(k);
            expect(bearing).toBeCloseTo(path.bearing, 6);
            expect(path.elevation).toBeGreaterThan(0);
            expect(path.elevation).toBeLessThan(Math.PI / 4);
            expect(Number.isFinite(path.slope)).toBe(true);
        }
        expect(brightest).toBe(1);
        expect(spiritPath(0).bearing).toBeLessThan(0);
        expect(spiritPath(1).bearing).toBeGreaterThan(0);
        // Kilometres long: it spans a good part of the sky at that distance.
        expect(spirit.mesh.scale.x).toBeGreaterThan(500);
    });
});
