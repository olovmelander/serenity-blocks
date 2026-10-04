import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import OceanTheme from '../../src/themes/ocean/ocean-theme.js';
import { loadGltfCached } from '../../src/themes/ocean/ocean-asset-loader.js';

vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({
    disposeOceanGltfCache: vi.fn(),
    loadGltfCached: vi.fn(),
}));

const themes = [];
afterEach(() => {
    themes.forEach((theme) => theme.disposeSceneContents());
    themes.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function makeTheme(isWebGPU = true, search = '') {
    vi.stubGlobal('window', { location: { search } });
    const theme = new OceanTheme();
    theme.scene = new THREE.Scene();
    theme.camera = new THREE.PerspectiveCamera();
    theme.isWebGPU = isWebGPU;
    theme.activePreset = { ...theme.activePreset, jellyfishCount: 3 };
    themes.push(theme);
    return theme;
}

function deferredLoad() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    loadGltfCached.mockReturnValueOnce(promise);
    return { resolve, reject };
}

async function loadAuthoredAsset() {
    const bytes = await readFile(new URL('../../src/themes/ocean/assets/blender-reef/jellyfish.glb', import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    let source;
    gltf.scene.traverse((child) => { if (child.isMesh) source = child; });
    return { gltf, source };
}

describe('Ocean authored jellyfish scene lifecycle', () => {
    it.each([true, false])('replaces the %s backend fallback without duplicating the population', async (isWebGPU) => {
        const theme = makeTheme(isWebGPU);
        const load = deferredLoad();
        const pending = theme.createJellyfish();
        const fallback = theme.jellyfishMesh;
        const population = theme.jellyfishData;
        const positions = population.positions.slice();
        const phases = population.phases.slice();
        const sizes = population.sizes.slice();
        const disposeFallbackGeometry = vi.spyOn(fallback.geometry, 'dispose');
        const disposeFallbackMaterial = vi.spyOn(fallback.material, 'dispose');
        expect(theme.scene.children).toEqual([fallback]);

        const { gltf, source } = await loadAuthoredAsset();
        // Cache clones own geometry/material but retain shared texture references.
        const sharedTexture = new THREE.Texture();
        source.material.map = sharedTexture;
        const disposeTexture = vi.spyOn(sharedTexture, 'dispose');
        const disposeSourceGeometry = vi.spyOn(source.geometry, 'dispose');
        const disposeSourceMaterial = vi.spyOn(source.material, 'dispose');
        load.resolve(gltf);
        await pending;

        const model = theme.jellyfishMesh;
        expect(model).not.toBe(fallback);
        expect(theme.scene.children).toEqual([model]);
        expect(model.count).toBe(population.count);
        expect(model.userData.authoredMorphAnimation).toBe(true);
        expect(model.material.isNodeMaterial === true).toBe(isWebGPU);
        expect(theme.jellyfishData).toBe(population);
        expect(population.positions).toEqual(positions);
        expect(population.phases).toEqual(phases);
        expect(population.sizes).toEqual(sizes);
        expect(disposeFallbackGeometry).toHaveBeenCalledTimes(1);
        expect(disposeFallbackMaterial).toHaveBeenCalledTimes(1);
        expect(disposeSourceGeometry).toHaveBeenCalledTimes(1);
        expect(disposeSourceMaterial).toHaveBeenCalledTimes(1);
        expect(disposeTexture).not.toHaveBeenCalled();
        expect(theme.uniformsToUpdate).not.toContain(fallback.material.uniforms);
        expect(theme._tslUniforms).not.toContain(fallback.material.userData);
        if (isWebGPU) expect(theme._tslUniforms).toContain(model.material.userData);
        expect(gltf.scene.children).toHaveLength(0);
        sharedTexture.dispose();
    });

    it('rejects a late asset after teardown and disposes its owned clones', async () => {
        const theme = makeTheme();
        const load = deferredLoad();
        const pending = theme.createJellyfish();
        theme.disposeSceneContents();
        const { gltf, source } = await loadAuthoredAsset();
        const disposeGeometry = vi.spyOn(source.geometry, 'dispose');
        const disposeMaterial = vi.spyOn(source.material, 'dispose');
        load.resolve(gltf);
        await pending;
        expect(theme.scene.children).toHaveLength(0);
        expect(theme.jellyfishMesh).toBeNull();
        expect(disposeGeometry).toHaveBeenCalledTimes(1);
        expect(disposeMaterial).toHaveBeenCalledTimes(1);
    });

    it('does not let an old load replace a newer rebuilt population', async () => {
        const theme = makeTheme();
        const oldLoad = deferredLoad();
        const oldPending = theme.createJellyfish();
        theme.disposeSceneContents();
        const newLoad = deferredLoad();
        const newPending = theme.createJellyfish();
        const newAsset = await loadAuthoredAsset();
        newLoad.resolve(newAsset.gltf);
        await newPending;
        const replacement = theme.jellyfishMesh;
        const oldAsset = await loadAuthoredAsset();
        const disposeOldGeometry = vi.spyOn(oldAsset.source.geometry, 'dispose');
        oldLoad.resolve(oldAsset.gltf);
        await oldPending;
        expect(theme.jellyfishMesh).toBe(replacement);
        expect(theme.scene.children).toEqual([replacement]);
        expect(disposeOldGeometry).toHaveBeenCalledTimes(1);
    });

    it('keeps the immediate fallback when the authored asset cannot load', async () => {
        const theme = makeTheme();
        const load = deferredLoad();
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pending = theme.createJellyfish();
        const fallback = theme.jellyfishMesh;
        load.reject(new Error('asset unavailable'));
        await pending;
        expect(theme.jellyfishMesh).toBe(fallback);
        expect(theme.scene.children).toEqual([fallback]);
        const message = '[Ocean] Blender jellyfish unavailable; keeping fallback:';
        expect(warning).toHaveBeenCalledWith(message, expect.any(Error));
    });

    it.each([true, false])('animates and disposes native morph storage on backend %s', async (isWebGPU) => {
        const theme = makeTheme(isWebGPU);
        const { gltf } = await loadAuthoredAsset();
        loadGltfCached.mockResolvedValueOnce(gltf);
        await theme.createJellyfish();
        const mesh = theme.jellyfishMesh;
        const writeBillboard = vi.spyOn(theme, 'writeBillboardInstance');
        const initialMatrices = mesh.instanceMatrix.array.slice();
        const initialMorphs = mesh.morphTexture.image.data.slice();
        theme.glowIntensity = 1.6;
        theme.updateOceanBillboards(1.37, 1);
        theme.updateOceanBillboards(1.37, 2);
        expect(mesh.instanceMatrix.array).toEqual(initialMatrices);
        expect(mesh.morphTexture.image.data).toEqual(initialMorphs);
        theme.updateOceanBillboards(1.37, 0);
        expect(writeBillboard).not.toHaveBeenCalled();
        expect(mesh.instanceMatrix.array).not.toEqual(initialMatrices);
        expect(mesh.morphTexture.image.data).not.toEqual(initialMorphs);
        expect(mesh.material.userData.uGlowIntensity.value).toBe(1.6);

        const disposeMorphTexture = vi.spyOn(mesh.morphTexture, 'dispose');
        const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose');
        const disposeMaterial = vi.spyOn(mesh.material, 'dispose');
        const sibling = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
        theme.scene.add(sibling);
        const disposeSiblingGeometry = vi.spyOn(sibling.geometry, 'dispose');
        const disposeSiblingMaterial = vi.spyOn(sibling.material, 'dispose');
        theme.disposeSceneContents();
        theme.disposeSceneContents();
        mesh.userData.dispose();
        expect(disposeMorphTexture).toHaveBeenCalledTimes(1);
        expect(disposeGeometry).toHaveBeenCalledTimes(1);
        expect(disposeMaterial).toHaveBeenCalledTimes(1);
        expect(disposeSiblingGeometry).toHaveBeenCalledTimes(1);
        expect(disposeSiblingMaterial).toHaveBeenCalledTimes(1);
        expect(theme.scene.children).toHaveLength(0);
    });

    it('waits for the replacement before warming deferred scene materials', async () => {
        const theme = makeTheme();
        Object.keys(theme.flags).filter((key) => key.startsWith('no')).forEach((key) => { theme.flags[key] = true; });
        theme.flags.noJellyfish = false;
        theme.createLighting = vi.fn();
        window.requestIdleCallback = (callback) => callback();
        vi.stubGlobal('requestAnimationFrame', (callback) => callback());
        const compiledPopulations = [];
        theme.renderer = {
            isWebGPURenderer: true,
            compileAsync: vi.fn(async () => { compiledPopulations.push(theme.jellyfishMesh); }),
            render: vi.fn(),
        };
        const load = deferredLoad();
        theme.buildScene();
        await theme.prewarmPromise;
        expect(theme.jellyfishMesh.userData.primitive).toBe('billboard-quad');
        expect(theme.renderer.compileAsync).toHaveBeenCalledTimes(1);
        expect(theme.deferredMaterialLoadComplete).toBe(false);
        const { gltf } = await loadAuthoredAsset();
        load.resolve(gltf);
        await theme.deferredMaterialLoadPromise;
        expect(theme.renderer.compileAsync).toHaveBeenCalledTimes(2);
        expect(compiledPopulations[1]).toBe(theme.jellyfishMesh);
        expect(compiledPopulations[1].userData.isOceanJellyfishModel).toBe(true);
        expect(theme.deferredMaterialLoadComplete).toBe(true);
    });

    it('defaults every quality tier to authored assets and retains a complete legacy comparison', async () => {
        const authored = makeTheme();
        for (const preset of Object.values(authored.qualityPresets)) expect(preset.atmosphere.blenderAssets).toBe(true);
        expect(authored.qualityPresets.High.atmosphere.heroCoralCount).toBe(4);
        expect(authored.qualityPresets.Medium.atmosphere.heroCoralCount).toBe(2);
        expect(authored.qualityPresets.Ultra.atmosphere.heroCoralCount).toBe(4);

        const legacy = makeTheme(true, '?oceanLegacyModels=1');
        for (const preset of Object.values(legacy.qualityPresets)) expect(preset.atmosphere.blenderAssets).toBe(false);
        expect(legacy.qualityPresets.High.atmosphere.heroCoralCount).toBe(2);
        await legacy.createJellyfish();
        expect(legacy.jellyfishMesh.userData.primitive).toBe('billboard-quad');
        expect(loadGltfCached).not.toHaveBeenCalled();
    });
});
