/**
 * The tarn's life up close (chapter 3, composition/odyssey-pond-life.js): the swans, the heron and
 * the drinking deer as the game poses them, with a camera that follows one animal.
 *
 *   ?effect=odyssey-pond-life&animal=swan0|swan1|heron|hind|calf&view=34|side|front|back|top|game
 *     &t0=<seconds on the animal's clock>&dist=<u>&t=<playground seconds, added to t0>
 *
 * The animal's clock is `t0 + t`, so `?t=` gives phase-locked, reproducible frames of any
 * behaviour (the motion module's schedules list when each one happens). The water is a plain
 * turquoise plane at the tarn's level, the heron stands on a flat bottom half a unit under it and the
 * deer on flat ground just above it: this is for watching the animals, not the place (the place is
 * the game's: the stations tool at L18-L23).
 */
import * as THREE from 'three/webgpu';
import { createOdysseyPondLife } from '../../rendering/odyssey/composition/odyssey-pond-life.js';
import { ODYSSEY_TARN } from '../../rendering/odyssey/world/odyssey-world-height.js';

export const meta = {
    id: 'odyssey-pond-life',
    title: 'Odyssey pond life',
    description: "The tarn's swans, heron and drinking deer up close (animal=, view=, t0=)",
};

const W = ODYSSEY_TARN.waterY;

export function create({
    scene, renderer, camera, params,
}) {
    const animal = params.get('animal') || 'swan0';
    const view = params.get('view') || '34';
    const t0 = Number.parseFloat(params.get('t0') || '0') || 0;
    const deer = animal === 'hind' || animal === 'calf';
    const floor = deer ? W + 0.4 : W - 0.5;
    const pond = createOdysseyPondLife({ heightAt: () => floor, world: null });
    scene.add(pond.group);
    scene.background = new THREE.Color(0.56, 0.70, 0.86);

    const water = new THREE.Mesh(
        new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
        new THREE.MeshBasicNodeMaterial({
            color: new THREE.Color(0.16, 0.55, 0.58), transparent: animal === 'heron', opacity: 0.55,
        }),
    );
    water.position.y = W;
    scene.add(water);
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
        new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.11, 0.2, 0.06) }),
    );
    ground.position.y = floor - (deer ? 0 : 0.02);
    ground.visible = deer || animal === 'heron';
    scene.add(ground);

    let loaded = false;
    const target = () => {
        if (animal === 'heron') {
            const h = pond.heron;
            return {
                x: h.x ?? 0, y: floor + 1.6, z: h.z ?? 0, heading: h.heading ?? 0,
            };
        }
        if (deer) {
            const s = pond.drinkers?.states?.[animal === 'hind' ? 0 : 1] ?? {};
            return {
                x: s.x ?? 0, y: floor + 2.2, z: s.z ?? 0, heading: s.heading ?? 0,
            };
        }
        const s = pond.swans[animal === 'swan1' ? 1 : 0] ?? {};
        return {
            x: s.x ?? 0, y: W + 1.0, z: s.z ?? 0, heading: s.heading ?? 0,
        };
    };
    const distance = Number.parseFloat(params.get('dist') || '') || (deer ? 13 : 8.5);
    // Where the camera stands round the animal: (angle from its heading, elevation, distance scale).
    const VIEWS = {
        34: [0.75, 0.22, 1],
        side: [Math.PI / 2, 0.06, 1],
        front: [0, 0.08, 1],
        back: [Math.PI, 0.12, 1],
        top: [Math.PI / 2, 1.35, 1],
        game: [0.6, 0.32, 26],
    };
    const [around, up, scale] = VIEWS[view] ?? VIEWS[34];

    return {
        cameraRadius: distance,
        async renderAsync() {
            await pond.load();
            pond.markReady();
            loaded = true;
            pond.update(t0, 0.25);
            renderer.render(scene, camera);
        },
        update(time) {
            if (loaded) pond.update(t0 + time, 0.25);
        },
        camera(time, cam) {
            const tg = target();
            const a = tg.heading + around;
            const d = distance * scale;
            cam.position.set(
                tg.x + (Math.sin(a) * Math.cos(up) * d),
                tg.y + (Math.sin(up) * d),
                tg.z + (Math.cos(a) * Math.cos(up) * d),
            );
            cam.lookAt(tg.x, tg.y, tg.z);
            cam.fov = 40;
            cam.near = 0.1;
            cam.far = 9000;
            cam.updateProjectionMatrix();
        },
        dispose() {
            pond.dispose();
            [water, ground].forEach((m) => {
                m.geometry.dispose();
                m.material.dispose();
                m.removeFromParent();
            });
        },
    };
}
