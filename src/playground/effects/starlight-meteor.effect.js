/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Starlight — Meteors / Shooting Stars validation effect (Phase 4).
// Auto-spawns shooting stars (faint/bright + the occasional fireball) fanning
// from a radiant over the deep starfield, so the streak shape, heat-ramp tail,
// and head glow can be eyeballed. In-game these spawns are strictly event-bound.
//
//   /playground.html?effect=starlight-meteor&orbit=0
import { createNebulaSky } from '../../themes/starlight/rendering/nebula-sky.js';
import { createDeepStarfield } from '../../themes/starlight/rendering/deep-starfield.js';
import { MeteorSystem } from '../../themes/starlight/sim/meteor-system.js';
import { createMeteorRenderer } from '../../themes/starlight/rendering/meteor-renderer.js';

export const meta = {
    id: 'starlight-meteor',
    title: 'Starlight — Meteors',
    description: 'Velocity-stretched shooting stars fanning from a radiant over the starfield.',
};

export function create({
    scene, camera, renderer, sizes, params,
}) {
    const starCount = parseInt(params.get('stars'), 10) || 10000;

    const nebula = createNebulaSky();
    const starfield = createDeepStarfield({ count: starCount });
    const meteors = new MeteorSystem(24, { radiant: undefined });
    const meteorRenderer = createMeteorRenderer(meteors, { intensity: 1.0 });
    scene.add(nebula.mesh);
    scene.add(starfield.mesh);
    scene.add(meteorRenderer.mesh);

    // Seed a couple immediately so a t=0 screenshot shows streaks.
    meteors.spawnBright();
    meteors.spawn({ heat: 0.5 });

    let nextSpawn = 0.6;
    let acc = 0;

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
            setProj();

            acc += d;
            if (acc >= nextSpawn) {
                acc = 0;
                nextSpawn = 0.5 + Math.random() * 1.1;
                const roll = Math.random();
                if (roll > 0.9) meteors.spawnFireball();
                else if (roll > 0.55) meteors.spawnBright();
                else meteors.spawnFaint();
            }
            meteors.update(d);
            meteorRenderer.update();
        },
        // Match the GAME camera exactly (rest pose, FOV 40°) so the playground
        // crop == what the player sees — otherwise meteor scatter looks wrong.
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
            scene.remove(meteorRenderer.mesh);
            nebula.dispose();
            starfield.dispose();
            meteorRenderer.dispose();
            meteors.dispose();
        },
    };
}
