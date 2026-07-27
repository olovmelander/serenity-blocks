/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Stillwater Wave 4 forest and flora builder.
 *
 * The same builder is mounted by both isolated playground pilots and is ready
 * for the eventual production runtime. Every repeated form is preallocated and
 * instanced. Quality changes only alter instance counts; pulse/update never
 * create scene resources.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    length,
    mix,
    mx_noise_float as noiseFloat,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';

import { getStillwaterQualityProfile } from '../stillwater-quality.js';
import { bankHeightAt, sampleShore } from './stillwater-water.js';

// The transform the runtime mounts this group with. Exported so the runtime and
// the shoreline conversion below cannot drift apart: forest dressing is authored
// in forest space but must land on the lake's world-space waterline.
export const FOREST_WORLD_SCALE = 0.52;
export const FOREST_WORLD_Y = 1.0;
export const FOREST_WORLD_Z = -4;

const TAU = Math.PI * 2;
const FOREST_SEED = 18641;
const REDUCED_MOTION_TIME_SCALE = 0.08;
const HERO_TREE_COUNT = 3;
const MID_TREE_COUNT = 18;
const FAR_TREE_COUNT = 22;
const NEAR_CANOPY_COUNT = 22;
const FAR_CANOPY_COUNT = 12;
const ROOT_SEGMENT_COUNT = 18;
const BOULDER_COUNT = 14;
const REED_COUNT = 72;
// Grass/fern tufts sharing the reed blade geometry and draw. The near banks
// were large unbroken slabs of mid-value green; ground cover is the cheapest
// way to give them texture without adding a draw the budget tests pin.
// Blades are grouped into clumps: scattered single blades read as debris, and
// real ground cover grows in tufts. Total blades = clumps * blades-per-clump.
const BANK_TUFT_CLUMPS = 34;
const BANK_TUFT_BLADES = 4;
const BANK_TUFT_COUNT = BANK_TUFT_CLUMPS * BANK_TUFT_BLADES;
const LILY_COUNT = 12;
const MUSHROOM_CLUSTER_COUNT = 4;
const BOARD_SAFE_HALF_WIDTH = 24;

const MID_TREE_LAYOUT = Object.freeze([
    [-58, -42, 22, -0.10, 0], [61, -39, 21, 0.08, 1],
    [-47, -67, 27, 0.08, 2], [51, -69, 26, -0.07, 0],
    [-68, -91, 31, -0.05, 1], [70, -94, 30, 0.05, 2],
    [-38, -109, 24, 0.07, 0], [40, -112, 23, -0.06, 1],
    [-82, -71, 34, 0.04, 2], [84, -73, 33, -0.04, 0],
    [-55, -126, 26, -0.05, 1], [58, -128, 25, 0.06, 2],
    [-101, -105, 29, 0.04, 0], [103, -108, 28, -0.04, 1],
    [-75, -139, 25, -0.03, 2], [78, -140, 24, 0.04, 0],
    [-116, -133, 27, 0.03, 1], [118, -136, 26, -0.03, 2],
]);

const NEAR_CANOPY_LAYOUT = Object.freeze([
    // Repoussoir arch. These two clusters sit close to the camera and high, so
    // they clip the upper corners and reach inward over the frame while leaving
    // the central sky gap — the framing device the concept art is built on and
    // the one thing the scene had no geometry for at all.
    //
    // `nearCanopies.count` slices from the front of this array, so keeping the
    // arch first guarantees it survives every quality tier (min 4 clusters).
    // Authored in forest space; the runtime mounts it at uniform 0.52 with
    // y+1 / z-4, which puts these at world (-+30, 19, 13) with a 14-unit reach.
    [-57.7, 34.6, 32.7, 26.9, 10.6, 25.0, 0.9],
    [57.7, 34.6, 28.8, 26.9, 10.6, 25.0, 2.3],
    [-89, 50, -14, 14, 8.0, 10.5, 0.2],
    [91, 49, -16, 14, 7.8, 10.4, 1.1],
    [-108, 46, -72, 12, 7.0, 9.2, 2.2],
    [-58, 20, -42, 7.0, 4.2, 5.4, 0.7],
    [61, 19, -39, 7.1, 4.2, 5.5, 1.6],
    [-47, 25, -67, 8.2, 4.7, 6.1, 2.8],
    [51, 24, -69, 8.0, 4.6, 6.0, 0.4],
    [-68, 29, -91, 9.0, 5.2, 6.8, 2.0],
    [70, 28, -94, 8.8, 5.1, 6.7, 1.2],
    [-38, 22, -109, 6.8, 4.0, 5.2, 2.6],
    [40, 21, -112, 6.7, 3.9, 5.1, 0.9],
    [-82, 31, -71, 9.6, 5.4, 7.2, 2.4],
    [84, 30, -73, 9.4, 5.3, 7.1, 1.8],
    [-55, 24, -126, 7.3, 4.2, 5.5, 0.3],
    [58, 23, -128, 7.2, 4.1, 5.4, 2.9],
    [-101, 27, -105, 8.4, 4.8, 6.3, 1.4],
    [103, 26, -108, 8.2, 4.7, 6.2, 0.6],
    [-75, 23, -139, 7.1, 4.0, 5.3, 2.2],
    [78, 22, -140, 7.0, 3.9, 5.2, 1.0],
    [-116, 25, -133, 7.8, 4.4, 5.8, 2.7],
]);
const NEAR_CANOPY_LOBES_PER_CLUSTER = 5;
// Crowns are authored much wider than tall, which reads as an umbrella plate
// once the normals are smooth. Doming the lobes gives each mass real vertical
// extent so the light-to-dark ramp has somewhere to travel.
const CANOPY_DOME = 1.42;

const NEAR_CANOPY_LOBE_LAYOUT = Object.freeze(
    NEAR_CANOPY_LAYOUT.flatMap(([x, y, z, sx, sySource, sz, phase]) => {
        const sy = sySource * CANOPY_DOME;
        return [
            Object.freeze([
                x,
                y - sy * 0.04,
                z,
                sx * 0.98,
                sy * 0.82,
                sz * 0.94,
                phase,
                0,
                -0.05,
                0.04,
            ]),
            Object.freeze([
                x - sx * 0.40,
                y - sy * 0.22,
                z + sz * 0.18,
                sx * 0.72,
                sy * 0.64,
                sz * 0.76,
                phase + 0.73,
                0,
                0.08,
                -0.12,
            ]),
            Object.freeze([
                x + sx * 0.36,
                y + sy * 0.14,
                z - sz * 0.16,
                sx * 0.76,
                sy * 0.72,
                sz * 0.78,
                phase + 1.41,
                0,
                -0.10,
                0.10,
            ]),
            // Two further clumps per crown. Three lobes still merged into a single
            // rounded mass; overlapping clumps at different heights and depths are
            // what make a canopy read as foliage rather than as one blob.
            Object.freeze([
                x + sx * 0.12,
                y + sy * 0.32,
                z + sz * 0.34,
                sx * 0.60,
                sy * 0.56,
                sz * 0.64,
                phase + 2.21,
                0,
                0.06,
                -0.08,
            ]),
            Object.freeze([
                x - sx * 0.24,
                y + sy * 0.05,
                z - sz * 0.40,
                sx * 0.65,
                sy * 0.58,
                sz * 0.60,
                phase + 3.57,
                0,
                -0.07,
                0.13,
            ]),
        ];
    }),
);

const FAR_TREE_LAYOUT = Object.freeze([
    [-118, -143, 27, 5.0], [119, -143, 26, 4.9],
    [-104, -151, 34, 6.0], [105, -151, 33, 5.9],
    [-91, -146, 23, 4.4], [92, -147, 24, 4.5],
    [-79, -155, 31, 5.5], [80, -155, 30, 5.4],
    [-67, -149, 21, 4.1], [68, -150, 22, 4.2],
    [-55, -158, 28, 5.1], [56, -158, 27, 5.0],
    [-43, -151, 20, 3.9], [44, -152, 19, 3.8],
    [-31, -159, 25, 4.7], [32, -159, 26, 4.8],
    [-126, -159, 22, 4.2], [128, -160, 23, 4.3],
    [-111, -169, 29, 5.2], [112, -169, 28, 5.1],
    [-72, -170, 25, 4.6], [74, -170, 24, 4.5],
]);

const FAR_CANOPY_LAYOUT = Object.freeze([
    [-116, 29, -150, 13, 6, 8, 0.2], [117, 29, -150, 13, 6, 8, 1.1],
    [-96, 36, -157, 12, 6, 8, 2.2], [97, 35, -157, 12, 6, 8, 0.7],
    [-77, 31, -153, 11, 5, 7, 1.6], [78, 31, -154, 11, 5, 7, 2.8],
    [-59, 35, -162, 10, 5, 7, 0.4], [60, 35, -162, 10, 5, 7, 2.0],
    [-42, 29, -156, 9, 4, 6, 1.2], [43, 29, -157, 9, 4, 6, 2.6],
    [-128, 38, -168, 12, 6, 8, 0.9], [129, 38, -168, 12, 6, 8, 2.4],
]);

const BOULDER_LAYOUT = Object.freeze([
    [-72, 1.0, 16, 4.8, 2.2, 3.7, 0.4], [71, 0.9, 14, 4.4, 2.0, 4.0, 1.2],
    [-54, 0.7, -2, 3.3, 1.5, 2.7, 2.1], [56, 0.8, -5, 3.6, 1.6, 2.9, 0.7],
    [-65, 1.2, -31, 4.0, 2.0, 3.2, 1.8], [67, 1.1, -34, 3.8, 1.8, 3.4, 2.6],
    [-49, 0.7, -59, 2.7, 1.4, 2.3, 0.2], [52, 0.8, -63, 2.9, 1.4, 2.4, 1.5],
    [-83, 1.0, -77, 3.8, 1.8, 3.0, 2.9], [85, 1.0, -80, 3.6, 1.7, 3.1, 0.8],
    [-61, 0.8, -105, 2.8, 1.3, 2.5, 1.9], [63, 0.8, -108, 3.0, 1.4, 2.6, 2.4],
    [-101, 1.1, -119, 3.5, 1.6, 2.9, 0.5], [103, 1.1, -121, 3.4, 1.6, 2.8, 1.7],
]);

// Lilies are derived from the shoreline rather than hand-listed, so they always
// float inboard of the waterline instead of being stranded when the lake shape
// changes. Each pad sits at a fraction of the channel half-width.
const LILY_LAYOUT = Object.freeze((() => {
    const rng = makeRng(FOREST_SEED + 431);
    const entries = [];
    for (let index = 0; index < LILY_COUNT; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const t = 0.30 + (index / LILY_COUNT) * 0.42 + rng() * 0.04;
        const profile = shoreProfile(t);
        const edge = side < 0 ? profile.left : profile.right;
        const center = (profile.left + profile.right) * 0.5;
        // 0.24..0.62 of the way from the shore toward the channel centre.
        const inset = 0.24 + rng() * 0.38;
        entries.push(Object.freeze([
            THREE.MathUtils.lerp(edge, center, inset),
            0.10,
            profile.z + (rng() - 0.5) * 9,
            1.1 + rng() * 1.1,
            rng() * TAU,
        ]));
    }
    return entries;
})());

const MUSHROOM_CLUSTERS = Object.freeze([
    Object.freeze({
        x: -48,
        z: 0,
        order: 0,
        entries: Object.freeze([
            [-2.2, -0.5, 1.00, -0.4, 0], [-0.6, 0.4, 0.72, 0.3, 1],
            [1.1, -0.8, 0.86, 0.8, 0], [2.5, 0.5, 0.58, -0.7, 1],
            [-1.4, 1.6, 0.48, 0.5, 0], [0.9, 1.7, 0.62, -0.2, 1],
        ]),
    }),
    Object.freeze({
        x: 49,
        z: -2,
        order: 1 / 3,
        entries: Object.freeze([
            [-2.4, 0.3, 0.82, 0.6, 1], [-0.8, -0.7, 1.04, -0.2, 0],
            [1.0, 0.6, 0.68, 0.9, 1], [2.6, -0.4, 0.76, -0.8, 0],
            [-1.5, 1.7, 0.54, 0.2, 1], [1.5, 1.8, 0.46, -0.5, 0],
        ]),
    }),
    Object.freeze({
        x: -43,
        z: -43,
        order: 2 / 3,
        entries: Object.freeze([
            [-2.0, -0.4, 0.74, 0.5, 0], [-0.5, 0.6, 0.96, -0.4, 1],
            [1.2, -0.7, 0.58, 0.8, 0], [2.3, 0.5, 0.66, -0.7, 1],
            [-1.3, 1.7, 0.46, 0.2, 1], [1.1, 1.8, 0.52, -0.1, 0],
        ]),
    }),
    Object.freeze({
        x: 44,
        z: -49,
        order: 1,
        entries: Object.freeze([
            [-2.3, 0.4, 0.64, -0.6, 1], [-0.7, -0.6, 0.88, 0.3, 0],
            [1.0, 0.7, 0.78, -0.9, 1], [2.4, -0.5, 0.54, 0.7, 0],
            [-1.5, 1.7, 0.50, -0.2, 0], [1.4, 1.8, 0.44, 0.5, 1],
        ]),
    }),
]);

function makeRng(seed) {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function normalizeMode(value) {
    return String(value || '').toLowerCase() === 'flora' ? 'flora' : 'forest';
}

/**
 * The lake's shoreline, converted from world space into forest space through
 * the same transform the runtime mounts this group with.
 */
function shoreProfile(t) {
    const shore = sampleShore(t);
    const toForest = 1 / FOREST_WORLD_SCALE;
    return {
        z: (shore.z - FOREST_WORLD_Z) * toForest,
        left: (shore.bend - shore.halfWidth) * toForest,
        right: (shore.bend + shore.halfWidth) * toForest,
    };
}

function makeTerrainGeometry() {
    const segments = 56;
    const positions = [];
    const indices = [];
    [-1, 1].forEach((side) => {
        const vertexOffset = positions.length / 3;
        for (let index = 0; index <= segments; index += 1) {
            const t = index / segments;
            const profile = shoreProfile(t);
            const innerX = side < 0 ? profile.left : profile.right;
            const outerX = side * THREE.MathUtils.lerp(126, 82, t);
            const edgeLift = 0.16 + Math.sin(index * 1.73 + side) * 0.07;
            const shoulderX = THREE.MathUtils.lerp(innerX, outerX, 0.42);
            const shoulderLift = THREE.MathUtils.lerp(2.5, 1.35, t)
                + Math.sin(index * 0.67 + side * 1.9) * 0.34;
            const outerLift = THREE.MathUtils.lerp(10.5, 4.2, t)
                + Math.sin(index * 0.81 + side) * 0.72;
            positions.push(
                innerX,
                edgeLift,
                profile.z,
                shoulderX,
                shoulderLift,
                profile.z - 0.8,
                outerX,
                outerLift,
                profile.z,
            );
            if (index < segments) {
                const base = vertexOffset + index * 3;
                if (side < 0) {
                    indices.push(
                        base,
                        base + 3,
                        base + 1,
                        base + 3,
                        base + 4,
                        base + 1,
                        base + 1,
                        base + 4,
                        base + 2,
                        base + 4,
                        base + 5,
                        base + 2,
                    );
                } else {
                    indices.push(
                        base,
                        base + 1,
                        base + 3,
                        base + 3,
                        base + 1,
                        base + 4,
                        base + 1,
                        base + 2,
                        base + 4,
                        base + 4,
                        base + 2,
                        base + 5,
                    );
                }
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeLakeGeometry() {
    const segments = 72;
    const positions = [];
    const indices = [];
    for (let index = 0; index <= segments; index += 1) {
        const t = index / segments;
        const profile = shoreProfile(t);
        positions.push(profile.left, 0, profile.z, profile.right, 0, profile.z);
        if (index < segments) {
            const base = index * 2;
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

// Distant ranges were two flat vertical cards with a hard zigzag silhouette.
// They are now real displaced massifs: a crest line with a lit front slope and
// a falling back slope, so the horizon has form, overlap, and its own value ramp.
const MOUNTAIN_RANGES = Object.freeze([
    {
        seed: 1.7, halfSpan: 210, depth: 96, z: -150, base: -6, peak: 44, rangeId: 0,
    },
    {
        seed: 4.3, halfSpan: 300, depth: 120, z: -232, base: -6, peak: 62, rangeId: 1,
    },
    {
        seed: 8.1, halfSpan: 420, depth: 150, z: -330, base: -6, peak: 86, rangeId: 2,
    },
]);

/**
 * Ridged profile in 0..1. Folding the sines with `1 - |n|` yields sharp crests
 * rather than rolling hills, which is what reads as mountain at this distance.
 */
function ridgeProfile(x, seed) {
    const a = Math.sin(x * 0.0121 + seed * 1.7);
    const b = Math.sin(x * 0.0287 + seed * 3.3);
    const c = Math.sin(x * 0.0634 + seed * 5.1);
    const d = Math.sin(x * 0.1291 + seed * 8.2);
    return (1 - Math.abs(a)) * 0.55
        + (1 - Math.abs(b)) * 0.26
        + (1 - Math.abs(c)) * 0.13
        + (1 - Math.abs(d)) * 0.06;
}

// Crest at ~35% depth, then a longer shallower fall behind it.
function ridgeShape(t) {
    if (t <= 0.35) {
        const s = t / 0.35;
        return s * s * (3 - 2 * s);
    }
    return THREE.MathUtils.lerp(1, 0.42, (t - 0.35) / 0.65);
}

function makeRidgeGeometry() {
    const columns = 108;
    const rows = 9;
    const positions = [];
    const ranges = [];
    const indices = [];

    MOUNTAIN_RANGES.forEach((range) => {
        const vertexOffset = positions.length / 3;
        for (let row = 0; row <= rows; row += 1) {
            const t = row / rows;
            for (let column = 0; column <= columns; column += 1) {
                const u = column / columns;
                const x = (u * 2 - 1) * range.halfSpan;
                // Shifting the sample per row keeps the crest from extruding
                // straight backwards, which would read as a ribbon again.
                const crest = ridgeProfile(x + row * 17.3, range.seed);
                const rock = Math.sin(x * 0.37 + row * 2.1 + range.seed) * 1.3;
                positions.push(
                    x + Math.sin(row * 1.7 + u * 9) * 2.2,
                    range.base + crest * range.peak * ridgeShape(t) + rock * t,
                    range.z - t * range.depth,
                );
                ranges.push(range.rangeId);
            }
        }
        const stride = columns + 1;
        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
                const a = vertexOffset + row * stride + column;
                const b = a + 1;
                const c = a + stride;
                const d = c + 1;
                indices.push(a, b, c, b, d, c);
            }
        }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aRange', new THREE.Float32BufferAttribute(ranges, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeOrganicCanopyGeometry(detail, seed) {
    const geometry = new THREE.IcosahedronGeometry(1, detail);
    const positions = geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
        vertex.fromBufferAttribute(positions, index);
        const d = vertex.clone().normalize();
        // Three octaves of directional variation. The previous version moved the
        // radius by only +-7.5%, which is why every crown read as a smooth
        // lollipop: a canopy needs a broken outline far more than it needs
        // polygons, because the silhouette is all the viewer resolves at range.
        const o1 = Math.sin(d.x * 3.1 + d.z * 2.3 + seed)
            * Math.cos(d.y * 2.7 - seed * 0.7);
        const o2 = Math.sin(d.y * 6.9 + d.x * 5.3 - seed * 1.9)
            * Math.cos(d.z * 6.1 + seed);
        const o3 = Math.sin(d.z * 12.7 - d.y * 9.4 + seed * 2.6);
        // Ridged term carves the deep notches that separate one clump of leaves
        // from the next, rather than merely bumping a sphere.
        const notch = 1 - Math.abs(
            Math.sin(d.x * 4.7 + d.y * 3.9 + d.z * 5.5 + seed * 1.3),
        );
        const warp = 1 + o1 * 0.20 + o2 * 0.11 + o3 * 0.055 - notch * 0.17;
        vertex.multiplyScalar(Math.max(0.44, warp));
        // Crowns spread wider than they are tall and sit flat underneath.
        vertex.x *= 1.12 + d.y * 0.06;
        vertex.z *= 1.10 - d.y * 0.04;
        vertex.y *= 0.86;
        if (vertex.y < -0.14) {
            vertex.y = -0.14 + (vertex.y + 0.14) * 0.40;
        }
        positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeFarTreeGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.075, -0.5);
    shape.lineTo(0.085, -0.5);
    shape.lineTo(0.07, -0.08);
    shape.lineTo(0.27, 0.01);
    shape.lineTo(0.18, 0.13);
    shape.lineTo(0.37, 0.22);
    shape.lineTo(0.22, 0.34);
    shape.lineTo(0.29, 0.46);
    shape.lineTo(0.02, 0.41);
    shape.lineTo(-0.13, 0.5);
    shape.lineTo(-0.18, 0.34);
    shape.lineTo(-0.36, 0.25);
    shape.lineTo(-0.20, 0.12);
    shape.lineTo(-0.29, 0.01);
    shape.lineTo(-0.07, -0.08);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeReedBladeGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.50, 0, 0,
        0.46, 0, 0,
        0.20, 0.68, 0,
        0, 1, 0,
        0, 0, -0.50,
        0, 0, 0.46,
        0, 0.68, 0.20,
        0, 1, 0,
    ], 3));
    geometry.setIndex([
        0, 1, 2,
        0, 2, 3,
        4, 5, 6,
        4, 6, 7,
    ]);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * A trunk section with an irregular cross-section. The crowns were rebuilt but
 * the trunks stayed perfect cylinders, so every tree still read as machined
 * dowel: at this range the outline is the whole cue, and a cylinder has none.
 * Lobes vary by angle and drift along the length so the silhouette wanders.
 */
function makeTrunkGeometry(radialSegments, heightSegments, seed) {
    const geometry = new THREE.CylinderGeometry(
        0.72,
        1,
        1,
        radialSegments,
        heightSegments,
    );
    const positions = geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
        vertex.fromBufferAttribute(positions, index);
        const radius = Math.hypot(vertex.x, vertex.z);
        if (radius < 1e-4) continue;
        const angle = Math.atan2(vertex.z, vertex.x);
        // Two angular lobe bands plus a slow twist down the length.
        const lobe = Math.sin(angle * 3 + vertex.y * 2.6 + seed) * 0.085
            + Math.sin(angle * 7 - vertex.y * 1.7 + seed * 2.3) * 0.042
            + Math.sin(angle * 13 + seed * 4.1) * 0.018;
        // Buttressing: the flare at the base is stronger than at the crown.
        const flare = Math.max(0, 0.5 - vertex.y) * 0.34;
        const scale = 1 + lobe + flare * (0.6 + 0.4 * Math.sin(angle * 5 + seed));
        vertex.x *= scale;
        vertex.z *= scale;
        // A gentle lean so stacked segments never line up perfectly straight.
        vertex.x += Math.sin(vertex.y * 1.9 + seed) * 0.035;
        positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeLilyPadGeometry() {
    const segments = 26;
    const rings = 3;
    const notch = 0.24;
    // A real pad dishes: the centre sits low where the stem pulls it down and
    // the rim curls up clear of the water. The old single-triangle-fan version
    // was dead flat, which is why it read as a pasted green oval.
    const positions = [0, -0.045, -0.10];
    const indices = [];
    for (let ring = 1; ring <= rings; ring += 1) {
        const t = ring / rings;
        for (let index = 0; index <= segments; index += 1) {
            const angle = THREE.MathUtils.lerp(notch, TAU - notch, index / segments);
            const wobble = 1 + Math.sin(angle * 5 + 0.7) * 0.045
                + Math.sin(angle * 9 - 1.3) * 0.022;
            const radius = t * wobble;
            // Dish profile: low centre, rim lifted, with a slight ripple.
            const lift = -0.045 + t * t * 0.16 + Math.sin(angle * 3.0) * 0.02 * t;
            positions.push(
                Math.cos(angle) * radius,
                lift,
                Math.sin(angle) * radius,
            );
        }
    }
    const stride = segments + 1;
    for (let index = 0; index < segments; index += 1) {
        indices.push(0, 1 + index, 1 + index + 1);
    }
    for (let ring = 1; ring < rings; ring += 1) {
        const inner = 1 + (ring - 1) * stride;
        const outer = inner + stride;
        for (let index = 0; index < segments; index += 1) {
            indices.push(
                inner + index,
                outer + index,
                inner + index + 1,
                inner + index + 1,
                outer + index,
                outer + index + 1,
            );
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeMushroomCapGeometry() {
    const geometry = new THREE.SphereGeometry(
        1,
        14,
        8,
        0,
        TAU,
        0,
        Math.PI * 0.54,
    );
    const positions = geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
        vertex.fromBufferAttribute(positions, index);
        const height = THREE.MathUtils.clamp((vertex.y + 0.12) / 1.12, 0, 1);
        const edgeFlare = THREE.MathUtils.lerp(1.12, 0.92, height);
        const scallop = 1 + Math.sin(Math.atan2(vertex.z, vertex.x) * 7) * 0.028
            * (1 - height);
        vertex.x *= edgeFlare * scallop;
        vertex.z *= edgeFlare * scallop;
        vertex.y = -0.06 + (height ** 1.32) * 1.06;
        positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

// Painterly aerial perspective, applied to every forest surface so near, mid,
// and far separate on value alone rather than relying on particles or fog cards.
// Near foliage collapses toward silhouette, which is what makes the overhead
// canopy read as a framing device; far foliage dissolves into the mist band.
const AERIAL_MIST = vec3(0.075, 0.128, 0.132);

function withAerialPerspective(colorNode) {
    const viewDistance = length(positionWorld.sub(cameraPosition));
    const nearShade = smoothstep(22, 85, viewDistance);
    const farHaze = smoothstep(95, 235, viewDistance);
    return mix(colorNode.mul(0.22), colorNode, nearShade)
        .mul(mix(float(1), float(0.55), farHaze))
        .add(AERIAL_MIST.mul(farHaze.mul(0.85)));
}

function pushSegment(target, start, end, radius, phase, sway) {
    target.push({
        start,
        end,
        radius,
        phase,
        sway,
    });
}

function appendTreeSegments(target, {
    x, z, height, lean, variant, hero,
}) {
    const phase = (x * 0.071 + z * 0.029 + variant * 1.71) % TAU;
    const base = [x, 0, z];
    const bendX = lean * height;
    const mid = [x + bendX * 0.34, height * 0.54, z - Math.abs(lean) * 4];
    const top = [x + bendX, height, z - Math.abs(lean) * 8];
    pushSegment(target, base, mid, hero ? 3.0 : 1.75, phase, 0);
    pushSegment(target, mid, top, hero ? 2.15 : 1.22, phase + 0.4, hero ? 0.09 : 0.06);

    const forkY = height * (variant === 1 ? 0.68 : 0.73);
    const forkBase = [
        x + bendX * 0.52,
        forkY,
        z - Math.abs(lean) * 5,
    ];
    const side = hero ? 1 : 0.72;
    pushSegment(
        target,
        forkBase,
        [top[0] - height * 0.24 * side, height * 0.91, top[2] - height * 0.10],
        hero ? 1.45 : 0.78,
        phase + 1.3,
        hero ? 0.13 : 0.09,
    );
    pushSegment(
        target,
        forkBase,
        [top[0] + height * 0.22 * side, height * 0.87, top[2] - height * 0.07],
        hero ? 1.35 : 0.72,
        phase + 2.6,
        hero ? 0.12 : 0.085,
    );

    const lowerForkSide = variant === 1 ? 1 : -1;
    const lowerForkBase = [
        x + bendX * 0.26,
        height * (hero ? 0.49 : 0.45),
        z - Math.abs(lean) * 2.4,
    ];
    pushSegment(
        target,
        lowerForkBase,
        [
            lowerForkBase[0] + height * (hero ? 0.22 : 0.17) * lowerForkSide,
            height * (hero ? 0.69 : 0.64),
            lowerForkBase[2] + height * (variant === 0 ? 0.08 : -0.055),
        ],
        hero ? 1.16 : 0.61,
        phase + 4.2,
        hero ? 0.095 : 0.065,
    );

    if (variant === 2 && !hero) {
        pushSegment(
            target,
            [x + bendX * 0.19, height * 0.37, z],
            [x - height * 0.16, height * 0.62, z - height * 0.05],
            0.66,
            phase + 3.1,
            0.07,
        );
    }

    if (hero) {
        pushSegment(target, base, [x - 12, 0.55, z + 8], 1.18, phase, 0);
        pushSegment(target, base, [x + 13, 0.42, z + 9], 1.10, phase, 0);
        pushSegment(
            target,
            base,
            [x + Math.sign(x) * 10, 0.34, z - 8],
            0.98,
            phase,
            0,
        );
    }
}

function buildHeroSegments() {
    const segments = [];
    const ends = [0];
    [
        {
            x: -89, z: -14, height: 58, lean: 0.18, variant: 0, hero: true,
        },
        {
            x: 91, z: -16, height: 57, lean: -0.18, variant: 1, hero: true,
        },
        {
            x: -108, z: -72, height: 49, lean: 0.11, variant: 2, hero: true,
        },
    ].forEach((spec) => {
        appendTreeSegments(segments, spec);
        ends.push(segments.length);
    });
    return { segments, ends };
}

function buildMidSegments() {
    const segments = [];
    const ends = [0];
    MID_TREE_LAYOUT.forEach(([x, z, height, lean, variant]) => {
        appendTreeSegments(segments, {
            x, z, height, lean, variant, hero: false,
        });
        ends.push(segments.length);
    });
    return { segments, ends };
}

function createSegmentMesh(THREE_NS, geometry, material, segments) {
    const phase = new Float32Array(segments.length);
    const sway = new Float32Array(segments.length);
    geometry.setAttribute('aPhase', new THREE_NS.InstancedBufferAttribute(phase, 1));
    geometry.setAttribute('aSway', new THREE_NS.InstancedBufferAttribute(sway, 1));

    const mesh = new THREE_NS.InstancedMesh(geometry, material, segments.length);
    const matrix = new THREE_NS.Matrix4();
    const position = new THREE_NS.Vector3();
    const quaternion = new THREE_NS.Quaternion();
    const scale = new THREE_NS.Vector3();
    const direction = new THREE_NS.Vector3();
    const start = new THREE_NS.Vector3();
    const end = new THREE_NS.Vector3();
    const up = new THREE_NS.Vector3(0, 1, 0);
    segments.forEach((segment, index) => {
        start.fromArray(segment.start);
        end.fromArray(segment.end);
        direction.subVectors(end, start);
        position.addVectors(start, end).multiplyScalar(0.5);
        quaternion.setFromUnitVectors(up, direction.clone().normalize());
        scale.set(segment.radius, direction.length(), segment.radius);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        phase[index] = segment.phase;
        sway[index] = segment.sway;
    });
    mesh.instanceMatrix.setUsage(THREE_NS.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
}

function createPlacedInstancedMesh(THREE_NS, geometry, material, entries) {
    const mesh = new THREE_NS.InstancedMesh(geometry, material, entries.length);
    const matrix = new THREE_NS.Matrix4();
    const position = new THREE_NS.Vector3();
    const quaternion = new THREE_NS.Quaternion();
    const scale = new THREE_NS.Vector3();
    const euler = new THREE_NS.Euler();
    entries.forEach((entry, index) => {
        position.set(entry[0], entry[1], entry[2]);
        quaternion.setFromEuler(euler.set(
            entry[8] || 0,
            entry[6] || 0,
            entry[9] || 0,
        ));
        scale.set(entry[3], entry[4], entry[5]);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.setUsage(THREE_NS.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
}

function addInstancedAttributes(geometry, entries, keys) {
    keys.forEach(({ name, index, fallback = 0 }) => {
        geometry.setAttribute(
            name,
            new THREE.InstancedBufferAttribute(
                Float32Array.from(entries, (entry) => entry[index] ?? fallback),
                1,
            ),
        );
    });
}

function buildRootSegments() {
    const roots = [];
    const rng = makeRng(FOREST_SEED + 211);
    for (let index = 0; index < ROOT_SEGMENT_COUNT; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const lane = Math.floor(index / 2);
        const t = 0.08 + lane * 0.085;
        const profile = shoreProfile(Math.min(0.88, t));
        const edgeX = side < 0 ? profile.left : profile.right;
        const start = [
            edgeX + side * (7 + rng() * 4),
            0.62 + rng() * 0.24,
            profile.z + (rng() - 0.5) * 5,
        ];
        const end = [
            edgeX + side * (0.7 + rng() * 1.9),
            0.10,
            profile.z + (rng() - 0.5) * 7,
        ];
        pushSegment(roots, start, end, 0.38 + rng() * 0.44, rng() * TAU, 0);
    }
    return roots;
}

function buildReedEntries() {
    const entries = [];
    const rng = makeRng(FOREST_SEED + 907);
    // Bank tufts first: same blade geometry, planted inland instead of in the
    // shallows, and tinted toward moss by the aBank attribute.
    const toForest = 1 / FOREST_WORLD_SCALE;
    for (let clump = 0; clump < BANK_TUFT_CLUMPS; clump += 1) {
        const side = clump % 2 === 0 ? -1 : 1;
        const t = 0.20 + rng() * 0.66;
        const profile = shoreProfile(t);
        const edgeX = side < 0 ? profile.left : profile.right;
        // Denser close to the waterline, thinning inland.
        const inland = 1.5 + rng() * rng() * 20;
        const clumpX = edgeX + side * inland;
        const clumpZ = profile.z + (rng() - 0.5) * 11;
        const clumpScale = 0.75 + rng() * 0.5;
        for (let blade = 0; blade < BANK_TUFT_BLADES; blade += 1) {
            // Blades fan out from a shared root within a hand-sized radius.
            const spread = 0.55 + rng() * 1.15;
            const spreadAngle = rng() * TAU;
            const bladeX = clumpX + Math.cos(spreadAngle) * spread;
            const bladeZ = clumpZ + Math.sin(spreadAngle) * spread;
            // Plant on the bank the terrain actually builds, converted back into
            // forest space through the transform this group is mounted with.
            const outward = Math.abs(bladeX - edgeX) * FOREST_WORLD_SCALE;
            const worldY = bankHeightAt(t, outward);
            entries.push([
                bladeX,
                (worldY - FOREST_WORLD_Y) * toForest - 0.12,
                bladeZ,
                (0.42 + rng() * 0.34) * clumpScale,
                (0.9 + rng() * 1.5) * clumpScale,
                1,
                rng() * TAU,
                rng() * TAU,
                0.04 + rng() * 0.09,
                1,
            ]);
        }
    }
    for (let index = 0; index < REED_COUNT; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        // Kept inside the on-camera stretch of shoreline; t<0.2 sits behind the
        // camera and t>0.9 is already dissolved in mist.
        const t = 0.24 + rng() * 0.62;
        const profile = shoreProfile(t);
        const edgeX = side < 0 ? profile.left : profile.right;
        const height = 1.8 + rng() * 3.0;
        entries.push([
            // Negative side offset wades them INTO the shallows. The previous
            // sign pushed every reed bed up onto dry bank.
            edgeX - side * (0.4 + rng() * 3.0),
            0.10,
            profile.z + (rng() - 0.5) * 5,
            0.55 + rng() * 0.35,
            height,
            1,
            rng() * TAU,
            rng() * TAU,
            0.05 + rng() * 0.10,
            0,
        ]);
    }
    return entries;
}

function buildMushroomEntries() {
    const entries = [];
    const clusterEnds = [0];
    MUSHROOM_CLUSTERS.forEach((cluster, clusterIndex) => {
        cluster.entries.forEach((entry, entryIndex) => {
            entries.push([
                cluster.x + entry[0],
                0.16,
                cluster.z + entry[1],
                entry[2] * 1.72,
                entry[3],
                entry[4],
                (clusterIndex * 1.91 + entryIndex * 0.73) % TAU,
                cluster.order,
            ]);
        });
        clusterEnds.push(entries.length);
    });
    return { entries, clusterEnds };
}

function countDirectDraws(root) {
    let draws = 0;
    const visit = (object, parentVisible) => {
        const visible = parentVisible && object.visible !== false;
        if (visible && (object.isMesh || object.isInstancedMesh)) {
            if (!object.isInstancedMesh || object.count > 0) draws += 1;
        }
        object.children.forEach((child) => visit(child, visible));
    };
    visit(root, true);
    return draws;
}

function countRootObjects(root) {
    let count = 0;
    root.traverse(() => { count += 1; });
    return count;
}

function countLayerRenderables(root, layer) {
    if (!Number.isInteger(layer) || layer < 0) return 0;
    let count = 0;
    root.traverse((object) => {
        if (
            (object.isMesh || object.isInstancedMesh)
            && object.visible !== false
            && (!object.isInstancedMesh || object.count > 0)
            && object.layers.isEnabled(layer)
        ) {
            count += 1;
        }
    });
    return count;
}

function hashLayout(values) {
    let hashValue = 2166136261;
    values.forEach((value) => {
        const scaled = Math.round(Number(value) * 1000);
        hashValue ^= scaled;
        hashValue = Math.imul(hashValue, 16777619);
    });
    return (hashValue >>> 0).toString(16).padStart(8, '0');
}

/**
 * Build the board-safe Stillwater forest.
 *
 * `mode: "forest"` omits the three mushroom draws entirely. `mode: "flora"`
 * adds the fixed cluster detail to the exact same forest runtime.
 */
export function createStillwaterForest({
    scene,
    camera = null,
    renderer = null,
    quality = 'High',
    mode = 'forest',
    reducedMotion = false,
    includeTerrain = true,
    includeShoreRoots = true,
    reflectionLayer = null,
} = {}) {
    if (!scene?.add) throw new TypeError('Stillwater forest requires a Three.js scene');

    const contentMode = normalizeMode(mode);
    const includeFlora = contentMode === 'flora';
    const root = new THREE.Group();
    root.name = includeFlora ? 'StillwaterForestFlora' : 'StillwaterForest';
    scene.add(root);

    const geometries = new Set();
    const materials = new Set();
    const instancedMeshes = [];
    const ownGeometry = (geometry) => {
        geometries.add(geometry);
        return geometry;
    };
    const ownMaterial = (material) => {
        materials.add(material);
        return material;
    };
    const add = (object) => {
        root.add(object);
        if (object.isInstancedMesh) instancedMeshes.push(object);
        return object;
    };

    const uTime = uniform(0);
    const uMotion = uniform(reducedMotion ? 0 : 1);
    const uReaction = uniform(0);
    const uRelayPhase = uniform(2);
    const uEnchantment = uniform(0);

    let terrain = null;
    let lake = null;
    if (includeTerrain) {
        const terrainMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
        const groundNoise = noiseFloat(positionWorld.mul(0.065)).mul(0.5).add(0.5);
        const depth = smoothstep(-148, 38, positionWorld.z);
        const upward = smoothstep(0.18, 0.88, normalWorld.y);
        const shoreContact = smoothstep(0.08, 2.8, positionWorld.y);
        const far = vec3(0.115, 0.230, 0.178);
        const near = mix(
            vec3(0.016, 0.043, 0.034),
            vec3(0.105, 0.235, 0.112),
            groundNoise.mul(upward),
        );
        const boardQuiet = smoothstep(10, 36, abs(positionWorld.x));
        terrainMaterial.colorNode = mix(far, near, depth)
            .mul(mix(float(0.62), float(1), shoreContact))
            .mul(mix(float(0.88), float(1), boardQuiet))
            .add(vec3(0.075, 0.12, 0.09).mul(uReaction.mul(boardQuiet).mul(0.08)));
        terrainMaterial.roughnessNode = float(0.98);
        terrainMaterial.metalnessNode = float(0);
        terrain = add(new THREE.Mesh(
            ownGeometry(makeTerrainGeometry()),
            terrainMaterial,
        ));
        terrain.name = 'stillwater-s-shore-terrain';

        const lakeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        const depthBand = smoothstep(-132, 34, positionWorld.z);
        const lateral = smoothstep(8, 58, abs(positionWorld.x));
        lakeMaterial.colorNode = mix(
            vec3(0.028, 0.115, 0.108),
            vec3(0.006, 0.032, 0.036),
            depthBand,
        ).add(vec3(0.036, 0.092, 0.075).mul(lateral.mul(0.22)));
        lake = add(new THREE.Mesh(ownGeometry(makeLakeGeometry()), lakeMaterial));
        lake.name = 'stillwater-forest-lake-silhouette';
        lake.position.y = 0.02;
    }

    const ridgeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        // Each successive range sits further into the mist, so the value ramp is
        // driven by range index rather than by raw depth.
        const rangeId = attribute('aRange', 'float');
        const haze = clamp(rangeId.div(2), 0, 1);
        // Moon sits high and to the right: slopes turned toward it catch a cold
        // rim, slopes turned away fall into the body colour. This is what gives
        // the ranges their form now that they are no longer flat cards.
        const moonward = clamp(dot(
            normalize(normalWorld),
            normalize(vec3(0.42, 0.68, 0.60)),
        ), 0, 1);
        const heightLift = smoothstep(-4, 46, positionWorld.y);
        const body = mix(
            vec3(0.022, 0.058, 0.058),
            vec3(0.075, 0.140, 0.132),
            heightLift,
        );
        const lit = body.add(vec3(0.085, 0.150, 0.170).mul(pow(moonward, 1.6).mul(0.85)));
        // Snowless cold crests: only the very top of the nearest range keeps any
        // saturation, the rest dissolves toward the sky's mist band.
        const mist = vec3(0.108, 0.163, 0.171);
        ridgeMaterial.colorNode = mix(lit, mist, haze.mul(0.62).add(heightLift.mul(0.10)));
    }
    const ridge = add(new THREE.Mesh(ownGeometry(makeRidgeGeometry()), ridgeMaterial));
    ridge.position.set(0, 0, 0);
    ridge.name = 'stillwater-sage-ridge';

    const woodMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const bark = noiseFloat(positionWorld.mul(vec3(0.14, 0.052, 0.14)))
            .mul(0.5)
            .add(0.5);
        const barkRidge = abs(sin(
            positionGeometry.x.mul(7.2)
                .add(positionGeometry.z.mul(5.4)),
        ));
        const barkDepth = bark.mul(0.68).add(barkRidge.mul(0.32));
        const key = clamp(dot(
            normalize(normalWorld),
            normalize(vec3(-0.30, 0.76, 0.48)),
        ), 0, 1);
        const phase = attribute('aPhase', 'float');
        const swayRate = attribute('aSway', 'float');
        const tipMask = smoothstep(0.30, 0.96, positionGeometry.y.add(0.5));
        const jointMoss = smoothstep(-0.46, 0.10, positionGeometry.y).oneMinus();
        const sway = sin(uTime.mul(0.31).add(phase))
            .mul(swayRate)
            .mul(uMotion)
            .mul(tipMask);
        woodMaterial.positionNode = positionLocal.add(vec3(
            sway,
            sway.mul(0.08),
            sway.mul(0.28),
        ));
        woodMaterial.colorNode = withAerialPerspective(mix(
            vec3(0.024, 0.021, 0.017),
            vec3(0.215, 0.132, 0.065),
            barkDepth.mul(0.82),
        ).add(vec3(0.090, 0.235, 0.155).mul(key.mul(0.42)))
            .add(vec3(0.045, 0.145, 0.078).mul(jointMoss.mul(0.42)))
            .add(vec3(0.075, 0.19, 0.15).mul(uReaction.mul(key).mul(0.08))));
        woodMaterial.roughnessNode = float(1);
        woodMaterial.metalnessNode = float(0);
    }

    const heroData = buildHeroSegments();
    const heroGeometry = ownGeometry(makeTrunkGeometry(11, 4, 0.61));
    const heroWood = add(createSegmentMesh(THREE, heroGeometry, woodMaterial, heroData.segments));
    heroWood.name = 'stillwater-hero-root-flare-trees';

    const midData = buildMidSegments();
    const midGeometry = ownGeometry(makeTrunkGeometry(9, 3, 2.37));
    const midWood = add(createSegmentMesh(THREE, midGeometry, woodMaterial, midData.segments));
    midWood.name = 'stillwater-instanced-mid-tree-variants';

    const canopyMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const phase = attribute('aPhase', 'float');
        const swayRate = attribute('aSway', 'float');
        const topMask = smoothstep(-0.62, 0.84, positionGeometry.y);
        const sway = sin(uTime.mul(0.22).add(phase))
            .mul(swayRate)
            .mul(uMotion)
            .mul(topMask);
        const canopyNoise = noiseFloat(positionWorld.mul(0.085)).mul(0.5).add(0.5);
        // Sphere-projected crown shading. Each canopy lobe is a displaced
        // icosahedron centred on its own origin, so normalize(positionGeometry)
        // IS the direction from the lobe centre — a free sphere normal. Blending
        // the geometric normal toward it makes the whole crown shade as ONE
        // smooth light-to-dark ramp instead of a field of facets. That facet
        // noise is precisely the mid-frequency gradient band that reads as
        // "3D blob" rather than painted mass (BotW/Europa foliage trick).
        //
        // positionGeometry, NOT positionLocal: r181's InstanceNode reassigns
        // positionLocal before positionNode runs — a trap this repo has hit
        // before. The lobes carry only translation, scale and a Y rotation, so
        // the local Y axis still maps to world up and the ramp stays correct.
        const crownUp = mix(normalWorld.y, normalize(positionGeometry).y, 0.75);
        const lift = crownUp.mul(0.5).add(0.5);
        const crownVariation = sin(phase.mul(1.71)).mul(0.5).add(0.5);
        const crownTide = smoothstep(0.40, 0.62, uEnchantment);
        canopyMaterial.positionNode = positionLocal.add(vec3(
            sway,
            sway.mul(0.10),
            sway.mul(0.22),
        ));
        // Undersides fall to near-black while crowns catch the moon. A canopy
        // lit evenly across its whole surface is the other half of why these
        // read as plastic lollipops; the internal value range does as much work
        // as the silhouette.
        const underShade = smoothstep(-0.55, 0.35, crownUp);
        canopyMaterial.colorNode = withAerialPerspective(mix(
            mix(
                vec3(0.004, 0.018, 0.015),
                vec3(0.018, 0.068, 0.044),
                crownVariation,
            ),
            vec3(0.095, 0.255, 0.135),
            canopyNoise.mul(lift).mul(0.92),
        ).mul(mix(float(0.34), float(1.10), underShade))
            .add(vec3(0.050, 0.125, 0.088).mul(lift.mul(0.44)))
            .add(vec3(0.075, 0.18, 0.13).mul(uReaction.mul(lift).mul(0.09)))
            .add(vec3(0.10, 0.28, 0.23).mul(crownTide.mul(lift).mul(0.22))));
        canopyMaterial.roughnessNode = float(0.97);
        canopyMaterial.metalnessNode = float(0);
    }
    // Detail 3 so the notch carving has enough vertices to bite. These are
    // instanced and the scene runs ~20x under its triangle budget.
    const canopyGeometry = ownGeometry(makeOrganicCanopyGeometry(3, 0.73));
    addInstancedAttributes(canopyGeometry, NEAR_CANOPY_LOBE_LAYOUT, [
        { name: 'aPhase', index: 6 },
        { name: 'aSway', index: -1, fallback: 0.24 },
    ]);
    const nearCanopies = add(createPlacedInstancedMesh(
        THREE,
        canopyGeometry,
        canopyMaterial,
        NEAR_CANOPY_LOBE_LAYOUT,
    ));
    nearCanopies.name = 'stillwater-instanced-canopy-language';

    const farTreeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const farLift = smoothstep(-0.7, 0.9, positionGeometry.y);
        farTreeMaterial.colorNode = mix(
            vec3(0.038, 0.092, 0.078),
            vec3(0.105, 0.195, 0.158),
            farLift,
        );
    }
    const farTreeGeometry = ownGeometry(makeFarTreeGeometry());
    const farTreeEntries = FAR_TREE_LAYOUT.map(([x, z, height, width], index) => [
        x,
        height * 0.5,
        z,
        width * 2.45,
        height,
        1,
        0,
        0,
        0,
        ((index % 5) - 2) * 0.025,
    ]);
    const farTrees = add(createPlacedInstancedMesh(
        THREE,
        farTreeGeometry,
        farTreeMaterial,
        farTreeEntries,
    ));
    farTrees.name = 'stillwater-batched-far-forest';

    const farCanopyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const variation = noiseFloat(positionWorld.mul(0.055)).mul(0.5).add(0.5);
        farCanopyMaterial.colorNode = mix(
            vec3(0.032, 0.085, 0.070),
            vec3(0.125, 0.225, 0.180),
            variation.mul(0.68),
        );
    }
    const farCanopyGeometry = ownGeometry(makeOrganicCanopyGeometry(1, 2.17));
    const farCanopies = add(createPlacedInstancedMesh(
        THREE,
        farCanopyGeometry,
        farCanopyMaterial,
        FAR_CANOPY_LAYOUT,
    ));
    farCanopies.name = 'stillwater-far-canopy-mass';

    let shoreRoots = null;
    if (includeShoreRoots) {
        const rootSegments = buildRootSegments();
        const rootGeometry = ownGeometry(new THREE.CylinderGeometry(0.34, 0.78, 1, 7, 2));
        shoreRoots = add(createSegmentMesh(
            THREE,
            rootGeometry,
            woodMaterial,
            rootSegments,
        ));
        shoreRoots.name = 'stillwater-instanced-shore-roots';
    }

    const boulderMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const grain = noiseFloat(positionWorld.mul(0.18)).mul(0.5).add(0.5);
        const top = smoothstep(-0.2, 0.82, normalWorld.y);
        boulderMaterial.colorNode = mix(
            vec3(0.038, 0.068, 0.060),
            vec3(0.165, 0.245, 0.190),
            grain.mul(top),
        );
        boulderMaterial.roughnessNode = float(0.98);
        boulderMaterial.metalnessNode = float(0);
    }
    const boulderGeometry = ownGeometry(new THREE.DodecahedronGeometry(1, 0));
    const boulderEntries = BOULDER_LAYOUT.map((entry, index) => [
        ...entry,
        0,
        ((index % 3) - 1) * 0.12,
        ((index % 5) - 2) * 0.08,
    ]);
    const boulders = add(createPlacedInstancedMesh(
        THREE,
        boulderGeometry,
        boulderMaterial,
        boulderEntries,
    ));
    boulders.name = 'stillwater-instanced-wet-boulders';

    const reedEntries = buildReedEntries();
    const reedGeometry = ownGeometry(makeReedBladeGeometry());
    addInstancedAttributes(reedGeometry, reedEntries, [
        { name: 'aPhase', index: 7 },
        { name: 'aSway', index: 8 },
        { name: 'aBank', index: 9, fallback: 0 },
    ]);
    const reedMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const phase = attribute('aPhase', 'float');
        const swayRate = attribute('aSway', 'float');
        const tip = smoothstep(0.10, 0.92, positionGeometry.y);
        const sway = sin(uTime.mul(0.48).add(phase))
            .mul(swayRate)
            .mul(uMotion)
            .mul(tip);
        reedMaterial.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.18)));
        // Bank tufts read as dry moss and fern; water reeds stay dark and cold.
        const bank = attribute('aBank', 'float');
        const reedColor = mix(
            vec3(0.042, 0.105, 0.055),
            vec3(0.43, 0.54, 0.23),
            tip,
        );
        const tuftColor = mix(
            vec3(0.030, 0.078, 0.044),
            vec3(0.26, 0.37, 0.17),
            tip,
        );
        reedMaterial.colorNode = mix(reedColor, tuftColor, bank);
        reedMaterial.roughnessNode = float(0.92);
        reedMaterial.side = THREE.DoubleSide;
        reedMaterial.forceSinglePass = true;
    }
    const reeds = add(createPlacedInstancedMesh(
        THREE,
        reedGeometry,
        reedMaterial,
        reedEntries,
    ));
    reeds.name = 'stillwater-instanced-reeds';

    const lilyGeometry = ownGeometry(makeLilyPadGeometry());
    addInstancedAttributes(lilyGeometry, LILY_LAYOUT, [
        { name: 'aPhase', index: 4, fallback: 0 },
    ]);
    const lilyMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const phase = attribute('aPhase', 'float');
        const radius = length(positionGeometry.xz);
        const rim = smoothstep(0.56, 1, radius);
        const bob = sin(uTime.mul(0.52).add(phase))
            .mul(0.035)
            .mul(uMotion);
        lilyMaterial.positionNode = positionLocal.add(vec3(0, bob, 0));
        // Radial veins and a damp lifted rim, so the pad has surface as well as
        // shape. Veins run from the notch outward like the real plant.
        const padAngle = positionGeometry.xz.x.atan(positionGeometry.xz.y);
        const veins = abs(sin(padAngle.mul(9))).pow(6).mul(smoothstep(0.12, 0.95, radius));
        lilyMaterial.colorNode = mix(
            vec3(0.052, 0.150, 0.074),
            vec3(0.20, 0.37, 0.145),
            rim.oneMinus(),
        )
            .add(vec3(0.10, 0.19, 0.085).mul(veins.mul(0.55)))
            .add(vec3(0.16, 0.26, 0.20).mul(rim.mul(0.30)))
            .add(vec3(0.25, 0.28, 0.17).mul(uReaction.mul(0.05)));
        lilyMaterial.roughnessNode = float(0.84);
        lilyMaterial.metalnessNode = float(0);
        lilyMaterial.side = THREE.DoubleSide;
    }
    const lilyEntries = LILY_LAYOUT.map((entry) => [
        entry[0], entry[1], entry[2], entry[3], 1, entry[3], entry[4],
    ]);
    const lilies = add(createPlacedInstancedMesh(
        THREE,
        lilyGeometry,
        lilyMaterial,
        lilyEntries,
    ));
    lilies.name = 'stillwater-instanced-lilies';

    let mushroomStems = null;
    let mushroomCaps = null;
    let mushroomPools = null;
    let mushroomData = null;
    if (includeFlora) {
        mushroomData = buildMushroomEntries();
        const stemGeometry = ownGeometry(new THREE.CylinderGeometry(0.22, 0.32, 1, 8, 1));
        const stemMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
        stemMaterial.colorNode = mix(
            vec3(0.16, 0.145, 0.105),
            vec3(0.46, 0.39, 0.25),
            smoothstep(-0.5, 0.5, positionGeometry.y),
        );
        stemMaterial.roughnessNode = float(0.94);

        const capGeometry = ownGeometry(makeMushroomCapGeometry());
        addInstancedAttributes(capGeometry, mushroomData.entries, [
            { name: 'aPhase', index: 6 },
            { name: 'aClusterOrder', index: 7 },
            { name: 'aSpecies', index: 5 },
        ]);
        const capMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
        {
            const phase = attribute('aPhase', 'float');
            const clusterOrder = attribute('aClusterOrder', 'float');
            const species = attribute('aSpecies', 'float');
            const capNoise = noiseFloat(positionWorld.mul(0.72)).mul(0.5).add(0.5);
            const spots = smoothstep(0.70, 0.91, capNoise);
            const underside = smoothstep(0.06, 0.58, positionGeometry.y).oneMinus();
            const relay = smoothstep(
                0,
                0.26,
                abs(uRelayPhase.sub(clusterOrder)),
            ).oneMinus().mul(uReaction);
            const mushroomTide = smoothstep(0.18, 0.38, uEnchantment);
            const breath = sin(uTime.mul(0.62).add(phase)).mul(0.08).add(0.92);
            const base = mix(
                vec3(0.11, 0.20, 0.105),
                vec3(0.30, 0.115, 0.245),
                species.mul(0.72),
            );
            const glow = mix(
                vec3(0.30, 0.92, 0.58),
                vec3(0.78, 0.42, 0.96),
                species,
            );
            // Authored clusters are meant to be a readable bioluminescent motif,
            // not scattered confetti. The gills carry most of the emission so the
            // cap keeps a solid silhouette against the bank.
            // Albedo stays modest: the emissive term below is what feeds the
            // selective bloom pass, so lifting both double-counts the glow and
            // clips the caps to featureless white.
            capMaterial.colorNode = base
                .add(glow.mul(capNoise.mul(0.14)))
                .add(glow.mul(underside.mul(0.10)));
            // Mushrooms are a field motif, not a focal note: 24 of them at the
            // spirit's brightness is 24 things competing with her. Measured as
            // the main contributor to bright-pixel spread.
            capMaterial.emissiveNode = glow.mul(
                float(0.048)
                    .add(underside.mul(0.10))
                    .add(spots.mul(0.08))
                    .add(mushroomTide.mul(0.26))
                    .add(relay.mul(0.46)),
            ).mul(breath);
            capMaterial.roughnessNode = float(0.62);
            capMaterial.metalnessNode = float(0);
            capMaterial.side = THREE.DoubleSide;
        }

        const stemEntries = mushroomData.entries.map((entry) => {
            const height = 1.42 * entry[3];
            const tilt = entry[4] * 0.17;
            const tiltX = Math.sin(entry[6]) * tilt;
            const tiltZ = Math.cos(entry[6]) * tilt;
            const direction = new THREE.Vector3(0, 1, 0).applyEuler(
                new THREE.Euler(tiltX, entry[4], tiltZ),
            );
            return [
                entry[0] + direction.x * height * 0.5,
                entry[1] + direction.y * height * 0.5,
                entry[2] + direction.z * height * 0.5,
                entry[3] * 0.34,
                height,
                entry[3] * 0.34,
                entry[4],
                0,
                tiltX,
                tiltZ,
            ];
        });
        const capEntries = mushroomData.entries.map((entry) => {
            const height = 1.42 * entry[3];
            const tilt = entry[4] * 0.17;
            const tiltX = Math.sin(entry[6]) * tilt;
            const tiltZ = Math.cos(entry[6]) * tilt;
            const direction = new THREE.Vector3(0, 1, 0).applyEuler(
                new THREE.Euler(tiltX, entry[4], tiltZ),
            );
            const speciesScale = entry[5] > 0 ? 1.16 : 1;
            return [
                entry[0] + direction.x * height,
                entry[1] + direction.y * height,
                entry[2] + direction.z * height,
                entry[3] * speciesScale,
                entry[3] * (entry[5] > 0 ? 0.48 : 0.62),
                entry[3],
                entry[4],
                0,
                tiltX,
                tiltZ,
            ];
        });
        mushroomStems = add(createPlacedInstancedMesh(
            THREE,
            stemGeometry,
            stemMaterial,
            stemEntries,
        ));
        mushroomStems.name = 'stillwater-instanced-mushroom-stems';
        mushroomCaps = add(createPlacedInstancedMesh(
            THREE,
            capGeometry,
            capMaterial,
            capEntries,
        ));
        mushroomCaps.name = 'stillwater-instanced-emissive-mushroom-caps';

        const poolEntries = MUSHROOM_CLUSTERS.map((cluster, index) => [
            cluster.x,
            0.08,
            cluster.z,
            7.2,
            7.2,
            1,
            0,
            cluster.order,
            -Math.PI / 2,
            index * 0.03,
        ]);
        const poolGeometry = ownGeometry(new THREE.PlaneGeometry(1, 1));
        addInstancedAttributes(poolGeometry, poolEntries, [
            { name: 'aClusterOrder', index: 7 },
        ]);
        const poolMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        {
            const clusterOrder = attribute('aClusterOrder', 'float');
            const radial = pow(
                smoothstep(0.06, 0.70, length(uv().sub(vec2(0.5)))).oneMinus(),
                float(2.1),
            );
            const relay = smoothstep(
                0,
                0.27,
                abs(uRelayPhase.sub(clusterOrder)),
            ).oneMinus().mul(uReaction);
            const mushroomTide = smoothstep(0.18, 0.38, uEnchantment);
            poolMaterial.colorNode = mix(
                vec3(0.12, 0.48, 0.31),
                vec3(0.42, 0.28, 0.62),
                clusterOrder,
            );
            poolMaterial.opacityNode = radial
                .mul(
                    float(0.075)
                        .add(mushroomTide.mul(0.14))
                        .add(relay.mul(0.22)),
                )
                .clamp(0, 0.32);
            poolMaterial.transparent = true;
            poolMaterial.depthWrite = false;
            poolMaterial.blending = THREE.AdditiveBlending;
            poolMaterial.toneMapped = false;
            poolMaterial.side = THREE.DoubleSide;
            poolMaterial.forceSinglePass = true;
        }
        mushroomPools = add(createPlacedInstancedMesh(
            THREE,
            poolGeometry,
            poolMaterial,
            poolEntries,
        ));
        mushroomPools.name = 'stillwater-instanced-fake-mushroom-light-pools';
    }

    const hemisphere = add(new THREE.HemisphereLight(0xb7e2dc, 0x0b1c16, 2.05));
    hemisphere.name = 'stillwater-forest-hemisphere';
    const moonKey = add(new THREE.DirectionalLight(0xc8eee6, 2.85));
    moonKey.position.set(-42, 70, 24);
    moonKey.name = 'stillwater-forest-moon-key';

    if (Number.isInteger(reflectionLayer) && reflectionLayer >= 0) {
        [
            heroWood,
            midWood,
            nearCanopies,
            farTrees,
            farCanopies,
        ].filter(Boolean).forEach((object) => {
            object.traverse((child) => child.layers.enable(reflectionLayer));
        });
    }

    let currentProfile = getStillwaterQualityProfile(quality);
    let currentHeroTrees = 0;
    let currentMidTrees = 0;
    let currentFarTrees = 0;
    let currentNearCanopies = 0;
    let currentFarCanopies = 0;
    let currentMushroomClusters = 0;
    let motionReduced = reducedMotion === true;
    let motionTime = 0;
    let motionInitialized = false;
    let reactionEnergy = 0;
    let relayPhase = 2;
    let disposed = false;

    function applyQualityProfile(profile) {
        currentProfile = profile;
        const leanTier = profile.name === 'Minimal' || profile.name === 'Low';
        const mediumBudgetTier = profile.name === 'Medium';
        currentHeroTrees = profile.forestTrees >= 24 ? HERO_TREE_COUNT : 2;
        const remainingTrees = Math.max(0, profile.forestTrees - currentHeroTrees);
        currentMidTrees = Math.min(
            MID_TREE_COUNT,
            Math.max(4, Math.round(remainingTrees * 0.48)),
        );
        currentFarTrees = Math.min(
            FAR_TREE_COUNT,
            Math.max(0, remainingTrees - currentMidTrees),
        );

        currentNearCanopies = Math.min(
            NEAR_CANOPY_COUNT,
            Math.max(4, Math.round(profile.canopyClusters * 0.68)),
        );
        currentFarCanopies = Math.min(
            FAR_CANOPY_COUNT,
            Math.max(0, profile.canopyClusters - currentNearCanopies),
        );

        heroWood.count = heroData.ends[currentHeroTrees];
        midWood.count = midData.ends[currentMidTrees];
        nearCanopies.count = currentNearCanopies * NEAR_CANOPY_LOBES_PER_CLUSTER;
        farTrees.count = currentFarTrees;
        farCanopies.count = currentFarCanopies;
        farTrees.visible = !leanTier && !mediumBudgetTier;
        farCanopies.visible = !leanTier && !mediumBudgetTier;

        const detailScale = THREE.MathUtils.clamp(
            profile.forestTrees / 30,
            0.42,
            1,
        );
        const rootScale = THREE.MathUtils.clamp(
            profile.forestTrees / 42,
            0.33,
            1,
        );
        if (shoreRoots) {
            shoreRoots.count = Math.max(
                6,
                Math.round(ROOT_SEGMENT_COUNT * rootScale),
            );
        }
        boulders.count = Math.max(6, Math.round(BOULDER_COUNT * detailScale));
        // Bank tufts occupy the front of the instance buffer, so the tier scale
        // has to cover both populations or the ground cover never draws.
        reeds.count = Math.max(
            24,
            Math.round((REED_COUNT + BANK_TUFT_COUNT) * detailScale),
        );
        lilies.count = Math.max(5, Math.round(LILY_COUNT * detailScale));
        boulders.visible = !leanTier && !mediumBudgetTier;
        reeds.visible = !leanTier && !mediumBudgetTier;
        lilies.visible = !leanTier;

        if (includeFlora) {
            currentMushroomClusters = Math.min(
                MUSHROOM_CLUSTER_COUNT,
                Math.max(0, profile.mushroomClusters),
            );
            const mushroomCount = mushroomData.clusterEnds[currentMushroomClusters];
            mushroomStems.count = mushroomCount;
            mushroomCaps.count = mushroomCount;
            mushroomPools.count = currentMushroomClusters;
            mushroomStems.visible = !leanTier;
            mushroomCaps.visible = true;
            mushroomPools.visible = !leanTier;
        }
    }
    applyQualityProfile(currentProfile);

    const focalXValues = [
        -89, 91, -108,
        ...MUSHROOM_CLUSTERS.map((cluster) => cluster.x),
    ];
    const focalIntrusions = focalXValues.filter(
        (x) => Math.abs(x) < BOARD_SAFE_HALF_WIDTH,
    ).length;
    const layoutSignature = hashLayout([
        ...MID_TREE_LAYOUT.flat(),
        ...NEAR_CANOPY_LOBE_LAYOUT.flat(),
        ...FAR_TREE_LAYOUT.flat(),
        ...BOULDER_LAYOUT.flat(),
        ...LILY_LAYOUT.flat(),
        ...MUSHROOM_CLUSTERS.flatMap((cluster) => [
            cluster.x,
            cluster.z,
            cluster.order,
            ...cluster.entries.flat(),
        ]),
    ]);
    const geometryUuids = Object.freeze([...geometries].map((geometry) => geometry.uuid));
    const materialUuids = Object.freeze([...materials].map((material) => material.uuid));
    const instanceMatrixArrays = Object.freeze(
        Object.fromEntries(instancedMeshes.map((mesh) => [
            mesh.name || mesh.uuid,
            mesh.instanceMatrix.array,
        ])),
    );

    function setQuality(value) {
        if (disposed) return false;
        const next = getStillwaterQualityProfile(value, currentProfile.name);
        if (next === currentProfile) return false;
        applyQualityProfile(next);
        return true;
    }

    function setReducedMotion(enabled) {
        motionReduced = enabled === true;
        uMotion.value = motionReduced ? 0 : 1;
    }

    function setEnchantmentTide(value) {
        if (disposed) return false;
        uEnchantment.value = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
        return true;
    }

    function pulse(kind, payload = {}) {
        if (disposed) return false;
        let strength = 0.16;
        if (kind === 'COMBO' || kind === 'combo') {
            strength = Math.min(1, 0.24 + Math.max(0, Number(payload.comboCount) || 0) * 0.075);
        } else if (kind === 'LINE_CLEAR' || kind === 'lineClear') {
            strength = Math.min(0.82, 0.24 + Math.max(1, Number(payload.lineCount) || 1) * 0.13);
        } else if (
            kind === 'TSPIN'
            || kind === 'tspin'
            || kind === 'PERFECT_CLEAR'
            || kind === 'perfectClear'
        ) {
            strength = 1;
        }
        reactionEnergy = Math.max(reactionEnergy, strength);
        relayPhase = 0;
        return true;
    }

    function update(time, delta = 1 / 60) {
        if (disposed) return;
        const safeTime = Number.isFinite(time) ? time : 0;
        const safeDelta = Number.isFinite(delta)
            ? THREE.MathUtils.clamp(delta, 0, 0.1)
            : 1 / 60;
        if (!motionInitialized) {
            motionTime = motionReduced ? 0 : safeTime;
            motionInitialized = true;
        } else if (!motionReduced && safeDelta === 0) {
            motionTime = safeTime;
        } else {
            motionTime += safeDelta * (
                motionReduced ? REDUCED_MOTION_TIME_SCALE : 1
            );
        }
        uTime.value = motionTime;
        if (reactionEnergy > 0) {
            relayPhase = Math.min(1.35, relayPhase + safeDelta * 0.62);
            reactionEnergy = Math.max(0, reactionEnergy - safeDelta * 0.52);
        } else {
            relayPhase = 2;
        }
        uReaction.value = reactionEnergy;
        uRelayPhase.value = relayPhase;
    }

    function getDiagnostics() {
        const directDraws = countDirectDraws(root);
        const leanTier = currentProfile.name === 'Minimal'
            || currentProfile.name === 'Low';
        const mediumBudgetTier = currentProfile.name === 'Medium';
        const terrainDraws = includeTerrain ? 3 : 1;
        const treeDraws = leanTier || mediumBudgetTier ? 3 : 5;
        let dressingDraws = includeShoreRoots ? 4 : 3;
        let floraDraws = includeFlora ? 3 : 0;
        if (leanTier) {
            dressingDraws = includeShoreRoots ? 1 : 0;
            floraDraws = includeFlora ? 1 : 0;
        } else if (mediumBudgetTier) {
            dressingDraws = includeShoreRoots ? 2 : 1;
        }
        return {
            wave: 4,
            mode: contentMode,
            includeTerrain,
            includeShoreRoots,
            reflectionLayer: Number.isInteger(reflectionLayer) ? reflectionLayer : null,
            reflectionRenderables: countLayerRenderables(root, reflectionLayer),
            quality: currentProfile.name,
            reducedMotion: motionReduced,
            motionScale: motionReduced ? REDUCED_MOTION_TIME_SCALE : 1,
            enchantmentTide: uEnchantment.value,
            boardSafe: focalIntrusions === 0,
            boardSafeHalfWidth: BOARD_SAFE_HALF_WIDTH,
            focalIntrusions,
            layoutSignature,
            counts: {
                heroTrees: currentHeroTrees,
                midTrees: currentMidTrees,
                farTrees: farTrees.visible ? currentFarTrees : 0,
                forestTrees: currentHeroTrees
                    + currentMidTrees
                    + (farTrees.visible ? currentFarTrees : 0),
                nearCanopies: currentNearCanopies,
                farCanopies: currentFarCanopies,
                canopyClusters: currentNearCanopies + currentFarCanopies,
                roots: shoreRoots?.count || 0,
                boulders: boulders.visible ? boulders.count : 0,
                reeds: reeds.visible ? reeds.count : 0,
                lilies: lilies.visible ? lilies.count : 0,
                mushroomClusters: currentMushroomClusters,
                mushrooms: mushroomCaps?.count || 0,
            },
            draws: {
                direct: directDraws,
                estimated: terrainDraws + treeDraws + dressingDraws + floraDraws,
                terrain: terrainDraws,
                trees: treeDraws,
                dressing: dressingDraws,
                flora: floraDraws,
                treeTarget: [4, 7],
                floraMaximum: 4,
                lowForestFloraMaximum: 15,
            },
            lights: 2,
            realMushroomLights: 0,
            particles: 0,
            postProcessing: false,
            characters: false,
            rendererDrawCalls: Number.isFinite(
                renderer?.info?.render?.drawCalls ?? renderer?.info?.render?.calls,
            )
                ? (renderer.info.render.drawCalls ?? renderer.info.render.calls)
                : null,
            cameraAttached: Boolean(camera),
        };
    }

    function getResourceState() {
        return {
            disposed,
            rootObjects: countRootObjects(root),
            ownedGeometries: geometries.size,
            ownedMaterials: materials.size,
            renderables: countDirectDraws(root),
            geometryUuids,
            materialUuids,
            instanceMatrixArrays,
            reactionEnergy,
            relayPhase,
            enchantmentTide: uEnchantment.value,
        };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        scene.remove(root);
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        root.clear();
    }

    return {
        root,
        update,
        pulse,
        setQuality,
        setReducedMotion,
        setEnchantmentTide,
        getDiagnostics,
        getResourceState,
        dispose,
    };
}

export default createStillwaterForest;
