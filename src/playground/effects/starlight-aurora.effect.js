/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Starlight — Aurora Band validation effect (Phase 5).
// Nebula sky + deep starfield + the thin upper-sky aurora ribbon, so the band's
// placement (above the board area), restraint (luminance cap), and drift can be
// checked. Pass &aurora=1.2 to exaggerate it while tuning.
//
//   /playground.html?effect=starlight-aurora&orbit=0
import { createNebulaSky } from '../../themes/starlight/rendering/nebula-sky.js';
import { createDeepStarfield } from '../../themes/starlight/rendering/deep-starfield.js';
import { createAuroraBand } from '../../themes/starlight/rendering/aurora-band.js';

export const meta = {
    id: 'starlight-aurora',
    title: 'Starlight — Aurora Band',
    description: 'Thin upper-sky aurora ribbon (High+ only) over the starfield + nebula.',
};

export function create({
    scene, camera, renderer, sizes, params,
}) {
    const starCount = parseInt(params.get('stars'), 10) || 10000;
    const strength = parseFloat(params.get('aurora')) || 0.6;

    const nebula = createNebulaSky();
    const starfield = createDeepStarfield({ count: starCount });
    const aurora = createAuroraBand({ strength });
    scene.add(nebula.mesh);
    scene.add(starfield.mesh);
    scene.add(aurora.mesh);

    const setProj = () => {
        const dpr = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
        const h = ((sizes && sizes.height) || window.innerHeight) * dpr;
        starfield.setProjection(h, camera.projectionMatrix.elements[5]);
    };

    return {
        cameraRadius: 14,
        update(time) {
            nebula.update(time);
            starfield.update(time);
            aurora.update(time);
            setProj();
        },
        // Match the GAME camera exactly (rest pose, FOV 40°) so the playground
        // crop == what the player sees.
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
            scene.remove(aurora.mesh);
            nebula.dispose();
            starfield.dispose();
            aurora.dispose();
        },
    };
}
