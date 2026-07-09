/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Starter effect — the simplest "one effect": a BackSide sphere whose colour is a
// TSL `colorNode`. The camera sits inside the dome and slowly yaws. Copy this file
// to author a new backdrop effect; rename `meta.id` and it auto-registers.
import * as THREE from 'three/webgpu';
import {
    abs, clamp, mix, normalize, positionLocal, pow, sin, smoothstep, uniform,
} from 'three/tsl';

export const meta = {
    id: 'nebula-dome',
    title: 'Nebula Dome',
    description: 'Gradient sky dome (BackSide sphere, TSL colorNode). Minimal backdrop template.',
};

// create(ctx) builds the effect, adds its objects to ctx.scene, and returns a
// controller: { update(time, dt)?, camera(time, camera)?, resize(w, h)?, cameraRadius?, dispose() }.
export function create({ scene }) {
    const uZenith = uniform(new THREE.Color(0x0a0a1a));
    const uHorizon = uniform(new THREE.Color(0x241033));
    const uGlow = uniform(new THREE.Color(0x7a3cff));
    const uEnergy = uniform(0.5);
    const uTime = uniform(0);

    const dir = normalize(positionLocal);
    const h = clamp(dir.y.mul(0.5).add(0.5), 0.0, 1.0);
    const gradient = pow(h, 0.6);

    let color = mix(uHorizon, uZenith, gradient);
    // A horizon band that breathes with time + energy.
    const band = smoothstep(0.45, 0.0, abs(dir.y));
    const pulse = sin(uTime.mul(0.6)).mul(0.5).add(0.5);
    color = color.add(uGlow.mul(band).mul(uEnergy.mul(0.6).add(0.2)).mul(pulse.mul(0.5).add(0.5)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;

    const geometry = new THREE.SphereGeometry(4000, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    return {
        cameraRadius: 0.001, // camera sits at the centre of the dome
        camera(time, camera) {
            // Slow yaw so different parts of the dome face the lens; deterministic in `time`.
            camera.position.set(0, 0, 0);
            camera.lookAt(Math.sin(time * 0.15), 0.18, Math.cos(time * 0.15));
        },
        update(time) {
            uTime.value = time;
        },
        dispose() {
            scene.remove(mesh);
            geometry.dispose();
            material.dispose();
        },
    };
}
