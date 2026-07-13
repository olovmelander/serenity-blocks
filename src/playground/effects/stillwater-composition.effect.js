/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, camelcase, object-curly-newline, no-nested-ternary */
/**
 * Stillwater Wave 1 — composition blockout.
 *
 * Proves the board-first silhouette before lake optics, particles, or post:
 * an S-shaped shore, colored depth bands, irregular canopy gaps, two hero edge
 * trees, and peripheral spirit/troll anchors.
 *
 *   ?effect=stillwater-composition&orbit=0&t=8&layout=solo
 *   ?effect=stillwater-composition&orbit=0&t=8&layout=solo&boardGuide=1
 *   ?effect=stillwater-composition&orbit=0&t=8&layout=quad
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    clamp,
    dot,
    float,
    mix,
    mx_noise_float,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    smoothstep,
    vec3,
} from 'three/tsl';

export const meta = {
    id: 'stillwater-composition',
    title: 'Stillwater — Composition Blockout',
    description: 'Board-first Nordic glade silhouette with an S-shore, canopy gaps, and peripheral story anchors.',
};

const REFERENCE_URL = '/playground-refs/stillwater-composition-concept-2026-07.png';
const LAYOUT_RECTS = Object.freeze({
    solo: Object.freeze([
        Object.freeze({ x: 0.32, y: 0.09, width: 0.36, height: 0.82 }),
    ]),
    duo: Object.freeze([
        Object.freeze({ x: 0.16, y: 0.13, width: 0.27, height: 0.74 }),
        Object.freeze({ x: 0.57, y: 0.13, width: 0.27, height: 0.74 }),
    ]),
    quad: Object.freeze([
        Object.freeze({ x: 0.035, y: 0.20, width: 0.19, height: 0.60 }),
        Object.freeze({ x: 0.282, y: 0.20, width: 0.19, height: 0.60 }),
        Object.freeze({ x: 0.529, y: 0.20, width: 0.19, height: 0.60 }),
        Object.freeze({ x: 0.776, y: 0.20, width: 0.19, height: 0.60 }),
    ]),
    odyssey: Object.freeze([
        Object.freeze({ x: 0.37, y: 0.08, width: 0.31, height: 0.84 }),
        Object.freeze({ x: 0.055, y: 0.14, width: 0.22, height: 0.72, role: 'hud-exclusion' }),
    ]),
});

const LAYOUT_ANCHORS = Object.freeze({
    solo: Object.freeze({
        spirit: Object.freeze([-56, 1.8, -78, 1.42]),
        troll: Object.freeze([58, 1.0, -71, 1.35]),
    }),
    duo: Object.freeze({
        spirit: Object.freeze([-88, 1.8, -63, 1.10]),
        troll: Object.freeze([88, 1.0, -63, 1.0]),
    }),
    quad: Object.freeze({
        spirit: Object.freeze([-66, 1.8, -80, 0.72]),
        troll: Object.freeze([66, 1.0, -80, 0.60]),
    }),
    odyssey: Object.freeze({
        spirit: Object.freeze([-48, 1.8, -78, 1.0]),
        troll: Object.freeze([58, 1.0, -71, 1.15]),
    }),
});

const MID_TREES = Object.freeze([
    [-58, -42, 20, -0.10], [-47, -72, 25, 0.08], [-66, -103, 29, -0.05],
    [-35, -124, 23, 0.06], [-81, -73, 31, 0.04],
    [62, -38, 21, 0.08], [50, -69, 27, -0.07], [67, -101, 30, 0.04],
    [37, -126, 22, -0.06], [84, -70, 33, -0.03],
]);

const FAR_TREES = Object.freeze([
    [-104, -142, 23, 4.5], [-91, -149, 31, 5.6], [-78, -145, 20, 4.0],
    [-65, -154, 27, 5.0], [-49, -148, 18, 3.8], [-34, -157, 24, 4.6],
    [35, -157, 22, 4.4], [51, -149, 18, 3.7], [66, -155, 28, 5.1],
    [81, -145, 21, 4.1], [95, -151, 32, 5.8], [108, -141, 24, 4.7],
]);

function resolveLayout(params) {
    const requested = String(params?.get?.('layout') || 'solo').toLowerCase();
    return Object.hasOwn(LAYOUT_RECTS, requested) ? requested : 'solo';
}

function boardGuideEnabled(params) {
    return params?.get?.('boardGuide') === '1';
}

function projectObjectBounds(object, camera) {
    object.updateWorldMatrix(true, true);
    camera.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    const corners = [
        [box.min.x, box.min.y, box.min.z], [box.min.x, box.min.y, box.max.z],
        [box.min.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z],
        [box.max.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.max.z],
        [box.max.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.max.z],
    ];
    let left = 1;
    let right = 0;
    let top = 1;
    let bottom = 0;
    corners.forEach((corner) => {
        const projected = new THREE.Vector3(...corner).project(camera);
        const x = projected.x * 0.5 + 0.5;
        const y = 0.5 - projected.y * 0.5;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
    });
    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
}

function rectsOverlap(a, b) {
    return a.x < b.x + b.width
        && a.x + a.width > b.x
        && a.y < b.y + b.height
        && a.y + a.height > b.y;
}

function shoreProfile(t) {
    const z = THREE.MathUtils.lerp(48, -142, t);
    const halfWidth = THREE.MathUtils.lerp(54, 8.5, t ** 0.82);
    const bend = Math.sin((t * 1.52 - 0.14) * Math.PI) * (7.5 - t * 2.0);
    return {
        z,
        left: bend - halfWidth,
        right: bend + halfWidth,
    };
}

function buildShoreGeometry(side) {
    const segments = 56;
    const positions = [];
    const indices = [];
    for (let index = 0; index <= segments; index += 1) {
        const t = index / segments;
        const profile = shoreProfile(t);
        const innerX = side < 0 ? profile.left : profile.right;
        const outerX = side * THREE.MathUtils.lerp(126, 82, t);
        const edgeLift = 0.18 + Math.sin(index * 1.73) * 0.08;
        const outerLift = THREE.MathUtils.lerp(10.5, 4.2, t)
            + Math.sin(index * 0.81 + side) * 0.75;
        positions.push(innerX, edgeLift, profile.z, outerX, outerLift, profile.z);
        if (index < segments) {
            const base = index * 2;
            if (side < 0) {
                indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
            } else {
                indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function buildLakeGeometry() {
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

function buildRidgeGeometry() {
    const profile = [
        [-145, 11], [-126, 20], [-109, 16], [-93, 27], [-76, 19], [-59, 24],
        [-40, 15], [-22, 19], [-7, 12], [11, 17], [29, 13], [47, 22],
        [65, 18], [83, 27], [101, 17], [120, 23], [145, 12],
    ];
    const positions = [];
    for (let index = 0; index < profile.length - 1; index += 1) {
        const [x0, y0] = profile[index];
        const [x1, y1] = profile[index + 1];
        positions.push(x0, -3, 0, x1, -3, 0, x1, y1, 0);
        positions.push(x0, -3, 0, x1, y1, 0, x0, y0, 0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function addSegmentMatrices(segmentList, start, end, radius) {
    segmentList.push({
        start: new THREE.Vector3(...start),
        end: new THREE.Vector3(...end),
        radius,
    });
}

function createTreeSegments() {
    const segments = [];
    addSegmentMatrices(segments, [-89, 0, -14], [-86, 22, -22], 3.0);
    addSegmentMatrices(segments, [-86, 22, -22], [-76, 39, -36], 2.4);
    addSegmentMatrices(segments, [-76, 39, -36], [-54, 52, -50], 1.55);
    addSegmentMatrices(segments, [-76, 39, -36], [-84, 49, -49], 1.45);
    addSegmentMatrices(segments, [-54, 52, -50], [-39, 57, -60], 1.0);
    addSegmentMatrices(segments, [-89, 1, -14], [-105, 2, 2], 1.5);
    addSegmentMatrices(segments, [-89, 1, -14], [-70, 1, 4], 1.35);

    addSegmentMatrices(segments, [91, 0, -16], [87, 23, -24], 3.1);
    addSegmentMatrices(segments, [87, 23, -24], [77, 40, -38], 2.45);
    addSegmentMatrices(segments, [77, 40, -38], [55, 53, -52], 1.6);
    addSegmentMatrices(segments, [77, 40, -38], [86, 49, -51], 1.45);
    addSegmentMatrices(segments, [55, 53, -52], [40, 58, -62], 1.0);
    addSegmentMatrices(segments, [91, 1, -16], [107, 2, 0], 1.55);
    addSegmentMatrices(segments, [91, 1, -16], [72, 1, 2], 1.35);

    MID_TREES.forEach(([x, z, height, lean]) => {
        addSegmentMatrices(
            segments,
            [x, 0, z],
            [x + lean * height, height, z - Math.abs(lean) * 5],
            1.45 + height * 0.018,
        );
    });
    return segments;
}

function setSegmentMatrix(mesh, index, segment, scratch) {
    scratch.direction.subVectors(segment.end, segment.start);
    scratch.position.addVectors(segment.start, segment.end).multiplyScalar(0.5);
    scratch.quaternion.setFromUnitVectors(scratch.up, scratch.direction.clone().normalize());
    scratch.scale.set(segment.radius, scratch.direction.length(), segment.radius);
    scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
    mesh.setMatrixAt(index, scratch.matrix);
}

function createBoardGuide({ camera, scene, rects, materials, geometries }) {
    const group = new THREE.Group();
    group.name = 'stillwater-board-safe-guide';
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometries.add(geometry);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec3(0.020, 0.070, 0.064);
    material.opacityNode = float(0.13);
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;
    material.toneMapped = false;
    materials.add(material);

    rects.forEach((rect) => {
        const plane = new THREE.Mesh(geometry, material);
        plane.renderOrder = 10000;
        plane.userData.rect = rect;
        group.add(plane);
    });

    const cameraHadParent = Boolean(camera.parent);
    if (!cameraHadParent) scene.add(camera);
    camera.add(group);
    return { group, cameraHadParent };
}

function updateBoardGuide(group, rects, camera) {
    if (!group) return;
    const distance = 1.2;
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance;
    const viewWidth = viewHeight * camera.aspect;
    group.position.set(0, 0, -distance);
    group.children.forEach((plane, index) => {
        const rect = rects[index];
        const centerX = rect.x + rect.width * 0.5;
        const centerY = rect.y + rect.height * 0.5;
        plane.position.set((centerX - 0.5) * viewWidth, (0.5 - centerY) * viewHeight, 0);
        plane.scale.set(rect.width * viewWidth, rect.height * viewHeight, 1);
    });
}

export function create({
    scene, camera, renderer, params, sizes,
}) {
    const layout = resolveLayout(params);
    const rects = LAYOUT_RECTS[layout];
    const showBoardGuide = boardGuideEnabled(params);
    const root = new THREE.Group();
    root.name = 'stillwater-composition-blockout';
    scene.add(root);

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

    const previous = {
        background: scene.background,
        fog: scene.fog,
        toneMapping: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };

    scene.background = new THREE.Color(0x071713);
    scene.fog = new THREE.FogExp2(0x18332d, 0.0065);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.88;

    const skyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const direction = normalize(positionLocal);
        const height = smoothstep(-0.12, 0.78, direction.y);
        const horizon = smoothstep(0.02, 0.42, abs(direction.y.add(0.02))).oneMinus();
        skyMaterial.colorNode = mix(vec3(0.075, 0.165, 0.155), vec3(0.005, 0.018, 0.018), height)
            .add(vec3(0.085, 0.16, 0.15).mul(horizon.mul(0.26)));
        skyMaterial.side = THREE.BackSide;
        skyMaterial.depthWrite = false;
        skyMaterial.fog = false;
    }
    const sky = add(new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(460, 48, 24)),
        skyMaterial,
    ));
    sky.frustumCulled = false;

    const ridgeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    ridgeMaterial.colorNode = mix(
        vec3(0.040, 0.095, 0.082),
        vec3(0.085, 0.155, 0.132),
        smoothstep(-1, 28, positionWorld.y),
    );
    const ridge = add(new THREE.Mesh(ownGeometry(buildRidgeGeometry()), ridgeMaterial));
    ridge.position.set(0, 0, -160);

    const waterMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const depthBand = smoothstep(-132, 20, positionWorld.z);
        const lateral = smoothstep(0, 56, abs(positionWorld.x));
        waterMaterial.colorNode = mix(vec3(0.014, 0.064, 0.060), vec3(0.006, 0.028, 0.029), depthBand)
            .add(vec3(0.025, 0.075, 0.063).mul(lateral.mul(0.28)));
    }
    const water = add(new THREE.Mesh(ownGeometry(buildLakeGeometry()), waterMaterial));
    water.position.y = 0.02;

    const terrainMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const moss = mx_noise_float(positionWorld.mul(0.075)).mul(0.5).add(0.5);
        const depth = smoothstep(-145, 28, positionWorld.z);
        const top = smoothstep(0.22, 0.86, normalWorld.y);
        const nearColor = mix(vec3(0.018, 0.050, 0.035), vec3(0.055, 0.145, 0.077), moss.mul(top));
        const farColor = vec3(0.15, 0.25, 0.205);
        terrainMaterial.colorNode = mix(farColor, nearColor, depth);
        terrainMaterial.roughnessNode = float(0.98);
        terrainMaterial.metalnessNode = float(0);
    }
    const leftShore = add(new THREE.Mesh(ownGeometry(buildShoreGeometry(-1)), terrainMaterial));
    const rightShore = add(new THREE.Mesh(ownGeometry(buildShoreGeometry(1)), terrainMaterial));
    leftShore.name = 'stillwater-left-s-shore';
    rightShore.name = 'stillwater-right-s-shore';

    const trunkMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const bark = mx_noise_float(positionWorld.mul(vec3(0.15, 0.052, 0.15))).mul(0.5).add(0.5);
        const facing = clamp(dot(normalize(normalWorld), normalize(vec3(-0.34, 0.72, 0.48))), 0, 1);
        trunkMaterial.colorNode = mix(vec3(0.030, 0.024, 0.018), vec3(0.145, 0.098, 0.056), bark)
            .add(vec3(0.060, 0.15, 0.10).mul(facing.mul(0.32)));
        trunkMaterial.roughnessNode = float(1);
    }
    const treeSegments = createTreeSegments();
    const treeSegmentGeometry = ownGeometry(new THREE.CylinderGeometry(0.72, 1, 1, 8, 1));
    const treeMesh = add(new THREE.InstancedMesh(treeSegmentGeometry, trunkMaterial, treeSegments.length));
    const scratch = {
        matrix: new THREE.Matrix4(),
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        up: new THREE.Vector3(0, 1, 0),
    };
    treeSegments.forEach((segment, index) => setSegmentMatrix(treeMesh, index, segment, scratch));
    treeMesh.instanceMatrix.needsUpdate = true;
    treeMesh.computeBoundingSphere();

    const canopyMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const canopyNoise = mx_noise_float(positionWorld.mul(0.09)).mul(0.5).add(0.5);
        const lift = normalWorld.y.mul(0.5).add(0.5);
        canopyMaterial.colorNode = mix(vec3(0.008, 0.040, 0.028), vec3(0.045, 0.140, 0.078), canopyNoise.mul(lift));
        canopyMaterial.roughnessNode = float(0.96);
    }
    const canopyGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 2));
    const canopyLayout = [
        [-86, 50, -32, 9, 5.5, 7], [-72, 54, -45, 9, 5, 7], [-56, 57, -56, 8, 4.5, 6],
        [-96, 45, -48, 8, 5, 6], [-41, 59, -62, 7, 4, 5],
        [88, 51, -34, 9, 5.5, 7], [73, 55, -47, 9, 5, 7], [57, 58, -58, 8, 4.5, 6],
        [98, 46, -50, 8, 5, 6], [42, 60, -64, 7, 4, 5],
        [-58, 30, -44, 6, 3.8, 5], [-48, 35, -73, 5.5, 3.4, 4.6], [-66, 38, -104, 5, 3, 4.2],
        [62, 31, -41, 6, 3.8, 5], [51, 36, -70, 5.5, 3.4, 4.6], [68, 39, -103, 5, 3, 4.2],
    ];
    const canopies = add(new THREE.InstancedMesh(canopyGeometry, canopyMaterial, canopyLayout.length));
    const euler = new THREE.Euler();
    canopyLayout.forEach((entry, index) => {
        scratch.position.set(entry[0], entry[1], entry[2]);
        euler.set(index * 0.07, index * 1.17, index * -0.05);
        scratch.quaternion.setFromEuler(euler);
        scratch.scale.set(entry[3], entry[4], entry[5]);
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
        canopies.setMatrixAt(index, scratch.matrix);
    });
    canopies.instanceMatrix.needsUpdate = true;
    canopies.computeBoundingSphere();

    const farTreeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    farTreeMaterial.colorNode = vec3(0.045, 0.095, 0.078);
    const farTreeGeometry = ownGeometry(new THREE.ConeGeometry(1, 1, 6, 1));
    const farTrees = add(new THREE.InstancedMesh(farTreeGeometry, farTreeMaterial, FAR_TREES.length));
    FAR_TREES.forEach(([x, z, height, width], index) => {
        scratch.position.set(x, height * 0.5, z);
        euler.set(0, index * 0.71, 0);
        scratch.quaternion.setFromEuler(euler);
        scratch.scale.set(width, height, width);
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
        farTrees.setMatrixAt(index, scratch.matrix);
    });
    farTrees.instanceMatrix.needsUpdate = true;
    farTrees.computeBoundingSphere();

    const spirit = add(new THREE.Group());
    spirit.name = 'stillwater-spirit-placeholder-left';
    const spiritCoreMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    spiritCoreMaterial.colorNode = vec3(1.0, 0.78, 0.42);
    const spiritAuraMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    spiritAuraMaterial.colorNode = vec3(0.42, 0.72, 0.66);
    spiritAuraMaterial.opacityNode = float(0.12);
    spiritAuraMaterial.transparent = true;
    spiritAuraMaterial.depthWrite = false;
    const spiritBody = new THREE.Mesh(ownGeometry(new THREE.CapsuleGeometry(1.0, 4.2, 8, 16)), spiritCoreMaterial);
    spiritBody.position.y = 3.4;
    spiritBody.scale.set(0.72, 1, 0.62);
    const spiritAura = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(1, 18, 12)), spiritAuraMaterial);
    spiritAura.position.y = 3.6;
    spiritAura.scale.set(3.8, 6.2, 3.0);
    spirit.add(spiritAura, spiritBody);

    const troll = add(new THREE.Group());
    troll.name = 'stillwater-troll-placeholder-right';
    troll.rotation.y = -0.16;
    const trollMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    trollMaterial.colorNode = mix(
        vec3(0.030, 0.040, 0.030),
        vec3(0.105, 0.145, 0.068),
        mx_noise_float(positionWorld.mul(0.21)).mul(0.5).add(0.5),
    );
    trollMaterial.roughnessNode = float(1);
    const trollMassGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
    const trollBody = new THREE.Mesh(trollMassGeometry, trollMaterial);
    trollBody.position.set(0, 4.4, 0);
    trollBody.scale.set(4.8, 6.0, 3.6);
    const trollHead = new THREE.Mesh(trollMassGeometry, trollMaterial);
    trollHead.position.set(-0.4, 9.4, 0.3);
    trollHead.scale.set(3.3, 2.9, 3.0);
    const eyeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    eyeMaterial.colorNode = vec3(1.0, 0.24, 0.035);
    const eyeGeometry = ownGeometry(new THREE.SphereGeometry(0.18, 8, 6));
    const eyes = new THREE.InstancedMesh(eyeGeometry, eyeMaterial, 2);
    [-1, 1].forEach((side, index) => {
        scratch.position.set(side * 0.72 - 0.4, 9.7, 2.75);
        scratch.quaternion.identity();
        scratch.scale.set(1, 1, 1);
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
        eyes.setMatrixAt(index, scratch.matrix);
    });
    eyes.instanceMatrix.needsUpdate = true;
    troll.add(trollBody, trollHead, eyes);

    const hemisphere = add(new THREE.HemisphereLight(0x9ccfd0, 0x07120e, 1.55));
    const moonKey = add(new THREE.DirectionalLight(0xb8dfd6, 2.35));
    moonKey.position.set(-42, 70, 24);
    hemisphere.name = 'stillwater-composition-hemisphere';
    moonKey.name = 'stillwater-composition-moon-key';

    let viewport = {
        width: sizes?.width || window.innerWidth,
        height: sizes?.height || window.innerHeight,
    };
    const boardGuide = showBoardGuide
        ? createBoardGuide({ camera, scene, rects, materials, geometries })
        : null;

    const applyCamera = (time) => {
        const aspect = Math.max(0.5, viewport.width / Math.max(1, viewport.height));
        const layoutPullback = layout === 'quad' ? 7 : layout === 'duo' ? 3 : 0;
        const narrowPullback = aspect < 1.68 ? 4 : 0;
        const drift = Math.sin(time * 0.035) * 0.42;
        camera.position.set(drift, 25.5, 80 + layoutPullback + narrowPullback);
        camera.lookAt(drift * 0.08, 21.0, -54);
        camera.fov = aspect > 2.05 ? 43 : 47;
        camera.near = 0.1;
        camera.far = 850;
        camera.updateProjectionMatrix();

        const anchors = LAYOUT_ANCHORS[layout];
        const wideSpread = aspect > 2.05 ? 1.24 : 1;
        spirit.position.set(anchors.spirit[0] * wideSpread, anchors.spirit[1], anchors.spirit[2]);
        spirit.scale.setScalar(anchors.spirit[3]);
        troll.position.set(anchors.troll[0] * wideSpread, anchors.troll[1], anchors.troll[2]);
        troll.scale.setScalar(anchors.troll[3]);
        root.updateMatrixWorld(true);
        updateBoardGuide(boardGuide?.group, rects, camera);
    };

    const collectStats = () => {
        let meshes = 0;
        let lights = 0;
        let transparentLayers = 0;
        root.traverse((object) => {
            if (object.isMesh || object.isInstancedMesh) meshes += 1;
            if (object.isLight) lights += 1;
            const materialList = Array.isArray(object.material) ? object.material : [object.material];
            if (materialList.some((material) => material?.transparent)) transparentLayers += 1;
        });
        return {
            meshes,
            lights,
            transparentLayers,
            geometries: geometries.size,
            materials: materials.size,
        };
    };

    const debugApi = Object.freeze({
        getDiagnostics: () => {
            const anchorScreens = {
                spirit: projectObjectBounds(spirit, camera),
                troll: projectObjectBounds(troll, camera),
            };
            const waterScreen = projectObjectBounds(water, camera);
            return {
                wave: 1,
                layout,
                boardGuide: showBoardGuide,
                boardRects: rects.map((rect) => ({ ...rect })),
                reference: REFERENCE_URL,
                waterFrameFractionTarget: [0.35, 0.42],
                waterFrameFraction: 1 - THREE.MathUtils.clamp(waterScreen.y, 0, 1),
                anchors: {
                    spirit: spirit.position.toArray(),
                    troll: troll.position.toArray(),
                },
                anchorScreens,
                boardClear: Object.values(anchorScreens)
                    .every((anchor) => rects.every((rect) => !rectsOverlap(anchor, rect))),
                viewport: { ...viewport },
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                scene: collectStats(),
            };
        },
    });
    window.__STILLWATER_COMPOSITION__ = debugApi;

    return {
        getDiagnostics: debugApi.getDiagnostics,
        camera(time) {
            applyCamera(time);
        },
        update(time) {
            spirit.rotation.y = Math.sin(time * 0.13) * 0.08;
            troll.rotation.z = Math.sin(time * 0.09 + 1.3) * 0.012;
        },
        resize(width, height) {
            viewport = { width, height };
            applyCamera(0);
        },
        dispose() {
            if (window.__STILLWATER_COMPOSITION__ === debugApi) {
                delete window.__STILLWATER_COMPOSITION__;
            }
            if (boardGuide) {
                camera.remove(boardGuide.group);
                if (!boardGuide.cameraHadParent) scene.remove(camera);
            }
            scene.remove(root);
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            scene.background = previous.background;
            scene.fog = previous.fog;
            renderer.toneMapping = previous.toneMapping;
            renderer.toneMappingExposure = previous.exposure;
            camera.fov = previous.fov;
            camera.near = previous.near;
            camera.far = previous.far;
            camera.position.copy(previous.position);
            camera.quaternion.copy(previous.quaternion);
            camera.updateProjectionMatrix();
            camera.clearViewOffset?.();
        },
    };
}
