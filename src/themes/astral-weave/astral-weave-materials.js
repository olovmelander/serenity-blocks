/* eslint-disable import/no-unresolved */
import {
    MeshBasicNodeMaterial,
    PointsNodeMaterial,
} from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    float,
    fract,
    floor,
    fwidth,
    instanceIndex,
    length,
    max,
    mix,
    modelViewMatrix,
    normalLocal,
    normalWorld,
    normalize,
    positionLocal,
    positionGeometry,
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
import * as THREE from 'three/webgpu';

const TAU = 6.28318530718;

const tslHash = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}).setLayout({ name: 'astralWeaveHash2', type: 'float', inputs: [{ name: 'pInput', type: 'vec2' }] });

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
}).setLayout({ name: 'astralWeaveNoise2', type: 'float', inputs: [{ name: 'pInput', type: 'vec2' }] });

const tslFbm = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const v = float(0.0).toVar();
    const a = float(0.5).toVar();
    v.addAssign(a.mul(tslNoise(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise(p))); p.mulAssign(2.0); a.mulAssign(0.5);
    v.addAssign(a.mul(tslNoise(p)));
    return v;
}).setLayout({ name: 'astralWeaveFbm2', type: 'float', inputs: [{ name: 'pInput', type: 'vec2' }] });

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

    // Sample the pearl itself: world-space normalization collapses the pattern
    // when the nexus is translated away from the scene origin.
    const localDir = normalize(positionGeometry);
    const vNoise = tslNoise(localDir.xz.mul(2.4).add(vec2(uTime.mul(0.04), uTime.mul(0.055))));
    const filamentPhase = localDir.y.mul(19.0).add(localDir.x.mul(4.0))
        .add(vNoise.mul(5.0)).sub(uTime.mul(0.36));
    const filaments = pow(sin(filamentPhase).mul(0.5).add(0.5), 12.0);
    const coreMix = clamp(localDir.y.mul(0.28).add(vNoise.mul(0.56)).add(0.2), 0.0, 1.0);
    const baseColor = mix(uColorA, uColorB, coreMix);
    const pearl = vec3(0.72, 0.88, 1.0);
    const warmFlare = filaments.mul(uLinePulse.mul(0.24).add(uComboEnergy.mul(0.1)));
    const wovenColor = mix(baseColor, uColorC, clamp(warmFlare, 0.0, 0.34));

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(normalWorld, viewDir));
    const fresnel = pow(float(1.0).sub(facing), 2.3);
    const pearlLight = pow(max(dot(normalWorld, normalize(vec3(-0.4, 0.8, 0.65))), 0.0), 7.0);
    const pulse = sin(uTime.mul(1.35)).mul(0.045).add(0.92);
    const colorNode = wovenColor.mul(float(0.48).add(fresnel.mul(0.65)).add(filaments.mul(0.28)))
        .add(pearl.mul(pearlLight.mul(0.8).add(fresnel.mul(0.16))));
    const alpha = clamp(float(0.32).add(fresnel.mul(0.24)).add(filaments.mul(0.08))
        .add(uEnergy.mul(0.025))
        .mul(pulse), 0.0, 0.75);
    const emissive = wovenColor.mul(fresnel.mul(0.48).add(filaments.mul(0.12))
        .add(uEnergy.mul(0.12))).add(pearl.mul(pearlLight.mul(0.12)));

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = colorNode;
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

    const shellUv = uv();
    const wave = sin(shellUv.x.mul(TAU * 3.0).sub(uTime.mul(0.3))).mul(0.5).add(0.5);
    const strand = pow(sin(shellUv.y.mul(TAU * 3.0).add(shellUv.x.mul(12.0))
        .sub(uTime.mul(0.8))).mul(0.5).add(0.5), 8.0);
    const colorMix = clamp(wave.mul(0.72).add(shellUv.y.mul(0.28)), 0.0, 1.0);
    const baseColor = mix(uColorA, uColorB, colorMix);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(abs(dot(normalWorld, viewDir))), 2.4);
    const alpha = uOpacity.mul(float(0.58).add(fresnel.mul(0.85)).add(strand.mul(0.34)))
        .mul(float(1.0).add(uEnergy.mul(uPulseBias)));
    const shellColor = baseColor.mul(float(0.85).add(strand.mul(0.8)).add(fresnel.mul(0.4)))
        .add(vec3(0.7, 0.82, 1.0).mul(fresnel.mul(0.18)));
    const emissive = baseColor.mul(strand.mul(0.32).add(fresnel.mul(0.44)).add(uEnergy.mul(0.08)));

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: params.additive === true ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = shellColor;
    material.forceSinglePass = params.additive === true;
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
    const uLineWaveProgress = uniform(1);
    const uWeaveCharge = uniform(0);
    const uCrownPulse = uniform(0);
    const uEventHue = uniform(0);
    const uEventColor = uniform(params.eventColor || new THREE.Color(0xffd293));
    const uFlowSpeed = uniform(Number.isFinite(params.flowSpeed) ? params.flowSpeed : 1);
    const uPulseOffset = uniform(Number.isFinite(params.pulseOffset) ? params.pulseOffset : 0);
    const uOpacity = uniform(Number.isFinite(params.opacity) ? params.opacity : 0.54);
    const uColorA = uniform(params.colorA || new THREE.Color(0x73f8ff));
    const uColorB = uniform(params.colorB || new THREE.Color(0xd95bff));
    const uColorC = uniform(params.colorC || new THREE.Color(0xff8de1));

    // UV x follows the complete ribbon from the loom; UV y spans the silk.
    // Broad bodies and fine threads keep the weave readable without neon tubes.
    const vUv = uv();
    const width = abs(vUv.y.sub(0.5)).mul(2.0);
    const widthFade = float(1.0).sub(smoothstep(0.8, 1.0, width));
    const lengthFade = smoothstep(0.0, 0.055, vUv.x)
        .mul(float(1.0).sub(smoothstep(0.86, 1.0, vUv.x)));
    const body = pow(max(float(1.0).sub(width.mul(width)), 0.0), 0.45);
    const travel = vUv.x.mul(TAU * 2.1).sub(uTime.mul(uFlowSpeed).mul(0.35)).add(uPulseOffset);
    const fold = sin(travel.add(vUv.y.mul(3.0))).mul(0.5).add(0.5);
    const fiberWarp = sin(vUv.x.mul(19.0).sub(uTime.mul(0.35)).add(uPulseOffset)).mul(0.13);
    const finePhase = vUv.y.mul(TAU * 28.0).add(fiberWarp);
    const fineVisibility = float(1.0).sub(smoothstep(0.7, 2.8, fwidth(finePhase)));
    const fineThreads = pow(sin(finePhase).mul(0.5).add(0.5), 10.0).mul(fineVisibility);
    const broadThreads = pow(sin(vUv.y.mul(TAU * 6.0).add(fiberWarp.mul(0.6)))
        .mul(0.5).add(0.5), 14.0);
    const edgeThread = float(1.0).sub(smoothstep(0.018, 0.085, abs(width.sub(0.82))));

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(abs(dot(normalWorld, viewDir))), 2.0);
    const sheen = pow(fold, 5.0).mul(body);
    const colorTravel = sin(travel.mul(0.7).add(vUv.y.mul(0.7))).mul(0.5).add(0.5);
    const baseColor = mix(uColorA, uColorB, smoothstep(0.05, 0.92, colorTravel));
    const roseVeil = sin(travel.mul(0.56).sub(1.1)).mul(0.5).add(0.5);
    const silkColor = mix(baseColor, uColorC, roseVeil.mul(0.36));
    const pearl = vec3(0.72, 0.86, 1.0);

    // A single coherent energy front runs all the way out from the nexus.
    // The front's lifetime is independent of the shorter impact envelope.
    const waveDistance = abs(vUv.x.sub(uLineWaveProgress));
    const waveActive = smoothstep(0.0, 0.02, uLineWaveProgress)
        .mul(float(1.0).sub(smoothstep(0.96, 1.0, uLineWaveProgress)));
    const eventWave = float(1.0).sub(smoothstep(0.018, 0.1, waveDistance))
        .mul(waveActive).mul(float(0.75).add(uLinePulse.mul(0.3)));
    const waveFilament = float(1.0).sub(smoothstep(0.008, 0.025, waveDistance)).mul(waveActive);
    const eventColor = mix(uColorA, uEventColor, clamp(uEventHue, 0.0, 1.0));
    const slowPacket = pow(sin(travel.mul(1.55)).mul(0.5).add(0.5), 14.0)
        .mul(uWeaveCharge.mul(0.2).add(uComboEnergy.mul(0.08)));
    const silkLight = float(0.67).add(sheen.mul(0.46)).add(fineThreads.mul(0.16))
        .add(broadThreads.mul(0.14))
        .add(fresnel.mul(0.16));
    const colorNode = silkColor.mul(silkLight)
        .add(pearl.mul(sheen.mul(0.22).add(edgeThread.mul(0.24))))
        .add(eventColor.mul(eventWave.mul(0.62).add(waveFilament.mul(0.6)).add(slowPacket)))
        .add(pearl.mul(uCrownPulse.mul(edgeThread).mul(0.3)));
    const alpha = body.mul(uOpacity)
        .mul(float(0.63).add(sheen.mul(0.21)).add(broadThreads.mul(0.13)))
        .add(edgeThread.mul(0.2)).add(eventWave.mul(0.14))
        .mul(widthFade)
        .mul(lengthFade);
    const emissiveColor = silkColor.mul(edgeThread.mul(0.42).add(fineThreads.mul(0.075))
        .add(sheen.mul(0.1)).add(uWeaveCharge.mul(0.12)))
        .add(eventColor.mul(eventWave.mul(0.7).add(waveFilament.mul(0.85)).add(slowPacket.mul(0.65))))
        .add(pearl.mul(edgeThread.mul(uCrownPulse).mul(0.75)));

    const waveAmplitude = float(0.04).add(uWeaveCharge.mul(0.045)).add(eventWave.mul(0.065));
    const flutter = sin(vUv.x.mul(17.0).sub(uTime.mul(uFlowSpeed)).add(uPulseOffset))
        .mul(vUv.y.sub(0.5)).mul(waveAmplitude);
    const breathing = sin(travel.mul(0.75)).mul(0.018).mul(body);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    // Vertex displacement deliberately avoids fragment derivatives and view masks.
    material.positionNode = positionLocal.add(normalLocal.mul(flutter.add(breathing)));
    material.colorNode = colorNode;
    material.opacityNode = clamp(alpha, 0.0, 0.84);
    // Thin silk has no enclosed back volume; draw both sides in one pass.
    material.forceSinglePass = true;
    material.emissiveNode = emissiveColor;

    return {
        material,
        uniforms: {
            uTime,
            uEnergy,
            uLinePulse,
            uComboEnergy,
            uLineWaveProgress,
            uWeaveCharge,
            uCrownPulse,
            uEventHue,
            uEventColor,
            uFlowSpeed,
            uPulseOffset,
            uOpacity,
            uColorA,
            uColorB,
            uColorC,
        },
        meta: { emitsBloom: true },
    };
}

export function createAstralStarfieldNodeMaterial(params = {}) {
    const useBillboards = params.billboard === true;
    const uTime = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio || 1);
    const uScintillation = uniform(0);
    const uDiffractionStrength = uniform(
        Number.isFinite(params.diffractionStrength) ? params.diffractionStrength : 0.28,
    );

    const aSize = attribute('aSize');
    const aTwinkle = attribute('aTwinkle', 'vec2');
    const aBrightness = attribute('aBrightness');
    const aColor = attribute('color', 'vec3');
    const center = useBillboards ? attribute('aCenter', 'vec3') : positionLocal;

    const mvPosition = modelViewMatrix.mul(vec4(center, 1.0));
    const depthFactor = smoothstep(90.0, 260.0, abs(center.z));
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

    const MaterialClass = useBillboards ? MeshBasicNodeMaterial : PointsNodeMaterial;
    const material = new MaterialClass({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        // colorNode already consumes the authored color attribute.
        vertexColors: false,
    });

    material.positionNode = useBillboards ? createBillboardQuadPosition({
        centerNode: center,
        sizeNode: clamp(aSize.mul(0.1), 0.12, 0.4),
    }) : positionLocal;
    if (!useBillboards) material.sizeNode = sizeNode;
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
        meta: { emitsBloom: true, usesBillboards: useBillboards },
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
    const warped = vec2(
        vUv.x.add(sin(vUv.y.mul(7.0).add(uTime.mul(uDrift))).mul(0.045)),
        vUv.y.add(cos(vUv.x.mul(5.0).sub(uTime.mul(uDrift.mul(0.65)))).mul(0.032)),
    );
    const texNode = texture(tex, warped);
    // Stretched low-frequency noise yields gauzy wisps, with only eight cheap
    // value-noise samples instead of several complete fractal stacks.
    const driftUv = warped.add(vec2(uTime.mul(0.008), uTime.mul(-0.006)));
    const detail = tslNoise(driftUv.mul(vec2(2.8, 6.5)));
    const secondary = tslNoise(driftUv.mul(vec2(6.0, 13.0)).add(detail.mul(0.32)));
    const density = smoothstep(0.22, 0.78, detail.mul(0.7).add(secondary.mul(0.3)));
    const edgeFade = smoothstep(0.03, 0.28, vUv.x)
        .mul(smoothstep(0.97, 0.72, vUv.x))
        .mul(smoothstep(0.02, 0.28, vUv.y))
        .mul(smoothstep(0.98, 0.72, vUv.y));
    const tintMix1 = clamp(detail.mul(0.8).add(warped.x.mul(0.2)), 0.0, 1.0);
    const tintMix2 = clamp(secondary.mul(0.7).add(uPulse.mul(0.08)), 0.0, 1.0);

    let colorNode = mix(uTintA, uTintB, tintMix1);
    colorNode = mix(colorNode, uTintC, tintMix2.mul(0.1))
        .mul(float(0.58).add(texNode.r.mul(0.28)))
        .mul(float(0.82).add(uPulse.mul(0.18)));

    const alphaNode = texNode.a
        .mul(float(0.12).add(density.mul(0.88)))
        .mul(edgeFade)
        .mul(uOpacity)
        .mul(float(1.0).add(uPulse.mul(0.14)));

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = colorNode;
    material.opacityNode = clamp(alphaNode, 0.0, 0.8);
    material.forceSinglePass = true;
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
    const useBillboards = params.billboard === true;

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

    const positionAttr = useCompute
        ? resolveStorageAttr(positionStorage, positionStorage.element(instanceIndex)) : null;
    const stateAttr = useCompute
        ? resolveStorageAttr(stateStorage, stateStorage.element(instanceIndex)) : null;
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

    const MaterialClass = useBillboards ? MeshBasicNodeMaterial : PointsNodeMaterial;
    const material = new MaterialClass({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: false,
    });

    material.positionNode = useBillboards ? createBillboardQuadPosition({
        centerNode: particlePosition,
        sizeNode: clamp(particleSize.mul(0.03).mul(float(1.0).add(uComboEnergy.mul(0.15))), 0.03, 0.12),
    }) : particlePosition;
    if (!useBillboards) material.sizeNode = clamp(sizeNode, 1.0, 18.0);
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
        meta: { emitsBloom: true, usesCompute: useCompute, usesBillboards: useBillboards },
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

    const cpuPosition = useCompute ? null : attribute('aBurstPosition', 'vec4');
    const cpuMisc = useCompute ? null : attribute('aBurstMisc', 'vec4');
    const aColor = attribute('color', 'vec3');

    const positionStorage = useCompute
        ? storage(burstCompute.getPositionBuffer(), 'vec4', burstCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(burstCompute.getMiscBuffer(), 'vec4', burstCompute.count)
        : null;

    const positionAttr = useCompute
        ? resolveStorageAttr(positionStorage, positionStorage.element(instanceIndex)) : null;
    const miscAttr = useCompute ? resolveStorageAttr(miscStorage, miscStorage.element(instanceIndex)) : null;

    const particlePosition = useCompute ? positionAttr.xyz : cpuPosition.xyz;
    const particleActive = useCompute ? positionAttr.w : cpuPosition.w;
    const particleSize = useCompute ? miscAttr.x : cpuMisc.x;
    const particleLife = useCompute ? miscAttr.y : cpuMisc.y;
    const particleSeed = useCompute ? miscAttr.z : cpuMisc.z;
    const particleTone = useCompute ? miscAttr.w : cpuMisc.w;

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
    const warmMix = clamp(particleLife.mul(0.4).add(particleSeed.mul(0.18)), 0.0, 1.0);
    const colorNode = mix(burstColor, uColorC, warmMix).mul(aColor);
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
    const uColorC = uniform(params.colorC || new THREE.Color(0xffdb72));

    const centered = uv().sub(0.5);
    const dist = length(centered).mul(2.0);
    const angle = atan(centered.y, centered.x.add(0.00001));
    // Keep the final radius inside the plane; its silhouette must never hit a
    // square edge. Thin nested threads replace the old thick fog doughnut.
    const ringRadius = float(0.055).add(uProgress.mul(0.87));
    const ringWidth = float(0.026).sub(uProgress.mul(0.012));
    const ringDist = abs(dist.sub(ringRadius));
    const ring = float(1.0).sub(smoothstep(ringWidth.mul(0.23), ringWidth, ringDist));
    const echoDist = abs(dist.sub(ringRadius.sub(0.055)));
    const echo = float(1.0).sub(smoothstep(0.003, 0.014, echoDist)).mul(0.38);
    const halo = float(1.0).sub(smoothstep(0.016, 0.075, ringDist)).mul(0.16);
    const sparkAngular = pow(sin(angle.mul(23.0).add(uProgress.mul(10.0)))
        .mul(0.5).add(0.5), 28.0);
    const sparkOrbit = ringRadius.add(sin(angle.mul(7.0).sub(uProgress.mul(3.0))).mul(0.035));
    const sparks = sparkAngular.mul(float(1.0).sub(smoothstep(0.007, 0.029, abs(dist.sub(sparkOrbit)))))
        .mul(smoothstep(0.04, 0.18, uProgress));
    const fade = smoothstep(0.0, 0.06, uProgress)
        .mul(pow(max(float(1.0).sub(uProgress), 0.0), 0.7)).mul(uOpacity);
    const colorTravel = sin(angle.mul(2.0).add(uProgress.mul(2.0))).mul(0.5).add(0.5);
    const ringColor = mix(uColorA, uColorB, colorTravel);
    const colorNode = ringColor.mul(1.25).add(vec3(0.78, 0.86, 1.0).mul(ring.mul(0.38)))
        .add(uColorC.mul(sparks.mul(0.55)));
    const alpha = ring.add(echo).add(halo).add(sparks.mul(0.8)).mul(fade);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.colorNode = colorNode;
    material.opacityNode = clamp(alpha, 0.0, 1.0);
    material.forceSinglePass = true;
    material.emissiveNode = ringColor.mul(ring.add(echo).mul(fade).mul(0.68))
        .add(uColorC.mul(sparks.mul(fade).mul(0.82)));

    return {
        material,
        uniforms: {
            uProgress,
            uOpacity,
            uColorA,
            uColorB,
            uColorC,
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
    const lengthFade = smoothstep(float(0.0), float(0.12), vUv.x)
        .mul(smoothstep(float(1.0), float(0.88), vUv.x));
    const alpha = uOpacity.mul(pulseFactor).mul(lengthFade);

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
