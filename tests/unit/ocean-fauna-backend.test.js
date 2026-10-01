import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import { OceanFishSystem } from '../../src/themes/ocean/ocean-fish-system.js';
import { OceanReefDwellerSystem } from '../../src/themes/ocean/ocean-reef-dweller-system.js';
import { OceanRareFaunaSystem } from '../../src/themes/ocean/ocean-rare-fauna-system.js';
import { disposeReefCausticTexture } from '../../src/themes/ocean/ocean-caustics.js';

vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({ loadGltfCached: vi.fn() }));

const resources = [];
afterEach(() => {
    resources.forEach((resource) => resource.dispose());
    resources.length = 0;
    disposeReefCausticTexture();
});

const converters = [
    ['hero fish', OceanFishSystem, 'prepareHeroAsset'],
    ['seahorse', OceanReefDwellerSystem, 'prepareSeahorseAsset'],
    ['rare fauna', OceanRareFaunaSystem, 'prepareAsset'],
];

function prepareColoredAsset(System, method, isWebGPU) {
    const system = Object.create(System.prototype);
    system.isWebGPU = isWebGPU;
    const geometry = new THREE.BoxGeometry();
    const colors = new Float32Array(geometry.attributes.position.count * 3).fill(0.5);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const map = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ map, normalMap, color: 0x729da3 });
    const sourceDispose = vi.spyOn(source, 'dispose');
    // Material arrays occur on imported GLBs; preserve the array contract.
    const root = new THREE.Mesh(geometry, [source]);
    root.name = 'turtle-body';
    system[method](root);
    const material = root.material[0];
    resources.push(geometry, map, normalMap, material);
    return {
        root, material, map, normalMap, sourceDispose,
    };
}

describe('Ocean imported fauna material backend', () => {
    it.each(converters)('keeps %s compatible with the classic WebGL shader library', (_name, System, method) => {
        const {
            root, material, map, normalMap, sourceDispose,
        } = prepareColoredAsset(System, method, false);
        expect(Array.isArray(root.material)).toBe(true);
        expect(material.type).toBe('MeshStandardMaterial');
        expect(material.isNodeMaterial).not.toBe(true);
        expect(material.colorNode).toBeUndefined();
        expect(material.emissiveNode).toBeUndefined();
        expect(material.map).toBe(map);
        expect(material.normalMap).toBe(normalMap);
        expect(material.vertexColors).toBe(true);
        expect(material.fog).toBe(true);
        expect(sourceDispose).toHaveBeenCalledTimes(1);
    });

    it.each(converters)('retains the %s WebGPU shading graph', (_name, System, method) => {
        const { material, map, sourceDispose } = prepareColoredAsset(System, method, true);
        expect(material.isNodeMaterial).toBe(true);
        expect(material.emissiveNode?.isNode).toBe(true);
        expect(material.map).toBe(map);
        expect(material.vertexColors).toBe(true);
        expect(sourceDispose).toHaveBeenCalledTimes(1);
    });

    it('records the renderer backend for deferred rare-fauna loading', () => {
        const legacy = new OceanRareFaunaSystem();
        const webgpu = new OceanRareFaunaSystem({ isWebGPU: true });
        expect(legacy.isWebGPU).toBe(false);
        expect(webgpu.isWebGPU).toBe(true);
        legacy.dispose();
        webgpu.dispose();
    });
});
