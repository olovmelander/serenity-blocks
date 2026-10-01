import { readFile } from 'node:fs/promises';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { ShaderLib } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createOceanForestKelpMaterial } from '../../src/themes/ocean/ocean-forest-materials.js';
import { OceanAtmosphereSystem } from '../../src/themes/ocean/ocean-atmosphere-system.js';

vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({ loadGltfCached: vi.fn() }));

const disposables = [];
afterEach(() => {
    disposables.splice(0).forEach((item) => item.dispose());
});

async function loadKelp() {
    const file = new URL('../../src/themes/ocean/assets/blender-reef/kelp.glb', import.meta.url);
    const bytes = await readFile(file);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new GLTFLoader().parseAsync(buffer, '');
}

describe('Ocean forest kelp surfaces', () => {
    it.each([true, false])('preserves Blender paint and morph animation on backend %s', async (isWebGPU) => {
        const gltf = await loadKelp();
        let mesh;
        gltf.scene.traverse((child) => { if (child.isMesh) mesh = child; });
        const paint = mesh.geometry.attributes.color.array.slice();
        const targets = mesh.geometry.morphAttributes.position.map((target) => target.array.slice());
        const system = new OceanAtmosphereSystem({
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(),
            preset: { atmosphere: { blenderAssets: true } },
            getSeabedHeight: () => -20,
            isWebGPU,
        });
        disposables.push(system);
        system.group.add(gltf.scene);
        system.prepareHeroKelpAsset(gltf.scene, { authored: true });

        const { material } = mesh;
        expect(material.userData.forestKelp).toBe(true);
        expect(material.isNodeMaterial === true).toBe(isWebGPU);
        expect(material.side).toBe(THREE.DoubleSide);
        expect(material.transparent).toBe(false);
        expect(material.depthWrite).toBe(true);
        expect(material.map).toBeNull();
        expect(material.normalMap).toBeNull();
        expect(material.positionNode ?? null).toBeNull();
        expect(mesh.geometry.attributes.color.array).toEqual(paint);
        mesh.geometry.morphAttributes.position.forEach((target, index) => expect(target.array).toEqual(targets[index]));
        expect(mesh.geometry.attributes.aHeroKelpHeight.count).toBe(mesh.geometry.attributes.position.count);
        if (isWebGPU) {
            // r186 multiplies vertexColor after colorNode; the graph already
            // reads COLOR_0, so the automatic second multiply must stay off.
            expect(material.vertexColors).toBe(false);
            expect(system.tslUserData).toContain(material.userData);
        } else {
            expect(material.vertexColors).toBe(true);
            expect(system.uniforms).toContain(material.uniforms);
        }

        const mixer = new THREE.AnimationMixer(gltf.scene);
        mixer.clipAction(gltf.animations[0]).play();
        mixer.setTime(0.17);
        const firstPose = [...mesh.morphTargetInfluences];
        mixer.setTime(0.89);
        expect(mesh.morphTargetInfluences).not.toEqual(firstPose);
        mixer.stopAllAction();
        mixer.uncacheRoot(gltf.scene);
    });

    it('extends the real classic standard shader without replacing morph or lighting stages', () => {
        const material = createOceanForestKelpMaterial({ isWebGPU: false });
        disposables.push(material);
        const shader = {
            uniforms: {},
            vertexShader: ShaderLib.standard.vertexShader,
            fragmentShader: ShaderLib.standard.fragmentShader,
        };
        material.onBeforeCompile(shader);
        for (const chunk of ['morphnormal_vertex', 'morphtarget_vertex', 'defaultnormal_vertex', 'project_vertex']) {
            expect(shader.vertexShader).toContain(`#include <${chunk}>`);
        }
        for (const chunk of ['lights_physical_fragment', 'lights_fragment_begin', 'fog_fragment']) {
            expect(shader.fragmentShader).toContain(`#include <${chunk}>`);
        }
        expect(shader.vertexShader).toContain('attribute float aHeroKelpHeight;');
        expect(shader.fragmentShader).toContain('diffuseColor.rgb = mix(forestPigment');
        expect(shader.uniforms.uOceanForestGlow).toBe(material.userData.uGlowIntensity);
        material.uniforms.uGlowIntensity.value = 1.5;
        expect(shader.uniforms.uOceanForestGlow.value).toBe(1.5);
        expect(shader.fragmentShader.match(/sampler2D/g)).toHaveLength(
            ShaderLib.standard.fragmentShader.match(/sampler2D/g).length,
        );
    });
});
