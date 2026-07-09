/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Starlight — Deep Starfield + Nebula Sky validation effect.
// Mounts the REAL theme modules (nebula-sky + deep-starfield) so the screenshot
// proves the actual code: the 1.3px size floor (no sub-pixel shimmer), the
// blackbody color mix, per-star twinkle, and the luminance-capped backdrop.
//
//   /playground.html?effect=starlight-starfield&t=2&orbit=0
//   optional: &stars=24000
import { createNebulaSky } from '../../themes/starlight/rendering/nebula-sky.js';
import { createDeepStarfield } from '../../themes/starlight/rendering/deep-starfield.js';

export const meta = {
    id: 'starlight-starfield',
    title: 'Starlight — Deep Starfield',
    description: 'Instanced parallax starfield (px-floor anti-shimmer) over the capped nebula sky.',
};

export function create({
    scene, camera, renderer, sizes, params,
}) {
    const count = parseInt(params.get('stars'), 10) || 16000;

    const nebula = createNebulaSky();
    const starfield = createDeepStarfield({ count });
    scene.add(nebula.mesh);
    scene.add(starfield.mesh);

    const setProj = () => {
        const dpr = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
        const h = ((sizes && sizes.height) || window.innerHeight) * dpr;
        const projY = camera.projectionMatrix.elements[5];
        starfield.setProjection(h, projY);
    };

    return {
        cameraRadius: 14,
        update(time) {
            nebula.update(time);
            starfield.update(time);
            setProj();
        },
        // Slow drift near the canopy interior so depth shells parallax; framing
        // matches the real theme (camera back from origin, looking in).
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
            nebula.dispose();
            starfield.dispose();
        },
    };
}
