import * as THREE from 'three/webgpu';

/** Render sized particles as instanced quads on both node-renderer backends. */
export function createChiralParticleObject(sourceGeometry, material) {
    if (!material.isNodeMaterial) return new THREE.Points(sourceGeometry, material);
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.attributes.position);
    geometry.setAttribute('uv', quad.attributes.uv);
    const positions = sourceGeometry.getAttribute('position');
    geometry.instanceCount = positions.count;
    Object.entries(sourceGeometry.attributes).forEach(([name, source]) => {
        const attribute = new THREE.InstancedBufferAttribute(source.array, source.itemSize, source.normalized);
        attribute.setUsage(source.usage);
        geometry.setAttribute(name === 'position' ? 'aParticlePosition' : name, attribute);
    });
    sourceGeometry.dispose();
    const particles = new THREE.Sprite(material);
    particles.geometry = geometry;
    particles.frustumCulled = false;
    return particles;
}

export function chiralParticlePositions(particles) {
    return particles.geometry.attributes.aParticlePosition || particles.geometry.attributes.position;
}
