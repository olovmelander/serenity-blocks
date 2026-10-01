/** World-space staging for the authored kelp canopy; no additional geometry. */
import * as THREE from 'three/webgpu';

// Slot order keeps two near curtains, two inner walls and deeper overlapping
// groves at the lowest populated tiers. [x, z, height, width, rotationY].
const CANOPY = [
    [-42, 22, 84, 23, 0.30],
    [45, 16, 80, 22, -0.65],
    [-36, -28, 76, 22, 1.10],
    [42, -44, 82, 23, -1.00],
    [-68, 20, 92, 34, 0.15],
    [70, 12, 90, 34, -0.35],
    [-42, -96, 80, 23, 0.75],
    [47, -120, 88, 23, -0.65],
    [-71, -99, 84, 23, 1.60],
    [73, -122, 86, 23, -1.30],
    [-55, -158, 82, 22, 0.45],
    [55, -176, 88, 23, -0.15],
    [-86, -63, 80, 23, 1.15],
    [92, -89, 84, 23, -0.95],
];

const staged = new WeakSet();
const bounds = new THREE.Box3();
const point = new THREE.Vector3();
const size = new THREE.Vector3();

function refreshMatrices(root) {
    root.parent?.updateWorldMatrix(true, false);
    root.updateMatrix();
    // Deferred roots may have both automatic matrix paths frozen. Refresh
    // their matrices explicitly while preserving those ownership flags.
    root.traverse((child) => {
        if (child !== root && child.matrixAutoUpdate) child.updateMatrix();
        if (child.parent) child.matrixWorld.multiplyMatrices(child.parent.matrixWorld, child.matrix);
        else child.matrixWorld.copy(child.matrix);
        child.matrixWorldNeedsUpdate = false;
    });
}

function visitRestVertices(root, visit) {
    root.traverse((child) => {
        const positions = child.geometry?.attributes?.position;
        if (!positions) return;
        for (let index = 0; index < positions.count; index += 1) {
            point.fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
            visit(point);
        }
    });
}

function restBounds(root) {
    bounds.makeEmpty();
    visitRestVertices(root, (vertex) => bounds.expandByPoint(vertex));
    return bounds;
}

/**
 * Stage each procedural/GLB root once. World-size targets survive new Blender
 * exports without depending on their local dimensions or legacy runtimeScale.
 * The caller invokes this after deferred builds and during ordinary updates.
 */
export function applyKelpForestComposition(atmosphere, terrainHeight = atmosphere?.getSeabedHeight) {
    if (!atmosphere?.heroKelp || typeof terrainHeight !== 'function') return;
    atmosphere.heroKelp.forEach((root, index) => {
        const placement = CANOPY[index];
        if (!root || root.isInstancedMesh || !placement || staged.has(root)) return;
        const [x, z, height, width, rotation] = placement;
        root.position.x = x;
        root.position.z = z;
        root.rotation.y = rotation;
        refreshMatrices(root);
        restBounds(root).getSize(size);
        if (size.y < 0.0001 || Math.max(size.x, size.z) < 0.0001) return;
        const horizontalScale = width / Math.max(size.x, size.z);
        root.scale.x *= horizontalScale;
        root.scale.z *= horizontalScale;
        root.scale.y *= height / size.y;
        refreshMatrices(root);
        restBounds(root);
        const lowBand = bounds.min.y + 0.32;
        let largestGap = -Infinity;
        visitRestVertices(root, (vertex) => {
            if (vertex.y > lowBand) return;
            largestGap = Math.max(largestGap, vertex.y - terrainHeight(vertex.x, vertex.z));
        });
        if (!Number.isFinite(largestGap)) return;
        root.position.y -= largestGap + 0.18;
        refreshMatrices(root);
        root.userData.kelpForestCanopy = { height, width };
        staged.add(root);
    });
}
