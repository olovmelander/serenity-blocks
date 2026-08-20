/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Ocean Theme — TSL Node Material Factories
 *
 * Each factory returns { material, uniforms } following the black-hole-materials.js pattern.
 * WebGPU only — the legacy ShaderMaterial paths remain in ocean-theme.js for WebGL fallback.
 */

import * as THREE from 'three';
import {
    AdditiveBlending,
    DoubleSide,
    FrontSide,
    MeshBasicNodeMaterial,
    MeshStandardNodeMaterial,
} from 'three/webgpu';
import {
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    fract,
    length,
    max,
    mix,
    modelViewMatrix,
    normalize,
    normalWorld,
    positionLocal,
    positionGeometry,
    positionWorld,
    pow,
    sin,
    smoothstep,
    texture,
    uniform,
    uv,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    tslNoise,
    tslFbm,
    tslGerstnerSum,
    tslCausticProjection,
    tslDepthGradedFog,
    tslWarmCoolAttenuation,
} from './ocean-tsl-helpers.js';

// WS 4.1: tileable noise texture shared across material instances. Generated
// once at first use; replaces 6 procedural noise/hash calls per seabed
// fragment with cheap cache-friendly texture samples. Each channel carries
// uncorrelated white noise — bilinear filtering during sampling smooths it
// into continuous gradients that visually match the original tslNoise output.
let _sharedSeabedNoiseTexture = null;
function getSharedSeabedNoiseTexture() {
    if (_sharedSeabedNoiseTexture) return _sharedSeabedNoiseTexture;
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    // Deterministic hash so the texture is identical across reloads.
    const hash = (x, y, salt) => {
        const h = Math.sin(x * 12.9898 + y * 78.233 + salt * 31.7) * 43758.5453;
        return h - Math.floor(h);
    };
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const idx = (y * size + x) * 4;
            data[idx] = (hash(x, y, 1) * 255) | 0;
            data[idx + 1] = (hash(x, y, 2) * 255) | 0;
            data[idx + 2] = (hash(x, y, 3) * 255) | 0;
            data[idx + 3] = (hash(x, y, 4) * 255) | 0;
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    _sharedSeabedNoiseTexture = tex;
    return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Water Surface
// ─────────────────────────────────────────────────────────────────────────────

export function createWaterSurfaceNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
    });

    const uTime = uniform(0);
    const uWaveIntensity = uniform(params.waveIntensity ?? 1.0);
    // Surface-local shimmer only. Real screen-space refraction is applied in OceanPost
    // where the resolved scene texture is available without feedback artifacts.
    const uSurfaceShimmerStrength = uniform(params.surfaceShimmerStrength ?? 0.35);
    const uSunCenter = uniform(params.sunCenter ?? new THREE.Vector2(-12, -100));
    const uSunRadius = uniform(params.sunRadius ?? 46);
    const uSunApertureStrength = uniform(params.sunApertureStrength ?? 1.0);

    const posXZ = positionLocal.xz;
    const wave = tslGerstnerSum(posXZ, uTime);

    // Displacement
    const displacement = wave.y
        .add(tslNoise(posXZ.mul(0.08).add(uTime.mul(0.3))).mul(0.4))
        .mul(uWaveIntensity);
    const displacedPosition = positionLocal.add(
        vec3(wave.x.mul(0.3), displacement.mul(1.5), wave.z.mul(0.3)),
    );

    // Colors — saturated tropical-blue palette matching the reference reef photo.
    // Lifted from teal/cyan into a brighter, more vibrant blue so the water column
    // reads as a sunlit shallow reef rather than a moody mid-depth.
    const deepColor = vec3(0.04, 0.32, 0.52);
    const midColor = vec3(0.12, 0.56, 0.72);
    const surfaceColor = vec3(0.32, 0.78, 0.86);
    const crestColor = vec3(0.47, 0.87, 0.82);

    const heightFactor = clamp(displacement.mul(1.5).add(0.5), float(0.0), float(1.0));

    let color = mix(deepColor, midColor, float(0.6));
    color = mix(color, surfaceColor, float(0.68));
    color = mix(color, crestColor, heightFactor.mul(0.32));

    // Fresnel — view-dependent rim that brightens edges of waves
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    // The surface is DoubleSide and viewed from below. Use the facing-agnostic
    // cosine so normal incidence stays transparent and only grazing angles
    // receive the Fresnel lift.
    const fresnel = pow(
        float(1.0).sub(abs(dot(normalWorld, viewDir))),
        float(2.5),
    );
    color = color.add(crestColor.mul(fresnel.mul(0.2)));

    // Two animated texture taps form the surface shimmer. This replaces three
    // broad procedural caustic graphs while retaining a subtle chromatic split.
    const refractOffset = vec2(wave.x, wave.z).mul(uSurfaceShimmerStrength.mul(0.35));
    const surfaceNoiseTex = getSharedSeabedNoiseTexture();
    const surfaceUv = positionWorld.xz.mul(0.0175);
    const shimmerA = texture(
        surfaceNoiseTex,
        surfaceUv.add(refractOffset.mul(0.018)).add(vec2(uTime.mul(0.006), uTime.mul(-0.004))),
    ).r;
    const shimmerB = texture(
        surfaceNoiseTex,
        surfaceUv.mul(1.37).sub(refractOffset.mul(0.014)).add(vec2(uTime.mul(-0.0045), uTime.mul(0.0055))),
    ).g;
    const causticBase = pow(abs(shimmerA.sub(shimmerB)), float(2.35));
    const causticChroma = vec3(
        causticBase.mul(1.08),
        causticBase,
        causticBase.mul(0.94),
    );
    color = color.add(crestColor.mul(causticBase.mul(0.22)));
    color = color.add(causticChroma.mul(uSurfaceShimmerStrength.mul(0.075)));

    // Near-white surface opening: integrated into the existing water draw so
    // every tier keeps the same focal hierarchy without another pass.
    const sunDistance = length(positionWorld.xz.sub(uSunCenter)).div(uSunRadius);
    const sunBody = float(1.0).sub(smoothstep(float(0.05), float(1.0), sunDistance));
    const sunCore = float(1.0).sub(smoothstep(float(0.0), float(0.28), sunDistance));
    const sunSparkle = causticBase.mul(sunBody).mul(0.42);
    const sunEnergy = sunBody.mul(0.58).add(sunCore.mul(1.42)).add(sunSparkle)
        .mul(uSunApertureStrength);
    const sunColor = mix(
        vec3(0.22, 0.88, 1.0),
        vec3(1.0, 0.92, 0.68),
        sunCore.mul(0.82).add(causticBase.mul(0.1)),
    );
    color = color.add(sunColor.mul(sunEnergy));

    // Foam at crests
    const foam = smoothstep(float(0.35), float(0.65), displacement);
    const foamColor = vec3(0.78, 0.96, 0.9);
    color = mix(color, foamColor, foam.mul(0.18));

    // Edge fade — slight contraction with refraction strength so refraction
    // doesn't artifact at the plane border.
    const distFromCenter = length(uv().sub(0.5)).mul(2.0);
    const edgeFade = float(1.0).sub(smoothstep(float(0.75), float(1.0), distFromCenter));
    const alpha = edgeFade.mul(float(0.3).add(sunBody.mul(uSunApertureStrength).mul(0.34)));

    material.colorNode = color;
    material.positionNode = displacedPosition;
    material.opacityNode = alpha;
    // Keep foam restrained; reserve most HDR energy for the surface aperture.
    // Ocean uses color-source bloom (not selective MRT), so adding the same
    // aperture to emissive doubles its energy before bloom. Keep the HDR crown
    // in colorNode and let the composite pass extract it once.
    material.emissiveNode = vec3(0.0);

    material.userData = {
        uTime,
        uWaveIntensity,
        uSurfaceShimmerStrength,
        uSunCenter,
        uSunRadius,
        uSunApertureStrength,
    };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seabed
// ─────────────────────────────────────────────────────────────────────────────

export function createSeabedNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial();

    const uTime = uniform(0);
    const uRippleStrength = uniform(params.rippleStrength ?? 2.4);
    const uCausticStrength = uniform(params.causticStrength ?? 1.10);
    const detailLevel = String(params.detailLevel || 'High');
    const lowDetail = detailLevel === 'Minimal' || detailLevel === 'Low';
    const extremeDetail = detailLevel === 'Extreme';

    // Warm peach-cream sandbed — pushed further toward the reference reef-canyon
    // photo's warm sun-baked sand. Previous (0.34, 0.40, 0.46) shadow read as
    // cool grey/snow under the god-ray bloom; warming the shadows toward a
    // peach undertone fixes the "icy beach" look.
    const sandShadow = vec3(0.30, 0.17, 0.12);
    const sandMid = vec3(0.68, 0.42, 0.27);
    const sandLit = vec3(0.94, 0.68, 0.44); // Warm shell highlight on ripple crests
    const reefShelf = vec3(0.08, 0.21, 0.27);

    const height = positionWorld.y;
    const hf = smoothstep(float(-25.0), float(10.0), height);
    let color = mix(sandShadow, sandMid, hf);

    // Procedural sand ripple bands — shared height field fuels both colour modulation
    // and an analytic per-fragment normal so ripple sides catch/lose light directionally.
    const currentDirNode = vec2(0.22, 0.97);
    const seabedNoiseTex = getSharedSeabedNoiseTexture();
    // The data texture contains 256 value-noise cells per UV repeat. Convert
    // the old analytic-noise frequencies into texture UVs; sampling at the
    // raw frequency would make the texture 256x denser and produce severe
    // shimmer/moire across the seabed.
    const noiseTexelScale = float(1.0 / 256.0);

    const rippleHeight = (xz) => {
        // Perturb the coordinates using low frequency noise
        let perturbed = xz;
        if (!lowDetail) {
            const warp = texture(
                seabedNoiseTex,
                xz.mul(float(0.015).mul(noiseTexelScale)),
            ).r.sub(0.5).mul(7.0);
            perturbed = xz.add(warp);
        }

        // Phase of the sand waves aligned to the current
        const theta = dot(perturbed, currentDirNode).mul(0.88);

        // Skewed asymmetric wave profile: sin(theta - 0.45 * sin(theta))
        const skewedWave = sin(theta.sub(float(0.45).mul(sin(theta))))
            .mul(0.5)
            .add(0.5);

        // Layer medium scale ripples
        const thetaMed = dot(perturbed, currentDirNode).mul(0.38);
        const skewedMed = sin(thetaMed.sub(float(0.4).mul(sin(thetaMed))))
            .mul(0.5)
            .add(0.5);

        // Mix waves and add high-frequency noise
        let microVariation = float(0.0);
        if (!lowDetail) {
            microVariation = texture(
                seabedNoiseTex,
                xz.mul(float(0.13).mul(noiseTexelScale)),
            ).g.mul(0.12);
        }
        return skewedWave.mul(0.7).add(skewedMed.mul(0.3)).add(microVariation);
    };

    const pxz = positionWorld.xz;
    const eps = float(0.35);
    const h0 = rippleHeight(pxz);
    const hx = rippleHeight(pxz.add(vec2(eps, float(0.0))));
    const hz = rippleHeight(pxz.add(vec2(float(0.0), eps)));

    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);
    const rippleFalloff = float(1.0).sub(smoothstep(float(90.0), float(190.0), viewDist));
    const rippleN = uRippleStrength.mul(rippleFalloff);

    const rippleNormal = normalize(vec3(
        h0.sub(hx).mul(rippleN),
        float(1.0),
        h0.sub(hz).mul(rippleN),
    ));
    const litNormal = normalize(mix(normalWorld, rippleNormal, float(0.88)));

    // High-frequency sand grain normal perturbation.
    // WS 4.1: bake-once tileable noise texture replaces 3× tslNoise (grain) +
    // 1× tslNoise (microGrit) + 2× tslHash (sparkle) calls with cheap texture
    // samples. Sample frequency chosen so each noise wavelength spans ~4-8
    // texels — bilinear filtering then matches the visual density of the
    // original procedural noise. Channels: R=grain, G=microGrit, B=sparklePhase,
    // A=sparkleIntensity. Sample wrap via RepeatWrapping (set on the DataTexture).
    const grainEps = float(0.08);
    // World→UV factor for grain: matches the original 22 Hz feature density.
    const grainUvScale = float(22.0 / 256.0);
    const grainUv0 = pxz.mul(grainUvScale);
    const detailTexel = texture(seabedNoiseTex, grainUv0);
    const g0 = detailTexel.r;

    // Micro normal contribution (decreases at distance to prevent aliasing)
    // WS 2.2: tightened fade range (20→40 instead of 35→75) — the sub-pixel
    // grain/sparkle is invisible past ~40m anyway, so cutting earlier lets the
    // GPU dead-code-eliminate the dependent micro-color math on most pixels.
    const microFalloff = float(1.0).sub(smoothstep(float(20.0), float(40.0), viewDist));
    // Keep the grain below the silhouette scale of the broad dune ripples.
    // Stronger values turn into unstable, carpet-like aliasing at gameplay
    // distance and hide the authored current direction.
    const grainN = float(0.055).mul(microFalloff);
    let grainNormal = vec3(0.0);
    if (!lowDetail) {
        const gx = texture(
            seabedNoiseTex,
            grainUv0.add(vec2(grainEps.mul(grainUvScale), float(0.0))),
        ).r;
        const gz = texture(
            seabedNoiseTex,
            grainUv0.add(vec2(float(0.0), grainEps.mul(grainUvScale))),
        ).r;
        grainNormal = vec3(
            g0.sub(gx).mul(grainN),
            float(0.0),
            g0.sub(gz).mul(grainN),
        );
    }
    const finalNormal = normalize(litNormal.add(grainNormal));

    // Ripple crest warmth — only where the analytic normal faces the sun do we lift
    // toward warm shell-sand, giving the photo's directional ridge highlight.
    const lightDir = normalize(vec3(-0.1, 0.9, -0.42));
    const ridgeWarmth = pow(max(dot(rippleNormal, lightDir), float(0.0)), float(2.4));

    const terraceBands = sin(positionWorld.z.mul(0.19).add(positionWorld.x.mul(0.035)))
        .mul(0.5)
        .add(0.5);
    const reefShelfMask = smoothstep(float(0.56), float(0.95), terraceBands)
        .mul(smoothstep(float(-23.0), float(-8.0), height));
    color = color.add(reefShelf.mul(reefShelfMask.mul(0.10)));

    // 1. Procedural silt & sediment channels (organic brown/grey patches)
    const siltColor = vec3(0.31, 0.25, 0.21);
    const siltNoise = texture(
        seabedNoiseTex,
        positionWorld.xz.mul(float(0.012).mul(noiseTexelScale)),
    ).b;
    let siltWeight = smoothstep(float(0.38), float(0.7), siltNoise).mul(0.24);

    // Stoss / Lee shading adjustments based on alignment with dominant current direction
    const stossAlign = dot(rippleNormal.xz, currentDirNode);

    // Lee side (deposition of organic silt)
    const leeWeight = smoothstep(float(-0.55), float(-0.02), stossAlign.negate());
    siltWeight = clamp(siltWeight.add(leeWeight.mul(0.12)), float(0.0), float(0.34));
    color = mix(color, siltColor, siltWeight);

    // Stoss side (erosion of silt, clean sand facing the flow)
    const stossWeight = smoothstep(float(0.02), float(0.45), stossAlign);

    // 2. Deep ripple valley shadowing (darken troughs, highlight crests)
    const h0Clamped = clamp(h0, float(0.0), float(1.0));
    const rippleValleyDarkening = mix(float(0.78), float(1.0), h0Clamped);
    color = color.mul(rippleValleyDarkening);

    // 3. Micro-grit color overlay
    const sandGrainNoise = detailTexel.r;
    color = color.mul(float(0.975).add(sandGrainNoise.mul(0.045)));
    // WS 4.1: microGrit from the G channel of the shared seabed noise texture.
    // freq 48 maps to ~5 texels/cycle which preserves the original gritty look.
    const microGrit = lowDetail
        ? detailTexel.g
        : texture(seabedNoiseTex, positionWorld.xz.mul(float(48.0 / 256.0))).g;
    // WS 2.2: gate micro-grit color modulation by the same near-field falloff.
    color = color.mul(float(0.985).add(microGrit.mul(float(0.025).mul(microFalloff))));

    // Ripple crest warmth & stoss exposure highlights
    color = mix(color, sandLit, ridgeWarmth.mul(0.46).add(stossWeight.mul(0.28)));

    // Caustics: focused on the stoss slopes and crests, and faded in the troughs
    const causticUv = positionWorld.xz.mul(float(0.13 / 256.0));
    const causticA = texture(
        seabedNoiseTex,
        causticUv.add(vec2(uTime.mul(0.018), uTime.mul(0.011))),
    ).a;
    let caustic = abs(causticA.sub(0.5)).mul(2.0);
    if (!lowDetail) {
        const causticB = texture(
            seabedNoiseTex,
            causticUv.mul(1.37).add(vec2(uTime.mul(-0.014), uTime.mul(0.019))),
        ).b;
        caustic = abs(causticA.sub(causticB)).mul(1.65).clamp(0.0, 1.0);
    }
    caustic = pow(caustic, float(3.2));
    const sharpCaustic = pow(caustic, float(1.4));
    const causticHeightMod = mix(float(0.45), float(1.0), h0Clamped);
    const causticSlopeMod = mix(float(0.6), float(1.0), smoothstep(float(-0.25), float(0.25), stossAlign));
    const causticIntensity = sharpCaustic.mul(causticHeightMod).mul(causticSlopeMod);
    const causticFalloff = float(1.0).sub(smoothstep(float(80.0), float(220.0), viewDist));
    const causticGain = uCausticStrength.mul(causticFalloff);
    const causticColor = vec3(0.52, 0.76, 0.66)
        .mul(causticIntensity)
        .mul(causticGain)
        .mul(0.24);

    // Specular lighting on wet/crystalline sand
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const halfVector = normalize(lightDir.add(viewDir));
    const specularDot = max(dot(finalNormal, halfVector), float(0.0));
    const specular = pow(specularDot, float(26.0)).mul(0.1).mul(rippleFalloff);
    const specularColor = vec3(0.9, 0.98, 0.95).mul(specular);

    // Twinkling, view-dependent glinting sparkles.
    // WS 4.1: sparkle phase from B channel, intensity from A channel of the
    // shared seabed noise texture. Sample frequencies match the original
    // 12 Hz / 24 Hz density (texels-per-cycle ratio tuned for visual parity).
    let sparkleColor = vec3(0.0);
    if (extremeDetail) {
        const sparklePhase = texture(
            seabedNoiseTex,
            positionWorld.xz.mul(float(12.0 / 256.0)),
        ).b;
        const twinkle = sin(uTime.mul(2.2).add(sparklePhase.mul(6.28)));
        const viewGlint = dot(viewDir, finalNormal);
        const sparkleSrc = texture(
            seabedNoiseTex,
            positionWorld.xz.mul(float(24.0 / 256.0)),
        ).a;
        const sparkle = pow(sparkleSrc, float(14.0))
            .mul(twinkle.mul(0.5).add(0.5))
            .mul(float(1.0).add(viewGlint.mul(0.5)));
        sparkleColor = vec3(0.95, 0.98, 0.88)
            .mul(sparkle)
            .mul(0.045)
            .mul(microFalloff);
    }

    // Diffuse lighting via the ripple-perturbed normal — lit/shadow sides on every band.
    const light = max(float(0.58), dot(finalNormal, lightDir));
    color = color.mul(light);

    // Height-based Ambient Occlusion (crevices and deep valleys are darker)
    const heightFactorAO = smoothstep(float(-25.0), float(8.0), height);
    const heightAO = mix(float(0.82), float(1.0), heightFactorAO);
    color = color.mul(heightAO);

    // Depth-based color absorption (deeper is darker blue/green tint)
    const depthFactor = smoothstep(float(-35.0), float(10.0), height);
    color = mix(color.mul(vec3(0.96, 0.98, 1.0)), color, depthFactor);

    // Light transport contributions belong after diffuse/occlusion so caustic
    // lines and wet-sand glints stay readable instead of being darkened twice.
    color = color.add(causticColor).add(specularColor).add(sparkleColor);

    color = tslDepthGradedFog(color, height, viewDist, float(1.0));

    material.colorNode = color;
    material.emissiveNode = vec3(0.0); // No bloom contribution

    material.userData = { uTime, uRippleStrength, uCausticStrength };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seaweed (instanced)
// ─────────────────────────────────────────────────────────────────────────────

export function createSeaweedNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uCurrentStrength = uniform(params.currentStrength ?? 0.5);

    const aHeight = attribute('aHeight');
    const aPhase = attribute('aPhase');
    const aColorVar = attribute('aColorVar');
    const aBladeWidth = attribute('aBladeWidth');
    const aBladeType = attribute('aBladeType');
    const heightSq = aHeight.mul(aHeight);
    const ribbonMask = smoothstep(float(0.55), float(1.35), aBladeType);
    const accentMask = smoothstep(float(1.45), float(2.05), aBladeType);
    const bladeFlutter = sin(aHeight.mul(18.0).add(aPhase)).mul(aHeight).mul(ribbonMask.mul(0.035));

    const phaseX = uTime.mul(1.1).add(aPhase).add(aHeight.mul(4.5));
    const primarySway = sin(phaseX)
        .mul(heightSq)
        .mul(uCurrentStrength)
        .mul(float(1.12).add(ribbonMask.mul(0.22)));
    const phaseZ = uTime.mul(1.58).add(aPhase.mul(0.8)).add(aHeight.mul(6.2));
    const crossFlutter = cos(phaseZ)
        .mul(heightSq)
        .mul(uCurrentStrength)
        .mul(float(0.18).add(ribbonMask.mul(0.05)));
    const swayX = primarySway.mul(0.22).sub(crossFlutter.mul(0.976));
    const swayZ = primarySway.mul(0.976).add(crossFlutter.mul(0.22));

    // Colors
    const base = vec3(0.06, 0.28, 0.20);
    const mid = vec3(0.24, 0.55, 0.22);
    const tip = vec3(0.68, 0.82, 0.24);

    let color = mix(base, mid, smoothstep(float(0.0), float(0.5), aHeight));
    color = mix(color, tip, smoothstep(float(0.5), float(1.0), aHeight));
    const ribbonTint = vec3(0.1, 0.44, 0.32);
    const grassTint = vec3(0.06, 0.32, 0.2);
    color = mix(color, ribbonTint, ribbonMask.mul(0.24));
    color = mix(color, grassTint, accentMask.mul(0.18));
    color = color.mul(float(0.82).add(aColorVar.mul(0.34)));

    // SSS warm backlight at tips
    const sssStrength = pow(aHeight, float(2.0)).mul(0.24);
    const sssColor = vec3(0.18, 0.42, 0.18);
    color = color.add(sssColor.mul(sssStrength));

    // Dense blades rely on height tint and warm tip backlight. Keeping broad
    // procedural caustics on the seabed avoids repeating the noise graph over
    // thousands of overlapping transparent-width blade fragments.
    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);

    color = tslDepthGradedFog(color, positionWorld.y, viewDist, float(1.05));

    material.colorNode = color;
    material.positionNode = positionLocal
        .add(vec3(positionGeometry.x.mul(aBladeWidth.sub(1.0)).add(bladeFlutter), float(0.0), float(0.0)))
        .add(vec3(swayX, float(0.0), swayZ));
    material.emissiveNode = vec3(0.0);

    material.userData = { uTime, uCurrentStrength };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seagrass Meadow (low ground-cover tufts)
// ─────────────────────────────────────────────────────────────────────────────

export function createSeagrassMeadowNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uCurrentStrength = uniform(params.currentStrength ?? 0.5);

    const aHeight = attribute('aHeight');
    const aPhase = attribute('aPhase');
    const aColorVar = attribute('aColorVar');

    // Reference organic sway equations
    const heightSq = aHeight.mul(aHeight);
    const phaseX = uTime.mul(1.1).add(aPhase).add(aHeight.mul(4.5));
    const primarySway = sin(phaseX).mul(heightSq).mul(uCurrentStrength).mul(1.0);
    const phaseZ = uTime.mul(1.62).add(aPhase.mul(0.8)).add(aHeight.mul(6.0));
    const crossFlutter = cos(phaseZ).mul(heightSq).mul(uCurrentStrength).mul(0.17);
    const swayX = primarySway.mul(0.22).sub(crossFlutter.mul(0.976));
    const swayZ = primarySway.mul(0.976).add(crossFlutter.mul(0.22));

    // Reference organic olive green to light gold-green palette.
    const base = vec3(0.18, 0.42, 0.20);
    const mid = vec3(0.35, 0.65, 0.28);
    const tip = vec3(0.72, 0.88, 0.35);

    let color = mix(base, mid, smoothstep(float(0.0), float(0.5), aHeight));
    color = mix(color, tip, smoothstep(float(0.5), float(1.0), aHeight));
    color = color.mul(float(0.85).add(aColorVar.mul(0.3)));

    // Diffuse lighting based on vertex normal
    const lightDir = normalize(vec3(-0.1, 0.9, -0.42));
    const diffuse = max(float(0.24), dot(normalWorld, lightDir));
    color = color.mul(diffuse);

    // Subsurface Scattering (translucency) at the tips
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const sssDot = clamp(dot(viewDir.negate(), lightDir), float(0.0), float(1.0));
    const sssStrength = pow(aHeight, float(2.0)).mul(sssDot).mul(0.38);
    const sssColor = vec3(0.4, 0.88, 0.3);
    color = color.add(sssColor.mul(sssStrength));

    // Seabed caustics show through this sparse geometry; the blade shader can
    // stay focused on sway, diffuse response, and cheap tip backscatter.
    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);

    // Depth-graded fog wash to blend seagrass into the deep water column
    color = tslDepthGradedFog(color, positionWorld.y, viewDist, float(1.05));

    material.colorNode = color;
    material.positionNode = positionLocal.add(vec3(swayX, float(0.0), swayZ));
    material.emissiveNode = vec3(0.0);

    material.userData = { uTime, uCurrentStrength };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coral
// ─────────────────────────────────────────────────────────────────────────────

export function createCoralNodeMaterial(baseColor) {
    const material = new MeshBasicNodeMaterial({
        // WS B2: coral overgrowth + procedural hero/carpet fallbacks are static
        // scenery; backfaces never visible from the camera path.
        side: FrontSide,
    });

    const uTime = uniform(0);
    const uGlowIntensity = uniform(0.8);
    const tintColor = uniform(baseColor);

    const pattern = tslFbm(
        positionWorld.xz.mul(0.32).add(vec2(positionWorld.y.mul(0.1), positionWorld.y.mul(0.07))),
        2,
    );
    let color = tintColor.mul(float(0.98).add(pattern.mul(0.18)));

    // Base AO — bottom 35% of the coral's local Y darkens toward a deep sand-shadow
    // tint so colonies appear anchored to the seabed instead of floating.
    const aoMask = float(1.0).sub(smoothstep(float(0.0), float(0.35), positionLocal.y));
    const aoColor = vec3(0.035, 0.09, 0.12);
    color = mix(color, aoColor, aoMask.mul(0.44));

    // Painterly Abzu rim: warm pink/gold lift on grazing angles.
    const warmBase = vec3(1.0, 0.62, 0.38);
    const coolRim = vec3(0.18, 0.72, 0.64);
    const rim = pow(float(1.0).sub(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))))), float(1.8));
    color = color.add(warmBase.mul(rim.mul(0.22)));

    // WS B1: tip-glow on upward-facing surfaces moves from emissiveNode into
    // colorNode. The bright tips still appear in the rendered color; they
    // just stop dumping pixels into MRT emissive, which is sampled 14× per
    // pixel by the post-processing god-ray Loop. This was the dominant cost
    // contributor for coral overgrowth, carpets, and procedural hero coral.
    const tipGlow = pow(max(normalWorld.y, float(0.0)), float(4.5)).mul(
        float(0.32).add(uGlowIntensity.mul(0.075)),
    );
    const tipColor = tintColor.add(coolRim.mul(0.12)).mul(tipGlow);

    material.colorNode = color.add(tipColor);
    const flex = smoothstep(float(0.25), float(2.4), positionGeometry.y);
    const currentWave = sin(
        uTime.mul(0.82)
            .add(positionWorld.x.mul(0.045))
            .add(positionWorld.z.mul(0.034)),
    ).mul(flex.mul(flex));
    // Placement rides positionLocal.add(delta): identical on r181 (the instance
    // matrix applies after positionNode) and correct on r185 (positionLocal is
    // post-instance there; a positionGeometry-only output collapses instances).
    material.positionNode = positionLocal.add(
        vec3(currentWave.mul(0.13), float(0.0), currentWave.mul(0.34)),
    );
    material.emissiveNode = vec3(0);

    material.userData = { uTime, uGlowIntensity };
    return material;
}

// WS 4.2: per-instance-color variant for coral overgrowth. Reads tint from an
// `aInstanceColor` InstancedBufferAttribute (vec3) so 5 separate color buckets
// (×4 geometries = 20 InstancedMeshes/rock-cluster) consolidate to 4 meshes
// total. Same visual: just substitute the uniform with the attribute.
export function createCoralOvergrowthNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        side: FrontSide,
    });

    const uTime = uniform(0);
    const uGlowIntensity = uniform(0.8);
    const aInstanceColor = attribute('aInstanceColor');

    const pattern = tslFbm(
        positionWorld.xz.mul(0.32).add(vec2(positionWorld.y.mul(0.1), positionWorld.y.mul(0.07))),
        2,
    );
    let color = aInstanceColor.mul(float(0.98).add(pattern.mul(0.18)));

    const aoMask = float(1.0).sub(smoothstep(float(0.0), float(0.35), positionLocal.y));
    const aoColor = vec3(0.035, 0.09, 0.12);
    color = mix(color, aoColor, aoMask.mul(0.44));

    const warmBase = vec3(1.0, 0.62, 0.38);
    const coolRim = vec3(0.18, 0.72, 0.64);
    const rim = pow(float(1.0).sub(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))))), float(1.8));
    color = color.add(warmBase.mul(rim.mul(0.22)));

    const tipGlow = pow(max(normalWorld.y, float(0.0)), float(4.5)).mul(
        float(0.32).add(uGlowIntensity.mul(0.075)),
    );
    const tipColor = aInstanceColor.add(coolRim.mul(0.12)).mul(tipGlow);

    material.colorNode = color.add(tipColor);
    const flex = smoothstep(float(0.25), float(2.4), positionGeometry.y);
    const currentWave = sin(
        uTime.mul(0.82)
            .add(positionWorld.x.mul(0.045))
            .add(positionWorld.z.mul(0.034)),
    ).mul(flex.mul(flex));
    material.positionNode = positionLocal.add(
        vec3(currentWave.mul(0.13), float(0.0), currentWave.mul(0.34)),
    );
    material.emissiveNode = vec3(0);

    material.userData = { uTime, uGlowIntensity };
    return material;
}

/**
 * One dielectric material for the modular BatchedMesh coral family. BatchedMesh
 * multiplies colorNode by its per-instance color texture in r181, so this graph
 * only supplies lighting/attenuation and tip-flex motion.
 */
export function createModularCoralNodeMaterial() {
    const material = new MeshStandardNodeMaterial({
        color: 0xffffff,
        roughness: 0.78,
        metalness: 0.0,
        side: FrontSide,
    });
    const uTime = uniform(0);
    const uCurrentStrength = uniform(0.5);
    const aFlex = attribute('aFlex');
    const flex = aFlex.mul(aFlex);
    const spatialPhase = positionGeometry.x.mul(0.047).add(positionGeometry.z.mul(0.036));
    const primary = sin(uTime.mul(0.72).add(spatialPhase))
        .mul(flex)
        .mul(uCurrentStrength)
        .mul(0.34);
    const flutter = sin(uTime.mul(1.46).sub(spatialPhase.mul(0.76)).add(aFlex.mul(3.2)))
        .mul(flex)
        .mul(uCurrentStrength)
        .mul(0.055);
    // Portable base: on r181 the BatchedMesh transform applies AFTER positionNode
    // (positionLocal here is raw geometry); on r185 it applies BEFORE and this
    // output is final. positionLocal.add(...) keeps colony placement on both;
    // a positionGeometry-only output would collapse the batch on r185.
    material.positionNode = positionLocal.add(vec3(
        primary.mul(0.22).sub(flutter.mul(0.976)),
        float(0.0),
        primary.mul(0.976).add(flutter.mul(0.22)),
    ));

    const viewDistance = length(cameraPosition.sub(positionWorld));
    const upLight = normalWorld.y.mul(0.5).add(0.5);
    const valueShape = vec3(float(0.94).add(upLight.mul(0.15)));
    material.colorNode = tslWarmCoolAttenuation(
        valueShape,
        viewDistance,
        float(0.82),
    );
    // BatchedMesh exposes its per-colony tint through the vBatchColor varying;
    // r185 declares it as vec4 (r181 used vec3) and this declaration must
    // match the engine's type so both dedupe into the same varying.
    // A very low subsurface lift keeps saturated coral sides readable under
    // blue water without flattening the PBR key light or crossing bloom.
    const batchColor = varyingProperty('vec4', 'vBatchColor');
    material.emissiveNode = batchColor.rgb
        .mul(float(0.10).add(upLight.mul(0.04)));
    material.userData = {
        uTime,
        uCurrentStrength,
        modularCoralMaterial: true,
    };
    return material;
}

function safeBillboardRadialFalloff() {
    const d = length(uv().sub(0.5)).mul(2.0);
    return clamp(float(1.0).sub(d), float(0.0), float(1.0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Jellyfish
// ─────────────────────────────────────────────────────────────────────────────

export function createJellyfishNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uGlowIntensity = uniform(0.8);

    const aColor = attribute('aColor');
    const aPhase = attribute('aPhase');

    // Bell pulse
    const pulse = sin(uTime.mul(1.8).add(aPhase))
        .mul(0.25)
        .add(float(0.72).add(uGlowIntensity.mul(0.04)));
    // Dome shape
    const radial = safeBillboardRadialFalloff();
    const alpha = pow(radial, float(1.8)).mul(pulse);
    let color = aColor.mul(float(0.6).add(pulse.mul(0.5)));

    // Bright glowing center
    color = color.add(vec3(0.82, 1.0, 0.92).mul(pow(radial, float(5.0)).mul(0.34)));

    material.colorNode = color;
    material.opacityNode = alpha.mul(float(0.44).add(uGlowIntensity.mul(0.055)));
    // Emissive for bloom
    material.emissiveNode = color.mul(alpha.mul(float(0.48).add(uGlowIntensity.mul(0.08))));

    material.userData = { uTime, uGlowIntensity };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plankton
// ─────────────────────────────────────────────────────────────────────────────

export function createPlanktonNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uGlowIntensity = uniform(params.glowIntensity ?? 0.8);
    const uCurrentStrength = uniform(0.5);

    const aPhase = attribute('aPhase');
    // Twinkle
    const glow = sin(uTime.mul(0.72).add(aPhase.mul(3.5)))
        .mul(0.5)
        .add(0.5);
    const glowScaled = glow.mul(uGlowIntensity.mul(0.32));

    const radial = safeBillboardRadialFalloff();
    const alpha = pow(radial, float(2.8));

    const color = mix(vec3(0.015, 0.12, 0.14), vec3(0.11, 0.44, 0.38), glowScaled);

    // Emissive halo
    const halo = pow(radial, float(2.4));

    material.colorNode = color;
    material.opacityNode = alpha.mul(float(0.045).add(glowScaled.mul(0.16)));
    material.emissiveNode = color.mul(halo.mul(0.34));

    material.userData = { uTime, uGlowIntensity, uCurrentStrength };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bubbles
// ─────────────────────────────────────────────────────────────────────────────

export function createBubbleNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    // ── Unpacked from 2 packed instanced buffers (WebGPU 8-buffer limit) ──
    // aBubblePack1.xyzw = speed, phase, size, lifeOffset
    // aBubblePack2.xy   = columnSpread, micro
    const pack1 = attribute('aBubblePack1', 'vec4');
    const pack2 = attribute('aBubblePack2', 'vec2');
    const aSpeed = pack1.x;
    const aPhase = pack1.y;
    const aLifeOffset = pack1.w;
    const aMicro = pack2.y;

    const travel = fract(aLifeOffset.add(uTime.mul(aSpeed).mul(0.035)));

    // Ring shell + inner glass
    const localUv = uv();
    const d = length(localUv.sub(0.5)).mul(2.0);
    const vRing = float(0.78).add(sin(aPhase).mul(0.08));
    const shell = smoothstep(vRing.sub(0.12), vRing, d).mul(
        float(1.0).sub(smoothstep(vRing, float(1.0), d)),
    );
    const innerGlass = float(1.0)
        .sub(smoothstep(float(0.0), vRing.sub(0.15), d))
        .mul(0.08);
    const microCore = float(1.0)
        .sub(smoothstep(float(0.0), float(0.62), d))
        .mul(aMicro)
        .mul(0.3);

    // Highlight
    const highlightPos = localUv.sub(vec2(0.32, 0.28));
    const highlight = float(1.0).sub(smoothstep(float(0.0), float(0.18), length(highlightPos)));

    const color = vec3(0.52, 0.86, 1.0).mul(shell.add(innerGlass).add(microCore));
    const colorFinal = color.add(vec3(0.9, 1.0, 1.0).mul(highlight.mul(0.45)));

    const fade = smoothstep(float(0.0), float(0.12), travel).mul(
        float(1.0).sub(smoothstep(float(0.78), float(1.0), travel)),
    );
    const alpha = shell.mul(0.48).add(innerGlass.mul(0.74)).add(highlight.mul(0.15)).add(microCore.mul(0.72))
        .mul(fade);

    material.colorNode = colorFinal;
    material.opacityNode = alpha.mul(0.12);
    material.emissiveNode = vec3(0.0);

    material.userData = { uTime };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gameplay Reactions — pooled lock/combo transients
// ─────────────────────────────────────────────────────────────────────────────

export function createGameplayRippleNodeMaterial(params = {}) {
    const isShockwave = params.variant === 'shockwave';
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const aBurstOpacity = attribute('aBurstOpacity');
    const uWarmth = uniform(params.warmth ?? (isShockwave ? 0.32 : 0.34));

    const localUv = uv();
    const centerDist = length(localUv.sub(0.5)).mul(2.0);
    let ring;
    let shimmer;
    let color;

    if (isShockwave) {
        // RingGeometry spans normalized radii 0.92..1.0. The old 0.70..0.86
        // mask never intersected the mesh, so every WebGPU shockwave was fully
        // transparent. This feather matches the actual geometry and adds the
        // phase-locked caustic-crown language proven in the playground.
        const inner = smoothstep(float(0.92), float(0.945), centerDist);
        const outer = float(1.0).sub(smoothstep(float(0.985), float(1.0), centerDist));
        ring = inner.mul(outer);
        const centered = localUv.sub(0.5);
        const angle = atan(centered.y, centered.x);
        const warpedAngle = angle.mul(11.0).add(
            sin(angle.mul(3.0).sub(uTime.mul(0.42))).mul(1.35),
        );
        const spokes = pow(abs(sin(warpedAngle.add(uTime.mul(0.55)))), float(13.0));
        const pearls = pow(abs(sin(angle.mul(5.0).sub(uTime.mul(1.15)))), float(24.0));
        const crown = spokes.mul(0.72).add(pearls.mul(0.34));
        shimmer = float(0.78).add(sin(centerDist.mul(34.0).sub(uTime.mul(5.4))).mul(0.12));
        const warmth = clamp(uWarmth.add(crown.mul(0.58)), float(0.0), float(1.0));
        color = mix(vec3(0.015, 0.50, 0.66), vec3(0.82, 0.38, 0.06), warmth).mul(
            ring.mul(shimmer).mul(float(0.46).add(crown.mul(0.34))),
        );
    } else {
        ring = smoothstep(float(0.24), float(0.52), centerDist).mul(
            float(1.0).sub(smoothstep(float(0.58), float(0.96), centerDist)),
        );
        shimmer = float(0.88).add(sin(centerDist.mul(18.0).sub(uTime.mul(3.2))).mul(0.12));
        color = mix(vec3(0.14, 0.56, 0.58), vec3(0.92, 0.72, 0.38), uWarmth).mul(
            ring.mul(shimmer),
        );
    }

    material.colorNode = color;
    material.opacityNode = ring.mul(aBurstOpacity).mul(1.0);
    material.emissiveNode = color.mul(aBurstOpacity.mul(isShockwave ? 1.1 : 0.45));

    material.userData = { uTime, aBurstOpacity, uWarmth };
    return material;
}

export function createGameplayShockwaveNodeMaterial(params = {}) {
    return createGameplayRippleNodeMaterial({ ...params, variant: 'shockwave' });
}

export function createGameplaySiltNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const aBurstOpacity = attribute('aBurstOpacity');
    const aLife = attribute('aLife');
    const aPhase = attribute('aPhase');

    const radial = safeBillboardRadialFalloff();
    const dustCore = pow(radial, float(1.8));
    const shimmer = float(0.92).add(sin(aPhase.add(uTime.mul(2.4))).mul(0.08));
    const color = mix(vec3(0.16, 0.22, 0.2), vec3(0.53, 0.45, 0.31), aLife.mul(0.5));

    material.colorNode = color.mul(dustCore);
    material.opacityNode = dustCore.mul(aLife).mul(aBurstOpacity).mul(0.55).mul(shimmer);
    material.emissiveNode = color.mul(dustCore).mul(aBurstOpacity.mul(0.18));

    material.userData = { uTime, aBurstOpacity };
    return material;
}

export function createGameplayBubbleNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const aBurstOpacity = attribute('aBurstOpacity');
    const aLife = attribute('aLife');
    const aPhase = attribute('aPhase');

    const shimmer = sin(uTime.mul(1.6).add(aPhase)).mul(0.08).add(1.0);
    const localUv = uv();
    const d = length(localUv.sub(0.5)).mul(2.0);
    const shell = smoothstep(float(0.66), float(0.84), d).mul(
        float(1.0).sub(smoothstep(float(0.84), float(1.0), d)),
    );
    const core = float(1.0)
        .sub(smoothstep(float(0.0), float(0.5), d))
        .mul(0.1);
    const highlightPos = localUv.sub(vec2(0.32, 0.28));
    const highlight = float(1.0).sub(smoothstep(float(0.0), float(0.18), length(highlightPos)));
    const alpha = shell.mul(0.6).add(core).add(highlight.mul(0.24)).mul(aLife)
        .mul(aBurstOpacity)
        .mul(shimmer);
    const color = vec3(0.58, 0.92, 1.0)
        .mul(shell.add(core))
        .add(vec3(0.92, 1.0, 1.0).mul(highlight.mul(0.36)));

    material.colorNode = color;
    material.opacityNode = alpha.mul(0.9);
    material.emissiveNode = color.mul(alpha.mul(0.32));

    material.userData = { uTime, aBurstOpacity };
    return material;
}

export function createGameplayCausticRibbonNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const aBurstOpacity = attribute('aBurstOpacity');
    const uWarmth = uniform(params.warmth ?? 0.25);
    const localUv = uv();

    const sideFade = smoothstep(float(0.0), float(0.12), localUv.x).mul(
        float(1.0).sub(smoothstep(float(0.88), float(1.0), localUv.x)),
    );
    const crossFade = smoothstep(float(0.0), float(0.16), localUv.y).mul(
        float(1.0).sub(smoothstep(float(0.72), float(1.0), localUv.y)),
    );
    const waveA = abs(sin(localUv.x.mul(28.0).add(localUv.y.mul(10.0)).sub(uTime.mul(2.2))));
    const waveB = abs(sin(localUv.x.mul(45.0).sub(uTime.mul(1.6))));
    const lace = pow(waveA.mul(waveB).mul(0.65).add(0.35), float(6.0));
    const mask = sideFade.mul(crossFade).mul(lace);
    const color = mix(vec3(0.1, 0.58, 0.58), vec3(1.0, 0.76, 0.38), uWarmth).mul(mask);

    material.colorNode = color;
    material.opacityNode = mask.mul(aBurstOpacity).mul(0.9);
    material.emissiveNode = color.mul(aBurstOpacity.mul(0.6));

    material.userData = { uTime, aBurstOpacity, uWarmth };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere — Volumetric Light Shafts (in-scene contributors to bloom)
// ─────────────────────────────────────────────────────────────────────────────

export function createVolumetricShaftNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uCurrentStrength = uniform(0.5);
    const uGlowIntensity = uniform(0.8);
    const uRayStrength = uniform(params.rayStrength ?? 1.0);

    const aSeed = attribute('aSeed');
    const aLayer = attribute('aLayer');

    const u = uv();
    const core = smoothstep(float(0.0), float(0.28), u.x).mul(
        float(1.0).sub(smoothstep(float(0.72), float(1.0), u.x)),
    );
    // Keep the complete surface-to-seabed column. The previous mask confined
    // energy to UV y 0.22-0.42, visually severing every beam from its source.
    const floorFade = smoothstep(float(0.0), float(0.15), u.y);
    const topWeight = mix(float(0.38), float(1.0), pow(u.y, float(0.58)));
    const streak = sin(
        u.y
            .mul(32.0)
            .add(uTime.mul(float(1.2).add(aLayer.mul(0.25))))
            .add(aSeed),
    );
    const fine = sin(u.x.mul(18.0).sub(uTime.mul(0.8)).add(aSeed.mul(1.7)));
    const shimmer = float(0.78).add(streak.mul(0.13)).add(fine.mul(0.07));
    const ray = core.mul(floorFade).mul(topWeight).mul(shimmer);

    // Distance fade — rough proxy via view-space depth
    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);
    const distanceFade = float(1.0).sub(smoothstep(float(90.0), float(280.0), viewDist));
    const currentPulse = float(0.86).add(uCurrentStrength.mul(0.08));

    const shaftColor = vec3(0.43, 0.91, 0.92);
    const warmColor = vec3(1.0, 0.86, 0.54);
    const colorBase = mix(shaftColor, warmColor, pow(u.y, float(2.8)).mul(0.46));
    const colorOut = colorBase.mul(float(0.82).add(uGlowIntensity.mul(0.1)));
    const alpha = ray.mul(distanceFade).mul(uRayStrength).mul(currentPulse).mul(0.54);

    material.colorNode = colorOut;
    material.opacityNode = alpha;
    // Shafts feed bloom + post god-ray amplifier — the brighter the source the
    // longer the post-FX shafts reach across the screen.
    material.emissiveNode = colorOut.mul(ray.mul(0.52));

    material.userData = {
        uTime,
        uCurrentStrength,
        uGlowIntensity,
        uRayStrength,
    };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere — Haze Layers (depth cueing, no bloom)
// ─────────────────────────────────────────────────────────────────────────────

export function createHazeLayerNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uCurrentStrength = uniform(0.5);
    const uGlowIntensity = uniform(0.8);
    const uHazeStrength = uniform(params.hazeStrength ?? 1.0);

    const u = uv();
    const flow = vec2(uTime.mul(float(0.018).add(uCurrentStrength.mul(0.006))), uTime.mul(0.012));
    const n1 = tslNoise(u.mul(vec2(4.0, 2.2)).add(flow));
    const n2 = tslNoise(u.mul(vec2(10.0, 4.0)).sub(flow.mul(1.8)));
    const body = smoothstep(float(0.05), float(0.75), n1.mul(0.7).add(n2.mul(0.3)));
    const edge = smoothstep(float(0.0), float(0.18), u.y).mul(
        float(1.0).sub(smoothstep(float(0.72), float(1.0), u.y)),
    );
    const sideFade = smoothstep(float(0.0), float(0.08), u.x).mul(
        float(1.0).sub(smoothstep(float(0.9), float(1.0), u.x)),
    );

    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);
    const distFade = smoothstep(float(24.0), float(190.0), viewDist);
    const alpha = body.mul(edge).mul(sideFade).mul(distFade).mul(uHazeStrength)
        .mul(0.034);

    const fogColor = vec3(0.05, 0.32, 0.54);
    const colorBase = mix(
        fogColor,
        vec3(0.08, 0.46, 0.65),
        float(0.38).add(uGlowIntensity.mul(0.045)),
    );

    material.colorNode = colorBase;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0); // Haze should NOT bloom

    material.userData = {
        uTime,
        uCurrentStrength,
        uGlowIntensity,
        uHazeStrength,
    };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere — Reef Silhouette (instanced rocks)
// ─────────────────────────────────────────────────────────────────────────────

export function createReefSilhouetteNodeMaterial() {
    const material = new MeshBasicNodeMaterial();

    const uTime = uniform(0);
    // Warm-stone reef-shelf palette — base stays cool blue-grey (rocks in
    // shadow), tops shift toward warm sandstone to match the reference photo
    // where direct god rays warm the upper surfaces of every shelf.
    const uLowColor = uniform(vec3(0.20, 0.18, 0.28));
    const uHighColor = uniform(vec3(0.70, 0.62, 0.48));

    const heightMix = smoothstep(float(-34.0), float(18.0), positionWorld.y);
    let color = mix(uLowColor, uHighColor, heightMix);

    const lightDir = normalize(vec3(0.1, 0.92, -0.22));
    const topLight = max(dot(normalWorld, lightDir), float(0.0));

    const striation = abs(sin(positionWorld.y.mul(0.72).add(positionWorld.x.mul(0.05))));
    // Bright sunlit highlights on top shelf surfaces
    color = color.mul(float(0.72).add(topLight.mul(0.58)));
    color = color.mul(float(0.86).add(striation.mul(0.10)));
    // Algae patches — FBM on upward-facing surfaces shifts toward warm moss green.
    const moss = tslFbm(positionWorld.xz.mul(0.18), 2).mul(pow(max(normalWorld.y, float(0.0)), float(1.6)));
    color = color.add(vec3(0.16, 0.36, 0.22).mul(moss.mul(0.32)));
    // Caustic shimmer only on upward-facing surfaces, kept dim so it doesn't bleach.
    const caustic = tslCausticProjection(positionWorld.xz, uTime, 0.115)
        .mul(pow(max(normalWorld.y, float(0.0)), float(1.2)));
    color = color.add(vec3(0.06, 0.18, 0.14).mul(caustic.mul(0.10)));

    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);
    color = tslDepthGradedFog(color, positionWorld.y, viewDist, float(0.55));

    material.colorNode = color;
    material.emissiveNode = vec3(0.0);

    material.userData = { uTime };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere — Beam Dust (point particles drifting in shafts)
// ─────────────────────────────────────────────────────────────────────────────

export function createBeamDustNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uCurrentStrength = uniform(0.5);

    const aPhase = attribute('aPhase');
    const pulse = float(0.5).add(sin(uTime.mul(0.5).add(aPhase)).mul(0.42));

    // WS A3: world-space drift computed in the vertex shader, eliminating the
    // 480-instance CPU loop in OceanAtmosphereSystem.updateBillboards(). The
    // instance matrix is static (translation only, identity rotation) so adding
    // to positionLocal is equivalent to adding in world space. Frequencies +
    // amplitudes match the previous CPU drift exactly.
    const driftX = sin(uTime.mul(0.11).add(aPhase))
        .mul(float(1.0).add(uCurrentStrength.mul(0.8)));
    const driftY = sin(uTime.mul(0.09).add(aPhase.mul(1.7))).mul(0.45);
    const driftZ = cos(uTime.mul(0.08).add(aPhase.mul(1.3))).mul(0.65);
    const drift = vec3(driftX, driftY, driftZ);

    // Instance matrices own billboard size. Scaling positionLocal here would
    // also scale the instance translation in r181 and fling dust out of view.
    material.positionNode = positionLocal.add(drift);

    const radial = safeBillboardRadialFalloff();
    const alpha = pow(radial, float(1.7)).mul(pulse);

    // Warm gold dominant so dust catches in god-ray shafts and reads as Abzu-style
    // light motes rather than generic cyan plankton.
    const color = mix(vec3(0.55, 0.78, 0.78), vec3(1.0, 0.86, 0.46), pulse.mul(0.55));

    material.colorNode = color;
    material.opacityNode = alpha.mul(0.32);
    // Light motes feed bloom so they pulse brighter inside the god rays.
    material.emissiveNode = color.mul(alpha.mul(0.85));

    material.userData = { uTime, uCurrentStrength };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere — Biome Silhouette (cliff-wall / kelp-curtain billboards)
// ─────────────────────────────────────────────────────────────────────────────

export function createBiomeSilhouetteNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uFogColor = uniform(vec3(0.018, 0.20, 0.32));
    const uSilhouetteColor = uniform(params.silhouetteColor ?? vec3(0.025, 0.13, 0.21));

    const u = uv();
    // FBM-driven silhouette mask: irregular cliff/kelp shape that's organic
    const noiseScale = vec2(2.6, 1.3);
    const animatedUv = u.mul(noiseScale).add(vec2(uTime.mul(0.012), float(0.0)));
    const shape = tslFbm(animatedUv, 4);
    // Mountain-ish profile: high at horizons, low at edges
    const verticalGradient = smoothstep(float(0.05), float(0.65), float(1.0).sub(u.y));
    const fade = smoothstep(float(0.0), float(0.18), u.x).mul(
        float(1.0).sub(smoothstep(float(0.82), float(1.0), u.x)),
    );
    const mask = smoothstep(float(0.32), float(0.62), shape).mul(verticalGradient).mul(fade);

    // Color: silhouette tone deepening into fog
    let color = mix(uFogColor, uSilhouetteColor, mask);
    // Subtle blue-shift on receding parts
    color = color.add(vec3(0.0, 0.02, 0.04).mul(mask));

    material.colorNode = color;
    material.opacityNode = mask.mul(0.55);
    material.emissiveNode = vec3(0.0);

    material.userData = { uTime };
    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Glow Anchors (atmosphere)
// ─────────────────────────────────────────────────────────────────────────────

export function createGlowAnchorNodeMaterial(params = {}) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uGlowIntensity = uniform(params.glowIntensity ?? 0.8);
    const uOpacityScale = uniform(params.opacityScale ?? 1.0);
    const uEmissiveScale = uniform(params.emissiveScale ?? 1.0);

    const aColor = attribute('aColor');
    const aPhase = attribute('aPhase');
    const pulse = float(0.76)
        .add(sin(uTime.mul(1.15).add(aPhase)).mul(0.18))
        .add(uGlowIntensity.mul(0.08));

    const radial = safeBillboardRadialFalloff();
    const core = pow(radial, float(4.0));
    const aura = pow(radial, float(1.7));

    const color = aColor.mul(core.mul(0.7).add(aura.mul(0.24))).mul(pulse);
    const alpha = aura.mul(0.07).mul(pulse);

    material.colorNode = color;
    material.opacityNode = alpha.mul(uOpacityScale);
    material.emissiveNode = color.mul(alpha.mul(0.45).mul(uEmissiveScale));

    material.userData = {
        uTime,
        uGlowIntensity,
        uOpacityScale,
        uEmissiveScale,
    };
    return material;
}
