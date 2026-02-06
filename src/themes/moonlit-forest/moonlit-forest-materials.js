/**
 * Moonlit Forest Theme - TSL node materials for WebGPU path.
 */

import * as THREE from 'three/webgpu';
import {
    attribute,
    clamp,
    float,
    length,
    mix,
    normalize,
    pointUV,
    positionLocal,
    positionView,
    positionWorld,
    pow,
    sin,
    storage,
    smoothstep,
    uniform,
    uv,
    vec3,
    vertexIndex,
} from 'three/tsl';

export function createMoonlitSkyNodeMaterial(params = {}) {
    const uTop = uniform(params.top ?? new THREE.Color(0x0a1628));
    const uMid = uniform(params.mid ?? new THREE.Color(0x1a3050));
    const uBottom = uniform(params.bottom ?? new THREE.Color(0x0d1f35));
    const uTime = uniform(0);

    const h = normalize(positionWorld).y;
    const skyBlend = smoothstep(float(-0.45), float(0.75), h);
    const lowColor = mix(uBottom, uMid, smoothstep(float(-0.45), float(0.25), h));
    const highColor = mix(uMid, uTop, smoothstep(float(0.1), float(0.9), h));
    const middleBand = smoothstep(float(-0.05), float(0.35), h)
        .mul(float(1.0).sub(smoothstep(float(0.35), float(0.85), h)));
    const shimmer = sin(uTime.mul(0.08).add(h.mul(9.0))).mul(0.03).add(0.97);
    const finalColor = mix(lowColor, highColor, skyBlend)
        .add(uMid.mul(middleBand).mul(0.08).mul(shimmer));

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.colorNode = finalColor;
    material.emissiveNode = finalColor.mul(0.08);

    return {
        material,
        uniforms: {
            uTop,
            uMid,
            uBottom,
            uTime,
        },
    };
}

export function createMoonlitMoonNodeMaterial(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0xf4e8a8));
    const uGlowIntensity = uniform(params.glowIntensity ?? 0.55);
    const uTime = uniform(0);

    const centeredUv = uv().sub(0.5);
    const dist = length(centeredUv).mul(2.0);
    const disc = smoothstep(float(1.0), float(0.0), dist);
    const craterWave = sin(centeredUv.x.mul(32.0).add(uTime.mul(0.09)))
        .mul(sin(centeredUv.y.mul(26.0).sub(uTime.mul(0.07))))
        .mul(0.5)
        .add(0.5);
    const craterMask = smoothstep(float(0.45), float(0.95), craterWave);
    const craterTint = mix(vec3(1.0, 1.0, 1.0), vec3(0.82, 0.86, 0.92), craterMask.mul(0.5));
    const edgeGlow = pow(float(1.0).sub(smoothstep(float(0.2), float(1.0), dist)), float(2.0));
    const finalColor = uColor.mul(craterTint).mul(edgeGlow.mul(0.7).add(0.3));

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.colorNode = finalColor;
    material.opacityNode = disc;
    material.emissiveNode = finalColor.mul(uGlowIntensity).mul(disc);

    return {
        material,
        uniforms: {
            uColor,
            uGlowIntensity,
            uTime,
        },
    };
}

export function createMoonlitMoonHaloNodeMaterial(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0xe1f1ff));
    const uOpacity = uniform(params.opacity ?? 0.32);
    const uTime = uniform(0);

    const centeredUv = uv().sub(0.5);
    const dist = length(centeredUv).mul(2.0);
    const haloMask = pow(float(1.0).sub(smoothstep(float(0.0), float(1.0), dist)), float(2.4));
    const pulse = sin(uTime.mul(1.25)).mul(0.08).add(0.92);
    const color = mix(uColor, vec3(0.95, 0.98, 1.0), smoothstep(float(0.5), float(1.0), haloMask));
    const alpha = haloMask.mul(uOpacity).mul(pulse);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(1.35));

    return {
        material,
        uniforms: {
            uColor,
            uOpacity,
            uTime,
        },
    };
}

export function createMoonlitStarfieldNodeMaterial() {
    const uTime = uniform(0);

    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');
    const aTwinkle = attribute('aTwinkle');
    const aColor = attribute('color');

    const twinkle = sin(uTime.mul(aTwinkle).add(aPhase)).mul(0.5).add(0.5);
    const sizeNode = aSize.mul(float(180.0).div(positionView.z.negate()));
    const alpha = twinkle.mul(0.55).add(0.18);
    const color = aColor.mul(twinkle.mul(0.25).add(0.75));

    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.vertexColors = true;
    material.sizeNode = clamp(sizeNode, float(0.6), float(8.0));
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.5));

    return {
        material,
        uniforms: {
            uTime,
        },
    };
}

export function createMoonlitAmbientFireflyNodeMaterial(params = {}) {
    const uTime = uniform(params.time ?? 0);
    const uSize = uniform(params.size ?? 7.2);
    const uColor = uniform(params.color ?? new THREE.Color(0xffeb7a));
    const uPulse = uniform(params.pulse ?? 0);

    const fireflyCompute = params.fireflyCompute ?? null;
    const useCompute = Boolean(
        fireflyCompute?.getPositionBuffer
        && fireflyCompute?.getMiscBuffer,
    );

    const aRandom = useCompute ? null : attribute('aRandom');
    const aTwinkle = useCompute ? null : attribute('aTwinkle');
    const aSizeSeed = useCompute ? null : attribute('aSizeSeed');

    const positionStorage = useCompute
        ? storage(fireflyCompute.getPositionBuffer(), 'vec4', fireflyCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(fireflyCompute.getMiscBuffer(), 'vec4', fireflyCompute.count)
        : null;
    const positionStorageAttr = useCompute && typeof positionStorage.toAttribute === 'function'
        ? positionStorage.toAttribute()
        : null;
    const miscStorageAttr = useCompute && typeof miscStorage.toAttribute === 'function'
        ? miscStorage.toAttribute()
        : null;

    let basePosition = positionLocal;
    let randomValue = float(0.5);
    let twinkleValue = float(0.5);
    let sizeSeedValue = float(0.5);

    if (useCompute) {
        if (miscStorageAttr) {
            randomValue = miscStorageAttr.x;
            twinkleValue = miscStorageAttr.y;
            sizeSeedValue = miscStorageAttr.z;
        } else {
            randomValue = miscStorage.element(vertexIndex).x;
            twinkleValue = miscStorage.element(vertexIndex).y;
            sizeSeedValue = miscStorage.element(vertexIndex).z;
        }
        basePosition = positionStorageAttr
            ? positionStorageAttr.xyz
            : positionStorage.element(vertexIndex).xyz;
    } else {
        randomValue = aRandom;
        twinkleValue = aTwinkle;
        sizeSeedValue = aSizeSeed;
        basePosition = vec3(
            positionLocal.x.add(sin(uTime.mul(0.55).add(randomValue.mul(6.283185))).mul(6.0)),
            positionLocal.y.add(sin(uTime.mul(0.85).add(twinkleValue.mul(6.283185))).mul(2.2)),
            positionLocal.z,
        );
    }

    const twinkle = sin(
        uTime.mul(float(0.8).add(twinkleValue.mul(1.8)))
            .add(randomValue.mul(6.283185)),
    ).mul(0.5).add(0.5);
    const centered = pointUV.sub(0.5);
    const softDisc = smoothstep(float(0.52), float(0.08), length(centered));
    const alpha = softDisc
        .mul(float(0.22).add(twinkle.mul(0.62)))
        .mul(float(0.85).add(uPulse.mul(0.35)));

    const sizeNode = uSize
        .mul(float(0.65).add(sizeSeedValue.mul(0.9)))
        .mul(float(20.0).div(positionView.z.negate()))
        .mul(float(0.8).add(twinkle.mul(0.35)))
        .mul(float(1.0).add(uPulse.mul(0.22)));

    const colorNode = mix(uColor.mul(0.75), uColor.mul(1.35), twinkle)
        .mul(float(0.9).add(uPulse.mul(0.1)));

    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.positionNode = basePosition;
    material.sizeNode = clamp(sizeNode, float(0.8), float(18.0));
    material.colorNode = colorNode;
    material.opacityNode = alpha;
    material.emissiveNode = colorNode.mul(alpha.mul(0.65));

    return {
        material,
        uniforms: {
            uTime,
            uSize,
            uColor,
            uPulse,
        },
    };
}
