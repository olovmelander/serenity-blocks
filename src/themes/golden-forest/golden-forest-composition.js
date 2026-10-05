/**
 * Golden Forest — where the camera stands and where every tree grows.
 *
 * The board card hides the middle of the screen, so the picture is composed for the two
 * side thirds: on the left an old spruce frames the sun resting on the headland's treetops
 * and its path across the water; on the right a shore pine leans over the lake in front
 * of a wooded promontory, an island and the far shore. The procedural stands are generated
 * once in priority order, so a lower quality tier keeps the same forest with fewer trees.
 */
import * as THREE from 'three/webgpu';
import { goldenForestGroundHeight, goldenForestShores } from './golden-forest-terrain.js';

/** `position[1]` is eye height above the ground under the camera. */
export const GOLDEN_FOREST_VIEWS = Object.freeze({
    landscape: Object.freeze({ fov: 50, position: [0, 2.7, 14.5], target: [0, 4.1, -46] }),
    portrait: Object.freeze({ fov: 68, position: [0, 2.8, 16.5], target: [-13, 7.4, -44] }),
});
export const GOLDEN_FOREST_SUN_AZIMUTH_DEGREES = -21;

export function goldenForestViewFor(aspect) {
    return aspect < 0.85 ? GOLDEN_FOREST_VIEWS.portrait : GOLDEN_FOREST_VIEWS.landscape;
}

/** World position of the camera for a framing. */
export function goldenForestEye(view) {
    const [x, eye, z] = view.position;
    return [x, goldenForestGroundHeight(x, z) + eye, z];
}

/** Trees placed by hand. `tone` picks the crown colour along the species' ramp. */
export const GOLDEN_FOREST_FEATURE_TREES = Object.freeze([
    // The frame: an old spruce on the left point, a pine leaning out over the water on the right.
    {
        asset: 'spruce-hero', x: -10.9, z: 3.4, yaw: 0.6, scale: 1, tone: 0.3,
    },
    {
        asset: 'pine-hero', x: 10.1, z: 1.5, yaw: 0.12, scale: 1, tone: 0.55,
    },
    // Company for the two: one behind the spruce (in frame only on screens wider than
    // 16:9), two on the spit behind the boat.
    {
        asset: 'spruce-grove-b', x: -17.4, z: 4, yaw: 2.2, scale: 1.05, tone: 0.2,
    },
    {
        asset: 'spruce-grove-a', x: 18.4, z: -8.2, yaw: 4.1, scale: 1.08, tone: 0.42,
    },
    {
        asset: 'spruce-grove-c', x: 21.2, z: -13.2, yaw: 1.3, scale: 1.1, tone: 0.3,
    },
    // The islet in the sun's path: a wind-bent pine and a seedling spruce.
    {
        asset: 'pine-grove-b', x: -17.2, z: -44.8, yaw: 2.6, scale: 0.8, tone: 0.7,
    },
    {
        asset: 'spruce-grove-c', x: -15.2, z: -44.2, yaw: 0.4, scale: 0.42, tone: 0.5,
    },
]);

const SPRUCES = ['spruce-grove-a', 'spruce-grove-b', 'spruce-grove-c', 'spruce-grove-d'];
const PINES = ['pine-grove-a', 'pine-grove-b'];
// A sampling box (x0, x1, z0, z1), the land that counts, spacing, and the band's share.
const GROVE_BANDS = [
    {
        box: [-150, -24, -134, -92], on: (s) => s.headland > 1.6, spacing: 6.6, share: 0.34, pines: 0.2, far: true,
    },
    {
        box: [26, 94, -72, -40], on: (s) => s.promontory > 1.4, spacing: 6.4, share: 0.2, pines: 0.25, far: false,
    },
    {
        box: [-44, -15, -6, 18], on: (s) => s.near > 3, spacing: 7.2, share: 0.1, pines: 0.15, far: false,
    },
    {
        box: [14, 40, -18, 16],
        on: (s) => Math.max(s.near, s.right) > 3,
        spacing: 7.2,
        share: 0.1,
        pines: 0.2,
        far: false,
    },
    {
        box: [34, 86, -156, -72], on: (s) => s.right > 2, spacing: 8, share: 0.16, pines: 0.3, far: true,
    },
    {
        box: [44, 62, -147, -134], on: (s) => s.island > 1, spacing: 4.4, share: 0.1, pines: 0.25, far: true,
    },
];
export const GOLDEN_FOREST_GROVE_CEILING = 50;

/** Bearing of a ground point from the landscape camera, in degrees (negative: left). */
function bearing(x, z) {
    const eye = GOLDEN_FOREST_VIEWS.landscape.position;
    return THREE.MathUtils.radToDeg(Math.atan2(x - eye[0], eye[2] - z));
}

/** The whole procedural forest in priority order; tiers take a prefix. */
export function layoutGoldenForestGrove(rng, count = GOLDEN_FOREST_GROVE_CEILING) {
    const placed = GOLDEN_FOREST_FEATURE_TREES.map((tree) => ({ ...tree }));
    const grove = [];
    const order = [];
    // Interleave bands so every prefix of the list covers every shore.
    const quota = GROVE_BANDS.map((band) => Math.round(band.share * GOLDEN_FOREST_GROVE_CEILING));
    for (let round = 0; order.length < GOLDEN_FOREST_GROVE_CEILING && round < GOLDEN_FOREST_GROVE_CEILING; round += 1) {
        for (let band = 0; band < GROVE_BANDS.length; band += 1) {
            if (quota[band] > 0) {
                order.push(band);
                quota[band] -= 1;
            }
        }
    }
    for (let index = 0; index < order.length; index += 1) {
        const band = GROVE_BANDS[order[index]];
        for (let attempt = 0; attempt < 60; attempt += 1) {
            const x = band.box[0] + (band.box[1] - band.box[0]) * rng();
            const z = band.box[2] + (band.box[3] - band.box[2]) * rng();
            const tooClose = placed.some((other) => Math.hypot(other.x - x, other.z - z) < band.spacing);
            if (band.on(goldenForestShores(x, z)) && !tooClose) {
                // Where the sun stands behind the headland, open-crowned pines and young
                // spruces let its disc through.
                const sunGap = Math.abs(bearing(x, z) - GOLDEN_FOREST_SUN_AZIMUTH_DEGREES) < 3.4 && z < -80;
                const pine = rng() < (sunGap ? 0.75 : band.pines);
                const list = pine ? PINES : SPRUCES;
                const tree = {
                    asset: list[Math.floor(rng() * list.length) % list.length],
                    x,
                    z,
                    yaw: rng() * Math.PI * 2,
                    scale: (sunGap ? 0.7 : 0.92) + rng() * (sunGap ? 0.16 : 0.34),
                    tone: THREE.MathUtils.clamp(
                        0.45 + Math.sin(x * 0.05 + z * 0.04) * 0.28 + (rng() - 0.5) * 0.4,
                        0,
                        1,
                    ),
                    far: band.far,
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
 * A conservative test for "could this sphere ever be on screen", directly or mirrored in
 * the lake. It is the union of the landscape and portrait framings at their widest aspect,
 * padded for pointer parallax, and lets the forest skip sprays no pixel will ever need.
 */
export function createGoldenForestVisibilityTest() {
    const views = [
        { view: GOLDEN_FOREST_VIEWS.landscape, tanV: Math.tan(THREE.MathUtils.degToRad(25)) * 1.14, aspect: 2.45 },
        { view: GOLDEN_FOREST_VIEWS.portrait, tanV: Math.tan(THREE.MathUtils.degToRad(34)) * 1.14, aspect: 0.85 },
    ].map(({ view, tanV, aspect }) => {
        const eye = new THREE.Vector3(...goldenForestEye(view));
        const forward = new THREE.Vector3(...view.target).sub(eye).normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward);
        return {
            eye, forward, right, up, tanV, tanH: tanV * aspect,
        };
    });
    const offset = new THREE.Vector3();
    const inView = (x, y, z, radius) => views.some((frame) => {
        offset.set(x, y, z).sub(frame.eye);
        const depth = offset.dot(frame.forward);
        if (depth < -radius) return false;
        const reach = Math.max(depth, 0);
        return Math.abs(offset.dot(frame.right)) <= reach * frame.tanH + radius * 1.6
            && Math.abs(offset.dot(frame.up)) <= reach * frame.tanV + radius * 1.6;
    });
    return (x, y, z, radius) => inView(x, y, z, radius) || inView(x, -y, z, radius);
}
