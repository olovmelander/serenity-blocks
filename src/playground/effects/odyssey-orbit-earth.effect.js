/**
 * ODYSSEY — the Earth below (step 2 of docs/ODYSSEY_INTO_SPACE_2026-10.md), alone.
 *
 * The round planet the climb leaves, from composition/odyssey-orbit-earth.js, on black. The game
 * drives it from its own schedule; here every input is a URL parameter, for the shape:
 *   alt    the eye's height in Earth radii (0.004 = just above the clouds, 0.5 = high orbit)
 *   sunEl  the sun's elevation at the eye, degrees (negative: the eye is on the night side)
 *   sunAz  the sun's bearing from the view, degrees (0 ahead, 90 right, 180 behind)
 *   pitch  the view's pitch, degrees; yaw its turn (+ = left); roll its roll
 *   aurora 0..1, the aurora's strength (its oval lies toward the night, opposite the sun)
 *   p      a journey progress: the game's own height, sun and aurora there (`orbitEarthAt`), the
 *          world sun's bearing, and a yaw that looks along the rail's bearing there (-74 deg at
 *          the 5->6 boundary); alt / sunEl / aurora / yaw still override
 * The playground has no tone curve, so judge the shape here and the colour in game.
 */
import * as THREE from 'three/webgpu';
import {
    createOrbitEarth,
    orbitEarthAt,
    orbitEarthSunDirection,
} from '../../rendering/odyssey/composition/odyssey-orbit-earth.js';
import { getActiveOdysseyChapterPositions } from '../../rendering/odyssey/path-utils.js';

export const meta = {
    id: 'odyssey-orbit-earth',
    title: 'Odyssey — the Earth below',
    description: 'The round planet the 5->6 climb leaves: cloud sea, terminator, atmosphere rim',
};

export function create({ scene, camera, params }) {
    if (camera) {
        camera.near = 1;
        camera.far = 9000;
        camera.fov = Number.isFinite(Number.parseFloat(params?.get?.('p'))) ? 74 : 58;
        camera.updateProjectionMatrix();
    }
    const num = (key, fallback) => {
        const v = Number.parseFloat(params?.get?.(key));
        return Number.isFinite(v) ? v : fallback;
    };
    const DEG = Math.PI / 180;
    const p = num('p', Number.NaN);
    const game = Number.isFinite(p) ? orbitEarthAt(p, getActiveOdysseyChapterPositions()) : null;
    const alt = num('alt', game ? game.altitude : 0.02);
    const sunEl = num('sunEl', game ? game.sunElevation / DEG : 6) * DEG;
    const sunAz = num('sunAz', 140) * DEG;
    const pitch = num('pitch', game ? 3 : 8) * DEG;
    const roll = num('roll', 0) * DEG;
    const yaw = num('yaw', game ? -74 : 0) * DEG;
    const presence = num('presence', game ? game.presence : 1);
    const aurora = num('aurora', game ? game.aurora : 0);
    // The view looks along -Z; the sun's bearing turns from there toward +X (the right). With a
    // progress the sun is the world sun's, on its own bearing, as in the game.
    const sun = game && !params?.get?.('sunAz')
        ? orbitEarthSunDirection(sunEl)
        : new THREE.Vector3(
            Math.sin(sunAz) * Math.cos(sunEl),
            Math.sin(sunEl),
            -Math.cos(sunAz) * Math.cos(sunEl),
        );
    const earth = createOrbitEarth();
    scene.add(earth.mesh);
    const eye = new THREE.Vector3(0, 0, 0);

    return {
        camera(time, cam) {
            cam.position.copy(eye);
            cam.rotation.set(pitch, yaw, roll, 'YXZ');
        },
        update(time) {
            earth.update({
                altitude: alt,
                sun,
                presence,
                aurora,
                eye,
                time,
                track: { x: time * 0.15, y: 0, z: -time * 0.05 },
            });
        },
        resize() {},
        dispose() {
            scene.remove(earth.mesh);
            earth.dispose();
        },
    };
}
