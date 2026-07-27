/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Moonwake Sanctuary landscape dressing.
 *
 * Re-authors the strongest ideas from the original large composition study at
 * the canonical black-jade pond scale. All repeated forms are instanced, all
 * animation is driven by shared uniforms, and quality changes only adjust
 * existing draw ranges/counts.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    hash,
    instanceIndex,
    length,
    max,
    mix,
    mx_noise_float as noiseFloat,
    normalize,
    normalWorld,
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

import {
    KOI_POND_LAYOUT,
    normalizeKoiPondQuality,
    sampleKoiPondGroundHeight,
} from './koi-pond-layout.js';
import {
    createKoiPondForest,
    KOI_POND_GROVE_LIMITS,
    KOI_POND_HERO_LIMITS,
} from './koi-pond-forest.js';

const TAU = Math.PI * 2;
const REFLECTION_LAYER = 2;
const REDUCED_MOTION_TIME_SCALE = 0.08;
const MAX_TREES = 26;
const MAX_MUSHROOMS = 22;
const MAX_MOTES = 80;
const MAX_PETALS = 20;
const MAX_GRASS = 260;
const CROWNS_PER_TREE = 3;
const BRANCHES_PER_TREE = 2;
const WILLOW_TENDRIL_COUNT = 0;

const QUALITY_LIMITS = Object.freeze({
    Minimal: Object.freeze({
        trees: 7, mushrooms: 4, motes: 10, petals: 0, grass: 30, spirit: false,
    }),
    Low: Object.freeze({
        trees: 10, mushrooms: 6, motes: 18, petals: 4, grass: 60, spirit: true,
    }),
    Medium: Object.freeze({
        trees: 14, mushrooms: 10, motes: 30, petals: 8, grass: 110, spirit: true,
    }),
    High: Object.freeze({
        trees: 18, mushrooms: 14, motes: 46, petals: 12, grass: 180, spirit: true,
    }),
    Ultra: Object.freeze({
        trees: 22, mushrooms: 18, motes: 64, petals: 16, grass: 230, spirit: true,
    }),
    Extreme: Object.freeze({
        trees: 26, mushrooms: 22, motes: 80, petals: 20, grass: 260, spirit: true,
    }),
});

// Prefix order is compositional priority, not spatial order. Every quality
// tier therefore keeps a balanced left/right/near/far frame instead of
// progressively filling the forest from one side.
const TREE_LAYOUT = Object.freeze([
    // Two former left-edge trees relocated deep into the back treeline so they
    // read as small distant forest instead of big blobs cropped by the frame.
    [-22, -55, 0.66, -0.05], [30, -16, 1.20, 0.08],
    [-38, -50, 0.60, -0.05], [24, -25, 1.14, 0.07],
    [-7, -32, 0.96, -0.06], [10, -33, 1.00, 0.05],
    [26, -56, 0.68, 0.05], [35, -24, 1.05, 0.10],
    [-30, -47, 0.62, -0.04], [19, -37, 0.88, 0.06],
    [34, -52, 0.62, 0.04], [27, -21, 0.85, -0.07],
    [-2, -28, 0.78, 0.03], [5, -39, 0.86, -0.04],
    [4, -56, 0.58, -0.05], [32, -33, 0.98, 0.07],
    [-11, -42, 0.72, -0.03], [16, -43, 0.76, 0.04],
    [-34, -55, 0.60, -0.05], [40, -39, 1.10, 0.09],
    [8, -58, 0.54, 0.05], [27, -46, 0.80, -0.05],
    [-5, -46, 0.68, 0.03], [7, -48, 0.70, -0.03],
    [34, -52, 0.64, -0.05], [44, -30, 0.98, 0.08],
]);

const MUSHROOM_LAYOUT = Object.freeze([
    [15.6, -15.5, 0.92, 0.1], [-16.5, -15.8, 0.78, -0.4],
    [17.2, -13.8, 0.48, -0.4], [-18.0, -13.9, 0.42, 0.2],
    [18.0, -17.1, 0.62, 0.5], [-14.8, -18.0, 0.68, -0.7],
    [14.7, -18.4, 0.40, -0.2], [-12.8, -20.4, 0.52, 0.2],
    [12.8, -16.9, 0.54, 0.7], [-18.5, -8.8, 0.48, 0.6],
    [18.8, -9.2, 0.42, 0.3], [-17.2, -6.9, 0.38, -0.2],
    [16.9, -7.7, 0.48, -0.5], [-10.9, -19.0, 0.34, -0.4],
    [13.6, -20.0, 0.46, 0.4], [-19.1, -2.6, 0.42, 0.4],
    [11.7, -19.1, 0.34, -0.6], [19.3, -3.0, 0.38, 0.6],
    [-18.4, 0.8, 0.34, -0.6], [18.7, 0.3, 0.32, -0.3],
    [-15.7, 3.2, 0.32, -0.4], [15.5, 2.9, 0.30, 0.2],
]);

const PETAL_LAYOUT = Object.freeze([
    [-15.8, -10.6, 0.30, 0.2], [14.8, -4.1, 0.27, -0.4],
    [-13.4, -2.8, 0.24, 0.8], [16.2, -9.5, 0.32, -0.7],
    [-10.8, 0.8, 0.22, -0.1], [12.1, -13.2, 0.25, 0.5],
    [-17.0, -6.6, 0.28, -0.8], [10.7, 0.2, 0.21, 0.9],
    [-14.9, -13.7, 0.26, 0.4], [17.1, -1.3, 0.23, -0.3],
    [-11.8, -12.2, 0.20, 0.7], [13.7, -10.9, 0.28, -0.6],
    [-16.4, -0.4, 0.24, 0.1], [15.6, -13.8, 0.21, 0.8],
    [-12.7, -7.4, 0.26, -0.5], [16.7, -6.0, 0.25, 0.3],
    [-9.8, -14.4, 0.20, -0.9], [11.1, -2.1, 0.22, 0.6],
    [-17.3, -11.7, 0.23, -0.2], [14.4, 1.7, 0.20, 0.4],
]);

function makeRng(seed) {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function makeRidgeGeometry() {
    // Five receding ridgelines instead of two flat cut-outs. Each layer is
    // jagged and majestic; the shared scene fog + the material's depth haze fade
    // the far layers into mist, so the range reads as deep, mystical mountains
    // with real atmospheric perspective rather than a single cardboard wall.
    const rng = makeRng(20260726);
    const layers = [
        {
            z: -30, floor: -9, base: 9.2, jag: 5.2, steps: 18, notch: 0.7,
        },
        {
            z: -23, floor: -8, base: 7.6, jag: 4.4, steps: 20, notch: 0.58,
        },
        {
            z: -16, floor: -7, base: 6.0, jag: 4.0, steps: 22, notch: 0.4,
        },
        {
            z: -9, floor: -6, base: 4.4, jag: 3.4, steps: 25, notch: 0.22,
        },
        {
            z: -2, floor: -5, base: 3.0, jag: 2.8, steps: 28, notch: 0.08,
        },
    ];
    const halfSpan = 80;
    const positions = [];
    layers.forEach(({
        z, floor, base, jag, steps, notch,
    }) => {
        const points = [];
        for (let index = 0; index <= steps; index += 1) {
            const x = -halfSpan + (halfSpan * 2 * index) / steps;
            // Ridged fractal silhouette: a couple of smooth swells carrying a
            // sharper jagged crest, biased so no two layers share a peak.
            const ridged = Math.abs(
                Math.sin(index * 0.82 + z * 0.4)
                + Math.sin(index * 2.15 - z * 0.7) * 0.5,
            );
            const jitter = (rng() - 0.5) * 0.85;
            // Carve a soft valley near the moon (world x ≈ -14) in the far
            // layers so the moon keeps clearing the ridgeline.
            const moonGap = 1 - notch * (1 - Math.min(1, Math.abs(x + 14) / 16));
            const height = Math.max(
                floor + 0.6,
                (base + ridged * jag + jitter) * moonGap,
            );
            points.push([x, height]);
        }
        for (let index = 0; index < points.length - 1; index += 1) {
            const [x0, y0] = points[index];
            const [x1, y1] = points[index + 1];
            positions.push(x0, floor, z, x1, floor, z, x1, y1, z);
            positions.push(x0, floor, z, x1, y1, z, x0, y0, z);
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeMistVeilGeometry() {
    const layers = [
        {
            x: 0, z: -38, width: 88, base: -0.4, height: 9.2, density: 0.46,
        },
        {
            x: -3, z: -29, width: 76, base: -0.3, height: 6.8, density: 0.68,
        },
        {
            x: 4, z: -21.5, width: 62, base: -0.2, height: 4.4, density: 0.90,
        },
    ];
    const segments = 12;
    const positions = [];
    const uvs = [];
    const densities = [];
    layers.forEach((layer, layerIndex) => {
        for (let segment = 0; segment < segments; segment += 1) {
            const u0 = segment / segments;
            const u1 = (segment + 1) / segments;
            const x0 = layer.x + (u0 - 0.5) * layer.width;
            const x1 = layer.x + (u1 - 0.5) * layer.width;
            const top0 = layer.base + layer.height * (
                0.76 + Math.sin(u0 * Math.PI * 3.1 + layerIndex) * 0.18
            );
            const top1 = layer.base + layer.height * (
                0.76 + Math.sin(u1 * Math.PI * 3.1 + layerIndex) * 0.18
            );
            const z0 = layer.z + Math.sin(u0 * Math.PI * 2.0 + layerIndex) * 0.45;
            const z1 = layer.z + Math.sin(u1 * Math.PI * 2.0 + layerIndex) * 0.45;
            positions.push(
                x0,
                layer.base,
                z0,
                x1,
                layer.base,
                z1,
                x1,
                top1,
                z1,
                x0,
                layer.base,
                z0,
                x1,
                top1,
                z1,
                x0,
                top0,
                z0,
            );
            uvs.push(
                u0,
                0,
                u1,
                0,
                u1,
                1,
                u0,
                0,
                u1,
                1,
                u0,
                1,
            );
            for (let vertex = 0; vertex < 6; vertex += 1) {
                densities.push(layer.density);
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute(
        'aMistDensity',
        new THREE.Float32BufferAttribute(densities, 1),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeGrassGeometry() {
    const positions = [];
    const bladeLayout = [
        [-0.24, 0, 0, 0.02, 1.0, 0.03, 0.19, 0, 0],
        [-0.06, 0, -0.18, 0.09, 0.82, 0.04, 0.22, 0, 0.15],
        [-0.18, 0, 0.17, -0.03, 0.72, -0.08, 0.14, 0, -0.16],
        [-0.08, 0, -0.02, 0.15, 0.60, 0.17, 0.26, 0, 0.02],
    ];
    bladeLayout.forEach((blade) => positions.push(...blade));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeBrushCrownGeometry() {
    // A smooth, organic foliage clump. The old canopy used a low-poly icosphere
    // with an angle/height lobe term that carved harsh horizontal ridges (the
    // "strange stripes"). This one is a higher-subdivision sphere pushed by
    // low-frequency 3D bulges (soft leaf clumps, no banding), slightly oblate
    // with a flatter underside so it reads as a rounded canopy cap.
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const positions = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
        vertex.fromBufferAttribute(positions, index);
        const bulge = 1
            + Math.sin(vertex.x * 2.05 + vertex.z * 1.55) * 0.11
            + Math.sin(vertex.z * 2.65 - vertex.y * 1.85) * 0.08
            + Math.sin(vertex.y * 1.75 + vertex.x * 2.35) * 0.055;
        vertex.multiplyScalar(bulge);
        vertex.x *= 1.08;
        vertex.z *= 1.08;
        vertex.y *= 0.9;
        if (vertex.y < 0) vertex.y *= 0.8;
        positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makePineGeometry() {
    // A stylized fir spire: three stacked skirts tapering to a point. Gives the
    // forest tall pointed conifers among the rounded broadleaf clumps, for a
    // mystical mixed woodland silhouette. Spans y in [-1, 1.3], base radius ~1.
    const tiers = [
        {
            base: -1.0, baseR: 1.0, top: 0.05, topR: 0.56,
        },
        {
            base: -0.35, baseR: 0.82, top: 0.62, topR: 0.4,
        },
        {
            base: 0.35, baseR: 0.6, top: 1.3, topR: 0.0,
        },
    ];
    const segments = 8;
    const positions = [];
    tiers.forEach(({
        base, baseR, top, topR,
    }) => {
        for (let s = 0; s < segments; s += 1) {
            const a0 = (s / segments) * TAU;
            const a1 = ((s + 1) / segments) * TAU;
            const c0 = Math.cos(a0);
            const s0 = Math.sin(a0);
            const c1 = Math.cos(a1);
            const s1 = Math.sin(a1);
            positions.push(
                c0 * baseR,
                base,
                s0 * baseR,
                c1 * baseR,
                base,
                s1 * baseR,
                c1 * topR,
                top,
                s1 * topR,
            );
            positions.push(
                c0 * baseR,
                base,
                s0 * baseR,
                c1 * topR,
                top,
                s1 * topR,
                c0 * topR,
                top,
                s0 * topR,
            );
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeSpiritVeilGeometry() {
    const geometry = new THREE.BufferGeometry();
    const positions = [
        // Paired pectoral veils around the middle bend.
        0.18, 0.66, 0.02,
        1.18, 0.22, 0.12,
        0.44, 1.20, -0.04,
        0.08, 0.72, -0.02,
        -0.98, 0.18, 0.08,
        -0.38, 1.18, -0.08,
        // A forked translucent tail at the lower end of the S gesture.
        -1.30, -1.50, 0,
        -2.18, -2.08, 0.12,
        -0.98, -1.93, -0.04,
        -1.30, -1.50, 0,
        -0.62, -2.22, -0.12,
        -0.98, -1.93, -0.04,
    ];
    const uvs = [
        0.34, 0.44, 0.02, 0.56, 0.42, 0.74,
        0.34, 0.44, 0.02, 0.56, 0.42, 0.74,
        0.02, 0.08, 0, 0, 0.20, 0.20,
        0.02, 0.08, 0.24, 0, 0.20, 0.20,
    ];
    // A faceted almond head and short snout turn the ribbon into a readable
    // moon-koi silhouette without another material or draw call.
    const headCenter = [1.12, 2.68, 0.02];
    const headOutline = [
        [0.72, 2.38, 0],
        [1.30, 2.42, 0.02],
        [1.62, 2.70, 0],
        [1.22, 2.98, -0.02],
        [0.76, 2.88, 0],
    ];
    const headUvs = [
        [0.38, 0.58],
        [0.60, 0.60],
        [0.72, 0.76],
        [0.56, 0.92],
        [0.38, 0.86],
    ];
    for (let index = 0; index < headOutline.length; index += 1) {
        const next = (index + 1) % headOutline.length;
        positions.push(...headCenter, ...headOutline[index], ...headOutline[next]);
        uvs.push(0.54, 0.74, ...headUvs[index], ...headUvs[next]);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makePetalGeometry() {
    const outline = [
        [0, 1],
        [0.72, 0.36],
        [0.58, -0.58],
        [0, -0.28],
        [-0.58, -0.58],
        [-0.72, 0.36],
    ];
    const positions = [0, 0, 0.05];
    const uvs = [0.5, 0.52];
    outline.forEach(([x, z]) => {
        positions.push(x, 0, z);
        uvs.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    });
    const indices = [];
    for (let index = 0; index < outline.length; index += 1) {
        indices.push(0, index + 1, ((index + 1) % outline.length) + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function freezeStaticTransform(object) {
    object.updateMatrix();
    object.matrixAutoUpdate = false;
    return object;
}

function markStaticInstances(mesh) {
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    freezeStaticTransform(mesh);
    return mesh;
}

function createRadialSpriteMaterial(
    uTime,
    uReaction,
    colorA,
    colorB,
    phase = 0,
    opacity = 0.34,
) {
    const material = new THREE.SpriteNodeMaterial();
    const centered = uv().sub(vec2(0.5)).mul(2);
    const falloff = pow(
        smoothstep(0.06, 1, length(centered)).oneMinus(),
        float(2.2),
    );
    const breath = sin(uTime.mul(0.72).add(phase)).mul(0.08).add(0.92);
    const reactionLift = float(1).add(uReaction.mul(0.46));
    material.colorNode = mix(vec3(...colorA), vec3(...colorB), falloff)
        .mul(breath)
        .mul(reactionLift);
    material.opacityNode = falloff
        .mul(opacity)
        .mul(breath)
        .mul(reactionLift)
        .clamp(0, 0.78);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.toneMapped = false;
    material.fog = false;
    return material;
}

function enableReflectionLayer(object) {
    object.traverse((child) => child.layers.enable(REFLECTION_LAYER));
}

export function createKoiPondLandscape({
    scene,
    quality = 'High',
    reducedMotion = false,
    intensity = 1,
} = {}) {
    if (!scene?.add) throw new TypeError('Koi Pond landscape requires a Three.js scene');

    const root = new THREE.Group();
    root.name = 'KoiPondMoonwakeLandscape';

    const geometries = new Set();
    const materials = new Set();
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
        return object;
    };

    const uTime = uniform(0);
    const uReaction = uniform(0);
    const uMotion = uniform(reducedMotion ? 0 : 1);

    const skyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const direction = normalize(positionLocal);
        const height = smoothstep(-0.26, 0.82, direction.y);
        const horizon = smoothstep(0.01, 0.42, abs(direction.y.add(0.035))).oneMinus();
        const skyNoise = noiseFloat(
            positionLocal.mul(0.028).add(vec3(uTime.mul(0.006), 0, 0)),
        ).mul(0.5).add(0.5);
        const cloudA = noiseFloat(
            positionLocal
                .mul(vec3(0.018, 0.072, 0.024))
                .add(vec3(uTime.mul(0.008), 0, uTime.mul(-0.003))),
        ).mul(0.5).add(0.5);
        const cloudB = noiseFloat(
            positionLocal
                .mul(vec3(0.041, 0.12, 0.018))
                .add(vec3(uTime.mul(-0.004), 4.2, uTime.mul(0.006))),
        ).mul(0.5).add(0.5);
        const cloudBand = smoothstep(
            0.52,
            0.73,
            mix(cloudA, cloudB, float(0.38)),
        )
            .mul(smoothstep(-0.18, 0.34, direction.y))
            .mul(smoothstep(0.58, 0.86, direction.y).oneMinus());
        const starField = noiseFloat(positionLocal.mul(0.86)).mul(0.5).add(0.5);
        const starMask = smoothstep(0.87, 0.975, starField)
            .mul(smoothstep(0.05, 0.38, direction.y))
            .mul(cloudBand.mul(0.72).oneMinus());
        const twinkle = sin(
            uTime.mul(0.22).add(positionLocal.x.mul(0.19)).add(positionLocal.z.mul(0.13)),
        ).mul(0.16).add(0.84);
        const zenith = mix(
            vec3(0.0015, 0.005, 0.016),
            vec3(0.005, 0.021, 0.038),
            skyNoise,
        );
        const horizonBase = mix(
            vec3(0.006, 0.025, 0.043),
            vec3(0.011, 0.048, 0.055),
            horizon,
        );
        skyMaterial.colorNode = mix(horizonBase, zenith, height)
            .add(vec3(0.018, 0.048, 0.060).mul(cloudBand.mul(0.72)))
            .add(vec3(0.38, 0.58, 0.58).mul(starMask.mul(twinkle)))
            .mul(float(0.96).add(uReaction.mul(0.035)));
        skyMaterial.side = THREE.BackSide;
        skyMaterial.depthWrite = false;
        skyMaterial.fog = false;
    }
    const sky = add(new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(100, 48, 24)),
        skyMaterial,
    ));
    sky.position.set(0, 0, -6);
    sky.frustumCulled = false;
    sky.renderOrder = -100;
    freezeStaticTransform(sky);

    const moonGlow = add(new THREE.Sprite(ownMaterial(createRadialSpriteMaterial(
        uTime,
        uReaction,
        [0.16, 0.46, 0.40],
        [0.72, 0.92, 0.82],
        0.6,
        0.15,
    ))));
    moonGlow.position.set(
        KOI_POND_LAYOUT.moon.position.x,
        KOI_POND_LAYOUT.moon.position.y,
        KOI_POND_LAYOUT.moon.position.z - 0.2,
    );
    moonGlow.scale.set(
        KOI_POND_LAYOUT.moon.glowScale,
        KOI_POND_LAYOUT.moon.glowScale,
        1,
    );
    moonGlow.name = 'KoiPondDistantMoonHalo';
    moonGlow.renderOrder = -80;
    moonGlow.material.depthTest = false;
    freezeStaticTransform(moonGlow);

    const ridgeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const grain = noiseFloat(positionWorld.mul(0.09)).mul(0.5).add(0.5);
        // World z runs ~-37 (near ridge) to ~-61 (far ridge). Far layers fade
        // into a cool moonlit mist for atmospheric perspective; near layers stay
        // dark and mystical.
        const farness = smoothstep(-37, -60, positionWorld.z);
        const peak = smoothstep(-4.5, 7.5, positionWorld.y);
        const nearColor = mix(
            vec3(0.003, 0.014, 0.018),
            vec3(0.009, 0.032, 0.033),
            grain.mul(0.7),
        );
        const mistColor = vec3(0.042, 0.094, 0.118);
        ridgeMaterial.colorNode = mix(nearColor, mistColor, farness.mul(0.9))
            // Moonlit dusting toward the crests gives each flat layer a sense of
            // 3D form; stronger on the misty far peaks so the distant ridgelines
            // catch a faint luminous rim and read as mystical, layered mountains.
            .add(
                vec3(0.065, 0.13, 0.175)
                    .mul(pow(peak, float(1.55)))
                    .mul(farness.mul(0.7).add(0.26)),
            );
    }
    const ridge = add(new THREE.Mesh(ownGeometry(makeRidgeGeometry()), ridgeMaterial));
    ridge.position.set(0, 0, -35);
    ridge.renderOrder = -70;
    freezeStaticTransform(ridge);

    // Outfield ground.
    //
    // The pond bank is an ELLIPSE (radial <= 2.18 of pondRadii), so it pinches
    // in as z recedes — at z=-30 it is only +-23u wide, and by z=-36 it has ended
    // entirely. The camera frustum does the opposite and WIDENS with depth
    // (+-38u at z=-30). The difference was raw sky dome showing through at the
    // left and right edges behind the pond, which read as "empty edges that are
    // not grass". This plane fills that outfield out past the frame at every
    // depth, sitting just under the bank so the sculpted bank still wins where
    // the two overlap, and fading into the same haze as the mountains.
    const outfieldMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const grain = noiseFloat(positionWorld.mul(0.045)).mul(0.5).add(0.5);
        const farness = smoothstep(-14, -44, positionWorld.z);
        const base = mix(
            vec3(0.0075, 0.0225, 0.0155),
            vec3(0.0125, 0.0330, 0.0225),
            grain,
        );
        outfieldMaterial.colorNode = mix(base, vec3(0.011, 0.030, 0.038), farness.mul(0.75));
        outfieldMaterial.roughnessNode = float(1);
        outfieldMaterial.metalnessNode = float(0);
    }
    const outfield = add(new THREE.Mesh(
        ownGeometry(new THREE.PlaneGeometry(200, 96)),
        outfieldMaterial,
    ));
    outfield.rotation.x = -Math.PI / 2;
    // Just below the bank's outer lip (~-0.37) so the bank reads on top of it,
    // and stopping short of the ridge line at z=-37 so it never tents the peaks.
    outfield.position.set(0, -0.46, -4);
    outfield.renderOrder = -65;
    outfield.name = 'KoiPondOutfieldGround';
    freezeStaticTransform(outfield);

    // Three broken, ground-hugging veils share one geometry and one draw. Their
    // depth separation removes the old straight cyan band.
    const mistMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const mistUv = uv();
        const lowerFade = smoothstep(0, 0.34, mistUv.y);
        const upperFade = smoothstep(0.58, 1, mistUv.y).oneMinus();
        const sideFade = smoothstep(0, 0.12, mistUv.x)
            .mul(smoothstep(0.88, 1, mistUv.x).oneMinus());
        const drift = noiseFloat(
            positionWorld.mul(0.09).add(vec3(uTime.mul(0.025), 0, 0)),
        ).mul(0.5).add(0.5);
        const layerDensity = attribute('aMistDensity');
        mistMaterial.colorNode = mix(
            vec3(0.006, 0.030, 0.033),
            vec3(0.022, 0.090, 0.078),
            drift,
        );
        mistMaterial.opacityNode = lowerFade
            .mul(upperFade)
            .mul(sideFade)
            .mul(float(0.10).add(drift.mul(0.14)))
            .mul(layerDensity);
        mistMaterial.transparent = true;
        mistMaterial.depthWrite = false;
        mistMaterial.side = THREE.DoubleSide;
        mistMaterial.forceSinglePass = true;
        mistMaterial.fog = false;
    }
    const mist = add(new THREE.Mesh(
        ownGeometry(makeMistVeilGeometry()),
        mistMaterial,
    ));
    mist.renderOrder = 2;
    freezeStaticTransform(mist);

    const trunkMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const barkGrain = noiseFloat(
            positionWorld.mul(vec3(0.24, 0.075, 0.24)),
        ).mul(0.5).add(0.5);
        const farHaze = smoothstep(-43, -20, positionWorld.z).oneMinus();
        const moonRim = clamp(
            dot(normalize(normalWorld), normalize(vec3(-0.42, 0.72, 0.54))),
            0,
            1,
        );
        const lanternLift = smoothstep(
            2.5,
            16,
            length(positionWorld.xz.sub(vec2(13.8, -20))),
        ).oneMinus();
        const bark = mix(
            vec3(0.010, 0.012, 0.011),
            vec3(0.055, 0.046, 0.030),
            barkGrain.mul(0.54),
        );
        trunkMaterial.colorNode = mix(
            bark,
            vec3(0.018, 0.045, 0.044),
            farHaze.mul(0.52),
        )
            .add(vec3(0.045, 0.085, 0.066).mul(moonRim.mul(0.16)))
            .add(vec3(0.10, 0.032, 0.010).mul(lanternLift.mul(0.16)));
    }
    trunkMaterial.roughnessNode = float(1);
    const trunkGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1.15, 2, 7, 1));
    const trunks = add(new THREE.InstancedMesh(trunkGeometry, trunkMaterial, MAX_TREES));

    const crownMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const swayPhase = hash(instanceIndex).mul(TAU);
        const tipWeight = smoothstep(-0.2, 0.92, positionGeometry.y);
        const sway = sin(uTime.mul(0.16).add(swayPhase))
            .mul(0.035)
            .mul(tipWeight)
            .mul(uMotion);
        crownMaterial.positionNode = positionLocal.add(vec3(
            sway,
            0,
            sway.mul(0.42),
        ));
        const grain = noiseFloat(positionWorld.mul(0.16)).mul(0.5).add(0.5);
        const variation = hash(instanceIndex).mul(0.46);
        const farHaze = smoothstep(-43, -20, positionWorld.z).oneMinus();
        const moonRim = clamp(
            dot(normalize(normalWorld), normalize(vec3(-0.42, 0.72, 0.54))),
            0,
            1,
        );
        const lanternLift = smoothstep(
            3,
            18,
            length(positionWorld.xz.sub(vec2(13.8, -20))),
        ).oneMinus();
        // Foliage form: dark cool underside lifting to a moonlit crown, so each
        // clump reads as a lit volume instead of a uniform blob.
        const canopyForm = smoothstep(-0.9, 0.82, positionGeometry.y);
        const canopyBase = mix(
            vec3(0.002, 0.012, 0.011),
            vec3(0.010, 0.040, 0.028),
            variation,
        );
        crownMaterial.colorNode = mix(
            canopyBase,
            vec3(0.030, 0.105, 0.066),
            grain.mul(0.64),
        );
        crownMaterial.colorNode = mix(
            crownMaterial.colorNode,
            vec3(0.016, 0.060, 0.060),
            farHaze.mul(0.58),
        )
            .add(vec3(0.055, 0.12, 0.086).mul(moonRim.mul(0.16)))
            .add(vec3(0.12, 0.040, 0.012).mul(lanternLift.mul(0.14)))
            .mul(float(0.94).add(uReaction.mul(0.08)))
            .mul(mix(float(0.52), float(1.16), canopyForm));
        // Backlit moonlit rim: the silhouette edges that face the moon catch a
        // cool HDR halo that feeds the bloom pass — the defining Ghibli-night
        // motif that turns the flat tree masses into moonlit crowns.
        const crownView = normalize(cameraPosition.sub(positionWorld));
        const crownEdge = pow(
            clamp(float(1).sub(dot(normalize(normalWorld), crownView)), 0, 1),
            float(2.0),
        );
        const crownRim = crownEdge.mul(pow(moonRim, float(1.4)).mul(0.9).add(0.1));
        crownMaterial.emissiveNode = vec3(0.14, 0.34, 0.46).mul(crownRim).mul(1.35);
        crownMaterial.roughnessNode = float(0.98);
    }
    const crownGeometry = ownGeometry(makeBrushCrownGeometry());
    const crowns = add(new THREE.InstancedMesh(
        crownGeometry,
        crownMaterial,
        MAX_TREES * CROWNS_PER_TREE,
    ));
    // Conifer spires reuse the crown material (its dark-underside → moonlit-top
    // gradient + moon rim read well on a fir too); one spire per conifer tree.
    const pines = add(new THREE.InstancedMesh(
        ownGeometry(makePineGeometry()),
        crownMaterial,
        MAX_TREES,
    ));

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();

    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    TREE_LAYOUT.forEach((entry, index) => {
        const [x, z, size, lean] = entry;
        // Balanced across both banks (not just odd = right): ~1/3 conifer spires,
        // ~1/3 crooked broadleaf, ~1/3 rounded broadleaf.
        const conifer = index % 3 === 1;
        const crooked = index % 3 === 2;
        let heightFactor = 1;
        if (conifer) heightFactor = 1.3;
        else if (crooked) heightFactor = 0.94;
        const height = 6.7 * size * heightFactor;
        const groundY = sampleKoiPondGroundHeight(x, z);
        position.set(x, groundY + height * 0.5 - 0.12, z);
        quaternion.setFromEuler(euler.set(lean * 0.35, lean, lean * 0.18));
        let trunkWidthFactor = 0.49;
        if (crooked) trunkWidthFactor = 0.58;
        else if (conifer) trunkWidthFactor = 0.38;
        const trunkWidth = trunkWidthFactor * size;
        scale.set(trunkWidth, height * 0.5, trunkWidth * (crooked ? 0.82 : 1));
        matrix.compose(position, quaternion, scale);
        trunks.setMatrixAt(index, matrix);

        if (conifer) {
            // One fir spire; hide this tree's three rounded-crown slots.
            position.set(x, groundY + height * 0.7, z);
            quaternion.setFromEuler(euler.set(lean * 0.16, index * 0.7, lean * 0.1));
            scale.set(size * 2.15, height * 0.42, size * 2.15);
            matrix.compose(position, quaternion, scale);
            pines.setMatrixAt(index, matrix);
            for (let layer = 0; layer < CROWNS_PER_TREE; layer += 1) {
                crowns.setMatrixAt(index * CROWNS_PER_TREE + layer, zeroMatrix);
            }
            return;
        }

        // Broadleaf: hide the spire slot, place rounded crown clumps.
        pines.setMatrixAt(index, zeroMatrix);
        for (let layer = 0; layer < CROWNS_PER_TREE; layer += 1) {
            const crownIndex = index * CROWNS_PER_TREE + layer;
            const side = index % 2 === 0 ? -1 : 1;
            position.set(
                x
                    + lean * (layer - 1) * (crooked ? 7.2 : 5.4)
                    + side * (layer - 1) * (crooked ? 0.34 : 0.18),
                groundY + height * (0.57 + layer * 0.145),
                z + (layer - 1) * -0.48,
            );
            quaternion.setFromEuler(euler.set(
                layer * 0.08,
                index * 0.83 + layer * 0.61,
                lean * 0.7 + side * 0.04,
            ));
            if (crooked) {
                scale.set(
                    (2.05 - layer * 0.24) * size,
                    (1.18 - layer * 0.07) * size,
                    (1.54 - layer * 0.18) * size,
                );
            } else {
                scale.set(
                    (2.48 - layer * 0.34) * size,
                    (1.28 - layer * 0.09) * size,
                    (1.92 - layer * 0.25) * size,
                );
            }
            matrix.compose(position, quaternion, scale);
            crowns.setMatrixAt(crownIndex, matrix);
        }
    });
    markStaticInstances(trunks);
    markStaticInstances(crowns);
    markStaticInstances(pines);

    // One shared tapered-branch draw gives the forest a Bauer/Kittelsen root
    // rhythm: two authored boughs per tree; the whole pool remains static.
    // (The six left-bank willow tendrils were removed together with the water
    // module's willow canopies they used to hang from.)
    const branchSegments = [];
    TREE_LAYOUT.forEach((entry, index) => {
        const [x, z, size] = entry;
        const height = 6.7 * size;
        const groundY = sampleKoiPondGroundHeight(x, z);
        const side = index % 2 === 0 ? -1 : 1;
        branchSegments.push([
            [x, groundY + height * 0.63, z],
            [x + side * 2.45 * size, groundY + height * 0.82, z + 0.78],
            0.16 * size,
        ]);
        branchSegments.push([
            [x, groundY + height * 0.72, z],
            [x - side * 1.9 * size, groundY + height * 0.91, z - 0.62],
            0.13 * size,
        ]);
    });
    const branchGeometry = ownGeometry(new THREE.CylinderGeometry(0.72, 1, 1, 7, 1));
    const branches = add(new THREE.InstancedMesh(
        branchGeometry,
        trunkMaterial,
        WILLOW_TENDRIL_COUNT + MAX_TREES * BRANCHES_PER_TREE,
    ));
    const branchStart = new THREE.Vector3();
    const branchEnd = new THREE.Vector3();
    const branchDirection = new THREE.Vector3();
    const branchAxis = new THREE.Vector3(0, 1, 0);
    branchSegments.forEach((segment, index) => {
        branchStart.fromArray(segment[0]);
        branchEnd.fromArray(segment[1]);
        branchDirection.subVectors(branchEnd, branchStart);
        const branchLength = branchDirection.length();
        position.copy(branchStart).add(branchEnd).multiplyScalar(0.5);
        quaternion.setFromUnitVectors(branchAxis, branchDirection.normalize());
        scale.set(segment[2], branchLength, segment[2]);
        matrix.compose(position, quaternion, scale);
        branches.setMatrixAt(index, matrix);
    });
    markStaticInstances(branches);

    // Modelled CC0 grove. It loads async and retires the procedural forest above
    // once live, so a slow/failed fetch degrades to the old trees rather than an
    // empty bank. Branches belong to the procedural trunks, so they retire too.
    let groveLive = false;
    const forest = createKoiPondForest({
        scene,
        uTime,
        uMotion,
        groundHeightAt: sampleKoiPondGroundHeight,
        // Hero count is fixed at construction: a quality change rebuilds the
        // whole runtime anyway (setQuality reports requiresRebuild).
        heroTreeCount: KOI_POND_HERO_LIMITS[normalizeKoiPondQuality(quality)] ?? 12,
        onReady: () => {
            groveLive = true;
            trunks.visible = false;
            crowns.visible = false;
            pines.visible = false;
            branches.visible = false;
        },
    });

    const grassMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const bladeTip = smoothstep(0.08, 0.92, positionGeometry.y);
        const phase = hash(instanceIndex).mul(TAU);
        const breeze = sin(uTime.mul(0.74).add(phase))
            .add(sin(uTime.mul(0.31).sub(phase.mul(0.63))).mul(0.42))
            .mul(0.055)
            .mul(bladeTip)
            .mul(uMotion);
        grassMaterial.positionNode = positionLocal.add(vec3(
            breeze,
            0,
            breeze.mul(0.36),
        ));
        const variation = hash(instanceIndex.add(31));
        const baseColor = mix(
            vec3(0.024, 0.060, 0.028),
            vec3(0.070, 0.145, 0.058),
            variation,
        );
        grassMaterial.colorNode = mix(
            baseColor,
            vec3(0.16, 0.28, 0.095),
            bladeTip.mul(0.56),
        )
            .add(vec3(0.055, 0.095, 0.065).mul(uReaction.mul(0.12)));
        // Moonlit translucent blade tips: the grass catches a cool backlight at
        // its edges, giving the shoreline a soft luminous fringe instead of a
        // field of flat dark triangles.
        const grassView = normalize(cameraPosition.sub(positionWorld));
        const grassEdge = pow(
            clamp(float(1).sub(dot(normalize(normalWorld), grassView)), 0, 1),
            float(1.6),
        );
        const grassMoon = clamp(
            dot(normalize(normalWorld), normalize(vec3(-0.36, 0.82, -0.44))),
            0,
            1,
        );
        grassMaterial.emissiveNode = vec3(0.10, 0.22, 0.20)
            .mul(bladeTip.mul(grassEdge).mul(grassMoon.add(0.22)))
            .mul(1.5);
        grassMaterial.roughnessNode = float(0.96);
        grassMaterial.metalnessNode = float(0);
        grassMaterial.side = THREE.DoubleSide;
    }
    const grass = add(new THREE.InstancedMesh(
        ownGeometry(makeGrassGeometry()),
        grassMaterial,
        MAX_GRASS,
    ));
    const grassRng = makeRng(27183);
    const grassZones = [
        1.08, 2.05, 0.48, 2.68,
        -0.10, 3.24, -0.72, -2.42,
    ];
    for (let index = 0; index < MAX_GRASS; index += 1) {
        const angle = grassZones[index % grassZones.length]
            + (grassRng() - 0.5) * 0.72;
        const radial = 1.075 + grassRng() ** 0.82 * 0.96;
        const x = Math.cos(angle) * KOI_POND_LAYOUT.pondRadii.x * radial;
        const z = KOI_POND_LAYOUT.pondCenter.z
            + Math.sin(angle) * KOI_POND_LAYOUT.pondRadii.z * radial;
        const nearEmphasis = Math.max(0, Math.sin(angle));
        const horizontal = 0.62 + grassRng() * 0.58;
        const vertical = (0.72 + grassRng() * 0.86) * (1 + nearEmphasis * 0.28);
        position.set(x, sampleKoiPondGroundHeight(x, z) + 0.015, z);
        quaternion.setFromEuler(euler.set(
            (grassRng() - 0.5) * 0.12,
            grassRng() * TAU,
            (grassRng() - 0.5) * 0.10,
        ));
        scale.set(horizontal, vertical, horizontal);
        matrix.compose(position, quaternion, scale);
        grass.setMatrixAt(index, matrix);
    }
    markStaticInstances(grass);
    grass.name = 'KoiPondMoonwakeSedges';

    const troll = add(new THREE.Group());
    troll.name = 'KoiPondTrollWitness';
    const guardianLayout = KOI_POND_LAYOUT.guardian;
    troll.position.set(
        guardianLayout.position.x,
        sampleKoiPondGroundHeight(
            guardianLayout.position.x,
            guardianLayout.position.z,
        ) + 0.02,
        guardianLayout.position.z,
    );
    troll.rotation.y = guardianLayout.rotationY;
    troll.scale.setScalar(guardianLayout.scale);

    const trollMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const mossNoise = noiseFloat(positionWorld.mul(0.58)).mul(0.5).add(0.5);
        const upFacing = smoothstep(0.08, 0.72, normalWorld.y);
        const mossPatch = smoothstep(0.54, 0.76, mossNoise).mul(upFacing);
        const instanceTone = attribute('aTrollTone');
        const moonFacing = pow(
            max(
                dot(normalWorld, normalize(vec3(-0.38, 0.66, 0.58))),
                float(0),
            ),
            float(1.7),
        );
        const stone = mix(
            vec3(0.020, 0.028, 0.022),
            vec3(0.070, 0.085, 0.055),
            mossNoise.mul(0.34),
        );
        trollMaterial.colorNode = mix(
            stone,
            vec3(0.090, 0.170, 0.065),
            mossPatch.mul(0.68),
        )
            .add(vec3(0.14, 0.25, 0.19).mul(moonFacing.mul(0.22)))
            .mul(instanceTone)
            .mul(float(0.96).add(uReaction.mul(0.06)));
        // Moonlit rim + living moss glow: the guardian's silhouette catches a
        // cool backlight so it reads as a watching creature, not a dark blob.
        const trollView = normalize(cameraPosition.sub(positionWorld));
        const trollEdge = pow(
            clamp(float(1).sub(dot(normalize(normalWorld), trollView)), 0, 1),
            float(2.2),
        );
        const trollRim = trollEdge.mul(moonFacing.mul(0.7).add(0.14));
        trollMaterial.emissiveNode = mix(
            vec3(0.006, 0.011, 0.007),
            vec3(0.030, 0.075, 0.028),
            mossPatch,
        )
            .add(vec3(0.11, 0.23, 0.30).mul(trollRim).mul(1.15))
            .mul(instanceTone);
        trollMaterial.roughnessNode = float(1);
        trollMaterial.metalnessNode = float(0);
        trollMaterial.flatShading = true;
    }
    // Deliberately carved, authored anatomy: a single stooped torso line,
    // hooked profile, long arms, and grounded feet replace the old pile of
    // similarly sized boulders without increasing the three-draw budget.
    const trollRockGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 2));
    const trollMassLayout = [
        {
            position: [0, 1.25, -0.18],
            scale: [1.86, 1.48, 1.28],
            rotation: [0.04, -0.08, -0.03],
            tone: 0.98,
        },
        {
            position: [-0.32, 2.55, -0.35],
            scale: [2.14, 1.38, 1.28],
            rotation: [-0.08, 0.15, 0.08],
            tone: 0.92,
        },
        {
            position: [-0.62, 3.44, -0.54],
            scale: [1.48, 1.08, 1.02],
            rotation: [0.12, -0.22, 0.18],
            tone: 0.87,
        },
        {
            position: [0.16, 4.12, 0.05],
            scale: [1.18, 0.98, 0.92],
            rotation: [0.05, -0.06, -0.10],
            tone: 1.06,
        },
        {
            position: [0.10, 4.28, 0.88],
            scale: [1.02, 0.16, 0.24],
            rotation: [0.02, 0, -0.02],
            tone: 0.86,
        },
        {
            position: [0.22, 3.88, 0.82],
            scale: [0.72, 0.46, 0.64],
            rotation: [0.05, -0.08, 0.02],
            tone: 0.95,
        },
        {
            position: [0.02, 3.55, 1.40],
            scale: [0.38, 0.54, 0.42],
            rotation: [0.42, 0.08, 0.12],
            tone: 0.90,
        },
        {
            position: [0.16, 3.34, 0.78],
            scale: [0.62, 0.27, 0.50],
            rotation: [0.04, 0.02, -0.04],
            tone: 0.82,
        },
        {
            position: [-2.40, 0.55, 0.88],
            scale: [0.62, 0.34, 0.72],
            rotation: [-0.12, 0.30, 0.12],
            tone: 0.78,
        },
        {
            position: [2.50, 0.68, 0.80],
            scale: [0.64, 0.34, 0.70],
            rotation: [-0.08, -0.25, -0.05],
            tone: 0.76,
        },
        {
            position: [-0.88, 0.31, 0.48],
            scale: [0.78, 0.30, 1.05],
            rotation: [0, 0.15, 0.04],
            tone: 0.86,
        },
        {
            position: [1.03, 0.31, 0.44],
            scale: [0.78, 0.30, 1.02],
            rotation: [0, -0.12, -0.04],
            tone: 0.84,
        },
    ];
    trollRockGeometry.setAttribute(
        'aTrollTone',
        new THREE.InstancedBufferAttribute(
            new Float32Array(trollMassLayout.map((entry) => entry.tone)),
            1,
        ),
    );
    const trollMasses = new THREE.InstancedMesh(
        trollRockGeometry,
        trollMaterial,
        trollMassLayout.length,
    );
    trollMassLayout.forEach((entry, index) => {
        position.fromArray(entry.position);
        quaternion.setFromEuler(euler.fromArray(entry.rotation));
        scale.fromArray(entry.scale);
        matrix.compose(position, quaternion, scale);
        trollMasses.setMatrixAt(index, matrix);
    });
    markStaticInstances(trollMasses);
    trollMasses.name = 'KoiPondGuardianMasses';
    troll.add(trollMasses);

    const trollLimbSegments = [
        [[-1.38, 3.02, -0.05], [-2.05, 1.75, 0.43], 0.38, 0.92],
        [[-2.05, 1.75, 0.43], [-2.40, 0.62, 0.88], 0.29, 0.82],
        [[1.33, 2.85, -0.02], [2.16, 1.80, 0.36], 0.39, 0.90],
        [[2.16, 1.80, 0.36], [2.50, 0.76, 0.80], 0.29, 0.80],
        [[-0.72, 1.36, -0.10], [-0.92, 0.48, 0.36], 0.48, 0.86],
        [[0.78, 1.34, -0.08], [1.02, 0.48, 0.32], 0.48, 0.84],
    ];
    const trollLimbGeometry = ownGeometry(new THREE.CylinderGeometry(0.72, 1, 1, 7, 1));
    trollLimbGeometry.setAttribute(
        'aTrollTone',
        new THREE.InstancedBufferAttribute(
            new Float32Array(trollLimbSegments.map((entry) => entry[3])),
            1,
        ),
    );
    const trollLimbs = new THREE.InstancedMesh(
        trollLimbGeometry,
        trollMaterial,
        trollLimbSegments.length,
    );
    const limbStart = new THREE.Vector3();
    const limbEnd = new THREE.Vector3();
    const limbDirection = new THREE.Vector3();
    const limbAxis = new THREE.Vector3(0, 1, 0);
    trollLimbSegments.forEach((entry, index) => {
        limbStart.fromArray(entry[0]);
        limbEnd.fromArray(entry[1]);
        limbDirection.subVectors(limbEnd, limbStart);
        const limbLength = limbDirection.length();
        position.copy(limbStart).add(limbEnd).multiplyScalar(0.5);
        quaternion.setFromUnitVectors(limbAxis, limbDirection.normalize());
        scale.set(entry[2], limbLength, entry[2]);
        matrix.compose(position, quaternion, scale);
        trollLimbs.setMatrixAt(index, matrix);
    });
    markStaticInstances(trollLimbs);
    trollLimbs.name = 'KoiPondGuardianLimbs';
    troll.add(trollLimbs);

    const eyeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const eyeBreath = sin(uTime.mul(0.36)).mul(0.06).add(0.94);
    // HDR ember: even at rest the eye clears the bloom threshold so the
    // guardian reads as a single watching coal rather than a dark speck.
    eyeMaterial.colorNode = mix(
        vec3(0.72, 0.11, 0.02),
        vec3(2.6, 1.15, 0.22),
        uReaction.mul(0.5).add(0.42).clamp(),
    ).mul(eyeBreath);
    eyeMaterial.toneMapped = false;
    eyeMaterial.fog = false;
    const eyes = new THREE.InstancedMesh(
        ownGeometry(new THREE.SphereGeometry(1, 10, 6)),
        eyeMaterial,
        2,
    );
    [
        [-0.24, 4.17, 1.02, -0.10],
        [0.47, 4.20, 1.01, 0.08],
    ].forEach((entry, index) => {
        position.set(entry[0], entry[1], entry[2]);
        quaternion.setFromEuler(euler.set(0, 0, entry[3]));
        scale.set(0.19, 0.065, 0.055);
        matrix.compose(position, quaternion, scale);
        eyes.setMatrixAt(index, matrix);
    });
    markStaticInstances(eyes);
    eyes.name = 'KoiPondGuardianEyes';
    troll.add(eyes);
    freezeStaticTransform(troll);

    const spirit = add(new THREE.Group());
    spirit.name = 'KoiPondMoonKoiSpirit';
    spirit.position.set(8.6, 3.65, -20.3);
    spirit.scale.setScalar(0.90);
    const spiritMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const spiritNoise = noiseFloat(
            positionLocal.mul(2.15).add(vec3(0, uTime.mul(-0.22), 0)),
        ).mul(0.5).add(0.5);
        const spiritBreath = sin(uTime.mul(0.58)).mul(0.08).add(0.92);
        const viewDirection = normalize(cameraPosition.sub(positionWorld));
        const fresnel = pow(
            float(1).sub(max(dot(normalWorld, viewDirection), float(0))),
            float(2.15),
        );
        const longitudinal = float(0.16).add(
            smoothstep(0, 0.16, uv().x)
                .mul(smoothstep(0.84, 1, uv().x).oneMinus())
                .mul(0.84),
        );
        const spiritEye = smoothstep(
            0.035,
            0.12,
            length(positionLocal.xy.sub(vec2(1.31, 2.71))),
        ).oneMinus();
        // HDR spirit: the body and eye run above 1.0 so the post bloom wraps
        // the snake in a violet-teal glow, reading as a luminous swimming spirit.
        spiritMaterial.colorNode = mix(
            vec3(0.10, 0.62, 0.52),
            vec3(0.68, 0.34, 1.34),
            spiritNoise,
        )
            .add(vec3(0.60, 0.84, 1.12).mul(fresnel.mul(0.30)))
            .add(vec3(1.95, 0.88, 0.26).mul(spiritEye.mul(0.95)))
            .mul(spiritBreath)
            .mul(float(0.95).add(uReaction.mul(0.42)));
        const spiritOpacity = float(0.22)
            .add(spiritNoise.mul(0.14))
            .add(fresnel.mul(0.18))
            .add(uReaction.mul(0.10))
            .mul(longitudinal);
        spiritMaterial.opacityNode = spiritOpacity
            .add(spiritEye.mul(0.34))
            .clamp(0, 0.72);
        // Fluid swimming undulation: a two-harmonic wave travels head→tail and
        // the tail swings more than the head, so the spirit ripples like a
        // living koi-serpent rather than a rigid ribbon. The sway is in local X
        // (perpendicular to travel once the group yaws into its heading).
        const bodyAxis = positionLocal.y;
        const tailWeight = smoothstep(2.5, -1.5, bodyAxis).mul(0.7).add(0.36);
        const swimWave = sin(bodyAxis.mul(2.05).add(uTime.mul(0.95)))
            .add(sin(bodyAxis.mul(3.6).sub(uTime.mul(0.62)).add(1.2)).mul(0.4));
        const lateralDrift = swimWave.mul(0.14).mul(tailWeight).mul(uMotion);
        spiritMaterial.positionNode = positionLocal.add(vec3(
            lateralDrift,
            sin(bodyAxis.mul(1.7).sub(uTime.mul(0.5))).mul(0.03).mul(uMotion),
            lateralDrift.mul(-0.5),
        ));
        spiritMaterial.transparent = true;
        spiritMaterial.depthWrite = false;
        spiritMaterial.blending = THREE.AdditiveBlending;
        spiritMaterial.side = THREE.DoubleSide;
        spiritMaterial.forceSinglePass = true;
        spiritMaterial.toneMapped = true;
        spiritMaterial.fog = false;
    }
    const spiritCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.30, -1.50, 0),
        new THREE.Vector3(-0.46, -0.82, 0.28),
        new THREE.Vector3(0.66, -0.18, -0.16),
        new THREE.Vector3(0.44, 0.64, 0.24),
        new THREE.Vector3(-0.52, 1.30, 0.04),
        new THREE.Vector3(0.06, 2.08, -0.20),
        new THREE.Vector3(0.94, 2.66, 0.02),
    ]);
    const spiritRibbon = new THREE.Mesh(
        ownGeometry(new THREE.TubeGeometry(spiritCurve, 48, 0.16, 7, false)),
        spiritMaterial,
    );
    spirit.add(spiritRibbon);
    const spiritVeils = new THREE.Mesh(
        ownGeometry(makeSpiritVeilGeometry()),
        spiritMaterial,
    );
    spirit.add(spiritVeils);
    const spiritGlow = new THREE.Sprite(ownMaterial(createRadialSpriteMaterial(
        uTime,
        uReaction,
        [0.08, 0.38, 0.33],
        [0.48, 0.30, 0.94],
        2.1,
    )));
    // Child of the spirit group at the head offset, so the glow rides the head
    // as the spirit glides around the pond.
    spiritGlow.position.set(0.7, 2.78, 0);
    spiritGlow.scale.set(4.2, 4.2, 1);
    spirit.add(spiritGlow);

    const stemMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    stemMaterial.colorNode = mix(
        vec3(0.055, 0.072, 0.046),
        vec3(0.18, 0.20, 0.105),
        smoothstep(-0.5, 0.8, positionGeometry.y),
    );
    stemMaterial.roughnessNode = float(0.92);
    const capMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const capNoise = noiseFloat(positionWorld.mul(1.4)).mul(0.5).add(0.5);
        const phase = hash(instanceIndex);
        const capBreath = sin(uTime.mul(0.48).add(phase.mul(TAU))).mul(0.08).add(0.92);
        const gill = smoothstep(0.02, 0.62, positionGeometry.y).oneMinus();
        const family = smoothstep(0.42, 0.62, phase);
        const capDark = mix(
            vec3(0.075, 0.13, 0.035),
            vec3(0.19, 0.11, 0.028),
            family,
        );
        const capLight = mix(
            vec3(0.42, 0.72, 0.16),
            vec3(0.70, 0.42, 0.10),
            family,
        );
        const gillColor = mix(
            vec3(0.36, 0.96, 0.24),
            vec3(1.0, 0.64, 0.16),
            family.mul(0.72),
        );
        capMaterial.colorNode = mix(
            capDark,
            capLight,
            capNoise.mul(0.72),
        ).add(gillColor.mul(gill.mul(0.12)));
        capMaterial.emissiveNode = gillColor
            .mul(gill.mul(0.46).add(0.06))
            .mul(capBreath)
            .mul(float(1).add(uReaction.mul(0.36)));
        capMaterial.roughnessNode = mix(float(0.72), float(0.46), gill);
        capMaterial.side = THREE.DoubleSide;
    }
    const stemGeometry = ownGeometry(new THREE.CylinderGeometry(0.24, 0.34, 1, 8, 1));
    const capGeometry = ownGeometry(new THREE.SphereGeometry(1, 12, 7, 0, TAU, 0, Math.PI * 0.52));
    const mushroomStems = add(new THREE.InstancedMesh(
        stemGeometry,
        stemMaterial,
        MAX_MUSHROOMS,
    ));
    const mushroomCaps = add(new THREE.InstancedMesh(
        capGeometry,
        capMaterial,
        MAX_MUSHROOMS,
    ));
    MUSHROOM_LAYOUT.forEach((entry, index) => {
        const [x, z, size, rotation] = entry;
        const visualSize = size * 0.78;
        const height = visualSize * 1.9;
        position.set(x, 0.15 + height * 0.5, z);
        quaternion.setFromEuler(euler.set(
            rotation * 0.08,
            rotation,
            rotation * 0.14,
        ));
        scale.set(visualSize * 0.32, height, visualSize * 0.32);
        matrix.compose(position, quaternion, scale);
        mushroomStems.setMatrixAt(index, matrix);

        position.set(x, 0.12 + height, z);
        quaternion.setFromEuler(euler.set(
            rotation * 0.15,
            rotation,
            rotation * -0.12,
        ));
        scale.set(visualSize, visualSize * 0.42, visualSize * 0.94);
        matrix.compose(position, quaternion, scale);
        mushroomCaps.setMatrixAt(index, matrix);
    });
    markStaticInstances(mushroomStems);
    markStaticInstances(mushroomCaps);

    const moteGeometry = ownGeometry(new THREE.BufferGeometry());
    const motePositions = new Float32Array(MAX_MOTES * 3);
    const moteUvs = new Float32Array(MAX_MOTES * 2);
    const motePhases = new Float32Array(MAX_MOTES);
    const moteSizes = new Float32Array(MAX_MOTES);
    const moteKinds = new Float32Array(MAX_MOTES);
    const rng = makeRng(73129);
    for (let index = 0; index < MAX_MOTES; index += 1) {
        const cool = index % 3 === 0;
        if (cool) {
            const side = index % 2 === 0 ? -1 : 1;
            const radius = 13.5 + rng() * 10.2;
            const angle = (side < 0 ? Math.PI * 0.54 : -Math.PI * 0.04)
                + (rng() - 0.5) * Math.PI * 0.72;
            motePositions[index * 3] = Math.cos(angle) * radius;
            motePositions[index * 3 + 1] = 4.0 + rng() * 5.2;
            motePositions[index * 3 + 2] = -6 + Math.sin(angle) * radius;
            moteKinds[index] = 1;
        } else {
            const mushroom = MUSHROOM_LAYOUT[index % MUSHROOM_LAYOUT.length];
            motePositions[index * 3] = mushroom[0] + (rng() - 0.5) * 4.8;
            motePositions[index * 3 + 1] = 0.7 + rng() * 3.6;
            motePositions[index * 3 + 2] = mushroom[1] + (rng() - 0.5) * 4.2;
            moteKinds[index] = 0;
        }
        motePhases[index] = rng() * TAU;
        moteSizes[index] = cool ? 1.6 + rng() * 3.0 : 2.2 + rng() * 4.0;
        moteUvs[index * 2] = 0.5;
        moteUvs[index * 2 + 1] = 0.5;
    }
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
    // PointsNodeMaterial substitutes sprite UVs later, but r181 validates that
    // the source geometry has a UV attribute while building the graph.
    moteGeometry.setAttribute('uv', new THREE.BufferAttribute(moteUvs, 2));
    moteGeometry.setAttribute('aPhase', new THREE.BufferAttribute(motePhases, 1));
    moteGeometry.setAttribute('aSize', new THREE.BufferAttribute(moteSizes, 1));
    moteGeometry.setAttribute('aKind', new THREE.BufferAttribute(moteKinds, 1));
    moteGeometry.computeBoundingSphere();

    const moteMaterial = ownMaterial(new THREE.PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    }));
    {
        const phase = attribute('aPhase');
        const pointSize = attribute('aSize');
        const kind = attribute('aKind');
        const drift = vec3(
            sin(uTime.mul(0.21).add(phase)).mul(mix(float(0.34), float(0.58), kind)),
            sin(uTime.mul(0.34).add(phase.mul(1.7))).mul(0.24)
                .add(sin(uTime.mul(0.11).add(phase)).mul(0.12)),
            sin(uTime.mul(0.17).add(phase.mul(0.73))).mul(mix(float(0.30), float(0.48), kind)),
        ).mul(uMotion);
        const moteBlink = pow(
            sin(uTime.mul(1.7).add(phase.mul(2.4))).mul(0.5).add(0.5),
            float(3.2),
        );
        const shimmer = float(0.26).add(moteBlink.mul(0.74));
        const localUv = uv().sub(vec2(0.5));
        const disc = pow(
            smoothstep(0.08, 0.5, length(localUv)).oneMinus(),
            float(1.7),
        );
        moteMaterial.positionNode = positionGeometry.add(drift);
        moteMaterial.sizeNode = clamp(
            pointSize
                .mul(mix(float(1), float(0.82), kind))
                .mul(float(1).add(uReaction.mul(0.55))),
            1.5,
            8,
        );
        const warmColor = mix(
            vec3(0.38, 0.78, 0.18),
            vec3(1.0, 0.78, 0.24),
            shimmer,
        );
        const coolColor = mix(
            vec3(0.28, 0.62, 0.58),
            vec3(0.78, 0.92, 0.84),
            shimmer,
        );
        moteMaterial.colorNode = mix(warmColor, coolColor, kind)
            .mul(float(0.82).add(uReaction.mul(0.48)));
        moteMaterial.opacityNode = disc
            .mul(shimmer)
            .mul(mix(float(0.42), float(0.26), kind))
            .mul(float(1).add(uReaction.mul(0.38)))
            .clamp();
        moteMaterial.toneMapped = false;
        moteMaterial.fog = false;
    }
    const motes = add(new THREE.Points(moteGeometry, moteMaterial));
    motes.frustumCulled = false;
    freezeStaticTransform(motes);

    // A restrained remnant of the original Koi Pond identity: surface petals
    // live only in the shoreline lanes, leaving the central board sanctuary
    // visually quiet. One tiny instanced draw replaces the old DOM animation.
    const petalMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    }));
    {
        const phase = hash(instanceIndex).mul(TAU);
        const flutter = sin(uTime.mul(0.52).add(phase));
        const drift = vec3(
            sin(uTime.mul(0.19).add(phase)).mul(0.20),
            abs(flutter).mul(0.055),
            sin(uTime.mul(0.15).sub(phase.mul(0.73))).mul(0.16),
        ).mul(uMotion);
        // Gentle tumble: each petal rocks slowly on the surface instead of
        // sitting frozen, and drifts along the shoreline lane.
        const wobble = sin(uTime.mul(0.4).add(phase)).mul(0.5);
        const cw = cos(wobble);
        const sw = sin(wobble);
        const tumbled = vec3(
            positionLocal.x.mul(cw).sub(positionLocal.z.mul(sw)),
            positionLocal.y,
            positionLocal.x.mul(sw).add(positionLocal.z.mul(cw)),
        );
        petalMaterial.positionNode = tumbled.add(drift);
        petalMaterial.colorNode = mix(
            vec3(0.96, 0.50, 0.64),
            vec3(1.0, 0.80, 0.86),
            hash(instanceIndex.add(17)),
        ).mul(float(0.90).add(uReaction.mul(0.16)));
        petalMaterial.opacityNode = float(0.54)
            .add(flutter.mul(0.10))
            .mul(float(1).add(uReaction.mul(0.12)))
            .clamp(0.28, 0.74);
        petalMaterial.forceSinglePass = true;
        petalMaterial.toneMapped = true;
        petalMaterial.fog = false;
    }
    const petals = add(new THREE.InstancedMesh(
        ownGeometry(makePetalGeometry()),
        petalMaterial,
        MAX_PETALS,
    ));
    PETAL_LAYOUT.forEach((entry, index) => {
        position.set(entry[0], 0.27 + (index % 3) * 0.008, entry[1]);
        quaternion.setFromEuler(euler.set(
            (index % 2 ? -1 : 1) * 0.08,
            entry[3],
            ((index % 3) - 1) * 0.06,
        ));
        scale.set(entry[2] * 0.70, 1, entry[2]);
        matrix.compose(position, quaternion, scale);
        petals.setMatrixAt(index, matrix);
    });
    markStaticInstances(petals);
    petals.renderOrder = 24;

    [ridge, trunks, crowns, pines, troll, mushroomStems, mushroomCaps]
        .forEach(enableReflectionLayer);
    forest.ready.then((live) => {
        if (live) forest.group.children.forEach(enableReflectionLayer);
    });

    let currentQuality = normalizeKoiPondQuality(quality);
    let currentLimits = QUALITY_LIMITS[currentQuality];
    let motionReduced = reducedMotion === true;
    let motionTime = 0;
    let motionInitialized = false;
    let effectIntensity = Math.max(0, Math.min(2, Number(intensity) || 0));
    let reactionEnergy = 0;
    let disposed = false;

    function applyLimits() {
        // The modelled grove carries its own composition and its own per-tier
        // density (it is two instanced draws at any count, so it can be far
        // denser than the procedural forest it replaced).
        forest.setTreeLimit(KOI_POND_GROVE_LIMITS[currentQuality] ?? 42);
        trunks.count = currentLimits.trees;
        crowns.count = currentLimits.trees * CROWNS_PER_TREE;
        pines.count = currentLimits.trees;
        branches.count = WILLOW_TENDRIL_COUNT
            + currentLimits.trees * BRANCHES_PER_TREE;
        grass.count = currentLimits.grass;
        mushroomStems.count = currentLimits.mushrooms;
        mushroomCaps.count = currentLimits.mushrooms;
        moteGeometry.setDrawRange(0, currentLimits.motes);
        petals.count = currentLimits.petals;
        petals.visible = currentLimits.petals > 0;
        spirit.visible = currentLimits.spirit;
        spiritGlow.visible = currentLimits.spirit;
    }
    applyLimits();

    function pulse(kind, payload = {}) {
        if (disposed || effectIntensity <= 0) return;
        const normalized = String(kind || '').replace(/[_:-]/g, '').toLowerCase();
        let strength = 0.12;
        if (normalized === 'lineclear') {
            strength = Math.min(0.72, 0.20 + Math.max(1, Number(payload.lineCount) || 1) * 0.12);
        } else if (normalized === 'combo') {
            strength = Math.min(1, 0.24 + Math.max(0, Number(payload.comboCount) || 0) * 0.075);
        } else if (normalized === 'tspin') {
            strength = 0.82;
        } else if (normalized === 'perfectclear') {
            strength = 1;
        } else if (normalized === 'b2b') {
            strength = payload.active === false ? 0.18 : 0.56;
        }
        reactionEnergy = Math.max(
            reactionEnergy,
            strength * effectIntensity * (motionReduced ? 0.45 : 1),
        );
    }

    const debugApi = Object.freeze({
        getDiagnostics() {
            return {
                quality: currentQuality,
                limits: { ...currentLimits },
                reducedMotion: motionReduced,
                motionScale: motionReduced ? REDUCED_MOTION_TIME_SCALE : 1,
                intensity: effectIntensity,
                reactionEnergy,
                grove: { live: groveLive, ...forest.getDiagnostics() },
                draws: {
                    sky: 1,
                    moonGlow: 1,
                    ridge: 1,
                    mist: 1,
                    trees: groveLive ? 0 : 3,
                    grass: currentLimits.grass > 0 ? 1 : 0,
                    troll: 3,
                    spirit: currentLimits.spirit ? 3 : 0,
                    mushrooms: 2,
                    motes: currentLimits.motes > 0 ? 1 : 0,
                    petals: currentLimits.petals > 0 ? 1 : 0,
                },
            };
        },
    });

    const api = {
        pulse,
        setQuality(value) {
            const next = normalizeKoiPondQuality(value);
            if (next === currentQuality) return;
            currentQuality = next;
            currentLimits = QUALITY_LIMITS[next];
            applyLimits();
        },
        setReducedMotion(enabled) {
            motionReduced = enabled === true;
            uMotion.value = motionReduced ? 0 : 1;
        },
        setIntensity(value) {
            effectIntensity = Math.max(0, Math.min(2, Number(value) || 0));
        },
        update(time, delta = 1 / 60) {
            if (disposed) return;
            const safeTime = Number.isFinite(time) ? time : 0;
            const safeDelta = Number.isFinite(delta)
                ? Math.max(0, Math.min(delta, 0.1))
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
            reactionEnergy = Math.max(
                0,
                reactionEnergy - safeDelta * (motionReduced ? 1.8 : 0.52),
            );
            uReaction.value = reactionEnergy;

            if (currentLimits.spirit) {
                if (motionReduced) {
                    // Calm anchor over the back-right of the pond when motion is off.
                    spirit.position.set(9, 5, -12);
                    spirit.rotation.y = 0.5;
                    spiritRibbon.rotation.z = 0;
                    spiritVeils.rotation.z = 0;
                } else {
                    // A smooth wandering orbit around the pond, biased to the
                    // back/sides so the spirit never lingers over the board
                    // column. Sampled via a path fn so we can look slightly ahead
                    // and turn the head into the direction of travel, then bank
                    // into the curve — reads as a fluid, floating swim.
                    const path = (tt) => {
                        const ang = tt * 0.085;
                        const rMod = 1 + Math.sin(tt * 0.13 + 1) * 0.12;
                        return {
                            x: Math.cos(ang) * 11 * rMod + Math.sin(tt * 0.21) * 1.3,
                            y: 5 + Math.sin(tt * 0.33) * 0.5 + Math.sin(tt * 0.11 + 0.7) * 0.45,
                            z: -10 + Math.sin(ang) * 6 * rMod + Math.cos(tt * 0.17) * 0.9,
                        };
                    };
                    const here = path(motionTime);
                    const ahead = path(motionTime + 0.25);
                    const behind = path(motionTime - 0.25);
                    spirit.position.set(here.x, here.y, here.z);
                    const yaw = Math.atan2(ahead.x - here.x, ahead.z - here.z);
                    spirit.rotation.y = yaw;
                    const yawBehind = Math.atan2(here.x - behind.x, here.z - behind.z);
                    let dyaw = yaw - yawBehind;
                    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
                    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
                    const bank = Math.max(-0.32, Math.min(0.32, dyaw * -3.2));
                    spiritRibbon.rotation.z = bank;
                    spiritVeils.rotation.z = bank;
                }
            }
        },
        getDiagnostics: debugApi.getDiagnostics,
        getActiveParticleCount() {
            return currentLimits.motes + currentLimits.petals;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            forest.dispose();
            scene.remove(root);
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            root.clear();
        },
    };
    // Keep construction failure-atomic: no partially-authored landscape becomes
    // reachable by the scene until all node graphs and fixed buffers exist.
    scene.add(root);
    return api;
}

export default createKoiPondLandscape;
