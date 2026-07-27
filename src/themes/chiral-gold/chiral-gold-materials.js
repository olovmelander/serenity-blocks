/**
 * Chiral Gold - Node materials
 */

import * as THREE from 'three';
import {
    AdditiveBlending,
    DoubleSide,
    MeshBasicNodeMaterial,
    PointsNodeMaterial,
} from 'three/webgpu';
import {
    abs,
    attribute,
    clamp,
    cos,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    modelViewMatrix,
    pow,
    sin,
    smoothstep,
    storage,
    time,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    vertexIndex,
} from 'three/tsl';

export const BLOOM_CLASS_WEIGHTS = {
    burstSpark: 2.5,
    wisp: 1.5,
    strand: 1.0,
    goldDust: 0.8,
    lightBeam: 0.6,
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

export function createGoldDustNodeMaterial(params = {}) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexColors: true,
    });
    material.sizeAttenuation = false;

    const uTime = uniform(0);
    const uPulse = uniform(0);
    const uBass = uniform(0);
    const uEventBoost = uniform(0);
    const uColorTemperature = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio ?? 1.0);

    const useGPU = Boolean(params.isWebGPU && params.dustCompute?.getPositionBuffer);
    const positionBuffer = useGPU
        ? storage(params.dustCompute.getPositionBuffer(), 'vec4', params.dustCompute.count)
        : null;
    const lifeBuffer = useGPU
        ? storage(params.dustCompute.getLifeBuffer(), 'vec4', params.dustCompute.count)
        : null;
    const colorBuffer = useGPU
        ? storage(params.dustCompute.getColorBuffer(), 'vec4', params.dustCompute.count)
        : null;

    const aPosition = attribute('position');
    const aColor = attribute('color');
    const aSize = attribute('aSize');
    const aTwinkle = attribute('aTwinkle');
    const aAlpha = attribute('aAlpha');

    const phase = useGPU
        ? lifeBuffer.element(vertexIndex).w
        : aTwinkle;

    const basePos = useGPU ? positionBuffer.element(vertexIndex).xyz : aPosition;
    const angle = uTime.mul(float(0.03).add(phase.mul(0.12)));
    const angleSin = sin(angle);
    const angleCos = cos(angle);
    const pos = useGPU
        ? basePos
        : vec3(
            basePos.x.mul(angleCos).sub(basePos.z.mul(angleSin)),
            basePos.y.add(sin(uTime.mul(0.55).add(phase.mul(12.0))).mul(24.0)),
            basePos.x.mul(angleSin).add(basePos.z.mul(angleCos)),
        );
    material.positionNode = pos;

    const viewPos = modelViewMatrix.mul(vec4(pos, float(1.0)));
    const depth = max(float(1.0), viewPos.z.negate());

    const baseSize = useGPU
        ? colorBuffer.element(vertexIndex).w
        : aSize;

    // Depth-of-Field (bokeh simulation) based on distance to the board's plane (world z=0)
    const viewOrigin = modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const boardDepth = viewOrigin.z.negate();
    const focalDist = abs(depth.sub(boardDepth));
    const focalRange = float(340.0);
    const blurFactor = clamp(focalDist.sub(focalRange).div(650.0), 0.0, 3.2);

    const sizeScale = float(1.0).add(blurFactor.mul(1.25));
    const opacityScale = float(1.0).div(float(1.0).add(blurFactor.mul(2.5)));

    // Bass swells particle size (up to 35%), reactive pulse envelope adds another 50%
    const bassPulse = float(1.0).add(uBass.mul(0.35));
    const beatBoom = float(1.0).add(uPulse.mul(0.5));
    material.sizeNode = clamp(
        baseSize.mul(uPixelRatio).mul(float(200.0)).div(depth)
            .mul(bassPulse)
            .mul(beatBoom)
            .mul(sizeScale),
        float(2.0),
        float(150.0), // Restrict maximum size slightly for gentler bokeh circles
    );

    const baseColor = useGPU
        ? colorBuffer.element(vertexIndex).xyz
        : aColor;
    const lifeAlpha = useGPU
        ? lifeBuffer.element(vertexIndex).y
        : aAlpha;

    const twinkle = sin(uTime.mul(1.8).add(phase.mul(12.0))).mul(0.35).add(0.65);
    const pulseGain = float(1.0).add(uPulse.mul(0.42)).add(uBass.mul(0.18)).add(uEventBoost.mul(0.38));

    const heatedColor = mix(
        baseColor,
        vec3(1.0, 0.985, 0.95),
        clamp(uColorTemperature.mul(0.85), 0.0, 1.0),
    );
    const color = heatedColor
        .mul(float(2.2))
        .mul(twinkle)
        .mul(pulseGain);

    const alpha = clamp(
        lifeAlpha.mul(0.22).mul(float(0.75).add(uPulse.mul(0.35)))
            .mul(opacityScale),
        float(0.01),
        float(0.85),
    );

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha).mul(BLOOM_CLASS_WEIGHTS.goldDust);

    return finalizeNodeMaterial(
        material,
        {
            uTime,
            uPulse,
            uBass,
            uEventBoost,
            uColorTemperature,
            uPixelRatio,
        },
        { emitsBloom: true, mrtRole: 'gold-dust' },
    );
}

export function createBurstSparkNodeMaterial(params = {}) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexColors: true,
    });
    material.sizeAttenuation = false;

    const uTime = uniform(0);
    const uSparkBoost = uniform(0);
    const uBurstSizeBoost = uniform(0);
    const uColorTemperature = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio ?? 1.0);
    const maxBurstScreenSize = params.highQualityBurstClamp === true ? 210.0 : 130.0;

    const useGPU = Boolean(params.isWebGPU && params.burstCompute?.getPositionBuffer);
    const positionBuffer = useGPU
        ? storage(params.burstCompute.getPositionBuffer(), 'vec4', params.burstCompute.count)
        : null;
    const velocityBuffer = useGPU
        ? storage(params.burstCompute.getVelocityBuffer(), 'vec4', params.burstCompute.count)
        : null;
    const lifeBuffer = useGPU
        ? storage(params.burstCompute.getLifeBuffer(), 'vec4', params.burstCompute.count)
        : null;
    const colorBuffer = useGPU
        ? storage(params.burstCompute.getColorBuffer(), 'vec4', params.burstCompute.count)
        : null;

    const aPosition = attribute('position');
    const aVelocity = attribute('aVelocity');
    const aColor = attribute('aColor');
    const aSize = attribute('aSize');
    const aLife = attribute('aLife');

    const pos = useGPU ? positionBuffer.element(vertexIndex).xyz : aPosition;
    const vel = useGPU ? velocityBuffer.element(vertexIndex).xyz : aVelocity;
    material.positionNode = pos;

    const viewPos = modelViewMatrix.mul(vec4(pos, 1.0));
    const depth = max(float(1.0), viewPos.z.negate());

    // Depth-of-Field (bokeh simulation) based on distance to the board's plane (world z=0)
    const viewOrigin = modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const boardDepth = viewOrigin.z.negate();
    const focalDist = abs(depth.sub(boardDepth));
    const focalRange = float(340.0);
    const blurFactor = clamp(focalDist.sub(focalRange).div(650.0), 0.0, 3.2);

    const sizeScale = float(1.0).add(blurFactor.mul(1.25));
    const opacityScale = float(1.0).div(float(1.0).add(blurFactor.mul(2.5)));

    // Transform velocity to view space
    const viewVel = modelViewMatrix.mul(vec4(vel, float(0.0))).xyz;
    const velMagnitude = length(viewVel.xy);
    const velDir = viewVel.xy.div(velMagnitude.add(0.0001));

    const alphaLife = useGPU
        ? lifeBuffer.element(vertexIndex).y
        : aLife;

    const baseSize = useGPU
        ? colorBuffer.element(vertexIndex).w
        : aSize;

    // Elongation of the spark box based on velocity magnitude to prevent clipping
    const sizeStretchFactor = float(1.0).add(velMagnitude.mul(0.012));

    const sizeValue = baseSize
        .mul(float(0.55).add(alphaLife.mul(0.95)))
        .mul(float(1.0).add(uSparkBoost.mul(0.5)))
        .mul(float(1.0).add(uBurstSizeBoost))
        .mul(sizeScale)
        .mul(sizeStretchFactor);

    material.sizeNode = clamp(
        sizeValue.mul(uPixelRatio).mul(float(240.0)).div(depth),
        float(3.0),
        float(maxBurstScreenSize).mul(sizeStretchFactor),
    );

    const baseColor = useGPU
        ? colorBuffer.element(vertexIndex).xyz
        : aColor;

    // Fragment-level Anisotropic Stretching using soft exponential distance and smoothstep masking
    const uvCoord = uv().mul(2.0).sub(1.0); // range [-1, 1]
    const u = dot(uvCoord, velDir);
    const v = dot(uvCoord, vec2(velDir.y.negate(), velDir.x));

    // Stretch and narrow factors inside the fragment coordinate space
    const stretchFactor = float(1.0).add(velMagnitude.mul(0.016));
    const narrowFactor = float(1.0).add(velMagnitude.mul(0.012));

    const stretchedDist = (u.mul(u)).div(stretchFactor).add((v.mul(v)).mul(narrowFactor));
    const softness = exp(stretchedDist.negate().mul(3.5));
    const alphaMask = smoothstep(1.0, 0.8, stretchedDist);

    const hotCore = pow(alphaLife, 0.32);
    const heatedColor = mix(baseColor, vec3(1.0, 0.98, 0.94), clamp(uColorTemperature.mul(0.9), 0.0, 1.0));
    const color = mix(heatedColor, vec3(1.0, 1.0, 1.0), hotCore.mul(1.5))
        .mul(float(4.5).add(uSparkBoost.mul(2.0)));

    const alpha = clamp(alphaLife.mul(0.92).mul(softness).mul(alphaMask).mul(opacityScale), 0.0, 1.0);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha).mul(BLOOM_CLASS_WEIGHTS.burstSpark);

    return finalizeNodeMaterial(
        material,
        {
            uTime,
            uSparkBoost,
            uBurstSizeBoost,
            uColorTemperature,
            uPixelRatio,
        },
        { emitsBloom: true, mrtRole: 'burst-spark' },
    );
}

export function createWispNodeMaterial(params = {}) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexColors: true,
    });
    material.sizeAttenuation = false;

    const uTime = uniform(0);
    const uTreble = uniform(0);
    const uBeatPulse = uniform(0);
    const uColorTemperature = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio ?? 1.0);

    const useGPU = Boolean(params.isWebGPU && params.wispCompute?.getPositionBuffer);
    const positionBuffer = useGPU
        ? storage(params.wispCompute.getPositionBuffer(), 'vec4', params.wispCompute.count)
        : null;
    const colorBuffer = useGPU
        ? storage(params.wispCompute.getColorBuffer(), 'vec4', params.wispCompute.count)
        : null;

    const aPosition = attribute('position');
    const aColor = attribute('aColor');
    const aSize = attribute('aSize');
    const aPulse = attribute('aPulse');

    const pos4 = useGPU ? positionBuffer.element(vertexIndex) : vec4(aPosition, 1.0);
    const pos = pos4.xyz;
    material.positionNode = pos;

    const viewPos = modelViewMatrix.mul(vec4(pos, 1.0));
    const depth = max(float(1.0), viewPos.z.negate());

    // Depth-of-Field (bokeh simulation) based on distance to the board's plane (world z=0)
    const viewOrigin = modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const boardDepth = viewOrigin.z.negate();
    const focalDist = abs(depth.sub(boardDepth));
    const focalRange = float(340.0);
    const blurFactor = clamp(focalDist.sub(focalRange).div(650.0), 0.0, 3.2);

    const sizeScale = float(1.0).add(blurFactor.mul(1.25));
    const opacityScale = float(1.0).div(float(1.0).add(blurFactor.mul(2.5)));

    const baseSize = useGPU ? colorBuffer.element(vertexIndex).w : aSize;
    const pulseScale = useGPU ? pos4.w : aPulse;

    material.sizeNode = clamp(
        baseSize
            .mul(float(1.0).add(uTreble.mul(0.4)).add(uBeatPulse.mul(0.9)).mul(pulseScale))
            .mul(uPixelRatio)
            .mul(180.0)
            .div(depth)
            .mul(sizeScale),
        14.0,
        360.0, // Increase max size for soft wisp bokeh circles
    );

    const baseColor = useGPU ? colorBuffer.element(vertexIndex).xyz : aColor;
    // Treble drives shimmer frequency: 1.7 Hz (quiet) → 5.7 Hz (bright treble)
    const shimmerSpeed = float(1.7).add(uTreble.mul(4.0));
    const shimmer = sin(uTime.mul(shimmerSpeed).add(length(pos.xy).mul(0.025))).mul(0.35).add(0.65);
    const heatedColor = mix(baseColor, vec3(1.0, 0.97, 0.9), clamp(uColorTemperature.mul(0.85), 0.0, 1.0));
    const color = mix(heatedColor, vec3(1.0, 0.95, 0.82), 0.45)
        .mul(shimmer)
        .mul(float(2.2).add(uTreble.mul(0.55)));

    const alpha = clamp(
        float(0.26).add(shimmer.mul(0.45)).add(uBeatPulse.mul(0.3))
            .mul(opacityScale),
        float(0.02),
        float(0.95),
    );

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha).mul(BLOOM_CLASS_WEIGHTS.wisp);

    return finalizeNodeMaterial(
        material,
        {
            uTime,
            uTreble,
            uBeatPulse,
            uColorTemperature,
            uPixelRatio,
        },
        { emitsBloom: true, mrtRole: 'wisp' },
    );
}

export function createStrandNodeMaterial(params = {}) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexColors: true,
    });
    material.sizeAttenuation = false;

    const uTime = uniform(0);
    const uIntensity = uniform(0);
    const uColorTemperature = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio ?? 1.0);

    const aPosition = attribute('position');
    const aColor = attribute('color');
    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');

    material.positionNode = aPosition;

    const viewPos = modelViewMatrix.mul(vec4(aPosition, 1.0));
    const depth = max(float(1.0), viewPos.z.negate());

    // Depth-of-Field (bokeh simulation) based on distance to the board's plane (world z=0)
    const viewOrigin = modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const boardDepth = viewOrigin.z.negate();
    const focalDist = abs(depth.sub(boardDepth));
    const focalRange = float(340.0);
    const blurFactor = clamp(focalDist.sub(focalRange).div(650.0), 0.0, 3.2);

    const sizeScale = float(1.0).add(blurFactor.mul(1.25));
    const opacityScale = float(1.0).div(float(1.0).add(blurFactor.mul(2.5)));

    material.sizeNode = clamp(
        aSize
            .mul(float(1.0).add(uIntensity.mul(0.55)))
            .mul(uPixelRatio)
            .mul(210.0)
            .div(depth)
            .mul(sizeScale),
        2.0,
        150.0, // Increase max size for soft strand bokeh circles
    );

    const shimmer = sin(uTime.mul(2.2).add(aPhase.mul(18.0))).mul(0.35).add(0.65);
    const heatedColor = mix(aColor, vec3(1.0, 0.975, 0.92), clamp(uColorTemperature.mul(0.85), 0.0, 1.0));
    const color = mix(heatedColor, vec3(1.0, 0.95, 0.82), 0.42)
        .mul(shimmer)
        .mul(float(2.15).add(uIntensity.mul(0.45)));
    const alpha = clamp(
        float(0.18).add(shimmer.mul(0.42)).add(uIntensity.mul(0.2))
            .mul(opacityScale),
        float(0.02),
        float(0.95),
    );

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha).mul(BLOOM_CLASS_WEIGHTS.strand);

    return finalizeNodeMaterial(
        material,
        {
            uTime,
            uIntensity,
            uColorTemperature,
            uPixelRatio,
        },
        { emitsBloom: true, mrtRole: 'strand' },
    );
}

export function createLightBeamNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uOpacity = uniform(params.opacity ?? 0.25);
    const uColor = uniform(params.color ?? new THREE.Color(0xFFDA6A));

    const uvCoord = uv();
    const centerX = float(1.0).sub(abs(uvCoord.x.mul(2.0).sub(1.0)));
    const bottomFade = smoothstep(float(0.0), float(0.35), uvCoord.y);
    const topFade = float(1.0).sub(smoothstep(float(0.15), float(1.0), uvCoord.y));
    const verticalFade = bottomFade.mul(topFade);
    const beamCore = pow(clamp(centerX, 0.0, 1.0), 1.7).mul(verticalFade);

    // Multi-octave panning procedural noise (representing moving dust motes and turbulence)
    const noiseScale = vec2(14.0, 7.0);
    const noiseUv = uvCoord.mul(noiseScale).add(vec2(time.mul(0.12), time.mul(-0.06)));

    const n1 = sin(noiseUv.x.add(noiseUv.y)).mul(0.5).add(0.5);
    const n2 = cos(noiseUv.x.mul(2.13).sub(noiseUv.y.mul(1.85))).mul(0.35).add(0.35);
    const n3 = sin(noiseUv.x.mul(-3.45).add(noiseUv.y.mul(2.95))).mul(0.15).add(0.15);

    const noiseVal = n1.add(n2).add(n3);
    const modulatedBeam = beamCore.mul(mix(float(0.45), float(1.15), noiseVal));

    const color = uColor.mul(modulatedBeam.mul(1.7));
    const alpha = clamp(modulatedBeam.mul(uOpacity), 0.0, 1.0);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha).mul(BLOOM_CLASS_WEIGHTS.lightBeam);

    return finalizeNodeMaterial(
        material,
        {
            uOpacity,
            uColor,
        },
        { emitsBloom: true, mrtRole: 'light-beam' },
    );
}
