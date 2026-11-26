import * as THREE from 'three/webgpu';

// Original Blender mesh. The broken nose, notched side and raised cleavage face
// are modeled into the silhouette. Stored in hundredths of a model unit.
const POINTS = [
    -101, -9, 24, -116, -16, -6, -65, -17, -50, 8, -10, -60,
    25, -15, -33, 53, -13, -43, 91, -25, -16, 107, -22, 19,
    54, -34, 41, -38, -28, 47, -123, -2, 34, -140, -2, -3,
    -81, 3, -57, 4, 4, -69, 24, -2, -36, 56, 0, -48,
    101, -6, -15, 119, -9, 27, 58, -10, 54, -49, -5, 62,
    -102, 8, 26, -122, 19, -2, -75, 40, -44, 1, 36, -53,
    18, 17, -28, 47, 24, -37, 79, 13, -12, 99, -2, 21,
    49, 12, 42, -42, 26, 48, -28, 51, 4, 18, -45, 9,
];
const TRIANGLES = [
    1, 0, 10, 10, 20, 21, 20, 30, 21, 1, 31, 0, 1, 11, 12,
    12, 11, 21, 21, 30, 22, 2, 31, 1, 2, 12, 13, 12, 22, 23,
    22, 30, 23, 3, 31, 2, 3, 13, 14, 13, 23, 24, 23, 30, 24,
    4, 31, 3, 5, 4, 14, 14, 24, 25, 24, 30, 25, 5, 31, 4,
    6, 5, 15, 15, 25, 26, 25, 30, 26, 6, 31, 5, 7, 6, 16,
    16, 26, 27, 26, 30, 27, 7, 31, 6, 7, 17, 18, 18, 17, 27,
    27, 30, 28, 8, 31, 7, 9, 8, 18, 19, 18, 28, 28, 30, 29,
    9, 31, 8, 0, 9, 19, 19, 29, 20, 29, 30, 20, 0, 31, 9,
    1, 10, 11, 10, 21, 11, 1, 12, 2, 12, 21, 22, 2, 13, 3,
    12, 23, 13, 3, 14, 4, 13, 24, 14, 5, 14, 15, 14, 25, 15,
    6, 15, 16, 15, 26, 16, 7, 16, 17, 16, 27, 17, 7, 18, 8,
    18, 27, 28, 9, 18, 19, 19, 28, 29, 0, 19, 10, 19, 20, 10,
];

export function createShardGeometry() {
    // Unshared corners keep the fracture faces flat under the two light sources.
    const positions = new Float32Array(TRIANGLES.length * 3);
    for (let i = 0; i < TRIANGLES.length; i += 1) {
        const source = TRIANGLES[i] * 3;
        positions[i * 3] = POINTS[source] * 0.01;
        positions[i * 3 + 1] = POINTS[source + 1] * 0.01;
        positions[i * 3 + 2] = POINTS[source + 2] * 0.01;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}
