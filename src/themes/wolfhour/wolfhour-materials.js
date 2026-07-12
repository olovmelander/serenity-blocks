/**
 * Wolfhour Theme — TSL Node Material Factories (WebGPU path)
 *
 * Each factory returns { material, uniforms, meta }.
 * All materials set emissiveNode for MRT bloom compliance.
 */

import {
    PointsNodeMaterial,
    MeshBasicNodeMaterial,
    LineBasicNodeMaterial,
    SpriteNodeMaterial, // Added
} from 'three/webgpu';

import {
    Fn,
    If,
    uniform,
    uniformArray,
    attribute,
    storage,
    vertexIndex,
    instanceIndex,
    positionGeometry,
    positionLocal,
    positionWorld,
    normalWorld,
    cameraPosition,
    modelViewMatrix,
    modelWorldMatrix,
    cameraViewMatrix,
    cameraProjectionMatrix,
    uv,
    float,
    vec2,
    vec3,
    vec4,
    sin,
    cos,
    abs,
    max,
    pow,
    mix,
    dot,
    length,
    normalize,
    smoothstep,
    clamp,
    fract,
    floor,
    exp,
    atan,
    texture,
} from 'three/tsl';

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// TSL Noise Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hash function for procedural noise (matches GLSL version).
 */
const tslHash = Fn(([p_immutable]) => {
    const p = vec2(p_immutable).toVar();
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

/**
 * 2D value noise.
 */
const tslNoise = Fn(([p_immutable]) => {
    const p = vec2(p_immutable).toVar();
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    // Smooth interpolation
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = tslHash(i);
    const b = tslHash(i.add(vec2(1.0, 0.0)));
    const c = tslHash(i.add(vec2(0.0, 1.0)));
    const d = tslHash(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/**
 * Fractional Brownian Motion — 4 octaves.
 */
const tslFbm = Fn(([p_immutable]) => {
    const p = vec2(p_immutable).toVar();
    const v = float(0.0).toVar();
    const a = float(0.5).toVar();
    // 4 octaves unrolled
    v.addAssign(a.mul(tslNoise(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise(p)));
    return v;
});

// ─────────────────────────────────────────────────────────────────────────────
// TSL Billboarding Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Custom billboarding for MeshBasicNodeMaterial.
 * Assumes a quad geometry with positionLocal as (-0.5, -0.5, 0) to (0.5, 0.5, 0).
 */
const createBillboardPosition = Fn(({ sizeNode, centerNode = null }) => {
    // In r181 InstanceNode has already applied the instance matrix to positionLocal
    // before positionNode runs. Scale only the original quad, never the translated
    // center, or distant particles explode away from their intended origin.
    const localOffset = positionGeometry.mul(sizeNode);
    if (centerNode) {
        return vec3(centerNode).add(localOffset);
    }
    const instanceCenter = positionLocal.sub(positionGeometry);
    return instanceCenter.add(localOffset);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Starfield Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createStarfieldNodeMaterial(params = {}) {
    const {
        pixelRatio = 1,
        enableDiffraction = false,
        diffractionStrength = 0.2,
        depthGlowStrength = 0.7,
    } = params;

    const uTime = uniform(0);
    const uPixelRatio = uniform(pixelRatio);
    const uEventBoost = uniform(0);
    const uDiffractionStrength = uniform(enableDiffraction ? diffractionStrength : 0);
    const uDepthGlowStrength = uniform(depthGlowStrength);

    const aSize = attribute('aSize');
    const aTwinkle = attribute('aTwinkle');
    const aBrightness = attribute('aBrightness');
    const aColor = attribute('color');

    // Vertex: twinkle + size attenuation
    const positionNode = Fn(() => {
        return positionLocal;
    })();

    const sizeNode = Fn(() => {
        const mvPos = modelViewMatrix.mul(vec4(positionLocal.x, positionLocal.y, positionLocal.z, 1.0));
        const attenuation = float(300.0).div(max(mvPos.z.negate(), 0.001));
        const depthFactor = smoothstep(1400.0, 4800.0, abs(positionLocal.z));
        const depthBloomScale = float(1.0).add(depthFactor.mul(uDepthGlowStrength).mul(0.35));
        const rawSize = aSize.mul(uPixelRatio).mul(attenuation);
        return clamp(rawSize.mul(depthBloomScale), 1.0, 95.0);
    })();

    // Fragment: soft circle + diffraction spikes + depth glow shaping
    const twinkle = sin(uTime.mul(aTwinkle.y).add(aTwinkle.x));
    const brightness = aBrightness.mul(float(0.7).add(twinkle.mul(0.3)));
    const boostedBrightness = brightness.mul(float(1.0).add(uEventBoost.mul(0.5)));
    const depthFactor = smoothstep(1400.0, 4800.0, abs(positionWorld.z));
    const depthGlow = mix(float(1.0), float(1.35), depthFactor.mul(uDepthGlowStrength));

    const localUv = uv().sub(0.5);
    const dist = length(localUv).mul(2.0);
    const softCircle = float(1.0).sub(smoothstep(0.0, 1.0, dist));

    let diffraction = float(0.0);
    if (enableDiffraction) {
        const spikeX = pow(max(float(1.0).sub(smoothstep(0.0, 0.28, abs(localUv.x))), 0.0), 3.0);
        const spikeY = pow(max(float(1.0).sub(smoothstep(0.0, 0.28, abs(localUv.y))), 0.0), 3.0);
        const diffractionMask = spikeX.add(spikeY).mul(0.5);
        diffraction = diffractionMask
            .mul(boostedBrightness)
            .mul(uDiffractionStrength)
            .mul(float(1.0).add(uEventBoost.mul(0.25)));
    }

    const coreColor = aColor.mul(boostedBrightness).mul(depthGlow).mul(1.5);
    const alpha = softCircle
        .mul(boostedBrightness.add(0.2))
        .mul(depthGlow)
        .add(diffraction.mul(0.7));

    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        vertexColors: true,
    });

    material.positionNode = positionNode;
    material.sizeNode = sizeNode;
    material.colorNode = coreColor;
    material.opacityNode = alpha;
    material.emissiveNode = coreColor.mul(alpha.mul(0.12)).add(vec3(diffraction.mul(0.08))); // Reduced emissive to prevent sky blowout

    return {
        material,
        uniforms: {
            uTime,
            uPixelRatio,
            uEventBoost,
            uDiffractionStrength,
            uDepthGlowStrength,
        },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Mountain Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createMountainNodeMaterial(params = {}) {
    const {
        layer = 0,
        ridgeStrength = 0.25,
        snowAmount = 0.22,
    } = params;

    const uTime = uniform(0);
    const uRockColorDark = uniform(new THREE.Color(0x0e0e12));
    const uRockColorMid = uniform(new THREE.Color(0x15151a));
    const uRockColorLight = uniform(new THREE.Color(0x181a20));
    const uMountainLayer = uniform(layer);
    const uPulseIntensity = uniform(0);
    const uShockwave = uniform(0);
    const uRidgeStrength = uniform(ridgeStrength);
    const uSnowAmount = uniform(snowAmount);

    const aHeight = attribute('aHeight');
    const aBaseMask = attribute('aBaseMask');

    // Vertex: shockwave displacement
    const positionNode = Fn(() => {
        const pos = positionLocal.toVar();
        If(uShockwave.greaterThan(0.001), () => {
            const worldPos = positionWorld;
            const distXZ = length(worldPos.xz);
            const wave = sin(distXZ.mul(0.05).sub(uTime.mul(10.0)))
                .mul(uShockwave)
                .mul(20.0);
            const yMask = smoothstep(0.0, 100.0, worldPos.y);
            pos.y.addAssign(wave.mul(yMask));
        });
        return pos;
    })();

    // Fragment: rock color + lighting + rim + fog
    const colorNode = Fn(() => {
        const baseMask = clamp(aBaseMask, 0.0, 1.0).toVar();
        const skirtFade = smoothstep(0.18, 1.0, baseMask).toVar();
        const rockBase = mix(uRockColorDark, uRockColorLight, uMountainLayer).toVar();

        // Rock texture noise
        const rockNoise = tslFbm(positionWorld.xz.mul(0.02));
        rockBase.mulAssign(float(0.9).add(rockNoise.mul(0.2)));

        // Lighting
        const lightDir = normalize(vec3(0.3, 0.8, 0.5));
        const diff = max(float(0.4), dot(normalWorld, lightDir));
        const col = rockBase.mul(diff).toVar();

        // Rim lighting
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const rim = pow(max(float(1.0).sub(max(dot(normalWorld, viewDir), 0.0)), 0.0), 3.0);
        col.addAssign(vec3(0.1, 0.1, 0.12).mul(rim).mul(float(1.0).sub(skirtFade.mul(0.92))));

        // Subsurface-like silver bleed on sharp back-lit edges
        const lightDirBack = lightDir.mul(-1.0);
        const backScatter = pow(max(dot(normalWorld, lightDirBack), 0.0), 2.0);
        const scatterMask = smoothstep(0.55, 0.95, aHeight).mul(backScatter).mul(float(1.0).sub(skirtFade));
        col.addAssign(vec3(0.2, 0.22, 0.26).mul(scatterMask).mul(0.18));

        // Animated ridge highlight crawl
        const ridgeMask = smoothstep(0.58, 1.0, aHeight)
            .mul(pow(max(float(1.0).sub(abs(normalWorld.y)), 0.0), 1.7))
            .mul(float(1.0).sub(skirtFade));
        const ridgeFlow = sin(
            positionWorld.x.mul(0.015)
                .add(positionWorld.z.mul(0.009))
                .add(uTime.mul(1.6)),
        ).mul(0.5).add(0.5);
        const ridgePulse = float(0.45).add(uPulseIntensity.mul(0.9));
        const ridgeHighlight = ridgeMask.mul(ridgeFlow).mul(uRidgeStrength).mul(ridgePulse);
        const ridgeColor = mix(vec3(0.38, 0.4, 0.45), vec3(0.12, 0.14, 0.18), clamp(uMountainLayer, 0.0, 1.0)); // Retain some highlight for back layers
        col.addAssign(ridgeColor.mul(ridgeHighlight));

        // Procedural snow dusting on high, sloped ridges - darkened for background mountains
        const snowHeight = smoothstep(0.72, 1.0, aHeight);
        const slopeMask = smoothstep(0.25, 0.72, float(1.0).sub(abs(normalWorld.y)));
        const snowMask = snowHeight.mul(slopeMask).mul(uSnowAmount).mul(float(1.0).sub(skirtFade.mul(0.96)));
        const snowColor = mix(vec3(0.4, 0.42, 0.48), vec3(0.15, 0.16, 0.22), clamp(uMountainLayer, 0.0, 1.0)); // Visible snow on back mountains
        col.assign(mix(col, snowColor, snowMask));

        // Peak glow on pulse
        const peakGlow = smoothstep(0.6, 1.0, aHeight).mul(uPulseIntensity).mul(float(1.0).sub(skirtFade));
        col.addAssign(vec3(0.8, 0.8, 0.9).mul(peakGlow).mul(0.3));

        const baseShadow = mix(rockBase.mul(0.4), vec3(0.02, 0.022, 0.03), skirtFade);
        col.assign(mix(col, baseShadow, skirtFade));

        // Atmospheric fog - reduced fade to prevent background mountains from becoming invisible
        const fogColor = vec3(0.0);
        const atmosphericFade = pow(max(uMountainLayer, 0.0), 1.2).mul(0.42); // Was 0.8
        col.assign(mix(col, fogColor, clamp(atmosphericFade, 0.0, 1.0)));

        return col;
    })();

    const material = new MeshBasicNodeMaterial({
        transparent: false,
    });

    material.positionNode = positionNode;
    material.colorNode = colorNode;
    // MRT: mountains only emit on pulse peaks
    const ridgeEmissive = smoothstep(0.62, 1.0, aHeight)
        .mul(pow(max(float(1.0).sub(abs(normalWorld.y)), 0.0), 1.4))
        .mul(uRidgeStrength)
        .mul(float(0.25).add(uPulseIntensity.mul(0.7)))
        .mul(float(1.0).sub(smoothstep(0.12, 0.85, aBaseMask)));
    const emissiveFade = clamp(float(1.0).sub(uMountainLayer), 0.0, 1.0); // Dim emissive largely on background layers
    const emissive = vec3(0.8, 0.8, 0.9).mul(smoothstep(0.6, 1.0, aHeight).mul(uPulseIntensity).mul(0.15))
        .add(vec3(0.2, 0.22, 0.26).mul(ridgeEmissive))
        .mul(emissiveFade)
        .mul(float(1.0).sub(smoothstep(0.12, 0.85, aBaseMask)));
    material.emissiveNode = emissive;

    return {
        material,
        uniforms: {
            uTime,
            uRockColorDark,
            uRockColorMid,
            uRockColorLight,
            uMountainLayer,
            uPulseIntensity,
            uShockwave,
            uRidgeStrength,
            uSnowAmount,
        },
        meta: { emitsBloom: false },
    };
}

export function createMountainBaseFillNodeMaterial(params = {}) {
    const color = params.color instanceof THREE.Color
        ? params.color.clone()
        : new THREE.Color(params.color ?? 0x03040a);
    const uColor = uniform(color);

    const material = new MeshBasicNodeMaterial({
        transparent: false,
    });

    material.colorNode = uColor;

    return {
        material,
        uniforms: { uColor },
        meta: { emitsBloom: false },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Spirit Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createSpiritNodeMaterial(params = {}) {
    const {
        pixelRatio = 1,
        spiritCompute = null,
    } = params;

    const uTime = uniform(0);
    const uPixelRatio = uniform(pixelRatio);
    const uSurgeIntensity = uniform(0);

    const aPhase = attribute('aPhase');
    const aSpeed = attribute('aSpeed');
    const aSize = attribute('aSize');
    const useCompute = Boolean(
        spiritCompute?.getPositionBuffer
        && spiritCompute?.getMiscBuffer
        && Number.isFinite(spiritCompute?.count),
    );

    const positionStorage = useCompute
        ? storage(spiritCompute.getPositionBuffer(), 'vec4', spiritCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(spiritCompute.getMiscBuffer(), 'vec4', spiritCompute.count)
        : null;
    const positionStorageAttr = useCompute && typeof positionStorage.toAttribute === 'function'
        ? positionStorage.toAttribute()
        : null;
    const miscStorageAttr = useCompute && typeof miscStorage.toAttribute === 'function'
        ? miscStorage.toAttribute()
        : null;

    const particlePosition = useCompute
        ? (positionStorageAttr ? positionStorageAttr.xyz : positionStorage.element(instanceIndex).xyz)
        : null;
    const particlePhase = useCompute
        ? (miscStorageAttr ? miscStorageAttr.x : miscStorage.element(instanceIndex).x)
        : aPhase;
    const particleSpeed = useCompute
        ? (miscStorageAttr ? miscStorageAttr.y : miscStorage.element(instanceIndex).y)
        : aSpeed;
    const particleSize = useCompute
        ? (miscStorageAttr ? miscStorageAttr.z : miscStorage.element(instanceIndex).z)
        : aSize;

    // Vertex: floating sine wave
    const fallbackPositionNode = Fn(() => {
        const pos = positionLocal.sub(positionGeometry).toVar();
        const t = uTime.mul(aSpeed).add(aPhase);
        pos.y.addAssign(sin(t).mul(20.0));
        pos.x.addAssign(cos(t.mul(0.7)).mul(15.0));
        return pos;
    })();

    const sizeNode = particleSize.mul(float(1.0).add(uSurgeIntensity.mul(0.3))); // World units, no pixelRatio

    // Fragment: soft ethereal glow
    const t = uTime.mul(particleSpeed).add(particlePhase);
    const heightSource = useCompute ? particlePosition.y : positionLocal.y;
    const heightFade = smoothstep(50.0, 200.0, heightSource);
    const pulseFade = float(0.4).add(sin(t.mul(2.0)).mul(0.3)); // Slightly more visibility pulse
    const vAlpha = heightFade.mul(pulseFade).mul(float(1.0).add(uSurgeIntensity.mul(0.6)));

    const dist = length(uv().sub(0.5)).mul(2.0);
    const glow = pow(max(float(1.0).sub(smoothstep(0.0, 1.0, dist)), 0.0), 1.2); // Softer falloff (was 1.5)
    const spiritColor = vec3(0.9, 0.95, 1.0); // Slightly whiter
    const alpha = glow.mul(vAlpha).mul(0.45); // Increased alpha (was 0.3)

    const material = new MeshBasicNodeMaterial({ // Changed from PointsNodeMaterial
        colorNode: vec4(0.0), // Fully transparent color base
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
    });

    material.positionNode = createBillboardPosition({
        sizeNode,
        centerNode: useCompute ? particlePosition : fallbackPositionNode,
    });
    material.colorNode = vec4(spiritColor.x, spiritColor.y, spiritColor.z, alpha); // Updated colorNode
    material.emissiveNode = spiritColor.mul(alpha.mul(0.15));

    return {
        material,
        uniforms: { uTime, uPixelRatio, uSurgeIntensity },
        meta: { emitsBloom: true, usesCompute: useCompute },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Nebula Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createNebulaNodeMaterial(params = {}) {
    const { texture: tex, opacity = 0.2 } = params;

    const uOpacity = uniform(opacity);
    const uPulse = uniform(0);
    const uColorShift = uniform(0);
    const uDefinition = uniform(0);

    const texNode = texture(tex);
    const vUv = uv();

    // Edge fade
    const fadeX = smoothstep(0.0, 0.5, vUv.x)
        .mul(float(1.0).sub(smoothstep(0.5, 1.0, vUv.x)));
    const fadeY = smoothstep(0.0, 0.5, vUv.y)
        .mul(float(1.0).sub(smoothstep(0.5, 1.0, vUv.y)));
    const fade = pow(max(fadeX.mul(fadeY), 0.0), 2.0);

    const alpha = texNode.a.mul(uOpacity.add(uPulse.mul(0.05))).mul(fade);

    const coolTint = vec3(0.4, 0.44, 0.54);
    const warmTint = vec3(0.56, 0.51, 0.43);
    const tintMix = smoothstep(0.0, 1.0, uColorShift);
    const reactiveTint = mix(coolTint, warmTint, tintMix);

    const detailBoost = float(1.0).add(uDefinition.mul(0.35));
    const col = texNode.rgb
        .mul(float(1.0).add(uPulse.mul(0.3)))
        .mul(reactiveTint)
        .mul(detailBoost)
        .mul(0.4); // Darken overall nebula brightness (more than 0.6)

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    material.colorNode = col;
    material.opacityNode = alpha.mul(0.82); // Restored some alpha for silhouetting (was 0.5)
    material.emissiveNode = col.mul(alpha.mul(0.12)); // Restored some emissive (was 0.05)

    return {
        material,
        uniforms: {
            uOpacity, uPulse, uColorShift, uDefinition,
        },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Ground Fog Node Material
// ─────────────────────────────────────────────────────────────────────────────

// Persistent Wolfhour hero and the single-draw lock/combo reaction proved in the playground.
export function createMoonNodeMaterial(params = {}) {
    const moonTexture = params.texture;
    const uPulse = uniform(0);

    const moonSample = texture(moonTexture).rgb;
    const moonLight = normalize(vec3(-0.38, 0.24, 0.9));
    const lunarDiffuse = smoothstep(-0.2, 0.64, dot(normalWorld, moonLight));
    const lunarRim = pow(max(float(1.0).sub(abs(normalWorld.z)), 0.0), 2.4);
    const moonColor = moonSample
        .mul(mix(vec3(0.13, 0.16, 0.25), vec3(0.86, 0.91, 1.0), lunarDiffuse))
        .mul(float(0.72).add(uPulse.mul(0.36)))
        .add(
            vec3(0.19, 0.27, 0.5)
                .mul(lunarRim)
                .mul(float(0.22).add(uPulse.mul(0.25))),
        );

    const material = new MeshBasicNodeMaterial({ transparent: false });
    material.colorNode = moonColor;
    material.emissiveNode = moonColor.mul(float(0.035).add(uPulse.mul(0.025)));

    return {
        material,
        uniforms: { uPulse },
        meta: { emitsBloom: true },
    };
}

export function createLunarHaloNodeMaterial(params = {}) {
    const maxPulses = THREE.MathUtils.clamp(
        Math.floor(params.maxPulses ?? 4),
        1,
        6,
    );
    const uTime = uniform(0);
    // startTime, inverseDuration, strength, combo tint. Each slot advances from
    // uTime independently, so a new combo cannot rewind an older lunar ring.
    const pulseValues = Array.from(
        { length: maxPulses },
        () => new THREE.Vector4(0, 0, 0, 0),
    );
    const uPulseData = uniformArray(pulseValues, 'vec4');

    const p = uv().sub(vec2(0.5));
    const radius = length(p).mul(2.0);
    const angle = atan(p.y, p.x);
    // Keep the persistent corona cheap: two periodic angular waves avoid the radial
    // seam of atan-fed non-periodic noise and cost far less than MaterialX noise over
    // the large halo plane.
    const broadArc = sin(
        angle.mul(5.0)
            .add(radius.mul(3.4))
            .add(uTime.mul(0.035)),
    ).mul(0.5).add(0.5);
    const fineArc = sin(
        angle.mul(11.0)
            .sub(radius.mul(8.0))
            .sub(uTime.mul(0.05)),
    ).mul(0.5).add(0.5);
    const atmosphericNoise = mix(broadArc, fineArc, 0.32);
    const arcScatter = smoothstep(0.18, 0.82, atmosphericNoise);
    const baseCorona = float(1.0).sub(smoothstep(0.42, 1.0, radius))
        .mul(smoothstep(0.28, 0.48, radius))
        .mul(float(0.58).add(atmosphericNoise.mul(0.52)));
    const spokeShape = pow(max(cos(angle.mul(8.0).add(uTime.mul(0.12))), 0.0), 12.0)
        .mul(float(1.0).sub(smoothstep(0.38, 0.98, radius)))
        .mul(smoothstep(0.3, 0.58, radius));
    const glyphShape = float(1.0).sub(smoothstep(0.006, 0.025, abs(radius.sub(0.72))))
        .mul(pow(abs(sin(angle.mul(6.0))), 20.0));

    let pulseRingSum = float(0);
    let echoRingSum = float(0);
    let spokeSum = float(0);
    let glyphSum = float(0);
    let tintSum = float(0);

    // Compile-time unroll keeps uniform indexing simple in three r181. Quality tiers
    // choose the slot count, so low presets do not pay for High's overlap budget.
    for (let i = 0; i < maxPulses; i += 1) {
        const pulse = uPulseData.element(i);
        const progress = clamp(uTime.sub(pulse.x).mul(pulse.y), 0.0, 1.0);
        const strength = max(pulse.z, 0.0);
        const combo = clamp(pulse.w, 0.0, 1.0);
        const envelope = sin(progress.mul(Math.PI)).mul(strength);
        const comboEnvelope = combo.mul(envelope);
        const pulseRadius = float(0.48).add(progress.mul(0.46));
        const pulseRing = float(1.0)
            .sub(smoothstep(0.008, 0.034, abs(radius.sub(pulseRadius))))
            .mul(envelope)
            .mul(float(0.46).add(arcScatter.mul(0.54)));
        const echoRadius = float(0.36).add(progress.mul(0.62));
        const echoRing = float(1.0)
            .sub(smoothstep(0.01, 0.055, abs(radius.sub(echoRadius))))
            .mul(pow(max(envelope, 0.0), 1.4))
            .mul(combo);
        const spoke = spokeShape
            .mul(envelope)
            .mul(float(0.22).add(combo.mul(0.78)));
        const glyph = glyphShape.mul(comboEnvelope).mul(envelope);

        pulseRingSum = pulseRingSum.add(pulseRing);
        echoRingSum = echoRingSum.add(echoRing);
        spokeSum = spokeSum.add(spoke);
        glyphSum = glyphSum.add(glyph);
        tintSum = tintSum.add(comboEnvelope.mul(0.72).add(pulseRing.mul(0.2)));
    }

    const alpha = clamp(
        baseCorona.mul(float(0.075).add(sin(uTime.mul(0.7)).mul(0.014)))
            .add(spokeShape.mul(0.015))
            .add(pulseRingSum.mul(0.74))
            .add(echoRingSum.mul(0.3))
            .add(spokeSum.mul(0.16))
            .add(glyphSum.mul(0.46)),
        0.0,
        0.92,
    );
    const haloColor = mix(
        vec3(0.56, 0.68, 1.0),
        vec3(0.85, 0.77, 1.0),
        clamp(tintSum, 0.0, 1.0),
    );

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    material.colorNode = haloColor;
    material.opacityNode = alpha;
    material.emissiveNode = haloColor.mul(alpha.mul(0.18));

    return {
        material,
        uniforms: { uTime },
        pulseValues,
        pulseData: uPulseData,
        maxPulses,
        meta: { emitsBloom: true },
    };
}

export function createGroundFogNodeMaterial(params = {}) {
    const {
        opacity = 0.24,
    } = params;

    const uTime = uniform(0);
    const uOpacity = uniform(opacity);
    const uPulse = uniform(0);
    const uSwirl = uniform(0);

    const vUv = uv();
    const centered = vUv.sub(0.5);
    const driftUv = vec2(
        vUv.x.mul(3.2).add(uTime.mul(0.032)).add(centered.y.mul(0.25)),
        vUv.y.mul(2.6).add(uTime.mul(0.018)),
    );
    const swirlUv = vec2(
        vUv.x.mul(5.1).sub(uTime.mul(0.025)),
        vUv.y.mul(3.7).add(uTime.mul(0.021)),
    );

    // One coherent density field: blend the domain before FBM so the idle path
    // does not pay for two full four-octave evaluations over a screen-sized plane.
    const density = tslFbm(mix(driftUv, swirlUv, clamp(uSwirl, 0.0, 1.0)));

    const verticalFade = float(1.0).sub(smoothstep(0.15, 1.0, vUv.y));
    const edgeFade = smoothstep(0.02, 0.22, vUv.x)
        .mul(float(1.0).sub(smoothstep(0.78, 0.98, vUv.x)));
    const fogAlpha = density
        .mul(verticalFade)
        .mul(edgeFade)
        .mul(uOpacity)
        .mul(float(0.8).add(uPulse.mul(0.35)))
        .mul(0.5); // Soften fog significantly to prevent band blowout

    const fogColor = mix(vec3(0.14, 0.15, 0.18), vec3(0.2, 0.22, 0.28), density);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
    });

    material.colorNode = fogColor;
    material.opacityNode = fogAlpha.mul(1.5); // Boost fog opacity slightly (added multiplier)
    material.emissiveNode = fogColor.mul(fogAlpha.mul(0.12)); // Boosted emissive (was 0.04)

    return {
        material,
        uniforms: {
            uTime, uOpacity, uPulse, uSwirl,
        },
        meta: { emitsBloom: false },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Star Burst Node Material (piece-lock particle explosion)
// ─────────────────────────────────────────────────────────────────────────────

export function createStarBurstNodeMaterial(params = {}) {
    const { pixelRatio = 1 } = params;

    const uTime = uniform(0);
    const uPixelRatio = uniform(pixelRatio);

    const aVelocity = attribute('aVelocity');
    const aSize = attribute('aSize');

    // Vertex: velocity + gravity displacement around the instance center.
    const centerNode = Fn(() => {
        const pos = positionLocal.sub(positionGeometry).toVar();
        pos.addAssign(aVelocity.mul(uTime));
        pos.y.addAssign(float(-50.0).mul(uTime).mul(uTime));
        return pos;
    })();

    const vAlpha = clamp(float(1.0).sub(uTime.mul(1.5)), 0.0, 1.0);
    const sizeNode = aSize.mul(vAlpha);

    // Fragment: soft glow
    const dist = length(uv().sub(0.5)).mul(2.0);
    const glow = float(1.0).sub(smoothstep(0.0, 1.0, dist));
    const burstColor = vec3(0.9, 0.9, 1.0);
    const alpha = glow.mul(vAlpha).mul(0.72);

    const material = new MeshBasicNodeMaterial({
        colorNode: vec4(0.0),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
    });

    material.positionNode = createBillboardPosition({ sizeNode, centerNode });
    material.colorNode = vec4(burstColor.x, burstColor.y, burstColor.z, alpha);
    material.emissiveNode = burstColor.mul(alpha.mul(0.32));

    return {
        material,
        uniforms: { uTime, uPixelRatio },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Celestial Beam Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createCelestialBeamNodeMaterial(params = {}) {
    const { volumetricStrength = 0.75 } = params;

    const uTime = uniform(0);
    const uOpacity = uniform(1.0);
    const uVolumetricStrength = uniform(volumetricStrength);
    const uVolumetricPulse = uniform(0);

    const vUv = uv();

    const distFromCenterX = abs(vUv.x.sub(0.5)).mul(2.0);
    const distFromCenterY = abs(vUv.y.sub(0.5)).mul(2.0);

    // Gaussian beam shape
    const beamShape = exp(distFromCenterX.mul(distFromCenterX).mul(-20.0));
    const vertFade = float(1.0).sub(smoothstep(0.1, 0.5, distFromCenterY));
    const edgeFade = smoothstep(0.0, 0.15, vUv.y)
        .mul(float(1.0).sub(smoothstep(0.85, 1.0, vUv.y)));
    const shimmer = sin(vUv.y.mul(50.0).add(uTime.mul(10.0))).mul(0.08).add(0.92);
    const volumeCoord = vec2(vUv.y.mul(4.0).add(uTime.mul(0.22)), vUv.x.mul(3.0).add(uTime.mul(0.17)));
    const volumetricNoise = tslFbm(volumeCoord).mul(1.1);
    const volumetricDensity = mix(
        float(1.0),
        volumetricNoise.mul(float(1.1).add(uVolumetricPulse.mul(0.35))),
        uVolumetricStrength,
    );

    const alpha = beamShape
        .mul(vertFade)
        .mul(edgeFade)
        .mul(uOpacity)
        .mul(shimmer)
        .mul(volumetricDensity)
        .mul(0.12); // Reduced from 0.5 — beams should be subtle light shafts

    const beamColor = vec3(0.7, 0.72, 0.8); // Cooler, dimmer beam tint

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = beamColor;
    material.opacityNode = alpha;
    material.emissiveNode = beamColor.mul(alpha.mul(0.1)); // Reduced from 0.55

    return {
        material,
        uniforms: {
            uTime,
            uOpacity,
            uVolumetricStrength,
            uVolumetricPulse,
        },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Cosmic Rift Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createCosmicRiftNodeMaterial() {
    const uTime = uniform(0);
    const uOpacity = uniform(1.0);

    const vUv = uv();

    const edgeFade = smoothstep(0.0, 0.35, vUv.x)
        .mul(float(1.0).sub(smoothstep(0.65, 1.0, vUv.x)));
    const centerFade = pow(max(float(1.0).sub(abs(vUv.y.sub(0.5)).mul(2.0)), 0.0), 2.0);
    const crackle = sin(vUv.x.mul(30.0).add(uTime.mul(15.0))).mul(0.2).add(0.8);
    const alpha = pow(max(edgeFade.mul(centerFade).mul(uOpacity).mul(crackle), 0.0), 1.4).mul(0.15); // Reduced from 0.5

    const riftColor = vec3(0.8, 0.82, 0.9); // Slightly dimmer

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = riftColor;
    material.opacityNode = alpha;
    material.emissiveNode = riftColor.mul(alpha.mul(0.08)); // Reduced from 0.4

    return {
        material,
        uniforms: { uTime, uOpacity },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Cosmic Wave Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createCosmicWaveNodeMaterial() {
    const uTime = uniform(0);
    const uOpacity = uniform(0.5);

    const vUv = uv();

    const edgeFadeX = smoothstep(0.0, 0.15, vUv.x)
        .mul(float(1.0).sub(smoothstep(0.85, 1.0, vUv.x)));
    const edgeFadeY = smoothstep(0.0, 0.15, vUv.y)
        .mul(float(1.0).sub(smoothstep(0.85, 1.0, vUv.y)));
    const edgeFade = edgeFadeX.mul(edgeFadeY);

    const dist = abs(vUv.x.sub(0.5).sub(uTime.mul(0.5)));
    const ripple = sin(dist.mul(20.0).sub(uTime.mul(10.0))).mul(0.5).add(0.5);
    const alpha = uOpacity
        .mul(float(1.0).sub(smoothstep(0.0, 0.5, dist)))
        .mul(ripple)
        .mul(edgeFade)
        .mul(0.4);

    const waveColor = vec3(0.8, 0.85, 1.0);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    material.colorNode = waveColor;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0);

    return {
        material,
        uniforms: { uTime, uOpacity },
        meta: { emitsBloom: false },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Meteor Trail Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createMeteorTrailNodeMaterial(params = {}) {
    const {
        meteorTrailCompute = null,
        atmosphereGlow = 0.4,
        slotAttributeName = 'aSlotOffset',
    } = params;

    const uTime = uniform(0);
    const uProgress = uniform(0);
    const uAtmosphereGlow = uniform(atmosphereGlow);

    const aTrailPosition = attribute('aTrailPosition');
    const useCompute = Boolean(
        meteorTrailCompute?.getPositionBuffer
        && Number.isFinite(meteorTrailCompute?.count),
    );
    const slotOffset = attribute(slotAttributeName);

    const positionStorage = useCompute
        ? storage(meteorTrailCompute.getPositionBuffer(), 'vec4', meteorTrailCompute.count)
        : null;
    const trailPositionNode = useCompute
        ? positionStorage.element(vertexIndex.add(floor(slotOffset))).xyz
        : null;

    // Fade in/out over meteor lifetime
    const fadeIn = smoothstep(0.0, 0.15, uProgress);
    const fadeOut = float(1.0).sub(smoothstep(0.7, 1.0, uProgress));
    const lifeAlpha = fadeIn.mul(fadeOut);

    // Trail: head bright, tail dim
    const trailFade = pow(max(float(1.0).sub(aTrailPosition), 0.0), 2.5);
    const shimmer = sin(aTrailPosition.mul(30.0).add(uTime.mul(10.0))).mul(0.05).add(0.95);

    const headColor = vec3(1.0, 1.0, 1.0);
    const tailColor = vec3(0.6, 0.7, 0.9);
    const col = mix(headColor, tailColor, aTrailPosition);
    const headHalo = pow(max(float(1.0).sub(aTrailPosition), 0.0), 1.1).mul(uAtmosphereGlow);
    const alpha = trailFade.mul(lifeAlpha).mul(shimmer).add(headHalo.mul(lifeAlpha).mul(0.32));

    const material = new LineBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    if (trailPositionNode) {
        material.positionNode = trailPositionNode;
    }
    material.colorNode = col.add(vec3(1.0, 0.82, 0.66).mul(headHalo.mul(0.06)));
    material.opacityNode = alpha;
    material.emissiveNode = col.mul(alpha.mul(0.08)).add(vec3(1.0, 0.82, 0.66).mul(headHalo.mul(0.05))); // Reduced from 0.3/0.18

    return {
        material,
        uniforms: { uTime, uProgress, uAtmosphereGlow },
        meta: { emitsBloom: true, usesCompute: useCompute },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Meteor Head Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createMeteorHeadNodeMaterial(params = {}) {
    const {
        pixelRatio = 1,
        atmosphereGlow = 0.4,
    } = params;

    const uProgress = uniform(0);
    const uPixelRatio = uniform(pixelRatio);
    const uAtmosphereGlow = uniform(atmosphereGlow);

    const fadeIn = smoothstep(0.0, 0.1, uProgress);
    const fadeOut = float(1.0).sub(smoothstep(0.6, 1.0, uProgress));
    const lifeAlpha = fadeIn.mul(fadeOut);

    const sizeNode = float(12.0).mul(float(1.0).add(uAtmosphereGlow.mul(0.45)));

    const dist = length(uv().sub(0.5)).mul(2.0);
    const glow = pow(max(float(1.0).sub(dist), 0.0), 1.5);
    const ionization = pow(max(float(1.0).sub(smoothstep(0.35, 1.0, dist)), 0.0), 1.25).mul(uAtmosphereGlow);

    const coreColor = vec3(1.0, 1.0, 1.0); // Renamed from 'core' to avoid conflict with 'core' in diff
    const haloColor = vec3(0.9, 0.92, 1.0); // Renamed from 'halo' to avoid conflict with 'halo' in diff
    const plasma = vec3(1.0, 0.85, 0.65).mul(ionization.mul(0.35));
    const col = mix(haloColor, coreColor, glow).add(plasma); // Using renamed variables
    const alpha = glow.mul(lifeAlpha).add(ionization.mul(lifeAlpha).mul(0.25));

    const material = new MeshBasicNodeMaterial({ // Changed from PointsNodeMaterial
        colorNode: vec4(0.0), // Fully transparent color base
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
    });

    material.positionNode = createBillboardPosition({ sizeNode });
    const headColorCombined = coreColor.add(haloColor);
    material.colorNode = vec4(headColorCombined.x, headColorCombined.y, headColorCombined.z, alpha); // Adjusted to use local coreColor and haloColor
    material.emissiveNode = coreColor.mul(alpha.mul(0.12)).add(plasma.mul(0.15)); // Reduced from 0.5

    return {
        material,
        uniforms: { uProgress, uPixelRatio, uAtmosphereGlow },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Crash Meteor Trail Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createCrashMeteorTrailNodeMaterial(params = {}) {
    const {
        meteorTrailCompute = null,
        atmosphereGlow = 0.55,
        slotAttributeName = 'aSlotOffset',
    } = params;

    const uTime = uniform(0);
    const uProgress = uniform(0);
    const uAtmosphereGlow = uniform(atmosphereGlow);

    const aTrailPosition = attribute('aTrailPosition');
    const useCompute = Boolean(
        meteorTrailCompute?.getPositionBuffer
        && Number.isFinite(meteorTrailCompute?.count),
    );
    const slotOffset = attribute(slotAttributeName);

    const positionStorage = useCompute
        ? storage(meteorTrailCompute.getPositionBuffer(), 'vec4', meteorTrailCompute.count)
        : null;
    const trailPositionNode = useCompute
        ? positionStorage.element(vertexIndex.add(floor(slotOffset))).xyz
        : null;

    const fadeIn = smoothstep(0.0, 0.1, uProgress);
    const fadeOut = float(1.0).sub(smoothstep(0.85, 1.0, uProgress));
    const lifeAlpha = fadeIn.mul(fadeOut);
    const intensity = float(1.0).add(uProgress.mul(0.3));

    const trailFade = pow(max(float(1.0).sub(aTrailPosition), 0.0), 2.0);
    const shimmer = sin(aTrailPosition.mul(40.0).add(uTime.mul(15.0))).mul(0.1).add(0.9);

    const headColor = vec3(1.0, 0.95, 0.85);
    const tailColor = vec3(0.7, 0.75, 0.9);
    const col = mix(headColor, tailColor, aTrailPosition).mul(intensity);
    const headHalo = pow(max(float(1.0).sub(aTrailPosition), 0.0), 1.05).mul(uAtmosphereGlow);
    const alpha = trailFade.mul(lifeAlpha).mul(shimmer).add(headHalo.mul(lifeAlpha).mul(0.36));

    const material = new LineBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    if (trailPositionNode) {
        material.positionNode = trailPositionNode;
    }
    const plasmaTint = vec3(1.0, 0.78, 0.58).mul(headHalo.mul(0.22));
    material.colorNode = col.add(plasmaTint);
    material.opacityNode = alpha;
    material.emissiveNode = col.mul(alpha.mul(0.3)).add(plasmaTint.mul(alpha.mul(0.22)));

    return {
        material,
        uniforms: { uTime, uProgress, uAtmosphereGlow },
        meta: { emitsBloom: true, usesCompute: useCompute },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Crash Meteor Head Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createCrashMeteorHeadNodeMaterial(params = {}) {
    const {
        pixelRatio = 1,
        atmosphereGlow = 0.55,
    } = params;

    const uProgress = uniform(0);
    const uPixelRatio = uniform(pixelRatio);
    const uAtmosphereGlow = uniform(atmosphereGlow);

    const fadeIn = smoothstep(0.0, 0.1, uProgress);
    const fadeOut = float(1.0).sub(smoothstep(0.9, 1.0, uProgress));
    const lifeAlpha = fadeIn.mul(fadeOut);
    const intensity = float(1.0).add(uProgress.mul(0.5));

    const sizeNode = float(75.0)
        .mul(intensity)
        .mul(float(1.0).add(uAtmosphereGlow.mul(0.52)));

    const dist = length(uv().sub(0.5)).mul(2.0);
    const glow = pow(max(float(1.0).sub(dist), 0.0), 1.2);
    const ionization = pow(max(float(1.0).sub(smoothstep(0.28, 1.0, dist)), 0.0), 1.1).mul(uAtmosphereGlow);

    const core = vec3(1.0, 1.0, 1.0);
    const halo = vec3(1.0, 0.9, 0.7);
    const plasma = vec3(1.0, 0.76, 0.55).mul(ionization.mul(0.4));
    const col = mix(halo, core, glow).mul(intensity).add(plasma);
    const alpha = glow.mul(lifeAlpha).add(ionization.mul(lifeAlpha).mul(0.28));

    const material = new MeshBasicNodeMaterial({
        colorNode: vec4(0.0),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    material.positionNode = createBillboardPosition({ sizeNode: sizeNode });
    material.colorNode = vec4(col.x, col.y, col.z, alpha);
    material.emissiveNode = col.mul(alpha.mul(0.15)).add(plasma.mul(alpha.mul(0.12))); // Reduced from 0.7

    return {
        material,
        uniforms: { uProgress, uPixelRatio, uAtmosphereGlow },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Debris Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createDebrisNodeMaterial(params = {}) {
    const {
        pixelRatio = 1,
        debrisCompute = null,
        slotAttributeName = 'aComputeOffset',
    } = params;

    const uTime = uniform(0);
    const uPixelRatio = uniform(pixelRatio);

    const aVelocity = attribute('aVelocity');
    const aSize = attribute('aSize');
    const aRotation = attribute('aRotation');
    const aComputeOffset = attribute(slotAttributeName);
    const useCompute = Boolean(
        debrisCompute?.getPositionBuffer
        && debrisCompute?.getMiscBuffer
        && Number.isFinite(debrisCompute?.count),
    );

    const positionStorage = useCompute
        ? storage(debrisCompute.getPositionBuffer(), 'vec4', debrisCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(debrisCompute.getMiscBuffer(), 'vec4', debrisCompute.count)
        : null;
    const computeIndex = useCompute ? instanceIndex.add(floor(aComputeOffset)) : null;

    const computePosition = useCompute
        ? positionStorage.element(computeIndex).xyz
        : null;
    const computeSize = useCompute
        ? miscStorage.element(computeIndex).x
        : aSize;
    const computeSeed = useCompute
        ? miscStorage.element(computeIndex).y
        : aRotation;
    const computeLife = useCompute
        ? clamp(miscStorage.element(computeIndex).z, 0.0, 1.0)
        : float(1.0).sub(smoothstep(0.0, 4.5, uTime));
    const computeActive = useCompute
        ? clamp(miscStorage.element(computeIndex).w, 0.0, 1.0)
        : float(1.0);

    // Vertex: velocity + gravity
    const fallbackPositionNode = Fn(() => {
        const pos = positionLocal.sub(positionGeometry).toVar();
        pos.addAssign(aVelocity.mul(uTime));
        pos.y.addAssign(float(-200.0).mul(uTime).mul(uTime));
        return pos;
    })();

    const twinkle = float(0.7).add(sin(uTime.mul(8.0).add(computeSeed.mul(10.0))).mul(0.3));
    const sizeNode = computeSize.mul(computeLife).mul(twinkle);

    // Fragment
    const dist = length(uv().sub(0.5)).mul(2.0);
    const glow = pow(max(float(1.0).sub(smoothstep(0.0, 1.0, dist)), 0.0), 1.5);

    const core = vec3(1.0, 1.0, 1.0);
    const halo = vec3(0.85, 0.88, 1.0);
    const col = mix(halo, core, glow);
    const alpha = glow.mul(computeLife).mul(twinkle).mul(computeActive);

    const material = new MeshBasicNodeMaterial({
        colorNode: vec4(0.0),
        transparent: true,
        depthWrite: false,
    });

    if (useCompute) {
        const hidden = vec3(0.0, 0.0, -9999.0);
        const actualPos = mix(hidden, computePosition, computeActive);
        material.positionNode = createBillboardPosition({ sizeNode, centerNode: actualPos });
    } else {
        material.positionNode = createBillboardPosition({ sizeNode, centerNode: fallbackPositionNode });
    }
    material.colorNode = vec4(col.x, col.y, col.z, alpha);
    material.emissiveNode = col.mul(alpha.mul(0.1)); // Reduced from 0.4

    return {
        material,
        uniforms: { uTime, uPixelRatio },
        meta: { emitsBloom: true, usesCompute: useCompute },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 14b. Ambient Particle Node Material (WebGPU compute-only enhancement)
// ─────────────────────────────────────────────────────────────────────────────

export function createAmbientParticleNodeMaterial(params = {}) {
    const {
        pixelRatio = 1,
        ambientCompute = null,
    } = params;

    const useCompute = Boolean(
        ambientCompute?.getPositionBuffer
        && ambientCompute?.getMiscBuffer
        && Number.isFinite(ambientCompute?.count),
    );

    const uTime = uniform(0);
    const uPixelRatio = uniform(pixelRatio);
    const uOpacity = uniform(0.45);

    const aColor = attribute('color', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aPosition = useCompute ? null : attribute('position', 'vec3');

    const positionStorage = useCompute
        ? storage(ambientCompute.getPositionBuffer(), 'vec4', ambientCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(ambientCompute.getMiscBuffer(), 'vec4', ambientCompute.count)
        : null;
    const positionStorageAttr = useCompute && typeof positionStorage.toAttribute === 'function'
        ? positionStorage.toAttribute()
        : null;
    const miscStorageAttr = useCompute && typeof miscStorage.toAttribute === 'function'
        ? miscStorage.toAttribute()
        : null;

    const particlePosition = useCompute
        ? (positionStorageAttr ? positionStorageAttr.xyz : positionStorage.element(instanceIndex).xyz)
        : aPosition;
    const phaseSeed = useCompute
        ? (miscStorageAttr ? miscStorageAttr.x : miscStorage.element(instanceIndex).x)
        : aPosition.x.mul(0.01);
    const sizeSeed = useCompute
        ? (miscStorageAttr ? miscStorageAttr.y : miscStorage.element(instanceIndex).y)
        : aSize;
    const speedSeed = useCompute
        ? (miscStorageAttr ? miscStorageAttr.w : miscStorage.element(instanceIndex).w)
        : float(1.0);

    const twinkle = sin(uTime.mul(speedSeed.mul(0.7)).add(phaseSeed)).mul(0.2).add(0.8);
    const dist = length(uv().sub(0.5)).mul(2.0);
    const soft = pow(max(float(1.0).sub(smoothstep(0.0, 1.0, dist)), 0.0), 0.9);
    const alpha = soft.mul(uOpacity).mul(twinkle).mul(1.5); // Increased base visibility
    const baseColor = aColor.mul(vec3(0.85, 0.88, 1.0));
    const sizeNode = sizeSeed.mul(5.0).mul(twinkle.add(0.2)); // Removed pixelRatio, increased base multiplier

    const material = new MeshBasicNodeMaterial({
        colorNode: vec4(0.0),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    if (useCompute) {
        material.positionNode = createBillboardPosition({ sizeNode: sizeNode, centerNode: particlePosition });
    } else {
        material.positionNode = createBillboardPosition({ sizeNode: sizeNode });
    }
    material.colorNode = vec4(baseColor.x, baseColor.y, baseColor.z, alpha);
    material.emissiveNode = baseColor.mul(alpha.mul(0.12));

    return {
        material,
        uniforms: { uTime, uPixelRatio, uOpacity },
        meta: { emitsBloom: false, usesCompute: useCompute },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. Shockwave Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createShockwaveNodeMaterial() {
    const uProgress = uniform(0);
    const uOpacity = uniform(1.0);

    const vUv = uv();

    const center = vUv.sub(0.5);
    const dist = length(center).mul(2.0);

    const ringRadius = uProgress.mul(1.2);
    const ringWidth = float(0.15).mul(float(1.0).sub(uProgress.mul(0.5)));

    const ring = smoothstep(ringRadius.sub(ringWidth), ringRadius.sub(ringWidth.mul(0.5)), dist)
        .mul(float(1.0).sub(
            smoothstep(ringRadius, ringRadius.add(ringWidth.mul(0.5)), dist),
        ));

    const fade = float(1.0).sub(uProgress).mul(uOpacity);
    const shockColor = vec3(0.9, 0.92, 1.0);
    const alpha = ring.mul(fade);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = shockColor;
    material.opacityNode = alpha;
    material.emissiveNode = shockColor.mul(alpha.mul(0.08)); // Reduced from 0.3

    return {
        material,
        uniforms: { uProgress, uOpacity },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. Dust Cloud Node Material
// ─────────────────────────────────────────────────────────────────────────────

export function createDustCloudNodeMaterial(params = {}) {
    const { pixelRatio = 1 } = params;

    const uTime = uniform(0);
    const uPixelRatio = uniform(pixelRatio);

    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');
    const aVelocity = attribute('aVelocity');

    // Vertex: billowing motion
    const centerNode = Fn(() => {
        const pos = positionLocal.sub(positionGeometry).toVar();
        pos.addAssign(aVelocity.mul(uTime));
        pos.y.addAssign(sin(uTime.mul(2.0).add(aPhase)).mul(20.0));
        pos.x.addAssign(cos(uTime.mul(1.5).add(aPhase)).mul(15.0));
        pos.y.addAssign(uTime.mul(30.0)); // Slow rise
        return pos;
    })();

    const fadeIn = smoothstep(0.0, 0.2, uTime);
    const life = float(1.0).sub(smoothstep(1.0, 4.5, uTime));
    const vAlpha = fadeIn.mul(life).mul(0.4);

    const grow = float(1.0).add(uTime.mul(0.5));
    const sizeNode = aSize.mul(grow);

    // Fragment
    const dist = length(uv().sub(0.5)).mul(2.0);
    const soft = pow(max(float(1.0).sub(smoothstep(0.0, 1.0, dist)), 0.0), 0.8);
    const dustColor = vec3(0.4, 0.38, 0.35);
    const alpha = soft.mul(vAlpha);

    const material = new MeshBasicNodeMaterial({
        colorNode: vec4(0.0),
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
    });

    material.positionNode = createBillboardPosition({ sizeNode, centerNode });
    material.colorNode = vec4(dustColor.x, dustColor.y, dustColor.z, alpha);
    material.emissiveNode = vec3(0);

    return {
        material,
        uniforms: { uTime, uPixelRatio },
        meta: { emitsBloom: false },
    };
}
