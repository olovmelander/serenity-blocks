/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// Chapter-3 waterfall — winterize A/B harness.
//
// The hero waterfall used to simply fade to nothing across the 3→4 seam. It now FREEZES on the
// shared season/altitude snow blend (createWaterfallTSL uSnowBlend): the vertical scroll slows
// to a near-still glassy sheet and the water shifts to pale ice-blue, so it reads as glazing
// over into winter rather than vanishing. This mounts the SHIPPING builder so the look ports.
//
//   ?effect=ch3-waterfall&snow=0&t=8   → liquid (summer)
//   ?effect=ch3-waterfall&snow=1&t=8   → frozen (winter)
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createWaterfallTSL } from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';

export const meta = {
    id: 'ch3-waterfall',
    title: 'Ch3 Waterfall (winterize A/B)',
    description: 'The Ch3 waterfall freezing to ice as the shared snow blend rises (liquid → frozen).',
};

const num = (p, k, d) => {
    const v = Number.parseFloat(p.get(k));
    return Number.isFinite(v) ? v : d;
};

export function create({ scene, params }) {
    const uTime = uniform(0);
    const snow = THREE.MathUtils.clamp(num(params, 'snow', 0), 0, 1);
    const uSnowBlend = uniform(snow);

    // Dusk backdrop so the additive water/ice ribbon reads against atmosphere, not void.
    scene.background = new THREE.Color(0x1a2733);

    const wf = createWaterfallTSL(uTime, { uSnowBlend });
    wf.group.position.set(0, 0, 0); // builder anchors to the world spot; re-centre for the harness
    scene.add(wf.group);

    return {
        camera(time, cam) {
            cam.position.set(0, 28, 120);
            cam.lookAt(0, 24, 6);
            cam.fov = 50;
            cam.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            uSnowBlend.value = snow;
        },
        dispose() {
            scene.remove(wf.group);
            wf.group.traverse((c) => {
                c.geometry?.dispose?.();
                if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
                else c.material?.dispose?.();
            });
            scene.background = null;
        },
    };
}
