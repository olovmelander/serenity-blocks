/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Playground isolation of the Chapter 3 terrain edge as it hands to Chapter 4 mountains.
// Uses the shipping TSL builders so shader tweaks here port directly into Surface World.
import { uniform } from 'three/tsl';
import {
    createCloudsTSL,
    createFoothillBridgeTSL,
    createLandscapeTSL,
    createSkyBackgroundTSL,
} from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';
import {
    createCanonicalMountainRangeTSL,
} from '../../rendering/odyssey/chapter-environments/shared/canonical-mountain-range.js';

export const meta = {
    id: 'seam-34-landscape',
    title: 'Seam 3-4 Landscape Edge',
    description: 'Surface terrain edge dissolving into the Chapter 4 mountain range.',
};

export function create({ scene, camera, params }) {
    const uTime = uniform(0);
    const uTransition = uniform(0);
    const snowBlend = Number.parseFloat(params.get('snow') ?? '0.84');
    const opacity = Number.parseFloat(params.get('opacity') ?? '1');

    const sky = createSkyBackgroundTSL(uTime);
    const landscape = createLandscapeTSL(uTime, 60);
    const bridge = createFoothillBridgeTSL(uTime);
    const mountains = createCanonicalMountainRangeTSL({
        hostChapterId: 3,
        name: 'playground-canonical-seam-34-mountains',
        uTransition,
        baseOpacity: opacity,
    });
    const clouds = createCloudsTSL(uTime);

    landscape.mesh.position.y = -8;
    bridge.mesh.position.y = -8;
    bridge.mesh.position.z += 40;
    clouds.group.position.y += 18;

    uTransition.value = snowBlend;
    landscape.uniforms.uSnowBlend.value = snowBlend;
    landscape.uniforms.uOpacity.value = opacity;
    bridge.uniforms.uSnowBlend.value = snowBlend;
    bridge.uniforms.uOpacity.value = opacity;
    mountains.parts.forEach((part) => {
        if (part.uniforms?.uSnowBlend) part.uniforms.uSnowBlend.value = snowBlend;
        if (part.uniforms?.uOpacity) part.uniforms.uOpacity.value = opacity;
    });

    scene.add(sky.mesh, mountains.group, bridge.mesh, landscape.mesh, clouds.group);

    camera.near = 0.5;
    camera.far = 20000;
    camera.updateProjectionMatrix();

    return {
        camera(time, cam) {
            const drift = Math.sin(time * 0.05) * 18;
            cam.position.set(-34 + drift, 82, 205);
            cam.lookAt(16, 58, -360);
        },
        update(time) {
            uTime.value = time;
            uTransition.value = snowBlend;
        },
        dispose() {
            scene.remove(sky.mesh, mountains.group, bridge.mesh, landscape.mesh, clouds.group);
            [
                sky,
                landscape,
                bridge,
                clouds,
                ...mountains.parts,
            ].forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
        },
    };
}
