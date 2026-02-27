import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    floor,
    fract,
    length,
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

const hash2D = /* @__PURE__ */ Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

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
    const octaveA = noise2D(p);
    const octaveB = noise2D(p.mul(2.03).add(vec2(12.4, 4.9))).mul(0.5);
    const octaveC = noise2D(p.mul(4.09).add(vec2(2.7, 17.3))).mul(0.25);
    return octaveA.mul(0.57).add(octaveB.mul(0.29)).add(octaveC.mul(0.14));
});

function saturate(value) {
    return clamp(value, 0.0, 1.0);
}

function withColor(value, fallback) {
    if (value?.isColor) return value;
    if (Array.isArray(value) && value.length >= 3) {
        return new THREE.Color(value[0], value[1], value[2]);
    }
    return fallback;
}

function withVec3(value, fallback) {
    if (value?.isVector3) return value;
    if (Array.isArray(value) && value.length >= 3) {
        return new THREE.Vector3(value[0], value[1], value[2]);
    }
    return fallback;
}

export function createSkyAtmosphereMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uTopColor = uniform(withColor(params.topColor, new THREE.Color(0x95b8ea)));
    const uMidColor = uniform(withColor(params.midColor, new THREE.Color(0x8ac8ec)));
    const uHorizonColor = uniform(withColor(params.horizonColor, new THREE.Color(0xf3e2bf)));
    const uSunColor = uniform(withColor(params.sunColor, new THREE.Color(0xfff3d8)));
    const uCloudTint = uniform(withColor(params.cloudTint, new THREE.Color(0xf4f7ff)));
    const uSunDirection = uniform(withVec3(
        params.sunDirection,
        new THREE.Vector3(0.35, 0.48, -0.72),
    ).clone().normalize());
    const uCloudScale = uniform(params.cloudScale ?? 4.3);
    const uCloudSpeed = uniform(params.cloudSpeed ?? 0.018);

    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const heightT = saturate(viewDir.y.mul(0.5).add(0.5));

    let colorNode = mix(
        uHorizonColor,
        uMidColor,
        smoothstep(float(0.03), float(0.52), heightT),
    );
    colorNode = mix(
        colorNode,
        uTopColor,
        smoothstep(float(0.45), float(0.95), heightT),
    );

    const sunDot = saturate(dot(viewDir, normalize(uSunDirection)));
    const sunDisk = pow(sunDot, 420.0).mul(0.88);
    const sunHalo = pow(sunDot, 20.0).mul(0.28);

    const cloudUv = vec2(viewDir.x, viewDir.z)
        .mul(uCloudScale)
        .add(vec2(uTime.mul(uCloudSpeed), uTime.mul(uCloudSpeed).mul(-0.55)));
    const cloudNoise = fbm2D(cloudUv);

    // Add high-altitude wispy cirrus clouds
    const cirrusUv = vec2(viewDir.x.mul(1.5), viewDir.z.mul(1.5))
        .mul(uCloudScale)
        .add(vec2(uTime.mul(uCloudSpeed).mul(0.4), uTime.mul(uCloudSpeed).mul(0.2)));
    const cirrusNoise = fbm2D(cirrusUv);

    const cloudBand = smoothstep(float(0.16), float(0.56), heightT)
        .mul(float(1.0).sub(smoothstep(float(0.7), float(0.97), heightT)));
    const cloudMask = smoothstep(float(0.54), float(0.83), cloudNoise).mul(cloudBand);

    // Wide swept cirrus
    const cirrusMask = smoothstep(float(0.45), float(0.7), cirrusNoise)
        .mul(smoothstep(float(0.3), float(0.8), heightT)) // Highest in the sky
        .mul(float(1.0).sub(cloudMask)); // Don't cover thick clouds

    const silver = pow(sunDot, 10.0).mul(cloudMask.add(cirrusMask)).mul(0.24);

    colorNode = colorNode
        .add(uSunColor.mul(sunDisk))
        .add(uSunColor.mul(sunHalo))
        .add(uCloudTint.mul(cloudMask).mul(0.16))
        .add(uCloudTint.mul(cirrusMask).mul(0.12))
        .add(vec3(1.0, 0.97, 0.9).mul(silver));

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.colorNode = colorNode;
    material.emissiveNode = colorNode.mul(0.12);

    return {
        material,
        uniforms: {
            uTime,
            uTopColor,
            uMidColor,
            uHorizonColor,
            uSunColor,
            uCloudTint,
            uSunDirection,
            uCloudScale,
            uCloudSpeed,
        },
    };
}

export function createTerrainMaterial(params = {}) {
    const uNearColor = uniform(withColor(params.nearColor, new THREE.Color(0xb2cc7a))); // Brighter, more vibrant near grass
    const uFarColor = uniform(withColor(params.farColor, new THREE.Color(0x9ab868)));
    const uRidgeColor = uniform(withColor(params.ridgeColor, new THREE.Color(0x6e8a4a)));
    const uPathTint = uniform(withColor(params.pathTint, new THREE.Color(0xddbd8f))); // Warmer, sandier path
    const uValleyTint = uniform(withColor(params.valleyTint, new THREE.Color(0x4a6948)));
    const uCrestTint = uniform(withColor(params.crestTint, new THREE.Color(0xcede88)));
    const uFogColor = uniform(withColor(params.fogColor, new THREE.Color(0xc3d8e6)));
    const uFogNear = uniform(params.fogNear ?? 92);
    const uFogFar = uniform(params.fogFar ?? 360);
    const uFarCoverageStrength = uniform(params.farCoverageStrength ?? 0.5);
    const uFlowerFarTintStrength = uniform(params.flowerFarTintStrength ?? 0.42);
    const uFlowerPinkTint = uniform(withColor(params.flowerPinkTint, new THREE.Color(0xf2a9c8)));
    const uFlowerYellowTint = uniform(withColor(params.flowerYellowTint, new THREE.Color(0xeed86f)));
    const uSunDirection = uniform(withVec3(
        params.sunDirection,
        new THREE.Vector3(0.35, 0.48, -0.72),
    ).clone().normalize());
    const uRoughness = uniform(params.roughness ?? 0.86);

    const worldPos = positionWorld;
    const worldNormal = normalize(normalWorld);
    const pathMaskBase = attribute('aPathMask');
    const valleyMask = attribute('aValleyMask');
    const curvature = attribute('aCurvature');
    const lightDir = normalize(uSunDirection);

    const pathNoise = fbm2D(worldPos.xz.mul(0.1));
    const pathMask = smoothstep(float(0.4), float(0.55), pathMaskBase.mul(float(0.85).add(pathNoise.mul(0.3))));

    const slope = float(1.0).sub(saturate(worldNormal.y));
    const terrainNoise = fbm2D(worldPos.xz.mul(0.055));
    const crestMask = smoothstep(float(-1.12), float(-0.14), curvature);
    const shoulderMask = pathMask
        .mul(float(1.0).sub(smoothstep(float(0.58), float(0.96), pathMask)))
        .mul(1.15);

    const camDist = length(worldPos.sub(cameraPosition));
    const nDotL = saturate(dot(worldNormal, lightDir));

    let albedo = mix(uFarColor, uNearColor, smoothstep(float(80.0), float(5.0), camDist));
    albedo = mix(albedo, uValleyTint, valleyMask.mul(0.4));
    albedo = mix(albedo, uCrestTint, crestMask.mul(0.38));
    albedo = mix(albedo, uPathTint, pathMask.mul(0.85)); // Stronger, stylized path color

    // Add specular-like highlights for grassy stylization
    const grassHighlight = pow(nDotL, 2.8).mul(0.12).mul(float(1.0).sub(pathMask));
    albedo = albedo.add(vec3(0.15, 0.4, 0.1).mul(grassHighlight));

    const wrappedLight = nDotL.mul(0.62).add(0.38);
    let litColor = albedo.mul(wrappedLight);

    const viewDir = normalize(cameraPosition.sub(worldPos));
    const fresnel = pow(float(1.0).sub(saturate(dot(worldNormal, viewDir))), 3.5);
    const rimLight = fresnel.mul(nDotL).mul(0.45);
    litColor = litColor.add(uCrestTint.mul(rimLight));

    const farBand = smoothstep(float(130.0), float(520.0), camDist);
    const coverageNoise = fbm2D(worldPos.xz.mul(0.11).add(vec2(4.6, -2.2)));
    const farCoverage = smoothstep(float(0.34), float(0.82), coverageNoise)
        .mul(farBand)
        .mul(uFarCoverageStrength);
    litColor = mix(litColor, litColor.mul(1.08), farCoverage.mul(0.26));

    const flowerNoise = fbm2D(worldPos.xz.mul(0.074).add(vec2(12.3, -9.1)));
    const flowerScatter = smoothstep(float(0.58), float(0.88), flowerNoise)
        .mul(farBand)
        .mul(float(1.0).sub(smoothstep(float(0.58), float(0.92), pathMask)))
        .mul(smoothstep(float(0.12), float(0.72), valleyMask.add(pathMask.mul(0.45))))
        .mul(uFlowerFarTintStrength);
    const familyBlend = smoothstep(
        float(-0.2),
        float(0.36),
        sin(worldPos.x.mul(0.019).add(worldPos.z.mul(0.007))),
    );
    const flowerTint = mix(uFlowerYellowTint, uFlowerPinkTint, familyBlend);
    litColor = mix(litColor, litColor.add(flowerTint.mul(0.14)), flowerScatter.mul(0.42));

    const aerial = smoothstep(uFogNear, uFogFar, camDist);
    litColor = mix(litColor, uFogColor, aerial.mul(0.45));

    const material = new THREE.MeshStandardNodeMaterial();
    material.side = THREE.DoubleSide;
    material.colorNode = litColor;
    material.roughnessNode = saturate(uRoughness.add(slope.mul(0.12)));
    material.metalnessNode = float(0.0);

    return {
        material,
        uniforms: {
            uNearColor,
            uFarColor,
            uRidgeColor,
            uPathTint,
            uValleyTint,
            uCrestTint,
            uFogColor,
            uFogNear,
            uFogFar,
            uFarCoverageStrength,
            uFlowerFarTintStrength,
            uFlowerPinkTint,
            uFlowerYellowTint,
            uSunDirection,
            uRoughness,
        },
    };
}

export function createCliffMaterial(params = {}) {
    const uShadowColor = uniform(withColor(params.shadowColor, new THREE.Color(0x5a6c8b))); // Deep cool shadow
    const uMidColor = uniform(withColor(params.midColor, new THREE.Color(0x8a9aad))); // Neutral rock
    const uHighlightColor = uniform(withColor(params.highlightColor, new THREE.Color(0xcacbcb))); // Warm sunlight hit
    const uFogColor = uniform(withColor(params.fogColor, new THREE.Color(0xc3d8e6)));
    const uFogNear = uniform(params.fogNear ?? 90);
    const uFogFar = uniform(params.fogFar ?? 420);
    const uSunDirection = uniform(withVec3(
        params.sunDirection,
        new THREE.Vector3(0.35, 0.48, -0.72),
    ).clone().normalize());

    const worldPos = positionWorld;
    const worldNormal = normalize(normalWorld);
    const lightDir = normalize(uSunDirection);

    // Creates vertical striations/cracks in the rock walls
    const cliffNoise = fbm2D(worldPos.xz.mul(0.12).add(vec2(worldPos.y.mul(0.8), 0.0)));
    const cliffBands = fbm2D(worldPos.xz.mul(0.04).add(vec2(0.0, worldPos.y.mul(0.1))));

    // Add noise to the normal for faceted shading
    const perturbedNormal = normalize(worldNormal.add(vec3(cliffNoise.mul(0.15), cliffBands.mul(0.05), cliffNoise.mul(0.15))));
    const nDotL = saturate(dot(perturbedNormal, lightDir));

    let albedo = mix(uShadowColor, uMidColor, smoothstep(float(0.1), float(0.6), nDotL));
    albedo = mix(albedo, uHighlightColor, pow(nDotL, 2.5).mul(0.7));

    // Darken crevices
    const crevice = smoothstep(float(0.4), float(0.55), cliffNoise);
    albedo = mix(albedo, albedo.mul(0.5), crevice.mul(0.4));

    // Fog blending (cliffs go deep, so they fade heavily into atmospheric fog)
    const distance = length(worldPos.sub(cameraPosition));
    const fogFactor = smoothstep(uFogNear, uFogFar, distance);
    const heightFade = smoothstep(float(10.0), float(-80.0), worldPos.y); // Fade out to fog deep down
    const combinedFog = saturate(fogFactor.add(heightFade.mul(0.8)));

    albedo = mix(albedo, uFogColor, combinedFog);

    const material = new THREE.MeshStandardNodeMaterial();
    material.side = THREE.DoubleSide; // Skirts might be viewed from underneath
    material.colorNode = albedo;
    material.roughnessNode = float(0.95); // Very rough rock
    material.metalnessNode = float(0.0);

    return {
        material,
        uniforms: {
            uShadowColor,
            uMidColor,
            uHighlightColor,
            uFogColor,
            uFogNear,
            uFogFar,
            uSunDirection,
        },
    };
}

export function createMountainMaterial(params = {}) {
    const uShadowColor = uniform(withColor(params.shadowColor, new THREE.Color(0x3f5a7c)));
    const uMidColor = uniform(withColor(params.midColor, new THREE.Color(0x6f93b8)));
    const uHighlightColor = uniform(withColor(params.highlightColor, new THREE.Color(0xc8dcf0)));
    const uPeakColor = uniform(withColor(params.peakColor, new THREE.Color(0xd8d4e8)));
    const uRimColor = uniform(withColor(params.rimColor, new THREE.Color(0xf6efe1)));
    const uAtmosphereColor = uniform(withColor(params.atmosphereColor, new THREE.Color(0xb4cde0)));
    const uFogNear = uniform(params.fogNear ?? 90);
    const uFogFar = uniform(params.fogFar ?? 420);
    const uSunDirection = uniform(withVec3(
        params.sunDirection,
        new THREE.Vector3(0.35, 0.48, -0.72),
    ).clone().normalize());

    const worldPos = positionWorld;
    const worldNormal = normalize(normalWorld);
    const lightDir = normalize(uSunDirection);
    const viewDir = normalize(cameraPosition.sub(worldPos));

    // FBM-based normal perturbation — breaks up flat faces into rocky facets
    const rockNoise = fbm2D(worldPos.xz.mul(0.028));
    const rockDetail = fbm2D(worldPos.xz.mul(0.076).add(vec2(4.2, 7.8)));
    const perturbedNormal = normalize(worldNormal.add(vec3(
        rockNoise.sub(0.5).mul(0.55).add(rockDetail.sub(0.5).mul(0.22)),
        float(0.0),
        rockNoise.sub(0.5).mul(0.55).add(rockDetail.sub(0.5).mul(0.22)),
    )));

    const nDotL = saturate(dot(perturbedNormal, lightDir));
    const heightFactor = smoothstep(float(-8.0), float(350.0), worldPos.y);
    const fresnel = pow(float(1.0).sub(saturate(dot(perturbedNormal, viewDir))), 3.0);

    // Base lighting: shadow → mid rock → highlight
    let colorNode = mix(uShadowColor, uMidColor, nDotL.mul(0.8).add(heightFactor.mul(0.35)));
    colorNode = mix(colorNode, uHighlightColor, pow(nDotL, 2.0).mul(0.75).add(heightFactor.mul(0.18)));

    // Rock strata: horizontal bands with noise warp for natural layering
    const strataWarp = fbm2D(worldPos.xz.mul(0.009).add(vec2(worldPos.y.mul(0.005), 0.0)));
    const strata = sin(worldPos.y.mul(0.10).add(strataWarp.mul(4.5)));
    const strataBlend = smoothstep(float(-0.25), float(0.25), strata)
        .mul(0.16)
        .mul(float(1.0).sub(heightFactor.mul(0.5)));
    colorNode = colorNode.add(uHighlightColor.sub(uMidColor).mul(strataBlend));

    // Pale peak tint on upper faces (exposed lighter rock, not glowing snow)
    const peakMask = smoothstep(float(0.60), float(0.85), heightFactor)
        .mul(smoothstep(float(0.25), float(0.65), perturbedNormal.y));
    colorNode = mix(colorNode, uPeakColor, peakMask.mul(0.55));

    // Toned-down rim light
    const rimStrength = fresnel.mul(nDotL.add(0.15)).mul(1.0);
    colorNode = colorNode.add(uRimColor.mul(rimStrength));

    const distance = length(worldPos.sub(cameraPosition));
    const atmosphere = smoothstep(uFogNear, uFogFar, distance);
    colorNode = mix(colorNode, uAtmosphereColor, atmosphere.mul(0.58));

    const material = new THREE.MeshStandardNodeMaterial();
    material.colorNode = colorNode;
    material.roughnessNode = float(0.96);
    material.metalnessNode = float(0.0);

    return {
        material,
        uniforms: {
            uShadowColor,
            uMidColor,
            uHighlightColor,
            uPeakColor,
            uRimColor,
            uAtmosphereColor,
            uFogNear,
            uFogFar,
            uSunDirection,
        },
    };
}

export function createCottonCloudMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uLitColor = uniform(withColor(params.litColor, new THREE.Color(0xffffff)));
    const uShadowColor = uniform(withColor(params.shadowColor, new THREE.Color(0xa3badb))); // Deeper, cooler shadow
    const uRimColor = uniform(withColor(params.rimColor, new THREE.Color(0xfff1e0))); // Warmer, brighter rim
    const uTranslucencyColor = uniform(withColor(params.translucencyColor, new THREE.Color(0xdce5f2))); // Mid-tone for SSS
    const uOpacity = uniform(params.opacity ?? 0.88); // Slightly more opaque center
    const uDetailScale = uniform(params.detailScale ?? 5.2);
    const uNoiseSpeed = uniform(params.noiseSpeed ?? 0.04);
    const uSunDirection = uniform(withVec3(
        params.sunDirection,
        new THREE.Vector3(0.35, 0.48, -0.72),
    ).clone().normalize());

    const uvNode = uv().sub(0.5).mul(2.0);
    const dist = length(uvNode);

    const noiseUv = uvNode.mul(uDetailScale)
        .add(vec2(uTime.mul(uNoiseSpeed), uTime.mul(uNoiseSpeed).mul(-0.6)));
    const wispyNoise = fbm2D(noiseUv);

    const softEdge = smoothstep(float(1.15), float(0.12), dist.add(wispyNoise.mul(0.35)));
    const cloudAlpha = saturate(softEdge.mul(uOpacity));

    const worldNormal = normalize(normalWorld);
    const lightDir = normalize(uSunDirection);
    const viewDir = normalize(cameraPosition.sub(positionWorld));

    // Core lighting
    const nDotL = saturate(dot(worldNormal, lightDir));
    const wrappedLight = nDotL.mul(0.6).add(0.4); // Wrap light around for softer terminator

    // Subsurface scattering approximation (light passing through thin edges)
    const viewDotLight = dot(viewDir, lightDir.negate());
    const scatter = pow(saturate(viewDotLight), 2.5).mul(0.4).mul(float(1.0).sub(cloudAlpha));

    // Rim lighting
    const fresnel = pow(float(1.0).sub(saturate(dot(worldNormal, viewDir))), 2.2);
    const rim = fresnel.mul(nDotL.add(0.3)).mul(0.85);

    // Build final color
    let cloudColor = mix(uShadowColor, uTranslucencyColor, wrappedLight);
    cloudColor = mix(cloudColor, uLitColor, pow(nDotL, 1.8)); // Bright sunward facing
    cloudColor = cloudColor.add(uRimColor.mul(rim).mul(0.5)); // Soften crisp rim
    cloudColor = cloudColor.add(uRimColor.mul(scatter).mul(0.3)); // Soften glowing scatter through edges

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;
    material.colorNode = cloudColor;
    material.opacityNode = cloudAlpha;
    material.emissiveNode = cloudColor.mul(cloudAlpha).mul(0.18);

    return {
        material,
        uniforms: {
            uTime,
            uLitColor,
            uShadowColor,
            uRimColor,
            uTranslucencyColor,
            uOpacity,
            uDetailScale,
            uNoiseSpeed,
            uSunDirection,
        },
    };
}

export function createGrassMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uWindStrength = uniform(params.windStrength ?? 0.85);
    const uBaseColor = uniform(withColor(params.baseColor, new THREE.Color(0x3d7e3d)));
    const uTipColor = uniform(withColor(params.tipColor, new THREE.Color(0xb4df74)));
    const uBacklightColor = uniform(withColor(params.backlightColor, new THREE.Color(0xe9f8a6)));
    const uFogColor = uniform(withColor(params.fogColor, new THREE.Color(0xc3d8e6)));
    const uFogNear = uniform(params.fogNear ?? 80);
    const uFogFar = uniform(params.fogFar ?? 290);
    const uSunDirection = uniform(withVec3(
        params.sunDirection,
        new THREE.Vector3(0.35, 0.48, -0.72),
    ).clone().normalize());
    const hasAtlas = !!params.atlasTexture;
    const atlasSample = hasAtlas ? texture(params.atlasTexture, uv().flipY()) : null;

    const aPhase = attribute('aPhase');
    const aTint = attribute('aTint');
    const aLean = attribute('aLean');

    const baseWorldPos = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
    const bladeHeight = uv().y;

    // Slower, wider synchronized waves
    const windPhase = aPhase.mul(0.3) // Break up phase sync slightly
        .add(baseWorldPos.x.mul(0.012))
        .add(baseWorldPos.z.mul(0.012));
    const windPrimary = sin(uTime.mul(1.4).add(windPhase)).mul(0.7);
    const windSecondary = sin(uTime.mul(0.8).add(windPhase.mul(1.5))).mul(0.3);
    const gustField = sin(
        uTime.mul(1.8)
            .add(baseWorldPos.x.mul(0.015))
            .add(baseWorldPos.z.mul(0.015)),
    ).mul(0.55);

    // Large sweeping bend
    const windBend = windPrimary
        .add(windSecondary)
        .add(gustField)
        .mul(uWindStrength)
        .mul(2.2)
        .mul(bladeHeight)
        .mul(bladeHeight);

    const displaced = positionLocal.add(vec3(
        windBend.mul(0.4).add(aLean.x.mul(bladeHeight).mul(0.08)), // Stronger lean mapping
        abs(windBend).mul(-0.15).mul(bladeHeight), // Squish down further on bend
        windBend.mul(0.2).add(aLean.y.mul(bladeHeight).mul(0.08)), // Diagonal push
    ));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.positionNode = displaced;

    const gradient = mix(uBaseColor, uTipColor, smoothstep(float(0.08), float(1.0), bladeHeight));
    let grassColor = gradient.mul(aTint);

    const worldNormal = normalize(normalWorld);
    const nDotL = saturate(dot(worldNormal, normalize(uSunDirection)));
    const wrapped = nDotL.mul(0.58).add(0.42);
    grassColor = grassColor.mul(wrapped);

    const backScatter = pow(saturate(float(1.0).sub(nDotL)), 2.4)
        .mul(bladeHeight)
        .mul(0.25); // Significantly reduced to prevent white blowouts
    grassColor = grassColor.add(uBacklightColor.mul(backScatter));

    const fogDistance = length(positionWorld.sub(cameraPosition));
    const fogFactor = smoothstep(uFogNear, uFogFar, fogDistance);
    grassColor = mix(grassColor, uFogColor, fogFactor.mul(0.34));

    const widthMask = float(1.0)
        .sub(smoothstep(float(0.62), float(1.0), abs(uv().x.sub(0.5).mul(2.0))));
    let alpha = smoothstep(float(0.02), float(0.14), bladeHeight).mul(widthMask);

    if (hasAtlas) {
        alpha = alpha.mul(saturate(atlasSample.a.mul(1.35)));
        grassColor = mix(grassColor.mul(0.86), grassColor.mul(1.18), atlasSample.g);
    }
    const grassDistanceFade = float(1.0).sub(smoothstep(uFogNear.add(12.0), uFogFar.add(8.0), fogDistance));
    alpha = alpha.mul(grassDistanceFade.mul(0.9).add(0.1));

    material.transparent = true;
    material.depthWrite = true;
    material.alphaTest = 0.1;
    material.alphaHash = params.alphaHash !== false;
    material.alphaToCoverage = params.alphaToCoverage === true;
    material.forceSinglePass = true;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    material.colorNode = grassColor;
    material.opacityNode = saturate(alpha);

    return {
        material,
        uniforms: {
            uTime,
            uWindStrength,
            uBaseColor,
            uTipColor,
            uBacklightColor,
            uFogColor,
            uFogNear,
            uFogFar,
            uSunDirection,
        },
    };
}

export function createFlowerMaterial(params = {}) {
    const layer = params.layer === 'stem' ? 'stem' : 'head';
    const uTime = uniform(params.time ?? 0);
    const uWindStrength = uniform(params.windStrength ?? (layer === 'stem' ? 0.58 : 0.68));
    const uFogColor = uniform(withColor(params.fogColor, new THREE.Color(0xc3d8e6)));
    const uFogNear = uniform(params.fogNear ?? 80);
    const uFogFar = uniform(params.fogFar ?? 290);
    const uGlowStrength = uniform(params.glowStrength ?? (layer === 'stem' ? 0.15 : 0.45));
    const uSunDirection = uniform(withVec3(
        params.sunDirection,
        new THREE.Vector3(0.35, 0.48, -0.72),
    ).clone().normalize());
    const hasAtlas = !!params.atlasTexture;
    const atlasSample = hasAtlas ? texture(params.atlasTexture, uv().flipY()) : null;

    const aPhase = attribute('aPhase');
    const aColor = attribute('aColor');
    const aLean = attribute('aLean');
    const baseWorldPos = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));

    const swayPhase = aPhase.add(baseWorldPos.x.mul(0.06));
    const bladeHeight = uv().y;
    const gust = sin(
        uTime.mul(2.6) // Faster gusts
            .add(baseWorldPos.x.mul(0.04))
            .add(baseWorldPos.z.mul(0.035)),
    ).mul(layer === 'stem' ? 0.12 : 0.16).mul(uWindStrength); // x2 strength

    const sway = sin(uTime.mul(1.8).add(swayPhase))
        .mul(uWindStrength)
        .mul(layer === 'stem' ? 0.16 : 0.24); // x2 strength

    const displaced = positionLocal.add(vec3(
        sway.add(gust.mul(1.2)).add(aLean.x.mul(bladeHeight).mul(0.08)),
        abs(gust).mul(0.15).mul(bladeHeight), // Head dips down more
        sway.mul(layer === 'stem' ? 0.45 : 0.7).add(gust).add(aLean.y.mul(bladeHeight).mul(0.08)),
    ));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.positionNode = displaced;

    const uvNode = uv().sub(0.5).mul(2.0);
    const dist = length(uvNode);
    const petalNoise = noise2D(uvNode.mul(5.0).add(vec2(uTime.mul(0.06), aPhase.mul(0.2))));
    const headMask = smoothstep(float(1.08), float(0.14), dist.add(petalNoise.mul(0.16)));
    const stemWidth = float(1.0).sub(smoothstep(float(0.24), float(1.0), abs(uv().x.sub(0.5).mul(2.0))));
    const stemMask = stemWidth.mul(smoothstep(float(0.02), float(0.18), bladeHeight));
    const petalMask = layer === 'stem' ? stemMask : headMask;
    const centerMask = float(1.0).sub(smoothstep(float(0.02), float(0.42), dist));

    let flowerColor = aColor;
    if (layer === 'stem') {
        flowerColor = mix(flowerColor.mul(0.72), flowerColor.mul(1.05), bladeHeight);
    } else {
        flowerColor = mix(flowerColor, vec3(1.0, 0.92, 0.55), centerMask.mul(0.28));
        flowerColor = flowerColor.add(flowerColor.mul(centerMask).mul(uGlowStrength));
    }

    if (hasAtlas && layer === 'head') {
        const atlasLift = mix(float(0.9), float(1.15), atlasSample.r);
        flowerColor = flowerColor.mul(atlasLift);
    }

    const worldNormal = normalize(normalWorld);
    const nDotL = saturate(dot(worldNormal, normalize(uSunDirection)));
    const wrapped = nDotL.mul(0.56).add(0.44);
    flowerColor = flowerColor.mul(wrapped);

    const fogDistance = length(positionWorld.sub(cameraPosition));
    const fogFactor = smoothstep(uFogNear, uFogFar, fogDistance);
    flowerColor = mix(flowerColor, uFogColor, fogFactor.mul(layer === 'stem' ? 0.18 : 0.12));

    let alpha = petalMask;
    if (hasAtlas && layer === 'head') {
        alpha = alpha.mul(saturate(atlasSample.a.mul(1.45)));
    }
    const distanceFade = float(1.0).sub(smoothstep(
        uFogNear.add(layer === 'stem' ? 12.0 : 18.0),
        uFogFar.sub(layer === 'stem' ? 72.0 : 58.0),
        fogDistance,
    ));
    alpha = alpha.mul(distanceFade.mul(layer === 'stem' ? 0.94 : 0.9).add(0.08));

    material.transparent = true;
    material.depthTest = true;
    material.depthWrite = true;
    material.alphaTest = layer === 'stem' ? 0.18 : 0.08;
    material.alphaHash = params.alphaHash !== false;
    material.alphaToCoverage = params.alphaToCoverage === true;
    material.forceSinglePass = true;
    material.polygonOffset = true;
    material.polygonOffsetFactor = layer === 'stem' ? -0.8 : -1.15;
    material.polygonOffsetUnits = layer === 'stem' ? -0.8 : -1.15;
    material.colorNode = flowerColor;
    material.opacityNode = saturate(alpha);
    material.emissiveNode = layer === 'stem'
        ? flowerColor.mul(0.06)
        : flowerColor.mul(centerMask).mul(1.8).add(flowerColor.mul(0.25));

    return {
        material,
        uniforms: {
            uTime,
            uWindStrength,
            uFogColor,
            uFogNear,
            uFogFar,
            uGlowStrength,
            uSunDirection,
        },
    };
}

export function createFlowerHeadMaterial(params = {}) {
    return createFlowerMaterial({
        ...params,
        layer: 'head',
    });
}

export function createFlowerStemMaterial(params = {}) {
    return createFlowerMaterial({
        ...params,
        layer: 'stem',
    });
}
