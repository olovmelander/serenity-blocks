import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import {
    AnimationMixer, Box3, LoopOnce, Matrix4, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
    getBlenderCoralRecords, getBlenderKelpRecords, getBlenderReefRecords,
} from '../../src/themes/ocean/ocean-blender-assets.js';

const assetDirectory = new URL('../../src/themes/ocean/assets/blender-reef/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('asset-manifest.json', assetDirectory), 'utf8'));
const triangleBudgets = {
    'anemone-lantern': 900,
    'coral-antler': 1000,
    'coral-fan': 2200,
    'coral-foliose': 1600,
    'coral-rosette': 1200,
    'coral-sponge': 1600,
    'coral-staghorn': 2200,
    'creature-cuttlefish': 1000,
    'creature-manta': 1000,
    'fish-ember-anthias': 260,
    'fish-moon-sardine': 260,
    'fish-prism-tang': 260,
    'fish-sun-banner': 260,
    'grass-meadow': 450,
    jellyfish: 1600,
    kelp: 1600,
    'pearl-cluster': 650,
    'reef-arch': 1400,
    'reef-buttress': 2000,
    'reef-outcrop': 1600,
    'seaweed-spiral': 700,
    'stone-ridge': 650,
};
const animatedAssets = [
    'jellyfish', 'kelp', 'coral-fan',
    'anemone-lantern', 'seaweed-spiral', 'grass-meadow', 'pearl-cluster',
    'fish-prism-tang', 'fish-sun-banner', 'fish-ember-anthias', 'fish-moon-sardine',
    'creature-manta', 'creature-cuttlefish',
];

async function loadAsset(asset) {
    const bytes = readFileSync(new URL(asset.file, assetDirectory));
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const meshes = [];
    gltf.scene.traverse((object) => { if (object.isMesh) meshes.push(object); });
    expect(meshes).toHaveLength(1);
    return {
        bytes, json, gltf, mesh: meshes[0],
    };
}

function disposeAsset({ mesh }) {
    mesh.geometry.dispose();
    mesh.material.dispose();
}

function samplePositions(mesh) {
    const result = new Float32Array(mesh.geometry.attributes.position.count * 3);
    const vertex = new Vector3();
    for (let index = 0; index < result.length / 3; index++) {
        // Includes the actual morph deltas, not merely the animation's weight values.
        mesh.getVertexPosition(index, vertex);
        vertex.toArray(result, index * 3);
    }
    expect(Array.from(result).every(Number.isFinite)).toBe(true);
    return result;
}

function maximumDifference(first, second) {
    let maximum = 0;
    for (let index = 0; index < first.length; index++) {
        maximum = Math.max(maximum, Math.abs(first[index] - second[index]));
    }
    return maximum;
}

describe('Blender-authored Ocean asset contracts', () => {
    it('keeps a portable, complete manifest and a bounded combined asset payload', () => {
        const files = readdirSync(assetDirectory).filter((file) => file.endsWith('.glb')).sort();
        expect(manifest.assets.map((asset) => asset.file).sort()).toEqual(files);
        expect(manifest.assets.map((asset) => asset.id).sort()).toEqual(Object.keys(triangleBudgets).sort());
        expect(manifest.totals.files).toBe(22);
        expect(manifest.totals.bytes).toBe(manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0));
        expect(manifest.totals.vertices).toBe(manifest.assets.reduce((sum, asset) => sum + asset.vertexCount, 0));
        expect(manifest.totals.triangles).toBe(manifest.assets.reduce((sum, asset) => sum + asset.triangleCount, 0));
        expect(manifest.totals.bytes).toBeLessThanOrEqual(1024 * 1024);
        expect(manifest.totals.triangles).toBeLessThanOrEqual(22000);
        expect(manifest.assets.filter((asset) => asset.animations.length > 0).map((asset) => asset.id).sort())
            .toEqual([...animatedAssets].sort());
        const authoringManifests = ['living', 'garden', 'fauna'].map((family) => (
            JSON.parse(readFileSync(new URL(`${family}-assets-manifest.json`, assetDirectory), 'utf8'))
        ));
        for (const document of [manifest, ...authoringManifests]) {
            expect(JSON.stringify(document)).not.toMatch(/[A-Z]:\\|\/Users\/|\/home\//i);
            for (const asset of document.assets) {
                expect(asset.file).not.toMatch(/[\\/]/);
                expect(asset.path).toBeUndefined();
                const canonical = manifest.assets.find((entry) => entry.file === asset.file);
                expect(canonical).toBeDefined();
                expect(asset.bytes).toBe(canonical.bytes);
                expect(asset.triangleCount).toBe(canonical.triangleCount);
            }
        }
        const sourceCounts = manifest.assets.reduce((counts, asset) => {
            counts[asset.source] = (counts[asset.source] ?? 0) + 1;
            return counts;
        }, {});
        expect(sourceCounts).toEqual({
            'scripts/blender/ocean_living_assets.py': 2,
            'scripts/blender/ocean_reef_assets.py': 6,
            'scripts/blender/ocean_garden_assets.py': 8,
            'scripts/blender/ocean_fauna_assets.py': 6,
        });
    });

    it('keeps runtime registry budgets aligned with the actual exported files', () => {
        const records = [...getBlenderCoralRecords(), ...getBlenderKelpRecords(), ...getBlenderReefRecords()];
        expect(records).toHaveLength(7);
        for (const record of records) {
            const file = new URL(record.url).pathname.split('/').pop();
            const asset = manifest.assets.find((entry) => entry.file === file);
            expect(asset).toBeDefined();
            expect(record.triangleCount).toBe(asset.triangleCount);
            expect(record.byteSize).toBe(asset.bytes);
        }
    });

    it.each(manifest.assets)('$file is texture-free and stays within geometry and byte budgets', async (asset) => {
        const loaded = await loadAsset(asset);
        try {
            const { bytes, json, mesh } = loaded;
            expect(bytes.length).toBe(asset.bytes);
            expect(bytes.length).toBeLessThanOrEqual(128 * 1024);
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
            expect(json.meshes).toHaveLength(1);
            expect(json.meshes[0].primitives).toHaveLength(1);
            expect(json.materials).toHaveLength(1);
            expect(json.textures ?? []).toHaveLength(0);
            expect(json.images ?? []).toHaveLength(0);
            expect(json.buffers.every((buffer) => !buffer.uri)).toBe(true);
            const primitive = json.meshes[0].primitives[0];
            expect(primitive.mode ?? 4).toBe(4);
            expect(primitive.material).toBe(0);
            expect(primitive.attributes.COLOR_0).toBeDefined();
            const { geometry } = mesh;
            expect(geometry.index.count % 3).toBe(0);
            expect(geometry.index.count / 3).toBe(asset.triangleCount);
            expect(asset.triangleCount).toBeLessThanOrEqual(triangleBudgets[asset.id]);
            expect(geometry.attributes.position.count).toBe(asset.vertexCount);
            expect(geometry.attributes.color.count).toBe(asset.vertexCount);
            expect(mesh.material.vertexColors).toBe(true);
            const attributes = [
                ...Object.values(geometry.attributes),
                ...Object.values(geometry.morphAttributes).flat(),
            ];
            for (const attribute of attributes) {
                expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
            }
            expect(Array.from(geometry.index.array).every((index) => index < asset.vertexCount)).toBe(true);
            geometry.computeBoundingBox();
            const minimum = geometry.boundingBox.min.toArray();
            const maximum = geometry.boundingBox.max.toArray();
            const restBounds = new Box3().setFromBufferAttribute(geometry.attributes.position);
            for (let axis = 0; axis < 3; axis++) {
                expect(Number.isFinite(minimum[axis]) && Number.isFinite(maximum[axis])).toBe(true);
                expect(maximum[axis]).toBeGreaterThan(minimum[axis]);
                expect(restBounds.min.getComponent(axis)).toBeCloseTo(asset.bounds.min[axis], 5);
                expect(restBounds.max.getComponent(axis)).toBeCloseTo(asset.bounds.max[axis], 5);
            }
            if (asset.id === 'jellyfish') {
                expect(geometry.attributes.color.itemSize).toBe(4);
                expect(mesh.material.transparent).toBe(true);
            }
            if (asset.source.endsWith('ocean_garden_assets.py')) {
                expect(restBounds.min.y).toBeCloseTo(0, 6);
            }
            if (asset.source.endsWith('ocean_fauna_assets.py')) {
                expect(mesh.userData.forwardAxis).toBe('+X');
            }
            loaded.gltf.scene.updateWorldMatrix(true, true);
            expect(mesh.matrixWorld.equals(new Matrix4())).toBe(true);
        } finally {
            disposeAsset(loaded);
        }
    });

    it.each(animatedAssets)('%s deforms and has a closed animation seam', async (id) => {
        const asset = manifest.assets.find((entry) => entry.id === id);
        const loaded = await loadAsset(asset);
        const { gltf, mesh } = loaded;
        const mixer = new AnimationMixer(gltf.scene);
        try {
            expect(gltf.animations).toHaveLength(1);
            expect(mesh.geometry.morphAttributes.position).toHaveLength(2);
            expect(Object.keys(mesh.morphTargetDictionary)).toEqual(asset.shapeKeys);
            const expectedShapes = asset.source.endsWith('ocean_fauna_assets.py')
                ? ['swimBend', 'finSweep'] : {
                    jellyfish: ['bellPulse', 'currentSway'],
                    'coral-fan': ['CurrentForward', 'CurrentReturn'],
                }[id] ?? ['currentSway', 'crossSway'];
            expect(asset.shapeKeys).toEqual(expectedShapes);
            const [clip] = gltf.animations;
            expect(clip.name).toBe(asset.animations[0].name);
            expect(clip.tracks.every((track) => track.name.endsWith('.morphTargetInfluences'))).toBe(true);
            const firstTime = Math.min(...clip.tracks.map((track) => track.times[0]));
            const lastTime = Math.max(...clip.tracks.map((track) => track.times[track.times.length - 1]));
            expect(lastTime - firstTime).toBeCloseTo(id === 'coral-fan' ? 6 : 4, 5);
            expect(firstTime).toBeCloseTo(asset.animations[0].startSeconds, 5);
            expect(lastTime).toBeCloseTo(asset.animations[0].endSeconds, 5);
            const action = mixer.clipAction(clip);
            // LoopOnce prevents an end-time wrap from concealing a broken authored seam.
            action.setLoop(LoopOnce, 1);
            action.clampWhenFinished = true;
            const sample = (time) => {
                action.reset().play();
                mixer.setTime(time);
                return samplePositions(mesh);
            };
            const start = sample(firstTime);
            const middle = sample(firstTime + (lastTime - firstTime) * 0.29);
            const end = sample(lastTime);
            expect(maximumDifference(start, middle)).toBeGreaterThan(0.02);
            expect(maximumDifference(start, end)).toBeLessThan(1e-5);
        } finally {
            mixer.stopAllAction();
            mixer.uncacheRoot(gltf.scene);
            disposeAsset(loaded);
        }
    });
});
