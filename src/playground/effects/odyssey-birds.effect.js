/**
 * Odyssey's birds up close (composition/odyssey-flights.js, odyssey-summit-birds.js,
 * odyssey-eagle.js): the real draws and shaders, with a camera that follows one bird.
 *
 *   ?effect=odyssey-birds&bird=gull|swallow|goose|vulture|eagle&lane=<n>&view=side|front|34|below|chase
 *     &dist=<u>&t0=<seconds on the board clock>&t=<playground seconds, added to t0>
 *
 * The bird's clock is `t0 + t`, so `?t=` (or `__PLAYGROUND__.seek(t)`) gives phase-locked,
 * reproducible frames of a beat, a glide or a bout starting. The camera turns with the bird's
 * heading (not its bank), so a strip shows the wings, the bank and the tail, not the path. The
 * place is the game's (stations at L11-L34): this is for watching the birds.
 */
import * as THREE from 'three/webgpu';
import {
    FLIGHT_KIND, ODYSSEY_FLIGHTS, createOdysseyFlights, flightFrameAt, resolveFlightLanes,
} from '../../rendering/odyssey/composition/odyssey-flights.js';
import { createSummitBirds, summitFrameAt } from '../../rendering/odyssey/composition/odyssey-summit-birds.js';
import { createOdysseyEagle } from '../../rendering/odyssey/composition/odyssey-eagle.js';
import { createEaglePose, eagleFlight } from '../../rendering/odyssey/composition/odyssey-eagle-flight.js';

export const meta = {
    id: 'odyssey-birds',
    title: 'Odyssey birds',
    description: 'The gulls, swallows, geese, summit vultures and eagle up close (bird=, lane=, view=, t0=)',
};

const KIND = { gull: FLIGHT_KIND.GULL, swallow: FLIGHT_KIND.SWALLOW, goose: FLIGHT_KIND.GOOSE };
/** Journey progress where each flock's window is open. */
const PROGRESS = { gull: 0.18, swallow: 0.26, goose: 0.30 };

export function create({
    scene, camera, renderer, params,
}) {
    const bird = params.get('bird') || 'gull';
    const laneIndex = Number.parseInt(params.get('lane') || '0', 10) || 0;
    const view = params.get('view') || '34';
    const t0 = Number.parseFloat(params.get('t0') || '0') || 0;
    scene.background = new THREE.Color(0.56, 0.70, 0.86);

    let flights = null;
    let summit = null;
    let eagle = null;
    let lane = null;
    let ready = bird !== 'eagle';
    const eaglePose = createEaglePose();
    if (KIND[bird] !== undefined) {
        flights = createOdysseyFlights();
        scene.add(flights.group);
        const lanes = resolveFlightLanes().filter((l) => l.kind === KIND[bird]);
        lane = lanes[Math.min(laneIndex, lanes.length - 1)];
    } else if (bird === 'vulture') {
        summit = createSummitBirds();
        scene.add(summit.mesh);
    } else {
        eagle = createOdysseyEagle();
        scene.add(eagle.group);
    }

    /** The bird's place and its heading's frame (forward, left) at board clock `t`. */
    const frameAt = (t) => {
        if (flights) return flightFrameAt(lane, t, ODYSSEY_FLIGHTS);
        if (summit) return summitFrameAt(laneIndex % 12, t);
        eagleFlight(t, {}, eaglePose);
        return {
            position: [eaglePose.path.x, eaglePose.path.y, eaglePose.path.z], forward: eaglePose.forward,
        };
    };
    const span = {
        gull: 4.6, swallow: 1.3, goose: 6.6, vulture: 11.4, eagle: 11,
    }[bird];
    const distance = Number.parseFloat(params.get('dist') || '') || span * 2.2;
    // Where the camera stands round the bird: (angle from its heading, elevation).
    const VIEWS = {
        34: [0.75, 0.22], side: [Math.PI / 2, 0.04], front: [0, 0.10], below: [0.6, -0.75], chase: [Math.PI, 0.35],
    };
    const [around, up] = VIEWS[view] ?? VIEWS[34];
    let clock = t0;

    const step = (time, delta = 1 / 30) => {
        clock = t0 + time;
        if (flights) flights.update(clock, PROGRESS[bird]);
        if (summit) summit.update(clock, 0.5);
        if (eagle && ready) eagle.update(clock, delta, 0.36);
    };

    return {
        cameraRadius: distance,
        async renderAsync() {
            if (eagle) {
                await eagle.load();
                eagle.markReady();
                ready = true;
                eagle.update(t0, 2, 0.36);
            }
            step(0);
            renderer.render(scene, camera);
        },
        update(time, dt) { step(time, dt || 1 / 30); },
        seek(time) { step(time, 2); },
        camera(time, cam) {
            const fr = frameAt(t0 + time);
            const [x, y, z] = fr.position;
            const f = fr.forward;
            const heading = Math.atan2(f[0], f[2]);
            const a = heading + around;
            cam.position.set(
                x + (Math.sin(a) * Math.cos(up) * distance),
                y + (Math.sin(up) * distance),
                z + (Math.cos(a) * Math.cos(up) * distance),
            );
            cam.lookAt(x, y, z);
            cam.fov = 35;
            cam.near = 0.1;
            cam.far = 9000;
            cam.updateProjectionMatrix();
        },
        getDiagnostics() {
            return {
                bird, lane: laneIndex, clock, ready,
            };
        },
        dispose() {
            flights?.dispose();
            summit?.dispose();
            eagle?.dispose();
        },
    };
}
