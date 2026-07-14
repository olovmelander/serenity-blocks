/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond v2 — black-jade water optics study.
 *
 * This slice isolates the pond surface before the production-theme port:
 * layered analytic waves, a wave-derived optical normal, real scene-depth
 * absorption, guarded framebuffer refraction, animated caustics projected onto
 * the pond floor, and an opt-in selective planar-reflection experiment. Feedback
 * ripples remain deferred until the optical tiers have been measured.
 *
 *   ?effect=koi-pond-water&quality=High&orbit=0&t=12
 *   ?effect=koi-pond-water&quality=High&reflection=1&orbit=0&t=12
 *   ?effect=koi-pond-water&quality=Low&orbit=0&t=12
 *   ?effect=koi-pond-water&quality=High&orbit=0&t=12&forceWebGL=1
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    cameraFar,
    cameraNear,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    hash,
    instanceIndex,
    length,
    linearDepth,
    max,
    mix,
    mx_noise_float as noiseFloat,
    mx_worley_noise_float as worleyNoise,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    pow,
    reflector,
    screenUV,
    sin,
    smoothstep,
    transformNormalToView,
    uniform,
    vec2,
    vec3,
    viewportDepthTexture,
    viewportSafeUV,
    viewportSharedTexture,
} from 'three/tsl';

export const meta = {
    id: 'koi-pond-water',
    title: 'Koi Pond v2 — Black-Jade Water',
    description: 'Black-jade refraction, projected caustics, submerged koi, and selective planar reflection.',
};

const TAU = Math.PI * 2;
const POND_CENTER_Z = -6;
const POND_RADIUS_X = 20;
const POND_RADIUS_Z = 13;
const REFLECTION_LAYER = 2;
const REFLECTION_SCALE = 0.4;

const QUALITY_PRESETS = Object.freeze({
    Minimal: Object.freeze({
        waveLayers: 2, causticLayers: 1, refraction: false, reflectionEligible: false,
    }),
    Low: Object.freeze({
        waveLayers: 3, causticLayers: 1, refraction: false, reflectionEligible: false,
    }),
    Medium: Object.freeze({
        waveLayers: 3, causticLayers: 1, refraction: true, reflectionEligible: false,
    }),
    High: Object.freeze({
        waveLayers: 3, causticLayers: 2, refraction: true, reflectionEligible: true,
    }),
    Ultra: Object.freeze({
        waveLayers: 3, causticLayers: 2, refraction: true, reflectionEligible: true,
    }),
    Extreme: Object.freeze({
        waveLayers: 3, causticLayers: 2, refraction: true, reflectionEligible: true,
    }),
});

const FISH_PATHS = Object.freeze([
    Object.freeze({
        cx: -4.5, cz: -2.5, rx: 7.4, rz: 3.6, phase: 0.2, speed: 0.17, scale: 1.2, depth: -1.05,
    }),
    Object.freeze({
        cx: 4.8, cz: -8.0, rx: 8.4, rz: 3.8, phase: 2.4, speed: -0.12, scale: 0.88, depth: -1.55,
    }),
    Object.freeze({
        cx: -1.5, cz: -10.5, rx: 5.5, rz: 5.0, phase: 4.3, speed: 0.10, scale: 0.76, depth: -1.9,
    }),
    Object.freeze({
        cx: 7.0, cz: -1.5, rx: 4.3, rz: 5.7, phase: 5.1, speed: -0.14, scale: 0.68, depth: -1.3,
    }),
]);

const SUBMERGED_STONES = Object.freeze([
    [-13.6, 0.8, 1.05, 0.2], [-11.1, -0.6, 0.78, -0.4], [-9.3, 1.3, 0.62, 0.6],
    [-15.2, -2.7, 0.88, -0.2], [-12.7, -4.0, 0.56, 0.8], [-8.2, -3.2, 0.72, 0.1],
    [11.7, -10.8, 0.70, -0.7], [14.1, -8.2, 0.48, 0.4], [9.8, -12.2, 0.54, 0.2],
]);

const RIM_STONE_PHASES = Object.freeze([
    0.000, 0.035, 0.076, 0.118, 0.154,
    0.345, 0.382, 0.417, 0.454, 0.491, 0.532, 0.574, 0.614, 0.651,
    0.684, 0.716, 0.751, 0.789, 0.833, 0.875, 0.914, 0.950, 0.980,
]);

function resolveQuality(params, requestedQuality) {
    const requested = String(
        requestedQuality
        || params?.get?.('quality')
        || (typeof window !== 'undefined' && window.settings?.graphicsQuality)
        || 'High',
    ).toLowerCase();

    return Object.keys(QUALITY_PRESETS)
        .find((name) => name.toLowerCase() === requested) || 'High';
}

function enableReflectionLayer(object) {
    object.traverse((child) => child.layers.enable(REFLECTION_LAYER));
    return object;
}

function pondRadiusAt(x, z) {
    return Math.min(1, Math.hypot(x / POND_RADIUS_X, (z - POND_CENTER_Z) / POND_RADIUS_Z));
}

function pondBottomHeight(x, z) {
    const radius = pondRadiusAt(x, z);
    const basin = (1 - radius) ** 0.62;
    const shelfDistance = Math.hypot((x + 11.5) / 7.5, (z + 0.5) / 5.0);
    const shelf = Math.max(0, 1 - shelfDistance) ** 1.6;
    return -0.28 - basin * 4.15 + shelf * 1.65;
}

function makeEllipticalGeometry(innerRadius, outerRadius, radialSegments, rings, heightAt) {
    const geometry = new THREE.RingGeometry(
        innerRadius,
        outerRadius,
        radialSegments,
        rings,
    );
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
        const normalizedX = positions.getX(index);
        const normalizedZ = positions.getZ(index);
        const x = normalizedX * POND_RADIUS_X;
        const z = POND_CENTER_Z + normalizedZ * POND_RADIUS_Z;
        positions.setXYZ(index, x, heightAt?.(x, z) ?? 0, z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeTailGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.75, 0, 0,
        -1.75, 0, 0.72,
        -1.42, 0, 0,
        -1.75, 0, -0.72,
    ], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeCausticField(uTime, layerCount) {
    const pondCoord = positionWorld.xz;
    const causticA = worleyNoise(
        pondCoord.mul(0.62).add(vec2(uTime.mul(0.105), uTime.mul(-0.064))),
        0.82,
    );

    if (layerCount < 2) {
        const contourDistance = abs(causticA.sub(0.42));
        return pow(
            smoothstep(0.014, 0.062, contourDistance).oneMinus(),
            float(2.2),
        ).mul(0.38);
    }

    const causticB = worleyNoise(
        pondCoord.mul(0.87).add(vec2(uTime.mul(-0.073), uTime.mul(0.091))),
        0.72,
    );
    return pow(abs(causticA.sub(causticB)).mul(1.35).clamp(0, 1), float(2.35));
}

function makeWaveField(uTime, layerCount) {
    const pondCoord = positionGeometry.xz;
    const directionA = vec2(0.916, 0.401);
    const directionB = vec2(-0.365, 0.931);
    const directionC = vec2(0.719, -0.695);

    const frequencyA = 0.46;
    const frequencyB = 0.73;
    const frequencyC = 1.31;
    const amplitudeA = 0.068;
    const amplitudeB = 0.034;
    const amplitudeC = 0.014;

    const phaseA = dot(pondCoord, directionA).mul(frequencyA).add(uTime.mul(0.39));
    const phaseB = dot(pondCoord, directionB).mul(frequencyB).sub(uTime.mul(0.51));
    const derivativeA = cos(phaseA).mul(amplitudeA * frequencyA);
    const derivativeB = cos(phaseB).mul(amplitudeB * frequencyB);

    let height = sin(phaseA).mul(amplitudeA).add(sin(phaseB).mul(amplitudeB));
    let slopeX = derivativeA.mul(directionA.x).add(derivativeB.mul(directionB.x));
    let slopeZ = derivativeA.mul(directionA.y).add(derivativeB.mul(directionB.y));

    if (layerCount >= 3) {
        const phaseC = dot(pondCoord, directionC).mul(frequencyC).add(uTime.mul(0.77));
        const derivativeC = cos(phaseC).mul(amplitudeC * frequencyC);
        height = height.add(sin(phaseC).mul(amplitudeC));
        slopeX = slopeX.add(derivativeC.mul(directionC.x));
        slopeZ = slopeZ.add(derivativeC.mul(directionC.y));
    }

    return {
        height,
        normal: normalize(vec3(slopeX.mul(-2.25), 1, slopeZ.mul(-2.25))),
    };
}

export function create({
    scene, camera, renderer, params, quality: requestedQuality,
}) {
    const qualityName = resolveQuality(params, requestedQuality);
    const quality = QUALITY_PRESETS[qualityName];
    const reflectionRequested = params?.get?.('reflection') === '1';
    const reflectionEnabled = reflectionRequested && quality.reflectionEligible;
    const root = new THREE.Group();
    root.name = 'koi-pond-water-study';
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

    const previousState = {
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

    scene.background = new THREE.Color(0x04161a);
    scene.fog = new THREE.FogExp2(0x041216, 0.0105);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;

    const uTime = uniform(0);
    const causticField = makeCausticField(uTime, quality.causticLayers);

    // A low moss-and-stone collar encloses the optical study without turning it
    // into another full landscape composition.
    const bankMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const grain = noiseFloat(positionWorld.mul(0.18)).mul(0.5).add(0.5);
        const pondCoord = positionWorld.xz.sub(vec2(0, POND_CENTER_Z));
        const radial = length(vec2(
            pondCoord.x.div(POND_RADIUS_X),
            pondCoord.y.div(POND_RADIUS_Z),
        ));
        const outerFade = smoothstep(1.02, 1.45, radial);
        const innerMoss = mix(
            vec3(0.015, 0.023, 0.021),
            vec3(0.055, 0.095, 0.052),
            grain.mul(0.72),
        );
        bankMaterial.colorNode = mix(innerMoss, vec3(0.002, 0.009, 0.010), outerFade);
        bankMaterial.roughnessNode = float(0.98);
        bankMaterial.metalnessNode = float(0);
    }
    add(new THREE.Mesh(
        ownGeometry(makeEllipticalGeometry(1, 1.45, 112, 6, () => -0.18)),
        bankMaterial,
    ));

    // The bowl is real geometry: shallow near the rim and on the near-left
    // shelf, descending into a black-jade central basin.
    const bedMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const pondCoord = positionWorld.xz.sub(vec2(0, POND_CENTER_Z));
        const radial = length(vec2(
            pondCoord.x.div(POND_RADIUS_X),
            pondCoord.y.div(POND_RADIUS_Z),
        ));
        const shallowRim = smoothstep(0.50, 0.98, radial);
        const shelf = smoothstep(
            2.2,
            9.0,
            length(positionWorld.xz.sub(vec2(-11.5, -0.5))),
        ).oneMinus();
        const sediment = noiseFloat(positionWorld.mul(0.22)).mul(0.5).add(0.5);
        const shallowLight = clamp(shallowRim.add(shelf.mul(0.86)), 0, 1);
        const bedBase = mix(
            vec3(0.008, 0.026, 0.026),
            vec3(0.105, 0.145, 0.068),
            shallowLight.mul(0.74).add(sediment.mul(0.18)),
        );
        const causticEnergy = causticField.mul(shallowLight.mul(0.78).add(0.18));
        bedMaterial.colorNode = bedBase.add(vec3(0.26, 0.66, 0.46).mul(causticEnergy.mul(0.72)));
        bedMaterial.roughnessNode = mix(float(0.98), float(0.70), causticEnergy);
        bedMaterial.metalnessNode = float(0);
    }
    add(new THREE.Mesh(
        ownGeometry(makeEllipticalGeometry(0, 1, 112, 22, pondBottomHeight)),
        bedMaterial,
    ));

    const stoneGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 1));
    const rimStoneMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const stoneGrain = noiseFloat(positionWorld.mul(0.31)).mul(0.5).add(0.5);
        rimStoneMaterial.colorNode = mix(
            vec3(0.028, 0.034, 0.032),
            vec3(0.095, 0.125, 0.074),
            stoneGrain.mul(0.72),
        );
        rimStoneMaterial.roughnessNode = float(0.94);
    }
    const rimStoneCount = RIM_STONE_PHASES.length;
    const rimStones = add(new THREE.InstancedMesh(
        stoneGeometry,
        rimStoneMaterial,
        rimStoneCount,
    ));
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    for (let index = 0; index < rimStoneCount; index += 1) {
        const angle = RIM_STONE_PHASES[index] * TAU + Math.sin(index * 4.13) * 0.025;
        const size = 0.48 + (Math.sin(index * 12.73) * 0.5 + 0.5) * 0.48;
        const radialOffset = 1.012 + Math.sin(index * 2.71) * 0.018;
        position.set(
            Math.cos(angle) * POND_RADIUS_X * radialOffset,
            -0.02 + Math.sin(index * 4.17) * 0.08,
            POND_CENTER_Z + Math.sin(angle) * POND_RADIUS_Z * radialOffset,
        );
        euler.set(index * 0.31, -angle + index * 0.07, index * 0.13);
        quaternion.setFromEuler(euler);
        scale.set(size * 1.18, size * 0.56, size * 0.86);
        matrix.compose(position, quaternion, scale);
        rimStones.setMatrixAt(index, matrix);
    }
    rimStones.instanceMatrix.needsUpdate = true;
    rimStones.computeBoundingSphere();

    const submergedStoneMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const stoneVariation = noiseFloat(positionWorld.mul(0.45)).mul(0.5).add(0.5);
        const stoneBase = mix(vec3(0.14, 0.17, 0.12), vec3(0.48, 0.45, 0.31), stoneVariation);
        submergedStoneMaterial.colorNode = stoneBase
            .add(vec3(0.34, 0.74, 0.48).mul(causticField.mul(0.48)));
        submergedStoneMaterial.roughnessNode = float(0.82);
    }
    const submergedStones = add(new THREE.InstancedMesh(
        stoneGeometry,
        submergedStoneMaterial,
        SUBMERGED_STONES.length,
    ));
    SUBMERGED_STONES.forEach((entry, index) => {
        const [x, z, size, rotation] = entry;
        position.set(x, pondBottomHeight(x, z) + size * 0.42, z);
        euler.set(rotation * 0.5, rotation, -rotation * 0.35);
        quaternion.setFromEuler(euler);
        scale.set(size * 1.35, size * 0.62, size);
        matrix.compose(position, quaternion, scale);
        submergedStones.setMatrixAt(index, matrix);
    });
    submergedStones.instanceMatrix.needsUpdate = true;
    submergedStones.computeBoundingSphere();

    // High-contrast porcelain/vermilion koi are deliberate optical targets:
    // refraction should bend them without muddying their silhouette.
    const koiMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const phase = hash(instanceIndex).mul(TAU);
        const patchField = sin(positionGeometry.x.mul(3.8).add(phase))
            .add(sin(positionGeometry.z.mul(4.6).sub(phase.mul(0.72))))
            .mul(0.25).add(0.5);
        const vermilionMask = smoothstep(0.46, 0.67, patchField);
        const dorsalShade = smoothstep(-0.2, 0.72, positionGeometry.y);
        const porcelain = mix(vec3(0.72, 0.69, 0.56), vec3(1.0, 0.91, 0.70), dorsalShade);
        const vermilion = mix(vec3(0.62, 0.055, 0.018), vec3(1.0, 0.22, 0.045), dorsalShade);
        koiMaterial.colorNode = mix(porcelain, vermilion, vermilionMask)
            .add(vec3(0.12, 0.38, 0.25).mul(causticField.mul(0.22)));
        koiMaterial.roughnessNode = float(0.38);
        koiMaterial.metalnessNode = float(0);
    }
    const fishBodies = add(new THREE.InstancedMesh(
        ownGeometry(new THREE.SphereGeometry(1, 20, 12)),
        koiMaterial,
        FISH_PATHS.length,
    ));

    const tailMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    tailMaterial.colorNode = vec3(0.92, 0.42, 0.14)
        .add(vec3(0.10, 0.34, 0.22).mul(causticField.mul(0.18)));
    tailMaterial.roughnessNode = float(0.42);
    tailMaterial.side = THREE.DoubleSide;
    const fishTails = add(new THREE.InstancedMesh(
        ownGeometry(makeTailGeometry()),
        tailMaterial,
        FISH_PATHS.length,
    ));

    const padMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const padGrain = noiseFloat(positionWorld.mul(0.36)).mul(0.5).add(0.5);
        padMaterial.colorNode = mix(vec3(0.025, 0.09, 0.055), vec3(0.11, 0.30, 0.13), padGrain);
        padMaterial.roughnessNode = float(0.86);
    }
    const padGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1.05, 0.10, 28, 1));
    const pads = add(new THREE.InstancedMesh(padGeometry, padMaterial, 5));
    const padLayout = [
        [13.8, -3.6, 1.75, 0.2], [15.7, -7.1, 1.15, -0.5], [11.9, -8.8, 1.35, 0.7],
        [-15.2, -9.4, 1.05, 0.1], [-13.4, -11.2, 0.82, -0.8],
    ];
    padLayout.forEach((entry, index) => {
        position.set(entry[0], 0.17, entry[1]);
        euler.set(0, entry[3], 0);
        quaternion.setFromEuler(euler);
        scale.set(entry[2], 1, entry[2] * 0.78);
        matrix.compose(position, quaternion, scale);
        pads.setMatrixAt(index, matrix);
    });
    pads.instanceMatrix.needsUpdate = true;
    pads.computeBoundingSphere();

    // Three sparse far-bank value families make the reflector judgeable without
    // building the whole Koi Pond landscape: cool moon, dark willow, warm lantern.
    // Their footprints stay outside the central gameplay sanctuary.
    const moonMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const moonMottle = noiseFloat(positionWorld.mul(0.55)).mul(0.5).add(0.5);
        const moonLight = clamp(
            dot(normalize(positionGeometry), normalize(vec3(-0.34, 0.56, 0.76)))
                .mul(0.62).add(0.48),
            0.18,
            1,
        );
        const moonBase = mix(
            vec3(0.19, 0.34, 0.31),
            vec3(0.72, 0.84, 0.76),
            moonLight,
        );
        moonMaterial.colorNode = moonBase.mul(mix(float(0.78), float(1), moonMottle));
    }
    const moon = add(new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(2.0, 20, 12)),
        moonMaterial,
    ));
    moon.position.set(-14.5, 6.5, -22);
    moon.name = 'koi-water-moon-proxy';

    const willowMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const leafGrain = noiseFloat(positionWorld.mul(0.16)).mul(0.5).add(0.5);
        willowMaterial.colorNode = mix(
            vec3(0.004, 0.016, 0.012),
            vec3(0.030, 0.095, 0.061),
            leafGrain.mul(0.72),
        );
        willowMaterial.roughnessNode = float(0.97);
    }
    const willowCanopies = add(new THREE.InstancedMesh(
        ownGeometry(new THREE.SphereGeometry(1, 14, 9)),
        willowMaterial,
        2,
    ));
    [
        [-24.5, 5.3, -16, 4.0, 2.2, 3.0],
        [-21.2, 7.3, -20, 3.5, 2.2, 2.9],
    ].forEach((entry, index) => {
        position.set(entry[0], entry[1], entry[2]);
        quaternion.setFromEuler(euler.set(0, index * 0.72 - 0.28, index * 0.11));
        scale.set(entry[3], entry[4], entry[5]);
        matrix.compose(position, quaternion, scale);
        willowCanopies.setMatrixAt(index, matrix);
    });
    willowCanopies.instanceMatrix.needsUpdate = true;
    willowCanopies.computeBoundingSphere();
    willowCanopies.name = 'koi-water-willow-canopies';

    const branchMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    branchMaterial.colorNode = vec3(0.026, 0.021, 0.016);
    branchMaterial.roughnessNode = float(1);
    const willowBranches = add(new THREE.InstancedMesh(
        ownGeometry(new THREE.CylinderGeometry(1, 1, 2, 7, 1)),
        branchMaterial,
        3,
    ));
    const branchAxis = new THREE.Vector3(0, 1, 0);
    const branchStart = new THREE.Vector3();
    const branchEnd = new THREE.Vector3();
    const branchDirection = new THREE.Vector3();
    [
        [-22, 0, -19, -22, 5.8, -19, 0.48],
        [-22, 4.8, -19, -17.2, 6.6, -21, 0.28],
        [-22, 4.0, -19, -24.5, 5.4, -16, 0.25],
    ].forEach((entry, index) => {
        branchStart.set(entry[0], entry[1], entry[2]);
        branchEnd.set(entry[3], entry[4], entry[5]);
        branchDirection.subVectors(branchEnd, branchStart);
        const branchLength = branchDirection.length();
        position.copy(branchStart).add(branchEnd).multiplyScalar(0.5);
        quaternion.setFromUnitVectors(branchAxis, branchDirection.normalize());
        scale.set(entry[6], branchLength * 0.5, entry[6]);
        matrix.compose(position, quaternion, scale);
        willowBranches.setMatrixAt(index, matrix);
    });
    willowBranches.instanceMatrix.needsUpdate = true;
    willowBranches.computeBoundingSphere();
    willowBranches.name = 'koi-water-willow-branches';

    const lanternStoneMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    lanternStoneMaterial.colorNode = vec3(0.035, 0.052, 0.043);
    lanternStoneMaterial.roughnessNode = float(0.96);
    const lanternStone = add(new THREE.InstancedMesh(
        ownGeometry(new THREE.BoxGeometry(1, 1, 1)),
        lanternStoneMaterial,
        7,
    ));
    [
        [13.8, 0.28, -20, 2.2, 0.56, 1.8],
        [13.8, 1.55, -20, 0.68, 2.05, 0.68],
        [13.8, 2.72, -20, 1.85, 0.30, 1.45],
        [13.18, 3.35, -20, 0.25, 0.95, 0.28],
        [14.42, 3.35, -20, 0.25, 0.95, 0.28],
        [13.8, 3.92, -20, 1.78, 0.34, 1.48],
        [13.8, 4.28, -20, 0.34, 0.42, 0.34],
    ].forEach((entry, index) => {
        position.set(entry[0], entry[1], entry[2]);
        quaternion.identity();
        scale.set(entry[3], entry[4], entry[5]);
        matrix.compose(position, quaternion, scale);
        lanternStone.setMatrixAt(index, matrix);
    });
    lanternStone.instanceMatrix.needsUpdate = true;
    lanternStone.computeBoundingSphere();
    lanternStone.name = 'koi-water-stone-lantern';

    const lanternGlowMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    lanternGlowMaterial.colorNode = vec3(1.0, 0.28, 0.07);
    const lanternGlow = add(new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(1, 14, 8)),
        lanternGlowMaterial,
    ));
    lanternGlow.position.set(13.8, 3.36, -20);
    lanternGlow.scale.set(0.70, 0.48, 0.58);
    lanternGlow.name = 'koi-water-lantern-aperture';

    let reflectionNode = null;
    if (reflectionEnabled) {
        [
            rimStones,
            pads,
            moon,
            willowCanopies,
            willowBranches,
            lanternStone,
            lanternGlow,
        ].forEach(enableReflectionLayer);

        reflectionNode = reflector({
            resolutionScale: REFLECTION_SCALE,
            bounces: false,
            generateMipmaps: false,
            samples: 0,
        });
        reflectionNode.target.rotateX(-Math.PI / 2);
        reflectionNode.target.position.set(0, 0, 0);
        reflectionNode.target.name = 'koi-pond-reflector-plane';
        add(reflectionNode.target);

        const reflectionCamera = reflectionNode.reflector.getVirtualCamera(camera);
        reflectionCamera.layers.set(REFLECTION_LAYER);
    }

    // Surface optics. MeshBasicNodeMaterial ignores normalNode in r181, so the
    // analytic normal is consumed directly by Fresnel, glint, and refraction.
    const waveField = makeWaveField(uTime, quality.waveLayers);
    const waterMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const pondCoord = positionGeometry.xz.sub(vec2(0, POND_CENTER_Z));
        const radial = length(vec2(
            pondCoord.x.div(POND_RADIUS_X),
            pondCoord.y.div(POND_RADIUS_Z),
        ));
        const edgeInset = smoothstep(0.72, 0.965, radial).oneMinus();
        const edgeOpacity = smoothstep(0.94, 0.998, radial).oneMinus();
        const viewDirection = normalize(cameraPosition.sub(positionWorld));
        const viewFacing = max(dot(waveField.normal, viewDirection), float(0));
        const fresnel = float(0.025).add(
            float(0.975).mul(pow(float(1).sub(viewFacing), float(5))),
        );

        let depthFactor = pow(edgeInset, float(0.74));
        let transmitted = mix(
            vec3(0.045, 0.17, 0.12),
            vec3(0.003, 0.025, 0.028),
            depthFactor,
        );
        const normalView = transformNormalToView(waveField.normal);

        if (quality.refraction) {
            const candidateUv = clamp(
                screenUV.add(normalView.xy.mul(0.013).mul(edgeInset)),
                vec2(0.002),
                vec2(0.998),
            );
            const safeUv = viewportSafeUV(candidateUv);
            const refracted = viewportSharedTexture(safeUv).rgb;
            const surfaceDepth = linearDepth();
            const sceneDepth = linearDepth(viewportDepthTexture(safeUv));
            const thickness = max(sceneDepth.sub(surfaceDepth), float(0))
                .mul(cameraFar.sub(cameraNear));
            depthFactor = smoothstep(0.35, 4.8, thickness);
            const absorption = mix(
                vec3(0.94, 1.0, 0.90),
                vec3(0.16, 0.50, 0.37),
                depthFactor,
            );
            const deepScatter = mix(
                vec3(0.028, 0.13, 0.09),
                vec3(0.002, 0.020, 0.024),
                depthFactor,
            );
            transmitted = mix(
                refracted.mul(absorption),
                deepScatter,
                depthFactor.mul(0.62).add(0.08),
            );
        }

        const reflectedVariation = sin(positionWorld.x.mul(0.08)
            .add(positionWorld.z.mul(0.055))).mul(0.5).add(0.5);
        let reflectedCanopy = mix(
            vec3(0.006, 0.034, 0.030),
            vec3(0.055, 0.14, 0.11),
            reflectedVariation,
        );

        if (reflectionNode) {
            // sample() bypasses ReflectorNode's default UV, so retain its X flip.
            // A small view-space normal offset creates water motion while the
            // authored canopy remains as a quiet color floor between silhouettes.
            const reflectionRipple = vec2(
                sin(positionWorld.z.mul(2.4).sub(uTime.mul(0.25))).mul(0.0038)
                    .add(sin(positionWorld.z.mul(5.8).add(uTime.mul(0.41))).mul(0.0015)),
                cos(positionWorld.x.mul(0.9).add(uTime.mul(0.17))).mul(0.0008),
            ).mul(edgeInset);
            const reflectionUv = clamp(
                screenUV.flipX()
                    .add(normalView.xy.mul(0.018).mul(edgeInset))
                    .add(reflectionRipple),
                vec2(0.002),
                vec2(0.998),
            );
            const reflectionContinuity = mix(
                float(0.80),
                float(1),
                smoothstep(
                    0.24,
                    0.76,
                    sin(positionWorld.z.mul(2.1).sub(uTime.mul(0.22))).mul(0.5).add(0.5),
                ),
            );
            const planarReflection = reflectionNode.sample(reflectionUv).rgb
                .mul(vec3(0.82, 0.94, 0.90))
                .mul(reflectionContinuity);
            reflectedCanopy = mix(reflectedCanopy, planarReflection, float(0.72));
        }
        const reflectionWeight = clamp(fresnel.mul(0.92).add(0.035), 0, 0.82);
        let waterColor = mix(transmitted, reflectedCanopy, reflectionWeight);

        const moonDirection = normalize(vec3(-0.32, 0.79, -0.52));
        const halfVector = normalize(viewDirection.add(moonDirection));
        const specular = pow(
            max(dot(waveField.normal, halfVector), float(0)),
            float(138),
        );
        const glintBreakup = pow(abs(sin(
            positionWorld.x.mul(0.43)
                .add(positionWorld.z.mul(0.91))
                .sub(uTime.mul(0.31)),
        )), float(8));
        const moonLane = smoothstep(
            0.4,
            4.6,
            abs(positionWorld.x.add(positionWorld.z.mul(0.18)).add(5.2)),
        ).oneMinus();
        const glint = specular.mul(glintBreakup.mul(0.76).add(0.24)).mul(moonLane);
        waterColor = waterColor.add(vec3(0.42, 0.78, 0.62).mul(glint.mul(0.46)));

        const shallowHalo = smoothstep(0.72, 0.98, radial)
            .mul(causticField)
            .mul(float(1).sub(fresnel));
        waterColor = waterColor.add(vec3(0.07, 0.32, 0.20).mul(shallowHalo.mul(0.16)));

        waterMaterial.colorNode = waterColor;
        waterMaterial.opacityNode = edgeOpacity.mul(quality.refraction ? 1 : 0.76);
        waterMaterial.positionNode = positionLocal.add(vec3(0, waveField.height, 0));
        waterMaterial.transparent = true;
        waterMaterial.depthWrite = false;
        waterMaterial.side = THREE.DoubleSide;
        waterMaterial.toneMapped = true;
        waterMaterial.fog = false;
    }
    const water = add(new THREE.Mesh(
        ownGeometry(makeEllipticalGeometry(0, 1, 128, 28, () => 0)),
        waterMaterial,
    ));
    water.renderOrder = 20;

    const hemisphere = add(new THREE.HemisphereLight(0xa6d7bd, 0x07100d, 1.55));
    const moonKey = add(new THREE.DirectionalLight(0xcdf3dc, 2.75));
    moonKey.position.set(-12, 24, 10);
    const warmBounce = add(new THREE.PointLight(0xff6b35, 7.0, 24, 2));
    warmBounce.position.set(-7, 4, -3);
    hemisphere.name = 'koi-water-hemisphere';
    moonKey.name = 'koi-water-moon-key';
    warmBounce.name = 'koi-water-warm-bounce';
    if (reflectionEnabled) {
        [hemisphere, moonKey, warmBounce].forEach(enableReflectionLayer);
    }

    const updateFish = (time) => {
        FISH_PATHS.forEach((fish, index) => {
            const phase = fish.phase + time * fish.speed;
            const x = fish.cx + Math.cos(phase) * fish.rx;
            const z = fish.cz + Math.sin(phase) * fish.rz;
            const directionX = -Math.sin(phase) * fish.rx * fish.speed;
            const directionZ = Math.cos(phase) * fish.rz * fish.speed;
            const yaw = Math.atan2(-directionZ, directionX);
            const roll = Math.sin(time * 0.74 + index * 1.8) * 0.055;

            position.set(x, fish.depth + Math.sin(time * 0.48 + index) * 0.08, z);
            euler.set(roll, yaw, 0);
            quaternion.setFromEuler(euler);
            scale.set(1.72 * fish.scale, 0.42 * fish.scale, 0.68 * fish.scale);
            matrix.compose(position, quaternion, scale);
            fishBodies.setMatrixAt(index, matrix);

            euler.set(roll, yaw + Math.sin(time * 1.45 + index * 1.3) * 0.16, 0);
            quaternion.setFromEuler(euler);
            scale.setScalar(fish.scale);
            matrix.compose(position, quaternion, scale);
            fishTails.setMatrixAt(index, matrix);
        });
        fishBodies.instanceMatrix.needsUpdate = true;
        fishTails.instanceMatrix.needsUpdate = true;
        fishBodies.computeBoundingSphere();
        fishTails.computeBoundingSphere();
    };

    const diagnostics = Object.freeze({
        quality: qualityName,
        backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
        waveLayers: quality.waveLayers,
        causticLayers: quality.causticLayers,
        refraction: quality.refraction,
        reflectionRequested,
        reflection: reflectionEnabled,
        reflectionScale: reflectionEnabled ? REFLECTION_SCALE : 0,
        reflectionLayer: reflectionEnabled ? REFLECTION_LAYER : null,
        computeRipples: false,
    });
    const debugApi = Object.freeze({
        getDiagnostics: () => ({ ...diagnostics }),
    });
    window.__KOI_POND_WATER__ = debugApi;

    return {
        getDiagnostics: debugApi.getDiagnostics,
        camera(_time, activeCamera) {
            activeCamera.position.set(0, 20.5, 25.5);
            activeCamera.lookAt(0, -1.5, -5.5);
            activeCamera.fov = 42;
            activeCamera.near = 0.1;
            activeCamera.far = 140;
            activeCamera.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            updateFish(time);
        },
        dispose() {
            if (window.__KOI_POND_WATER__ === debugApi) delete window.__KOI_POND_WATER__;
            scene.remove(root);
            reflectionNode?.dispose?.();
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            scene.background = previousState.background;
            scene.fog = previousState.fog;
            renderer.toneMapping = previousState.toneMapping;
            renderer.toneMappingExposure = previousState.exposure;
            camera.fov = previousState.fov;
            camera.near = previousState.near;
            camera.far = previousState.far;
            camera.position.copy(previousState.position);
            camera.quaternion.copy(previousState.quaternion);
            camera.updateProjectionMatrix();
            camera.clearViewOffset?.();
        },
    };
}
