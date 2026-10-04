/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Starlight — Stardust River validation effect (Phase 3).
// Mounts the full composite: capped nebula sky + deep starfield + the curl-noise
// GPU compute stardust river. Proves the compute dispatch, curl drift, twinkle,
// and that the dust reads as a living current over the dark canopy.
//
//   /playground.html?effect=starlight-stardust&orbit=0
//   optional: &dust=20000 &stars=12000
import { createNebulaSky } from '../../themes/starlight/rendering/nebula-sky.js';
import { createDeepStarfield } from '../../themes/starlight/rendering/deep-starfield.js';
import { StardustSim } from '../../themes/starlight/sim/stardust-particles.js';
import { createStardustRenderer } from '../../themes/starlight/rendering/stardust-renderer.js';
import { StarlightPostPipeline, getStarlightPostProfile } from '../../themes/starlight/post/render-pipeline.js';

export const meta = {
    id: 'starlight-stardust',
    title: 'Starlight — Stardust River',
    description: 'Curl-noise GPU compute stardust over the deep starfield + nebula sky.',
};

export function create({
    scene, camera, renderer, sizes, params,
}) {
    const dustCount = parseInt(params.get('dust'), 10) || 18000;
    const starCount = parseInt(params.get('stars'), 10) || 12000;

    const nebula = createNebulaSky();
    const starfield = createDeepStarfield({ count: starCount });
    if (!params.has('dustOnly')) {
        scene.add(nebula.mesh);
        scene.add(starfield.mesh);
    }

    const computeOk = renderer?.backend?.isWebGPUBackend === true
        && typeof renderer.compute === 'function'
        && !params.has('cpu');
    const sim = new StardustSim(dustCount);
    if (computeOk) sim.createComputeNode();
    const dust = createStardustRenderer(sim, {
        sizeMul: 1.0, brightness: 1.2, twinkleAmp: 0.85, useStorage: computeOk,
    });
    scene.add(dust.mesh);
    if (typeof window !== 'undefined') window.__STARLIGHT_STARDUST_SIM__ = sim;

    const setProj = () => {
        const dpr = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
        const h = ((sizes && sizes.height) || window.innerHeight) * dpr;
        starfield.setProjection(h, camera.projectionMatrix.elements[5]);
    };
    const post = params.has('post')
        ? new StarlightPostPipeline(renderer, scene, camera, {
            ...getStarlightPostProfile(params.get('quality') || 'Low'),
            useMRT: renderer?.backend?.isWebGPUBackend === true,
        })
        : null;

    return {
        cameraRadius: 14,
        update(time, dt) {
            // Respect a capture-mode dt of exactly 0 (freeze); only a missing dt falls back.
            const d = Number.isFinite(dt) ? dt : 0.016;
            nebula.update(time);
            starfield.update(time);
            setProj();
            if (sim) {
                if (computeOk) {
                    sim.update(d, time);
                    try {
                        renderer.compute(sim.computeNode);
                    } catch (e) {
                        // eslint-disable-next-line no-console
                        console.error('[starlight-stardust] compute failed:', e);
                    }
                } else sim.updateCPU(d, time);
                dust.update(time);
            }
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
        render: post?.isEnabled() ? () => post.render() : undefined,
        renderAsync: post?.isEnabled() ? () => post.render() : undefined,
        dispose() {
            post?.dispose();
            if (typeof window !== 'undefined' && window.__STARLIGHT_STARDUST_SIM__ === sim) {
                delete window.__STARLIGHT_STARDUST_SIM__;
            }
            scene.remove(nebula.mesh);
            scene.remove(starfield.mesh);
            nebula.dispose();
            starfield.dispose();
            if (dust) {
                scene.remove(dust.mesh);
                dust.dispose();
            }
            if (sim) sim.dispose();
        },
    };
}
