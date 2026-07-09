/**
 * Stellar Velocity - Material Factories (Phase 3)
 *
 * Dual-path strategy:
 * - WebGPU: Node materials (TSL) where available.
 * - WebGL: Existing shader/material fallbacks for visual parity and resilience.
 */

import * as THREE from 'three';
import {
    MeshBasicNodeMaterial,
    MeshStandardNodeMaterial,
    SpriteNodeMaterial,
} from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    length,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    sin,
    storage,
    instanceIndex,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import {
    STARFIELD_VERTEX_SHADER,
    STARFIELD_FRAGMENT_SHADER,
    NEBULA_VERTEX_SHADER,
    NEBULA_FRAGMENT_SHADER,
    WARP_CORE_VERTEX_SHADER,
    WARP_CORE_FRAGMENT_SHADER,
} from './stellar-velocity-shaders.js';

export const STELLAR_VELOCITY_BLOOM_WEIGHTS = {
    warpCore: 0.55,
    energyRing: 0.34,
    starfield: 0.08,
    burstParticle: 0.42,
    shockwave: 0.26,
    nebula: 0.00,
    asteroid: 0.00,
    coreGlow: 0.22,
};

// WebGPU path must not depend on large point primitives for signature visuals.
const WEBGPU_POINT_SIZE_CAP_PX = 1;

function resolveColor(color, fallback = 0xffffff) {
    if (color?.isColor) return color.clone();
    return new THREE.Color(color ?? fallback);
}

function isNodeMaterial(material) {
    return Boolean(
        material?.isNodeMaterial
        || material?.isMeshBasicNodeMaterial
        || material?.isMeshStandardNodeMaterial
        || material?.isPointsNodeMaterial
        || material?.isSpriteNodeMaterial
        || material?.type?.includes?.('NodeMaterial'),
    );
}

export function isStellarVelocityNodeMaterial(material) {
    return isNodeMaterial(material);
}

function finalizeStellarVelocityMaterial(material, uniforms = {}, meta = {}) {
    const emitsBloom = meta.emitsBloom === true;
    let zeroEmissiveEnforced = false;

    if (!emitsBloom) {
        if (isNodeMaterial(material)) {
            material.emissiveNode = vec3(0.0);
            zeroEmissiveEnforced = true;
        } else if (material?.emissive?.setRGB) {
            material.emissive.setRGB(0, 0, 0);
            if (typeof material.emissiveIntensity === 'number') {
                material.emissiveIntensity = 0;
            }
            zeroEmissiveEnforced = true;
        }
    }

    material.userData = {
        ...(material.userData || {}),
        uniforms,
        zeroEmissiveEnforced: emitsBloom ? undefined : zeroEmissiveEnforced,
        ...meta,
    };

    return {
        material,
        uniforms,
        meta: material.userData,
    };
}

function createStarfieldNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
    });
    material.alphaTest = 0.02;

    const uTime = uniform(0);
    const uWarpSpeed = uniform(0);
    const uTwinkleBoost = uniform(0);
    const uTunnelTint = uniform(resolveColor(params.tunnelTint, 0xffffff));

    const useGPU = Boolean(
        params.isWebGPU
        && params.starCompute?.getPositionBuffer
        && params.starCompute?.getMiscBuffer
        && Number.isFinite(params.starCompute?.count),
    );
    const positionStorage = useGPU
        ? storage(params.starCompute.getPositionBuffer(), 'vec4', params.starCompute.count)
        : null;
    const miscStorage = useGPU
        ? storage(params.starCompute.getMiscBuffer(), 'vec4', params.starCompute.count)
        : null;
    const aOffset = useGPU ? null : attribute('aOffset', 'vec3');
    const aColor = attribute('color', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aVelocity = useGPU ? null : attribute('aVelocity', 'float');
    const aTwinkle = attribute('aTwinkle', 'vec2');
    const uvCoord = uv();
    const offsetNode = useGPU ? positionStorage.element(instanceIndex).xyz : aOffset;
    const velocityNode = useGPU ? miscStorage.element(instanceIndex).x : aVelocity;
    const twinklePhase = useGPU
        ? miscStorage.element(instanceIndex).y
        : uTime.mul(aTwinkle.y).add(aTwinkle.x);
    const streakFactor = useGPU ? miscStorage.element(instanceIndex).w : float(1.0);

    const twinkle = sin(twinklePhase).mul(0.22).add(0.82);
    const warpMul = float(1.0).add(uWarpSpeed.mul(0.65));
    const boostMul = float(1.0).add(uTwinkleBoost.mul(0.35));
    const tintWeight = clamp(float(0.22).add(uWarpSpeed.mul(0.18)), float(0.0), float(0.65));
    const tunnelTint = mix(vec3(1.0), uTunnelTint, tintWeight);
    const colorNode = aColor.mul(twinkle).mul(warpMul).mul(boostMul).mul(tunnelTint)
        .add(vec3(uWarpSpeed.mul(0.04)));

    const dist = length(uvCoord.sub(vec2(0.5)));
    const softCircle = smoothstep(float(0.52), float(0.0), dist);
    const alpha = clamp(softCircle.mul(twinkle).mul(0.96), float(0.0), float(1.0));
    const warpStretch = float(1.0).add(uWarpSpeed.mul(2.2).mul(velocityNode).mul(streakFactor));
    const billboardSize = aSize.mul(float(0.16));
    const starColor = colorNode.mul(softCircle.mul(0.82).add(0.18));

    material.positionNode = vec3(
        positionLocal.x.mul(billboardSize),
        positionLocal.y.mul(billboardSize).mul(warpStretch),
        positionLocal.z,
    ).add(offsetNode);
    material.colorNode = starColor;
    material.opacityNode = alpha;
    material.emissiveNode = starColor.mul(alpha).mul(STELLAR_VELOCITY_BLOOM_WEIGHTS.starfield);

    return finalizeStellarVelocityMaterial(
        material,
        {
            uTime,
            uWarpSpeed,
            uTwinkleBoost,
            uTunnelTint,
        },
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.starfield,
            mrtRole: 'starfield',
            primitive: 'billboard-quad',
            usesBillboardQuads: true,
            usesCompute: useGPU,
        },
    );
}

function createStarfieldShaderMaterial(params = {}) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: params.pixelRatio ?? 1 },
            uWarpSpeed: { value: 0 },
            uTwinkleBoost: { value: 0 },
            uTunnelTint: { value: resolveColor(params.tunnelTint, 0xffffff) },
            uTexture: { value: params.starTexture ?? null },
        },
        vertexShader: STARFIELD_VERTEX_SHADER,
        fragmentShader: STARFIELD_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
    });

    return finalizeStellarVelocityMaterial(
        material,
        material.uniforms,
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.starfield,
            mrtRole: 'starfield',
        },
    );
}

export function createStellarVelocityStarfieldMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStarfieldNodeMaterial(params);
    }
    return createStarfieldShaderMaterial(params);
}

function createWarpCoreNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const uTime = uniform(0);
    const uGlowIntensity = uniform(params.glowIntensity ?? 0.5);
    const uColor = uniform(resolveColor(params.color, 0xffffff));
    const uPulseBoost = uniform(params.pulseBoost ?? 0.0);

    const local = positionLocal;
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(abs(dot(normalWorld, viewDir))), float(2.2));
    // Domain-warped plasma banding for a richer core energy body.
    const domainWarp = sin(local.x.mul(0.09).add(uTime.mul(1.7)))
        .mul(0.6)
        .add(cos(local.z.mul(0.07).sub(uTime.mul(1.3))).mul(0.4));
    const plasmaA = sin(local.y.mul(0.14).add(uTime.mul(4.2)).add(domainWarp));
    const plasmaB = cos(local.x.mul(0.10).sub(local.z.mul(0.09)).add(uTime.mul(2.8)).add(domainWarp.mul(0.65)));
    const plasma = plasmaA.mul(0.6).add(plasmaB.mul(0.4)).mul(0.5).add(0.5);
    const swirl = sin(length(vec2(local.x, local.z)).mul(0.11).sub(uTime.mul(2.3)).add(domainWarp.mul(0.8)))
        .mul(0.5)
        .add(0.5);
    const pulseEnvelope = sin(uTime.mul(4.6)).mul(0.5).add(0.5);
    const pulse = float(0.55)
        .add(uGlowIntensity.mul(0.45))
        .add(uPulseBoost.mul(0.40))
        .mul(pulseEnvelope.mul(0.35).add(0.65));

    const coreColor = uColor.mul(plasma.mul(0.9).add(swirl.mul(0.4)).add(0.25)).mul(pulse);
    const rimColor = uColor.mul(fresnel.mul(1.35).add(0.2));
    const finalColor = coreColor.add(rimColor);
    const alpha = clamp(plasma.mul(0.34).add(swirl.mul(0.24)).add(fresnel.mul(0.45)).add(0.12), float(0.0), float(1.0));

    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = finalColor.mul(STELLAR_VELOCITY_BLOOM_WEIGHTS.warpCore);

    return finalizeStellarVelocityMaterial(
        material,
        {
            uTime, uGlowIntensity, uColor, uPulseBoost,
        },
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.warpCore,
            mrtRole: 'warp-core',
        },
    );
}

function createWarpCoreShaderMaterial(params = {}) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uGlowIntensity: { value: params.glowIntensity ?? 0.5 },
            uColor: { value: resolveColor(params.color, 0xffffff) },
            uPulseBoost: { value: params.pulseBoost ?? 0.0 },
        },
        vertexShader: WARP_CORE_VERTEX_SHADER,
        fragmentShader: WARP_CORE_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    return finalizeStellarVelocityMaterial(
        material,
        material.uniforms,
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.warpCore,
            mrtRole: 'warp-core',
        },
    );
}

export function createStellarVelocityWarpCoreMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createWarpCoreNodeMaterial(params);
    }
    return createWarpCoreShaderMaterial(params);
}

function createNebulaNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const uTime = uniform(0);
    const uColor = uniform(resolveColor(params.color, 0x00ffff));
    const uOpacity = uniform(params.opacity ?? 0.3);
    const uPulse = uniform(0);
    const uSeed = uniform(params.seed ?? 1);
    const uFlowDir = uniform(params.flowDir ?? new THREE.Vector2(0.7, 0.25));
    const uFlowOffset = uniform(params.flowOffset ?? new THREE.Vector2(0, 0));
    const uFlowSpeed = uniform(params.flowSpeed ?? 0.045);
    const uWarpAmount = uniform(params.warpAmount ?? 0.22);
    const uDetailScale = uniform(params.detailScale ?? 2.8);
    const uMorphRate = uniform(params.morphRate ?? 0.36);

    const uvCoord = uv();
    const flowPhase = uTime.mul(uFlowSpeed);
    const flowUv = uvCoord
        .mul(uDetailScale)
        .add(uFlowOffset)
        .add(uFlowDir.mul(flowPhase));
    const warpX = sin(flowUv.x.mul(1.7).add(flowUv.y.mul(1.3)).add(uTime.mul(uMorphRate)).add(uSeed.mul(0.31)));
    const warpY = cos(flowUv.y.mul(1.9).sub(flowUv.x.mul(1.2)).sub(uTime.mul(uMorphRate.mul(0.82))).add(uSeed.mul(0.17)));
    const warpedUv = flowUv.add(vec2(warpX, warpY).mul(uWarpAmount));

    const layerA = sin(warpedUv.x.mul(2.4).add(warpedUv.y.mul(1.6)).add(uTime.mul(0.06)).add(uSeed.mul(0.11)))
        .mul(0.5)
        .add(0.5);
    const layerB = cos(warpedUv.y.mul(3.1).sub(warpedUv.x.mul(1.8)).sub(uTime.mul(0.05)).add(uSeed.mul(0.19)))
        .mul(0.5)
        .add(0.5);
    const layerC = sin(warpedUv.x.add(warpedUv.y).mul(2.8).add(uTime.mul(0.04)).add(uSeed.mul(0.29)))
        .mul(0.5)
        .add(0.5);
    const detailUv = warpedUv.mul(1.85);
    const layerD = cos(detailUv.x.mul(2.9).add(detailUv.y.mul(2.1)).add(uTime.mul(0.09)).add(uSeed.mul(0.41)))
        .mul(0.5)
        .add(0.5);
    const density = layerA.mul(0.34)
        .add(layerB.mul(0.28))
        .add(layerC.mul(0.22))
        .add(layerD.mul(0.16));

    const fadeX = smoothstep(float(0.0), float(0.2), uvCoord.x)
        .mul(smoothstep(float(1.0), float(0.8), uvCoord.x));
    const fadeY = smoothstep(float(0.0), float(0.2), uvCoord.y)
        .mul(smoothstep(float(1.0), float(0.8), uvCoord.y));
    const edgeFade = fadeX.mul(fadeY);
    const pulseMul = float(1.0).add(uPulse.mul(0.55));
    const colorVariance = density.mul(1.18).add(0.12);
    const alphaDensity = density.mul(0.78).add(0.16);
    const nebulaColor = uColor.mul(colorVariance).mul(pulseMul);
    const alpha = uOpacity.mul(edgeFade).mul(alphaDensity);

    material.colorNode = nebulaColor;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0);

    return finalizeStellarVelocityMaterial(
        material,
        {
            uTime,
            uColor,
            uOpacity,
            uPulse,
            uSeed,
            uFlowDir,
            uFlowOffset,
            uFlowSpeed,
            uWarpAmount,
            uDetailScale,
            uMorphRate,
        },
        {
            emitsBloom: false,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.nebula,
            mrtRole: 'nebula',
        },
    );
}

function createNebulaShaderMaterial(params = {}) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: resolveColor(params.color, 0x00ffff) },
            uOpacity: { value: params.opacity ?? 0.3 },
            uPulse: { value: 0 },
            uSeed: { value: params.seed ?? 1 },
            uFlowDir: { value: (params.flowDir || new THREE.Vector2(0.7, 0.25)).clone?.() || new THREE.Vector2(0.7, 0.25) },
            uFlowOffset: { value: (params.flowOffset || new THREE.Vector2(0, 0)).clone?.() || new THREE.Vector2(0, 0) },
            uFlowSpeed: { value: params.flowSpeed ?? 0.045 },
            uWarpAmount: { value: params.warpAmount ?? 0.22 },
            uDetailScale: { value: params.detailScale ?? 2.8 },
            uMorphRate: { value: params.morphRate ?? 0.36 },
        },
        vertexShader: NEBULA_VERTEX_SHADER,
        fragmentShader: NEBULA_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    return finalizeStellarVelocityMaterial(
        material,
        material.uniforms,
        {
            emitsBloom: false,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.nebula,
            mrtRole: 'nebula',
        },
    );
}

export function createStellarVelocityNebulaMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createNebulaNodeMaterial(params);
    }
    return createNebulaShaderMaterial(params);
}

function createAsteroidNodeMaterial(params = {}) {
    const material = new MeshStandardNodeMaterial({
        flatShading: true,
    });

    const uBaseColor = uniform(resolveColor(params.color, 0x444444));
    const uRoughness = uniform(params.roughness ?? 0.8);
    const uMetalness = uniform(params.metalness ?? 0.2);
    const uEmissiveTint = uniform(resolveColor(params.emissive, 0x111122));
    const uCoreGlow = uniform(params.coreGlow ?? 0.0);
    const aCoreProximity = attribute('aCoreProximity', 'float');

    const roughNoise = sin(positionLocal.x.mul(0.17))
        .add(cos(positionLocal.y.mul(0.19)))
        .add(sin(positionLocal.z.mul(0.23)))
        .mul(0.333)
        .mul(0.5)
        .add(0.5);
    const proximity = clamp(aCoreProximity, float(0.0), float(1.0));
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const edgeMask = pow(float(1.0).sub(abs(dot(normalWorld, viewDir))), float(2.1));
    const glowMask = proximity.mul(uCoreGlow).mul(edgeMask.mul(0.55).add(0.22));
    const edgeTint = uEmissiveTint.mul(glowMask.mul(0.35));
    const rockColor = uBaseColor.mul(mix(float(0.78), float(1.08), roughNoise)).add(edgeTint);

    material.colorNode = rockColor;
    material.roughnessNode = clamp(uRoughness.add(roughNoise.mul(0.08)).sub(0.04), float(0.05), float(1.0));
    material.metalnessNode = clamp(uMetalness.add(roughNoise.mul(0.05)).sub(0.025), float(0.0), float(1.0));

    return finalizeStellarVelocityMaterial(
        material,
        {
            uBaseColor,
            uRoughness,
            uMetalness,
            uEmissiveTint,
            uCoreGlow,
            aCoreProximity,
        },
        {
            emitsBloom: false,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.asteroid,
            mrtRole: 'asteroid',
        },
    );
}

function createAsteroidFallbackMaterial(params = {}) {
    const material = new THREE.MeshStandardMaterial({
        color: resolveColor(params.color, 0x444444),
        emissive: resolveColor(params.emissive, 0x111122),
        emissiveIntensity: 0.08 + Math.max(0, params.coreGlow ?? 0) * 0.18,
        roughness: params.roughness ?? 0.8,
        metalness: params.metalness ?? 0.2,
        flatShading: true,
    });

    return finalizeStellarVelocityMaterial(
        material,
        material.uniforms || {},
        {
            emitsBloom: false,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.asteroid,
            mrtRole: 'asteroid',
        },
    );
}

export function createStellarVelocityAsteroidMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createAsteroidNodeMaterial(params);
    }
    return createAsteroidFallbackMaterial(params);
}

function createEnergyRingNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const uColor = uniform(resolveColor(params.color, 0xffffff));
    const uOpacity = uniform(params.opacity ?? 0.5);
    const uTime = uniform(0);
    const uShimmer = uniform(params.shimmer ?? 0.0);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(abs(dot(normalWorld, viewDir))), float(1.4));
    const ripple = sin(positionLocal.z.mul(0.12).add(uTime.mul(1.4))).mul(0.5).add(0.5);
    const shimmer = sin(positionLocal.x.mul(0.15).add(positionLocal.y.mul(0.18)).add(uTime.mul(2.6)))
        .mul(0.5)
        .add(0.5)
        .mul(uShimmer.mul(0.55).add(0.45));
    const glowMask = fresnel.mul(0.75).add(ripple.mul(0.25));
    const ringColor = uColor.mul(glowMask.add(0.32).add(shimmer.mul(0.22)));

    material.colorNode = ringColor;
    material.opacityNode = uOpacity.mul(glowMask.add(0.30).add(shimmer.mul(0.25)));
    material.emissiveNode = ringColor.mul(STELLAR_VELOCITY_BLOOM_WEIGHTS.energyRing);

    return finalizeStellarVelocityMaterial(
        material,
        {
            uColor, uOpacity, uTime, uShimmer,
        },
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.energyRing,
            mrtRole: 'energy-ring',
        },
    );
}

function createEnergyRingFallbackMaterial(params = {}) {
    const material = new THREE.MeshBasicMaterial({
        color: resolveColor(params.color, 0xffffff),
        transparent: true,
        opacity: params.opacity ?? 0.5,
        blending: THREE.AdditiveBlending,
    });

    return finalizeStellarVelocityMaterial(
        material,
        material.uniforms || {},
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.energyRing,
            mrtRole: 'energy-ring',
        },
    );
}

export function createStellarVelocityEnergyRingMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createEnergyRingNodeMaterial(params);
    }
    return createEnergyRingFallbackMaterial(params);
}

function createBurstParticleNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    material.alphaTest = 0.025;

    const uColor = uniform(resolveColor(params.color, 0xffffff));
    const uSize = uniform(params.size ?? 18);
    const uOpacity = uniform(params.opacity ?? 1.0);
    const useGPU = Boolean(
        params.isWebGPU
        && params.burstCompute?.getPositionBuffer
        && params.burstCompute?.getVelocityBuffer
        && Number.isFinite(params.burstCompute?.count),
    );
    const usePingPong = useGPU
        && params.burstCompute?.getPositionBuffers
        && params.burstCompute?.getDisplayBufferIndexUniform;
    const positionBuffers = usePingPong ? params.burstCompute.getPositionBuffers() : null;
    const positionStorage = useGPU
        ? storage(params.burstCompute.getPositionBuffer(), 'vec4', params.burstCompute.count)
        : null;
    const positionStorageA = usePingPong && positionBuffers?.[0]
        ? storage(positionBuffers[0], 'vec4', params.burstCompute.count)
        : null;
    const positionStorageB = usePingPong && positionBuffers?.[1]
        ? storage(positionBuffers[1], 'vec4', params.burstCompute.count)
        : null;
    const aOffset = useGPU ? null : attribute('aOffset', 'vec3');
    const aSize = attribute('aSize', 'float');
    const uvCoord = uv();
    const displayBufferIndex = usePingPong ? params.burstCompute.getDisplayBufferIndexUniform() : float(0.0);
    const positionNode = usePingPong
        ? mix(
            positionStorageA.element(instanceIndex).xyz,
            positionStorageB.element(instanceIndex).xyz,
            displayBufferIndex,
        )
        : (useGPU ? positionStorage.element(instanceIndex).xyz : aOffset);
    const lifeNode = usePingPong
        ? mix(
            positionStorageA.element(instanceIndex).w,
            positionStorageB.element(instanceIndex).w,
            displayBufferIndex,
        )
        : (useGPU ? positionStorage.element(instanceIndex).w : float(1.0));
    const lifeWeight = useGPU ? clamp(lifeNode, float(0.0), float(1.0)) : float(1.0);

    const dist = length(uvCoord.sub(vec2(0.5)));
    const radial = smoothstep(float(0.5), float(0.0), dist);
    const burstColor = uColor.mul(radial.mul(1.15));
    const alpha = clamp(radial.mul(uOpacity).mul(lifeWeight), float(0.0), float(1.0));
    const billboardSize = aSize.mul(uSize).mul(0.12);

    material.positionNode = vec3(
        positionLocal.x.mul(billboardSize),
        positionLocal.y.mul(billboardSize),
        positionLocal.z,
    ).add(positionNode);
    material.colorNode = burstColor;
    material.opacityNode = alpha;
    material.emissiveNode = burstColor.mul(alpha).mul(STELLAR_VELOCITY_BLOOM_WEIGHTS.burstParticle);

    return finalizeStellarVelocityMaterial(
        material,
        { uColor, uSize, uOpacity },
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.burstParticle,
            mrtRole: 'burst-particle',
            primitive: 'billboard-quad',
            usesBillboardQuads: true,
            usesCompute: useGPU,
        },
    );
}

function createBurstParticleFallbackMaterial(params = {}) {
    const material = new THREE.PointsMaterial({
        color: resolveColor(params.color, 0xffffff),
        size: params.size ?? 18,
        transparent: true,
        opacity: params.opacity ?? 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        map: params.starTexture ?? null,
    });

    return finalizeStellarVelocityMaterial(
        material,
        material.uniforms || {},
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.burstParticle,
            mrtRole: 'burst-particle',
        },
    );
}

export function createStellarVelocityBurstParticleMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createBurstParticleNodeMaterial(params);
    }
    return createBurstParticleFallbackMaterial(params);
}

function createShockwaveNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const uColor = uniform(resolveColor(params.color, 0xffffff));
    const uOpacity = uniform(params.opacity ?? 0.8);

    const uvCoord = uv();
    const radial = length(uvCoord.sub(vec2(0.5)).mul(2.0));
    const band = smoothstep(float(0.45), float(0.15), abs(radial.sub(0.6)));
    const ringColor = uColor.mul(band.mul(0.8).add(0.2));

    material.colorNode = ringColor;
    material.opacityNode = clamp(uOpacity.mul(band), float(0.0), float(1.0));
    material.emissiveNode = ringColor.mul(STELLAR_VELOCITY_BLOOM_WEIGHTS.shockwave);

    return finalizeStellarVelocityMaterial(
        material,
        { uColor, uOpacity },
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.shockwave,
            mrtRole: 'shockwave',
        },
    );
}

function createShockwaveFallbackMaterial(params = {}) {
    const material = new THREE.MeshBasicMaterial({
        color: resolveColor(params.color, 0xffffff),
        transparent: true,
        opacity: params.opacity ?? 0.8,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });

    return finalizeStellarVelocityMaterial(
        material,
        material.uniforms || {},
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.shockwave,
            mrtRole: 'shockwave',
        },
    );
}

export function createStellarVelocityShockwaveMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createShockwaveNodeMaterial(params);
    }
    return createShockwaveFallbackMaterial(params);
}

function createCoreGlowSpriteNodeMaterial(params = {}) {
    const material = new SpriteNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    material.alphaTest = 0.01;

    const uColor = uniform(resolveColor(params.color, 0xffffff));
    const uOpacity = uniform(params.opacity ?? 0.5);

    const uvCoord = uv();
    const centered = uvCoord.sub(vec2(0.5)).mul(2.0);
    const dist = length(centered);
    const halo = float(1.0).sub(smoothstep(float(0.0), float(1.0), dist));
    const core = smoothstep(float(0.2), float(0.0), dist);
    const ring = smoothstep(float(0.92), float(0.45), dist).mul(0.24);
    const glowShape = halo.mul(0.72).add(core.mul(0.35)).add(ring);
    const alpha = glowShape.mul(uOpacity);
    const glowColor = uColor.mul(glowShape);

    material.colorNode = glowColor;
    material.opacityNode = clamp(alpha, float(0.0), float(1.0));
    material.emissiveNode = glowColor.mul(uOpacity).mul(STELLAR_VELOCITY_BLOOM_WEIGHTS.coreGlow);

    return finalizeStellarVelocityMaterial(
        material,
        { uColor, uOpacity },
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.coreGlow,
            mrtRole: 'core-glow',
            materialKind: 'sprite',
        },
    );
}

function createCoreGlowFallbackMaterial(params = {}) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: resolveColor(params.color, 0xffffff) },
            uOpacity: { value: params.opacity ?? 0.5 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            uniform vec3 uColor;
            uniform float uOpacity;
            void main() {
                vec2 centered = (vUv - 0.5) * 2.0;
                float dist = length(centered);
                float halo = 1.0 - smoothstep(0.0, 1.0, dist);
                float core = smoothstep(0.2, 0.0, dist);
                float ring = smoothstep(0.92, 0.45, dist) * 0.24;
                float glowShape = halo * 0.72 + core * 0.35 + ring;
                float alpha = clamp(glowShape * uOpacity, 0.0, 1.0);
                vec3 color = uColor * glowShape;
                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    return finalizeStellarVelocityMaterial(
        material,
        material.uniforms,
        {
            emitsBloom: true,
            bloomWeight: STELLAR_VELOCITY_BLOOM_WEIGHTS.coreGlow,
            mrtRole: 'core-glow',
            materialKind: 'mesh',
        },
    );
}

export function createStellarVelocityCoreGlowMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createCoreGlowSpriteNodeMaterial(params);
    }
    return createCoreGlowFallbackMaterial(params);
}

export function auditStellarVelocityMaterialReadiness(
    scene,
    {
        requireNodeMaterials = false,
        enforcePointSizePolicy = true,
        maxPointSizePx = WEBGPU_POINT_SIZE_CAP_PX,
    } = {},
) {
    const report = {
        ready: true,
        materialCount: 0,
        issues: [],
    };

    if (!scene?.traverse) {
        report.ready = false;
        report.issues.push({
            severity: 'error',
            code: 'NO_SCENE',
            message: 'Scene is not available for material audit.',
        });
        return report;
    }

    const seenMaterials = new Set();
    const addIssue = (severity, code, message, material, object) => {
        report.issues.push({
            severity,
            code,
            message,
            materialUuid: material?.uuid ?? null,
            materialName: material?.name ?? null,
            materialType: material?.type ?? null,
            objectName: object?.name ?? null,
        });
    };

    scene.traverse((object) => {
        if (!object?.material) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
            if (!material?.uuid || seenMaterials.has(material.uuid)) return;
            seenMaterials.add(material.uuid);
            report.materialCount += 1;

            const meta = material.userData || {};
            const emitsBloom = meta.emitsBloom === true;
            const emitsNoBloom = meta.emitsBloom === false;
            const bloomWeight = Number(meta.bloomWeight);

            if (!meta.mrtRole) {
                addIssue(
                    'error',
                    'MISSING_MRT_ROLE',
                    'Material is missing mrtRole metadata required for MRT readiness.',
                    material,
                    object,
                );
            }

            if (!Number.isFinite(bloomWeight)) {
                addIssue(
                    'error',
                    'MISSING_BLOOM_WEIGHT',
                    'Material is missing a numeric bloomWeight metadata value.',
                    material,
                    object,
                );
            } else if (emitsBloom && bloomWeight <= 0) {
                addIssue(
                    'error',
                    'INVALID_BLOOM_WEIGHT',
                    'Bloom-enabled material has non-positive bloomWeight.',
                    material,
                    object,
                );
            } else if (emitsNoBloom && bloomWeight !== 0) {
                addIssue(
                    'warning',
                    'NON_ZERO_BLOOM_WEIGHT',
                    'Non-bloom material should use bloomWeight 0.0 for deterministic MRT isolation.',
                    material,
                    object,
                );
            }

            if (emitsNoBloom && meta.zeroEmissiveEnforced !== true) {
                addIssue(
                    requireNodeMaterials ? 'error' : 'warning',
                    requireNodeMaterials ? 'ZERO_EMISSIVE_NOT_ENFORCED' : 'ZERO_EMISSIVE_UNVERIFIED',
                    requireNodeMaterials
                        ? 'Non-bloom material is not marked as zero-emissive enforced.'
                        : 'Non-bloom material zero-emissive state cannot be strictly verified outside node-material MRT mode.',
                    material,
                    object,
                );
            }

            if (requireNodeMaterials && !isNodeMaterial(material)) {
                addIssue(
                    'error',
                    'NON_NODE_MATERIAL',
                    'WebGPU MRT path requires node materials.',
                    material,
                    object,
                );
            }

            if (requireNodeMaterials && (meta.mrtRole === 'starfield' || meta.mrtRole === 'burst-particle')) {
                if (meta.primitive !== 'billboard-quad' || meta.usesBillboardQuads !== true) {
                    addIssue(
                        'error',
                        'BILLBOARD_POLICY_VIOLATION',
                        'WebGPU starfield/burst materials must use billboard quads, not point primitives.',
                        material,
                        object,
                    );
                }
            }

            if (enforcePointSizePolicy) {
                const isPointPrimitive = meta.primitive === 'points'
                    || material.isPointsMaterial === true
                    || material.isPointsNodeMaterial === true
                    || material.type === 'PointsNodeMaterial';

                if (isPointPrimitive) {
                    const pointSizeCap = Number(meta.pointSizePxCap);
                    if (!Number.isFinite(pointSizeCap)) {
                        addIssue(
                            'error',
                            'MISSING_POINT_SIZE_CAP',
                            'Point material is missing pointSizePxCap metadata required by WebGPU safety policy.',
                            material,
                            object,
                        );
                    } else if (pointSizeCap > maxPointSizePx) {
                        addIssue(
                            'error',
                            'POINT_SIZE_POLICY_VIOLATION',
                            `Point size cap ${pointSizeCap}px exceeds allowed ${maxPointSizePx}px policy.`,
                            material,
                            object,
                        );
                    }
                }
            }
        });
    });

    report.ready = report.issues.every((issue) => issue.severity !== 'error');
    return report;
}
