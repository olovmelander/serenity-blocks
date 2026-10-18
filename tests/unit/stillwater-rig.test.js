/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — a figure's body from its file (stillwater-rig.js).
 *
 * The troll and the spirit ship as compact GLBs: one mesh with quantised attributes, and the
 * skeleton written into the scene's extras as heads and parents. Here the real files are parsed by
 * three's own loader (as the game does) and built into skinned meshes: the bones must be the
 * file's, each resting where the file puts its head, and the mesh must be the file's own positions,
 * widened to floats without a vertex moving, bound to a skeleton its weights can be read against.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildFigure, skeletonFromSpec } from '../../src/themes/stillwater/stillwater-rig.js';

const FILES = ['troll-lod0.glb', 'troll-lod1.glb', 'troll-lod2.glb', 'troll-lod3.glb', 'spirit-lod0.glb',
    'spirit-lod1.glb'];

const bytesOf = (file) => readFileSync(new URL(`../../src/themes/stillwater/assets/${file}`, import.meta.url));

/** The file as the game's loader reads it. */
function load(file) {
    const bytes = bytesOf(file);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Promise((resolve, reject) => {
        new GLTFLoader().parse(data, '', resolve, reject);
    });
}

/** The file's JSON and binary chunks, read by hand. */
function chunks(file) {
    const bytes = bytesOf(file);
    const jsonLength = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
    const binStart = 20 + jsonLength + 8;
    return { json, bin: bytes.subarray(binStart, binStart + bytes.readUInt32LE(20 + jsonLength)) };
}

/** The file's own positions in metres of the model: the int16 values, normalised, scaled and moved by the node. */
function dequantisedPositions(file) {
    const { json, bin } = chunks(file);
    const node = json.nodes.find((n) => n.mesh === 0);
    const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
    expect(accessor.componentType).toBe(5122); // int16
    expect(accessor.normalized).toBe(true);
    const view = json.bufferViews[accessor.bufferView];
    const stride = view.byteStride || 6;
    const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const scale = node.scale || [1, 1, 1];
    const move = node.translation || [0, 0, 0];
    const out = new Float64Array(accessor.count * 3);
    for (let i = 0; i < accessor.count; i++) {
        for (let k = 0; k < 3; k++) {
            const raw = bin.readInt16LE(offset + i * stride + k * 2);
            out[i * 3 + k] = Math.max(raw / 32767, -1) * scale[k] + move[k];
        }
    }
    return out;
}

describe('stillwater rig: the skeleton from a file\'s extras', () => {
    it('builds the hierarchy the bone list names, each bone resting at its head', () => {
        for (const file of ['troll-lod1.glb', 'spirit-lod0.glb']) {
            const spec = chunks(file).json.scenes[0].extras;
            const skel = skeletonFromSpec(spec);
            expect(skel.bones.map((bone) => bone.name), file).toEqual(spec.bones.map((b) => b.name));
            const holder = new THREE.Group();
            skel.roots.forEach((root) => holder.add(root));
            holder.updateMatrixWorld(true);
            spec.bones.forEach((b, i) => {
                const bone = skel.bones[i];
                const label = `${file}: ${b.name}`;
                expect(skel.byName[b.name], label).toBe(bone);
                if (b.parent < 0) {
                    expect(skel.roots, label).toContain(bone);
                    expect(bone.parent, label).toBe(holder);
                } else {
                    expect(bone.parent, label).toBe(skel.bones[b.parent]);
                }
                // At rest every bone is unturned: its offsets from its parents add up to its head.
                expect(bone.quaternion.angleTo(new THREE.Quaternion()), label).toBe(0);
                const at = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
                expect(at.distanceTo(new THREE.Vector3(...b.head)), label).toBeLessThan(1e-9);
                expect(skel.rest[b.name].toArray(), label).toEqual(b.head);
            });
            expect(skel.roots.length, file).toBeGreaterThan(0);
        }
    });

    it('adds up a chain of offsets, and takes a spec with no bones for an empty skeleton', () => {
        const spec = {
            bones: [
                { name: 'a', parent: -1, head: [1, 2, 3] },
                { name: 'b', parent: 0, head: [1, 3, 3] },
                { name: 'c', parent: 1, head: [2, 3, 5] },
                { name: 'd', parent: 0, head: [0, 2, 3] },
            ],
        };
        const skel = skeletonFromSpec(spec);
        expect(skel.byName.a.position.toArray()).toEqual([1, 2, 3]);
        expect(skel.byName.b.position.toArray()).toEqual([0, 1, 0]);
        expect(skel.byName.c.position.toArray()).toEqual([1, 0, 2]);
        expect(skel.byName.d.position.toArray()).toEqual([-1, 0, 0]);
        expect(skel.byName.a.children).toEqual([skel.byName.b, skel.byName.d]);
        expect(skel.roots).toEqual([skel.byName.a]);
        const none = skeletonFromSpec({});
        expect(none.bones).toEqual([]);
        expect(none.roots).toEqual([]);
    });
});

describe('stillwater rig: a figure from its file', () => {
    it.each(FILES)('makes %s one skinned mesh on the file\'s own skeleton', async (file) => {
        const gltf = await load(file);
        const material = new THREE.MeshBasicMaterial();
        const built = buildFigure(gltf, material);
        const spec = chunks(file).json.scenes[0].extras;
        const { mesh } = built;
        expect(mesh.isSkinnedMesh).toBe(true);
        expect(mesh.material).toBe(material);
        expect(mesh.frustumCulled).toBe(false);
        expect(built.extras.bones).toEqual(spec.bones);
        // The bones, by the file's names, in the file's order, bound in their rest pose.
        const names = spec.bones.map((b) => b.name);
        expect(Object.keys(built.bones)).toEqual(names);
        expect(mesh.skeleton.bones.map((bone) => bone.name)).toEqual(names);
        mesh.updateMatrixWorld(true);
        spec.bones.forEach((b) => {
            const at = new THREE.Vector3().setFromMatrixPosition(built.bones[b.name].matrixWorld);
            expect(at.distanceTo(new THREE.Vector3(...b.head)), b.name).toBeLessThan(1e-9);
            expect(built.rest[b.name].toArray(), b.name).toEqual(b.head);
            if (b.tail) expect(built.tails[b.name].toArray(), b.name).toEqual(b.tail);
        });
        // Bound at rest: each bone's inverse is the inverse of where it stands.
        const identity = new THREE.Matrix4().elements;
        mesh.skeleton.bones.forEach((bone, i) => {
            const product = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[i]);
            const off = Math.max(...product.elements.map((v, k) => Math.abs(v - identity[k])));
            expect(off, bone.name).toBeLessThan(1e-9);
        });
    });

    it.each(FILES)('widens %s to floats without moving a vertex, and weighs every vertex whole', async (file) => {
        const gltf = await load(file);
        const { mesh } = buildFigure(gltf, new THREE.MeshBasicMaterial());
        const { geometry } = mesh;
        const position = geometry.getAttribute('position');
        expect(position.array).toBeInstanceOf(Float32Array);
        expect(position.normalized).toBe(false);
        expect(position.isInterleavedBufferAttribute).toBeFalsy();
        const expected = dequantisedPositions(file);
        expect(position.count * 3).toBe(expected.length);
        let worst = 0;
        for (let i = 0; i < expected.length; i++) worst = Math.max(worst, Math.abs(position.array[i] - expected[i]));
        expect(worst).toBeLessThan(1e-6);
        // Unit normals, one per vertex.
        const normal = geometry.getAttribute('normal');
        expect(normal.array).toBeInstanceOf(Float32Array);
        expect(normal.count).toBe(position.count);
        let unit = 0;
        for (let i = 0; i < normal.count; i++) {
            unit = Math.max(unit, Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1));
        }
        expect(unit).toBeLessThan(1e-5);
        // The colour that says what each vertex is: four channels, each in 0..1.
        const color = geometry.getAttribute('color');
        expect(color.itemSize).toBe(4);
        expect(color.count).toBe(position.count);
        // Four joints of the skeleton and four weights that sum to one, for every vertex.
        const joints = geometry.getAttribute('skinIndex');
        const weights = geometry.getAttribute('skinWeight');
        expect(joints.count).toBe(position.count);
        expect(weights.count).toBe(position.count);
        const bones = mesh.skeleton.bones.length;
        let whole = 0;
        const strays = [];
        for (let i = 0; i < position.count; i++) {
            const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
            whole = Math.max(whole, Math.abs(sum - 1));
            for (const read of ['getX', 'getY', 'getZ', 'getW']) {
                const joint = joints[read](i);
                if (!(Number.isInteger(joint) && joint >= 0 && joint < bones) && strays.length < 5) strays.push(i);
            }
        }
        expect(whole).toBeLessThan(1e-6);
        expect(strays).toEqual([]);
        // Every triangle names vertices the mesh has.
        const index = geometry.getIndex();
        expect(index.count % 3).toBe(0);
        let highest = 0;
        for (let i = 0; i < index.count; i++) highest = Math.max(highest, index.getX(i));
        expect(highest).toBeLessThan(position.count);
        // Measured in the model's own unit frame: from the sole the file names to its top.
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        expect(box.min.y).toBeCloseTo(built0(gltf).sole, 2);
        expect(box.max.y).toBeCloseTo(built0(gltf).top, 2);
    });

    it('refuses a file with no mesh, or no skeleton, in so many words', () => {
        const bones = [{ name: 'hips', parent: -1, head: [0, 0, 0] }];
        const empty = { scene: new THREE.Group(), parser: { json: { scenes: [{ extras: { bones } }] } } };
        expect(() => buildFigure(empty, new THREE.MeshBasicMaterial())).toThrow(/no mesh/);
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
        const boneless = { scene, parser: { json: { scenes: [{ extras: {} }] } } };
        expect(() => buildFigure(boneless, new THREE.MeshBasicMaterial())).toThrow(/no skeleton/);
    });
});

/** The extras the loader kept for the scene (the sole and top of the figure). */
function built0(gltf) {
    return gltf.parser.json.scenes[0].extras;
}
