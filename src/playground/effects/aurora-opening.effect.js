import * as THREE from 'three/webgpu';
import { AURORA_OPENING_DURATION_MS, createBootAurora } from '../../ui/boot-aurora-scene.js';

export const meta = {
    id: 'aurora-opening',
    title: 'Aurora Opening',
    description: 'Transparent northern light accent for a continuous ident-to-title handoff.',
};

export function create({ scene, sizes, params }) {
    const opening = createBootAurora({ viewportWidth: sizes.width, viewportHeight: sizes.height });
    const previousBackground = scene.background;
    scene.background = new THREE.Color('#10203b');
    scene.add(opening.mesh);
    const duration = AURORA_OPENING_DURATION_MS / 1000;
    const hold = params.get('phase') === 'hold';
    return {
        update(time) {
            opening.setTime(time);
            opening.setProgress(hold ? 0.45 : Math.min((time % (duration + 2)) / duration, 1));
        },
        camera(time, camera) { camera.position.set(0, 0, 7); camera.lookAt(0, 0, 0); },
        resize(w, h) { opening.setViewport(w, h); opening.setGemCenterPx(w / 2, h / 2 - 36); },
        dispose() { scene.remove(opening.mesh); opening.dispose(); scene.background = previousBackground; },
    };
}
