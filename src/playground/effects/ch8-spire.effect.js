/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createNeonCitySpireTSL } from '../../rendering/odyssey/chapter-environments/urban-dreams.tsl.js';

export const meta = {
    id: 'ch8-spire',
    title: 'Ch8 center spire (facade stability)',
    description: 'Production tower geometry with a deterministic camera for subpixel neon-line validation.',
};

const number = (params, key, fallback) => {
    const value = Number.parseFloat(params.get(key));
    return Number.isFinite(value) ? value : fallback;
};

export function create({ scene, camera, params }) {
    const uTime = uniform(0);
    const uEnergy = uniform(0.45);
    const part = createNeonCitySpireTSL(uTime, uEnergy);
    const cores = part.group.children.filter((object) => object.geometry?.type === 'BoxGeometry');
    part.uReveal.value = number(params, 'reveal', 0.4);
    const coverage = number(params, 'coverage', 1);
    part.materials.forEach((material) => {
        if (material.uniforms?.uOpacity) material.uniforms.uOpacity.value = coverage;
    });
    scene.background = new THREE.Color(0x180d30);
    scene.add(part.group);
    camera.near = 1;
    camera.far = 6000;
    camera.fov = 50;
    camera.updateProjectionMatrix();
    const distance = number(params, 'distance', 700);
    const motion = params.get('motion') === '1';
    window.__CH8_SPIRE__ = { part };
    return {
        camera(time) {
            camera.position.set(
                80 + (motion ? Math.sin(time * 0.35) * 35 : 0),
                145 + (motion ? Math.sin(time * 0.23) * 12 : 0),
                distance - 560,
            );
            camera.lookAt(0, 140, -560);
        },
        update(time) { uTime.value = time; },
        getDiagnostics() {
            return {
                distance, coverage, reveal: part.uReveal.value, cores: cores.length,
            };
        },
        dispose() {
            delete window.__CH8_SPIRE__;
            scene.remove(part.group);
            part.geometries.forEach((geometry) => geometry.dispose());
            part.materials.forEach((material) => material.dispose());
        },
    };
}
