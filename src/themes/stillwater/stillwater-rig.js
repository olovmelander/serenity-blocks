/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — a figure's body from its file.
 *
 * The troll and the spirit ship as compact GLBs written by `scripts/blender/stillwater_figures.py`:
 * one mesh (positions quantised to 16 bits, normals to 8, a packed colour that says what each
 * vertex is, four joints and weights), with the skeleton in the scene's extras as
 * `{ bones: [{ name, parent, head, tail }] }` in the model's own unit frame (y up, facing +z).
 * Every bone rests unrotated, so posing is a matter of rotations in the model's own axes.
 *
 * Here the file becomes a THREE.SkinnedMesh: the quantised attributes are widened to floats once
 * (so both backends take them as they are), the bones are built from their heads, and the mesh is
 * bound in its rest pose.
 */

import * as THREE from 'three/webgpu';

/** Read an attribute (quantised, normalised or interleaved) into a plain Float32 one. */
function widen(attribute, itemSize, transform = null) {
    const out = new Float32Array(attribute.count * itemSize);
    const v = [0, 0, 0, 0];
    for (let i = 0; i < attribute.count; i++) {
        v[0] = attribute.getX(i);
        if (itemSize > 1) v[1] = attribute.getY(i);
        if (itemSize > 2) v[2] = attribute.getZ(i);
        if (itemSize > 3) v[3] = attribute.getW(i);
        if (transform) transform(v);
        for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = v[k];
    }
    return new THREE.BufferAttribute(out, itemSize);
}

/** Copy an attribute's raw values into a fresh, non-interleaved one of the same type. */
function compact(attribute) {
    const { itemSize, count, normalized } = attribute;
    const Type = attribute.array.constructor;
    const out = new Type(count * itemSize);
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < itemSize; k++) {
            out[i * itemSize + k] = attribute.array[attribute.isInterleavedBufferAttribute
                ? i * attribute.data.stride + attribute.offset + k
                : i * itemSize + k];
        }
    }
    return new THREE.BufferAttribute(out, itemSize, normalized);
}

/**
 * The skeleton described by a figure file's extras.
 * @param {{ bones: { name: string, parent: number, head: number[] }[] }} spec
 * @returns {{ bones: THREE.Bone[], byName: Record<string, THREE.Bone>, roots: THREE.Bone[], rest: Record<string, THREE.Vector3> }}
 */
export function skeletonFromSpec(spec) {
    const list = spec.bones || [];
    const bones = list.map((b) => {
        const bone = new THREE.Bone();
        bone.name = b.name;
        return bone;
    });
    const byName = {};
    const rest = {};
    const roots = [];
    list.forEach((b, i) => {
        const bone = bones[i];
        const parent = b.parent >= 0 ? list[b.parent] : null;
        bone.position.set(
            b.head[0] - (parent ? parent.head[0] : 0),
            b.head[1] - (parent ? parent.head[1] : 0),
            b.head[2] - (parent ? parent.head[2] : 0),
        );
        if (parent) bones[b.parent].add(bone);
        else roots.push(bone);
        byName[b.name] = bone;
        rest[b.name] = new THREE.Vector3(b.head[0], b.head[1], b.head[2]);
    });
    return {
        bones, byName, roots, rest,
    };
}

/**
 * Make the skinned figure from a loaded GLTF (GLTFLoader result) of one of the figure files.
 * @param {object} gltf
 * @param {THREE.Material} material
 * @returns {{ mesh: THREE.SkinnedMesh, bones: Record<string, THREE.Bone>, rest: Record<string, THREE.Vector3>,
 *   tails: Record<string, THREE.Vector3>, extras: object }}
 */
export function buildFigure(gltf, material) {
    let node = null;
    gltf.scene.traverse((o) => {
        if (o.isMesh && !node) node = o;
    });
    if (!node) throw new Error('figure file has no mesh');
    const extras = gltf.parser?.json?.scenes?.[0]?.extras || gltf.scene.userData || {};
    if (!Array.isArray(extras.bones) || !extras.bones.length) throw new Error('figure file has no skeleton');
    node.updateMatrix();
    const src = node.geometry;
    const geometry = new THREE.BufferGeometry();
    // The node's scale and translation restore metres from the quantised positions.
    const s = node.scale;
    const t = node.position;
    geometry.setAttribute('position', widen(src.attributes.position, 3, (v) => {
        v[0] = v[0] * s.x + t.x;
        v[1] = v[1] * s.y + t.y;
        v[2] = v[2] * s.z + t.z;
    }));
    if (src.attributes.normal) {
        geometry.setAttribute('normal', widen(src.attributes.normal, 3, (v) => {
            const l = Math.hypot(v[0], v[1], v[2]) || 1;
            v[0] /= l;
            v[1] /= l;
            v[2] /= l;
        }));
    } else geometry.computeVertexNormals();
    if (src.attributes.color) geometry.setAttribute('color', compact(src.attributes.color));
    geometry.setAttribute('skinIndex', compact(src.attributes.skinIndex));
    geometry.setAttribute('skinWeight', compact(src.attributes.skinWeight));
    if (src.index) geometry.setIndex(compact(src.index));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    src.dispose();

    const skel = skeletonFromSpec(extras);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    skel.roots.forEach((root) => mesh.add(root));
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(skel.bones));
    mesh.frustumCulled = false;
    const tails = {};
    extras.bones.forEach((b) => {
        if (Array.isArray(b.tail)) tails[b.name] = new THREE.Vector3(b.tail[0], b.tail[1], b.tail[2]);
    });
    return {
        mesh, bones: skel.byName, rest: skel.rest, tails, extras,
    };
}
