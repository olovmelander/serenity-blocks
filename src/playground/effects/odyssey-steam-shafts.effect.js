/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Isolate the steam quench's angular light shafts, without booting either chapter.
// ?effect=odyssey-steam-shafts&t=9&orbit=0&shafts=legacy reproduces the zenith pinwheel.
// Omit shafts=legacy for the continuous core. This is a field proof, not the full world.
import * as THREE from 'three/webgpu';
import {
    cameraPosition, float, max, mix, normalize, positionLocal, positionWorld,
    smoothstep, uniform, vec2, vec3,
} from 'three/tsl';
import { fbm3, noise2 } from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';

export const meta = {
    id: 'odyssey-steam-shafts',
    title: 'Odyssey Steam Shafts',
    description: 'The chapter 1 steam light field: angular pinwheel versus a continuous zenith aperture.',
};

export function create({ scene, params }) {
    const legacy = params.get('shafts') === 'legacy';
    const uTime = uniform(0);
    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const radialDistance = viewDir.xz.length();
    const azimuth = legacy
        ? normalize(viewDir.xz.add(vec2(1e-4, 0.0)))
        : viewDir.xz.div(max(radialDistance, float(1e-4)));
    const rayNoise = noise2(azimuth.mul(4.2).add(vec2(uTime.mul(0.05), uTime.mul(-0.035))));
    let rays = smoothstep(0.48, 0.86, rayNoise).mul(smoothstep(0.35, 0.92, viewDir.y));
    if (!legacy) rays = rays.mul(smoothstep(0.04, 0.32, radialDistance));

    // A quiet local-space vapour bed reveals whether the field reads as angular sheets.
    // Both variants share it byte-for-byte; only the angular shaft core differs.
    const p = positionLocal.mul(0.095);
    const slow = fbm3(p.mul(vec3(1.0, 0.38, 1.0)).add(vec3(0.0, uTime.mul(-0.11), 0.0)), 4);
    const fast = fbm3(p.mul(3.4).add(vec3(uTime.mul(0.10), uTime.mul(-0.32), uTime.mul(0.075))), 3);
    const billow = smoothstep(0.22, 0.78, slow.mul(0.72).add(fast.mul(0.42)));
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = mix(vec3(0.22, 0.11, 0.06), vec3(0.42, 0.29, 0.18), billow)
        .add(vec3(0.95, 0.93, 0.86).mul(rays).mul(0.25));
    material.side = THREE.BackSide;
    material.fog = false;
    material.toneMapped = false;
    const geometry = new THREE.SphereGeometry(110, 32, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    return {
        cameraRadius: 0.001,
        update(time) { uTime.value = time; },
        camera(time, camera) {
            camera.position.set(0, 0, 0);
            // Same look direction as the chapter 1 p=.055165 audit sample.
            camera.quaternion.set(-0.2497044048, 0.6912845958, -0.6302506485, -0.2501148493);
            camera.fov = 58;
            camera.updateProjectionMatrix();
        },
        dispose() {
            scene.remove(mesh);
            geometry.dispose();
            material.dispose();
        },
    };
}
