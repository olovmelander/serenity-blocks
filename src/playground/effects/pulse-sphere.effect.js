/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Starter effect — an object material (not a backdrop): a lit sphere with an
// animated TSL colorNode + emissive rim (fresnel) + vertex-displacement positionNode.
// Template for "thing in the scene" effects. Demonstrates time-driven uniforms,
// world-space fresnel, and the default orbit camera.
import * as THREE from 'three/webgpu';
import {
    cameraPosition, clamp, dot, float, mix, normalize, normalLocal, normalWorld,
    positionLocal, positionWorld, pow, sin, uniform, uv,
} from 'three/tsl';

export const meta = {
    id: 'pulse-sphere',
    title: 'Pulse Sphere',
    description: 'Lit sphere: animated TSL color + emissive fresnel rim + breathing vertex displacement.',
};

export function create({ scene }) {
    const uTime = uniform(0);
    const uColorA = uniform(new THREE.Color(0x1b2a6b));
    const uColorB = uniform(new THREE.Color(0x49e0ff));

    // Bands that scroll across the surface with time.
    const v = uv();
    const wave = sin(v.y.mul(18.0).add(uTime.mul(1.5))).mul(0.5).add(0.5);
    const baseColor = mix(uColorA, uColorB, pow(wave, float(2.0)));

    // World-space fresnel rim.
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(clamp(float(1.0).sub(dot(N, V)), 0.0, 1.0), float(2.5));

    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.1 });
    material.colorNode = baseColor;
    material.emissiveNode = uColorB.mul(fres).mul(0.9);
    // Gentle breathing displacement along local normals (positionNode is object-space).
    const disp = sin(uTime.mul(1.2)).mul(0.04);
    material.positionNode = positionLocal.add(normalLocal.mul(disp));

    const geometry = new THREE.IcosahedronGeometry(2.2, 24);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Lights so the MeshStandard shading reads as form.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 5);
    const ambient = new THREE.AmbientLight(0x223355, 1.0);
    scene.add(key);
    scene.add(ambient);

    return {
        cameraRadius: 6,
        update(time) {
            uTime.value = time;
            mesh.rotation.y = time * 0.2;
        },
        dispose() {
            scene.remove(mesh);
            scene.remove(key);
            scene.remove(ambient);
            geometry.dispose();
            material.dispose();
        },
    };
}
