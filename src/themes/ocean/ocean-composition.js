/** Ocean reef staging, bounded seabed relief, and terrain-contact grounding. */
import * as THREE from 'three/webgpu';
import { applyKelpForestComposition } from './ocean-kelp-forest.js';

const stagedRoots = new WeakSet();
const groundedRoots = new WeakSet();

// [slot, source x/z/scale, composed x/z/scale]. The atmosphere keeps the same
// source slots when deferred GLBs replace their procedural previews. Apply the
// composition once per object rather than rewriting both placement catalogues.
const REEF_STAGING = [
    [0, 38, -58, 1.18, 58, -85, 0.9],
    [1, -45, -26, 0.88, -48, -34, 0.98],
    [2, -8, -104, 1.28, -62, -123, 1.1],
];

const CORAL_STAGING = [
    [0, -26, 34, 2.5, -28, 24, 2.0],
    [1, 28, 32, 3.0, 32, 20, 1.95],
    [6, -56, 18, 2.35, -52, 8, 2.4],
    [7, 58, 14, 2.45, 54, 0, 2.3],
    [10, -86, -8, 2.85, -62, -44, 2.65],
    [11, 88, -4, 2.75, 68, -51, 2.55],
    [12, -30, -58, 2.6, -46, -75, 2.4],
];

/** Bounded reef shelves and broad sand relief; the distant floor stays submerged. */
export function getReefSeabedHeight(x, z) {
    const px = x + Math.sin(z * 0.052) * 2;
    const pz = z + Math.cos(x * 0.045) * 2;
    const alongCurrent = px * 0.22 + pz * 0.97;
    const broadPhase = alongCurrent * 0.055;
    const broadDunes = Math.sin(broadPhase - 0.32 * Math.sin(broadPhase)) * 3.8;
    const secondaryDunes = Math.sin(alongCurrent * 0.16) * 0.95;
    const shelf = THREE.MathUtils.smoothstep(Math.abs(x), 22, 82) * 7;
    const distanceFade = 1 - THREE.MathUtils.smoothstep(-z, 85, 200);
    const leftShoulder = Math.exp(-(((x + 58) / 34) ** 2 + ((z + 28) / 72) ** 2)) * 4;
    const rightShoulder = Math.exp(-(((x - 64) / 38) ** 2 + ((z + 42) / 80) ** 2)) * 5.5;
    const sandChannel = Math.exp(-((x / 32) ** 2 + ((z - 25) / 100) ** 2)) * 3.2;
    const rippleRelief = Math.sin(alongCurrent * 0.64) * 0.22;
    return -22 + (broadDunes + secondaryDunes) * (0.4 + distanceFade * 0.6)
        + (shelf + leftShoulder + rightShoulder) * distanceFade - sandChannel + rippleRelief;
}

const groundingBounds = new THREE.Box3();
const groundingVertex = new THREE.Vector3();

function groundFormation(root, buryDepth, shapePillar = false) {
    if (!root || groundedRoots.has(root)) return;
    if (shapePillar) root.scale.y *= 0.96;
    root.updateMatrix();
    root.updateWorldMatrix(true, true);
    // A rotated cached AABB can extend below every actual vertex, leaving an
    // empty base band. Precise bounds are essential for these tilted rocks.
    groundingBounds.setFromObject(root, true);
    const height = groundingBounds.max.y - groundingBounds.min.y;
    const baseBandTop = groundingBounds.min.y + Math.min(2.2, height * 0.07);
    let largestGap = -Infinity;
    // Ground the whole low footprint, not just its origin. On a sloping dune,
    // center-height placement leaves the downhill rim visibly hanging in air.
    root.traverse((child) => {
        const positions = child.geometry?.attributes?.position;
        if (!positions) return;
        for (let index = 0; index < positions.count; index += 1) {
            groundingVertex.fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
            if (groundingVertex.y > baseBandTop) continue;
            largestGap = Math.max(
                largestGap,
                groundingVertex.y - getReefSeabedHeight(groundingVertex.x, groundingVertex.z),
            );
        }
    });
    if (Number.isFinite(largestGap)) root.position.y -= largestGap + buryDepth;
    root.updateMatrix();
    groundedRoots.add(root);
}

function stageRoots(roots, placements) {
    if (!roots) return;
    for (const [slot, oldX, oldZ, oldScale, x, z, scale] of placements) {
        const root = roots[slot];
        // Hero coral GLBs share one mesh across several placement slots. Their
        // matrices are composed before batching; moving that root moves every
        // colony a second time, including slots that need no composition edit.
        if (!root || root.isInstancedMesh || stagedRoots.has(root)) continue;
        const oldBed = getReefSeabedHeight(oldX, oldZ);
        const newBed = getReefSeabedHeight(x, z);
        const ratio = scale / oldScale;
        // Includes the GLB's minY correction, which scales along with its model.
        const anchorOffset = root.position.y - oldBed;
        root.position.set(x, newBed + anchorOffset * ratio, z);
        root.scale.multiplyScalar(ratio);
        root.updateMatrix();
        stagedRoots.add(root);
    }
}

/** Compose deferred coral GLB placements before they become shared instances. */
export function composeReefCoralPlacements(placements) {
    return placements.map((placement, index) => {
        const staging = CORAL_STAGING.find(([slot]) => slot === (placement.index ?? index));
        if (!staging) return placement;
        const [, oldX, oldZ, oldScale, x, z, scale] = staging;
        const ratio = scale / oldScale;
        return {
            ...placement,
            x,
            z,
            y: getReefSeabedHeight(x, z)
                + (placement.y - getReefSeabedHeight(oldX, oldZ)) * ratio,
            scale: placement.scale * ratio,
        };
    });
}

/** Call after construction and during updates to catch deferred asset replacements. */
export function applyReefComposition(atmosphere) {
    if (!atmosphere) return;
    stageRoots(atmosphere.heroReefWalls, REEF_STAGING);
    stageRoots(atmosphere.heroCorals, CORAL_STAGING);
    applyKelpForestComposition(atmosphere, getReefSeabedHeight);
    atmosphere.heroReefWalls?.forEach((root, index) => groundFormation(root, 1.0, index === 0));
    atmosphere.foregroundRocks?.forEach((root) => groundFormation(root, 0.65));
}

/** Deterministic preview camera. Pointer coordinates are normalized to -1…1. */
export function updateReefCamera(camera, time, { x = 0, y = 0 } = {}) {
    const pointerX = THREE.MathUtils.clamp(x, -1, 1);
    const pointerY = THREE.MathUtils.clamp(y, -1, 1);
    const fov = 54 + Math.sin(time * 0.021) * 1.0;
    if (Math.abs(camera.fov - fov) > 0.001) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }

    camera.position.set(
        pointerX * 8 + Math.sin(time * 0.045) * 5 + Math.sin(time * 0.12) * 1.2,
        24 + pointerY * 4 + Math.sin(time * 0.07) * 2.4 + Math.sin(time * 0.15) * 0.8,
        82 + Math.cos(time * 0.028) * 3.5 + Math.sin(time * 0.055) * 3.0,
    );
    camera.lookAt(
        pointerX * 9 + Math.sin(time * 0.072 + 1.5) * 1.2 + Math.sin(time * 0.04) * 1.7,
        14 + pointerY * 4.5 + Math.sin(time * 0.055) * 2 + Math.sin(time * 0.06) * 1.8,
        -34 + Math.cos(time * 0.045) * 7,
    );
    camera.rotation.z = Math.sin(time * 0.04) * 0.007;
    camera.updateMatrixWorld();
}
