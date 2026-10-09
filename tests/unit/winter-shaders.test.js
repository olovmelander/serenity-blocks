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
 * vertices and no textures to decode), handed over at once instead of fetched, with as many
 * shells of fur and veils of light as the tier gives them. The fox's coat is a second material on
 * a second mesh: it is built too.
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
import { FOX_CLIPS, FoxMind, SLEEP_HOLD } from '../../src/themes/winter/winter-fox-mind.js';
import { FOX_BONES, foxSpec, solveFox } from '../../src/themes/winter/winter-fox-rig.js';
import { QUALITY } from '../../src/themes/winter/winter-quality.js';
import {
    FOX_SCALE, SPIRIT_RUN, bakeNoise, createNoiseTexture, createShadowTexture, createWinterUniforms, foxRound,
} from '../../src/themes/winter/winter-tsl.js';

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/** What the fox's second material is called here: not a part of the world, a part of the fox. */
const FUR = 'fox\'s fur';
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

/** The fox's coat of fur: the mesh drawn again over its skin (none where the tier has no fur). */
function furOf(part) {
    let found = null;
    part.mesh.traverse((object) => {
        if (object.isMesh && object.name === 'WinterFoxFur') found = object;
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
        // in the world's own order (the fox, then its like of light) and with the tier's own coat.
        world.parts.fox = createFox(world.u, gltf, { shells: QUALITY[quality].fur });
        world.parts.spirit = createSpiritFox(world.u, gltf, { shells: QUALITY[quality].veils });
        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        const build = (name, mesh) => {
            built[name] = {};
            said[name] = {};
            BACKENDS.forEach(([label, Builder]) => {
                const heard = [];
                const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 400));
                warn.mockImplementation(listen);
                error.mockImplementation(listen);
                try {
                    built[name][label] = buildShaders(Builder, mesh);
                } catch (thrown) {
                    built[name][label] = { thrown };
                }
                said[name][label] = heard;
            });
        };
        Object.keys(world.parts).forEach((name) => build(name, drawable(world.parts[name])));
        // The fox is two materials: its skin (above) and, where the tier has fur, its coat.
        const fur = furOf(world.parts.fox);
        if (fur) build(FUR, fur);
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
        const tier = QUALITY[quality];
        const expected = WINTER_PARTS.filter((name) => name !== 'dust' || tier.dust > 0);
        if (tier.fur > 0) expected.push(FUR);
        expect(Object.keys(built).sort()).toEqual([...expected].sort());
        Object.keys(world.parts).forEach((name) => {
            const mesh = drawable(world.parts[name]);
            expect(mesh, name).toBeTruthy();
            expect(mesh.material.isNodeMaterial, name).toBe(true);
        });
        // The trees are instanced; the foxes are the real model: skinned, painted, with normals.
        expect(drawable(world.parts.trees).isInstancedMesh).toBe(true);
        const fox = drawable(world.parts.fox);
        const spirit = drawable(world.parts.spirit);
        const fur = furOf(world.parts.fox);
        const bodies = [['fox', fox], ['spirit', spirit], ...(fur ? [[FUR, fur]] : [])];
        for (const [name, body] of bodies) {
            expect(body.isSkinnedMesh, name).toBe(true);
            const attributes = Object.keys(body.geometry.attributes);
            const needed = ['position', 'normal', 'color', 'skinIndex', 'skinWeight'];
            expect(attributes, name).toEqual(expect.arrayContaining(needed));
            // Every attribute is its own vertex buffer on WebGPU, and a pipeline binds eight.
            expect(attributes.length, name).toBeLessThanOrEqual(8);
            // The coat's four numbers ride in the colour (tail, fur length, dark paint, sky seen).
            expect(body.geometry.attributes.color.itemSize, name).toBe(4);
        }
        // Three drawings, three materials, one mesh's worth of vertices: the coat and the fox of
        // light are instanced over the very buffers the skin is drawn from.
        expect(spirit.material).not.toBe(fox.material);
        expect(fox.material).toBe(world.parts.fox.material);
        for (const [name, body] of bodies) {
            Object.keys(fox.geometry.attributes).forEach((key) => {
                expect(body.geometry.attributes[key], `${name} ${key}`).toBe(fox.geometry.attributes[key]);
            });
            expect(body.geometry.index, name).toBe(fox.geometry.index);
        }
        // The body of light and a veil for each the tier gives it; a shell of fur for each of its.
        expect(world.parts.spirit.shells).toBe(tier.veils);
        expect(spirit.geometry.instanceCount).toBe(tier.veils + 1);
        expect(world.parts.fox.shells).toBe(tier.fur);
        expect(Boolean(fur)).toBe(tier.fur > 0);
        expect(Boolean(world.parts.fox.furMaterial)).toBe(tier.fur > 0);
        if (fur) {
            expect(fur.material).toBe(world.parts.fox.furMaterial);
            expect(fur.material).not.toBe(fox.material);
            // (A regression: one shell more than the tier's was drawn, and it and the last of
            // the tier's stood at the very tips of the fur, where no hair is left: two draws of
            // the whole animal for nothing. A shell for each of the tier's, and no more.)
            expect(fur.geometry.instanceCount).toBe(tier.fur);
            // It moves with the skin it grows from: one skeleton poses both.
            expect(fur.skeleton).toBe(fox.skeleton);
            expect(fur.parent).toBe(fox.parent);
        }
    });

    it.each([...WINTER_PARTS, FUR])('builds the %s for WebGPU and for the WebGL2 fallback without a word', (name) => {
        if (!built[name]) {
            // Only the diamond dust and the fox's fur are ever left out, and only where the tier has none.
            expect(['dust', FUR]).toContain(name);
            expect(QUALITY[quality][name === FUR ? 'fur' : 'dust']).toBe(0);
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
    /** A pose of the mind's: an act held at a stand, with nothing laid over it unless `over` says. */
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
        phase: 0,
        speed: 0,
        amp: 0,
        ...over,
    });
    const bones = () => FOX_BONES.map(([name]) => bone(name));
    const turns = () => bones().map((b) => b.quaternion.clone());
    /** The largest turn of any bone between two poses (radians). */
    const apart = (a, b) => Math.max(...a.map((q, i) => q.angleTo(b[i])));

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

    it('is on the rig\'s own skeleton and carries no clips: the theme poses it', () => {
        expect(gltf.animations).toEqual([]);
        expect(fox.rigged).toBe(true);
        // Every bone of the rig is a bone of the model, hung from the bone the rig hangs it from,
        // and the skin binds them in the rig's order (a vertex's joints are indices into it).
        const skin = drawable(fox);
        expect(skin.skeleton.bones.map((b) => b.name)).toEqual(FOX_BONES.map((b) => b[0]));
        FOX_BONES.forEach(([name, parent]) => {
            expect(bone(name)?.isBone, name).toBe(true);
            if (parent) expect(bone(name).parent, name).toBe(bone(parent));
        });
        // Every act the mind may ask for is a pose of this body: something of it moves.
        fox.update(pose());
        const stand = turns();
        Object.keys(FOX_CLIPS).filter((name) => name !== 'Run').forEach((name) => {
            let moved = 0;
            for (let t = 0; t <= FOX_CLIPS[name]; t += 0.1) {
                fox.update(pose({ clip: name, from: name, clipTime: t }));
                moved = Math.max(moved, apart(turns(), stand));
            }
            expect(moved, name).toBeGreaterThan(0.1);
        });
        // A tail to flick: the bones the swing turns and the vertices the fires light (the first
        // of the coat's four numbers, painted into each vertex's colour).
        for (const name of ['tail1', 'tail2', 'tail3', 'tail4']) expect(bone(name), name).toBeTruthy();
        const coat = skin.geometry.getAttribute('color');
        expect(coat.itemSize).toBe(4);
        const weights = Array.from({ length: coat.count }, (_, i) => coat.getX(i));
        expect(weights.every((w) => w >= 0 && w <= 1 + 1e-6)).toBe(true);
        const lit = weights.filter((w) => w > 0.5).length;
        expect(lit).toBeGreaterThan(10);
        expect(lit).toBeLessThan(weights.length * 0.5);
    });

    it('stands the body where the mind says, turned its way, lifted on a pounce', () => {
        fox.update(pose());
        expect(fox.mesh.position.x).toBe(2);
        expect(fox.mesh.position.z).toBe(-11);
        expect(fox.mesh.position.y).toBeCloseTo(0.1, 1);
        expect(fox.mesh.rotation.y).toBe(0.6);
        expect(fox.mesh.scale.x).toBe(FOX_SCALE);
        const ground = fox.mesh.position.y;
        fox.update(pose({ lift: 0.8 }));
        expect(fox.mesh.position.y - ground).toBeCloseTo(0.8, 9);
        // Another act, another pose; a cross-fade lies between the two.
        const spine = bone('spine');
        const at = (over) => {
            fox.update(pose(over));
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
        // A time past an act's end is held at its end, and an act it has never heard of is a
        // stand: neither is wrapped or thrown.
        expect(() => fox.update(pose({ clip: 'Pounce', clipTime: 99 }))).not.toThrow();
        expect(() => fox.update(pose({ clip: 'NoSuchClip' }))).not.toThrow();
        expect(bones().every((b) => b.quaternion.toArray().every(Number.isFinite))).toBe(true);
    });

    // (The model is given only each bone's turn in its parent's frame and the root's place. What
    // three makes of those has to be the animal the rig solved — or the paws these tests find on
    // the snow are not the paws that are drawn.)
    it('draws the animal the rig solved: every joint where the solver put it', () => {
        const poses = [
            pose({
                clip: 'Sit', from: 'Sit', clipTime: 3, side: -1,
            }),
            pose({ clip: 'CurlSleep', from: 'CurlSleep', clipTime: SLEEP_HOLD }),
            pose({
                clip: 'Pounce', from: 'Listen', clipTime: 0.8, fromTime: 2, blend: 0.6, lift: 0.4,
            }),
            pose({
                phase: 0.37, speed: 6.8, amp: 1, lean: 0.2, nod: -0.05, lookYaw: 0.3, tailYaw: -0.2, tailLift: 0.5,
            }),
        ];
        const where = new THREE.Vector3();
        const want = new THREE.Vector3();
        poses.forEach((p, n) => {
            fox.update(p);
            const solved = solveFox(foxSpec(p));
            FOX_BONES.forEach(([name], i) => {
                bone(name).getWorldPosition(where);
                // (The solver's metres are the model's: the fox stands larger than life, where
                // the pose says, turned its way.)
                want.fromArray(solved.at[i]).applyMatrix4(fox.mesh.matrixWorld);
                expect(where.distanceTo(want), `pose ${n}: ${name}`).toBeLessThan(1e-6);
            });
        });
    });

    it('turns the tail by the swing the pose gives it', () => {
        const tail = bone('tail1');
        fox.update(pose());
        const still = tail.quaternion.clone();
        fox.update(pose({ tailYaw: 0.2 }));
        const swung = tail.quaternion.angleTo(still);
        // The first bone of the tail takes a part of the swing, the bones behind it the rest.
        expect(swung).toBeGreaterThan(0.02);
        expect(swung).toBeLessThan(0.2);
        expect(bone('tail3').quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.01);
        // The other way for the other sign, and back to the act's own pose with none.
        fox.update(pose({ tailYaw: -0.2 }));
        expect(tail.quaternion.angleTo(still)).toBeCloseTo(swung, 6);
        fox.update(pose());
        expect(tail.quaternion.angleTo(still)).toBeLessThan(1e-6);
    });

    // (A regression from when the model played clips: the tail's turn was added on top of the
    // mixer's, and a pose drawn twice — a frozen-time capture, a paused frame — once had the
    // second turn put on top of the first. The body is now a function of the pose and nothing
    // else: this holds it to that.)
    it('poses the body the same however many times one pose is drawn, whatever was drawn before', () => {
        const held = pose({
            clipTime: 0.4, tailYaw: 0.06, phase: 0.2, speed: 3, amp: 1,
        });
        const drawn = () => [...turns().map((q) => q.toArray()), bone('hips').position.toArray()];
        fox.update(held);
        const once = drawn();
        for (let i = 0; i < 6; i++) fox.update(held);
        expect(drawn()).toEqual(once);
        // Something else in between — another act, half blended, curled the other way — and back.
        fox.update(pose({
            clip: 'CurlSleep', from: 'Dig', blend: 0.3, clipTime: 1, side: -1,
        }));
        expect(drawn()).not.toEqual(once);
        fox.update(held);
        expect(drawn()).toEqual(once);
    });

    // (A regression from when the model played clips: CurlSleep curled down, lay, and got up
    // again, so a mind that looped it had the sleeping fox on its feet every 2.7 s. The act is
    // now played to where it lies curled and held there.)
    it('keeps a sleeping fox curled up', () => {
        fox.update(pose({ clip: 'LookAround', clipTime: 0 }));
        const stand = turns();
        // (For scale: the act's own held curl is a long way from a stand. This much holds.)
        fox.update(pose({ clip: 'CurlSleep', clipTime: SLEEP_HOLD }));
        const curled = apart(turns(), stand);
        expect(curled).toBeGreaterThan(1);
        // The run is over: the mind sleeps, and the body is posed from it for a quarter minute.
        const mind = new FoxMind(foxRound(16 / 9));
        mind.sleep(0);
        const dt = 1 / 30;
        let straightest = Infinity;
        for (let t = dt; t < 15; t += dt) {
            mind.step(dt, t, { power: 0, surge: 0 });
            if (t > 3) {
                fox.update(mind.pose);
                straightest = Math.min(straightest, apart(turns(), stand));
            }
        }
        expect(mind.asleep).toBe(true);
        expect(mind.pose.clip).toBe('CurlSleep');
        // Once down it stays down: never back to within a fifth of the way to its feet.
        expect(straightest).toBeGreaterThan(curled * 0.8);
    });

    it('wears its fur over its skin on the same bones, and none where it is asked for none', async () => {
        expect(fox.shells).toBeGreaterThan(0);
        const skin = drawable(fox);
        const fur = furOf(fox);
        expect(fur.isSkinnedMesh).toBe(true);
        expect(fur.material).toBe(fox.furMaterial);
        expect(fur.skeleton).toBe(skin.skeleton);
        expect(fur.geometry.attributes.position).toBe(skin.geometry.attributes.position);
        expect(fur.geometry.instanceCount).toBe(fox.shells);
        // The skin is solid and the fur a veil drawn after it, front faces only.
        expect(skin.material).toBe(fox.material);
        expect(fox.furMaterial.transparent).toBe(true);
        expect(fox.furMaterial.side).toBe(THREE.FrontSide);
        expect(fur.renderOrder).toBeGreaterThan(skin.renderOrder);
        expect(u.foxEyes.value).toBe(0);
        // A painted coat: no second mesh, no second material — and it lets go of what it made.
        const bare = createFox(u, await readFox(), { shells: 0 });
        expect(bare.shells).toBe(0);
        expect(bare.furMaterial).toBeNull();
        expect(furOf(bare)).toBeNull();
        expect(bare.rigged).toBe(true);
        expect(() => bare.update(pose({ clip: 'Sit', clipTime: 3 }))).not.toThrow();
        bare.dispose();
        const furred = createFox(u, await readFox(), { shells: 3.4 });
        expect(furred.shells).toBe(3);
        expect(furOf(furred).geometry.instanceCount).toBe(3);
        furred.dispose();
        expect(furOf(furred)).toBeNull();
        // The fox of light is its body and a veil for each it is given: one more than its veils.
        const veiled = createSpiritFox(u, await readFox(), { shells: 4 });
        expect(veiled.shells).toBe(4);
        expect(drawable(veiled).geometry.instanceCount).toBe(5);
        veiled.dispose();
        const plain = createSpiritFox(u, await readFox(), { shells: 0 });
        expect(plain.shells).toBe(0);
        expect(drawable(plain).geometry.instanceCount).toBe(1);
        plain.dispose();
    });

    // (The fur's tips lean with the wind, and the wind blows over the snow, not over the fox:
    // turned about, it must not carry its own wind round with it. The uniform that says which
    // way the wind blows as the fox feels it is the fur material's own.)
    it('feels the wind turn as it turns: the fur\'s lean is the world\'s wind in the fox\'s own frame', () => {
        // (It is reached the way the backend reaches it: the vectors the fur's vertex stage reads.)
        const builder = new THREE.WGSLNodeBuilder(furOf(fox), stubRenderer());
        builder.scene = new THREE.Scene();
        builder.camera = new THREE.PerspectiveCamera();
        builder.context.material = fox.furMaterial;
        builder.material = fox.furMaterial;
        builder.build();
        const winds = builder.uniforms.vertex.map((bound) => bound.node).filter((node) => node?.value?.isVector3);
        expect(winds.length).toBeGreaterThan(0);
        const blowing = (heading) => {
            fox.update(pose({ heading }));
            return winds.map((wind) => wind.value.clone());
        };
        const ahead = blowing(0);
        const turned = blowing(1.1);
        const about = blowing(Math.PI);
        // One of them turns with the fox: a unit bearing over the snow, the same wind seen from
        // another heading — and blowing the other way when it has turned right about.
        const own = ahead.findIndex((wind, i) => wind.distanceTo(turned[i]) > 1e-6);
        expect(own).toBeGreaterThanOrEqual(0);
        [ahead, turned, about].forEach((seen) => {
            expect(seen[own].length()).toBeCloseTo(1, 9);
            expect(seen[own].y).toBe(0);
        });
        expect(ahead[own].angleTo(turned[own])).toBeCloseTo(1.1, 6);
        expect(ahead[own].clone().add(about[own]).length()).toBeLessThan(1e-9);
        // Carried from its own frame into the world's, it is the same wind whatever its heading.
        const world = (wind, heading) => wind.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
        expect(world(turned[own], 1.1).distanceTo(world(ahead[own], 0))).toBeLessThan(1e-9);
        expect(world(about[own], Math.PI).distanceTo(world(ahead[own], 0))).toBeLessThan(1e-9);
    });

    it('gives the fox of light bones of its own and no fur: it gallops without stirring the fox', () => {
        expect(furOf(spirit)).toBeNull();
        const body = drawable(spirit);
        expect(body.skeleton).not.toBe(drawable(fox).skeleton);
        expect(body.skeleton.bones.map((b) => b.name)).toEqual(FOX_BONES.map((b) => b[0]));
        fox.update(pose());
        const stand = turns();
        const galloping = (age) => {
            spirit.update(age);
            return body.skeleton.bones.map((b) => b.quaternion.clone());
        };
        // Its legs go, its back works: a moment on, it is in another part of its bound.
        const one = galloping(SPIRIT_RUN * 0.3);
        const two = galloping(SPIRIT_RUN * 0.3 + 0.2);
        expect(apart(one, two)).toBeGreaterThan(0.05);
        expect(one.every((q) => q.toArray().every(Number.isFinite))).toBe(true);
        const chest = body.skeleton.bones.findIndex((b) => b.name === 'chest');
        expect(one[chest].angleTo(two[chest])).toBeGreaterThan(0.01);
        // The same age, the same pose: it is a function of its age alone.
        expect(galloping(SPIRIT_RUN * 0.3).map((q) => q.toArray())).toEqual(one.map((q) => q.toArray()));
        // And the fox on the snow has not stirred.
        expect(turns().map((q) => q.toArray())).toEqual(stand.map((q) => q.toArray()));
        spirit.update(-1);
        expect(spirit.mesh.visible).toBe(false);
    });

    it('gives the fox more fur and its like more veils the richer the tier, and neither at the leanest', () => {
        const tiers = Object.values(QUALITY);
        expect(tiers[0].fur).toBe(0);
        expect(tiers[0].veils).toBe(0);
        tiers.forEach((tier, i) => {
            expect(Number.isInteger(tier.fur)).toBe(true);
            expect(Number.isInteger(tier.veils)).toBe(true);
            if (i === 0) return;
            expect(tier.fur).toBeGreaterThan(tiers[i - 1].fur);
            expect(tier.veils).toBeGreaterThanOrEqual(tiers[i - 1].veils);
        });
        expect(tiers[tiers.length - 1].veils).toBeGreaterThan(0);
    });

    it('leaves a model that is not on the rig standing as it came', async () => {
        const stray = await readFox();
        let renamed = null;
        stray.scene.traverse((child) => {
            if (child.isBone && child.name === 'tail3') renamed = child;
        });
        renamed.name = 'tail-three';
        const before = renamed.quaternion.clone();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const odd = createFox(u, stray, { shells: 0 });
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
        expect(odd.rigged).toBe(false);
        // It is still put where the mind says, only not posed.
        odd.update(pose({ clip: 'CurlSleep', clipTime: SLEEP_HOLD }));
        expect(odd.mesh.position.x).toBe(2);
        expect(renamed.quaternion.angleTo(before)).toBe(0);
        odd.dispose();
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
