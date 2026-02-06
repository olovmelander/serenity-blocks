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
    positionView,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    vec3,
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
