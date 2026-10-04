import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { describe, expect, it } from 'vitest';
import { createCityBlocksTSL } from './urban-dreams.tsl.js';

function city(bankCount) {
    const part = createCityBlocksTSL(undefined, undefined, { bankCount });
    const towers = part.group.getObjectByName('city-tower-instances-tsl');
    const boxes = [];
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < towers.count; i += 1) {
        towers.getMatrixAt(i, matrix);
        boxes.push(new THREE.Box3(
            new THREE.Vector3(-0.5, -0.5, -0.5),
            new THREE.Vector3(0.5, 0.5, 0.5),
        ).applyMatrix4(matrix));
    }
    return {
        towers,
        boxes,
        dispose() {
            part.geometries.forEach((geometry) => geometry.dispose());
            part.materials.forEach((material) => material.dispose());
        },
    };
}

describe('Urban city window stability', () => {
    it('emits flat shader inputs so window hashes cannot amplify interpolation noise', () => {
        const { towers, dispose } = city(6);
        const renderer = {
            contextNode: context(),
            lighting: { enabled: false },
            backend: { device: null, capabilities: { getUniformBufferLimit: () => 65536 } },
            getRenderTarget: () => null,
            getMRT: () => null,
            shadowMap: { enabled: false, type: 0 },
            capabilities: {},
            library: { fromMaterial: (material) => material },
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
        try {
            const builder = new THREE.WGSLNodeBuilder(towers, renderer);
            builder.scene = new THREE.Scene();
            builder.camera = new THREE.PerspectiveCamera();
            builder.context.material = towers.material;
            builder.material = towers.material;
            builder.build();
            for (const name of ['vCityFacade', 'vCityDimensions', 'vCityFaceNormal', 'vCityGutter']) {
                const flatInput = new RegExp(`@interpolate\\(\\s*flat\\s*\\)\\s+${name}\\s*:`);
                expect(builder.fragmentShader).toMatch(flatInput);
            }
        } finally { dispose(); }
    });

    it.each([6, 4])('keeps %i-bank towers separate so window facades cannot intersect', (banks) => {
        const { boxes, dispose } = city(banks);
        try {
            let minimumClearance = Infinity;
            for (let i = 0; i < boxes.length; i += 1) {
                for (let j = i + 1; j < boxes.length; j += 1) {
                    const a = boxes[i];
                    const b = boxes[j];
                    const clearanceX = Math.max(a.min.x - b.max.x, b.min.x - a.max.x);
                    const clearanceZ = Math.max(a.min.z - b.max.z, b.min.z - a.max.z);
                    minimumClearance = Math.min(minimumClearance, Math.max(clearanceX, clearanceZ));
                }
            }
            expect(minimumClearance).toBeGreaterThan(2.9);
            boxes.forEach((box) => {
                expect(box.min.y).toBeCloseTo(-60, 4);
                expect(Math.min(Math.abs(box.min.x), Math.abs(box.max.x))).toBeGreaterThanOrEqual(24);
            });
        } finally { dispose(); }
    });

    it('keeps the inner towers and their windows identical across quality tiers', () => {
        const high = city(6);
        const low = city(4);
        try {
            // Compare the actual geometry buffers, not a second copy of the placement algorithm.
            for (let i = 0; i < low.towers.count; i += 1) {
                const highIndex = Math.floor(i / 4) * 6 + (i % 4);
                expect(low.boxes[i].equals(high.boxes[highIndex])).toBe(true);
                for (const name of ['aFacade', 'aDims']) {
                    const lowAttribute = low.towers.geometry.getAttribute(name);
                    const highAttribute = high.towers.geometry.getAttribute(name);
                    for (let c = 0; c < lowAttribute.itemSize; c += 1) {
                        expect(lowAttribute.array[i * lowAttribute.itemSize + c])
                            .toBe(highAttribute.array[highIndex * highAttribute.itemSize + c]);
                    }
                }
            }
        } finally { high.dispose(); low.dispose(); }
    });
});
