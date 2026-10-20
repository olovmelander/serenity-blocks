/**
 * Synthwave Sunset — where the built things stand. One place, so the wheel, the pier, the coaster
 * and the promenade agree.
 *
 * The rest camera stands at (RIG.x, RIG.z) facing −z, the sun sets at azimuth 0. The pier runs
 * from the promenade on the right (its land end just off the right edge of the game view) out to
 * sea, ending in a platform that carries the ferris wheel at azimuth WHEEL.azimuthDeg, just right
 * of the sun. The wheel's axle runs along the pier, so its face turns toward the camera by the
 * pier's own angle and shows its depth.
 */

import * as THREE from 'three/webgpu';
import { RIG } from './synthwave-sunset-tsl.js';

const DEG = Math.PI / 180;

/** The wheel (metres). */
export const WHEEL = Object.freeze({
    azimuthDeg: 2.2,
    distance: 165,
    radius: 28,
    hubY: 4.5 + 28 + 4.6,
    /** Spacing of the two rims along the axle. */
    depth: 4.4,
    spokes: 20,
    cabins: 20,
    /** Seconds per revolution. */
    period: 120,
    rimBulbs: 120,
    spokeBulbs: 5,
});

/** The pier (metres): deck height above the sea, width, where it meets the promenade. */
export const PIER = Object.freeze({
    deckY: 4.5,
    deckThickness: 0.75,
    width: 9,
    landX: 58,
    landZ: 9,
    /** Bents (rows of piles) every so many metres. */
    bentSpacing: 6.5,
});

/**
 * The pier head: at its far end the deck turns square to the pier into a T as wide as the wheel's
 * legs splay (the wheel's plane runs across the pier), so the wheel stands on a dock with its own
 * piles instead of over open water. `s0`..`s1` along the pier, ±`halfAcross` across it.
 */
export const PIER_HEAD = Object.freeze({
    s0: -9,
    s1: 9,
    halfAcross: 21,
});

/** The wheel's hub in world space. */
export function wheelWorldPosition(target = new THREE.Vector3()) {
    const a = WHEEL.azimuthDeg * DEG;
    return target.set(RIG.x + Math.sin(a) * WHEEL.distance, WHEEL.hubY, RIG.z - Math.cos(a) * WHEEL.distance);
}

/**
 * The pier's frame: `far` (the end under the wheel, at deck height), `near` (the land end),
 * `along` (unit, far → near), `across` (unit, horizontal, along × up = across), `length`.
 * A pier point (s metres from the far end, c across, h above the sea) is far + along·s + across·c
 * + up·(h − deckY).
 */
export function pierFrame() {
    const hub = wheelWorldPosition();
    const far = new THREE.Vector3(hub.x, PIER.deckY, hub.z);
    const near = new THREE.Vector3(PIER.landX, PIER.deckY, PIER.landZ);
    const along = near.clone().sub(far);
    const length = along.length();
    along.divideScalar(length);
    const across = new THREE.Vector3(-along.z, 0, along.x);
    const at = (s, c = 0, h = PIER.deckY) => new THREE.Vector3(
        far.x + along.x * s + across.x * c,
        h,
        far.z + along.z * s + across.z * c,
    );
    return {
        far,
        near,
        along,
        across,
        length,
        at,
        /** The pier's basis for oriented boxes: x = along, y = up, z = across (right-handed). */
        basis: { x: along.clone(), y: new THREE.Vector3(0, 1, 0), z: across.clone() },
        /** The heading (rotation.y) that turns a local +z onto the pier's axis. */
        heading: Math.atan2(along.x, along.z),
    };
}
