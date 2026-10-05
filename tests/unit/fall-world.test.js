import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { FALL_WORLD_BUDGETS, FallWorld } from '../../src/themes/fall/fall-world.js';
import { FallForest } from '../../src/themes/fall/fall-forest.js';
import { FALL_REACTION_LIMITS, FallReactions } from '../../src/themes/fall/fall-reactions.js';
import { FallPost } from '../../src/themes/fall/fall-post.js';

const owned = [];

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createWorld(quality = 'Minimal', fog = null) {
    const scene = new THREE.Scene();
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300);
    const world = new FallWorld({
        scene, camera, quality, rng: seededRandom(),
    });
    owned.push(world);
    world.build();
    return { scene, camera, world };
}

function drawables(group) {
    const meshes = [];
    group.traverse((object) => { if (object.isMesh) meshes.push(object); });
    return meshes;
}

function resources(group) {
    const result = new Set();
    group.traverse((object) => {
        if (object.geometry) result.add(object.geometry);
        if (object.material) result.add(object.material);
        if (object.isInstancedMesh) result.add(object);
    });
    return result;
}

function expectFiniteSamples(array) {
    expect(array.length).toBeGreaterThan(0);
    const middle = Math.floor(array.length / 2);
    for (const start of [0, middle, Math.max(0, array.length - 12)]) {
        for (let i = start; i < Math.min(start + 12, array.length); i++) {
            expect(Number.isFinite(array[i])).toBe(true);
        }
    }
}

function createPost(quality = 'Low', render = vi.fn()) {
    const renderer = {
        toneMapping: THREE.NoToneMapping,
        toneMappingExposure: 0.75,
        outputColorSpace: THREE.SRGBColorSpace,
        render,
    };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const post = new FallPost({
        renderer, scene, camera, quality,
    });
    owned.push(post);
    return {
        renderer, scene, camera, post,
    };
}

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    vi.restoreAllMocks();
});

describe('Fall world scene contracts', () => {
    it.each(Object.keys(FALL_WORLD_BUDGETS))('builds the complete finite node scene at %s', (quality) => {
        const { scene, camera, world } = createWorld(quality);
        const meshes = drawables(world.group);
        const budget = FALL_WORLD_BUDGETS[quality];
        expect(scene.children).toEqual([world.group]);
        expect(world.forest.group.parent).toBe(world.group);
        expect(world.burstSlots).toHaveLength(FALL_REACTION_LIMITS[quality]);
        expect(meshes.find((mesh) => mesh.name === 'Tumbling maple leaves').count).toBe(budget.leaves);
        expect(meshes.find((mesh) => mesh.name === 'Golden dust in the glade').count).toBe(budget.motes);
        expect(meshes.find((mesh) => mesh.name === 'Light through the canopy').count).toBe(budget.rays);
        expect(meshes.some((mesh) => mesh.name === 'FallDenseMapleCrowns')).toBe(true);
        expect(meshes.some((mesh) => mesh.name === 'FallScatteredLeafCarpet')).toBe(true);
        for (const slot of world.burstSlots) {
            expect(slot.mesh.count).toBe(budget.burstLeaves);
            expect(slot.mesh.visible).toBe(false);
            expect(slot.mesh.parent).toBe(world.group);
        }
        for (const mesh of meshes) {
            expect(mesh.material.isNodeMaterial).toBe(true);
            expect(mesh.material.isShaderMaterial).not.toBe(true);
            if (mesh.material.colorNode) expect(mesh.material.colorNode.isNode).toBe(true);
            else expect(mesh.material.color.isColor).toBe(true);
            expect(mesh.geometry.attributes.position.count).toBeGreaterThan(0);
            for (const attribute of Object.values(mesh.geometry.attributes)) expectFiniteSamples(attribute.array);
            if (mesh.isInstancedMesh) expectFiniteSamples(mesh.instanceMatrix.array);
        }
        expect(Number.isFinite(camera.fov)).toBe(true);
        expectFiniteSamples(camera.projectionMatrix.elements);
    });

    it('maps sparse director IDs to their original mesh slots and hides retired bursts', () => {
        const { world } = createWorld();
        const reactions = new FallReactions({ quality: 'Minimal', rng: seededRandom() });
        // Slot zero expires while later lock puffs are still in flight.
        reactions.onPieceLock({ viewportOrigin: { x: 0.1 } });
        reactions.update(0.3);
        reactions.onPieceLock({ viewportOrigin: { x: 0.9 } });
        reactions.update(0.3);
        reactions.onPieceLock({ viewportOrigin: { x: 0.1 } });
        const frame = reactions.update(0.3);
        expect(frame.bursts.map((burst) => burst.id)).toEqual([1, 2]);
        world.update(reactions.time, 0.3, frame);
        expect(world.burstSlots[0].mesh.visible).toBe(false);
        expect(world.burstSlots[3].mesh.visible).toBe(false);
        for (const burst of frame.bursts) {
            const slot = world.burstSlots[burst.id];
            expect(slot.mesh.visible).toBe(true);
            expect(slot.progress.value).toBe(burst.progress);
            expect(slot.strength.value).toBe(burst.strength);
            expect(slot.side.value).toBe(burst.side);
            expect(slot.seed.value).toBe(burst.seed);
            expect(slot.kind.value).toBe(0);
        }
        reactions.onCombo(8);
        world.update(reactions.time, 0, reactions.getFrame());
        for (const burst of reactions.frame.bursts.filter((entry) => entry.kind === 'combo')) {
            expect(world.burstSlots[burst.id].kind.value).toBe(1);
        }
        reactions.reset();
        world.update(0, 0, reactions.getFrame());
        expect(world.burstSlots.every((slot) => !slot.mesh.visible)).toBe(true);
        for (const key of ['uGust', 'uWarmth', 'uShafts', 'uGlow', 'uVortex']) expect(world[key].value).toBe(0);
    });

    it('keeps all meshes and resources stable throughout repeated gameplay reactions', () => {
        const { world } = createWorld();
        const reactions = new FallReactions({ quality: 'Minimal', rng: seededRandom() });
        const meshes = drawables(world.group);
        const originalResources = resources(world.group);
        const slotStorage = world.burstSlots;
        const slots = [...slotStorage];
        for (let frame = 0; frame < 100; frame++) {
            if (frame % 5 === 0) {
                reactions.onPieceLock();
                reactions.onLineClear(4);
                reactions.onCombo(8);
            }
            world.update(reactions.time, 1 / 60, reactions.update(1 / 60));
        }
        const after = drawables(world.group);
        expect(after).toHaveLength(meshes.length);
        after.forEach((mesh, index) => expect(mesh).toBe(meshes[index]));
        expect(resources(world.group)).toEqual(originalResources);
        expect(world.burstSlots).toBe(slotStorage);
        slots.forEach((slot, index) => expect(world.burstSlots[index]).toBe(slot));
    });

    it('builds only once, disposes every owned resource once and restores the original fog', () => {
        const originalFog = new THREE.FogExp2(0x123456, 0.003);
        const { scene, world } = createWorld('Minimal', originalFog);
        const meshes = drawables(world.group);
        const { forest } = world;
        const installedFog = scene.fog;
        const disposals = [...resources(world.group)].map((resource) => vi.spyOn(resource, 'dispose'));
        expect(world.build()).toBe(world);
        expect(world.forest).toBe(forest);
        expect(scene.fog).toBe(installedFog);
        expect(drawables(world.group)).toHaveLength(meshes.length);
        expect(world.burstSlots).toHaveLength(FALL_REACTION_LIMITS.Minimal);
        world.dispose();
        world.dispose();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(scene.children).toHaveLength(0);
        expect(scene.fog).toBe(originalFog);
        expect(world.burstSlots).toHaveLength(0);
        expect(world.forest).toBeNull();
        expect(() => world.build()).toThrow('Cannot rebuild a disposed FallWorld');
    });

    it('preserves fog installed by another owner after the Fall world was built', () => {
        const { scene, world } = createWorld();
        const successorFog = new THREE.Fog(0x345678, 5, 90);
        scene.fog = successorFog;
        world.dispose();
        expect(scene.fog).toBe(successorFog);
    });

    it('retains ownership of a partially built forest so a failure can be cleaned up', () => {
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicNodeMaterial();
        const geometryDisposal = vi.spyOn(geometry, 'dispose');
        const materialDisposal = vi.spyOn(material, 'dispose');
        vi.spyOn(FallForest.prototype, 'build').mockImplementation(function failedBuild() {
            this.own(geometry);
            this.own(material);
            this.group.add(new THREE.Mesh(geometry, material));
            throw new Error('partial forest failure');
        });
        const scene = new THREE.Scene();
        const originalFog = new THREE.FogExp2(0x123456, 0.003);
        scene.fog = originalFog;
        const world = new FallWorld({ scene, camera: new THREE.PerspectiveCamera() });
        owned.push(world);
        expect(() => world.build()).toThrow('partial forest failure');
        expect(world.forest).toBeInstanceOf(FallForest);
        world.dispose();
        world.dispose();
        expect(geometryDisposal).toHaveBeenCalledOnce();
        expect(materialDisposal).toHaveBeenCalledOnce();
        expect(scene.children).toHaveLength(0);
        expect(scene.fog).toBe(originalFog);
    });

    it('keeps invalid time inputs out of the world clock and bounds scene excitement', () => {
        const { world } = createWorld();
        world.update(4, 0, {
            gust: 2, warmth: -5, shafts: Infinity, glow: NaN, vortex: 0.75,
        });
        expect(world.uTime.value).toBe(4);
        expect(world.uGust.value).toBe(1);
        expect(world.uWarmth.value).toBe(0);
        expect(world.uShafts.value).toBe(0);
        expect(world.uGlow.value).toBe(0);
        expect(world.uVortex.value).toBe(0.75);
        for (const time of [NaN, Infinity, -Infinity, undefined]) world.update(time, 0);
        expect(world.uTime.value).toBe(4);
        world.update(-5, 0);
        expect(world.uTime.value).toBe(0);
    });
});

describe('Fall post tier ownership', () => {
    it.each(['Minimal', 'Low'])('avoids post targets at %s and restores direct renderer settings', (quality) => {
        let drawTone;
        let drawExposure;
        const {
            renderer, scene, camera, post,
        } = createPost(quality);
        renderer.render.mockImplementation(() => {
            drawTone = renderer.toneMapping;
            drawExposure = renderer.toneMappingExposure;
        });
        expect(post.disabled).toBe(true);
        expect(post.pipeline).toBeFalsy();
        expect(post.scenePass).toBeFalsy();
        expect(post.bloomNode).toBeFalsy();
        post.update({ warmth: 0.8 });
        post.render();
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(drawTone).toBe(THREE.ACESFilmicToneMapping);
        expect(drawExposure).toBeCloseTo(1.07, 10);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
        post.dispose();
        post.dispose();
        post.render();
        expect(renderer.render).toHaveBeenCalledOnce();
    });

    it.each(['Minimal', 'Low'])('restores the %s renderer state when a direct render throws', (quality) => {
        const { renderer, post } = createPost(quality, vi.fn(() => { throw new Error('device lost'); }));
        expect(() => post.render()).toThrow('device lost');
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
    });

    it('constructs a node-only post graph for High and disposes its targets exactly once', () => {
        const { post } = createPost('High');
        expect(post.disabled).toBe(false);
        expect(post.pipeline.isRenderPipeline).toBe(true);
        expect(post.pipeline.outputColorTransform).toBe(false);
        expect(post.pipeline.outputNode.isNode).toBe(true);
        expect(post.getDiagnostics().useMRT).toBe(false);
        const disposals = [post.pipeline, post.scenePass, post.bloomNode]
            .map((resource) => vi.spyOn(resource, 'dispose'));
        post.dispose();
        post.dispose();
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
        expect(post.pipeline).toBeNull();
        expect(post.scenePass).toBeNull();
        expect(post.bloomNode).toBeNull();
        expect(post.renderer).toBeNull();
    });

    it('accepts finite resize dimensions and rejects invalid values before resizing targets', () => {
        const { post } = createPost('High');
        const resize = vi.spyOn(post.scenePass, 'setSize');
        post.setSize(390, 844);
        expect(post.uAspect.value).toBe(390 / 844);
        expect(resize).toHaveBeenCalledExactlyOnceWith(390, 844);
        for (const [width, height] of [[Infinity, 844], [390, Infinity], [NaN, 844], [390, NaN],
            [0, 844], [390, 0], [-1, 844], [390, -1]]) post.setSize(width, height);
        expect(resize).toHaveBeenCalledOnce();
        expect(post.uAspect.value).toBe(390 / 844);
    });
});
