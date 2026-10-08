/**
 * Forest — where the eye stands and where every tree grows.
 *
 * The board card hides the middle of the screen, so the picture is composed for the two
 * side thirds. On the left an ancient spruce frames the ride: a long opening that runs
 * from the eye toward the full moon and falls away into a valley of mist. On the right the
 * old wood closes in: an elder pine, a mossy knoll with a fallen trunk, birches pale among
 * the spruce. The procedural stands are generated once in priority order, so a lower
 * quality tier keeps the same forest with fewer trees.
 */
import * as THREE from 'three/webgpu';
import { FOREST_EYE, forestBearing, forestRidePoint } from './forest-plan.js';
import { forestGroundHeight, forestPlateau } from './forest-terrain.js';

/** `position[1]` is eye height above the ground under the camera. */
export const FOREST_VIEWS = Object.freeze({
    landscape: Object.freeze({ fov: 50, position: [FOREST_EYE.x, 1.85, FOREST_EYE.z], target: [-2.2, 5.4, -40] }),
    portrait: Object.freeze({ fov: 66, position: [FOREST_EYE.x, 1.9, FOREST_EYE.z], target: [-14.5, 11.5, -36] }),
});

/** Below this aspect the landscape framing would cut the moon: turn toward it instead. */
export const FOREST_UPRIGHT_ASPECT = 1.15;

export function forestViewFor(aspect) {
    return aspect < FOREST_UPRIGHT_ASPECT ? FOREST_VIEWS.portrait : FOREST_VIEWS.landscape;
}

/** World position of the camera for a framing. */
export function forestEye(view) {
    const [x, eye, z] = view.position;
    return [x, forestGroundHeight(x, z) + eye, z];
}

const onRide = (asset, s, d, yaw, scale, tone) => ({
    asset, ...forestRidePoint(s, d), yaw, scale, tone,
});

/** Trees placed by hand. `tone` picks the crown colour along the species' ramp. */
export const FOREST_FEATURE_TREES = Object.freeze([
    // The frame: the elder spruce on the left, the elder pine on the right.
    // (The elder's place and turn are chosen so its long low boughs hang clear of the moon.)
    {
        asset: 'spruce-elder', x: -5.6, z: 5.4, yaw: 1.5, scale: 1, tone: 0.3,
    },
    {
        asset: 'pine-elder', x: 11.4, z: -2.6, yaw: 2, scale: 1, tone: 0.5,
    },
    // The walls of the ride, near to far: left, then right.
    onRide('spruce-old-c', 25, -11.5, 1.1, 1.04, 0.25),
    onRide('spruce-old-b', 41, -10, 2.7, 1.02, 0.4),
    onRide('spruce-old-a', 63, -11.5, 0.4, 1.06, 0.2),
    onRide('spruce-old-b', 86, -14, 4.2, 1.1, 0.35),
    onRide('spruce-old-a', 33, 8.2, 3.3, 1.05, 0.3),
    onRide('spruce-old-b', 53, 9.6, 5.1, 1, 0.45),
    onRide('spruce-old-c', 71, 11.2, 1.9, 1.12, 0.3),
    onRide('spruce-old-a', 93, 13.5, 2.4, 1.08, 0.2),
    // Standing in the ride, between the eye and the moon: an open-crowned pine that cuts
    // the light into beams, a birch, and young spruce coming up through the ferns.
    onRide('pine-old-a', 56, -9.5, 0.9, 1, 0.6),
    onRide('birch-a', 28, 8, 2.2, 1, 0.5),
    onRide('spruce-young-b', 21, -3.4, 0.3, 1, 0.5),
    onRide('spruce-young-b', 43, 1.2, 4.4, 1.15, 0.6),
    onRide('spruce-young-a', 60, 2.6, 1.7, 1, 0.4),
    onRide('spruce-young-a', 79, -2.4, 3.9, 1.1, 0.5),
    // The old wood on the right, behind and beside the board.
    {
        asset: 'spruce-old-b', x: 17.2, z: -24, yaw: 0.8, scale: 1.04, tone: 0.3,
    },
    {
        asset: 'birch-b', x: 20.5, z: -6.5, yaw: 1.4, scale: 1, tone: 0.55,
    },
    {
        asset: 'spruce-old-a', x: 24.5, z: -14.5, yaw: 5.2, scale: 1.08, tone: 0.2,
    },
    {
        asset: 'spruce-old-c', x: 8.5, z: -33, yaw: 2.9, scale: 1.1, tone: 0.42,
    },
    {
        asset: 'birch-a', x: 14.2, z: -31.5, yaw: 4, scale: 1.06, tone: 0.45,
    },
    {
        asset: 'spruce-young-a', x: 16.4, z: -8.6, yaw: 0.2, scale: 0.9, tone: 0.55,
    },
]);

const OLD = ['spruce-old-a', 'spruce-old-b', 'spruce-old-c', 'spruce-old-a', 'spruce-old-b', 'pine-old-a'];
const YOUNG = ['spruce-young-a', 'spruce-young-b'];
const BIRCH = ['birch-a', 'birch-b'];
// A sampling box (x0, x1, z0, z1), spacing, the band's share, how many of its trees are
// birches or youngsters, and whether its crowns are far enough to thin.
const GROVE_BANDS = [
    {
        box: [8, 44, -60, 6], spacing: 7.4, share: 0.26, birch: 0.16, young: 0.14, far: false,
    },
    {
        box: [-52, -8, -50, 14], spacing: 7.6, share: 0.2, birch: 0.1, young: 0.12, far: false,
    },
    {
        box: [-10, 60, -130, -56], spacing: 8, share: 0.24, birch: 0.08, young: 0.08, far: true,
    },
    {
        box: [-110, -40, -140, -30], spacing: 8.4, share: 0.2, birch: 0.06, young: 0.06, far: true,
    },
    {
        box: [44, 100, -90, 0], spacing: 9, share: 0.1, birch: 0.1, young: 0.05, far: true,
    },
];
export const FOREST_GROVE_CEILING = 60;

/** May a tall tree stand here? Not on the ride's floor, not on the valley's side. */
function wooded(x, z) {
    // (The plateau begins well outside the ride's floor, so this keeps the ride clear too.)
    // Keep the stretch of floor in front of the eye open.
    if (Math.hypot(x - FOREST_EYE.x, z - (FOREST_EYE.z - 7)) < 9.5) return false;
    return forestPlateau(x, z) > 0.55;
}

/** The whole procedural forest in priority order; tiers take a prefix. */
export function layoutForestGrove(rng, count = FOREST_GROVE_CEILING) {
    const placed = FOREST_FEATURE_TREES.map((tree) => ({ ...tree }));
    const grove = [];
    const order = [];
    // Interleave bands so every prefix of the list covers every side of the glade.
    const quota = GROVE_BANDS.map((band) => Math.round(band.share * FOREST_GROVE_CEILING));
    for (let round = 0; order.length < FOREST_GROVE_CEILING && round < FOREST_GROVE_CEILING; round += 1) {
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
            if (wooded(x, z) && !tooClose) {
                const kind = rng();
                let list = OLD;
                if (kind < band.birch) list = BIRCH;
                else if (kind < band.birch + band.young) list = YOUNG;
                const tree = {
                    asset: list[Math.floor(rng() * list.length) % list.length],
                    x,
                    z,
                    yaw: rng() * Math.PI * 2,
                    scale: 0.92 + rng() * 0.3,
                    tone: THREE.MathUtils.clamp(
                        0.42 + Math.sin(x * 0.05 + z * 0.04) * 0.28 + (rng() - 0.5) * 0.4,
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

/** Is this bearing (degrees from the eye) within `margin` of the moon's? */
export function forestTowardMoon(x, z, margin, azimuth) {
    return Math.abs(forestBearing(x, z) - azimuth) < margin;
}

/**
 * A conservative test for "could this sphere ever be on screen". It is the union of the
 * landscape and portrait framings at their widest aspect, padded for pointer parallax, and
 * lets the forest skip sprays no pixel will ever need.
 */
export function createForestVisibilityTest() {
    const views = [
        // Out to a 32:9 screen in landscape, and to the widest screen the upright framing serves.
        { view: FOREST_VIEWS.landscape, aspect: 3.2 },
        { view: FOREST_VIEWS.portrait, aspect: FOREST_UPRIGHT_ASPECT },
    ].map(({ view, aspect }) => {
        const tanV = Math.tan(THREE.MathUtils.degToRad(view.fov / 2)) * 1.14;
        const eye = new THREE.Vector3(...forestEye(view));
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
