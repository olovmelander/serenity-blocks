/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond v2 — production black-jade water.
 *
 * Layered analytic waves, a wave-derived optical normal, depth-aware
 * absorption, guarded framebuffer refraction, animated caustics projected onto
 * the pond floor, and an opt-in selective planar reflection. Single-sample
 * WebGPU uses real viewport depth; MSAA and WebGL2 retain the authored analytic
 * basin because multisampled depth cannot be resolved by Three r181's viewport
 * copy. The playground wrapper delegates here so the verified study and
 * production theme share one implementation.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
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
    normalWorld,
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
    uniformArray,
    vec2,
    vec3,
    viewportDepthTexture,
    viewportTexture,
} from 'three/tsl';

import {
    KOI_POND_LAYOUT,
    KOI_POND_TERRAIN,
    normalizeKoiPondQuality,
    sampleKoiPondGroundHeight,
} from './koi-pond-layout.js';

const TAU = Math.PI * 2;
const POND_CENTER_Z = KOI_POND_LAYOUT.pondCenter.z;
const POND_RADIUS_X = KOI_POND_LAYOUT.pondRadii.x;
const POND_RADIUS_Z = KOI_POND_LAYOUT.pondRadii.z;
const REFLECTION_LAYER = 2;
const REFLECTION_SCALE = 0.34;
const REDUCED_MOTION_TIME_SCALE = 0.08;

const QUALITY_PRESETS = Object.freeze({
    Minimal: Object.freeze({
        waveLayers: 2,
        causticLayers: 1,
        refraction: false,
        reflectionEligible: false,
        bankSegments: 64,
        bankRings: 5,
        bedSegments: 64,
        bedRings: 12,
        surfaceSegments: 72,
        surfaceRings: 14,
        padSegments: 18,
        fishCount: 2,
    }),
    Low: Object.freeze({
        waveLayers: 3,
        causticLayers: 1,
        refraction: false,
        reflectionEligible: false,
        bankSegments: 72,
        bankRings: 6,
        bedSegments: 72,
        bedRings: 14,
        surfaceSegments: 88,
        surfaceRings: 18,
        padSegments: 22,
        fishCount: 3,
    }),
    Medium: Object.freeze({
        waveLayers: 3,
        causticLayers: 1,
        // Analytic-basin refraction on Medium: removes a full-screen framebuffer
        // copy + depth resolve from the commonest laptop tier at no visible cost.
        refraction: false,
        reflectionEligible: false,
        bankSegments: 88,
        bankRings: 7,
        bedSegments: 96,
        bedRings: 18,
        surfaceSegments: 104,
        surfaceRings: 22,
        padSegments: 28,
        fishCount: 4,
    }),
    High: Object.freeze({
        waveLayers: 3,
        causticLayers: 2,
        refraction: true,
        reflectionEligible: true,
        bankSegments: 112,
        bankRings: 9,
        bedSegments: 112,
        bedRings: 22,
        surfaceSegments: 128,
        surfaceRings: 28,
        padSegments: 28,
        fishCount: 5,
    }),
    Ultra: Object.freeze({
        waveLayers: 3,
        causticLayers: 2,
        refraction: true,
        reflectionEligible: true,
        bankSegments: 112,
        bankRings: 10,
        bedSegments: 112,
        bedRings: 22,
        surfaceSegments: 128,
        surfaceRings: 28,
        padSegments: 28,
        fishCount: 6,
    }),
    Extreme: Object.freeze({
        waveLayers: 3,
        causticLayers: 2,
        refraction: true,
        reflectionEligible: true,
        bankSegments: 112,
        bankRings: 11,
        bedSegments: 112,
        bedRings: 22,
        surfaceSegments: 128,
        surfaceRings: 28,
        padSegments: 28,
        fishCount: 6,
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
    Object.freeze({
        cx: -7.2, cz: -7.6, rx: 5.1, rz: 3.2, phase: 1.3, speed: 0.13, scale: 0.60, depth: -1.45,
    }),
    Object.freeze({
        cx: 1.8, cz: -5.8, rx: 8.8, rz: 5.8, phase: 3.2, speed: -0.09, scale: 0.63, depth: -2.05,
    }),
]);

const SUBMERGED_STONES = Object.freeze([
    [-13.6, 0.8, 1.05, 0.2], [-11.1, -0.6, 0.78, -0.4], [-9.3, 1.3, 0.62, 0.6],
    [-15.2, -2.7, 0.88, -0.2], [-12.7, -4.0, 0.56, 0.8], [-8.2, -3.2, 0.72, 0.1],
    [11.7, -10.8, 0.70, -0.7], [14.1, -8.2, 0.48, 0.4], [9.8, -12.2, 0.54, 0.2],
]);

const RIM_STONE_PHASES = Object.freeze([
    0.002, 0.028, 0.061, 0.098, 0.134, 0.166,
    0.282, 0.310, 0.343, 0.379,
    0.432, 0.460, 0.493, 0.530, 0.568, 0.604,
    0.676, 0.705, 0.737,
    0.812, 0.844, 0.879, 0.915, 0.955, 0.984,
]);

function resolveQuality(params, requestedQuality) {
    const requested = (
        requestedQuality
        || params?.get?.('quality')
        || (typeof window !== 'undefined'
            && (window.settings?.effectQuality || window.settings?.graphicsQuality))
        || 'High'
    );
    return normalizeKoiPondQuality(requested);
}

export function resolveKoiPondRefractionDepthMode({
    refraction = false,
    isWebGPU = false,
    samples = 0,
} = {}) {
    if (!refraction) return 'none';

    const sampleCount = Number(samples);
    const usesMultisampling = Number.isFinite(sampleCount) && sampleCount > 1;
    if (isWebGPU && !usesMultisampling) return 'viewport';
    return isWebGPU && usesMultisampling ? 'analytic-msaa' : 'analytic';
}

export function getKoiPondRendererSampleCount(renderer) {
    const configured = Number(renderer?.samples);
    const current = Number(renderer?.currentSamples);
    return Math.max(
        Number.isFinite(configured) ? configured : 0,
        Number.isFinite(current) ? current : 0,
        0,
    );
}

function enableReflectionLayer(object) {
    object.traverse((child) => child.layers.enable(REFLECTION_LAYER));
    return object;
}

function freezeStaticTransform(object) {
    object.updateMatrix();
    object.matrixAutoUpdate = false;
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

function makeTerrainGeometry(radialSegments, rings) {
    const geometry = new THREE.RingGeometry(
        KOI_POND_TERRAIN.innerRadius,
        KOI_POND_TERRAIN.outerRadius,
        radialSegments,
        rings,
    );
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
        const normalizedX = positions.getX(index);
        const normalizedZ = positions.getZ(index);
        const radial = Math.hypot(normalizedX, normalizedZ);
        const angle = Math.atan2(normalizedZ, normalizedX);
        const progress = Math.max(0, Math.min(
            1,
            (radial - KOI_POND_TERRAIN.innerRadius)
                / (KOI_POND_TERRAIN.outerRadius - KOI_POND_TERRAIN.innerRadius),
        ));
        const contour = 1 + progress * (
            Math.sin(angle * 3 + 0.35) * 0.032
            + Math.sin(angle * 7 - 0.8) * 0.014
        );
        const x = Math.cos(angle) * radial * contour * POND_RADIUS_X;
        const z = POND_CENTER_Z
            + Math.sin(angle) * radial * contour * POND_RADIUS_Z;
        positions.setXYZ(index, x, sampleKoiPondGroundHeight(x, z), z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeTailGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -1.12, 0, 0,
        -1.46, 0, 0.18,
        -2.38, 0, 0.82,
        -1.88, 0, 0.08,
        -2.38, 0, -0.82,
        -1.46, 0, -0.18,
    ], 3));
    geometry.setIndex([
        0, 1, 2,
        0, 2, 3,
        0, 3, 4,
        0, 4, 5,
    ]);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeKoiBodyGeometry() {
    const source = new THREE.SphereGeometry(1, 22, 14).toNonIndexed();
    const sourcePositions = source.attributes.position;
    const positions = [];
    for (let index = 0; index < sourcePositions.count; index += 1) {
        const sourceX = sourcePositions.getX(index);
        const sourceY = sourcePositions.getY(index);
        const sourceZ = sourcePositions.getZ(index);
        const front = Math.max(0, sourceX);
        const tail = Math.max(0, -sourceX);
        const shoulder = 1 + Math.exp(-((sourceX - 0.18) ** 2) * 4.2) * 0.08;
        positions.push(
            Math.sign(sourceX) * Math.abs(sourceX) ** (front > 0 ? 0.88 : 1.06),
            sourceY * shoulder * (1 - tail * 0.10),
            sourceZ * shoulder * (1 - tail * 0.18),
        );
    }
    source.dispose();

    const appendDoubleSidedTriangle = (a, b, c) => {
        positions.push(...a, ...b, ...c, ...a, ...c, ...b);
    };
    appendDoubleSidedTriangle(
        [-0.48, 0.66, 0],
        [0.30, 0.82, 0],
        [-0.16, 1.32, 0.02],
    );
    appendDoubleSidedTriangle(
        [0.18, -0.18, 0.46],
        [-0.36, -0.10, 0.52],
        [-0.10, -0.28, 1.10],
    );
    appendDoubleSidedTriangle(
        [0.18, -0.18, -0.46],
        [-0.10, -0.28, -1.10],
        [-0.36, -0.10, -0.52],
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

function makeLilyPadGeometry(radialSegments = 28) {
    const shape = new THREE.Shape();
    const notchHalfAngle = 0.25;
    const arcStart = notchHalfAngle;
    const arcEnd = TAU - notchHalfAngle;
    shape.moveTo(0, 0);

    for (let index = 0; index <= radialSegments; index += 1) {
        const progress = index / radialSegments;
        const angle = arcStart + (arcEnd - arcStart) * progress;
        const radius = 1
            + Math.sin(angle * 3 + 0.45) * 0.024
            + Math.sin(angle * 7 - 0.30) * 0.012;
        shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    shape.lineTo(0, 0);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.10,
        steps: 1,
        bevelEnabled: true,
        bevelSegments: 1,
        bevelSize: 0.035,
        bevelThickness: 0.024,
        curveSegments: 1,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0.05, 0);
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
        const brokenLight = sin(
            pondCoord.x.mul(0.44)
                .add(pondCoord.y.mul(0.71))
                .sub(uTime.mul(0.18)),
        ).mul(0.5).add(0.5);
        return pow(
            smoothstep(0.010, 0.046, contourDistance).oneMinus(),
            float(2.6),
        )
            .mul(float(0.30).add(brokenLight.mul(0.70)))
            .mul(0.18);
    }

    const causticB = worleyNoise(
        pondCoord.mul(0.87).add(vec2(uTime.mul(-0.073), uTime.mul(0.091))),
        0.72,
    );
    return pow(abs(causticA.sub(causticB)).mul(1.35).clamp(0, 1), float(2.35));
}

function makeWaveField(
    uTime,
    layerCount,
    rippleHeight = null,
    rippleSlope = null,
    detailOctaves = 0,
) {
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

    // Tier-gated FBM detail normal. A cheap forward-difference gradient of drift
    // noise perturbs only the OPTICAL slope (not the vertex height), so the moon
    // glint and specular scintillate organically instead of via an authored sin
    // band. Octaves are hard-gated (High 1, Ultra/Extreme 2, else 0) — this is
    // the fill-sensitive path the iGPU has TDR'd on, so it stays 3 taps/octave.
    if (detailOctaves >= 1) {
        const s0 = noiseFloat(vec3(
            pondCoord.x.mul(1.35),
            pondCoord.y.mul(1.35),
            uTime.mul(0.32),
        ));
        const sx = noiseFloat(vec3(
            pondCoord.x.add(0.16).mul(1.35),
            pondCoord.y.mul(1.35),
            uTime.mul(0.32),
        ));
        const sz = noiseFloat(vec3(
            pondCoord.x.mul(1.35),
            pondCoord.y.add(0.16).mul(1.35),
            uTime.mul(0.32),
        ));
        slopeX = slopeX.add(sx.sub(s0).mul(0.2));
        slopeZ = slopeZ.add(sz.sub(s0).mul(0.2));
    }
    if (detailOctaves >= 2) {
        const t0 = noiseFloat(vec3(
            pondCoord.x.mul(3.1),
            pondCoord.y.mul(3.1),
            uTime.mul(0.54),
        ));
        const tx = noiseFloat(vec3(
            pondCoord.x.add(0.09).mul(3.1),
            pondCoord.y.mul(3.1),
            uTime.mul(0.54),
        ));
        const tz = noiseFloat(vec3(
            pondCoord.x.mul(3.1),
            pondCoord.y.add(0.09).mul(3.1),
            uTime.mul(0.54),
        ));
        slopeX = slopeX.add(tx.sub(t0).mul(0.12));
        slopeZ = slopeZ.add(tz.sub(t0).mul(0.12));
    }

    // Gameplay reactions inject expanding ring wavelets that ride the same
    // analytic normal, so a lock/combo actually bends the mirrored moon,
    // caustics and refraction outward from the impact instead of pasting a quad.
    if (rippleHeight) height = height.add(rippleHeight);
    if (rippleSlope) {
        slopeX = slopeX.add(rippleSlope.x);
        slopeZ = slopeZ.add(rippleSlope.y);
    }

    return {
        height,
        normal: normalize(vec3(slopeX.mul(-2.25), 1, slopeZ.mul(-2.25))),
    };
}

export function createKoiPondWater({
    scene,
    camera,
    renderer,
    params,
    quality: requestedQuality,
    reducedMotion = false,
}) {
    const qualityName = resolveQuality(params, requestedQuality);
    const quality = QUALITY_PRESETS[qualityName];
    const reflectionRequested = params?.get?.('reflection') === '1';
    const reflectionEnabled = reflectionRequested && quality.reflectionEligible;
    const refractionDepthMode = resolveKoiPondRefractionDepthMode({
        refraction: quality.refraction,
        isWebGPU: renderer.backend?.isWebGPUBackend === true,
        // `currentSamples` becomes zero while r181 is preparing its internal
        // color-space output target even though that target inherits the
        // configured 4x MSAA. The stable renderer value must participate in
        // this gate or the depth copy is still compiled as single-sample.
        samples: getKoiPondRendererSampleCount(renderer),
    });
    const useViewportDepth = refractionDepthMode === 'viewport';
    // r185's viewportDepthTexture() accepts a per-instance depth texture as its
    // 3rd argument — the isolation this file previously hand-wired through
    // viewportTexture. Bare viewportDepthTexture() calls still fall back to a
    // module-global shared texture, and a theme rebuild can cross render
    // targets during warmup, so the local capture stays deliberately. WebGPU
    // also cannot copy or normally sample its multisampled depth attachment:
    // MSAA and ANGLE therefore retain the authored analytic bowl depth while
    // still using the resolved viewport color for refraction.
    const viewportDepth = useViewportDepth ? new THREE.DepthTexture() : null;
    const root = new THREE.Group();
    root.name = 'koi-pond-water-study';
    freezeStaticTransform(root);

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

    const uTime = uniform(0);
    const causticField = makeCausticField(uTime, quality.causticLayers);

    // Reaction ripple pool. Each packed vec4 slot is (originX, originZ, birth,
    // strength); stable object identities let three r181's uniformArray('vec4')
    // re-upload on in-place mutation (the shipped Stillwater pattern).
    const MAX_RIPPLES = 6;
    const RIPPLE_SPEED = 7.0;
    const RIPPLE_LIFETIME = 1.5;
    const rippleSlots = Array.from(
        { length: MAX_RIPPLES },
        () => ({
            x: 0, y: POND_CENTER_Z, z: -1000, w: 0,
        }),
    );
    const uRipples = uniformArray(rippleSlots, 'vec4');
    let rippleCursor = 0;

    // Branchless: this runs at graph-build time (outside any Fn stack, so no
    // imperative If), and inactive slots fall out naturally — an idle slot has
    // birth = -1000, so its age is huge, lifeRemaining is negative and `alive`
    // (hence `energy`) is 0. Six always-summed slots is cheap analytic ALU.
    const makeRippleTerms = (samplePosition) => {
        let height = float(0);
        let slope = vec2(0);
        for (let index = 0; index < MAX_RIPPLES; index += 1) {
            const slot = uRipples.element(index);
            const age = uTime.sub(slot.z);
            const lifeRemaining = float(RIPPLE_LIFETIME).sub(age);
            const alive = smoothstep(0, 0.05, age)
                .mul(smoothstep(0, 0.3, lifeRemaining));
            const progress = clamp(age.div(RIPPLE_LIFETIME), 0, 1);
            const delta = samplePosition.sub(slot.xy);
            const radius = max(length(delta), 0.001);
            const radial = delta.div(radius);
            // Front expands outward; trailing crests follow it.
            const ringRadius = float(0.3).add(progress.mul(RIPPLE_SPEED));
            const ringDelta = radius.sub(ringRadius);
            const ring = smoothstep(0.1, 1.15, abs(ringDelta)).oneMinus();
            const signedEdge = clamp(ringDelta.div(0.8), -1, 1);
            const energy = alive.mul(slot.w).mul(float(1).sub(progress).pow(1.2));
            height = height.add(
                cos(ringDelta.mul(4.0)).mul(ring).mul(energy).mul(0.07),
            );
            slope = slope.add(
                radial.mul(signedEdge.mul(ring).mul(energy).mul(0.11)),
            );
        }
        return { height, slope };
    };
    const rippleTerms = makeRippleTerms(positionGeometry.xz);

    // A continuous, relief-shaped woodland floor replaces the old flat collar.
    // Its inner lip remains fixed to the water while an irregular outer contour
    // runs beneath the side forest and foreground sedges.
    const bankMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const macro = noiseFloat(positionWorld.mul(0.052)).mul(0.5).add(0.5);
        const grain = noiseFloat(positionWorld.mul(0.31)).mul(0.5).add(0.5);
        const pondCoord = positionWorld.xz.sub(vec2(0, POND_CENTER_Z));
        const radial = length(vec2(
            pondCoord.x.div(POND_RADIUS_X),
            pondCoord.y.div(POND_RADIUS_Z),
        ));
        const wetShore = smoothstep(1.01, 1.26, radial).oneMinus();
        const mossMask = smoothstep(0.52, 0.79, macro)
            .mul(smoothstep(1.03, 1.15, radial));
        const stoneMask = smoothstep(0.76, 0.94, grain)
            .mul(float(0.26).add(macro.mul(0.18)));
        const outerShade = smoothstep(1.76, KOI_POND_TERRAIN.outerRadius, radial);
        const soil = mix(
            vec3(0.010, 0.014, 0.012),
            vec3(0.038, 0.033, 0.022),
            grain.mul(0.62),
        );
        const moss = mix(
            vec3(0.014, 0.034, 0.024),
            vec3(0.066, 0.118, 0.055),
            grain.mul(0.74),
        );
        const stone = mix(
            vec3(0.040, 0.050, 0.043),
            vec3(0.105, 0.125, 0.078),
            macro,
        );
        const moonWash = smoothstep(-26, -4, positionWorld.x).oneMinus()
            .mul(smoothstep(0.92, 1.42, radial));
        const lanternLift = smoothstep(
            2.4,
            12,
            length(positionWorld.xz.sub(vec2(13.8, -20))),
        ).oneMinus();
        const guardianShadow = smoothstep(
            0.18,
            1.08,
            length(vec2(
                positionWorld.x
                    .sub(KOI_POND_LAYOUT.guardian.position.x)
                    .div(3.6),
                positionWorld.z
                    .sub(KOI_POND_LAYOUT.guardian.position.z)
                    .div(2.1),
            )),
        ).oneMinus();
        bankMaterial.colorNode = mix(
            mix(soil, moss, mossMask),
            stone,
            stoneMask,
        )
            .mul(float(0.72).add(macro.mul(0.42)))
            .mul(float(1).sub(outerShade.mul(0.46)))
            .mul(float(1).sub(wetShore.mul(0.34)))
            .mul(float(1).sub(guardianShadow.mul(0.38)))
            .add(vec3(0.025, 0.065, 0.052).mul(moonWash.mul(0.22)))
            .add(vec3(0.13, 0.040, 0.012).mul(lanternLift.mul(0.24)));
        bankMaterial.roughnessNode = float(0.98);
        bankMaterial.metalnessNode = float(0);
    }
    const bank = add(freezeStaticTransform(new THREE.Mesh(
        ownGeometry(makeTerrainGeometry(
            quality.bankSegments,
            quality.bankRings,
        )),
        bankMaterial,
    )));
    bank.name = 'koi-pond-woodland-floor';

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
        bedMaterial.colorNode = bedBase.add(
            vec3(0.26, 0.66, 0.46).mul(causticEnergy.mul(0.48)),
        );
        bedMaterial.roughnessNode = mix(float(0.98), float(0.70), causticEnergy);
        bedMaterial.metalnessNode = float(0);
    }
    add(freezeStaticTransform(new THREE.Mesh(
        ownGeometry(makeEllipticalGeometry(
            0,
            1,
            quality.bedSegments,
            quality.bedRings,
            pondBottomHeight,
        )),
        bedMaterial,
    )));

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
    rimStones.instanceMatrix.setUsage(THREE.StaticDrawUsage);
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
    freezeStaticTransform(rimStones);

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
    submergedStones.instanceMatrix.setUsage(THREE.StaticDrawUsage);
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
    freezeStaticTransform(submergedStones);

    // High-contrast porcelain/vermilion koi are deliberate optical targets:
    // refraction should bend them without muddying their silhouette.
    const koiMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const phase = hash(instanceIndex).mul(TAU);
        // Whole-body spine undulation. Shares the tail sway's frequency (1.62),
        // per-fish phase, and along-length travel term (x * -0.72) so the torso
        // and caudal fin read as one continuous lateral wave instead of a rigid
        // body dragging a wagging tail. The head (high +x) stays near the
        // centerline; the swing grows toward the peduncle.
        const bodyReach = smoothstep(0.58, -1.05, positionGeometry.x);
        const spineWave = sin(
            uTime.mul(1.62).add(phase).add(positionGeometry.x.mul(-0.72)),
        )
            .mul(0.075)
            .mul(bodyReach);
        const bodyRoll = sin(uTime.mul(1.62).add(phase).add(0.45))
            .mul(0.018)
            .mul(bodyReach);
        koiMaterial.positionNode = positionLocal.add(vec3(0, bodyRoll, spineWave));
        const patchField = sin(positionGeometry.x.mul(3.8).add(phase))
            .add(sin(positionGeometry.z.mul(4.6).sub(phase.mul(0.72))))
            .mul(0.25).add(0.5);
        const vermilionMask = smoothstep(0.46, 0.67, patchField);
        const sumiField = sin(positionGeometry.x.mul(5.4).sub(phase.mul(1.31)))
            .add(cos(positionGeometry.z.mul(6.8).add(phase.mul(0.86))))
            .mul(0.25).add(0.5);
        const sumiMask = smoothstep(0.58, 0.76, sumiField)
            .mul(vermilionMask.oneMinus());
        const dorsalShade = smoothstep(-0.2, 0.72, positionGeometry.y);
        const eyeMask = smoothstep(0.46, 0.76, positionGeometry.x)
            .mul(smoothstep(0.36, 0.72, abs(positionGeometry.z)))
            .mul(smoothstep(0.02, 0.34, positionGeometry.y))
            .mul(smoothstep(0.34, 0.62, positionGeometry.y).oneMinus());
        const gillBand = smoothstep(0.22, 0.46, positionGeometry.x)
            .mul(smoothstep(0.48, 0.68, positionGeometry.x).oneMinus())
            .mul(smoothstep(0.28, 0.78, abs(positionGeometry.z)));
        const porcelain = mix(vec3(0.72, 0.69, 0.56), vec3(1.0, 0.91, 0.70), dorsalShade);
        const vermilion = mix(vec3(0.62, 0.055, 0.018), vec3(1.0, 0.22, 0.045), dorsalShade);
        const sumi = mix(vec3(0.005, 0.010, 0.009), vec3(0.035, 0.052, 0.043), dorsalShade);
        const patterned = mix(
            mix(porcelain, vermilion, vermilionMask),
            sumi,
            sumiMask.mul(0.92),
        );
        koiMaterial.colorNode = mix(
            mix(patterned, sumi, gillBand.mul(0.32)),
            vec3(0.002, 0.004, 0.003),
            eyeMask.mul(0.94),
        )
            .add(vec3(0.12, 0.38, 0.25).mul(causticField.mul(0.22)));
        koiMaterial.roughnessNode = float(0.38);
        koiMaterial.metalnessNode = float(0);
    }
    const fishBodies = add(new THREE.InstancedMesh(
        ownGeometry(makeKoiBodyGeometry()),
        koiMaterial,
        quality.fishCount,
    ));
    fishBodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fishBodies.frustumCulled = false;
    freezeStaticTransform(fishBodies);

    const tailMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const phase = hash(instanceIndex).mul(TAU);
        const tipWeight = smoothstep(-2.30, -1.18, positionGeometry.x).oneMinus();
        const tailSway = sin(
            uTime.mul(1.62).add(phase).add(positionGeometry.x.mul(-0.72)),
        )
            .mul(0.22)
            .mul(tipWeight);
        tailMaterial.positionNode = positionLocal.add(vec3(
            0,
            sin(uTime.mul(1.17).add(phase)).mul(0.025).mul(tipWeight),
            tailSway,
        ));
        const patchField = sin(positionGeometry.x.mul(3.8).add(phase))
            .add(sin(positionGeometry.z.mul(4.6).sub(phase.mul(0.72))))
            .mul(0.25).add(0.5);
        const vermilionMask = smoothstep(0.46, 0.67, patchField);
        const sumiField = sin(positionGeometry.x.mul(5.4).sub(phase.mul(1.31)))
            .add(cos(positionGeometry.z.mul(6.8).add(phase.mul(0.86))))
            .mul(0.25).add(0.5);
        const sumiMask = smoothstep(0.58, 0.76, sumiField)
            .mul(vermilionMask.oneMinus());
        const rootBlend = smoothstep(-2.30, -1.16, positionGeometry.x);
        const porcelain = vec3(0.98, 0.82, 0.60);
        const vermilion = vec3(0.92, 0.16, 0.035);
        const sumi = vec3(0.012, 0.020, 0.017);
        const patterned = mix(
            mix(porcelain, vermilion, vermilionMask),
            sumi,
            sumiMask.mul(0.88),
        );
        const translucentFin = mix(vec3(0.72, 0.31, 0.12), porcelain, float(0.46));
        tailMaterial.colorNode = mix(translucentFin, patterned, rootBlend)
            .add(vec3(0.10, 0.34, 0.22).mul(causticField.mul(0.18)));
        tailMaterial.opacityNode = mix(float(0.48), float(0.84), rootBlend);
    }
    tailMaterial.roughnessNode = float(0.48);
    tailMaterial.side = THREE.DoubleSide;
    tailMaterial.transparent = true;
    tailMaterial.depthWrite = false;
    tailMaterial.forceSinglePass = true;
    const fishTails = add(new THREE.InstancedMesh(
        ownGeometry(makeTailGeometry()),
        tailMaterial,
        quality.fishCount,
    ));
    fishTails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fishTails.frustumCulled = false;
    freezeStaticTransform(fishTails);

    const wakeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const wakeRadius = length(positionGeometry.xz);
        const wakeBand = smoothstep(0.62, 0.76, wakeRadius)
            .mul(smoothstep(0.88, 1, wakeRadius).oneMinus());
        const phase = hash(instanceIndex).mul(TAU);
        const wakeBreaks = smoothstep(
            0.30,
            0.82,
            abs(sin(positionGeometry.x.mul(5.4).add(phase))),
        );
        const shimmer = sin(uTime.mul(1.12).add(phase)).mul(0.16).add(0.84);
        wakeMaterial.colorNode = mix(
            vec3(0.10, 0.31, 0.25),
            vec3(0.39, 0.66, 0.55),
            wakeBand,
        );
        wakeMaterial.opacityNode = wakeBand
            .mul(wakeBreaks)
            .mul(shimmer)
            .mul(attribute('aWakeAlpha'))
            .mul(0.72);
        wakeMaterial.transparent = true;
        wakeMaterial.depthWrite = false;
        wakeMaterial.side = THREE.DoubleSide;
        wakeMaterial.forceSinglePass = true;
        wakeMaterial.fog = false;
    }
    const wakeGeometry = ownGeometry(new THREE.RingGeometry(0.62, 1, 32, 1));
    wakeGeometry.rotateX(-Math.PI / 2);
    wakeGeometry.setAttribute(
        'aWakeAlpha',
        new THREE.InstancedBufferAttribute(
            new Float32Array(
                FISH_PATHS
                    .slice(0, quality.fishCount)
                    .map((fish) => Math.max(0.035, 0.13 - Math.abs(fish.depth) * 0.035)),
            ),
            1,
        ),
    );
    const fishWakes = add(new THREE.InstancedMesh(
        wakeGeometry,
        wakeMaterial,
        quality.fishCount,
    ));
    fishWakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fishWakes.frustumCulled = false;
    fishWakes.renderOrder = 22;
    freezeStaticTransform(fishWakes);

    const padMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    {
        const padGrain = noiseFloat(positionWorld.mul(0.36)).mul(0.5).add(0.5);
        padMaterial.colorNode = mix(vec3(0.025, 0.09, 0.055), vec3(0.11, 0.30, 0.13), padGrain);
        padMaterial.roughnessNode = float(0.86);
    }
    const padGeometry = ownGeometry(makeLilyPadGeometry(quality.padSegments));
    const pads = add(new THREE.InstancedMesh(padGeometry, padMaterial, 5));
    pads.instanceMatrix.setUsage(THREE.StaticDrawUsage);
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
    freezeStaticTransform(pads);

    // Three sparse far-bank value families make the reflector judgeable without
    // building the whole Koi Pond landscape: cool moon, dark willow, warm lantern.
    // Their footprints stay outside the central gameplay sanctuary.
    const moonMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const moonMottle = noiseFloat(positionGeometry.mul(1.35)).mul(0.5).add(0.5);
        const craterField = noiseFloat(positionGeometry.mul(3.8)).mul(0.5).add(0.5);
        const craterMask = smoothstep(0.62, 0.82, craterField)
            .mul(smoothstep(0.22, 0.72, moonMottle));
        const moonLight = clamp(
            dot(normalize(positionGeometry), normalize(vec3(-0.34, 0.56, 0.76)))
                .mul(0.16).add(0.84),
            0.66,
            1,
        );
        // HDR moon hero: the lit face runs well above 1.0 so the post bloom
        // wraps it in a real corona instead of reading as a flat grey disc.
        // A cool limb over a faintly warmer core keeps it a luminous full moon.
        const moonBase = mix(
            vec3(0.86, 0.98, 1.16),
            vec3(1.62, 1.78, 1.98),
            moonLight,
        );
        const viewDirection = normalize(cameraPosition.sub(positionWorld));
        const limbLight = smoothstep(
            0.08,
            0.82,
            max(dot(normalWorld, viewDirection), float(0)),
        );
        moonMaterial.colorNode = moonBase
            .mul(mix(float(0.84), float(1), moonMottle))
            .mul(float(1).sub(craterMask.mul(0.30)))
            .mul(float(0.86).add(limbLight.mul(0.18)));
        moonMaterial.depthTest = false;
        moonMaterial.depthWrite = false;
        moonMaterial.toneMapped = false;
        moonMaterial.fog = false;
    }
    const moon = add(new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(KOI_POND_LAYOUT.moon.radius, 28, 18)),
        moonMaterial,
    ));
    moon.position.set(
        KOI_POND_LAYOUT.moon.position.x,
        KOI_POND_LAYOUT.moon.position.y,
        KOI_POND_LAYOUT.moon.position.z,
    );
    // Render before the ridge (renderOrder -70) so the mountain silhouette and
    // trees occlude the moon: a distant moon sits BEHIND the closer mountains,
    // not painted on top of them.
    moon.renderOrder = -75;
    freezeStaticTransform(moon);
    moon.name = 'koi-water-distant-moon';

    // The old "dark willow" value family (two big sphere canopies + branches on
    // the left bank) read as strange dark blobs from the cinematic camera and
    // was removed; the landscape's forest now owns the left-bank silhouettes.

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
    lanternStone.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    freezeStaticTransform(lanternStone);
    lanternStone.name = 'koi-water-stone-lantern';

    const lanternGlowMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    // Live HDR flame: low-frequency flicker on an above-1.0 base so the aperture
    // blooms warm and breathes like a real flame rather than a dead orange dot.
    const lanternFlicker = float(0.82)
        .add(sin(uTime.mul(7.1)).mul(0.10))
        .add(sin(uTime.mul(13.7).add(1.3)).mul(0.06))
        .add(sin(uTime.mul(23.0).add(0.5)).mul(0.04));
    lanternGlowMaterial.colorNode = vec3(1.7, 0.5, 0.13).mul(lanternFlicker);
    const lanternGlow = add(new THREE.Mesh(
        ownGeometry(new THREE.SphereGeometry(1, 14, 8)),
        lanternGlowMaterial,
    ));
    lanternGlow.position.set(13.8, 3.36, -20);
    lanternGlow.scale.set(0.70, 0.48, 0.58);
    freezeStaticTransform(lanternGlow);
    lanternGlow.name = 'koi-water-lantern-aperture';

    let reflectionNode = null;
    if (reflectionEnabled) {
        [
            bank,
            rimStones,
            pads,
            moon,
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
    // Hard octave gate for the detail normal — never above 2, off below High.
    let detailOctaves = 0;
    if (qualityName === 'High') detailOctaves = 1;
    else if (qualityName === 'Ultra' || qualityName === 'Extreme') detailOctaves = 2;
    const waveField = makeWaveField(
        uTime,
        quality.waveLayers,
        rippleTerms.height,
        rippleTerms.slope,
        detailOctaves,
    );
    const waterMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    {
        const pondCoord = positionGeometry.xz.sub(vec2(0, POND_CENTER_Z));
        const radial = length(vec2(
            pondCoord.x.div(POND_RADIUS_X),
            pondCoord.y.div(POND_RADIUS_Z),
        ));
        const edgeInset = smoothstep(0.72, 0.965, radial).oneMinus();
        const edgeOpacity = smoothstep(0.94, 0.998, radial).oneMinus();
        const opticalNormal = normalize(mix(
            vec3(0, 1, 0),
            waveField.normal,
            edgeInset.mul(0.86).add(0.14),
        ));
        const viewDirection = normalize(cameraPosition.sub(positionWorld));
        const viewFacing = max(dot(opticalNormal, viewDirection), float(0));
        const fresnel = float(0.025).add(
            float(0.975).mul(pow(float(1).sub(viewFacing), float(5))),
        );

        let depthFactor = pow(edgeInset, float(0.74));
        let transmitted = mix(
            vec3(0.045, 0.17, 0.12),
            vec3(0.003, 0.025, 0.028),
            depthFactor,
        );
        const normalView = transformNormalToView(opticalNormal);

        if (quality.refraction) {
            const candidateUv = clamp(
                screenUV.add(normalView.xy.mul(0.013).mul(edgeInset)),
                vec2(0.002),
                vec2(0.998),
            );
            let safeUv = candidateUv;
            let surfaceDepth = null;
            let sceneDepth = null;
            if (useViewportDepth) {
                surfaceDepth = linearDepth();
                sceneDepth = linearDepth(viewportDepthTexture(
                    candidateUv,
                    null,
                    viewportDepth,
                ));
                safeUv = sceneDepth.sub(surfaceDepth)
                    .lessThan(0)
                    .select(screenUV, candidateUv);
            }
            // Shared viewport nodes retain mutable texture metadata across
            // render contexts. Koi uses one renderer-local depth capture for
            // both the foreground guard and absorption, avoiding the global
            // viewportSafeUV depth texture and a redundant framebuffer copy.
            const refracted = viewportTexture(safeUv).rgb;
            if (useViewportDepth) {
                const thickness = max(sceneDepth.sub(surfaceDepth), float(0))
                    .mul(cameraFar.sub(cameraNear));
                depthFactor = smoothstep(0.35, 4.8, thickness);
            } else {
                // ANGLE cannot sample the local depth capture, so infer a
                // deep basin from the ellipse while protecting bright/warm
                // optical subjects (porcelain and vermilion koi, pale stones).
                // This keeps fallback composition close to viewport-depth
                // WebGPU instead of flattening the center into caustics.
                const subjectWarmth = refracted.r.sub(refracted.g.mul(0.78));
                const subjectLuma = dot(
                    refracted,
                    vec3(0.2126, 0.7152, 0.0722),
                );
                const subjectGuard = max(
                    smoothstep(0.025, 0.22, subjectWarmth),
                    smoothstep(0.70, 0.92, subjectLuma),
                );
                const analyticBasin = pow(edgeInset, float(0.86)).mul(0.78);
                const shallowSubject = pow(edgeInset, float(0.74)).mul(0.24);
                depthFactor = mix(analyticBasin, shallowSubject, subjectGuard);
            }
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
        const farWater = smoothstep(-17, 3, positionWorld.z).oneMinus();
        let reflectedCanopy = mix(
            vec3(0.004, 0.024, 0.027),
            vec3(0.046, 0.125, 0.105),
            reflectedVariation.mul(farWater.mul(0.62).add(0.24)),
        ).add(vec3(0.010, 0.034, 0.044).mul(farWater.mul(0.28)));

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

        const moonDirection = normalize(vec3(
            KOI_POND_LAYOUT.moon.lightDirection.x,
            KOI_POND_LAYOUT.moon.lightDirection.y,
            KOI_POND_LAYOUT.moon.lightDirection.z,
        ));
        const halfVector = normalize(viewDirection.add(moonDirection));
        const normalHighlight = max(dot(opticalNormal, halfVector), float(0));
        const broadSpecular = pow(
            normalHighlight,
            float(34),
        );
        const sparkleSpecular = pow(
            normalHighlight,
            float(138),
        );
        const glintBreakup = pow(abs(sin(
            positionWorld.x.mul(0.43)
                .add(positionWorld.z.mul(0.91))
                .sub(uTime.mul(0.31)),
        )), float(8));
        const moonLane = smoothstep(
            0.6,
            7.2,
            abs(positionWorld.x.sub(positionWorld.z.mul(0.375)).add(2.25)),
        ).oneMinus();
        const moonTrack = broadSpecular.mul(0.16)
            .add(sparkleSpecular.mul(glintBreakup.mul(0.80).add(0.20)))
            .mul(moonLane);
        waterColor = waterColor.add(
            vec3(0.46, 0.76, 0.66).mul(moonTrack.mul(0.50)),
        );
        const moonPathBreakup = sin(
            positionWorld.x.mul(0.23)
                .add(positionWorld.z.mul(0.61))
                .sub(uTime.mul(0.08)),
        ).mul(0.5).add(0.5);
        waterColor = waterColor.add(
            vec3(0.18, 0.34, 0.31)
                .mul(moonLane)
                .mul(edgeInset)
                .mul(float(0.014).add(moonPathBreakup.mul(0.020))),
        );

        const lanternLane = smoothstep(
            0.35,
            3.8,
            abs(positionWorld.x
                .sub(13.8)
                .add(positionWorld.z.add(20).mul(0.12))),
        ).oneMinus()
            .mul(smoothstep(-16, 3, positionWorld.z).oneMinus());
        const lanternBreakup = sin(
            positionWorld.z.mul(1.7).sub(uTime.mul(0.82)),
        ).mul(0.5).add(0.5);
        waterColor = waterColor.add(
            vec3(0.42, 0.095, 0.018)
                .mul(lanternLane.mul(lanternBreakup).mul(0.075)),
        );

        const shallowHalo = smoothstep(0.72, 0.98, radial)
            .mul(causticField)
            .mul(float(1).sub(fresnel));
        waterColor = waterColor.add(
            vec3(0.07, 0.32, 0.20).mul(shallowHalo.mul(0.11)),
        );

        waterMaterial.colorNode = waterColor;
        waterMaterial.opacityNode = edgeOpacity.mul(quality.refraction ? 1 : 0.76);
        waterMaterial.positionNode = positionLocal.add(vec3(
            0,
            waveField.height.mul(edgeInset.mul(0.82).add(0.18)),
            0,
        ));
        waterMaterial.transparent = true;
        waterMaterial.depthWrite = false;
        waterMaterial.side = THREE.DoubleSide;
        // Transparent DoubleSide normally costs two full-pond passes in r181.
        // The surface shader is symmetric, so one double-sided pass is enough.
        waterMaterial.forceSinglePass = true;
        waterMaterial.toneMapped = true;
        waterMaterial.fog = false;
    }
    const water = add(freezeStaticTransform(new THREE.Mesh(
        ownGeometry(makeEllipticalGeometry(
            0,
            1,
            quality.surfaceSegments,
            quality.surfaceRings,
            () => 0,
        )),
        waterMaterial,
    )));
    water.renderOrder = 20;

    const hemisphere = add(new THREE.HemisphereLight(0xa6d7bd, 0x07100d, 1.55));
    const moonKey = add(new THREE.DirectionalLight(0xcdf3dc, 2.75));
    moonKey.position.set(-12, 26, -18);
    const warmBounce = add(new THREE.PointLight(0xff6b35, 7.0, 24, 2));
    warmBounce.position.copy(lanternGlow.position);
    hemisphere.name = 'koi-water-hemisphere';
    moonKey.name = 'koi-water-moon-key';
    warmBounce.name = 'koi-water-warm-bounce';
    if (reflectionEnabled) {
        [hemisphere, moonKey, warmBounce].forEach(enableReflectionLayer);
    }

    let motionReduced = reducedMotion === true;
    let motionTime = 0;
    let motionInitialized = false;

    const updateFish = (time) => {
        for (let index = 0; index < quality.fishCount; index += 1) {
            const fish = FISH_PATHS[index];
            const phase = fish.phase + time * fish.speed;
            const harmonicPhase = phase * 2.15 + index * 0.87;
            const x = fish.cx
                + Math.cos(phase) * fish.rx
                + Math.cos(harmonicPhase) * 0.42;
            const z = fish.cz
                + Math.sin(phase) * fish.rz
                + Math.sin(phase * 1.65 - index * 0.54) * 0.34;
            const directionX = (
                -Math.sin(phase) * fish.rx
                - Math.sin(harmonicPhase) * 0.42 * 2.15
            ) * fish.speed;
            const directionZ = (
                Math.cos(phase) * fish.rz
                + Math.cos(phase * 1.65 - index * 0.54) * 0.34 * 1.65
            ) * fish.speed;
            const yaw = Math.atan2(-directionZ, directionX);
            const roll = Math.sin(phase * 1.72 + index * 1.1) * 0.085;

            position.set(
                x,
                fish.depth
                    + Math.sin(time * 0.42 + index) * 0.08
                    + Math.sin(phase * 1.35) * 0.06,
                z,
            );
            euler.set(roll, yaw, 0);
            quaternion.setFromEuler(euler);
            scale.set(1.72 * fish.scale, 0.42 * fish.scale, 0.68 * fish.scale);
            matrix.compose(position, quaternion, scale);
            fishBodies.setMatrixAt(index, matrix);

            euler.set(roll, yaw, 0);
            quaternion.setFromEuler(euler);
            scale.setScalar(fish.scale);
            matrix.compose(position, quaternion, scale);
            fishTails.setMatrixAt(index, matrix);

            position.set(x, 0.075, z);
            euler.set(0, yaw, 0);
            quaternion.setFromEuler(euler);
            scale.set(1.75 * fish.scale, 1, 0.68 * fish.scale);
            matrix.compose(position, quaternion, scale);
            fishWakes.setMatrixAt(index, matrix);
        }
        fishBodies.instanceMatrix.needsUpdate = true;
        fishTails.instanceMatrix.needsUpdate = true;
        fishWakes.instanceMatrix.needsUpdate = true;
    };

    const diagnostics = Object.freeze({
        quality: qualityName,
        backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
        waveLayers: quality.waveLayers,
        causticLayers: quality.causticLayers,
        refraction: quality.refraction,
        refractionDepth: refractionDepthMode,
        reflectionRequested,
        reflection: reflectionEnabled,
        reflectionScale: reflectionEnabled ? REFLECTION_SCALE : 0,
        reflectionLayer: reflectionEnabled ? REFLECTION_LAYER : null,
        computeRipples: false,
        fishCount: quality.fishCount,
        fishWakeDraws: quality.fishCount > 0 ? 1 : 0,
        geometryBudget: Object.freeze({
            bankSegments: quality.bankSegments,
            bankRings: quality.bankRings,
            bedSegments: quality.bedSegments,
            bedRings: quality.bedRings,
            surfaceSegments: quality.surfaceSegments,
            surfaceRings: quality.surfaceRings,
            padSegments: quality.padSegments,
        }),
    });
    const debugApi = Object.freeze({
        getDiagnostics: () => ({
            ...diagnostics,
            reducedMotion: motionReduced,
            motionScale: motionReduced ? REDUCED_MOTION_TIME_SCALE : 1,
        }),
    });
    const api = {
        getDiagnostics: debugApi.getDiagnostics,
        setReducedMotion(enabled) {
            motionReduced = enabled === true;
        },
        // A lock/combo stamps an expanding ring into the surface at its origin.
        // Birth is stamped in the water's own clock so age = uTime - birth reads
        // correctly regardless of the caller's frame.
        injectRipple({
            x = 0, z = POND_CENTER_Z, strength = 0.7, time,
        } = {}) {
            const slot = rippleSlots[rippleCursor];
            slot.x = Number.isFinite(x) ? Number(x) : 0;
            slot.y = Number.isFinite(z) ? Number(z) : POND_CENTER_Z;
            slot.z = Number.isFinite(time) ? Number(time) : motionTime;
            slot.w = Math.max(0, Math.min(1.5, Number.isFinite(strength) ? strength : 0.7));
            rippleCursor = (rippleCursor + 1) % MAX_RIPPLES;
        },
        update(time, delta = 1 / 60) {
            const sampledTime = Number.isFinite(time) ? Number(time) : motionTime;
            const safeDelta = Number.isFinite(delta)
                ? Math.max(0, Math.min(Number(delta), 0.1))
                : 1 / 60;
            if (!motionInitialized) {
                // Preserve phase-locked playground captures in normal motion,
                // while reduced motion begins from a calm authored phase.
                motionTime = motionReduced ? 0 : sampledTime;
                motionInitialized = true;
            } else if (!motionReduced && safeDelta === 0) {
                // Explicit playground scrubs/seeks are the only zero-delta
                // normal-motion updates that should jump to absolute time.
                motionTime = sampledTime;
            } else {
                motionTime += safeDelta * (
                    motionReduced ? REDUCED_MOTION_TIME_SCALE : 1
                );
            }
            uTime.value = motionTime;
            // Warm bounce pool breathes in sync with the lantern flame flicker.
            const flame = motionReduced
                ? 0.9
                : 0.82
                    + Math.sin(motionTime * 7.1) * 0.10
                    + Math.sin(motionTime * 13.7 + 1.3) * 0.06
                    + Math.sin(motionTime * 23.0 + 0.5) * 0.04;
            warmBounce.intensity = 7.0 * flame;
            updateFish(motionTime);
        },
        dispose() {
            if (typeof window !== 'undefined' && window.__KOI_POND_WATER__ === debugApi) {
                delete window.__KOI_POND_WATER__;
            }
            scene.remove(root);
            reflectionNode?.dispose?.();
            viewportDepth?.dispose();
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
    // Commit only after every geometry/material/node graph has been built.
    // A factory error before this point leaves no scene child or mutated global
    // renderer state for the outer transactional runtime to recover.
    scene.add(root);
    scene.background = new THREE.Color(0x04161a);
    // Slightly lifted teal haze gives the distant mountains/trees atmospheric
    // perspective (recede into moonlit haze) now that the shallower camera shows
    // more depth, without washing the mid-ground.
    scene.fog = new THREE.FogExp2(0x061a22, 0.0116);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.94;
    if (typeof window !== 'undefined') window.__KOI_POND_WATER__ = debugApi;
    return api;
}

export default createKoiPondWater;
