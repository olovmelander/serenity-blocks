/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** Small geometry builders shared by the worlds that put real meshes in front of the backdrop. */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A solid's edges as one mesh of thin tubes with a bead on every corner. Lines are one pixel
 * wide on WebGPU whatever the material says; tubes keep their weight at every resolution.
 */
export function edgeTubes(source, radius, radialSegments = 5) {
    const edges = new THREE.EdgesGeometry(source, 1);
    const { position } = edges.attributes;
    const parts = [];
    const corners = new Map();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    for (let i = 0; i < position.count; i += 2) {
        a.fromBufferAttribute(position, i);
        b.fromBufferAttribute(position, i + 1);
        direction.subVectors(b, a);
        const tube = new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments, 1, true);
        tube.applyQuaternion(turn.setFromUnitVectors(up, direction.normalize()));
        tube.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        parts.push(tube);
        [a, b].forEach((corner) => {
            const key = `${corner.x.toFixed(3)},${corner.y.toFixed(3)},${corner.z.toFixed(3)}`;
            if (!corners.has(key)) corners.set(key, corner.clone());
        });
    }
    corners.forEach((corner) => {
        const bead = new THREE.IcosahedronGeometry(radius * 2.1, 0);
        bead.translate(corner.x, corner.y, corner.z);
        parts.push(bead);
    });
    // The bead is non-indexed and the tube indexed; merge needs one convention.
    const merged = mergeGeometries(parts.map((part) => (part.index ? part.toNonIndexed() : part)));
    parts.forEach((part) => part.dispose());
    edges.dispose();
    return merged;
}

/**
 * A lotus petal lying along +Y from its hinge at the origin: pointed, cupped across its width
 * and curled a little along its length. UV: x across (0..1), y from hinge (0) to tip (1).
 */
export function petalGeometry({
    length = 1, width = 0.42, cup = 0.5, curl = 0.3,
} = {}) {
    const geometry = new THREE.PlaneGeometry(1, 1, 8, 14);
    const { position } = geometry.attributes;
    for (let i = 0; i < position.count; i++) {
        const across = position.getX(i) * 2; // -1..1
        const along = position.getY(i) + 0.5; // 0..1
        const profile = Math.sin(Math.PI * along ** 0.8) ** 0.85;
        const x = across * profile * width * 0.5;
        const y = along * length;
        const z = (across * across) * profile * cup * width * 0.5 + along * along * curl * length;
        position.setXYZ(i, x, y, z);
    }
    geometry.computeVertexNormals();
    return geometry;
}
