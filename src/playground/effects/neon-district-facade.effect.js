import * as THREE from 'three/webgpu';
import { createBuildingNodeMaterial } from '../../themes/neon-district/neon-district-materials.js';

export const meta = {
    id: 'neon-district-facade',
    title: 'Neon District facade study',
    description: 'Stable derivative-filtered rooms with cyan, fuchsia and warm interior lighting.',
};

export function create({ scene, params }) {
    scene.background = new THREE.Color(0x070912);
    const group = new THREE.Group();
    scene.add(group);
    const data = createBuildingNodeMaterial({ detail: params.get('quality') === 'Low' ? 'low' : 'high' });
    data.uniforms.uGlowIntensity.value = params.get('event') === '1' ? 2 : 1;
    const blocks = [
        [-150, 0, 135, 550, 145],
        [80, -160, 130, 380, 160],
        [210, -400, 140, 700, 165],
    ];
    blocks.forEach(([x, z, width, height, depth]) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), data.material);
        mesh.position.set(x, height / 2, z);
        group.add(mesh);
    });
    return {
        cameraRadius: 1000,
        camera(t, camera) {
            camera.position.set(750, 410, 900);
            camera.lookAt(0, 250, -100);
            camera.far = 5000;
            camera.updateProjectionMatrix();
        },
        update(t) {
            data.uniforms.uTime.value = t;
        },
        dispose() {
            group.removeFromParent();
            group.traverse((object) => object.geometry?.dispose());
            data.material.dispose();
        },
    };
}
