/**
 * Swedish Forest Theme - WebGPU TSL node materials (Phase 2 sky system)
 */

import * as THREE from 'three/webgpu';
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
    min,
    mix,
    modelWorldMatrix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

const hash2D = /* @__PURE__ */ Fn(([p]) => {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

const noise2D = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = hash2D(i);
    const b = hash2D(i.add(vec2(1.0, 0.0)));
    const c = hash2D(i.add(vec2(0.0, 1.0)));
    const d = hash2D(i.add(vec2(1.0, 1.0)));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

const fbm2D = /* @__PURE__ */ Fn(([p]) => {
    const v = float(0.0).toVar();
    const amp = float(0.5).toVar();
    const pos = vec2(p).toVar();
    // Octave 1
    v.addAssign(noise2D(pos).mul(amp));
    pos.mulAssign(2.01); amp.mulAssign(0.5);
    // Octave 2
    v.addAssign(noise2D(pos).mul(amp));
    pos.mulAssign(2.01); amp.mulAssign(0.5);
    // Octave 3
    v.addAssign(noise2D(pos).mul(amp));
    pos.mulAssign(2.01); amp.mulAssign(0.5);
    // Octave 4
    v.addAssign(noise2D(pos).mul(amp));
    return v;
});

export function createSkyNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uTopColor = uniform(params.topColor ?? new THREE.Color(0x8B2010));
    const uUpperColor = uniform(params.upperColor ?? new THREE.Color(0xB7381F));
    const uMidColor = uniform(params.midColor ?? new THREE.Color(0xDD5522));
    const uLowerColor = uniform(params.lowerColor ?? new THREE.Color(0xF57834));
    const uHorizonColor = uniform(params.horizonColor ?? new THREE.Color(0xFFAA44));
    const uSunColor = uniform(params.sunColor ?? new THREE.Color(0xFFF1C8));
    const uHaloColor = uniform(params.haloColor ?? new THREE.Color(0xFFB46A));
    const uHorizonHaloColor = uniform(params.horizonHaloColor ?? new THREE.Color(0xFFD08A));
    const uSunDirection = uniform(
        (params.sunDirection ?? new THREE.Vector3(0.0, 0.2, -1.0)).clone().normalize(),
    );
    const uSunDiscRadius = uniform(params.sunDiscRadius ?? 0.0125);
    const uSunHaloRadius = uniform(params.sunHaloRadius ?? 0.2);
    const uSunDiscIntensity = uniform(params.sunDiscIntensity ?? 0.26);
    const uSunHaloIntensity = uniform(params.sunHaloIntensity ?? 0.28);
    const uHorizonHaloIntensity = uniform(params.horizonHaloIntensity ?? 0.2);
    const uHorizonHaloFalloff = uniform(params.horizonHaloFalloff ?? 2.35);
    const uWispScale = uniform(params.wispScale ?? 3.8);
    const uWispIntensity = uniform(params.wispIntensity ?? 0.08);

    const dir = normalize(positionWorld.sub(cameraPosition));
    const elevationT = clamp(dir.y.mul(0.5).add(0.5), 0.0, 1.0);

    let sky = mix(uHorizonColor, uLowerColor, smoothstep(float(0.0), float(0.22), elevationT));
    sky = mix(sky, uMidColor, smoothstep(float(0.16), float(0.48), elevationT));
    sky = mix(sky, uUpperColor, smoothstep(float(0.44), float(0.75), elevationT));
    sky = mix(sky, uTopColor, smoothstep(float(0.72), float(1.0), elevationT));

    const sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
    const sunDisk = float(1.0).sub(smoothstep(float(0.0), uSunDiscRadius, float(1.0).sub(sunDot)));
    const sunHalo = float(1.0).sub(smoothstep(float(0.0), uSunHaloRadius, float(1.0).sub(sunDot)));

    const horizonBand = float(1.0).sub(clamp(abs(dir.y), 0.0, 1.0));
    const horizonHalo = pow(horizonBand, uHorizonHaloFalloff);

    const wispUv = vec2(dir.x, dir.z).mul(uWispScale);
    const wispNoiseA = noise2D(wispUv.add(vec2(uTime.mul(0.02), uTime.mul(-0.008))));
    const wispNoiseB = noise2D(
        wispUv.mul(1.85)
            .add(vec2(6.7, 3.1))
            .add(vec2(uTime.mul(-0.015), uTime.mul(0.006))),
    );
    const wispNoise = mix(wispNoiseA, wispNoiseB, 0.35);
    const wispMask = smoothstep(float(0.18), float(0.58), elevationT)
        .mul(float(1.0).sub(smoothstep(float(0.7), float(0.95), elevationT)));
    const wisp = smoothstep(float(0.46), float(0.76), wispNoise).mul(wispMask).mul(uWispIntensity);

    let color = sky;
    color = color.add(uSunColor.mul(sunDisk).mul(uSunDiscIntensity));
    color = color.add(uHaloColor.mul(pow(sunHalo, 2.0)).mul(uSunHaloIntensity));
    color = color.add(uHorizonHaloColor.mul(horizonHalo).mul(uHorizonHaloIntensity));
    color = color.add(mix(uLowerColor, uUpperColor, 0.5).mul(wisp));

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.colorNode = color;
    material.emissiveNode = color.mul(0.14);

    return {
        material,
        uniforms: {
            uTime,
            uTopColor,
            uUpperColor,
            uMidColor,
            uLowerColor,
            uHorizonColor,
            uSunColor,
            uHaloColor,
            uHorizonHaloColor,
            uSunDirection,
            uSunDiscRadius,
            uSunHaloRadius,
            uSunDiscIntensity,
            uSunHaloIntensity,
            uHorizonHaloIntensity,
            uHorizonHaloFalloff,
            uWispScale,
            uWispIntensity,
        },
    };
}

export function createSunNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uIntensity = uniform(params.intensity ?? 1.25);
    const uCoreColor = uniform(params.coreColor ?? new THREE.Color(0xFFFEE7));
    const uCoronaColor = uniform(params.coronaColor ?? new THREE.Color(0xFFCC5A));
    const uEdgeColor = uniform(params.edgeColor ?? new THREE.Color(0xFF8C2E));
    const uHaloColor = uniform(params.haloColor ?? new THREE.Color(0xFF7A34));
    const uHaloIntensity = uniform(params.haloIntensity ?? 0.9);
    const uEmissiveStrength = uniform(params.emissiveStrength ?? 1.0);

    const centeredUv = uv().sub(0.5);
    const dist = length(centeredUv);
    const noiseUv = centeredUv.mul(8.5).add(0.5);

    const turbA = noise2D(noiseUv.add(vec2(uTime.mul(0.06), uTime.mul(-0.04))));
    const turbB = noise2D(
        noiseUv.mul(2.2)
            .add(vec2(9.0, 3.8))
            .add(vec2(uTime.mul(-0.03), uTime.mul(0.025))),
    );
    const turbulence = mix(turbA, turbB, 0.4).mul(0.12).sub(0.06);

    const core = float(1.0).sub(smoothstep(float(0.0), float(0.18).add(turbulence.mul(0.35)), dist));
    const corona = float(1.0).sub(smoothstep(float(0.08), float(0.42).add(turbulence.mul(0.65)), dist));
    const halo = float(1.0).sub(smoothstep(float(0.22), float(0.72).add(turbulence.mul(0.45)), dist));

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(
        float(1.0).sub(clamp(dot(normalize(normalWorld), viewDir), 0.0, 1.0)),
        1.5,
    );

    const blend = clamp(pow(dist.mul(1.8), 1.2).add(fresnel.mul(0.25)), 0.0, 1.0);
    const sunSurface = mix(uCoreColor, uCoronaColor, blend);

    let color = sunSurface.mul(core.mul(1.85).add(corona.mul(0.95)));
    color = color.add(uHaloColor.mul(halo).mul(float(0.45).add(fresnel.mul(0.65))).mul(uHaloIntensity));

    const edgeRing = smoothstep(float(0.22), float(0.52), dist)
        .mul(float(1.0).sub(smoothstep(float(0.52), float(0.82), dist)));
    color = color.add(uEdgeColor.mul(edgeRing).mul(0.55));

    const pulse = sin(uTime.mul(0.8)).mul(0.05).add(1.0);
    color = color.mul(pulse).mul(uIntensity);

    const alphaBase = smoothstep(float(0.86), float(0.1), dist);
    const alpha = clamp(max(alphaBase, halo.mul(0.28).mul(uHaloIntensity)), 0.0, 1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha).mul(uEmissiveStrength);

    return {
        material,
        uniforms: {
            uTime,
            uIntensity,
            uCoreColor,
            uCoronaColor,
            uEdgeColor,
            uHaloColor,
            uHaloIntensity,
            uEmissiveStrength,
        },
    };
}

export function createGodRayNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uOpacity = uniform(params.opacity ?? 0.22);
    const uRayColor = uniform(params.rayColor ?? new THREE.Color(0xFFCC66));
    const uSunScreenPos = uniform(params.sunScreenPos ?? new THREE.Vector2(0.5, 0.5));
    const uEmissiveStrength = uniform(params.emissiveStrength ?? 1.35);

    const uvNode = uv();
    const sunUv = vec2(
        clamp(uSunScreenPos.x, 0.04, 0.96),
        clamp(uSunScreenPos.y, 0.04, 0.96),
    );
    const toSun = sunUv.sub(uvNode);
    const distToSun = length(toSun);

    const xAxis = uvNode.x.sub(sunUv.x);
    const depthFromSun = clamp(sunUv.y.sub(uvNode.y).mul(2.3), 0.0, 1.0);
    const swayA = sin(uvNode.y.mul(18.0).add(uTime.mul(0.12))).mul(0.028);
    const swayB = sin(uvNode.y.mul(27.0).sub(uTime.mul(0.09))).mul(0.019);

    const beamCore = float(1.0).sub(smoothstep(float(0.0), float(0.055), abs(xAxis.add(swayA))));
    const beamWide = float(1.0).sub(smoothstep(float(0.02), float(0.14), abs(xAxis.add(swayB))));
    const taper = mix(float(1.25), float(0.45), depthFromSun);
    const shafts = beamCore.mul(0.65).add(beamWide.mul(0.35)).mul(taper);

    const lengthFade = float(1.0).sub(smoothstep(float(0.0), float(0.85), distToSun));
    const sunGlow = pow(float(1.0).sub(smoothstep(float(0.0), float(0.33), distToSun)), 2.4).mul(0.22);

    const dustA = noise2D(uvNode.mul(18.0).add(vec2(uTime.mul(0.015), uTime.mul(-0.02))));
    const dustB = noise2D(
        uvNode.mul(41.0)
            .add(vec2(8.4, 3.1))
            .add(vec2(uTime.mul(-0.01), uTime.mul(0.013))),
    );
    const dust = mix(dustA, dustB, 0.4).mul(0.22).add(0.78);

    const flicker = clamp(
        sin(uTime.mul(0.21).add(uvNode.x.mul(9.0)))
            .mul(0.1)
            .add(sin(uTime.mul(0.37).add(uvNode.y.mul(13.0))).mul(0.08))
            .add(0.82),
        0.55,
        1.15,
    );

    const totalLight = shafts
        .mul(depthFromSun)
        .mul(lengthFade)
        .mul(dust)
        .mul(flicker)
        .add(sunGlow);
    const alpha = clamp(totalLight.mul(uOpacity), 0.0, 0.95);

    const hotColor = vec3(1.0, 0.95, 0.85);
    const color = mix(uRayColor, hotColor, sunGlow.add(alpha.mul(0.35)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.DoubleSide;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha).mul(uEmissiveStrength);

    return {
        material,
        uniforms: {
            uTime,
            uOpacity,
            uRayColor,
            uSunScreenPos,
            uEmissiveStrength,
        },
    };
}

export function createCloudNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uCloudColor = uniform(params.cloudColor ?? new THREE.Color(0xFFC89E));
    const uHighlightColor = uniform(params.highlightColor ?? new THREE.Color(0xFFE2C4));
    const uFogColor = uniform(params.fogColor ?? new THREE.Color(0xFFB274));
    const uOpacity = uniform(params.opacity ?? 0.15);
    const uNoiseScale = uniform(params.noiseScale ?? 1.2);
    const uSoftness = uniform(params.softness ?? 0.35);
    const uCoverage = uniform(params.coverage ?? 0.5);
    const uDrift = uniform(params.drift ?? new THREE.Vector2(0.0018, 0.0003));
    const uSeed = uniform(params.seed ?? 2.0);
    const uFogStart = uniform(params.fogStart ?? 100);
    const uFogEnd = uniform(params.fogEnd ?? 420);

    const uvNode = uv();
    const driftUv = uvNode.add(uDrift.mul(uTime));

    const edgeX = smoothstep(float(0.0), float(0.12), uvNode.x)
        .mul(smoothstep(float(1.0), float(0.88), uvNode.x));
    const edgeY = smoothstep(float(0.0), float(0.2), uvNode.y)
        .mul(smoothstep(float(1.0), float(0.8), uvNode.y));
    const edgeFade = edgeX.mul(edgeY);

    const noiseUv = vec2(
        driftUv.x.sub(0.5).mul(2.0),
        driftUv.y.sub(0.5).mul(1.5),
    );
    const baseNoise = noise2D(
        noiseUv.mul(uNoiseScale)
            .add(vec2(uSeed, uSeed.mul(0.37)))
            .add(vec2(uTime.mul(0.02), uTime.mul(-0.012))),
    );
    const detailNoise = noise2D(
        noiseUv.mul(uNoiseScale.mul(1.85))
            .add(vec2(6.7, 3.1))
            .add(vec2(uTime.mul(-0.013), uTime.mul(0.009))),
    );
    const combined = mix(baseNoise, detailNoise, 0.35);

    const softness = float(0.08).add(uSoftness.mul(0.3));
    const coverage = smoothstep(uCoverage.sub(softness), uCoverage.add(softness), combined);

    const dist = length(positionWorld.sub(cameraPosition));
    const fogFactor = smoothstep(uFogStart, uFogEnd, dist);

    let color = mix(uCloudColor, uHighlightColor, combined.mul(0.25));
    color = color.mul(0.95).add(color.mul(combined.mul(0.08)));
    color = mix(color, uFogColor, fogFactor);

    const alpha = coverage.mul(edgeFade).mul(uOpacity).mul(float(1.0).sub(fogFactor.mul(0.65)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;
    material.alphaTest = 0.02;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.05));

    return {
        material,
        uniforms: {
            uTime,
            uCloudColor,
            uHighlightColor,
            uFogColor,
            uOpacity,
            uNoiseScale,
            uSoftness,
            uCoverage,
            uDrift,
            uSeed,
            uFogStart,
            uFogEnd,
        },
    };
}

export function createHazeNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uHazeColor = uniform(params.hazeColor ?? new THREE.Color(0xFFC08E));
    const uDensity = uniform(params.density ?? 0.3);
    const uLayerDepth = uniform(params.layerDepth ?? 0);
    const uDrift = uniform(params.drift ?? new THREE.Vector2(0.02, 0.0));

    const uvNode = uv();
    const flowUv = uvNode.add(uDrift.mul(uTime.mul(0.03)));

    const noise1 = noise2D(
        vec2(flowUv.x.mul(2.0), flowUv.y.mul(1.45)).add(vec2(uTime.mul(0.02), 0.0)),
    );
    const noise2 = noise2D(
        vec2(flowUv.x.mul(4.0).sub(uTime.mul(0.03)), flowUv.y.mul(2.7))
            .add(vec2(2.3, 5.1)),
    );
    const haze = noise1.mul(0.7).add(noise2.mul(0.3));

    const verticalFade = float(1.0).sub(smoothstep(float(0.0), float(0.7), uvNode.y));
    const horizontalVar = sin(uvNode.x.mul(3.14159)).mul(0.15).add(0.85);
    const layerT = clamp(uLayerDepth, 0.0, 1.0);
    const layerSoftness = mix(float(1.05), float(0.7), layerT);

    const alpha = haze
        .mul(verticalFade)
        .mul(horizontalVar)
        .mul(uDensity)
        .mul(layerSoftness)
        .mul(0.58);

    const warmBoost = uHazeColor.mul(vec3(1.06, 0.98, 0.9));
    let color = mix(uHazeColor, warmBoost, verticalFade.mul(0.35));
    color = mix(color, uHazeColor.mul(0.92), layerT.mul(0.25));

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.04));

    return {
        material,
        uniforms: {
            uTime,
            uHazeColor,
            uDensity,
            uLayerDepth,
            uDrift,
        },
    };
}

export function createMistNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uDensity = uniform(params.density ?? 0.3);
    const uMistColor = uniform(params.mistColor ?? new THREE.Color(0xffaa55));
    const uIntensity = uniform(params.intensity ?? 0.6);

    const uvNode = uv();
    const mistA = noise2D(
        uvNode.mul(2.0)
            .add(vec2(uTime.mul(0.02), uTime.mul(-0.015))),
    );
    const mistB = noise2D(
        uvNode.mul(0.8)
            .add(vec2(30.0, 17.0))
            .add(vec2(uTime.mul(0.01), uTime.mul(0.008))),
    );

    let density = mix(mistA, mistB, 0.5).mul(uDensity);
    density = smoothstep(float(0.2), float(0.7), density);

    const edgeFade = smoothstep(float(0.0), float(0.3), uvNode.y)
        .mul(smoothstep(float(1.0), float(0.7), uvNode.y));
    const alpha = density.mul(edgeFade).mul(uIntensity).mul(0.5);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;
    material.colorNode = uMistColor;
    material.opacityNode = alpha;
    material.emissiveNode = uMistColor.mul(alpha.mul(0.04));

    return {
        material,
        uniforms: {
            uTime,
            uDensity,
            uMistColor,
            uIntensity,
        },
    };
}

export function createShoreFoamNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uFoamColor = uniform(params.foamColor ?? new THREE.Color(0.95, 0.75, 0.45));
    const uOpacity = uniform(params.opacity ?? 0.4);

    const uvNode = uv();
    const shorelineFade = float(1.0).sub(smoothstep(float(0.0), float(0.8), uvNode.y));
    const shimmer = sin(uTime.mul(1.0).add(uvNode.x.mul(10.0))).mul(0.1).add(0.9);
    const alpha = shorelineFade.mul(shimmer).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.colorNode = uFoamColor;
    material.opacityNode = alpha;
    material.emissiveNode = uFoamColor.mul(alpha.mul(0.08));

    return {
        material,
        uniforms: {
            uTime,
            uFoamColor,
            uOpacity,
        },
    };
}

export function createInstancedFoliageNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uGlowIntensity = uniform(params.glowIntensity ?? 0);
    const uWindStrength = uniform(params.windStrength ?? 0.24);
    const uSunDirection = uniform(
        (params.sunDirection ?? new THREE.Vector3(0.0, 0.4, -1.0)).clone().normalize(),
    );
    const uRimColor = uniform(params.rimColor ?? new THREE.Color(0xff995f));
    const uGlowColor = uniform(params.glowColor ?? new THREE.Color(0xffb067));
    const uRimStrength = uniform(params.rimStrength ?? 0.2);
    const uAlphaNearCutoff = uniform(params.alphaNearCutoff ?? 0.5);
    const uAlphaFarCutoff = uniform(params.alphaFarCutoff ?? 0.2);

    const aInstanceColor = attribute('aInstanceColor');
    const aInstanceSway = attribute('aInstanceSway');
    const aInstancePhase = attribute('aInstancePhase');
    const aInstanceWindOffset = attribute('aInstanceWindOffset');

    const normalizedHeight = clamp(positionLocal.y.div(20.0), 0.0, 1.0);
    const windPhase = aInstanceWindOffset.add(aInstancePhase).add(uTime.mul(0.8));
    const windOffsetX = sin(windPhase)
        .mul(aInstanceSway)
        .mul(uWindStrength)
        .mul(normalizedHeight);
    const windOffsetZ = cos(windPhase.mul(0.6).add(1.5))
        .mul(aInstanceSway)
        .mul(uWindStrength)
        .mul(0.6)
        .mul(normalizedHeight);

    const displacedPosition = vec3(
        positionLocal.x.add(windOffsetX),
        positionLocal.y,
        positionLocal.z.add(windOffsetZ),
    );

    const baseColor = aInstanceColor;
    let foliageColor = mix(baseColor, baseColor.mul(1.18), normalizedHeight.mul(0.15));

    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const rimFactor = pow(
        float(1.0).sub(abs(dot(normalize(normalWorld), viewDirection))),
        2.0,
    );
    const sunFacing = clamp(
        dot(normalize(normalWorld), normalize(uSunDirection)).mul(0.5).add(0.5),
        0.0,
        1.0,
    );
    const rim = rimFactor
        .mul(normalizedHeight)
        .mul(sunFacing.mul(0.35).add(0.65))
        .mul(uRimStrength);
    const rimColor = uRimColor.mul(rim);
    foliageColor = foliageColor.add(rimColor);

    const glowPulse = sin(uTime.mul(2.0).add(aInstancePhase.mul(2.3))).mul(0.5).add(0.5);
    const glowColor = uGlowColor
        .mul(uGlowIntensity)
        .mul(glowPulse.mul(0.45).add(0.55))
        .mul(normalizedHeight)
        .mul(0.28);
    foliageColor = foliageColor.add(glowColor);

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.alphaTest = 0.0;
    material.depthWrite = true;
    material.positionNode = displacedPosition;
    material.colorNode = foliageColor;
    material.emissiveNode = glowColor.mul(0.45).add(rimColor.mul(0.04));

    return {
        material,
        uniforms: {
            uTime,
            uGlowIntensity,
            uWindStrength,
            uSunDirection,
            uRimColor,
            uGlowColor,
            uRimStrength,
            uAlphaNearCutoff,
            uAlphaFarCutoff,
        },
    };
}

export function createInstancedTrunkNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uGlowIntensity = uniform(params.glowIntensity ?? 0);
    const uWindStrength = uniform(params.windStrength ?? 0.16);
    const uGlowColor = uniform(params.glowColor ?? new THREE.Color(0xff8f5a));

    const aInstanceColor = attribute('aInstanceColor');
    const aInstanceSway = attribute('aInstanceSway');
    const aInstancePhase = attribute('aInstancePhase');
    const aInstanceWindOffset = attribute('aInstanceWindOffset');

    const normalizedHeight = clamp(positionLocal.y.div(3.0), 0.0, 1.0);
    const windPhase = aInstanceWindOffset.add(aInstancePhase.mul(0.85)).add(uTime.mul(0.7));
    const windOffsetX = sin(windPhase)
        .mul(aInstanceSway)
        .mul(uWindStrength)
        .mul(normalizedHeight);
    const windOffsetZ = cos(windPhase.mul(0.7).add(1.3))
        .mul(aInstanceSway)
        .mul(uWindStrength)
        .mul(0.45)
        .mul(normalizedHeight);

    const displacedPosition = vec3(
        positionLocal.x.add(windOffsetX),
        positionLocal.y,
        positionLocal.z.add(windOffsetZ),
    );

    const uvNode = uv();
    let trunkColor = mix(aInstanceColor.mul(0.82), aInstanceColor, smoothstep(0.0, 1.0, normalizedHeight));

    const runeBand = smoothstep(float(0.25), float(0.55), uvNode.y)
        .mul(float(1.0).sub(smoothstep(float(0.62), float(0.88), uvNode.y)));
    const runeStripes = sin(uvNode.x.mul(14.0).add(uTime.mul(2.0)).add(aInstancePhase.mul(3.5)))
        .mul(0.5)
        .add(0.5);
    const runePulse = sin(uTime.mul(1.8).add(aInstancePhase.mul(4.1))).mul(0.5).add(0.5);
    const runeGlow = runeBand
        .mul(runeStripes)
        .mul(runePulse.mul(0.4).add(0.6))
        .mul(uGlowIntensity)
        .mul(0.4);

    trunkColor = trunkColor.add(uGlowColor.mul(runeGlow));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displacedPosition;
    material.colorNode = trunkColor;
    material.emissiveNode = uGlowColor.mul(runeGlow.mul(0.75));

    return {
        material,
        uniforms: {
            uTime,
            uGlowIntensity,
            uWindStrength,
            uGlowColor,
        },
    };
}

export function createGrassNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uWindStrength = uniform(params.windStrength ?? 0.18);
    const uSpiritGlow = uniform(params.spiritGlow ?? 0.0);
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0x4a3015));
    const uTipColor = uniform(params.tipColor ?? new THREE.Color(0xddaa44));
    const uFogColor = uniform(params.fogColor ?? new THREE.Color(0xaa7744));
    const uGlowColor = uniform(params.glowColor ?? new THREE.Color(0xffb067));
    const uAlphaCutoff = uniform(params.alphaCutoff ?? 0.5);

    const aWindOffset = attribute('aWindOffset');
    const uvNode = uv();
    const heightFactor = uvNode.y.mul(uvNode.y);

    const windPhase = aWindOffset.add(uTime.mul(1.5));
    const windX = sin(windPhase).mul(uWindStrength).mul(heightFactor);
    const windZ = sin(windPhase.mul(0.6).add(1.5)).mul(uWindStrength).mul(0.6).mul(heightFactor);
    const displacedPosition = vec3(
        positionLocal.x.add(windX),
        positionLocal.y,
        positionLocal.z.add(windZ),
    );

    const grassTex = params.grassTexture ? texture(params.grassTexture) : null;
    const texSample = grassTex ? grassTex.sample(uvNode) : vec4(1.0, 1.0, 1.0, 1.0);

    const gradient = smoothstep(float(0.0), float(0.7), uvNode.y);
    let grassColor = mix(uBaseColor, uTipColor, gradient);
    grassColor = grassColor.mul(texSample.rgb).mul(1.3);

    const sunsetTint = vec3(1.0, 0.85, 0.6);
    grassColor = mix(grassColor, grassColor.mul(sunsetTint), gradient.mul(0.4));

    const glowPattern = sin(aWindOffset.mul(0.7).add(uTime.mul(0.3))).mul(0.5).add(0.5);
    const spiritGlow = glowPattern.mul(heightFactor).mul(uSpiritGlow);
    grassColor = grassColor.add(uGlowColor.mul(spiritGlow).mul(0.4));

    const fogDepth = length(positionWorld.sub(cameraPosition));
    const fogFactor = smoothstep(float(15.0), float(60.0), fogDepth);
    grassColor = mix(grassColor, uFogColor, fogFactor);

    const alphaShape = smoothstep(
        uAlphaCutoff.sub(0.12),
        uAlphaCutoff.add(0.12),
        texSample.a,
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.alphaTest = 0.5;
    material.depthWrite = false;
    material.positionNode = displacedPosition;
    material.colorNode = grassColor;
    material.opacityNode = alphaShape;
    material.emissiveNode = uGlowColor.mul(spiritGlow.mul(0.1));

    return {
        material,
        uniforms: {
            uTime,
            uWindStrength,
            uSpiritGlow,
            uBaseColor,
            uTipColor,
            uFogColor,
            uGlowColor,
            uAlphaCutoff,
        },
    };
}

export function createSilhouetteGrassNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uWindStrength = uniform(params.windStrength ?? 0.15);
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0x150505));
    const uTipColor = uniform(params.tipColor ?? new THREE.Color(0x2a1005));
    const uAlphaCutoff = uniform(params.alphaCutoff ?? 0.6);

    const aWindOffset = attribute('aWindOffset');
    const uvNode = uv();
    const heightFactor = uvNode.y.mul(uvNode.y);

    const windPhase = aWindOffset.add(uTime.mul(1.0));
    const windX = sin(windPhase).mul(uWindStrength).mul(heightFactor);
    const displacedPosition = vec3(
        positionLocal.x.add(windX),
        positionLocal.y,
        positionLocal.z,
    );

    const grassTex = params.grassTexture ? texture(params.grassTexture) : null;
    const texSample = grassTex ? grassTex.sample(uvNode) : vec4(1.0, 1.0, 1.0, 1.0);

    const color = mix(uBaseColor, uTipColor, uvNode.y);
    const alphaShape = smoothstep(
        uAlphaCutoff.sub(0.08),
        uAlphaCutoff.add(0.08),
        texSample.a,
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.alphaTest = 0.6;
    material.depthWrite = false;
    material.positionNode = displacedPosition;
    material.colorNode = color;
    material.opacityNode = alphaShape;

    return {
        material,
        uniforms: {
            uTime,
            uWindStrength,
            uBaseColor,
            uTipColor,
            uAlphaCutoff,
        },
    };
}

export function createShoreReedNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uWindStrength = uniform(params.windStrength ?? 0.2);
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0x7a5a30));
    const uTipColor = uniform(params.tipColor ?? new THREE.Color(0x9a7840));
    const uHeightScale = uniform(params.heightScale ?? 7.0);

    const anchor = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const heightFactor = clamp(positionLocal.y.div(uHeightScale), 0.0, 1.0);
    const windPhase = anchor.x.mul(0.24)
        .add(anchor.z.mul(0.18))
        .add(positionLocal.y.mul(0.12))
        .add(uTime.mul(1.1));
    const windX = sin(windPhase).mul(uWindStrength).mul(heightFactor);
    const windZ = cos(windPhase.mul(0.73).add(1.9)).mul(uWindStrength).mul(0.65).mul(heightFactor);
    const displacedPosition = vec3(
        positionLocal.x.add(windX),
        positionLocal.y,
        positionLocal.z.add(windZ),
    );

    let color = mix(uBaseColor, uTipColor, smoothstep(float(0.0), float(0.85), heightFactor));
    color = color.mul(float(0.92).add(heightFactor.mul(0.16)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.positionNode = displacedPosition;
    material.colorNode = color;

    return {
        material,
        uniforms: {
            uTime,
            uWindStrength,
            uBaseColor,
            uTipColor,
            uHeightScale,
        },
    };
}

export function createFramingTreeFoliageNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uWindStrength = uniform(params.windStrength ?? 0.12);
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0x180806));
    const uRimColor = uniform(params.rimColor ?? new THREE.Color(0xff9c60));
    const uSunDirection = uniform(
        (params.sunDirection ?? new THREE.Vector3(0.0, 0.4, -1.0)).clone().normalize(),
    );
    const uHeightScale = uniform(params.heightScale ?? 40.0);
    const uRimStrength = uniform(params.rimStrength ?? 0.18);

    const anchor = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const heightFactor = clamp(positionLocal.y.div(uHeightScale), 0.0, 1.0);
    const windPhase = anchor.x.mul(0.2)
        .add(anchor.z.mul(0.14))
        .add(positionLocal.y.mul(0.08))
        .add(uTime.mul(0.75));
    const windX = sin(windPhase).mul(uWindStrength).mul(heightFactor);
    const windZ = cos(windPhase.mul(0.6).add(1.4)).mul(uWindStrength).mul(0.55).mul(heightFactor);
    const displacedPosition = vec3(
        positionLocal.x.add(windX),
        positionLocal.y,
        positionLocal.z.add(windZ),
    );

    let color = mix(uBaseColor.mul(0.9), uBaseColor, smoothstep(float(0.0), float(1.0), heightFactor));

    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const rimFactor = pow(
        float(1.0).sub(abs(dot(normalize(normalWorld), viewDirection))),
        2.0,
    );
    const sunFacing = clamp(
        dot(normalize(normalWorld), normalize(uSunDirection)).mul(0.5).add(0.5),
        0.0,
        1.0,
    );
    const rim = rimFactor.mul(heightFactor).mul(sunFacing.mul(0.35).add(0.65)).mul(uRimStrength);
    color = color.add(uRimColor.mul(rim));

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.positionNode = displacedPosition;
    material.colorNode = color;
    material.emissiveNode = uRimColor.mul(rim.mul(0.12));

    return {
        material,
        uniforms: {
            uTime,
            uWindStrength,
            uBaseColor,
            uRimColor,
            uSunDirection,
            uHeightScale,
            uRimStrength,
        },
    };
}

export function createFramingTreeTrunkNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uWindStrength = uniform(params.windStrength ?? 0.08);
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0x0a0402));
    const uHeightScale = uniform(params.heightScale ?? 12.0);

    const anchor = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const heightFactor = clamp(positionLocal.y.div(uHeightScale), 0.0, 1.0);
    const windPhase = anchor.x.mul(0.18)
        .add(anchor.z.mul(0.13))
        .add(positionLocal.y.mul(0.07))
        .add(uTime.mul(0.7));
    const windX = sin(windPhase).mul(uWindStrength).mul(heightFactor);
    const windZ = cos(windPhase.mul(0.62).add(1.0)).mul(uWindStrength).mul(0.45).mul(heightFactor);
    const displacedPosition = vec3(
        positionLocal.x.add(windX),
        positionLocal.y,
        positionLocal.z.add(windZ),
    );

    const trunkColor = mix(uBaseColor.mul(0.82), uBaseColor, smoothstep(float(0.0), float(1.0), heightFactor));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displacedPosition;
    material.colorNode = trunkColor;

    return {
        material,
        uniforms: {
            uTime,
            uWindStrength,
            uBaseColor,
            uHeightScale,
        },
    };
}

const sampleMountainLayerHeight = /* @__PURE__ */ Fn(([uvCoord, layer, time]) => {
    const offset = layer.mul(87.654);
    let height = noise2D(vec2(uvCoord.x.mul(0.8).add(offset), float(0.0))).mul(0.35);
    height = height.add(noise2D(vec2(uvCoord.x.mul(1.8).add(offset), float(0.5))).mul(0.25));
    height = height.add(noise2D(vec2(uvCoord.x.mul(4.0).add(offset), float(1.0))).mul(0.15));
    height = height.add(noise2D(vec2(uvCoord.x.mul(8.0).add(offset), float(1.5))).mul(0.08));

    height = height.mul(0.5).add(0.5);
    height = height.mul(float(0.55).add(layer.mul(0.25)));

    const shimmer = sin(time.mul(0.4).add(uvCoord.x.mul(8.0)))
        .mul(0.008)
        .mul(float(1.0).sub(layer.mul(0.5)));
    return height.add(shimmer);
});

export function createMountainLayerNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uShadowColor = uniform(params.shadowColor ?? new THREE.Color(0x2C0C07));
    const uMidColor = uniform(params.midColor ?? new THREE.Color(0x722D1A));
    const uHighlightColor = uniform(params.highlightColor ?? new THREE.Color(0xD56B35));
    const uRimColor = uniform(params.rimColor ?? new THREE.Color(0xFF9C55));
    const uMistColor = uniform(params.mistColor ?? new THREE.Color(0xF68A54));
    const uFogColor = uniform(params.fogColor ?? new THREE.Color(0xFF9944));
    const uLightDirection = uniform(
        (params.lightDirection ?? new THREE.Vector3(0.15, 0.35, -1.0)).clone().normalize(),
    );
    const uFogAmount = uniform(params.fogAmount ?? 0.5);
    const uLayer = uniform(params.layer ?? 0.5);
    const uMistStrength = uniform(params.mistStrength ?? 0.55);

    const uvNode = uv();
    const mountainHeight = sampleMountainLayerHeight(uvNode, uLayer, uTime);
    const insideMask = smoothstep(float(-0.003), float(0.003), mountainHeight.sub(uvNode.y));

    const depthFromPeak = clamp(
        mountainHeight.sub(uvNode.y).div(max(mountainHeight, float(0.0001))),
        0.0,
        1.0,
    );
    const peakFactor = float(1.0).sub(depthFromPeak);

    const eps = float(0.002);
    const slopeScale = float(45.0);
    const heightX = sampleMountainLayerHeight(vec2(uvNode.x.add(eps), uvNode.y), uLayer, uTime);
    const heightY = sampleMountainLayerHeight(vec2(uvNode.x, uvNode.y.add(eps)), uLayer, uTime);
    const normalApprox = normalize(vec3(
        mountainHeight.sub(heightX).mul(slopeScale),
        1.0,
        mountainHeight.sub(heightY).mul(slopeScale),
    ));

    const lightDir = normalize(uLightDirection);
    const diffuse = clamp(dot(normalApprox, lightDir), 0.0, 1.0);
    const viewDir = vec3(0.0, 0.0, 1.0);
    const rim = pow(float(1.0).sub(clamp(dot(normalApprox, viewDir), 0.0, 1.0)), 1.8)
        .mul(smoothstep(float(0.25), float(0.95), peakFactor));

    const shadedMix = mix(float(0.35), float(0.9), peakFactor);
    let color = mix(uShadowColor, uMidColor, shadedMix);
    color = mix(color, uHighlightColor, diffuse.mul(float(0.4).add(peakFactor.mul(0.5))));

    const creviceShadow = smoothstep(float(0.0), float(0.7), depthFromPeak)
        .mul(float(1.0).sub(diffuse))
        .mul(0.35);
    color = mix(color, uShadowColor, creviceShadow);

    const detail = noise2D(vec2(
        uvNode.x.mul(8.0).add(uLayer.mul(4.0)),
        uvNode.y.mul(10.0).add(uTime.mul(0.05)),
    ));
    color = color.add(
        vec3(1.0, 1.0, 1.0).mul(
            detail.mul(0.04).sub(0.02).mul(float(0.6).add(peakFactor.mul(0.4))),
        ),
    );

    const baseMist = smoothstep(float(0.2), float(1.0), depthFromPeak);
    color = mix(color, uMistColor, baseMist.mul(uMistStrength));
    color = mix(color, uRimColor, rim.mul(0.6));

    const fogMix = clamp(uFogAmount.mul(float(0.6).add(depthFromPeak.mul(0.4))), 0.0, 1.0);
    const foggedColor = mix(color, uFogColor, fogMix);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.alphaTest = 0.3;
    material.colorNode = foggedColor;
    material.opacityNode = insideMask;
    material.emissiveNode = uRimColor.mul(rim.mul(0.12).mul(insideMask));

    return {
        material,
        uniforms: {
            uTime,
            uShadowColor,
            uMidColor,
            uHighlightColor,
            uRimColor,
            uMistColor,
            uFogColor,
            uLightDirection,
            uFogAmount,
            uLayer,
            uMistStrength,
        },
    };
}

export function createMountainPeakNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uShadowColor = uniform(params.shadowColor ?? new THREE.Color(0x2A1518));
    const uMidColor = uniform(params.midColor ?? new THREE.Color(0x6B3525));
    const uHighlightColor = uniform(params.highlightColor ?? new THREE.Color(0xCC6633));
    const uRimColor = uniform(params.rimColor ?? new THREE.Color(0xFF8844));
    const uFogColor = uniform(params.fogColor ?? new THREE.Color(0xDD7744));
    const uSunDirection = uniform(
        (params.sunDirection ?? new THREE.Vector3(0.0, 0.3, -1.0)).clone().normalize(),
    );

    const height = clamp(attribute('aHeight'), 0.0, 1.0);
    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const worldNormal = normalize(normalWorld);
    const sunDirection = normalize(uSunDirection);

    const facingCamera = clamp(dot(worldNormal, viewDirection), 0.0, 1.0);
    const facingSun = clamp(dot(worldNormal, sunDirection.mul(-1.0)), 0.0, 1.0);
    const facingUp = clamp(worldNormal.y, 0.0, 1.0);

    let mountainColor = uShadowColor;
    const midBlend = clamp(height.mul(0.6).add(facingUp.mul(0.3)), 0.0, 1.0);
    mountainColor = mix(mountainColor, uMidColor, midBlend);

    const highlightBlend = clamp(
        facingSun.mul(0.5).add(facingUp.mul(height).mul(0.4)).mul(0.6),
        0.0,
        1.0,
    );
    mountainColor = mix(mountainColor, uHighlightColor, highlightBlend);

    const rim = pow(float(1.0).sub(facingCamera), 2.0);
    const rimStrength = rim.mul(float(0.5).add(facingUp.mul(0.3)).add(facingSun.mul(0.4)));
    mountainColor = mix(
        mountainColor,
        uRimColor,
        clamp(rimStrength.mul(0.5).mul(height), 0.0, 1.0),
    );

    const distanceToCamera = length(positionWorld.sub(cameraPosition));
    const fogFactor = smoothstep(float(100.0), float(280.0), distanceToCamera);
    mountainColor = mix(mountainColor, uFogColor, fogFactor.mul(0.5));

    const baseMist = smoothstep(float(0.25), float(0.0), height);
    mountainColor = mix(mountainColor, uFogColor.mul(0.7), baseMist.mul(0.6));

    const peakGlow = smoothstep(float(0.7), float(1.0), height);
    mountainColor = mix(mountainColor, uRimColor.mul(0.9), peakGlow.mul(0.25));

    const detailNoise = noise2D(vec2(
        positionWorld.x.mul(0.015).add(uTime.mul(0.03)),
        positionWorld.z.mul(0.015).sub(uTime.mul(0.02)),
    ));
    mountainColor = mountainColor.add(
        vec3(1.0, 1.0, 1.0).mul(
            detailNoise.mul(0.035).sub(0.0175).mul(float(0.4).add(height.mul(0.6))),
        ),
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.colorNode = mountainColor;
    material.emissiveNode = uRimColor.mul(rimStrength.mul(0.1).mul(height));

    return {
        material,
        uniforms: {
            uTime,
            uShadowColor,
            uMidColor,
            uHighlightColor,
            uRimColor,
            uFogColor,
            uSunDirection,
        },
    };
}

export function createGroundNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uGroundColor = uniform(params.groundColor ?? new THREE.Color(0x24120A));
    const uMossColor = uniform(params.mossColor ?? new THREE.Color(0x8B5A2B));
    const uDirtColor = uniform(params.dirtColor ?? new THREE.Color(0x150805));
    const uGlowIntensity = uniform(params.glowIntensity ?? 0.0);
    const uFogColor = uniform(params.fogColor ?? new THREE.Color(0x3A2510));

    const uvNode = uv();
    const patternUv = uvNode.mul(8.0);
    const warp = noise2D(patternUv.mul(0.5).add(vec2(uTime.mul(0.015), uTime.mul(-0.01)))).sub(0.5);
    const warpedUv = patternUv.add(vec2(warp.mul(0.5), warp.mul(0.5)));
    const pattern = noise2D(warpedUv);

    const depth = length(positionWorld.sub(cameraPosition));
    const depthFactor = smoothstep(float(10.0), float(90.0), depth);

    const shadowMix = clamp(
        float(1.0).sub(depthFactor).mul(1.2).add(pattern.mul(0.2)),
        0.0,
        1.0,
    );
    let color = mix(uGroundColor, uDirtColor, smoothstep(float(0.2), float(0.9), shadowMix));

    const sunMix = clamp(depthFactor.mul(1.2).sub(pattern.mul(0.1)), 0.0, 1.0);
    color = mix(color, uMossColor, smoothstep(float(0.3), float(1.0), sunMix));

    const fogStrength = smoothstep(float(40.0), float(150.0), depth);
    color = mix(color, uFogColor, fogStrength.mul(0.8));

    const glowTint = vec3(1.0, 0.8, 0.4).mul(uGlowIntensity.mul(0.3));
    color = color.add(glowTint);

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.colorNode = color;
    material.emissiveNode = glowTint.mul(0.2);

    return {
        material,
        uniforms: {
            uTime,
            uGroundColor,
            uMossColor,
            uDirtColor,
            uGlowIntensity,
            uFogColor,
        },
    };
}

export function createFireflyNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uBoost = uniform(params.boost ?? 0.0);
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0xFFAA44));
    const uTipColor = uniform(params.tipColor ?? new THREE.Color(0xFFE7A0));

    const anchor = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const phase = anchor.x.mul(0.12).add(anchor.z.mul(0.09));
    const driftX = sin(uTime.mul(0.45).add(phase)).mul(0.9);
    const driftY = cos(uTime.mul(0.31).add(phase.mul(1.7))).mul(0.45);
    const driftZ = sin(uTime.mul(0.27).add(phase.mul(1.3))).mul(0.7);
    const displacedPosition = vec3(
        positionLocal.x.add(driftX),
        positionLocal.y.add(driftY),
        positionLocal.z.add(driftZ),
    );

    const uvNode = uv();
    const dist = length(uvNode.sub(0.5)).mul(2.0);
    const core = float(1.0).sub(smoothstep(float(0.0), float(0.28), dist));
    const glow = pow(float(1.0).sub(smoothstep(float(0.0), float(1.0), dist)), 1.5);

    const twinkle = pow(
        sin(uTime.mul(4.0).add(phase.mul(6.0))).mul(0.5).add(0.5),
        3.0,
    ).mul(0.55).add(0.45);
    const boostMul = float(1.0).add(uBoost.mul(1.25));
    const alpha = clamp(glow.mul(twinkle).mul(boostMul).mul(0.95), 0.0, 1.0);

    const colorMix = clamp(dist.mul(0.35).add(core.mul(0.25)), 0.0, 1.0);
    const color = mix(uBaseColor, uTipColor, colorMix);
    const emissive = color.mul(alpha).mul(float(0.35).add(uBoost.mul(0.75)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.positionNode = displacedPosition;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = emissive;

    return {
        material,
        uniforms: {
            uTime,
            uBoost,
            uBaseColor,
            uTipColor,
        },
    };
}

export function createDustMoteNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uOpacity = uniform(params.opacity ?? 0.65);
    const uSunDirection = uniform(
        (params.sunDirection ?? new THREE.Vector3(0.0, 0.3, -1.0)).clone().normalize(),
    );
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0xFFCA66));
    const uHighlightColor = uniform(params.highlightColor ?? new THREE.Color(0xFFE8B2));

    const anchor = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const phase = anchor.x.mul(0.09).add(anchor.z.mul(0.06));
    const float1 = sin(uTime.mul(0.3).add(phase)).mul(2.0);
    const float2 = cos(uTime.mul(0.2).add(phase.mul(1.7))).mul(1.5);
    const float3 = sin(uTime.mul(0.15).add(phase.mul(2.3))).mul(1.0);
    const displacedPosition = vec3(
        positionLocal.x.add(float2),
        positionLocal.y.add(float1),
        positionLocal.z.add(float3),
    );

    const uvNode = uv();
    const dist = length(uvNode.sub(0.5)).mul(2.0);
    const glow = pow(float(1.0).sub(smoothstep(float(0.0), float(1.0), dist)), 2.0);

    const toCamera = normalize(positionWorld.sub(cameraPosition));
    const sunCatch = clamp(dot(toCamera, normalize(uSunDirection)), 0.0, 1.0);
    const brightness = float(0.22).add(pow(sunCatch, 4.0).mul(0.45));
    const shimmer = sin(uTime.mul(3.0).add(phase.mul(8.0))).mul(0.15).add(0.85);

    const color = mix(uBaseColor, uHighlightColor, sunCatch.mul(0.6).add(0.2))
        .mul(brightness)
        .mul(shimmer);
    const alpha = clamp(glow.mul(uOpacity).mul(shimmer), 0.0, 1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.positionNode = displacedPosition;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.25));

    return {
        material,
        uniforms: {
            uTime,
            uOpacity,
            uSunDirection,
            uBaseColor,
            uHighlightColor,
        },
    };
}

export function createSpiritNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uOpacity = uniform(params.opacity ?? 0.4);
    const uSpiritColor = uniform(params.spiritColor ?? new THREE.Color(0xFFB46A));

    const anchor = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const phase = anchor.x.mul(0.04).add(anchor.z.mul(0.035));
    const verticalPulse = sin(uTime.mul(0.8).add(phase.mul(9.0))).mul(0.1);
    const displacedPosition = vec3(
        positionLocal.x,
        positionLocal.y.add(verticalPulse),
        positionLocal.z,
    );

    const uvNode = uv();
    const dist = length(uvNode.sub(0.5)).mul(2.0);
    const innerGlow = float(1.0).sub(smoothstep(float(0.0), float(0.3), dist));
    const outerGlow = float(1.0).sub(smoothstep(float(0.0), float(1.0), dist));
    const shimmer = sin(uTime.mul(3.0).add(anchor.x.mul(0.05))).mul(0.1).add(0.9);

    const color = mix(uSpiritColor, vec3(1.0, 1.0, 1.0), innerGlow.mul(0.4)).mul(shimmer);
    const alpha = clamp(innerGlow.mul(0.9).add(outerGlow.mul(0.3)).mul(uOpacity), 0.0, 1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.positionNode = displacedPosition;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(innerGlow.mul(0.5));

    return {
        material,
        uniforms: {
            uTime,
            uOpacity,
            uSpiritColor,
        },
    };
}

export function createLensFlareNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uOpacity = uniform(params.opacity ?? 0.1);
    const uFlareColor = uniform(params.flareColor ?? new THREE.Color(0xFFAA66));
    const flareType = Math.round(params.flareType ?? 0);

    const uvNode = uv();
    const centered = uvNode.sub(0.5);
    const dist = length(centered).mul(2.0);

    let shape;
    if (flareType === 1) {
        const outer = float(1.0).sub(smoothstep(float(0.42), float(0.52), dist));
        const inner = float(1.0).sub(smoothstep(float(0.28), float(0.38), dist));
        shape = clamp(outer.sub(inner), 0.0, 1.0);
    } else if (flareType === 2) {
        const p = centered.mul(2.0);
        const edge = max(abs(p.x).mul(0.866).add(abs(p.y).mul(0.5)), abs(p.y));
        shape = float(1.0).sub(smoothstep(float(0.55), float(0.72), edge));
    } else if (flareType === 3) {
        const streak = float(1.0).sub(smoothstep(float(0.0), float(1.0), abs(centered.y.mul(12.0))));
        const taper = float(1.0).sub(smoothstep(float(0.1), float(1.0), abs(centered.x.mul(2.5))));
        shape = streak.mul(taper);
    } else {
        shape = float(1.0).sub(smoothstep(float(0.0), float(1.0), dist));
    }

    const shimmer = sin(uTime.mul(0.8).add(centered.x.mul(9.0))).mul(0.08).add(0.92);
    const alpha = clamp(shape.mul(uOpacity).mul(shimmer), 0.0, 1.0);
    const color = uFlareColor.mul(shape.mul(0.3).add(0.7));

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.DoubleSide;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(1.1));

    return {
        material,
        uniforms: {
            uTime,
            uOpacity,
            uFlareColor,
        },
    };
}

export function createSpiritWindNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uOpacity = uniform(params.opacity ?? 0.2);
    const uWindColor = uniform(params.windColor ?? new THREE.Color(0xFFBB77));
    const uOffset = uniform(params.offset ?? 0);

    const anchor = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const uvNode = uv();
    const centeredY = uvNode.y.sub(0.5);
    const flowOffset = sin(anchor.x.mul(0.1).add(uTime).add(uOffset)).mul(2.0).mul(centeredY);
    const displacedPosition = vec3(
        positionLocal.x.add(flowOffset),
        positionLocal.y,
        positionLocal.z,
    );

    const ribbon = pow(float(1.0).sub(abs(centeredY).mul(2.0)), 2.0);
    const hFade = smoothstep(float(0.0), float(0.2), uvNode.x)
        .mul(smoothstep(float(1.0), float(0.8), uvNode.x));
    const flowNoise = noise2D(
        vec2(
            uvNode.x.mul(3.0).sub(uTime.mul(0.5)).add(uOffset),
            uvNode.y.mul(2.0).add(anchor.z.mul(0.01)),
        ),
    );
    const flow = flowNoise.mul(0.3).add(0.7);

    const alpha = clamp(ribbon.mul(hFade).mul(flow).mul(uOpacity).mul(0.4), 0.0, 1.0);
    const color = uWindColor.add(vec3(0.1, 0.15, 0.1).mul(float(1.0).sub(uvNode.x)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.positionNode = displacedPosition;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.2));

    return {
        material,
        uniforms: {
            uTime,
            uOpacity,
            uWindColor,
            uOffset,
        },
    };
}

export function createWaterNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uReflectionMatrix = uniform(
        params.reflectionMatrix ?? new THREE.Matrix4().identity(),
    );
    const uSunDirection = uniform(
        (params.sunDirection ?? new THREE.Vector3(0.0, 1.0, 0.0)).clone().normalize(),
    );
    const uSunColor = uniform(params.sunColor ?? new THREE.Color(0xffcc88));
    const uNearColor = uniform(params.nearColor ?? new THREE.Color(0x8f3d16));
    const uFarColor = uniform(params.farColor ?? new THREE.Color(0xf0ad62));
    const uSkyReflection = uniform(params.skyReflection ?? new THREE.Color(0xffb274));
    const uRippleStrength = uniform(params.rippleStrength ?? 0.36);
    const uDistortionStrength = uniform(params.distortionStrength ?? 0.011);
    const uFresnelPower = uniform(params.fresnelPower ?? 2.6);
    const uFresnelBias = uniform(params.fresnelBias ?? 0.08);
    const uSunPathStrength = uniform(params.sunPathStrength ?? 0.8);
    const uShoreDarkening = uniform(params.shoreDarkening ?? 0.58);
    const uShoreFoamStrength = uniform(params.shoreFoamStrength ?? 0.45);
    const uObjectFoamStrength = uniform(params.objectFoamStrength ?? 0.58);
    const uEmissiveStrength = uniform(params.emissiveStrength ?? 1.1);

    const uvNode = uv();

    const worldXZ = vec2(positionWorld.x, positionWorld.z);

    const wave1 = sin(positionLocal.x.mul(0.34).add(uTime.mul(0.55))).mul(0.2);
    const wave2 = sin(positionLocal.y.mul(0.46).sub(uTime.mul(0.41)).add(1.4)).mul(0.15);
    const wave3 = sin(positionLocal.x.mul(0.9).add(positionLocal.y.mul(0.72)).add(uTime.mul(0.88))).mul(0.08);
    const wave4 = sin(positionLocal.x.mul(1.7).sub(positionLocal.y.mul(1.25)).sub(uTime.mul(1.15))).mul(0.05);
    const waveDisplacement = wave1.add(wave2).add(wave3).add(wave4).mul(uRippleStrength);

    const distortion = vec2(
        sin(worldXZ.y.mul(0.72).add(uTime.mul(1.32)))
            .add(sin(worldXZ.x.mul(0.45).sub(uTime.mul(0.92)).add(worldXZ.y.mul(0.18))).mul(0.72)),
        sin(worldXZ.x.mul(0.81).add(uTime.mul(1.08)))
            .add(sin(worldXZ.y.mul(0.36).add(uTime.mul(0.74))).mul(0.58)),
    ).mul(uDistortionStrength);
    const reflectionCoord = uReflectionMatrix.mul(
        vec4(positionWorld.x, positionWorld.y, positionWorld.z, 1.0),
    );
    const projectedReflectionUv = vec2(
        reflectionCoord.x.div(reflectionCoord.w),
        reflectionCoord.y.div(reflectionCoord.w),
    );
    const reflectionUv = vec2(
        clamp(projectedReflectionUv.x.add(distortion.x), 0.001, 0.999),
        clamp(projectedReflectionUv.y.add(distortion.y), 0.001, 0.999),
    );

    const reflectionTexture = params.enableReflectionSample === true && params.reflectionMap
        ? texture(params.reflectionMap)
        : null;
    const reflectionSample = reflectionTexture ? reflectionTexture.sample(reflectionUv).rgb : uSkyReflection;

    const depthGradient = smoothstep(float(0.0), float(0.68), uvNode.y);
    let waterBase = mix(uNearColor, uFarColor, depthGradient.mul(0.88).add(0.12));

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(
        float(1.0).sub(clamp(dot(normalize(normalWorld), viewDir), 0.0, 1.0)),
        uFresnelPower,
    ).mul(float(1.0).sub(uFresnelBias)).add(uFresnelBias);

    const wavePatternA = sin(worldXZ.x.mul(0.16).add(uTime.mul(0.65)))
        .mul(sin(worldXZ.y.mul(0.19).sub(uTime.mul(0.52))));
    const wavePatternB = sin(worldXZ.x.mul(0.82).sub(worldXZ.y.mul(0.64)).add(uTime.mul(1.45)));
    const wavePatternC = sin(worldXZ.x.add(worldXZ.y).mul(1.35).add(uTime.mul(2.05)));
    const wavePattern = wavePatternA.mul(0.4).add(wavePatternB.mul(0.35)).add(wavePatternC.mul(0.25))
        .mul(0.5)
        .add(0.5);
    const waveCrestMask = smoothstep(float(0.58), float(0.95), wavePattern);
    const waveTroughMask = smoothstep(float(0.12), float(0.56), wavePattern)
        .mul(float(1.0).sub(waveCrestMask));
    waterBase = waterBase.mul(float(1.0).sub(waveTroughMask.mul(0.06)));
    waterBase = waterBase.add(uSkyReflection.mul(waveCrestMask.mul(0.16)));
    waterBase = waterBase.add(vec3(0.22, 0.12, 0.05).mul(waveCrestMask.mul(0.08)));

    const verticalReflect = float(1.0).sub(uvNode.y).mul(0.55).add(0.45);
    const reflected = mix(uSkyReflection.mul(0.72), reflectionSample, 0.62).mul(verticalReflect);
    const reflectionMix = clamp(fresnel.mul(0.52).add(waveCrestMask.mul(0.12)), 0.0, 0.86);
    waterBase = mix(waterBase, reflected, reflectionMix);

    const centerDist = length(uvNode.sub(0.5)).mul(2.0);
    const shoreShadow = smoothstep(float(0.86), float(1.0), centerDist);
    waterBase = mix(waterBase, vec3(0.35, 0.18, 0.08), shoreShadow.mul(uShoreDarkening));

    // Shoreline foam pulse around lake edge for parity with WebGL shader path.
    const shoreFoamZone = smoothstep(float(0.74), float(0.96), centerDist);
    const shoreFoamA = sin(worldXZ.x.mul(0.8).add(uTime.mul(1.2)))
        .mul(sin(worldXZ.y.mul(0.6).add(uTime.mul(0.9))));
    const shoreFoamB = sin(worldXZ.x.mul(1.5).sub(uTime.mul(0.8)))
        .mul(sin(worldXZ.y.mul(1.2).add(uTime.mul(1.1))));
    const shoreFoamC = sin(worldXZ.x.add(worldXZ.y).mul(0.5).add(uTime.mul(0.7)));
    const shorePattern = shoreFoamA.add(shoreFoamB.mul(0.6)).add(shoreFoamC.mul(0.4))
        .mul(0.5)
        .add(0.5);
    let shoreFoam = smoothstep(float(0.3), float(0.7), shorePattern).mul(shoreFoamZone);
    const shoreFoamVariation = sin(worldXZ.x.mul(2.0)).mul(sin(worldXZ.y.mul(2.5))).mul(0.15).add(0.85);
    shoreFoam = shoreFoam.mul(shoreFoamVariation).mul(uShoreFoamStrength);

    // Object interaction foam around logs/shore stones touching water.
    const foam1 = smoothstep(float(13.5), float(3.8), length(worldXZ.sub(vec2(-45.0, -15.0))));
    const foam2 = smoothstep(float(12.0), float(3.2), length(worldXZ.sub(vec2(-15.0, -12.0))));
    const foam3 = smoothstep(float(10.0), float(2.8), length(worldXZ.sub(vec2(22.0, -15.0))));
    const foam4 = smoothstep(float(12.0), float(3.6), length(worldXZ.sub(vec2(85.0, 5.0))));
    const foam5 = smoothstep(float(11.0), float(3.2), length(worldXZ.sub(vec2(100.0, 12.0))));
    const foam6 = smoothstep(float(9.0), float(2.6), length(worldXZ.sub(vec2(-25.0, -12.0))));
    const foam7 = smoothstep(float(10.0), float(3.0), length(worldXZ.sub(vec2(30.0, -14.0))));

    let objectFoam = max(foam1, foam2);
    objectFoam = max(objectFoam, foam3);
    objectFoam = max(objectFoam, foam4);
    objectFoam = max(objectFoam, foam5);
    objectFoam = max(objectFoam, foam6);
    objectFoam = max(objectFoam, foam7);

    const objectFoamWave = sin(worldXZ.x.mul(0.8).add(uTime.mul(1.0)))
        .mul(sin(worldXZ.y.mul(0.6).add(uTime.mul(0.8))))
        .mul(0.25)
        .add(0.75);
    objectFoam = objectFoam.mul(objectFoamWave).mul(uObjectFoamStrength);
    const foamColor = vec3(1.0, 0.88, 0.74);
    const foamMix = max(shoreFoam, objectFoam);
    waterBase = mix(waterBase, foamColor, foamMix);

    const sunCenterOffset = clamp(uSunDirection.x.mul(0.35), -0.25, 0.25);
    const sunAxisOffset = distortion.x.mul(8.0).add(wavePattern.sub(0.5).mul(0.11));
    const sunPathAxis = abs(uvNode.x.sub(0.5).sub(sunCenterOffset).add(sunAxisOffset)).mul(2.0);
    const sunPathCore = float(1.0).sub(smoothstep(float(0.0), float(0.05), sunPathAxis));
    const sunPathWide = float(1.0).sub(smoothstep(float(0.05), float(0.28), sunPathAxis));
    const sunPathMask = sunPathCore.mul(0.9).add(sunPathWide.mul(0.5));
    const pathDepth = smoothstep(float(0.06), float(0.98), depthGradient).mul(0.95).add(0.1);
    const sparkleA = sin(worldXZ.x.mul(2.6).add(uTime.mul(1.7))).mul(0.5).add(0.5);
    const sparkleB = sin(worldXZ.y.mul(3.1).sub(uTime.mul(1.35))).mul(0.5).add(0.5);
    const sparkleC = sin(worldXZ.x.add(worldXZ.y).mul(1.2).add(uTime.mul(2.3))).mul(0.5).add(0.5);
    const sparkle = sparkleA.mul(0.34).add(sparkleB.mul(0.33)).add(sparkleC.mul(0.33));
    const sparkleMask = smoothstep(float(0.58), float(0.93), sparkle)
        .mul(0.65)
        .add(smoothstep(float(0.62), float(0.96), wavePatternC.mul(0.5).add(0.5)).mul(0.35))
        .add(0.2);
    const sunFacing = clamp(dot(normalize(normalWorld), normalize(uSunDirection)), 0.0, 1.0)
        .mul(0.45)
        .add(0.55);
    const sunPath = sunPathMask
        .mul(pathDepth)
        .mul(sparkleMask)
        .mul(uSunPathStrength)
        .mul(sunFacing);

    const sunHalfDir = normalize(viewDir.add(normalize(uSunDirection)));
    const sunSpecular = pow(max(dot(normalize(normalWorld), sunHalfDir), 0.0), 42.0)
        .mul(waveCrestMask.mul(0.75).add(0.25))
        .mul(0.22);
    const sunSpecularColor = mix(uSunColor, vec3(1.0, 0.95, 0.82), 0.45).mul(sunSpecular);

    const sunPathColor = mix(uSunColor, vec3(1.0, 0.92, 0.78), sunPathCore.mul(0.45)).mul(sunPath);
    let color = waterBase.add(sunPathColor).add(sunSpecularColor);
    color = color.add(uSunColor.mul(pow(fresnel, 1.65)).mul(0.045));

    const edgeAlpha = float(1.0).sub(smoothstep(float(0.97), float(1.0), centerDist));

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.colorNode = color;
    material.opacityNode = edgeAlpha.mul(0.985);
    material.emissiveNode = sunPathColor.add(sunSpecularColor).mul(uEmissiveStrength);
    // Lake mesh is rotated by -PI/2 around X in theme code.
    // Displacing local Z produces vertical world-space water motion.
    material.positionNode = vec3(positionLocal.x, positionLocal.y, positionLocal.z.add(waveDisplacement));

    return {
        material,
        uniforms: {
            uTime,
            uReflectionMatrix,
            uSunDirection,
            uSunColor,
            uNearColor,
            uFarColor,
            uSkyReflection,
            uRippleStrength,
            uDistortionStrength,
            uFresnelPower,
            uFresnelBias,
            uSunPathStrength,
            uShoreDarkening,
            uShoreFoamStrength,
            uObjectFoamStrength,
            uEmissiveStrength,
        },
    };
}
