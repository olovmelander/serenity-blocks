/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Starlight - Constellation validation effect.
// Nebula + starfield + accumulating self-drawing star signs. Triggers frequently
// here so combo-style stacking is easy to screenshot.
//
//   /playground.html?effect=starlight-constellation&orbit=0
//   optional: &sign=aries &period=1.2
import { createNebulaSky } from '../../themes/starlight/rendering/nebula-sky.js';
import { createDeepStarfield } from '../../themes/starlight/rendering/deep-starfield.js';
import {
    CONSTELLATION_ZODIAC_NAMES,
    ConstellationController,
} from '../../themes/starlight/sim/constellations.js';
import { createConstellationRenderer } from '../../themes/starlight/rendering/constellation-lines.js';

export const meta = {
    id: 'starlight-constellation',
    title: 'Starlight - Constellation',
    description: 'Accumulating self-drawing star signs over the starfield.',
};

export function create({
    scene, camera, renderer, sizes, params,
}) {
    const starCount = parseInt(params.get('stars'), 10) || 9000;

    const nebula = createNebulaSky();
    const starfield = createDeepStarfield({ count: starCount });
    const controller = new ConstellationController({ ambient: false });
    const constRenderer = createConstellationRenderer(controller, { intensity: 1.3 });
    scene.add(nebula.mesh);
    scene.add(starfield.mesh);
    scene.add(constRenderer.group);

    const requestedSign = params.get('sign');
    const triggerPeriod = parseFloat(params.get('period')) || 1.35;
    let signIndex = 0;
    const triggerNext = () => {
        const name = requestedSign || CONSTELLATION_ZODIAC_NAMES[
            signIndex % CONSTELLATION_ZODIAC_NAMES.length
        ];
        signIndex += 1;
        controller.trigger(name);
    };

    controller.triggerMany(3, requestedSign || 'zodiac');
    let retrigger = triggerPeriod;

    const setProj = () => {
        const dpr = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
        const h = ((sizes && sizes.height) || window.innerHeight) * dpr;
        starfield.setProjection(h, camera.projectionMatrix.elements[5]);
    };

    return {
        cameraRadius: 14,
        update(time, dt) {
            const d = dt > 0 ? dt : 0.016;
            nebula.update(time);
            starfield.update(time);
            controller.update(d);
            constRenderer.update();
            setProj();
            retrigger -= d;
            if (retrigger <= 0) {
                retrigger = triggerPeriod;
                triggerNext();
            }
        },
        camera(time, cam) {
            if (cam.fov !== 40) { cam.fov = 40; cam.updateProjectionMatrix(); }
            cam.position.set(0, 0.4, 14);
            cam.lookAt(0, 0, 0);
        },
        resize() {
            setProj();
        },
        dispose() {
            scene.remove(nebula.mesh);
            scene.remove(starfield.mesh);
            scene.remove(constRenderer.group);
            nebula.dispose();
            starfield.dispose();
            constRenderer.dispose();
            controller.dispose();
        },
    };
}
