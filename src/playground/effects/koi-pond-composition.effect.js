/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, camelcase */
/**
 * Koi Pond v2 — Moonwake Sanctuary composition study.
 *
 * This first playground slice proves the hierarchy before production assets:
 * quiet gameplay-safe water, asymmetrical near/mid/far shore layers, koi as the
 * motion hero, a Kittelsen-like troll silhouette as grounded witness, and a
 * restrained spirit/mushroom light story. Everything is seeded and generated
 * locally so fixed-time captures remain phase-locked.
 *
 *   ?effect=koi-pond-composition&orbit=0&t=12
 *   ?effect=koi-pond-composition&orbit=0&t=12&forceWebGL=1
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    cameraPosition,
    clamp,
    dot,
    float,
    hash,
    instanceIndex,
    length,
    mix,
    mx_fractal_noise_float,
    mx_noise_float,
    mx_worley_noise_float,
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

export const meta = {
    id: 'koi-pond-composition',
    title: 'Koi Pond v2 — Moonwake Sanctuary',
    description: 'Deterministic nocturnal pond composition with koi, troll, spirit, and living shore light.',
};

const TAU = Math.PI * 2;

const TREE_LAYOUT = [
    [-78, -13, 1.24, -0.12], [-72, -43, 1.54, 0.08], [-64, -76, 1.18, -0.06],
    [-48, -104, 0.86, 0.07], [-24, -122, 1.02, -0.03], [5, -129, 0.78, 0.06],
    [35, -122, 0.94, -0.05], [59, -100, 1.12, 0.08], [73, -72, 1.32, -0.08],
    [79, -37, 1.50, 0.05], [76, -4, 1.16, -0.04], [-83, 16, 1.28, 0.05],
];

const PAD_LAYOUT = [
    [-48, 9, 3.6, 0.2], [-35, -2, 2.7, -0.5], [-51, -23, 3.1, 0.7],
    [-39, -44, 2.2, -0.2], [45, 5, 3.0, 0.4], [51, -17, 2.4, -0.7],
    [43, -38, 3.5, 0.15], [29, -55, 2.2, 0.8], [-24, -63, 2.6, -0.4],
    [20, 15, 2.0, 0.1],
];

const MUSHROOM_LAYOUT = [
    [48, 0.4, -51, 1.20], [52, 0.2, -47, 0.82], [55, 0.5, -55, 1.02],
    [60, 0.3, -50, 0.72], [64, 0.4, -58, 0.94], [68, 0.2, -53, 0.68],
    [-55, 0.3, -58, 0.86], [-59, 0.2, -54, 0.66], [-62, 0.4, -63, 0.92],
    [-35, 0.3, -96, 0.76], [27, 0.2, -101, 0.68], [32, 0.3, -98, 0.88],
];

const FISH = [
    {
        cx: -12, cz: -15, rx: 23, rz: 12, phase: 0.15, speed: 0.095, scale: 1.15,
    },
    {
        cx: 13, cz: -30, rx: 28, rz: 15, phase: 2.25, speed: -0.075, scale: 0.94,
    },
    {
        cx: -7, cz: -43, rx: 34, rz: 17, phase: 4.10, speed: 0.058, scale: 1.05,
    },
    {
        cx: 8, cz: 0, rx: 31, rz: 14, phase: 5.20, speed: -0.066, scale: 0.82,
    },
    {
        cx: -4, cz: -25, rx: 18, rz: 31, phase: 3.10, speed: 0.052, scale: 0.88,
    },
    {
        cx: 3, cz: -34, rx: 41, rz: 24, phase: 1.42, speed: -0.043, scale: 0.76,
    },
];

function makeRng(seed) {
    let state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function makeTailGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0.65,
        -1.15, 0, -1.25,
        1.15, 0, -1.25,
    ], 3));
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    return geometry;
}

function makeRidgeGeometry() {
    const profile = [
        [-150, 8], [-128, 16], [-104, 12], [-82, 24], [-58, 15], [-34, 20],
        [-8, 11], [18, 19], [42, 14], [67, 25], [94, 13], [120, 18], [150, 9],
    ];
    const positions = [];
    for (let index = 0; index < profile.length - 1; index += 1) {
        const [x0, h0] = profile[index];
        const [x1, h1] = profile[index + 1];
        positions.push(x0, -4, 0, x1, -4, 0, x1, h1, 0);
        positions.push(x0, -4, 0, x1, h1, 0, x0, h0, 0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function createGlowMaterial(colorValue, uTime, phase = 0) {
    const material = new THREE.SpriteNodeMaterial();
    const centered = uv().sub(vec2(0.5, 0.5)).mul(2);
    const falloff = smoothstep(0.08, 1.0, length(centered)).oneMinus();
    const breath = sin(uTime.mul(0.72).add(phase)).mul(0.08).add(0.92);
    material.colorNode = vec3(colorValue.r, colorValue.g, colorValue.b).mul(1.7).mul(breath);
    material.opacityNode = pow(falloff, float(2.1)).mul(0.46).mul(breath);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.toneMapped = false;
    return material;
}

export function create({ scene, camera, renderer }) {
    const root = new THREE.Group();
    const resources = new Set();
    const ownedMaterials = new Set();
    const addResource = (resource) => {
        resources.add(resource);
        return resource;
    };
    const addMaterial = (material) => {
        ownedMaterials.add(material);
        return material;
    };
    const add = (object) => {
        root.add(object);
        return object;
    };

    scene.add(root);
    const previousBackground = scene.background;
    const previousFog = scene.fog;
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    const previousCamera = {
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };
    scene.background = new THREE.Color(0x030b11);
    scene.fog = new THREE.FogExp2(0x07131a, 0.0055);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;

    const uTime = uniform(0);

    // Sky: colored near-black overhead, jade horizon, restrained moon wake.
    const skyMaterial = addMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const direction = normalize(positionLocal);
        const height = smoothstep(-0.18, 0.72, direction.y);
        const horizon = pow(
            smoothstep(0.0, 0.40, abs(direction.y.add(0.03))).oneMinus(),
            float(2.2),
        );
        const skyBase = mix(vec3(0.004, 0.022, 0.026), vec3(0.002, 0.004, 0.012), height);
        skyMaterial.colorNode = skyBase.add(vec3(0.022, 0.070, 0.062).mul(horizon));
        skyMaterial.side = THREE.BackSide;
        skyMaterial.depthWrite = false;
        skyMaterial.fog = false;
    }
    const sky = add(new THREE.Mesh(
        addResource(new THREE.SphereGeometry(420, 48, 24)),
        skyMaterial,
    ));
    sky.frustumCulled = false;

    const moonMaterial = addMaterial(new THREE.MeshBasicNodeMaterial());
    moonMaterial.colorNode = vec3(1.55, 1.72, 1.50);
    moonMaterial.fog = false;
    moonMaterial.toneMapped = true;
    const moon = add(new THREE.Mesh(addResource(new THREE.SphereGeometry(5.6, 32, 16)), moonMaterial));
    moon.position.set(-48, 52, -170);

    const moonGlowMaterial = addMaterial(createGlowMaterial(new THREE.Color(0x9be7d5), uTime, 0.7));
    const moonGlow = add(new THREE.Sprite(moonGlowMaterial));
    moonGlow.position.copy(moon.position);
    moonGlow.scale.set(27, 27, 1);

    const ridgeMaterial = addMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const ridgeNoise = mx_noise_float(positionWorld.mul(0.022)).mul(0.5).add(0.5);
        ridgeMaterial.colorNode = mix(vec3(0.004, 0.014, 0.017), vec3(0.009, 0.032, 0.028), ridgeNoise);
        ridgeMaterial.fog = true;
    }
    const ridge = add(new THREE.Mesh(addResource(makeRidgeGeometry()), ridgeMaterial));
    ridge.position.set(0, 0, -151);

    // Ground under the water supplies dark depth and an authored, mossy color floor.
    const groundMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const groundNoise = mx_fractal_noise_float(positionWorld.mul(0.035), 3, 2.0, 0.5, 1.0)
            .mul(0.5).add(0.5);
        groundMaterial.colorNode = mix(vec3(0.008, 0.022, 0.018), vec3(0.026, 0.070, 0.042), groundNoise);
        groundMaterial.roughnessNode = float(0.96);
        groundMaterial.metalnessNode = float(0);
    }
    const ground = add(new THREE.Mesh(addResource(new THREE.PlaneGeometry(270, 245)), groundMaterial));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.72, -35);

    // The pond is intentionally simple in this slice: procedural TSL language,
    // shallow-edge caustics, a moon path, and enough geometry for gentle displacement.
    const waterMaterial = addMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const ellipse = positionGeometry.x.div(85).pow(2).add(positionGeometry.y.div(54).pow(2));
        const edge = smoothstep(0.64, 1.0, ellipse);
        const pondMask = smoothstep(0.95, 1.025, ellipse).oneMinus();
        const coord = positionWorld.xz.mul(0.037);
        const warp = mx_noise_float(vec3(coord.x, coord.y, uTime.mul(0.032))).mul(0.42);
        const broad = mx_fractal_noise_float(
            vec3(coord.x.add(warp), coord.y.sub(warp.mul(0.7)), uTime.mul(0.018)),
            3,
            2.0,
            0.52,
            1.0,
        ).mul(0.5).add(0.5);
        const cells = mx_worley_noise_float(coord.mul(7.0).add(vec2(uTime.mul(0.025), uTime.mul(-0.017))), 0.82);
        const caustic = pow(clamp(float(1).sub(cells), 0, 1), float(5.5)).mul(edge);
        const viewDirection = normalize(cameraPosition.sub(positionWorld));
        const grazing = pow(clamp(float(1).sub(abs(viewDirection.y)), 0, 1), float(2.4));
        const body = mix(vec3(0.008, 0.050, 0.052), vec3(0.020, 0.105, 0.100), broad.mul(0.52));
        const reflectedCanopy = vec3(0.016, 0.095, 0.075).mul(grazing.mul(0.65));
        const wakeAxis = positionWorld.z.add(100).mul(0.24).sub(48);
        const moonDistance = abs(positionWorld.x.sub(wakeAxis.add(sin(uTime.mul(0.06)).mul(1.3))));
        const orderedMoonPath = smoothstep(0.7, 8.5, moonDistance).oneMinus();
        const wakeBandA = abs(sin(positionWorld.z.mul(0.43).add(warp.mul(4.0))));
        const wakeBandB = abs(sin(positionWorld.z.mul(0.17).add(positionWorld.x.mul(0.08)).sub(warp.mul(2.3))));
        const moonBreakup = pow(wakeBandA.mul(wakeBandB), float(6.0));
        const moonWake = orderedMoonPath.mul(moonBreakup).mul(smoothstep(-70, 16, positionWorld.z));
        waterMaterial.colorNode = body
            .add(reflectedCanopy)
            .add(vec3(0.10, 0.54, 0.46).mul(caustic).mul(0.22))
            .add(vec3(0.44, 0.82, 0.68).mul(moonWake).mul(0.24));
        waterMaterial.opacityNode = pondMask.mul(float(0.91).sub(edge.mul(0.08)));
        waterMaterial.positionNode = positionLocal.add(vec3(
            0,
            0,
            sin(positionLocal.x.mul(0.11).add(uTime.mul(0.42)))
                .add(sin(positionLocal.y.mul(0.15).sub(uTime.mul(0.31))))
                .mul(0.055),
        ));
        waterMaterial.transparent = true;
        waterMaterial.depthWrite = false;
        waterMaterial.alphaTestNode = float(0.02);
        waterMaterial.side = THREE.DoubleSide;
        waterMaterial.toneMapped = true;
    }
    const water = add(new THREE.Mesh(
        addResource(new THREE.PlaneGeometry(170, 108, 72, 48)),
        waterMaterial,
    ));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.12, -20);
    water.renderOrder = 4;

    // Low shore shelves make the pond feel enclosed without filling the central water.
    const shoreGeometry = addResource(new THREE.CylinderGeometry(1, 1.16, 1, 18, 3));
    const shoreMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const n = normalize(normalWorld);
        const top = smoothstep(0.50, 0.86, n.y);
        const light = clamp(dot(n, normalize(vec3(-0.38, 0.78, 0.48))), 0, 1);
        const mossNoise = mx_noise_float(positionWorld.mul(0.11)).mul(0.5).add(0.5);
        shoreMaterial.colorNode = mix(vec3(0.025, 0.032, 0.030), vec3(0.065, 0.145, 0.080), top.mul(mossNoise))
            .add(vec3(0.10, 0.16, 0.11).mul(light).mul(0.25));
        shoreMaterial.roughnessNode = float(0.92);
    }
    const shoreShelves = add(new THREE.InstancedMesh(shoreGeometry, shoreMaterial, 6));
    const shelfLayout = [
        [-67, 0, -22, 19, 2.8, 27, 0.15], [-64, 0, -72, 27, 4.2, 17, -0.12],
        [-23, 0, -105, 35, 4.8, 14, 0.08], [30, 0, -111, 33, 4.3, 15, -0.04],
        [65, 0, -75, 25, 4.0, 18, 0.14], [68, 0, -20, 18, 3.2, 28, -0.10],
    ];
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    shelfLayout.forEach((entry, index) => {
        position.set(entry[0], entry[1], entry[2]);
        euler.set(0, entry[6], 0);
        quaternion.setFromEuler(euler);
        scale.set(entry[3], entry[4], entry[5]);
        matrix.compose(position, quaternion, scale);
        shoreShelves.setMatrixAt(index, matrix);
    });
    shoreShelves.instanceMatrix.needsUpdate = true;
    shoreShelves.computeBoundingSphere();

    // Trees are two bounded instanced draws. Canopy clusters are deliberately
    // uneven so their silhouettes frame the pond instead of forming a wallpaper.
    const trunkGeometry = addResource(new THREE.CylinderGeometry(0.48, 0.82, 1, 8, 4));
    const trunkMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const bark = mx_noise_float(positionWorld.mul(vec3(0.18, 0.055, 0.18))).mul(0.5).add(0.5);
        trunkMaterial.colorNode = mix(vec3(0.035, 0.027, 0.023), vec3(0.105, 0.070, 0.044), bark);
        trunkMaterial.roughnessNode = float(0.98);
    }
    const trunks = add(new THREE.InstancedMesh(trunkGeometry, trunkMaterial, TREE_LAYOUT.length));
    TREE_LAYOUT.forEach((tree, index) => {
        const height = 18 * tree[2];
        position.set(tree[0], height * 0.5 - 0.2, tree[1]);
        euler.set(tree[3] * 0.18, tree[3], tree[3] * 0.34);
        quaternion.setFromEuler(euler);
        scale.set(1.65 * tree[2], height, 1.65 * tree[2]);
        matrix.compose(position, quaternion, scale);
        trunks.setMatrixAt(index, matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    trunks.computeBoundingSphere();

    const canopyGeometry = addResource(new THREE.IcosahedronGeometry(1, 1));
    const canopyMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const variation = hash(instanceIndex).mul(0.52);
        const canopyNoise = mx_noise_float(positionWorld.mul(0.09)).mul(0.5).add(0.5);
        const hemi = normalWorld.y.mul(0.5).add(0.5);
        const darkLeaf = mix(vec3(0.006, 0.026, 0.022), vec3(0.012, 0.052, 0.034), variation);
        canopyMaterial.colorNode = mix(darkLeaf, vec3(0.030, 0.100, 0.060), hemi.mul(canopyNoise).mul(0.52));
        canopyMaterial.roughnessNode = float(0.94);
    }
    const willowCrowns = [
        [-76, 23, -16, 9.0, 4.0, 6.2], [-64, 27, -25, 8.0, 3.7, 5.7],
        [-51, 29, -35, 7.3, 3.4, 5.2], [-39, 28, -45, 6.5, 3.0, 4.8],
        [-28, 25, -54, 5.8, 2.7, 4.2],
    ];
    const canopyCount = TREE_LAYOUT.length * 3 + willowCrowns.length;
    const canopies = add(new THREE.InstancedMesh(canopyGeometry, canopyMaterial, canopyCount));
    const treeRng = makeRng(22441);
    let canopyIndex = 0;
    TREE_LAYOUT.forEach((tree) => {
        const height = 18 * tree[2];
        for (let layer = 0; layer < 3; layer += 1) {
            const layerScale = (7.8 - layer * 1.0) * tree[2];
            position.set(
                tree[0] + (treeRng() - 0.5) * 7.0,
                height - 1.5 + (layer - 1) * 2.2,
                tree[1] + (treeRng() - 0.5) * 5.2,
            );
            euler.set(treeRng() * 0.3, treeRng() * TAU, treeRng() * 0.2);
            quaternion.setFromEuler(euler);
            scale.set(layerScale * 1.2, layerScale * 0.72, layerScale);
            matrix.compose(position, quaternion, scale);
            canopies.setMatrixAt(canopyIndex, matrix);
            canopyIndex += 1;
        }
    });
    willowCrowns.forEach((crown) => {
        position.set(crown[0], crown[1], crown[2]);
        euler.set(-0.08, crown[0] * 0.017, 0.12);
        quaternion.setFromEuler(euler);
        scale.set(crown[3], crown[4], crown[5]);
        matrix.compose(position, quaternion, scale);
        canopies.setMatrixAt(canopyIndex, matrix);
        canopyIndex += 1;
    });
    canopies.instanceMatrix.needsUpdate = true;
    canopies.computeBoundingSphere();

    const branchSegments = [];
    TREE_LAYOUT.forEach((tree, index) => {
        const height = 18 * tree[2];
        const side = index % 2 === 0 ? -1 : 1;
        branchSegments.push([
            [tree[0], height * 0.67, tree[1]],
            [tree[0] + side * 5.0 * tree[2], height * 0.84, tree[1] + 2.8],
            0.42 * tree[2],
        ]);
        branchSegments.push([
            [tree[0], height * 0.75, tree[1]],
            [tree[0] - side * 3.8 * tree[2], height * 0.91, tree[1] - 1.8],
            0.34 * tree[2],
        ]);
    });
    const willowPath = [
        [-84, 18, -8], [-75, 23, -16], [-63, 27, -26],
        [-50, 29, -36], [-37, 28, -46], [-25, 24, -55],
    ];
    for (let index = 0; index < willowPath.length - 1; index += 1) {
        branchSegments.push([willowPath[index], willowPath[index + 1], 0.72 - index * 0.08]);
    }
    const branchGeometry = addResource(new THREE.CylinderGeometry(1, 1, 1, 7, 1));
    const branches = add(new THREE.InstancedMesh(branchGeometry, trunkMaterial, branchSegments.length));
    const branchStart = new THREE.Vector3();
    const branchEnd = new THREE.Vector3();
    const branchDirection = new THREE.Vector3();
    const branchUp = new THREE.Vector3(0, 1, 0);
    branchSegments.forEach((segment, index) => {
        branchStart.fromArray(segment[0]);
        branchEnd.fromArray(segment[1]);
        branchDirection.subVectors(branchEnd, branchStart);
        position.addVectors(branchStart, branchEnd).multiplyScalar(0.5);
        quaternion.setFromUnitVectors(branchUp, branchDirection.clone().normalize());
        scale.set(segment[2], branchDirection.length(), segment[2]);
        matrix.compose(position, quaternion, scale);
        branches.setMatrixAt(index, matrix);
    });
    branches.instanceMatrix.needsUpdate = true;
    branches.computeBoundingSphere();

    // Lily pads stay at the margins; central water remains a calm gameplay sanctuary.
    const padGeometry = addResource(new THREE.CircleGeometry(1, 28));
    padGeometry.rotateX(-Math.PI / 2);
    const padMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const radial = length(positionGeometry.xz);
        const vein = pow(abs(sin(positionGeometry.x.mul(8).add(positionGeometry.z.mul(5)))), float(12));
        padMaterial.colorNode = mix(vec3(0.035, 0.13, 0.072), vec3(0.085, 0.24, 0.115), radial.oneMinus())
            .add(vec3(0.14, 0.25, 0.09).mul(vein).mul(0.045));
        padMaterial.roughnessNode = float(0.72);
    }
    const pads = add(new THREE.InstancedMesh(padGeometry, padMaterial, PAD_LAYOUT.length));
    PAD_LAYOUT.forEach((pad, index) => {
        position.set(pad[0], 0.28, pad[1]);
        euler.set(0, pad[3], 0);
        quaternion.setFromEuler(euler);
        scale.set(pad[2] * 1.12, pad[2], pad[2]);
        matrix.compose(position, quaternion, scale);
        pads.setMatrixAt(index, matrix);
    });
    pads.instanceMatrix.needsUpdate = true;
    pads.computeBoundingSphere();

    // Koi use two instanced draws and CPU spline motion. Tangent-derived yaw avoids
    // the sideways skating of the legacy DOM fish; all scratch objects are reused.
    const fishGeometry = addResource(new THREE.SphereGeometry(1, 22, 12));
    const fishMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const phase = hash(instanceIndex).mul(5.7);
        const brokenBand = sin(positionGeometry.z.mul(5.2).add(positionGeometry.x.mul(3.1)).add(phase))
            .mul(0.5).add(0.5);
        const vermilion = smoothstep(0.48, 0.73, brokenBand);
        const sumiNoise = sin(positionGeometry.z.mul(8.4).sub(positionGeometry.x.mul(5.1)).add(phase.mul(1.7)))
            .mul(0.5).add(0.5);
        const sumi = smoothstep(0.79, 0.94, sumiNoise).mul(hash(instanceIndex.add(19)).mul(0.7));
        const porcelain = vec3(0.82, 0.79, 0.64);
        const orange = vec3(0.92, 0.16, 0.035);
        fishMaterial.colorNode = mix(mix(porcelain, orange, vermilion), vec3(0.018, 0.022, 0.020), sumi);
        fishMaterial.emissiveNode = mix(vec3(0.015, 0.025, 0.018), vec3(0.10, 0.018, 0.004), vermilion);
        fishMaterial.roughnessNode = float(0.38);
        fishMaterial.metalnessNode = float(0.02);
    }
    const fishBodies = add(new THREE.InstancedMesh(fishGeometry, fishMaterial, FISH.length));
    fishBodies.renderOrder = 2;
    const tailGeometry = addResource(makeTailGeometry());
    const tailMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    tailMaterial.colorNode = mix(
        vec3(0.74, 0.70, 0.56),
        vec3(0.82, 0.12, 0.025),
        smoothstep(0.38, 0.72, sin(positionGeometry.x.mul(3.0).add(hash(instanceIndex).mul(4.0))).mul(0.5).add(0.5)),
    );
    tailMaterial.roughnessNode = float(0.46);
    tailMaterial.side = THREE.DoubleSide;
    const fishTails = add(new THREE.InstancedMesh(tailGeometry, tailMaterial, FISH.length));
    fishTails.renderOrder = 2;

    const updateFish = (time) => {
        FISH.forEach((fish, index) => {
            const angle = fish.phase + time * fish.speed;
            const x = fish.cx + Math.cos(angle) * fish.rx;
            const z = fish.cz + Math.sin(angle) * fish.rz;
            const dx = -Math.sin(angle) * fish.rx * fish.speed;
            const dz = Math.cos(angle) * fish.rz * fish.speed;
            const invLength = 1 / Math.max(0.0001, Math.hypot(dx, dz));
            const dirX = dx * invLength;
            const dirZ = dz * invLength;
            const yaw = Math.atan2(dirX, dirZ);
            const bob = Math.sin(time * 1.1 + fish.phase) * 0.035;

            position.set(x, 0.015 + bob, z);
            euler.set(0, yaw, Math.sin(time * 0.8 + fish.phase) * 0.025);
            quaternion.setFromEuler(euler);
            scale.set(1.25 * fish.scale, 0.38 * fish.scale, 3.15 * fish.scale);
            matrix.compose(position, quaternion, scale);
            fishBodies.setMatrixAt(index, matrix);

            const tailWag = Math.sin(time * 3.0 + fish.phase * 2.0) * 0.34;
            position.set(
                x - dirX * 3.0 * fish.scale,
                0.02 + bob,
                z - dirZ * 3.0 * fish.scale,
            );
            euler.set(0, yaw + tailWag, 0);
            quaternion.setFromEuler(euler);
            scale.set(1.0 * fish.scale, 1.0, 1.1 * fish.scale);
            matrix.compose(position, quaternion, scale);
            fishTails.setMatrixAt(index, matrix);
        });
        fishBodies.instanceMatrix.needsUpdate = true;
        fishTails.instanceMatrix.needsUpdate = true;
    };
    updateFish(0);

    // A single mist sheet separates the far bank without flattening the whole frame.
    const mistMaterial = addMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const vertical = smoothstep(0.02, 0.38, uv().y)
            .mul(smoothstep(0.58, 0.98, uv().y).oneMinus());
        const horizontal = smoothstep(0.0, 0.12, uv().x)
            .mul(smoothstep(0.88, 1.0, uv().x).oneMinus());
        const drift = mx_noise_float(vec3(positionWorld.x.mul(0.026), uTime.mul(0.022), 0))
            .mul(0.5).add(0.5);
        mistMaterial.colorNode = vec3(0.11, 0.27, 0.23);
        mistMaterial.opacityNode = vertical.mul(horizontal).mul(drift.mul(0.06).add(0.045));
        mistMaterial.transparent = true;
        mistMaterial.depthWrite = false;
        mistMaterial.fog = false;
        mistMaterial.toneMapped = true;
    }
    const mist = add(new THREE.Mesh(addResource(new THREE.PlaneGeometry(190, 22)), mistMaterial));
    mist.position.set(0, 7.5, -113);

    // The troll is an environmental silhouette: rock, root, and creature at once.
    const troll = add(new THREE.Group());
    troll.position.set(-38, 1.0, -79);
    troll.rotation.y = 0.18;
    troll.scale.setScalar(1.16);
    const trollMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const moss = mx_noise_float(positionWorld.mul(0.19)).mul(0.5).add(0.5);
        const facing = clamp(dot(normalize(normalWorld), normalize(vec3(-0.25, 0.65, 0.70))), 0, 1);
        trollMaterial.colorNode = mix(vec3(0.025, 0.031, 0.028), vec3(0.085, 0.125, 0.060), moss.mul(0.52))
            .add(vec3(0.08, 0.11, 0.07).mul(facing).mul(0.22));
        trollMaterial.roughnessNode = float(1.0);
    }
    const trollRockGeometry = addResource(new THREE.IcosahedronGeometry(1, 2));
    const trollMasses = new THREE.InstancedMesh(trollRockGeometry, trollMaterial, 2);
    position.set(0, 6.2, 0);
    quaternion.identity();
    scale.set(5.2, 7.2, 4.2);
    matrix.compose(position, quaternion, scale);
    trollMasses.setMatrixAt(0, matrix);
    position.set(0.5, 12.2, 0.45);
    scale.set(3.7, 3.2, 3.4);
    matrix.compose(position, quaternion, scale);
    trollMasses.setMatrixAt(1, matrix);
    trollMasses.instanceMatrix.needsUpdate = true;
    trollMasses.computeBoundingSphere();
    troll.add(trollMasses);
    const limbGeometry = addResource(new THREE.CylinderGeometry(0.55, 0.9, 1, 7));
    const trollArms = new THREE.InstancedMesh(limbGeometry, trollMaterial, 2);
    [-1, 1].forEach((side, index) => {
        position.set(side * 5.0, 6.3, 0.3);
        euler.set(0, 0, side * -0.48);
        quaternion.setFromEuler(euler);
        scale.set(1.0, 8.3, 1.0);
        matrix.compose(position, quaternion, scale);
        trollArms.setMatrixAt(index, matrix);
    });
    trollArms.instanceMatrix.needsUpdate = true;
    trollArms.computeBoundingSphere();
    troll.add(trollArms);
    const browGeometry = addResource(new THREE.ConeGeometry(0.9, 4.8, 5));
    const trollRoots = new THREE.InstancedMesh(browGeometry, trollMaterial, 2);
    [-1, 1].forEach((side, index) => {
        position.set(side * 2.0, 15.4, 0.15);
        euler.set(0, 0, side * -0.56);
        quaternion.setFromEuler(euler);
        scale.set(1, 1, 1);
        matrix.compose(position, quaternion, scale);
        trollRoots.setMatrixAt(index, matrix);
    });
    trollRoots.instanceMatrix.needsUpdate = true;
    trollRoots.computeBoundingSphere();
    troll.add(trollRoots);
    const eyeMaterial = addMaterial(new THREE.MeshBasicNodeMaterial());
    eyeMaterial.colorNode = vec3(1.15, 0.30, 0.035).mul(sin(uTime.mul(0.55)).mul(0.06).add(0.88));
    eyeMaterial.toneMapped = true;
    const eyeGeometry = addResource(new THREE.SphereGeometry(0.20, 10, 6));
    const trollEyes = new THREE.InstancedMesh(eyeGeometry, eyeMaterial, 2);
    [-1, 1].forEach((side, index) => {
        position.set(side * 0.9 + 0.45, 12.7, 3.2);
        quaternion.identity();
        scale.set(1, 1, 1);
        matrix.compose(position, quaternion, scale);
        trollEyes.setMatrixAt(index, matrix);
    });
    trollEyes.instanceMatrix.needsUpdate = true;
    trollEyes.computeBoundingSphere();
    troll.add(trollEyes);

    // Spirit: one restrained counterpoint to the troll, not a screen-wide VFX layer.
    const spirit = add(new THREE.Group());
    spirit.position.set(42, 5.8, -72);
    const spiritMaterial = addMaterial(new THREE.MeshBasicNodeMaterial());
    const spiritNoise = mx_noise_float(positionLocal.mul(2.8).add(vec3(0, uTime.mul(-0.24), 0))).mul(0.5).add(0.5);
    spiritMaterial.colorNode = mix(vec3(0.06, 0.36, 0.31), vec3(0.24, 0.12, 0.58), spiritNoise).mul(0.92);
    spiritMaterial.transparent = true;
    spiritMaterial.opacityNode = float(0.68);
    spiritMaterial.depthWrite = false;
    spiritMaterial.blending = THREE.AdditiveBlending;
    spiritMaterial.toneMapped = true;
    const spiritCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.0, 0.0, 0.0),
        new THREE.Vector3(0.7, 1.25, 0.2),
        new THREE.Vector3(-0.55, 2.6, 0.38),
        new THREE.Vector3(0.48, 3.9, -0.18),
        new THREE.Vector3(-0.22, 5.05, -0.28),
        new THREE.Vector3(0.0, 6.2, 0.0),
    ]);
    const spiritGeometry = addResource(new THREE.TubeGeometry(spiritCurve, 42, 0.42, 8, false));
    const spiritRibbon = new THREE.Mesh(spiritGeometry, spiritMaterial);
    spirit.add(spiritRibbon);
    const updateSpirit = (time) => {
        spiritRibbon.rotation.y = time * 0.16;
        spiritRibbon.rotation.z = Math.sin(time * 0.31) * 0.08;
        spiritRibbon.scale.set(
            1 + Math.sin(time * 0.43) * 0.04,
            1 + Math.sin(time * 0.37 + 0.8) * 0.035,
            1 + Math.sin(time * 0.43) * 0.04,
        );
    };
    updateSpirit(0);
    const spiritGlowMaterial = addMaterial(createGlowMaterial(new THREE.Color(0x8c7de8), uTime, 2.1));
    const spiritGlow = add(new THREE.Sprite(spiritGlowMaterial));
    spiritGlow.position.set(42, 8.4, -72);
    spiritGlow.scale.set(18, 18, 1);
    const spiritLight = add(new THREE.PointLight(0x807ee8, 15, 38, 2.0));
    spiritLight.position.set(42, 7.5, -70);

    // Real fungal bioluminescence is yellow-green; violet remains reserved for the spirit.
    const stemGeometry = addResource(new THREE.CylinderGeometry(0.22, 0.32, 1, 8));
    const stemMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    stemMaterial.colorNode = vec3(0.18, 0.24, 0.16);
    stemMaterial.roughnessNode = float(0.88);
    const stems = add(new THREE.InstancedMesh(stemGeometry, stemMaterial, MUSHROOM_LAYOUT.length));
    const capGeometry = addResource(new THREE.SphereGeometry(1, 14, 7, 0, TAU, 0, Math.PI * 0.52));
    const capMaterial = addMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const pulse = sin(uTime.mul(0.48).add(hash(instanceIndex).mul(TAU))).mul(0.08).add(0.92);
        const gill = smoothstep(0.18, 0.78, positionGeometry.y).oneMinus();
        capMaterial.colorNode = mix(vec3(0.10, 0.18, 0.095), vec3(0.34, 0.62, 0.20), gill.mul(0.55));
        capMaterial.emissiveNode = vec3(0.18, 0.92, 0.28).mul(gill.mul(0.82).add(0.12)).mul(pulse);
        capMaterial.roughnessNode = float(0.68);
    }
    const caps = add(new THREE.InstancedMesh(capGeometry, capMaterial, MUSHROOM_LAYOUT.length));
    MUSHROOM_LAYOUT.forEach((mushroom, index) => {
        const height = 2.4 * mushroom[3];
        position.set(mushroom[0], mushroom[1] + height * 0.5, mushroom[2]);
        euler.set(0, index * 0.73, ((index % 3) - 1) * 0.08);
        quaternion.setFromEuler(euler);
        scale.set(mushroom[3], height, mushroom[3]);
        matrix.compose(position, quaternion, scale);
        stems.setMatrixAt(index, matrix);

        position.set(mushroom[0], mushroom[1] + height, mushroom[2]);
        euler.set(0, index * 0.73, 0);
        quaternion.setFromEuler(euler);
        scale.set(1.25 * mushroom[3], 0.62 * mushroom[3], 1.25 * mushroom[3]);
        matrix.compose(position, quaternion, scale);
        caps.setMatrixAt(index, matrix);
    });
    stems.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    stems.computeBoundingSphere();
    caps.computeBoundingSphere();

    // Sparse fireflies provide scale and depth without additive overdraw storms.
    const fireflyGeometry = addResource(new THREE.SphereGeometry(0.12, 6, 4));
    const fireflyMaterial = addMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const phase = hash(instanceIndex).mul(TAU);
        const pulse = pow(sin(uTime.mul(1.7).add(phase)).mul(0.5).add(0.5), float(2.6));
        const drift = vec3(
            sin(uTime.mul(0.31).add(phase)).mul(0.7),
            sin(uTime.mul(0.43).add(phase.mul(1.4))).mul(0.45),
            sin(uTime.mul(0.27).sub(phase)).mul(0.55),
        );
        fireflyMaterial.positionNode = positionLocal.add(drift);
        fireflyMaterial.colorNode = mix(vec3(0.22, 0.55, 0.15), vec3(1.35, 1.05, 0.30), pulse);
        fireflyMaterial.toneMapped = true;
    }
    const fireflyCount = 42;
    const fireflies = add(new THREE.InstancedMesh(fireflyGeometry, fireflyMaterial, fireflyCount));
    const fireflyRng = makeRng(73531);
    for (let index = 0; index < fireflyCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const x = side * (38 + fireflyRng() * 35);
        const z = -8 - fireflyRng() * 100;
        const y = 1.2 + fireflyRng() * 14;
        position.set(x, y, z);
        quaternion.identity();
        scale.setScalar(0.65 + fireflyRng() * 1.5);
        matrix.compose(position, quaternion, scale);
        fireflies.setMatrixAt(index, matrix);
    }
    fireflies.instanceMatrix.needsUpdate = true;
    fireflies.computeBoundingSphere();

    add(new THREE.HemisphereLight(0x6fb4aa, 0x10110e, 1.7));
    const moonLight = add(new THREE.DirectionalLight(0xbcebd6, 3.6));
    moonLight.position.set(-55, 72, 24);
    const warmRim = add(new THREE.PointLight(0xff6f3d, 10, 35, 2.0));
    warmRim.position.set(-42, 10, -76);

    return {
        camera(time, activeCamera) {
            const drift = Math.sin(time * 0.035) * 0.7;
            activeCamera.position.set(1.5 + drift, 43.5, 77.5);
            activeCamera.lookAt(-1.5 + drift * 0.18, 4.2, -31.5);
            activeCamera.fov = 46;
            activeCamera.near = 0.1;
            activeCamera.far = 900;
            activeCamera.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            updateFish(time);
            updateSpirit(time);
            spirit.rotation.y = Math.sin(time * 0.12) * 0.12;
        },
        dispose() {
            scene.remove(root);
            resources.forEach((resource) => resource.dispose?.());
            ownedMaterials.forEach((material) => material.dispose?.());
            scene.background = previousBackground;
            scene.fog = previousFog;
            renderer.toneMapping = previousToneMapping;
            renderer.toneMappingExposure = previousExposure;
            camera.fov = previousCamera.fov;
            camera.near = previousCamera.near;
            camera.far = previousCamera.far;
            camera.position.copy(previousCamera.position);
            camera.quaternion.copy(previousCamera.quaternion);
            camera.updateProjectionMatrix();
            camera.clearViewOffset?.();
        },
    };
}
