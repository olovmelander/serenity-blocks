/**
 * Summer — where the camera stands and where every tree grows.
 *
 * The board card hides the middle of the screen, so the picture is composed for the two
 * side thirds. The camera stands in the meadow behind a crest of tall flowers. On the left
 * an old spruce leans into the frame beside the maypole on its mown ring; the sun stands
 * low over the lake, seen from the resting camera through the maypole's right-hand wreath,
 * and lays its path down the water toward the camera. On the right a weeping birch hangs
 * its strands over the jetty, the rowboat and the red cottage on its promontory (in single
 * player the score card stands on this side, which is why the sun does not). The
 * procedural stands are generated once in priority order, so a lower quality tier keeps
 * the same woods with fewer trees.
 */
import * as THREE from 'three/webgpu';
import { SUMMER_PLACES, summerGroundHeight, summerShores } from './summer-terrain.js';

/**
 * `position[1]` is eye height above the ground under the camera; `target` is in world
 * metres. The landscape camera looks very nearly level, which is what leaves the maypole's
 * leafy crown inside the top of the frame.
 */
export const SUMMER_VIEWS = Object.freeze({
    landscape: Object.freeze({ fov: 50, position: [0, 2.9, 14.5], target: [0, 4, -45.5] }),
    portrait: Object.freeze({ fov: 68, position: [0, 2.9, 15.5], target: [-11, 4.6, -44.5] }),
});

export function summerViewFor(aspect) {
    return aspect < 0.85 ? SUMMER_VIEWS.portrait : SUMMER_VIEWS.landscape;
}

/** World position of the camera for a framing. */
export function summerEye(view) {
    const [x, eye, z] = view.position;
    return [x, summerGroundHeight(x, z) + eye, z];
}

/** Trees placed by hand. `tone` picks the crown colour along the species' ramp. */
export const SUMMER_FEATURE_TREES = Object.freeze([
    // The frame: a weeping birch on the right whose strands cross the sun, and an old
    // spruce at the left edge.
    {
        asset: 'birch-hero', x: 8.9, z: 6, yaw: 0.2, scale: 1.18, tone: 0.62,
    },
    {
        asset: 'spruce-hero', x: -12.8, z: 2, yaw: 2.1, scale: 1, tone: 0.34,
    },
    // Company: a young birch by the shore on the left, two more past the hero on the right
    // (in frame only on screens wider than 16:9).
    {
        asset: 'birch-grove-b', x: -17.2, z: -7.6, yaw: 1.2, scale: 0.86, tone: 0.5,
    },
    {
        asset: 'birch-grove-a', x: 15.4, z: -3.2, yaw: 3.3, scale: 0.94, tone: 0.7,
    },
    {
        asset: 'spruce-grove-b', x: -19.6, z: 6.4, yaw: 0.6, scale: 1.02, tone: 0.28,
    },
    // The homestead: birches about the cottage, spruce behind it.
    {
        asset: 'birch-grove-c', x: 30.6, z: -20.4, yaw: 0.9, scale: 1, tone: 0.66,
    },
    {
        asset: 'birch-grove-a', x: 28.2, z: -33.4, yaw: 4.6, scale: 1.06, tone: 0.5,
    },
    {
        asset: 'spruce-grove-c', x: 33.6, z: -29.6, yaw: 2.6, scale: 1.08, tone: 0.36,
    },
    // A lone birch on the skerry.
    {
        asset: 'birch-grove-b', x: -17.1, z: -63.3, yaw: 5.2, scale: 0.46, tone: 0.72,
    },
]);

const BIRCHES = ['birch-grove-a', 'birch-grove-b', 'birch-grove-c'];
const SPRUCES = ['spruce-grove-a', 'spruce-grove-b', 'spruce-grove-c', 'spruce-grove-d'];
const { cottage, maypole } = SUMMER_PLACES;
/** Open ground the homestead keeps: the yard between the cottage and the water. */
function yard(x, z) {
    return Math.hypot(x - cottage.x, z - cottage.z) < 8.5 || (x < cottage.x + 2 && z > cottage.z - 4);
}
// A sampling box (x0, x1, z0, z1), the land that counts, spacing, and the band's share.
const GROVE_BANDS = [
    {
        box: [-210, -30, -152, -96], on: (s) => s.headland > 1.8, spacing: 6.2, share: 0.34, birches: 0.22, far: true,
    },
    {
        box: [22, 92, -46, -6],
        on: (s, x, z) => s.homestead > 2.2 && !yard(x, z),
        spacing: 6,
        share: 0.2,
        birches: 0.55,
        far: false,
    },
    {
        box: [-62, -21, -7, 24],
        on: (s, x, z) => s.near > 3.5 && Math.hypot(x - maypole.x, z - maypole.z) > 13,
        spacing: 7,
        share: 0.12,
        birches: 0.4,
        far: false,
    },
    {
        box: [19, 58, -8, 22], on: (s) => s.near > 3.5, spacing: 7, share: 0.1, birches: 0.55, far: false,
    },
    {
        box: [52, 140, -160, -40], on: (s) => s.right > 3, spacing: 7.6, share: 0.14, birches: 0.25, far: true,
    },
    {
        box: [30, 49, -142, -131], on: (s) => s.island > 1.2, spacing: 4.2, share: 0.1, birches: 0.3, far: true,
    },
];
export const SUMMER_GROVE_CEILING = 46;

/** The whole procedural wood in priority order; tiers take a prefix. */
export function layoutSummerGrove(rng, count = SUMMER_GROVE_CEILING) {
    const placed = SUMMER_FEATURE_TREES.map((tree) => ({ ...tree }));
    const grove = [];
    const order = [];
    // Interleave bands so every prefix of the list covers every shore.
    const quota = GROVE_BANDS.map((band) => Math.round(band.share * SUMMER_GROVE_CEILING));
    for (let round = 0; order.length < SUMMER_GROVE_CEILING && round < SUMMER_GROVE_CEILING; round += 1) {
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
            if (band.on(summerShores(x, z), x, z) && !tooClose) {
                const birch = rng() < band.birches;
                const list = birch ? BIRCHES : SPRUCES;
                const tree = {
                    asset: list[Math.floor(rng() * list.length) % list.length],
                    x,
                    z,
                    yaw: rng() * Math.PI * 2,
                    scale: 0.9 + rng() * 0.34,
                    tone: THREE.MathUtils.clamp(
                        0.5 + Math.sin(x * 0.05 + z * 0.04) * 0.26 + (rng() - 0.5) * 0.4,
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
 * padded for pointer parallax, and lets the world skip what no pixel will ever need.
 */
export function createSummerVisibilityTest() {
    const views = [
        { view: SUMMER_VIEWS.landscape, tanV: Math.tan(THREE.MathUtils.degToRad(25)) * 1.14, aspect: 2.45 },
        { view: SUMMER_VIEWS.portrait, tanV: Math.tan(THREE.MathUtils.degToRad(34)) * 1.14, aspect: 0.85 },
    ].map(({ view, tanV, aspect }) => {
        const eye = new THREE.Vector3(...summerEye(view));
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
