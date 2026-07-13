/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater Wave 2 — "The Pool Remembers" lake proof.
 *
 * Phase-locked comparison URLs:
 *   ?effect=stillwater-water&quality=High&reflection=auto&boardGuide=1&layout=solo&t=8
 *   ?effect=stillwater-water&quality=High&reflection=off&boardGuide=1&layout=solo&t=8
 *   ?effect=stillwater-water&quality=Low&reflection=auto&boardGuide=1&layout=solo&t=8
 *   ?effect=stillwater-water&quality=High&reflection=auto&forceWebGL=1&t=8
 *   ?effect=stillwater-water&quality=High&reflection=auto&grade=aces&t=8
 *
 * `reflection=auto|off` is the public contract (`1|0` are accepted aliases).
 * High/auto constructs the reduced-resolution reflector. Low/auto constructs the
 * analytic sky/character reflection. Off constructs neither reflection graph.
 * Wake slots intentionally belong to Wave 3.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    cameraPosition,
    clamp,
    dot,
    float,
    length,
    max,
    mix,
    mx_noise_vec3 as materialXNoiseVec3,
    mx_worley_noise_float as materialXWorley,
    normalize,
    normalWorld,
    pass,
    positionLocal,
    positionWorld,
    pow,
    reflector,
    renderOutput,
    screenUV,
    sin,
    smoothstep,
    toneMapping,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

export const meta = {
    id: 'stillwater-water',
    title: 'Stillwater — The Pool Remembers',
    description: 'Domain-warped black-water optics, tiered reflection, shore depth, calm playfield, and ACES grade.',
};

const REFLECTION_LAYER = 2;
const WATER_Y = 0;
const BOARD_WATER_CENTER = Object.freeze({ x: 0, z: -7 });
// Wave 2's named High lane follows the plan's 0.40-0.45 target. Ultra/Extreme
// can raise this toward 0.50 later once the integrated theme has matched evidence.
const REFLECTOR_SCALE = 0.45;

const QUALITY = Object.freeze({
    Low: Object.freeze({ detailFlow: false, secondCaustic: false, reflectorScale: 0 }),
    High: Object.freeze({ detailFlow: true, secondCaustic: true, reflectorScale: REFLECTOR_SCALE }),
});

const LAKE_OUTLINE = Object.freeze([
    [-25, 10], [-30, 5], [-31, -2], [-27, -8], [-29, -15], [-25, -23],
    [-26, -31], [-20, -39], [-9, -43], [4, -42], [16, -39], [25, -32],
    [27, -24], [24, -17], [29, -10], [27, -2], [30, 5], [24, 10],
    [14, 12], [4, 10], [-7, 13], [-17, 11],
]);

function smoothClosedOutline(points, pointCount = 96) {
    const curve = new THREE.CatmullRomCurve3(
        points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
        true,
        'centripetal',
        0.45,
    );
    return curve.getSpacedPoints(pointCount).slice(0, -1)
        .map((point) => Object.freeze([point.x, point.z]));
}

const SMOOTH_LAKE_OUTLINE = Object.freeze(smoothClosedOutline(LAKE_OUTLINE));

function readQuality(params) {
    return String(params?.get?.('quality') || 'High').toLowerCase() === 'low' ? 'Low' : 'High';
}

function readToggle(params, key, fallback = true) {
    const value = params?.get?.(key);
    if (value == null) return fallback;
    return !['0', 'off', 'false', 'no'].includes(String(value).toLowerCase());
}

function readReflectionRequest(params) {
    if (params?.has?.('noReflect')) return 'off';
    const raw = String(params?.get?.('reflection') || 'auto').toLowerCase();
    return ['0', 'off', 'false', 'no'].includes(raw) ? 'off' : 'auto';
}

function readGrade(params) {
    return String(params?.get?.('grade') || 'full').toLowerCase() === 'aces'
        ? 'aces'
        : 'full';
}

function makeLakeGeometry() {
    const shape = new THREE.Shape();
    SMOOTH_LAKE_OUTLINE.forEach(([x, z], index) => {
        if (index === 0) shape.moveTo(x, -z);
        else shape.lineTo(x, -z);
    });
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape, 10);
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
}

function makeTerrainGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(-75, -50);
    shape.lineTo(75, -50);
    shape.lineTo(75, 85);
    shape.lineTo(-75, 85);
    shape.closePath();

    const lakeHole = new THREE.Path();
    SMOOTH_LAKE_OUTLINE.forEach(([x, z], index) => {
        if (index === 0) lakeHole.moveTo(x, -z);
        else lakeHole.lineTo(x, -z);
    });
    lakeHole.closePath();
    shape.holes.push(lakeHole);

    const geometry = new THREE.ShapeGeometry(shape, 10);
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
}

function makeLakeCollarGeometry(scale = 1.075) {
    const center = new THREE.Vector2(0, -13);
    const positions = [];
    const indices = [];
    SMOOTH_LAKE_OUTLINE.forEach(([x, z]) => {
        const outerX = center.x + (x - center.x) * scale;
        const outerZ = center.y + (z - center.y) * scale;
        positions.push(x, 0, z, outerX, 0, outerZ);
    });
    SMOOTH_LAKE_OUTLINE.forEach((_, index) => {
        const next = (index + 1) % SMOOTH_LAKE_OUTLINE.length;
        const inner = index * 2;
        const outer = inner + 1;
        const nextInner = next * 2;
        const nextOuter = nextInner + 1;
        indices.push(inner, nextInner, outer, nextInner, nextOuter, outer);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function includeInReflection(object) {
    object.traverse((child) => child.layers.enable(REFLECTION_LAYER));
    return object;
}

function setInstances(mesh, entries) {
    const object = new THREE.Object3D();
    entries.forEach(([x, y, z, sx, sy, sz, yaw = 0], index) => {
        object.position.set(x, y, z);
        object.scale.set(sx, sy, sz);
        object.rotation.set(0, yaw, 0);
        object.updateMatrix();
        mesh.setMatrixAt(index, object.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
}

function rendererCounters(renderer) {
    const render = renderer.info?.render || {};
    const memory = renderer.info?.memory || {};
    return {
        drawCalls: render.drawCalls ?? render.calls ?? 0,
        triangles: render.triangles ?? 0,
        geometries: memory.geometries ?? 0,
        textures: memory.textures ?? 0,
        programs: renderer.info?.programs ? renderer.info.programs.length : null,
    };
}

export function create({
    scene, camera, renderer, params,
}) {
    const qualityName = readQuality(params);
    const quality = QUALITY[qualityName];
    const reflectionRequest = readReflectionRequest(params);
    const gradeMode = readGrade(params);
    let reflectionMode = 'off';
    if (reflectionRequest !== 'off') {
        reflectionMode = quality.reflectorScale > 0 ? 'reflector' : 'analytic';
    }
    const boardGuideEnabled = readToggle(params, 'boardGuide', false);
    const layout = params?.get?.('layout') || 'solo';

    const root = new THREE.Group();
    root.name = 'stillwater-water-wave2';
    scene.add(root);

    const geometries = new Set();
    const materials = new Set();
    const ownGeometry = (geometry) => { geometries.add(geometry); return geometry; };
    const ownMaterial = (material) => { materials.add(material); return material; };
    const add = (object) => { root.add(object); return object; };

    const previous = {
        background: scene.background,
        fog: scene.fog,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };

    scene.background = new THREE.Color(0x020907);
    scene.fog = new THREE.FogExp2(0x0b211d, 0.0085);

    const uTime = uniform(0);

    // A graded sky dome gives both the main camera and the reflector a coherent
    // moon-cyan horizon without an HDR asset or a second material path.
    const skyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const skyDirection = normalize(positionLocal);
    const skyHeight = smoothstep(-0.08, 0.68, skyDirection.y);
    const horizonBand = smoothstep(0.02, 0.34, abs(skyDirection.y)).oneMinus();
    skyMaterial.colorNode = mix(
        vec3(0.045, 0.115, 0.108),
        vec3(0.003, 0.013, 0.012),
        skyHeight,
    ).add(vec3(0.12, 0.25, 0.25).mul(horizonBand.mul(0.16)));
    skyMaterial.side = THREE.BackSide;
    skyMaterial.depthWrite = false;
    skyMaterial.fog = false;
    const sky = includeInReflection(add(new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(260, 40, 20)),
        skyMaterial,
    )));
    sky.frustumCulled = false;

    const moonMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    moonMaterial.colorNode = vec3(0.70, 0.88, 0.84).mul(1.35);
    const moon = add(new THREE.Mesh(
        ownGeometry(new THREE.CircleGeometry(5.4, 48)),
        moonMaterial,
    ));
    moon.position.set(-16, 27, -82);
    moon.lookAt(0, 17.5, 36);

    // Terrain and a low moss collar make shore-depth readable without adding a
    // second transparent shell. The lake bed receives restrained MaterialX veins.
    const groundMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const groundGrain = materialXNoiseVec3(positionWorld.mul(0.085), 0.5).x.mul(0.5).add(0.5);
    const groundDepth = smoothstep(-72, 34, positionWorld.z);
    const groundNear = mix(vec3(0.006, 0.025, 0.018), vec3(0.020, 0.052, 0.027), groundGrain);
    const groundFar = vec3(0.025, 0.066, 0.055);
    groundMaterial.colorNode = mix(groundFar, groundNear, groundDepth);
    const ground = add(new THREE.Mesh(
        ownGeometry(makeTerrainGeometry()),
        groundMaterial,
    ));
    ground.position.set(0, -0.62, 0);

    const lakeGeometry = ownGeometry(makeLakeGeometry());
    const collarMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const collarGrain = materialXNoiseVec3(positionWorld.mul(0.22), 0.58).x.mul(0.5).add(0.5);
    collarMaterial.colorNode = mix(vec3(0.006, 0.022, 0.014), vec3(0.022, 0.055, 0.028), collarGrain);
    const collar = add(new THREE.Mesh(ownGeometry(makeLakeCollarGeometry(1.018)), collarMaterial));
    collar.position.y = -0.18;

    const bedMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const bedPosition = positionWorld.xz;
    const causticA = materialXWorley(vec3(bedPosition.mul(0.105), uTime.mul(0.030)), 0.78)
        .oneMinus().pow(5.0);
    let caustics = causticA;
    if (quality.secondCaustic) {
        const causticB = materialXWorley(
            vec3(bedPosition.mul(0.16).add(vec2(7.2, -3.4)), uTime.mul(-0.024)),
            0.68,
        ).oneMinus().pow(6.0);
        caustics = causticA.mul(0.72).add(causticB.mul(0.38));
    }
    const bedCenterX = sin(bedPosition.y.add(13).mul(0.11)).mul(2.8);
    const bedRadius = length(vec2(
        bedPosition.x.sub(bedCenterX).div(29),
        bedPosition.y.add(13).div(27),
    ));
    const bedDepth = smoothstep(0.22, 0.93, bedRadius).oneMinus();
    const bedBase = mix(vec3(0.035, 0.082, 0.052), vec3(0.003, 0.018, 0.017), bedDepth);
    bedMaterial.colorNode = bedBase.add(vec3(0.23, 0.44, 0.25).mul(caustics.mul(0.38)));
    const bed = add(new THREE.Mesh(lakeGeometry, bedMaterial));
    bed.position.y = -1.05;

    // Submerged stones remain real silhouettes under the transparent water.
    const stoneGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
    const stoneMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    const stoneLift = normalWorld.y.mul(0.5).add(0.5);
    stoneMaterial.colorNode = mix(vec3(0.030, 0.052, 0.045), vec3(0.12, 0.18, 0.13), stoneLift);
    stoneMaterial.roughnessNode = float(0.92);
    const stoneLayout = [
        [-19, -0.48, 1, 2.7, 0.82, 1.8, 0.2], [-15, -0.58, -3, 1.8, 0.68, 1.2, -0.4],
        [18, -0.52, -9, 2.2, 0.76, 1.5, 0.6], [21, -0.62, -15, 1.4, 0.58, 1.0, -0.2],
        [-10, -0.68, -33, 1.8, 0.64, 1.3, 0.3],
    ];
    const stones = add(new THREE.InstancedMesh(stoneGeometry, stoneMaterial, stoneLayout.length));
    setInstances(stones, stoneLayout);

    // Two instanced forest draws supply composition-relevant reflection silhouettes.
    const treeEntries = [
        [-31, 7, -29, 1.5, 13, 1.5, 0.1], [-25, 8, -39, 1.8, 16, 1.8, -0.2],
        [-15, 7, -46, 1.6, 14, 1.6, 0.3], [19, 8, -45, 1.7, 16, 1.7, -0.1],
        [28, 7, -37, 1.5, 14, 1.5, 0.2], [33, 6, -25, 1.3, 12, 1.3, -0.3],
    ];
    const trunkMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({ color: 0x16362d }));
    const trunks = includeInReflection(add(new THREE.InstancedMesh(
        ownGeometry(new THREE.CylinderGeometry(0.55, 0.85, 2, 7)),
        trunkMaterial,
        treeEntries.length,
    )));
    setInstances(trunks, treeEntries);

    const canopyMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({ color: 0x103128 }));
    const canopyEntries = treeEntries.map(([x, y, z, sx, sy, sz, yaw]) => [
        x, y + sy + 3.5, z, sx * 4.2, sy * 0.34, sz * 3.8, yaw,
    ]);
    const canopies = includeInReflection(add(new THREE.InstancedMesh(
        ownGeometry(new THREE.IcosahedronGeometry(1, 1)),
        canopyMaterial,
        canopyEntries.length,
    )));
    setInstances(canopies, canopyEntries);

    // Root, lilies, troll, and spirit are also the fixed contact-darkening anchors.
    const rootMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial({ color: 0x24392c, roughness: 0.94 }));
    const shoreRoot = includeInReflection(add(new THREE.Mesh(
        ownGeometry(new THREE.CylinderGeometry(0.48, 0.86, 8.5, 10)),
        rootMaterial,
    )));
    shoreRoot.position.set(-20, 0.12, -1);
    shoreRoot.rotation.z = Math.PI * 0.48;
    shoreRoot.rotation.y = -0.22;

    const lilyMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial({ color: 0x315b35, roughness: 0.82 }));
    const lilyLayout = [
        [13, 0.13, -5, 1.8, 0.10, 1.35, 0.2], [16, 0.12, -8, 1.25, 0.09, 0.95, -0.5],
        [-13, 0.12, -19, 1.4, 0.09, 1.05, 0.7],
    ];
    const lilies = includeInReflection(add(new THREE.InstancedMesh(
        ownGeometry(new THREE.CylinderGeometry(1, 1.05, 1, 24)),
        lilyMaterial,
        lilyLayout.length,
    )));
    setInstances(lilies, lilyLayout);

    const troll = new THREE.Group();
    troll.name = 'troll-reflection-proxy';
    const trollMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    const trollFacing = clamp(dot(normalize(normalWorld), normalize(vec3(-0.3, 0.55, 0.76))), 0, 1);
    trollMaterial.colorNode = vec3(0.055, 0.080, 0.050)
        .add(vec3(0.095, 0.125, 0.070).mul(trollFacing.mul(0.62)));
    trollMaterial.roughnessNode = float(0.96);
    const trollBody = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(2.2, 18, 12)), trollMaterial);
    trollBody.scale.set(1.0, 1.35, 0.72);
    const trollHead = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(1.35, 16, 10)), trollMaterial);
    trollHead.position.set(-0.45, 3.2, 0);
    const eyeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    eyeMaterial.colorNode = vec3(0.95, 0.25, 0.035).mul(1.15);
    const trollEyes = new THREE.InstancedMesh(
        ownGeometry(new THREE.SphereGeometry(0.12, 10, 7)),
        eyeMaterial,
        2,
    );
    setInstances(trollEyes, [
        [-0.88, 3.35, 1.15, 1, 1, 1],
        [-0.06, 3.35, 1.15, 1, 1, 1],
    ]);
    troll.add(trollBody, trollHead, trollEyes);
    troll.position.set(18.5, 2.25, -19);
    troll.rotation.y = -0.48;
    includeInReflection(add(troll));

    const spirit = new THREE.Group();
    spirit.name = 'spirit-reflection-proxy';
    const spiritMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const spiritPulse = sin(uTime.mul(0.72)).mul(0.5).add(0.5);
    spiritMaterial.colorNode = mix(vec3(0.25, 0.42, 0.30), vec3(0.90, 0.38, 0.05), spiritPulse)
        .mul(0.88);
    const spiritBody = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(1.4, 24, 16)), spiritMaterial);
    spiritBody.scale.set(0.78, 1.48, 0.68);
    const spiritTail = new THREE.Mesh(ownGeometry(new THREE.ConeGeometry(0.78, 3.0, 18)), spiritMaterial);
    spiritTail.position.y = -2.1;
    spirit.add(spiritBody, spiritTail);
    spirit.position.set(-18, 5.1, -20);
    includeInReflection(add(spirit));

    const hemisphere = includeInReflection(add(new THREE.HemisphereLight(0x9ccfd0, 0x071713, 1.05)));
    const moonKey = includeInReflection(add(new THREE.DirectionalLight(0xbfe4df, 1.45)));
    moonKey.position.set(-18, 32, 16);
    hemisphere.name = 'stillwater-hemi';
    moonKey.name = 'stillwater-moon-key';

    // Domain-warped MaterialX flow. The optical normal is consumed directly by
    // Fresnel/reflection distortion: MeshBasicNodeMaterial ignores normalNode in r181.
    const waterPosition = positionWorld.xz;
    const centerDrift = sin(waterPosition.y.add(13).mul(0.11)).mul(2.8);
    const lakeRadius = length(vec2(
        waterPosition.x.sub(centerDrift).div(29),
        waterPosition.y.add(13).div(27),
    ));
    const inward = clamp(float(1).sub(lakeRadius), 0, 1);
    const shoreDepth = smoothstep(0.012, 0.18, inward);
    const shoreBand = smoothstep(0.0, 0.075, inward).oneMinus();

    const boardDistance = length(vec2(
        waterPosition.x.sub(BOARD_WATER_CENTER.x).div(10.5),
        waterPosition.y.sub(BOARD_WATER_CENTER.z).div(14.5),
    ));
    const calmMask = smoothstep(0.72, 1.16, boardDistance).oneMinus();

    const warpCoord = vec3(waterPosition.mul(0.035), uTime.mul(0.022));
    const domainWarp = materialXNoiseVec3(warpCoord, 0.82).xy;
    const broadFlow = materialXNoiseVec3(
        vec3(waterPosition.mul(0.072).add(domainWarp.mul(0.68)), uTime.mul(-0.036)),
        1.0,
    ).xy;
    let flowField = broadFlow;
    if (quality.detailFlow) {
        const detailFlow = materialXNoiseVec3(
            vec3(waterPosition.mul(0.145).sub(domainWarp.mul(0.31)), uTime.mul(0.052)),
            0.46,
        ).xy;
        flowField = broadFlow.mul(0.78).add(detailFlow.mul(0.34));
    }
    const opticalStrength = mix(float(0.125), float(0.014), calmMask);
    const opticalSlope = flowField.mul(opticalStrength);
    const opticalNormal = normalize(vec3(opticalSlope.x, 1, opticalSlope.y));

    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const nDotV = max(dot(opticalNormal, viewDirection), float(0));
    const fresnel = float(0.0204).add(
        float(0.9796).mul(pow(float(1).sub(nDotV), float(5))),
    );

    const shallowColor = vec3(0.012, 0.058, 0.050);
    const deepColor = vec3(0.006, 0.028, 0.027);
    let waterColor = mix(shallowColor, deepColor, pow(shoreDepth, 0.74));
    const ripplePhaseA = waterPosition.x.mul(1.08)
        .add(waterPosition.y.mul(0.52))
        .add(domainWarp.x.mul(7.2))
        .add(uTime.mul(0.62));
    const ripplePhaseB = waterPosition.y.mul(0.91)
        .sub(waterPosition.x.mul(0.34))
        .add(domainWarp.y.mul(5.6))
        .sub(uTime.mul(0.37));
    const rippleCrests = pow(sin(ripplePhaseA).mul(0.5).add(0.5), float(24))
        .mul(pow(sin(ripplePhaseB).mul(0.5).add(0.5), float(10)).mul(0.90).add(0.05));
    const activeRipple = rippleCrests
        .mul(float(1).sub(calmMask.mul(0.90)))
        .mul(smoothstep(0.08, 0.78, shoreDepth));
    waterColor = waterColor.add(vec3(0.16, 0.36, 0.31).mul(activeRipple.mul(0.11)));

    const moonLane = smoothstep(1.2, 5.4, abs(waterPosition.x.add(13))).oneMinus()
        .mul(smoothstep(4, 27, abs(waterPosition.y.add(8))).oneMinus())
        .mul(float(1).sub(calmMask.mul(0.82)));
    waterColor = waterColor.add(vec3(0.34, 0.58, 0.52).mul(moonLane.mul(rippleCrests).mul(0.16)));

    const contactAnchors = [
        [-18, -1, 3.6, 0.44], [13, -5, 2.4, 0.30], [16, -8, 1.9, 0.24],
        [-13, -19, 2.1, 0.24], [18.5, -19, 4.2, 0.48],
    ];
    let contactDarkening = float(0);
    contactAnchors.forEach(([x, z, radius, strength]) => {
        const distance = length(waterPosition.sub(vec2(x, z)));
        contactDarkening = contactDarkening.add(
            smoothstep(0, radius, distance).oneMinus().mul(strength),
        );
    });
    contactDarkening = clamp(contactDarkening, 0, 0.58);
    waterColor = waterColor.mul(float(1).sub(contactDarkening));

    let reflectionNode = null;
    if (reflectionMode === 'reflector') {
        reflectionNode = reflector({
            resolutionScale: quality.reflectorScale,
            generateMipmaps: true,
            bounces: false,
            samples: 0,
        });
        reflectionNode.target.rotateX(-Math.PI / 2);
        reflectionNode.target.position.y = WATER_Y;
        add(reflectionNode.target);

        const reflectionCamera = reflectionNode.reflector.getVirtualCamera(camera);
        reflectionCamera.layers.set(REFLECTION_LAYER);

        const reflectionUv = screenUV.flipX().add(opticalSlope.mul(0.017));
        const reflectionBlur = clamp(
            mix(float(0.078), float(0.012), smoothstep(0.02, 0.72, fresnel))
                .add(calmMask.mul(0.018)),
            0.01,
            0.10,
        );
        const reflected = reflectionNode.sample(reflectionUv).blur(reflectionBlur).rgb;
        const reflectionWeight = clamp(fresnel.mul(0.92).add(0.060), 0.055, 0.84)
            .mul(float(1).sub(shoreBand.mul(0.28)));
        waterColor = mix(waterColor, reflected.mul(vec3(0.86, 0.96, 0.92)), reflectionWeight);
    } else if (reflectionMode === 'analytic') {
        // Low-tier silhouettes are narrow broken lanes, never circular color blobs.
        const skyReflection = mix(vec3(0.018, 0.062, 0.058), vec3(0.11, 0.24, 0.22), fresnel);
        const brokenLane = (x, z, width, reach, phase) => {
            const bend = sin(waterPosition.y.mul(0.46).add(uTime.mul(0.18)).add(phase)).mul(0.36);
            const across = abs(waterPosition.x.sub(x).sub(bend));
            const along = abs(waterPosition.y.sub(z).sub(reach * 0.35));
            const lane = smoothstep(width * 0.28, width, across).oneMinus();
            const falloff = smoothstep(reach * 0.12, reach, along).oneMinus();
            const breakup = smoothstep(
                0.30,
                0.76,
                sin(waterPosition.y.mul(1.7).add(phase)).mul(0.5).add(0.5),
            );
            return lane.mul(falloff).mul(breakup.mul(0.62).add(0.18));
        };
        const spiritLane = brokenLane(-18, -20, 1.35, 13, 1.2);
        const trollLane = brokenLane(18.5, -19, 2.8, 10, 3.7);
        let analyticReflection = skyReflection
            .add(vec3(0.74, 0.64, 0.36).mul(spiritLane.mul(0.44)))
            .sub(vec3(0.016, 0.030, 0.025).mul(trollLane.mul(0.72)));
        analyticReflection = analyticReflection.mul(mix(float(0.76), float(0.94), fresnel));
        const analyticWeight = clamp(fresnel.mul(0.72).add(0.055), 0.04, 0.58);
        waterColor = mix(waterColor, analyticReflection, analyticWeight);
    }

    // Restrained moon glints survive reflection-off captures and prove the optical normal.
    const moonDirection = normalize(vec3(-0.32, 0.84, 0.43));
    const halfVector = normalize(viewDirection.add(moonDirection));
    const glint = pow(max(dot(opticalNormal, halfVector), float(0)), float(48))
        .mul(smoothstep(0.15, 0.9, calmMask).oneMinus().mul(0.48).add(0.08));
    waterColor = waterColor.add(vec3(0.52, 0.80, 0.75).mul(glint.mul(0.62)));

    const waterMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    waterMaterial.colorNode = waterColor;
    waterMaterial.opacityNode = mix(float(0.64), float(0.88), shoreDepth);
    waterMaterial.transparent = true;
    waterMaterial.depthWrite = false;
    // The lake has upward-facing winding and is always viewed from above. FrontSide
    // avoids r181's second transparent DoubleSide pass across the full hero surface.
    waterMaterial.side = THREE.FrontSide;
    waterMaterial.fog = true;
    const water = add(new THREE.Mesh(lakeGeometry, waterMaterial));
    water.position.y = WATER_Y;
    water.renderOrder = 20;

    // Optional board-safe guide visualizes the calm optical sanctuary. It stays
    // on layer 0 and therefore never contaminates the High reflector pass.
    let boardGuide = null;
    if (boardGuideEnabled) {
        boardGuide = new THREE.Group();
        boardGuide.name = 'stillwater-board-guide';
        const guideMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
        guideMaterial.colorNode = vec3(0.58, 0.78, 0.72).mul(0.28);
        guideMaterial.transparent = true;
        guideMaterial.opacity = 0.26;
        guideMaterial.depthWrite = false;
        const horizontal = ownGeometry(new THREE.BoxGeometry(13.2, 0.08, 0.08));
        const vertical = ownGeometry(new THREE.BoxGeometry(0.08, 21.2, 0.08));
        [[0, -10.6, horizontal], [0, 10.6, horizontal], [-6.6, 0, vertical], [6.6, 0, vertical]]
            .forEach(([x, y, geometry]) => {
                const edge = new THREE.Mesh(geometry, guideMaterial);
                edge.position.set(x, y, 0);
                boardGuide.add(edge);
            });
        boardGuide.position.set(0, 10.8, -2.2);
        boardGuide.renderOrder = 50;
        add(boardGuide);
    }

    // r181 grade preview: one explicit ACES transform followed by a compact
    // nonlinear teal-shadow / warm-highlight grade and restrained vignette.
    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const aces = toneMapping(THREE.ACESFilmicToneMapping, 1.0, sceneColor);
    const luminance = dot(aces.rgb, vec3(0.2126, 0.7152, 0.0722));
    const shadowMask = smoothstep(0.08, 0.44, luminance).oneMinus();
    const highlightMask = smoothstep(0.52, 0.92, luminance);
    const tealShadow = mix(vec3(1), vec3(0.90, 1.035, 0.985), shadowMask.mul(0.24));
    const warmHighlight = vec3(0.060, 0.024, 0.004).mul(highlightMask.mul(0.48));
    const screenCenter = screenUV.sub(0.5);
    const vignette = clamp(float(1).sub(dot(screenCenter, screenCenter).mul(0.42)), 0.86, 1);
    const graded = aces.rgb.mul(tealShadow).add(warmHighlight).mul(vignette);
    const finalColor = gradeMode === 'aces' ? aces.rgb : graded;
    const post = new THREE.PostProcessing(renderer);
    post.outputColorTransform = false;
    post.outputNode = renderOutput(vec4(finalColor, aces.a), THREE.NoToneMapping);

    const diagnostics = {
        id: meta.id,
        quality: qualityName,
        layout,
        backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
        reflectionRequest,
        reflectionMode,
        reflectionScale: reflectionMode === 'reflector' ? quality.reflectorScale : 0,
        reflectionLayer: reflectionMode === 'reflector' ? REFLECTION_LAYER : null,
        materialXFlow: true,
        detailFlow: quality.detailFlow,
        calmMask: true,
        shoreDepth: true,
        contactDarkening: true,
        submergedShapes: stoneLayout.length,
        causticLayers: quality.secondCaustic ? 2 : 1,
        wakeSlots: 0,
        computeFeedback: false,
        boardGuide: boardGuideEnabled,
        grade: gradeMode === 'aces' ? 'ACES-1.0-only' : 'ACES-1.0-teal-shadow-warm-highlight',
    };
    const debugApi = Object.freeze({
        getDiagnostics: () => ({ ...diagnostics }),
        getRendererCounters: () => rendererCounters(renderer),
    });
    window.__STILLWATER_WATER__ = debugApi;

    return {
        getDiagnostics: debugApi.getDiagnostics,
        getRendererCounters: debugApi.getRendererCounters,
        camera(_time, activeCamera) {
            activeCamera.position.set(0, 17.5, 36);
            activeCamera.lookAt(0, 1.6, -13);
            activeCamera.fov = 46;
            activeCamera.near = 0.1;
            activeCamera.far = 520;
            activeCamera.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            spirit.position.y = 5.1 + Math.sin(time * 0.52) * 0.22;
            spirit.rotation.y = Math.sin(time * 0.18) * 0.14;
            troll.rotation.y = -0.48 + Math.sin(time * 0.09) * 0.05;
        },
        render: () => post.render(),
        renderAsync: async () => post.render(),
        dispose() {
            if (window.__STILLWATER_WATER__ === debugApi) delete window.__STILLWATER_WATER__;
            scene.remove(root);
            reflectionNode?.dispose?.();
            scenePass.dispose?.();
            post.dispose?.();
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            scene.background = previous.background;
            scene.fog = previous.fog;
            camera.fov = previous.fov;
            camera.near = previous.near;
            camera.far = previous.far;
            camera.position.copy(previous.position);
            camera.quaternion.copy(previous.quaternion);
            camera.updateProjectionMatrix();
        },
    };
}
