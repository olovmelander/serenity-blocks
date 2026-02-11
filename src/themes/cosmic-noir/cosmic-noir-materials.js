/**
 * Cosmic Noir - WebGPU TSL Node Materials (Phase 2)
 *
 * Each factory returns:
 * { material, uniforms, meta }
 */

import * as THREE from 'three';
import {
    AdditiveBlending,
    DoubleSide,
    FrontSide,
    MeshBasicNodeMaterial,
    MeshStandardNodeMaterial,
    PointsNodeMaterial,
    SpriteNodeMaterial,
} from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    modelViewMatrix,
    normalize,
    normalLocal,
    normalWorld,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    vertexIndex,
    texture,
    storage,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

export const BLOOM_CLASS_WEIGHTS = {
    planet: 0.7,
    atmosphere: 0.55,
    starfield: 0.15,
    voidSpark: 0.8,
    cosmicWave: 0.45,
    planetGlow: 0.3,
    nebula: 0.0,
};

function finalizeNodeMaterial(material, uniforms = {}, meta = {}) {
    const normalizedMeta = {
        emitsBloom: meta.emitsBloom ?? false,
        mrtRole: meta.mrtRole ?? 'default',
        ...meta,
    };

    material.userData = {
        ...(material.userData || {}),
        uniforms,
        ...normalizedMeta,
    };

    return {
        material,
        uniforms,
        meta: normalizedMeta,
    };
}

// Reusable 2D hash/noise/fbm helpers (match existing GLSL value-noise style).
function tslHash(p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

function tslNoise(p) {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = tslHash(i);
    const b = tslHash(i.add(vec2(1.0, 0.0)));
    const c = tslHash(i.add(vec2(0.0, 1.0)));
    const d = tslHash(i.add(vec2(1.0, 1.0)));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

function tslFbm(p, octaves = 5) {
    let value = float(0.0);
    let amplitude = float(0.5);
    let coord = p;

    for (let i = 0; i < octaves; i += 1) {
        value = value.add(amplitude.mul(tslNoise(coord)));
        coord = coord.mul(2.0);
        amplitude = amplitude.mul(0.5);
    }

    return value;
}

export function createPlanetNodeMaterial(params = {}) {
    const material = new MeshStandardNodeMaterial({ side: FrontSide });

    const uTime = uniform(0);
    const uPulseIntensity = uniform(0);
    const uGlowIntensity = uniform(1.0);
    const uSunDirection = uniform(
        (params.sunDirection ?? new THREE.Vector3(0.6, 0.4, 0.7)).clone().normalize(),
    );

    const uvCoord = uv();
    const texNode = params.map ? texture(params.map) : null;
    const texel = texNode ? texNode.sample(uvCoord) : vec4(0.12, 0.12, 0.14, 1.0);
    const luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));

    const detailNoise = tslFbm(
        uvCoord.mul(6.5).add(vec2(uTime.mul(0.05), uTime.mul(-0.03))),
        5,
    );
    const contrastLuma = pow(clamp(luma.mul(0.85).add(detailNoise.mul(0.25)), 0.0, 1.0), 2.2);

    const deepCharcoal = vec3(0.01, 0.01, 0.016);
    const brightSilver = vec3(0.22, 0.22, 0.3);
    const surfaceColor = mix(deepCharcoal, brightSilver, contrastLuma);

    const displacementNoise = tslFbm(
        vec2(positionLocal.x, positionLocal.y).mul(0.025).add(vec2(uTime.mul(0.08), 0.0)),
        4,
    );
    const displacement = displacementNoise.sub(0.5).mul(1.2);
    material.positionNode = positionLocal.add(normalLocal.mul(displacement));

    const nrm = normalize(normalWorld);
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const sunDir = normalize(uSunDirection);
    const fresnel = pow(float(1.0).sub(abs(dot(nrm, viewDir))), 3.0);
    const sunFacing = clamp(dot(nrm, sunDir).mul(0.5).add(0.5), 0.0, 1.0);
    const rimGlow = vec3(0.26, 0.26, 0.34)
        .mul(fresnel)
        .mul(sunFacing.mul(0.54).add(0.28));
    const pulseGlow = rimGlow.mul(uPulseIntensity.mul(0.6));
    const nightSide = clamp(float(1.0).sub(sunFacing), 0.0, 1.0);
    const subsurfaceNoise = tslFbm(
        uvCoord.mul(9.0).add(vec2(uTime.mul(0.12), uTime.mul(-0.07))),
        4,
    );
    const subsurfaceGlow = vec3(0.026, 0.026, 0.04)
        .mul(pow(nightSide, 1.35))
        .mul(subsurfaceNoise.mul(0.45).add(0.55))
        .mul(float(0.2).add(uPulseIntensity.mul(0.27)));

    const halfVector = normalize(sunDir.add(viewDir));
    const specular = pow(max(dot(nrm, halfVector), 0.0), 24.0).mul(contrastLuma).mul(0.26);
    const microHighlights = vec3(specular, specular, specular);

    const pulseMul = float(1.0).add(uPulseIntensity.mul(0.12));
    const finalColor = surfaceColor
        .add(rimGlow)
        .add(pulseGlow)
        .add(subsurfaceGlow)
        .add(microHighlights)
        .mul(uGlowIntensity)
        .mul(pulseMul);

    material.colorNode = clamp(finalColor, vec3(0.0), vec3(0.62));
    material.roughnessNode = clamp(float(0.9).sub(contrastLuma.mul(0.2)), 0.38, 1.0);
    material.metalnessNode = contrastLuma.mul(0.16);
    material.emissiveNode = rimGlow
        .mul(0.56)
        .add(pulseGlow.mul(0.62))
        .add(subsurfaceGlow.mul(0.36))
        .add(surfaceColor.mul(0.08))
        .mul(BLOOM_CLASS_WEIGHTS.planet * 0.58);

    return finalizeNodeMaterial(
        material,
        {
            uTime,
            uPulseIntensity,
            uGlowIntensity,
            uSunDirection,
        },
        { emitsBloom: true, mrtRole: 'planet' },
    );
}

export function createStarfieldNodeMaterial(params = {}) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexColors: true,
    });
    material.sizeAttenuation = false;

    const uTime = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio ?? 1);
    const uEventBoost = uniform(0);

    const useGPU = Boolean(params.isWebGPU && params.starCompute?.getStateBuffer);
    const starState = useGPU
        ? storage(params.starCompute.getStateBuffer(), 'vec4', params.starCompute.count)
        : null;

    const aPosition = attribute('position');
    const aColor = attribute('color');
    const aSize = attribute('aSize');
    const aTwinkle = attribute('aTwinkle');
    const aBrightness = attribute('aBrightness');

    material.positionNode = aPosition;

    const viewPos = modelViewMatrix.mul(vec4(aPosition, float(1.0)));
    const depth = max(float(1.0), viewPos.z.negate());

    const phase = useGPU ? starState.element(vertexIndex).x : aTwinkle.x;
    const twinkleSpeed = useGPU ? starState.element(vertexIndex).y : aTwinkle.y;
    const baseBrightness = useGPU ? starState.element(vertexIndex).z : aBrightness;
    const sizeValue = useGPU ? starState.element(vertexIndex).w : aSize;

    material.sizeNode = clamp(
        sizeValue.mul(uPixelRatio).mul(float(300.0)).div(depth),
        float(3.0),
        float(80.0),
    );

    const twinkle = useGPU
        ? sin(phase).mul(0.3).add(0.7)
        : sin(uTime.mul(twinkleSpeed).add(phase)).mul(0.3).add(0.7);
    const brightness = baseBrightness.mul(twinkle).mul(float(1.0).add(uEventBoost.mul(0.5)));

    // Avoid point-coordinate builtins (gl_PointCoord) to keep WGSL generation stable on RC5.
    const sizeFactor = clamp(sizeValue.div(float(40.0)), float(0.35), float(1.25));
    const coreColor = aColor
        .mul(brightness.mul(1.85))
        .add(vec3(0.06, 0.06, 0.08).mul(sizeFactor));
    const alpha = clamp(
        brightness.mul(0.75).mul(sizeFactor).add(0.1),
        float(0.08),
        float(1.0),
    );

    material.colorNode = coreColor;
    material.opacityNode = alpha;
    material.emissiveNode = coreColor.mul(alpha).mul(BLOOM_CLASS_WEIGHTS.starfield);

    return finalizeNodeMaterial(
        material,
        { uTime, uPixelRatio, uEventBoost },
        { emitsBloom: true, mrtRole: 'starfield' },
    );
}

export function createAmbientDustNodeMaterial(params = {}) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    const uTime = uniform(0);
    const uPulse = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio ?? 1.0);

    const aPosition = attribute('position');
    const aRandom = attribute('aRandom');
    const aSize = attribute('aSize');

    const orbitAngle = uTime.mul(0.08).mul(float(1.0).add(aRandom.mul(0.5)));
    const orbitSin = sin(orbitAngle);
    const orbitCos = cos(orbitAngle);
    const rotatedPos = vec3(
        aPosition.x.mul(orbitCos).sub(aPosition.z.mul(orbitSin)),
        aPosition.y.add(sin(uTime.mul(0.4).add(aRandom.mul(10.0))).mul(0.5)),
        aPosition.x.mul(orbitSin).add(aPosition.z.mul(orbitCos)),
    );
    material.positionNode = rotatedPos;

    const viewPos = modelViewMatrix.mul(vec4(rotatedPos, float(1.0)));
    const depth = max(float(1.0), viewPos.z.negate());
    material.sizeNode = clamp(
        aSize.mul(uPixelRatio).mul(float(220.0)).div(depth),
        float(1.5),
        float(22.0),
    );

    const pulse = sin(uTime.mul(1.5).add(aRandom.mul(10.0))).mul(0.3).add(0.3);
    const pulseReactive = pulse.add(uPulse.mul(0.2));
    const sizeFactor = clamp(aSize.div(float(24.0)), float(0.25), float(0.9));
    const alpha = clamp(pulseReactive.mul(sizeFactor).mul(0.28), 0.0, 0.35);

    const brightness = aRandom.mul(0.25).add(0.12);
    const color = vec3(brightness, brightness, brightness.add(0.01));

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0, 0.0, 0.0);

    return finalizeNodeMaterial(
        material,
        { uTime, uPulse, uPixelRatio },
        { emitsBloom: false, mrtRole: 'ambient-dust' },
    );
}

export function createAtmosphereNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: FrontSide,
    });

    const uTime = uniform(0);
    const uPulseIntensity = uniform(0);
    const uExplosionTimer = uniform(-10.0);
    const uExplosionIntensity = uniform(0);

    const useFlowCompute = Boolean(
        params.isWebGPU
        && params.atmosphereFlowCompute?.getFlowBuffer,
    );
    const flowState = useFlowCompute
        ? storage(params.atmosphereFlowCompute.getFlowBuffer(), 'vec4', 2)
        : null;

    const pos = normalize(positionLocal);
    const nrm = normalize(normalWorld);
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(abs(dot(nrm, viewDir))), 2.0);

    const flowTime = uTime.mul(0.8);
    const flowA = useFlowCompute ? flowState.element(0) : null;
    const flowB = useFlowCompute ? flowState.element(1) : null;
    const baseFlowA = vec2(flowTime.mul(0.35), flowTime.mul(-0.25));
    const baseFlowB = vec2(flowTime.mul(-0.2), flowTime.mul(0.3));
    const flowOffsetA = useFlowCompute ? vec2(flowA.x, flowA.y) : vec2(0.0, 0.0);
    const flowOffsetB = useFlowCompute ? vec2(flowA.z, flowA.w) : vec2(0.0, 0.0);
    const warpOffset = useFlowCompute
        ? vec2(flowB.x, flowB.y).mul(0.22)
        : vec2(0.0, 0.0);
    const flowDensityPulse = useFlowCompute ? flowB.z : float(1.0);
    const flowTurbulence = useFlowCompute ? flowB.w : float(1.0);

    const gasA = tslFbm(
        vec2(pos.x, pos.y)
            .mul(2.0)
            .add(baseFlowA)
            .add(flowOffsetA)
            .add(warpOffset),
        5,
    );
    const gasB = tslFbm(
        vec2(pos.z, pos.x)
            .mul(3.5)
            .add(baseFlowB)
            .add(flowOffsetB)
            .sub(warpOffset),
        4,
    );
    const breath = sin(uTime.mul(0.55)).mul(0.08).add(1.0);
    const tendrilField = tslFbm(
        vec2(pos.y, pos.z)
            .mul(5.2)
            .add(vec2(flowTime.mul(0.9), flowTime.mul(-0.7)))
            .add(flowOffsetB.mul(0.7))
            .add(warpOffset.mul(1.2)),
        4,
    );
    const tendrilMask = smoothstep(float(0.42), float(0.85), tendrilField).mul(flowTurbulence);
    const gas = mix(gasA, gasB, 0.4)
        .mul(flowDensityPulse)
        .mul(breath)
        .add(tendrilMask.mul(0.2));

    const explosionAge = max(float(0.0), uExplosionTimer);
    const explosionIn = smoothstep(float(0.0), float(0.15), explosionAge);
    const explosionOut = float(1.0).sub(smoothstep(float(2.5), float(4.0), explosionAge));
    const explosionWindow = explosionIn.mul(explosionOut);

    const radialDist = length(vec2(pos.x, pos.y));
    const pulseWave = sin(uTime.mul(4.0).sub(radialDist.mul(8.0)))
        .mul(0.5)
        .add(0.5)
        .mul(uPulseIntensity)
        .mul(0.35);
    const shockPhase = sin(explosionAge.mul(12.0).sub(radialDist.mul(6.0))).mul(0.5).add(0.5);
    const shockwave = shockPhase
        .mul(explosionWindow)
        .mul(uExplosionIntensity)
        .mul(flowTurbulence);

    const pulseMul = float(1.0).add(uPulseIntensity.mul(0.5));
    const tendrilGlow = vec3(0.22, 0.22, 0.3)
        .mul(tendrilMask.mul(0.1).add(pulseWave.mul(0.5)));
    let color = mix(vec3(0.03, 0.03, 0.045), vec3(0.11, 0.11, 0.16), gas).mul(pulseMul);
    color = color.add(tendrilGlow);
    color = color.add(vec3(0.32, 0.32, 0.4).mul(shockwave.mul(0.35)));

    const density = smoothstep(float(0.2), float(0.8), gas);
    const alpha = clamp(
        density
            .mul(0.16)
            .add(fresnel.mul(0.23))
            .add(shockwave.mul(0.28))
            .add(tendrilMask.mul(0.085))
            .add(pulseWave.mul(0.065))
            .add(0.035),
        0.0,
        0.46,
    );

    const emissive = color
        .mul(
            shockwave
                .add(uPulseIntensity.mul(0.18))
                .add(fresnel.mul(0.1))
                .add(tendrilMask.mul(0.12))
                .add(pulseWave.mul(0.18)),
        )
        .mul(BLOOM_CLASS_WEIGHTS.atmosphere * 0.52);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = emissive;

    return finalizeNodeMaterial(
        material,
        {
            uTime,
            uPulseIntensity,
            uExplosionTimer,
            uExplosionIntensity,
        },
        { emitsBloom: true, mrtRole: 'atmosphere' },
    );
}

export function createNebulaNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
    });

    const uOpacity = uniform(params.opacity ?? 0.2);
    const uPulse = uniform(0);

    const uvCoord = uv();
    const texNode = params.map ? texture(params.map) : null;
    const texel = texNode ? texNode.sample(uvCoord) : vec4(1.0, 1.0, 1.0, 1.0);

    const fadeX = smoothstep(float(0.0), float(0.4), uvCoord.x)
        .mul(smoothstep(float(1.0), float(0.6), uvCoord.x));
    const fadeY = smoothstep(float(0.0), float(0.4), uvCoord.y)
        .mul(smoothstep(float(1.0), float(0.6), uvCoord.y));
    const edgeFade = pow(fadeX.mul(fadeY), 1.5);

    const gray = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    const pulseFactor = float(1.0).add(uPulse.mul(0.14));
    const color = vec3(gray, gray, gray).mul(pulseFactor).mul(0.24);
    const alpha = texel.r.mul(uOpacity.add(uPulse.mul(0.014))).mul(edgeFade).mul(0.32);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0, 0.0, 0.0);

    return finalizeNodeMaterial(
        material,
        { uOpacity, uPulse },
        { emitsBloom: false, mrtRole: 'nebula' },
    );
}

export function createPlanetGlowNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
    });

    const uOpacity = uniform(params.opacity ?? 0.2);
    const uTint = uniform((params.color ?? new THREE.Color(0x666666)).clone());

    const uvCoord = uv();
    const centered = uvCoord.sub(0.5).mul(2.0);
    const dist = length(centered);
    const halo = float(1.0).sub(smoothstep(float(0.0), float(1.0), dist));
    const core = smoothstep(float(0.14), float(0.0), dist);
    const ring = smoothstep(float(0.85), float(0.45), dist).mul(0.32);
    const glowShape = halo.mul(0.72).add(core.mul(0.35)).add(ring);
    const alpha = glowShape.mul(uOpacity).mul(0.42);
    const color = uTint.mul(glowShape).mul(0.42);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0, 0.0, 0.0);

    return finalizeNodeMaterial(
        material,
        { uOpacity, uTint },
        { emitsBloom: false, mrtRole: 'planet-glow' },
    );
}

export function createPlanetGlowSpriteNodeMaterial(params = {}) {
    const material = new SpriteNodeMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
    });

    const uOpacity = uniform(params.opacity ?? 0.2);
    const uTint = uniform((params.color ?? new THREE.Color(0x666666)).clone());

    const uvCoord = uv();
    const centered = uvCoord.sub(0.5).mul(2.0);
    const dist = length(centered);
    const halo = float(1.0).sub(smoothstep(float(0.0), float(1.0), dist));
    const core = smoothstep(float(0.14), float(0.0), dist);
    const ring = smoothstep(float(0.85), float(0.45), dist).mul(0.32);
    const glowShape = halo.mul(0.72).add(core.mul(0.35)).add(ring);
    const alpha = glowShape.mul(uOpacity).mul(0.42);
    const color = uTint.mul(glowShape).mul(0.42);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0, 0.0, 0.0);

    return finalizeNodeMaterial(
        material,
        { uOpacity, uTint },
        { emitsBloom: false, mrtRole: 'planet-glow-sprite' },
    );
}

export function createVoidSparkNodeMaterial(params = {}) {
    const { sparkCompute = null, isWebGPU = false } = params;
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    const useGPU = Boolean(
        isWebGPU
        && sparkCompute?.getPositionBuffer
        && sparkCompute?.getLifeBuffer
        && sparkCompute?.getColorBuffer,
    );

    const positionBuffer = useGPU
        ? storage(sparkCompute.getPositionBuffer(), 'vec4', sparkCompute.count)
        : null;
    const lifeBuffer = useGPU
        ? storage(sparkCompute.getLifeBuffer(), 'vec4', sparkCompute.count)
        : null;
    const colorBuffer = useGPU
        ? storage(sparkCompute.getColorBuffer(), 'vec4', sparkCompute.count)
        : null;

    const time = uniform(0);
    const uPulseTimer = uniform(-100.0);

    const aTheta = useGPU ? null : attribute('aTheta');
    const aPhi = useGPU ? null : attribute('aPhi');
    const aRadius = useGPU ? null : attribute('aRadius');
    const aRandom = useGPU ? null : attribute('aRandom');
    const aColor = useGPU ? null : attribute('aColor');

    const sinPhi = useGPU ? null : sin(aPhi);
    const initialPos = useGPU
        ? null
        : vec3(
            aRadius.mul(sinPhi).mul(cos(aTheta)),
            aRadius.mul(sinPhi).mul(sin(aTheta)),
            aRadius.mul(cos(aPhi)),
        );
    const radialDir = useGPU ? null : normalize(initialPos);

    const triggerTime = useGPU ? null : aRandom.mul(3.5);
    const age = useGPU ? null : uPulseTimer.sub(triggerTime);
    const maxLife = useGPU ? null : float(90.0);
    const lifeNorm = useGPU ? null : clamp(age.div(maxLife), 0.0, 1.0);

    const active = useGPU ? null : step(float(0.0), age).mul(float(1.0).sub(step(maxLife, age)));

    const spreadX = useGPU ? null : aRandom.sub(0.5).mul(0.45);
    const spreadY = useGPU ? null : fract(aRandom.mul(7.0)).sub(0.5).mul(0.45);
    const spreadZ = useGPU ? null : fract(aRandom.mul(13.0)).sub(0.5).mul(0.45);
    const burstDir = useGPU ? null : normalize(radialDir.add(vec3(spreadX, spreadY, spreadZ)));

    const speed = useGPU ? null : float(40.0).add(aRandom.mul(25.0));
    const decel = useGPU ? null : max(float(0.35), float(1.0).sub(pow(lifeNorm, 1.2)));
    const animatedPos = useGPU ? null : initialPos.add(burstDir.mul(speed).mul(age).mul(decel));

    const hiddenPos = vec3(0.0, 0.0, -9999.0);
    material.positionNode = Fn(() => {
        if (useGPU) {
            const pos = positionBuffer.element(vertexIndex);
            return mix(hiddenPos, pos.xyz, pos.w);
        }
        return mix(hiddenPos, animatedPos, active);
    })();

    const alphaLife = Fn(() => {
        if (useGPU) {
            return lifeBuffer.element(vertexIndex).y;
        }
        return pow(float(1.0).sub(lifeNorm), 0.45).mul(active);
    })();

    const sizeValue = Fn(() => {
        if (useGPU) {
            const baseSize = colorBuffer.element(vertexIndex).w;
            return baseSize.mul(float(0.6).add(alphaLife.mul(0.8)));
        }
        return float(45.0).mul(float(1.2).sub(lifeNorm.mul(0.8))).mul(active);
    })();
    material.sizeNode = clamp(
        sizeValue,
        float(3.0),
        float(100.0),
    );

    const glow = clamp(alphaLife.mul(0.85).add(0.15), float(0.0), float(1.0));
    const core = clamp(pow(alphaLife, 0.42), float(0.0), float(1.0));

    const baseColor = Fn(() => {
        if (useGPU) {
            return colorBuffer.element(vertexIndex).xyz;
        }
        return aColor;
    })();

    let color = mix(baseColor, vec3(1.0, 1.0, 1.0), core.mul(0.7));
    color = mix(color, vec3(0.7, 0.7, 0.85), float(1.0).sub(core).mul(0.2));
    color = color.mul(1.3);

    const alpha = alphaLife.mul(glow);
    material.colorNode = color.mul(glow);
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha).mul(BLOOM_CLASS_WEIGHTS.voidSpark);

    const uniforms = useGPU ? { time } : { time, uPulseTimer };
    return finalizeNodeMaterial(
        material,
        uniforms,
        { emitsBloom: true, mrtRole: 'void-spark' },
    );
}

export function createCosmicWaveNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uOpacity = uniform(1.0);
    const uColor = uniform(params.color ?? new THREE.Color(0x888888));

    const nrm = normalize(normalWorld);
    const facing = abs(dot(nrm, vec3(0.0, 0.0, 1.0)));
    const intensity = pow(max(float(0.0), float(0.6).sub(facing)), 2.0);

    const color = uColor.mul(float(0.5).add(intensity.mul(0.5)));
    const alpha = uOpacity.mul(float(0.3).add(intensity.mul(0.7)));

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha).mul(BLOOM_CLASS_WEIGHTS.cosmicWave);

    return finalizeNodeMaterial(
        material,
        { uTime, uOpacity, uColor },
        { emitsBloom: true, mrtRole: 'cosmic-wave' },
    );
}
