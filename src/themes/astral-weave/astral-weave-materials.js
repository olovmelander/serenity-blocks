/* eslint-disable import/no-unresolved */
import {
    MeshBasicNodeMaterial,
    PointsNodeMaterial,
} from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    float,
    fract,
    floor,
    instanceIndex,
    length,
    max,
    mix,
    modelViewMatrix,
    normalLocal,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    storage,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import * as THREE from 'three';

const TAU = 6.28318530718;

const tslHash = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

const tslNoise = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = tslHash(i);
    const b = tslHash(i.add(vec2(1.0, 0.0)));
    const c = tslHash(i.add(vec2(0.0, 1.0)));
    const d = tslHash(i.add(vec2(1.0, 1.0)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

const tslFbm = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const v = float(0.0).toVar();
    const a = float(0.5).toVar();
    v.addAssign(a.mul(tslNoise(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise(p)));
    return v;
});

function resolveStorageAttr(storageNode, fallbackAccessor) {
    if (!storageNode) return fallbackAccessor;
    if (typeof storageNode.toAttribute === 'function') {
        return storageNode.toAttribute();
    }
    return fallbackAccessor;
}

const createBillboardQuadPosition = Fn(({
    centerNode,
    sizeNode,
    stretchXNode = float(1.0),
    stretchYNode = float(1.0),
    activeNode = float(1.0),
}) => {
    const center = vec3(centerNode).toVar();
    const toCameraVec = cameraPosition.sub(center);
    const toCamera = toCameraVec.div(max(length(toCameraVec), float(0.0001)));
    const worldUp = vec3(0.0, 1.0, 0.0);
    const altUp = vec3(1.0, 0.0, 0.0);
    const upBlend = smoothstep(0.97, 0.995, abs(dot(toCamera, worldUp)));
    const billboardUp = normalize(mix(worldUp, altUp, upBlend));
    const rightVec = cross(billboardUp, toCamera);
    const right = rightVec.div(max(length(rightVec), float(0.0001)));
    const upVec = cross(toCamera, right);
    const up = upVec.div(max(length(upVec), float(0.0001)));
    const localXY = positionLocal.xy;
    const worldOffset = right.mul(localXY.x.mul(sizeNode).mul(stretchXNode))
        .add(up.mul(localXY.y.mul(sizeNode).mul(stretchYNode)));
    return mix(vec3(0.0, 0.0, -9999.0), center.add(worldOffset), activeNode);
});

export function createAstralNexusCoreNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uEnergy = uniform(0);
    const uLinePulse = uniform(0);
    const uComboEnergy = uniform(0);
    const uColorA = uniform(params.colorA || new THREE.Color(0x73f8ff));
    const uColorB = uniform(params.colorB || new THREE.Color(0xd95bff));
    const uColorC = uniform(params.colorC || new THREE.Color(0xffdb72));

    const worldDir = normalize(positionWorld);
    const vNoise = tslFbm(worldDir.xz.mul(2.6).add(vec2(uTime.mul(0.06), uTime.mul(0.08))));
    const vNoise2 = tslFbm(worldDir.yz.mul(3.4).add(vec2(uTime.mul(-0.04), uTime.mul(0.05))));
    const coreMix = clamp(vNoise.mul(0.55).add(vNoise2.mul(0.45)).add(uComboEnergy.mul(0.05)), 0.0, 1.0);
    const baseColor = mix(uColorA, uColorB, coreMix);
    const wovenColor = mix(baseColor, uColorC, clamp(uLinePulse.mul(0.35).add(vNoise2.mul(0.25)), 0.0, 1.0));

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(max(dot(normalWorld, viewDir), 0.0)), 2.2);
    const pulse = sin(uTime.mul(2.3).add(vNoise.mul(TAU))).mul(0.08).add(0.82);
    const alpha = clamp(float(0.18).add(fresnel.mul(0.12)).add(uEnergy.mul(0.05)).mul(pulse), 0.0, 0.5);
    const emissive = wovenColor.mul(float(0.12).add(fresnel.mul(0.16)).add(uEnergy.mul(0.08)));

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = wovenColor;
    material.opacityNode = alpha;
    material.emissiveNode = emissive;

    return {
        material,
        uniforms: {
            uTime,
            uEnergy,
            uLinePulse,
            uComboEnergy,
            uColorA,
            uColorB,
            uColorC,
        },
        meta: { emitsBloom: true },
    };
}

export function createAstralNexusShellNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uEnergy = uniform(0);
    const uColorA = uniform(params.colorA || new THREE.Color(0x4ac4ff));
    const uColorB = uniform(params.colorB || new THREE.Color(0xe382ff));
    const uOpacity = uniform(Number.isFinite(params.opacity) ? params.opacity : 0.26);
    const uPulseBias = uniform(Number.isFinite(params.pulseBias) ? params.pulseBias : 0.18);

    const worldDir = normalize(positionWorld);
    const shellNoise = tslFbm(worldDir.xy.mul(4.2).add(vec2(uTime.mul(0.04), uTime.mul(-0.03))));
    const strandNoise = tslFbm(worldDir.zy.mul(6.0).add(vec2(uTime.mul(0.09), uTime.mul(0.05))));
    const colorMix = clamp(shellNoise.mul(0.6).add(strandNoise.mul(0.4)), 0.0, 1.0);
    const baseColor = mix(uColorA, uColorB, colorMix);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(max(dot(normalWorld, viewDir), 0.0)), 2.8);
    const shellMask = smoothstep(0.12, 0.95, shellNoise.add(fresnel.mul(0.65)));
    const alpha = shellMask.mul(uOpacity).mul(float(0.42).add(uEnergy.mul(uPulseBias.mul(0.28))));
    const emissive = baseColor.mul(alpha.mul(0.22).add(fresnel.mul(0.05)));

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: params.additive === true ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = baseColor;
    material.opacityNode = clamp(alpha, 0.0, 0.9);
    material.emissiveNode = emissive;

    return {
        material,
        uniforms: {
            uTime,
            uEnergy,
            uColorA,
            uColorB,
            uOpacity,
            uPulseBias,
        },
        meta: { emitsBloom: true },
    };
}

export function createAstralRibbonNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uEnergy = uniform(0);
    const uLinePulse = uniform(0);
    const uComboEnergy = uniform(0);
    const uFlowSpeed = uniform(Number.isFinite(params.flowSpeed) ? params.flowSpeed : 1);
    const uPulseOffset = uniform(Number.isFinite(params.pulseOffset) ? params.pulseOffset : 0);
    const uColorA = uniform(params.colorA || new THREE.Color(0x73f8ff));
    const uColorB = uniform(params.colorB || new THREE.Color(0xd95bff));
    const uColorC = uniform(params.colorC || new THREE.Color(0xffdb72));

    const vUv = uv();
    const centerMask = pow(max(float(1.0).sub(abs(vUv.y.sub(0.5)).mul(2.0)), 0.0), 1.5);
    const braidA = sin(vUv.x.mul(TAU * 4.0).sub(uTime.mul(uFlowSpeed).mul(1.3)).add(uPulseOffset));
    const braidB = sin(vUv.x.mul(TAU * 7.0).add(vUv.y.mul(18.0)).sub(uTime.mul(uFlowSpeed).mul(2.0)));
    const braidMask = clamp(braidA.mul(0.32).add(braidB.mul(0.24)).add(0.7), 0.0, 1.0);
    const pulsePacket = pow(
        max(
            sin(vUv.x.mul(TAU * 2.2).sub(uTime.mul(3.4)).add(uPulseOffset)).mul(0.5).add(0.5),
            0.0,
        ),
        3.0,
    );
    const noise = tslFbm(vUv.mul(vec2(7.0, 3.2)).add(vec2(uTime.mul(0.08), uTime.mul(-0.04))));
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(max(dot(normalWorld, viewDir), 0.0)), 2.2);

    const baseColor = mix(uColorA, uColorB, clamp(vUv.x.mul(0.65).add(noise.mul(0.25)), 0.0, 1.0));
    const wovenColor = mix(baseColor, uColorC, clamp(pulsePacket.mul(0.6).add(uLinePulse.mul(0.18)), 0.0, 1.0));
    const travelPhase = vUv.x.mul(TAU).sub(uTime.mul(uFlowSpeed));
    const comboWarp = float(0.12).add(uComboEnergy.mul(0.05)).add(uLinePulse.mul(0.04));
    const flowDisplacement = vec3(
        sin(travelPhase.mul(2.4).add(uPulseOffset)).mul(comboWarp),
        cos(travelPhase.mul(3.1).sub(uPulseOffset.mul(1.4))).mul(comboWarp.mul(0.85))
            .add(noise.sub(0.5).mul(0.08)),
        sin(travelPhase.mul(1.7).add(vUv.y.mul(TAU * 2.0)).sub(uPulseOffset.mul(0.8))).mul(comboWarp.mul(0.78)),
    );
    
    // Ribbon pulsation Wave (width swell)
    const pulseWave = sin(vUv.x.mul(TAU * 8.0).sub(uTime.mul(uFlowSpeed).mul(3.5)).add(uPulseOffset))
        .mul(0.06)
        .mul(float(1.0).add(uLinePulse.mul(1.5).add(uComboEnergy.mul(0.8))));
    const shellBreath = normalLocal.mul(
        pulseWave.add(sin(travelPhase.mul(3.2)).mul(0.02).mul(float(1.0).add(uEnergy.mul(0.2))))
    );
    
    // High-end glowing neon emissive
    const emissiveColor = wovenColor.mul(
        float(1.15)
            .add(centerMask.mul(0.4))
            .add(pulsePacket.mul(1.2))
            .add(uComboEnergy.mul(0.85))
            .add(fresnel.mul(0.3))
    );
    const alpha = centerMask
        .mul(float(0.26).add(braidMask.mul(0.18)))
        .mul(float(0.88).add(uEnergy.mul(0.12)))
        .mul(float(0.88).add(fresnel.mul(0.12)));

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.positionNode = positionLocal.add(flowDisplacement).add(shellBreath);
    material.colorNode = wovenColor;
    material.opacityNode = clamp(alpha, 0.0, 0.95);
    material.emissiveNode = emissiveColor;

    return {
        material,
        uniforms: {
            uTime,
            uEnergy,
            uLinePulse,
            uComboEnergy,
            uFlowSpeed,
            uPulseOffset,
            uColorA,
            uColorB,
            uColorC,
        },
        meta: { emitsBloom: true },
    };
}

export function createAstralStarfieldNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio || 1);
    const uScintillation = uniform(0);
    const uDiffractionStrength = uniform(Number.isFinite(params.diffractionStrength) ? params.diffractionStrength : 0.28);

    const aSize = attribute('aSize');
    const aTwinkle = attribute('aTwinkle', 'vec2');
    const aBrightness = attribute('aBrightness');
    const aColor = attribute('color', 'vec3');

    const positionNode = Fn(() => positionLocal)();
    const mvPosition = modelViewMatrix.mul(vec4(positionLocal.x, positionLocal.y, positionLocal.z, 1.0));
    const depthFactor = smoothstep(90.0, 260.0, abs(positionLocal.z));
    const attenuation = float(320.0).div(max(mvPosition.z.negate(), 0.001));
    const sizeNode = clamp(
        aSize.mul(uPixelRatio).mul(attenuation).mul(float(0.9).add(depthFactor.mul(0.55))),
        1.0,
        96.0,
    );

    const twinkle = sin(uTime.mul(aTwinkle.y).add(aTwinkle.x)).mul(0.28).add(0.82);
    const localUv = uv().sub(0.5);
    const dist = length(localUv).mul(2.0);
    const softCircle = pow(max(float(1.0).sub(smoothstep(0.0, 1.0, dist)), 0.0), 1.2);
    const spikeX = pow(max(float(1.0).sub(smoothstep(0.0, 0.24, abs(localUv.x))), 0.0), 3.0);
    const spikeY = pow(max(float(1.0).sub(smoothstep(0.0, 0.24, abs(localUv.y))), 0.0), 3.0);
    const diffraction = spikeX.add(spikeY).mul(0.5).mul(uDiffractionStrength).mul(aBrightness);
    const starBrightness = aBrightness.mul(twinkle).mul(float(1.0).add(uScintillation.mul(0.45)));
    const colorNode = aColor.mul(starBrightness).mul(float(1.15).add(depthFactor.mul(0.25)));
    const alphaNode = softCircle.mul(starBrightness.add(0.12)).add(diffraction.mul(0.55));

    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
    });

    material.positionNode = positionNode;
    material.sizeNode = sizeNode;
    material.colorNode = colorNode;
    material.opacityNode = clamp(alphaNode, 0.0, 1.0);
    material.emissiveNode = colorNode.mul(alphaNode.mul(0.14)).add(vec3(diffraction.mul(0.08)));

    return {
        material,
        uniforms: {
            uTime,
            uPixelRatio,
            uScintillation,
            uDiffractionStrength,
        },
        meta: { emitsBloom: true },
    };
}

export function createAstralNebulaNodeMaterial(params = {}) {
    const tex = params.texture;
    const uTime = uniform(0);
    const uOpacity = uniform(Number.isFinite(params.opacity) ? params.opacity : 0.22);
    const uPulse = uniform(0);
    const uDrift = uniform(Number.isFinite(params.drift) ? params.drift : 0.16);
    const uTintA = uniform(params.tintA || new THREE.Color(0x2d8cff));
    const uTintB = uniform(params.tintB || new THREE.Color(0xdc64ff));
    const uTintC = uniform(params.tintC || new THREE.Color(0xffdb72));

    const vUv = uv();
    const texNode = texture(tex);
    const warped = vec2(
        vUv.x.add(sin(vUv.y.mul(6.0).add(uTime.mul(uDrift))).mul(0.06)).add(cos(vUv.x.mul(3.5).sub(uTime.mul(uDrift.mul(0.4)))).mul(0.04)),
        vUv.y.add(cos(vUv.x.mul(5.0).sub(uTime.mul(uDrift.mul(0.8)))).mul(0.055)).add(sin(vUv.y.mul(4.0).add(uTime.mul(uDrift.mul(0.5)))).mul(0.035)),
    );
    const detail = tslFbm(warped.mul(vec2(5.5, 3.2)).add(vec2(uTime.mul(0.06), uTime.mul(-0.04))));
    const edgeFade = smoothstep(0.03, 0.28, vUv.x)
        .mul(smoothstep(0.97, 0.72, vUv.x))
        .mul(smoothstep(0.02, 0.28, vUv.y))
        .mul(smoothstep(0.98, 0.72, vUv.y));
    const tintMix1 = clamp(detail.mul(0.72).add(texNode.r.mul(0.28)), 0.0, 1.0);
    const tintMix2 = clamp(sin(warped.x.mul(3.0).add(detail.mul(2.0))).mul(0.5).add(0.5).add(uPulse.mul(0.12)), 0.0, 1.0);
    
    let colorNode = mix(uTintA, uTintB, tintMix1);
    colorNode = mix(colorNode, uTintC, tintMix2.mul(0.42))
        .mul(texNode.rgb.add(0.18))
        .mul(float(0.85).add(uPulse.mul(0.35)));

    const alphaNode = texNode.a
        .mul(float(0.4).add(detail.mul(0.7)))
        .mul(edgeFade)
        .mul(uOpacity)
        .mul(float(1.0).add(uPulse.mul(0.25)));

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = colorNode;
    material.opacityNode = clamp(alphaNode, 0.0, 0.8);
    material.emissiveNode = colorNode.mul(alphaNode.mul(0.04));

    return {
        material,
        uniforms: {
            uTime,
            uOpacity,
            uPulse,
            uDrift,
            uTintA,
            uTintB,
            uTintC,
        },
        meta: { emitsBloom: true },
    };
}

export function createAstralFlowParticleNodeMaterial(params = {}) {
    const {
        pixelRatio = 1,
        flowCompute = null,
        opacity = 0.22,
        emissiveScale = 0.05,
    } = params;

    const useCompute = Boolean(
        flowCompute?.getPositionBuffer
        && flowCompute?.getMiscBuffer
        && flowCompute?.getStateBuffer
        && Number.isFinite(flowCompute?.count),
    );

    const uTime = uniform(0);
    const uPixelRatio = uniform(pixelRatio);
    const uLinePulse = uniform(0);
    const uComboEnergy = uniform(0);
    const uOpacity = uniform(opacity);
    const uColorA = uniform(params.colorA || new THREE.Color(0x6feeff));
    const uColorB = uniform(params.colorB || new THREE.Color(0xff71e4));
    const uColorC = uniform(params.colorC || new THREE.Color(0xffd96d));

    const aCenter = useCompute ? null : attribute('aCenter', 'vec3');
    const aSize = useCompute ? null : attribute('aSize');
    const aSeed = useCompute ? null : attribute('aSeed');
    const aTone = useCompute ? null : attribute('aTone');
    const aColor = attribute('color', 'vec3');

    const positionStorage = useCompute
        ? storage(flowCompute.getPositionBuffer(), 'vec4', flowCompute.count)
        : null;
    const stateStorage = useCompute
        ? storage(flowCompute.getStateBuffer(), 'vec4', flowCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(flowCompute.getMiscBuffer(), 'vec4', flowCompute.count)
        : null;

    const positionAttr = useCompute ? resolveStorageAttr(positionStorage, positionStorage.element(instanceIndex)) : null;
    const stateAttr = useCompute ? resolveStorageAttr(stateStorage, stateStorage.element(instanceIndex)) : null;
    const miscAttr = useCompute ? resolveStorageAttr(miscStorage, miscStorage.element(instanceIndex)) : null;

    const particlePosition = useCompute ? positionAttr.xyz : aCenter;
    const particlePhase = useCompute ? stateAttr.x : aSeed.mul(TAU);
    const particleSize = useCompute ? miscAttr.x : aSize;
    const particleTone = useCompute ? miscAttr.z : aTone;
    const particleSeed = useCompute ? miscAttr.y : aSeed;

    const mvPosition = modelViewMatrix.mul(vec4(
        particlePosition.x,
        particlePosition.y,
        particlePosition.z,
        1.0,
    ));
    const attenuation = float(240.0).div(max(mvPosition.z.negate(), 0.001));
    const pulse = sin(uTime.mul(1.8).add(particlePhase.mul(1.1)).add(particleSeed.mul(8.0))).mul(0.18).add(0.82);
    const dist = length(uv().sub(0.5)).mul(2.0);
    const soft = pow(max(float(1.0).sub(smoothstep(0.0, 1.0, dist)), 0.0), 1.3);
    const core = smoothstep(0.22, 0.0, dist).mul(0.32);
    const sizeNode = particleSize
        .mul(uPixelRatio)
        .mul(attenuation)
        .mul(float(1.15).add(uComboEnergy.mul(0.22)))
        .mul(float(0.84).add(pulse.mul(0.34)));

    const baseColor = mix(uColorA, uColorB, clamp(particleTone, 0.0, 1.0));
    const colorNode = mix(baseColor, uColorC, clamp(uLinePulse.mul(0.24).add(particleSeed.mul(0.15)), 0.0, 1.0))
        .mul(aColor)
        .mul(float(0.95).add(uComboEnergy.mul(0.18)));
    const alphaNode = soft
        .add(core)
        .mul(uOpacity)
        .mul(float(0.72).add(uComboEnergy.mul(0.16)))
        .mul(float(0.88).add(uLinePulse.mul(0.12)))
        .mul(pulse);

    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
    });

    material.positionNode = particlePosition;
    material.sizeNode = clamp(sizeNode, 1.0, 18.0);
    material.colorNode = colorNode;
    material.opacityNode = clamp(alphaNode, 0.0, 1.0);
    material.emissiveNode = colorNode.mul(alphaNode.mul(emissiveScale).add(core.mul(0.05)));

    return {
        material,
        uniforms: {
            uTime,
            uPixelRatio,
            uLinePulse,
            uComboEnergy,
            uOpacity,
            uColorA,
            uColorB,
            uColorC,
        },
        meta: { emitsBloom: true, usesCompute: useCompute },
    };
}

export function createAstralBurstNodeMaterial(params = {}) {
    const {
        pixelRatio = 1,
        burstCompute = null,
    } = params;

    const useCompute = Boolean(
        burstCompute?.getPositionBuffer
        && burstCompute?.getMiscBuffer
        && Number.isFinite(burstCompute?.count),
    );

    const uTime = uniform(0);
    const uPixelRatio = uniform(pixelRatio);
    const uEnergy = uniform(0);
    const uColorA = uniform(params.colorA || new THREE.Color(0x73f8ff));
    const uColorB = uniform(params.colorB || new THREE.Color(0xff8de1));
    const uColorC = uniform(params.colorC || new THREE.Color(0xffd96d));

    const aCenter = useCompute ? null : attribute('aCenter', 'vec3');
    const aSize = useCompute ? null : attribute('aSize');
    const aSeed = useCompute ? null : attribute('aSeed');
    const aColor = attribute('color', 'vec3');

    const positionStorage = useCompute
        ? storage(burstCompute.getPositionBuffer(), 'vec4', burstCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(burstCompute.getMiscBuffer(), 'vec4', burstCompute.count)
        : null;

    const positionAttr = useCompute ? resolveStorageAttr(positionStorage, positionStorage.element(instanceIndex)) : null;
    const miscAttr = useCompute ? resolveStorageAttr(miscStorage, miscStorage.element(instanceIndex)) : null;

    const particlePosition = useCompute ? positionAttr.xyz : aCenter;
    const particleActive = useCompute ? positionAttr.w : float(1.0);
    const particleSize = useCompute ? miscAttr.x : aSize;
    const particleLife = useCompute ? miscAttr.y : float(1.0).sub(sin(uTime).mul(0.5).add(0.5));
    const particleSeed = useCompute ? miscAttr.z : aSeed;
    const particleTone = useCompute ? miscAttr.w : aSeed;

    const pulse = sin(uTime.mul(8.0).add(particleSeed.mul(10.0))).mul(0.2).add(0.8);
    const dist = length(uv().sub(0.5)).mul(2.0);
    const glow = pow(max(float(1.0).sub(smoothstep(0.0, 1.0, dist)), 0.0), 1.0);
    const sizeNode = particleSize
        .mul(float(0.09))
        .mul(clamp(uPixelRatio.mul(0.68), 0.9, 1.3))
        .mul(float(1.0).add(uEnergy.mul(0.12)))
        .mul(max(particleLife, float(0.05)));
    const stretchY = float(1.08).add(particleSeed.mul(0.26)).add(uEnergy.mul(0.04));
    const burstColor = mix(uColorA, uColorB, particleTone);
    const colorNode = mix(burstColor, uColorC, clamp(particleLife.mul(0.4).add(particleSeed.mul(0.18)), 0.0, 1.0)).mul(aColor);
    const alphaNode = glow.mul(particleLife).mul(pulse).mul(0.42).mul(particleActive);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    material.positionNode = createBillboardQuadPosition({
        centerNode: particlePosition,
        sizeNode,
        stretchXNode: float(0.72),
        stretchYNode: stretchY,
        activeNode: particleActive,
    });
    material.colorNode = colorNode;
    material.opacityNode = clamp(alphaNode, 0.0, 1.0);
    material.emissiveNode = colorNode.mul(alphaNode.mul(0.1));

    return {
        material,
        uniforms: {
            uTime,
            uPixelRatio,
            uEnergy,
            uColorA,
            uColorB,
            uColorC,
        },
        meta: { emitsBloom: true, usesCompute: useCompute },
    };
}

export function createAstralShockwaveNodeMaterial(params = {}) {
    const uProgress = uniform(0);
    const uOpacity = uniform(Number.isFinite(params.opacity) ? params.opacity : 1);
    const uColorA = uniform(params.colorA || new THREE.Color(0x73f8ff));
    const uColorB = uniform(params.colorB || new THREE.Color(0xff8de1));

    const centered = uv().sub(0.5);
    const dist = length(centered).mul(2.0);
    const ringRadius = uProgress.mul(1.18);
    const ringWidth = float(0.12).mul(float(1.0).sub(uProgress.mul(0.5)));
    const ring = smoothstep(ringRadius.sub(ringWidth), ringRadius.sub(ringWidth.mul(0.35)), dist)
        .mul(smoothstep(ringRadius.add(ringWidth.mul(0.35)), ringRadius, dist));
    const fade = float(1.0).sub(uProgress).mul(uOpacity);
    const ringColor = mix(uColorA, uColorB, uProgress.mul(0.75));
    const alpha = ring.mul(fade);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = ringColor;
    material.opacityNode = clamp(alpha, 0.0, 1.0);
    material.emissiveNode = ringColor.mul(alpha.mul(0.25));

    return {
        material,
        uniforms: {
            uProgress,
            uOpacity,
            uColorA,
            uColorB,
            uColorC: uniform(new THREE.Color(0xffdb72)),
        },
        meta: { emitsBloom: true },
    };
}

export function createAstralLightShaftNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uOpacity = uniform(Number.isFinite(params.opacity) ? params.opacity : 0.28);
    const uPulse = uniform(0);
    const uColorA = uniform(params.colorA || new THREE.Color(0x73f8ff));
    const uColorB = uniform(params.colorB || new THREE.Color(0xd95bff));
    const uScrollSpeed = uniform(params.scrollSpeed || 0.45);

    const vUv = uv();
    
    const vertFade = smoothstep(float(0.0), float(0.22), vUv.y).mul(smoothstep(float(1.0), float(0.42), vUv.y));
    const radFade = smoothstep(float(0.5), float(0.0), abs(vUv.x.sub(0.5)));
    
    const noiseCoords = vec2(vUv.x.mul(2.2), vUv.y.mul(0.45).sub(uTime.mul(uScrollSpeed)));
    const shaftNoise = tslFbm(noiseCoords);
    
    const pulseFactor = float(1.0).add(uPulse.mul(0.4));
    const finalColor = mix(uColorA, uColorB, shaftNoise.mul(0.75)).mul(pulseFactor);
    const alpha = vertFade.mul(radFade).mul(shaftNoise.mul(0.68).add(0.32)).mul(uOpacity).mul(pulseFactor);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = finalColor;
    material.opacityNode = clamp(alpha, 0.0, 0.9);
    material.emissiveNode = finalColor.mul(alpha.mul(0.22));

    return {
        material,
        uniforms: {
            uTime,
            uOpacity,
            uPulse,
            uColorA,
            uColorB,
        },
        meta: { emitsBloom: true },
    };
}

export function createAstralConstellationNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uOpacity = uniform(Number.isFinite(params.opacity) ? params.opacity : 0.45);
    const uScintillation = uniform(0);
    const uColorA = uniform(params.colorA || new THREE.Color(0x73f8ff));
    const uColorB = uniform(params.colorB || new THREE.Color(0xd95bff));

    const vUv = uv();
    
    const twinkle = sin(uTime.mul(2.8).add(vUv.x.mul(12.0))).mul(0.22).add(0.78);
    const pulseFactor = twinkle.mul(float(1.0).add(uScintillation.mul(0.5)));
    
    const finalColor = mix(uColorA, uColorB, vUv.x).mul(pulseFactor);
    const alpha = uOpacity.mul(pulseFactor).mul(smoothstep(float(0.0), float(0.12), vUv.x).mul(smoothstep(float(1.0), float(0.88), vUv.x)));

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    material.colorNode = finalColor;
    material.opacityNode = clamp(alpha, 0.0, 0.85);
    material.emissiveNode = finalColor.mul(alpha.mul(0.15));

    return {
        material,
        uniforms: {
            uTime,
            uOpacity,
            uScintillation,
            uColorA,
            uColorB,
        },
        meta: { emitsBloom: true },
    };
}
