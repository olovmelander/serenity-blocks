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
    normalWorld,
    dot,
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

    const alpha = twinkle.mul(0.16).add(0.035);

    const material = new THREE.PointsNodeMaterial();
    material.sizeNode = aSize;
    material.colorNode = aColor;
    material.opacityNode = alpha;
    material.emissiveNode = aColor.mul(twinkle).mul(0.04);
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
    const craterMask = smoothstep(0.42, 0.9, craterNoise);
    // Visible darker maria so the disc reads as a moon, not a white blob.
    const craterShade = mix(vec3(1.0, 0.99, 0.94), vec3(0.84, 0.86, 0.91), craterMask.mul(0.42));
    const normal = normalize(normalView);
    // Limb darkening: bright center → dimmer toward the edge (3D sphere read).
    const ndotv = clamp(normal.z, 0.0, 1.0);
    const limb = float(0.82).add(pow(ndotv, float(0.45)).mul(0.24));
    const baseColor = uColor.mul(craterShade).mul(limb);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = baseColor;
    material.emissiveNode = baseColor.mul(0.9);

    return { material, uniforms: { uColor, uTime } };
}

export function createWinterMoonHaloNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uIntensity = uniform(params.intensity ?? 0.35);
    const uColor = uniform(params.color ?? new THREE.Color(0xaad9ff));

    const n = normalize(normalView);
    // Soft radial glow: BRIGHT facing the camera (center, behind the moon),
    // fading to nothing at the sphere edge — NOT a rim ring (which read as a
    // hard "soap-bubble" halo around the moon).
    const glow = pow(clamp(abs(n.z), 0.0, 1.0), float(2.4));
    const pulse = sin(uTime.mul(2.0)).mul(0.05).add(1.0);
    const tintCycle = sin(uTime.mul(0.05)).mul(0.5).add(0.5);
    const tint = mix(uColor, vec3(0.5, 0.9, 0.85), tintCycle.mul(0.6));

    const alpha = glow.mul(uIntensity).mul(pulse);

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.FrontSide;
    material.colorNode = tint;
    material.opacityNode = alpha;
    material.emissiveNode = tint.mul(alpha.mul(0.9));

    return { material, uniforms: { uTime, uIntensity, uColor } };
}

export function createWinterMountainNodeMaterial(params = {}) {
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0x0a1320));
    const uRockHi = uniform(params.rockHi ?? new THREE.Color(0x182438));
    // Moonlit snow is NOT bright white — cool, dimmer, with a blue shadow tone.
    const uSnowColor = uniform(params.snowColor ?? new THREE.Color(0xc2d4ec));
    const uSnowShadow = uniform(params.snowShadow ?? new THREE.Color(0x35496a));
    // snowStart/snowRange are WORLD-Y (reachable by the geometry).
    const uSnowStart = uniform(params.snowStart ?? 10);
    const uSnowRange = uniform(params.snowRange ?? 120);
    const uFogColor = uniform(params.fogColor ?? new THREE.Color(0x070d18));
    const uFogDensity = uniform(params.fogDensity ?? 0.0008);
    const uRimColor = uniform(params.rimColor ?? new THREE.Color(0x9fe0c8));
    const uRimStrength = uniform(params.rimStrength ?? 0.4);

    const vPos = positionWorld;
    const vNormal = normalize(normalView);

    // Vertical form: dark at the base, lifting to a cooler lit rock higher up.
    const rock = mix(uBaseColor, uRockHi, smoothstep(-260.0, 80.0, vPos.y));

    // Organic snow line — sine folds + noise breakup so the edge isn't a clean cut.
    const lineNoise = mx_noise_float(vec3(vPos.x.mul(0.02), vPos.y.mul(0.03), float(0.0))).mul(30.0);
    const snowLineY = uSnowStart
        .add(sin(vPos.x.mul(0.012)).mul(34.0))
        .add(sin(vPos.x.mul(0.05)).mul(13.0))
        .add(lineNoise);
    const snowFactor = smoothstep(snowLineY, snowLineY.add(uSnowRange), vPos.y);

    // Snow shading: blue shadow near the line → brighter higher, + noise texture
    // variation + fine sparkle, so it reads as 3D snow, not a flat white cut-out.
    const snowTex = mx_noise_float(vec3(vPos.xz.mul(0.035), float(0.0))).mul(0.5).add(0.5);
    const heightBright = smoothstep(snowLineY, snowLineY.add(uSnowRange.mul(2.0)), vPos.y);
    const snowBright = clamp(float(0.32).add(heightBright.mul(0.5)).add(snowTex.mul(0.26)), 0.0, 1.0);
    const snowCol = mix(uSnowShadow, uSnowColor, snowBright);
    const glint = mx_noise_float(vec3(vPos.xz.mul(0.5), float(0.0)));
    const sparkle = smoothstep(0.72, 1.0, glint).mul(0.35);
    const snowShade = snowCol.add(vec3(0.5, 0.6, 0.78).mul(sparkle));

    const nWorld = normalize(normalWorld);
    const slope = nWorld.y;
    const slopeFactor = smoothstep(float(0.18), float(0.48), slope);
    const finalSnowFactor = snowFactor.mul(slopeFactor);

    const litColor = mix(rock, snowShade, finalSnowFactor);

    // Backlit moonlit rim along the ridge silhouette edges (cool aurora-tinted).
    const rim = pow(float(1.0).sub(abs(vNormal.z)), float(2.5));
    const rimMask = rim.mul(uRimStrength)
        .mul(smoothstep(snowLineY.sub(60.0), snowLineY.add(80.0), vPos.y));
    const withRim = litColor.add(uRimColor.mul(rimMask));

    // Atmospheric fog (depth) — far ridge recedes into the night.
    const depth = length(vPos.sub(cameraPosition));
    const fogFactor = float(1.0).sub(
        exp(depth.mul(depth).mul(uFogDensity.mul(uFogDensity)).negate()),
    );
    const finalColor = mix(withRim, uFogColor, fogFactor);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.emissiveNode = vec3(0.0);

    return {
        material,
        uniforms: {
            uBaseColor, uRockHi, uSnowColor, uSnowShadow, uSnowStart, uSnowRange, uFogColor, uFogDensity, uRimColor, uRimStrength,
        },
    };
}

export function createWinterGroundNodeMaterial(params = {}) {
    const uTime = uniform(0);
    // Moonlit night snow: dark cool base, NOT bright white.
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0x0b1626));
    const uSnowColor = uniform(params.snowColor ?? new THREE.Color(0x8ba6cf));
    const uFogColor = uniform(params.fogColor ?? new THREE.Color(0x070d18));
    const uAurora = uniform(params.aurora ?? new THREE.Color(0x33b890)); // faint green reflection
    const uNear = uniform(params.near ?? 200.0);
    const uFar = uniform(params.far ?? 2200.0);

    const vPos = positionWorld;
    const depth = length(vPos.sub(cameraPosition));
    const farT = smoothstep(uNear, uFar, depth); // 0 near camera → 1 at horizon
    const nearT = float(1.0).sub(farT);

    // Two-octave drift → visible snow drifts with light/shadow sides.
    const drift1 = mx_noise_float(vec3(vPos.xz.mul(0.004), uTime.mul(0.02))).mul(0.5).add(0.5);
    const drift2 = mx_noise_float(vec3(vPos.xz.mul(0.015), float(3.0))).mul(0.5).add(0.5);
    const driftShade = clamp(drift1.mul(0.6).add(drift2.mul(0.4)), 0.0, 1.0);
    // Darker winter night: dimmer overall, a touch of moonlit lift near camera.
    const nearBright = nearT.mul(0.28).add(0.3);
    const base = mix(uSnowColor, uBaseColor, float(0.35))
        .mul(float(0.4).add(driftShade.mul(0.6)).mul(nearBright));

    // Aurora sheen reflected on the snow, stronger toward the lit horizon.
    const auroraSheen = uAurora.mul(farT.mul(0.22).add(0.05));

    // Cool moonlight sheen on the moon side (+X), near camera.
    const moonSide = smoothstep(-1600.0, 1400.0, vPos.x);
    const moonSheen = vec3(0.55, 0.66, 0.88).mul(moonSide.mul(nearT).mul(0.12));

    // Cold crystalline sparkle — denser/brighter near the camera.
    const sp = mx_noise_float(vec3(vPos.xz.mul(0.7), uTime.mul(0.05)));
    const sparkle = smoothstep(0.78, 1.0, sp).mul(nearT).mul(0.85);

    const col = base.add(auroraSheen).add(moonSheen).add(vec3(0.72, 0.82, 1.0).mul(sparkle));
    // Fade into fog at the horizon so the ground blends into the ridges/sky.
    const finalColor = mix(col, uFogColor, farT.mul(0.85));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.emissiveNode = vec3(0.0);

    return { material, uniforms: { uTime, uAurora } };
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

    material.userData = {
        uTime, uIntensity, uOpacity, uOffset, uSpeed, uDetail,
    };

    return {
        material,
        uniforms: {
            uTime, uIntensity, uOpacity, uOffset, uSpeed, uDetail, uColor1, uColor2, uColor3,
        },
    };
}

export function createWinterSnowNodeMaterial(params = {}) {
    const {
        isWebGPU = false, snowCompute = null, stormDriven = false,
    } = params;
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.premultipliedAlpha = true;

    const uTime = uniform(0);
    const uWindForce = uniform(0);
    const uGustIntensity = uniform(0);
    const uFlashIntensity = uniform(0);
    const uStormDensity = uniform(0); // 0..1, lifts size + alpha toward whiteout

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

    if (stormDriven) {
        // Motion is authoritative in the curl-noise compute — just read it.
        material.positionNode = basePos;
    } else {
        // Legacy path: layer wind/turbulence/spiral on top of compute/CPU positions.
        const windX = uWindForce.mul(aDepth.add(1.0));
        const turbulence = sin(basePos.y.mul(0.05).add(uTime.mul(4.0))).mul(uGustIntensity).mul(12.0);
        const spiral = sin(uTime.mul(aWobbleSpeed).add(aPhase)).mul(float(2.0).add(uGustIntensity.mul(4.0)));
        const zOffset = cos(uTime.mul(aWobbleSpeed.mul(0.5)).add(aPhase)).mul(2.0).sub(uWindForce.mul(0.1));
        material.positionNode = vec3(
            basePos.x.add(windX).add(turbulence).add(spiral),
            basePos.y,
            basePos.z.add(zOffset),
        );
    }

    // WebGPU `THREE.Points` render as one-pixel primitives here; point-sprite
    // UV masks are unavailable, so this layer is the fine storm sheet.
    const flake = float(1.0);

    // The old UV mask path evaluated transparent against the geometry UV stub.
    // Lifted so falling flakes actually read across the whole screen.
    const depthAlpha = float(0.2).add(aDepth.mul(0.5));
    const twinkle = float(0.85).add(sin(uTime.mul(3.0).add(aPhase.mul(10.0))).mul(0.15));

    // Depth-of-field approximation: soften near/far, sharpest mid-depth.
    const nearFocus = smoothstep(0.05, 0.25, aDepth);
    const farFocus = float(1.0).sub(smoothstep(0.75, 0.95, aDepth));
    const dof = nearFocus.mul(farFocus);
    const blurScale = mix(float(1.5), float(1.0), dof);
    const dofAlpha = mix(float(0.5), float(1.0), dof);

    // Keep snow as visible flakes/sheets. Whiteout is carried by fog/post, not
    // by making every particle opaque.
    const densityAlpha = float(1.0).add(uStormDensity.mul(0.08));
    const densitySize = float(1.0).add(uStormDensity.mul(0.1));

    const flash = float(0.85).add(clamp(uFlashIntensity, 0.0, 1.0).mul(0.45));
    const snowAlpha = flake.mul(depthAlpha).mul(twinkle).mul(dofAlpha).mul(densityAlpha);
    const snowColor = vec3(0.78, 0.86, 0.98).mul(flash);

    material.colorNode = snowColor.mul(snowAlpha);
    material.opacityNode = snowAlpha;
    // Wider near/far size split: big soft foreground flakes vs fine far haze.
    const depthScale = float(0.4).add(aDepth.mul(0.9));
    material.sizeNode = aSize
        .mul(depthScale)
        .mul(blurScale)
        .mul(densitySize)
        .mul(float(950.0).div(positionView.z.negate()));
    material.emissiveNode = vec3(0.0);

    return {
        material,
        uniforms: {
            uTime, uWindForce, uGustIntensity, uFlashIntensity, uStormDensity,
        },
    };
}

export function createWinterSnowflakeBillboardMaterial(params = {}) {
    const uTime = uniform(0);
    const uOpacity = uniform(params.opacity ?? 0.7);
    const uTint = uniform(params.tint ?? new THREE.Color(0xdce6ff));

    const uvCoord = uv();
    const atlasOffset = params.useAtlas ? attribute('aAtlasOffset') : vec2(0.0, 0.0);
    const atlasScale = params.useAtlas ? attribute('aAtlasScale') : vec2(1.0, 1.0);
    const sampleUv = uvCoord.mul(atlasScale).add(atlasOffset);
    const texNode = params.map ? texture(params.map) : null;
    const sample = texNode ? texNode.sample(sampleUv) : vec4(1.0, 1.0, 1.0, 1.0);
    const centeredUv = uvCoord.sub(0.5).mul(2.0);
    const radialMask = float(1.0).sub(smoothstep(0.4, 1.0, length(centeredUv)));
    const shimmer = sin(uTime.mul(2.5).add(sample.r.mul(8.0))).mul(0.04).add(0.96);
    const sparkle = mx_noise_float(vec3(uvCoord.mul(18.0), uTime.mul(0.2).add(sample.g)))
        .mul(0.12)
        .add(0.94);

    const color = sample.rgb.mul(uTint).mul(shimmer).add(vec3(0.08).mul(sample.a));
    const alpha = sample.a.mul(radialMask).mul(uOpacity).mul(sparkle);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    // Snowflakes are NOT light sources — keep emissive tiny so dozens of
    // upward-biased instances don't accumulate past the bloom threshold and
    // bloom into a white haze across the upper sky.
    material.emissiveNode = color.mul(alpha.mul(0.05));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.premultipliedAlpha = true;

    return { material, uniforms: { uTime, uOpacity, uTint } };
}

export function createWinterWindStreakNodeMaterial() {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const uTime = uniform(0);
    const uWindForce = uniform(0);
    const uGustIntensity = uniform(0);
    const uOpacity = uniform(0);

    const aLength = attribute('length');
    const aSpeed = attribute('speed');
    const aOffset = attribute('offset');

    const positionNode = Fn(() => {
        const pos = positionLocal.toVar();
        const windAbs = abs(uWindForce);
        const dist = uTime.mul(aSpeed).mul(float(1.0).add(windAbs.mul(0.1)));
        const windSign = step(0.0, uWindForce).mul(2.0).sub(1.0);
        const range = float(1000.0);
        const halfRange = float(500.0);
        pos.x.assign(pos.x.add(dist.mul(windSign)).add(halfRange).mod(range).sub(halfRange));
        const gust = float(1.0).add(uGustIntensity.mul(1.1));
        const yWave = sin(uTime.mul(float(1.2).add(aSpeed.mul(0.003))).add(aOffset))
            .mul(float(8.0).add(windAbs.mul(0.05)))
            .mul(gust);
        const zWave = cos(uTime.mul(float(0.9).add(aSpeed.mul(0.002))).add(aOffset.mul(1.7)))
            .mul(float(5.0).add(uGustIntensity.mul(11.0)));
        pos.y.addAssign(yWave);
        pos.z.addAssign(zWave);
        return pos;
    })();

    const stretch = float(1.0).add(abs(uWindForce).mul(0.5)).add(uGustIntensity.mul(0.5));
    const sizeNode = aLength.mul(stretch).mul(float(300.0).div(positionView.z.negate()));

    const alpha = uOpacity;

    material.positionNode = positionNode;
    material.sizeNode = sizeNode;
    material.colorNode = vec3(0.8, 0.9, 1.0);
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.3, 0.4, 0.5).mul(uOpacity);

    return {
        material,
        uniforms: {
            uTime,
            uWindForce,
            uGustIntensity,
            uOpacity,
        },
    };
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

export function createWinterTreeFoliageNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uSnowColor = uniform(params.snowColor ?? new THREE.Color(0xddeeff));
    const uGreenColor = uniform(params.greenColor ?? new THREE.Color(0x0a263d)); // deep dark cool green-blue
    const uFogColor = uniform(params.fogColor ?? new THREE.Color(0x070d18));
    const uFogDensity = uniform(params.fogDensity ?? 0.0008);
    const uMoonDir = uniform(params.moonDir ?? new THREE.Vector3(470, 330, -1050).normalize());

    const vPos = positionWorld;
    const nWorld = normalize(normalWorld);

    // Flat slope cover: faces pointing up get snow
    const slope = nWorld.y;

    // Organic breakup for snow using noise
    const noise = mx_noise_float(vec3(vPos.mul(0.06))).mul(0.18);
    const snowFactor = smoothstep(float(0.1).add(noise), float(0.58).add(noise), slope);

    const baseCol = mix(uGreenColor, uSnowColor, snowFactor);

    // Subtle moon highlighting on the snow
    const moonLit = clamp(dot(nWorld, normalize(uMoonDir)), 0.0, 1.0);
    const finalLit = baseCol.add(uSnowColor.mul(moonLit.mul(0.25)));

    // Atmospheric depth fog
    const depth = length(vPos.sub(cameraPosition));
    const fogFactor = float(1.0).sub(
        exp(depth.mul(depth).mul(uFogDensity.mul(uFogDensity)).negate()),
    );
    const finalColor = mix(finalLit, uFogColor, fogFactor);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.emissiveNode = vec3(0.0);

    return { material, uniforms: { uTime } };
}

/**
 * Recolour the BAKED vertex colours of the GLB winter trees: remap only the
 * green-dominant foliage to a target forest green while leaving the white snow
 * caps and brown trunks untouched, preserving the baked per-facet shading.
 *
 * Reads `attribute('color','vec3')` directly (so `vertexColors` is OFF to avoid
 * three's automatic colour-attribute multiply) and outputs the result as the
 * albedo of a lit MeshStandardNodeMaterial — the same scene lights (moon key +
 * ambient) then shade near (skinned hero) and far (instanced LOD) trees alike.
 */
export function createWinterTreeRecolorMaterial(params = {}) {
    const uTarget = uniform(params.foliage ?? new THREE.Color(0x36571b)); // "under the snow" forest green
    const uRefLum = uniform(params.refLum ?? 0.10); // ~mean baked foliage luminance (decouples brightness); lowered 0.12→0.10 so recolour reads brighter to survive the in-game exposure 0.82
    const uGreenThresh = uniform(params.greenThresh ?? 0.012);
    const uGreenSoft = uniform(params.greenSoft ?? 0.05);
    const uSnowLumaLo = uniform(params.snowLumaLo ?? 0.42);
    const uSnowLumaHi = uniform(params.snowLumaHi ?? 0.68);
    const uSnowSatLo = uniform(params.snowSatLo ?? 0.10);
    const uSnowSatHi = uniform(params.snowSatHi ?? 0.26);
    // Cold snow-haze (aerial perspective): distant trees fade into the winter mist.
    const uHaze = uniform(params.haze ?? new THREE.Color(0xbcd3e3));
    const uHazeNear = uniform(params.hazeNear ?? 1050);
    const uHazeFar = uniform(params.hazeFar ?? 2700);
    const uHazeStrength = uniform(params.hazeStrength ?? 0.5);

    const c = attribute('color', 'vec3'); // baked COLOR_0: foliage / snow / bark (linear)
    const lumW = vec3(0.2126, 0.7152, 0.0722);
    const lum = dot(c, lumW);
    const maxC = c.r.max(c.g).max(c.b);
    const minC = c.r.min(c.g).min(c.b);
    const sat = maxC.sub(minC).div(maxC.max(float(1e-4)));
    const greenness = c.g.sub(c.r.max(c.b)); // >0 only where green dominates → foliage

    const foliageCand = smoothstep(uGreenThresh.sub(uGreenSoft), uGreenThresh.add(uGreenSoft), greenness);
    // Snow = bright AND desaturated; the (1-sat) term stops lit-green needles being mis-tagged.
    const snowMask = smoothstep(uSnowLumaLo, uSnowLumaHi, lum)
        .mul(float(1.0).sub(smoothstep(uSnowSatLo, uSnowSatHi, sat)));
    const foliageMask = foliageCand.mul(float(1.0).sub(snowMask)); // green AND not snow

    // Recolour preserving baked FACET shading without inheriting the (dark) baked
    // luminance: scale the target by the vertex brightness relative to a reference
    // mean, centred near 1 so the target shows at roughly its own set brightness
    // (lit facets a bit brighter, self-shadowed a bit darker).
    // Shadow floor lifted 0.45→0.55 so self-shadowed facets don't crush to dark teal
    // once the in-game cold grade (exposure 0.82 + contrast about 0.5 + blue tint) bites.
    const shade = clamp(lum.div(uRefLum.max(float(1e-3))), float(0.55), float(1.5));
    const recolored = uTarget.mul(shade);

    const albedo = mix(c, recolored, foliageMask);
    // Aerial perspective: fade albedo toward the cold haze with distance, plus a
    // touch of emissive so far trees don't crush to black on their shadow sides.
    const dist = length(positionWorld.sub(cameraPosition));
    const hazeT = smoothstep(uHazeNear, uHazeFar, dist).mul(uHazeStrength);

    const material = new THREE.MeshStandardNodeMaterial();
    material.colorNode = mix(albedo, uHaze, hazeT);
    // Distance-haze emissive + a faint target-tinted "green kiss" on the foliage only,
    // so close trees self-illuminate against the cool in-game grade + MRT bloom instead
    // of dying to navy. Kept low (0.06) so they read forest-green, not neon.
    material.emissiveNode = uHaze.mul(hazeT.mul(0.4)).add(uTarget.mul(foliageMask).mul(0.06));
    material.vertexColors = false; // we read 'color' manually → avoid the auto-multiply
    material.flatShading = true;
    material.side = THREE.DoubleSide;
    material.roughness = 1.0;
    material.metalness = 0.0;
    return {
        material,
        uniforms: {
            uTarget, uRefLum, uGreenThresh, uGreenSoft, uSnowLumaLo, uSnowLumaHi, uSnowSatLo, uSnowSatHi,
            uHaze, uHazeNear, uHazeFar, uHazeStrength,
        },
    };
}

export function createWinterLakeNodeMaterial(params = {}) {
    /* eslint-disable camelcase */
    const uTime = uniform(0);
    const uLakeColor = uniform(params.lakeColor ?? new THREE.Color(0x16d2d6)); // glowing centre cyan
    const uBaseColor = uniform(params.baseColor ?? new THREE.Color(0x0a5a70)); // deep turquoise shore
    const uAurora = uniform(params.aurora ?? new THREE.Color(0x33b890)); // emerald→teal curtain
    const uSky = uniform(params.skyColor ?? new THREE.Color(0x1b3a6e)); // cobalt reflected sky
    const uMountain = uniform(params.mtnColor ?? new THREE.Color(0x081c33)); // dark reflected treeline/peaks
    const uMoonColor = uniform(params.moonColor ?? new THREE.Color(0xdce8ff)); // moon glitter
    const uMoonU = uniform(params.moonU ?? 0.74); // moon column position in lake U
    const uCrackColor = uniform(params.crackColor ?? new THREE.Color(0xbfeeff)); // white-cyan cracks
    // ── "Shinier / icier" procedural levers (grade-safe, single-pass) ─────────
    const uFrostStrength = uniform(params.frostStrength ?? 0.5); // fbm normal-tilt → faceted ice plate
    const uStorm = uniform(0); // 0..1 Living-Blizzard intensity — combos flare the ice
    const uStreakAngle = uniform(params.streakAngle ?? 0.5); // skated-ice streak direction (radians)
    const uStreakFreq = uniform(params.streakFreq ?? 130.0); // streak density
    const uIceDepth = uniform(params.iceDepth ?? 0.045); // parallax "look into the thick ice" depth

    const baseUv = uv();
    const u = baseUv.x;
    const v = baseUv.y;

    // FROST RELIEF: tilt the dead-flat +Y normal with two decorrelated noise fields so the
    // whole sheet reads as a faceted ICE PLATE — every highlight below (sheen, sparkle, sweep,
    // moon glare) then rides real micro-relief instead of flat paint. uFrostStrength scales it.
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const frostNx = mx_noise_float(vec3(u.mul(40.0), v.mul(26.0), float(2.0)));
    const frostNz = mx_noise_float(vec3(u.mul(40.0).add(13.0), v.mul(26.0).add(7.0), float(4.0)));
    const nPert = normalize(vec3(frostNx.mul(uFrostStrength), float(1.0), frostNz.mul(uFrostStrength)));
    const vDotN = clamp(abs(dot(viewDir, nPert)), 0.0, 1.0);
    const fresnel = pow(float(1.0).sub(vDotN), float(3.5));
    const facet = clamp(length(vec2(frostNx, frostNz)).mul(uFrostStrength), 0.0, 1.0); // slope → glint gate

    // Base turquoise sheet: bright glowing centre, deeper toward the shoreline.
    const cx = u.sub(0.5).mul(2.0);
    const cz = v.sub(0.5).mul(2.0);
    const distCentre = clamp(length(vec2(cx, cz.mul(0.8))), 0.0, 1.0);
    const centreGlow = float(1.0).sub(smoothstep(0.0, 0.85, distCentre));
    let iceBase = mix(uBaseColor, uLakeColor, centreGlow);
    // PARALLAX DEPTH: faint frozen air-bubbles sampled at a VIEW-OFFSET UV so they sit BELOW
    // the surface — the slab reads as THICK ice with internal depth, not a flat sheet. Sparse
    // + centre-gated + parallax-shifted, so it reads as depth and never as surface grain.
    const iceParUv = baseUv.sub(viewDir.xz.div(clamp(abs(viewDir.y), 0.22, 1.0)).mul(uIceDepth));
    const deepBub = mx_noise_float(vec3(iceParUv.x.mul(11.0), iceParUv.y.mul(8.0), float(6.0))).mul(0.5).add(0.5);
    iceBase = mix(iceBase, uLakeColor.mul(1.16), smoothstep(0.62, 0.9, deepBub).mul(centreGlow).mul(0.26));

    // Slow ripple field that wobbles every reflected band horizontally.
    const ripple = mx_noise_float(vec3(u.mul(6.0), v.mul(3.0).add(uTime.mul(0.05)), float(0.0)))
        .mul(0.5).add(0.5);
    const uW = u.add(ripple.sub(0.5).mul(0.06));

    // Reflected-sky smear (cobalt), strengthening toward the far shore.
    const skyBand = smoothstep(0.45, 1.0, v);
    const skySmear = uSky.mul(skyBand.mul(0.45)).mul(ripple.mul(0.5).add(0.6));

    // Aurora curtain smear: emerald→teal vertical streaks, mid-to-far, wobbled.
    const curtain = sin(uW.mul(11.0).add(uTime.mul(0.08))).mul(0.5).add(0.5);
    const curtainNoise = mx_noise_float(vec3(uW.mul(4.0), v.mul(1.5).add(uTime.mul(0.04)), float(3.0)))
        .mul(0.5).add(0.5);
    const auroraDepth = smoothstep(0.30, 0.95, v).mul(smoothstep(1.0, 0.86, v).add(0.55));
    const auroraSmear = uAurora.mul(
        auroraDepth.mul(curtain.mul(0.6).add(0.25)).mul(curtainNoise.mul(0.5).add(0.5)).mul(0.7),
    );

    // Reflected-mountain / treeline darkening band near the far shore.
    const mtnBand = smoothstep(0.74, 0.93, v).mul(smoothstep(1.0, 0.9, v).add(0.35));
    const mtnRagged = mx_noise_float(vec3(uW.mul(7.0), float(11.0), float(0.0))).mul(0.5).add(0.5);
    const mtnMask = clamp(mtnBand.mul(mtnRagged.mul(0.6).add(0.55)), 0.0, 1.0);

    // Moon glitter column (procedural) — vertical broken-light band under the moon.
    const colBand = smoothstep(0.085, 0.0, abs(uW.sub(uMoonU)));
    const colShimmer = mx_noise_float(vec3(u.mul(48.0), v.mul(22.0).add(uTime.mul(0.6)), float(7.0)))
        .mul(0.5).add(0.5);
    const moonColumn = colBand.mul(smoothstep(0.04, 0.85, v)).mul(colShimmer.mul(0.65).add(0.35));
    const moonRefl = uMoonColor.mul(moonColumn);

    // Procedural white-cyan crack lines (no texture needed).
    const cn1 = mx_noise_float(vec3(u.mul(9.0), v.mul(9.0), float(1.7))).mul(0.5).add(0.5);
    const cn2 = mx_noise_float(vec3(u.mul(5.0).add(v.mul(3.0)), v.mul(6.0).sub(u.mul(2.0)), float(4.2)))
        .mul(0.5).add(0.5);
    const ridge1 = float(1.0).sub(smoothstep(0.0, 0.04, abs(cn1.sub(0.5))));
    const ridge2 = float(1.0).sub(smoothstep(0.0, 0.05, abs(cn2.sub(0.5))));
    const crackDepth = float(0.45).add(smoothstep(1.0, 0.2, v).mul(0.55));
    const crackLine = clamp(ridge1.add(ridge2.mul(0.7)), 0.0, 1.0).mul(crackDepth);

    // ── Glossy "shiny ice" highlights (ice-temple-style) ─────────────────────
    // Brighter grazing-angle sheen (fresnel rim).
    const sheen = mix(vec3(0.0), vec3(0.52, 0.70, 0.92), fresnel.mul(0.62));
    // Twinkling micro-sparkles — stretched (v×40) so glints read ELONGATED like ice crystals,
    // gated by the frost facet slope so they cluster on relief; combos (uStorm) raise density.
    const sparkleField = mx_noise_float(vec3(u.mul(165.0), v.mul(40.0), uTime.mul(0.9).add(31.0)))
        .mul(0.5).add(0.5);
    const sparkle = smoothstep(float(0.9).sub(uStorm.mul(0.12)), float(1.0), sparkleField)
        .mul(smoothstep(0.05, 0.5, v))
        .mul(fresnel.mul(0.6).add(0.55))
        .mul(facet.mul(0.7).add(0.6));
    // ANISOTROPIC STREAK specular — thin highlights raked along the skate / ice-growth
    // direction (the unmistakable "polished ice" read), windowed by a low-freq density noise.
    const sDir = u.mul(cos(uStreakAngle)).add(v.mul(sin(uStreakAngle)));
    const streakNoise = mx_noise_float(vec3(u.mul(8.0), v.mul(8.0), float(5.0))).mul(0.5).add(0.5);
    const streakDensField = mx_noise_float(vec3(u.mul(3.0), v.mul(3.0), float(9.0))).mul(0.5).add(0.5);
    const streakDens = smoothstep(0.45, 0.8, streakDensField);
    const streak = pow(abs(sin(sDir.mul(uStreakFreq).add(streakNoise.mul(6.28)))), float(22.0))
        .mul(streakDens).mul(fresnel.mul(0.7).add(0.3)).mul(smoothstep(0.1, 0.6, v));
    // Slow specular SWEEP gliding across the ice (like the tetromino-block shine); combos speed it.
    const sweepPhase = u.mul(2.6).add(v.mul(1.4)).sub(uTime.mul(float(0.22).add(uStorm.mul(0.5))));
    const sweep = pow(sin(sweepPhase).mul(0.5).add(0.5), float(7.0))
        .mul(smoothstep(0.12, 0.7, v)).mul(0.5);
    // Tight moon GLARE hotspot where the moon concentrates on the ice.
    const glareDist = length(vec2(uW.sub(uMoonU).mul(2.6), v.sub(0.30).mul(1.15)));
    const moonGlare = smoothstep(0.55, 0.0, glareDist).mul(colShimmer.mul(0.4).add(0.6));
    const shine = uMoonColor.mul(
        sparkle.mul(0.95).add(sweep.mul(0.6)).add(moonGlare.mul(0.8)).add(streak.mul(0.85)),
    );

    // Organic shoreline alpha so the ice melts into the snow (no hard rectangle).
    const edgeNoise = mx_noise_float(vec3(baseUv.mul(5.0), float(0.0))).mul(0.5).add(0.5);
    const eIn = float(0.06).add(edgeNoise.mul(0.07));
    const edgeMask = smoothstep(0.0, eIn, u)
        .mul(float(1.0).sub(smoothstep(float(1.0).sub(eIn), 1.0, u)))
        .mul(smoothstep(0.0, eIn, v))
        .mul(float(1.0).sub(smoothstep(float(1.0).sub(eIn), 1.0, v)));

    // SUB-SURFACE cyan glow: an inner light in the sheet's centre that BREATHES and SWELLS on
    // combos (uStorm) so the ice visibly flares during play. FROST RIM: a brighter crystalline
    // band at the ice/snow seam that sells "frozen" + hides the shoreline alpha seam.
    const subsurf = uLakeColor.mul(
        centreGlow.mul(float(0.22).add(uStorm.mul(0.9))).mul(sin(uTime.mul(0.5)).mul(0.08).add(0.92)),
    );
    const rim = edgeMask.mul(float(1.0).sub(edgeMask)).mul(4.0); // bright in the edge fade band
    const rimSparkle = mx_noise_float(vec3(u.mul(120.0), v.mul(120.0), float(13.0))).mul(0.5).add(0.5);
    const frostRim = uCrackColor.mul(rim.mul(rimSparkle.mul(0.5).add(0.6)).mul(1.15));

    let col = iceBase;
    col = mix(col, uMountain, mtnMask);
    col = col.add(skySmear);
    col = col.add(auroraSmear);
    col = col.add(moonRefl);
    col = col.add(subsurf);
    col = col.add(sheen);
    col = col.add(shine);
    col = col.add(frostRim);
    col = mix(col, uCrackColor, crackLine.mul(0.85));
    const finalColor = clamp(col, 0.0, 1.7);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.opacityNode = clamp(edgeMask, 0.0, 1.0);
    material.transparent = true;
    material.depthWrite = false;
    material.emissiveNode = moonRefl.mul(0.55)
        .add(auroraSmear.mul(0.35))
        .add(uCrackColor.mul(crackLine.mul(0.3)))
        .add(subsurf.mul(0.5))
        .add(frostRim.mul(0.6))
        .add(shine.mul(0.6));

    /* eslint-enable camelcase */
    return {
        material,
        uniforms: {
            uTime, uAurora, uLakeColor, uMoonColor, uStorm, uFrostStrength, uStreakAngle, uStreakFreq,
        },
    };
}
