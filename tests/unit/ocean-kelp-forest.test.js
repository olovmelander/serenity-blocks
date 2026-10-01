import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { applyKelpForestComposition } from '../../src/themes/ocean/ocean-kelp-forest.js';
import { getReefSeabedHeight } from '../../src/themes/ocean/ocean-composition.js';

function samples(root) {
    const vertices = [];
    root.traverse((child) => {
        const positions = child.geometry?.attributes.position;
        for (let index = 0; index < (positions?.count ?? 0); index += 1) {
            vertices.push(new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld));
        }
    });
    return vertices;
}

function assertCanopy(root) {
    const vertices = samples(root);
    const box = new THREE.Box3().setFromPoints(vertices);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThanOrEqual(70);
    expect(size.y).toBeLessThanOrEqual(94);
    expect(Math.max(size.x, size.z)).toBeGreaterThanOrEqual(20);
    expect(Math.max(size.x, size.z)).toBeLessThanOrEqual(35);
    if (Math.max(size.x, size.z) > 24) {
        expect(Math.abs(root.position.x)).toBeGreaterThan(60);
        expect(root.position.z).toBeGreaterThan(0);
    }
    // The crowns can overlap at the sides, but the central view remains open.
    expect(Math.min(Math.abs(box.min.x), Math.abs(box.max.x))).toBeGreaterThan(22);
    for (const vertex of vertices) {
        if (vertex.y > box.min.y + 0.32 + 1e-6) continue;
        expect(vertex.y - getReefSeabedHeight(vertex.x, vertex.z)).toBeLessThanOrEqual(-0.179);
    }
}

describe('Ocean kelp forest staging', () => {
    it('creates tall grounded canopy layers from the real asset without adding geometry or draws', async () => {
        const bytes = readFileSync(new URL('../../src/themes/ocean/assets/blender-reef/kelp.glb', import.meta.url));
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const gltf = await new GLTFLoader().parseAsync(buffer, '');
        const roots = Array.from({ length: 12 }, () => gltf.scene.clone(true));
        const parent = new THREE.Group();
        roots.forEach((root, index) => {
            root.position.set(index * 4 - 18, -20, -index * 10);
            root.scale.setScalar(1.7);
            parent.add(root);
        });
        const before = roots.map((root) => {
            const meshes = [];
            root.traverse((child) => { if (child.isMesh) meshes.push(child); });
            return meshes.map((mesh) => ({ geometry: mesh.geometry, material: mesh.material }));
        });
        const atmosphere = { heroKelp: roots, getSeabedHeight: getReefSeabedHeight };
        applyKelpForestComposition(atmosphere);
        const matrices = roots.map((root) => root.matrixWorld.toArray());
        roots.forEach(assertCanopy);
        for (let frame = 0; frame < 120; frame += 1) applyKelpForestComposition(atmosphere);
        roots.forEach((root, index) => {
            expect(root.matrixWorld.toArray()).toEqual(matrices[index]);
            const meshes = [];
            root.traverse((child) => { if (child.isMesh) meshes.push(child); });
            expect(meshes).toHaveLength(before[index].length);
            meshes.forEach((mesh, meshIndex) => {
                expect(mesh.geometry).toBe(before[index][meshIndex].geometry);
                expect(mesh.material).toBe(before[index][meshIndex].material);
            });
        });
        expect(new Set(roots.map((root) => Math.round(root.position.z / 30))).size).toBeGreaterThan(5);
        gltf.scene.traverse((child) => {
            child.geometry?.dispose();
            child.material?.dispose();
        });
    });

    it('restages deferred replacements and respects both frozen local and world matrix flags', () => {
        const geometry = new THREE.BoxGeometry(2, 5, 2).translate(0, 2.5, 0);
        const material = new THREE.MeshBasicMaterial();
        const makeRoot = (scale) => {
            const root = new THREE.Group();
            root.add(new THREE.Mesh(geometry, material));
            root.position.set(-36, -19, 38);
            root.scale.setScalar(scale);
            root.updateMatrixWorld(true);
            root.traverse((child) => {
                child.matrixAutoUpdate = false;
                child.matrixWorldAutoUpdate = false;
            });
            return root;
        };
        const original = makeRoot(1);
        const atmosphere = { heroKelp: [original], getSeabedHeight: getReefSeabedHeight };
        applyKelpForestComposition(atmosphere);
        assertCanopy(original);
        const replacement = makeRoot(3);
        atmosphere.heroKelp[0] = replacement;
        applyKelpForestComposition(atmosphere);
        assertCanopy(replacement);
        expect(replacement.position.distanceTo(original.position)).toBeLessThan(1e-8);
        replacement.traverse((child) => {
            expect(child.matrixAutoUpdate).toBe(false);
            expect(child.matrixWorldAutoUpdate).toBe(false);
        });
        const matrix = replacement.matrixWorld.toArray();
        applyKelpForestComposition(atmosphere);
        expect(replacement.matrixWorld.toArray()).toEqual(matrix);
        geometry.dispose();
        material.dispose();
    });
});
