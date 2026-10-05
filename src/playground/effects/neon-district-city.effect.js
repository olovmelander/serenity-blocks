import * as THREE from 'three/webgpu';
import { NeonDistrictCity } from '../../themes/neon-district/neon-district-city.js';

export const meta = {
    id: 'neon-district-city',
    title: 'Neon District civic atmosphere',
    description: 'Broken skyline telemetry, elevated transit currents and street steam.',
};

export function create({ scene, renderer, params }) {
    scene.background = new THREE.Color(0x080d1c);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    const city = new NeonDistrictCity(scene, { quality: params.get('quality') || 'High' });
    const geometry = new THREE.BoxGeometry(220, 2500, 220);
    const material = new THREE.MeshBasicNodeMaterial({ color: 0x081326 });
    const tower = new THREE.Mesh(geometry, material);
    tower.position.set(260, 1250, -6120);
    scene.add(tower);
    return {
        cameraRadius: 2000,
        camera(t, camera) {
            camera.position.set(0, 4, 40);
            camera.lookAt(0, 800, -6000);
            camera.far = 10000;
            camera.updateProjectionMatrix();
        },
        update(t) { city.update(t, params.get('event') === '1' ? 1 : 0); },
        dispose() {
            city.dispose(); tower.removeFromParent(); tower.dispose();
            geometry.dispose(); material.dispose();
        },
    };
}
