/**
 * Synthwave Sunset Theme - TSL Node Materials
 * WebGPU-only materials that mirror the GLSL ShaderMaterial look.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    storage,
    uniform,
    vertexIndex,
    instanceIndex,
    positionLocal,
    positionWorld,
    positionView,
    normalLocal,
    normalWorld,
    cameraPosition,
    uv,
    vec2,
    vec3,
    vec4,
    float,
    sin,
    fract,
    floor,
    abs,
    dot,
    length,
    mix,
    smoothstep,
    pow,
    max,
    min,
    normalize,
    exp,
    step,
    screenUV,
} from 'three/tsl';

// ---------------------------------------------------------------------------
// Helpers: lightweight 2D noise for sun shimmer (value noise)
// ---------------------------------------------------------------------------
const hash2D = /* @__PURE__ */ Fn(([p]) => {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

const noise2D = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = hash2D(i);
    const b = hash2D(i.add(vec2(1.0, 0.0)));
    const c = hash2D(i.add(vec2(0.0, 1.0)));
    const d = hash2D(i.add(vec2(1.0, 1.0)));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------
export function createGridNodeMaterial(colors) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.FrontSide;

    const uTime = uniform(0);
    const uSpeed = uniform(-5.0);
    const uGridColor = uniform(colors.gridPink.clone());
    const uPulseIntensity = uniform(0);
    const uGlowIntensity = uniform(1.0);
    const uBloomScale = uniform(0.6);
    const uWaveOrigin = uniform(new THREE.Vector2(0, 0));
    const uWaveIntensity = uniform(0.0);
    const uWaveFrequency = uniform(0.35);
    const uWaveSpeed = uniform(6.0);
    const uWaveFalloff = uniform(0.045);

    const localPos = positionLocal;
    const localXZ = vec2(localPos.x, localPos.z);
    const waveDist = length(localXZ.sub(uWaveOrigin));
    const wave = sin(waveDist.mul(uWaveFrequency).sub(uTime.mul(uWaveSpeed)))
        .mul(uWaveIntensity)
        .mul(exp(waveDist.mul(uWaveFalloff).negate()));
    material.positionNode = vec3(localPos.x, localPos.y.add(wave), localPos.z);

    const gridSpacing = float(1.5);
    const lineWidth = float(0.04);
    const worldPos = positionWorld;
    const scrolledZ = worldPos.z.add(uTime.mul(uSpeed));

    const gridX = abs(fract(worldPos.x.div(gridSpacing).add(0.5)).sub(0.5)).mul(gridSpacing);
    const gridZ = abs(fract(scrolledZ.div(gridSpacing).add(0.5)).sub(0.5)).mul(gridSpacing);

    const lineX = smoothstep(lineWidth.mul(2.0), float(0.0), gridX);
    const lineZ = smoothstep(lineWidth.mul(2.0), float(0.0), gridZ);
    const gridLine = max(lineX, lineZ);

    const dist = length(vec2(worldPos.x, worldPos.z));
    const distanceFade = float(1.0).sub(smoothstep(float(5.0), float(45.0), dist));
    const perspectiveFade = float(1.0).sub(smoothstep(float(0.0), float(40.0), worldPos.z.negate()));

    const horizonFade = smoothstep(float(-60.0), float(-40.0), worldPos.z);
    let intensity = gridLine.mul(uGlowIntensity).mul(distanceFade).mul(perspectiveFade).mul(horizonFade);
    intensity = intensity.add(intensity.mul(uPulseIntensity).mul(0.5));

    const glow = max(lineX, lineZ).mul(0.3).mul(horizonFade);
    let color = uGridColor.mul(intensity.add(glow.mul(0.5)));

    // Horizon fog blend
    const fogDensity = float(0.02);
    let fogFactor = float(1.0).sub(
        exp(abs(worldPos.z).mul(fogDensity).mul(0.05).negate()),
    );
    fogFactor = smoothstep(float(0.0), float(1.0), fogFactor.mul(2.5));
    const horizonColor = vec3(0.5, 0.0, 0.3);
    const finalColor = mix(color, horizonColor, fogFactor);

    let alpha = intensity.mul(0.9).add(glow.mul(0.3));
    alpha = alpha.mul(horizonFade);

    // Screen-space clip: hide grid pixels above horizon
    // Match GLSL: if (screenUv.y < 0.46) discard - using step for hard cutoff
    // step(edge, x) returns 0 if x < edge, 1 if x >= edge
    const screenClip = step(float(0.46), screenUV.y);
    alpha = alpha.mul(screenClip);

    material.colorNode = finalColor.mul(screenClip);
    material.opacityNode = alpha.mul(distanceFade);
    material.emissiveNode = uGridColor
        .mul(intensity.add(glow.mul(0.5)))
        .mul(uBloomScale)
        .mul(horizonFade)
        .mul(screenClip);

    return {
        material,
        uniforms: {
            uTime,
            uSpeed,
            uGridColor,
            uPulseIntensity,
            uGlowIntensity,
            uBloomScale,
            uWaveOrigin,
            uWaveIntensity,
            uWaveFrequency,
            uWaveSpeed,
            uWaveFalloff,
        },
    };
}

// ---------------------------------------------------------------------------
// Sun
// ---------------------------------------------------------------------------
export function createSunNodeMaterial(colors) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.side = THREE.FrontSide;

    const uTime = uniform(0);
    const uColorTop = uniform(colors.sunTop);
    const uColorMid = uniform(colors.sunMid);
    const uColorBottom = uniform(colors.sunBottom);
    const uPulseIntensity = uniform(0);

    const uvNode = uv();
    const y = uvNode.y;

    const lower = mix(uColorBottom, uColorMid, y.mul(2.0));
    const upper = mix(uColorMid, uColorTop, y.sub(0.5).mul(2.0));
    const baseColor = mix(lower, upper, step(0.5, y));

    const noise = noise2D(uvNode.mul(5.0).add(uTime.mul(0.05))).mul(0.03);
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(max(dot(normalize(normalWorld), viewDir), 0.0)), 2.0);

    let finalColor = baseColor.add(noise);
    finalColor = finalColor.add(finalColor.mul(uPulseIntensity).mul(0.5));

    const edgeFade = float(1.0).sub(fresnel.mul(0.4));

    // Iconic horizontal "Saturn" bands across the lower half of the sun.
    // Bands cut alpha to reveal the sky behind, getting thicker toward the base.
    const bandFreq = float(7.0);
    const bandPhase = fract(y.mul(bandFreq));
    // Thickness ramps from thin near mid-sun to thick at bottom
    const bandThickness = mix(float(0.55), float(0.18), y);
    const bandSolid = smoothstep(bandThickness.sub(0.02), bandThickness.add(0.02), bandPhase);
    // Bands only apply below y≈0.55
    const bandRegion = float(1.0).sub(smoothstep(float(0.42), float(0.55), y));
    const sunBandMask = mix(float(1.0), bandSolid, bandRegion);

    material.colorNode = finalColor;
    material.opacityNode = edgeFade.mul(sunBandMask);
    material.emissiveNode = finalColor.mul(sunBandMask);

    return {
        material,
        uniforms: {
            uTime,
            uColorTop,
            uColorMid,
            uColorBottom,
            uPulseIntensity,
        },
    };
}

// ---------------------------------------------------------------------------
// Sun Glow
// ---------------------------------------------------------------------------
export function createSunGlowNodeMaterial(glowColor, opacity = 0.5) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

    const uGlowColor = uniform(glowColor);
    const uOpacity = uniform(opacity);
    const uPulseIntensity = uniform(0);

    const center = uv().sub(0.5);
    const dist = length(center).mul(2.0);
    let glow = float(1.0).sub(smoothstep(float(0.0), float(1.0), dist));
    glow = pow(glow, 2.0);
    glow = glow.add(glow.mul(uPulseIntensity).mul(0.3));

    material.colorNode = uGlowColor;
    material.opacityNode = glow.mul(uOpacity);
    material.emissiveNode = uGlowColor.mul(glow);

    return {
        material,
        uniforms: {
            uGlowColor,
            uOpacity,
            uPulseIntensity,
        },
    };
}

// ---------------------------------------------------------------------------
// Buildings — procedural window grid + rim fresnel
// ---------------------------------------------------------------------------
export function createBuildingNodeMaterial(color, params = {}) {
    const {
        windowEmissive = 1.0,
        rimIntensity = 1.0,
        flickerEnabled = 1.0,
        windowDensity = 0.68,
        colorVariety = 1.0,
        distanceBoost = 1.0,
    } = params;

    const material = new THREE.MeshBasicNodeMaterial();
    const uColor = uniform(color);
    const uGlowIntensity = uniform(0.06);
    const uTime = uniform(0);
    const uWindowEmissive = uniform(windowEmissive);
    const uRimIntensity = uniform(rimIntensity);
    const uFlickerEnabled = uniform(flickerEnabled);
    const uWindowDensity = uniform(windowDensity);
    const uColorVariety = uniform(colorVariety);
    const uDistanceBoost = uniform(distanceBoost);

    const pos = positionLocal;
    const nrm = normalLocal;
    const absNrm = abs(nrm);

    // Side-face mask: 1 on x/z facing faces, 0 on top/bottom
    const sideAxisMax = max(absNrm.x, absNrm.z);
    const sideMask = step(absNrm.y, sideAxisMax);

    // Tri-planar U: positionLocal.z for x-facing faces, positionLocal.x for z-facing
    const xFaceWeight = step(absNrm.z, absNrm.x);
    const u = mix(pos.x, pos.z, xFaceWeight);
    const v = pos.y;

    // Window grid (post-translate, positionLocal is in world space → unique per building)
    const windowW = float(1.1);
    const windowH = float(1.15);
    const cellU = fract(u.div(windowW));
    const cellV = fract(v.div(windowH));
    const col = floor(u.div(windowW));
    const row = floor(v.div(windowH));

    // Rectangular window inside each cell, leaving a margin (frame)
    const inWinU = step(float(0.18), cellU).mul(step(cellU, float(0.82)));
    const inWinV = step(float(0.18), cellV).mul(step(cellV, float(0.82)));
    const winRect = inWinU.mul(inWinV);

    // Per-window hashes drive lit/unlit, color, and flicker
    const seed = vec2(col.add(xFaceWeight.mul(73.2)), row);
    const litRand = hash2D(seed);
    const litMask = step(float(1.0).sub(uWindowDensity), litRand);

    const colorRand = hash2D(seed.add(vec2(17.3, 9.1)));
    const cyanCol = vec3(0.4, 1.0, 1.0);
    const magCol = vec3(1.0, 0.2, 0.55);
    const amberCol = vec3(1.0, 0.78, 0.32);
    const pinkCol = vec3(1.0, 0.62, 0.85);
    const c1 = mix(cyanCol, magCol, step(float(0.25), colorRand));
    const c2 = mix(amberCol, pinkCol, step(float(0.75), colorRand));
    const variedColor = mix(c1, c2, step(float(0.5), colorRand));
    // Blend toward warm amber when variety disabled (low-quality mode)
    const winColor = mix(amberCol, variedColor, uColorVariety);

    // Per-window flicker on ~5% of windows
    const flickerRand = hash2D(seed.add(vec2(53.7, 28.4)));
    const isFlicker = step(float(0.94), flickerRand);
    const flickerWave = sin(uTime.mul(7.0).add(flickerRand.mul(20.0))).mul(0.5).add(0.5);
    const flickerMod = mix(float(1.0), flickerWave.mul(0.7).add(0.3), isFlicker.mul(uFlickerEnabled));

    // Distance fade: closer buildings glow brighter
    const camDistance = max(pos.z.negate().sub(float(18.0)), float(1.0));
    const distFactor = float(1.0).sub(smoothstep(float(20.0), float(85.0), camDistance));
    const distAmount = float(0.5).add(distFactor.mul(uDistanceBoost));

    const windowGlow = winRect
        .mul(litMask)
        .mul(sideMask)
        .mul(flickerMod)
        .mul(distAmount)
        .mul(uWindowEmissive);
    const windowEmission = winColor.mul(windowGlow);

    // Rim fresnel: hot pink at the base, warm orange up high
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nWorld = normalize(normalWorld);
    const fresnel = pow(float(1.0).sub(max(dot(nWorld, viewDir), float(0.0))), 2.5);
    const heightT = smoothstep(float(0.0), float(22.0), pos.y);
    const rimWarm = vec3(1.0, 0.55, 0.28);
    const rimMagenta = vec3(1.0, 0.18, 0.5);
    const rimColor = mix(rimMagenta, rimWarm, heightT);
    const rimGlow = rimColor.mul(fresnel).mul(uRimIntensity);

    const baseColor = uColor.mul(float(1.0).add(uGlowIntensity));
    const totalEmissive = windowEmission.add(rimGlow);

    material.colorNode = baseColor.add(totalEmissive);
    material.emissiveNode = totalEmissive;

    return {
        material,
        uniforms: {
            uColor,
            uGlowIntensity,
            uTime,
            uWindowEmissive,
            uRimIntensity,
            uFlickerEnabled,
            uWindowDensity,
            uColorVariety,
            uDistanceBoost,
        },
    };
}

// ---------------------------------------------------------------------------
// Ambient drifting motes — slow-moving dust/light points in the dead air
// ---------------------------------------------------------------------------
export function createMoteNodeMaterial() {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const uTime = uniform(0);
    const uPixelRatio = uniform(1);
    const uIntensity = uniform(1.0);

    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');
    const aSpeed = attribute('aSpeed');
    const aDriftRange = attribute('aDriftRange');
    const aColor = attribute('aColor', 'vec3');

    // Slow horizontal drift + tiny vertical bob, all GPU-driven.
    const driftX = sin(uTime.mul(aSpeed).add(aPhase)).mul(aDriftRange);
    const driftY = sin(uTime.mul(aSpeed.mul(0.6)).add(aPhase.mul(1.7))).mul(aDriftRange.mul(0.25));
    material.positionNode = positionLocal.add(vec3(driftX, driftY, float(0.0)));

    const twinkle = sin(uTime.mul(0.8).add(aPhase.mul(3.1))).mul(0.25).add(0.75);
    const sizeNode = aSize
        .mul(twinkle)
        .mul(uPixelRatio)
        .mul(float(180.0).div(positionView.z.negate().add(1.0)));

    const alpha = twinkle.mul(0.6).mul(uIntensity);

    material.sizeNode = sizeNode;
    material.colorNode = aColor;
    material.opacityNode = alpha;
    material.emissiveNode = aColor.mul(alpha).mul(0.6);

    return { material, uniforms: { uTime, uPixelRatio, uIntensity } };
}

// ---------------------------------------------------------------------------
// Haze plane — additive gradient for atmospheric depth layers
// ---------------------------------------------------------------------------
export function createHazeNodeMaterial(color, opacity = 0.3) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

    const uColor = uniform(color);
    const uOpacity = uniform(opacity);

    const uvNode = uv();
    // Horizontal gradient: bright in middle, fade at left/right edges
    const horizontalFade = float(1.0).sub(pow(abs(uvNode.x.sub(0.5)).mul(2.0), float(1.6)));
    // Vertical gradient: brightest near the bottom (horizon-hugging)
    const verticalFade = pow(float(1.0).sub(abs(uvNode.y.sub(0.35)).mul(1.8)), float(2.0));
    const intensity = max(horizontalFade.mul(verticalFade), float(0.0));

    material.colorNode = uColor;
    material.opacityNode = intensity.mul(uOpacity);
    // Intentionally zero — haze must NOT bloom, it's a soft atmospheric layer
    // that already shows up through the additive blend.
    material.emissiveNode = vec3(0.0, 0.0, 0.0);

    return { material, uniforms: { uColor, uOpacity } };
}

// ---------------------------------------------------------------------------
// Palm silhouette — base dark + rim fresnel glow against the sun
// ---------------------------------------------------------------------------
export function createPalmNodeMaterial(rimColor = new THREE.Color(0xff3366)) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    const uRimColor = uniform(rimColor);
    const uRimIntensity = uniform(1.0);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nWorld = normalize(normalWorld);
    const fresnel = pow(float(1.0).sub(max(dot(nWorld, viewDir), float(0.0))), 1.4);
    // Always-on body glow so the silhouette reads even when the sun is off-screen.
    const bodyTint = vec3(0.35, 0.05, 0.18);
    const rimGlow = uRimColor.mul(fresnel).mul(uRimIntensity);
    const total = bodyTint.add(rimGlow);

    material.colorNode = total;
    material.opacityNode = float(1.0);
    material.emissiveNode = total;

    return { material, uniforms: { uRimColor, uRimIntensity } };
}

export function createBuildingEdgeNodeMaterial(color) {
    const material = new THREE.LineBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const uEdgeColor = uniform(color);
    const uGlowIntensity = uniform(0.0);

    const glowColor = uEdgeColor.mul(uGlowIntensity);
    material.colorNode = glowColor;
    material.opacityNode = uGlowIntensity;
    material.emissiveNode = glowColor;

    return { material, uniforms: { uEdgeColor, uGlowIntensity } };
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------
export function createStarNodeMaterial() {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const uTime = uniform(0);
    const uPixelRatio = uniform(1);

    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');
    const aColor = attribute('aColor', 'vec3');

    const twinkle = sin(uTime.mul(2.0).add(aPhase.mul(6.28))).mul(0.5).add(0.5);
    const sizeNode = aSize
        .mul(float(0.7).add(twinkle.mul(0.6)))
        .mul(uPixelRatio)
        .mul(float(300.0).div(positionView.z.negate()));

    const twinkleAlpha = sin(uTime.mul(1.5).add(aPhase.mul(6.28))).mul(0.3).add(0.7);
    const alpha = twinkleAlpha;

    material.sizeNode = sizeNode;
    material.colorNode = aColor;
    material.opacityNode = alpha;
    material.emissiveNode = aColor.mul(alpha);

    return { material, uniforms: { uTime, uPixelRatio } };
}

// ---------------------------------------------------------------------------
// Highlight Cells
// ---------------------------------------------------------------------------
export function createHighlightNodeMaterial(params = {}) {
    const { isWebGPU = false, highlightCompute = null } = params;
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

    const uColor = uniform(new THREE.Color(0x00ffff));
    const uIntensity = uniform(0);
    const uTime = uniform(0);
    const uTwinkleIntensity = uniform(0);

    const useGPU = Boolean(isWebGPU && highlightCompute?.getStateBuffer && highlightCompute?.getColorBuffer);
    const stateBuffer = useGPU
        ? storage(highlightCompute.getStateBuffer(), 'vec4', highlightCompute.count)
        : null;
    const colorBuffer = useGPU
        ? storage(highlightCompute.getColorBuffer(), 'vec4', highlightCompute.count)
        : null;

    const basePos = Fn(() => {
        if (useGPU) {
            return stateBuffer.element(instanceIndex).xyz;
        }
        return vec3(0.0, 0.0, 0.0);
    })();

    const baseIntensity = Fn(() => {
        if (useGPU) {
            return stateBuffer.element(instanceIndex).w;
        }
        return uIntensity;
    })();

    const baseColor = Fn(() => {
        if (useGPU) {
            return colorBuffer.element(instanceIndex).xyz;
        }
        return uColor;
    })();

    const phase = Fn(() => {
        if (useGPU) {
            return colorBuffer.element(instanceIndex).w;
        }
        return float(0.0);
    })();

    const positionNode = Fn(() => {
        if (useGPU) {
            return positionLocal.add(basePos);
        }
        return positionLocal;
    })();
    material.positionNode = positionNode;

    const center = uv().sub(0.5);
    const edge = max(abs(center.x), abs(center.y));
    const edgeGlow = smoothstep(float(0.35), float(0.5), edge);
    const fill = float(1.0).sub(smoothstep(float(0.0), float(0.4), edge));

    const chromatic = vec3(
        baseColor.r.add(edgeGlow.mul(0.3)),
        baseColor.g,
        baseColor.b.add(edgeGlow.mul(0.2)),
    );

    const pulse = sin(uTime.mul(3.0)).mul(0.1).add(1.0);
    const twinkle = sin(uTime.mul(30.0).add(phase)).mul(uTwinkleIntensity).mul(0.5).add(1.0);

    const fadeStart = float(14.0);
    const fadeRange = float(75.0);
    const distanceFade = max(
        float(0.3),
        float(1.0).sub(max(float(0.0), basePos.z.sub(fadeStart)).div(fadeRange)),
    );

    const intensity = baseIntensity.mul(distanceFade).mul(twinkle);
    const finalColor = chromatic.mul(intensity).mul(pulse);
    const alpha = fill.mul(0.6).add(edgeGlow.mul(0.8)).mul(intensity);

    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = finalColor;

    return { material, uniforms: { uColor, uIntensity, uTime, uTwinkleIntensity } };
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------
export function createParticleNodeMaterial(params = {}) {
    const { isWebGPU = false, particleCompute = null } = params;
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const uPixelRatio = uniform(1);
    const aSize = attribute('aSize');
    const aLife = attribute('aLife');
    const aColor = attribute('aColor', 'vec3');

    const useGPU = Boolean(isWebGPU && particleCompute?.getStateBuffer && particleCompute?.getColorBuffer);
    const stateBuffer = useGPU
        ? storage(particleCompute.getStateBuffer(), 'vec4', particleCompute.count * 2)
        : null;
    const colorBuffer = useGPU
        ? storage(particleCompute.getColorBuffer(), 'vec4', particleCompute.count)
        : null;

    const basePos = Fn(() => {
        if (useGPU) {
            const idx = vertexIndex;
            return stateBuffer.element(idx.mul(2)).xyz;
        }
        return positionLocal;
    })();

    const lifeNode = Fn(() => {
        if (useGPU) {
            const idx = vertexIndex;
            return stateBuffer.element(idx.mul(2)).w;
        }
        return aLife;
    })();

    const sizeValue = Fn(() => {
        if (useGPU) {
            const idx = vertexIndex;
            return colorBuffer.element(idx).w;
        }
        return aSize;
    })();

    const colorValue = Fn(() => {
        if (useGPU) {
            const idx = vertexIndex;
            return colorBuffer.element(idx).xyz;
        }
        return aColor;
    })();

    material.positionNode = basePos;

    const sizeNode = sizeValue
        .mul(lifeNode)
        .mul(uPixelRatio)
        .mul(float(200.0).div(positionView.z.negate()));

    const alpha = pow(max(lifeNode, float(0.0)), 1.2);

    const color = colorValue.mul(float(1.0).add(lifeNode.mul(0.5)));

    material.sizeNode = sizeNode;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha);

    return { material, uniforms: { uPixelRatio } };
}
