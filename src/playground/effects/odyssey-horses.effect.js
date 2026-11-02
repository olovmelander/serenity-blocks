/**
 * ODYSSEY WILD HORSES, UP CLOSE — the band exactly as the game draws it (composition/odyssey-horses.js,
 * its life odyssey-horse-band.js), on a flat meadow, with a camera that follows one horse. For
 * judging the design and the motion at a size the rail never shows: every gait, the transitions,
 * grazing, the foals' play, the hair, the dust.
 *
 *   ?effect=odyssey-horses&t=<board seconds>&horse=<0-6>&view=side|front|three|rear|band&dist=<u>
 *
 * The band's clock is the playground's time (so ?t= is a board time: 118-146 s the long run,
 * 262-274 s the run back, the rest grazing). `horse` indexes the band's draw order: 0 lead mare,
 * 1 grey mare, 2 bay mare, 3 dun mare, 4 stallion, 5 dun foal, 6 bay foal.
 */
import * as THREE from 'three/webgpu';
import * as current from '../../rendering/odyssey/composition/odyssey-horses.js';
import * as currentBand from '../../rendering/odyssey/composition/odyssey-horse-band.js';
import { ODYSSEY_WORLD_SUN } from '../../rendering/odyssey/chapter-environments/shared/chapter-profile.js';

export const meta = {
    id: 'odyssey-horses',
    title: 'Odyssey wild horses (close-up)',
    description: 'The wild horse band as the game draws it, a camera following one horse',
};

export function create({
    scene, camera: viewCamera, renderer, params,
}) {
    const ground = () => 0;
    let horses = null;
    const band = currentBand;
    scene.background = new THREE.Color(0.62, 0.72, 0.84);
    // A plain meadow under the band (the game's ground is the world's; this only has to read as grass).
    const meadow = new THREE.Mesh(
        new THREE.PlaneGeometry(900, 900),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.26, 0.09) }),
    );
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.set(-60, 0, -370);
    scene.add(meadow);
    const which = Math.max(0, Math.min(6, Number(params.get('horse') ?? 0)));
    const view = params.get('view') ?? 'side';
    const dist = Number(params.get('dist') ?? 0);
    let ready = false;
    const loading = (async () => {
        horses = current.createOdysseyHorses({ heightAt: ground });
        scene.add(horses.group);
        await horses.load();
        horses.markReady();
        ready = true;
    })();
    // The sunlit side of the horse faces the camera in the side and three-quarter views.
    const sunSide = ODYSSEY_WORLD_SUN;
    const at = { x: 0, z: 0, heading: 0 };
    let lastTime = 0;
    return {
        update(time) {
            lastTime = time;
            if (ready) horses.update(time, 0.2);
        },
        camera(time, camera) {
            const horse = horses?.band[which];
            const k = horse ? horse.k : 3;
            // The drawn state (the last pose), or the clock's before the first.
            const drawn = horses?.states[which];
            if (drawn && Number.isFinite(drawn.x)) Object.assign(at, drawn);
            else if (horse) band.horseStateAt(horse, time, at);
            const h = at.heading;
            const fx = Math.sin(h);
            const fz = Math.cos(h);
            const flip = ((Math.cos(h) * sunSide[0]) - (Math.sin(h) * sunSide[2])) >= 0 ? 1 : -1;
            const lx = Math.cos(h) * flip;
            const lz = -Math.sin(h) * flip;
            const d = dist || (k * 5.6);
            let eye;
            if (view === 'front') eye = [at.x + (fx * d), k * 1.0, at.z + (fz * d)];
            else if (view === 'rear') eye = [at.x - (fx * d), k * 1.2, at.z - (fz * d)];
            else if (view === 'three') eye = [at.x + (((fx * 0.7) + (lx * 0.7)) * d), k * 1.3, at.z + (((fz * 0.7) + (lz * 0.7)) * d)];
            else if (view === 'band') eye = [-60 + 140, 70, -370 + 120];
            else eye = [at.x + (lx * d), k * 0.75, at.z + (lz * d)];
            camera.position.set(...eye);
            if (view === 'band') camera.lookAt(-60, 0, -370);
            else camera.lookAt(at.x, k * 0.65, at.z);
            camera.fov = view === 'band' ? 40 : 35;
            camera.near = 0.5;
            camera.far = 4000;
            camera.updateProjectionMatrix();
        },
        async renderAsync() {
            await loading;
            horses.update(lastTime, 0.2);
            await renderer.compileAsync(scene, viewCamera);
            renderer.render(scene, viewCamera);
        },
        dispose() {
            horses?.dispose();
            scene.remove(meadow);
            meadow.geometry.dispose();
            meadow.material.dispose();
            scene.background = null;
        },
    };
}
