import * as THREE from 'three/webgpu';
import { createFluidParticleNodeMaterial, ELECTRIC_PALETTE } from './fluid-dreams-materials.js';

/** Shared modern sprite artwork with attribute-driven motion on WebGL2. */
export function createFluidDreamsCompatibilityParticles(requestedCount, random = Math.random) {
    // Keep the established compatibility budget, including lower quality tiers.
    const count = Math.min(4000, Math.max(0, Math.floor(requestedCount)));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const palette = [
        ELECTRIC_PALETTE.neonPink, ELECTRIC_PALETTE.electricViolet,
        ELECTRIC_PALETTE.electricCyan, ELECTRIC_PALETTE.warmGold,
    ];
    for (let i = 0; i < count; i++) {
        const theta = random() * Math.PI * 2;
        const phi = Math.acos(2 * random() - 1);
        const radius = 12 + random() * 35;
        const sinPhi = Math.sin(phi);
        positions[i * 3] = radius * sinPhi * Math.cos(theta);
        positions[i * 3 + 1] = radius * sinPhi * Math.sin(theta);
        positions[i * 3 + 2] = radius * Math.cos(phi);
        const tint = palette[Math.floor(random() * palette.length)];
        colors.set([tint.x, tint.y, tint.z], i * 3);
        phases[i] = random() * Math.PI * 2;
        sizes[i] = 2 + random() * 6;
    }
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(positions, 3));
    geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(sizes, 1));
    geometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
    const material = createFluidParticleNodeMaterial({ isWebGPU: false });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return { mesh, material };
}
