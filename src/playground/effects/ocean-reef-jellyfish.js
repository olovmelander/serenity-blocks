/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import { loadGltfCached } from '../../themes/ocean/ocean-asset-loader.js';
import { OCEAN_JELLYFISH_MODEL_URL } from '../../themes/ocean/ocean-blender-assets.js';
import { createOceanJellyfishModels } from '../../themes/ocean/ocean-jellyfish-model.js';
import { createJellyfishNodeMaterial } from '../../themes/ocean/ocean-materials.js';
/** Four calm side silhouettes for the fixed-time Ocean study. */
export function createReefJellyfishPreview() {
    const placements = [
        [-34, 42, -12, 13, 0.4],
        [46, 48, -42, 17, 2.1],
        [-63, 46, -74, 18, 3.8],
        [57, 34, -8, 10, 5.2],
    ];
    const palette = [0x8ad9e2, 0xafb1e7, 0x85c8de, 0xbdade3];
    const geometry = new THREE.PlaneGeometry(1, 1);
    const colors = new Float32Array(placements.length * 3);
    const phases = new Float32Array(placements.length);
    placements.forEach((placement, i) => {
        new THREE.Color(palette[i]).toArray(colors, i * 3);
        phases[i] = placement[4];
    });
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    const material = createJellyfishNodeMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    mesh.name = 'Ocean jellyfish silhouette preview';
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy = new THREE.Object3D();
    return {
        mesh,
        update(time, camera) {
            material.userData.uTime.value = time;
            material.userData.uGlowIntensity.value = 0.65;
            placements.forEach(([x, y, z, size, phase], i) => {
                dummy.position.set(
                    x + Math.sin(time * 0.18 + phase * 1.3) * 1.35,
                    y + Math.sin(time * 0.38 + phase) * 2.2,
                    z + Math.sin(time * 0.22 + phase * 0.8) * 1.1,
                );
                dummy.quaternion.copy(camera.quaternion);
                dummy.scale.setScalar(size * (Math.sin(time * 1.8 + phase) * 0.25 + 0.746));
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}

/** The same isolated four-creature study with Blender-authored geometry and clips. */
export async function createModeledReefJellyfishPreview() {
    const gltf = await loadGltfCached(OCEAN_JELLYFISH_MODEL_URL);
    const mesh = createOceanJellyfishModels(gltf, {
        count: 4,
        positions: new Float32Array([-34, 42, -12, 46, 48, -42, -63, 46, -74, 57, 34, -8]),
        sizes: new Float32Array([13, 17, 18, 10]),
        phases: new Float32Array([0.4, 2.1, 3.8, 5.2]),
    });
    gltf.scene.traverse((child) => {
        child.geometry?.dispose();
        child.material?.dispose();
    });
    gltf.scene.clear();
    return {
        mesh,
        update(time) { mesh.userData.update(time, 0.65); },
        dispose() { mesh.userData.dispose(); },
    };
}
