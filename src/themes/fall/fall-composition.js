/**
 * Fall — where the camera stands and where every tree grows.
 *
 * The board card hides the middle of the screen, so the picture is composed for the two
 * side thirds: an ancient maple and the path toward the low sun on the left, a spreading
 * oak and a stand of birches on the right. The procedural grove behind them is generated
 * once in priority order, so a lower quality tier keeps the same forest with fewer trees.
 */
import * as THREE from 'three/webgpu';
import { fallPathDistance } from './fall-terrain.js';

export const FALL_VIEWS = Object.freeze({
    landscape: Object.freeze({ fov: 55, position: [0, 2.6, 15], target: [0, 6.3, -30] }),
    portrait: Object.freeze({ fov: 68, position: [0, 2.9, 19], target: [0, 7.6, -30] }),
});

export function fallViewFor(aspect) {
    return aspect < 0.85 ? FALL_VIEWS.portrait : FALL_VIEWS.landscape;
}

/** Trees placed by hand. `tone` picks the crown colour along the species' autumn ramp. */
export const FALL_FEATURE_TREES = Object.freeze([
    {
        asset: 'maple-hero', x: -8.8, z: 2.2, yaw: 0.05, scale: 1, tone: 0.2,
    },
    {
        asset: 'oak-hero', x: 10.6, z: -2.6, yaw: 0.2, scale: 1, tone: 0.55,
    },
    // Birches catching the sun beside the path.
    {
        asset: 'birch-grove-a', x: -24.5, z: -34, yaw: 0.4, scale: 1.08, tone: 0.8,
    },
    {
        asset: 'birch-grove-b', x: -28.5, z: -38.5, yaw: 2.1, scale: 1.16, tone: 0.9,
    },
    {
        asset: 'birch-grove-a', x: -21.2, z: -42.5, yaw: 4.0, scale: 0.98, tone: 0.72,
    },
    // The stand to the right of the board.
    {
        asset: 'birch-grove-b', x: 14.2, z: -17.5, yaw: 1.2, scale: 1.12, tone: 0.86,
    },
    {
        asset: 'birch-grove-a', x: 17.6, z: -21, yaw: 3.3, scale: 1.2, tone: 0.78,
    },
    {
        asset: 'birch-grove-b', x: 12.4, z: -23.5, yaw: 5.2, scale: 1, tone: 0.92,
    },
]);

const GROVE_ASSETS = ['maple-grove-a', 'maple-grove-b', 'maple-grove-c', 'maple-grove-a', 'maple-grove-b',
    'maple-grove-c', 'birch-grove-a', 'birch-grove-b'];
// x range, z range and the minimum spacing for each band, nearest first.
const GROVE_BANDS = [
    {
        x: [-40, -13], z: [-32, -6], spacing: 8.5, share: 0.16,
    },
    {
        x: [15, 42], z: [-34, -8], spacing: 8.5, share: 0.16,
    },
    {
        x: [-52, 52], z: [-64, -32], spacing: 8, share: 0.3,
    },
    {
        x: [-82, 82], z: [-120, -64], spacing: 7, share: 0.38,
    },
];
export const FALL_GROVE_CEILING = 34;

/** The whole procedural grove in priority order; tiers take a prefix. */
export function layoutFallGrove(rng, count = FALL_GROVE_CEILING) {
    const placed = FALL_FEATURE_TREES.map((tree) => ({ ...tree }));
    const grove = [];
    const bandOrder = [];
    // Interleave bands so every prefix of the list covers near, middle and far.
    const quota = GROVE_BANDS.map((band) => Math.round(band.share * FALL_GROVE_CEILING));
    for (let round = 0; bandOrder.length < FALL_GROVE_CEILING && round < FALL_GROVE_CEILING; round += 1) {
        for (let band = 0; band < GROVE_BANDS.length; band += 1) {
            if (quota[band] > 0) {
                bandOrder.push(band);
                quota[band] -= 1;
            }
        }
    }
    for (let index = 0; index < bandOrder.length; index += 1) {
        const band = GROVE_BANDS[bandOrder[index]];
        for (let attempt = 0; attempt < 40; attempt += 1) {
            const x = band.x[0] + (band.x[1] - band.x[0]) * rng();
            const z = band.z[0] + (band.z[1] - band.z[0]) * rng();
            const corridor = 5 + Math.max(0, -z) * 0.035;
            const tooClose = placed.some((other) => Math.hypot(other.x - x, other.z - z) < band.spacing);
            if (fallPathDistance(x, z) >= corridor && !tooClose) {
                const far = z < -64;
                const tree = {
                    asset: GROVE_ASSETS[Math.floor(rng() * GROVE_ASSETS.length)],
                    x,
                    z,
                    yaw: rng() * Math.PI * 2,
                    scale: (far ? 1.05 : 0.9) + rng() * 0.32,
                    tone: THREE.MathUtils.clamp(0.5 + Math.sin(x * 0.07 + z * 0.05) * 0.32 + (rng() - 0.5) * 0.4, 0, 1),
                    far,
                };
                placed.push(tree);
                grove.push(tree);
                break;
            }
        }
    }
    return grove.slice(0, count);
}

/**
 * A conservative test for "could this sphere ever be on screen". It is the union of the
 * landscape and portrait framings at their widest aspect, padded for pointer parallax,
 * and lets the forest skip sprays that only exist above or behind the camera.
 */
export function createFallVisibilityTest() {
    const views = [
        { view: FALL_VIEWS.landscape, tanV: Math.tan(THREE.MathUtils.degToRad(27.5)) * 1.12, aspect: 2.45 },
        { view: FALL_VIEWS.portrait, tanV: Math.tan(THREE.MathUtils.degToRad(34)) * 1.12, aspect: 0.85 },
    ].map(({ view, tanV, aspect }) => {
        const eye = new THREE.Vector3(...view.position);
        const forward = new THREE.Vector3(...view.target).sub(eye).normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward);
        return {
            eye, forward, right, up, tanV, tanH: tanV * aspect,
        };
    });
    const offset = new THREE.Vector3();
    return (x, y, z, radius) => views.some((frame) => {
        offset.set(x, y, z).sub(frame.eye);
        const depth = offset.dot(frame.forward);
        if (depth < -radius) return false;
        const reach = Math.max(depth, 0);
        return Math.abs(offset.dot(frame.right)) <= reach * frame.tanH + radius * 1.6
            && Math.abs(offset.dot(frame.up)) <= reach * frame.tanV + radius * 1.6;
    });
}
