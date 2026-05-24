/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Ocean Theme — TSL Node Material Factories
 *
 * Each factory returns { material, uniforms } following the black-hole-materials.js pattern.
 * WebGPU only — the legacy ShaderMaterial paths remain in ocean-theme.js for WebGL fallback.
 */

import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    fract,
    length,
    max,
    min,
    mix,
    modelViewMatrix,
    normalize,
    normalWorld,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    tslHash,
    tslNoise,
    tslFbm,
    tslGerstnerSum,
    tslCausticProjection,
    tslDepthGradedFog,
} from './ocean-tsl-helpers.js';

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
    const fresnel = pow(
        float(1.0).sub(max(dot(normalWorld.negate(), viewDir), float(0.0))),
        float(2.5),
    );
    color = color.add(crestColor.mul(fresnel.mul(0.2)));

    // ── Surface shimmer ──
    // Sample two slightly offset caustic patterns to create a chromatic surface cue.
    // The horizontal offset is driven by the wave horizontal displacement (wave.x/wave.z),
    // which is the "view through wavy water" cue. Doing this in 3 channels with slight
    // separation gives a subtle chromatic dispersion as in real underwater optics.
    const refractOffset = vec2(wave.x, wave.z).mul(uSurfaceShimmerStrength.mul(0.35));
    const causticBase = tslCausticProjection(positionWorld.xz, uTime, 0.15);
    const causticR = tslCausticProjection(
        positionWorld.xz.add(refractOffset.mul(1.2)),
        uTime,
        0.15,
    );
    const causticB = tslCausticProjection(
        positionWorld.xz.sub(refractOffset.mul(1.2)),
        uTime,
        0.15,
    );
    const causticChroma = vec3(causticR, causticBase, causticB);
    color = color.add(crestColor.mul(causticBase.mul(0.22)));
    color = color.add(causticChroma.mul(uSurfaceShimmerStrength.mul(0.075)));

    // Foam at crests
    const foam = smoothstep(float(0.35), float(0.65), displacement);
    const foamColor = vec3(0.78, 0.96, 0.9);
    color = mix(color, foamColor, foam.mul(0.18));

    // Edge fade — slight contraction with refraction strength so refraction
    // doesn't artifact at the plane border.
    const distFromCenter = length(uv().sub(0.5)).mul(2.0);
    const edgeFade = float(1.0).sub(smoothstep(float(0.75), float(1.0), distFromCenter));
    const alpha = edgeFade.mul(0.3);

    material.colorNode = color;
    material.positionNode = displacedPosition;
    material.opacityNode = alpha;
    // Tag foam as emissive for bloom (cap to avoid blowing out the screen)
    material.emissiveNode = min(foamColor.mul(foam.mul(0.28)), vec3(0.25));

    material.userData = { uTime, uWaveIntensity, uSurfaceShimmerStrength };
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

    // Warm peach-cream sandbed — pushed further toward the reference reef-canyon
    // photo's warm sun-baked sand. Previous (0.34, 0.40, 0.46) shadow read as
    // cool grey/snow under the god-ray bloom; warming the shadows toward a
    // peach undertone fixes the "icy beach" look.
    const sandShadow = vec3(0.68, 0.62, 0.52);
    const sandMid = vec3(0.88, 0.84, 0.74);
    const sandLit = vec3(0.98, 0.96, 0.88); // Bright shell-sand highlight on ripple crests
    const reefShelf = vec3(0.26, 0.36, 0.44);

    const height = positionWorld.y;
    const hf = smoothstep(float(-25.0), float(10.0), height);
    let color = mix(sandShadow, sandMid, hf);

    // Procedural sand ripple bands — shared height field fuels both colour modulation
    // and an analytic per-fragment normal so ripple sides catch/lose light directionally.
    const currentDirNode = vec2(0.22, 0.97);

    const rippleHeight = (xz) => {
        // Perturb the coordinates using low frequency noise
        const perturbed = xz.add(tslNoise(xz.mul(0.04)).mul(3.5));
        
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
        return skewedWave.mul(0.7).add(skewedMed.mul(0.3)).add(tslFbm(xz.mul(0.6), 2).mul(0.2));
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

    // High-frequency sand grain normal perturbation
    const grainEps = float(0.08);
    const grainFreq = float(22.0);
    const g0 = tslNoise(pxz.mul(grainFreq));
    const gx = tslNoise(pxz.add(vec2(grainEps, float(0.0))).mul(grainFreq));
    const gz = tslNoise(pxz.add(vec2(float(0.0), grainEps)).mul(grainFreq));

    // Micro normal contribution (decreases at distance to prevent aliasing)
    const microFalloff = float(1.0).sub(smoothstep(float(35.0), float(75.0), viewDist));
    const grainN = float(0.24).mul(microFalloff);
    const grainNormal = vec3(
        g0.sub(gx).mul(grainN),
        float(0.0),
        g0.sub(gz).mul(grainN),
    );
    const finalNormal = normalize(litNormal.add(grainNormal));

    // Ripple crest warmth — only where the analytic normal faces the sun do we lift
    // toward warm shell-sand, giving the photo's directional ridge highlight.
    const lightDir = normalize(vec3(0.16, 0.92, -0.18));
    const ridgeWarmth = pow(max(dot(rippleNormal, lightDir), float(0.0)), float(2.4));

    const terraceBands = sin(positionWorld.z.mul(0.19).add(positionWorld.x.mul(0.035)))
        .mul(0.5)
        .add(0.5);
    const reefShelfMask = smoothstep(float(0.56), float(0.95), terraceBands)
        .mul(smoothstep(float(-23.0), float(-8.0), height));
    color = color.add(reefShelf.mul(reefShelfMask.mul(0.18)));

    // 1. Procedural silt & sediment channels (organic brown/grey patches)
    const siltColor = vec3(0.38, 0.34, 0.28);
    const siltNoise = tslFbm(positionWorld.xz.mul(0.045), 3);
    let siltWeight = smoothstep(float(0.42), float(0.72), siltNoise).mul(0.68);

    // Stoss / Lee shading adjustments based on alignment with dominant current direction
    const stossAlign = dot(rippleNormal.xz, currentDirNode);

    // Lee side (deposition of organic silt)
    const leeWeight = smoothstep(float(-0.55), float(-0.02), stossAlign.negate());
    siltWeight = clamp(siltWeight.add(leeWeight.mul(0.45)), float(0.0), float(0.88));
    color = mix(color, siltColor, siltWeight);

    // Stoss side (erosion of silt, clean sand facing the flow)
    const stossWeight = smoothstep(float(0.02), float(0.45), stossAlign);

    // 2. Deep ripple valley shadowing (darken troughs, highlight crests)
    const h0Clamped = clamp(h0, float(0.0), float(1.0));
    const rippleValleyDarkening = mix(float(0.65), float(1.0), h0Clamped);
    color = color.mul(rippleValleyDarkening);

    // 3. Micro-grit color overlay
    const sandGrainNoise = tslFbm(positionWorld.xz.mul(0.085), 3);
    color = color.mul(float(0.88).add(sandGrainNoise.mul(0.16)));
    const microGrit = tslNoise(positionWorld.xz.mul(48.0));
    color = color.mul(float(0.92).add(microGrit.mul(0.12)));

    // Ripple crest warmth & stoss exposure highlights
    color = mix(color, sandLit, ridgeWarmth.mul(0.46).add(stossWeight.mul(0.28)));

    // Caustics: focused on the stoss slopes and crests, and faded in the troughs
    const caustic = tslCausticProjection(positionWorld.xz, uTime, 0.13);
    const sharpCaustic = pow(caustic, float(1.4));
    const causticHeightMod = mix(float(0.45), float(1.0), h0Clamped);
    const causticSlopeMod = mix(float(0.6), float(1.0), smoothstep(float(-0.25), float(0.25), stossAlign));
    const causticIntensity = sharpCaustic.mul(causticHeightMod).mul(causticSlopeMod);
    const causticFalloff = float(1.0).sub(smoothstep(float(80.0), float(220.0), viewDist));
    const causticGain = uCausticStrength.mul(causticFalloff);
    color = color.add(vec3(0.85, 0.98, 0.92).mul(causticIntensity).mul(causticGain).mul(0.45));

    // Specular lighting on wet/crystalline sand
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const halfVector = normalize(lightDir.add(viewDir));
    const specularDot = max(dot(finalNormal, halfVector), float(0.0));
    const specular = pow(specularDot, float(42.0)).mul(0.18).mul(rippleFalloff);
    color = color.add(vec3(0.9, 0.98, 0.95).mul(specular));

    // Twinkling, view-dependent glinting sparkles
    const sparklePhase = tslHash(positionWorld.xz.mul(12.0));
    const twinkle = sin(uTime.mul(2.2).add(sparklePhase.mul(6.28)));
    const viewGlint = dot(viewDir, finalNormal);
    const sparkle = pow(tslHash(positionWorld.xz.mul(24.0)), float(14.0))
        .mul(twinkle.mul(0.5).add(0.5))
        .mul(float(1.0).add(viewGlint.mul(0.5)));
    color = color.add(vec3(0.95, 0.98, 0.88).mul(sparkle).mul(0.32).mul(microFalloff));

    // Diffuse lighting via the ripple-perturbed normal — lit/shadow sides on every band.
    const light = max(float(0.34), dot(finalNormal, lightDir));
    color = color.mul(light);

    // Height-based Ambient Occlusion (crevices and deep valleys are darker)
    const heightFactorAO = smoothstep(float(-25.0), float(8.0), height);
    const heightAO = mix(float(0.35), float(1.0), heightFactorAO);
    color = color.mul(heightAO);

    // Depth-based color absorption (deeper is darker blue/green tint)
    const depthFactor = smoothstep(float(-35.0), float(10.0), height);
    color = mix(color.mul(0.25), color, depthFactor);

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
    const swayX = sin(phaseX).mul(heightSq).mul(uCurrentStrength).mul(float(1.1).add(ribbonMask.mul(0.22)));

    const phaseZ = uTime.mul(0.88).add(aPhase.mul(0.8)).add(aHeight.mul(3.6));
    const swayZ = cos(phaseZ).mul(heightSq).mul(uCurrentStrength).mul(float(0.77).add(ribbonMask.mul(0.15)));

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

    // Caustics on lower 30%
    const causticMask = float(1.0).sub(smoothstep(float(0.0), float(0.3), aHeight));
    const caustic = tslCausticProjection(positionWorld.xz, uTime, 0.2);
    color = color.add(vec3(0.06, 0.27, 0.22).mul(caustic.mul(causticMask).mul(0.2)));

    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);
    color = tslDepthGradedFog(color, positionWorld.y, viewDist, float(1.05));

    material.colorNode = color;
    const shapedLocal = vec3(positionLocal.x.mul(aBladeWidth).add(bladeFlutter), positionLocal.y, positionLocal.z);
    material.positionNode = shapedLocal.add(vec3(swayX, float(0.0), swayZ));
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
    const swayX = sin(phaseX).mul(heightSq).mul(uCurrentStrength).mul(1.1);

    const phaseZ = uTime.mul(0.88).add(aPhase.mul(0.8)).add(aHeight.mul(3.6));
    const swayZ = cos(phaseZ).mul(heightSq).mul(uCurrentStrength).mul(0.77);

    // Reference organic olive green to light gold-green palette.
    const base = vec3(0.18, 0.42, 0.20);
    const mid = vec3(0.35, 0.65, 0.28);
    const tip = vec3(0.72, 0.88, 0.35);

    let color = mix(base, mid, smoothstep(float(0.0), float(0.5), aHeight));
    color = mix(color, tip, smoothstep(float(0.5), float(1.0), aHeight));
    color = color.mul(float(0.85).add(aColorVar.mul(0.3)));

    // Diffuse lighting based on vertex normal
    const lightDir = normalize(vec3(0.16, 0.92, -0.18));
    const diffuse = max(float(0.24), dot(normalWorld, lightDir));
    color = color.mul(diffuse);

    // Subsurface Scattering (translucency) at the tips
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const sssDot = clamp(dot(viewDir.negate(), lightDir), float(0.0), float(1.0));
    const sssStrength = pow(aHeight, float(2.0)).mul(sssDot).mul(0.38);
    const sssColor = vec3(0.4, 0.88, 0.3);
    color = color.add(sssColor.mul(sssStrength));

    // Dynamic water caustics projected onto seagrass blades
    const caustic = tslCausticProjection(positionWorld.xz, uTime, 0.18);
    color = color.add(vec3(0.5, 0.96, 0.7).mul(caustic).mul(aHeight).mul(0.26));

    // Depth-graded fog wash to blend seagrass into the deep water column
    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);
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
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uGlowIntensity = uniform(0.8);
    const tintColor = uniform(baseColor);

    const breathing = sin(uTime.mul(1.4)).mul(0.06).add(1.0);

    const pattern = tslFbm(
        positionWorld.xz.mul(0.32).add(vec2(positionWorld.y.mul(0.1), positionWorld.y.mul(0.07))),
        2,
    );
    let color = tintColor.mul(breathing).mul(float(0.98).add(pattern.mul(0.18)));

    // Base AO — bottom 35% of the coral's local Y darkens toward a deep sand-shadow
    // tint so colonies appear anchored to the seabed instead of floating.
    const aoMask = float(1.0).sub(smoothstep(float(0.0), float(0.35), positionLocal.y));
    const aoColor = vec3(0.01, 0.04, 0.08);
    color = mix(color, aoColor, aoMask.mul(0.65));

    // Painterly Abzu rim: warm pink/gold lift on grazing angles.
    const warmBase = vec3(1.0, 0.62, 0.38);
    const coolRim = vec3(0.18, 0.72, 0.64);
    const rim = pow(float(1.0).sub(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))))), float(1.8));
    color = color.add(warmBase.mul(rim.mul(0.22)));

    // Emissive tips drive selective bloom — sharper exponent than before so only
    // the very top of upward-facing geometry glows, the rest reads as solid colour.
    const tipGlow = pow(max(normalWorld.y, float(0.0)), float(4.5)).mul(
        float(0.32).add(uGlowIntensity.mul(0.075)),
    );
    const emissiveColor = tintColor.add(coolRim.mul(0.12)).mul(tipGlow);

    material.colorNode = color;
    material.positionNode = positionLocal.mul(breathing);
    material.emissiveNode = emissiveColor;

    material.userData = { uTime, uGlowIntensity };
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
    const aSize = attribute('aSize');

    // Bell pulse
    const pulse = sin(uTime.mul(1.8).add(aPhase))
        .mul(0.25)
        .add(float(0.72).add(uGlowIntensity.mul(0.04)));
    material.positionNode = positionLocal.mul(aSize.mul(pulse));

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
    const aSize = attribute('aSize');
    // Twinkle
    const glow = sin(uTime.mul(0.72).add(aPhase.mul(3.5)))
        .mul(0.5)
        .add(0.5);
    const glowScaled = glow.mul(uGlowIntensity.mul(0.32));

    material.positionNode = positionLocal.mul(aSize.add(glowScaled.mul(1.2)));

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
    const uCurrentStrength = uniform(0.5);

    // ── Unpacked from 2 packed instanced buffers (WebGPU 8-buffer limit) ──
    // aBubblePack1.xyzw = speed, phase, size, lifeOffset
    // aBubblePack2.xy   = columnSpread, micro
    const pack1 = attribute('aBubblePack1', 'vec4');
    const pack2 = attribute('aBubblePack2', 'vec2');
    const aSpeed = pack1.x;
    const aPhase = pack1.y;
    const aSize = pack1.z;
    const aLifeOffset = pack1.w;
    const aColumnSpread = pack2.x;
    const aMicro = pack2.y;

    const travel = fract(aLifeOffset.add(uTime.mul(aSpeed).mul(0.035)));
    const columnScale = float(1.0).add(aColumnSpread.mul(0.01));
    material.positionNode = positionLocal.mul(aSize.mul(columnScale));

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
    material.opacityNode = alpha.mul(0.2);
    material.emissiveNode = vec3(0.0);

    material.userData = { uTime, uCurrentStrength };
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
        const inner = smoothstep(float(0.7), float(0.78), centerDist);
        const outer = float(1.0).sub(smoothstep(float(0.78), float(0.86), centerDist));
        ring = inner.mul(outer);
        shimmer = float(0.92).add(sin(centerDist.mul(34.0).sub(uTime.mul(5.4))).mul(0.08));
        color = mix(vec3(0.38, 0.92, 1.0), vec3(1.0, 0.96, 0.84), uWarmth).mul(
            ring.mul(shimmer),
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
    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');

    material.positionNode = positionLocal.mul(aSize.mul(float(0.75).add(aLife.mul(0.55))));

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
    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');

    const shimmer = sin(uTime.mul(1.6).add(aPhase)).mul(0.08).add(1.0);
    material.positionNode = positionLocal.mul(
        aSize.mul(shimmer).mul(float(0.84).add(aLife.mul(0.36))),
    );

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
        .mul(aBurstOpacity);
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
        smoothstep(float(1.0), float(0.88), localUv.x),
    );
    const crossFade = smoothstep(float(0.0), float(0.16), localUv.y).mul(
        smoothstep(float(1.0), float(0.72), localUv.y),
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
        smoothstep(float(1.0), float(0.72), u.x),
    );
    const vertical = smoothstep(float(0.0), float(0.22), u.y).mul(
        smoothstep(float(1.0), float(0.42), u.y),
    );
    const streak = sin(
        u.y
            .mul(32.0)
            .add(uTime.mul(float(1.2).add(aLayer.mul(0.25))))
            .add(aSeed),
    );
    const fine = sin(u.x.mul(18.0).sub(uTime.mul(0.8)).add(aSeed.mul(1.7)));
    const dust = tslHash(vec2(u.x.add(aSeed).mul(26.0), u.y.add(aSeed).mul(68.0)));
    const shimmer = float(0.72).add(streak.mul(0.18)).add(fine.mul(0.08)).add(dust.mul(0.07));
    const ray = core.mul(vertical).mul(shimmer);

    // Distance fade — rough proxy via view-space depth
    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);
    const distanceFade = float(1.0).sub(smoothstep(float(70.0), float(230.0), viewDist));
    const currentPulse = float(0.86).add(uCurrentStrength.mul(0.08));

    const shaftColor = vec3(0.43, 0.91, 0.92);
    const warmColor = vec3(1.0, 0.86, 0.54);
    const colorBase = mix(shaftColor, warmColor, pow(u.y, float(2.4)).mul(0.3));
    const colorOut = colorBase.mul(ray).mul(float(0.74).add(uGlowIntensity.mul(0.08)));
    const alpha = ray.mul(distanceFade).mul(uRayStrength).mul(currentPulse).mul(0.42);

    material.colorNode = colorOut;
    material.opacityNode = alpha;
    // Shafts feed bloom + post god-ray amplifier — the brighter the source the
    // longer the post-FX shafts reach across the screen.
    material.emissiveNode = colorOut.mul(alpha.mul(1.1));

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
        smoothstep(float(1.0), float(0.72), u.y),
    );
    const sideFade = smoothstep(float(0.0), float(0.08), u.x).mul(
        smoothstep(float(1.0), float(0.9), u.x),
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
    const aSize = attribute('aSize');

    const pulse = float(0.5).add(sin(uTime.mul(0.5).add(aPhase)).mul(0.42));
    material.positionNode = positionLocal.mul(aSize.mul(float(1.0).add(uCurrentStrength.mul(0.4))));

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
    const uFogColor = uniform(vec3(0.0, 0.149, 0.2));
    const uSilhouetteColor = uniform(params.silhouetteColor ?? vec3(0.045, 0.15, 0.17));

    const u = uv();
    // FBM-driven silhouette mask: irregular cliff/kelp shape that's organic
    const noiseScale = vec2(2.6, 1.3);
    const animatedUv = u.mul(noiseScale).add(vec2(uTime.mul(0.012), float(0.0)));
    const shape = tslFbm(animatedUv, 4);
    // Mountain-ish profile: high at horizons, low at edges
    const verticalGradient = smoothstep(float(0.05), float(0.65), float(1.0).sub(u.y));
    const fade = smoothstep(float(0.0), float(0.18), u.x).mul(
        smoothstep(float(1.0), float(0.82), u.x),
    );
    const mask = smoothstep(float(0.32), float(0.62), shape).mul(verticalGradient).mul(fade);

    // Color: silhouette tone deepening into fog
    let color = mix(uFogColor, uSilhouetteColor, mask);
    // Subtle blue-shift on receding parts
    color = color.add(vec3(0.0, 0.02, 0.04).mul(mask));

    material.colorNode = color;
    material.opacityNode = mask.mul(0.85);
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

    const aColor = attribute('aColor');
    const aPhase = attribute('aPhase');
    const aSize = attribute('aSize');

    const pulse = float(0.76)
        .add(sin(uTime.mul(1.15).add(aPhase)).mul(0.18))
        .add(uGlowIntensity.mul(0.08));
    material.positionNode = positionLocal.mul(aSize.mul(pulse));

    const radial = safeBillboardRadialFalloff();
    const core = pow(radial, float(4.0));
    const aura = pow(radial, float(1.7));

    const color = aColor.mul(core.mul(0.7).add(aura.mul(0.24))).mul(pulse);
    const alpha = aura.mul(0.18).mul(pulse);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(1.25));

    material.userData = { uTime, uGlowIntensity };
    return material;
}
