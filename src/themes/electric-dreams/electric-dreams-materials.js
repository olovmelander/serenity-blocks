/* eslint-disable import/no-unresolved */
/**
 * Electric Dreams Theme - TSL Node Materials
 * WebGPU materials for the lava lamp blob experience
 */
import {
    MeshBasicNodeMaterial,
    PointsNodeMaterial,
} from 'three/webgpu';
import {
    abs,
    Fn,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    floor,
    fract,
    instanceIndex,
    length,
    max,
    mix,
    normalLocal,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    storage,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// TSL Noise Helpers (3D)
// ─────────────────────────────────────────────────────────────────────────────

const tslHash3D = Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    p.assign(fract(p.mul(vec3(0.1031, 0.1030, 0.0973))));
    p.addAssign(dot(p, p.yzx.add(33.33)));
    return fract(p.x.add(p.y).mul(p.z));
});

const tslNoise3D = Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = tslHash3D(i);
    const b = tslHash3D(i.add(vec3(1.0, 0.0, 0.0)));
    const c = tslHash3D(i.add(vec3(0.0, 1.0, 0.0)));
    const d = tslHash3D(i.add(vec3(1.0, 1.0, 0.0)));
    const e = tslHash3D(i.add(vec3(0.0, 0.0, 1.0)));
    const f1 = tslHash3D(i.add(vec3(1.0, 0.0, 1.0)));
    const g = tslHash3D(i.add(vec3(0.0, 1.0, 1.0)));
    const h = tslHash3D(i.add(vec3(1.0, 1.0, 1.0)));

    const x1 = mix(a, b, u.x);
    const x2 = mix(c, d, u.x);
    const x3 = mix(e, f1, u.x);
    const x4 = mix(g, h, u.x);
    const y1 = mix(x1, x2, u.y);
    const y2 = mix(x3, x4, u.y);
    return mix(y1, y2, u.z);
});

const tslFbm3D = Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    const v = float(0.0).toVar();
    const a = float(0.5).toVar();
    v.addAssign(a.mul(tslNoise3D(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise3D(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise3D(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise3D(p)));
    return v;
});

// 2D noise for background
const tslHash2D = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

const tslNoise2D = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = tslHash2D(i);
    const b = tslHash2D(i.add(vec2(1.0, 0.0)));
    const c = tslHash2D(i.add(vec2(0.0, 1.0)));
    const d = tslHash2D(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

const tslFbm2D = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const v = float(0.0).toVar();
    const a = float(0.5).toVar();
    v.addAssign(a.mul(tslNoise2D(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise2D(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise2D(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise2D(p)));
    return v;
});

function resolveStorageAttr(storageNode, fallbackAccessor) {
    if (!storageNode) return fallbackAccessor;
    if (typeof storageNode.toAttribute === 'function') {
        return storageNode.toAttribute();
    }
    return fallbackAccessor;
}

function cloneColorInput(value, fallbackHex) {
    if (value?.isColor) {
        return value.clone();
    }
    return new THREE.Color(value ?? fallbackHex);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Blob Surface Material (main translucent blob)
// ─────────────────────────────────────────────────────────────────────────────

export function createBlobNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uColor = uniform(cloneColorInput(params.color, 0x00ffcc));
    const uPulseIntensity = uniform(0);
    const uMorphFactor = uniform(0);
    const uFlowDirection = uniform(new THREE.Vector3(0, 0.15, 1).normalize());
    const uFlowStrength = uniform(0);
    const uOpacity = uniform(Number.isFinite(params.opacity) ? params.opacity : 1);

    // Vertex deformation: FBM displacement along normal
    const slowTime = uTime.mul(0.15);
    const pos = positionLocal.toVar();
    const n1 = tslFbm3D(pos.mul(0.8).add(slowTime.mul(0.3)));
    const n2 = tslNoise3D(pos.mul(2.0).add(slowTime.mul(0.5))).mul(0.5);
    const n3 = tslNoise3D(pos.mul(4.0).sub(slowTime.mul(0.2))).mul(0.25);
    const totalNoise = n1.add(n2).add(n3);
    const displacement = totalNoise.mul(0.18).mul(float(0.42).add(uMorphFactor.mul(1.02)));
    const breathe = sin(uTime.mul(0.28)).mul(0.022).add(sin(uTime.mul(0.16)).mul(0.012));
    const deformedPosition = positionLocal.add(normalLocal.mul(displacement.add(breathe)));

    // Fragment: SSS + fresnel + internal light
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim = float(1.0).sub(max(dot(normalWorld, viewDir), 0.0));
    const fresnel = pow(rim, 2.8);
    const thinRim = pow(rim, 4.2);
    const centerMask = pow(max(float(1.0).sub(rim), 0.0), 1.7);
    const sss = pow(rim, 1.5);
    const pulse = float(1.0).add(sin(uTime.mul(1.2)).mul(0.026).mul(float(1.0).add(uPulseIntensity.mul(0.12))));
    const internalLight = float(0.08).add(totalNoise.mul(0.05)).add(centerMask.mul(0.04));

    // Internal caustic pattern (domain-warped noise)
    const flowOffset = uFlowDirection.mul(uTime.mul(0.22).mul(uFlowStrength.add(0.18)));
    const causticCoord = positionWorld.mul(0.6).add(flowOffset).add(
        vec3(uTime.mul(0.08), uTime.mul(-0.05), uTime.mul(0.06)),
    );
    const warpedCaustic = tslFbm3D(causticCoord.add(tslNoise3D(causticCoord.mul(1.5)).mul(0.8)));
    const causticPattern = pow(smoothstep(0.42, 0.78, warpedCaustic), 2.8).mul(0.22);
    const bodyShadow = float(0.05).add(centerMask.mul(0.12));
    const baseColor = uColor.mul(bodyShadow.add(internalLight)).mul(pulse).mul(0.58);
    const coreColor = uColor.mul(float(0.18).add(centerMask.mul(0.22)));
    const rimColor = mix(uColor.mul(1.08), vec3(1.0, 1.0, 1.0), 0.02).mul(thinRim.mul(0.26));
    const sssColor = uColor.mul(sss.mul(0.14));
    const causticColor = uColor.mul(0.54).mul(causticPattern);
    const finalColor = baseColor.add(coreColor).add(rimColor).add(sssColor).add(causticColor);
    const boostedColor = finalColor.mul(float(0.78).add(uPulseIntensity.mul(0.04)));

    const alpha = clamp(
        float(0.48).add(fresnel.mul(0.08)).sub(causticPattern.mul(0.05)).mul(uOpacity),
        0.0,
        0.82,
    );
    const emissiveColor = uColor.mul(
        causticPattern.mul(0.42)
            .add(thinRim.mul(0.18))
            .add(sss.mul(0.12))
            .add(uPulseIntensity.mul(0.1))
            .add(0.016),
    ).mul(uOpacity);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: THREE.FrontSide,
        depthWrite: true,
    });

    material.positionNode = deformedPosition;
    material.colorNode = boostedColor;
    material.opacityNode = alpha;
    material.emissiveNode = emissiveColor;

    return {
        material,
        uniforms: {
            uTime, uColor, uPulseIntensity, uMorphFactor, uFlowDirection, uFlowStrength, uOpacity,
        },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Blob Interior Material (caustic light patterns inside)
// ─────────────────────────────────────────────────────────────────────────────

export function createBlobInteriorNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uColor = uniform(cloneColorInput(params.color, 0x00ffcc));
    const uIntensity = uniform(Number.isFinite(params.intensity) ? params.intensity : 0.12);
    const uFlowDirection = uniform(new THREE.Vector3(0, 0.15, 1).normalize());
    const uFlowStrength = uniform(0);

    // Domain-warped high frequency noise for caustic-like patterns
    const causticBase = positionWorld.mul(1.2).add(uFlowDirection.mul(uFlowStrength.mul(2.1)));
    const warp = vec3(
        tslNoise3D(causticBase.add(vec3(uTime.mul(0.12), 0.0, 0.0))),
        tslNoise3D(causticBase.add(vec3(0.0, uTime.mul(0.1), 0.0))),
        tslNoise3D(causticBase.add(vec3(0.0, 0.0, uTime.mul(0.08)))),
    ).mul(1.5);
    const warpedPos = causticBase.add(warp);
    const caustic1 = tslFbm3D(warpedPos.mul(2.0));
    const caustic2 = tslFbm3D(warpedPos.mul(3.5).add(vec3(5.2, 1.3, 2.8)));
    const causticMask = pow(smoothstep(0.25, 0.65, caustic1.mul(0.6).add(caustic2.mul(0.4))), 2.5);

    const colorNode = uColor.mul(0.9).mul(causticMask).mul(uIntensity);
    const alpha = causticMask.mul(uIntensity).mul(0.24);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.FrontSide,
    });

    material.colorNode = colorNode;
    material.opacityNode = clamp(alpha, 0.0, 0.16);
    material.emissiveNode = colorNode.mul(0.1);

    return {
        material,
        uniforms: {
            uTime, uColor, uIntensity, uFlowDirection, uFlowStrength,
        },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Blob Glow Halo Material (outer glow shell)
// ─────────────────────────────────────────────────────────────────────────────

export function createBlobGlowNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uColor = uniform(cloneColorInput(params.color, 0x00ffcc));
    const uGlowIntensity = uniform(Number.isFinite(params.glowIntensity) ? params.glowIntensity : 0.52);
    const uOpacity = uniform(Number.isFinite(params.opacity) ? params.opacity : 1);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim = float(1.0).sub(max(dot(normalWorld, viewDir), 0.0));
    const halo = pow(rim, 2.4);
    const pulse = sin(uTime.mul(0.7)).mul(0.05).add(0.98);
    const colorNode = uColor.mul(halo)
        .mul(uGlowIntensity)
        .mul(pulse)
        .mul(1.18)
        .mul(uOpacity);
    const alpha = halo.mul(uGlowIntensity).mul(pulse).mul(0.34).mul(uOpacity);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
    });

    material.colorNode = colorNode;
    material.opacityNode = clamp(alpha, 0.0, 0.28);
    material.emissiveNode = colorNode.mul(0.34);

    return {
        material,
        uniforms: {
            uTime, uColor, uGlowIntensity, uOpacity,
        },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Spark Particle Material (GPU compute driven)
// ─────────────────────────────────────────────────────────────────────────────

export function createSparkNodeMaterial(params = {}) {
    const {
        pixelRatio = 1,
        sparkCompute = null,
    } = params;

    const useCompute = Boolean(
        sparkCompute?.getPositionBuffer
        && sparkCompute?.getMiscBuffer
        && Number.isFinite(sparkCompute?.count),
    );

    const uTime = uniform(0);
    const uPixelRatio = uniform(pixelRatio);
    const uComboIntensity = uniform(0);
    const uColorA = uniform(cloneColorInput(params.colorA, 0x00ffcc));
    const uColorB = uniform(cloneColorInput(params.colorB, 0xff00ff));

    const aColor = attribute('color', 'vec3');

    const positionStorage = useCompute
        ? storage(sparkCompute.getPositionBuffer(), 'vec4', sparkCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(sparkCompute.getMiscBuffer(), 'vec4', sparkCompute.count)
        : null;

    const positionAttr = useCompute
        ? resolveStorageAttr(positionStorage, positionStorage.element(instanceIndex))
        : null;
    const miscAttr = useCompute
        ? resolveStorageAttr(miscStorage, miscStorage.element(instanceIndex))
        : null;

    const basePosition = useCompute ? positionAttr.xyz : attribute('position', 'vec3');
    const particleSize = useCompute ? miscAttr.x : attribute('aSize');
    const particleLife = useCompute ? clamp(positionAttr.w, 0.0, 1.0) : float(1.0);
    const particleSeed = useCompute ? miscAttr.z : attribute('aSeed');
    const particlePosition = useCompute
        ? basePosition
        : basePosition.add(vec3(
            sin(uTime.mul(0.55).add(particleSeed.mul(17.0))).mul(0.35),
            cos(uTime.mul(0.32).add(particleSeed.mul(13.0))).mul(0.22),
            sin(uTime.mul(0.28).add(particleSeed.mul(29.0))).mul(0.16),
        ));

    const pulse = sin(uTime.mul(1.4).add(particleSeed.mul(8.0))).mul(0.08).add(0.9);
    const energy = useCompute
        ? particleLife.mul(0.52).add(0.2)
        : float(0.48).add(sin(uTime.mul(1.1).add(particleSeed.mul(13.0))).mul(0.1));
    const sizeNode = particleSize
        .mul(uPixelRatio)
        .mul(float(0.92).add(uComboIntensity.mul(0.24)))
        .mul(pulse)
        .mul(energy.add(0.18));

    const colorMix = useCompute ? miscAttr.y : particleSeed;
    const baseColor = mix(uColorA, uColorB, clamp(colorMix, 0.0, 1.0));
    const colorNode = baseColor
        .mul(aColor)
        .mul(float(0.76).add(energy.mul(0.18)).add(uComboIntensity.mul(0.16)));
    const alphaNode = clamp(
        energy.mul(pulse).mul(float(0.42).add(uComboIntensity.mul(0.08))),
        0.0,
        0.78,
    );

    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
    });

    material.positionNode = particlePosition;
    material.sizeNode = sizeNode;
    material.colorNode = colorNode;
    material.opacityNode = clamp(alphaNode, 0.0, 0.92);
    material.emissiveNode = colorNode.mul(alphaNode.mul(0.20));

    return {
        material,
        uniforms: {
            uTime, uPixelRatio, uComboIntensity, uColorA, uColorB,
        },
        meta: { emitsBloom: true, usesCompute: useCompute },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Micro Glints Material
// ─────────────────────────────────────────────────────────────────────────────

export function createMicroGlintsNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uHeat = uniform(Number.isFinite(params.heat) ? params.heat : 0);
    const aColor = attribute('color', 'vec3');
    const aSize = attribute('size', 'float');
    const centered = uv().sub(vec2(0.5, 0.5));
    const dist = length(centered).mul(2.0);
    const softGlow = pow(clamp(float(1.0).sub(dist), 0.0, 1.0), 4.0);
    const twinkle = sin(uTime.mul(1.4).add(positionWorld.x.mul(1.7)).add(positionWorld.y.mul(1.1))).mul(0.08).add(0.96);
    const heatBoost = float(0.92).add(uHeat.mul(0.34));
    const colorNode = aColor.mul(softGlow).mul(twinkle).mul(heatBoost).mul(1.25);
    const alphaNode = clamp(softGlow.mul(0.68).mul(heatBoost), 0.0, 0.82);

    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        vertexColors: true,
    });

    material.sizeNode = aSize.mul(float(1.1).add(uHeat.mul(0.45)));
    material.colorNode = colorNode;
    material.opacityNode = alphaNode;
    material.emissiveNode = colorNode.mul(alphaNode.mul(0.24));

    return {
        material,
        uniforms: { uTime, uHeat },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Hero Ribbon Material (instanced billboard quads)
// ─────────────────────────────────────────────────────────────────────────────

export function createHeroRibbonNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uIntensity = uniform(Number.isFinite(params.intensity) ? params.intensity : 1);
    const aColor = attribute('instanceColor', 'vec3');
    const uvNode = uv();
    const centered = uvNode.sub(vec2(0.5, 0.5));
    const widthMask = float(1.0).sub(smoothstep(0.16, 0.95, abs(centered.x).mul(2.0)));
    const tailMask = smoothstep(0.0, 0.12, uvNode.y)
        .mul(float(1.0).sub(smoothstep(0.84, 1.0, uvNode.y)));
    const headGlow = smoothstep(0.32, 1.0, uvNode.y);
    const pulse = sin(uTime.mul(1.8).add(uvNode.y.mul(18.0))).mul(0.08).add(0.96);
    const ribbonCore = pow(widthMask, 2.2).mul(tailMask);
    const colorNode = aColor
        .mul(ribbonCore.mul(0.88).add(headGlow.mul(0.22)))
        .mul(uIntensity)
        .mul(pulse);
    const alphaNode = clamp(
        ribbonCore.mul(0.72)
            .add(pow(widthMask, 4.0).mul(headGlow).mul(0.28))
            .mul(uIntensity),
        0.0,
        0.88,
    );

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = colorNode;
    material.opacityNode = alphaNode;
    material.emissiveNode = colorNode.mul(alphaNode.mul(0.62));

    return {
        material,
        uniforms: { uTime, uIntensity },
        meta: { emitsBloom: true },
    };
}

export function createHeroBeadNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uIntensity = uniform(Number.isFinite(params.intensity) ? params.intensity : 1);
    const aColor = attribute('instanceColor', 'vec3');
    const centered = uv().sub(vec2(0.5, 0.5));
    const dist = length(centered).mul(2.0);
    const core = clamp(float(1.0).sub(dist.mul(dist).mul(2.6)), 0.0, 1.0);
    const pulse = sin(uTime.mul(2.4).add(dist.mul(10.0))).mul(0.1).add(0.94);
    const ring = smoothstep(0.85, 0.2, dist).mul(smoothstep(0.0, 0.3, dist));
    const colorNode = aColor.mul(core.add(ring.mul(0.22))).mul(uIntensity).mul(pulse);
    const alphaNode = clamp(core.mul(0.8).add(ring.mul(0.18)).mul(uIntensity), 0.0, 0.9);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = colorNode;
    material.opacityNode = alphaNode;
    material.emissiveNode = colorNode.mul(alphaNode.mul(0.52));

    return {
        material,
        uniforms: { uTime, uIntensity },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Background Material (animated nebula/aurora)
// ─────────────────────────────────────────────────────────────────────────────

export function createBackgroundNodeMaterial() {
    const uTime = uniform(0);
    const uPulse = uniform(0);
    const uHeat = uniform(0);
    const uBeatPulse = uniform(0);
    const uActProgress = uniform(0);
    const uFieldTakeover = uniform(0);
    const uFarPodMix = uniform(1);
    const uAccentA = uniform(new THREE.Color(0x00ffcc));
    const uAccentB = uniform(new THREE.Color(0xff00ff));

    const worldDir = normalize(positionWorld);

    // Domain-warped FBM for aurora effect
    const warpCoord = worldDir.xz.mul(2.0).add(vec2(uTime.mul(0.015), uTime.mul(0.02)));
    const warpNoise = tslFbm2D(warpCoord.mul(0.8));
    const auroraCoord = worldDir.xz.mul(1.5).add(warpNoise.mul(1.2)).add(vec2(uTime.mul(0.01), uTime.mul(-0.008)));
    const aurora = tslFbm2D(auroraCoord);

    // Second layer for depth
    const nebulaCoord = worldDir.yz.mul(3.0).add(vec2(uTime.mul(-0.012), uTime.mul(0.009)));
    const nebulaNoise = tslFbm2D(nebulaCoord);
    const podA = smoothstep(0.55, 0.0, length(worldDir.xy.sub(vec2(-0.36, 0.18))));
    const podB = smoothstep(0.52, 0.0, length(worldDir.xy.sub(vec2(0.44, -0.08))));
    const podC = smoothstep(0.45, 0.0, length(worldDir.xy.sub(vec2(0.08, -0.42))));
    const cloudA = smoothstep(0.9, 0.12, length(worldDir.xy.sub(vec2(-0.22, -0.12))));
    const cloudB = smoothstep(0.95, 0.16, length(worldDir.xy.sub(vec2(0.28, 0.22))));
    const stageVeil = smoothstep(0.92, 0.08, abs(worldDir.x).add(abs(worldDir.y).mul(0.34)));
    const horizonGlow = smoothstep(-0.42, 0.22, worldDir.y).mul(smoothstep(0.86, 0.02, abs(worldDir.x)));
    const cathedralBands = pow(
        smoothstep(0.58, 0.02, abs(sin(worldDir.x.mul(14.0).add(uTime.mul(0.05))).mul(0.7).add(worldDir.y.mul(0.8)))),
        1.6,
    );

    // Atmospheric color mixing
    const deepPurple = vec3(0.045, 0.012, 0.08);
    const darkBlue = vec3(0.012, 0.025, 0.07);
    const pureBlack = vec3(0.014, 0.008, 0.03);
    const warmAmber = vec3(0.055, 0.022, 0.006);
    const tealPod = vec3(0.0, 0.09, 0.12).mul(podA.mul(0.50));
    const magentaPod = vec3(0.11, 0.025, 0.13).mul(podB.mul(0.45));
    const amberPod = vec3(0.13, 0.065, 0.012).mul(podC.mul(0.35));
    const cyanCloud = vec3(0.0, 0.024, 0.03).mul(cloudA.mul(0.70 + uHeat.mul(0.35)));
    const pinkCloud = vec3(0.034, 0.008, 0.04).mul(cloudB.mul(0.65 + uHeat.mul(0.3)));
    const veilColor = mix(uAccentA, uAccentB, clamp(worldDir.x.mul(0.5).add(0.5), 0.0, 1.0))
        .mul(stageVeil.mul(0.05 + uHeat.mul(0.04)));
    const horizonColor = mix(darkBlue, uAccentA.mul(0.42), clamp(horizonGlow, 0.0, 1.0))
        .mul(0.16 + uBeatPulse.mul(0.08));
    const bandColor = mix(uAccentA, uAccentB, clamp(aurora.mul(0.72).add(worldDir.y.mul(0.24)), 0.0, 1.0))
        .mul(cathedralBands.mul(0.06 + uActProgress.mul(0.04)));
    const accentPodA = uAccentA.mul(podA.mul(0.22 + uActProgress.mul(0.12))).mul(uFarPodMix);
    const accentPodB = uAccentB.mul(podB.mul(0.20 + uFieldTakeover.mul(0.08))).mul(uFarPodMix);

    const yMask = smoothstep(-1.0, 1.0, worldDir.y);
    const baseGrad = mix(pureBlack, deepPurple, yMask.mul(0.55));
    const auroraColor = mix(baseGrad, darkBlue, clamp(aurora.mul(0.45), 0.0, 0.30));
    const nebulaColor = mix(auroraColor, warmAmber, clamp(pow(nebulaNoise, 2.5).mul(0.14), 0.0, 0.08));
    const outerGlow = smoothstep(0.72, 0.08, length(worldDir.xy)).mul(0.20 + uBeatPulse.mul(0.14));
    const accentGlow = mix(uAccentA, uAccentB, clamp(aurora.mul(0.6).add(uFieldTakeover.mul(0.2)), 0.0, 1.0))
        .mul(outerGlow)
        .mul(uFarPodMix);

    // Pulse response (combo)
    const finalColor = nebulaColor
        .add(tealPod)
        .add(magentaPod)
        .add(amberPod)
        .add(cyanCloud)
        .add(pinkCloud)
        .add(veilColor)
        .add(horizonColor)
        .add(bandColor)
        .add(accentPodA)
        .add(accentPodB)
        .add(accentGlow)
        .mul(
            float(1.0)
                .add(uPulse.mul(0.30))
                .add(uHeat.mul(0.18))
                .add(uActProgress.mul(0.16))
                .add(uBeatPulse.mul(0.10)),
        );

    const material = new MeshBasicNodeMaterial({
        side: THREE.BackSide,
        fog: false,
    });

    material.colorNode = finalColor;
    material.emissiveNode = finalColor.mul(0.04);

    return {
        material,
        uniforms: {
            uTime,
            uPulse,
            uHeat,
            uBeatPulse,
            uActProgress,
            uFieldTakeover,
            uFarPodMix,
            uAccentA,
            uAccentB,
        },
        meta: { emitsBloom: false },
    };
}

export function createBoardHaloEmbersNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uEnergy = uniform(Number.isFinite(params.energy) ? params.energy : 0);
    const aColor = attribute('color', 'vec3');
    const aSize = attribute('size', 'float');
    const centered = uv().sub(vec2(0.5, 0.5));
    const dist = length(centered).mul(2.0);
    const glow = pow(clamp(float(1.0).sub(dist), 0.0, 1.0), 4.0);
    const ring = smoothstep(0.92, 0.36, dist).mul(smoothstep(0.12, 0.48, dist));
    const pulse = sin(uTime.mul(1.3).add(positionWorld.z.mul(0.8)).add(positionWorld.x.mul(0.35))).mul(0.07).add(0.97);
    const energyBoost = float(1.0).add(uEnergy.mul(0.42));
    const colorNode = aColor.mul(glow.mul(1.14).add(ring.mul(0.32))).mul(pulse).mul(energyBoost);
    const alphaNode = clamp(glow.mul(float(0.76).add(uEnergy.mul(0.16))).mul(pulse), 0.0, 0.88);

    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        vertexColors: true,
    });

    material.sizeNode = aSize.mul(float(1.16).add(uEnergy.mul(0.58)));
    material.colorNode = colorNode;
    material.opacityNode = alphaNode;
    material.emissiveNode = colorNode.mul(alphaNode.mul(0.3));

    return {
        material,
        uniforms: { uTime, uEnergy },
        meta: { emitsBloom: true },
    };
}

export function createBoardHaloNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uEnergy = uniform(Number.isFinite(params.energy) ? params.energy : 0.3);
    const uRingPulse = uniform(Number.isFinite(params.ringPulse) ? params.ringPulse : 0);
    const uSecondaryRing = uniform(Number.isFinite(params.secondaryRing) ? params.secondaryRing : 0);
    const uRowPulse = uniform(Number.isFinite(params.rowPulse) ? params.rowPulse : 0);
    const uTakeover = uniform(Number.isFinite(params.takeover) ? params.takeover : 0);
    const uBeatPulse = uniform(Number.isFinite(params.beatPulse) ? params.beatPulse : 0);
    const uLineFocusY = uniform(Number.isFinite(params.lineFocusY) ? params.lineFocusY : 0);
    const uLineFocusHeight = uniform(Number.isFinite(params.lineFocusHeight) ? params.lineFocusHeight : 0.18);
    const uAccentA = uniform(cloneColorInput(params.accentA, 0x62f6ff));
    const uAccentB = uniform(cloneColorInput(params.accentB, 0xff00ff));

    const centered = uv().sub(vec2(0.5, 0.5));
    const absCentered = abs(centered);
    const edgeDist = max(absCentered.x.mul(1.16), absCentered.y.mul(1.56));
    const innerMask = smoothstep(0.34, 0.49, edgeDist);
    const outerMask = float(1.0).sub(smoothstep(0.49, 0.64, edgeDist));
    const frameMask = innerMask.mul(outerMask);
    const perimeterWave = sin(uTime.mul(1.3).add(centered.x.mul(16.0)).add(centered.y.mul(11.0))).mul(0.08).add(0.96);
    const ringBand = smoothstep(0.18, 0.0, abs(edgeDist.sub(0.54)));
    const secondaryBand = smoothstep(0.1, 0.0, abs(edgeDist.sub(0.44)));
    const rowMask = smoothstep(
        uLineFocusHeight.add(0.06),
        uLineFocusHeight.mul(0.24),
        abs(centered.y.sub(uLineFocusY)),
    );
    const takeoverGlow = smoothstep(0.58, 0.1, length(centered)).mul(uTakeover.mul(0.38));
    const accentMix = clamp(centered.x.mul(0.6).add(0.5).add(uBeatPulse.mul(0.08)), 0.0, 1.0);
    const accentColor = mix(uAccentA, uAccentB, accentMix);
    const energyCore = frameMask
        .mul(float(0.12).add(uEnergy.mul(0.34)).add(uBeatPulse.mul(0.12)))
        .mul(perimeterWave);
    const ringGlow = ringBand.mul(uRingPulse.mul(0.7).add(uBeatPulse.mul(0.16)));
    const secondaryGlow = secondaryBand.mul(uSecondaryRing.mul(0.42));
    const rowGlow = rowMask.mul(uRowPulse.mul(0.26));
    const colorNode = accentColor
        .mul(energyCore.add(ringGlow).add(secondaryGlow))
        .add(uAccentA.mul(rowGlow.mul(0.75)))
        .add(uAccentB.mul(takeoverGlow.mul(0.6)));
    const alphaNode = clamp(
        energyCore.mul(0.34)
            .add(ringGlow.mul(0.24))
            .add(secondaryGlow.mul(0.18))
            .add(rowGlow.mul(0.22))
            .add(takeoverGlow.mul(0.16)),
        0.0,
        0.82,
    );

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = colorNode;
    material.opacityNode = alphaNode;
    material.emissiveNode = colorNode.mul(alphaNode.mul(0.70));

    return {
        material,
        uniforms: {
            uTime,
            uEnergy,
            uRingPulse,
            uSecondaryRing,
            uRowPulse,
            uTakeover,
            uBeatPulse,
            uLineFocusY,
            uLineFocusHeight,
            uAccentA,
            uAccentB,
        },
        meta: { emitsBloom: true },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Glass Reflection Overlay Material
// ─────────────────────────────────────────────────────────────────────────────

export function createGlassOverlayNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uOpacity = uniform(Number.isFinite(params.opacity) ? params.opacity : 0.025);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim = float(1.0).sub(max(dot(normalWorld, viewDir), 0.0));
    // Subtle glass reflection at edges
    const glassFresnel = pow(rim, 4.2);
    const shimmer = sin(uTime.mul(0.3).add(positionWorld.x.mul(0.5))).mul(0.015).add(0.96);
    const specHighlight = pow(glassFresnel, 2.0).mul(0.08);
    const colorNode = vec3(0.5, 0.62, 0.9).mul(glassFresnel.add(specHighlight)).mul(shimmer);
    const alpha = glassFresnel.mul(uOpacity);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
    });

    material.colorNode = colorNode;
    material.opacityNode = clamp(alpha, 0.0, 0.05);
    material.emissiveNode = colorNode.mul(0.015);

    return {
        material,
        uniforms: { uTime, uOpacity },
        meta: { emitsBloom: false },
    };
}
