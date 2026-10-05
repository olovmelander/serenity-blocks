/**
 * Sakura Twilight — where the camera stands and where everything grows.
 *
 * The board card hides the middle of the screen, so the picture is composed for the two
 * side thirds: the mountain over a torii in the lake on the left, framed by the garlands
 * of a weeping cherry; the moon over a drum bridge on the right, behind the boughs of an
 * old spreading cherry. The procedural grove on the two wooded points is generated once
 * in priority order, so a lower quality tier keeps the same garden with fewer trees.
 */
import * as THREE from 'three/webgpu';
import { sakuraLand, sakuraTerrainHeight } from './sakura-terrain.js';

/** `moon` is [azimuth right of -Z, elevation] in degrees: each framing keeps it in view. */
export const SAKURA_VIEWS = Object.freeze({
    landscape: Object.freeze({
        fov: 50, position: [0, 4.3, 16], target: [0, 4.9, -40], moon: [26.5, 14],
    }),
    portrait: Object.freeze({
        fov: 68, position: [0, 4.6, 19], target: [-9, 10.5, -40], moon: [4, 27],
    }),
});

export function sakuraViewFor(aspect) {
    return aspect < 0.85 ? SAKURA_VIEWS.portrait : SAKURA_VIEWS.landscape;
}

/** Trees placed by hand. `tone` runs from near-white blossom (0) to deep rose (1). */
export const SAKURA_FEATURE_TREES = Object.freeze([
    {
        asset: 'sakura-hero-weeping', x: -12.4, z: 7.4, yaw: Math.PI, scale: 1.15, tone: 0.72,
    },
    {
        asset: 'sakura-hero-spreading', x: 14.6, z: 8.2, yaw: 0.1, scale: 1.1, tone: 0.3,
    },
    // The left point: cherries leaning out over the water toward the torii.
    {
        asset: 'sakura-grove-b', x: -24, z: -13, yaw: 0.6, scale: 1.1, tone: 0.42,
    },
    {
        asset: 'sakura-grove-weeping', x: -19.5, z: -25, yaw: 2.2, scale: 1.25, tone: 0.8,
    },
    {
        asset: 'sakura-grove-a', x: -31, z: -24, yaw: 4.1, scale: 1.18, tone: 0.5,
    },
    // The islet at the end of the bridge, and the right point behind it.
    {
        asset: 'sakura-grove-weeping', x: 15.2, z: -27.8, yaw: 0.9, scale: 1.2, tone: 0.85,
    },
    {
        asset: 'sakura-grove-a', x: 33.5, z: -17, yaw: 1.4, scale: 1.12, tone: 0.36,
    },
    {
        asset: 'sakura-grove-c', x: 31.5, z: -34, yaw: 3.0, scale: 1.2, tone: 0.55,
    },
]);

/** Lanterns in priority order: tiers light a prefix of this list in the shaders. */
export const SAKURA_STONE_LANTERNS = Object.freeze([
    {
        kind: 'stone_lantern', x: -6.4, z: 2.1, yaw: 0.5,
    },
    {
        kind: 'stone_lantern', x: 7.8, z: 2.2, yaw: 2.4,
    },
    {
        kind: 'snow_lantern', x: 13.6, z: -24.2, yaw: 0.8,
    },
    {
        kind: 'stone_lantern', x: -22.6, z: -8.8, yaw: 1.3,
    },
    {
        kind: 'stone_lantern', x: 31.5, z: -11.5, yaw: 4.2,
    },
    {
        kind: 'snow_lantern', x: -17.6, z: -18.6, yaw: 2.6,
    },
    {
        kind: 'stone_lantern', x: 31.5, z: -26.5, yaw: 0.2,
    },
    {
        kind: 'stone_lantern', x: -27, z: -33, yaw: 3.3,
    },
]);

/** Where the lit core of each lantern kind sits above its foot, and how brightly. */
export const SAKURA_LANTERN_GLOW = Object.freeze({
    stone_lantern: Object.freeze({ height: 1.43, power: 1 }),
    snow_lantern: Object.freeze({ height: 0.6, power: 0.8 }),
});

export const SAKURA_TORII = Object.freeze({
    x: -25, z: -64, yaw: 0.1, scale: 1.45,
});
export const SAKURA_BRIDGE = Object.freeze({
    x: 23.4, z: -26.2, yaw: -0.16, scale: 1,
});
export const SAKURA_PAGODA = Object.freeze({
    x: 118, z: -166, yaw: 0.5, scale: 1.75,
});
export const SAKURA_FUJI = Object.freeze({
    x: -196, y: -3, z: -548, height: 140,
});

const GROVE_ASSETS = ['sakura-grove-a', 'sakura-grove-b', 'sakura-grove-c', 'sakura-grove-a', 'sakura-grove-b',
    'sakura-grove-c', 'sakura-grove-weeping'];
// x range, z range and the minimum spacing for each band, nearest first.
const GROVE_BANDS = [
    {
        x: [-58, -22], z: [-52, -6], spacing: 9.5, share: 0.3,
    },
    {
        x: [24, 62], z: [-56, -8], spacing: 9.5, share: 0.3,
    },
    {
        x: [-46, -20], z: [-2, 14], spacing: 10, share: 0.12,
    },
    {
        x: [22, 48], z: [-2, 14], spacing: 10, share: 0.12,
    },
    {
        x: [-70, 70], z: [-66, -40], spacing: 10, share: 0.16,
    },
];
export const SAKURA_GROVE_CEILING = 22;

/** The whole procedural grove in priority order; tiers take a prefix. */
export function layoutSakuraGrove(rng, count = SAKURA_GROVE_CEILING) {
    const placed = SAKURA_FEATURE_TREES.map((tree) => ({ ...tree }));
    const grove = [];
    const bandOrder = [];
    // Interleave bands so every prefix of the list covers both points and the near bank.
    const quota = GROVE_BANDS.map((band) => Math.round(band.share * SAKURA_GROVE_CEILING));
    for (let round = 0; bandOrder.length < SAKURA_GROVE_CEILING && round < SAKURA_GROVE_CEILING; round += 1) {
        for (let band = 0; band < GROVE_BANDS.length; band += 1) {
            if (quota[band] > 0 && bandOrder.length < SAKURA_GROVE_CEILING) {
                bandOrder.push(band);
                quota[band] -= 1;
            }
        }
    }
    for (let index = 0; index < bandOrder.length; index += 1) {
        const band = GROVE_BANDS[bandOrder[index]];
        for (let attempt = 0; attempt < 60; attempt += 1) {
            const x = band.x[0] + (band.x[1] - band.x[0]) * rng();
            const z = band.z[0] + (band.z[1] - band.z[0]) * rng();
            const tooClose = placed.some((other) => Math.hypot(other.x - x, other.z - z) < band.spacing);
            // Trees stand on dry ground, a little back from the water's edge.
            if (sakuraLand(x, z) > 2.2 && !tooClose) {
                const tree = {
                    asset: GROVE_ASSETS[Math.floor(rng() * GROVE_ASSETS.length)],
                    x,
                    z,
                    yaw: rng() * Math.PI * 2,
                    scale: 0.95 + rng() * 0.35,
                    tone: THREE.MathUtils.clamp(0.5 + Math.sin(x * 0.07 + z * 0.05) * 0.3 + (rng() - 0.5) * 0.4, 0, 1),
                    far: z < -40,
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
 * and lets the grove skip sprays that only exist above or behind the camera.
 */
export function createSakuraVisibilityTest() {
    const views = [
        { view: SAKURA_VIEWS.landscape, tanV: Math.tan(THREE.MathUtils.degToRad(25)) * 1.14, aspect: 2.45 },
        { view: SAKURA_VIEWS.portrait, tanV: Math.tan(THREE.MathUtils.degToRad(34)) * 1.14, aspect: 0.85 },
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

/** The garden's lanterns as light sources ([{x, y, z, power}]), nearest the camera first. */
export function sakuraLampList(paperLanterns = []) {
    const stone = SAKURA_STONE_LANTERNS.map((lantern) => {
        const glow = SAKURA_LANTERN_GLOW[lantern.kind];
        return {
            x: lantern.x, y: sakuraTerrainHeight(lantern.x, lantern.z) + glow.height, z: lantern.z, power: glow.power,
        };
    });
    const paper = paperLanterns.map((lantern) => ({
        x: lantern.x, y: lantern.y - 0.6, z: lantern.z, power: 0.7,
    }));
    // The two lanterns by the camera first, then paper and stone alternate.
    const ordered = stone.slice(0, 2);
    for (let index = 0; index < Math.max(stone.length - 2, paper.length); index += 1) {
        if (paper[index]) ordered.push(paper[index]);
        if (stone[index + 2]) ordered.push(stone[index + 2]);
    }
    return ordered;
}

/** Every modelled tree with its foot on the ground: the hand-placed ones, then the grove. */
export function sakuraPlacements(rng, groveTrees = SAKURA_GROVE_CEILING) {
    return [...SAKURA_FEATURE_TREES, ...layoutSakuraGrove(rng, SAKURA_GROVE_CEILING).slice(0, groveTrees)]
        .map((tree) => ({ ...tree, y: sakuraTerrainHeight(tree.x, tree.z) }));
}

/**
 * Hang paper lanterns from the lower boughs. Each lantern takes a blossom site of a near
 * tree as its hook, so it always hangs from real wood; the two old trees by the camera
 * get the most. Returns [{x, y, z, phase, red}] with (x, y, z) the top of the cord.
 */
export function planPaperLanterns(placements, trees, count, rng) {
    const visible = createSakuraVisibilityTest();
    const yaw = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const point = new THREE.Vector3();
    const perTree = placements.map((tree, treeIndex) => {
        const asset = trees[tree.asset];
        if (!asset || tree.far) return [];
        const hero = asset.role === 'hero';
        const hooks = [];
        const { sites } = asset;
        yaw.setFromAxisAngle(up, tree.yaw);
        const start = Math.floor(rng() * sites.count);
        for (let step = 0; step < sites.count && hooks.length < (hero ? 12 : 3); step += 7) {
            const index = (start + step) % sites.count;
            point.fromArray(sites.position, index * 3).multiplyScalar(tree.scale).applyQuaternion(yaw);
            const lift = point.y;
            point.x += tree.x;
            point.y += tree.y;
            point.z += tree.z;
            const ground = Math.max(0, sakuraTerrainHeight(point.x, point.z));
            // Low boughs only, clear of the ground, and somewhere the camera can see.
            const low = lift > 2.9 * tree.scale && lift < (hero ? 6.4 : 4.6) * tree.scale;
            const spaced = hooks.every((hook) => Math.hypot(hook.x - point.x, hook.z - point.z) > (hero ? 2.3 : 3));
            if (low && spaced && point.y - ground > 2.7 && visible(point.x, point.y - 0.6, point.z, 0.4)) {
                hooks.push({
                    x: point.x, y: point.y - 0.05, z: point.z, phase: rng(), red: rng() < 0.22, tree: treeIndex,
                });
            }
        }
        return hooks;
    });
    // Deal them out a round at a time so any prefix of the list is spread over the garden.
    const lanterns = [];
    for (let round = 0; lanterns.length < count && round < 12; round += 1) {
        for (let tree = 0; tree < perTree.length && lanterns.length < count; tree += 1) {
            if (perTree[tree][round]) lanterns.push(perTree[tree][round]);
        }
    }
    return lanterns;
}
