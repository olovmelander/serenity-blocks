/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// Ch3 golden-hour reflective LAKE — isolated iteration harness.
//
// Mounts the SHIPPING createGoldenLakeTSL against a warm golden-hour sky + a few dark tree cones
// on the far shore (so the faked silhouette reflections + sun-glitter have context). The camera
// looks across the lake toward the low sun (SURFACE_SUN_DIR ≈ -z) — the golden-hour vantage.
//
//   ?effect=ch3-lake&t=8            → summer
//   ?effect=ch3-lake&t=8&season=1   → winter (cooled reflection)
import * as THREE from 'three/webgpu';
import {
    uniform, mix, vec3, positionLocal, normalize,
} from 'three/tsl';
import { createGoldenLakeTSL } from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';

export const meta = {
    id: 'ch3-lake',
    title: 'Ch3 Golden Lake (reflective)',
    description: 'Golden-hour reflective lake — cool-teal body, warm reduced-fresnel rim, golden sun-glitter, faked reflections.',
};

const num = (p, k, d) => {
    const v = Number.parseFloat(p.get(k));
    return Number.isFinite(v) ? v : d;
};

export function create({ scene, params }) {
    const uTime = uniform(0);
    const season = num(params, 'season', 0);
    const uSeason = uniform(season);

    // Warm golden-hour sky dome (peach horizon → azure zenith) so the lake has a sky to reflect.
    const skyMat = new THREE.MeshBasicNodeMaterial();
    const dir = normalize(positionLocal);
    skyMat.colorNode = mix(vec3(0.99, 0.76, 0.52), vec3(0.30, 0.44, 0.70), dir.y.mul(1.4).clamp(0, 1));
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    skyMat.toneMapped = false;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMat);
    scene.add(sky);

    // A few dark tree cones on the FAR shore (context for the faked reflections).
    const trees = new THREE.Group();
    [[-46, -100, 1.6], [28, -120, 2.0], [-8, -135, 2.4], [58, -105, 1.3], [80, -125, 1.7]].forEach(([x, z, s]) => {
        const t = new THREE.Mesh(new THREE.ConeGeometry(6, 22, 7), new THREE.MeshBasicMaterial({ color: 0x18301a }));
        t.position.set(x, 11 * s, z);
        t.scale.setScalar(s);
        trees.add(t);
    });
    scene.add(trees);

    const lake = createGoldenLakeTSL(uTime, { uSeason });
    scene.add(lake.mesh);

    return {
        camera(time, cam) {
            cam.position.set(0, 15, 74);
            cam.lookAt(0, 1, -120);
            cam.fov = 55;
            cam.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            uSeason.value = season;
        },
        dispose() {
            scene.remove(sky, trees, lake.mesh);
            sky.geometry.dispose();
            skyMat.dispose();
            trees.traverse((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
            lake.geometry.dispose();
            lake.material.dispose();
        },
    };
}
