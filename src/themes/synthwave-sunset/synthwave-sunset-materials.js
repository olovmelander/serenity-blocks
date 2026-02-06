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
    normalWorld,
    cameraPosition,
    uv,
    vec2,
    vec3,
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

    material.colorNode = finalColor;
    material.opacityNode = edgeFade;
    material.emissiveNode = finalColor;

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
// Buildings
// ---------------------------------------------------------------------------
export function createBuildingNodeMaterial(color) {
    const material = new THREE.MeshBasicNodeMaterial();
    const uColor = uniform(color);
    const uGlowIntensity = uniform(0.06);

    material.colorNode = uColor;
    material.emissiveNode = uColor.mul(uGlowIntensity);

    return {
        material,
        uniforms: {
            uColor,
            uGlowIntensity,
        },
    };
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
