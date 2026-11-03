/**
 * THE MASSIF'S IBEX ON THEIR SHELF — the herd exactly as the game draws it (composition/odyssey-ibex.js,
 * its life odyssey-ibex-herd.js), standing on the real world (the drawn ground, the scree, the perch
 * rocks), in the world's own light. For judging the coat, the perch rocks against the scree and the
 * motion, from close up or from where the rail sees them.
 *
 *   ?effect=odyssey-ibex&t=<board seconds>&ibex=<0-3>&view=side|three|front|rear|rail&dist=<u>&p=<progress>
 *
 * The herd's clock is the playground's time (so ?t= is a board time, phase-locked). `ibex` picks the
 * animal the close views follow: 0 the buck, 1 and 2 the nannies, 3 the kid. `view=rail` looks at the
 * herd from the rail's ground track at journey progress `p` (default 0.26, inside their window) from
 * the eye's height: the size the player sees them at (with `dist`, from that far along the same line).
 */
import { createOdysseyWorld } from '../../rendering/odyssey/world/odyssey-world-renderer.js';
import { ODYSSEY_EYE_RAIL_OFFSET_Y } from '../../rendering/odyssey/world/odyssey-world-height.js';
import { getOdysseyPathPointAt } from '../../rendering/odyssey/path-utils.js';
import { createOdysseyIbex } from '../../rendering/odyssey/composition/odyssey-ibex.js';
import { deerStateAt } from '../../rendering/odyssey/composition/odyssey-deer-herd.js';
import { ODYSSEY_WORLD_SUN } from '../../rendering/odyssey/chapter-environments/shared/chapter-profile.js';

export const meta = {
    id: 'odyssey-ibex',
    title: 'Odyssey ibex on the shelf',
    description: 'The ibex herd on the real world: coat, perch rocks against the scree, motion (ibex=, view=)',
};

export function create({ scene, camera, params }) {
    camera.near = 0.5;
    camera.far = 30000;
    camera.updateProjectionMatrix();
    const railSamples = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
    const world = createOdysseyWorld({ quality: 'high', railSamples, visibilityCull: true });
    scene.add(world.group);
    const ibex = createOdysseyIbex({
        hazeColour: world.cloudPalette?.skyHorizon || null,
        sunColour: world.cloudPalette?.sunColour || null,
        heightAt: world.heightAt,
    });
    scene.add(ibex.group);
    const progress = Number.parseFloat(params.get('p') || '') || 0.26;
    const which = Math.max(0, Math.min(3, Number(params.get('ibex') ?? 0)));
    const view = params.get('view') ?? 'three';
    const dist = Number(params.get('dist') ?? 0);
    let ready = false;
    ibex.load().then(() => {
        ibex.markReady();
        ready = true;
    });
    const at = { x: 0, z: 0, heading: 0 };
    const rail = getOdysseyPathPointAt(progress);
    return {
        cameraRadius: 1200,
        update(time) {
            world.update(time, rail, 0.5, rail.y + ODYSSEY_EYE_RAIL_OFFSET_Y, camera);
            if (ready) ibex.update(time, progress);
        },
        camera(time, cam) {
            const animal = ibex.herd[which];
            const { k } = animal;
            deerStateAt(animal, time, at);
            const y = world.heightAt(at.x, at.z);
            if (view === 'rail') {
                // From the ground track's eye toward the herd's middle.
                const mid = ibex.herd.reduce((m, a) => {
                    const s = deerStateAt(a, time, {});
                    m.x += s.x / ibex.herd.length;
                    m.z += s.z / ibex.herd.length;
                    return m;
                }, { x: 0, z: 0 });
                const midY = world.heightAt(mid.x, mid.z) + 2;
                const eye = [rail.x, rail.y + ODYSSEY_EYE_RAIL_OFFSET_Y, rail.z];
                // (`dist` brings the eye in along that line, the rail's angle at a nearer distance.)
                const span = Math.hypot(eye[0] - mid.x, eye[1] - midY, eye[2] - mid.z);
                const s = dist > 0 ? Math.min(1, dist / span) : 1;
                cam.position.set(
                    mid.x + ((eye[0] - mid.x) * s),
                    midY + ((eye[1] - midY) * s),
                    mid.z + ((eye[2] - mid.z) * s),
                );
                cam.lookAt(mid.x, midY, mid.z);
                cam.fov = 40;
                cam.updateProjectionMatrix();
                return;
            }
            const h = at.heading;
            const fx = Math.sin(h);
            const fz = Math.cos(h);
            // The sunlit side toward the camera in the side and three-quarter views.
            const flip = ((Math.cos(h) * ODYSSEY_WORLD_SUN[0]) - (Math.sin(h) * ODYSSEY_WORLD_SUN[2])) >= 0 ? 1 : -1;
            const lx = Math.cos(h) * flip;
            const lz = -Math.sin(h) * flip;
            const d = dist || (k * 5.5);
            let e;
            if (view === 'front') e = [at.x + (fx * d), y + (k * 1.0), at.z + (fz * d)];
            else if (view === 'rear') e = [at.x - (fx * d), y + (k * 1.2), at.z - (fz * d)];
            else if (view === 'side') e = [at.x + (lx * d), y + (k * 0.8), at.z + (lz * d)];
            else e = [at.x + (((fx * 0.7) + (lx * 0.7)) * d), y + (k * 1.4), at.z + (((fz * 0.7) + (lz * 0.7)) * d)];
            cam.position.set(...e);
            cam.lookAt(at.x, y + (k * 0.6), at.z);
            cam.fov = 35;
            cam.updateProjectionMatrix();
        },
        resize() {},
        dispose() {
            ibex.dispose();
            scene.remove(world.group);
            world.dispose();
        },
    };
}
