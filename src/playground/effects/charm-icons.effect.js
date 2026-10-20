/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// The four Odyssey charm icons (rendering/odyssey/odyssey-charm-icons.js) in a row over the
// HUD's indigo, each in a chip state: ?states=ready,active,used,armed (one per icon, cycled),
// ?icon=hearth to frame one icon alone. Static framing (pass orbit=0).
import * as THREE from 'three/webgpu';
import {
    ODYSSEY_CHARM_ICON_IDS, createOdysseyCharmIcon, createOdysseyCharmIconLights, createOdysseyCharmStudio,
} from '../../rendering/odyssey/odyssey-charm-icons.js';

export const meta = {
    id: 'charm-icons',
    title: 'Odyssey charm icons',
    description: 'Tide, Still Air, Long Breath and Hearth as small lit icons on their state rings.',
};

export function create({ scene, params }) {
    const only = params?.get?.('icon');
    const ids = only && ODYSSEY_CHARM_ICON_IDS.includes(only) ? [only] : [...ODYSSEY_CHARM_ICON_IDS];
    const states = (params?.get?.('states') || 'ready,active,armed,used').split(',');
    const spacing = 2.9;
    const studio = createOdysseyCharmStudio();
    const icons = ids.map((id, index) => {
        const icon = createOdysseyCharmIcon(id, { studio });
        icon.group.position.x = (index - (ids.length - 1) / 2) * spacing;
        icon.setState(states[index % states.length] || 'ready');
        scene.add(icon.group);
        return icon;
    });
    const { lights, dispose: disposeLights } = createOdysseyCharmIconLights();
    lights.forEach((light) => scene.add(light));

    // The HUD panel's indigo behind the icons, so the rim light and the rings are judged against it.
    const backdropGeometry = new THREE.PlaneGeometry(40, 20);
    const backdropMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x1b1730 });
    const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdrop.position.z = -4;
    scene.add(backdrop);

    return {
        cameraRadius: 8,
        update(time) {
            icons.forEach((icon) => icon.update(time));
        },
        camera(time, camera) {
            camera.position.set(0, 1.9, ids.length === 1 ? 5.2 : 9.5);
            camera.lookAt(0, -0.15, 0);
        },
        dispose() {
            icons.forEach((icon) => {
                scene.remove(icon.group);
                icon.dispose();
            });
            lights.forEach((light) => scene.remove(light));
            disposeLights();
            studio.dispose();
            scene.remove(backdrop);
            backdropGeometry.dispose();
            backdropMaterial.dispose();
        },
    };
}
