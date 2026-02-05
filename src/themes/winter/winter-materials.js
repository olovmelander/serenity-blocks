/**
 * Winter Wonderland Theme - TSL Node Materials (WebGPU path)
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    storage,
    uniform,
    positionLocal,
    positionWorld,
    positionView,
    cameraPosition,
    normalView,
    vertexIndex,
    uv,
    vec2,
    vec3,
    vec4,
    float,
    abs,
    sin,
    cos,
    exp,
    pow,
    step,
    smoothstep,
    mix,
    length,
    normalize,
    clamp,
    texture,
    mx_noise_float,
} from 'three/tsl';

export function createWinterSkyNodeMaterial(params = {}) {
    const uTop = uniform(params.top ?? new THREE.Color(0x00030a));
    const uMid = uniform(params.mid ?? new THREE.Color(0x020613));
    const uBot = uniform(params.bottom ?? new THREE.Color(0x091222));

    const h = normalize(positionWorld).y;
    const col = mix(uMid, uTop, smoothstep(float(0.0), float(1.0), h));
    const finalColor = mix(uBot, col, smoothstep(float(-0.2), float(0.2), h));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.emissiveNode = vec3(0.0);
    material.side = THREE.BackSide;
    material.depthWrite = false;

    return { material, uniforms: { uTop, uMid, uBot } };
}

export function createWinterStarfieldNodeMaterial() {
    const uTime = uniform(0);

    const aSize = attribute('size');
    const aPhase = attribute('phase');
    const aColor = attribute('color');
    const aTwinkle = attribute('twinkle');
    const twinkleSpeed = mix(float(0.8), float(2.2), aTwinkle);
    const twinkle = sin(uTime.mul(twinkleSpeed).add(aPhase.mul(10.0))).mul(0.5).add(0.5);

    const alpha = twinkle.mul(0.4).add(0.1);

    const material = new THREE.PointsNodeMaterial();
    material.sizeNode = aSize;
    material.colorNode = aColor;
    material.opacityNode = alpha;
    material.emissiveNode = aColor.mul(twinkle).mul(0.2);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return { material, uniforms: { uTime } };
}

export function createWinterMoonNodeMaterial(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0xbfd6ff));
    const uTime = uniform(0);
    const vUv = uv();
    const craterNoise = mx_noise_float(vec3(vUv.mul(8.0), uTime.mul(0.02)))
        .mul(0.5)
        .add(0.5);
    const craterMask = smoothstep(0.35, 0.85, craterNoise);
    const craterShade = mix(vec3(1.0), vec3(0.85, 0.88, 0.92), craterMask);
    const normal = normalize(normalView);
    const intensity = pow(float(0.7).sub(normal.dot(vec3(0.0, 0.0, 1.0))), float(2.0));
    const baseColor = uColor.mul(craterShade).add(vec3(0.2).mul(float(1.0).sub(intensity)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = baseColor;
    material.emissiveNode = baseColor.mul(0.4);

    return { material, uniforms: { uColor, uTime } };
}

export function createWinterMoonHaloNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uIntensity = uniform(params.intensity ?? 0.35);
    const uColor = uniform(params.color ?? new THREE.Color(0xaad9ff));

    const n = normalize(normalView);
    const rim = pow(float(1.0).sub(abs(n.z)), float(2.0));
    const pulse = sin(uTime.mul(2.0)).mul(0.05).add(1.0);
    const tintCycle = sin(uTime.mul(0.05)).mul(0.5).add(0.5);
    const tint = mix(uColor, vec3(0.5, 0.9, 0.85), tintCycle.mul(0.6));

    const alpha = rim.mul(uIntensity).mul(pulse);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.colorNode = tint;
    material.opacityNode = alpha;
    material.emissiveNode = tint.mul(alpha.mul(1.2));

    return { material, uniforms: { uTime, uIntensity, uColor } };
}

export function createWinterMountainNodeMaterial(params = {}) {
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0x060c15));
    const uSnowColor = uniform(params.snowColor ?? new THREE.Color(0xddeeff));
    const uSnowLine = uniform(params.snowLine ?? 0.35);
    const uFogColor = uniform(params.fogColor ?? new THREE.Color(0x050a14));
    const uFogDensity = uniform(params.fogDensity ?? 0.0008);

    const vPos = positionWorld;
    const vNormal = normalize(normalView);
    const slope = float(1.0).sub(vNormal.y);

    const snowThreshold = uSnowLine.mul(600.0).add(sin(vPos.x.mul(0.01)).mul(50.0));
    const snowFactor = smoothstep(snowThreshold, snowThreshold.add(100.0), vPos.y)
        .mul(smoothstep(0.8, 0.3, slope));

    const baseColor = mix(uBaseColor, uSnowColor, snowFactor);
    const depth = length(vPos.sub(cameraPosition));
    const fogFactor = float(1.0).sub(
        exp(depth.mul(depth).mul(uFogDensity.mul(uFogDensity)).negate()),
    );
    const finalColor = mix(baseColor, uFogColor, fogFactor);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.emissiveNode = vec3(0.0);

    return { material, uniforms: { uBaseColor, uSnowColor, uSnowLine, uFogColor, uFogDensity } };
}

export function createWinterAuroraNodeMaterial(options = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const uTime = uniform(0);
    const uIntensity = uniform(options.intensity ?? 1.0);
    const uOpacity = uniform(options.opacity ?? 0.6);
    const uOffset = uniform(options.offset ?? 0.0);
    const uSpeed = uniform(options.speed ?? 1.0);
    const uColor1 = uniform(options.color1 ?? new THREE.Color(0x00ff99));
    const uColor2 = uniform(options.color2 ?? new THREE.Color(0x3366ff));
    const uColor3 = uniform(options.color3 ?? new THREE.Color(0x8800ff));
    const uDetail = uniform(options.detail ?? 1.0);

    const vUv = uv();
    const t = uTime.mul(0.15).mul(uSpeed).add(uOffset);

    const n1 = mx_noise_float(vec3(vUv.x.mul(3.0).add(t), vUv.y.mul(1.5), float(0.0)));
    const n2 = mx_noise_float(vec3(vUv.x.mul(6.0).sub(t.mul(0.5)), vUv.y.mul(5.0).add(t.mul(0.2)), float(0.0)));
    const n3 = mx_noise_float(vec3(vUv.x.mul(12.0).add(t.mul(0.8)), vUv.y.mul(8.0), float(0.0)));
    const detail2 = smoothstep(0.2, 0.6, uDetail);
    const detail3 = smoothstep(0.5, 0.9, uDetail);
    const noise = n1.mul(0.55).add(n2.mul(0.3).mul(detail2)).add(n3.mul(0.15).mul(detail3));

    const vFade = smoothstep(0.0, 0.15, vUv.y).mul(smoothstep(1.0, 0.4, vUv.y));
    const folds = sin(vUv.x.mul(8.0).add(noise.mul(3.0)).add(t)).mul(0.5).add(0.5);
    const intensity = pow(folds, float(2.0)).mul(vFade).mul(float(0.6).add(noise.mul(0.4)));

    const hue = vUv.y.add(noise.mul(0.2));
    const color1 = mix(uColor1, uColor2, smoothstep(0.0, 0.5, hue));
    const color = mix(color1, uColor3, smoothstep(0.5, 1.0, hue));
    const cycle = sin(uTime.mul(0.05).add(uOffset.mul(0.01))).mul(0.5).add(0.5);
    const cycleTint = mix(uColor1, uColor3, cycle);
    const cycledColor = mix(color, color.add(cycleTint.mul(0.3)), cycle.mul(0.4));

    const sparkleNoise = mx_noise_float(vec3(vUv.mul(60.0), uTime.mul(1.2)))
        .mul(0.5)
        .add(0.5);
    const sparkles = smoothstep(0.95, 1.0, sparkleNoise).mul(vFade);
    const sparkleBoost = sparkles.mul(0.6).mul(detail3);

    material.colorNode = cycledColor.mul(uIntensity).mul(1.5);
    material.opacityNode = clamp(
        intensity.mul(uOpacity).mul(uIntensity).add(sparkleBoost.mul(0.15)),
        0.0,
        1.0,
    );
    material.emissiveNode = cycledColor
        .mul(intensity.mul(uIntensity).mul(0.8).add(sparkleBoost));

    material.userData = { uTime, uIntensity, uOpacity, uOffset, uSpeed, uDetail };

    return {
        material,
        uniforms: { uTime, uIntensity, uOpacity, uOffset, uSpeed, uDetail, uColor1, uColor2, uColor3 },
    };
}

export function createWinterSnowNodeMaterial(params = {}) {
    const { isWebGPU = false, snowCompute = null } = params;
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const uTime = uniform(0);
    const uWindForce = uniform(0);
    const uGustIntensity = uniform(0);
    const uFlashIntensity = uniform(0);

    const aDepth = attribute('depth');
    const aPhase = attribute('phase');
    const aWobbleSpeed = attribute('wobbleSpeed');
    const aSize = attribute('size');

    const useGPUPositions = Boolean(isWebGPU && snowCompute?.getPositionBuffer);
    const snowPositions = useGPUPositions
        ? storage(snowCompute.getPositionBuffer(), 'vec4', snowCompute.count)
        : null;

    const basePos = Fn(() => {
        if (useGPUPositions) {
            const idx = vertexIndex;
            return snowPositions.element(idx).xyz;
        }
        return positionLocal;
    })();
    const windX = uWindForce.mul(aDepth.add(1.0));
    const turbulence = sin(basePos.y.mul(0.05).add(uTime.mul(4.0))).mul(uGustIntensity).mul(12.0);
    const spiral = sin(uTime.mul(aWobbleSpeed).add(aPhase)).mul(float(2.0).add(uGustIntensity.mul(4.0)));
    const zOffset = cos(uTime.mul(aWobbleSpeed.mul(0.5)).add(aPhase)).mul(2.0).sub(uWindForce.mul(0.1));
    const pos = vec3(basePos.x.add(windX).add(turbulence).add(spiral), basePos.y, basePos.z.add(zOffset));
    material.positionNode = pos;

    const flash = float(0.9).add(clamp(uFlashIntensity, 0.0, 1.0).mul(0.8));
    material.colorNode = vec3(0.9, 0.92, 1.0).mul(flash);

    const depthAlpha = float(0.2).add(aDepth.mul(0.6)).mul(0.8);
    const twinkle = float(0.85).add(sin(uTime.mul(3.0).add(aPhase.mul(10.0))).mul(0.15));

    // Simple depth-of-field approximation: blur near/far, sharper mid-depth
    const nearFocus = smoothstep(0.05, 0.25, aDepth);
    const farFocus = float(1.0).sub(smoothstep(0.75, 0.95, aDepth));
    const dof = nearFocus.mul(farFocus);
    const blurScale = mix(float(1.5), float(1.0), dof);
    const dofAlpha = mix(float(0.5), float(1.0), dof);

    material.opacityNode = depthAlpha.mul(twinkle).mul(dofAlpha);
    const depthScale = float(0.5).add(aDepth.mul(0.5));
    material.sizeNode = aSize
        .mul(depthScale)
        .mul(blurScale)
        .mul(float(600.0).div(positionView.z.negate()));
    material.emissiveNode = vec3(0.05, 0.06, 0.08);

    return { material, uniforms: { uTime, uWindForce, uGustIntensity, uFlashIntensity } };
}

export function createWinterSnowflakeBillboardMaterial(params = {}) {
    const uTime = uniform(0);
    const uOpacity = uniform(params.opacity ?? 0.7);
    const uTint = uniform(params.tint ?? new THREE.Color(0xdce6ff));

    const texNode = params.map ? texture(params.map) : null;
    const sample = texNode ? texNode.sample(uv()) : vec4(1.0, 1.0, 1.0, 1.0);
    const shimmer = sin(uTime.mul(3.0).add(sample.r.mul(6.0))).mul(0.05).add(0.95);

    const color = sample.rgb.mul(uTint);
    const alpha = sample.a.mul(uOpacity).mul(shimmer);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.6));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return { material, uniforms: { uTime, uOpacity, uTint } };
}

export function createWinterWindStreakNodeMaterial() {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const uTime = uniform(0);
    const uWindForce = uniform(0);
    const uOpacity = uniform(0);

    const aLength = attribute('length');
    const aSpeed = attribute('speed');

    const positionNode = Fn(() => {
        const pos = positionLocal.toVar();
        const windAbs = abs(uWindForce);
        const dist = uTime.mul(aSpeed).mul(float(1.0).add(windAbs.mul(0.1)));
        const windSign = step(0.0, uWindForce).mul(2.0).sub(1.0);
        const range = float(1000.0);
        const halfRange = float(500.0);
        pos.x.assign(pos.x.add(dist.mul(windSign)).add(halfRange).mod(range).sub(halfRange));
        return pos;
    })();

    const stretch = float(1.0).add(abs(uWindForce).mul(0.5));
    const sizeNode = aLength.mul(stretch).mul(float(300.0).div(positionView.z.negate()));

    const alpha = uOpacity;

    material.positionNode = positionNode;
    material.sizeNode = sizeNode;
    material.colorNode = vec3(0.8, 0.9, 1.0);
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.3, 0.4, 0.5).mul(uOpacity);

    return { material, uniforms: { uTime, uWindForce, uOpacity } };
}

export function createWinterIceWispNodeMaterial() {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const uTime = uniform(0);
    const uPixelRatio = uniform(1);
    const uSurgeIntensity = uniform(0);

    const aPhase = attribute('aPhase');
    const aSpeed = attribute('aSpeed');
    const aSize = attribute('aSize');
    const aBrightness = attribute('aBrightness');
    const aTrail = attribute('aTrail');

    const trailFade = pow(float(1.0).sub(aTrail), float(1.4));
    const t = uTime.sub(aTrail.mul(1.2)).mul(aSpeed).add(aPhase);

    const positionNode = Fn(() => {
        const pos = positionLocal.toVar();
        pos.y.addAssign(sin(t.mul(0.8)).mul(15.0).add(uTime.mul(3.0)));
        pos.x.addAssign(cos(t.mul(0.5)).mul(20.0).add(sin(t.mul(0.3)).mul(10.0)));
        pos.z.addAssign(sin(t.mul(0.4)).mul(8.0));
        const minY = float(-100.0);
        const range = float(500.0);
        pos.y.assign(pos.y.sub(minY).mod(range).add(minY));
        return pos;
    })();

    const heightFade = smoothstep(-100.0, 100.0, positionNode.y)
        .mul(smoothstep(400.0, 200.0, positionNode.y));
    const pulseFade = float(0.4).add(sin(t.mul(2.0)).mul(0.3));
    const alpha = heightFade
        .mul(pulseFade)
        .mul(float(1.0).add(uSurgeIntensity.mul(0.8)))
        .mul(trailFade);
    const brightness = aBrightness
        .mul(float(1.0).add(uSurgeIntensity.mul(0.5)))
        .mul(mix(float(0.35), float(1.0), trailFade));

    const glow = clamp(float(0.4).add(aBrightness.mul(0.6)), 0.0, 1.0);
    const coreColor = vec3(0.7, 0.95, 1.0);
    const haloColor = vec3(0.4, 0.7, 0.9);
    const color = mix(haloColor, coreColor, glow).mul(brightness);

    const sizeNode = aSize
        .mul(uPixelRatio)
        .mul(float(1.0).add(uSurgeIntensity.mul(0.4)))
        .mul(mix(float(0.5), float(1.0), trailFade))
        .mul(float(500.0).div(positionView.z.negate()));

    material.positionNode = positionNode;
    material.sizeNode = sizeNode;
    material.colorNode = color;
    material.opacityNode = glow.mul(alpha).mul(0.7);
    material.emissiveNode = color.mul(0.6);

    return { material, uniforms: { uTime, uPixelRatio, uSurgeIntensity } };
}

export function createWinterIceBurstNodeMaterial() {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const aSize = attribute('size');
    const aLife = attribute('life');

    const colorVar = sin(aLife.mul(10.0));
    const color = mix(
        vec3(0.5, 0.9, 1.0),
        vec3(0.9, 0.95, 1.0),
        colorVar.mul(0.5).add(0.5),
    );

    const sizeNode = aSize.mul(aLife).mul(float(300.0).div(positionView.z.negate()));
    const alpha = aLife;

    material.sizeNode = sizeNode;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(0.5);

    return { material };
}

export function createWinterFogNodeMaterial(params = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;

    const uTime = uniform(0);
    const uOpacity = uniform(params.opacity ?? 0.1);
    const uSpeed = uniform(params.speed ?? 0.005);

    const baseUv = uv();
    const scrollUv = baseUv.add(vec2(uTime.mul(uSpeed), float(0.0)));

    const fog1 = mx_noise_float(vec3(scrollUv.mul(3.0), uTime.mul(0.03)))
        .mul(0.5)
        .add(0.5);
    const fog2 = mx_noise_float(vec3(scrollUv.mul(5.0), uTime.mul(-0.02)))
        .mul(0.5)
        .add(0.5);
    const fog = fog1.mul(0.6).add(fog2.mul(0.4));

    const vertFade = smoothstep(0.0, 0.3, baseUv.y)
        .mul(smoothstep(1.0, 0.7, baseUv.y));
    const horizFade = smoothstep(0.0, 0.2, baseUv.x)
        .mul(smoothstep(1.0, 0.8, baseUv.x));
    const groundBoost = float(1.0)
        .sub(smoothstep(0.2, 0.8, baseUv.y))
        .mul(0.4)
        .add(0.45);

    const alpha = fog.mul(vertFade).mul(horizFade).mul(groundBoost).mul(uOpacity);
    const tintCycle = sin(uTime.mul(0.05)).mul(0.5).add(0.5);
    const auroraTint = mix(vec3(0.2, 0.7, 0.9), vec3(0.6, 0.3, 1.0), tintCycle);
    const baseColor = vec3(0.12, 0.16, 0.22);
    const color = mix(baseColor, auroraTint, fog.mul(0.25));

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0);

    return { material, uniforms: { uTime, uOpacity, uSpeed } };
}
